# Panic & Recovery — Senior Level

> **Topic:** [Panic & Recovery Roadmap](README.md)
> **Focus:** The *design* decision behind every panic boundary — **fail-fast vs. recover, abort vs. unwind, crash-only vs. graceful**. Supervision trees, panic propagation across goroutines/threads/async tasks, lock poisoning, and the policy you set once at the architecture level so that ten thousand call sites don't each have to decide.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Fail-Fast vs. Recover — The Real Decision](#fail-fast-vs-recover--the-real-decision)
8. [Abort vs. Unwind — The Runtime Policy](#abort-vs-unwind--the-runtime-policy)
9. [Crash-Only Software](#crash-only-software)
10. [Supervision — Letting a Tree Restart What Crashed](#supervision--letting-a-tree-restart-what-crashed)
11. [Panic Propagation Across Concurrency Units](#panic-propagation-across-concurrency-units)
12. [Lock Poisoning and Corrupt-State Detection](#lock-poisoning-and-corrupt-state-detection)
13. [Process-Level Last-Resort Handlers](#process-level-last-resort-handlers)
14. [Designing the Panic Policy for a Service](#designing-the-panic-policy-for-a-service)
15. [Code Examples](#code-examples)
16. [Worked Example — A Recover That Hid a Data-Corruption Bug](#worked-example--a-recover-that-hid-a-data-corruption-bug)
17. [Failure Stories From the Field](#failure-stories-from-the-field)
18. [Pros & Cons](#pros--cons)
19. [Use Cases](#use-cases)
20. [Coding Patterns](#coding-patterns)
21. [Clean Code](#clean-code)
22. [Best Practices](#best-practices)
23. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
24. [Common Mistakes](#common-mistakes)
25. [Tricky Points](#tricky-points)
26. [Test Yourself](#test-yourself)
27. [Tricky Questions](#tricky-questions)
28. [Cheat Sheet](#cheat-sheet)
29. [Summary](#summary)
30. [What You Can Build](#what-you-can-build)
31. [Further Reading](#further-reading)
32. [Related Topics](#related-topics)
33. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> Focus: **At junior level you learned to crash. At middle level you learned the one place to recover. At senior level you set the *policy* — for an entire service — that decides crash vs. recover, abort vs. unwind, restart vs. degrade, and you make that policy a property of the architecture, not a habit scattered through call sites.**

The middle page taught the recover-at-boundary pattern as a *technique*. That technique is correct, but it is a single brick. The senior is the person who designs the whole wall: deciding whether a process should *ever* recover or should always crash and be restarted; whether the runtime should *unwind* (giving you a chance to catch and clean up) or *abort* (giving you a smaller binary and a guarantee that a corrupted process dies fast); whether failures should be contained by a `recover` or by a *supervisor* that kills and replaces the failing unit; and how a panic in one goroutine, thread, or async task propagates — or fails to propagate — to the units that depend on it.

The shift in altitude is the whole point. A mid-level engineer answers *"how do I recover here?"* A senior answers *"should this class of failure crash the process, and if so, what restarts it, and how fast, and what does it leave behind for the post-mortem?"* These are **design trade-offs with no universally correct answer** — they depend on whether your unit of isolation is a request, a process, or a container; on whether a restart is cheap (Kubernetes reschedules in 2 seconds) or catastrophic (a stateful leader holding a 40 GB in-memory index); on whether your shared state is recoverable or your only safe move after corruption is `panic = "abort"`.

This page is opinionated because the senior decision *requires* an opinion. The default it argues for: **crash-only design wherever a restart is cheap; unwind only at deliberate boundaries with documented cleanup; abort when corruption is unrecoverable; supervision over in-process recovery for anything stateful; and a panic policy written down once, enforced in review and lint, so ten thousand call sites inherit it instead of each re-deciding.**

> 🎓 **Why this matters for a senior:** The catastrophic outages in this space are never "we forgot a `try/catch`." They are "we recovered from a panic that had corrupted the shared ledger, and served wrong balances for six hours" or "we set `panic = "unwind"` and an FFI callback unwound across the C boundary into undefined behavior." The senior's job is to make the *policy* correct so the catastrophic class is impossible by construction.

---

## Prerequisites

- **Required:** All of [`junior.md`](junior.md) (the two-layer model, unwinding, when a program should crash) and [`middle.md`](middle.md) (recover-at-boundary, the four obligations, goroutine/thread escape, `catch_unwind` basics).
- **Required:** You have operated a service in production — you know what a rolling restart, a liveness probe, and a `CrashLoopBackOff` are, and roughly what they cost.
- **Required:** You understand process vs. thread vs. goroutine vs. async task, and that a panic's reach is bounded by *its* unit, not by your intent.
- **Required:** Comfort with at least two of: Go runtime, Rust panic strategies, JVM threading, Python's GIL/threading, Node's event loop and `worker_threads`.
- **Helpful:** Exposure to an actor/supervision model (Erlang/OTP, Akka, Elixir) — even just the vocabulary.
- **Helpful:** You've written or read a post-mortem where a swallowed or mis-handled panic was the root cause.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Fail-fast** | The policy that a process detects a bug or impossible state and *crashes immediately*, rather than continuing on degraded/corrupt state. |
| **Crash-only software** | A design (Candea & Fox, 2003) where the *only* way to stop a component is to crash it, and the *only* way to start it is recovery from a crash — making restart the sole, well-tested code path. |
| **Unwind** | A panic strategy where the stack is walked frame-by-frame, running destructors/`defer`/`finally`, so the panic can be *caught* at a boundary. Go always unwinds; Rust unwinds by default. |
| **Abort** | A panic strategy where the process terminates immediately (`SIGABRT`/`std::process::abort`) with no unwinding, no destructors, no catch. Rust `panic = "abort"`; `abort()` in C; Go `fatal error`. |
| **Supervisor** | A unit whose only job is to start, monitor, and *restart* child units when they crash. The Erlang/OTP and Akka core idea. |
| **Supervision tree** | A hierarchy of supervisors and workers where failures propagate *up* to a supervisor that decides the restart strategy, instead of being caught *in place*. |
| **Restart strategy** | The supervisor's policy: `one-for-one` (restart only the crashed child), `one-for-all` (restart all siblings), `rest-for-one`, plus `max_restarts`/intensity to trip a circuit. |
| **Let it crash** | The Erlang philosophy: don't write defensive code for every error; let the process die and let the supervisor restart it from a known-good state. |
| **Lock poisoning** | (Rust) When a thread panics while holding a `Mutex`/`RwLock`, the lock is marked *poisoned*; subsequent `lock()` calls return `Err(PoisonError)` to signal the data may be inconsistent. |
| **`catch_unwind`** | (Rust) Catches an unwinding panic at a boundary. Inert under `panic = "abort"`. |
| **Unwind across FFI** | Letting a panic/exception unwind across a foreign-function boundary (Rust↔C) — historically undefined behavior; now mitigated with `extern "C-unwind"` / `abort`-on-unwind shims. |
| **`uncaughtException`** | (Node) The process-level event fired when an error reaches the top of the stack uncaught. The runtime is now in an **undefined state**; the only safe action is log + exit. |
| **`unhandledRejection`** | (Node) A rejected promise with no `.catch`. Crashes the process by default in modern Node. |
| **`UncaughtExceptionHandler`** | (Java) Per-thread/JVM hook invoked when a thread dies from an uncaught `Throwable`. Runs *after* the thread is already dying. |
| **`GOTRACEBACK`** | (Go) Env var controlling how much detail a fatal panic dumps (`none`/`single`/`all`/`system`/`crash`). `crash` produces a core dump. |
| **`panic=`** | (Go) `GODEBUG`/runtime knobs; and the Rust `Cargo.toml` profile key (`panic = "unwind"` | `"abort"`). |
| **RTO / restart budget** | How long a restart takes end-to-end (detect → kill → reschedule → warm caches → ready). The number that decides whether crash-only is cheap or catastrophic. |

---

## Core Concepts

### 1. The decision is "crash vs. recover," and it is an *architecture* decision

At this level the question is never "how do I recover this one panic?" It is "for *this class* of failure, in *this* service, is the correct response to crash the process and let it be restarted, or to contain the failure in-process and keep running?" That answer depends on the **cost of a restart** and the **recoverability of the state** — two properties of your architecture, not of the call site. A stateless HTTP pod behind a load balancer: crashing is nearly free, prefer crash-only. A singleton leader holding a 40 GB in-memory index with a 6-minute warm-up: crashing is expensive, you lean toward in-process containment and very careful state management. The senior makes this call deliberately and writes it down.

### 2. Unwind buys you a catch point; abort buys you a guarantee

A runtime that **unwinds** runs destructors and gives you a place to `catch`/`recover` — but it also means a panic can be *caught and ignored*, and that destructors run while the program is in a half-broken state (a destructor touching corrupt data can make things worse). A runtime that **aborts** gives up the catch point entirely in exchange for one guarantee: *a process that hit an impossible state dies immediately and cannot limp on.* For security-sensitive or correctness-critical code, that guarantee is worth more than recoverability. The senior chooses per service, sometimes per build profile.

### 3. "Let it crash" is a *strategy*, not an abdication

Erlang's "let it crash" looks reckless until you see the other half: every process runs under a **supervisor** that restarts it from a known-good initial state. The genius is that *recovery becomes the only stop/start path*, so it is exercised constantly and is therefore reliable — unlike defensive cleanup code that runs once a year and is always buggy. "Let it crash" works *only* with supervision and cheap, stateless-or-checkpointed restart. Copy the philosophy only when you also copy the supervisor.

### 4. A panic's blast radius equals its concurrency unit — know the unit per runtime

The single most expensive senior mistake is misjudging *how far a panic reaches*:

| Runtime | Unit | An uncaught panic/exception in that unit… |
|---|---|---|
| Go | goroutine | …**crashes the whole process.** No per-goroutine isolation. |
| Rust | thread | …(unwind) terminates *that thread*, leaves others running; (abort) kills the process. |
| Java | thread | …terminates *that thread*; the JVM survives (unless it's a non-daemon main or an `Error` like OOM). |
| Python | thread | …terminates *that thread* (prints traceback); main process survives. |
| Node | event loop / Worker | …`uncaughtException` → **process is now undefined**, exit; a `Worker` thread crash is isolated from the main thread. |

Go is the outlier and the trap: it has *no* thread-level isolation, so every goroutine is a process-level liability unless individually guarded. Rust/Java/Python isolate at the thread; Node isolates at the Worker.

### 5. Recovering into corrupt state is the failure mode the whole topic exists to prevent

Containment is only legitimate when the failed unit was *isolated*. The moment a panic happens mid-mutation of shared state — a half-updated map, a lock held over an invariant that's now broken — recovering and *continuing* means running on corruption. Rust encodes this directly with **lock poisoning**: a panic while holding a `Mutex` poisons it, and every later `lock()` returns `Err`, forcing you to acknowledge the data may be inconsistent. Other languages give you no such signal — *you* must reason about it, and the correct move is usually to crash (re-panic / abort), not continue.

### 6. Set the policy once; don't make every call site decide

Ten thousand call sites cannot each correctly decide crash-vs-recover. The senior installs the decision in *infrastructure*: one recover boundary per request, one supervisor per worker class, one process-level last-resort handler, one `panic` strategy in the build profile, and lint/review rules that forbid ad-hoc `recover()`/`catch (Throwable)` in business code. The policy lives in a handful of places, is documented, and is enforced — so the property holds across the codebase by construction.

### 7. Every crash is also a post-mortem artifact — design the death

A process that must die should die *informatively*: dump goroutines/threads, capture the panic value and stack, write a core if it's cheap, increment a `panics_total` metric, and flush the crash reporter *before* exiting. `GOTRACEBACK=crash`, `-XX:+HeapDumpOnOutOfMemoryError`, a `SIGABRT` core — these turn an outage into evidence. The senior designs the moment of death as carefully as the happy path.

---

## Real-World Analogies

| Concept | Analogy |
|---|---|
| Fail-fast | A circuit breaker that trips the *instant* it senses a fault, rather than letting the wiring smoulder. |
| Crash-only | A vending machine with no "graceful shutdown" — you just cut power and it boots clean; there's no half-shutdown state to get stuck in. |
| Unwind vs. abort | Unwind = an orderly building evacuation (everyone exits via the stairs, running checklists); abort = the demolition charge (building down now, no checklists). |
| "Let it crash" + supervisor | A theatre with understudies — an actor collapses, the show pauses, the understudy steps in from a known starting mark. The play doesn't try to revive the fallen actor mid-scene. |
| Supervision tree | A military chain of command — a fallen soldier's *commander* decides the response, not the soldier next to them. |
| One-for-all restart | When the lead climber falls, the whole rope team resets to the last anchor — because their states are coupled. |
| Lock poisoning | A "DO NOT USE — possibly contaminated" tag slapped on equipment the moment the operator collapsed while handling it. |
| Panic across FFI | Shouting in a language the other country's border guard doesn't speak — the protocol breaks down; undefined what happens next. |
| `uncaughtException` in Node | A pilot who just realized the instruments are lying — you don't keep flying "carefully," you declare emergency and land. |

---

## Mental Models

### Model 1: "The blast radius dial"

Every failure-handling decision is really setting a dial: **how far does this failure propagate before something stops it?** Turn it all the way down and every error is caught locally (defensive, hides bugs, the middle-level anti-pattern). Turn it all the way up and every error kills the process (fail-fast, maximally honest, expensive if restart is slow). The senior sets the dial *per failure class and per restart cost*. Cheap restart → turn it up (crash-only). Expensive restart of irreplaceable state → turn it down a notch, but then you owe rigorous state management. The dial is a design knob, not a default.

### Model 2: "Unwind is a hallway, abort is a trapdoor"

When a panic fires, unwinding walks you back down the hallway of stack frames, opening each door (running each destructor/`defer`/`finally`) on the way out — slow, orderly, and *catchable* at the front door. Abort is a trapdoor: the floor opens and the process is gone, no doors opened, nothing run, nothing caught. You want the hallway when cleanup matters and the boundary can sanely recover. You want the trapdoor when the process is already corrupt and running *any* more code (including destructors over bad data) is dangerous.

### Model 3: "Recovery is a quarantine decision, not a cure"

When a unit fails, you are a public-health officer deciding the *quarantine boundary*, not a doctor curing the patient. Where do you draw the line so the infection (corrupt state, the bug) cannot spread? A `recover` quarantines at the request. A supervisor quarantines at the process. `panic = "abort"` quarantines by burning the whole building — guaranteeing the infection dies with it. The wrong quarantine boundary (recovering *inside* the infected region — past the corrupt mutation) doesn't contain anything; it just lets you keep running infected. The skill is drawing the boundary *outside* the corruption.

---

## Fail-Fast vs. Recover — The Real Decision

The middle page's rule — "default to crash, recover only at boundaries" — is correct but incomplete. The senior decision is a *function of three variables*:

| Variable | Pushes toward **fail-fast (crash)** | Pushes toward **recover (contain)** |
|---|---|---|
| **Cost of restart** | Cheap: stateless pod, k8s reschedules in seconds | Expensive: large in-memory state, slow warm-up, leader election |
| **Recoverability of state** | State may be corrupt / invariant broken | State is provably isolated (per-request, immutable) |
| **Blast radius of continuing** | One process; siblings unaffected | Continuing endangers shared data / other users |

The decision matrix:

```text
                       │ restart is CHEAP        │ restart is EXPENSIVE
   ────────────────────┼─────────────────────────┼──────────────────────────
   state may be CORRUPT │ CRASH (fail-fast).      │ CRASH anyway — corrupt +
                        │ Cheapest + safest.      │ expensive still beats
                        │                         │ serving wrong data.
   ────────────────────┼─────────────────────────┼──────────────────────────
   state is ISOLATED    │ Either works; prefer    │ RECOVER at boundary.
                        │ crash-only for          │ Containment avoids a
                        │ simplicity.             │ pricey restart, and it's
                        │                         │ safe because isolated.
```

The one cell where recovery is the *clear* winner is bottom-right: **isolated state + expensive restart.** That's the request boundary in a server holding warm caches — exactly the middle-level pattern. Everywhere else, fail-fast is at least competitive and usually simpler. The top row — *corrupt state* — is non-negotiable: **never recover-and-continue past corruption,** regardless of restart cost. Serving wrong data is worse than any restart.

> The senior's bias: **when in doubt, crash.** A crash is loud, honest, and bounded. A wrong recovery is quiet, dishonest, and unbounded. You can always *add* a recover boundary later when you've proven isolation; you cannot un-corrupt a ledger.

### The "is this an `Err` or a panic" boundary, revisited at scale

A senior also owns the *upstream* decision: which failures are recoverable Layer-1 errors (`Result`/`error`/exceptions you handle) versus unrecoverable Layer-2 panics. The rule scales: **anything an operator/caller could plausibly respond to is an error; anything that means "a programmer's assumption is false" is a panic.** A 404 is an error. A `nil` where your invariant guaranteed non-nil is a panic. Drawing this line *consistently across a service* is a senior responsibility — see [Error Handling — Senior](../error-handling/senior.md) for the error half of this boundary.

---

## Abort vs. Unwind — The Runtime Policy

Unwinding is not free, and it is not always safe. The senior chooses the panic *strategy* deliberately, per language and sometimes per build.

### Rust — `panic = "unwind"` vs `panic = "abort"`

```toml
# Cargo.toml — the policy lives here, set once for the whole binary.
[profile.release]
panic = "abort"   # default is "unwind"
```

| | `panic = "unwind"` (default) | `panic = "abort"` |
|---|---|---|
| Destructors on panic | Run (stack unwinds) | **Not run** — process dies immediately |
| `catch_unwind` | Works | **Inert** — nothing to catch |
| Binary size | Larger (unwind tables) | Smaller (no landing pads) |
| Per-panic cost | Higher (frame-by-frame walk) | Zero (just `abort`) |
| Corruption guarantee | None — a panic can be caught & ignored | **A panicking process dies, period** |
| FFI safety | Risk of unwinding across C (UB unless `C-unwind`) | Safe: never unwinds across FFI |

**When a senior picks `abort`:**

- The binary is a leaf service where a restart is cheap and you want the *smallest, fastest* binary and the strongest "corruption → death" guarantee (much of the embedded and security world, and many CLI tools).
- You link heavily with C and don't want to reason about unwinding across FFI at all.
- You have *no* legitimate `catch_unwind` boundary (no thread-pool isolation, no test-harness catch) — then unwinding only buys you risk.

**When a senior keeps `unwind`:**

- You run a thread pool / worker model that isolates panics per worker via `catch_unwind` (a Rust web server, a `rayon` job runner) — you *need* the catch point.
- You're a library: **libraries should not assume `abort`** because the final binary chooses the strategy. Write code correct under both.

```rust
// A worker that ISOLATES panics — only meaningful under panic = "unwind".
use std::panic::{self, AssertUnwindSafe};

fn run_job(job: Job) -> JobOutcome {
    let result = panic::catch_unwind(AssertUnwindSafe(|| process(job)));
    match result {
        Ok(out) => out,
        Err(payload) => {
            let msg = downcast_panic(&payload);
            tracing::error!(panic = %msg, job_id = %job.id, "worker job panicked");
            metrics::counter!("worker.panics").increment(1);
            JobOutcome::Failed                 // CONTAIN: this job dies, pool lives
        }
    }
    // Under panic = "abort", this catch_unwind never fires and the WHOLE
    // process dies on the first panicking job. If your design depends on
    // per-job isolation, you MUST keep panic = "unwind".
}

fn downcast_panic(p: &Box<dyn std::any::Any + Send>) -> String {
    p.downcast_ref::<&str>().map(|s| s.to_string())
        .or_else(|| p.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "non-string panic payload".into())
}
```

> The trap: a team sets `panic = "abort"` for a smaller binary, *then* someone adds a `catch_unwind`-based worker pool expecting isolation. It compiles. It "works" in dev (no panics). In production the first panicking job kills the whole process. **The panic strategy and the isolation design must agree, and that agreement must be a written, reviewed decision.**

### Go — always unwinds, but `fatal error` cannot be recovered

Go always unwinds for `panic`, so `recover` always works *for panics*. But Go has a second, non-recoverable class: **fatal runtime errors** — concurrent map writes, stack overflow, out-of-memory, a deadlock detected by the runtime. These print `fatal error:` (not `panic:`) and **cannot be recovered** — they're Go's `abort`. You do not get to choose; the runtime decides which failures are recoverable.

```go
// This is a PANIC — recoverable.
var p *int
_ = *p                      // panic: runtime error: invalid memory address

// This is a FATAL ERROR — NOT recoverable, no recover() will catch it.
m := map[int]int{}
go func() { for { m[1] = 1 } }()
go func() { for { m[2] = 2 } }()   // fatal error: concurrent map writes
```

The senior knob is `GOTRACEBACK`, which governs how a fatal/uncaught panic *dies*:

```bash
GOTRACEBACK=all    ./svc   # dump ALL goroutine stacks (default for most services)
GOTRACEBACK=crash  ./svc   # dump all stacks AND produce a core dump (SIGABRT)
```

Set `GOTRACEBACK=crash` on services where a core dump is worth the disk — it converts a fatal crash into a debuggable artifact. See [Crash Reporting — Senior](../crash-reporting/senior.md) for turning these into tickets.

### Java — unwinds, but `Error` is the "abort-ish" tier

The JVM always unwinds (`finally`/try-with-resources run). The senior distinction is `Exception` vs `Error`: `RuntimeException` is a recoverable-at-boundary panic-analogue; `Error` (`OutOfMemoryError`, `StackOverflowError`, `LinkageError`) signals the *JVM itself* may be doomed. Catching `Error` to "keep serving" is the Java version of recovering into corruption — you can catch it for *one request's* 500, but don't pretend the JVM is healthy.

### Node — you don't unwind a corrupt event loop

Node has no "abort vs unwind" knob, but it has the same *principle* baked into its docs: after `uncaughtException`, **the process is in an undefined state** and the only correct action is to log, flush, and exit. There is no safe "resume the event loop." `worker_threads` are Node's isolation primitive — a crashing Worker doesn't kill the main process (covered below).

---

## Crash-Only Software

**Crash-only software** (Candea & Fox, USENIX HotOS 2003) is the design philosophy underneath modern cloud-native services, and it's the senior's default for stateless components. The thesis:

> *Make crashing the only way to stop, and recovery the only way to start. Then recovery is exercised on every start, so it is always correct — and you delete all the buggy "graceful shutdown" code that never ran anyway.*

The implications for how you design panic/recovery:

1. **No graceful-shutdown path to maintain.** If `kill -9` and a clean `SIGTERM` lead to the *same* recovery on next boot, you don't have two code paths to keep correct. Half the "shutdown hook" bugs in the world come from a graceful path that diverges from the crash path.
2. **Every restart is from a known-good state.** State lives in durable stores (DB, queue, object store) or is reconstructable. The process holds only *derived* state it can rebuild. This is what makes "let it crash" safe.
3. **Idempotency everywhere.** Because a crash can happen mid-operation, every operation must be safe to retry after restart. (See [Retry Pattern](../../code-craft/coding-patterns/README.md) and the `retry-pattern` skill.)
4. **Fast, bounded recovery.** Crash-only is only cheap if recovery is fast. A 6-minute warm-up turns "let it crash" into a 6-minute outage. Crash-only pushes you toward *checkpointing* and *lazy* state loading.

```text
   GRACEFUL-CENTRIC DESIGN              CRASH-ONLY DESIGN
   ───────────────────────             ─────────────────
   start ──► run ──► graceful stop      start = recover ──► run ──► CRASH
                │         │                  ▲                         │
                │      (buggy, rare)         └─────────────────────────┘
                └──► sometimes crash         one path, always tested
   two stop paths, one untested         one stop path, always tested
```

Kubernetes is a crash-only system by construction: liveness probes *kill* unhealthy pods, the scheduler *recreates* them, and there is no "pause and fix in place." When you design for k8s, **lean into crash-only**: prefer `panic`/crash + restart over elaborate in-process recovery, *as long as* your restart is cheap and your state is durable. The famous anti-pattern is `CrashLoopBackOff` — crash-only degrades badly when recovery *isn't* fast or the crash is deterministic (the pod crashes, restarts, crashes again on the same poison input). Crash-only assumes restart eventually succeeds; pair it with poison-input handling and a dead-letter path.

> **Senior judgment:** crash-only is the right default for stateless and checkpoint-able services. It is *wrong* for a stateful singleton where a restart loses 40 GB of irreplaceable in-memory state and takes minutes to rebuild — there, you invest in in-process resilience and very careful corruption detection. Know which kind of service you're holding.

---

## Supervision — Letting a Tree Restart What Crashed

The most important idea this page imports from outside the "recover" mindset: **don't catch the failure in place — let it propagate up to a supervisor whose entire job is to restart the failed unit from a known-good state.** This is the Erlang/OTP model, copied by Akka, Elixir, and (in spirit) by Kubernetes.

### Why supervision beats in-place recovery for stateful units

In-place `recover` says: *"I caught the panic; I'll patch up and continue."* But continuing from a half-failed state is exactly the corruption risk. Supervision says: *"the unit failed; throw it away and start a fresh one from a clean initial state."* The fresh unit has *no* corrupt state because it never touched the bad input. Recovery-by-replacement sidesteps the corruption question entirely.

### Restart strategies (OTP/Akka vocabulary every senior should know)

| Strategy | Behavior | Use when |
|---|---|---|
| **one-for-one** | Restart only the crashed child | Children are independent (typical worker pool) |
| **one-for-all** | Restart *all* children when any crashes | Children share coupled state; one's death invalidates the rest |
| **rest-for-one** | Restart the crashed child + those started after it | Children form a dependency chain |
| **max_restarts / intensity** | If a child crashes more than N times in T seconds, the *supervisor* gives up and escalates upward | Always — this is the circuit breaker that stops a restart storm (`CrashLoopBackOff` analogue) |

The `max_restarts` parameter is the senior's safety valve: it converts "let it crash" from an infinite-retry footgun into a bounded one. If a worker crashes 5 times in 10 seconds, the input is *deterministically* poisoned — restarting again is pointless, so the supervisor escalates (dead-letters the input, alerts, or itself crashes up to *its* supervisor).

### A supervised worker pool in Go (no actor framework needed)

You don't need Akka to apply supervision thinking. Here's a supervisor goroutine that restarts a worker when it panics, with a restart budget that trips:

```go
// Supervise runs `work` in a goroutine, restarting it when it panics,
// up to maxRestarts within window. Past the budget, it gives up and
// escalates (returns an error to ITS caller — the next supervisor up).
func Supervise(ctx context.Context, name string, maxRestarts int, window time.Duration, work func(context.Context)) error {
	var restarts []time.Time
	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		crashed := runGuarded(ctx, name, work) // returns true if it panicked
		if !crashed {
			return nil // clean exit, nothing to restart
		}

		now := time.Now()
		restarts = append(restarts, now)
		// Drop restarts outside the window.
		cutoff := now.Add(-window)
		i := 0
		for ; i < len(restarts) && restarts[i].Before(cutoff); i++ {
		}
		restarts = restarts[i:]

		if len(restarts) > maxRestarts {
			// Restart budget exceeded: the failure is persistent, not transient.
			// Escalate instead of looping forever (the CrashLoopBackOff lesson).
			slog.Error("supervisor giving up; restart intensity exceeded",
				"worker", name, "restarts", len(restarts), "window", window)
			metrics.SupervisorGaveUp.WithLabelValues(name).Inc()
			return fmt.Errorf("worker %q exceeded restart budget (%d in %s)", name, maxRestarts, window)
		}

		backoff := time.Duration(len(restarts)) * 200 * time.Millisecond
		slog.Warn("restarting crashed worker", "worker", name, "restart", len(restarts), "backoff", backoff)
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(backoff):
		}
	}
}

// runGuarded runs work, recovering+logging+reporting a panic, returning
// whether it panicked. This is the recover-at-boundary brick from middle.md,
// now used as the supervisor's failure DETECTOR — not as the resilience itself.
func runGuarded(ctx context.Context, name string, work func(context.Context)) (panicked bool) {
	defer func() {
		if rec := recover(); rec != nil {
			panicked = true
			stack := debug.Stack()
			slog.Error("worker panicked", "worker", name, "panic", rec, "stack", string(stack))
			report.Capture(rec, stack, name) // crash reporter — see crash-reporting/
		}
	}()
	work(ctx)
	return false
}
```

The structural insight: the `recover` is *not* the resilience strategy — it's the supervisor's *failure detector*. The resilience comes from **restart-from-clean-state plus a bounded restart budget.** This is "let it crash" implemented in Go.

### Erlang/Elixir — the real thing

```elixir
# A supervisor restarting up to 3 crashes in 5 seconds, one_for_one.
# Past the budget, THIS supervisor itself crashes up to its parent.
children = [
  {Worker, []},
  {Worker, []}
]

Supervisor.init(children,
  strategy: :one_for_one,
  max_restarts: 3,
  max_seconds: 5
)
```

In OTP, the worker code itself is written *without* defensive error handling — it just does the happy path and lets a bad message crash it. The supervisor restarts it. This is only safe because (a) restart is microseconds, (b) state is held in a separate, supervised process or an external store, and (c) `max_restarts` stops a poison-message storm.

> **The portable lesson, even if you never write Erlang:** prefer *restart-from-clean-state* over *recover-and-continue* for any unit whose state might be corrupt — and always bound the restarts. Kubernetes liveness probes + `restartPolicy` + `CrashLoopBackOff` are this exact pattern at the container level.

---

## Panic Propagation Across Concurrency Units

The middle page warned that "a recover only catches its own goroutine." At senior level you need the full propagation matrix and the idiomatic *structured-concurrency* fixes per runtime.

### Go — goroutines do not propagate, they detonate

A panic in a goroutine that isn't recovered **crashes the entire process** — there is no thread-level isolation, and the parent goroutine cannot catch a child's panic. This is Go's sharpest edge.

```go
// WRONG: the request boundary's recover does NOT protect this goroutine.
func handler(w http.ResponseWriter, r *http.Request) {
	go doAsyncWork()       // if this panics → WHOLE PROCESS DIES
	w.Write([]byte("accepted"))
}
```

Structured-concurrency fix with `errgroup` — panics still don't propagate as errors automatically (a panic isn't an `error`), so wrap:

```go
// errgroup gives you cancellation + error collection, but a PANIC in a
// goroutine is not an error — it still crashes the process. Convert it.
g, ctx := errgroup.WithContext(ctx)
for _, job := range jobs {
	job := job
	g.Go(func() (err error) {
		defer func() {
			if rec := recover(); rec != nil {
				err = fmt.Errorf("panic in job %s: %v\n%s", job.ID, rec, debug.Stack())
			}
		}()
		return process(ctx, job)
	})
}
if err := g.Wait(); err != nil {   // panic now arrives as a normal error
	return err
}
```

> Go 1.23's `errgroup` and most libraries still do **not** auto-recover goroutine panics. The senior bans raw `go fn()` for panic-prone work via lint and provides a `SafeGo`/guarded-`errgroup` wrapper. One missed `go fn()` is a process-wide outage waiting for the wrong input.

### Rust — threads isolate, async tasks return the panic as `Err`

A panic in a spawned **thread** terminates only that thread (under unwind); `JoinHandle::join()` returns `Err` carrying the payload:

```rust
let handle = std::thread::spawn(|| {
    panic!("worker exploded");        // terminates THIS thread only (unwind)
});
match handle.join() {
    Ok(_) => {}
    Err(payload) => {
        // The panic propagates to the PARENT here, as an Err — not a crash.
        eprintln!("worker thread panicked: {}", downcast_panic(&payload));
    }
}
```

Tokio **tasks** are even cleaner — a panic in a task is captured and surfaced through the `JoinHandle`:

```rust
let handle = tokio::spawn(async {
    panic!("task exploded");
});
match handle.await {
    Ok(_) => {}
    Err(join_err) if join_err.is_panic() => {
        // The task panicked; the runtime caught it. Other tasks keep running.
        tracing::error!("task panicked: {:?}", join_err);
    }
    Err(_) => { /* task was cancelled */ }
}
```

This is why Rust's concurrency story is safer here than Go's: the runtime *captures* the panic at the task boundary and hands it to you as a `Result`, instead of detonating the process. But note: a detached task whose `JoinHandle` you drop swallows the panic silently — the senior keeps the handle or uses a `JoinSet` so panics aren't lost.

### Java — threads isolate; wire an `UncaughtExceptionHandler` and prefer pools

A panic (uncaught `RuntimeException`) in a `Thread` kills *that* thread; the JVM lives. But the death is silent unless you install a handler:

```java
// Global safety net for raw threads.
Thread.setDefaultUncaughtExceptionHandler((thread, throwable) -> {
    log.error("uncaught in thread {}", thread.getName(), throwable);
    Sentry.captureException(throwable);
    panicCounter.increment();
});
```

The subtle trap: with an `ExecutorService`, a task that throws is handled differently depending on submission:

```java
ExecutorService pool = Executors.newFixedThreadPool(4);

pool.execute(() -> { throw new RuntimeException("boom"); });
//   ^ execute(): the worker thread dies, UncaughtExceptionHandler fires,
//     the pool quietly replaces the thread. You SEE it (if handler installed).

Future<?> f = pool.submit(() -> { throw new RuntimeException("boom"); });
//   ^ submit(): the exception is SWALLOWED into the Future. The worker
//     thread does NOT die, no handler fires. You only learn of it when
//     you call f.get() — which most people forget. SILENT failure.
```

> **Senior gotcha that has caused real incidents:** `ExecutorService.submit()` *eats* the exception into the returned `Future`. If you never call `Future.get()`, the failure vanishes. Always either `get()` the future or override `afterExecute`/use `execute()` for fire-and-forget so the handler fires.

### Python — threads isolate; `threading.excepthook` centralizes; multiprocessing differs

An uncaught exception in a `threading.Thread` prints a traceback and kills *that thread*; the process survives. Centralize reporting:

```python
import threading, sys, logging
log = logging.getLogger(__name__)

def thread_hook(args):
    log.error("uncaught in thread %s", args.thread.name,
              exc_info=(args.exc_type, args.exc_value, args.exc_traceback))
    sentry_sdk.capture_exception(args.exc_value)

threading.excepthook = thread_hook        # 3.8+, for THREAD exceptions
sys.excepthook = lambda *a: log.error("uncaught in main", exc_info=a)  # MAIN thread
```

`concurrent.futures` mirrors Java's `submit` trap: an exception in a `ThreadPoolExecutor`/`ProcessPoolExecutor` task is stored in the `Future` and re-raised only on `future.result()`. With `ProcessPoolExecutor`, a worker that *segfaults* (not a Python exception) brings down the pool with a `BrokenProcessPool` — a true crash, not a catchable exception.

### Node — `uncaughtException` means "exit," and `worker_threads` are the isolation unit

After `uncaughtException`, **the event loop is in an undefined state.** The documented-correct handler logs, flushes, and *exits* — it does **not** resume:

```js
process.on("uncaughtException", (err, origin) => {
  // The process is now in an UNDEFINED state. Do NOT resume the event loop.
  log.fatal({ err, origin }, "uncaughtException — exiting");
  Sentry.captureException(err);
  flushTelemetrySync();
  process.exit(1);            // let the supervisor (pm2/k8s) restart a clean process
});

process.on("unhandledRejection", (reason) => {
  // Modern Node crashes on this by default; handle it the same way.
  log.fatal({ reason }, "unhandledRejection — exiting");
  Sentry.captureException(reason);
  flushTelemetrySync();
  process.exit(1);
});
```

For true isolation, Node's unit is the **Worker thread** — a crash in a Worker does *not* kill the main process:

```js
const { Worker } = require("node:worker_threads");

const worker = new Worker("./risky-task.js");
worker.on("error", (err) => {
  // The Worker threw uncaught — the worker thread is gone, MAIN survives.
  log.error({ err }, "worker crashed; respawning");
  metrics.workerCrashes.inc();
  spawnReplacementWorker();          // supervision at the Worker level
});
worker.on("exit", (code) => {
  if (code !== 0) log.warn({ code }, "worker exited nonzero");
});
```

This is Node's version of the supervision pattern: run risky/CPU-bound work in a `Worker`, treat a Worker crash as a recoverable event in the main thread, respawn from clean state.

### The propagation matrix, consolidated

| Runtime | Spawn primitive | Uncaught panic propagates to parent as… | Process survives? |
|---|---|---|---|
| Go | `go fn()` | **nothing** — process crashes | ❌ No (must self-recover) |
| Go | `errgroup` (with manual recover) | an `error` from `Wait()` | ✅ if you wrap |
| Rust | `thread::spawn` | `Err` from `join()` (unwind) | ✅ Yes |
| Rust | `tokio::spawn` | `JoinError{is_panic}` from `await` | ✅ Yes |
| Java | `new Thread` | `UncaughtExceptionHandler` (after thread dies) | ✅ Yes |
| Java | `executor.submit` | stored in `Future`, re-raised on `get()` (**silent if never get**) | ✅ Yes |
| Python | `threading.Thread` | `threading.excepthook` (after thread dies) | ✅ Yes |
| Python | `ProcessPoolExecutor` (segfault) | `BrokenProcessPool` | ❌ pool broken |
| Node | `uncaughtException` | event — **process must exit** | ❌ exit & restart |
| Node | `worker_threads` | `'error'` event on the Worker | ✅ main survives |

---

## Lock Poisoning and Corrupt-State Detection

The whole topic's nightmare is *recovering into corruption.* Rust is the only mainstream language that detects this for you, via **lock poisoning** — and understanding it teaches the principle every language needs.

### Rust — a panic while holding a lock poisons it

```rust
use std::sync::Mutex;

let data = Mutex::new(Vec::<i32>::new());

// Thread A: panics WHILE holding the lock, mid-mutation.
let result = std::thread::spawn(|| {
    let mut guard = data.lock().unwrap();
    guard.push(1);
    panic!("crashed mid-mutation");   // the Vec may now be in a half-updated state
    // guard dropped during unwind → the Mutex is now POISONED
}).join();

// Thread B (or later code): the lock REMEMBERS that a panic occurred while held.
match data.lock() {
    Ok(guard) => use_data(&guard),
    Err(poisoned) => {
        // The data MAY be inconsistent. Rust forces you to acknowledge it.
        tracing::error!("lock poisoned — data may be corrupt");
        // Option 1: recover the data anyway, accepting the risk:
        let guard = poisoned.into_inner();
        // Option 2 (often correct): propagate / crash — don't trust the data.
    }
}
```

The design lesson is profound: **poisoning makes "did a panic leave this shared state inconsistent?" a question the type system forces you to answer.** Every other language leaves that question implicit, and the default human answer ("eh, probably fine, keep going") is the bug.

> Note: there's an ongoing debate that poisoning is over-eager (most code `.unwrap()`s the poison and ignores it), and some prefer `parking_lot::Mutex` which *doesn't* poison. The senior view: poisoning is a *correctness prompt*. If you `into_inner()` away every poison without thinking, you've reintroduced the exact bug poisoning exists to catch.

### Every other language — *you* are the poison detector

There is no automatic poisoning in Go, Java, Python, or Node. The discipline must be manual:

```go
// Manual "poisoning" — re-panic when a panic happened mid-mutation under a lock.
func (l *Ledger) Apply(tx Transaction) {
	l.mu.Lock()
	defer l.mu.Unlock()
	defer func() {
		if rec := recover(); rec != nil {
			slog.Error("panic mid-ledger-mutation; state may be corrupt",
				"panic", rec, "stack", string(debug.Stack()))
			report.Capture(rec, debug.Stack(), tx)
			// The ledger may be half-written and we hold no signal that it's clean.
			// CRASH rather than serve a corrupt ledger. This is manual poisoning.
			panic(rec)        // re-panic: process dies, supervisor restarts clean
		}
	}()
	l.balance += tx.Amount   // if a panic fires between these two lines,
	l.audit = append(l.audit, tx) //   the ledger is inconsistent
}
```

The senior generalizes: **any shared mutable state guarded by a lock needs a documented answer to "what happens if we panic mid-mutation?"** The default answer should be *crash*, because continuing is unfalsifiable corruption. Reserve recover-and-continue for state you can *prove* is either untouched or transactional (e.g., a copy-on-write swap that's atomic, so a panic before the swap leaves the original intact).

```go
// Corruption-proof by design: build a NEW value, swap atomically at the end.
// A panic before the swap leaves the old value fully intact — nothing to poison.
func (c *Config) Reload(raw []byte) error {
	next, err := parse(raw)   // if this panics, c.current is untouched
	if err != nil {
		return err
	}
	c.current.Store(next)     // single atomic swap — no half-state ever observable
	return nil
}
```

> The deepest senior move isn't detecting corruption after the fact — it's *designing it out*: copy-on-write, atomic swap, transactional updates, immutable data. If a panic can never leave observable half-state, the whole "recover into corruption" question disappears. See the `immutability-patterns` skill.

---

## Process-Level Last-Resort Handlers

Below the boundary recoveries sits one final net: the process-level handler that fires when *everything else* missed. Its job is **not** to keep running — it's to die *informatively and cleanly*.

| Runtime | Last-resort hook | Correct action |
|---|---|---|
| Go | a top-level `defer recover()` in `main`; `GOTRACEBACK`; `debug.SetTraceback` | log + flush reporter + (usually) re-panic/exit; can't truly "continue" |
| Rust | `std::panic::set_hook` | log/report in the hook; the hook runs *before* unwind/abort |
| Java | `Thread.setDefaultUncaughtExceptionHandler` | log + report; thread is already dying |
| Python | `sys.excepthook` + `threading.excepthook` + `faulthandler` | log + report; for segfaults, `faulthandler.enable()` |
| Node | `process.on('uncaughtException' / 'unhandledRejection')` | log + flush + **`process.exit(1)`** |

Rust's `panic::set_hook` is especially useful because it runs *before* the unwind/abort decision — so it works even under `panic = "abort"`:

```rust
use std::panic;

fn install_panic_hook() {
    let default = panic::take_hook();
    panic::set_hook(Box::new(move |info| {
        // Runs on EVERY panic, BEFORE unwinding/aborting — works under abort too.
        let location = info.location().map(|l| format!("{}:{}", l.file(), l.line()))
            .unwrap_or_else(|| "unknown".into());
        let msg = info.payload().downcast_ref::<&str>().copied().unwrap_or("?");
        tracing::error!(%location, panic = %msg, "PANIC");
        crash_reporter::capture_panic(info);    // ship to Sentry BEFORE we die
        default(info);                           // keep the default backtrace print
    }));
}
```

> The senior rule for last-resort handlers: **they report, they don't resuscitate.** A process that reached the last-resort handler hit a state nobody anticipated — the safe assumption is that it's corrupt. Flush telemetry, capture the crash, exit non-zero, let the supervisor restart clean.

---

## Designing the Panic Policy for a Service

Bring it together: the senior deliverable is a **written panic policy** that every engineer on the team inherits. A real one reads like this:

```text
   ┌──────────────────── ORDERS-SERVICE PANIC POLICY ────────────────────┐
   │                                                                     │
   │  1. CLASSIFICATION                                                  │
   │     • Caller-recoverable failure  → return error (Layer 1)          │
   │     • Broken programmer invariant → panic (Layer 2)                 │
   │     • Runtime-fatal (concurrent map write, OOM) → let it die        │
   │                                                                     │
   │  2. RECOVER BOUNDARIES (the ONLY recover sites)                     │
   │     • HTTP middleware  → log+report+500, server lives               │
   │     • Worker, per-job  → log+report+dead-letter, pool lives         │
   │     • Every spawned goroutine via SafeGo (lint-enforced)            │
   │                                                                     │
   │  3. CRASH-vs-CONTAIN MATRIX                                         │
   │     • Stateless path + cheap restart → prefer CRASH (crash-only)    │
   │     • Mid-mutation under a lock      → CRASH (manual poisoning)     │
   │     • Isolated request + warm caches → CONTAIN at boundary          │
   │                                                                     │
   │  4. RUNTIME STRATEGY                                                │
   │     • Go: GOTRACEBACK=crash in prod (core dump)                     │
   │     • Rust libs: correct under unwind AND abort                     │
   │     • Rust bins: panic=abort UNLESS a catch_unwind worker pool      │
   │                                                                     │
   │  5. SUPERVISION                                                     │
   │     • Worker classes run under Supervise(max=5/30s) → escalate      │
   │     • k8s liveness probe kills + reschedules (crash-only)           │
   │     • CrashLoopBackOff alert wired to on-call                       │
   │                                                                     │
   │  6. ON DEATH                                                        │
   │     • flush crash reporter, dump goroutines, panics_total++ THEN exit│
   │                                                                     │
   │  ENFORCEMENT: lint bans raw `go fn()`, empty recover, catch(Throwable)│
   │               in business code; CI greps for silent swallows.        │
   └─────────────────────────────────────────────────────────────────────┘
```

The point of writing it down: the policy becomes a **property of the codebase**, checked in review and lint, instead of a decision re-litigated at every call site by engineers of varying experience.

---

## Code Examples

### Go — a complete supervised, crash-only-friendly worker service

```go
package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"runtime/debug"
	"syscall"
	"time"
)

// SafeGo: the ONLY sanctioned way to spawn a goroutine. Lint bans raw `go`.
func SafeGo(name string, fn func()) {
	go func() {
		defer func() {
			if rec := recover(); rec != nil {
				slog.Error("goroutine panic", "name", name,
					"panic", rec, "stack", string(debug.Stack()))
				report.Capture(rec, debug.Stack(), name)
				// A bare spawned goroutine has no supervisor; for THIS process
				// we let a leaked panic die loudly rather than silently continue.
			}
		}()
		fn()
	}()
}

// Supervise restarts `work` on panic, bounded by a restart budget.
func Supervise(ctx context.Context, name string, work func(context.Context)) error {
	const maxRestarts, window = 5, 30 * time.Second
	var crashes []time.Time
	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if !runGuarded(ctx, name, work) {
			return nil
		}
		now := time.Now()
		crashes = append(crashes, now)
		cutoff := now.Add(-window)
		for len(crashes) > 0 && crashes[0].Before(cutoff) {
			crashes = crashes[1:]
		}
		if len(crashes) > maxRestarts {
			return fmt.Errorf("worker %q exceeded restart budget", name) // escalate
		}
		slog.Warn("restarting worker", "name", name, "count", len(crashes))
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(time.Duration(len(crashes)) * 200 * time.Millisecond):
		}
	}
}

func runGuarded(ctx context.Context, name string, work func(context.Context)) (panicked bool) {
	defer func() {
		if rec := recover(); rec != nil {
			panicked = true
			slog.Error("worker panic", "name", name, "panic", rec, "stack", string(debug.Stack()))
			report.Capture(rec, debug.Stack(), name)
		}
	}()
	work(ctx)
	return false
}

func main() {
	// GOTRACEBACK=crash should be set in the environment for a core dump.
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer stop()

	// Supervised worker; if it blows its restart budget, the whole process
	// exits non-zero — and k8s restarts it clean (crash-only at the container).
	if err := Supervise(ctx, "order-consumer", consumeOrders); err != nil {
		slog.Error("supervisor escalated; exiting for a clean restart", "err", err)
		os.Exit(1)
	}
}

func consumeOrders(ctx context.Context) { /* pull jobs; a poison job panics → restart */ }
```

### Rust — a thread pool that isolates panics, with poisoning awareness

```rust
use std::panic::{self, AssertUnwindSafe};
use std::sync::{Arc, Mutex};

struct Pool {
    state: Arc<Mutex<Stats>>,   // shared, lock-protected — poisoning matters here
}

impl Pool {
    fn run_job(&self, job: Job) {
        let state = Arc::clone(&self.state);
        // catch_unwind isolates this job's panic to the pool (needs panic="unwind").
        let outcome = panic::catch_unwind(AssertUnwindSafe(|| process(job)));
        match outcome {
            Ok(()) => {
                // Update shared stats; if the lock is poisoned, a PRIOR job panicked
                // mid-mutation — the stats may be inconsistent. Decide explicitly.
                match state.lock() {
                    Ok(mut s) => s.completed += 1,
                    Err(poisoned) => {
                        tracing::error!("stats lock poisoned; refusing to trust counters");
                        // We choose to crash this pool rather than report wrong stats.
                        let _ = poisoned; // not into_inner() — we don't trust it
                        std::process::abort();
                    }
                }
            }
            Err(payload) => {
                tracing::error!("job panicked: {}", downcast_panic(&payload));
                metrics::counter!("pool.job_panics").increment(1);
                // The job is contained; the pool keeps running OTHER jobs.
            }
        }
    }
}

fn downcast_panic(p: &Box<dyn std::any::Any + Send>) -> String {
    p.downcast_ref::<&str>().map(|s| s.to_string())
        .or_else(|| p.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "non-string panic".into())
}
# struct Job; struct Stats { completed: u64 } fn process(_: Job) {}
```

### Java — supervised executor with visible failures

```java
// A ThreadPoolExecutor that does NOT swallow task failures (the submit() trap).
public class SupervisedPool extends ThreadPoolExecutor {
    private static final Logger log = LoggerFactory.getLogger(SupervisedPool.class);

    public SupervisedPool(int n) {
        super(n, n, 0L, TimeUnit.MILLISECONDS, new LinkedBlockingQueue<>());
    }

    @Override
    protected void afterExecute(Runnable r, Throwable t) {
        super.afterExecute(r, t);
        // For execute(): t carries the throwable.
        // For submit(): the throwable hid inside the Future — dig it out.
        if (t == null && r instanceof Future<?> f && f.isDone()) {
            try {
                f.get();
            } catch (CancellationException ce) {
                t = ce;
            } catch (ExecutionException ee) {
                t = ee.getCause();   // <-- the exception submit() swallowed
            } catch (InterruptedException ie) {
                Thread.currentThread().interrupt();
            }
        }
        if (t != null) {
            log.error("task failed in pool", t);   // now it's VISIBLE
            Sentry.captureException(t);
            taskFailures.increment();
        }
    }
}
```

### Node — supervised worker pool with respawn

```js
const { Worker } = require("node:worker_threads");
const os = require("node:os");

class WorkerPool {
  constructor(script, size = os.cpus().length) {
    this.script = script;
    this.size = size;
    this.workers = [];
    for (let i = 0; i < size; i++) this.#spawn();
  }

  #spawn() {
    const w = new Worker(this.script);
    w.on("error", (err) => {
      // A Worker crashed (uncaught throw). MAIN process is unaffected.
      log.error({ err }, "worker crashed; respawning from clean state");
      metrics.workerCrashes.inc();
      this.#replace(w);                 // supervision: restart the dead worker
    });
    w.on("exit", (code) => {
      if (code !== 0) this.#replace(w);  // nonzero exit = abnormal, respawn
    });
    this.workers.push(w);
  }

  #replace(dead) {
    this.workers = this.workers.filter((x) => x !== dead);
    if (this.workers.length < this.size) this.#spawn();
  }
}
```

---

## Worked Example — A Recover That Hid a Data-Corruption Bug

**The setup.** A payments service has a global recover middleware (the textbook middle-level pattern). One handler updates an in-memory `balanceCache` under a mutex *and* writes to the database. The cache and DB are supposed to stay in sync.

```go
func (h *Handler) Debit(w http.ResponseWriter, r *http.Request) {
	acct, amt := parse(r)
	h.mu.Lock()
	defer h.mu.Unlock()

	h.balanceCache[acct] -= amt           // (1) mutate cache
	if err := h.db.Debit(acct, amt); err != nil { // (2) write DB
		panic(err)                        // a DB error panics here
	}
	w.WriteHeader(200)
}
```

**The incident.** A DB hiccup makes `h.db.Debit` return an error for a burst of requests. Each one `panic`s at line (2) — *after* the cache was already decremented at line (1). The global recover middleware catches every panic, logs it, returns 500, and **keeps the server running.** For six hours, the in-memory `balanceCache` drifts further and further below the real DB balances, because every failed debit still subtracted from the cache. Customers see *lower* balances than they actually have. No alert fires — the server is "healthy," returning 500s at a rate buried in normal noise.

**Why the boundary recovery made it worse.** The recover was *correct at the request level* (one request fails, server lives) but *wrong at the state level*: the panic happened **mid-mutation of shared state under a lock**, and recovering-and-continuing kept serving from a corrupt cache. The bulkhead had a hole in it — the cache is shared across requests, so "request isolation" was an illusion.

**Diagnosis.** On-call notices `balanceCache` and DB diverging via a reconciliation job. A `git log -p` on the handler + the 500-rate graph aligning with the DB hiccup window points at the panic-after-mutation ordering. The recovered panics *were* in the logs and the crash reporter — but nobody connected "recovered 500" with "cache corruption" because the recover made it look benign.

**The three fixes (defense in depth):**

```go
// FIX 1 — order operations so a failure can't leave half-state.
//          Write the DB FIRST; only touch the cache after it succeeds.
func (h *Handler) Debit(w http.ResponseWriter, r *http.Request) {
	acct, amt := parse(r)
	h.mu.Lock()
	defer h.mu.Unlock()

	if err := h.db.Debit(acct, amt); err != nil {
		// Recoverable error → return it, don't panic. Cache untouched.
		http.Error(w, "debit failed", http.StatusInternalServerError)
		return
	}
	h.balanceCache[acct] -= amt   // only after the source of truth is updated
	w.WriteHeader(200)
}

// FIX 2 — manual poisoning: if anything DOES panic mid-mutation, crash,
//          don't let the boundary recover serve a corrupt cache.
defer func() {
	if rec := recover(); rec != nil {
		slog.Error("panic under balance lock; cache may be corrupt", "panic", rec)
		report.Capture(rec, debug.Stack(), nil)
		panic(rec)  // re-panic past the boundary → clean restart, fresh cache
	}
}()

// FIX 3 — the DB error was never a panic to begin with.
//          A DB failure is a Layer-1 error the caller can respond to (retry/500),
//          NOT a broken-invariant panic. Misclassification was the root cause.
```

**The lessons (all senior-level):**

1. **A boundary recover is not a license to recover into corruption.** The recover must sit *outside* the corruptible region; here the corruption was *inside* the lock, past the mutation.
2. **`panic` was the wrong tool for a DB error** — a recoverable failure was promoted to a panic, then caught and hidden. Classification (error vs. panic) is the upstream root cause.
3. **Design out the half-state**: do the irreversible/authoritative write first, the derived update second. A panic between them then can't corrupt.
4. **"Server healthy + returning 500s" can mask data corruption.** Wire a *correctness* alert (cache/DB reconciliation), not just a liveness one.

---

## Failure Stories From the Field

These are the shapes of real incidents this topic exists to prevent.

| Story | Root cause | Senior takeaway |
|---|---|---|
| **The silent goroutine that killed prod** | A handler spawned `go sendMetrics()`; a nil-map write inside panicked. No recover. The *whole Go process* died — every in-flight request dropped — despite a perfect request-level recover middleware. | Go goroutines detonate the process. Ban raw `go fn()`; every spawn through `SafeGo`. |
| **`submit()` ate the exception** | A scheduled cleanup job thrown into `executor.submit()` started throwing. Nobody called `Future.get()`. The cleanup silently stopped for *weeks*; disk filled, then the host died. | `ExecutorService.submit` swallows exceptions into the `Future`. Use `afterExecute` or `execute()` for fire-and-forget. |
| **`panic = "abort"` met `catch_unwind`** | A team set `abort` for a smaller binary. Months later, someone added a `catch_unwind` worker pool expecting per-job isolation. First panicking job killed the whole service in prod. | The panic strategy and the isolation design must be one reviewed decision. |
| **The poisoned cache (above)** | Recover-and-continue past a mid-mutation panic served a corrupt in-memory balance for 6 hours. | Never recover *into* corruption; design out half-state; classify DB errors as errors. |
| **CrashLoopBackOff storm** | A bad config deploy made the process panic on boot. k8s restarted it forever; the restart storm hammered the config service, which then failed *other* services. "Let it crash" with no restart budget. | Bound restarts (`max_restarts`/backoff). A deterministic crash is not a transient one. |
| **The `uncaughtException` that resumed** | A Node service installed an `uncaughtException` handler that *logged and continued* (no `exit`). The event loop ran on undefined state; it served subtly wrong responses until a memory corruption finally crashed it hours later. | After `uncaughtException`, the only safe action is exit. Never resume. |
| **FFI unwind UB** | A Rust panic unwound across an `extern "C"` callback into a C library. Undefined behavior; intermittent corruption that took weeks to trace. | Never unwind across FFI. Use `catch_unwind` at the boundary, or `extern "C-unwind"` with explicit handling, or `abort`. |

---

## Pros & Cons

| Decision | Pros | Cons |
|---|---|---|
| **Fail-fast (crash)** | Honest, bounded, simple; corruption can't spread; restart path stays tested | Costs a restart; bad if restart is slow or state irreplaceable |
| **Recover-and-continue** | Avoids restart cost; keeps warm state | Only safe if isolated; the #1 source of "recovered into corruption" bugs |
| **`panic = "abort"` (Rust)** | Smallest/fastest binary; corruption→death guarantee; FFI-safe | No `catch_unwind`; no per-thread isolation; no destructors on panic |
| **`panic = "unwind"` (Rust)** | Catchable at boundaries; destructors run; per-worker isolation | Larger binary; a panic can be caught & wrongly ignored; FFI unwind risk |
| **Crash-only design** | One tested stop/start path; no graceful-shutdown bugs; k8s-native | Needs fast recovery + durable state; CrashLoopBackOff if crash is deterministic |
| **Supervision (restart-from-clean)** | Sidesteps corruption; bounded retries; self-healing | Needs externalized/checkpointed state; restart budget tuning |
| **In-process recovery** | Cheap, no restart, keeps caches | Doesn't reset corrupt state; the failure may recur immediately |

---

## Use Cases

- **Stateless HTTP/gRPC pod behind a load balancer** → crash-only: prefer crash + k8s restart over elaborate in-process recovery; one boundary recover per request for *availability*, fail-fast everywhere else.
- **Worker pool consuming a queue** → supervision with a restart budget + dead-letter for poison messages; recover *per job* as the supervisor's failure detector.
- **Stateful singleton (in-memory index/leader)** → in-process resilience, copy-on-write state, manual poisoning; crashing is expensive, so design corruption out instead.
- **Rust binary linking C/FFI** → `panic = "abort"` or `catch_unwind` at every FFI boundary; never unwind across the edge.
- **Security-/correctness-critical leaf service** → `panic = "abort"`: the "corrupt process dies immediately" guarantee outweighs recoverability.
- **Async task fan-out (Tokio/`errgroup`)** → capture task panics at the join point; in Go, wrap goroutines so a panic becomes an `error`, not a process crash.
- **Mid-mutation of shared lock-protected state** → crash (re-panic / abort); never recover-and-continue.

---

## Coding Patterns

### Pattern: the recover is the supervisor's *detector*, not the resilience

```go
crashed := runGuarded(ctx, name, work) // recover detects the failure
if crashed { restartFromCleanState() } // restart provides the resilience
```

### Pattern: design out half-state (authoritative write first)

```go
if err := db.Write(x); err != nil { return err } // source of truth first
cache.Set(x)                                      // derived state second
// A failure between them leaves the cache consistent with the DB.
```

### Pattern: copy-on-write atomic swap (no observable half-state)

```go
next := buildNewSnapshot()  // a panic here leaves current untouched
current.Store(next)         // single atomic publish
```

### Pattern: bound the restarts (no infinite "let it crash")

```go
if restartsInWindow > maxRestarts { return errEscalate } // trip the breaker
```

### Pattern: make the panic strategy and isolation design agree

```toml
# If you rely on catch_unwind for isolation, you MUST keep unwind. Document it.
[profile.release]
panic = "unwind"   # REQUIRED: worker pool isolates panics via catch_unwind
```

### Pattern: last-resort handler reports, then exits — never resumes

```js
process.on("uncaughtException", (e) => { report(e); flush(); process.exit(1); });
```

---

## Clean Code

- **One written panic policy per service**, enforced in lint/review — not a per-call-site decision.
- **The only recover sites are infrastructure boundaries** (middleware, worker loop, spawn wrapper, supervisor detector). Zero `recover()`/`catch(Throwable)` in business logic.
- **Every concurrency spawn goes through a guarded wrapper** (`SafeGo`, `Supervise`, a `catch_unwind` runner, a Worker pool). Ban raw `go fn()` / `new Thread` / detached `tokio::spawn` for panic-prone work.
- **Authoritative writes before derived updates**, so a failure can't leave half-state. Prefer copy-on-write / atomic swap for shared state.
- **A panic mid-mutation under a lock crashes** (re-panic / abort). Recover-and-continue is reserved for *provably isolated* state.
- **Runtime strategy is explicit and documented**: `GOTRACEBACK=crash` in prod; Rust `panic =` profile matched to the isolation design; libraries correct under both.
- **Last-resort handlers report and exit**; they never resume an undefined-state process.
- **A correctness alert, not just a liveness probe** — a "healthy" server can serve corrupt data.

---

## Best Practices

1. **Decide crash-vs-recover from restart cost × state recoverability, and write it down.** When in doubt, crash.
2. **Default to crash-only for stateless/checkpointed services**; reserve in-process recovery for expensive-to-restart, isolated state.
3. **Match the panic strategy to the isolation design.** `catch_unwind` ↔ `panic = "unwind"`; FFI/leaf ↔ `panic = "abort"`. Never let them disagree silently.
4. **Use supervision (restart-from-clean) over recover-and-continue for anything stateful** — and always bound the restarts with a budget.
5. **Treat Go goroutines as process-level liabilities.** Every spawn guarded; lint bans raw `go fn()`.
6. **Never recover *into* corruption.** A panic mid-mutation under a lock → crash. Design half-state out via atomic swap / authoritative-first ordering.
7. **Wire the right last-resort handler per runtime**, and make it report-then-exit, never resume (especially Node).
8. **Design the death**: `GOTRACEBACK=crash`, core dumps, flush the crash reporter, dump threads/goroutines, then exit — turn every crash into a post-mortem artifact.
9. **Alert on correctness, not just liveness** — and on `CrashLoopBackOff` / restart-budget-exceeded.
10. **Classify upstream**: recoverable failures are errors; broken invariants are panics. Misclassification is the root of most "recover hid the bug" incidents.

---

## Edge Cases & Pitfalls

- **Go fatal errors are not recoverable.** Concurrent map write, stack overflow, OOM print `fatal error:` and ignore `recover()`. You cannot contain these — only prevent them.
- **`panic = "abort"` makes `catch_unwind` a no-op.** A worker pool that relies on it will kill the whole process on the first panic. Verify the profile.
- **Rust drops a detached task's panic silently.** A `tokio::spawn` whose `JoinHandle` you drop swallows the panic. Keep the handle or use `JoinSet`.
- **Java `submit()` swallows exceptions into the `Future`.** Never-called `get()` = invisible failure. Use `afterExecute` or `execute()`.
- **`ProcessPoolExecutor` segfault breaks the pool.** A native crash (not a Python exception) yields `BrokenProcessPool`; the pool is unusable until recreated.
- **Resuming after Node `uncaughtException`** runs on undefined state. The "robust" handler that logs-and-continues is a latent corruption bug.
- **Unwinding across FFI is UB** (historically). Use `catch_unwind` at the boundary or `extern "C-unwind"`; never let a panic cross a plain `extern "C"`.
- **Lock poisoning ignored.** `poisoned.into_inner()` on autopilot reintroduces the corruption bug poisoning exists to flag.
- **`CrashLoopBackOff`** is crash-only failing: a *deterministic* crash restarts forever. Bound restarts; handle poison inputs out-of-band.
- **Re-panic loses the original stack.** `panic(rec)` keeps the value, resets the stack to the re-panic site. Log the original stack first.

---

## Common Mistakes

1. **Recovering into corruption** — catching a panic that happened mid-mutation and continuing on a poisoned shared structure (the payments-cache class of bug).
2. **Treating a recover boundary as the resilience strategy for stateful work** instead of restart-from-clean-state via supervision.
3. **Raw `go fn()` for panic-prone work** — one bad input, whole process down, despite a perfect request boundary.
4. **Setting `panic = "abort"` while depending on `catch_unwind`** — silent in dev, process death in prod.
5. **Unbounded "let it crash"** — no restart budget → `CrashLoopBackOff` storm that can take down dependencies.
6. **`submit()` without `get()`** in Java/Python — failures vanish into Futures.
7. **Resuming the event loop after Node `uncaughtException`** instead of exiting.
8. **Unwinding a panic across an FFI boundary** — undefined behavior, intermittent corruption.
9. **Promoting a recoverable error to a panic** (e.g. `panic(dbErr)`) — then catching and hiding it at the boundary.
10. **Only a liveness probe, no correctness alert** — a healthy process serving wrong data goes unnoticed.

---

## Tricky Points

- **A boundary recover is correct for *availability* and dangerous for *correctness* simultaneously** — the payments case kept the server up *and* corrupted the cache. Both are true; you must reason about each separately.
- **"Let it crash" is more reliable than defensive code precisely because the restart path is exercised constantly** — the opposite of intuition that says "more error handling = more robust."
- **Rust unwind across FFI is now sometimes defined** (`extern "C-unwind"`, Rust 1.71+) but the *default* `extern "C"` aborts on unwind to stay safe — know which ABI you wrote.
- **Go's `recover` works for `panic` but never for `fatal error`** — there are two failure tiers and only one is catchable, and you don't choose which is which.
- **A Tokio task panic doesn't crash the runtime, but a panic in a *blocking* closure on `spawn_blocking` is also captured** — Rust's async runtime is consistently safer than Go here.
- **`panic = "abort"` is often *faster* and *smaller*, not just "safer"** — no unwind tables, no landing pads. It's a legitimate performance choice, not only a correctness one.
- **Supervision's `one-for-all` exists because some children share state** — restarting one without the others would leave coupled state inconsistent. The strategy choice encodes your coupling.
- **A re-panic and an abort both kill the process, but a re-panic still unwinds** (runs destructors over possibly-corrupt data) while `abort` doesn't. When the data is corrupt, `abort` is sometimes the *safer* death.

---

## Test Yourself

1. Give the decision matrix for crash-vs-recover in terms of restart cost and state recoverability. Identify the one cell where recover is the clear winner and the row where crash is mandatory.
2. Explain exactly what `panic = "abort"` changes versus `panic = "unwind"` in Rust, and name two situations where each is the correct choice.
3. A Go service has a flawless request-recover middleware but still crashed the whole process. Give the most likely cause and the fix.
4. Why is `ExecutorService.submit()` more dangerous than `execute()` for fire-and-forget tasks? Show the code that makes a submitted task's failure visible.
5. Walk through the payments-cache failure story: where exactly was the corruption introduced, why did the boundary recover make it worse, and what three changes fix it?
6. Implement a supervisor with a restart budget (max 5 crashes in 30s) that escalates instead of looping. Explain how this prevents `CrashLoopBackOff`.
7. What does Rust lock poisoning detect, and what's the equivalent discipline you must apply manually in Go/Java/Python?
8. Why must a Node `uncaughtException` handler exit rather than resume? What's the safe place to run risky work so a crash doesn't take the main process?
9. Describe crash-only software and why its single stop/start path is *more* reliable than a graceful-shutdown path.
10. When is re-panicking the wrong death and `std::process::abort()`/equivalent the right one?

---

## Tricky Questions

**Q1: My service is stateless and behind a load balancer. Should I add recover boundaries or just let it crash?**

Both, for different reasons. Add **one** recover boundary per request for *availability* — one bad request shouldn't drop the thousands of healthy in-flight ones. But for everything else, lean **crash-only**: a buggy process should crash and let k8s restart it clean, rather than accumulate elaborate in-process recovery you'll never test. The boundary recover is for request isolation; crash-only is for process-level failures. They don't conflict.

**Q2: We set `panic = "abort"` for a smaller binary. Now a teammate wants a `catch_unwind` worker pool. What do you tell them?**

That the two are incompatible: under `abort`, `catch_unwind` never fires, so the first panicking job kills the whole process. They must either (a) switch the binary to `panic = "unwind"` (accepting the larger binary) if per-job isolation is required, or (b) achieve isolation differently — e.g., run each job in a separate *process* that can crash independently. The panic strategy and the isolation design are one decision; surface it in review.

**Q3: A panic happened while a thread held a mutex over a shared map. The boundary recovered it. Is that safe?**

Almost certainly not. The map may be half-mutated and the lock's invariant broken; recovering-and-continuing serves corruption. Rust would *poison* the lock to force you to confront this. In other languages you must apply the discipline manually: **crash** (re-panic or abort) rather than continue. The exception is if the mutation was a single atomic swap (copy-on-write), in which case a panic before the swap left the old value intact and continuing is fine.

**Q4: Isn't "let it crash" reckless? It seems like giving up on error handling.**

It's the opposite of reckless *when paired with supervision*. The insight: a restart-from-clean-state path that runs on every process start is exercised constantly and is therefore reliable, while defensive cleanup code that runs once a year is always buggy. "Let it crash" deletes the unreliable path. But it's only safe with (a) a supervisor that restarts, (b) externalized/checkpointed state, and (c) a bounded restart budget so a deterministic crash doesn't loop forever.

**Q5: Why does Go crash the whole process on a goroutine panic when Rust and Java only kill the thread?**

Go made a deliberate design choice: there's no per-goroutine isolation boundary, because supporting "catch another goroutine's panic" would require heavyweight machinery and encourage exactly the corrupt-state-recovery this topic warns against. The consequence is that **every** unguarded goroutine is a process-level liability — which is why the senior discipline is to route every spawn through a recovering wrapper.

**Q6: Our Node service has an `uncaughtException` handler that logs and keeps running. Good defensive coding?**

No — it's a latent corruption bug. Node's own docs are explicit: after `uncaughtException` the process is in an *undefined state*, and resuming the event loop means running on potentially broken internals. The handler must log, flush telemetry, and `process.exit(1)`, letting a supervisor (pm2, k8s) restart a clean process. Run risky/CPU-bound work in a `worker_thread` so its crash is isolated from the main process.

**Q7: When is `abort` a *safer* death than re-panicking?**

When the process state is corrupt. Re-panicking still *unwinds* — it runs destructors/`defer`/`finally` on the way out, and those run over possibly-corrupt data (a destructor that flushes a half-written buffer can make corruption *durable*). `abort` skips all of that and dies immediately. For correctness-critical paths where you've detected corruption, `abort` (or Go's fatal-style exit, or `os.Exit` after flushing telemetry) is the cleaner death precisely because it runs *no more code*.

**Q8: How do I stop "let it crash" from becoming a `CrashLoopBackOff` storm?**

Bound the restarts. A supervisor (OTP's `max_restarts`, your own restart budget, k8s's backoff) must distinguish *transient* failures (restart helps) from *deterministic* ones (restart is futile). After N crashes in T seconds, escalate: dead-letter the poison input, alert on-call, or crash the supervisor up to its parent. Unbounded retry on a deterministic crash hammers your dependencies and turns one bad pod into a fleet-wide outage.

---

## Cheat Sheet

```text
┌──────────────────── PANIC & RECOVERY — SENIOR CHEAT SHEET ────────────────────┐
│                                                                               │
│  THE DECISION: crash vs recover = f(restart cost, state recoverability)       │
│    corrupt state              → CRASH (always, any cost)                       │
│    cheap restart              → CRASH (crash-only) — the default               │
│    isolated state + warm/exp. → RECOVER at boundary (the one clear win)        │
│    WHEN IN DOUBT              → CRASH (loud+bounded beats quiet+unbounded)      │
│                                                                               │
│  UNWIND vs ABORT                                                              │
│    unwind = catchable + destructors run + FFI risk + bigger binary            │
│    abort  = process dies now, no catch, no destructors, smaller, FFI-safe     │
│    Rust: panic="abort" UNLESS you rely on catch_unwind for isolation          │
│    Go:   always unwinds for panic; fatal errors NOT recoverable               │
│                                                                               │
│  PANIC BLAST RADIUS (know your unit!)                                         │
│    Go goroutine   → KILLS PROCESS (guard every spawn; ban raw `go fn()`)       │
│    Rust thread    → join() Err   │  Rust task → JoinError.is_panic             │
│    Java thread    → handler/Future │ submit() SWALLOWS into Future             │
│    Python thread  → excepthook   │  Node Worker → 'error' event (main lives)   │
│    Node main loop → uncaughtException → LOG, FLUSH, exit(1). NEVER resume.     │
│                                                                               │
│  SUPERVISION > in-place recover for STATEFUL work                            │
│    recover = the supervisor's DETECTOR; restart-from-clean = the resilience   │
│    always bound restarts (max N / window) → escalate, no CrashLoop storm       │
│                                                                               │
│  CORRUPTION                                                                   │
│    Rust poisons locks on panic-while-held; everyone else: do it MANUALLY       │
│    panic mid-mutation under a lock → CRASH, never continue                     │
│    design it out: authoritative-write-first / copy-on-write atomic swap        │
│                                                                               │
│  CRASH-ONLY: one tested stop/start path; durable state; idempotent; fast boot │
│  ON DEATH: flush reporter, dump goroutines/threads, GOTRACEBACK=crash, exit    │
│  WRITE THE POLICY ONCE; enforce in lint/review. Don't re-decide per call site. │
└───────────────────────────────────────────────────────────────────────────────┘
```

---

## Summary

- The senior question is not "how do I recover here?" but **"should this class of failure crash the process, and if so, what restarts it?"** — an architecture decision driven by *restart cost × state recoverability*.
- **Crash vs. recover:** corrupt state → always crash; cheap restart → prefer crash-only; isolated state + expensive restart → recover at the boundary (the one clear win). **When in doubt, crash** — loud and bounded beats quiet and unbounded.
- **Unwind vs. abort** is a real runtime policy. Unwind buys a catch point and runs destructors; abort buys a "corrupt process dies now" guarantee and FFI safety. Match the strategy to your isolation design — `catch_unwind` *requires* `panic = "unwind"`.
- **A panic's blast radius equals its concurrency unit.** Go goroutines detonate the whole process (guard every spawn); Rust threads/tasks, Java/Python threads, and Node Workers isolate. Know the matrix; Go is the trap.
- **Crash-only software** makes restart the only tested stop/start path, so recovery is always reliable — the foundation of k8s-native design. Pair it with durable state, idempotency, fast boot, and a *bounded* restart budget to avoid `CrashLoopBackOff`.
- **Supervision beats in-place recovery for stateful units:** restart from clean state instead of recovering into possibly-corrupt state. The `recover` is the supervisor's *detector*; the restart is the resilience.
- **Never recover into corruption.** Rust's lock poisoning forces the question; everywhere else you must apply it manually — a panic mid-mutation under a lock should crash. Better: design half-state out via authoritative-first ordering and copy-on-write swaps.
- **Last-resort handlers report and exit; they never resume.** Node's `uncaughtException` is the canonical example.
- **Write the panic policy once**, enforce it in lint and review, and design the moment of death to be a post-mortem artifact. The catastrophic incidents here are policy failures, not missing `try/catch`.

---

## What You Can Build

- A **supervised, crash-only worker service** in Go: `SafeGo` for spawns, a `Supervise` loop with a restart budget that escalates, `GOTRACEBACK=crash` for core dumps, and a k8s manifest with a liveness probe — then deliberately feed it a poison message and watch it dead-letter, restart, and finally trip the budget.
- A **panic-strategy comparison harness** in Rust: the same `catch_unwind` worker pool built once with `panic = "unwind"` (isolation works) and once with `panic = "abort"` (first panic kills the process), side by side, to internalize the dependency.
- A **corruption-detection demo**: a shared lock-protected counter; one version recovers-and-continues past a mid-mutation panic (drifts wrong), one re-panics (crashes clean), one uses copy-on-write atomic swap (never corrupts) — measured against a reconciliation check.
- A **propagation-matrix test suite**: one failing task per runtime (Go `errgroup`, Rust `tokio::spawn`, Java `submit` vs `execute`, Python `ThreadPoolExecutor`, Node `worker_threads`) asserting *exactly* how the panic surfaces and whether the process survives.
- A **written panic policy** for a real service (the boxed template above), plus the lint rules / CI greps that enforce it: ban raw `go fn()`, empty `recover()`, `catch (Throwable)` in business code, and `submit()` without `get()`.

---

## Further Reading

- **Candea & Fox — "Crash-Only Software" (USENIX HotOS 2003)** — the foundational paper; short and worth reading in full. <https://www.usenix.org/legacy/events/hotos03/tech/full_papers/candea/candea.pdf>
- **Erlang/OTP — Supervisor behaviour & "let it crash"** — <https://www.erlang.org/doc/design_principles/sup_princ.html>
- **Joe Armstrong — "Making reliable distributed systems in the presence of software errors" (PhD thesis)** — the canonical case for supervision and let-it-crash.
- **Rust — `std::panic::catch_unwind`, the `panic` runtime, and `UnwindSafe`** — <https://doc.rust-lang.org/std/panic/fn.catch_unwind.html> and the Rustonomicon on unwinding & FFI: <https://doc.rust-lang.org/nomicon/unwinding.html>
- **Rust RFC 2945 — `C-unwind` ABI** — defining unwinding across FFI safely. <https://rust-lang.github.io/rfcs/2945-c-unwind-abi.html>
- **Go — `GOTRACEBACK`, fatal errors, and runtime panics** — <https://pkg.go.dev/runtime#hdr-Environment_Variables> and the Go memory model for what "fatal error: concurrent map writes" means.
- **Node.js — `process.on('uncaughtException')` warning & `worker_threads`** — <https://nodejs.org/api/process.html#event-uncaughtexception> and <https://nodejs.org/api/worker_threads.html>.
- **Akka — Fault Tolerance & supervision strategies** — <https://doc.akka.io/docs/akka/current/typed/fault-tolerance.html>
- **Kubernetes — liveness probes, `restartPolicy`, `CrashLoopBackOff`** — the container-level supervision model.

---

## Related Topics

- **Previous level:** [middle.md](middle.md) — recover-at-boundary, the four obligations, goroutine/thread escape, `catch_unwind` basics. This page builds the *policy* on top of that *technique*.
- **Next level:** [professional.md](professional.md) — unwinding internals & cost, async-signal-safety, FFI/unwind UB in depth, poisoned-lock recovery strategies, resilient pool design at scale.
- **Junior level:** [junior.md](junior.md) — the two-layer model, unwinding, when a program should crash.
- **Interview prep:** [interview.md](interview.md)
- **Practice:** [tasks.md](tasks.md)

**Sibling diagnostic topics:**

- [Crash Reporting — Senior](../crash-reporting/senior.md) — turning a designed crash into a deduplicated, fingerprinted, actionable ticket; core dumps and symbolication.
- [Error Handling — Senior](../error-handling/senior.md) — the *error* half of the recoverable/unrecoverable boundary; error taxonomies and propagation across a service.
- [Observability Engineering](../observability-engineering/README.md) — the correctness alerts (not just liveness) that catch a "healthy" process serving corrupt data.
- [Post-Mortem Analysis](../post-mortem-analysis/README.md) — writing up the panic-policy failures this page exists to prevent.
- [Logging](../logging/README.md) / [Tracing](../tracing/README.md) — capturing the panic value, stack, and trace context at the moment of death.

**Cross-roadmap links:**

- [Circuit Breaker](../../code-craft/coding-patterns/README.md) and the `circuit-breaker-pattern` skill — the restart-budget idea generalized to failing dependencies.
- [Retry Pattern](../../code-craft/coding-patterns/README.md) and the `retry-pattern` skill — idempotency and backoff, prerequisites for crash-only restart safety.
- [Immutability Patterns](../../code-craft/coding-patterns/README.md) and the `immutability-patterns` skill — designing out the half-state that makes recover-into-corruption possible.

---

## Diagrams & Visual Aids

### Crash vs. Recover, as a function of restart cost and state

```text
                       restart CHEAP                 restart EXPENSIVE
                ┌───────────────────────────┬───────────────────────────┐
  state may be  │        CRASH               │        CRASH              │
  CORRUPT       │  (cheapest + safest)       │  (corrupt+pricey still     │
                │                            │   beats wrong data)        │
                ├───────────────────────────┼───────────────────────────┤
  state         │  either; prefer            │      RECOVER at boundary   │
  ISOLATED      │  CRASH-ONLY (simpler)      │  (the one clear win:       │
                │                            │   warm caches, no restart) │
                └───────────────────────────┴───────────────────────────┘
   bias when unsure ───────────────────────────────────────────► CRASH
```

### Recover-and-continue vs. supervision (restart-from-clean)

```text
   IN-PLACE RECOVER                       SUPERVISION
   ────────────────                       ───────────
   work → PANIC → recover → CONTINUE       work → PANIC → die
                    │                                   │
                    ▼  on POSSIBLY-CORRUPT state        ▼  supervisor restarts
              keeps running broken               fresh worker, CLEAN state
              (the corruption risk)              (never touched the bad input)
                                                 bounded by max_restarts ─┐
                                                 too many crashes ────────┘→ escalate
```

### Panic blast radius per runtime

```text
   Go goroutine            Rust thread/task        Node main loop
   ┌────────────┐          ┌────────────┐          ┌──────────────┐
   │   PANIC    │          │   PANIC    │          │   PANIC      │
   │     │      │          │     │      │          │     │        │
   │     ▼      │          │     ▼      │          │     ▼        │
   │ WHOLE      │          │ this       │          │ event loop   │
   │ PROCESS    │          │ thread/    │          │ UNDEFINED →  │
   │ DIES       │          │ task only; │          │ MUST exit(1) │
   │            │          │ join()=Err │          │ (Worker = ok)│
   └────────────┘          └────────────┘          └──────────────┘
   guard EVERY spawn       parent gets Err          run risky work
                                                    in worker_threads
```

### Unwind vs. Abort

```text
   panic = "unwind"  (the hallway)        panic = "abort"  (the trapdoor)
   ───────────────────────────────        ──────────────────────────────
   PANIC                                   PANIC
     │ walk frames                           │
     ├─ run destructor (frame N)             ▼
     ├─ run destructor (frame N-1)      process gone — NOW
     ├─ ... (over possibly-corrupt data)     no destructors
     ▼                                       no catch
   catch at boundary (catch_unwind)          smaller binary, FFI-safe,
   → recover OR re-panic                     "corrupt → dead" guarantee
```
