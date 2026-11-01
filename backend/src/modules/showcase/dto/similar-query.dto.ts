import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Запрос «похожие изделия»: только эти два поля (forbidNonWhitelisted). */
export class SimilarQueryDto {
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MaxLength(40) excludeId?: string;
}
