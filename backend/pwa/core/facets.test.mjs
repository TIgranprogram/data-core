import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('./facets.js',import.meta.url),'utf8');
const {facetLabel,pipeParts,pipeKey}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
test('валидные ключи трубы сохраняют вид, сечение и длину',()=>{const value=pipeKey({name:'Труба профильная',assortment:'Труба 80×80×3',dims:{length:6000}});assert.deepEqual(pipeParts(value),{kind:'rect',section:'Труба 80×80×3',len:6000});assert.equal(facetLabel('pipe',value),'80×80×3 6м');assert.equal(facetLabel('pipe','steel|Труба Ø57×3,5 (нерж.)|12000'),'Ø57×3,5 12м');});
test('старое выбранное сечение без разделителей не вызывает replace у undefined',()=>{assert.equal(facetLabel('pipe','Труба 80×80×3'),'80×80×3 куски');assert.deepEqual(pipeParts('Труба 80×80×3'),{kind:'rect',section:'Труба 80×80×3',len:0});});
test('пустые и неполные значения не роняют хлебную крошку',()=>{for(const v of [undefined,null,'','rect|','rect|Труба 40×20×2|не число'])assert.doesNotThrow(()=>facetLabel('pipe',v));assert.equal(facetLabel('pipe',undefined),'Сечение не указано');assert.equal(facetLabel('pipe','rect|Труба 40×20×2|не число'),'40×20×2 куски');});
test('остальные подписи фильтров не меняются',()=>{assert.equal(facetLabel('section','Труба 80×80×3'),'80×80×3');assert.equal(facetLabel('grade','Ст3'),'Ст3');});
{
  const src=readFileSync(new URL('./facets.js',import.meta.url),'utf8');
  const {index,facetsOf}=await import('data:text/javascript;base64,'+Buffer.from(src).toString('base64'));
  test('длина из dimensions важнее разбора имени',()=>{
    const [it]=index([{name:'Болт M8х40',dims:{length:100}}]);
    assert.equal(it._f.length,'100');
    assert.equal(facetsOf('Болт M8х40').length,'40');
  });
}
{
  const src=readFileSync(new URL('./facets.js',import.meta.url),'utf8');
  const {typeGroups,typeValues,familyOf,TYPE_ALL}=await import('data:text/javascript;base64,'+Buffer.from(src).toString('base64'));
  const items=['Болт мебельный, M8х40','Болт с шестигр. головкой, M10х100','Болт с шестигр. головкой, M10х60','Шайба плоская, 8','Шайба гроверная, 8','Гайка шестигр, M8','Шуруп, 5х40','Нечто, 1'].map((name)=>({name,categoryId:'c'}));
  test('typeGroups: семейство по первому слову, полки по числу позиций, одиночные после, «Прочее» последним',()=>{
    const g=typeGroups(items);
    assert.deepEqual(g.map((x)=>x.family),['bolt','washer','nut','screw','other']);
    assert.deepEqual(g[0].types.map((t)=>[t.label,t.count]),[['Болт с шестигр. головкой',2],['Болт мебельный',1]]);
    assert.equal(g[0].count,3);
    assert.equal(familyOf('Анкерный болт с гайкой').id,'bolt');
    assert.equal(familyOf('Нечто неизвестное').id,'other');
  });
  test('typeValues: полка в group, у одиночных типов пусто, последняя «Все типы»',()=>{
    const v=typeValues(items);
    assert.equal(v.at(-1).id,TYPE_ALL);
    assert.equal(v.find((x)=>x.id==='Болт мебельный').group,'Болты и анкеры');
    assert.equal(v.find((x)=>x.id==='Гайка шестигр').group,'');
  });
}
