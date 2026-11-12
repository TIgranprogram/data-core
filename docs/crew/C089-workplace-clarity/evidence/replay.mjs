import { chromium } from '../../../../tools/design-checks/node_modules/playwright-core/index.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd(), out=path.join(root,'docs/crew/C089-workplace-clarity/evidence'), data=path.join(root,'tools/logs/c089-ui-data');
const read=async n=>JSON.parse(await fs.readFile(path.join(data,n),'utf8'));
const manifest=await read('manifest.json'), product=await read('product.json'), photos=await read('photos.json');
const api=new Map(); for(const r of manifest.items) api.set(new URL(r.path,'http://x').pathname,await read(r.file));
const media=new Map(); for(const ph of photos) {const f=ph.kind==='foundation'?'obrazec-foundation.png':'obrazec-dimensions.png';for(const u of [ph.photoId?.storageUrl,...Object.values(ph.photoId?.variants||{}).map(v=>v.storageUrl)])if(u)media.set(u,f);}
const css=['tokens','base','list','form','screens','panels','kit/kit','kit/timeline','kit/stage-bar'];
const html=`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${css.map(f=>`<link rel="stylesheet" href="/app/ui/${f}.css">`).join('')}</head><body><div class="shell"><aside class="sidebar">Replay C089</aside><main class="main"><header class="topbar">Документация · изолированная проверка</header><div class="page" id="list"></div></main></div><script type="module">
import {h} from '/app/core/dom.js';
import {session} from '/app/core/api.js';
import {openCard} from '/app/ui/kit/card.js';
import {passportFill} from '/app/sections/passports/fill/index.js';
import {startPrefs,livePref} from '/app/core/prefs.js';
import {card,tileGrid} from '/app/ui/kit/index.js';
session.user={role:'admin',username:'replay'};startPrefs(null);
window.livePref=livePref;
const prod=${JSON.stringify(product)};
document.querySelector('#list').append(tileGrid(...Array.from({length:9},()=>card({size:'M',title:prod.name,meta:'Контроль основной области'}))));
window.render=async mode=>{ document.querySelector('.drawer')?.remove();document.querySelector('.drawer-back')?.remove();
openCard({title:'Паспорт',newTitle:'Паспорт изделия · replay',form:{build:async()=>{const f=await passportFill({prod:structuredClone(prod),mode});window.ready=true;return f;}}},{mode:'create'}, {close(){},changed(){}});
};window.render('template');
</script></body></html>`;
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const context=await browser.newContext({viewport:{width:1600,height:1000},serviceWorkers:'block'});
const errors=[], blocked=[], unknown=[];
await context.route('**/*',async route=>{const req=route.request(), u=new URL(req.url());if(!['GET','HEAD'].includes(req.method())){blocked.push({method:req.method(),path:u.pathname});return route.fulfill({status:403,contentType:'application/json',body:'{"message":"Replay: запись запрещена"}'});}if(u.hostname!=='c089.test')return route.abort();
if(u.pathname==='/app/')return route.fulfill({contentType:'text/html',body:html});
if(u.pathname.startsWith('/api/')){const body=api.get(u.pathname);if(!body)unknown.push(u.pathname);return route.fulfill({status:body?200:404,contentType:'application/json',body:JSON.stringify(body||{message:'Нет ответа replay'})});}
if(media.has(u.pathname))return route.fulfill({contentType:'image/png',body:await fs.readFile(path.join(data,media.get(u.pathname)))});
if(u.pathname.startsWith('/app/')){const p=path.resolve(root,'backend/pwa',u.pathname.slice(5));if(!p.startsWith(path.resolve(root,'backend/pwa')+path.sep))return route.abort();try{return route.fulfill({contentType:p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':'application/octet-stream',body:await fs.readFile(p)});}catch{}}
unknown.push(u.pathname);return route.fulfill({status:404,body:''});});
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto('http://c089.test/app/');await page.waitForFunction(()=>window.ready,{timeout:20000});await page.waitForTimeout(600);
await page.getByText(/^Габариты:.*✎$/).click();
const rows=[];
for(const theme of ['light','dark'])for(const width of [390,1024,1600,1920])for(const panel of [420,600,760]){
 await page.setViewportSize({width,height:1000});await page.evaluate(({theme,panel})=>{document.documentElement.dataset.theme=theme;window.livePref('detailW',panel);},{theme,panel});await page.waitForTimeout(60);
 const g=await page.evaluate(()=>{const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};const d=document.querySelector('.drawer'),b=d.querySelector('.drawer-body'),group=[...d.querySelectorAll('.k-sec')].find(e=>e.textContent.includes('Габариты и виды')),rel=group?.querySelector('.k-related'),kids=[...(rel?.children||[])].filter(e=>!e.hidden),main=document.querySelector('.main');b.scrollTop=b.scrollHeight;const foot=rect(d.querySelector('.drawer-foot'));return{drawer:rect(d),main:rect(main),body:{width:b.clientWidth,scrollWidth:b.scrollWidth,height:b.clientHeight,scrollHeight:b.scrollHeight},groups:kids.map(rect),beside:kids.length===2&&Math.abs(kids[0].getBoundingClientRect().y-kids[1].getBoundingClientRect().y)<2,docOverflow:document.documentElement.scrollWidth>innerWidth+1,footReachable:foot.bottom<=innerHeight+1,emptyGroups:[...d.querySelectorAll('.k-related')].filter(r=>[...r.children].some(c=>c.hidden)).length};});
 rows.push({theme,width,panel,...g});
 if((theme==='light'&&width===1600&&panel===760)||(theme==='dark'&&width===1024&&panel===600)||(theme==='light'&&width===390&&panel===420)){
 await page.evaluate(()=>{const b=document.querySelector('.drawer-body'),g=[...b.querySelectorAll('.k-sec')].find(e=>e.textContent.includes('Габариты и виды'));b.scrollTop+=g.getBoundingClientRect().top-b.getBoundingClientRect().top-12;});await page.screenshot({path:path.join(out,`${theme}-${width}-${panel}.png`)});
 }
}
await page.setViewportSize({width:1600,height:1000});
const thresholds=[];for(const width of [560,570,580,590,600]){await page.evaluate(w=>window.livePref('detailW',w),width);await page.waitForTimeout(30);thresholds.push(await page.evaluate(()=>{const g=[...document.querySelectorAll('.k-sec')].find(e=>e.textContent.includes('Габариты и виды')).querySelector('.k-related');const a=g.children[0].getBoundingClientRect(),b=g.children[1].getBoundingClientRect();return{panel:document.querySelector('.drawer').getBoundingClientRect().width,inner:g.clientWidth,beside:Math.abs(a.y-b.y)<2};}));}
await page.evaluate(()=>window.livePref('detailW',600));const handle=page.locator('.drawer > .resizer');const hb=await handle.boundingBox();await page.mouse.move(hb.x+4,hb.y+200);await page.mouse.down();await page.mouse.move(hb.x-156,hb.y+200,{steps:12});await page.mouse.up();await page.waitForTimeout(60);const drag=await page.locator('.drawer').evaluate(e=>e.getBoundingClientRect().width);
await page.evaluate(()=>{window.ready=false;window.render('issue');});await page.waitForFunction(()=>window.ready);await page.waitForTimeout(200);
const issue=await page.evaluate(()=>({visibleSlots:[...document.querySelectorAll('.pp-slot')].filter(e=>e.getClientRects().length).length,hiddenGroups:[...document.querySelectorAll('.k-related > [hidden]')].length,text:document.querySelector('.drawer-body').innerText.slice(0,500)}));
await fs.writeFile(path.join(out,'geometry.json'),JSON.stringify({source:'API replay; actual passportFill/openCard/CSS; all writes blocked; overview uses marked sample dimensions bitmap',rows,thresholds,drag,issue,errors,blocked,unknown},null,2));
console.log(JSON.stringify({rows:rows.length,overflows:rows.filter(r=>r.docOverflow||r.body.scrollWidth>r.body.width+1).map(r=>[r.width,r.panel]),beside:rows.filter(r=>r.theme==='light').map(r=>[r.width,r.panel,Math.round(r.drawer.width),r.beside]),foot:rows.every(r=>r.footReachable),thresholds,drag,errors,blocked,unknown,issue}));await browser.close();
