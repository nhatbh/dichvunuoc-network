// Development JWT for the local backend stack (Jwt:Mode = Mock). Mirrors the backend's
// DevJwtTokenFactory: HS256 with the shared mock signing key, flat tenant_id, one azp.
// Never valid outside a Mock-mode backend (the services refuse Mock mode in Production).
import { Buffer } from 'node:buffer'
import { createHmac } from 'node:crypto'

export const LOCAL_STACK = {
  issuer: process.env.WN_JWT_ISSUER ?? 'water-platform-dev',
  audience: process.env.WN_JWT_AUDIENCE ?? 'water-platform',
  signingKey: process.env.WN_JWT_KEY ?? 'water-platform-dev-signing-key-min-32-chars!',
  tenantId: process.env.WN_TENANT ?? 'local-dev',
  authorizedParty: 'water-network-gis-fe',
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

export function devToken({ subject = 'local-dev-user', permissions = DEV_PERMISSIONS, hours = 12 } = {}) {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'HS256', typ: 'JWT' }
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
  const sig = createHmac('sha256', LOCAL_STACK.signingKey).update(body).digest()
  return `${body}.${b64url(sig)}`
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('dev-token.mjs')) {
  process.stdout.write(devToken() + '\n')
}
