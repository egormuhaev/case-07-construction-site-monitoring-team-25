import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Project } from './project.entity';

export type PlanStatus = 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED';

@Entity({ name: 'project_plan' })
export class ProjectPlan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId: string;

  @ManyToOne(() => Project, (project) => project.plans, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project: Project;

  @Column()
  version: number;

  @Column({ name: 'source_file' })
  sourceFile: string;

  @Column({ name: 'stored_path' })
  storedPath: string;

  @Column({ type: 'varchar' })
  status: PlanStatus;

  @Column({ name: 'is_active' })
  isActive: boolean;

  @Column({ name: 'workflow_id', type: 'uuid', nullable: true })
  workflowId: string | null;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
