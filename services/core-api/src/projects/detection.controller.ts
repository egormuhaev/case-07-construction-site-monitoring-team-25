import { createReadStream, existsSync } from 'node:fs';
import { extname } from 'node:path';
import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Response } from 'express';
import { Repository } from 'typeorm';
import { StorageService } from '../storage/storage.service';
import { DetectionFrame, DetectionObject, DetectionRun } from './entities/detection.entities';
import { ProjectImage } from './entities/project-image.entity';

function contentTypeForPath(path: string): string {
  const ext = extname(path).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/jpeg';
}

@Controller()
export class DetectionController {
  constructor(
    @InjectRepository(DetectionRun) private readonly runs: Repository<DetectionRun>,
    @InjectRepository(DetectionFrame) private readonly frames: Repository<DetectionFrame>,
    @InjectRepository(DetectionObject) private readonly objects: Repository<DetectionObject>,
    @InjectRepository(ProjectImage) private readonly images: Repository<ProjectImage>,
    private readonly storage: StorageService,
  ) {}

  @Get('detection-runs/:id')
  async getRun(@Param('id') id: string) {
    const run = await this.runs.findOne({ where: { id }, relations: { day: true } });
    if (!run) {
      throw new NotFoundException('прогон детекции не найден');
    }
    const frames = await this.frames.find({
      where: { runId: id },
      relations: { image: true },
    });
    const objects = frames.length
      ? await this.objects.find({
          where: frames.map((frame) => ({ frameId: frame.id })),
          relations: { detectionClass: true },
        })
      : [];
    const byFrame = new Map<string, DetectionObject[]>();
    for (const item of objects) {
      const list = byFrame.get(item.frameId) ?? [];
      list.push(item);
      byFrame.set(item.frameId, list);
    }
    return {
      ...run,
      frames: frames.map((frame) => ({
        ...frame,
        objects: byFrame.get(frame.id) ?? [],
      })),
    };
  }

  @Get('images/:id/file')
  async file(@Param('id') id: string, @Res() res: Response) {
    const image = await this.images.findOneBy({ id });
    if (!image) {
      throw new NotFoundException('изображение не найдено');
    }
    const abs = this.storage.resolveUnderRoot(image.relativePath);
    if (!existsSync(abs)) {
      throw new NotFoundException('файл изображения не найден');
    }
    res.setHeader('Content-Type', contentTypeForPath(image.relativePath || abs));
    createReadStream(abs).pipe(res);
  }
}
