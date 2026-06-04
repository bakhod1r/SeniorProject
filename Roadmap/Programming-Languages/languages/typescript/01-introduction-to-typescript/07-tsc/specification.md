# tsc — Specification

> **Official Documentation Reference**
>
> Source: [TypeScript Handbook — Compiler Options](https://www.typescriptlang.org/docs/handbook/compiler-options.html) and [TSConfig Reference](https://www.typescriptlang.org/tsconfig)

---

## Table of Contents

1. [Docs Reference](#1-docs-reference)
2. [CLI Reference](#2-cli-reference)
3. [Core Concepts & Rules](#3-core-concepts--rules)
4. [Compiler Options Reference](#4-compiler-options-reference)
5. [Behavioral Specification](#5-behavioral-specification)
6. [Exit Codes & Error Codes](#6-exit-codes--error-codes)
7. [Platform / Runtime Compatibility](#7-platform--runtime-compatibility)
8. [Edge Cases from Official Docs](#8-edge-cases-from-official-docs)
9. [Version & Deprecation History](#9-version--deprecation-history)
10. [Official Examples](#10-official-examples)
11. [Compliance Checklist](#11-compliance-checklist)
12. [Related Documentation](#12-related-documentation)

---

## 1. Docs Reference

| Property | Value |
|----------|-------|
| **Official Docs** | [TypeScript Documentation](https://www.typescriptlang.org/docs/) |
| **Relevant Section** | Compiler Options / tsc CLI / Project References |
| **Package** | `typescript` (provides the `tsc` binary) |
| **Direct URLs** | [Compiler Options](https://www.typescriptlang.org/docs/handbook/compiler-options.html), [TSConfig Reference](https://www.typescriptlang.org/tsconfig), [Project References](https://www.typescriptlang.org/docs/handbook/project-references.html) |

The `tsc` binary is installed by the `typescript` npm package. Running `tsc --help` prints a curated subset of options; `tsc --all` prints **every** option the build of `tsc` supports.

```bash
tsc --version          # Version 5.4.5
tsc --help             # common options
tsc --all              # full option list for this tsc version
```

---

## 2. CLI Reference

> From: [Compiler Options — Using the CLI](https://www.typescriptlang.org/docs/handbook/compiler-options.html)

### Invocation forms

```bash
tsc                         # compile the project found via tsconfig.json
tsc file.ts                 # compile a single file with DEFAULT options (ignores tsconfig)
tsc file1.ts file2.ts       # compile multiple files (default options)
tsc -p <path|dir>           # compile using a specific tsconfig (or dir containing one)
tsc --build [proj...]       # build mode: orchestrate project references
tsc --init                  # generate a starter tsconfig.json
```

### Top-level CLI flags (selection)

| Flag | Alias | Description |
|------|-------|-------------|
| `--help` | `-h` | Print help |
| `--all` | | Print **all** compiler options |
| `--version` | `-v` | Print the tsc version |
| `--init` | | Create a `tsconfig.json` |
| `--project <path>` | `-p` | Use a specific config file/dir |
| `--build` | `-b` | Enter build mode (project references) |
| `--watch` | `-w` | Watch input files and recompile on change |
| `--pretty` | | Stylize errors/messages (color + caret); `--pretty false` to disable |
| `--listFiles` | | Print names of files included in the compilation |
| `--explainFiles` | | Print files **and the reason** each was included |
| `--listEmittedFiles` | | Print names of files emitted |
| `--showConfig` | | Print the fully-resolved config and exit |
| `--diagnostics` | | Print high-level timing/memory stats |
| `--extendedDiagnostics` | | Print detailed counters (instantiations, caches) |
| `--generateTrace <dir>` | | Emit `trace.json` + `types.json` for profiling |
| `--traceResolution` | | Log module-resolution decisions |
| `--locale <code>` | | Localize diagnostic messages (e.g., `ja`, `de`) |

### Build-mode-only flags

| Flag | Description |
|------|-------------|
| `--verbose` | Explain why each project is (not) rebuilt |
| `--dry` | Show what would be built; build nothing |
| `--force` | Rebuild all projects, ignoring up-to-date status |
| `--clean` | Delete outputs of all projects in the build |

```bash
tsc --build --verbose
tsc --build --dry
tsc --build --force
tsc --build --clean
```

---

## 3. Core Concepts & Rules

### Rule 1: A file argument disables `tsconfig.json`

> *Docs: [tsconfig.json](https://www.typescriptlang.org/docs/handbook/tsconfig-json.html) — "When input files are specified on the command line, tsconfig.json files are ignored."*

```bash
# ✅ Correct — uses tsconfig.json (its outDir, strict, etc.)
tsc
tsc -p tsconfig.json

# ❌ Incorrect for a project — ignores tsconfig.json, uses defaults
tsc src/index.ts
```

### Rule 2: CLI options override `tsconfig.json` for that run

> *Docs: [Compiler Options](https://www.typescriptlang.org/docs/handbook/compiler-options.html)*

A flag given on the command line takes precedence over the same option in the config, but only for that invocation; it is not persisted.

```bash
# tsconfig has target es5; this single run emits es2022
tsc --target es2022
```

### Rule 3: `--build` requires `composite` projects

> *Docs: [Project References](https://www.typescriptlang.org/docs/handbook/project-references.html#composite)*

Every project referenced in build mode must set `"composite": true`, which implies `declaration: true` and forces `.tsbuildinfo` to be written.

```json
// ✅ Correct
{ "compilerOptions": { "composite": true, "declaration": true, "outDir": "dist" } }

// ❌ Incorrect — referenced but not composite -> build error TS6306
{ "compilerOptions": { "outDir": "dist" } }
```

### Rule 4: `noEmit` and `composite` are mutually exclusive

> *Docs: [TSConfig Reference — composite](https://www.typescriptlang.org/tsconfig#composite)*

Because `composite` requires emitting declarations, it cannot be combined with `noEmit`.

### Rule 5: Emit happens even with errors unless told otherwise

> *Docs: [TSConfig Reference — noEmitOnError](https://www.typescriptlang.org/tsconfig#noEmitOnError)*

By default `tsc` writes output even when diagnostics are reported. Set `noEmitOnError: true` to suppress output when any error exists.

---

## 4. Compiler Options Reference

> From: [TSConfig Reference](https://www.typescriptlang.org/tsconfig)

### Emit & output

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `outDir` | string | (next to source) | Output directory for emitted files |
| `rootDir` | string | (computed) | Root input directory; controls output structure |
| `outFile` | string | — | Concatenate output (only `module: amd`/`system`) |
| `declaration` | boolean | `false` | Emit `.d.ts` files |
| `declarationMap` | boolean | `false` | Emit `.d.ts.map` for source navigation |
| `declarationDir` | string | — | Separate folder for `.d.ts` |
| `emitDeclarationOnly` | boolean | `false` | Emit only `.d.ts`, no `.js` |
| `sourceMap` | boolean | `false` | Emit `.js.map` |
| `inlineSourceMap` | boolean | `false` | Embed the map in the `.js` |
| `noEmit` | boolean | `false` | Do not emit any files (type-check only) |
| `noEmitOnError` | boolean | `false` | Do not emit if any error occurred |
| `removeComments` | boolean | `false` | Strip comments from output |

### Language & module

| Option | Type | Common values | Description |
|--------|------|---------------|-------------|
| `target` | string | `es5`, `es2016`–`es2023`, `esnext` | JS language level to emit |
| `module` | string | `commonjs`, `nodenext`, `esnext`, `amd` | Module code-generation format |
| `moduleResolution` | string | `node10`, `node16`, `nodenext`, `bundler` | How imports are resolved |
| `lib` | string[] | `["es2022","dom"]` | Built-in API typings to include |
| `jsx` | string | `react-jsx`, `preserve` | JSX emit strategy |

### Type-checking strictness

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `strict` | boolean | `false` (template sets `true`) | Enables the strict family |
| `noImplicitAny` | boolean | (strict) | Error on implied `any` |
| `strictNullChecks` | boolean | (strict) | `null`/`undefined` are distinct |
| `strictFunctionTypes` | boolean | (strict) | Contravariant parameter checks |
| `noUncheckedIndexedAccess` | boolean | `false` | `arr[i]` is `T \| undefined` |
| `noUnusedLocals` | boolean | `false` | Error on unused locals (`TS6133`) |
| `noUnusedParameters` | boolean | `false` | Error on unused parameters |
| `exactOptionalPropertyTypes` | boolean | `false` | Optional ≠ explicitly `undefined` |

### Performance & build

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `incremental` | boolean | `false` (`true` under build) | Persist `.tsbuildinfo` |
| `tsBuildInfoFile` | string | `<outDir>/.tsbuildinfo` | Where to store incremental state |
| `composite` | boolean | `false` | Enable project-reference builds |
| `skipLibCheck` | boolean | `false` | Skip checking `.d.ts` files |
| `isolatedModules` | boolean | `false` | Ensure each file transpiles standalone |
| `verbatimModuleSyntax` | boolean | `false` | Do not elide/transform import syntax |
| `assumeChangesOnlyAffectDirectDependencies` | boolean | `false` | Faster, less-precise incremental invalidation |

```json
// A representative production tsconfig
{
  "compilerOptions": {
    "target": "es2022",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "incremental": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "noEmitOnError": true
  },
  "include": ["src"]
}
```

---

## 5. Behavioral Specification

### Compilation model

`tsc` constructs a `Program` from the resolved root files, resolves all module imports (pulling in `lib` and `@types`), then type-checks and (optionally) emits. A single `tsc` invocation produces one `Program`; `tsc --build` produces one per referenced project.

### File discovery precedence

1. If file arguments are passed → exactly those files, default options, **no** tsconfig.
2. Else `-p <path>` → that config.
3. Else the nearest `tsconfig.json` searching upward from the cwd.

`files` (explicit list) and `include`/`exclude` (globs) determine the input set; `exclude` only filters `include`, never `files`.

### Emit behavior

- One `.js` per input module (no bundling, except legacy `outFile`).
- `.d.ts` emitted when `declaration` (or `emitDeclarationOnly`) is on.
- Output location = `outDir` + the path of the input relative to `rootDir`.
- With `noEmit`, the emitter is skipped entirely.

### Watch behavior

`--watch` keeps the process alive, reuses unchanged `SourceFile`s, and re-checks the affected set on each change. `watchOptions` in tsconfig tune the file-system watching strategy.

### Performance characteristics

Per `--diagnostics`, the **Check time** phase typically dominates. `skipLibCheck`, `incremental`, and project references are the primary documented levers. `--generateTrace` localizes hot spots to specific expressions/types.

---

## 6. Exit Codes & Error Codes

### Exit codes

| Code | Meaning |
|------|---------|
| `0` | Success, no diagnostics |
| `1` | Compiler crash / fatal invocation error (some cases) |
| `2` | Diagnostics (type errors) were reported |
| `3` | Project-reference/build configuration error |

```bash
tsc --noEmit; echo $?   # 0 or 2 most commonly
```

### Error-code format

Every diagnostic has the form:

```
<file>(<line>,<col>): error TS<number>: <message>
```

or, in pretty mode:

```
<file>:<line>:<col> - error TS<number>: <message>
```

The full list of codes lives in the compiler's [`diagnosticMessages.json`](https://github.com/microsoft/TypeScript/blob/main/src/compiler/diagnosticMessages.json). Frequently seen: `TS2304`, `TS2307`, `TS2322`, `TS2345`, `TS2339`, `TS2531/2532`, `TS2554`, `TS2589`, `TS6133`, `TS6202`, `TS6306`, `TS18003`.

---

## 7. Platform / Runtime Compatibility

| Aspect | Support | Notes |
|--------|---------|-------|
| Node.js | 14.17+ for recent tsc; check each release | `tsc` is a Node program |
| OS | Windows, macOS, Linux | Path/casing differences matter (`forceConsistentCasingInFileNames`) |
| Deno | Has its own embedded TS; `tsc` not required | Different toolchain |
| Bun | Runs TS directly (strips types), does **not** type-check | Still pair with `tsc --noEmit` |
| Browsers | None run `.ts` directly | Always emit `.js` first |

> The `target`/`lib` options decide the *output's* runtime compatibility, independent of the Node version running `tsc` itself.

---

## 8. Edge Cases from Official Docs

| Edge Case | Official Behavior | Reference |
|-----------|-------------------|-----------|
| File args + `tsconfig.json` | tsconfig is ignored | [tsconfig.json](https://www.typescriptlang.org/docs/handbook/tsconfig-json.html) |
| `include` matches no files | Error `TS18003` | [TSConfig include](https://www.typescriptlang.org/tsconfig#include) |
| Errors but no `noEmitOnError` | JS is still emitted | [noEmitOnError](https://www.typescriptlang.org/tsconfig#noEmitOnError) |
| `composite` + `noEmit` | Disallowed | [composite](https://www.typescriptlang.org/tsconfig#composite) |
| Reference cycle | Error `TS6202` | [Project References](https://www.typescriptlang.org/docs/handbook/project-references.html) |
| Excessively deep type | Error `TS2589` | [Release notes 3.0+](https://www.typescriptlang.org/docs/handbook/release-notes/overview.html) |
| Casing mismatch on imports | Error if `forceConsistentCasingInFileNames` | [TSConfig](https://www.typescriptlang.org/tsconfig#forceConsistentCasingInFileNames) |

---

## 9. Version & Deprecation History

| Version | Change | Deprecated? | Migration |
|---------|--------|-------------|-----------|
| 1.5 | `tsconfig.json` introduced | ❌ | — |
| 2.x | `--strict` family, `skipLibCheck` | ❌ | — |
| 3.0 | **Project references** + `--build` | ❌ | Adopt `composite` |
| 3.4 | `--incremental` + `.tsbuildinfo` | ❌ | Add `incremental: true` |
| 3.8 | `import type` / `export type` | ❌ | — |
| 4.2 | `--explainFiles` | ❌ | — |
| 4.5 | Tail-recursion in conditional types | ❌ | Simplifies deep recursive types |
| 5.0 | New decorators; `--moduleResolution bundler` | ⚠️ | Old experimental decorators still opt-in |
| 5.0 | `verbatimModuleSyntax` | ⚠️ | Replaces `importsNotUsedAsValues` + `preserveValueImports` |
| 5.5 | `--isolatedDeclarations` | ❌ | Faster, parallelizable `.d.ts` emit |
| 5.6 | `--noCheck` (emit without full check) | ❌ | Speed builds when checked elsewhere |

> Deprecated: `importsNotUsedAsValues` and `preserveValueImports` (use `verbatimModuleSyntax`); `--out` (use `outFile`); legacy `suppressImplicitAnyIndexErrors`-style escape hatches are discouraged.

---

## 10. Official Examples

### Example from Docs: Initialize and build

> Source: [Project References — Build mode](https://www.typescriptlang.org/docs/handbook/project-references.html#build-mode-for-typescript)

```bash
tsc --init                 # create tsconfig.json
tsc                        # compile per config
tsc --build --verbose      # build references with logging
```

**Result:**

```
Projects in this build:
    * tsconfig.json

Project 'tsconfig.json' is out of date because output file 'dist/index.js'
  does not exist

Building project '/path/tsconfig.json'...
```

### Example from Docs: Type-check only

> Source: [Compiler Options — noEmit](https://www.typescriptlang.org/tsconfig#noEmit)

```bash
tsc --noEmit
```

**Result:**

```
Found 0 errors.
```

### Example from Docs: Show resolved config

> Source: [Compiler Options — showConfig](https://www.typescriptlang.org/docs/handbook/compiler-options.html)

```bash
tsc --showConfig
```

**Result:**

```json
{
  "compilerOptions": { "strict": true, "target": "es2022", "outDir": "./dist" },
  "files": ["./src/index.ts"]
}
```

---

## 10b. Canonical Workflows (Reference)

> Quick-reference command recipes that map to the documented behaviors above.

### Initialize and build a project

```bash
tsc --init            # scaffold tsconfig.json
tsc                   # compile per config
node dist/index.js    # run output
```

### Type-check only (CI gate)

```bash
tsc --noEmit --pretty false
echo $?               # 0 clean, 2 errors
```

### Watch during development

```bash
tsc --watch                 # watch + emit
tsc --noEmit --watch        # watch + check only
```

### Multi-config (dev vs build)

```bash
tsc -p tsconfig.json          # dev/check config
tsc -p tsconfig.build.json    # production emit config
```

### Project references (monorepo)

```bash
tsc --build                 # build the whole graph
tsc --build --verbose       # explain each project's status
tsc --build --dry           # preview, build nothing
tsc --build --force         # ignore up-to-date status
tsc --build --clean         # delete all outputs
```

### Library emit

```bash
tsc --declaration --declarationMap          # .js + .d.ts + maps
tsc --emitDeclarationOnly --declaration      # types only (bundler emits JS)
```

### Performance investigation

```bash
tsc --noEmit --diagnostics
tsc --noEmit --extendedDiagnostics
tsc --noEmit --generateTrace .trace
npx @typescript/analyze-trace .trace
```

### Inspection / debugging

```bash
tsc --showConfig            # fully-resolved config
tsc --noEmit --listFiles    # every included file
tsc --noEmit --explainFiles # included files + reasons
tsc --noEmit --traceResolution   # module-resolution decisions
```

---

## 10c. Option Interaction Matrix (Reference)

Selected option combinations that the docs call out as required or forbidden.

| Option A | Option B | Relationship |
|----------|----------|--------------|
| `composite: true` | `declaration` | A **implies** B (forced on) |
| `composite: true` | `noEmit: true` | **Forbidden** together (`TS5069`) |
| `composite: true` | `tsBuildInfoFile` | A makes incremental state mandatory |
| `--project` | file arguments | **Forbidden** together (`TS5042`) |
| `incremental: true` | `--build` | `--build` implies incremental per project |
| `isolatedModules: true` | single-file transpilers | A makes them **safe** |
| `verbatimModuleSyntax: true` | `importsNotUsedAsValues` | A **replaces** B (deprecated) |
| `declaration` | `emitDeclarationOnly` | B requires A's declaration emit |
| `noEmit: true` | `outDir` | `outDir` is ignored (nothing emitted) |
| `allowJs: true` | `.js` in `include` | required to compile JavaScript inputs |

---

## 11. Compliance Checklist

- [ ] Uses a supported `typescript` version, installed locally (pinned in `package.json`).
- [ ] Project builds with bare `tsc`/`tsc -p`/`tsc --build` (no stray file-argument runs).
- [ ] `tsc --noEmit` runs as a CI gate; exit code is not masked.
- [ ] `strict: true` enabled; no undocumented strictness opt-outs.
- [ ] `composite` set on all referenced projects; reference graph is acyclic.
- [ ] `noEmitOnError` set where shipping broken JS is unacceptable.
- [ ] No deprecated options (`importsNotUsedAsValues`, `--out`); migrated to current equivalents.
- [ ] `forceConsistentCasingInFileNames` enabled to avoid cross-OS bugs.

---

## 12. Related Documentation

| Topic | Doc Section | URL |
|-------|-------------|-----|
| Compiler Options | Handbook | [Link](https://www.typescriptlang.org/docs/handbook/compiler-options.html) |
| TSConfig Reference | Reference | [Link](https://www.typescriptlang.org/tsconfig) |
| Project References | Handbook | [Link](https://www.typescriptlang.org/docs/handbook/project-references.html) |
| Configuring Watch | Handbook | [Link](https://www.typescriptlang.org/docs/handbook/configuring-watch.html) |
| Performance | Wiki | [Link](https://github.com/microsoft/TypeScript/wiki/Performance) |
| Diagnostic messages | Source | [Link](https://github.com/microsoft/TypeScript/blob/main/src/compiler/diagnosticMessages.json) |

---

> **Content Rules applied:**
> - Direct links to specific doc sections, not just the homepage.
> - Official option types/defaults from the TSConfig reference.
> - Deprecated options documented with migration paths.
> - Edge cases sourced from official handbook/reference pages.
