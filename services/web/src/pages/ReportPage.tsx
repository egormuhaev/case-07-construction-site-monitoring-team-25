import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import {
  Card,
  Checkbox,
  Flex,
  Text,
} from '@gravity-ui/uikit';
import { api, type DetectionFrame, type DetectionObject } from '../api';
import { QueryState } from '../components/QueryState';
import { StatusLabel } from '../components/StatusLabel';

const COLORS = [
  '#e4572e',
  '#17bebb',
  '#2e86ab',
  '#f2c14e',
  '#76b041',
  '#8b5cf6',
  '#db2777',
  '#0f766e',
  '#ea580c',
  '#0891b2',
];

function colorForClass(code: string) {
  let hash = 0;
  for (let i = 0; i < code.length; i += 1) {
    hash = (hash * 31 + code.charCodeAt(i)) >>> 0;
  }
  return COLORS[hash % COLORS.length];
}

export default function ReportPage() {
  const { runId = '' } = useParams();
  const run = useQuery({
    queryKey: ['run', runId],
    queryFn: () => api.detectionRun(runId),
    refetchInterval: (query) => (query.state.data?.status === 'RUNNING' ? 4000 : false),
  });
  const frames = run.data?.frames ?? [];
  const classes = useMemo(() => {
    const set = new Set<string>();
    for (const frame of frames) {
      for (const object of frame.objects ?? []) {
        set.add(object.classCode);
      }
    }
    return [...set].sort();
  }, [frames]);
  const [hidden, setHidden] = useState<Record<string, boolean>>({});

  const counts = classes.map((code) => ({
    code,
    count: frames.reduce(
      (sum, frame) => sum + (frame.objects ?? []).filter((item) => item.classCode === code).length,
      0,
    ),
    color: colorForClass(code),
  }));
  const totalObjects = counts.reduce((sum, item) => sum + item.count, 0);

  return (
    <QueryState
      isLoading={run.isLoading}
      isError={run.isError}
      error={run.error}
      onRetry={() => void run.refetch()}
      isEmpty={!run.isLoading && !run.data}
      emptyTitle="Прогон не найден"
    >
      {run.data && (
        <Flex direction="column" gap={4}>
          <Flex justifyContent="space-between" alignItems="center" wrap gap={3}>
            <Text variant="header-1">Отчёт детекции</Text>
            <StatusLabel kind="run" status={run.data.status} />
          </Flex>

          <Card view="outlined" className="p-4">
            <Flex gap={6} wrap>
              <Text>
                Старт: {new Date(run.data.startedAt).toLocaleString('ru-RU')}
              </Text>
              <Text>
                Финиш:{' '}
                {run.data.finishedAt
                  ? new Date(run.data.finishedAt).toLocaleString('ru-RU')
                  : '—'}
              </Text>
              <Text>Кадров: {frames.length}</Text>
              <Text>Объектов: {totalObjects}</Text>
              <Text>Триггер: {run.data.trigger}</Text>
            </Flex>
            {run.data.lastError && (
              <Text color="danger" className="mt-2 block">
                {run.data.lastError}
              </Text>
            )}
          </Card>

          <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
            <Card view="outlined" className="sticky top-4 h-fit p-4">
              <Text variant="subheader-2" className="mb-3 block">
                Классы
              </Text>
              <Flex direction="column" gap={2}>
                {counts.map((item) => (
                  <Checkbox
                    key={item.code}
                    checked={!hidden[item.code]}
                    onUpdate={(value) =>
                      setHidden((current) => ({ ...current, [item.code]: !value }))
                    }
                  >
                    <Flex alignItems="center" gap={2}>
                      <span
                        className="inline-block h-3 w-3 rounded-sm"
                        style={{ background: item.color }}
                      />
                      <span>
                        {item.code} ({item.count})
                      </span>
                    </Flex>
                  </Checkbox>
                ))}
                {counts.length === 0 && (
                  <Text color="secondary">Объектов пока нет</Text>
                )}
              </Flex>
            </Card>

            <Flex direction="column" gap={4}>
              {frames.length === 0 ? (
                <QueryState
                  isEmpty
                  emptyTitle="Кадров в отчёте нет"
                  emptyDescription="Дождитесь завершения прогона"
                >
                  {null}
                </QueryState>
              ) : (
                frames.map((frame) => (
                  <FrameCard key={frame.id} frame={frame} hidden={hidden} />
                ))
              )}
            </Flex>
          </div>
        </Flex>
      )}
    </QueryState>
  );
}

function FrameCard({
  frame,
  hidden,
}: {
  frame: DetectionFrame;
  hidden: Record<string, boolean>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const objects = (frame.objects ?? []).filter((item) => !hidden[item.classCode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const image = new window.Image();
    image.onload = () => {
      const maxWidth = wrap.clientWidth || image.width;
      const scale = Math.min(1, maxWidth / image.width);
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      const drawn = (frame.objects ?? []).filter((item) => !hidden[item.classCode]);
      drawn.forEach((object) => drawBox(ctx, object, scale));
    };
    image.src = api.imageFile(frame.imageId);
  }, [frame, hidden]);

  return (
    <Card view="outlined" className="p-4">
      <Text className="mb-2 block">
        {frame.cameraId ? `Камера ${frame.cameraId}` : 'Кадр'} · объектов {objects.length}
      </Text>
      <div ref={wrapRef}>
        <canvas ref={canvasRef} className="max-w-full" />
      </div>
    </Card>
  );
}

function drawBox(ctx: CanvasRenderingContext2D, object: DetectionObject, scale: number) {
  const color = colorForClass(object.classCode);
  const x = object.x1 * scale;
  const y = object.y1 * scale;
  const w = (object.x2 - object.x1) * scale;
  const h = (object.y2 - object.y1) * scale;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, 3 * scale);
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = color;
  ctx.font = `${Math.max(12, 16 * scale)}px sans-serif`;
  const label = `${object.detectionClass?.title ?? object.classCode} ${object.detectionConfidence.toFixed(2)}`;
  ctx.fillText(label, x + 4, Math.max(14, y - 6));
}
