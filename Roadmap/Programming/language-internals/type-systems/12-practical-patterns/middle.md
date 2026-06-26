# Practical Type-System Patterns — Middle Level

> **Focus:** Newtypes, branded types, smart constructors, builders, and discriminated unions — the working toolkit for encoding domain rules so a whole class of mix-ups and invalid values can't compile.

> **Topic:** [Practical Type-System Patterns](README.md)

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

> Focus: **How do you stop `UserId` and `OrderId` — both "just numbers" — from being passed in the wrong order? How do you guarantee a value satisfies its rules before any code touches it?**

The junior page established three habits: make illegal states unrepresentable, parse don't validate, and make absence explicit. This page gives you the concrete *constructs* that implement those habits in real code: **newtypes**, **branded types**, **smart constructors**, **typed builders**, and **richly-tagged discriminated unions**.

The unifying problem is that primitive types are too generous. A `string` could be a name, an email, a SQL fragment, a sanitized HTML chunk, or a session token — the type can't tell them apart, so the compiler can't stop you from using one where another belongs. An `int` could be a user id, an order id, a price in cents, or a quantity. The compiler happily lets you subtract a price from a quantity or look up an order by a user id. These mix-ups are real, they ship, and they're maddening to debug because *the types looked fine*.

The cure is to **carve distinct types out of primitives**. A `UserId` is a number, but a *different* type from `OrderId`. An `Email` is a string, but a *different* type from a raw `string`. Once `UserId` and `OrderId` are distinct, passing one where the other is expected is a compile error. Once `Email` is distinct from `string`, you can only get one by parsing — so it's always valid.

> 🎓 **Why this matters for a middle engineer:** You're now writing code other people depend on — shared functions, library APIs, service boundaries. The cost of a wrong-type-passed bug multiplies across every caller. Encoding domain distinctions in the type system is how you make your APIs *misuse-resistant*: a colleague who calls your function the wrong way gets a red squiggle, not a 3 a.m. page. This is the difference between code that's *correct if used carefully* and code that's *correct by construction*.

This page is example-heavy across TypeScript, Rust, Haskell, Kotlin, and Swift.

---

## Prerequisites

- **Required:** The junior page's three habits (illegal states, parse-don't-validate, explicit absence).
- **Required:** Comfort with generics in at least one language (`List<T>`, `Option<T>`, `function f<T>(x: T)`).
- **Required:** Knowing what a constructor / factory function is, and what "private" means for a field or constructor.
- **Helpful:** Familiarity with TypeScript's structural typing, or Rust/Haskell's nominal typing — we contrast them.
- **Helpful:** Having debugged a "passed the arguments in the wrong order" bug.

You do **not** yet need: the full typestate pattern, phantom *state* types, or type-driven development — those are `senior.md`.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Newtype** | A distinct type wrapping a single underlying value, with no runtime overhead in most languages. `newtype UserId = UserId Int`. Rust: `struct UserId(u64)`. |
| **Branded type** | TypeScript's emulation of a newtype: an underlying type intersected with a unique "brand" marker, e.g. `string & { __brand: "Email" }`. |
| **Nominal typing** | Two types are compatible only if they have the *same name/declaration*. Rust, Haskell, Java, Swift, Kotlin. Newtypes are distinct automatically. |
| **Structural typing** | Two types are compatible if they have the *same shape*. TypeScript, Go (interfaces). Plain wrappers leak; you need branding to force distinction. |
| **Smart constructor** | A factory function that validates and returns `Option`/`Result`/nullable, paired with a *private* raw constructor so the only way to build the type is through the validating factory. |
| **Typed builder** | A builder whose *return type changes* as required fields are set, so `build()` only exists once all required fields are present. |
| **Discriminated union** | A sum type with an explicit tag field used to distinguish cases and drive exhaustive handling. |
| **Units of measure** | Distinct types for physical/domain units (`Meters`, `Feet`, `Cents`, `Seconds`) so you can't add incompatible quantities. |
| **`Validated<T>` / `Unvalidated<T>`** | A pattern that tags whether a value has passed validation, so an API can require the validated flavor. |
| **Type alias** | A *name* for an existing type (`type UserId = number`). **Not** a new type — provides documentation but no safety. The common trap. |
| **Zero-cost abstraction** | A type-level distinction that compiles away to the underlying representation, costing nothing at runtime. |

---

## Core Concepts

### 1. Type alias vs newtype — the critical distinction

This is the trap that catches everyone first:

```ts
type UserId = number;     // alias: NOT a distinct type
type OrderId = number;    // alias: NOT a distinct type

function getOrder(id: OrderId) { /* ... */ }
const userId: UserId = 42;
getOrder(userId);          // ✅ compiles! both are just `number`. BUG.
```

A type *alias* is a synonym. `UserId` and `OrderId` are both literally `number`, so they're interchangeable. The alias documents intent but provides **zero** safety. To get safety you need a genuinely distinct type — a **newtype** (nominal languages) or a **brand** (structural languages).

### 2. Newtypes in nominal languages — free distinctness

In Rust, Haskell, Swift, Kotlin (with `value class`), wrapping a value in a named single-field type makes it a *different type*:

```rust
struct UserId(u64);
struct OrderId(u64);

fn get_order(id: OrderId) { /* ... */ }

let user = UserId(42);
// get_order(user);  // ❌ compile error: expected OrderId, found UserId
```

The compiler now refuses the mix-up. And — crucially — `UserId(u64)` is a *zero-cost* abstraction: it compiles to a bare `u64`, no boxing, no overhead. You get the safety for free.

### 3. Branded types in structural languages

TypeScript uses *structural* typing: a type is just its shape, so two wrappers with the same shape are interchangeable. To force a distinction, you intersect with a unique, never-actually-present "brand":

```ts
type Brand<T, B> = T & { readonly __brand: B };

type UserId  = Brand<number, "UserId">;
type OrderId = Brand<number, "OrderId">;

function getOrder(id: OrderId) { /* ... */ }

const userId = 42 as UserId;
// getOrder(userId);  // ❌ Argument of type 'UserId' is not assignable to 'OrderId'
```

The `__brand` field never exists at runtime — it's purely a compile-time tag. You "mint" a branded value with `as` inside a controlled constructor and nowhere else.

### 4. Smart constructors — the only door is the validated one

A newtype stops *mix-ups*. A **smart constructor** additionally guarantees *validity*. The recipe: make the raw constructor **private**, expose only a validating factory:

```haskell
module Email (Email, mkEmail, unEmail) where

newtype Email = Email String     -- constructor NOT exported

mkEmail :: String -> Maybe Email
mkEmail s
  | isValid s = Just (Email s)
  | otherwise = Nothing

unEmail :: Email -> String
unEmail (Email s) = s
```

Because the `Email` constructor is not exported, **the only way to obtain an `Email` is through `mkEmail`**, which validates. There is no path to an invalid `Email`. Every function taking `Email` can assume validity — forever, with no defensive checks.

This is "parse, don't validate" given teeth: the type's *constructor* is the parser, and it's the only entrance.

### 5. Units of measure — distinct types for distinct dimensions

The Mars Climate Orbiter was lost because one team used pounds-force-seconds and another used newton-seconds — a units mix-up. Newtypes prevent exactly this:

```rust
struct Meters(f64);
struct Feet(f64);

fn brake_distance(d: Meters) { /* ... */ }

let altitude = Feet(1000.0);
// brake_distance(altitude);  // ❌ compile error — can't pass Feet as Meters
```

You provide explicit conversions (`fn to_meters(Feet) -> Meters`) so the only way to mix units is to *convert on purpose*, visibly, in the code.

### 6. The `Validated<T>` / `Unvalidated<T>` tag

Sometimes you want to track validation *status* in the type without a separate domain type per field. Tag the data with a phantom marker:

```ts
type Validated<T>   = T & { readonly __validated: true };
type Unvalidated<T> = T & { readonly __validated: false };

function validate<T>(data: Unvalidated<T>): Validated<T> | null { /* ... */ }
function persist(form: Validated<SignupForm>) { /* ... */ }
//             ^ cannot be called with unvalidated data
```

A common concrete instance is `Sanitized<string>` vs `Raw<string>` — an API for rendering HTML or building SQL accepts only `Sanitized<string>`, so an un-escaped raw string is a compile error (an injection-prevention pattern explored more on the senior page).

### 7. Typed builders — required fields enforced at compile time

The classic builder lets you call `.build()` whenever you like, so forgetting a required field is a *runtime* error. A **typed builder** changes its return type as you set fields, so `build()` is only callable when everything required is present:

```ts
class RequestBuilder<HasUrl extends boolean, HasMethod extends boolean> {
  url(u: string): RequestBuilder<true, HasMethod> { /* ... */ }
  method(m: string): RequestBuilder<HasUrl, true> { /* ... */ }
  // build only exists when BOTH are true:
  build(this: RequestBuilder<true, true>): Request { /* ... */ }
}

new RequestBuilder().url("/x").method("GET").build();  // ✅
// new RequestBuilder().url("/x").build();             // ❌ method not set
```

The state of "which fields are set" lives in the type parameters, and `build()`'s `this` constraint makes it unreachable until they're all `true`. This is a gentle introduction to the *typestate* pattern, covered fully on the senior page.

### 8. Discriminated unions for messages and API responses

Sum types with a tag are the natural model for anything that's "one of several kinds": API responses, domain events, UI actions. The tag drives exhaustive handling, and adding a kind forces every handler to update.

```ts
type ApiResponse<T> =
  | { status: "ok"; data: T }
  | { status: "notFound" }
  | { status: "error"; code: number; message: string };
```

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Newtype** | Different-shaped plugs for different voltages. A 120V plug physically won't fit a 240V socket, even though both carry "electricity." |
| **Type alias (no safety)** | Writing "Order ID" on a sticky note attached to a plain number. Helpful label, but nothing stops you using it as a user ID. |
| **Smart constructor** | A coin-operated turnstile: the *only* way onto the platform is through the gate that checks your ticket. No ticket, no entry, no exceptions. |
| **Units of measure** | A recipe specifying "grams" vs "ounces" as different measuring cups that don't stack. You must convert deliberately. |
| **`Sanitized<string>`** | Food labeled "washed and ready to eat" vs "wash before use." The kitchen only accepts the washed kind into the salad. |
| **Typed builder** | A form that grays out the "Submit" button until every required field is filled. |
| **Discriminated union** | A package label: "fragile / perishable / hazardous" — exactly one category, and each routes to different handling. |
| **Branded type** | A hologram sticker on a product. The product *looks* identical to a counterfeit, but the brand mark proves provenance. |

---

## Mental Models

### The "primitives are too generous" model

A `string` is a promiscuous type — it'll be anything. Every time you accept a `string` parameter that *means* something specific (an email, an id, a path), you're trusting every caller to pass the right kind of string, with no enforcement. The newtype/brand move is: take the meaning out of your head and put it in the type, so the compiler enforces it for you. Ask of every primitive parameter: *"is this really 'any string', or is it a specific kind of string?"* If specific, give it a type.

### The "one door" model

For a value with rules (`Email`, `PositiveInt`, `NonEmptyList`), picture a building with exactly one entrance — the smart constructor — staffed by a guard who checks credentials. Every other wall is solid (private constructor). Once someone's inside, you *know* they passed the guard; you never re-check IDs in the hallways. The privacy of the raw constructor is what seals the other walls.

### The "type carries the proof" model

After parsing, the *type itself* is evidence. `Email` means "this string passed email validation." `Validated<Form>` means "this form satisfied its rules." `Sanitized<string>` means "this string is safe to interpolate." When you see one of these types in a signature, you can read off what's already guaranteed — no need to trace back through the code to find out whether it was checked. The type is a certificate.

---

## Code Examples

### Rust — newtype that prevents an id mix-up

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
struct UserId(u64);
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
struct ProductId(u64);

struct Db;
impl Db {
    fn user(&self, id: UserId) -> Option<String> { /* ... */ Some("alice".into()) }
    fn product(&self, id: ProductId) -> Option<String> { /* ... */ Some("book".into()) }
}

fn main() {
    let db = Db;
    let uid = UserId(7);
    let pid = ProductId(7);

    db.user(uid);       // ✅
    db.product(pid);    // ✅
    // db.user(pid);    // ❌ expected UserId, found ProductId — mix-up caught
}
```

The real bug this prevents: `db.user(order.product_id)` — both are `u64`, both happen to be `7`, the lookup "works" and returns the wrong record. With newtypes it never compiles.

### Rust — smart constructor for a validated value

```rust
pub struct NonEmptyString(String);   // field is private (no `pub`)

impl NonEmptyString {
    pub fn new(s: String) -> Option<NonEmptyString> {
        if s.trim().is_empty() { None } else { Some(NonEmptyString(s)) }
    }
    pub fn as_str(&self) -> &str { &self.0 }
}

fn greet(name: NonEmptyString) {
    println!("Hello, {}", name.as_str());  // guaranteed non-empty, no check
}
```

Outside this module you *cannot* write `NonEmptyString("".into())` — the field is private. The only door is `new`, which validates.

### TypeScript — branded type with a controlled mint

```ts
type Cents = number & { readonly __unit: "Cents" };
type Dollars = number & { readonly __unit: "Dollars" };

function cents(n: number): Cents { return n as Cents; }       // controlled mint
function dollarsToCents(d: Dollars): Cents { return cents(d * 100); }

function charge(amount: Cents) { /* ... */ }

const price = cents(1999);
charge(price);                 // ✅
// charge(1999);               // ❌ number is not Cents — forces you to mint
// charge(19.99 as Dollars);   // ❌ Dollars is not Cents — units don't mix
```

### TypeScript — Sanitized vs Raw string (injection prevention)

```ts
type Raw = string & { readonly __safety: "raw" };
type Sanitized = string & { readonly __safety: "sanitized" };

function escapeHtml(raw: Raw): Sanitized {
  const out = raw
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return out as Sanitized;
}

function renderToPage(html: Sanitized) { /* insert into DOM */ }

const userInput = "<script>alert(1)</script>" as Raw;
// renderToPage(userInput);                 // ❌ Raw is not Sanitized — XSS blocked
renderToPage(escapeHtml(userInput));        // ✅ must go through escaping
```

The escaping function is the *only* producer of `Sanitized`, so anything reaching `renderToPage` was escaped. You can't forget — the type won't let you.

### Haskell — smart constructor, module-enforced

```haskell
module Quantity (Quantity, mkQuantity, getQuantity) where

newtype Quantity = Quantity Int        -- constructor hidden

mkQuantity :: Int -> Either String Quantity
mkQuantity n
  | n < 0     = Left "quantity cannot be negative"
  | n > 10000 = Left "quantity exceeds maximum"
  | otherwise = Right (Quantity n)

getQuantity :: Quantity -> Int
getQuantity (Quantity n) = n
```

A `Quantity` in scope is *provably* in `[0, 10000]`. No function consuming it needs a bounds check.

### Kotlin — value class (zero-cost newtype)

```kotlin
@JvmInline
value class Email private constructor(val value: String) {
    companion object {
        fun of(raw: String): Email? =
            if (Regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$").matches(raw)) Email(raw) else null
    }
}

fun sendInvite(to: Email) { /* ... */ }

fun main() {
    val email = Email.of("alice@example.com") ?: return
    sendInvite(email)          // ✅
    // sendInvite("nope")      // ❌ String is not Email
}
```

`value class` compiles to the bare `String` at runtime — distinctness with no boxing.

### Swift — newtype via a struct wrapper with a failable init

```swift
struct Email {
    let value: String
    init?(_ raw: String) {                       // failable: returns nil on bad input
        guard raw.contains("@") else { return nil }
        self.value = raw
    }
}

func sendInvite(to: Email) { /* ... */ }

if let email = Email("alice@example.com") {
    sendInvite(to: email)      // ✅
}
```

### TypeScript — typed builder enforcing required fields

```ts
interface Config { host: string; port: number; tls: boolean }

class ConfigBuilder<H extends boolean, P extends boolean> {
  private cfg: Partial<Config> = {};
  host(h: string): ConfigBuilder<true, P> { this.cfg.host = h; return this as any; }
  port(p: number): ConfigBuilder<H, true> { this.cfg.port = p; return this as any; }
  tls(t: boolean): this { this.cfg.tls = t; return this; }
  build(this: ConfigBuilder<true, true>): Config {
    return { tls: false, ...this.cfg } as Config;
  }
}

new ConfigBuilder().host("db").port(5432).build();   // ✅
// new ConfigBuilder().host("db").build();           // ❌ port() not called
```

---

## Pros & Cons

| Aspect | Pros | Cons |
|--------|------|------|
| **Mix-up safety** | `UserId` vs `OrderId`, `Meters` vs `Feet` — wrong-argument bugs become compile errors. | Requires defining the wrapper types and the boilerplate to wrap/unwrap. |
| **Validity** | Smart constructors guarantee every value of the type is valid; downstream code drops defensive checks. | You must funnel construction through the factory; ad-hoc construction is disallowed (that's the point, but it's friction). |
| **Runtime cost** | Rust/Kotlin/Haskell newtypes and TS brands are zero-cost — erased to the underlying value. | Swift/Java struct wrappers may add an allocation; measure if hot. |
| **API clarity** | Signatures read like documentation: `charge(amount: Cents)`. | Over-newtyping (a type for every field) creates noise; needs judgment. |
| **Structural langs** | Branding gives TS the nominal distinctions it lacks. | Brands rely on `as` casts at the mint site — a small unsafe spot you must keep controlled. |
| **Builders** | Required fields enforced at compile time; no "forgot to set X" runtime errors. | Typed builders are more verbose and can confuse readers unfamiliar with the technique. |

---

## Use Cases

- **Identifiers:** `UserId`, `OrderId`, `TenantId` — anywhere two ids of the same primitive type coexist and could be swapped.
- **Validated domain values:** `Email`, `PhoneNumber`, `Url`, `PositiveInt`, `NonEmptyList`, `Percentage` — parse once via a smart constructor.
- **Units & money:** `Cents`/`Dollars`, `Meters`/`Feet`, `Seconds`/`Millis` — prevent dimension mix-ups and rounding disasters.
- **Security-tagged data:** `Sanitized<string>` vs `Raw<string>`, `Trusted` vs `Untrusted`, `Encrypted` vs `Plaintext` — make the unsafe value untypeable where safety is required.
- **Multi-field construction:** typed builders for HTTP requests, configs, query builders, where some fields are mandatory.
- **Protocol messages / events / API responses:** discriminated unions with exhaustive handling.

---

## Coding Patterns

### Pattern 1: newtype-per-id

Define a tiny distinct type for every id in your domain. In Rust a one-liner: `struct UserId(u64);`. The payoff scales with the number of id-typed parameters.

### Pattern 2: private constructor + validating factory

```rust
pub struct Slug(String);
impl Slug {
    pub fn parse(s: &str) -> Result<Slug, String> { /* validate */ Ok(Slug(s.into())) }
}
```

The factory name (`parse`, `try_from`, `of`, `mk*`) signals "this can fail."

### Pattern 3: smart-constructor + `TryFrom` / failable init

Idiomatic per language: Rust `TryFrom`, Swift `init?`, Kotlin `value class` with a `companion` factory, Haskell module-private constructor. Use the language's blessed mechanism so the safety reads naturally.

### Pattern 4: brand helper for structural languages

```ts
declare const brand: unique symbol;
type Brand<T, B> = T & { readonly [brand]: B };
```

Reuse one `Brand` helper across the codebase; mint only inside `parseX` functions.

### Pattern 5: tag validation status, not just identity

When you don't want a domain type per field, use `Validated<T>`/`Unvalidated<T>` (or `Checked`/`Unchecked`) so an API can demand the checked flavor.

---

## Best Practices

- **Newtype, don't alias, when safety matters.** A `type X = number` alias gives documentation but no protection. Reach for a real distinct type whenever two values could be confused.
- **Make the raw constructor private; expose only a validating factory.** This is what upgrades a newtype into a guaranteed-valid type. The privacy is load-bearing.
- **Mint branded values in exactly one place per type.** All `as Email` casts live inside `parseEmail`. Grep for the brand; if it appears outside the constructor, that's a leak.
- **Name the unsafe direction.** `Raw` / `Untrusted` / `Unvalidated` should be the type you get *from the outside*, and the safe type the one your core requires.
- **Provide explicit conversions for units, never implicit.** `feet.toMeters()` is fine; silent coercion defeats the purpose.
- **Keep wrappers thin and add `Deref`/accessors deliberately.** Decide what operations a `Cents` supports; don't auto-expose all `number` arithmetic if `Cents + Dollars` should be illegal.
- **Don't newtype everything.** A free-text `description: string` doesn't need a `Description` type. Reserve the technique for values with rules or confusion risk (the senior page covers this judgment).

---

## Edge Cases & Pitfalls

- **The alias illusion.** `type UserId = number` *feels* safe and gives nice signatures, but provides no checking. Many teams discover this only after a mix-up ships. Verify with a deliberate wrong-type call: it should *fail* to compile.
- **Brand leakage in TS.** A single stray `as Email` outside the constructor mints an unvalidated `Email`, silently breaking the guarantee. Lint for casts to branded types outside their parser.
- **Structural escape in TS.** Because TS is structural, two brands with the *same* `__brand` string collide. Use `unique symbol` brands or distinct string literals.
- **Over-deriving operations.** If `Cents` implements full `Add`/`Mul` with bare numbers, you can multiply two `Cents` together (giving nonsense `Cents²`). Decide which operations are meaningful and expose only those.
- **Forgetting to re-validate after mutation.** A smart constructor validates *at construction*. If the wrapper is mutable and you mutate the inner value, the invariant can break. Prefer immutable wrappers.
- **Newtype hashing/equality surprises.** In Rust, derive `PartialEq`/`Eq`/`Hash` on id newtypes or you can't use them as map keys. Easy to forget.
- **Serialization boundaries.** A `UserId(u64)` must serialize to/from JSON as a bare number, then be *re-parsed* on the way in — the wire is untyped. Don't trust deserialized data; route it through the smart constructor.
- **Builder `this` typing gotchas.** Typed builders often need `as any` internally (the runtime object is the same; only the *type* changes). Keep that cast confined to the builder methods, documented.

---

## Summary

- **Primitives are too generous:** `string` and `int` can't distinguish an email from a name or a user id from an order id, so the compiler can't stop mix-ups. The fix is to carve **distinct types** out of primitives.
- A **type alias** (`type UserId = number`) gives documentation but **no safety** — it's a synonym. A **newtype** (nominal languages) or **branded type** (structural languages like TS) gives a genuinely distinct type that prevents mix-ups, at zero runtime cost in most languages.
- A **smart constructor** — private raw constructor plus a validating factory — guarantees every value of the type is valid. There's "one door," so downstream code never re-checks. This is "parse, don't validate" enforced by the type's construction.
- **Units of measure** as newtypes (`Cents`/`Dollars`, `Meters`/`Feet`) prevent dimension disasters; provide explicit conversions only.
- **`Validated<T>`/`Sanitized<string>`** tag a value's safety status in the type, so APIs can demand the safe flavor and make the unsafe one a compile error (e.g. XSS/SQLi prevention).
- **Typed builders** enforce required fields at compile time by changing the return type as fields are set, so `build()` is unreachable until everything required is present.
- **Discriminated unions** model "one of several kinds" (API responses, events) with exhaustive handling.
- Judgment matters: **don't newtype everything.** Reserve the technique for values with rules or confusion risk. The senior page covers the full typestate pattern, phantom types, type-driven development, and when *not* to reach for cleverness.
