export type CopyItem = { text: string; description: string };

export const FINDING_TYPE_COPY: Record<string, CopyItem> = {
  NO_ACTIVITY: {
    text: 'Техники нет',
    description:
      'По календарному плану эта техника должна была работать, но на кадрах с площадки её не видно.',
  },
  LATE_START: {
    text: 'Не приступили',
    description:
      'Работы по плану уже должны идти несколько дней, а ожидаемая техника на кадрах так и не появилась.',
  },
  REPEATED_GAP: {
    text: 'Снова нет техники',
    description:
      'Несколько дней подряд по плану ждали технику, а камеры её не зафиксировали при нормальном обзоре.',
  },
  UNEXPECTED_GROUP: {
    text: 'Вне плана',
    description:
      'На кадрах видна техника, которой по активному плану на этот день не ожидалось.',
  },
  INSUFFICIENT_DATA: {
    text: 'Мало данных',
    description: 'Кадров или обзора камер недостаточно, чтобы уверенно сказать, что происходило на площадке.',
  },
  NO_OBSERVATION: {
    text: 'Нет кадров',
    description: 'За день почти нет наблюдений — оценить ход работ нельзя.',
  },
  NO_EXPECTATION_SOURCE: {
    text: 'Нет плана',
    description: 'Нет активного календарного плана, поэтому непонятно, какую технику ждать.',
  },
  PERSISTENT_GAP: {
    text: 'Системный простой',
    description:
      'За выбранный период технику часто ждали по плану, но на кадрах её систематически не находили.',
  },
  LOW_INTENSITY: {
    text: 'Слабая активность',
    description:
      'Техника на кадрах есть, но слабо (мало часов или объектов), при этом по плану на день задан заметный объём.',
  },
  CUMULATIVE_LAG: {
    text: 'Накопленное отставание',
    description:
      'За период технику часто ждали и не находили; по суточным нормам объёма накоплено плановое отставание.',
  },
};

export const FINDING_STATUS_COPY: Record<string, CopyItem> = {
  POTENTIAL: {
    text: 'На проверке',
    description: 'Система заметила возможное отклонение — нужен взгляд человека с площадки.',
  },
  CONFIRMED: {
    text: 'Подтверждено',
    description: 'Проверено: отклонение реальное и остаётся в отчёте.',
  },
  DISMISSED: {
    text: 'Снято',
    description: 'Проверено: ложная тревога или ситуация не относится к нарушению.',
  },
};

export const FINDING_SEVERITY_COPY: Record<string, CopyItem> = {
  LOW: {
    text: 'Низкая',
    description: 'Информационно: можно разобрать при случае.',
  },
  MEDIUM: {
    text: 'Средняя',
    description: 'Стоит проверить в ближайшее время.',
  },
  HIGH: {
    text: 'Высокая',
    description: 'Существенное отклонение от плана — разберите в первую очередь.',
  },
};

export const VERDICT_COPY: Record<string, CopyItem> = {
  CONFIRMED: {
    text: 'На месте',
    description: 'Техника по плану ожидалась и на кадрах есть.',
  },
  GAP: {
    text: 'Не найдена',
    description: 'Техника по плану ожидалась, но на кадрах её нет.',
  },
  UNEXPECTED: {
    text: 'Вне плана',
    description: 'Техника есть на кадрах, хотя по плану на этот день не ожидалась.',
  },
  NOT_EXPECTED: {
    text: 'Не планировалась',
    description: 'Эта группа техники на день не планировалась.',
  },
  INSUFFICIENT_DATA: {
    text: 'Мало данных',
    description: 'Технику ждали, но обзор камер недостаточный для уверенного вывода.',
  },
};

export const OBSERVABILITY_COPY: Record<string, CopyItem> = {
  GOOD: {
    text: 'Обзор хороший',
    description: 'Кадров достаточно, чтобы опираться на сверку с планом.',
  },
  PARTIAL: {
    text: 'Обзор частичный',
    description: 'Камеры или часы дня покрыты неполно — возможны пропуски.',
  },
  BLIND: {
    text: 'Нет обзора',
    description: 'Наблюдений почти нет — сверка с планом недостоверна.',
  },
};

export const FINDING_BUTTON_COPY = {
  hint: 'Решение человека нужно, чтобы отделить реальные простои от ложных срабатываний камер.',
  open: {
    text: 'Подробнее',
    title: 'Открыть обоснование',
  },
  confirm: {
    text: 'Подтвердить',
    title: 'Зафиксировать как реальное отклонение',
    hint: 'на площадке этой техники или работы действительно не было — сигнал остаётся в отчёте как нарушение.',
  },
  dismiss: {
    text: 'Отклонить',
    title: 'Снять сигнал',
    hint: 'техника была, камера её не взяла, или сигнал не про эту ситуацию — в отчёт как нарушение он не пойдёт.',
  },
} as const;

export function findingTypeCopy(type: string): CopyItem {
  return FINDING_TYPE_COPY[type] ?? { text: type, description: 'Тип сигнала анализа.' };
}

export function findingStatusCopy(status: string): CopyItem {
  return (
    FINDING_STATUS_COPY[status] ?? {
      text: status,
      description: 'Статус проверки сигнала.',
    }
  );
}

export function findingSeverityCopy(severity: string): CopyItem {
  return (
    FINDING_SEVERITY_COPY[severity] ?? {
      text: severity,
      description: 'Важность сигнала.',
    }
  );
}

export function verdictCopy(verdict: string): CopyItem {
  return VERDICT_COPY[verdict] ?? { text: verdict, description: 'Итог сверки техники.' };
}

export function observabilityCopy(level: string): CopyItem {
  return (
    OBSERVABILITY_COPY[level] ?? {
      text: level,
      description: 'Насколько хорошо камеры видели площадку.',
    }
  );
}

export function classDisplayName(
  classCode: string | null | undefined,
  titles?: Record<string, string> | null,
  fallbackTitle?: string | null,
) {
  if (!classCode) return '—';
  return fallbackTitle || titles?.[classCode] || classCode;
}

export type CompletenessSummary = {
  activeWorkCount?: number;
  withVolume?: number;
  withDuration?: number;
  withBoth?: number;
  shiftConfigured?: boolean;
  shiftStart?: string | null;
  shiftEnd?: string | null;
  withoutVolume?: string[];
  withoutDuration?: string[];
  withoutDates?: string[];
  partialVolumeOrDuration?: string[];
};

/** Текст жёлтой плашки: чего не хватает для оценки темпа / фильтра смены. */
export function completenessWarningText(
  completeness: CompletenessSummary | null | undefined,
  summary?: Record<string, unknown> | null,
): string | null {
  if (!completeness && !summary) return null;
  const c = completeness ?? {};
  const shiftConfigured =
    c.shiftConfigured ?? Boolean(summary?.shiftConfigured);
  const active = Number(c.activeWorkCount ?? 0);
  const withBoth = Number(c.withBoth ?? 0);
  const missingTempo = Math.max(0, active - withBoth);
  const parts: string[] = [];
  if (active > 0 && missingTempo > 0) {
    parts.push(
      `По ${missingTempo} из ${active} работ нет объёма или длительности — темп не оценивался.`,
    );
  }
  if (!shiftConfigured) {
    parts.push('Смена не задана — смотрим все кадры суток.');
  }
  if (parts.length === 0) return null;
  return parts.join(' ');
}

export function formatExpectedDaily(
  volume: unknown,
  unit: unknown,
): string | null {
  if (volume == null || volume === '') return null;
  const num = Number(volume);
  if (!Number.isFinite(num)) return null;
  const rounded =
    Math.abs(num - Math.round(num)) < 1e-6 ? String(Math.round(num)) : num.toFixed(2).replace(/\.?0+$/, '');
  const u = unit ? String(unit) : '';
  return u ? `${rounded} ${u}` : rounded;
}
