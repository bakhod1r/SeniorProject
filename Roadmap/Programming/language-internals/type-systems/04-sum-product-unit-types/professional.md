# Sum, Product & Unit Types — Professional Level

> **Topic:** [Sum, Product & Unit Types](README.md)
> **Focus:** How compilers actually implement ADTs — discriminant encoding, niche/payload packing, GADTs and indexed sums, the category theory that makes folds principled, and the cross-language ABI/representation reality that bites you at scale.

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
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [What You Can Build](#what-you-can-build)
17. [Further Reading](#further-reading)

---

## Introduction

> Focus: **The implementation, the theory underneath, and the seams.** A professional understands ADTs from three angles at once — the bytes the compiler emits, the category theory that says *why* the design is canonical, and the brutal practical reality of moving these types across language and version boundaries.

This page assumes you can already design with sums and products fluently and you've internalized the algebra and the architecture. Here we go down to where it gets interesting and where the abstractions leak:

- **Representation engineering.** Exactly how a discriminant is encoded; how niche/payload optimization is computed; arity-0 vs arity-N variants; layout guarantees (and the lack of them); how `Option`, `Result`, and enums-of-pointers compile down to almost nothing.
- **GADTs and indexed sums.** When the *variant you matched* refines a *type variable* — the leap from "sum of types" to "sum where each case carries a type equation." This is how you build a well-typed AST evaluator with no runtime type errors, and it's where ADTs touch dependent types.
- **The category theory, used not worshipped.** Sums are coproducts, products are products, Unit is the terminal object, Void is the initial object, function types are exponentials — and an ADT is the *initial algebra of a polynomial functor*. This isn't decoration: it's *why* the fold is unique, *why* deriving `map`/`fold`/`traverse` is mechanical, and *why* the algebra of types is sound.
- **Cross-boundary reality.** ABI stability, FFI, serialization, schema evolution, and versioning. The moment a sum type crosses a process, a wire, or a release boundary, "tagged union" becomes a tag-compatibility problem, and the elegant closed-world exhaustiveness becomes an open-world forward/backward-compatibility problem.

> 🎓 **Why this matters at the professional level:** At this depth you're the person who decides the on-disk format, the FFI contract, the compiler flag, or the schema-evolution policy. Those decisions are where the clean theory meets memory layout, ABI, and version skew — and getting them wrong corrupts data, breaks rollbacks, and creates undefined behavior. You're also the person who can say *why* a design is canonical (initial algebra) rather than merely *that it works*.

---

## Prerequisites

- **Required:** Junior/middle/senior pages — algebra, layout basics, the expression problem, illegal-states methodology.
- **Required:** Working knowledge of generics/parametric polymorphism, traits/typeclasses, and at least one language with native sums *and* one without.
- **Required:** Comfort reading about memory layout, alignment, and pointers; some exposure to an IR or assembly is helpful.
- **Helpful:** Any prior contact with serialization formats (protobuf, JSON, bincode) and schema evolution.
- **Helpful:** Loose familiarity with the words *functor*, *initial object*, *coproduct* — we'll define them operationally.

You do **not** need a category-theory course; we use it as an engineering tool, defining each notion by what it buys you.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Discriminant** | The integer value identifying a sum's active variant. May be a separate field or niche-encoded. |
| **Niche** | An invalid/unused bit pattern of a type that the compiler repurposes to encode a discriminant for free. |
| **Tag-free / unboxed sum** | A sum represented without a separate tag, using niches (e.g. `Option<&T>`, `Option<NonZero…>`). |
| **GADT** | Generalized Algebraic Data Type: a sum where each constructor can constrain/refine the type parameters of the result. |
| **Indexed type** | A type parameterized by a value or another type used as an "index" (`Vec<n>`, `Expr<T>`), enabling type-refining matches. |
| **Coproduct** | The category-theory name for a sum/disjoint-union; the dual of a product. |
| **Initial object** | The object with a unique morphism *to* every object; Void. (Terminal = Unit, unique morphism *from* every object.) |
| **Polynomial functor** | A functor built from `+`, `×`, constants, and the identity; every (regular) ADT is the initial algebra of one. |
| **Catamorphism / anamorphism** | The unique fold out of / unfold into a recursive type. |
| **Traverse / Traversable** | Mechanically derivable "map with effects" over an ADT's shape, fundamental to (de)serialization. |
| **ABI stability** | Whether a type's binary representation is guaranteed stable across compiler versions/builds. |
| **Tag compatibility** | Whether two endpoints agree on which integer means which variant — the wire-format version of exhaustiveness. |
| **Open-world / closed-world** | In-process sums are closed (full variant set known); cross-version/wire sums are open (unknown future variants). |

---

## Core Concepts

### 1. Discriminant encoding: tag, niche, and the in-between

A sum's runtime representation answers one question: *how do we know which variant this is?* Compilers use a spectrum:

- **Explicit tag.** A separate integer field (`u8`/`u32`, sized to the variant count) precedes or follows the payload. Simple, always works. `size ≈ align_up(tag) + max(payload)`.
- **Niche / direct tagging.** If some payload type has invalid bit patterns (a "niche"), the discriminant is stored *in those patterns*, costing zero extra bytes. `Option<&T>` uses the null pointer; `Option<NonZeroU32>` uses 0; `Option<bool>` uses the 254 unused byte values of a `bool`; an enum of C-like fieldless variants is just an integer.
- **Multi-niche / nested.** The compiler can niche-pack *recursively*: `Result<&T, &U>` where one side is a reference, or `Option<Option<&T>>` collapsing two layers into a single pointer's spare patterns. The general problem ("find the largest set of invalid bit patterns across all variants and assign discriminants into them") is what Rust's layout algorithm solves.

The professional consequence: **identical algebra, wildly different bytes.** `Option<&T>` is 8 bytes; `Option<u64>` is 16 (no niche in a `u64`). You cannot reason about size or FFI from cardinality alone — you must know the niche situation.

### 2. Variant arity and zero-cost cases

- **Fieldless variants** (arity 0) carry only the discriminant. An all-fieldless enum is *exactly* a C enum — an integer. The `Red | Green | Blue` enum is `0 | 1 | 2`.
- **Unit-like variants** inside a bigger sum (e.g. `None`, `Nil`) are pure-tag: they occupy a discriminant value and no payload.
- **Newtype/single-field products** are layout-transparent to their inner type in many compilers (`struct Wrapper(u64)` is laid out like `u64`), which is what makes newtypes zero-cost.

This is why `enum` in Rust spans "free C enum" to "tagged union with heap-boxed payloads" depending entirely on the variants — the keyword is the same; the representation is a function of the contents.

### 3. GADTs: when the matched variant refines a type

Ordinary sums are *uniform*: every variant of `Expr` produces an `Expr`. **GADTs** let each constructor produce a *differently-indexed* result, so matching a variant teaches the type checker a *type equation*. The motivating example is a typed expression AST:

```haskell
{-# LANGUAGE GADTs #-}
data Expr a where
  IntLit  :: Int  -> Expr Int
  BoolLit :: Bool -> Expr Bool
  Add     :: Expr Int  -> Expr Int  -> Expr Int
  If      :: Expr Bool -> Expr a -> Expr a -> Expr a

eval :: Expr a -> a            -- returns the RIGHT type per branch, no casts
eval (IntLit n)   = n          -- here the compiler KNOWS a ~ Int
eval (BoolLit b)  = b          -- here a ~ Bool
eval (Add x y)    = eval x + eval y
eval (If c t e)   = if eval c then eval t else eval e
```

Matching `IntLit` *refines* `a` to `Int` in that branch — so `eval` can return `n :: Int` even though its signature is `Expr a -> a`. There is **no runtime type tag inspection and no possibility of a type error**: an ill-typed expression like `Add (BoolLit True) (IntLit 1)` *doesn't typecheck*, so the evaluator can't be handed one. This is the bridge from "sum of types" to "sum carrying type equations," and it's the on-ramp to dependent types: GADTs are indexed sums, and dependent sums (`Σ`) generalize them further (see `professional`-level type-system material elsewhere).

Rust, Swift, OCaml, Scala, and Kotlin have varying degrees of this; OCaml and Haskell have full GADTs, Scala/Kotlin approximate via sealed hierarchies + bounded type members, Rust mostly lacks them (you reach for trait objects or const generics).

### 4. The category theory, as an engineering tool

Map each construct to its categorical identity, and read off *why* the design is forced:

```
product A × B      = categorical PRODUCT     (terminal w.r.t. projections)
sum A + B          = COPRODUCT                (initial w.r.t. injections)
Unit               = TERMINAL object 1        (unique arrow A → 1: const ())
Void               = INITIAL object 0         (unique arrow 0 → A: absurd)
function A → B     = EXPONENTIAL B^A          (currying = the exponential adjunction)
```

A category with all of these is **cartesian closed** — and that's exactly the structure a (total, pure) functional core needs. The payoffs are concrete:

- **Uniqueness of the fold.** A recursive ADT is the **initial algebra** of a *polynomial functor* `F` (built from `+`, `×`, constants, identity). "Initial" means: for any algebra `F r -> r` there is a **unique** map `cata :: Fix F -> r`. That uniqueness is *why* `fold` is canonical and why two folds with the same algebra must be equal — it's a theorem, not a convention.
- **Mechanical deriving.** Because the ADT is built from `+`/`×`, the compiler can *derive* `Functor` (`map`), `Foldable` (`fold`), `Traversable` (effectful map), `Eq`, and `Ord` by structural induction on the polynomial shape. `#[derive(...)]` / `deriving (...)` is the polynomial functor being walked.
- **Soundness of the algebra.** The `|A+B|=|A|+|B|` arithmetic is the cardinality functor being a semiring homomorphism from (finite types, +, ×) to (ℕ, +, ×). The "high-school algebra" works because of this homomorphism — not by coincidence.

You don't *need* the vocabulary to ship, but it's what lets you assert "this fold is the only correct one" and "these derives are total" with confidence rather than hope.

### 5. Traverse: the (de)serialization workhorse

`traverse` ("map an effectful function over a structure, collecting the effects") is derivable for any ADT and is the principled core of parsing/serialization: decoding a `List<Field>` is `traverse decodeField`, turning a `List<Result<T,E>>` into a `Result<List<T>,E>` that short-circuits on the first error. Recognizing serialization as `traverse` over the type's polynomial shape is what lets generic (de)serializers (serde, aeson, protobuf codegen) exist: they walk sums (pick a branch by tag) and products (sequence the fields) uniformly.

### 6. Cross-boundary reality #1: ABI and FFI

In-process, a sum's layout is the compiler's business. Across an FFI boundary it becomes a *contract*:

- **Default layout is unspecified.** Rust's default `enum`/`struct` layout may reorder fields, pick any discriminant encoding, and change between compiler versions. **Never** send a default-`repr` type across FFI.
- **`#[repr(C)]` / `#[repr(u8)]` / `#[repr(C, u8)]`** force a stable, documented layout: a C-compatible struct, an explicit discriminant type, or a "tag + union" C representation for data-carrying enums. This is how you hand a tagged union to C.
- **C unions are the untagged primitive.** To expose a Rust enum to C you typically emit a `struct { tag; union payload; }` — manually reconstructing the tag the safe sum had, because C's `union` has none. The discipline you get for free in-language becomes your responsibility at the boundary.

### 7. Cross-boundary reality #2: serialization and schema evolution

A sum on the wire is a *tag-compatibility* problem, and the closed-world exhaustiveness that protects you in-process becomes an **open-world** forward/backward-compatibility problem:

- **Tag stability.** The integer/string that names each variant must be **stable forever**. Reordering enum variants (and thereby their discriminants) silently reinterprets old data — a classic corruption bug. Pin discriminants explicitly; never rely on declaration order.
- **Unknown variants.** A new producer can send a variant an old consumer doesn't know. Closed exhaustiveness can't help across versions — the consumer needs an explicit `Unknown(tag)` catch-all or a "must-understand" rejection policy. This is precisely why mature formats (protobuf `oneof`, Thrift unions, Avro unions, Cap'n Proto) define unknown-field/unknown-branch behavior.
- **Adding/removing variants.** Adding a variant is forward-incompatible for old readers unless they tolerate unknowns; removing one is backward-incompatible for old writers. Schema-evolution rules for sums are stricter than for products (where adding an optional field is usually safe).
- **Optional ≠ nullable ≠ absent.** `Option<Option<T>>`-style distinctions (present-null vs absent) surface as real wire concerns (JSON `null` vs missing key; protobuf `optional` vs default). The algebra (`2 + A`) you saw at the middle level is now a compatibility decision.

The professional stance: **in-process, exploit closed-world exhaustiveness; on the wire, design for the open world** — stable tags, explicit unknown handling, documented evolution rules.

### 8. Performance engineering of sums

- **Box the fat variant** so the sum is "tag + pointer," keeping common small variants cache-friendly.
- **Order matters for niches** — sometimes restructuring lets the compiler niche-pack, shrinking the type.
- **Branch prediction on the discriminant.** A hot match is a switch on the tag; arranging the common case first, or using jump tables, affects throughput. Profile-guided optimization helps.
- **Struct-of-arrays for bulk sums.** Storing a `Vec<Enum>` wastes the max-variant size per element; splitting into per-variant arrays (an SoA / "columnar" representation) can dramatically cut memory and improve vectorization for data-parallel workloads.
- **Tagged pointers** (steal low/high pointer bits for a small tag) are a manual niche trick used in VMs and allocators when you control the layout.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Niche encoding** | Writing the apartment number in the otherwise-blank margin of the envelope instead of adding a second label. |
| **GADT type refinement** | A coat-check ticket whose color *guarantees* which rack your coat is on — handing it back can't retrieve the wrong type of item. |
| **Initial algebra / unique fold** | A single universal adapter that any device can plug into; there's exactly one way it connects. |
| **Polynomial functor deriving** | A stamping machine that, given the *shape* of a part, automatically produces its inspection routine. |
| **ABI instability** | A power plug whose pin layout the manufacturer reshuffles between batches — fine inside one device, disastrous across vendors. |
| **Tag compatibility on the wire** | Two countries agreeing that "code 3" means the same thing; if one renumbers, messages mean different things. |
| **Unknown-variant handling** | A form field "Other (please specify)" so newer categories don't break older readers. |
| **Struct-of-arrays sum** | A filing cabinet with one drawer per document type, instead of one fat folder sized for the biggest document. |

---

## Mental Models

### The "Three Representations" Model

For any sum, hold three views simultaneously: the **algebraic** (`1 + A`, cardinality), the **physical** (tag-or-niche, size, alignment, boxing), and the **boundary** (wire tag, ABI, evolution rules). Most production bugs at this level come from reasoning in one view while the problem lives in another — e.g. assuming algebraic equivalence implies wire compatibility (it doesn't), or assuming in-process layout is the FFI contract (it isn't).

### The "Closed In, Open Out" Model

Inside the process, your sums are **closed worlds**: the compiler knows every variant, so exhaustiveness is your safety net — exploit it ruthlessly (no wildcards). The instant a value crosses a wire or a version boundary, you're in an **open world**: future variants exist that today's code can't enumerate, so design for unknowns explicitly. The same `enum` plays both roles; the engineering discipline flips at the boundary.

### The "Initial Algebra = One True Fold" Model

When you define a recursive ADT, you're not just declaring data — you're declaring the *initial algebra of a polynomial functor*, which comes with a **unique** fold. Every legitimate recursive operation over that type is "the fold with a particular algebra." If you find yourself hand-writing bespoke recursion that *isn't* a fold, ask whether you've smuggled in non-structural recursion (which may not terminate and definitely isn't free to derive).

---

## Code Examples

### Inspecting representation: tag vs niche (Rust)

```rust
use std::mem::{size_of, align_of};
use std::num::NonZeroU32;

enum Color { Red, Green, Blue }            // fieldless → just an integer

fn main() {
    // Fieldless enum: a bare discriminant. 1 byte is enough for 3 variants.
    assert_eq!(size_of::<Color>(), 1);

    // Niche: a reference is never null → None reuses the null pattern. No extra tag.
    assert_eq!(size_of::<Option<&u32>>(), size_of::<&u32>());       // 8

    // Niche: NonZeroU32 can't be 0 → None = 0. Still 4 bytes, no extra tag.
    assert_eq!(size_of::<Option<NonZeroU32>>(), 4);

    // No niche: u32 uses ALL bit patterns → needs a separate tag → padded to 8.
    assert_eq!(size_of::<Option<u32>>(), 8);

    // Box is a non-null pointer → Result<Box<u8>, ()> niches into the pointer.
    assert_eq!(size_of::<Option<Box<u8>>>(), size_of::<*const u8>()); // 8

    println!("align of Option<u32> = {}", align_of::<Option<u32>>());
}
```

### A GADT-typed evaluator with no runtime type errors (OCaml)

```ocaml
(* Each constructor's RESULT type is refined: matching teaches a type equation. *)
type _ expr =
  | Int  : int  -> int expr
  | Bool : bool -> bool expr
  | Add  : int expr * int expr   -> int expr
  | Eq   : int expr * int expr   -> bool expr
  | If   : bool expr * 'a expr * 'a expr -> 'a expr

let rec eval : type a. a expr -> a = function
  | Int n        -> n               (* a = int   here *)
  | Bool b       -> b               (* a = bool  here *)
  | Add (x, y)   -> eval x + eval y
  | Eq  (x, y)   -> eval x = eval y
  | If  (c, t, e) -> if eval c then eval t else eval e

(* `Add (Bool true, Int 1)` is a COMPILE error: Bool true : bool expr,
   but Add demands int expr. The evaluator can never see ill-typed input. *)
```

### Deriving fold/map/traverse from the polynomial shape (Haskell)

```haskell
{-# LANGUAGE DeriveFunctor, DeriveFoldable, DeriveTraversable #-}
data Tree a = Leaf | Node (Tree a) a (Tree a)
  deriving (Functor, Foldable, Traversable)
  -- Tree is the initial algebra of  F x = 1 + (x × a × x), a polynomial functor.
  -- Because it's polynomial, map/fold/traverse are derivable by structural induction.

-- Foldable gives sum, toList, length for free:
total :: Num a => Tree a -> a
total = sum

-- Traversable gives effectful traversal for free — the core of (de)serialization:
-- traverse :: Applicative f => (a -> f b) -> Tree a -> f (Tree b)
validatePositives :: Tree Int -> Maybe (Tree Int)
validatePositives = traverse (\x -> if x > 0 then Just x else Nothing)
-- one negative anywhere short-circuits the whole tree to Nothing.
```

### Crossing FFI: forcing a stable tagged-union layout (Rust)

```rust
// Default repr is UNSPECIFIED — never send it to C.
// repr(C, u8) gives the classic "tag byte + C union of payloads" layout.
#[repr(u8)]
enum Message {
    Ping,
    Text { len: u32, ptr: *const u8 },
    Close { code: u16 },
}
// `repr(u8)` pins the discriminant type; the compiler emits a C-compatible
// struct-with-tag the C side can mirror as:
//   struct Message { uint8_t tag; union { struct {...} text; struct {...} close; }; };
// Reordering variants here renumbers tags → silently breaks the C contract.
```

### Wire-format sum with explicit unknown handling (schema evolution)

```rust
// On the wire, the closed-world exhaustiveness does NOT protect you across versions.
// Pin discriminants explicitly and tolerate unknown variants.
#[repr(u16)]
enum EventKind {
    Click   = 1,    // tags are STABLE FOREVER — never reuse or reorder
    Scroll  = 2,
    KeyDown = 3,
    // A future producer may send 4, 5, ... that THIS binary doesn't know.
}

enum DecodedEvent {
    Known(EventKind, Payload),
    Unknown { tag: u16, raw: Vec<u8> },   // open-world catch-all: don't crash
}
struct Payload;

fn decode(tag: u16, raw: Vec<u8>) -> DecodedEvent {
    match tag {
        1 => DecodedEvent::Known(EventKind::Click,   Payload),
        2 => DecodedEvent::Known(EventKind::Scroll,  Payload),
        3 => DecodedEvent::Known(EventKind::KeyDown, Payload),
        other => DecodedEvent::Unknown { tag: other, raw }, // forward-compatible
    }
}
```

### Struct-of-arrays representation for a bulk sum (performance)

```rust
// Array-of-sums: each element reserves space for the largest variant.
enum Cell { Empty, Int(i64), Text(String) }
// Vec<Cell>: every slot is sized for the biggest variant (String = 24 bytes),
// even the Empty ones. Poor cache density for columnar workloads.

// Struct-of-arrays: one column per variant + a tag column.
struct Column {
    tags:  Vec<u8>,            // 0 = Empty, 1 = Int, 2 = Text
    ints:  Vec<i64>,           // only the Int payloads
    texts: Vec<String>,        // only the Text payloads
}
// Same logical data; far better memory density and vectorization for scans.
// This is how columnar databases store heterogeneously-typed columns.
```

---

## Pros & Cons

| Aspect | Pros | Cons |
|--------|------|------|
| **Representation** | Niche/unboxed sums make `Option`/`Result`/pointer-enums effectively free; fieldless enums are bare integers. | Size is variant-max; no-niche payloads pay a full tag; layout is compiler-dependent without `repr`. |
| **GADTs / indexed sums** | Type-refining matches eliminate whole classes of runtime type errors (typed ASTs, length-indexed vectors). | Heavy type machinery; poor support outside Haskell/OCaml; can wreck type inference and error messages. |
| **Category theory** | Justifies uniqueness of folds, mechanical deriving of map/fold/traverse, and soundness of the algebra. | Conceptual overhead; easy to over-intellectualize a simple datatype. |
| **FFI/ABI** | `repr(C)`-style controls give a precise, documented binary contract. | Default layouts are unstable; manual tag+union reconstruction for C; easy to create UB. |
| **Serialization/evolution** | `traverse`-based generic codecs; sums map cleanly to wire unions. | Open-world version skew defeats exhaustiveness; tag stability and unknown-handling are mandatory and error-prone. |

---

## Use Cases

- **Compiler/VM internals:** typed ASTs via GADTs; tagged-pointer value representations; niche-packed option types pervasive in hot data structures.
- **High-performance data systems:** columnar/SoA layouts for heterogeneously-typed cells; manual tag encoding; cache-conscious sum design.
- **FFI boundaries:** exposing tagged unions to C via `repr(C, u8)`; mirroring the tag+union on the foreign side.
- **Wire protocols and storage formats:** designing evolvable sum encodings (protobuf `oneof`, Thrift/Avro/Cap'n Proto unions) with stable tags and unknown-variant tolerance.
- **Generic libraries:** serde/aeson-style codecs and `#[derive]`/`deriving` machinery built on the polynomial-functor view (map/fold/traverse).
- **Type-level guarantees:** length-indexed vectors, well-scoped/well-typed term representations, session-typed protocols built on indexed sums.

---

## Coding Patterns

### Pattern 1: Pin discriminants and design for unknowns at every boundary

Give every wire/storage variant an explicit, permanent tag; never rely on declaration order. Always provide an `Unknown(tag, raw)` branch (or a documented must-understand rejection) so newer producers don't crash older consumers.

### Pattern 2: `repr(C, u8)` (or equivalent) for any sum that crosses FFI

Force a documented tag+union layout. Mirror it exactly on the foreign side. Treat reordering variants as a breaking ABI change.

### Pattern 3: Box fat variants and niche-friendly types for size

Use `Box`/pointer for the large outlier variant; prefer `NonZero`, references, and other niche-bearing payloads so the compiler packs the tag for free. Verify with `size_of`.

### Pattern 4: Express recursive operations as folds; derive map/fold/traverse

Lean on `deriving`/`#[derive]` for `Functor`/`Foldable`/`Traversable` (or hand-write them as the polynomial structure dictates). Implement codecs as `traverse`.

### Pattern 5: GADTs (where available) for type-refining invariants

When a runtime type tag would otherwise be inspected, reach for a GADT/indexed sum so the match *refines the type* and the unsafe case becomes unrepresentable.

### Pattern 6: Struct-of-arrays for bulk heterogeneous data

When storing millions of sum values in a hot scan path, split into per-variant columns plus a tag column for density and vectorization.

---

## Best Practices

- **Reason in all three representations (algebraic, physical, boundary) and know which one the current problem lives in.** Most leaks come from conflating them.
- **Inside the process: exploit closed-world exhaustiveness; no wildcards over your own sums.** At the boundary: design open-world with stable tags and explicit unknown handling.
- **Never expose a default-layout sum across FFI.** Use `repr(C)`/`repr(C, u8)` and document the contract.
- **Pin wire/storage discriminants forever.** Renumbering or reordering corrupts persisted/in-flight data.
- **Prefer derived `map`/`fold`/`traverse` over hand-rolled recursion** — they're the polynomial functor walked correctly and totally.
- **Use GADTs surgically.** They pay for themselves on typed interpreters and indexed data; they cost inference and error-message quality, so don't reach for them by default.
- **Measure layout decisions.** `size_of`/`align_of`, profiling, and cache-miss counters — boxing and SoA are performance claims that need evidence.
- **Document schema-evolution rules for every persisted/transmitted sum:** what adding, removing, and reordering variants does to forward/backward compatibility.

---

## Edge Cases & Pitfalls

- **Algebraic equivalence ≠ representational/wire equivalence.** `(A, B)` and `(B, A)` are isomorphic but have different byte layouts and different wire encodings. Never substitute one for the other across a boundary.
- **Default `repr` is not stable across compiler versions.** Code that serializes a default-layout type via `unsafe` byte copies (or shares it across an FFI built with a different toolchain) is undefined behavior waiting to happen.
- **Reordering variants renumbers discriminants.** In-process this is invisible; for any persisted/transmitted enum it silently reinterprets old data. Pin discriminants.
- **Niche optimization is not guaranteed by the spec.** It's an optimization Rust *currently* performs for certain types; don't hardcode `size_of` assumptions in code that must be portable across compiler versions unless documented (`Option<&T>` and `Option<NonZero…>` are documented; many others aren't).
- **GADTs break inference and exhaustiveness ergonomics.** Type refinement can make the compiler unable to infer types, force annotations, and produce baffling errors; pattern coverage over GADTs is subtler (some "impossible" branches must be omitted, not handled).
- **Unknown-variant data loss.** If `Unknown(tag, raw)` discards the raw bytes, a proxy/round-tripping service silently drops data a newer peer sent. Preserve and re-emit unknown payloads when acting as a relay.
- **`traverse` short-circuits — sometimes you want to collect *all* errors.** Plain `Result`-traverse stops at the first failure; validation often wants accumulation (a `Validation`/`Either`-with-`Semigroup` applicative). Choose the applicative deliberately.
- **Tagged-pointer tricks assume alignment/pointer-bit availability.** Stealing pointer bits is platform- and allocator-dependent; it breaks under tagging schemes like ARM MTE/top-byte-ignore or non-aligned allocations.
- **`repr(C, u8)` enums and C `union` must agree on alignment and size exactly.** A mismatch is silent memory corruption, not a compile error.

---

## Test Yourself

1. Predict `size_of` for: `Option<&u8>`, `Option<u8>`, `Option<NonZeroU8>`, `Result<(), &u32>`, `Option<Option<&u8>>`. Explain each in terms of niches, then check against the compiler.
2. Write a GADT-typed mini-language with `Int`, `Bool`, `Add`, `If`, and `Eq`, and an `eval` whose return type is refined per branch. Show a term that fails to typecheck and say why.
3. Explain why a recursive ADT's fold is *unique*, using the words "initial algebra" and "polynomial functor." What goes wrong if you write recursion that isn't a fold?
4. Your service persists an enum to disk. List the exact compatibility consequences of (a) adding a variant, (b) removing a variant, (c) reordering two variants. Which are safe for old readers? old writers?
5. You must hand a data-carrying enum to a C library. Which `repr` do you choose, what does the C side declare, and what change to your enum is now an ABI break?
6. Why is `traverse` the right abstraction for decoding a list of fields? When would you *not* use the `Result` applicative, and what would you use instead?
7. Given `Vec<enum Cell { Empty, Int(i64), Text(String) }>` with 100M elements, 90% `Empty`, estimate the memory waste of the array-of-sums layout and describe the SoA alternative.
8. Two services exchange a sum; one is upgraded with a new variant. Trace what happens at the old consumer with and without an `Unknown(tag, raw)` branch. What additional care does a *relay* service need?

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────┐
│            ADTs UNDER THE HOOD (professional view)              │
├──────────────────────────────────────────────────────────────────┤
│ DISCRIMINANT ENCODING                                            │
│   explicit tag : separate int; size ≈ tag + max(payload)         │
│   niche        : hide tag in invalid bit patterns (FREE)         │
│     Option<&T>=8  Option<NonZero>=inner  Option<Box>=ptr         │
│   fieldless enum = bare integer (a C enum)                       │
├──────────────────────────────────────────────────────────────────┤
│ GADT / indexed sum: matched variant REFINES the type            │
│   typed AST eval :: Expr a -> a, no runtime type errors          │
│   on-ramp to dependent types (indexed = Σ-flavored sums)        │
├──────────────────────────────────────────────────────────────────┤
│ CATEGORY THEORY (as a tool)                                      │
│   product=product  sum=coproduct  Unit=terminal(1) Void=init(0)  │
│   function=exponential  ⇒  cartesian closed                      │
│   recursive ADT = INITIAL ALGEBRA of a POLYNOMIAL FUNCTOR        │
│     ⇒ fold is UNIQUE; map/fold/traverse are DERIVABLE            │
│     ⇒ |A+B|=|A|+|B| is a semiring homomorphism (why algebra works)│
├──────────────────────────────────────────────────────────────────┤
│ CLOSED IN, OPEN OUT                                              │
│   in-process : closed world → exploit exhaustiveness, no wildcard │
│   on the wire: open world → STABLE tags + Unknown(tag,raw)       │
│   reorder variants = renumber discriminants = corrupt old data   │
├──────────────────────────────────────────────────────────────────┤
│ FFI: never default-repr; use repr(C)/repr(C,u8) = tag + C union  │
│ PERF: box fat variant; niche-friendly payloads; SoA for bulk     │
└──────────────────────────────────────────────────────────────────┘
```

---

## Summary

- A sum's **representation** spans a spectrum: explicit tag → **niche** packing (free, e.g. `Option<&T>`, `Option<NonZero…>`) → bare integer for fieldless enums. Cardinality tells you nothing about size; you must know the niche situation.
- **GADTs / indexed sums** let the matched variant **refine a type variable**, giving typed ASTs and length-indexed data with *no runtime type errors* — the bridge from "sum of types" toward dependent types.
- The **category theory is an engineering tool**: products are products, sums are coproducts, Unit is terminal, Void is initial, functions are exponentials, and a recursive ADT is the **initial algebra of a polynomial functor**. That's *why* the fold is unique, *why* `map`/`fold`/`traverse` derive mechanically, and *why* the type algebra is sound (a semiring homomorphism).
- **`traverse`** over the polynomial shape is the principled core of generic (de)serialization — and you must choose the applicative deliberately (short-circuit vs error-accumulation).
- **Across boundaries the world flips from closed to open.** In-process, exploit exhaustiveness ruthlessly; on the wire/disk, design for unknown future variants with **stable, pinned discriminants** and an explicit `Unknown(tag, raw)` policy. Reordering variants renumbers tags and corrupts persisted data.
- **FFI** demands `repr(C)`/`repr(C, u8)` to pin a tag+union layout; default layouts are unstable and unsafe to share. **Performance** levers include boxing fat variants, niche-friendly payloads, struct-of-arrays for bulk, and tagged pointers.
- The professional skill is holding the **algebraic, physical, and boundary** representations at once and knowing which view the current decision belongs to.

---

## What You Can Build

- **A layout explorer** that prints size/alignment and the chosen discriminant encoding (tag vs niche) for a battery of sum types, demonstrating null-pointer and `NonZero` optimizations and the "box the fat variant" shrink.
- **A GADT-typed expression interpreter** (ints, bools, comparisons, conditionals) that statically rejects ill-typed terms, plus a write-up of which branches the type checker proves impossible.
- **A generic codec** built on derived `Foldable`/`Traversable` (or a hand-written polynomial walker) that serializes and deserializes arbitrary ADTs, with an option to *accumulate* all validation errors instead of short-circuiting.
- **A schema-evolution test harness**: persist version-1 sum data, evolve the enum (add/remove/reorder variants), and assert exactly which changes old readers/writers survive — proving why discriminant pinning and `Unknown` handling matter.
- **An FFI tagged-union bridge**: a `repr(C, u8)` Rust enum, the matching C `struct { tag; union; }`, and round-trip tests across the boundary, including a deliberate variant-reorder to show the ABI break.
- **A columnar (SoA) store** for a heterogeneously-typed column, benchmarked against the naive `Vec<Enum>` for memory footprint and scan throughput.

---

## Further Reading

- "Generalized Algebraic Data Types and Object-Oriented Programming" / Peyton Jones et al. on GADTs; the GHC and OCaml manuals' GADT chapters.
- *Category Theory for Programmers* — Bartosz Milewski. Products/coproducts, initial/terminal objects, exponentials, F-algebras, and catamorphisms for working programmers.
- "Functional Programming with Bananas, Lenses, Envelopes and Barbed Wire" — Meijer, Fokkinga, Paterson. The origin of recursion schemes (cata/ana/hylo).
- The Rust Reference, "Type layout," plus the Rustonomicon on `repr` and FFI — niche optimization, discriminants, and the C-compatible union representation. https://doc.rust-lang.org/nomicon/
- "The Derivative of a Regular Type is its Type of One-Hole Contexts" — Conor McBride. The algebra/calculus of ADTs taken seriously.
- The Protocol Buffers, Apache Thrift, Apache Avro, and Cap'n Proto specs — real-world rules for evolving `oneof`/union schemas (tag stability, unknown handling).
- *The Implementation of Functional Programming Languages* — Simon Peyton Jones. How constructors, tags, and pattern matching are compiled.
- "An Applicative for Validation" / `Data.Validation` docs — error-accumulating traversal vs short-circuiting `Either`.
- Andres Löh, "A Generic Deriving Mechanism" / GHC Generics — the polynomial-functor view powering derivable type classes.
