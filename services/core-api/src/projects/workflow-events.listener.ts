import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WORKFLOW_COMPLETED, WORKFLOW_FAILED } from '../workflows/workflow-engine.service';
import { ProjectPlan } from './entities/project-plan.entity';
import { ProjectDay } from './entities/project-day.entity';
import { ProjectImage } from './entities/project-image.entity';
import { DetectionFrame, DetectionObject, DetectionRun } from './entities/detection.entities';

@Injectable()
export class WorkflowEventsListener {
  private readonly logger = new Logger(WorkflowEventsListener.name);

  constructor(
    @InjectRepository(ProjectPlan) private readonly plans: Repository<ProjectPlan>,
    @InjectRepository(ProjectDay) private readonly days: Repository<ProjectDay>,
    @InjectRepository(ProjectImage) private readonly images: Repository<ProjectImage>,
    @InjectRepository(DetectionRun) private readonly runs: Repository<DetectionRun>,
    @InjectRepository(DetectionFrame) private readonly frames: Repository<DetectionFrame>,
    @InjectRepository(DetectionObject) private readonly objects: Repository<DetectionObject>,
  ) {}

  @OnEvent(WORKFLOW_COMPLETED)
  async completed(event: {
    workflowId: string;
    pipeline: string;
    payload: Record<string, unknown>;
    result: Record<string, unknown>;
  }) {
    if (event.pipeline === 'plan-import') {
      await this.onPlanDone(event, true);
    }
    if (event.pipeline === 'day-detection') {
      await this.onDetectionDone(event, true);
    }
  }

  @OnEvent(WORKFLOW_FAILED)
  async failed(event: {
    workflowId: string;
    pipeline?: string;
    payload: Record<string, unknown>;
    error: string;
  }) {
    if (event.pipeline === 'plan-import') {
      await this.onPlanDone(event, false, event.error);
    }
    if (event.pipeline === 'day-detection') {
      await this.onDetectionDone(event, false, event.error);
    }
  }

  private async onPlanDone(
    event: { workflowId: string; payload: Record<string, unknown> },
    ok: boolean,
    error?: string,
  ) {
    const planId = String(event.payload.planId ?? '');
    const projectId = String(event.payload.projectId ?? '');
    const plan = await this.plans.findOneBy({ id: planId });
    if (!plan) {
      this.logger.warn(`план ${planId} не найден после workflow ${event.workflowId}`);
      return;
    }
    if (ok) {
      await this.plans.update({ projectId, isActive: true }, { isActive: false });
      plan.isActive = true;
      plan.status = 'READY';
      plan.lastError = null;
    } else {
      plan.status = 'FAILED';
      plan.lastError = error ?? 'импорт плана не удался';
    }
    await this.plans.save(plan);
  }

  private async onDetectionDone(
    event: { workflowId: string; payload: Record<string, unknown>; result?: Record<string, unknown> },
    ok: boolean,
    error?: string,
  ) {
    const dayId = String(event.payload.dayId ?? '');
    const day = await this.days.findOneBy({ id: dayId });
    const run = await this.runs.findOne({
      where: { workflowId: event.workflowId },
      order: { startedAt: 'DESC' },
    });
    if (day) {
      day.status = ok ? 'DETECTED' : 'FAILED';
      await this.days.save(day);
    }
    if (run) {
      run.status = ok ? 'COMPLETED' : 'FAILED';
      run.finishedAt = new Date();
      run.lastError = ok ? null : error ?? 'детекция не удалась';
      await this.runs.save(run);
    }
    if (!ok || !run || !event.result) {
      return;
    }
    const frames = Array.isArray(event.result.frames) ? event.result.frames : [];
    const images = await this.images.find({ where: { dayId } });
    const byPath = new Map(images.map((image) => [image.relativePath, image]));
    for (const raw of frames) {
      if (!raw || typeof raw !== 'object') {
        continue;
      }
      const frame = raw as Record<string, unknown>;
      const image = byPath.get(String(frame.image_path ?? ''));
      if (!image) {
        continue;
      }
      const size = (frame.image_size as { width?: number; height?: number } | undefined) ?? {};
      const savedFrame = await this.frames.save(
        this.frames.create({
          runId: run.id,
          imageId: image.id,
          cameraId: frame.camera_id ? String(frame.camera_id) : image.cameraExternalId,
          capturedAt: image.capturedAt,
          width: size.width ?? image.width,
          height: size.height ?? image.height,
        }),
      );
      const objects = Array.isArray(frame.objects) ? frame.objects : [];
      for (const item of objects) {
        if (!item || typeof item !== 'object') {
          continue;
        }
        const obj = item as Record<string, unknown>;
        const bbox = (obj.bbox as Record<string, number> | undefined) ?? {};
        const classification = obj.classification as
          | { source?: string; confidence?: number }
          | null
          | undefined;
        await this.objects.save(
          this.objects.create({
            frameId: savedFrame.id,
            classCode: String(obj.class ?? 'UNKNOWN_EQUIPMENT'),
            x1: Number(bbox.x1 ?? 0),
            y1: Number(bbox.y1 ?? 0),
            x2: Number(bbox.x2 ?? 0),
            y2: Number(bbox.y2 ?? 0),
            detectionConfidence: Number(obj.detection_confidence ?? 0),
            classificationSource: classification?.source ?? null,
            classificationConfidence: classification?.confidence ?? null,
            needsRefinement: Boolean(obj.needs_refinement),
          }),
        );
      }
    }
  }
}
