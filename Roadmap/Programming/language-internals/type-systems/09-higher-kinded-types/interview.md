# Higher-Kinded Types — Interview Questions

> **Topic:** [Higher-Kinded Types](README.md)

---

## Introduction

These questions probe whether a candidate truly understands kinds — the "types of types" — and abstraction over *type constructors* rather than over types. The dividing line between a candidate who has read a monad tutorial and one who understands HKTs is sharp: the former can recite "a monad is a monoid in the category of endofunctors"; the latter can explain why `Functor f` forces `f :: * -> *`, why you can't write that `f` in Java/Go/Rust, what `traverse` abstracts over, and why Rust shipped GATs but not HKTs.

A strong candidate speaks in terms of *kinds* and *constructors*, gives concrete `Option`/`List`/`Either` behavior for `flatMap` instead of mysticism, distinguishes higher-kinded from higher-rank and higher-order, and treats "should we use this?" as an engineering trade-off rather than an ideology. The questions below run from foundational vocabulary, through language-specific surfaces (Haskell, Scala, Rust/GATs, TypeScript, Kotlin/Arrow), into traps where the obvious answer is wrong, and finish with design judgment.

## Table of Contents

- [Conceptual / Foundational](#conceptual--foundational)
- [Language-Specific](#language-specific)
  - [Haskell](#haskell)
  - [Scala](#scala)
  - [Rust (lack of HKTs and GATs)](#rust-lack-of-hkts-and-gats)
  - [TypeScript (HKT encoding)](#typescript-hkt-encoding)
  - [Kotlin (Arrow)](#kotlin-arrow)
- [Tricky / Trap Questions](#tricky--trap-questions)
- [Design / Judgment](#design--judgment)
- [Cheat Sheet](#cheat-sheet)
- [Further Reading](#further-reading)

---

## Conceptual / Foundational

## Question 1

**What is a kind, and how does it relate to a type?**

A kind is the "type of a type" — it classifies type-level expressions the way a type classifies values. A finished type you can have a value of (`Int`, `String`, `List<Int>`) has kind `*` (also written `Type`). A type *constructor* that still needs arguments to become a finished type has an arrow kind: `List` and `Maybe` have kind `* -> *` (one argument missing), `Either` and `Map` have kind `* -> * -> *` (two missing). Count the arrows to count the missing type arguments. The key insight is that `List` by itself is not a type — you cannot hold a value of type "`List`" — it's a type-level function awaiting an argument.

## Question 2

**What makes a type "higher-kinded"? Give the precise definition.**

A higher-kinded type is code that abstracts over a *type constructor* — a type variable whose own kind is an arrow (`* -> *` or richer) — rather than over a plain type of kind `*`. Ordinary generics like `length<A>(xs: List<A>)` abstract over a kind-`*` parameter `A`. A higher-kinded function like `map<F>(fa: F<A>, f: A -> B): F<B>` abstracts over `F`, where `F` itself takes an argument. The "higher" is because the parameter lives at a higher kind than `*`.

## Question 3

**Why do `Functor`, `Applicative`, and `Monad` require higher-kinded types?**

Because they are parameterized by the *container* itself. `fmap :: (a -> b) -> f a -> f b` writes `f a`, which only makes sense if `f` is a constructor of kind `* -> *`. The whole purpose is to write one `map`/`flatMap` that works for `List`, `Option`, `Either`, `Future`, etc., simultaneously — abstracting over which container `f` is. Without the ability to make `f` a type parameter of kind `* -> *`, you'd have to write `map` once per container with no way to unify them.

## Question 4

**Explain the Functor → Applicative → Monad hierarchy in one breath each.**

Functor: a container `F` with a lawful `map :: (A -> B) -> F<A> -> F<B>` — transform the contents, keep the structure. Applicative: adds `pure :: A -> F<A>` and the ability to combine *independent* effects (`<*> :: F<A->B> -> F<A> -> F<B>`), so you can apply an n-ary function across several `F` values. Monad: adds `flatMap :: F<A> -> (A -> F<B>) -> F<B>`, letting a *later* effect depend on an *earlier* result. Each is strictly more powerful: every Monad is an Applicative, every Applicative is a Functor.

## Question 5

**Demystify "monad" — what does `flatMap` actually do for `Option`, `Either`, and `List`?**

A monad is just a container of kind `* -> *` with `flatMap` and `pure` obeying laws; nothing mystical. `flatMap` is "run the next step (which returns a container) and flatten one layer." Concretely: for `Option`, `flatMap` stops the chain the moment a `None` appears (short-circuit on absence). For `Either`, it short-circuits on the first `Left`, carrying the error through. For `List`, it runs the function for every element and concatenates the results (a cartesian/non-deterministic product). Same signature, three behaviors.

## Question 6

**What are the functor laws and why do they matter?**

Identity: `fmap id == id` (mapping with "do nothing" does nothing). Composition: `fmap (g . f) == fmap g . fmap f` (two maps fuse into one). They matter because the compiler checks only the *signature* of `map`, never these laws. Generic code built on Functor assumes the laws hold; an instance that violates them (e.g. a `map` that reorders or drops elements) type-checks but silently corrupts every generic caller. The laws are the part of the contract you must verify yourself.

## Question 7

**What is `pure` (a.k.a. `of` / `return`) and why is it sometimes hard to use?**

`pure` lifts a plain value into the minimal container: `pure(3)` is `Some(3)` for `Option`, `[3]` for `List`, `Right(3)` for `Either`. It's hard because its return type is chosen by *context*, not by its argument — `pure(3)` alone is ambiguous; the compiler needs to know which `F` you want (`3.pure[Option]` in Scala, a type annotation in Haskell). This return-type polymorphism is also one of the features that makes HKTs awkward in languages like Rust that resolve methods by receiver.

## Question 8

**Distinguish higher-kinded, higher-rank, and higher-order. They share a word; what's different?**

Higher-**order** is value-level: a function that takes or returns functions (`map`). Every language has it. Higher-**kinded** is type-level: abstracting over a type *constructor* (`F<_>`); Java/Go/Rust can't. Higher-**rank** is also type-level but about *where `forall` sits*: an argument that is itself polymorphic (`(forall a. a -> a) -> ...`), so the function — not the caller — gets to use it at multiple types. They're orthogonal: `traverse` is higher-kinded and higher-order; `runST :: (forall s. ST s a) -> a` is higher-rank but not higher-kinded.

## Question 9

**Why is `Applicative` its own rung instead of just using `Monad`?**

Because `Applicative` combines *independent* effects, which unlocks things `Monad` forfeits by sequencing. Independent effects can be run in parallel and can accumulate *all* failures, not just the first. `Validated` (Applicative) collects every validation error; an `Either`/Monad chain short-circuits at the first. So you choose Applicative deliberately when you want full-error accumulation or parallelism, and when no step depends on a previous result.

## Question 10

**What does `traverse` abstract over, and why is it special?**

`traverse :: Applicative f => (a -> f b) -> t a -> f (t b)` abstracts over *two* constructors at once: `t`, the structure being walked (list, tree, `Maybe`), and `f`, the effect produced (`Either`, `IO`, `Option`). It visits every element, runs an effectful function, and turns a structure-of-effects inside-out into an effect-of-structure. It's special because it's doubly higher-kinded — you literally cannot express "generic over two arbitrary `* -> *` constructors" without HKTs, which is why no Java/Go/Rust equivalent exists.

## Question 11

**Which mainstream languages have native HKTs, and which don't?**

Have them: Haskell (`f a`), Scala (`F[_]`, with Cats/ZIO/Scalaz), PureScript. Don't have them natively: Java, C#, Go (all kind-`*` generics only), Rust (deliberately omitted; GATs are a partial, different step), TypeScript (no native syntax; fp-ts emulates via defunctionalization), Kotlin (Arrow library simulated them). The dividing test: can you write *one* generic `Functor`/`traverse` that works for `List`, `Option`, and `Future` at once? Yes → native HKTs.

---

## Language-Specific

### Haskell

## Question 12

**In `class Functor f where fmap :: (a -> b) -> f a -> f b`, how does the compiler know `f :: * -> *`?**

By kind inference from the use site. Because you write `f a` — applying `f` to a type `a` — `f` must be something that takes a type argument, i.e. kind `* -> *`. If you tried to make `f = Int`, then `Int a` would be a kind error (`Int` takes no arguments). GHC infers the kind of every class/type variable this way; you can also write it explicitly with `KindSignatures`: `class Functor (f :: * -> *)`.

## Question 13

**How do you give a `Functor`/`Monad` instance for `Either`, which has kind `* -> * -> *`?**

You partially apply it. `Either :: * -> * -> *`, but `Either e :: * -> *` — fix the error type `e` and the remaining one-hole constructor fits the Functor/Monad slot. So you write `instance Functor (Either e)` and `instance Monad (Either e)`, where `fmap`/`>>=` operate on the `Right`/last type parameter and pass `Left` through. This is type-level partial application, exactly analogous to currying a value-level function.

## Question 14

**What does `:kind` tell you, and what is the kind of `Functor` itself?**

`:kind` (`:k`) in GHCi reports a type's kind: `:k Maybe` gives `* -> *`, `:k Either String` gives `* -> *` (one of two args supplied), `:k Maybe Int` gives `*`. The class `Functor` itself has kind `(* -> *) -> Constraint`: it's a *higher-order kind* — it takes a `* -> *` constructor and yields a `Constraint` (the kind of things that go left of `=>`). This makes the "kinds are a type system one level up" point concrete.

### Scala

## Question 15

**What does `F[_]` mean in `trait Functor[F[_]]`, and how is it different from `Functor[F]`?**

`F[_]` declares `F` as a unary type constructor, kind `* -> *`, so you can write `F[A]` inside. `Functor[F]` (no underscore) would demand `F :: *` — a finished type — and you couldn't apply it to `A`. The underscore is Scala's syntax for "this parameter still has a hole." It's the marker that you're doing higher-kinded, not ordinary, abstraction.

## Question 16

**How do you write a `Functor` instance for `Either[E, *]` in Scala 3?**

You fix the left type and leave one hole with a type lambda: `[X] =>> Either[E, X]`. For example, `given [E]: Functor[[X] =>> Either[E, X]] with def map[A,B](fa: Either[E,A])(f: A => B): Either[E,B] = fa.map(f)`. The type lambda is Scala's way to partially apply a two-argument constructor to fit a `* -> *` slot — the analogue of Haskell's `Either e`.

## Question 17

**What is the difference between `[F[_]: Monad]` and passing a `Functor[F]` explicitly?**

`[F[_]: Monad]` is a context bound: syntactic sugar for an implicit/`given` `Monad[F]` parameter the compiler resolves automatically from in-scope instances. Passing `Functor[F]` explicitly threads the instance by hand. Native HKT ergonomics come from the implicit resolution — you write `xs.traverse(f)` and the right `Applicative` is found for you. In TypeScript/Kotlin, where there's no such resolution over higher-kinded encodings, you typically pass the instance explicitly, which is much of why the encoded experience is heavier.

### Rust (lack of HKTs and GATs)

## Question 18

**Why can't you write a general `Functor` trait in Rust?**

Because Rust has no way to apply a type parameter (or `Self`) to a varying element type — there's no `Self<A>` / `Self<B>`. A `Functor` needs `fn map<A, B>(self: Self<A>, f: impl Fn(A) -> B) -> Self<B>`, but `Self<A>` is not expressible. You can write `Option::map`, `Result::map`, `Iterator::map` individually, but nothing unifies them into one trait, so there is no generic `traverse` or effect-polymorphism.

## Question 19

**Give the concrete reasons Rust omitted HKTs.**

Four interacting reasons: (1) type inference and *coherence* (one impl per type, orphan rules) become much harder with type-constructor variables — overlap checking and unification explode. (2) Lifetimes: Rust types carry lifetimes, so a "container" often needs to be `F<'a, _>`, abstracting over a *lifetime-parameterized* constructor — strictly harder than HKTs in a GC'd language. (3) Monomorphization interacts awkwardly with constructor-generic code. (4) `pure :: a -> f a` needs return-type polymorphism, which Rust's receiver-based method resolution doesn't naturally provide. None is fatal alone; together the team judged it not yet worth the complexity.

## Question 20

**What are GATs, and do they give Rust higher-kinded types?**

Generic Associated Types (stable since Rust 1.65) let an *associated type* be parameterized by generics or lifetimes, e.g. `type Item<'a>` in a `LendingIterator`. They solve the lending/streaming-iterator problem (yielding items that borrow from the iterator) — long cited as "Rust needs HKTs." But they are *not* HKTs: a GAT parameterizes an *output member* of a trait; an HKT would parameterize the *implementing type by a constructor*. You still can't write `Self<A>` / a general `Functor`. GATs are "a step toward" some HKT use cases, not a substitute.

### TypeScript (HKT encoding)

## Question 21

**TypeScript has no native HKTs. How does fp-ts get `Functor`/`Monad` anyway?**

Via defunctionalization (the "lightweight higher-kinded polymorphism" trick). Each constructor gets a unique tag (a marker / `URI`). A single indexed type — `URItoKind<A>` / `Kind<F, A>` — maps `(tag, A)` to the real applied type through an open registry extended by declaration merging. Typeclasses are parameterized by the tag, and operations use `Kind<F, A>` in their signatures. It's sound and type-safe but you thread the instance and tag by hand, and the `Kind<...>` plumbing leaks into error messages.

## Question 22

**What are the downsides of the defunctionalized encoding versus native HKTs?**

It's verbose (the registry, tags, `Kind<F,A>` everywhere); there's no automatic instance resolution, so you pass `Applicative` instances explicitly; error messages reference encoding noise (`Kind<'Option', A>`, `URIS` constraints) that's hard for non-experts; and multi-argument constructors need extra tag arities (`URIS2`, `URIS3`) or fixed-parameter encodings. It works for libraries willing to pay the cost, but it never feels native — which is why teams quarantine it behind a module boundary or avoid it.

### Kotlin (Arrow)

## Question 23

**How did Kotlin's Arrow library handle HKTs, and what's the lesson?**

Early Arrow emulated HKTs with the same defunctionalization approach (a `Kind<F, A>` interface plus per-type tags), giving Functor/Applicative/Monad-style typeclasses. Over time Arrow moved *away* from heavy HKT emulation toward more direct, concrete, less generic APIs (e.g. concrete `Either`/`Option` combinators, `arrow-core` without the full typeclass hierarchy). The lesson: in a language without native HKTs, the emulation's ergonomics ceiling — boilerplate, poor errors, inference friction — often isn't worth it for application code, even when a dedicated FP library is available.

---

## Tricky / Trap Questions

## Question 24

**"`List` is a type." True or false?**

False — it's a category error. `List` is a *type constructor* of kind `* -> *`; `List<Int>` is the type. You cannot hold a value of type "`List`" any more than you can hold a value of type "`+`". Candidates who casually say "the type `List`" usually haven't internalized kinds. The precise statement is "`List` is a type constructor; applying it to `Int` yields the type `List<Int>`."

## Question 25

**Is `Set` a lawful Functor?**

Generally no. `Functor`'s `fmap :: (a -> b) -> f a -> f b` must work for *any* `b`, but `Set` needs `Ord`/`Eq` on its elements to maintain its invariant. You can't satisfy the unconstrained signature — `Set` is a "looks like a Functor but isn't" trap. It needs a *constrained* Functor class (one that carries an `Ord b` requirement), which is exactly why such constrained variants exist. A candidate who confidently says "yes, just map over it" has missed the constraint.

## Question 26

**Does `fmap`-ing a function that returns a container give you what you want?**

No — you get a nested container. If `f :: A -> F<B>` and you `map` it over `F<A>`, you get `F<F<B>>` (e.g. `Option<Option<B>>`). That nesting is precisely the signal that you wanted `flatMap`, which applies the function and flattens one layer to `F<B>`. Recognizing "I have a box-in-a-box" as the symptom of "I should have used flatMap/bind" is a core fluency check.

## Question 27

**Are monads about side effects?**

No. `Option` and `List` are monads with zero side effects — the monad structure is about *sequencing and flattening*, not I/O. Monads are *famously used* to sequence side effects in Haskell (the `IO` monad), which is where the confusion comes from, but the structure itself is purely about chaining container-returning steps lawfully. A candidate who says "monads model side effects" is conflating one important use with the definition.

## Question 28

**"We use only atomics... er, I mean — does declaring `F[_]: Monad` make my code automatically parallel or efficient?"**

No. `Monad` *sequences* — each `flatMap` step can depend on the previous, which forbids reordering/parallelism in general. If you want independent effects combined (and parallelism or full-error accumulation), you must constrain to `Applicative`, not `Monad`. Asking for `Monad` when `Applicative` suffices both over-restricts your callers and forfeits parallelism. Demand the weakest typeclass that compiles.

## Question 29

**Will an unlawful Functor/Monad instance compile? What breaks?**

Yes, it compiles — the compiler checks the method signatures, never the laws. What breaks is *generic code*: any function written against `Functor`/`Monad` assumes the laws (e.g. `map(f).map(g) == map(g . f)`), so an instance whose `map` reorders or drops elements, or whose `>>=` isn't associative, silently produces wrong results in callers far from the instance. This is why you law-test instances with property-based tests.

## Question 30

**Does Rust's `impl<T> Iterator for Foo<T>` plus `Iterator::map` mean Rust has Functors?**

No. Those are individual, concrete `map`s on specific types. A Functor is *one trait* that unifies `map` across *all* containers so you can write code generic over the container. Rust has many per-type `map`s but no `trait Functor` abstracting over the constructor, hence no generic `traverse`, no effect-polymorphism. Having `.map()` on several types is not the same as being able to abstract over "any mappable container."

---

## Design / Judgment

## Question 31

**Should our codebase adopt HKTs? Walk me through how you'd decide.**

Argue from a ledger, not aesthetics. Signals to adopt: the team is FP-fluent (or hiring for it), the primary language has native HKTs (Haskell/Scala/PureScript), there are many effects/containers with the *same* operations recurring (measurable duplication), and effect-swappability (prod `IO` vs pure test interpreter) is an architectural goal. Signals to avoid: the language lacks native HKTs and encoding cost dominates (Rust, Go, most native-TS app teams), a single effect with no foreseeable second (speculative generality), or onboarding speed / broad hiring pool is a hard constraint. A middle path is contain-to-a-module: HKTs inside a subsystem, a plain API outward. Keep the bet reversible — generic→concrete specialization is cheaper than the reverse.

## Question 32

**What are the real costs of HKT-heavy code, beyond "it's hard to read"?**

Compile time (Scala implicit/given resolution and typeclass derivation can dominate CI and IDE latency), runtime (naive monad-transformer towers cost per-layer allocation/indirection — though modern effect runtimes like Cats-Effect/ZIO fix this), and human costs that usually dominate: slower code review (reviewers must hold kinds + laws + resolution rules in their head), longer onboarding for non-FP engineers, and a shrunken hiring pool / bus factor. The implementation strategy predicts where the bill lands: dictionary-passing languages pay in compile-time search + runtime indirection; monomorphizing languages pay in code size + resolution complexity.

## Question 33

**You want effect-polymorphism but worry about performance. What do you do?**

Separate the abstraction from the naive implementation. The runtime cost people fear comes from *transformer towers* (`StateT (ExceptT IO)`), not from effect-polymorphism itself. Use a fused effect runtime — Cats-Effect `IO`, ZIO's `ZIO[R, E, A]` — or the ReaderT/RIO pattern (one concrete `IO` plus an environment) to keep dependency injection and composability while shedding per-layer overhead. Reject the abstraction only after trying the modern implementation, not the 2014 one.

## Question 34

**When is writing N hand-maintained copies better than one HKT-generic function?**

When you have few effects and a non-FP-fluent team. One concrete `validateAllEither` is more readable and far cheaper to onboard than a `validateAll[F[_]: Applicative]` if `Either` is the only effect you'll ever use. The HKT version wins decisively once you actually have several effects and the same operation recurs across them — then N drifting copies are their own maintenance and bug-drift burden, and the generic version is strictly less code. The skill is telling these apart instead of reflexively reaching for either.

## Question 35

**How would you introduce HKTs into a team without causing a maintainability disaster?**

Decide deliberately (an ADR with the ledger, not adoption-by-accretion of one clever PR at a time). Contain the machinery behind a module boundary so application code and error messages stay clean. Use law-tested library instances (Cats `Discipline`, QuickCheck) rather than bespoke ones. Optimize for the median maintainer — if only the author can review a module, the abstraction has failed operationally. Measure build time and track bus factor as first-class costs. And keep it reversible: start concrete, generalize on the *second* real use, and document how to specialize back.

## Question 36

**A teammate says "GATs mean Rust now has HKTs, so let's build a Functor abstraction." How do you respond?**

Correct the premise. GATs parameterize an *associated type* (e.g. `type Item<'a>`), solving lending/streaming iterators — they do not let you parameterize the *implementing type by a constructor*, so you still can't write `Self<A>` / a general `Functor`. Building a "Functor abstraction" on GATs hits a wall. In Rust, prefer concrete per-type impls or trait-with-`Output<B>`-GAT designs for the specific problem at hand, and don't promise container-genericity the language can't deliver. If genuine HKT-style reuse is essential, that's a signal to question whether Rust is the right language for that layer.

---

## Cheat Sheet

```
+------------------------------------------------------------------+
| HIGHER-KINDED TYPES — MUST-KNOW                                  |
+------------------------------------------------------------------+
| KINDS = types of types. Count the arrows = args still missing.   |
|   Int, List<Int>        :: *            (finished)               |
|   List, Maybe, Option   :: * -> *       (one hole)              |
|   Either, Map           :: * -> * -> *  (two holes)            |
|   Functor               :: (* -> *) -> Constraint (higher-order) |
+------------------------------------------------------------------+
| HKT = abstract over a CONSTRUCTOR (F<_>), not just a type.      |
|   generic length<A>     -> kind-* parameter (ordinary)          |
|   generic map<F<_>>     -> kind-(*->*) parameter (higher-kinded) |
+------------------------------------------------------------------+
| HIERARCHY:  Functor  -> Applicative -> Monad                    |
|   Functor:     map      (transform inside one effect)           |
|   Applicative: pure,<*> (combine INDEPENDENT effects; all errs) |
|   Monad:       flatMap  (later step DEPENDS on earlier result)  |
+------------------------------------------------------------------+
| flatMap, concretely (NOT magic):                                |
|   Option -> short-circuit on None                               |
|   Either -> short-circuit on first Left, carry error            |
|   List   -> run for every element, concatenate (cartesian)      |
+------------------------------------------------------------------+
| THE THREE "HIGHERS":                                            |
|   higher-order  = functions taking functions (value level)      |
|   higher-kinded = abstract over F<_> (type-constructor level)   |
|   higher-rank   = forall UNDER an arrow (polymorphic argument)  |
+------------------------------------------------------------------+
| LANGUAGE SUPPORT:                                              |
|   native:   Haskell (f a), Scala (F[_]), PureScript            |
|   NOT:      Java, C#, Go (kind-* only)                          |
|   Rust:     NO HKTs; GATs = different axis (assoc-type params)  |
|   TS:       no native; fp-ts encodes via defunctionalization    |
|   Kotlin:   Arrow simulated; moved away from heavy emulation    |
+------------------------------------------------------------------+
| ENGINEERING: it's a ledger.                                     |
|   + dedup, swappable effects, fewer bugs (fluent FP teams)      |
|   - compile time, readability, onboarding, hiring/bus factor    |
|   choose: adopt / contain-to-module / avoid; keep it reversible |
+------------------------------------------------------------------+
| TRAPS: "List is a type" (no); Set is a lawful Functor (no);     |
|   fmap of F-returning fn -> nested (use flatMap); monads !=     |
|   side effects; unlawful instances compile; pick weakest class. |
+------------------------------------------------------------------+
```

---

## Further Reading

- *Functional Programming in Scala* — Chiusano & Bjarnason. Builds Functor/Applicative/Monad/Traverse from first principles.
- The Typeclassopedia — Brent Yorgey. The canonical map of Haskell's typeclass hierarchy. https://wiki.haskell.org/Typeclassopedia
- *Lightweight Higher-Kinded Polymorphism* — Yallop & White. The defunctionalization encoding behind fp-ts/Arrow. https://www.cl.cam.ac.uk/~jdy22/papers/lightweight-higher-kinded-polymorphism.pdf
- Niko Matsakis / Rust lang blog — GATs stabilization and the GATs-vs-HKTs distinction.
- Cats and ZIO documentation — production HKT-based libraries and effect runtimes. https://typelevel.org/cats/ , https://zio.dev/
- *The Essence of the Iterator Pattern* — Gibbons & Oliveira. The theory of `traverse`/`Traversable`. https://www.cs.ox.ac.uk/jeremy.gibbons/publications/iterator.pdf
- fp-ts documentation — HKTs encoded in TypeScript. https://gcanti.github.io/fp-ts/
