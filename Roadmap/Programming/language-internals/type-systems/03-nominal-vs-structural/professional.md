# Nominal vs Structural Typing — Professional Level

> **Topic:** [Nominal vs Structural Typing](README.md)
> **Focus:** Engineering decisions in long-lived systems — Rust traits with coherence/orphan rules, hybrid type-system design, branding strategy at scale, migration paths, and choosing nominal-vs-structural (and where) as an architectural lever rather than a language accident.

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

> Focus: **You own a codebase that will live for years. Where do you put nominal boundaries, where do you exploit structural flexibility, and how do you keep both sound, fast, and evolvable as teams and dependencies change?**

The previous tiers established the theory. The professional question is *governance*: a type system is a contract enforcement mechanism, and nominal vs structural decides whether your contracts are *enforced by name* (deliberate, auditable, evolvable) or *satisfied by shape* (flexible, retroactive, accidental). At scale this is not a language footnote — it determines whether a 3 a.m. incident is "the compiler caught it in CI" or "we passed an `OrderId` where a `UserId` was expected and refunded the wrong account."

Three forces dominate at this level. First, **Rust traits** are the most instructive nominal interface system in mainstream use: explicit `impl Trait for Type`, plus **coherence** and the **orphan rule** that guarantee at most one canonical implementation globally — a property structural systems fundamentally cannot offer, and the reason Rust can do typeclass-style dispatch without ambiguity. Second, **hybrid design**: every serious language mixes the models (Go structural interfaces + nominal named types; TypeScript structural + branded nominal escape hatches; Scala nominal classes + structural refinement types), and the engineering skill is placing each boundary deliberately. Third, **migration and branding strategy**: how you introduce nominal IDs into a structural codebase without a big-bang rewrite, and how you keep structural type-checking fast in a million-line monorepo.

> 🎓 **Why this matters at the professional level:** You set the conventions a team follows for years and you answer for the production consequences. "Use a branded `UserId` everywhere" or "rely on Go's structural interfaces for the plugin boundary" are architecture decisions with cost, ergonomics, and failure-mode implications. You must justify them, migrate to them incrementally, and know precisely which guarantees each gives — including the ones (coherence, opacity, retroactive conformance) that are mutually exclusive.

This page covers: Rust trait coherence/orphan rules and the newtype workaround, designing hybrid boundaries, branding/newtype strategy and migration at scale, performance of structural checking in large builds, and a decision framework for choosing the model per boundary.

---

## Prerequisites

- **Required:** Senior-tier theory — variance, row polymorphism, coinductive structural checking, implementation cost models, opacity.
- **Required:** Real experience shipping and evolving a typed codebase (API versioning, breaking-change management).
- **Helpful:** Rust trait experience, or having maintained a large TypeScript or Go codebase.
- **Helpful:** Familiarity with build-time type-check performance pain (slow `tsc`, large generic graphs).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Trait (Rust)** | A nominal interface; a type participates only via an explicit `impl Trait for Type`. |
| **Coherence** | The guarantee that there is at most **one** implementation of a given trait for a given type across the whole program. |
| **Orphan rule** | Coherence's enforcement mechanism: you may `impl Trait for Type` only if your crate owns the trait or the type. |
| **Newtype workaround** | Wrapping a foreign type to legally implement a foreign trait without violating the orphan rule. |
| **Refinement type (Scala)** | A nominal type narrowed by an inline structural requirement (`A { def f(): Int }`). |
| **Brand discipline** | A codebase-wide convention for where and how branded/newtype values are minted and consumed. |
| **Boundary type** | A type that sits at a module/service/API edge where you choose nominal (enforced contract) vs structural (flexible interop). |
| **Type-relation cache** | A compiler structure memoizing structural subtype results to keep large builds tractable. |
| **Expand/contract migration** | Introducing a new (e.g. branded) type alongside the old, migrating consumers, then removing the old — without a flag day. |
| **Capability interface** | A small structural interface describing one ability (Go's `io.Reader`), maximizing retroactive conformance. |

---

## Core Concepts

### 1. Rust Traits: Nominal Conformance with Global Coherence

Rust traits are nominal — a type implements a trait only via explicit `impl`:

```rust
trait Summary { fn summarize(&self) -> String; }

struct Article { title: String }
impl Summary for Article {            // explicit, nominal conformance
    fn summarize(&self) -> String { self.title.clone() }
}
```

The decisive extra property is **coherence**: for any (trait, type) pair there is *at most one* `impl` in the entire program. This is what lets `x.summarize()` resolve unambiguously and lets generic code `fn f<T: Summary>(t: T)` rely on a single canonical behavior. Structural systems cannot promise this — if conformance is "having the right shape," a type can "be a `Monoid`" in two incompatible ways and nobody can pick the canonical one.

Coherence is enforced by the **orphan rule**: you may write `impl Trait for Type` only if *your crate defines `Trait`* or *your crate defines `Type`*. You cannot, in your crate, implement someone else's trait for someone else's type — because two different crates could then both do it, breaking the single-impl guarantee globally.

### 2. The Newtype Workaround for the Orphan Rule

The orphan rule blocks `impl ForeignTrait for ForeignType`. The standard escape is — again — the **newtype pattern**: wrap the foreign type in your own type, which you *do* own, then implement the trait on the wrapper:

```rust
use std::fmt;

// We want Display for Vec<String>, but both are foreign → orphan rule forbids it.
struct Wrapper(Vec<String>);          // OUR type now

impl fmt::Display for Wrapper {        // legal: we own Wrapper
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "[{}]", self.0.join(", "))
    }
}
```

Here the newtype is not for ID safety but to *legally re-home a trait impl*. Same mechanism, different purpose — a sign of how central newtypes are to nominal systems.

### 3. Coherence Is the Trade for Retroactive Conformance

There is a fundamental tension a senior architect must internalize: **global coherence and unrestricted retroactive conformance are mutually exclusive.**

- Go/structural: any type retroactively satisfies any matching interface → maximal flexibility, *no* coherence (a type can match two interfaces with the same method differently — there's nothing canonical).
- Rust/coherent-nominal: one canonical impl per (trait, type) → reliable dispatch and laws, but you *cannot* freely add impls for foreign type+trait pairs (orphan rule), and conformance is never implicit.

You cannot have both. Choosing a language — or designing a boundary — is choosing a point on this spectrum. Haskell sits near Rust (coherence, with the same orphan-instance hazards); TypeScript sits near Go (structural) with branding as a manual opt-out.

### 4. Hybrid System Design: Place Each Boundary Deliberately

Real architectures mix models *on purpose*:

- **Structural at integration seams.** Where you want unrelated components or third-party types to interoperate, use small structural/capability interfaces (Go `io.Reader`, a TS `{ log(msg): void }` logger port). Retroactive conformance is the feature.
- **Nominal at domain boundaries.** Where confusing two values is a costly bug, use newtypes/branded types and nominal opacity (`UserId`, `Money`, `JwtToken`). Enforced distinctness is the feature.
- **Nominal for evolvable public contracts.** Where you must evolve a published interface deliberately, prefer nominal so implementers opt in and breakage is a compile error, not silent shape drift.

The skill is recognizing which property each boundary needs and not defaulting to whatever the language makes easiest.

### 5. Branding Strategy and Migration at Scale

Introducing nominal IDs into a large structural (TypeScript) codebase is an **expand/contract** migration, not a flag day:

1. Define branded types and *smart constructors* (the only mint points).
2. Brand at the **boundaries first** (DB rows, HTTP deserialization, message decoders) so values are minted once where data enters.
3. Let inference propagate the brands inward; fix the compile errors the brands surface — *those errors are the latent bugs.*
4. Forbid raw `as`-casts outside the constructor module (lint rule) so the brand can't be forged casually.
5. Contract: remove the old un-branded signatures once consumers compile.

Done this way, branding pays for itself: each newly-surfaced error is a place the old code could have swapped IDs.

### 6. Performance of Structural Checking in Big Builds

Structural type-checking cost is real engineering at scale. In large TypeScript monorepos, `tsc` spends much of its time computing the assignability relation over deep generic graphs; the compiler memoizes relation results, but pathological types (huge unions, deeply nested conditional/mapped types, recursive instantiations) defeat the cache and cause multi-minute checks or "type instantiation is excessively deep" errors. Mitigations: name and reuse types (so they memoize), cap generic depth, prefer interfaces (which TS caches better than large anonymous intersections), and use project references/incremental builds. Nominal systems sidestep most of this — identity is a pointer — which is one underrated reason nominal languages often type-check faster on equivalent designs.

---

## Real-World Analogies

**Coherence = one official adapter per device.** Imagine a standard guaranteeing exactly one certified power adapter per device model worldwide. Plug anything in and behavior is predictable. Structural "any plug that fits" loses that guarantee — two different "fitting" plugs might behave differently.

**Orphan rule = you can only certify what you own.** You may issue safety certifications for *your* product or for *your* standard — not certify someone else's product against someone else's standard, because two issuers would conflict.

**Newtype workaround = relabeling to gain authority.** To certify a third-party part, you incorporate it into *your* assembly and certify the assembly — now it's yours to vouch for.

**Branding migration = adding serial numbers at intake.** You start stamping serial numbers on items as they enter the warehouse (the boundary), and gradually every downstream process learns to require the serial — mix-ups vanish without halting operations.

---

## Mental Models

**Model 1 — "Coherence vs. flexibility is a dial, not a feature."** Every boundary picks a point. Maximal retroactive conformance (structural) and global coherence (nominal) are opposite ends; you can't have both at the same boundary.

**Model 2 — "Newtype is the universal lever in nominal systems."** It separates same-shaped meanings, re-homes foreign trait impls (orphan rule), and creates opaque evolvable types. When in doubt in a nominal language, a newtype is often the answer.

**Model 3 — "Brand at the door, trust inside."** Mint nominal values once at system boundaries; the interior then has compile-time guarantees with no per-call validation.

**Model 4 — "Type-check time is a budget."** Structural flexibility has a build-time cost. Treat the type-relation cache like any other hot cache: feed it named, reusable types; don't thrash it with anonymous mega-types.

---

## Code Examples

### Coherence enables unambiguous generic dispatch (Rust)

```rust
trait ToJson { fn to_json(&self) -> String; }

impl ToJson for i32 { fn to_json(&self) -> String { self.to_string() } }
// Exactly ONE impl of ToJson for i32 may exist program-wide (coherence).

fn dump<T: ToJson>(x: T) -> String { x.to_json() }  // resolves canonically
```

If two crates could each define `ToJson for i32`, `dump` would be ambiguous — the orphan rule prevents that.

### Orphan-rule violation and the newtype fix (Rust)

```rust
// ❌ Not allowed: both serde::Serialize-like trait and Vec are foreign.
// impl ForeignTrait for Vec<u8> { ... }   // E0117 orphan rule

// ✅ Wrap it:
struct Bytes(Vec<u8>);
impl std::fmt::Display for Bytes {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        write!(f, "{} bytes", self.0.len())
    }
}
```

### Branding discipline with a single mint point (TypeScript)

```typescript
// ids.ts — the ONLY place brands are minted
declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };
export type UserId  = Brand<string, "UserId">;
export type OrderId = Brand<string, "OrderId">;

// Mint only after validation, only here:
export const UserId  = (s: string): UserId  => s as UserId;
export const OrderId = (s: string): OrderId => s as OrderId;

// elsewhere.ts
function refund(user: UserId, order: OrderId) { /* ... */ }
declare const o: OrderId;
declare const u: UserId;
refund(u, o);          // ✅
// refund(o, u);       // ❌ swapped — caught at compile time
```

A lint rule banning `as UserId`/`as OrderId` outside `ids.ts` keeps the brand unforgeable.

### Hybrid boundary in Go: structural port, nominal domain type

```go
// Structural capability interface at the seam — anything that can store fits.
type Store interface {
    Get(id UserID) ([]byte, error)
    Put(id UserID, v []byte) error
}

// Nominal domain type so IDs can't be confused with raw strings or OrderIDs.
type UserID string
type OrderID string

func handle(s Store, u UserID) { /* s is any conforming impl; u is a distinct type */ }
```

`Store` is structural (mock it trivially in tests, swap implementations freely); `UserID`/`OrderID` are nominal named types (distinct, non-interchangeable).

### Scala refinement type: nominal base + structural narrowing

```scala
// Accepts any Resource that ALSO structurally has a close(): Unit method.
def use(r: Resource { def close(): Unit }): Unit = {
  try r.work() finally r.close()
}
```

A pragmatic hybrid: nominal `Resource` plus an inline structural requirement (reflective-call caveats apply on the JVM).

---

## Pros & Cons

### Designing with nominal boundaries

| Pros | Cons |
|------|------|
| Coherence: one canonical conformance → reliable dispatch & laws. | Orphan rule blocks foreign+foreign impls; needs newtype wrappers. |
| Opacity → safe representation evolution. | More ceremony; explicit impls everywhere. |
| Confusion bugs (ID/unit swaps) caught at compile time. | Mocking/interop need adapters or generics. |
| Breaking changes surface as compile errors. | Steeper for ad-hoc/data-shaped code. |

### Designing with structural boundaries

| Pros | Cons |
|------|------|
| Retroactive conformance → instant interop, easy mocks. | No coherence; "two ways to be an X" is unresolvable. |
| Minimal boilerplate at integration seams. | Accidental conformance & same-shape confusion. |
| Great for JSON/config/ports-and-adapters. | Representation is the contract → harder evolution. |
| Capability interfaces compose freely. | Type-check cost grows; large builds need cache discipline. |

---

## Use Cases

- **Plugin/port boundaries:** structural capability interfaces (Go `io.*`, a TS port interface) so implementers and mocks conform without coupling.
- **Money, IDs, tokens, units:** nominal newtypes/brands so a swap is a compile error; mint at the boundary, trust inside.
- **Re-homing foreign trait impls (Rust):** newtype wrapper to satisfy the orphan rule.
- **Public, versioned contracts:** nominal interfaces so consumers opt in and breakage is loud.
- **Large monorepo build health:** structural-typing performance tuning (named types, project references, depth caps).

---

## Coding Patterns

**Pattern: single mint point + lint guard.** All brand/newtype values are created in one module; a lint rule forbids casts elsewhere. The brand becomes unforgeable.

**Pattern: brand at the boundary.** Mint nominal values during deserialization/DB reads; let inference carry them inward and surface latent swap bugs as errors.

**Pattern: newtype-to-bridge.** In Rust, wrap foreign types to implement foreign traits legally; expose ergonomic `Deref`/`From` so the wrapper is pleasant to use.

**Pattern: structural seams, nominal core.** Ports are small structural interfaces; the domain interior uses nominal types and opacity.

**Pattern: compile-time conformance pins (Go).** `var _ Store = (*PostgresStore)(nil)` so evolving `Store` breaks loudly at the implementation.

---

## Best Practices

1. **Choose the model per boundary, not per codebase.** Structural at seams; nominal at domain and public contracts.
2. **Default IDs/units/tokens to nominal.** The ergonomic tax is far cheaper than a production mix-up.
3. **Centralize minting; forbid ad-hoc casts.** A brand that anyone can forge isn't a guarantee.
4. **Respect and exploit the orphan rule.** Reach for the newtype wrapper instead of fighting coherence.
5. **Know that coherence and retroactive conformance can't coexist** at one boundary; pick consciously.
6. **Budget type-check time.** In large structural builds, name/reuse types, cap generic depth, use incremental/project builds, prefer interfaces over giant intersections.
7. **Migrate with expand/contract.** Introduce branded types alongside the old, brand at boundaries, fix surfaced errors, then remove the old signatures.
8. **Pin conformance** (`var _ Iface = ...`) so structural drift becomes a compile error.

---

## Edge Cases & Pitfalls

**1. Orphan-rule surprises in libraries.** You can't implement a third-party trait for a third-party type; downstream users hit `E0117`. Provide newtype wrappers or feature-gated impls in *your* crate so they don't have to.

**2. Coherence breakage via overlapping/blanket impls.** Two crates each adding a "harmless" blanket impl can collide; semver-breaking coherence conflicts are a known Rust ecosystem hazard. Be conservative with blanket impls in public crates.

**3. Forged brands.** A stray `value as UserId` deep in the code silently defeats branding. Without a lint guard, brand discipline erodes over time and the guarantee quietly disappears.

**4. Brands are erased — no runtime safety.** A branded `UserId` is a plain string at runtime; serialization, reflection, and `JSON.parse` all bypass it. Validate at the boundary; never assume the brand checks anything dynamically.

**5. Structural mock drift.** A hand-rolled structural mock satisfies the interface *today*; when the real interface gains a method, the mock may still compile in some languages (or silently diverge), hiding the gap. Pin conformance and prefer generated mocks.

**6. Type-check blowups.** Deeply recursive generics or huge unions defeat the relation cache and stall builds or trip depth limits. This is a *design* smell, not just a compiler quirk — flatten and name the types.

**7. Refinement/structural types on the JVM use reflection.** Scala structural refinement calls compile to reflective dispatch with performance and security caveats; don't use them on hot paths.

**8. Hybrid leaks.** A nominal opaque type can leak its base type through inference, `typeof`, or an over-eager `Deref`/implicit conversion, silently re-exposing the representation you meant to hide. Verify the boundary actually seals.

---

## Summary

- **Rust traits** are nominal interfaces whose distinguishing power is **coherence** (≤1 impl per trait/type program-wide), enforced by the **orphan rule** (impl only if you own the trait or the type). The **newtype workaround** legally re-homes foreign trait impls.
- **Coherence and unrestricted retroactive conformance are mutually exclusive.** Structural (Go/TS) buys interop and easy mocks but no coherence; coherent-nominal (Rust/Haskell) buys canonical dispatch and laws but forbids implicit/foreign conformance. Choose the point per boundary.
- **Hybrid design is the norm:** structural capability interfaces at integration seams, nominal newtypes/brands at domain boundaries and public contracts, with opacity for evolvability.
- **Branding at scale** is an expand/contract migration: define brands + smart constructors, mint at boundaries, fix the surfaced errors (your latent swap bugs), lint against ad-hoc casts, then contract.
- **Performance:** structural type-checking cost is real in large builds; feed the relation cache named/reusable types, cap generic depth, use incremental builds. Nominal identity is a pointer and largely sidesteps this.
- The professional lens treats nominal-vs-structural as an **architectural lever** for contract enforcement, evolvability, and failure modes — not a fixed property of your language.
