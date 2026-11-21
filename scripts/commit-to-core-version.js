import fs from 'fs/promises'
import path from 'path'
import { $ } from 'zx'
import * as toml from 'toml'
import { findCargoLockFiles, asArray } from './utils.js'
import { CoreVersionsCacheSchema as CacheSchema, CommitSchema, TagSchema, VersionSchema } from './schemas.js'

/**
 * 
 * @param {string} reopDir 
 * @param {string} cacheDir 
 * @param {string[]} allCommits 
 * @returns 
 */
export async function getCoreVersions(repoDir, cacheDir, allCommits) {
    const cacheFile = path.join(cacheDir, 'core-versions.json')
    let cacheJson;
    try {
        cacheJson = JSON.parse(await fs.readFile(cacheFile, 'utf8'))
    } catch (ignored) {
    }
    const cache = CacheSchema.safeParse(cacheJson)

    const versions = {}

    if (cache.success) {
        // Check if the cache contains all commits
        if (Object.keys(cache.data.versions).length === allCommits.length) {
            return cache.data.versions
        }
        // Use cache
        for (const [commit, version] of Object.entries(cache.data.versions)) {
            versions[commit] = version
        }
    }

    for (const commit of allCommits) {
        if (Object.prototype.hasOwnProperty.call(versions, commit)) {
            continue
        }
        if (!CommitSchema.safeParse(commit).success && !TagSchema.safeParse(commit).success) {
            console.log(`Skipping invalid commit ${JSON.stringify(commit)}`)
            continue
        }
        const version = await getCoreVersion(repoDir, commit)
        versions[commit] = version

        if (Object.keys(versions).length % 10 === 0) {
            await fs.writeFile(cacheFile, JSON.stringify(CacheSchema.parse({
                versions,
            }), null, 2));
        }
    }

    await fs.writeFile(cacheFile, JSON.stringify(CacheSchema.parse({
        versions,
    }), null, 2));

    return versions
}

/**
 * 
 * @param {string} repoDir 
 * @param {string} commit 
 * @returns string | null
 */
async function getCoreVersion(repoDir, commit) {
    const $$ = $({ cwd: repoDir });
    const relativePathToCargoLock = 'Cargo.lock'

    let cargoLock;
    try {
        // This will throw if the file does not exist at the time of the commit

        // Note: This is very verbose, but it fails if we disable verbose logging
        cargoLock = await $$`git show --end-of-options ${commit}:${relativePathToCargoLock}`.text();
    } catch (ignored) {
        try {
            // Checkout the commit, and 
            await $$`git checkout --end-of-options ${commit}`;
        } catch (ignored) {
            return null
        }
        const cargoLockFiles = await asArray(findCargoLockFiles(repoDir))

        const swcCoreVersions = await Promise.all(cargoLockFiles.map(async (file) => {
            const content = await fs.readFile(file, 'utf8')

            return tryCargoLock(content)
        }));

        const versions = [...new Set(swcCoreVersions.filter(Boolean))]
        if (versions.length === 1) {
            return versions[0]
        }
        console.log(`Found multiple versions for commit ${commit}: ${versions.join(', ')}`)
        return null;
    }


    return tryCargoLock(cargoLock);
}

/**
 * 
 * @param {string} content 
 * @returns {string | null}
 */
function tryCargoLock(content) {
    let parsed;
    try {
        parsed = toml.parse(content);
    } catch (e) {
        console.log(`Failed to parse Cargo.lock`)
        return null
    }
    const packages = Array.isArray(parsed.package) ? parsed.package : [];

    for (const pkg of packages) {
        if (pkg?.name === "swc_core") {
            if (!VersionSchema.safeParse(pkg.version).success) {
                console.log(`Ignoring invalid swc_core version ${JSON.stringify(pkg.version)}`)
                return null
            }
            const swcCoreVersion = pkg.version;

            console.log(`Found swc_core version ${swcCoreVersion}`);
            return swcCoreVersion
        }
    }

    return null;
}