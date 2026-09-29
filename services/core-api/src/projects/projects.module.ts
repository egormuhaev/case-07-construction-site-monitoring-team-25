import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnalysisModule } from '../analysis/analysis.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { DetectionController } from './detection.controller';
import { DetectionScheduler } from './detection.scheduler';
import { IngestController } from './ingest.controller';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { WorkflowEventsListener } from './workflow-events.listener';
import { Project } from './entities/project.entity';
import { ProjectPlan } from './entities/project-plan.entity';
import { ProjectDay } from './entities/project-day.entity';
import { ProjectImage } from './entities/project-image.entity';
import {
  DetectionClass,
  PlanWork,
  WorkClassifier,
  WorkClassifierCandidate,
  WorkClassifierMatch,
} from './entities/catalog.entities';
import { DetectionFrame, DetectionObject, DetectionRun } from './entities/detection.entities';

@Module({
  imports: [
    WorkflowsModule,
    forwardRef(() => AnalysisModule),
    TypeOrmModule.forFeature([
      Project,
      ProjectPlan,
      ProjectDay,
      ProjectImage,
      PlanWork,
      WorkClassifier,
      WorkClassifierMatch,
      WorkClassifierCandidate,
      DetectionClass,
      DetectionRun,
      DetectionFrame,
      DetectionObject,
    ]),
  ],
  controllers: [ProjectsController, IngestController, DetectionController],
  providers: [ProjectsService, WorkflowEventsListener, DetectionScheduler],
})
export class ProjectsModule {}
