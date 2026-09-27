DROP TABLE IF EXISTS detected_class_machine;
DROP TABLE IF EXISTS detected_classes;
DROP TABLE IF EXISTS work_work_classifier;
DROP TABLE IF EXISTS work_classifier_rerank;

CREATE TABLE detection_class (
    code TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('EQUIPMENT', 'PERSON', 'UNKNOWN')),
    normative_groups TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]
);

CREATE TABLE detection_class_machine (
    class_code TEXT NOT NULL REFERENCES detection_class (code) ON DELETE CASCADE,
    machine_id UUID NOT NULL REFERENCES machine_classifier (id) ON DELETE CASCADE,
    source TEXT NOT NULL DEFAULT 'NORMATIVE'
        CHECK (source IN ('NORMATIVE', 'MANUAL')),
    PRIMARY KEY (class_code, machine_id)
);

CREATE INDEX detection_class_machine_machine_id_idx
    ON detection_class_machine (machine_id);

CREATE TABLE work_classifier_candidate (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_id UUID NOT NULL REFERENCES work (id) ON DELETE CASCADE,
    classifier_id UUID NOT NULL REFERENCES work_classifier (id) ON DELETE CASCADE,
    rank INTEGER NOT NULL,
    bi_score DOUBLE PRECISION NOT NULL,
    rerank_score DOUBLE PRECISION NOT NULL,
    UNIQUE (work_id, rank)
);

CREATE INDEX work_classifier_candidate_classifier_id_idx
    ON work_classifier_candidate (classifier_id);

CREATE TABLE work_classifier_match (
    work_id UUID PRIMARY KEY REFERENCES work (id) ON DELETE CASCADE,
    classifier_id UUID NOT NULL REFERENCES work_classifier (id) ON DELETE RESTRICT,
    source TEXT NOT NULL CHECK (source IN ('AUTO', 'MANUAL')),
    bi_score DOUBLE PRECISION,
    rerank_score DOUBLE PRECISION,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX work_classifier_match_classifier_id_idx
    ON work_classifier_match (classifier_id);

CREATE INDEX IF NOT EXISTS work_classifier_vector_ivfflat_idx
    ON work_classifier_vector
    USING ivfflat (vector vector_cosine_ops)
    WITH (lists = 100);
