# TS and JS Interoperability — Find the Bug

> **Practice finding and fixing interop bugs between TypeScript and JavaScript.**
> Each exercise contains broken code or configuration — find the bug, explain why it happens, and fix it.
> These bugs are specific to interop: wrong `.d.ts`, missing `@types`, default-import interop, JSDoc mistakes, and CJS/ESM confusion.

---

## How to Use

1. Read the buggy code/config carefully.
2. Predict the error or wrong behavior **before** reading the explanation.
3. Write the fix yourself, then compare.
4. Understand **why** — interop bugs are often silent until runtime.

### Difficulty Levels

| Level | Description |
|:-----:|:-----------|
| 🟢 | **Easy** — Common mistakes: runtime code in `.d.ts`, missing `@types`, wrong JSDoc syntax |
| 🟡 | **Medium** — Default-import interop, ambient module shims, `@ts-ignore` misuse, JSDoc casts |
| 🔴 | **Hard** — CJS/ESM emit confusion, `export =` consumption, wrong `@types`, global augmentation |

---

## Bug 1: Runtime Code in a `.d.ts` 🟢

**What it should do:** Declare the types for `math.js`.

```typescript
// math.d.ts
export function add(a: number, b: number): number {
  return a + b;
}
```

**The bug:** A declaration file may contain declarations only — no function bodies or runtime code. This produces `TS1183: An implementation cannot be declared in ambient contexts`.

**Fix:**
```typescript
// math.d.ts
export declare function add(a: number, b: number): number;
```

---

## Bug 2: Missing `@types` Package 🟢

**What it should do:** Import an untyped library.

```typescript
import cool from "cool-lib";
// error TS7016: Could not find a declaration file for module 'cool-lib'.
// 'node_modules/cool-lib/index.js' implicitly has an 'any' type.
```

**The bug:** `cool-lib` ships only JavaScript and no companion types, and no `@types/cool-lib` is installed.

**Fix (option A):**
```bash
npm install --save-dev @types/cool-lib
```

**Fix (option B) — write a shim:**
```typescript
// types/cool-lib.d.ts
declare module "cool-lib" {
  const cool: (input: string) => string;
  export default cool;
}
```

---

## Bug 3: JSDoc `@param` Without `// @ts-check` 🟢

**What it should do:** Type-check a JS function's parameter.

```typescript
// calc.js  (no // @ts-check)
/**
 * @param {number} x
 */
function inc(x) {
  return x + 1;
}
inc("5"); // expected an error, but none appears
```

**The bug:** Without `// @ts-check` (or `checkJs:true`), TypeScript does not enforce the JSDoc, so `inc("5")` is not flagged.

**Fix:**
```typescript
// @ts-check
/**
 * @param {number} x
 */
function inc(x) {
  return x + 1;
}
inc("5"); // now: Argument of type 'string' is not assignable to 'number'.
```

---

## Bug 4: Wrong JSDoc Tag Syntax 🟢

**What it should do:** Type a return value.

```typescript
// @ts-check
/**
 * @return number
 */
function pi() {
  return 3.14;
}
```

**The bug:** The JSDoc type must be wrapped in braces. `@return number` has no brace-delimited type, so TypeScript ignores it and the annotation does nothing. (The tag is `@returns`/`@return`, but the *type* must be `{number}`.)

**Fix:**
```typescript
// @ts-check
/**
 * @returns {number}
 */
function pi() {
  return 3.14;
}
```

---

## Bug 5: Default Import of a CommonJS Module 🟡

**What it should do:** Import the `express` CommonJS module.

```typescript
import express from "express";
const app = express();
// error TS1259: Module '"express"' can only be default-imported using the
// 'esModuleInterop' flag.
```

**The bug:** `express` uses `export =` (CommonJS `module.exports = ...`). A default import is only legal when interop is enabled.

**Fix (config):**
```json
{
  "compilerOptions": {
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true
  }
}
```

**Fix (alternative syntax, no flag):**
```typescript
import express = require("express");
const app = express();
```

---

## Bug 6: Namespace Import That Isn't Callable 🟡

**What it should do:** Call a CJS function module imported as a namespace.

```typescript
import * as express from "express";
const app = express(); // error: This expression is not callable.
```

**The bug:** With `esModuleInterop`, a namespace import is an immutable namespace *object*, not the callable `module.exports`. Calling it is illegal. The default import is the correct shape for a callable CJS export.

**Fix:**
```typescript
import express from "express"; // with esModuleInterop:true
const app = express();
```

---

## Bug 7: `@ts-ignore` Hiding a New Error 🟡

**What it should do:** Temporarily bypass a known-wrong type.

```typescript
// @ts-ignore
const result = compute(a, b);
// later, `compute` is renamed to `calculate`; this line is now a real
// "cannot find name" bug, but CI stays green.
```

**The bug:** `@ts-ignore` suppresses *any* error on the next line forever, including new, unrelated ones. The renamed-function bug is silently swallowed.

**Fix:**
```typescript
// @ts-expect-error -- compute() arg types are wrong upstream (issue #88)
const result = compute(a, b);
// When `compute` is renamed, this still errors visibly, and once the
// upstream types are fixed, @ts-expect-error itself errors (TS2578),
// prompting removal.
```

---

## Bug 8: JSDoc Cast Without Parentheses 🟡

**What it should do:** Cast a DOM lookup to a specific element type.

```typescript
// @ts-check
const el = /** @type {HTMLInputElement} */ document.getElementById("name");
el.value = "Ada"; // error: Property 'value' does not exist on type ...
```

**The bug:** A JSDoc `@type` cast must wrap the expression in parentheses. Without them, the comment does not apply to `document.getElementById(...)`, so `el` stays `HTMLElement | null`.

**Fix:**
```typescript
// @ts-check
const el = /** @type {HTMLInputElement} */ (document.getElementById("name"));
el.value = "Ada";
```

---

## Bug 9: `allowJs` Emit Overwrites Input 🟡

**What it should do:** Compile a mixed JS/TS project to an output folder.

```json
{
  "compilerOptions": {
    "allowJs": true,
    "module": "commonjs"
  },
  "include": ["src"]
}
```

```
error TS5055: Cannot write file 'src/index.js' because it would
overwrite input file.
```

**The bug:** With `allowJs` emitting, no `outDir` is set, so the compiler would write the generated `.js` on top of the source `.js`. TypeScript refuses.

**Fix:**
```json
{
  "compilerOptions": {
    "allowJs": true,
    "module": "commonjs",
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

---

## Bug 10: Wrong `export =` Consumption 🔴

**What it should do:** Consume a CJS module declared with `export =`.

```typescript
// legacy.d.ts
declare const legacy: { run(): void };
export = legacy;

// app.ts
import { run } from "legacy"; // error: Module resolves to a non-module entity
```

**The bug:** `export =` exports a single value, not named bindings. You cannot use a named import against it. Use `import = require(...)` (or a default import if `esModuleInterop` is on).

**Fix:**
```typescript
// app.ts
import legacy = require("legacy");
legacy.run();

// or, with esModuleInterop:true
import legacy from "legacy";
legacy.run();
```

---

## Bug 11: `declare global` Without Making the File a Module 🔴

**What it should do:** Add a typed key to `process.env`.

```typescript
// env.d.ts
declare global {
  namespace NodeJS {
    interface ProcessEnv {
      API_URL: string;
    }
  }
}
// error TS2669: Augmentations for the global scope can only be nested
// in external module declarations or ambient module declarations.
```

**The bug:** `declare global` is only valid inside a *module*. A `.d.ts` with no top-level `import`/`export` is treated as a global script, so the augmentation is rejected.

**Fix:**
```typescript
// env.d.ts
declare global {
  namespace NodeJS {
    interface ProcessEnv {
      API_URL: string;
    }
  }
}
export {}; // makes this file a module
```

---

## Bug 12: Stale `@types` Declares a Non-Existent Method 🔴

**What it should do:** Call a library method through its DefinitelyTyped types.

```typescript
import { format } from "date-lib";
format(new Date(), { legacyMode: true });
// compiles fine, but throws at runtime:
// TypeError: cannot read properties of undefined (reading 'legacyMode')
```

**The bug:** `@types/date-lib` is a major version ahead of the installed `date-lib`. The types declare a `legacyMode` option that the older runtime does not support — types are promises, not guarantees, so the call type-checks but breaks at runtime.

**Fix:**
```bash
# Align versions
npm ls date-lib @types/date-lib
npm install --save-dev @types/date-lib@<matching-major>
```
```typescript
// And validate option support at the boundary if correctness is critical,
// or patch the types via module augmentation to match the real runtime.
```

---

## Bug 13: ESM Import Missing `.js` Extension Under `nodenext` 🔴

**What it should do:** Import a sibling module in a Node-native ESM project.

```typescript
// tsconfig: { "module": "nodenext", "moduleResolution": "nodenext" }
import { helper } from "./helper"; // error TS2835: Relative import paths
// need explicit file extensions in ECMAScript imports when
// '--moduleResolution' is 'node16' or 'nodenext'.
```

**The bug:** Under Node-native resolution, relative imports must include the *emitted* `.js` extension, even from a `.ts` source file. The extensionless specifier is invalid.

**Fix:**
```typescript
import { helper } from "./helper.js"; // points at the emitted helper.js
```

---

## Bug 14: `checkJs` On but No JS in the Program 🔴

**What it should do:** Type-check JavaScript files.

```json
{
  "compilerOptions": {
    "checkJs": true,
    "noEmit": true
  },
  "include": ["src/**/*.js"]
}
```

```
No errors reported even though src has obvious type bugs in .js files.
```

**The bug:** `checkJs` only checks JS files that are *in the program*, and `allowJs` (the flag that admits `.js` files) is `false`. With no `.js` in the program, `checkJs` has nothing to check, so the `.js` files (and their bugs) are silently ignored.

**Fix:**
```json
{
  "compilerOptions": {
    "allowJs": true,
    "checkJs": true,
    "noEmit": true
  },
  "include": ["src/**/*.js"]
}
```

---

## Bug 15: `@ts-expect-error` on a Line With No Error 🟡

**What it should do:** Suppress a known type error.

```typescript
// @ts-expect-error -- types are wrong here
const sum = add(1, 2); // add(a: number, b: number): number — this is FINE
```

```
error TS2578: Unused '@ts-expect-error' directive.
```

**The bug:** The next line has no type error, so `@ts-expect-error` itself errors. This is the directive's *feature* (self-cleaning), but here it means the suppression is stale and should be removed.

**Fix:**
```typescript
const sum = add(1, 2); // remove the directive entirely
```

---

## Bug 16: Wildcard Module Shim Missing `default` 🟡

**What it should do:** Let a bundler-handled `.svg` import work in TS.

```typescript
// shims.d.ts
declare module "*.svg" {
  const url: string;
}

// logo.ts
import logo from "./logo.svg"; // error: Module has no default export.
```

**The bug:** The wildcard module declares a `const url` but never exports it as the default, while the import uses default-import syntax. The shapes don't match.

**Fix:**
```typescript
// shims.d.ts
declare module "*.svg" {
  const url: string;
  export default url;
}
```

---

## Bug 17: `@types` as a Production Dependency 🟢

**What it should do:** Add types for `lodash`.

```json
{
  "dependencies": {
    "lodash": "^4.17.21",
    "@types/lodash": "^4.14.0"
  }
}
```

**The bug:** `@types/lodash` is in `dependencies`, not `devDependencies`. Type packages are compile-time only and erased before runtime; shipping them as prod deps bloats install size and can confuse consumers about what's actually needed at runtime.

**Fix:**
```json
{
  "dependencies": { "lodash": "^4.17.21" },
  "devDependencies": { "@types/lodash": "^4.14.0" }
}
```

---

## Bug 18: CJS Importing ESM-Only Package 🔴

**What it should do:** Use an ESM-only package from a CommonJS file under `nodenext`.

```typescript
// index.cts  (CommonJS)
import chalk from "chalk"; // chalk v5 is ESM-only
// runtime: Error [ERR_REQUIRE_ESM]: require() of ES Module ... not supported
```

**The bug:** Under Node, a CJS module can't synchronously `require()` an ESM-only package; the static import in a `.cts` file emits to `require()`, which fails at runtime. TypeScript models this restriction under `nodenext`.

**Fix (use dynamic import):**
```typescript
// index.cts
async function main() {
  const { default: chalk } = await import("chalk"); // dynamic import works
  console.log(chalk.green("ok"));
}
main();
```

---

## Bug 19: `// @ts-check` Placed After Code 🟢

**What it should do:** Enable checking for the whole JS file.

```typescript
const config = { port: "3000" };
// @ts-check
config.port = 3000; // expected error, but none appears
```

**The bug:** `// @ts-check` must appear at the *top* of the file, before any code. Placed after a statement, it is ignored, so the file is never checked.

**Fix:**
```typescript
// @ts-check
const config = { port: "3000" };
config.port = 3000; // now: Type 'number' is not assignable to type 'string'.
```

---

## Bug 20: Augmenting a Module Without Importing It 🔴

**What it should do:** Add a method to a third-party module's interface.

```typescript
// augment.d.ts
declare module "widget-lib" {
  interface Widget {
    refresh(): void;
  }
}
```

**The bug (subtle):** Without a top-level `import`/`export` somewhere making this a *module augmentation*, `declare module "widget-lib"` is treated as a full ambient module *declaration* that **replaces** the real types rather than merging. The original `Widget` members vanish.

**Fix:**
```typescript
// augment.d.ts
import "widget-lib"; // marks this as an augmentation, not a replacement

declare module "widget-lib" {
  interface Widget {
    refresh(): void;
  }
}
```

---

## Self-Check

After working through these, you should be able to:

- [ ] Spot runtime code illegally placed in a `.d.ts`.
- [ ] Diagnose `TS7016` and fix it three ways (`@types`, shim, bare module).
- [ ] Explain why JSDoc needs `// @ts-check` and brace-delimited types.
- [ ] Fix default vs namespace vs `import =` imports of CommonJS modules.
- [ ] Recognize why `@ts-ignore` is dangerous and replace it with `@ts-expect-error`.
- [ ] Resolve `TS5055` overwrite errors with `outDir`.
- [ ] Make `declare global` valid by turning the file into a module.
- [ ] Catch stale `@types` mismatches and align versions.
- [ ] Add `.js` extensions under `node16`/`nodenext`.
- [ ] Remember that `checkJs` needs `allowJs` to have any effect.
