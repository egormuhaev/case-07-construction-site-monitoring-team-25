import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Button,
  Card,
  Flex,
  Modal,
  Table,
  Text,
  type TableColumnConfig,
} from '@gravity-ui/uikit';
import {
  classDisplayName,
  completenessWarningText,
  formatExpectedDaily,
  FINDING_BUTTON_COPY,
  type CompletenessSummary,
} from '../analysisCopy';
import {
  api,
  type AnalysisDayClass,
  type AnalysisDetection,
  type AnalysisFinding,
} from '../api';
import { FindingActions } from '../components/FindingActions';
import { QueryState } from '../components/QueryState';
import { StatusLabel } from '../components/StatusLabel';
import { useMutationToast } from '../hooks/useMutationToast';

type PlanWork = Record<string, unknown>;

type StageGroup = {
  key: string;
  label: string;
  works: PlanWork[];
};

function stageLabel(work: PlanWork): string | null {
  const name = work.stageName ? String(work.stageName) : '';
  if (!name) return null;
  const wbs = work.stageWbs ? String(work.stageWbs) : '';
  return wbs ? `${name} (${wbs})` : name;
}

function stagesFromWorks(works: PlanWork[]): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const work of works) {
    const label = stageLabel(work);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
  }
  return labels;
}

function classifierLabel(work: PlanWork): string | null {
  const name = work.classifierName ? String(work.classifierName).trim() : '';
  return name || null;
}

function workChainLine(work: PlanWork, equipmentTitle?: string): string {
  const parts: string[] = [];
  const stage = stageLabel(work);
  if (stage) parts.push(stage);
  const planName = work.name ? String(work.name) : '';
  if (planName) parts.push(planName);
  const classifier = classifierLabel(work);
  if (classifier && classifier !== planName) parts.push(classifier);
  if (equipmentTitle) parts.push(equipmentTitle);
  return parts.join(' · ') || '—';
}

function workVolumeHint(work: PlanWork): string | null {
  const bits: string[] = [];
  if (work.volume != null && work.volume !== '') {
    bits.push(`${work.volume}${work.unit ? ` ${work.unit}` : ''}`);
  }
  if (work.durationDays != null && work.durationDays !== '') {
    bits.push(`${work.durationDays} дн.`);
  }
  if (work.expectedDaily != null && work.expectedDaily !== '') {
    const daily = formatExpectedDaily(work.expectedDaily, work.unit);
    if (daily) bits.push(`на день ~ ${daily}`);
  }
  return bits.length ? bits.join(' · ') : null;
}

function unmappedReasonLabel(reason: unknown): string {
  switch (String(reason)) {
    case 'NO_MATCH':
      return 'нет сопоставления с классификатором';
    case 'NO_MACHINE':
      return 'нет машины в классификаторе';
    case 'NO_DETECTION_LINK':
      return 'нет класса детекции';
    case 'UNKNOWN_CLASS':
      return 'класс детекции неизвестен';
    default:
      return 'не удалось вывести технику';
  }
}

function classExpectedDaily(row: AnalysisDayClass): string | null {
  const works = row.expectedWorks ?? [];
  let total = 0;
  let has = false;
  let unit: unknown;
  for (const work of works) {
    const daily = work.expectedDaily;
    if (daily == null || daily === '') continue;
    const num = Number(daily);
    if (!Number.isFinite(num)) continue;
    total += num;
    has = true;
    if (unit == null) unit = work.unit;
  }
  if (!has) return null;
  return formatExpectedDaily(total, unit);
}

function collectPlanWorks(
  classes: AnalysisDayClass[],
  unmapped: PlanWork[],
): PlanWork[] {
  const byId = new Map<string, PlanWork>();
  for (const row of classes) {
    if (!row.expected) continue;
    for (const work of row.expectedWorks ?? []) {
      const id = String(work.workId ?? '');
      if (!id || byId.has(id)) continue;
      byId.set(id, { ...work, _equipmentTitle: classDisplayName(row.classCode, null, row.classTitle) });
    }
  }
  for (const work of unmapped) {
    const id = String(work.workId ?? '');
    if (!id || byId.has(id)) continue;
    byId.set(id, work);
  }
  return [...byId.values()];
}

function groupWorksByStage(works: PlanWork[]): StageGroup[] {
  const map = new Map<string, StageGroup>();
  for (const work of works) {
    const label = stageLabel(work) ?? 'Этап не указан';
    const key =
      work.stageUniqueId != null
        ? `id:${work.stageUniqueId}`
        : `label:${label}`;
    const group = map.get(key) ?? { key, label, works: [] };
    group.works.push(work);
    map.set(key, group);
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label, 'ru'));
}

export default function AnalysisReportPage() {
  const { projectId = '', day = '', runId = '' } = useParams();
  const navigate = useNavigate();
  const toast = useMutationToast();
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState<AnalysisDetection | null>(null);

  const project = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.project(projectId),
    enabled: Boolean(projectId),
  });

  const report = useQuery({
    queryKey: ['analysis-run', runId],
    queryFn: () => api.analysisRun(runId),
    enabled: Boolean(runId),
    refetchInterval: (query) => (query.state.data?.status === 'RUNNING' ? 3000 : false),
  });

  const periodFrom =
    project.data?.startDate ||
    (day ? new Date(new Date(day).getTime() - 30 * 86400000).toISOString().slice(0, 10) : '');
  const periodTo = day || report.data?.day || '';

  const heatmap = useQuery({
    queryKey: ['analysis-heatmap', projectId, periodFrom, periodTo],
    queryFn: () => api.analysisHeatmap(projectId, periodFrom, periodTo),
    enabled: Boolean(projectId && periodFrom && periodTo && periodFrom <= periodTo),
  });

  const patchFinding = useMutation({
    mutationFn: ({ id, next }: { id: string; next: AnalysisFinding['status'] }) =>
      api.patchFinding(id, next),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['analysis-run', runId] });
      void queryClient.invalidateQueries({ queryKey: ['findings', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['day-analysis', projectId, day] });
      toast.success('Статус сигнала обновлён');
    },
    onError: (error) => toast.error('Не удалось обновить сигнал', error),
  });

  const openFinding = (findingId: string) => {
    navigate(`/projects/${projectId}/days/${day}/analysis/${runId}/findings/${findingId}`);
  };

  const data = report.data;
  const classes = data?.classes ?? [];
  const findings = data?.findings ?? [];
  const titles = data?.classTitles ?? {};
  const summary = (data?.summary ?? {}) as Record<string, unknown>;

  const missing = classes.filter((row) => row.expected && !row.present);
  const confirmed = classes.filter((row) => row.expected && row.present);
  const unexpected = classes.filter(
    (row) => !row.expected && row.present && row.verdict === 'UNEXPECTED',
  );

  const activeStages = useMemo(() => {
    const raw = summary.activeStages;
    if (!Array.isArray(raw) || raw.length === 0) return [] as string[];
    return raw.map((item) => {
      const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
      const name = String(row.stageName ?? 'Этап');
      const wbs = row.stageWbs ? String(row.stageWbs) : '';
      return wbs ? `${name} (${wbs})` : name;
    });
  }, [summary.activeStages]);

  const stageHeaderLine = useMemo(() => {
    if (activeStages.length === 0) return 'Этап плана не определён';
    if (activeStages.length <= 2) return `Этап: ${activeStages.join('; ')}`;
    return `Этап: ${activeStages.slice(0, 2).join('; ')} и ещё ${activeStages.length - 2}`;
  }, [activeStages]);

  const unmappedWorks = useMemo(() => {
    const raw = summary.unmappedWorks;
    if (!Array.isArray(raw)) return [] as PlanWork[];
    return raw.filter((item) => item && typeof item === 'object') as PlanWork[];
  }, [summary.unmappedWorks]);

  const planStageGroups = useMemo(
    () => groupWorksByStage(collectPlanWorks(classes, unmappedWorks)),
    [classes, unmappedWorks],
  );

  const periodBars = useMemo(() => {
    const cells = heatmap.data?.cells ?? [];
    const map = new Map<string, { expected: number; present: number; gap: number; title: string }>();
    for (const cell of cells) {
      if (!cell.expected) continue;
      const row = map.get(cell.classCode) ?? {
        expected: 0,
        present: 0,
        gap: 0,
        title: classDisplayName(cell.classCode, heatmap.data?.classTitles),
      };
      row.expected += 1;
      if (cell.present) row.present += 1;
      if (cell.verdict === 'GAP') row.gap += 1;
      map.set(cell.classCode, row);
    }
    return [...map.entries()].map(([code, value]) => ({ classCode: code, ...value }));
  }, [heatmap.data]);

  const findingColumns: TableColumnConfig<AnalysisFinding>[] = [
    {
      id: 'type',
      name: 'Что случилось',
      template: (row) => <StatusLabel kind="findingType" status={row.type} />,
      width: 190,
    },
    {
      id: 'class',
      name: 'Техника',
      template: (row) =>
        classDisplayName(row.classCode, titles, String(row.details?.classTitle ?? '')),
      width: 180,
    },
    {
      id: 'severity',
      name: 'Важность',
      template: (row) => <StatusLabel kind="finding" status={row.severity} />,
      width: 110,
    },
    {
      id: 'status',
      name: 'Решение',
      template: (row) => <StatusLabel kind="findingStatus" status={row.status} />,
      width: 140,
    },
    {
      id: 'title',
      name: 'Пояснение',
      primary: true,
      template: (row) => row.title,
    },
    {
      id: 'actions',
      name: '',
      width: 280,
      template: (row) => (
        <FindingActions
          compact
          status={row.status}
          disabled={patchFinding.isPending}
          showOpen
          onOpen={() => openFinding(row.id)}
          onConfirm={() => patchFinding.mutate({ id: row.id, next: 'CONFIRMED' })}
          onDismiss={() => patchFinding.mutate({ id: row.id, next: 'DISMISSED' })}
        />
      ),
    },
  ];

  const completenessWarning = completenessWarningText(
    summary.completeness as CompletenessSummary | undefined,
    summary,
  );

  return (
    <QueryState
      isLoading={report.isLoading}
      isError={report.isError}
      error={report.error}
      onRetry={() => void report.refetch()}
      isEmpty={!report.isLoading && !data}
      emptyTitle="Отчёт анализа не найден"
    >
      {data && (
        <Flex direction="column" gap={4} className="analysis-report">
          {/* 1. Шапка дня */}
          <Flex justifyContent="space-between" alignItems="flex-start" wrap gap={3}>
            <Flex direction="column" gap={1}>
              <Text variant="header-1">
                Отчёт по площадке · {day || data.day}
              </Text>
              <Text color="secondary">{stageHeaderLine}</Text>
              <Flex gap={4} wrap className="mt-1">
                <Text>
                  Ждали:{' '}
                  {String(summary.expectedClassCount ?? missing.length + confirmed.length)}
                </Text>
                <Text>
                  Нашли:{' '}
                  {String(
                    summary.presentClassCount ?? confirmed.length + unexpected.length,
                  )}
                </Text>
                <Text>Сигналов: {String(summary.findingCount ?? findings.length)}</Text>
              </Flex>
            </Flex>
            <Flex gap={2} alignItems="center" className="no-print">
              {data.observability && (
                <StatusLabel kind="observability" status={data.observability} />
              )}
              <StatusLabel kind="run" status={data.status} />
              <Button view="action" onClick={() => window.print()}>
                Сохранить PDF
              </Button>
            </Flex>
          </Flex>

          {completenessWarning && (
            <div className="analysis-completeness-banner">
              <Text>{completenessWarning}</Text>
            </div>
          )}
          {data.lastError && (
            <Text color="danger" className="block">
              {data.lastError}
            </Text>
          )}

          {/* 2. По плану на этот день */}
          <Card view="outlined" className="p-4">
            <Text variant="subheader-2" className="mb-1 block">
              По плану на этот день
            </Text>
            <Text color="secondary" className="mb-3 block">
              Этап · работа плана · классификатор · ожидаемая техника
            </Text>
            {planStageGroups.length === 0 ? (
              <Text color="secondary">Активных работ по плану на этот день нет.</Text>
            ) : (
              <Flex direction="column" gap={4}>
                {planStageGroups.map((group) => (
                  <div key={group.key}>
                    <Text variant="subheader-3" className="mb-2 block">
                      {group.label}
                    </Text>
                    <Flex direction="column" gap={2}>
                      {group.works.map((work, index) => {
                        const equipment = work._equipmentTitle
                          ? String(work._equipmentTitle)
                          : undefined;
                        const volume = workVolumeHint(work);
                        const reason = work.reason
                          ? unmappedReasonLabel(work.reason)
                          : null;
                        return (
                          <div
                            key={String(work.workId ?? index)}
                            className="rounded border border-[var(--g-color-line-generic)] px-3 py-2"
                          >
                            <Text>{workChainLine(work, equipment)}</Text>
                            {volume && (
                              <Text color="secondary" className="mt-1 block" variant="caption-2">
                                {volume}
                              </Text>
                            )}
                            {reason && (
                              <Text color="warning" className="mt-1 block" variant="caption-2">
                                Технику не вывели: {reason}
                              </Text>
                            )}
                          </div>
                        );
                      })}
                    </Flex>
                  </div>
                ))}
              </Flex>
            )}
          </Card>

          {/* 3. Техника */}
          <Card view="outlined" className="p-4">
            <Text variant="subheader-2" className="mb-3 block">
              Техника
            </Text>
            <Flex direction="column" gap={4}>
              <EquipmentSection
                title="Нет на кадрах"
                empty="Таких групп техники за день нет."
                rows={missing}
                titles={titles}
                showMissingHint
                showFrames={false}
                onOpen={setPreview}
              />
              <EquipmentSection
                title="Совпало с планом"
                empty="Подтверждённых совпадений нет."
                rows={confirmed}
                titles={titles}
                showFrames
                onOpen={setPreview}
              />
              <EquipmentSection
                title="Вне плана"
                empty="Техники вне плана нет."
                rows={unexpected}
                titles={titles}
                showFrames
                onOpen={setPreview}
              />
            </Flex>
          </Card>

          {/* 4. Сигналы */}
          <Flex direction="column" gap={2}>
            <Text variant="subheader-2">Сигналы за день</Text>
            <QueryState
              isEmpty={findings.length === 0 && data.status === 'COMPLETED'}
              emptyTitle="Сигналов нет"
              emptyDescription="Потенциальных отклонений за этот день не найдено"
            >
              <Table data={findings} columns={findingColumns} getRowId={(row) => row.id} />
            </QueryState>
            <Text color="secondary" variant="caption-2" className="no-print">
              {FINDING_BUTTON_COPY.hint} Подтвердить — {FINDING_BUTTON_COPY.confirm.hint}{' '}
              Отклонить — {FINDING_BUTTON_COPY.dismiss.hint}
            </Text>
          </Flex>

          {/* Вторичное */}
          {unmappedWorks.length > 0 && (
            <details className="analysis-details no-print">
              <summary>
                Работы без класса детекции ({unmappedWorks.length})
              </summary>
              <Flex direction="column" gap={2} className="mt-3">
                {unmappedWorks.map((work, index) => (
                  <div
                    key={String(work.workId ?? index)}
                    className="rounded border border-[var(--g-color-line-generic)] p-3"
                  >
                    <Text>{workChainLine(work)}</Text>
                    <Text color="secondary" className="mt-1 block">
                      {unmappedReasonLabel(work.reason)}
                    </Text>
                  </div>
                ))}
              </Flex>
            </details>
          )}

          <details className="analysis-details no-print">
            <summary>За весь ход работ до этого дня</summary>
            <Text color="secondary" className="mb-4 mt-3 block">
              Период: {periodFrom || '—'} — {periodTo || '—'}. Сколько дней технику ждали по
              плану и сколько дней её не было на кадрах.
            </Text>
            {periodBars.length === 0 ? (
              <Text color="secondary">Пока мало дневных отчётов для графика.</Text>
            ) : (
              <Flex direction="column" gap={3}>
                {periodBars.map((row) => (
                  <DeviationBar key={row.classCode} {...row} />
                ))}
              </Flex>
            )}
          </details>

          <details className="analysis-details no-print">
            <summary>Подробная сверка (для проверки)</summary>
            <div className="mt-3">
              <Table
                data={classes}
                columns={[
                  {
                    id: 'classCode',
                    name: 'Техника',
                    primary: true,
                    template: (row: AnalysisDayClass) =>
                      classDisplayName(row.classCode, titles, row.classTitle),
                  },
                  {
                    id: 'verdict',
                    name: 'Итог',
                    template: (row: AnalysisDayClass) => (
                      <StatusLabel kind="verdict" status={row.verdict} />
                    ),
                    width: 160,
                  },
                  {
                    id: 'expected',
                    name: 'Ждали',
                    template: (row: AnalysisDayClass) => (row.expected ? 'да' : 'нет'),
                    width: 80,
                  },
                  {
                    id: 'present',
                    name: 'На кадрах',
                    template: (row: AnalysisDayClass) => (row.present ? 'да' : 'нет'),
                    width: 100,
                  },
                  {
                    id: 'objects',
                    name: 'Объектов',
                    template: (row: AnalysisDayClass) => String(row.objectCount),
                    width: 100,
                    align: 'end' as const,
                  },
                  {
                    id: 'works',
                    name: 'Работ',
                    template: (row: AnalysisDayClass) => String(row.expectedWorkCount),
                    width: 80,
                    align: 'end' as const,
                  },
                ]}
                getRowId={(row) => row.id}
              />
            </div>
          </details>

          <Modal open={Boolean(preview)} onOpenChange={(open) => !open && setPreview(null)}>
            {preview && <DetectionPreview detection={preview} />}
          </Modal>
        </Flex>
      )}
    </QueryState>
  );
}

function EquipmentSection({
  title,
  empty,
  rows,
  titles,
  showMissingHint = false,
  showFrames,
  onOpen,
}: {
  title: string;
  empty: string;
  rows: AnalysisDayClass[];
  titles: Record<string, string>;
  showMissingHint?: boolean;
  showFrames: boolean;
  onOpen: (detection: AnalysisDetection) => void;
}) {
  return (
    <div>
      <Text variant="subheader-3" className="mb-2 block">
        {title} ({rows.length})
      </Text>
      {rows.length === 0 ? (
        <Text color="secondary">{empty}</Text>
      ) : (
        <Flex direction="column" gap={2}>
          {rows.map((row) => (
            <EquipmentRow
              key={row.id}
              row={row}
              titles={titles}
              showMissingHint={showMissingHint}
              showFrames={showFrames}
              onOpen={onOpen}
            />
          ))}
        </Flex>
      )}
    </div>
  );
}

function EquipmentRow({
  row,
  titles,
  showMissingHint,
  showFrames,
  onOpen,
}: {
  row: AnalysisDayClass;
  titles: Record<string, string>;
  showMissingHint: boolean;
  showFrames: boolean;
  onOpen: (detection: AnalysisDetection) => void;
}) {
  const [framesOpen, setFramesOpen] = useState(false);
  const works = row.expectedWorks ?? [];
  const stages = stagesFromWorks(works);
  const daily = classExpectedDaily(row);
  const detections = row.detections ?? [];
  const equipmentTitle = classDisplayName(row.classCode, titles, row.classTitle);
  const primaryWork = works[0];
  const chain = primaryWork
    ? workChainLine(primaryWork, equipmentTitle)
    : [stages[0], equipmentTitle].filter(Boolean).join(' · ');

  return (
    <div className="rounded border border-[var(--g-color-line-generic)] p-3">
      <Flex justifyContent="space-between" alignItems="flex-start" wrap gap={2}>
        <Flex direction="column" gap={1} className="min-w-0 flex-1">
          <Text variant="subheader-3">{equipmentTitle}</Text>
          <Text color="secondary" variant="caption-2">
            {chain}
          </Text>
          {showFrames && (
            <Text color="secondary" variant="caption-2">
              {row.frameCount} кадров · {row.objectCount} обнаружений
              {daily ? ` · по плану ~ ${daily}` : ''}
            </Text>
          )}
          {showMissingHint && (
            <Text variant="caption-2">На кадрах этой техники нет.</Text>
          )}
        </Flex>
        <StatusLabel kind="verdict" status={row.verdict} />
      </Flex>

      {showFrames && (
        <div className="mt-2">
          {detections.length === 0 ? (
            <Text color="secondary" variant="caption-2">
              Картинок обнаружений нет.
            </Text>
          ) : (
            <>
              <Button
                size="s"
                view="flat-secondary"
                className="no-print"
                onClick={() => setFramesOpen((open) => !open)}
              >
                {framesOpen ? 'Скрыть кадры' : `Кадры (${detections.length})`}
              </Button>
              {framesOpen && (
                <div className="analysis-crop-carousel mt-2">
                  {detections.map((item) => (
                    <DetectionCrop key={item.objectId} detection={item} onOpen={onOpen} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function DetectionCrop({
  detection,
  onOpen,
}: {
  detection: AnalysisDetection;
  onOpen: (detection: AnalysisDetection) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const image = new window.Image();
    image.onload = () => {
      const boxW = Math.max(1, detection.x2 - detection.x1);
      const boxH = Math.max(1, detection.y2 - detection.y1);
      const pad = Math.max(8, Math.round(Math.max(boxW, boxH) * 0.08));
      const sx = Math.max(0, detection.x1 - pad);
      const sy = Math.max(0, detection.y1 - pad);
      const sw = Math.min(image.width - sx, boxW + pad * 2);
      const sh = Math.min(image.height - sy, boxH + pad * 2);
      const maxH = 96;
      const scale = Math.min(1, maxH / sh);
      canvas.width = Math.max(1, Math.round(sw * scale));
      canvas.height = Math.max(1, Math.round(sh * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = '#e4572e';
      ctx.lineWidth = 2;
      ctx.strokeRect(
        (detection.x1 - sx) * scale,
        (detection.y1 - sy) * scale,
        boxW * scale,
        boxH * scale,
      );
    };
    image.src = api.imageFile(detection.imageId);
  }, [detection]);

  return (
    <button
      type="button"
      className="analysis-crop-thumb"
      onClick={() => onOpen(detection)}
      title={`Уверенность ${(detection.confidence * 100).toFixed(0)}%`}
    >
      <canvas ref={canvasRef} className="block h-24 w-auto" />
    </button>
  );
}

function DetectionPreview({ detection }: { detection: AnalysisDetection }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const image = new window.Image();
    image.onload = () => {
      const maxWidth = wrap.clientWidth || image.width;
      const scale = Math.min(1, maxWidth / image.width);
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = '#e4572e';
      ctx.lineWidth = Math.max(2, 3 * scale);
      ctx.strokeRect(
        detection.x1 * scale,
        detection.y1 * scale,
        (detection.x2 - detection.x1) * scale,
        (detection.y2 - detection.y1) * scale,
      );
    };
    image.src = api.imageFile(detection.imageId);
  }, [detection]);

  return (
    <div className="max-w-5xl p-4">
      <div ref={wrapRef}>
        <canvas ref={canvasRef} className="max-w-full" />
      </div>
      <Text color="secondary" className="mt-2 block">
        Уверенность {(detection.confidence * 100).toFixed(0)}%
        {detection.capturedAt
          ? ` · ${new Date(detection.capturedAt).toLocaleString('ru-RU')}`
          : ''}
      </Text>
    </div>
  );
}

function DeviationBar({
  title,
  expected,
  present,
  gap,
}: {
  title: string;
  expected: number;
  present: number;
  gap: number;
}) {
  const max = Math.max(expected, 1);
  return (
    <div>
      <Flex justifyContent="space-between" className="mb-1">
        <Text>{title}</Text>
        <Text color="secondary" variant="caption-2">
          ждали {expected} дн. · были {present} · не было {gap}
        </Text>
      </Flex>
      <div className="flex h-3 overflow-hidden rounded bg-[var(--g-color-base-generic)]">
        <div
          className="h-3 bg-[var(--g-color-base-positive-medium)]"
          style={{ width: `${(present / max) * 100}%` }}
          title="Были на кадрах"
        />
        <div
          className="h-3 bg-[var(--g-color-base-danger-medium)]"
          style={{ width: `${(gap / max) * 100}%` }}
          title="Не нашли"
        />
      </div>
    </div>
  );
}
