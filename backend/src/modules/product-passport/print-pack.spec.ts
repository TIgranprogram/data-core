import { BadRequestException } from '@nestjs/common';
import { packOf } from './print-pack';

describe('режим печати pack', () => {
  it('пусто — паспорт, как у старых клиентов', () => {
    expect(packOf(undefined)).toBe('passport');
    expect(packOf('')).toBe('passport');
    expect(packOf('passport')).toBe('passport');
    expect(packOf('tech')).toBe('tech');
    expect(packOf('combined')).toBe('combined');
  });
  it('чужое значение — 400, variant сюда не подходит', () => {
    expect(() => packOf('short')).toThrow(BadRequestException);
    expect(() => packOf('full')).toThrow(BadRequestException);
  });
});
