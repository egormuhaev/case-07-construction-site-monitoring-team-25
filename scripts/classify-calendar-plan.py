from sentence_transformers import SentenceTransformer
import faiss
import importlib.util
import os
import subprocess
import sys
from pathlib import Path

import numpy as np


def _share_openmp_with_faiss() -> None:
    """Point faiss at torch's libomp before either library is imported.

    faiss-cpu and torch each ship their own libomp. On macOS the second
    runtime aborts the process (OMP Error #15) as soon as the index is used.
    """
    if sys.platform != "darwin":
        return

    torch_spec = importlib.util.find_spec("torch")
    faiss_spec = importlib.util.find_spec("faiss")
    if (
        torch_spec is None
        or not torch_spec.origin
        or faiss_spec is None
        or not faiss_spec.submodule_search_locations
    ):
        return

    torch_omp = Path(torch_spec.origin).resolve().parent / \
        "lib" / "libomp.dylib"
    faiss_dir = Path(
        next(iter(faiss_spec.submodule_search_locations))).resolve()
    if not torch_omp.is_file():
        return

    desired = f"@loader_path/{Path(os.path.relpath(torch_omp, faiss_dir)).as_posix()}"
    for binary in faiss_dir.iterdir():
        if binary.suffix not in {".so", ".dylib"} or not binary.is_file():
            continue
        linked = subprocess.check_output(
            ["otool", "-L", str(binary)], text=True)
        for line in linked.splitlines()[1:]:
            lib = line.strip().split(" (compatibility", 1)[0].strip()
            if not lib.endswith("libomp.dylib") or lib == desired:
                continue
            subprocess.check_call(
                ["install_name_tool", "-change", lib, desired, str(binary)]
            )
            subprocess.check_call(["codesign", "-s", "-", "-f", str(binary)])
            break


_share_openmp_with_faiss()

# получение векторов классификатора из таблицы classifier_vector

works_classifier = [
    {
        "id": 1,
        "name": "Разработка фронтенда"
    },
    {
        "id": 2,
        "name": "Разработка бэкенда"
    },
    {
        "id": 3,
        "name": "Тестирование ПО"
    },
    {
        "id": 4,
        "name": "Администрирование баз данных"
    },
    {
        "id": 5,
        "name": "Проектирование архитектуры"
    },
    {
        "id": 6,
        "name": "Техническая поддержка пользователей"
    },
    {
        "id": 7,
        "name": "Настройка CI/CD"
    },
    {
        "id": 8,
        "name": "Разработка мобильных приложений"
    },
    {
        "id": 9,
        "name": "Аналитика данных"
    },
    {
        "id": 10,
        "name": "Дизайн пользовательских интерфейсов"
    }
]

classifier_texts = [item["name"] for item in works_classifier]

model = SentenceTransformer(
    "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2")

classifier_embeddings = np.ascontiguousarray(
    model.encode(classifier_texts, convert_to_numpy=True,
                 normalize_embeddings=True),
    dtype=np.float32,
)

# получение векторов работ из таблицы work_vector

# для каждой записи из work_vector найти запись с похожим вектором из classifier_vector, результат записать в новую таблицу

works_list = [
    "Фронтенд-разработка",
    "Разработка frontend",
    "Бэкенд разработка",
    "Backend developer",
    "Тестирование программного обеспечения",
    "QA-инженер",
    "Админ баз данных",
    "Администрирование БД",
    "Архитектор ПО",
    "Проектирование архитектуры системы",
    "Техподдержка пользователей",
    "Support инженеров",
    "Настройка CI / CD",
    "DevOps: пайплайны и деплой",
    "Разработка мобильных приложений под iOS и Android",
    "Мобильная разработка",
    "Анализ данных",
    "Data analyst",
    "Дизайн интерфейсов",
    "UI/UX дизайн",
    "Системное администрирование",
    "Маркетинг в интернете",
    "Продажи B2B",
    "Бухгалтерский учёт"
]

input_embeddings = np.ascontiguousarray(
    model.encode(
        works_list,
        convert_to_numpy=True,
        normalize_embeddings=True,
        batch_size=2,
        show_progress_bar=False,
    ),
    dtype=np.float32,
)

dim = classifier_embeddings.shape[1]
index = faiss.IndexHNSWFlat(dim, 16, faiss.METRIC_INNER_PRODUCT)
index.hnsw.efConstruction = 40
index.add(classifier_embeddings)
index.hnsw.efSearch = 20
distances, neighbors = index.search(input_embeddings, 1)

THRESHOLD = 0.75

mapping = []
for i, job_name in enumerate(works_list):
    best_idx = int(neighbors[i, 0])
    best_score = float(distances[i, 0])
    matched = best_idx >= 0 and best_score >= THRESHOLD

    mapping.append({
        "из списка": job_name,
        "из классификатора": works_classifier[best_idx]["name"] if matched else None,
        "id": works_classifier[best_idx]["id"] if matched else None,
        "score": best_score,
    })

for row in mapping:
    print(row)
