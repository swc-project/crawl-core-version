#!/usr/bin/env zx
//
// Run this script using an absolute path to the runtime directory.
import { parse as parseYaml, } from 'yaml'
import path from "path";
import semver from "semver";
import toml from "toml";
import { $ } from "zx";
import 'dotenv/config'
import fs from 'fs/promises';
import { cloneRepo } from './utils.js'
import { getCoreVersions } from './commit-to-core-version.js';
import { z } from 'zod';



const RuntimeSchema = z.object({
  name: z.string(),
  repo: z.string(),
  path: z.string().nullish(),
});

const workspaceDir = path.resolve('.workspace');
await fs.mkdir(workspaceDir, { recursive: true });

for (const runtimeFile of await fs.readdir('pkgs/runtimes')) {
  const packageVersions = {};

  const pkgYmlPath = `pkgs/runtimes/${runtimeFile}`
  const pkgYml = parseYaml(await fs.readFile(pkgYmlPath, 'utf8'));
  const runtime = RuntimeSchema.parse(pkgYml);

  const { name } = runtime;

  const wsDir = path.join(workspaceDir, name)
  await fs.mkdir(wsDir, { recursive: true });

  let runtimeDir = wsDir;
  if (runtime.path) {
    runtimeDir = path.join(wsDir, runtime.path)
  }

  const cacheDir = path.join('cache', 'runtimes', runtimeFile)
  await fs.mkdir(cacheDir, { recursive: true });

  console.info(`Cloning ${runtime.repo} into ${wsDir}`)

  const $$ = $({ cwd: wsDir });

  const { defaultBranch, latestCommit } = await cloneRepo(runtime.repo, wsDir)

  // const repositoryRoot = (await $$`git rev-parse --show-toplevel`.text()).trim();
  // const cargoLockPath = path.resolve(`${runtimeDir}/Cargo.lock`);
  // const relativePathToCargoLock = path.relative(repositoryRoot, cargoLockPath);

  // console.log("Runtime name:", runtime.name);
  // console.log("Runtime dir:", runtimeDir);
  // console.log("Repository root:", repositoryRoot);
  // console.log("Cargo.lock path:", cargoLockPath);
  // console.log("Relative path to Cargo.lock:", relativePathToCargoLock);

  // Get all git tags
  const gitTags = (await $$`git tag`.text()).trim().split("\n").filter(Boolean).filter(tag => tag.startsWith("v")).reverse();

  const coreVersions = await getCoreVersions(runtimeDir, cacheDir, gitTags);
  console.log(coreVersions);



  if (process.env.CRAWL_SECRET) {
    const pkgs = []
    const pkg = runtime.name;
    const pkgVersions = gitTags.map((tag) => ({
      version: tag,
      swcCoreVersion: coreVersions[tag]
    }));

    pkgs.push({
      name: pkg,
      versions: pkgVersions
    });


    await fetch(`https://plugins.swc.rs/api/update/runtimes`, {
      method: 'POST',
      body: JSON.stringify({
        token: process.env.CRAWL_SECRET,
        pkgs,
      })
    })
  }


}


