import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { ArrowRotateLeft, Pencil, Xmark } from '@gravity-ui/icons';
import {
  Alert,
  Button,
  Card,
  ClipboardButton,
  DefinitionList,
  Dialog,
  FilePreview,
  Flex,
  Icon,
  Spin,
  Table,
  Text,
  TextInput,
  type TableColumnConfig,
} from '@gravity-ui/uikit';
import { api, type Plan } from '../api';
import { QueryState } from '../components/QueryState';
import { StatusLabel } from '../components/StatusLabel';
import { useMutationToast } from '../hooks/useMutationToast';

export default function ProjectPage() {
  const { projectId = '' } = useParams();
  const queryClient = useQueryClient();
  const toast = useMutationToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [rotateOpen, setRotateOpen] = useState(false);
  const [planFile, setPlanFile] = useState<File | null>(null);
  const [form, setForm] = useState({
    name: '',
    customer: '',
    contractor: '',
    address: '',
  });

  const project = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.project(projectId),
    refetchInterval: (query) =>
      query.state.data?.latestPlan?.status === 'PROCESSING' ? 3000 : false,
  });
  const plans = useQuery({
    queryKey: ['plans', projectId],
    queryFn: () => api.plans(projectId),
    enabled: Boolean(projectId),
  });

  useEffect(() => {
    if (!project.data || editOpen) return;
    setForm({
      name: project.data.name,
      customer: project.data.customer ?? '',
      contractor: project.data.contractor ?? '',
      address: project.data.address ?? '',
    });
  }, [project.data, editOpen]);

  const save = useMutation({
    mutationFn: () =>
      api.updateProject(projectId, {
        name: form.name,
        customer: form.customer || null,
        contractor: form.contractor || null,
        address: form.address || null,
      }),
    onSuccess: () => {
      setEditOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      toast.success('Проект сохранён');
    },
    onError: (error) => toast.error('Не удалось сохранить', error),
  });

  const rotate = useMutation({
    mutationFn: () => api.rotateToken(projectId),
    onSuccess: () => {
      setRotateOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      toast.success('Токен обновлён');
    },
    onError: (error) => toast.error('Не удалось обновить токен', error),
  });

  const upload = useMutation({
    mutationFn: (file: File) => api.uploadPlan(projectId, file),
    onSuccess: () => {
      setPlanFile(null);
      void queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['plans', projectId] });
      toast.success('Импорт плана запущен');
    },
    onError: (error) => toast.error('Не удалось загрузить план', error),
  });

  const item = project.data;
  const plan = item?.latestPlan;

  const planColumns: TableColumnConfig<Plan>[] = [
    {
      id: 'version',
      name: 'Версия',
      template: (row) => `v${row.version}`,
      width: 80,
    },
    {
      id: 'status',
      name: 'Статус',
      template: (row) => <StatusLabel kind="plan" status={row.status} />,
      width: 140,
    },
    {
      id: 'sourceFile',
      name: 'Файл',
      template: (row) => row.sourceFile,
    },
    {
      id: 'active',
      name: 'Активный',
      template: (row) => (row.isActive ? 'да' : '—'),
      width: 90,
    },
    {
      id: 'createdAt',
      name: 'Загружен',
      template: (row) => new Date(row.createdAt).toLocaleString('ru-RU'),
      width: 180,
    },
  ];

  return (
    <QueryState
      isLoading={project.isLoading}
      isError={project.isError}
      error={project.error}
      onRetry={() => void project.refetch()}
      isEmpty={!project.isLoading && !item}
      emptyTitle="Проект не найден"
    >
      {item && (
        <Flex direction="column" gap={5}>
          <Flex justifyContent="space-between" alignItems="center">
            <Text variant="header-1">{item.name}</Text>
            <Button view="outlined" onClick={() => setEditOpen(true)}>
              <Icon data={Pencil} />
              Редактировать
            </Button>
          </Flex>

          <Card view="outlined" className="p-4">
            <DefinitionList>
              <DefinitionList.Item name="Заказчик">
                {item.customer || '—'}
              </DefinitionList.Item>
              <DefinitionList.Item name="Подрядчик">
                {item.contractor || '—'}
              </DefinitionList.Item>
              <DefinitionList.Item name="Адрес">{item.address || '—'}</DefinitionList.Item>
              <DefinitionList.Item name="Часовой пояс">{item.timezone}</DefinitionList.Item>
            </DefinitionList>
          </Card>

          <Card view="outlined" className="p-4">
            <Flex direction="column" gap={3}>
              <Text variant="subheader-2">Интеграция камер</Text>
              <Flex alignItems="center" gap={2} wrap>
                <Text color="secondary">ID проекта</Text>
                <Text variant="code-inline-1">{item.id}</Text>
                <ClipboardButton text={item.id} size="s" />
              </Flex>
              <Flex alignItems="center" gap={2} wrap>
                <Text color="secondary">Ingest-токен</Text>
                <Text variant="code-inline-1">{item.ingestToken}</Text>
                <ClipboardButton text={item.ingestToken} size="s" />
                <Button view="outlined" onClick={() => setRotateOpen(true)}>
                  <Icon data={ArrowRotateLeft} />
                  Обновить токен
                </Button>
              </Flex>
            </Flex>
          </Card>

          <Card view="outlined" className="p-4">
            <Flex direction="column" gap={3}>
              <Flex justifyContent="space-between" alignItems="center">
                <Text variant="subheader-2">Календарный план</Text>
                <Button view="flat" href={`/projects/${projectId}/plan`}>
                  Открыть сопоставление
                </Button>
              </Flex>

              {plan ? (
                <Flex alignItems="center" gap={3} wrap>
                  <StatusLabel kind="plan" status={plan.status} extra={`v${plan.version}`} />
                  <Text>{plan.sourceFile}</Text>
                  {plan.status === 'PROCESSING' && (
                    <Flex alignItems="center" gap={2}>
                      <Spin size="s" />
                      <Text color="secondary">Импорт выполняется…</Text>
                    </Flex>
                  )}
                </Flex>
              ) : (
                <Text color="secondary">План ещё не загружен</Text>
              )}

              {plan?.status === 'FAILED' && plan.lastError && (
                <Alert theme="danger" view="filled" title="Импорт не удался" message={plan.lastError} />
              )}

              <Flex alignItems="center" gap={3} wrap>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".mpp,.xml"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    setPlanFile(file);
                    event.target.value = '';
                  }}
                />
                <Button view="outlined" onClick={() => fileRef.current?.click()}>
                  Выбрать файл .mpp / .xml
                </Button>
                {planFile && (
                  <FilePreview
                    file={planFile}
                    actions={[
                      {
                        id: 'remove',
                        title: 'Убрать',
                        icon: <Icon data={Xmark} size={16} />,
                        onClick: () => setPlanFile(null),
                      },
                    ]}
                  />
                )}
                <Button
                  view="action"
                  disabled={!planFile}
                  loading={upload.isPending}
                  onClick={() => planFile && upload.mutate(planFile)}
                >
                  Загрузить план
                </Button>
              </Flex>
            </Flex>
          </Card>

          <Card view="outlined" className="p-4">
            <Flex direction="column" gap={3}>
              <Text variant="subheader-2">История версий</Text>
              <QueryState
                isLoading={plans.isLoading}
                isError={plans.isError}
                error={plans.error}
                onRetry={() => void plans.refetch()}
                isEmpty={!plans.isLoading && (plans.data?.length ?? 0) === 0}
                emptyTitle="Версий плана пока нет"
                skeletonHeight={80}
              >
                <Table
                  data={plans.data ?? []}
                  columns={planColumns}
                  getRowId={(row) => row.id}
                />
              </QueryState>
            </Flex>
          </Card>

          <Dialog open={editOpen} onClose={() => setEditOpen(false)} size="m">
            <Dialog.Header caption="Реквизиты проекта" />
            <Dialog.Body>
              <Flex direction="column" gap={3}>
                <TextInput
                  label="Название"
                  value={form.name}
                  onUpdate={(value) => setForm((current) => ({ ...current, name: value }))}
                />
                <TextInput
                  label="Заказчик"
                  value={form.customer}
                  onUpdate={(value) => setForm((current) => ({ ...current, customer: value }))}
                />
                <TextInput
                  label="Подрядчик"
                  value={form.contractor}
                  onUpdate={(value) => setForm((current) => ({ ...current, contractor: value }))}
                />
                <TextInput
                  label="Адрес"
                  value={form.address}
                  onUpdate={(value) => setForm((current) => ({ ...current, address: value }))}
                />
              </Flex>
            </Dialog.Body>
            <Dialog.Footer
              onClickButtonCancel={() => setEditOpen(false)}
              onClickButtonApply={() => save.mutate()}
              textButtonApply="Сохранить"
              textButtonCancel="Отмена"
              propsButtonApply={{ loading: save.isPending, disabled: !form.name.trim() }}
            />
          </Dialog>

          <Dialog open={rotateOpen} onClose={() => setRotateOpen(false)} size="s">
            <Dialog.Header caption="Обновить ingest-токен?" />
            <Dialog.Body>
              <Text>
                Текущий токен перестанет работать. Камеры нужно будет перенастроить на новый.
              </Text>
            </Dialog.Body>
            <Dialog.Footer
              onClickButtonCancel={() => setRotateOpen(false)}
              onClickButtonApply={() => rotate.mutate()}
              textButtonApply="Обновить"
              textButtonCancel="Отмена"
              propsButtonApply={{
                view: 'outlined-danger',
                loading: rotate.isPending,
              }}
            />
          </Dialog>
        </Flex>
      )}
    </QueryState>
  );
}
