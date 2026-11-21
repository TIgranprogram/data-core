import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'file:///D:/invSportiN/Сайт/01_Проекты_CRM/data-core/tools/design-checks/node_modules/playwright-core/index.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const out=path.join(root,'docs/crew/C174-recent-groups/evidence');fs.mkdirSync(out,{recursive:true});
const css=['tokens','base','list','form','screens','panels','kit/kit'].map(x=>`<link rel="stylesheet" href="/ui/${x}.css">`).join('');
const html=`<!doctype html><meta charset="utf-8">${css}<style>body{margin:0;padding:24px}header{display:flex;justify-content:space-between;align-items:center}main{padding-top:32px}</style><header><h1>Рабочее место · проверка истории</h1><div id="trigger"></div></header><main><h2>Заполненная история карточек</h2><p>Фикстура C174. Настоящие recentCardsButton, pop-menu и CSS приложения.</p><button id="outside" class="btn">Вне меню</button></main><script type="module">
import {recentCardsButton} from '/ui/kit/recent-cards.js';
import {createRecentCards} from '/core/recent-cards.js';
const n=Number(new URLSearchParams(location.search).get('groups'))||3;
const types=[['salesorders','Заказ','Заказ № 36/26 · Школа № 2'],['products','Изделие','Спортивный комплекс с канатной сеткой и гимнастическими кольцами'],['orderpass','Паспорта заказа','Паспорта заказа · № 36/26 · Школа № 2'],['partners','Контрагент','Муниципальная спортивная школа олимпийского резерва'],['requests','Заявка','Крепёж оцинкованный для монтажа на спортивной площадке'],['orders','Позиция заказа','Оплата оборудования по договору поставки'],['work','Работа','Изготовление и комплектация изделия'],['custom','Архив','Дополнительный тип карточки']].slice(0,n);
const store=createRecentCards(localStorage,'dc-recent-cards:/db:fixture');store.clear();
for(let row=0;row<(n===8?2:5);row++) for(let i=0;i<types.length;i++){
const [of,kind,title]=types[i];store.remember({section:of==='orderpass'?'docs':of,of,id:String(row*10+i+1).padStart(24,'0'),title:title+' · '+(row+1),kind,...(i===1?{thumb:'/uploads/'+(row===3?'broken':'fixture')+'.png'}:{})});}
document.querySelector('#trigger').append(recentCardsButton(()=>true));window.ready=true;
</script>`;
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');let text;
 if(url.pathname==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);return;}
 if(url.pathname==='/core/api.js')text="export const session={user:{id:'fixture'}};export const PREFIX='/db';";
 if(url.pathname==='/core/router.js')text='export const current=()=>({section:"products",params:{}});';
 if(url.pathname==='/db/uploads/fixture.png'){res.setHeader('Content-Type','image/svg+xml');res.end('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="white"/><path d="M15 85V20H85V85M15 40H85M50 20V85M10 85H90" fill="none" stroke="#235444" stroke-width="6"/><circle cx="30" cy="60" r="12" fill="none" stroke="#bb6f21" stroke-width="4"/></svg>');return;}
 const file=path.join(root,'backend/pwa',decodeURIComponent(url.pathname));
 if(text===undefined){if(!file.startsWith(path.join(root,'backend/pwa'))||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}text=fs.readFileSync(file);}
 res.setHeader('Content-Type',url.pathname.endsWith('.css')?'text/css':url.pathname.endsWith('.woff2')?'font/woff2':'text/javascript; charset=utf-8');res.end(text);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const results=[];
try{
 for(const width of [1920,1024])for(const theme of ['light','dark'])for(const groups of [2,3,8]){
  const page=await browser.newPage({viewport:{width,height:1080},deviceScaleFactor:1});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/?groups=${groups}`);await page.waitForFunction(()=>window.ready);
  await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
  const button=page.getByRole('button',{name:'Недавно открытые карточки'});await button.click();await page.waitForTimeout(120);
  const measure=await page.locator('.pm-recent').evaluate(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,win:window.innerWidth,doc:document.documentElement.clientWidth,cssRight:getComputedStyle(el).right,offset:el.offsetWidth,top:r.top,bottom:r.bottom,scrollWidth:el.scrollWidth,clientWidth:el.clientWidth,groups:[...el.querySelectorAll('.pm-group:not(.sep)')].map(g=>({title:g.getAttribute('aria-label'),x:g.offsetLeft,y:g.offsetTop})),focused:el.contains(document.activeElement)};});
  if(measure.left<0||measure.right>width||measure.bottom>1080||measure.scrollWidth>measure.clientWidth||!measure.focused)throw Error(JSON.stringify(measure));
  await page.screenshot({path:path.join(out,`${width}-${theme}-${groups}-groups.png`)});
  await page.keyboard.press('End');await page.keyboard.press('Home');
  await page.keyboard.press('Escape');if(await page.locator('.pm-recent').count()||!await button.evaluate(el=>el===document.activeElement))throw Error('Escape/focus');
  await button.click();await page.locator('h1').click({position:{x:5,y:5}});if(await page.locator('.pm-recent').count())throw Error('outside');
  await button.click();const href=await page.locator('.pm-recent a').first().getAttribute('href');await page.locator('.pm-recent a').first().click();if(await page.locator('.pm-recent').count()||!page.url().includes(href))throw Error('navigation');
  await button.click();await page.getByRole('menuitem',{name:'Очистить список'}).click();await button.click();if(await page.locator('.pm-recent a').count()||!await page.getByText('Здесь появятся карточки',{exact:false}).count())throw Error('clear');
  results.push({width,theme,groups,result:'PASS',measure,errors});await page.close();
 }
 const old=await browser.newPage({viewport:{width:1024,height:1080}});
 await old.goto('http://127.0.0.1:'+server.address().port+'/?groups=2');await old.waitForFunction(()=>window.ready);
 await old.evaluate(async()=>{const {openPopMenu}=await import('/ui/kit/pop-menu.js');openPopMenu({anchor:document.querySelector('#trigger button'),side:'down',groups:[{title:'Настройки',items:[{label:'Тема оформления',onSelect:()=>{}},{label:'Справка',href:'#help'}]}]});});
 const oldRect=await old.locator('.pm').evaluate(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width};});
 if(oldRect.left<0||oldRect.right>1024||oldRect.width!==264)throw Error('legacy menu geometry');
 await old.screenshot({path:path.join(out,'1024-light-legacy-menu.png')});await old.keyboard.press('Escape');
 if(await old.locator('.pm').count()||!await old.locator('#trigger button').evaluate(el=>el===document.activeElement))throw Error('legacy focus');
 await old.close();fs.writeFileSync(path.join(out,'legacy-menu.json'),JSON.stringify({result:'PASS',oldRect}));
 fs.writeFileSync(path.join(out,'matrix.json'),JSON.stringify(results,null,2));console.log(JSON.stringify({screenshots:results.length,results:results.map(({width,theme,groups,result,errors})=>({width,theme,groups,result,errors}))}));
}finally{await browser.close();server.close();}
