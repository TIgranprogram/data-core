import { Types } from 'mongoose';
import { FinancialOperationsReader } from './financial-operations-reader.service';
import * as companies from '../../common/our-companies';

describe('C159 reader: московский день и summary', () => {
  afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });
  it('19 ноября в00:30МСК уже допускает факт19ноября, хотяUTCещё18',async()=>{
    jest.useFakeTimers().setSystemTime(new Date('2026-11-18T21:30:00Z'));
    const id=new Types.ObjectId();jest.spyOn(companies,'ourCompanies').mockResolvedValue([{id,name:'Наша',full:'Наша'}]);
    const finance={operationsSource:jest.fn(async()=>[{operationId:'expense:'+id,id:String(id),date:'2026-11-19',type:'expense',amount:10,company:'Наша',source:'expense',title:'Факт',classificationVersion:0}])};
    const reader=new FinancialOperationsReader({} as never,finance as never,{docs:async()=>[]} as never,{} as never);
    const result=await reader.list({from:'2026-11-19',to:'2026-11-19'},{role:'admin',id:String(id)} as never);
    expect(result.total).toBe(1);expect(result.totals.expense).toBe(10);expect(finance.operationsSource).toHaveBeenCalledWith('2026-11-19','2026-11-19',[id],undefined);
  });
});
