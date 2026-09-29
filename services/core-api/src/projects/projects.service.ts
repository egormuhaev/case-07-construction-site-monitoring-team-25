import { createHash, randomBytes } from 'node:crypto';
import { rm } from 'node:fs/promises';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { StorageService } from '../storage/storage.service';
import { WorkflowEngineService } from '../workflows/workflow-engine.service';
import { CreateProjectDto, MatchAssignmentDto, UpdateProjectDto } from './dto';
import { Project } from './entities/project.entity';
import { ProjectPlan } from './entities/project-plan.entity';
import { ProjectDay } from './entities/project-day.entity';
import { ProjectImage } from './entities/project-image.entity';
import { DetectionRun } from './entities/detection.entities';
import {
  PlanWork,
  WorkClassifier,
  WorkClassifierCandidate,
  WorkClassifierMatch,
} from './entities/catalog.entities';

@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    @InjectRepository(ProjectPlan) private readonly plans: Repository<ProjectPlan>,
    @InjectRepository(ProjectDay) private readonly days: Repository<ProjectDay>,
    @InjectRepository(ProjectImage) private readonly images: Repository<ProjectImage>,
    @InjectRepository(PlanWork) private readonly works: Repository<PlanWork>,
    @InjectRepository(WorkClassifierMatch) private readonly matches: Repository<WorkClassifierMatch>,
    @InjectRepository(WorkClassifierCandidate)
    private readonly candidates: Repository<WorkClassifierCandidate>,
    @InjectRepository(WorkClassifier) private readonly classifier: Repository<WorkClassifier>,
    @InjectRepository(DetectionRun) private readonly runs: Repository<DetectionRun>,
    private readonly storage: StorageService,
    private readonly engine: WorkflowEngineService,
  ) {}

  list() {
    return this.projects.find({ order: { createdAt: 'DESC' } });
  }

  async get(id: string) {
    const project = await this.projects.findOne({ where: { id } });
    if (!project) {
      throw new NotFoundException(`Проект ${id} не найден`);
    }
    const activePlan = await this.plans.findOne({
      where: { projectId: id, isActive: true },
    });
    const latestPlan = await this.plans.findOne({
      where: { projectId: id },
      order: { version: 'DESC' },
    });
    return { ...project, activePlan, latestPlan };
  }

  create(dto: CreateProjectDto) {
    return this.projects.save(
      this.projects.create({
        name: dto.name,
        customer: dto.customer ?? null,
        contractor: dto.contractor ?? null,
        address: dto.address ?? null,
        objectType: dto.objectType ?? null,
        contractNumber: dto.contractNumber ?? null,
        notes: dto.notes ?? null,
        startDate: dto.startDate ?? null,
        endDate: dto.endDate ?? null,
        timezone: dto.timezone ?? 'Europe/Moscow',
        shiftStart: this.normalizeShiftTime(dto.shiftStart) ?? null,
        shiftEnd: this.normalizeShiftTime(dto.shiftEnd) ?? null,
        ingestToken: randomBytes(24).toString('hex'),
      }),
    );
  }

  async update(id: string, dto: UpdateProjectDto) {
    const project = await this.requireProject(id);
    Object.assign(project, {
      name: dto.name ?? project.name,
      customer: dto.customer === undefined ? project.customer : dto.customer,
      contractor: dto.contractor === undefined ? project.contractor : dto.contractor,
      address: dto.address === undefined ? project.address : dto.address,
      objectType: dto.objectType === undefined ? project.objectType : dto.objectType,
      contractNumber:
        dto.contractNumber === undefined ? project.contractNumber : dto.contractNumber,
      notes: dto.notes === undefined ? project.notes : dto.notes,
      startDate: dto.startDate === undefined ? project.startDate : dto.startDate,
      endDate: dto.endDate === undefined ? project.endDate : dto.endDate,
      timezone: dto.timezone ?? project.timezone,
      shiftStart:
        dto.shiftStart === undefined
          ? project.shiftStart
          : this.normalizeShiftTime(dto.shiftStart),
      shiftEnd:
        dto.shiftEnd === undefined ? project.shiftEnd : this.normalizeShiftTime(dto.shiftEnd),
    });
    return this.projects.save(project);
  }

  async remove(id: string) {
    const project = await this.requireProject(id);
    await this.projects.remove(project);
    try {
      await rm(this.storage.projectDir(id), { recursive: true, force: true });
    } catch {
      // файлы могли отсутствовать — запись уже удалена
    }
    return { ok: true };
  }

  async rotateToken(id: string) {
    const project = await this.requireProject(id);
    project.ingestToken = randomBytes(24).toString('hex');
    return this.projects.save(project);
  }

  async uploadPlan(projectId: string, file: Express.Multer.File) {
    const project = await this.requireProject(projectId);
    if (!file?.buffer?.length) {
      throw new BadRequestException('нужен файл календарного плана');
    }
    const last = await this.plans.findOne({
      where: { projectId },
      order: { version: 'DESC' },
    });
    const version = (last?.version ?? 0) + 1;
    const plan = await this.plans.save(
      this.plans.create({
        projectId,
        version,
        sourceFile: file.originalname || 'plan.mpp',
        storedPath: '',
        status: 'PENDING',
        isActive: false,
        workflowId: null,
        lastError: null,
      }),
    );
    const ext = file.originalname?.toLowerCase().endsWith('.xml') ? '.xml' : '.mpp';
    const abs = this.storage.planPath(projectId, plan.id, ext);
    plan.storedPath = this.storage.toPosix(await this.storage.writeFile(abs, file.buffer));
    await this.plans.save(plan);
    const workflow = await this.engine.start('plan-import', {
      planId: plan.id,
      projectId,
      path: plan.storedPath,
      timezone: project.timezone,
    });
    plan.workflowId = workflow.id;
    plan.status = 'PROCESSING';
    await this.plans.save(plan);
    return plan;
  }

  async listWorks(projectId: string, query: { q?: string; source?: string; skip?: number; take?: number }) {
    await this.requireProject(projectId);
    const plan = await this.plans.findOne({ where: { projectId, isActive: true } });
    if (!plan) {
      return { plan: null, total: 0, items: [] };
    }
    const qb = this.works
      .createQueryBuilder('w')
      .where('w.plan_id = :planId', { planId: plan.id })
      .orderBy('w.position', 'ASC');
    if (query.q) {
      qb.andWhere('w.name ILIKE :q', { q: `%${query.q}%` });
    }
    if (query.source === 'AUTO' || query.source === 'MANUAL') {
      qb.andWhere(
        `EXISTS (
          SELECT 1 FROM work_classifier_match m
          WHERE m.work_id = w.id AND m.source = :source
        )`,
        { source: query.source },
      );
    }
    if (query.source === 'UNMATCHED') {
      qb.andWhere(
        `NOT EXISTS (SELECT 1 FROM work_classifier_match m WHERE m.work_id = w.id)`,
      );
    }
    const take = Math.min(Number(query.take ?? 50), 500);
    const skip = Number(query.skip ?? 0);
    const [rows, total] = await qb.skip(skip).take(take).getManyAndCount();
    const workIds = rows.map((row) => row.id);
    const matches = workIds.length
      ? await this.matches.find({
          where: workIds.map((workId) => ({ workId })),
          relations: { classifier: true },
        })
      : [];
    const candidates = workIds.length
      ? await this.candidates.find({
          where: workIds.map((workId) => ({ workId })),
          relations: { classifier: true },
          order: { rank: 'ASC' },
        })
      : [];
    const matchesByWork = new Map<string, WorkClassifierMatch[]>();
    for (const item of matches) {
      const list = matchesByWork.get(item.workId) ?? [];
      list.push(item);
      matchesByWork.set(item.workId, list);
    }
    const byWork = new Map<string, WorkClassifierCandidate[]>();
    for (const item of candidates) {
      const list = byWork.get(item.workId) ?? [];
      list.push(item);
      byWork.set(item.workId, list);
    }
    return {
      plan,
      total,
      items: rows.map((work) => {
        const workMatches = matchesByWork.get(work.id) ?? [];
        return {
          ...work,
          matches: workMatches,
          match: workMatches[0] ?? null,
          candidates: (byWork.get(work.id) ?? []).slice(0, 8),
        };
      }),
    };
  }

  async listPlans(projectId: string) {
    await this.requireProject(projectId);
    return this.plans.find({ where: { projectId }, order: { version: 'DESC' } });
  }

  async confirmMatches(projectId: string) {
    const plan = await this.plans.findOne({ where: { projectId, isActive: true } });
    if (!plan) {
      throw new NotFoundException('активный план не найден');
    }
    const result = await this.matches
      .createQueryBuilder()
      .update()
      .set({ source: 'MANUAL' })
      .where(
        `work_id IN (SELECT id FROM work WHERE plan_id = :planId) AND source = 'AUTO'`,
        { planId: plan.id },
      )
      .execute();
    return { updated: result.affected ?? 0 };
  }

  async patchMatch(workId: string, classifierId: string) {
    return this.replaceMatches(workId, [{ classifierId, volume: null, durationDays: null }]);
  }

  async replaceMatches(workId: string, assignments: MatchAssignmentDto[]) {
    const work = await this.works.findOneBy({ id: workId });
    if (!work) {
      throw new NotFoundException('работа не найдена');
    }
    if (!assignments?.length) {
      await this.matches.delete({ workId });
      return [];
    }
    const unique = new Map<string, MatchAssignmentDto>();
    for (const item of assignments) {
      if (!item?.classifierId) continue;
      unique.set(item.classifierId, item);
    }
    const classifierIds = [...unique.keys()];
    const classifiers = await this.classifier.find({
      where: { id: In(classifierIds) },
    });
    if (classifiers.length !== classifierIds.length) {
      throw new NotFoundException('норма классификатора не найдена');
    }
    await this.matches.delete({ workId });
    await this.matches.save(
      [...unique.values()].map((item) =>
        this.matches.create({
          workId,
          classifierId: item.classifierId,
          source: 'MANUAL',
          biScore: null,
          rerankScore: null,
          volume:
            item.volume === undefined || item.volume === null || Number.isNaN(Number(item.volume))
              ? null
              : Number(item.volume),
          durationDays:
            item.durationDays === undefined ||
            item.durationDays === null ||
            Number.isNaN(Number(item.durationDays))
              ? null
              : Number(item.durationDays),
        }),
      ),
    );
    return this.matches.find({
      where: { workId },
      relations: { classifier: true },
    });
  }

  async catalog(query: {
    sphere?: string;
    collection?: string;
    tableCode?: string;
    q?: string;
  }) {
    if (query.q && !query.sphere) {
      const rows = await this.classifier
        .createQueryBuilder('c')
        .where('c.work_name ILIKE :q OR c.table_name ILIKE :q OR c.work_code ILIKE :q', {
          q: `%${query.q}%`,
        })
        .orderBy('c.sphere')
        .addOrderBy('c.work_code')
        .take(80)
        .getMany();
      return { level: 'search', items: rows };
    }
    if (!query.sphere) {
      const rows = await this.classifier
        .createQueryBuilder('c')
        .select('c.sphere', 'sphere')
        .addSelect('COUNT(*)', 'count')
        .groupBy('c.sphere')
        .orderBy('c.sphere')
        .getRawMany();
      return { level: 'sphere', items: rows };
    }
    if (!query.collection) {
      const rows = await this.classifier
        .createQueryBuilder('c')
        .select('c.collection', 'collection')
        .addSelect('c.document', 'document')
        .addSelect('COUNT(*)', 'count')
        .where('c.sphere = :sphere', { sphere: query.sphere })
        .groupBy('c.collection')
        .addGroupBy('c.document')
        .orderBy('c.collection')
        .getRawMany();
      return { level: 'collection', items: rows };
    }
    if (!query.tableCode) {
      const qb = this.classifier
        .createQueryBuilder('c')
        .select('c.table_code', 'tableCode')
        .addSelect('c.table_name', 'tableName')
        .addSelect('COUNT(*)', 'count')
        .where('c.sphere = :sphere', { sphere: query.sphere })
        .andWhere('c.collection = :collection', { collection: query.collection })
        .groupBy('c.table_code')
        .addGroupBy('c.table_name')
        .orderBy('c.table_code');
      if (query.q) {
        qb.andWhere('(c.table_name ILIKE :q OR c.work_name ILIKE :q)', { q: `%${query.q}%` });
      }
      return { level: 'table', items: await qb.getRawMany() };
    }
    const qb = this.classifier
      .createQueryBuilder('c')
      .where('c.sphere = :sphere', { sphere: query.sphere })
      .andWhere('c.collection = :collection', { collection: query.collection })
      .andWhere('c.table_code = :tableCode', { tableCode: query.tableCode })
      .orderBy('c.work_code');
    if (query.q) {
      qb.andWhere('c.work_name ILIKE :q', { q: `%${query.q}%` });
    }
    return { level: 'work', items: await qb.take(200).getMany() };
  }

  async listDays(projectId: string) {
    await this.requireProject(projectId);
    const rows = await this.days.find({
      where: { projectId },
      order: { day: 'DESC' },
    });
    if (!rows.length) {
      return [];
    }
    const counts = await this.images
      .createQueryBuilder('i')
      .select('i.day_id', 'dayId')
      .addSelect('COUNT(*)', 'count')
      .where('i.day_id IN (:...ids)', { ids: rows.map((row) => row.id) })
      .groupBy('i.day_id')
      .getRawMany<{ dayId: string; count: string }>();
    const byDay = new Map(counts.map((row) => [row.dayId, Number(row.count)]));
    return rows.map((day) => ({ ...day, imageCount: byDay.get(day.id) ?? 0 }));
  }

  async getDay(projectId: string, day: string) {
    await this.requireProject(projectId);
    const row = await this.ensureDay(projectId, day);
    const images = await this.images.find({
      where: { dayId: row.id },
      order: { capturedAt: 'ASC' },
    });
    const latestRun = await this.runs.findOne({
      where: { dayId: row.id },
      order: { startedAt: 'DESC' },
    });
    return { ...row, images, latestRun };
  }

  async addManualImages(
    projectId: string,
    day: string,
    files: Express.Multer.File[],
    capturedAtList: string[],
  ) {
    const project = await this.requireProject(projectId);
    if (!files?.length) {
      throw new BadRequestException('нужны файлы изображений');
    }
    const row = await this.ensureDay(projectId, day);
    const saved = [];
    for (let i = 0; i < files.length; i += 1) {
      const file = files[i];
      const capturedAt = this.parseProjectLocalDateTime(
        capturedAtList[i] || `${day}T12:00:00`,
        project.timezone,
      );
      saved.push(
        await this.persistImage({
          project,
          day: row,
          file,
          source: 'MANUAL',
          capturedAt,
          cameraExternalId: null,
        }),
      );
    }
    return saved;
  }

  async ingestImages(params: {
    projectId: string;
    token: string;
    files: Express.Multer.File[];
    capturedAt?: string[];
    cameraId?: string[];
  }) {
    const project = await this.projects.findOne({ where: { id: params.projectId } });
    if (!project || project.ingestToken !== params.token) {
      throw new BadRequestException('неверный проект или ingest-токен');
    }
    if (!params.files?.length) {
      throw new BadRequestException('нужны файлы');
    }
    const now = new Date();
    const saved = [];
    for (let i = 0; i < params.files.length; i += 1) {
      const capturedAt = params.capturedAt?.[i]
        ? this.parseProjectLocalDateTime(params.capturedAt[i], project.timezone)
        : now;
      const day = this.dayKey(capturedAt, project.timezone);
      const row = await this.ensureDay(project.id, day);
      saved.push(
        await this.persistImage({
          project,
          day: row,
          file: params.files[i],
          source: 'API',
          capturedAt,
          cameraExternalId: params.cameraId?.[i] ?? null,
        }),
      );
    }
    return saved;
  }

  async startDetection(projectId: string, day: string, trigger: 'MANUAL' | 'SCHEDULE') {
    const project = await this.requireProject(projectId);
    const row = await this.ensureDayLookup(projectId, day);
    const images = await this.images.find({ where: { dayId: row.id } });
    if (!images.length) {
      throw new BadRequestException('за день нет изображений');
    }
    const frames = images.map((image) => {
      const captured = new Date(image.capturedAt);
      return {
        path: image.relativePath,
        captured_date: captured.toISOString().slice(0, 10),
        captured_time: captured.toISOString().slice(11, 19),
        camera: image.cameraExternalId ?? undefined,
      };
    });
    row.status = 'DETECTING';
    if (trigger === 'MANUAL') {
      row.lastManualRunAt = new Date();
    }
    await this.days.save(row);
    const workflow = await this.engine.start('day-detection', {
      projectId,
      dayId: row.id,
      day,
      timezone: project.timezone,
      frames,
    });
    const run = await this.runs.save(
      this.runs.create({
        dayId: row.id,
        workflowId: workflow.id,
        trigger,
        status: 'RUNNING',
        startedAt: new Date(),
        finishedAt: null,
        lastError: null,
      }),
    );
    return { day: row, run, workflowId: workflow.id };
  }

  async requireProject(id: string) {
    const project = await this.projects.findOneBy({ id });
    if (!project) {
      throw new NotFoundException(`Проект ${id} не найден`);
    }
    return project;
  }

  private async persistImage(input: {
    project: Project;
    day: ProjectDay;
    file: Express.Multer.File;
    source: 'API' | 'MANUAL';
    capturedAt: Date;
    cameraExternalId: string | null;
  }) {
    const checksum = createHash('sha256').update(input.file.buffer).digest('hex');
    const existing = await this.images.findOneBy({
      projectId: input.project.id,
      checksum,
    });
    if (existing) {
      return existing;
    }
    const image = this.images.create({
      projectId: input.project.id,
      dayId: input.day.id,
      source: input.source,
      cameraExternalId: input.cameraExternalId,
      capturedAt: input.capturedAt,
      receivedAt: new Date(),
      relativePath: '',
      checksum,
      originalName: input.file.originalname ?? null,
      width: null,
      height: null,
    });
    const saved = await this.images.save(image);
    const ext = this.extension(input.file.originalname || input.file.mimetype);
    const abs = this.storage.imagePath(input.project.id, input.day.day, saved.id, ext);
    saved.relativePath = this.storage.toPosix(await this.storage.writeFile(abs, input.file.buffer));
    return this.images.save(saved);
  }

  private extension(name: string) {
    const lower = name.toLowerCase();
    if (lower.includes('png')) return '.png';
    if (lower.includes('webp')) return '.webp';
    return '.jpg';
  }

  /** HH:MM или HH:MM:SS → HH:MM:SS для колонки TIME; пустое → null. */
  private normalizeShiftTime(value: string | null | undefined): string | null {
    if (value == null) return null;
    const raw = String(value).trim();
    if (!raw) return null;
    const match = raw.match(/^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/);
    if (!match) return null;
    return `${match[1]}:${match[2]}:${match[3] ?? '00'}`;
  }

  private dayKey(date: Date, timezone: string) {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(date);
    } catch {
      return date.toISOString().slice(0, 10);
    }
  }

  /** Разбирает локальное время стройки (или ISO с offset) в абсолютный момент. */
  private parseProjectLocalDateTime(value: string, timezone: string): Date {
    const raw = value.trim();
    if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw)) {
      return new Date(raw);
    }
    const normalized = raw.includes('T') ? raw : `${raw}T12:00:00`;
    const match = normalized.match(
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/,
    );
    if (!match) {
      return new Date(raw);
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    const second = Number(match[6] ?? 0);
    return this.zonedWallTimeToUtc(year, month, day, hour, minute, second, timezone);
  }

  private zonedWallTimeToUtc(
    year: number,
    month: number,
    day: number,
    hour: number,
    minute: number,
    second: number,
    timeZone: string,
  ): Date {
    const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      });
      const parts = formatter.formatToParts(new Date(utcGuess));
      const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? '0');
      let hourInTz = get('hour');
      if (hourInTz === 24) hourInTz = 0;
      const asTzUtc = Date.UTC(
        get('year'),
        get('month') - 1,
        get('day'),
        hourInTz,
        get('minute'),
        get('second'),
      );
      return new Date(utcGuess - (asTzUtc - utcGuess));
    } catch {
      return new Date(utcGuess);
    }
  }

  private async ensureDay(projectId: string, day: string) {
    const existing = await this.days.findOne({ where: { projectId, day } });
    if (existing) {
      return existing;
    }
    return this.days.save(
      this.days.create({
        projectId,
        day,
        status: 'COLLECTING',
        lastManualRunAt: null,
      }),
    );
  }

  private async ensureDayLookup(projectId: string, day: string) {
    const row = await this.days.findOne({ where: { projectId, day } });
    if (!row) {
      throw new NotFoundException('день не найден');
    }
    return row;
  }
}
