import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { StepStatus, WorkflowStep } from '../workflows/entities/workflow-step.entity';
import { ExecuteStepJobData, PROCESS_STEP_JOB, WORKFLOW_QUEUE } from './queue.constants';

const ACTIVE_STATUSES = [
  StepStatus.PENDING,
  StepStatus.SUBMITTING,
  StepStatus.PROCESSING,
  StepStatus.WAITING_FOR_SERVICE,
];

@Injectable()
export class WorkflowDispatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkflowDispatcherService.name);
  private readonly intervalMs = Number(process.env.DISPATCH_INTERVAL_MS ?? 1000);
  private readonly leaseMs = Number(process.env.DISPATCH_LEASE_MS ?? 60000);
  private readonly retryDelayMs = Number(process.env.DISPATCH_RETRY_DELAY_MS ?? 5000);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @InjectRepository(WorkflowStep)
    private readonly stepRepo: Repository<WorkflowStep>,
    @InjectQueue(WORKFLOW_QUEUE)
    private readonly queue: Queue<ExecuteStepJobData>,
  ) {}

  onModuleInit() {
    void this.dispatchNow();
    this.timer = setInterval(() => void this.dispatchNow(), this.intervalMs);
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  async dispatchNow() {
    if (this.running) {
      return;
    }

    this.running = true;
    try {
      await this.dispatchDueSteps();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Could not dispatch workflow steps: ${message}`);
    } finally {
      this.running = false;
    }
  }

  private async dispatchDueSteps() {
    const now = new Date();
    const dueSteps = await this.stepRepo
      .createQueryBuilder('step')
      .where('step.status IN (:...statuses)', { statuses: ACTIVE_STATUSES })
      .andWhere('step.nextAttemptAt <= :now', { now })
      .orderBy('step.nextAttemptAt', 'ASC')
      .take(100)
      .getMany();

    for (const step of dueSteps) {
      await this.dispatchStep(step, now);
    }
  }

  private async dispatchStep(step: WorkflowStep, now: Date) {
    const leaseUntil = new Date(Date.now() + this.leaseMs);
    const claimed = await this.stepRepo
      .createQueryBuilder()
      .update(WorkflowStep)
      .set({ nextAttemptAt: leaseUntil })
      .where('id = :id', { id: step.id })
      .andWhere('status IN (:...statuses)', { statuses: ACTIVE_STATUSES })
      .andWhere('"nextAttemptAt" <= :now', { now })
      .execute();

    if (!claimed.affected) {
      return;
    }

    try {
      await this.queue.add(
        PROCESS_STEP_JOB,
        { workflowId: step.workflowId, stepId: step.id },
        {
          jobId: `${step.id}-${leaseUntil.getTime()}`,
          attempts: 1,
          removeOnComplete: { age: 86400 },
          removeOnFail: { age: 604800 },
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Queue is unavailable for step ${step.id}: ${message}`);
      await this.stepRepo
        .createQueryBuilder()
        .update(WorkflowStep)
        .set({ nextAttemptAt: new Date(Date.now() + this.retryDelayMs) })
        .where('id = :id', { id: step.id })
        .andWhere('"nextAttemptAt" = :leaseUntil', { leaseUntil })
        .execute();
    }
  }
}
