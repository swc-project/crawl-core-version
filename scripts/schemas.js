// Schemas for every value that comes from a crawled repository, npm, or a
// cache file. Those values are untrusted: they are passed to git as
// arguments, committed to this repository, and published to plugins.swc.rs.
import fs from 'node:fs/promises'
import semver from 'semver'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'

// A full git object name (SHA-1 or SHA-256). It can never be read as a git
// option or as a path.
export const CommitSchema = z.string().regex(/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/, 'Invalid commit hash')

// A plain semver version, as used in package.json and Cargo.lock.
export const VersionSchema = z.string().refine((v) => semver.valid(v) === v, 'Invalid semver version')

// A release tag, such as `v1.2.3`.
export const TagSchema = z.string().refine(
    (v) => v.startsWith('v') && semver.valid(v) === v.slice(1),
    'Invalid release tag'
)

export const PackageNameSchema = z.string().regex(
    /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/,
    'Invalid npm package name'
)

export const RepoUrlSchema = z.string().regex(
    /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/,
    'Repository must be an https://github.com/<owner>/<repo> URL'
)

export const RuntimeSchema = z.object({
    name: PackageNameSchema,
    repo: RepoUrlSchema,
    path: z.string().regex(/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/, 'Invalid relative path').nullish(),
}).strict()

export const PluginSchema = z.object({
    repo: RepoUrlSchema,
    packages: z.array(PackageNameSchema),
}).strict()

// cache/wasm-plugins/<name>/commits.json
export const CommitsCacheSchema = z.object({
    commit: CommitSchema.describe('The commit hash of the last checked commit'),
    packageVersions: z.record(PackageNameSchema, z.record(VersionSchema, CommitSchema)),
}).strict()

// cache/**/core-versions.json
export const CoreVersionsCacheSchema = z.object({
    // commit or tag -> swc_core version
    versions: z.record(z.union([CommitSchema, TagSchema]), VersionSchema.nullable()),
}).strict()

// payloads/**/*.json: the data to send to plugins.swc.rs
export const PayloadSchema = z.object({
    pkgs: z.array(z.object({
        name: PackageNameSchema,
        versions: z.array(z.object({
            version: z.union([VersionSchema, TagSchema]),
            swcCoreVersion: VersionSchema,
        }).strict()),
    }).strict()),
}).strict()

/**
 * @returns {Promise<{ file: string, runtime: z.infer<typeof RuntimeSchema> }[]>}
 */
export async function loadRuntimes() {
    const result = []
    for (const file of await fs.readdir('pkgs/runtimes')) {
        const runtime = RuntimeSchema.parse(parseYaml(await fs.readFile(`pkgs/runtimes/${file}`, 'utf8')))
        result.push({ file, runtime })
    }
    return result
}

/**
 * @returns {Promise<{ name: string, plugin: z.infer<typeof PluginSchema> }[]>}
 */
export async function loadPlugins() {
    const result = []
    for (const file of await fs.readdir('pkgs/plugins')) {
        if (!file.endsWith('.yml')) {
            continue
        }
        const plugin = PluginSchema.parse(parseYaml(await fs.readFile(`pkgs/plugins/${file}`, 'utf8')))
        result.push({ name: file.slice(0, -'.yml'.length), plugin })
    }
    return result
}
