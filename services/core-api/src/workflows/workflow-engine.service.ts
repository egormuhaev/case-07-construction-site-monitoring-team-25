import { Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { WorkflowCacheService } from '../cache/workflow-cache.service';
import { PipelineConfigService } from '../orchestrator/pipeline';
import { WorkflowDispatcherService } from '../orchestrator/workflow-dispatcher.service';
import {
  ExternalJobResponse,
  ServiceClientService,
  ServiceRequestError,
} from '../services/service-client.service';
import { Workflow, WorkflowStatus } from './entities/workflow.entity';
import { StepStatus, WorkflowStep } from './entities/workflow-step.entity';

export const WORKFLOW_COMPLETED = 'workflow.completed';
export const WORKFLOW_FAILED = 'workflow.failed';

@Injectable()
export class WorkflowEngineService {
  private readonly retryBaseDelayMs = Number(process.env.SERVICE_RETRY_BASE_DELAY_MS ?? 5000);
  private readonly retryMaxDelayMs = Number(process.env.SERVICE_RETRY_MAX_DELAY_MS ?? 300000);

  constructor(
    @InjectRepository(Workflow)
    private readonly workflowRepo: Repository<Workflow>,
    @InjectRepository(WorkflowStep)
    private readonly stepRepo: Repository<WorkflowStep>,
    private readonly dataSource: DataSource,
    private readonly cache: WorkflowCacheService,
    private readonly pipeline: PipelineConfigService,
    private readonly dispatcher: WorkflowDispatcherService,
    private readonly serviceClient: ServiceClientService,
    private readonly events: EventEmitter2,
  ) {}

  async start(pipelineName: string, payload: Record<string, unknown>) {
    const definitions = this.pipeline.getPipeline(pipelineName);
    const created = await this.dataSource.transaction(async (manager) => {
      const workflowRepo = manager.getRepository(Workflow);
      const stepRepo = manager.getRepository(WorkflowStep);
      const workflow = await workflowRepo.save(
        workflowRepo.create({
          pipeline: pipelineName,
          payload,
          status: WorkflowStatus.RUNNING,
          currentStep: definitions[0].name,
          result: null,
          lastError: null,
        }),
      );

      let firstStep: WorkflowStep | null = null;
      for (let i = 0; i < definitions.length; i += 1) {
        const definition = definitions[i];
        const step = await stepRepo.save(
          stepRepo.create({
            workflowId: workflow.id,
            stepIndex: i,
            name: definition.name,
            serviceName: definition.serviceName,
            serviceUrl: definition.serviceUrl,
            pollIntervalMs: definition.pollIntervalMs,
            status: StepStatus.PENDING,
            attemptsMade: 0,
            consecutiveFailures: 0,
            executionAttempt: 1,
            externalJobId: null,
            nextAttemptAt: i === 0 ? new Date() : null,
            input: i === 0 ? payload : null,
            output: null,
            lastError: null,
          }),
        );
        firstStep ??= step;
      }
      return { workflowId: workflow.id, firstStep };
    });

    if (created.firstStep?.input) {
      await this.cache.setStepInput(
        created.workflowId,
        created.firstStep.id,
        created.firstStep.input,
      );
    }
    await this.dispatcher.dispatchNow();
    return this.get(created.workflowId);
  }

  async get(id: string) {
    const workflow = await this.workflowRepo.findOne({
      where: { id },
      relations: { steps: true },
      order: { steps: { stepIndex: 'ASC' } },
    });
    if (!workflow) {
      throw new NotFoundException(`Workflow ${id} not found`);
    }
    return workflow;
  }

  async processStep(stepId: string) {
    const step = await this.stepRepo.findOneBy({ id: stepId });
    if (!step || [StepStatus.COMPLETED, StepStatus.FAILED].includes(step.status)) {
      return;
    }
    step.attemptsMade += 1;
    await this.stepRepo.save(step);
    try {
      if (!step.externalJobId) {
        await this.submitStep(step);
      } else {
        await this.pollStep(step);
      }
    } catch (error) {
      await this.handleServiceError(step, error);
    }
  }

  private async submitStep(step: WorkflowStep) {
    const input =
      (await this.cache.getStepInput<Record<string, unknown>>(step.workflowId, step.id)) ??
      step.input;
    if (!input) {
      await this.failStep(step, `No input available for step ${step.id}`);
      return;
    }
    step.status = StepStatus.SUBMITTING;
    step.lastError = null;
    await this.stepRepo.save(step);
    const response = await this.serviceClient.submitJob(step.serviceUrl, {
      requestId: this.requestId(step),
      workflowId: step.workflowId,
      step: step.name,
      payload: input,
    });
    await this.applyServiceResponse(step, response);
  }

  private async pollStep(step: WorkflowStep) {
    const response = await this.serviceClient.getJob(step.serviceUrl, step.externalJobId!);
    await this.applyServiceResponse(step, response);
  }

  private async applyServiceResponse(step: WorkflowStep, response: ExternalJobResponse) {
    if (response.status === 'FAILED') {
      await this.failStep(step, response.error ?? `Service job ${response.jobId} failed`);
      return;
    }
    if (response.status === 'COMPLETED') {
      await this.completeStep(step, response.result!);
      return;
    }
    step.externalJobId = response.jobId;
    step.status = StepStatus.PROCESSING;
    step.consecutiveFailures = 0;
    step.lastError = null;
    step.nextAttemptAt = new Date(Date.now() + step.pollIntervalMs);
    await this.stepRepo.save(step);
  }

  private async completeStep(step: WorkflowStep, output: Record<string, unknown>) {
    const transition = await this.dataSource.transaction(async (manager) => {
      const stepRepo = manager.getRepository(WorkflowStep);
      const workflowRepo = manager.getRepository(Workflow);
      const current = await stepRepo.findOneByOrFail({ id: step.id });
      if (current.status === StepStatus.COMPLETED) {
        return { nextStep: null as WorkflowStep | null, changed: false, workflow: null as Workflow | null };
      }
      current.status = StepStatus.COMPLETED;
      current.output = output;
      current.lastError = null;
      current.consecutiveFailures = 0;
      current.nextAttemptAt = null;
      await stepRepo.save(current);

      const workflow = await workflowRepo.findOneByOrFail({ id: current.workflowId });
      const nextStep = await stepRepo.findOneBy({
        workflowId: current.workflowId,
        stepIndex: current.stepIndex + 1,
      });
      if (!nextStep) {
        workflow.status = WorkflowStatus.COMPLETED;
        workflow.currentStep = null;
        workflow.result = output;
        workflow.lastError = null;
        await workflowRepo.save(workflow);
        return { nextStep: null, changed: true, workflow };
      }
      nextStep.input = output;
      nextStep.status = StepStatus.PENDING;
      nextStep.nextAttemptAt = new Date();
      nextStep.lastError = null;
      await stepRepo.save(nextStep);
      workflow.status = WorkflowStatus.RUNNING;
      workflow.currentStep = nextStep.name;
      workflow.lastError = null;
      await workflowRepo.save(workflow);
      return { nextStep, changed: true, workflow };
    });

    if (!transition.changed) {
      return;
    }
    await this.cache.setStepOutput(step.workflowId, step.id, output);
    if (transition.nextStep?.input) {
      await this.cache.setStepInput(
        transition.nextStep.workflowId,
        transition.nextStep.id,
        transition.nextStep.input,
      );
      await this.dispatcher.dispatchNow();
      return;
    }
    if (transition.workflow) {
      this.events.emit(WORKFLOW_COMPLETED, {
        workflowId: transition.workflow.id,
        pipeline: transition.workflow.pipeline,
        payload: transition.workflow.payload,
        result: output,
      });
    }
  }

  private async handleServiceError(step: WorkflowStep, error: unknown) {
    const requestError =
      error instanceof ServiceRequestError
        ? error
        : new ServiceRequestError(error instanceof Error ? error.message : String(error), true);
    if (!requestError.retryable) {
      await this.failStep(step, requestError.message);
      return;
    }
    step.status = StepStatus.WAITING_FOR_SERVICE;
    step.consecutiveFailures += 1;
    step.lastError = requestError.message;
    step.nextAttemptAt = new Date(Date.now() + this.retryDelay(step.consecutiveFailures));
    await this.stepRepo.save(step);
    await this.workflowRepo.update(step.workflowId, { lastError: requestError.message });
  }

  private async failStep(step: WorkflowStep, message: string) {
    step.status = StepStatus.FAILED;
    step.lastError = message;
    step.nextAttemptAt = null;
    await this.stepRepo.save(step);
    const workflow = await this.workflowRepo.findOneBy({ id: step.workflowId });
    await this.workflowRepo.update(step.workflowId, {
      status: WorkflowStatus.FAILED,
      currentStep: step.name,
      lastError: message,
    });
    this.events.emit(WORKFLOW_FAILED, {
      workflowId: step.workflowId,
      pipeline: workflow?.pipeline,
      payload: workflow?.payload ?? {},
      error: message,
    });
  }

  async retryFailedWorkflow(workflowId: string) {
    const workflow = await this.get(workflowId);
    const failedStep = workflow.steps.find((item) => item.status === StepStatus.FAILED);
    if (!failedStep) {
      return workflow;
    }
    failedStep.status = StepStatus.PENDING;
    failedStep.attemptsMade = 0;
    failedStep.consecutiveFailures = 0;
    failedStep.executionAttempt += 1;
    failedStep.externalJobId = null;
    failedStep.nextAttemptAt = new Date();
    failedStep.output = null;
    failedStep.lastError = null;
    await this.stepRepo.save(failedStep);
    workflow.status = WorkflowStatus.RUNNING;
    workflow.currentStep = failedStep.name;
    workflow.lastError = null;
    await this.workflowRepo.save(workflow);
    await this.dispatcher.dispatchNow();
    return this.get(workflowId);
  }

  private requestId(step: WorkflowStep) {
    return `${step.workflowId}-${step.id}-${step.executionAttempt}`;
  }

  private retryDelay(consecutiveFailures: number) {
    const exponent = Math.min(Math.max(consecutiveFailures - 1, 0), 10);
    return Math.min(this.retryBaseDelayMs * 2 ** exponent, this.retryMaxDelayMs);
  }
}
