CREATE TABLE project (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    customer TEXT,
    contractor TEXT,
    address TEXT,
    start_date DATE,
    end_date DATE,
    timezone TEXT NOT NULL DEFAULT 'Europe/Moscow',
    ingest_token TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE project_plan (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES project (id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    source_file TEXT NOT NULL,
    stored_path TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'PROCESSING', 'READY', 'FAILED')),
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    workflow_id UUID REFERENCES workflows (id) ON DELETE SET NULL,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (project_id, version)
);

CREATE UNIQUE INDEX project_plan_one_active_idx
    ON project_plan (project_id)
    WHERE is_active;

ALTER TABLE work ADD COLUMN plan_id UUID REFERENCES project_plan (id) ON DELETE CASCADE;
DELETE FROM work WHERE plan_id IS NULL;
ALTER TABLE work ALTER COLUMN plan_id SET NOT NULL;
ALTER TABLE work DROP CONSTRAINT IF EXISTS work_source_file_unique_id_key;
ALTER TABLE work ADD CONSTRAINT work_plan_id_unique_id_key UNIQUE (plan_id, unique_id);
CREATE INDEX work_plan_id_idx ON work (plan_id);

CREATE TABLE project_day (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES project (id) ON DELETE CASCADE,
    day DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'COLLECTING'
        CHECK (status IN ('COLLECTING', 'DETECTING', 'DETECTED', 'FAILED')),
    last_manual_run_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (project_id, day)
);

CREATE TABLE project_image (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES project (id) ON DELETE CASCADE,
    day_id UUID NOT NULL REFERENCES project_day (id) ON DELETE CASCADE,
    source TEXT NOT NULL CHECK (source IN ('API', 'MANUAL')),
    camera_external_id TEXT,
    captured_at TIMESTAMPTZ NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    relative_path TEXT NOT NULL,
    checksum TEXT NOT NULL,
    width INTEGER,
    height INTEGER,
    original_name TEXT,
    UNIQUE (project_id, checksum)
);

CREATE INDEX project_image_day_id_idx ON project_image (day_id);
CREATE INDEX project_image_captured_at_idx ON project_image (captured_at);

CREATE TABLE detection_run (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    day_id UUID NOT NULL REFERENCES project_day (id) ON DELETE CASCADE,
    workflow_id UUID REFERENCES workflows (id) ON DELETE SET NULL,
    trigger TEXT NOT NULL CHECK (trigger IN ('MANUAL', 'SCHEDULE')),
    status TEXT NOT NULL DEFAULT 'RUNNING'
        CHECK (status IN ('RUNNING', 'COMPLETED', 'FAILED')),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    last_error TEXT
);

CREATE INDEX detection_run_day_id_idx ON detection_run (day_id);

CREATE TABLE detection_frame (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES detection_run (id) ON DELETE CASCADE,
    image_id UUID NOT NULL REFERENCES project_image (id) ON DELETE CASCADE,
    camera_id TEXT,
    captured_at TIMESTAMPTZ,
    width INTEGER,
    height INTEGER
);

CREATE INDEX detection_frame_run_id_idx ON detection_frame (run_id);

CREATE TABLE detection_object (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    frame_id UUID NOT NULL REFERENCES detection_frame (id) ON DELETE CASCADE,
    class_code TEXT NOT NULL REFERENCES detection_class (code),
    x1 DOUBLE PRECISION NOT NULL,
    y1 DOUBLE PRECISION NOT NULL,
    x2 DOUBLE PRECISION NOT NULL,
    y2 DOUBLE PRECISION NOT NULL,
    detection_confidence DOUBLE PRECISION NOT NULL,
    classification_source TEXT,
    classification_confidence DOUBLE PRECISION,
    needs_refinement BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX detection_object_frame_id_idx ON detection_object (frame_id);
CREATE INDEX detection_object_class_code_idx ON detection_object (class_code);
