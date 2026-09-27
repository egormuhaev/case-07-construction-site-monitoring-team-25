import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Project } from './project.entity';
import { ProjectImage } from './project-image.entity';

export type DayStatus = 'COLLECTING' | 'DETECTING' | 'DETECTED' | 'FAILED';

@Entity({ name: 'project_day' })
export class ProjectDay {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId: string;

  @ManyToOne(() => Project, (project) => project.days, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project: Project;

  @Column({ type: 'date' })
  day: string;

  @Column({ type: 'varchar' })
  status: DayStatus;

  @Column({ name: 'last_manual_run_at', type: 'timestamptz', nullable: true })
  lastManualRunAt: Date | null;

  @OneToMany(() => ProjectImage, (image) => image.day)
  images: ProjectImage[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
