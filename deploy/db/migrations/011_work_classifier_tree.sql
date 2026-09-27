CREATE TABLE work_classifier_tree (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_id UUID NOT NULL UNIQUE REFERENCES work (id) ON DELETE CASCADE,
    classifier_id UUID NOT NULL REFERENCES work_classifier (id) ON DELETE CASCADE,
    sphere TEXT NOT NULL,
    section TEXT,
    table_name TEXT NOT NULL,
    work_name TEXT NOT NULL
);
