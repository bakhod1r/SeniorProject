# ThreadSanitizer (TSan) — Junior Level

> **Roadmap:** [Dynamic Analysis & Sanitizers](../README.md) → ThreadSanitizer (TSan)
> *Concurrency bugs don't crash politely. They corrupt a number here, drop a write there, and pass every test you run — until production, at 3 a.m., on a machine that isn't yours. ThreadSanitizer is the tool that drags those ghosts into the light.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — What a Data Race Actually Is](#core-concept-1--what-a-data-race-actually-is)
5. [Core Concept 2 — Why Races Are Uniquely Evil](#core-concept-2--why-races-are-uniquely-evil)
6. [Core Concept 3 — Turning TSan On](#core-concept-3--turning-tsan-on)
7. [Core Concept 4 — Reading a TSan Report](#core-concept-4--reading-a-tsan-report)
8. [Core Concept 5 — Fixing the Race, and TSan Going Silent](#core-concept-5--fixing-the-race-and-tsan-going-silent)
9. [Core Concept 6 — The One Rule: It Has to Actually Run](#core-concept-6--the-one-rule-it-has-to-actually-run)
10. [Real-World Examples](#real-world-examples)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **What is a data race, and how does TSan catch one before it bites you?**

You wrote a program that uses more than one thread — two goroutines, two OS threads, a worker pool. It passes your tests. It runs fine a hundred times. Then it fails once, on CI, with a wrong number, and you can never reproduce it. You re-run it: works. You add a print statement: works. You ship it: it corrupts a user's data next Tuesday.

That is the signature of a **data race**, and it is the single most frustrating class of bug a programmer meets. The reason it's so frustrating is that the bug isn't in your *logic* — your logic is correct when you trace it by hand. The bug is in the *timing*: two threads touching the same piece of memory at the same instant, in an order you never accounted for. Timing is invisible, nondeterministic, and impossible to print.

**ThreadSanitizer** (TSan) is a tool built into the C, C++, and Go compilers that watches your program *while it runs* and detects data races directly — not by guessing, not by static reasoning about your source, but by observing the actual memory accesses and the actual synchronization as they happen. When two threads touch the same memory with no ordering between them and at least one is writing, TSan stops and prints exactly which two lines collided, on which two threads, and which locks were (and weren't) held.

The thing that makes TSan extraordinary: **it reports the race even when the race didn't produce a wrong answer this time.** A flaky test only fails on the rare run where the timing happens to corrupt something. TSan flags the *bug itself* — the missing synchronization — on *any* run where both threads touch that memory, whether or not the corruption actually occurred. It converts a one-in-ten-thousand Heisenbug into a deterministic, every-run report.

> **Mindset shift:** stop thinking "my code is correct because I can trace it and it produces the right answer." Start thinking "with two threads, there are *many* possible orderings, the CPU and runtime pick one at random, and my code must be correct under *all* of them." A test that passes proves one ordering worked. TSan checks whether the *rules* that make all orderings safe are present at all. You stop debugging the symptom (a wrong value, sometimes) and start fixing the cause (missing synchronization, always).

---

## Prerequisites

- **Required:** You know what a **thread** or a **goroutine** is — a path of execution that can run at the same time as another. (In Go, a goroutine is a lightweight thread you start with the `go` keyword.)
- **Required:** You've written or seen a program with at least two threads sharing some data — a counter, a map, a slice.
- **Required:** You can run a command in a terminal and compile or run a program (examples use **Go** and **C/C++**).
- **Helpful:** You've heard the words "mutex," "lock," or "atomic" even if you're fuzzy on them. (We define them below.)
- **Helpful:** You've hit a test that fails *sometimes* and passes *sometimes* with no code change. That flakiness is often a data race — exactly what TSan finds.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Thread** | An independent path of execution that runs concurrently with other threads in the same program. |
| **Goroutine** | Go's lightweight thread, started with `go f()`. Many goroutines map onto a few OS threads. |
| **Shared memory** | A variable, struct field, map, or slice that more than one thread can read or write. |
| **Data race** | Two threads accessing the same memory location with no ordering between them, where at least one access is a write and there's no synchronization. |
| **Mutex** | "Mutual exclusion" lock. Only one thread can hold it at a time; used to serialize access to shared data (`sync.Mutex`, `std::mutex`). |
| **Atomic** | A special operation (read, write, add) that the hardware guarantees happens indivisibly, safe across threads without a mutex (`sync/atomic`, `std::atomic`). |
| **Synchronization** | Any mechanism (mutex, atomic, channel) that imposes an *order* between operations on different threads. |
| **Happens-before** | The ordering guarantee synchronization creates: "operation A definitely finished before operation B started." No happens-before between two accesses = they race. |
| **Race condition** | A broader term: a bug caused by timing/ordering. A *data race* is one specific, well-defined kind. |
| **Undefined behaviour (UB)** | In C/C++, a program state the language places no rules on — anything may happen. A data race is UB. |
| **Heisenbug** | A bug that changes or vanishes when you try to observe it (add a print, run under a debugger). Races are classic Heisenbugs. |
| **Instrumentation** | Extra bookkeeping code the compiler injects (with `-fsanitize=thread`) so the tool can watch every memory access at runtime. |

---

## Core Concept 1 — What a Data Race Actually Is

People throw the phrase "race condition" around loosely. TSan detects one precise thing, and you need its exact definition, because the fix follows directly from it.

A **data race** happens when **all four** of these are true at once:

1. **Two or more threads** access the same memory location.
2. The accesses happen **concurrently** — with no ordering (no *happens-before*) between them.
3. **At least one** of the accesses is a **write**.
4. There is **no synchronization** (mutex, atomic, channel) ordering them.

Walk through why each clause matters:

- **Two threads on the same location.** One thread touching its own local variable is never a race — nobody else is looking. Races require *sharing*.
- **At least one write.** Two threads *reading* the same value at the same time is completely fine — reading doesn't change anything, so the order doesn't matter. The instant one of them *writes*, order suddenly matters, because now "did I read before or after the write?" has two different answers.
- **No ordering between them.** If a mutex (or a channel send/receive) guarantees thread A finished before thread B started, there's no race — the accesses are *ordered*, just on different threads. That ordering is called **happens-before**, and creating it is the entire job of synchronization.

Here is the canonical race — two goroutines incrementing one shared counter with no lock:

```go
package main

import "sync"

func main() {
	counter := 0          // shared memory
	var wg sync.WaitGroup

	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 1000; j++ {
				counter++      // READ counter, add 1, WRITE counter — no lock!
			}
		}()
	}
	wg.Wait()
	println(counter)         // you'd expect 2000... but it's often less
}
```

`counter++` looks atomic but isn't — it's three steps: **read** `counter`, **add** one, **write** it back. With two goroutines doing this at once, both can read the same old value (say `41`), both add one, both write `42` — and one increment silently vanishes. That's why the printed total is often `1873` or `1991` instead of `2000`, and *which* wrong number you get changes every run.

> **Key insight:** A data race is defined by the *absence of synchronization*, not by a wrong result. The program above might print `2000` by luck on some runs. It still has a data race on *every* run, because the rule — "order these accesses with a lock or atomic" — is missing. TSan checks for the missing rule, which is why it catches the bug even on the lucky runs.

---

## Core Concept 2 — Why Races Are Uniquely Evil

Many bugs are annoying. Data races are a category of their own, and it's worth understanding *why* so you take TSan seriously.

**They're nondeterministic.** The outcome depends on which thread wins the timing, and that's decided by the OS scheduler, CPU load, cache state — things that change every run. The same input gives different output. You cannot reproduce on demand.

**They corrupt data silently.** A lost increment, a half-written struct, a map resized while another thread reads it — none of these necessarily *crash*. They just produce a subtly wrong value that flows downstream and surfaces as a mystery later, far from the cause.

**They "work on my machine."** Race outcomes depend on timing, and timing differs across machines (core count, load, OS). A race that never triggers on your fast laptop fires constantly on a busy 64-core production server. The classic deployment heartbreak.

**They are the worst Heisenbugs.** The moment you try to observe a race — attach a debugger, add a `println`, run a slower build — you change the timing, and the bug often *disappears*. You "fix" it by adding a log line, ship it, and it comes back when you remove the log. Maddening.

**In C and C++, a data race is undefined behaviour.** This is the sharp one. The C and C++ standards say a program with a data race has *no defined meaning at all* — the compiler is allowed to do literally anything: produce garbage, crash, optimize your code into something that can't possibly work, or appear to work and then betray you after the next compiler upgrade. It is not "you get a slightly stale value." It is "all bets are off." (Go is friendlier — the language defines races as bugs but bounds the damage more — but a racy Go program is still incorrect and can still corrupt maps, interfaces, and slices in ways that crash the runtime.)

> **Key insight:** You cannot reliably find races by testing harder. Tests check *outcomes*, and a race's bad outcome is rare and nondeterministic — so a green test suite tells you almost nothing about race-freedom. You need a tool that checks the *cause* (missing synchronization) directly, regardless of whether the bad outcome happened to occur. That tool is TSan.

---

## Core Concept 3 — Turning TSan On

TSan is not a separate program you download and point at a binary. It's a **compiler feature**: you *recompile* your code with a flag, and the compiler injects bookkeeping (instrumentation) around every memory access so the runtime can watch them. You then run the instrumented program normally.

**C and C++ (Clang or GCC).** Add `-fsanitize=thread` to *both* the compile and link steps, plus `-g` so the report carries readable file/line info:

```bash
clang -fsanitize=thread -g -O1 race.c -o race    # compile + link with TSan
./race                                            # run — TSan watches and reports
```

`-O1` (light optimization) is recommended: it keeps things fast enough while preserving usable stack traces. `-g` embeds debug symbols so the report shows `race.c:14` instead of a raw address. The same flag works on GCC.

**Go — it's built in.** You don't pass a sanitizer flag; the toolchain has a `-race` mode:

```bash
go test -race ./...       # run all tests with the race detector — the most common use
go run  -race main.go     # run a program with it
go build -race -o app .   # build a race-detecting binary
```

`go test -race` is the workhorse. Wire it into CI and every test run becomes a race hunt.

A complete C example you can run yourself:

```c
// race.c — two threads incrementing a shared int with no lock
#include <pthread.h>
#include <stdio.h>

int counter = 0;                       // shared

void *worker(void *arg) {
    for (int i = 0; i < 100000; i++)
        counter++;                     // read-add-write, unsynchronized
    return NULL;
}

int main(void) {
    pthread_t t1, t2;
    pthread_create(&t1, NULL, worker, NULL);
    pthread_create(&t2, NULL, worker, NULL);
    pthread_join(t1, NULL);
    pthread_join(t2, NULL);
    printf("counter = %d\n", counter); // expected 200000; usually less
    return 0;
}
```

```bash
clang -fsanitize=thread -g -O1 race.c -o race && ./race
```

> **Key insight:** TSan is a *recompile-and-run* tool, not an after-the-fact scan. The flag changes how the program is built so it can observe itself at runtime. This is why TSan runs in your **test/CI build**, never your production build — you ship the normal, uninstrumented binary, and you catch races in the instrumented one beforehand.

---

## Core Concept 4 — Reading a TSan Report

When two unsynchronized conflicting accesses happen, TSan halts and prints a report. The first time, it looks intimidating. It isn't — it's the same handful of fields every time. Here's an abbreviated report from the Go counter example (`go run -race`), with annotations:

```
==================
WARNING: DATA RACE
Read at 0x00c000012088 by goroutine 8:          ← access #1: a READ, on goroutine 8
  main.main.func1()
      /home/me/race.go:15 +0x44                 ← race.go line 15 (the counter++)

Previous write at 0x00c000012088 by goroutine 7: ← access #2: a WRITE, on goroutine 7
  main.main.func1()
      /home/me/race.go:15 +0x58                 ← SAME line, different goroutine

Goroutine 8 (running) created at:                ← where goroutine 8 was started
  main.main()
      /home/me/race.go:12 +0xb8

Goroutine 7 (finished) created at:
  main.main()
      /home/me/race.go:12 +0xa4
==================
Found 1 data race(s)
exit status 66
```

Read it top to bottom — every report has these parts:

1. **`WARNING: DATA RACE`** (Go) / **`WARNING: ThreadSanitizer: data race`** (C/C++) — the headline. You have a race.
2. **The two conflicting accesses.** One is labelled a **read**, the other a **write** (a race needs at least one write). Each shows the **memory address** (`0x...12088` — the same address proves it's the *same* location) and a **stack trace** pointing at the exact source line. These two stacks are the most important thing in the report: they are *the two lines of code that collided*.
3. **Which thread/goroutine** did each access (`goroutine 8`, `goroutine 7`) and, in Go, **where each was created** — so you can trace which `go` statement spawned the racing worker.
4. **(In the C/C++ form)** a `Mutexes:` line under each access listing locks held at the time — invaluable for "I thought this was locked" bugs, because it shows you held the *wrong* lock or *no* lock.

The C/C++ report is shaped almost identically — `Write of size 4 ... Previous read of size 4 ...`, two stacks, the thread that did each, and the mutex set. Same skeleton, same way to read it.

> **Key insight:** A TSan report is not asking you to debug timing. It hands you **the two lines that touched the same memory without synchronization**. Your job is mechanical: look at both stacks, find the shared variable, and add the missing lock or atomic so those two accesses can never overlap. You're not chasing a ghost anymore — you have its address and both its hands.

---

## Core Concept 5 — Fixing the Race, and TSan Going Silent

A race report names a shared location and two unsynchronized accesses. The fix is always the same shape: **make those accesses ordered.** Two standard tools do it.

**Option A — a mutex.** Wrap every access to the shared data in a lock so only one thread touches it at a time:

```go
package main

import "sync"

func main() {
	counter := 0
	var mu sync.Mutex          // the lock guarding counter
	var wg sync.WaitGroup

	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 1000; j++ {
				mu.Lock()
				counter++          // now exactly one goroutine is here at a time
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	println(counter)             // always 2000 now
}
```

The mutex creates a *happens-before* order: whatever one goroutine did while holding the lock definitely finished before the next goroutine acquires it. The accesses can no longer overlap. Clause 4 of the data-race definition (no synchronization) is now false, so it isn't a race.

**Option B — an atomic.** For a single counter, a mutex is heavier than needed. An *atomic* operation is one the hardware guarantees is indivisible — the read-add-write happens as one uninterruptible unit:

```go
import "sync/atomic"

var counter int64
// ...
atomic.AddInt64(&counter, 1)   // indivisible: no other thread can interleave
```

In C++ the equivalent is `std::atomic<int> counter;` then `counter++;`, and in C, `atomic_int counter;` with `atomic_fetch_add(&counter, 1)`.

**The proof it worked: TSan goes silent.** Recompile the fixed version with the sanitizer and run it again:

```bash
$ go test -race ./...
ok      example/counter   0.312s          ← no WARNING. The race is gone.
```

No report means TSan watched every access on this run and found no unsynchronized conflict. (Remember the caveat from the next section — silence means *this run* was clean, so you want your tests to actually exercise the concurrent paths.)

> **Key insight:** There are only two destinations for the fix — **serialize** the accesses (mutex) so one waits for the other, or make the operation **atomic** (hardware-indivisible) so it can't be interrupted. Choose atomic for a single counter/flag; choose a mutex when you must update *several* fields together as one consistent unit. Either way you're installing the happens-before order whose absence TSan complained about.

---

## Core Concept 6 — The One Rule: It Has to Actually Run

This is the most important thing a junior must internalize about TSan, and it's where it differs from tools that read your source without running it.

TSan is a **runtime** detector. It only sees accesses that *actually execute* during the run. So it reports a race **only if, during this run, both threads actually touch that location** with conflicting, unsynchronized accesses. Two consequences fall out:

**The good news — it does NOT need the race to produce a wrong answer.** This is TSan's superpower over flaky tests. A flaky test fails only on the rare run where the timing happens to corrupt data. TSan flags the race on *any* run where both accesses occur, even if, that time, the values happened to come out right. It catches the bug on the 9,999 "lucky" runs where a plain test would pass. It detects the *missing synchronization*, not the *bad outcome*.

**The catch — the racy code path must execute.** TSan can't report a race in code that never runs. If the function with the bug isn't called, or only one of the two threads is ever started in your test, or the input never drives both threads to that shared variable, TSan stays silent — not because the code is safe, but because it never saw the collision. Concretely:

```go
func TestWorker(t *testing.T) {
	// If this test only ever starts ONE worker, TSan can't see the
	// two-worker race — the second accessor never runs.
	startWorkers(1)        // bug hides
}

func TestWorkerConcurrent(t *testing.T) {
	// Start MANY workers hammering the shared state — now the
	// conflicting accesses actually overlap and TSan fires.
	startWorkers(50)       // bug exposed
}
```

So the recipe isn't just "turn on `-race`." It's "turn on `-race` **and run tests that actually exercise concurrency**" — spin up multiple workers, loop the operation many times, use realistic parallelism. This is why teams pair `go test -race` with stress tests (`go test -race -count=100 -run TestConcurrent`) and load-style tests: more interleavings explored, more races surfaced.

> **Key insight:** TSan removes the *nondeterminism* of a race (it'll report on any run where the collision happens, not just the unlucky ones), but it cannot remove the requirement that the collision *happens at all*. Good concurrent tests are what make the collision happen. TSan is a microscope; you still have to put the bug under the lens.

---

## Real-World Examples

**1. The vanishing metric counter.** A service increments a `requestsServed` integer from every request handler — and each request runs on its own goroutine, with no lock. Under light load it looks right. Under production traffic the count is mysteriously ~3% low, and nobody can explain the missing requests. The cause is the lost-update race from Core Concept 1: concurrent `requestsServed++` operations clobbering each other. `go test -race` with a test that fires 100 concurrent requests reports the race instantly, pointing at the exact `++` line. Fix: `atomic.AddInt64`. The count becomes exact.

**2. "fatal error: concurrent map read and map write."** A Go program caches results in a plain `map` and reads/writes it from multiple goroutines without a lock. It works for weeks, then one day the whole process *crashes* with `fatal error: concurrent map read and map write` — Go's runtime detected the unsafe map access and killed the program to avoid silent corruption. The team could never reproduce it locally. Running the test suite once with `-race` surfaced the racy map access deterministically, with both stacks. Fix: guard the map with a `sync.Mutex` (or switch to `sync.Map`). This is the textbook "passes tests, crashes in prod, `-race` finds it in seconds" story.

**3. The C++ flag that "worked" until the compiler upgraded.** A C++ worker sets a plain `bool done = true;` from one thread; the main thread loops `while (!done) {}`. It worked for years. After a compiler upgrade the program started hanging forever. Reason: an unsynchronized `bool` shared across threads is a data race, which is *undefined behaviour*, and the newer optimizer was now legally allowed to hoist the read out of the loop (it assumed `done` couldn't change). Building with `-fsanitize=thread` reported the race between the writer and the reader. Fix: `std::atomic<bool> done;`. A perfect illustration of why "it compiled and ran before" guarantees nothing when UB is involved.

---

## Mental Models

- **A race is a missing traffic light, not a crash.** Two cars (threads) cross the same intersection (memory). Usually they miss each other and you never notice. Occasionally they collide (data corruption). TSan doesn't wait for a collision — it inspects the intersection and reports "there's no traffic light here," which is the real defect. Adding the light (mutex/atomic) is the fix.

- **Read-read is fine; the trouble starts at the first write.** Any number of threads can *read* shared data simultaneously with no problem — reading changes nothing. The danger appears the moment one thread *writes*, because now the others' reads depend on *when* they happened relative to that write. "At least one write" is the trip-wire in the definition for exactly this reason.

- **Synchronization is about *ordering*, not *speed*.** A mutex doesn't make your code faster — it's pure overhead. What it buys is an *order*: a guarantee that one thread's accesses happen-before another's. Races are an *ordering* defect, so the fix is always an *ordering* tool. If you find yourself thinking "I'll make it faster to avoid the race," you've misdiagnosed it.

- **TSan turns a coin-flip bug into a checklist item.** A race is "fails 1 run in 10,000, can't reproduce." TSan converts that into "fails *every* run where both threads touch the variable, with both stack traces printed." It doesn't make races less serious; it makes them *findable* and *fixable* on demand — the difference between hunting a ghost and reading an error message.

---

## Common Mistakes

1. **Believing a passing test means no race.** Tests check outcomes; a race's bad outcome is rare and random, so green tests prove almost nothing about race-freedom. You must run with `-race` (or `-fsanitize=thread`) *and* exercise the concurrent paths. Silence from a plain test is not evidence.

2. **Thinking `counter++` is atomic.** It's three operations (read, add, write). Two threads can interleave them and lose updates. A single statement in your source is not a single, uninterruptible action at the hardware level. This is the most common beginner race.

3. **Running TSan but never exercising concurrency.** Turning on `-race` while your test starts only one worker (or never hits the shared path) finds nothing — TSan can only report collisions that actually *happen*. Add stress: multiple workers, `-count=100`, realistic parallelism.

4. **Shipping the TSan binary to production.** TSan makes programs ~5–15× slower and use far more memory. It belongs in tests and CI, not in the binary you deploy. Build the normal release binary for production; run the instrumented one beforehand.

5. **"Fixing" a race by adding a `sleep` or a print.** Both change the timing and may *hide* the symptom on your machine while leaving the actual race in place — it returns on different hardware. Timing tweaks are not synchronization. Only a mutex/atomic/channel removes the race.

6. **Confusing the three sanitizers.** `-fsanitize=address` (**ASan**) finds *memory* bugs (out-of-bounds, use-after-free). `-fsanitize=undefined` (**UBSan**) finds *undefined behaviour* (overflow, bad shifts). `-fsanitize=thread` (**TSan**) finds *data races*. They overlap little and TSan generally can't be combined with ASan in one build — pick the one matching the bug class you're hunting.

7. **Guarding accesses with *different* locks.** Wrapping the write in `mu1` and the read in `mu2` provides no mutual exclusion between them — they can still overlap. The accesses to one piece of data must all use the *same* lock. TSan's `Mutexes:` lines help you spot this.

---

## Test Yourself

1. State the four conditions that *all* must hold for something to be a data race. Why is "at least one write" in the list — what's safe about two simultaneous reads?
2. Two goroutines both run `counter++` on a shared `counter` with no lock. Explain, step by step, how the final value can end up *less* than the number of increments.
3. Your CI test passes 100 times, then fails once with a wrong value, and you can't reproduce it. What class of bug is this most likely to be, and what one command would you run to find it deterministically?
4. You run `go test -race` and it reports *no* data race. Does that prove your program is race-free? Why or why not?
5. A TSan report shows a "Read at 0x...40 by goroutine 8" and a "Previous write at 0x...40 by goroutine 7." What do the matching addresses tell you, and what are your two standard options to fix it?
6. Why must you never ship a binary built with `-fsanitize=thread` (or `go build -race`) to production?

<details>
<summary>Answers</summary>

1. (a) Two+ threads access the **same memory location**, (b) the accesses are **concurrent / not ordered** (no happens-before), (c) **at least one is a write**, and (d) there's **no synchronization** ordering them. "At least one write" is required because two simultaneous reads don't change anything — the order they happen in can't affect the result, so reading-only is always safe. The danger appears only when a write makes the outcome depend on *when* each access occurred.
2. `counter++` is really *read `counter`, add 1, write `counter` back*. Goroutine A reads `41`; before it writes, goroutine B also reads `41`; A writes `42`; B (still holding the old `41`) writes `42`. Two increments happened but the value only went up by one — one update was lost. Repeated across thousands of iterations, the total falls short.
3. A **data race** (it's nondeterministic, rare, and unreproducible — the classic signature). Run **`go test -race ./...`** (in C/C++, rebuild with `-fsanitize=thread -g` and run) — ideally with a test that exercises the concurrent path, e.g. `go test -race -count=100 -run TestConcurrent`.
4. **No.** TSan is a runtime detector — it only reports races on code that *actually ran* during that test, with the conflicting accesses *actually overlapping*. If the test didn't exercise the concurrent path (e.g. started only one worker), the race is simply unseen. Silence means "no race observed on this run," not "no race exists." Strengthen the test with real concurrency and stress.
5. The **matching addresses** prove both accesses hit the *same memory location* — so this is a genuine conflict on one variable, on two different goroutines, with no synchronization. Fix options: (a) wrap every access in the **same mutex** so they can't overlap, or (b) make the operation **atomic** (`sync/atomic`, `std::atomic`) so it's hardware-indivisible.
6. Because TSan instrumentation makes the program roughly **5–15× slower** and consumes far more memory — unacceptable for production. It's a *testing/CI* tool. You ship the normal uninstrumented release binary and use the instrumented build only to find races beforehand.

</details>

---

## Cheat Sheet

```
WHAT TSAN FINDS
  DATA RACES = 2 threads + same memory + no ordering + >=1 write + no sync

THE FOUR CONDITIONS (all must hold)
  1. same memory location      2. concurrent (no happens-before)
  3. at least one WRITE        4. no mutex/atomic/channel ordering them

TURN IT ON
  C/C++:  clang -fsanitize=thread -g -O1 race.c -o race   (compile AND link)
  Go:     go test  -race ./...        ← the workhorse
          go run   -race main.go
          go build -race -o app .
  stress: go test -race -count=100 -run TestConcurrent

READING A REPORT
  "WARNING: DATA RACE"                      → you have a race
  Read at 0x..A8 by goroutine 8             → access #1 (+ stack = the line)
  Previous write at 0x..A8 by goroutine 7   → access #2 (same addr = same var)
  Mutexes: (C/C++)                          → locks held — spot the wrong/missing one
  → the two stacks are the two colliding lines. Fix those.

THE FIX (pick one)
  mutex   mu.Lock(); shared++; mu.Unlock()     → serialize (use for multi-field updates)
  atomic  atomic.AddInt64(&shared, 1)          → indivisible (use for one counter/flag)
  rule:   all accesses to one datum use the SAME lock

THE ONE GOTCHA
  TSan only sees code that RUNS this run. It does NOT need a wrong answer,
  but it DOES need both threads to actually touch the location → write
  real concurrent / stress tests, or the race stays hidden.

COST & SCOPE
  ~5-15x slower, much more memory → TESTS/CI ONLY, never production.

THE SANITIZER FAMILY
  ASan  (-fsanitize=address)   → memory bugs (OOB, use-after-free)
  UBSan (-fsanitize=undefined) → undefined behaviour (overflow, bad shift)
  TSan  (-fsanitize=thread)    → DATA RACES
```

---

## Summary

- A **data race** is four things at once: two threads, the same memory location, no ordering between them, and at least one write — with **no synchronization**. It's defined by the *missing synchronization*, not by whether a wrong value appeared.
- Races are uniquely evil: **nondeterministic**, **silently corrupting**, **"works on my machine,"** the **worst Heisenbugs**, and in **C/C++ they are undefined behaviour** — the compiler may do literally anything.
- **TSan** is a compiler feature you turn on by *recompiling*: `-fsanitize=thread -g` in C/C++, or `-race` in Go (`go test -race` is the everyday command). It watches memory accesses at runtime and reports races directly.
- A **report** hands you the two colliding accesses — a read and a write at the *same address*, each with a stack trace and the thread that did it (plus held mutexes in C/C++). The two stacks *are* the two lines to fix.
- The **fix** is always to impose an order: a **mutex** (serialize, for multi-field consistency) or an **atomic** (indivisible, for a single counter/flag). When it's correct, **TSan goes silent**.
- TSan's superpower: it flags the race **even when the run produced the right answer** — catching the bug on the lucky runs a flaky test would pass. Its one requirement: the racy path must **actually execute**, so write **real concurrent and stress tests**.
- Cost is **~5–15× slower** and heavy on memory — a **tests/CI** tool, never production. And it's the race specialist of the family: **ASan = memory, UBSan = undefined behaviour, TSan = races.**

The junior recipe in one line: **add the flag, run tests that actually exercise concurrency, read the two stacks, add the missing lock or atomic.**

---

## Further Reading

- [Clang ThreadSanitizer manual](https://clang.llvm.org/docs/ThreadSanitizer.html) — the authoritative C/C++ reference: flags, report format, limitations.
- [Go — "Introducing the Go Race Detector"](https://go.dev/blog/race-detector) — the original Go blog post; short and concrete.
- [Go — Data Race Detector docs](https://go.dev/doc/articles/race_detector) — how `-race` works, what it catches, and how to run it in tests and CI.
- [The Go Memory Model](https://go.dev/ref/mem) — the precise definition of *happens-before* in Go; read once you're comfortable with the basics.
- The [middle.md](middle.md) of this topic, which goes deeper into how TSan works (shadow memory and the happens-before algorithm), suppressions, CI integration, and the kinds of races TSan can and cannot see.

---

## Related Topics

- [01 — AddressSanitizer](../01-address-sanitizer-asan/junior.md) — the sibling sanitizer for *memory* bugs (out-of-bounds, use-after-free); same recompile-and-run model.
- [03 — UndefinedBehaviorSanitizer](../03-undefined-behavior-sanitizer-ubsan/junior.md) — catches *undefined behaviour*; relevant because a C/C++ data race is itself UB.
- [05 — Coverage-Guided Dynamic Analysis](../05-coverage-guided-dynamic-analysis/junior.md) — driving more code paths (and thus more interleavings) so detectors like TSan actually see the bug.
- [06 — Runtime Assertions & Contracts](../06-runtime-assertion-and-contract-checking/junior.md) — the other half of runtime checking: assert your invariants while the program runs.
- [Language Internals → Concurrency](../../../language-internals/concurrency-async-parallel/concurrency/) — the underlying model of threads, goroutines, mutexes, and atomics that races live in.
- [Testing](../../testing/) — where `-race` lives in practice: the test suite and CI that exercise the concurrent paths TSan needs.
