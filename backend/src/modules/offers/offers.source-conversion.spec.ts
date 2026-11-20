import { Types } from 'mongoose';
import { OffersService } from './offers.service';

describe('C164: восстанавливаемая конверсия исходного КП', () => {
 it('частичный сбой сохраняет бронь/UID, повтор не включает исключённую строку и не создаёт новый заказ после DONE',async()=>{
  const doc:any={_id:new Types.ObjectId(),number:'КП-9',companyId:new Types.ObjectId(),counterpartyId:new Types.ObjectId(),customer:'Клиент',status:'accepted',legalVersion:0,legal:{state:'draft',currency:'RUB',gross:3131000,vatMode:'included',vatRate:22,signature:{state:'unknown'},paymentVerification:'unknown',documents:[],issues:[],paymentPlan:[]},items:[{productName:'Согласовано',quantity:1,unitPrice:2061000,total:2061000},{productName:'Исключено',quantity:1,unitPrice:1070000,total:1070000,scopeState:'excluded'}]};
  const orderId=String(new Types.ObjectId());
  const model={findOne:()=>({lean:()=>({exec:async()=>doc})}),updateOne:jest.fn((guard:any,change:any)=>({exec:async()=>{
   if(guard.legalVersion!==undefined&&guard.legalVersion!==doc.legalVersion)return {matchedCount:0};
   for(const[k,v]of Object.entries(change.$set||{})){if(k.startsWith('orderConversion.'))doc.orderConversion[k.split('.')[1]]=v;else doc[k]=v;}
   doc.legalVersion+=(change.$inc?.legalVersion||0);return {matchedCount:1};
  }}))};
  const sales={create:jest.fn(async(dto:any)=>({id:orderId,orderNo:dto.orderNo}))};
  const incomes={create:jest.fn().mockRejectedValueOnce(new Error('Temporary')).mockResolvedValue({})};
  const svc=new OffersService({}as never,model as never,{}as never,{}as never,sales as never,incomes as never);
  const actor={id:String(new Types.ObjectId()),username:'manager',role:'manager'};
  await expect(svc.createOrder(String(doc._id),{version:0},actor as never)).rejects.toThrow('Temporary');
  expect(doc.orderConversion.status).toBe('pending');expect(doc.legalVersion).toBe(1);
  await expect(svc.update(String(doc._id),{version:1,notes:'edit'},actor as never)).rejects.toThrow('не завершена');
  await expect(svc.createOrder(String(doc._id),{version:0,orderNo:'Другой'},actor as never)).rejects.toThrow('другими');
  const done=await svc.createOrder(String(doc._id),{version:0},actor as never);
  expect(done.orderId).toBe(orderId);expect(doc.orderConversion.status).toBe('done');
  expect(sales.create.mock.calls[0][0]).toMatchObject({productionAssignment:'unassigned',initialLegal:{gross:2061000,signature:{state:'unknown'},paymentVerification:'unknown',paymentPlan:[]}});
  expect(sales.create.mock.calls[0][0].initialLegal.sourceDate).toBeUndefined();
  expect(sales.create.mock.calls[0][0].intakeUid).toBe(sales.create.mock.calls[1][0].intakeUid);
  const rows=incomes.create.mock.calls.map(c=>c[0]);expect(rows).toHaveLength(2);expect(rows.every(r=>r.title==='Согласовано'&&r.matchingMode==='manual')).toBe(true);expect(rows[0].clientUid).toBe(rows[1].clientUid);
  await svc.createOrder(String(doc._id),{version:0},actor as never);expect(sales.create).toHaveBeenCalledTimes(2);
 });
});
