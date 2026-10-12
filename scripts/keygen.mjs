#!/usr/bin/env node
// Prints only the private JWK to store: the Worker derives the public key from
// it and serves that at /api/pubkey.

import { webcrypto as crypto } from 'node:crypto';

const keyPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
  'deriveBits',
]);

const jwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
// importKey fails when key_ops disagrees with the usages the Worker asks for.
delete jwk.key_ops;
delete jwk.ext;

const publicKeyBytes = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey));
const publicKey = Buffer.from(publicKeyBytes).toString('base64url');

console.log('Private key (keep secret, one line):\n');
console.log(JSON.stringify(jwk));
console.log('\nPublic key, for reference (served at /api/pubkey):\n');
console.log(publicKey);
console.log(`
Store the private key as the CDC_PRIVATE_KEY_JWK secret:

  Local development
    printf 'CDC_PRIVATE_KEY_JWK=%s\\n' '${JSON.stringify(jwk)}' > .dev.vars

  Cloudflare, from the CLI
    npx wrangler secret put CDC_PRIVATE_KEY_JWK

  Cloudflare, from the dashboard
    Workers & Pages -> your Worker -> Settings -> Variables and Secrets
    -> Add, type Secret, name CDC_PRIVATE_KEY_JWK

Replacing this key invalidates every calendar link people have already added.
`);
