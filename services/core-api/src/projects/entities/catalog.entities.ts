import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'work' })
export class PlanWork {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'plan_id', type: 'uuid' })
  planId: string;

  @Column({ name: 'source_file' })
  sourceFile: string;

  @Column({ name: 'unique_id' })
  uniqueId: number;

  @Column()
  position: number;

  @Column({ name: 'outline_level' })
  outlineLevel: number;

  @Column({ type: 'text', nullable: true })
  wbs: string | null;

  @Column()
  name: string;

  @Column()
  path: string;

  @Column({ name: 'is_summary' })
  isSummary: boolean;

  @Column({ name: 'is_milestone' })
  isMilestone: boolean;

  @Column({ name: 'start_at', type: 'timestamp', nullable: true })
  startAt: Date | null;

  @Column({ name: 'finish_at', type: 'timestamp', nullable: true })
  finishAt: Date | null;

  @Column({ name: 'duration_hours', type: 'float', nullable: true })
  durationHours: number | null;
}

@Entity({ name: 'work_classifier' })
export class WorkClassifier {
  @PrimaryColumn('uuid')
  id: string;

  @Column()
  sphere: string;

  @Column()
  document: string;

  @Column()
  collection: string;

  @Column({ type: 'text', nullable: true })
  department: string | null;

  @Column({ type: 'text', nullable: true })
  section: string | null;

  @Column({ type: 'text', nullable: true })
  subsection: string | null;

  @Column({ name: 'table_code' })
  tableCode: string;

  @Column({ name: 'table_name' })
  tableName: string;

  @Column({ name: 'work_code' })
  workCode: string;

  @Column({ name: 'work_name' })
  workName: string;

  @Column()
  unit: string;
}

@Entity({ name: 'work_classifier_match' })
export class WorkClassifierMatch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'work_id', type: 'uuid' })
  workId: string;

  @Column({ name: 'classifier_id', type: 'uuid' })
  classifierId: string;

  @Column()
  source: 'AUTO' | 'MANUAL';

  @Column({ name: 'bi_score', type: 'float', nullable: true })
  biScore: number | null;

  @Column({ name: 'rerank_score', type: 'float', nullable: true })
  rerankScore: number | null;

  @Column({ type: 'float', nullable: true })
  volume: number | null;

  @Column({ name: 'duration_days', type: 'float', nullable: true })
  durationDays: number | null;

  @ManyToOne(() => WorkClassifier)
  @JoinColumn({ name: 'classifier_id' })
  classifier: WorkClassifier;
}

@Entity({ name: 'work_classifier_candidate' })
export class WorkClassifierCandidate {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'work_id', type: 'uuid' })
  workId: string;

  @Column({ name: 'classifier_id', type: 'uuid' })
  classifierId: string;

  @Column()
  rank: number;

  @Column({ name: 'bi_score', type: 'float' })
  biScore: number;

  @Column({ name: 'rerank_score', type: 'float' })
  rerankScore: number;

  @ManyToOne(() => WorkClassifier)
  @JoinColumn({ name: 'classifier_id' })
  classifier: WorkClassifier;
}

@Entity({ name: 'detection_class' })
export class DetectionClass {
  @PrimaryColumn()
  code: string;

  @Column()
  title: string;

  @Column()
  kind: string;
}
