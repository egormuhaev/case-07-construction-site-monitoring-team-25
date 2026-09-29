import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { WorkflowEngineService } from '../workflows/workflow-engine.service';
import { ExecuteStepJobData, PROCESS_STEP_JOB, WORKFLOW_QUEUE } from './queue.constants';

@Processor(WORKFLOW_QUEUE, {
  concurrency: Number(process.env.ORCHESTRATOR_CONCURRENCY ?? 10),
})
export class WorkflowProcessor extends WorkerHost {
  constructor(private readonly engine: WorkflowEngineService) {
    super();
  }

  async process(job: Job<ExecuteStepJobData>) {
    if (job.name !== PROCESS_STEP_JOB) {
      throw new Error(`Unsupported job: ${job.name}`);
    }

    return this.engine.processStep(job.data.stepId);
  }
}
