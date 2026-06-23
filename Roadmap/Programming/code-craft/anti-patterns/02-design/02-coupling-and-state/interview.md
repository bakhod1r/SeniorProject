# Coupling & State Anti-Patterns — Interview Q&A

> **Category:** [Design Anti-Patterns](../README.md) → **Coupling & State** — *modules that know or share too much, and objects whose correctness depends on hidden order or hidden reach.*
> **Covers (collectively):** Singletonitis · Circular Dependency · Action at a Distance · Hidden Dependencies · Sequential Coupling

A bank of 65+ interview questions and answers spanning recognition, redesign, root-cause analysis, and the deep runtime story (lock contention, initialization order, build cycles, concurrency). Each answer models the reasoning a strong candidate gives — including the trade-offs. Use the `<details>` toggles to self-quiz: read the question, answer out loud, then expand.

---

## Table of Contents

1. [Fundamentals / Junior](#fundamentals--junior)
2. [Intermediate / Middle](#intermediate--middle)
3. [Senior — Redesign at Scale & Root Causes](#senior--redesign-at-scale--root-causes)
4. [Professional / Deep — Locks, Init Order, Build Cycles, Concurrency](#professional--deep--locks-init-order-build-cycles-concurrency)
5. [Code-Reading — Diagnose the Snippet](#code-reading--diagnose-the-snippet)
6. [Curveballs](#curveballs)
7. [Rapid-Fire / One-Liners](#rapid-fire--one-liners)
8. [How to Talk About Anti-Patterns in Interviews](#how-to-talk-about-anti-patterns-in-interviews)
9. [Summary](#summary)
10. [Related Topics](#related-topics)

---

## Fundamentals / Junior

> Definitions, recognition, and the "why is it bad" reasoning.

**Q1. Name the five coupling-and-state anti-patterns and give a one-line symptom for each.**

<details><summary>Answer</summary>

- **Singletonitis** — every shared thing (config, logger, DB, session, "manager") is a global singleton, all reached implicitly, none injected.
- **Circular Dependency** — module A imports B, B imports A; the dependency graph has a cycle you can't topologically order.
- **Action at a Distance** — code in one place mysteriously changes the behavior of code in a far-away place, via global mutable state or hidden side effects.
- **Hidden Dependencies** — a unit secretly reads globals, env vars, the clock, or the filesystem; its signature lies about what it actually needs to run.
- **Sequential Coupling** — methods must be called in a fixed order (`open` → `read` → `close`) or the object misbehaves, with nothing enforcing the order.

The common thread: **dependencies that are real but not visible**. You spot them not in one line but by asking "what does this actually need, and who else can change it?"
</details>

**Q2. What is "coupling," in one sentence, and why does too much of it hurt?**

<details><summary>Answer</summary>

Coupling is the degree to which one unit depends on the internals, identity, or timing of another. It hurts because dependency is the channel through which *change propagates*: the more tightly two units are coupled, the more a change to one forces a change (or a surprise failure) in the other. High coupling shrinks the set of things you can modify, test, or reason about in isolation — you can no longer hold one module in your head without dragging in its neighbors.
</details>

**Q3. What is a Singleton, and what is "Singletonitis"?**

<details><summary>Answer</summary>

A **Singleton** is a class constrained to one instance, usually exposed through a global access point (`Logger.getInstance()`). It is a legitimate pattern for a genuinely process-wide resource. **Singletonitis** is the *overuse* of that pattern: reaching for a global singleton as the default way to share *anything* — config, caches, the DB connection, the current user, feature flags. The disease isn't the single instance; it's the **global, implicit access** that lets any code anywhere depend on it without declaring it. That turns every singleton into a hidden dependency and a shared mutable channel.
</details>

**Q4. Why are global singletons hard to test?**

<details><summary>Answer</summary>

Because they remove the *seam* you need to substitute a fake. When `OrderService` calls `Database.getInstance()` internally, a unit test has no way to inject an in-memory DB — the dependency is baked into the method body, not handed in. You're forced into integration tests that stand up the real resource, or into ugly static-field surgery between tests. Worse, singletons usually carry mutable state, so test A leaves the singleton dirty and test B fails depending on run order. Inject the dependency through the constructor and both problems vanish: the test passes a fake, and each test gets its own instance.
</details>

**Q5. What is "Action at a Distance" and why is it so disorienting to debug?**

<details><summary>Answer</summary>

Action at a Distance is when modifying state in one location silently changes behavior somewhere unrelated, because the two communicate through shared mutable state or a hidden side effect rather than through an explicit call. It's disorienting because the *symptom* and the *cause* are far apart in the code: a bug surfaces in the report renderer, but the cause is a global flag flipped by the login handler three modules away. There's no call edge connecting them, so the normal debugging move — "follow the call that produced this value" — leads nowhere. You end up grepping for every writer of a global, which is exactly the work explicit data flow would have spared you.
</details>

**Q6. What is a "hidden dependency"? Give an example.**

<details><summary>Answer</summary>

A hidden dependency is something a unit needs to function that isn't visible in its public interface — its signature lies about its requirements. Classic examples: a function that reads `System.getenv("API_KEY")` internally, calls `time.Now()`, reads from a global config singleton, or touches `./config.yaml` on disk. The signature `func charge(amount int) error` claims it needs only an amount, but it secretly also needs an env var, a clock, and a network connection. The reader can't tell from the call site what must be true for the call to succeed.
</details>

**Q7. What is Sequential Coupling? Give the canonical example.**

<details><summary>Answer</summary>

Sequential Coupling (a "temporal coupling") is when an object's methods must be invoked in a specific order to work, but nothing enforces that order. The canonical example is a resource: you must `open()` before `read()`, and `close()` after, or you get garbage, an exception, or a leak. Other examples: a builder where `setHost()` must precede `connect()`, or an init/start/stop lifecycle. The danger is that the contract lives only in documentation or tribal knowledge; the compiler permits `read()` on an unopened handle, so the bug ships and fails at runtime.
</details>

**Q8. Why is a hidden dependency on a global worse than an explicit parameter?**

<details><summary>Answer</summary>

An explicit parameter is *honest and local*: the signature tells you what's needed, the caller controls what's supplied, and a test can pass a fake. A hidden global dependency is *dishonest and shared*: the signature hides the requirement, so callers don't know they must initialize the global first; the value is shared process-wide, so any other code can change it underneath you; and there's no seam to substitute a test double. Concretely, `discount(price, rate)` is a pure function you can test with two numbers, while `discount(price)` that reads a global `currentRate` can return different answers on identical inputs depending on who touched the global last. Explicitness converts an invisible, shared, untestable dependency into a visible, local, controllable one.
</details>

**Q9. How is a Circular Dependency different from "A just uses B"?**

<details><summary>Answer</summary>

"A uses B" is a directed edge — a normal, healthy dependency you can layer: B is lower-level, A is higher-level, and you can build/test/understand B without A. A *circular* dependency is a cycle: A needs B and B needs A, so neither is truly lower-level. You can't compile, initialize, test, or reason about one without the other; they've effectively fused into a single unit wearing two names. The asymmetry of a clean dependency (one direction) is what lets you order and isolate modules; a cycle destroys that ordering.
</details>

**Q10. Why is global mutable state the common engine behind several of these?**

<details><summary>Answer</summary>

Global mutable state is the shared channel that makes the implicit possible. A singleton *is* global state; reading it is a *hidden dependency*; writing it from one place and reading it from another is *action at a distance*; and relying on it being set up before use is a *sequential coupling* across modules. Strip the "global" and the "mutable" and most of these collapse: local immutable values can't be changed at a distance, can't hide in a signature, and don't impose an init order. That's why "make state explicit and prefer immutability" is the single highest-leverage cure across the whole category.
</details>

**Q11. What does "make the dependency explicit" actually mean in practice?**

<details><summary>Answer</summary>

It means a unit receives everything it needs through its declared interface — constructor parameters, method arguments, injected collaborators — rather than reaching out to fetch them. Instead of `func (s *Service) charge()` calling `db.Instance()` and `time.Now()` inside, you write `NewService(db DB, clock Clock)` and the method uses `s.db` and `s.clock`. Now the signature is honest (you can see it needs a DB and a clock), the caller is in control (it decides which DB), and a test can pass fakes. This is just **Dependency Injection** — and it's the structural cure for Singletonitis, Hidden Dependencies, and most Action at a Distance.
</details>

**Q12. Is a logger that everyone calls as a global automatically Singletonitis?**

<details><summary>Answer</summary>

Not automatically — it's the most defensible singleton there is, because logging is a genuinely cross-cutting, process-wide concern and a *write-mostly*, side-effect-only facility. The line is crossed when the logger carries request-scoped state (so concurrent requests stomp each other's context), when tests can't capture or silence output because there's no seam, or when "logger is global, so everything else can be too" becomes the team's habit. A stateless global logger is fine; a stateful global *anything-else* reached the same way is the disease.
</details>

---

## Intermediate / Middle

> When it creeps in, what to do instead, and the trade-offs.

**Q13. Nobody plans Singletonitis — how does it actually spread through a codebase?**

<details><summary>Answer</summary>

It spreads by convenience and imitation. The first singleton is reasonable — a single DB pool. Then someone needs config in a deep helper and, rather than thread it through five layers of parameters, makes `Config.getInstance()`. It works, so the next person copies the pattern for the cache, then the feature-flag service, then "current user." Each step avoids the tedium of passing a value down the call stack, which feels like a win. The root cause is **avoiding the cost of explicit wiring** — and once one global exists, every new one is "consistent with the codebase," so the pattern metastasizes until nothing can be tested in isolation.
</details>

**Q14. What do you reach for *instead* of a singleton when you need shared access?**

<details><summary>Answer</summary>

Dependency Injection: construct the shared instance *once* at the composition root (`main`, the DI container, the app bootstrap) and pass it explicitly to whoever needs it. You still have one instance — that part of the Singleton was fine — but access is now explicit and the lifetime is owned by the composition root, not hidden behind a static accessor. For truly ambient concerns (logging, tracing) a thin global facade is acceptable, but it should be stateless or context-propagating. The shift is from "callee fetches its dependency" to "caller supplies it."
</details>

**Q15. How do you break a circular dependency?**

<details><summary>Answer</summary>

There are three standard moves, in rough order of preference. (1) **Extract a shared abstraction**: pull the thing both A and B need into a third, lower-level module C that both depend on — the cycle becomes A→C←B. (2) **Dependency Inversion**: define an interface in the higher-level (or a neutral) module and have the lower-level module depend on that interface instead of the concrete type, so the compile-time arrow flips. (3) **Merge** A and B if they're genuinely one concept that was wrongly split. Last resorts — lazy/late binding, callbacks, or events to defer the reference to runtime — break the *compile-time* cycle but leave the conceptual tangle, so prefer them only when restructuring isn't feasible.
</details>

**Q16. When is a required call-order acceptable, and how do you make it safe?**

<details><summary>Answer</summary>

A required order is acceptable when it reflects an *essential* lifecycle — you genuinely cannot read from a connection that isn't open, or commit a transaction you never began. Order is not the enemy; *unenforced, invisible* order is. Make it safe by encoding the contract in the type system or the language's resource idioms: use **RAII / `with` / `try-with-resources` / `defer`** so open and close are paired automatically; use a **Builder** that only exposes `build()` once required fields are set; or model the lifecycle as a **state machine** where each state exposes only its legal next operations (an `OpenFile` type with a `read()` method, returned only by `open()`). The goal is to make the illegal order *unrepresentable* rather than merely documented.
</details>

**Q17. What's the trade-off of injecting everything explicitly instead of using globals?**

<details><summary>Answer</summary>

The benefit is honesty, testability, and controllable lifetimes; the cost is **wiring overhead**. Constructors grow more parameters, the composition root gets larger, and you may pass a dependency through intermediate layers that don't use it directly (the "tramp data" problem). Teams manage this with DI containers/frameworks, by grouping related dependencies into a small context object, and by keeping object graphs shallow. The trade is almost always worth it — a few extra parameters at the edges in exchange for units you can test and reason about in isolation — but a candidate should name the cost rather than pretend DI is free.
</details>

**Q18. How does Action at a Distance typically sneak into a "clean" codebase?**

<details><summary>Answer</summary>

Through shared *references* that look harmless. You return a mutable object (a slice, a map, a domain entity) from a getter; a caller mutates it; now you've changed your own internal state from a distance. Or a config object is passed around and one consumer mutates a field that another consumer reads later. Or a cache is shared and one path's eviction policy surprises another path. The mutation is local and reasonable in each spot, but because the *same object* is reachable from many places, the effect lands far away. The cure is defensive copies, returning immutable views, or making the shared object immutable outright.
</details>

**Q19. Why can hidden dependencies make code non-deterministic, and why does that matter for tests?**

<details><summary>Answer</summary>

Because the hidden inputs change between runs. A function that reads `time.Now()`, `rand`, an env var, or a mutable global produces different outputs for the same explicit arguments depending on *when* and *where* it runs. That's fine in production but lethal for tests: a test that passes today fails at midnight (date rollover), fails in CI (different env), or fails when run after another test that dirtied the global (order-dependence, "flaky tests"). Injecting those inputs — a `Clock`, a seeded RNG, a config struct — makes the function a pure mapping from declared inputs to outputs, which is exactly what makes it deterministically testable.
</details>

**Q20. Refactor this hidden-dependency Python function and explain the win.**

```python
import os, time

def make_token(user_id):
    secret = os.environ["TOKEN_SECRET"]      # hidden dep: env
    issued = int(time.time())                # hidden dep: clock
    return sign(f"{user_id}:{issued}", secret)
```

<details><summary>Answer</summary>

Inject the hidden inputs so the signature tells the truth:

```python
def make_token(user_id, secret, now):
    issued = int(now())
    return sign(f"{user_id}:{issued}", secret)

# composition root wires the real ones:
make_token(uid, os.environ["TOKEN_SECRET"], time.time)
```

Now the function is a pure function of its declared arguments. A test can pass a fixed `secret` and a frozen `now=lambda: 1_700_000_000` and assert an exact token — no environment setup, no time travel, no flakiness. The win is **honesty + determinism + testability**: the reader sees the real inputs, the caller controls them, and the behavior is reproducible. The cost is two more parameters, paid once at the edge.
</details>

**Q21. Refactor this sequentially-coupled Java class so the order can't be misused.**

```java
class Report {
    void begin()  { /* must call first */ }
    void addRow() { /* NPE if begin() not called */ }
    String end()  { /* must call last */ }
}
```

<details><summary>Answer</summary>

Encode the lifecycle in types so each state exposes only its legal operations:

```java
class ReportBuilder {                 // the only entry point
    static OpenReport begin() { return new OpenReport(); }
}
class OpenReport {                    // returned only by begin()
    OpenReport addRow(Row r) { ...; return this; }
    String end() { ... }              // the only way to finish
}
```

`addRow()` and `end()` now exist *only* on the object `begin()` hands back, so you cannot call them before beginning — the illegal order is unrepresentable rather than merely documented. Alternatively, in Go/Python/Java-with-AutoCloseable, wrap the lifecycle in `defer` / `with` / try-with-resources so open and close are paired by the language. **Trade-off:** a little more type machinery in exchange for moving the error from "runtime NPE in production" to "won't compile."
</details>

**Q22. What review questions catch each of these while the change is still small?**

<details><summary>Answer</summary>

- **Singletonitis:** "Is this a new global accessor? Could it be a constructor parameter instead?"
- **Hidden Dependencies:** "Does this method read anything not in its signature — env, clock, global, disk?"
- **Action at a Distance:** "Does this return or store a *reference* to mutable state that others hold?"
- **Sequential Coupling:** "If I call these methods in a different order, what happens?" "It breaks" → encode the order in types.
- **Circular Dependency:** "Does this new import create a cycle in the package graph?" (Run the dependency linter.)

The cheap defense across all five: small PRs, plus a dependency-cycle check and a "no new singletons without justification" norm in CI/review.
</details>

**Q23. Your codebase has 14 singletons. How do you decide which are legitimate?**

<details><summary>Answer</summary>

Apply two tests to each. First, **is it genuinely process-wide and single by nature?** A connection pool, a metrics registry, a logger — yes; a "current user," request context, or per-tenant config — no, those are scoped and being forced global. Second, **does it carry mutable, scenario-dependent state?** A stateless utility reached globally is low-risk; mutable shared state is where action-at-a-distance and test-pollution bugs live. Keep the few that pass both tests (and even those, inject rather than `getInstance()` where practical); convert the rest to injected, properly-scoped dependencies. The verdict is by *nature and state*, not by count.
</details>

**Q24. Diagnose and fix this Go circular-import sketch.**

```go
// package user
import "app/order"
type User struct { Orders []order.Order }
func (u User) LatestOrder() order.Order { ... }

// package order
import "app/user"               // <-- import cycle
type Order struct { Owner user.User }
```

<details><summary>Answer</summary>

This is a **Circular Dependency**: `user` imports `order` and `order` imports `user`, which Go rejects at compile time. The conceptual problem is that the two types reference each other concretely. Fixes, best first: (1) **Extract shared types** into a lower-level package both depend on (e.g. an `ids` or `domain` package holding the IDs/value objects), and reference by ID instead of by full struct. (2) **Invert with an interface**: have `order` depend on a small `Owner` interface it defines itself, rather than on the concrete `user.User`. (3) **Merge** the packages if `User` and `Order` are really one aggregate. Referencing by ID (`Order{ OwnerID UserID }`) is usually the cleanest and also avoids loading the whole object graph.
</details>

**Q25. A `Settings` object is passed everywhere and any code can mutate its fields. What's the anti-pattern and the fix?**

<details><summary>Answer</summary>

That's **Action at a Distance** via shared mutable state: a write to `Settings.timeout` in the import path changes behavior in the export path with no call edge between them. The fix is **immutability** — make `Settings` immutable after construction (final/readonly fields, no setters), so consumers can read but not mutate the shared instance. If something genuinely needs a different value, it constructs a modified copy (`settings.withTimeout(30)`) rather than mutating the shared one. Where runtime reconfiguration is required, funnel writes through a single owner with explicit change events, so the mutation has a visible, auditable path instead of being a free-for-all.
</details>

---

## Senior — Redesign at Scale & Root Causes

> Large-system restructuring, organizational root causes, and when *not* to chase decoupling.

**Q26. How do you migrate a large codebase off pervasive singletons without a big-bang rewrite?**

<details><summary>Answer</summary>

Strangle them incrementally. (1) Keep the singleton's `getInstance()` as a thin facade but have it delegate to a real injected instance owned by a composition root — now there's *one* place the instance is created. (2) For each consumer you touch, add the dependency as a constructor parameter and have the call site pass the instance, leaving `getInstance()` as a fallback default so nothing breaks. (3) Migrate consumers opportunistically as you work in each area, each change small and green-to-green. (4) Once a singleton has no remaining `getInstance()` callers, delete the static accessor. This converts "global, fetched" into "injected, supplied" file by file, never on a long-lived branch, and you get testability incrementally on exactly the code you're already changing.
</details>

**Q27. What organizational forces breed Singletonitis and hidden dependencies — it's not just laziness?**

<details><summary>Answer</summary>

Several. **Deadline pressure** rewards `getInstance()` over threading a parameter through five layers. **No composition-root discipline** (no clear place where the object graph is wired) means there's nowhere "right" to construct shared things, so globals fill the vacuum. **Framework conventions** — some frameworks and tutorials normalize statics and ambient context. **Copy-paste culture** — the first global makes every subsequent one "consistent." **Weak module ownership** breeds circular deps because nobody guards the boundary between two teams' packages. And **lack of test pressure**: teams that don't unit-test never feel the pain of un-injectable dependencies, so the feedback that would discourage globals is absent. Durable fixes address these (a real composition root, a dependency-cycle gate in CI, a "test it in isolation" norm), not just the symptoms.
</details>

**Q28. When is chasing decoupling the *wrong* call?**

<details><summary>Answer</summary>

When the decoupling buys nothing you need. You can't have *zero* coupling — a program is its dependencies — so the job is to keep coupling *appropriate*, not minimal. Don't introduce an interface, an event bus, or DI indirection to "decouple" two things that always change together and have exactly one implementation: that's [Premature Abstraction](../03-abstraction-failures/middle.md) and over-engineering, and it adds indirection cost (more files, more jumps to follow a call) for no flexibility you'll use. Don't refactor a stable, low-churn global that no test needs to fake. Spend the decoupling budget where it pays: on the seams you actually test against, the modules multiple teams change, and the cycles that block your build.
</details>

**Q29. Walk through breaking a circular dependency between two large packages multiple teams own.**

<details><summary>Answer</summary>

(1) **Map the cycle** precisely — which exact symbols cross each boundary in each direction (a dependency-graph tool, not guessing). Often the cycle is caused by a handful of references, not the whole package. (2) **Classify** each crossing edge: is it a shared *type*, a shared *behavior*, or genuinely bidirectional collaboration? (3) **For shared types**, extract them into a new lower-level package both depend on (IDs, value objects, DTOs) — this usually kills most cycles. (4) **For behavior**, apply Dependency Inversion: the consumer defines a narrow interface it needs; the provider implements it; the compile-time arrow now points one way. (5) **Coordinate with the owning teams** — agree on the new lower-level package's ownership, do it behind green tests, and add a **CI gate that fails on new cycles** so it doesn't regress. The technical move is easy; the senior part is the ownership negotiation and the guardrail that keeps it fixed.
</details>

**Q30. You inherit a module riddled with Action at a Distance through globals. What's your sequence of moves?**

<details><summary>Answer</summary>

(1) **Characterize** — pin current observable behavior with tests, treating the globals as the system boundary so you have a safety net. (2) **Inventory the globals** and, for each, find every reader and writer (grep / static analysis); this map *is* the hidden coupling. (3) **Make the most-touched globals explicit first** — convert reads to parameters and writes to return values, one global at a time, so data flows visibly in and out instead of telepathically. (4) **Freeze what's left** — wrap stubbornly-shared state in a small owner object that's immutable to readers and only mutable through its own methods, removing the "anyone can write" channel. (5) Each step green-to-green, structural commits separate from behavioral fixes. The endpoint is data flow you can follow by reading call edges.
</details>

**Q31. How do you detect these anti-patterns across a large codebase rather than file by file?**

<details><summary>Answer</summary>

Tooling per pattern. **Circular Dependencies:** package/dependency-graph analyzers and import-cycle linters (Go's compiler rejects them; `madge` for JS/TS; ArchUnit/jdepend for Java; import-linter for Python) — wire these into CI. **Singletonitis:** grep for static `getInstance`/`INSTANCE`/global accessors and count them; a rising count is the trend. **Hidden Dependencies:** lint rules flagging direct `os.Getenv`, `time.Now()`, `new Date()`, filesystem, or global access inside business logic (push them to the edges). **Action at a Distance:** harder to lint, but mutable package-level/global variables are the proxy — flag and minimize them. **Sequential Coupling:** no clean linter; caught by review and by tests that call methods out of order. The principle holds: tools surface candidates; judgment confirms.
</details>

**Q32. Can over-correcting Singletonitis create a different problem? Which?**

<details><summary>Answer</summary>

Yes. Two over-corrections are common. First, **constructor explosion / DI sprawl**: every class takes ten injected dependencies and the composition root becomes an unreadable wiring tangle — you traded hidden coupling for visible-but-overwhelming coupling, often a sign the classes have too many responsibilities (a God Object problem in disguise). Second, **passing dependencies through layers that don't use them** ("tramp data"), coupling intermediate layers to types they don't care about. The cure isn't "back to globals"; it's smaller, more cohesive units (fewer dependencies each) and grouping related collaborators into a small context, so injection stays explicit without becoming noise.
</details>

**Q33. How do you set a team norm that prevents new singletons and cycles from reappearing?**

<details><summary>Answer</summary>

Make the right thing automatic and the wrong thing loud. (1) **A real composition root** — one documented place where the object graph is wired — so "where do I construct this?" has an answer that isn't `getInstance()`. (2) **A CI gate that fails the build on new import cycles**, so circular deps can't merge. (3) **Lint rules** flagging new static singletons and direct env/clock/disk access in business-logic packages, with an explicit allowlist for the few legitimate ones. (4) **Review checklist** items ("new global? new cycle? returns mutable ref?"). (5) **Test pressure** — requiring unit tests creates organic resistance to un-injectable dependencies. Guardrails beat exhortation: developers route around globals when globals are the friction-ful path.
</details>

**Q34. Coupling — can you ever have zero, and what's the real goal?**

<details><summary>Answer</summary>

No, and you wouldn't want it. A system *is* its components plus the dependencies among them; zero coupling means the parts can't collaborate, i.e. they're not one system. The realistic goal is not "no coupling" but **the right coupling**: loose where parts must evolve independently, deliberate where they're genuinely one concept. You manage it along several axes — favor coupling to *interfaces* over *implementations*, to *stable* things over *volatile* ones, *explicit* (in the signature) over *implicit* (hidden), and *one-directional* over *cyclic*. The senior framing is "is this coupling appropriate and visible?" not "is there any coupling?"
</details>

**Q35. A teammate wants an event bus to decouple two modules that currently call each other directly. Good idea?**

<details><summary>Answer</summary>

It depends on *why* they're coupled. An event bus replaces a direct, traceable call with an indirect, implicit one — which is great when you genuinely need fan-out, async, or to invert a dependency to break a cycle, but is a net loss when you just have two modules that always collaborate synchronously and you'd be trading a readable call graph for "Action at a Distance by design" (a publish in one place mysteriously triggers behavior in another, hard to follow and debug). Ask: do we need the decoupling the bus provides (multiple subscribers, async, cycle-breaking), or are we adding indirection to feel decoupled? If it's a true cycle or a real fan-out need, the bus earns its keep; otherwise prefer the explicit call.
</details>

**Q36. How do you prioritize which coupling problems to fix when the whole codebase is tangled?**

<details><summary>Answer</summary>

By **pain × change-frequency**, same as any structural debt. Fix the cycles that *block your build or CI* first — they have a hard, measurable cost. Then the globals and hidden dependencies that sit on **high-churn, frequently-tested code**, because that's where un-injectable dependencies tax every edit and every test. Deprioritize globals on stable, rarely-touched modules — the coupling is real but cheap because nobody pays it. Use the dependency graph and git churn to find hotspots, fix them opportunistically alongside feature work rather than as a separate "decoupling project," and keep each change small. Let the data, not the aesthetic offense of seeing a global, set the order.
</details>

---

## Professional / Deep — Locks, Init Order, Build Cycles, Concurrency

> Runtime, memory, initialization, build, and concurrency implications.

**Q37. How can a singleton become a lock-contention bottleneck under concurrency?**

<details><summary>Answer</summary>

When the single shared instance guards its mutable state with a lock, *every* thread that touches it serializes on that one lock. As you scale up cores and request concurrency, the singleton's lock becomes a global serialization point — threads spend their time waiting, throughput plateaus or *drops* (lock convoy), and you may even hit cache-line ping-pong on the lock word across sockets (false sharing / cache coherency traffic). A naive thread-safe Singleton with a coarse method-level lock is a classic culprit. Cures: shard the state (per-thread or striped instances reduced at the end), use lock-free/atomic structures, make the shared data immutable (no lock needed for reads), or scope the resource per-request instead of process-wide. The lesson: "one instance" is also "one contention point."
</details>

**Q38. Explain the double-checked locking pitfall in lazy singleton initialization.**

<details><summary>Answer</summary>

Lazy singletons often use double-checked locking to avoid locking on every access: check `instance == null` without a lock, lock only if null, check again, then construct. The pitfall is the **memory model**: without a memory barrier, another thread can observe a *non-null but not-yet-fully-constructed* instance, because the write that publishes the reference can be reordered ahead of the writes that initialize the object's fields. In Java the fix is `volatile` on the field (which the pre-Java-5 model didn't guarantee); in C++ you need acquire/release atomics or `std::call_once`; in Go you use `sync.Once`. The safer move is to sidestep it: eager initialization, or a language idiom that guarantees safe publication (Java's initialization-on-demand holder class, Go's `sync.Once`). It's a textbook example of why "thread-safe singleton" is subtler than it looks.
</details>

**Q39. How do hidden dependencies and globals interact badly with concurrency?**

<details><summary>Answer</summary>

A hidden dependency on shared mutable global state is a **data race waiting to happen**. Because the dependency is invisible, nobody reasons about who else might be writing it concurrently, so synchronization is forgotten — two goroutines/threads read-modify-write the same global with no lock, producing torn reads, lost updates, or, in Go, a race the detector flags and undefined behavior in C/C++. Action at a Distance is the single-threaded cousin; under concurrency it becomes nondeterministic corruption. Making state explicit and local (passed per-request, owned by one goroutine) sidesteps it: data that isn't shared can't be raced. This is the structural foundation under "don't communicate by sharing memory; share memory by communicating."
</details>

**Q40. Why does static initialization order across modules cause bugs, and how is it related to these anti-patterns?**

<details><summary>Answer</summary>

When module-level globals/singletons depend on each other, their *initialization* must happen in dependency order — but that order is determined by the language/linker, not by you, and a circular dependency among initializers has no valid order. C++ has the infamous **"static initialization order fiasco"**: globals in different translation units initialize in an unspecified order, so one global that uses another may see it un-constructed (zero/garbage). Java runs static initializers lazily on first class touch, so a cycle can expose a half-initialized class. Go runs package `init()` in dependency order but *forbids* initialization cycles outright. These are the runtime face of Singletonitis + Circular Dependency: global, eagerly-initialized, mutually-dependent state has no safe order. Cures: avoid cross-global init dependencies, initialize lazily with safe publication, or — best — inject and construct explicitly at a single composition root where you control the order.
</details>

**Q41. What do circular dependencies cost at *build* time, beyond "it's ugly"?**

<details><summary>Answer</summary>

Real, measurable costs. **Incremental compilation:** a cycle fuses modules into one recompilation unit — touching any file in the cycle invalidates all of them, so you lose fine-grained incremental builds and cache hits. **Parallelism:** the build can't compile cyclic modules in parallel because neither can finish first; cycles serialize the build's critical path. **Some toolchains simply reject cycles** (Go won't compile import cycles; strict module systems and `clang` modules disallow them), forcing the fix anyway. **Link/initialization order** becomes undefined (Q40). And **testing** suffers — you can't build or test one module of the cycle in isolation. Breaking cycles shrinks each change's recompilation cone and restores parallel, cacheable builds; it's a feedback-loop optimization, not just hygiene.
</details>

**Q42. Does Singletonitis have memory / GC implications?**

<details><summary>Answer</summary>

Yes. A singleton lives for the whole process by definition, so anything it references is **never collected** — it's a textbook unintentional-retention (memory-leak) vector in GC'd runtimes. If a global cache or registry accumulates entries with no eviction, it grows unboundedly until OOM; if a singleton holds a reference to a large object graph (or to per-request objects it forgot to release), that graph is pinned for the process lifetime. In manual-memory languages the mirror problem is unclear ownership — who frees a process-wide global? Injected, scoped dependencies are collected/freed when their scope ends; globals are not. So "shared and immortal" needs explicit eviction and careful reference hygiene, or it leaks.
</details>

**Q43. How do hidden dependencies on the clock, env, or filesystem undermine reproducibility and observability in production?**

<details><summary>Answer</summary>

They make behavior depend on invisible ambient inputs, which wrecks both reproduction and tracing. **Reproducibility:** a bug that depends on `time.Now()` (a leap second, a timezone, a date boundary), on an env var set differently on one host, or on a file present only in one environment cannot be reproduced from the inputs in the request log — you can't replay it because the real inputs weren't recorded. **Observability:** the dependency isn't in the signature, so it isn't in your traces or structured logs either; an SRE staring at a span sees `charge(amount)` and has no idea it also consulted an env var that was misconfigured. Injecting these (a `Clock`, a config struct, a filesystem abstraction) puts the real inputs where you can log, fix, and replay them — turning ambient magic into recorded, debuggable data.
</details>

**Q44. Compare a thread-local "context" to a global singleton — when is each appropriate?**

<details><summary>Answer</summary>

Both are forms of ambient access, but they differ in *scope* and *safety*. A **global singleton** is one instance shared by all threads — appropriate only for genuinely process-wide, ideally immutable or internally-synchronized resources (logger, metrics registry, connection pool). A **thread-local / request-scoped context** gives each thread (or request) its own instance, which avoids the shared-mutable-state races that plague globals and is appropriate for request-scoped data (trace IDs, the current user, a per-request transaction). The catch: thread-locals are *still* a hidden dependency (the callee fetches rather than receives it) and they leak/misbehave across thread-pool reuse and async boundaries (the value belongs to the wrong request if not cleared). The cleanest option remains **explicit propagation** — Go's `context.Context` passed as the first parameter makes the request scope visible and async-safe — over both globals and thread-locals.
</details>

**Q45. How does Sequential Coupling become dangerous specifically under concurrency or failure?**

<details><summary>Answer</summary>

Because the required order assumes a single, uninterrupted caller, and concurrency/failure break that assumption. If two threads share an object that must go `init → use → cleanup`, thread B can call `use()` between A's `init()` and `cleanup()` — or worse, A's `cleanup()` runs while B is mid-`use()`, yielding use-after-free or a closed-connection error. On the failure side, if an exception or early return skips the `close()`/`commit()`/`unlock()` step, you leak the resource or strand a lock — the order was violated not by misuse but by an error path. This is exactly why languages provide **RAII / `defer` / `try-with-resources` / `with`**: they guarantee the paired teardown runs on *every* exit path, and why per-operation state should be owned by one thread (or guarded) rather than shared. Unenforced order plus concurrency or exceptions equals leaks and corruption.
</details>

---

## Code-Reading — Diagnose the Snippet

> You're shown a snippet; identify the anti-pattern(s) and state the fix.

**Q46. Which anti-pattern, and what's the fix?**

```python
config = {"rate": 0.1}                 # module-level global

def apply_discount(price):
    return price * (1 - config["rate"])   # reads the global

def promo_mode():
    config["rate"] = 0.5                   # writes it, far away
```

<details><summary>Answer</summary>

**Action at a Distance** (with a **Hidden Dependency** baked in). `apply_discount` secretly depends on the global `config`, and `promo_mode` mutates that global from a distance, so a call far away silently changes `apply_discount`'s result with no call edge between them. Fix: make the rate an explicit input so the dependency is visible and the value is local:

```python
def apply_discount(price, rate):
    return price * (1 - rate)
```

Now the function is pure, testable with two numbers, and no distant code can change its behavior behind your back.
</details>

**Q47. Which anti-pattern, and what's the fix?**

```java
public class Db {
    private static Db instance;
    public static Db get() { if (instance == null) instance = new Db(); return instance; }
}
class OrderService {
    void save(Order o) { Db.get().insert(o); }   // fetches its dependency
}
```

<details><summary>Answer</summary>

**Singletonitis / Hidden Dependency.** `OrderService.save` reaches out to `Db.get()` instead of receiving the DB, so its signature lies (it claims to need only an `Order`), there's no seam to inject a fake in tests, and the lazy `get()` is also not thread-safe (Q38). Fix with constructor injection:

```java
class OrderService {
    private final Db db;
    OrderService(Db db) { this.db = db; }
    void save(Order o) { db.insert(o); }
}
```

The composition root constructs the one `Db` and passes it in. Now tests inject a fake DB, the dependency is honest, and the race in `get()` disappears.
</details>

**Q48. Which anti-pattern, and what's the fix?**

```go
type Conn struct{ open bool }
func (c *Conn) Open()  { c.open = true }
func (c *Conn) Read() []byte { /* panics if !c.open */ }
func (c *Conn) Close() { c.open = false }
// caller:
c := &Conn{}
data := c.Read()   // forgot Open(); panics at runtime
```

<details><summary>Answer</summary>

**Sequential Coupling.** `Read()` only works after `Open()` and before `Close()`, but nothing enforces the order — the caller forgot `Open()` and it compiles fine, failing only at runtime. Fix: make the legal order the only representable one. Return the usable handle from the opener and pair teardown with `defer`:

```go
func Open() (*Conn, error) { return &Conn{open: true}, nil }
func (c *Conn) Read() []byte { ... }   // only reachable on an opened Conn
// caller:
c, err := Open()
if err != nil { return err }
defer c.Close()
data := c.Read()
```

You can't get a `*Conn` without `Open()`, and `defer` guarantees `Close()` on every exit path.
</details>

**Q49. Which anti-pattern, and what's the fix?**

```python
# package a/__init__.py
from b import helper
def feature(): return helper() + 1

# package b/__init__.py
from a import feature      # <-- import cycle
def helper(): return 41
```

<details><summary>Answer</summary>

**Circular Dependency.** `a` imports `b` and `b` imports `a`; at import time Python may see a half-initialized module and raise `ImportError`/`AttributeError`, depending on import order. The real issue is that `b` doesn't actually need `feature` here, but even when both directions are real, the fix is to break the cycle: extract the shared piece into a third lower-level module both import (`c.helper`), or invert with an interface/callback so only one direction remains. Here, simply removing the unused `from a import feature` breaks it; in genuine cycles, pull `helper` into a neutral module `c` that both `a` and `b` depend on (`a→c←b`).
</details>

**Q50. This snippet shows two anti-patterns at once — name both.**

```java
class Session {
    static Session current;                 // global singleton
    Map<String,Object> data = new HashMap<>();
}
void handleLogin(User u)  { Session.current = new Session(); Session.current.data.put("uid", u.id); }
void renderDashboard()    { var id = Session.current.data.get("uid"); /* ... */ }
```

<details><summary>Answer</summary>

**Singletonitis** (a mutable, request-scoped thing forced into a process-wide global `Session.current`) *and* **Action at a Distance** (login writes `Session.current`, the renderer reads it, with no call edge — and under concurrency two requests stomp the single `current`, a data race). The `Map<String,Object>` is also a stringly-typed Magic Container, but the coupling sins dominate. Fix: stop making session global — pass the session (or a request `Context`) explicitly into the handlers that need it, scoped per-request, with typed fields instead of a `Map`. Each request gets its own session, the dependency is visible in the signatures, and concurrent requests can't corrupt each other.
</details>

**Q51. Which anti-pattern, and what's the subtle bug?**

```go
type Config struct{ Hosts []string }
func (c *Config) AllHosts() []string { return c.Hosts }   // returns internal slice
// caller:
hosts := cfg.AllHosts()
hosts[0] = "evil"          // mutates Config.Hosts from a distance!
```

<details><summary>Answer</summary>

**Action at a Distance** through a leaked mutable reference. `AllHosts()` returns the *same* backing slice as `Config.Hosts`, so a caller mutating the returned slice silently changes the `Config`'s internal state — a write here corrupts state there with no obvious connection. Fix: return a defensive copy (or an immutable view):

```go
func (c *Config) AllHosts() []string {
    out := make([]string, len(c.Hosts))
    copy(out, c.Hosts)
    return out
}
```

Better still, make `Config` immutable so there's no internal state to corrupt. The general rule: don't hand out references to your mutable internals.
</details>

---

## Curveballs

> The questions designed to catch glib answers.

**Q52. Is the Singleton pattern always bad?**

<details><summary>Answer</summary>

No. The Singleton *pattern* — exactly one instance for the process lifetime — is the correct model for a genuinely process-wide resource: a connection pool, a metrics registry, a logger, a CPU/feature-detection table. What's bad is **Singletonitis**: using global, statically-fetched singletons as the default way to share *everything*, including things that are mutable, request-scoped, or merely convenient to reach globally. And even legitimate single instances are better *injected* (constructed once at the composition root, passed in) than accessed via `getInstance()`, so you keep the testability seam. So: single instance — sometimes right; global hidden access — usually wrong. Separate the two ideas.
</details>

**Q53. Coupling — can you ever have zero?**

<details><summary>Answer</summary>

No, and zero coupling would be a broken system, not a clean one — components that depend on nothing can't collaborate, so "zero coupling" means "no system." Coupling is inherent; the engineering task is to make it **appropriate and visible**: minimize *accidental* coupling, prefer depending on stable interfaces over volatile implementations, make dependencies explicit rather than hidden, and keep the graph acyclic. The wrong question is "how do I eliminate coupling?"; the right one is "is each dependency necessary, visible, and pointing the right way?" Chasing zero leads to over-abstraction (event buses everywhere, interfaces with one impl) — its own anti-pattern.
</details>

**Q54. How do you break a circular dependency — give the move you'd reach for first?**

<details><summary>Answer</summary>

First reach for **extracting the shared abstraction**: find what A and B both depend on, pull it into a new lower-level module C, and point both at C (A→C←B). It's the cleanest because it fixes the *conceptual* tangle, not just the compile error, and it usually reveals that the cycle was caused by a few shared types (extract those as value objects / IDs). If that doesn't fit — the dependency is behavioral, not type-shaped — apply **Dependency Inversion**: have the consumer define a narrow interface it needs and the provider implement it, flipping the compile-time arrow. Reach for lazy binding, callbacks, or events only as a last resort; they break the *build* cycle but leave the design cycle intact.
</details>

**Q55. Why is a hidden dependency on a global worse than an explicit parameter?**

<details><summary>Answer</summary>

Three reasons compound. **Honesty:** the explicit parameter advertises the requirement in the signature; the global hides it, so callers don't know the global must be set up first and readers can't see what the function truly needs. **Control:** the caller picks what to pass for a parameter (including a fake in tests); a global is shared process-wide, so anyone can change it underneath you and you can't substitute it. **Determinism/concurrency:** a parameter is local and per-call; a mutable global makes the function's output depend on global history and exposes it to data races. So the same logical input — "the discount rate" — is, as a parameter, visible/local/controllable/testable, and as a global, invisible/shared/uncontrollable/flaky. The parameter costs one slot in the signature; the global costs you debuggability.
</details>

**Q56. When is a required call-order acceptable?**

<details><summary>Answer</summary>

When it models an **essential lifecycle** that genuinely can't be otherwise — you truly cannot read an unopened file or commit a transaction you didn't begin. The order itself isn't the anti-pattern; the anti-pattern is leaving it *unenforced and invisible*. It's acceptable when you make the contract impossible to violate: pair acquire/release with RAII / `defer` / `with` / try-with-resources so teardown always runs; or model the lifecycle as types/states where each state exposes only its legal next operations, so calling `read()` before `open()` won't compile. Required order encoded in the type system or the language's resource idioms is fine; required order living only in a comment is the bug.
</details>

**Q57. "We use a global singleton because passing it everywhere is ugly." Fair point?**

<details><summary>Answer</summary>

It names a real cost — threading a dependency through many layers *is* tedious (tramp data) — but the conclusion is wrong. The tedium is usually a symptom: if a value has to pass through five layers that don't use it, either your object graph is too deep or those intermediate classes have too many responsibilities. The fixes that preserve testability are a **DI container** (handles the wiring for you), grouping related dependencies into a small **context/config object** passed once, or flattening the graph — not a global. Trading away the testability seam and inviting action-at-a-distance to save some constructor parameters is a bad bargain; solve the wiring ergonomics directly.
</details>

**Q58. Isn't "just make everything immutable" the simplest cure for all of this?**

<details><summary>Answer</summary>

Immutability is the single highest-leverage cure — it eliminates Action at a Distance (you can't mutate what's immutable) and defuses concurrency races — but "everything immutable" is too absolute. Some state is inherently mutable and shared by design (a cache, a connection pool, an event log, a UI model), and forcing immutability there means copying large structures (allocation/GC cost) or contorting the design. The mature stance is **immutable by default, mutable by exception, and when mutable, owned**: prefer immutable values; where you need mutability, confine it to a single owner with a clear, synchronized interface rather than letting it be globally reachable. Immutability removes the *shared mutable* combination that's the actual problem — not all state everywhere.
</details>

**Q59. A candidate says "Singletons are fine, I make them thread-safe with a lock." What do you probe?**

<details><summary>Answer</summary>

Probe whether they understand that "thread-safe" solves *correctness* but can *create a scalability problem*: a coarse lock on the one shared instance serializes every thread through a single point, so it's correct but a contention bottleneck under load (Q37). Then probe the *subtler* correctness traps — double-checked locking and safe publication (Q38) — to see if "I add a lock" is cargo-culted or understood. Finally probe the *design* level: even a perfectly thread-safe singleton is still a hidden dependency and an untestable seam, so thread-safety doesn't address the reason Singletonitis is an anti-pattern. A strong answer separates "no data race" from "no contention" from "good design."
</details>

---

## Rapid-Fire / One-Liners

> Crisp answers; what an interviewer wants in one or two sentences.

**Q60. One-line cure for each of the five?**

<details><summary>Answer</summary>

Singletonitis → inject dependencies; reserve true singletons for process-wide resources. Circular Dependency → extract a shared lower module or invert with an interface. Action at a Distance → make state explicit (params/returns) and prefer immutability. Hidden Dependencies → pass them in (clock, config, env, db), don't fetch them. Sequential Coupling → encode the order in types / RAII / `defer`, not in comments.
</details>

**Q61. The fastest tell of a hidden dependency?**

<details><summary>Answer</summary>

The function's body uses something — `time.Now()`, an env var, a global, the filesystem — that isn't in its parameter list. The signature lies.
</details>

**Q62. One sentence: why do these five cluster together?**

<details><summary>Answer</summary>

They all stem from the same habit — *sharing state implicitly instead of passing it explicitly* — so a singleton becomes a hidden dependency, a hidden dependency mutated from afar becomes action at a distance, and globals that must be set up first become sequential coupling.
</details>

**Q63. Singleton vs. dependency-injected single instance — what's the difference?**

<details><summary>Answer</summary>

Both yield one instance; the Singleton *fetches itself* via a global accessor (hidden, untestable), while DI *constructs it once at the composition root and passes it in* (explicit, testable). Same instance count, opposite coupling.
</details>

**Q64. RAII / `defer` / `with` cure which anti-pattern, and how?**

<details><summary>Answer</summary>

Sequential Coupling — they bind teardown to scope so the required `close`/`unlock`/`commit` runs automatically on every exit path, removing the chance to violate the order.
</details>

**Q65. Why does Go forbid import cycles entirely?**

<details><summary>Answer</summary>

Because a cycle has no valid compilation or initialization order; rejecting it at compile time forces a clean acyclic dependency graph (and fast, parallel, incremental builds).
</details>

**Q66. What's the relationship between Action at a Distance and a data race?**

<details><summary>Answer</summary>

A data race is Action at a Distance under concurrency — the same "write here, surprise there" through shared mutable state, now with no ordering guarantee, producing corruption instead of just confusion.
</details>

**Q67. The single highest-leverage habit to avoid this whole category?**

<details><summary>Answer</summary>

Pass dependencies and state explicitly, and make them immutable when you can — it kills hidden dependencies, action at a distance, and most reasons to reach for a global.
</details>

---

## How to Talk About Anti-Patterns in Interviews

A few habits separate a strong answer from a textbook recital:

- **Lead with the *cost*, not the label.** Don't just say "that's a singleton." Say *why it hurts here* — "it's a hidden dependency, so this can't be unit-tested without a real DB, and any code can mutate it from afar." Interviewers want the reasoning, not the vocabulary.
- **Always name the trade-off.** The senior signal is acknowledging the other side: DI adds wiring overhead; some singletons are legitimate; you can't have zero coupling; immutability has copy costs. "It depends, and here's on what" beats absolutism.
- **Separate the instance from the access.** The sharpest distinction in this topic is "one instance" (sometimes correct) vs. "global hidden access" (usually wrong). Show you can keep the first while removing the second via injection.
- **Show you'd fix it *safely* and *incrementally*.** Mention characterization tests, keeping `getInstance()` as a delegating facade during migration, separating structural from behavioral commits, and a CI gate for import cycles. This proves production experience, not book knowledge.
- **Go deep when asked.** Lock contention, double-checked-locking safe publication, static initialization order, recompilation blast radius from cycles, and clock/env hidden inputs wrecking reproducibility — these show depth beyond the maintainability story.
- **Avoid purism.** "Singletons are always evil," "zero coupling," "everything immutable," "never any required order" are juniorisms. Calibrate: process-wide resources, appropriate coupling, mutable-but-owned state, and essential lifecycles encoded in types are all fine.
- **Use a concrete example.** "We had `Session.current` as a global; under load two requests corrupted each other's `uid`, and here's how we moved it to a per-request context" lands far harder than a definition.

---

## Summary

- The five coupling-and-state anti-patterns all stem from **dependencies and state that are real but invisible**: **Singletonitis** (global hidden access), **Circular Dependency** (cycles in the graph), **Action at a Distance** (mutation here, effect there), **Hidden Dependencies** (signature lies about needs), and **Sequential Coupling** (unenforced required order).
- Recognition is the junior bar; the middle bar is knowing *how each creeps in* and the countermove (inject, extract/invert, make explicit + immutable, encode order in types); the senior bar is *incremental migration off globals/cycles*, *organizational root causes*, and *when not to over-decouple*; the professional bar is the *concurrency, lock-contention, init-order, and build-cycle* consequences.
- The strongest answers **lead with cost**, **name trade-offs**, **separate "one instance" from "global access,"** demonstrate **safe incremental fixes** (delegating facades, characterization tests, CI cycle gates), and resist purism.
- Common curveballs hinge on the same insight: judge by **visibility, present-day value, and ownership of state** — singletons aren't always bad, zero coupling is impossible, required order is fine when *enforced*, and a hidden global is worse than an explicit parameter because it's dishonest, shared, and untestable.

---

## Related Topics

- [`junior.md`](junior.md) — recognize each shape and avoid creating it.
- [`middle.md`](middle.md) — when each creeps in and the everyday countermoves.
- [`senior.md`](senior.md) — migration at scale, root causes, and when not to over-decouple.
- [`professional.md`](professional.md) — locks, init order, build cycles, and concurrency implications.
- [`tasks.md`](tasks.md) · [`find-bug.md`](find-bug.md) · [`optimize.md`](optimize.md) — practice the diagnosis and redesign.
- [OO Misuse](../01-oo-misuse/README.md) — sibling design category (Object Orgy, Magic Container, the leaky-encapsulation neighbors).
- [Abstraction Failures](../03-abstraction-failures/README.md) — Premature Abstraction, the over-decoupling trap.
- [Clean Code → Classes](../../../clean-code/09-classes/README.md) — cohesion, SRP, and dependency direction.
- [Clean Code → Immutability](../../../clean-code/14-immutability/README.md) — the highest-leverage cure for Action at a Distance.
- [Design Patterns → Creational](../../../design-patterns/01-creational/README.md) — Builder and Factory, the structured cures for Singletonitis and Sequential Coupling.
- [Refactoring → Refactoring Techniques](../../../refactoring/02-refactoring-techniques/README.md) — Extract Class, Introduce Parameter, characterization tests.
