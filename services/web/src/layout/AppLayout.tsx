import { useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AsideHeader, FooterItem } from '@gravity-ui/navigation';
import {
  Calendar,
  ChartColumn,
  DisplayPulse,
  FolderTree,
  Moon,
  SquareListUl,
  Sun,
} from '@gravity-ui/icons';
import { Breadcrumbs, Flex, Text } from '@gravity-ui/uikit';
import { api } from '../api';
import { useAppTheme } from '../theme';

const COMPACT_KEY = 'monitoring-aside-compact';

function readCompact() {
  return localStorage.getItem(COMPACT_KEY) === '1';
}

export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { projectId = '', day = '', runId = '' } = useParams();
  const { theme, setTheme } = useAppTheme();
  const [compact, setCompact] = useState(readCompact);

  const project = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.project(projectId),
    enabled: Boolean(projectId),
  });

  const menuItems = useMemo(() => {
    const items = [
      {
        id: 'projects',
        title: 'Проекты',
        icon: FolderTree,
        current: location.pathname === '/',
        onItemClick: () => navigate('/'),
      },
    ];
    if (!projectId) {
      return items;
    }
    const base = `/projects/${projectId}`;
    return [
      ...items,
      { id: 'divider-project', title: '', type: 'divider' as const },
      {
        id: 'card',
        title: 'Карточка',
        icon: SquareListUl,
        current: location.pathname === base,
        onItemClick: () => navigate(base),
      },
      {
        id: 'plan',
        title: 'План',
        icon: Calendar,
        current: location.pathname.startsWith(`${base}/plan`),
        onItemClick: () => navigate(`${base}/plan`),
      },
      {
        id: 'days',
        title: 'Дни',
        icon: DisplayPulse,
        current: location.pathname.startsWith(`${base}/days`),
        onItemClick: () => navigate(`${base}/days`),
      },
      {
        id: 'analysis',
        title: 'Нарушения',
        icon: ChartColumn,
        current: location.pathname.startsWith(`${base}/analysis`),
        onItemClick: () => navigate(`${base}/analysis`),
      },
    ];
  }, [location.pathname, navigate, projectId]);

  const crumbs = useMemo(() => {
    const items: Array<{ text: string; action?: () => void }> = [
      { text: 'Проекты', action: () => navigate('/') },
    ];
    if (projectId) {
      items.push({
        text: project.data?.name ?? 'Проект',
        action: () => navigate(`/projects/${projectId}`),
      });
      if (location.pathname.includes('/plan')) {
        items.push({ text: 'План' });
      } else if (location.pathname.includes('/analysis')) {
        items.push({ text: 'Нарушения' });
      } else if (location.pathname.includes('/days')) {
        items.push({
          text: 'Дни',
          action: day ? () => navigate(`/projects/${projectId}/days`) : undefined,
        });
        if (day) {
          items.push({
            text: day,
            action: runId
              ? () => navigate(`/projects/${projectId}/days/${day}`)
              : undefined,
          });
        }
        if (runId) {
          items.push({ text: 'Отчёт детекции' });
        }
      } else if (location.pathname === `/projects/${projectId}`) {
        items.push({ text: 'Карточка' });
      }
    }
    return items;
  }, [day, location.pathname, navigate, project.data?.name, projectId, runId]);

  return (
    <AsideHeader
      logo={{
        text: 'Мониторинг стройки',
        href: '/',
        onClick: (event) => {
          event.preventDefault();
          navigate('/');
        },
      }}
      compact={compact}
      onChangeCompact={(value) => {
        localStorage.setItem(COMPACT_KEY, value ? '1' : '0');
        setCompact(value);
      }}
      menuItems={menuItems}
      renderFooter={() => (
        <FooterItem
          id="theme"
          title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
          icon={theme === 'dark' ? Sun : Moon}
          onItemClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        />
      )}
      renderContent={() => (
        <Flex direction="column" gap={4} className="mx-auto w-full max-w-[1440px] px-6 py-5">
          {crumbs.length > 1 && (
            <Breadcrumbs>
              {crumbs.map((item, index) => (
                <Breadcrumbs.Item
                  key={`${item.text}-${index}`}
                  onClick={item.action}
                  disabled={!item.action}
                >
                  {item.text}
                </Breadcrumbs.Item>
              ))}
            </Breadcrumbs>
          )}
          {projectId && project.isError ? (
            <Text color="danger">Не удалось загрузить проект</Text>
          ) : (
            <Outlet />
          )}
        </Flex>
      )}
    />
  );
}
