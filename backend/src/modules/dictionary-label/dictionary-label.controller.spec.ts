import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { DictionaryLabelController } from './dictionary-label.controller';
import type { DictionaryLabelService } from './dictionary-label.service';

describe('DictionaryLabelController (TZ-DICT-319)', () => {
  function controller(): DictionaryLabelController {
    return new DictionaryLabelController({} as DictionaryLabelService);
  }

  it('keeps label reads available to regular users', () => {
    const instance = controller();

    expect(Reflect.getMetadata(ROLES_KEY, instance.list)).toEqual(
      expect.arrayContaining(['admin', 'manager', 'user']),
    );
    expect(Reflect.getMetadata(ROLES_KEY, instance.active)).toEqual(
      expect.arrayContaining(['admin', 'manager', 'user']),
    );
  });

  it('limits label mutations to admin and manager', () => {
    const instance = controller();
    const roles = Reflect.getMetadata(ROLES_KEY, instance.patch);

    expect(roles).toEqual(expect.arrayContaining(['admin', 'manager']));
    expect(roles).not.toContain('user');
  });
});
