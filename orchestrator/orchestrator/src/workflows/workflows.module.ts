import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkflowCacheService } from '../cache/workflow-cache.service';
import { PipelineConfigService } from '../orchestrator/pipeline';
import { WorkflowProcessor } from '../orchestrator/workflow.processor';
import { WorkflowDispatcherService } from '../orchestrator/workflow-dispatcher.service';
import { WORKFLOW_QUEUE } from '../orchestrator/queue.constants';
import { ServiceClientService } from '../services/service-client.service';
import { Workflow } from './entities/workflow.entity';
import { WorkflowStep } from './entities/workflow-step.entity';
import { WorkflowEngineService } from './workflow-engine.service';
import { WorkflowsController } from './workflows.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Workflow, WorkflowStep]),
    BullModule.registerQueue({ name: WORKFLOW_QUEUE }),
  ],
  controllers: [WorkflowsController],
  providers: [
    WorkflowEngineService,
    WorkflowProcessor,
    WorkflowDispatcherService,
    WorkflowCacheService,
    PipelineConfigService,
    ServiceClientService,
  ],
})
export class WorkflowsModule {}
