import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const node=(tag,attrs,...children)=>({tag,attrs,children:children.flat().filter(Boolean),replaceChildren(...items){this.children=items.flat().filter(Boolean);}});
const plain=value=>JSON.parse(JSON.stringify(value));
const text=el=>typeof el==='string'?el:[el?.attrs?.label,...(el?.children||[]).map(text)].filter(Boolean).join(' ');
function load(file,extra={}){
 const source=readFileSync(new URL(file,import.meta.url),'utf8');
 const names=[...source.matchAll(/import\s*\{([^}]+)\}\s*from/g)].flatMap(m=>m[1].split(',').map(n=>n.trim().split(/\s+as\s+/).at(-1)));
 const context=vm.createContext({...Object.fromEntries(names.map(n=>[n,()=>null])),h:node,stack:(...children)=>node('div',null,children),hint:t=>node('p',null,t),link:attrs=>node('a',attrs,attrs.label),screenCard:x=>x,session:{canEdit:true},data:{},...extra});
 vm.runInContext(source.replace(/^import .*;\r?\n/gm,'').replace(/^export \{.*;\r?\n/gm,'').replace(/export /g,''),context);
 return{get:expr=>vm.runInContext(expr,context),context};
}
const products=()=>load('../products.js',{data:{},deepGroup:p=>p.sub||p.grp||p.sec||''}).get('products');

test('ссылка уточнения использует общий GETfilter, не landing и сохраняет series/group',()=>{
 const p=products();
 assert.equal(p.list.defaultView({needsIdentification:'1'}),'table');
 assert.equal(p.list.defaultView({}),undefined);
 assert.equal(p.list.landing.when({needsIdentification:'1'}),false);
 assert.deepEqual(plain(p.list.query({needsIdentification:'1',series:'A',grp:'g'})),{series:'A',groupId:'g',needsIdentification:'1'});
 assert.ok(p.list.filters.some(f=>f.key==='needsIdentification'));
 const body=p.list.columns.find(c=>c.key==='name').render({name:'Урна',identificationIssues:[{key:'kind',label:'Не указан вид изделия'},{key:'category',label:'Не указан тип паспорта'}]});
 assert.match(text(body),/Урна.*Не указан вид изделия.*Не указан тип паспорта/);
});

test('контекстный table главнее сохранённой gallery, явный view главнее контекста; предпочтение не переписывается',()=>{
 let P={needsIdentification:'1'},writes=0;
 const localStorage={getItem:()=> 'gallery',setItem:()=>writes++,removeItem:()=>writes++};
 const m=load('../../ui/kit/list-view.js',{localStorage});
 const view=m.get('viewStore')({...products().list},()=>P);
 assert.equal(view.st().gallery,false);
 P={needsIdentification:'1',view:'gallery'};assert.equal(view.st().gallery,true);
 P={};assert.equal(view.st().gallery,true);
 assert.equal(writes,0);
});

test('массовые поля берут живые справочники и не пропускают произвольный вид',async()=>{
 const m=load('./form-fields.js',{formValues:async()=>({sections:[],groups:[],series:[]}),staffOptions:async()=>[],
 dictRows:async key=>{assert.equal(key,'passportKinds');return[{id:'k1',name:'Урна',passportCategory:'BLG'},{id:'k2',name:'Качели',passportCategory:'UNKN'}];},passportCategoryOptions:async()=>[{value:'BLG',label:'Благоустройство'}],JOINT_OPTIONS:[]});
 const fields=await m.get('productBulkFields')();
 const kind=fields.find(f=>f.key==='pd.kindId'),cat=fields.find(f=>f.key==='pd.passportCategory');
 assert.equal(kind.map('Урна · Благоустройство'),'k1');assert.equal(kind.map('Не менять'),undefined);assert.throws(()=>kind.map('Придуманный вид'),/справочника/);
 assert.equal(cat.map('BLG'),'BLG');assert.equal(cat.map(''),undefined);
 assert.equal(kind.map('Качели'),'k2');assert.ok(kind.options.every(o=>!o.label.includes('UNKN')));
 assert.equal(kind.strict,true);assert.equal(kind.options[0].label,'Не менять');
});

test('массовый payload содержит только заданные defaults и не подменяет остальные поля',()=>{
 const m=load('./data.js',{V2_NUMS:[]});const build=m.get('productBulkSet');
 assert.deepEqual(plain(build({'pd.kindId':'k1','pd.passportCategory':undefined,group:'Урны'})),{group:'Урны',passportDefaults:{kindId:'k1'}});
 assert.deepEqual(plain(build({'pd.passportCategory':'BLG'})),{passportDefaults:{passportCategory:'BLG'}});
 assert.throws(()=>build({'pd.kindId':undefined}),/Не менять/);
});

test('Сегодня использует total того же фильтра, а не число загруженных строк',async()=>{
 const calls=[];const m=load('../home-ui.js',{api:async(path,opts)=>{calls.push({path,opts});return{items:[{}],total:312};},qty:n=>String(n),section:({title,body})=>node('section',null,title,body),busyBlock:()=>node('p',null,'Загрузка'),failBlock:e=>node('p',null,'Ошибка '+e.message)});
 const block=m.get('productIdentificationToday')();await block.load();
 assert.deepEqual(plain(calls),[{path:'/showcase',opts:{query:{needsIdentification:'1',limit:1}}}]);
 assert.match(text(block.el),/Требует уточнения: 312/);
});

test('Сегодня не подменяет сбой загрузки нулём',async()=>{
 const m=load('../home-ui.js',{api:async()=>{throw Error('недоступно');},section:({title,body})=>node('section',null,title,body),busyBlock:()=>node('p',null,'Загрузка'),failBlock:e=>node('p',null,'Ошибка '+e.message)});
 const block=m.get('productIdentificationToday')();await block.load();
 assert.match(text(block.el),/Ошибка недоступно/);assert.doesNotMatch(text(block.el),/Требует уточнения: 0/);
});


test('CAS undo показывает конкретные конфликты вместо ложного полного успеха; старый ответ совместим',()=>{
 const helper=load('../bulk-edit.js').get('bulkRestoreNotice');
 assert.equal(helper(undefined).text,'Отменено — вернули как было');
 assert.equal(helper({restored:2}).text,'Отменено — вернули как было');
 const partial=helper({restored:1,failed:[{id:'p2',message:'Изменено другим сотрудником'}]},{p2:'3508 · Урна УП-3'});
 assert.match(partial.text,/Отменено: 1.*не удалось отменить: 1/);assert.equal(partial.options.tone,'warn');
 assert.match(partial.options.sub,/3508 · Урна УП-3: Изменено другим сотрудником/);
});
