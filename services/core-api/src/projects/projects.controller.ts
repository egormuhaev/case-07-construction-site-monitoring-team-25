import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { CreateProjectDto, PatchMatchDto, UpdateProjectDto } from './dto';
import { ProjectsService } from './projects.service';

@Controller()
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get('projects')
  list() {
    return this.projects.list();
  }

  @Post('projects')
  create(@Body() dto: CreateProjectDto) {
    return this.projects.create(dto);
  }

  @Get('projects/:id')
  get(@Param('id') id: string) {
    return this.projects.get(id);
  }

  @Patch('projects/:id')
  update(@Param('id') id: string, @Body() dto: UpdateProjectDto) {
    return this.projects.update(id, dto);
  }

  @Post('projects/:id/ingest-token/rotate')
  rotate(@Param('id') id: string) {
    return this.projects.rotateToken(id);
  }

  @Get('projects/:id/plans')
  plans(@Param('id') id: string) {
    return this.projects.listPlans(id);
  }

  @Post('projects/:id/plans/active/matches/confirm')
  confirm(@Param('id') id: string) {
    return this.projects.confirmMatches(id);
  }

  @Post('projects/:id/plans')
  @UseInterceptors(FileInterceptor('file'))
  uploadPlan(@Param('id') id: string, @UploadedFile() file: Express.Multer.File) {
    return this.projects.uploadPlan(id, file);
  }

  @Get('projects/:id/plans/active/works')
  works(
    @Param('id') id: string,
    @Query('q') q?: string,
    @Query('source') source?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    return this.projects.listWorks(id, {
      q,
      source,
      skip: skip ? Number(skip) : 0,
      take: take ? Number(take) : 50,
    });
  }

  @Patch('works/:workId/match')
  match(@Param('workId') workId: string, @Body() dto: PatchMatchDto) {
    return this.projects.patchMatch(workId, dto.classifierId);
  }

  @Get('catalog/classifier')
  catalog(
    @Query('sphere') sphere?: string,
    @Query('collection') collection?: string,
    @Query('tableCode') tableCode?: string,
    @Query('q') q?: string,
  ) {
    return this.projects.catalog({ sphere, collection, tableCode, q });
  }

  @Get('projects/:id/days')
  days(@Param('id') id: string) {
    return this.projects.listDays(id);
  }

  @Get('projects/:id/days/:day')
  day(@Param('id') id: string, @Param('day') day: string) {
    return this.projects.getDay(id, day);
  }

  @Post('projects/:id/days/:day/images')
  @UseInterceptors(FilesInterceptor('files', 200))
  addImages(
    @Param('id') id: string,
    @Param('day') day: string,
    @UploadedFiles() files: Express.Multer.File[],
    @Body('capturedAt') capturedAt?: string | string[],
  ) {
    const list = Array.isArray(capturedAt) ? capturedAt : capturedAt ? [capturedAt] : [];
    return this.projects.addManualImages(id, day, files ?? [], list);
  }

  @Post('projects/:id/days/:day/detection')
  detect(@Param('id') id: string, @Param('day') day: string) {
    return this.projects.startDetection(id, day, 'MANUAL');
  }
}
