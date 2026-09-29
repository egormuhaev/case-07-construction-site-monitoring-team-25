export type Project = {
  id: string;
  name: string;
  customer: string | null;
  contractor: string | null;
  address: string | null;
  objectType: string | null;
  contractNumber: string | null;
  notes: string | null;
  startDate: string | null;
  endDate: string | null;
  timezone: string;
  shiftStart: string | null;
  shiftEnd: string | null;
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

export type WorkMatch = {
  id?: string;
  classifierId: string;
  source: 'AUTO' | 'MANUAL';
  biScore: number | null;
  rerankScore: number | null;
  volume?: number | null;
  durationDays?: number | null;
  classifier?: Classifier;
};

export type WorkRow = {
  id: string;
  name: string;
  path: string;
  position: number;
  wbs: string | null;
  isSummary: boolean;
  isMilestone?: boolean;
  startAt: string | null;
  finishAt: string | null;
  durationHours?: number | null;
  outlineLevel?: number;
  matches?: WorkMatch[];
  match?: WorkMatch | null;
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

export type AnalysisRun = {
  id: string;
  projectId: string;
  mode: 'DAY' | 'PERIOD';
  day: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  planId: string | null;
  detectionRunId: string | null;
  inputFingerprint?: string | null;
  trigger: 'MANUAL' | 'SCHEDULE' | 'AUTO';
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  workflowId: string | null;
  observability: 'GOOD' | 'PARTIAL' | 'BLIND' | null;
  summary: Record<string, unknown>;
  lastError: string | null;
  startedAt: string;
  finishedAt: string | null;
  classes?: AnalysisDayClass[];
  findings?: AnalysisFinding[];
  classTitles?: Record<string, string>;
  current?: boolean;
  staleReason?: string | null;
};

export type DayAnalysisStatus = Partial<AnalysisRun> & {
  current?: boolean;
  staleReason?: string | null;
};

export type DayAnalysisStartResult = {
  reused: boolean;
  run: AnalysisRun;
  workflowId: string | null;
};

export type AnalysisDayClass = {
  id: string;
  runId: string;
  day: string;
  classCode: string;
  classTitle?: string;
  expected: boolean;
  expectedWorkCount: number;
  expectedConfidence: number | null;
  expectedWorks: Array<Record<string, unknown>>;
  present: boolean;
  frameCount: number;
  objectCount: number;
  cameraCount: number;
  hourSpan: number;
  maxConfidence: number | null;
  medianConfidence: number | null;
  needsRefinementRatio: number | null;
  verdict: 'CONFIRMED' | 'GAP' | 'UNEXPECTED' | 'NOT_EXPECTED' | 'INSUFFICIENT_DATA';
};

export type AnalysisFinding = {
  id: string;
  runId: string;
  projectId: string;
  classCode: string | null;
  day: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  type: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  deviation: number;
  confidence: number;
  status: 'POTENTIAL' | 'CONFIRMED' | 'DISMISSED';
  title: string;
  details: Record<string, unknown>;
  createdAt: string;
};

export type AnalysisFindingDetail = {
  finding: AnalysisFinding;
  dayClass: AnalysisDayClass | null;
  run: {
    id: string;
    projectId: string;
    mode: 'DAY' | 'PERIOD';
    day: string | null;
    dateFrom: string | null;
    dateTo: string | null;
    detectionRunId: string | null;
    observability: AnalysisRun['observability'];
    status: AnalysisRun['status'];
    summary: Record<string, unknown>;
  };
};

export type AnalysisHeatmap = {
  days: Array<{
    day: string | null;
    runId: string;
    observability: string | null;
    summary: Record<string, unknown>;
  }>;
  classes: string[];
  classTitles?: Record<string, string>;
  cells: Array<{
    day: string;
    classCode: string;
    verdict: string;
    expected: boolean;
    present: boolean;
    objectCount: number;
  }>;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `${response.status}`);
  }
  if (response.status === 204) {
    return undefined as T;
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
  deleteProject: (id: string) =>
    request<{ ok: boolean }>(`/api/projects/${id}`, { method: 'DELETE' }),
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
  replaceMatches: (
    workId: string,
    assignments: Array<{
      classifierId: string;
      volume?: number | null;
      durationDays?: number | null;
    }>,
  ) =>
    request<WorkMatch[]>(`/api/works/${workId}/match`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignments }),
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
  workflow: (id: string) =>
    request<{ id: string; status: string; lastError: string | null }>(`/api/workflows/${id}`),
  imageFile: (id: string) => `/api/images/${id}/file`,
  dayAnalysis: (id: string, day: string) =>
    request<DayAnalysisStatus | null>(`/api/projects/${id}/days/${day}/analysis`),
  startDayAnalysis: (id: string, day: string) =>
    request<DayAnalysisStartResult>(`/api/projects/${id}/days/${day}/analysis`, {
      method: 'POST',
    }),
  startPeriodAnalysis: (id: string, from: string, to: string) =>
    request<{ run: AnalysisRun; workflowId: string }>(`/api/projects/${id}/analysis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to }),
    }),
  analysisRun: (runId: string) => request<AnalysisRun>(`/api/analysis-runs/${runId}`),
  analysisHeatmap: (id: string, from: string, to: string) => {
    const params = new URLSearchParams({ from, to });
    return request<AnalysisHeatmap>(`/api/projects/${id}/analysis/heatmap?${params}`);
  },
  findings: (id: string, query: Record<string, string | undefined> = {}) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value) params.set(key, value);
    }
    const suffix = params.toString() ? `?${params}` : '';
    return request<AnalysisFinding[]>(`/api/projects/${id}/findings${suffix}`);
  },
  finding: (findingId: string) =>
    request<AnalysisFindingDetail>(`/api/findings/${findingId}`),
  patchFinding: (findingId: string, status: AnalysisFinding['status']) =>
    request<AnalysisFinding>(`/api/findings/${findingId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    }),
};

export function copyText(value: string) {
  return navigator.clipboard.writeText(value);
}

export function formatInTimeZone(iso: string, timeZone?: string | null) {
  try {
    return new Date(iso).toLocaleString('ru-RU', timeZone ? { timeZone } : undefined);
  } catch {
    return new Date(iso).toLocaleString('ru-RU');
  }
}

export function formatDateShort(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('ru-RU');
}
