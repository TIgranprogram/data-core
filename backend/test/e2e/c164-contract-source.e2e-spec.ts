import request from 'supertest';
import { mkdtemp, readFile, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { createHash } from 'crypto';
import { Types } from 'mongoose';
import { createTestApp, TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, AuthTokens } from '../setup/admin.fixture';
/** Только отдельнаяtestDBхarness; оригиналы находятся в own mkdtemp. */
describe('C164 клиентский источник',()=>{
 let ctx:TestContext|undefined,token:AuthTokens,company='',buyer='',file='',folder='',oldUpload:string|undefined;
 const db=()=>ctx!.connection.db!;
 const call=()=>request(ctx!.app.getHttpServer());
 const auth=()=>authHeader(token.access);
 const pdf=Buffer.from('%PDF-1.4\nC164 isolated source fixture\n%%EOF');const sha=createHash('sha256').update(pdf).digest('hex');
 beforeAll(async()=>{
  folder=await mkdtemp(join(tmpdir(),'c164-e2e-'));oldUpload=process.env.UPLOAD_DIR;process.env.UPLOAD_DIR=folder;
  await writeFile(join(folder,'source.pdf'),pdf);
  ctx=await createTestApp();token=await loginAsAdmin(ctx.app);
  await Promise.all(['salesorders','incomes','commercialoffers'].map(c=>db().collection(c).deleteMany({})));
  for(const name of ['SalesOrder','Income'])await ctx.connection.models[name].createIndexes();
  const orgs=await db().collection('organizations').insertMany([{name:'ССЮ C164',shortName:'ССЮ C164',inn:'2312308098',isOurCompany:true,deletedAt:null},{name:'Покупатель C164',inn:'0107020521',deletedAt:null}]);company=String(orgs.insertedIds[0]);buyer=String(orgs.insertedIds[1]);
  file=String((await db().collection('photos').insertOne({storageUrl:'/uploads/source.pdf',originalFilename:'Источник.pdf',variant:'original',mimeType:'application/pdf',sizeBytes:pdf.length,deletedAt:null})).insertedId);
 });
 afterAll(async()=>{await ctx?.cleanup();if(oldUpload===undefined)delete process.env.UPLOAD_DIR;else process.env.UPLOAD_DIR=oldUpload;if(folder.startsWith(join(tmpdir(),'c164-e2e-')))await rm(folder,{recursive:true,force:true});});
 const legal=(no:string)=>({state:'draft',sourceNumber:no,sourceDate:'2026-11-18',currency:'RUB',gross:1000,vatMode:'included',vatRate:22,vatAmount:180.33,companySnapshot:{name:'ССЮ C164',inn:'2312308098'},counterpartySnapshot:{name:'Покупатель C164',inn:'0107020521'},signature:{state:'unknown'},paymentVerification:'unknown',documents:[{uid:'doc-'+no,kind:'contract',number:no,date:'2026-11-18',revision:'1',fileId:file,sourceSha256:sha}],issues:[{uid:'address',field:'objectAddress',label:'Адрес объекта',reason:'Не указан',state:'unknown'}],paymentPlan:[],origin:{kind:'source_import'}});
 const payload=(no:string)=>({orderNo:no,companyId:company,counterpartyId:buyer,customer:'Покупатель C164',productionAssignment:'unassigned',intakeUid:'c164-header-'+no,initialLegal:legal(no)});
 let order='',line='';
 it('сохраняетдоговорбеззаказа, исходныереквизитыиоригинал;новыйUIDтогоисточникавозвращаеттотжеID',async()=>{
  const p=payload('18/11/45');const a=await call().post('/api/salesorders').set(auth()).send(p).expect(201);order=a.body.id;
  expect(a.body.productionNo).toBeFalsy();expect(a.body.legal.documents[0]).toMatchObject({fileId:file,sourceSha256:sha});expect(a.body.legal.companySnapshot.inn).toBe('2312308098');
  const replay=await call().post('/api/salesorders').set(auth()).send({...p,intakeUid:'another-uid'}).expect(201);expect(replay.body.id).toBe(order);
  await call().post('/api/salesorders').set(auth()).send({...p,notes:'изменено'}).expect(409);
 });
 it('CREATE источника не обходит сопоставление через производственный stage',async()=>{
  const p=payload('create-stage');
  for(const stage of ['production','ready','closed'])await call().post('/api/salesorders').set(auth()).send({...p,stage}).expect(400);
  expect(await db().collection('salesorders').countDocuments({orderNo:p.orderNo})).toBe(0);
 });
 it('DELETE привязанного оригинала409, PhotoID/байты/SHAсохранены',async()=>{
  await call().delete('/api/photos/'+file).set(auth()).expect(409);
  expect((await db().collection('photos').findOne({_id:new Types.ObjectId(file)}))?.deletedAt).toBeNull();
  expect(createHash('sha256').update(await readFile(join(folder,'source.pdf'))).digest('hex')).toBe(sha);
 });
 it('source не дублирует активный legacy и deleted legacy без importKey',async()=>{
  const active=payload('legacy-active');await call().post('/api/salesorders').set(auth()).send({orderNo:active.orderNo,companyId:company,productionAssignment:'unassigned'}).expect(201);
  await call().post('/api/salesorders').set(auth()).send(active).expect(409);
  const deleted=payload('legacy-deleted');await db().collection('salesorders').insertOne({orderNo:deleted.orderNo,companyId:new Types.ObjectId(company),deletedAt:new Date()});
  await call().post('/api/salesorders').set(auth()).send(deleted).expect(409);
 });
 it('source и legacy CREATE делят единый concurrency guard',async()=>{
  const p=payload('legacy-source-race');const responses=await Promise.all([call().post('/api/salesorders').set(auth()).send(p),call().post('/api/salesorders').set(auth()).send({orderNo:p.orderNo,companyId:company,productionAssignment:'unassigned'})]);
  expect(responses.map(r=>r.status).sort()).toEqual([201,409]);expect(await db().collection('salesorders').countDocuments({orderNo:p.orderNo})).toBe(1);
 });
 it('конкурентныйповторсоздаётодинзаголовок',async()=>{const p=payload('18/11/46');const r=await Promise.all([call().post('/api/salesorders').set(auth()).send(p),call().post('/api/salesorders').set(auth()).send(p)]);expect(r.map(x=>x.status)).toEqual([201,201]);expect(r[0].body.id).toBe(r[1].body.id);expect(await db().collection('salesorders').countDocuments({orderNo:p.orderNo})).toBe(1);});
 it('оригиналнеподменяетсяневернымSHAиличужимИНН',async()=>{const p=payload('wrong-sha');p.initialLegal.documents[0].sourceSha256='0'.repeat(64);await call().post('/api/salesorders').set(auth()).send(p).expect(400);const other=payload('wrong-party');other.initialLegal.counterpartySnapshot.inn='0107024068';await call().post('/api/salesorders').set(auth()).send(other).expect(400);});
 it('sourceстрокапереноситсябезавтопродукции, повторидемпотентен, другойpayload409',async()=>{
  const body={orderId:order,title:'Секция C164',qty:2,unit:'шт',unitPrice:500,clientUid:'c164-source-line',matchingMode:'manual',sourceLine:{documentUid:'doc-18/11/45',rowKey:'1',title:'Секция C164',qty:2,unit:'шт',unitPrice:500,lineAmount:1000,dimensions:'2м'}};
  const before=await db().collection('products').countDocuments({});const a=await call().post('/api/incomes').set(auth()).send(body).expect(201);line=a.body.id;expect(a.body.productId).toBeFalsy();expect(a.body.sourceLine.dimensions).toBe('2м');
  expect((await call().post('/api/incomes').set(auth()).send(body).expect(201)).body.id).toBe(line);await call().post('/api/incomes').set(auth()).send({...body,qty:3}).expect(409);expect(await db().collection('products').countDocuments({})).toBe(before);expect(await db().collection('designtasks').countDocuments({incomeId:new Types.ObjectId(line)})).toBe(0);
 });
 it('менеджер группирует два legal договора до matching; запуск производства пока запрещён',async()=>{
  const other=await db().collection('salesorders').findOne({orderNo:'18/11/46'});
  const free=await call().get('/api/production-orders/unassigned').query({limit:100}).set(auth()).expect(200);
  expect(free.body.items.find((x:any)=>x.id===order)?.canAssign).toBe(true);
  const assigned=await call().post('/api/production-orders/assign').set(auth()).send({contractIds:[order,String(other!._id)]}).expect(200);
  const after=await call().get('/api/salesorders/'+order).set(auth()).expect(200);expect(after.body.productionNo).toBe(assigned.body.productionNo);expect(after.body.lines[0].productId).toBeFalsy();
  await call().patch('/api/salesorders/'+order).set(auth()).send({stage:'production'}).expect(409);
  expect(await db().collection('designtasks').countDocuments({orderId:new Types.ObjectId(order)})).toBe(0);
 });
 it('source строка не отвязывается null orderId; обычная строка не создаёт RUB стоимость под USD договором',async()=>{
  await call().patch('/api/incomes/'+line).set(auth()).send({orderId:null}).expect(409);
  expect(String((await db().collection('incomes').findOne({_id:new Types.ObjectId(line)}))?.orderId)).toBe(order);
  const usd=await db().collection('salesorders').insertOne({orderNo:'USD-source',companyId:new Types.ObjectId(company),legal:{state:'draft',currency:'USD'},deletedAt:null});
  await call().post('/api/incomes').set(auth()).send({orderId:String(usd.insertedId),title:'Валюта',qty:1,unitPrice:100}).expect(400);
 });
 it('legalCASсохраняетредактированиеиоригинал,повторнеперезаписываетновоерешениеменеджера',async()=>{
  const get=await call().get('/api/salesorders/'+order).set(auth()).expect(200);const next={...get.body.legal,objectAddress:'Подтверждённый адрес',issues:[{uid:'address',field:'objectAddress',label:'Адрес объекта',reason:'Не указан',state:'resolved',resolution:'Уточнил менеджер'}]};
  const body={version:0,clientUid:'c164-fill-address',reason:'Ответ менеджера',legal:next};await call().patch('/api/salesorders/'+order+'/legal').set(auth()).send(body).expect(200);await call().patch('/api/salesorders/'+order+'/legal').set(auth()).send(body).expect(200);await call().patch('/api/salesorders/'+order+'/legal').set(auth()).send({...body,clientUid:'stale'}).expect(409);
  const after=await call().get('/api/salesorders/'+order).set(auth()).expect(200);expect(after.body.legal.objectAddress).toBe('Подтверждённый адрес');expect(after.body.legalVersion).toBe(1);expect(after.body.legal.documents[0].sourceSha256).toBe(sha);
 });
 it('подтверждённыйплатёжвидендажекогдаlegaldraft,ноисходящиедокументысамифактовнесоздают',async()=>{
  expect((await db().collection('incomes').findOne({_id:new Types.ObjectId(line)}))?.payments||[]).toHaveLength(0);
  await call().post('/api/incomes/'+line+'/payments').set(auth()).send({date:'2026-11-19',amount:200,clientUid:'c164-real-payment'}).expect(200);
  const result=await call().get('/api/finance/operations').query({from:'2026-11-01',to:'2026-11-30',salesOrderId:order}).set(auth()).expect(200);expect(result.body.items.some((i:any)=>i.sourceId===line&&i.amount===200)).toBe(true);
 });
});
