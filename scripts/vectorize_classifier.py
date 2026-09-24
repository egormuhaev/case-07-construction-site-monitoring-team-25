import os
import re

import numpy as np
import psycopg
from sentence_transformers import SentenceTransformer

ROWS_LIMIT = 10
# От конкретной работы к общему разделу: в вектор попадает сначала суть.
NAME_LEVELS = (
    "work_name",
    "table_name",
    "subsection",
    "section",
    "department",
    "collection",
    "sphere",
)
STOP_WORDS = {
    "и", "в", "во", "на", "для", "по", "с", "со", "из", "от", "или",
    "а", "к", "ко", "о", "об", "при", "до", "не",
}
WORD_RE = re.compile(r"[0-9a-zа-яё-]+", re.IGNORECASE)
# «, количество лифтов в подъезде: 2» — параметр нормы, не суть работы.
PARAM_RE = re.compile(r",\s*[^,:]+:\s*[^,]+")
CODE_RE = re.compile(
    r"\b[А-ЯA-Z]{1,8}[а-яa-z]{0,6}\s*\d{2}(?:-\d{2})+\b")

# получить данные из таблицы


def connect() -> psycopg.Connection:
    return psycopg.connect(
        host=os.environ.get("POSTGRES_HOST", "localhost"),
        port=os.environ.get("POSTGRES_PORT", "5432"),
        user=os.environ.get("POSTGRES_USER", "admin"),
        password=os.environ.get("POSTGRES_PASSWORD", "admin_password"),
        dbname=os.environ.get("POSTGRES_DB", "monitoring_db"),
    )


def vector_literal(vector: np.ndarray) -> str:
    return "[" + ",".join(format(float(value), ".8g") for value in vector) + "]"


def meaningful_words(text: str) -> set[str]:
    return {
        word.lower().replace("ё", "е")
        for word in WORD_RE.findall(text)
        if len(word) > 2 and word.lower().replace("ё", "е") not in STOP_WORDS
    }


def clean_part(text: str) -> str:
    text = PARAM_RE.sub("", text)
    text = CODE_RE.sub("", text)
    return " ".join(text.split())


def canonical_name(row: dict) -> str:
    covered: set[str] = set()
    chosen: list[str] = []
    for key in NAME_LEVELS:
        raw = row.get(key)
        if not raw:
            continue
        part = clean_part(str(raw))
        fresh = meaningful_words(part) - covered
        if not part or not fresh:
            continue
        chosen.append(part)
        covered.update(meaningful_words(part))
    return ". ".join(chosen)


# получить из БД классификатор

classifiers = []

with connect() as conn:
    with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            "SELECT * FROM work_classifier"
        )
        for row in cur.fetchall():
            classifiers.append(row)

# векторизировать названия работ

classsifier_names = []

for row in classifiers:
    name = canonical_name(row)
    # print(name)
    classsifier_names.append({"id": row["id"], "name": name})

model = SentenceTransformer(
    "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2")

names = [item["name"] for item in classsifier_names]
embeddings = np.ascontiguousarray(
    model.encode(
        names,
        convert_to_numpy=True,
        normalize_embeddings=True,
    ),
    dtype=np.float32,
)
for item, vector in zip(classsifier_names, embeddings):
    item["vector"] = vector

with connect() as conn:
    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO work_classifier_vector (classifier_id, vector)
            VALUES (%s, %s::vector)
            ON CONFLICT (classifier_id) DO UPDATE SET vector = EXCLUDED.vector
            """,
            [
                (item["id"], vector_literal(item["vector"]))
                for item in classsifier_names
            ],
        )

print(f"В work_classifier_vector добавлено: {len(classsifier_names)} записей")
