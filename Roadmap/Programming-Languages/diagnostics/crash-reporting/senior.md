# Crash Reporting — Senior Level

> **Topic:** [Crash Reporting Roadmap](README.md)
> **Focus:** Designing the crash pipeline as a system you operate. Sampling and quota under load. Crash-free-rate SLOs and release health as a ship/halt gate. Dedup and fingerprinting as a long-lived contract. Signal-handler safety — the part most engineers get fatally wrong. The mobile-vs-backend split that changes every decision.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Mental Models](#mental-models)
6. [Signal-Handler Safety — The Part Everyone Gets Wrong](#signal-handler-safety--the-part-everyone-gets-wrong)
7. [Crash-Free Rate as an SLO](#crash-free-rate-as-an-slo)
8. [Release Health as a Ship/Halt Gate](#release-health-as-a-shiphalt-gate)
9. [Dedup & Fingerprinting as a Contract](#dedup--fingerprinting-as-a-contract)
10. [Sampling & Quota Under Load](#sampling--quota-under-load)
11. [Mobile vs Backend — Two Different Problems](#mobile-vs-backend--two-different-problems)
12. [The Native Path — Minidumps, Crashpad, Symbol Servers](#the-native-path--minidumps-crashpad-symbol-servers)
13. [Code Examples](#code-examples)
14. [Worked Example — A Release Halted by Crash-Free Rate](#worked-example--a-release-halted-by-crash-free-rate)
15. [Failure Stories](#failure-stories)
16. [Pros & Cons](#pros--cons)
17. [Use Cases](#use-cases)
18. [Coding Patterns](#coding-patterns)
19. [Clean Code](#clean-code)
20. [Best Practices](#best-practices)
21. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
22. [Common Mistakes](#common-mistakes)
23. [Tricky Points](#tricky-points)
24. [Test Yourself](#test-yourself)
25. [Tricky Questions](#tricky-questions)
26. [Cheat Sheet](#cheat-sheet)
27. [Summary](#summary)
28. [What You Can Build](#what-you-can-build)
29. [Further Reading](#further-reading)
30. [Related Topics](#related-topics)
31. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> Focus: **Crash reporting stops being a library you install and becomes a system you operate — with SLOs, a sampling budget, a fingerprint contract, and a ship/halt gate. And the day a signal handler allocates inside a SIGSEGV, you learn the difference between a crash reporter and a crash *amplifier*.**

At middle level you wired a real SDK, fixed grouping, uploaded symbols, and scrubbed PII. That makes the dashboard *trustworthy*. The senior job is different: you treat the entire pipeline as a **production system with its own reliability, cost, and correctness properties**, and you make organizational decisions on top of it.

Four senior shifts define this page:

1. **Crash reporting becomes a control plane, not a dashboard.** Crash-free rate is an SLO with an error budget. Release health gates the rollout — a bad build *halts itself* before it reaches 100% of users. You are no longer reading crashes; you are *acting on them automatically*.

2. **The signal handler is a hostile environment, and most reporters get it wrong.** When a process takes a SIGSEGV, the only safe code is **async-signal-safe** code. Allocating, locking a mutex, or calling `printf` from inside the handler can deadlock or re-crash — turning one crash into a hang, a corrupted report, or an infinite loop. This is where Breakpad/Crashpad's out-of-process design comes from, and why "just call `captureException`" is wrong for native crashes.

3. **Fingerprinting is a contract that outlives the bug.** A fingerprint isn't a one-off override; it's a *grouping policy* that must stay stable across releases, refactors, and obfuscation-map churn — or every deploy re-shatters your issue history and your "is this a regression?" question becomes unanswerable.

4. **Sampling and quota are a budget you spend deliberately.** At a million events a minute, you cannot send them all, and you would not want to pay for it. Senior crash reporting decides *what* to drop, *when*, and *how* to drop it without losing the long tail of rare-but-fatal bugs — which are exactly the ones sampling tends to delete.

And underneath all of it: **mobile and backend are two different problems wearing the same word.** Mobile crashes are about *release health across an uncontrolled device fleet you can't restart*; backend crashes are about *one process among thousands that the orchestrator will restart in 200ms anyway*. The right design diverges almost immediately.

> 🎓 **Why this matters for a senior:** Anyone can get crashes into Sentry. The senior owns the questions the org actually asks: "Is this release safe to roll to 100%?" "Why did our crash-reporting bill triple?" "Why did one bug create 400,000 issues overnight?" "Why did our crash reporter *cause* the hang it was supposed to report?" Those are design questions, and this page is the design.

---

## Prerequisites

- **Required:** All of [`middle.md`](middle.md) — wiring an SDK, grouping/fingerprint overrides, breadcrumbs/context, symbol upload in CI, `beforeSend` scrubbing, hashed user IDs.
- **Required:** All of [`junior.md`](junior.md) — global handlers per language, anatomy of a report, symbolication, crash vs error.
- **Required:** Comfort with SLOs and error budgets. See [`../metrics/senior.md`](../metrics/senior.md) and the [monitoring-alerting] discipline.
- **Required:** Production debugging fluency — thread dumps, signals, `/proc`, the observer effect. See [`../debugging/senior.md`](../debugging/senior.md).
- **Required:** Concrete understanding of POSIX signals and what "async-signal-safe" means. See `man 7 signal-safety`.
- **Helpful:** Sampling theory and telemetry cost. See [`../telemetry-cost-and-sampling-strategy/`](../telemetry-cost-and-sampling-strategy/).
- **Helpful:** Mobile release mechanics — staged rollouts on Play Store / App Store, why you can't hotfix a binary in users' hands.
- **Helpful:** Native build/symbol toolchains — DWARF, PDB, `dump_syms`, breakpad `.sym`.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Crash-free sessions** | Fraction of app sessions that ended without a crash. The headline mobile health metric. `1 − (crashed_sessions / total_sessions)`. |
| **Crash-free users** | Fraction of *distinct users* who did not experience a crash in a window. Less noisy than sessions; better for SLOs. |
| **Release health** | The aggregate crash/ANR/error posture of a *specific release*, used to decide rollout. Sentry/Crashlytics first-class feature. |
| **ANR** | Application Not Responding — Android's "main thread blocked >5s" event. Not a crash, but tracked alongside; a separate health signal. |
| **Watchdog termination** | iOS kills an app the OS judges hung/over-budget (e.g. main-thread stall, memory). Not a signal crash; needs MetricKit/heuristics to detect. |
| **Async-signal-safe** | A function guaranteed safe to call from a signal handler (see `man 7 signal-safety`). `write`, `_exit` are; `malloc`, `printf`, most locks are **not**. |
| **Minidump** | A compact, structured snapshot of a crashed process's memory/registers/threads. Breakpad/Crashpad format; symbolicated server-side. |
| **Out-of-process handler** | A crash handler running in a *separate* process (Crashpad's model) so it can do unsafe work (write files, upload) without touching the dying process. |
| **In-process handler** | A handler running inside the crashing process (Breakpad's classic model, signal-based). Must be async-signal-safe; fragile. |
| **Fingerprint** | The grouping key. At senior level: a *stable policy*, versioned and owned, not an ad-hoc override. |
| **Fingerprint drift** | When a fingerprint silently changes across releases (new obfuscation map, refactor, inlined frames), re-splitting one issue into many. |
| **Server-side grouping enhancement** | Rules applied at ingest (Sentry "grouping enhancements" / stack-trace rules) to mark frames in-app/out, fold recursion, etc. |
| **Client report / outcome** | Sentry's accounting of events the SDK *dropped* (rate-limited, sampled, errored) so you can see what you're not seeing. |
| **Rate limiting (429)** | The backend rejecting events over quota; the SDK must back off and not retry-storm. |
| **Spike protection** | Backend-side guard that auto-drops events during a flood so one bad release doesn't burn a month's quota in an hour. |
| **Tombstone** | Android's native crash dump written by `debuggerd` to `/data/tombstones`. The OS-level analog of a minidump. |
| **MetricKit** | Apple framework delivering crash/hang/energy diagnostics (`MXCrashDiagnostic`) on-device, batched daily. |
| **Symbol server** | A service that stores debug info keyed by build ID, so symbolication can fetch the exact symbols for the exact binary that crashed. |
| **Adoption** | Fraction of sessions/users on a given release — denominator context for release-health math. |

---

## Core Concepts

### 1. The reporter is part of the crash, so it must be paranoid

A logging library that misbehaves writes a bad log line. A crash reporter that misbehaves runs **inside a process that is already dying**, often inside a signal handler where the heap may be corrupt and the only safe primitives are a handful of syscalls. The senior treats the reporter as code that runs in the *worst possible* environment and designs accordingly: minimal work in the handler, out-of-process where possible, write-then-upload-later, never allocate, never lock. The reporter that crashes while reporting is worse than no reporter — it converts a clean crash into a hang and eats the report.

### 2. Crash-free rate is a number you defend, not a number you watch

At senior level, crash-free sessions/users is an **SLO** with an error budget, an alert, and a consequence. 99.9% crash-free users isn't a vanity stat on a slide; it's a threshold that, when breached, **halts a rollout** and **triggers a page**. The senior wires the number into the release machinery so that a bad build is stopped by math, not by someone noticing.

### 3. Grouping is a long-lived contract, not a per-bug tweak

Middle level taught you to fix one over/under-grouped issue. Senior level recognizes that your fingerprints form a *policy* with a lifetime measured in years. The contract: **the same bug must produce the same fingerprint across releases, refactors, and obfuscation churn**, and a genuinely new bug must produce a new one. Break it and your entire regression-detection capability — "did this release introduce something new?" — silently dies, because every release looks like a fresh wave of "new" issues.

### 4. You cannot afford every crash, and that's a design input

A million-event minute will bankrupt your quota and tell you nothing the first ten thousand events didn't. Senior crash reporting *budgets*: full capture for fatal crashes (they're rare and precious), aggressive sampling for high-volume handled exceptions, spike protection so one runaway loop can't burn the month. The hard part is sampling *without deleting the rare fatal bug* — the needle you sample away is the one you needed.

### 5. Mobile and backend share a SDK and almost nothing else

| Dimension | Mobile | Backend |
|---|---|---|
| **Recovery** | None — the app died on the user's phone; you can't restart it | Orchestrator restarts the process in ~200ms |
| **Headline metric** | Crash-free sessions/users; release health | Error rate, restart count, `panic`/OOM rate |
| **Fix latency** | Days (store review, staged rollout, user update) | Minutes (redeploy) |
| **Fleet control** | Zero — heterogeneous OS/device/version you can't touch | Total — you own every node |
| **Crash capture timing** | On *next launch* (can't upload while dead) | Immediately, before/at process exit |
| **Dominant crash classes** | OOM, ANR/watchdog, OS-version-specific, native (NDK/Swift) | panics, unrecovered exceptions, OOMKill, segfaults in cgo/native deps |
| **Worst failure** | Bad release reaches millions before you notice | Crash loop / restart storm; but blast radius is bounded |

Read that table before every design decision on this page. The same word, "crash," points at two different engineering problems.

### 6. The crash you don't capture is the one that killed the capturer

The deepest senior insight: the crashes hardest to capture are *exactly the dangerous ones*. A clean `panic` is easy. A SIGSEGV from heap corruption, an OOM kill (no signal at all — the kernel just `SIGKILL`s you), an immediate crash *during SDK init*, a crash in the crash handler — these are the ones that evade naive capture, and they're disproportionately your worst bugs. Designing for *these* is the job.

---

## Mental Models

### Model 1: The dying-process budget

Picture the crashing process as a patient with seconds to live. Every action the reporter takes spends from a tiny, hostile budget: the heap may be corrupt, locks may be held by dead threads, the stack may be smashed. The senior's model: **in the handler, do the absolute minimum to preserve evidence — capture registers and a stack snapshot to a pre-allocated buffer, write it to a pre-opened fd — and defer everything else (symbolication, enrichment, upload) to a healthy context.** Crashpad takes this to its logical end: the only thing the dying process does is signal a *separate, healthy* process to do the work.

```text
   DYING PROCESS (signal handler)        HEALTHY CONTEXT (next launch / separate proc)
   ─────────────────────────────         ─────────────────────────────────────────────
   • capture registers/stack             • read the dump file
   • write minidump to pre-opened fd  ──► • enrich (breadcrumbs, context)
   • (Crashpad) wake handler process      • scrub PII
   • _exit()                              • symbolicate / upload with retry
   ── async-signal-safe ONLY ──           ── full runtime available ──
```

### Model 2: Release health as a circuit breaker

A staged rollout is a circuit breaker with crash-free rate as the trip condition. Roll to 1% → measure crash-free users for *that cohort* → if it's below the threshold relative to the prior release, **trip**: halt the rollout, alert, optionally roll back. The senior wires this loop so the human is in the *notification* path, not the *detection* path. The math halts the bad build at 1% before it can reach the other 99%.

### Model 3: The fingerprint as a primary key

Treat the fingerprint like a database primary key for "a bug." Primary keys must be **stable** (the same row keeps its key) and **unique** (different rows get different keys). Everything that destabilizes the key — a per-request ID in it (over-splits), a generic frame at the top (over-merges), an obfuscation map that renames frames each build (drifts) — is a primary-key bug, and you debug it the way you'd debug a corrupted index.

---

## Signal-Handler Safety — The Part Everyone Gets Wrong

This is the senior topic that separates "I installed Sentry" from "I understand crash reporting." Most language-level crash capture you've seen (a `panic` recover, a `try/catch`, an `uncaughtExceptionHandler`) runs in a *healthy* runtime. **Native crashes do not.** A SIGSEGV, SIGABRT, SIGBUS, SIGILL, or SIGFPE interrupts the process at an arbitrary instruction — possibly mid-`malloc`, holding the allocator's lock, with a corrupt heap.

### The async-signal-safe rule

From `man 7 signal-safety`: only a specific allowlist of functions may be called from a signal handler. The ones you reach for instinctively are **not** on it:

| Want to do | Naive call | Safe? | Why it kills you |
|---|---|---|---|
| Log the crash | `printf`, `fprintf` | ❌ | Locks stdio, may `malloc` |
| Build a report string | `malloc`, `std::string` | ❌ | Allocator lock may be held by the crashing thread → **deadlock** |
| Acquire your reporter's mutex | `pthread_mutex_lock` | ❌ | If the crashing thread held it → **self-deadlock** |
| Write raw bytes to a file | `write(fd, buf, n)` | ✅ | A bare syscall, reentrant |
| Exit | `_exit(1)` | ✅ | Bypasses `atexit`/buffers that may be corrupt |
| Get the time | `time()` | ✅ (mostly) | One of the few safe libc calls |

The canonical failure: a signal handler that does `log.Printf("crash: %v", err)` or `new Report(...)`. Under heap corruption the `malloc` blocks on a lock the dead thread owns. Now your process is **hung, not crashed** — the watchdog won't fire a clean crash, the OS won't restart it cleanly, and you've captured nothing. You built a crash *amplifier*.

### The three safe designs

**1. In-process, async-signal-safe, write-only (Breakpad classic).** The handler does only safe work: capture the CPU context (registers via the `ucontext_t` passed to the handler), walk the stack using *pre-allocated* scratch space, and `write()` a minidump to a file descriptor you **opened before the crash**. No allocation, no locks, no libc beyond the allowlist. On next launch, a healthy code path reads the file, enriches, and uploads.

**2. Out-of-process (Crashpad — the modern default).** A separate handler process is launched at startup. The crashing process, in its signal handler, does the minimum to hand control to the handler process (which has its own healthy heap, can `malloc`, can upload). This is why Chrome, and `sentry-native` under the hood, use Crashpad: the reporter's heavy lifting happens in a process that *isn't dying*. It also survives crashes that would take down an in-process handler.

**3. Alternate signal stack (`sigaltstack`).** A stack-overflow crash (SIGSEGV from exhausting the stack) leaves *no stack* for your handler to run on — so the handler itself crashes. Register an alternate signal stack with `sigaltstack()` and `SA_ONSTACK` so the handler has somewhere to execute even when the main stack is gone. Without this, every stack-overflow crash is invisible.

```c
/* Correct skeleton: alt stack + write-only handler. */
#include <signal.h>
#include <unistd.h>
#include <string.h>

static char alt_stack[SIGSTKSZ];     /* pre-allocated; NOT on the crashing stack */
static int  dump_fd = -1;            /* opened at startup, before any crash */

/* async-signal-safe: only write() + _exit(), no malloc, no printf, no locks. */
static void handler(int sig, siginfo_t *info, void *ucontext) {
    /* Real reporters capture registers from `ucontext` and walk the stack into
       a PRE-ALLOCATED buffer here. We only sketch the safe-write discipline. */
    const char msg[] = "FATAL signal; minidump written\n";
    write(dump_fd, msg, sizeof(msg) - 1);     /* bare syscall: safe */
    /* ... write captured minidump bytes from the pre-allocated buffer ... */
    _exit(128 + sig);                          /* do NOT return; do NOT exit() */
}

void install_crash_handler(void) {
    stack_t ss = { .ss_sp = alt_stack, .ss_size = sizeof(alt_stack), .ss_flags = 0 };
    sigaltstack(&ss, NULL);                    /* survive stack-overflow crashes */

    struct sigaction sa;
    memset(&sa, 0, sizeof(sa));
    sa.sa_sigaction = handler;
    sa.sa_flags = SA_SIGINFO | SA_ONSTACK | SA_RESETHAND; /* run on alt stack */
    sigemptyset(&sa.sa_mask);

    for (int s : (int[]){ SIGSEGV, SIGABRT, SIGBUS, SIGILL, SIGFPE }) {
        /* (C++ range-for shown for brevity; in C, loop an array.) */
    }
    sigaction(SIGSEGV, &sa, NULL);
    sigaction(SIGABRT, &sa, NULL);
    sigaction(SIGBUS,  &sa, NULL);
    sigaction(SIGILL,  &sa, NULL);
    sigaction(SIGFPE,  &sa, NULL);
}
```

> The single most important sentence on this page: **do not allocate, lock, or call non-async-signal-safe functions inside a native crash handler.** This is *the* rule, and it's the one most hand-rolled crash handlers violate. When in doubt, use Crashpad and let it own the handler — do not reinvent this.

### What about managed runtimes?

Go, Java, Python, Node don't make you write signal handlers for *normal* crashes — the runtime installs its own and gives you a clean `panic`/exception. But the boundary leaks:

- **Go:** a SIGSEGV from a real nil-pointer deref turns into a `panic` you *can* `recover` — but a SIGSEGV from **cgo** or a corrupt-memory bug bypasses the runtime and is a true fatal signal. The Go runtime's signal handling assumes its own stacks; mixing in C handlers is delicate. `GOTRACEBACK=crash` makes the runtime dump *all* goroutines and re-raise to produce a core.
- **JVM:** a native crash (in JNI, in the JIT, in a `.so`) produces an `hs_err_pid<pid>.log` — the JVM's own crash dump — written by an internal signal handler that *is* carefully async-signal-safe. Your Java-level handlers never see it. Capturing it means shipping that file, not catching an exception.
- **Node:** a hard crash in a native addon or V8 itself produces a core dump / `--abort-on-uncaught-exception` core; JS-level `uncaughtException` won't fire.

The senior lesson: **your language's exception handler covers the easy crashes. The fatal native ones need the native machinery above — and that machinery must obey the async-signal-safe rule or it makes things worse.**

---

## Crash-Free Rate as an SLO

### Sessions vs users — pick deliberately

- **Crash-free sessions** = `1 − crashed_sessions / total_sessions`. Sensitive: one user opening the app 50 times and crashing once reads differently than 50 users crashing once each.
- **Crash-free users** = `1 − affected_users / total_users`. Smoother, and usually the *better SLO* because it answers "what fraction of humans had a bad time," which is what the business cares about.

Use **users** for the SLO and the alert; use **sessions** for engineering diagnosis (it's more sensitive to a regression in a specific flow). This is why middle-level taught you hashed user IDs — without a stable per-user identity, crash-free-*users* is uncomputable.

| Metric | Formula | Best for | Pitfall |
|---|---|---|---|
| Crash-free sessions | `1 − crashed/total sessions` | Sensitivity, flow-level diagnosis | One heavy user skews it |
| Crash-free users | `1 − affected/total users` | The SLO; business framing | Needs stable user identity |
| ANR-free / hang-free | same shape, ANR/hang numerator | Android responsiveness; iOS watchdog | Easy to forget; not a "crash" |

### Setting the target

A naive "99.9% crash-free" is meaningless without context. Senior framing:

- **Anchor to the prior release, not an absolute.** "This release must be within 0.1% of the previous release's crash-free-users at equal adoption." Absolute targets punish you for a flaky OS update you didn't cause.
- **Segment.** A 99.95% global crash-free rate can hide a 92% rate on Android 14 / one device model. The SLO should be sliceable by OS, device, and release, and the alert should fire on the *worst meaningful segment*, not just the average.
- **Tie it to an error budget.** Below target → you spend budget → at some threshold, feature work pauses and stability work starts. This is the SRE pattern applied to client crashes; see [monitoring-alerting] and [`../metrics/senior.md`](../metrics/senior.md).

### The denominator problem

Crash-free rate is a *ratio*, and the denominator (total sessions/users) comes from a **separate telemetry path** (a session-start beacon) than the numerator (the crash, uploaded on next launch). Three traps:

1. **Sampling skew.** If you sample sessions but not crashes (or vice versa), the ratio is garbage. Sample the *same* way, or correct for it.
2. **Next-launch lag.** A crash is reported when the app *relaunches*. A user who crashes and never reopens **never reports the crash** — your crash-free rate is optimistically biased toward exactly the worst crashes (the ones that make users quit). Know this bias; it's structural.
3. **Adoption weighting.** A new release at 1% adoption has tiny denominators; one crash swings the rate wildly. Don't compare release health until adoption is comparable, or weight by it.

---

## Release Health as a Ship/Halt Gate

The senior payoff of crash-free rate is that it **automates the rollout decision**.

### The staged-rollout circuit breaker

```text
   deploy v4.3.0 ─► 1% cohort ─► measure crash-free-users (this cohort, ~1h)
                                     │
                  ┌──────────────────┴──────────────────┐
            within budget of v4.2.x?              below budget?
                  │                                       │
                  ▼                                       ▼
            advance: 1%→5%→25%→100%            HALT rollout, page on-call,
            (re-measure at each step)          (mobile) stop the staged
                                               release in Play/App Store;
                                               (backend) auto-rollback deploy
```

- **Backend** makes this loop *tight*: canary deploy → watch panic/error rate for the canary's traffic → automated rollback (Argo Rollouts, Spinnaker, Flagger) on breach. Minutes end-to-end, because you control the fleet and can redeploy instantly.
- **Mobile** makes it *slow and one-way*: Play Store staged rollout and App Store phased release let you *halt* (and on Android, halt is the main lever — rollback means shipping a *new* build that the user must download). You cannot un-ship a binary. So the gate is even more valuable: catching it at 1% saves the other 99% from a fix you can't push for *days*.

### Wiring it

Sentry "Release Health" and Crashlytics "Velocity alerts" give you the primitives: per-release crash-free metrics and "crash affecting X% of users in the first N hours" alerts. The senior work is connecting the alert to the *rollout control*:

- Mobile: an alert → a runbook step → an engineer halts the staged rollout. (Full automation is rare because the store APIs and the stakes make a human-in-the-loop sane.)
- Backend: an alert → automated rollback via the deploy tool, with the crash-free / error-rate metric as the analysis input.

> The principle: **a release proves itself healthy before it earns more traffic.** Adoption is a privilege the build earns by not crashing the cohort it already has.

---

## Dedup & Fingerprinting as a Contract

Middle level: fix one bad fingerprint. Senior level: own the fingerprint *policy* over time, because its failure modes are slow and corrosive.

### The three layers of grouping (and where to intervene)

```text
   1. SDK default fingerprint        (exception type + normalized in-app frames)
            │
   2. Client-side override           (scope.SetFingerprint — for KNOWN cases)
            │
   3. Server-side grouping rules     (Sentry "grouping enhancements", stack rules)
            │
            ▼
        ISSUE (one bug ⇄ many events)
```

The senior preference: **push grouping policy server-side wherever possible.** A client-side `setFingerprint` is frozen into shipped binaries — to change it on mobile you ship a new app and wait days. Server-side grouping enhancements (mark these frames out-of-app, fold this recursion, treat these two exception types as one) are **editable without a deploy** and apply retroactively. Client overrides are for cases only the client knows (a domain-specific category); structural grouping rules belong on the server.

### Fingerprint drift — the silent killer

Drift is when "the same bug" gets a *different* fingerprint over time, re-splitting your history. Causes:

| Cause | Mechanism | Fix |
|---|---|---|
| New obfuscation map each build | R8/ProGuard renames `a.b.c` differently per release → frames differ → fingerprint differs | Server symbolicates *before* grouping; group on de-obfuscated names |
| Inlining changes | Compiler inlines a frame in one build, not the next → stack shape changes | Grouping enhancements that fold known wrappers; group on logical frames |
| Refactor moves code | File/line/function names change → default fingerprint changes | Pin a stable `fingerprint` for high-value issues; accept some drift on tail |
| SDK version bump changes grouping | Vendor improves the default algorithm → everything re-groups once | Expect a one-time re-shuffle; don't bump SDK mid-incident |
| Message still has an ID | (middle-level bug, still common) dynamic value in message | Normalize message / explicit fingerprint |

The tell-tale: **after a release, your dashboard shows a wave of "new" issues that are actually old bugs with new fingerprints.** Your regression detector ("alert on new issues") now cries wolf, and a *genuinely* new regression hides in the noise. Drift doesn't crash anything — it just quietly destroys your ability to answer "is this new?"

### Dedup correctness, not just convenience

Two failure directions, with senior-specific causes:

- **Over-grouping (under-splitting):** two distinct bugs merge → you fix one, the issue won't resolve, and worse, *a regression hides inside an existing issue* — a brand-new crash folds into an old group and you never get the "new issue" alert. Watch event-*rate* per issue, not just new-issue creation, or regressions sneak in through the back door.
- **Under-grouping (over-splitting):** one bug shatters into thousands → quota burn, alert fatigue, and crash-free-rate math that's fine but a dashboard that's unusable. Almost always a per-request value in the fingerprint, or unsymbolicated frames.

---

## Sampling & Quota Under Load

Crashes are *not* logs — you usually want every fatal one. But "every fatal one" and "every handled exception" are different budgets, and at scale you must decide deliberately. See [`../telemetry-cost-and-sampling-strategy/`](../telemetry-cost-and-sampling-strategy/) for the cost dimension; here's the crash-specific policy.

### The budget table

| Event class | Default policy | Why |
|---|---|---|
| **Fatal crash / unhandled** | **Capture 100%.** Never sample. | Rare, precious; the whole point. Sampling these deletes the long-tail bug you needed. |
| **Handled exception (`captureException`)** | Sample, often heavily | High-volume; the 10,000th identical handled timeout teaches nothing. |
| **Frequent known-noisy issue** | Per-issue rate limit / `beforeSend` drop | One chatty issue shouldn't drown the rest. |
| **Breadcrumbs** | Cap count + scrub | Not sampled per se, but a payload-size and PII budget. |
| **Session/health beacons** | Sample to match crash sampling | The denominator must match the numerator or crash-free math breaks. |

### Sampling without losing the rare fatal bug

The central tension: uniform random sampling deletes rare events *in proportion to their rarity* — so the once-a-day fatal bug is exactly what you drop. Senior techniques to sample *and* keep the tail:

1. **Sample by *issue*, not by *event*.** Keep the first N events of every fingerprint at full fidelity (so every distinct bug is seen), then sample additional events of *already-known* issues. New = always captured; repeats = sampled. This is *reservoir-per-group* thinking.
2. **Tail-based on severity.** Decide sampling *after* you know what it is: fatal → keep; handled-and-common → drop. (Trivial for crashes since you know the type at capture.)
3. **Spike protection / dynamic rate.** When a single issue floods (a crash loop), drop *additional* copies of *that* issue while still admitting others. Sentry's spike protection does this server-side; you can also rate-limit per-fingerprint client-side.
4. **Make the SDK honest about what it dropped.** Sentry "client reports"/outcomes record sampled/rate-limited counts so your crash-free math can *correct* for sampling instead of being silently wrong.

### Quota mechanics you must respect

- **Honor `Retry-After` on 429.** The backend rate-limits; the SDK must back off, not retry-storm. A naive retry loop during an incident DDoSes your own ingest and burns quota on retries of dropped events.
- **Bound the offline queue.** Mobile uploads on next launch; a device offline for a week shouldn't replay 50,000 stale crashes (and you don't want week-old data anyway). Cap the queue and drop oldest.
- **Crash loops are a quota bomb.** An app that crashes *during startup* crashes → relaunches → crashes again, forever, each time queuing a report. Without per-issue spike protection, one crash-looping release can burn a month of quota in an hour. This has happened to real teams (see Failure Stories).

---

## Mobile vs Backend — Two Different Problems

The single most important senior framing. The SDK is shared; the engineering is not.

### Backend specifics

- **The orchestrator is your recovery.** A panic kills one replica; Kubernetes restarts it in ~200ms. Crash reporting's job is **trend and triage**, not survival — survival is the platform's job. The alert that matters is *restart rate* / *crash rate*, not any single crash.
- **No "next launch" lag.** You capture and ship the report *as the process dies* (or from a sidecar reading core dumps). Reports are real-time.
- **Crash classes:** uncaught `panic`/exception, `OOMKilled` (the kernel sends SIGKILL — **no chance to report**, so you infer it from exit code 137 + cgroup metrics, not from the SDK), segfaults in cgo/native deps, deadlock-induced liveness-probe kills.
- **The dangerous one is OOMKill,** because there's *no signal to catch* — SIGKILL is uncatchable. You detect it out-of-band: exit code 137, `container_oom_events`, the kernel log. Your crash reporter will show *nothing*; the absence is the signal. Cross-reference with [`../debugging/senior.md`](../debugging/senior.md) memory tooling.

### Mobile specifics

- **No recovery, ever.** The app died on a phone you don't own. The user's experience is *already ruined*; all you can do is learn.
- **Capture-on-next-launch is the model.** The SDK persists a minimal crash record to disk in the (safe) handler; on the *next* app start it reads, enriches, and uploads. Consequence: **crashes that stop the user from relaunching are under-reported** — the structural bias from the SLO section.
- **OOM is invisible here too,** and worse: iOS gives almost no signal. You infer OOM from "app was alive, then a fresh launch with no crash record and a memory-pressure breadcrumb." Sentry/Crashlytics use heuristics (a launch that isn't a normal start and isn't a recorded crash ⇒ probably OOM/watchdog).
- **ANR (Android) / watchdog (iOS) are first-class, separate signals.** A 6-second main-thread block isn't a crash — no signal fires — but the user sees a frozen app and the OS may kill it. You detect ANRs with a watchdog thread that pings the main thread; iOS watchdog terminations come via MetricKit `MXCrashDiagnostic` / heuristics. **A health story that ignores ANR/hang is half-blind.**
- **MetricKit (iOS) / ApplicationExitInfo (Android 11+)** give OS-sourced exit reasons on next launch — the authoritative "why did we die last time," including OOM and watchdog, which your in-process SDK couldn't catch. Senior mobile reporting *fuses* SDK crashes with OS exit-reason APIs.
- **You can't hotfix.** Store review + staged rollout + user-must-update means fix latency is *days*. This is *the* reason release-health gating matters more on mobile than anywhere else: prevention beats a fix you can't deliver.

### One table to remember

| Question | Backend answer | Mobile answer |
|---|---|---|
| How do I capture a crash? | At process death / from core dump | Persist in handler, upload **next launch** |
| What about OOM? | Infer from exit 137 + cgroup; no signal | Infer from heuristics + MetricKit/ApplicationExitInfo; no signal |
| How fast can I fix? | Minutes (redeploy) | Days (store + user update) |
| What's my main metric? | Crash/restart **rate** | Crash-**free** sessions/users + ANR/hang |
| What's my safety net? | Orchestrator restart + canary rollback | Staged rollout halt (can't roll back in-place) |
| Hardest crash to see? | OOMKill (uncatchable SIGKILL) | OOM/watchdog + crashes that stop relaunch |

---

## The Native Path — Minidumps, Crashpad, Symbol Servers

When your crash is in C/C++/Rust/NDK/JNI/Swift, there's no neat exception object — there's a corrupt process and a CPU. The native pipeline:

```text
   CRASH (SIGSEGV)                CRASHPAD HANDLER (separate process)        BACKEND
   ──────────────                ───────────────────────────────────        ───────
   in-process minimal     ──►    capture full minidump                ──►    SYMBOLICATE
   (signal → wake handler)       (registers, threads, stack, modules)        against .sym /
                                 write to disk; upload (retry/offline)        DWARF/PDB keyed
                                                                              by BUILD ID
```

- **Minidump** (Breakpad/Crashpad format, also Windows-native): a compact snapshot — register state, every thread's stack, loaded modules with their build IDs. Small enough to upload, rich enough to symbolicate.
- **Crashpad > Breakpad** for new work: out-of-process handler (safer — see signal section), better Windows/macOS support, handles more crash types. `sentry-native` embeds Crashpad. Breakpad is the older in-process design still used in many shipping products.
- **Build ID is the join key.** The minidump records each module's unique build ID; the backend looks up the *exact* matching `.sym`/DWARF/PDB by that ID. This is why a **symbol server** matters at scale: you can't manually match symbols to a fleet running 40 different builds. Upload every build's symbols, keyed by build ID, and let the backend fetch the right ones. (Same release-must-match-symbols rule from middle level, now mechanized by build ID instead of a release string.)
- **`dump_syms`** converts your DWARF/PDB into Breakpad `.sym` files at build time; `minidump_stackwalk` (or the backend) symbolicates. Wire `dump_syms` into CI exactly like source-map upload — per build, gated, non-optional.

> Native is the home of every rule on this page at once: the handler must be async-signal-safe, the symbol upload must be CI-automated and build-ID-keyed, and the out-of-process design is what makes safe capture possible. If you ship native code, you own this pipeline; don't hand-roll the handler — adopt Crashpad.

---

## Code Examples

### Go — chaining handlers, `GOTRACEBACK=crash`, and OOM you *can't* catch

```go
package main

import (
	"os"
	"runtime/debug"

	"github.com/getsentry/sentry-go"
)

func main() {
	_ = sentry.Init(sentry.ClientOptions{
		Dsn:         os.Getenv("SENTRY_DSN"),
		Release:     os.Getenv("APP_RELEASE"),
		Environment: os.Getenv("APP_ENV"),
		// SAMPLING POLICY: keep all *fatal* events; sample handled ones elsewhere.
		SampleRate: 1.0, // error/crash sample rate — DO NOT lower for crashes
		// Spike guard: drop additional copies of a flooding issue client-side.
		BeforeSend: rateLimitPerFingerprint(50), // see pattern below
	})
	defer sentry.Flush(2 * 1e9) // 2s: give the queue a chance before exit

	// A real nil-deref becomes a recoverable panic; cgo segfaults do NOT.
	defer func() {
		if r := recover(); r != nil {
			sentry.CurrentHub().Recover(r)
			sentry.Flush(2 * 1e9)
			debug.PrintStack()
			os.Exit(2) // re-establish crash semantics; don't swallow
		}
	}()

	run()
}

// NOTE: an OOMKill (exit 137 / SIGKILL) reaches NONE of this code.
// You detect that out-of-band: container exit code + cgroup memory events.
// GOTRACEBACK=crash (env) makes the runtime dump ALL goroutines and dump core
// on an un-recovered fatal error — invaluable for native/cgo crashes.
func run() { /* ... */ }
```

### Java / JVM — capturing the native crash log the SDK can't catch

```java
// A crash inside JNI / the JIT / a .so produces hs_err_pid<pid>.log — written
// by the JVM's OWN async-signal-safe handler. Your Thread.setDefault
// UncaughtExceptionHandler NEVER sees it. So: point the JVM at a known dir and
// ship the file from a sidecar / on next start.

// JVM flags (set at launch, not in code):
//   -XX:ErrorFile=/var/crash/hs_err_pid%p.log
//   -XX:+CrashOnOutOfMemoryError        // turn OOM into a catchable-ish crash + dump
//   -XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=/var/crash/

// On startup, sweep the crash dir and upload anything from the previous run:
import java.nio.file.*;
import io.sentry.Sentry;
import io.sentry.SentryEvent;
import io.sentry.protocol.Message;

void uploadPreviousNativeCrashes(Path crashDir) throws Exception {
    if (!Files.isDirectory(crashDir)) return;
    try (var s = Files.list(crashDir)) {
        s.filter(p -> p.getFileName().toString().startsWith("hs_err_pid"))
         .forEach(p -> {
             SentryEvent ev = new SentryEvent();
             Message m = new Message();
             m.setMessage("JVM native crash (hs_err): " + p.getFileName());
             ev.setMessage(m);
             // STABLE fingerprint: group all JVM native crashes of one signature,
             // parse the "Problematic frame" line to split by faulting library.
             ev.setFingerprints(java.util.List.of("jvm-native-crash",
                     problematicFrame(p)));   // e.g. "C  [libfoo.so+0x1a2b]"
             Sentry.captureEvent(ev);
             archive(p); // move so we don't re-upload next launch
         });
    }
}
```

### Python — sampling handled exceptions while keeping every fatal one

```python
import os, random, sentry_sdk

# Fatal/unhandled crashes arrive WITHOUT a sampling decision applied here
# (the SDK captures them at full fidelity). We only down-sample the noisy,
# explicitly-handled captures, and we do it per-fingerprint so a rare bug
# is never sampled to zero.
_seen: dict[str, int] = {}

def before_send(event, hint):
    exc_info = hint.get("exc_info")
    mechanism = (event.get("exception", {}).get("values", [{}])[-1]
                 .get("mechanism", {}))
    handled = mechanism.get("handled", True)

    if not handled:
        return event  # FATAL: never sample, never drop

    # Handled: keep the first 20 of each fingerprint, then sample at 5%.
    fp = "|".join(event.get("fingerprint") or
                  [v.get("type", "?") for v in
                   event.get("exception", {}).get("values", [])])
    n = _seen[fp] = _seen.get(fp, 0) + 1
    if n <= 20:
        return event
    return event if random.random() < 0.05 else None

sentry_sdk.init(
    dsn=os.environ["SENTRY_DSN"],
    release=os.environ.get("APP_RELEASE"),
    environment=os.environ.get("APP_ENV"),
    sample_rate=1.0,          # error capture (incl. crashes) stays at 1.0
    before_send=before_send,
)
```

### Node.js — honoring rate limits and bounding the queue

```js
const Sentry = require("@sentry/node");

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  release: process.env.SENTRY_RELEASE,
  // Crashes (uncaughtException) captured at full rate; the transport below
  // is what keeps a crash-loop from DDoSing ingest.
  sampleRate: 1.0,
  // Transport-level: the SDK already backs off on 429 + Retry-After.
  // Bound how much we buffer so an offline burst can't replay forever.
  transportOptions: { bufferSize: 30 }, // drop oldest past 30 queued envelopes
  beforeSend(event) {
    // Per-issue spike guard: count by fingerprint, drop floods of ONE issue.
    return spikeGuard(event); // returns null to drop
  },
});

// uncaughtException handler MUST exit — the process state is now unknown.
process.on("uncaughtException", (err) => {
  Sentry.captureException(err);
  Sentry.flush(2000).finally(() => process.exit(1)); // do NOT keep serving
});
```

### Rust — `sentry-native`/Crashpad backend + panic capture

```rust
// Cargo.toml:
//   sentry = { version = "0.34", features = ["crashpad"] } // out-of-process handler
//
// The crashpad feature spawns a SEPARATE handler process at init. Native crashes
// (SIGSEGV, abort) are captured by Crashpad in that healthy process — NOT in the
// signal context of the dying one. Panics are captured by the panic integration.

fn main() {
    let _guard = sentry::init((
        std::env::var("SENTRY_DSN").ok(),
        sentry::ClientOptions {
            release: Some(env!("CARGO_PKG_VERSION").into()),
            environment: Some("production".into()),
            // Crashes are captured at full fidelity; sample handled events elsewhere.
            sample_rate: 1.0,
            // before_send for scrubbing (middle level); keep it allocation-light.
            before_send: Some(std::sync::Arc::new(|mut e| {
                if let Some(u) = e.user.as_mut() { u.email = None; }
                Some(e)
            })),
            ..Default::default()
        },
    ));

    // A `panic!` is caught by the panic integration. A genuine memory-corruption
    // SIGSEGV is caught by Crashpad's out-of-process handler — the ONLY safe way.
    run();
}
# fn run() {}
```

### Native C++ — what NOT to do (the crash amplifier)

```cpp
// ❌ THE CLASSIC FATAL MISTAKE: doing unsafe work in a signal handler.
void bad_handler(int sig) {
    std::string report = "crash: signal " + std::to_string(sig); // malloc → may deadlock
    std::ofstream f("/tmp/crash.log");                           // allocates, locks
    f << report << std::endl;                                    // stdio locks
    Reporter::instance().upload(report);                         // network in a dying proc
}
// Under heap corruption, the first `malloc` blocks on a lock the crashed thread
// holds. The process HANGS instead of crashing. No report. No restart. Worse than
// nothing. ── Use Crashpad; let it own the handler and do this work out-of-process.
```

---

## Worked Example — A Release Halted by Crash-Free Rate

**Setup.** A mobile team ships v6.4.0 via a Play Store staged rollout (1% → 5% → 20% → 50% → 100%). Their SLO: *crash-free users for a release must be within 0.15% of the trailing 7-day baseline (99.82%) at comparable adoption.* An alert is wired: "release crash-free-users < 99.6% with ≥ 5,000 sessions."

**T+0 (1% cohort).** Rollout starts. Adoption climbs to ~1% over an hour. Crash-free-users for v6.4.0: **99.83%.** Within budget. The automation advances to 5%.

**T+70m (5% cohort).** Crash-free-users dips to **99.4%** with 11,000 sessions. The alert fires; the staged rollout is **held** (not advanced). On-call is paged. *The math stopped the build at 5% before 95% of users ever saw it.*

**Triage.** Open release health → the drop is concentrated in **one issue**, fingerprint `["camera", "AVCapture", "ConfigurationError"]`, and it's **new in v6.4.0** (no events in v6.3.x). Segmenting: 100% of the affected sessions are on **Android 14, on two Samsung models**, in the new QR-scan flow.

**Root cause.** A camera-permission API behaves differently on Android 14; the new scan flow dereferences a null `CameraDevice`. It never reproduced in QA because QA's test devices were Android 13.

**Why the gate worked.**
- The fingerprint was **stable and specific** (camera/AVCapture/ConfigError), so the regression surfaced as *one* clear issue, not scattered noise.
- It was **new** (not folded into an existing group), so "new high-volume issue in this release" was a true alert, not drift noise. *(Had fingerprint drift been present, this regression could have hidden inside an old group — the over-grouping trap.)*
- **Crash-free-users** (not sessions) made the SLO robust; **segmentation** revealed the device/OS scope immediately.

**Resolution.** The rollout stays halted. A fix ships as v6.4.1 (days later — *you can't hotfix the 5% who already have v6.4.0*; you can only stop the bleeding and push forward). The 5% cohort is the blast radius. Had the gate not existed, the bug would have reached 100% before anyone noticed the dashboard.

**Senior takeaways.**
- The gate's value is **prevention**, because the fix latency is days. Catching at 5% saved 95%.
- The **denominator/adoption** logic mattered: comparing 1% adoption to a 100%-adoption baseline would have been noise; the alert waited for ≥5,000 sessions.
- **Segmentation** turned "crashes went up" into "Android 14 / Samsung / scan flow" in two minutes.
- File the gap: **QA device matrix must include the newest OS.** Add an Android-14 device to CI.

---

## Failure Stories

**1. The crash handler that hung the fleet.** A team added a native crash handler that, on SIGSEGV, formatted a nice message with `snprintf` into a `std::string` and wrote it via `std::ofstream`. In testing (clean crashes) it worked. In production, a *heap-corruption* bug triggered SIGSEGV while the allocator lock was held — the handler's `malloc` deadlocked. Result: processes **hung** instead of crashing, liveness probes eventually killed them after the timeout, and **zero crash reports** were captured for the worst bug they had. Fix: replaced with Crashpad (out-of-process) and a write-only async-signal-safe path. *Lesson: the handler must obey `signal-safety(7)`, full stop.*

**2. The crash-loop that burned a month of quota in 90 minutes.** A bad release crashed *during startup* on a subset of devices. Each crash → relaunch → upload the queued report → crash again. With no per-issue spike protection, the SDK dutifully uploaded the same crash millions of times. The crash-reporting bill for the month was exhausted before lunch, and *real* crashes from other issues were then rate-limited (429) and lost. Fix: enable server-side spike protection + per-fingerprint client rate limiting + a bounded offline queue. *Lesson: a crash loop is a quota DoS against yourself.*

**3. The regression that hid inside an old issue.** Over-grouping merged a brand-new null-deref into a long-standing "generic NullPointerException" group whose event rate was already high and noisy. The new-issue alert never fired (it wasn't a new issue), and the rate bump was lost in the existing noise. The regression shipped to 100% and ran for a week. Fix: split the over-grouped issue, and add alerting on **per-issue event-rate change**, not just new-issue creation. *Lesson: over-grouping hides regressions; watch rates within issues.*

**4. The crash-free rate that lied.** A team sampled *sessions* (the denominator) at 10% to save cost but captured *crashes* at 100%. Their crash-free rate read **far worse** than reality because the numerator and denominator were sampled differently. Panic ensued over a non-existent stability regression. Fix: sample the health beacon and the crashes consistently, or correct mathematically using the SDK's drop/outcome counts. *Lesson: a ratio with mismatched sampling on top and bottom is garbage.*

**5. The OOM that showed nothing.** A backend service was getting OOMKilled (exit 137) under load. The crash reporter showed *no crashes* — because SIGKILL is uncatchable; the kernel reaps the process with no chance to report. The team spent a day looking for a bug in the (silent) reporter before someone checked `kubectl get pods` restart reasons and the cgroup memory metrics. Fix: alert on `container_oom_events` and exit-code-137 restarts directly; stop expecting the crash SDK to see OOM. *Lesson: the absence of a crash report can be the signal — OOMKill is invisible to in-process reporters.*

---

## Pros & Cons

| Decision | Pros | Cons |
|---|---|---|
| **Crash-free rate as an SLO with auto-halt** | Bad builds stop themselves; prevention beats a slow fix | Needs reliable denominator + adoption logic; false halts erode trust |
| **Out-of-process handler (Crashpad)** | Survives heap corruption; safe to do real work | Extra process; setup complexity; another thing to ship |
| **In-process signal handler (Breakpad)** | No extra process; simpler deploy | Must be async-signal-safe; fragile under corruption |
| **Sample handled exceptions, never crashes** | Controls cost without losing fatal bugs | Two-tier policy to maintain; easy to misconfigure |
| **Per-issue spike protection** | One crash loop can't burn the quota | Must distinguish "flood of one bug" from "many bugs" |
| **Server-side grouping rules over client overrides** | Editable without a deploy; retroactive | Less context than the client has; vendor-specific |
| **Fuse SDK crashes + OS exit-reason APIs (MetricKit/ApplicationExitInfo)** | See OOM/watchdog the SDK can't | More integration; data arrives delayed/batched |
| **Self-host the crash backend** | Data residency; no per-event SaaS bill | You operate ingest, symbolication, storage at scale |

---

## Use Cases

- **"Is this release safe to roll to 100%?"** → release-health gate on crash-free-users, segmented by OS/device, compared at equal adoption.
- **"Our crash bill tripled overnight."** → a crash-looping release with no spike protection; add per-fingerprint rate limiting + bounded queue.
- **"One bug created 400,000 issues."** → fingerprint drift or per-request value in the fingerprint; symbolicate-before-group, pin stable fingerprints.
- **"The reporter caused a hang."** → unsafe work in a signal handler; move to Crashpad/out-of-process, async-signal-safe write-only path, `sigaltstack`.
- **"Crash-free rate dropped but no new issues."** → over-grouping hid a regression; split the issue, alert on per-issue rate.
- **"The dashboard is empty but pods keep restarting."** → OOMKill (uncatchable); detect via exit 137 + cgroup metrics, not the SDK.
- **"Our crash-free number doesn't match support tickets."** → next-launch bias (users who crash and quit never report) and/or sampling skew between numerator and denominator.

---

## Coding Patterns

### Pattern: per-fingerprint spike guard (client-side)

```go
func rateLimitPerFingerprint(maxPerFP int) func(*sentry.Event, *sentry.EventHint) *sentry.Event {
	var mu sync.Mutex
	counts := map[string]int{}
	return func(e *sentry.Event, _ *sentry.EventHint) *sentry.Event {
		fp := strings.Join(e.Fingerprint, "|")
		mu.Lock()
		counts[fp]++
		n := counts[fp]
		mu.Unlock()
		if n > maxPerFP { // one flooding issue can't drown the rest
			return nil
		}
		return e
	}
}
```

### Pattern: two-tier sampling (crashes 100%, handled sampled)

```python
return event if not handled else (event if keep_handled(event) else None)
# Fatal/unhandled is never gated by your sampling; only handled captures are.
```

### Pattern: stable fingerprint from a structured signature

```java
ev.setFingerprints(List.of(subsystem, faultingModule, errClass)); // no IDs, no line offsets
```

Compose from *categorical, symbolicated* parts so the key survives obfuscation churn and refactors.

### Pattern: detect OOM out-of-band (backend)

```yaml
# Prometheus alert — the SDK can't see SIGKILL, so watch the kernel/orchestrator.
- alert: ContainerOOMKilled
  expr: increase(container_oom_events_total[5m]) > 0
  # cross-reference: kube_pod_container_status_last_terminated_reason{reason="OOMKilled"}
```

### Pattern: fuse OS exit reasons (Android 11+)

```kotlin
// On next launch, read why we REALLY died last time — incl. OOM/ANR the SDK missed.
val am = getSystemService(ActivityManager::class.java)
am.getHistoricalProcessExitReasons(packageName, 0, 5).forEach { info ->
    when (info.reason) {
        ApplicationExitInfo.REASON_LOW_MEMORY,           // OOM the SDK can't catch
        ApplicationExitInfo.REASON_ANR -> reportExit(info) // ANR
    }
}
```

---

## Clean Code

- **The native handler does only async-signal-safe work.** Capture to a pre-allocated buffer, `write()` to a pre-opened fd, `_exit`. Enrichment/upload happens in a healthy context. No exceptions to this rule.
- **Crashes are captured at 100%; only handled events are sampled.** Make the two-tier policy explicit and tested, not implicit in a single sample rate.
- **Fingerprints are composed from stable, symbolicated, categorical parts** — owned as a policy, reviewed when code moves, never containing IDs or raw offsets.
- **Grouping policy lives server-side where it can** so it's editable without a deploy and applies retroactively.
- **The crash-free SLO is wired to the rollout**, segmented, adoption-aware, and compared to a baseline — not an absolute vanity number.
- **Spike protection and a bounded queue are on** so a crash loop can't DoS your quota.
- **OOM/ANR/watchdog detection is explicit and out-of-band** — the SDK can't see them; fuse OS exit-reason APIs and orchestrator signals.
- **The reporter flushes then exits on a fatal crash.** Never keep serving on a process whose state is now undefined.

---

## Best Practices

1. **Never do unsafe work in a signal handler.** Async-signal-safe only; prefer Crashpad/out-of-process; register a `sigaltstack` for stack-overflow crashes.
2. **Capture every fatal crash; sample only handled exceptions** — and sample per-issue so rare bugs survive.
3. **Make crash-free *users* the SLO**, segment by OS/device/release, compare to a baseline at equal adoption, and alert on the worst meaningful segment.
4. **Gate the rollout on release health.** Backend: canary + auto-rollback. Mobile: staged rollout with a halt runbook (you can't roll back in place).
5. **Own fingerprinting as a contract.** Symbolicate before grouping; prefer server-side grouping rules; watch for drift after every release.
6. **Turn on spike protection and bound the offline queue.** A crash loop must not burn the month's quota.
7. **Honor `Retry-After`/429.** Don't retry-storm your own ingest during an incident.
8. **Fuse OS exit-reason APIs** (MetricKit, ApplicationExitInfo) and orchestrator signals (exit 137, OOM events) — the SDK is blind to OOM/watchdog.
9. **Match sampling of the health denominator to the crash numerator,** or your crash-free math lies.
10. **Test the worst paths:** induce a stack overflow, a cgo segfault, an OOM, a crash-during-init, and confirm what each does to your pipeline *before* production does.

---

## Edge Cases & Pitfalls

- **Crash during SDK init.** If the app crashes before the reporter is fully initialized, the crash is lost. Initialize the crash handler *first*, before any other startup work, and make it the cheapest possible thing.
- **Stack-overflow crash with no `sigaltstack`.** The handler has no stack to run on and crashes itself. Every stack-overflow is then invisible. Always register an alternate signal stack.
- **OOMKill is uncatchable.** SIGKILL gives no handler a chance. Don't expect the SDK to see it; detect out-of-band.
- **Next-launch bias.** Crashes that make users *quit* under-report. Your crash-free rate is optimistically biased toward exactly your worst crashes. Cross-check with OS exit-reason APIs and support volume.
- **Mismatched numerator/denominator sampling.** Sampling sessions ≠ sampling crashes → wrong crash-free rate. Sample consistently or correct with outcome counts.
- **Fingerprint drift after an SDK upgrade.** Vendors improve grouping; one upgrade re-groups everything once. Don't bump the SDK mid-incident, and expect a one-time reshuffle.
- **Adoption-blind release comparison.** Comparing a 1%-adoption new release to a 100%-adoption baseline is noise. Wait for comparable denominators.
- **Retry storm on 429.** A naive transport that ignores `Retry-After` amplifies an incident into a self-DoS.
- **Two crash SDKs fighting over the handler.** Crashlytics + Sentry + a native handler all want SIGSEGV. They must chain; a mis-ordered install breaks capture. Pick a clear owner of the native handler.
- **`recover` swallowing a panic in Go.** Recovering and continuing on a corrupt state is worse than crashing; recover to *report and re-exit*, not to limp on.

---

## Common Mistakes

1. **Allocating/locking/`printf`-ing inside a signal handler** — the single most common fatal native mistake; it turns a crash into a hang.
2. **Sampling crashes** (confusing crash capture with perf-trace or log sampling) — you delete the rare fatal bug you needed most.
3. **No spike protection** — one crash-looping release burns the month's quota and rate-limits real crashes.
4. **Absolute crash-free targets** with no baseline/segmentation — you alert on OS-update noise and miss device-specific regressions.
5. **Trusting the SDK to see OOM** — it can't; the silent dashboard fools you for a day.
6. **Letting fingerprints drift** across releases — your regression detector dies quietly and every deploy looks like a fresh wave of "new" bugs.
7. **Client-only grouping overrides on mobile** — frozen into the binary; you wait days to fix a grouping mistake you could have fixed server-side instantly.
8. **Comparing releases before adoption is comparable** — tiny denominators swing the rate; you halt good builds and ship bad ones.
9. **Ignoring ANR/watchdog** — a "great" crash-free rate while users stare at frozen screens.
10. **Keeping the process alive after `uncaughtException`/panic** — serving on undefined state corrupts data; flush and exit.

---

## Tricky Points

- **A clean panic is the *easy* crash.** The dangerous ones — heap-corruption SIGSEGV, OOMKill, crash-in-handler, crash-during-init — are exactly the ones naive capture misses, and they're your worst bugs by definition.
- **Crash-free rate is structurally optimistic.** The crashes that stop a relaunch never report (next-launch model). The number flatters you about your most user-hostile crashes.
- **Over-grouping hides regressions; under-grouping hides everything in noise.** Both break "is this new?" — the question your release gate depends on.
- **The signal handler may run with a corrupt heap and dead-thread-held locks.** That's why `malloc`/mutex are forbidden, and why out-of-process is the robust answer.
- **OOM gives no signal.** SIGKILL is uncatchable; "no crash report + restarts" *is* the OOM signal. Absence is data.
- **Server-side grouping is editable; client-side is shipped.** On mobile that difference is days of fix latency. Push grouping policy to the server.
- **`GOTRACEBACK=crash` / `-XX:ErrorFile` / core dumps** are how you see the crashes *below* the language runtime. The exception handler doesn't cover them.
- **Sampling sessions and crashes differently breaks the *ratio*, not just the counts.** A crash-free rate is only meaningful when top and bottom are sampled identically.

---

## Test Yourself

1. Your native crash handler calls `malloc` to format a report. Describe the exact failure mode under a heap-corruption SIGSEGV, and the three changes that fix it.
2. You must keep crash-reporting cost flat while volume 10×'d. What do you sample, what do you *never* sample, and how do you sample without deleting a once-a-day fatal bug?
3. A mobile release shows 99.9% crash-free *sessions* but support is flooded with "app keeps closing." Give two structural reasons the number can be misleading here.
4. After every release your dashboard fills with "new" issues that are old bugs. Name the cause, the mechanism, and the fix.
5. A backend service has zero crash reports but pods restart every few minutes. What's the most likely cause, and which signals confirm it (the SDK won't)?
6. Design the ship/halt gate for a Play Store staged rollout: what metric, what comparison, what segmentation, what action — and why can't you "roll back"?
7. Why is `sigaltstack` mandatory for capturing stack-overflow crashes, and what happens without it?
8. Your crash-free rate suddenly reads far worse with no real regression. The only recent change was sampling sessions at 10%. Explain the math error.

---

## Tricky Questions

**Q1: Why is calling `captureException` (or any allocating function) wrong inside a native SIGSEGV handler, and what's the correct design?**

Because a SIGSEGV can interrupt the process mid-`malloc`, holding the allocator lock. Calling anything that allocates (or locks) from the handler can deadlock against that held lock or corrupt the heap further — turning a crash into a *hang* with no report. The handler must be **async-signal-safe**: capture registers/stack into a *pre-allocated* buffer and `write()` it to a *pre-opened* fd, then `_exit`. Enrichment, symbolication, and upload happen later in a healthy context. The robust production answer is **out-of-process** (Crashpad): the dying process only signals a separate, healthy handler process that does the real work. Also register `sigaltstack` so stack-overflow crashes have a stack to run on.

**Q2: You're at a million crash events a minute. How do you control cost without losing rare fatal bugs?**

Never sample *fatal/unhandled* crashes — they're rare and the long tail is the whole value. Sample *handled* exceptions aggressively, and do it **per-fingerprint**: keep the first N events of every distinct issue (so every bug is seen at least N times), then sample additional copies of *already-known* issues. Add **spike protection** so one flooding issue can't drown the rest or burn quota, **bound the offline queue**, and **honor 429/`Retry-After`** so an incident doesn't become a retry-storm self-DoS. Make the SDK report what it dropped so crash-free math can correct for sampling.

**Q3: Crash-free *sessions* is 99.9% but users report constant crashes. Give two structural reasons.**

(1) **Next-launch bias:** crashes are uploaded on the *next* app start, so a crash bad enough that the user quits and never reopens is *never reported* — the metric is optimistically biased toward exactly the worst crashes. (2) **Sessions vs users:** one user crashing every session counts as many crashed sessions against a huge total of healthy sessions from others, diluting the rate; *crash-free users* would expose it. Also possible: a denominator inflated by background/no-op sessions, or ANR/watchdog freezes that aren't counted as "crashes" at all.

**Q4: After each release, old bugs reappear as "new" issues. What happened and how do you stop it?**

**Fingerprint drift.** Each release's obfuscation map (R8/ProGuard) renames frames differently, or inlining/refactors change the stack shape, so the *same* bug gets a *different* fingerprint and re-splits. Your "alert on new issues" regression detector now fires constantly (false positives), and a *real* new regression hides in the noise. Fix: **symbolicate/de-obfuscate before grouping** so the key is built from real names; apply **server-side grouping rules** to fold known wrappers and recursion; **pin stable fingerprints** for high-value issues; and don't bump the SDK's grouping algorithm mid-incident.

**Q5: A backend service shows no crashes but its pods restart constantly. What's going on?**

Almost certainly **OOMKill**. The kernel sends an *uncatchable* SIGKILL when the cgroup memory limit is exceeded — the process gets no chance to run any handler, so the crash SDK sees and reports nothing. The signal is *out-of-band*: container exit code 137, `kube_pod...last_terminated_reason="OOMKilled"`, `container_oom_events`, the kernel OOM log. The senior reflex: **a silent crash reporter plus restarts equals OOM** — stop looking for a bug in the reporter and go read the orchestrator/cgroup signals.

**Q6: Why gate a mobile rollout on crash-free rate when you can't roll back the binary?**

*Because* you can't roll back. Fix latency on mobile is days (store review + staged rollout + user-must-update). You cannot un-ship the binary in users' hands — the only lever is a *new* version they have to download. So **prevention is the only effective control**: a staged rollout that halts at 1–5% when crash-free-users dips below baseline saves the other 95–99% from a regression you literally cannot fix in time. The gate converts an unfixable-fast problem into a bounded-blast-radius one.

**Q7: Should grouping policy live on the client or the server, and why?**

Prefer the **server**. Client-side `setFingerprint` is compiled into the shipped binary — to change it on mobile you ship a new app and wait days, and it doesn't apply retroactively to existing events. Server-side grouping enhancements (mark frames in/out-of-app, fold recursion, merge exception types) are **editable instantly without a deploy** and apply to past and future events. Reserve client overrides for grouping logic only the client knows (a domain-specific category). Structural grouping belongs where you can change it at the speed of an incident.

**Q8: Your crash-free rate cratered with no real regression; the only change was sampling sessions at 10%. Why?**

Crash-free rate is a **ratio** — `1 − crashes/sessions`. You sampled the *denominator* (sessions, now ÷10) but kept the *numerator* (crashes) at 100%. The ratio's bottom shrank 10× while the top didn't, so `crashes/sessions` inflated ~10× and crash-free rate collapsed — an artifact, not a regression. Fix: sample the health/session beacon and the crashes **identically**, or compute using the SDK's reported drop/outcome counts so the ratio is corrected. A ratio with mismatched sampling on numerator and denominator is meaningless.

---

## Cheat Sheet

```text
╔══════════════════════════════════════════════════════════════════════════════╗
║                CRASH REPORTING — SENIOR CHEAT SHEET                          ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  SIGNAL-HANDLER SAFETY  (the rule everyone breaks)                           ║
║   • async-signal-safe ONLY: write(), _exit(), time()  — NO malloc/printf/lock║
║   • pre-open the fd, pre-allocate the buffer, BEFORE the crash               ║
║   • sigaltstack + SA_ONSTACK  → survive stack-overflow crashes               ║
║   • PREFER Crashpad (out-of-process): dying proc only signals a healthy one  ║
║   • unsafe work in handler = HANG, not crash = worse than nothing            ║
║                                                                              ║
║  CRASH-FREE SLO                                                              ║
║   • metric = crash-free USERS (not sessions) for the SLO                     ║
║   • compare to BASELINE at equal ADOPTION; SEGMENT by os/device/release      ║
║   • bias: next-launch model under-reports crashes that make users quit       ║
║   • ratio: sample numerator (crashes) and denominator (sessions) THE SAME    ║
║                                                                              ║
║  RELEASE HEALTH = SHIP/HALT GATE                                            ║
║   • backend: canary → auto-rollback (minutes)                                ║
║   • mobile: staged rollout → HALT (can't roll back; fix latency = DAYS)      ║
║                                                                              ║
║  FINGERPRINT = CONTRACT                                                      ║
║   • stable across releases/refactors/obfuscation; unique per bug             ║
║   • symbolicate BEFORE grouping; prefer SERVER-SIDE rules (editable)         ║
║   • over-group → hides regressions ; under-group → noise + quota burn        ║
║   • drift → old bugs look "new" every release → regression detector dies     ║
║                                                                              ║
║  SAMPLING & QUOTA                                                            ║
║   • FATAL crashes: 100%, NEVER sample.  Handled: sample per-fingerprint      ║
║   • spike protection + bounded queue → crash loop can't DoS quota            ║
║   • honor 429 / Retry-After → no retry storm                                 ║
║                                                                              ║
║  MOBILE vs BACKEND                                                           ║
║   • backend: orchestrator restarts; OOM=exit137 (uncatchable); fix=minutes   ║
║   • mobile: no recovery; capture NEXT LAUNCH; OOM/ANR via MetricKit/AEI;     ║
║             fix=days → prevention (the gate) matters most                    ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

---

## Summary

- **Crash reporting at senior level is a system you operate, not a library you install.** It has an SLO, a sampling budget, a fingerprint contract, and a ship/halt gate.
- **Signal-handler safety is the rule most people get fatally wrong.** A native crash handler may run with a corrupt heap and dead-thread-held locks; it must be **async-signal-safe** (only `write`/`_exit`/pre-allocated buffers), register `sigaltstack` for stack overflows, and — ideally — run **out-of-process** (Crashpad). Unsafe work turns a crash into a hang: worse than no reporter.
- **Crash-free *users* is an SLO**, compared to a baseline at equal adoption, segmented by OS/device/release. It's structurally optimistic (next-launch bias), and its *ratio* breaks if numerator and denominator are sampled differently.
- **Release health is a ship/halt gate.** Backend: canary + auto-rollback in minutes. Mobile: staged-rollout halt, because you *cannot roll back a binary* and fix latency is days — so prevention is the whole game.
- **Fingerprinting is a long-lived contract.** Symbolicate before grouping, prefer editable server-side rules, and watch for **drift** that re-splits old bugs into fake "new" issues and kills regression detection. Over-grouping hides regressions; under-grouping buries everything in noise.
- **Sample handled exceptions, never fatal crashes** — and sample *per-fingerprint* so the rare fatal bug survives. Spike protection + bounded queue + honoring 429 keep a crash loop from DoS-ing your quota.
- **Mobile and backend are two different problems.** Backend recovers via the orchestrator and infers OOM from exit 137; mobile can't recover, captures on next launch, fuses OS exit-reason APIs for OOM/ANR/watchdog, and lives or dies by the release gate.

---

## What You Can Build

- A **release-health gate**: a job that, per staged-rollout step, pulls crash-free-users for the new release vs the trailing baseline (segmented by OS/device), and **halts the rollout** (mobile) or **triggers rollback** (backend) on breach — adoption-aware so it doesn't fire on tiny denominators.
- A **signal-handler safety test harness**: a small native program that triggers SIGSEGV (heap corruption), stack overflow, SIGABRT, and a crash-during-init, asserting each produces a complete, symbolicated report and *never hangs* — run in CI to catch a reporter regression.
- A **fingerprint-drift detector**: diff the top issues across two releases by their de-obfuscated stack signatures; flag issues that are "new" in the new release but share a signature with an old one (drift) and issues whose event rate jumped within a stable group (hidden regression).
- A **two-tier sampling + spike-protection module**: 100% for fatal, per-fingerprint reservoir + 5% for handled, per-issue rate limit for floods, bounded offline queue, and `Retry-After` backoff — drop into three services.
- An **OOM/ANR fusion job**: on backend, alert on exit-137/`container_oom_events`; on mobile, read MetricKit/`ApplicationExitInfo` on next launch and synthesize crash-reporter events for OOM/ANR/watchdog the SDK couldn't see.
- A **crash-free-rate correctness checker**: assert the session-beacon and crash sampling rates match (or that outcome-count correction is applied), so the ratio can't silently lie.

---

## Further Reading

- **Signal safety & native crashes**
  - `man 7 signal-safety` — the authoritative async-signal-safe function list. Read it before writing any handler.
  - Google Breakpad design docs — in-process minidump capture. <https://chromium.googlesource.com/breakpad/breakpad/>
  - Crashpad design — out-of-process handler, the modern default. <https://chromium.googlesource.com/crashpad/crashpad/>
  - `sentry-native` (Crashpad/Breakpad backends) — <https://docs.sentry.io/platforms/native/>
- **Release health & SLOs**
  - Sentry "Release Health" / "Crash Free Sessions" — <https://docs.sentry.io/product/releases/health/>
  - Firebase Crashlytics "Velocity alerts" and release reporting — <https://firebase.google.com/docs/crashlytics>
  - Google SRE Book, error-budget and SLO chapters — the framing behind crash-free-rate gating.
- **Mobile OS signals**
  - Apple MetricKit (`MXCrashDiagnostic`) — <https://developer.apple.com/documentation/metrickit>
  - Android `ApplicationExitInfo` / `getHistoricalProcessExitReasons` — <https://developer.android.com/reference/android/app/ApplicationExitInfo>
  - Android ANRs and tombstones / `debuggerd`.
- **Sampling & cost**
  - Sentry "Client Reports" / outcomes (knowing what you dropped) and rate limiting.
  - [`../telemetry-cost-and-sampling-strategy/`](../telemetry-cost-and-sampling-strategy/) — the cost dimension in depth.
- **Adjacent**
  - [`../debugging/senior.md`](../debugging/senior.md) — core dumps, thread/goroutine dumps, OOM tooling, the observer effect.
  - [`../panic-and-recovery/`](../panic-and-recovery/) — the language-level half of crash capture.

---

## Related Topics

- **Down a level:** [middle.md](middle.md) — wiring the SDK, grouping/fingerprint overrides, symbol upload, scrubbing.
- **Further down:** [junior.md](junior.md) — global handlers, anatomy of a report, why symbolication exists.
- **Up a level:** [professional.md](professional.md) — operating the pipeline at fleet scale: symbol servers, ingest scaling, retention, cost governance, org-wide regression alerting.
- **Interview prep:** [interview.md](interview.md)
- **Practice:** [tasks.md](tasks.md)

**Sibling diagnostic topics:**

- [Panic and Recovery](../panic-and-recovery/) — the in-runtime side of crash capture; what `recover`/`catch` does and doesn't cover.
- [Error Handling — Senior](../error-handling/senior.md) — typed/wrapped errors that produce cleaner, better-grouped reports.
- [Logging — Senior](../logging/senior.md) — correlation IDs and structured events that feed breadcrumbs and link a crash to its request.
- [Metrics — Senior](../metrics/senior.md) — the SLO/error-budget machinery crash-free rate plugs into.
- [Tracing](../tracing/) — `traceparent` linking a crash to its distributed request.
- [Telemetry Cost and Sampling Strategy](../telemetry-cost-and-sampling-strategy/) — the budget behind crash sampling.
- [Post-Mortem Analysis](../post-mortem-analysis/) — turning a halted release into a write-up and a CI fix.

**Cross-roadmap links:**

- [Clean Code — Error Handling](../../code-craft/clean-code/06-error-handling/README.md) — cleaner errors group better.
- [Refactoring — Tooling & Automation](../../code-craft/refactoring/05-tooling-and-automation/) — the CI-automation mindset symbol upload and the release gate require.

---

## Diagrams & Visual Aids

### The dying-process budget — where each step runs

```text
   DYING PROCESS (signal context)            HEALTHY CONTEXT
   ──────────────────────────────            ───────────────
   ┌────────────────────────────┐            ┌──────────────────────────────┐
   │ SIGSEGV/SIGABRT/SIGBUS...   │            │  next launch (mobile) OR     │
   │            │                │            │  Crashpad handler process    │
   │  ASYNC-SIGNAL-SAFE ONLY:    │            │  (out-of-process)            │
   │   • capture regs (ucontext) │  minidump  │            │                 │
   │   • walk stack → prealloc   │──(file/IPC)│            ▼                 │
   │   • write(fd, buf)          │───────────►│  read dump · enrich ·        │
   │   • _exit()                 │            │  SCRUB · symbolicate ·       │
   │  NO malloc/printf/lock      │            │  upload (retry, 429-aware)   │
   └────────────────────────────┘            └──────────────────────────────┘
       (heap may be corrupt,                     (full runtime, can malloc,
        locks held by dead thread)                can do network)
```

### Release health as a circuit breaker

```text
   deploy ─► 1% ──► measure crash-free-USERS (this cohort, adoption-aware)
                         │
            ┌────────────┴─────────────┐
       within budget of baseline?   below budget?
            │                            │
            ▼                            ▼
     advance 1→5→25→100              HALT / page / (backend) auto-rollback
     (re-measure each step)          (mobile) stop staged rollout — CAN'T un-ship
```

### Fingerprint quality and drift

```text
   STABLE (good)            DRIFT (silent killer)          OVER-GROUPED (hides regressions)
   ────────────            ─────────────────────          ────────────────────────────────
   fp = [camera,           v6.3: fp=[a.b.Scan]            fp = [NPE]   (all null derefs)
         AVCapture,        v6.4: fp=[x.y.Scan]  (new map)        │
         ConfigError]      → same bug, looks "NEW"        new regression folds in →
   1 bug ⇄ 1 issue         → regression detector cries           no "new issue" alert →
   across releases           wolf; real new bug hides            ships to 100% unnoticed
```

### Mobile vs backend crash capture

```text
   BACKEND                                  MOBILE
   ───────                                  ──────
   crash ─► report at death ─► orchestrator crash ─► persist in handler ─► (app dead)
            (real-time)        restarts ~200ms              │
                                                            ▼  NEXT LAUNCH
   OOMKill ─► SIGKILL (UNCATCHABLE)         relaunch ─► read record ─► enrich ─► upload
            ─► infer: exit 137 +            OOM/ANR/watchdog ─► NO signal
               cgroup OOM events                     ─► infer: MetricKit /
   fix latency: MINUTES (redeploy)                      ApplicationExitInfo
                                            fix latency: DAYS (store + user update)
```

---
