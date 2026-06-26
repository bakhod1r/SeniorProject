# Memory Bugs — Hands-On Tasks

> **Topic:** [Memory Bugs](README.md)

These tasks build the muscle memory of memory debugging: writing leaks on purpose, watching them grow, capturing the right artifact, reading a retention path, and proving a fix with a re-measurement. Work them in a language you operate (Go and Java examples are given; the patterns transfer to Python, C#, Node, and C/C++). The point is not to read about leaks — it's to *make memory climb on your own machine and then make it stop.*

Each task has a **Self-check** list. Hints are folded in; full solutions are given sparsely, only where the mechanism is the lesson.

---

## Table of Contents

- [Warm-Up](#warm-up)
- [Core](#core)
- [Advanced](#advanced)
- [Capstone](#capstone)
- [Self-Assessment](#self-assessment)

---

## Warm-Up

### Task 1 — Make memory climb and watch the floor rise

Write a program with a `static`/global map and a loop that inserts a new entry every iteration with a unique key and a non-trivial value (say a 10 KB byte array). Log live heap usage every second (`runtime.ReadMemStats` → `HeapInuse` in Go; a periodic `Runtime.totalMemory() - freeMemory()` log in Java). Run it and observe.

**Self-check:**
- [ ] I see live heap rising steadily and never returning to baseline.
- [ ] I can explain, in one sentence, why the GC never reclaims those entries.
- [ ] I can point to the exact line that keeps them reachable.

*Hint:* The map is rooted in a static/global, so every value it holds is reachable forever. This is the canonical "rising floor."

### Task 2 — Bound it and prove the floor flattens

Replace the unbounded map from Task 1 with a size-capped LRU (use a library, or a simple `map` + doubly-linked list with a max size). Run the *same* loop and the *same* logging.

**Self-check:**
- [ ] The live heap now rises to a ceiling and *stays flat*.
- [ ] I understand that a bounded cache is not a leak even though memory is "high."
- [ ] I can state the difference between "high memory" and "leaking memory."

### Task 3 — Churn vs. retention by inspection

Write two programs: (A) allocates a 1 MB slice/array in a tight loop and *discards* it each iteration; (B) allocates a 1 MB slice/array each iteration and *appends it to a global list*. Run both with heap logging.

**Self-check:**
- [ ] Program A's live heap stays roughly flat; program B's climbs without bound.
- [ ] I can explain why A is *churn* (high allocation rate, flat live set) and B is *retention* (a leak).
- [ ] I can name which profile I'd use for each (alloc/`alloc_space` for A, heap/`inuse_space` for B).

---

## Core

### Task 4 — Capture and read a heap profile (Go pprof)

Add `net/http/pprof` to the leaking program from Task 1. Under load, capture both `inuse_space` and `alloc_space` profiles. In `go tool pprof`, run `top` and `list <leakingFunc>`.

**Self-check:**
- [ ] `inuse_space` `top` points at the function holding the leaked allocations.
- [ ] `list` shows the exact line responsible.
- [ ] I can articulate why `inuse_space` (not `alloc_space`) is the right profile for a leak.

*Hint:* `go tool pprof http://localhost:6060/debug/pprof/heap` defaults to `inuse_space`. Add `-alloc_space` for the cumulative view.

### Task 5 — Reproduce and fix the Go slice-retention bug

Write a function that reads a large buffer (e.g., 50 MB), finds a small substring/sub-slice, and returns it. Store many such results in a global slice. Watch memory balloon far beyond the size of the retained sub-slices.

**Self-check:**
- [ ] Memory retained is roughly `N × 50 MB`, not `N × (sub-slice size)`.
- [ ] I can explain that the sub-slice pins the entire backing array.
- [ ] After switching to a copy (`out := make([]byte, len(s)); copy(out, s)`), retained memory drops to `N × (sub-slice size)`.

<details>
<summary>Solution sketch</summary>

The leak is `return big[10:30]` — the returned slice shares `big`'s backing array, so the 50 MB stays alive. The fix detaches the small slice:

```go
func extract(big []byte) []byte {
    s := big[10:30]
    out := make([]byte, len(s))
    copy(out, s)
    return out // no longer references big's backing array
}
```

Re-run with the same load and confirm the live heap is two-plus orders of magnitude smaller.
</details>

### Task 6 — Build and detect a goroutine/thread leak

Write a handler that, on each call, starts a goroutine which blocks forever reading from a channel nobody writes to (simulate a timeout path that forgets to clean up). Drive it with many requests. Export `runtime.NumGoroutine()` as a logged metric.

**Self-check:**
- [ ] Goroutine count climbs in lockstep with request count and never falls.
- [ ] Memory climbs even though no single heap object looks huge in a heap profile.
- [ ] The goroutine dump (`/debug/pprof/goroutine?debug=2`) shows thousands parked at the same line.
- [ ] After adding `context` cancellation (`select { case <-ch: case <-ctx.Done(): }`), goroutine count flattens.

*Hint:* This is the war-story leak that hides from heap profiles. The goroutine *count* is the tell.

### Task 7 — The lapsed-listener leak (Java or your OO language)

Create a long-lived publisher (e.g., an `EventBus`) and a loop that creates short-lived subscribers, registers each with the publisher, and then drops its own reference to the subscriber *without unregistering*. Watch the subscribers fail to be collected.

**Self-check:**
- [ ] Subscribers accumulate in the publisher's listener list and are never GC'd.
- [ ] A heap dump shows the publisher dominating a growing list of subscribers.
- [ ] Adding an `unregister()` in the subscriber's teardown fixes it.
- [ ] I can explain how this *inverts* the intended lifetime (short-lived held by long-lived).

---

## Advanced

### Task 8 — Read a dominator tree in Eclipse MAT

Take a heap dump (`jmap -dump:live,format=b,file=heap.hprof <pid>`) of the leaking program from Task 7. Open it in Eclipse MAT. Run **Leak Suspects**, inspect the **dominator tree** sorted by retained size, and use **path to GC roots**.

**Self-check:**
- [ ] I can identify the single top dominator by *retained* (not shallow) size.
- [ ] The path-to-GC-roots names the exact root (static field / thread) anchoring the leak.
- [ ] I can explain why shallow size would have misled me here.
- [ ] I can describe the dump as a one-line bug report: "X dominates Y, rooted by Z."

### Task 9 — Diagnose RSS-vs-live divergence

Construct (or find) a scenario where RSS climbs but the post-GC live heap is flat. The simplest reproducible version: allocate many large off-heap/native buffers (Go: `cgo`/`mmap`; Java: direct `ByteBuffer.allocateDirect`) and hold them. Confirm a heap dump looks clean while RSS climbs.

**Self-check:**
- [ ] My heap dump / `inuse_space` shows a flat, clean managed heap.
- [ ] RSS (`pmap`, `docker stats`, or OS tools) climbs anyway.
- [ ] I can place this scenario in the RSS-vs-live 2×2 (flat live, rising RSS → off-heap/fragmentation).
- [ ] I can name the correct tool (NMT / `pmap` / native profiler) instead of re-reading the heap dump.

*Hint:* The whole point is to *feel* why "the heap dump is clean" does not mean "there's no leak." Believe the 2×2.

### Task 10 — Reduce churn with a pool (and find the lifetime hazard)

Take the churn program from Task 3-A and reduce its allocation rate using a pool (`sync.Pool` in Go, an object pool in Java). Measure allocation rate / GC frequency before and after.

**Self-check:**
- [ ] Allocation rate / GC frequency drops measurably after pooling.
- [ ] The live set stays flat (pooling addresses churn, not retention).
- [ ] I can describe the new hazard: a pooled object used after it's returned to the pool is a correctness bug (aliasing / use-after-return).
- [ ] I can state when pooling is *not* worth the lifetime risk it reintroduces.

### Task 11 — Bisect a leak across versions

Make two builds of a service: an older "good" build and a newer build that adds an unbounded cache. Run each under identical load and compare the memory slopes. Practice correlating the slope's onset with the "deploy."

**Self-check:**
- [ ] The good build's post-GC floor is flat; the bad build's rises.
- [ ] I can quantify the difference as MB/hour (burn rate).
- [ ] I can articulate how, in production, deploy markers on a dashboard let me bisect a slope to a release.
- [ ] I can describe how a feature-flag toggle on a canary would confirm causation.

---

## Capstone

### Task 12 — End-to-end leak hunt with a CI guard

Build a small but realistic service (an HTTP API with a cache, a background worker, and a couple of listeners/goroutines). Deliberately seed it with **two** different leaks of different classes (e.g., one unbounded-cache retention leak and one goroutine leak). Then play the role of the on-call engineer:

1. Run it under sustained, distinct-key load and confirm memory climbs.
2. Read the slope and estimate time-to-OOM against a chosen limit.
3. Classify with the RSS-vs-live + goroutine-count signals.
4. Capture the right artifact for each leak (heap profile for retention; goroutine dump for the goroutine leak).
5. Walk each retention path to its root.
6. Fix both leaks and re-run the *same* load to prove the floor is now flat and goroutine count is stable.
7. Write a **heap-growth CI test** (warm up → GC → drive 100k distinct-key iterations → GC → assert post-GC growth under a tolerance) that would fail on the *unfixed* code and pass on the fixed code.

**Self-check:**
- [ ] I reproduced both leaks under load and saw the climb.
- [ ] I correctly classified each leak before capturing an artifact.
- [ ] I captured the *right* artifact per leak (and didn't heap-dump the goroutine leak in vain).
- [ ] I traced each leak to a GC root and named the exact reference.
- [ ] Both fixes are proven by re-measurement under identical load, not "looks better."
- [ ] My CI test fails on the buggy revision and passes on the fixed one.
- [ ] My CI test does *not* produce false positives from warm-up/init (I warm up and GC before measuring).

<details>
<summary>Solution sketch (CI test shape)</summary>

```go
func TestNoLeakUnderRepeatedLoad(t *testing.T) {
    warmUp()                       // reach steady state: init, pools, caches
    runtime.GC()
    var before runtime.MemStats; runtime.ReadMemStats(&before)
    gBefore := runtime.NumGoroutine()

    for i := 0; i < 100_000; i++ { handle(uniqueRequest(i)) }

    runtime.GC()
    var after runtime.MemStats; runtime.ReadMemStats(&after)
    if int64(after.HeapInuse)-int64(before.HeapInuse) > 8<<20 {
        t.Fatalf("suspected retention leak")
    }
    if runtime.NumGoroutine()-gBefore > 100 {
        t.Fatalf("suspected goroutine leak")
    }
}
```

The test asserts *both* leak SLIs: a flat post-GC heap floor and a stable goroutine count. Warm-up + GC framing avoids flakiness from one-time initialization.
</details>

---

## Self-Assessment

Rate yourself honestly. You've mastered this topic when you can answer "yes" to all of these without notes:

- [ ] I can explain, in one sentence, why a GC'd program leaks, and I always frame a leak hunt as *"what keeps this object alive?"*
- [ ] I can distinguish retention from churn by symptom and choose the right profile (`inuse_space` vs `alloc_space`) without thinking.
- [ ] I can read the RSS-vs-live 2×2 and decide whether to open a heap dump or pivot to native/fragmentation analysis — *before* wasting an hour.
- [ ] I can reproduce the Go slice-retention trap and explain the backing-array pinning, and I know the historical Java `substring` analog.
- [ ] I can detect a goroutine/thread leak via count, capture a goroutine dump, and fix it with cancellation.
- [ ] I can read a dominator tree, sort by retained size, and trace a path to a GC root.
- [ ] I can reproduce a leak only under sustained load and prove a fix by re-measuring under identical load — never by "it looks better."
- [ ] I can write a warm-up-aware heap-growth CI test that catches a leak before it reaches production.
- [ ] I understand that restarts, raised limits, and `System.gc()` are tourniquets, not cures, and I can explain why a forced GC failing to free memory is itself diagnostic.

If any box is unchecked, return to the corresponding task and *make the memory climb on your own machine* — reading about leaks is not the same as having caused and killed one.
