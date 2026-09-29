import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { Card, Flex, Text } from '@gravity-ui/uikit';
import {
  classDisplayName,
  findingStatusCopy,
  findingTypeCopy,
  findingSeverityCopy,
  observabilityCopy,
  verdictCopy,
} from '../analysisCopy';
import { FindingActions } from '../components/FindingActions';
import { api, type AnalysisFinding } from '../api';
import { QueryState } from '../components/QueryState';
import { StatusLabel } from '../components/StatusLabel';
import { useMutationToast } from '../hooks/useMutationToast';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function formatScalar(value: unknown): string {
  if (value == null) return '—';
  if (typeof value === 'boolean') return value ? 'да' : 'нет';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function ExpectedWorksList({ works }: { works: unknown }) {
  if (!Array.isArray(works) || works.length === 0) {
    return <Text color="secondary">Ожидаемых работ в деталях нет</Text>;
  }
  return (
    <Flex direction="column" gap={2}>
      {works.map((item, index) => {
        const row = asRecord(item);
        const name = formatScalar(row.name ?? row.workName ?? `Работа ${index + 1}`);
        const wbs = row.wbs ? ` · ${String(row.wbs)}` : '';
        const volume =
          row.volume != null && row.volume !== ''
            ? ` · объём ${formatScalar(row.volume)}${row.unit ? ` ${row.unit}` : ''}`
            : '';
        const duration =
          row.durationDays != null && row.durationDays !== ''
            ? ` · ${formatScalar(row.durationDays)} дн.`
            : '';
        const daily =
          row.expectedDaily != null && row.expectedDaily !== ''
            ? ` · на день ~ ${formatScalar(row.expectedDaily)}${row.unit ? ` ${row.unit}` : ''}`
            : '';
        return (
          <Text key={String(row.workId ?? index)}>
            {name}
            {wbs}
            {volume}
            {duration}
            {daily}
          </Text>
        );
      })}
    </Flex>
  );
}

function WhyFinding({
  type,
  details,
}: {
  type: string;
  details: Record<string, unknown>;
}) {
  const copy = findingTypeCopy(type);
  const lines: Array<{ label: string; value: string }> = [];

  if (details.imageCount != null) {
    lines.push({ label: 'Кадров за день', value: formatScalar(details.imageCount) });
  }
  if (details.cameraCount != null) {
    lines.push({ label: 'Камер', value: formatScalar(details.cameraCount) });
  }
  if (details.hourSpan != null) {
    lines.push({ label: 'Охват часов', value: formatScalar(details.hourSpan) });
  }
  if (details.objectCount != null) {
    lines.push({ label: 'Объектов детекции', value: formatScalar(details.objectCount) });
  }
  if (details.frameCount != null) {
    lines.push({ label: 'Кадров с классом', value: formatScalar(details.frameCount) });
  }
  if (details.expectedWorkCount != null) {
    lines.push({
      label: 'Ожидаемых работ',
      value: formatScalar(details.expectedWorkCount),
    });
  }
  if (details.thresholdDays != null) {
    lines.push({
      label: 'Порог дней',
      value: formatScalar(details.thresholdDays),
    });
  }
  if (details.detectionRunStatus != null) {
    lines.push({
      label: 'Статус детекции',
      value: formatScalar(details.detectionRunStatus),
    });
  }
  if (details.expectedDays != null) {
    lines.push({
      label: 'Дней с ожиданием',
      value: formatScalar(details.expectedDays),
    });
  }
  if (details.confirmedDays != null) {
    lines.push({
      label: 'Дней с подтверждением',
      value: formatScalar(details.confirmedDays),
    });
  }
  if (details.expectedDailyVolume != null) {
    lines.push({
      label: 'Суточная норма',
      value: `${formatScalar(details.expectedDailyVolume)}${
        details.expectedDailyUnit ? ` ${formatScalar(details.expectedDailyUnit)}` : ''
      }`,
    });
  }
  if (details.plannedVolumeWindow != null) {
    lines.push({
      label: 'Плановый объём за окно',
      value: `${formatScalar(details.plannedVolumeWindow)}${
        details.expectedDailyUnit ? ` ${formatScalar(details.expectedDailyUnit)}` : ''
      }`,
    });
  }

  return (
    <Flex direction="column" gap={3}>
      <Text>{copy.description}</Text>
      {lines.length > 0 && (
        <Flex gap={6} wrap>
          {lines.map((line) => (
            <Text key={line.label} color="secondary">
              {line.label}: {line.value}
            </Text>
          ))}
        </Flex>
      )}
      {details.expectedWorks != null && (
        <Flex direction="column" gap={1}>
          <Text variant="subheader-3">Ожидаемые работы</Text>
          <ExpectedWorksList works={details.expectedWorks} />
        </Flex>
      )}
      {Array.isArray(details.gapDays) && details.gapDays.length > 0 && (
        <Text color="secondary">Дни с пробелом: {details.gapDays.join(', ')}</Text>
      )}
      {Array.isArray(details.daysNotAnalyzed) && details.daysNotAnalyzed.length > 0 && (
        <Text color="secondary">
          Дни без анализа: {details.daysNotAnalyzed.join(', ')}
        </Text>
      )}
    </Flex>
  );
}

export default function FindingDetailPage() {
  const { projectId = '', day = '', runId = '', findingId = '' } = useParams();
  const toast = useMutationToast();
  const queryClient = useQueryClient();

  const detail = useQuery({
    queryKey: ['finding', findingId],
    queryFn: () => api.finding(findingId),
    enabled: Boolean(findingId),
  });

  const patchFinding = useMutation({
    mutationFn: (next: AnalysisFinding['status']) => api.patchFinding(findingId, next),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['finding', findingId] });
      void queryClient.invalidateQueries({ queryKey: ['analysis-run', runId] });
      void queryClient.invalidateQueries({ queryKey: ['findings', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['day-analysis', projectId, day] });
      toast.success('Статус сигнала обновлён');
    },
    onError: (error) => toast.error('Не удалось обновить сигнал', error),
  });

  const finding = detail.data?.finding;
  const dayClass = detail.data?.dayClass ?? null;
  const run = detail.data?.run;
  const typeCopy = finding ? findingTypeCopy(finding.type) : null;
  const statusCopy = finding ? findingStatusCopy(finding.status) : null;
  const severityCopy = finding ? findingSeverityCopy(finding.severity) : null;

  return (
    <QueryState
      isLoading={detail.isLoading}
      isError={detail.isError}
      error={detail.error}
      onRetry={() => void detail.refetch()}
      isEmpty={!detail.isLoading && !finding}
      emptyTitle="Сигнал не найден"
    >
      {finding && (
        <Flex direction="column" gap={4}>
          <Flex justifyContent="space-between" alignItems="center" wrap gap={3}>
            <Flex direction="column" gap={1}>
              <Text variant="header-1">{finding.title}</Text>
              <Text color="secondary">
                {day || run?.day || '—'}
                {finding.classCode
                  ? ` · ${classDisplayName(finding.classCode, null, String(finding.details?.classTitle ?? ''))}`
                  : ''}
              </Text>
            </Flex>
            <FindingActions
              status={finding.status}
              disabled={patchFinding.isPending}
              loadingConfirm={patchFinding.isPending && patchFinding.variables === 'CONFIRMED'}
              loadingDismiss={patchFinding.isPending && patchFinding.variables === 'DISMISSED'}
              onConfirm={() => patchFinding.mutate('CONFIRMED')}
              onDismiss={() => patchFinding.mutate('DISMISSED')}
            />
          </Flex>

          <Card view="outlined" className="p-4">
            <Flex gap={4} wrap alignItems="center">
              <StatusLabel kind="findingType" status={finding.type} />
              <StatusLabel kind="findingStatus" status={finding.status} />
              <StatusLabel kind="finding" status={finding.severity} />
              {run?.observability && (
                <StatusLabel kind="observability" status={run.observability} />
              )}
            </Flex>
            <Flex direction="column" gap={2} className="mt-3">
              {typeCopy && <Text color="secondary">{typeCopy.description}</Text>}
              {statusCopy && <Text color="secondary">{statusCopy.description}</Text>}
              {severityCopy && <Text color="secondary">{severityCopy.description}</Text>}
              {run?.observability && (
                <Text color="secondary">
                  {observabilityCopy(run.observability).description}
                </Text>
              )}
              <Text color="secondary">
                Уверенность модели: {(finding.confidence * 100).toFixed(0)}% · отклонение:{' '}
                {(finding.deviation * 100).toFixed(0)}%
              </Text>
            </Flex>
          </Card>

          <Text variant="subheader-2">Почему сигнал</Text>
          <Card view="outlined" className="p-4">
            <WhyFinding type={finding.type} details={asRecord(finding.details)} />
          </Card>

          {dayClass && (
            <>
              <Text variant="subheader-2">Сверка класса</Text>
              <Card view="outlined" className="p-4">
                <Flex direction="column" gap={3}>
                  <Flex gap={3} wrap alignItems="center">
                    <Text variant="subheader-3">{dayClass.classCode}</Text>
                    <StatusLabel kind="verdict" status={dayClass.verdict} />
                  </Flex>
                  <Text color="secondary">{verdictCopy(dayClass.verdict).description}</Text>
                  <Flex gap={6} wrap>
                    <Text color="secondary">
                      Ожидался: {dayClass.expected ? 'да' : 'нет'}
                    </Text>
                    <Text color="secondary">Есть: {dayClass.present ? 'да' : 'нет'}</Text>
                    <Text color="secondary">Объектов: {dayClass.objectCount}</Text>
                    <Text color="secondary">Кадров: {dayClass.frameCount}</Text>
                    <Text color="secondary">Камер: {dayClass.cameraCount}</Text>
                    <Text color="secondary">Часов: {dayClass.hourSpan}</Text>
                    <Text color="secondary">
                      Уверенность детекции:{' '}
                      {dayClass.medianConfidence != null
                        ? `${(dayClass.medianConfidence * 100).toFixed(0)}%`
                        : '—'}
                    </Text>
                    <Text color="secondary">
                      Уверенность ожидания:{' '}
                      {dayClass.expectedConfidence != null
                        ? `${(dayClass.expectedConfidence * 100).toFixed(0)}%`
                        : '—'}
                    </Text>
                  </Flex>
                  {dayClass.expectedWorks?.length > 0 && (
                    <Flex direction="column" gap={1}>
                      <Text variant="subheader-3">Работы из плана</Text>
                      <ExpectedWorksList works={dayClass.expectedWorks} />
                    </Flex>
                  )}
                </Flex>
              </Card>
            </>
          )}
        </Flex>
      )}
    </QueryState>
  );
}
