# TypeScript vs JavaScript — Practical Tasks

> Hands-on tasks that build intuition for the TS↔JS relationship: the superset, static checking, type erasure, structural typing, and transpilation.
> Each task has a goal, starter code, an expected solution shape, and evaluation criteria.

## Table of Contents

1. [Junior Tasks](#junior-tasks)
2. [Middle Tasks](#middle-tasks)
3. [Senior Tasks](#senior-tasks)
4. [Questions](#questions)
5. [Mini Projects](#mini-projects)
6. [Challenge](#challenge)

---

## Junior Tasks

### Task 1: Rename `.js` to `.ts` (Prove the Superset)

**Type:** Experiment

**Goal:** Confirm that valid JavaScript is valid TypeScript.

**Steps:**
1. Create `math.js`:

```typescript
// math.js — plain JavaScript
function add(a, b) {
  return a + b;
}
console.log(add(2, 3));
```

2. Rename it to `math.ts`.
3. Compile with `tsc math.ts` and run `node math.js`.

**Expected outcome:** It compiles and prints `5` with no changes. Under `noImplicitAny`, `a` and `b` would trigger a diagnostic — but the file is still valid TS syntax.

**Evaluation criteria:**
- [ ] The unchanged JS compiles to JS.
- [ ] Output is `5`.
- [ ] You can explain why this works (superset relationship).

---

### Task 2: Add Type Annotations

**Type:** Coding

**Goal:** Add types to a JavaScript function and watch the compiler catch a mistake.

**Starter:**

```typescript
// TODO: add parameter and return type annotations
function greet(name) {
  return "Hello, " + name.toUpperCase();
}

greet("world");
greet(42); // should become a compile error after typing
```

**Expected solution shape:**

```typescript
function greet(name: string): string {
  return "Hello, " + name.toUpperCase();
}

greet("world");
// greet(42); // Error: Argument of type 'number' is not assignable to parameter of type 'string'
```

**Evaluation criteria:**
- [ ] `name` is typed `string`, return type is `string`.
- [ ] `greet(42)` is a compile error.
- [ ] `greet("world")` still works.

---

### Task 3: Prove Type Erasure

**Type:** Experiment

**Goal:** See that types disappear in the output.

**Starter (`erase.ts`):**

```typescript
interface User {
  id: number;
  name: string;
}
type ID = string | number;

function nameOf(u: User): string {
  return u.name;
}

const u = { id: 1, name: "Ada" } as User;
console.log(nameOf(u));
```

**Steps:**
1. Run `tsc erase.ts`.
2. Open the produced `erase.js`.

**Expected outcome:** `erase.js` contains the `nameOf` function and the `u` object literal, but **no** `interface User`, **no** `type ID`, and the `as User` is gone.

**Evaluation criteria:**
- [ ] `interface` and `type` produced no output.
- [ ] `as User` was stripped.
- [ ] You can state that erasure means zero runtime cost.

---

### Task 4: Type Inference vs Annotation

**Type:** Coding

**Goal:** Identify where inference makes annotations unnecessary.

**Starter:**

```typescript
// Mark which annotations are REDUNDANT (inference covers them)
const count: number = 5;
const title: string = "Roadmap";
let total = 0;

function square(n: number): number {
  const result: number = n * n;
  return result;
}
```

**Expected solution shape:**

```typescript
const count = 5;          // inferred number
const title = "Roadmap";  // inferred string
let total = 0;            // inferred number

function square(n: number): number { // keep param type; return type optional
  const result = n * n;   // inferred number
  return result;
}
```

**Evaluation criteria:**
- [ ] Redundant local annotations removed.
- [ ] Function parameter type kept (boundary).
- [ ] Behavior unchanged.

---

### Task 5: Use `unknown` Instead of `any`

**Type:** Coding

**Goal:** Safely handle data of unknown shape.

**Starter:**

```typescript
function getLength(input: any): number {
  return input.length; // unsafe — crashes if input has no length
}
```

**Expected solution shape:**

```typescript
function getLength(input: unknown): number {
  if (typeof input === "string" || Array.isArray(input)) {
    return input.length;
  }
  return 0;
}
```

**Evaluation criteria:**
- [ ] Parameter is `unknown`, not `any`.
- [ ] Value is narrowed before `.length`.
- [ ] No runtime crash for non-length inputs.

---

## Middle Tasks

### Task 6: Convert a JS Module to Typed TS

**Type:** Coding

**Goal:** Migrate a small untyped module to fully typed TypeScript.

**Starter (`cart.js`):**

```typescript
function createCart() {
  return { items: [], total: 0 };
}
function addItem(cart, name, price) {
  cart.items.push({ name, price });
  cart.total += price;
  return cart;
}
```

**Expected solution shape:**

```typescript
interface CartItem {
  name: string;
  price: number;
}
interface Cart {
  items: CartItem[];
  total: number;
}

function createCart(): Cart {
  return { items: [], total: 0 };
}

function addItem(cart: Cart, name: string, price: number): Cart {
  cart.items.push({ name, price });
  cart.total += price;
  return cart;
}
```

**Evaluation criteria:**
- [ ] `Cart` and `CartItem` interfaces defined.
- [ ] All function boundaries typed.
- [ ] `addItem(cart, "x", "free")` is a compile error.

---

### Task 7: Discriminated Union (Erasure-Safe Runtime Dispatch)

**Type:** Coding

**Goal:** Distinguish union members at runtime without relying on erased types.

**Starter:**

```typescript
// Make `area` type-safe using a discriminant field
type Shape = { r: number } | { s: number };

function area(shape: Shape): number {
  // how do we know which one it is at runtime?
  return 0;
}
```

**Expected solution shape:**

```typescript
type Shape =
  | { kind: "circle"; r: number }
  | { kind: "square"; s: number };

function area(shape: Shape): number {
  switch (shape.kind) {
    case "circle": return Math.PI * shape.r ** 2;
    case "square": return shape.s ** 2;
  }
}
```

**Evaluation criteria:**
- [ ] A `kind` literal discriminant exists (real runtime data).
- [ ] TypeScript narrows each branch.
- [ ] No `instanceof` on a type is used.

---

### Task 8: Runtime Validation at the Boundary

**Type:** Coding

**Goal:** Bridge the gap between compile-time types and runtime data.

**Starter:**

```typescript
interface ApiUser { id: number; email: string; }

function parseUser(raw: string): ApiUser {
  return JSON.parse(raw) as ApiUser; // unsafe assertion
}
```

**Expected solution shape:**

```typescript
interface ApiUser { id: number; email: string; }

function parseUser(raw: string): ApiUser {
  const data: unknown = JSON.parse(raw);
  if (
    typeof data === "object" && data !== null &&
    "id" in data && typeof (data as Record<string, unknown>).id === "number" &&
    "email" in data && typeof (data as Record<string, unknown>).email === "string"
  ) {
    return data as ApiUser;
  }
  throw new Error("Invalid user payload");
}
```

**Evaluation criteria:**
- [ ] Parsed value starts as `unknown`.
- [ ] Each field validated at runtime.
- [ ] Invalid input throws, not returns garbage.

---

### Task 9: Observe `target` Transpilation

**Type:** Experiment

**Goal:** See how `target` changes emitted JavaScript.

**Starter (`feature.ts`):**

```typescript
class Box {
  value = 0;
  set(v: number) { this.value = v; }
}
const doubled = [1, 2, 3].map((n) => n * 2);
export { Box, doubled };
```

**Steps:**
1. Compile with `tsc feature.ts --target ES5 --module commonjs` and inspect output.
2. Compile with `tsc feature.ts --target ES2020 --module commonjs` and inspect output.

**Expected outcome:** ES5 output rewrites the class to a function/IIFE and the arrow function to `function`. ES2020 keeps `class` and `=>`. In both, the `: number` types are gone.

**Evaluation criteria:**
- [ ] You can point to the downleveled `class`/arrow in ES5.
- [ ] You can confirm types are stripped at both targets.
- [ ] You can explain: erasure (always) vs downleveling (target-dependent).

---

### Task 10: Spot Structural Typing in Action

**Type:** Coding + Reasoning

**Goal:** Demonstrate that shape, not name, drives compatibility.

**Starter:**

```typescript
interface Logger { log(msg: string): void; }

function useLogger(l: Logger) { l.log("hi"); }

// Will these compile? Predict, then verify.
const a = { log: (m: string) => console.log(m) };
class ConsoleWriter { log(m: string) { console.log(m); } }
```

**Expected solution shape:**

```typescript
useLogger(a);                  // OK — shape matches, no `implements` needed
useLogger(new ConsoleWriter()); // OK — structurally a Logger
// useLogger({ write: () => {} }); // Error — missing `log`
```

**Evaluation criteria:**
- [ ] Both `a` and `ConsoleWriter` accepted without `implements Logger`.
- [ ] An object missing `log` is rejected.
- [ ] You can explain structural vs nominal.

---

## Senior Tasks

### Task 11: Brand a Type to Simulate Nominal Typing

**Type:** Coding

**Goal:** Make two structurally-identical types incompatible.

**Starter:**

```typescript
type UserId = string;
type OrderId = string;

function getUser(id: UserId) { /* ... */ }
const orderId: OrderId = "order_123";
getUser(orderId); // BUG: compiles, but shouldn't
```

**Expected solution shape:**

```typescript
type UserId = string & { readonly __brand: "UserId" };
type OrderId = string & { readonly __brand: "OrderId" };

function asUserId(s: string): UserId { return s as UserId; }
function getUser(id: UserId) { /* ... */ }

const orderId = "order_123" as OrderId;
// getUser(orderId); // Error: OrderId not assignable to UserId
getUser(asUserId("user_42")); // OK
```

**Evaluation criteria:**
- [ ] Branded types reject cross-assignment.
- [ ] Runtime values remain plain strings (zero cost).
- [ ] A constructor function gates creation.

---

### Task 12: Design an Incremental Migration Plan

**Type:** Design

**Goal:** Write a `tsconfig.json` and plan for migrating a JS codebase.

**Requirements:**
- Allow `.js` and `.ts` to coexist.
- Start lenient, ratchet toward strict.
- Type-check JS via JSDoc where cheap.

**Expected solution shape:**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "allowJs": true,
    "checkJs": false,
    "strict": false,
    "noImplicitAny": true,
    "skipLibCheck": true,
    "outDir": "dist"
  },
  "include": ["src/**/*"]
}
```

Plan: convert leaf modules first → enable `noImplicitAny` globally → turn on `strictNullChecks` last (most errors) → gate CI on a growing count of strict files.

**Evaluation criteria:**
- [ ] `allowJs` enabled for coexistence.
- [ ] A ratcheting order is described.
- [ ] `strictNullChecks` is scheduled last with justification.

---

### Task 13: Keep `tsc` and a Bundler in Agreement

**Type:** Config + Reasoning

**Goal:** Configure for type-check-only `tsc` plus esbuild/SWC emit.

**Starter:**

```json
{ "compilerOptions": { "target": "ES2022", "module": "ESNext" } }
```

**Expected solution shape:**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "noEmit": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "strict": true
  }
}
```

**Evaluation criteria:**
- [ ] `noEmit` so the bundler does emit.
- [ ] `isolatedModules` rejects cross-file-only constructs.
- [ ] `verbatimModuleSyntax` makes import elision syntactic.
- [ ] You can explain the single-file transpiler problem.

---

## Questions

Answer these to check understanding.

1. Why is "all JS is valid TS" true at the syntax level but not always at the type-check level?
2. Name three constructs that are fully erased and two that emit runtime JavaScript.
3. Why can a fully type-checked program still crash on API data?
4. What's the difference between type stripping and syntax downleveling?
5. Why does an object literal trigger excess-property checks but a variable doesn't?
6. How do you discriminate a union at runtime given that types are erased?
7. When is structural typing a liability, and how do you simulate nominal typing?
8. Why does `as` provide no runtime safety?
9. What flags keep `tsc` and a single-file transpiler producing the same imports?
10. Give one case where staying in plain JavaScript is the right call.

<details>
<summary>Answer Key (summary)</summary>

1. JS parses as TS, but type checks (e.g. `noImplicitAny`) can still report diagnostics.
2. Erased: `interface`, `type`, annotations, generics, `as`. Emit: `enum`, `class`, `namespace`.
3. Types are erased; external data is asserted, not validated, so bad shapes slip through.
4. Stripping removes types (always); downleveling rewrites modern syntax to the `target` level.
5. Direct literals get an extra typo-catching check; variables use plain structural assignability.
6. Keep a runtime discriminant (e.g. `kind` literal) and switch on it.
7. When identical shapes mean different things (units, IDs); brand the types.
8. `as` is erased — it performs no runtime check, only silences the compiler.
9. `isolatedModules` + `verbatimModuleSyntax`.
10. Tiny throwaway scripts where a build step isn't worth it.

</details>

---

## Mini Projects

### Mini Project 1: JS → TS Calculator CLI

**Goal:** Take a small JavaScript calculator and convert it to TypeScript, letting the compiler catch real bugs.

**Requirements:**
- Start from a `.js` file with `add`, `sub`, `mul`, `div`.
- Type all function boundaries.
- Handle the divide-by-zero case explicitly.
- Validate CLI input at runtime (it arrives as `string`).

**Starter:**

```typescript
// calc.js (convert me)
function div(a, b) { return a / b; }
const [, , aStr, op, bStr] = process.argv;
console.log(div(Number(aStr), Number(bStr)));
```

**Expected shape:**

```typescript
type Op = "+" | "-" | "*" | "/";

function compute(a: number, b: number, op: Op): number {
  switch (op) {
    case "+": return a + b;
    case "-": return a - b;
    case "*": return a * b;
    case "/":
      if (b === 0) throw new Error("Division by zero");
      return a / b;
  }
}

const a = Number(process.argv[2]);
const b = Number(process.argv[4]);
const op = process.argv[3] as Op;
if (Number.isNaN(a) || Number.isNaN(b)) throw new Error("Invalid number input");
console.log(compute(a, b, op));
```

**Deliverable checklist:**
- [ ] All boundaries typed.
- [ ] `Op` is a union, exhaustively switched.
- [ ] Runtime validation for NaN and divide-by-zero.
- [ ] Compiles with `strict: true`.

---

### Mini Project 2: Config Loader (Compile-Time vs Runtime Gap)

**Goal:** Build a loader that demonstrates why types are not validation.

**Requirements:**
- Define a `Config` interface.
- Load JSON from disk (or a string).
- Show the unsafe `as` version, then the safe validated version.
- Throw a clear error on invalid shape.

**Expected shape:**

```typescript
interface Config { port: number; host: string; debug?: boolean; }

function loadConfigUnsafe(raw: string): Config {
  return JSON.parse(raw) as Config; // demonstrates the trap
}

function loadConfig(raw: string): Config {
  const d: unknown = JSON.parse(raw);
  if (
    typeof d === "object" && d !== null &&
    typeof (d as any).port === "number" &&
    typeof (d as any).host === "string"
  ) {
    return d as Config;
  }
  throw new Error("Invalid config");
}
```

**Deliverable checklist:**
- [ ] Both unsafe and safe versions present.
- [ ] Safe version validates each required field at runtime.
- [ ] A short note explains why `as` alone is unsafe (erasure).

---

## Challenge

### Challenge: Build a Tiny Runtime Type Guard Library

**Goal:** Recreate, in miniature, what schema libraries do — bridge erased types and runtime data.

**Requirements:**
- Implement guards: `isString`, `isNumber`, `isBoolean`, `isObject`.
- Implement a combinator `object({ ...guards })` that returns a guard for a shape.
- The combinator must produce a value whose type is inferred from the guards (so the validated result is fully typed).
- Throw a descriptive error listing the failing field.

**Skeleton:**

```typescript
type Guard<T> = (v: unknown) => v is T;

const isString: Guard<string> = (v): v is string => typeof v === "string";
const isNumber: Guard<number> = (v): v is number => typeof v === "number";
const isBoolean: Guard<boolean> = (v): v is boolean => typeof v === "boolean";

function object<S extends Record<string, Guard<any>>>(
  shape: S
): Guard<{ [K in keyof S]: S[K] extends Guard<infer T> ? T : never }> {
  return (v): v is any => {
    if (typeof v !== "object" || v === null) return false;
    return Object.entries(shape).every(([k, g]) => g((v as any)[k]));
  };
}

// Usage
const isUser = object({ id: isNumber, name: isString });
const raw: unknown = JSON.parse('{"id":1,"name":"Ada"}');
if (isUser(raw)) {
  // raw is now typed { id: number; name: string }
  console.log(raw.name.toUpperCase());
}
```

**Evaluation criteria:**
- [ ] Guards return correctly-narrowing `v is T` predicates.
- [ ] `object` infers the result type from its guard map (mapped + conditional types).
- [ ] Validated value is fully typed downstream with no `any`.
- [ ] You can articulate that this library exists precisely because TS types are erased and cannot validate runtime data themselves.

**Stretch goals:**
- Add `array<T>(g: Guard<T>): Guard<T[]>`.
- Add `optional<T>` for `T | undefined` fields.
- Collect ALL failing fields instead of failing fast.
