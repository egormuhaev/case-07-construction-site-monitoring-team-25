import os

import numpy as np
import psycopg
from sentence_transformers import SentenceTransformer


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


works = []

with connect() as conn:
    with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            """
            SELECT n.work_id, n.normalized_name
            FROM work_normalized n
            JOIN work w ON w.id = n.work_id
            ORDER BY w.position
            """
        )
        for row in cur.fetchall():
            works.append(row)

work_names = [
    {"id": row["work_id"], "name": row["normalized_name"]}
    for row in works
]

if not work_names:
    print("В work_normalized нет записей")
    raise SystemExit(0)

model = SentenceTransformer(
    "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2")

names = [item["name"] for item in work_names]
embeddings = np.ascontiguousarray(
    model.encode(
        names,
        convert_to_numpy=True,
        normalize_embeddings=True,
    ),
    dtype=np.float32,
)
for item, vector in zip(work_names, embeddings):
    item["vector"] = vector

with connect() as conn:
    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO work_vector (work_id, embedding_name, vector)
            VALUES (%s, %s, %s::vector)
            ON CONFLICT (work_id) DO UPDATE SET
                embedding_name = EXCLUDED.embedding_name,
                vector = EXCLUDED.vector
            """,
            [
                (item["id"], item["name"], vector_literal(item["vector"]))
                for item in work_names
            ],
        )

print(f"В work_vector добавлено: {len(work_names)} записей")
