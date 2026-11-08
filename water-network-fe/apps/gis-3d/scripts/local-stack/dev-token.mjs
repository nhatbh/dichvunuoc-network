// Development identity for the local backend stack: an RS256 signing key, the OIDC discovery
// document and JWKS a local stand-in serves (water-network-be/docker-compose.local.yml,
// service dev-oidc), and tokens signed with that key.
//
// Every service validates them as it would Keycloak's: the .NET services in Jwt:Mode=Authority
// (discovery + JWKS), the CAD import service through its JWKS (it accepts RS256 only). Claims:
// flat tenant_id, one azp, permission[]. The key lives in water-network-be/.local-stack/oidc
// (git-ignored) and is created on first use; nothing here is valid outside that stack.
//
//   node scripts/local-stack/dev-token.mjs init   create the key and the documents if missing
//   node scripts/local-stack/dev-token.mjs        print a token
import { Buffer } from 'node:buffer'
import { createPrivateKey, createPublicKey, createSign, generateKeyPairSync } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
export const OIDC_DIR = process.env.WN_OIDC_DIR ?? path.resolve(here, '../../../../../water-network-be/.local-stack/oidc')

export const LOCAL_STACK = {
  // the address the services reach the stand-in at (inside the compose network)
  issuer: process.env.WN_JWT_ISSUER ?? 'http://dev-oidc:8080/realms/local',
  audience: process.env.WN_JWT_AUDIENCE ?? 'water-platform',
  tenantId: process.env.WN_TENANT ?? 'local-dev',
  authorizedParty: 'water-network-gis-fe',
  kid: 'local-dev',
}

export const DEV_PERMISSIONS = [
  'network-gis:read',
  'network-gis:write',
  'network-design:read',
  'network-design:write',
  'network-design:approve',
  'network-asset:read',
]

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')

/** Creates the signing key, discovery document and JWKS when missing; returns the private key. */
export function ensureKeys(dir = OIDC_DIR) {
  const keyFile = path.join(dir, 'private.pem')
  if (!existsSync(keyFile)) {
    mkdirSync(dir, { recursive: true })
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    writeFileSync(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }))
  }
  const privateKey = createPrivateKey(readFileSync(keyFile))
  const jwk = { ...createPublicKey(privateKey).export({ format: 'jwk' }), kid: LOCAL_STACK.kid, use: 'sig', alg: 'RS256' }
  const certs = path.join(dir, 'protocol', 'openid-connect', 'certs')
  const discovery = path.join(dir, '.well-known', 'openid-configuration')
  mkdirSync(path.dirname(certs), { recursive: true })
  mkdirSync(path.dirname(discovery), { recursive: true })
  writeFileSync(certs, JSON.stringify({ keys: [jwk] }, null, 2))
  writeFileSync(
    discovery,
    JSON.stringify(
      {
        issuer: LOCAL_STACK.issuer,
        jwks_uri: `${LOCAL_STACK.issuer}/protocol/openid-connect/certs`,
        id_token_signing_alg_values_supported: ['RS256'],
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
      },
      null,
      2,
    ),
  )
  return privateKey
}

export function devToken({ subject = 'local-dev-user', permissions = DEV_PERMISSIONS, hours = 12 } = {}) {
  const key = ensureKeys()
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT', kid: LOCAL_STACK.kid }
  const payload = {
    sub: subject,
    tenant_id: LOCAL_STACK.tenantId,
    azp: LOCAL_STACK.authorizedParty,
    permission: permissions,
    iss: LOCAL_STACK.issuer,
    aud: LOCAL_STACK.audience,
    nbf: now - 60,
    iat: now,
    exp: now + hours * 3600,
  }
  const body = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`
  const sig = createSign('RSA-SHA256').update(body).sign(key)
  return `${body}.${b64url(sig)}`
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === 'init') {
    ensureKeys()
    console.log(`local OIDC stand-in files in ${OIDC_DIR}`)
  } else process.stdout.write(devToken() + '\n')
}
