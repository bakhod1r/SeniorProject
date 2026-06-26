# Type Inference — Interview Questions

> **Topic:** [Type Inference](README.md)

---

## Introduction

These questions probe whether a candidate understands type inference as a *mechanism* — the compiler deducing types from clues — rather than as magic or as a synonym for dynamic typing. A strong candidate distinguishes local inference (`var`, `auto`, `:=`) from global Hindley-Milner inference, can explain unification and let-polymorphism in plain terms, knows precisely which language features break full inference (subtyping, overloading, higher-rank, polymorphic recursion), and treats annotations as documentation, error-localization anchors, and inference seeds simultaneously. A weaker candidate conflates inference with dynamic typing, thinks "the compiler just figures it out," and cannot explain why an empty list or a `read`/`show` chain forces an annotation.

The questions move from conceptual foundations, through language-specific surfaces (Haskell/ML HM, Rust, TypeScript, C++ `auto`, Java `var`/diamond, Scala), into traps where the textbook answer is wrong, and finally to design judgment about annotation policy.

## Table of Contents

- [Conceptual / Foundational](#conceptual--foundational)
- [Language-Specific](#language-specific)
- [Tricky / Trap Questions](#tricky--trap-questions)
- [Design / Judgment](#design--judgment)
- [Cheat Sheet](#cheat-sheet)
- [Further Reading](#further-reading)

---

## Conceptual / Foundational

## Question 1

**Is type inference the same as dynamic typing?**

No, and conflating them is the most common misconception. Type inference is a feature *of static typing*: the compiler deduces a type you didn't write, fixes it at compile time, and enforces it forever. `var x = 5` makes `x` an `int` permanently — `x = "s"` is a compile error. Dynamic typing (Python, JavaScript) defers type checking to runtime and lets a variable hold different types over its lifetime. Inference removes *keystrokes*, not *checking*. The litmus test: in an inferred language, reassigning to a different type is a compile error; in a dynamic language it is allowed.

## Question 2

**What is the difference between local and global type inference?**

Local (or limited) inference works *within a scope* but requires annotations at boundaries — function signatures, public fields. C++ `auto`, Java `var`, C# `var`, Go `:=`, and Rust's function-body inference are all local: you still write parameter and return types. Global (whole-program) inference — Hindley-Milner in ML, OCaml, and Haskell — can infer types for an entire program with *no* annotations, including all parameters and return types. The trade is that global inference is restricted to a clean type system (rank-1 parametric polymorphism), while local inference coexists with subtyping and overloading at the cost of needing boundary annotations.

## Question 3

**Explain Hindley-Milner inference in four steps.**

(1) **Fresh type variables:** assign a new placeholder (`t0`, `t1`, ...) to every unknown — each parameter, each unannotated result. (2) **Constraint generation:** walk the program; every *use* of a value imposes an equation (applying `(+)` to `x` forces `x = Int`). (3) **Unification:** solve the equations by substitution — a variable binds to anything (subject to the occurs-check), matching constructors recurse, mismatched constructors (`Int = Bool`) are a type error. (4) **Generalization:** at `let` bindings, turn the remaining free type variables into `forall`, making the binding polymorphic and reusable at many types. The result is the program's most general (principal) type.

## Question 4

**What is unification and what is the occurs-check?**

Unification (Robinson, 1965) makes two type expressions equal by finding a substitution for their variables — it's "solving simultaneous equations" for types. A variable unifies with any type; `A -> B` unifies with `C -> D` by unifying `A=C` and `B=D`; distinct constructors clash. The **occurs-check** is the guard that, before binding variable `a` to type `T`, verifies `a` does not occur *inside* `T`. Without it, `a = a -> b` would build an infinite type. This is exactly why `\x -> x x` (self-application) fails to typecheck in ML/Haskell — applying `x` to itself demands its type contain itself.

## Question 5

**What is a principal type, and why does it matter?**

A principal type is the single *most general* type of an expression, of which every other valid type is an instance. `\x -> x` has principal type `forall a. a -> a`; `Int -> Int` and `Bool -> Bool` are just instances. HM guarantees that every well-typed expression *has* a principal type and that the algorithm *finds* it with no annotations. This is why ML-family functions are maximally reusable "for free" — you never accidentally get an over-specialized type, so `map`, `compose`, and `id` work across all types automatically.

## Question 6

**What is let-polymorphism, and how do `let` and lambda differ?**

Let-polymorphism is HM's rule that `let`-bound definitions are *generalized* (made polymorphic) while lambda parameters are *monomorphic* (one fixed type). `let id = \x -> x in (id True, id 0)` works: `id` is generalized to `forall a. a -> a` and each use instantiates a fresh type. But `\id -> (id True, id 0)` fails: `id` is a lambda parameter, locked to one type, so `id True` (needs `Bool -> _`) clashes with `id 0` (needs `Int -> _`). The reason for the restriction: generalizing lambda parameters would require guessing a polymorphic type before seeing the body, which is undecidable. `let` lets HM infer the type first, *then* generalize.

## Question 7

**Why is Hindley-Milner decidable and fast, yet limited?**

HM occupies a sweet spot: parametric polymorphism, **rank-1** (all `forall`s at the outermost level), no subtyping, no overloading. Within that box, inference is decidable and near-linear in practice. The limitation *is* rank-1: you can have `forall a. a -> a`, but not `(forall a. a -> a) -> Int` (a function taking a polymorphic function — rank-2). Inferring higher-rank placement of `forall`s is undecidable, which is why Haskell requires a signature for higher-rank functions. The same box excludes subtyping and overloading, both of which break the clean unification HM relies on.

## Question 8

**Why does subtyping make inference harder?**

HM's engine unifies types to *equality*. Subtyping replaces equality with a *relation* — `Dog <: Animal`, `Int <: Number`. When a function expects `Animal` and you pass a `Dog`, you don't want `Dog = Animal` (false), you want `Dog <: Animal` (true). Inference must now solve *subtyping constraints*, which form a lattice rather than a simple substitution, and the general problem (inference with subtyping plus polymorphism) is intractable or undecidable in the forms programmers want. This is the structural reason **object-oriented languages have weaker inference than ML** — subtyping is in their core and poisons clean unification, so they infer only *locally*.

## Question 9

**What is bidirectional type checking and why do modern languages use it?**

Bidirectional typing splits inference into two modes: **synthesis** (`e ⇒ T`, "read a type out of this term") and **checking** (`e ⇐ T`, "does this term fit this expected type?"). Information flows up from leaves (literals, known functions synthesize) and down from annotations and context (lambdas, branches are checked); an annotation `(e : T)` bridges the two. Rust, Scala, Swift, Kotlin, TypeScript, and modern Haskell all use it. The wins over HM: it *composes with subtyping and higher-rank types* (which HM can't infer but can check), and it gives **dramatically better error locality** — a mismatch is reported where synthesized and expected types fail to meet, near your code, instead of HM's far-flung unification failure.

## Question 10

**Why are type annotations valuable even when inference doesn't need them?**

Three reasons at once. (1) **Documentation:** a signature is the most-read, least-stale form of docs. (2) **Error localization:** an annotation is a firewall — a mistake inside an annotated function is reported *in* that function, not leaked as confusing errors to every caller. (3) **Inference anchor:** a written type seeds the solver, preventing widening, resolving ambiguity, and stabilizing inference against unrelated edits. Idiomatic Haskell writes top-level signatures despite full inference precisely for documentation and error localization.

---

## Language-Specific

## Question 11

**(Haskell/ML) What does `\x -> x` get inferred as, and why?**

`forall a. a -> a` — the polymorphic identity. The body returns the parameter unchanged, imposing no constraint on its type, so HM assigns `x` a fresh variable `t0`, finds no equation forcing `t0` to anything concrete, and the function's type is `t0 -> t0`. At the binding, generalization quantifies the free variable: `forall a. a -> a`. This is its principal type — the most general possible — so the identity works at every type with no annotation.

## Question 12

**(Haskell) Why does `show (read s)` give an "ambiguous type variable" error?**

`read :: Read a => String -> a` and `show :: Show a => a -> String`. The intermediate value's type `a` is constrained by both `Read` and `Show`, but it **appears nowhere in the result** (the result is `String`). Inference therefore cannot determine *which* type's `read`/`show` instances to use — there's no information to pin `a`. GHC reports "ambiguous type variable `a`." The fix is an annotation that pins it: `show (read s :: Int)`. This is the canonical example of overloading defeating inference: the types are solvable, but instance resolution is ambiguous.

## Question 13

**(Haskell) Explain the monomorphism restriction with an example of it biting a beginner.**

The monomorphism restriction says certain bindings — those that look like *values*, not syntactic functions (no arguments on the left), and that carry a class constraint — are *not* generalized; they're forced to a single monomorphic type. A beginner writes `let g = read` hoping to use it as `g "1" :: Int` and `g "2.0" :: Double`, but the MR locks `g` to one type, so the second use clashes. The rationale: generalizing a shared *value* could silently turn one computation into many re-evaluations and leave ambiguous constraints. The fix is exactly what the rule nudges you toward — write a type signature, or enable `NoMonomorphismRestriction`. It's inference *deliberately refusing* to infer, to protect you.

## Question 14

**(Rust) Rust has no HM-style global inference, yet `let v = Vec::new(); v.push(3u8);` works. How?**

Rust performs local, bidirectional inference within a function body and collects constraints from *all* uses before solving — not just the initializer. `Vec::new()` starts with an unknown element type; the later `v.push(3u8)` adds the constraint "element = u8"; Rust unifies and infers `Vec<u8>`. But it stays *local*: function parameter and return types must be annotated. If you *never* pushed anything, there'd be no constraint and Rust would demand an annotation ("type annotations needed"), exactly like HM facing an empty container.

## Question 15

**(Rust) Why does `let v: Vec<i32> = data.iter().map(...).collect();` need the annotation, but it can sometimes be omitted?**

`collect` is generic over its *return* container: `fn collect<B: FromIterator<...>>(self) -> B`. The target type `B` appears only in the return position, so inference can't determine it from the iterator alone — it needs a target. The annotation on `v` (or `collect::<Vec<i32>>()`) supplies the checking context. It can be omitted when the surrounding context already pins the type — e.g. the function's annotated return type *is* `Vec<i32>` and you `return ....collect()`, so the return type flows in as the checking context.

## Question 16

**(TypeScript) Explain contextual typing with a `.map` example.**

Contextual typing is TypeScript's checking mode: the expected type from context guides inference of an expression. In `[1, 2, 3].map(x => x.toFixed(2))`, the callback's parameter `x` is inferred as `number` because `Array<number>.map` expects a callback `(x: number) => ...` — the type flows *in* from `map`'s signature and the array's element type. No annotation on `x` is needed. Remove the context (`const f = x => x.toFixed(2);`) and `x` has nothing to check against, becoming an implicit `any` (an error under `noImplicitAny`).

## Question 17

**(TypeScript) What does `as const` do, and when do you need it?**

By default TypeScript *widens* literals: `const x = "red"` infers `string`, and `{ kind: "circle" }` infers `{ kind: string }`. `as const` switches off widening, inferring the narrow, readonly literal type: `"red"` stays `"red"`, the object becomes `{ readonly kind: "circle" }`, and an array becomes a readonly tuple of literals. You need it when the literal type carries meaning — discriminated unions, route tables, action-type constants — and widening to `string` would break assignment to a literal-union type or lose the discriminant.

## Question 18

**(C++) What does `auto` infer, and what's its most surprising default?**

`auto` deduces the type from the initializer using template-argument-deduction rules. The most surprising default: **`auto` strips top-level `const` and references**. Given `const std::string& r = get();`, `auto x = r;` makes `x` a *copy* (`std::string`), not a `const std::string&`. To bind by reference you must write `auto&` or `const auto&`. This catches engineers expecting `auto` to "preserve the type" — it preserves the *value type*, not the reference/const qualifiers. (`decltype(auto)` preserves them.)

## Question 19

**(Java) What can `var` be used for, and what can't it? What does the diamond `<>` infer?**

Java's `var` (Java 10+) works *only* for local variables *with an initializer* — not for fields, method parameters, return types, or `var x;` with no initializer (nothing to infer from). It's local, initializer-driven, and fully static. The diamond `<>` (Java 7+) infers the *generic type arguments* of a constructor from the target type on the left: `List<String> xs = new ArrayList<>();` reads `List<String>` and fills `<>` as `<String>`. Note `var list = new ArrayList<>();` is a trap — with no left-side target and an empty constructor, it infers `ArrayList<Object>`.

## Question 20

**(Scala) How does Scala's inference differ from Haskell's, and why?**

Scala uses *local, bidirectional* inference, not global HM, because Scala has *subtyping* (it's object-oriented) and subtyping breaks HM-style global unification. So Scala infers within expressions and lets expected types flow into lambdas (`List(1,2,3).map(x => x*2)` infers `x: Int`), but it generally requires annotations on method parameters and on recursive/public method return types. Haskell, lacking subtyping in its core, can infer an entire program. The presence of subtyping is the single biggest reason Scala "infers less" than Haskell — it's a fundamental consequence of the type system, not a weakness of the compiler.

## Question 21

**(C# / Go) Compare `var` in C# and `:=` in Go.**

Both are local, initializer-driven, fully static inference with the same spirit as Java's `var`: the compiler reads the right-hand side and fixes the type. Differences are mostly syntactic. Go's `:=` is a *short variable declaration* that both declares and initializes, usable only inside functions; at package level and for parameters you write types. C#'s `var` is a declaration modifier with the same local scope. Neither makes the language dynamic (C# also has `dynamic`, which is a genuinely different, runtime-typed feature — not to be confused with `var`). Both forbid use without an initializer.

---

## Tricky / Trap Questions

## Question 22

**Does `var x = 0;` infer `long` if you later assign a huge value?**

No — and this is a real bug source. `0` is an `int` literal, so `var x = 0;` (or `auto x = 0;`) infers `int`, fixed at that point. A later `x = 5_000_000_000;` overflows or fails to compile; inference does *not* retroactively widen the type to fit a future value. Inference reads the *initializer*, and the initializer was `int`. If you need `long`/`i64`, annotate or use a typed literal (`0L`, `0i64`).

## Question 23

**Is `\id -> (id True, id 0)` valid in Haskell? Why or why not?**

No. `id` here is a *lambda parameter*, which is monomorphic — it has one fixed type. `id True` forces that type to be `Bool -> _`; `id 0` forces it to be `Int -> _`; `Bool` clashes with `Int`, so it's a type error. The polymorphic version `let id = \x -> x in (id True, id 0)` *is* valid because `let`-binding generalizes `id` to `forall a. a -> a`. The trap is assuming `id` adapts per use like a `let`-bound name — only `let`/`where` bindings (and explicit higher-rank annotations) are polymorphic.

## Question 24

**The compiler reports a type error in function `report`, but `report` looks correct. Where's the bug likely to be?**

Probably *upstream* — in a function `report` calls — and HM's unification surfaced the contradiction at `report`'s use site rather than at the real definition. Unification reports a clash *wherever it's found*, which is frequently far from the actual mistake (e.g. a helper with a wrong return type). Don't trust the line number; trace the types backward, and annotate the suspected boundary function. Adding a correct signature to the *upstream* function relocates the error to its true home and often makes `report`'s error vanish.

## Question 25

**Your TypeScript `const FLAGS = { on: "on" }` won't pass to a `"on" | "off"` parameter. Why?**

Widening. `const FLAGS = { on: "on" }` infers `{ on: string }`, not `{ on: "on" }` — TypeScript widens the string literal to `string`. A `string` is not assignable to the literal union `"on" | "off"`. The fix is to stop widening: `const FLAGS = { on: "on" } as const;` infers `{ readonly on: "on" }`, and now `FLAGS.on` has type `"on"`, which is assignable. This is the everyday face of TS widening breaking literal-union logic.

## Question 26

**`for (auto x : bigVector)` is slow. What's wrong?**

`auto` deduces `x` as the element *value type*, so each iteration **copies** the element. For a `vector` of large objects that's an expensive copy per element. Use `for (const auto& x : bigVector)` to bind by reference and avoid the copy (or `auto&` if you mutate). This is a correctness-adjacent performance bug born directly from `auto` stripping references — convenient inference producing the wrong default.

## Question 27

**Why does `let v = Vec::new();` with nothing else fail in Rust but `let v = vec![1,2,3];` succeeds?**

`vec![1,2,3]` contains elements, so inference reads the constraint "elements are `i32`" and infers `Vec<i32>`. `Vec::new()` is empty and, if `v` is never used in a way that pins the element type, there is *no constraint at all* — inference has nothing to solve and reports "type annotations needed." It's the same principle as an empty container in any inferring language: no clue, no inference. Supply the clue (`Vec::<i32>::new()`, an annotation, or a later `push`).

## Question 28

**Does Hindley-Milner ever infer a *less* general type than necessary?**

No — that's the point of the principal-type guarantee. HM always infers the *most* general type consistent with the code; it never needlessly specializes. If you wanted `Int -> Int` but wrote code that permits `forall a. a -> a`, HM gives you the general type, and that's usually a feature. The flip side trap: an *over*-general inferred type can defer a type error to a confusing distant call site, which is when you annotate to *constrain* it deliberately.

## Question 29

**Can you infer the type of a polymorphically recursive function?**

No — type inference for polymorphic recursion (a recursive function used at a *different* type within its own body, common with nested datatypes) is undecidable (Henglein, 1993). You must supply a type signature; with the signature, *checking* the function is decidable and easy. It's another instance of the inference-vs-checking asymmetry: inferring where the polymorphism goes is undecidable, but verifying a written polymorphic type is tractable.

## Question 30

**Two TypeScript files compiled fine, but an upgrade broke one. The "type" never changed in source. How?**

The broken type was probably *inferred*, and TypeScript's inference rules (widening, contextual typing, best-common-type behavior) evolve between versions. Code that relied on a particular inferred type can shift when the compiler's inference changes. The lesson and fix: **annotate load-bearing types** — especially public boundaries and config — so upgrades can't silently re-infer them differently. Inferred boundary types are an invisible API; pin them.

---

## Design / Judgment

## Question 31

**Where in a codebase should you require annotations, and where should you let inference run?**

Annotate **boundaries** — exported functions (parameters and return types), public fields, DTOs at system edges, config objects. Boundaries are read most (documentation), are the error firewall (localization), are the inference seed (anchoring), and are the stability surface (annotated public types decouple a module from its callers). Let inference run for **bodies** — local temporaries with manifest types, builder/iterator chains anchored only at the final assignment, and callbacks with contextual typing. "Annotate boundaries, infer bodies" is the default policy for nearly every team, and it should be enforced by a linter, not by review comments.

## Question 32

**How do you resolve the `auto`/`var` readability debate on a team?**

Replace dogma with a testable rule and a linter. Allow inference when the type is *manifest on the line* (`var users = repo.findAll();`); forbid it when it isn't (`var x = process();` — write the type); always annotate when the specific type matters (numeric width, `auto`-copies-not-references). Then encode it in CI (`@typescript-eslint/explicit-module-boundary-types`, a C++ guideline, a review rubric) so the argument doesn't recur per PR. Recognize the context dependence: server code reviewed in plain diffs leans explicit; template-heavy generic C++ leans `auto`. Pick per codebase and automate enforcement.

## Question 33

**A type error points at the wrong line and the team is stuck. What's your move?**

Treat the misleading error as a *missing anchor*, not bad luck. (1) Reveal the actually-inferred types around the reported site (IDE hover, or a deliberate `let _: () = v;`/`never` to force the compiler to print them). (2) Compare inferred vs. intended to find the divergence. (3) Add a type signature to the *boundary* function you suspect owns the type. Bidirectional checking (or, in HM, a fresh annotation seed) then traps the mismatch *at that boundary*, relocating the error to its true cause. Spread this loop as a team skill — it turns hours of confusion into minutes.

## Question 34

**When would you choose a language with full global inference (Haskell/OCaml) vs. one with local inference plus subtyping (Scala/TS/Rust)?**

Global inference shines for data-transformation-heavy, parametrically polymorphic code where annotations would be pure noise and you want "if it compiles, it's probably right." Local-inference-with-subtyping languages are the pragmatic default when you need OO modeling, structural/nominal subtyping, gradual interop (TS with JS), or systems-level control (Rust) — accepting that you must annotate boundaries because subtyping precludes clean global inference. The deeper point for an interviewer: the choice isn't "more inference is better"; it's which *type system* you need, and the inference power follows from that.

## Question 35

**Argue for and against making a public function's return type inferred.**

*For:* less boilerplate; the body's evolution doesn't require updating a signature; concise. *Against (and decisive for public APIs):* an inferred public return type is an **invisible, unversioned API** — a change inside the function that still compiles locally can silently alter the exported type and break or subtly change consumers; errors in callers are poorly localized; and IDE-less readers (diffs, code review) can't see the type. The professional verdict: infer return types for *private* helpers freely, but **annotate every public/exported return type** as a stability contract and documentation, even when inference could supply it.

## Question 36

**How does type-driven (signature-first) development change the role of inference?**

It inverts the junior workflow. Instead of writing code and letting inference name everything, you write the *annotated contract* first — the function signature, the data model — and let inference fill the *body* against that fixed target. Inference becomes an *assistant within* a stated type rather than the *author* of types. Benefits compound: the boundary is documented and stable from day one, errors are localized from the start (the body is checked against the signature), and the body still enjoys concise inferred locals. It's standard in Haskell and idiomatic for public surfaces in Rust and TypeScript.

---

## Cheat Sheet

```text
+--------------------------------------------------------------+
| Type Inference — Interview Must-Know                          |
+--------------------------------------------------------------+
| 1. Inference != dynamic typing                               |
|    Static, compile-time, FIXED type — just unwritten         |
|                                                              |
| 2. Local vs global                                           |
|    Local: var/auto/:= — annotate signatures (subtyping OK)   |
|    Global: HM (ML/OCaml/Haskell) — zero annotations, rank-1  |
|                                                              |
| 3. HM = 4 steps                                              |
|    fresh vars -> constraints -> UNIFY -> generalize at let   |
|    occurs-check forbids infinite types (no \x -> x x)        |
|                                                              |
| 4. let-polymorphism                                          |
|    let id = \x->x  : forall a. a->a  (generalized)           |
|    \id -> ...      : monomorphic param — FAILS at two types  |
|                                                              |
| 5. Principal type = most general; HM always finds it         |
|                                                              |
| 6. What breaks full inference (=> annotate):                 |
|    subtyping, overloading/typeclasses, higher-rank,          |
|    polymorphic recursion, monomorphism restriction           |
|                                                              |
| 7. Bidirectional = synthesis (out) + checking (in)           |
|    modern langs; composes w/ subtyping; localizes errors     |
|                                                              |
| 8. TypeScript: contextual typing, best-common-type,          |
|    generic-from-args, `as const` to stop widening            |
|                                                              |
| 9. C++ auto strips &/const (copies!); Java var = locals only |
|    Java <> infers generic args from the target type          |
|                                                              |
| 10. Annotation = docs + error firewall + inference anchor    |
|     Policy: annotate BOUNDARIES, infer BODIES                |
+--------------------------------------------------------------+
```

---

## Further Reading

- *Principal Type-Schemes for Functional Programs* — Damas & Milner, 1982. The Algorithm W paper.
- *Types and Programming Languages* — Pierce. Ch. 22 (type reconstruction); the canonical text.
- *Local Type Inference* — Pierce & Turner, 2000. The basis of Scala/C#/Rust-style inference.
- *Bidirectional Typing* — Dunfield & Krishnaswami, 2021. The modern survey of synthesis/checking.
- *The TypeScript Handbook* — "Type Inference," "Contextual Typing," `as const`.
- *Style Guidelines for Local Variable Type Inference in Java* — Stuart Marks. The `var` `when`-to-use authority.
- *Almost Always Auto* — Herb Sutter. The C++ `auto` debate.
- *Type inference for polymorphic recursion is undecidable* — Henglein, 1993.
