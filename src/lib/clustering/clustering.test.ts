import { describe, expect, it } from 'vitest';
import { findDeliveryClusters, normalizeStreet, parseHouseNumber, type ClusterInput } from './clustering';

const d = (id: string, street: string, houseNumber: string, lat?: number, lng?: number): ClusterInput => ({
  id,
  street,
  houseNumber,
  latitude: lat ?? null,
  longitude: lng ?? null,
});

// ~0.00009° latitude ≈ 10 m. Herzl runs "north" with house numbers.
const herzl = (id: string, num: number) => d(id, 'הרצל', String(num), 32.06 + num * 0.00009, 34.77);

describe('normalizeStreet / parseHouseNumber', () => {
  it('normalizes prefixes, punctuation and spacing', () => {
    expect(normalizeStreet("רח' הרצל")).toBe('הרצל');
    expect(normalizeStreet('רחוב  הרצל ')).toBe('הרצל');
    expect(normalizeStreet('Main St.')).toBe('main st');
  });
  it('parses leading numbers', () => {
    expect(parseHouseNumber('12א')).toBe(12);
    expect(parseHouseNumber(' 7/3')).toBe(7);
    expect(parseHouseNumber('')).toBeNull();
  });
});

describe('findDeliveryClusters', () => {
  it('picks the tightest same-street run (spec §23)', () => {
    const avail = [10, 12, 14, 18, 21].map((n) => herzl(`h${n}`, n));
    const [best] = findDeliveryClusters(avail, 4);
    expect(best.size).toBe(4);
    expect([...best.deliveryIds].sort()).toEqual(['h10', 'h12', 'h14', 'h18']);
    expect(best.sameStreet).toBe(true);
  });

  it('works with house numbers only when coordinates are missing', () => {
    const avail = [10, 12, 14, 18, 21, 80, 84].map((n) => d(`h${n}`, 'Main Street', String(n)));
    const [best] = findDeliveryClusters(avail, 4);
    expect([...best.deliveryIds].sort()).toEqual(['h10', 'h12', 'h14', 'h18']);
    expect(best.withoutCoords).toBe(4);
    expect(best.radiusMeters).toBeNull();
  });

  it('combines nearby streets when one street is not enough (spec §24)', () => {
    const avail = [
      d('a10', 'Street A', '10', 32.0600, 34.7700),
      d('a12', 'Street A', '12', 32.0601, 34.7700),
      d('a14', 'Street A', '14', 32.0602, 34.7700),
      d('b7', 'Street B', '7', 32.0601, 34.7703),
      d('b9', 'Street B', '9', 32.0602, 34.7703),
      d('c1', 'Far Street', '1', 32.1200, 34.8500),
      d('c2', 'Far Street', '2', 32.1201, 34.8500),
    ];
    const [best] = findDeliveryClusters(avail, 5);
    expect(best.size).toBe(5);
    expect([...best.deliveryIds].sort()).toEqual(['a10', 'a12', 'a14', 'b7', 'b9']);
    expect(best.streets).toEqual(['Street A', 'Street B']);
    expect(best.radiusMeters).toBeLessThan(100);
  });

  it('prefers geographically close clusters over scattered ones', () => {
    const avail: ClusterInput[] = [];
    // Dense block downtown
    for (let i = 0; i < 6; i++) avail.push(d(`dense${i}`, 'Dense', String(i * 2), 32.07 + i * 0.0001, 34.78));
    // Scattered singles across the city
    for (let i = 0; i < 6; i++) avail.push(d(`far${i}`, `Far ${i}`, '1', 32.0 + i * 0.02, 34.7 + i * 0.02));
    const [best] = findDeliveryClusters(avail, 6);
    expect(best.deliveryIds.every((id) => id.startsWith('dense'))).toBe(true);
  });

  it('honours different requested sizes', () => {
    const avail = Array.from({ length: 30 }, (_, i) => herzl(`h${i}`, i * 2));
    for (const size of [4, 5, 6, 7, 8]) {
      const [best] = findDeliveryClusters(avail, size);
      expect(best.size).toBe(size);
    }
  });

  it('returns the best available combination when remaining deliveries are sparse (spec §25)', () => {
    const avail = [
      d('x', 'A', '1', 32.0, 34.7),
      d('y', 'B', '5', 32.05, 34.75),
      d('z', 'C', '9', 32.1, 34.8),
    ];
    const res = findDeliveryClusters(avail, 5);
    expect(res).toHaveLength(1);
    expect(res[0].size).toBe(3);
    expect([...res[0].deliveryIds].sort()).toEqual(['x', 'y', 'z']);
  });

  it('handles mixed coordinates / missing coordinates on the same street', () => {
    const avail = [
      herzl('h10', 10),
      d('h12', 'הרצל', '12'), // no coords
      herzl('h14', 14),
      d('h16', "רח' הרצל", '16'), // prefix + no coords
      d('far', 'אלנבי', '100', 32.2, 34.9),
    ];
    const [best] = findDeliveryClusters(avail, 4);
    expect([...best.deliveryIds].sort()).toEqual(['h10', 'h12', 'h14', 'h16']);
    expect(best.withoutCoords).toBe(2);
  });

  it('returns disjoint alternatives when possible', () => {
    const avail = [
      ...[10, 12, 14, 16].map((n) => herzl(`h${n}`, n)),
      ...[1, 3, 5, 7].map((n) => d(`a${n}`, 'אלנבי', String(n), 32.1 + n * 0.0001, 34.8)),
      ...[2, 4, 6, 8].map((n) => d(`d${n}`, 'דיזנגוף', String(n), 32.2 + n * 0.0001, 34.9)),
    ];
    const res = findDeliveryClusters(avail, 4);
    expect(res).toHaveLength(3);
    const all = res.flatMap((r) => r.deliveryIds);
    expect(new Set(all).size).toBe(all.length);
    res.forEach((r) => expect(r.sameStreet).toBe(true));
  });

  it('never mixes neighbourhoods when no coordinates exist (real-list shape)', () => {
    // Real distribution lists carry a neighbourhood and no coordinates at all.
    const avail: ClusterInput[] = [
      { id: 'a1', street: 'אודם', houseNumber: '7', neighborhood: 'אבני חן' },
      { id: 'a2', street: 'אודם', houseNumber: '9', neighborhood: 'אבני חן' },
      { id: 'a3', street: 'ברקת', houseNumber: '6', neighborhood: 'אבני חן' },
      { id: 'b1', street: 'אורן', houseNumber: '34', neighborhood: 'חורש' },
      { id: 'b2', street: 'אורן', houseNumber: '42', neighborhood: 'חורש' },
      { id: 'b3', street: 'אלה', houseNumber: '6', neighborhood: 'חורש' },
    ];
    const [best] = findDeliveryClusters(avail, 3);
    expect(best.neighborhoods).toHaveLength(1);
    expect(new Set(best.deliveryIds.map((id) => id[0])).size).toBe(1);
  });

  it('crosses streets inside one neighbourhood rather than leaving the cluster short', () => {
    const avail: ClusterInput[] = [
      { id: 'a1', street: 'אודם', houseNumber: '7', neighborhood: 'אבני חן' },
      { id: 'a2', street: 'אודם', houseNumber: '9', neighborhood: 'אבני חן' },
      { id: 'a3', street: 'ברקת', houseNumber: '6', neighborhood: 'אבני חן' },
      { id: 'a4', street: 'ברקת', houseNumber: '8', neighborhood: 'אבני חן' },
      { id: 'z1', street: 'אורן', houseNumber: '34', neighborhood: 'חורש' },
    ];
    const [best] = findDeliveryClusters(avail, 4);
    expect(best.size).toBe(4);
    expect(best.neighborhoods).toEqual(['אבני חן']);
    expect(best.streets).toHaveLength(2);
  });

  it('falls back to street grouping when neighbourhood is missing', () => {
    const avail: ClusterInput[] = [
      { id: 's1', street: 'אודם', houseNumber: '7' },
      { id: 's2', street: 'אודם', houseNumber: '9' },
      { id: 's3', street: 'אודם', houseNumber: '11' },
      { id: 'o1', street: 'רחוק', houseNumber: '80' },
    ];
    const [best] = findDeliveryClusters(avail, 3);
    expect([...best.deliveryIds].sort()).toEqual(['s1', 's2', 's3']);
    expect(best.neighborhoods).toEqual([]);
  });

  it('prefers coordinates over neighbourhood when both are present', () => {
    // Mislabelled neighbourhood must not beat real coordinates.
    const avail: ClusterInput[] = [
      { id: 'c1', street: 'A', houseNumber: '1', neighborhood: 'X', latitude: 32.0600, longitude: 34.77 },
      { id: 'c2', street: 'B', houseNumber: '2', neighborhood: 'Y', latitude: 32.0601, longitude: 34.77 },
      { id: 'c3', street: 'C', houseNumber: '3', neighborhood: 'X', latitude: 32.2000, longitude: 34.90 },
    ];
    const [best] = findDeliveryClusters(avail, 2);
    expect([...best.deliveryIds].sort()).toEqual(['c1', 'c2']);
  });

  it('is deterministic regardless of input order', () => {
    const avail = Array.from({ length: 25 }, (_, i) => d(`id${i}`, `S${i % 5}`, String(i), 32 + (i % 5) * 0.01, 34.7 + Math.floor(i / 5) * 0.001));
    const a = findDeliveryClusters(avail, 6);
    const b = findDeliveryClusters([...avail].reverse(), 6);
    expect(a).toEqual(b);
  });

  it('returns nothing for empty input or zero request', () => {
    expect(findDeliveryClusters([], 4)).toEqual([]);
    expect(findDeliveryClusters([herzl('h1', 1)], 0)).toEqual([]);
  });

  it('scales to a few hundred deliveries quickly', () => {
    const avail = Array.from({ length: 600 }, (_, i) =>
      d(`id${i}`, `Street ${i % 40}`, String(i % 60), 32 + (i % 40) * 0.002, 34.7 + Math.floor(i / 40) * 0.002),
    );
    const t = performance.now();
    const res = findDeliveryClusters(avail, 8);
    expect(performance.now() - t).toBeLessThan(2000);
    expect(res[0].size).toBe(8);
  });
});
