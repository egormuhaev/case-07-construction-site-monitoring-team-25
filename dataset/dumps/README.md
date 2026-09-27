# Classifier dumps

Gzip CSV snapshots of `machine_classifier`, `work_classifier`,
`work_classifier_normalized`, and `work_classifier_vector` from a live DB.

```bash
make dump-classifiers   # writes *.csv.gz here
make seed               # loads them on empty tables
```

`*.csv.gz` are gitignored (vector dump is tens of MiB). Keep a local copy after
export so `python scripts/seed.py --reload` can restore without rematch.
