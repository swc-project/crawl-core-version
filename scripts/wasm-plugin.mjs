#!/usr/bin/env node
import { $ } from "zx";
import fs from 'node:fs/promises'
import { parse as parseYaml,  } from 'yaml'
import {z }from 'zod'

// We iterate over all commits from the main branch, in reverse order
//
// We grab the version from the package.json files, and use it to determine the commit for a given npm version

const PluginSchema = z.object({
    repo: z.string(),
    packages: z.array(z.string())
})

for(const pkg of await fs.readdir('pkgs/plugins')) {
    const pkgYmlPath = `pkgs/plugins/${pkg}`
    const pkgYml = parseYaml(await fs.readFile(pkgYmlPath, 'utf8'));
    const plugin = PluginSchema.parse(pkgYml);

    console.log(plugin)
}