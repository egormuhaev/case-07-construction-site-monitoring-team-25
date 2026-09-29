import { createHash } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkflowEngineService } from '../workflows/workflow-engine.service';
import { Project } from '../projects/entities/project.entity';
import { ProjectPlan } from '../projects/entities/project-plan.entity';
import { ProjectDay } from '../projects/entities/project-day.entity';
import { ProjectImage } from '../projects/entities/project-image.entity';
import {
  DetectionFrame,
  DetectionObject,
  DetectionRun,
} from '../projects/entities/detection.entities';
import {
  AnalysisDayClass,
  AnalysisFinding,
  AnalysisRun,
  AnalysisTrigger,
  FindingStatus,
} from './entities/analysis.entities';

export type AnalysisDetectionEvidence = {
  objectId: string;
  frameId: string;
  imageId: string;
  classCode: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  capturedAt: Date | null;
  confidence: number;
};

@Injectable()
export class AnalysisService {
  constructor(
    @InjectRepository(AnalysisRun) private readonly runs: Repository<AnalysisRun>,
    @InjectRepository(AnalysisDayClass)
    private readonly dayClasses: Repository<AnalysisDayClass>,
    @InjectRepository(AnalysisFinding)
    private readonly findings: Repository<AnalysisFinding>,
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    @InjectRepository(ProjectPlan) private readonly plans: Repository<ProjectPlan>,
    @InjectRepository(ProjectDay) private readonly days: Repository<ProjectDay>,
    @InjectRepository(ProjectImage) private readonly images: Repository<ProjectImage>,
    @InjectRepository(DetectionRun) private readonly detectionRuns: Repository<DetectionRun>,
    @InjectRepository(DetectionFrame) private readonly frames: Repository<DetectionFrame>,
    @InjectRepository(DetectionObject) private readonly objects: Repository<DetectionObject>,
    private readonly engine: WorkflowEngineService,
  ) {}

  async startDay(
    projectId: string,
    day: string,
    trigger: AnalysisTrigger,
    options?: { detectionRunId?: string },
  ) {
    const project = await this.requireProject(projectId);
    this.assertNotFutureDay(day, project.timezone);

    const dayRow = await this.days.findOneBy({ projectId, day });
    if (!dayRow) {
      throw new NotFoundException(`день ${day} не найден`);
    }

    const detectionRun = options?.detectionRunId
      ? await this.detectionRuns.findOneBy({ id: options.detectionRunId })
      : await this.detectionRuns.findOne({
          where: { dayId: dayRow.id, status: 'COMPLETED' },
          order: { startedAt: 'DESC' },
        });

    if (!detectionRun || detectionRun.status !== 'COMPLETED') {
      throw new BadRequestException('детекция за день не завершена');
    }
    if (detectionRun.dayId !== dayRow.id) {
      throw new BadRequestException('прогон детекции не относится к этому дню');
    }

    const dayFingerprint = await this.fingerprintForDay(dayRow.id);
    const detectionFingerprint = await this.fingerprintForDetectionRun(detectionRun.id);

    if (dayFingerprint !== detectionFingerprint) {
      throw new BadRequestException(
        'набор кадров изменился после детекции — сначала повторите детекцию',
      );
    }

    const existing = await this.runs.findOne({
      where: {
        projectId,
        mode: 'DAY',
        day,
        status: 'COMPLETED',
        detectionRunId: detectionRun.id,
        inputFingerprint: dayFingerprint,
      },
      order: { finishedAt: 'DESC', startedAt: 'DESC' },
    });
    if (existing) {
      const report = await this.getRun(existing.id);
      return { reused: true as const, run: report, workflowId: existing.workflowId };
    }

    const activePlan = await this.plans.findOne({
      where: { projectId, isActive: true, status: 'READY' },
    });

    const run = await this.runs.save(
      this.runs.create({
        projectId,
        mode: 'DAY',
        day,
        dateFrom: null,
        dateTo: null,
        planId: activePlan?.id ?? null,
        detectionRunId: detectionRun.id,
        inputFingerprint: dayFingerprint,
        trigger,
        status: 'RUNNING',
        workflowId: null,
        observability: null,
        summary: {},
        lastError: null,
        startedAt: new Date(),
        finishedAt: null,
      }),
    );

    try {
      const workflow = await this.engine.start('day-analysis', {
        mode: 'DAY',
        analysisRunId: run.id,
        projectId,
        dayId: dayRow.id,
        day,
        timezone: project.timezone,
        planId: activePlan?.id ?? null,
        detectionRunId: detectionRun.id,
      });
      run.workflowId = workflow.id;
      await this.runs.save(run);
      return { reused: false as const, run, workflowId: workflow.id };
    } catch (error) {
      run.status = 'FAILED';
      run.finishedAt = new Date();
      run.lastError = error instanceof Error ? error.message : String(error);
      await this.runs.save(run);
      throw error;
    }
  }

  async startPeriod(projectId: string, from: string, to: string, trigger: AnalysisTrigger) {
    const project = await this.requireProject(projectId);
    if (!from || !to) {
      throw new BadRequestException('нужны from и to');
    }
    if (from > to) {
      throw new BadRequestException('from не может быть больше to');
    }
    const fromDate = new Date(`${from}T00:00:00Z`);
    const toDate = new Date(`${to}T00:00:00Z`);
    const spanDays = Math.floor((toDate.getTime() - fromDate.getTime()) / 86_400_000) + 1;
    if (spanDays > 366) {
      throw new BadRequestException('период не может быть длиннее 366 дней');
    }
    const today = this.todayKey(project.timezone);
    if (from > today) {
      throw new BadRequestException('период целиком в будущем');
    }

    const run = await this.runs.save(
      this.runs.create({
        projectId,
        mode: 'PERIOD',
        day: null,
        dateFrom: from,
        dateTo: to,
        planId: null,
        detectionRunId: null,
        inputFingerprint: null,
        trigger,
        status: 'RUNNING',
        workflowId: null,
        observability: null,
        summary: {},
        lastError: null,
        startedAt: new Date(),
        finishedAt: null,
      }),
    );

    try {
      const workflow = await this.engine.start('period-analysis', {
        mode: 'PERIOD',
        analysisRunId: run.id,
        projectId,
        dateFrom: from,
        dateTo: to,
        timezone: project.timezone,
      });
      run.workflowId = workflow.id;
      await this.runs.save(run);
      return { run, workflowId: workflow.id };
    } catch (error) {
      run.status = 'FAILED';
      run.finishedAt = new Date();
      run.lastError = error instanceof Error ? error.message : String(error);
      await this.runs.save(run);
      throw error;
    }
  }

  async getDayAnalysis(projectId: string, day: string) {
    await this.requireProject(projectId);
    const dayRow = await this.days.findOneBy({ projectId, day });
    const latestDetection = dayRow
      ? await this.detectionRuns.findOne({
          where: { dayId: dayRow.id, status: 'COMPLETED' },
          order: { startedAt: 'DESC' },
        })
      : null;
    const dayFingerprint = dayRow ? await this.fingerprintForDay(dayRow.id) : null;
    const latestDetectionFingerprint = latestDetection
      ? await this.fingerprintForDetectionRun(latestDetection.id)
      : null;
    const framesMatchLatestDetection =
      Boolean(dayFingerprint) && dayFingerprint === latestDetectionFingerprint;

    const running = await this.runs.findOne({
      where: { projectId, mode: 'DAY', day, status: 'RUNNING' },
      order: { startedAt: 'DESC' },
    });
    if (running) {
      const report = await this.getRun(running.id);
      return { ...report, current: false, staleReason: null };
    }

    const run = await this.runs.findOne({
      where: { projectId, mode: 'DAY', day, status: 'COMPLETED' },
      order: { finishedAt: 'DESC', startedAt: 'DESC' },
    });

    if (!run) {
      if (latestDetection && !framesMatchLatestDetection) {
        return {
          current: false as const,
          staleReason: 'набор кадров изменился после детекции' as const,
        };
      }
      return null;
    }

    const report = await this.getRun(run.id);
    if (!dayRow) {
      return { ...report, current: false, staleReason: 'день не найден' as const };
    }

    const reportDetection = run.detectionRunId
      ? await this.detectionRuns.findOneBy({ id: run.detectionRunId })
      : null;
    const reportDetectionFingerprint = reportDetection
      ? await this.fingerprintForDetectionRun(reportDetection.id)
      : null;

    const current =
      Boolean(run.inputFingerprint) &&
      run.inputFingerprint === dayFingerprint &&
      dayFingerprint === reportDetectionFingerprint &&
      reportDetection?.status === 'COMPLETED';

    let staleReason: string | null = null;
    if (!current) {
      if (!reportDetection || reportDetection.status !== 'COMPLETED') {
        staleReason = 'нет успешной детекции для отчёта';
      } else if (!framesMatchLatestDetection || dayFingerprint !== reportDetectionFingerprint) {
        staleReason = 'набор кадров изменился после детекции';
      } else if (run.inputFingerprint !== dayFingerprint) {
        staleReason = 'отчёт устарел относительно текущего набора кадров';
      } else {
        staleReason = 'отчёт не актуален';
      }
    }

    return { ...report, current, staleReason };
  }

  async getRun(runId: string) {
    const run = await this.runs.findOneBy({ id: runId });
    if (!run) {
      throw new NotFoundException('прогон анализа не найден');
    }
    const classes =
      run.mode === 'DAY'
        ? await this.dayClasses.find({
            where: { runId },
            order: { classCode: 'ASC' },
          })
        : [];
    const findings = await this.findings.find({
      where: { runId },
      order: { createdAt: 'ASC' },
    });
    const codes = [
      ...new Set([
        ...classes.map((row) => row.classCode),
        ...findings.map((row) => row.classCode).filter((code): code is string => Boolean(code)),
      ]),
    ];
    const titleRows: Array<{ code: string; title: string }> = codes.length
      ? await this.dayClasses.manager.query(
          `SELECT code, title FROM detection_class WHERE code = ANY($1)`,
          [codes],
        )
      : [];
    const classTitles = Object.fromEntries(titleRows.map((row) => [row.code, row.title]));
    const detectionsByClass = await this.loadDetectionsByClass(run.detectionRunId);
    return {
      ...run,
      classTitles,
      classes: classes.map((row) => ({
        ...row,
        classTitle: classTitles[row.classCode] ?? row.classCode,
        detections: detectionsByClass.get(row.classCode) ?? [],
      })),
      findings,
    };
  }

  private async loadDetectionsByClass(
    detectionRunId: string | null,
  ): Promise<Map<string, AnalysisDetectionEvidence[]>> {
    const byClass = new Map<string, AnalysisDetectionEvidence[]>();
    if (!detectionRunId) {
      return byClass;
    }

    const rows: Array<{
      object_id: string;
      frame_id: string;
      image_id: string;
      class_code: string;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      captured_at: Date | null;
      detection_confidence: number;
      classification_confidence: number | null;
    }> = await this.objects.manager.query(
      `
      SELECT o.id AS object_id,
             f.id AS frame_id,
             f.image_id,
             o.class_code,
             o.x1,
             o.y1,
             o.x2,
             o.y2,
             f.captured_at,
             o.detection_confidence,
             o.classification_confidence
      FROM detection_object o
      JOIN detection_frame f ON f.id = o.frame_id
      WHERE f.run_id = $1
      ORDER BY o.class_code ASC, f.captured_at ASC NULLS LAST, o.id ASC
      `,
      [detectionRunId],
    );

    for (const row of rows) {
      const code = String(row.class_code);
      const list = byClass.get(code) ?? [];
      const confidence =
        row.classification_confidence != null
          ? Number(row.classification_confidence)
          : Number(row.detection_confidence);
      list.push({
        objectId: String(row.object_id),
        frameId: String(row.frame_id),
        imageId: String(row.image_id),
        classCode: code,
        x1: Number(row.x1),
        y1: Number(row.y1),
        x2: Number(row.x2),
        y2: Number(row.y2),
        capturedAt: row.captured_at,
        confidence,
      });
      byClass.set(code, list);
    }
    return byClass;
  }

  async listFindings(
    projectId: string,
    query: { status?: FindingStatus; from?: string; to?: string },
  ) {
    await this.requireProject(projectId);
    const qb = this.findings
      .createQueryBuilder('f')
      .where('f.project_id = :projectId', { projectId })
      .orderBy('f.created_at', 'DESC')
      .take(500);
    if (query.status) {
      qb.andWhere('f.status = :status', { status: query.status });
    }
    if (query.from) {
      qb.andWhere('(f.day >= :from OR f.date_from >= :from OR f.date_to >= :from)', {
        from: query.from,
      });
    }
    if (query.to) {
      qb.andWhere('(f.day <= :to OR f.date_to <= :to OR f.date_from <= :to)', {
        to: query.to,
      });
    }
    return qb.getMany();
  }

  async getFinding(findingId: string) {
    const finding = await this.findings.findOneBy({ id: findingId });
    if (!finding) {
      throw new NotFoundException('сигнал не найден');
    }

    const run = await this.runs.findOneBy({ id: finding.runId });
    if (!run) {
      throw new NotFoundException('прогон анализа не найден');
    }

    const dayClass =
      finding.classCode
        ? await this.dayClasses.findOneBy({
            runId: finding.runId,
            classCode: finding.classCode,
          })
        : null;

    return {
      finding,
      dayClass,
      run: {
        id: run.id,
        projectId: run.projectId,
        mode: run.mode,
        day: run.day,
        dateFrom: run.dateFrom,
        dateTo: run.dateTo,
        detectionRunId: run.detectionRunId,
        observability: run.observability,
        status: run.status,
        summary: run.summary,
      },
    };
  }

  async setFindingStatus(findingId: string, status: FindingStatus) {
    if (!['CONFIRMED', 'DISMISSED', 'POTENTIAL'].includes(status)) {
      throw new BadRequestException('недопустимый статус сигнала');
    }
    const finding = await this.findings.findOneBy({ id: findingId });
    if (!finding) {
      throw new NotFoundException('сигнал не найден');
    }
    finding.status = status;
    return this.findings.save(finding);
  }

  async listPeriodHeatmap(projectId: string, from: string, to: string) {
    await this.requireProject(projectId);
    if (!from || !to || from > to) {
      throw new BadRequestException('нужен корректный период from/to');
    }
    const runs = await this.runs
      .createQueryBuilder('r')
      .distinctOn(['r.day'])
      .where('r.project_id = :projectId', { projectId })
      .andWhere("r.mode = 'DAY'")
      .andWhere("r.status = 'COMPLETED'")
      .andWhere('r.day BETWEEN :from AND :to', { from, to })
      .orderBy('r.day', 'ASC')
      .addOrderBy('r.finished_at', 'DESC')
      .getMany();

    if (!runs.length) {
      return { days: [], classes: [], classTitles: {}, cells: [] };
    }

    const classes = await this.dayClasses
      .createQueryBuilder('c')
      .where('c.run_id IN (:...ids)', { ids: runs.map((run) => run.id) })
      .orderBy('c.day', 'ASC')
      .addOrderBy('c.class_code', 'ASC')
      .getMany();

    const codes = [...new Set(classes.map((row) => row.classCode))];
    const titleRows: Array<{ code: string; title: string }> = codes.length
      ? await this.dayClasses.manager.query(
          `SELECT code, title FROM detection_class WHERE code = ANY($1)`,
          [codes],
        )
      : [];
    const classTitles = Object.fromEntries(titleRows.map((row) => [row.code, row.title]));

    return {
      days: runs.map((run) => ({
        day: run.day,
        runId: run.id,
        observability: run.observability,
        summary: run.summary,
      })),
      classes: [...new Set(classes.map((row) => row.classCode))].sort(),
      classTitles,
      cells: classes.map((row) => ({
        day: row.day,
        classCode: row.classCode,
        verdict: row.verdict,
        expected: row.expected,
        present: row.present,
        objectCount: row.objectCount,
      })),
    };
  }

  async markCompleted(workflowId: string, result?: Record<string, unknown>) {
    const run = await this.runs.findOne({
      where: { workflowId },
      order: { startedAt: 'DESC' },
    });
    if (!run) {
      return;
    }
    run.status = 'COMPLETED';
    run.finishedAt = new Date();
    run.lastError = null;
    if (result?.summary && typeof result.summary === 'object') {
      run.summary = result.summary as Record<string, unknown>;
    }
    if (typeof result?.observability === 'string') {
      run.observability = result.observability as AnalysisRun['observability'];
    }
    await this.runs.save(run);
  }

  async markFailed(workflowId: string, error?: string) {
    const run = await this.runs.findOne({
      where: { workflowId },
      order: { startedAt: 'DESC' },
    });
    if (!run) {
      return;
    }
    run.status = 'FAILED';
    run.finishedAt = new Date();
    run.lastError = error ?? 'анализ не удался';
    await this.runs.save(run);
  }

  async findDaysNeedingAnalysis(day: string) {
    return this.days
      .createQueryBuilder('d')
      .innerJoin(DetectionRun, 'dr', "dr.day_id = d.id AND dr.status = 'COMPLETED'")
      .leftJoin(
        AnalysisRun,
        'ar',
        "ar.project_id = d.project_id AND ar.day = d.day AND ar.mode = 'DAY' AND ar.status = 'COMPLETED'",
      )
      .where('d.day = :day', { day })
      .andWhere('ar.id IS NULL')
      .select(['d.project_id AS "projectId"', 'd.day AS day'])
      .distinct(true)
      .getRawMany<{ projectId: string; day: string }>();
  }

  private async fingerprintForDay(dayId: string) {
    const rows = await this.images.find({
      where: { dayId },
      select: { id: true, checksum: true },
      order: { checksum: 'ASC' },
    });
    return this.hashChecksums(rows.map((row) => row.checksum));
  }

  private async fingerprintForDetectionRun(runId: string) {
    const rows = await this.frames
      .createQueryBuilder('f')
      .innerJoin(ProjectImage, 'i', 'i.id = f.image_id')
      .where('f.run_id = :runId', { runId })
      .select('i.checksum', 'checksum')
      .orderBy('i.checksum', 'ASC')
      .getRawMany<{ checksum: string }>();
    return this.hashChecksums(rows.map((row) => row.checksum));
  }

  private hashChecksums(checksums: string[]) {
    const unique = [...new Set(checksums.filter(Boolean))].sort();
    return createHash('sha256').update(unique.join('\n')).digest('hex');
  }

  private async requireProject(id: string) {
    const project = await this.projects.findOneBy({ id });
    if (!project) {
      throw new NotFoundException(`Проект ${id} не найден`);
    }
    return project;
  }

  private assertNotFutureDay(day: string, timezone: string) {
    if (day > this.todayKey(timezone)) {
      throw new BadRequestException('нельзя анализировать день в будущем');
    }
  }

  private todayKey(timezone: string) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }
}
