# tsc — Find the Bug

> 12 exercises focused on **mistakes in using `tsc`** — wrong CLI invocations, broken configs, misread output, and CI gates that don't actually gate. Each shows buggy code/config/command, an explanation, and a fix. Difficulty: 🟢 easy, 🟡 medium, 🔴 hard.

## Table of Contents

1. [Bug 1 — tsconfig Ignored by a File Argument 🟢](#bug-1--tsconfig-ignored-by-a-file-argument-)
2. [Bug 2 — CI Gate That Never Fails 🟢](#bug-2--ci-gate-that-never-fails-)
3. [Bug 3 — Bundler "Build" With No Type Check 🟢](#bug-3--bundler-build-with-no-type-check-)
4. [Bug 4 — Output Polluting the Source Tree 🟢](#bug-4--output-polluting-the-source-tree-)
5. [Bug 5 — Mixing `-p` With File Arguments 🟡](#bug-5--mixing--p-with-file-arguments-)
6. [Bug 6 — Shipping Broken JS 🟡](#bug-6--shipping-broken-js-)
7. [Bug 7 — `composite` + `noEmit` Conflict 🟡](#bug-7--composite--noemit-conflict-)
8. [Bug 8 — Empty `include` 🟡](#bug-8--empty-include-)
9. [Bug 9 — Plain `tsc` in a References Repo 🟡](#bug-9--plain-tsc-in-a-references-repo-)
10. [Bug 10 — Reference Cycle 🔴](#bug-10--reference-cycle-)
11. [Bug 11 — Stale Watch Reading `dist` 🔴](#bug-11--stale-watch-reading-dist-)
12. [Bug 12 — Global tsc Version Drift 🔴](#bug-12--global-tsc-version-drift-)
13. [Bug 13 — `extends` Path Wrong 🟡](#bug-13--extends-path-wrong-defaults-silently-used-)
14. [Bug 14 — Watch Mode in CI 🟢](#bug-14--watch-mode-in-ci-)
15. [Bug 15 — `skipLibCheck` Hiding a Conflict 🔴](#bug-15--relying-on-skiplibcheck-to-hide-a-real-conflict-)
16. [Bug 16 — `rootDir` Mismatch 🟡](#bug-16--rootdir-mismatch-flattens-or-nests-output-)
17. [Bug 17 — Missing `@types` 🟢](#bug-17--forgetting-types-for-a-js-only-dependency-)
18. [Bug 18 — Reading a Stale Artifact 🟡](#bug-18--editing-the-config-but-not-re-running-from-cold-)

---

## How to Use This File

Each exercise presents a realistic mistake exactly as it appears in the wild: a command someone typed, a `tsconfig.json` someone committed, or compiler output someone misread. For each one:

1. **Read only the buggy block first** and try to predict what `tsc` will do (or fail to do) before scrolling to the explanation.
2. **Note the symptom vs. the cause.** Many `tsc` bugs are invisible — the build "succeeds" while doing the wrong thing (ignoring the config, skipping the type check, emitting broken JS). The dangerous bugs are the silent ones.
3. **Reproduce the fix locally** when you can; confirm the exit code with `echo $?` and the resolved configuration with `tsc --showConfig`.

The recurring themes across all fifteen bugs: a **file argument silently bypasses `tsconfig.json`**, the **exit code is what gates CI** (and is easy to mask), **bundlers never type-check**, **`outDir` must live outside the included sources**, and **local and CI must use the same pinned compiler version**.

---

## Bug 1 — tsconfig Ignored by a File Argument 🟢

```bash
# BUGGY: developer wonders why outDir/strict have no effect
tsc src/index.ts
```

```json
// tsconfig.json (with outDir + strict that seem to do nothing)
{ "compilerOptions": { "outDir": "dist", "strict": true }, "include": ["src"] }
```

**What is wrong?**
Passing a file path makes `tsc` **ignore `tsconfig.json`** and use default options. So `outDir` and `strict` are silently dropped; `.js` lands next to `.ts` and strict checks don't run.

**Fix:**
```bash
# Use bare tsc (or -p) so the config is honored
tsc
# or
tsc -p tsconfig.json
```

---

## Bug 2 — CI Gate That Never Fails 🟢

```yaml
# BUGGY: this step is green even when there are type errors
- name: Type check
  run: tsc --noEmit || true
```

**What is wrong?**
`|| true` forces the step's exit code to `0`, so the non-zero code from `tsc` (which signals errors) is swallowed. The gate is decorative — it never blocks anything.

**Fix:**
```yaml
- name: Type check
  run: npx tsc --noEmit --pretty false
# (let the non-zero exit code fail the job)
```

---

## Bug 3 — Bundler "Build" With No Type Check 🟢

```json
// BUGGY package.json — "build" succeeds even with type errors
{
  "scripts": {
    "build": "esbuild src/index.ts --bundle --outfile=dist/index.js"
  }
}
```

**What is wrong?**
esbuild (like swc and Babel) only **strips** types; it never checks them. There is no `tsc` anywhere, so nothing verifies types. The build can pass with serious type bugs.

**Fix:**
```json
{
  "scripts": {
    "typecheck": "tsc --noEmit",
    "bundle": "esbuild src/index.ts --bundle --outfile=dist/index.js",
    "build": "npm run typecheck && npm run bundle"
  }
}
```

---

## Bug 4 — Output Polluting the Source Tree 🟢

```json
// BUGGY: no outDir, so .js + .js.map land next to every .ts in src/
{ "compilerOptions": { "strict": true, "sourceMap": true }, "include": ["src"] }
```

```bash
tsc
# src/index.ts  src/index.js  src/index.js.map  ...
```

**What is wrong?**
Without `outDir`, compiled files are written next to the source, cluttering the tree and risking accidental commits or `tsc` re-reading emitted `.js`.

**Fix:**
```json
{
  "compilerOptions": { "strict": true, "sourceMap": true, "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```
And add `dist/` to `.gitignore`.

---

## Bug 5 — Mixing `-p` With File Arguments 🟡

```bash
# BUGGY: combining a project flag with explicit files
tsc -p tsconfig.json src/extra.ts
```

```
error TS5042: Option 'project' cannot be mixed with source files on a command line.
```

**What is wrong?**
`-p`/`--project` selects a config that already defines the file set. You cannot also pass file arguments; `tsc` rejects the combination.

**Fix:**
```bash
# Either build the project...
tsc -p tsconfig.json
# ...or include the extra file via the config's "include"/"files".
```

---

## Bug 6 — Shipping Broken JS 🟡

```json
// BUGGY: emit happens even with errors; broken JS gets published
{ "compilerOptions": { "outDir": "dist" }, "include": ["src"] }
```

```bash
tsc        # prints errors BUT still writes dist/*.js
npm publish
```

**What is wrong?**
By default `tsc` emits output even when type errors exist. The published `dist/` can contain code that failed type checking.

**Fix:**
```json
{ "compilerOptions": { "outDir": "dist", "noEmitOnError": true }, "include": ["src"] }
```
Now a type error suppresses emit, and a non-zero exit code stops the publish script.

---

## Bug 7 — `composite` + `noEmit` Conflict 🟡

```json
// BUGGY: a referenced package set both composite and noEmit
{
  "compilerOptions": { "composite": true, "noEmit": true, "outDir": "dist" },
  "include": ["src"]
}
```

```
error TS5069: Option 'noEmit' cannot be specified with option 'composite'.
```

**What is wrong?**
`composite` requires emitting `.d.ts` so dependents can type-check against it; `noEmit` forbids emit. They are mutually exclusive.

**Fix:**
- For a **library** that participates in `--build`: drop `noEmit`, keep `composite` + `declaration`.
- For an **app leaf** that a bundler builds: drop `composite`, keep `noEmit`, and check it with `tsc --noEmit`.

---

## Bug 8 — Empty `include` 🟡

```json
// BUGGY: include points at a folder with no .ts files
{ "compilerOptions": { "strict": true }, "include": ["source"] }
```

```bash
tsc
# error TS18003: No inputs were found in config file 'tsconfig.json'.
#   Specified 'include' paths were '["source"]' and 'exclude' paths were '[]'.
```

**What is wrong?**
The glob matches no TypeScript files — likely the folder is named `src`, not `source`, or contains only `.js`.

**Fix:**
```json
{ "compilerOptions": { "strict": true }, "include": ["src"] }
```
Or add `allowJs` if you intend to compile `.js` files.

---

## Bug 9 — Plain `tsc` in a References Repo 🟡

```bash
# BUGGY: a monorepo with project references built with plain tsc
tsc
```

```
error TS6307: File 'packages/app/src/index.ts' is not listed within the file
  list of project 'packages/app/tsconfig.json'. Projects must list all files
  or use an 'include' pattern.
```

**What is wrong?**
A repo wired with `references` must be built with **build mode**, which understands the graph and per-project file lists. Plain `tsc` tries to compile a single program and fails (or under-builds).

**Fix:**
```bash
tsc --build
# or build a specific leaf:
tsc --build packages/app
```

---

## Bug 10 — Reference Cycle 🔴

```json
// packages/a/tsconfig.json
{ "compilerOptions": { "composite": true }, "references": [{ "path": "../b" }], "include": ["src"] }
```

```json
// packages/b/tsconfig.json  — references back to a
{ "compilerOptions": { "composite": true }, "references": [{ "path": "../a" }], "include": ["src"] }
```

```
error TS6202: Project references may not form a circular graph.
  Cycle detected: packages/a -> packages/b -> packages/a
```

**What is wrong?**
`a` references `b` and `b` references `a`. Build mode requires a DAG; cycles are a hard error.

**Fix:**
Extract the shared pieces into a third package and have both depend on it:
```json
// packages/a -> contracts ; packages/b -> contracts  (no a<->b edge)
{ "references": [{ "path": "../contracts" }] }
```

---

## Bug 11 — Stale Watch Reading `dist` 🔴

```json
// BUGGY: outDir is INSIDE the include path, so tsc compiles its own output
{ "compilerOptions": { "outDir": "src/build" }, "include": ["src"] }
```

```bash
tsc --watch
# every emit changes src/build/*.js, which is inside "src",
# re-triggering compilation -> a feedback loop / growing file set
```

**What is wrong?**
`outDir` lives under a path that `include` matches. Emitted files become inputs, so watch mode keeps detecting "changes" it caused itself, and `tsc` may even try to compile its own emitted `.js`.

**Fix:**
```json
{
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"],
  "exclude": ["dist"]
}
```
Keep `outDir` **outside** the included source paths.

---

## Bug 12 — Global tsc Version Drift 🔴

```yaml
# BUGGY: CI installs typescript globally, version differs from the lockfile
- run: npm install -g typescript
- run: tsc --noEmit
```

```
# Locally (project pins 5.4.5): 0 errors
# CI (global picked up 5.6.x): new errors from stricter checks -> red build
# Or the reverse: CI passes, local fails
```

**What is wrong?**
A global `tsc` is whatever version the runner happens to install, not the version pinned in `package.json`. Different compiler versions report different diagnostics, causing "works on my machine" failures.

**Fix:**
```yaml
- run: npm ci                       # installs the locked typescript
- run: npx tsc --noEmit             # uses the project's pinned version
```
Always depend on `typescript` locally and invoke via `npx`/npm scripts so local and CI agree.

---

## Bug 13 — `extends` Path Wrong, Defaults Silently Used 🟡

```json
// BUGGY: extends points at a base config that does not exist at this path
{
  "extends": "./configs/tsconfig.base",
  "compilerOptions": { "outDir": "dist" },
  "include": ["src"]
}
```

```
error TS5083: Cannot read file './configs/tsconfig.base'.
```

**What is wrong?**
The `extends` target is missing or misspelled (the file is `configs/tsconfig.base.json`, or it lives elsewhere). Until fixed, the base options (strictness, target, lib) are not applied — and if the path were merely *different* but valid, you could be inheriting the wrong settings entirely.

**Fix:**
```json
{ "extends": "./configs/tsconfig.base.json", "compilerOptions": { "outDir": "dist" }, "include": ["src"] }
```
Verify the resolved result with:
```bash
tsc --showConfig
```

---

## Bug 14 — Watch Mode in CI 🟢

```yaml
# BUGGY: CI job hangs forever
- run: tsc --watch
```

**What is wrong?**
`--watch` never exits — it stays resident waiting for file changes. In CI it just hangs until the job times out. Watch mode is for local development only.

**Fix:**
```yaml
- run: npx tsc --noEmit --pretty false   # runs once, exits with a code
```

---

## Bug 15 — Relying on `skipLibCheck` to Hide a Real Conflict 🔴

```json
// "Works" only because lib checking is skipped
{ "compilerOptions": { "skipLibCheck": true } }
```

```bash
# Two @types packages declare incompatible globals, but the error is hidden:
npm ls @types/node
# @types/node@18 and @types/node@20 both present (duplicate)
```

**What is wrong?**
`skipLibCheck: true` is a legitimate speed optimization, but here it is masking a genuine dependency conflict (duplicate/incompatible `@types`). The app may build yet behave inconsistently, and the real bug is invisible.

**Fix:**
Periodically run a full check to surface hidden conflicts, then deduplicate types.
```bash
# Temporarily turn off skipLibCheck to reveal the conflict
tsc --noEmit --skipLibCheck false
# Resolve duplicate @types (dedupe / align versions)
npm dedupe
```

---

## Bug 16 — `rootDir` Mismatch Flattens or Nests Output 🟡

```json
// BUGGY: rootDir narrower than the actual input tree
{
  "compilerOptions": { "outDir": "dist", "rootDir": "src/app" },
  "include": ["src"]
}
```

```
error TS6059: File 'src/shared/util.ts' is not under 'rootDir' 'src/app'.
  'rootDir' is expected to contain all source files.
```

**What is wrong?**
`rootDir` must contain **every** input file, because output paths are computed relative to it. Here `include` pulls in `src/shared/util.ts`, which is outside `src/app`, so `tsc` cannot compute a valid output path.

**Fix:**
```json
{ "compilerOptions": { "outDir": "dist", "rootDir": "src" }, "include": ["src"] }
```
Set `rootDir` to the common ancestor of all included files (usually `src`).

---

## Bug 17 — Forgetting `@types` for a JS-Only Dependency 🟢

```typescript
// src/server.ts
import express from "express";   // express ships no built-in types
const app = express();
```

```
src/server.ts:1:21 - error TS2307: Cannot find module 'express' or its
  corresponding type declarations.
```

**What is wrong?**
The runtime package is JavaScript with no bundled `.d.ts`. `tsc` resolves the module but finds no types, so it errors under default settings. People sometimes "fix" this by adding `// @ts-ignore`, which hides every type benefit.

**Fix:**
```bash
npm install --save-dev @types/express
```
Install the companion `@types/*` package. Confirm resolution with `tsc --traceResolution` if it still fails.

---

## Bug 18 — Editing the Config But Not Re-running From Cold 🟡

```bash
# BUGGY mental model: changed compilerOptions but warm build "ignored" them
# (it did NOT — but the developer also edited tsBuildInfoFile location)
tsc --incremental            # changed target es2017 -> es2022
# output still looks like es2017 because they were reading a stale dist/ file
```

**What is wrong?**
This is a *diagnosis* trap, not a `tsc` bug. Changing a compiler option **does** invalidate `.tsbuildinfo` automatically — `tsc` compares stored options and rebuilds. The real mistake is usually inspecting a stale artifact, an old `dist/` left over from a previous `outDir`, or running `tsc file.ts` (which ignores the config change entirely).

**Fix:**
```bash
rm -rf dist                  # clear stale artifacts
tsc                          # bare tsc so the changed config applies
tsc --showConfig             # confirm the option actually changed
```

---

## Self-Check

After working through these, you should be able to:

- [ ] Recognize when a **file argument** is silently bypassing `tsconfig.json`.
- [ ] Spot a CI gate neutralized by `|| true` or a missing `tsc` step.
- [ ] Explain why bundlers don't catch type errors.
- [ ] Keep `outDir` out of the included source paths.
- [ ] Resolve `composite`/`noEmit` and reference-cycle conflicts.
- [ ] Ensure local and CI use the **same pinned** compiler version.
- [ ] Set `rootDir` to the common ancestor of all included files.
- [ ] Install `@types/*` for JS-only dependencies instead of `@ts-ignore`.
- [ ] Verify changes with `tsc --showConfig` rather than inspecting stale artifacts.

---

## Quick Reference: Error Codes Seen in These Bugs

| Code | Appeared in | Meaning |
|------|-------------|---------|
| `TS2307` | Bug 17 | Cannot find module or its type declarations |
| `TS5042` | Bug 5 | `--project` cannot be mixed with source files |
| `TS5069` | Bug 7 | `noEmit` cannot be specified with `composite` |
| `TS5083` | Bug 13 | Cannot read the `extends` config file |
| `TS6059` | Bug 16 | File is not under `rootDir` |
| `TS6202` | Bug 10 | Project references form a circular graph |
| `TS6307` | Bug 9 | File not listed within the project's file list |
| `TS18003` | Bug 8 | No inputs were found in config file |

---

## Debugging Workflow for Any "tsc Did Something Weird" Report

When a teammate says "tsc is broken," run this sequence before assuming a compiler bug:

```bash
# 1) What version are we actually running?
npx tsc --version

# 2) What does tsc think the config is?
tsc --showConfig

# 3) What files did it include, and why?
tsc --noEmit --explainFiles | less

# 4) Did the command use a file argument (bypassing the config)?
#    Check the exact invocation in package.json / CI logs.

# 5) Is the exit code being masked?
#    Look for "|| true", "; exit 0", or a non-tsc final command in the step.
```

Nine times out of ten the "bug" is one of: a file argument bypassing the config, a masked exit code, a version mismatch, or a stale artifact being inspected. The compiler itself is rarely at fault.
