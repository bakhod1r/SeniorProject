# Synchronization Misuse Anti-Patterns — Interview Q&A

> **Category:** [Concurrency Anti-Patterns](../README.md) → **Synchronization Misuse** — *locks and memory primitives applied wrongly.*
> **Covers (collectively):** Double-Checked Locking · Volatile Misuse / Wrong Memory Ordering · Race-Prone Lazy Init

A bank of 60+ interview questions and answers on the three ways engineers misuse synchronization: trying to skip a lock with a flag check (Double-Checked Locking), treating `volatile`/`atomic` as if it gave mutual exclusion (Volatile Misuse), and the unguarded `if instance == nil { instance = new() }` (Race-Prone Lazy Init). Examples are in **Go** and **Java** with a **Python GIL** note. Each answer models the reasoning a strong candidate gives — including the trade-offs. Use the `<details>` toggles to self-quiz: read the question, answer out loud, then expand.

---

## Table of Contents

1. [Fundamentals / Junior](#fundamentals--junior)
2. [Intermediate / Middle](#intermediate--middle)
3. [Senior — Memory Models, Why DCL Broke, Auditing](#senior--memory-models-why-dcl-broke-auditing)
4. [Professional / Deep — Fences, Cache Coherence, CAS, Lock Cost](#professional--deep--fences-cache-coherence-cas-lock-cost)
5. [Code-Reading — Diagnose the Race](#code-reading--diagnose-the-race)
6. [Curveballs](#curveballs)
7. [Rapid-Fire / One-Liners](#rapid-fire--one-liners)
8. [How to Talk About Concurrency in Interviews](#how-to-talk-about-concurrency-in-interviews)
9. [Summary](#summary)
10. [Related Topics](#related-topics)

---

## Fundamentals / Junior

> Definitions, recognition, and the "why is it broken" reasoning.

**Q1. Name the three synchronization-misuse anti-patterns and give a one-line symptom for each.**

<details><summary>Answer</summary>

- **Double-Checked Locking (DCL)** — check a flag, take a lock only if it looks unset, check again inside the lock; done without correct memory ordering, a second thread can see a *non-nil but half-constructed* object.
- **Volatile Misuse / Wrong Memory Ordering** — `volatile`/`atomic` used as if it provided mutual exclusion, so compound operations like `count++` still race.
- **Race-Prone Lazy Init** — `if instance == nil { instance = new() }` with no synchronization; two threads both observe `nil`, both construct, and one instance (and its side effects) is silently lost.

The common thread: each is an attempt to coordinate access to shared state *more cheaply than a lock allows*, and each gets the memory semantics wrong.
</details>

**Q2. What is the difference between a *race condition* and a *data race*?**

<details><summary>Answer</summary>

A **data race** is a precise, language-defined thing: two threads access the same memory location concurrently, at least one access is a write, and there is no happens-before ordering (no lock, atomic, or channel) between them. In Go and Java this is **undefined behavior** — the compiler and CPU may legally tear, reorder, or cache the value. A **race condition** is broader: a *correctness* bug where the result depends on timing/interleaving, even if every individual access is properly synchronized. Example: two threads each do `lock; balance = balance - 10; unlock` on a balance of 15 — no data race (every access is locked), but a race condition (both may proceed and overdraw if the check is separate from the decrement). Rule of thumb: **data race = a memory-model violation the race detector can catch; race condition = a logic bug about ordering the detector usually cannot.**
</details>

**Q3. What does `volatile` (Java) actually guarantee, and what does it *not*?**

<details><summary>Answer</summary>

`volatile` guarantees **visibility** and **ordering** of a single variable: a write is immediately visible to other threads (no caching in a register), and reads/writes are not reordered across the volatile access (it establishes happens-before). What it does **not** give you is **atomicity of compound operations**. `volatile int count; count++` is still three steps — read, add, write — and two threads can interleave them, losing an increment. So `volatile` makes a flag safe to publish and observe, but it never replaces a lock when you need read-modify-write to be indivisible.
</details>

**Q4. Go has no `volatile` keyword. What's the equivalent, and what's the rule?**

<details><summary>Answer</summary>

Go deliberately omits `volatile`. The rule from the Go Memory Model is blunt: if more than one goroutine accesses a variable and at least one writes, you **must** synchronize, using either a channel, a `sync` primitive (`Mutex`, `RWMutex`, `Once`, `WaitGroup`), or the `sync/atomic` package. There is no "just make it visible" middle ground. `sync/atomic` (and the typed `atomic.Int64`, `atomic.Pointer[T]`, etc. added in Go 1.19) is the closest analogue to `volatile` — it gives an atomic, ordered single-word access — but you reach for it only for genuinely independent single-word operations, not as a substitute for a mutex.
</details>

**Q5. What is lazy initialization, and why does the naive version race?**

<details><summary>Answer</summary>

Lazy initialization defers creating an expensive object until first use:

```go
var instance *Config
func Get() *Config {
    if instance == nil {           // (1) check
        instance = loadConfig()    // (2) create + assign
    }
    return instance
}
```

It races because steps (1) and (2) are not atomic and there is no happens-before edge between goroutines. Two goroutines can both run (1), both see `nil`, both run (2), and you get two `Config` objects — one is discarded, but any side effect it triggered (opened a file, registered a handler) already happened. Worse, even the *winner*'s write may be invisible or partially visible to the other goroutine, so a caller can read a non-nil pointer to an object whose fields aren't populated yet. The naive lazy init is a data race *and* a race condition.
</details>

**Q6. What is Double-Checked Locking, and what problem was it trying to solve?**

<details><summary>Answer</summary>

DCL tries to make lazy init cheap by avoiding the lock on the common path:

```java
if (instance == null) {              // 1st check, no lock
    synchronized (lock) {
        if (instance == null) {      // 2nd check, under lock
            instance = new Config();
        }
    }
}
return instance;
```

The motivation: taking a lock on *every* `Get()` is wasteful once the object exists, so check first without the lock, and only lock to construct it the first time. The idea is sound; the classic implementation (without `volatile`) is **broken**, because the publishing write `instance = new Config()` can be observed as "pointer set" before "constructor finished," so the first, lock-free check can return a half-built object.
</details>

**Q7. Why is taking a lock "every time" considered a cost worth avoiding here?**

<details><summary>Answer</summary>

An uncontended lock is cheap but not free — it's an atomic compare-and-swap plus memory fences, and it can block compiler optimizations and inlining around it. Under contention it's far worse: threads serialize, and a hot `Get()` called millions of times on a singleton becomes a scalability bottleneck. DCL exists to pay that cost *once* (at construction) instead of forever. That said, on modern hardware and runtimes the savings are often negligible, which is exactly why the modern advice is "don't hand-roll DCL; use `sync.Once` / the holder idiom" — they give you the fast path safely.
</details>

**Q8. What is "memory visibility" and why is it surprising to newcomers?**

<details><summary>Answer</summary>

Memory visibility is the question of *when* one thread's write to a variable becomes observable to another. Newcomers assume that once thread A writes `x = 1`, thread B reading `x` sees `1` immediately — as if there were one shared memory. In reality each core has its own caches and store buffers, the compiler may keep a value in a register, and both compiler and CPU may **reorder** independent operations for speed. So without a synchronization edge, B may see a stale value indefinitely, or see writes in a different order than A issued them. Synchronization primitives exist precisely to force visibility and ordering at defined points.
</details>

**Q9. Does Python's GIL make locks unnecessary? (curveball)**

<details><summary>Answer</summary>

**No.** The Global Interpreter Lock guarantees that only one thread executes Python bytecode at a time, which prevents low-level *data races* on interpreter internals and makes a single bytecode op effectively atomic. But your operations are rarely a single bytecode. `count += 1` compiles to `LOAD`, `INC`, `STORE` — multiple bytecodes — and the GIL can be released between them (every few milliseconds or on I/O), so two threads still lose increments. You need `threading.Lock` for compound operations and check-then-act sequences. Two further caveats: the GIL never protected *logic* race conditions, and the trend toward free-threaded / no-GIL CPython (PEP 703) means even the accidental protection is going away. Treat the GIL as an implementation detail, not a concurrency model.
</details>

**Q10. Does marking a variable `volatile` (Java) or using `atomic` (Go) make `count++` thread-safe? (curveball)**

<details><summary>Answer</summary>

**No — `volatile`/plain-atomic visibility does not make `count++` safe.** `count++` is read-modify-write, three steps, and `volatile` only makes each *individual* read and write visible and ordered; two threads can still interleave the three steps and lose an update. The fix is to make the whole operation atomic: in Java use `AtomicInteger.incrementAndGet()` (a single atomic RMW) or a lock; in Go use `atomic.AddInt64(&count, 1)` or `atomic.Int64.Add(1)`. The distinction to state in an interview: **`volatile`/atomic-load-store buys visibility; only an atomic RMW (or a lock) buys indivisibility.**
</details>

**Q11. What's the simplest *correct* way to do lazy init in Go and in Java?**

<details><summary>Answer</summary>

**Go:** `sync.Once` — it runs the function exactly once and establishes happens-before so every later caller sees the fully constructed value.

```go
var (
    once     sync.Once
    instance *Config
)
func Get() *Config {
    once.Do(func() { instance = loadConfig() })
    return instance
}
```

**Java:** the **initialization-on-demand holder idiom**, which leans on the JVM's guaranteed-safe class initialization:

```java
class Cfg {
    private static class Holder { static final Config INSTANCE = new Config(); }
    static Config get() { return Holder.INSTANCE; }
}
```

The `Holder` class isn't loaded until `get()` is first called, and the JVM serializes class init with correct memory semantics — so it's lazy, thread-safe, and lock-free on the hot path, with no `volatile` and no DCL to get wrong.
</details>

**Q12. Why are these bugs so hard to reproduce?**

<details><summary>Answer</summary>

They are timing- and hardware-dependent. The bad interleaving might occur once in millions of runs, only under specific load, only on a particular CPU architecture (x86's strong memory model hides reorderings that ARM exposes), and only in an optimized build (the compiler reorders more aggressively than `-O0`). Adding a log line or attaching a debugger changes the timing and often makes the bug "disappear" (a Heisenbug). That's why you don't chase these by reproduction; you find them with **race detectors** (`go test -race`, Java's tooling / `jcstress`), reason about happens-before, and design the synchronization to be correct by construction.
</details>

---

## Intermediate / Middle

> Happens-before, choosing primitives, and the safe lazy-init idioms.

**Q13. Explain happens-before. Why is it the central concept for all three anti-patterns?**

<details><summary>Answer</summary>

Happens-before is a partial order the language defines over memory operations: if action A happens-before action B, then A's effects are guaranteed visible to B and not reordered after it. Synchronization is just the mechanism that *creates* these edges — unlocking a mutex happens-before the next lock of it; a channel send happens-before the corresponding receive; `once.Do`'s function happens-before any later `Do` return; a volatile/atomic write happens-before a subsequent read of the same variable. All three anti-patterns are failures to establish a happens-before edge: naive lazy init has none between the writer and reader; broken DCL's lock-free read isn't ordered after the construction; volatile misuse assumes an edge that doesn't cover the compound operation. **If you can't draw the happens-before arrow from the write to the read, it's a data race.**
</details>

**Q14. How do you choose between a mutex and an atomic?**

<details><summary>Answer</summary>

Use an **atomic** only when the shared state is a single word and every operation on it is independent and self-contained — a counter, a flag, a single pointer swap. Use a **mutex** the moment you have either (a) multiple variables that must change together to stay consistent, or (b) a check-then-act / read-modify-then-act sequence that must be indivisible as a whole. The trap is "atomic creep": people chain several atomics (`atomic.Load` then `atomic.Store`) believing the *sequence* is atomic — it isn't; another thread can interleave between them. If correctness depends on more than one atomic operation happening together, you needed a lock.
</details>

**Q15. Show the *correct* DCL in modern Java and modern Go. What's the one keyword/type that makes it work?**

<details><summary>Answer</summary>

**Java** — the field must be `volatile`:

```java
private static volatile Config instance;
static Config get() {
    Config local = instance;          // read volatile once
    if (local == null) {
        synchronized (Lock.class) {
            local = instance;
            if (local == null) {
                instance = local = new Config();
            }
        }
    }
    return local;
}
```

`volatile` (since the JSR-133 memory model fix in Java 5) forbids the reordering that let the lock-free read see a half-built object, and establishes happens-before from the constructing write to the lock-free read.

**Go** — use an atomic pointer:

```go
var instance atomic.Pointer[Config]
var mu sync.Mutex
func Get() *Config {
    if c := instance.Load(); c != nil { return c }
    mu.Lock(); defer mu.Unlock()
    if c := instance.Load(); c != nil { return c }
    c := loadConfig()
    instance.Store(c)
    return c
}
```

But the senior answer is: in both languages, **don't write this** — prefer `sync.Once` (Go) or the holder idiom (Java). They're correct, shorter, and impossible to get subtly wrong.
</details>

**Q16. Why is the holder idiom often better than even a correct DCL?**

<details><summary>Answer</summary>

Because it delegates the hard part — safe, lazy, one-time publication — to the JVM's class-initialization guarantee, which the spec defines to be thread-safe and to establish happens-before for the initialized statics. There's no `volatile` to forget, no double check to mis-order, no lock to reason about. It's lazy (the holder class loads on first `get()`), lock-free on every call after init, and the code reads as obviously correct. Correct DCL works, but it's a footgun you keep in the codebase; the holder idiom removes the footgun. The only thing it can't do is take a runtime parameter to construct with — for that you fall back to `sync.Once`-style code.
</details>

**Q17. When *is* a plain atomic flag the right tool (not a misuse)?**

<details><summary>Answer</summary>

When the flag is genuinely independent and you only need visibility/ordering of that one word — for example a one-way `shutdown` or `ready` signal: one goroutine sets `done.Store(true)`, others poll `done.Load()` to stop. There's no compound operation, no invariant spanning multiple variables, so an `atomic.Bool` is exactly right and cheaper than a mutex. The misuse begins when the flag *gates* a second piece of state and you assume setting the flag also safely publishes that state without an ordering guarantee — that's where you need the atomic to carry the publication (release/acquire) or a lock.
</details>

**Q18. How does the race detector work, and what are its limits?**

<details><summary>Answer</summary>

Go's `-race` (and ThreadSanitizer underneath, also used for C/C++/Java tooling) instruments memory accesses at runtime and tracks a happens-before relation via vector clocks. When it sees two accesses to the same location, at least one a write, with no happens-before edge between them, it reports a data race with both stacks. Its power is that it finds *real* races that did occur in the run, with no false positives. Its limit is that it only sees interleavings that **actually happened during execution** — if your test never triggers the bad timing, it reports nothing. So you run it under realistic load and concurrency, and treat a clean run as "no race observed," not "proven race-free." It also adds ~5–10× CPU and memory overhead, so it's a test/CI tool, not a production one.
</details>

**Q19. A teammate replaced a `sync.Mutex` with two `atomic.Int64`s "for speed." What do you check?**

<details><summary>Answer</summary>

Whether the two counters ever need to be consistent *with each other*. If code reads counter A and counter B and assumes they reflect the same moment (e.g. `processed` and `failed` summing to `total`), the atomic version has a race condition: another thread can update B between your reads of A and B, so you observe an impossible combined state. A single mutex made the *pair* update and the *pair* read atomic; two independent atomics do not. If the counters are truly independent (each consumed alone), the change is fine and faster; if any invariant spans both, the mutex was load-bearing and must stay (or be replaced by one atomic struct pointer swap).
</details>

**Q20. What's the difference between `sync.Once` and a `volatile`-guarded boolean flag?**

<details><summary>Answer</summary>

`sync.Once` guarantees three things together: the function runs **exactly once** even under concurrent first calls, all callers **block** until that run completes, and the function's writes **happen-before** every `Do` return (safe publication). A `volatile`/atomic boolean flag only gives you visibility of the flag; the classic `if !done { init(); done = true }` around it is itself a race-prone lazy init — two threads can both see `done == false` and both run `init()`. So the flag tells you *whether* something happened but doesn't make the "check, then do once, then publish" sequence atomic. `Once` packages all of that correctly; the flag is the raw ingredient people assemble incorrectly.
</details>

**Q21. Is double-checked locking ever correct? (curveball)**

<details><summary>Answer</summary>

**Yes — DCL is correct in modern memory models *if* the published field is `volatile` (Java 5+) or an atomic pointer (Go, C++ `std::atomic`), which supplies the missing acquire/release ordering.** It was famously broken in pre-JSR-133 Java because the old memory model permitted the publishing write to be reordered so the lock-free read saw a non-null but unconstructed object. With `volatile`/atomic the reordering is forbidden and DCL is safe. The nuance an interviewer wants: "correct but not recommended." Prefer `sync.Once` or the holder idiom — they're as fast, can't be mis-ordered, and don't require the reader to know the memory model. Reach for hand-rolled DCL only when you've measured that the alternative's overhead matters, which is rare.
</details>

**Q22. How would you fix the naive lazy init in Q5 in Go, and explain why it now publishes safely?**

<details><summary>Answer</summary>

```go
var (
    once     sync.Once
    instance *Config
)
func Get() *Config {
    once.Do(func() { instance = loadConfig() })
    return instance
}
```

`once.Do` does three things that close the race: it serializes the first concurrent callers so `loadConfig()` runs exactly once; it makes later callers wait until that run finishes; and the Go Memory Model specifies that the completion of the `Do` function **happens-before** the return of any `Do` call. That last point is the key — it guarantees the fully-initialized `*Config` (all its fields) is visible to every goroutine that calls `Get()` afterward, not just the pointer write. No partial-construction window, no lost instance.
</details>

**Q23. What's "safe publication" and why does it matter for all three patterns?**

<details><summary>Answer</summary>

Safe publication means making a newly-constructed object visible to other threads such that they observe it *fully constructed* — every field write that happened during construction is visible, not just the reference assignment. It matters because the bug in broken DCL and naive lazy init isn't only "two objects created"; it's that a thread can get a reference to an object whose constructor hasn't finished from that thread's point of view, then read default/garbage field values. You achieve safe publication through a happens-before edge: a `volatile`/atomic write, a lock release/acquire, `sync.Once`, static initializer, or passing through a channel. The mental model: **publishing a pointer is not the same as publishing the object behind it.**
</details>

**Q24. Why might eager initialization be the right answer instead of any lazy idiom?**

<details><summary>Answer</summary>

Because the cheapest concurrency bug to fix is the one you don't introduce. If the object is cheap to build and used early anyway, just construct it at package/class load time (`var instance = newConfig()` in Go, a `static final` field in Java) — initialization is single-threaded before any concurrent access, so there's no race, no lock, no idiom to audit. You choose lazy only when construction is genuinely expensive *and* may never be needed, or depends on runtime input. The trade-off: eager pays the construction cost (and any startup latency / failure-at-startup) unconditionally; lazy defers it but adds synchronization surface. Default to eager; reach for lazy with intent.
</details>

**Q25. What signal in code review flags each of the three anti-patterns?**

<details><summary>Answer</summary>

- **Race-Prone Lazy Init:** `if x == nil { x = ... }` (or `if not x:`) on a shared variable with no lock, `Once`, or atomic in sight.
- **Broken DCL:** a double `if (instance == null)` with a `synchronized`/`Lock` between them — then check whether the field is `volatile`/atomic; if not, it's broken.
- **Volatile Misuse:** a `volatile`/`atomic` field that appears in a compound expression (`v++`, `if (flag) { use(otherState) }`, two atomics read together) where atomicity of the *combination* is assumed.

The cheap defense is to ask "draw me the happens-before edge between the write and the read." If they can't, the synchronization is wrong.
</details>

---

## Senior — Memory Models, Why DCL Broke, Auditing

> The JMM and Go memory model, the historical failure, and how to audit a concurrent codebase.

**Q26. Explain precisely why pre-Java-5 DCL was broken, at the memory-model level.**

<details><summary>Answer</summary>

`instance = new Config()` is not one operation. The JIT/CPU may implement it as: (1) allocate memory, (2) write the *reference* into `instance`, (3) run the constructor that populates fields. Steps (2) and (3) can be reordered (publishing the pointer before construction completes) because, from the writing thread's single-threaded view, the result is identical. Under the old (pre-JSR-133) memory model, another thread doing the **lock-free** first check could then read a non-null `instance` (step 2 done) but see un-initialized fields (step 3 not yet visible) — returning a half-built object. The JSR-133 model (Java 5) fixed this by giving `volatile` writes release semantics and `volatile` reads acquire semantics, which forbid that reorder/visibility and establish happens-before from the construction to the lock-free read.
</details>

**Q27. Compare the Java Memory Model and the Go Memory Model on the points that matter here.**

<details><summary>Answer</summary>

Both are happens-before models, but they make different bets. The **JMM** gives non-trivial *intra-thread* guarantees and a rich set of ordered actions (`volatile`, `final` field freeze, locks, `Thread.start`/`join`), and crucially defines benign-ish behavior for some races (no "out of thin air" values). The **Go memory model** is intentionally minimal and almost punitive: a program with a data race has **undefined behavior** for the racing accesses (sequenced however the implementation likes), and the model just enumerates the edges (channel send/receive, `Mutex`, `Once`, `atomic`, `WaitGroup`). Go's philosophy is "don't race; if you must share, synchronize" — channels first. Java's is "races are still bad, but here's a precisely specified model so libraries and the runtime can be built safely." For both: `volatile`/atomic gives ordering for one variable; only locks/channels coordinate multiple.
</details>

**Q28. What are acquire and release semantics, and how do they map to these idioms?**

<details><summary>Answer</summary>

A **release** store ensures that all memory writes *before* it in program order are visible to any thread that performs a matching **acquire** load of the same location and sees that store. So release/acquire forms the happens-before edge across threads. Map: unlocking a mutex is a release, locking it is an acquire; a Java `volatile` write is a release and a `volatile` read is an acquire; a Go `atomic.Store`/`Load` pair behaves as release/acquire; a channel send is a release paired with the receive's acquire. Correct DCL works because the `volatile`/atomic write of `instance` (release) publishes the constructor's field writes to the lock-free reader's load (acquire). The looser alternative — relaxed atomics (C++ `memory_order_relaxed`, Go has no relaxed API) — gives atomicity *without* this ordering, which is exactly the trap.
</details>

**Q29. You inherit a service with intermittent "field is null but shouldn't be" crashes under load. How do you audit for synchronization misuse?**

<details><summary>Answer</summary>

(1) **Run the race detector** under realistic concurrency — `go test -race` on the hot paths, or ThreadSanitizer / `jcstress` for Java — since most of these surface as data races. (2) **Grep for the shapes:** unguarded `if x == nil { x = }`, double `if ==null` blocks, `volatile`/`atomic` fields used in compound expressions, lazy singletons. (3) **Map shared state:** list every package-level/instance variable touched by more than one goroutine/thread and confirm each has a happens-before edge (lock, channel, `Once`, atomic) on every access — a single unsynchronized access poisons all the others. (4) **Look for "atomic creep"** — sequences of atomics assumed to be jointly atomic. (5) **Reproduce under stress** with many goroutines + GOMAXPROCS high, on ARM if possible (weaker ordering exposes bugs x86 hides). Fix by establishing the missing edge or switching to a correct idiom (`Once`/holder), not by adding sleeps.
</details>

**Q30. Why can a bug be invisible on x86 but crash on ARM (or Apple Silicon)?**

<details><summary>Answer</summary>

Because hardware memory models differ in how aggressively they allow reordering. x86 is **strongly ordered** (TSO — total store order): it forbids most reorderings except store-load, so a lot of under-synchronized code *happens* to work there. ARM and POWER are **weakly ordered**: they permit loads and stores to be reordered far more freely, so a missing fence that x86 tolerated becomes a visible bug. This is why "it worked for years on our Intel servers" then crashed when the team moved to Graviton/ARM or M-series Macs. The lesson: never use "it works on my machine's architecture" as evidence of correctness — correctness is defined by the *language* memory model, which must hold on the weakest hardware, and the compiler inserts fences accordingly only when you use real synchronization.
</details>

**Q31. How does the compiler — not just the CPU — break naive synchronization?**

<details><summary>Answer</summary>

The compiler reorders and elides under the as-if rule: it may keep a variable in a register (so a spin loop `for !done {}` never re-reads memory and loops forever after the writer sets `done`), hoist a load out of a loop, reorder independent stores, or eliminate a write it thinks is dead. From a single thread's perspective the program is unchanged, which is all the compiler is required to preserve. These transformations are exactly why `volatile`/atomic exists: they tell the compiler "this access is observable by other threads, don't cache/reorder/elide it." So both compiler *and* CPU must be constrained, and a single language-level synchronization primitive emits the right barriers for both. Adding a `time.Sleep` or a print "fixes" it only by accident, by perturbing one of the two layers.
</details>

**Q32. When auditing, how do you tell a *benign* data race from a dangerous one — and is "benign data race" a real category?**

<details><summary>Answer</summary>

In Go and Java the honest answer is **there is no benign data race**: the memory model says racing accesses are undefined, so even a "harmless-looking" racing read of an `int` can legally tear (on platforms without atomic word access) or be optimized into an infinite loop or a torn pointer. Code that looks like a benign race (e.g. racy lazy init of an immutable value where re-creation is acceptable) is still UB and the detector will rightly flag it; the correct move is to make the access atomic, which is cheap. The phrase "benign data race" is a historical C/C++ folk concept that modern memory models reject. The senior framing: don't classify races as benign — classify them as *cheap to fix* and fix them, because the cost of being wrong is a non-deterministic production crash you can't reproduce.
</details>

**Q33. How do `final` fields (Java) and immutability help you sidestep this whole category?**

<details><summary>Answer</summary>

A correctly constructed object whose fields are all `final` is **safely published even through a data race** — the JMM's final-field freeze guarantees that any thread seeing the reference sees the final fields fully initialized, *without* needing `volatile` or a lock on the reference. More broadly, immutable objects have no writes after construction, so there's nothing to race on; you can share them freely, and lazy init of an immutable value is at worst "we built it twice and threw one away," not "we observed a half-built object." This is the deepest cure in the README's framing: eliminate shared *mutability*, and most of the synchronization-misuse category evaporates. In Go, the analogue is constructing a value fully then publishing the pointer via an atomic/channel and never mutating it again. See [`clean-code/14-immutability`](../../../clean-code/14-immutability/README.md).
</details>

**Q34. A singleton's `loadConfig()` can fail. How does that change your idiom choice?**

<details><summary>Answer</summary>

It exposes a real weakness of `sync.Once`: `Once` considers the slot "done" the moment the function returns, even if it set a global error — and it never re-runs, so a transient failure poisons the singleton forever. If construction can fail and you want to retry, `Once` is the wrong tool; you need either explicit locking with a check that re-attempts on the next call, or a `Once`-with-error variant (`sync.OnceValue`/`OnceValues` in Go 1.21 capture the result/err once; for retry you hand-roll a mutex). In Java, the holder idiom throws `ExceptionInInitializerError` on init failure and the class stays unusable, so a fallible constructor argues for explicit synchronized lazy init too. The senior point: pick the idiom by the *failure semantics* you need (retry vs. fail-once), not just by "lazy and fast."
</details>

**Q35. What's the cost of using a `RWMutex` to protect a lazily-initialized read-mostly value, versus an atomic pointer?**

<details><summary>Answer</summary>

An `RWMutex` lets many readers proceed concurrently but each read still does atomic bookkeeping (incrementing a reader count) and crosses memory barriers, and the writer count cache line bounces between cores under high read rates — so on a hot read path it can be *slower* than expected and even slower than a plain `Mutex` at low contention. An `atomic.Pointer[T]` load on the read path is close to free: a single atomic load, no reader bookkeeping, no blocking. For a read-mostly, swap-rarely value (config, routing table), the idiom is "build a new immutable snapshot, `atomic` swap the pointer; readers `Load` it" — lock-free reads, occasional copy-on-write. Reserve `RWMutex` for when readers must hold the lock across a multi-step read that can't be captured in a single immutable snapshot.
</details>

**Q36. How do you write a test that actually exercises these races?**

<details><summary>Answer</summary>

You can't deterministically force an interleaving, so you do two things. First, **stress it under the race detector**: spawn many goroutines/threads (≥ GOMAXPROCS, often hundreds) that hammer the lazy `Get()` simultaneously, run under `-race`, and loop the test (`go test -race -count=100 -cpu=8`). The detector reports the happens-before violation even if no crash occurs. Second, for memory-ordering subtleties Java has **`jcstress`**, a harness that runs billions of iterations across cores and records the *forbidden* observed states, turning "rare interleaving" into statistical certainty. The key mindset shift from sequential testing: you're not asserting an output, you're maximizing the chance the bad schedule occurs *and* arming a tool that detects the violation regardless of whether it manifested as wrong output this run.
</details>

---

## Professional / Deep — Fences, Cache Coherence, CAS, Lock Cost

> Hardware ordering, the mechanics of atomics and locks, and where they cost.

**Q37. What is a memory fence (barrier), and what does the compiler emit for a `volatile` write / `atomic.Store`?**

<details><summary>Answer</summary>

A memory fence is a CPU instruction (or compiler directive) that constrains the ordering of memory operations around it — e.g. a StoreStore barrier prevents earlier stores from being reordered after later ones; a full fence (`mfence` on x86, `dmb ish` on ARM) orders everything. A release store (Java `volatile` write, Go `atomic.Store`) emits the barriers needed so that all prior writes complete and become visible before the store itself is observed; an acquire load does the symmetric thing for subsequent reads. On x86, because of its strong TSO model, a `volatile`/atomic store often compiles to a `mov` plus a locked instruction or `mfence` only where store-load ordering matters, while a load is nearly free; on ARM the compiler must insert explicit `dmb`/`ldar`/`stlr` instructions. The point: the language primitive abstracts "emit the correct fences for *this* target," which is exactly what hand-rolled flag code fails to do.
</details>

**Q38. Explain cache coherence (MESI) and how it relates to contention cost.**

<details><summary>Answer</summary>

MESI is the protocol that keeps per-core caches consistent: each cache line is in Modified, Exclusive, Shared, or Invalid state. When one core writes a line, it must gain exclusive ownership, which **invalidates** every other core's copy; those cores then take a coherence miss (and an inter-core message) on their next access. This is why a contended atomic counter or lock is expensive even though the "work" is tiny: the cache line holding it ping-pongs between cores ("cache-line bouncing"), each transfer costing tens to hundreds of cycles. It's also the mechanism behind **false sharing** — two unrelated variables on the same 64-byte line cause coherence traffic even with no logical sharing. So lock/atomic cost is dominated not by the instruction but by the coherence traffic on the line it touches.
</details>

**Q39. What is false sharing and how do you fix it?**

<details><summary>Answer</summary>

False sharing is when two threads update *different* variables that happen to live on the **same cache line**; the coherence protocol invalidates the whole line on each write, so the threads slow each other down as if they shared the variable — pure overhead with no logical contention. Classic case: an array of per-thread counters packed tightly. The fix is **padding/alignment**: separate the hot variables onto different cache lines (64 bytes on most x86/ARM). In Java, `@Contended` (with `-XX:-RestrictContended`) or manual long-field padding; in Go, pad structs with a `[64]byte` filler or align to cache-line size; in C/C++, `alignas(64)`. You diagnose it with a profiler (high cache-miss / coherence stall on a hot line) — the symptom is "scaling gets *worse* with more cores," which is the tell.
</details>

**Q40. How does compare-and-swap (CAS) work, and what is the ABA problem?**

<details><summary>Answer</summary>

CAS is a single atomic instruction (`CMPXCHG` on x86, `LDREX/STREX` or `CAS` on ARM) that says "if this location still holds `old`, set it to `new` and report success; otherwise report failure." It's the foundation of lock-free algorithms and of mutex fast paths: you read a value, compute a new one, and CAS it in, retrying in a loop if someone changed it meanwhile. The **ABA problem**: a CAS only checks the value, not whether it changed-and-changed-back. Thread A reads `A`, stalls; thread B changes it `A→B→A`; thread A's CAS succeeds because it sees `A`, unaware the state churned (e.g. a freed-and-reused pointer), corrupting a lock-free stack. Fixes: a tagged/versioned pointer (CAS the (pointer, counter) pair so the counter changes even if the pointer repeats), hazard pointers, or epoch/GC-based reclamation. Go's `atomic.CompareAndSwap*` and Java's `AtomicReference.compareAndSet` expose CAS directly.
</details>

**Q41. Roughly what does an uncontended lock cost versus a contended one, and why does it matter for DCL?**

<details><summary>Answer</summary>

An **uncontended** lock is cheap — on the order of tens of nanoseconds — typically a single successful CAS on the lock word plus the associated fences, often staying in the fast path without a syscall (futex/biased paths). A **contended** lock is orders of magnitude worse: the CAS fails, threads spin briefly then **park** (a kernel syscall ~µs), the cache line bounces, and worst case you get convoying/lock-stealing pathologies. This is the whole economic case for DCL: it converts "lock on every call" into "lock once at construction," so on a singleton read a million times a second the savings could matter. But because the uncontended fast path is already so cheap, and `atomic.Load`/`volatile read` on the correct idioms is essentially free, the realistic gain over `sync.Once`/holder is usually negligible — which is why "measure before hand-rolling DCL" is the professional stance.
</details>

**Q42. Distinguish atomicity, visibility, and ordering precisely.**

<details><summary>Answer</summary>

- **Atomicity:** an operation is indivisible — no other thread can observe it half-done (a torn write, or an interrupted read-modify-write). `count++` lacks it; `atomic.Add` has it.
- **Visibility:** when one thread's write becomes observable to another — without an edge it may never be (cached in a register / store buffer).
- **Ordering:** whether operations appear to happen in program order to other threads — compilers and CPUs reorder absent constraints.

The three are independent: a `volatile`/atomic *load/store* gives visibility + ordering for one word but **not** atomicity of a compound op; a non-atomic 64-bit write on a 32-bit platform can tear (atomicity fail) even if visible. Most synchronization-misuse bugs come from conflating them — "I made it `volatile`, so `++` is safe" confuses visibility for atomicity; "two atomics, so the pair is consistent" confuses per-op atomicity for joint ordering.
</details>

**Q43. What's the difference between a lock-free, wait-free, and obstruction-free algorithm, and why prefer a lock sometimes?**

<details><summary>Answer</summary>

These are progress guarantees. **Lock-free:** the system as a whole always makes progress (some thread completes in a bounded number of steps), so no deadlock, but an individual thread can starve. **Wait-free:** *every* thread completes in a bounded number of its own steps — the strongest guarantee, hardest to implement. **Obstruction-free:** a thread completes if it runs in isolation (others paused) — the weakest. Lock-free structures avoid deadlock and priority inversion and tolerate thread death mid-operation, but they're notoriously hard to get right (ABA, memory reclamation), often have worse *average* throughput than a good mutex under moderate contention, and can spin-burn CPU under heavy contention. The professional default: use a mutex (simple, correct, fine for most contention), and reach for lock-free only on a proven hot path where you've measured the lock as the bottleneck and can afford the complexity.
</details>

**Q44. Why is `sync.Once` so cheap on the fast path, mechanically?**

<details><summary>Answer</summary>

Because after the first call, `Once.Do` short-circuits on a single atomic load of its `done` word and returns — no lock, no CAS, no contention on the steady-state path. Internally it keeps a `done uint32` checked with `atomic.LoadUint32` (an acquire load) before touching the mutex; only the very first racing callers fall into the slow path that takes the internal `Mutex`, runs the function, and `atomic.StoreUint32(&done, 1)` (a release store) to publish. That release/acquire pair is exactly the happens-before edge that safely publishes the initialized value. So `Once` *is* a correctly-implemented double-checked lock provided by the standard library — which is the cleanest argument for not writing your own.
</details>

---

## Code-Reading — Diagnose the Race

> You're shown a snippet; name the anti-pattern and state the fix.

**Q45. Diagnose and fix.**

```go
var cache map[string]int
func Get(k string) int {
    if cache == nil {
        cache = make(map[string]int) // lazy init
    }
    return cache[k]
}
```

<details><summary>Answer</summary>

**Race-Prone Lazy Init** (plus an unsynchronized map, which is a data race on every concurrent access). Two goroutines can both see `cache == nil` and both `make`, and concurrent map reads/writes are themselves undefined in Go (the runtime may even panic with "concurrent map read and map write"). Fix with `sync.Once` for init and a mutex (or `sync.Map`) for access:

```go
var (
    once  sync.Once
    mu    sync.RWMutex
    cache map[string]int
)
func Get(k string) int {
    once.Do(func() { cache = make(map[string]int) })
    mu.RLock(); defer mu.RUnlock()
    return cache[k]
}
```
</details>

**Q46. Is this DCL correct? If not, fix it.**

```java
class Reg {
    private static Reg instance;          // not volatile
    static Reg get() {
        if (instance == null) {
            synchronized (Reg.class) {
                if (instance == null) instance = new Reg();
            }
        }
        return instance;
    }
}
```

<details><summary>Answer</summary>

**Broken Double-Checked Locking.** The field is not `volatile`, so the lock-free first read can observe a non-null reference whose constructor hasn't finished (publish-before-construct reordering), returning a half-built `Reg`. Fix: mark the field `volatile` —

```java
private static volatile Reg instance;
```

— which gives the publishing write release semantics and the lock-free read acquire semantics, closing the window. Better still, replace the whole thing with the holder idiom (`private static class H { static final Reg I = new Reg(); }`) and delete the hand-rolled DCL.
</details>

**Q47. What's wrong here, given `count` is `atomic.Int64`?**

```go
func (s *Stats) Bump() {
    if s.count.Load() < s.limit {   // check
        s.count.Add(1)              // act
    }
}
```

<details><summary>Answer</summary>

**Volatile/atomic misuse — check-then-act is not atomic.** Each operation is individually atomic, but the *sequence* isn't: two goroutines can both `Load()` a value below `limit`, both pass the check, and both `Add(1)`, pushing `count` over `limit`. The atomic gives per-op atomicity, not a transaction across the two ops. Fix: either guard the compound operation with a mutex, or fold the check-and-increment into a single CAS loop:

```go
for {
    c := s.count.Load()
    if c >= s.limit { return }
    if s.count.CompareAndSwap(c, c+1) { return }
}
```
</details>

**Q48. Diagnose this Java increment.**

```java
class Counter {
    private volatile long count;
    void inc() { count++; }
    long get() { return count; }
}
```

<details><summary>Answer</summary>

**Volatile Misuse.** `volatile` makes `get()` see the latest value, but `count++` is read-modify-write — three steps — and `volatile` does **not** make it atomic, so concurrent `inc()` calls lose updates. Fix: use `AtomicLong` (a real atomic RMW) or a `LongAdder` (better under high contention because it shards across cells to avoid cache-line bouncing):

```java
private final AtomicLong count = new AtomicLong();
void inc() { count.incrementAndGet(); }
long get() { return count.get(); }
```
</details>

**Q49. This Python code uses a lock around init. Is it safe under the GIL? Under no-GIL?**

```python
_inst = None
def get():
    global _inst
    if _inst is None:          # check, no lock
        _inst = Service()      # create
    return _inst
```

<details><summary>Answer</summary>

**Race-Prone Lazy Init** — and the GIL does **not** save it. The GIL can be released between the `is None` check and the assignment (it yields periodically and on I/O), so two threads can both see `None` and both build a `Service`, doubling any side effects (opened connection, registered thread). Under no-GIL (free-threaded CPython) it's even more clearly racy. Fix with a lock around the whole check-then-act, ideally double-checked to keep the hot path cheap, or simplest: module-level eager init, or `functools.lru_cache`/`functools.cache` on a zero-arg factory:

```python
import threading
_inst = None
_lock = threading.Lock()
def get():
    global _inst
    if _inst is None:
        with _lock:
            if _inst is None:
                _inst = Service()
    return _inst
```
</details>

**Q50. This Go spin loop never exits. Why, and what's the fix?**

```go
var done bool
func worker() { for !done { } }          // goroutine A
func stop()   { done = true }            // goroutine B
```

<details><summary>Answer</summary>

**Volatile Misuse by omission + data race.** `done` is shared and written without synchronization, so two things break: the read in `for !done {}` has no happens-before edge to the write, so goroutine A may *never* observe `done == true`; and the compiler is free to hoist the load out of the loop (it can't see another writer), turning it into `for true {}` — an infinite busy-wait that also pegs a CPU. Fix: make `done` an `atomic.Bool` (gives visibility/ordering and forces a fresh load each iteration), or far better, signal completion with a channel / `context.Context` so the worker *blocks* instead of spinning:

```go
done := make(chan struct{})
go func() { <-done; /* stop */ }()
close(done) // from stop()
```
(The busy-wait itself is the Busy-Waiting anti-pattern — see [Shared State](../03-shared-state/README.md).)
</details>

**Q51. Two anti-patterns in one snippet — name both.**

```java
class Conn {
    private static Conn instance;            // not volatile
    private boolean ready;
    static Conn get() {
        if (instance == null) instance = new Conn();   // lazy init, no lock
        if (!instance.ready) { instance.connect(); instance.ready = true; }
        return instance;
    }
}
```

<details><summary>Answer</summary>

**Race-Prone Lazy Init** (the unlocked `if (instance == null) instance = new Conn()` lets two threads create two `Conn`s) **and** **Volatile/visibility misuse** (`ready` is a plain field guarding `connect()` with another unsynchronized check-then-act, so two threads can both connect, and neither field is published with a happens-before edge so readers may see stale `instance`/`ready`). Fix both with one idiom — the holder pattern plus connecting in the constructor so the object is born ready:

```java
class Conn {
    private static class H { static final Conn I = create(); }
    static Conn get() { return H.I; }
    private static Conn create() { Conn c = new Conn(); c.connect(); return c; }
}
```
Now construction (including `connect()`) is serialized once by class init with correct memory semantics; no `volatile`, no double check, no flag.
</details>

---

## Curveballs

> The questions designed to catch glib answers.

**Q52. "Does `volatile` make `count++` thread-safe?"**

<details><summary>Answer</summary>

**No.** `volatile` (and a plain atomic load/store) gives *visibility* and *ordering* of a single access, not *atomicity* of a read-modify-write. `count++` reads, adds, and writes as three steps; two threads interleave them and lose updates regardless of `volatile`. You need an atomic RMW (`AtomicInteger.incrementAndGet`, `atomic.AddInt64`) or a lock. The trap word in the question is "thread-safe" — `volatile` makes the variable safely *published*, not safely *incremented*.
</details>

**Q53. "Is double-checked locking ever correct?"**

<details><summary>Answer</summary>

**Yes — with a `volatile` field (Java 5+) or an atomic pointer (Go/C++), DCL is correct** because those supply the acquire/release ordering that makes the lock-free read see a fully-constructed object. It was broken in pre-JSR-133 Java only because the old model allowed publish-before-construct. But "correct" ≠ "recommended": prefer `sync.Once` or the holder idiom, which are just as fast and can't be mis-ordered. Hand-rolled DCL is a thing you allow only after measuring that the standard idiom's overhead actually matters — which is rare.
</details>

**Q54. "Does Python's GIL make locks unnecessary?"**

<details><summary>Answer</summary>

**No.** The GIL serializes *bytecode execution*, which makes a single bytecode atomic and prevents low-level corruption of interpreter state — but your operations span multiple bytecodes (`x += 1`, check-then-act), and the GIL can be released between them, so you still lose updates and still need `threading.Lock` for compound operations. The GIL never protected logical race conditions, and free-threaded CPython (PEP 703) removes even the accidental protection. Bonus: the GIL also doesn't help across *processes*, and CPU-bound parallelism uses `multiprocessing`, where there's no shared GIL at all.
</details>

**Q55. "What's the difference between a race condition and a data race?"**

<details><summary>Answer</summary>

A **data race** is the memory-model violation: concurrent access to one location, ≥1 write, no happens-before edge → undefined behavior; a detector can find it. A **race condition** is a *logic* bug where correctness depends on timing, and it can exist with **zero data races** — e.g. a properly-locked check-then-act on a balance that still allows overdraft because the check and the act, though each locked, aren't one atomic transaction. So: every data race tends to cause race conditions, but you can have race conditions without data races. You fix data races with synchronization edges; you fix race conditions by widening the atomic unit (one lock around the whole invariant, or a CAS/transaction).
</details>

**Q56. "We added `-race` to CI and it's green. Are we race-free?"**

<details><summary>Answer</summary>

No — you're "no race *observed* in the schedules that ran." The detector is sound (no false positives) but not complete: it only sees interleavings that actually occurred, so a race that needs a rare timing, more cores, a different architecture, or an untested code path won't show up. Improve coverage by running concurrent tests with high parallelism, `-count` repetition, realistic load, and on weakly-ordered hardware (ARM). The strongest guarantee comes not from testing but from *design*: synchronize all shared mutable state so the program is race-free by construction, then use `-race` as a backstop.
</details>

**Q57. "If I make every shared field `volatile`/atomic, is my code thread-safe?"**

<details><summary>Answer</summary>

No. Per-field atomicity doesn't compose into multi-field consistency. If invariant `a + b == total` must hold and a reader can observe `a` updated but `b` not yet (between two atomic writes), the reader sees an impossible state — a race condition with no data race. Atomics protect *one location at one moment*; invariants that span fields or steps need a lock (or a single atomic pointer swap to an immutable snapshot holding all the fields together). "Atomic everywhere" is often a smell that someone is avoiding the lock they actually need.
</details>

**Q58. "x86 worked fine for years; why did the same binary corrupt on ARM?"**

<details><summary>Answer</summary>

Because x86's strong (TSO) memory model forbids most reorderings, so under-synchronized code often *accidentally* works there; ARM's weak model permits aggressive load/store reordering, exposing the missing fence as a real bug. The code was always incorrect by the language memory model — x86 just hid it. The fix isn't ARM-specific; it's adding the proper synchronization (lock/atomic/channel), which makes the compiler emit the right barriers (`dmb`/`ldar`/`stlr`) on ARM and the right ones on x86. "Works on my architecture" is never a correctness argument.
</details>

**Q59. "Can I just `time.Sleep` a bit to let the other goroutine finish initializing?"**

<details><summary>Answer</summary>

No — sleeping is the canonical non-fix. It (a) doesn't establish a happens-before edge, so the visibility/ordering bug remains even if the timing "usually" works; (b) is a race waiting for a slow machine, GC pause, or scheduler hiccup to violate your guessed delay; and (c) wastes time on the happy path. Sleeps "fix" races only by perturbing timing enough to hide them, which is why the bug reappears in production. Use a real synchronization edge — `sync.Once`, a channel, a `WaitGroup`, a condition variable — that *waits for the event*, not for a guessed duration.
</details>

---

## Rapid-Fire / One-Liners

> Crisp answers; what an interviewer wants in one or two sentences.

**Q60. `volatile`/atomic gives you ___ but not ___?**

<details><summary>Answer</summary>

Gives you **visibility and ordering** (of a single access); not **atomicity of a compound operation** and not **mutual exclusion**.
</details>

**Q61. One-line cure for each of the three?**

<details><summary>Answer</summary>

Race-Prone Lazy Init → `sync.Once` / holder idiom / eager init. Broken DCL → make the field `volatile`/atomic, or better, replace with `Once`/holder. Volatile Misuse → use an atomic RMW or a lock for compound ops; `volatile` is for publish-and-observe of one word.
</details>

**Q62. Go's one rule for shared variables?**

<details><summary>Answer</summary>

If more than one goroutine accesses it and at least one writes, you must synchronize — channel or `sync`/`atomic`. "Don't communicate by sharing memory; share memory by communicating."
</details>

**Q63. The fastest-correct lazy singleton in Java? In Go?**

<details><summary>Answer</summary>

Java: the initialization-on-demand **holder idiom** (`static final` in a nested class). Go: **`sync.Once`** (or `sync.OnceValue` since 1.21).
</details>

**Q64. What does `sync.Once` guarantee beyond "runs once"?**

<details><summary>Answer</summary>

That all callers **block until the run finishes** and that the function's writes **happen-before** every `Do` return — i.e. safe publication.
</details>

**Q65. Race detector: sound or complete?**

<details><summary>Answer</summary>

Sound (no false positives), not complete (only finds races in interleavings that actually executed).
</details>

**Q66. The two-word reason broken DCL fails?**

<details><summary>Answer</summary>

**Reordering** (publish-before-construct) and the resulting lack of **happens-before** between the construction and the lock-free read.
</details>

**Q67. CAS in one sentence, and its classic bug?**

<details><summary>Answer</summary>

"Set to new only if still old, atomically" — and its classic bug is **ABA** (value changed and changed back, so CAS wrongly succeeds).
</details>

**Q68. Atomicity vs. visibility vs. ordering — one word each?**

<details><summary>Answer</summary>

Atomicity = **indivisible**; visibility = **observable**; ordering = **non-reordered**. `volatile`/atomic load-store gives the last two for one word; only an atomic RMW or a lock gives the first for a compound operation.
</details>

**Q69. When is an `atomic.Bool` flag genuinely the right tool?**

<details><summary>Answer</summary>

When it's a single, independent, one-way signal (`shutdown`, `ready`) that no other state's consistency depends on — then it's cheaper than a mutex and correct. It becomes misuse the moment the flag *gates* a second piece of state without an ordering guarantee.
</details>

**Q70. Eager vs. lazy init — default to which?**

<details><summary>Answer</summary>

Default to **eager** (no race, no idiom) unless construction is expensive, may never be needed, or needs runtime input — then use `sync.Once` / holder.
</details>

---

## How to Talk About Concurrency in Interviews

A few habits separate a strong answer from a textbook recital:

- **Lead with happens-before, not the keyword.** Don't say "add `volatile` and it's fixed." Say *why* — "the lock-free read needs a happens-before edge to the construction, which the `volatile` write supplies." The reasoning is the signal; the keyword is the conclusion.
- **Separate the three properties out loud.** Stating "this needs *atomicity*, not just *visibility*" instantly distinguishes you from candidates who think `volatile` cures everything. Name atomicity / visibility / ordering precisely.
- **Distinguish data race from race condition every time it's relevant.** It's the single most reliable way to show you understand the memory model versus logic — and many interviewers ask it explicitly.
- **Prefer the boring correct idiom.** "I'd use `sync.Once` / the holder idiom" beats hand-rolling DCL. Mention that DCL *can* be correct with `volatile`/atomic, then say why you still wouldn't write it. Knowing the safe default is senior signal.
- **Show you'd find it, not just reason about it.** Mention `go test -race`, `jcstress`, stress tests with high parallelism and `-count`, and testing on ARM. "Sound but not complete" shows you understand the tool's limits.
- **Go deep only when asked.** Fences, MESI, false sharing, CAS/ABA, lock cost — these demonstrate depth, but lead with the model and reach for hardware when the interviewer pushes.
- **Avoid absolutism.** "Always lock," "atomics are always faster," "the GIL makes Python safe" are juniorisms. Calibrate: lock for invariants, atomics for independent single words, immutability to sidestep the whole problem.
- **Use a concrete war story.** "We had a config singleton that double-created under load on Graviton; here's how we found it with `-race` and fixed it with `sync.Once`" lands harder than any definition.

---

## Summary

- The three synchronization-misuse anti-patterns are all attempts to coordinate shared state *more cheaply than a lock allows*, each getting the memory semantics wrong: **Double-Checked Locking** (broken without `volatile`/atomic), **Volatile Misuse / Wrong Memory Ordering** (treating visibility as atomicity or mutual exclusion), and **Race-Prone Lazy Init** (unguarded check-then-create).
- The junior bar is knowing what `volatile`/atomic *does and doesn't* give (visibility/ordering, not atomicity or exclusion) and the data-race-vs-race-condition distinction. The middle bar is **happens-before**, choosing mutex vs. atomic, and the safe lazy-init idioms (`sync.Once`, the holder idiom, eager init). The senior bar is the **JMM and Go memory model**, *why pre-Java-5 DCL was broken*, and auditing a codebase. The professional bar is **fences, cache coherence (MESI), false sharing, CAS/ABA, and lock cost**.
- Modern verdict on the curveballs: `volatile` does **not** make `count++` thread-safe; DCL **is** correct with `volatile`/atomic but you should still prefer `sync.Once`/holder; the GIL does **not** remove the need for locks; and a race condition can exist with zero data races.
- The deepest cure is structural: eliminate shared *mutability* (immutability, `final` fields, snapshot-and-swap) and most of this category disappears — exactly the root-cause message of the concurrency chapter.

---

## Related Topics

- [`junior.md`](junior.md) — what the bug looks like and why it's hard to reproduce.
- [`middle.md`](middle.md) — detection and the safer patterns (`Once`, holder, atomics vs. locks).
- [`senior.md`](senior.md) — debugging in prod, memory models, and auditing a contended path.
- [`professional.md`](professional.md) — memory models, hardware ordering, and lock-free structures.
- [`tasks.md`](tasks.md) · [`find-bug.md`](find-bug.md) · [`optimize.md`](optimize.md) — practice diagnosing and fixing the races.
- [Coordination Anti-Patterns](../02-coordination/README.md) — deadlock, holding a lock during I/O, wrong lock granularity.
- [Shared State Anti-Patterns](../03-shared-state/README.md) — unprotected shared mutable state, busy-waiting, unbounded thread-per-request.
- [Async Anti-Patterns](../../04-async/README.md) — the single-threaded event-loop sibling chapter.
- [Clean Code → Immutability](../../../clean-code/14-immutability/README.md) — the structural cure that removes the shared writes entirely.
- [Concurrency Anti-Patterns (chapter)](../README.md) — how all nine relate, rooted in shared mutable state.