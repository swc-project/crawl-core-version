#!/usr/bin/env node
import { $ } from "zx";
import fs from 'node:fs/promises'
import path from "node:path";
import { getCoreVersions } from './commit-to-core-version.js'
import { findPackageJsonFiles, asArray, cloneRepo, isolate } from './utils.js'
import { CommitSchema, CommitsCacheSchema as CacheSchema, VersionSchema, loadPlugins } from './schemas.js'
import 'dotenv/config'




// We iterate over all commits from the main branch, in reverse order
//
// We grab the version from the package.json files, and use it to determine the commit for a given npm version


const workspaceDir = path.resolve('.workspace');
await fs.mkdir(workspaceDir, { recursive: true });

for (const { name, plugin } of await loadPlugins()) {
    await isolate(name, () => crawlPlugin(name, plugin))
}

async function crawlPlugin(name, plugin) {
    const packageVersions = {};

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

    const { latestCommit } = await cloneRepo(plugin.repo, wsDir)

    // All commits up to the latest one, oldest first
    const history = (await $$`git log --reverse --pretty=%H ${latestCommit}`).text().trim().split('\n')
    let start = 0

    if (cache.success) {
        const commit = cache.data.commit
        const index = history.indexOf(commit)
        if (index === -1) {
            // The history was rewritten. Check all commits again.
            console.warn(`Cached commit '${commit}' is not in the history. Checking all commits.`)
        } else {
            console.info(`Resuming from '${commit}'`)
            start = index + 1
        }

        for (const [pkg, versions] of Object.entries(cache.data.packageVersions)) {
            packageVersions[pkg] = versions
        }
    } else {
        console.info(`Checking all commits (No cache)`)
    }

    // Get git heads from npm
    for (const pkg of plugin.packages) {
        const res = await fetch(`https://registry.npmjs.org/${pkg}`);
        if (!res.ok) {
            throw new Error(`Failed to fetch ${pkg} from npm: ${res.status}`)
        }
        const data = await res.json();

        for (const [version, obj] of Object.entries(data.versions ?? {})) {
            if (obj.gitHead) {
                // Anyone who can publish the package controls these values
                if (!VersionSchema.safeParse(version).success || !CommitSchema.safeParse(obj.gitHead).success) {
                    console.log(`Ignoring invalid gitHead of ${pkg}@${JSON.stringify(version)}`)
                    continue
                }

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

    // Check each new commit for the new package versions
    for (const commit of history.slice(start)) {
        await $$`git checkout --detach ${commit}`

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
            if (!VersionSchema.safeParse(version).success) {
                console.log(`Ignoring invalid version ${JSON.stringify(version)}`)
                continue
            }

            if (!packageVersions[pkgJson.name]) {
                packageVersions[pkgJson.name] = {}
            }

            // Only for the first commit of a package
            const map = packageVersions[pkgJson.name];
            if (!map[version]) {
                map[version] = commit
            }

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
    await $$`git checkout --detach ${latestCommit}`

    const coreVersions = await getCoreVersions(wsDir, cacheDir, uniqueCommits);

    if (process.env.CRAWL_SECRET) {
        for (const pkg of plugin.packages) {
            console.log(`Updating ${pkg}`);

            const pkgs = [];
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
            });
            await fetch(`https://plugins.swc.rs/api/update/wasm-plugins`, {
                method: 'POST',
                body: JSON.stringify({
                    token: process.env.CRAWL_SECRET,
                    pkgs,
                })
            })
        }
    }

    console.log(coreVersions)
}
