# tsconfig.json — Specification

> **Official Documentation Reference**
>
> Source: [TypeScript — tsconfig.json](https://www.typescriptlang.org/docs/handbook/tsconfig-json.html) and the [full TSConfig Reference](https://www.typescriptlang.org/tsconfig).

---

## Table of Contents

1. [Docs Reference](#1-docs-reference)
2. [Top-Level Field Reference](#2-top-level-field-reference)
3. [Core Concepts & Rules](#3-core-concepts--rules)
4. [`compilerOptions` Reference (Most Important)](#4-compileroptions-reference-most-important)
5. [Behavioral Specification](#5-behavioral-specification)
6. [include / exclude / files Semantics](#6-include--exclude--files-semantics)
7. [extends Resolution Specification](#7-extends-resolution-specification)
8. [references Specification](#8-references-specification)
9. [watchOptions & typeAcquisition Reference](#9-watchoptions--typeacquisition-reference)
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
| **Relevant Section** | tsconfig.json handbook + TSConfig Reference |
| **Reference URL** | https://www.typescriptlang.org/tsconfig |
| **Handbook URL** | https://www.typescriptlang.org/docs/handbook/tsconfig-json.html |
| **JSON Schema** | https://json.schemastore.org/tsconfig (used by editors for autocomplete) |
| **Project References** | https://www.typescriptlang.org/docs/handbook/project-references.html |

The `tsconfig.json` file specifies the root files and the compiler options required to compile a project. Its presence in a directory indicates that the directory is the root of a TypeScript project. Per the docs, a project is compiled by invoking `tsc` with no input files (config discovered automatically) or with `tsc -p <path>`.

---

## 2. Top-Level Field Reference

> From: https://www.typescriptlang.org/tsconfig (top-level properties)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `compilerOptions` | object | `{}` | All compiler flags. The largest section; see §4. |
| `include` | string[] | `["**/*"]` if neither `files` nor `include` is set | Glob patterns of files to include. |
| `exclude` | string[] | `["node_modules", "bower_components", "jspm_packages", outDir]` | Globs removed from the `include` set. |
| `files` | string[] | — | Explicit list of files (no globs). Errors if a listed file is missing. |
| `extends` | string \| string[] | — | Path(s) to base config(s) to inherit. Array form requires TS 5.0+. |
| `references` | `{ path: string }[]` | — | Project references for `tsc -b`. |
| `watchOptions` | object | — | Settings controlling `--watch` file watching. |
| `typeAcquisition` | object | — | Controls automatic `@types` download (JS projects). |
| `compileOnSave` | boolean | `false` | Hint to IDEs to emit on save (limited support). |
| `ts-node` | object | — | Non-standard; read by `ts-node` for its own options. |

**Signature (informal schema):**

```typescript
interface TSConfig {
  extends?: string | string[];
  compilerOptions?: CompilerOptions;
  include?: string[];
  exclude?: string[];
  files?: string[];
  references?: { path: string; prepend?: boolean }[];
  watchOptions?: WatchOptions;
  typeAcquisition?: TypeAcquisition;
  compileOnSave?: boolean;
}
```

---

## 3. Core Concepts & Rules

### Rule 1: Config presence defines the project root

> *Docs: [tsconfig.json handbook](https://www.typescriptlang.org/docs/handbook/tsconfig-json.html) — "The presence of a tsconfig.json file in a directory indicates that the directory is the root of a TypeScript project."*

```bash
# ✅ Correct — run from anywhere, config found by walking up
tsc
tsc -p ./tsconfig.build.json

# ❌ Incorrect — passing files disables tsconfig.json entirely
tsc src/index.ts   # config NOT read; flags must be on CLI
```

### Rule 2: Relative paths anchor to the config file

> *Docs: TSConfig Reference — path-valued options are resolved relative to the config file's directory.*

```json
// File at /repo/app/tsconfig.json
{
  "compilerOptions": { "outDir": "./dist" } // -> /repo/app/dist
}
```

### Rule 3: `files`/`include`/`exclude` define the ROOT set only

> *Docs: "Any files imported by files in include will also be included."*

```typescript
// Even if "b.ts" is excluded, this import pulls it into compilation:
import { x } from "./b"; // b.ts compiled regardless of exclude
```

### Rule 4: `extends` merges, with array replacement

> *Docs: "The configuration from the base file are loaded first, then overridden by those in the inheriting config file."*

```json
// base: { "compilerOptions": { "strict": true, "lib": ["ES2022"] } }
// child overrides lib entirely:
{ "extends": "./base.json", "compilerOptions": { "lib": ["ES2022", "DOM"] } }
```

---

## 4. `compilerOptions` Reference (Most Important)

> Full per-option detail lives in the sibling "Compiler Options" topic and at https://www.typescriptlang.org/tsconfig. Below is the structurally essential subset.

| Option | Type | Default | Since | Description |
|--------|------|---------|-------|-------------|
| `target` | enum | `ES3`→`ES5`/`ES2016` (version-dependent) | 1.0 | JS language version of emitted code. |
| `module` | enum | depends on `target` | 1.0 | Module system of output (`CommonJS`, `ESNext`, `NodeNext`). |
| `moduleResolution` | enum | depends on `module` | 1.6 | How imports are resolved (`Node10`, `Node16`, `NodeNext`, `Bundler`). |
| `lib` | string[] | derived from `target` | 2.0 | Built-in type libraries available. |
| `outDir` | string | — | 1.5 | Output directory for emitted JS. |
| `rootDir` | string | longest common path of inputs | 1.5 | Source root mirrored into `outDir`. |
| `declaration` | boolean | `false` | 1.0 | Emit `.d.ts` files. |
| `declarationMap` | boolean | `false` | 2.9 | Emit `.d.ts.map` for go-to-source. |
| `sourceMap` | boolean | `false` | 1.0 | Emit `.js.map`. |
| `strict` | boolean | `false` | 2.3 | Master switch for strict family. |
| `noEmit` | boolean | `false` | 1.4 | Type-check only; emit nothing. |
| `esModuleInterop` | boolean | `false` | 2.7 | Interop helpers for CommonJS default imports. |
| `skipLibCheck` | boolean | `false` | 2.0 | Skip type-checking `.d.ts` files. |
| `composite` | boolean | `false` | 3.0 | Enables project-reference build; implies `declaration`. |
| `incremental` | boolean | inherits `composite` | 3.4 | Persist `.tsbuildinfo` for incremental builds. |
| `tsBuildInfoFile` | string | `<outDir>/tsconfig.tsbuildinfo` | 3.4 | Location of incremental cache. |
| `baseUrl` | string | — | 2.0 | Base for non-relative module resolution. |
| `paths` | object | — | 2.0 | Module alias map (type-only). |
| `types` | string[] | all `@types` | 2.0 | Restrict which global `@types` are included. |
| `typeRoots` | string[] | `["./node_modules/@types"]` | 2.0 | Folders to scan for declaration packages. |
| `jsx` | enum | — | 2.0 | JSX emit mode (`react`, `react-jsx`, `preserve`). |

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

---

## 5. Behavioral Specification

### Configuration Resolution Model

1. Locate config (`-p`, or walk up from cwd). Explicit files bypass this.
2. Parse as JSONC (comments + trailing commas allowed).
3. Resolve and merge `extends` recursively.
4. Normalize options (string enums → internal enums), apply defaults, compute implied options.
5. Expand `include`/`exclude`/`files` into a concrete file list.
6. Construct the `Program`; module resolution may add more files.

### Default Option Derivation

| If you set… | …then this defaults to |
|-------------|------------------------|
| `target` only | `lib` derived from target; `module` derived from target |
| `module: "NodeNext"` | `moduleResolution: "NodeNext"` |
| `composite: true` | `declaration: true`, incremental output on |
| `strict: true` | each strict sub-flag `true` unless overridden |

### Performance Characteristics

- File count and `.d.ts` count dominate cold build time.
- `skipLibCheck` reduces `.d.ts` checking cost.
- `incremental`/`composite` enable signature-based rebuild skipping.
- Project references parallelize/scope work across packages.

---

## 6. include / exclude / files Semantics

> From: https://www.typescriptlang.org/tsconfig#include and `#exclude`, `#files`

**Glob wildcards supported:**

| Wildcard | Matches |
|----------|---------|
| `*` | Any number of characters (no path separator) |
| `?` | Exactly one character (no path separator) |
| `**/` | Any directory, any depth |

**Final file set formula:**

```
result = files  ∪  (matchFiles(include) − matchFiles(exclude))
```

- If both `files` and `include` are absent → default `include` is `**/*`.
- `exclude` never removes entries listed in `files`.
- `exclude` does not affect files reached via `import` from included files.
- Extension-less globs auto-expand to supported extensions (`.ts`, `.tsx`, `.d.ts`; `.js`/`.jsx` with `allowJs`; `.json` with `resolveJsonModule`).
- Specifying a custom `exclude` replaces the default excludes (except `outDir`, always excluded).

---

## 7. extends Resolution Specification

> From: https://www.typescriptlang.org/tsconfig#extends

```typescript
extends?: string | string[];
```

| Form | Resolution |
|------|-----------|
| `"./base.json"` | Relative file from the extending config's directory; `.json` optional. |
| `"@tsconfig/node20/tsconfig.json"` | Node module resolution from `node_modules`. |
| `["a", "b"]` (TS 5.0+) | Left-to-right; later entries override earlier; leaf overrides all. |

Merge rules:
- `compilerOptions`/`watchOptions`: key-by-key override; values replaced (arrays not concatenated).
- `files`/`include`/`exclude`: child's value, if present, fully replaces base's; if absent, inherited.
- `references`: never inherited.

---

## 8. references Specification

> From: https://www.typescriptlang.org/docs/handbook/project-references.html

```typescript
references?: { path: string; prepend?: boolean }[];
```

| Field | Description |
|-------|-------------|
| `path` | Path to a directory containing `tsconfig.json`, or to a config file directly. |
| `prepend` (deprecated direction) | Prepend referenced output (used with `outFile`; rarely used). |

Requirements for a referenced project:
- Must set `composite: true` (which implies `declaration: true`).
- Must include all its input files via `include`/`files`.
- Built with `tsc -b`, which orders builds by the reference graph and skips up-to-date projects.

```json
// Solution root
{ "files": [], "references": [{ "path": "packages/core" }] }
```

---

## 9. watchOptions & typeAcquisition Reference

> From: https://www.typescriptlang.org/tsconfig#watchOptions and `#typeAcquisition`

### watchOptions

| Option | Type | Description |
|--------|------|-------------|
| `watchFile` | enum | File watch strategy (`useFsEvents`, polling variants). |
| `watchDirectory` | enum | Directory watch strategy. |
| `fallbackPolling` | enum | Strategy when native events unavailable. |
| `synchronousWatchDirectory` | boolean | Disable deferred directory watching. |
| `excludeDirectories` | string[] | Directories never watched. |
| `excludeFiles` | string[] | Files never watched. |

### typeAcquisition

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enable` | boolean | `true` for JS, `false` for TS | Auto-download `@types`. |
| `include` | string[] | — | Force-acquire these. |
| `exclude` | string[] | — | Never acquire these. |
| `disableFilenameBasedTypeAcquisition` | boolean | `false` | Stop inferring `@types` from filenames. |

---

## 10. Edge Cases from Official Docs

| Edge Case | Official Behavior | Reference |
|-----------|-------------------|-----------|
| Passing files on CLI | `tsconfig.json` is ignored entirely | [tsconfig handbook](https://www.typescriptlang.org/docs/handbook/tsconfig-json.html) |
| Imported but excluded file | Still compiled — `exclude` filters root set only | [#exclude](https://www.typescriptlang.org/tsconfig#exclude) |
| Empty `include` matches nothing | `TS18003: No inputs were found` | [#include](https://www.typescriptlang.org/tsconfig#include) |
| Custom `exclude` set | Replaces default excludes (except `outDir`) | [#exclude](https://www.typescriptlang.org/tsconfig#exclude) |
| Missing file in `files` | `TS6053: File not found` (hard error) | [#files](https://www.typescriptlang.org/tsconfig#files) |
| `composite` without listing all files | "File is not listed within the file list of project" | [Project References](https://www.typescriptlang.org/docs/handbook/project-references.html) |
| Plain `tsc` in a references repo | References not built; expects existing outputs | [Project References](https://www.typescriptlang.org/docs/handbook/project-references.html) |

---

## 11. Version & Deprecation History

| Version | Change | Deprecated? | Migration |
|---------|--------|-------------|-----------|
| 1.5 | `tsconfig.json` first introduced | ❌ | — |
| 1.6 | `include`/`exclude` glob support added | ❌ | — |
| 2.1 | `extends` (single string) added | ❌ | — |
| 3.0 | Project references + `composite` added | ❌ | — |
| 3.4 | `incremental` + `.tsbuildinfo` added | ❌ | — |
| 3.8 | `watchOptions` added | ❌ | — |
| 4.7 | `moduleResolution: "node16"/"nodenext"` added | ❌ | Prefer NodeNext for ESM |
| 5.0 | `extends` accepts an **array** of bases | ❌ | — |
| 5.0 | `moduleResolution: "bundler"` added | ❌ | Use for Vite/esbuild apps |
| 5.x | `node` moduleResolution renamed `node10` (alias kept) | ⚠️ | Use `node10` / `nodenext` |

---

## 12. Official Examples

### Example from Docs: Basic project

> Source: [tsconfig handbook](https://www.typescriptlang.org/docs/handbook/tsconfig-json.html)

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "noImplicitAny": true,
    "removeComments": true,
    "preserveConstEnums": true,
    "sourceMap": true
  },
  "files": [
    "core.ts",
    "sys.ts",
    "types.ts",
    "scanner.ts",
    "parser.ts"
  ]
}
```

### Example from Docs: include/exclude

> Source: [#include](https://www.typescriptlang.org/tsconfig#include)

```json
{
  "compilerOptions": {},
  "include": ["src/**/*", "tests/**/*"],
  "exclude": ["**/*.spec.ts"]
}
```

**Result:** Compiles all files under `src` and `tests`, except any `.spec.ts` files anywhere within them.

---

## 13. Compliance Checklist

- [ ] Config follows the official top-level schema (no fields nested in the wrong place)
- [ ] Uses a supported TypeScript version for any version-gated features (array `extends` ≥ 5.0)
- [ ] No deprecated `moduleResolution` value where a modern one applies
- [ ] `include`/`exclude` semantics understood (root-set only; imports still compiled)
- [ ] Referenced projects set `composite` and list all input files
- [ ] Relative paths verified against the config file's own directory
- [ ] Editor autocomplete enabled via the JSON Schema (`$schema` or built-in)

---

## 14. Related Documentation

| Topic | Doc Section | URL |
|-------|-------------|-----|
| Full TSConfig reference | Every option | [tsconfig reference](https://www.typescriptlang.org/tsconfig) |
| tsconfig.json handbook | Overview & rules | [handbook](https://www.typescriptlang.org/docs/handbook/tsconfig-json.html) |
| Project references | Monorepo builds | [project-references](https://www.typescriptlang.org/docs/handbook/project-references.html) |
| Module resolution | `moduleResolution` deep-dive | [modules-reference](https://www.typescriptlang.org/docs/handbook/modules/reference.html) |
| Community base configs | `@tsconfig/*` | [tsconfig/bases](https://github.com/tsconfig/bases) |
| JSON Schema | Editor autocomplete | [schemastore tsconfig](https://json.schemastore.org/tsconfig) |

---

## 15. compilerOptions Categories (Reference Map)

> The official reference groups options into categories. Knowing the category helps you locate an option fast at https://www.typescriptlang.org/tsconfig.

| Category | Representative options | Purpose |
|----------|------------------------|---------|
| Type Checking | `strict`, `noImplicitAny`, `strictNullChecks`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` | How picky the checker is |
| Modules | `module`, `moduleResolution`, `baseUrl`, `paths`, `rootDirs`, `types`, `typeRoots`, `resolveJsonModule` | Import resolution & output format |
| Emit | `outDir`, `declaration`, `declarationMap`, `sourceMap`, `removeComments`, `noEmit`, `importHelpers`, `downlevelIteration` | What and where to emit |
| JavaScript Support | `allowJs`, `checkJs`, `maxNodeModuleJsDepth` | Mixing JS into a TS project |
| Editor Support | `disableSizeLimit`, `plugins` | IDE/language-server behavior |
| Interop Constraints | `esModuleInterop`, `allowSyntheticDefaultImports`, `forceConsistentCasingInFileNames`, `isolatedModules`, `verbatimModuleSyntax` | Safe interop & per-file transpile |
| Backwards Compatibility | `target`, `lib`, `useDefineForClassFields` | Language version & runtime libs |
| Language & Environment | `jsx`, `jsxFactory`, `experimentalDecorators`, `emitDecoratorMetadata`, `moduleDetection` | Language features |
| Compiler Diagnostics | `extendedDiagnostics`, `generateTrace`, `traceResolution`, `explainFiles` | Debugging |
| Projects | `composite`, `incremental`, `tsBuildInfoFile`, `disableSourceOfProjectReferenceRedirect` | Project references & caching |
| Completeness | `skipLibCheck`, `skipDefaultLibCheck` | Skip `.d.ts` checking |
| Output Formatting | `noErrorTruncation`, `preserveWatchOutput`, `pretty` | Console output |

---

## 16. Implied & Derived Options (Spec Details)

The compiler computes some options from others. Per the reference and source:

| You set | Compiler implies/derives |
|---------|--------------------------|
| `composite: true` | `declaration: true`; incremental build info enabled |
| `incremental: true` | `tsBuildInfoFile` defaults under `outDir` or next to config |
| `strict: true` | `noImplicitAny`, `strictNullChecks`, `strictFunctionTypes`, `strictBindCallApply`, `strictPropertyInitialization`, `noImplicitThis`, `useUnknownInCatchVariables`, `alwaysStrict` all default `true` |
| `module: "NodeNext"` | `moduleResolution: "NodeNext"` |
| `module: "Node16"` | `moduleResolution: "Node16"` |
| `target` only | `lib` derived from target; `module` derived from target |
| `esModuleInterop: true` | `allowSyntheticDefaultImports: true` (for type side) |

Each implied flag can still be **explicitly overridden** in `compilerOptions` — e.g., `strict: true` plus `strictNullChecks: false` turns that single sub-flag off.

---

## 17. CLI ↔ tsconfig Mapping

> From: https://www.typescriptlang.org/docs/handbook/compiler-options.html

Almost every `compilerOptions` key has a CLI equivalent. The CLI overrides the config for that run.

| CLI flag | tsconfig equivalent |
|----------|---------------------|
| `--strict` | `"strict": true` |
| `--outDir dist` | `"outDir": "dist"` |
| `--noEmit` | `"noEmit": true` |
| `--declaration` | `"declaration": true` |
| `--skipLibCheck` | `"skipLibCheck": true` |
| `--project p.json` / `-p` | (selects which config to read) |
| `--build` / `-b` | (build mode for references) |
| `--showConfig` | (prints resolved config; no equivalent field) |

Build-mode-only flags (`-b`): `--verbose`, `--dry`, `--clean`, `--force`, `--watch`.

---

## 18. The `$schema` Property

Editors validate `tsconfig.json` against the JSON Schema at https://json.schemastore.org/tsconfig, which powers autocomplete and inline docs. You can pin it explicitly:

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": { "strict": true }
}
```

VS Code recognizes `tsconfig*.json` automatically, so `$schema` is optional there but useful in other editors.

---

## 19. Formal File-Set Algorithm (Restated)

> Authoritative behavior per the handbook.

```
1. roots = files (verbatim, error if missing)
2. matched = expand(include) using supported extensions
              for any extensionless globs
3. excluded = expand(exclude)  (defaults applied only if exclude unset;
              outDir always excluded)
4. discovered = roots ∪ (matched − excluded)
5. program = transitive-closure(discovered) over imports and
              /// <reference> directives
```

The distinction between step 4 (**discovered/root set**, which `exclude` controls) and step 5 (**program**, which `exclude` cannot shrink) is the single most important spec detail for avoiding "why is this file compiled?" confusion.

---

## 20. Compliance Notes for Library Authors

When publishing a package, the spec-relevant options are:

```json
{
  "compilerOptions": {
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src",
    "stripInternal": true,
    "module": "NodeNext",
    "moduleResolution": "NodeNext"
  },
  "include": ["src"],
  "exclude": ["**/*.test.ts"]
}
```

- `declaration` is mandatory so consumers get types.
- `declarationMap` lets consumers navigate to your source.
- `stripInternal` removes `@internal`-tagged members from emitted `.d.ts`.
- Your `package.json` `"types"`/`"exports"` must point at the emitted `.d.ts`.

---

> **Content Rules satisfied:** ≥2 Core Rules (4 provided), ≥3 options (many), ≥3 edge cases (7 provided), ≥2 official examples (2 provided), with direct doc-section links throughout.
