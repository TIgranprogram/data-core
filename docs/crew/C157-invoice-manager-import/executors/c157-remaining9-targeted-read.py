INPUT_NAME='remaining9-exact-apply-proposal.json'
INPUT_SHA='7d1d3e89c23686ecc356cfccfab7920ea0e1a725c590c1bbc95e318ae6e4f8ee'
EXPECTED_NUMBERS=['10001348', '12867', '1299', '13027', '25594', '3330', '4209', '590', '700']
OUTPUT_NAME='remaining9-targeted-readproof.json'
MATCHES_KEY='exactmatches9'

import subprocess,json,datetime,re,hashlib,sys
from pathlib import Path
from urllib.parse import urlencode
assert len(sys.argv)==1
B=Path.cwd()/'docs/crew/C157-invoice-manager-import/data'
payload=B/INPUT_NAME;assert hashlib.sha256(payload.read_bytes()).hexdigest()==INPUT_SHA,'Reviewed source payload changed'
data=json.loads(payload.read_text(encoding='utf-8-sig'));proposal=data['documents'] if 'documents' in data else [data]
assert {str(d['no']) for d in proposal}==set(EXPECTED_NUMBERS)
API=['C:/Program Files/Git/bin/bash.exe','D:/invSportiN/Сайт/01_Проекты_CRM/data-core/deploy/synology/api.sh','prod','GET']
def api(route):
    r=subprocess.run(API+[route],capture_output=True)
    if r.returncode:raise RuntimeError('CLI_EXIT_'+str(r.returncode))
    try:d=json.loads(r.stdout.decode('utf-8-sig'))
    except Exception:raise RuntimeError('API_NONJSON_STOP')
    if isinstance(d,dict) and d.get('statusCode',200)>=400:raise RuntimeError('HTTP_'+str(d['statusCode']))
    return d
def oid(x):return str(x.get('id',x.get('_id','')))
def normNo(value):
    s=str(value or '').replace('\u00a0',' ').strip()
    s=re.sub(r'^(?:сч[её]т(?:\s+на\s+оплату)?\s*)?№\s*','',s,flags=re.I)
    return str(int(s)) if re.fullmatch(r'\d+',s) else s.casefold()
def knownInn(value):
    s=str(value or '').strip()
    if not re.fullmatch(r'([0-9]{10}|[0-9]{12})',s) or not s.strip('0'):return None
    ds=list(map(int,s));check=lambda weights:sum(a*b for a,b in zip(ds,weights))%11%10
    ok=check([2,4,10,3,5,9,4,6,8])==ds[9] if len(ds)==10 else check([7,2,4,10,3,5,9,4,6,8])==ds[10] and check([3,7,2,4,10,3,5,9,4,6,8])==ds[11]
    return s if ok else None
def minimalOrg(x):return {'id':oid(x),**{k:x[k] for k in ['inn','name','shortName','version','isOurCompany','isActive','deletedAt'] if k in x}}
def minimalInvoice(x):return {'id':oid(x),**{k:x[k] for k in ['no','date','amount','status','version','supplierId','supplierName','payerCompanyId','deletedAt'] if k in x},'requestIDs':[oid(r) for r in x.get('requests',[])],'fileIDs':list(map(str,x.get('fileIds',[])))}
result={'kind':'targeted number/date plus target supplier INN identity; GET only','startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'readerSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'inputSha256':INPUT_SHA,'numbers':[d['no'] for d in proposal],'suppliers':{},'documents':{},'supplierTargetReads':{},'holds':[],'otherKnownSupplierCandidates':[],'errors':[]}
cache={}
def supplierIdentity(supplierId):
    supplierId=str(supplierId or '')
    if supplierId in cache:return cache[supplierId]
    if not re.fullmatch(r'[a-f0-9]{24}',supplierId):return {'id':supplierId,'inn':None,'reason':'MISSING_OR_INVALID_SUPPLIER_ID'}
    try:
        org=api('/api/organizations/'+supplierId);inn=knownInn(org.get('inn'));v={'id':supplierId,'inn':inn,'name':org.get('name'),'reason':None if inn else 'MISSING_OR_INVALID_INN'}
    except RuntimeError as e:
        if str(e)!='HTTP_404':raise
        v={'id':supplierId,'inn':None,'reason':'SUPPLIER_TARGET_GET_404'}
    cache[supplierId]=v;result['supplierTargetReads'][supplierId]=v;return v
def classify(candidate,doc,deleted):
    identity=supplierIdentity(candidate.get('supplierId'));minimal={k:candidate[k] for k in ['id','no','date','supplierId'] if k in candidate}
    if not identity.get('inn'):
        result['holds'].append({'no':doc['no'],'candidate':minimal,'deleted':deleted,'reason':identity['reason']});return 'unknown'
    if identity['inn']==doc['supplierInn']:return 'same'
    result['otherKnownSupplierCandidates'].append({'sourceNo':doc['no'],'candidate':minimal,'deleted':deleted,'supplierInn':identity['inn']});return 'other'
try:
    deleted=api('/api/admin/collections/supplyinvoices/docs?deleted=only&limit=20&page=1')
    if not isinstance(deleted.get('total'),int) or deleted['total']>20 or len(deleted.get('items',[]))!=deleted['total']:raise RuntimeError('DELETED_BOUNDED_PAGE_INCOMPLETE_OR_OVER20')
    tombstones=[{'id':oid(x),**{k:x.get(k) for k in ['no','date','supplierId']}} for x in deleted['items']]
    result['deletedProof']={'total':deleted['total'],'checked':len(tombstones),MATCHES_KEY:{},'unknownFlags':[]};deleted=None
    payer=api('/api/organizations/6ad52bec863df73f344ea489');result['payer']=minimalOrg(payer);assert str(payer.get('inn'))=='2310181417' and payer.get('isOurCompany') is True and payer.get('isActive') is not False
    for inn in sorted({d['supplierInn'] for d in proposal}):
        assert knownInn(inn)==inn
        active=api('/api/organizations?'+urlencode({'search':inn,'limit':20,'page':1}));dead=api('/api/admin/collections/organizations/docs?'+urlencode({'q':inn,'deleted':'only','limit':20,'page':1}))
        if active.get('total',0)>20 or dead.get('total',0)>20:raise RuntimeError('ORG_TARGET_SEARCH_OVER20')
        result['suppliers'][inn]={'active':[minimalOrg(x) for x in active.get('items',[]) if str(x.get('inn','')).strip()==inn],'deleted':[minimalOrg(x) for x in dead.get('items',[]) if str(x.get('inn','')).strip()==inn]}
    for doc in proposal:
        # Never supplierId-filter the active search: legacy headers may point to a second/unknown OrgID.
        params={'q':doc['no'],'from':doc['date'],'to':doc['date'],'limit':20,'page':1}
        listing=api('/api/supply/invoices?'+urlencode(params))
        if listing.get('total',0)>20 or len(listing.get('items',[]))!=listing['total']:raise RuntimeError('INVOICE_TARGET_SEARCH_INCOMPLETE_OR_OVER20')
        record={'date':doc['date'],'supplierInn':doc['supplierInn'],'status':'READ_ONLY_CHECKED','matches':[],'searchUsedSupplierId':False,'searchTotal':listing['total']};result['documents'][doc['no']]=record
        for item in listing['items']:
            if normNo(item.get('no'))!=normNo(doc['no']) or str(item.get('date',''))[:10]!=doc['date']:continue
            ident=oid(item);assert re.fullmatch(r'[a-f0-9]{24}',ident)
            card=api('/api/supply/invoices/'+ident)
            if normNo(card.get('no'))!=normNo(doc['no']) or str(card.get('date',''))[:10]!=doc['date']:raise RuntimeError('CANDIDATE_CHANGED_DURING_READ')
            if classify(card,doc,False)=='same':record['matches'].append(minimalInvoice(card))
        found=[]
        for row in tombstones:
            if normNo(row.get('no'))!=normNo(doc['no']):continue
            if not row.get('date'):result['holds'].append({'no':doc['no'],'candidate':{'id':row['id'],'no':row.get('no')},'deleted':True,'reason':'DELETED_DATE_MISSING'});continue
            if str(row['date'])[:10]!=doc['date']:continue
            if classify(row,doc,True)=='same':found.append(row)
        result['deletedProof'][MATCHES_KEY][doc['no']]=found
    if result['holds']:
        result['deletedProof']['unknownFlags']=[h for h in result['holds'] if h['deleted']]
        raise RuntimeError('HOLD_UNKNOWN_SUPPLIER_IDENTITY_OR_DELETED_DATE')
except Exception as e:result['errors'].append(str(e) if isinstance(e,RuntimeError) else type(e).__name__)
result['finishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();result['status']='PASS' if not result['errors'] else 'HOLD_STOP'
(B/OUTPUT_NAME).write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'status':result['status'],'documents':len(result['documents']),'holds':len(result['holds']),'errors':result['errors'],'exactExisting':{k:len(v['matches']) for k,v in result['documents'].items()}}))
sys.exit(0 if result['status']=='PASS' else 1)
