CREATE TABLE work_work_classifier (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_id UUID NOT NULL UNIQUE REFERENCES work (id) ON DELETE CASCADE,
    classifier_id UUID NOT NULL REFERENCES work_classifier (id) ON DELETE CASCADE,
    score DOUBLE PRECISION NOT NULL, -- близость векторов, больше — ближе

    -- название и данные работы из классификатора
    classifier_work_name TEXT NOT NULL,
    classifier_sphere TEXT NOT NULL,
    classifier_document TEXT NOT NULL,
    classifier_collection TEXT NOT NULL,
    classifier_department TEXT,
    classifier_section TEXT,
    classifier_subsection TEXT,
    classifier_table_code TEXT NOT NULL,
    classifier_table_name TEXT NOT NULL,
    classifier_work_code TEXT NOT NULL,
    classifier_unit TEXT NOT NULL,
    classifier_workers_hours DOUBLE PRECISION,
    classifier_machinists_hours DOUBLE PRECISION,
    classifier_commissioning_hours DOUBLE PRECISION,
    classifier_labor_hours DOUBLE PRECISION,
    classifier_machines_hours DOUBLE PRECISION,
    classifier_machine_id UUID REFERENCES machine_classifier (id) ON DELETE SET NULL,
    classifier_machine_hours DOUBLE PRECISION,

    -- даты и информация о работе из календарного плана
    plan_source_file TEXT NOT NULL,
    plan_unique_id INTEGER NOT NULL,
    plan_task_id INTEGER,
    plan_parent_unique_id INTEGER,
    plan_position INTEGER NOT NULL,
    plan_outline_level INTEGER NOT NULL,
    plan_wbs TEXT,
    plan_name TEXT NOT NULL,
    plan_path TEXT NOT NULL,
    plan_is_summary BOOLEAN NOT NULL,
    plan_is_milestone BOOLEAN NOT NULL,
    plan_start_at TIMESTAMP,
    plan_finish_at TIMESTAMP,
    plan_duration_hours DOUBLE PRECISION,
    plan_percent_complete DOUBLE PRECISION,
    plan_work_hours DOUBLE PRECISION,
    plan_predecessors TEXT,
    plan_resources TEXT,
    plan_guid TEXT
);

CREATE INDEX work_work_classifier_classifier_id_idx
    ON work_work_classifier (classifier_id);
