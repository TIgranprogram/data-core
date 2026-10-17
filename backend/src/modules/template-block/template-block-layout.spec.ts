import {
  clampLayoutDelta,
  defaultBlockLayout,
  legacyOverlayToLayout,
  normalizeBlockLayout,
} from './template-block-layout';

describe('template-block-layout', () => {
  it('clamps normalized layout to the page bounds', () => {
    expect(
      normalizeBlockLayout({ page: 0.5, x: 0.9, y: 0.95, width: 0.4, height: 0.2, zIndex: -2 }),
    ).toEqual({
      page: 1,
      x: 0.6,
      y: 0.8,
      width: 0.4,
      height: 0.2,
      zIndex: 0,
      rotation: 0,
    });
  });

  it('converts legacy overlay pixels to normalized geometry', () => {
    expect(
      legacyOverlayToLayout(
        { overlay: true, overlayLeft: 100, overlayTop: 50, imageWidth: 200, imageHeight: 100 },
        1000,
        1000,
      ),
    ).toEqual({
      page: 1,
      x: 0.1,
      y: 0.05,
      width: 0.2,
      height: 0.1,
      zIndex: 20,
      rotation: 0,
    });
  });

  it('does not migrate non-overlay blocks', () => {
    expect(legacyOverlayToLayout({ overlay: false }, 1000, 1000)).toBeNull();
  });

  it('clamps one delta against the selected group bounds', () => {
    const result = clampLayoutDelta(
      [
        { page: 1, x: 0.1, y: 0.2, width: 0.2, height: 0.2, zIndex: 1, rotation: 0 },
        { page: 1, x: 0.6, y: 0.4, width: 0.3, height: 0.2, zIndex: 1, rotation: 0 },
      ],
      0.5,
      -0.5,
    );
    expect(result.dx).toBeCloseTo(0.1, 10);
    expect(result.dy).toBeCloseTo(-0.2, 10);
  });

  it('keeps the normalized renderer contract on one page', () => {
    expect(normalizeBlockLayout({ page: 4 }).page).toBe(1);
  });

  it('allows studio pages up to maxPage', () => {
    expect(normalizeBlockLayout({ page: 3 }, { maxPage: 5 }).page).toBe(3);
  });

  it('keeps unsupported pages visible to the DTO/service boundary', () => {
    expect(normalizeBlockLayout({ page: 2 }).page).toBe(1);
  });

  it('creates deterministic placement for new blocks', () => {
    expect(defaultBlockLayout(0)).toEqual({
      page: 1,
      x: 0.08,
      y: 0.04,
      width: 0.84,
      height: 0.12,
      zIndex: 1,
      rotation: 0,
    });
  });
});

/**
 * FE/BE parity inventory (TZ-DOC-STUDIO-101 Wave 1).
 * Golden outputs must match `frontend/src/app/shared/template-block/template-block-layout.ts`.
 * Do NOT merge implementations here — Wave 2a/3 controlled extract.
 */
describe('FE/BE normalizeBlockLayout parity fixtures', () => {
  const parityCases: Array<{
    label: string;
    input: Parameters<typeof normalizeBlockLayout>[0];
    expected: ReturnType<typeof normalizeBlockLayout>;
  }> = [
    {
      label: 'empty partial → defaults',
      input: {},
      expected: { page: 1, x: 0, y: 0, width: 1, zIndex: 1, rotation: 0 },
    },
    {
      label: 'page clamp (page>1 → 1)',
      input: { page: 3, x: 0.1, y: 0.2, width: 0.5, height: 0.3, zIndex: 2 },
      expected: {
        page: 1,
        x: 0.1,
        y: 0.2,
        width: 0.5,
        height: 0.3,
        zIndex: 2,
        rotation: 0,
      },
    },
    {
      label: 'page clamp (page<1 → 1)',
      input: { page: 0, x: 0, y: 0, width: 1 },
      expected: { page: 1, x: 0, y: 0, width: 1, zIndex: 1, rotation: 0 },
    },
    {
      label: 'x/width edge clamp',
      input: { page: 1, x: 0.95, y: 0, width: 0.2, height: 0.1, zIndex: 1 },
      expected: {
        page: 1,
        x: 0.8,
        y: 0,
        width: 0.2,
        height: 0.1,
        zIndex: 1,
        rotation: 0,
      },
    },
    {
      label: 'y/height edge clamp',
      input: { page: 1, x: 0, y: 0.95, width: 0.5, height: 0.2, zIndex: 1 },
      expected: {
        page: 1,
        x: 0,
        y: 0.8,
        width: 0.5,
        height: 0.2,
        zIndex: 1,
        rotation: 0,
      },
    },
    {
      label: 'optional height omitted',
      input: { page: 1, x: 0.2, y: 0.3, width: 0.4, zIndex: 5, rotation: 15 },
      expected: { page: 1, x: 0.2, y: 0.3, width: 0.4, zIndex: 5, rotation: 15 },
    },
    {
      label: 'legacy overlay px → normalized',
      input: legacyOverlayToLayout(
        { overlay: true, overlayLeft: 50, overlayTop: 100, imageWidth: 400, imageHeight: 200, zIndex: 3 },
        800,
        1600,
      )!,
      expected: {
        page: 1,
        x: 0.0625,
        y: 0.0625,
        width: 0.5,
        height: 0.125,
        zIndex: 3,
        rotation: 0,
      },
    },
  ];

  it.each(parityCases)('$label', ({ input, expected }) => {
    expect(normalizeBlockLayout(input)).toEqual(expected);
  });

  it('clampLayoutDelta parity: group shift against page bounds', () => {
    expect(
      clampLayoutDelta(
        [
          { page: 1, x: 0.05, y: 0.1, width: 0.3, height: 0.2, zIndex: 1, rotation: 0 },
          { page: 1, x: 0.55, y: 0.3, width: 0.35, height: 0.25, zIndex: 2, rotation: 0 },
        ],
        -0.2,
        0.8,
      ),
    ).toEqual({ dx: -0.05, dy: expect.closeTo(0.45, 10) });
  });
});
