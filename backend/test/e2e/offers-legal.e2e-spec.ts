import request from 'supertest';
import sharp from 'sharp';
import { createHash } from 'crypto';
import { Types } from 'mongoose';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';

/** C164: реальные original bytes, конкурентный повтор, CAS, связь без конверсии/денег. */
describe('C164: исходное КП и договор', () => {
 let ctx: TestContext | undefined; let token: AuthTokens; let companyId: string; let counterpartyId: string; let fileId: string; let sha: string;
 const db=()=>ctx!.connection.db!;
 const http=()=>request(ctx!.app.getHttpServer());
 const auth=()=>authHeader(token.access);
 const legal=()=>({state:'draft',sourceDate:'2026-11-17',currency:'RUB',gross:3131000,vatMode:'included',vatRate:22,vatAmount:564606.56,companySnapshot:{name:'Продавец',inn:'2312308098'},counterpartySnapshot:{name:'Покупатель',inn:'0107020521'},signature:{state:'unknown'},paymentVerification:'unknown',documents:[{uid:'offer-source',kind:'offer',revision:'1',date:'2026-11-17',fileId,sourceSha256:sha}],issues:[{uid:'address',field:'objectAddress',label:'Адрес',reason:'Нужно уточнить',state:'unknown'}],paymentPlan:[],origin:{kind:'source_import'}});
 const items=()=>[{productName:'Согласованные позиции',quantity:1,unitPrice:2061000,sourceRowKey:'1',sourceLine:{documentUid:'offer-source',rowKey:'1',title:'Согласованные позиции',qty:1,unitPrice:2061000,lineAmount:2061000},matchStatus:'unmatched'}, {productName:'Спортивный комплекс',quantity:1,unitPrice:1070000,sourceRowKey:'6',sourceLine:{documentUid:'offer-source',rowKey:'6',title:'Спортивный комплекс',qty:1,unitPrice:1070000,lineAmount:1070000},scopeState:'excluded',exclusionReason:'Исключено владельцем',exclusionConfirmedAt:'2026-11-20',exclusionEventDate:null,matchStatus:'unmatched'}];
 const body=()=>({companyId,counterpartyId,customer:'Покупатель',date:'2026-11-17',intakeUid:'c164-original-offer',sourceNumber:null,initialLegal:legal(),items:items()});
 beforeAll(async()=>{
  ctx=await createTestApp();token=await loginAsAdmin(ctx.app);
  companyId=String((await db().collection('organizations').insertOne({name:'Продавец',inn:'2312308098',isOurCompany:true,deletedAt:null})).insertedId);
  counterpartyId=String((await db().collection('organizations').insertOne({name:'Покупатель',inn:'0107020521',deletedAt:null})).insertedId);
  await db().collection('commercialoffers').createIndex({intakeUid:1},{name:'c164_offer_intake_uid',unique:true,partialFilterExpression:{intakeUid:{$type:'string'}}});
  await db().collection('commercialoffers').createIndex({intakeKey:1},{name:'c164_offer_intake_key',unique:true,partialFilterExpression:{intakeKey:{$type:'string'}}});
  const bytes=await sharp({create:{width:10,height:10,channels:3,background:'#ffffff'}}).png().toBuffer();sha=createHash('sha256').update(bytes).digest('hex');
  const upload=await http().post('/api/photos/upload').set(auth()).attach('file',bytes,{filename:'Исходное КП.png',contentType:'image/png'}).expect(201);fileId=upload.body.id;
 });
 afterAll(async()=>{await ctx?.cleanup();});
 let id='';
 it('конкурентный одинаковый источник сохраняется один раз, даты и оба итога различены',async()=>{
  const [a,b]=await Promise.all([http().post('/api/offers').set(auth()).send(body()),http().post('/api/offers').set(auth()).send(body())]);
  expect(a.status).toBe(201);expect(b.status).toBe(201);expect(a.body.id).toBe(b.body.id);id=a.body.id;
  const out=(await http().get(`/api/offers/${id}`).set(auth()).expect(200)).body;
  expect(out).toMatchObject({total:3131000,agreedTotal:2061000,legalVersion:0,status:'draft',orderId:null});
  expect(out.date.slice(0,10)).toBe('2026-11-17');expect(out.items[1]).toMatchObject({scopeState:'excluded',exclusionEventDate:null});
  expect(await db().collection('commercialoffers').countDocuments({intakeUid:'c164-original-offer'})).toBe(1);
  expect(await db().collection('incomes').countDocuments({})).toBe(0);
  await http().post('/api/offers').set(auth()).send({...body(),intakeUid:'different-uid',notes:'Другое содержимое'}).expect(409);
 });
 it('legal CAS/history работает дляdraft и повтор UID не пишет второй раз',async()=>{
  const changed={...legal(),objectAddress:'Уточнённый адрес'};
  const payload={version:0,clientUid:'legal-edit',reason:'Уточнение менеджера',legal:changed};
  const a=await http().patch(`/api/offers/${id}/legal`).set(auth()).send(payload).expect(200);
  expect(a.body.legalVersion).toBe(1);
  const again=await http().patch(`/api/offers/${id}/legal`).set(auth()).send(payload).expect(200);expect(again.body.legalVersion).toBe(1);
  await http().patch(`/api/offers/${id}/legal`).set(auth()).send({...payload,clientUid:'stale'}).expect(409);
  await http().post(`/api/offers/${id}/preview`).set(auth()).send({version:1,date:'2026-11-18'}).expect(409);
  await http().patch(`/api/offers/${id}`).set(auth()).send({version:1,date:null}).expect(409);
  await http().patch(`/api/offers/${id}`).set(auth()).send({version:1,date:'2026-11-18'}).expect(409);
  await http().patch(`/api/offers/${id}`).set(auth()).send({version:1,items:items().slice(0,1)}).expect(409);
 });
 it('связь с существующим договором сохраняет состав/деньги и проверяет покупателя',async()=>{
  const order=(await db().collection('salesorders').insertOne({orderNo:'18/11/45',companyId:new Types.ObjectId(companyId),counterpartyId:new Types.ObjectId(counterpartyId),deletedAt:null})).insertedId;
  await db().collection('incomes').insertOne({orderId:order,title:'Согласованные позиции',qty:1,unitPrice:2061000,amount:2061000,deletedAt:null});
  const payload={orderId:String(order),version:1,clientUid:'link-existing'};
  const r=await http().post(`/api/offers/${id}/link-order`).set(auth()).send(payload).expect(200);
  expect(r.body).toMatchObject({orderId:String(order),status:'draft',agreedTotal:2061000,total:3131000,legalVersion:2});
  await http().post(`/api/offers/${id}/link-order`).set(auth()).send(payload).expect(200);
  expect(await db().collection('salesorders').countDocuments({_id:order})).toBe(1);expect(await db().collection('incomes').countDocuments({orderId:order})).toBe(1);
  const row=await db().collection('incomes').findOne({orderId:order});expect(row?.paidDate).toBeUndefined();expect(row?.payments).toBeUndefined();
 });
});
