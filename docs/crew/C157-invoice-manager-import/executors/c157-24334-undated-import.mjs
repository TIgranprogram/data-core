/** C157: локальный план по умолчанию. PROD apply — только после review и отдельного approval-файла root. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
assert.equal(path.resolve('.'),ROOT,'Запуск только из текущей рабочей копии');
const DATA=path.join(ROOT,'docs/crew/C157-invoice-manager-import/data');
const API='D:/invSportiN/Сайт/01_Проекты_CRM/data-core/deploy/synology/api.sh';
const BASH='C:/Program Files/Git/bin/bash.exe';
assert.match(fs.readFileSync(API,'utf8'),/prod\)\s+base="https:\/\/kppdf-crm\.ru\/db"/,'У api.sh другой prod-origin');
const canonical=v=>v===null||typeof v!=='object'?v:Array.isArray(v)?v.map(canonical):Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]));
const digest=v=>crypto.createHash('sha256').update(typeof v==='string'||Buffer.isBuffer(v)?v:JSON.stringify(canonical(v))).digest('hex');
const clone=v=>JSON.parse(JSON.stringify(v));
const cents=n=>{assert.ok(Number.isFinite(Number(n)));return Math.round(Number(n)*100);};
const id=x=>String(x?.id||x?._id||'');
const day=x=>String(x||'').slice(0,10);
const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const write=(p,v)=>{assert.ok(path.resolve(p).startsWith(DATA+path.sep));fs.mkdirSync(path.dirname(p),{recursive:true});const tmp=p+'.tmp';fs.writeFileSync(tmp,JSON.stringify(v,null,2)+'\n');fs.renameSync(tmp,p);};
const INPUT=path.join(DATA,'24334-undated-apply-proposal.json');
const INPUTSHA='fccdff2d5b06304721e145d69a2059938be8c74d39c39cceadd07725b4f51d8f';
assert.equal(digest(fs.readFileSync(INPUT)),INPUTSHA,'Изменился reviewed payload');
const payload=read(INPUT);assert.equal(payload.planHash,'93675df3b8bd652e97bac31010183815320367b54eda0ce2618f801d873a5449');
const source=[{...clone(payload),sourceFiles:payload.sourceFiles.map(f=>f.path),proposedPayment:null,blockers:[]}];
const EXPECTED=Object.fromEntries(source.map(d=>[d.no,{date:d.date,amount:d.amount,vat:d.invoicePatch.vatRate,vatMode:d.invoicePatch.vatMode,payDate:null,inn:d.supplierInn}]));
const BLOCKED=new Set(['8','4816','24479','7077','63','590','700','1299','3330','4209','12867','13027','25594','10001348']);
assert.equal(source.length,1);assert.deepEqual(source.map(d=>d.no),['24334']);
assert.ok(source.every(d=>!BLOCKED.has(d.no)&&d.blockers.length===0));
const payerRule=read(path.join(DATA,'payer-rule-owner.json'));assert.equal(payerRule.verifiedBuyerInn,'2310181417');
const requestsByDoc=new Map();const localDocs=[];
for(const d of source){
 assert.equal(d.buyerInn,'2310181417');assert.match(d.sourceSha256,/^[a-f0-9]{64}$/);
 assert.equal(d.sourceFiles.length,1);const file=d.sourceFiles[0];assert.match(file,/\.pdf$/i);assert.ok(!/[\r\n;,]/.test(file),'Небезопасное имя multipart файла');
 const pdf=fs.readFileSync(file);assert.equal(digest(pdf),d.sourceSha256,'PDF SHA не совпал');assert.equal(pdf.subarray(0,5).toString(),'%PDF-');assert.ok(pdf.length<25*1024*1024);
 assert.equal(d.requests.reduce((s,x)=>s+cents(x.requestBody.priceHint),0),cents(d.amount));
 d.requests.forEach((line,n)=>{assert.equal(line.requestBody.clientUid,`c157:${d.sourceSha256}:${n+1}`);assert.equal(cents(line.financialLineBody.sourceLineAmount),cents(line.requestBody.priceHint));assert.ok(line.requestBody.qty>0);assert.ok(!line.requestBody.statusLabel&&!line.requestBody.paid,'Не ставить оплату/получение через заявку');});
 const e=EXPECTED[d.no];assert.ok(e);assert.equal(d.date,e.date);assert.equal(cents(d.amount),cents(e.amount));assert.equal(d.supplierInn,e.inn);assert.equal(d.invoicePatch.vatRate,e.vat);assert.equal(d.invoicePatch.vatMode,e.vatMode);assert.equal(d.invoicePatch.currency,'RUB');
 assert.equal(d.proposedPayment,null);assert.equal(d.confirmationBodyTemplate.clientUid,`c157-undated:${d.sourceSha256}`);assert.deepEqual(d.confirmationBodyTemplate.fileIds,[]);assert.ok(!d.requests.some(r=>r.requestBody.articleId||r.requestBody.salesOrderId));
 if(d.supplierCreateIfMissing){assert.equal(d.supplierCreateIfMissing.inn,e.inn);assert.equal(d.supplierCreateIfMissing.isOurCompany,false);assert.ok(!('vatRate' in d.supplierCreateIfMissing));}assert.equal(d.supplierCreationAllowed,false);
 requestsByDoc.set(d.no,d.requests);
 localDocs.push({no:d.no,status:'APPLY_ONLY_AFTER_ROOT_APPROVAL',date:d.date,amount:d.amount,payerInn:d.buyerInn,supplierInn:d.supplierInn,sourceSha256:d.sourceSha256,fileName:path.basename(file),lineCount:d.requests.length,requestBodies:d.requests.map(x=>x.requestBody),financialLineBodies:d.requests.map(x=>Object.fromEntries(Object.entries(x.financialLineBody).filter(([,v])=>v!==null))),invoicePatch:d.invoicePatch,confirmation:d.confirmationBodyTemplate,supplierCreateIfMissing:d.supplierCreateIfMissing});
}
const planHash=payload.planHash;
const plan={kind:'C157 24334-undated concrete local plan; no API calls',planHash,payerRule:clone(payerRule),documents:localDocs,guarantees:['api.sh prod only','no receive/stock movement','no supplier VAT update','per-step pending journal blocks blind retry','PDF source SHA checked','bounded 24334-undated live duplicate proof before writes; priceHint is gross line total']};
const args=process.argv.slice(2);assert.ok(args.length===0||(args.length===1&&['--plan','--apply'].includes(args[0])));
if(args[0]!=='--apply'){write(path.join(DATA,'24334-undated-local-plan.json'),plan);console.log(JSON.stringify({mode:'LOCAL_PLAN_ONLY',planHash,applyEligible:Object.keys(EXPECTED),hold:[],blocked:[...BLOCKED],path:'C157/data/24334-undated-local-plan.json',apiCalls:0}));process.exit(0);}
// Этот файл создаёт root только после review и независимого post-release check.
const approval=read(path.join(DATA,'24334-undated-apply-approval.json'));
assert.equal(approval.productionWriteApproved,true);assert.equal(approval.releaseVerified,true);assert.equal(approval.planHash,planHash);assert.match(approval.expectedUiHash,/^[a-f0-9]{8}$/);assert.match(approval.expectedBackendCodeHash,/^[a-f0-9]{8}$/);assert.ok(Number.isInteger(approval.expectedVersion)&&approval.expectedVersion>=952);assert.equal(approval.C165Released,true);assert.match(approval.releasedCommit,/^[a-f0-9]{8,40}$/);assert.equal(approval.payloadFileSha256,INPUTSHA);
assert.ok(Date.now()-new Date(approval.approvedAt).getTime()>=0&&Date.now()-new Date(approval.approvedAt).getTime()<3600000,'Approval старше часа');
assert.deepEqual([...approval.numbers].sort(),Object.keys(EXPECTED).sort());
assert.equal(approval.helperSha256,digest(fs.readFileSync(fileURLToPath(import.meta.url))),'Helper отличается от rootreview');
const READER=path.join(ROOT,'tools/logs/c157-24334-undated-targeted-read.py');assert.equal(approval.readerSha256,digest(fs.readFileSync(READER)),'Reader отличается от rootreview');
const JOURNAL=path.join(DATA,'24334-undated-journal');fs.mkdirSync(JOURNAL,{recursive:true});
const lock=path.join(JOURNAL,'apply.lock');const lockFd=fs.openSync(lock,'wx');fs.writeSync(lockFd,JSON.stringify({pid:process.pid,at:new Date().toISOString(),planHash}));fs.closeSync(lockFd);
let activeJournal;
const minimal=x=>({id:id(x),...Object.fromEntries(['no','date','amount','status','version','inn','name','originalFilename','mimeType','paidAmount','balanceDue','paymentState','sourceAmount','vatRate','vatMode','declaredVatAmount','payerCompanyId','supplierId'].filter(k=>x?.[k]!==undefined).map(k=>[k,x[k]])),...(x?.items?{items:x.items.map(a=>({id:id(a),no:a.no,amount:a.amount,status:a.status,version:a.version}))}:{}),...(x?.requests?{requestIDs:x.requests.map(id)}:{}),...(x?.fileIds?{fileIDs:x.fileIds.map(String)}:{})});
function api(method,route,body,upload){
 assert.ok(route.startsWith('/')&&!route.startsWith('//')&&!route.includes('..')&&!/[\r\n]/.test(route));
 if(method!=='GET'){
  assert.ok(['POST','PATCH'].includes(method));
  const ok=method==='POST'?/^\/api\/(photos\/upload|supply\/requests|supply\/invoices|supply\/invoices\/[a-f0-9]{24}\/undated-payment)$/.test(route):/^\/api\/supply\/invoices\/[a-f0-9]{24}(\/lines\/[a-f0-9]{24})?$/.test(route);
  assert.ok(ok,'Мутация не разрешена helper: '+route);
 }
 const cli=[API,'prod',method,route];
 if(upload){
  assert.equal(route,'/api/photos/upload');
  const original=path.basename(upload);assert.ok(!/[\r\n]/.test(original),'Некорректное имя multipart');
  const headerFile=path.join(JOURNAL,'multipart',digest(original)+'.headers.txt');assert.ok(headerFile.startsWith(DATA+path.sep));fs.mkdirSync(path.dirname(headerFile),{recursive:true});
  // Имя передаётся UTF8байтами файла заголовка, а не через Windows ACP argv.
  const quoted=original.replaceAll('\\','\\\\').replaceAll('"','\\"');
  fs.writeFileSync(headerFile,`Content-Disposition: form-data; name="file"; filename="${quoted}"\r\n`,'utf8');
  cli.push('--form',`file=@${upload.replaceAll('\\','/')};type=application/pdf;headers=@${headerFile.replaceAll('\\','/')}`);
 }
 else if(body){const target=path.join(JOURNAL,'bodies',digest({method,route,body})+'.json');write(target,body);cli.push(target.replaceAll('\\','/'));}
 const result=spawnSync(BASH,cli,{encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:8*1024*1024});
 if(result.status!==0)throw Error('api.sh CLI exit '+result.status+'; остановка без автоматического повтора');
 let data;try{data=JSON.parse(result.stdout);}catch{throw Error('API не JSON; остановка без автоматического повтора');}
 if(data&&Number(data.statusCode)>=400){const messages=Array.isArray(data.message)?data.message:[];const allowed=new Set(['version','fileIds','vatMode','vatRate','declaredVatAmount','payerCompanyId','sourceLineAmount','sourceUnitPrice','issue','no','date','currency','amount','clientUid']);const fields=messages.map(m=>typeof m==='string'?m.match(/^property ([A-Za-z][A-Za-z0-9]*) should not exist$/)?.[1]:null).filter(f=>allowed.has(f));throw Error('API HTTP '+data.statusCode+' CODE_'+(['READ_ONLY','CONFLICT','VALIDATION_ERROR'].includes(data.code)?data.code:'OTHER')+' REASON_'+(fields.length?'DTO_EXTRA_FIELD':'UNCLASSIFIED')+' FIELDS_'+fields.join(','));}
 return data;
}
function save(j){write(j.path,j.data);}
function verifyPhoto(j,d,uploaded,photo){
 assert.equal(String(photo.originalFilename||photo.name).normalize('NFC'),path.basename(d.sourceFiles[0]).normalize('NFC'));
 assert.equal(photo.mimeType||photo.mime,'application/pdf');assert.equal(photo.sizeBytes,fs.statSync(d.sourceFiles[0]).size);
 assert.match(photo.storageUrl,/^\/uploads\/[A-Za-z0-9/_.-]+\.pdf$/);assert.ok(!photo.storageUrl.includes('..'));
 const raw=spawnSync(BASH,[API,'prod','GET',photo.storageUrl],{windowsHide:true,timeout:60000,maxBuffer:25*1024*1024});
 assert.equal(raw.status,0);assert.equal(raw.stdout.length,photo.sizeBytes);assert.equal(digest(raw.stdout),d.sourceSha256);
 j.data.pdfProof={photoId:uploaded.id,originalFilename:photo.originalFilename,sizeBytes:photo.sizeBytes,sha256:d.sourceSha256};save(j);
}

function step(j,key,method,route,body,fn){
 const intent=body?clone(body):{};delete intent.version;const intentHash=digest({method,route,intent});const old=j.data.steps[key];
 if(old){assert.equal(old.intentHash,intentHash,'Изменился intent завершённого шага');assert.equal(old.state,'DONE','Нужна ручная сверка pending/failed шага: '+key);return old.result;}
 j.data.steps[key]={state:'PENDING',intentHash,payloadHash:digest(body||{}),method,route,at:new Date().toISOString()};save(j);
 try{const result=fn();j.data.steps[key]={...j.data.steps[key],state:'DONE',result:minimal(result),doneAt:new Date().toISOString()};save(j);return j.data.steps[key].result;}
 catch(error){j.data.steps[key]={...j.data.steps[key],state:'FAILED_OR_UNCERTAIN',error:String(error.message).slice(0,400)};j.data.status='STOP_RECONCILE';save(j);throw error;}
}
function freshCard(invoiceId){const x=api('GET','/api/supply/invoices/'+invoiceId);assert.ok(Number.isInteger(x.version)&&x.version>=0);assert.ok(!x.receiptBoundaryAt,'Есть приёмка — остановка');assert.ok(x.requests.every(a=>a.status!=='received'&&!a.receivedAt),'Есть полученная строка');return x;}
function verifyFinance(invoice,d,e,requestIds,payer){
 assert.equal(invoice.no,d.no);assert.equal(day(invoice.date),d.date);assert.equal(invoice.currency,'RUB');assert.equal(invoice.payerCompanyId,payer.id);
 for(const key of ['amount','sourceAmount','accountingAmountRub'])assert.equal(cents(invoice[key]),cents(e.amount));
 assert.equal(invoice.vatMode,e.vatMode);if(e.vatMode==='included'){assert.equal(invoice.vatRate,e.vat);assert.equal(cents(invoice.declaredVatAmount),cents(d.invoicePatch.declaredVatAmount));}assert.ok(Math.abs(invoice.vatDifference||0)<=0.01);
 assert.equal(invoice.requests.length,requestIds.length);
 invoice.requests.forEach(row=>{const n=requestIds.indexOf(id(row));assert.ok(n>=0);const intended=d.requests[n].requestBody;assert.equal(cents(row.lineAmount),cents(intended.priceHint));assert.equal(Number(row.qty),Number(intended.qty));assert.equal(row.unit,intended.unit);assert.equal(String(row.companyId),payer.id);assert.equal(String(row.articleId||''),String(intended.articleId||''));});
}

function snapshot(j,label,invoice,d,e,requestIds,payer,supplierId,confirmed){
 const amount=cents(e.amount);assert.equal(cents(invoice.amount),amount);assert.equal(cents(invoice.sourceAmount),amount);assert.equal(cents(invoice.accountingAmountRub),amount);assert.equal(invoice.requests.reduce((sum,row)=>sum+cents(row.priceHint),0),amount);assert.deepEqual(invoice.requests.map(id).sort(),[...requestIds].sort());
 const payments=api('GET',`/api/supply/invoices/${id(invoice)}/payments?limit=1`);assert.equal(payments.total,0);
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const facts=api('GET','/api/finance/operations?'+new URLSearchParams({from:d.date,to:today,source:'supply',companyId:payer.id,counterpartyId:supplierId,limit:'100'}));assert.ok(facts.total<=100,'Target supplier/date span exceeds100: STOP, no pagination');const own=facts.items.filter(row=>String(row.invoiceId)===id(invoice));assert.equal(own.length,0);
 if(confirmed){assert.equal(invoice.paidAmount,null);assert.equal(invoice.balanceDue,null);assert.equal(invoice.requiresPaymentDate,true);}else assert.equal(invoice.paidAmount,0);
 j.data.snapshots??=[];j.data.snapshots.push({label,at:new Date().toISOString(),invoice:{...minimal(invoice),requiresPaymentDate:invoice.requiresPaymentDate},sourceAmount:invoice.sourceAmount,accountingAmountRub:invoice.accountingAmountRub,sumPriceHintCents:amount,paymentsTotal:0,ownLedgerRows:0});save(j);
}

try{
 assert.equal(api('GET','/api/health').status,'ok');const sw=api('GET','/api/control/switch');assert.equal(sw.mode,'normal');assert.equal(sw.role,'main');assert.ok(!sw.job||['done','failed','cancelled'].includes(sw.job.state));
 const ver=api('GET','/app/version.json');assert.equal(ver.v,approval.expectedUiHash,'На сайте другая UIверсия — остановка');assert.equal(ver.b,approval.expectedBackendCodeHash,'На сайте другой runtimeкод — остановка');assert.equal(ver.n,approval.expectedVersion,'На сайте другой номер версии — остановка');
 // Повторяем ровно уже reviewed narrow 24334-undated read, а не общий экспорт.
 const check=spawnSync('python',[READER],{encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:1000000});assert.equal(check.status,0,'Узкий preflight не выполнен');
 const proof=read(path.join(DATA,'24334-undated-targeted-readproof.json'));
 assert.equal(proof.readerSha256,approval.readerSha256);assert.equal(proof.inputSha256,INPUTSHA);
 assert.equal(proof.errors.length,0);for(const d of source){assert.equal(proof.documents[d.no].date,d.date);assert.equal(proof.documents[d.no].supplierInn,d.supplierInn);}assert.ok(proof.deletedProof.total<=20&&proof.deletedProof.total===proof.deletedProof.checked);assert.equal(proof.deletedProof.unknownFlags.length,0,'Удалённые кандидаты не сверены');
 const payer=proof.payer;assert.equal(payer.id,payload.payerExpectedId);assert.equal(payer.inn,'2310181417');assert.equal(payer.isOurCompany,true);assert.notEqual(payer.isActive,false);
 const summary=[];
 for(const no of Object.keys(EXPECTED)){
  assert.ok(!BLOCKED.has(no));const d=source.find(x=>x.no===no),e=EXPECTED[no];
  const file=path.join(JOURNAL,d.sourceSha256+'.json');const state=fs.existsSync(file)?read(file):{docUid:'c157-doc:'+d.sourceSha256,no,sourceSha256:d.sourceSha256,planHash,status:'NEW',steps:{}};
  assert.ok(!fs.existsSync(file)||['DONE','SKIP_EXISTING'].includes(state.status),'Любой незавершённый журнал: STOP, нужен отдельный readproof/review');
  assert.equal(state.planHash,planHash);assert.equal(state.no,no);assert.ok(!Object.values(state.steps).some(x=>x.state!=='DONE'),'Есть pending/failed журнал: нужна ручная сверка');
  assert.ok(['NEW','DONE','SKIP_EXISTING'].includes(state.status),'STOP/UNKNOWN не продолжается автоматически');
  const j={path:file,data:state};activeJournal=j;save(j);
  if(state.status==='DONE'||state.status==='SKIP_EXISTING'){summary.push({no,status:state.status,invoiceId:state.invoiceId});continue;}
  const duplicates=[...proof.documents[no].matches,...proof.deletedProof.exactmatches24334[no]];
  if(duplicates.length){j.data.status='SKIP_EXISTING';j.data.existing=duplicates.map(minimal);save(j);summary.push({no,status:'SKIP_EXISTING',ids:duplicates.map(id)});continue;}
  assert.equal(proof.suppliers[d.supplierInn].deleted.length,0,'Поставщик удалён — не создавать дубль');
  assert.ok(proof.suppliers[d.supplierInn].active.length<=1,'Дубли поставщика по ИНН');
  const liveOrgs=api('GET','/api/organizations?'+new URLSearchParams({search:d.supplierInn,limit:'20',page:'1'}));assert.ok(liveOrgs.total<=20);const exact=liveOrgs.items.filter(x=>String(x.inn)===d.supplierInn);assert.ok(exact.length<=1);let supplier=exact[0];
  assert.ok(supplier,'Existing supplier missing: STOP; no organizations create');assert.equal(id(supplier),payload.supplierExpectedId);
  assert.equal(supplier.inn,d.supplierInn);assert.ok(/^[a-f0-9]{24}$/.test(supplier.id));const supplierBefore=api('GET','/api/organizations/'+supplier.id);const supplierVatBefore=JSON.stringify({vatRate:supplierBefore.vatRate});
  const requestIds=[];
  for(let n=0;n<d.requests.length;n++){
   const body={...clone(d.requests[n].requestBody),supplierId:supplier.id,companyName:payer.name};
   assert.equal(body.clientUid,`c157:${d.sourceSha256}:${n+1}`);
   const row=step(j,'request-'+(n+1),'POST','/api/supply/requests',body,()=>api('POST','/api/supply/requests',body));requestIds.push(row.id);
   const fresh=api('GET','/api/supply/requests/'+row.id);assert.equal(fresh.clientUid,body.clientUid);assert.equal(String(fresh.supplierId),supplier.id);assert.equal(String(fresh.companyId),payer.id);assert.equal(cents(fresh.priceHint),cents(body.priceHint));assert.equal(Number(fresh.qty),Number(body.qty));assert.equal(fresh.paid,false);assert.notEqual(fresh.status,'received');assert.ok(!fresh.invoiceId,'SourceUID уже сгруппирован: STOP');
  }
  const group=step(j,'group','POST','/api/supply/invoices',{requestIds},()=>api('POST','/api/supply/invoices',{requestIds}));assert.equal(group.items.length,1);const invoiceId=group.items[0].id;j.data.invoiceId=invoiceId;save(j);
  let invoice=freshCard(invoiceId);assert.equal(invoice.supplierId,supplier.id);assert.equal(invoice.paidAmount,0,'Найден уже оплаченный ownUIDсчёт: отдельно сверить');assert.deepEqual(invoice.requests.map(id).sort(),[...requestIds].sort());
  snapshot(j,'after-group-before-upload',invoice,d,e,requestIds,payer,supplier.id,false);
  const knownUpload=j.data.steps.upload?.result?.id;assert.ok((invoice.fileIds||[]).every(x=>String(x)===knownUpload),'В ownUIDсчёте неизвестные файлы');
  const uploaded=step(j,'upload','POST','/api/photos/upload',{sourceSha256:d.sourceSha256,originalFilename:path.basename(d.sourceFiles[0])},()=>{assert.equal(digest(fs.readFileSync(d.sourceFiles[0])),d.sourceSha256,'PDF изменился после планирования');return api('POST','/api/photos/upload',undefined,d.sourceFiles[0]);});
  const photo=api('GET','/api/photos/'+uploaded.id);verifyPhoto(j,d,uploaded,photo);
  snapshot(j,'before-header',invoice,d,e,requestIds,payer,supplier.id,false);const header={...clone(d.invoicePatch),payerCompanyId:payer.id,fileIds:[uploaded.id]};
  step(j,'header','PATCH','/api/supply/invoices/'+invoiceId,header,()=>api('PATCH','/api/supply/invoices/'+invoiceId,header));
  invoice=freshCard(invoiceId);snapshot(j,'after-header',invoice,d,e,requestIds,payer,supplier.id,false);
  for(let n=0;n<requestIds.length;n++){
   invoice=freshCard(invoiceId);snapshot(j,'before-line-'+(n+1),invoice,d,e,requestIds,payer,supplier.id,false);const body={...Object.fromEntries(Object.entries(d.requests[n].financialLineBody).filter(([,v])=>v!==null)),version:invoice.version};
   step(j,'line-'+(n+1),'PATCH',`/api/supply/invoices/${invoiceId}/lines/${requestIds[n]}`,body,()=>api('PATCH',`/api/supply/invoices/${invoiceId}/lines/${requestIds[n]}`,body));
   invoice=freshCard(invoiceId);snapshot(j,'after-line-'+(n+1),invoice,d,e,requestIds,payer,supplier.id,false);
  }
  invoice=freshCard(invoiceId);verifyFinance(invoice,d,e,requestIds,payer);snapshot(j,'before-undated-confirm',invoice,d,e,requestIds,payer,supplier.id,false);
  assert.equal(invoice.status,'draft','Confirm directly from draft; no intermediate issue/debt');
  const confirmation={...clone(d.confirmationBodyTemplate),version:invoice.version};const sourceVersion=invoice.version;
  assert.ok(!('date' in confirmation)&&!('amount' in confirmation)&&!('payerCompanyId' in confirmation));
  step(j,'undated-confirm','POST',`/api/supply/invoices/${invoiceId}/undated-payment`,confirmation,()=>api('POST',`/api/supply/invoices/${invoiceId}/undated-payment`,confirmation));
  invoice=freshCard(invoiceId);verifyFinance(invoice,d,e,requestIds,payer);assert.equal(invoice.version,sourceVersion+1);assert.equal(invoice.status,'issued');assert.equal(invoice.paymentState,'date_required');assert.equal(invoice.requiresPaymentDate,true);assert.equal(invoice.paidAmount,null);assert.equal(invoice.balanceDue,null);
  assert.equal(invoice.undatedPaymentEvidence.state,'pending');assert.equal(invoice.undatedPaymentEvidence.amountRub,50076);assert.equal(invoice.undatedPaymentEvidence.payerCompanyId,payer.id);assert.equal(invoice.undatedPaymentEvidence.reason,confirmation.reason);assert.deepEqual(invoice.undatedPaymentEvidence.fileIds,[]);
  snapshot(j,'after-undated-confirm',invoice,d,e,requestIds,payer,supplier.id,true);
  const queue=api('GET','/api/supply/invoices?'+new URLSearchParams({q:d.no,from:d.date,to:d.date,supplierId:supplier.id,needsPaymentDate:'1',limit:'20',page:'1'}));assert.ok(queue.total<=20);assert.equal(queue.items.filter(x=>id(x)===invoiceId).length,1);j.data.fillQueuePredicateProof={invoiceId,requiresPaymentDate:true,needsPaymentDateFilter:'1',targetFound:true,globalNeedsFillNotFetched:true,debtContributionBasis:'pending excluded by managedRequestInvoices/invoiceObligations; balance is null, not zero'};
  const supplierAfter=api('GET','/api/organizations/'+supplier.id);assert.equal(JSON.stringify({vatRate:supplierAfter.vatRate}),supplierVatBefore,'Постоянный НДС поставщика изменился');
  j.data.status='DONE';j.data.final=minimal(invoice);j.data.completedAt=new Date().toISOString();save(j);summary.push({no,status:'DONE',invoiceId,undatedPaymentConfirmed:true,requiresPaymentDate:true,fileId:uploaded.id});
 }
 write(path.join(DATA,'24334-undated-apply-result.json'),{at:new Date().toISOString(),planHash,summary,hold:[],blocked:[...BLOCKED]});console.log(JSON.stringify({status:'FINISHED',summary,hold:[],apiWrites:'only reviewed 24334-undated; never receive/global supplier VAT'}));
}catch(error){if(activeJournal){activeJournal.data.status='STOP_RECONCILE';activeJournal.data.lastError=String(error.message).slice(0,400);save(activeJournal);}console.error(JSON.stringify({status:'STOP_NO_BLIND_RETRY',reason:String(error.message).slice(0,400)}));process.exitCode=1;}
finally{fs.unlinkSync(lock);}
