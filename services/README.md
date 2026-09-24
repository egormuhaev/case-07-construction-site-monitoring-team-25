# Services

Пакеты лежат в `services/` и ставятся из корня репозитория:

```
pip install -e .
```

## detecting

Группировка кадров по ракурсу (DINOv2 + кластеризация).

```
python -m detecting
```

Датасет: `dataset/test-dataset`. Веса: `weights/dinov2_small`.
