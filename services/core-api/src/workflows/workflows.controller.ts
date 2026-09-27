import { Controller, Get, Param, Post } from '@nestjs/common';
import { WorkflowEngineService } from './workflow-engine.service';

@Controller('workflows')
export class WorkflowsController {
  constructor(private readonly engine: WorkflowEngineService) {}

  @Get(':id')
  get(@Param('id') id: string) {
    return this.engine.get(id);
  }

  @Post(':id/retry')
  retry(@Param('id') id: string) {
    return this.engine.retryFailedWorkflow(id);
  }
}
