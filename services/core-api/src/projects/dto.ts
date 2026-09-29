import {
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

const TIME_HH_MM = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

export class CreateProjectDto {
  @IsString()
  @MaxLength(255)
  name: string;

  @IsOptional()
  @IsString()
  customer?: string;

  @IsOptional()
  @IsString()
  contractor?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  objectType?: string;

  @IsOptional()
  @IsString()
  contractNumber?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsString()
  @Matches(TIME_HH_MM, { message: 'shiftStart должен быть HH:MM' })
  shiftStart?: string | null;

  @IsOptional()
  @IsString()
  @Matches(TIME_HH_MM, { message: 'shiftEnd должен быть HH:MM' })
  shiftEnd?: string | null;
}

export class UpdateProjectDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  customer?: string | null;

  @IsOptional()
  @IsString()
  contractor?: string | null;

  @IsOptional()
  @IsString()
  address?: string | null;

  @IsOptional()
  @IsString()
  objectType?: string | null;

  @IsOptional()
  @IsString()
  contractNumber?: string | null;

  @IsOptional()
  @IsString()
  notes?: string | null;

  @IsOptional()
  @IsDateString()
  startDate?: string | null;

  @IsOptional()
  @IsDateString()
  endDate?: string | null;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsString()
  @Matches(TIME_HH_MM, { message: 'shiftStart должен быть HH:MM' })
  shiftStart?: string | null;

  @IsOptional()
  @IsString()
  @Matches(TIME_HH_MM, { message: 'shiftEnd должен быть HH:MM' })
  shiftEnd?: string | null;
}

export class MatchAssignmentDto {
  @IsString()
  classifierId: string;

  @IsOptional()
  @IsNumber()
  volume?: number | null;

  @IsOptional()
  @IsNumber()
  durationDays?: number | null;
}

export class PatchMatchDto {
  @IsOptional()
  @IsString()
  classifierId?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MatchAssignmentDto)
  assignments?: MatchAssignmentDto[];
}
