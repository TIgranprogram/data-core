import { IsBoolean } from 'class-validator';

export class SetOrderLineReadyDto {
  @IsBoolean()
  readyForWork!: boolean;
}
