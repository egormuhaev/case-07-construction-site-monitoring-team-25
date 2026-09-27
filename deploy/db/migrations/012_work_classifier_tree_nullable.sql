ALTER TABLE work_classifier_tree
    ALTER COLUMN classifier_id DROP NOT NULL,
    ALTER COLUMN sphere DROP NOT NULL,
    ALTER COLUMN table_name DROP NOT NULL,
    ALTER COLUMN work_name DROP NOT NULL;
