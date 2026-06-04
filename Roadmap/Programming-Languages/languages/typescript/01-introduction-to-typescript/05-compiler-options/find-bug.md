# Compiler Options — Find the Bug

> **Practice finding and fixing bugs caused by a wrong or missing compiler option.**
> Each exercise ships code that compiles or runs incorrectly because of a `compilerOptions` setting.
> Your job: identify the missing/wrong flag, explain why it causes the bug, and fix the config (or code).

---

## How to Use

1. Read the code and the config.
2. Find the flag-related bug **without** the hint.
3. Decide whether the right fix is a config change, a code change, or both.
4. Understand **why** the option changes the outcome.

### Difficulty Levels

| Level | Description |
|:-----:|:-----------|
| 🟢 | **Easy** — a common everyday flag is missing |
| 🟡 | **Medium** — a strict-family or interop flag is involved |
| 🔴 | **Hard** — emit semantics, bundler interop, or build-graph subtleties |

---

## Bug 1: Null Slips Through 🟢

**What it should do:** Reject a `null` argument where a `string` is required.

```typescript
// tsconfig: { "compilerOptions": { "target": "ES2022" } }

function slug(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, "-");
}

slug(null); // compiles! crashes at runtime: Cannot read properties of null
```

<details>
<summary>💡 Hint</summary>

The code compiles even though `null` is clearly wrong. Which flag makes `null`/`undefined` non-assignable to other types?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** `strictNullChecks` is off (the config has no `strict`), so `null` is assignable to `string`.
**Why:** Without `strictNullChecks`, `null` and `undefined` are members of every type's domain. The compiler sees nothing wrong with `slug(null)`, and the bug surfaces only at runtime.

</details>

<details>
<summary>✅ Fix</summary>

```json
{ "compilerOptions": { "target": "ES2022", "strict": true } }
```

Now `slug(null)` is a compile error: `Argument of type 'null' is not assignable to parameter of type 'string'`.

</details>

---

## Bug 2: `document` Is Undefined in the Browser Build 🟢

**What it should do:** Use the DOM in a front-end file.

```typescript
// tsconfig: { "compilerOptions": { "target": "ES2022", "lib": ["ES2022"] } }

const app = document.getElementById("app");
//          ~~~~~~~~ Error: Cannot find name 'document'.
```

<details>
<summary>💡 Hint</summary>

`lib` is set explicitly. What does an explicit `lib` do to the default DOM types?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** `lib` is set to `["ES2022"]` only, which **replaces** the default and removes the DOM types.
**Why:** Setting `lib` manually is not additive. By listing only `ES2022`, you opt out of `DOM`, so `document`, `window`, and `fetch` disappear.

</details>

<details>
<summary>✅ Fix</summary>

```json
{ "compilerOptions": { "target": "ES2022", "lib": ["ES2022", "DOM", "DOM.Iterable"] } }
```

</details>

---

## Bug 3: Output Lands Next to Source 🟢

**What it should do:** Put compiled JS in `dist/`, keeping `src/` clean.

```json
// tsconfig.json
{
  "compilerOptions": { "target": "ES2022", "strict": true },
  "include": ["src/**/*"]
}
```

After `tsc`, every `src/foo.ts` produced a `src/foo.js` next to it. The `dist/` folder is empty.

<details>
<summary>💡 Hint</summary>

Two emit options control *where* output goes and what folder structure it mirrors.

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** No `outDir`/`rootDir`, so `tsc` writes each `.js` next to its source.
**Why:** Without `outDir`, the emitter defaults to emitting beside the input file.

</details>

<details>
<summary>✅ Fix</summary>

```json
{
  "compilerOptions": {
    "target": "ES2022", "strict": true,
    "rootDir": "./src", "outDir": "./dist"
  },
  "include": ["src/**/*"]
}
```

</details>

---

## Bug 4: `Cannot use import statement outside a module` 🟡

**What it should do:** Run a compiled Node app.

```json
// tsconfig.json
{ "compilerOptions": { "target": "ES2022", "module": "ESNext", "strict": true, "outDir": "dist" } }
```

```jsonc
// package.json — note: no "type" field (defaults to commonjs)
{ "name": "app", "main": "dist/index.js" }
```

```bash
node dist/index.js
# SyntaxError: Cannot use import statement outside a module
```

<details>
<summary>💡 Hint</summary>

The emit format and how Node interprets the file disagree. Which `module` value lets TypeScript decide CJS/ESM from `package.json`?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** `module: "ESNext"` emits native `import`, but `package.json` has no `"type": "module"`, so Node treats `.js` as CommonJS and rejects the `import`.
**Why:** `module` forces ESM emit regardless of the runtime. The two must agree.

</details>

<details>
<summary>✅ Fix</summary>

Use `NodeNext`, which decides per file from `package.json`:

```json
{ "compilerOptions": { "target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext", "strict": true, "outDir": "dist" } }
```

Alternative: keep `ESNext` and add `"type": "module"` to `package.json`.

</details>

---

## Bug 5: Default Import of a CommonJS Package Is Not a Function 🟡

**What it should do:** Import and call `express`.

```json
// tsconfig: { "compilerOptions": { "module": "CommonJS", "strict": true } }
```

```typescript
import express from "express";
const app = express(); // Runtime: express is not a function (or a type error)
```

<details>
<summary>💡 Hint</summary>

CommonJS packages have no real default export. Which flag injects the interop helper so `import x from "cjs"` works?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** `esModuleInterop` is off, so the default import binds to the whole namespace object instead of the exported function.
**Why:** Without `esModuleInterop`, TypeScript does not emit the `__importDefault` helper, and `express.default` is undefined; calling `express()` fails or the type-check rejects the default import.

</details>

<details>
<summary>✅ Fix</summary>

```json
{ "compilerOptions": { "module": "CommonJS", "strict": true, "esModuleInterop": true } }
```

`esModuleInterop` injects `__importDefault` and implies `allowSyntheticDefaultImports`.

</details>

---

## Bug 6: Array Access Crashes Despite "Type Safety" 🟡

**What it should do:** Safely read the first matching item.

```typescript
// tsconfig: { "compilerOptions": { "strict": true } }

function firstEven(nums: number[]): number {
  const evens = nums.filter((n) => n % 2 === 0);
  return evens[0].valueOf(); // crashes when there are no evens
}

firstEven([1, 3, 5]); // TypeError: Cannot read properties of undefined
```

<details>
<summary>💡 Hint</summary>

`strict` is on, yet `evens[0]` is typed `number`, not `number | undefined`. Which flag fixes indexed access?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** `noUncheckedIndexedAccess` is off (it is **not** part of `strict`), so `evens[0]` is `number` even when the array may be empty.
**Why:** By default, indexed access assumes the index is in bounds. The flag makes it `number | undefined`, forcing a guard.

</details>

<details>
<summary>✅ Fix</summary>

```json
{ "compilerOptions": { "strict": true, "noUncheckedIndexedAccess": true } }
```

```typescript
function firstEven(nums: number[]): number | undefined {
  const evens = nums.filter((n) => n % 2 === 0);
  const head = evens[0];
  return head?.valueOf();
}
```

</details>

---

## Bug 7: `catch` Assumes Every Throw Is an Error 🟡

**What it should do:** Log a caught error's message safely.

```typescript
// tsconfig: { "compilerOptions": { "strictNullChecks": true } } // note: not full strict

function run() {
  try {
    risky();
  } catch (e) {
    console.log(e.message.toUpperCase()); // e is 'any' here — unsafe
  }
}
```

If `risky()` throws a string, `e.message` is `undefined` and this crashes.

<details>
<summary>💡 Hint</summary>

The config enables `strictNullChecks` but not the flag that types caught values as `unknown`.

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** `useUnknownInCatchVariables` is off (only `strictNullChecks` is set, not full `strict`), so `e` is `any` and unchecked access is allowed.
**Why:** A throw can be any value. With `useUnknownInCatchVariables`, `e` is `unknown` and must be narrowed before use.

</details>

<details>
<summary>✅ Fix</summary>

```json
{ "compilerOptions": { "strict": true } }
```

```typescript
catch (e) {
  if (e instanceof Error) console.log(e.message.toUpperCase());
  else console.log("Non-error thrown:", e);
}
```

</details>

---

## Bug 8: `{ x: undefined }` Sneaks Past an Optional Field 🟡

**What it should do:** Treat a missing field differently from an explicit `undefined` (the code uses `"x" in obj`).

```typescript
// tsconfig: { "compilerOptions": { "strict": true } }

interface Patch { name?: string }

function apply(patch: Patch) {
  if ("name" in patch) {
    setName(patch.name!); // assumes presence means a real value
  }
}

apply({ name: undefined }); // "name" in patch is true, but value is undefined → bug
```

<details>
<summary>💡 Hint</summary>

`strict` does not stop `{ name: undefined }` from satisfying `name?: string`. Which flag distinguishes *absent* from *present-but-undefined*?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** `exactOptionalPropertyTypes` is off, so `{ name: undefined }` is assignable to `{ name?: string }`. The `"name" in patch` check passes, but the value is `undefined`.
**Why:** Without the flag, optional means "may be undefined", which collapses the absent/explicit-undefined distinction the code relies on.

</details>

<details>
<summary>✅ Fix</summary>

```json
{ "compilerOptions": { "strict": true, "exactOptionalPropertyTypes": true } }
```

Now `apply({ name: undefined })` is a compile error, forcing callers to omit the key (or the type to widen to `name?: string | undefined`).

</details>

---

## Bug 9: `const enum` Breaks Under esbuild 🔴

**What it should do:** Build with esbuild for production; type-check with `tsc`.

```typescript
// colors.ts
export const enum Color { Red, Green, Blue }

// usage.ts
import { Color } from "./colors";
console.log(Color.Green); // tsc inlines to 1; esbuild emits a runtime reference that is undefined
```

```json
// tsconfig: { "compilerOptions": { "strict": true, "noEmit": true } }
```

The `tsc` check is green, but the esbuild bundle throws because `Color` has no runtime value.

<details>
<summary>💡 Hint</summary>

Single-file transpilers cannot inline `const enum` across files. Which flag makes `tsc` reject constructs that bundlers cannot handle?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** `isolatedModules` is off, so `tsc` allows `const enum`, which esbuild cannot inline (it sees one file at a time). The bundle references a `Color` object that was never emitted.
**Why:** `const enum` relies on whole-program inlining. With `isolatedModules: true`, `tsc` errors on `const enum`, surfacing the incompatibility at type-check time.

</details>

<details>
<summary>✅ Fix</summary>

```json
{ "compilerOptions": { "strict": true, "noEmit": true, "isolatedModules": true } }
```

Then replace `const enum Color` with a regular `enum` (or a `const` object map), which has a real runtime value.

</details>

---

## Bug 10: Type-Only Re-export Drops a Value at Runtime 🔴

**What it should do:** Re-export both a type and a function from a barrel file, compiled by a bundler.

```typescript
// index.ts
export { User, createUser } from "./user";
//        ^type   ^value
```

```json
// tsconfig: { "compilerOptions": { "module": "ESNext", "moduleResolution": "bundler", "strict": true, "noEmit": true } }
```

`tsc` is green, but the bundler emits an import for `User` (a type), causing a runtime "User is not exported" error — or, with type-directed elision off, the wrong thing is kept.

<details>
<summary>💡 Hint</summary>

The bundler cannot tell `User` is a type. Which flag makes import/export emit purely syntactic, and which flag forces you to mark type-only re-exports?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** `verbatimModuleSyntax` (and/or `isolatedModules`) is off, so the type/value split is decided by type information the bundler does not have. The bundler may keep a runtime import for the type-only `User`.
**Why:** Without `verbatimModuleSyntax`, emit depends on type-directed elision, which single-file transpilers cannot replicate. The flag makes the rule syntactic and requires `export type` for type-only re-exports.

</details>

<details>
<summary>✅ Fix</summary>

```json
{
  "compilerOptions": {
    "module": "ESNext", "moduleResolution": "bundler",
    "strict": true, "noEmit": true,
    "isolatedModules": true, "verbatimModuleSyntax": true
  }
}
```

```typescript
export type { User } from "./user";
export { createUser } from "./user";
```

</details>

---

## Bug 11: `Set` Iteration Returns Nothing on ES5 🔴

**What it should do:** Iterate a `Set` while targeting ES5.

```typescript
// tsconfig: { "compilerOptions": { "target": "ES5", "lib": ["ES2015", "DOM"] } }

const ids = new Set([10, 20, 30]);
for (const id of ids) {
  console.log(id); // on the emitted ES5 code, behaves incorrectly
}
```

<details>
<summary>💡 Hint</summary>

At `target: ES5`, `for...of` assumes array-like indexing unless a flag enables the full iterator protocol.

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** `downlevelIteration` is off. At ES5, `for...of` over a non-array iterable (like `Set`) is emitted with index-based access, which does not iterate a `Set` correctly.
**Why:** ES5 has no iterator protocol. `downlevelIteration` emits the `__values`/`__read` helpers that call `Symbol.iterator`, making `Set`/`Map`/custom iterators work.

</details>

<details>
<summary>✅ Fix</summary>

```json
{ "compilerOptions": { "target": "ES5", "lib": ["ES2015", "DOM"], "downlevelIteration": true } }
```

(Better still: raise `target` to `ES2015`+ if your runtime allows, which makes the flag unnecessary.)

</details>

---

## Bug 12: DI Framework Gets `undefined` Parameter Types 🔴

**What it should do:** Let NestJS/TypeORM read constructor parameter types for injection.

```typescript
// tsconfig: { "compilerOptions": { "experimentalDecorators": true, "strict": true } }

@Injectable()
class UserService {
  constructor(private readonly repo: UserRepository) {}
}
// At runtime the framework cannot resolve `repo` — its design type is missing.
```

<details>
<summary>💡 Hint</summary>

`experimentalDecorators` is on, but the framework needs *runtime type metadata*. Which companion flag emits `design:paramtypes`?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** `emitDecoratorMetadata` is off, so no `Reflect.metadata("design:paramtypes", [UserRepository])` is emitted. The DI container cannot learn the constructor parameter's type.
**Why:** Decorator metadata (the `design:*` reflection data) is only emitted when `emitDecoratorMetadata` is on (and requires `experimentalDecorators` plus a `reflect-metadata` polyfill at runtime).

</details>

<details>
<summary>✅ Fix</summary>

```json
{ "compilerOptions": { "experimentalDecorators": true, "emitDecoratorMetadata": true, "strict": true } }
```

And ensure `import "reflect-metadata";` runs before any decorated class is loaded.

</details>

---

## Bug 13: Class Field Shadows a Base Setter 🔴

**What it should do:** Let a base-class setter run when the subclass declares the same property.

```typescript
// tsconfig: { "compilerOptions": { "target": "ES2022", "strict": true } }

class Base {
  private _name = "";
  set name(v: string) { this._name = v.trim(); }
  get name() { return this._name; }
}

class Derived extends Base {
  name = "  Ada  "; // expected: setter trims to "Ada"
}

console.log(new Derived().name); // logs "  Ada  " — setter never ran
```

<details>
<summary>💡 Hint</summary>

At `target: ES2022`, class fields use `[[Define]]` semantics by default. Which flag controls that?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** `useDefineForClassFields` defaults to `true` for `target ≥ ES2022`, so the `name` field in `Derived` is installed with `Object.defineProperty` (`[[Define]]`), **shadowing** the base setter instead of invoking it.
**Why:** `[[Define]]` creates an own data property, bypassing the prototype accessor. The legacy `[[Set]]` behavior would have invoked the setter.

</details>

<details>
<summary>✅ Fix</summary>

If you need the setter to run, opt out of the standard semantics for this pattern:

```json
{ "compilerOptions": { "target": "ES2022", "strict": true, "useDefineForClassFields": false } }
```

Or, keeping the standard semantics, set the value in the constructor (`constructor() { super(); this.name = "  Ada  "; }`) or mark the field `declare`.

</details>

---

## Score Card

| Bug | Difficulty | Found without hint? | Understood why? | Fixed correctly? |
|:---:|:---------:|:-------------------:|:---------------:|:----------------:|
| 1 | 🟢 | ☐ | ☐ | ☐ |
| 2 | 🟢 | ☐ | ☐ | ☐ |
| 3 | 🟢 | ☐ | ☐ | ☐ |
| 4 | 🟡 | ☐ | ☐ | ☐ |
| 5 | 🟡 | ☐ | ☐ | ☐ |
| 6 | 🟡 | ☐ | ☐ | ☐ |
| 7 | 🟡 | ☐ | ☐ | ☐ |
| 8 | 🟡 | ☐ | ☐ | ☐ |
| 9 | 🔴 | ☐ | ☐ | ☐ |
| 10 | 🔴 | ☐ | ☐ | ☐ |
| 11 | 🔴 | ☐ | ☐ | ☐ |
| 12 | 🔴 | ☐ | ☐ | ☐ |
| 13 | 🔴 | ☐ | ☐ | ☐ |

### Rating
- **13/13 without hints** — You can diagnose compiler-option bugs from symptoms alone.
- **9-12** — Strong senior grasp of strictness and interop flags.
- **5-8** — Solid middle; review the strict family and bundler interop flags.
- **< 5** — Re-read `middle.md` and `professional.md`.

### Flag-to-Bug Map
| Bug | Culprit flag |
|:----|:-------------|
| 1 | missing `strict` (`strictNullChecks`) |
| 2 | `lib` replaces default |
| 3 | missing `outDir`/`rootDir` |
| 4 | `module` vs runtime mismatch |
| 5 | missing `esModuleInterop` |
| 6 | missing `noUncheckedIndexedAccess` |
| 7 | missing `useUnknownInCatchVariables` |
| 8 | missing `exactOptionalPropertyTypes` |
| 9 | missing `isolatedModules` |
| 10 | missing `verbatimModuleSyntax` |
| 11 | missing `downlevelIteration` |
| 12 | missing `emitDecoratorMetadata` |
| 13 | `useDefineForClassFields` semantics |
