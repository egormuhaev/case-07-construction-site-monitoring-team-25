-- Объём/длительность на норме, смена на проекте, новые типы сигналов.

ALTER TABLE work_classifier_match
    ADD COLUMN IF NOT EXISTS duration_days DOUBLE PRECISION;

ALTER TABLE project
    ADD COLUMN IF NOT EXISTS shift_start TIME,
    ADD COLUMN IF NOT EXISTS shift_end TIME;

ALTER TABLE analysis_finding
    DROP CONSTRAINT IF EXISTS analysis_finding_type_check;

ALTER TABLE analysis_finding
    ADD CONSTRAINT analysis_finding_type_check CHECK (
        type IN (
            'NO_ACTIVITY',
            'LATE_START',
            'REPEATED_GAP',
            'UNEXPECTED_GROUP',
            'INSUFFICIENT_DATA',
            'NO_OBSERVATION',
            'NO_EXPECTATION_SOURCE',
            'PERSISTENT_GAP',
            'LOW_INTENSITY',
            'CUMULATIVE_LAG'
        )
    );
