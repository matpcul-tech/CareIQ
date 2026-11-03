/**
 * E2E crypto core (design doc PR 2 of the build plan, "PR 1" of encryption code).
 * Pure WebCrypto. Runs in the browser and in Node 20+. Not wired into any route yet.
 *
 * - Data keys (DEK): AES-GCM 256.
 * - Recipient keys: ECDH P-256. DEKs are wrapped with ephemeral ECDH, HKDF-SHA-256, AES-GCM.
 * - AAD binds ciphertext to its row so rows cannot be swapped.
 */

const subtle = (): SubtleCrypto => {
  const c = globalThis.crypto;
  if (!c?.subtle) throw new Error("WebCrypto is not available");
  return c.subtle;
};

const enc = new TextEncoder();
const dec = new TextDecoder();

export const FORMAT_VERSION = 1 as const;

export function b64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function unb64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function buildAad(parts: { table: string; rowId: string; patientId: string; version?: number }): string {
  return `${parts.table}:${parts.rowId}:${parts.patientId}:${parts.version ?? FORMAT_VERSION}`;
}

/** New random AES-GCM 256 data key. Extractable so it can be wrapped to recipients. */
export async function generateDataKey(): Promise<CryptoKey> {
  return subtle().generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

/** ECDH P-256 key pair. Private key is non-extractable by default (device keys). */
export async function generateRecipientKeyPair(extractablePrivate = false): Promise<CryptoKeyPair> {
  const pair = (await subtle().generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey", "deriveBits"])) as CryptoKeyPair;
  if (extractablePrivate) return pair;
  // Re-import the private key as non-extractable.
  const jwk = await subtle().exportKey("jwk", pair.privateKey);
  const privateKey = await subtle().importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveKey", "deriveBits"]);
  return { publicKey: pair.publicKey, privateKey };
}

export async function exportPublicJwk(key: CryptoKey): Promise<JsonWebKey> {
  return subtle().exportKey("jwk", key);
}

export async function importPublicJwk(jwk: JsonWebKey): Promise<CryptoKey> {
  return subtle().importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, true, []);
}

export interface Envelope {
  v: typeof FORMAT_VERSION;
  kid: string;
  iv: string;
  ct: string;
}

export async function encryptString(key: CryptoKey, kid: string, plaintext: string, aad: string): Promise<Envelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle().encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(aad) }, key, enc.encode(plaintext));
  return { v: FORMAT_VERSION, kid, iv: b64(iv), ct: b64(ct) };
}

export async function decryptString(key: CryptoKey, env: Envelope, aad: string): Promise<string> {
  if (env.v !== FORMAT_VERSION) throw new Error(`Unsupported envelope version ${String(env.v)}`);
  const pt = await subtle().decrypt({ name: "AES-GCM", iv: unb64(env.iv), additionalData: enc.encode(aad) }, key, unb64(env.ct));
  return dec.decode(pt);
}

export async function encryptJson(key: CryptoKey, kid: string, value: unknown, aad: string): Promise<Envelope> {
  return encryptString(key, kid, JSON.stringify(value), aad);
}

export async function decryptJson<T>(key: CryptoKey, env: Envelope, aad: string): Promise<T> {
  return JSON.parse(await decryptString(key, env, aad)) as T;
}

export interface WrappedKey {
  v: typeof FORMAT_VERSION;
  epk: JsonWebKey; // ephemeral public key
  salt: string;
  iv: string;
  wk: string; // wrapped raw DEK
}

async function deriveWrapKey(priv: CryptoKey, pub: CryptoKey, salt: Uint8Array<ArrayBuffer>, info: string): Promise<CryptoKey> {
  const bits = await subtle().deriveBits({ name: "ECDH", public: pub }, priv, 256);
  const hk = await subtle().importKey("raw", bits, "HKDF", false, ["deriveKey"]);
  return subtle().deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: enc.encode(info) },
    hk,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

const WRAP_INFO = "careiq-e2e-wrap-v1";

/** Wrap a DEK to a recipient's ECDH public key. `context` is bound as AAD (for example dek id + recipient id). */
export async function wrapDataKey(dek: CryptoKey, recipientPublic: CryptoKey, context: string): Promise<WrappedKey> {
  const eph = (await subtle().generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const kek = await deriveWrapKey(eph.privateKey, recipientPublic, salt, WRAP_INFO);
  const raw = await subtle().exportKey("raw", dek);
  const wk = await subtle().encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(context) }, kek, raw);
  return { v: FORMAT_VERSION, epk: await subtle().exportKey("jwk", eph.publicKey), salt: b64(salt), iv: b64(iv), wk: b64(wk) };
}

export async function unwrapDataKey(wrapped: WrappedKey, recipientPrivate: CryptoKey, context: string): Promise<CryptoKey> {
  if (wrapped.v !== FORMAT_VERSION) throw new Error("Unsupported wrapped key version");
  const epk = await importPublicJwk(wrapped.epk);
  const kek = await deriveWrapKey(recipientPrivate, epk, unb64(wrapped.salt), WRAP_INFO);
  const raw = await subtle().decrypt({ name: "AES-GCM", iv: unb64(wrapped.iv), additionalData: enc.encode(context) }, kek, unb64(wrapped.wk));
  return subtle().importKey("raw", raw, { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

/** Passphrase-derived key (PBKDF2-SHA-256) used to wrap a clinic root private key. */
export const PBKDF2_ITERATIONS = 600_000;

export async function deriveKeyFromPassphrase(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations = PBKDF2_ITERATIONS): Promise<CryptoKey> {
  if (passphrase.length < 12) throw new Error("Passphrase must be at least 12 characters");
  const base = await subtle().importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return subtle().deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Seal an extractable private key (JWK) under a passphrase or recovery-derived key. */
export async function sealPrivateKey(priv: CryptoKey, sealKey: CryptoKey, aad: string): Promise<Envelope> {
  const jwk = await subtle().exportKey("jwk", priv);
  return encryptJson(sealKey, "seal", jwk, aad);
}

export async function openPrivateKey(env: Envelope, sealKey: CryptoKey, aad: string, extractable = false): Promise<CryptoKey> {
  const jwk = await decryptJson<JsonWebKey>(sealKey, env, aad);
  return subtle().importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, extractable, ["deriveKey", "deriveBits"]);
}
