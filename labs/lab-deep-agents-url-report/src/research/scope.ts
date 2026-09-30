import { isIP } from "node:net";

export interface ValidUrl {
  valid: true;
  url: string;
  host: string;
}

export interface UrlRejection {
  valid: false;
  raw: string;
  reason:
    | "malformed"
    | "protocol"
    | "credentials"
    | "private-host"
    | "off-host";
}

function isPublicIpv4(host: string): boolean {
  const [a = 0, b = 0, c = 0] = host.split(".").map(Number);
  const reserved = [0, 10, 127].includes(a) || a >= 224;
  const local =
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168);
  const shared = a === 100 && b >= 64 && b <= 127;
  return !(reserved || local || shared || isSpecialIpv4(a, b, c));
}

function isSpecialIpv4(a: number, b: number, c: number): boolean {
  const special =
    (a === 192 &&
      ((b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19));
  const documentation =
    (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113);
  return special || documentation;
}

// Called only with IPv6 literals already validated and canonicalized by URL.
function ipv6Value(host: string): bigint {
  const [left = "", right] = host.split("::");
  const head = left ? left.split(":") : [];
  const tail = right ? right.split(":") : [];
  const groups =
    right === undefined
      ? head
      : [
          ...head,
          ...Array<string>(8 - head.length - tail.length).fill("0"),
          ...tail,
        ];
  return groups.reduce(
    (value, group) => (value << 16n) | BigInt(`0x${group}`),
    0n,
  );
}

function isPublicIpv6(host: string): boolean {
  const address = ipv6Value(host);
  // Public global unicast is 2000::/3; these allocations are non-public.
  const exclusions: [string, number][] = [
    ["2001::", 23],
    ["2001:db8::", 32],
    ["2002::", 16],
    ["3fff::", 20],
  ];
  return (
    address >> 125n === 1n &&
    !exclusions.some(([network, bits]) => {
      const shift = BigInt(128 - bits);
      return address >> shift === ipv6Value(network) >> shift;
    })
  );
}

function isPublicHost(host: string): boolean {
  const bare = host
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "")
    .toLowerCase();
  const version = isIP(bare);
  if (version === 4) return isPublicIpv4(bare);
  if (version === 6) return isPublicIpv6(bare);
  const forbiddenSuffix =
    /(?:^|\.)(?:localhost|local|internal|lan|home|home\.arpa|test|invalid)$/;
  return bare.includes(".") && !forbiddenSuffix.test(bare);
}

export function validatePublicUrl(raw: string): ValidUrl | UrlRejection {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { valid: false, raw, reason: "malformed" };
  }
  if (!/^https?:$/.test(parsed.protocol))
    return { valid: false, raw, reason: "protocol" };
  if (parsed.username || parsed.password)
    return { valid: false, raw, reason: "credentials" };
  if (!isPublicHost(parsed.hostname))
    return { valid: false, raw, reason: "private-host" };
  parsed.hash = "";
  parsed.hostname = parsed.hostname.replace(/\.$/, "");
  return { valid: true, url: parsed.href, host: parsed.hostname };
}

export function validateDiscoveredUrl(
  raw: string,
  sourceHost: string,
): ValidUrl | UrlRejection {
  const source = validatePublicUrl(`https://${sourceHost}/`);
  if (!source.valid) return { valid: false, raw, reason: source.reason };
  let resolved: string;
  try {
    resolved = new URL(raw, source.url).href;
  } catch {
    return { valid: false, raw, reason: "malformed" };
  }
  const result = validatePublicUrl(resolved);
  if (!result.valid) return { ...result, raw };
  if (result.host !== source.host)
    return { valid: false, raw, reason: "off-host" };
  return result;
}
