import { archiveOrderConflict } from '../order-archive/write';
import { BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'crypto';
import { readFile, stat } from 'fs/promises';
import { type ClientSession, Connection, Model, Types } from 'mongoose';
import { safeUploadPath } from '../uploads/safe-path';
import { LegalBundleDto, LegalPatchDto } from './legal.dto';
type Row=Record<string,any>;
/** Стабильный hash не зависит от порядка ключей JSON. Только переданные значения. */
export function legalHash(value:unknown):string {
 const stable=(v:any):any=>v===undefined?null:v instanceof Date?v.toISOString():v&&v._bsontype?String(v):Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>[k,stable(v[k])])):v;
 return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}
export function intakeBusinessKey(legal:LegalBundleDto,kind:string):string {
 const primary=legal.documents.find(d=>d.kind===kind);
 if(!legal.sourceDate||!legal.companySnapshot?.inn||!legal.counterpartySnapshot?.inn||!primary)throw new BadRequestException('Для импорта нужны дата, ИНН сторон и основной оригинал');
 return legalHash([legal.companySnapshot.inn,legal.counterpartySnapshot.inn,kind,String(legal.sourceNumber||'').normalize('NFKC').trim().toUpperCase(),legal.sourceDate,primary.revision,...(!legal.sourceNumber?[primary.sourceSha256]:[])]);
}
export function assertIntakeReplay(existing:Row,hash:string){if(existing.deletedAt||existing.intakeHash!==hash)throw new ConflictException('Источник уже существует или изменён — откройте карточку для сверки');}
export function legalSummary(legal?:LegalBundleDto,unmatchedCount=0){return legal?{state:legal.state,openIssueCount:(legal.issues||[]).filter(x=>['unknown','conflict'].includes(x.state)).length,unmatchedCount,documentCount:(legal.documents||[]).length}:undefined;}
export function legalPresentation(record:Row):Row{const n=Number(record.unassignedCount||0);return {...record,id:String(record._id||record.id),legalSummary:legalSummary(record.legal,n),readiness:{openIssueCount:legalSummary(record.legal,n)?.openIssueCount||0,unmatchedCount:n,productionAssigned:!!record.productionNo}};}
const dateOK=(v:unknown)=>!v||(typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v);
export function prepareLegal(next:LegalBundleDto,previous?:LegalBundleDto,actorId?:string,context?:{counterpartyId?:unknown;productionNo?:unknown;unmatchedCount?:number;lineCount?:number}):LegalBundleDto {
 const out=JSON.parse(JSON.stringify(next)) as LegalBundleDto;
 if(!Array.isArray(out.documents)||!Array.isArray(out.issues)||!Array.isArray(out.paymentPlan)||!out.signature)throw new BadRequestException('Заполните комплект документов, уточнения, план и состояние подписи');
 if (!previous && out.documents.some(document => document.kind === 'customer_order')) {
  throw new BadRequestException('Сначала сохраните договор с оригиналом, затем приложите заказ покупателя');
 }
 out.documents=out.documents.map(d=>({...d,lineRefs:d.lineRefs||[]}));
 if(previous){for(const key of ['sourceNumber','sourceDate','currency','gross','vatMode','vatRate','vatAmount','companySnapshot','counterpartySnapshot'] as const)if(previous[key]!==undefined&&legalHash(previous[key])!==legalHash(out[key]))throw new ConflictException('Исходные реквизиты неизменяемы: добавьте новую редакцию документа');}
 for(const a of [out.documents,out.issues,out.paymentPlan])if(!Array.isArray(a)||new Set(a.map(x=>x.uid)).size!==a.length)throw new BadRequestException('Идентификаторы документов, этапов и уточнений должны быть уникальны');
 for(const d of [out.sourceDate,out.signature?.signedDate,...out.documents.map(x=>x.date),...out.paymentPlan.flatMap(x=>[x.dueDate,x.eventDate])])if(!dateOK(d))throw new BadRequestException('Проверьте календарную дату источника');
 const old=new Map((previous?.documents||[]).map(x=>[x.uid,x]));
 for(const [uid,doc]of old){const fresh=out.documents.find(x=>x.uid===uid);if(!fresh)throw new ConflictException('Оригинал нельзя удалять из истории');const clean=(v:any)=>Object.fromEntries(Object.entries(v).filter(([k])=>!['at','by','_id'].includes(k)));if(legalHash(clean(fresh))!==legalHash(clean(doc)))throw new ConflictException('Оригинал неизменяем: добавьте новую редакцию');}
 const now=new Date();
 out.documents=out.documents.map(d=>({...d,...(old.has(d.uid)?{at:(old.get(d.uid)as any).at,by:(old.get(d.uid)as any).by}:{at:now,by:actorId})})) as any;
 const docIds=new Set(out.documents.map(x=>x.uid));
 const prior=new Set<string>();for(const d of out.documents){if(d.supersedesUid&&!prior.has(d.supersedesUid))throw new BadRequestException('Новая редакция должна ссылаться на предыдущий оригинал');prior.add(d.uid);}
 for(const x of [...out.paymentPlan,out.signature])if(x.evidenceDocumentUid&&!docIds.has(x.evidenceDocumentUid))throw new BadRequestException('Подтверждающий документ отсутствует в комплекте');
 for(const i of out.issues){if(i.documentUid&&!docIds.has(i.documentUid))throw new BadRequestException('Источник уточнения отсутствует');if(['resolved','not_applicable'].includes(i.state)&&!i.resolution?.trim())throw new BadRequestException('Укажите результат уточнения');if(i.state==='resolved'&&i.field==='objectAddress'&&!out.objectAddress?.trim())throw new BadRequestException('Заполните адрес или отметьте, что он не применяется');if(i.state==='resolved'){
 const ready:Record<string,boolean>={objectAddress:!!out.objectAddress?.trim(),signedDate:!!out.signature.signedDate,signature:out.signature.state!=='unknown',payment:out.paymentVerification==='confirmed',paymentVerification:out.paymentVerification==='confirmed',deliveryTerms:!!out.deliveryTerms?.trim(),deadlineTerms:!!out.deadlineTerms?.trim(),paymentPlan:out.paymentPlan.length>0,counterparty:!!out.counterpartySnapshot?.inn&&!!context?.counterpartyId,productionOrder:!!context?.productionNo,productionAssignment:!!context?.productionNo,catalogMatch:!!context?.lineCount&&context.unmatchedCount===0,productMatching:!!context?.lineCount&&context.unmatchedCount===0,drawing:!!i.documentUid&&out.documents.some(d=>d.uid===i.documentUid&&['specification','addendum'].includes(d.kind)),other:!!i.resolution?.trim()};
 if(!ready[i.field])throw new BadRequestException('Сначала заполните поле уточнения или отметьте, что оно не применяется');
 }
 const oldIssue=previous?.issues.find(x=>x.uid===i.uid) as any;if(['resolved','not_applicable'].includes(i.state))Object.assign(i,{resolvedAt:oldIssue?.state===i.state?oldIssue.resolvedAt:now,resolvedBy:oldIssue?.state===i.state?oldIssue.resolvedBy:actorId});}
 if(out.state==='verified'&&out.issues.some(x=>['unknown','conflict'].includes(x.state)))throw new BadRequestException('Сначала разрешите отмеченные уточнения');
 if(out.vatAmount!==undefined&&out.gross!==undefined&&out.vatMode==='included'&&out.vatAmount>out.gross)throw new BadRequestException('НДС не может превышать итог документа');
 const cents=(v:number)=>Math.round(v*100);
 if(out.gross!==undefined&&out.paymentPlan.length&&out.paymentPlan.every(x=>x.amount!==undefined)){const total=out.paymentPlan.reduce((s,x)=>s+cents(x.amount!),0);if(total>cents(out.gross)||(out.state==='verified'&&total!==cents(out.gross)))throw new BadRequestException('Проверьте сумму этапов оплаты');}
 if(out.paymentPlan.length){const perc=out.paymentPlan.filter(x=>x.percent!==undefined);if(perc.length===out.paymentPlan.length&&(perc.reduce((s,x)=>s+x.percent!,0)>100.0001||(out.state==='verified'&&Math.abs(perc.reduce((s,x)=>s+x.percent!,0)-100)>0.0001)))throw new BadRequestException('Этапы оплаты должны составлять100%');for(const p of out.paymentPlan){if(p.currency!==out.currency)throw new BadRequestException('Валюта этапа должна совпадать с договором');if(p.percent!==undefined&&p.amount!==undefined&&out.gross!==undefined&&Math.abs(cents(p.amount)-Math.round(out.gross*p.percent))>1)throw new BadRequestException('Сумма этапа не соответствует проценту');if(p.dueDate&&p.event!=='fixed'&&!p.eventDate)throw new BadRequestException('Для срока от события сначала подтвердите дату события');if(p.dayType==='business'&&p.offsetDays&&!p.dueDate&&p.eventDate)throw new BadRequestException('Укажите проверенный срок по производственному календарю');}}
 return out;
}
/** Проверка конкретных вложений, не всего хранилища. SHA считается по байтам оригинала. */
export async function validateLegalFiles(connection:Connection,legal:LegalBundleDto,session?:ClientSession){
 const ids=legal.documents.map(d=>new Types.ObjectId(d.fileId));
 const photos=ids.length?await connection.db!.collection('photos').find({_id:{$in:ids},deletedAt:null},{session,projection:{storageUrl:1,sha256:1,sizeBytes:1,variant:1}}).toArray():[];
 const byId=new Map(photos.map(x=>[String(x._id),x]));
 for(const d of legal.documents){const p=byId.get(String(d.fileId));if(!p||p.variant==='thumb')throw new BadRequestException('Оригинал файла не найден');const file=safeUploadPath(p.storageUrl);if(!file)throw new BadRequestException('Для договора нужен локальный оригинал');try{const info=await stat(file);if(info.size>30*1024*1024)throw new Error();const bytes=await readFile(file);if(createHash('sha256').update(bytes).digest('hex')!==d.sourceSha256)throw new BadRequestException('Контрольная сумма оригинала отличается');}catch(e){if(e instanceof BadRequestException)throw e;throw new BadRequestException('Не удалось проверить оригинал файла');}
 const reserved=await connection.model('Photo').updateOne({_id:p._id,deletedAt:null,sourceDeleting:{$ne:true}},{$set:{sourceProtected:true}},{session}).exec();
 if(!reserved.matchedCount)throw new ConflictException('Файл уже удаляется или недоступен — оригинал не привязан');
 if(await connection.db!.collection('photos').findOne({storageUrl:p.storageUrl,sourceDeleting:true},{session,projection:{_id:1}}))throw new ConflictException('Файл уже удаляется через другую ссылку — оригинал не привязан');
 }
 for(const i of legal.issues)if(i.responsibleId&&!(await connection.db!.collection('persons').findOne({_id:new Types.ObjectId(i.responsibleId),deletedAt:null},{projection:{_id:1}})))throw new BadRequestException('Ответственный сотрудник не найден');
}
/** Legal версия+история+receipt одной CAS записью. Не повторять unknown результат без чтения. */
export async function patchLegal(model:Model<any>,id:string,dto:LegalPatchDto,actorId?:string,session?:ClientSession){
 if(!Types.ObjectId.isValid(id))throw new NotFoundException('Документ не найден');
 const cur=await model.findOne({_id:new Types.ObjectId(id),deletedAt:null},undefined,{session}).lean().exec() as Row|null;if(!cur)throw new NotFoundException('Документ не найден');
 const order = model.collection.name === 'salesorders';
 if (order && cur.activeArchiveVersion != null) throw archiveOrderConflict();
 const hash=legalHash({version:dto.version,reason:dto.reason,legal:dto.legal});
 const receipt=(cur.legalReceipts||[]).find((x:Row)=>x.uid===dto.clientUid);if(receipt){if(receipt.hash!==hash)throw new ConflictException('Ключ операции уже использован с другими данными');return legalPresentation(cur);}
 if(Number(cur.legalVersion||0)!==dto.version)throw new ConflictException('Документ изменился — обновите карточку');
 const newCustomerOrder = dto.legal.documents.some(document => document.kind === 'customer_order'
  && !cur.legal?.documents?.some((saved: Row) => saved.uid === document.uid));
 if (newCustomerOrder) {
  const source = cur.legal;
  const number = (value: unknown) => String(value ?? '').normalize('NFKC').trim().toUpperCase().replace(/\s+/g, ' ');
  const date = cur.contractDate instanceof Date ? cur.contractDate.toISOString().slice(0, 10) : String(cur.contractDate ?? '').slice(0, 10);
  if (!order || cur.stage === 'cancelled' || !source?.sourceNumber || !source.sourceDate
    || number(cur.orderNo) !== number(source.sourceNumber) || date !== source.sourceDate
    || !source.companySnapshot?.inn || !source.counterpartySnapshot?.inn
    || !source.documents?.some((document: Row) => document.kind === 'contract')) {
   throw new ConflictException('Для заказа покупателя нужен действующий договор с подтверждёнными номером, датой, сторонами и оригиналом');
  }
 }
 if((cur.legalReceipts||[]).length>=200)throw new ConflictException('Достигнут лимит истории операций — обратитесь к администратору');
 const context={counterpartyId:cur.counterpartyId,productionNo:cur.productionNo,lineCount:0,unmatchedCount:0};
 if(dto.legal.issues.some(i=>i.state==='resolved'&&['catalogMatch','productMatching'].includes(i.field))){
  if(model.collection.name==='salesorders'){context.lineCount=await model.db.db!.collection('incomes').countDocuments({orderId:cur._id,deletedAt:null,cancelledAt:null},{session});context.unmatchedCount=await model.db.db!.collection('incomes').countDocuments({orderId:cur._id,deletedAt:null,cancelledAt:null,productId:null,matchStatus:{$ne:'none'},lineType:{$ne:'service'}},{session});}
  else{const lines=(cur.items||[]).filter((i:Row)=>i.scopeState!=='excluded');context.lineCount=lines.length;context.unmatchedCount=lines.filter((i:Row)=>!i.productId&&i.matchStatus!=='none').length;context.counterpartyId=cur.counterpartyId;}
 }
 const legal=prepareLegal(dto.legal,cur.legal,actorId,context);
 if((legal.companySnapshot&&!cur.legal?.companySnapshot)||(legal.counterpartySnapshot&&!cur.legal?.counterpartySnapshot)){if(!cur.companyId)throw new BadRequestException('Сначала выберите нашу компанию');await validateLegalParties(model.db,String(cur.companyId),cur.counterpartyId?String(cur.counterpartyId):undefined,legal);}
 await validateLegalFiles(model.db,legal,session);
 const version=dto.version+1;const guard={_id:cur._id,deletedAt:null,...(order ? {activeArchiveVersion:null} : {}),$or:[{legalVersion:dto.version},...(dto.version===0?[{legalVersion:{$exists:false}}]:[])]};
 const updated=await model.findOneAndUpdate(guard,{$set:{legal,legalVersion:version,editedInApp:true},$push:{legalReceipts:{uid:dto.clientUid,hash,version,at:new Date()},legalHistory:{version:dto.version,at:new Date(),by:actorId,reason:dto.reason,legal:cur.legal||null}}},{new:true,session}).lean().exec() as Row|null;
 if(!updated){const fresh=await model.findOne({_id:cur._id},undefined,{session}).lean().exec()as Row|null;if(order&&fresh?.activeArchiveVersion!=null)throw archiveOrderConflict();const done=fresh?.legalReceipts?.find((x:Row)=>x.uid===dto.clientUid);if(done?.hash===hash)return legalPresentation(fresh!);throw new ConflictException('Документ изменился — обновите карточку');}
 return legalPresentation(updated);
}

export const INTAKE_INDEXES:Record<string,{key:Record<string,number>;partialFilterExpression:Record<string,unknown>}>= {
 c164_sales_intake_uid:{key:{intakeUid:1},partialFilterExpression:{intakeUid:{$type:'string'}}},
 c164_sales_intake_key:{key:{intakeKey:1},partialFilterExpression:{intakeKey:{$type:'string'}}},
 c164_offer_intake_uid:{key:{intakeUid:1},partialFilterExpression:{intakeUid:{$type:'string'}}},
 c164_offer_intake_key:{key:{intakeKey:1},partialFilterExpression:{intakeKey:{$type:'string'}}},
 c164_income_source_uid:{key:{sourceUid:1},partialFilterExpression:{sourceUid:{$type:'string'}}},
 c164_income_source_row:{key:{orderId:1,'sourceLine.documentUid':1,'sourceLine.rowKey':1},partialFilterExpression:{'sourceLine.documentUid':{$type:'string'},'sourceLine.rowKey':{$type:'string'}}},
};
export async function assertIntakeIndexes(model:Model<any>,names:string[]){
 let indexes;try{indexes=await model.collection.indexes();}catch{throw new ServiceUnavailableException('Индексы загрузки источников недоступны');}
 if(names.some(name=>{const spec=INTAKE_INDEXES[name];return !spec||!indexes.some(i=>i.name===name&&i.unique===true&&JSON.stringify(i.key)===JSON.stringify(spec.key)&&legalHash(i.partialFilterExpression)===legalHash(spec.partialFilterExpression)&&!i.sparse&&!i.hidden&&!i.expireAfterSeconds&&(!i.collation||i.collation.locale==='simple'));}))throw new ServiceUnavailableException('Загрузка источников временно недоступна: индексы ещё не подготовлены');
}

export async function validateLegalParties(connection:Connection,companyId:string,counterpartyId:string|undefined,legal:LegalBundleDto){
 const company=await connection.db!.collection('organizations').findOne({_id:new Types.ObjectId(companyId),deletedAt:null,isOurCompany:true},{projection:{inn:1}});
 if(!company)throw new BadRequestException('Выберите нашу компанию');
 if(legal.companySnapshot?.inn&&String(company.inn||'')!==legal.companySnapshot.inn)throw new BadRequestException('ИНН продавца не соответствует нашей компании');
 if(counterpartyId){const buyer=await connection.db!.collection('organizations').findOne({_id:new Types.ObjectId(counterpartyId),deletedAt:null},{projection:{inn:1}});if(!buyer||legal.counterpartySnapshot?.inn&&String(buyer.inn||'')!==legal.counterpartySnapshot.inn)throw new BadRequestException('ИНН покупателя не соответствует контрагенту');}
}

export function intakeContentHash(dto:Row){const content={...dto};for(const key of ['intakeUid','clientUid','requireFields'])delete content[key];return legalHash(content);}

/** Новый источник разделяет существующий unique importKey с legacy CREATE. */
export async function assertSalesBusinessIndex(model:Model<any>){
 let indexes;try{indexes=await model.collection.indexes();}catch{throw new ServiceUnavailableException('Индекс номера договора недоступен');}
 if(!indexes.some(i=>JSON.stringify(i.key)===JSON.stringify({importKey:1})&&i.unique===true&&i.sparse===true&&!i.partialFilterExpression&&!i.hidden&&(!i.collation||i.collation.locale==='simple')))throw new ServiceUnavailableException('Сначала требуется проверить единый индекс номера договора');
}
