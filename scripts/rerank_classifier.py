#!/usr/bin/env python3
"""Переранжировать соседей классификатора кросс-энкодером.

Сначала по уже посчитанным векторам берутся ближайшие разные нормы.
Затем кросс-энкодер читает название плана и норму вместе и оставляет одну.

  python scripts/rerank_classifier.py
  python scripts/rerank_classifier.py --limit 2

Векторы и старые таблицы сопоставления не меняются.
"""

from __future__ import annotations

import argparse
import os
import sys

import numpy as np
import psycopg
from sentence_transformers import CrossEncoder

DEFAULT_MODEL = "BAAI/bge-reranker-v2-m3"
TOP_K = 50
CLASSIFIER_BLOCK = 4096


def log(message: str) -> None:
    print(message, file=sys.stderr)


def connect() -> psycopg.Connection:
    return psycopg.connect(
        host=os.environ.get("POSTGRES_HOST", "localhost"),
        port=os.environ.get("POSTGRES_PORT", "5432"),
        user=os.environ.get("POSTGRES_USER", "admin"),
        password=os.environ.get("POSTGRES_PASSWORD", "admin_password"),
        dbname=os.environ.get("POSTGRES_DB", "monitoring_db"),
    )


def parse_vector(value: str) -> np.ndarray:
    return np.fromstring(value.strip()[1:-1], sep=",", dtype=np.float32)


def load_works(limit: int | None) -> list[dict]:
    query = """
        SELECT wv.work_id, wv.vector::text AS vector, w.name
        FROM work_vector wv
        JOIN work w ON w.id = wv.work_id
        ORDER BY w.position
    """
    params: tuple[object, ...] = ()
    if limit is not None:
        query += " LIMIT %s"
        params = (limit,)
    with connect() as conn:
        with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
            cur.execute(query, params)
            rows = cur.fetchall()
    for row in rows:
        row["vector"] = parse_vector(row["vector"])
    return rows


def load_classifiers() -> list[dict]:
    """Одна строка на норму: машины с тем же текстом имеют тот же вектор."""
    unique: dict[tuple[str, str], dict] = {}
    with connect() as conn:
        with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
            cur.execute(
                """
                SELECT
                    cv.classifier_id,
                    cv.vector::text AS vector,
                    c.sphere,
                    c.section,
                    c.table_name,
                    c.work_name
                FROM work_classifier_vector cv
                JOIN work_classifier c ON c.id = cv.classifier_id
                """
            )
            for row in cur.fetchall():
                key = (row["table_name"], row["work_name"])
                if key in unique:
                    continue
                row["vector"] = parse_vector(row["vector"])
                unique[key] = row
    return list(unique.values())


def vectors_matrix(rows: list[dict]) -> np.ndarray:
    return np.ascontiguousarray(
        np.stack([row["vector"] for row in rows]),
        dtype=np.float32,
    )


def top_indices(work_vectors: np.ndarray, classifier_vectors: np.ndarray, k: int) -> tuple[np.ndarray, np.ndarray]:
    """Индексы и косинусы k ближайших норм для каждой работы.

    Векторы уже нормированы, произведение — косинусная близость.
    """
    count = work_vectors.shape[0]
    total = classifier_vectors.shape[0]
    k = min(k, total)
    best_index = np.full((count, k), -1, dtype=np.int64)
    best_score = np.full((count, k), -np.inf, dtype=np.float32)
    for start in range(0, total, CLASSIFIER_BLOCK):
        block = classifier_vectors[start:start + CLASSIFIER_BLOCK]
        scores = work_vectors @ block.T
        block_size = scores.shape[1]
        take = min(k, block_size)
        if block_size == take:
            local_index = np.broadcast_to(
                np.arange(block_size), (count, block_size))
        else:
            local_index = np.argpartition(scores, -take, axis=1)[:, -take:]
        local_score = np.take_along_axis(scores, local_index, axis=1)
        merged_score = np.concatenate([best_score, local_score], axis=1)
        merged_index = np.concatenate(
            [best_index, local_index + start], axis=1)
        chosen = np.argpartition(merged_score, -k, axis=1)[:, -k:]
        chosen_score = np.take_along_axis(merged_score, chosen, axis=1)
        order = np.argsort(-chosen_score, axis=1)
        chosen = np.take_along_axis(chosen, order, axis=1)
        best_score = np.take_along_axis(merged_score, chosen, axis=1)
        best_index = np.take_along_axis(merged_index, chosen, axis=1)
    return best_index, best_score


def candidate_text(row: dict) -> str:
    return f"{row['table_name']}. {row['work_name']}"


def rerank(
    works: list[dict],
    classifiers: list[dict],
    indexes: np.ndarray,
    bi_scores: np.ndarray,
    model: CrossEncoder,
) -> list[dict]:
    pairs: list[tuple[str, str]] = []
    owners: list[tuple[int, int]] = []
    for work_index, work in enumerate(works):
        for candidate_index, classifier_index in enumerate(indexes[work_index]):
            if int(classifier_index) < 0:
                continue
            classifier = classifiers[int(classifier_index)]
            pairs.append((work["name"], candidate_text(classifier)))
            owners.append((work_index, candidate_index))
    log(f"Кросс-энкодер: {len(pairs)} пар")
    scores = np.asarray(model.predict(pairs, batch_size=32,
                        show_progress_bar=False), dtype=np.float32)
    best: dict[int, dict] = {}
    for (work_index, candidate_index), score in zip(owners, scores):
        current = best.get(work_index)
        value = float(score)
        if current is not None and value <= current["rerank_score"]:
            continue
        classifier = classifiers[int(indexes[work_index, candidate_index])]
        best[work_index] = {
            "work_id": works[work_index]["work_id"],
            "name": works[work_index]["name"],
            "classifier_id": classifier["classifier_id"],
            "bi_score": float(bi_scores[work_index, candidate_index]),
            "rerank_score": value,
            "sphere": classifier["sphere"],
            "section": classifier["section"],
            "table_name": classifier["table_name"],
            "work_name": classifier["work_name"],
        }
    return [best[index] for index in range(len(works))]


def save_matches(rows: list[dict]) -> None:
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute("TRUNCATE work_classifier_rerank")
            cur.executemany(
                """
                INSERT INTO work_classifier_rerank (
                    work_id, classifier_id, bi_score, rerank_score,
                    sphere, section, table_name, work_name
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """,
                [
                    (
                        row["work_id"],
                        row["classifier_id"],
                        row["bi_score"],
                        row["rerank_score"],
                        row["sphere"],
                        row["section"] or None,
                        row["table_name"],
                        row["work_name"],
                    )
                    for row in rows
                ],
            )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Переранжировать нормы классификатора кросс-энкодером"
    )
    parser.add_argument(
        "--model",
        default=DEFAULT_MODEL,
        help="Кросс-энкодер Hugging Face. По умолчанию BAAI/bge-reranker-v2-m3",
    )
    parser.add_argument(
        "--limit",
        type=int,
        help="Сколько работ плана обработать. Без флага обрабатываются все",
    )
    parser.add_argument(
        "--top-k",
        type=int,
        default=TOP_K,
        help="Сколько разных норм отдать кросс-энкодеру",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.limit is not None and args.limit < 1:
        log("--limit должен быть больше 0")
        return 1
    if args.top_k < 1:
        log("--top-k должен быть больше 0")
        return 1

    works = load_works(args.limit)
    if not works:
        log("В work_vector нет записей")
        return 0
    classifiers = load_classifiers()
    if not classifiers:
        log("В work_classifier_vector нет записей")
        return 0

    log(f"Работ: {len(works)}, разных норм: {len(classifiers)}")
    indexes, bi_scores = top_indices(
        vectors_matrix(works),
        vectors_matrix(classifiers),
        args.top_k,
    )
    log(f"Загрузка {args.model}")
    model = CrossEncoder(args.model)
    chosen = rerank(works, classifiers, indexes, bi_scores, model)
    save_matches(chosen)
    for row in chosen:
        path = " / ".join(
            part for part in (
                row["sphere"], row["section"], row["table_name"], row["work_name"]
            )
            if part
        )
        print(
            f"{row['bi_score']:.3f}  {row['rerank_score']:.3f}  {row['name']}  ->  {path}"
        )
    print(f"В work_classifier_rerank записано: {len(chosen)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
