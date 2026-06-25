# Interpretation, Compilation, JIT, AOT — Interview Questions

> **Topic:** [Interpretation, Compilation, JIT, AOT](README.md)

---

## Introduction

These questions probe whether a candidate understands the **execution spectrum** — the path from a pure tree-walking interpreter, through bytecode interpretation, baseline and optimizing JITs, to ahead-of-time native code — and can reason about *why* a given runtime made the choices it did. The goal isn't trivia recall ("what tier is C2?") but mechanical understanding: can the candidate explain what dispatch overhead is, what a JIT does that an AOT compiler structurally cannot, why warmup is unavoidable, what deoptimization is *for*, and when the startup-vs-peak trade-off flips a real engineering decision.

A strong candidate refuses the false binary of "compiled vs interpreted." They speak precisely — "CPython compiles to bytecode then interprets it," "HotSpot interprets, then C1, then C2," "native-image makes a closed-world assumption that breaks reflection." They connect mechanism to consequence: warmup explains serverless cold-start pain; profiles explain why a JIT can beat AOT at peak; runtime codegen explains both the JIT's power and its attack surface. A weaker candidate parrots "JIT is faster" without explaining when, or thinks `python` doesn't compile anything.

The questions are grouped: **Conceptual** (the spectrum and its mechanics), **Language-Specific** (JVM HotSpot, V8, CPython, .NET, GraalVM, Go), **Tricky/Trap** (where the obvious answer is wrong), and **Design** (apply the model to a system).

## Table of Contents

- [Conceptual / Foundational](#conceptual--foundational)
- [Language-Specific](#language-specific)
  - [JVM / HotSpot](#jvm--hotspot)
  - [JavaScript / V8](#javascript--v8)
  - [Python / CPython & PyPy](#python--cpython--pypy)
  - [.NET / RyuJIT, ReadyToRun, NativeAOT](#net--ryujit-readytorun-nativeaot)
  - [GraalVM](#graalvm)
  - [Go](#go)
- [Tricky / Trap Questions](#tricky--trap-questions)
- [Design Scenarios](#design-scenarios)
- [Cheat Sheet](#cheat-sheet)
- [Further Reading](#further-reading)

---

## Conceptual / Foundational

## Question 1

**Walk me through the execution spectrum from a tree-walking interpreter to AOT native code.**

The spectrum, fastest-execution last: (1) **Tree-walking interpreter** — execute by recursively walking the AST; simplest, slowest, because every node re-incurs traversal and dispatch overhead each time it runs. (2) **Bytecode interpreter** — first compile the AST to a flat, compact bytecode, then run a fetch-decode-dispatch loop over it; far faster than tree-walking because instructions are simple and dispatch is a tight loop (CPython, Ruby). (3) **Baseline/template JIT** — emit straightforward native code per bytecode with little optimization, eliminating dispatch overhead quickly (HotSpot C1, V8 Sparkplug). (4) **Optimizing JIT** — use runtime profiles to emit aggressively optimized native code for hot regions (HotSpot C2, V8 TurboFan). (5) **AOT native** — compile everything to machine code before running (C, C++, Rust, Go, or native-image/NativeAOT for managed languages). The key framing: these are points on a continuum differentiated by *when* translation happens and *how much* runtime information it uses, not a binary.

## Question 2

**What is dispatch overhead in an interpreter, and how do you reduce it?**

A bytecode interpreter's core loop is fetch the next opcode, decode it, and dispatch (jump) to the handler. For a cheap operation like integer add, that scaffolding can cost several times the useful work — that's dispatch overhead. The classic `switch(opcode)` dispatch compiles to a single indirect jump that the CPU branch predictor mispredicts often (it merges all opcode transitions into one prediction site). Reductions: **direct/indirect threading** via *computed goto* (`goto *table[*pc++]`), which duplicates the dispatch at the end of each handler so the predictor learns per-opcode transition patterns (a 20–50% interpreter speedup, GCC/Clang only); **superinstructions** (fuse common opcode pairs into one); and ultimately a **JIT**, which removes the loop entirely by turning bytecode into native code.

## Question 3

**What does a JIT do that an AOT compiler structurally cannot?**

It uses **runtime profiles** — information available only by watching the program actually run. Concretely: observed types (this `+` has only ever seen two ints → emit a fast guarded int path), branch frequencies (this `if` is taken 99.9% → lay the common path out straight-line), devirtualization (this interface call has only ever hit one implementation → inline it with a guard), and cross-boundary inlining based on real call targets. An AOT compiler sees only the source, so it must be conservative — correct for *all* possible inputs. The JIT speculates on the *likely* case, guarded by cheap checks, with deoptimization as the safety net. This is why a warmed JIT can match or beat AOT at peak on dynamic, type-stable workloads.

## Question 4

**Why is "compiled vs interpreted" a false dichotomy? Give examples.**

Because real runtimes mix strategies. CPython **compiles** source to bytecode (`.pyc`) and then **interprets** that bytecode — it's not "purely interpreted." Java **compiles** to bytecode (a build step, `javac`), then **interprets** it, *and* **JIT-compiles** the hot parts to native. .NET can be **JIT'd**, **partially AOT'd** (ReadyToRun, keeping the JIT), or **fully AOT'd** (NativeAOT, no JIT). Go is AOT but ships a runtime with a GC and scheduler. The honest description is always *what the runtime does* — "compiled to bytecode then tiered-JIT'd," "AOT to native" — not a one-word label. The dichotomy obscures more than it reveals.

## Question 5

**What is warmup, and why is it unavoidable in a JIT?**

Warmup is the period from launch until the program reaches peak throughput. It's unavoidable because: (1) the runtime must *run* code (interpreted or baseline) for a while to discover it's hot — you can't profile code that hasn't executed; (2) compilation itself burns CPU, competing with the program; (3) higher tiers wait for enough profiling data to optimize well. So throughput-over-time is a curve rising to a plateau. For a long-lived server this is a rounding error; for a 50 ms CLI, warmup is the *entire lifetime* — the program exits before reaching peak, having paid the cost and reaped none of the benefit. That single fact is why AOT exists for short-lived programs.

## Question 6

**Explain tiered compilation and why it exists.**

It exists to resolve a tension: a cheap compiler gets you off the slow interpreter *quickly* but produces only decent code; an expensive compiler produces *excellent* code but takes longer. Using both gives most of the win fast and the last bit eventually. Code starts interpreted; once warm, a fast baseline compiler (HotSpot C1, V8 Sparkplug) emits decent native quickly; if it stays hot, an optimizing compiler (C2, TurboFan) recompiles it into highly optimized code. Cold code never leaves the interpreter, which is fine. Lower tiers often also *collect the profiles* the higher tier consumes. The tiers cooperate: fast time-to-native plus eventual peak quality.

## Question 7

**What is on-stack replacement (OSR) and what problem does it solve?**

Consider one giant loop inside a `main` that's called exactly once: the per-method invocation counter never trips, so without help the hot loop runs interpreted forever even as its backedge counter screams. OSR solves this: when the loop's backedge counter trips, the JIT compiles the *loop*, then transfers the *currently-running* interpreted frame into the freshly compiled code mid-loop — copying live locals and the loop index and jumping in at the right point — so the loop continues at native speed *without restarting*. It's "replace the executing frame on the stack with a compiled version." Essential for workloads dominated by a single long loop. (HotSpot marks OSR compiles with `%` in `PrintCompilation`.)

## Question 8

**What is deoptimization, and why does it make speculation safe?**

A JIT compiles under assumptions (always-int, monomorphic, branch-never-taken), each protected by a cheap **guard** plus **deopt metadata** mapping compiled state back to interpreter state. When a guard fails — a float arrives, a new subclass loads, the rare branch fires — execution jumps to an uncommon trap, the runtime reconstructs an interpreter frame from the metadata, discards the invalid compiled code, and *resumes interpreting* at the equivalent point. The program stays correct; only speed is lost. Deopt turns "probably true" into "true until disproven, instantly recoverable," which is exactly what *licenses* aggressive speculation. Without it, the JIT could only do optimizations provably valid for all inputs — roughly what AOT is stuck with.

## Question 9

**Compare method-based JITs and meta-tracing JITs.**

A **method JIT** (HotSpot, V8, RyuJIT) compiles whole methods; it crosses method boundaries via inlining and reasons about merged control flow; it degrades gracefully on branchy code. A **meta-tracing JIT** (PyPy, LuaJIT) records the *linear trace* of operations actually executed through a hot loop — following calls across method boundaries naturally — and compiles that straight-line trace with guards at every divergence point; inlining is automatic, the optimizer only sees straight-line code, and it's spectacular on loop-dominated, type-stable code. Its failure mode is **trace explosion**: branchy code spawns many divergent traces and frequent side exits, ballooning code size and erasing the gain. That trade-off is why mainstream general-purpose runtimes chose method JITs and dynamic-language specialists chose tracing.

## Question 10

**What is profile-guided optimization (PGO) for AOT, and how does it differ from a JIT's profiling?**

PGO gives an AOT compiler a taste of the JIT's profile advantage *offline*: build an instrumented binary, run it on representative input to collect a profile (branch frequencies, hot functions, call targets), then rebuild using that profile to guide inlining, block layout, and devirtualization. The differences from a JIT: the profile is from a *training* run, not the *current* one, so it can be wrong — and unlike a JIT there's **no deopt to recover**, the misprediction just costs you. It's *static* — one layout for the whole run, no respecialization on phase changes. So PGO captures most of the common-case layout benefit but demands a representative, fresh profile.

## Question 11

**Why did AOT compilation resurge for managed languages?**

Serverless cold-starts and CLIs. A JIT's warmup and memory footprint are intolerable for short-lived or scale-to-zero workloads: a serverless function pays warmup on *every* cold start; a CLI never warms up; a microservice scaled to many replicas wants each to boot in tens of ms with small RSS. AOT (GraalVM native-image, .NET NativeAOT) delivers exactly the JIT's three weaknesses inverted — fast startup, low memory, no warmup — plus it removes the runtime-codegen attack surface. The cost is the closed-world assumption (breaks reflection/dynamic loading unless configured) and loss of runtime adaptive specialization. The economics of cold start flipped the decades-old "JIT is just better for servers" assumption for an important class of workloads.

## Question 12

**What is the closed-world assumption, and what does it break?**

It's the premise that *all reachable code is known at build time* — nothing is loaded or generated at runtime. A closed-world AOT compiler (native-image) does whole-program reachability analysis and *removes everything not provably reachable* (which is also why native images are small and start fast). That collides with "open-world" features: **reflection** (`Class.forName("...")` — the compiler can't see the class used, so it's pruned), **dynamic class loading** (plugins, runtime bytecode — generally unsupported), **runtime code generation / dynamic proxies** (many ORMs/DI/mocking frameworks must move to build-time codegen), and reflective **serialization**. The fix is build-time configuration (reflection config, often auto-captured by a tracing agent during tests) and source generators that replace runtime reflection.

## Question 13

**Why is Java "slow to warm but fast at peak" while a CLI tool wants AOT?**

Java starts by interpreting bytecode, then tiers up (C1 → C2) as code gets hot, climbing to a high, adaptive peak — but the climb (warmup) takes time and CPU. For a long-lived server, warmup is paid once and amortized over billions of operations, so the high peak dominates. A CLI tool runs for tens of milliseconds and exits: it never reaches peak, so it pays all the warmup cost for none of the benefit, and also carries the JIT's memory overhead. AOT gives the CLI instant startup, low memory, and predictable performance — exactly what a short-lived, frequently-started program needs. Same mechanism (warmup), opposite conclusion, because the workload lifetimes differ.

## Question 14

**How do you decide JIT vs AOT as an engineering decision rather than a slogan?**

Integrate throughput over the process lifetime and weight by restart frequency — compute the area under the throughput curve, not a steady-state point. If process lifetime ≪ warmup time (CLI, scale-to-zero serverless), the JIT never reaches peak → AOT wins on startup, memory, and predictability. If lifetime ≫ warmup (long-lived server), warmup amortizes → a warmed JIT's peak and adaptivity usually win, and you keep full dynamism. If start frequency is high with moderate lifetime (autoscaling, frequent redeploys), repeated re-warming is a real tax → AOT or a hybrid (R2R) often wins in aggregate even though a single warmed benchmark favors the JIT. The decision is arithmetic over the workload's lifetime distribution.

---

## Language-Specific

### JVM / HotSpot

## Question 15

**Describe HotSpot's interpreter → C1 → C2 pipeline.**

HotSpot starts by **interpreting** bytecode (a template interpreter). Methods carry invocation and backedge counters; when they cross thresholds, the method is queued for compilation on a background compiler thread. **C1** (the "client" compiler) is fast and does light optimization — good time-to-native. **C2** (the "server" compiler) is slow and does aggressive optimization (inlining, escape analysis, etc.) — best peak code. Tiered compilation uses both: tier 0 is interpreter, tiers 1–3 are C1 variants (tier 3 is C1-*with-profiling*, which collects data for C2), and tier 4 is C2. So a hot method typically goes interpreter → C1-with-profiling → C2. You can watch the promotions with `-XX:+PrintCompilation`.

## Question 16

**In HotSpot, what's the difference between tier 1, tier 3, and tier 4?**

A common confusion: the tier numbers aren't a simple "higher = more optimized" ladder. Tier 0 is the interpreter. **Tier 1** is C1 *without* profiling counters (used for trivial methods that won't benefit from C2). **Tier 3** is C1 *with* profiling counters — it runs a bit slower than tier 1 because it's collecting the profile data C2 needs. **Tier 4** is C2, the fully optimizing compiler. The normal hot path is 0 → 3 → 4: interpret, then profile-collecting C1, then optimizing C2. Reading `PrintCompilation` without knowing tier 3 is "C1 with profiling" leads people to misinterpret the logs.

## Question 17

**What happens when the HotSpot code cache fills up?**

The code cache is the fixed-size region where the JIT writes generated native code. When it fills — common in method-heavy apps, heavy dynamic-proxy use, or long-uptime services — **the JIT stops compiling and hot methods revert to the interpreter**, causing a sudden throughput collapse *with no exception thrown*. It's one of the nastiest JVM incidents precisely because it's silent. Mitigations: size it (`-XX:ReservedCodeCacheSize`), enable `-XX:+UseCodeCacheFlushing`, and monitor occupancy (alert above ~80%). A senior operator treats the code cache as a resource to size and watch, like heap.

### JavaScript / V8

## Question 18

**Walk through V8's pipeline: Ignition, Sparkplug, Maglev, TurboFan.**

V8 parses JS to bytecode and runs it on **Ignition**, a register-based bytecode interpreter (fast startup, low memory). Hot functions tier up to **Sparkplug**, a *baseline* JIT that compiles bytecode to straightforward native code very quickly (no optimization, but no interpreter dispatch). Hotter still, **Maglev** (a newer mid-tier optimizing compiler) produces decently optimized code with modest compile cost. The hottest code reaches **TurboFan**, the heavyweight optimizing compiler using speculative type feedback. This four-tier ladder (interp → baseline → mid → optimizing) is V8's answer to the same speed-vs-quality tension HotSpot solves with C1/C2 — more tiers, finer-grained climb to peak. Speculation in Maglev/TurboFan is backed by deoptimization to Ignition when guards fail.

## Question 19

**What is an inline cache in V8, and why does monomorphism matter?**

Property access and method calls on dynamically-typed objects are expensive (the engine must find where the property lives). An **inline cache** records, per call site, the "shape" (hidden class) it last saw and the resolved access — so a repeat with the same shape is a cheap guarded fast path. A **monomorphic** site (always one shape) is fastest; **polymorphic** (a few shapes) is handled with a small cache; **megamorphic** (many shapes) falls back to slow generic lookup and defeats devirtualization and inlining. This is why type-stable hot code is fast in V8 and why mixing many object shapes through one hot site tanks performance — the same lesson applies to every speculative JIT.

### Python / CPython & PyPy

## Question 20

**Is CPython interpreted or compiled? Be precise.**

Both, in sequence: CPython **compiles** your source to **bytecode** (cached as `.pyc` in `__pycache__`) and then **interprets** that bytecode in a fetch-decode-dispatch loop. So "Python is interpreted" is only half true — there's a real compile step, just to bytecode rather than native. You can see the bytecode with `dis.dis(func)`. CPython (through 3.10) had no JIT, which is why pure-Python loops are far slower than native; the dispatch overhead is incurred on every bytecode every iteration. CPython 3.11+ added an *adaptive specializing interpreter* (specializes hot bytecodes by observed types) and 3.13+ began adding an experimental JIT — narrowing, but not closing, the gap.

## Question 21

**How does PyPy get its speed, and how does it differ from CPython?**

PyPy is a **meta-tracing JIT** implementation of Python. Instead of interpreting bytecode forever like CPython, it traces hot loops — recording the linear sequence of operations actually executed (across function calls), already specialized to the observed types — and compiles that trace to native code with guards. "Meta" means PyPy traces the *interpreter* executing your program, so the tracing JIT is largely derived from the interpreter definition rather than hand-written per language. The result: numeric/loop-heavy Python often runs many times faster than CPython. The trade-offs: warmup, higher memory, weaker C-extension compatibility (CPython's C API is hard to support efficiently), and trace-explosion risk on very branchy code.

### .NET / RyuJIT, ReadyToRun, NativeAOT

## Question 22

**Explain the .NET execution-model spectrum: RyuJIT, ReadyToRun, NativeAOT.**

.NET compiles C# to IL (bytecode), then bridges to native three ways. **RyuJIT** is the default JIT: IL is JIT-compiled at runtime with tiered compilation (Tier 0 / QuickJIT for fast startup, Tier 1 optimizing for hot code), full dynamism, but with warmup. **ReadyToRun (R2R)**, produced by CrossGen at publish time, precompiles common IL to native *ahead of time* but **keeps the JIT in the process** — startup improves (common paths are already native) while the JIT remains available to reoptimize hot code and dynamic features still work; it's a hybrid. **NativeAOT** compiles the whole app to a self-contained native binary with **no JIT** — fastest startup, smallest footprint, no runtime codegen — at the cost of the closed-world assumption (reflection restrictions) and no runtime respecialization. Three detents on one dial.

## Question 23

**What does ReadyToRun give up versus NativeAOT, and why choose it?**

R2R precompiles common paths but **retains the JIT and the full runtime**, so it gives up NativeAOT's smallest-footprint and no-runtime-codegen properties (and can't run in no-RWX environments that forbid a JIT). In exchange it keeps **full dynamism** (reflection, dynamic loading work normally) and the ability for the JIT to promote hot code to fully optimized Tier-1 at runtime. You choose R2R when you want to cut first-request/startup latency for a latency-sensitive service without surrendering dynamic features or the JIT's peak optimization — a common production sweet spot for .NET web tiers that redeploy often. NativeAOT is for when startup/memory/security demand zero runtime codegen (CLIs, serverless, locked-down sandboxes).

### GraalVM

## Question 24

**What is GraalVM native-image, and what's the catch?**

GraalVM native-image is an **AOT compiler** that turns JVM bytecode into a standalone native executable — instant startup, low memory, no warmup, ideal for serverless and CLIs. The catch is the **closed-world assumption**: it does whole-program reachability analysis and prunes everything not provably reachable, so **reflection, dynamic class loading, dynamic proxies, and reflective serialization break** unless declared in build-time configuration. It also runs static initializers at build time (baking the result into the image), which can freeze build-machine state incorrectly. The ecosystem copes with reflection config (often auto-generated by running a tracing agent over the test suite), `@RegisterForReflection`, and build-time-friendly frameworks (Quarkus, Micronaut do DI/config at build time). GraalVM can *also* act as a high-performance JIT compiler inside HotSpot — same toolchain, both ends of the spectrum.

### Go

## Question 25

**Why does Go use AOT with no JIT, and what are the consequences?**

Go's design priorities — fast builds, a single self-contained binary, predictable performance, simple deployment — point straight to AOT. `go build` compiles everything to native machine code; there's no bytecode, no interpreter, no JIT. Consequences, good and bad: **instant startup, no warmup, low and predictable memory, one binary to ship** (its killer operational feature), and **no runtime-codegen attack surface**. The price: **no runtime adaptive specialization** — Go can't devirtualize or respecialize based on observed runtime behavior the way a JIT can, so on some long-lived, highly polymorphic workloads a warmed JIT could out-peak it. Go also ships a runtime (GC, goroutine scheduler) inside the binary, so "AOT" doesn't mean "no runtime," just "no JIT and no interpreter." Go added PGO support to recover some profile-driven optimization at build time.

## Question 26

**Does Go's lack of a JIT mean it can never use runtime profiles?**

Not entirely — it just uses them *at build time* via **PGO**. You collect a `pprof` CPU profile from a representative run, place it as `default.pgo`, and the compiler uses it to guide inlining and devirtualization decisions for the *next* build. This captures the common-case benefit (the compiler inlines and devirtualizes hot paths the profile reveals) but statically: one set of decisions baked into the binary, no runtime respecialization, and no deopt if production diverges from the training profile. So Go gets *some* of the profile advantage a JIT has, frozen at compile time, consistent with its AOT philosophy. The profile must stay representative or it can mis-guide.

---

## Tricky / Trap Questions

## Question 27

**"My Java microbenchmark shows the function takes 14ms, but C does it in 1ms — Java is 14x slower." What's wrong?**

The benchmark measured the **interpreter and warmup**, not the compiled code. The first runs of a JIT'd function execute interpreted while the JIT hasn't kicked in; timing them measures the slow path plus compilation jitter, not steady-state. After warmup (enough iterations to trigger C1 then C2), the same function typically drops to ~1ms — comparable to C. The fix is a proper harness (JMH) that runs warmup iterations and discards them before measuring. Concluding "Java is slow" from a cold microbenchmark is the single most common JIT-benchmarking error.

## Question 28

**"AOT is always faster than JIT." True or false?**

False — it depends on *which* metric and *when*. AOT is faster at **startup** (no warmup) and uses less memory, essentially always. But at **peak throughput** on long-running, type-stable-but-dynamic workloads, a warmed JIT can *match or beat* AOT because it specializes on real runtime profiles (devirtualization, branch layout, observed types) that a closed-world AOT compiler froze conservatively at build time. So: AOT wins startup and memory; peak is workload-dependent and often goes to the JIT. The correct answer integrates throughput over the process lifetime rather than quoting one number.

## Question 29

**"Python doesn't have a compiler." Respond.**

Wrong — CPython has a compiler that produces **bytecode**, cached in `.pyc` files. Run `dis.dis(your_function)` and you'll see the compiled bytecode (`LOAD_FAST`, `BINARY_OP`, etc.). What CPython historically *lacked* (pre-3.13) is a JIT that compiles to *native* code, which is why it's slow — it interprets bytecode rather than executing native. The trap exploits the loose use of "compiled" to mean "compiled to native"; precisely, Python *is* compiled (to bytecode) and *then* interpreted. PyPy goes further with a meta-tracing JIT to native.

## Question 30

**"We'll just AOT-compile our Java service with native-image and keep all our reflection-heavy libraries." What breaks?**

The reflection. native-image's closed-world reachability analysis prunes code it can't see reached, so anything loaded via `Class.forName`, accessed by reflective member lookup, used by a dynamic proxy, or reflectively (de)serialized gets **removed and fails at runtime** (`ClassNotFoundException`, missing-member errors) — not at build time, which makes it worse. Reflection-heavy frameworks (classic Spring DI, runtime-reflection serializers, mocking libraries) either need extensive build-time reflection config (often captured by running a tracing agent over a thorough test suite) or must be swapped for build-time-codegen equivalents (Quarkus/Micronaut, source-generated serializers). "Just AOT it" without auditing the dynamic surface is a recipe for production-only failures.

## Question 31

**A JIT'd function keeps getting *slower* the longer the program runs. What's happening?**

Likely a **deopt loop**. The JIT compiled the function under a speculation (a type, a branch, a monomorphic call site); something keeps violating it intermittently (e.g. a hot call site that alternates between unrelated types — megamorphic and unstable). Each violation triggers deoptimization (rebuild interpreter frame, fall back), then the JIT recompiles, the guard fails again, and it thrashes — often *slower* than if it had never compiled. Diagnose with `--trace-deopt` / `-XX:+PrintCompilation` to find the unstable site; fix by stabilizing the call site (keep it monomorphic) or letting the runtime fall back to a general (un-speculated) version.

## Question 32

**Can a classic JIT run on any platform? Why might it be forbidden?**

No. A JIT must generate executable code at runtime, which requires memory that is (at least transiently) **writable and executable**. Some hardened platforms enforce **W^X / forbid RWX** for security (certain iOS/console/sandbox policies); on those, a classic JIT literally **cannot run**, which forces AOT. This is a *security* constraint, not a performance one: runtime codegen is an attack surface (JIT spraying, speculative-optimizer type-confusion bugs that underlie many browser zero-days). So "JIT vs AOT" sometimes isn't a choice at all — the trust environment mandates AOT. Candidates who think the model is purely about speed miss this.

## Question 33

**"Our serverless functions are slow on every cold start. Adding more memory didn't help." Diagnose.**

If the runtime is JIT-based (JVM, .NET with JIT, Node), the cold-start latency is dominated by **warmup**, not memory: each fresh sandbox interprets/baseline-compiles before reaching peak, and since the function is short-lived it never amortizes that cost. More RAM doesn't fix warmup. Real fixes: **AOT-compile** the function (native-image, NativeAOT) to eliminate warmup; use **R2R/AppCDS** to cut startup if you must keep the JIT; provision/keep-warm instances; or move to a runtime built for instant start (precompiled WASM at the edge). The root cause is the execution model meeting a short lifetime — exactly why serverless resurrected AOT.

---

## Design Scenarios

## Question 34

**Design the execution-model strategy for a company with a CLI tool, a long-lived API server, and serverless functions — all in the same managed language.**

Pick the model per deployment, not per language. **CLI**: AOT (native-image/NativeAOT) — instant startup, low memory, single binary; users never wait for warmup, and you lose little since CLIs rarely need runtime adaptivity. **Long-lived API server**: full JIT (or R2R to trim first-request latency) — warmup amortizes over the process's long life, the JIT's peak and adaptivity buy throughput (fewer machines), and you keep full dynamism; pre-warm before joining the load balancer and monitor the code cache. **Serverless functions**: AOT or precompiled artifacts — cold-start frequency makes warmup a per-invocation tax; eliminate it. The same codebase ships three ways by build/publish mode. Re-evaluate if a workload's lifetime/restart profile changes.

## Question 35

**You're building a new dynamic scripting language. Walk through how you'd evolve its execution model as it grows.**

Start simple and earn complexity. **Phase 1**: a tree-walking interpreter — fastest to build, easy to get correct, fine for early adopters and scripts. **Phase 2**: compile to bytecode and write a bytecode interpreter with good dispatch (computed-goto threading where available) — a large speedup with moderate effort, keeps portability and fast startup. **Phase 3**: add specialization in the interpreter (inline caches, adaptive specialization of hot bytecodes by observed type) — big wins without a full JIT (CPython 3.11's path). **Phase 4**, only if profiling shows it's worth it: a JIT. Choose architecture by workload — a **meta-tracing JIT** if the language is loop-heavy and type-stable (PyPy/LuaJIT model, and "meta" lets you derive it from the interpreter), or a **method JIT** if control flow is diverse. Keep an AOT/bytecode-cache story for startup-sensitive embedders. At each phase, measure before advancing — most languages never need a JIT.

## Question 36

**Design a latency-sensitive trading service. The team proposes Java. Address the warmup and jitter concerns.**

Java's peak throughput is excellent, but warmup and compilation/GC jitter are real risks for tail-latency-critical trading. Strategies: **(1) Aggressive pre-warming** — replay representative market data through all hot paths before the market opens / before the instance takes orders, so the JIT reaches C2 and OSR-compiles hot loops *before* real traffic. **(2) Tame compilation jitter** — cap and pin compiler threads off the latency-critical cores; consider compiling hot methods early and avoiding mid-session deopt by keeping hot call sites monomorphic and inputs type-stable. **(3) Watch deopt rate** — a deopt mid-session is a latency event; alert on it. **(4) Consider AOT for the hottest, simplest paths** if jitter is intolerable (native-image, accepting reduced adaptivity). **(5) Pre-size the code cache** so it never fills mid-session (silent interpreter fallback would be catastrophic). The decision is to keep the JIT's peak while *shaping its tail* operationally — or to trade peak for AOT's predictability where the tail dominates.

## Question 37

**Design how WebAssembly should be compiled for (a) an interactive web app and (b) a multi-tenant edge function platform.**

**(a) Web app (browser):** use the engine's **tiered JIT** — a baseline compiler (V8 Liftoff) for near-instant startup so the page is interactive immediately, then an optimizing compiler (TurboFan) for hot modules. WASM warms up far faster than JS (it's already typed and close to machine code), so the baseline output is good and the warmup tail is small; this maximizes time-to-interactive while still reaching peak for compute-heavy modules. **(b) Edge platform:** **AOT-precompile and cache** each module (Wasmtime/Wasmer `compile` → serialize → deserialize per request) so a request hits *already-native* code with near-zero cold start — the AOT advantage that makes WASM compelling for scale-to-zero multi-tenant compute, plus WASM's validated bytecode and linear-memory model give strong sandboxing without OS-process overhead. Same spectrum, opposite ends, chosen by the deployment: interactive latency favors fast-start JIT; multi-tenant cold-start economics favor precompiled AOT.

---

## Cheat Sheet

```text
+------------------------------------------------------------------+
|         EXECUTION SPECTRUM — INTERVIEW MUST-KNOW                 |
+------------------------------------------------------------------+
| Spectrum (exec speed last):                                      |
|   tree-walk < bytecode-interp < baseline-JIT < optimizing-JIT    |
|   < AOT-native   (differ by WHEN translation happens + how much  |
|   RUNTIME info it uses — a continuum, not a binary)              |
+------------------------------------------------------------------+
| Dispatch overhead = fetch/decode/jump per bytecode.              |
|   switch -> threaded(computed-goto) cuts it (branch prediction). |
+------------------------------------------------------------------+
| JIT's edge over AOT = RUNTIME PROFILES (types, branch freq,      |
|   devirtualization) -> speculate + GUARD + DEOPT to recover.     |
|   AOT can't recover -> conservative; PGO = offline profile, no   |
|   deopt, must be representative.                                 |
+------------------------------------------------------------------+
| Tiered: HotSpot interp->C1->C2 (t0,t1=C1,t3=C1+profile,t4=C2)    |
|         V8  Ignition->Sparkplug->Maglev->TurboFan               |
|         .NET Tier0(QuickJIT)->Tier1 ; R2R hybrid ; NativeAOT     |
| OSR = optimize a RUNNING loop (HotSpot '%').  Warmup = must run  |
|   to profile -> unavoidable climb to peak.                       |
+------------------------------------------------------------------+
| Method JIT (HotSpot/V8/RyuJIT): unit=method, inline, graceful.   |
| Meta-tracing (PyPy/LuaJIT): unit=trace, free inlining, risk =    |
|   TRACE EXPLOSION on branchy code.                              |
+------------------------------------------------------------------+
| AOT-for-managed (GraalVM native-image, .NET NativeAOT):          |
|   + fast start, low mem, no warmup, no runtime-codegen surface  |
|   - CLOSED-WORLD: reflection/dynamic-load break w/o config      |
|   - no runtime respecialization                                 |
|   WHY IT RESURGED: serverless cold-start + CLI economics.       |
+------------------------------------------------------------------+
| CPython = compile-to-bytecode THEN interpret (not "uncompiled"). |
| Go = AOT, single binary, no JIT (PGO for build-time profiles).  |
| WASM: browser=tiered JIT (Liftoff/TurboFan); edge=precompiled AOT|
+------------------------------------------------------------------+
| Decide JIT/AOT by AREA UNDER throughput curve over lifetime x    |
| restart-rate — short-lived->AOT, long-lived->warmed JIT/R2R.    |
+------------------------------------------------------------------+
```

---

## Further Reading

- *Crafting Interpreters* — Robert Nystrom. Tree-walking and bytecode VMs from scratch; the foundation for every question here. https://craftinginterpreters.com/
- *Optimizing Dynamically-Dispatched Calls with Run-Time Type Feedback* — Hölzle & Ungar (Self). The origin of type feedback and deoptimization.
- *Tracing the Meta-Level: PyPy's Tracing JIT Compiler* — Bolz et al. The canonical meta-tracing reference.
- *Launching Ignition and TurboFan* and *Sparkplug* — V8 blog. The modern multi-tier JS/WASM pipeline.
- *The Java HotSpot Performance Engine Architecture* — Oracle. Tiered compilation, C1/C2, OSR.
- *.NET ReadyToRun and Native AOT deployment* — Microsoft Learn. The full JIT/R2R/NativeAOT spectrum.
- *GraalVM Native Image* — reachability analysis, reflection config, build-time init. https://www.graalvm.org/
- *Go Profile-Guided Optimization* — the Go blog/docs on build-time profiles for an AOT language.
- *Liftoff: a baseline compiler for WebAssembly in V8* and *Wasmtime AOT compilation* docs — the WASM JIT/AOT story.
- *The Python 3.11 specializing adaptive interpreter* — speeding a bytecode interpreter without a full JIT.
