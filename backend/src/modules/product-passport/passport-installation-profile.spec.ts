import { installationProfile, imageKindAllowed, reconcileInstallationRules } from './passport-variants';
import { imageRules } from './passport-rules';
import { collectTraits } from './passport-traits';
import { importInstallationKind } from './passport-import.service';

describe('C179: применимость монтажа по стабильному коду', () => {
  it.each(['ANCHORS','CONCRETE_POSTS','EMBEDDED','ON_SURFACE','FREESTANDING','LAID','FENCE_POSTS'])('%s имеет отдельный известный профиль', code => {
    const p = installationProfile({ code }); expect(p.known).toBe(true); expect(p.code).toBe(code);
    expect(p.thirdImportKind).not.toBeNull();
  });
  it('анкеры подавляют legacy ямы/фундамент и ложный concrete trait', () => {
    const install = { code: 'ANCHORS', name: 'Анкеры на бетон', traits: 'concrete,anchors', requiredImages: 'foundation\nholes' };
    const plan = installationProfile(install), ctx = { installationPlan: plan, install: plan.kind };
    expect(imageRules({}, { requiredImages: 'foundation\nholes' }, ctx).required).toEqual(['overview','mounting']);
    for (const kind of ['foundation','holes','embedded_layout']) expect(imageKindAllowed(kind, ctx)).toBe(false);
    const traits = collectTraits(['solid'], { elements: [], materials: [], install }, 'BLG');
    expect(traits.traits).toContain('anchors'); expect(traits.traits).not.toContain('concrete');
    expect(plan.depthApplicable).toBe(false);
  });
  it('ямы у concrete только по явному конфигу; закладные отдельны', () => {
    expect(installationProfile({ code: 'CONCRETE_POSTS' }).requiredKinds).toEqual(['foundation']);
    expect(installationProfile({ code: 'CONCRETE_POSTS', requiredImages: 'holes' }).requiredKinds).toEqual(['foundation','holes']);
    expect(installationProfile({ code: 'EMBEDDED', requiredImages: 'embedded_layout' })).toMatchObject({ kind: 'embedded', depthApplicable: false, requiredKinds: ['foundation','embedded_layout'], traits: [] });
  });
  it('unknown не выводит способ из названия/категории и блокирует импорт', () => {
    for (const code of ['', 'FUTURE']) expect(installationProfile({ code }).known).toBe(false);
    expect(installationProfile({ code: 'FUTURE' }).allowedKinds).toEqual([]);
    expect(() => importInstallationKind({ passportCategory: 'TRN' }, [])).toThrow('Выберите способ установки');
  });
});

it('C179 legacy policy: managed требования заменяются вместе, немонтажные сохраняются', () => {
  expect(reconcileInstallationRules({ requiredImages: ['overview','foundation','holes'], imageSlots: ['overview','holes','assembly'] }, installationProfile({ code: 'ANCHORS' }))).toEqual({ required: ['overview','mounting'], slots: ['overview','assembly','mounting'] });
});
