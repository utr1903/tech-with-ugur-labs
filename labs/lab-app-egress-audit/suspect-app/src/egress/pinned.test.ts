import { describe, expect, it } from "vitest";
import { fingerprint256, makeServerIdentityCheck } from "./pinned.js";

// A throwaway self-signed cert (public cert only, no private key) used purely to
// check the fingerprint format. Regenerate with:
//   openssl req -x509 -newkey rsa:2048 -nodes -keyout /dev/null \
//     -subj /CN=test -days 1 -outform PEM 2>/dev/null
const SAMPLE_PEM = `-----BEGIN CERTIFICATE-----
MIIC/zCCAeegAwIBAgIUWpI0tJPea2YNAcmxHAADXdaeZ/swDQYJKoZIhvcNAQEL
BQAwDzENMAsGA1UEAwwEdGVzdDAeFw0yNjA4MjAxMDIxMTdaFw0yNjA4MjExMDIx
MTdaMA8xDTALBgNVBAMMBHRlc3QwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEK
AoIBAQCjkRMgutpeurSK0Yau2ApPRIIY375OBJcpLA/3HIfEpyVpa9OZgHmW4ckF
ym9DNCA+0P8wnCi2mzlhMc818jIM7orziej8mGyDhVvF2IkHRJGbawC7GoIVlwRq
9MY/OjhBp9wyaSTeRaVE8RM6SlKrF/bJ9p0gIN0ATk3zzO84TqONsOWTgen01rc+
8cVZHMF0Dmi880ejqWdHNhOLyjuUVVh6qmYFfJwMWpWOGnwV3EZETdyvTwG1Bf/K
zK+O6+XiAydgx0Dbj/t6lcsCBVo5+lXh+ItQvTDn0tXKHu2B170eNDAJkQUuH70C
hEu3Tee0tC8nD1xN36Nm/E5QuuHxAgMBAAGjUzBRMB0GA1UdDgQWBBR+q+xn0Hsm
Q5+KhC+cwxBCv/22jTAfBgNVHSMEGDAWgBR+q+xn0HsmQ5+KhC+cwxBCv/22jTAP
BgNVHRMBAf8EBTADAQH/MA0GCSqGSIb3DQEBCwUAA4IBAQAoEM7LHegM14TQmWch
o3QeuPIbrOyGHCqDpAemtA0445I2wCOZGJT+s9l6qTLhpo1KPCKjLAX9pM7AZ8yT
Xu1+XhRuA8LGaxaXEu7Jz95kC9Oj8NPAoz3a96RwCrW/e5OXUpoKBipGC9AGK5gD
47Qr9lp7nDT5ITXoitmlS/7vuSJM432ezC6Sp30+6KNpnRQqPuW7+I2B4I08tKwB
R1XMcBwFG6KvCeaju4ALLtJEsDNksXnFcPRFSl5taWB2EhRm6Lpu6hRCIkZZ4cmh
biPZuPZzvjVuLZRrApt3+qJDv+pqcO/JBMumdO1PmdVbslR939KU6c9JIxwgGNb9
fRqt
-----END CERTIFICATE-----`;

describe("fingerprint256", () => {
  it("formats like Node's colon-separated uppercase hex", () => {
    const fp = fingerprint256(SAMPLE_PEM);
    expect(fp).toMatch(/^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/);
  });
});

describe("makeServerIdentityCheck", () => {
  it("passes when the presented fingerprint matches the pin", () => {
    const check = makeServerIdentityCheck("AA:BB:CC");
    expect(check("pin.evil-c2.lab", { fingerprint256: "AA:BB:CC" })).toBeUndefined();
  });

  it("returns an error when the fingerprint differs (interception detected)", () => {
    const check = makeServerIdentityCheck("AA:BB:CC");
    const result = check("pin.evil-c2.lab", { fingerprint256: "99:88:77" });
    expect(result).toBeInstanceOf(Error);
    expect(String(result)).toContain("pin");
  });

  it("returns an error when no fingerprint is presented", () => {
    const check = makeServerIdentityCheck("AA:BB:CC");
    expect(check("pin.evil-c2.lab", {})).toBeInstanceOf(Error);
  });
});
