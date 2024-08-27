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
import { z } from 'zod';


const RuntimeSchema = z.object({
  name: z.string(),
  repo: z.string(),
  path: z.string().nullish(),
});


const CacheSchema = z.object({
  commit: z.string().describe('The commit hash of the last checked commit'),
  packageVersions: z.record(z.string(), z.record(z.string(), z.string()))
})

const workspaceDir = path.resolve('.workspace');
await fs.mkdir(workspaceDir, { recursive: true });

for (const runtimeFile of await fs.readdir('pkgs/runtimes')) {
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

  const cacheDir = path.join('cache', 'runtimes', name)
  await fs.mkdir(cacheDir, { recursive: true });

  const cacheFile = path.join(cacheDir, 'commits.json')
  let cacheJson;
  try {
    cacheJson = JSON.parse(await fs.readFile(cacheFile, 'utf8'))
  } catch (ignored) {
  }
  const cache = CacheSchema.safeParse(cacheJson)

  console.info(`Cloning ${runtime.repo} into ${wsDir}`)

  const $$ = $({ cwd: wsDir });

  const { defaultBranch, latestCommit } = await cloneRepo(runtime.repo, wsDir)

  const repositoryRoot = (await $$`git rev-parse --show-toplevel`.text()).trim();
  const cargoLockPath = path.resolve(`${runtimeDir}/Cargo.lock`);
  const relativePathToCargoLock = path.relative(repositoryRoot, cargoLockPath);

  console.log("Runtime name:", runtime.name);
  console.log("Runtime dir:", runtimeDir);
  console.log("Repository root:", repositoryRoot);
  console.log("Cargo.lock path:", cargoLockPath);
  console.log("Relative path to Cargo.lock:", relativePathToCargoLock);

  // Get all git tags
  const gitTags = (await $$`git tag`.text()).trim().split("\n").reverse();

  const data = {
    runtime: runtime.name,
    versions: [],
  };

  // For each tag, get the content of `${runtimeDir}/Cargo.lock`.
  for (const tag of gitTags) {
    let tagVersion = tag.replace("v", "").replace("@farmfe/core@", "");
    if (!semver.valid(tagVersion)) {
      console.log(`Skipping tag ${tag} because it is not a valid semver`);
      continue;
    }

    try {
      const cargoLock =
        await $$`git show ${tag}:${relativePathToCargoLock}`.text();

      const parsed = toml.parse(cargoLock);
      const packages = parsed.package;

      for (const pkg of packages) {
        if (pkg.name === "swc_core") {
          const swcCoreVersion = pkg.version;

          data.versions.push({
            version: tagVersion,
            swcCoreVersion,
          });
          console.log(`Found swc_core version ${swcCoreVersion} for tag ${tag}`);
        }
      }


    } catch (e) {
      console.error(`Failed to parse Cargo.lock for tag ${tag}: ${e}`);
    }
  }


}


