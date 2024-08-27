import fs from 'fs/promises'
import path from 'path'
import { $ } from 'zx'
import { memoize } from 'lodash-es'

export async function* walk(dir) {
    for await (const d of await fs.opendir(dir)) {
        const entry = path.join(dir, d.name);
        if (d.isDirectory()) yield* walk(entry);
        else if (d.isFile()) yield entry;
    }
}

export async function* findPackageJsonFiles(dir) {
    for await (const file of walk(dir)) {
        if (path.basename(file) === 'package.json') {
            yield file
        }
    }
}

export async function* findCargoLockFiles(dir) {
    for await (const file of walk(dir)) {
        if (path.basename(file) === 'Cargo.lock') {
            yield file
        }
    }
}

export async function asArray(asyncIterable) {
    const arr = []
    for await (const item of asyncIterable) {
        arr.push(item)
    }
    return arr
}

export async function cloneRepo(repo, wsDir) {
    const $$ = $({ cwd: wsDir });


    let defaultBranch = memoize(async () => {
        return (await $$`git remote show origin | sed -n '/HEAD branch/s/.*: //p'`).text().trim()
    })

    try {
        await $$`git clone ${repo} .`
    } catch (e) {
        console.error(`Failed to clone ${repo} into ${wsDir}`)
        await $$`git fetch origin -p`

        console.info(`Default branch: ${await defaultBranch()}`)

        await $$`git reset --hard origin/${await defaultBranch()}`
    }
    const latestCommit = (await $$`git rev-parse HEAD`).text().trim()

    console.info(`Repository is now ready.`);

    return { defaultBranch, latestCommit }
}
