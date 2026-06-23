# Currying & Partial Application — Interview Q&A

> **Roadmap:** [Functional Programming](../README.md) → Currying & Partial Application
>
> *Currying turns a function of many arguments into a chain of one-argument functions; partial application fixes some arguments of a function and returns a function expecting the rest. They are related but distinct — and the distinction is exactly what interviewers probe.*

A bank of 45+ questions and answers spanning the core definition, practical uses, API design, language ergonomics, and the runtime cost of the closures that make it all work. Each answer models the reasoning a strong candidate gives — including the trade-offs. Use the `<details>` toggles to self-quiz: read the question, answer out loud, then expand.

---

## Table of Contents

1. [Fundamentals / Junior](#fundamentals--junior)
2. [Intermediate / Middle](#intermediate--middle)
3. [Senior — API Design & Composition](#senior--api-design--composition)
4. [Professional / Deep — Isomorphism, Cost, GHC](#professional--deep--isomorphism-cost-ghc)
5. [Code-Reading — What Does This Return?](#code-reading--what-does-this-return)
6. [Curveballs](#curveballs)
7. [Rapid-Fire / One-Liners](#rapid-fire--one-liners)
8. How to Talk About Currying in Interviews
9. [Summary](#summary)
10. [Related Topics](#related-topics)

---

## Fundamentals / Junior

> The definitions, the key distinction, and the simplest examples.

**Q1. What is currying?**

<details><summary>Answer</summary>

Currying transforms a function that takes multiple arguments into a sequence of functions that each take exactly one argument. `add(a, b, c)` becomes `add(a)(b)(c)`: calling `add(1)` returns a function awaiting `b`; calling that with `2` returns a function awaiting `c`; the final call with `3` produces the result. The arity-N function becomes N nested unary functions. The name comes from Haskell Curry (after whom the language is also named), though Moses Schönfinkel described it first.
</details>

**Q2. What is partial application?**

<details><summary>Answer</summary>

Partial application fixes *some* of a function's arguments and returns a new function that takes the remaining ones. Given `add(a, b, c)`, partially applying `a=1` yields a function `g(b, c)` that computes `add(1, b, c)`. You supply a subset of arguments now and the rest later. Unlike currying, there's no requirement to go one argument at a time — you can fix any number of arguments in a single step, and the returned function can still take multiple arguments.
</details>

**Q3. Currying vs partial application — what is the exact difference?**

<details><summary>Answer</summary>

- **Currying** is a *transformation of a function's shape*: it rewrites an N-ary function into N nested unary functions. It's about structure, applied once, regardless of any arguments.
- **Partial application** is an *operation on arguments*: it takes a function and some arguments, and returns a function of the remaining arguments. It's about supplying inputs incrementally.

A curried function makes partial application trivial — `add(1)` *is* a partial application — which is why people conflate them. But you can partially apply a non-curried function (e.g. `functools.partial` in Python), and currying is a transformation you can perform without ever supplying an argument. **Currying produces a structure that enables partial application; partial application is the act of fixing arguments.**
</details>

**Q4. Show currying and partial application side by side in plain code.**

<details><summary>Answer</summary>

```python
def add(a, b, c):
    return a + b + c

# Partial application: fix some args, no shape change required.
from functools import partial
add_10 = partial(add, 10)        # fixes a=10; add_10(b, c) still takes TWO args
add_10(2, 3)                     # 15

# Currying: reshape into unary chain.
def curried_add(a):
    return lambda b: lambda c: a + b + c
curried_add(1)(2)(3)             # 6
```

`partial` returns something still expecting two arguments at once; the curried form forces one-at-a-time. That difference — "remaining args at once" vs "one at a time" — is the heart of the distinction.
</details>

**Q5. Why would anyone want a function called one argument at a time?**

<details><summary>Answer</summary>

Because it makes *specialization* and *composition* cheap. A curried `multiply(x)(y)` lets you derive `double = multiply(2)` for free — a reusable specialized function. It also means every function fits the "one input, one output" shape that composition (`f ∘ g`) requires, so curried functions slot directly into pipelines. In languages like Haskell where everything is curried, partial application is the *default* way to build small specialized functions without writing boilerplate wrappers.
</details>

**Q6. Give an everyday example of partial application that a non-FP developer already uses.**

<details><summary>Answer</summary>

Configuration. A `logger(level, message)` partially applied to `level="ERROR"` gives `logError(message)` — you've baked in the constant and exposed only what varies per call. Event handlers do it too: `button.onClick(partial(handleClick, buttonId))` fixes the id now and receives the event later. Dependency injection is partial application in disguise: a service constructed with its dependencies is a "function" with those arguments pre-filled. Most developers partially apply constantly without naming it.
</details>

**Q7. Does currying change what a function computes?**

<details><summary>Answer</summary>

No. Currying is a purely structural transformation — `add(1, 2, 3)` and `curried_add(1)(2)(3)` produce the identical result. It only changes *how arguments are supplied* (all at once vs one at a time) and *what intermediate values exist* (each partial call produces a function). The mathematical mapping from inputs to output is unchanged; that invariance is precisely what makes curry/uncurry an isomorphism (covered in the deep section).
</details>

**Q8. What does it mean for a function to be "unary," "binary," "N-ary"?**

<details><summary>Answer</summary>

Arity is the number of arguments a function takes: unary = one, binary = two, ternary = three, N-ary = N. Currying is the systematic conversion of an N-ary function into a chain of unary functions. The relevance: composition operators and many higher-order combinators are defined over *unary* functions, so currying is the bridge that lets multi-argument functions participate in single-argument machinery.
</details>

**Q9. Is a closure required to implement currying or partial application?**

<details><summary>Answer</summary>

Yes — both rely on closures. When you fix `a=1` and return a function awaiting the rest, that returned function must *remember* `a=1`; the captured-variable mechanism that remembers it is a closure. Each layer of a curried chain closes over the arguments supplied so far. This is why currying is natural in any language with first-class functions and closures (Python, Go, Java, JavaScript) and why understanding closures is a prerequisite — see [First-Class & Higher-Order Functions](../01-first-class-and-higher-order-functions/interview.md).
</details>

**Q10. What's the simplest mental model to keep them straight?**

<details><summary>Answer</summary>

"**Currying reshapes; partial application feeds.**" Currying is the factory that builds a one-slot-at-a-time machine. Partial application is the act of dropping coins into slots and getting back a machine with fewer slots. A curried function is *born* ready for partial application; a plain function can still be partially applied by an external helper. If the question is about the *shape* of the function, it's currying; if it's about *supplying arguments early*, it's partial application.
</details>

---

## Intermediate / Middle

> Practical uses, per-language idioms, and the trade-offs.

**Q11. Is `functools.partial` currying?**

<details><summary>Answer</summary>

No — it's partial application, as the name says. `functools.partial(f, x)` returns a callable that still accepts the *remaining arguments all at once*, not one at a time, and it does not reshape `f` into a unary chain. True currying would give you `f(x)(y)(z)`; `partial` gives you `g(y, z)`. Python has no built-in currying; you'd write nested lambdas or a `curry` decorator (libraries like `toolz` provide one). This is a classic interview trap — confidently calling `partial` "currying" signals you haven't internalized the distinction.
</details>

**Q12. How do you partially apply a function in Python?**

<details><summary>Answer</summary>

Three common ways:

```python
from functools import partial
send_json = partial(requests.post, headers={"Content-Type": "application/json"})

# or a lambda (more explicit, supports positional reordering)
send_json = lambda url, body: requests.post(url, body, headers={...})

# or a closure factory
def make_sender(headers):
    def send(url, body): return requests.post(url, body, headers=headers)
    return send
```

`partial` is idiomatic for fixing leading positional or keyword args; lambdas win when you need to reorder or transform arguments. `partial` also composes nicely and is picklable (lambdas are not), which matters for multiprocessing.
</details>

**Q13. How do you partially apply / curry in Go, which has no built-in support?**

<details><summary>Answer</summary>

You return a closure explicitly — Go has no syntax sugar, so currying is manual but straightforward:

```go
func adder(a int) func(int) int {
    return func(b int) int { return a + b }
}
add5 := adder(5)   // partial application
add5(3)            // 8
```

For partial application of an existing multi-arg function you wrap it: `func bind(f func(A, B) C, a A) func(B) C { return func(b B) C { return f(a, b) } }`. Go's verbosity (no generics-free way to write a generic `curry`) means idiomatic Go uses this sparingly — typically for configuration via functional options rather than deep curry chains.
</details>

**Q14. How does Java express partial application?**

<details><summary>Answer</summary>

Through `java.util.function` interfaces and lambdas. `Function<A, Function<B, C>>` is a curried binary function; you partially apply by invoking `.apply(a)` to get the inner `Function<B, C>`:

```java
Function<Integer, Function<Integer, Integer>> add = a -> b -> a + b;
Function<Integer, Integer> add5 = add.apply(5);   // partial application
add5.apply(3);                                     // 8
```

Java has no `partial` helper and no automatic currying, so the curried *type* must be written explicitly. This is verbose for high arity (`Function<A, Function<B, Function<C, D>>>`), which is why Java code partially applies pragmatically — capturing variables in a lambda — far more than it builds true curried chains.
</details>

**Q15. What is partial application as dependency injection?**

<details><summary>Answer</summary>

A function `process(db, logger, request)` has two "dependencies" (`db`, `logger`) and one "input" (`request`). Partially applying the dependencies — `handler = partial(process, db, logger)` — yields `handler(request)`, a function whose dependencies are baked in and whose interface is just "the request." That's exactly what a DI container does when it constructs an object with its collaborators. The functional view: a constructor is a partial application of a function over its dependencies, producing a specialized worker. See [Dependency Injection](../../design-patterns/README.md) for the OO framing of the same idea.
</details>

**Q16. Why does currying help with composition?**

<details><summary>Answer</summary>

Composition (`compose(f, g)(x) = f(g(x))`) is defined over *unary* functions — each stage takes one value and returns one value. A binary function can't slot into a pipeline directly. Currying (or partial application) collapses the extra arguments: `filter(predicate)` is a unary function `list -> list` ready for composition, whereas `filter(predicate, list)` is not. So curry-friendly, data-last APIs let you build `pipe(filter(isActive), map(getName), take(10))` where each stage is already unary. See [Composition](../05-composition/interview.md).
</details>

**Q17. What's the "data-last" convention and why does it pair with currying?**

<details><summary>Answer</summary>

Data-last means the data being transformed is the *last* parameter, and configuration/operators come first: `map(fn, data)` → reorder to `map(fn)(data)`. When you curry such a function and supply only the config, you get a unary `data -> data` transformer — perfect for pipelines. Ramda and Haskell's `Data.List` follow data-last; this is *why* `map`, `filter`, and `fmap` take the function before the collection. Data-first APIs (like Lodash's `_.map(data, fn)`) read naturally for one-off calls but resist point-free composition because partially applying the operator means skipping the first argument.
</details>

**Q18. When does currying hurt readability rather than help?**

<details><summary>Answer</summary>

When arity is high or arguments are heterogeneous and unordered. `configure(a)(b)(c)(d)(e)` forces callers to remember the exact order with no parameter names visible at the call site, and a wrong order may type-check yet be wrong. Deep curry chains also produce cryptic stack traces (every layer is an anonymous closure) and inscrutable types in Java. Currying shines for low-arity, naturally-ordered operators (`map`, `filter`, `add`); it becomes a liability when a plain named-argument call or an options object would be clearer.
</details>

**Q19. What's the difference between auto-currying and manual currying?**

<details><summary>Answer</summary>

**Manual currying** writes the nested-unary structure by hand (`a => b => c => ...`). **Auto-currying** (as in Haskell, or libraries like Ramda/`toolz`) wraps a function so it can be called with *any* number of arguments up to its arity: `curried(1, 2)(3)`, `curried(1)(2, 3)`, and `curried(1)(2)(3)` all work, returning a partially applied function until the arity is satisfied. Auto-curry is more ergonomic but requires knowing the function's arity (tricky with variadics and optional args) and adds wrapping overhead per call.
</details>

**Q20. Can you curry a variadic function?**

<details><summary>Answer</summary>

Not cleanly. Currying and auto-currying depend on a *known, fixed arity* to decide when enough arguments have arrived. A variadic `sum(*args)` has no fixed arity, so an auto-curry wrapper can't know whether `sum(1)(2)` should keep collecting or evaluate. You either fix the arity explicitly (`curry(sum, arity=3)`) or you don't curry it. This is a real limitation in dynamically-typed languages where many functions accept `*args`/`**kwargs`.
</details>

**Q21. How do functional options in Go relate to partial application?**

<details><summary>Answer</summary>

The functional-options pattern — `NewServer(addr, WithTimeout(5), WithTLS(cfg))` — uses partially applied closures as configuration. `WithTimeout(5)` returns a `func(*Server)` closure that has fixed the `5` and awaits the server to mutate. It's partial application used to build a composable, order-independent, extensible configuration API without the combinatorial explosion of constructor overloads. It's the most idiomatic appearance of partial application in Go, far more common there than curry chains.
</details>

---

## Senior — API Design & Composition

> Designing curry-friendly APIs, synergy with composition, and language ergonomics.

**Q22. Why design APIs "data-last" for a curry-friendly library?**

<details><summary>Answer</summary>

Because the value being transformed is what flows through a pipeline, while the operators are what you specialize *up front*. Putting data last means partially applying the operator (`map(fn)`, `filter(pred)`, `sortBy(key)`) yields a unary `data -> data` function — the exact shape pipelines and composition need. If data came first, partially applying the operator would require skipping the first parameter, which currying can't express. Data-last is therefore not aesthetic preference; it's what makes point-free composition mechanically possible. The cost: one-off calls read slightly less naturally than data-first (`map(fn)(data)` vs `data.map(fn)`).
</details>

**Q23. Walk through the synergy between currying and `compose`.**

<details><summary>Answer</summary>

`compose` chains unary functions: `compose(h, g, f)(x) = h(g(f(x)))`. Real transformations are usually multi-argument (`filter(pred, xs)`), so currying reduces them to unary by pre-supplying the non-data arguments. The pattern:

```python
pipeline = compose(
    take(10),            # take(10) is unary: list -> list
    map(get_name),       # map(get_name) is unary
    filter(is_active),   # filter(is_active) is unary
)
result = pipeline(users)
```

Each curried/partially-applied operator becomes a unary stage; `compose` glues them. Without currying you'd write a lambda for every stage (`lambda xs: filter(is_active, xs)`), which is the noise currying removes. Currying is the enabling mechanism; composition is the payoff.
</details>

**Q24. A teammate curries every function "to be functional." What's your pushback?**

<details><summary>Answer</summary>

Currying is a tool, not a virtue — apply it where it buys composition or specialization, not by default. Blanket currying produces high-arity chains with no named arguments at the call site (error-prone ordering), worse stack traces, heavier per-call closure allocation, and types that are painful in Java/Go. The senior framing: curry *operators* that feed pipelines and that you'll specialize (`map`, `filter`, comparison builders); leave *business operations* with named/struct arguments for clarity. "Functional" means reasoning about values and composition, not maximizing the number of `()` in a call.
</details>

**Q25. How does currying interact with named/keyword arguments?**

<details><summary>Answer</summary>

Poorly — they pull in opposite directions. Currying is inherently *positional and ordered*: `f(a)(b)(c)` has no place to name arguments, so it relies on the caller knowing the order. Keyword arguments exist precisely to *free* callers from order and to self-document. Languages lean one way: Haskell/OCaml curry everything and rely on type signatures + sometimes labeled args; Python/Swift favor keyword args and rarely curry. The design lesson: curry low-arity functions where order is obvious; for many heterogeneous parameters, prefer keyword args or an options object over a curry chain.
</details>

**Q26. How would you build a reusable comparator or predicate with partial application?**

<details><summary>Answer</summary>

Fix the varying-by-context parameter early and expose the per-element parameter:

```python
def greater_than(threshold):
    return lambda x: x > threshold          # partial application

over_100 = greater_than(100)
list(filter(over_100, values))

# comparator factory
def by_key(key):
    return lambda a, b: (a[key] > b[key]) - (a[key] < b[key])
sort(rows, cmp=by_key("price"))
```

This is partial application as a *factory* for small, named, reusable, testable functions — `over_100` reads better than an inline lambda and can be unit-tested in isolation. It's one of the most defensible everyday uses.
</details>

**Q27. Does currying conflict with how stack traces and debugging work?**

<details><summary>Answer</summary>

Yes, somewhat. Each layer of a curried chain is an anonymous closure, so a crash deep in `f(a)(b)(c)` shows a stack of nameless `<lambda>`/`func1` frames with little indication of *which* argument or stage failed. Auto-curry wrappers add their own dispatch frames on top. Debuggers can't easily show "you're between supplying `b` and `c`." This is a real ergonomic cost weighed against the compositional benefit — and a reason to keep curried functions small, named where possible, and shallow.
</details>

**Q28. Compare language ergonomics for currying across Haskell, Python, Go, and Java.**

<details><summary>Answer</summary>

- **Haskell:** currying is the default — `f a b` *is* `(f a) b` — with zero syntax cost and types that read naturally (`Int -> Int -> Int`). Partial application is the idiomatic way to specialize.
- **Python:** no auto-curry; `functools.partial` for partial application, nested lambdas or `toolz.curry` for currying. Idiomatic Python prefers keyword args and `partial` over curry chains.
- **Go:** no sugar at all; you return explicit closures. Verbose, used mainly for functional options, not deep currying.
- **Java:** curried *types* must be spelled out (`Function<A, Function<B, C>>`), extremely verbose past arity 2–3; partial application via lambda capture is common, true currying rare.

The pattern: the more a language's syntax and type system assume currying, the more idiomatic it is; bolted on, it costs verbosity and is used sparingly.
</details>

**Q29. When is partial application clearly the right tool over a class or closure factory?**

<details><summary>Answer</summary>

When you need *one* specialized behavior and the "state" is just a few fixed arguments. `partial(connect, host, port)` is lighter than a `Connector` class with a constructor and a single method. Reach for partial application when: the thing is conceptually a function, not an object with identity or lifecycle; there's no mutable state to manage; and you want a quick, testable specialization. Reach for a class when there's mutable state, multiple related methods, or you need polymorphism. Partial application is the minimal tool; don't escalate to a class until state or behavior demands it.
</details>

**Q30. How does currying relate to point-free (tacit) style?**

<details><summary>Answer</summary>

Point-free style writes functions as compositions of other functions *without naming their arguments* (`f = compose(g, h)` rather than `f = x => g(h(x))`). It's only feasible because currying/partial application turn multi-arg operators into unary functions that compose. So currying is the enabling substrate for point-free code. The trade-off: point-free can be elegant and noise-free at low complexity but becomes cryptic ("pointless style") when overused — the reader loses the anchor of named intermediate values. Use it where the data flow is linear and obvious. See [Composition](../05-composition/senior.md).
</details>

---

## Professional / Deep — Isomorphism, Cost, GHC

> The theory, the runtime cost of closures, and how a real compiler handles it.

**Q31. Explain the curry/uncurry isomorphism formally.**

<details><summary>Answer</summary>

For any function of a pair, there's an equivalent function returning a function, and vice versa, with no loss of information:

```
curry   : ((A, B) -> C) -> (A -> (B -> C))
uncurry : (A -> (B -> C)) -> ((A, B) -> C)
```

`curry` and `uncurry` are mutual inverses (`uncurry (curry f) = f`), so the two function spaces are *isomorphic*. In type-theory terms it's the exponential law `C^(A×B) ≅ (C^B)^A` — the same identity as `(x^b)^a = x^(a·b)` in arithmetic. The practical upshot: choosing curried vs uncurried is a free, reversible representation choice; no expressiveness is gained or lost, only ergonomics and (in some runtimes) performance.
</details>

**Q32. Does currying cost performance?**

<details><summary>Answer</summary>

In principle, yes; in practice, usually negligible — but it depends on the runtime. Each partial application allocates a *closure* capturing the supplied arguments, so a naive `f(a)(b)(c)` is up to three allocations and three calls instead of one call. In a GC'd language that's heap pressure and indirection on a hot path. But: many runtimes optimize it. GHC represents partial applications efficiently (PAPs, below) and the strictness analyzer/inliner often eliminate the intermediates entirely; the JVM JIT inlines small lambdas and can scalar-replace short-lived closures via escape analysis. The honest answer: "It allocates closures, so it has a cost; it matters only on proven hot paths, and modern optimizers erase most of it — measure before worrying."
</details>

**Q33. What is a PAP in GHC?**

<details><summary>Answer</summary>

A **PAP** is GHC's runtime representation of a *partial application* — a function applied to fewer arguments than its arity. Rather than building a deep chain of one-argument closures, GHC's evaluation model (the STG machine / eval-apply) knows each function's arity and, when a function is under-applied, allocates a single PAP object holding the function and the arguments supplied so far. When the remaining arguments arrive, it does one efficient call with the full argument set. This means Haskell's "everything is curried" doesn't translate to N allocations and N calls per N-ary application — fully-saturated calls are made directly, and only genuine partial applications allocate a PAP. It's why pervasive currying is cheap in Haskell.
</details>

**Q34. Why does Haskell curry everything?**

<details><summary>Answer</summary>

Several reinforcing reasons. (1) **Uniformity** — every function is conceptually unary (`a -> b -> c` is `a -> (b -> c)`), so partial application, sections (`(+1)`), and composition need no special cases. (2) **Free partial application** — specializing a function is just supplying fewer arguments, no wrapper needed, which makes point-free and combinator-heavy code natural. (3) **Type clarity** — the `->` in a signature is a single right-associative operator, so the type system has one rule for application. (4) **It's cheap** — the eval-apply model with PAPs makes saturated calls direct and partial ones a single allocation. The cost (positional, order-dependent application) is mitigated by strong types and the culture of small functions.
</details>

**Q35. What does uncurrying buy you, ever?**

<details><summary>Answer</summary>

Performance and interop. An uncurried function takes all arguments in one call, so there are no intermediate closures to allocate and the call site is a single jump — which is why hot inner loops and FFI boundaries prefer tupled/uncurried forms, and why GHC's worker/wrapper transformation effectively uncurries strict arguments. Uncurried also maps directly onto languages and ABIs that pass all arguments at once (C, the JVM). So while currying aids composition at the source level, *uncurrying* is frequently what the compiler does underneath for speed. They're two ends of the same isomorphism, each optimal for a different concern.
</details>

**Q36. How does closure allocation actually differ between a curried chain and a single multi-arg call?**

<details><summary>Answer</summary>

A single `f(a, b, c)` pushes three arguments and makes one call — no heap allocation for the call itself. A naive curried `f(a)(b)(c)` creates an intermediate function object after `f(a)` (capturing `a`) and another after `(b)` (capturing `a` and `b`), each typically heap-allocated and GC-tracked, before the final invocation. So the cost is (a) extra allocations proportional to depth, (b) extra indirect calls, and (c) the captured environments living until collected. Optimizers fight this with inlining, escape analysis (stack-allocate or eliminate non-escaping closures), and arity-aware representations (PAPs). On a cold path the difference is irrelevant; in a tight loop run millions of times it can be measurable.
</details>

**Q37. Is the curry isomorphism exact in a language with effects or laziness?**

<details><summary>Answer</summary>

It needs care. The pure isomorphism assumes evaluating arguments has no observable effect and no bottom/⊥ subtleties. With **strict, effectful** evaluation, *when* an argument is evaluated can differ: `f(sideEffect(), x)` evaluates both before calling, while a curried `f(sideEffect())(x)` might interleave effects differently if intermediate steps run code. With **laziness** (Haskell), `(A, B)` as a tuple introduces a possible ⊥ at the pair that `A -> B -> C` doesn't, so `curry`/`uncurry` are inverses only up to the handling of bottom on the tuple. In well-behaved (total, pure, or properly lazy) code the isomorphism holds; in the presence of side effects and partiality you must reason about evaluation order, which is one more reason FP pushes effects to the edges. See [Pure Functions](../02-pure-functions-and-referential-transparency/interview.md).
</details>

**Q38. How does the JVM handle curried lambdas under the hood?**

<details><summary>Answer</summary>

Each Java lambda compiles (via `invokedynamic` + `LambdaMetafactory`) to an instance of a functional-interface type; a curried `a -> b -> a + b` produces an outer object whose `apply` returns an inner object capturing `a`. So `add.apply(5)` allocates the inner `Function`. The JIT then does the heavy lifting: hot, small lambdas get inlined, and escape analysis can scalar-replace a captured environment that doesn't escape, eliminating the allocation entirely. The result mirrors the general rule — semantically there are closures and allocations, but for hot code the JIT often optimizes them away, so the cost is real on paper and frequently free in practice.
</details>

**Q39. Curry, uncurry, flip — what are these combinators and why do they matter?**

<details><summary>Answer</summary>

They are the small "plumbing" functions for adapting argument shapes:

- `curry :: ((a, b) -> c) -> a -> b -> c` — tuple form to curried form.
- `uncurry :: (a -> b -> c) -> (a, b) -> c` — curried form to tuple form (handy for `map (uncurry f) pairs`).
- `flip :: (a -> b -> c) -> b -> a -> c` — swaps the first two arguments, letting you partially apply the "second" argument when an API is data-first instead of data-last.

They matter because they let you reconcile a function's *actual* argument order with the order a combinator or pipeline *needs* — `flip` in particular rescues data-first APIs for partial application. They're the adapters that keep point-free code flowing without rewriting the underlying functions.
</details>

---

## Code-Reading — What Does This Return?

> You're shown a snippet; say exactly what the call evaluates to or returns.

**Q40. Python — what does each line return?**

```python
from functools import partial
def f(a, b, c): return (a, b, c)
g = partial(f, 1, 2)
x = g(3)
y = partial(f, c=9)
z = y(1, 2)
```

<details><summary>Answer</summary>

- `g` is a `functools.partial` object (a *callable*, not a tuple) with `a=1, b=2` fixed.
- `x = g(3)` → `(1, 2, 3)` — the remaining positional `c` is supplied.
- `y` is a partial fixing the keyword `c=9`, still expecting `a` and `b`.
- `z = y(1, 2)` → `(1, 2, 9)` — positionals fill `a, b`, keyword `c` already bound.

Key point: `g` and `y` are *functions*, not results; the tuple only appears once the call is completed. Forgetting that `partial(...)` returns a callable is the common slip.
</details>

**Q41. Python — currying with lambdas; what is `r`?**

```python
mul = lambda a: lambda b: lambda c: a * b * c
r = mul(2)(3)
```

<details><summary>Answer</summary>

`r` is a **function**, not `6`. `mul(2)(3)` has supplied only two of the three layers, so it returns `lambda c: 2 * 3 * c` — a unary function awaiting `c`. You'd need `mul(2)(3)(4)` to get a number (`24`). A frequent trap: assuming a curried chain evaluates as soon as it "looks like enough" arguments — it evaluates only when the *final* unary layer is called.
</details>

**Q42. Go — what does `f` do and what does the final call print?**

```go
func multiplier(factor int) func(int) int {
    return func(n int) int { return n * factor }
}
double := multiplier(2)
triple := multiplier(3)
fmt.Println(double(triple(4)))
```

<details><summary>Answer</summary>

`multiplier(2)` returns a closure capturing `factor=2`; `multiplier(3)` returns one capturing `factor=3`. `triple(4)` → `12`; `double(12)` → `24`. Prints **`24`**. This is partial application via closures: each call to `multiplier` fixes the `factor` argument and returns a specialized unary function. `double` and `triple` are independent — each closed over its own `factor`.
</details>

**Q43. Go — does this compile, and what's the type of `add5`?**

```go
add := func(a int) func(int) int {
    return func(b int) int { return a + b }
}
add5 := add(5)
```

<details><summary>Answer</summary>

It compiles. `add5` has type `func(int) int` — calling `add(5)` returns the inner closure that has captured `a=5`. `add5` is *not* an `int`; it's a function value, so `add5(3)` would yield `8`. The captured `a` lives in the closure's environment for as long as `add5` is reachable.
</details>

**Q44. Java — what is the type and value here?**

```java
Function<Integer, Function<Integer, Integer>> add = a -> b -> a + b;
var partial = add.apply(10);
var result  = partial.apply(5);
```

<details><summary>Answer</summary>

- `add` is a curried binary adder: `Function<Integer, Function<Integer, Integer>>`.
- `partial = add.apply(10)` has type `Function<Integer, Integer>` — a *function*, with `a=10` captured; not yet a number.
- `result = partial.apply(5)` → `Integer` `15`.

The lesson: the first `.apply` returns the inner `Function`; only the second `.apply` produces the value. The nested generic type is the verbose price Java pays for currying without language support.
</details>

**Q45. Python — spot the bug in this partial.**

```python
from functools import partial
def divide(a, b): return a / b
half = partial(divide, b=2)
print(half(10))     # ?
print(half(10, 3))  # ?
```

<details><summary>Answer</summary>

- `half(10)` → `5.0`. `a=10`, `b=2` (fixed) — fine.
- `half(10, 3)` → **`TypeError: divide() got multiple values for argument 'b'`**. The positional `3` tries to fill `b`, but `b` is already bound by the partial's keyword, so it's supplied twice.

The bug: fixing a *keyword* argument with `partial` doesn't let later callers override it positionally — it locks that slot. If you wanted to fix the *first* argument instead (a "divide-into" helper), `partial(divide, 10)` fixing `a` would behave differently. Argument-binding order is a classic `partial` gotcha.
</details>

**Q46. Python — what's printed, and why is it surprising?**

```python
funcs = [lambda x, i=i: x + i for i in range(3)]
g = funcs[1]
print(g(10))
```

<details><summary>Answer</summary>

Prints **`11`**. The `i=i` default *captures the current value of `i`* at definition time — a deliberate partial-application idiom to avoid the late-binding closure trap. Without `i=i` (i.e. `lambda x: x + i`), all three closures would share the *same* `i` and print `12` (the final loop value) regardless of index. So `i=i` partially applies each loop value into its own closure. This is the canonical "loop variable capture" gotcha and the standard fix.
</details>

---

## Curveballs

> The questions designed to catch glib answers.

**Q47. "Currying and partial application are the same thing, right?"**

<details><summary>Answer</summary>

No — and asserting they're identical is the trap. Currying *transforms the shape* of a function into a chain of unary functions (a one-time structural change). Partial application *fixes some arguments* of a function and returns a function of the rest (an operation on arguments). A curried function makes partial application trivial, so they co-occur, but `functools.partial` partially applies *without* currying, and you can curry a function you never partially apply. Currying enables; partial application acts. Conflating them signals surface-level familiarity.
</details>

**Q48. "Is `functools.partial` currying?" (asked deliberately to trap.)**

<details><summary>Answer</summary>

No. It's partial application. `partial(f, x)` returns a callable that still takes the *remaining arguments together*, and it doesn't reshape `f` into nested unary functions. Currying would require `f(x)(y)(z)`. Python ships partial application (`functools.partial`) but no built-in currying — you'd reach for nested lambdas or `toolz.curry`. The name `partial` is literally telling you the answer.
</details>

**Q49. "Why does Haskell curry everything?"**

<details><summary>Answer</summary>

For uniformity, free partial application, and clean types — and because it's cheap there. Every function being unary means sections, composition, and specialization need no special cases; supplying fewer arguments *is* partial application, so combinator-heavy code is natural; and the `->` in a signature is one right-associative operator with one application rule. The usual objection ("N allocations per N-ary call") doesn't bite because GHC's eval-apply model uses arity info: saturated calls are direct, and only genuine partial applications allocate a single PAP. So Haskell gets the ergonomics without the naive cost.
</details>

**Q50. "Does currying cost performance?"**

<details><summary>Answer</summary>

It can, but usually doesn't matter. Each partial step allocates a closure capturing the supplied args, so naive currying means extra allocations and indirect calls versus one saturated call — real heap pressure on a hot path. But GHC (PAPs), the JVM JIT (inlining + escape-analysis scalar replacement), and most optimizers erase the intermediates in practice. The professional answer: name the cost (closure allocation, indirection), note that compilers optimize most of it away, and insist on *measuring* before treating it as a problem — it's a non-issue everywhere except proven hot loops.
</details>

**Q51. "Why data-last argument order for curry-friendly APIs?"**

<details><summary>Answer</summary>

Because the data is what flows through a pipeline and the operators are what you specialize first. Putting data last means partially applying the operator (`map(fn)`, `filter(pred)`) gives a unary `data -> data` function — exactly the shape composition needs. Data-first would force you to skip the first parameter to specialize the operator, which currying can't do (you'd need `flip`). So data-last isn't taste; it's the mechanical precondition for point-free composition. The price is that one-off, non-pipeline calls read a touch less naturally.
</details>

**Q52. "If currying changes nothing about the result, isn't it pointless?"**

<details><summary>Answer</summary>

No — its value is in *ergonomics and composability*, not in the result. Currying leaves the input-to-output mapping identical (that invariance is the whole point of the isomorphism); what it changes is the *shape* you interact with: unary functions that compose, specialize, and feed pipelines without wrapper lambdas. Saying it's pointless because the result is unchanged is like saying named variables are pointless because the bytes are the same — the benefit is for the human writing and composing the code, not the value computed. Where composition isn't needed, currying genuinely *is* unnecessary; the skill is knowing when it pays.
</details>

**Q53. "I curried a function but supplying all the arguments at once still works. Is it broken?"**

<details><summary>Answer</summary>

Probably not — you likely have an *auto-curried* function. Auto-curry wrappers (Ramda, `toolz.curry`, Haskell's native currying) accept arguments in any grouping up to the arity: `f(1, 2, 3)`, `f(1)(2, 3)`, and `f(1)(2)(3)` are all valid and equivalent. A *manually* curried function (`a => b => c => ...`) would reject `f(1, 2, 3)` because the outer layer takes exactly one argument. So "all-at-once works" tells you which flavor you have, not that anything is wrong. The risk with auto-curry is over-application or arity confusion with variadic/optional arguments.
</details>

**Q54. "Doesn't dependency injection make partial application redundant in OO code?"**

<details><summary>Answer</summary>

They're the same idea in different clothing, so neither makes the other redundant — you pick by context. DI containers wire an object's collaborators at construction; partial application fixes a function's arguments and returns a specialized function. Both pre-supply "the stable stuff" and expose "the varying stuff." In an OO codebase with lifecycles, multiple methods, and configuration frameworks, DI/constructor injection fits the grain. For a single specialized behavior with no mutable state, partial application is lighter than a one-method class. Recognizing they're the same pattern is the senior insight; choosing the lighter tool when state doesn't demand a class is the judgment.
</details>

**Q55. "Currying is positional and order-dependent — isn't that fragile?"**

<details><summary>Answer</summary>

It's a real weakness, mitigated by context. Because `f(a)(b)(c)` has no argument names at the call site, a wrong order can silently type-check (especially with same-typed arguments) and produce a bug. Strongly-typed, distinctly-typed signatures catch many such errors at compile time, and keeping curried functions *low-arity* keeps the order obvious. The fragility grows with arity and with arguments of the same type. The mitigation: curry only low-arity operators with a natural order; for many heterogeneous arguments, prefer keyword args or an options struct over a deep curry chain.
</details>

---

## Rapid-Fire / One-Liners

> Crisp answers; what an interviewer wants in one or two sentences.

**Q56. Currying in one sentence?**

<details><summary>Answer</summary>

Rewriting an N-argument function as N nested one-argument functions: `f(a, b, c)` → `f(a)(b)(c)`.
</details>

**Q57. Partial application in one sentence?**

<details><summary>Answer</summary>

Fixing some of a function's arguments to get a new function of the remaining ones.
</details>

**Q58. The one-line distinction?**

<details><summary>Answer</summary>

Currying *reshapes* a function into unary chains; partial application *fixes arguments* to specialize it. Currying enables; partial application acts.
</details>

**Q59. Is `functools.partial` currying — yes or no?**

<details><summary>Answer</summary>

No. It's partial application; it returns a callable taking the remaining args together, not a one-at-a-time chain.
</details>

**Q60. What single language feature makes both possible?**

<details><summary>Answer</summary>

Closures — the captured environment that remembers the already-supplied arguments.
</details>

**Q61. Why data-last in curry-friendly APIs?**

<details><summary>Answer</summary>

So partially applying the operator yields a unary `data -> data` function ready for composition.
</details>

**Q62. What's a PAP?**

<details><summary>Answer</summary>

GHC's single-object runtime representation of a partially applied (under-saturated) function, so currying stays cheap.
</details>

**Q63. What does `flip` do and why care?**

<details><summary>Answer</summary>

Swaps a function's first two arguments — it rescues data-first APIs for partial application.
</details>

**Q64. Curry/uncurry — what's the relationship?**

<details><summary>Answer</summary>

Mutual inverses; an isomorphism (`C^(A×B) ≅ (C^B)^A`), so the choice is a free, reversible representation decision.
</details>

**Q65. The cheapest real win of partial application?**

<details><summary>Answer</summary>

Turning a configured operator into a small named reusable function — `add5`, `isOver100`, `logError` — instead of repeating inline lambdas.
</details>

---

## How to Talk About Currying in Interviews

A few habits separate a strong answer from a textbook recital:

- **Nail the distinction first.** The single most-tested point is currying (reshape) vs partial application (fix arguments). Lead with it crisply — "currying enables, partial application acts" — before anything else.
- **Never call `functools.partial` currying.** It's the canonical trap. Name it partial application and note Python has no built-in currying.
- **Lead with the *why*, not the mechanics.** The value is composability and specialization, not the result (which is unchanged). Tie it to composition and point-free style — that's where currying earns its keep.
- **Name the trade-offs unprompted.** Positional/order-dependent calls, no argument names at the call site, cryptic stack traces, verbose types in Java/Go, and closure-allocation cost. Senior signal is volunteering the downsides.
- **Be precise about performance.** "It allocates closures, so it has a cost; GHC PAPs and the JVM JIT erase most of it; measure before worrying." Avoid both "it's free" and "it's slow."
- **Connect to dependency injection.** Recognizing that DI is partial application of dependencies shows you see the pattern across paradigms.
- **Calibrate, don't evangelize.** "Curry low-arity operators that feed pipelines; prefer keyword args / options objects for many heterogeneous arguments" beats "always curry."

---

## Summary

- **Currying** transforms an N-ary function into N nested unary functions (`f(a)(b)(c)`); **partial application** fixes some arguments and returns a function of the rest. Currying reshapes; partial application feeds. A curried function makes partial application trivial, but `functools.partial` partially applies *without* currying — the distinction is the most-tested point.
- Both rely on **closures** to remember already-supplied arguments. The junior bar is the definition and distinction; the middle bar is per-language idioms (`functools.partial`, Go closures, Java `Function<A, Function<B, C>>`, functional options) and the partial-application-as-DI insight.
- The senior bar is **API design**: data-last argument order makes partially-applied operators into unary `data -> data` stages that compose, which is why `map`/`filter` take the function first. Currying is the substrate for composition and point-free style; over-currying costs readability, ordering safety, and clean types.
- The professional bar is the **curry/uncurry isomorphism** (`C^(A×B) ≅ (C^B)^A`), the **closure-allocation cost**, and how real runtimes (GHC **PAPs**, JVM JIT inlining + escape analysis) make pervasive currying cheap. The honest performance answer names the cost and insists on measuring.

---

## Related Topics

- [`junior.md`](junior.md) — the definitions and the key distinction, gently.
- [`middle.md`](middle.md) — per-language idioms and everyday partial application.
- [`senior.md`](senior.md) — data-last API design and composition synergy.
- [`professional.md`](professional.md) — the isomorphism, closure cost, and GHC PAPs.
- [First-Class & Higher-Order Functions](../01-first-class-and-higher-order-functions/interview.md) — closures, the mechanism currying is built on.
- [Composition](../05-composition/interview.md) — `f ∘ g`, pipelines, and point-free style that currying enables.
- [Pure Functions & Referential Transparency](../02-pure-functions-and-referential-transparency/interview.md) — why effect order complicates the curry isomorphism.
- [Recursion & Tail Calls](../08-recursion-and-tail-calls/interview.md) — the other half of the FP "no loops, no mutation" toolkit.
- [Functional Programming](../README.md) — the roadmap overview and section map.
