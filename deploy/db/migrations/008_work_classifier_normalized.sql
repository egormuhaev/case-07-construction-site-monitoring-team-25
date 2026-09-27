CREATE TABLE work_classifier_normalized (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_classifier_id UUID NOT NULL UNIQUE REFERENCES work_classifier (id) ON DELETE CASCADE,
    work_normalized_name TEXT NOT NULL -- действие, объект и материал
);
