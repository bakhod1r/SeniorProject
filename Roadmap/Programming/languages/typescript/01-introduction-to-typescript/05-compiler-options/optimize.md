# Compiler Options — Optimization Guide

> **10+ exercises that use compiler options to make builds faster or types safer.**
> Each entry states the problem, the option(s) to apply, before/after, and the expected impact.
> "Optimization" here means two things: shorter build/check times, and stronger type guarantees that prevent runtime bugs.

## Table of Contents

1. [Speed Optimizations](#speed-optimizations)
2. [Safety Optimizations](#safety-optimizations)
3. [Optimization Summary Table](#optimization-summary-table)

---

## Speed Optimizations

### Optimization 1: Skip Library Type-Checking

**Problem:** A cold `tsc` run spends most of its time re-checking thousands of `.d.ts` files in `node_modules`.

```bash
tsc --extendedDiagnostics
# Check time: 6.20 s   (much of it in node_modules .d.ts)
```

**Apply:**

```json
{ "compilerOptions": { "skipLibCheck": true } }
```

```bash
tsc --extendedDiagnostics
# Check time: 3.40 s
```

**Why it works:** `skipLibCheck` skips the internal consistency check of declaration files. Your code is still checked against those types; you only skip verifying the libraries against each other.

**Expected impact:** Often 30-50% off cold check time. The small risk is missing a conflict between two dependencies' type definitions.

---

### Optimization 2: Incremental Builds

**Problem:** CI and local rebuilds always do a full type-check even when one file changed.

**Apply:**

```json
{
  "compilerOptions": {
    "incremental": true,
    "tsBuildInfoFile": "./.cache/tsbuild.json"
  }
}
```

```bash
tsc          # cold: 5.1 s
tsc          # warm, no changes: 0.4 s
```

**Why it works:** `incremental` persists a `.tsbuildinfo` graph of file hashes and `.d.ts` signatures; only changed files (and dependents) are re-checked.

**Expected impact:** 10-20x faster warm rebuilds. Cache `.tsbuildinfo` in CI to carry the warm state between runs.

```yaml
# CI cache step (conceptual)
cache:
  key: tsbuildinfo-${{ hashFiles('src/**') }}
  paths: [".cache/tsbuild.json"]
```

---

### Optimization 3: Project References for a Monorepo

**Problem:** A 500-file monorepo full check takes 60s; one package's change re-checks everything.

**Apply:**

```json
// packages/core/tsconfig.json
{ "compilerOptions": { "composite": true, "declaration": true, "outDir": "dist" }, "include": ["src/**/*"] }
```

```json
// packages/api/tsconfig.json
{ "compilerOptions": { "composite": true, "outDir": "dist" }, "references": [{ "path": "../core" }], "include": ["src/**/*"] }
```

```bash
tsc --build              # builds in dependency order, incremental
tsc --build --verbose    # shows up-to-date vs rebuilt
```

**Why it works:** Downstream packages type-check against upstream `.d.ts` files, not source. Only changed packages and their dependents rebuild.

**Expected impact:** Full check 60s → ~15s; single-package change rebuilds only that package + dependents.

---

### Optimization 4: Let the Bundler Emit; `tsc` Only Checks

**Problem:** Running `tsc` for emit *and* a bundler duplicates work and slows the dev loop.

**Apply:**

```json
{ "compilerOptions": { "noEmit": true, "isolatedModules": true, "verbatimModuleSyntax": true } }
```

```bash
# emit handled by esbuild/SWC (fast, no type info)
esbuild src/index.ts --bundle --outfile=dist/index.js
# tsc only verifies types in parallel
tsc --noEmit
```

**Why it works:** esbuild/SWC transpile far faster than `tsc` emits; `tsc --noEmit` does only the check. `isolatedModules` + `verbatimModuleSyntax` keep the two in agreement.

**Expected impact:** Build/emit time drops to milliseconds; type-check runs independently (and can be parallelized in CI).

---

### Optimization 5: Raise `target` to Avoid Downlevel Bloat

**Problem:** `target: "ES5"` makes the emitter inject `__awaiter`, `__generator`, `WeakMap` private-field shims, and string concatenation everywhere — larger, slower output and longer emit.

**Apply (when the runtime allows):**

```json
{ "compilerOptions": { "target": "ES2022" } }
```

**Why it works:** Modern targets emit native `async/await`, private fields, and template strings, skipping the lowering transforms entirely.

**Expected impact:** Smaller bundles and faster emit. If you must support old runtimes, pair `importHelpers: true` + `tslib` to at least de-duplicate the helpers.

---

### Optimization 6: Share Downlevel Helpers with `importHelpers`

**Problem:** You must target an older ES version; each file inlines its own copy of `__awaiter`, `__spreadArray`, etc., bloating total output.

**Apply:**

```json
{ "compilerOptions": { "target": "ES2017", "importHelpers": true } }
```

```bash
npm install tslib
```

**Why it works:** Helpers are imported from the single `tslib` package instead of duplicated per file.

**Expected impact:** Noticeably smaller total emitted size in projects with many downleveled files; one shared, well-tested helper implementation.

---

### Optimization 7: Profile and Simplify Expensive Generics

**Problem:** Check time is dominated by a few deeply recursive generic types.

**Diagnose:**

```bash
tsc --generateTrace ./trace
npx @typescript/analyze-trace ./trace   # lists hottest type instantiations
```

**Apply:** Replace unbounded recursion with depth-limited or flatter types, and name large instantiations so the checker caches them.

```typescript
// SLOW: unbounded recursive mapped type on a large schema
type DeepPartial<T> = { [K in keyof T]?: DeepPartial<T[K]> };

// FASTER: cap depth so the checker stops instantiating
type DeepPartial<T, D extends number = 4> =
  [D] extends [0] ? T :
  T extends object ? { [K in keyof T]?: DeepPartial<T[K], Prev<D>> } : T;
```

**Why it works:** Recursive generic instantiations are the top hot-spot in large codebases; bounding them removes thousands of instantiations.

**Expected impact:** Can cut a multi-second check by seconds on schema-heavy code.

---

## Safety Optimizations

### Optimization 8: Eliminate Null Crashes with the Strict Family

**Problem:** Production crashes are dominated by `Cannot read properties of undefined`.

**Apply:**

```json
{ "compilerOptions": { "strict": true } }
```

```typescript
// Before (no strict): compiles, crashes
function name(u: { nickname?: string }) { return u.nickname.toUpperCase(); }

// After (strict): compile error forces a guard
function name(u: { nickname?: string }) {
  return u.nickname ? u.nickname.toUpperCase() : "(none)";
}
```

**Why it works:** `strictNullChecks` makes `undefined` a real type that must be narrowed before member access.

**Expected impact:** Removes the single largest class of runtime crashes at compile time.

---

### Optimization 9: Catch Out-of-Bounds Access

**Problem:** Array/index access crashes when the index is missing, even with `strict`.

**Apply:**

```json
{ "compilerOptions": { "strict": true, "noUncheckedIndexedAccess": true } }
```

```typescript
const config: Record<string, string> = loadConfig();
const url = config["DATABASE_URL"]; // now string | undefined
if (!url) throw new Error("DATABASE_URL is not set");
connect(url); // narrowed to string
```

**Why it works:** Index access yields `T | undefined`, forcing you to handle the missing case.

**Expected impact:** Eliminates "undefined is not a function" from array/record access; surfaces missing config keys at the boundary.

---

### Optimization 10: Distinguish Absent from `undefined`

**Problem:** Code branches on `"key" in obj`, but `{ key: undefined }` silently passes the check and breaks the branch.

**Apply:**

```json
{ "compilerOptions": { "strict": true, "exactOptionalPropertyTypes": true } }
```

```typescript
interface Update { title?: string }
// Before: { title: undefined } accepted; the "in" check lies
// After: { title: undefined } is a compile error — callers must omit the key
const u: Update = {}; // or { title: "New" }
```

**Why it works:** Optional now means *may be absent*, not *may be undefined*, matching the runtime distinction the code relies on.

**Expected impact:** Removes a subtle class of "present-but-undefined" bugs in patch/merge logic.

---

### Optimization 11: Make Caught Errors Honest

**Problem:** Handlers assume every thrown value is an `Error` and crash on non-Error throws.

**Apply:**

```json
{ "compilerOptions": { "strict": true } }  // enables useUnknownInCatchVariables
```

```typescript
try { risky(); }
catch (e) {
  // e: unknown — compiler forces narrowing
  const message = e instanceof Error ? e.message : String(e);
  log(message);
}
```

**Why it works:** `useUnknownInCatchVariables` types `e` as `unknown`, preventing unguarded `.message` access.

**Expected impact:** No more crashes when a string/object/number is thrown.

---

### Optimization 12: Prevent Accidental Method Shadowing

**Problem:** A subclass method that was meant to override a base method silently does not (typo or signature drift), or vice versa.

**Apply:**

```json
{ "compilerOptions": { "strict": true, "noImplicitOverride": true } }
```

```typescript
class Base { handle() {} }
class Child extends Base {
  override handle() {}      // required keyword
  hanlde() {}               // Error if intended as override: missing 'override'
}
```

**Why it works:** `noImplicitOverride` requires the `override` keyword, so a renamed/removed base method turns silent shadowing into a compile error.

**Expected impact:** Catches override drift during refactors of class hierarchies.

---

### Optimization 13: Force Explicit Dynamic Access

**Problem:** `obj.someDynamicKey` reads cleanly but bypasses the index signature's intent, hiding typos in known keys.

**Apply:**

```json
{ "compilerOptions": { "strict": true, "noPropertyAccessFromIndexSignature": true } }
```

```typescript
interface Env { readonly [k: string]: string; NODE_ENV: string }
declare const env: Env;

env.NODE_ENV;       // OK — declared key, dot access
env.DATABASE_URL;   // Error — index-signature key must use env["DATABASE_URL"]
```

**Why it works:** Declared properties use dot access; index-signature keys must use brackets, making "is this a known key or a dynamic one?" explicit.

**Expected impact:** Catches typos in declared keys and documents which accesses are dynamic.

---

## Optimization Summary Table

| # | Technique | Type | Effort | Impact | Key metric |
|---|-----------|------|--------|--------|-----------|
| 1 | `skipLibCheck: true` | Speed | Very low | High | Cold check time |
| 2 | `incremental: true` (+cache) | Speed | Low | Very high | Warm rebuild time |
| 3 | Project references + `composite` | Speed | Medium | Very high | Monorepo check time |
| 4 | `noEmit` + bundler emit | Speed | Low | High | Emit time |
| 5 | Raise `target` | Speed | Low | Medium | Bundle size, emit time |
| 6 | `importHelpers` + `tslib` | Speed | Low | Medium | Total emitted size |
| 7 | Simplify recursive generics | Speed | Medium | High | Check time per file |
| 8 | `strict` | Safety | Low | Very high | Null crashes |
| 9 | `noUncheckedIndexedAccess` | Safety | Medium | High | Out-of-bounds crashes |
| 10 | `exactOptionalPropertyTypes` | Safety | Medium | Medium | Absent/undefined bugs |
| 11 | `useUnknownInCatchVariables` | Safety | Low | Medium | Non-Error throw crashes |
| 12 | `noImplicitOverride` | Safety | Low | Medium | Override drift |
| 13 | `noPropertyAccessFromIndexSignature` | Safety | Low | Low-Medium | Key typos |

### Diagnostic Commands Cheat Sheet

```bash
tsc --extendedDiagnostics                  # phase timings + memory
tsc --generateTrace ./trace                # type instantiation trace
npx @typescript/analyze-trace ./trace      # hottest instantiations
tsc --build --verbose                      # project reference build graph
tsc --noEmit                               # type-check only
```

### Rule of Thumb

- **Speed wins** are mostly free: `skipLibCheck` + `incremental` first, then references for monorepos, then offload emit to a bundler.
- **Safety wins** compound: `strict` is the base; layer `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` on new code, and add the explicitness flags (`noImplicitOverride`, `noPropertyAccessFromIndexSignature`) to harden refactors.
- Always measure with `--extendedDiagnostics` before and after — never trust intuition about build speed.

---

## More Speed Optimizations

### Optimization 14: Faster `.d.ts` Emit with `isolatedDeclarations`

**Problem:** Generating declaration files for a large library is slow because `.d.ts` emit relies on whole-program type inference.

**Apply (TypeScript 5.5+):**

```json
{ "compilerOptions": { "declaration": true, "isolatedDeclarations": true } }
```

This forces every exported symbol to have an explicit, locally-determinable type. With that guarantee, external tools (and parallel workers) can emit `.d.ts` per file without the full type-checker.

```typescript
// isolatedDeclarations requires this annotation:
export function make(): { id: string; at: Date } {
  return { id: crypto.randomUUID(), at: new Date() };
}
```

**Why it works:** Removing the need for cross-file inference makes declaration emit embarrassingly parallel and far faster.

**Expected impact:** Large libraries can parallelize `.d.ts` generation; the up-front cost is adding return-type annotations to public APIs.

---

### Optimization 15: Trim the Program with `include`/`exclude` and `types`

**Problem:** `tsc` is checking test files, generated code, or pulling in every `@types/*` package globally.

**Apply:**

```json
{
  "compilerOptions": {
    "types": ["node"]
  },
  "include": ["src/**/*"],
  "exclude": ["**/*.test.ts", "dist", "generated"]
}
```

**Why it works:** `types: ["node"]` stops the automatic inclusion of *all* `@types/*` packages in `node_modules/@types` — only the listed ones load. Narrowing `include`/`exclude` shrinks the program TypeScript must check.

**Expected impact:** Fewer files and ambient declarations to process; meaningful when many unused `@types` packages are installed.

---

### Optimization 16: Avoid Re-emitting When Only Types Changed

**Problem:** A CI step runs `tsc` to emit and a separate step to check, doubling the work.

**Apply:** Emit once and reuse; or split responsibilities cleanly.

```bash
# Single source of truth for emit
tsc --build              # emits with incremental cache
# Type-only verification reuses the same .tsbuildinfo — fast
```

**Why it works:** `--build` mode shares the incremental cache between emit and subsequent checks, avoiding a second full pass.

**Expected impact:** Eliminates a redundant full compilation in CI pipelines that previously checked and built separately.

---

## More Safety Optimizations

### Optimization 17: Ban Unreachable and Unused Labels

**Problem:** Dead code (unreachable branches, stray labels) hides logic errors.

**Apply:**

```json
{ "compilerOptions": { "allowUnreachableCode": false, "allowUnusedLabels": false } }
```

```typescript
function f(x: number): string {
  return "done";
  console.log(x); // Error: Unreachable code detected.
}
```

**Why it works:** The checker reports code after a guaranteed `return`/`throw` and labels that are never used — both usually signal a mistake.

**Expected impact:** Catches logic errors left behind by refactors; cheap and noise-free in practice.

---

### Optimization 18: Force `override` to Survive Refactors

**Problem:** Renaming a base-class method silently turns subclass overrides into new, never-called methods.

**Apply:**

```json
{ "compilerOptions": { "strict": true, "noImplicitOverride": true } }
```

When the base method is renamed, every `override`-marked subclass method that no longer matches becomes a compile error, so the refactor cannot ship half-done.

**Expected impact:** Removes a class of "the override stopped running" bugs in inheritance-heavy code.

---

### Optimization 19: Lock Down `any` from Untyped Imports

**Problem:** Importing an untyped JS module silently injects `any` throughout the call chain.

**Apply:**

```json
{ "compilerOptions": { "strict": true, "noImplicitAny": true } }
```

```typescript
import legacy from "./legacy.js"; // if no types, usage of `legacy` surfaces implicit-any errors
```

Combine with a hand-written `legacy.d.ts` to type the module instead of letting `any` leak.

**Expected impact:** Stops silent `any` propagation from the JS/TS boundary, the most common way strictness is unknowingly defeated.

---

### Optimization 20: Verify the Whole Tree, Including JS

**Problem:** A mixed JS/TS codebase only checks the `.ts` half.

**Apply:**

```json
{ "compilerOptions": { "allowJs": true, "checkJs": true, "strict": true } }
```

JSDoc annotations in `.js` files are then type-checked too:

```javascript
/** @param {number} n */
function square(n) { return n * n; }
square("x"); // Error under checkJs
```

**Why it works:** `checkJs` extends type-checking to JavaScript files using JSDoc, catching bugs in the un-migrated portion of the codebase.

**Expected impact:** Surfaces real bugs in `.js` files during migration without converting them to `.ts` first.

---

## Extended Summary Table

| # | Technique | Type | Effort | Impact | Key metric |
|---|-----------|------|--------|--------|-----------|
| 14 | `isolatedDeclarations` | Speed | Medium | Medium-High | `.d.ts` emit time |
| 15 | `types` + tight `include` | Speed | Low | Medium | Program size |
| 16 | `--build` shared cache | Speed | Low | Medium | CI total time |
| 17 | `allowUnreachableCode: false` | Safety | Very low | Low-Medium | Dead-code bugs |
| 18 | `noImplicitOverride` | Safety | Low | Medium | Override drift |
| 19 | `noImplicitAny` | Safety | Low | High | `any` leakage |
| 20 | `checkJs` | Safety | Medium | High | Bugs in JS files |
