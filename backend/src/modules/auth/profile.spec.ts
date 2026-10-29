import { BadRequestException, ForbiddenException, ValidationPipe } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ProfileDto } from './dto/profile.dto';
import { UserService } from '../user/user.service';

const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const validate = (body: unknown) => pipe.transform(body, { type: 'body', metatype: ProfileDto });

describe('PATCH /auth/me — профиль', () => {
  it.each([
    [{ displayName: 'Иван', phone: '+7 900 000', avatar: 'preset:saturn' }],
    [{ avatar: 'photo:507f1f77bcf86cd799439011' }],
    [{ phone: '', avatar: '' }],
    [{}],
  ])('%j проходит', async (b) => { await expect(validate(b)).resolves.toBeDefined(); });

  it.each([
    [{ role: 'admin' }], [{ username: 'x' }], [{ password: 'x' }],
    [{ displayName: 'a'.repeat(81) }], [{ phone: '1'.repeat(31) }],
    [{ avatar: 'preset:pluto' }], [{ avatar: 'photo:abc' }], [{ avatar: 'http://x' }],
  ])('%j → 400', async (b) => { await expect(validate(b)).rejects.toBeInstanceOf(BadRequestException); });

  const make = () => {
    const auth = { updateProfile: jest.fn().mockResolvedValue({ displayName: 'Иван' }) };
    return { auth, ctrl: new AuthController(auth as unknown as AuthService, {} as UserService) };
  };
  it('ключ kppd_ → 403', async () => {
    const { ctrl, auth } = make();
    await expect(ctrl.updateProfile({ id: 'u', username: 'k', role: 'admin', keyScope: { access: 'full' as const } }, { displayName: 'x' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(auth.updateProfile).not.toHaveBeenCalled();
  });
  it('JWT → пишет по id из входа', async () => {
    const { ctrl, auth } = make();
    await ctrl.updateProfile({ id: 'u1', username: 'a', role: 'user' }, { displayName: 'Иван' });
    expect(auth.updateProfile).toHaveBeenCalledWith('u1', { displayName: 'Иван' });
  });
});
