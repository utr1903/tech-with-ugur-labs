import { describe, expect, it } from "vitest";
import { validateDiscoveredUrl, validatePublicUrl } from "./scope.js";

describe("validatePublicUrl", () => {
  it("normalizes a public HTTP URL and strips its fragment", () => {
    expect(validatePublicUrl("HTTPS://Example.COM:443/a#section")).toEqual({
      valid: true,
      url: "https://example.com/a",
      host: "example.com",
    });
  });
  it.each([
    ["not a URL", "malformed"],
    ["file:///tmp/a", "protocol"],
    ["https://user:secret@example.com", "credentials"],
    ["http://localhost/a", "private-host"],
    ["http://service.local", "private-host"],
    ["http://internal", "private-host"],
    ["http://127.0.0.1", "private-host"],
    ["http://10.0.0.1", "private-host"],
    ["http://172.16.1.1", "private-host"],
    ["http://192.168.1.2", "private-host"],
    ["http://169.254.169.254", "private-host"],
    ["http://100.64.0.1", "private-host"],
    ["http://192.88.99.1", "private-host"],
    ["http://[2002:7f00:1::]", "private-host"],
    ["http://[2001:20::1]", "private-host"],
    ["http://service.home.arpa", "private-host"],
    ["http://0x7f000001", "private-host"],
    ["http://[::1]", "private-host"],
    ["http://[fc00::1]", "private-host"],
    ["http://[fe80::1]", "private-host"],
    ["http://[::ffff:127.0.0.1]", "private-host"],
  ])("rejects %s as %s", (raw, reason) => {
    expect(validatePublicUrl(raw)).toEqual({ valid: false, raw, reason });
  });
  it.each([
    ["192.0.0.0", false],
    ["192.0.0.255", false],
    ["192.0.1.0", true],
    ["192.0.1.255", true],
    ["192.0.2.0", false],
    ["192.0.2.255", false],
    ["192.0.3.0", true],
    ["192.0.78.24", true],
    ["192.0.255.255", true],
  ])("classifies IPv4 /24 boundary %s as public=%s", (host, valid) => {
    expect(validatePublicUrl(`http://${host}/`)).toMatchObject({ valid });
  });
  it.each([
    ["1fff:ffff:ffff:ffff:ffff:ffff:ffff:ffff", false],
    ["2000::1", true],
    ["2001::1", false],
    ["2001:0:0:1::1", false],
    ["2001:1ff:ffff:ffff:ffff:ffff:ffff:ffff", false],
    ["2001:200::1", true],
    ["2001:db7:ffff:ffff:ffff:ffff:ffff:ffff", true],
    ["2001:db8::1", false],
    ["2001:db8:ffff:ffff:ffff:ffff:ffff:ffff", false],
    ["2001:db9::1", true],
    ["2002::1", false],
    ["2002:ffff:ffff:ffff:ffff:ffff:ffff:ffff", false],
    ["2003::1", true],
    ["3ffe:ffff:ffff:ffff:ffff:ffff:ffff:ffff", true],
    ["3fff::1", false],
    ["3fff:fff:ffff:ffff:ffff:ffff:ffff:ffff", false],
    ["3fff:1000::1", true],
    ["3fff:ffff:ffff:ffff:ffff:ffff:ffff:ffff", true],
    ["4000::1", false],
  ])("classifies parsed IPv6 prefix %s as public=%s", (host, valid) => {
    expect(validatePublicUrl(`http://[${host}]/`)).toMatchObject({ valid });
  });
  it.each(["https://8.8.8.8/", "https://[2606:4700:4700::1111]/"])(
    "accepts public IP address %s",
    (url) => {
      expect(validatePublicUrl(url)).toMatchObject({ valid: true, url });
    },
  );
});

describe("validateDiscoveredUrl", () => {
  it("resolves relative article links on the source host", () => {
    expect(validateDiscoveredUrl("/article#part", "example.com")).toEqual({
      valid: true,
      url: "https://example.com/article",
      host: "example.com",
    });
  });
  it.each([
    "https://other.example/article",
    "//other.example/article",
    "https://sub.example.com/article",
  ])("rejects links leaving the exact source host: %s", (raw) => {
    expect(validateDiscoveredUrl(raw, "example.com")).toEqual({
      valid: false,
      raw,
      reason: "off-host",
    });
  });
  it("keeps private destination denials when resolving links", () => {
    expect(
      validateDiscoveredUrl("http://127.0.0.1/a", "example.com"),
    ).toMatchObject({ valid: false, reason: "private-host" });
  });
});
