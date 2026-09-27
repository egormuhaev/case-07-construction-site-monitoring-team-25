import { Label, type LabelProps } from '@gravity-ui/uikit';

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

type Kind = 'plan' | 'day' | 'match' | 'run';

const MAPS: Record<Kind, Record<string, { text: string; theme: LabelProps['theme'] }>> = {
  plan: PLAN_STATUS,
  day: DAY_STATUS,
  match: MATCH_SOURCE,
  run: RUN_STATUS,
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
    <Label theme={mapped.theme}>
      {mapped.text}
      {extra ? ` · ${extra}` : ''}
    </Label>
  );
}

export function scoreTheme(score: number | null | undefined): LabelProps['theme'] {
  if (score == null) return 'unknown';
  if (score >= 0.7) return 'success';
  if (score >= 0.3) return 'warning';
  return 'danger';
}
