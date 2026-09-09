import { jwtVerify, SignJWT } from "jose";

export interface SessionUser {
  id: string;
  name: string;
}

const ALG = "HS256";
const TTL = "8h";

function key(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signSession(
  user: SessionUser,
  secret: string,
): Promise<string> {
  return await new SignJWT({ name: user.name })
    .setProtectedHeader({ alg: ALG })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(TTL)
    .sign(key(secret));
}

export async function verifySession(
  token: string,
  secret: string,
): Promise<SessionUser> {
  const { payload } = await jwtVerify(token, key(secret), {
    algorithms: [ALG],
  });
  if (typeof payload.sub !== "string" || typeof payload.name !== "string") {
    throw new Error("Session token is missing sub or name.");
  }
  return { id: payload.sub, name: payload.name };
}
