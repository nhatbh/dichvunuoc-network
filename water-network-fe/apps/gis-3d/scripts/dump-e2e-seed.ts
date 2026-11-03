/**
 * Writes the Hanoi mock payload (`GET /full`) to e2e/.generated/full.json so the production-build
 * e2e tests can serve it without MSW (mocks are dev-only). Run with `vite-node`.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { buildLegacyFullSeed } from '../src/shared/api/mocks/legacy-full-seed'

const out = resolve(__dirname, '../e2e/.generated/full.json')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify(buildLegacyFullSeed()))
console.log('wrote', out)
