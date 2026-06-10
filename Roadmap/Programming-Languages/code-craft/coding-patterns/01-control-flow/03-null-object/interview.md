# Null Object — Interview Questions

> **Category:** [Control-Flow Patterns](../README.md) — return a do-nothing object that satisfies the expected interface instead of `null`.

---

## Junior Questions (10)

### J1. What is the Null Object pattern?

**Answer:** A real object that implements the expected interface with neutral, do-nothing behavior, returned **instead of `null`**. Callers invoke its methods without checking for `null`.

### J2. What problem does it solve?

**Answer:** Scattered `if (x != null)` checks and the `NullPointerException` they exist to prevent. Polymorphism replaces the conditional.

### J3. What does a Null Object return from its methods?

**Answer:** Neutral values — empty collection, `0`, `false`, `""` — or nothing (a no-op). It **never throws**.

### J4. Why is a Null Object usually a singleton?

**Answer:** It's stateless, so one immutable instance can be shared everywhere. Sharing also preserves `==`/identity comparisons.

### J5. Give a real-world Null Object.

**Answer:** `logging.NullHandler` (Python), `io.Discard` (Go), `Collections.emptyList()` (Java), a no-op metrics reporter, a `GuestUser`.

### J6. How does it differ from `null`?

**Answer:** `null` is the *absence* of an object; the Null Object is *an object that represents absence*. The Null Object moves the "what to do when nothing" logic from the caller into the object.

### J7. Where do you decide real-vs-null?

**Answer:** Once, at creation/lookup time — in a factory or repository — not at every call site.

### J8. What's a no-op method?

**Answer:** "No operation" — a method with an empty body that intentionally does nothing.

### J9. Is a Null Object a test double?

**Answer:** No. A Null Object is *production* behavior. A stub/mock is a *test* artifact. Naming them distinctly (`NullLogger` vs `FakeLogger`) avoids confusion.

### J10. Name a common mistake.

**Answer:** Returning `null` *sometimes* and a Null Object *other times* from the same method — now callers must check for both.

---

## Middle Questions (10)

### M1. When is Null Object the wrong choice?

**Answer:** When absence is an **error** the caller must handle — a missing payment gateway, a not-found user that needs a 404. Then use [Fail Fast](../02-fail-fast/junior.md) or `Optional`.

### M2. State the central trade-off in one sentence.

**Answer:** "When this thing is absent, is the correct behavior to *carry on doing nothing* (Null Object) or to *stop and shout* (Fail Fast)?"

### M3. How does Null Object differ from `Optional`/`Maybe`?

**Answer:** Opposite contracts. `Optional` makes absence **explicit in the type** and forces the caller to handle it. Null Object **hides** absence behind do-nothing behavior so the caller can ignore it.

### M4. What is the "silent failure" hazard?

**Answer:** A Null Object turns a missing thing into a *silent* thing. Fine for a disabled logger; catastrophic if a required dependency (payment, audit) is accidentally wired to its no-op variant — the system runs green while doing nothing.

### M5. How do you decide between Null Object and `Optional`?

**Answer:** If the caller must react to absence (branch, retry, 404) → `Optional`. If the caller should safely ignore absence → Null Object. The type should tell the caller the truth.

### M6. What's the "no honest neutral value" problem?

**Answer:** Some queries have no truthful neutral answer — `NullAccount.balance() == 0` lies (it means "no account," not "broke"). When no neutral value is honest, Null Object is wrong; use `Optional`/error.

### M7. How do you refactor toward a Null Object?

**Answer:** Define the Null Object with the neutral values the scattered checks already produced; funnel creation through one factory returning the Null Object; delete the `null` checks; audit each deleted check to ensure it wasn't handling a real error.

### M8. What's the relationship to Special Case?

**Answer:** Null Object is the **do-nothing subset** of [Special Case](../04-special-case/junior.md). Special Case generalizes to any recurring condition with *real* behavior (`SuspendedAccount`, `UnknownCustomer`).

### M9. How does Null Object help testing?

**Answer:** It's a zero-setup stand-in for optional collaborators (`new Service(repo, Logger.NULL)`), no mocking needed. But you must still cover the real wiring in integration tests.

### M10. Whose "billion-dollar mistake" does this relate to?

**Answer:** Tony Hoare's — inventing the `null` reference. Null Object is one of the patterns that lets a codebase avoid `null` entirely.

---

## Senior Questions (10)

### S1. How does Null Object act as an architectural boundary?

**Answer:** It resolves absence **once at the edge** (composition root, repository), so the entire domain core operates on non-null objects with no null checks. The decision lives in one place; the inner code stays branch-free.

### S2. Is Null Object a GoF pattern?

**Answer:** No — it was formalized later (Bobby Woolf, *PLoPD3*). It's **behavioral**: it replaces a conditional with polymorphism. It fills the neutral slot of Strategy, the empty case of Iterator/Composite, the no-op subscriber of Observer.

### S3. How do you prevent a Null Object from disabling a required dependency?

**Answer:** Don't *provide* a Null Object for ports whose silence is unacceptable. Force them at the composition root with [Fail Fast](../02-fail-fast/junior.md): `Objects.requireNonNull(gateway)`. Reserve Null Objects for genuinely optional collaborators.

### S4. When would you migrate Null Object → Optional?

**Answer:** When production incidents reveal the silence was a bug — the Null Object was masking a decision the caller needed to make. Switch the return type to `Optional`/`Result` to force handling.

### S5. Why is Null Object thread-safe by nature?

**Answer:** It's stateless and immutable, so a single shared instance can be used across threads with no synchronization. Adding hidden mutable state breaks both this and the pattern's contract.

### S6. How do Null Objects compose?

**Answer:** The neutral element of a composition is itself a Null Object: an empty Composite, a decorator over a Null Object, a no-op Strategy default. Providing the Null Object as the default makes "no plugins configured" a first-class branch-free state.

### S7. Distinguish "empty" from "absent."

**Answer:** A Null Object can't let the caller tell "found but empty" from "didn't exist." If that distinction matters downstream, don't use a Null Object — return `Optional`/`Result`.

### S8. What's the performance profile?

**Answer:** A performance *win*: zero per-call allocation (shared singleton), no call-site branch, and a no-op method inlines to zero instructions on monomorphic sites. The only cost is megamorphic dispatch if many impls share a call site.

### S9. How does Null Object interact with non-nullable type systems (Kotlin/Swift/Rust)?

**Answer:** Those compilers already force the absence decision (`T?`, `Option<T>`), so Null Object becomes a *style* choice for flat call sites rather than a safety mechanism. In Java/Go/Python it also buys NPE/nil/`AttributeError` safety.

### S10. When should you promote a Null Object to a Special Case?

**Answer:** When "do nothing" must become "do this specific thing" — a `SuspendedAccount` that rejects charges with a message, an `UnknownCustomer` that records the failed lookup. Promote deliberately; don't let a "Null" object quietly grow behavior.

---

## Professional Questions (10)

### P1. What does a no-op method compile to after JIT inlining?

**Answer:** On a monomorphic call site, the empty body is inlined and **eliminated — zero instructions** (the call vanishes, including side-effect-free argument evaluation). Bimorphic: both inlined behind a type guard. Megamorphic: falls back to itable dispatch with an empty frame.

### P2. Explain Go's nil-interface trap and how Null Object fixes it.

**Answer:** A `nil` *pointer* boxed into an interface is **not** a `nil` *interface* (type is set, value is nil), so `l == nil` is false and `l.Method()` panics. The Null Object fix: return a concrete no-op value (`nopLogger{}`), never a typed nil — its methods can't nil-panic.

### P3. Why are Go Null Objects essentially free?

**Answer:** They're empty structs — zero-size types. All ZST values share one address (`zerobase`); boxing into an interface allocates nothing; the empty methods inline. No heap, no GC pressure.

### P4. What's the cost of a `__getattr__` Null Object in Python?

**Answer:** Slower (every access misses the dict and triggers `__getattr__` + a bound-method allocation, ~3× a real method) and **dangerous** — it absorbs typos and undefined methods, killing the `AttributeError` that would catch bugs. Prefer an explicit class implementing the real interface.

### P5. Does Null Object eliminate the need for `if (log.isInfoEnabled())`?

**Answer:** It eliminates the *call* cost (the no-op inlines away) but **not** the cost of constructing the argument. `log.info("x=" + expensive())` still evaluates `expensive()`. Guard expensive message construction even with a Null Object.

### P6. How is the singleton safely published in each language?

**Answer:** Java: `static final` / interface constant — class-init guarantees safe publication, no `volatile` needed. Go: package-level `var` (ZST, no heap). Python: module-level instance, reference-counted for the module lifetime.

### P7. What's the throughput difference vs a null check?

**Answer:** Negligible — often the inlined Null Object slightly *wins* (no-op disappears; the null check is a real, if predictable, branch). Allocating a fresh Null Object per call is ~8× slower and breaks identity — the cardinal anti-pattern.

### P8. Name standard-library Null Objects.

**Answer:** `logging.NullHandler`, `io.Discard`, `OutputStream.nullOutputStream()` / `Stream.Null`, `Collections.emptyList()`, SLF4J `NOPLogger`, OpenTelemetry `noop.Tracer`.

### P9. Why does megamorphic dispatch hurt, and is it Null-Object-specific?

**Answer:** With >2 implementations at a call site, the JIT can't inline and uses vtable/itable dispatch (a cache miss + indirect jump). It's a property of polymorphism in general, not Null Object — the real implementations sharing that site pay it too.

### P10. How would you detect an accidental Null Object dependency in production?

**Answer:** Architecture tests asserting critical ports bind to real impls in prod profiles; a startup warning when a no-op variant is selected for a normally-required port; selective debug counters on the no-op path so "nothing happened" is observable.

---

## Trick Questions (5)

### T1. Is a Null Object the same as returning `null`?

**No.** It's the opposite — it exists *so you never return `null`*. `null` forces the caller to handle absence; the Null Object handles it for them.

### T2. Should a Null Object ever throw?

**No.** Throwing defeats the purpose — the caller would have to guard again. If "do nothing" isn't safe, you need [Fail Fast](../02-fail-fast/junior.md), not a Null Object.

### T3. Can a Null Object have behavior?

**Then it's not a Null Object** — it's a [Special Case](../04-special-case/junior.md). Null Object's behavior is, by definition, "nothing."

### T4. Is `Optional<NullObject>` a good idea?

**No** — it combines both strategies. You've made absence explicit (Optional) *and* hidden it (Null Object). Pick one.

### T5. In Go, can you use a `nil` interface as a Null Object?

**No** — calling a method on a `nil` interface (or a typed-nil-boxed interface) panics. You must return a real no-op value.

---

## Behavioral Questions (5)

### B1. Tell me about Null Object in production.

**Sample:** "We injected a `NopMetricsReporter` when telemetry was disabled in dev. Instrumentation code stayed unconditional — no `if (metrics != null)` anywhere — and ran identically in prod where a real reporter was wired."

### B2. Describe a time Null Object caused a bug.

**Sample:** "A config typo bound our audit sink to its no-op variant. The app was green for two weeks; we discovered during an audit that nothing was recorded. Fix: removed the Null Object for that required port and added `requireNonNull` plus an architecture test."

### B3. How do you decide Null Object vs Optional in code review?

**Sample:** "I ask: must the caller *react* to absence? If yes — branch, 404, retry — it's `Optional`. If the caller should safely ignore it, Null Object. I push back on Null Objects chosen just to avoid dealing with `Optional`."

### B4. How do you guard against silent failures from this pattern?

**Sample:** "Null Objects only for optional collaborators; required ports fail fast at wiring. Architecture tests assert prod bindings. And for sensitive no-op paths, a startup-time warning so an accidental no-op is discoverable."

### B5. How do you explain the pattern to a junior?

**Sample:** "Instead of returning `null` and making everyone check for it, return an object that's safe to call and does nothing useful. The `if` doesn't disappear — it moves once, to where you decide real-vs-null, and vanishes from every call site."

---

## Tips for Answering

1. **Lead with the contract:** "do-nothing object implementing the interface, returned instead of null."
2. **Name the central trade-off:** do nothing vs fail fast — interviewers want to see you know when *not* to use it.
3. **Contrast with `Optional`:** hides absence vs advertises it.
4. **Know the lineage:** behavioral pattern, do-nothing subset of Special Case.
5. **Mention real Null Objects:** `NullHandler`, `io.Discard`, `emptyList()`.

---

[← Professional](professional.md) · [Control Flow](../README.md) · [Coding Patterns](../../README.md) · **Next:** [Tasks](tasks.md)
