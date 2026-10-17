import { IsNotEmpty, IsString } from 'class-validator';

export class CreateCommentDto {
  @IsString() @IsNotEmpty()
  packageTag!: string;

  @IsString() @IsNotEmpty()
  text!: string;
}
