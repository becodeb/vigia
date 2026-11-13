// Prints a VAPID keypair (P-256) for web push. Usage: node scripts/gen-vapid.mjs
import crypto from 'node:crypto';

const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const jwk = privateKey.export({ format: 'jwk' });
const pub = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]);
console.log(`VAPID_PUBLIC_KEY=${pub.toString('base64url')}`);
console.log(`VAPID_PRIVATE_KEY=${jwk.d}`);
