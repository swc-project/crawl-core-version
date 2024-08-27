import fs from 'fs/promises'
import path from 'path'
import { z } from 'zod'
import { $ } from 'zx'

const CacheSchema = z.object({
    // commit -> version
    versions: z.record(z.string(), z.string())
})

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
        if (versions[commit]) {
            continue
        }
        const version = await getCoreVersion(reopDir, commit)
        versions[commit] = version
    }

    await fs.writeFile(cacheFile, JSON.stringify(CacheSchema.parse({
        versions,
    }), null, 2));
}

/**
 * 
 * @param {string} reopDir 
 * @param {string} commit 
 * @returns 
 */
async function getCoreVersion(reopDir, commit) {
    const $$ = $({ cwd: reopDir });

    

}