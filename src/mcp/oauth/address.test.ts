import { describe, expect, it, vi } from 'vitest';
import { isSpecialUseAddress, resolveAddresses } from './address.ts';

describe('isSpecialUseAddress', () => {
  it('refuses loopback, private, link-local and the other special-use ranges', () => {
    for (const address of [
      '0.0.0.0',
      '127.0.0.1',
      '127.255.255.255',
      '10.1.2.3',
      '100.64.0.1',
      '169.254.169.254',
      '172.16.0.1',
      '172.31.255.255',
      '192.0.0.1',
      '192.0.2.1',
      '192.168.0.1',
      '198.18.0.1',
      '198.51.100.7',
      '203.0.113.9',
      '224.0.0.1',
      '255.255.255.255',
      '::',
      '::1',
      '::ffff:127.0.0.1',
      '::ffff:10.0.0.1',
      '64:ff9b::7f00:1',
      '100::1',
      '2001:db8::1',
      'fc00::1',
      'fd00::1',
      'fe80::1',
      'ff02::1',
    ]) {
      expect(isSpecialUseAddress(address), address).toBe(true);
    }
  });

  it('passes a public address of either family', () => {
    expect(isSpecialUseAddress('93.184.216.34')).toBe(false);
    expect(isSpecialUseAddress('8.8.8.8')).toBe(false);
    expect(isSpecialUseAddress('172.32.0.1')).toBe(false);
    expect(isSpecialUseAddress('2606:2800:220:1:248:1893:25c8:1946')).toBe(false);
    expect(isSpecialUseAddress('::ffff:93.184.216.34')).toBe(false);
  });

  it('treats anything that is not an address as special-use', () => {
    expect(isSpecialUseAddress('example.com')).toBe(true);
    expect(isSpecialUseAddress('')).toBe(true);
  });
});

describe('resolveAddresses', () => {
  it('returns a literal without a lookup, with IPv6 brackets stripped', async () => {
    const lookup = vi.fn<(hostname: string) => Promise<never[]>>();

    expect(await resolveAddresses('93.184.216.34', lookup)).toEqual([
      { address: '93.184.216.34', family: 4 },
    ]);

    expect(await resolveAddresses('[::1]', lookup)).toEqual([{ address: '::1', family: 6 }]);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('resolves a name through the lookup', async () => {
    const lookup = vi.fn(async (hostname: string) =>
      hostname === 'client.example' ? [{ address: '93.184.216.34', family: 4 as const }] : [],
    );

    expect(await resolveAddresses('client.example', lookup)).toEqual([
      { address: '93.184.216.34', family: 4 },
    ]);

    expect(await resolveAddresses('nowhere.example', lookup)).toEqual([]);
  });
});
