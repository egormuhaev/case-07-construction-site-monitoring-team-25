import { useEffect, useRef, useState } from 'react';
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
import { api, formatInTimeZone, type ProjectImage } from '../api';
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

  const [activeAnalysisRunId, setActiveAnalysisRunId] = useState<string | null>(null);

  const project = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.project(projectId),
    enabled: Boolean(projectId),
  });
  const timezone = project.data?.timezone ?? 'Europe/Moscow';

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
      void queryClient.invalidateQueries({ queryKey: ['day-analysis', projectId, day] });
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

  const dayStatus = details.data?.status;
  const completedAnalysis = useQuery({
    queryKey: ['day-analysis', projectId, day],
    queryFn: () => api.dayAnalysis(projectId, day),
    enabled: Boolean(projectId && day),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data?.status === 'RUNNING') return 3000;
      if (dayStatus === 'DETECTED' && (!data?.id || data.status === 'RUNNING')) return 4000;
      return false;
    },
  });

  useEffect(() => {
    if (completedAnalysis.data?.status === 'RUNNING' && completedAnalysis.data.id) {
      setActiveAnalysisRunId(completedAnalysis.data.id);
    }
  }, [completedAnalysis.data?.id, completedAnalysis.data?.status]);

  const activeAnalysis = useQuery({
    queryKey: ['analysis-run', activeAnalysisRunId],
    queryFn: () => api.analysisRun(activeAnalysisRunId!),
    enabled: Boolean(activeAnalysisRunId),
    refetchInterval: (query) => (query.state.data?.status === 'RUNNING' ? 3000 : false),
  });

  const startAnalysis = useMutation({
    mutationFn: () => api.startDayAnalysis(projectId, day),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['day-analysis', projectId, day] });
      if (result.reused) {
        toast.success('Отчёт уже готов');
        navigate(`/projects/${projectId}/days/${day}/analysis/${result.run.id}`);
        return;
      }
      setActiveAnalysisRunId(result.run.id);
      toast.success('Подготовка отчёта запущена');
    },
    onError: (error) => toast.error('Не удалось подготовить отчёт', error),
  });

  const data = details.data;
  const images = data?.images ?? [];
  const manual = images.filter((image) => image.source === 'MANUAL');
  const automatic = images.filter((image) => image.source === 'API');
  const analysisData =
    activeAnalysis.data && activeAnalysis.data.status !== 'FAILED'
      ? activeAnalysis.data
      : completedAnalysis.data?.id
        ? completedAnalysis.data
        : undefined;
  const completedDetection =
    data?.latestRun?.status === 'COMPLETED' ? data.latestRun : null;
  const reportReady = Boolean(completedAnalysis.data?.current && completedAnalysis.data.id);
  const framesStale =
    Boolean(completedDetection) &&
    completedAnalysis.data?.current === false &&
    completedAnalysis.data?.staleReason === 'набор кадров изменился после детекции';
  const canPrepare =
    Boolean(completedDetection) &&
    !reportReady &&
    !framesStale &&
    !startAnalysis.isPending &&
    analysisData?.status !== 'RUNNING';

  useEffect(() => {
    if (activeAnalysis.data?.status === 'COMPLETED') {
      void queryClient.invalidateQueries({ queryKey: ['day-analysis', projectId, day] });
      navigate(`/projects/${projectId}/days/${day}/analysis/${activeAnalysis.data.id}`);
    }
  }, [activeAnalysis.data?.status, activeAnalysis.data?.id, day, navigate, projectId, queryClient]);

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
          {analysisData?.status === 'RUNNING' && (
            <Flex alignItems="center" gap={2}>
              <Spin size="s" />
              <Text color="secondary">Готовится отчёт…</Text>
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
          {reportReady ? (
            <Button
              view="outlined"
              onClick={() =>
                navigate(`/projects/${projectId}/days/${day}/analysis/${completedAnalysis.data!.id}`)
              }
            >
              Открыть отчёт анализа
            </Button>
          ) : (
            <Button
              view="outlined"
              disabled={!canPrepare}
              loading={startAnalysis.isPending || analysisData?.status === 'RUNNING'}
              onClick={() => startAnalysis.mutate()}
            >
              Подготовить отчёт
            </Button>
          )}
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
              Открыть отчёт детекции
            </Button>
          </Flex>
        </Card>
      )}

      <Card view="outlined" className="p-4">
        <Flex justifyContent="space-between" alignItems="center" wrap gap={3} className="mb-3">
          <Text variant="subheader-2">Анализ дня</Text>
          {analysisData?.observability && (
            <StatusLabel kind="observability" status={analysisData.observability} />
          )}
        </Flex>
        {!completedDetection && !completedAnalysis.isLoading && (
          <Text color="secondary">Сначала завершите детекцию за день.</Text>
        )}
        {framesStale && (
          <Text color="warning">
            Набор кадров изменился после детекции. Повторите детекцию, затем подготовьте отчёт.
          </Text>
        )}
        {completedDetection && !reportReady && !framesStale && !analysisData && (
          <Text color="secondary">
            Детекция готова. Отчёт часто стартует сам — можно подождать или нажать «Подготовить отчёт».
          </Text>
        )}
        {(completedAnalysis.isLoading || activeAnalysis.isLoading) && !analysisData && (
          <Spin size="s" />
        )}
        {analysisData && (
          <Flex direction="column" gap={3}>
            <Flex gap={4} wrap>
              <Text color="secondary">
                Статус: <StatusLabel kind="run" status={analysisData.status} />
              </Text>
              <Text color="secondary">
                Сигналов:{' '}
                {String(
                  (analysisData.summary as { findingCount?: number })?.findingCount ??
                    analysisData.findings?.length ??
                    0,
                )}
              </Text>
              {completedAnalysis.data?.current === false && completedAnalysis.data.staleReason && (
                <Text color="warning">{completedAnalysis.data.staleReason}</Text>
              )}
            </Flex>
            <div className="flex flex-wrap gap-2">
              {(analysisData.classes ?? []).map((row) => (
                <StatusLabel
                  key={row.id}
                  kind="verdict"
                  status={row.verdict}
                  extra={row.classTitle || row.classCode}
                />
              ))}
            </div>
            {analysisData.status === 'COMPLETED' && analysisData.id && (
              <Button
                view="flat-secondary"
                onClick={() =>
                  navigate(`/projects/${projectId}/days/${day}/analysis/${analysisData.id}`)
                }
              >
                Открыть полный отчёт
              </Button>
            )}
          </Flex>
        )}
      </Card>

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
            <Gallery images={manual} timezone={timezone} onOpen={setPreview} />
          </TabPanel>
          <TabPanel value="api">
            <Gallery images={automatic} timezone={timezone} onOpen={setPreview} />
          </TabPanel>
        </TabProvider>
      </QueryState>

      <Dialog open={uploadOpen} onClose={() => setUploadOpen(false)} size="m">
        <Dialog.Header caption="Загрузка кадров" />
        <Dialog.Body>
          <Flex direction="column" gap={3}>
            <Text color="secondary">
              Время указывается по часовому поясу стройки ({timezone}). По умолчанию — 12:00.
            </Text>
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
              {formatInTimeZone(preview.capturedAt, timezone)}
            </Text>
          </div>
        )}
      </Modal>
    </Flex>
  );
}

function Gallery({
  images,
  timezone,
  onOpen,
}: {
  images: ProjectImage[];
  timezone: string;
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
        <GalleryCard key={image.id} image={image} timezone={timezone} onOpen={onOpen} />
      ))}
    </div>
  );
}

function GalleryCard({
  image,
  timezone,
  onOpen,
}: {
  image: ProjectImage;
  timezone: string;
  onOpen: (image: ProjectImage) => void;
}) {
  const [broken, setBroken] = useState(false);
  return (
    <button
      type="button"
      className="overflow-hidden rounded border border-[var(--g-color-line-generic)] text-left"
      onClick={() => onOpen(image)}
    >
      {broken ? (
        <div className="flex h-36 w-full flex-col items-center justify-center gap-1 bg-[var(--g-color-base-generic)] px-2 text-center">
          <Text variant="caption-2">{image.originalName ?? 'Кадр'}</Text>
          <Text variant="caption-2" color="secondary">
            Не удалось показать превью
          </Text>
        </div>
      ) : (
        <img
          src={api.imageFile(image.id)}
          alt={image.originalName ?? image.id}
          className="h-36 w-full object-cover"
          onError={() => setBroken(true)}
        />
      )}
      <div className="p-2 text-xs text-[var(--g-color-text-secondary)]">
        {formatInTimeZone(image.capturedAt, timezone)}
        {image.originalName ? ` · ${image.originalName}` : ''}
      </div>
    </button>
  );
}
