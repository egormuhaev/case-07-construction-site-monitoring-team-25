-- Несколько норм ГЭСН на одну работу и необязательный объём.
ALTER TABLE work_classifier_match DROP CONSTRAINT work_classifier_match_pkey;

ALTER TABLE work_classifier_match
    ADD COLUMN id UUID NOT NULL DEFAULT gen_random_uuid(),
    ADD COLUMN volume DOUBLE PRECISION;

ALTER TABLE work_classifier_match
    ADD PRIMARY KEY (id);

ALTER TABLE work_classifier_match
    ADD CONSTRAINT work_classifier_match_work_classifier_uid UNIQUE (work_id, classifier_id);

CREATE INDEX IF NOT EXISTS work_classifier_match_work_id_idx
    ON work_classifier_match (work_id);
