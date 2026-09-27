import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { Picture, Play } from '@gravity-ui/icons';
import {
  Button,
  Card,
  Dialog,
  FilePreview,
  Flex,
  Icon,
  Modal,
  Spin,
  Tab,
  TabList,
  TabPanel,
  TabProvider,
  Text,
} from '@gravity-ui/uikit';
import { api, type ProjectImage } from '../api';
import { QueryState } from '../components/QueryState';
import { StatusLabel } from '../components/StatusLabel';
import { useMutationToast } from '../hooks/useMutationToast';

type PendingFile = { file: File; time: string };

export default function DayPage() {
  const { projectId = '', day = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useMutationToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [detectOpen, setDetectOpen] = useState(false);
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [preview, setPreview] = useState<ProjectImage | null>(null);
  const [tab, setTab] = useState('manual');

  const details = useQuery({
    queryKey: ['day', projectId, day],
    queryFn: () => api.day(projectId, day),
    refetchInterval: (query) => (query.state.data?.status === 'DETECTING' ? 4000 : false),
  });

  const upload = useMutation({
    mutationFn: () => {
      const files = pending.map((item) => item.file);
      const captured = pending.map((item) => `${day}T${item.time || '12:00'}:00`);
      return api.uploadImages(projectId, day, files, captured);
    },
    onSuccess: () => {
      setPending([]);
      setUploadOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['day', projectId, day] });
      void queryClient.invalidateQueries({ queryKey: ['days', projectId] });
      toast.success('Кадры сохранены');
    },
    onError: (error) => toast.error('Не удалось загрузить кадры', error),
  });

  const detect = useMutation({
    mutationFn: () => api.startDetection(projectId, day),
    onSuccess: (result) => {
      setDetectOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['day', projectId, day] });
      toast.success('Детекция запущена');
      const runId = (result as { run?: { id?: string } }).run?.id;
      if (runId) navigate(`/projects/${projectId}/days/${day}/report/${runId}`);
    },
    onError: (error) => toast.error('Не удалось запустить детекцию', error),
  });

  const data = details.data;
  const images = data?.images ?? [];
  const manual = images.filter((image) => image.source === 'MANUAL');
  const automatic = images.filter((image) => image.source === 'API');

  return (
    <Flex direction="column" gap={4}>
      <Flex justifyContent="space-between" alignItems="center" wrap gap={3}>
        <Flex alignItems="center" gap={3}>
          <Text variant="header-1">День {day}</Text>
          {data && <StatusLabel kind="day" status={data.status} />}
          {data?.status === 'DETECTING' && (
            <Flex alignItems="center" gap={2}>
              <Spin size="s" />
              <Text color="secondary">Идёт детекция…</Text>
            </Flex>
          )}
        </Flex>
        <Flex gap={2}>
          <Button view="outlined" onClick={() => setUploadOpen(true)}>
            <Icon data={Picture} />
            Загрузить кадры
          </Button>
          <Button
            view="action"
            disabled={!images.length || data?.status === 'DETECTING'}
            onClick={() => setDetectOpen(true)}
          >
            <Icon data={Play} />
            Запустить детекцию
          </Button>
        </Flex>
      </Flex>

      {data?.latestRun && (
        <Card view="outlined" className="p-3">
          <Flex justifyContent="space-between" alignItems="center" wrap gap={2}>
            <Text>
              Последний прогон:{' '}
              <StatusLabel kind="run" status={data.latestRun.status} />
            </Text>
            <Button
              view="flat"
              href={`/projects/${projectId}/days/${day}/report/${data.latestRun.id}`}
            >
              Открыть отчёт
            </Button>
          </Flex>
        </Card>
      )}

      <QueryState
        isLoading={details.isLoading}
        isError={details.isError}
        error={details.error}
        onRetry={() => void details.refetch()}
      >
        <TabProvider value={tab} onUpdate={setTab}>
          <TabList>
            <Tab value="manual" counter={manual.length}>
              Ручная загрузка
            </Tab>
            <Tab value="api" counter={automatic.length}>
              С камер
            </Tab>
          </TabList>
          <TabPanel value="manual">
            <Gallery images={manual} onOpen={setPreview} />
          </TabPanel>
          <TabPanel value="api">
            <Gallery images={automatic} onOpen={setPreview} />
          </TabPanel>
        </TabProvider>
      </QueryState>

      <Dialog open={uploadOpen} onClose={() => setUploadOpen(false)} size="m">
        <Dialog.Header caption="Загрузка кадров" />
        <Dialog.Body>
          <Flex direction="column" gap={3}>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                setPending((current) => [
                  ...current,
                  ...files.map((file) => ({ file, time: '12:00' })),
                ]);
                event.target.value = '';
              }}
            />
            <Button view="outlined" onClick={() => fileRef.current?.click()}>
              Выбрать изображения
            </Button>
            <Flex gap={3} wrap>
              {pending.map((item, index) => (
                <Flex key={`${item.file.name}-${index}`} direction="column" gap={2} className="w-40">
                  <FilePreview
                    file={item.file}
                    actions={[
                      {
                        id: 'remove',
                        title: 'Убрать',
                        icon: <Text>×</Text>,
                        onClick: () =>
                          setPending((current) => current.filter((_, i) => i !== index)),
                      },
                    ]}
                  />
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-[var(--g-color-text-secondary)]">Время</span>
                    <input
                      type="time"
                      value={item.time}
                      onChange={(event) =>
                        setPending((current) =>
                          current.map((row, i) =>
                            i === index ? { ...row, time: event.target.value } : row,
                          ),
                        )
                      }
                      className="rounded border border-[var(--g-color-line-generic)] bg-[var(--g-color-base-background)] px-2 py-1"
                    />
                  </label>
                </Flex>
              ))}
            </Flex>
          </Flex>
        </Dialog.Body>
        <Dialog.Footer
          onClickButtonCancel={() => setUploadOpen(false)}
          onClickButtonApply={() => upload.mutate()}
          textButtonApply="Сохранить"
          textButtonCancel="Отмена"
          propsButtonApply={{ loading: upload.isPending, disabled: !pending.length }}
        />
      </Dialog>

      <Dialog open={detectOpen} onClose={() => setDetectOpen(false)} size="s">
        <Dialog.Header caption="Запустить детекцию?" />
        <Dialog.Body>
          <Text>Будет обработано кадров: {images.length}. Это может занять несколько минут.</Text>
        </Dialog.Body>
        <Dialog.Footer
          onClickButtonCancel={() => setDetectOpen(false)}
          onClickButtonApply={() => detect.mutate()}
          textButtonApply="Запустить"
          textButtonCancel="Отмена"
          propsButtonApply={{ loading: detect.isPending }}
        />
      </Dialog>

      <Modal open={Boolean(preview)} onOpenChange={(open) => !open && setPreview(null)}>
        {preview && (
          <div className="max-w-5xl p-4">
            <img
              src={api.imageFile(preview.id)}
              alt={preview.originalName ?? preview.id}
              className="max-h-[80vh] w-full object-contain"
            />
            <Text color="secondary" className="mt-2 block">
              {new Date(preview.capturedAt).toLocaleString('ru-RU')}
            </Text>
          </div>
        )}
      </Modal>
    </Flex>
  );
}

function Gallery({
  images,
  onOpen,
}: {
  images: ProjectImage[];
  onOpen: (image: ProjectImage) => void;
}) {
  if (!images.length) {
    return (
      <div className="py-8">
        <QueryState isEmpty emptyTitle="Нет кадров" emptyDescription="Добавьте изображения за этот день">
          {null}
        </QueryState>
      </div>
    );
  }
  return (
    <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-5">
      {images.map((image) => (
        <button
          key={image.id}
          type="button"
          className="overflow-hidden rounded border border-[var(--g-color-line-generic)] text-left"
          onClick={() => onOpen(image)}
        >
          <img
            src={api.imageFile(image.id)}
            alt={image.originalName ?? image.id}
            className="h-36 w-full object-cover"
          />
          <div className="p-2 text-xs text-[var(--g-color-text-secondary)]">
            {new Date(image.capturedAt).toLocaleString('ru-RU')}
          </div>
        </button>
      ))}
    </div>
  );
}
