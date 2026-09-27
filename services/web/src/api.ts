export type Project = {
  id: string;
  name: string;
  customer: string | null;
  contractor: string | null;
  address: string | null;
  startDate: string | null;
  endDate: string | null;
  timezone: string;
  ingestToken: string;
  createdAt: string;
  activePlan?: Plan | null;
  latestPlan?: Plan | null;
};

export type Plan = {
  id: string;
  version: number;
  sourceFile: string;
  status: 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED';
  isActive: boolean;
  workflowId: string | null;
  lastError: string | null;
  createdAt: string;
};

export type Classifier = {
  id: string;
  sphere: string;
  collection: string;
  tableCode: string;
  tableName: string;
  workCode: string;
  workName: string;
  unit: string;
};

export type WorkRow = {
  id: string;
  name: string;
  path: string;
  position: number;
  wbs: string | null;
  isSummary: boolean;
  match?: {
    classifierId: string;
    source: 'AUTO' | 'MANUAL';
    biScore: number | null;
    rerankScore: number | null;
    classifier?: Classifier;
  } | null;
  candidates: Array<{
    id: string;
    classifierId: string;
    rank: number;
    biScore: number;
    rerankScore: number;
    classifier?: Classifier;
  }>;
};

export type DayRow = {
  id: string;
  day: string;
  status: string;
  lastManualRunAt: string | null;
  imageCount: number;
};

export type ProjectImage = {
  id: string;
  source: 'API' | 'MANUAL';
  cameraExternalId: string | null;
  capturedAt: string;
  originalName: string | null;
};

export type DetectionRun = {
  id: string;
  status: string;
  trigger: string;
  startedAt: string;
  finishedAt: string | null;
  lastError: string | null;
  frames?: DetectionFrame[];
};

export type DetectionFrame = {
  id: string;
  imageId: string;
  cameraId: string | null;
  width: number | null;
  height: number | null;
  image?: ProjectImage;
  objects: DetectionObject[];
};

export type DetectionObject = {
  id: string;
  classCode: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  detectionConfidence: number;
  detectionClass?: { code: string; title: string };
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `${response.status}`);
  }
  return response.json() as Promise<T>;
}

export const api = {
  projects: () => request<Project[]>('/api/projects'),
  createProject: (body: Partial<Project> & { name: string }) =>
    request<Project>('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  project: (id: string) => request<Project>(`/api/projects/${id}`),
  updateProject: (id: string, body: Partial<Project>) =>
    request<Project>(`/api/projects/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  rotateToken: (id: string) =>
    request<Project>(`/api/projects/${id}/ingest-token/rotate`, { method: 'POST' }),
  uploadPlan: (id: string, file: File) => {
    const data = new FormData();
    data.append('file', file);
    return request<Plan>(`/api/projects/${id}/plans`, { method: 'POST', body: data });
  },
  plans: (id: string) => request<Plan[]>(`/api/projects/${id}/plans`),
  works: (id: string, query: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') params.set(key, String(value));
    }
    return request<{ plan: Plan | null; total: number; items: WorkRow[] }>(
      `/api/projects/${id}/plans/active/works?${params}`,
    );
  },
  patchMatch: (workId: string, classifierId: string) =>
    request(`/api/works/${workId}/match`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ classifierId }),
    }),
  confirmMatches: (id: string) =>
    request<{ updated: number }>(`/api/projects/${id}/plans/active/matches/confirm`, {
      method: 'POST',
    }),
  catalog: (query: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value) params.set(key, value);
    }
    return request<{ level: string; items: Array<Record<string, unknown>> }>(
      `/api/catalog/classifier?${params}`,
    );
  },
  days: (id: string) => request<DayRow[]>(`/api/projects/${id}/days`),
  day: (id: string, day: string) =>
    request<DayRow & { images: ProjectImage[]; latestRun: DetectionRun | null }>(
      `/api/projects/${id}/days/${day}`,
    ),
  uploadImages: (id: string, day: string, files: File[], capturedAt: string[]) => {
    const data = new FormData();
    files.forEach((file) => data.append('files', file));
    capturedAt.forEach((value) => data.append('capturedAt', value));
    return request(`/api/projects/${id}/days/${day}/images`, { method: 'POST', body: data });
  },
  startDetection: (id: string, day: string) =>
    request(`/api/projects/${id}/days/${day}/detection`, { method: 'POST' }),
  detectionRun: (id: string) => request<DetectionRun>(`/api/detection-runs/${id}`),
  workflow: (id: string) => request<{ id: string; status: string; lastError: string | null }>(`/api/workflows/${id}`),
  imageFile: (id: string) => `/api/images/${id}/file`,
};

export function copyText(value: string) {
  return navigator.clipboard.writeText(value);
}
