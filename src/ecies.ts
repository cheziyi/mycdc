// public/app.js encrypts to the layout this file decrypts, so change both
// together. DESIGN.md gives the layout.

const VERSION = 0x01;
const P256_RAW_POINT_LENGTH = 65;
const IV_LENGTH = 12;
const GCM_TAG_LENGTH = 16;
const MAXIMUM_BLOB_LENGTH = 4096;
const HKDF_INFO = new TextEncoder().encode('mycdc-ecies-v1');

/** The `creds` parameter is absent, malformed, or encrypted to another key. */
export class CredentialsError extends Error {}
/** `CDC_PRIVATE_KEY_JWK` is unset or is not a P-256 private key. */
export class ConfigurationError extends Error {}

export interface Credentials {
  learnerId: string;
  password: string;
}

export function decodeBase64Url(encoded: string): Uint8Array {
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

interface PrivateJwk extends JsonWebKey {
  x: string;
  y: string;
}

function parsePrivateJwk(json: string | undefined): PrivateJwk {
  if (!json) {
    throw new ConfigurationError('CDC_PRIVATE_KEY_JWK is not set. Run `npm run keygen` and add it as a secret.');
  }
  let jwk: PrivateJwk;
  try {
    jwk = JSON.parse(json) as PrivateJwk;
  } catch {
    throw new ConfigurationError('CDC_PRIVATE_KEY_JWK is not valid JSON.');
  }
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.d || !jwk.x || !jwk.y) {
    throw new ConfigurationError('CDC_PRIVATE_KEY_JWK must be a P-256 EC private key (kty, crv, d, x, y).');
  }
  // importKey fails when key_ops disagrees with the usages it is asked for.
  delete jwk.key_ops;
  delete jwk.ext;
  return jwk;
}

/** The raw uncompressed P-256 point that a browser encrypts to. */
export function derivePublicKeyBytes(privateJwkJson: string | undefined): Uint8Array {
  const jwk = parsePrivateJwk(privateJwkJson);
  const x = decodeBase64Url(jwk.x);
  const y = decodeBase64Url(jwk.y);
  const point = new Uint8Array(P256_RAW_POINT_LENGTH);
  point[0] = 0x04;
  point.set(x, 1 + (32 - x.length));
  point.set(y, 33 + (32 - y.length));
  return point;
}

// @cloudflare/workers-types names the ECDH peer key `$public`, but workerd and
// every browser read `public`.
function buildEcdhAlgorithm(peerKey: CryptoKey): SubtleCryptoDeriveKeyAlgorithm {
  return { name: 'ECDH', public: peerKey } as unknown as SubtleCryptoDeriveKeyAlgorithm;
}

async function deriveAesKey(sharedSecret: ArrayBuffer, salt: Uint8Array): Promise<CryptoKey> {
  const inputKeyMaterial = await crypto.subtle.importKey('raw', sharedSecret, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: HKDF_INFO },
    inputKeyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
}

/** Throws `CredentialsError` for a blob this deployment cannot decrypt. */
export async function decryptCredentials(blob: string, privateJwkJson: string | undefined): Promise<Credentials> {
  if (!blob) throw new CredentialsError('Missing the creds parameter.');
  if (blob.length > MAXIMUM_BLOB_LENGTH) throw new CredentialsError('creds parameter is too long.');

  let bytes: Uint8Array;
  try {
    bytes = decodeBase64Url(blob.trim());
  } catch {
    throw new CredentialsError('creds parameter is not valid base64url.');
  }
  if (bytes.length < 1 + P256_RAW_POINT_LENGTH + IV_LENGTH + GCM_TAG_LENGTH) {
    throw new CredentialsError('creds parameter is truncated.');
  }
  if (bytes[0] !== VERSION) throw new CredentialsError('Unsupported creds version.');

  const ephemeralPublicKeyBytes = bytes.slice(1, 1 + P256_RAW_POINT_LENGTH);
  const iv = bytes.slice(1 + P256_RAW_POINT_LENGTH, 1 + P256_RAW_POINT_LENGTH + IV_LENGTH);
  const ciphertext = bytes.slice(1 + P256_RAW_POINT_LENGTH + IV_LENGTH);

  const privateKey = await crypto.subtle.importKey(
    'jwk',
    parsePrivateJwk(privateJwkJson),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits'],
  );

  let plaintext: ArrayBuffer;
  try {
    const ephemeralPublicKey = await crypto.subtle.importKey(
      'raw',
      ephemeralPublicKeyBytes as BufferSource,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      [],
    );
    const sharedSecret = await crypto.subtle.deriveBits(buildEcdhAlgorithm(ephemeralPublicKey), privateKey, 256);
    const aesKey = await deriveAesKey(sharedSecret, ephemeralPublicKeyBytes);
    plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource, additionalData: ephemeralPublicKeyBytes as BufferSource },
      aesKey,
      ciphertext as BufferSource,
    );
  } catch {
    throw new CredentialsError("This link wasn't made for this site, or it has been changed. Please create a new one.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    throw new CredentialsError('Decrypted credentials are malformed.');
  }
  const { id, pw } = (parsed ?? {}) as { id?: unknown; pw?: unknown };
  if (typeof id !== 'string' || typeof pw !== 'string' || !id || !pw) {
    throw new CredentialsError('Decrypted credentials are missing a learner ID or password.');
  }
  return { learnerId: id, password: pw };
}

/** A SHA-256 of the pair in hexadecimal, used as a cache key in place of the credentials. */
export async function fingerprintCredentials({ learnerId, password }: Credentials): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`mycdc ${learnerId} ${password}`));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
