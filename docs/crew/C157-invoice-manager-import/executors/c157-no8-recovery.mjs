/** Только подготовленный recovery существующего №8. --plan без API; apply требует нового rootreview/approval. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');assert.equal(path.resolve('.'),ROOT);
const B=path.join(ROOT,'docs/crew/C157-invoice-manager-import/data');
const API='D:/invSportiN/Сайт/01_Проекты_CRM/data-core/deploy/synology/api.sh',BASH='C:/Program Files/Git/bin/bash.exe';
assert.match(fs.readFileSync(API,'utf8'),/prod\)\s+base="https:\/\/kppdf-crm\.ru\/db"/);
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const read=f=>JSON.parse(fs.readFileSync(f,'utf8').replace(/^\uFEFF/,''));
const planFile=path.join(B,'no8-recovery-plan.json'),PLAN='571f87f413c46250d74341e320d8c690ad4764986a9e1a4391bcdfa53311c77b',FILE='d84512c8009204afed3c0f045f9aca68de222ff59e7e2c94313d04c659397b36';
assert.equal(hash(fs.readFileSync(planFile)),FILE);const p=read(planFile);assert.equal(p.planHash,PLAN);
assert.deepEqual(p.ids,{invoiceId:'6aff4f3d1eb87438515b4754',supplierId:'6aff4f391eb87438515b4737',requestId:'6aff4f3b1eb87438515b4745',photoId:'6aff4f421eb87438515b476f',payerId:'6ad52bec863df73f344ea489'});
const I=p.ids,route='/api/supply/invoices/'+I.invoiceId;
assert.deepEqual(p.steps.map(x=>x.key),['header','line','issue','payment']);assert.ok(!('version' in p.steps[0].body)&&!('version' in p.steps[2].body));
const original=path.join(B,'next10-journal',p.sourceSha256+'.json');assert.equal(hash(fs.readFileSync(original)),p.originalStoppedJournalSha256);
const args=process.argv.slice(2);assert.ok(args.length===0||args.length===1&&['--plan','--apply'].includes(args[0]));
if(args[0]!=='--apply'){console.log(JSON.stringify({mode:'LOCAL_ONLY',planHash:PLAN,existingIds:I,steps:4,apiCalls:0,create:0,upload:0}));process.exit(0);}
const approval=read(path.join(B,'no8-recovery-approval.json'));
assert.equal(approval.productionWriteApproved,true);assert.equal(approval.releaseVerified,true);assert.equal(approval.planHash,PLAN);assert.equal(approval.payloadFileSha256,FILE);assert.equal(approval.helperSha256,hash(fs.readFileSync(fileURLToPath(import.meta.url))));
assert.ok(Date.now()-Date.parse(approval.approvedAt)>=0&&Date.now()-Date.parse(approval.approvedAt)<3600000);
assert.match(approval.expectedUiHash,/^[a-f0-9]{8}$/);assert.match(approval.expectedBackendCodeHash,/^[a-f0-9]{8}$/);assert.ok(Number.isInteger(approval.expectedVersion)&&approval.expectedVersion>=951);
const J=path.join(B,'no8-recovery-journal.json');assert.ok(!fs.existsSync(J),'Любой existing recovery journal: STOP, no resume');
const lock=path.join(B,'no8-recovery.lock'),lockFd=fs.openSync(lock,'wx');fs.writeSync(lockFd,JSON.stringify({pid:process.pid,planHash:PLAN}));fs.closeSync(lockFd);
const write=(f,v)=>{assert.ok(path.resolve(f).startsWith(B+path.sep));const tmp=f+'.tmp';fs.writeFileSync(tmp,JSON.stringify(v,null,2)+'\n');fs.renameSync(tmp,f);};
const cents=v=>{assert.ok(Number.isFinite(Number(v)));return Math.round(Number(v)*100);},id=x=>String(x?.id||x?._id||''),day=v=>String(v||'').slice(0,10);
let j={status:'PREFLIGHT',planHash:PLAN,steps:[],snapshots:[]};
function api(method,url,body,raw=false){
 assert.ok(url.startsWith('/')&&!url.includes('..')&&!url.startsWith('//')&&!/[\r\n]/.test(url));
 if(method!=='GET')assert.ok(method==='PATCH'&&[route,route+'/lines/'+I.requestId].includes(url)||method==='POST'&&url===route+'/payments','Only4exact recovery mutations');
 const cli=[API,'prod',method,url];if(body){const f=path.join(B,'no8-recovery-body-'+hash(JSON.stringify(body))+'.json');write(f,body);cli.push(f.replaceAll('\\','/'));}
 const r=spawnSync(BASH,cli,{windowsHide:true,timeout:60000,maxBuffer:25*1024*1024,...(raw?{}:{encoding:'utf8'})});if(r.status!==0)throw Error('CLI_EXIT_'+r.status);if(raw)return r.stdout;
 let d;try{d=JSON.parse(r.stdout);}catch{throw Error('NONJSON_STOP');}
 if(Number(d?.statusCode)>=400){const messages=Array.isArray(d.message)?d.message:[],allowed=new Set(['version','no','date','currency','vatMode','payerCompanyId','fileIds','issue','sourceLineAmount','amount','clientUid']);const fields=messages.map(m=>typeof m==='string'?m.match(/^property ([A-Za-z][A-Za-z0-9]*) should not exist$/)?.[1]:null).filter(f=>allowed.has(f));throw Error('HTTP_'+d.statusCode+' CODE_'+(['READ_ONLY','CONFLICT','VALIDATION_ERROR'].includes(d.code)?d.code:'OTHER')+' REASON_'+(fields.length?'DTO_EXTRA_FIELD':'UNCLASSIFIED')+' FIELDS_'+fields.join(','));}
 return d;
}
function snapshot(label,paid){
 const card=api('GET',route),pay=api('GET',route+'/payments?limit=200');
 assert.equal(id(card),I.invoiceId);assert.equal(card.supplierId,I.supplierId);assert.equal(card.requests.length,1);assert.equal(id(card.requests[0]),I.requestId);assert.equal(card.requests[0].companyId,I.payerId);assert.equal(card.requests[0].qty,1);assert.ok(!card.receiptBoundaryAt&&!card.requests[0].receivedAt&&card.requests[0].status!=='received');
 for(const k of ['amount','sourceAmount','accountingAmountRub'])assert.equal(cents(card[k]),2230000);
 assert.equal(cents(card.requests[0].priceHint),2230000);assert.equal(cents(card.requests[0].lineAmount),2230000);assert.equal(cents(card.requests[0].sourceLineAmount),2230000);
 assert.equal(pay.total,paid?1:0);assert.equal(cents(card.paidAmount),paid?2230000:0);assert.equal(cents(card.balanceDue),paid?0:2230000);
 const f=api('GET','/api/finance/operations?'+new URLSearchParams({from:'2026-09-24',to:'2026-09-24',companyId:I.payerId,counterpartyId:I.supplierId,source:'supply',limit:'100'}));assert.ok(f.total<=100);const own=f.items.filter(r=>r.invoiceId===I.invoiceId);assert.equal(own.length,paid?1:0);
 if(paid){const payment=pay.items[0];assert.equal(payment.clientUid,p.steps[3].body.clientUid);assert.equal(cents(payment.amount),2230000);assert.equal(day(payment.date),'2026-09-24');assert.equal(payment.payerCompanyId,I.payerId);assert.equal(own[0].paymentId,id(payment));assert.ok(own[0].operationId.startsWith('supply-payment:'+id(payment)+':'));assert.equal(cents(own[0].amount),2230000);assert.equal(card.paymentState,'paid');}
 const fields=['id','no','date','version','status','amount','sourceAmount','accountingAmountRub','paidAmount','balanceDue','paymentState','paymentsTotal','currency','vatMode','fileIds','supplierId','payerCompanyId'];
 j.snapshots.push({label,at:new Date().toISOString(),invoice:Object.fromEntries(fields.filter(k=>card[k]!==undefined).map(k=>[k,card[k]])),paymentsTotal:pay.total,ledger:own.map(r=>Object.fromEntries(['operationId','invoiceId','paymentId','allocationId','date','amount','companyId','counterpartyId'].map(k=>[k,r[k]])))});return card;
}
try{
 assert.equal(api('GET','/api/health').status,'ok');const ver=api('GET','/app/version.json');assert.equal(ver.v,approval.expectedUiHash);assert.equal(ver.b,approval.expectedBackendCodeHash);assert.equal(ver.n,approval.expectedVersion);const sw=api('GET','/api/control/switch');assert.equal(sw.mode,'normal');assert.equal(sw.role,'main');assert.ok(!sw.job||['done','failed','cancelled'].includes(sw.job.state));
 const payer=api('GET','/api/organizations/'+I.payerId);assert.equal(payer.inn,'2310181417');assert.equal(payer.isOurCompany,true);assert.notEqual(payer.isActive,false);
 const supplier=api('GET','/api/organizations/'+I.supplierId);assert.equal(supplier.inn,'2621016984');const vat=supplier.vatRate;
 const photo=api('GET','/api/photos/'+I.photoId);assert.equal(id(photo),I.photoId);assert.equal(photo.originalFilename,p.before.photo.originalFilename);assert.equal(photo.sizeBytes,p.before.photo.sizeBytes);assert.equal(photo.mimeType,'application/pdf');assert.match(photo.storageUrl,/^\/uploads\/[A-Za-z0-9/_.-]+\.pdf$/);assert.ok(!photo.storageUrl.includes('..'));const pdf=api('GET',photo.storageUrl,undefined,true);assert.equal(hash(pdf),p.sourceSha256);assert.equal(pdf.length,photo.sizeBytes);
 const initial=snapshot('before',false);for(const [key,value] of Object.entries(p.before.invoice))assert.deepEqual(initial[key],value,'Changed before field '+key);assert.equal(initial.version,1);assert.equal(initial.status,'draft');assert.deepEqual(initial.fileIds,[]);
 j.status='RUNNING';write(J,j);
 for(const op of p.steps){
  const current=snapshot('before-'+op.key,false),body=JSON.parse(JSON.stringify(op.body));if(body.version==='$freshInvoiceVersion')body.version=current.version;
  const st={key:op.key,status:'PENDING',method:op.method,route:op.route,body};j.steps.push(st);write(J,j);api(op.method,op.route,body);
  const after=snapshot('after-'+op.key,op.key==='payment');assert.equal(after.no,'8');assert.equal(day(after.date),'2026-09-24');assert.equal(after.vatMode,'none');assert.equal(after.payerCompanyId,I.payerId);assert.deepEqual(after.fileIds,[I.photoId]);if(op.key==='issue')assert.equal(after.status,'issued');st.status='DONE';write(J,j);
 }
 assert.equal(api('GET','/api/organizations/'+I.supplierId).vatRate,vat);assert.equal(hash(fs.readFileSync(original)),p.originalStoppedJournalSha256);j.status='DONE';write(J,j);console.log(JSON.stringify({status:'DONE',no:'8',invoiceId:I.invoiceId,steps:4,amount:22300,uploads:0,creates:0}));
}catch(e){j.status='STOP_RECONCILE';j.error=String(e.message).slice(0,300);write(J,j);console.error(JSON.stringify({status:'STOP_NO_RETRY',reason:j.error}));process.exitCode=1;}
finally{fs.unlinkSync(lock);assert.equal(hash(fs.readFileSync(original)),p.originalStoppedJournalSha256,'Original failed journal changed');}
