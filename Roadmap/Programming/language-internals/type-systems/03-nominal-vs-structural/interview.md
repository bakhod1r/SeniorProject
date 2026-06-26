# Nominal vs Structural Typing — Interview Questions

> **Topic:** [Nominal vs Structural Typing](README.md)

---

## Introduction

These questions probe whether a candidate understands *how a type system decides compatibility* — by declared name (nominal) or by shape (structural) — and the engineering consequences that follow: accidental conformance, the newtype/branding pattern, retroactive conformance, Rust's coherence and orphan rules, and where each model is sound or unsound.

A strong candidate distinguishes type *identity* from type *compatibility*, names which mainstream languages sit where (Java/C#/C++/Rust/Swift nominal; TypeScript/Go-interfaces/OCaml-objects/Scala-structural structural), and reasons about the *trade*: nominal gives intentionality, distinct types for same-shaped data, and controlled API evolution; structural gives flexibility, retroactive conformance, and easy mocking. A weaker candidate treats the two as interchangeable, can't explain why two same-shaped types might be incompatible, or thinks `type UserId = string` actually prevents passing a plain string. The questions go from concepts, to language-specific surfaces, to traps, to design.

## Table of Contents

- [Conceptual](#conceptual)
- [Language-Specific](#language-specific)
  - [Java / C# (Nominal)](#java--c-nominal)
  - [TypeScript / Go (Structural)](#typescript--go-structural)
  - [Scala](#scala)
  - [Rust Traits](#rust-traits)
- [Tricky / Trap Questions](#tricky--trap-questions)
- [Design Questions](#design-questions)

---

## Conceptual

## Question 1

**Q: Define nominal and structural typing in one sentence each, and give the key consequence of each.**

Nominal typing decides compatibility by the type's *name and declared relationships* (`extends`/`implements`/`impl`), so two structurally identical types with different names and no declared link are incompatible. Structural typing decides compatibility by the type's *shape* (its members), so any type with the required members fits, regardless of name or declaration. Key consequence of nominal: conformance is intentional — you cannot accidentally satisfy an interface, and same-shaped data can be kept as distinct types (`UserId` vs `OrderId`). Key consequence of structural: conformance is automatic and retroactive — a type written before an interface can satisfy it with no modification, which is flexible but allows *accidental* conformance.

## Question 2

**Q: A `Point2D{x,y}` and a `Vector2D{x,y}` have identical fields. Are they compatible? On what does it depend?**

It depends entirely on the type system. In a nominal language (Java, C#, Rust, Swift), they are **incompatible** — identical shape, different names, no declared relationship, so the compiler rejects assigning one to the other. In a structural language (TypeScript, OCaml objects), they are **interchangeable** — same shape means compatible. This single example is the cleanest demonstration of the distinction.

## Question 3

**Q: What is the relationship between structural typing and duck typing?**

Duck typing is the *dynamic*, runtime-checked version of the same shape-based philosophy: "if it has the method, call it," verified only when the operation actually executes (Python, Ruby). Structural typing is essentially "duck typing checked at compile time" — the compiler proves the required members exist before the program runs, so the failure moves from a runtime crash to a compile error. Both ask "does it have the right shape?"; they differ in *when* the question is answered.

## Question 4

**Q: What is retroactive conformance and which model gives it for free?**

Retroactive conformance is a type satisfying an interface that was defined *after* the type, without modifying the type. Structural typing gives this for free: define an interface today, and any existing type with the matching shape already satisfies it. Nominal typing does not — the type would need its declaration edited (or an adapter/wrapper) to add `implements`. This is why Go's `io.Reader` can be satisfied by types that predate it, and why adapting a third-party class to your interface in Java requires a wrapper.

## Question 5

**Q: What is the newtype pattern and what problem does it solve?**

The newtype pattern wraps an existing representation in a *distinct named type* so the compiler treats semantically different values as incompatible even though they share a layout — e.g. `UserId(u64)` and `ProductId(u64)`, or `Meters(f64)` and `Feet(f64)`. It solves the "same representation, different meaning" bug class: passing a product ID where a user ID is expected, or adding meters to feet. In nominal languages it's a tuple struct (Rust) or `newtype` (Haskell); in structural TypeScript it's emulated with branded types.

## Question 6

**Q: Name the trade-offs of nominal vs structural typing.**

Nominal — pros: intentional conformance (no accidents), distinct types for same shapes, clearer error messages ("X does not implement Y"), controlled API evolution (implementers must opt in). Cons: boilerplate declarations, no retroactive conformance, harder mocking/interop. Structural — pros: flexibility, less boilerplate, retroactive conformance, trivial mocking, great for data shapes. Cons: accidental conformance, same-shape confusion (aliases don't separate meaning), murkier errors, refactors silently change who conforms.

## Question 7

**Q: Is type compatibility the same as type identity?**

No. *Identity* is "are these the same type?"; *compatibility* (subtyping) is "can a value of one be used where the other is expected?" In nominal systems both are name-based and identity is an O(1) pointer comparison. In structural systems, identity itself is structural — two differently-named but identically-shaped types may be considered the same for compatibility purposes — and the check is a recursive member comparison rather than a pointer equality.

---

## Language-Specific

### Java / C# (Nominal)

## Question 8

**Q: In Java, a class has a method matching an interface exactly but doesn't declare `implements`. Can you assign it to the interface type?**

No. Java is nominal: without an explicit `implements` declaration, the class does not satisfy the interface no matter how perfectly its methods match. The assignment is a compile error, and even a cast is unsound and rejected unless a declared relationship exists. The method matching is irrelevant; the declaration is the contract.

## Question 9

**Q: How do you get "distinct types for the same representation" in Java/C#, given they're nominal but lack cheap newtypes?**

You wrap the value in a small class/record/struct: `record UserId(long value)` in Java, `readonly record struct UserId(long Value)` in C#. These are distinct nominal types, so `UserId` and `OrderId` can't be swapped. The cost is allocation/indirection (mitigated by records and value structs) and unwrapping at use sites; the benefit is compile-time prevention of ID mix-ups. C# also has `enum` for closed sets and can use value structs to avoid heap allocation.

## Question 10

**Q: C# interfaces are nominal, but C# also has structural-ish features. Name one.**

C# `dynamic` defers binding to runtime (duck typing). More relevantly, C# anonymous types and tuples are compared structurally, and `in`/`out` variance annotations on generic interfaces add structural-style flexibility on top of nominal interfaces. But interface *conformance* itself remains strictly nominal — a class must declare `: IFoo`.

### TypeScript / Go (Structural)

## Question 11

**Q: Explain Go's implicit interface satisfaction.**

In Go there is no `implements` keyword. A type satisfies an interface automatically if its method set includes all the interface's methods with matching signatures. You define `type Stringer interface { String() string }` and any type with a `String() string` method satisfies it — no declaration, no coupling between the type and the interface. This is the canonical structural example; it enables retroactive conformance and decoupled package design (the consumer defines the interface, the producer just has methods).

## Question 12

**Q: In Go, a method is defined on `*T` (pointer receiver). Can a `T` value satisfy an interface requiring that method?**

No. A pointer-receiver method is only in the method set of `*T`, not `T`. So a `T` *value* does not satisfy the interface; you need `*T` (e.g. `&t`). A value-receiver method, by contrast, is in the method set of both `T` and `*T`. This is a frequent source of "X does not implement Y (method has pointer receiver)" errors. Structural satisfaction compares the *method set*, and the method set depends on value vs pointer.

## Question 13

**Q: TypeScript is structural. Why does this fail: `plot({ x: 1, y: 2, z: 3 })` for `plot(p: {x:number; y:number})`, while a variable with the same fields succeeds?**

The **excess property check**. TypeScript normally allows width subtyping (a value with extra fields is assignable), so a *variable* holding `{x, y, z}` is fine. But when you pass an *object literal directly*, TS applies a stricter check and rejects unlisted properties, on the heuristic that an extra field in a fresh literal is probably a typo (a misspelled or wrong property). Assigning the literal to a variable first, or using a type assertion, bypasses it.

## Question 14

**Q: How do you simulate nominal typing in TypeScript? Show the idea.**

Branded (opaque) types: intersect the base type with a phantom marker property that exists only at compile time.

```typescript
type UserId = string & { readonly __brand: "UserId" };
type OrderId = string & { readonly __brand: "OrderId" };
const asUserId = (s: string): UserId => s as UserId;
```

Now `UserId` and `OrderId` are structurally distinct (different brand fields), so they're not interchangeable and neither accepts a plain `string`. The brand is erased at runtime — a `UserId` *is* a string — so you validate at the boundary and mint only through a controlled constructor.

### Scala

## Question 15

**Q: Scala classes are nominal, but Scala has structural types. What are they and what's the catch?**

Scala lets you write a structural refinement type like `def use(r: { def close(): Unit })`, accepting any value that *structurally* has a `close(): Unit` method regardless of its declared type. The catch on the JVM is that these calls are dispatched via **reflection**, which is slower and has access/security caveats, so they're discouraged on hot paths. Scala thus offers a nominal core with an opt-in structural escape hatch — a hybrid.

### Rust Traits

## Question 16

**Q: Are Rust traits nominal or structural? Justify.**

Nominal. A type participates in a trait only via an explicit `impl Trait for Type`; having matching method signatures is not enough. This is the opposite of Go interfaces. The nominal nature is what enables Rust's **coherence** guarantee — at most one `impl` of a given trait for a given type across the whole program — which structural conformance fundamentally cannot provide.

## Question 17

**Q: What is the orphan rule and why does it exist?**

The orphan rule says you may write `impl Trait for Type` only if your crate defines the `Trait` or defines the `Type`. It exists to enforce **coherence**: if any crate could implement any trait for any type, two different crates could both implement the same trait for the same type, and there'd be no single canonical implementation — breaking unambiguous method resolution. The orphan rule guarantees globally that there's at most one impl per (trait, type) pair.

## Question 18

**Q: You need to implement a foreign trait for a foreign type, but the orphan rule forbids it. What do you do?**

Use the **newtype workaround**: wrap the foreign type in a tuple struct your crate owns, then implement the foreign trait on your wrapper (which you're allowed to, because you own the wrapper). Add `Deref`/`From` conversions for ergonomics. This is the same newtype mechanism used for ID safety, repurposed to legally re-home a trait impl.

---

## Tricky / Trap Questions

## Question 19

**Q: Does `type UserId = string` in TypeScript prevent passing a plain string where a `UserId` is expected?**

No — this is a trap. `type UserId = string` is a type *alias*, just a nickname for `string`; it creates no new type. A `UserId` and a `string` are identical, and any string passes wherever a `UserId` is expected. It documents intent but provides *zero* safety. To actually separate them you need a branded type (`string & { __brand: "UserId" }`) or a wrapper. Many engineers mistakenly believe the alias adds protection.

## Question 20

**Q: In Go, a struct accidentally gains a `Close() error` method for unrelated reasons. What can go wrong?**

It now *silently* satisfies `io.Closer` and any other interface requiring exactly that method. Code paths that type-switch or accept `io.Closer` will treat it as closeable, possibly calling `Close()` at unexpected times — accidental conformance with no compiler warning, because structural satisfaction has no declaration to check. The nominal equivalent could never happen without an explicit `implements`. The mitigation is awareness plus deliberate interface design.

## Question 21

**Q: Two TypeScript interfaces `A { f(): void }` and `B { f(): void }` are identical. Is a value of `A` assignable to `B`? Is that "nominal leakage"?**

It is fully assignable in both directions — TS is structural, so identical shapes are interchangeable, and the names `A` and `B` carry no weight. There's no nominal leakage; the names are purely for human readability. A candidate who says "no, they're different interfaces" has the wrong mental model.

## Question 22

**Q: Trap: "Structural typing means no type safety / it's just dynamic typing." True?**

False. Structural typing is *static* — the compiler still checks every member at compile time; it just uses shape instead of name to decide compatibility. TypeScript and Go catch shape mismatches before running. The dynamic, runtime-checked relative is *duck typing*. Conflating structural typing with dynamic typing is a common misconception.

## Question 23

**Q: Is `Array<Dog>` assignable to `Array<Animal>` in TypeScript? Is that sound?**

Yes, it's assignable — TypeScript arrays are covariant. But it's **unsound**: through the `Array<Animal>` alias you could write a `Cat` into what's really a `Dog` array, and TS won't catch it (no runtime check either, unlike Java which throws `ArrayStoreException`). TypeScript accepts this unsoundness deliberately for ergonomics. A senior candidate flags the soundness hole, not just the assignability.

## Question 24

**Q: Trap: a branded `UserId` guarantees the value was validated at runtime. True?**

False. Brands are *erased* at compile time — at runtime a `UserId` is an ordinary string. The brand prevents *type-level* mix-ups but performs no runtime check; a malformed string cast with `as UserId` (or arriving via `JSON.parse`) is a `UserId` as far as the type system knows. You must validate at the boundary, ideally inside the single smart constructor that mints the brand.

---

## Design Questions

## Question 25

**Q: Design the ID strategy for a payments service in TypeScript where `UserId`, `MerchantId`, and `TransactionId` are all strings. How do you prevent mix-ups?**

Use branded types with a single mint module: `type UserId = string & {__brand:"UserId"}` etc., each with a smart constructor (`UserId(s: string): UserId`) that validates format and is the *only* place the brand is applied. Brand at the boundaries — DB row mapping, HTTP request decoding — so values are minted once where data enters; let inference carry brands inward. Add a lint rule forbidding raw `as UserId` casts outside the mint module so brands can't be forged. The compile errors surfaced during rollout are exactly the latent swap bugs. Migrate via expand/contract, not a flag day.

## Question 26

**Q: You're designing a plugin boundary. Would you choose nominal or structural conformance, and why?**

It depends on the property you need. For *interop and easy third-party/mock implementations*, prefer structural (Go-style capability interface): plugins conform by having the right methods, with no coupling, and tests use trivial mocks. For a *stable, evolvable public contract* where you want implementers to opt in explicitly and breakage to be a loud compile error, prefer nominal. A common hybrid: small structural capability interface at the seam, nominal domain types passed across it. Articulating the trade-off (retroactive conformance vs intentional, evolvable contracts) is the point.

## Question 27

**Q: Your team relies on Go's structural interfaces but keeps shipping bugs where the wrong concrete type satisfies an interface unintentionally. What do you do?**

Tighten the structural surface. Make interfaces small and *semantically named* so accidental matches are unlikely; add marker methods or unexported method requirements (a private method in the interface) so only types in your package can satisfy it — a deliberate way to recover nominal-style intentionality in Go. Pin intended conformance with `var _ Iface = (*T)(nil)` so drift is a compile error. Where two distinct concepts share a method shape, give them distinct method names so they can't cross-satisfy.

## Question 28

**Q: When would you accept the unsoundness of structural typing (e.g. TS covariant arrays, bivariant method params) rather than fight it?**

When the ergonomic gain outweighs the realistic risk and the unsound pattern is read-mostly. Covariant arrays are convenient and rarely mutated through an up-cast alias in practice; demanding full invariance would make everyday code painful. The discipline is to *know* the hole exists, avoid mutating through up-cast aliases, enable `strictFunctionTypes` where it helps, and reserve invariant/branded types for the places where a swap or illegal write would be catastrophic (financial data, security tokens). You spend safety budget where the blast radius is largest.

## Question 29

**Q: How does the choice of nominal vs structural affect type-check/build performance at scale?**

Nominal identity is a pointer comparison and subtype tests are short ancestry walks, so type-checking stays cheap. Structural compatibility is a recursive member comparison that must be memoized (and made coinductive for recursive types) to terminate and stay tractable; in large structural codebases (big TS monorepos) the assignability relation dominates `tsc` time, and pathological types (huge unions, deep conditional/mapped/recursive generics) defeat the cache and cause slow builds or "excessively deep" errors. Mitigate by naming/reusing types, capping generic depth, preferring interfaces, and using incremental/project builds. This performance asymmetry is an underrated factor in language and design choices.

## Question 30

**Q: Coherence vs retroactive conformance — can a system give you both? What does that imply for design?**

No — they're mutually exclusive. Global coherence (Rust/Haskell: exactly one canonical impl per trait/type, enforced by the orphan rule) requires that conformance be controlled and never implicit; unrestricted retroactive conformance (Go/structural: any matching type conforms automatically) means there's no single canonical way a type "is" an interface. Implication: pick per boundary. Use coherent-nominal where you need reliable canonical dispatch and algebraic laws (typeclass-style abstractions); use structural where you need frictionless interop and mocking. Don't expect one boundary to deliver both.
