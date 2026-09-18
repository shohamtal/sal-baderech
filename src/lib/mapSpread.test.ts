import { describe, expect, it } from 'vitest';
import { offsetsForOverlapping, ringRadiusPixels } from './mapSpread';

const at = (id: string, lat: number, lng: number) => ({ id, latitude: lat, longitude: lng });

describe('offsetsForOverlapping', () => {
  it('leaves distinct markers alone', () => {
    const offsets = offsetsForOverlapping([at('a', 32.4586, 35.0449), at('b', 32.4600, 35.0460)]);
    expect(offsets.size).toBe(0);
  });

  it('gives every delivery on one street centre its own offset', () => {
    // Five deliveries on רימון, all geocoded to the same street centre.
    const same = ['a', 'b', 'c', 'd', 'e'].map((id) => at(id, 32.458639, 35.044969));
    const offsets = offsetsForOverlapping(same);
    expect(offsets.size).toBe(5);
    const distinct = new Set([...offsets.values()].map((o) => `${o.dx},${o.dy}`));
    expect(distinct.size).toBe(5);
  });

  it('separates neighbouring dots by more than a dot width', () => {
    for (const n of [2, 3, 5, 8]) {
      const same = Array.from({ length: n }, (_, i) => at(`d${i}`, 32.458639, 35.044969));
      const o = [...offsetsForOverlapping(same).values()];
      const gap = Math.hypot(o[0].dx - o[1].dx, o[0].dy - o[1].dy);
      expect(gap, `n=${n}`).toBeGreaterThan(22);
    }
  });

  it('keeps the fan compact enough to read as one street', () => {
    const same = Array.from({ length: 12 }, (_, i) => at(`d${i}`, 32.458639, 35.044969));
    for (const o of offsetsForOverlapping(same).values()) {
      expect(Math.hypot(o.dx, o.dy)).toBeLessThanOrEqual(49);
    }
  });

  it('is deterministic regardless of input order', () => {
    const same = ['c', 'a', 'b'].map((id) => at(id, 32.4586, 35.0449));
    const first = offsetsForOverlapping(same);
    const second = offsetsForOverlapping([...same].reverse());
    expect([...first.entries()].sort()).toEqual([...second.entries()].sort());
  });

  it('widens the ring as the group grows, within a cap', () => {
    expect(ringRadiusPixels(2)).toBe(18);
    expect(ringRadiusPixels(6)).toBe(30);
    expect(ringRadiusPixels(20)).toBe(48);
  });
});
