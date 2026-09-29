import { Label, type LabelProps } from '@gravity-ui/uikit';
import {
  FINDING_SEVERITY_COPY,
  FINDING_STATUS_COPY,
  FINDING_TYPE_COPY,
  OBSERVABILITY_COPY,
  VERDICT_COPY,
  type CopyItem,
} from '../analysisCopy';

const PLAN_STATUS: Record<string, { text: string; theme: LabelProps['theme'] }> = {
  PENDING: { text: 'Ожидает', theme: 'unknown' },
  PROCESSING: { text: 'Обработка', theme: 'info' },
  READY: { text: 'Готов', theme: 'success' },
  FAILED: { text: 'Ошибка', theme: 'danger' },
};

const DAY_STATUS: Record<string, { text: string; theme: LabelProps['theme'] }> = {
  COLLECTING: { text: 'Сбор кадров', theme: 'unknown' },
  DETECTING: { text: 'Детекция', theme: 'info' },
  DETECTED: { text: 'Готово', theme: 'success' },
  FAILED: { text: 'Ошибка', theme: 'danger' },
};

const MATCH_SOURCE: Record<string, { text: string; theme: LabelProps['theme'] }> = {
  AUTO: { text: 'Авто', theme: 'info' },
  MANUAL: { text: 'Вручную', theme: 'success' },
};

const RUN_STATUS: Record<string, { text: string; theme: LabelProps['theme'] }> = {
  RUNNING: { text: 'Выполняется', theme: 'info' },
  COMPLETED: { text: 'Завершён', theme: 'success' },
  FAILED: { text: 'Ошибка', theme: 'danger' },
};

type Mapped = { text: string; theme: LabelProps['theme']; description?: string };

function withCopy(
  theme: LabelProps['theme'],
  copy: CopyItem | undefined,
  fallback: string,
): Mapped {
  return {
    text: copy?.text ?? fallback,
    theme,
    description: copy?.description,
  };
}

const FINDING_SEVERITY: Record<string, Mapped> = {
  LOW: withCopy('unknown', FINDING_SEVERITY_COPY.LOW, 'Низкая'),
  MEDIUM: withCopy('warning', FINDING_SEVERITY_COPY.MEDIUM, 'Средняя'),
  HIGH: withCopy('danger', FINDING_SEVERITY_COPY.HIGH, 'Высокая'),
};

const OBSERVABILITY: Record<string, Mapped> = {
  GOOD: withCopy('success', OBSERVABILITY_COPY.GOOD, 'Хорошее покрытие'),
  PARTIAL: withCopy('warning', OBSERVABILITY_COPY.PARTIAL, 'Частичное покрытие'),
  BLIND: withCopy('danger', OBSERVABILITY_COPY.BLIND, 'Нет данных'),
};

const VERDICT: Record<string, Mapped> = {
  CONFIRMED: withCopy('success', VERDICT_COPY.CONFIRMED, 'Подтверждено'),
  GAP: withCopy('danger', VERDICT_COPY.GAP, 'Пробел'),
  UNEXPECTED: withCopy('warning', VERDICT_COPY.UNEXPECTED, 'Неожиданно'),
  NOT_EXPECTED: withCopy('unknown', VERDICT_COPY.NOT_EXPECTED, 'Вне плана'),
  INSUFFICIENT_DATA: withCopy('info', VERDICT_COPY.INSUFFICIENT_DATA, 'Мало данных'),
};

const FINDING_TYPE: Record<string, Mapped> = {
  NO_ACTIVITY: withCopy('danger', FINDING_TYPE_COPY.NO_ACTIVITY, 'Нет активности'),
  LATE_START: withCopy('danger', FINDING_TYPE_COPY.LATE_START, 'Позднее начало'),
  REPEATED_GAP: withCopy('danger', FINDING_TYPE_COPY.REPEATED_GAP, 'Повторяющийся пробел'),
  UNEXPECTED_GROUP: withCopy('warning', FINDING_TYPE_COPY.UNEXPECTED_GROUP, 'Неожиданная группа'),
  INSUFFICIENT_DATA: withCopy('info', FINDING_TYPE_COPY.INSUFFICIENT_DATA, 'Мало данных'),
  NO_OBSERVATION: withCopy('danger', FINDING_TYPE_COPY.NO_OBSERVATION, 'Нет наблюдений'),
  NO_EXPECTATION_SOURCE: withCopy(
    'warning',
    FINDING_TYPE_COPY.NO_EXPECTATION_SOURCE,
    'Нет плана',
  ),
  PERSISTENT_GAP: withCopy('danger', FINDING_TYPE_COPY.PERSISTENT_GAP, 'Устойчивый пробел'),
  LOW_INTENSITY: withCopy('warning', FINDING_TYPE_COPY.LOW_INTENSITY, 'Слабая активность'),
  CUMULATIVE_LAG: withCopy('danger', FINDING_TYPE_COPY.CUMULATIVE_LAG, 'Накопленное отставание'),
};

const FINDING_STATUS: Record<string, Mapped> = {
  POTENTIAL: withCopy('info', FINDING_STATUS_COPY.POTENTIAL, 'Потенциальный'),
  CONFIRMED: withCopy('success', FINDING_STATUS_COPY.CONFIRMED, 'Подтверждён'),
  DISMISSED: withCopy('unknown', FINDING_STATUS_COPY.DISMISSED, 'Отклонён'),
};

type Kind =
  | 'plan'
  | 'day'
  | 'match'
  | 'run'
  | 'finding'
  | 'findingType'
  | 'findingStatus'
  | 'observability'
  | 'verdict';

const MAPS: Record<Kind, Record<string, Mapped>> = {
  plan: PLAN_STATUS,
  day: DAY_STATUS,
  match: MATCH_SOURCE,
  run: RUN_STATUS,
  finding: FINDING_SEVERITY,
  findingType: FINDING_TYPE,
  findingStatus: FINDING_STATUS,
  observability: OBSERVABILITY,
  verdict: VERDICT,
};

export function StatusLabel({
  kind,
  status,
  extra,
}: {
  kind: Kind;
  status: string;
  extra?: string;
}) {
  const mapped = MAPS[kind][status] ?? { text: status, theme: 'unknown' as const };
  return (
    <span title={mapped.description}>
      <Label theme={mapped.theme}>
        {mapped.text}
        {extra ? ` · ${extra}` : ''}
      </Label>
    </span>
  );
}

export function scoreTheme(score: number | null | undefined): LabelProps['theme'] {
  if (score == null) return 'unknown';
  if (score >= 0.7) return 'success';
  if (score >= 0.3) return 'warning';
  return 'danger';
}
