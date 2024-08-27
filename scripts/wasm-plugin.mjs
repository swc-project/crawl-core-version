#!/usr/bin/env node
import { $ } from "zx";
import fs from 'node:fs/promises'
import { parse as parseYaml, } from 'yaml'
import { z } from 'zod'
import path from "node:path";
import {memoize} from 'lodash-es'

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
    const { name } = path.parse(pkg);

    const pkgYmlPath = `pkgs/plugins/${pkg}`
    const pkgYml = parseYaml(await fs.readFile(pkgYmlPath, 'utf8'));
    const plugin = PluginSchema.parse(pkgYml);

    const wsDir = path.join(workspaceDir, name)
    await fs.mkdir(wsDir, { recursive: true });

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

    console.info(`Repository is now ready`);

    const packageJsonFiles = await asArray(findPackageJsonFiles(wsDir))

    for(const pkg of packageJsonFiles) {
        const pkgJson = JSON.parse(await fs.readFile(pkg, 'utf8'))
        if(!plugin.packages.includes(pkgJson.name)) {
            continue
        }
        console.info(`Found '${pkgJson.name}'`)
    }

}