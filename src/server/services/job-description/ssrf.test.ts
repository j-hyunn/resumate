import { describe, expect, it } from "vitest";
import { assertSafeUrl, ipv4ToBytes, ipv6ToBytes, isBlockedAddress, type LookupFn } from "./ssrf";

/** R15 A1 — SSRF 경계 (plan 1-C A1: http(s)만 · DNS 해석 뒤 검사 · 사설·루프백·링크 로컬·메타데이터 거부). */

const lookupTo = (...addresses: string[]): LookupFn => async () => addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
const publicLookup = lookupTo("93.184.216.34");

async function codeOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "ok";
  } catch (err) {
    return (err as { code?: string }).code ?? "unknown";
  }
}

describe("ipv4ToBytes", () => {
  it("parses canonical dotted-quad only", () => {
    expect(ipv4ToBytes("127.0.0.1")).toEqual([127, 0, 0, 1]);
    expect(ipv4ToBytes("255.255.255.255")).toEqual([255, 255, 255, 255]);
    expect(ipv4ToBytes("127.1")).toBeNull();
    expect(ipv4ToBytes("0177.0.0.1")).toBeNull();
    expect(ipv4ToBytes("256.0.0.1")).toBeNull();
    expect(ipv4ToBytes("1.2.3.4.5")).toBeNull();
  });
});

describe("ipv6ToBytes", () => {
  it("expands ::, full form and a trailing IPv4 literal", () => {
    expect(ipv6ToBytes("::1")?.at(15)).toBe(1);
    expect(ipv6ToBytes("::")?.every((b) => b === 0)).toBe(true);
    expect(ipv6ToBytes("fe80::1")?.at(0)).toBe(0xfe);
    const mapped = ipv6ToBytes("::ffff:10.0.0.1");
    expect(mapped && [mapped[10], mapped[11], mapped[12], mapped[15]]).toEqual([0xff, 0xff, 10, 1]);
    expect(ipv6ToBytes("2001:0db8:0000:0000:0000:0000:0000:0001")?.at(3)).toBe(0xb8);
    expect(ipv6ToBytes("1:2:3")).toBeNull();
    expect(ipv6ToBytes("::1::2")).toBeNull();
  });
});

describe("isBlockedAddress", () => {
  it("blocks every private / loopback / link-local / metadata / reserved IPv4 range", () => {
    for (const address of [
      "0.0.0.0",
      "10.1.2.3",
      "100.64.0.1",
      "127.0.0.1",
      "169.254.1.1",
      "169.254.169.254", // cloud metadata
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "192.0.0.1",
      "192.0.2.5",
      "198.18.0.1",
      "198.51.100.7",
      "203.0.113.9",
      "224.0.0.1",
      "255.255.255.255",
    ]) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
  });

  it("allows public IPv4", () => {
    for (const address of ["93.184.216.34", "1.1.1.1", "8.8.8.8", "172.32.0.1", "192.167.1.1", "100.63.255.255"]) {
      expect(isBlockedAddress(address), address).toBe(false);
    }
  });

  it("blocks IPv6 loopback, unique-local, link-local, multicast and the IPv4 wrappers", () => {
    for (const address of [
      "::1",
      "::",
      "fc00::1",
      "fd12:3456::1",
      "fe80::1",
      "ff02::1",
      "100::1",
      "2001:db8::1",
      "::ffff:127.0.0.1", // IPv4-mapped loopback
      "::ffff:169.254.169.254", // IPv4-mapped metadata
      "::ffff:10.0.0.1",
      "64:ff9b::192.168.0.1", // NAT64-wrapped private
      "::127.0.0.1", // deprecated IPv4-compatible
    ]) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
    expect(isBlockedAddress("2606:4700::1111")).toBe(false);
    expect(isBlockedAddress("64:ff9b::93.184.216.34")).toBe(false);
  });

  it("fails closed on anything unparseable", () => {
    expect(isBlockedAddress("not-an-ip")).toBe(true);
    expect(isBlockedAddress("")).toBe(true);
  });
});

describe("assertSafeUrl", () => {
  it("accepts an http(s) URL whose every resolved address is public", async () => {
    const safe = await assertSafeUrl("https://example.com/jobs/1?utm=x", publicLookup);
    expect(safe.url.hostname).toBe("example.com");
    expect(safe.addresses).toEqual(["93.184.216.34"]);
  });

  it("refuses a non-http(s) scheme, a bad URL, credentials and an over-long URL as invalid_source_url", async () => {
    expect(await codeOf(() => assertSafeUrl("file:///etc/passwd", publicLookup))).toBe("invalid_source_url");
    expect(await codeOf(() => assertSafeUrl("gopher://example.com/", publicLookup))).toBe("invalid_source_url");
    expect(await codeOf(() => assertSafeUrl("data:text/html,<b>x", publicLookup))).toBe("invalid_source_url");
    expect(await codeOf(() => assertSafeUrl("not a url", publicLookup))).toBe("invalid_source_url");
    expect(await codeOf(() => assertSafeUrl("", publicLookup))).toBe("invalid_source_url");
    expect(await codeOf(() => assertSafeUrl("http://user:pw@example.com/", publicLookup))).toBe("invalid_source_url");
    expect(await codeOf(() => assertSafeUrl(`https://example.com/${"a".repeat(2100)}`, publicLookup))).toBe("invalid_source_url");
  });

  it("blocks a literal private / loopback host without consulting DNS", async () => {
    const never: LookupFn = async () => {
      throw new Error("DNS must not be used for a literal IP");
    };
    expect(await codeOf(() => assertSafeUrl("http://127.0.0.1:3000/x", never))).toBe("fetch_blocked");
    expect(await codeOf(() => assertSafeUrl("http://169.254.169.254/latest/meta-data/", never))).toBe("fetch_blocked");
    expect(await codeOf(() => assertSafeUrl("http://[::1]/x", never))).toBe("fetch_blocked");
    expect(await codeOf(() => assertSafeUrl("http://[fd00::1]/x", never))).toBe("fetch_blocked");
  });

  it("blocks localhost and *.localhost before the lookup", async () => {
    const never: LookupFn = async () => {
      throw new Error("must not resolve");
    };
    expect(await codeOf(() => assertSafeUrl("http://localhost:54321/x", never))).toBe("fetch_blocked");
    expect(await codeOf(() => assertSafeUrl("http://api.localhost/x", never))).toBe("fetch_blocked");
  });

  it("blocks a public name that resolves to a private address (DNS rebinding / internal name)", async () => {
    expect(await codeOf(() => assertSafeUrl("https://intranet.example.com/x", lookupTo("10.0.0.5")))).toBe("fetch_blocked");
    expect(await codeOf(() => assertSafeUrl("https://metadata.example.com/x", lookupTo("169.254.169.254")))).toBe("fetch_blocked");
    expect(await codeOf(() => assertSafeUrl("https://v6.example.com/x", lookupTo("fe80::1")))).toBe("fetch_blocked");
  });

  it("blocks when ANY answer is private, even with a public one alongside", async () => {
    expect(await codeOf(() => assertSafeUrl("https://mixed.example.com/x", lookupTo("93.184.216.34", "127.0.0.1")))).toBe("fetch_blocked");
  });

  it("reports an unresolvable name as fetch_failed", async () => {
    const failing: LookupFn = async () => {
      throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
    };
    expect(await codeOf(() => assertSafeUrl("https://nope.example.com/x", failing))).toBe("fetch_failed");
    expect(await codeOf(() => assertSafeUrl("https://empty.example.com/x", lookupTo()))).toBe("fetch_failed");
  });
});

// UQ-759 (R15 후속 4): the fetch route parses with `new URL`, which lowercases the scheme itself, so
// an upper-case scheme is accepted and a non-http(s) one is refused — no regex involved.
describe("assertSafeUrl scheme case (UQ-759)", () => {
  const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];
  it.each(["HTTPS://example.com/job", "Http://example.com/job"])("%s is accepted", async (u) => {
    await expect(assertSafeUrl(u, publicLookup)).resolves.toMatchObject({ url: expect.any(URL) });
  });
  it.each(["ftp://example.com/job", "javascript:alert(1)"])("%s → invalid_source_url", async (u) => {
    await expect(assertSafeUrl(u, publicLookup)).rejects.toMatchObject({ code: "invalid_source_url", status: 400 });
  });
});
