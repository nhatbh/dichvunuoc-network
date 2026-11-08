import path from 'path'

/**
 * The shared @wn packages resolved from their source, for the dev server, the build and the tests.
 *
 * pnpm installs `file:` packages as copies (node_modules/.pnpm), taken at install time: after a
 * package gains an export or a change, the app would keep seeing the old copy until the next
 * install ("Package subpath './catalog' is not defined", "does not provide an export named …").
 * Resolving the source skips the copy, so a pull is enough. Order matters: exact names first.
 */
export function workspaceAliases(appDir: string): { find: RegExp; replacement: string }[] {
  const pkg = (name: string) => path.resolve(appDir, '../../packages', name)
  const contracts = `${pkg('contracts')}/src`
  const models = pkg('component-models')
  return [
    { find: /^@wn\/contracts$/, replacement: `${contracts}/index.ts` },
    { find: /^@wn\/contracts\/([a-z-]+)$/, replacement: `${contracts}/$1/index.ts` },
    { find: /^@wn\/component-models$/, replacement: `${models}/src/index.ts` },
    { find: /^@wn\/component-models\/icons\/(.+)$/, replacement: `${models}/dist/icons/$1` },
    { find: /^@wn\/component-models\/([a-z-]+)$/, replacement: `${models}/src/$1.ts` },
  ]
}
