CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE classifier_vector (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    classifier_id UUID NOT NULL UNIQUE REFERENCES work_classifier (id) ON DELETE CASCADE,
    vector vector(384) NOT NULL
);
