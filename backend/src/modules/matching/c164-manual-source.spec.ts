import { Types } from 'mongoose';
import { MatchingService } from './matching.service';
describe('C164: ручной источник не запускает auto design через none/bulk',()=>{
 const orderId=new Types.ObjectId(),lineId=new Types.ObjectId();
 const run=async(manualPicked:boolean,manualSibling:boolean)=>{
  const row={_id:lineId,orderId,title:'Строка',...(manualPicked?{matchingMode:'manual'}:{})};
  const collection={find:jest.fn((q:any)=>({toArray:async()=>q.matchingMode?(manualSibling?[{orderId,matchingMode:'manual'}]:[]):[row]})),updateOne:jest.fn(async()=>({matchedCount:1}))};
  const design={autoFromOrderIfReady:jest.fn(async()=>({}))};const audit={log:jest.fn(async()=>({}))};
  const service=new MatchingService({db:{collection:()=>collection}} as any,{} as any,audit as any,undefined,design as any);
  await service.none(String(lineId));return {design,collection};
 };
 it('none для manual строки сохраняет matching, проектирование0',async()=>{const {design,collection}=await run(true,false);expect(collection.updateOne).toHaveBeenCalled();expect(design.autoFromOrderIfReady).not.toHaveBeenCalled();});
 it('legacy строка в смешанном договоре с manual источником не запускает проектирование',async()=>{expect((await run(false,true)).design.autoFromOrderIfReady).not.toHaveBeenCalled();});
 it('чистый legacy договор сохраняет прежний авто режим',async()=>{expect((await run(false,false)).design.autoFromOrderIfReady).toHaveBeenCalledWith(String(orderId),undefined);});
});
