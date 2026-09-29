import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkflowsModule } from '../workflows/workflows.module';
import { Project } from '../projects/entities/project.entity';
import { ProjectPlan } from '../projects/entities/project-plan.entity';
import { ProjectDay } from '../projects/entities/project-day.entity';
import { ProjectImage } from '../projects/entities/project-image.entity';
import {
  DetectionFrame,
  DetectionObject,
  DetectionRun,
} from '../projects/entities/detection.entities';
import { AnalysisController } from './analysis.controller';
import { AnalysisScheduler } from './analysis.scheduler';
import { AnalysisService } from './analysis.service';
import {
  AnalysisDayClass,
  AnalysisFinding,
  AnalysisRun,
} from './entities/analysis.entities';

@Module({
  imports: [
    WorkflowsModule,
    TypeOrmModule.forFeature([
      AnalysisRun,
      AnalysisDayClass,
      AnalysisFinding,
      Project,
      ProjectPlan,
      ProjectDay,
      ProjectImage,
      DetectionRun,
      DetectionFrame,
      DetectionObject,
    ]),
  ],
  controllers: [AnalysisController],
  providers: [AnalysisService, AnalysisScheduler],
  exports: [AnalysisService],
})
export class AnalysisModule {}
