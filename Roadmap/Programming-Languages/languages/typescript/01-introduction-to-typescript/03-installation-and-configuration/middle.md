# Installation and Configuration — Middle Level

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Why This Matters](#why-this-matters)
3. [Install Strategies Compared](#install-strategies-compared)
4. [Deep Dive: tsconfig.json](#deep-dive-tsconfigjson)
5. [Module & Target Choices](#module--target-choices)
6. [Choosing a Node + TS Setup](#choosing-a-node--ts-setup)
7. [package.json Scripts](#packagejson-scripts)
8. [Editor / IDE Integration](#editor--ide-integration)
9. [Pinning the TypeScript Version](#pinning-the-typescript-version)
10. [First Project Structure](#first-project-structure)
11. [Running the Output](#running-the-output)
12. [Common Setups](#common-setups)
13. [Frontend / Bundler Setup](#frontend--bundler-setup)
14. [Type Definitions and @types](#type-definitions-and-types)
15. [Watch Mode and Dev Loop](#watch-mode-and-dev-loop)
16. [Troubleshooting](#troubleshooting)
17. [Best Practices](#best-practices)
18. [Middle Checklist](#middle-checklist)
19. [Test](#test)
20. [Summary](#summary)

---

## Prerequisites

- You can create a TypeScript project, install the compiler, and run a basic build.
- You understand `strict` mode at a basic level and have seen a `tsconfig.json`.
- You build real projects with Node.js or a frontend framework.
- You are comfortable with npm scripts and `package.json` structure.

This level is about making deliberate decisions: which module system, which target, which install strategy, and how to standardize all of it for a team.

---

## Why This Matters

At the junior level you got a project compiling. At the middle level the goal shifts to **correctness and consistency**. A misconfigured `tsconfig.json` can silently disable type safety (`strict: false`), produce output that crashes at runtime (wrong `module`/`moduleResolution`), or make builds 5x slower than necessary.

The decisions you make about installation and configuration ripple across every developer on the team and every run of CI. Getting them right once — and pinning them — saves countless hours of "it works on my machine" debugging.

---

## Install Strategies Compared

| Strategy | Command | When to use | Risk |
|----------|---------|-------------|------|
| Local (devDependency) | `npm install -D typescript` | Almost always | None — recommended |
| Global | `npm install -g typescript` | Quick experiments only | Version drift across projects |
| npx (no install) | `npx tsc ...` | One-off commands | Slower first run (download) |
| Pinned exact | `npm install -D typescript@5.4.5` | Teams / CI | None — best for reproducibility |

```bash
# The recommended setup for any serious project
npm install --save-dev typescript@5.4.5

# Verify which tsc you are actually running
npx tsc --version          # local, project-pinned
which tsc 2>/dev/null      # may show a global one — avoid relying on it
```

**Key insight:** A local install writes a `tsc` shim into `node_modules/.bin/`. `npm run` scripts and `npx` both prefer that shim, so your build always uses the pinned version. Global `tsc` only wins if you type `tsc` directly in a shell — which you should avoid.

---

## Deep Dive: tsconfig.json

`tsc --init` generates a heavily commented file. Here is a curated, production-ready Node configuration with the most important options explained.

```json
{
  "compilerOptions": {
    // --- Output ---
    "target": "ES2022",            // JS language level of emitted code
    "module": "NodeNext",          // module system for output
    "moduleResolution": "NodeNext",// how imports are resolved
    "rootDir": "src",              // input root
    "outDir": "dist",              // output folder
    "sourceMap": true,             // emit .js.map for debugging
    "declaration": true,           // emit .d.ts type definitions

    // --- Type Safety ---
    "strict": true,                // enables the full strict family
    "noUncheckedIndexedAccess": true, // arr[i] is T | undefined
    "noImplicitOverride": true,    // require 'override' keyword
    "noFallthroughCasesInSwitch": true,

    // --- Interop & Performance ---
    "esModuleInterop": true,       // smoother CommonJS interop
    "skipLibCheck": true,          // skip checking node_modules .d.ts
    "forceConsistentCasingInFileNames": true,
    "incremental": true,           // cache for faster rebuilds
    "verbatimModuleSyntax": true   // explicit type-only imports
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

### Key Options Grouped

```typescript
// strict: true expands to all of these:
// - noImplicitAny
// - strictNullChecks
// - strictFunctionTypes
// - strictBindCallApply
// - strictPropertyInitialization
// - noImplicitThis
// - useUnknownInCatchVariables
// - alwaysStrict
```

Turning `strict` on individually is rarely worth it — enable the whole family and disable specific checks only with a documented reason.

---

## Module & Target Choices

The two most consequential options are `module` and `target`. Choose them based on where your code runs.

| Scenario | target | module | moduleResolution |
|----------|--------|--------|------------------|
| Modern Node (ESM) | ES2022 | NodeNext | NodeNext |
| Modern Node (CommonJS) | ES2022 | CommonJS | Node10 (or Node) |
| Browser via bundler | ES2022 | ESNext | Bundler |
| Library (dual publish) | ES2020 | NodeNext | NodeNext |

```json
// ESM Node project — note "type": "module" in package.json is also required
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext"
  }
}
```

```json
// Bundler-driven frontend (Vite/esbuild handles emit)
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "noEmit": true,        // bundler emits, tsc only checks
    "lib": ["ES2022", "DOM", "DOM.Iterable"]
  }
}
```

**Rule of thumb:** If a bundler emits your JS, use `moduleResolution: "Bundler"` and `noEmit: true`. If `tsc` emits your JS for Node, use `NodeNext` for both `module` and `moduleResolution`.

---

## Choosing a Node + TS Setup

There are three mainstream approaches to running TypeScript on Node:

```bash
# 1. Compile-then-run (most explicit, production standard)
npx tsc && node dist/index.js

# 2. On-the-fly with tsx (fast dev iteration, esbuild under the hood)
npm install -D tsx
npx tsx src/index.ts
npx tsx watch src/index.ts   # restarts on change

# 3. ts-node (older, type-checks while running — slower)
npm install -D ts-node
npx ts-node src/index.ts
```

| Tool | Type-checks? | Speed | Best for |
|------|--------------|-------|----------|
| `tsc` then `node` | Yes | Slow build, fast run | Production builds |
| `tsx` | No (strips types) | Very fast | Dev, scripts, tests |
| `ts-node` | Optional | Slow | Legacy projects |

**Recommended modern setup:** `tsx` for the dev loop, `tsc --noEmit` for type-checking in CI, and `tsc` for the production build. This gives fast iteration and a real type gate.

```json
{
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "typecheck": "tsc --noEmit",
    "build": "tsc",
    "start": "node dist/index.js"
  }
}
```

---

## package.json Scripts

A well-organized scripts block is the team's shared interface to the build.

```json
{
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "build:clean": "rimraf dist && tsc",
    "typecheck": "tsc --noEmit",
    "typecheck:watch": "tsc --noEmit --watch",
    "start": "node dist/index.js",
    "lint": "eslint src --ext .ts",
    "format": "prettier --write \"src/**/*.ts\"",
    "prepublishOnly": "npm run build"
  },
  "devDependencies": {
    "typescript": "5.4.5",
    "tsx": "4.7.1",
    "rimraf": "5.0.5"
  }
}
```

### Why each script exists

- **dev:** Fast feedback loop; no compile step thanks to `tsx`.
- **build:** The canonical production compile.
- **typecheck:** CI gate — fails on any type error without emitting files.
- **build:clean:** Removes stale output so deleted source files do not linger in `dist/`.
- **prepublishOnly:** Ensures published packages always ship fresh build output.

```bash
# Run them
npm run dev
npm run typecheck
npm run build && npm start
```

---

## Editor / IDE Integration

VS Code is the de facto standard for TypeScript. Two settings matter most.

### 1. Use the Workspace TypeScript Version

VS Code bundles its own TypeScript, but you usually want the editor to use your project's pinned version so errors match the build.

```jsonc
// .vscode/settings.json — commit this so the whole team is aligned
{
  "typescript.tsdk": "node_modules/typescript/lib",
  "typescript.enablePromptUseWorkspaceTsdk": true
}
```

You can also switch interactively: open a `.ts` file, run **Command Palette → "TypeScript: Select TypeScript Version" → "Use Workspace Version"**.

### 2. Format on Save

```jsonc
// .vscode/settings.json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.codeActionsOnSave": {
    "source.organizeImports": "explicit"
  }
}
```

**Why commit `.vscode/settings.json`?** It guarantees every contributor's editor behaves identically — same TS version, same formatting — eliminating noisy diffs and "the editor says it's fine but CI fails" confusion.

---

## Pinning the TypeScript Version

TypeScript does not follow semver strictly: a minor release (5.3 → 5.4) can introduce new errors as the type-checker improves. Pinning protects your team from surprise red squiggles mid-sprint.

```json
// package.json — exact version, no caret
{
  "devDependencies": {
    "typescript": "5.4.5"
  }
}
```

```bash
# Install an exact version
npm install -D typescript@5.4.5

# Commit the lockfile so installs are reproducible
git add package-lock.json
```

**Upgrade deliberately:** schedule a TypeScript bump as its own PR, run the full `typecheck`, and review any new errors. Never let a caret (`^5.4.0`) auto-upgrade the compiler.

---

## First Project Structure

A clean, scalable layout for a Node service:

```
service/
├── package.json
├── tsconfig.json
├── tsconfig.build.json     ← extends base, excludes tests
├── .gitignore
├── .vscode/
│   └── settings.json
├── src/
│   ├── index.ts            ← entry point
│   ├── config.ts
│   ├── routes/
│   │   └── users.ts
│   └── lib/
│       └── db.ts
├── tests/
│   └── users.test.ts
└── dist/                   ← gitignored build output
```

```json
// tsconfig.json — base config used by editor & typecheck (includes tests)
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "rootDir": ".",
    "outDir": "dist",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true
  },
  "include": ["src", "tests"]
}
```

```json
// tsconfig.build.json — production build excludes test files
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": "src",
    "noEmit": false
  },
  "include": ["src"],
  "exclude": ["tests", "**/*.test.ts"]
}
```

```json
// package.json scripts use the build config for production
{ "scripts": { "build": "tsc -p tsconfig.build.json" } }
```

---

## Running the Output

```bash
# Compile, then run with Node
npm run build
node dist/index.js

# With ESM, ensure package.json has "type": "module"
# and your imports use .js extensions:
```

```typescript
// src/index.ts
import { connect } from "./lib/db.js";   // note .js extension for NodeNext ESM

async function main(): Promise<void> {
  await connect();
  console.log("Server started");
}

void main();
```

```bash
# Run the compiled ESM output
node dist/index.js
```

For source-level debugging, enable `sourceMap: true` so stack traces and the Node debugger point back to your `.ts` files.

---

## Common Setups

### Setup A: Backend API (Express/Fastify, ESM)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "rootDir": "src",
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "sourceMap": true
  },
  "include": ["src"]
}
```

```bash
npm install -D typescript @types/node tsx
npm install express
npm install -D @types/express
```

### Setup B: CLI Tool

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "strict": true
  }
}
```

```json
// package.json — expose a binary
{
  "bin": { "mycli": "dist/cli.js" },
  "files": ["dist"]
}
```

---

## Frontend / Bundler Setup

In modern frontend projects, the bundler compiles TS (stripping types fast with esbuild/SWC) and `tsc` is used only for type-checking.

```json
// tsconfig.json for a Vite + React app
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noEmit": true,            // Vite emits, not tsc
    "isolatedModules": true,   // each file transpilable independently
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

```json
// package.json — typecheck runs alongside the bundler build
{
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "typecheck": "tsc --noEmit"
  }
}
```

**`isolatedModules`** is critical here: it forbids constructs (like `const enum` across files) that single-file transpilers cannot handle, ensuring esbuild/SWC produce correct output.

---

## Type Definitions and @types

JavaScript libraries without bundled types need a companion `@types` package from DefinitelyTyped.

```bash
# Node's built-in APIs need @types/node
npm install -D @types/node

# A library that bundles its own types needs nothing extra (e.g., zod, axios)
npm install zod

# A library without types needs @types
npm install lodash
npm install -D @types/lodash
```

```typescript
// types/global.d.ts — declare ambient types for an untyped module
declare module "untyped-legacy-lib" {
  export function doThing(input: string): number;
}
```

```json
// tsconfig.json — pick up custom .d.ts files
{ "include": ["src", "types"] }
```

---

## Watch Mode and Dev Loop

```bash
# tsc watch: recompiles on save, type-checks continuously
npx tsc --watch

# tsx watch: runs and restarts on change (no type-check, fast)
npx tsx watch src/index.ts

# Best of both: run both in parallel terminals, or use npm-run-all
npm install -D npm-run-all
```

```json
{
  "scripts": {
    "dev": "run-p dev:run dev:check",
    "dev:run": "tsx watch src/index.ts",
    "dev:check": "tsc --noEmit --watch"
  }
}
```

This pattern gives instant execution (`tsx`) plus continuous type feedback (`tsc --noEmit --watch`) simultaneously.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `Cannot find module './x'` at runtime | Missing `.js` extension with NodeNext | Add `.js` to relative imports |
| `tsc` emits nothing | `noEmit: true` is set | Remove it or use a build config |
| `.js` files appear in `src/` | `outDir` not set | Add `"outDir": "dist"` |
| Editor errors differ from CI | Editor uses bundled TS | Select workspace version |
| `Cannot use import statement outside a module` | Missing `"type": "module"` | Add it to `package.json` |
| Slow builds | Checking `node_modules` `.d.ts` | Add `skipLibCheck: true` |

```bash
# Diagnose which files tsc actually includes
npx tsc --listFiles | head -20

# See the fully-resolved config tsc is using
npx tsc --showConfig
```

---

## Best Practices

- Pin TypeScript to an exact version and commit the lockfile.
- Use a base `tsconfig.json` for the editor and a `tsconfig.build.json` for production.
- Let bundlers emit and `tsc` type-check in frontend projects (`noEmit: true`).
- Commit `.vscode/settings.json` to align editor TS version and formatting.
- Use `tsx` for the dev loop and `tsc --noEmit` as the CI type gate.
- Always set both `rootDir` and `outDir` explicitly.

---

## Middle Checklist

- [ ] `typescript` pinned to an exact version in `devDependencies`.
- [ ] `strict: true` enabled.
- [ ] `module`/`moduleResolution` chosen to match the runtime (NodeNext vs Bundler).
- [ ] `rootDir` and `outDir` set; `dist/` gitignored.
- [ ] `build`, `typecheck`, `dev`, and `start` scripts present.
- [ ] Editor configured to use the workspace TypeScript version.
- [ ] `@types/node` (and any other needed `@types`) installed.

---

## Test

**1. When should `moduleResolution` be `"Bundler"`?**

<details>
<summary>Answer</summary>
When a bundler (Vite, esbuild, webpack) compiles your TypeScript and resolves modules, not `tsc`. Pair it with `noEmit: true`.
</details>

**2. Why pin TypeScript instead of using `^5.4.0`?**

<details>
<summary>Answer</summary>
Minor TypeScript releases can introduce new type errors as the checker improves. Pinning avoids surprise build breakages from automatic upgrades.
</details>

**3. What does `tsc --noEmit` accomplish in CI?**

<details>
<summary>Answer</summary>
It type-checks the whole project and fails the build on any error, without producing output files — a fast, pure correctness gate.
</details>

**4. Why is `isolatedModules` important for bundler setups?**

<details>
<summary>Answer</summary>
Single-file transpilers (esbuild/SWC) cannot resolve cross-file constructs like `const enum`. `isolatedModules` flags such code so the bundler produces correct output.
</details>

---

## Summary

- Choose a local, pinned TypeScript install; avoid global installs for builds.
- Configure `module`/`moduleResolution`/`target` to match where the code runs.
- Use `tsx` for dev iteration, `tsc --noEmit` for type-checking, `tsc` for production builds.
- Organize scripts (`dev`, `build`, `typecheck`, `start`) as the team's shared interface.
- Align the editor with the project via `.vscode/settings.json` and the workspace TS version.

**Next step:** Senior-level standardization — reproducible builds, CI, version pinning policy, and monorepo TS configuration.
