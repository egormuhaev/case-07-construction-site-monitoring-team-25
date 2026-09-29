import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Workflow } from './workflow.entity';

export enum StepStatus {
  PENDING = 'PENDING',
  SUBMITTING = 'SUBMITTING',
  PROCESSING = 'PROCESSING',
  WAITING_FOR_SERVICE = 'WAITING_FOR_SERVICE',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

@Entity({ name: 'workflow_steps' })
@Index(['workflowId', 'stepIndex'], { unique: true })
@Index(['status', 'nextAttemptAt'])
export class WorkflowStep {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'workflow_id', type: 'uuid' })
  workflowId: string;

  @ManyToOne(() => Workflow, (workflow) => workflow.steps, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workflow_id' })
  workflow: Workflow;

  @Column({ name: 'step_index' })
  stepIndex: number;

  @Column()
  name: string;

  @Column({ name: 'service_name' })
  serviceName: string;

  @Column({ name: 'service_url' })
  serviceUrl: string;

  @Column({ name: 'poll_interval_ms', default: 5000 })
  pollIntervalMs: number;

  @Column({ type: 'varchar' })
  status: StepStatus;

  @Column({ name: 'attempts_made', default: 0 })
  attemptsMade: number;

  @Column({ name: 'consecutive_failures', default: 0 })
  consecutiveFailures: number;

  @Column({ name: 'execution_attempt', default: 1 })
  executionAttempt: number;

  @Column({ name: 'external_job_id', type: 'varchar', nullable: true })
  externalJobId: string | null;

  @Column({ name: 'next_attempt_at', type: 'timestamptz', nullable: true })
  nextAttemptAt: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  input: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  output: Record<string, unknown> | null;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
