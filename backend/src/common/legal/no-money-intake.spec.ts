import { ForbiddenException } from '@nestjs/common';
import { of } from 'rxjs';
import { MoneyMaskInterceptor } from '../interceptors/money-mask.interceptor';

/** Даже если внешний role guard уже пропустил запрос, source не может молча стать legacy. */
describe('C164 — денежный источник не теряется при входной маске', () => {
 it.each(['initialLegal','sourceLine','intakeUid'])('отклоняет %s до вызова обработчика и не вырезает источник', (field) => {
  const request={user:{role:'user'},method:'POST',url:'/api/salesorders',body:{[field]:{source:'private'}}};
  const context={switchToHttp:()=>({getRequest:()=>request})} as any;
  const next={handle:jest.fn(()=>of({created:true}))};
  expect(()=>new MoneyMaskInterceptor().intercept(context,next)).toThrow(ForbiddenException);
  expect(next.handle).not.toHaveBeenCalled();expect(request.body).toHaveProperty(field);
 });
});
