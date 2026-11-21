import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import{readFileSync}from'node:fs';import{KINDS,KINDS_V2}from'../../core/passport-kinds.js';
const read=f=>readFileSync(new URL(f,import.meta.url),'utf8');const strip=s=>s.replace(/^import .+;\s*$/gm,'').replace(/export /g,'');const plain=v=>JSON.parse(JSON.stringify(v));
function common(){const ctx=vm.createContext({KINDS,KINDS_V2,session:{},api:()=>{},cachedFetch:()=>{}});vm.runInContext(strip(read('./common.js'))+'\nglobalThis.subject={kinds,isRequired,imageKindAllowed,imageKindLabel,installationPlanOf};',ctx);return ctx.subject;}
const managedKinds=['foundation','holes','mounting','embedded_layout'];
const anchors={code:'ANCHORS',known:true,managedKinds,allowedKinds:['mounting'],requiredKinds:['mounting'],labels:{mounting:'Схема анкерного крепления',foundation:'Схема фундамента',holes:'Разметка ям под опоры',embedded_layout:'Схема закладных деталей'},depthApplicable:false};
const concrete={...anchors,code:'CONCRETE_POSTS',allowedKinds:['foundation'],requiredKinds:['foundation'],depthApplicable:true};

test('клиент потребляет managed/allowed/labels сервера, не выкидывает overview/размеры и rawrefs',()=>{
 const c=common();const row={installationPlan:anchors,requiredImages:['overview','foundation','holes'],images:[{kind:'foundation',photoId:'legacy'},{kind:'holes',photoId:'old'}]};const before=JSON.stringify(row.images);
 const shown=c.kinds(row);assert.equal(shown.some(([k])=>['foundation','holes','embedded_layout'].includes(k)),false);assert.equal(shown.find(([k])=>k==='mounting')[1],'Схема анкерного крепления');assert.ok(shown.some(([k])=>k==='overview'));assert.ok(shown.some(([k])=>k==='dimensions'));assert.equal(c.isRequired(row,'mounting'),true);assert.equal(c.isRequired(row,'holes'),false);assert.equal(JSON.stringify(row.images),before);
 row.installationPlan=concrete;assert.ok(c.kinds(row).some(([k])=>k==='foundation'));assert.equal(c.kinds(row).some(([k])=>k==='mounting'),false);assert.equal(c.isRequired(row,'foundation'),true);
});

test('unknown не получает foundation, остальные known obey plan без угадывания по code',()=>{
 const c=common();const row={installationPlan:{...anchors,code:null,known:false,allowedKinds:[],requiredKinds:[]},requiredImages:['overview','foundation']};assert.equal(c.kinds(row).some(([k])=>managedKinds.includes(k)),false);assert.equal(c.isRequired(row,'foundation'),false);
 row.installationPlan={...anchors,code:'OTHER_CONFIRMED',allowedKinds:['holes'],requiredKinds:['holes']};assert.equal(c.kinds(row).some(([k])=>k==='holes'),true);assert.equal(c.kinds(row).some(([k])=>k==='mounting'),false);
 assert.ok(c.kinds({requiredImages:['foundation']}).some(([k])=>k==='foundation')); // legacy snapshot без нового плана не переписываем
});

test('templateDocument переносит верхний canonical plan, также поддержан readiness plan',()=>{
 const ctx=vm.createContext({});vm.runInContext(strip(read('./book-template.js'))+'\nglobalThis.project=templateDocument;',ctx);
 const template={mode:'template',document:{},readiness:{},installationPlan:anchors};assert.equal(ctx.project(template).installationPlan,anchors);delete template.installationPlan;template.readiness.installationPlan=concrete;assert.equal(ctx.project(template).installationPlan,concrete);
});
const node=(tag,attrs,...children)=>({tag,attrs,children:children.flat().filter(Boolean),append(...xs){this.children.push(...xs)},replaceChildren(...xs){this.children=xs.flat().filter(Boolean)}});const walk=n=>n&&typeof n==='object'?[n,...(n.children||[]).flatMap(walk)]:[];const text=n=>typeof n==='string'?n:(n?.attrs?.label||'')+(n?.children||[]).map(text).join(' ');

test('focus отражает plan: без ям/Г для анкеров, unknown ведёт в настоящий chooser',()=>{
 for(const plan of [anchors,{...anchors,known:false,allowedKinds:[],requiredKinds:[]}]){const calls=[],host=node('aside');const context=vm.createContext({...common(),h:node,button:props=>node('button',props),hint:s=>node('p',null,s),setTimeout,clearTimeout});vm.runInContext(strip(read('./book-focus.js'))+'\nglobalThis.mount=mountBookFocus;',context);context.mount(host,{can:true,S:{r:{installationPlan:plan,readiness:{ready:false,missing:[{key:'img_foundation',label:'Фундамент'},{key:'img_holes',label:'Ямы'},{key:'foundationDepth',label:'Глубина Г'}]}}},openSetting:key=>calls.push(key)});assert.doesNotMatch(text(host),/Фундамент|Ямы|Глубина Г/);const button=walk(host).find(n=>n.attrs?.label===(plan.known?'Изменить способ установки':'Выбрать способ установки'));assert.ok(button);button.attrs.onClick({currentTarget:button});assert.deepEqual(calls,['installationTypeId']);}
});

test('монтаж экземпляра не переводит к шаблону изделия',async()=>{
 const calls=[];const ctx=vm.createContext({});vm.runInContext(strip(read('./book-setup.js'))+'\nglobalThis.route=bookFocusSettingOpener;',ctx);const S={template:null};const route=ctx.route({S,openInstanceInstallation:()=>calls.push('instance'),runHeadAction:async()=>calls.push('template'),editSetting:k=>calls.push(k),openDescription:()=>calls.push('description')});await route('installationTypeId');assert.deepEqual(calls,['instance']);S.template={};await route('installationTypeId');assert.deepEqual(calls,['instance','installationTypeId']);
});

test('chooser экземпляра требует явный выбор и пишет только installationTypeId',async()=>{
 let state,spec,change;const slot={};const context=vm.createContext({V2_NUMS:[],h:node,hint:s=>s,dictRows:async()=>[{id:'a',name:'На анкерах'},{id:'c',name:'Бетонирование опор'}],buildForm:fields=>{spec=fields[0];return{el:{},dirty:()=>true,focus(){}};}});vm.runInContext(strip(read('./book-template-edit.js'))+'\nsideForm=(_slot,options)=>{globalThis.state=options;};globalThis.open=openBookInstanceInstallation;',context);await context.open(slot,{status:'issued',passportCategory:'TRN',installationTypeId:'c'},{isCurrent:()=>true,save:values=>{change=values;},done(){}});state=context.state;assert.equal(state.okLabel,'Сохранить в этом паспорте');assert.match(state.leaveMessage,/В паспорте/);assert.equal(spec.required,true);assert.equal(spec.choose,true);assert.match(state.extra,/прежние данные останутся в истории/);await state.save({installationTypeId:'a'});assert.deepEqual(plain(change),{installationTypeId:'a'});
});
