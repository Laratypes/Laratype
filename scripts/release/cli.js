#!/usr/bin/env node
// @ts-check
// Release CLI (B15 #190, docs/v1/build.md › CI and release). Dependency-free: node:util parseArgs only.
//
//   bun run release:changeset <pkg> <patch|minor|major> "<summary>"
//   bun run release:version
//   bun run release:check [--version <version>]
//   bun run release:pre <base>
//   bun run release:pre-exit
//   node scripts/release/cli.js dist-tag <version>   (workflow helper)
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  ReleaseError,
  checkWorkspace,
  distTagFor,
  readChangesets,
  readPre,
  readWorkspace,
  removePre,
  fixedVersion,
  nextVersion,
  publicPackages,
  writeChangeset,
  writePre,
  writeRelease,
} from './lib.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const USAGE = `usage:
  bun run release:changeset <pkg> <patch|minor|major> "<summary>"
  bun run release:version
  bun run release:check [--version <version>]
  bun run release:pre <base>
  bun run release:pre-exit
  node scripts/release/cli.js dist-tag <version>`

/**
 * @param {string[]} args
 * @param {import('node:util').ParseArgsConfig['options']} [options]
 * @returns {{ values: Record<string, any>, positionals: string[] }}
 */
function parse(args, options = {}) {
  try {
    const parsed = parseArgs({ args, options, allowPositionals: true, strict: true })
    return { values: parsed.values, positionals: parsed.positionals }
  }
  catch (error) {
    throw new ReleaseError(`${/** @type {Error} */ (error).message}\n${USAGE}`)
  }
}

/** @param {string} reason */
function usage(reason) {
  throw new ReleaseError(`${reason}\n${USAGE}`)
}

/** @param {string[]} argv */
function main(argv) {
  const [command, ...rest] = argv

  switch (command) {
    case 'changeset': {
      const { positionals } = parse(rest)
      if (positionals.length < 3) usage('release:changeset needs a package, a bump and a summary')
      const [name, bump, ...summary] = positionals
      const file = writeChangeset(ROOT, { name, bump, summary: summary.join(' ') })
      console.log(`release: wrote ${path.relative(ROOT, file)}`)
      return
    }

    case 'version': {
      if (rest.length > 0) usage('release:version takes no arguments')
      const workspace = readWorkspace(ROOT)
      const current = fixedVersion(workspace)
      const pre = readPre(ROOT)
      const changesets = readChangesets(ROOT, publicPackages(workspace))
      const version = nextVersion({
        current,
        pre,
        releases: changesets.flatMap((changeset) => changeset.releases),
      })
      if (version === null) {
        console.log(`release: nothing to release, staying at ${current}`)
        return
      }
      writeRelease({
        root: ROOT,
        workspace,
        version,
        changesets,
        date: new Date().toISOString().slice(0, 10),
      })
      console.log(`release: ${current} -> ${version} (${changesets.length} changeset(s), dist-tag ${distTagFor(version)})`)
      return
    }

    case 'check': {
      const { values } = parse(rest, { version: { type: 'string' } })
      const expectedVersion = values.version
      const { version, distTag } = checkWorkspace(ROOT, { expectedVersion })
      console.log(`release: ok, version ${version}, dist-tag ${distTag}`)
      return
    }

    case 'dist-tag': {
      const { positionals } = parse(rest)
      if (positionals.length !== 1) usage('dist-tag needs exactly one version')
      console.log(distTagFor(positionals[0]))
      return
    }

    case 'pre': {
      const { positionals } = parse(rest)
      if (positionals.length !== 1) usage('release:pre needs exactly one stable base version, e.g. 1.0.0')
      const file = writePre(ROOT, positionals[0])
      console.log(`release: entered alpha pre mode for ${positionals[0]} (${path.relative(ROOT, file)})`)
      return
    }

    case 'pre-exit': {
      if (rest.length > 0) usage('release:pre-exit takes no arguments')
      const file = removePre(ROOT)
      console.log(`release: left pre mode (${path.relative(ROOT, file)} removed); run release:version to write the stable version`)
      return
    }

    default:
      usage(command === undefined ? 'missing command' : `unknown command "${command}"`)
  }
}

try {
  main(process.argv.slice(2))
}
catch (error) {
  if (error instanceof ReleaseError) {
    console.error(`release: ${error.message}`)
    process.exit(1)
  }
  throw error
}
