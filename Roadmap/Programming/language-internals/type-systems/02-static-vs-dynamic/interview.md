# Static vs Dynamic Typing — Interview Questions

> **Topic:** [Static vs Dynamic Typing](README.md)
> **Focus:** Graded questions probing whether a candidate can reason precisely about *when* types are checked, *what* each discipline guarantees, and the hybrids (gradual typing) that dominate real systems.

---

## Introduction

These questions test a precise, mechanical understanding of the static/dynamic distinction — not slogans. A strong candidate keeps three things straight that weak candidates blur: (1) *when* types are checked (compile time vs run time) is a different axis from *strong vs weak* (whether the language coerces); (2) static typing's guarantee is **soundness relative to the errors it models**, not "no bugs"; and (3) the real world is mostly **gradual** — dynamic languages with optional static checking — where the `any` escape hatch and erasure decide whether the guarantee survives. The questions move from foundational vocabulary, through language-specific surfaces, into traps where the textbook answer is wrong, and finally to design judgment.

## Table of Contents

- [Conceptual / Foundational](#conceptual--foundational)
- [Language-Specific](#language-specific)
  - [Java](#java)
  - [TypeScript](#typescript)
  - [Python](#python)
  - [Go](#go)
  - [Haskell](#haskell)
  - [Ruby](#ruby)
- [Tricky / Trap](#tricky--trap)
- [Design](#design)

---

## Conceptual / Foundational

## Question 1

**Define static and dynamic typing precisely. What is the one axis they differ on?**

The axis is *when types are checked*. **Static typing** checks types **before the program runs** — a compiler/checker examines the source (typically the whole program) and rejects type-incorrect programs at build time. **Dynamic typing** checks types **while the program runs** — at the moment each operation executes, the runtime verifies the operand types and raises an exception on mismatch. A secondary distinction follows: in static typing the type is attached to the **variable/expression** (a slot that only holds one type), while in dynamic typing the type is attached to the **value** (variables are untyped labels that can point at anything). A strong answer names the timing as the defining axis and the variable-vs-value attachment as the consequence.

## Question 2

**Is "strong vs weak typing" the same as "static vs dynamic"? Give the grid.**

No — they are orthogonal axes, and conflating them is the most common error in this area. Static/dynamic is *when* types are checked. Strong/weak is *whether the language performs surprising implicit coercions*. They combine freely:

| | Strong | Weak |
|---|---|---|
| Static | Java, Go, Rust, Haskell | C, C++ |
| Dynamic | Python, Ruby | JavaScript, PHP |

The killer example is **Python: dynamic *and* strong** — it checks at runtime (dynamic) but refuses `"5" + 5` (strong, raises `TypeError`). And **C: static *and* weak** — checked at compile time but casts let you reinterpret bytes freely. A candidate who says "dynamic means weak" has the concept wrong.

## Question 3

**What class of error does static typing catch that dynamic typing misses, and vice versa?**

Static catches, *before running and across all paths*: name typos (`usr.naem`), wrong argument types, calls to nonexistent methods, and (if nullability is tracked) unhandled `null`. Crucially it catches these even on branches that never execute. Its cost is **conservatism**: it rejects some programs that would actually run fine, because it can't *prove* them safe. Dynamic typing's strength is the flip side — it never rejects a valid program and is maximally flexible — but it only ever checks the operations that *actually execute*, so a type bug on an untested branch stays invisible until that branch runs (often in production). The honest framing: same errors are caught by both *eventually*; static finds them earlier and more completely, dynamic finds them exactly but late and only on executed paths.

## Question 4

**Why does a static type checker reject some programs that would have run correctly?**

Because "will this program have a type error at runtime?" is undecidable (Rice's theorem) for a Turing-complete language, so the checker must approximate. It approximates **conservatively** — *sound but incomplete*: it never accepts a type-incorrect program (no false negatives), at the price of rejecting some correct ones (false positives). Rejecting an unprovable-but-correct program is the *price of the guarantee*, not a defect. Languages reduce false positives over time by adding type-system features (generics, flow typing) that let the checker *prove* more programs safe — never by admitting unsafe ones.

## Question 5

**What does it mean for a type system to be "sound"? Does sound mean bug-free?**

Soundness is Milner's "well-typed programs don't go wrong" — if the checker accepts a program, it will never reach a *stuck state* (an operation applied to a wrong-typed value) for the operations the system models. Standard proofs factor it into **progress** (a well-typed term isn't stuck) and **preservation** (evaluation keeps it well-typed). The vital caveat: soundness is **relative to the errors the system tracks**. A sound type system says nothing about logic errors, division by zero, array bounds, or `null` — *unless* it specifically models them. So **sound ≠ correct**: a sound program can loop forever, compute wrong answers, and (in most languages) dereference null.

## Question 6

**Explain erasure vs reification and why it matters.**

**Erasure**: type information is removed before runtime (Java generics, TypeScript compiling to JS). You can't query an erased type at runtime — no `instanceof List<String>`, no `T.class`. **Reification**: type information survives to runtime and can be inspected (Python values, Go reflection, C# generics, the JVM's `Class` objects). It matters because: (1) reflection, serialization, and runtime dispatch require reified types; (2) **dynamic typing requires reification by definition** — you can't check types at runtime if they aren't present; (3) erasure is *why* gradual `any` boundaries in TypeScript/mypy leak silently — there's no runtime tag to catch a smuggled wrong value, so the error surfaces downstream instead of at the boundary.

## Question 7

**How can type inference make a statically typed language feel dynamic? Does "no annotations" mean dynamic?**

Inference lets the compiler reconstruct types you didn't write, so source can be as terse as a dynamic language while remaining fully statically checked. **Hindley–Milner** (Haskell, OCaml, ML) is the extreme: zero annotations, and it infers the **principal (most general) type** of every expression, sound and complete for its discipline. Go's `x := 5`, TypeScript's `const`, and C++'s `auto` are local inference. So **"no annotations visible" tells you nothing about static vs dynamic** — `x := 5` in Go is permanently a static `int`. Terseness is a property of *inference*, not of dynamic typing — which undercuts the main ergonomic argument people make for going dynamic.

## Question 8

**What is the single most common runtime type error, and how does static typing address it?**

`null`/`None`/`undefined` having no such attribute or method — `'NoneType' object has no attribute 'x'`, `undefined is not a function`, `Cannot read properties of undefined`. It's the most common production crash in dynamic languages. Static typing addresses it *only if it tracks nullability in the type*: `Option<T>`/`Maybe T`/`T?`/TypeScript's `strictNullChecks` make "maybe-absent" a distinct type the compiler forces you to unwrap before use, converting a 2 a.m. page into a compile error. Plain `null`-in-every-reference-type (old Java/C#) does *not* — it's the "billion-dollar mistake," a deliberate soundness hole.

---

## Language-Specific

### Java

## Question 9

**Java is statically and strongly typed, yet it has runtime type errors like `ClassCastException` and `ArrayStoreException`. How is that consistent with soundness?**

Those come from Java's **deliberate soundness holes**, not from the core type system being unsound where it applies. `ArrayStoreException` comes from **array covariance** (`Object[] a = new String[1]; a[0] = 42;` compiles but fails at runtime) — accepted statically, backstopped by a runtime check. `ClassCastException` comes from **unchecked casts** (`(Integer) someObject`), an explicit escape hatch that hands the check to runtime. And `NullPointerException` comes from `null` inhabiting every reference type. Each is a designed trade of a guarantee for expressiveness/compatibility. A strong answer states: Java is sound *for the operations it models, absent the escape hatches*, and these exceptions mark exactly the escape hatches.

## Question 10

**Are Java generics erased or reified? Show one consequence.**

Erased. `List<String>` and `List<Integer>` are both raw `List` at runtime — `ls.getClass() == li.getClass()` is `true`, and `x instanceof List<String>` doesn't compile. Consequences: you can't do `new T()`, can't get `T.class` for the parameter, and array creation of a generic type is restricted. This contrasts with C#, whose generics are reified (`typeof(List<int>)` is distinct from `typeof(List<string>)`). The erasure was a backward-compatibility decision (pre-generics bytecode), and it shapes every generic-heavy Java design (serialization and DI frameworks work around it with `TypeToken`/`Class<T>` parameters).

### TypeScript

## Question 11

**TypeScript "fully type-checks" a program and it still throws at runtime. Explain precisely why.**

Two mechanisms combine. First, **`any`** (or an unsound cast) disables static checking wherever it flows — a value typed `any` can be assigned to any type with no check, virally, downstream. Second, **erasure**: TypeScript types are removed when compiling to JavaScript, so there's also no *runtime* check at the boundary. A value enters as `any` (e.g., `JSON.parse`), gets assigned to a `User`, and typed code accesses `.name` assuming it exists — but at runtime the value isn't a `User`, and the access yields `undefined`/throws, far from where the `any` was. Contrast a *sound* gradual system (Typed Racket) that inserts a runtime contract at the boundary and *blames* the offending side. TypeScript chose erasure (zero runtime cost, JS interop) and therefore deliberate unsoundness at `any` boundaries.

## Question 12

**What's the difference between `any` and `unknown` in TypeScript, and why does it matter?**

`any` is "turn off the type checker here" — assignable *to and from* everything, and any property access on it is allowed. `unknown` is the type-safe top type — assignable *from* everything but *to* nothing without first narrowing it (via `typeof`, a type guard, or a validated cast). It matters because `any` is viral and silent: one `any` at a data source disables checking for everything derived from it. `unknown` forces a check before use, so it's the correct type for genuinely-dynamic data (parsed JSON, network input). The professional rule: `unknown` at boundaries, never `any`; reach for `any` only as an explicit, tracked "I give up here."

### Python

## Question 13

**Python is dynamically typed. So what do type hints (`def f(x: int) -> str:`) actually do?**

By default, **nothing at runtime** — they are *optional/erased* annotations. The Python interpreter does not check `x: int`; you can call `f("hello")` and Python will run until some operation fails for an unrelated reason. The hints exist for an *external* static checker (mypy, Pyright) that runs as a separate build step, and for IDEs/tooling. So hints add *gradual static checking* on top of Python without changing its dynamic runtime. Libraries like `pydantic` or `typeguard` *opt in* to runtime enforcement, but that's extra machinery, not the language. A strong answer distinguishes "the checker uses them" from "the runtime ignores them."

## Question 14

**Does Python's strong typing prevent `double("5")` from misbehaving where `double` does `n * 2`?**

No — and this question separates candidates who understand the two axes. Python is *strong* (no surprise coercion) but *dynamic* (checked at runtime). `"5" * 2` is a perfectly legal, *intended* operation in Python — string repetition — yielding `"55"`. There's no type error to catch because the operation is valid for strings; it's just not what `double` *meant*. Dynamic + strong can't catch "wrong type that happens to support the operation"; only **static** typing (a `def double(n: int)` checked by mypy, or a statically typed language) flags the call site `double("5")` before running. The bug is a wrong *answer*, not a runtime exception.

### Go

## Question 15

**Go interfaces are satisfied without an `implements` keyword. What is this called, and how does it relate to duck typing?**

It's **structural typing**: a type satisfies an interface if it has the right method set, with no declared relationship. This is the *static, compile-time-checked* version of **duck typing** — "if it has the methods, it qualifies," but verified by the compiler before running rather than discovered at the call site at runtime. Go's `var s Stringer = Point{}` compiles iff `Point` has a `String() string` method; `Point` never mentions `Stringer`. Contrast **nominal** typing (Java/Rust traits) where you must explicitly declare `implements`/`impl`. So Go gives duck typing's flexibility (any conforming type fits, including types you don't own) with a static guarantee — a deliberate middle path.

## Question 16

**Go is statically typed but has `interface{}` (now `any`) and reflection. Is it dynamically typed too?**

No — it's statically typed with **reified runtime types** that enable *opt-in* dynamic behavior. `interface{}`/`any` is a static type (the empty interface, satisfied by everything), but a value stored in it carries a runtime type tag, so you can recover the concrete type via a *type assertion* (`v.(int)`) or *type switch* — which are *runtime, checked* operations that can fail/panic. This is different from a dynamically typed language: in Go, code outside the `interface{}` boundary is fully statically checked; the dynamic behavior is confined to where you explicitly opt in. Reflection (`reflect` package) works precisely because Go reifies types. It's static typing with a controlled dynamic escape hatch, not dynamic typing.

### Haskell

## Question 17

**Haskell has no type annotations in much of its code yet is fully statically typed. How?**

**Hindley–Milner type inference.** The compiler reconstructs the type of every expression without annotations and finds the **principal type** — the single most general type, of which all valid types are specializations. `map` infers `(a -> b) -> [a] -> [b]` with nothing written. HM is sound and complete for its discipline (let-polymorphism, no subtyping), so it accepts exactly the well-typed programs. This is the strongest possible counter to "static typing means lots of annotations" — Haskell source is as terse as Python and fully checked. Programmers often *add* signatures anyway as documentation and to localize type errors, but the compiler doesn't require them.

## Question 18

**How does Haskell's `Maybe` change the `null`-dereference story?**

There is no `null` in Haskell. Absence is modeled explicitly as `Maybe a`, with constructors `Nothing` and `Just a`. A function that might not return a value has type `... -> Maybe Result`, and you *cannot* use the result as a `Result` without pattern-matching both cases — the compiler forces you to handle `Nothing`. This makes the most common runtime crash in dynamic languages a *compile-time exhaustiveness check*. It's the canonical example of "make illegal states unrepresentable": the type system encodes "might be absent" so the unhandled-absent bug literally cannot be written. Rust's `Option`, Kotlin's `T?`, and TypeScript's `strictNullChecks` import this idea.

### Ruby

## Question 19

**Ruby is dynamically typed and famous for duck typing and monkeypatching. How does Sorbet add static typing, and what's the tension?**

Sorbet (built by Stripe) is a **gradual** static type checker for Ruby: you add `sig` signatures to methods, and Sorbet checks call sites at build time, while Ruby's runtime stays dynamic. The tension is Ruby's most dynamic features: **monkeypatching** (adding/replacing methods at runtime) and heavy metaprogramming (`method_missing`, `define_method`) are essentially invisible to a static checker, which reasons about code as written, not as mutated at runtime. Sorbet handles this with a runtime component (`sorbet-runtime` inserts checks), `T.untyped` (Ruby's `any` — the escape hatch), and special handling/`*.rbi` declarations for dynamically-defined methods. It's a pragmatic gradual system that types the static-enough majority and falls back to `T.untyped` for the irreducibly dynamic parts — exactly the `any`-debt trade-off seen in TypeScript and mypy.

## Question 20

**What does duck typing look like in Ruby, and what's its static counterpart?**

Duck typing in Ruby: a method calls `obj.quack` and works for *any* object that responds to `quack`, with the check happening at the call (a `NoMethodError` if it doesn't). No declared interface, no compile-time check — "if it responds to the message, it's acceptable." The static counterpart is **structural typing** (Go interfaces, TypeScript interfaces, Python `Protocol`), which verifies the same "has the right methods" condition *at compile time* by shape. So Ruby duck typing and Go interfaces express the same intuition — interchangeability by capability, not by declared name — differing only in *when* it's checked. Sorbet can approximate it with interface modules + `sig`.

---

## Tricky / Trap

## Question 21

**"Dynamic languages are weakly typed and static languages are strongly typed." True or false?**

False — and a deliberate trap conflating the two orthogonal axes. Counterexamples on both diagonals: **Python is dynamic *and* strong** (refuses `"5" + 5`); **C is static *and* weak** (casts reinterpret bytes freely). Static/dynamic is *when* checks happen; strong/weak is *whether the language coerces*. A candidate who agrees with the statement has the core distinction wrong. The grid (Q2) is the clean rebuttal.

## Question 22

**A teammate says "we use TypeScript, so we can't get `undefined is not a function` anymore." Are they right?**

No. TypeScript reduces that class of error but doesn't eliminate it, for several reasons: (1) `any` and unsound casts disable checking; (2) types are **erased**, so external data (`JSON.parse`, network, `any`-typed libraries) isn't validated at runtime; (3) wrong third-party type stubs (`.d.ts`) assert false guarantees the checker trusts; (4) `strictNullChecks` must be *on* to catch the null/undefined cases at all. So a "fully typed" TS codebase still crashes on malformed input or through `any` holes. The correct statement: TypeScript with `strict` on, plus boundary validation, catches *most* of that class — not all.

## Question 23

**"Static typing proves my program is correct." What's wrong with this claim?**

It overstates the guarantee. Static typing proves **soundness relative to the type errors it models** — not correctness. A well-typed program can have wrong business logic, infinite loops, off-by-one errors, division by zero, and (in most languages) null dereferences. The type checker verifies the *shapes* line up, not that the *computation* is right. The precise statement is "well-typed programs don't go *type-wrong*, for the operations the system tracks, assuming no escape hatches (casts, reflection, `any`, deserialization) are used." Candidates who claim "correctness" don't understand the footnotes on the soundness theorem.

## Question 24

**Python's GIL and dynamic typing both involve "runtime." Is dynamic typing the reason Python is slow?**

Dynamic typing is *a* major reason for interpreter overhead — every operation does type-tag dispatch (`a.__add__(b)`), values are boxed objects, and attribute access is a dict lookup — but it's not the same thing as the GIL (which is about thread parallelism, an orthogonal concern). And "dynamic = slow" is overstated: PyPy's tracing JIT specializes type-stable loops to near-native speed *on the same Python source*, and V8 makes dynamically typed JavaScript fast via hidden classes and inline caches. So the accurate answer: dynamic typing imposes a per-operation cost that naive interpreters (CPython) pay in full, but JITs recover most of it; the slowness of *CPython specifically* is a property of its implementation, not an inevitability of dynamic typing.

## Question 25

**You added type hints to a Python function and it still accepted a wrong-typed argument at runtime. Bug?**

Not a bug — expected behavior. Python type hints are **optional and erased**: the interpreter ignores them at runtime. They guide the external checker (mypy/Pyright) at build time only. If you ran the program without running mypy, the hints had no effect — Python happily passed the wrong type, and you got a runtime error (or wrong answer) for a *different* reason later. If you want runtime enforcement, you must opt in (pydantic, `typeguard`, or manual `isinstance` checks). The trap catches candidates who assume annotations are runtime contracts; in Python (and TypeScript) they aren't.

## Question 26

**Go has `any` (formerly `interface{}`). Does using it make Go dynamically typed?**

No. `any` is a *static* type — the empty interface that everything satisfies — and Go is still statically checked everywhere. The difference from a dynamic language: to *do* anything type-specific with an `any` value, you must perform an explicit, *checked* type assertion or type switch, which the compiler requires and which can fail at runtime in a controlled way. The dynamic behavior is opt-in and localized to those boundaries; everything else is fully statically typed. Overusing `any` makes Go code *feel* dynamic and loses static guarantees at those sites — the same `any`-debt trade-off as TypeScript — but the language remains static.

---

## Design

## Question 27

**You're choosing the language for a new service that will be maintained by a large team for many years. Argue static vs dynamic.**

Lead with the cost-curve framing: dynamic typing's costs (production null/shape crashes on untested paths, terrifying refactors, "what shape is this dict?" archaeology) **grow with codebase size, team size, and age**, while its benefit (fast initial writing) matters less for long-lived code. For a *large, long-lived, multi-team* service, the cost curves favor static — primarily through **refactoring safety** (the compiler exhaustively lists every site a change breaks) and catching the **null/wrong-shape** crash class before production. Cite that the industry trend is one-directional (TS, mypy, Sorbet, Hack) precisely for this regime, and that the empirical evidence, while mixed at small scale, trends positive at scale. If the team's hiring pool or ecosystem strongly favors a dynamic language, pick it and add **gradual static checking** (TypeScript/typed-Python) to get most of the benefit.

## Question 28

**Design a migration plan to add static typing to an 800k-line dynamic codebase (Python or JS).**

(1) Turn the checker on in its most **permissive** mode and get a green build — establish a baseline without fixing everything. (2) Enable **`strictNullChecks` first** — highest safety-per-effort, targets the #1 crash class. (3) Type **boundaries before internals**: public signatures, module interfaces, and data models constrain the most call sites; let inference handle locals. (4) **Validate-and-narrow at every dynamic edge** (HTTP, JSON, DB, config) into precise types — because erased annotations don't check runtime input. (5) Install a **ratchet** in CI: the count of `any`/`type: ignore`/untyped functions may only decrease. (6) Migrate **hot and bug-prone modules first** (most ROI). (7) Measure **real coverage** (non-`any` data flow), not "percent annotated," to avoid the **`any` flood** failure mode. (8) Audit critical library **stubs** — a wrong stub is worse than none. Lean throughout on the **gradual guarantee** to keep the build green and migrate incrementally.

## Question 29

**A team's "fully typed" TypeScript service has the same production crash rate as before. Diagnose.**

The most likely cause is an **`any` flood**: the migration silenced errors with `any`/`@ts-ignore` rather than typing properly, so coverage *looks* complete ("100% annotated") while the actual safety (non-`any` data flow) is near zero — the crashes are identical to the untyped version. Investigate: is `strict`/`strictNullChecks` even on? What fraction of values are `any`/`unknown` un-narrowed? Are boundaries (`JSON.parse`, fetch responses, untyped libs) validated, or assumed? Are the library stubs correct? Fixes: enable strict mode, set an `any` budget and ratchet it down, add boundary validation (Zod/io-ts), and replace `@ts-ignore`s with real types. The lesson: type *presence* isn't type *safety*; the guarantee is only as strong as the least-typed path through the data.

## Question 30

**When would you deliberately choose dynamic typing (or stay dynamic) for a project?**

When the deferred costs static typing prepays won't materialize, or flexibility is the point: (1) **small, short-lived code** — scripts, one-off automation, notebooks — where the bug-catching value is lowest and time-to-running is everything; (2) **exploratory/early-stage** work whose data shapes change daily, where fighting the checker over molten designs is pure friction (prototype dynamic, type later); (3) **inherently shape-dynamic** domains — interpreters, REPLs, plugin systems, glue over wildly-varying external data — where runtime flexibility, metaprogramming, and monkeypatching are core to the design; (4) **strong team/ecosystem fit** for a dynamic language where rewriting would cost more than the typing would save. The mature answer matches the discipline to the system's *lifetime, scale, and failure cost* — and notes you can still add *gradual* checking later if the project outgrows its dynamic phase.

---

## Cheat Sheet

```text
+------------------------------------------------------------------+
|   STATIC vs DYNAMIC TYPING — INTERVIEW MUST-KNOW                  |
+------------------------------------------------------------------+
| 1. Axis = WHEN checked. static=compile time, dynamic=run time    |
|    type on VARIABLE (static) vs on VALUE (dynamic)               |
| 2. strong/weak is ORTHOGONAL (coercion). Python=dyn+strong,      |
|    C=static+weak. Never say "dynamic means weak."                |
| 3. static catches typos/wrong-args/missing-methods on ALL paths  |
|    BUT rejects some valid programs (conservative, sound+incompl) |
| 4. sound = "no type-wrong" for MODELED errors, sans escape hatch |
|    sound != correct (logic/null/bounds/div0 may remain)          |
| 5. erased (Java gen, TS) vs reified (Python, Go, C# gen).        |
|    dynamic REQUIRES reification. erasure => `any` leaks silently |
| 6. inference (Hindley-Milner) => terse static. no-annot != dyn   |
| 7. #1 crash = null/None/undefined; Option/Maybe/?/strictNull fix |
| 8. GRADUAL = dynamic + optional static (TS, mypy, Sorbet, Hack). |
|    any/Any = viral escape hatch; prefer `unknown` + validate edge|
| 9. duck(runtime) ~ structural(compile) ~ nominal(declared)       |
|10. trend one-directional toward static at scale; refactor safety |
+------------------------------------------------------------------+
```

---

## Related Levels

- `junior.md` — the core distinction, strong-vs-weak, the canonical crash.
- `middle.md` — gradual/optional typing, `any`, duck/structural/nominal.
- `senior.md` — soundness, erasure/reification, inference, where guarantees break.
- `professional.md` — performance, the empirical evidence, the industry trend, migration.
- `tasks.md` — exercises to make all of the above muscle memory.
