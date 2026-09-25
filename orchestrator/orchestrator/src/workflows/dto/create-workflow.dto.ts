import { IsString, Matches } from 'class-validator';

export class CreateWorkflowDto {
  @IsString()
  @Matches(/^\/data\//, {
    message: 'inputPath must be a shared container path under /data/',
  })
  inputPath: string;
}
