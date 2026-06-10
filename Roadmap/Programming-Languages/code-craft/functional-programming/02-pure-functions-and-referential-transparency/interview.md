# Pure Functions & Referential Transparency — Interview Q&A

> **Roadmap:** [Functional Programming](../README.md) → Pure Functions & Referential Transparency
>
> *A function is **pure** when its output depends only on its inputs and it changes nothing the rest of the program can observe. When that holds, a call can be replaced by its result without altering the program's meaning — that substitutability is **referential transparency**, and it is the property that makes code easy to test, cache, parallelize, and reason about.*

A bank of 65+ interview questions and answers spanning definitions, the functional-core/imperative-shell architecture, testing without mocks, concurrency safety, compiler optimization, and the formal substitution model. Each answer models the reasoning a strong candidate gives — including the trade-offs. Use the `<details>` toggles to self-quiz: read the question, answer out loud, then expand.

---

## Table of Contents

1. [Fundamentals / Junior](#fundamentals--junior)
2. [Intermediate / Middle](#intermediate--middle)
3. [Senior — Architecting Around Purity](#senior--architecting-around-purity)
4. [Professional / Deep — Substitution, Optimization, Trade-offs](#professional--deep--substitution-optimization-trade-offs)
5. [Code-Reading — Is This Function Pure?](#code-reading--is-this-function-pure)
6. [Curveballs](#curveballs)
7. [Rapid-Fire / One-Liners](#rapid-fire--one-liners)
8. How to Talk About Purity in Interviews
9. [Summary](#summary)
10. [Related Topics](#related-topics)

---

## Fundamentals / Junior

> Definitions, the two clauses of purity, and the "why does it matter" reasoning.

**Q1. Define a pure function in one sentence.**

<details><summary>Answer</summary>

A pure function is one whose return value is determined **solely by its arguments** (same inputs → same output, always) and which produces **no observable side effects** (it changes nothing outside itself). Both clauses must hold. The first gives *determinism*; the second gives *isolation*. Together they mean the function is a true mathematical function — a fixed mapping from inputs to outputs.
</details>

**Q2. What is a side effect? Give three examples.**

<details><summary>Answer</summary>

A side effect is any interaction with the world outside the function's local scope that is observable from the rest of the program. Examples: mutating a shared variable, field, or argument; performing I/O (writing to disk, the network, the console, a database); reading mutable global state or the system clock; sending an event or message. The test is *observability* — if removing the call would change anything an outside observer can detect (other than the returned value), the function has a side effect.
</details>

**Q3. What is referential transparency?**

<details><summary>Answer</summary>

An expression is referentially transparent if you can replace it with its computed value anywhere in the program without changing the program's behavior. `add(2, 3)` is referentially transparent because substituting `5` everywhere is always safe. `time.Now()` is not — you cannot replace it with a fixed value and preserve meaning. Referential transparency is the *consequence* of purity: a pure call is always safe to substitute with its result, which is exactly what makes equational reasoning possible.
</details>

**Q4. What's the relationship between "pure function" and "referentially transparent"?**

<details><summary>Answer</summary>

They describe the same property from two angles. *Purity* is a property of a **function** (it's deterministic and side-effect-free); *referential transparency* is a property of an **expression / call site** (it can be replaced by its value). A function is pure exactly when every call to it is referentially transparent. Interviewers use the terms almost interchangeably, but the precise phrasing is: purity is what you build, referential transparency is what you get.
</details>

**Q5. Why are pure functions easier to test?**

<details><summary>Answer</summary>

Because a test of a pure function is just `assert f(input) == expectedOutput` — no setup, no teardown, no mocks, no database, no clock control. The output depends on nothing but the arguments, so the test is fully specified by the inputs you pass. There's no hidden state to arrange and no side effect to verify with a spy. This is why the most valuable refactor for testability is usually pushing pure logic out of effectful code: the logic becomes trivially testable and the remaining effects shrink to a thin shell.
</details>

**Q6. Give a pure and an impure version of the same function.**

<details><summary>Answer</summary>

```go
// Impure: reads & mutates external state, does I/O.
var total int
func addImpure(x int) {
    total += x              // mutates global
    fmt.Println(total)      // I/O
}

// Pure: output depends only on inputs, no observable effect.
func addPure(running, x int) int {
    return running + x
}
```

`addPure(running, x)` is deterministic and effect-free: `addPure(10, 5)` is *always* `15` and can be replaced by `15` anywhere. `addImpure` depends on and mutates `total` and writes to stdout, so its result and behavior vary with hidden state.
</details>

**Q7. Why does determinism alone not make a function pure?**

<details><summary>Answer</summary>

A function can be perfectly deterministic and still have side effects. `func setName(u *User, n string) { u.Name = n }` returns the same (nothing) for the same inputs, but it mutates the caller's object — a side effect. Purity needs *both* clauses: deterministic output **and** no observable effect. Conversely, a function can be effect-free but non-deterministic (`rand.Int()` with no global mutation still varies), and that also fails purity. The two clauses are independent and both are required.
</details>

**Q8. Is a function that only reads its arguments and returns a value always pure?**

<details><summary>Answer</summary>

Almost — with one caveat: it must treat the data reachable from its arguments as read-only and produce its result without mutating it. If an argument is a mutable reference and the function mutates it, or if it reads a mutable global through a captured closure, it's impure even though it "only reads its arguments" on the surface. So: reads only its inputs, treats them as read-only, returns a value derived purely from them, touches nothing else → pure.
</details>

**Q9. Name four concrete benefits purity buys you.**

<details><summary>Answer</summary>

1. **Testability** — assert input→output, no mocks.
2. **Concurrency safety** — no shared mutable state means no data races; pure functions are trivially thread-safe.
3. **Cacheability / memoization** — same input always gives same output, so results can be cached safely.
4. **Reasoning & refactoring** — you can move, reorder, deduplicate, and substitute pure calls freely (equational reasoning), because nothing depends on *when* or *how often* they run.

Bonus: reproducibility (a bug reproduces from the inputs alone) and compiler optimizations (CSE, hoisting).
</details>

**Q10. What is "equational reasoning"?**

<details><summary>Answer</summary>

Equational reasoning is treating code like algebra: because a pure call equals its result, you can substitute one for the other, factor common subexpressions out, inline definitions, and prove two expressions equivalent — exactly as you'd manipulate `x + x = 2x`. It only works on referentially transparent code. The moment a subexpression has a side effect or reads mutable state, the substitution may change behavior, and you lose the ability to reason about the code as equations. Purity is what makes your code "do algebra to."
</details>

**Q11. Is `len(s)` for an immutable string pure?**

<details><summary>Answer</summary>

For an immutable input, yes: given the same string it always returns the same length and changes nothing, so it's referentially transparent. The subtlety is whether the input can change *underneath* you. For an immutable string it can't. For a mutable collection shared across threads, the "same input" premise can be violated by another thread mutating it — but that's a property of the *caller's* sharing, not of `len` itself. The function `len` is pure; impurity would come from surrounding mutable aliasing.
</details>

**Q12. Why do FP advocates say purity makes programs easier to reason about?**

<details><summary>Answer</summary>

Because most bugs live in the gap between what code *says* and what it *does* across time — stale state, ordering dependencies, hidden mutation, surprise I/O. Pure functions close that gap: what you see in the signature and body is the whole truth, with no temporal or external dependency. By pushing as much logic as possible into pure functions, you shrink the part of the program where "when did this run and what else changed?" matters down to a small, auditable shell. The payoff is concentrating the hard-to-reason-about effects in one thin place.
</details>

---

## Intermediate / Middle

> Making code pure, the functional core / imperative shell, memoization, and testing without mocks.

**Q13. What is the "functional core, imperative shell" pattern?**

<details><summary>Answer</summary>

It's an architecture that splits a program into two layers: a **functional core** of pure functions holding all the decision logic (calculations, transformations, business rules), and a thin **imperative shell** that performs the effects (reads input, calls the core, writes the results — DB, network, console). The core is large, pure, and exhaustively unit-tested; the shell is small, effectful, and covered by a few integration tests. The shell *gathers* inputs, hands them to the core, and *enacts* the core's decisions. This concentrates I/O at the edges and keeps the brain of the program trivially testable.
</details>

**Q14. Refactor this impure function into a pure core + thin shell.**

```python
def charge_overdue(user_id):
    user = db.get_user(user_id)                 # I/O
    if user.balance < 0:
        fee = abs(user.balance) * 0.05
        user.balance -= fee                     # mutation
        db.save(user)                           # I/O
        email.send(user.email, f"Fee: {fee}")   # I/O
```

<details><summary>Answer</summary>

Pull the decision out as a pure function; let the shell do I/O.

```python
# Pure core: input -> decision, no I/O, no mutation.
def overdue_fee(balance):
    return abs(balance) * 0.05 if balance < 0 else 0.0

# Imperative shell: gather, decide via core, enact.
def charge_overdue(user_id):
    user = db.get_user(user_id)
    fee = overdue_fee(user.balance)
    if fee:
        db.save(replace(user, balance=user.balance - fee))
        email.send(user.email, f"Fee: {fee}")
```

`overdue_fee` is now testable with `assert overdue_fee(-200) == 10.0` — no DB, no email mock. The shell shrinks to plumbing, and the interesting logic (the fee rule) lives where it's easiest to test and reason about.
</details>

**Q15. How does purity let you test without mocks?**

<details><summary>Answer</summary>

Mocks exist to stand in for effectful collaborators — a database, a clock, an email sender. If the logic under test is pure, it has no collaborators to mock; you pass values in and assert on values out. Mocks don't disappear entirely, but they retreat to the thin shell where the real effects live, and even there you often prefer a real or in-memory implementation covered by a few integration tests. The rule of thumb: heavy mocking is usually a smell that pure logic is tangled up with effects — separate them and most mocks evaporate.
</details>

**Q16. How do you make a function that depends on the current time pure?**

<details><summary>Answer</summary>

Inject the time as a parameter instead of reading the clock inside. `func isExpired(t, now time.Time) bool { return t.Before(now) }` is pure — `now` is just an argument. The *shell* reads `time.Now()` once and passes it in; the *core* function becomes deterministic and testable with any fixed `now`. The general technique is **parameterizing the effect**: anything non-deterministic (clock, random seed, config, env) becomes an explicit input, moving the impurity up to the caller where it can be controlled.
</details>

**Q17. What is memoization and why does purity enable it?**

<details><summary>Answer</summary>

Memoization caches a function's outputs keyed by its inputs, so a repeat call returns the stored result instead of recomputing. It is *only sound for pure functions*: because the same input always yields the same output and there are no side effects, replaying a cached value is indistinguishable from calling again. For an impure function, memoization would skip the side effects (no email sent the second time) or return a stale answer when hidden state changed — silently wrong. Purity is the precondition that makes the cache transparent.
</details>

**Q18. Show memoization in Python and name its trade-offs.**

<details><summary>Answer</summary>

```python
from functools import lru_cache

@lru_cache(maxsize=None)
def fib(n):
    return n if n < 2 else fib(n - 1) + fib(n - 2)
```

`lru_cache` only works because `fib` is pure. **Trade-offs:** it trades memory for time (the cache grows; `maxsize=None` is unbounded — a leak risk for many distinct inputs); arguments must be **hashable** (no mutable lists/dicts as keys); it helps only when calls repeat (no benefit for all-distinct inputs, just overhead); and in concurrent code the cache itself becomes shared state needing thread-safety. Memoization is a classic space-for-time bet that pays off for expensive, repeated, pure computations.
</details>

**Q19. Can a pure function call another function and stay pure?**

<details><summary>Answer</summary>

Yes — purity composes. A function that calls only pure functions, passing values and returning values, is itself pure. The composition `h(x) = g(f(x))` is pure if both `f` and `g` are. The moment it calls *one* impure function (one that does I/O or mutates shared state), the impurity propagates upward: the caller becomes impure too. This "impurity is contagious upward" property is why FP pushes effects to the edges — one effectful call deep in a call tree taints everything above it.
</details>

**Q20. Why is mutating an input argument a side effect even if you also return a value?**

<details><summary>Answer</summary>

Because the mutation is observable by the caller (and anyone else aliasing that object) independently of the return value. `func sortInPlace(xs []int) []int { sort.Ints(xs); return xs }` changes the caller's slice — the original ordering is gone. Two callers sharing the slice now see each other's effects, and you can no longer substitute the call with its result without losing the mutation. A pure alternative returns a *new* sorted copy and leaves the input untouched. The defining issue is shared observable state, not whether a value is also returned.
</details>

**Q21. Is reading from an immutable global constant a side effect?**

<details><summary>Answer</summary>

No. Purity forbids reading *mutable* external state, because that breaks determinism — the result can change between calls. Reading a true constant (an immutable value fixed at compile/load time, like `math.Pi` or a frozen config) keeps determinism intact: the value never changes, so same inputs still give same output. Many people fold constants into "the function's inputs" conceptually. The line is mutability: read-only constants are fine; anything that can be reassigned or mutated elsewhere is not.
</details>

**Q22. How do you handle errors in a pure function without throwing?**

<details><summary>Answer</summary>

Return the error as a *value* rather than throwing as a side effect. In Go, return `(T, error)`; in Java, return an `Optional<T>` or a `Result`/`Either` type; in Python, return a value or a sentinel/`Result` object. Exceptions are a form of non-local control flow that callers must handle out of band, which complicates substitution and reasoning. Encoding failure in the return type keeps the function a total mapping from inputs to outputs (`parse(s) -> Result<Int, Error>`), preserves referential transparency, and makes the error path explicit in the signature.
</details>

**Q23. What's the practical limit — can a whole program be pure?**

<details><summary>Answer</summary>

No, and it shouldn't be. A program that does nothing observable is useless; the *point* of software is to produce effects — write a file, return an HTTP response, charge a card. Purity is not about eliminating effects but **isolating** them: keep the decision-making pure and confine the effects to a small, well-marked boundary. Even Haskell, the canonical pure language, performs I/O — it just makes effects explicit in the type system (`IO`). The goal is a large pure core and a thin impure shell, not a fantasy of zero effects.
</details>

**Q24. You have a function that logs and returns a computed value. How do you make the computation pure?**

<details><summary>Answer</summary>

Separate the computation from the logging. Extract a pure function that just computes and returns the value, and move the `log.Info(...)` call into the caller (the shell) or wrap it: `result := compute(x); log.Info(result)`. The pure `compute` is now testable and substitutable; the logging stays where effects belong. If you need observability inside, return the data needed for logging as part of the result and let the shell log it. The principle is to stop interleaving the *what to compute* with the *what to emit*.
</details>

**Q25. Compare a pure `map` with an in-place loop that mutates a list.**

<details><summary>Answer</summary>

```python
# Pure: builds a new list, leaves input untouched.
doubled = [x * 2 for x in xs]

# Impure: mutates xs in place.
for i in range(len(xs)):
    xs[i] *= 2
```

The comprehension is referentially transparent: `xs` is unchanged, the expression yields a new list, and any other holder of `xs` is unaffected. The in-place loop mutates shared state — callers aliasing `xs` see the change, ordering matters, and it isn't safe to run concurrently with readers. **Trade-off:** the pure version allocates a new list (memory + GC pressure); the in-place version is allocation-free but couples everyone who shares the list. For hot paths on large data the in-place version can win on performance, at the cost of the reasoning guarantees.
</details>

**Q26. Is a function pure if it caches its result in a private static variable (internal memoization)?**

<details><summary>Answer</summary>

From the *outside*, yes — it can still be referentially transparent: same input, same output, no externally observable effect, the cache is invisible to callers. This is the key insight that purity is about *observable* behavior, not internal mechanism. The caveats: the cache must be correctly keyed by all inputs, and in a concurrent context it must be thread-safe (otherwise the hidden mutation becomes an observable race). Pure functions can use mutable internal state as long as it never leaks; memoization is the classic example.
</details>

---

## Senior — Architecting Around Purity

> System-level purity, concurrency safety, idempotency, and language enforcement.

**Q27. How do you architect a service so that purity is the default and effects are the exception?**

<details><summary>Answer</summary>

Adopt functional core / imperative shell at the module boundary: handlers and adapters (HTTP, DB, queue) form a thin shell that does I/O and delegates all logic to a pure domain core. Make the core take plain data in and return plain data (commands, events, decisions) — never reaching out to do I/O itself. Effects become *descriptions* the shell interprets ("save this", "send that"), so the core decides and the shell acts. Enforce the boundary with package structure and review ("no `db`/`http` imports in the domain package"), and keep impure dependencies (clock, IDs, randomness) as injected parameters. The result: the vast majority of code is pure and unit-testable, and the effectful surface is small enough to audit.
</details>

**Q28. Why are pure functions inherently safe to run concurrently?**

<details><summary>Answer</summary>

Data races require shared *mutable* state accessed concurrently. A pure function reads only its inputs (treated as immutable) and writes nothing shared, so there is no mutable state to race on — multiple threads can call it simultaneously with no locks and no possibility of interference. This is the single biggest practical argument for purity in concurrent systems: it eliminates an entire class of bugs (races, torn reads, lost updates) by construction. The catch is that the *inputs* must actually be immutable; passing a shared mutable object into a "pure" function reintroduces the hazard through the back door.
</details>

**Q29. What is the relationship between referential transparency and idempotency? Aren't they the same?**

<details><summary>Answer</summary>

No — they're different and easily confused. **Referential transparency**: a call can be replaced by its value (a property about *purity* and substitution). **Idempotency**: applying an operation multiple times has the same effect as applying it once — `f(f(x)) == f(x)`, or for effects, doing it twice is the same as once (a property about *repeated effects*). A pure function is referentially transparent but need not be idempotent (`increment(x) = x+1`; calling it on its own output keeps changing it). An *effectful* operation like `PUT /users/5 {name:"Al"}` can be idempotent (repeating it leaves the same final state) while being decidedly not pure or referentially transparent. RT is about *no effects*; idempotency is about *effects that don't compound*.
</details>

**Q30. How do you handle randomness and unique IDs in a pure design?**

<details><summary>Answer</summary>

Treat the source of non-determinism as an input. Pass a seed (or a pre-drawn random value), or pass a pure pseudo-random generator and return the *next* generator alongside the result (`(value, nextRng) = rng.next()`) so the function stays deterministic given its inputs. For IDs, either pass the ID in from the shell (which generated it via `uuid`), or pass a generator. The shell owns the actual entropy source; the core receives concrete values or a threaded generator. This is exactly how Haskell's `StdGen` and "splittable" RNGs work — randomness becomes data flowing through pure code, not a hidden effect.
</details>

**Q31. How do different languages enforce or fail to enforce purity?**

<details><summary>Answer</summary>

It's a spectrum. **Haskell** enforces it in the type system — effects live in `IO` (and other monads), so the compiler *guarantees* a non-`IO` function is pure. **Rust** doesn't track purity directly, but its ownership/borrowing rules make uncontrolled mutation and aliasing hard, nudging toward purity (and `const fn` is compiler-checked pure-ish). **Go, Java, Python** offer *no* enforcement — purity is a convention you maintain by discipline, code review, and tooling. Java can hint with `record` (immutable data) and `final`; Python has `@dataclass(frozen=True)`. The lesson for an interview: in mainstream languages purity is a *property you uphold*, not one the compiler checks, so naming, package boundaries, and review carry the weight.
</details>

**Q32. A teammate says "we should make everything pure." What's your nuanced response?**

<details><summary>Answer</summary>

Agree with the spirit, push back on the absolutism. Maximizing the *pure core* is a great default — it's where testability and reasoning pay off. But effects are the program's reason to exist, and forcing every effect through elaborate pure machinery (effect monads, free monads) in a language with no support for it can add more ceremony than it removes, hurting the team that has to maintain it. The senior framing is "pure by default, effectful at the edges, and pragmatic about how hard we push the abstraction given the language and team." Purity is a tool for managing change-cost, not a religion.
</details>

**Q33. How does purity interact with caching and CQRS at the system level?**

<details><summary>Answer</summary>

Purity (and idempotency) are what make these patterns safe. HTTP caching relies on `GET` being safe/side-effect-free, so a cached response is indistinguishable from a fresh one — the same substitution property as referential transparency, lifted to the network. In CQRS, the *query* side is ideally pure/read-only (cacheable, replicable, side-effect-free), while the *command* side owns the effects. Treating reads as referentially transparent lets you cache, fan out to replicas, and retry freely; treating commands as idempotent lets you retry them safely under at-least-once delivery. The same two properties — no effects (RT) and non-compounding effects (idempotency) — underpin caching and reliable messaging.
</details>

**Q34. What's the cost of overzealous purity in a language like Go or Java?**

<details><summary>Answer</summary>

Mainly **allocation and copying**. Avoiding all mutation means returning new copies of data on every transformation — new slices, new objects — which raises GC pressure and can hurt throughput on hot paths or large datasets. Threading non-determinism (clocks, RNG, IDs) as explicit parameters can also bloat signatures and add plumbing. And without language support, deep pure abstractions (monadic effect systems) often read as foreign and increase onboarding cost. The senior move is to keep the *logic* pure (where copies are cheap and reasoning matters most) but allow controlled, *encapsulated* mutation in performance-critical internals where it's invisible to callers (the Q26 pattern) — pure interface, mutable implementation.
</details>

**Q35. How does purity make a system more reproducible and debuggable?**

<details><summary>Answer</summary>

A pure function's behavior is fully determined by its inputs, so a bug reproduces from the inputs alone — no need to recreate clock values, database state, or thread interleavings. You can capture the inputs that triggered a failure, replay them in a test, and get the exact same wrong answer every time. This is the basis of techniques like record-and-replay debugging and deterministic simulation testing: keep the core pure, log the inputs at the shell boundary, and any production failure becomes a deterministic unit test. Impure code, by contrast, can fail only "sometimes" depending on hidden state, which is the hardest kind of bug to chase.
</details>

**Q36. When would you deliberately choose impurity over a pure design?**

<details><summary>Answer</summary>

When the effect *is* the point or when purity costs too much for the benefit. Performance-critical inner loops where copying would dominate (in-place algorithms on big arrays); streaming/IO pipelines where buffering everything to stay pure is infeasible; interacting with inherently stateful resources (a connection pool, a hardware device) where pretending purity adds fiction, not safety. The discipline is to *encapsulate* the impurity (behind a clear boundary, ideally thread-safe and not leaking) rather than scatter it. Choose impurity consciously, contain it, and document it — don't let it leak into the decision logic.
</details>

---

## Professional / Deep — Substitution, Optimization, Trade-offs

> Formal substitution, purity-enabled compiler optimizations, and memoization economics.

**Q37. State the substitution model formally. What exactly does referential transparency let you do?**

<details><summary>Answer</summary>

Referential transparency means an expression `e` and its value `v` are interchangeable: for any program context `C[·]`, `C[e]` and `C[v]` have the same observable behavior. Equivalently, you can apply the **β-reduction / inlining** of a function definition and **substitution of equals for equals** without changing meaning. This is the formal foundation of equational reasoning: you treat `=` in your definitions as a real mathematical equality, so you can rewrite `let x = e in body` to `body[e/x]` (and back), commute independent subexpressions, and eliminate or duplicate pure subexpressions freely. The instant `e` has an effect, `C[e]` and `C[v]` diverge (the effect happens or doesn't), and the model breaks.
</details>

**Q38. Which compiler optimizations does purity (referential transparency) unlock?**

<details><summary>Answer</summary>

Several rely on RT to be *sound*: **common subexpression elimination** (compute `f(x)` once, reuse — valid only if `f` is pure); **loop-invariant code motion / hoisting** (lift a pure call out of a loop because it yields the same value each iteration); **dead-code elimination** (drop a pure call whose result is unused — illegal if it had a side effect); **constant folding** (evaluate `pure(2,3)` at compile time); **reordering / parallelization** (independent pure expressions can run in any order or concurrently); and **memoization / lazy evaluation** (compute at most once). Each is unsafe for impure code, because eliminating, reordering, or deduplicating a call would add, drop, or reorder its effects. Purity is what licenses the optimizer to treat code as values.
</details>

**Q39. Why can't a C compiler hoist a call to a function that does I/O out of a loop, but can hoist a pure one?**

<details><summary>Answer</summary>

Because hoisting changes *how many times* the call executes (once instead of N times). For a pure function that's invisible — the value is identical each iteration, so computing it once is observationally equivalent. For an I/O call, the number of executions *is* observable (N log lines vs one), so hoisting changes behavior and the optimizer must not do it. This is why languages like C use attributes such as `__attribute__((const))` / `pure` to *tell* the compiler a function is side-effect-free, unlocking these optimizations; without that promise the compiler conservatively assumes effects and leaves the call in place.
</details>

**Q40. Analyze the economics of memoization: when does it actually pay off?**

<details><summary>Answer</summary>

Memoization wins when `(hit_rate × cost_to_recompute)` exceeds `(cost_of_lookup + amortized_cost_of_storage)`. So it pays off for functions that are **expensive to compute**, called **repeatedly with the same inputs**, over an input space small enough to cache. It loses when inputs are mostly distinct (low hit rate, pure overhead and unbounded memory growth), when the computation is cheap (lookup costs more than recompute), or when the key (the arguments) is expensive to hash or compare. Other costs: cache memory (a potential leak without eviction), reduced locality, and — in concurrent code — synchronization on the cache. The deep point: memoization is a *space-and-complexity-for-time* trade, and an unbounded cache silently converts a time problem into a memory leak.
</details>

**Q41. Purity enables parallelization in theory — what breaks it in practice?**

<details><summary>Answer</summary>

In theory, independent pure expressions have no data dependencies, so they can run in parallel with no synchronization. In practice the wins are eroded by: **granularity** (if each pure task is tiny, scheduling/threading overhead dwarfs the work — see the cost of spawning vs. computing); **shared immutable inputs that aren't truly immutable** (a "pure" function handed an aliased mutable structure reintroduces races); **memory bandwidth and cache contention** (parallel copies thrash caches); and **false purity** where hidden state (a shared memo cache, a logger) sneaks in and serializes things. Purity removes the *correctness* barrier to parallelism but not the *performance* realities — you still need the right grain size and genuinely immutable data.
</details>

**Q42. How does lazy evaluation depend on purity, and what does it cost?**

<details><summary>Answer</summary>

Lazy evaluation defers a computation until its result is needed (and memoizes it), which is only safe when the computation is pure — if `f(x)` had a side effect, deferring or skipping it would change when/whether the effect happens. Purity is what lets the runtime treat an unevaluated expression (a "thunk") as interchangeable with its eventual value. The costs: **thunk overhead** (each deferred value is a heap object), **space leaks** (a chain of unforced thunks can retain memory unexpectedly — Haskell's infamous lazy `foldl` leak), and **unpredictable timing** of when work actually happens, which complicates performance reasoning. Laziness is the dual of strictness, traded off the same way purity trades reasoning-clarity for occasional performance surprises.
</details>

**Q43. Can the JIT/optimizer in the JVM or V8 exploit purity it isn't told about?**

<details><summary>Answer</summary>

Partly — through *escape analysis* and *inlining* the JIT can sometimes prove a small region has no observable effects and then eliminate or reorder it, even without an annotation. But it's conservative: any call it can't fully analyze (a virtual call, a method that might touch shared state, anything with a memory barrier) blocks the optimization, because correctness must hold even if the method has effects. So purity *helps* JIT optimization indirectly (pure methods inline and fold well, allocate less, devirtualize), but the runtime can't assume purity the way a Haskell compiler can — it must rediscover it locally and bail out at the first sign of possible effects. Writing pure, allocation-light methods is the practical way to feed the optimizer what it can use.
</details>

**Q44. Is `assert`/contract checking inside a function a side effect that breaks purity?**

<details><summary>Answer</summary>

Subtle. An assertion that *only* reads inputs and either passes (no effect) or aborts the program is debatable: in the passing case it's invisible, so the function is observationally pure; in the failing case it produces an effect (termination, a stack trace). Most practitioners treat assertions as a "benign" or "partial" effect — they don't violate the determinism of the *successful* path and are typically compiled out in production, so they don't undermine the substitution model for valid inputs. The honest framing: a *total* pure function never aborts; an assertion makes it *partial* (undefined on inputs that violate the precondition), which weakens but doesn't grossly break purity for the domain where it's defined.
</details>

**Q45. What's the difference between a pure function and a "total" function?**

<details><summary>Answer</summary>

Independent properties. **Purity** = deterministic + no side effects. **Totality** = defined for *every* input in its declared type (it always returns a value, never loops forever or throws/aborts). A function can be pure but *partial*: `func head(xs []int) int { return xs[0] }` is pure (no effects, deterministic) but undefined on the empty slice (it panics). A robust pure function is ideally also total — encode the partiality in the type (`head(xs) -> Optional<Int>`) so it returns a value for all inputs. Interviewers probing depth like this distinction because "pure" gets loosely used to also imply "total/safe," and the precise engineer separates the two.
</details>

---

## Code-Reading — Is This Function Pure?

> You're shown a snippet; decide whether it's pure and justify why or why not.

**Q46. Is this Go function pure?**

```go
func discount(price float64, pct float64) float64 {
    return price * (1 - pct/100)
}
```

<details><summary>Answer</summary>

**Pure.** Output depends only on `price` and `pct`, there's no mutation, no I/O, no global read, and the inputs are value types (copied, not aliased). `discount(100, 10)` is always `90` and can be substituted with `90` anywhere. This is the textbook pure function: a deterministic mapping with no observable effect.
</details>

**Q47. Is this Python function pure?**

```python
def add_item(cart, item):
    cart.append(item)
    return cart
```

<details><summary>Answer</summary>

**Impure.** It mutates the caller's `cart` list in place — an observable side effect on a shared mutable argument. Any other holder of that list sees the new item, and the call can't be substituted by its return value without losing the mutation. The pure version returns a new list: `return cart + [item]` (leaves `cart` untouched), at the cost of allocating a new list each call.
</details>

**Q48. Is this Java method pure?**

```java
int nextId() {
    return ++this.counter;
}
```

<details><summary>Answer</summary>

**Impure** on both clauses. It mutates instance state (`this.counter`), and it's non-deterministic from the caller's view — `nextId()` returns a different value each call for the "same input" (no input at all). It's the opposite of referentially transparent: you cannot replace `nextId()` with any fixed value. This is a classic stateful counter; to make it pure you'd thread the counter as an input/output: `(next, newCounter) = nextId(counter)`.
</details>

**Q49. Is this Go function pure?**

```go
func isWeekend() bool {
    d := time.Now().Weekday()
    return d == time.Saturday || d == time.Sunday
}
```

<details><summary>Answer</summary>

**Impure** — it reads the system clock, which is mutable external state, so it's non-deterministic: the same call returns different results on different days. It can't be substituted with a fixed value. There's no mutation or I/O, but failing the determinism clause is enough. Pure version: `func isWeekend(now time.Time) bool { ... }` — inject the time, and the shell calls `time.Now()`.
</details>

**Q50. Is this Python function pure?**

```python
def stats(nums):
    total = 0
    for n in nums:
        total += n
    return total / len(nums)
```

<details><summary>Answer</summary>

**Pure** (with a totality caveat). `total` is a *local* mutable variable — its mutation is not observable outside the function, so it does not break purity (this is the "mutable local is fine if not observable" rule). The result depends only on `nums`, with no I/O or external mutation, and `nums` is only read. The caveat: it's *partial* — it raises `ZeroDivisionError` on an empty list, so it isn't total. Pure but not total; a fully robust version would handle the empty case.
</details>

**Q51. Is this Java method pure?**

```java
List<Integer> evens(List<Integer> xs) {
    return xs.stream().filter(x -> x % 2 == 0).collect(toList());
}
```

<details><summary>Answer</summary>

**Pure.** The stream pipeline reads `xs` without mutating it and returns a brand-new list; same input always yields an equal output, and nothing external changes. The lambda `x -> x % 2 == 0` is itself pure. (The one thing to watch in real code is that the input list isn't concurrently mutated by someone else and that the lambda doesn't capture/mutate external state — neither happens here.) This is idiomatic functional-style Java and is referentially transparent.
</details>

**Q52. Is this Go function pure?**

```go
var cache = map[int]int{}
func square(n int) int {
    if v, ok := cache[n]; ok { return v }
    v := n * n
    cache[n] = v
    return v
}
```

<details><summary>Answer</summary>

**Observationally pure but unsafe.** From the outside, `square(n)` always returns `n*n` with no externally visible effect — the cache is internal memoization (the Q26 pattern), so it's referentially transparent *for its return value*. The problem is the package-level `cache` map is mutated without synchronization, so concurrent calls race — the hidden mutation becomes an observable effect (a crash or torn read). Verdict: pure in single-threaded semantics, but the unsynchronized shared mutable map makes it unsafe and arguably impure under concurrency. Fix: guard the map with a mutex or use `sync.Map`.
</details>

**Q53. Is this Python function pure?**

```python
def greet(name, log=print):
    msg = f"Hello, {name}"
    log(msg)
    return msg
```

<details><summary>Answer</summary>

**Impure** as written — it calls `log` (defaulting to `print`), which performs I/O, an observable side effect. Injecting `log` makes the effect *configurable* (you can pass a no-op in tests) but doesn't make the function pure; the effect still happens by default. The pure part is `f"Hello, {name}"` — extract that as `def greeting(name): return f"Hello, {name}"` and let the caller decide whether to log. Dependency injection of an effect controls/relocates it; it doesn't eliminate it.
</details>

---

## Curveballs

> The questions designed to catch glib answers.

**Q54. Is a function that reads the system clock pure?**

<details><summary>Answer</summary>

**No.** The clock is mutable external state, so the function is non-deterministic — the same call returns different values over time and cannot be replaced by any fixed value (it fails referential transparency). It might not mutate anything or do "I/O" in the file sense, but reading a changing external source already breaks the determinism clause, which is enough. The pure approach is to inject the current time as a parameter so the function depends only on its arguments.
</details>

**Q55. Is logging a side effect?**

<details><summary>Answer</summary>

**Yes.** Logging writes to a file, stdout, or a logging service — an observable interaction with the outside world. A function that logs cannot be freely deduplicated, reordered, or skipped without changing the observable log output, which is precisely what an effect is. People sometimes call it a "benign" effect because it usually doesn't affect program results, but it is still an effect: it breaks referential transparency and complicates reasoning (and, e.g., a compiler may not hoist a logging call out of a loop). Keep logging in the shell, not the pure core.
</details>

**Q56. Can a pure function use a mutable local variable?**

<details><summary>Answer</summary>

**Yes.** Purity is about *observable* behavior, not internal mechanism. A local variable, loop counter, or accumulator that never escapes the function is invisible to the outside world, so mutating it doesn't break determinism or introduce a side effect (Q50 is the canonical example). Functional purists may *prefer* recursion or folds, but an imperative loop building up a local result is perfectly pure as long as nothing leaks. The rule: mutate freely *inside*, expose nothing mutable *outside*.
</details>

**Q57. Referential transparency vs. idempotency — what's the difference?**

<details><summary>Answer</summary>

**Referential transparency** is about substitution: a call can be replaced by its value, which requires the function to be pure (no effects). **Idempotency** is about repetition: doing the operation twice has the same *effect* as doing it once (`f(f(x)) == f(x)` for transforms, or "the second call leaves the world in the same state" for effects). They're orthogonal: a pure function can be non-idempotent (`x+1`), and an *effectful* operation can be idempotent (`PUT` to the same resource, `DELETE` of a specific row). RT says "no effects at all"; idempotency says "effects that don't compound." Conflating them is a classic mistake.
</details>

**Q58. Is `Math.random()` referentially transparent? It does no I/O.**

<details><summary>Answer</summary>

**No.** It does no file/network I/O, but it reads and advances a hidden internal PRNG state, so it's non-deterministic — successive calls return different values and none can be replaced by a fixed value. Both the non-determinism and the hidden state mutation defeat referential transparency. "No I/O" is not the test; the tests are "same input → same output" and "no observable effect." A pure random number generator instead takes a seed/state and returns the value *and* the next state, threading the state explicitly.
</details>

**Q59. Two calls `f(x)` in a row return the same value — does that prove `f` is pure?**

<details><summary>Answer</summary>

**No.** Observing equal outputs twice is weak evidence, not proof. `f` could read a cache that happens not to have changed yet, could have side effects you didn't observe (it logged, incremented a counter, sent a metric), or could be deterministic *now* but depend on state that changes later (config, clock, DB). Purity is a property of *all* possible executions and *all* observable effects, which you can't establish by sampling outputs. You prove purity by reading the implementation (and its transitive calls), not by running it twice.
</details>

**Q60. If a pure function is slow, is calling it twice "free" to reason about but wasteful — and what does that imply?**

<details><summary>Answer</summary>

It implies you can *optimize freely*. Because the call is referentially transparent, calling `f(x)` twice is semantically identical to calling it once and reusing the result — so the compiler (CSE) or you (a local variable, or memoization) may safely eliminate the duplicate with zero risk of changing behavior. That's the whole point of purity for performance: the optimizer is *allowed* to dedupe, hoist, or cache pure work precisely because there are no effects to preserve. For an impure function none of that is safe. Slow-but-pure is a problem you can attack; slow-and-impure ties the optimizer's hands.
</details>

**Q61. Is throwing an exception a side effect?**

<details><summary>Answer</summary>

Mostly **yes** — it's non-local control flow that the caller observes and must handle, so it breaks the clean "input → value" mapping and makes the function *partial* (undefined for inputs that throw). Some treat a thrown exception as merely making a function partial rather than "effectful," but practically it complicates substitution: `f(bad)` can't be replaced by any value. The functional alternative is to return failure as a value (`Result`/`Either`/`Optional`/`(T, error)`), which keeps the function total and referentially transparent and puts the error in the signature.
</details>

---

## Rapid-Fire / One-Liners

> Crisp answers; what an interviewer wants in one or two sentences.

**Q62. The two-clause definition of a pure function?**

<details><summary>Answer</summary>

Same inputs always produce the same output (deterministic), and it has no observable side effects (changes nothing outside itself).
</details>

**Q63. One-line definition of referential transparency?**

<details><summary>Answer</summary>

You can replace any call with its result value anywhere, without changing the program's behavior.
</details>

**Q64. Pure or impure: a function that only reads a `final`/`const` value?**

<details><summary>Answer</summary>

Pure — reading immutable state preserves determinism; only *mutable* external reads break purity.
</details>

**Q65. Pure or impure: writing to a database?**

<details><summary>Answer</summary>

Impure — it's I/O, an observable side effect; keep it in the shell.
</details>

**Q66. Fastest test for a side effect?**

<details><summary>Answer</summary>

"If I deleted this call, would anything outside the function change?" If yes (beyond the returned value), it's a side effect.
</details>

**Q67. One reason purity makes concurrency safe?**

<details><summary>Answer</summary>

No shared mutable state means no data races — pure functions are thread-safe by construction.
</details>

**Q68. Why is memoization only valid for pure functions?**

<details><summary>Answer</summary>

A cached result must be indistinguishable from a fresh call — true only when same input gives same output with no skipped effects.
</details>

**Q69. The functional-core/imperative-shell rule in one line?**

<details><summary>Answer</summary>

Decisions are pure and central; effects are impure and pushed to the thin edge.
</details>

**Q70. Does mainstream Go/Java/Python enforce purity?**

<details><summary>Answer</summary>

No — purity is a convention upheld by discipline, naming, and review; only languages like Haskell enforce it in the type system.
</details>

---

## How to Talk About Purity in Interviews

A few habits separate a strong answer from a textbook recital:

- **Lead with the two clauses, then the payoff.** Define purity precisely (deterministic + no observable effects), then immediately connect it to *why we care* — testability, concurrency safety, cacheability, equational reasoning. The definition alone reads junior; the consequences read senior.
- **Distinguish observable from internal.** The mark of depth is knowing a pure function *can* use mutable locals and even internal memoization — purity is about what the *outside* sees, not the mechanism. This catches the "mutable variable = impure" juniorism.
- **Never claim "make everything pure."** Effects are the program's purpose. The mature framing is *pure core, impure shell*: isolate effects, don't eliminate them. Naming the trade-off (allocation cost, signature bloat, language ceremony) is the senior signal.
- **Keep RT and idempotency separate.** They get conflated constantly; cleanly distinguishing "substitutable by its value" from "repeating doesn't compound the effect" instantly marks precision.
- **Go deep on optimization when invited.** CSE, hoisting, dead-code elimination, parallelization, and lazy evaluation are all *licensed by* referential transparency — and unsafe without it. Mentioning that the compiler can't hoist an I/O call but can hoist a pure one shows you understand *why* purity matters to the toolchain.
- **Use a concrete refactor.** "Here's an impure function reading the clock and writing the DB; here's how I'd inject the time and split the decision into a pure core" lands far harder than a definition.
- **Acknowledge enforcement reality.** In Go/Java/Python purity is a discipline, not a guarantee — say so, and mention how you'd hold the line (package boundaries, immutability helpers like `frozen` dataclasses / records, review checklists).

---

## Summary

- A **pure function** satisfies two independent clauses: **determinism** (same inputs → same output) and **no observable side effects**. **Referential transparency** is the resulting property that any pure call can be substituted by its value — the basis of equational reasoning.
- The junior bar is the definition plus recognizing side effects (I/O, mutation, clock/global reads); the middle bar is *making code pure* via the **functional core / imperative shell**, parameterizing effects (clock, RNG, IDs), memoization, and testing without mocks; the senior bar is *architecting around purity* — concurrency safety, idempotency vs. RT, and the limits of language enforcement; the professional bar is the **substitution model**, the **compiler optimizations purity unlocks** (CSE, hoisting, DCE, parallelization, laziness), and the **economics of memoization**.
- Purity is about *observable* behavior: a pure function may use mutable locals and internal caches as long as nothing leaks. The goal is never zero effects — effects are the point — but a large pure core and a thin, auditable impure shell.
- The sharpest curveballs hinge on the same precision: the clock and `Math.random()` are *not* pure (hidden mutable/PRNG state), logging *is* a side effect, a mutable local is *fine*, and referential transparency (no effects) is *not* idempotency (non-compounding effects).

---

## Related Topics

- [`junior.md`](junior.md) — define purity and side effects, recognize them in code.
- [`middle.md`](middle.md) — functional core / imperative shell, making code pure, memoization.
- [`senior.md`](senior.md) — architecting around purity, concurrency, idempotency, enforcement.
- [`professional.md`](professional.md) — substitution model, compiler optimizations, trade-offs.
- [First-Class & Higher-Order Functions](../01-first-class-and-higher-order-functions/junior.md) — the functions purity composes from.
- [Immutability](../03-immutability/junior.md) — immutable data is what keeps pure-function inputs trustworthy.
- [Composition](../05-composition/junior.md) — pure functions compose into pipelines without surprises.
- [Effect Tracking](../10-effect-tracking/junior.md) — pushing the impure shell to the edge, the `IO` idea.
- [Clean Code → Pure Functions](../../clean-code/15-pure-functions/README.md) — the everyday-code view of writing pure functions.
- [Concurrency](../../../language-internals/concurrency-async-parallel/concurrency/README.md) — why no shared mutable state is the safest concurrency.
