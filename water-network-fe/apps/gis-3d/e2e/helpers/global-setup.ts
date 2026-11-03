import { execSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

/** Generate the Hanoi payload the tests serve in place of the backend. */
export default function globalSetup(): void {
  if (process.env.E2E_PROD_URL) return // deployed environments bring their own data
  // always regenerate: it takes seconds and keeps the fixture in step with the generator
  execSync('npx vite-node scripts/dump-e2e-seed.ts', { stdio: 'inherit', cwd: resolve(HERE, '../..') })
}
