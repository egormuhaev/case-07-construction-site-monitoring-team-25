import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CreateWorkflowDto } from './dto/create-workflow.dto';
import { WorkflowEngineService } from './workflow-engine.service';

@Controller('workflows')
export class WorkflowsController {
  constructor(private readonly engine: WorkflowEngineService) {}

  @Post()
  create(@Body() dto: CreateWorkflowDto) {
    return this.engine.create(dto.inputPath);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.engine.get(id);
  }

  @Post(':id/retry')
  retry(@Param('id') id: string) {
    return this.engine.retryFailedWorkflow(id);
  }
}
