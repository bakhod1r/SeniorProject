# ThreadSanitizer (TSan) — Interview Level

> **Roadmap:** [Dynamic Analysis & Sanitizers](../README.md) → ThreadSanitizer (TSan)
> *A TSan interview rarely asks "what is a mutex." It asks "TSan flagged this lock-free queue — real bug or false positive?" and watches whether you can reason about happens-before, defend the near-zero false-positive rate, and explain why a green run is not a proof. This page is the question bank, with model answers and a note on what each question is really probing.*

---

## Table of Contents

1. [How to Use This Page](#how-to-use-this-page)
2. [Prerequisites](#prerequisites)
3. [Fundamentals](#fundamentals)
4. [Mechanism](#mechanism)
5. [Limits & False Positives](#limits--false-positives)
6. [Practice at Scale](#practice-at-scale)
7. [Scenario & Debugging](#scenario--debugging)
8. [Rapid-Fire](#rapid-fire)
9. [Red Flags / Green Flags](#red-flags--green-flags)
10. [Cheat Sheet](#cheat-sheet)
11. [Summary](#summary)
12. [Further Reading](#further-reading)
13. [Related Topics](#related-topics)

---

## How to Use This Page

Each question carries three things: **Q** (the prompt), **what the interviewer is really testing**, and **A** (a model answer at the depth a strong candidate gives). Don't memorize the answers — internalize the *distinctions* they keep returning to:

- **data race vs race condition** (a memory-model violation vs a logic/ordering bug)
- **happens-before vs lockset** (the modern algorithm vs the legacy one, and why the choice dictates the false-positive rate)
- **execution coverage vs static reach** (TSan only sees interleavings that *ran*)
- **synchronization that establishes order vs sync TSan can't see** (mutex/atomic/join vs inline asm, raw `volatile`, syscall-based handoff)

Nearly every question in this bank is one of those four distinctions wearing a costume. The candidates who do well are the ones who *name the distinction* before reaching for a flag.

---

## Prerequisites

You should be comfortable with:

- **Threads and shared memory** — what it means for two threads to touch the same address, and that the OS scheduler can interleave them arbitrarily.
- **Mutexes and atomics** — `lock`/`unlock`, and at least the *idea* of acquire/release ordering even if you can't recite the C++ memory model.
- **The build pipeline** — compile vs link, and that `-fsanitize=thread` is an *instrumenting compile + a runtime library*, not a separate tool you run afterward.
- **The companion tiers:** [junior.md](junior.md) defines the terms gently; [senior.md](senior.md) goes deep on vector clocks, the shadow-memory layout, and CI economics. This page sits between them — it assumes the vocabulary and tests judgment.

---

## Fundamentals

### Q1.1 — Define a data race precisely. What are the exact conditions?

> **Testing:** Whether you have the *precise* definition or a vague "two threads touching memory" hand-wave.

**A.** A **data race** is when **two threads access the same memory location**, **at least one access is a write**, and **there is no happens-before relationship (no synchronization) ordering them**. All three conditions are required. Two concurrent *reads* are not a race — no write, so no one observes inconsistent state. Two writes ordered by a mutex are not a race — the lock establishes happens-before, so they can't actually overlap. The race is specifically the *unsynchronized* write-involved overlap, where the C/C++ (or Go) memory model gives you no guarantee about what value is read or even that the read/write is atomic. The key word people drop is **"no happens-before"** — that's what separates a race from ordinary, correct concurrent access.

### Q1.2 — Why is a data race *undefined behavior* in C/C++, and not just "you might read a stale value"?

> **Testing:** Whether you understand UB is a license for the compiler, not merely a runtime hazard.

**A.** Because the standard says a program with a data race has **undefined behavior** — full stop, not "an unspecified value." That's a license the *compiler* uses. The optimizer assumes race-freedom, so it may keep a shared variable in a register across what you thought was a re-read, fuse or tear a non-atomic store, hoist a load out of a loop, or speculate. A torn 64-bit write on a 32-bit bus can produce a value *neither thread ever wrote*. So the failure isn't "I occasionally see thread B's old value" (that would be merely *racy but bounded*); it's that the program's behavior is no longer derivable from the source at all. That's why "it's just a benign stale read" is wrong in C/C++: UB means the compiler was never obligated to give you the read you imagined.

### Q1.3 — What is ThreadSanitizer and how do you enable it?

> **Testing:** Whether you know it's a compiler instrumentation + runtime, and the actual flags.

**A.** TSan is a **dynamic data-race detector**: the compiler instruments every memory access and synchronization operation, and a runtime library watches the access stream as the program runs, reporting any pair that races. You enable it at **compile *and* link** time:

```bash
# C/C++ (Clang or GCC)
clang -fsanitize=thread -g -O1 race.c -o race
```

```bash
# Go — TSan is built into the toolchain
go test -race ./...
go build -race ./cmd/server
```

It must be on for the link too, because it pulls in the runtime and a relocation/shadow-memory layout the final binary depends on. `-g` is for readable stacks; `-O1` keeps it fast without optimizing away the very accesses you want to see. You then *run* the binary under a realistic workload — TSan only reports races on code paths that actually execute.

### Q1.4 — Read me a TSan report. What's in it and what do you look at first?

> **Testing:** Whether you've actually read one, or only heard they exist.

**A.** A report is built around **two memory accesses to the same location that race**. Annotated:

```
WARNING: ThreadSanitizer: data race (pid=4123)
  Write of size 8 at 0x7b0400000840 by thread T2:        # access #1: what + where + which thread
    #0 increment counter.cc:14
  Previous read of size 8 at 0x7b0400000840 by main thread:  # access #2: the other side of the race
    #0 report counter.cc:21

  Location is global 'g_counter' of size 8 at 0x...840   # WHAT object: global/heap/stack + symbol
  Mutex M5 (0x...) created at:                            # which locks were HELD (or conspicuously not)
    ...
  Thread T2 (tid=4126) created by main thread at:         # provenance of the offending thread
    #0 pthread_create ...
```

I read it in this order: (1) the **two stacks** — the two code sites that collide; (2) the **location** — *which* object (`global 'g_counter'`), because that tells me the shared state; (3) the **threads** and how they were created; (4) the **locks held** — and especially which lock is *missing* on one side. The whole point of the report is that it names *both* sides of the race and the exact object, so I'm not guessing which variable or which two functions are involved.

### Q1.5 — Distinguish a *data race* from a *race condition*. Does TSan find both?

> **Testing:** The single most important conceptual distinction in the topic.

**A.** A **data race** is a *memory-model* fault — unsynchronized, write-involved access to one location (the Q1.1 definition). A **race condition** is a *higher-level correctness* fault: the program's outcome depends on timing/ordering even when every individual access is properly synchronized. Classic example: a **check-then-act / TOCTOU** where `if (map.contains(k))` and `map.insert(k)` are *each* under a lock, but another thread slips between them — no data race (every access synchronized) but a logic bug (an atomicity violation). **TSan finds data races, not race conditions.** It has no idea what your invariant is; it only knows about happens-before on individual locations. So a green TSan run means "no data races on the paths you ran," *not* "your concurrency is correct." Conflating the two is the error that makes people over-trust a clean run.

---

## Mechanism

### Q2.1 — At a high level, how does TSan decide two accesses race? Happens-before or lockset?

> **Testing:** Whether you know the modern algorithm and why it was chosen over the old one.

**A.** Modern TSan is **happens-before** based, implemented with **vector clocks** plus **shadow memory**. The idea: maintain a logical clock per thread; every synchronization operation (lock, unlock, atomic, thread create/join) *transfers* clock information between threads, establishing "this happened before that." For each memory location TSan stores a few **shadow cells** recording recent accesses — which thread, what clock value, read or write. On a new access it checks the shadow cells: if a conflicting access (write involved) is *not* ordered before this one by the vector clocks, that's a race. The older **lockset** algorithm (Eraser) instead tracked "what set of locks was held for each variable" and flagged any variable with an empty common lockset — simpler but it produces **false positives** on perfectly correct lock-free and condition-variable code. Happens-before is more expensive but far more precise, which is why TSan's false-positive rate is near zero.

### Q2.2 — What does it mean for synchronization to "establish happens-before," concretely?

> **Testing:** Whether you can connect specific sync primitives to the ordering they create.

**A.** It means a synchronization operation creates an *ordering edge* TSan can see, so accesses on either side are no longer "concurrent." Concretely:

- **Mutex:** `unlock(m)` *releases*, the matching `lock(m)` *acquires* — everything before the unlock happens-before everything after the lock. So two critical sections on the same mutex are ordered.
- **Atomics:** a release store and the acquire load that reads it create the same edge (`std::memory_order_release` / `acquire`). This is how lock-free handoff is *meant* to be made visible to TSan.
- **Thread join:** everything the joined thread did happens-before the `join()` returns. So writing in a thread then reading after `join` is fine.
- **Go channels:** a send happens-before the corresponding receive completes; closing a channel happens-before a receive that observes the close. That's why idiomatic channel code is race-free *and* TSan-clean.

If two accesses to one location have *no* such edge between them and one is a write — race. The whole job of synchronization is to manufacture these edges.

### Q2.3 — What are vector clocks and shadow cells, in one breath each?

> **Testing:** Whether the mechanism is real to you or just buzzwords.

**A.** A **vector clock** is a per-thread array of logical timestamps — thread *i* holds its own counter plus the latest counter it has "learned" from every other thread via synchronization. Comparing two vector clocks tells you whether one event happens-before another or whether they're concurrent (incomparable). **Shadow cells** are TSan's per-address bookkeeping: for each application word, the runtime keeps a small fixed number of slots (typically 4) recording the most recent accesses — thread id, clock, size, is-write. On each access TSan compares the incoming access against those slots using the vector clocks. Together: vector clocks answer "is there an order?", shadow cells answer "between which recent accesses do I need to check?". That's the entire detector in two data structures.

### Q2.4 — TSan is roughly 5–15× slower and uses far more memory. Where does the cost come from?

> **Testing:** Whether you understand the cost is intrinsic to the approach, not an implementation wart.

**A.** Two sources. **CPU (~5–15×):** every memory access becomes a call into the runtime that updates and checks shadow cells, and every sync op updates vector clocks — you've turned a single `mov` into a load, a few comparisons, and a shadow store. **Memory (often ~5–10× RSS):** the shadow region maps multiple bytes of metadata per application byte, so the address space and resident set balloon; TSan also reserves large fixed virtual mappings. The cost is **intrinsic**: precise happens-before requires observing *every* access and *every* sync edge — you can't get near-zero false positives by sampling. That's also why TSan is a **CI / pre-merge / nightly** tool, not something you ship to production, and why you size race-lane runners with extra RAM.

### Q2.5 — Why does TSan have near-zero *false positives* but real *false negatives*? Which is the dangerous one?

> **Testing:** The defining accuracy property — and whether you know which way the error bias cuts.

**A.** **Near-zero false positives** because it's grounded in the actual happens-before relation of the *real* execution: if TSan says two accesses raced, it observed an unsynchronized write-involved overlap on a run that genuinely happened — that's a true fact about your program, not a heuristic guess. **Real false negatives** because it's a *dynamic* tool: it can only report races on interleavings that **executed**. A race that needs a 1-in-100,000 scheduling window, or a code path your test never reached, simply isn't observed. The **false negative is the dangerous one**: a *report* is almost always a real bug worth fixing, but a *clean run* is not a proof of race-freedom — it's "no race seen on the paths and interleavings I happened to exercise." Treating green as proof is the classic over-trust mistake.

---

## Limits & False Positives

### Q3.1 — "It passed the race detector, so it's race-free." What's wrong with that?

> **Testing:** Whether you internalize coverage-dependence — the most important practical limit.

**A.** TSan only sees the **interleavings that actually ran**. A clean run means "no data race on the code paths I exercised, on the schedules the OS happened to pick." It is **not** a proof of race-freedom. Two gaps: (1) **path coverage** — a race on an error path or rarely-taken branch your tests never hit is invisible; (2) **interleaving coverage** — a race that only manifests on a narrow scheduling window may not occur in the runs you did. This is why race testing needs *help*: high test **coverage**, **stress** (many threads, contention), **repetition** (`go test -race -count=100`, `-runs` under stress), and sometimes scheduling perturbation. The detector is exact about what it sees; the engineering problem is *making the race execute so TSan can see it*.

### Q3.2 — What kinds of bugs does TSan *miss*, even on code that runs?

> **Testing:** Whether you know the boundaries of the happens-before model itself.

**A.** Several real classes:

- **Rare interleavings** — the race exists but the scheduling window didn't occur during the run (the coverage limit above).
- **Relaxed-atomic ordering bugs** — TSan tracks happens-before, but a logic bug from using `memory_order_relaxed` where you needed `acquire`/`release` is *not* a data race (the access is atomic), so TSan won't flag the missing ordering even though your algorithm is wrong.
- **Higher-level race conditions / atomicity violations** — check-then-act, lost updates where each step is individually synchronized (Q1.5).
- **Synchronization TSan can't see** — handoff via raw inline assembly, direct syscalls, custom kernel primitives, or memory-mapped device registers; TSan doesn't know those created an order, which causes the *opposite* problem (false positives, Q3.3).
- **Deadlocks** — a different fault entirely; TSan's deadlock detector is separate and limited.

The unifying point: TSan models *data races under happens-before*. Bugs outside that model — ordering, atomicity, liveness — are out of scope.

### Q3.3 — When does TSan produce a *false positive*, and what's the right response?

> **Testing:** Whether you know the narrow real causes — and resist annotating away real bugs.

**A.** Genuine false positives are **rare** and almost always come from **synchronization TSan cannot observe**: you hand-rolled a handoff via inline assembly, a custom atomic in raw asm, a direct `futex` syscall, a signal-based or kernel-bypass mechanism, or you're interoperating with a library compiled *without* TSan whose internal sync is invisible. TSan sees the two accesses, sees no happens-before edge it understands, and reports a race that is actually ordered by a mechanism it can't see. The right response, in order: (1) **prove** it's truly synchronized — most "false positives" are real races the engineer doesn't believe; (2) if genuinely invisible sync, use an **annotation** (`__tsan_acquire`/`__tsan_release`, or `ANNOTATE_HAPPENS_BEFORE/AFTER`) to *teach* TSan the edge; (3) only as a last resort, a **suppression** to silence a known third-party issue. Reaching for a suppression *first* is how you hide a real bug.

### Q3.4 — A colleague says "that race is benign, it's just a stats counter." How do you respond?

> **Testing:** Whether you know "benign race" is almost always a myth in C/C++.

**A.** I push back hard. In C/C++ a data race is **undefined behavior**, so "benign" is usually wishful thinking: the optimizer is free to tear the store, fuse loads, hoist the access out of a loop, or reorder it in ways that corrupt *more* than the counter — the damage isn't bounded to "off-by-a-few." Even the famous "it's just a counter" case can lose updates *and* trip UB-based miscompilation. The correct fix costs almost nothing: make it a `std::atomic<int64_t>` with `memory_order_relaxed` (which is genuinely fine for a pure counter and is *not* a data race, so TSan goes quiet for the right reason). In Go, the race detector and memory model are equally unforgiving. So my answer is: "benign race" almost always means "a race I haven't been bitten by *yet*"; replace it with a relaxed atomic and the UB — and the report — both disappear.

### Q3.5 — Can you run TSan together with ASan or MSan?

> **Testing:** A concrete operational limit people trip over in CI design.

**A.** **No** — you **cannot combine TSan with ASan or MSan in the same binary.** They each own incompatible shadow-memory layouts and intercept the same runtime hooks, so the runtimes conflict; the build/link will reject the combination. (UBSan is the exception — it composes with the others.) The practical consequence is that race detection is its **own CI lane** with its own build: one job builds `-fsanitize=address`, a separate job builds `-fsanitize=thread`. People who assume "I'll just turn on all the sanitizers at once" hit this immediately. The right mental model is a *matrix* of sanitizer builds, with TSan as a first-class, separate column.

---

## Practice at Scale

### Q4.1 — How do you run TSan in CI without wrecking pipeline time?

> **Testing:** Whether you can operationalize a 5–15× slower tool.

**A.** Treat it as a **dedicated lane**, not part of the default build:

- **Separate job** building `-fsanitize=thread` (it can't share with ASan/MSan), on runners with **extra RAM** for the shadow region.
- **Where it runs:** the concurrency-heavy unit/integration tests — race detection is wasted on single-threaded suites. Run the high-value subset **per-PR** and the full suite **nightly** if the time is too large for every push.
- **Repetition & stress:** `go test -race -count=N`, or loop the C++ tests under contention, because a single pass under-samples interleavings.
- **Fail loud:** set `TSAN_OPTIONS="halt_on_error=1 exitcode=66"` (or `GORACE="halt_on_error=1"`) so a race **fails the build** instead of scrolling past in logs — a race report that doesn't break the pipeline will be ignored.
- **Artifacts:** upload the full report (both stacks) so the failure is debuggable from the CI page.

The throughline: race detection only pays off if reports are *acted on*, which means making them break the build and land in front of the author.

### Q4.2 — A race is real but only fires 1 run in 500. How do you make it reproduce reliably?

> **Testing:** The core skill of turning a flaky race into a deterministic repro.

**A.** TSan can only catch what executes, so I **increase the chances the bad interleaving happens** and **run many times**:

1. **Repeat aggressively** — `go test -race -count=1000 -run TheTest`, or a shell loop around the C++ test, until it trips.
2. **Add contention/parallelism** — `-cpu=1,2,4,8`, `GOMAXPROCS`/extra worker threads, so the scheduler has more reasons to interleave.
3. **Perturb the schedule** — insert randomized tiny delays or yields at suspected points, or use a stress harness; the goal is to widen the race window.
4. **Shrink the workload** to the suspect path so each iteration is fast and you can do thousands of runs.
5. Once TSan catches it **even once**, that report is gold — it names both sides and the object, so I don't need it to reproduce again to *fix* it.

The mindset is the inverse of normal debugging: I'm not reducing nondeterminism to a single path, I'm *amplifying* it until the rare interleaving surfaces under the detector.

### Q4.3 — Annotation vs suppression vs fix — when is each the right move?

> **Testing:** Whether you keep the moral hierarchy straight (fix ≫ annotate ≫ suppress).

**A.**

- **Fix** is the default and almost always correct: add the missing synchronization (mutex, atomic with the right ordering, channel), or remove the sharing. A TSan report is normally a real bug.
- **Annotation** is for when the code is *genuinely* synchronized by a mechanism TSan can't see (custom asm/syscall handoff, or a deliberately lock-free structure you've proven correct): you *teach* TSan the happens-before edge with `__tsan_acquire`/`__tsan_release` or `ANNOTATE_HAPPENS_BEFORE/AFTER`, so it correctly understands the order rather than going silent. This makes TSan *more* accurate.
- **Suppression** (`TSAN_OPTIONS=suppressions=...`) is the **last resort** — silencing a *known* report you can't fix right now, almost always in **third-party code** compiled without TSan. It hides the report without fixing or explaining the bug, so it must be narrow, commented with a ticket, and reviewed.

The hierarchy matters because each step down trades *correctness* for *quiet*. Suppressing first — to make CI green — is exactly how a real race ships.

### Q4.4 — Why does Go ship `-race` in the standard toolchain, and what cultural effect does that have?

> **Testing:** Whether you appreciate that making the tool frictionless changes behavior.

**A.** Go bundles TSan as `go test -race` / `go build -race` — no extra dependency, no separate runtime to install, one flag. Because the bar to use it is essentially zero, race detection became **part of normal Go testing culture**: teams routinely run `go test -race ./...` in CI by default, and "did you run it with `-race`?" is a standard review question. The effect is that whole classes of concurrency bugs get caught *before merge* as a matter of habit, not as a special audit. The general lesson for any language: a correctness tool's real-world impact is dominated by its **friction** — Go's decision to make `-race` first-class is why its ecosystem has unusually good race hygiene. (The same logic argues for wiring TSan into your C++ build presets so it's one `cmake` flag, not a research project.)

---

## Scenario & Debugging

### Q5.1 — You're handed a TSan report. Walk me through finding the missing synchronization.

> **Testing:** Calm, structured triage instead of staring at the stacks.

**A.** The report already does most of the work — it names **both** accesses and the **object**:

1. **Identify the shared object** from the `Location is ...` line (global/heap/stack + symbol). That's the state two threads disagree about.
2. **Read both stacks** — the two code sites touching it. Confirm at least one is a **write** (the report says `Write`/`Read` and size).
3. **Ask what edge *should* order them** — is there a mutex that one side takes and the other doesn't? An atomic that should be acquire/release but is plain? A value passed by channel/`join` on one path but read directly on another?
4. **Find the gap** — the common failure is one critical section guards the access and a second code path touches the same field *without* the lock (or a lock-free fast path forgot a release). The "Mutex M held by" lines show which locks were active on each side; the *missing* one is usually the bug.
5. **Fix by establishing happens-before** — guard both sides with the *same* mutex, or convert to a properly-ordered atomic, then re-run under repetition to confirm the report is gone for the right reason.

The discipline: let the report tell you *which object* and *which two sites*, then reason about the *edge that should exist between them* — don't go hunting variables blind.

### Q5.2 — A service is clean under TSan in CI but a race only appears under production load. Reconcile that.

> **Testing:** The coverage/interleaving limit applied to a real incident.

**A.** No contradiction — CI **under-sampled the interleavings**. Production has more cores, higher concurrency, real contention, and far more runs, so it hits the narrow scheduling window CI never did; and prod may exercise code paths (error handling, backpressure, specific request mixes) the test suite skipped. TSan didn't "miss" a race it saw — the racing *interleaving never executed* under test. The fix is to make the rare interleaving reproducible **under the detector**: reproduce the production workload in a race-enabled load test, crank parallelism and `-count`, add scheduling perturbation, and target the hot path. Once TSan catches it once, it's a normal fix. The lesson restated: a green race lane bounds risk on *exercised* schedules; matching production concurrency in the test is what closes the gap.

### Q5.3 — TSan flagged a hand-rolled lock-free ring buffer. Real bug or false positive? How do you decide?

> **Testing:** Whether you investigate rather than reflexively crying "false positive."

**A.** **Default assumption: it's a real bug** — hand-rolled lock-free code is exactly where missing or wrong-ordered atomics hide, and TSan's false-positive rate is near zero. To decide, I'd: (1) check the atomics on the head/tail indices — are they `std::atomic` with **acquire on the consumer load and release on the producer store**, or did someone use plain variables / `relaxed` where a release is needed? A *plain* index access is a genuine race; a *relaxed* one may be an ordering bug TSan can't see but is still wrong. (2) Confirm whether the "synchronization" is something TSan genuinely *can't* observe (raw asm, a fence pattern via a mechanism it doesn't model) — only then is a false positive plausible. (3) If — and only if — I can *prove* the structure is correctly ordered by invisible-to-TSan means, I add `__tsan_acquire`/`__tsan_release` annotations to teach it the edge, not a blanket suppression. Nine times out of ten, "TSan is wrong about my lock-free code" turns out to be "my lock-free code is wrong."

### Q5.4 — Distinguish, with examples, a data race from an atomicity violation — and which tool catches which.

> **Testing:** Depth on Q1.5 — whether you can produce concrete code-level examples.

**A.**

- **Data race:** two threads do `g_count++` on a *non-atomic* int with no lock. Unsynchronized, write-involved, same location → TSan reports it. Fix: atomic or mutex.
- **Atomicity violation (a race *condition*, no data race):** every access is synchronized, but a multi-step operation isn't atomic *as a unit*:

  ```cpp
  if (!cache.contains(key))   // step 1, under lock, releases lock
      cache.insert(key, compute(key));  // step 2, re-takes lock
  // two threads both see "absent" and both insert/compute → lost work or duplicate
  ```

  Each `contains`/`insert` is individually locked, so **no data race** — TSan stays silent. But the *check-then-act* isn't atomic, so the outcome depends on timing: a race **condition**. The fix is to hold the lock across *both* steps (or use an atomic `insert-if-absent`).

So: **TSan catches the first, not the second.** The second needs different tools — careful design, invariants, sometimes stress tests asserting the higher-level property, or model checking. Knowing TSan's silence here is *expected* (not reassuring) is the whole point.

### Q5.5 — Under TSan a test deadlocks or behaves differently than normal. What's going on?

> **Testing:** Whether you understand instrumentation changes timing and that some bugs only show *because* of it.

**A.** Two things can be happening. First, **TSan changes timing** — every access and sync op is heavier, so the schedule shifts; that can *expose* a latent race or even a deadlock that was timing-hidden in the uninstrumented build. That's a **feature**: the bug was always there. Second, the program may rely on **synchronization TSan models with extra serialization or can't see**, or use a thread/`fork` pattern, signal handling, or `LD_PRELOAD`/interceptor interaction that the runtime perturbs. The triage: don't dismiss it as "TSan being weird" — first assume it surfaced a real timing-dependent bug and investigate the deadlock/order with the report and `TSAN_OPTIONS=second_deadlock_stack=1`. Only after ruling out a genuine fault do you consider an instrumentation interaction (e.g., known issues with certain `fork`-without-`exec` or signal patterns), and reach for annotations/suppressions. The instinct that separates strong candidates: *instrumentation changing behavior usually means the behavior was never well-defined.*

---

## Rapid-Fire

> Short questions to check breadth. One or two sentences each.

- **Q: The three conditions for a data race?** A: Same location, ≥1 write, no happens-before between the accesses.
- **Q: Data race vs race condition?** A: Memory-model fault on one location vs higher-level timing/ordering bug; TSan finds the first, not the second.
- **Q: Flag to enable TSan in C/C++?** A: `-fsanitize=thread` (at compile *and* link), with `-g -O1`.
- **Q: Flag in Go?** A: `-race` (`go test -race`, `go build -race`).
- **Q: Lockset or happens-before?** A: Modern TSan is happens-before (vector clocks + shadow memory); lockset (Eraser) is the older, more false-positive-prone approach.
- **Q: Why near-zero false positives?** A: It reports only races it actually observed via real happens-before on a real run.
- **Q: The dangerous error class?** A: False negatives — a clean run isn't proof; it only saw the interleavings that executed.
- **Q: Typical slowdown?** A: ~5–15× CPU, plus large memory overhead from shadow cells.
- **Q: Combine TSan with ASan?** A: No — incompatible shadow layouts; separate CI lanes. (UBSan composes.)
- **Q: Does a mutex unlock/lock establish happens-before?** A: Yes — unlock releases, the matching lock acquires; that orders the two critical sections.
- **Q: Do Go channels establish order?** A: Yes — a send happens-before the corresponding receive; close happens-before a receive that sees it.
- **Q: Is two concurrent reads a race?** A: No — no write, so no race.
- **Q: Is a "benign" counter race fine in C/C++?** A: No — it's UB; use a `relaxed` atomic instead.
- **Q: Fix, annotate, or suppress — default?** A: Fix. Annotate only for sync TSan can't see; suppress only for unfixable third-party reports.
- **Q: How to surface a 1-in-500 race?** A: `-count=N`/loop, raise parallelism, perturb the schedule until it executes under TSan.

---

## Red Flags / Green Flags

> What interviewers infer from *how* you answer, not just whether you're right.

**Red flags:**
- Defining a data race as "two threads touching memory" — dropping the *write* and *no-happens-before* conditions.
- Treating a clean TSan run as proof of race-freedom — missing the coverage/interleaving limit.
- Conflating a data race with a race condition, or expecting TSan to catch check-then-act.
- Calling a flagged lock-free structure a "false positive" reflexively instead of investigating.
- Defending a "benign race" in C/C++ without acknowledging it's UB.
- Reaching for a *suppression* first to make CI green.
- Assuming you can run TSan + ASan in one binary.

**Green flags:**
- Naming the *distinction* (data race vs race condition, happens-before vs lockset) before reaching for a flag.
- Saying "a report is a real bug; a clean run is not a proof" unprompted.
- Explaining the false-positive/false-negative asymmetry and *why* it falls that way.
- Connecting specific primitives (mutex unlock/lock, release/acquire atomics, `join`, channels) to the happens-before edge they create.
- Knowing TSan is its own CI lane (incompatible with ASan/MSan) and sizing for memory.
- Treating "make the rare interleaving execute" as the real engineering problem, with `-count`/stress/perturbation.
- Keeping the fix ≫ annotate ≫ suppress hierarchy straight, and using annotations to *teach* TSan rather than silence it.

---

## Cheat Sheet

| Item | Answer |
|---|---|
| **Data race** | Same location · ≥1 write · no happens-before |
| **Race condition** | Outcome depends on timing/ordering despite synchronized accesses (TSan won't catch) |
| **Enable (C/C++)** | `clang -fsanitize=thread -g -O1` (compile **and** link) |
| **Enable (Go)** | `go test -race` / `go build -race` |
| **Algorithm** | Happens-before via vector clocks + shadow cells (not lockset) |
| **Establishes HB** | mutex unlock→lock · release→acquire atomic · thread `join` · channel send→recv |
| **Cost** | ~5–15× CPU; large memory (shadow region) |
| **Accuracy** | ~zero false positives; real false negatives (only sees executed interleavings) |
| **Compatibility** | Cannot combine with ASan/MSan (separate lanes); UBSan composes |
| **Fail CI on race** | `TSAN_OPTIONS="halt_on_error=1 exitcode=66"` / `GORACE="halt_on_error=1"` |
| **Reproduce rare race** | `-count=N`/loop · more parallelism · perturb schedule |
| **Response priority** | **Fix** ≫ **annotate** (sync TSan can't see) ≫ **suppress** (third-party only) |
| **Annotations** | `__tsan_acquire`/`__tsan_release`, `ANNOTATE_HAPPENS_BEFORE/AFTER` |
| **"Benign race"?** | In C/C++ it's UB — use a `relaxed` atomic instead |

---

## Summary

- The bank reduces to four distinctions in costumes: **data race vs race condition**, **happens-before vs lockset**, **execution coverage vs static reach**, and **sync that establishes order vs sync TSan can't see**. Name the distinction first; the flag follows.
- **A data race** is *same location · ≥1 write · no happens-before* — and in C/C++ it's **undefined behavior**, a license the optimizer uses, not merely a stale read. That's why "benign race" is almost always wrong; replace it with a relaxed atomic.
- **Mechanism:** modern TSan is **happens-before** via **vector clocks + shadow cells**; synchronization (mutex unlock/lock, release/acquire atomics, `join`, channels) creates the ordering edges it relies on. The ~5–15× CPU and large memory cost is intrinsic to observing every access and edge.
- **Accuracy is asymmetric:** **near-zero false positives** (it reports only real, observed races) but **real false negatives** (it only sees interleavings that executed). So *a report is a real bug; a clean run is not a proof* — the false negative is the dangerous one.
- **Limits:** it misses rare interleavings, relaxed-atomic ordering bugs, and higher-level race conditions/atomicity violations; genuine false positives are rare and come from sync it can't see — fix first, **annotate** to teach it the edge, **suppress** only third-party reports.
- **Practice & debugging:** TSan is its own CI lane (can't combine with ASan/MSan), made to fail the build; the core skills are *making a rare race execute* (`-count`/stress/perturbation) and *reading a report* (both stacks → object → the missing lock). Go's first-class `-race` shows that low friction is what turns a detector into a culture.

---

## Further Reading

- [Clang ThreadSanitizer manual](https://clang.llvm.org/docs/ThreadSanitizer.html) — flags, runtime options, and the supported synchronization model. Primary source.
- [The Go Blog — "Introducing the Go Race Detector"](https://go.dev/blog/race-detector) — why `-race` is first-class and how to use it in practice.
- [Go Memory Model](https://go.dev/ref/mem) — the happens-before rules (channels, mutexes, `sync`) that make Go code race-free *and* TSan-clean.
- *"ThreadSanitizer — data race detection in practice"* (Serebryany & Iskhodzhanov, WBIA '09) — the foundational paper on the shadow-memory + happens-before design.
- The [junior.md](junior.md) and [senior.md](senior.md) pages of this topic — junior defines the terms gently; senior goes deep on vector clocks, the shadow layout, annotations, and CI economics. Every answer here is grounded in those.
- `man` and `TSAN_OPTIONS` / `GORACE` reference — the runtime knobs (`halt_on_error`, `history_size`, `second_deadlock_stack`) the answers reference.

---

## Related Topics

- [01 — AddressSanitizer](../01-address-sanitizer-asan/interview.md) — the memory-error sibling; shares the "instrument-and-run" model and the can't-combine-with-TSan constraint.
- [03 — UndefinedBehaviorSanitizer](../03-undefined-behavior-sanitizer-ubsan/interview.md) — the one sanitizer that *composes* with TSan, and the home of the UB that makes "benign races" dangerous.
- [05 — Coverage-Guided Dynamic Analysis](../05-coverage-guided-dynamic-analysis/interview.md) — how coverage and fuzzing drive the executions TSan needs to *see* a rare race.
- [06 — Runtime Assertions & Contracts](../06-runtime-assertion-and-contract-checking/interview.md) — catching the higher-level race conditions / atomicity violations TSan is silent on.
- [Language Internals → Concurrency](../../../language-internals/concurrency-async-parallel/concurrency/) — the memory model and happens-before foundations the whole topic stands on.
