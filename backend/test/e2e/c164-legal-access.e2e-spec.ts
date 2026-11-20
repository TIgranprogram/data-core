import request from 'supertest';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { createHash } from 'crypto';
import { Types } from 'mongoose';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';

/** QA C164: новый source-поток, денежная маска и последующая ручная группировка. */
describe('C164 — доступ и ручная группировка юридических черновиков', () => {
 let ctx: TestContext | undefined, admin: AuthTokens, user = '', company = '', buyer = '', file = '', folder = '', oldUpload: string | undefined;
 const ids: string[] = [], lines: string[] = [];
 const db = () => ctx!.connection.db!;
 const http = () => request(ctx!.app.getHttpServer());
 const auth = () => authHeader(admin.access);
 const pdf = Buffer.from('%PDF-1.4\nC164 QA private source\n%%EOF');
 const sha = createHash('sha256').update(pdf).digest('hex');
 const legal = (n: string, kind = 'contract') => ({ state:'draft', sourceNumber:n, sourceDate:'2026-11-18', currency:'RUB', gross:1000,
  vatMode:'included', vatRate:22, vatAmount:180.33, companySnapshot:{name:'Продавец QA',inn:'2312308098'},counterpartySnapshot:{name:'Покупатель QA',inn:'0107020521'},
  signature:{state:'unknown'},paymentVerification:'unknown',documents:[{uid:'doc-'+n,kind,revision:'1',date:'2026-11-18',fileId:file,sourceSha256:sha}],
  issues:[{uid:'address',field:'objectAddress',label:'Адрес объекта',reason:'Нужно уточнить',state:'unknown'}],paymentPlan:[],deliveryTerms:'C164_PRIVATE_SOURCE',origin:{kind:'source_import'} });
 beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(),'c164-access-')); oldUpload=process.env.UPLOAD_DIR;process.env.UPLOAD_DIR=folder;
  await writeFile(join(folder,'qa-source.pdf'),pdf);
  ctx=await createTestApp(); admin=await loginAsAdmin(ctx.app);
  for (const name of ['SalesOrder','Income','CommercialOffer']) await ctx.connection.models[name].createIndexes();
  const orgs=await db().collection('organizations').insertMany([{name:'Продавец QA',inn:'2312308098',isOurCompany:true,deletedAt:null},{name:'Покупатель QA',inn:'0107020521',deletedAt:null}]);
  company=String(orgs.insertedIds[0]);buyer=String(orgs.insertedIds[1]);
  file=String((await db().collection('photos').insertOne({storageUrl:'/uploads/qa-source.pdf',originalFilename:'Исходный договор.pdf',variant:'original',mimeType:'application/pdf',sizeBytes:pdf.length,deletedAt:null})).insertedId);
  const username='c164-observer-'+Date.now();
  await http().post('/api/admin/users').set(auth()).send({username,password:'role-pass-123',role:'user'}).expect(201);
  user=(await http().post('/api/auth/login').send({username,password:'role-pass-123'}).expect(200)).body.access;
  for (const n of ['QA-C164-A','QA-C164-B']) {
   const r=await http().post('/api/salesorders').set(auth()).send({orderNo:n,companyId:company,counterpartyId:buyer,customer:'Покупатель QA',productionAssignment:'unassigned',intakeUid:'header-'+n,initialLegal:legal(n)}).expect(201);
   ids.push(r.body.id);expect(r.body.productionNo).toBeFalsy();
   const l=await http().post('/api/incomes').set(auth()).send({orderId:r.body.id,title:'Доставка '+n,qty:1,unit:'шт',unitPrice:1000,matchingMode:'manual',clientUid:'line-'+n,sourceLine:{documentUid:'doc-'+n,rowKey:'1',title:'Доставка '+n,qty:1,unit:'шт',unitPrice:1000,lineAmount:1000}}).expect(201);
   lines.push(l.body.id);
  }
 });
 afterAll(async () => {await ctx?.cleanup(); if(oldUpload===undefined)delete process.env.UPLOAD_DIR;else process.env.UPLOAD_DIR=oldUpload;if(folder.startsWith(join(tmpdir(),'c164-access-')))await rm(folder,{recursive:true,force:true});});
 it('наблюдателю недоступны legal/source/history/PDF, source POST не превращается в обычное создание',async()=>{
  const a=authHeader(user), before=await db().collection('salesorders').countDocuments({});
  const view=(await http().get('/api/salesorders/'+ids[0]).set(a).expect(200)).body;
  const visible=JSON.stringify(view);
  for (const marker of ['C164_PRIVATE_SOURCE',sha,file,'sourceLine','legalHistory','legalReceipts']) expect(visible).not.toContain(marker);
  await http().post('/api/salesorders').set(a).send({orderNo:'SHOULD-NOT-EXIST',companyId:company,initialLegal:legal('forbidden'),productionAssignment:'unassigned'}).expect(403);
  expect(await db().collection('salesorders').countDocuments({})).toBe(before);
  const o=(await http().post('/api/offers').set(auth()).send({companyId:company,counterpartyId:buyer,customer:'Покупатель QA',date:'2026-11-18',intakeUid:'qa-observer-offer',initialLegal:legal('QA-OFFER','offer'),items:[{productName:'Доставка QA',quantity:1,unitPrice:1000,sourceRowKey:'1',sourceLine:{documentUid:'doc-QA-OFFER',rowKey:'1',title:'Доставка QA',qty:1,unitPrice:1000,lineAmount:1000},matchStatus:'unmatched',scopeState:'excluded',exclusionReason:'C164_PRIVATE_EXCLUSION',exclusionConfirmedAt:'2026-11-20',exclusionEventDate:null}]}).expect(201)).body;
  await http().patch('/api/offers/'+o.id).set(auth()).send({version:0,notes:'Уточнил менеджер',reason:'C164_PRIVATE_VERSION'}).expect(200);
  const offerView=(await http().get('/api/offers/'+o.id).set(a).expect(200)).body;
  expect(JSON.stringify(offerView)).not.toContain('C164_PRIVATE_SOURCE');expect(JSON.stringify(offerView)).not.toContain(file);
  expect(offerView).not.toHaveProperty('agreedTotal');expect(offerView).not.toHaveProperty('versions');
  expect(JSON.stringify(offerView)).not.toContain('C164_PRIVATE_EXCLUSION');expect(JSON.stringify(offerView)).not.toContain('C164_PRIVATE_VERSION');
  await http().get('/api/offers/'+o.id+'/pdf').set(a).expect(403);
 });
 it('два договора после ручного сопоставления попадают в один заказ без смены исходников и новых заданий',async()=>{
  const before=await db().collection('incomes').find({_id:{$in:lines.map(x=>new Types.ObjectId(x))}}).toArray();
  const tasks=await db().collection('designtasks').countDocuments({});
  await http().post('/api/production-orders/assign').set(auth()).send({contractIds:ids}).expect(400);
  for(const lineId of lines) await http().post('/api/matching/none').set(auth()).send({lineId}).expect(200);
  const assigned=await http().post('/api/production-orders/assign').set(auth()).send({contractIds:ids}).expect(200);
  expect(assigned.body.productionNo).toBeTruthy();expect(new Set(assigned.body.orderIds)).toEqual(new Set(ids));
  for(let i=0;i<ids.length;i++) {
   const head=(await http().get('/api/salesorders/'+ids[i]).set(auth()).expect(200)).body;
   expect(head.id).toBe(ids[i]);expect(head.productionNo).toBe(assigned.body.productionNo);expect(head.legal.documents[0].sourceSha256).toBe(sha);
   const after=await db().collection('incomes').findOne({_id:new Types.ObjectId(lines[i])});
   expect(after?.sourceLine).toEqual(before.find(x=>String(x._id)===lines[i])?.sourceLine);
  }
  expect(await db().collection('designtasks').countDocuments({})).toBe(tasks);
  expect(await db().collection('incomes').countDocuments({orderId:{$in:ids.map(x=>new Types.ObjectId(x))}})).toBe(2);
 });
 it('фильтр производственного заказа сохраняет настоящий платёж при юридическом draft и не создаёт второй факт',async()=>{
  await http().post('/api/incomes/'+lines[0]+'/payments').set(auth()).send({date:'2026-11-19',amount:200,clientUid:'qa-c164-paid'}).expect(200);
  const head=(await http().get('/api/salesorders/'+ids[0]).set(auth()).expect(200)).body;
  const ops=(await http().get('/api/finance/operations').set(auth()).query({from:'2026-11-01',to:'2026-11-30',productionNo:head.productionNo}).expect(200)).body;
  expect(ops.items.filter((x:any)=>x.sourceId===lines[0]&&x.amount===200)).toHaveLength(1);
  expect(ops.items.filter((x:any)=>x.sourceId===lines[1])).toHaveLength(0);
 });
});
