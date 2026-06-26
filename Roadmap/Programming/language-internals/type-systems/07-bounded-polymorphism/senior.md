# Bounded Polymorphism — Senior Level

> **Topic:** [Bounded Polymorphism](README.md)
> **Focus:** Typeclasses/traits as principled ad-hoc polymorphism — dictionary translation, coherence and orphan rules, associated types vs type parameters, and how this machinery answers the expression problem.

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

> Focus: **Typeclasses and traits are not "interfaces with extra steps."** They're a principled way to do ad-hoc polymorphism, with a precise compilation story (dictionary translation), a global correctness invariant (coherence), and a design tax (orphan rules) — and they solve a problem subtype interfaces structurally cannot.

By now you can write bounds, combine them, and read the subtype-vs-dictionary split. The senior question is *why dictionary-passing bounds (typeclasses, traits) are the more principled design*, and what that principledness costs and buys.

The thesis: **ad-hoc polymorphism done right.** "Ad-hoc polymorphism" means one operation name (`+`, `show`, `==`) with genuinely different implementations per type — `1 + 2` is integer add, `"a" + "b"` is concatenation, the implementations share nothing. Overloading is the *undisciplined* form (resolved syntactically, can't be abstracted over, no coherence guarantee). Typeclasses are the *disciplined* form: one declaration of the operation's signature (`class Eq a where (==) :: a -> a -> Bool`), many independent *instances*, the ability to write generic code that abstracts over "any type with an `Eq` instance," and a guarantee that the *same* instance is used everywhere for a given type (coherence). That last guarantee is what makes `Set a` sound — if two parts of the program disagreed on how `a` orders, the set would corrupt.

This page develops: the **dictionary translation** that compiles a typeclass-constrained function into an ordinary function taking an explicit table of operations; **coherence** (one canonical instance per type) and the **orphan rule** that protects it; **associated types/type members** as an alternative to extra type parameters; **constraint propagation** through `where`; and the **expression problem** — adding new *types* and new *operations* without recompiling old code — which typeclasses solve and subtype-interfaces do not.

> 🎓 **Why this matters at the senior level:** When you architect a library's extensibility story — "can users add their own types to my generic algorithms? can I add operations to types I don't control? will two transitive dependencies' instances collide?" — you are making decisions governed exactly by coherence, orphan rules, and associated-vs-parameter choices. Getting these right is the difference between a library that composes across an ecosystem and one that fights it.

The runtime/specialization internals (full monomorphization vs witness-table dispatch trade-offs at scale) and the cross-language standardization story live in `professional.md`.

---

## Prerequisites

- **Required:** The middle page — multiple bounds, F-bounds/`Self`, and the subtype-bound vs dictionary-passing mechanisms.
- **Required:** Implementing a typeclass instance / trait impl for your own type, and reading a `where`-constrained signature.
- **Required:** A working sense of *parametric* vs *ad-hoc* polymorphism.
- **Helpful:** Exposure to Haskell `class`/`instance`, Rust `trait`/`impl`, or Scala `given`/`using`.
- **Helpful:** Having hit an "orphan instance" or "conflicting implementations" compile error.

You do **not** need: the deep monomorphization-vs-dyn performance internals (`professional.md`), higher-kinded typeclasses (`Functor`/`Monad`) beyond passing mention, or compiler-internal constraint-solving algorithms.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Ad-hoc polymorphism** | One operation name with per-type implementations that need not be related (vs parametric, which is uniform). |
| **Typeclass** | (Haskell) A named set of operations a type can implement via a separate `instance`. The principled form of overloading. |
| **Trait** | (Rust/Scala) The same idea: a named capability with `impl`/`given` declarations. |
| **Instance / impl** | A declaration `instance C T where ...` / `impl C for T { ... }` providing the operations of class/trait `C` for type `T`. |
| **Dictionary** | The runtime (or compile-time) record of an instance's operations — a struct of function pointers/values. |
| **Dictionary translation** | The desugaring of a constrained function `C a => a -> b` into an ordinary function `Dict_C_a -> a -> b` taking the dictionary explicitly. |
| **Coherence** | The global invariant that there is **at most one** instance of a class for a given type, used everywhere. |
| **Orphan instance** | An instance declared in a module that owns *neither* the class *nor* the type. Forbidden (or warned) to preserve coherence. |
| **Orphan rule** | The rule "an instance must be defined where the class or the type is defined." |
| **Coherence vs uniqueness** | Coherence = same instance chosen everywhere; uniqueness = only one instance can exist. Orphan rules enforce uniqueness to get coherence. |
| **Associated type** | A type *member* of a typeclass/trait, determined by the implementing type (Rust `type Item;`, Swift `associatedtype`, Haskell type family). |
| **Type parameter (on the class)** | An extra parameter on the class/trait itself (multi-param typeclasses, `trait Add<Rhs>`), as opposed to an associated type. |
| **Functional dependency / output type** | A way to say one type parameter *determines* another (associated types are the cleaner modern form). |
| **Expression problem** | Wadler's challenge: extend a datatype with new cases *and* new operations, statically type-safe, no recompilation, no casts. |
| **Superclass / supertrait** | A constraint that one class requires another (`class Eq a => Ord a`, `trait Ord: PartialOrd`). |

---

## Core Concepts

### 1. Dictionary translation: the compilation story

A typeclass-constrained function is *desugared* into an ordinary function that takes the class's operations as an explicit argument — the **dictionary**. Conceptually, this Haskell:

```haskell
class Eq a where (==) :: a -> a -> Bool

elem :: Eq a => a -> [a] -> Bool
elem x [] = False
elem x (y:ys) = x == y || elem x ys
```

is compiled roughly to (pseudo-code, dictionary made explicit):

```haskell
data EqDict a = EqDict { eq :: a -> a -> Bool }   -- the dictionary type

elem' :: EqDict a -> a -> [a] -> Bool             -- constraint becomes a parameter
elem' d x []     = False
elem' d x (y:ys) = (eq d) x y || elem' d x ys     -- == becomes a field access
```

The `Eq a =>` constraint **becomes a value parameter** of type `EqDict a`; every use of `==` becomes a lookup into that dictionary. At a call site `elem 3 [1,2,3]`, the compiler finds the `Eq Int` instance, materializes its dictionary, and passes it. Rust does the same conceptually; with monomorphization it then *specializes* `elem'` per type and inlines the dictionary away, but the *meaning* is dictionary passing. (Dynamic dispatch — `dyn Trait`, `&dyn Eq` — keeps the dictionary as a runtime vtable instead of erasing it.)

This is why typeclasses are "principled overloading": the desugaring is a *mechanical, type-directed translation* into plain parametric code. Nothing magic, nothing syntactic — the constraint is real data.

### 2. Superclasses: dictionaries that contain dictionaries

`class Eq a => Ord a` says "every `Ord` type is also `Eq`." Under dictionary translation, the `Ord` dictionary *contains* (a pointer to) the `Eq` dictionary:

```text
OrdDict a = { eqDict :: EqDict a, compare :: a -> a -> Ordering, ... }
```

So an `Ord a` constraint also supplies `Eq a` for free. Rust's `trait Ord: PartialOrd + Eq` is the same: the supertrait bound means an `Ord` implementer must also implement its supertraits, and the dictionaries nest. This is how capability *hierarchies* (`Eq` → `Ord`, `PartialOrd` → `Ord`, `Num` → `Fractional`) are encoded.

### 3. Coherence: one instance per type, everywhere

The critical correctness property of typeclasses is **coherence**: for a given type `T` and class `C`, the *whole program* uses the **same** instance. Why it matters: consider `Set T`, which orders elements via `Ord T`. If module A inserted elements using one `Ord T` and module B looked them up using a *different* `Ord T`, the set's invariant ("sorted, no duplicates") would silently break — you'd get duplicate entries, failed lookups, corruption. Coherence guarantees this can't happen: there is one canonical `Ord T`, period.

Coherence is a *global* property, which is what makes it subtle. It's not enough to check one module; the compiler (and the language's rules) must guarantee that no two modules can introduce *conflicting* instances that later meet.

### 4. The orphan rule: protecting coherence

To make coherence enforceable without whole-program analysis, languages restrict *where* instances may be declared. The **orphan rule** (Rust; Haskell warns/`-XOrphanInstances`):

> An `instance C for T` may only be defined in the crate/module that defines **`C`** or the one that defines **`T`** (or, for parameterized `T`, where a local type appears in a covered position).

If neither the class nor the type is yours, the instance is an **orphan** and is rejected. Rationale: if orphans were allowed, two independent crates could *both* write `impl Display for VendorType` differently, and a program depending on both would have two conflicting instances meeting at link time — incoherence. By tying each instance to a crate that owns one of its components, the rule guarantees at most one such crate can exist for any (class, type) pair.

The practical pain: you frequently *want* to implement someone else's trait for someone else's type (e.g. `impl Serialize for ThirdPartyStruct`) and the orphan rule forbids it. The standard escape is the **newtype**: wrap the foreign type in a local one (`struct W(ThirdPartyStruct)`), which you own, and impl on the wrapper. This is the most common friction senior Rust/Haskell engineers hit.

### 5. Associated types vs extra type parameters

When a class operation involves a *second* type that's determined by the implementing type, you have two encodings.

**Extra type parameter on the class (multi-param):**

```rust
trait Collection<Item> {                  // Item is an input parameter
    fn first(&self) -> Option<Item>;
}
```

**Associated type (output type, a member of the trait):**

```rust
trait Collection {
    type Item;                            // Item is determined BY the implementer
    fn first(&self) -> Option<Self::Item>;
}
```

The difference is *functional dependency*: with an associated type, the implementing type **determines** `Item` — a `Vec<i32>` has exactly one `Item` (`i32`), so you write `Collection`, not `Collection<i32>`, everywhere. With a type parameter, a type could in principle implement `Collection<i32>` *and* `Collection<String>`, so callers must always specify which, and inference suffers. Rust uses an associated type `Item` on `Iterator` precisely because an iterator yields exactly one item type; making it a parameter would force `Iterator<u8>` annotations everywhere and break inference. Haskell encodes the same with **type families** / functional dependencies; Swift uses `associatedtype`.

Rule of thumb: **if the implementing type determines the other type, use an associated type. If a single type genuinely needs multiple implementations differing in that type, use a parameter.** `Add<Rhs>` in Rust is a parameter (you can add `Vec` to `Vec` *and* a scalar to a `Vec`), but its *output* is an associated type (`type Output;`) because, given the inputs, the result type is determined.

### 6. Constraint propagation, formally

A bounded function's constraints must be *discharged*: every use of a class operation must be justified by a constraint in scope, and that constraint propagates to callers.

```haskell
sortUnique :: Ord a => [a] -> [a]      -- Ord a in scope: nub/sort allowed
sortUnique = sort . nub                 -- nub needs Eq (from Ord's superclass), sort needs Ord
```

`sortUnique` calls `sort` (`Ord a =>`) and `nub` (`Eq a =>`). Because `Ord a` *implies* `Eq a` via the superclass, a single `Ord a` constraint discharges both. The compiler's constraint solver assembles the right dictionaries by chaining superclass edges. A caller of `sortUnique` must, in turn, supply `Ord a` — constraints flow outward exactly as at the junior level, but now the *solver* is doing real work: searching instances, following superclass and instance-implication edges, building nested dictionaries.

### 7. The expression problem, and how typeclasses crack it

Wadler's **expression problem**: you have a datatype (say, arithmetic expressions: `Lit`, `Add`) and operations (`eval`, `pretty`). You want to add **new datatype cases** (e.g. `Mul`) *and* **new operations** (e.g. `optimize`) — each independently, without modifying or recompiling existing code, and with full static type safety.

- **Object-oriented (subtype) style** makes adding new *types* (cases) easy — write a new class implementing the interface — but adding a new *operation* hard: you must edit *every* existing class to add the method. Types are open; operations are closed.
- **Functional `case`/pattern-matching style** makes adding new *operations* easy — write a new function with a `case` over the constructors — but adding a new *type* hard: every existing function's `case` must gain a branch. Operations are open; types are closed.

Typeclasses dissolve the dilemma. Model each *operation* as a typeclass:

```haskell
class Eval a where eval :: a -> Int
class Pretty a where pretty :: a -> String

data Lit = Lit Int
data Add a b = Add a b

instance Eval Lit       where eval (Lit n) = n
instance (Eval a, Eval b) => Eval (Add a b) where eval (Add x y) = eval x + eval y
```

Now:

- **Add a new type** `Mul`: define `data Mul a b` and `instance Eval (Mul a b)`, `instance Pretty (Mul a b)`. No existing code recompiles.
- **Add a new operation** `Optimize`: define `class Optimize a` and write instances for `Lit`, `Add`, `Mul`. No existing type code recompiles.

Both axes are open. That is the precise sense in which **typeclass-style bounded polymorphism is strictly more extensible than subtype interfaces** — it's open to new *types* and new *operations* simultaneously, which the expression problem proves the naive OO and naive FP styles each cannot do.

### 8. Negative reasoning and specialization (a note)

Coherence interacts with two advanced features. **Specialization** (Rust, unstable; Haskell `OVERLAPPING`) lets a more specific instance override a generic one — powerful but it strains coherence (which instance "wins" must be principled, hence the long stabilization saga). **Negative reasoning** ("`T` does *not* implement `C`") is mostly disallowed because it's non-monotonic: adding an instance later would silently change which code path is selected, breaking the open-world assumption that makes coherence composable. Seniors should know these exist and why they're handled cautiously; you rarely need them, and reaching for them is a design smell.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Dictionary translation** | A constrained job ("must be a licensed pilot") compiled into "here is the explicit pilot's license, passed alongside the worker." |
| **Coherence** | A single national registry of "the one official way to weigh gold." Everyone uses the same scale, so trades reconcile. |
| **Orphan rule** | You may only register a measurement standard if you own *either* the measuring method *or* the thing measured — preventing two strangers from registering rival standards that later clash. |
| **Newtype escape** | Putting a foreign item in your *own* labeled box so you're allowed to attach your own certification to the box. |
| **Associated type** | A spec that says "each engine model determines exactly one fuel type" — you don't specify the fuel separately; the engine fixes it. |
| **Type parameter on the class** | A connector that accepts several voltages — you must say which voltage each time. |
| **Expression problem** | A spreadsheet where you want to freely add both new rows (types) and new columns (operations) without rewriting the existing grid. |
| **Superclass** | A senior certification that includes the junior one inside it. |

---

## Mental Models

### The "constraint is a value" model

Stop thinking of `Ord a =>` / `T: Ord` as a *property*. Think of it as a **hidden argument**: a dictionary of the operations, threaded into the function by the compiler. Every bounded function is, after translation, a plain function that takes its capabilities as data. This single re-framing demystifies superclasses (nested dictionaries), constraint solving (the compiler is *constructing a value*), and why retrofitting works (you're just providing another dictionary). When reasoning about any typeclass behavior, ask: *what dictionary is being constructed and passed here?*

### The "coherence is a global invariant, orphans are how you keep it local" model

Coherence is a whole-program promise ("one instance per type, used everywhere"), but whole-program checks don't compose across separately compiled libraries. The orphan rule converts the global promise into a *local, modular* check: each instance is anchored to a crate that owns part of it, so the compiler can guarantee uniqueness by looking only at ownership, never the whole program. When the orphan rule frustrates you, remember it's the price of *modular* coherence — and the newtype is the sanctioned workaround.

### The "two-axis extensibility grid" model

Draw a 2×2: rows = "easy to add new types / hard," columns = "easy to add new operations / hard." OO subtype interfaces sit in *(types easy, operations hard)*. FP pattern-matching sits in *(operations easy, types hard)*. Typeclass-style bounded polymorphism sits in the open corner — *both easy*. Whenever you design an extensible system, place it on this grid and ask which axis you need open; if you need both, typeclasses/traits (not subtype interfaces, not bare ADTs) are the tool.

---

## Code Examples

### Dictionary translation, made explicit

```haskell
-- Source
class Show a where show :: a -> String
shout :: Show a => a -> String
shout x = show x ++ "!"
```
```haskell
-- Desugared (constraint -> explicit dictionary parameter)
data ShowDict a = ShowDict { showImpl :: a -> String }
shout' :: ShowDict a -> a -> String
shout' d x = showImpl d x ++ "!"
-- call site:  shout' showDictInt 42
```

### Coherence saving a `Set`

```rust
use std::collections::BTreeSet;
// BTreeSet<T> relies on T: Ord. Coherence guarantees the SAME Ord<T>
// is used for inserts and lookups — otherwise the tree invariant breaks.
let mut s = BTreeSet::new();
s.insert(3); s.insert(1); s.insert(3);
assert_eq!(s.len(), 2);   // sound precisely because Ord<i32> is canonical everywhere
```

### Orphan rule + newtype escape (Rust)

```rust
// trait Display and type Vec<T> are BOTH foreign to this crate:
//   impl std::fmt::Display for Vec<i32> { ... }   // ERROR: orphan rule

// Fix: wrap in a local newtype you own.
struct Csv(Vec<i32>);
impl std::fmt::Display for Csv {                  // legal: Csv is local
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        let parts: Vec<String> = self.0.iter().map(|n| n.to_string()).collect();
        write!(f, "{}", parts.join(","))
    }
}
// println!("{}", Csv(vec![1,2,3]));  ->  "1,2,3"
```

### Associated type vs type parameter (Rust)

```rust
// Associated type: the implementer DETERMINES Item; callers don't annotate.
trait Stream {
    type Item;
    fn next(&mut self) -> Option<Self::Item>;
}
struct Counter(u32);
impl Stream for Counter {
    type Item = u32;
    fn next(&mut self) -> Option<u32> { self.0 += 1; Some(self.0) }
}

// Generic code uses Self::Item without ever naming u32:
fn first<S: Stream>(s: &mut S) -> Option<S::Item> { s.next() }
```
```rust
// Parameter version would force annotations and permit multiple impls:
// trait Stream<Item> { fn next(&mut self) -> Option<Item>; }
// fn first<S: Stream<???>>  -- caller must pin Item; inference degrades.
```

### Expression problem solved with typeclasses (Haskell sketch)

```haskell
class Eval a    where eval    :: a -> Int
class Optimize a where optimize :: a -> a   -- a NEW operation added later

data Lit   = Lit Int
data Add a b = Add a b
data Mul a b = Mul a b                       -- a NEW type added later

instance Eval Lit where eval (Lit n) = n
instance (Eval a, Eval b) => Eval (Add a b) where eval (Add x y) = eval x + eval y
instance (Eval a, Eval b) => Eval (Mul a b) where eval (Mul x y) = eval x * eval y
-- Adding Mul required NO change to Eval/Add. Adding Optimize requires NO change to types.
```

### Superclass / supertrait nesting

```rust
trait Shape: std::fmt::Debug {           // supertrait: every Shape is Debug
    fn area(&self) -> f64;
}
fn describe<T: Shape>(s: &T) {
    println!("{:?} has area {}", s, s.area());   // Debug available via supertrait
}
```

---

## Pros & Cons

| Aspect | Pros | Cons |
|--------|------|------|
| **Ad-hoc done right** | One signature, many independent instances; abstractable, type-directed, coherent. | More machinery than plain overloading; steeper learning curve. |
| **Dictionary translation** | Clean semantics; enables monomorphization (zero-cost) *or* `dyn` (small code) by choice. | The mental model ("constraint is a value") is non-obvious to OO programmers. |
| **Coherence** | `Set`/`Map`/dedup are *sound*; global agreement on instances. | Forbids locally-chosen instances; sometimes you genuinely want two orderings (need newtype/explicit comparator). |
| **Orphan rule** | Makes coherence modular and link-safe across an ecosystem. | Real friction: can't `impl ForeignTrait for ForeignType`; newtype boilerplate. |
| **Associated types** | No spurious type parameters; great inference; one canonical companion type. | Less flexible when a type *should* have multiple companion types (then you need a parameter). |
| **Expression problem** | Open to new types **and** new operations; the most extensible bounded style. | Instance proliferation; possible overlapping-instance temptation. |

---

## Use Cases

- **Numeric/algebraic hierarchies** — `Eq`/`Ord`/`Num`/`Fractional` (Haskell), `PartialOrd`/`Ord`/`Add` (Rust): bounded code that works across the whole tower via superclass chaining.
- **Sound collections** — `BTreeSet`/`HashMap` depend on coherent `Ord`/`Hash`; the entire design rests on coherence.
- **Serialization frameworks** — `serde` (Rust), `aeson` (Haskell): derive instances per type; generic encode/decode bounded by `Serialize`/`ToJSON`. Orphan rules shape how third-party support is packaged.
- **Iterator/stream abstractions** — associated `Item` type so `map`/`filter`/`collect` compose without type-parameter noise.
- **Extensible interpreters/ASTs** — the expression problem in the wild: plugins add both new node types and new passes.
- **Capability-bounded generic libraries** — "any `T` that is `Hash + Eq + Clone`" as a reusable, ecosystem-wide contract.

---

## Coding Patterns

### Pattern 1: Newtype to escape the orphan rule (or to pick a non-default instance)

```rust
// Two valid orderings for the same data → wrap to choose one per context.
struct ByLength(String);
impl PartialEq for ByLength { fn eq(&self, o: &Self) -> bool { self.0.len() == o.0.len() } }
// ... Eq, PartialOrd, Ord by length ...
```

Newtypes both dodge orphans *and* let you supply an alternative instance without violating coherence.

### Pattern 2: Prefer associated types for "one companion type" relationships

If a type determines its element/output/error type, model it as an associated type, not a parameter. Reserve parameters for genuinely multi-instance relationships (`Add<Rhs>`).

### Pattern 3: Encode capability hierarchies with superclasses/supertraits

`trait Ord: PartialOrd + Eq` / `class Eq a => Ord a`. Require the *strongest* needed and get the weaker for free; don't re-list `Eq` when you already demand `Ord`.

### Pattern 4: Model an operation axis as a typeclass to keep it open

When you anticipate adding new operations over a fixed set of types (or vice versa), make each operation a class/trait. You buy two-axis extensibility — the expression-problem win.

### Pattern 5: Pass an explicit dictionary/comparator when coherence fights you

When you genuinely need *two* behaviors for one type (e.g. sort by name vs by age), don't fight coherence — pass the operation explicitly (`sort_by`, an explicit `Comparator`, a manually-constructed dictionary). Coherence is for the *canonical* instance; ad-hoc per-call behavior should be an ordinary argument.

---

## Best Practices

- **Treat constraints as data.** When designing, ask "what dictionary does this constraint pass, and is it the canonical one?" It clarifies coherence and retrofitting decisions.
- **Respect coherence; route exceptions through newtypes or explicit arguments.** Never try to register two instances for one type — wrap, or pass the behavior in.
- **Default to associated types; reach for class type parameters only for true multi-instance needs.** It keeps inference healthy and signatures clean.
- **Demand the strongest bound you need and let superclasses supply the rest.** Avoid redundant `Eq + Ord` — `Ord` already implies `Eq`.
- **Package instances with the type or the class you own.** Design libraries so downstream users don't *need* orphans; if a popular foreign type needs your trait, provide a feature-gated impl from *your* crate (you own the trait).
- **Keep instances total and lawful.** `Ord` instances must be transitive and antisymmetric; an unlawful instance silently corrupts every collection built on it. Test instance laws (often via property tests).
- **Avoid overlapping/specialized instances and negative reasoning** unless you can articulate exactly why coherence still holds. They're advanced for a reason.

---

## Edge Cases & Pitfalls

- **Orphan rule blocks the obvious.** `impl ThirdPartyTrait for ThirdPartyType` is rejected. Newtype-wrap, or get one of the two crates to provide the impl behind a feature flag.
- **Unlawful instances corrupt collections silently.** A non-transitive `Ord`, an `Eq`/`Hash` mismatch (`a == b` but `hash(a) != hash(b)`) breaks `HashMap` with no error — just wrong answers and lost entries.
- **`Comparable<T>` vs `Comparable<? super T>` (subtype world).** The tight self-bound rejects a subclass that inherits comparability from a parent. In the typeclass world the analog is "is the instance head `C T` or `C (f a)`?" — instance resolution can surprise you with overlapping or unreachable instances.
- **Associated type vs parameter chosen wrongly.** Picking a parameter where an associated type belonged forces callers to annotate everywhere and wrecks inference; picking associated where you truly need multiple instances boxes you in. The "does the type *determine* it?" test is the deciding question.
- **Coherence vs "I want two orderings."** Coherence intentionally forbids two `Ord` instances for one type. Beginners try to declare both and get a conflict; the fix is a newtype or an explicit comparator, not fighting the compiler.
- **Superclass cycles / over-constrained hierarchies.** Deep `class A => B`, `class B => C` chains make instances tedious; derive where possible.
- **Specialization soundness.** A more specific overlapping instance that disagrees with the generic one can make the same expression mean different things depending on inferred types — a notorious source of subtle bugs; this is why specialization stayed unstable in Rust for years.
- **Open-world assumption breaks negative reasoning.** Code that branches on "`T` is *not* `Foo`" is fragile: someone adding `impl Foo for T` downstream changes behavior at a distance. Most languages forbid it for exactly this reason.
- **Monomorphization vs `dyn` is a semantic-adjacent choice.** Erasing dictionaries (mono) and keeping them (`dyn`) are both "dictionary passing," but `dyn` requires object-safe traits (no generic methods, no `Self`-returning methods) — a senior must know which traits can be `dyn` at all.

---

## Test Yourself

1. Hand-translate a `(Eq a, Ord a) => a -> a -> Bool` function into dictionary-passing form. How many dictionary parameters does it really need, and why (hint: superclass)?
2. Explain precisely how the orphan rule lets the compiler guarantee coherence *without* whole-program analysis. What goes wrong in a hypothetical orphan-allowing world with two libraries?
3. Give a concrete `T` for which you'd genuinely want two different `Ord` behaviors. Show the newtype that lets you have both without violating coherence.
4. Rust's `Iterator` uses `type Item;` (associated), but `Add` uses `Add<Rhs>` (parameter). Justify each choice using the "does the type determine it?" test.
5. Solve a 2-case, 2-operation expression problem (cases `Lit`/`Neg`, ops `eval`/`show`) with typeclasses, then *add* a third case and a third operation. Confirm no existing instance needed editing. Now argue why the OO subtype version would force edits.
6. Why is negative reasoning ("`T` does not implement `C`") generally forbidden? Construct a scenario where allowing it causes spooky-action-at-a-distance when a downstream crate adds an instance.
7. Which of these traits can be made into a `dyn` trait object, and which can't: `Clone`, `Iterator`, `Ord`, `Display`? Tie each answer to object-safety rules.

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────┐
│              BOUNDED POLYMORPHISM (Senior)                        │
├──────────────────────────────────────────────────────────────────┤
│ Typeclasses/traits = AD-HOC POLYMORPHISM DONE RIGHT:             │
│   one signature, many independent instances, abstractable,        │
│   type-directed, COHERENT (vs raw overloading: none of that)      │
├──────────────────────────────────────────────────────────────────┤
│ DICTIONARY TRANSLATION:                                          │
│   (C a => a -> b)  desugars to  (DictC a -> a -> b)              │
│   constraint  =  hidden VALUE (a table of ops) passed in          │
│   superclass  =  dictionary nested inside dictionary              │
├──────────────────────────────────────────────────────────────────┤
│ COHERENCE: <=1 instance per (class,type), used EVERYWHERE.       │
│   makes Set/Map/dedup SOUND.                                     │
│ ORPHAN RULE: instance must live where the CLASS or the TYPE does. │
│   keeps coherence MODULAR. Escape = newtype wrapper.             │
├──────────────────────────────────────────────────────────────────┤
│ ASSOCIATED TYPE vs CLASS TYPE PARAMETER:                         │
│   does the impl TYPE determine the other type?                   │
│     yes -> associated type (Iterator::Item)  no annotation       │
│     no  -> parameter (Add<Rhs>)              multiple impls ok    │
├──────────────────────────────────────────────────────────────────┤
│ EXPRESSION PROBLEM: add new TYPES and new OPERATIONS, no recompile│
│   OO subtype:  types easy, operations HARD                       │
│   FP match:    operations easy, types HARD                       │
│   typeclasses: BOTH easy  <-- the win                            │
├──────────────────────────────────────────────────────────────────┤
│ Avoid: orphan instances, unlawful instances (Eq/Hash mismatch),  │
│   negative reasoning, careless overlapping/specialization        │
└──────────────────────────────────────────────────────────────────┘
```

---

## Summary

- Typeclasses/traits are **ad-hoc polymorphism done right**: one operation signature, many independent **instances**, the ability to abstract over "any type with this capability," and a **coherence** guarantee — everything raw overloading lacks.
- Under the hood, a constraint compiles via **dictionary translation**: `C a => a -> b` becomes `DictC a -> a -> b`, the constraint becoming an explicit table of operations passed in (and possibly monomorphized away). **Superclasses** nest dictionaries inside dictionaries.
- **Coherence** — one canonical instance per type, used everywhere — is what makes `Set`/`Map`/dedup *sound*. The **orphan rule** (instances must live where the class or the type is defined) makes coherence enforceable *modularly*; the **newtype** is the sanctioned escape.
- **Associated types** model "the implementing type determines a companion type" (great inference, no annotations); **class type parameters** are for genuinely multi-instance relationships. The test: *does the type determine it?*
- Constraints **propagate** and are **discharged** by the compiler's constraint solver, which chains superclass and instance edges to build the needed dictionaries.
- The **expression problem** — extend with new types *and* new operations, statically, no recompilation — is solved by modeling operations as typeclasses; OO subtype interfaces (types open, operations closed) and bare ADTs (operations open, types closed) each leave one axis shut. This is the precise sense in which typeclass-style bounds are the most extensible.
- Handle **specialization, overlapping instances, and negative reasoning** with great care — they strain the coherence/open-world guarantees that make the whole system compose.

---

## What You Can Build

- **A toy "dictionary-passing" compiler pass:** take a tiny typeclass-constrained language and emit the desugared explicit-dictionary form. Watching the translation makes coherence and superclasses click.
- **An expression-problem demo** in three styles (OO subtype, FP ADT+match, typeclasses) showing exactly which files must change when you add a new type vs a new operation.
- **A coherence-corruption exhibit:** a deliberately unlawful `Ord`/`Eq`+`Hash` instance fed into a set/map, showing silent duplication and lost lookups — a vivid lesson in why coherence and instance laws matter.
- **A serialization mini-framework** with a `Serialize` trait, derive-like instances, and a worked example of the orphan rule blocking a third-party type plus the newtype fix.
- **An iterator abstraction** built on an associated `Item` type, with `map`/`filter`/`collect`, then a "what if `Item` were a parameter?" branch demonstrating the inference breakage.

---

## Further Reading

- *How to Make Ad-Hoc Polymorphism Less Ad Hoc* — Wadler & Blott, 1989. The paper that introduced typeclasses and dictionary translation.
- *The Expression Problem* — Philip Wadler's note (and the Java/Generics follow-ups). The canonical statement.
- *Type Classes with Functional Dependencies* — Mark Jones, 2000. Why associated/output types matter.
- *Associated Types with Class* — Chakravarty, Keller, Peyton Jones, Marlow, 2005. Type families and associated types.
- *The Rust Reference & Rust RFCs* — the coherence/orphan-rule RFCs and the specialization RFC; the clearest modern engineering treatment. https://doc.rust-lang.org/reference/items/implementations.html
- *Programming in Scala* / *Type Classes as Objects and Implicits* — Oliveira et al., 2010. Typeclasses encoded with implicits.
- *Edward Kmett's talks/writings* on coherence and the dangers of orphan instances.
- *Types and Programming Languages* — Pierce. Bounded quantification and the formal background.
- *Scrap Your Boilerplate* and the "Datatypes à la carte" paper (Swierstra, 2008) — the expression problem solved with free monads/typeclasses.
