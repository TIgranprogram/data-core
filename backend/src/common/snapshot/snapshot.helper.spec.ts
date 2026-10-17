import {
  cloneImmutable,
  createInlineSnapshot,
  snapshotHash,
  snapshotMatches,
} from './snapshot.helper';

/**
 * TZ-CORE-301 — Unit spec for the snapshot-on-transition helper.
 *
 * Covers AC:
 *  1. Documented helper API + example payload (createInlineSnapshot).
 *  2. Reference transition with inline snapshot (immutability + hash).
 *  3. tsc / unit tests in the helper zone pass.
 */

describe('snapshot.helper (TZ-CORE-301)', () => {
  interface OrderItemLike {
    productId: string;
    productName: string;
    quantity: number;
    unitPrice: number;
  }

  const orderPayload = {
    number: 'ORD-1001',
    counterpartyName: 'ООО Покупатель',
    items: [
      { productId: 'p1', productName: 'Стол', quantity: 2, unitPrice: 5000 },
      { productId: 'p2', productName: 'Стул', quantity: 4, unitPrice: 1500 },
    ] as OrderItemLike[],
  };

  describe('createInlineSnapshot', () => {
    it('stores stage meta + deep immutable data', () => {
      const snap = createInlineSnapshot(orderPayload, {
        stage: 'order',
        sourceId: 'ord-1',
      });

      expect(snap._snapshot.stage).toBe('order');
      expect(snap._snapshot.sourceId).toBe('ord-1');
      expect(snap._snapshot.version).toBe(1);
      expect(snap._snapshot.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(Object.isFrozen(snap.data)).toBe(true);
      expect(Object.isFrozen(snap.data.items)).toBe(true);
      expect(snap.data.number).toBe('ORD-1001');
    });

    it('snapshot is stable against later catalog edits (immutability AC)', () => {
      const snap = createInlineSnapshot(orderPayload, { stage: 'order' });

      // Catalog edit AFTER capture must not leak into the snapshot: the data
      // is deeply frozen — writes throw in strict mode (ts-jest is strict).
      expect(() => {
        (snap.data as { number: string }).number = 'MUTATED';
      }).toThrow(TypeError);
      expect(() => {
        (snap.data as { items: OrderItemLike[] }).items[0].productName = 'Тумба';
      }).toThrow(TypeError);

      // Integrity guarantee: stored hash still matches original captured bytes
      // and rejects any divergent payload.
      expect(snapshotMatches(snap, orderPayload)).toBe(true);
      expect(snapshotMatches(snap, { ...orderPayload, number: 'MUTATED' })).toBe(false);
    });

    it('hash is deterministic and key-order independent', () => {
      const a = snapshotHash({ a: 1, b: 2 });
      const b = snapshotHash({ b: 2, a: 1 });
      expect(a).toBe(b);
    });

    it('hash detects any payload change', () => {
      const base = createInlineSnapshot(orderPayload, { stage: 'order' });
      const changed = { ...orderPayload, number: 'ORD-1002' };
      expect(snapshotMatches(base, changed)).toBe(false);
    });

    it('cloneImmutable deep-copies nested objects', () => {
      const source = { list: [{ x: 1 }], nested: { y: 2 } };
      const copy = cloneImmutable(source);
      expect(copy).toEqual(source);
      // deep-frozen: writes to nested objects throw in strict mode (ts-jest)
      expect(() => {
        (copy as { list: { x: number }[] }).list[0].x = 99;
      }).toThrow(TypeError);
      expect(source.list[0].x).toBe(1); // original untouched
      expect(Object.isFrozen(copy.list[0])).toBe(true);
    });
  });
});
