import { legalForecast } from './legal-forecast';
const legal:any={state:'verified',currency:'RUB',gross:1000,signature:{state:'both',signedDate:'2026-11-20'},paymentPlan:[{uid:'pre',label:'Аванс',amount:700,currency:'RUB',event:'signed',offsetDays:3,dayType:'calendar'},{uid:'rest',label:'Монтаж',amount:300,currency:'RUB',event:'installation_completed'}]};
describe('C164 событийный план',()=>{
 it('неподтверждённыйчерновик/подписьне даёт ложнуюпросрочку',()=>{expect(legalForecast({_id:'x',legal:{...legal,state:'draft'}},0,'ССЮ')).toEqual([]);expect(legalForecast({_id:'x',legal:{...legal,signature:{state:'unknown'}}},0,'ССЮ')).toEqual([]);});
 it('подтверждённоесобытие даётодинэтапнадоговор, монтажневыдуман',()=>{expect(legalForecast({_id:'x',legal},0,'ССЮ')).toEqual([expect.objectContaining({id:'contract:x:pre',amount:700,due:'2026-11-23'})]);});
 it('настоящиеавансыуменьшаютостаток, а не появляютсявторымдоходом',()=>{expect(legalForecast({_id:'x',legal},500,'ССЮ')[0].amount).toBe(200);expect(legalForecast({_id:'x',legal},700,'ССЮ')).toEqual([]);});
 it('валютныйисточникбезрублёвогоучётногокурсане становитсяRUBпрогнозом',()=>{expect(legalForecast({_id:'x',legal:{...legal,currency:'USD'}},0,'ССЮ')).toEqual([]);});
 it('бизнесднибезкалендаряне вычисляются какбудни',()=>{expect(legalForecast({_id:'x',legal:{...legal,paymentPlan:[{...legal.paymentPlan[0],dayType:'business'}]}},0,'ССЮ')).toEqual([]);});
});
