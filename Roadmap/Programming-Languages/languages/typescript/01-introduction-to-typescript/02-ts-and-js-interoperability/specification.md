# TS and JS Interoperability — Specification

> **Official Documentation Reference**
>
> Sources:
> - [TypeScript Handbook — JS Projects Utilizing TypeScript](https://www.typescriptlang.org/docs/handbook/intro-to-js-ts.html)
> - [Type Checking JavaScript Files](https://www.typescriptlang.org/docs/handbook/intro-to-js-ts.html)
> - [JSDoc Reference](https://www.typescriptlang.org/docs/handbook/jsdoc-supported-types.html)
> - [Declaration Files — Introduction](https://www.typescriptlang.org/docs/handbook/declaration-files/introduction.html)
> - [Modules — Theory & Reference](https://www.typescriptlang.org/docs/handbook/modules/theory.html)
> - [TSConfig Reference](https://www.typescriptlang.org/tsconfig)

---

## Table of Contents

1. [Docs Reference](#1-docs-reference)
2. [The Superset Guarantee](#2-the-superset-guarantee)
3. [`allowJs` and `checkJs` Specification](#3-allowjs-and-checkjs-specification)
4. [Per-File Directives Specification](#4-per-file-directives-specification)
5. [JSDoc Type Annotation Specification](#5-jsdoc-type-annotation-specification)
6. [Declaration Files (`.d.ts`) Reference](#6-declaration-files-dts-reference)
7. [`declare` and Ambient Declarations](#7-declare-and-ambient-declarations)
8. [DefinitelyTyped and `@types/*`](#8-definitelytyped-and-types)
9. [Module Interop Specification](#9-module-interop-specification)
10. [`esModuleInterop` / `allowSyntheticDefaultImports`](#10-esmoduleinterop--allowsyntheticdefaultimports)
11. [CommonJS vs ESM Interop](#11-commonjs-vs-esm-interop)
12. [`skipLibCheck` Specification](#12-skiplibcheck-specification)
13. [Migration Reference](#13-migration-reference)
14. [Edge Cases from Official Docs](#14-edge-cases-from-official-docs)
15. [Version & Deprecation History](#15-version--deprecation-history)
16. [Official Examples](#16-official-examples)
17. [Compliance Checklist](#17-compliance-checklist)
18. [Related Documentation](#18-related-documentation)

---

## 1. Docs Reference

| Property | Value |
|----------|-------|
| **Official Docs** | [TypeScript Documentation](https://www.typescriptlang.org/docs/) |
| **JS Projects Handbook** | https://www.typescriptlang.org/docs/handbook/intro-to-js-ts.html |
| **JSDoc Reference** | https://www.typescriptlang.org/docs/handbook/jsdoc-supported-types.html |
| **Declaration Files** | https://www.typescriptlang.org/docs/handbook/declaration-files/introduction.html |
| **Modules Theory** | https://www.typescriptlang.org/docs/handbook/modules/theory.html |
| **TSConfig Reference** | https://www.typescriptlang.org/tsconfig |
| **DefinitelyTyped** | https://github.com/DefinitelyTyped/DefinitelyTyped |
| **Type Search** | https://www.typescriptlang.org/dt/search |

Interoperability is not a single feature; it is the sum of several compiler behaviors that allow `.ts`, `.tsx`, `.js`, `.jsx`, and `.d.ts` files to coexist in one program, plus the conventions the ecosystem uses to ship and consume type information. This document collects the *normative* behavior of each of those features as defined by the official documentation, so you can reason about exactly what the compiler will and will not do.

---

## 2. The Superset Guarantee

The TypeScript design goals state that TypeScript is a **typed superset of JavaScript that compiles to plain JavaScript**. The practical consequences that govern interop are:

- **Rule 2.1** — Any syntactically valid ECMAScript program is (with rare reserved-word exceptions) a valid TypeScript program. This is what makes renaming `.js` → `.ts` a viable first migration step.
- **Rule 2.2** — Types are **erased** during emit. No `interface`, `type`, `declare`, or type annotation produces runtime JavaScript. This is the single most load-bearing fact in interop: the type layer cannot affect runtime, and runtime cannot be protected by the type layer.
- **Rule 2.3** — Emit and type-checking are **separable**. `tsc --noEmit` checks without producing output; `transpileOnly` tools (esbuild, swc, Babel) emit without checking. Interop tooling exploits this split constantly.

```typescript
// All three of these are valid TS because they are valid JS.
const xs = [1, 2, 3].map((x) => x * 2);
async function f() { return await Promise.resolve(1); }
class Box { #secret = 1; }
```

Because of Rule 2.2, the rest of this specification is fundamentally about *where TypeScript gets type information for JavaScript it cannot see the types of*, and *how it threads imports across module systems*.

---

## 3. `allowJs` and `checkJs` Specification

> Reference: https://www.typescriptlang.org/tsconfig#allowJs and https://www.typescriptlang.org/tsconfig#checkJs

| Option | Type | Default | Meaning |
|--------|------|---------|---------|
| `allowJs` | boolean | `false` | Allow `.js` and `.jsx` files to be **part of the program** (imported, emitted). |
| `checkJs` | boolean | `false` | Report type errors in `.js`/`.jsx` files. **Requires `allowJs`.** |

### Rule 3.1 — `allowJs` controls program membership

With `allowJs: false` (default), `tsc` ignores `.js` files entirely: it will not follow an `import` into a `.js` file, will not emit it, and will report an error if a `.ts` file imports a `.js` file that has no companion `.d.ts`. With `allowJs: true`, `.js` files become first-class program members — they are parsed, included in the module graph, and (if emit is on) copied/transpiled to `outDir`.

### Rule 3.2 — `checkJs` adds type-checking, not transformation

`checkJs` makes the compiler apply the same type-checking it applies to `.ts` files, using **inference** plus any **JSDoc** present. It never changes the runtime semantics of the JavaScript; it only produces diagnostics. `checkJs` implies `allowJs` is meaningful, and the docs note that `checkJs` is effectively the global form of the per-file `// @ts-check`.

### Rule 3.3 — Inference in JS files

In a checked `.js` file, TypeScript infers types from:

- Literal initializers (`const n = 1` → `number`).
- `module.exports` / `exports.x` assignments (CommonJS export inference).
- `require(...)` calls (treated like imports).
- Property assignments on `this` inside constructor functions / ES classes.
- JSDoc tags (see §5).

```typescript
// @ts-check
// inference.js
const config = { port: 3000, host: "localhost" };
config.port = "nope"; // Error: Type 'string' is not assignable to type 'number'.
```

### Rule 3.4 — Looser rules for JS

Per the handbook, checked JS is intentionally more permissive than TS. Examples: property declarations are inferred from constructor assignments; `function` objects can have arbitrary properties assigned; and CommonJS export forms are recognized. This is so that *idiomatic, untyped JS* passes without forcing TS syntax.

---

## 4. Per-File Directives Specification

> Reference: https://www.typescriptlang.org/docs/handbook/intro-to-js-ts.html and the Modules/comments docs.

| Directive | Placement | Effect |
|-----------|-----------|--------|
| `// @ts-check` | Top of a `.js` file | Enable checking for **this file only** (overrides `checkJs:false`). |
| `// @ts-nocheck` | Top of a file | Disable checking for **this file** (works in `.ts` and `.js`). |
| `// @ts-ignore` | Line above a statement | Suppress **any** error on the next line. |
| `// @ts-expect-error` | Line above a statement | Suppress an error on the next line, **and error if there is none**. |

### Rule 4.1 — `@ts-check` / `@ts-nocheck` are file-scoped

They must appear before any code (comments are allowed before them). `// @ts-check` only has visible effect when `checkJs` is off; `// @ts-nocheck` only has visible effect when checking is on.

### Rule 4.2 — `@ts-ignore` vs `@ts-expect-error`

Both suppress diagnostics on the **immediately following line**. The critical difference:

- `@ts-ignore` silently suppresses whether or not an error exists, and keeps suppressing if a *new, different* error appears on that line later.
- `@ts-expect-error` (added in TS 3.9) reports `TS2578: Unused '@ts-expect-error' directive` if the next line has **no** error. This makes it self-cleaning.

```typescript
// @ts-expect-error -- legacy API returns untyped JSON we validate at runtime
const data: { id: number } = JSON.parse(raw);
```

### Rule 4.3 — Directives do not cross lines/blocks

A suppression applies to exactly one line. It cannot suppress errors inside a multi-line expression unless the error is reported on that first line. Whole-file suppression requires `// @ts-nocheck`.

---

## 5. JSDoc Type Annotation Specification

> Reference: https://www.typescriptlang.org/docs/handbook/jsdoc-supported-types.html

In a checked `.js` file, TypeScript reads a documented subset of JSDoc as type annotations. This lets you get type safety **without converting the file to TypeScript**.

### Supported tags (selected, normative subset)

| Tag | Purpose | Example |
|-----|---------|---------|
| `@type` | Type of a variable/expression | `/** @type {string} */ let s;` |
| `@param` | Parameter type | `@param {number} x` |
| `@returns` / `@return` | Return type | `@returns {boolean}` |
| `@typedef` | Define a named type | `@typedef {{a: number}} Point` |
| `@callback` | Define a function type | see below |
| `@template` | Generic type parameter | `@template T` |
| `@property` / `@prop` | Member of a `@typedef` object | `@property {number} x` |
| `@enum` | Object-as-enum type | `@enum {number}` |
| `@implements` / `@extends` / `@augments` | Class relationships | `@implements {Drawable}` |
| `@this` | Type of `this` | `@this {HTMLElement}` |
| `@satisfies` | Apply `satisfies` semantics (TS 4.9+) | `@satisfies {Config}` |
| `@overload` | Declare an overload signature (TS 5.0+) | — |
| `@import` | Type-only import (TS 5.5+) | `@import { Foo } from "./foo"` |

### Rule 5.1 — Cast with `@type`

A parenthesized expression with a leading `@type` comment acts as a cast:

```typescript
// @ts-check
const el = /** @type {HTMLInputElement} */ (document.getElementById("name"));
el.value = "Ada"; // OK because of the cast
```

### Rule 5.2 — `@typedef` and `@callback`

```typescript
// @ts-check
/**
 * @typedef {Object} User
 * @property {string} name
 * @property {number} age
 */

/**
 * @callback Reducer
 * @param {number} acc
 * @param {number} cur
 * @returns {number}
 */

/** @type {User} */
const u = { name: "Ada", age: 36 };

/** @type {Reducer} */
const sum = (a, b) => a + b;
```

### Rule 5.3 — Importing types in JSDoc

You can reference types declared elsewhere with `import(...)` syntax inside JSDoc, or with `@import` (TS 5.5+):

```typescript
// @ts-check
/** @param {import("./models").User} user */
function greet(user) {
  return `Hi ${user.name}`;
}
```

### Rule 5.4 — Unsupported constructs

The docs explicitly list JSDoc features TypeScript ignores or does not support fully (e.g. `@memberof`, `@yields` for typing, some closure-specific syntax). When in doubt, the supported-types page is authoritative.

---

## 6. Declaration Files (`.d.ts`) Reference

> Reference: https://www.typescriptlang.org/docs/handbook/declaration-files/introduction.html

A `.d.ts` file contains **only type declarations** and produces **no JavaScript output**. It describes the *shape* of runtime JavaScript so the type-checker can reason about it.

### Rule 6.1 — Declaration-only

A `.d.ts` may not contain runtime statements (no function bodies, no executable expressions). Only declarations: `declare`, `interface`, `type`, `import type`, `export`, `export =`, `declare module`, `declare global`, `namespace`.

### Rule 6.2 — How TypeScript finds declarations for an import

When you `import x from "lib"`, the compiler resolves types in this order (simplified, for `node`/`node16`/`nodenext` resolution):

1. A `types`/`typings` field in the package's `package.json` (or `exports` `types` condition).
2. An `index.d.ts` (or the resolved file's sibling `.d.ts`).
3. A bundled `.d.ts` alongside the `.js`.
4. A separately installed `@types/lib` package (see §8).
5. A local ambient `declare module "lib"` you authored.

If none are found, the import is implicitly `any` (or an error under `noImplicitAny`).

### Rule 6.3 — Generating declarations

`"declaration": true` makes `tsc` emit `.d.ts` alongside the `.js` it generates from your `.ts`. `"declarationMap": true` adds `.d.ts.map` for go-to-definition. `"emitDeclarationOnly": true` emits only the declarations. This is how a TS library *ships* types for JS consumers.

### Rule 6.4 — Declaration file kinds (from the docs templates)

The handbook provides templates for the common shapes:

- **Global** (`global.d.ts`) — adds to the global scope.
- **Module** (`module.d.ts`) — `declare module "name"` or a file with top-level `export`.
- **Module-class**, **module-function**, **module-plugin**, **UMD** — variations for libraries that are callable, constructable, augment another module, or work both as a global and a module.

```typescript
// math.d.ts — describes math.js
export declare function add(a: number, b: number): number;
export declare function sub(a: number, b: number): number;
export declare const VERSION: string;
```

---

## 7. `declare` and Ambient Declarations

> Reference: https://www.typescriptlang.org/docs/handbook/declaration-files/by-example.html

The `declare` keyword introduces an **ambient declaration**: a type-level statement that asserts something exists at runtime without creating it.

### Rule 7.1 — Ambient values

```typescript
// Asserts a global injected by a <script> tag.
declare const __APP_VERSION__: string;
declare function gtag(command: string, ...args: unknown[]): void;
```

These emit nothing; if the runtime value is missing, you get a `ReferenceError`.

### Rule 7.2 — Ambient modules

```typescript
// shims.d.ts
declare module "untyped-lib" {
  export function doThing(input: string): number;
  export default function init(): void;
}

// Wildcard module: blanket-type an entire family of imports.
declare module "*.svg" {
  const url: string;
  export default url;
}
```

### Rule 7.3 — A bare module shim is `any`

```typescript
// Silences "Could not find a declaration file" by treating the whole module as any.
declare module "legacy-lib";
```

This is the escape hatch the docs suggest when you don't yet want to write real types.

### Rule 7.4 — `declare global` and global augmentation

Inside a module, `declare global { ... }` reaches into the global scope (e.g. to add a property to `Window` or `process.env`). Inside a `.d.ts`, augmenting an existing interface uses **declaration merging**.

```typescript
// env.d.ts
declare global {
  namespace NodeJS {
    interface ProcessEnv {
      API_URL: string;
    }
  }
}
export {}; // make this file a module so `declare global` is required
```

---

## 8. DefinitelyTyped and `@types/*`

> Reference: https://github.com/DefinitelyTyped/DefinitelyTyped and https://www.typescriptlang.org/dt/search

**DefinitelyTyped (DT)** is the community repository of `.d.ts` files for JavaScript libraries that ship no types of their own. Its contents are published to npm under the `@types` scope.

### Rule 8.1 — Installation convention

```bash
npm install lodash                 # the runtime library (plain JS)
npm install --save-dev @types/lodash   # community types (dev-only)
```

`@types/*` packages are **development dependencies** — they contain only `.d.ts`, are erased at compile time, and must never appear in a production bundle.

### Rule 8.2 — Automatic inclusion

By default, TypeScript automatically includes every package under `node_modules/@types` (and walks up parent `node_modules/@types` folders). The `types` and `typeRoots` compiler options narrow or redirect this:

- `"typeRoots": ["./node_modules/@types", "./custom-types"]` — which folders to scan.
- `"types": ["node", "jest"]` — restrict auto-inclusion to a specific allow-list (a performance lever).

### Rule 8.3 — Version alignment

A `@types/x` package version tracks the library's major/minor where possible but is independent. A mismatch (types ahead of or behind the runtime) is a common source of phantom methods or missing signatures. The official guidance is to prefer libraries that ship their own types; fall back to `@types/*` only when they don't.

---

## 9. Module Interop Specification

> Reference: https://www.typescriptlang.org/docs/handbook/modules/theory.html

The single hardest part of interop is **modules**, because the JS ecosystem has two incompatible module systems — **CommonJS (CJS)** (`require` / `module.exports`) and **ES Modules (ESM)** (`import` / `export`) — and TypeScript must model how they interoperate at runtime.

### Rule 9.1 — `module` vs `moduleResolution`

- `module` controls the **emit** format (`commonjs`, `esnext`, `node16`, `nodenext`, etc.).
- `moduleResolution` controls **how specifiers are resolved** (`node10`/`node`, `node16`, `nodenext`, `bundler`).

The two must be coherent. Modern recommendations: `"module": "nodenext"` for Node, or `"module": "esnext"` + `"moduleResolution": "bundler"` for bundled apps.

### Rule 9.2 — `export =` and `import =`

`export = X` models a CommonJS `module.exports = X`. The TS-native way to consume it is `import X = require("mod")`. Default-import syntax against `export =` only works when `esModuleInterop` (or `allowSyntheticDefaultImports`) is on — see §10.

### Rule 9.3 — File-extension rules under `node16`/`nodenext`

Under Node-native resolution, relative imports must include the **`.js` extension of the emitted file**, even when writing in a `.ts` source file:

```typescript
import { helper } from "./helper.js"; // points at the emitted helper.js
```

Whether a file is ESM or CJS at runtime is decided by `package.json`'s `"type"` field and the file extension (`.mts` = ESM, `.cts` = CJS).

---

## 10. `esModuleInterop` / `allowSyntheticDefaultImports`

> Reference: https://www.typescriptlang.org/tsconfig#esModuleInterop

| Option | Default | Effect |
|--------|---------|--------|
| `esModuleInterop` | `false` (but `true` in `tsc --init`) | Emit helper code (`__importDefault`, `__importStar`) so ESM default/namespace imports work correctly against CJS modules. **Implies `allowSyntheticDefaultImports`.** |
| `allowSyntheticDefaultImports` | derived | Type-check-only: allow `import x from "cjs"` even when the module has no default export. Does **not** change emit. |

### Rule 10.1 — The problem it solves

A CommonJS module with `module.exports = function () {}` has no real `default` export. Without interop, `import express from "express"` fails (`TS1259`/`TS2497`) because there is no default member, and `import * as express from "express"` may be non-callable per spec. `esModuleInterop` makes the compiler emit a runtime helper so the default import resolves to the whole `module.exports` value.

```typescript
// With esModuleInterop:true
import express from "express";
const app = express(); // works — `express` is the module.exports function

// Without it you are pushed toward:
import express = require("express");
```

### Rule 10.2 — `allowSyntheticDefaultImports` alone

If your bundler already performs the interop at runtime (so you don't want TS to emit helpers), set `esModuleInterop:false` but `allowSyntheticDefaultImports:true` to satisfy the type-checker without changing emit. Setting `esModuleInterop:true` turns this on automatically.

### Rule 10.3 — Consistency requirement

The docs warn that `esModuleInterop` changes emitted runtime helpers, so all packages in a project (and consumers of your emitted code) should agree. Flipping it mid-project can change which value a default import yields.

---

## 11. CommonJS vs ESM Interop

> Reference: https://www.typescriptlang.org/docs/handbook/modules/reference.html

### Rule 11.1 — ESM importing CJS

A CJS module's `module.exports` object becomes the **default export** of the (synthetic) ES module, and its enumerable named properties become named exports (Node's interop). `esModuleInterop` aligns TypeScript's view with this behavior.

### Rule 11.2 — CJS importing ESM

In Node, a CJS file cannot `require()` an ESM-only package synchronously (historically); it must use dynamic `import()`. TypeScript models this: under `nodenext`, importing an ESM-only module from a CJS context is restricted accordingly.

### Rule 11.3 — `verbatimModuleSyntax`

`"verbatimModuleSyntax": true` (TS 5.0+, replacing `importsNotUsedAsValues`/`isolatedModules` interplay) makes the compiler emit imports/exports **verbatim**, dropping only `import type`/`export type`. It forbids ambiguous elision and forces you to use `import type` for type-only imports. This produces predictable CJS/ESM emit and is recommended for libraries.

```typescript
import type { User } from "./models";   // erased
import { createUser } from "./factory"; // kept verbatim
```

### Rule 11.4 — `.mts` / `.cts` / `.mjs` / `.cjs`

TypeScript honors the Node extension scheme: `.mts`→`.mjs` (ESM), `.cts`→`.cjs` (CJS). This lets a single project mix both module systems file-by-file, which is itself a form of interop.

---

## 12. `skipLibCheck` Specification

> Reference: https://www.typescriptlang.org/tsconfig#skipLibCheck

| Option | Default | Effect |
|--------|---------|--------|
| `skipLibCheck` | `false` | Skip type-checking of all declaration files (`*.d.ts`). |

### Rule 12.1 — What it skips

It does **not** skip checking your `.ts`/`.js` source. It skips checking the **bodies of `.d.ts` files** (yours and those in `node_modules`). The compiler still uses those declarations to type your code; it just doesn't validate that the declarations are internally consistent.

### Rule 12.2 — Why use it

Large projects pull in many `@types` packages that can conflict (e.g. two versions of `@types/node`). Those conflicts produce errors that are not your code's fault and are slow to check. `skipLibCheck` sidesteps them and speeds up cold builds (often 20–40% on dependency-heavy projects).

### Rule 12.3 — The trade-off

It can hide genuine bugs in a dependency's types or in your own `.d.ts`. The recommended posture: enable it for app builds, but in a library you publish, consider a separate CI step without `skipLibCheck` to validate your own emitted declarations.

---

## 13. Migration Reference

> Reference: https://www.typescriptlang.org/docs/handbook/migrating-from-javascript.html

The handbook describes a staged path from a JS project to TypeScript:

1. **Add a `tsconfig.json`** with `allowJs: true` so JS keeps compiling.
2. **Integrate with the build** (often via a bundler or `tsc` in the pipeline).
3. **Move to TS files** one at a time, starting with leaf modules.
4. **Turn on `checkJs`** (or sprinkle `// @ts-check`) to surface errors in remaining JS.
5. **Tighten strictness** incrementally (`noImplicitAny`, then full `strict`).
6. **Get `@types` for dependencies**; write shims for the rest.

The key normative point: at every stage the project keeps building, because `allowJs` and `@ts-check`/`checkJs` make TS adoption additive rather than a rewrite.

---

## 14. Edge Cases from Official Docs

### Edge 1 — `checkJs` without `allowJs`

`checkJs:true` only matters for files in the program; without `allowJs`, no `.js` files are in the program, so it does nothing. The docs treat `checkJs` as implying you want JS in the program.

### Edge 2 — Implicit `any` from missing declarations

Importing a module with no resolvable types yields `any` for the whole module. Under `noImplicitAny`, this becomes error `TS7016` ("Could not find a declaration file for module ...").

### Edge 3 — `allowJs` and overwriting source

If `allowJs:true`, `outDir` is unset, and `module` differs from your JS, `tsc` may try to emit a `.js` next to the input and refuse (`TS5055`: cannot write file because it would overwrite the input). Always set `outDir` when emitting JS.

### Edge 4 — `@ts-expect-error` on a line that *gains* a different error

`@ts-expect-error` only requires *some* error on the next line. It does not verify *which* error, so it can mask a newly introduced, unrelated error on the same line.

### Edge 5 — Default export of a CJS module under `verbatimModuleSyntax`

With `verbatimModuleSyntax:true`, you cannot use `export default` in a file that must emit to CJS in a way that conflicts; the compiler enforces consistent module syntax, which can surface as an error during migration.

### Edge 6 — `@types` resolution and monorepos

Because TS walks up `node_modules/@types`, a hoisted or duplicated `@types/node` in a monorepo can cause version conflicts that only `skipLibCheck` or a `types` allow-list resolves.

---

## 15. Version & Deprecation History

| Version | Change |
|---------|--------|
| **1.8** | `allowJs` introduced. |
| **2.3** | `checkJs` and `// @ts-check` / `// @ts-nocheck` introduced for JS files. |
| **2.7** | `esModuleInterop` introduced. |
| **3.7** | Assertion-style and many JSDoc improvements. |
| **3.9** | `// @ts-expect-error` introduced. |
| **4.5** | `.mts`/`.cts` and `node12` (later `node16`) module modes. |
| **4.7** | `node16`/`nodenext` module + resolution, package `exports`/`imports` support. |
| **4.9** | `satisfies` operator and `@satisfies` JSDoc tag. |
| **5.0** | `verbatimModuleSyntax`; deprecated `importsNotUsedAsValues`, `preserveValueImports`; `@overload` JSDoc. |
| **5.5** | `@import` JSDoc tag; inferred type predicates; improved JS checking. |

**Deprecations to note:** `importsNotUsedAsValues` and `preserveValueImports` are deprecated in favor of `verbatimModuleSyntax`. `suppressImplicitAnyIndexErrors`-style blanket suppressions are discouraged in favor of targeted directives.

---

## 16. Official Examples

### Example 16.1 — Minimal JS project utilizing TS

```json
{
  "compilerOptions": {
    "allowJs": true,
    "checkJs": true,
    "noEmit": true,
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"]
}
```

### Example 16.2 — Typing an untyped module

```typescript
// types/untyped-lib.d.ts
declare module "untyped-lib" {
  export interface Options {
    retries?: number;
  }
  export function run(opts?: Options): Promise<void>;
}
```

### Example 16.3 — JSDoc-typed JS module

```typescript
// @ts-check
/**
 * @param {{ id: number, name: string }} user
 * @returns {string}
 */
function label(user) {
  return `#${user.id} ${user.name}`;
}

module.exports = { label };
```

### Example 16.4 — Consuming CJS with interop

```typescript
// tsconfig: { "esModuleInterop": true }
import path from "node:path";
import express from "express";

const app = express();
console.log(path.join("a", "b"));
```

---

## 17. Compliance Checklist

Use this to confirm a project is interop-correct:

- [ ] `allowJs` is on if any `.js` is imported from `.ts`.
- [ ] `checkJs` (or `// @ts-check`) is enabled where JS should be type-safe.
- [ ] Every untyped dependency has `@types/*` installed **or** a local `declare module` shim.
- [ ] `esModuleInterop` is on (or a bundler handles interop) for clean default imports of CJS.
- [ ] `outDir` is set whenever `allowJs` emits, to avoid `TS5055`.
- [ ] `.d.ts` files contain declarations only — no runtime code.
- [ ] All `@ts-ignore`/`@ts-expect-error` directives carry a reason and prefer `@ts-expect-error`.
- [ ] `skipLibCheck` is considered for build speed, with a separate strict lib-check step for published libraries.
- [ ] `module`/`moduleResolution` are coherent (`nodenext`/`nodenext` or `esnext`/`bundler`).
- [ ] Type-only imports use `import type` (and `verbatimModuleSyntax` for predictable emit).

---

## 18. Related Documentation

- **JS Projects Utilizing TypeScript:** https://www.typescriptlang.org/docs/handbook/intro-to-js-ts.html
- **JSDoc Supported Types:** https://www.typescriptlang.org/docs/handbook/jsdoc-supported-types.html
- **Declaration Files Introduction:** https://www.typescriptlang.org/docs/handbook/declaration-files/introduction.html
- **Declaration Files by Example:** https://www.typescriptlang.org/docs/handbook/declaration-files/by-example.html
- **Modules — Theory:** https://www.typescriptlang.org/docs/handbook/modules/theory.html
- **Modules — Reference:** https://www.typescriptlang.org/docs/handbook/modules/reference.html
- **Migrating from JavaScript:** https://www.typescriptlang.org/docs/handbook/migrating-from-javascript.html
- **TSConfig Reference:** https://www.typescriptlang.org/tsconfig
- **DefinitelyTyped:** https://github.com/DefinitelyTyped/DefinitelyTyped
