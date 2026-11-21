import fs from 'fs/promises'
import path from 'path'
import { $ } from 'zx'
import { memoize } from 'lodash-es'
import { RepoUrlSchema } from './schemas.js'

$.verbose = true
$.env = {
    ...process.env,
    LANG: 'C',
    // The crawled repositories are untrusted. Never prompt for credentials,
    // never fetch LFS objects, and allow only https for clone and fetch.
    GIT_TERMINAL_PROMPT: '0',
    GIT_LFS_SKIP_SMUDGE: '1',
    GIT_ALLOW_PROTOCOL: 'https',
}


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
    try{
        // lstat: do not follow a symlink out of the repository
        if ((await fs.lstat(path.join(dir, 'Cargo.lock'))).isFile()) {
            yield path.join(dir, 'Cargo.lock')
        }
    } catch (ignored) { }

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
    // The URL must not be read as a git option, such as `--upload-pack=...`.
    RepoUrlSchema.parse(repo)

    const $$ = $({ cwd: wsDir });


    let defaultBranch = memoize(async () => {
        return (await $$`git remote show origin | sed -n '/HEAD branch/s/.*: //p'`).text().trim()
    })

    try {
        // core.symlinks=false checks out symlinks as plain files, so a crawled
        // repository cannot make the scripts read files outside of it.
        await $$`git clone -c core.symlinks=false -- ${repo} .`
    } catch (e) {
        console.error(`Failed to clone ${repo} into ${wsDir}`)
        await $$`git config core.symlinks false`
        await $$`git fetch origin -p`

        console.info(`Default branch: ${await defaultBranch()}`)

        await $$`git reset --hard origin/${await defaultBranch()}`
    }
    const latestCommit = (await $$`git rev-parse HEAD`).text().trim()

    console.info(`Repository is now ready.`);

    return { defaultBranch, latestCommit }
}

/**
 * Runs `fn` and reports a failure without stopping the other targets.
 *
 * @param {string} target
 * @param {() => Promise<void>} fn
 */
export async function isolate(target, fn) {
    try {
        await fn()
    } catch (e) {
        console.error(`::error::Failed to crawl ${target}`)
        console.error(e)
        process.exitCode = 1
    }
}
