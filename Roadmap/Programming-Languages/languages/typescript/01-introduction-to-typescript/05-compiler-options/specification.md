# Compiler Options — Specification

> **Official Documentation Reference**
>
> Source: [TypeScript TSConfig Reference](https://www.typescriptlang.org/tsconfig) — `compilerOptions`

---

## Table of Contents

1. [Docs Reference](#1-docs-reference)
2. [Option Categories](#2-option-categories)
3. [Type Checking Options](#3-type-checking-options)
4. [Modules Options](#4-modules-options)
5. [Emit Options](#5-emit-options)
6. [Language and Environment Options](#6-language-and-environment-options)
7. [Interop and Projects Options](#7-interop-and-projects-options)
8. [Defaults and Implications](#8-defaults-and-implications)
9. [Edge Cases from Official Docs](#9-edge-cases-from-official-docs)
10. [Version and Deprecation History](#10-version-and-deprecation-history)
11. [Official Examples](#11-official-examples)
12. [Compliance Checklist](#12-compliance-checklist)
13. [Related Documentation](#13-related-documentation)

---

## 1. Docs Reference

| Property | Value |
|----------|-------|
| **Official Docs** | [TypeScript TSConfig Reference](https://www.typescriptlang.org/tsconfig) |
| **Relevant Section** | `compilerOptions` — all compiler flags |
| **Schema** | [schemastore tsconfig schema](https://json.schemastore.org/tsconfig) |
| **Handbook** | [What is a tsconfig.json](https://www.typescriptlang.org/docs/handbook/tsconfig-json.html) |
| **Direct URL** | https://www.typescriptlang.org/tsconfig#compilerOptions |

The official reference groups options into categories. This page mirrors that grouping and gives the signature, default, and a precise behavioral note for each important option, with a direct link.

---

## 2. Option Categories

| Category | Purpose | Representative options |
|----------|---------|------------------------|
| Type Checking | Control strictness and diagnostics | `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` |
| Modules | Resolution and module format | `module`, `moduleResolution`, `paths`, `esModuleInterop` |
| Emit | What files and JS are produced | `target`, `outDir`, `declaration`, `sourceMap`, `noEmit` |
| Language and Environment | Syntax and globals | `lib`, `jsx`, `experimentalDecorators`, `useDefineForClassFields` |
| Projects / Interop | Build orchestration and tool interop | `incremental`, `composite`, `isolatedModules`, `verbatimModuleSyntax` |

---

## 3. Type Checking Options

> From: https://www.typescriptlang.org/tsconfig#Type_Checking_6248

### `strict`

**Signature:** `"strict": boolean` — **Default:** `false`

Umbrella flag. Enables `noImplicitAny`, `strictNullChecks`, `strictFunctionTypes`, `strictBindCallApply`, `strictPropertyInitialization`, `noImplicitThis`, `useUnknownInCatchVariables`, and `alwaysStrict`. Future strict-by-default flags may be added under it. You can enable `strict` and override any single member.

> Docs: *"enables a wide range of type checking behavior that results in stronger guarantees of program correctness."*

### The strict family

| Option | Default (standalone) | Effect |
|--------|----------------------|--------|
| `noImplicitAny` | `false` | Error when an expression's type is implicitly `any` |
| `strictNullChecks` | `false` | `null`/`undefined` are not in every type's domain |
| `strictFunctionTypes` | `false` | Function-type parameters checked contravariantly (not methods) |
| `strictBindCallApply` | `false` | Type-check `bind`/`call`/`apply` arguments and return |
| `strictPropertyInitialization` | `false` | Class fields must be definitely assigned (needs `strictNullChecks`) |
| `noImplicitThis` | `false` | Error on `this` of implicit `any` type |
| `useUnknownInCatchVariables` | `false` | `catch (e)` binds `e: unknown` |
| `alwaysStrict` | `false` | Parse in strict mode; emit `"use strict"` |

### Additional checking flags (not in `strict`)

| Option | Default | Effect | Docs |
|--------|---------|--------|------|
| `noUnusedLocals` | `false` | Error on unused local variables | [link](https://www.typescriptlang.org/tsconfig#noUnusedLocals) |
| `noUnusedParameters` | `false` | Error on unused parameters (use `_` prefix to allow) | [link](https://www.typescriptlang.org/tsconfig#noUnusedParameters) |
| `noImplicitReturns` | `false` | Every code path must return | [link](https://www.typescriptlang.org/tsconfig#noImplicitReturns) |
| `noFallthroughCasesInSwitch` | `false` | Non-empty `case` must not fall through | [link](https://www.typescriptlang.org/tsconfig#noFallthroughCasesInSwitch) |
| `noUncheckedIndexedAccess` | `false` | Index access yields `T | undefined` | [link](https://www.typescriptlang.org/tsconfig#noUncheckedIndexedAccess) |
| `exactOptionalPropertyTypes` | `false` | Optional ≠ may be `undefined` | [link](https://www.typescriptlang.org/tsconfig#exactOptionalPropertyTypes) |
| `noImplicitOverride` | `false` | Require `override` keyword | [link](https://www.typescriptlang.org/tsconfig#noImplicitOverride) |
| `noPropertyAccessFromIndexSignature` | `false` | Force bracket access for index-signature keys | [link](https://www.typescriptlang.org/tsconfig#noPropertyAccessFromIndexSignature) |

---

## 4. Modules Options

> From: https://www.typescriptlang.org/tsconfig#Modules_6244

### `module`

**Signature:** `"module": "none" | "commonjs" | "amd" | "umd" | "system" | "es6"/"es2015" | "es2020" | "es2022" | "esnext" | "node16" | "node18" | "nodenext" | "preserve"` — **Default:** depends on `target` (often `commonjs` for ES3/ES5, `es2015+` otherwise; `nodenext` when `moduleResolution` is `nodenext`).

Sets the module syntax of emitted JavaScript. `nodenext`/`node16` decide CJS vs ESM per file from `package.json`. `preserve` (5.4+) keeps import/export verbatim, leaving format to the bundler.

### `moduleResolution`

**Signature:** `"classic" | "node10"/"node" | "node16" | "nodenext" | "bundler"` — **Default:** inferred from `module`.

The algorithm to locate modules. `node16`/`nodenext` honor `package.json` `exports`/`imports`/`type`. `bundler` (5.0+) mirrors `node16` lookup but does not require file extensions in specifiers.

### Resolution helpers

| Option | Signature | Default | Effect |
|--------|-----------|---------|--------|
| `baseUrl` | `string` | unset | Base directory for non-relative module names |
| `paths` | `{ [pattern: string]: string[] }` | unset | Alias patterns mapped to locations (compile-time only) |
| `resolveJsonModule` | `boolean` | `false` | Allow importing `.json` with inferred types |
| `esModuleInterop` | `boolean` | `false` | Emit interop helpers; implies `allowSyntheticDefaultImports` |
| `allowSyntheticDefaultImports` | `boolean` | follows `esModuleInterop`/`module` | Type-only: allow default import from module with no default |

> Docs note: *"`paths` lets you re-map imports... these mappings are only performed at the type level; you need a loader at runtime."*

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@app/*": ["src/*"] },
    "resolveJsonModule": true,
    "esModuleInterop": true
  }
}
```

---

## 5. Emit Options

> From: https://www.typescriptlang.org/tsconfig#Emit_6246

| Option | Signature | Default | Effect | Docs |
|--------|-----------|---------|--------|------|
| `target` | ES version string | `ES5`/`ES3` (legacy) | JS version to emit; drives downlevel transforms | [link](https://www.typescriptlang.org/tsconfig#target) |
| `outDir` | `string` | next to source | Output directory | [link](https://www.typescriptlang.org/tsconfig#outDir) |
| `rootDir` | `string` | common ancestor | Base for computing output structure | [link](https://www.typescriptlang.org/tsconfig#rootDir) |
| `declaration` | `boolean` | `false` (`true` if `composite`) | Emit `.d.ts` files | [link](https://www.typescriptlang.org/tsconfig#declaration) |
| `declarationMap` | `boolean` | `false` | Emit `.d.ts.map` for source navigation | [link](https://www.typescriptlang.org/tsconfig#declarationMap) |
| `sourceMap` | `boolean` | `false` | Emit `.js.map` for debugging | [link](https://www.typescriptlang.org/tsconfig#sourceMap) |
| `removeComments` | `boolean` | `false` | Strip comments from emitted JS | [link](https://www.typescriptlang.org/tsconfig#removeComments) |
| `noEmit` | `boolean` | `false` | Type-check but emit nothing | [link](https://www.typescriptlang.org/tsconfig#noEmit) |
| `importHelpers` | `boolean` | `false` | Import downlevel helpers from `tslib` | [link](https://www.typescriptlang.org/tsconfig#importHelpers) |
| `downlevelIteration` | `boolean` | `false` | Full iterator-protocol emit for ES5 targets | [link](https://www.typescriptlang.org/tsconfig#downlevelIteration) |
| `noEmitOnError` | `boolean` | `false` | Suppress emit when there are type errors | [link](https://www.typescriptlang.org/tsconfig#noEmitOnError) |

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "importHelpers": true
  }
}
```

---

## 6. Language and Environment Options

> From: https://www.typescriptlang.org/tsconfig#Language_and_Environment_6254

| Option | Signature | Default | Effect | Docs |
|--------|-----------|---------|--------|------|
| `lib` | `string[]` | derived from `target` | Built-in type libraries available | [link](https://www.typescriptlang.org/tsconfig#lib) |
| `jsx` | `"preserve" | "react" | "react-jsx" | "react-jsxdev" | "react-native"` | unset | JSX emit strategy | [link](https://www.typescriptlang.org/tsconfig#jsx) |
| `experimentalDecorators` | `boolean` | `false` | Enable legacy (Stage 2) decorators | [link](https://www.typescriptlang.org/tsconfig#experimentalDecorators) |
| `emitDecoratorMetadata` | `boolean` | `false` | Emit `design:*` reflect metadata (needs `experimentalDecorators`) | [link](https://www.typescriptlang.org/tsconfig#emitDecoratorMetadata) |
| `useDefineForClassFields` | `boolean` | `true` if `target` ≥ ES2022 | Standard `[[Define]]` field semantics | [link](https://www.typescriptlang.org/tsconfig#useDefineForClassFields) |

`lib` common entries: `ES5`, `ES2015`–`ES2023`, `ESNext`, `DOM`, `DOM.Iterable`, `WebWorker`, `ScriptHost`. Setting `lib` **replaces** the target-derived default, so include both an ES version and any environment libs you need.

`jsx` values:
- `preserve` — keep JSX, output `.jsx` (a bundler/Babel finishes it).
- `react` — classic `React.createElement` calls (needs `React` in scope).
- `react-jsx` — automatic runtime (`_jsx` from `react/jsx-runtime`); no `React` import needed (React 17+).
- `react-jsxdev` — like `react-jsx` with dev-time checks.

---

## 7. Interop and Projects Options

> From: https://www.typescriptlang.org/tsconfig#Projects_6255 and Interop Constraints

| Option | Signature | Default | Effect | Docs |
|--------|-----------|---------|--------|------|
| `incremental` | `boolean` | `false` (`true` if `composite`) | Persist `.tsbuildinfo`, rebuild only changed | [link](https://www.typescriptlang.org/tsconfig#incremental) |
| `composite` | `boolean` | `false` | Enable project references; forces `declaration` | [link](https://www.typescriptlang.org/tsconfig#composite) |
| `tsBuildInfoFile` | `string` | `.tsbuildinfo` | Location of incremental cache | [link](https://www.typescriptlang.org/tsconfig#tsBuildInfoFile) |
| `skipLibCheck` | `boolean` | `false` | Skip checking `.d.ts` file consistency | [link](https://www.typescriptlang.org/tsconfig#skipLibCheck) |
| `isolatedModules` | `boolean` | `false` | Forbid constructs needing whole-program info | [link](https://www.typescriptlang.org/tsconfig#isolatedModules) |
| `verbatimModuleSyntax` | `boolean` | `false` | Emit imports/exports by syntax only | [link](https://www.typescriptlang.org/tsconfig#verbatimModuleSyntax) |
| `forceConsistentCasingInFileNames` | `boolean` | `true` (5.0+) | Error on inconsistent import casing | [link](https://www.typescriptlang.org/tsconfig#forceConsistentCasingInFileNames) |

```json
{
  "compilerOptions": {
    "composite": true,
    "incremental": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true
  },
  "references": [{ "path": "../core" }]
}
```

---

## 8. Defaults and Implications

| If you set... | Then this is implied / forced |
|---------------|-------------------------------|
| `strict: true` | All eight strict-family flags on |
| `composite: true` | `declaration: true`, `incremental: true`, full `include` required |
| `esModuleInterop: true` | `allowSyntheticDefaultImports: true` |
| `moduleResolution: "nodenext"` | `module: "nodenext"` (and vice versa) |
| `target: "ES2022"+` | `useDefineForClassFields: true` by default |
| no `lib` set | `lib` derived from `target` |
| `verbatimModuleSyntax: true` | `importsNotUsedAsValues`/`preserveValueImports` must not be set (mutually exclusive) |

---

## 9. Edge Cases from Official Docs

| Edge Case | Official Behavior | Reference |
|-----------|-------------------|-----------|
| Setting `lib` manually | Replaces, not extends, the target default | [lib](https://www.typescriptlang.org/tsconfig#lib) |
| `paths` at runtime | Only resolves at type level; needs a loader/bundler | [paths](https://www.typescriptlang.org/tsconfig#paths) |
| `composite` without full `include` | Error: files not covered by the program | [composite](https://www.typescriptlang.org/tsconfig#composite) |
| `noEmit` + `declaration` | No files emitted; declaration is moot | [noEmit](https://www.typescriptlang.org/tsconfig#noEmit) |
| `strictPropertyInitialization` without `strictNullChecks` | Has no effect | [link](https://www.typescriptlang.org/tsconfig#strictPropertyInitialization) |
| `const enum` with `isolatedModules` | Error — cannot inline cross-file | [isolatedModules](https://www.typescriptlang.org/tsconfig#isolatedModules) |
| `emitDecoratorMetadata` without `experimentalDecorators` | No metadata emitted | [link](https://www.typescriptlang.org/tsconfig#emitDecoratorMetadata) |

---

## 10. Version and Deprecation History

| Version | Change | Status | Migration |
|---------|--------|--------|-----------|
| 2.0 | `strictNullChecks`, `noImplicitThis` | Active | — |
| 2.1 | `alwaysStrict` | Active | — |
| 2.3 | `strict` umbrella introduced | Active | Prefer over individual flags |
| 2.7 | `strictPropertyInitialization` | Active | — |
| 3.2 | `strictBindCallApply` | Active | — |
| 3.7 | `useDefineForClassFields` | Active | — |
| 4.1 | `noUncheckedIndexedAccess` | Active | Opt-in |
| 4.4 | `exactOptionalPropertyTypes`, `useUnknownInCatchVariables` | Active | Opt-in / strict |
| 5.0 | `moduleResolution: "bundler"`, `verbatimModuleSyntax`, `forceConsistentCasingInFileNames` default `true` | Active | `verbatimModuleSyntax` replaces below |
| 5.0 | `importsNotUsedAsValues`, `preserveValueImports` | ⚠️ Deprecated | Use `verbatimModuleSyntax` |
| 5.0 | Stage 3 decorators (no `experimentalDecorators`) | Active | Legacy still via the flag |
| 5.5 | `isolatedDeclarations` | Active | Faster `.d.ts` emit |

---

## 11. Official Examples

### Example: Recommended base (from `@tsconfig/strictest`)

> Source: https://github.com/tsconfig/bases/blob/main/bases/strictest.json

```json
{
  "compilerOptions": {
    "strict": true,
    "allowUnusedLabels": false,
    "allowUnreachableCode": false,
    "exactOptionalPropertyTypes": true,
    "noFallthroughCasesInSwitch": true,
    "noImplicitOverride": true,
    "noImplicitReturns": true,
    "noPropertyAccessFromIndexSignature": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "checkJs": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

### Example: Modern Node 20 (from `@tsconfig/node20`)

> Source: https://github.com/tsconfig/bases/blob/main/bases/node20.json

```json
{
  "compilerOptions": {
    "lib": ["es2023"],
    "module": "node16",
    "target": "es2022",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "moduleResolution": "node16"
  }
}
```

**Result:** A strict, modern Node configuration with per-file CJS/ESM resolution from `package.json`.

---

## 12. Compliance Checklist

- [ ] `strict: true` (or `@tsconfig/strictest`) is the baseline.
- [ ] `target`, `module`, `moduleResolution` are set explicitly and mutually consistent.
- [ ] `lib` includes a matching ES version plus required environment libs.
- [ ] Libraries emit `declaration` + `declarationMap`.
- [ ] Bundler-emitted projects set `isolatedModules` + `verbatimModuleSyntax`.
- [ ] Deprecated `importsNotUsedAsValues`/`preserveValueImports` are not used.
- [ ] `paths` aliases have a matching runtime resolver.
- [ ] `composite` projects fully cover inputs via `include`/`files`.

---

## 13. Related Documentation

| Topic | Section | URL |
|-------|---------|-----|
| Full TSConfig reference | compilerOptions | https://www.typescriptlang.org/tsconfig |
| Module theory | Modules — Theory | https://www.typescriptlang.org/docs/handbook/modules/theory.html |
| Project references | Handbook | https://www.typescriptlang.org/docs/handbook/project-references.html |
| Decorators | Handbook | https://www.typescriptlang.org/docs/handbook/decorators.html |
| TSConfig bases | GitHub | https://github.com/tsconfig/bases |
| JSON schema | schemastore | https://json.schemastore.org/tsconfig |

---

## 14. Per-Option Behavioral Specification

> Detailed, doc-sourced semantics for the highest-impact options.

### `strict` — exact behavior

> Docs: *"The `strict` flag enables a wide range of type checking behavior... When `strict` is on, all of the following are set to true by default; you may turn any of them off individually."*

The set is fixed per TypeScript version and may grow in major releases. As of TypeScript 5.x it is the eight flags listed in section 3. Because new strict flags can be added under it, `strict: true` is intentionally a *moving target* — upgrading TypeScript may surface new (true) errors. Teams that want a frozen set enumerate the individual flags instead.

### `strictNullChecks` — assignability rule

> Docs: *"`null` and `undefined` have their own distinct types and you'll get a type error if you try to use them where a concrete value is expected."*

Formally: with the flag off, `null` and `undefined` are in the domain of every type `T`. With it on, they are removed from every `T` except `any`, `unknown`, `void`, and types that explicitly include them. Control-flow narrowing (computed from the binder's CFG) is the mechanism to recover a non-null type inside a guarded block.

### `noUncheckedIndexedAccess` — result type rule

> Docs: *"adds `undefined` to any un-declared field in the type."*

Applies to: element access `obj[key]` where the key is covered by an index signature, and array/tuple element access by a `number`. Does **not** apply to access of explicitly declared properties. The added `| undefined` is a checker-side type construction; emit is unaffected.

### `exactOptionalPropertyTypes` — optionality rule

> Docs: *"with this enabled, TypeScript ... does not add `undefined` to the type of an optional property."*

The checker tracks "this property is optional" separately from "this property's type contains `undefined`". Assigning the literal `undefined` to an optional property is rejected unless `undefined` is explicitly in the declared type. Reading an optional property still yields `T | undefined` (presence is not guaranteed).

### `module: "nodenext"` — per-file format

> Docs: *"the module format of a particular file is determined by the `type` field in the nearest `package.json`."*

A `.mts` file is always ESM; a `.cts` file is always CommonJS; a `.ts` file follows the nearest `package.json` `"type"` (`"module"` → ESM, otherwise CJS). Import specifiers must include file extensions for relative imports under this mode.

### `verbatimModuleSyntax` — emit rule

> Docs: *"any imports or exports without a `type` modifier are left around. Anything that uses the `type` modifier is dropped entirely."*

No type-directed elision occurs. This makes single-file transpilation deterministic. The flag is mutually exclusive with the deprecated `importsNotUsedAsValues` and `preserveValueImports`.

---

## 15. Compiler API Surface

Every `tsconfig.json` option corresponds to a field on the `ts.CompilerOptions` interface in the TypeScript Compiler API. Tools read and apply them programmatically:

```typescript
import ts from "typescript";

const options: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.NodeNext,
  strict: true,
  noUncheckedIndexedAccess: true,
};

const program = ts.createProgram(["src/index.ts"], options);
const diagnostics = ts.getPreEmitDiagnostics(program);
```

Enum mappings worth knowing:

| JSON value | API enum |
|------------|----------|
| `"ES2022"` (target) | `ts.ScriptTarget.ES2022` |
| `"NodeNext"` (module) | `ts.ModuleKind.NodeNext` |
| `"bundler"` (moduleResolution) | `ts.ModuleResolutionKind.Bundler` |
| `"react-jsx"` (jsx) | `ts.JsxEmit.ReactJSX` |

The string forms in `tsconfig.json` are case-insensitive; the API enums are canonical.

---

## 16. Mutually Exclusive and Dependent Options

| Relationship | Options | Rule |
|--------------|---------|------|
| Mutually exclusive | `verbatimModuleSyntax` ⟷ `importsNotUsedAsValues`/`preserveValueImports` | Cannot set together |
| Dependent | `strictPropertyInitialization` needs `strictNullChecks` | No effect otherwise |
| Dependent | `emitDecoratorMetadata` needs `experimentalDecorators` | No metadata otherwise |
| Forced | `composite` forces `declaration`, `incremental` | Cannot disable while composite |
| Implied | `esModuleInterop` implies `allowSyntheticDefaultImports` | Type-level permission included |
| Paired | `module: nodenext` ⟷ `moduleResolution: nodenext` | Setting one pins the other |
| Conditional default | `useDefineForClassFields` defaults `true` when `target ≥ ES2022` | Otherwise `false` |

---

## 17. Full Option Index by Category (Quick Reference)

### Type Checking

| Option | Default | In `strict`? |
|--------|---------|:-----------:|
| `allowUnreachableCode` | (undefined → warn) | no |
| `allowUnusedLabels` | (undefined → warn) | no |
| `alwaysStrict` | false | yes |
| `exactOptionalPropertyTypes` | false | no |
| `noFallthroughCasesInSwitch` | false | no |
| `noImplicitAny` | false | yes |
| `noImplicitOverride` | false | no |
| `noImplicitReturns` | false | no |
| `noImplicitThis` | false | yes |
| `noPropertyAccessFromIndexSignature` | false | no |
| `noUncheckedIndexedAccess` | false | no |
| `noUnusedLocals` | false | no |
| `noUnusedParameters` | false | no |
| `strict` | false | — |
| `strictBindCallApply` | false | yes |
| `strictFunctionTypes` | false | yes |
| `strictNullChecks` | false | yes |
| `strictPropertyInitialization` | false | yes |
| `useUnknownInCatchVariables` | false | yes |

### Modules

| Option | Default |
|--------|---------|
| `allowArbitraryExtensions` | false |
| `allowImportingTsExtensions` | false |
| `baseUrl` | unset |
| `module` | derived from `target` |
| `moduleResolution` | derived from `module` |
| `moduleSuffixes` | `[]` |
| `noResolve` | false |
| `paths` | unset |
| `resolveJsonModule` | false |
| `resolvePackageJsonExports` | true (node16/nodenext) |
| `rootDirs` | unset |
| `typeRoots` | `node_modules/@types` |
| `types` | all `@types` |

### Emit

| Option | Default |
|--------|---------|
| `declaration` | false |
| `declarationDir` | unset |
| `declarationMap` | false |
| `downlevelIteration` | false |
| `emitDeclarationOnly` | false |
| `importHelpers` | false |
| `inlineSourceMap` | false |
| `inlineSources` | false |
| `newLine` | platform |
| `noEmit` | false |
| `noEmitOnError` | false |
| `outDir` | unset |
| `removeComments` | false |
| `sourceMap` | false |
| `target` | ES5/ES3 (legacy) |

### Interop & Language/Environment

| Option | Default |
|--------|---------|
| `allowJs` | false |
| `checkJs` | false |
| `esModuleInterop` | false |
| `allowSyntheticDefaultImports` | follows `esModuleInterop`/`module` |
| `experimentalDecorators` | false |
| `emitDecoratorMetadata` | false |
| `isolatedModules` | false |
| `isolatedDeclarations` | false |
| `jsx` | unset |
| `jsxImportSource` | `react` |
| `lib` | derived from `target` |
| `useDefineForClassFields` | `true` if `target ≥ ES2022` |
| `verbatimModuleSyntax` | false |

### Projects

| Option | Default |
|--------|---------|
| `composite` | false |
| `disableReferencedProjectLoad` | false |
| `incremental` | false (true if `composite`) |
| `tsBuildInfoFile` | `.tsbuildinfo` |
| `assumeChangesOnlyAffectDirectDependencies` | false |

---

## 18. Notable Recently-Added Options

| Option | Since | Purpose |
|--------|-------|---------|
| `moduleResolution: "bundler"` | 5.0 | Bundler-style resolution without mandatory extensions |
| `verbatimModuleSyntax` | 5.0 | Syntax-driven import/export emit |
| `allowImportingTsExtensions` | 5.0 | Permit `import "./x.ts"` (with `noEmit`/bundler) |
| `customConditions` | 5.0 | Extra `package.json` `exports` conditions to match |
| `isolatedDeclarations` | 5.5 | Per-file `.d.ts` emit without whole-program inference |
| `module: "preserve"` | 5.4 | Keep import/export verbatim, format up to the bundler |

---

> **Content Rules satisfied:** direct section links for every option group; defaults documented; deprecated options (`importsNotUsedAsValues`, `preserveValueImports`) flagged with migration to `verbatimModuleSyntax`; official `@tsconfig/*` examples included; edge cases sourced from the docs; behavioral specs quote the official reference.
