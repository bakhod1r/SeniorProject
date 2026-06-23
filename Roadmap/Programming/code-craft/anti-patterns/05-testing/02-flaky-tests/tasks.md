# Flaky Tests — Exercises

> **Category:** [Testing Anti-Patterns](../README.md) → **Flaky Tests** — *hands-on practice making non-deterministic tests deterministic.*
> **Also known as:** non-deterministic tests · intermittent tests · heisentests

---

These are **fix-it** exercises. Each gives a flaky test (or a flaky design), the cause to identify, acceptance criteria, and a worked solution. The point is to *make the change* — replace a sleep with a condition wait, inject a fake clock, isolate an order-dependent pair, seed an RNG — and end up with a test that's deterministic *and* fast.

> **How to use this file:** read the flaky code, name the cause from the seven (`middle.md`), write the fix *yourself*, then compare. The "why it's deterministic now" note matters more than the diff — you're training the instinct to *control the input* rather than gamble on it.

---

## Table of Contents

| # | Exercise | Cause | Lang | Difficulty |
|---|---|---|---|---|
| 1 | [Replace the sleep with a condition wait](#exercise-1--replace-the-sleep-with-a-condition-wait) | Timing | Go | ★ easy |
| 2 | [Inject a fake clock to kill a time flake](#exercise-2--inject-a-fake-clock-to-kill-a-time-flake) | Real clock | Python | ★★ medium |
| 3 | [Seed the RNG-driven test](#exercise-3--seed-the-rng-driven-test) | Randomness | Go | ★ easy |
| 4 | [Fix the order-dependent pair](#exercise-4--fix-the-order-dependent-pair) | Shared state | Java | ★★ medium |
| 5 | [Kill the map-iteration-order flake](#exercise-5--kill-the-map-iteration-order-flake) | Ordering | Go | ★ easy |
| 6 | [Synchronize on a signal instead of polling-by-sleep](#exercise-6--synchronize-on-a-signal-instead-of-polling-by-sleep) | Async race | Python | ★★ medium |
| 7 | [Deterministic backoff with simulated time](#exercise-7--deterministic-backoff-with-simulated-time) | Time + schedule | Python | ★★★ hard |

---

## Exercise 1 — Replace the sleep with a condition wait

**Cause:** Timing · **Language:** Go · **Difficulty:** ★ easy

This test passes locally but fails ~1 run in 30 on CI. Make it deterministic *and* fast.

```go
// Worker processes enqueued jobs on a background goroutine.
// w.Processed() returns how many have completed so far.
func TestWorker_ProcessesAll(t *testing.T) {
    w := StartWorker()
    for i := 0; i < 5; i++ {
        w.Enqueue(Job{ID: i})
    }
    time.Sleep(50 * time.Millisecond)   // "should be enough"
    if got := w.Processed(); got != 5 {
        t.Fatalf("want 5 processed, got %d", got)
    }
}
```

**Acceptance criteria**
- No `time.Sleep` racing the work.
- The test returns as soon as all 5 jobs are processed (fast on a fast machine).
- It fails cleanly with a useful message only if the work genuinely never completes.

**Hint:** wait for the *condition* `w.Processed() == 5` with a generous timeout backstop; poll on a tiny interval.

<details>
<summary>Solution</summary>

```go
func waitFor(t *testing.T, cond func() bool, timeout time.Duration) {
    t.Helper()
    deadline := time.Now().Add(timeout)
    for time.Now().Before(deadline) {
        if cond() {
            return
        }
        time.Sleep(time.Millisecond)        // poll interval, not the whole wait
    }
    t.Fatalf("condition not met within %s", timeout)
}

func TestWorker_ProcessesAll(t *testing.T) {
    w := StartWorker()
    for i := 0; i < 5; i++ {
        w.Enqueue(Job{ID: i})
    }
    waitFor(t, func() bool { return w.Processed() == 5 }, 2*time.Second)
}
```

**Why it's deterministic now:** the `2s` is a *failure backstop*, not a timing guess. If the work finishes in 4ms the test takes ~4ms; if loaded CI takes 90ms the test takes 90ms and *passes* (no 50ms wall to lose to). It only fails if the count is *never* 5 — a real bug, reported clearly. Slow-and-flaky became fast-and-deterministic.

</details>

---

## Exercise 2 — Inject a fake clock to kill a time flake

**Cause:** Real clock · **Language:** Python · **Difficulty:** ★★ medium

This test fails intermittently when the machine is busy (a GC pause or scheduler delay pushes it past the 1-second window). The production code reads the wall clock directly. Make the test deterministic.

```python
from datetime import datetime, timedelta, timezone

class Session:
    def __init__(self, ttl_seconds):
        self.created_at = datetime.now(timezone.utc)   # reads the real clock
        self.ttl = timedelta(seconds=ttl_seconds)

    def is_expired(self):
        return datetime.now(timezone.utc) > self.created_at + self.ttl

# FLAKY test
def test_session_not_expired_then_expired():
    s = Session(ttl_seconds=1)
    assert not s.is_expired()          # flaky: fails if >1s elapses before this line
    time.sleep(1.1)
    assert s.is_expired()              # also slow: a real 1.1s wait
```

**Acceptance criteria**
- `Session` no longer reads the wall clock directly — the clock is injected.
- The test controls time explicitly; no `time.sleep`, no real waiting.
- The boundary (just-before vs just-after expiry) is tested deterministically.

**Hint:** introduce a `Clock` dependency with `now()`; pass a `FakeClock` in the test and `advance()` it.

<details>
<summary>Solution</summary>

```python
from datetime import datetime, timedelta, timezone

class Clock:                                   # production
    def now(self): return datetime.now(timezone.utc)

class FakeClock:                               # tests
    def __init__(self, start): self._t = start
    def now(self): return self._t
    def advance(self, delta): self._t += delta

class Session:
    def __init__(self, ttl_seconds, clock):
        self.clock = clock
        self.created_at = clock.now()          # "now" is whatever the clock says
        self.ttl = timedelta(seconds=ttl_seconds)

    def is_expired(self):
        return self.clock.now() > self.created_at + self.ttl

def test_session_expiry_boundary():
    clock = FakeClock(datetime(2026, 1, 1, tzinfo=timezone.utc))
    s = Session(ttl_seconds=1, clock=clock)

    assert not s.is_expired()                  # at t=0, well inside TTL
    clock.advance(timedelta(seconds=1))        # exactly at the boundary
    assert not s.is_expired()                  # ">" not ">=" → not yet expired
    clock.advance(timedelta(milliseconds=1))   # one tick past
    assert s.is_expired()                      # deterministic, zero real waiting
```

**Why it's deterministic now:** the test owns time. There's no race against the wall clock and no real `sleep`, so a busy machine can't push it past a window — there is no window, only the logical time the test sets. As a bonus it's instant *and* it tests the exact boundary (`>` vs `>=`) precisely, which the sleep-based version couldn't.

</details>

---

## Exercise 3 — Seed the RNG-driven test

**Cause:** Randomness · **Language:** Go · **Difficulty:** ★ easy

This test occasionally fails and nobody can reproduce it — each run uses different random data. Make failures reproducible without removing the randomized input.

```go
// Shuffle then sort; verify Sort produces a sorted slice for varied inputs.
func TestSort_RandomInput(t *testing.T) {
    data := sequential(1000)                 // [0,1,2,...,999]
    rand.Shuffle(len(data), func(i, j int) { // uses the global, time-seeded source
        data[i], data[j] = data[j], data[i]
    })
    got := Sort(data)
    if !isSorted(got) {
        t.Fatalf("Sort produced unsorted output")  // ~irreproducible when it happens
    }
}
```

**Acceptance criteria**
- The "random" input is identical on every run (a failure reproduces every time).
- The test does not seed or mutate the *global* RNG (so it can't leak into other tests).

**Hint:** create a *local* `*rand.Rand` with a fixed seed and use it for the shuffle.

<details>
<summary>Solution</summary>

```go
func TestSort_RandomInput(t *testing.T) {
    rng := rand.New(rand.NewSource(42))      // local, fixed seed — reproducible & isolated
    data := sequential(1000)
    rng.Shuffle(len(data), func(i, j int) {
        data[i], data[j] = data[j], data[i]
    })
    got := Sort(data)
    if !isSorted(got) {
        t.Fatalf("Sort produced unsorted output for seed 42")
    }
}
```

**Why it's deterministic now:** the input is a pure function of the seed, so if `Sort` has a bug that this arrangement trips, the test fails *every* run — reproducible, debuggable. Using a *local* `rng` (not `rand.Seed(...)` on the global) means it can't leak into sibling tests and create a shared-state flake. To widen coverage deliberately, loop over several fixed seeds (`for _, s := range []int64{1,2,3}`) — still fully reproducible.

> If you *want* varied input across runs, generate the seed, **log it**, and re-run with the logged seed on failure — that keeps reproducibility. The flake is unlogged randomness, not randomness itself.

</details>

---

## Exercise 4 — Fix the order-dependent pair

**Cause:** Shared state · **Language:** Java (JUnit 5) · **Difficulty:** ★★ medium

These two tests pass when run in one order and fail in the other. Under randomized method order, the suite is flaky. Fix it.

```java
// Production: a process-wide registry (a static field).
class FeatureRegistry {
    static final Map<String, Boolean> FLAGS = new HashMap<>();
}

class FeatureTests {
    @Test
    void betaEnabledUsesNewPath() {
        FeatureRegistry.FLAGS.put("beta", true);
        assertTrue(new Service().run().usedBeta());
    }

    @Test
    void defaultIsOldPath() {
        // if betaEnabledUsesNewPath ran first, FLAGS still has beta=true → FAILS
        assertFalse(new Service().run().usedBeta());
    }
}
```

**Acceptance criteria**
- The result is independent of test execution order.
- State written by one test cannot leak into another.
- Bonus: argue why a constructor-injected design would be even better than resetting a global.

<details>
<summary>Solution</summary>

**Minimal fix — reset the shared state in teardown (runs even on failure):**

```java
class FeatureTests {
    @AfterEach
    void clearFlags() {
        FeatureRegistry.FLAGS.clear();      // every test starts from a clean registry
    }

    @Test
    void betaEnabledUsesNewPath() {
        FeatureRegistry.FLAGS.put("beta", true);
        assertTrue(new Service().run().usedBeta());
    }

    @Test
    void defaultIsOldPath() {
        assertFalse(new Service().run().usedBeta());   // now order-independent
    }
}
```

**Better fix — remove the global so there's nothing to leak:**

```java
// Service takes its flags as a dependency instead of reading a static registry.
class Service {
    private final Map<String, Boolean> flags;
    Service(Map<String, Boolean> flags) { this.flags = flags; }
    Result run() { /* uses this.flags, not a global */ }
}

class FeatureTests {
    @Test
    void betaEnabledUsesNewPath() {
        var svc = new Service(Map.of("beta", true));   // fresh, local state
        assertTrue(svc.run().usedBeta());
    }
    @Test
    void defaultIsOldPath() {
        var svc = new Service(Map.of());               // independent by construction
        assertFalse(svc.run().usedBeta());
    }
}
```

**Why it's deterministic now:** the `@AfterEach` version guarantees each test starts from an empty registry regardless of order, because teardown runs after every test (including failures). The *injected* version is strictly better — there's **no shared mutable global at all**, so leakage is structurally impossible, the tests are trivially parallel-safe, and you've also improved the production design's testability. Verify with randomized order (JUnit `@TestMethodOrder(MethodOrderer.Random.class)` or the runner's shuffle): both versions stay green in every order.

</details>

---

## Exercise 5 — Kill the map-iteration-order flake

**Cause:** Ordering · **Language:** Go · **Difficulty:** ★ easy

This test passes most of the time and fails about one run in three. Diagnose and fix.

```go
func TestCollectKeys(t *testing.T) {
    counts := map[string]int{"alpha": 1, "beta": 2, "gamma": 3}
    var keys []string
    for k := range counts {            // map iteration order is randomized in Go
        keys = append(keys, k)
    }
    if !reflect.DeepEqual(keys, []string{"alpha", "beta", "gamma"}) {
        t.Fatalf("got %v", keys)        // fails whenever iteration order differs
    }
}
```

**Acceptance criteria**
- The assertion no longer depends on map iteration order.
- It still verifies the same thing: exactly those three keys are present.

<details>
<summary>Solution</summary>

```go
func TestCollectKeys(t *testing.T) {
    counts := map[string]int{"alpha": 1, "beta": 2, "gamma": 3}
    var keys []string
    for k := range counts {
        keys = append(keys, k)
    }
    sort.Strings(keys)                                          // impose a deterministic order
    want := []string{"alpha", "beta", "gamma"}
    if !reflect.DeepEqual(keys, want) {
        t.Fatalf("got %v, want %v", keys, want)
    }
    // Alternatively, with testify (order-agnostic):
    // require.ElementsMatch(t, []string{"alpha","beta","gamma"}, keys)
}
```

**Why it's deterministic now:** Go *deliberately* randomizes map iteration order so code can't depend on it. The fix is to remove order from the assertion — either `sort` both sides into a canonical order, or compare as an unordered set (`ElementsMatch`). The test now verifies *membership* (the real intent) rather than an accidental order the map never promised.

</details>

---

## Exercise 6 — Synchronize on a signal instead of polling-by-sleep

**Cause:** Async race · **Language:** Python · **Difficulty:** ★★ medium

The code invokes a callback when an async download finishes. The test sleeps and hopes. Make it block on the actual completion signal.

```python
def test_fetch_invokes_callback():
    result = {}
    fetcher.fetch(url, on_done=lambda data: result.update(payload=data))
    time.sleep(0.2)                          # did the callback fire? maybe.
    assert result["payload"] == EXPECTED     # KeyError if not — flaky AND slow
```

**Acceptance criteria**
- No `sleep` racing the callback.
- The test blocks until the callback fires, then asserts; it returns as soon as the work is done.
- A genuine never-fires bug fails with a clear message, not a `KeyError`.

**Hint:** a `threading.Event` the callback `.set()`s, and `.wait(timeout=...)` as the backstop.

<details>
<summary>Solution</summary>

```python
import threading

def test_fetch_invokes_callback():
    done = threading.Event()
    box = {}

    def on_done(data):
        box["payload"] = data
        done.set()                           # signal completion

    fetcher.fetch(url, on_done=on_done)

    assert done.wait(timeout=2), "callback never fired within 2s"   # blocks, then backstop
    assert box["payload"] == EXPECTED
```

**Why it's deterministic now:** the test blocks on the *exact event* it cares about (the callback firing), so it can't race a fixed duration — it proceeds the instant the callback runs, however long that takes, and fails with a clear message only if it *never* fires. No `KeyError` from asserting on data that hasn't arrived, and no wasted 0.2s on the fast path. (In Go this is a channel + `select`; in Java a `CountDownLatch` + `await`.)

> Run async tests like this under stress (`pytest --count=200`) and, where the language supports it, a race detector — to confirm the synchronization is real and not just usually-in-time.

</details>

---

## Exercise 7 — Deterministic backoff with simulated time

**Cause:** Time + schedule · **Language:** Python · **Difficulty:** ★★★ hard

A client retries a failing request with exponential backoff (1s, 2s, 4s). Tested against the real clock it's both flaky and takes 7 real seconds. Make it deterministic and instant using a simulated clock the test drives.

```python
# Production client schedules retries with real time.sleep — untestable fast.
class Client:
    def __init__(self, retries=3, base=1.0):
        self.retries, self.base, self.attempts = retries, base, 0

    def send(self, request):
        for i in range(self.retries + 1):
            self.attempts += 1
            if request():                    # returns True on success
                return True
            if i < self.retries:
                time.sleep(self.base * (2 ** i))   # 1s, 2s, 4s — REAL waits
        return False
```

**Acceptance criteria**
- The test runs in well under a second (no real `sleep`).
- It deterministically asserts the *number of attempts* and the *exact backoff schedule* (the logical times retries fire).
- Production code takes the scheduler/clock as a dependency.

**Hint:** inject a `SimClock` with `call_later(delay, fn)` and an `advance_to_idle()` that fires queued timers in time order; restructure `send` to schedule its next attempt instead of sleeping.

<details>
<summary>Solution</summary>

```python
import heapq, itertools

class SimClock:
    def __init__(self):
        self.now = 0.0
        self._q = []                          # min-heap of (fire_time, seq, fn)
        self._seq = itertools.count()
    def call_later(self, delay, fn):
        heapq.heappush(self._q, (self.now + delay, next(self._seq), fn))
    def advance_to_idle(self):
        while self._q:
            t, _, fn = heapq.heappop(self._q)
            self.now = t                      # logical time jumps to the next event
            fn()                              # one event at a time → deterministic

class Client:
    def __init__(self, clock, retries=3, base=1.0):
        self.clock, self.retries, self.base = clock, retries, base
        self.attempts, self.fired_at, self.result = 0, [], None

    def send(self, request):
        def attempt(i):
            self.attempts += 1
            self.fired_at.append(self.clock.now)
            if request():
                self.result = True
                return
            if i < self.retries:
                self.clock.call_later(self.base * (2 ** i), lambda: attempt(i + 1))
            else:
                self.result = False
        attempt(0)                            # schedule the first attempt now

def test_backoff_schedule_all_fail():
    clock = SimClock()
    client = Client(clock, retries=3, base=1.0)
    client.send(lambda: False)                # always fails → exhausts retries
    clock.advance_to_idle()                   # run the whole sequence instantly

    assert client.attempts == 4               # initial + 3 retries
    assert client.fired_at == [0, 1, 3, 7]    # logical times: 0, +1, +2, +4
    assert client.result is False

def test_succeeds_on_second_attempt():
    clock = SimClock()
    client = Client(clock, retries=3, base=1.0)
    calls = iter([False, True])               # fail, then succeed
    client.send(lambda: next(calls))
    clock.advance_to_idle()

    assert client.attempts == 2
    assert client.fired_at == [0, 1]          # first at t=0, retry at t=1
    assert client.result is True
```

**Why it's deterministic now:** time is *logical* — `advance_to_idle()` fires every scheduled retry in time order, instantly, so the test runs in microseconds instead of 7 real seconds and the schedule (`[0,1,3,7]`) is exact and identical every run. The non-determinism (real wall-clock delays, scheduler jitter) is gone because the test *owns* the clock and the event queue. This is the same technique behind Reactor's `VirtualTimeScheduler` and RxJava's `TestScheduler` — see `professional.md`.

</details>

---

## Related Topics

- [`junior.md`](junior.md) — what flaky is and why "just re-run it" is poison.
- [`middle.md`](middle.md) — the seven causes and the worked fix for each (the cures these exercises drill).
- [`find-bug.md`](find-bug.md) — name the non-determinism source in a snippet.
- [`optimize.md`](optimize.md) — take a flaky *and* slow test and make it deterministic *and* fast.
- [Testing Anti-Patterns → Slow Tests](../05-slow-tests/tasks.md) — speeding up tests; the fake-clock and fake-dependency moves overlap.
- [Concurrency Anti-Patterns → Shared State](../../03-concurrency/03-shared-state/senior.md) — the production races behind Exercises 4 and 6.
