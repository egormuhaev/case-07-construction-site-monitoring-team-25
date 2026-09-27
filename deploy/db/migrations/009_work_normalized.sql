CREATE TABLE work_normalized (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_id UUID NOT NULL UNIQUE REFERENCES work (id) ON DELETE CASCADE,
    normalized_name TEXT NOT NULL -- действие, объект и материал
);
