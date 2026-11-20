import request from 'supertest';
import { Types } from 'mongoose';
import { promises as fs } from 'fs';
import path from 'path';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin } from '../setup/admin.fixture';
import { ProductPassportService } from '../../src/modules/product-passport/product-passport.service';
import { PassportSourceService } from '../../src/modules/product-passport/passport-source.service';
import { ProductAttachmentsService } from '../../src/modules/productattachments/productattachments.service';
import { MatchingService } from '../../src/modules/matching/matching.service';
import { claimPassportLine, epochOf, passportLine } from '../../src/common/passport/line-source';
import { UPLOAD_DIR } from '../../src/modules/photos/image-upload.options';

describe('C170 выбор вложенного паспорта', () => {
  let ctx:TestContext, token:string, reader:string;
  const db=()=>ctx.connection.db!, http=()=>request(ctx.app.getHttpServer());
  const actor={id:String(new Types.ObjectId()),username:'c170',role:'admin'};
  let order:Types.ObjectId, product:Types.ObjectId, income:Types.ObjectId, file:Types.ObjectId, type:Types.ObjectId, firm:Types.ObjectId, rel:string;
  const base=()=>`/api/passports/order/${order}/lines/${income}/source`;
  const sources=()=>ctx.module.get(PassportSourceService);
  const view=()=>sources().view(String(order),String(income));
  const select=async(extra:Record<string,unknown>={})=>{const v=await view();return sources().select(String(order),String(income),{mode:'attachment',expectedRevision:v.selection.revision,contextToken:v.contextToken,attachmentId:String(file),expectedAttachmentGeneration:0,confirm:true,...extra},actor);};
  beforeAll(async()=>{
    if(process.env.MONGO_DB_TEST!=='datacore-test-c170')throw new Error('C170 требует отдельный namespace datacore-test-c170');
    ctx=await createTestApp({strictValidation:true}); token=(await loginAsAdmin(ctx.app)).access;
    await http().post('/api/admin/users').set(authHeader(token)).send({username:'c170-reader',password:'c170-reader-password',role:'user'}).expect(201);
    reader=(await http().post('/api/auth/login').send({username:'c170-reader',password:'c170-reader-password'}).expect(200)).body.access;
    type=new Types.ObjectId();firm=new Types.ObjectId();
    await db().collection('organizations').insertOne({_id:firm,name:'Наша C170',isOurCompany:true,deletedAt:null});
    await db().collection('dict_values').insertOne({_id:type,dict:'attachmentTypes',name:'Любой вид',deletedAt:null});
    await db().collection('productpassports').createIndex({creationScopeKey:1},{unique:true,sparse:true});
  });
  beforeEach(async()=>{
    order=new Types.ObjectId();product=new Types.ObjectId();income=new Types.ObjectId();file=new Types.ObjectId();
    rel=`attachments/${product}/${type}/c170-${file}.pdf`;
    await fs.mkdir(path.dirname(path.resolve(UPLOAD_DIR,rel)),{recursive:true});await fs.writeFile(path.resolve(UPLOAD_DIR,rel),'%PDF-1.4 c170');
    await db().collection('products').insertOne({_id:product,name:'Изделие C170',deletedAt:null});
    await db().collection('salesorders').insertOne({_id:order,orderNo:String(order),companyId:firm,customer:'C170',deletedAt:null});
    await db().collection('incomes').insertOne({_id:income,orderId:order,productId:product,title:'Позиция C170',qty:1,deletedAt:null,payments:[{amount:42,date:new Date()}],sourceLine:{rowKey:'keep'}});
    await db().collection('productattachments').insertOne({_id:file,productId:product,typeId:type,originalName:'сотрудник-выбрал.pdf',storedPath:rel,size:14,ext:'pdf',mime:'application/pdf',deletedAt:null});
  });
  afterEach(async()=>{if(rel)await fs.rm(path.resolve(UPLOAD_DIR,rel),{force:true});});
  afterAll(async()=>{await ctx?.cleanup();});
  it('READ: план/source/candidates доступны, metadata безопасны, PUT и issue403',async()=>{
    const v=(await http().get(base()).set(authHeader(reader)).expect(200)).body;
    expect(v.selection).toEqual({mode:'site',revision:0});
    await http().get(`/api/passports/order/${order}/plan`).set(authHeader(reader)).expect(200);
    const c=(await http().get(base()+'/candidates?page=1&limit=1').set(authHeader(reader)).expect(200)).body;
    expect(c).toMatchObject({total:1,page:1,limit:1});expect(c.items[0]).toMatchObject({selectionGeneration:0,available:true});
    for(const key of ['storedPath','payments','sourceLine','amount']) expect(JSON.stringify({v,c})).not.toContain(key);
    await http().put(base()).set(authHeader(reader)).send({mode:'site',expectedRevision:0,contextToken:v.contextToken}).expect(403);
    await http().post(`/api/passports/order/${order}/issue`).set(authHeader(reader)).send({}).expect(403);
  });
  it('выбор без номера/потери финансов; счётчики и скачивание READ',async()=>{
    const before=await db().collection('incomes').findOne({_id:income});const v=await select();
    expect(v).toMatchObject({effectiveState:'attached',selection:{mode:'attachment',revision:1},passportEpoch:1,missing:[]});
    const plan=await ctx.module.get(ProductPassportService).orderPlan(String(order));expect(plan).toMatchObject({total:1,attached:1,completed:1,issued:0,ready:0,blocked:0});
    const after=await db().collection('incomes').findOne({_id:income});expect(after!.payments).toEqual(before!.payments);expect(after!.sourceLine).toEqual(before!.sourceLine);expect(after!.version).toBeUndefined();
    expect(await db().collection('productpassports').countDocuments({incomeId:income})).toBe(0);
    const ticket=(await http().post(base()+'/download-ticket').set(authHeader(reader)).send({contextToken:v.contextToken}).expect(200)).body;
    await http().get(ticket.url).expect(200);
  });
  it('два PUT от одного baseline: ровно один commit/аудит, проигравший409',async()=>{
    const v=await view();const dto={mode:'attachment' as const,expectedRevision:0,contextToken:v.contextToken,attachmentId:String(file),expectedAttachmentGeneration:0,confirm:true};
    const r=await Promise.allSettled([sources().select(String(order),String(income),dto,actor),sources().select(String(order),String(income),dto,actor)]);
    expect(r.filter(r=>r.status==='fulfilled')).toHaveLength(1);const bad=r.find(r=>r.status==='rejected') as PromiseRejectedResult;expect(bad.reason.status).toBe(409);
    expect(await db().collection('auditlogs').countDocuments({entityId:income,action:'passport.selection.changed'})).toBe(1);
  });
  it('строгий DTO и явное подтверждение, чужой файл/позиция не раскрываются',async()=>{
    const v=await view();await http().put(base()).set(authHeader(token)).send({mode:'attachment',expectedRevision:0,contextToken:v.contextToken,attachmentId:String(file),confirm:false,expectedAttachmentGeneration:0}).expect(400);
    await http().put(base()).set(authHeader(token)).send({mode:'site',expectedRevision:0,contextToken:v.contextToken,sourceLine:{}}).expect(400);
    await db().collection('productattachments').updateOne({_id:file},{$set:{productId:new Types.ObjectId()}});await expect(select()).rejects.toMatchObject({status:409,response:{code:'ATTACHMENT_UNAVAILABLE'}});
    await http().get(`/api/passports/order/${new Types.ObjectId()}/lines/${income}/source`).set(authHeader(token)).expect(404);
  });
  it('delete→restore меняет generation, старое подтверждение блокировано до явного PUT',async()=>{
    await select();const files=ctx.module.get(ProductAttachmentsService);await files.remove(String(product),String(file),actor);expect((await view()).effectiveState).toBe('blocked');
    await files.restore(String(product),String(file));let v=await view();expect(v).toMatchObject({effectiveState:'blocked',attachment:{available:false,unavailableReason:'ATTACHMENT_DELETED'}});
    await expect(select()).rejects.toMatchObject({status:409});v=await select({expectedAttachmentGeneration:2});expect(v.effectiveState).toBe('attached');
  });
  it('missing file блокирует план/ticket, восстановление того же файла возвращает availability',async()=>{
    const v=await select();await fs.rm(path.resolve(UPLOAD_DIR,rel));expect((await view()).effectiveState).toBe('blocked');
    await http().post(base()+'/download-ticket').set(authHeader(token)).send({contextToken:v.contextToken}).expect(409);
    await fs.writeFile(path.resolve(UPLOAD_DIR,rel),'%PDF-restored');expect((await view()).effectiveState).toBe('attached');
  });
  it('A→B→A через matching не возрождает выбор; исходные финансовые поля целы',async()=>{
    await select();const b=new Types.ObjectId();await db().collection('products').insertOne({_id:b,name:'B',deletedAt:null});const m=ctx.module.get(MatchingService);
    await m.confirm(String(income),String(b),actor.id);await m.confirm(String(income),String(product),actor.id);
    const v=await view();expect(v).toMatchObject({effectiveState:'blocked',selection:{mode:'attachment',invalidReason:'PRODUCT_CHANGED',revision:3},passportEpoch:3});
    expect((await db().collection('incomes').findOne({_id:income}))!.sourceLine).toEqual({rowKey:'keep'});
  });
  it('отмена/site не выпускает автоматически; revision монотонна',async()=>{
    const v=await select();const r=await sources().select(String(order),String(income),{mode:'site',expectedRevision:1,contextToken:v.contextToken},actor);
    expect(r.selection).toEqual(expect.objectContaining({mode:'site',revision:2}));expect(r.selection.attachmentId).toBeUndefined();expect(await db().collection('productpassports').countDocuments({incomeId:income})).toBe(0);
  });
  it('guards create legacy-number/createReady запрещают attachment без нового номера',async()=>{
    await select();const p=ctx.module.get(ProductPassportService);await expect(p.create({incomeId:String(income),productId:String(product),passportNumber:'99170'} as never)).rejects.toMatchObject({status:409,response:{code:'SOURCE_ATTACHMENT'}});
    await expect(p.createReady({incomeId:String(income),productId:String(product),supplierOrgId:String(firm)} as never,{mimetype:'application/pdf',buffer:Buffer.from('%PDF-1.4 test')})).rejects.toMatchObject({status:409,response:{code:'SOURCE_ATTACHMENT'}});
    expect(await db().collection('productpassports').countDocuments({incomeId:income})).toBe(0);
  });
  it('issued история идемпотентна; current-order PDF исключает даже explicit IDs',async()=>{
    const pid=new Types.ObjectId();await db().collection('productpassports').insertOne({_id:pid,incomeId:income,productId:product,salesOrderId:order,passportNumber:'170',status:'issued',textSnapshot:{keep:'история'},deletedAt:null});
    const before=await db().collection('productpassports').findOne({_id:pid});await select();const p=ctx.module.get(ProductPassportService);const v=await view();expect(v).toMatchObject({effectiveState:'attached',sitePassports:[{id:String(pid),number:'170',status:'issued'}]});
    expect(String((await p.issue(String(pid)))._id)).toBe(String(pid));expect(await db().collection('productpassports').findOne({_id:pid})).toEqual(before);
    const batch=await p.orderIssue(String(order));expect(batch.issued).toEqual([]);expect(batch.skipped[0].reason).toContain('SOURCE_ATTACHMENT');
    expect(await p.issuedOfOrder(String(order))).toMatchObject({items:[],skipped:[{_id:pid}]});
    const pdf=await http().get(`/api/passports/order/${order}/pdf?ids=${pid}`).set(authHeader(token)).expect(400);expect(JSON.stringify(pdf.body)).toContain('SOURCE_ATTACHMENT');
  });
  it('baseline выбран до callback retry: источник и номер не могут оба пройти',async()=>{
    const baseline=await passportLine(db(),income), session=await ctx.connection.startSession();const v=await view();
    await sources().select(String(order),String(income),{mode:'attachment',expectedRevision:0,contextToken:v.contextToken,attachmentId:String(file),expectedAttachmentGeneration:0,confirm:true},actor);
    try {await expect(session.withTransaction(()=>claimPassportLine(db(),session,baseline,epochOf(baseline),'site'))).rejects.toMatchObject({status:409,response:{code:'STALE_CONTEXT'}});}finally{await session.endSession();}
    expect(await db().collection('productpassports').countDocuments({incomeId:income})).toBe(0);
  });
  it('purgeCAS захватывает удалённый файл и restore больше не проходит',async()=>{
    await select();const files=ctx.module.get(ProductAttachmentsService);await files.remove(String(product),String(file),actor);
    await db().collection('productattachments').updateOne({_id:file},{$set:{deletedAt:new Date('2000-01-01')}});expect(await files.purgeDeleted()).toBeGreaterThanOrEqual(1);
    await expect(files.restore(String(product),String(file))).rejects.toMatchObject({status:400});const f=await db().collection('productattachments').findOne({_id:file});expect(f!.purgeState).toBe('removed');expect(f!.fileRemovedAt).toBeTruthy();
  });
});
