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
import { api, type Classifier, type WorkRow } from '../api';
import { QueryState } from '../components/QueryState';
import { StatusLabel, scoreTheme } from '../components/StatusLabel';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useMutationToast } from '../hooks/useMutationToast';

const PAGE_SIZE = 50;

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
  const skip = (page - 1) * PAGE_SIZE;

  const works = useQuery({
    queryKey: ['works', projectId, debouncedQ, source, skip],
    queryFn: () => api.works(projectId, { q: debouncedQ, source, skip, take: PAGE_SIZE }),
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
    () => (works.data?.items ?? []).filter((item) => !item.match).length,
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
      id: 'norm',
      name: 'Норма',
      template: (work) =>
        work.match?.classifier
          ? `${work.match.classifier.tableCode} ${work.match.classifier.workName}`
          : '—',
    },
    {
      id: 'score',
      name: 'Скор',
      width: 110,
      template: (work) =>
        work.match?.rerankScore != null ? (
          <Label theme={scoreTheme(work.match.rerankScore)}>
            {work.match.rerankScore.toFixed(3)}
          </Label>
        ) : (
          '—'
        ),
    },
    {
      id: 'source',
      name: 'Источник',
      width: 120,
      template: (work) =>
        work.match ? <StatusLabel kind="match" status={work.match.source} /> : '—',
    },
    {
      id: 'actions',
      name: '',
      width: 140,
      template: (work) => (
        <Button view="flat" size="s" onClick={() => setPicker(work)}>
          Выбрать норму
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
        <Button view="action" onClick={() => setConfirmOpen(true)}>
          Подтвердить автосопоставление
        </Button>
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
      </QueryState>

      {picker && (
        <ClassifierPicker
          work={picker}
          onClose={() => setPicker(null)}
          onPick={async (classifierId) => {
            try {
              await api.patchMatch(picker.id, classifierId);
              setPicker(null);
              await queryClient.invalidateQueries({ queryKey: ['works', projectId] });
              toast.success('Норма назначена');
            } catch (error) {
              toast.error('Не удалось назначить норму', error);
            }
          }}
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

function ClassifierPicker({
  work,
  onClose,
  onPick,
}: {
  work: WorkRow;
  onClose: () => void;
  onPick: (id: string) => Promise<void>;
}) {
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 300);
  const [sphere, setSphere] = useState('');
  const [collection, setCollection] = useState('');
  const [tableCode, setTableCode] = useState('');

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

  const crumbItems = [
    { text: 'Каталог', action: () => { setSphere(''); setCollection(''); setTableCode(''); } },
  ];
  if (sphere) {
    crumbItems.push({
      text: sphere,
      action: () => { setCollection(''); setTableCode(''); },
    });
  }
  if (collection) {
    crumbItems.push({
      text: collection,
      action: () => { setTableCode(''); },
    });
  }
  if (tableCode) {
    crumbItems.push({ text: tableCode, action: () => undefined });
  }

  return (
    <Dialog open onClose={onClose} size="l">
      <Dialog.Header caption="Норма для работы" />
      <Dialog.Body>
        <Flex direction="column" gap={4}>
          <Text>{work.name}</Text>
          <TextInput placeholder="Поиск по ГЭСН" value={q} onUpdate={setQ} hasClear />

          {candidates.length > 0 && (
            <Flex direction="column" gap={2}>
              <Text variant="subheader-2">Кандидаты</Text>
              {candidates.map((item) => (
                <Button
                  key={item.id}
                  view="outlined"
                  width="max"
                  onClick={() => void onPick(item.classifierId)}
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
                    view="outlined"
                    width="max"
                    onClick={() => void onPick(item.id)}
                  >
                    {item.tableCode} {item.workName}
                  </Button>
                ))}
            </QueryState>
          </Flex>
        </Flex>
      </Dialog.Body>
      <Dialog.Footer
        onClickButtonCancel={onClose}
        textButtonCancel="Закрыть"
      />
    </Dialog>
  );
}
