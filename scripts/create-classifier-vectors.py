import os

import numpy as np
import psycopg
from sentence_transformers import SentenceTransformer

ROWS_LIMIT = 10

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


# получить из БД классификатор

classifiers = []

with connect() as conn:
    with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            "SELECT * FROM work_classifier LIMIT %s",
            (ROWS_LIMIT,),
        )
        for row in cur.fetchall():
            classifiers.append(row)

# векторизировать названия работ

classsifier_names = []

for row in classifiers:
    id = row["id"]
    sphere = row["sphere"]
    collection = row["collection"]
    section = row["section"]
    subsection = row["subsection"]
    table_name = row["table_name"]
    work_name = row["work_name"]

    parts = [row["sphere"], row["collection"], row["section"],
             row["subsection"], row["table_name"], row["work_name"]]
    name = " -> ".join(part for part in parts if part)

    classsifier_names.append({"id": id, "name": name})

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
            INSERT INTO classifier_vector (classifier_id, vector)
            VALUES (%s, %s::vector)
            ON CONFLICT (classifier_id) DO UPDATE SET vector = EXCLUDED.vector
            """,
            [
                (item["id"], vector_literal(item["vector"]))
                for item in classsifier_names
            ],
        )

print(f"записано: {len(classsifier_names)}")
