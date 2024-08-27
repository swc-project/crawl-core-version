#!/usr/bin/env node
import { $ } from "zx";
import fs from 'node:fs/promises'
import { parse as parseYaml, } from 'yaml'
import { z } from 'zod'
import path from "node:path";
import { memoize } from 'lodash-es'

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

async function* walk(dir) {
    for await (const d of await fs.opendir(dir)) {
        const entry = path.join(dir, d.name);
        if (d.isDirectory()) yield* walk(entry);
        else if (d.isFile()) yield entry;
    }
}

async function* findPackageJsonFiles(dir) {
    for await (const file of walk(dir)) {
        if (path.basename(file) === 'package.json') {
            yield file
        }
    }
}

async function asArray(asyncIterable) {
    const arr = []
    for await (const item of asyncIterable) {
        arr.push(item)
    }
    return arr
}


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

    const cacheFile = path.join(cacheDir, 'cache.json')
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


    // Go to the next commit, and check for the new package versions
    while (true) {
        // Move to the next commit
        await $$`git log --reverse --pretty=%H ${baseBranch} | grep -A 1 $(git rev-parse HEAD) | tail -1 | xargs git checkout`

        const commit = (await $$`git rev-parse HEAD`).text().trim()
        const packageJsonFiles = await asArray(findPackageJsonFiles(wsDir))

        for (const pkg of packageJsonFiles) {
            const pkgJson = JSON.parse(await fs.readFile(pkg, 'utf8'))
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
    console.log(packageVersions)
    await fs.writeFile(cacheFile, JSON.stringify(CacheSchema.parse({
        commit: latestCommit,
        packageVersions: packageVersions
    }), null, 2))
}
