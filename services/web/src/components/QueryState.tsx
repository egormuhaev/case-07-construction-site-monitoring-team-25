import type { ReactNode } from 'react';
import { Magnifier } from '@gravity-ui/icons';
import { Alert, Icon, PlaceholderContainer, Skeleton } from '@gravity-ui/uikit';

type QueryStateProps = {
  isLoading?: boolean;
  isError?: boolean;
  error?: unknown;
  isEmpty?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  onRetry?: () => void;
  skeletonHeight?: number;
  children: ReactNode;
};

export function QueryState({
  isLoading,
  isError,
  error,
  isEmpty,
  emptyTitle = 'Нет данных',
  emptyDescription,
  onRetry,
  skeletonHeight = 160,
  children,
}: QueryStateProps) {
  if (isLoading) {
    return <Skeleton style={{ height: skeletonHeight, width: '100%' }} />;
  }
  if (isError) {
    const message =
      error instanceof Error ? error.message : 'Не удалось загрузить данные';
    return (
      <Alert
        theme="danger"
        view="filled"
        title="Ошибка загрузки"
        message={message}
        actions={
          onRetry
            ? [{ text: 'Повторить', handler: onRetry }]
            : undefined
        }
      />
    );
  }
  if (isEmpty) {
    return (
      <PlaceholderContainer
        title={emptyTitle}
        description={emptyDescription}
        size="l"
        align="center"
        image={<Icon data={Magnifier} size={48} />}
      />
    );
  }
  return <>{children}</>;
}
