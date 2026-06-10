# Composition — Interview Q&A

> **Roadmap:** [Functional Programming](../README.md) → Composition
>
> *Composition is gluing small functions end-to-end so the output of one becomes the input of the next. `compose(f, g)(x) == f(g(x))`. Master the order, the laws, and where the abstraction stops paying.*

A bank of 50+ interview questions and answers on function composition — from "what is it" through railway-oriented programming, category-theory laws, and the allocation/inlining cost of composing at scale. Each answer models the reasoning a strong candidate gives, including the trade-offs. Use the `<details>` toggles to self-quiz: read the question, answer out loud, then expand.

Languages used throughout: **Go**, **Java**, **Python**, with **Haskell** asides where the pure form clarifies the idea.

---

## Table of Contents

1. [Fundamentals / Junior](#fundamentals--junior)
2. [Intermediate / Middle](#intermediate--middle)
3. [Senior — Design at Scale](#senior--design-at-scale)
4. [Professional / Deep — Laws, Cost, Fusion](#professional--deep--laws-cost-fusion)
5. [Code-Reading — What Does This Compute?](#code-reading--what-does-this-compute)
6. [Curveballs](#curveballs)
7. [Rapid-Fire / One-Liners](#rapid-fire--one-liners)
8. How to Talk About Composition in Interviews
9. [Summary](#summary)
10. [Related Topics](#related-topics)

---

## Fundamentals / Junior

> Definitions, the compose-vs-pipe distinction, and order of application.

**Q1. What is function composition?**

<details><summary>Answer</summary>

Function composition is combining two or more functions so that the output of one feeds directly into the input of the next, producing a single new function. Mathematically, `(f ∘ g)(x) = f(g(x))`: apply `g` to `x`, then apply `f` to the result. The composed function has the input type of `g` and the output type of `f`, and the intermediate type must match (`g : A → B`, `f : B → C` gives `f ∘ g : A → C`). It lets you build complex transformations out of small, independently-tested pieces without naming the intermediate values.
</details>

**Q2. What's the difference between `compose` and `pipe`?**

<details><summary>Answer</summary>

They do the same thing in opposite reading order. `compose(f, g, h)(x) = f(g(h(x)))` — applies **right-to-left**, mirroring the math notation `f ∘ g ∘ h`. `pipe(f, g, h)(x) = h(g(f(x)))` — applies **left-to-right**, in data-flow order ("first `f`, then `g`, then `h`"). `pipe` usually reads more naturally because it matches the order things actually happen and the order you'd read a Unix pipeline. `compose` matches the textbook `∘` and the order you'd write nested calls by hand. Pick one convention per codebase and stick to it.
</details>

**Q3. `compose(f, g)(x)` — is it `f(g(x))` or `g(f(x))`?**

<details><summary>Answer</summary>

It's `f(g(x))` — `g` runs **first**, `f` runs **second**. The standard `compose` follows the mathematical `f ∘ g`, where the rightmost function is applied to the argument first and results flow leftward. This is the single most common composition mistake: people read left-to-right and assume `f` runs first. If you want `f` first, you want `pipe(f, g)` (or `compose(g, f)`). When in doubt, type-check it: `g`'s parameter type must match `x`, because `g` is the one that touches `x`.
</details>

**Q4. Write a two-argument `compose` in Python and Go.**

<details><summary>Answer</summary>

Python:

```python
def compose(f, g):
    return lambda x: f(g(x))

shout = compose(str.upper, str.strip)
shout("  hi  ")   # "HI"  — strip first, then upper
```

Go (generics, Go 1.18+):

```go
func Compose[A, B, C any](f func(B) C, g func(A) B) func(A) C {
    return func(x A) C { return f(g(x)) }
}
```

Go's static typing forces the intermediate type `B` to line up at compile time, which is exactly the constraint composition depends on.
</details>

**Q5. Why is composition useful — what does it buy you over just calling functions inline?**

<details><summary>Answer</summary>

It lets you name and reuse a *pipeline* as a value, not just the steps. You build big transformations from small, separately-testable functions; each piece does one thing and can be verified in isolation, and the composition itself carries no logic to test beyond "the wiring." It encourages point-free, declarative code that reads as "what happens to the data" rather than "manage these temporary variables." And because a composed function is just a function, you can pass it around, store it, and compose it further — composition is closed under itself.
</details>

**Q6. What is the identity function and why does it matter for composition?**

<details><summary>Answer</summary>

`identity(x) = x` returns its argument unchanged. It's the **neutral element** of composition: `compose(f, identity) == compose(identity, f) == f`. That makes it the natural "do nothing" step — useful as a default in a fold over a list of transformations (`reduce(compose, steps, identity)`), as a no-op branch in conditional pipelines, and as a placeholder while building one up. In category-theory terms it's the identity morphism, and its existence is one of the two laws that make functions-and-composition a category (see the laws question later).
</details>

**Q7. How does composition relate to `map` / `filter` / `reduce`?**

<details><summary>Answer</summary>

`map` *lifts* a function to work over a container, and composing functions inside `map` is everyday composition: `map(compose(f, g), xs)`. A key identity is the **map fusion law**: `map(f, map(g, xs)) == map(compose(f, g), xs)` — two passes collapse into one. `filter` composes by ANDing predicates. `reduce` is how you compose a *dynamic* list of functions into one (`reduce(compose, fns, identity)`). So composition is the glue and `map`/`filter`/`reduce` are the most common things you glue. See [Map / Filter / Reduce](../04-map-filter-reduce/interview.md).
</details>

**Q8. Does the order of functions in a composition matter? Give an example where swapping breaks it.**

<details><summary>Answer</summary>

Yes — composition is **not commutative** in general. `compose(double, increment)(3)` = `double(increment(3))` = `double(4)` = `8`, but `compose(increment, double)(3)` = `increment(double(3))` = `increment(6)` = `7`. Beyond different numbers, swapping can break *types*: `compose(len, str)` (length of the string form) type-checks, but `compose(str, len)` is a different function entirely, and `compose(toUpper, parseInt)` won't even compile because `toUpper` doesn't accept an `int`. Order is part of the meaning.
</details>

**Q9. What does "the types have to line up" mean in composition?**

<details><summary>Answer</summary>

For `compose(f, g)` to be valid, `g`'s **output type** must equal `f`'s **input type**: if `g : A → B` then `f` must be `B → C`. The result is `A → C` — the intermediate type `B` disappears. This is why composition is so safe in statically-typed languages: the compiler rejects a pipeline whose adjacent stages don't connect, catching whole classes of "I passed the wrong shape" bugs at build time. In dynamic languages the same constraint exists but you only find a mismatch at runtime.
</details>

**Q10. Can you compose more than two functions? How?**

<details><summary>Answer</summary>

Yes — composition is associative, so it extends to any number by folding. A variadic `compose` reduces over the function list:

```python
from functools import reduce
def compose(*fns):
    return reduce(lambda f, g: lambda x: f(g(x)), fns, lambda x: x)

pipeline = compose(f, g, h)   # x -> f(g(h(x)))
```

The seed is `identity`. The same fold gives you `pipe` by reversing the list (or reducing the other direction). Because the operation is associative, `compose(compose(f, g), h) == compose(f, compose(g, h))`, so the grouping never changes the result.
</details>

---

## Intermediate / Middle

> Point-free style, composition over inheritance, fallible functions, middleware.

**Q11. What is point-free (tacit) style?**

<details><summary>Answer</summary>

Point-free style defines functions by composing other functions *without naming the argument* ("the point"). Instead of `def f(x): return upper(strip(x))` you write `f = compose(upper, strip)`. The data flows implicitly through the composition. It's prized for removing boilerplate plumbing and emphasizing *what* transformation happens over *how* the variable moves around. Haskell's `sum . map (*2)` is the canonical form. The risk is over-applying it until the code is unreadable (see the "when does point-free hurt" curveball).
</details>

**Q12. "Favor composition over inheritance" — what does that mean and why?**

<details><summary>Answer</summary>

It means build behavior by *combining* small parts (has-a / uses-a) rather than by extending a base class (is-a). Inheritance couples a subclass to its parent's entire implementation, locks you into a single rigid hierarchy, and breaks encapsulation (the fragile base class problem) — changing the parent can silently break children. Composition assembles independent pieces at runtime, so you can mix and match, swap parts, and test each in isolation. In OO this is delegation/strategy; in FP it's literal function composition. The same instinct — small interchangeable parts over deep hierarchies — drives both. See [`senior.md`](senior.md) for the function-vs-object nuance.
</details>

**Q13. How do you compose functions that can fail? Plain composition breaks down — why?**

<details><summary>Answer</summary>

Plain composition assumes every stage takes an `A` and returns a `B` cleanly. A fallible stage returns *either* a value *or* an error — `A → Result[B]` — so its output type (`Result[B]`) no longer matches the next stage's input type (`B`). You can't naively `compose` them; the types don't line up. The fix is to compose in a context that knows how to short-circuit on failure: thread the value through `Result`/`Either`/`Option` and use a "bind" (`flatMap`/`andThen`) that skips the rest of the pipeline once an error appears. That's the heart of railway-oriented programming.
</details>

**Q14. Show composing fallible functions in Go.**

<details><summary>Answer</summary>

Go has no `Result` type, so the idiomatic composition is explicit `(T, error)` threading — each stage guards and returns early:

```go
func process(raw string) (Report, error) {
    parsed, err := parse(raw)
    if err != nil { return Report{}, err }
    valid, err := validate(parsed)
    if err != nil { return Report{}, err }
    return render(valid)
}
```

This *is* composition with short-circuit on error — just spelled out rather than hidden in a `bind`. You can abstract it with a small generic `func Then[A,B,C](f func(A)(B,error), g func(B)(C,error)) func(A)(C,error)`, but most Go teams keep the explicit form because it's the language's grain. Compare with Java/Python `Optional`/`Result` below.
</details>

**Q15. Show composing fallible functions in Java and Python.**

<details><summary>Answer</summary>

Java with `Optional` (chained `flatMap` is composition over the `Optional` context):

```java
Optional<Report> r = parse(raw)
    .flatMap(Validator::validate)   // each returns Optional<...>
    .map(Renderer::render);         // map for the non-failing final step
```

Python with a small `Result`:

```python
def bind(result, f):
    return result if result.is_err else f(result.value)

result = bind(bind(parse(raw), validate), render)
```

In both, `flatMap`/`bind` is the composition operator for functions returning a wrapped value; the chain short-circuits the moment one stage produces an empty/error.
</details>

**Q16. What is the middleware pattern, and how is it composition?**

<details><summary>Answer</summary>

Middleware wraps a handler with cross-cutting behavior (logging, auth, timing) by composing functions of type `Handler → Handler`. Each middleware takes the next handler and returns a new handler that does something before/after calling it. You build the chain by composing these wrappers: `withLogging(withAuth(withTiming(handler)))` — which is exactly `compose` applied to `Handler → Handler` functions. Because composition is associative, the order you nest determines the order they run, and you can store the whole stack as one composed handler. This is the most common place working engineers meet composition without calling it that.
</details>

**Q17. Show the middleware composition in Go.**

<details><summary>Answer</summary>

```go
type Middleware func(http.Handler) http.Handler

func Chain(mws ...Middleware) Middleware {
    return func(final http.Handler) http.Handler {
        for i := len(mws) - 1; i >= 0; i-- {
            final = mws[i](final)   // compose right-to-left
        }
        return final
    }
}

handler := Chain(Logging, Auth, Timing)(mux)
```

`Chain` folds the middlewares with composition. Note the right-to-left wrap: the *first* listed middleware (`Logging`) ends up *outermost*, so it runs first on the way in and last on the way out. Getting this order right is the usual middleware bug, and it's the same "compose runs right-to-left" gotcha from Q3.
</details>

**Q18. When should you NOT use point-free style?**

<details><summary>Answer</summary>

When it obscures meaning. Point-free shines for short, linear pipelines of well-named functions. It hurts when (1) you need to plumb an argument to a non-final position, forcing contortions like `flip`, `curry`, and combinator soup that no one can read; (2) the composed functions are anonymous or poorly named, so the pipeline is a wall of `compose(a, b, c)` with no intent; (3) debugging — there's no named intermediate to inspect or set a breakpoint on. The rule of thumb: stay point-free while it *clarifies*; the moment naming the argument makes it obvious, name it.
</details>

**Q19. How do you compose functions with different arities?**

<details><summary>Answer</summary>

Composition fundamentally chains *unary* functions (one in, one out). A multi-argument function doesn't fit a pipeline directly. Two standard fixes: **currying** — turn `f(a, b)` into `f(a)(b)` so partial application yields a unary function ready to compose (`compose(g, f(a))`); or **partial application** — bind the extra arguments up front (`functools.partial(f, a)` in Python, a closure in Go). The upstream stage can also return a tuple/struct that the next stage destructures. The point-free dream of composing arbitrary-arity functions is exactly why currying exists.
</details>

**Q20. Composing predicates: how do you build `isValid = isNonEmpty AND isShort`?**

<details><summary>Answer</summary>

Predicates compose through boolean combinators rather than value-threading, because they all take the same input and return `bool`:

```python
def and_(*ps): return lambda x: all(p(x) for p in ps)
def or_(*ps):  return lambda x: any(p(x) for p in ps)
def not_(p):   return lambda x: not p(x)

is_valid = and_(is_non_empty, is_short)
```

This is composition in the *applicative* sense — fan the input to several functions and combine their results — distinct from sequential `f(g(x))` composition where the output of one feeds the next. Both are "composition"; they differ in whether functions are chained in series or run in parallel and merged.
</details>

**Q21. What's the difference between composition and chaining method calls (`a.b().c()`)?**

<details><summary>Answer</summary>

Method chaining is composition in disguise — each method returns an object (often the same type) on which the next method is called, so `x.strip().upper()` is `upper(strip(x))` with the receiver playing the role of the threaded value. The differences are ergonomic: chaining requires the methods to live on the type and to return the right type (fluent interfaces, Java Streams, builder pattern); free-function composition works with standalone functions and lets you assemble pipelines as first-class values. Streams (`stream.filter(...).map(...)`) are method-chained composition; `compose(f, g)` is the free-function form.
</details>

**Q22. How does composition support the "functional core, imperative shell" idea?**

<details><summary>Answer</summary>

The pure core is a big composition of pure transformations — `decide = compose(format, applyRules, normalize, parse)` — with no I/O. The imperative shell does the effects (read input, call the composed core, write output). Composition is what lets the core stay a single referentially-transparent function you can test with plain inputs and outputs, while all the messy effects are pushed to the edges. The cleaner your composition, the thinner the shell needs to be. This connects to effect tracking and the `IO` boundary; see the Functional Programming sections on effects.
</details>

---

## Senior — Design at Scale

> Railway-oriented programming, combinators, function vs object composition, designing pipelines.

**Q23. Explain railway-oriented programming.**

<details><summary>Answer</summary>

Railway-oriented programming (Scott Wlaschin's metaphor) models a pipeline as a two-track railway: a **success track** and a **failure track**. Each step is a function `A → Result[B]` (a "switch" that can divert onto the failure track). You compose these with `bind`/`flatMap`, which keeps a value on the success track only while every step succeeds; the first failure shunts onto the error track and *bypasses* all remaining steps, carrying the error to the end. It's how you compose fallible functions cleanly: the happy path reads as a straight sequence, error handling is uniform and automatic, and there are no nested `if err != nil` pyramids. `Result`/`Either` is the rail; `bind` is the switch logic; `map` lifts a non-failing step onto the track.
</details>

**Q24. What is a combinator?**

<details><summary>Answer</summary>

A combinator is a higher-order function that builds new functions purely by combining its function arguments, with no free variables of its own — it adds no new data, only wiring. `compose`, `pipe`, `identity`, `flip` (swap two args), `const` (ignore the second arg), and predicate `and_`/`or_` are all combinators. A *combinator library* is a set of these plus some primitives, designed so you build complex behavior by combining small pieces — parser combinators, the `slices`/`iter` helpers, reactive operators (`map`/`filter`/`debounce` on streams), and middleware chains are all combinator libraries. Composition is the foundational combinator the others are defined in terms of.
</details>

**Q25. Function composition vs object composition — when does each fit?**

<details><summary>Answer</summary>

**Function composition** chains stateless transformations: data flows through `f(g(x))`, nothing is retained, each stage is a pure function. It fits data pipelines, request processing, and anything expressible as "transform input to output." **Object composition** assembles objects that *hold state and collaborate* — an object delegates to injected collaborators (strategy, decorator, dependency injection). It fits when the parts have identity, lifecycle, or mutable state (a connection pool composed of a config, a metrics sink, a retry policy). They're not rivals: a service object (object composition) often has a method whose body is a function composition. Reach for function composition when the thing is fundamentally a transformation; object composition when it's a collaborating component with state.
</details>

**Q26. How do you design a large pipeline so it stays composable as it grows?**

<details><summary>Answer</summary>

Keep every stage **unary, pure, and total** where possible — one input, one output, no hidden state, total over its domain (use `Result` for partiality). Standardize the "currency" flowing between stages: a single context/record type threaded through, so any stage can be inserted or reordered without retyping everything. Make fallibility explicit and uniform (everyone returns `Result`), so the whole pipeline composes with one `bind`. Name stages by their transformation, not their position. Avoid stages that secretly depend on global state or ordering — that reintroduces the spaghetti coupling composition was meant to remove. Finally, expose the pipeline as data (a list of stages) when it must be configured at runtime, so composition is `reduce(bind, stages)`.
</details>

**Q27. What are the trade-offs of building everything from tiny composed functions?**

<details><summary>Answer</summary>

Benefits: each piece is trivially testable, reusable, and the pipeline reads declaratively. Costs: (1) **debugging** — stack traces and breakpoints land inside anonymous composed lambdas with no named intermediates; (2) **over-abstraction** — a wall of `compose` can be *less* readable than a short imperative block with named steps, the FP version of Lasagna code; (3) **performance** — many small functions mean many calls/allocations the optimizer may or may not inline (see fusion questions); (4) **onboarding** — heavy point-free/combinator style raises the bar for new readers. The senior move is to compose where it clarifies and earns reuse, and to keep an honest imperative block where that reads better. Composition is a tool, not a virtue.
</details>

**Q28. How does composition interact with effects and side effects?**

<details><summary>Answer</summary>

Pure functions compose freely and reorder safely because they have no observable effects. The moment a stage performs I/O, mutates shared state, or depends on the clock/RNG, composition becomes order-sensitive in ways the types don't show, and you lose equational reasoning — `compose(f, g)` may differ from running them separately if they share hidden state. The disciplined approach is to keep effects out of the composed core (functional core / imperative shell) or to make effects *values* — return an `IO`/`Task`/lazy action that describes the effect, compose those descriptions purely, and run the whole thing once at the edge. That way even effectful pipelines compose with the same laws as pure ones.
</details>

**Q29. Can composition replace inheritance entirely? Where does it still fall short?**

<details><summary>Answer</summary>

Composition handles the overwhelming majority of cases inheritance is misused for, and "favor composition" is sound default advice. But inheritance still has narrow legitimate uses: expressing a genuine *is-a* subtype for polymorphism where the Liskov Substitution Principle holds, sharing a stable invariant interface (abstract base / sealed hierarchy for algebraic-data-type-like dispatch), and framework template-method hooks. Composition's costs are real too: lots of delegation boilerplate, and an extra indirection layer. The principle isn't "never inherit" — it's "don't inherit for *code reuse*; inherit only for *substitutable polymorphism*, and even then prefer interfaces + composition when you can."
</details>

**Q30. What is the relationship between composition and the Decorator pattern?**

<details><summary>Answer</summary>

Decorator is object composition applied to wrap-and-extend: a decorator implements the same interface as the thing it wraps, holds a reference to it, and adds behavior before/after delegating. That's structurally identical to function-composition middleware (`Handler → Handler`) — a decorator is a combinator on a one-method interface. The functional version (`compose` of `Handler → Handler` wrappers) is leaner when the wrapped thing has a single operation; the OO Decorator is preferable when the wrapped type has many methods and you only want to override some. Same idea — layered wrapping via composition — at two granularities.
</details>

**Q31. How would you make a composed pipeline observable/debuggable without breaking composition?**

<details><summary>Answer</summary>

Insert a `tap`/`trace` combinator: a function `A → A` that performs a side effect (log, metric, breakpoint) and returns its input unchanged — it's `identity` with a peek. Because it's identity-typed, you can splice it anywhere in the pipeline without changing the types: `pipe(parse, tap(log), validate, tap(log), render)`. For railway pipelines, a `tapError` peeks at the failure track. This preserves the composition while restoring the named-intermediate visibility you lose in point-free style. In production you'd gate the taps behind a debug flag so they compile out / no-op when off.
</details>

**Q32. A teammate composes 12 functions into one expression and it's unreadable. How do you fix it while keeping the benefits?**

<details><summary>Answer</summary>

Don't abandon composition — *group and name* it. Break the 12-step chain into 3–4 named sub-pipelines that each express a meaningful phase (`normalize = pipe(trim, lowercase, stripAccents)`, `enrich = pipe(...)`), then compose those: `process = pipe(normalize, enrich, persist)`. Now the top level reads as prose and each phase is independently testable, while you keep referential transparency and reuse. If a step needs a value plumbed awkwardly, that's the signal to drop point-free *there* and name the argument. The goal is the right *altitude* of composition, not maximal terseness. This is exactly what associativity (Q34) licenses.
</details>

---

## Professional / Deep — Laws, Cost, Fusion

> Category-theory laws, inlining/allocation cost, and fusion optimizations.

**Q33. What are the composition laws?**

<details><summary>Answer</summary>

Two laws make functions-under-composition a **category**:

1. **Identity**: `compose(f, id) == compose(id, f) == f`. Composing with the identity function changes nothing — `id` is the left and right unit.
2. **Associativity**: `compose(compose(f, g), h) == compose(f, compose(g, h))`. How you parenthesize a chain doesn't matter; only the order of the functions does.

These aren't academic trivia — associativity is *why* a variadic `compose`/`pipe` is well-defined (you can fold the list in either direction and get the same function), and identity is *why* `identity` works as the fold's seed and as a no-op stage. Note composition is **not commutative**: `compose(f, g) ≠ compose(g, f)` in general.
</details>

**Q34. Why does associativity matter in practice, not just in theory?**

<details><summary>Answer</summary>

Because it guarantees you can **regroup and refactor pipelines freely**. You can extract a middle run of stages into a named sub-pipeline (`b = compose(g, h)`; then `compose(f, b) == compose(f, g, h)`) with zero behavior change — that's the law licensing the "group and name" refactor in Q32. It lets a variadic `compose` fold left or right identically, lets a streaming engine rebalance an operator chain, and lets an optimizer fuse adjacent stages without asking permission. Any "split this pipeline here" or "merge these two stages" move is safe *precisely because* composition is associative.
</details>

**Q35. What is map fusion and why is it an optimization?**

<details><summary>Answer</summary>

Map fusion is the law `map(f) ∘ map(g) == map(compose(f, g))`: two sequential maps over a collection can be rewritten as one map with the functions composed. The win is eliminating an entire intermediate collection and an entire traversal — `map(f, map(g, xs))` allocates a temporary list and walks the data twice; the fused `map(compose(f, g), xs)` walks once with no temporary. Lazy/stream pipelines (Haskell's list fusion, Java Streams, Rust iterators, `iter` in Go) do this automatically: the elements flow one at a time through all the composed stages, so no intermediate collection is ever materialized. It's the performance payoff of composing transformations instead of running them as separate passes.
</details>

**Q36. Does composition have runtime overhead? What is it?**

<details><summary>Answer</summary>

In principle, yes: each composed function is an extra function object and an extra call. `compose(f, g)` allocates a closure capturing `f` and `g`, and invoking it costs two calls plus the wrapper call instead of one inlined expression. For a tight loop composing many tiny functions in a language with no inlining, that overhead (call frames, closure allocations, indirect/virtual dispatch defeating the branch predictor) is measurable. In practice it's usually negligible because (1) the work inside the functions dwarfs the call cost, and (2) modern optimizers inline and devirtualize aggressively. You only care on proven hot paths, where you might flatten a composition by hand or rely on fusion to collapse it.
</details>

**Q37. When can the compiler/JIT inline a composition, and when can't it?**

<details><summary>Answer</summary>

It can inline when the composed functions are **statically known** at the call site — direct calls, monomorphic generics, or closures the optimizer can see through — so it folds `f(g(x))` into a single expression with no call overhead, and fusion can kick in. It *can't* (or won't) when the functions are passed as opaque values through an interface/function-pointer boundary it can't resolve (megamorphic call sites with many different functions), when a closure escapes and must be heap-allocated, when the composed function exceeds an inlining size threshold (e.g. the JVM's bytecode limits, Go's inlining budget), or when reflection/dynamic dispatch hides the target. So `compose` used as a value at a hot polymorphic call site is the case where the abstraction actually costs cycles.
</details>

**Q38. Compare the allocation cost of composition across Go, Java, and Python.**

<details><summary>Answer</summary>

- **Go**: a `compose` returning a closure heap-allocates the closure (it escapes), and each stage is an indirect call through a `func` value the inliner usually can't flatten. Cheap per call, but not free, and it defeats inlining — the reason idiomatic Go often writes the pipeline out longhand rather than building `compose` helpers.
- **Java**: lambdas/method refs become `invokedynamic` call sites; the JIT (C2) is good at inlining and devirtualizing monomorphic chains, so a hot composed Stream pipeline often optimizes down well — but megamorphic lambda sites stay as indirect calls and may allocate.
- **Python**: every composition is pure overhead — each stage is a separate Python-level function call (expensive), closures are heap objects, and there's no inlining at all. Composition in Python is for clarity, never speed; if it's hot, you rewrite the loop or drop to NumPy/C.

The ranking of overhead is roughly Python ≫ Go ≳ Java-after-JIT.
</details>

**Q39. How do lazy streams use composition to avoid intermediate allocations?**

<details><summary>Answer</summary>

A lazy stream doesn't compute each stage over the whole collection before moving on; instead it composes the per-element transformations and pulls one element through the entire composed chain at a time. `xs.filter(p).map(f).filter(q)` doesn't build three lists — it builds one fused pipeline and runs each element through the composed stages (skipping later ones for elements `p` rejects) on demand. This is composition + fusion + laziness together: composition defines the chain, fusion collapses adjacent stages, laziness ensures nothing is materialized until pulled. The result is constant-memory streaming over arbitrarily large (even infinite) sources. See [Map / Filter / Reduce](../04-map-filter-reduce/interview.md) and the Laziness & Streams topic.
</details>

**Q40. In category theory, what is a "morphism" and how does it relate to functions and composition?**

<details><summary>Answer</summary>

A category is objects + morphisms (arrows between objects) + a composition operation that is associative and has identities. In the category **Set** (the one programmers live in), objects are types and morphisms are functions between them; composition is exactly function composition, and the identity morphism is `identity`. So the composition laws (Q33) are just the category axioms specialized to functions. This framing pays off because *functors* (`map`-able containers), *monads* (`flatMap`-able contexts for railway composition), and the fusion/identity laws all fall out of it — the abstractions you use daily are the laws of composition lifted to richer settings. You don't need the vocabulary to write the code, but it explains why the laws keep recurring.
</details>

**Q41. What is Kleisli composition and where have you used it without naming it?**

<details><summary>Answer</summary>

Kleisli composition (`>=>`) composes *fallible/effectful* functions of the form `A → M[B]` and `B → M[C]` into `A → M[C]`, using the monad's `bind` to thread the context: `(f >=> g)(x) = bind(f(x), g)`. You've used it every time you chained `Optional.flatMap`, `Result.andThen`, `Promise.then`, or a railway pipeline — that's plain composition's analogue for functions that return a wrapped value. Where ordinary `compose` needs `g`'s input to match `f`'s output exactly, Kleisli composition lets the output be wrapped (`M[B]`) and unwraps it for the next stage. It's the formal name for "compose functions that can fail/do I/O," i.e. the engine of railway-oriented programming.
</details>

**Q42. Does composition preserve purity, and why does that matter for optimization?**

<details><summary>Answer</summary>

Composing pure functions yields a pure function — no stage observes or causes effects, so the result is referentially transparent. That matters because purity is what *licenses* the aggressive rewrites: fusion (collapsing `map ∘ map`), reordering independent stages, common-subexpression elimination, memoization, and parallelization are all only sound when the functions have no side effects. The instant a composed stage is impure (mutation, I/O, time), those rewrites become unsafe and both the compiler and you lose the ability to reason equationally. So "keep the composed core pure" isn't just style — it's what keeps the optimizer's most powerful transformations legal.
</details>

---

## Code-Reading — What Does This Compute?

> Read the snippet; state what it computes and in what order.

**Q43. Python — what does `f("  Hello World  ")` return, and in what order do the steps run?**

```python
from functools import reduce
def compose(*fns):
    return reduce(lambda a, b: lambda x: a(b(x)), fns, lambda x: x)

f = compose(len, str.split, str.strip)
```

<details><summary>Answer</summary>

`compose` applies **right-to-left**, so the rightmost runs first: `strip` → `split` → `len`. For `"  Hello World  "`: `strip` gives `"Hello World"`, `split` gives `["Hello", "World"]`, `len` gives `2`. So `f(...)` returns **2** (the word count). The common trap is reading left-to-right and guessing it counts characters; the order is `len(split(strip(x)))`.
</details>

**Q44. Go — what is the value of `out`, and which function applies first?**

```go
func Compose[A, B, C any](f func(B) C, g func(A) B) func(A) C {
    return func(x A) C { return f(g(x)) }
}

inc := func(n int) int { return n + 1 }
dbl := func(n int) int { return n * 2 }

h := Compose(dbl, inc)
out := h(5)
```

<details><summary>Answer</summary>

`Compose(dbl, inc)` returns `x -> dbl(inc(x))`, so **`inc` applies first**, then `dbl`. `h(5)` = `dbl(inc(5))` = `dbl(6)` = **12**. If the arguments were swapped to `Compose(inc, dbl)`, you'd get `inc(dbl(5))` = `inc(10)` = `11` — a different result, demonstrating composition is not commutative.
</details>

**Q45. Java — what does this Stream pipeline compute, and is an intermediate list built?**

```java
int result = Stream.of("a", "bb", "ccc", "dddd")
    .filter(s -> s.length() % 2 == 1)
    .mapToInt(String::length)
    .sum();
```

<details><summary>Answer</summary>

It keeps odd-length strings (`"a"` len 1, `"ccc"` len 3 — `"bb"` and `"dddd"` are even, dropped), maps each to its length, and sums: `1 + 3` = **4**. No intermediate list is materialized: Java Streams are lazy and **fused**, so each element flows through `filter` then `mapToInt` one at a time, and `sum` is the terminal operation that drives the pull. This is map/filter fusion via composition — the operators compose into one pass.
</details>

**Q46. Python — read this `pipe` (left-to-right) and give the result.**

```python
from functools import reduce
def pipe(*fns):
    return lambda x: reduce(lambda acc, f: f(acc), fns, x)

g = pipe(lambda n: n + 3, lambda n: n * 10, str)
print(g(2))
```

<details><summary>Answer</summary>

`pipe` runs **left-to-right** in data-flow order: `+3` → `*10` → `str`. For `2`: `2 + 3 = 5`, `5 * 10 = 50`, `str(50) = "50"`. It prints **`"50"`** (a string — note the final `str`). Contrast with `compose`, which would run these right-to-left; `pipe` is the more readable form here because the order you read matches the order things happen.
</details>

**Q47. Go — what order do these middlewares execute, and what's the bug risk?**

```go
handler := Chain(Logging, Auth, Timing)(mux)
// Chain wraps right-to-left: Logging(Auth(Timing(mux)))
```

<details><summary>Answer</summary>

With right-to-left wrapping, the nesting is `Logging(Auth(Timing(mux)))`, so on an incoming request the **outermost runs first**: `Logging` → `Auth` → `Timing` → `mux`, and on the way back out the order reverses (`Timing` finishes first, `Logging` last). The bug risk is ordering: if `Auth` must run before anything logs request bodies, or `Timing` must wrap the *handler only* vs the *whole chain*, the listed order matters. Teams frequently get this backwards because "compose runs right-to-left" is unintuitive — which is why many middleware libraries deliberately offer a left-to-right `Use(...)` API instead.
</details>

**Q48. Haskell aside — what does `count = length . filter even . map (*2)` do?**

<details><summary>Answer</summary>

`.` is `compose`, so this reads **right-to-left**: `map (*2)` doubles every element, `filter even` keeps the even ones, `length` counts them. But every element doubled is *already even*, so `filter even` keeps everything — `count` is just the length of the input list. It's a deliberately tricky example showing two things: composition order (`map` runs first despite being written last) and that composing the wrong filter can be a silent no-op. The point-free form is concise but you must read it right-to-left.
</details>

---

## Curveballs

> Designed to catch glib answers.

**Q49. `compose(f, g)(x)` — is it `f(g(x))` or `g(f(x))`? Defend your answer.**

<details><summary>Answer</summary>

`f(g(x))` — `g` first, then `f`. The defense is the math: `compose` is named after `∘`, and `(f ∘ g)(x)` is *defined* as `f(g(x))`. The intuition check is types — `g` is the one applied to `x`, so `g`'s parameter type must match `x`. If you want `f` applied first in reading order, that's `pipe(f, g)` or equivalently `compose(g, f)`. This question exists because the left-to-right reading habit makes people answer `g(f(x))`, which is wrong for `compose` and right for `pipe`.
</details>

**Q50. Why prefer composition over inheritance?**

<details><summary>Answer</summary>

Because inheritance buys code reuse at the price of tight coupling, rigidity, and broken encapsulation. A subclass depends on its parent's *implementation*, not just an interface — the fragile base class problem means a parent change can silently break children. You're locked into one hierarchy (no multiple inheritance in most languages, and deep trees are hard to reason about), and you inherit the *whole* parent even when you want one method. Composition assembles small, independent, interface-typed parts you can swap, mix, and test in isolation, and it expresses *has-a/uses-a* relationships honestly. Inheritance should be reserved for genuine substitutable *is-a* polymorphism (LSP holds), not for sharing code. "Favor composition" is the default; inheritance is the exception you justify.
</details>

**Q51. When does point-free style hurt?**

<details><summary>Answer</summary>

When it costs more comprehension than the plumbing it removes. Concretely: when you need an argument in a non-leading position and resort to `flip`/`curry`/combinator gymnastics; when the composed functions are anonymous or vaguely named so the chain has no readable intent; when debugging, because there are no named intermediates to inspect, log, or breakpoint; and when the chain is long enough that "what is the data here?" stops being obvious. The mature stance: point-free is a readability *optimization* for short chains of well-named functions, not a goal. The instant naming the argument is clearer, name it — readability beats terseness.
</details>

**Q52. What are the composition laws — identity and associativity — and why should an engineer care?**

<details><summary>Answer</summary>

**Identity**: `compose(f, id) = compose(id, f) = f` — `identity` is the do-nothing element. **Associativity**: `compose(compose(f, g), h) = compose(f, compose(g, h))` — grouping doesn't matter, only order. An engineer cares because these laws are what make everyday moves *safe*: identity lets `identity` be a fold seed and a no-op branch; associativity lets you extract sub-pipelines, fold a variadic `compose` either direction, and let streaming engines/optimizers regroup and fuse stages without changing behavior. Note the law that does *not* hold: commutativity — order is meaning.
</details>

**Q53. Is `compose` the same as `pipe` with the arguments reversed?**

<details><summary>Answer</summary>

Yes — `pipe(*fns) == compose(*reversed(fns))`. They're the same operation differing only in argument order/reading direction. `compose(f, g, h)` = `f(g(h(x)))` (right-to-left); `pipe(f, g, h)` = `h(g(f(x)))` (left-to-right). Many libraries implement one in terms of the other. The choice is purely about which reading order your team finds clearer; `pipe` tends to win for readability because it matches data flow, `compose` matches mathematical notation. The trap is mixing both in one codebase so readers must constantly check which direction applies.
</details>

**Q54. If composing pure functions is associative, can I freely parallelize the stages?**

<details><summary>Answer</summary>

No — associativity lets you *regroup* a chain, not *reorder* or *parallelize* it. The stages are sequentially dependent: stage `n+1` needs stage `n`'s output, so they must run in order. What you *can* parallelize is composition applied *across data* — `map(compose(f, g), xs)` runs the same composed function on independent elements in parallel (because the elements don't depend on each other), and purity is what makes that safe. So associativity buys refactoring freedom on the function chain; data-parallelism buys throughput across the collection; they're different axes, and confusing them is the trap.
</details>

**Q55. Can you compose two pure functions and get an impure result?**

<details><summary>Answer</summary>

No — composing pure functions always yields a pure function; purity is closed under composition, since neither stage introduces an effect. The interesting inverse is the real trap: composing an *impure* stage into an otherwise-pure pipeline contaminates the whole thing — the composed function is now impure and loses referential transparency, even if every other stage is clean. That's why the discipline is to keep effects at the edges (functional core / imperative shell) or to reify effects as values. One impure link makes the whole chain impure; that's the point of tracking purity at the type level.
</details>

**Q56. A pipeline is slow. Your colleague says "it's all the function composition overhead." Likely right or wrong?**

<details><summary>Answer</summary>

Almost certainly wrong — *profile before believing it*. Composition's per-call overhead (extra closures and calls) is real but tiny; it's dwarfed by the actual work in the stages, and in JIT/optimizing runtimes it's frequently inlined away entirely. A slow pipeline is far more often caused by **materializing intermediate collections** (eager `map`/`filter` building temp lists where a fused lazy stream would stream), an accidental O(n²) stage, I/O inside a hot loop, or boxing/allocation in the *bodies*. The composition itself is rarely the bottleneck; blaming the abstraction without a profiler is the junior move. Measure, find the real hot stage, then decide.
</details>

**Q57. Does `compose(f, g)` ever NOT equal calling `g` then `f` manually?**

<details><summary>Answer</summary>

For pure functions, never — `compose(f, g)(x)` is *by definition* `f(g(x))`, identical to calling them manually. The cases where a difference can sneak in are all about impurity and evaluation: if `f` or `g` reads/writes shared mutable state, the timing of when the composed function is *built* vs *called* can differ from inline calls (e.g. capturing a variable by reference in a closure that changes before invocation); and in a lazy language, composing can defer evaluation so an effect or exception fires later than you'd expect. With pure, eager functions the equality is exact; the "gotchas" are really purity and closure-capture gotchas, not composition itself.
</details>

---

## Rapid-Fire / One-Liners

> Crisp answers; what an interviewer wants in one or two sentences.

**Q58. `compose` vs `pipe` direction in one line each?**

<details><summary>Answer</summary>

`compose` = right-to-left (`f(g(x))`, math order); `pipe` = left-to-right (data-flow order). Same operation, mirrored.
</details>

**Q59. The neutral element of composition?**

<details><summary>Answer</summary>

`identity` (`x => x`): `compose(f, id) == compose(id, f) == f`.
</details>

**Q60. The two composition laws?**

<details><summary>Answer</summary>

Identity (`compose with id is a no-op`) and associativity (`grouping doesn't matter`). Commutativity does *not* hold.
</details>

**Q61. One-line cure for composing fallible functions?**

<details><summary>Answer</summary>

Thread through `Result`/`Option` and compose with `bind`/`flatMap` — railway-oriented programming; first failure short-circuits.
</details>

**Q62. Map fusion in one line?**

<details><summary>Answer</summary>

`map(f) ∘ map(g) == map(f ∘ g)` — two passes and an intermediate collection collapse into one.
</details>

**Q63. When is point-free a bad idea?**

<details><summary>Answer</summary>

When you'd need `flip`/`curry` gymnastics, the functions are unnamed, or you can't debug it — name the argument instead.
</details>

**Q64. Composition over inheritance, in one sentence?**

<details><summary>Answer</summary>

Inherit only for substitutable polymorphism; for reuse, assemble small interchangeable parts — they couple less and test alone.
</details>

**Q65. Is composition commutative?**

<details><summary>Answer</summary>

No. `compose(f, g) ≠ compose(g, f)` in general — order changes the result and often the types.
</details>

**Q66. What is a combinator, in one line?**

<details><summary>Answer</summary>

A higher-order function that builds new functions purely by wiring its function arguments — `compose`, `pipe`, `flip`, `identity`.
</details>

**Q67. Middleware is composition of what type?**

<details><summary>Answer</summary>

`Handler → Handler` functions; the chain is `compose` of wrappers, and order determines run order.
</details>

---

## How to Talk About Composition in Interviews

A few habits separate a strong answer from a textbook recital:

- **Nail the direction immediately.** When `compose` comes up, state "right-to-left, `f(g(x))`" without hesitation and offer the type-check intuition (`g` touches `x`). Hesitating here reads as not having used it.
- **Lead with the *why*, then the law.** Don't just recite "identity and associativity." Say what associativity *buys* — "it's why I can extract a sub-pipeline and name it without changing behavior." Laws-in-service-of-refactoring is the senior signal.
- **Always name the trade-off.** Composition's costs are real: debuggability, over-abstraction (the FP Lasagna), and call/allocation overhead on hot paths. "Compose where it clarifies and earns reuse; keep an honest imperative block otherwise" beats absolutism.
- **Connect fallible composition to railway-oriented programming.** Show you know plain `compose` breaks on `A → Result[B]` and that `bind`/`flatMap` is the fix — that's the bridge from junior to senior on this topic.
- **Reach for fusion and inlining when asked to go deep.** `map ∘ map` fusion, lazy streaming to avoid intermediate collections, and "the JIT inlines monomorphic chains but not megamorphic ones" show you understand the runtime, not just the syntax.
- **Don't over-claim performance.** "It's the composition overhead" without a profiler is a tell. Say the work usually dwarfs the call cost and that intermediate-collection materialization is the more common culprit.
- **Use a concrete pipeline from your experience.** "Our request pipeline was a `pipe(authenticate, validate, handle)` of `Result`-returning stages" lands harder than a definition.

---

## Summary

- Composition glues unary functions end-to-end: `compose(f, g)(x) = f(g(x))` runs **right-to-left**; `pipe` is the same thing **left-to-right**. The adjacent types must line up (`g : A→B`, `f : B→C`).
- The junior bar is order and the compose/pipe distinction; the middle bar is point-free style, composition-over-inheritance, composing fallible functions, and middleware; the senior bar is railway-oriented programming, combinators, function-vs-object composition, and designing pipelines that stay composable; the professional bar is the category laws, inlining/allocation cost, and fusion.
- The **laws** that matter: identity (`compose with id is a no-op`) and associativity (regroup freely) hold; **commutativity does not** — order is meaning. Associativity is what makes variadic `compose`, sub-pipeline extraction, and optimizer fusion safe.
- Strong answers lead with **cost and reasoning**, name **trade-offs** (debuggability, over-abstraction, hot-path overhead), connect fallible composition to **`bind`/railway**, and refuse to blame "composition overhead" without a **profiler** — the real cost is usually materialized intermediates, not the wiring.

---

## Related Topics

- [`junior.md`](junior.md) — what composition is, compose vs pipe, order of application.
- [`middle.md`](middle.md) — point-free style, composition over inheritance, fallible functions, middleware.
- [`senior.md`](senior.md) — railway-oriented programming, combinators, designing pipelines at scale.
- [`professional.md`](professional.md) — category laws, inlining/allocation cost, fusion.
- [First-Class & Higher-Order Functions](../01-first-class-and-higher-order-functions/interview.md) — functions as values, the prerequisite for composing them.
- [Pure Functions & Referential Transparency](../02-pure-functions-and-referential-transparency/interview.md) — why purity is what makes composition reorderable and optimizable.
- [Map / Filter / Reduce](../04-map-filter-reduce/interview.md) — the trio you most often compose; map fusion lives here.
- [Functional Programming Roadmap](../README.md) — currying (07), algebraic data types & `Result`/`Either` (06), monads & `bind` (09), and effect tracking (10) all build on composition.
