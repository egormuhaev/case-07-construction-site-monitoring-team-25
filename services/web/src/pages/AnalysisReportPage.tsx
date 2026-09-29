import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Button,
  Card,
  Flex,
  Table,
  Text,
  type TableColumnConfig,
} from '@gravity-ui/uikit';
import {
  classDisplayName,
  completenessWarningText,
  formatExpectedDaily,
  FINDING_BUTTON_COPY,
  verdictCopy,
  type CompletenessSummary,
} from '../analysisCopy';
import { api, type AnalysisDayClass, type AnalysisFinding } from '../api';
import { FindingActions } from '../components/FindingActions';
import { QueryState } from '../components/QueryState';
import { StatusLabel } from '../components/StatusLabel';
import { useMutationToast } from '../hooks/useMutationToast';

function workLabel(work: Record<string, unknown>) {
  const name = String(work.name ?? 'Работа');
  const volume = work.volume;
  const unit = work.unit ? String(work.unit) : '';
  const duration = work.durationDays;
  const bits: string[] = [];
  if (volume != null && volume !== '') {
    bits.push(`${volume}${unit ? ` ${unit}` : ''}`);
  }
  if (duration != null && duration !== '') {
    bits.push(`${duration} дн.`);
  }
  if (bits.length) {
    return `${name} (${bits.join(' / ')})`;
  }
  return name;
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

export default function AnalysisReportPage() {
  const { projectId = '', day = '', runId = '' } = useParams();
  const navigate = useNavigate();
  const toast = useMutationToast();
  const queryClient = useQueryClient();

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
  const unexpected = classes.filter((row) => !row.expected && row.present && row.verdict === 'UNEXPECTED');

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
          <Flex justifyContent="space-between" alignItems="center" wrap gap={3}>
            <Flex direction="column" gap={1}>
              <Text variant="header-1">
                Отчёт по площадке · {day || data.day}
              </Text>
              <Text color="secondary">
                Простыми словами: что по плану должно было работать и что видно на кадрах.
              </Text>
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

          <Card view="outlined" className="p-4">
            <Text variant="subheader-2" className="mb-2 block">
              Кратко за день
            </Text>
            <Flex gap={6} wrap>
              <Text>Ожидали групп техники: {String(summary.expectedClassCount ?? missing.length + confirmed.length)}</Text>
              <Text>Нашли на кадрах: {String(summary.presentClassCount ?? confirmed.length + unexpected.length)}</Text>
              <Text>Сигналов к проверке: {String(summary.findingCount ?? findings.length)}</Text>
            </Flex>
            {(() => {
              const warning = completenessWarningText(
                summary.completeness as CompletenessSummary | undefined,
                summary,
              );
              return warning ? (
                <div className="analysis-completeness-banner mt-3">
                  <Text>{warning}</Text>
                </div>
              ) : null;
            })()}
            {data.lastError && (
              <Text color="danger" className="mt-2 block">
                {data.lastError}
              </Text>
            )}
          </Card>

          <Card view="outlined" className="p-4">
            <Text variant="subheader-2" className="mb-3 block">
              Ждали по плану, но на кадрах не нашли
            </Text>
            {missing.length === 0 ? (
              <Text color="secondary">Таких групп техники за день нет.</Text>
            ) : (
              <Flex direction="column" gap={3}>
                {missing.map((row) => (
                  <EquipmentBlock key={row.id} row={row} titles={titles} />
                ))}
              </Flex>
            )}
          </Card>

          <Card view="outlined" className="p-4">
            <Text variant="subheader-2" className="mb-3 block">
              Совпало с планом
            </Text>
            {confirmed.length === 0 ? (
              <Text color="secondary">Подтверждённых совпадений нет.</Text>
            ) : (
              <Flex gap={2} wrap>
                {confirmed.map((row) => (
                  <StatusLabel
                    key={row.id}
                    kind="verdict"
                    status={row.verdict}
                    extra={classDisplayName(row.classCode, titles, row.classTitle)}
                  />
                ))}
              </Flex>
            )}
          </Card>

          {unexpected.length > 0 && (
            <Card view="outlined" className="p-4">
              <Text variant="subheader-2" className="mb-3 block">
                Увидели на кадрах вне плана
              </Text>
              <Flex gap={2} wrap>
                {unexpected.map((row) => (
                  <StatusLabel
                    key={row.id}
                    kind="verdict"
                    status={row.verdict}
                    extra={classDisplayName(row.classCode, titles, row.classTitle)}
                  />
                ))}
              </Flex>
            </Card>
          )}

          <Card view="outlined" className="p-4">
            <Text variant="subheader-2" className="mb-2 block">
              За весь ход работ до этого дня
            </Text>
            <Text color="secondary" className="mb-4 block">
              Период: {periodFrom || '—'} — {periodTo || '—'}. Сколько дней технику ждали по плану и сколько дней её не было на кадрах.
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
          </Card>

          <Card view="outlined" className="p-4 no-print">
            <Text variant="subheader-2" className="mb-2 block">
              Что делать с сигналами
            </Text>
            <Text color="secondary" className="mb-1 block">
              {FINDING_BUTTON_COPY.hint}
            </Text>
            <Text color="secondary" className="mb-1 block">
              <b>Подтвердить</b> — {FINDING_BUTTON_COPY.confirm.hint}
            </Text>
            <Text color="secondary" className="block">
              <b>Отклонить</b> — {FINDING_BUTTON_COPY.dismiss.hint}
            </Text>
          </Card>

          <Text variant="subheader-2">Сигналы за день</Text>
          <QueryState
            isEmpty={findings.length === 0 && data.status === 'COMPLETED'}
            emptyTitle="Сигналов нет"
            emptyDescription="Потенциальных отклонений за этот день не найдено"
          >
            <Table data={findings} columns={findingColumns} getRowId={(row) => row.id} />
          </QueryState>

          <details className="no-print">
            <summary className="cursor-pointer text-[var(--g-color-text-secondary)]">
              Подробная сверка (для проверки)
            </summary>
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
        </Flex>
      )}
    </QueryState>
  );
}

function EquipmentBlock({
  row,
  titles,
}: {
  row: AnalysisDayClass;
  titles: Record<string, string>;
}) {
  const works = row.expectedWorks ?? [];
  const daily = classExpectedDaily(row);
  return (
    <div className="rounded border border-[var(--g-color-line-generic)] p-3">
      <Flex justifyContent="space-between" alignItems="center" wrap gap={2}>
        <Text variant="subheader-3">
          {classDisplayName(row.classCode, titles, row.classTitle)}
        </Text>
        <StatusLabel kind="verdict" status={row.verdict} />
      </Flex>
      <Text color="secondary" className="mt-1 block">
        {verdictCopy(row.verdict).description}
      </Text>
      {daily && (
        <Text className="mt-1 block">По плану на день ~ {daily}</Text>
      )}
      {works.length > 0 && (
        <Flex direction="column" gap={1} className="mt-2">
          <Text variant="caption-2" color="secondary">
            Связанные работы по плану:
          </Text>
          {works.map((work, index) => (
            <Text key={String(work.workId ?? index)}>{workLabel(work)}</Text>
          ))}
        </Flex>
      )}
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
