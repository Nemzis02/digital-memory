import { promises as dns } from 'node:dns';
import { BlockList, isIP } from 'node:net';

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export type Lookup = (hostname: string) => Promise<ResolvedAddress[]>;

export const systemLookup: Lookup = async (hostname) =>
  (await dns.lookup(hostname, { all: true })).map(({ address, family }) => ({
    address,
    family: family === 6 ? 6 : 4,
  }));

const IPV4_SPECIAL_USE: readonly [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

// No `::ffff:0:0/96` rule: BlockList checks every IPv4 address as its mapped form, so that
// rule would block all of IPv4. A mapped address is matched by the IPv4 rules instead.
const IPV6_SPECIAL_USE: readonly [string, number][] = [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
];

const specialUse = new BlockList();

for (const [address, prefix] of IPV4_SPECIAL_USE) {
  specialUse.addSubnet(address, prefix, 'ipv4');
}

for (const [address, prefix] of IPV6_SPECIAL_USE) {
  specialUse.addSubnet(address, prefix, 'ipv6');
}

/** True for loopback, private, link-local and the other IANA special-use ranges. */
export function isSpecialUseAddress(address: string): boolean {
  const family = isIP(address);

  if (family === 0) {
    return true;
  }

  return specialUse.check(address, family === 6 ? 'ipv6' : 'ipv4');
}

/** A literal address is returned as is; a name goes through `lookup`. */
export async function resolveAddresses(
  hostname: string,
  lookup: Lookup = systemLookup,
): Promise<ResolvedAddress[]> {
  const bare =
    hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;

  const family = isIP(bare);

  if (family !== 0) {
    return [{ address: bare, family: family === 6 ? 6 : 4 }];
  }

  return lookup(bare);
}
