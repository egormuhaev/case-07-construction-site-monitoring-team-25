CREATE TABLE analysis_run (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES project (id) ON DELETE CASCADE,
    mode TEXT NOT NULL CHECK (mode IN ('DAY', 'PERIOD')),
    day DATE,
    date_from DATE,
    date_to DATE,
    plan_id UUID REFERENCES project_plan (id) ON DELETE SET NULL,
    detection_run_id UUID REFERENCES detection_run (id) ON DELETE SET NULL,
    trigger TEXT NOT NULL CHECK (trigger IN ('MANUAL', 'SCHEDULE', 'AUTO')),
    status TEXT NOT NULL DEFAULT 'RUNNING'
        CHECK (status IN ('RUNNING', 'COMPLETED', 'FAILED')),
    workflow_id UUID REFERENCES workflows (id) ON DELETE SET NULL,
    observability TEXT CHECK (observability IN ('GOOD', 'PARTIAL', 'BLIND')),
    summary JSONB NOT NULL DEFAULT '{}'::jsonb,
    last_error TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    CONSTRAINT analysis_run_day_mode_chk CHECK (
        (mode = 'DAY' AND day IS NOT NULL AND date_from IS NULL AND date_to IS NULL)
        OR (mode = 'PERIOD' AND day IS NULL AND date_from IS NOT NULL AND date_to IS NOT NULL)
    )
);

CREATE INDEX analysis_run_project_day_idx ON analysis_run (project_id, day);
CREATE INDEX analysis_run_project_period_idx ON analysis_run (project_id, date_from, date_to);
CREATE INDEX analysis_run_workflow_id_idx ON analysis_run (workflow_id);

CREATE TABLE analysis_day_class (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES analysis_run (id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES project (id) ON DELETE CASCADE,
    day DATE NOT NULL,
    class_code TEXT NOT NULL REFERENCES detection_class (code) ON DELETE RESTRICT,
    expected BOOLEAN NOT NULL DEFAULT FALSE,
    expected_work_count INTEGER NOT NULL DEFAULT 0,
    expected_confidence DOUBLE PRECISION,
    expected_works JSONB NOT NULL DEFAULT '[]'::jsonb,
    present BOOLEAN NOT NULL DEFAULT FALSE,
    frame_count INTEGER NOT NULL DEFAULT 0,
    object_count INTEGER NOT NULL DEFAULT 0,
    camera_count INTEGER NOT NULL DEFAULT 0,
    hour_span INTEGER NOT NULL DEFAULT 0,
    max_confidence DOUBLE PRECISION,
    median_confidence DOUBLE PRECISION,
    needs_refinement_ratio DOUBLE PRECISION,
    verdict TEXT NOT NULL CHECK (
        verdict IN (
            'CONFIRMED',
            'GAP',
            'UNEXPECTED',
            'NOT_EXPECTED',
            'INSUFFICIENT_DATA'
        )
    ),
    UNIQUE (run_id, class_code)
);

CREATE INDEX analysis_day_class_project_day_idx
    ON analysis_day_class (project_id, day);
CREATE INDEX analysis_day_class_class_code_idx
    ON analysis_day_class (class_code);

CREATE TABLE analysis_finding (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES analysis_run (id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES project (id) ON DELETE CASCADE,
    class_code TEXT REFERENCES detection_class (code) ON DELETE SET NULL,
    day DATE,
    date_from DATE,
    date_to DATE,
    type TEXT NOT NULL CHECK (
        type IN (
            'NO_ACTIVITY',
            'LATE_START',
            'REPEATED_GAP',
            'UNEXPECTED_GROUP',
            'INSUFFICIENT_DATA',
            'NO_OBSERVATION',
            'NO_EXPECTATION_SOURCE',
            'PERSISTENT_GAP'
        )
    ),
    severity TEXT NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH')),
    deviation DOUBLE PRECISION NOT NULL DEFAULT 0,
    confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'POTENTIAL'
        CHECK (status IN ('POTENTIAL', 'CONFIRMED', 'DISMISSED')),
    title TEXT NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX analysis_finding_project_status_idx
    ON analysis_finding (project_id, status);
CREATE INDEX analysis_finding_run_id_idx
    ON analysis_finding (run_id);
CREATE INDEX analysis_finding_project_day_idx
    ON analysis_finding (project_id, day);
