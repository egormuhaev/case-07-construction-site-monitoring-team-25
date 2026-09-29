import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ProjectPlan } from './project-plan.entity';
import { ProjectDay } from './project-day.entity';

@Entity({ name: 'project' })
export class Project {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ type: 'text', nullable: true })
  customer: string | null;

  @Column({ type: 'text', nullable: true })
  contractor: string | null;

  @Column({ type: 'text', nullable: true })
  address: string | null;

  @Column({ name: 'object_type', type: 'text', nullable: true })
  objectType: string | null;

  @Column({ name: 'contract_number', type: 'text', nullable: true })
  contractNumber: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'start_date', type: 'date', nullable: true })
  startDate: string | null;

  @Column({ name: 'end_date', type: 'date', nullable: true })
  endDate: string | null;

  @Column({ default: 'Europe/Moscow' })
  timezone: string;

  @Column({ name: 'shift_start', type: 'time', nullable: true })
  shiftStart: string | null;

  @Column({ name: 'shift_end', type: 'time', nullable: true })
  shiftEnd: string | null;

  @Column({ name: 'ingest_token' })
  ingestToken: string;

  @OneToMany(() => ProjectPlan, (plan) => plan.project)
  plans: ProjectPlan[];

  @OneToMany(() => ProjectDay, (day) => day.project)
  days: ProjectDay[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
