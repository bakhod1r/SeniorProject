# Installation and Configuration — Practical Tasks

> Hands-on tasks to internalize installing and configuring TypeScript.
> Work through them in order; each builds on the previous.

## Table of Contents

1. [Junior Tasks](#junior-tasks)
2. [Middle Tasks](#middle-tasks)
3. [Senior Tasks](#senior-tasks)
4. [Questions](#questions)
5. [Mini Projects](#mini-projects)
6. [Challenge](#challenge)

---

## Junior Tasks

### Task 1: Bootstrap a TypeScript Project From Scratch

**Type:** Setup

**Goal:** Go from an empty folder to a compiled, running TypeScript program.

**Steps:**

```bash
mkdir hello-ts && cd hello-ts
npm init -y
npm install --save-dev typescript
npx tsc --init
```

```typescript
// src/index.ts
function greet(name: string): string {
  return `Hello, ${name}!`;
}
console.log(greet("World"));
```

**Required tsconfig changes:**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "rootDir": "src",
    "outDir": "dist",
    "strict": true
  },
  "include": ["src"]
}
```

**Expected output:**
```
Hello, World!
```

**Evaluation criteria:**
- [ ] `npx tsc` produces `dist/index.js`
- [ ] `node dist/index.js` prints the greeting
- [ ] `typescript` is under `devDependencies`, not `dependencies`

---

### Task 2: Add package.json Scripts

**Type:** Configuration

**Goal:** Replace raw commands with reusable npm scripts.

**Required scripts:**

```json
{
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "start": "node dist/index.js"
  }
}
```

**Evaluation criteria:**
- [ ] `npm run build` compiles
- [ ] `npm run typecheck` reports type errors without emitting files
- [ ] `npm start` runs the compiled output

---

### Task 3: Gitignore the Build

**Type:** Hygiene

**Goal:** Keep generated files and dependencies out of version control.

```bash
# Create .gitignore with the right entries
printf "node_modules/\ndist/\n*.tsbuildinfo\n" > .gitignore
```

**Evaluation criteria:**
- [ ] `node_modules/`, `dist/`, and `*.tsbuildinfo` are ignored
- [ ] `git status` shows only source files and config as tracked

---

### Task 4: Trigger and Fix a Type Error

**Type:** Code

**Goal:** Prove that the compiler is actually checking types.

```typescript
// src/index.ts — introduce a deliberate error
function add(a: number, b: number): number {
  return a + b;
}
add("hello", 42); // should error
```

**Evaluation criteria:**
- [ ] `npm run typecheck` reports the argument-type error
- [ ] After fixing (`add(1, 42)`), the type-check passes

---

## Middle Tasks

### Task 5: Configure a Bundler-Style Setup

**Type:** Configuration

**Goal:** Set up `tsc` for type-checking only while a bundler handles emit.

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "noEmit": true,
    "isolatedModules": true,
    "strict": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"]
  },
  "include": ["src"]
}
```

**Evaluation criteria:**
- [ ] `tsc --noEmit` type-checks without writing files
- [ ] `isolatedModules` is enabled
- [ ] `moduleResolution` is `Bundler`

---

### Task 6: Pin the TypeScript Version

**Type:** Configuration

**Goal:** Lock the compiler version for reproducibility.

```bash
npm install -D typescript@5.4.5
```

```json
{ "devDependencies": { "typescript": "5.4.5" } }
```

**Evaluation criteria:**
- [ ] No caret (`^`) on the version in `package.json`
- [ ] `npx tsc --version` reports `5.4.5`
- [ ] `package-lock.json` is committed

---

### Task 7: Split Base and Build Configs

**Type:** Configuration

**Goal:** Use one config for the editor/type-check (includes tests) and another for production builds.

```json
// tsconfig.json (base — includes tests)
{
  "compilerOptions": {
    "target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext",
    "outDir": "dist", "strict": true, "skipLibCheck": true
  },
  "include": ["src", "tests"]
}
```

```json
// tsconfig.build.json (production — excludes tests)
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "rootDir": "src" },
  "include": ["src"],
  "exclude": ["tests", "**/*.test.ts"]
}
```

**Evaluation criteria:**
- [ ] `tsc -p tsconfig.build.json` excludes test files from `dist/`
- [ ] The base config still type-checks tests

---

### Task 8: Set Up a Fast Dev Loop With tsx

**Type:** Tooling

**Goal:** Run TypeScript directly during development.

```bash
npm install -D tsx
```

```json
{ "scripts": { "dev": "tsx watch src/index.ts" } }
```

**Evaluation criteria:**
- [ ] `npm run dev` runs `src/index.ts` without a build step
- [ ] Saving a file restarts the program automatically

---

### Task 9: Align the Editor With the Project

**Type:** Configuration

**Goal:** Make VS Code use the workspace TypeScript version.

```json
// .vscode/settings.json
{
  "typescript.tsdk": "node_modules/typescript/lib",
  "typescript.enablePromptUseWorkspaceTsdk": true,
  "editor.formatOnSave": true
}
```

**Evaluation criteria:**
- [ ] The VS Code status bar shows the project's pinned TS version
- [ ] `.vscode/settings.json` is committed

---

## Senior Tasks

### Task 10: Set Up a Monorepo With Project References

**Type:** Architecture

**Goal:** Configure two packages where one depends on the other, built incrementally.

```json
// tsconfig.base.json
{
  "compilerOptions": {
    "target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext",
    "strict": true, "composite": true, "declaration": true,
    "declarationMap": true, "skipLibCheck": true
  }
}
```

```json
// packages/utils/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"]
}
```

```json
// packages/app/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"],
  "references": [{ "path": "../utils" }]
}
```

```json
// tsconfig.json (solution)
{ "files": [], "references": [{ "path": "packages/utils" }, { "path": "packages/app" }] }
```

**Evaluation criteria:**
- [ ] `tsc -b` builds `utils` then `app`
- [ ] A no-change `tsc -b` completes in under 2 seconds
- [ ] Editing `app` does not rebuild `utils`

---

### Task 11: Build a CI Pipeline

**Type:** DevOps

**Goal:** Type-check and build on every push, with caching.

```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm run typecheck
      - run: npm run build
```

**Evaluation criteria:**
- [ ] CI runs `npm ci` (not `npm install`)
- [ ] `typecheck` and `build` are separate steps
- [ ] A type error fails the `typecheck` step

---

### Task 12: Dedupe TypeScript in the Dependency Tree

**Type:** Maintenance

**Goal:** Ensure only one TypeScript version exists.

```bash
npm ls typescript   # inspect the tree
```

```json
// package.json — force a single version
{ "overrides": { "typescript": "5.4.5" } }
```

**Evaluation criteria:**
- [ ] `npm ls typescript` shows exactly one version after `npm install`
- [ ] The override is documented in a comment or PR

---

### Task 13: Add Source Maps and Debug

**Type:** Tooling

**Goal:** Step through TypeScript source in the debugger.

```json
{ "compilerOptions": { "sourceMap": true } }
```

```jsonc
// .vscode/launch.json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug",
      "program": "${workspaceFolder}/dist/index.js",
      "preLaunchTask": "npm: build",
      "sourceMaps": true
    }
  ]
}
```

**Evaluation criteria:**
- [ ] `.js.map` files are emitted next to `.js`
- [ ] Breakpoints in `.ts` source are hit, not in `dist/`

---

### Task 14: Emit Declaration Files for a Library

**Type:** Library

**Goal:** Publish a package that exposes types to consumers.

```json
{
  "compilerOptions": {
    "declaration": true,
    "declarationMap": true,
    "outDir": "dist",
    "rootDir": "src"
  }
}
```

```json
// package.json — point consumers at the emitted types
{
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": ["dist"]
}
```

**Evaluation criteria:**
- [ ] `dist/index.d.ts` is generated
- [ ] `package.json` `types` points at it
- [ ] A consumer project gets full IntelliSense from the package

---

### Task 15: Enforce the Toolchain

**Type:** DevOps

**Goal:** Make the Node and npm versions consistent across the team.

```json
// package.json
{ "engines": { "node": ">=20 <21", "npm": ">=10" } }
```

```ini
# .npmrc
save-exact=true
engine-strict=true
```

```text
# .nvmrc
20.11.0
```

**Evaluation criteria:**
- [ ] Installing on Node 18 fails with an engines error
- [ ] New installs pin exact versions (no caret)
- [ ] `nvm use` reads `.nvmrc`

---

## Questions

**1. Why install TypeScript as a devDependency rather than a dependency?**

<details>
<summary>Answer</summary>
TypeScript is only needed at build time to produce JavaScript. The shipped artifact is JS, so the compiler does not belong in runtime dependencies.
</details>

**2. What is the difference between `tsc` and `tsc -b`?**

<details>
<summary>Answer</summary>
`tsc` compiles a single project from one `tsconfig.json`. `tsc -b` (build mode) builds project references in dependency order, using `.tsbuildinfo` for incremental rebuilds.
</details>

**3. When does `tsconfig.json` get ignored?**

<details>
<summary>Answer</summary>
When you pass input files directly on the command line (e.g., `tsc src/index.ts`), `tsc` ignores `tsconfig.json` entirely.
</details>

**4. Why must NodeNext ESM imports use `.js` extensions?**

<details>
<summary>Answer</summary>
`tsc` does not rewrite extensions; the emitted import must match what Node's native ESM resolver looks for at runtime, which is the `.js` file.
</details>

**5. What does `npm ci` do differently from `npm install`?**

<details>
<summary>Answer</summary>
`npm ci` installs strictly from `package-lock.json`, deletes `node_modules` first, and fails if the lockfile and `package.json` disagree — making installs reproducible.
</details>

---

## Mini Projects

### Mini Project A: TypeScript Project Scaffolder

Build a small Node script (in TypeScript) that creates a new project folder with:
- `package.json` (with `build`/`typecheck`/`start` scripts and pinned TS)
- `tsconfig.json` (strict, NodeNext, src/dist)
- `.gitignore`
- `src/index.ts` with a hello-world

**Deliverables:**
- [ ] Running it produces a project that compiles and runs out of the box
- [ ] The generated `tsconfig.json` passes `tsc --noEmit`

### Mini Project B: Dual-Runtime Library

Create a small library that type-checks for both Node (NodeNext) and a bundler (Bundler). Provide two tsconfigs and verify both pass.

**Deliverables:**
- [ ] `tsc -p tsconfig.node.json --noEmit` passes
- [ ] `tsc -p tsconfig.bundler.json --noEmit` passes
- [ ] `.d.ts` files are emitted for consumers

### Mini Project C: Incremental Build Benchmark

Set up a ~30-file project, measure cold vs warm build times with and without `incremental`, and document the difference.

**Deliverables:**
- [ ] `time tsc` cold vs warm recorded
- [ ] `.tsbuildinfo` confirmed to speed up warm builds
- [ ] A short README table of the numbers

---

## Challenge

### The Reproducible Monorepo Challenge

Build a 3-package monorepo (`core`, `utils`, `api`) where `api` depends on both, with a fully reproducible, fast, standardized setup.

**Requirements:**
1. npm workspaces; `api` references `core` and `utils`.
2. A shared `tsconfig.base.json` extended by all packages (`composite: true`).
3. Exact-pinned TypeScript with `overrides` deduping to one version.
4. `.nvmrc`, `engines`, and `.npmrc` (`save-exact`, `engine-strict`).
5. `.vscode/settings.json` pinning the workspace TS version.
6. A CI workflow running `npm ci` → `tsc -b --noEmit` → `tsc -b`, caching `**/*.tsbuildinfo`.
7. A `tsc --showConfig` drift check in CI.

**Acceptance criteria:**
- [ ] Clean checkout + `npm ci` + `tsc -b` succeeds with zero manual steps
- [ ] No-change `tsc -b` finishes in under 2 seconds
- [ ] Editing one package rebuilds only it and its dependents
- [ ] `npm ls typescript` shows exactly one version
- [ ] Editor diagnostics match `tsc -b --noEmit`
- [ ] CI is green and demonstrates cache reuse on the second run

**Stretch goals:**
- [ ] Add a `@tsconfig/strictest` base for the strictest possible checks
- [ ] Add `declarationMap` so cross-package go-to-definition lands on source
- [ ] Add a TypeScript upgrade PR template documenting the gated process

---

## Summary

You practiced the full lifecycle: bootstrapping a project, wiring scripts, pinning versions, splitting configs, aligning the editor, setting up a monorepo with project references, building a CI pipeline, and deduping the dependency tree. These are the exact skills that turn "works on my machine" into "works everywhere, reproducibly."
