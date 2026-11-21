#!/usr/bin/env node
// Sends the payloads that `runtime.js` and `wasm-plugin.js` wrote to
// plugins.swc.rs. This is the only script that reads CRAWL_SECRET, so the
// secret is never visible to the jobs that process crawled repositories.
import fs from 'node:fs/promises'
import path from 'node:path'
import 'dotenv/config'
import { PayloadSchema } from './schemas.js'

const token = process.env.CRAWL_SECRET
if (!token) {
    console.info('CRAWL_SECRET is not set. Nothing is published.')
    process.exit(0)
}

for (const kind of ['runtimes', 'wasm-plugins']) {
    const dir = path.join('payloads', kind)
    let files
    try {
        files = await fs.readdir(dir)
    } catch (ignored) {
        console.info(`No payloads in ${dir}`)
        continue
    }

    for (const file of files) {
        const { pkgs } = PayloadSchema.parse(JSON.parse(await fs.readFile(path.join(dir, file), 'utf8')))

        for (const pkg of pkgs) {
            console.log(`Updating ${pkg.name}`);

            const res = await fetch(`https://plugins.swc.rs/api/update/${kind}`, {
                method: 'POST',
                body: JSON.stringify({
                    token,
                    pkgs: [pkg],
                })
            })
            if (!res.ok) {
                console.error(`::error::Failed to update ${pkg.name}: ${res.status} ${res.statusText}`)
                process.exitCode = 1
            }
        }
    }
}
