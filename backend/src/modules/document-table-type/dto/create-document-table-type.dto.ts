import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { IsObjectId } from '../../../common/decorators/is-object-id.decorator';

export class DocTableColumnDto {
  @IsString() @IsNotEmpty() key!: string;
  @IsString() @IsNotEmpty() label!: string;
  @IsOptional() @IsNumber() @Min(1) width?: number;
}

export class CreateDocumentTableTypeDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsString() label?: string;
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsObjectId() docType?: string;
  @IsOptional() @IsString() dataSource?: string;
  @IsOptional() @IsString() productKind?: string;
  @IsOptional() @IsNumber() @Min(0) sortOrder?: number;
  @IsOptional() @IsNumber() @Min(8) fontSize?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DocTableColumnDto)
  columns!: DocTableColumnDto[];
}
