import { isIP } from "node:net";
import { JD_SOURCE_URL_MAX, jdFetchError } from "@/lib/contracts/jd-fetch";

/**
 * R15 A1 (CF-10) address guard for `POST /api/job-descriptions/fetch`.
 *
 * The server fetches an arbitrary user-supplied URL, so this file is the
 * security boundary: scheme allow-list, length cap, **DNS resolution before the
 * connection**, and a block-list over every resolved address. The caller re-runs
 * `assertSafeUrl` on **every redirect hop** (SSRF via `Location:` is the usual
 * bypass) and caps the hop count.
 *
 * No Next.js / Supabase imports: this is plain Node so Vitest can drive it.
 */

/** One resolved address (the shape of `dns.lookup(host, {all: true})`). */
export type ResolvedAddress = { address: string; family: number };

/** Injectable resolver so tests never touch DNS. */
export type LookupFn = (hostname: string) => Promise<readonly ResolvedAddress[]>;

/** Schemes we will connect to. Anything else (file:, gopher:, data:, ftp:) is refused. */
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/** Strict dotted-quad → 4 bytes. Rejects octal / hex / short forms (`0177.1`, `0x7f.1`, `127.1`). */
export function ipv4ToBytes(value: string): [number, number, number, number] | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const bytes: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    // "01" and "007" are not canonical dotted-quad; `isIP` accepts only canonical forms too.
    if (part.length > 1 && part.startsWith("0")) return null;
    const n = Number(part);
    if (n > 255) return null;
    bytes.push(n);
  }
  return bytes as [number, number, number, number];
}

/** IPv6 (incl. `::`, a trailing dotted-quad and a `%zone` suffix) → 16 bytes. */
export function ipv6ToBytes(value: string): Uint8Array | null {
  let text = value;
  const zone = text.indexOf("%");
  if (zone >= 0) text = text.slice(0, zone);
  if (!text.includes(":")) return null;

  // A trailing IPv4 literal (`::ffff:10.0.0.1`, `64:ff9b::192.168.0.1`) becomes two hex groups.
  const lastColon = text.lastIndexOf(":");
  const tail = text.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = ipv4ToBytes(tail);
    if (!v4) return null;
    const g1 = ((v4[0] << 8) | v4[1]).toString(16);
    const g2 = ((v4[2] << 8) | v4[3]).toString(16);
    text = `${text.slice(0, lastColon + 1)}${g1}:${g2}`;
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;
  const split = (part: string) => (part === "" ? [] : part.split(":"));
  const head = split(halves[0]!);
  const tailGroups = halves.length === 2 ? split(halves[1]!) : null;

  const groups: number[] = [];
  const push = (list: readonly string[]) => {
    for (const g of list) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return false;
      groups.push(Number.parseInt(g, 16));
    }
    return true;
  };
  if (!push(head)) return null;
  if (tailGroups === null) {
    if (groups.length !== 8) return null;
  } else {
    const after: number[] = [];
    const before = groups.length;
    if (!push(tailGroups)) return null;
    after.push(...groups.splice(before));
    const fill = 8 - groups.length - after.length;
    if (fill < 1) return null;
    for (let i = 0; i < fill; i += 1) groups.push(0);
    groups.push(...after);
  }
  if (groups.length !== 8) return null;

  const bytes = new Uint8Array(16);
  groups.forEach((g, i) => {
    bytes[i * 2] = (g >> 8) & 0xff;
    bytes[i * 2 + 1] = g & 0xff;
  });
  return bytes;
}

/**
 * IPv4 ranges that must never be reached from a user-supplied URL:
 * `0/8` unspecified · `10/8` · `100.64/10` CGNAT · `127/8` loopback ·
 * `169.254/16` link-local (incl. the `169.254.169.254` cloud metadata address) ·
 * `172.16/12` · `192.0.0/24` IETF protocol · `192.0.2/24`, `198.51.100/24`,
 * `203.0.113/24` documentation · `192.168/16` · `198.18/15` benchmarking ·
 * `>= 224/4` multicast, reserved and broadcast.
 */
function isBlockedIpv4(b: readonly number[]): boolean {
  const [a, c, d] = [b[0]!, b[1]!, b[2]!];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a >= 224) return true;
  if (a === 100 && c >= 64 && c <= 127) return true;
  if (a === 169 && c === 254) return true;
  if (a === 172 && c >= 16 && c <= 31) return true;
  if (a === 192 && c === 168) return true;
  if (a === 192 && c === 0 && (d === 0 || d === 2)) return true;
  if (a === 198 && (c === 18 || c === 19)) return true;
  if (a === 198 && c === 51 && d === 100) return true;
  if (a === 203 && c === 0 && d === 113) return true;
  return false;
}

function allZero(bytes: Uint8Array, from: number, to: number): boolean {
  for (let i = from; i < to; i += 1) if (bytes[i] !== 0) return false;
  return true;
}

/**
 * IPv6: `::` unspecified · `::1` loopback · `fc00::/7` unique-local ·
 * `fe80::/10` link-local · `ff00::/8` multicast · `100::/64` discard ·
 * `2001:db8::/32` documentation, plus the two wrappers that smuggle an IPv4
 * address through (`::ffff:a.b.c.d` mapped and `64:ff9b::/96` NAT64) — those are
 * re-checked against the IPv4 block-list.
 */
function isBlockedIpv6(bytes: Uint8Array): boolean {
  // ::ffff:a.b.c.d (IPv4-mapped) and ::a.b.c.d (deprecated IPv4-compatible).
  if (allZero(bytes, 0, 10) && bytes[10] === 0xff && bytes[11] === 0xff) {
    return isBlockedIpv4([bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!]);
  }
  if (allZero(bytes, 0, 12)) {
    // :: and ::1 themselves, plus ::a.b.c.d.
    if (bytes[12] === 0 && bytes[13] === 0 && bytes[14] === 0 && (bytes[15] === 0 || bytes[15] === 1)) return true;
    return isBlockedIpv4([bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!]);
  }
  // 64:ff9b::/96 NAT64.
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b && allZero(bytes, 4, 12)) {
    return isBlockedIpv4([bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!]);
  }
  const first = bytes[0]!;
  if ((first & 0xfe) === 0xfc) return true; // fc00::/7
  if (first === 0xfe && (bytes[1]! & 0xc0) === 0x80) return true; // fe80::/10
  if (first === 0xff) return true; // ff00::/8
  if (first === 0x01 && bytes[1] === 0x00 && allZero(bytes, 2, 8)) return true; // 100::/64 discard
  if (first === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) return true; // 2001:db8::/32
  return false;
}

/** True when this literal address must not be connected to. Unparseable → blocked (fail closed). */
export function isBlockedAddress(address: string): boolean {
  const v4 = ipv4ToBytes(address);
  if (v4) return isBlockedIpv4(v4);
  const v6 = ipv6ToBytes(address);
  if (v6) return isBlockedIpv6(v6);
  return true;
}

export type SafeUrl = { url: URL; addresses: string[] };

/**
 * Validates one URL (or one redirect hop) and resolves it.
 *
 * `invalid_source_url` — not parseable, not http(s), over the 2,048-char cap
 * (same limit as the `job_descriptions_source_url_check` CHECK), has credentials
 * or no host. `fetch_blocked` — any resolved address is in a blocked range.
 * `fetch_failed` — the name does not resolve.
 *
 * [가정] The connection is made by hostname, not by the resolved literal, so a
 * DNS answer that changes between this lookup and the socket (DNS rebinding)
 * is not closed off. Accepted for R15: `fetch` in the Vercel runtime gives no
 * per-connection address hook, and the per-hop re-check below is what stops the
 * realistic `Location:`-based attack. Recorded in the slice notes.
 */
export async function assertSafeUrl(raw: string, lookup: LookupFn): Promise<SafeUrl> {
  if (typeof raw !== "string" || raw.trim() === "") throw jdFetchError("invalid_source_url");
  const trimmed = raw.trim();
  if (trimmed.length > JD_SOURCE_URL_MAX) throw jdFetchError("invalid_source_url");

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw jdFetchError("invalid_source_url");
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) throw jdFetchError("invalid_source_url");
  if (url.username !== "" || url.password !== "") throw jdFetchError("invalid_source_url");

  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "") throw jdFetchError("invalid_source_url");

  // A literal IP needs no DNS; it is checked directly so `http://127.0.0.1` and
  // `http://[::1]` can never reach the resolver path.
  if (isIP(host) !== 0) {
    if (isBlockedAddress(host)) throw jdFetchError("fetch_blocked");
    return { url, addresses: [host] };
  }
  // ".localhost" always resolves to loopback per RFC 6761 — refuse before the lookup.
  if (host === "localhost" || host.toLowerCase().endsWith(".localhost")) throw jdFetchError("fetch_blocked");

  let resolved: readonly ResolvedAddress[];
  try {
    resolved = await lookup(host);
  } catch {
    throw jdFetchError("fetch_failed");
  }
  const addresses = resolved.map((r) => r.address).filter((a) => typeof a === "string" && a !== "");
  if (addresses.length === 0) throw jdFetchError("fetch_failed");
  // ALL answers must be safe: a name with one public and one private A record is refused.
  if (addresses.some(isBlockedAddress)) throw jdFetchError("fetch_blocked");
  return { url, addresses };
}

/** Default resolver (`node:dns/promises`), kept out of the pure path for tests. */
export async function defaultLookup(hostname: string): Promise<readonly ResolvedAddress[]> {
  const { lookup } = await import("node:dns/promises");
  return await lookup(hostname, { all: true, verbatim: true });
}
