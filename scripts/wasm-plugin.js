#!/usr/bin/env node
import { $ } from "zx";
import fs from 'node:fs/promises'
import { parse as parseYaml, } from 'yaml'
import { z } from 'zod'
import path from "node:path";
import { memoize } from 'lodash-es'
import { getCoreVersions } from './commit-to-core-version.js'
import { findPackageJsonFiles, asArray } from './utils.js'
import 'dotenv/config'

$.verbose = true
$.env = {
    ...process.env,
    LANG: 'C'
}




// We iterate over all commits from the main branch, in reverse order
//
// We grab the version from the package.json files, and use it to determine the commit for a given npm version


const workspaceDir = path.resolve('.workspace');
await fs.mkdir(workspaceDir, { recursive: true });

const PluginSchema = z.object({
    repo: z.string(),
    packages: z.array(z.string())
});

const CacheSchema = z.object({
    commit: z.string().describe('The commit hash of the last checked commit'),
    packageVersions: z.record(z.string(), z.record(z.string(), z.string()))
})

for (const pkg of await fs.readdir('pkgs/plugins')) {
    const packageVersions = {};

    const { name } = path.parse(pkg);

    const pkgYmlPath = `pkgs/plugins/${pkg}`
    const pkgYml = parseYaml(await fs.readFile(pkgYmlPath, 'utf8'));
    const plugin = PluginSchema.parse(pkgYml);

    const wsDir = path.join(workspaceDir, name)
    await fs.mkdir(wsDir, { recursive: true });

    const cacheDir = path.join('cache', 'wasm-plugins', name)
    await fs.mkdir(cacheDir, { recursive: true });

    const cacheFile = path.join(cacheDir, 'commits.json')
    let cacheJson;
    try {
        cacheJson = JSON.parse(await fs.readFile(cacheFile, 'utf8'))
    } catch (ignored) {
    }
    const cache = CacheSchema.safeParse(cacheJson)

    console.info(`Cloning ${plugin.repo} into ${wsDir}`)

    const $$ = $({ cwd: wsDir });

    let defaultBranch = memoize(async () => {
        return (await $$`git remote show origin | sed -n '/HEAD branch/s/.*: //p'`).text().trim()
    })

    try {
        await $$`git clone ${plugin.repo} .`
    } catch (e) {
        console.error(`Failed to clone ${plugin.repo} into ${wsDir}`)
        await $$`git fetch origin -p`

        console.info(`Default branch: ${await defaultBranch()}`)

        await $$`git reset --hard origin/${await defaultBranch()}`
    }

    const latestCommit = (await $$`git rev-parse HEAD`).text().trim()

    console.info(`Repository is now ready.`);

    if (cache.success) {
        const commit = cache.data.commit
        await $$`git checkout ${commit}`
        console.info(`Resuming from '${commit}'`)

        for (const [pkg, versions] of Object.entries(cache.data.packageVersions)) {
            packageVersions[pkg] = versions
        }
    } else {
        const firstCommit = (await $$`git rev-list --max-parents=0 HEAD`).text().trim()
        console.info(`Checking out the first commit: '${firstCommit}' (No cache)`)
        await $$`git checkout ${firstCommit}`
    }

    const baseBranch = await defaultBranch()

    // Get git heads from npm
    for (const pkg of plugin.packages) {
        const data = await (await fetch(`https://registry.npmjs.org/${pkg}`)).json();

        for (const [version, obj] of Object.entries(data.versions)) {
            if (obj.gitHead) {
                if (!packageVersions[pkg]) {
                    packageVersions[pkg] = {}
                }

                const map = packageVersions[pkg];
                if (!map[version]) {
                    map[version] = obj.gitHead
                }
            }
        }
    }

    // Go to the next commit, and check for the new package versions
    while (true) {
        // Move to the next commit
        await $$`git log --reverse --pretty=%H ${baseBranch} | grep -A 1 $(git rev-parse HEAD) | tail -1 | xargs git checkout`

        const commit = (await $$`git rev-parse HEAD`).text().trim()
        const packageJsonFiles = await asArray(findPackageJsonFiles(wsDir))

        for (const pkg of packageJsonFiles) {
            let pkgJson;
            try {
                pkgJson = JSON.parse(await fs.readFile(pkg, 'utf8'))
            } catch (ignored) {
                console.log(`Failed to read package.json for ${pkg}`)
                continue
            }
            if (!plugin.packages.includes(pkgJson.name)) {
                continue
            }
            console.info(`Found '${pkgJson.name}'`)

            const version = pkgJson.version;

            if (!packageVersions[pkgJson.name]) {
                packageVersions[pkgJson.name] = {}
            }

            // Only for the first commit of a package
            const map = packageVersions[pkgJson.name];
            if (!map[version]) {
                map[version] = commit
            }

        }

        if (latestCommit === commit) {
            break
        }
    }

    // Write cache
    await fs.writeFile(cacheFile, JSON.stringify(CacheSchema.parse({
        commit: latestCommit,
        packageVersions: packageVersions
    }), null, 2));

    // Now we collect the version of `swc_core`
    const allCommits = Object.values(packageVersions).flatMap(pkg => Object.values(pkg))
    const uniqueCommits = [...new Set(allCommits)]

    // Reset to the latest commit
    await $$`git checkout ${baseBranch}`

    const coreVersions = await getCoreVersions(wsDir, cacheDir, uniqueCommits);

    if (process.env.CRAWL_SECRET) {
        const pkgs = [];
        for (const pkg of plugin.packages) {
            const versions = packageVersions[pkg];
            for (const [version, commit] of Object.entries(versions)) {
                if (!coreVersions[commit]) {
                    delete versions[version]
                }
            }
            const pkgVersions = Object.entries(versions).map(([version, commit]) => ({
                version,
                swcCoreVersion: coreVersions[commit]
            }))
            pkgs.push({
                name: pkg,
                versions: pkgVersions
            })
        }


        await fetch(`http://localhost:50000/api/update/wasm-plugins`, {
            method: 'POST',
            body: JSON.stringify({
                token: process.env.CRAWL_SECRET,
                pkgs,
            })
        })
    }

    console.log(coreVersions)
}


