CREATE TABLE work_vector (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_file TEXT NOT NULL,          -- файл календарного плана
    unique_id INTEGER NOT NULL,         -- Unique ID задачи в MS Project
    task_id INTEGER,                    -- ID задачи
    parent_unique_id INTEGER,           -- Unique ID родительской задачи
    position INTEGER NOT NULL,          -- порядок в плане
    outline_level INTEGER NOT NULL,     -- уровень иерархии
    wbs TEXT,                           -- код СДР
    name TEXT NOT NULL,                 -- название работы
    path TEXT NOT NULL,                 -- путь от корня плана
    is_summary BOOLEAN NOT NULL,        -- суммарная задача
    is_milestone BOOLEAN NOT NULL,      -- веха
    start_at TIMESTAMP,                 -- начало
    finish_at TIMESTAMP,                -- окончание
    duration_hours DOUBLE PRECISION,    -- длительность, ч
    percent_complete DOUBLE PRECISION,  -- процент выполнения
    work_hours DOUBLE PRECISION,        -- трудозатраты, ч
    predecessors TEXT,                  -- предшественники
    resources TEXT,                     -- назначенные ресурсы
    guid TEXT,
    vector vector(384),                 -- эмбеддинг названия, заполняется отдельно
    UNIQUE (source_file, unique_id)
);

CREATE INDEX work_vector_source_file_idx ON work_vector (source_file);
