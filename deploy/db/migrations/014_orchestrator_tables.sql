CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE workflows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status TEXT NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED')),
    pipeline TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    current_step TEXT,
    result JSONB,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE workflow_steps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID NOT NULL REFERENCES workflows (id) ON DELETE CASCADE,
    step_index INTEGER NOT NULL,
    name TEXT NOT NULL,
    service_name TEXT NOT NULL,
    service_url TEXT NOT NULL,
    poll_interval_ms INTEGER NOT NULL DEFAULT 5000,
    status TEXT NOT NULL DEFAULT 'PENDING'
        CHECK (status IN (
            'PENDING',
            'SUBMITTING',
            'PROCESSING',
            'WAITING_FOR_SERVICE',
            'COMPLETED',
            'FAILED'
        )),
    attempts_made INTEGER NOT NULL DEFAULT 0,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    execution_attempt INTEGER NOT NULL DEFAULT 1,
    external_job_id TEXT,
    next_attempt_at TIMESTAMPTZ,
    input JSONB,
    output JSONB,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (workflow_id, step_index)
);

CREATE INDEX workflow_steps_status_next_attempt_idx
    ON workflow_steps (status, next_attempt_at);
