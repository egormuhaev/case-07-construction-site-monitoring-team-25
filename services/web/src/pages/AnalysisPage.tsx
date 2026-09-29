import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { DatePicker } from '@gravity-ui/date-components';
import { dateTimeParse } from '@gravity-ui/date-utils';
import {
  Button,
  Card,
  Flex,
  Label,
  Select,
  Table,
  Text,
  type TableColumnConfig,
} from '@gravity-ui/uikit';
import {
  classDisplayName,
  completenessWarningText,
  FINDING_BUTTON_COPY,
  findingTypeCopy,
  observabilityCopy,
  verdictCopy,
  type CompletenessSummary,
} from '../analysisCopy';
import { api, type AnalysisFinding, type FindingsStats } from '../api';
import { FindingActions } from '../components/FindingActions';
import { QueryState } from '../components/QueryState';
import { StatusLabel } from '../components/StatusLabel';
import { useMutationToast } from '../hooks/useMutationToast';

function daysAgo(n: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - n);
  return date.toISOString().slice(0, 10);
}

const VERDICT_THEME: Record<string, 'success' | 'danger' | 'warning' | 'info' | 'unknown'> = {
  CONFIRMED: 'success',
  GAP: 'danger',
  UNEXPECTED: 'warning',
  NOT_EXPECTED: 'unknown',
  INSUFFICIENT_DATA: 'info',
};

type ReviewSummary = {
  gapDays?: number;
  gapDaysDismissed?: number;
  gapDaysConfirmed?: number;
  gapDaysPending?: number;
};

export default function AnalysisPage() {
  const { projectId = '' } = useParams();
  const navigate = useNavigate();
  const toast = useMutationToast();
  const queryClient = useQueryClient();
  const [from, setFrom] = useState(daysAgo(13));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState<string>('POTENTIAL');
  const [periodRunId, setPeriodRunId] = useState<string | null>(null);
  const [periodStale, setPeriodStale] = useState(false);

  const periodRun = useQuery({
    queryKey: ['analysis-run', periodRunId],
    queryFn: () => api.analysisRun(periodRunId!),
    enabled: Boolean(periodRunId),
    refetchInterval: (query) =>
      query.state.data?.status === 'RUNNING' ? 3000 : false,
  });

  const periodRunning = periodRun.data?.status === 'RUNNING';

  const heatmap = useQuery({
    queryKey: ['analysis-heatmap', projectId, from, to],
    queryFn: () => api.analysisHeatmap(projectId, from, to),
    enabled: Boolean(projectId && from && to && from <= to),
    refetchInterval: periodRunning ? 4000 : false,
  });

  const findings = useQuery({
    queryKey: ['findings', projectId, status, from, to],
    queryFn: () => api.findings(projectId, { status: status || undefined, from, to }),
    enabled: Boolean(projectId),
    refetchInterval: periodRunning ? 4000 : false,
  });

  const findingsStats = useQuery({
    queryKey: ['findings-stats', projectId, from, to],
    queryFn: () => api.findingsStats(projectId, from, to),
    enabled: Boolean(projectId && from && to && from <= to),
  });

  useEffect(() => {
    if (periodRun.data?.status === 'COMPLETED') {
      setPeriodStale(false);
      void queryClient.invalidateQueries({ queryKey: ['analysis-heatmap', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['findings', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['findings-stats', projectId] });
    }
  }, [periodRun.data?.status, projectId, queryClient]);

  const startPeriod = useMutation({
    mutationFn: () => api.startPeriodAnalysis(projectId, from, to),
    onSuccess: (result) => {
      setPeriodRunId(result.run.id);
      setPeriodStale(false);
      toast.success('Периодный анализ запущен');
    },
    onError: (error) => toast.error('Не удалось запустить анализ', error),
  });

  const patchFinding = useMutation({
    mutationFn: ({ id, next }: { id: string; next: AnalysisFinding['status'] }) =>
      api.patchFinding(id, next),
    onSuccess: () => {
      setPeriodStale(Boolean(periodRunId && periodRun.data?.status === 'COMPLETED'));
      void queryClient.invalidateQueries({ queryKey: ['findings', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['findings-stats', projectId] });
      toast.success('Статус сигнала обновлён');
    },
    onError: (error) => toast.error('Не удалось обновить сигнал', error),
  });

  const cellMap = useMemo(() => {
    const map = new Map<string, { verdict: string; objectCount: number }>();
    for (const cell of heatmap.data?.cells ?? []) {
      map.set(`${cell.day}:${cell.classCode}`, {
        verdict: cell.verdict,
        objectCount: cell.objectCount,
      });
    }
    return map;
  }, [heatmap.data]);

  const columns: TableColumnConfig<AnalysisFinding>[] = [
    {
      id: 'day',
      name: 'День / период',
      template: (row) => row.day ?? `${row.dateFrom ?? '—'}…${row.dateTo ?? '—'}`,
      width: 160,
    },
    {
      id: 'type',
      name: 'Тип',
      template: (row) => <StatusLabel kind="findingType" status={row.type} />,
      width: 190,
    },
    {
      id: 'class',
      name: 'Техника',
      template: (row) =>
        classDisplayName(
          row.classCode,
          heatmap.data?.classTitles,
          String(row.details?.classTitle ?? ''),
        ),
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
      name: 'Статус',
      template: (row) => <StatusLabel kind="findingStatus" status={row.status} />,
      width: 140,
    },
    {
      id: 'title',
      name: 'Описание',
      primary: true,
      template: (row) => row.title,
    },
    {
      id: 'actions',
      name: '',
      width: 340,
      template: (row) => (
        <FindingActions
          compact
          status={row.status}
          disabled={patchFinding.isPending}
          showOpen={Boolean(row.day && row.runId)}
          onOpen={() =>
            navigate(
              `/projects/${projectId}/days/${row.day}/analysis/${row.runId}/findings/${row.id}`,
            )
          }
          onConfirm={() => patchFinding.mutate({ id: row.id, next: 'CONFIRMED' })}
          onDismiss={() => patchFinding.mutate({ id: row.id, next: 'DISMISSED' })}
        />
      ),
    },
  ];

  const summary = periodRun.data?.summary as Record<string, unknown> | undefined;
  const review = (summary?.review ?? null) as ReviewSummary | null;

  return (
    <Flex direction="column" gap={4} className="analysis-report">
      <Text variant="header-1">Анализ нарушений</Text>
      <Text color="secondary">
        Сводка для стройки: какая техника должна была работать по плану и что видно на камерах.
        Сигналы сначала потенциальные — решение подтвердить или снять остаётся за человеком.
      </Text>

      <Card view="outlined" className="p-4">
        <Flex alignItems="flex-end" gap={3} wrap>
          <div className="w-48">
            <Text variant="caption-2" color="secondary" className="mb-1 block">
              С
            </Text>
            <DatePicker
              format="YYYY-MM-DD"
              value={dateTimeParse(from) ?? null}
              onUpdate={(value) => value && setFrom(value.format('YYYY-MM-DD'))}
            />
          </div>
          <div className="w-48">
            <Text variant="caption-2" color="secondary" className="mb-1 block">
              По
            </Text>
            <DatePicker
              format="YYYY-MM-DD"
              value={dateTimeParse(to) ?? null}
              onUpdate={(value) => value && setTo(value.format('YYYY-MM-DD'))}
            />
          </div>
          <Button
            view="action"
            loading={startPeriod.isPending || periodRun.data?.status === 'RUNNING'}
            disabled={!from || !to || from > to}
            onClick={() => startPeriod.mutate()}
          >
            Отчёт за период
          </Button>
          <Button view="outlined" className="no-print" onClick={() => window.print()}>
            Сохранить PDF
          </Button>
          {periodRun.data && <StatusLabel kind="run" status={periodRun.data.status} />}
        </Flex>
        {summary && (
          <Flex gap={4} wrap className="mt-4">
            <SummaryItem label="Дней в периоде" value={summary.dayCount} />
            <SummaryItem label="Есть отчёт" value={summary.analyzedDayCount} />
            <SummaryItem label="С хорошим обзором" value={summary.observableDayCount} />
            <SummaryItem label="Без кадров" value={summary.blindDayCount} />
            <SummaryItem label="Сигналов" value={summary.findingCount} />
            {review && (
              <>
                <SummaryItem label="Пробелов учтено" value={review.gapDays ?? 0} />
                <SummaryItem label="Снято человеком" value={review.gapDaysDismissed ?? 0} />
                <SummaryItem label="На проверке" value={review.gapDaysPending ?? 0} />
              </>
            )}
          </Flex>
        )}
        {periodStale && (
          <div className="analysis-completeness-banner mt-4">
            <Text>
              Разбор сигналов обновлён. График отклонений и периодные сигналы пересчитаются после
              повторного «Отчёт за период». Сводный график сигналов уже актуален.
            </Text>
          </div>
        )}
        {summary &&
          (() => {
            const warning = completenessWarningText(
              summary.completeness as CompletenessSummary | undefined,
              summary,
            );
            return warning ? (
              <div className="analysis-completeness-banner mt-4">
                <Text>{warning}</Text>
              </div>
            ) : null;
          })()}
      </Card>

      <Card view="outlined" className="p-4">
        <Text variant="subheader-2" className="mb-3 block">
          Сводный график сигналов
        </Text>
        <QueryState
          isLoading={findingsStats.isLoading}
          isError={findingsStats.isError}
          error={findingsStats.error}
          onRetry={() => void findingsStats.refetch()}
          isEmpty={!findingsStats.isLoading && (findingsStats.data?.total ?? 0) === 0}
          emptyTitle="Сигналов за период нет"
          emptyDescription="Нет дневных или периодных находок в выбранном диапазоне дат"
          skeletonHeight={80}
        >
          {findingsStats.data && <FindingsSummaryChart stats={findingsStats.data} />}
        </QueryState>
      </Card>

      {summary && summary.classes && typeof summary.classes === 'object' && (
        <Card view="outlined" className="p-4">
          <Text variant="subheader-2" className="mb-3 block">
            График отклонений за период
          </Text>
          <Flex direction="column" gap={3}>
            {Object.entries(summary.classes as Record<string, Record<string, unknown>>).map(
              ([code, stats]) => {
                const expected = Number(stats.expectedDays ?? 0);
                const present = Number(stats.confirmedDays ?? 0);
                const gap = Number(stats.gapDays ?? 0);
                const dismissed = Number(stats.gapDaysDismissed ?? 0);
                const max = Math.max(expected, 1);
                const title = String(stats.classTitle ?? classDisplayName(code, heatmap.data?.classTitles));
                return (
                  <div key={code}>
                    <Flex justifyContent="space-between" className="mb-1">
                      <Text>{title}</Text>
                      <Text color="secondary" variant="caption-2">
                        ждали {expected} · были {present} · не было {gap}
                        {dismissed > 0 ? ` · снято ${dismissed}` : ''}
                      </Text>
                    </Flex>
                    <div className="flex h-3 overflow-hidden rounded bg-[var(--g-color-base-generic)]">
                      <div
                        className="h-3 bg-[var(--g-color-base-positive-medium)]"
                        style={{ width: `${(present / max) * 100}%` }}
                      />
                      <div
                        className="h-3 bg-[var(--g-color-base-danger-medium)]"
                        style={{ width: `${(gap / max) * 100}%` }}
                      />
                    </div>
                  </div>
                );
              },
            )}
          </Flex>
        </Card>
      )}

      <Card view="outlined" className="overflow-auto p-4">
        <Text variant="subheader-2" className="mb-3 block">
          Карта по дням: была техника или нет
        </Text>
        <QueryState
          isLoading={heatmap.isLoading}
          isError={heatmap.isError}
          error={heatmap.error}
          onRetry={() => void heatmap.refetch()}
          isEmpty={!heatmap.isLoading && (heatmap.data?.days.length ?? 0) === 0}
          emptyTitle="Нет дневных анализов"
          emptyDescription="Запустите детекцию за дни периода — анализ стартует автоматически"
        >
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 bg-[var(--g-color-base-background)] p-2 text-left">Техника</th>
                {(heatmap.data?.days ?? []).map((day) => (
                  <th key={day.runId} className="p-2 text-center whitespace-nowrap">
                    <div>{day.day}</div>
                    <Label size="xs" theme={observabilityTheme(day.observability)}>
                      {day.observability ? observabilityCopy(day.observability).text : '—'}
                    </Label>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(heatmap.data?.classes ?? []).map((classCode) => (
                <tr key={classCode}>
                  <td className="sticky left-0 bg-[var(--g-color-base-background)] p-2 font-medium">
                    {classDisplayName(classCode, heatmap.data?.classTitles)}
                  </td>
                  {(heatmap.data?.days ?? []).map((day) => {
                    const cell = cellMap.get(`${day.day}:${classCode}`);
                    return (
                      <td key={`${day.runId}-${classCode}`} className="p-1 text-center">
                        {cell ? (
                          <Label size="xs" theme={VERDICT_THEME[cell.verdict] ?? 'unknown'}>
                            {verdictCopy(cell.verdict).text}
                            {cell.objectCount ? ` · ${cell.objectCount}` : ''}
                          </Label>
                        ) : (
                          <Text color="hint">—</Text>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </QueryState>
      </Card>

      <Card view="outlined" className="p-4">
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

      <Flex alignItems="center" gap={3} wrap>
        <Text variant="subheader-2">Сигналы</Text>
        <Select
          value={status ? [status] : []}
          onUpdate={(value) => setStatus(value[0] ?? '')}
          options={[
            { value: '', content: 'Все' },
            { value: 'POTENTIAL', content: 'Потенциальные' },
            { value: 'CONFIRMED', content: 'Подтверждённые' },
            { value: 'DISMISSED', content: 'Отклонённые' },
          ]}
          width={220}
        />
      </Flex>

      <QueryState
        isLoading={findings.isLoading}
        isError={findings.isError}
        error={findings.error}
        onRetry={() => void findings.refetch()}
        isEmpty={!findings.isLoading && (findings.data?.length ?? 0) === 0}
        emptyTitle="Сигналов нет"
        emptyDescription="За выбранный период потенциальных отклонений не найдено"
      >
        <Table data={findings.data ?? []} columns={columns} getRowId={(row) => row.id} />
      </QueryState>
    </Flex>
  );
}

function FindingsSummaryChart({ stats }: { stats: FindingsStats }) {
  const total = Math.max(stats.total, 1);
  const typeRows = Object.entries(stats.byType)
    .map(([type, counts]) => ({
      type,
      label: findingTypeCopy(type).text,
      counts,
      total: counts.POTENTIAL + counts.CONFIRMED + counts.DISMISSED,
    }))
    .filter((row) => row.total > 0)
    .sort((a, b) => b.total - a.total);

  return (
    <Flex direction="column" gap={3}>
      <div>
        <Flex justifyContent="space-between" className="mb-1">
          <Text>Все сигналы</Text>
          <Text color="secondary" variant="caption-2">
            на проверке {stats.byStatus.POTENTIAL} · подтверждено {stats.byStatus.CONFIRMED} ·
            снято {stats.byStatus.DISMISSED}
          </Text>
        </Flex>
        <StatusBar
          potential={stats.byStatus.POTENTIAL}
          confirmed={stats.byStatus.CONFIRMED}
          dismissed={stats.byStatus.DISMISSED}
          max={total}
        />
      </div>
      {typeRows.map((row) => (
        <div key={row.type}>
          <Flex justifyContent="space-between" className="mb-1">
            <Text>{row.label}</Text>
            <Text color="secondary" variant="caption-2">
              на проверке {row.counts.POTENTIAL} · подтверждено {row.counts.CONFIRMED} · снято{' '}
              {row.counts.DISMISSED}
            </Text>
          </Flex>
          <StatusBar
            potential={row.counts.POTENTIAL}
            confirmed={row.counts.CONFIRMED}
            dismissed={row.counts.DISMISSED}
            max={Math.max(row.total, 1)}
          />
        </div>
      ))}
    </Flex>
  );
}

function StatusBar({
  potential,
  confirmed,
  dismissed,
  max,
}: {
  potential: number;
  confirmed: number;
  dismissed: number;
  max: number;
}) {
  return (
    <div className="flex h-3 overflow-hidden rounded bg-[var(--g-color-base-generic)]">
      <div
        className="h-3 bg-[var(--g-color-base-info-medium)]"
        style={{ width: `${(potential / max) * 100}%` }}
        title="На проверке"
      />
      <div
        className="h-3 bg-[var(--g-color-base-positive-medium)]"
        style={{ width: `${(confirmed / max) * 100}%` }}
        title="Подтверждено"
      />
      <div
        className="h-3 bg-[var(--g-color-base-misc-medium)]"
        style={{ width: `${(dismissed / max) * 100}%` }}
        title="Снято"
      />
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: unknown }) {
  return (
    <Flex direction="column" gap={1}>
      <Text variant="caption-2" color="secondary">
        {label}
      </Text>
      <Text variant="subheader-2">{value == null ? '—' : String(value)}</Text>
    </Flex>
  );
}

function observabilityTheme(value: string | null): 'success' | 'warning' | 'danger' | 'unknown' {
  if (value === 'GOOD') return 'success';
  if (value === 'PARTIAL') return 'warning';
  if (value === 'BLIND') return 'danger';
  return 'unknown';
}
