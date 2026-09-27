ALTER TABLE work_vector
    ADD COLUMN embedding_name TEXT NOT NULL DEFAULT '';

ALTER TABLE work_vector
    ALTER COLUMN embedding_name DROP DEFAULT;
