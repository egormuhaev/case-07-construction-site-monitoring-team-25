import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Magnifier, Plus } from '@gravity-ui/icons';
import {
  Button,
  Dialog,
  Flex,
  Icon,
  Table,
  Text,
  TextInput,
  type TableColumnConfig,
} from '@gravity-ui/uikit';
import { api, type Project } from '../api';
import { QueryState } from '../components/QueryState';
import { useMutationToast } from '../hooks/useMutationToast';

export default function ProjectsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useMutationToast();
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects });
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');

  const create = useMutation({
    mutationFn: () => api.createProject({ name: name.trim(), address: address.trim() || undefined }),
    onSuccess: (project) => {
      setName('');
      setAddress('');
      setDialogOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      toast.success('Проект создан');
      navigate(`/projects/${project.id}`);
    },
    onError: (error) => toast.error('Не удалось создать проект', error),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = projects.data ?? [];
    if (!q) return rows;
    return rows.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        (item.address ?? '').toLowerCase().includes(q) ||
        item.timezone.toLowerCase().includes(q),
    );
  }, [projects.data, search]);

  const columns: TableColumnConfig<Project>[] = [
    {
      id: 'name',
      name: 'Название',
      primary: true,
      template: (item) => item.name,
    },
    {
      id: 'address',
      name: 'Адрес',
      template: (item) => item.address || '—',
    },
    {
      id: 'timezone',
      name: 'Часовой пояс',
      template: (item) => item.timezone,
      width: 160,
    },
    {
      id: 'createdAt',
      name: 'Создан',
      template: (item) => new Date(item.createdAt).toLocaleString('ru-RU'),
      width: 180,
    },
  ];

  return (
    <Flex direction="column" gap={4}>
      <Flex justifyContent="space-between" alignItems="center">
        <Text variant="header-1">Проекты</Text>
        <Button view="action" onClick={() => setDialogOpen(true)}>
          <Icon data={Plus} />
          Новый проект
        </Button>
      </Flex>

      <TextInput
        placeholder="Поиск по названию, адресу, таймзоне"
        value={search}
        onUpdate={setSearch}
        startContent={<Icon data={Magnifier} size={16} />}
        hasClear
        className="max-w-md"
      />

      <QueryState
        isLoading={projects.isLoading}
        isError={projects.isError}
        error={projects.error}
        onRetry={() => void projects.refetch()}
        isEmpty={!projects.isLoading && filtered.length === 0}
        emptyTitle={search ? 'Ничего не найдено' : 'Пока нет проектов'}
        emptyDescription={
          search ? 'Измените запрос или сбросьте поиск' : 'Создайте первый проект, чтобы начать'
        }
      >
        <Table
          data={filtered}
          columns={columns}
          getRowId={(item) => item.id}
          onRowClick={(item) => navigate(`/projects/${item.id}`)}
          emptyMessage="Нет проектов"
        />
      </QueryState>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} size="s">
        <Dialog.Header caption="Новый проект" />
        <Dialog.Body>
          <Flex direction="column" gap={3}>
            <TextInput label="Название" value={name} onUpdate={setName} autoFocus />
            <TextInput label="Адрес" value={address} onUpdate={setAddress} />
          </Flex>
        </Dialog.Body>
        <Dialog.Footer
          onClickButtonCancel={() => setDialogOpen(false)}
          onClickButtonApply={() => create.mutate()}
          textButtonApply="Создать"
          textButtonCancel="Отмена"
          propsButtonApply={{
            loading: create.isPending,
            disabled: !name.trim(),
          }}
        />
      </Dialog>
    </Flex>
  );
}
