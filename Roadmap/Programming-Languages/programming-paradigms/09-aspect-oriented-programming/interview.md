# Aspect-Oriented Programming — Interview Q&A

> **Roadmap:** [Programming Paradigms](../README.md) → Aspect-Oriented Programming
>
> *AOP factors **cross-cutting concerns** — logging, security, transactions, caching, metrics — out of the methods they'd otherwise clutter, into **aspects** that run **advice** at **join points** selected by **pointcuts**, and a **weaver** stitches them back in (compile-time, load-time, or via a runtime proxy). The whole field is a trade: you gain one home per concern, you pay in behavior that runs with no visible call site.*

A bank of 40+ interview questions spanning definitions, mechanics, framework reality, trade-offs, and code-reading. Each answer models the reasoning a strong candidate gives — including the limits and the runtime truth underneath. Use the `<details>` toggles to self-quiz: read the question, answer out loud, then expand.

Examples are in **Java** (Spring AOP / AspectJ, the canonical stack), **Python** (decorators), and **Go** (middleware).

---

## Table of Contents

1. [Fundamentals / Junior](#fundamentals--junior)
2. [Vocabulary & Mechanics / Middle](#vocabulary--mechanics--middle)
3. [Senior — Trade-offs, Proxies, Judgment](#senior--trade-offs-proxies-judgment)
4. [Staff — Framework Reality & Paradigm Placement](#staff--framework-reality--paradigm-placement)
5. [Code-Reading — What Runs / What Doesn't](#code-reading--what-runs--what-doesnt)
6. [Curveballs](#curveballs)
7. [Rapid-Fire / One-Liners](#rapid-fire--one-liners)
8. [How to Talk About AOP in Interviews](#how-to-talk-about-aop-in-interviews)
9. [Summary](#summary)
10. [Related Topics](#related-topics)

---

## Fundamentals / Junior

> Definitions and the "why does this exist" reasoning.

**Q1. What problem does AOP solve?**

<details><summary>Answer</summary>

The **scattering and tangling** of cross-cutting concerns. Concerns like logging, security, timing, transactions, and caching are needed in *many* unrelated methods. Putting them inside each method causes two problems: **scattering** (one concern smeared across 50 methods — change the log format, edit all 50) and **tangling** (one method mixing four concerns with its actual work, drowning the real logic in boilerplate). AOP lets you write each concern *once*, as an aspect, and apply it to all the methods that need it — so each method shrinks back to just its core logic.
</details>

**Q2. Define "cross-cutting concern" and give three examples that aren't logging.**

<details><summary>Answer</summary>

A cross-cutting concern is a requirement that's needed across *many* modules that are otherwise unrelated — it "cuts across" the normal decomposition of the system, so it can't be cleanly captured in one class or function in the usual structure. Beyond logging: **transactions** (begin/commit/rollback around service methods), **authorization** (check the caller's permission before the method), **caching** (check-or-compute around a method), **metrics/tracing** (time and record every call), and **retry** (re-run a flaky call). The tell is that the concern shows up *everywhere* and is *the same* everywhere.
</details>

**Q3. Scattering vs tangling — state the difference precisely.**

<details><summary>Answer</summary>

They're two views of the same mess. **Scattering** is about *one concern across the codebase*: the logging code is spread across every method, with no single home. **Tangling** is about *one method up close*: a single method's body mixes several concerns (logging + timing + security + transaction) with its real work. Scattering is the horizontal view (concern → many methods); tangling is the vertical view (method → many concerns). Both come from putting cross-cutting code *inside* core methods, and AOP fixes both at once by pulling the concern out.
</details>

**Q4. What's the simplest way to experience AOP without a framework?**

<details><summary>Answer</summary>

A **Python decorator** (or a JavaScript/Go higher-order function that wraps a function). A decorator takes a function and returns a wrapped version that adds behavior — `@timed` wraps the function so it's timed without a single timing line inside it. That's an aspect you can still *see*: the concern (timing) lives in one reusable decorator, and `@timed` applies it. Full AOP frameworks do the same thing but can apply the wrapper to *many* methods via a pattern (pointcut), and can do it with nothing visible at the call site.
</details>

**Q5. What are the three basic kinds of advice, intuitively?**

<details><summary>Answer</summary>

**Before** (run code before the method — a security check, an "entering" log), **after** (run code after it returns — cleanup, a "leaving" log), and **around** (wrap the whole call — run code, then *decide whether and when* to call the real method, then run more code). Around is the powerful one: timing needs it (start clock → call → stop clock), caching needs it (check cache → maybe *skip* the call), and transactions need it (begin → call → commit or rollback). Before/after can only observe; around can intercept and replace.
</details>

**Q6. Is AOP a Java-only thing?**

<details><summary>Answer</summary>

No — AOP is a *paradigm*, expressed differently per ecosystem. Java/Spring/AspectJ is the canonical heavy implementation, but the *idea* — separate a cross-cutting concern and apply it from outside — appears as **Python decorators** and class decorators, **Go middleware** (`func(next Handler) Handler`), **Node/Express middleware**, and **JS higher-order functions**. The word "aspect" is JVM culture; the concept is universal. Recognizing middleware *as* AOP is a sign you understand the paradigm, not just one framework.
</details>

---

## Vocabulary & Mechanics / Middle

> The five terms, weaving, and how a proxy works.

**Q7. Define join point, pointcut, advice, aspect, and weaving.**

<details><summary>Answer</summary>

- **Join point** — a *point in execution* where an aspect could run (in Spring AOP, always a method call; AspectJ adds field access, constructors, etc.).
- **Pointcut** — a *predicate* that selects a **set** of join points by pattern (`execution(* service.*.*(..))`). The "where."
- **Advice** — the *code* that runs at matched join points, and *when* (before/after/around). The "what + when."
- **Aspect** — a *module* bundling pointcuts with their advice — one concern in one place.
- **Weaving** — the *process* of inserting the advice at the matched join points.

One sentence: *an aspect says "at the join points my pointcut matches, run this advice," and weaving makes it happen.*
</details>

**Q8. Join point vs pointcut — people confuse these. Be precise.**

<details><summary>Answer</summary>

A **join point** is a *single* spot in execution — one specific method call. A **pointcut** is the *pattern* that selects a *set* of join points — it's a query, not a place. "The pointcut matches these three join points." Mixing them up ("the pointcut" when you mean the call site) is an instant tell. The pointcut is the predicate; each thing it matches is a join point.
</details>

**Q9. What are the five advice types in Spring/AspectJ?**

<details><summary>Answer</summary>

**Before**, **after-returning** (only on normal return, can read the result), **after-throwing** (only if it threw, gets the exception), **after / finally** (however it ended), and **around** (wraps the call, receives a `ProceedingJoinPoint`). "After" splits three ways by *how* the method ended. Around is unique: it alone gets `proceed()` and decides whether/when/with-what-args to call the real method — which is why caching (skip `proceed()` on a hit), transactions, and retry are all around.
</details>

**Q10. What's special about around advice?**

<details><summary>Answer</summary>

It *is* the call. Only around advice receives a `ProceedingJoinPoint` and must explicitly invoke `proceed()` to run the real method — and it can choose **not** to (caching on a hit), call it **multiple times** (retry), change its **arguments**, or transform its **return value**. Before/after advice can only observe around the method; around can intercept and replace it. The flip side: it's the most error-prone — forget `proceed()` and you've silently disabled the method.
</details>

**Q11. What is a pointcut expression? Show one and read it.**

<details><summary>Answer</summary>

A tiny query language for selecting join points. The workhorse is `execution`:

```java
execution(public * com.bank.service.*.*(..))
```

Read right-to-left-ish: any **public** method, **any** return type (`*`), in **any class** of `com.bank.service`, with **any name** and **any arguments** (`(..)`). Other designators: `@annotation(Audited)` (methods marked `@Audited`), `within(pkg..*)` (anything in a package tree), `args(String, ..)` (first arg a String), `bean(*Service)`. They compose with `&&`, `||`, `!`. The `@annotation(...)` form is the bridge to modern annotation-driven AOP.
</details>

**Q12. What are the three weaving times, and how do they differ?**

<details><summary>Answer</summary>

- **Compile-time** — a special compiler (AspectJ's `ajc`) bakes advice into the `.class` files at build. Fastest at runtime, can weave *anything* (private, final, field access), needs the special compiler.
- **Load-time (LTW)** — a JVM agent (`-javaagent`) rewrites bytecode as each class loads. Same power as compile-time, no special compiler, but costs startup time.
- **Runtime (proxy)** — a proxy object wraps the bean and intercepts calls. This is **Spring AOP**. No agent/compiler, but limited (method calls on managed beans only, no self-invocation, no `final`/`private`).

The first two edit real bytecode (AspectJ); the third wraps the object (Spring AOP). Most limitations trace to which one you use.
</details>

**Q13. How does a runtime proxy actually intercept a call?**

<details><summary>Answer</summary>

When Spring sees a bean is an aspect target, it hands callers a **proxy** instead of the real object. The proxy implements the same interface (**JDK dynamic proxy**) or subclasses the class (**CGLIB**) and holds a reference to the real bean. On a call, the proxy runs the advice (before → `try` real method → after-returning / catch after-throwing / finally after) and delegates the actual work to the real object. CGLIB works by *overriding* methods in a generated subclass — which is exactly why proxied methods can't be `final` (can't override) and why an internal `this.method()` call (which doesn't go through the proxy) skips advice.
</details>

**Q14. Spring AOP vs AspectJ — when do you use each?**

<details><summary>Answer</summary>

**Spring AOP** is proxy-based, runtime, method-execution-only, on Spring beans — but it needs *zero* build changes and covers the 95% case (transactions, caching, security on service methods). Use it by default. **AspectJ** is bytecode weaving (compile- or load-time), can advise *anything* (constructors, field access, `final`/`private`, self-invocation, non-Spring and even JDK classes), and has no proxy indirection — but needs a special compiler or a Java agent. Reach for AspectJ only when you hit a proxy wall: you must advise self-invocations, `final` methods, field access, or classes Spring doesn't manage. Spring even supports AspectJ load-time weaving as a hybrid (`@EnableLoadTimeWeaving`).
</details>

**Q15. How is the same idea expressed in Go?**

<details><summary>Answer</summary>

As **middleware** — higher-order functions over handlers: `func(next Handler) Handler` returns a wrapped handler. The wrapper runs code, calls `next()` (the `proceed()` equivalent), then runs more code — exactly around advice. You compose them explicitly: `Logging(Auth(Metrics(handler)))`. The key difference from Spring AOP: there's **no pointcut** — the chain is *listed* at the wiring site, so you can read every cross-cutting concern in one place. Go's culture deliberately prefers this *visible* wrapping over invisible weaving.
</details>

---

## Senior — Trade-offs, Proxies, Judgment

> The double-edged nature, the limits, and when to use it.

**Q16. What's the fundamental trade-off AOP makes?**

<details><summary>Answer</summary>

It trades **locality of the concern** (the win) for **locality of reasoning** (the cost). The win: a concern scattered across 80 methods now lives in one cohesive aspect — change it in one place. The cost: you can no longer fully understand a method by *reading* the method, because behavior (a transaction, a cache lookup that may skip the body, an auth gate that may throw) runs with **no visible call site**. That's "action at a distance." The trade is worth it only when the concern is so universal and uniform that readers *assume* it's there anyway; it's a disaster for surprising or business-critical behavior.
</details>

**Q17. What is "spooky action at a distance" in AOP, and why does it matter?**

<details><summary>Answer</summary>

It's the property that an aspect changes a method's behavior without any reference to the aspect appearing at or near the method — especially when the pointcut lives in a distant file. You read `transfer()`, see two lines, and have *no breadcrumb* that a transaction opened, security ran, and the result was cached. It matters because **local reasoning** ("I can understand this method by reading it") is the single most valuable property for maintainability, and AOP breaks it. The mitigation is annotation-driven pointcuts (`@Transactional` *on* the method) so the trigger travels with the code.
</details>

**Q18. Explain the self-invocation gotcha.**

<details><summary>Answer</summary>

In proxy-based AOP (Spring), advice only runs on calls that pass *through the proxy* — i.e., external calls. If a method calls another method on the *same* object via `this.other()`, that call goes straight to the real object, **bypassing the proxy**, so any aspect on `other()` (including `@Transactional`, `@Cacheable`, `@Async`) silently doesn't run. The code looks correct and compiles; it just doesn't do the thing. Fixes: extract the method into a separate bean (the call now crosses the proxy boundary), inject the bean into itself and call through that reference, or switch to AspectJ (no proxy). Often the real fix is the refactor — needing self-invocation advice hints two responsibilities should be two classes.
</details>

**Q19. What can't Spring AOP advise, and why?**

<details><summary>Answer</summary>

Because it's proxy-based: (1) **self-invocations** — internal `this.x()` calls bypass the proxy; (2) **`final` methods** — CGLIB can't override them; (3) **`private`/`static` methods** — not overridable; (4) **objects not managed by Spring** — a `new Service()` is the raw class, unproxied; (5) **constructor logic** — the proxy wraps method *calls*, not construction. All five dissolve under AspectJ bytecode weaving, because it edits the method itself — there's no proxy and no "through the proxy" requirement.
</details>

**Q20. Why does aspect ordering matter? Give a correctness example.**

<details><summary>Answer</summary>

When multiple aspects match one join point, the order they wrap in changes *behavior*, not just style. Example: **security must run before the transaction**, or you open a DB transaction (and maybe do work) before discovering the caller wasn't allowed. **Caching should be outside the transaction**, or you open and commit an empty transaction on every cache hit. **Retry** outside vs inside a transaction changes whether each attempt is a fresh transaction. Spring orders aspects with `@Order`, but the correct order depends on the *semantics* of every co-applying aspect — a global, non-obvious property. With N aspects, the join point's behavior is emergent, which is a real hazard.
</details>

**Q21. What does AOP cost in performance?**

<details><summary>Answer</summary>

It depends on weaving. **Proxy (Spring AOP):** one extra indirection per advised call — virtual dispatch + interceptor chain walk + (for around) a `ProceedingJoinPoint` allocation. Negligible for coarse, I/O-bound service methods; real only if you advise *fine-grained hot* methods. **Bytecode (AspectJ):** advice is inlined — near-zero per-call cost, but the cost moves to **build/startup** (compile-time slows the build; load-time slows JVM startup). **Proxy startup:** Spring matches pointcuts against every bean method and generates CGLIB subclasses at context start — a contributor to slow startup. The thing that actually bites is **pointcut breadth** (advising hundreds of thousands of trivial calls), not per-call overhead on the right methods.
</details>

**Q22. How does AOP affect testability — both ways?**

<details><summary>Answer</summary>

**Helps:** because the concern is separated, you can unit-test the core logic with the aspect *absent* (call the raw object) and unit-test the aspect in isolation. **Hurts:** aspect behavior (transaction rollback, cache semantics, `@PreAuthorize` denial) only exists *through the proxy*, so it needs integration tests with the wired context — and the self-invocation bug is *invisible* in unit tests of the raw object (no proxy distinction to expose it) but real in production. The rule: test pure logic as a fast unit test of the raw object; test aspect behavior where it's *woven*, through the proxy.
</details>

**Q23. Why did AOP "fall out of fashion" as a general-purpose tool?**

<details><summary>Answer</summary>

The "aspectize everything" vision (circa 2003) overreached and collapsed for concrete reasons: (1) **loss of local reasoning** — pervasive aspects made methods un-understandable in isolation; (2) the **fragile-pointcut problem** — pointcuts couple to code by *pattern*, so renaming a package silently breaks matching with no compiler error; (3) **aspect interaction** — N aspects at one join point create emergent, order-dependent behavior; (4) **better-targeted tools won** — DI for wiring, middleware for pipelines (visible), decorators for per-object wrapping. The compromise that survived: keep AOP's machinery but expose it via **annotations on the method**, so the trigger is local. *AOP didn't fail — its overreach did.*
</details>

**Q24. Where does AOP genuinely thrive today?**

<details><summary>Answer</summary>

In concerns that are **universal** (apply to ~every method in a layer), **uniform** (same behavior everywhere), **orthogonal** (don't change the method's meaning), and **expected** (readers assume them): **declarative transactions** (`@Transactional`), **method security** (`@PreAuthorize`), **caching** (`@Cacheable`), **metrics/tracing**, and **retry/circuit-breaking**. All survived the AOP winter and are now exposed as single annotations that hide the AOP entirely. That profile — universal, uniform, orthogonal, expected — *is* AOP's permanent home.
</details>

**Q25. Give a decision test for "should this be an aspect?"**

<details><summary>Answer</summary>

Ask: *"If a new engineer read this method cold, not knowing the aspect existed, would they be **misled** about what it does?"* For `@Transactional` on a service method — no, they'd assume it; safe to aspectize. For an aspect that *silently changes the return value* or *conditionally skips business logic* — yes, badly; that behavior must be visible in the method. Score the concern on universality, uniformity, orthogonality, expectedness, and trigger visibility (annotation-on-method good; distant pointcut bad). The more it "clarifies" vs "hides," the safer the aspect.
</details>

---

## Staff — Framework Reality & Paradigm Placement

> Annotations as aspects, the modern stack, and relating AOP to its neighbors.

**Q26. Why is `@Transactional` an example of AOP?**

<details><summary>Answer</summary>

Because it *is* an aspect, packaged as an annotation. The pointcut is `@annotation(Transactional)`; the advice is Spring's `TransactionInterceptor` (around advice): it starts/joins a transaction before, calls `proceed()`, commits on normal return, rolls back on a runtime exception. Spring weaves it with a proxy. Every consequence follows from this: `@Transactional` on a self-invoked method silently doesn't transact (proxy bypass), on a `final` method it's inert (can't override), and it commits on *checked* exceptions by default (a rollback rule, not magic). "It's an around aspect woven by a proxy" explains both its power and all its gotchas.
</details>

**Q27. Name other Spring annotations that are aspects under the hood.**

<details><summary>Answer</summary>

`@Cacheable`/`@CacheEvict` (cache check/store, around), `@Async` (submit to an executor and return immediately, around — replaces the call), `@Retryable` (loop `proceed()` with backoff), `@PreAuthorize`/`@Secured` (authorization check, before), Micrometer's `@Timed`/`@Counted` (timer/counter, around), and method-level `@Validated` (argument/return validation). Each is a `@annotation(...)` pointcut + an interceptor, woven by the same proxy — so **all** inherit the proxy limits (self-invocation, `final`, beans-only). One mental model covers the whole family.
</details>

**Q28. How do observability/APM agents use AOP?**

<details><summary>Answer</summary>

They use **load-time bytecode weaving**. You launch the JVM with `-javaagent:agent.jar` (Datadog, New Relic, OpenTelemetry's Java agent); the agent registers a `ClassFileTransformer` that rewrites each class's bytecode as it loads, inserting span/timing code around method entries and known integration points (JDBC `executeQuery`, HTTP clients, Kafka). The result: every query and outbound call is traced with **zero code changes** — including third-party and JDBC internals no proxy could reach. This is AOP delivering its original promise. Costs: measurable latency/allocation (mitigated by selective weaving + sampling), slower startup, and version-coupling hazards (an agent patches bytecode against framework assumptions).
</details>

**Q29. How are middleware/filters/interceptors related to AOP?**

<details><summary>Answer</summary>

They're AOP's mainstream descendant — the same around-advice idea over the request pipeline, but **explicit**: a chain of wrappers (servlet `Filter`, Spring `HandlerInterceptor`, Express `app.use`, Go `func(next)Handler`, gRPC interceptors), each handling a cross-cutting concern. The crucial difference: **the pointcut is replaced by an explicit list** you write at the wiring site, so you can read the whole pipeline in one place and know every concern that touches a request, in order. That restores the local reasoning general AOP sacrificed while keeping the separation of concerns — which is *why* middleware dominates for request-shaped concerns and explicit aspects are rare there.
</details>

**Q30. AOP vs the Decorator pattern — same or different?**

<details><summary>Answer</summary>

Same core idea ("wrap to add behavior"), different scope and visibility. A **decorator** wraps **one object** at a time, chosen explicitly (`new BufferedReader(reader)`), with the same interface — you can *see* the wrapping and pick which instance. An **aspect** applies to **many methods across many classes**, selected by a pointcut, often with *no* visible trigger. AOP generalizes the decorator: "decorate every join point matching this pattern, automatically." Decorator trades reach for visibility; AOP trades visibility for reach. They're points on one spectrum of "wrap to add cross-cutting behavior."
</details>

**Q31. AOP vs middleware vs decorator — unify them.**

<details><summary>Answer</summary>

They're **one idea at three scopes**: "wrap to add cross-cutting behavior," applied to (a) **all matching methods** (aspect), (b) **one object** (decorator), or (c) **one request** (middleware). The axis that really distinguishes them is **trigger visibility**: an aspect's trigger is a pointcut (often invisible); a decorator's and middleware's triggers are explicit (`new Decorator(x)`, an explicit chain). AOP is the most powerful and least visible; decorator and middleware trade reach for visibility. Knowing they're the same idea lets you carry the vocabulary (advice, around, ordering) across Java, Go, Node, and Python.
</details>

**Q32. How does AOP relate to dependency injection?**

<details><summary>Answer</summary>

They're **complementary**, and AOP often rides *on* DI. In Spring, AOP works by proxying the beans the **DI container** manages — the container is what hands callers the proxy instead of the raw object. They're frequently confused because both add behavior "from outside," but DI is about *supplying a component's dependencies* (wiring), while AOP is about *weaving cross-cutting concerns* (behavior). Historically, "aspectize everything" included using aspects for wiring; DI containers did that job better and *visibly*, which is part of why general AOP receded — but DI and AOP coexist: DI is the substrate, AOP is a service built on it.
</details>

**Q33. Walk through `@Transactional`'s rollback rules — what's the trap?**

<details><summary>Answer</summary>

By default, Spring's transaction advice rolls back **only on `RuntimeException` and `Error`** — **checked exceptions commit.** So if you throw a checked `PaymentException` expecting a rollback, the transaction *commits* and half-done work persists — a silent data-integrity bug. Fixes: set `@Transactional(rollbackFor = PaymentException.class)`, or throw a runtime exception. The deeper trap is that the rollback boundary is *invisible at the call site*, so you can't see this rule while reading the method — you have to *know* it. Other traps in the same family: self-invocation (no tx at all), wrong `propagation`, and long transactions pinning a connection across a slow call.
</details>

**Q34. When would you hand-write a custom aspect today, given annotations exist?**

<details><summary>Answer</summary>

Rarely — only when **all** hold: the concern is genuinely cross-cutting, uniform, and orthogonal; **no existing annotation/middleware fits** (you're not reinventing `@Transactional` or a logging filter); you can **trigger it by annotation** (`@annotation(MyMarker)`) so the trigger is visible on the method; and you accept the proxy limits (or adopt AspectJ for reach). The 95% case is "use the framework annotation; for request-shaped concerns write visible middleware; drop to a custom `@Aspect` only for a bespoke uniform concern with no off-the-shelf equivalent — and even then, key it off an annotation."
</details>

**Q35. Is AOP a separate paradigm or a technique layered on others?**

<details><summary>Answer</summary>

Both, depending on framing. It's classified as a *paradigm* because it offers a distinct unit of modularity — the **aspect** — for a kind of concern (cross-cutting) that objects and functions decompose poorly; that's a genuine new way to structure code. But unlike OOP or FP, it doesn't replace the base style: AOP is *layered on top of* an imperative/OO program — you still write classes and methods, and aspects modularize what cuts across them. The honest framing: AOP is a **complementary** modularity mechanism (Kiczales' framing) rather than a standalone way to build a whole program, which is part of why it lives as a *feature* (annotations, weavers) inside OO frameworks rather than as its own language family.
</details>

---

## Code-Reading — What Runs / What Doesn't

> You're shown a snippet; say what runs, what's silently skipped, and why.

**Q36. Spring — does the inner call get a new transaction?**

```java
@Service
class OrderService {
    public void run(Order o) {
        process(o);
        this.audit(o);          // <-- internal call
    }
    @Transactional(propagation = REQUIRES_NEW)
    public void audit(Order o) { ... }
}
```

<details><summary>Answer</summary>

**No.** `this.audit(o)` is a self-invocation — it goes straight to the real object, **bypassing the proxy**, so `audit`'s `@Transactional` never engages and no new transaction is opened. The code compiles and looks correct; it silently does the wrong thing. Fixes: move `audit` to a separate bean, inject `OrderService` into itself and call `self.audit(o)`, or use AspectJ weaving. The right fix is usually extracting `audit` — needing self-invocation advice often signals a missing class boundary.
</details>

**Q37. Spring — why doesn't the aspect fire?**

```java
@Service
class ReportService {
    @Cacheable("reports")
    public final Report build(Long id) { ... }   // note: final
}
```

<details><summary>Answer</summary>

The `final` keyword. Spring's CGLIB proxy works by generating a **subclass** that overrides `build` to add the caching advice — but you can't override a `final` method, so the proxy can't intercept it, and `@Cacheable` is **silently skipped** (no error, no caching). Remove `final`, or use AspectJ (which weaves the method itself, no override needed). Same class of bug applies to `private` and `static` methods.
</details>

**Q38. Python — what does this print, and what is each part in AOP terms?**

```python
def traced(fn):
    @functools.wraps(fn)
    def wrapper(*a, **k):
        print("->", fn.__name__)
        try:
            return fn(*a, **k)
        finally:
            print("<-", fn.__name__)
    return wrapper

@traced
def charge(amount): return amount * 2

print(charge(10))
```

<details><summary>Answer</summary>

Prints `-> charge`, then `<- charge`, then `20`. In AOP terms: `traced` is the **aspect** (advice + weaving in one); `@traced` is the **pointcut** (it selects exactly this one join point); the `print("->")` is **before** advice, the `finally` block is **after-finally** advice, and `fn(*a, **k)` inside the `try` is the **around** structure calling the real method (`proceed()`). `functools.wraps` preserves `charge`'s name/docstring so the wrapper doesn't erase its identity — the same "wrapper hides the original" hazard frameworks face.
</details>

**Q39. Go — read this middleware chain. What order do the logs print for one request?**

```go
handler := Logging(Auth(handler))
// Logging logs "L-in"/"L-out"; Auth logs "A-in"/"A-out"; handler logs "H".
```

<details><summary>Answer</summary>

`L-in`, `A-in`, `H`, `A-out`, `L-out`. `Logging` is the *outermost* wrapper, so its "before" runs first and its "after" runs last; `Auth` is inside it; the real handler is innermost. Each middleware is **around advice**: it runs before-code, calls `next()` (`proceed()`), then runs after-code. The nesting order *is* the advice order — and unlike Spring's invisible pointcut ordering, you can read it directly from the wiring line. This visibility is exactly why middleware is preferred for request-shaped concerns.
</details>

**Q40. Spring — this aspect "works" in unit tests but fails in production. Why?**

```java
@Test void test() {
    OrderService s = new OrderService();   // constructed directly
    s.placeOrder(order);
    // asserts the order was placed; passes.
}
```

<details><summary>Answer</summary>

The test constructs `OrderService` with `new`, so it's the **raw, unproxied** class — **no aspects are woven**. Any `@Transactional`, `@Cacheable`, or `@PreAuthorize` on `placeOrder` simply doesn't run in this test, so the test passes while exercising *none* of the cross-cutting behavior. In production, Spring hands out the *proxied* bean and the aspects run — including the self-invocation and rollback gotchas the test can't see. Fix: test aspect behavior through the Spring context (`@SpringBootTest`) so the proxy is in play; unit-test only the raw logic that doesn't depend on weaving.
</details>

---

## Curveballs

> Questions designed to catch glib answers.

**Q41. "AOP and the Decorator pattern are the same thing." Agree?**

<details><summary>Answer</summary>

Partly — same *idea*, different *scope and visibility*. Both wrap to add behavior. But a decorator wraps **one explicitly-chosen object** with a visible `new Decorator(x)`; an aspect applies to **many methods selected by a pointcut**, often invisibly. AOP is the *generalization* — "decorate everything matching this pattern, automatically." Calling them "the same" misses the two things that actually matter: AOP's *reach* (it hits methods you never individually wrapped) and AOP's *cost* (the trigger can be invisible). They're points on one spectrum, not identical.
</details>

**Q42. If AOP is so controversial, why is `@Transactional` universally loved?**

<details><summary>Answer</summary>

Because `@Transactional` hits AOP's *sweet spot* and avoids its *failure mode*. The concern is **universal** (every service method needs a tx), **uniform** (same begin/commit/rollback), **orthogonal** (doesn't change what the method computes), and **expected** (every engineer assumes service methods are transactional). And critically, the trigger is an **annotation on the method** — *visible* — not a distant pointcut. AOP is controversial when it hides *surprising* or *business-critical* behavior; `@Transactional` hides only universal, expected plumbing with a local breadcrumb. The controversy is about *general* AOP ("aspectize everything"), not these narrow, annotated uses.
</details>

**Q43. Can AOP advise code you don't own — including JDK classes?**

<details><summary>Answer</summary>

**AspectJ can; Spring AOP can't.** Spring AOP only proxies *its own managed beans*, so third-party and JDK classes are out of reach. AspectJ load-time weaving rewrites bytecode as classes load, so it can weave *any* class — third-party libraries, even `java.sql` internals. This is exactly how observability agents instrument JDBC `executeQuery` and HTTP clients without you (or the library author) doing anything: they're AspectJ-style weavers operating on classes nobody anticipated. "Can reach code you don't own" is a key dividing line between proxy AOP and bytecode AOP.
</details>

**Q44. Doesn't AOP just hide complexity rather than remove it?**

<details><summary>Answer</summary>

It *relocates* it, and whether that's good depends on the concern. For a **universal, expected** concern (transactions), relocating it out of 200 methods into one aspect *removes* genuine duplication and noise — the complexity was never essential to those methods. For a **surprising or business-critical** behavior, relocating it into an invisible aspect *hides* essential complexity the reader needs — that's strictly worse. So the honest answer is: AOP removes *accidental* duplication well and hides *essential* behavior badly. The skill is telling which kind of complexity you're moving — that's the whole "clarifies vs hides" judgment.
</details>

**Q45. Why can't you just use inheritance or a base class for cross-cutting concerns?**

<details><summary>Answer</summary>

Because cross-cutting concerns **cut across the inheritance hierarchy**, not along it. Logging is needed in the order service, the payment service, and the user service — which have *no* common, meaningful base class. Forcing them under a shared `LoggingBase` couples unrelated classes, breaks single inheritance (you can only extend one class), and still requires every method to call `super`/the hook explicitly (back to scattering). AOP exists precisely because the concern's shape (orthogonal to the type hierarchy) doesn't match what inheritance can express. This mismatch — "tyranny of the dominant decomposition" — is the original motivation for aspects.
</details>

**Q46. Is middleware "real" AOP, or just a similar idea?**

<details><summary>Answer</summary>

It's real AOP — the *same paradigm*, just with the pointcut made explicit. Middleware is around advice (`next()` is `proceed()`) over one specific join point (the request), composed into an aspect chain. What it drops is the *implicit pointcut matching* — you list the chain instead of writing a pattern. That's a deliberate restriction that buys back visibility, not a different concept. Treating middleware as "not AOP" misses that the entire vocabulary (advice, around, ordering, cross-cutting concern) transfers directly — which is the practical payoff of recognizing it.
</details>

---

## Rapid-Fire / One-Liners

> Crisp answers; what an interviewer wants in a sentence or two.

**Q47. Cross-cutting concern in one line?**

<details><summary>Answer</summary>

A concern (logging, security, transactions) needed across many unrelated modules, so it can't be cleanly captured in one class in the normal structure.
</details>

**Q48. Pointcut vs join point in one line each?**

<details><summary>Answer</summary>

A join point is one spot in execution; a pointcut is the pattern that selects a *set* of join points.
</details>

**Q49. Which advice type can skip the real method?**

<details><summary>Answer</summary>

Around — it owns `proceed()` and can choose not to call it (that's how caching skips the body on a hit).
</details>

**Q50. Spring AOP vs AspectJ in one line?**

<details><summary>Answer</summary>

Spring AOP = runtime proxy, method-only, beans-only, zero setup; AspectJ = compile/load-time bytecode weaving, can advise anything.
</details>

**Q51. The one-sentence reason `@Transactional` is AOP?**

<details><summary>Answer</summary>

It's an around aspect (`@annotation(Transactional)` pointcut + a transaction interceptor) woven by Spring's proxy.
</details>

**Q52. Why does self-invocation skip advice?**

<details><summary>Answer</summary>

The internal `this.x()` call doesn't pass through the proxy, and proxy-based advice only fires on calls that do.
</details>

**Q53. Why can't a `final` method be advised by Spring AOP?**

<details><summary>Answer</summary>

CGLIB advises by overriding methods in a generated subclass, and `final` methods can't be overridden.
</details>

**Q54. Go's answer to AOP?**

<details><summary>Answer</summary>

Explicit middleware: `func(next Handler) Handler` — around advice with the pointcut replaced by a visible chain.
</details>

**Q55. The one-word risk of AOP?**

<details><summary>Answer</summary>

Invisibility — behavior runs with no visible call site, breaking local reasoning.
</details>

---

## How to Talk About AOP in Interviews

A few habits separate a strong answer from a textbook recital:

- **Lead with the problem, not the jargon.** Open with scattering/tangling and the copy-pasted log lines, *then* introduce aspects. Showing you understand *why* AOP exists beats reciting "join point, pointcut, advice."
- **Keep join point and pointcut crisp.** One spot vs the pattern that selects many. Blurring them is an instant junior tell; getting it sharp is a quick credibility win.
- **Name the trade-off explicitly.** "AOP trades locality of the *concern* for locality of *reasoning*." This one sentence shows you understand both the value and the danger, and it sets up every senior-level point.
- **Reach for `@Transactional` as your anchor.** It's the universally-known AOP, and tracing it (proxy → interceptor → commit/rollback → checked-exception trap → self-invocation) demonstrates the whole machinery on a real example.
- **Connect the limits to the mechanism.** Don't just list "self-invocation, `final`, beans-only" — derive them from "it's a proxy that overrides methods." Showing the *why* signals you understand the model, not memorized trivia.
- **Show the modern picture.** Note that AOP "lost" as a general tool but *thrives* as annotations + middleware + observability agents. This breadth — and the "clarifies vs hides" judgment — is what separates senior from junior.
- **Recognize AOP across languages.** Python decorators, Go middleware, Node interceptors are the same paradigm. Naming that throughline signals you understand the concept, not one framework.

---

## Summary

- AOP exists to fix **scattering** (one cross-cutting concern smeared across many methods) and **tangling** (one method mixing many concerns) by factoring concerns into **aspects** that run **advice** at **join points** selected by **pointcuts**, stitched in by **weaving**.
- The **five terms** are the spine: join point (one spot), pointcut (the selecting *pattern*), advice (the code + when), aspect (the module), weaving (the wiring). **Around** advice is the powerful one — it owns `proceed()` and can skip, repeat, or replace the call.
- **Weaving** is compile-time or load-time (**AspectJ**, bytecode, can advise anything) or runtime **proxy** (**Spring AOP**, method-only, beans-only, zero setup). The proxy model *derives* every Spring AOP limit: **self-invocation** bypasses advice, **`final`/`private`** and **non-bean** methods can't be advised.
- The defining trade is **locality of the concern** (the win) vs **locality of reasoning** (the cost: behavior with no visible call site). AOP thrives for **universal, uniform, orthogonal, expected** concerns — transactions, security, caching, metrics, retry — and is dangerous for surprising or business-critical behavior.
- Modern AOP is **everywhere in disguise**: Spring's annotations (`@Transactional` et al.) are woven aspects; **middleware/filters** are AOP made *explicit* over the request pipeline; **observability agents** are load-time bytecode weaving with zero code changes. **Aspect, decorator, and middleware are one idea — "wrap to add cross-cutting behavior" — at three scopes**, differing in trigger visibility, all often riding on **DI**.
- The strongest answers lead with the *problem*, derive the *limits from the mechanism*, name the *trade-off*, anchor on `@Transactional`, and show the *modern* annotation/middleware/agent picture plus the **clarifies-vs-hides** judgment.

---

## Related Topics

- [`junior.md`](junior.md) — scattering/tangling, before/after/around, Python decorators as the gentle intro.
- [`middle.md`](middle.md) — the five terms, pointcut expressions, weaving types, proxies, Spring AOP vs AspectJ.
- [`senior.md`](senior.md) — action-at-a-distance, proxy limits, ordering, why it faded, where it thrives.
- [`professional.md`](professional.md) — annotations-as-aspects, `@Transactional` end-to-end, middleware, observability agents.
- [Decorator Pattern](../../code-craft/design-patterns/02-structural/04-decorator/) — AOP for one object, made explicit.
- [Proxy Pattern](../../code-craft/design-patterns/02-structural/07-proxy/) — the mechanism behind Spring AOP.
- [Dependency Inversion / Injection](../../code-craft/design-principles/04-solid/05-dip-dependency-inversion/) — the wiring substrate AOP rides on.
- [11 — Event-Driven Programming](../11-event-driven-programming/) — request pipelines and handlers as non-local control flow.
