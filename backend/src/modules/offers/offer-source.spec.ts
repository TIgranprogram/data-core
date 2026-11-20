import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateOfferDto, UpdateOfferDto } from './dto';
import { agreedOfferTotal, assertOfferOrderMatch, validateSourceItems } from './offer-source';

const source = { documentUid: 'offer-original', rowKey: '6', title: 'Спортивный комплекс', qty: 1, unitPrice: 1070000, lineAmount: 1070000 };
const item = { productName: source.title, quantity: 1, unitPrice: source.unitPrice, total: source.lineAmount, sourceRowKey: '6', sourceLine: source, scopeState: 'excluded', exclusionReason: 'Владелец исключил', exclusionConfirmedAt: '2026-11-20', exclusionEventDate: null };
describe('C164: история КП и независимое сопоставление', () => {
  it('исключение сохраняет исходный итог и отдельный согласованный состав', () => {
    const rows = [{ productName: 'Остальные8строк', quantity: 1, total: 2061000 }, item];
    expect(rows.reduce((s,r)=>s+r.total,0)).toBe(3131000);
    expect(agreedOfferTotal(rows)).toBe(2061000);
    expect(agreedOfferTotal([{total: 0.1},{total: 0.2}])).toBe(0.3);
    expect(() => validateSourceItems(rows)).not.toThrow();
  });
  it('исходную строку нельзя удалить/переписать; ручное сопоставление не меняет снимок', () => {
    expect(() => validateSourceItems([], [item])).toThrow('неизменяема');
    expect(() => validateSourceItems([{...item, sourceLine:{...source,lineAmount:1}}], [item])).toThrow('неизменяема');
    expect(() => validateSourceItems([{...item, productId:'aaaaaaaaaaaaaaaaaaaaaaaa',matchStatus:'confirmed'}], [item])).not.toThrow();
    expect(() => validateSourceItems([item,item])).toThrow('Повтор');
    expect(() => validateSourceItems([{...item,exclusionReason:''}])).toThrow('причина');
  });
  it('не связывает КП с другим покупателем/суммой и не включает исключённую строку', () => {
    const offer={companyId:'a',counterpartyId:'b',items:[{productName:'Скамья',quantity:2,total:100,size:'2м'},item]};
    const contract={companyId:'a',counterpartyId:'b'};
    expect(()=>assertOfferOrderMatch(offer,contract,[{title:'Скамья',qty:2,amount:100,size:'2м'}])).not.toThrow();
    expect(()=>assertOfferOrderMatch(offer,{...contract,counterpartyId:'c'},[])).toThrow('покупателя');
    expect(()=>assertOfferOrderMatch(offer,contract,[{title:'Скамья',qty:2,amount:101,size:'2м'}])).toThrow('различаются');
  });
  it('DTO принимает источник/пустую дату исключения и CAS, но запрещает произвольные поля', async () => {
    const dto=plainToInstance(UpdateOfferDto,{version:0,items:[item]});
    // total вычисляет сервер; клиент не должен присылать это поле строки.
    delete (dto.items![0] as unknown as Record<string,unknown>).total;
    expect(await validate(dto,{whitelist:true,forbidNonWhitelisted:true})).toEqual([]);
    const bad=plainToInstance(CreateOfferDto,{companyId:'aaaaaaaaaaaaaaaaaaaaaaaa',customer:'Клиент',items:[{productName:'X',quantity:1,unitPrice:1}],legalVersion:5});
    expect((await validate(bad,{whitelist:true,forbidNonWhitelisted:true})).some(e=>e.property==='legalVersion')).toBe(true);
  });
});
