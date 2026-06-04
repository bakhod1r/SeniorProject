# ts-node — Specification

> **Official Documentation Reference**
>
> Primary sources:
> - ts-node: https://typestrong.org/ts-node/
> - ts-node docs site: https://typestrong.org/ts-node/docs/
> - Node.js Modules (ESM) & loader hooks: https://nodejs.org/api/module.html
> - Node.js TypeScript support (native): https://nodejs.org/api/typescript.html
> - TypeScript tsconfig reference: https://www.typescriptlang.org/tsconfig

---

## Table of Contents

1. [Docs Reference](#1-docs-reference)
2. [CLI / API Reference](#2-cli--api-reference)
3. [Core Concepts & Rules](#3-core-concepts--rules)
4. [Options Reference](#4-options-reference)
5. [Behavioral Specification](#5-behavioral-specification)
6. [Node Loader Hooks Specification](#6-node-loader-hooks-specification)
7. [Node Native Type Stripping Specification](#7-node-native-type-stripping-specification)
8. [Platform / Version Compatibility](#8-platform--version-compatibility)
9. [Edge Cases from Official Docs](#9-edge-cases-from-official-docs)
10. [Version & Deprecation History](#10-version--deprecation-history)
11. [Official Examples](#11-official-examples)
12. [Compliance Checklist](#12-compliance-checklist)
13. [Related Documentation](#13-related-documentation)

---

## 1. Docs Reference

| Property | Value |
|----------|-------|
| **Official Docs** | [ts-node Documentation](https://typestrong.org/ts-node/) |
| **Repository** | https://github.com/TypeStrong/ts-node |
| **Relevant Sections** | Overview, Configuration, CommonJS vs ESM, Options, Recipes |
| **Current Version** | ts-node v10.9.x |
| **Node Loader Hooks** | https://nodejs.org/api/module.html#customization-hooks |
| **Node Native TS** | https://nodejs.org/api/typescript.html |

`ts-node` is maintained under the TypeStrong organization. The canonical reference is the docs site at typestrong.org/ts-node, mirrored from the repository `website/` folder.

---

## 2. CLI / API Reference

> From: https://typestrong.org/ts-node/docs/usage/

### Command-Line Usage

**Signature:**
```bash
ts-node [options] [ -e script | script.ts ] [arguments]
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--transpile-only`, `-T` | boolean | `false` | Skip type checking; transpile only |
| `--type-check` | boolean | `true` | Enable type checking (default) |
| `--swc` | boolean | `false` | Use swc as the transpiler |
| `--esm` | boolean | `false` | Bootstrap with the ESM loader |
| `--project`, `-P` | string | nearest `tsconfig.json` | Path to a tsconfig file |
| `--compiler`, `-C` | string | `"typescript"` | Compiler module to use |
| `--files` | boolean | `false` | Load `files`/`include` from tsconfig |
| `--compiler-options`, `-O` | JSON | — | Inline compilerOptions JSON |
| `--ignore-diagnostics`, `-D` | code[] | — | Diagnostic codes to ignore |
| `--require`, `-r` | module[] | — | Modules to require before run |
| `--script-mode`, `-s` | boolean | `false` | Resolve config relative to the script |
| `--print`, `-p` | boolean | `false` | Print the result of `--eval` |
| `--eval`, `-e` | string | — | Evaluate code inline |
| `--interactive`, `-i` | boolean | `false` | Force REPL even with `--eval` |
| `--version`, `-v` | — | — | Print versions |

### Programmatic API

```typescript
import { register, create, createRepl } from "ts-node";

// Register hooks for the current process
register({ transpileOnly: true });

// Create a standalone compiler service
const service = create({ project: "tsconfig.json" });
const js = service.compile("const x: number = 1;", "inline.ts");
```

**Returns:** `register()` returns the `Service`; `create()` returns a `Service`; `createRepl()` returns a REPL controller.

---

## 3. Core Concepts & Rules

### Rule 1: ts-node Respects tsconfig.json

> *Docs: [Configuration](https://typestrong.org/ts-node/docs/configuration) — "ts-node automatically finds and loads your tsconfig.json."*

`ts-node` discovers the nearest `tsconfig.json` and applies its `compilerOptions`. A `ts-node` sub-block can override options only for `ts-node` runs.

```json
// ✅ Correct — ts-node-specific overrides isolated from your build
{
  "compilerOptions": { "module": "ESNext" },
  "ts-node": {
    "compilerOptions": { "module": "CommonJS" },
    "transpileOnly": true
  }
}

// ❌ Incorrect — forcing CommonJS globally breaks an ESM build output
{
  "compilerOptions": { "module": "CommonJS" }
}
```

### Rule 2: Module System Must Match Node's Determination

> *Docs: [CommonJS vs ESM](https://typestrong.org/ts-node/docs/imports/) — "ts-node supports both, but configuration differs."*

`ts-node` must emit module syntax consistent with how Node classifies the file (via `"type"` and extension). For ESM you must use the ESM bootstrap.

```bash
# ✅ Correct ESM invocation
ts-node --esm src/app.ts
node --loader ts-node/esm src/app.ts

# ❌ Incorrect — CJS hook on an ESM project
node -r ts-node/register src/app.ts   # ERR_UNKNOWN_FILE_EXTENSION
```

### Rule 3: ESM Relative Imports Require Explicit Extensions

> *Docs: Node ESM resolution requires file extensions; TypeScript does not rewrite specifiers.*

```typescript
// ✅ Correct under ESM
import { helper } from "./util.js";

// ❌ Incorrect — missing extension
import { helper } from "./util";
```

---

## 4. Options Reference

| Option (tsconfig `ts-node` block) | Type | Default | Since | Description |
|-----------------------------------|------|---------|-------|-------------|
| `transpileOnly` | boolean | `false` | 7.0 | Skip type checking |
| `swc` | boolean | `false` | 10.0 | Use swc transpiler |
| `esm` | boolean | `false` | 10.0 | Enable ESM support |
| `files` | boolean | `false` | 7.0 | Include tsconfig `files`/`include` |
| `compiler` | string | `"typescript"` | 1.0 | Alternate compiler module |
| `compilerOptions` | object | — | 8.0 | ts-node-only compiler overrides |
| `ignore` | string[] | `["/node_modules/"]` | 5.0 | Paths to skip compiling |
| `ignoreDiagnostics` | (number\|string)[] | — | 7.0 | Diagnostic codes to ignore |
| `preferTsExts` | boolean | `false` | 8.0 | Prefer `.ts` over `.js` |
| `require` | string[] | — | 9.0 | Modules to require on init (e.g. `tsconfig-paths/register`) |
| `experimentalResolver` ⚠️ | boolean | `false` | 10.0 | Improved resolver — Use `moduleResolution: NodeNext` instead where possible |

### Environment Variables

| Variable | Equivalent |
|----------|-----------|
| `TS_NODE_PROJECT` | `--project` |
| `TS_NODE_TRANSPILE_ONLY` | `--transpile-only` |
| `TS_NODE_COMPILER_OPTIONS` | `--compiler-options` |
| `TS_NODE_FILES` | `--files` |
| `TS_NODE_PREFER_TS_EXTS` | `preferTsExts` |
| `TS_NODE_IGNORE` | `ignore` |
| `TS_NODE_LOG_ERROR` | log errors but continue |

---

## 5. Behavioral Specification

### Execution Model

`ts-node` registers hooks into Node's module loader, then loads your entrypoint. Each `.ts`/`.tsx` file encountered during loading is compiled in memory before execution. Type checking (default) runs lazily per file as it is required.

### Performance Characteristics

- First require pays the program-construction cost (parsing all reachable `.d.ts`).
- `skipLibCheck` removes `node_modules` `.d.ts` type-checking cost.
- `transpileOnly`/`swc` remove the type-checking phase entirely.
- The compiled output is cached in memory for the process lifetime.

### Side Effects

- Patches `require.extensions` (CommonJS) and/or installs an ESM loader.
- Installs `source-map-support` for `.ts`-accurate stack traces.
- Throws `TSError` on diagnostics in default mode, aborting load.

---

## 6. Node Loader Hooks Specification

> From: https://nodejs.org/api/module.html#customization-hooks

Node's ESM customization hooks are the official mechanism `ts-node/esm` uses.

### Registration

```javascript
// Modern API (Node 20.6+)
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("ts-node/esm", pathToFileURL("./"));
```

### Hook: `resolve`

```typescript
resolve(
  specifier: string,
  context: { conditions: string[]; importAttributes: object; parentURL?: string },
  nextResolve: Function
): { url: string; format?: string | null; shortCircuit?: boolean };
```

### Hook: `load`

```typescript
load(
  url: string,
  context: { format?: string | null; importAttributes: object },
  nextLoad: Function
): { format: string; source: string | ArrayBuffer; shortCircuit?: boolean };
```

> *Docs quote: "Loaders run in a dedicated thread, isolated from the main thread."* (applies to `--import`/`register` based hooks in recent Node).

### Deprecated Forms

| Form | Status | Replacement |
|------|--------|-------------|
| `--experimental-loader` | deprecated alias | `--loader` then `register()` |
| `--loader` | discouraged | `--import` + `module.register()` |
| `getFormat`, `getSource`, `transformSource` | removed | merged into `load` |

---

## 7. Node Native Type Stripping Specification

> From: https://nodejs.org/api/typescript.html

| Feature | Flag | Node Version | Behavior |
|---------|------|--------------|----------|
| Strip types | `--experimental-strip-types` | 22.6.0+ | Erase type annotations; run JS |
| Transform TS-only syntax | `--experimental-transform-types` | 22.7.0+ | Also handle enums, namespaces, param props |
| Default-on stripping | (none) | 23.6.0+ | `node file.ts` strips by default |
| Disable | `--no-experimental-strip-types` | 23.6.0+ | Turn stripping back off |

### Constraints (from official docs)

> *"Type stripping does not perform type checking."*

- Strip-only mode rejects non-erasable syntax (`enum`, `namespace` with runtime code, parameter properties).
- Use `erasableSyntaxOnly` in `tsconfig.json` to keep code compatible.
- Import specifiers must include extensions (mandatory file extensions).
- `--experimental-transform-types` implies `--experimental-strip-types`.

```json
// tsconfig.json for native-strip compatibility
{
  "compilerOptions": {
    "module": "NodeNext",
    "verbatimModuleSyntax": true,
    "erasableSyntaxOnly": true,
    "allowImportingTsExtensions": true,
    "rewriteRelativeImportExtensions": true
  }
}
```

---

## 8. Platform / Version Compatibility

| Capability | Node 18 | Node 20 | Node 22 | Node 23.6+ | Node 24 LTS |
|-----------|---------|---------|---------|-----------|-------------|
| ts-node (CJS) | ✅ | ✅ | ✅ | ✅ | ✅ |
| ts-node (ESM `--loader`) | ✅ | ⚠️ deprecated | ⚠️ | ⚠️ | ⚠️ |
| ts-node (`--import`/register) | ❌ | ✅ (20.6+) | ✅ | ✅ | ✅ |
| `module.register()` | ❌ | ✅ (20.6+) | ✅ | ✅ | ✅ |
| `--experimental-strip-types` | ❌ | ❌ | ✅ (22.6+) | ✅ | ✅ |
| Strip default-on | ❌ | ❌ | ❌ | ✅ | ✅ |
| `--experimental-transform-types` | ❌ | ❌ | ✅ (22.7+) | ✅ | ✅ (flag) |

| ts-node version | Min Node | Min TypeScript | Notes |
|-----------------|----------|----------------|-------|
| 10.9.x | 12.20+ | 2.7+ | swc + ESM support |
| 10.0.x | 12.x | 2.7+ | ESM loader, swc backend added |
| 9.x | 10.x | 2.7+ | Legacy |

---

## 9. Edge Cases from Official Docs

| Edge Case | Official Behavior | Reference |
|-----------|-------------------|-----------|
| `.ts` file in `"type":"module"` package | Treated as ESM; needs ESM bootstrap | [Imports docs](https://typestrong.org/ts-node/docs/imports/) |
| Missing extension on relative ESM import | `ERR_MODULE_NOT_FOUND` | [Node ESM](https://nodejs.org/api/esm.html#mandatory-file-extensions) |
| `const enum` under `transpileOnly`/swc | Not inlined; may error | [transpile-only docs](https://typestrong.org/ts-node/docs/options/) |
| Path aliases (`paths`) at runtime | Not resolved; add `tsconfig-paths` | [Paths recipe](https://typestrong.org/ts-node/docs/paths/) |
| Ambient `.d.ts` globals not seen | Use `files: true` | [Configuration](https://typestrong.org/ts-node/docs/configuration) |
| `enum` under native strip-only | Rejected; needs `--experimental-transform-types` | [Node TS docs](https://nodejs.org/api/typescript.html) |

---

## 10. Version & Deprecation History

| Version / Date | Change | Deprecated? | Migration |
|----------------|--------|-------------|-----------|
| ts-node 7.0 | `transpileOnly` option | ❌ | — |
| ts-node 10.0 | swc backend, ESM loader, `ts-node` config block | ❌ | — |
| Node 16.12 | New loader hook shape (`load` consolidates) | ⚠️ old hooks | Use `load`/`resolve` |
| Node 18.6 | `--loader` chaining | ⚠️ | Prefer `register()` |
| Node 20.6 | `module.register()` + `--import` | ❌ | Migrate off `--loader` |
| Node 22.6 | `--experimental-strip-types` | ❌ | — |
| Node 23.6 | Type stripping on by default | ❌ | — |
| Various Node | `--experimental-loader` | ✅ Deprecated | Use `--import` + `register()` |

---

## 11. Official Examples

### Example from Docs: CommonJS Quick Start

> Source: [https://typestrong.org/ts-node/docs/](https://typestrong.org/ts-node/docs/)

```bash
npm install -D ts-node typescript @types/node
echo 'console.log("Hello, ts-node!")' > index.ts
npx ts-node index.ts
```

**Result:**
```
Hello, ts-node!
```

### Example from Docs: ESM via package.json

> Source: [https://typestrong.org/ts-node/docs/imports/](https://typestrong.org/ts-node/docs/imports/)

```json
// package.json
{
  "type": "module",
  "ts-node": {
    "esm": true
  }
}
```

```bash
node --loader ts-node/esm src/app.ts
```

### Example from Docs: Native Node Stripping

> Source: [https://nodejs.org/api/typescript.html](https://nodejs.org/api/typescript.html)

```bash
node --experimental-strip-types app.ts   # Node 22.6 - 23.5
node app.ts                               # Node 23.6+
```

---

## 12. Compliance Checklist

- [ ] Uses the correct bootstrap for the project's module system (CJS hook vs ESM loader)
- [ ] ESM relative imports include explicit extensions
- [ ] `ts-node` config overrides are scoped in the `ts-node` block, not global `compilerOptions`
- [ ] On Node 20.6+, uses `--import`/`register()` rather than deprecated `--loader`
- [ ] Production builds use `tsc` (no `ts-node` at runtime)
- [ ] For native stripping, code is `erasableSyntaxOnly`-compatible

---

## 13. Related Documentation

| Topic | Section | URL |
|-------|---------|-----|
| ts-node configuration | Configuration | https://typestrong.org/ts-node/docs/configuration |
| ts-node imports (CJS/ESM) | Imports | https://typestrong.org/ts-node/docs/imports/ |
| Node module hooks | Customization Hooks | https://nodejs.org/api/module.html#customization-hooks |
| Node native TypeScript | TypeScript | https://nodejs.org/api/typescript.html |
| TypeScript tsconfig | Reference | https://www.typescriptlang.org/tsconfig |
| tsx (alternative) | Docs | https://tsx.is/ |
| swc | Docs | https://swc.rs/docs/usage/swc-node |

---

## 13b. Tool Comparison (from official + ecosystem docs)

| Tool | Official docs | Engine | Type-checks |
|------|---------------|--------|-------------|
| ts-node | https://typestrong.org/ts-node/ | tsc / swc | Yes (default) |
| tsx | https://tsx.is/ | esbuild | No |
| @swc-node | https://github.com/swc-project/swc-node | swc | No |
| Bun | https://bun.sh/docs/runtime/typescript | builtin | No |
| Deno | https://docs.deno.com/runtime/manual/advanced/typescript | swc | Yes |
| Node native | https://nodejs.org/api/typescript.html | builtin strip | No |

---

## 14. Official Recipes

> From: https://typestrong.org/ts-node/docs/recipes/

### Recipe: Mocha

```json
// .mocharc.json
{
  "require": "ts-node/register",
  "extensions": ["ts"],
  "spec": ["test/**/*.spec.ts"],
  "watch-files": ["src", "test"]
}
```

### Recipe: tsconfig paths

> From: https://typestrong.org/ts-node/docs/paths/

```bash
node -r ts-node/register -r tsconfig-paths/register src/index.ts
```

```json
// or via config
{ "ts-node": { "require": ["tsconfig-paths/register"] } }
```

### Recipe: Visual Studio Code Debugging

```json
// .vscode/launch.json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Launch via ts-node",
      "runtimeArgs": ["-r", "ts-node/register"],
      "args": ["${workspaceFolder}/src/index.ts"],
      "cwd": "${workspaceFolder}"
    }
  ]
}
```

### Recipe: AVA, Jest, and other runners

> From: https://typestrong.org/ts-node/docs/recipes/

Each runner has its own integration point: AVA via `extensions`/`require`, Jest via `ts-jest` (which wraps the compiler), and so on. The common thread is the register hook.

---

## 15. Diagnostic / Error Code Reference

| Code / Error | Origin | Meaning |
|--------------|--------|---------|
| `TSError` | ts-node | Aggregated TypeScript diagnostics in default mode |
| `ERR_UNKNOWN_FILE_EXTENSION` | Node | `.ts` reached the ESM pipeline without the loader |
| `ERR_MODULE_NOT_FOUND` | Node | Missing extension on a relative ESM import |
| `ERR_REQUIRE_ESM` | Node | `require()` of an ESM-only module |
| `TS2307` | tsc | Cannot find module (e.g. unresolved `paths` alias at type time) |
| `TS1208` | tsc | `isolatedModules` requires modules to be importable independently |
| `TS5097` | tsc | Import path can only end with `.ts` extension with `allowImportingTsExtensions` |

### Behavior of `ignoreDiagnostics`

```json
{ "ts-node": { "ignoreDiagnostics": [7006, "TS2345"] } }
```

Accepts numeric codes or `TS`-prefixed strings. Use sparingly; prefer fixing the underlying issue.

---

## 16. tsconfig Options Most Relevant to ts-node

> From: https://www.typescriptlang.org/tsconfig

| Option | Effect under ts-node |
|--------|----------------------|
| `module` | Determines emitted module syntax; must match Node's CJS/ESM determination |
| `moduleResolution` | `NodeNext`/`Bundler`/`Node` change how imports resolve |
| `target` | Downlevel level of emitted JS |
| `skipLibCheck` | Skips `.d.ts` checking — big speed win in type-checked mode |
| `isolatedModules` | Flags code that breaks under transpile-only/swc |
| `sourceMap`/`inlineSourceMap` | Controls `.ts`-accurate stack traces |
| `esModuleInterop` | CJS↔ESM default-import interop |
| `verbatimModuleSyntax` | Preserves import/export syntax; aids ESM and stripping |
| `erasableSyntaxOnly` | Bans non-erasable syntax for native-strip compatibility |
| `allowImportingTsExtensions` | Permit `.ts` in import specifiers (with native resolution) |

---

## 17. ESM Support Status Notes

> From: https://typestrong.org/ts-node/docs/imports/ and Node release notes

- ESM support in `ts-node` is documented as experimental and tracks Node's evolving loader API.
- The `--loader` form is deprecated upstream; the `--import ts-node/register/esm` form is preferred on Node 20.6+.
- Because the loader API has changed repeatedly, ESM behavior is the most version-sensitive part of `ts-node`. The official docs recommend pinning Node and consulting the imports page for your version.
- For new ESM projects where the friction is high, the ecosystem increasingly recommends `tsx` or native stripping; this is noted in community guidance though not in the `ts-node` docs themselves.

---

> **Content Rules applied for `specification.md`:**
> - All sections link directly to the relevant doc area.
> - Version/compatibility tables cover Node 18 → 24 and ts-node 9 → 10.9.
> - Deprecated loader forms documented with migration paths.
> - Official CLI signatures and option types included.
> - Native Node type stripping specified with exact flags and Node versions.
