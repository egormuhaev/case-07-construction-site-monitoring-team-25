import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AnalysisService } from './analysis.service';

@Injectable()
export class AnalysisScheduler {
  private readonly logger = new Logger(AnalysisScheduler.name);

  constructor(private readonly analysis: AnalysisService) {}

  @Cron(process.env.ANALYSIS_CRON ?? '0 4 * * *', {
    timeZone: process.env.DETECTION_TZ ?? 'Europe/Moscow',
  })
  async runNightly() {
    const timezone = process.env.DETECTION_TZ ?? 'Europe/Moscow';
    const yesterday = this.shiftDay(new Date(), timezone, -1);
    const due = await this.analysis.findDaysNeedingAnalysis(yesterday);
    for (const row of due) {
      try {
        await this.analysis.startDay(row.projectId, row.day, 'SCHEDULE');
        this.logger.log(`ночной анализ ${row.projectId} ${row.day}`);
      } catch (error) {
        this.logger.warn(
          `не удалось запустить анализ ${row.projectId} ${row.day}: ${
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
