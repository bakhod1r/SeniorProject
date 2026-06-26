# Practical Type-System Patterns — Junior Level

> **Topic:** [Practical Type-System Patterns](README.md)
> **Focus:** Use the type system as a bug filter. Three habits — non-nullable types, sum types for states, and parsing input once — that delete whole categories of runtime errors before you run the program.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Code Examples](#code-examples)
8. [Pros & Cons](#pros--cons)
9. [Use Cases](#use-cases)
10. [Coding Patterns](#coding-patterns)
11. [Best Practices](#best-practices)
12. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
13. [Summary](#summary)

---

## Introduction

> Focus: **How do you make the compiler catch bugs that you would otherwise catch in production at 2 a.m.?**

A type system is not paperwork you do to make the compiler happy. It is a **proof checker** that runs every time you build. Every time you write a type, you hand the compiler a fact it must verify: "this value is a number," "this value is never null here," "this list always has at least one element." When the proof fails, the build fails — *before* the bug reaches a user.

Most working programmers use maybe 10% of what their type system can do. They write `string` and `int` and `User` and stop. The patterns on this page are the other 90%: the everyday, ship-it techniques that turn the type system from a labeling scheme into an active bug filter. None of them are academic. Each one comes from a real failure that someone shipped, debugged at midnight, and then prevented forever with a type.

Three ideas anchor this junior page, and they will carry you a surprisingly long way:

1. **Make illegal states unrepresentable.** If a combination of values should never happen, design your types so it *can't* be written down. You can't have a bug in a state you can't construct.
2. **Parse, don't validate.** Check unstructured input once, at the boundary, and turn it into a *typed* value. After that, the rest of your code holds proof-of-validity in the type and never re-checks.
3. **Make absence explicit.** Stop using `null` as a silent "maybe." Use a non-nullable type or an `Option`/`Maybe` so the compiler forces you to handle the "nothing" case.

> 🎓 **Why this matters for a junior:** The single most common production crash in history is the null-pointer / `NoneType has no attribute` / `undefined is not a function` error. The single most common data-corruption bug is acting on input nobody validated. Both are *type* problems, and both are preventable with patterns you can learn in an afternoon. Learning to encode rules in types is the highest-leverage skill upgrade available to a junior who already knows how to write a loop.

This page shows the patterns in TypeScript, Rust, Kotlin, Swift, and a little Haskell — but the ideas are language-agnostic. The middle and senior pages go deeper into newtypes, typestate, smart constructors, and full type-driven development.

---

## Prerequisites

What you should know before reading this:

- **Required:** How to declare variables, functions, and a simple record/struct/class in at least one typed language (TypeScript, Rust, Kotlin, Swift, Java, or Haskell).
- **Required:** What `null` / `nil` / `None` / `undefined` is, and that dereferencing it crashes.
- **Required:** What an `if`/`switch`/`match` is.
- **Helpful but not required:** A vague sense of "the compiler checks types before the program runs."
- **Helpful but not required:** Having once shipped a null-pointer bug. (It motivates everything here.)

You do **not** need to know:

- Generics, phantom types, or the typestate pattern — those are `middle.md` and `senior.md`.
- Anything about type theory, the lambda calculus, or how the type checker is implemented.
- Advanced TypeScript utility types or Rust trait bounds.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Type system** | The part of a language that classifies values and checks, before (or while) the program runs, that operations are applied to compatible values. |
| **Compile-time** | Checks that happen when you build, before any code runs. Bugs caught here cannot reach users. |
| **Runtime** | When the program is actually executing. Bugs that escape the type system surface here, usually in front of a customer. |
| **Sum type / tagged union** | A type that is *exactly one of* several alternatives, each possibly carrying data. `Loading | Loaded(data) | Failed(error)`. Also called an enum (Rust/Swift), discriminated union (TS), or algebraic data type (Haskell). |
| **Product type** | A type that bundles several values *together* — a struct/record/class with fields. A `User` has a name *and* an email *and* an age. |
| **Nullable type** | A type that may also be `null`/`nil`/`None`. In modern languages this is opt-in and marked (`string?`, `Option<String>`). |
| **`Option` / `Maybe`** | A two-case sum type: `Some(value)` or `None` / `Just x` or `Nothing`. The type-safe replacement for nullable. |
| **`Result` / `Either`** | A two-case sum type representing success or failure: `Ok(value)` or `Err(error)`. The type-safe replacement for exceptions in many languages. |
| **Illegal state** | A combination of field values your code should never be in (e.g. both `isLoading = true` and `data` populated). |
| **Parse** | To take unstructured/untyped input and produce a *typed* value, rejecting bad input at the moment of conversion. |
| **Validate** | To check input is okay but return the *same untyped value*, so the next caller has no proof and must re-check. |
| **Boundary** | The edge of your program where untyped data enters: HTTP requests, file reads, database rows, user forms, environment variables. |
| **Exhaustiveness** | A compiler check that your `switch`/`match` handles *every* case of a sum type. Add a case, get a compile error at every unhandled spot. |
| **Strict null checks** | A TypeScript compiler mode (`strictNullChecks`) where `null`/`undefined` are not silently part of every type — you must opt in. |

---

## Core Concepts

### 1. The type system is a proof checker

When you write `function greet(name: string)`, you are asserting a fact: every caller passes a string. The compiler *verifies* it. If somebody passes a number, the build fails. You did not write a test, you did not run the program — the bug simply cannot exist.

The patterns on this page all work the same way. You encode a rule as a type. The compiler enforces the rule everywhere, on every build, forever — including in code you write next year and forgot the rule. **A type is a test that runs on every line at compile time.**

### 2. Make illegal states unrepresentable

Look at this common shape (TypeScript):

```ts
interface RequestState {
  isLoading: boolean;
  data: User | null;
  error: string | null;
}
```

How many states does this describe? `2 × 2 × 2 = 8`. But how many are *valid*? Really only three: *loading*, *loaded with data*, *failed with error*. The other five are nonsense — `isLoading: true` with `data` already present, or `data` and `error` both set. Yet your code can *create* all eight, so somewhere a junior dev will, and the UI will flicker or crash.

The fix is to make the type describe only the three valid states:

```ts
type RequestState =
  | { status: "loading" }
  | { status: "loaded"; data: User }
  | { status: "failed"; error: string };
```

Now there is no way to be loading *and* have data. The nonsense states cannot be typed. **You cannot have a bug in a state you cannot construct.** This is the most important idea on the page, and it is a sum type doing the work.

### 3. Parse, don't validate

The slogan comes from Alexis King. The idea: when untyped input arrives, do the checking *once*, at the boundary, and produce a value whose **type proves** it passed. After that, the rest of your code holds that proven value and never re-checks.

The anti-pattern — *validate* — looks like this:

```ts
function validateEmail(s: string): boolean { /* returns true/false */ }

// ...500 lines later, in some other function:
function sendInvite(email: string) {
  // is `email` valid here? Who knows. Better re-check. Or forget to. 🐛
}
```

The function takes a plain `string`. The fact that it was validated lives only in the programmer's memory. Three call sites later, someone forgets, and an invalid email reaches the mail server.

The *parse* version returns a **new type**:

```ts
function parseEmail(s: string): Email | null { /* ... */ }

function sendInvite(email: Email) {  // can ONLY be called with a parsed Email
  // no re-checking — the type IS the proof
}
```

`sendInvite` literally cannot be called with a raw string. The validity is in the type. Re-validation bugs disappear because there is nothing to re-validate — you already hold the proof.

### 4. Make absence explicit (kill the null)

`null` is the "billion-dollar mistake" because it hides inside every type silently. In old Java, a `String` might be a string *or* `null`, and the compiler said nothing. You found out at runtime, with a `NullPointerException`.

Modern languages fixed this by making nullability **opt-in and visible** in the type:

- **Kotlin:** `String` can never be null. `String?` can. The compiler forces a null check before you use a `String?`.
- **TypeScript (`strictNullChecks`):** `string` excludes `null`/`undefined`. `string | null` includes them, and you must narrow.
- **Swift:** `String` is non-optional. `String?` (an `Optional<String>`) must be unwrapped.
- **Rust / Haskell:** There is no `null` at all. Absence is `Option<T>` / `Maybe a`, a sum type you must pattern-match.

The pattern: **never let "this might be missing" be invisible.** Put it in the type, and the compiler makes you handle it.

### 5. Exhaustiveness: the compiler reminds you of every case

The hidden superpower of sum types is **exhaustive matching**. When you `switch`/`match` over a sum type and the compiler knows you handled every case, you get a guarantee. Better: when you *add* a new case later (say, a `"cancelled"` status), every `switch` that doesn't handle it becomes a **compile error**, pointing you at exactly the code you need to update.

Compare to a `string` status field with `if`/`else if` chains: add a new status and the code silently falls through the `else`. No error, just a quiet bug. The sum type turns "I hope I updated every place" into "the compiler listed every place for me."

### 6. Push checks left (toward compile time)

A theme connecting all five concepts: **move the moment of failure earlier.** A bug caught by the type checker fails on your machine, in the build, with a precise location. The same bug caught at runtime fails on a user's machine, in production, with a stack trace and an incident channel. Same bug — radically different cost. Good type design is the art of dragging failures from runtime to compile-time.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Type as proof** | A passport. It doesn't *re-prove* your citizenship at every border; the document *is* the proof, checked once when issued. |
| **Parse, don't validate** | Airport security: you go through the checkpoint **once**, get a boarding pass, and then you're trusted inside the secure zone. Nobody re-scans you at the gate. The boarding pass is the typed value. |
| **Illegal states unrepresentable** | A light switch that physically cannot be both "on" and "off" at once. The hardware makes the bad state impossible. |
| **Nullable type** | A box clearly labeled "MAY BE EMPTY." You're forced to open and check before using the contents. An un-labeled box that's secretly sometimes empty is `null`. |
| **`Option`/`Maybe`** | A vending machine slot that either has a snack or visibly shows "SOLD OUT." You always see which before reaching in. |
| **Exhaustive match** | A pre-flight checklist where the plane won't start until *every* item is ticked. Add an item, and every cockpit must tick it. |
| **Validate (anti-pattern)** | A bouncer who checks IDs at the door but gives no wristband — so every bartender inside has to ID you again, and one of them forgets. |
| **Sum type** | A traffic light: exactly one of red, yellow, green. Never two at once, never none. |

---

## Mental Models

### The "make the bad state un-typeable" model

Before writing a struct, list every combination of its fields and ask: *is this combination ever valid?* Cross out the invalid ones. Then redesign the type so the crossed-out combinations **cannot be written**. If you can't type the bad state, you can't reach it, and you can't have a bug in it. Most "defensive" `if (x && !y) throw` checks vanish because the bad case is gone from the type.

### The "boundary membrane" model

Picture your program as a cell with a membrane. Outside the membrane: raw, untrusted, untyped data — JSON, form fields, env vars, DB rows, strings everywhere. The membrane is where **parsing** happens: you check once and convert to rich, typed values. Inside the membrane: everything is a proven type — `Email`, `UserId`, `NonEmptyList`, `PositiveInt`. The inside never re-validates because the membrane already did. Bugs cluster at membranes; concentrate your checking there and the interior stays clean.

### The "compiler is a tireless reviewer" model

Imagine a code reviewer who never sleeps, never gets tired, reviews *every line* on *every commit*, and catches the same class of bug every single time without ever getting bored. That reviewer is the type checker. The more rules you encode in types, the more this reviewer can catch for free. Every `null` you eliminate, every illegal state you remove, every parse you add hands this reviewer a new rule to enforce forever.

---

## Code Examples

We'll model the same little problem — **the state of a data fetch** and **a validated email** — across languages, plus the null story.

### TypeScript — illegal states unrepresentable

Buggy "bag of flags" version:

```ts
// ❌ 8 representable states, only 3 valid
interface FetchState {
  loading: boolean;
  user?: User;
  error?: string;
}

function render(s: FetchState) {
  if (s.loading) return "Spinner";
  if (s.error) return `Error: ${s.error}`;
  return `Hello ${s.user!.name}`;   // s.user! — the "!" is you lying to the compiler
}
```

Fixed with a discriminated union:

```ts
// ✅ exactly 3 states exist
type FetchState =
  | { status: "loading" }
  | { status: "success"; user: User }
  | { status: "error"; message: string };

function render(s: FetchState): string {
  switch (s.status) {
    case "loading": return "Spinner";
    case "success": return `Hello ${s.user.name}`;  // s.user is guaranteed here
    case "error":   return `Error: ${s.message}`;
  }
}
```

No `!`, no optional chaining, no "is user defined here?" The compiler *knows* `s.user` exists inside `case "success"` and *knows* it doesn't exist elsewhere. Add a fourth case `"cancelled"` and the `switch` won't compile until you handle it (with `strict` settings) — the compiler hands you the to-do list.

### TypeScript — strictNullChecks kills the NPE

```ts
// With "strictNullChecks": true in tsconfig.json

function firstName(user: User | null): string {
  // return user.name;        // ❌ compile error: user is possibly null
  if (user === null) return "Guest";
  return user.name;            // ✅ narrowed to User, safe
}
```

Turning on `strictNullChecks` is the single highest-value config change in a TypeScript project. It converts a class of runtime `Cannot read property 'name' of null` crashes into compile errors.

### Rust — Option and Result instead of null and exceptions

```rust
// No null exists in Rust. Absence is Option<T>.
fn find_user(id: u64, users: &[User]) -> Option<&User> {
    users.iter().find(|u| u.id == id)
}

fn main() {
    let users = load_users();
    match find_user(42, &users) {
        Some(user) => println!("Found {}", user.name),
        None => println!("No such user"),   // compiler FORCES this branch
    }
}
```

You cannot accidentally use a missing value, because there is no value until you've matched `Some`. Errors work the same way with `Result`:

```rust
fn parse_age(s: &str) -> Result<u8, String> {
    s.parse::<u8>().map_err(|_| format!("'{}' is not a valid age", s))
}

// The caller must deal with the error; it's in the type.
match parse_age("twelve") {
    Ok(age) => println!("Age is {}", age),
    Err(msg) => eprintln!("{}", msg),
}
```

### Rust — make illegal states unrepresentable with an enum

```rust
// ❌ if this were a struct with bools, you'd allow nonsense:
//    struct Conn { connected: bool, addr: Option<String>, error: Option<String> }

// ✅ enum: exactly one variant at a time
enum Connection {
    Disconnected,
    Connected { addr: String },
    Failed { reason: String },
}

fn describe(c: &Connection) -> String {
    match c {
        Connection::Disconnected => "not connected".into(),
        Connection::Connected { addr } => format!("connected to {}", addr),
        Connection::Failed { reason } => format!("failed: {}", reason),
    }
}
```

### Kotlin — non-nullable by default

```kotlin
fun lengthOf(s: String): Int = s.length        // s can NEVER be null
fun lengthOrZero(s: String?): Int = s?.length ?: 0  // s? must be handled

fun main() {
    // lengthOf(null)        // ❌ compile error
    println(lengthOf("hi"))  // 2
    println(lengthOrZero(null)) // 0 — the ?: forces a default
}
```

The `?` is the entire null-safety story: a type *with* `?` may be null and the compiler makes you handle it; a type *without* `?` is guaranteed non-null.

### Swift — optionals make absence explicit

```swift
func firstName(of user: User?) -> String {
    guard let user = user else { return "Guest" }  // unwrap or bail
    return user.name
}

// Parsing returns an optional; you must unwrap before use.
let maybeAge = Int("42")     // Int? — could be nil if the string isn't a number
if let age = maybeAge {
    print("Age: \(age)")
}
```

### Haskell — Maybe, the original

```haskell
data User = User { name :: String, age :: Int }

lookupUser :: Int -> [User] -> Maybe User
lookupUser uid = find (\u -> userId u == uid)

greet :: Maybe User -> String
greet Nothing  = "Guest"
greet (Just u) = "Hello " ++ name u   -- compiler forces both cases
```

### The email "parse, don't validate" pattern (TypeScript)

```ts
// A branded type: a string the compiler treats as distinct.
type Email = string & { readonly __brand: "Email" };

function parseEmail(raw: string): Email | null {
  const trimmed = raw.trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)
    ? (trimmed as Email)   // the ONLY place a string becomes an Email
    : null;
}

// This function CANNOT receive an unvalidated string:
function sendWelcome(to: Email) { /* ... */ }

const input = "  ALICE@Example.com  ";
const email = parseEmail(input);
if (email) {
  sendWelcome(email);       // ✅ typechecks
}
// sendWelcome(input);      // ❌ compile error: string is not Email
```

The validity check happens **once**, in `parseEmail`. Everywhere downstream, the `Email` type *is* the proof. No function re-validates.

---

## Pros & Cons

| Aspect | Pros | Cons |
|--------|------|------|
| **Bug prevention** | Whole classes of bugs (null deref, illegal state, re-validation) become impossible. | None of these stop logic bugs — a wrong-but-valid computation still compiles. |
| **Refactoring** | Add a sum-type case and the compiler lists every place to update. Fearless change. | Initial type design takes thought up front. |
| **Readability** | A rich type documents intent: `parseEmail(raw): Email` says exactly what happens. | Over-elaborate types can become noisy and hurt readability (see Pitfalls). |
| **Onboarding** | New devs are guided by the types; the compiler teaches the rules. | Requires the team to actually understand sum types and optionals. |
| **Runtime cost** | Usually zero — branded/phantom types are erased; enums are cheap tags. | Some wrappers add a tiny allocation in some languages. |
| **Boundary work** | Parsing concentrates validation in one obvious place. | You must write the parsers; raw data still needs runtime checking somewhere. |

---

## Use Cases

Reach for these patterns when:

- **Modeling UI / request state.** Loading / loaded / error is the textbook sum-type case — never three bools.
- **Handling user input or external data.** Parse JSON, form fields, query params, env vars into typed values at the boundary.
- **Anything that can be "missing."** Use `Option`/optional/nullable-with-`?` instead of returning `null` and hoping.
- **Functions that can fail.** Return `Result`/`Either` so the caller must handle failure, instead of throwing and hoping someone catches.
- **State machines.** Connection open/closed, order pending/paid/shipped — each phase as a sum-type case.
- **Domain values with rules.** Email, phone, non-empty list, positive quantity — parse once into a type that proves the rule.

Lean *lighter* on these patterns when:

- The value genuinely is "just a string" with no rules (a free-text comment).
- You're writing a five-line script that runs once. The ceremony isn't worth it.
- The type would be more confusing than the check it replaces (judgment — see `senior.md` on not over-engineering).

---

## Coding Patterns

### Pattern 1: The discriminated-union state

Always give the union a literal **tag field** (`status`, `kind`, `type`) so you can `switch` on it:

```ts
type Result<T> = { kind: "ok"; value: T } | { kind: "err"; error: string };
```

### Pattern 2: Parse at the boundary, trust inside

```ts
// boundary.ts  — the ONLY file that touches raw JSON
function parseUser(json: unknown): User | null { /* ...checks... */ }

// everywhere else: functions take `User`, never `unknown` or `any`
```

### Pattern 3: Replace `null` returns with `Option`/optional

```kotlin
// ❌ fun find(id: Int): User      (might return null, type lies)
fun find(id: Int): User? { /* ... */ }   // ✅ honest about absence
```

### Pattern 4: Exhaustive switch with a compile-time guard (TS)

```ts
function area(s: Shape): number {
  switch (s.kind) {
    case "circle": return Math.PI * s.r * s.r;
    case "square": return s.side * s.side;
    default:
      const _exhaustive: never = s;  // ❌ compile error if a case is unhandled
      return _exhaustive;
  }
}
```

The `never` trick makes "you forgot a case" a build failure.

### Pattern 5: Narrow, don't assert

```ts
// ❌ user!.name        — telling the compiler "trust me" (you might be wrong)
// ✅ if (user) { user.name }   — proving it, so the compiler agrees
```

Avoid `!`, `as`, and `any` — each one switches the proof checker off for that spot.

---

## Best Practices

- **Turn on the strict flags.** `strictNullChecks` (TS), warnings-as-errors, Kotlin's null-safety, Swift's optionals — opt into the strongest checking your language offers. It's the cheapest win available.
- **Model states as sum types, not flag bags.** The moment you have two related booleans, ask whether a sum type describes the real states better.
- **Parse once, at the edge.** All raw input gets converted to typed values in a thin boundary layer. The core of your app never sees `any`/`unknown`/raw strings.
- **Return `Option`/`Result`, don't return `null` or throw silently.** Make the "nothing" and "error" cases visible in the signature.
- **Handle every case explicitly.** Prefer exhaustive `switch`/`match` over `if/else` chains on a string field.
- **Avoid escape hatches.** `as any`, `!`, unchecked casts, and force-unwraps (`user!` in Swift) turn off the safety you're trying to build. Use them only with a comment explaining why it's safe.
- **Name types for meaning, not shape.** `Email`, `UserId`, `Cents` — not `string`, `number`. The name carries the rule.

---

## Edge Cases & Pitfalls

- **The `!` / force-unwrap trap.** `user!.name` (TS) or `user!.name` (Swift) silences the null check without proving anything. It crashes at runtime exactly like the null you were avoiding. Narrow instead.
- **`any` poisons everything.** A single `any` in TypeScript spreads — values derived from it lose all checking. Prefer `unknown` and narrow.
- **Validate-then-cast is not parsing.** `if (isEmail(s)) { use(s as Email) }` *works*, but if `isEmail` and the `Email` brand can drift apart, you've lied. Keep the check and the type-production in **one function** (`parseEmail`) so they can't disagree.
- **Optional chaining hides missing handling.** `user?.address?.city` silently produces `undefined` and moves on. Sometimes that's right; sometimes you needed to *handle* the missing user. Don't let `?.` become a way to ignore absence.
- **Non-exhaustive switch on a string.** `switch (status)` over a plain `string` (not a union) gives you no exhaustiveness check. Use a union type so adding a case is a compile error, not a silent fallthrough.
- **Re-introducing null inside the type.** `Email | null | undefined` defeats the point. Decide: either a value exists (`Email`) or you model absence in *one* explicit way (`Email | null`), not three.
- **Trusting the boundary too little or too much.** Data from your *own* database can still violate invariants (an old row written before a rule existed). Parse it too; don't assume internal == valid.

---

## Summary

- The type system is a **proof checker** that runs on every build. The patterns here hand it more rules to enforce, turning runtime crashes into compile errors.
- **Make illegal states unrepresentable:** use sum types so nonsense combinations (loading *and* loaded) cannot be written. You can't have a bug in a state you can't construct.
- **Parse, don't validate:** check raw input *once* at the boundary and produce a *typed* value (`Email`, `User`). Downstream code holds the proof in the type and never re-checks.
- **Make absence explicit:** drop `null` for `Option`/optional/nullable-with-`?`. The compiler then forces you to handle "nothing."
- **Return `Result`/`Either`** for fallible operations so callers must handle failure.
- **Exhaustive matching** turns "did I update every place?" into a compile error when you add a new case.
- Every pattern shares one goal: **push failures left**, from a user's machine at runtime to your machine at compile time.
- Escape hatches (`any`, `!`, force-unwrap, unchecked `as`) switch the proof checker off — use sparingly and deliberately.
- The middle and senior pages build on this with newtypes, branded/phantom types, the typestate pattern, smart constructors, and the full type-driven-development workflow.
