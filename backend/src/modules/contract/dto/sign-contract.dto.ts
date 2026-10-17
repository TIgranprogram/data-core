import { IsDateString } from 'class-validator';

export class SignContractDto {
  @IsDateString()
  signedAt!: string;
}
