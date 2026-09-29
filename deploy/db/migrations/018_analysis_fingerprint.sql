ALTER TABLE analysis_run
    ADD COLUMN input_fingerprint TEXT;

CREATE INDEX analysis_run_day_fingerprint_idx
    ON analysis_run (project_id, day, detection_run_id, input_fingerprint)
    WHERE mode = 'DAY';
