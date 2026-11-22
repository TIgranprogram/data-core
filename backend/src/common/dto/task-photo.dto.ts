import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId } from 'class-validator';

export class TaskPhotoDto {
  @ApiProperty({ description: 'Фото из POST /api/photos/upload' })
  @IsMongoId() photoId!: string;
}
