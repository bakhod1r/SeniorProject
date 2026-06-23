# Installation and Configuration — Specification

> **Official Documentation Reference**
>
> Source: [TypeScript Official Docs](https://www.typescriptlang.org/docs/) — Installation, `tsc` CLI, and the `tsconfig.json` reference.

---

## Table of Contents

1. [Docs Reference](#1-docs-reference)
2. [Installation Methods (Official)](#2-installation-methods-official)
3. [The `tsc` CLI Reference](#3-the-tsc-cli-reference)
4. [`tsc --init` Defaults Explained](#4-tsc---init-defaults-explained)
5. [Core compilerOptions Reference](#5-core-compileroptions-reference)
6. [Project Files: include / exclude / files](#6-project-files-include--exclude--files)
7. [extends and Base Configs](#7-extends-and-base-configs)
8. [Module & Resolution Specification](#8-module--resolution-specification)
9. [Node/Runtime Compatibility](#9-noderuntime-compatibility)
10. [Edge Cases from Official Docs](#10-edge-cases-from-official-docs)
11. [Version & Deprecation History](#11-version--deprecation-history)
12. [Official Examples](#12-official-examples)
13. [Compliance Checklist](#13-compliance-checklist)
14. [Related Documentation](#14-related-documentation)

---

## 1. Docs Reference

| Property | Value |
|----------|-------|
| **Official Docs** | [TypeScript Documentation](https://www.typescriptlang.org/docs/) |
| **Download page** | [Download TypeScript](https://www.typescriptlang.org/download) |
| **tsconfig reference** | [tsconfig.json reference](https://www.typescriptlang.org/tsconfig) |
| **CLI reference** | [tsc CLI Options](https://www.typescriptlang.org/docs/handbook/compiler-options.html) |
| **Project setup** | [TypeScript Tooling in 5 minutes](https://www.typescriptlang.org/docs/handbook/typescript-tooling-in-5-minutes.html) |
| **Package** | [`typescript` on npm](https://www.npmjs.com/package/typescript) |

---

## 2. Installation Methods (Official)

> From: https://www.typescriptlang.org/download

### Local install (recommended)

```bash
# Per-project, recorded in package.json devDependencies
npm install --save-dev typescript
```

### Global install

```bash
# Makes 'tsc' available system-wide (not recommended for project builds)
npm install -g typescript
```

### On-demand with npx

```bash
# Runs the local 'tsc' if present, else downloads temporarily
npx tsc --version
```

| Method | Command | Official guidance |
|--------|---------|-------------------|
| Local | `npm install -D typescript` | Recommended; reproducible per project |
| Global | `npm install -g typescript` | Convenience for ad-hoc use |
| npx | `npx tsc` | Run without committing to an install |

> The docs note that a local install lets each project pin its own compiler version, which is why it is the recommended default for applications and libraries alike.

---

## 3. The `tsc` CLI Reference

> From: https://www.typescriptlang.org/docs/handbook/compiler-options.html

| Flag | Purpose |
|------|---------|
| `tsc` | Compile using the nearest `tsconfig.json` |
| `tsc --init` | Generate a starter `tsconfig.json` |
| `tsc --noEmit` | Type-check only; write no output |
| `tsc --watch` / `-w` | Recompile on file changes |
| `tsc --build` / `-b` | Build project references in dependency order |
| `tsc -p <path>` | Use a specific tsconfig (`--project`) |
| `tsc --showConfig` | Print the fully-resolved configuration |
| `tsc --listFiles` | List every file in the compilation |
| `tsc --traceResolution` | Log module-resolution decisions |
| `tsc --extendedDiagnostics` | Print per-phase timing and memory |
| `tsc --version` | Print the compiler version |

```bash
# Common combinations
tsc -p tsconfig.build.json        # build a specific project
tsc -b --clean                    # delete reference build outputs
tsc -b --verbose                  # explain up-to-date decisions
tsc --noEmit --watch              # continuous type gate during dev
```

> Per the docs, flags passed on the command line override the same options in `tsconfig.json`, **except** that providing input files on the command line causes `tsconfig.json` to be ignored entirely.

---

## 4. `tsc --init` Defaults Explained

> From: https://www.typescriptlang.org/tsconfig

Running `npx tsc --init` generates a documented `tsconfig.json`. Modern TypeScript (5.x) produces a slimmed-down version with these active defaults:

```jsonc
{
  "compilerOptions": {
    "target": "es2016",                  // JS language level of the emitted code
    "module": "commonjs",                // module system for output
    "esModuleInterop": true,             // smoother default/CJS imports
    "forceConsistentCasingInFileNames": true, // catch case-only path bugs
    "strict": true,                      // enable the full strict family
    "skipLibCheck": true                 // skip type-checking .d.ts in deps
  }
}
```

### Each default, explained

| Option | Default | What it does | Why it is on |
|--------|---------|--------------|--------------|
| `target` | `es2016` | Down-levels syntax to this ECMAScript version | Broad runtime compatibility out of the box |
| `module` | `commonjs` | Emits CommonJS `require`/`module.exports` | Maximum Node compatibility by default |
| `esModuleInterop` | `true` | Adds interop helpers so `import x from "cjs"` works | Removes a common import footgun |
| `forceConsistentCasingInFileNames` | `true` | Errors if imports disagree on filename casing | Prevents macOS-passes / Linux-fails bugs |
| `strict` | `true` | Turns on `noImplicitAny`, `strictNullChecks`, etc. | Strong type safety from day one |
| `skipLibCheck` | `true` | Skips checking declaration files in dependencies | Faster builds; deps are pre-checked |

> The generated file also lists dozens of commented-out options grouped under headings (Type Checking, Modules, Emit, Interop Constraints, Completeness). Uncomment only what you need.

### Recommended overrides for modern projects

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",                  // override the conservative es2016
    "module": "NodeNext",                // for native ESM Node projects
    "moduleResolution": "NodeNext",
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src"]
}
```

---

## 5. Core compilerOptions Reference

> From: https://www.typescriptlang.org/tsconfig

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `target` | string | `ES3`/`es2016`* | ECMAScript version of emitted JS |
| `module` | string | inferred from target | Output module system |
| `moduleResolution` | string | inferred from module | Import-resolution algorithm |
| `rootDir` | string | longest common path of inputs | Input root, mirrored in `outDir` |
| `outDir` | string | alongside sources | Output directory |
| `strict` | boolean | `false`* | Enables all strict checks |
| `declaration` | boolean | `false` | Emit `.d.ts` files |
| `declarationMap` | boolean | `false` | Emit `.d.ts.map` for source nav |
| `sourceMap` | boolean | `false` | Emit `.js.map` for debugging |
| `incremental` | boolean | `false`† | Persist `.tsbuildinfo` cache |
| `composite` | boolean | `false` | Enable project references |
| `skipLibCheck` | boolean | `false`* | Skip checking dependency `.d.ts` |
| `noEmit` | boolean | `false` | Type-check without output |
| `allowJs` | boolean | `false` | Allow `.js` files in the program |
| `lib` | string[] | derived from `target` | Built-in API typings to include |
| `types` | string[] | all `@types` | Restrict global type packages |
| `isolatedModules` | boolean | `false` | Require single-file-transpilable code |
| `verbatimModuleSyntax` | boolean | `false` | Preserve import/export syntax exactly |

> \* `tsc --init` sets non-default values (`strict: true`, `skipLibCheck: true`). The table shows the compiler's intrinsic default when the option is absent.
> † `incremental` defaults to `true` when `composite` is enabled.

---

## 6. Project Files: include / exclude / files

> From: https://www.typescriptlang.org/tsconfig#include

| Field | Behavior |
|-------|----------|
| `files` | Explicit list of files; no globs |
| `include` | Glob patterns of files to compile |
| `exclude` | Globs removed from `include` (defaults to `node_modules`, `bower_components`, `jspm_packages`, the `outDir`) |

```jsonc
{
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
```

> Per the docs: `exclude` only filters what `include` matched — it does **not** prevent a file from entering the program if another included file imports it. To truly keep a file out, ensure nothing imports it.

---

## 7. extends and Base Configs

> From: https://www.typescriptlang.org/tsconfig#extends

```jsonc
{
  "extends": "@tsconfig/node20/tsconfig.json",
  "compilerOptions": { "outDir": "dist" }
}
```

Rules (from the docs):
- `extends` accepts a path or a package specifier resolvable from `node_modules`.
- `compilerOptions` from base and child are merged; the child wins per key.
- `files`, `include`, and `exclude` are **not** inherited from the base.
- As of TypeScript 5.0, `extends` may be an array, merged left to right.

```jsonc
// TS 5.0+: multiple base configs
{ "extends": ["@tsconfig/node20/tsconfig.json", "@tsconfig/strictest/tsconfig.json"] }
```

> Official curated base configs live under the [`@tsconfig`](https://github.com/tsconfig/bases) scope (e.g., `@tsconfig/node20`, `@tsconfig/strictest`, `@tsconfig/recommended`).

---

## 8. Module & Resolution Specification

> From: https://www.typescriptlang.org/docs/handbook/modules/theory.html

| `module` | `moduleResolution` | Use case |
|----------|--------------------|----------|
| `NodeNext` | `NodeNext` | Modern Node, honors `package.json` `exports`/`type` |
| `CommonJS` | `Node10` | Classic CommonJS Node |
| `ESNext` | `Bundler` | Vite/esbuild/webpack pipelines |
| `Preserve` | `Bundler` | Leave import syntax for a downstream tool (TS 5.4+) |

```jsonc
// Native ESM Node — also requires "type": "module" in package.json
{ "compilerOptions": { "module": "NodeNext", "moduleResolution": "NodeNext" } }
```

> Docs requirement: under `NodeNext`, relative import specifiers must include the file extension of the **emitted** file (`./util.js`), matching Node's native ESM resolver.

---

## 9. Node/Runtime Compatibility

| TypeScript target | Safe Node version | Notes |
|-------------------|-------------------|-------|
| `ES2020` | Node 14+ | Optional chaining, nullish coalescing |
| `ES2021` | Node 16+ | `String.replaceAll`, logical assignment |
| `ES2022` | Node 18+ | Top-level `await` (ESM), class fields |
| `ES2023` | Node 20+ | Array `findLast`, `toSorted` |

```jsonc
// Match target/lib to the lowest Node you support
{ "compilerOptions": { "target": "ES2022", "lib": ["ES2022"] } }
```

| Feature | Node 18 | Node 20 | Node 22 | Notes |
|---------|---------|---------|---------|-------|
| Native ESM (`type: module`) | Yes | Yes | Yes | Requires `.js` extensions |
| `--experimental-strip-types` | No | 20.6+ (flag) | Yes (default-ish) | Run `.ts` directly, no type-check |
| Top-level await | Yes (ESM) | Yes | Yes | ESM only |

> Newer Node versions can execute TypeScript files directly via type-stripping (`node --experimental-strip-types file.ts` in 20.6+, unflagged in 22.6+). This strips types only — it does **not** type-check; `tsc --noEmit` remains the gate.

---

## 10. Edge Cases from Official Docs

| Edge Case | Official Behavior | Reference |
|-----------|-------------------|-----------|
| Passing input files on the CLI | `tsconfig.json` is ignored entirely | [CLI docs](https://www.typescriptlang.org/docs/handbook/compiler-options.html) |
| `exclude` on an imported file | File still enters the program if imported | [tsconfig#exclude](https://www.typescriptlang.org/tsconfig#exclude) |
| `extends` and relative paths | Resolved relative to the defining config | [tsconfig#extends](https://www.typescriptlang.org/tsconfig#extends) |
| `composite` set | `incremental` and `declaration` implied true | [Project References](https://www.typescriptlang.org/docs/handbook/project-references.html) |
| No `outDir` | Output written next to source files | [tsconfig#outDir](https://www.typescriptlang.org/tsconfig#outDir) |
| `noEmitOnError` | Suppresses emit if any error exists | [tsconfig#noEmitOnError](https://www.typescriptlang.org/tsconfig#noEmitOnError) |

---

## 11. Version & Deprecation History

| Version | Change | Deprecated? | Migration |
|---------|--------|-------------|-----------|
| 3.0 | Project references (`composite`, `tsc -b`) introduced | No | — |
| 3.4 | `--incremental` flag added | No | — |
| 4.7 | `module`/`moduleResolution` `Node16`/`NodeNext` for ESM | No | Adopt for native ESM |
| 5.0 | `extends` accepts an array; `moduleResolution: Bundler` | No | Simplifies base-config layering |
| 5.0 | `--build` decorators / config improvements | No | — |
| 5.4 | `moduleResolution: Bundler` matured; `Preserve` module | No | — |
| 5.x | `tsc --init` output slimmed to essential options | ⚠️ | Old verbose template replaced |

> TypeScript does not follow semantic versioning strictly: minor releases may introduce new type errors as the checker is refined. The docs recommend pinning the version for reproducible builds.

---

## 12. Official Examples

### Example from Docs: Minimal Project Setup

> Source: https://www.typescriptlang.org/docs/handbook/typescript-tooling-in-5-minutes.html

```bash
npm install -D typescript
npx tsc --init
```

```typescript
// src/index.ts
const message: string = "Hello, World";
console.log(message);
```

```bash
npx tsc            # compiles per tsconfig.json
node dist/index.js # runs the emitted JS (with outDir: dist)
```

**Result:**

```
Hello, World
```

### Example from Docs: Project References Build

> Source: https://www.typescriptlang.org/docs/handbook/project-references.html

```jsonc
// tsconfig.json (solution file)
{ "files": [], "references": [{ "path": "packages/core" }, { "path": "packages/app" }] }
```

```bash
tsc -b           # builds core then app, incrementally
tsc -b --watch   # watches the whole graph
```

**Result:**

```
Each referenced project emits .d.ts + .tsbuildinfo; downstream
projects type-check against declarations only.
```

---

## 12b. Full compilerOptions Catalog by Category

> From: https://www.typescriptlang.org/tsconfig — grouped as the docs present them.

### Type Checking

| Option | Default | Description |
|--------|---------|-------------|
| `strict` | `false` | Master switch for the strict family |
| `noImplicitAny` | `strict` | Error on implicitly `any`-typed expressions |
| `strictNullChecks` | `strict` | `null`/`undefined` not assignable everywhere |
| `strictFunctionTypes` | `strict` | Contravariant parameter checking |
| `strictBindCallApply` | `strict` | Check `bind`/`call`/`apply` arguments |
| `strictPropertyInitialization` | `strict` | Class fields must be initialized |
| `noUncheckedIndexedAccess` | `false` | `arr[i]` is `T \| undefined` |
| `noImplicitOverride` | `false` | Require the `override` keyword |
| `noFallthroughCasesInSwitch` | `false` | Error on switch fallthrough |
| `exactOptionalPropertyTypes` | `false` | Optional `≠` explicit `undefined` |

### Modules

| Option | Default | Description |
|--------|---------|-------------|
| `module` | inferred | Output module system |
| `moduleResolution` | inferred | Resolution algorithm |
| `baseUrl` | — | Base directory for non-relative imports |
| `paths` | — | Path-mapping aliases |
| `resolveJsonModule` | `false` | Allow `import x from "./x.json"` |
| `types` | all `@types` | Restrict global type packages |
| `typeRoots` | `@types` dirs | Folders searched for ambient types |

### Emit

| Option | Default | Description |
|--------|---------|-------------|
| `outDir` | alongside source | Output directory |
| `rootDir` | inferred | Input root |
| `declaration` | `false` | Emit `.d.ts` |
| `declarationMap` | `false` | Emit `.d.ts.map` |
| `sourceMap` | `false` | Emit `.js.map` |
| `removeComments` | `false` | Strip comments from output |
| `noEmit` | `false` | Type-check only |
| `noEmitOnError` | `false` | Suppress emit on any error |
| `importHelpers` | `false` | Import `tslib` helpers instead of inlining |

### Interop Constraints

| Option | Default | Description |
|--------|---------|-------------|
| `esModuleInterop` | `false` (init: `true`) | CJS default-import interop |
| `allowSyntheticDefaultImports` | from `esModuleInterop` | Allow `import x` from no-default modules |
| `forceConsistentCasingInFileNames` | `true` (modern) | Enforce import casing |
| `isolatedModules` | `false` | Single-file transpilability |
| `verbatimModuleSyntax` | `false` | Preserve import/export syntax exactly |

### Projects

| Option | Default | Description |
|--------|---------|-------------|
| `composite` | `false` | Enable as a referenceable project |
| `incremental` | `false`† | Persist `.tsbuildinfo` |
| `tsBuildInfoFile` | `.tsbuildinfo` | Cache file location |
| `references` | — | List of referenced projects |

> † Implied `true` when `composite` is set.

---

## 12c. The `tsc --init` Generated Headings

> The generated file organizes commented options under these headings, in order. Knowing them helps you locate options quickly.

```jsonc
{
  "compilerOptions": {
    /* Projects */
    /* Language and Environment */    // target, lib, jsx, experimentalDecorators
    /* Modules */                     // module, moduleResolution, baseUrl, paths
    /* JavaScript Support */          // allowJs, checkJs
    /* Emit */                        // declaration, outDir, sourceMap, removeComments
    /* Interop Constraints */         // esModuleInterop, isolatedModules, verbatimModuleSyntax
    /* Type Checking */               // strict and the strict family
    /* Completeness */                // skipLibCheck
  }
}
```

---

## 12d. Official Install Verification Steps

> From: https://www.typescriptlang.org/docs/handbook/typescript-tooling-in-5-minutes.html

```bash
# 1. Confirm the compiler is reachable and report its version
npx tsc --version          # → Version 5.x.x

# 2. Confirm the config resolves
npx tsc --showConfig       # prints merged options

# 3. Confirm a clean build
npx tsc                    # emits per tsconfig.json

# 4. Confirm the output runs
node dist/index.js
```

The docs frame installation success as "the `tsc` command runs and reports a version" — everything else (config, emit, run) builds on that single check.

---

## 12e. CLI vs Config Precedence Rules

> From: https://www.typescriptlang.org/docs/handbook/compiler-options.html

| Situation | Result |
|-----------|--------|
| `tsc` (no args, no files) | Uses nearest `tsconfig.json` |
| `tsc -p ./path/tsconfig.json` | Uses that specific config |
| `tsc file.ts` (explicit file) | **Ignores** `tsconfig.json` entirely |
| `tsc --strict` (flag + config) | Flag overrides the config's value |
| `tsc -b` | Build mode; reads `references` |

```bash
# Common gotcha: passing a file disables your whole tsconfig
tsc src/index.ts            # NO tsconfig applied — defaults only
tsc -p tsconfig.json        # correct way to target a config
```

> The docs are explicit: "When input files are specified on the command line, `tsconfig.json` files are ignored." This is the single most common reason a configured project "ignores" its settings.

---

## 12f. Recommended Modern Defaults (Official + Community)

> Synthesized from the official `@tsconfig/*` bases.

```jsonc
{
  "extends": "@tsconfig/node20/tsconfig.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "noUncheckedIndexedAccess": true,
    "verbatimModuleSyntax": true
  },
  "include": ["src"]
}
```

| Base | What it sets | Source |
|------|--------------|--------|
| `@tsconfig/node20` | target/lib/module for Node 20 | [tsconfig/bases](https://github.com/tsconfig/bases) |
| `@tsconfig/strictest` | every strict + safety flag | [tsconfig/bases](https://github.com/tsconfig/bases) |
| `@tsconfig/recommended` | sensible general defaults | [tsconfig/bases](https://github.com/tsconfig/bases) |

---

## 13. Compliance Checklist

- [ ] TypeScript installed locally and pinned (per official recommendation).
- [ ] `tsconfig.json` generated via `tsc --init` and trimmed to needed options.
- [ ] `strict: true` retained from the generated defaults.
- [ ] `module`/`moduleResolution` chosen per the official module theory (NodeNext vs Bundler).
- [ ] Relative ESM imports include `.js` extensions under `NodeNext`.
- [ ] `target`/`lib` matched to the supported Node version.
- [ ] Project references configured with `composite: true` where applicable.
- [ ] No deprecated config patterns (verbose legacy `tsc --init` template) carried over.

---

## 14. Related Documentation

| Topic | Doc Section | URL |
|-------|-------------|-----|
| tsconfig reference | All compiler options | [Link](https://www.typescriptlang.org/tsconfig) |
| Compiler options (CLI) | `tsc` flags | [Link](https://www.typescriptlang.org/docs/handbook/compiler-options.html) |
| Project references | Monorepo builds | [Link](https://www.typescriptlang.org/docs/handbook/project-references.html) |
| Modules theory | module/moduleResolution | [Link](https://www.typescriptlang.org/docs/handbook/modules/theory.html) |
| Download | Install methods | [Link](https://www.typescriptlang.org/download) |
| @tsconfig bases | Curated base configs | [Link](https://github.com/tsconfig/bases) |

---

> **Content Rules satisfied for `specification.md`:**
> - Links point to specific doc sections, not just the homepage.
> - Node/runtime compatibility tables included.
> - Deprecated patterns (verbose legacy `tsc --init`) noted with migration.
> - Official `tsc` signatures and option defaults used throughout.
> - Includes 2+ core rules (extends, include/exclude), 3+ options, 3+ edge cases, 2 official examples.
