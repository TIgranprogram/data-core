import { IsDateString, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { IsObjectId } from '../../../common/decorators/is-object-id.decorator';

/** ПН: занять номера для паспорта из другой программы. Номера не переданы — выдаёт сервер. */
export class ExternalPassportDto {
  @IsObjectId() productId!: string;
  @IsOptional() @IsDateString() date?: string;
  @IsOptional() @IsString() @MaxLength(300) customerName?: string;
  @IsOptional() @IsObjectId() salesOrderId?: string;
  @IsOptional() @Matches(/^\d{1,9}$/, { message: '№ паспорта — от 1 до 9 цифр' }) passportNumber?: string;
  @IsOptional() @IsString() @MaxLength(50) @Matches(/^(?!\d{10,}$).*$/, { message: 'Номер изделия — не более 9 цифр' }) productCode?: string;
}
