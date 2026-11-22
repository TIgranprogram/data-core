import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Equals, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';

export class ArchiveCommand {
  @ApiProperty() @IsString() @Length(3, 1000) reason!: string;
  @ApiProperty() @IsString() @Length(1, 100) clientUid!: string;
  @ApiProperty() @IsInt() @Min(0) expectedStateVersion!: number;
}

export class ArchiveCloseCommand extends ArchiveCommand {
  @ApiProperty() @Equals(true) manufactureComplete!: true;
  @ApiProperty() @Equals(true) servicesComplete!: true;
  @ApiProperty() @Equals(true) installationComplete!: true;
  @ApiProperty() @Equals(true) documentsComplete!: true;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 100) evidenceDocumentUid?: string;
}
