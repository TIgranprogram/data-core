import { IsOptional, IsString, Length, Matches } from 'class-validator';

/**
 * TZ-ORDERS-303 — thin заказчик+объект одним действием.
 * INN генерируется на сервисе (валидный stub), roles = ['customer'].
 */
export class QuickCreatePartyDto {
  @IsString()
  @Length(1, 256)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(0, 32)
  @Matches(/^[+\d\s()-]*$/, { message: 'phone must contain digits/phone chars only' })
  phone?: string;

  @IsString()
  @Length(1, 512)
  address!: string;

  @IsOptional()
  @IsString()
  @Length(1, 256)
  siteName?: string;
}
