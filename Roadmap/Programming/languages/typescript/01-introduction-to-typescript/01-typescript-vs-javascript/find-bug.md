# TypeScript vs JavaScript — Find the Bug

> **Practice finding and fixing bugs that come from confusing TypeScript with JavaScript.**
> Every bug here stems from a TS↔JS misunderstanding: assuming types exist at runtime, `any` defeating checks, structural-typing surprises, or transpilation gotchas.
> Your job: identify the bug **without** the hint, predict expected vs actual behavior, then read the solution and the *why*.

---

## How to Use

1. Read the **intent** and the **buggy code**.
2. Predict **expected vs actual** before peeking.
3. Open the hint only if stuck.
4. Read the **solution** and, most importantly, the **why** — the conceptual lesson is the point.

### Difficulty Levels

| Level | Description |
|:-----:|:-----------|
| 🟢 | **Easy** — a direct, common TS-vs-JS misconception |
| 🟡 | **Medium** — `any`, narrowing, or structural surprises |
| 🔴 | **Hard** — erasure, transpilation, or soundness subtleties |

---

## Bug 1: `instanceof` on an Interface 🟢

**Intent:** Branch on whether a value is a `Dog`.

```typescript
interface Dog { bark(): void; }

function handle(animal: unknown) {
  if (animal instanceof Dog) { // ❌
    animal.bark();
  }
}
```

**Expected vs Actual:** You expect a runtime check that the value is a `Dog`. Actual: compile error — `'Dog' only refers to a type, but is being used as a value here.`

<details>
<summary>💡 Hint</summary>

`instanceof` needs a runtime constructor. Does an interface exist at runtime?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** Interfaces are **erased** — they have no runtime value, so `instanceof` has nothing to test against.
**Why:** TypeScript types disappear during compilation. `instanceof` only works with a real class/constructor function.

</details>

<details>
<summary>✅ Solution</summary>

Use a structural check (or a `class`):

```typescript
interface Dog { bark(): void; }

function isDog(x: unknown): x is Dog {
  return typeof x === "object" && x !== null && typeof (x as any).bark === "function";
}

function handle(animal: unknown) {
  if (isDog(animal)) animal.bark();
}
```

**Lesson:** To check a *type* at runtime, you must check its *structure* with real JavaScript, because the type itself is gone.

</details>

---

## Bug 2: Iterating a Type 🟢

**Intent:** Loop over all color names.

```typescript
type Color = "red" | "green" | "blue";

for (const c of Color) { // ❌
  console.log(c);
}
```

**Expected vs Actual:** You expect to print three colors. Actual: `'Color' only refers to a type, but is being used as a value here.`

<details>
<summary>💡 Hint</summary>

A `type` is compile-time only. What runtime value can you actually iterate?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** A union type is not a runtime collection — it's erased. There is nothing to iterate.
**Why:** Types describe values; they aren't values themselves.

</details>

<details>
<summary>✅ Solution</summary>

Keep the runtime data and derive the type from it:

```typescript
const COLORS = ["red", "green", "blue"] as const;
type Color = (typeof COLORS)[number]; // "red" | "green" | "blue"

for (const c of COLORS) console.log(c);
```

**Lesson:** When you need both a type and a runtime list, define the **value** first (`as const`) and derive the **type** from it.

</details>

---

## Bug 3: `any` Hides a Real Crash 🟡

**Intent:** Read a nested field from a response.

```typescript
function getCity(response: any): string {
  return response.data.address.city; // compiles, crashes at runtime
}

getCity({ data: {} }); // 💥 Cannot read properties of undefined (reading 'city')
```

**Expected vs Actual:** You expect the compiler to warn that `address` might be missing. Actual: no compile error at all; it throws at runtime.

<details>
<summary>💡 Hint</summary>

What does `any` do to the compiler's checks on every property access?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** `any` disables all type checking on the value, so the unsafe chain `data.address.city` is accepted.
**Why:** `any` is an opt-out. Every access on an `any` value is allowed and stays `any`, so the type checker provides no protection.

</details>

<details>
<summary>✅ Solution</summary>

```typescript
interface Response {
  data?: { address?: { city?: string } };
}

function getCity(response: Response): string {
  return response.data?.address?.city ?? "unknown";
}
```

**Lesson:** Type the value properly (or as `unknown` and narrow). `any` doesn't fix bugs — it hides them until runtime.

</details>

---

## Bug 4: Asserting Trust Over Validation 🟡

**Intent:** Parse a JSON request body into a typed object.

```typescript
interface LoginBody { username: string; password: string; }

function login(raw: string) {
  const body = JSON.parse(raw) as LoginBody;
  authenticate(body.username, body.password); // password may be undefined!
}

declare function authenticate(u: string, p: string): void;
```

**Expected vs Actual:** You expect `as LoginBody` to guarantee the fields exist. Actual: if `raw` is `'{"username":"x"}'`, `body.password` is `undefined` at runtime with no error.

<details>
<summary>💡 Hint</summary>

`as` is erased. Does it run any check on the actual data?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** `as LoginBody` is a compile-time assertion that performs **no runtime validation**. The real data can be any shape.
**Why:** Type assertions are erased like all type syntax. TypeScript trusts you; it does not verify external data.

</details>

<details>
<summary>✅ Solution</summary>

Validate at the boundary:

```typescript
function login(raw: string) {
  const d: unknown = JSON.parse(raw);
  if (
    typeof d === "object" && d !== null &&
    typeof (d as any).username === "string" &&
    typeof (d as any).password === "string"
  ) {
    authenticate((d as LoginBody).username, (d as LoginBody).password);
  } else {
    throw new Error("Invalid login body");
  }
}
```

**Lesson:** Types are not validation. Data crossing a trust boundary must be checked at runtime.

</details>

---

## Bug 5: Structural Typing Lets the Wrong Object In 🟡

**Intent:** Only accept a `User`, not an arbitrary object.

```typescript
interface User { id: number; name: string; }

function deleteUser(u: User) { /* dangerous op */ }

const account = { id: 5, name: "admin", role: "owner" };
deleteUser(account); // compiles — is that intended?
```

**Expected vs Actual:** You might expect TypeScript to reject `account` because it isn't "a User." Actual: it compiles, because `account` structurally satisfies `User`.

<details>
<summary>💡 Hint</summary>

TypeScript matches by shape, not by name. Does `account` have everything `User` requires?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug (conceptual):** Assuming nominal typing. `account` has at least `id` and `name`, so it *is* a `User` structurally — extra `role` is allowed via a variable.
**Why:** TypeScript uses structural typing. This is usually desirable, but it surprises developers from nominal languages.

</details>

<details>
<summary>✅ Solution</summary>

If you truly need nominal distinction, brand the type:

```typescript
interface User { id: number; name: string; readonly __brand: "User"; }

function makeUser(id: number, name: string): User {
  return { id, name, __brand: "User" } as User;
}
// Now a plain { id, name, role } object is NOT assignable to User.
```

**Lesson:** Structural typing is the default. To get nominal behavior, add a brand. Don't assume name-based identity.

</details>

---

## Bug 6: Excess Property Check Confusion 🟢

**Intent:** Construct a config object inline.

```typescript
interface Options { timeout: number; }

const opts: Options = { timeout: 1000, retries: 3 }; // ❌
//                                      ~~~~~~~ error
```

**Expected vs Actual:** You expect extra `retries` to be silently ignored (since structural typing allows extras). Actual: error — `Object literal may only specify known properties, and 'retries' does not exist in type 'Options'.`

<details>
<summary>💡 Hint</summary>

Direct object **literals** get a stricter check than values passed through a variable.

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug (conceptual):** Excess property checks fire on direct object literals to catch typos — they're stricter than plain structural assignability.
**Why:** TypeScript layers an excess-property safety net on top of structural typing specifically for literals.

</details>

<details>
<summary>✅ Solution</summary>

Either add the property to the type, or assign via a variable if it's intentional:

```typescript
interface Options { timeout: number; retries?: number; }
const opts: Options = { timeout: 1000, retries: 3 }; // OK now
```

**Lesson:** Literals get excess-property checks; variables get plain structural checks. Know which rule applies.

</details>

---

## Bug 7: `typeof` Returns the JS Type, Not the TS Type 🟢

**Intent:** Log the "kind" of a value as its declared interface.

```typescript
interface Animal { species: string; }
const cat: Animal = { species: "cat" };

if (typeof cat === "Animal") { // ❌ never true
  console.log("it's an animal");
}
```

**Expected vs Actual:** You expect `typeof cat` to be `"Animal"`. Actual: it's `"object"`, so the branch never runs.

<details>
<summary>💡 Hint</summary>

`typeof` is a JavaScript operator. What set of strings can it return?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** `typeof` returns one of JavaScript's runtime types (`"object"`, `"string"`, `"number"`, ...), never a TypeScript interface name, which doesn't exist at runtime.
**Why:** The interface is erased; `cat` is a plain object at runtime.

</details>

<details>
<summary>✅ Solution</summary>

Check a runtime discriminant instead:

```typescript
interface Animal { kind: "animal"; species: string; }
const cat: Animal = { kind: "animal", species: "cat" };

if (cat.kind === "animal") console.log("it's an animal");
```

**Lesson:** `typeof` reports JS runtime types. For your own types, carry a discriminant value.

</details>

---

## Bug 8: `const enum` + Single-File Transpiler 🔴

**Intent:** Use a `const enum` while building with esbuild/Babel (single-file transpilation).

```typescript
// shared.ts
export const enum Status { Active, Inactive }

// app.ts
import { Status } from "./shared";
console.log(Status.Active); // works with tsc, breaks with esbuild/isolatedModules
```

**Expected vs Actual:** You expect `Status.Active` to inline to `0` everywhere. Actual: under a single-file transpiler (or `isolatedModules`), the import can't be resolved/inlined, causing a runtime "Status is not defined" or a compile error.

<details>
<summary>💡 Hint</summary>

`const enum` inlining needs whole-program knowledge. What does a per-file transpiler lack?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** `const enum` is inlined by `tsc` using cross-file information. Single-file transpilers (esbuild, SWC, Babel) compile each file in isolation and can't inline an imported `const enum`. `isolatedModules` flags this.
**Why:** Transpilation tooling that lacks whole-program type info can't perform `const enum` substitution — a real TS↔toolchain mismatch.

</details>

<details>
<summary>✅ Solution</summary>

Use a regular `enum` (emits a runtime object) or a union of literals:

```typescript
// Option A: regular enum (has runtime footprint)
export enum Status { Active, Inactive }

// Option B: zero-cost union (preferred)
export const STATUS = { Active: "active", Inactive: "inactive" } as const;
export type Status = (typeof STATUS)[keyof typeof STATUS];
```

**Lesson:** `const enum` assumes `tsc` does emit. With single-file transpilers, avoid it (enable `isolatedModules` to catch it).

</details>

---

## Bug 9: Trusting the Compiler Over Array Bounds 🔴

**Intent:** Get the first matching item and use it.

```typescript
const users = [{ name: "Ada" }, { name: "Linus" }];
const found = users[5];        // typed as { name: string }, but undefined at runtime
console.log(found.name.toUpperCase()); // 💥
```

**Expected vs Actual:** You expect the compiler to flag a possibly-missing element. Actual: `found` is typed `{ name: string }` (not `| undefined`), so it compiles and then crashes.

<details>
<summary>💡 Hint</summary>

Is the default type system *sound* about array indexing? Which flag changes that?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** By default, index access returns `T`, not `T | undefined` — a deliberate unsoundness for ergonomics. The compiler can't see that index 5 is out of range.
**Why:** TypeScript trades soundness for productivity. Array bounds are not tracked unless you opt in.

</details>

<details>
<summary>✅ Solution</summary>

Enable `noUncheckedIndexedAccess`, then handle the `undefined`:

```typescript
// tsconfig: "noUncheckedIndexedAccess": true
const found = users[5]; // now: { name: string } | undefined
console.log(found?.name.toUpperCase() ?? "not found");
```

**Lesson:** The default type system is intentionally unsound about indexing. Turn on `noUncheckedIndexedAccess` and narrow.

</details>

---

## Bug 10: Generic Type Used at Runtime 🔴

**Intent:** Create a default value based on the generic type `T`.

```typescript
function createDefault<T>(): T {
  if (T === Number) return 0 as T; // ❌
  return {} as T;
}
```

**Expected vs Actual:** You expect to branch on what `T` is. Actual: `'T' only refers to a type, but is being used as a value here.`

<details>
<summary>💡 Hint</summary>

Generics are erased. Is `T` available as a value at runtime?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** Type parameters are erased — `T` has no runtime existence, so you can't compare or inspect it.
**Why:** TypeScript generics are compile-time only (no monomorphization, no reified type info), unlike C++ templates or C#/Java reified-ish generics.

</details>

<details>
<summary>✅ Solution</summary>

Pass a runtime value (a factory or a tag) instead of relying on `T`:

```typescript
function createDefault<T>(factory: () => T): T {
  return factory();
}
const n = createDefault(() => 0);   // number
const o = createDefault(() => ({})); // {}
```

**Lesson:** If you need a type's identity at runtime, pass a real value (factory, constructor, or string tag). The generic parameter alone is gone.

</details>

---

## Bug 11: Assuming `tsc` Errors Block the Build 🟡

**Intent:** A failing type-check should stop deployment.

```bash
# CI step
tsc src/index.ts && node dist/index.js
```

```typescript
// src/index.ts
const port: number = "3000"; // type error
```

**Expected vs Actual:** You expect `tsc` to fail and `&&` to short-circuit. Actual: by default `tsc` prints the error but **still emits** JS and exits non-zero — but many setups ignore emit and run stale/other output, or expect no `.js` at all.

<details>
<summary>💡 Hint</summary>

Does `tsc` emit JavaScript even when there are type errors? Which flag couples checking and emit?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** Type checking and emit are decoupled. `tsc` emits `.js` even with type errors (though it exits with a non-zero code). Relying on "no output = it failed" is wrong.
**Why:** This decoupling lets you run partially-typed code during migration. It surprises people expecting a sound compiler that refuses to emit.

</details>

<details>
<summary>✅ Solution</summary>

```json
{ "compilerOptions": { "noEmitOnError": true } }
```

Or in CI, run a dedicated check that emits nothing and gate on its exit code:

```bash
tsc --noEmit && esbuild src/index.ts --outfile=dist/index.js && node dist/index.js
```

**Lesson:** Errors are diagnostics, not hard stops. Use `noEmitOnError` (or `--noEmit` as a gate) to make a type error block the pipeline.

</details>

---

## Bug 12: Empty Interface Accepts Almost Anything 🟡

**Intent:** Constrain a parameter to "some object."

```typescript
interface Anything {}

function process(x: Anything) {
  return x; // accepts numbers, strings, booleans... almost everything
}

process(42);     // OK?!
process("hi");   // OK?!
```

**Expected vs Actual:** You expect `Anything` to require an object. Actual: an empty interface is satisfied by nearly any non-null value, so primitives slip through.

<details>
<summary>💡 Hint</summary>

What members does an empty interface require? What does structural typing then allow?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** An empty interface requires *no* members, so structurally everything except `null`/`undefined` satisfies it — equivalent to `{}`, which is almost `any` for assignability.
**Why:** Structural typing + zero requirements = nearly universal acceptance.

</details>

<details>
<summary>✅ Solution</summary>

Use a precise type — `object` for non-primitives, or a real shape, or `unknown` to force narrowing:

```typescript
function process(x: Record<string, unknown>) { return x; }
// process(42); // Error now
```

**Lesson:** `interface Foo {}` is not a meaningful constraint. Specify required members or use `object`/`unknown`.

</details>

---

## Bug 13: Downleveling Surprise with `this` in a Callback 🔴

**Intent:** Keep `this` bound inside a class method's callback when targeting old JS.

```typescript
class Timer {
  seconds = 0;
  start() {
    // Author uses a plain function, expecting tsc to "fix" this
    setInterval(function () {
      this.seconds++; // `this` is wrong at runtime
    }, 1000);
  }
}
```

**Expected vs Actual:** You expect `this.seconds` to refer to the `Timer`. Actual: in a plain `function`, `this` is the timer's caller context (`undefined`/global), so it throws or silently fails — regardless of `target`.

<details>
<summary>💡 Hint</summary>

Does TypeScript change JavaScript's `this` binding semantics? What construct preserves lexical `this`?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** TypeScript does **not** change JS runtime semantics. A plain `function` rebinds `this`; TS won't auto-fix that. (With `noImplicitThis` the compiler at least warns.)
**Why:** TS is a checker, not a new runtime. `this` rules are JavaScript's, untouched by types.

</details>

<details>
<summary>✅ Solution</summary>

Use an arrow function (lexical `this`):

```typescript
class Timer {
  seconds = 0;
  start() {
    setInterval(() => { this.seconds++; }, 1000); // arrow keeps `this`
  }
}
```

**Lesson:** TypeScript adds types, not new runtime behavior. JavaScript's `this`, closures, and coercions all still apply.

</details>

---

## Summary of Lessons

| Bug | Misconception | Correct mental model |
|-----|---------------|----------------------|
| 1, 2, 7, 10 | "Types exist at runtime" | Types are erased; use runtime values/discriminants |
| 3, 4 | "`any`/`as` make it safe" | `any` disables checks; `as` validates nothing |
| 5, 6, 12 | "Typing is nominal / strict by name" | Structural typing; literals get excess-property checks |
| 8, 11, 13 | "Transpilation/checking changes JS" | Emit ≠ check; `tsc` doesn't change JS semantics |
| 9 | "The type system is sound" | It's intentionally unsound; opt in with flags |

**The one rule behind all of them:** TypeScript = JavaScript + a compile-time type checker that disappears at runtime. When a bug confuses you, ask "is this a *type* (erased) or a *value* (runtime)?"
