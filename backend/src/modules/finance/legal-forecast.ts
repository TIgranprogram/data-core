import type { LegalBundleDto } from '../../common/legal/legal.dto';
import type { IncomeSrc } from './forecast';
/** Договорный план один раз на договор. Неизвестный триггер не превращается в просрочку. */
export function legalForecast(order:{_id:unknown;orderNo?:unknown;customer?:unknown;title?:unknown;legal?:LegalBundleDto},paid:number,company:string):IncomeSrc[]{
 const legal=order.legal;if(!legal||legal.currency!=='RUB'||legal.state!=='verified'||legal.gross===undefined)return [];
 let used=Math.max(0,Math.round(paid*100));
 return legal.paymentPlan.flatMap(stage=>{
  const amount=stage.amount!==undefined?Math.round(stage.amount*100):stage.percent!==undefined?Math.round(legal.gross!*stage.percent):0;
  const consumed=Math.min(used,amount);used-=consumed;const left=amount-consumed;if(left<=0)return [];
  let eventDate=stage.eventDate||null;
  if(stage.event==='signed')eventDate=legal.signature.state==='both'?legal.signature.signedDate||null:null;
  if(stage.event!=='fixed'&&!eventDate)return [];
  let due=stage.dueDate||null;
  if(!due&&eventDate&&stage.dayType!=='business'){const at=new Date(eventDate+'T00:00:00Z');at.setUTCDate(at.getUTCDate()+(stage.offsetDays||0));due=at.toISOString().slice(0,10);}
  if(!due)return [];
  return [{id:'contract:'+String(order._id)+':'+stage.uid,title:[String(order.title||order.orderNo||''),stage.label].filter(Boolean).join(' · '),amount:left/100,company,orderNo:order.orderNo?String(order.orderNo):undefined,customer:order.customer?String(order.customer):undefined,due}];
 });
}
