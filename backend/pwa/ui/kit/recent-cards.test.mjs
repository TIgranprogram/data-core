import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';
import { createRecentCards, recentHref, recentThumb } from '../../core/recent-cards.js';

class Element {
 constructor(tag, attrs={}, ...kids) { this.tag=tag;this.attrs=attrs||{};this.children=[];this.style={};this.classList={add(){}};this.append(...kids); }
 append(...kids) { for(const node of kids.flat(Infinity)) if(node!=null&&node!==false){this.children.push(node);if(node instanceof Element)node.parent=this;} }
 replaceChildren(...kids){this.children=[];this.append(...kids);}
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this);}
 setAttribute(k,v){this.attrs[k]=v;}
 focus(){}
 contains(node){return this===node||this.children.some(x=>x instanceof Element&&x.contains(node));}
 all(fn){return [...(fn(this)?[this]:[]),...this.children.flatMap(x=>x instanceof Element?x.all(fn):[])];}
 get textContent(){return this.children.map(x=>x.textContent??String(x)).join('');}
}
async function fixture({section='products',open='000000000000000000000001',tab,realMenu=false}={}){
 const values=new Map(),session={user:{id:'a'}},body=new Element('body');
 let route={section,params:{open,...(tab?{tab}:{})}},menu;
 const h=(tag,attrs,...kids)=>new Element(tag,attrs,...kids);
 const storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 const context=createContext({localStorage:storage,String,setTimeout:()=>0,document:{body,addEventListener(){},removeEventListener(){}},window:{matchMedia:()=>({matches:true}),addEventListener(){},removeEventListener(){}}});
 const deps={
 '../../core/api.js':{session,PREFIX:'/db'}, '../../core/router.js':{current:()=>route},
 '../../core/dom.js':{h}, '../../core/recent-cards.js':{createRecentCards,recentHref,recentThumb},
 '../icons.js':{icon:name=>h('svg',{name})}, './mark.js':{mark:x=>x},
 './pop-menu.js':{openPopMenu:opts=>{menu=opts;},closePopMenu(){},isOpenFor:()=>false},
 };
 const linked=new Map();
 const load=async name=>{
  if(linked.has(name))return linked.get(name);
  const mod=new SourceTextModule(readFileSync(new URL(name,import.meta.url),'utf8'),{context});linked.set(name,mod);
  await mod.link(key=>{
   if(realMenu&&key==='./pop-menu.js')return load(key);
   const d=deps[key];return new SyntheticModule(Object.keys(d),function(){for(const [k,v]of Object.entries(d))this.setExport(k,v);},{context});
  });return mod;
 };
 const mod=await load('./recent-cards.js');await mod.evaluate();
 return {values,session,body,storage,record:mod.namespace.recentRecorder,button:mod.namespace.recentCardsButton,route:next=>{route=next;},get menu(){return menu;},entries:()=>createRecentCards(storage,'dc-recent-cards:/db:'+session.user.id).list()};
}

test('только текущая карточка и пользователь; поздние ответы и new пропускаются',async()=>{
 const f=await fixture(),row={id:'000000000000000000000001'},record=f.record('products');
 record(row,'Изделие','Продукция');assert.equal(f.values.size,1);
 f.session.user={id:'b'};record(row,'Чужая карточка','');assert.equal(f.values.size,1);
 const next=f.record('products');f.route({section:'products',params:{open:'000000000000000000000002'}});next(row,'Устаревший ответ','');assert.equal(f.values.size,1);
 f.route({section:'products',params:{open:row.id,new:'1'}});next(row,'Новая карточка','');assert.equal(f.values.size,1);
 f.route({section:'products',params:{open:row.id}});next(row,'Своя карточка','');assert.equal(f.values.size,2);
});

test('заказ с productionNo/key и legacy id сохраняется один раз с заказчиком',async()=>{
 const key='№ 36 / 26-Б',legacy='000000000000000000000001';const f=await fixture({section:'salesorders',open:key});
 const row={id:key,key,productionNo:key,customers:['Школа № 2'],orders:[{id:legacy}]},record=f.record('salesorders');
 record(row,'Заказ '+key,'Заказ');assert.equal(f.entries()[0].id,key);assert.match(f.entries()[0].title,/Школа № 2/);
 f.route({section:'salesorders',params:{open:legacy}});record(row,'Заказ '+key,'Заказ');assert.equal(f.entries().length,1);assert.equal(f.entries()[0].id,key);
 f.route({section:'salesorders',params:{open:'другой'}});record(row,'Чужой ответ','Заказ');assert.equal(f.entries()[0].title,'Заказ '+key+' · Школа № 2');
 f.button(()=>true).attrs.onclick();
 // C102: вид — отдельной строкой (pm-rc-kind), название — без повтора вида
 const lbl=f.menu.groups[0].items[0].label;assert.equal(lbl.children[0].children[0],'Заказ');assert.equal(lbl.children[1].children[0],key+' · Школа № 2');assert.equal(f.menu.groups[0].items[0].cls,'rc-orders');
});

test('переиспользованный recorder записывает текущую вкладку и раздел, но не чужой id',async()=>{
 const f=await fixture({section:'salesorders',open:'36-26',tab:'active'}),record=f.record('salesorders');
 record({id:'36-26'},'Заказ № 36-26','Заказ');
 f.route({section:'salesorders',params:{open:'37-26',tab:'closed'}});record({id:'36-26'},'Поздний ответ','');assert.equal(f.entries().length,1);
 record({id:'37-26'},'Заказ № 37-26','Заказ');assert.equal(f.entries()[0].tab,'closed');
 f.route({section:'home',params:{open:'38-26',of:'salesorders',tab:'main'}});record({id:'38-26'},'Заказ № 38-26','Заказ');
 assert.equal(f.entries()[0].section,'home');assert.equal(f.entries()[0].tab,'main');
});

test('миниатюра из загруженной карточки; внешний thumb пропускается ради локального url',async()=>{
 const id='000000000000000000000001',f=await fixture();
 f.record('products')({id,photos:[{thumb:'https://evil.test/a.png',url:'/uploads/own.png'}]},'Изделие','');
 assert.equal(f.entries()[0].thumb,'/uploads/own.png');
 const btn=f.button(()=>true);btn.attrs.onclick();const lead=f.menu.groups[0].items[0].lead;
 assert.equal(lead.children[0].attrs.src,'/db/uploads/own.png');
 lead.children[0].attrs.onerror();assert.equal(lead.children[0].tag,'svg');assert.equal(lead.children[0].attrs.name,'stock');
});

test('реальный pop-menu: вся строка ссылка, фото без вложенной кнопки; старые записи дают значок',async()=>{
 const id='000000000000000000000001',f=await fixture({realMenu:true});
 f.record('products')({id,photos:[{thumb:'/uploads/own.webp'}]},'Длинное название '.repeat(30),'Изделие');
 createRecentCards(f.storage,'dc-recent-cards:/db:a').remember({section:'salesorders',of:'salesorders',id:'36-26',title:'Заказ 36-26'});
 f.button(()=>true).attrs.onclick();
 const links=f.body.all(x=>x.tag==='a');assert.equal(links.length,2);
 assert.equal(links[0].all(x=>x.tag==='svg')[0].attrs.name,'orders');
 assert.equal(links[1].all(x=>x.tag==='img').length,1);assert.equal(links[1].all(x=>x.tag==='button').length,0);
 assert.match(links[1].attrs.href,/#products\?open=/);
 links[1].attrs.onclick();assert.equal(f.body.all(x=>x.attrs.role==='menu').length,0);
});
