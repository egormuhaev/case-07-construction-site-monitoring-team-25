import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProjectDay } from './entities/project-day.entity';
import { ProjectImage } from './entities/project-image.entity';
import { Project } from './entities/project.entity';
import { ProjectsService } from './projects.service';

@Injectable()
export class DetectionScheduler {
  private readonly logger = new Logger(DetectionScheduler.name);

  constructor(
    @InjectRepository(ProjectDay) private readonly days: Repository<ProjectDay>,
    @InjectRepository(ProjectImage) private readonly images: Repository<ProjectImage>,
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    private readonly service: ProjectsService,
  ) {}

  @Cron(process.env.DETECTION_CRON ?? '0 3 * * *', {
    timeZone: process.env.DETECTION_TZ ?? 'Europe/Moscow',
  })
  async runNightly() {
    const timezone = process.env.DETECTION_TZ ?? 'Europe/Moscow';
    const yesterday = this.shiftDay(new Date(), timezone, -1);
    const due = await this.days.find({ where: { day: yesterday, status: 'COLLECTING' } });
    for (const day of due) {
      if (day.lastManualRunAt) {
        continue;
      }
      const count = await this.images.count({ where: { dayId: day.id } });
      if (!count) {
        continue;
      }
      const project = await this.projects.findOneBy({ id: day.projectId });
      if (!project) {
        continue;
      }
      try {
        await this.service.startDetection(project.id, day.day, 'SCHEDULE');
        this.logger.log(`ночная детекция ${project.id} ${day.day}`);
      } catch (error) {
        this.logger.warn(
          `не удалось запустить детекцию ${project.id} ${day.day}: ${
            error instanceof Error ? error.message : error
          }`,
        );
      }
    }
  }

  private shiftDay(now: Date, timezone: string, delta: number) {
    const key = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
    const date = new Date(`${key}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + delta);
    return date.toISOString().slice(0, 10);
  }
}
