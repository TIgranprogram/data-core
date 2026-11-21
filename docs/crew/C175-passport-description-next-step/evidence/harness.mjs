// C175: изолированная браузерная фикстура. Настоящие openSimpleDescription/kit/CSS;
// API справочника и сохранение — подмены. Не доказательство серверного сохранения.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../../../tools/design-checks/node_modules/playwright-core/index.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../..');
const out=path.join(root,'docs/crew/C175-passport-description-next-step/evidence');fs.mkdirSync(out,{recursive:true});
const parts=[{id:'frame',name:'каркас',genSingular:'каркаса'},{id:'post',name:'стойка',genSingular:'стойки'}];
let version=0;
const css=['tokens','base','list','form','screens','panels','kit/kit'].map(x=>`<link rel="stylesheet" href="/app/ui/${x}.css">`).join('');
const html=`<!doctype html><meta charset="utf-8">${css}<style>body{margin:0;padding:24px}main{display:flex;gap:24px;justify-content:space-between}article{flex:1}aside{width:420px;flex:none}</style><h1>Шаблон изделия · проверка C175</h1><main><article><h2>1038 · Уличный тренажёр</h2><p>Изолированная фикстура. Выбор и сохранение не затрагивают рабочие данные.</p></article><aside id="slot" class="bk-side"></aside></main><script type="module">
import {session} from '/app/core/api.js';
import {openSimpleDescription} from '/app/sections/passports/book-template-edit.js';
const params=new URLSearchParams(location.search);session.user={id:'fixture',role:params.get('role')||'director',baseRole:params.get('role')||'director'};
const template={defaults:{},document:{},passportCategory:'TRN',simpleDescriptionSuggestions:[]};
window.saves=[];const slot=document.querySelector('#slot');
const options={isCurrent:()=>true,done:()=>{window.saved=true;},save:async change=>{window.saves.push(change);Object.assign(template.defaults,change);},openDictionary:()=>{window.dictionaryClicked=true;}};
window.reopen=()=>openSimpleDescription(slot,template,options);
await window.reopen();window.ready=true;
</script>`;
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/app/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);return;}
 if(url.pathname==='/api/dicts/passportParts'){
   const empty=url.searchParams.get('empty')==='1'||req.headers.referer?.includes('empty=1');
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify({items:empty?[]:[...parts,...(version?[{id:'seat',name:'сиденье',genSingular:'сиденья'}]:[])]}));return;
 }
 const file=path.resolve(root,'backend/pwa',decodeURIComponent(url.pathname.replace(/^\/app\//,'')));
 if(!file.startsWith(path.join(root,'backend/pwa'))||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.woff2')?'font/woff2':'text/javascript; charset=utf-8');res.end(fs.readFileSync(file));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const results=[];
try {
 for(const theme of ['light','dark']){
   const page=await browser.newPage({viewport:{width:1440,height:1100}});const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e.stack);});
   await page.goto(`http://127.0.0.1:${server.address().port}/app/`);await page.waitForFunction(()=>window.ready);
   await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
   await page.screenshot({path:path.join(out,`${theme}-initial.png`),fullPage:true});
   await page.getByRole('button',{name:'Искать среди всех частей',exact:true}).click();
   const search=page.getByPlaceholder('Найдите по названию',{exact:true});await search.fill('каркас');
   await page.getByRole('option').filter({hasText:'каркас'}).click();
   await page.getByText('Изделие состоит из каркаса.',{exact:true}).waitFor();
   version=1;await page.getByRole('button',{name:'Обновить части',exact:true}).click();
   await page.getByText('Справочник обновлён. Ваш выбор и набранный текст сохранены.',{exact:true}).waitFor();
   await page.getByRole('button',{name:'Изменить текст',exact:true}).click();
   const text=page.locator('#slot textarea');await text.fill('Проверенный ручной текст.');
   await page.getByRole('button',{name:'Обновить части',exact:true}).click();
   if(await text.inputValue()!=='Проверенный ручной текст.')throw Error('lost manual text');
   await page.screenshot({path:path.join(out,`${theme}-refreshed-manual.png`),fullPage:true});
   await page.getByRole('button',{name:'Сохранить в шаблон',exact:true}).click();await page.waitForFunction(()=>window.saved);
   const save=await page.evaluate(()=>window.saves);if(save.length!==1||save[0].simpleDescription.text!=='Проверенный ручной текст.'||save[0].simpleDescription.partIds[0]!=='frame')throw Error('wrong save');
   await page.evaluate(()=>window.reopen());await page.getByText('Проверенный ручной текст.',{exact:true}).waitFor();
   const geometry=await page.locator('#slot').evaluate(el=>({scroll:el.scrollWidth,width:el.clientWidth,page:document.documentElement.scrollWidth,viewport:innerWidth}));
   if(geometry.scroll>geometry.width+1||geometry.page>geometry.viewport||errors.length)throw Error(JSON.stringify({geometry,errors}));
   results.push({theme,status:'PASS',save,geometry,errors});await page.close();
   const empty=await browser.newPage({viewport:{width:1024,height:1100}});await empty.goto(`http://127.0.0.1:${server.address().port}/app/?role=manager&empty=1`);await empty.waitForFunction(()=>window.ready);
   await empty.evaluate(t=>document.documentElement.dataset.theme=t,theme);await empty.getByText(/Попросите директора дополнить/).waitFor();
   await empty.screenshot({path:path.join(out,`${theme}-empty-manager.png`),fullPage:true});await empty.close();
 }
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify({status:'PASS',scenarios:results.length}));
} finally {await browser.close();await new Promise(r=>server.close(r));}





