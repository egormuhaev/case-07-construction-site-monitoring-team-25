from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from uuid import uuid4

import numpy as np
import psycopg
from sentence_transformers import CrossEncoder, SentenceTransformer

from planning.normalize import normalize_names
from planning.parse import Work, parse_project
from planning.settings import Settings

StageHook = Callable[[str, dict], None]

EMBEDDING_NAME = "paraphrase-multilingual-MiniLM-L12-v2"
CLASSIFIER_BLOCK = 4096


def connect(settings: Settings) -> psycopg.Connection:
    return psycopg.connect(
        host=settings.postgres_host,
        port=settings.postgres_port,
        user=settings.postgres_user,
        password=settings.postgres_password,
        dbname=settings.postgres_db,
    )


def vector_literal(vector: np.ndarray) -> str:
    return "[" + ",".join(format(float(value), ".8g") for value in vector) + "]"


def parse_vector(value: str) -> np.ndarray:
    return np.fromstring(value.strip()[1:-1], sep=",", dtype=np.float32)


def run_plan_import(
    payload: dict,
    settings: Settings,
    data_dir: Path,
    on_stage: StageHook | None = None,
) -> dict:
    plan_id = str(payload["planId"])
    relative = str(payload["path"])
    source = (data_dir / relative).resolve()
    if not source.is_file():
        raise FileNotFoundError(relative)
    works = parse_project(source)
    if not works:
        raise ValueError("в плане нет задач")
    _checkpoint(on_stage, "parse", {"works": len(works)})

    names = normalize_names([work.name for work in works], settings)
    _checkpoint(on_stage, "normalize", {"normalized": len(names), "llm": settings.normalize_enabled})

    model = SentenceTransformer(settings.embedding_model, cache_folder=str(settings.cache_dir))
    embeddings = np.ascontiguousarray(
        model.encode(names, convert_to_numpy=True, normalize_embeddings=True),
        dtype=np.float32,
    )
    _checkpoint(on_stage, "vectorize", {"dim": int(embeddings.shape[1])})

    classifiers = load_classifiers(settings)
    if not classifiers:
        raise ValueError("классификатор работ не загружен (make seed)")
    indexes, bi_scores = top_indices(
        embeddings,
        np.ascontiguousarray(np.stack([row["vector"] for row in classifiers]), dtype=np.float32),
        settings.top_k,
    )
    _checkpoint(on_stage, "retrieve", {"classifiers": len(classifiers), "top_k": settings.top_k})

    if settings.rerank_enabled:
        reranker = CrossEncoder(settings.rerank_model, cache_folder=str(settings.cache_dir))
        matches = rerank(works, classifiers, indexes, bi_scores, reranker)
        _checkpoint(on_stage, "rerank", {"matched": len(matches), "enabled": True})
    else:
        matches = matches_from_retrieve(works, classifiers, indexes, bi_scores)
        _checkpoint(on_stage, "rerank", {"matched": len(matches), "enabled": False})

    persist(settings, plan_id, relative, works, names, embeddings, matches)
    _checkpoint(on_stage, "persist", {"planId": plan_id})
    scores = [row["rerank_score"] for row in matches]
    low = [row for row in matches if row["rerank_score"] < 0]
    return {
        "planId": plan_id,
        "works": len(works),
        "matched": len(matches),
        "low_score_count": len(low),
        "rerank_min": min(scores) if scores else None,
        "rerank_max": max(scores) if scores else None,
    }


def _checkpoint(on_stage: StageHook | None, name: str, payload: dict) -> None:
    if on_stage is not None:
        on_stage(name, payload)


def load_classifiers(settings: Settings) -> list[dict]:
    unique: dict[tuple[str, str], dict] = {}
    with connect(settings) as conn:
        with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
            cur.execute(
                """
                SELECT cv.classifier_id, cv.vector::text AS vector,
                       c.sphere, c.section, c.table_name, c.work_name
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


def top_indices(work_vectors: np.ndarray, classifier_vectors: np.ndarray, k: int) -> tuple[np.ndarray, np.ndarray]:
    count = work_vectors.shape[0]
    total = classifier_vectors.shape[0]
    k = min(k, total)
    best_index = np.full((count, k), -1, dtype=np.int64)
    best_score = np.full((count, k), -np.inf, dtype=np.float32)
    for start in range(0, total, CLASSIFIER_BLOCK):
        block = classifier_vectors[start : start + CLASSIFIER_BLOCK]
        scores = work_vectors @ block.T
        block_size = scores.shape[1]
        take = min(k, block_size)
        if block_size == take:
            local_index = np.broadcast_to(np.arange(block_size), (count, block_size))
        else:
            local_index = np.argpartition(scores, -take, axis=1)[:, -take:]
        local_score = np.take_along_axis(scores, local_index, axis=1)
        merged_score = np.concatenate([best_score, local_score], axis=1)
        merged_index = np.concatenate([best_index, local_index + start], axis=1)
        chosen = np.argpartition(merged_score, -k, axis=1)[:, -k:]
        chosen_score = np.take_along_axis(merged_score, chosen, axis=1)
        order = np.argsort(-chosen_score, axis=1)
        chosen = np.take_along_axis(chosen, order, axis=1)
        best_score = np.take_along_axis(merged_score, chosen, axis=1)
        best_index = np.take_along_axis(merged_index, chosen, axis=1)
    return best_index, best_score


def rerank(
    works: list[Work],
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
            pairs.append((work.name, f"{classifier['table_name']}. {classifier['work_name']}"))
            owners.append((work_index, candidate_index))
    scores = np.asarray(model.predict(pairs, batch_size=32, show_progress_bar=False), dtype=np.float32)
    best: dict[int, dict] = {}
    ranked: dict[int, list[dict]] = {index: [] for index in range(len(works))}
    for (work_index, candidate_index), score in zip(owners, scores):
        classifier = classifiers[int(indexes[work_index, candidate_index])]
        item = {
            "classifier_id": classifier["classifier_id"],
            "bi_score": float(bi_scores[work_index, candidate_index]),
            "rerank_score": float(score),
        }
        ranked[work_index].append(item)
        current = best.get(work_index)
        if current is None or float(score) > current["rerank_score"]:
            best[work_index] = item
    for work_index, items in ranked.items():
        items.sort(key=lambda row: row["rerank_score"], reverse=True)
        best.setdefault(work_index, {})["candidates"] = items[:50]
    return [best[index] for index in range(len(works))]


def matches_from_retrieve(
    works: list[Work],
    classifiers: list[dict],
    indexes: np.ndarray,
    bi_scores: np.ndarray,
) -> list[dict]:
    """Топ по bi-encoder без CrossEncoder: rerank_score = bi_score."""
    best: dict[int, dict] = {}
    ranked: dict[int, list[dict]] = {index: [] for index in range(len(works))}
    for work_index, _work in enumerate(works):
        for candidate_index, classifier_index in enumerate(indexes[work_index]):
            if int(classifier_index) < 0:
                continue
            classifier = classifiers[int(classifier_index)]
            score = float(bi_scores[work_index, candidate_index])
            item = {
                "classifier_id": classifier["classifier_id"],
                "bi_score": score,
                "rerank_score": score,
            }
            ranked[work_index].append(item)
            current = best.get(work_index)
            if current is None or score > current["rerank_score"]:
                best[work_index] = item
    for work_index, items in ranked.items():
        items.sort(key=lambda row: row["rerank_score"], reverse=True)
        best.setdefault(work_index, {})["candidates"] = items[:50]
    return [best[index] for index in range(len(works))]


def persist(
    settings: Settings,
    plan_id: str,
    source_file: str,
    works: list[Work],
    names: list[str],
    embeddings: np.ndarray,
    matches: list[dict],
) -> None:
    with connect(settings) as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM work WHERE plan_id = %s", (plan_id,))
            work_ids: list[str] = []
            for work in works:
                work_id = str(uuid4())
                work_ids.append(work_id)
                cur.execute(
                    """
                    INSERT INTO work (
                        id, plan_id, source_file, unique_id, task_id, parent_unique_id,
                        position, outline_level, wbs, name, path, is_summary, is_milestone,
                        start_at, finish_at, duration_hours, percent_complete, work_hours,
                        predecessors, resources, guid
                    ) VALUES (
                        %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                        %s, %s, %s, %s, %s, %s, %s, %s
                    )
                    """,
                    (
                        work_id,
                        plan_id,
                        source_file,
                        work.unique_id,
                        work.task_id,
                        work.parent_unique_id,
                        work.position,
                        work.outline_level,
                        work.wbs,
                        work.name,
                        work.path,
                        work.is_summary,
                        work.is_milestone,
                        work.start_at,
                        work.finish_at,
                        work.duration_hours,
                        work.percent_complete,
                        work.work_hours,
                        work.predecessors,
                        work.resources,
                        work.guid,
                    ),
                )
            for work_id, name, vector in zip(work_ids, names, embeddings):
                cur.execute(
                    """
                    INSERT INTO work_normalized (work_id, normalized_name)
                    VALUES (%s, %s)
                    """,
                    (work_id, name),
                )
                cur.execute(
                    """
                    INSERT INTO work_vector (work_id, embedding_name, vector)
                    VALUES (%s, %s, %s::vector)
                    """,
                    (work_id, EMBEDDING_NAME, vector_literal(vector)),
                )
            for work_index, work_id in enumerate(work_ids):
                match = matches[work_index]
                classifier_id = match.get("classifier_id")
                if not classifier_id:
                    continue
                cur.execute(
                    """
                    INSERT INTO work_classifier_match (
                        work_id, classifier_id, source, bi_score, rerank_score, updated_at
                    ) VALUES (%s, %s, 'AUTO', %s, %s, NOW())
                    """,
                    (work_id, classifier_id, match.get("bi_score"), match.get("rerank_score")),
                )
                for rank, candidate in enumerate(match.get("candidates") or [], start=1):
                    cur.execute(
                        """
                        INSERT INTO work_classifier_candidate (
                            work_id, classifier_id, rank, bi_score, rerank_score
                        ) VALUES (%s, %s, %s, %s, %s)
                        """,
                        (
                            work_id,
                            candidate["classifier_id"],
                            rank,
                            candidate["bi_score"],
                            candidate["rerank_score"],
                        ),
                    )
        conn.commit()
