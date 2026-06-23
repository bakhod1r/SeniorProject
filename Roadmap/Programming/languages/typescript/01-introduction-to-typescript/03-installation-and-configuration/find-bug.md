# Installation and Configuration — Find the Bug

> **Practice finding and fixing setup and configuration bugs.**
> Each exercise contains a broken install, `tsconfig.json`, `package.json`, or workflow.
> Find the bug, explain why it happens, and fix it.

---

## How to Use

1. Read the buggy config/code carefully.
2. Try to find the bug **without** looking at the solution.
3. Write the fix yourself first.
4. Understand **why** it breaks — not just how to patch it.

### Difficulty Levels

| Level | Description |
|:-----:|:-----------|
| 🟢 | **Easy** — common install/config mistakes |
| 🟡 | **Medium** — subtle module/resolution or scripts issues |
| 🔴 | **Hard** — monorepo, reproducibility, and toolchain edge cases |

---

## Bug 1: TypeScript Installed as a Runtime Dependency 🟢

**What it should do:** Have TypeScript available for the build only.

```json
{
  "dependencies": {
    "typescript": "5.4.5"
  }
}
```

**The bug:** TypeScript is under `dependencies`, so it ships to production and bloats install size in deployment, even though it is never used at runtime.

**Fix:**
```bash
npm uninstall typescript
npm install --save-dev typescript@5.4.5
```
```json
{ "devDependencies": { "typescript": "5.4.5" } }
```
TypeScript is a build-time tool; the deployed artifact is plain JavaScript.

---

## Bug 2: `tsc: command not found` 🟢

**What it should do:** Run the compiler.

```json
{ "scripts": { "build": "./tsc" } }
```

**The bug:** The script tries to run `./tsc` (a file in the current directory) instead of the locally installed binary on `node_modules/.bin`.

**Fix:**
```json
{ "scripts": { "build": "tsc" } }
```
Inside npm scripts, `node_modules/.bin` is on PATH, so bare `tsc` resolves to the local compiler. From a plain shell, use `npx tsc`.

---

## Bug 3: Output Files Land in `src/` 🟢

**What it should do:** Put compiled JS into `dist/`.

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "rootDir": "src",
    "strict": true
  },
  "include": ["src"]
}
```

**The bug:** `outDir` is missing, so `tsc` writes `index.js` next to `index.ts` inside `src/`, cluttering source and risking accidental imports of stale output.

**Fix:**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "rootDir": "src",
    "outDir": "dist",
    "strict": true
  },
  "include": ["src"]
}
```

---

## Bug 4: Missing `.js` Extension Under NodeNext 🟡

**What it should do:** Import a sibling module and run on Node ESM.

```typescript
// tsconfig has module/moduleResolution: NodeNext, package.json has "type": "module"
import { connect } from "./db";   // src/index.ts

connect();
```

```bash
$ node dist/index.js
Error [ERR_MODULE_NOT_FOUND]: Cannot find module './db'
```

**The bug:** Native ESM under `NodeNext` requires the explicit emitted-file extension. `tsc` does not rewrite the specifier, so Node looks for `./db` (no extension) and fails.

**Fix:**
```typescript
import { connect } from "./db.js";   // .js even though the source is db.ts
```

---

## Bug 5: `Cannot use import statement outside a module` 🟡

**What it should do:** Run ESM output on Node.

```json
// package.json
{
  "scripts": { "start": "node dist/index.js" }
}
```
```json
// tsconfig.json
{ "compilerOptions": { "module": "ESNext", "target": "ES2022" } }
```

```bash
$ npm start
SyntaxError: Cannot use import statement outside a module
```

**The bug:** `tsc` emitted ESM (`import`/`export`), but `package.json` lacks `"type": "module"`, so Node treats `.js` as CommonJS and chokes on `import`.

**Fix:**
```json
{
  "type": "module",
  "scripts": { "start": "node dist/index.js" }
}
```
For Node, prefer `module`/`moduleResolution: "NodeNext"` so the emit matches the runtime mode.

---

## Bug 6: `tsc` Emits Nothing 🟡

**What it should do:** Compile `src/` into `dist/`.

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "outDir": "dist",
    "noEmit": true
  },
  "include": ["src"]
}
```

```bash
$ npx tsc
$ ls dist
ls: dist: No such file or directory
```

**The bug:** `noEmit: true` tells `tsc` to type-check only and never write files — correct for a CI gate, wrong for a build config.

**Fix:**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "outDir": "dist"
  },
  "include": ["src"]
}
```
Keep `noEmit` for a separate `typecheck` script (`tsc --noEmit`), not the build config.

---

## Bug 7: Editor and CI Disagree 🟡

**What it should do:** Show the same errors in the editor and in CI.

```json
// .vscode/settings.json
{ }
```
```json
// package.json
{ "devDependencies": { "typescript": "5.4.5" } }
```

**The bug:** Nothing pins the editor's TypeScript, so VS Code uses its bundled version (say, 5.6). The editor reports errors (or hides them) that CI's pinned 5.4.5 does not, causing "passes locally, fails in CI."

**Fix:**
```json
// .vscode/settings.json
{
  "typescript.tsdk": "node_modules/typescript/lib",
  "typescript.enablePromptUseWorkspaceTsdk": true
}
```
Now `tsserver` runs the same compiler as CI.

---

## Bug 8: Caret Allows a Surprise Upgrade 🟡

**What it should do:** Keep every machine on the same compiler.

```json
{ "devDependencies": { "typescript": "^5.3.0" } }
```

**The bug:** The caret permits `5.4`, `5.5`, etc. A teammate runs `npm install` weeks later, gets a newer compiler, and suddenly sees new type errors the rest of the team does not — non-reproducible builds.

**Fix:**
```json
{ "devDependencies": { "typescript": "5.3.3" } }
```
```bash
npm install -D typescript@5.3.3
git add package-lock.json
```
Pin exactly and upgrade deliberately in a dedicated PR.

---

## Bug 9: `include` Misses the Source 🟢

**What it should do:** Compile files in `source/`.

```json
{
  "compilerOptions": { "outDir": "dist", "rootDir": "source" },
  "include": ["src"]
}
```

```bash
$ npx tsc
error TS18003: No inputs were found in config file 'tsconfig.json'.
```

**The bug:** Code lives in `source/` but `include` points at `src/`, so the program is empty.

**Fix:**
```json
{
  "compilerOptions": { "outDir": "dist", "rootDir": "source" },
  "include": ["source"]
}
```
Keep `include` and `rootDir` consistent with the actual folder.

---

## Bug 10: CI Uses `npm install` Instead of `npm ci` 🔴

**What it should do:** Install reproducibly in CI.

```yaml
steps:
  - uses: actions/checkout@v4
  - run: npm install      # mutates the lockfile
  - run: npm run typecheck
```

**The bug:** `npm install` can resolve newer compatible versions and rewrite `package-lock.json`, so CI may run a different dependency set than developers. It also does not fail when `package.json` and the lockfile drift.

**Fix:**
```yaml
steps:
  - uses: actions/checkout@v4
  - run: npm ci           # strict, lockfile-driven, reproducible
  - run: npm run typecheck
```

---

## Bug 11: Two TypeScript Versions in the Tree 🔴

**What it should do:** Use one compiler everywhere.

```bash
$ npm ls typescript
app@1.0.0
├── typescript@5.4.5
└─┬ some-build-tool@2.0.0
  └── typescript@4.9.5     ← second copy
```

**The bug:** A dependency pulls its own TypeScript. Different copies can emit inconsistent `.d.ts`, and the editor or build tool may resolve the wrong one, causing mysterious mismatches.

**Fix:**
```json
{ "overrides": { "typescript": "5.4.5" } }
```
```bash
rm -rf node_modules package-lock.json && npm install
npm ls typescript   # now a single version
```

---

## Bug 12: `extends` Re-bases `outDir` Unexpectedly 🔴

**What it should do:** Emit into the consuming package's `dist/`.

```json
// shared/tsconfig.base.json
{ "compilerOptions": { "outDir": "dist", "strict": true } }
```
```json
// packages/api/tsconfig.json
{ "extends": "../../shared/tsconfig.base.json", "include": ["src"] }
```

```bash
# Output unexpectedly appears under shared/, not packages/api/
```

**The bug:** Relative `outDir` in the base resolves relative to the base file's location after path-rebasing, so output can land in a surprising place. (`files`/`include`/`exclude` are also not inherited from a base.)

**Fix:** Define output paths in the consuming config, not the base:
```json
// shared/tsconfig.base.json — no path options here
{ "compilerOptions": { "strict": true } }
```
```json
// packages/api/tsconfig.json
{
  "extends": "../../shared/tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"]
}
```
Verify with `tsc --showConfig`.

---

## Bug 13: Stale `.tsbuildinfo` Hides an Error 🔴

**What it should do:** Catch a type error after switching branches.

```bash
git switch feature/new-api    # changes many files
npx tsc -b                     # reports "up to date", no errors
# but a real type error exists
```

**The bug:** A `.tsbuildinfo` from a previous branch describes a different file set; `tsc -b`'s up-to-date check trusts it and skips re-checking, masking the error.

**Fix:**
```bash
npx tsc -b --clean   # delete build outputs and build info
npx tsc -b           # full rebuild — error now surfaces
```
For release builds, always run a clean rebuild; use the cache only for fast local/PR feedback.

---

## Bug 14: `const enum` Breaks Under a Bundler 🔴

**What it should do:** Use an enum value across files in a bundler pipeline.

```typescript
// constants.ts
export const enum Color { Red, Green }
// app.ts
import { Color } from "./constants.js";
console.log(Color.Red);   // works with tsc, breaks/empties with esbuild
```

**The bug:** `const enum` is inlined by `tsc` at compile time, but single-file transpilers (esbuild/SWC) cannot inline across files, producing broken output. `isolatedModules` is off, so `tsc` did not warn.

**Fix:**
```json
{ "compilerOptions": { "isolatedModules": true } }
```
```typescript
// Use a regular enum or a plain object const instead
export const Color = { Red: 0, Green: 1 } as const;
```
With `isolatedModules`, `tsc` flags unsupported constructs before the bundler mangles them.

---

## Bug 15: `strict` Silently Disabled 🟢

**What it should do:** Catch implicit `any` and null errors.

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": false
  }
}
```

```typescript
function handle(req) {        // 'req' is implicitly any — no error!
  return req.body;
}
```

**The bug:** `strict: true` would normally enable `noImplicitAny`, but the explicit `"noImplicitAny": false` overrides it, punching a hole in strictness. The config *looks* strict but is not.

**Fix:**
```json
{ "compilerOptions": { "strict": true } }
```
Remove the override. Disable individual strict flags only with a documented, reviewed reason.

---

## Bug 16: `@types/node` Missing 🟢

**What it should do:** Use Node's `process` and `fs`.

```typescript
import { readFile } from "fs/promises";
console.log(process.env.NODE_ENV);   // error: Cannot find name 'process'
```

**The bug:** Node's built-in API types come from `@types/node`, which is not installed, so `process`, `Buffer`, and core modules are unknown to the checker.

**Fix:**
```bash
npm install -D @types/node
```
```json
// Optionally scope global types so only Node's are loaded
{ "compilerOptions": { "types": ["node"] } }
```

---

## Bug 17: `rootDir` Mismatch Flattens Output 🟡

**What it should do:** Mirror the `src/` tree into `dist/`.

```json
{
  "compilerOptions": { "outDir": "dist" },
  "include": ["src", "scripts"]
}
```

```bash
# Output structure is unexpected: dist contains src/ and scripts/ subfolders
```

**The bug:** With no `rootDir`, `tsc` infers it as the longest common path of all inputs. Including both `src` and `scripts` makes the common root the project folder, so `dist` mirrors `src/...` and `scripts/...` instead of a flat `dist`.

**Fix:**
```json
{
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"]
}
```
Keep build inputs under a single `rootDir`; compile `scripts/` separately if needed.

---

## Bug 18: Global tsc Shadows the Pinned One 🟡

**What it should do:** Build with the project's pinned compiler.

```bash
$ tsc            # developer runs bare tsc in a shell
$ tsc --version
Version 4.9.5    # an old global install — not the project's 5.4.5
```

**The bug:** Running bare `tsc` in a normal shell uses the global install (on PATH), not the local `node_modules/.bin/tsc`. The build uses the wrong compiler.

**Fix:**
```bash
npx tsc          # or: npm run build (with "build": "tsc")
```
npm scripts and npx prepend `node_modules/.bin`, guaranteeing the pinned version.

---

## Bug 19: Passing a File to `tsc` Ignores the Config 🟡

**What it should do:** Compile using `tsconfig.json` settings (strict, outDir, etc.).

```json
{ "scripts": { "build": "tsc src/index.ts" } }
```

```bash
# Output ignores strict and outDir — files land next to source, no strict checks
```

**The bug:** Specifying an input file on the command line makes `tsc` ignore `tsconfig.json` entirely, falling back to compiler defaults (no `outDir`, `strict` off).

**Fix:**
```json
{ "scripts": { "build": "tsc" } }
```
Or target a config explicitly with `tsc -p tsconfig.json`. Never pass input files when you rely on a config.

---

## Bug 20: `paths` Alias Works in tsc but Crashes at Runtime 🔴

**What it should do:** Use a `@/` import alias that also works when run with Node.

```json
// tsconfig.json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] },
    "outDir": "dist"
  }
}
```

```typescript
import { config } from "@/config.js";   // type-checks fine
```

```bash
$ node dist/index.js
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@'
```

**The bug:** `paths` only informs `tsc`'s type resolution. `tsc` does **not** rewrite the alias in the emitted JS, so Node has no idea what `@/` means at runtime.

**Fix:** Either avoid `paths` for emitted Node code and use relative imports, or add a runtime resolver:
```json
// package.json — Node subpath imports (resolved at runtime)
{ "imports": { "#config": "./dist/config.js" } }
```
```typescript
import { config } from "#config";   // works in both tsc and Node
```
Alternatively, use a bundler or `tsc-alias` to rewrite the paths during build.

---

## Summary

These bugs cover the real failure modes of installing and configuring TypeScript: wrong dependency type, missing `outDir`/extensions, ESM/CommonJS mismatch, editor/CI drift, unpinned versions, duplicate compilers, `extends` rebasing, stale incremental caches, and bundler-incompatible constructs. The recurring lesson: make the configuration match the runtime, pin versions, and prefer reproducible (`npm ci`, clean rebuild) over convenient.
