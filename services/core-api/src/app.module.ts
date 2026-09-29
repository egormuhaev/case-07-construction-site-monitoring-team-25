import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkflowsModule } from './workflows/workflows.module';
import { Workflow } from './workflows/entities/workflow.entity';
import { WorkflowStep } from './workflows/entities/workflow-step.entity';
import { HealthController } from './health.controller';
import { runSqlMigrations } from './database/run-migrations';
import { StorageModule } from './storage/storage.module';
import { ProjectsModule } from './projects/projects.module';
import { AnalysisModule } from './analysis/analysis.module';
import { Project } from './projects/entities/project.entity';
import { ProjectPlan } from './projects/entities/project-plan.entity';
import { ProjectDay } from './projects/entities/project-day.entity';
import { ProjectImage } from './projects/entities/project-image.entity';
import {
  DetectionClass,
  PlanWork,
  WorkClassifier,
  WorkClassifierCandidate,
  WorkClassifierMatch,
} from './projects/entities/catalog.entities';
import { DetectionFrame, DetectionObject, DetectionRun } from './projects/entities/detection.entities';
import {
  AnalysisDayClass,
  AnalysisFinding,
  AnalysisRun,
} from './analysis/entities/analysis.entities';

@Module({
  imports: [
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    StorageModule,
    TypeOrmModule.forRootAsync({
      useFactory: async () => {
        await runSqlMigrations();
        return {
          type: 'postgres' as const,
          host: process.env.POSTGRES_HOST ?? 'localhost',
          port: Number(process.env.POSTGRES_PORT ?? 5432),
          username: process.env.POSTGRES_USER ?? 'admin',
          password: process.env.POSTGRES_PASSWORD ?? 'admin_password',
          database: process.env.POSTGRES_DB ?? 'monitoring_db',
          entities: [
            Workflow,
            WorkflowStep,
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
            AnalysisRun,
            AnalysisDayClass,
            AnalysisFinding,
          ],
          synchronize: false,
        };
      },
    }),
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST ?? 'localhost',
        port: Number(process.env.REDIS_PORT ?? 6379),
      },
    }),
    WorkflowsModule,
    ProjectsModule,
    AnalysisModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
