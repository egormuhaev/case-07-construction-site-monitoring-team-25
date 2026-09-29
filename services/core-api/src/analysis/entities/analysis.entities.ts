import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Project } from '../../projects/entities/project.entity';

export type AnalysisMode = 'DAY' | 'PERIOD';
export type AnalysisTrigger = 'MANUAL' | 'SCHEDULE' | 'AUTO';
export type AnalysisRunStatus = 'RUNNING' | 'COMPLETED' | 'FAILED';
export type ObservabilityLevel = 'GOOD' | 'PARTIAL' | 'BLIND';
export type AnalysisVerdict =
  | 'CONFIRMED'
  | 'GAP'
  | 'UNEXPECTED'
  | 'NOT_EXPECTED'
  | 'INSUFFICIENT_DATA';
export type FindingType =
  | 'NO_ACTIVITY'
  | 'LATE_START'
  | 'REPEATED_GAP'
  | 'UNEXPECTED_GROUP'
  | 'INSUFFICIENT_DATA'
  | 'NO_OBSERVATION'
  | 'NO_EXPECTATION_SOURCE'
  | 'PERSISTENT_GAP';
export type FindingSeverity = 'LOW' | 'MEDIUM' | 'HIGH';
export type FindingStatus = 'POTENTIAL' | 'CONFIRMED' | 'DISMISSED';

@Entity({ name: 'analysis_run' })
export class AnalysisRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId: string;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project: Project;

  @Column({ type: 'varchar' })
  mode: AnalysisMode;

  @Column({ type: 'date', nullable: true })
  day: string | null;

  @Column({ name: 'date_from', type: 'date', nullable: true })
  dateFrom: string | null;

  @Column({ name: 'date_to', type: 'date', nullable: true })
  dateTo: string | null;

  @Column({ name: 'plan_id', type: 'uuid', nullable: true })
  planId: string | null;

  @Column({ name: 'detection_run_id', type: 'uuid', nullable: true })
  detectionRunId: string | null;

  @Column({ name: 'input_fingerprint', type: 'text', nullable: true })
  inputFingerprint: string | null;

  @Column({ type: 'varchar' })
  trigger: AnalysisTrigger;

  @Column({ type: 'varchar' })
  status: AnalysisRunStatus;

  @Column({ name: 'workflow_id', type: 'uuid', nullable: true })
  workflowId: string | null;

  @Column({ type: 'varchar', nullable: true })
  observability: ObservabilityLevel | null;

  @Column({ type: 'jsonb', default: {} })
  summary: Record<string, unknown>;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;

  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt: Date;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt: Date | null;
}

@Entity({ name: 'analysis_day_class' })
export class AnalysisDayClass {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'run_id', type: 'uuid' })
  runId: string;

  @ManyToOne(() => AnalysisRun, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'run_id' })
  run: AnalysisRun;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId: string;

  @Column({ type: 'date' })
  day: string;

  @Column({ name: 'class_code' })
  classCode: string;

  @Column()
  expected: boolean;

  @Column({ name: 'expected_work_count' })
  expectedWorkCount: number;

  @Column({ name: 'expected_confidence', type: 'float', nullable: true })
  expectedConfidence: number | null;

  @Column({ name: 'expected_works', type: 'jsonb', default: [] })
  expectedWorks: Array<Record<string, unknown>>;

  @Column()
  present: boolean;

  @Column({ name: 'frame_count' })
  frameCount: number;

  @Column({ name: 'object_count' })
  objectCount: number;

  @Column({ name: 'camera_count' })
  cameraCount: number;

  @Column({ name: 'hour_span' })
  hourSpan: number;

  @Column({ name: 'max_confidence', type: 'float', nullable: true })
  maxConfidence: number | null;

  @Column({ name: 'median_confidence', type: 'float', nullable: true })
  medianConfidence: number | null;

  @Column({ name: 'needs_refinement_ratio', type: 'float', nullable: true })
  needsRefinementRatio: number | null;

  @Column({ type: 'varchar' })
  verdict: AnalysisVerdict;
}

@Entity({ name: 'analysis_finding' })
export class AnalysisFinding {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'run_id', type: 'uuid' })
  runId: string;

  @ManyToOne(() => AnalysisRun, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'run_id' })
  run: AnalysisRun;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId: string;

  @Column({ name: 'class_code', type: 'text', nullable: true })
  classCode: string | null;

  @Column({ type: 'date', nullable: true })
  day: string | null;

  @Column({ name: 'date_from', type: 'date', nullable: true })
  dateFrom: string | null;

  @Column({ name: 'date_to', type: 'date', nullable: true })
  dateTo: string | null;

  @Column({ type: 'varchar' })
  type: FindingType;

  @Column({ type: 'varchar' })
  severity: FindingSeverity;

  @Column({ type: 'float' })
  deviation: number;

  @Column({ type: 'float' })
  confidence: number;

  @Column({ type: 'varchar' })
  status: FindingStatus;

  @Column()
  title: string;

  @Column({ type: 'jsonb', default: {} })
  details: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
