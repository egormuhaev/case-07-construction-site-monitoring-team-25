import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { ProjectDay } from './project-day.entity';
import { ProjectImage } from './project-image.entity';
import { DetectionClass } from './catalog.entities';

@Entity({ name: 'detection_run' })
export class DetectionRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'day_id', type: 'uuid' })
  dayId: string;

  @ManyToOne(() => ProjectDay, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'day_id' })
  day: ProjectDay;

  @Column({ name: 'workflow_id', type: 'uuid', nullable: true })
  workflowId: string | null;

  @Column()
  trigger: 'MANUAL' | 'SCHEDULE';

  @Column()
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';

  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt: Date;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;
}

@Entity({ name: 'detection_frame' })
export class DetectionFrame {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'run_id', type: 'uuid' })
  runId: string;

  @ManyToOne(() => DetectionRun, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'run_id' })
  run: DetectionRun;

  @Column({ name: 'image_id', type: 'uuid' })
  imageId: string;

  @ManyToOne(() => ProjectImage, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'image_id' })
  image: ProjectImage;

  @Column({ name: 'camera_id', type: 'text', nullable: true })
  cameraId: string | null;

  @Column({ name: 'captured_at', type: 'timestamptz', nullable: true })
  capturedAt: Date | null;

  @Column({ type: 'int', nullable: true })
  width: number | null;

  @Column({ type: 'int', nullable: true })
  height: number | null;
}

@Entity({ name: 'detection_object' })
export class DetectionObject {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'frame_id', type: 'uuid' })
  frameId: string;

  @ManyToOne(() => DetectionFrame, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'frame_id' })
  frame: DetectionFrame;

  @Column({ name: 'class_code' })
  classCode: string;

  @ManyToOne(() => DetectionClass)
  @JoinColumn({ name: 'class_code' })
  detectionClass: DetectionClass;

  @Column({ type: 'float' })
  x1: number;

  @Column({ type: 'float' })
  y1: number;

  @Column({ type: 'float' })
  x2: number;

  @Column({ type: 'float' })
  y2: number;

  @Column({ name: 'detection_confidence', type: 'float' })
  detectionConfidence: number;

  @Column({ name: 'classification_source', type: 'text', nullable: true })
  classificationSource: string | null;

  @Column({ name: 'classification_confidence', type: 'float', nullable: true })
  classificationConfidence: number | null;

  @Column({ name: 'needs_refinement' })
  needsRefinement: boolean;
}
