import { BadRequestException } from '@nestjs/common';
import { FinancialArticleWriter } from './financial-article-writer';
const writer = () => new FinancialArticleWriter(undefined as never, undefined as never, undefined as never, undefined as never);
describe('C161: malformed input не превращается в сбой или обход записи', () => {
  it.each(['name','type','nodeKind','selectable','sortOrder','categoryIds','version'])('явный null в %s отклоняется400 до обращения к базе', async field => {
    await expect(writer().mutate('financialArticles', 'create', undefined, { name: 'Статья', expectedTreeRevision: 0, [field]: null })).rejects.toBeInstanceOf(BadRequestException);
  });
  it('неизвестное поле и отсутствие версии существующего узла отклоняются400', async () => {
    await expect(writer().mutate('financialArticles', 'create', undefined, { name: 'Статья', expectedTreeRevision: 0, unexpected: true })).rejects.toBeInstanceOf(BadRequestException);
    await expect(writer().mutate('financialArticles', 'update', '000000000000000000000001', { name: 'Статья', expectedTreeRevision: 0 })).rejects.toBeInstanceOf(BadRequestException);
  });
});
