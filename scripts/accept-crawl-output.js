#!/usr/bin/env node
// Copies the crawl output (`cache/` and `payloads/`) from the downloaded
// artifacts into this checkout, after it validates each file.
//
// The crawl jobs process untrusted repositories, so their output is
// untrusted. Only the files that the targets in `pkgs/` can make are
// accepted, and only when they match the schemas.
//
// Usage: node scripts/accept-crawl-output.js <dir with one directory per artifact>
import fs from 'node:fs/promises'
import path from 'node:path'
import {
    CommitsCacheSchema,
    CoreVersionsCacheSchema,
    PayloadSchema,
    loadPlugins,
    loadRuntimes,
} from './schemas.js'

const MAX_FILE_SIZE = 64 * 1024 * 1024

const inputDir = process.argv[2]
if (!inputDir) {
    console.error('Usage: node scripts/accept-crawl-output.js <dir>')
    process.exit(1)
}

/** @type {{ file: string, validate: (data: unknown) => unknown }[]} */
const expected = []

for (const { file, runtime } of await loadRuntimes()) {
    expected.push({ file: path.join('cache', 'runtimes', file, 'core-versions.json'), validate: (d) => CoreVersionsCacheSchema.parse(d) })
    expected.push({ file: path.join('payloads', 'runtimes', `${file}.json`), validate: (d) => validatePayload(d, [runtime.name]) })
}
for (const { name, plugin } of await loadPlugins()) {
    expected.push({ file: path.join('cache', 'wasm-plugins', name, 'commits.json'), validate: (d) => validateCommits(d, plugin.packages) })
    expected.push({ file: path.join('cache', 'wasm-plugins', name, 'core-versions.json'), validate: (d) => CoreVersionsCacheSchema.parse(d) })
    expected.push({ file: path.join('payloads', 'wasm-plugins', `${name}.json`), validate: (d) => validatePayload(d, plugin.packages) })
}

let failed = false

for (const artifact of await fs.readdir(inputDir, { withFileTypes: true })) {
    if (!artifact.isDirectory()) {
        continue
    }
    for (const { file, validate } of expected) {
        const source = path.join(inputDir, artifact.name, file)
        let stat
        try {
            stat = await fs.lstat(source)
        } catch (ignored) {
            continue
        }
        try {
            if (!stat.isFile()) {
                throw new Error('Not a regular file')
            }
            if (stat.size > MAX_FILE_SIZE) {
                throw new Error(`File is larger than ${MAX_FILE_SIZE} bytes`)
            }
            const data = validate(JSON.parse(await fs.readFile(source, 'utf8')))

            await fs.mkdir(path.dirname(file), { recursive: true })
            await fs.writeFile(file, JSON.stringify(data, null, 2))
            console.info(`Accepted ${file}`)
        } catch (e) {
            console.error(`::error::Rejected ${path.join(artifact.name, file)}`)
            console.error(e)
            failed = true
        }
    }
}

if (failed) {
    process.exit(1)
}

/**
 * @param {unknown} data
 * @param {string[]} packages
 */
function validateCommits(data, packages) {
    const parsed = CommitsCacheSchema.parse(data)
    for (const name of Object.keys(parsed.packageVersions)) {
        if (!packages.includes(name)) {
            throw new Error(`Unexpected package ${name}`)
        }
    }
    return parsed
}

/**
 * @param {unknown} data
 * @param {string[]} packages
 */
function validatePayload(data, packages) {
    const parsed = PayloadSchema.parse(data)
    for (const { name } of parsed.pkgs) {
        if (!packages.includes(name)) {
            throw new Error(`Unexpected package ${name}`)
        }
    }
    return parsed
}
