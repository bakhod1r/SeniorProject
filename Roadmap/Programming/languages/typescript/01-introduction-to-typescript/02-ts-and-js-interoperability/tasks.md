# TS and JS Interoperability — Practical Tasks

> Hands-on tasks ordered from junior to professional. Each task has a goal, requirements,
> starter context, and acceptance criteria. Do them in a scratch repo with TypeScript installed
> (`npm i -D typescript`). Verify with the commands shown.

## Table of Contents

1. [Task 1 — Junior: Rename JS to TS](#task-1--junior-rename-js-to-ts)
2. [Task 2 — Junior: Enable allowJs + checkJs](#task-2--junior-enable-allowjs--checkjs)
3. [Task 3 — Junior: Type a JS File with JSDoc](#task-3--junior-type-a-js-file-with-jsdoc)
4. [Task 4 — Junior: Consume an @types Package](#task-4--junior-consume-an-types-package)
5. [Task 5 — Middle: Write a Hand-Made .d.ts](#task-5--middle-write-a-hand-made-dts)
6. [Task 6 — Middle: Fix a CJS Default Import](#task-6--middle-fix-a-cjs-default-import)
7. [Task 7 — Middle: Shim an Untyped Module](#task-7--middle-shim-an-untyped-module)
8. [Task 8 — Middle: Suppress Safely with @ts-expect-error](#task-8--middle-suppress-safely-with-ts-expect-error)
9. [Task 9 — Senior: Global Augmentation for process.env](#task-9--senior-global-augmentation-for-processenv)
10. [Task 10 — Senior: Patch a Wrong @types Package](#task-10--senior-patch-a-wrong-types-package)
11. [Task 11 — Senior: Generate .d.ts for a TS Library](#task-11--senior-generate-dts-for-a-ts-library)
12. [Task 12 — Professional: Dual CJS/ESM Library](#task-12--professional-dual-cjsesm-library)
13. [Task 13 — Middle: Type a Wildcard Asset Import](#task-13--middle-type-a-wildcard-asset-import)
14. [Task 14 — Senior: JSDoc Generics and @callback](#task-14--senior-jsdoc-generics-and-callback)
15. [Task 15 — Professional: Verify Published Types with attw](#task-15--professional-verify-published-types-with-attw)
16. [Mini Projects](#mini-projects)
17. [Challenge](#challenge)
18. [Stretch Goals](#stretch-goals)

---

## Task 1 — Junior: Rename JS to TS

**Goal:** Convert a plain JS file to TypeScript and add types, confirming the superset guarantee.

**Requirements:**
- Start from a working `.js` file.
- Rename it to `.ts`; it must still compile unchanged.
- Then add type annotations.

**Starter:**
```typescript
// user.js (before)
// function makeUser(name, age) {
//   return { name, age };
// }
// module.exports = { makeUser };

// user.ts (after rename + types)
interface User {
  name: string;
  age: number;
}

export function makeUser(name: string, age: number): User {
  return { name, age };
}
```

**Acceptance Criteria:**
- [ ] The renamed file compiles with `npx tsc --noEmit user.ts`.
- [ ] `makeUser("Ada", "old")` is now a compile error.
- [ ] The return type is `User`, verified by hovering or `tsc`.

---

## Task 2 — Junior: Enable allowJs + checkJs

**Goal:** Make TypeScript include and check existing JavaScript.

**Requirements:**
- Create a `tsconfig.json` enabling `allowJs` and `checkJs` with `noEmit`.
- Have one `.js` file with an obvious type bug.

**Starter:**
```typescript
// legacy.js
function double(x) {
  return x * 2;
}
double("not a number");
```

**Reference config:**
```json
{
  "compilerOptions": {
    "allowJs": true,
    "checkJs": true,
    "noEmit": true,
    "strict": true
  },
  "include": ["**/*.js"]
}
```

**Acceptance Criteria:**
- [ ] `npx tsc` reports an error on `double("not a number")`.
- [ ] Removing `checkJs` makes the error disappear.
- [ ] Adding `// @ts-nocheck` to the top of `legacy.js` also silences it.

---

## Task 3 — Junior: Type a JS File with JSDoc

**Goal:** Get type safety in a `.js` file without converting it.

**Requirements:**
- Add `// @ts-check` and JSDoc to a plain JS module.
- Type the parameters and return value.

**Starter:**
```typescript
// @ts-check
// geometry.js

/**
 * @param {number} width
 * @param {number} height
 * @returns {number}
 */
function area(width, height) {
  return width * height;
}

area(3, 4);      // OK
area("3", 4);    // should error
```

**Acceptance Criteria:**
- [ ] `area("3", 4)` reports a type error.
- [ ] A `@typedef` is added for a `Rectangle` object and used in a second function.
- [ ] The file remains a `.js` file (no conversion).

---

## Task 4 — Junior: Consume an @types Package

**Goal:** Install and use community types for an untyped library.

**Requirements:**
- Install a JS-only library plus its `@types` package.
- Use a typed function from it.

**Starter:**
```bash
npm install lodash
npm install --save-dev @types/lodash
```

```typescript
import { chunk } from "lodash";

const pages: number[][] = chunk([1, 2, 3, 4, 5], 2);
console.log(pages);
```

**Acceptance Criteria:**
- [ ] `pages` is typed as `number[][]` (hover to confirm).
- [ ] `chunk([1,2,3], "2")` is a compile error.
- [ ] `@types/lodash` appears under `devDependencies`, not `dependencies`.

---

## Task 5 — Middle: Write a Hand-Made .d.ts

**Goal:** Describe an untyped JS module with a declaration file you author.

**Requirements:**
- Given a JS module with no types, write a matching `.d.ts`.
- Cover its exported function and a constant.

**Starter:**
```typescript
// legacy-lib.js (cannot modify)
// module.exports = {
//   version: "1.2.3",
//   formatName(first, last) { return first + " " + last; }
// };

// legacy-lib.d.ts — author this
declare const legacyLib: {
  version: string;
  formatName(first: string, last: string): string;
};
export = legacyLib;
```

**Acceptance Criteria:**
- [ ] `import legacyLib = require("./legacy-lib");` type-checks.
- [ ] `legacyLib.formatName("Ada")` errors (missing argument).
- [ ] The `.d.ts` contains no runtime code.

---

## Task 6 — Middle: Fix a CJS Default Import

**Goal:** Resolve a CommonJS default-import error with the right config flag.

**Requirements:**
- Reproduce the `TS1259`/`TS2497` default-import error.
- Fix it with `esModuleInterop`.

**Starter:**
```typescript
// server.ts — fails without interop
import express from "express";
const app = express();
app.get("/", (_req, res) => res.send("ok"));
```

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "esModuleInterop": true
  }
}
```

**Acceptance Criteria:**
- [ ] With `esModuleInterop:false`, `tsc` errors on the default import.
- [ ] With `esModuleInterop:true`, it compiles.
- [ ] You can explain what `allowSyntheticDefaultImports` would have done differently (type-only, no emit change).

---

## Task 7 — Middle: Shim an Untyped Module

**Goal:** Make a truly untyped import compile under `noImplicitAny`.

**Requirements:**
- Import a package with no types and no `@types`.
- Add an ambient module declaration so it stops erroring.

**Starter:**
```typescript
// types/cool-lib.d.ts
declare module "cool-lib" {
  export function doCoolThing(input: string): string;
}

// app.ts
import { doCoolThing } from "cool-lib";
console.log(doCoolThing("hi"));
```

**Acceptance Criteria:**
- [ ] Without the shim, `tsc` reports `TS7016`.
- [ ] With the shim, `doCoolThing` is typed `(input: string) => string`.
- [ ] A bare `declare module "cool-lib";` is shown as the `any` fallback alternative.

---

## Task 8 — Middle: Suppress Safely with @ts-expect-error

**Goal:** Replace risky suppressions with self-cleaning ones.

**Requirements:**
- Find a line suppressed by `@ts-ignore`.
- Replace with `@ts-expect-error` plus a reason.
- Demonstrate the self-cleaning behavior.

**Starter:**
```typescript
// @ts-expect-error -- @types/foo@1.0 is missing the `retries` option (issue #421)
risky({ retries: 3 });
```

**Acceptance Criteria:**
- [ ] Removing the (simulated) underlying error makes `@ts-expect-error` itself error (`TS2578`).
- [ ] Every suppression in the file carries a `--` reason comment.
- [ ] No `@ts-ignore` remains.

---

## Task 9 — Senior: Global Augmentation for process.env

**Goal:** Add typed environment variables via global augmentation.

**Requirements:**
- Add typed keys to `NodeJS.ProcessEnv`.
- Confirm autocomplete and error on missing keys.

**Starter:**
```typescript
// env.d.ts
declare global {
  namespace NodeJS {
    interface ProcessEnv {
      API_URL: string;
      PORT: string;
    }
  }
}
export {};
```

**Acceptance Criteria:**
- [ ] `process.env.API_URL` autocompletes and is typed `string`.
- [ ] `process.env.NOPE` is flagged when `strict`/index checks are on (or is `string | undefined` as configured).
- [ ] The `export {}` is present so `declare global` is valid.

---

## Task 10 — Senior: Patch a Wrong @types Package

**Goal:** Correct an incorrect third-party type with module augmentation.

**Requirements:**
- Given an `@types` package that declares a field non-nullable when it is actually nullable, fix the type without forking.

**Starter:**
```typescript
// patches/widget-lib.d.ts
import "widget-lib";

declare module "widget-lib" {
  interface Widget {
    // upstream says `label: string`; runtime can be null
    label: string | null;
  }
}
```

**Acceptance Criteria:**
- [ ] After the augmentation, `widget.label` is `string | null`.
- [ ] Code that assumed non-null now requires a null check.
- [ ] The patch file is included via `include`/`typeRoots`.

---

## Task 11 — Senior: Generate .d.ts for a TS Library

**Goal:** Ship types for a TypeScript library so JS and TS consumers both benefit.

**Requirements:**
- Enable declaration emit.
- Wire `package.json` `types` to the emitted file.

**Starter:**
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
// package.json
{
  "main": "dist/index.js",
  "types": "dist/index.d.ts"
}
```

**Acceptance Criteria:**
- [ ] `npx tsc` emits `dist/index.d.ts` (and `.d.ts.map`).
- [ ] A consumer importing the package gets full IntelliSense.
- [ ] `emitDeclarationOnly` is shown as the types-only variant.

---

## Task 12 — Professional: Dual CJS/ESM Library

**Goal:** Publish a library consumable as both CommonJS and ESM with correct types.

**Requirements:**
- Produce a `.cjs` build and an `.mjs` build (two configs or `.cts`/`.mts`).
- Provide a `package.json` `exports` map with `import`/`require`/`types` conditions.
- Validate the published types.

**Starter:**
```json
// package.json
{
  "name": "dual-lib",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.mjs",
      "require": "./dist/index.cjs"
    }
  }
}
```

**Acceptance Criteria:**
- [ ] An ESM consumer (`import x from "dual-lib"`) resolves to the `.mjs` build.
- [ ] A CJS consumer (`require("dual-lib")`) resolves to the `.cjs` build.
- [ ] `verbatimModuleSyntax` is on for predictable emit.
- [ ] `npx @arethetypeswrong/cli` (or equivalent) reports no interop problems.

---

## Task 13 — Middle: Type a Wildcard Asset Import

**Goal:** Make non-code imports (handled by a bundler) type-check in TypeScript.

**Requirements:**
- Write a wildcard ambient module for `*.svg` (and `*.css`).
- Import an asset and use the typed default.

**Starter:**
```typescript
// shims.d.ts
declare module "*.svg" {
  const url: string;
  export default url;
}
declare module "*.css" {
  const classes: Record<string, string>;
  export default classes;
}

// logo.ts
import logoUrl from "./logo.svg";
const img = { src: logoUrl };
```

**Acceptance Criteria:**
- [ ] `import logoUrl from "./logo.svg"` type-checks as `string`.
- [ ] Without the shim, the import errors.
- [ ] The shim is discovered via `include`/`typeRoots`.

---

## Task 14 — Senior: JSDoc Generics and @callback

**Goal:** Express a generic function and a function-type alias in JSDoc only.

**Requirements:**
- Write a generic `identity` and a `@callback`-typed reducer in a checked `.js` file.

**Starter:**
```typescript
// @ts-check
/**
 * @template T
 * @param {T} value
 * @returns {T}
 */
function identity(value) {
  return value;
}

/**
 * @callback Reducer
 * @param {number} acc
 * @param {number} cur
 * @returns {number}
 */

/** @type {Reducer} */
const add = (a, b) => a + b;
```

**Acceptance Criteria:**
- [ ] `identity(5)` is typed `number`; `identity("x")` is typed `string`.
- [ ] `add("1", 2)` errors.
- [ ] The file stays `.js` with `// @ts-check`.

---

## Task 15 — Professional: Verify Published Types with attw

**Goal:** Catch interop problems in a package's published types before release.

**Requirements:**
- Build a small dual-format package.
- Run `@arethetypeswrong/cli` and resolve any reported issues.

**Starter:**
```bash
npm pack            # produce the tarball
npx @arethetypeswrong/cli --pack .
```

**Acceptance Criteria:**
- [ ] `attw` runs and produces a report.
- [ ] Any "masquerading as CJS/ESM" or "no types" findings are fixed via `exports` conditions and `.d.cts`/`.d.mts`.
- [ ] The final report is clean for both `import` and `require` consumers.

---

## Mini Projects

### Mini Project A — Gradual Migration of a Small Utility Lib

Build a `string-utils` package starting in JS and migrate it to TS:

1. Begin with `src/*.js`, `allowJs:true`, `checkJs:false`, building successfully.
2. Add `// @ts-check` + JSDoc to each file one at a time; fix surfaced errors.
3. Flip `checkJs:true` globally; the build must stay green.
4. Convert files to `.ts` leaf-first; add `interface`s.
5. Enable `strict:true` last.

**Done when:** every file is `.ts`, `strict` is on, `tsc --noEmit` is clean, and you can show the git history of incremental conversion.

### Mini Project B — Typed Wrapper Around an Untyped SDK

Pick an untyped npm package. Write a `wrapper.ts` that:

1. Adds a `declare module` shim (or a real `.d.ts`) covering only the API you use.
2. Re-exports a narrow, strictly-typed surface.
3. Validates inputs/outputs at the boundary with a runtime check.

**Done when:** consumers import only your typed wrapper, never the raw untyped module.

---

## Challenge

**Build an interop linting gate.**

Create a small repo that enforces interop hygiene in CI:

1. `tsconfig.json` with `allowJs`, `checkJs`, `strict`, `noImplicitAny`, `skipLibCheck`.
2. A lint rule (eslint `@typescript-eslint/ban-ts-comment`) that bans bare `@ts-ignore` and requires a description on `@ts-expect-error`.
3. A CI job running `tsc --noEmit` that fails on any new untyped import (`TS7016`).
4. A second CI job for your own emitted `.d.ts` that runs **without** `skipLibCheck`.
5. A documented `@types` version-alignment check (`npm ls` script that fails on major mismatch).

**Acceptance Criteria:**
- [ ] A PR adding a bare `@ts-ignore` fails CI.
- [ ] A PR importing an untyped lib without a shim fails CI.
- [ ] A broken self-authored `.d.ts` is caught by the no-`skipLibCheck` job.
- [ ] The README documents the gradual-migration policy the gate enforces.

---

## Stretch Goals

- Convert a `.js` JSDoc-typed file into an equivalent `.ts` file and diff the type errors.
- Write a UMD declaration file for a library usable both as a global and a module.
- Reproduce and fix a `TS5055` overwrite error by introducing `outDir`.
- Set up `node16` resolution and fix all relative imports to include `.js` extensions.
- Use `@arethetypeswrong/cli` on a real published package and interpret its report.
