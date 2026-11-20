import request from 'supertest';
import { Types, mongo, type ClientSession } from 'mongoose';
import { PassportIssue, type IssueHost } from '../../src/modules/product-passport/passport-issue';
import { ProductPassport, type ProductPassportDocument } from '../../src/modules/product-passport/product-passport.schema';
import { PURGE_LEASE_MS } from '../../src/modules/productattachments/productattachments.service';
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
import { unlinkPrint } from '../../src/modules/product-passport/passport-print-file';

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
  const abortFirstCommit = () => {
    const start = ctx.connection.startSession.bind(ctx.connection);
    let commits = 0;
    const spy = jest.spyOn(ctx.connection, 'startSession').mockImplementationOnce(async () => {
      const session = await start();
      const commit = session.commitTransaction.bind(session);
      session.commitTransaction = async () => {
        commits++;
        if (commits === 1) {
          await session.abortTransaction();
          throw new mongo.MongoServerError({message:'C170 fault после save до commit',code:112,errorLabels:['TransientTransactionError']});
        }
        return commit();
      };
      return session;
    });
    return { spy, commits: () => commits };
  };
  it.each(['missing','deleted'])('P1: %s изделие блокирует выбор и уже выбранный effective, без fallback',async state=>{
    const v=await view();
    if(state==='missing')await db().collection('products').deleteOne({_id:product});else await db().collection('products').updateOne({_id:product},{$set:{deletedAt:new Date()}});
    await expect(sources().select(String(order),String(income),{mode:'attachment',expectedRevision:0,contextToken:v.contextToken,attachmentId:String(file),expectedAttachmentGeneration:0,confirm:true},actor)).rejects.toMatchObject({status:409});
    await db().collection('incomes').updateOne({_id:income},{$set:{passportSelection:{mode:'attachment',revision:1,attachmentId:file,attachmentGeneration:0,productIdAtSelection:product}}});
    const plan=await ctx.module.get(ProductPassportService).orderPlan(String(order));expect(plan).toMatchObject({attached:0,completed:0,blocked:1});expect(plan.lines[0]).toMatchObject({source:'attachment',state:'blocked',attachment:{available:false,unavailableReason:'PRODUCT_UNAVAILABLE'}});
    expect((await view()).missing[0]).toContain('Изделие не найдено');
  });
  it('P1 retry: новый presentation draft сохраняется ровно один раз после save→abort',async()=>{
    const fault=abortFirstCommit();
    try {
      const p=ctx.module.get(ProductPassportService);const d=await p.create({incomeId:String(income),productId:String(product),salesOrderId:String(order),supplierOrgId:String(firm),presentationVersion:1});
      expect(fault.commits()).toBe(2);expect(await db().collection('productpassports').countDocuments({incomeId:income})).toBe(1);
      const saved=await db().collection('productpassports').findOne({_id:d._id});expect(saved).toMatchObject({status:'draft',presentationVersion:1});expect((await db().collection('incomes').findOne({_id:income}))!.passportEpoch).toBe(1);
    }finally{fault.spy.mockRestore();}
  });
  it('FIX2 explicit unset: legacy incomeId:null освобождает unique scope после abort/retry',async()=>{
    const p=ctx.module.get(ProductPassportService);const old=await p.create({incomeId:String(income),productId:String(product)});
    expect((await db().collection('productpassports').findOne({_id:old._id}))!.creationScopeKey).toBe('line/'+income);
    const fault=abortFirstCommit();
    try{
      await p.update(String(old._id),{incomeId:null} as never);expect(fault.commits()).toBe(2);
      const detached=await db().collection('productpassports').findOne({_id:old._id});expect(detached!.incomeId).toBeNull();expect(detached).not.toHaveProperty('creationScopeKey');
      const fresh=await p.create({incomeId:String(income),productId:String(product)});expect(String(fresh._id)).not.toBe(String(old._id));
      const bound=await db().collection('productpassports').find({creationScopeKey:'line/'+income}).toArray();expect(bound).toHaveLength(1);expect(String(bound[0]._id)).toBe(String(fresh._id));expect(await db().collection('productpassports').countDocuments({_id:old._id})).toBe(1);
    }finally{fault.spy.mockRestore();}
  });
  it('P1 retry: правка issued сохраняет изменение и одну редакцию после save→abort',async()=>{
    const pid=new Types.ObjectId();await db().collection('productpassports').insertOne({_id:pid,incomeId:income,productId:product,salesOrderId:order,name:'До',passportNumber:'retry-'+pid,status:'issued',revision:1,deletedAt:null});
    const fault=abortFirstCommit();
    try {
      await ctx.module.get(ProductPassportService).update(String(pid),{name:'После transient abort'},{user:actor});
      expect(fault.commits()).toBe(2);const saved=await db().collection('productpassports').findOne({_id:pid});expect(saved).toMatchObject({name:'После transient abort',revision:2});expect(saved!.revisions).toHaveLength(1);expect(saved!.revisions[0].data.name).toBe('До');
      expect((await db().collection('incomes').findOne({_id:income}))!.passportEpoch).toBe(1);
    }finally{fault.spy.mockRestore();}
  });
  it('P1 retry: legacy numbered create заново выделяет счётчик после abort',async()=>{
    const before=await db().collection('counters').findOne({entity:'passport',prefix:'productCode',year:0});const max=await db().collection('productpassports').find({productCode:{$exists:true}}).toArray();const floor=Math.max(Number(before?.seq??0),...max.map(p=>Number(p.productCode)||0),0);
    const fault=abortFirstCommit();try{
      const d=await ctx.module.get(ProductPassportService).create({incomeId:String(income),passportNumber:String(800000+parseInt(String(income).slice(-4),16)),productId:String(product)});
      expect(fault.commits()).toBe(2);expect(await db().collection('productpassports').countDocuments({incomeId:income,status:'issued'})).toBe(1);
      const counter=await db().collection('counters').findOne({entity:'passport',prefix:'productCode',year:0});expect(Number(counter!.seq)).toBe(floor+1);expect(Number(d.productCode)).toBe(floor+1);
    }finally{fault.spy.mockRestore();}
  });
  it('P1 retry ready-file: один issued, номер/счётчики и один сохранённый файл после abort',async()=>{
    const fault=abortFirstCommit();let stored:string|undefined;
    try{
      const d=await ctx.module.get(ProductPassportService).createReady({incomeId:String(income),productId:String(product),supplierOrgId:String(firm)} as never,{mimetype:'application/pdf',buffer:Buffer.from('%PDF-1.4 ready fixture'),originalname:'c170-fault.pdf'});
      expect(fault.commits()).toBe(2);const rows=await db().collection('productpassports').find({incomeId:income}).toArray();expect(rows).toHaveLength(1);const raw=rows[0];stored=raw.printFile.path;
      expect(raw).toMatchObject({status:'issued',source:'ready-file'});expect(d).toMatchObject({passportNumber:raw.passportNumber});expect((await db().collection('counters').findOne({entity:'passport',prefix:'passportNumber',year:0}))!.seq).toBe(Number(raw.passportNumber));
      expect((await db().collection('counters').findOne({entity:'passport',prefix:'productCode',year:0}))!.seq).toBe(Number(raw.productCode));expect((await db().collection('incomes').findOne({_id:income}))!.passportEpoch).toBe(1);
    }finally{fault.spy.mockRestore();if(stored)await unlinkPrint(stored);}
  });
  it.each(['rebind','standalone','selection'])('P1 real interleaving %s → issue409 без номера/issued',async mode=>{
    const pid=new Types.ObjectId(), target=new Types.ObjectId();
    await db().collection('incomes').insertOne({_id:target,orderId:order,productId:product,title:'B',deletedAt:null});
    await db().collection('productpassports').insertOne({_id:pid,...(mode==='standalone'?{}:{incomeId:income}),productId:product,salesOrderId:order,name:'Draft',status:'draft',passportNumber:'draft-'+pid,deletedAt:null});
    const model=ctx.connection.model<ProductPassportDocument>(ProductPassport.name), p=ctx.module.get(ProductPassportService);
    let resume!:()=>void, paused!:()=>void;const gate=new Promise<void>(resolve=>resume=resolve), reached=new Promise<void>(resolve=>paused=resolve);
    const host:IssueHost={model:model as never,connection:ctx.connection,findById:async id=>(await model.findById(id).exec())!,readiness:async()=>[],refresh:async()=>undefined,freezeImages:async()=>{paused();await gate;},allocate:(set,date,session)=>p.allocate(set,date,session),assertFree:async()=>undefined};
    const before=await db().collection('counters').find({}).sort({_id:1}).toArray();
    const issuing=new PassportIssue(host).issue(String(pid));const outcome=issuing.then(()=>null,e=>e);await reached;
    if(mode!=='selection')await p.update(String(pid),{incomeId:String(target)});
    const targetId=mode==='selection'?income:target;const v=await sources().view(String(order),String(targetId));
    await sources().select(String(order),String(targetId),{mode:'attachment',expectedRevision:v.selection.revision,contextToken:v.contextToken,attachmentId:String(file),expectedAttachmentGeneration:0,confirm:true},actor);
    resume();expect(await outcome).toMatchObject({status:409,response:{code:'STALE_CONTEXT'}});const saved=await db().collection('productpassports').findOne({_id:pid});expect(saved).toMatchObject({status:'draft',passportNumber:'draft-'+pid});expect(saved!.issuedAt).toBeUndefined();
    expect(await db().collection('counters').find({}).sort({_id:1}).toArray()).toEqual(before);
  });
  it.each(['unlink','confirm'])('P2 purge %s failure: lease reconcile завершает removed, restore запрещён',async failure=>{
    const files=ctx.module.get(ProductAttachmentsService);await files.remove(String(product),String(file),actor);await db().collection('productattachments').updateOne({_id:file},{$set:{deletedAt:new Date('2000-01-01')}});
    const now=new Date();let restore:()=>void;
    if(failure==='unlink'){
      const original=fs.rm.bind(fs);const spy=jest.spyOn(fs,'rm').mockImplementationOnce(async()=>{throw Object.assign(new Error('C170 unlink fault'),{code:'EACCES'});});restore=()=>{spy.mockRestore();void original;};
    }else{
      const coll=ctx.connection.model('ProductAttachment').collection, original=coll.updateOne.bind(coll);
      // Mongoose использует ту же native collection; ошибка только DB-подтверждения после реального unlink.
      const spy=jest.spyOn(coll,'updateOne').mockImplementation(((filter:unknown,update:{ $set?:{fileRemovedAt?:Date}},opts:unknown)=>{if(update.$set?.fileRemovedAt)return Promise.reject(new Error('C170 confirmation fault'));return original(filter as never,update as never,opts as never);}) as never);restore=()=>spy.mockRestore();
    }
    try{expect(await files.purgeDeleted(now)).toBe(0);}finally{restore();}
    const pending=await db().collection('productattachments').findOne({_id:file});expect(pending).toMatchObject({purgeState:'purging'});expect(pending!.purgeLeaseUntil).toBeTruthy();
    await expect(files.restore(String(product),String(file))).rejects.toMatchObject({status:404});expect(await files.purgeDeleted(new Date(now.getTime()+PURGE_LEASE_MS+1))).toBeGreaterThanOrEqual(1);
    const done=await db().collection('productattachments').findOne({_id:file});expect(done).toMatchObject({purgeState:'removed'});expect(done!.purgeToken).toBeUndefined();expect(done!.fileRemovedAt).toBeTruthy();await expect(fs.stat(path.resolve(UPLOAD_DIR,rel))).rejects.toMatchObject({code:'ENOENT'});
  });

});
