# ThreadSanitizer (TSan) — Middle Level

> **Roadmap:** [Dynamic Analysis & Sanitizers](../README.md) → ThreadSanitizer (TSan)
> *The junior page told you TSan finds data races. This page tells you what a data race* is *— formally, as a missing edge in the happens-before relation — and how TSan builds vector clocks and shadow memory to detect that missing edge at runtime, whether or not the race ever produced a wrong answer.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The Happens-Before Relation](#core-concept-1--the-happens-before-relation)
5. [Core Concept 2 — A Data Race, Formally](#core-concept-2--a-data-race-formally)
6. [Core Concept 3 — How TSan Works: Shadow Memory & Vector Clocks](#core-concept-3--how-tsan-works-shadow-memory--vector-clocks)
7. [Core Concept 4 — Reading a TSan Report](#core-concept-4--reading-a-tsan-report)
8. [Core Concept 5 — Flags, Options & Escape Hatches](#core-concept-5--flags-options--escape-hatches)
9. [Core Concept 6 — The Critical Limitation: TSan Is Dynamic](#core-concept-6--the-critical-limitation-tsan-is-dynamic)
10. [Core Concept 7 — TSan in CI](#core-concept-7--tsan-in-ci)
11. [Real-World Examples](#real-world-examples)
12. [Mental Models](#mental-models)
13. [Common Mistakes](#common-mistakes)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [Further Reading](#further-reading)
18. [Related Topics](#related-topics)

---

## Introduction

> Focus: **What is a data race precisely, and how does a tool prove one exists at runtime?**

At the junior level, a data race is "two threads touch the same variable and at least one writes, with no lock." That working definition is correct enough to write a fix, but it can't answer the questions a middle engineer actually hits: *why* does a mutex prevent a race but a `volatile` doesn't? *Why* does TSan flag a field nobody locked even though the program "obviously works"? *Why* does it sometimes stay silent on a known-buggy program?

The answers all come from one formal object — the **happens-before relation** — and one runtime mechanism — **vector clocks over shadow memory**. This page makes both concrete. A data race stops being "looks racy" and becomes a precise, checkable property: *two conflicting accesses not ordered by happens-before*. TSan is the machine that checks it. Once you can read a TSan report field by field and reason about what it did and did **not** observe, races stop being mystical and become a debugging problem with a known procedure.

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) and can describe what a data race is informally.
- **Required:** You've written multithreaded code with mutexes, or Go code with goroutines and channels.
- **Helpful:** You've been bitten by a "works on my machine, flaky in CI" concurrency bug.
- **Helpful:** A rough sense of memory ordering (acquire/release) — we define what we need.

---

## Glossary

| Term | Meaning |
|---|---|
| **Conflicting accesses** | Two memory accesses to the *same* location where at least one is a *write*. |
| **Happens-before (→)** | A partial order over events; if `a → b`, every effect of `a` is visible to `b`. |
| **Synchronizes-with** | The edge a paired sync operation (unlock→lock, send→recv) contributes to happens-before. |
| **Vector clock** | A per-thread array of logical timestamps that encodes the happens-before order. |
| **Shadow memory** | TSan's parallel store recording recent accesses (thread, clock, size, R/W) per location. |
| **Race** | Two conflicting accesses *not* ordered by happens-before — concurrent under the clocks. |
| **Suppression** | A rule telling TSan to ignore a known/un-fixable report by function or file. |
| **Instrumentation** | Compiler-inserted hooks around every memory access and sync op, calling the TSan runtime. |

---

## Core Concept 1 — The Happens-Before Relation

Concurrency has no global clock — two threads on two cores have no shared "now." So we can't order all events by wall time. Instead, Leslie Lamport's **happens-before** relation (1978) defines a *partial* order using only causality:

1. **Program order:** within a single thread, if `a` appears before `b`, then `a → b`.
2. **Synchronization order:** certain *paired* operations across threads create a cross-thread edge — this is the **synchronizes-with** relation. The release side happens-before the acquire side.
3. **Transitivity:** if `a → b` and `b → c`, then `a → c`.

Two events are **concurrent** when *neither* `a → b` nor `b → a`. That word — concurrent — is the whole game: concurrent conflicting accesses are exactly what a data race is.

The synchronization edges that establish happens-before are a finite, known list:

| Synchronization | Edge created (release side → acquire side) |
|---|---|
| Mutex `unlock` → later `lock` | the unlock happens-before the matching lock |
| Thread `create` → first stmt of new thread | parent's create happens-before child's start |
| Thread's last stmt → `join` returns | child's work happens-before the joiner's continuation |
| Atomic store-**release** → load-**acquire** (same var) | the store happens-before the load that reads it |
| Channel `send` → `receive` (Go) | the send happens-before the receive |
| `WaitGroup.Done()` → `Wait()` returns (Go) | the Done happens-before Wait's return |

```go
// A correct ordering: the channel send → receive edge makes the write visible.
data := 0
done := make(chan struct{})
go func() {
    data = 42          // write
    done <- struct{}{} // SEND establishes happens-before
}()
<-done                 // RECEIVE — acquires the edge
fmt.Println(data)      // read is ORDERED after the write → no race
```

> **Key insight:** A mutex doesn't prevent a race by "blocking." It prevents it by creating a happens-before *edge* (unlock→lock) that orders the accesses. Anything that creates such an edge prevents the race; anything that doesn't (a bare `volatile`, a "this is fast enough" assumption, a `time.Sleep`) does not — even if the program *happens* to work. This is why the fix for a race is always "add the right synchronization edge," never "add a delay."

---

## Core Concept 2 — A Data Race, Formally

Now the definition that the rest of this page rests on:

> A **data race** is two **conflicting** accesses (same location, at least one a write) that are **not ordered by happens-before** — i.e., they are *concurrent*.

Unpack each clause, because each one rules out a non-race:

- **Same location.** Two threads writing *different* variables never race (modulo false sharing, which is a performance issue, not a correctness one).
- **At least one write.** Two concurrent *reads* are fine — neither changes what the other sees. This is why read-mostly data needs synchronization only when a writer appears.
- **Not ordered by happens-before.** If a synchronization edge orders the two accesses, there is no race *by definition*, even if both touch the same location and one writes. The lock did its job.

```go
// RACE: two conflicting accesses, no happens-before edge between them.
var counter int
var wg sync.WaitGroup
for i := 0; i < 2; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        counter++ // read-modify-write; concurrent with the other goroutine's
    }()
}
wg.Wait()
// counter++ is a write AND a read; two goroutines, no ordering between
// their accesses → data race. The Wait() edge is too LATE to order them.
```

The `wg.Wait()` does create a happens-before edge — but from each `Done()` to the `Wait()`, *after* both increments. It orders the goroutines relative to `main`, not relative to *each other*. That gap is the race.

> **Key insight:** "It produces the right answer" and "it has no data race" are independent properties. A racy increment often yields the correct total — until the one scheduling where two read-modify-writes interleave and a count is lost. The race is a property of the *program's possible executions*, not of the output you happened to observe. TSan checks the property; tests check the output. That's why TSan finds bugs your tests pass over.

---

## Core Concept 3 — How TSan Works: Shadow Memory & Vector Clocks

TSan is a **compile-time instrumentation + runtime library** pair. The compiler rewrites your program so that *every* memory access and *every* synchronization operation calls into the TSan runtime. The runtime then maintains two data structures.

**1. Vector clocks (one per thread).** A vector clock is an array indexed by thread id; entry `i` is "the latest logical time of thread `i` that this thread knows about." Each thread bumps its own entry on activity. At a synchronization event, clocks are merged: a lock *acquires* the unlocker's clock (entry-wise max), so the locker now "knows about" everything the unlocker did. Comparing two clocks answers the ordering question exactly: clock `A` happens-before clock `B` iff every entry of `A` ≤ the corresponding entry of `B`. If neither dominates, the events are **concurrent**.

**2. Shadow memory (per application location).** For every region of application memory, TSan keeps a few **shadow cells** recording the most recent accesses. Each shadow cell packs:

- the **thread id** that made the access,
- a **vector-clock timestamp** (a scalar epoch from that thread's clock),
- the **access size** (1/2/4/8 bytes — to catch overlapping accesses of different widths),
- the **type**: read or write.

On *every* instrumented access, TSan compares the new access against the stored shadow cells for that location:

```
for each shadow cell S already recorded at this location:
    if S and the new access CONFLICT (same bytes, ≥1 write)
       and S's timestamp is NOT happens-before the current thread's clock:
            → the two accesses are CONCURRENT → REPORT A RACE
    otherwise: evict/replace a shadow cell with the new access
```

That is the whole detector: instrument accesses, keep a small window of recent accesses per location, and on each access ask the vector clocks "is the previous access ordered before me?" If the answer is *no*, the two are concurrent and conflicting — a race, reported with both stacks.

```
shadow cell (conceptual layout):
  [ thread id | clock epoch | size | is_write ]
```

> **Key insight:** TSan does not guess and it does not pattern-match on "missing lock." It computes the *actual* happens-before order of the run from real synchronization events and checks the formal definition directly. A report means: *on this execution, these two specific accesses were genuinely unordered.* That is why TSan has near-zero false positives — and why, when it does false-positive, it's always because a real synchronization edge existed that TSan couldn't see (Concept 6).

The bounded shadow-cell window (default tracks the most recent accesses) is why TSan's memory cost is finite, and why `history_size` (Concept 5) trades memory for how far back the *call stacks* of those accesses are remembered.

---

## Core Concept 4 — Reading a TSan Report

A report is not noise — it is a structured proof of concurrency with every field you need to fix the bug. Here is a real Go `-race` report for the `counter++` program above:

```
==================
WARNING: DATA RACE
Read at 0x00c0000b4008 by goroutine 8:
  main.main.func1()
      /home/me/race.go:14 +0x3c          ← the READ half of counter++

Previous write at 0x00c0000b4008 by goroutine 7:
  main.main.func1()
      /home/me/race.go:14 +0x56          ← the WRITE half, other goroutine

Goroutine 8 (running) created at:
  main.main()
      /home/me/race.go:12 +0x84          ← WHERE goroutine 8 was spawned

Goroutine 7 (finished) created at:
  main.main()
      /home/me/race.go:12 +0x84          ← WHERE goroutine 7 was spawned
==================
Found 1 data race(s)
exit status 66
```

Read it field by field:

| Field | What it tells you |
|---|---|
| **Read/Write at 0x…** | the *address* of the contended location (heap here; could be a global or a struct field+offset). |
| **by goroutine N** | which goroutine made *this* access, and the **stack** showing the exact line. |
| **Previous write/read** | the *other* conflicting access — the two together are the race. At least one is a write. |
| **goroutine N created at** | where each goroutine was *spawned* — usually the real clue to *why* they overlap. |
| **(running) / (finished)** | the goroutine's state when the race was detected. |

The C/C++ TSan report carries the same shape plus the **locks held** by each thread — invaluable for lock-ordering and "you locked the wrong mutex" bugs:

```
WARNING: ThreadSanitizer: data race (pid=4123)
  Write of size 4 at 0x55a... by thread T2:
    #0 increment() counter.cc:9 (a.out+0x...)
    #1 worker(void*) counter.cc:15

  Previous read of size 4 at 0x55a... by main thread:
    #0 main counter.cc:23 (a.out+0x...)

  Location is global 'g_counter' of size 4 at 0x55a... (a.out+0x...)
                                  ↑ global/heap+offset/stack — names the variable

  Mutex M11 (0x55a...) created at:           ← locks held by each side:
    #0 pthread_mutex_init
  Thread T2 (tid=4126) created by main thread at:
    #0 pthread_create
SUMMARY: ThreadSanitizer: data race counter.cc:9 in increment()
```

> **Key insight:** The two stacks are the two halves of the race; the "created at" frames are *why* the threads coexist; and (in C/C++) the "Location is …" and "Mutex … held" lines tell you which variable and whether the two sides locked *the same* mutex. A race where both sides hold a lock means they hold **different** locks — a classic bug the report hands you for free. Read every field before you start editing; the answer is usually already on screen.

---

## Core Concept 5 — Flags, Options & Escape Hatches

**C/C++ — build with the sanitizer; it changes codegen and links a runtime:**

```bash
# Compile AND link with -fsanitize=thread. -g for line numbers, -O1 for usable speed.
clang -fsanitize=thread -g -O1 race.cc -o race
./race
```

**Go — TSan is built in; one flag, no separate toolchain:**

```bash
go test -race ./...        # run the whole suite under the race detector
go build -race -o app .    # a race-instrumented binary
go run -race main.go       # quick one-off
```

Tune the runtime through environment variables — `TSAN_OPTIONS` (C/C++) and `GORACE` (Go):

```bash
# C/C++ — stop on first race; richer stacks; more history; load suppressions.
export TSAN_OPTIONS="halt_on_error=1:second_deadlock_stack=1:history_size=7:suppressions=tsan.supp"
./race

# Go — same idea, colon-separated, via GORACE.
export GORACE="halt_on_error=1 history_size=7 log_path=/tmp/race"
go test -race ./...
```

| Option | Effect |
|---|---|
| `halt_on_error=1` | exit on the *first* race (default is to keep running and report more). |
| `history_size=N` | per-thread access-history size = `32 * 2^N` entries; bigger N = deeper "previous access" stacks, more memory. |
| `second_deadlock_stack=1` | print both stacks for lock-order inversions. |
| `suppressions=file` | path to a suppression file (see below). |
| `exitcode=66` / `log_path` | the process exit code on a finding; where to write reports. |

**Escape hatches** — for code TSan must *not* instrument (validated lock-free code, or sync TSan can't see):

```go
//go:norace
func readClockUnsynchronized() int64 { /* hand-validated; skip instrumentation */ }
```

```cpp
// Per-function: do not instrument this body.
__attribute__((no_sanitize("thread")))
void publish_via_inline_asm() { /* ... */ }
```

**Suppression file** (`tsan.supp`) — silence a *known* report by category and symbol, without recompiling:

```
# tsan.supp — format: <type>:<symbol-or-file-substring>
race:third_party/legacy_cache.c
race:^ZSTD_.*$
deadlock:KnownBenignLockOrder
```

**Annotations for hand-rolled synchronization** — when *you* implement a happens-before edge TSan can't infer (a custom lock, a lock-free queue), tell TSan about the edge so it stops false-positiving:

```cpp
#include <sanitizer/tsan_interface.h>
// Producer side, after publishing:
__tsan_release(&queue);            // "everything before here is released on queue"
// Consumer side, after acquiring:
__tsan_acquire(&queue);            // "I acquire whatever was released on queue"
// Higher-level equivalents:
ANNOTATE_HAPPENS_BEFORE(&queue);   // release edge
ANNOTATE_HAPPENS_AFTER(&queue);    // acquire edge
```

**Cost** — budget for it: roughly **5–15× CPU** slowdown and **5–10× memory** overhead. `history_size` is the main memory dial: a deeper history gives you fuller "previous access" stacks at the cost of RAM. You do not ship a TSan build to production; you run it in tests and CI.

> **Key insight:** Reach for the escape hatches *last*, not first. Every `//go:norace`, `no_sanitize`, and suppression is a blind spot you are choosing to keep. The legitimate uses are narrow: hand-validated lock-free code, third-party code you can't fix, and synchronization TSan genuinely cannot observe (Concept 6). For ordinary "I think this is fine" code, the right move is to add a real synchronization edge, not to silence the detector.

---

## Core Concept 6 — The Critical Limitation: TSan Is Dynamic

TSan is a **dynamic** analysis. It has two consequences that define how you must use it.

**1. It only sees what actually runs.** TSan reports a race only if, during *this* execution, *both* conflicting accesses execute *and* the threads are scheduled so both touch the location while it's instrumented. A race on an error path that the run never hit, or in a branch that this input didn't take, is invisible. There is no static reasoning about "could two threads reach here" — only observation of "did they."

The corollary is the most important operational fact about TSan:

- **Coverage matters.** A race in untested code is undetected. Drive the racy code paths.
- **Interleavings matter.** A race needs the *right* schedule. A single fast run on an idle machine may never produce it.

So you don't run TSan once and declare victory. You **run it under load and stress**, **run the suite many times**, and **combine it with stress tests and fuzzing** to explore schedules and inputs:

```bash
# Hammer the scheduler: many iterations, under CPU contention, many counts.
go test -race -run TestConcurrentCache -count=200 ./cache/
stress -c $(nproc) &                       # add CPU pressure to perturb scheduling
GORACE="halt_on_error=1" go test -race -count=50 ./...
```

**2. But — and this is the decisive advantage — the race does *not* have to produce wrong output.** A flaky test only fails when the race *manifests* as an observable error, which may be one run in ten thousand. TSan flags the race the moment the two unordered accesses *occur*, regardless of whether the result was corrupted. It turns a 0.01%-reproducible Heisenbug into a deterministic finding on any run where the code path executes with both threads present.

```
flaky test:  needs race to EXECUTE *and* CORRUPT output  → fails ~rarely, nondeterministic
TSan:        needs race to EXECUTE                        → reports every such run, deterministic
```

**False positives are rare but real**, and they have a single root cause: synchronization TSan *cannot see*. The runtime only knows about edges from instrumented sync primitives. If you synchronize via:

- **inline assembly** (a hand-written memory barrier),
- **lock-free code without proper atomics** (e.g., a plain load where a release/acquire atomic was meant),
- **memory-mapped I/O or hardware** registers,

…then a real happens-before edge exists that TSan didn't observe, and it reports a race that isn't one. The fix is to *annotate* the edge (`__tsan_acquire/__tsan_release`, `ANNOTATE_HAPPENS_BEFORE`) so TSan's model matches reality — not to suppress blindly.

> **Key insight:** TSan trades completeness for soundness. It will not catch *every* race (it's bounded by what executes and how threads interleave), but what it *does* report is, with rare and explicable exceptions, a *real* race — no wrong output required. That asymmetry is exactly backwards from flaky tests, and it's why "the suite is green" and "we ran it under `-race`" are different, complementary guarantees.

---

## Core Concept 7 — TSan in CI

A race detector you run "sometimes, locally" catches nothing. The value is in **gating**: a CI job that runs the suite under TSan and fails the build on any finding.

**Go — the common case is trivial:** add a dedicated race job.

```yaml
# .github/workflows/ci.yml
jobs:
  race:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with: { go-version: '1.22' }
      # -count=1 disables the test cache so the suite truly re-runs.
      - run: go test -race -count=1 ./...
        env:
          GORACE: "halt_on_error=1 history_size=7"
```

`go test -race` exits non-zero on a race (status 66), so the job fails automatically. No extra parsing needed.

**C/C++ — TSan is a separate *build variant*.** You compile a TSan flavor of the binary/tests and run that suite:

```bash
# A CMake build dir dedicated to the TSan variant.
cmake -B build-tsan -DCMAKE_CXX_FLAGS="-fsanitize=thread -g -O1" \
                    -DCMAKE_EXE_LINKER_FLAGS="-fsanitize=thread"
cmake --build build-tsan
TSAN_OPTIONS="halt_on_error=1:suppressions=tsan.supp" ctest --test-dir build-tsan
```

Two CI realities to plan for:

1. **TSan cannot share a build with ASan or MSan.** They each replace the same runtime machinery; you can't pass `-fsanitize=thread,address`. Run TSan as its **own job/variant**, separate from your ASan and UBSan jobs.
2. **Budget the slowdown.** With 5–15× CPU overhead, the race suite is slower than the normal one. Run it on the full suite for `main`/release branches; on PRs, run it on the concurrency-heavy packages plus changed packages if total time is a concern — but never drop it to zero.

> **Key insight:** "Gate on clean" means the build is *red* on a race, the same as on a failing test. A TSan job that runs but whose result nobody blocks on is theater — races will accumulate because the one signal that catches them is advisory. Make it required, give it enough iterations (`-count`) and stress to exercise interleavings, and treat a finding exactly like a unit-test failure: it blocks the merge.

---

## Real-World Examples

**1. Go map written from two goroutines.** A handler updates a shared `map[string]int` cache without a lock. Single-threaded tests pass; production occasionally panics with `concurrent map writes`. `go test -race` on a concurrent test reports the exact two write sites and where each goroutine was spawned. Fix: a `sync.RWMutex` (or `sync.Map`) — adding the unlock→lock edge that orders the writes. The race existed long before the production panic; TSan surfaced it without needing the panic to fire.

**2. C++ lazy singleton with a non-atomic flag.** `if (!initialized) { init(); initialized = true; }` guarded by nothing. Two threads read `initialized == false`, both call `init()`. TSan reports a race on `initialized` and on the singleton storage, with both threads' stacks. Fix: `std::call_once` / `std::atomic<bool>` with acquire/release — establishing the publish edge. TSan caught it on the first concurrent test, where production had run "fine" for months.

**3. Lock-free ring buffer false positive.** A team's SPSC queue uses `std::atomic` for the indices but stores the *payload* with a plain write, relying on the index's release/acquire to publish it. TSan flags the payload write/read as racy — it can't infer that the atomic index orders the payload. This is the textbook annotate-don't-suppress case: `__tsan_release(&slot)` after the store, `__tsan_acquire(&slot)` after the index load, teaching TSan the real edge. Reports go to zero and stay meaningful.

**4. Flake that wasn't a flake.** A CI test failed ~1 in 2,000 runs with a wrong counter total — long dismissed as "infra flakiness" and retried away. Running it `go test -race -count=500` reported a data race on the counter *every batch*, deterministically. The "flake" was a real race whose corruption was simply rare. TSan converted an un-actionable retry into a one-commit fix (`atomic.AddInt64`).

---

## Mental Models

- **Happens-before is a chain of handoffs.** Each synchronization op (unlock→lock, send→recv, Done→Wait) is a baton pass: whoever takes the baton inherits everything the giver did. A race is two runners touching the same object with *no baton between them* — they were never ordered.

- **Vector clocks are "what each thread has heard about."** Entry `i` is the latest news from thread `i` this thread has received. A sync event is news exchange (entry-wise max). One clock happens-before another iff it has heard *strictly no more* than the other on every front. Heard-different-things = concurrent = candidate race.

- **Shadow memory is a guestbook per location.** Every access signs the guestbook with *who, when (clock), how wide, read/write*. On each new access TSan checks the recent signatures: if the last writer's "when" isn't ordered before mine, we were both there at once.

- **TSan is a witness, not a prophet.** It testifies precisely about what it *saw* this run — both accesses, the exact clocks, no ordering between them. It cannot foresee a race on a path that didn't execute. Trust its testimony absolutely; never assume its silence is a proof of safety.

---

## Common Mistakes

1. **Assuming green tests mean race-free.** Tests check *output*; a race can leave output correct on every run you observed. Only a happens-before checker (TSan) checks the race property. The two are complementary, not redundant.

2. **Running TSan once and declaring victory.** TSan is dynamic: no execution of the racy path, no report. Run it under load, with `-count=N`, with stress, across inputs. Coverage and interleavings are *your* responsibility.

3. **"Fixing" a race with a `Sleep` or `volatile`.** Neither creates a happens-before edge, so neither fixes the race — it only changes the odds. TSan will still report it (correctly). The fix is a real synchronization edge: mutex, channel, or proper atomic.

4. **Suppressing a true positive to get green.** A suppression on real racy code hides a real bug forever. Suppress only third-party code you can't fix; for your own code, add the missing edge.

5. **Suppressing a false positive instead of annotating it.** A false positive means TSan missed a *real* edge (inline asm, lock-free, MMIO). `__tsan_acquire/__tsan_release` / `ANNOTATE_HAPPENS_BEFORE` teaches TSan the edge so it stays accurate; a blanket suppression blinds it to *new* races there too.

6. **Combining `-fsanitize=thread` with `address` or `memory`.** They replace the same runtime and can't coexist in one build. Run TSan as its own build variant / CI job.

7. **Shipping a `-race` binary to production.** The 5–15× CPU and 5–10× memory cost is for tests and CI, not prod. The instrumented binary is a debugging tool, not a deployment artifact.

---

## Test Yourself

1. State the formal definition of a data race in terms of happens-before.
2. A program uses a mutex around a counter and TSan reports no race; remove the mutex and it does. What changed in happens-before terms — did the mutex "block" anything?
3. What two data structures does TSan maintain, and what question does comparing two vector clocks answer?
4. In a Go `-race` report, what do the "Read at …", "Previous write …", and "goroutine N created at …" sections each tell you?
5. TSan stays silent on a program you *know* has a race. Give two distinct reasons consistent with TSan being correct.
6. You get a TSan report on a lock-free queue whose indices are proper atomics but whose payload uses plain writes. Is it a true or false positive, and what's the right fix?
7. Why can't you build one binary with both `-fsanitize=thread` and `-fsanitize=address`?

<details>
<summary>Answers</summary>

1. A data race is two **conflicting** accesses (same location, ≥1 write) that are **not ordered by happens-before** — i.e., concurrent under the partial order.
2. The mutex's `unlock → later lock` is a synchronization edge that puts the two accesses in happens-before order. It doesn't matter that it also serializes execution; what removes the race is the *ordering edge*. Remove the mutex and the edge is gone → the accesses are concurrent → race.
3. **Vector clocks** (per thread) and **shadow memory** (per location). Comparing two vector clocks answers: *is access A ordered before access B?* If every entry of A ≤ B's, then `A → B`; if neither dominates, they're **concurrent** (a race if conflicting).
4. "Read at" = this access + its stack/line. "Previous write" = the *other* conflicting access (the two are the race). "goroutine N created at" = where each goroutine was *spawned* — the usual clue to *why* they overlap.
5. (a) The racy code path didn't execute this run (an untaken branch / error path). (b) Both accesses executed but the schedule never had both threads touch the location concurrently (wrong interleaving). Either is consistent with TSan being sound — it's *dynamic*.
6. A **false positive**: a real happens-before edge exists (the atomic index's release/acquire publishes the payload) that TSan can't infer for the plain payload write. Fix: **annotate** it — `__tsan_release(&slot)` after the store, `__tsan_acquire(&slot)` after the index load. Don't suppress.
7. TSan and ASan each replace the same instrumentation/runtime machinery; they're mutually exclusive in a single build. Build and run them as separate variants/jobs.

</details>

---

## Cheat Sheet

```
THE DEFINITION
  data race = two conflicting accesses (same loc, ≥1 write)
              NOT ordered by happens-before  (concurrent)

HAPPENS-BEFORE EDGES (what prevents a race)
  mutex unlock → later lock        atomic store-release → load-acquire
  go create    → goroutine start   channel send → receive (Go)
  thread last  → join returns      WaitGroup Done() → Wait() returns
  (Sleep / volatile create NO edge → do NOT fix races)

HOW TSAN WORKS
  instrument every access + every sync op
  vector clock per thread   → compare ⇒ ordered or concurrent?
  shadow cells per location → {thread, clock epoch, size, R/W}
  new access vs cells: conflict + not-ordered ⇒ REPORT

BUILD / RUN
  C/C++   clang -fsanitize=thread -g -O1 f.cc -o f
  Go      go test -race ./...   |  go build/run -race
  TSAN_OPTIONS=halt_on_error=1:history_size=7:suppressions=t.supp
  GORACE="halt_on_error=1 history_size=7"

ESCAPE HATCHES (use last)
  Go      //go:norace
  C/C++   __attribute__((no_sanitize("thread")))
  supp    race:<symbol-or-file>      (third-party / unfixable only)
  annotate __tsan_acquire/release  ANNOTATE_HAPPENS_BEFORE/AFTER
           (for sync TSan can't see: inline asm, lock-free, MMIO)

COST          ~5–15× CPU, ~5–10× memory   (history_size = mem dial)
DYNAMIC       only finds races that EXECUTE w/ the right schedule
              → run under load, -count=N, stress, fuzz
              → but race need NOT corrupt output (beats flaky tests)
CI            Go: -race job, gate on clean   |  C/C++: own build variant
              CANNOT share a build with ASan/MSan
```

---

## Summary

- A data race has a **formal** definition: two **conflicting** accesses (same location, ≥1 write) **not ordered by happens-before**. The informal "missing lock" is just the common way that ordering goes absent.
- **Happens-before** (Lamport) is a partial order built from program order plus a fixed set of synchronization edges — unlock→lock, create/join, store-release→load-acquire, channel send→recv, `WaitGroup`. A mutex prevents a race by *adding an edge*, not by "blocking"; `Sleep` and `volatile` add no edge and fix nothing.
- TSan **instruments** every access and sync op, maintains a **vector clock** per thread and **shadow cells** per location, and on each access checks the formal definition directly. A report is a proof that two specific accesses were genuinely concurrent.
- Read reports field by field: the two stacks are the two halves; "created at" frames say *why* the threads coexist; C/C++ adds the variable name and locks held (different locks held on both sides = the bug).
- Flags: C/C++ `-fsanitize=thread -g -O1`; Go `-race`. Tune via `TSAN_OPTIONS`/`GORACE` (`halt_on_error`, `history_size`, suppressions). Escape hatches (`//go:norace`, `no_sanitize`, suppressions, `__tsan_acquire/release`) are for the narrow cases TSan can't see — use them last.
- TSan is **dynamic**: it only catches races that *execute* under a revealing schedule, so run it under load, with `-count=N`, and with stress/fuzzing — but it flags the race *without needing wrong output*, which is its decisive edge over flaky tests.
- In **CI**, gate on a clean run: a Go `-race` job or a C/C++ TSan build variant, required like any test, and never sharing a build with ASan/MSan.

---

## Further Reading

- *ThreadSanitizer — Clang documentation* — flags, `TSAN_OPTIONS`, suppression and annotation interfaces; the primary source for the C/C++ side.
- *Introducing the Go Race Detector* (The Go Blog) — how `-race` works, what it catches, and the dynamic-coverage caveat, from the Go team.
- *ThreadSanitizer: data race detection in practice* (Serebryany & Iskhodzhanov, WBIA 2009) — the TSan design paper: shadow state, vector clocks, and the engineering trade-offs (the "v2" compiler-instrumented design followed).
- *Time, Clocks, and the Ordering of Events in a Distributed System* (Lamport, 1978) — the original happens-before relation everything here rests on.
- [senior.md](senior.md) — the shadow-memory state machine in detail, lock-order/deadlock detection, TSan internals, and large-codebase rollout strategy.

---

## Related Topics

- [01 — AddressSanitizer](../01-address-sanitizer-asan/middle.md) — the memory-error sibling; runs as a separate build (can't share with TSan).
- [03 — UndefinedBehaviorSanitizer](../03-undefined-behavior-sanitizer-ubsan/middle.md) — catches the UB that data races technically are, plus much more.
- [05 — Coverage-Guided Dynamic Analysis](../05-coverage-guided-dynamic-analysis/middle.md) — drive more interleavings and inputs so TSan's dynamic coverage actually finds the race.
- [06 — Runtime Assertions & Contracts](../06-runtime-assertion-and-contract-checking/middle.md) — the other runtime-checking discipline; assertions catch what sanitizers don't.
- [Language Internals → Concurrency](../../../language-internals/concurrency-async-parallel/concurrency/) — the memory model and synchronization primitives that define happens-before.
