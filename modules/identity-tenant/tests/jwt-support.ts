import { SignJWT, exportJWK, generateKeyPair, type JWK } from "jose";

type PrivateKey = Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];

/**
 * Test-only token issuer: real asymmetric keys and real signed JWTs, standing in for an identity
 * provider so the verifier, key rotation and every claim check run exactly as in production.
 */

export interface SigningKey {
  readonly kid: string;
  readonly alg: string;
  readonly privateKey: PrivateKey;
  readonly jwk: JWK;
}

export async function signingKey(kid: string, alg = "ES256"): Promise<SigningKey> {
  const { privateKey, publicKey } = await generateKeyPair(alg, { extractable: true });
  return { kid, alg, privateKey, jwk: { ...(await exportJWK(publicKey)), kid, alg, use: "sig" } };
}

export interface TokenOptions {
  readonly issuer: string;
  readonly audience: string | readonly string[];
  readonly subject: string;
  readonly jti: string;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  readonly notBefore?: Date;
  readonly type?: string;
  /** Extra claims, such as `sintius_tenants`, `amr`, `scope` or `sintius_platform_roles`. */
  readonly claims?: Readonly<Record<string, unknown>>;
}

const seconds = (date: Date) => Math.floor(date.valueOf() / 1_000);

export async function issueToken(key: SigningKey, options: TokenOptions): Promise<string> {
  let jwt = new SignJWT({ ...(options.claims ?? {}) })
    .setProtectedHeader({ alg: key.alg, kid: key.kid, ...(options.type === undefined ? {} : { typ: options.type }) })
    .setIssuer(options.issuer)
    .setAudience(typeof options.audience === "string" ? options.audience : [...options.audience])
    .setSubject(options.subject)
    .setJti(options.jti)
    .setIssuedAt(seconds(options.issuedAt))
    .setExpirationTime(seconds(options.expiresAt));
  if (options.notBefore !== undefined) jwt = jwt.setNotBefore(seconds(options.notBefore));
  return jwt.sign(key.privateKey);
}

/** An unsigned (`alg: none`) token with the given payload, which no verifier may accept. */
export function unsignedToken(payload: Readonly<Record<string, unknown>>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.`;
}
