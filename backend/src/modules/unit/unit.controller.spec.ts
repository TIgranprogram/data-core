import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { UnitController } from './unit.controller';
import type { UnitService } from './unit.service';

describe('UnitController (TZ-DICT-317)', () => {
  function controller(): UnitController {
    return new UnitController({} as UnitService);
  }

  it('allows admin and manager to mutate units', () => {
    const instance = controller();

    for (const handler of [instance.create, instance.update, instance.remove]) {
      const roles = Reflect.getMetadata(ROLES_KEY, handler);
      expect(roles).toEqual(expect.arrayContaining(['admin', 'manager']));
      expect(roles).not.toContain('user');
    }
  });

  it('keeps unit reads available to users', () => {
    const instance = controller();

    expect(Reflect.getMetadata(ROLES_KEY, instance.list)).toEqual(
      expect.arrayContaining(['admin', 'manager', 'user']),
    );
    expect(Reflect.getMetadata(ROLES_KEY, instance.findOne)).toEqual(
      expect.arrayContaining(['admin', 'manager', 'user']),
    );
  });
});
