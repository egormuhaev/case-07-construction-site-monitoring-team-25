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

@Entity('workflow_steps')
@Index(['workflowId', 'stepIndex'], { unique: true })
@Index(['status', 'nextAttemptAt'])
export class WorkflowStep {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  workflowId: string;

  @ManyToOne(() => Workflow, (workflow) => workflow.steps, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workflowId' })
  workflow: Workflow;

  @Column()
  stepIndex: number;

  @Column()
  name: string;

  @Column()
  serviceName: string;

  @Column()
  serviceUrl: string;

  @Column({ default: 5000 })
  pollIntervalMs: number;

  @Column({ type: 'enum', enum: StepStatus, default: StepStatus.PENDING })
  status: StepStatus;

  @Column({ default: 0 })
  attemptsMade: number;

  @Column({ default: 0 })
  consecutiveFailures: number;

  @Column({ default: 1 })
  executionAttempt: number;

  @Column({ type: 'varchar', nullable: true })
  externalJobId: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  nextAttemptAt: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  input: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  output: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: true })
  lastError: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
