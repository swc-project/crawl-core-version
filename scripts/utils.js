import fs from 'fs/promises'    
import path from 'path'

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
