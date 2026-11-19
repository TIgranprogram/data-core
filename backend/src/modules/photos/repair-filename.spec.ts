import { validate } from 'class-validator';
import { isFilenameEncodingRepair, RepairOriginalFilenameDto } from './repair-filename.dto';
import { decodeMulterOriginalName } from './image-upload.options';

describe('C165: адресное исправление кодировки originalFilename', () => {
  it('восстанавливает точный CP1251/latin1 случай и UTF8/latin1', () => {
    expect(isFilenameEncodingRepair('Ñ÷åò íà îïëàòó ¹ 24479 îò 17.09.2026.pdf', 'Счет на оплату № 24479 от 17.09.2026.pdf')).toBe(true);
    const correct = 'Счёт № 5.pdf';
    expect(isFilenameEncodingRepair(Buffer.from(correct).toString('latin1'), correct)).toBe(true);
    expect(isFilenameEncodingRepair('correct.pdf', 'renamed.pdf')).toBe(false);
    expect(isFilenameEncodingRepair(correct, correct)).toBe(false);
    expect(isFilenameEncodingRepair('Счёт.pdf', 'Другой.pdf')).toBe(false);
  });
  it('не меняет корректные западные имена при обычной загрузке', () => {
    for (const name of ['café.pdf', 'Müller.pdf', 'normal.pdf']) expect(decodeMulterOriginalName(name)).toBe(name);
  });
  it('не допускает пути, control и чрезмерные имена через DTO', async () => {
    for (const name of ['../file.pdf', 'C:\\file.pdf', 'bad\nname.pdf', 'a'.repeat(256)]) {
      expect((await validate(Object.assign(new RepairOriginalFilenameDto(), { expectedOriginalFilename: 'old.pdf', newOriginalFilename: name }))).length).toBeGreaterThan(0);
    }
  });
});
