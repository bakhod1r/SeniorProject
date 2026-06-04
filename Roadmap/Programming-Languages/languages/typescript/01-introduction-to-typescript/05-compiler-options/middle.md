# Compiler Options — Middle Level

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [The `strict` Umbrella](#the-strict-umbrella)
3. [The Strict Family, Flag by Flag](#the-strict-family-flag-by-flag)
   - [`noImplicitAny`](#noimplicitany)
   - [`strictNullChecks`](#strictnullchecks)
   - [`strictFunctionTypes`](#strictfunctiontypes)
   - [`strictBindCallApply`](#strictbindcallapply)
   - [`strictPropertyInitialization`](#strictpropertyinitialization)
   - [`noImplicitThis`](#noimplicitthis)
   - [`useUnknownInCatchVariables`](#useunknownincatchvariables)
   - [`alwaysStrict`](#alwaysstrict)
4. [Beyond `strict`: Extra Correctness Flags](#beyond-strict-extra-correctness-flags)
   - [`noUnusedLocals` and `noUnusedParameters`](#nounusedlocals-and-nounusedparameters)
   - [`noImplicitReturns`](#noimplicitreturns)
   - [`noFallthroughCasesInSwitch`](#nofallthroughcasesinswitch)
   - [`exactOptionalPropertyTypes`](#exactoptionalpropertytypes)
   - [`noUncheckedIndexedAccess`](#nouncheckedindexedaccess)
5. [Module Resolution at the Middle Level](#module-resolution-at-the-middle-level)
6. [Putting It Together](#putting-it-together)
7. [When and Why to Enable Each Flag](#when-and-why-to-enable-each-flag)
8. [Middle Checklist](#middle-checklist)
9. [Common Mistakes](#common-mistakes)
10. [Test](#test)
11. [Summary](#summary)
12. [Further Reading](#further-reading)

---

## Prerequisites

- You set `strict: true` reflexively in new projects (from the Junior level).
- You are comfortable with interfaces, type aliases, unions, narrowing, and basic generics.
- You build real apps (React, Node, or similar) and have hit type errors you had to think about.
- You can read emitted JavaScript and recognize CommonJS vs ESM output.

This page goes deep on **what each strict sub-flag actually catches** and the additional correctness flags every senior codebase turns on. By the end you should be able to justify each flag in a code review.

---

## The `strict` Umbrella

`strict: true` is shorthand. Internally it sets a group of flags to `true`. You can also set `strict: true` and then **opt out** of one specific flag:

```json
{
  "compilerOptions": {
    "strict": true,
    "strictPropertyInitialization": false
  }
}
```

The flags that `strict` controls:

| Flag | Added in | One-line effect |
|------|----------|-----------------|
| `noImplicitAny` | 1.0 | Error when a type silently becomes `any` |
| `strictNullChecks` | 2.0 | `null`/`undefined` are their own types |
| `strictFunctionTypes` | 2.6 | Function parameters checked contravariantly |
| `strictBindCallApply` | 3.2 | `bind`/`call`/`apply` are type-checked |
| `strictPropertyInitialization` | 2.7 | Class fields must be initialized |
| `noImplicitThis` | 2.0 | Error on `this` with an implicit `any` type |
| `useUnknownInCatchVariables` | 4.4 | `catch (e)` gives `e: unknown` not `any` |
| `alwaysStrict` | 2.1 | Emit `"use strict"` and parse in strict mode |

Each flag is independently settable, so you can adopt strictness gradually by turning `strict` off and enabling individual flags one at a time (covered in `senior.md`).

---

## The Strict Family, Flag by Flag

### `noImplicitAny`

When TypeScript cannot infer a type and would otherwise fall back to `any`, this flag turns that into an error. It forces you to be explicit instead of silently losing type safety.

```typescript
// noImplicitAny: false  → param is silently 'any'
function double(x) {
  return x * 2; // x is any; no help, no checking
}

// noImplicitAny: true   → error
function double(x) {
  //            ~ Error: Parameter 'x' implicitly has an 'any' type.
  return x * 2;
}

// Fix: annotate
function double(x: number) {
  return x * 2;
}
```

It also fires on implicit-any from index access and untyped imports. This is the foundational strict flag — without it, large swaths of code go unchecked.

### `strictNullChecks`

The most impactful flag. Without it, `null` and `undefined` are assignable to **every** type, which hides the most common class of runtime crashes. With it, they become distinct types you must handle.

```typescript
// strictNullChecks: false → compiles, crashes at runtime
function firstChar(s: string) {
  return s.charAt(0);
}
firstChar(null); // boom at runtime

// strictNullChecks: true → caught at compile time
firstChar(null);
//        ~~~~ Error: Argument of type 'null' is not assignable to parameter of type 'string'.
```

It changes how optional values flow:

```typescript
interface User { name: string; nickname?: string }

function show(u: User) {
  // u.nickname is string | undefined under strictNullChecks
  console.log(u.nickname.toUpperCase());
  //          ~~~~~~~~~~~ Error: 'u.nickname' is possibly 'undefined'.
}
```

You handle it with narrowing:

```typescript
function show(u: User) {
  if (u.nickname) {
    console.log(u.nickname.toUpperCase()); // narrowed to string
  }
}
```

### `strictFunctionTypes`

Makes function-type parameters checked **contravariantly** (the mathematically sound rule), catching unsafe callback assignments. It applies to function types written as `(x) => y`, not to methods (a deliberate carve-out for usability).

```typescript
declare let f: (x: string | number) => void;
declare let g: (x: string) => void;

// strictFunctionTypes: true
f = g; // Error: a (string)=>void cannot stand in for a (string|number)=>void,
       // because f might be called with a number, which g cannot handle.
```

Without the flag, this unsafe assignment is allowed and can blow up when `f` is called with a `number`.

### `strictBindCallApply`

Type-checks the arguments and return type of `Function.prototype.bind`, `call`, and `apply`. Before this flag those methods accepted anything.

```typescript
function greet(name: string, age: number) {
  return `${name} is ${age}`;
}

// strictBindCallApply: true
greet.call(undefined, "Ada", "thirty");
//                            ~~~~~~~~~ Error: Argument of type 'string' is not
//                            assignable to parameter of type 'number'.

const bound = greet.bind(null, "Ada"); // bound: (age: number) => string
bound(42); // OK, fully typed
```

### `strictPropertyInitialization`

Requires that class instance properties are assigned in the constructor (or have an initializer), so you cannot read an undefined field. It depends on `strictNullChecks` being on.

```typescript
// strictPropertyInitialization: true
class Service {
  client: HttpClient;
  // ~~~~~~ Error: Property 'client' has no initializer and is not
  //        definitely assigned in the constructor.
}

// Fixes:
class Service {
  client: HttpClient = new HttpClient();        // initializer
}
class Service {
  client: HttpClient;
  constructor() { this.client = new HttpClient(); } // constructor assignment
}
class Service {
  client!: HttpClient; // definite assignment assertion — "trust me, it's set later"
}
```

The `!` escape hatch is for cases like dependency injection frameworks that assign fields after construction.

### `noImplicitThis`

Errors when `this` has an implicit `any` type — usually a standalone function that uses `this` without declaring what it is.

```typescript
// noImplicitThis: true
function handler() {
  console.log(this.id);
  //          ~~~~ Error: 'this' implicitly has type 'any'.
}

// Fix: declare a `this` parameter
function handler(this: { id: string }) {
  console.log(this.id); // OK
}
```

This catches a classic JavaScript footgun where `this` is not what you think it is.

### `useUnknownInCatchVariables`

Before TypeScript 4.4, the variable in `catch (e)` was typed `any`. With this flag (on by default under `strict` since 4.4) it is `unknown`, forcing you to narrow before using it. This is correct because a thrown value can be anything — not just an `Error`.

```typescript
// useUnknownInCatchVariables: true
try {
  doWork();
} catch (e) {
  console.log(e.message);
  //          ~ Error: 'e' is of type 'unknown'.
}

// Fix: narrow first
try {
  doWork();
} catch (e) {
  if (e instanceof Error) {
    console.log(e.message); // narrowed to Error
  } else {
    console.log("Non-error thrown:", e);
  }
}
```

### `alwaysStrict`

Parses every file in ECMAScript strict mode and emits `"use strict";` at the top of output (when the module format allows it). It catches strict-mode-only errors like assigning to a read-only global or using a reserved word as a variable name. It is almost always desirable and is part of `strict`.

```typescript
// alwaysStrict: true → emitted JS begins with "use strict";
// and constructs illegal in strict mode (e.g. `with` statements) are errors.
```

---

## Beyond `strict`: Extra Correctness Flags

These are **not** part of `strict`. You opt into them. Every mature codebase enables most of them.

### `noUnusedLocals` and `noUnusedParameters`

Report dead variables and parameters. They keep code clean and catch typos (you imported something and forgot to use it because you spelled the usage wrong).

```typescript
// noUnusedLocals: true
function calc() {
  const total = 0; // Error: 'total' is declared but its value is never read.
  return 42;
}

// noUnusedParameters: true
function onClick(event: MouseEvent) {
  //             ~~~~~ Error: 'event' is declared but its value is never read.
  doSomething();
}
// Convention: prefix with _ to intentionally ignore
function onClick(_event: MouseEvent) {
  doSomething(); // _event is allowed unused
}
```

### `noImplicitReturns`

Errors when some code paths return a value and others fall off the end implicitly returning `undefined`. It forces every branch to be explicit.

```typescript
// noImplicitReturns: true
function classify(n: number): string {
  if (n > 0) return "positive";
  if (n < 0) return "negative";
  // Error: Not all code paths return a value. (zero falls through)
}

// Fix
function classify(n: number): string {
  if (n > 0) return "positive";
  if (n < 0) return "negative";
  return "zero";
}
```

### `noFallthroughCasesInSwitch`

Errors when a non-empty `case` falls through to the next without `break`, `return`, or `throw`. This catches the classic switch bug.

```typescript
// noFallthroughCasesInSwitch: true
switch (status) {
  case "active":
    notify();
    // Error: Fallthrough case in switch.
  case "inactive":
    archive();
    break;
}

// Empty fallthrough is still allowed (intentional grouping):
switch (status) {
  case "active":
  case "pending":
    keep();
    break;
}
```

### `exactOptionalPropertyTypes`

Makes a distinction between "property absent" and "property present but set to `undefined`". Without it, `{ x?: number }` silently allows `{ x: undefined }`. With it, optional means *may be missing*, not *may be explicitly undefined*.

```typescript
interface Options { timeout?: number }

// exactOptionalPropertyTypes: true
const a: Options = {};                 // OK — absent
const b: Options = { timeout: 1000 };  // OK — present
const c: Options = { timeout: undefined };
//                   ~~~~~~~ Error: Type '{ timeout: undefined }' is not assignable...
//                   Consider adding 'undefined' to the type: 'timeout?: number | undefined'.
```

This matters for code that uses `"key" in obj` checks, where the two cases behave differently at runtime.

### `noUncheckedIndexedAccess`

Adds `| undefined` to the result of indexed access on arrays and objects with index signatures. It reflects the reality that `arr[i]` might be out of bounds.

```typescript
// noUncheckedIndexedAccess: true
const arr = [1, 2, 3];
const x = arr[10]; // x: number | undefined (not number!)
console.log(x.toFixed(2));
//          ~ Error: 'x' is possibly 'undefined'.

// Record index access also becomes safe
const map: Record<string, number> = { a: 1 };
const v = map["missing"]; // v: number | undefined
```

It is the most disruptive non-strict flag (it touches every array access), so teams often adopt it deliberately. It eliminates a huge class of "cannot read property of undefined" crashes.

---

## Module Resolution at the Middle Level

`module` and `moduleResolution` are easy to confuse:

- `module` — the **output** module format (what `import` compiles to).
- `moduleResolution` — the **algorithm** TypeScript uses to *find* a module on disk.

| `moduleResolution` | Behavior | Use for |
|--------------------|----------|---------|
| `node` (a.k.a. `node10`) | Classic CommonJS resolution; ignores `exports` map | Legacy projects |
| `node16` / `nodenext` | Honors `package.json` `"exports"`, `"type"`, file extensions | Modern Node.js |
| `bundler` | Like `node16` but relaxed (no mandatory file extensions in imports) | Vite, esbuild, webpack |

```json
// Modern Node project
{ "compilerOptions": { "module": "NodeNext", "moduleResolution": "NodeNext" } }

// Bundled web app
{ "compilerOptions": { "module": "ESNext", "moduleResolution": "bundler" } }
```

Two helpers you will set often:

- `resolveJsonModule: true` — allows `import data from "./data.json"` with typed JSON.
- `esModuleInterop: true` — generates interop helpers so `import express from "express"` works on CommonJS packages, and implies `allowSyntheticDefaultImports`.

`baseUrl` and `paths` let you create import aliases:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"],
      "@utils/*": ["src/utils/*"]
    }
  }
}
```

```typescript
import { formatDate } from "@utils/date"; // resolves to src/utils/date
```

Note: `paths` only affects type resolution. At runtime your bundler or a loader must apply the same aliases, or the import will fail.

---

## Putting It Together

A pragmatic strict-plus config for a serious application:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": "./src",

    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,

    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,

    "sourceMap": true,
    "declaration": true
  },
  "include": ["src/**/*"]
}
```

---

## When and Why to Enable Each Flag

| Flag | Enable when | Why / what it prevents |
|------|-------------|------------------------|
| `noImplicitAny` | Always | Silent loss of type safety |
| `strictNullChecks` | Always | The #1 source of runtime crashes |
| `strictFunctionTypes` | Always | Unsafe callback assignments |
| `strictBindCallApply` | Always | Wrong args to bind/call/apply |
| `strictPropertyInitialization` | Class-heavy code | Reading uninitialized fields |
| `noImplicitThis` | Always | `this` footguns |
| `useUnknownInCatchVariables` | Always | Assuming caught value is an Error |
| `alwaysStrict` | Always | Strict-mode-only runtime bugs |
| `noUnusedLocals` / `Parameters` | Most projects | Dead code, typos |
| `noImplicitReturns` | Most projects | Forgotten return branches |
| `noFallthroughCasesInSwitch` | Most projects | Missing `break` |
| `exactOptionalPropertyTypes` | New code / careful teams | `undefined` vs absent confusion |
| `noUncheckedIndexedAccess` | New code / safety-critical | Out-of-bounds array access |

---

## Middle Checklist

- [ ] `strict: true` is on, and you can name every flag it enables.
- [ ] Extra flags (`noUnusedLocals`, `noImplicitReturns`, `noFallthroughCasesInSwitch`) are on.
- [ ] `noUncheckedIndexedAccess` is on for new safety-critical code (or there is a documented reason it is off).
- [ ] You handle `catch (e)` as `unknown` and narrow before use.
- [ ] You understand `module` (output format) vs `moduleResolution` (lookup algorithm).
- [ ] `paths` aliases are mirrored in the runtime/bundler config.

---

## Common Mistakes

### Mistake 1: Disabling strictNullChecks to "make errors go away"

```json
// Anti-pattern: silences the most valuable check
{ "compilerOptions": { "strict": true, "strictNullChecks": false } }
```

This re-introduces null bugs. Narrow your values instead.

### Mistake 2: Expecting `paths` to work at runtime without a loader

```typescript
import x from "@/foo"; // type-checks, but `node dist/index.js` cannot find "@/foo"
```

`paths` is compile-time only. Use a bundler, `tsconfig-paths`, or a `package.json` `imports` map for runtime.

### Mistake 3: Confusing the two `undefined`-related flags

`strictNullChecks` makes `undefined` a real type. `exactOptionalPropertyTypes` distinguishes *missing* from *explicitly undefined*. They are different; you generally want both.

---

## Test

### Multiple Choice

**1. Which flag makes `catch (e)` give `e: unknown`?**

- A) `strictNullChecks`
- B) `useUnknownInCatchVariables`
- C) `noImplicitAny`
- D) `noUncheckedIndexedAccess`

<details>
<summary>Answer</summary>
**B)** — `useUnknownInCatchVariables` (on by default under `strict` since 4.4) types caught values as `unknown`, forcing a narrowing check.
</details>

**2. `arr[10]` returns `number | undefined` because of which flag?**

- A) `strictNullChecks`
- B) `noImplicitReturns`
- C) `noUncheckedIndexedAccess`
- D) `exactOptionalPropertyTypes`

<details>
<summary>Answer</summary>
**C)** — `noUncheckedIndexedAccess` adds `| undefined` to indexed access results to reflect possible out-of-bounds reads.
</details>

### True or False

**3. `strict: true` enables `noUncheckedIndexedAccess`.**

<details>
<summary>Answer</summary>
**False** — `noUncheckedIndexedAccess` is **not** part of `strict`. You must enable it separately.
</details>

**4. You can set `strict: true` and then disable one sub-flag.**

<details>
<summary>Answer</summary>
**True** — e.g. `"strict": true, "strictPropertyInitialization": false`. Individual flags override the umbrella.
</details>

### What's the Output?

**5. With `exactOptionalPropertyTypes: true`, does this compile?**

```typescript
interface O { x?: number }
const o: O = { x: undefined };
```

<details>
<summary>Answer</summary>
No. Error: `{ x: undefined }` is not assignable because optional `x?: number` means *absent*, not *present-and-undefined*. You would need `x?: number | undefined`.
</details>

**6. With `noImplicitReturns: true`, what is wrong here?**

```typescript
function f(n: number): string {
  if (n > 0) return "pos";
}
```

<details>
<summary>Answer</summary>
"Not all code paths return a value." The `n <= 0` path falls off the end returning `undefined`, which is not `string`.
</details>

---

## Summary

- `strict: true` is an umbrella over eight flags; you can enable/disable each one individually.
- `strictNullChecks` is the highest-value flag — it eliminates the most common crash class.
- `useUnknownInCatchVariables`, `strictFunctionTypes`, `strictPropertyInitialization`, and friends each close a specific soundness hole.
- Beyond `strict`, enable `noUnusedLocals/Parameters`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, and ideally `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`.
- `module` is the output format; `moduleResolution` is the lookup algorithm — keep them consistent.
- `paths` aliases are compile-time only and need a runtime counterpart.

**Next step:** `senior.md` — recommended configs for new vs legacy projects, gradual hardening strategies, and performance flags.

---

## Further Reading

- [strict — TSConfig reference](https://www.typescriptlang.org/tsconfig#strict)
- [noUncheckedIndexedAccess](https://www.typescriptlang.org/tsconfig#noUncheckedIndexedAccess)
- [exactOptionalPropertyTypes](https://www.typescriptlang.org/tsconfig#exactOptionalPropertyTypes)
- [Module resolution handbook](https://www.typescriptlang.org/docs/handbook/modules/theory.html)
