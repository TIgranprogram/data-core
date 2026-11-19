import subprocess,json,datetime,re
from pathlib import Path
root=Path.cwd();out=root/'docs/crew/C157-invoice-manager-import/data';out.mkdir(parents=True,exist_ok=True)
proposal=json.loads((out/'remaining9-exact-apply-proposal.json').read_text(encoding='utf-8-sig'))['documents']
assert len(proposal)==9 and not ({d['no'] for d in proposal}&{'8','24334','24479','7077','63','4816'})
bash='C:/Program Files/Git/bin/bash.exe';script='D:/invSportiN/Сайт/01_Проекты_CRM/data-core/deploy/synology/api.sh'
from urllib.parse import urlencode

def api(route):
 r=subprocess.run([bash,script,'prod','GET',route],capture_output=True)
 if r.returncode:raise RuntimeError('CLI_EXIT_'+str(r.returncode))
 try:d=json.loads(r.stdout.decode('utf-8-sig'))
 except Exception:raise RuntimeError('NON_JSON')
 if isinstance(d,dict) and isinstance(d.get('statusCode'),int) and d['statusCode']>=400:raise RuntimeError('HTTP_'+str(d['statusCode']))
 return d

def oid(x):return str(x.get('id',x.get('_id','')))
def minimalOrg(x):return {'id':oid(x),**{k:x[k] for k in ['inn','name','shortName','version','isOurCompany','isActive','deletedAt'] if k in x}}
def normNo(value):
 s=str(value or '').strip();m=re.fullmatch(r'0*(\d+)',s) or re.search(r'№\s*0*(\d+)(?:\D|$)',s)
 return str(int(m.group(1))) if m else s

def minimalInvoice(x):
 return {'id':oid(x),**{k:x[k] for k in ['no','date','amount','status','version','supplierId','supplierName','payerCompanyId','deletedAt'] if k in x},'requestIDs':[oid(a) for a in x.get('requests',[])],'fileIDs':[str(a) for a in x.get('fileIds',[])]}

result={'kind':'targeted remaining9 duplicates; no business writes','startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'numbers':[d['no'] for d in proposal],'suppliers':{},'documents':{},'errors':[]}
try:
 # Единственная bounded deleted-page. Нерелевантные записи никогда не сохраняются.
 deleted=api('/api/admin/collections/supplyinvoices/docs?deleted=only&limit=20&page=1')
 if not isinstance(deleted.get('total'),int) or deleted['total']>20 or len(deleted.get('items',[]))!=deleted['total']:
  result['deletedProof']={'total':deleted.get('total'),'checked':0,'exactmatches9':{},'unknownFlags':['bounded-page-incomplete-or-total-over20:STOP']};raise RuntimeError('DELETED_SCOPE_STOP')
 tombstones=[{k:x.get(k) for k in ['id','_id','no','date','supplierId','supplierName']} for x in deleted['items']]
 result['deletedProof']={'total':deleted['total'],'checked':len(tombstones),'exactmatches9':{},'unknownFlags':[]};deleted=None
 payer=api('/api/organizations/6ad52bec863df73f344ea489');result['payer']=minimalOrg(payer)
 if str(payer.get('inn','')).strip()!='2310181417' or payer.get('isOurCompany') is not True:raise RuntimeError('PAYER_INN_OR_OURCOMPANY_MISMATCH')
 for inn in sorted({d['supplierInn'] for d in proposal}):
  active=api('/api/organizations?'+urlencode({'search':inn,'limit':20,'page':1}))
  dead=api('/api/admin/collections/organizations/docs?'+urlencode({'q':inn,'deleted':'only','limit':20,'page':1}))
  if (active.get('total') or 0)>20 or (dead.get('total') or 0)>20:raise RuntimeError('ORG_SCOPE_OVER20_STOP')
  items=[minimalOrg(x) for x in active.get('items',[]) if str(x.get('inn','')).strip()==inn]
  removed=[minimalOrg(x) for x in dead.get('items',[]) if str(x.get('inn','')).strip()==inn]
  result['suppliers'][inn]={'active':items,'deleted':removed}
 for doc in proposal:
  inn=doc['supplierInn'];orgs=result['suppliers'][inn];ids={x['id'] for x in orgs['active']+orgs['deleted']};activeIds={x['id'] for x in orgs['active']}
  params={'q':doc['no'],'from':doc['date'],'to':doc['date'],'limit':20,'page':1}
  if len(activeIds)==1:params['supplierId']=next(iter(activeIds))
  listing=api('/api/supply/invoices?'+urlencode(params))
  if (listing.get('total') or 0)>20:raise RuntimeError('INVOICE_SCOPE_OVER20_STOP')
  candidates=[x for x in listing.get('items',[]) if normNo(x.get('no'))==doc['no'] and str(x.get('date',''))[:10]==doc['date']]
  result['documents'][doc['no']]={'date':doc['date'],'supplierInn':inn,'status':'HOLD-payment-date-unknown' if doc['no']=='24334' else 'READ_ONLY_CHECKED','matches':[]}
  for x in candidates:
   card=api('/api/supply/invoices/'+oid(x));result['documents'][doc['no']]['matches'].append(minimalInvoice(card))
   if ids and str(card.get('supplierId','')) not in ids:result['documents'][doc['no']]['supplierIdentityUnknown']=True
  matches=[]
  for x in tombstones:
   if normNo(x.get('no'))!=doc['no']:continue
   if not x.get('date'):
    result['deletedProof']['unknownFlags'].append({'no':doc['no'],'id':oid(x),'reason':'deleted-date-missing'});continue
   if str(x['date'])[:10]!=doc['date']:continue
   if str(x.get('supplierId','')) in ids:matches.append({k:x[k] for k in ['id','_id','no','date','supplierId'] if x.get(k) is not None})
   else:result['deletedProof']['unknownFlags'].append({'no':doc['no'],'id':oid(x),'reason':'matching-no-date-supplierId-not-resolved-to-requested-INN'})
  result['deletedProof']['exactmatches9'][doc['no']]=matches
except Exception as error:result['errors'].append(str(error))
result['finishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat()
(out/'remaining9-targeted-readproof.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'documents':len(result['documents']),'supplierCount':len(result['suppliers']),'errors':result['errors'],'activeMatches':{n:len(d['matches']) for n,d in result['documents'].items()},'deletedTotal':result.get('deletedProof',{}).get('total')}))
