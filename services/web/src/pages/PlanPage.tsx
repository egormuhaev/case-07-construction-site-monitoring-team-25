import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import {
  Breadcrumbs,
  Button,
  Dialog,
  Flex,
  Label,
  Pagination,
  Select,
  Table,
  Text,
  TextInput,
  type TableColumnConfig,
} from '@gravity-ui/uikit';
import { api, formatDateShort, type Classifier, type WorkMatch, type WorkRow } from '../api';
import { QueryState } from '../components/QueryState';
import { StatusLabel, scoreTheme } from '../components/StatusLabel';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useMutationToast } from '../hooks/useMutationToast';

const PAGE_SIZE = 50;

type DraftAssignment = {
  classifierId: string;
  volume: string;
  durationDays: string;
  classifier?: Classifier;
};

export default function PlanPage() {
  const { projectId = '' } = useParams();
  const queryClient = useQueryClient();
  const toast = useMutationToast();
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 300);
  const [source, setSource] = useState('');
  const [page, setPage] = useState(1);
  const [picker, setPicker] = useState<WorkRow | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [view, setView] = useState<'table' | 'calendar'>('table');
  const skip = (page - 1) * PAGE_SIZE;

  const works = useQuery({
    queryKey: ['works', projectId, debouncedQ, source, skip, view],
    queryFn: () =>
      api.works(projectId, {
        q: debouncedQ,
        source,
        skip: view === 'calendar' ? 0 : skip,
        take: view === 'calendar' ? 500 : PAGE_SIZE,
      }),
    refetchInterval: (query) => (query.state.data?.plan?.status === 'PROCESSING' ? 4000 : false),
  });

  const confirm = useMutation({
    mutationFn: () => api.confirmMatches(projectId),
    onSuccess: (result) => {
      setConfirmOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['works', projectId] });
      toast.success('Автосопоставление подтверждено', `Обновлено: ${result.updated}`);
    },
    onError: (error) => toast.error('Не удалось подтвердить', error),
  });

  const unmatched = useMemo(
    () => (works.data?.items ?? []).filter((item) => !(item.matches?.length || item.match)).length,
    [works.data?.items],
  );

  const columns: TableColumnConfig<WorkRow>[] = [
    {
      id: 'name',
      name: 'Работа',
      primary: true,
      template: (work) => (
        <div>
          <div>{work.name}</div>
          <Text color="secondary" variant="caption-2">
            {work.path}
          </Text>
        </div>
      ),
    },
    {
      id: 'dates',
      name: 'Сроки',
      width: 180,
      template: (work) => (
        <Text variant="caption-2">
          {formatDateShort(work.startAt)} — {formatDateShort(work.finishAt)}
        </Text>
      ),
    },
    {
      id: 'norm',
      name: 'Нормы',
      template: (work) => {
        const matches = work.matches?.length ? work.matches : work.match ? [work.match] : [];
        if (!matches.length) return '—';
        return (
          <Flex direction="column" gap={1}>
            {matches.map((match) => (
              <Text key={`${match.classifierId}-${match.id ?? ''}`} variant="caption-2">
                {match.classifier
                  ? `${match.classifier.tableCode} ${match.classifier.workName}`
                  : match.classifierId}
                {(() => {
                  const bits: string[] = [];
                  if (match.volume != null) {
                    bits.push(`${match.volume} ${match.classifier?.unit ?? ''}`.trim());
                  }
                  if (match.durationDays != null) {
                    bits.push(`${match.durationDays} дн.`);
                  }
                  return bits.length ? ` · ${bits.join(' / ')}` : '';
                })()}
              </Text>
            ))}
          </Flex>
        );
      },
    },
    {
      id: 'score',
      name: 'Скор',
      width: 110,
      template: (work) => {
        const score = work.matches?.[0]?.rerankScore ?? work.match?.rerankScore;
        return score != null ? (
          <Label theme={scoreTheme(score)}>{score.toFixed(3)}</Label>
        ) : (
          '—'
        );
      },
    },
    {
      id: 'source',
      name: 'Источник',
      width: 120,
      template: (work) => {
        const src = work.matches?.[0]?.source ?? work.match?.source;
        return src ? <StatusLabel kind="match" status={src} /> : '—';
      },
    },
    {
      id: 'actions',
      name: '',
      width: 160,
      template: (work) => (
        <Button view="flat" size="s" onClick={() => setPicker(work)}>
          Назначить нормы
        </Button>
      ),
    },
  ];

  if (!works.isLoading && works.data && !works.data.plan) {
    return (
      <QueryState
        isEmpty
        emptyTitle="План ещё не загружен"
        emptyDescription="Сначала загрузите календарный план на карточке проекта"
      >
        {null}
      </QueryState>
    );
  }

  return (
    <Flex direction="column" gap={4}>
      <Flex justifyContent="space-between" alignItems="center" wrap gap={3}>
        <Flex direction="column" gap={1}>
          <Text variant="header-1">Сопоставление плана</Text>
          {works.data && (
            <Text color="secondary">
              Всего работ: {works.data.total}
              {unmatched > 0 ? ` · без нормы на странице: ${unmatched}` : ''}
            </Text>
          )}
        </Flex>
        <Flex gap={2} wrap>
          <Button
            view={view === 'table' ? 'action' : 'outlined'}
            onClick={() => setView('table')}
          >
            Таблица
          </Button>
          <Button
            view={view === 'calendar' ? 'action' : 'outlined'}
            onClick={() => setView('calendar')}
          >
            Календарь
          </Button>
          <Button view="action" onClick={() => setConfirmOpen(true)}>
            Подтвердить автосопоставление
          </Button>
        </Flex>
      </Flex>

      <Flex gap={3} wrap>
        <TextInput
          placeholder="Поиск работы"
          value={q}
          onUpdate={(value) => {
            setQ(value);
            setPage(1);
          }}
          hasClear
          className="w-80"
        />
        <Select
          value={source ? [source] : []}
          placeholder="Источник"
          onUpdate={(value) => {
            setSource(value[0] ?? '');
            setPage(1);
          }}
          options={[
            { value: '', content: 'Все источники' },
            { value: 'AUTO', content: 'Авто' },
            { value: 'MANUAL', content: 'Вручную' },
            { value: 'UNMATCHED', content: 'Без нормы' },
          ]}
          width={180}
        />
      </Flex>

      <QueryState
        isLoading={works.isLoading}
        isError={works.isError}
        error={works.error}
        onRetry={() => void works.refetch()}
        isEmpty={!works.isLoading && (works.data?.items.length ?? 0) === 0}
        emptyTitle="Работ не найдено"
      >
        {view === 'table' ? (
          <>
            <Table
              data={works.data?.items ?? []}
              columns={columns}
              getRowId={(item) => item.id}
            />
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={works.data?.total ?? 0}
              onUpdate={(nextPage) => setPage(nextPage)}
              className="mt-2"
            />
          </>
        ) : (
          <PlanCalendar works={works.data?.items ?? []} onOpen={setPicker} />
        )}
      </QueryState>

      {picker && (
        <ClassifierPicker
          work={picker}
          onClose={() => setPicker(null)}
          onSaved={async () => {
            setPicker(null);
            await queryClient.invalidateQueries({ queryKey: ['works', projectId] });
            toast.success('Нормы сохранены');
          }}
          onError={(error) => toast.error('Не удалось сохранить нормы', error)}
        />
      )}

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} size="s">
        <Dialog.Header caption="Подтвердить автосопоставление?" />
        <Dialog.Body>
          <Text>
            Все автоматически найденные нормы будут помечены как подтверждённые вручную.
          </Text>
        </Dialog.Body>
        <Dialog.Footer
          onClickButtonCancel={() => setConfirmOpen(false)}
          onClickButtonApply={() => confirm.mutate()}
          textButtonApply="Подтвердить"
          textButtonCancel="Отмена"
          propsButtonApply={{ loading: confirm.isPending }}
        />
      </Dialog>
    </Flex>
  );
}

function matchesToDraft(work: WorkRow): DraftAssignment[] {
  const matches: WorkMatch[] = work.matches?.length
    ? work.matches
    : work.match
      ? [work.match]
      : [];
  return matches.map((match) => ({
    classifierId: match.classifierId,
    volume: match.volume != null ? String(match.volume) : '',
    durationDays: match.durationDays != null ? String(match.durationDays) : '',
    classifier: match.classifier,
  }));
}

function ClassifierPicker({
  work,
  onClose,
  onSaved,
  onError,
}: {
  work: WorkRow;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onError: (error: unknown) => void;
}) {
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 300);
  const [sphere, setSphere] = useState('');
  const [collection, setCollection] = useState('');
  const [tableCode, setTableCode] = useState('');
  const [draft, setDraft] = useState<DraftAssignment[]>(() => matchesToDraft(work));
  const [saving, setSaving] = useState(false);

  const catalog = useQuery({
    queryKey: ['catalog', debouncedQ, sphere, collection, tableCode],
    queryFn: () =>
      api.catalog({
        q: debouncedQ || undefined,
        sphere: sphere || undefined,
        collection: collection || undefined,
        tableCode: tableCode || undefined,
      }),
  });

  const items = catalog.data?.items ?? [];
  const level = catalog.data?.level;
  const candidates = work.candidates;
  const selectedIds = new Set(draft.map((item) => item.classifierId));

  const crumbItems = [
    {
      text: 'Каталог',
      action: () => {
        setSphere('');
        setCollection('');
        setTableCode('');
      },
    },
  ];
  if (sphere) {
    crumbItems.push({
      text: sphere,
      action: () => {
        setCollection('');
        setTableCode('');
      },
    });
  }
  if (collection) {
    crumbItems.push({
      text: collection,
      action: () => {
        setTableCode('');
      },
    });
  }
  if (tableCode) {
    crumbItems.push({ text: tableCode, action: () => undefined });
  }

  const addClassifier = (classifier: Classifier) => {
    setDraft((current) => {
      if (current.some((item) => item.classifierId === classifier.id)) return current;
      return [...current, { classifierId: classifier.id, volume: '', durationDays: '', classifier }];
    });
  };

  const addById = async (classifierId: string, hint?: Classifier) => {
    if (hint) {
      addClassifier(hint);
      return;
    }
    const existing = draft.find((item) => item.classifierId === classifierId);
    if (existing) return;
    try {
      const found = await api.catalog({ q: classifierId });
      const match = (found.items as unknown as Classifier[]).find((item) => item.id === classifierId);
      setDraft((current) => {
        if (current.some((item) => item.classifierId === classifierId)) return current;
        return [
          ...current,
          {
            classifierId,
            volume: '',
            durationDays: '',
            classifier: match,
          },
        ];
      });
    } catch {
      setDraft((current) => {
        if (current.some((item) => item.classifierId === classifierId)) return current;
        return [...current, { classifierId, volume: '', durationDays: '' }];
      });
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.replaceMatches(
        work.id,
        draft.map((item) => ({
          classifierId: item.classifierId,
          volume: item.volume.trim() === '' ? null : Number(item.volume.replace(',', '.')),
          durationDays:
            item.durationDays.trim() === ''
              ? null
              : Number(item.durationDays.replace(',', '.')),
        })),
      );
      await onSaved();
    } catch (error) {
      onError(error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onClose={onClose} size="l">
      <Dialog.Header caption="Нормы и объёмы для работы" />
      <Dialog.Body>
        <Flex direction="column" gap={4}>
          <Text>{work.name}</Text>
          <Text color="secondary" variant="caption-2">
            Можно назначить несколько норм ГЭСН. Объём и длительность необязательны — без них
            отчёт не оценит темп, только «технику видели / не видели». Единица объёма — из нормы.
          </Text>
          {work.durationHours != null && (
            <Text color="secondary" variant="caption-2">
              В календарном плане у работы: {work.durationHours} ч (подсказка, в поля не подставляется).
            </Text>
          )}

          <Flex direction="column" gap={2}>
            <Text variant="subheader-2">Выбранные нормы</Text>
            {draft.length === 0 ? (
              <Text color="secondary">Пока ничего не выбрано</Text>
            ) : (
              draft.map((item) => (
                <Flex
                  key={item.classifierId}
                  gap={3}
                  alignItems="center"
                  wrap
                  className="rounded border border-[var(--g-color-line-generic)] p-2"
                >
                  <Flex direction="column" gap={1} className="min-w-[240px] flex-1">
                    <Text>
                      {item.classifier
                        ? `${item.classifier.tableCode} ${item.classifier.workName}`
                        : item.classifierId}
                    </Text>
                    <Text color="secondary" variant="caption-2">
                      Ед. изм.: {item.classifier?.unit ?? '—'}
                    </Text>
                  </Flex>
                  <TextInput
                    label="Объём"
                    value={item.volume}
                    placeholder="необязательно"
                    className="w-32"
                    onUpdate={(value) =>
                      setDraft((current) =>
                        current.map((row) =>
                          row.classifierId === item.classifierId ? { ...row, volume: value } : row,
                        ),
                      )
                    }
                  />
                  <TextInput
                    label="Длительность, дн."
                    value={item.durationDays}
                    placeholder="необязательно"
                    className="w-36"
                    onUpdate={(value) =>
                      setDraft((current) =>
                        current.map((row) =>
                          row.classifierId === item.classifierId
                            ? { ...row, durationDays: value }
                            : row,
                        ),
                      )
                    }
                  />
                  <Button
                    view="flat-danger"
                    size="s"
                    onClick={() =>
                      setDraft((current) =>
                        current.filter((row) => row.classifierId !== item.classifierId),
                      )
                    }
                  >
                    Убрать
                  </Button>
                </Flex>
              ))
            )}
          </Flex>

          <TextInput placeholder="Поиск по ГЭСН" value={q} onUpdate={setQ} hasClear />

          {candidates.length > 0 && (
            <Flex direction="column" gap={2}>
              <Text variant="subheader-2">Кандидаты</Text>
              {candidates.map((item) => (
                <Button
                  key={item.id}
                  view={selectedIds.has(item.classifierId) ? 'outlined-success' : 'outlined'}
                  width="max"
                  onClick={() =>
                    void addById(item.classifierId, item.classifier as Classifier | undefined)
                  }
                >
                  {item.rank}. {item.classifier?.tableCode} {item.classifier?.workName} (
                  {item.rerankScore.toFixed(3)})
                </Button>
              ))}
            </Flex>
          )}

          <Flex direction="column" gap={2}>
            <Text variant="subheader-2">Каталог</Text>
            <Breadcrumbs>
              {crumbItems.map((item, index) => (
                <Breadcrumbs.Item
                  key={`${item.text}-${index}`}
                  disabled={index === crumbItems.length - 1 && !item.action}
                  onClick={item.action}
                >
                  {item.text}
                </Breadcrumbs.Item>
              ))}
            </Breadcrumbs>

            <QueryState
              isLoading={catalog.isLoading}
              isError={catalog.isError}
              error={catalog.error}
              onRetry={() => void catalog.refetch()}
              isEmpty={!catalog.isLoading && items.length === 0}
              emptyTitle="Ничего не найдено"
              skeletonHeight={100}
            >
              {level === 'sphere' &&
                items.map((item) => (
                  <Button
                    key={String(item.sphere)}
                    view="flat"
                    width="max"
                    onClick={() => setSphere(String(item.sphere))}
                  >
                    {String(item.sphere)} ({String(item.count)})
                  </Button>
                ))}
              {level === 'collection' &&
                items.map((item) => (
                  <Button
                    key={String(item.collection)}
                    view="flat"
                    width="max"
                    onClick={() => setCollection(String(item.collection))}
                  >
                    {String(item.collection)}
                  </Button>
                ))}
              {level === 'table' &&
                items.map((item) => (
                  <Button
                    key={String(item.tableCode)}
                    view="flat"
                    width="max"
                    onClick={() => setTableCode(String(item.tableCode))}
                  >
                    {String(item.tableCode)} {String(item.tableName)}
                  </Button>
                ))}
              {(level === 'work' || level === 'search') &&
                (items as unknown as Classifier[]).map((item) => (
                  <Button
                    key={item.id}
                    view={selectedIds.has(item.id) ? 'outlined-success' : 'outlined'}
                    width="max"
                    onClick={() => addClassifier(item)}
                  >
                    {item.tableCode} {item.workName} · {item.unit}
                  </Button>
                ))}
            </QueryState>
          </Flex>
        </Flex>
      </Dialog.Body>
      <Dialog.Footer
        onClickButtonCancel={onClose}
        onClickButtonApply={() => void save()}
        textButtonApply="Сохранить"
        textButtonCancel="Закрыть"
        propsButtonApply={{ loading: saving }}
      />
    </Dialog>
  );
}

function PlanCalendar({
  works,
  onOpen,
}: {
  works: WorkRow[];
  onOpen: (work: WorkRow) => void;
}) {
  const dated = works.filter((work) => work.startAt && work.finishAt);
  if (!dated.length) {
    return (
      <Text color="secondary">
        У работ нет дат начала/окончания — календарь построить нельзя.
      </Text>
    );
  }

  const minTs = Math.min(...dated.map((work) => new Date(work.startAt!).getTime()));
  const maxTs = Math.max(...dated.map((work) => new Date(work.finishAt!).getTime()));
  const span = Math.max(maxTs - minTs, 1);
  const startLabel = new Date(minTs).toLocaleDateString('ru-RU');
  const endLabel = new Date(maxTs).toLocaleDateString('ru-RU');

  return (
    <Flex direction="column" gap={3}>
      <Flex justifyContent="space-between">
        <Text color="secondary">{startLabel}</Text>
        <Text color="secondary">{endLabel}</Text>
      </Flex>
      <div className="overflow-auto rounded border border-[var(--g-color-line-generic)]">
        {works.map((work) => {
          if (work.isSummary) {
            return (
              <div
                key={work.id}
                className="border-b border-[var(--g-color-line-generic)] bg-[var(--g-color-base-generic)] px-3 py-2"
                style={{ paddingLeft: 12 + (work.outlineLevel ?? 0) * 12 }}
              >
                <Text variant="subheader-3">{work.name}</Text>
              </div>
            );
          }
          if (!work.startAt || !work.finishAt) {
            return (
              <button
                key={work.id}
                type="button"
                className="flex w-full items-center gap-3 border-b border-[var(--g-color-line-generic)] px-3 py-2 text-left hover:bg-[var(--g-color-base-generic-hover)]"
                onClick={() => onOpen(work)}
              >
                <Text className="w-64 shrink-0 truncate">{work.name}</Text>
                <Text color="secondary">без дат</Text>
              </button>
            );
          }
          const left = ((new Date(work.startAt).getTime() - minTs) / span) * 100;
          const width = Math.max(
            ((new Date(work.finishAt).getTime() - new Date(work.startAt).getTime()) / span) * 100,
            1.5,
          );
          const hasMatch = Boolean(work.matches?.length || work.match);
          return (
            <button
              key={work.id}
              type="button"
              className="flex w-full items-center gap-3 border-b border-[var(--g-color-line-generic)] px-3 py-2 text-left hover:bg-[var(--g-color-base-generic-hover)]"
              onClick={() => onOpen(work)}
            >
              <Text className="w-64 shrink-0 truncate" title={work.name}>
                {work.name}
              </Text>
              <div className="relative h-6 flex-1 rounded bg-[var(--g-color-base-generic)]">
                <div
                  className="absolute top-0 h-6 rounded"
                  style={{
                    left: `${left}%`,
                    width: `${width}%`,
                    background: hasMatch
                      ? 'var(--g-color-base-info-medium)'
                      : 'var(--g-color-base-warning-medium)',
                  }}
                  title={`${formatDateShort(work.startAt)} — ${formatDateShort(work.finishAt)}`}
                />
              </div>
            </button>
          );
        })}
      </div>
      <Text color="secondary" variant="caption-2">
        Синие полосы — работы с назначенной нормой, жёлтые — без нормы. Клик открывает назначение.
      </Text>
    </Flex>
  );
}
