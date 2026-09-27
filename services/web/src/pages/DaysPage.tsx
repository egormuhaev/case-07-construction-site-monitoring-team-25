import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { DatePicker } from '@gravity-ui/date-components';
import { dateTimeParse } from '@gravity-ui/date-utils';
import { Button, Flex, Table, Text, type TableColumnConfig } from '@gravity-ui/uikit';
import { api, type DayRow } from '../api';
import { QueryState } from '../components/QueryState';
import { StatusLabel } from '../components/StatusLabel';

export default function DaysPage() {
  const { projectId = '' } = useParams();
  const navigate = useNavigate();
  const [day, setDay] = useState(new Date().toISOString().slice(0, 10));
  const days = useQuery({ queryKey: ['days', projectId], queryFn: () => api.days(projectId) });

  const columns: TableColumnConfig<DayRow>[] = [
    {
      id: 'day',
      name: 'День',
      primary: true,
      template: (row) => row.day,
    },
    {
      id: 'status',
      name: 'Статус',
      template: (row) => <StatusLabel kind="day" status={row.status} />,
      width: 160,
    },
    {
      id: 'imageCount',
      name: 'Кадров',
      template: (row) => String(row.imageCount),
      width: 100,
      align: 'end',
    },
  ];

  return (
    <Flex direction="column" gap={4}>
      <Text variant="header-1">Дни проекта</Text>
      <Flex alignItems="flex-end" gap={3} wrap>
        <div className="w-56">
          <Text variant="caption-2" color="secondary" className="mb-1 block">
            Дата
          </Text>
          <DatePicker
            format="YYYY-MM-DD"
            value={dateTimeParse(day) ?? null}
            onUpdate={(value) => {
              if (value) setDay(value.format('YYYY-MM-DD'));
            }}
          />
        </div>
        <Button
          view="action"
          disabled={!day}
          onClick={() => navigate(`/projects/${projectId}/days/${day}`)}
        >
          Открыть день
        </Button>
      </Flex>

      <QueryState
        isLoading={days.isLoading}
        isError={days.isError}
        error={days.error}
        onRetry={() => void days.refetch()}
        isEmpty={!days.isLoading && (days.data?.length ?? 0) === 0}
        emptyTitle="Дней пока нет"
        emptyDescription="Откройте дату выше или дождитесь кадров с камер"
      >
        <Table
          data={days.data ?? []}
          columns={columns}
          getRowId={(row) => row.id}
          onRowClick={(row) => navigate(`/projects/${projectId}/days/${row.day}`)}
        />
      </QueryState>
    </Flex>
  );
}
