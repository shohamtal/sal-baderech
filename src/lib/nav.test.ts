import { describe, expect, it } from 'vitest';
import { googleMapsUrl, wazeUrl } from './nav';

describe('navigation links', () => {
  it('prefers coordinates when available', () => {
    expect(wazeUrl({ latitude: 32.1, longitude: 34.8, address: 'הרצל 1' })).toBe(
      'https://waze.com/ul?ll=32.1,34.8&navigate=yes',
    );
    expect(googleMapsUrl({ latitude: 32.1, longitude: 34.8, address: 'הרצל 1' })).toContain('destination=32.1%2C34.8');
  });
  it('falls back to the address', () => {
    expect(wazeUrl({ latitude: null, longitude: null, address: 'הרצל 1, תל אביב' })).toBe(
      `https://waze.com/ul?q=${encodeURIComponent('הרצל 1, תל אביב')}&navigate=yes`,
    );
    expect(googleMapsUrl({ latitude: null, longitude: null, address: 'הרצל 1' })).toContain(encodeURIComponent('הרצל 1'));
  });
});
