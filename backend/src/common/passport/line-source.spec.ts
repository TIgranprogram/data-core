import { Types } from 'mongoose';
import { assertPassportToken, claimPassportLine, epochOf, lineBaseline, passportContextToken, passportContextStage, revisionOf, selectionOf } from './line-source';

describe('C170 барьер позиции', () => {
  const line = () => ({ _id: new Types.ObjectId(), orderId: new Types.ObjectId(), productId: new Types.ObjectId(), deletedAt: null, cancelledAt: null });
  it('legacy отсутствующие версии =0; токен связан с каждой частью контекста и поколением', () => {
    const inc = line(); expect(epochOf(inc)).toBe(0); expect(revisionOf(inc)).toBe(0); expect(selectionOf(inc)).toEqual({mode:'site',revision:0});
    const token = passportContextToken(inc, 3); expect(() => assertPassportToken(token, inc, 3)).not.toThrow();
    for (const delta of [{passportEpoch:1}, {passportSelection:{mode:'site' as const,revision:1}}, {productId:new Types.ObjectId()}, {orderId:new Types.ObjectId()}, {lineType:'service'}, {cancelledAt:new Date()}, {deletedAt:new Date()}]) expect(() => assertPassportToken(token, {...inc,...delta},3)).toThrow();
    expect(() => assertPassportToken(token, inc, 4)).toThrow(); expect(() => assertPassportToken('bad', inc, 3)).toThrow();
  });
  it('делает настоящую запись общей позиции внутри session', async () => {
    const inc = line(), updateOne=jest.fn().mockResolvedValue({modifiedCount:1}), session={} as never;
    const db={collection:(name:string)=>name==='incomes'?{findOne:async()=>inc,updateOne}:{findOne:async()=>({_id:inc.orderId}),updateOne:async()=>({modifiedCount:1})}} as never;
    await claimPassportLine(db,session,inc,0,'site'); expect(updateOne).toHaveBeenCalledWith(expect.objectContaining({_id:inc._id}),{$inc:{passportEpoch:1}},{session});
  });
  it('параллельный выбор/изменённый epoch не подменяет исходный baseline', async () => {
    const inc=line(), updateOne=jest.fn(); const db={collection:(name:string)=>name==='incomes'?{findOne:async()=>({...inc,passportEpoch:1}),updateOne}:{findOne:async()=>({_id:inc.orderId}),updateOne:async()=>({modifiedCount:1})}} as never;
    await expect(claimPassportLine(db,{} as never,inc,0,'site')).rejects.toMatchObject({response:{code:'STALE_CONTEXT'}}); expect(updateOne).not.toHaveBeenCalled();
  });
  it('attachment даже невалидный запрещает новый номер', async () => {
    const inc={...line(),passportSelection:{mode:'attachment' as const,revision:2,invalidReason:'PRODUCT_CHANGED'}}, updateOne=jest.fn();
    const db={collection:(name:string)=>name==='incomes'?{findOne:async()=>inc,updateOne}:{findOne:async()=>({_id:inc.orderId}),updateOne:async()=>({modifiedCount:1})}} as never;
    await expect(claimPassportLine(db,{} as never,inc,0,'site')).rejects.toMatchObject({response:{code:'SOURCE_ATTACHMENT'}}); expect(updateOne).not.toHaveBeenCalled();
    expect(lineBaseline(inc).selectionRevision).toBe(2); expect(passportContextStage(true).$set.passportEpoch).toEqual({$add:[{$ifNull:['$passportEpoch',0]},1]});
  });
});
