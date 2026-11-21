import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import{readFileSync}from'node:fs';
const node=(tag,attrs,...children)=>({tag,attrs,children:children.flat().filter(Boolean),replaceChildren(...c){this.children=c.flat().filter(Boolean);}});
const walk=n=>n&&typeof n==='object'?[n,...(n.children||[]).flatMap(walk)]:[];
const text=n=>typeof n==='string'?n:(n?.attrs?.label||'')+(n?.children||[]).map(text).join(' ');
function fixture(row,allowed=true){let formats=0,names=0;const ctx=vm.createContext({h:node,button:attrs=>node('button',attrs),badge:(name,tone)=>node('span',{tone},name),iconButton:attrs=>node('button',attrs),segmented:()=>{formats++;return{el:node('select'),buttons:[]};},statusOf:r=>r.status||'draft',heading:r=>'Паспорт № '+r.passportNumber,variantName:v=>v,bookVariants:[],pendingBookIssue:()=>null});
const source=readFileSync(new URL('./book-head.js',import.meta.url),'utf8').replace(/^import .+;\s*$/gm,'').replace(/export /g,'');vm.runInContext(source+'\nglobalThis.helpers={canEditBookInstance,bookEditMessage,paintBookHead};',ctx);const{canEditBookInstance,bookEditMessage,paintBookHead}=ctx.helpers;const head=node('header');
paintBookHead(head,{S:{r:row,fit:true},can:()=>canEditBookInstance(row,allowed),run:(_b,_m,fn)=>fn(),openName:()=>names++,zoom(){},requestClose(){}});return{head,can:canEditBookInstance(row,allowed),message:bookEditMessage(row,canEditBookInstance(row,allowed)),formats,names:()=>names,helper:canEditBookInstance};}
const issued={id:'p',presentationVersion:1,status:'issued',variant:'short',passportNumber:618,revision:3,name:'Старое название'};

test('issued generatedv1 редактируется, видны rename/revision, выпуск и смена варианта отсутствуют',async()=>{
 const f=fixture(issued);assert.equal(f.can,true);assert.equal(f.formats,0);const buttons=walk(f.head).filter(n=>n.tag==='button');assert.equal(buttons.some(b=>/^Выпуст/.test(b.attrs.label)),false);const rename=buttons.find(b=>b.attrs.label==='Изменить название');assert.ok(rename);await rename.attrs.onClick({currentTarget:rename});assert.equal(f.names(),1);assert.match(text(f.head),/Редакция 3/);assert.match(f.message,/новой редакцией.*Номер паспорта прежний/);
});

test('draft сохраняет выпуск и выбор варианта',()=>{const f=fixture({...issued,status:'draft'});assert.equal(f.can,true);assert.equal(f.formats,1);assert.ok(walk(f.head).some(n=>n.attrs?.label==='Выпустить'));});
for(const[row,allowed,reason]of[[{...issued,status:'annulled'},true,'annulled'],[issued,false,'readonly role'],[{...issued,printSource:'file'},true,'PDF'],[{...issued,presentationVersion:0},true,'legacy']])test(reason+' не даёт редактирование/rename/issue',()=>{const f=fixture(row,allowed);assert.equal(f.can,false);assert.equal(f.formats,0);assert.equal(walk(f.head).some(n=>n.attrs?.label==='Изменить название'||/^Выпуст/.test(n.attrs?.label||'')),false);if(reason==='PDF')assert.match(f.message,/готовый PDF.*не редактируется/);});

test('план заказа показывает «Изменить паспорт» только generated-варианту и рабочей роли',()=>{
 const source=readFileSync(new URL('../order-passport-plan.js',import.meta.url),'utf8');const start=source.indexOf("  } else if (l.state === 'issued'");const body=source.slice(source.indexOf('    const pid',start),source.indexOf('  } else if (openDraft)',start));
 for(const[allowed,variant,expected]of[[true,'short','Изменить паспорт'],[false,'short','Открыть паспорт'],[true,null,'Открыть паспорт']]){const ctx=vm.createContext({l:{passport:{id:'p',variant}},canEdit:()=>allowed,kit:{button:attrs=>attrs},action:null,after(){}});vm.runInContext(body,ctx);assert.equal(ctx.action[1].label,expected);}
});

test('видимое rename использует существующий inline Name PATCH без новых реквизитов',()=>{
 const blocks=readFileSync(new URL('./book-blocks.js',import.meta.url),'utf8'),editor=readFileSync(new URL('./book-editor.js',import.meta.url),'utf8');assert.match(blocks,/passportNamePatch\(r, v\)\), \{ fieldKey: 'name' \}/);assert.match(editor,/spec\.fieldKey === 'name'[\s\S]{0,60}openEditor\(i\)/);assert.match(blocks,/readonly: !ctx\.firms \|\| statusOf\(r\) === 'issued'/);
});

test('описание issuedshort доступно локально, draftshort не обходит partsflow',()=>{
 const source=readFileSync(new URL('./book-blocks.js',import.meta.url),'utf8');const code=source.slice(source.indexOf('  const descrSection ='),source.indexOf('  const rulesSection ='));
 for(const status of ['draft','issued']){const specs=[];const ctx=vm.createContext({plan:{descrNo:1},template:null,short:true,r:{status},t:{description:'Состав'},refs:{},ctx:{compTree:{lines:[]}},modules:[],statusOf:r=>r.status,orig:()=>null,edited:()=>false,push(){},hd:()=>null,sub:()=>null,textP:(_text,spec)=>{specs.push(spec);},fieldSpec:()=>({editable:true}),specTable:()=>[]});vm.runInContext(code+'\ndescrSection();',ctx);assert.equal(specs[0].readonly,status==='draft'?true:undefined);assert.equal(specs[0].editable,status==='issued'?true:undefined);}
});
