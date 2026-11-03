import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('./invoices-tab.js',import.meta.url),'utf8');
async function setup(paid=true){
 const calls=[];let captured;const context=vm.createContext({console,Promise,setTimeout});
 const h=(tag,props={},...children)=>({tag,...props,children,value:props?.value??'',events:{},addEventListener(key,fn){this.events[key]=fn}});
 const values={h,session:{canMoney:true},api:async(url,options)=>{calls.push({url,...options});return{}},openCard:(section,options,ctx)=>{captured={section,options,ctx};return{close(){}}},toastError(){}};
 const exportsByPath=new Map();for(const m of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g)){exportsByPath.set(m[2],m[1].split(',').map(x=>x.trim().split(/\s+as\s+/)[0]));}
 const mod=new vm.SourceTextModule(source+'\nexport {editLine};',{context});
 await mod.link(spec=>{const names=exportsByPath.get(spec);return new vm.SyntheticModule(names,function(){for(const name of names)this.setExport(name,values[name]??(()=>{}));},{context});});
 await mod.evaluate();await mod.namespace.editLine({id:'inv',status:paid?'paid':'issued',version:4},{id:'line',qty:3,priceHint:100,title:'Материал'},()=>{});
 const fields=captured.section.form.fields();const inputs=Object.fromEntries(fields.filter(x=>x.key).map(x=>[x.key,x.widget().el]));
 return {calls,captured,inputs};
}
const enabled=typeof vm.SourceTextModule==='function';
test('paid edit — штатная правая панель с четырьмя полями, не modal',{skip:!enabled},async()=>{const {captured,inputs}=await setup();assert.equal(Object.keys(inputs).length,4);assert.equal(captured.section.form.closeAfterCreate,true);assert.equal(captured.section.card.startEdit(),true);});
test('100 / 3 без изменения цены сохраняет исходные 100, причина обязательна',{skip:!enabled},async()=>{const {captured,inputs,calls}=await setup();assert.throws(()=>captured.section.form.toBody(),/причину/);assert.equal(calls.length,0);inputs.reason.value='Исправлены реквизиты';const body=captured.section.form.toBody();assert.equal(body.lineAmount,100);assert.equal(body.qty,3);assert.equal(body.version,4);await captured.section.form.update('line',body);assert.equal(calls.length,1);assert.equal(calls[0].body.lineAmount,100);});
test('точная сумма 101 при qty 3 не превращается в 101.01',{skip:!enabled},async()=>{const {captured,inputs}=await setup();inputs.lineAmount.value='101';inputs.lineAmount.events.input();inputs.reason.value='Корректировка';assert.equal(inputs.unitPrice.value,'33.67');assert.equal(captured.section.form.toBody().lineAmount,101);});
test('изменение количества пересчитывает сумму; отрицательные и нулевые значения запрещены',{skip:!enabled},async()=>{const {captured,inputs}=await setup(false);assert.equal(Object.keys(inputs).length,3);inputs.unitPrice.value='40';inputs.qty.value='4';inputs.qty.events.input();assert.equal(captured.section.form.toBody().lineAmount,160);inputs.qty.value='0';assert.throws(()=>captured.section.form.toBody(),/больше нуля/);inputs.qty.value='3';inputs.lineAmount.value='-1';assert.throws(()=>captured.section.form.toBody(),/отрицательной/);});
