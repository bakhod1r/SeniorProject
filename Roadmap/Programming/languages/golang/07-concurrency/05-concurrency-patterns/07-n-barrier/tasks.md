# N-Barrier — Tasks

A graded set of exercises, from "see a barrier release together" through "build a dissemination barrier." Each task lists requirements, hints, and a self-check. Solutions are not given — write and run them yourself, always with `-race` and `GOMAXPROCS` greater than 1.

## Table of Contents
1. [Task 1: One-Shot Barrier](#task-1-one-shot-barrier)
2. [Task 2: Prove It Releases Together](#task-2-prove-it-releases-together)
3. [Task 3: Reusable Barrier with Generation Counter](#task-3-reusable-barrier-with-generation-counter)
4. [Task 4: Channel-Based Barrier](#task-4-channel-based-barrier)
5. [Task 5: Two-Phase Parallel Sum](#task-5-two-phase-parallel-sum)
6. [Task 6: Lockstep Game of Life](#task-6-lockstep-game-of-life)
7. [Task 7: Context-Aware / Abortable Barrier](#task-7-context-aware--abortable-barrier)
8. [Task 8: Sense-Reversing Barrier](#task-8-sense-reversing-barrier)
9. [Task 9: errgroup-Per-Phase Refactor](#task-9-errgroup-per-phase-refactor)
10. [Task 10: Dissemination Barrier](#task-10-dissemination-barrier)
11. [Task 11: Benchmarks](#task-11-benchmarks)

---

## Task 1: One-Shot Barrier

**Goal.** Build a `Barrier` with `NewBarrier(n int)` and `Wait()` using `sync.Mutex` + `sync.Cond`. Usable for exactly one trip.

**Requirements.**
- N parties call `Wait()`; none returns until all N have arrived.
- The last party `Broadcast()`s and returns without sleeping.
- `cond.Wait()` is inside a `for` loop.

**Hints.** Guard a `count` with the mutex. Predicate: `count < n`.

**Acceptance criteria.**
- A test with N=8 goroutines confirms all print "phase 1" before any prints "phase 2".
- Passes `go test -race`.
- Replacing the `for` loop with an `if` and running under load eventually misbehaves (observe why).

---

## Task 2: Prove It Releases Together

**Goal.** Write a test (no new barrier code) that *fails* if the barrier releases anyone early.

**Requirements.**
- Use an atomic counter `stillArriving` initialised to N; each party decrements it before `Wait()`.
- After `Wait()`, assert `stillArriving == 0`.
- Guard the join with a 2-second timeout so a deadlock fails fast instead of hanging.

**Acceptance criteria.**
- The test passes for a correct barrier.
- Deliberately breaking the barrier (e.g., release after N-1) makes the test fail, not hang.

---

## Task 3: Reusable Barrier with Generation Counter

**Goal.** Build `Cyclic` that survives many trips.

**Requirements.**
- Add a `generation uint64`. Waiters capture `gen := generation`, then `for gen == generation { cond.Wait() }`.
- The last party increments `generation`, resets `count = 0`, and broadcasts — all under the lock.

**Hints.** The whole fix is "wait for the generation to *change*", not "count to reach N".

**Acceptance criteria.**
- N=4 workers each loop through 1000 phases calling `Wait()`; the program terminates (no deadlock) under `-race`.
- A test tracks the maximum number of parties simultaneously "between the same two trips" and asserts it never exceeds N.

---

## Task 4: Channel-Based Barrier

**Goal.** Reimplement the reusable barrier with **no `sync.Cond`** — use close-to-broadcast.

**Requirements.**
- A `gate chan struct{}`. The Nth party `close()`s it and installs a fresh one.
- Each waiter captures *its* generation's gate under the lock, unlocks, then blocks on `<-gate`.

**Hints.** Capturing the gate *before* unlocking is the whole correctness argument — it pins the waiter to the right generation.

**Acceptance criteria.**
- Behaves identically to Task 3 across 1000 phases, N=4, under `-race`.
- Add a `select { case <-gate: case <-ctx.Done(): }` variant and confirm cancellation releases waiters.

---

## Task 5: Two-Phase Parallel Sum

**Goal.** Use a barrier to compute a sum in two phases.

**Requirements.**
- Phase 1: N workers each sum their own slice shard into `partial[id]`.
- Barrier.
- Phase 2: worker 0 folds `partial` into a total.

**Acceptance criteria.**
- Total matches a sequential sum for several random inputs.
- Removing the barrier and running under `-race` reports a data race (observe it).

---

## Task 6: Lockstep Game of Life

**Goal.** Parallelise one cellular automaton with a barrier.

**Requirements.**
- N workers own row-bands of the grid.
- Per tick: compute `next` from `cur` (phase 1), barrier, swap buffers (phase 2), barrier.
- Run a known pattern (e.g., a blinker) for several ticks and verify the output matches a single-threaded reference.

**Hints.** Two barriers per tick. The second barrier makes the swap visible before the next read phase.

**Acceptance criteria.**
- Parallel output equals sequential output bit-for-bit for 10 ticks.
- Dropping the second barrier produces a `-race` report and/or wrong output.

---

## Task 7: Context-Aware / Abortable Barrier

**Goal.** Make a barrier that never deadlocks on failure.

**Requirements.**
- `Wait(ctx context.Context) error` returns `ErrBroken` if any party aborts or `ctx` is cancelled.
- An `Abort()` method breaks the current generation and broadcasts.
- Use `context.AfterFunc` to bridge cancellation into the `Cond` wait.

**Acceptance criteria.**
- A test where one of N parties cancels the context: all other parties return `ErrBroken` within a deadline (no hang).
- A test where one party panics: a `defer`-`recover` calls `Abort()`, peers return `ErrBroken`.

---

## Task 8: Sense-Reversing Barrier

**Goal.** Build a reusable barrier using a flip-flop sense bit instead of a generation counter.

**Requirements.**
- Per-goroutine `localSense bool`; flip it on each `Wait`.
- The last party sets `globalSense = localSense`, resets `count`, broadcasts.
- Waiters: `for globalSense != localSense { cond.Wait() }`.

**Acceptance criteria.**
- Equivalent behaviour to Task 3 over 1000 phases under `-race`.
- Explain in a comment why the sense bit cannot "overflow" the way a counter conceptually could.

---

## Task 9: errgroup-Per-Phase Refactor

**Goal.** Show the idiomatic alternative.

**Requirements.**
- Take the Task 6 simulation and re-implement phased execution by re-spawning workers each tick inside `errgroup.WithContext`, with `g.Wait()` as the phase boundary.
- Make one worker return an error mid-run and confirm the whole run cancels and returns that error.

**Acceptance criteria.**
- Same simulation output as Task 6 for the happy path.
- An injected error cancels the run and is returned (with phase context wrapped in).
- Write a short note comparing this to Task 6: when is the barrier worth keeping?

---

## Task 10: Dissemination Barrier

**Goal.** Implement an O(log N) barrier with no central lock (power-of-two N).

**Requirements.**
- `rounds = log2(N)`. In round `r`, party `i` signals party `(i + 2^r) mod N` and waits for `(i - 2^r) mod N`.
- Use per-(party, round) one-shot signals; reset for the next trip (a second set of flags or a sense bit per round).

**Hints.** This is hard. Start with N=4 (2 rounds). Draw the partner graph before coding.

**Acceptance criteria.**
- Correct lockstep for N ∈ {2, 4, 8, 16} over many trips under `-race`.
- A benchmark shows lower per-trip latency than the centralised barrier at N=16 (see Task 11).

---

## Task 11: Benchmarks

**Goal.** Measure barrier cost vs N and vs design.

**Requirements.**
- Benchmark `Cyclic`, the channel barrier, the sense-reversing barrier, and (if done) the dissemination barrier.
- For each, measure per-trip latency at N ∈ {2, 4, 16, 64, 256} (use `b.N` trips, `runtime.GOMAXPROCS(0)` parties or fixed N).
- Run with `-benchmem` and `-cpuprofile`.

**Acceptance criteria.**
- A table of ns/trip per design per N.
- The centralised `Cond` barrier shows super-linear growth in N; the dissemination barrier stays near-flat.
- A one-paragraph interpretation: at what N does it stop making sense to use the centralised barrier on your hardware?

---

## Stretch Goals

- Add a **phase action** (run once by the last party, under the lock) to the cyclic barrier and use it for the Game-of-Life swap (eliminating the `if id == 0` and the second barrier — be careful about visibility).
- Add a **watchdog** that, if a trip hasn't completed within a deadline, logs which party indices have not arrived (instrument arrivals).
- Build a **tree (combining) barrier** and compare its latency curve to the dissemination barrier.
- Implement a **distributed double-barrier** over etcd or a local Redis using leases, and test it with a simulated node that never arrives (the lease should let survivors make progress or fail explicitly).
