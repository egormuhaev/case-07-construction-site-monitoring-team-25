import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { IsDateString, IsIn, IsString } from 'class-validator';
import { AnalysisService } from './analysis.service';
import { FindingStatus } from './entities/analysis.entities';

class PeriodAnalysisDto {
  @IsDateString()
  from: string;

  @IsDateString()
  to: string;
}

class PatchFindingDto {
  @IsString()
  @IsIn(['POTENTIAL', 'CONFIRMED', 'DISMISSED'])
  status: FindingStatus;
}

@Controller()
export class AnalysisController {
  constructor(private readonly analysis: AnalysisService) {}

  @Post('projects/:id/days/:day/analysis')
  startDay(@Param('id') id: string, @Param('day') day: string) {
    return this.analysis.startDay(id, day, 'MANUAL');
  }

  @Get('projects/:id/days/:day/analysis')
  getDay(@Param('id') id: string, @Param('day') day: string) {
    return this.analysis.getDayAnalysis(id, day);
  }

  @Post('projects/:id/analysis')
  startPeriod(@Param('id') id: string, @Body() dto: PeriodAnalysisDto) {
    return this.analysis.startPeriod(id, dto.from, dto.to, 'MANUAL');
  }

  @Get('projects/:id/analysis/heatmap')
  heatmap(
    @Param('id') id: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.analysis.listPeriodHeatmap(id, from, to);
  }

  @Get('analysis-runs/:runId')
  getRun(@Param('runId') runId: string) {
    return this.analysis.getRun(runId);
  }

  @Get('projects/:id/findings')
  findings(
    @Param('id') id: string,
    @Query('status') status?: FindingStatus,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.analysis.listFindings(id, { status, from, to });
  }

  @Get('findings/:id')
  getFinding(@Param('id') id: string) {
    return this.analysis.getFinding(id);
  }

  @Patch('findings/:id')
  patchFinding(@Param('id') id: string, @Body() dto: PatchFindingDto) {
    return this.analysis.setFindingStatus(id, dto.status);
  }
}
