import {
  BadRequestException,
  Controller,
  Headers,
  Post,
  UploadedFiles,
  UseInterceptors,
  Body,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ProjectsService } from './projects.service';

@Controller('ingest')
export class IngestController {
  constructor(private readonly projects: ProjectsService) {}

  @Post('images')
  @UseInterceptors(FilesInterceptor('files', 200))
  ingest(
    @Headers('x-ingest-token') token: string | undefined,
    @UploadedFiles() files: Express.Multer.File[],
    @Body('projectId') projectId: string,
    @Body('capturedAt') capturedAt?: string | string[],
    @Body('cameraId') cameraId?: string | string[],
  ) {
    if (!projectId || !token) {
      throw new BadRequestException('нужны projectId и заголовок X-Ingest-Token');
    }
    return this.projects.ingestImages({
      projectId,
      token,
      files: files ?? [],
      capturedAt: Array.isArray(capturedAt) ? capturedAt : capturedAt ? [capturedAt] : [],
      cameraId: Array.isArray(cameraId) ? cameraId : cameraId ? [cameraId] : [],
    });
  }
}
