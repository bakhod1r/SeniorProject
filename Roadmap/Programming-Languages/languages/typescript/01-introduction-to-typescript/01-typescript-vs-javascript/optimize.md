# TypeScript vs JavaScript — Optimization Guide

> **10+ exercises that take poorly-typed (JavaScript-flavored) code and improve it with TypeScript.**
> "Optimization" here means **stronger type safety** and **better tooling**, not runtime speed — because types are erased, the runtime is identical. The win is fewer bugs, better autocomplete, and safer refactoring.
> Each entry shows the weak version, the improved version, and *why* the change matters.

## Table of Contents

1. [Safety Optimizations](#safety-optimizations)
2. [Tooling / Inference Optimizations](#tooling--inference-optimizations)
3. [Erasure-Aware Optimizations](#erasure-aware-optimizations)
4. [Structural-Typing Optimizations](#structural-typing-optimizations)
5. [Migration Optimizations (JS → TS)](#migration-optimizations-js--ts)
6. [Optimization Summary Table](#optimization-summary-table)
7. [Anti-Patterns to Avoid](#anti-patterns-to-avoid)

---

## Safety Optimizations

### Optimization 1: Replace `any` with a Precise Type

**Problem:** `any` is JavaScript-style "trust me" typing. It disables every check and propagates silently.

```typescript
// Before — JS habits leak in
function total(items: any): number {
  return items.reduce((sum: any, i: any) => sum + i.price, 0);
}
```

**Apply:** Model the data.

```typescript
// After
interface LineItem { price: number; quantity: number; }

function total(items: LineItem[]): number {
  return items.reduce((sum, i) => sum + i.price * i.quantity, 0);
}
```

**Why it works:** With real types, a typo like `i.prce` is a compile error and the lambda parameters are inferred (no `: any` noise). `total("not an array")` is now rejected.

**Expected impact:** A whole class of "undefined is not a function" bugs eliminated; full autocomplete on `i.`.

---

### Optimization 2: `unknown` Instead of `any` for External Data

**Problem:** Data from `JSON.parse`/fetch is typed `any`, so unchecked access compiles and crashes.

```typescript
// Before
const data: any = JSON.parse(raw);
console.log(data.user.profile.name); // no check, may crash
declare const raw: string;
```

**Apply:**

```typescript
// After
const data: unknown = JSON.parse(raw);
if (
  typeof data === "object" && data !== null &&
  "user" in data && typeof (data as any).user === "object"
) {
  // narrowed; safe to drill in with further checks
}
declare const raw: string;
```

**Why it works:** `unknown` forces narrowing before use, surfacing the "what if the shape is wrong?" question at compile time instead of in production.

**Expected impact:** Runtime crashes on malformed data become impossible to ignore.

---

### Optimization 3: Turn an Untyped Function Boundary into a Contract

**Problem:** A function takes untyped params, so callers pass anything and the body assumes a shape.

```typescript
// Before
function sendEmail(to, subject, body) {
  return `${to}: ${subject}\n${body}`;
}
sendEmail("a@b.com", 123, true); // garbage, no error
```

**Apply:**

```typescript
// After
function sendEmail(to: string, subject: string, body: string): string {
  return `${to}: ${subject}\n${body}`;
}
// sendEmail("a@b.com", 123, true); // Error: number not assignable to string
```

**Why it works:** Typing the boundary documents the contract and rejects wrong call sites. Internals can still rely on inference.

**Expected impact:** Wrong-argument bugs caught at every call site; the signature self-documents.

---

### Optimization 4: Eliminate `null`/`undefined` Surprises with `strictNullChecks`

**Problem:** A function returns `T | undefined` but is typed `T`, so callers forget to handle the empty case (a JS-style optimistic assumption).

```typescript
// Before (strictNullChecks off)
function findUser(id: number): User {
  return users.find((u) => u.id === id)!; // lies: find can return undefined
}
interface User { id: number; name: string; }
declare const users: User[];
```

**Apply:** Enable `strictNullChecks` and model reality.

```typescript
// After
function findUser(id: number): User | undefined {
  return users.find((u) => u.id === id);
}
const u = findUser(1);
console.log(u?.name ?? "not found"); // caller must handle undefined
interface User { id: number; name: string; }
declare const users: User[];
```

**Why it works:** The honest return type forces every caller to handle the missing case, the most common crash class in JS.

**Expected impact:** "Cannot read properties of undefined" bugs largely disappear.

---

### Optimization 5: Replace Magic Strings with a Union

**Problem:** A "status" parameter is `string`, so any typo is accepted.

```typescript
// Before
function setStatus(status: string) { /* ... */ }
setStatus("activ"); // typo, no error
```

**Apply:**

```typescript
// After
type Status = "active" | "inactive" | "pending";
function setStatus(status: Status) { /* ... */ }
// setStatus("activ"); // Error: not assignable to Status
```

**Why it works:** A literal union turns the compiler into a spell-checker for domain values and powers autocomplete of the valid options.

**Expected impact:** Invalid states are unrepresentable; IDE suggests the legal values.

---

## Tooling / Inference Optimizations

### Optimization 6: Stop Over-Annotating — Let Inference Work

**Problem:** Redundant annotations add noise and can drift out of sync.

```typescript
// Before
const count: number = 5;
const names: string[] = ["a", "b"];
const doubled: number[] = names.map((n: string): string => n + n);
```

**Apply:**

```typescript
// After
const count = 5;                 // inferred number
const names = ["a", "b"];        // inferred string[]
const doubled = names.map((n) => n + n); // n inferred string, result string[]
```

**Why it works:** Inference produces the same types with less code; the contextual type of `map` types the callback for you.

**Expected impact:** Less noise, fewer places to update on refactor — annotate boundaries, infer internals.

---

### Optimization 7: Derive a Type from a Value with `as const`

**Problem:** A list of options and its type are declared twice and can drift apart.

```typescript
// Before
const ROLES = ["admin", "editor", "viewer"];
type Role = "admin" | "editor" | "viewer"; // duplicated, can desync
```

**Apply:**

```typescript
// After
const ROLES = ["admin", "editor", "viewer"] as const;
type Role = (typeof ROLES)[number]; // "admin" | "editor" | "viewer", auto-synced
```

**Why it works:** `as const` freezes the literal types; the type is derived from the single source of truth (the runtime array), so they never drift.

**Expected impact:** One place to edit; the type and the runtime list can't disagree.

---

### Optimization 8: Use `satisfies` to Keep Inference AND Validation

**Problem:** Annotating with a type widens the value and loses precise literal info; not annotating loses validation.

```typescript
// Before
const config: Record<string, string | number> = {
  host: "localhost",
  port: 3000,
};
config.port.toFixed(0); // Error: port is `string | number`, lost the number-ness
```

**Apply:**

```typescript
// After
const config = {
  host: "localhost",
  port: 3000,
} satisfies Record<string, string | number>;
config.port.toFixed(0); // OK — port is still inferred as number
```

**Why it works:** `satisfies` checks the value against the type *without* widening it, so you get both validation and precise inferred types.

**Expected impact:** Validation of the shape plus full precision on each field.

---

## Erasure-Aware Optimizations

### Optimization 9: Replace `enum` with a Const Union (Zero Runtime Cost)

**Problem:** A regular `enum` emits a runtime object — extra bytes and a non-tree-shakeable footprint, surprising for something that feels type-only.

```typescript
// Before — emits a runtime object
enum Direction { Up, Down, Left, Right }
```

**Apply:**

```typescript
// After — zero runtime footprint, fully erased
const DIRECTION = {
  Up: "up", Down: "down", Left: "left", Right: "right",
} as const;
type Direction = (typeof DIRECTION)[keyof typeof DIRECTION];
```

**Why it works:** The object-of-literals + derived type gives the same ergonomics, is tree-shakeable, and (if you only need the type) erases entirely — honoring TS's zero-overhead promise.

**Expected impact:** Smaller bundles, no surprise runtime object, still typed.

---

### Optimization 10: Validate at the Boundary Instead of Asserting

**Problem:** Relying on `as` to "type" runtime data — an erased assertion that checks nothing.

```typescript
// Before
function loadUser(raw: string): User {
  return JSON.parse(raw) as User; // erased; validates nothing
}
interface User { id: number; name: string; }
```

**Apply:**

```typescript
// After — validation produces an EARNED type
interface User { id: number; name: string; }

function loadUser(raw: string): User {
  const d: unknown = JSON.parse(raw);
  if (
    typeof d === "object" && d !== null &&
    typeof (d as any).id === "number" &&
    typeof (d as any).name === "string"
  ) {
    return d as User;
  }
  throw new Error("Invalid user");
}
```

**Why it works:** The `as User` at the end is now justified by runtime checks. The type guarantee is *earned*, not assumed, closing the compile-time/runtime gap that erasure creates.

**Expected impact:** Bad data fails loudly at the boundary instead of silently corrupting downstream code.

---

### Optimization 11: Replace `instanceof`-on-Interface Hacks with a Discriminated Union

**Problem:** Trying to branch on erased types leads to fragile or non-compiling code.

```typescript
// Before — doesn't compile / fragile duck-typing
interface Cat { meow(): void; }
interface Dog { bark(): void; }
function speak(pet: Cat | Dog) {
  if ((pet as any).meow) (pet as Cat).meow();
  else (pet as Dog).bark();
}
```

**Apply:**

```typescript
// After — discriminant survives erasure
type Pet =
  | { kind: "cat"; meow(): void }
  | { kind: "dog"; bark(): void };

function speak(pet: Pet) {
  switch (pet.kind) {
    case "cat": return pet.meow();
    case "dog": return pet.bark();
  }
}
```

**Why it works:** The `kind` literal is real runtime data, so the compiler can narrow safely with no `as` casts and exhaustiveness checking comes for free.

**Expected impact:** No casts, no fragile property sniffing, exhaustive and refactor-safe.

---

### Optimization 12: Generic Helper Instead of Repeated `any` Casts

**Problem:** Untyped helpers force callers to cast, scattering `any` across the codebase.

```typescript
// Before
function first(arr: any[]): any { return arr[0]; }
const n = first([1, 2, 3]) as number; // cast at every call site
```

**Apply:**

```typescript
// After
function first<T>(arr: readonly T[]): T | undefined {
  return arr[0];
}
const n = first([1, 2, 3]); // number | undefined, no cast
```

**Why it works:** A generic preserves the element type through the call (erased at runtime, free at compile time) and the honest `| undefined` handles the empty array. No casts, full inference.

**Expected impact:** Casts eliminated, return type tracks the input, empty-array bug surfaced.

---

## Structural-Typing Optimizations

### Optimization 13: Accept the Minimal Shape, Not a Concrete Class

**Problem:** A function demands a full concrete type when it only uses one field — over-constraining callers (a nominal-thinking habit).

```typescript
// Before — forces callers to have a whole User
interface User { id: number; name: string; email: string; createdAt: Date; }
function greet(user: User): string {
  return `Hi ${user.name}`;
}
greet({ name: "Ada" } as User); // forced to cast or build a full object
```

**Apply:** Ask only for what you use (structural typing makes this natural).

```typescript
// After — minimal structural requirement
function greet(user: { name: string }): string {
  return `Hi ${user.name}`;
}
greet({ name: "Ada" });                 // OK
greet({ name: "Ada", id: 1, email: "" }); // OK — extra props fine via variable
```

**Why it works:** Structural typing means any object with `{ name: string }` qualifies. Narrow parameter types make the function reusable and the contract honest about its real dependency.

**Expected impact:** Fewer forced casts, more reusable helpers, clearer dependencies.

---

### Optimization 14: Brand Identical Shapes That Mean Different Things

**Problem:** Two structurally-identical types are silently interchangeable, allowing a unit/ID mixup.

```typescript
// Before — both are just `string`, freely swappable
type UserId = string;
type SessionId = string;
function loadUser(id: UserId) { /* ... */ }
const session: SessionId = "sess_abc";
loadUser(session); // BUG compiles
```

**Apply:** Brand them (nominal simulation, zero runtime cost).

```typescript
// After
type UserId = string & { readonly __brand: "UserId" };
type SessionId = string & { readonly __brand: "SessionId" };
function loadUser(id: UserId) { /* ... */ }
const session = "sess_abc" as SessionId;
// loadUser(session); // Error: SessionId not assignable to UserId
```

**Why it works:** The brand is a phantom type that exists only at compile time (erased to a plain string at runtime), making the two incompatible without any runtime overhead.

**Expected impact:** Whole classes of "passed the wrong ID/unit" bugs become compile errors.

---

## Migration Optimizations (JS → TS)

### Optimization 15: Add JSDoc Types Before a Full Rewrite

**Problem:** You want type safety in a `.js` file but can't convert it to `.ts` yet (mid-migration).

```typescript
// Before — plain JS, no checking
function discount(price, pct) {
  return price - price * pct;
}
```

**Apply:** Use JSDoc with `checkJs` (TypeScript checks JS via comments — no rename needed).

```typescript
/**
 * @param {number} price
 * @param {number} pct
 * @returns {number}
 */
function discount(price, pct) {
  return price - price * pct;
}
// With "allowJs" + "checkJs", discount("10", 0.1) is now a type error.
```

**Why it works:** TypeScript reads JSDoc annotations in `.js` files. You get checking without changing the extension or build output — ideal for incremental adoption.

**Expected impact:** Type safety on legacy `.js` files with zero rename churn.

---

### Optimization 16: Replace a Hand-Rolled "Type Check" with a Type Guard Function

**Problem:** Repeated inline shape checks clutter call sites and don't narrow types.

```typescript
// Before — duplicated, doesn't narrow for the compiler
function handle(x: unknown) {
  if (typeof x === "object" && x !== null && "id" in x) {
    console.log((x as any).id); // still need a cast
  }
}
```

**Apply:** Extract a reusable user-defined type guard (`x is T`).

```typescript
// After
interface Entity { id: number; }

function isEntity(x: unknown): x is Entity {
  return typeof x === "object" && x !== null &&
    typeof (x as Record<string, unknown>).id === "number";
}

function handle(x: unknown) {
  if (isEntity(x)) {
    console.log(x.id); // narrowed, no cast
  }
}
```

**Why it works:** The `x is Entity` predicate teaches the compiler to narrow `x` after the check, eliminating casts and centralizing the validation logic.

**Expected impact:** No scattered casts, reusable validation, compiler-verified narrowing.

---

## Optimization Summary Table

| # | From (JS-style) | To (TS-optimized) | Win |
|---|-----------------|-------------------|-----|
| 1 | `any` params | Modeled interface | Real checks + autocomplete |
| 2 | `any` for JSON | `unknown` + narrow | Forces handling bad data |
| 3 | Untyped params | Typed boundary | Wrong calls rejected |
| 4 | Optimistic `T` | `T \| undefined` + `strictNullChecks` | Kills null-crash class |
| 5 | `string` flags | Literal union | No typos, autocomplete |
| 6 | Over-annotated | Inferred locals | Less noise, no drift |
| 7 | Duplicated list+type | `as const` derive | Single source of truth |
| 8 | Type annotation widens | `satisfies` | Validate without widening |
| 9 | `enum` (emits object) | Const union | Zero runtime cost |
| 10 | `as` assertion | Runtime validation | Earned type, safe data |
| 11 | `instanceof`/cast hacks | Discriminated union | No casts, exhaustive |
| 12 | `any[]` helper + casts | Generic helper | Type tracks input |
| 13 | Concrete class param | Minimal structural shape | Reusable, fewer casts |
| 14 | Identical-shape types | Branded types | Catches ID/unit mixups |
| 15 | Untyped `.js` | JSDoc + `checkJs` | Safety without rename |
| 16 | Inline checks + casts | Type guard (`x is T`) | Narrows, reusable |

**Guiding principle:** None of these change runtime speed — types are erased. They optimize **correctness, tooling, and maintainability**. The best TypeScript code looks like clean JavaScript with precise types at the boundaries, inference inside, and runtime validation where untrusted data enters.

---

## Anti-Patterns to Avoid

These "optimizations" look tempting but make things worse. Recognize and reject them.

### Anti-Pattern 1: Casting Away Errors with `as`

```typescript
// DON'T — silences the compiler, keeps the bug
const port = config.port as number; // config.port might be a string
```

The error was telling you the real type. `as` doesn't convert; it lies. Fix the source type or validate, then narrow.

### Anti-Pattern 2: `any` to "Move Fast"

```typescript
// DON'T — disables checking on everything downstream
function process(data: any) { return data.items.map((i: any) => i.id); }
```

You lose autocomplete, lose error detection, and the `any` spreads. Model the type or use `unknown`.

### Anti-Pattern 3: Over-Annotating Everything

```typescript
// DON'T — noise that drifts out of sync
const sum: number = (a: number) + (b: number); // redundant
```

Inference already covers locals and obvious expressions. Annotate boundaries, not internals.

### Anti-Pattern 4: Treating Types as Runtime Validation

```typescript
// DON'T — the type guarantees nothing about the actual bytes
function handle(req: { body: UserDto }) { save(req.body); }
declare function save(u: UserDto): void;
interface UserDto { id: number; }
```

The `UserDto` annotation is erased. If `req.body` is malformed, nothing stops it. Validate at the boundary, then the type is earned.

### Anti-Pattern 5: Reaching for `enum` by Default

```typescript
// DON'T (usually) — emits a runtime object, not tree-shakeable
enum LogLevel { Debug, Info, Warn, Error }
```

Prefer a const-object + derived union (Optimization 9) for zero runtime footprint, unless you specifically need reverse mapping or `enum` ergonomics.

**Closing thought:** Good TypeScript optimization is rarely about clever types — it's about *honest* types. Make the types tell the truth about your data (including `null`, `undefined`, and unknown shapes), put validation where untrusted data enters, and let inference do the rest. The compiler can only protect you to the extent your types reflect reality.
