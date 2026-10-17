/**
 * TZ-DOC-STUDIO-101 — FE/BE layout parity inventory.
 *
 * Canonical implementations:
 * - BE: backend/src/modules/template-block/template-block-layout.ts
 * - FE: frontend/src/app/shared/template-block/template-block-layout.ts
 *
 * Known intentional drift (Wave 1 — do NOT merge):
 * - FE only: computeLayerOrder (layer panel UX)
 * - Comments differ; normalizeBlockLayout logic is aligned on page clamp + bounds
 *
 * Gate: shared vectors below must produce identical JSON on both sides.
 */

import {
  clampLayoutDelta,
  defaultBlockLayout,
  legacyOverlayToLayout,
  normalizeBlockLayout,
} from './template-block-layout';

/** Vectors mirrored in frontend template-block-layout.spec.ts */
export const LAYOUT_PARITY_VECTORS: Array<{
  name: string;
  fn: 'normalize' | 'legacy' | 'clamp' | 'default';
  input: unknown;
  paper?: [number, number];
  expected: unknown;
}> = [
  {
    name: 'normalize bounds clamp',
    fn: 'normalize',
    input: { page: 0.5, x: 0.9, y: 0.95, width: 0.4, height: 0.2, zIndex: -2 },
    expected: {
      page: 1,
      x: 0.6,
      y: 0.8,
      width: 0.4,
      height: 0.2,
      zIndex: 0,
      rotation: 0,
    },
  },
  {
    name: 'page>1 clamped to 1',
    fn: 'normalize',
    input: { page: 4 },
    expected: { page: 1, x: 0, y: 0, width: 1, zIndex: 1, rotation: 0 },
  },
  {
    name: 'legacy overlay pixels',
    fn: 'legacy',
    input: {
      settings: {
        overlay: true,
        overlayLeft: 100,
        overlayTop: 50,
        imageWidth: 200,
        imageHeight: 100,
      },
      paper: [1000, 1000] as [number, number],
    },
    expected: {
      page: 1,
      x: 0.1,
      y: 0.05,
      width: 0.2,
      height: 0.1,
      zIndex: 20,
      rotation: 0,
    },
  },
  {
    name: 'default block row 0',
    fn: 'default',
    input: 0,
    expected: {
      page: 1,
      x: 0.08,
      y: 0.04,
      width: 0.84,
      height: 0.12,
      zIndex: 1,
      rotation: 0,
    },
  },
];

describe('template-block-layout parity inventory (TZ-DOC-STUDIO-101)', () => {
  for (const vector of LAYOUT_PARITY_VECTORS) {
    it(vector.name, () => {
      switch (vector.fn) {
        case 'normalize':
          expect(normalizeBlockLayout(vector.input as Parameters<typeof normalizeBlockLayout>[0])).toEqual(
            vector.expected,
          );
          break;
        case 'legacy': {
          const payload = vector.input as {
            settings: Parameters<typeof legacyOverlayToLayout>[0];
            paper: [number, number];
          };
          expect(
            legacyOverlayToLayout(payload.settings, payload.paper[0], payload.paper[1]),
          ).toEqual(vector.expected);
          break;
        }
        case 'clamp': {
          const payload = vector.input as {
            layouts: Parameters<typeof clampLayoutDelta>[0];
            dx: number;
            dy: number;
          };
          expect(clampLayoutDelta(payload.layouts, payload.dx, payload.dy)).toEqual(vector.expected);
          break;
        }
        case 'default':
          expect(defaultBlockLayout(vector.input as number)).toEqual(vector.expected);
          break;
      }
    });
  }

  it('clamp delta group bounds (shared with FE spec)', () => {
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
});
