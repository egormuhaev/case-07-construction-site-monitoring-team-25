import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Project } from './project.entity';
import { ProjectDay } from './project-day.entity';

export type ImageSource = 'API' | 'MANUAL';

@Entity({ name: 'project_image' })
export class ProjectImage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId: string;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project: Project;

  @Column({ name: 'day_id', type: 'uuid' })
  dayId: string;

  @ManyToOne(() => ProjectDay, (day) => day.images, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'day_id' })
  day: ProjectDay;

  @Column({ type: 'varchar' })
  source: ImageSource;

  @Column({ name: 'camera_external_id', type: 'text', nullable: true })
  cameraExternalId: string | null;

  @Column({ name: 'captured_at', type: 'timestamptz' })
  capturedAt: Date;

  @Column({ name: 'received_at', type: 'timestamptz' })
  receivedAt: Date;

  @Column({ name: 'relative_path' })
  relativePath: string;

  @Column()
  checksum: string;

  @Column({ type: 'int', nullable: true })
  width: number | null;

  @Column({ type: 'int', nullable: true })
  height: number | null;

  @Column({ name: 'original_name', type: 'text', nullable: true })
  originalName: string | null;
}
