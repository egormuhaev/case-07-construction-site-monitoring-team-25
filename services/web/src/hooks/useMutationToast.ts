import { useToaster } from '@gravity-ui/uikit';

export function useMutationToast() {
  const { add } = useToaster();

  return {
    success: (title: string, content?: string) =>
      add({ name: `ok-${Date.now()}`, title, content, theme: 'success', autoHiding: 4000 }),
    error: (title: string, error?: unknown) =>
      add({
        name: `err-${Date.now()}`,
        title,
        content: error instanceof Error ? error.message : String(error ?? ''),
        theme: 'danger',
        autoHiding: 8000,
      }),
  };
}
