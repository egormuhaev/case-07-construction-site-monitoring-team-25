import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkflowsModule } from './workflows/workflows.module';
import { Workflow } from './workflows/entities/workflow.entity';
import { WorkflowStep } from './workflows/entities/workflow-step.entity';
import { HealthController } from './health.controller';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.POSTGRES_HOST ?? 'localhost',
      port: Number(process.env.POSTGRES_PORT ?? 5432),
      username: process.env.POSTGRES_USER ?? 'orchestrator',
      password: process.env.POSTGRES_PASSWORD ?? 'orchestrator',
      database: process.env.POSTGRES_DB ?? 'orchestrator',
      entities: [Workflow, WorkflowStep],
      synchronize: process.env.DB_SYNCHRONIZE !== 'false',
    }),
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST ?? 'localhost',
        port: Number(process.env.REDIS_PORT ?? 6379),
      },
    }),
    WorkflowsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
