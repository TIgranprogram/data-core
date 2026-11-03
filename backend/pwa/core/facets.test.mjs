import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('./facets.js',import.meta.url),'utf8');
const {facetLabel,pipeParts,pipeKey}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
test('валидные ключи трубы сохраняют вид, сечение и длину',()=>{const value=pipeKey({name:'Труба профильная',assortment:'Труба 80×80×3',dims:{length:6000}});assert.deepEqual(pipeParts(value),{kind:'rect',section:'Труба 80×80×3',len:6000});assert.equal(facetLabel('pipe',value),'80×80×3 6м');assert.equal(facetLabel('pipe','steel|Труба Ø57×3,5 (нерж.)|12000'),'Ø57×3,5 12м');});
test('старое выбранное сечение без разделителей не вызывает replace у undefined',()=>{assert.equal(facetLabel('pipe','Труба 80×80×3'),'80×80×3 куски');assert.deepEqual(pipeParts('Труба 80×80×3'),{kind:'rect',section:'Труба 80×80×3',len:0});});
test('пустые и неполные значения не роняют хлебную крошку',()=>{for(const v of [undefined,null,'','rect|','rect|Труба 40×20×2|не число'])assert.doesNotThrow(()=>facetLabel('pipe',v));assert.equal(facetLabel('pipe',undefined),'Сечение не указано');assert.equal(facetLabel('pipe','rect|Труба 40×20×2|не число'),'40×20×2 куски');});
test('остальные подписи фильтров не меняются',()=>{assert.equal(facetLabel('section','Труба 80×80×3'),'80×80×3');assert.equal(facetLabel('grade','Ст3'),'Ст3');});
