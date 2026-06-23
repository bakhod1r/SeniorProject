# Flaky Tests — Optimization Practice

> **Category:** [Testing Anti-Patterns](../README.md) → **Flaky Tests** — *making a non-deterministic, slow test both deterministic and fast.*
> **Also known as:** non-deterministic tests · intermittent tests · heisentests

---

Flakiness and slowness usually share a root cause: **`sleep`-based waits and real external dependencies.** A `sleep` is slow *and* races the work; a real network/DB call is slow *and* inherits the outside world's non-determinism. So the same refactor that kills the flake usually also makes the test fast — you get both for one change.

Each exercise here gives a **flaky *and* slow** test, a measured "before," a target, and a worked "after" that is **deterministic *and* fast**. Unlike [`find-bug.md`](find-bug.md) (name the cause) and [`tasks.md`](tasks.md) (single-cause drills), these are *end-to-end transformations* of a realistic test through every flake-and-slowness source at once.

> **How to use this file:** read the "Before," predict *both* its flakiness sources *and* where its wall-clock time goes, sketch the "After" yourself, then compare. The win is a test that's reliable on the worst CI box *and* runs in milliseconds.

---

## Table of Contents

1. [Case 1 — The integration test from hell](#case-1--the-integration-test-from-hell)
2. [Case 2 — The polling job test](#case-2--the-polling-job-test)
3. [Case 3 — The "send reminder after 24h" test](#case-3--the-send-reminder-after-24h-test)
4. [Principles that recur](#principles-that-recur)
5. [Related Topics](#related-topics)

---

## Case 1 — The integration test from hell

This one test combines *four* of the seven causes: a real HTTP call, a real `sleep`, unseeded randomness, and a real-clock dependency. It takes ~2.3s and fails ~5% of CI runs.

### Before

```python
import time, random, requests
from datetime import datetime

# Production: a checkout flow that calls a payment API and records a timestamp.
class Checkout:
    def pay(self, cart):
        order_id = f"ord-{random.randint(0, 999999)}"      # unseeded randomness
        resp = requests.post("https://pay.example.com/charge",   # real network
                             json={"amount": cart.total, "order": order_id})
        return {
            "order_id": order_id,
            "status": resp.json()["status"],
            "paid_at": datetime.utcnow().isoformat(),       # real clock
        }

# FLAKY + SLOW test
def test_checkout_pays():
    cart = Cart(total=100)
    result = Checkout().pay(cart)
    time.sleep(2)                                            # "let the webhook settle"
    assert result["status"] == "ok"
    assert result["order_id"].startswith("ord-")
    assert result["paid_at"] is not None
```

**Why it's slow:** the `sleep(2)` alone is 2 seconds every run; the real HTTP round-trip adds 100–400ms. **~2.3s per run.**

**Why it's flaky:**
1. **External dependency** — the real `pay.example.com` call: down, slow, rate-limited, or offline-in-CI → red.
2. **Timing** — the `sleep(2)` races whatever "settling" it imagines; too short under load, always wasteful.
3. **Randomness** — `order_id` is unseeded, so you can't assert anything precise about it and failures aren't reproducible.
4. **Real clock** — `paid_at` reads `datetime.utcnow()`, so the value differs every run and can't be asserted exactly.

### Target

- No real network, no `sleep`, deterministic `order_id` and `paid_at`.
- Runs in **single-digit milliseconds**, passes on the worst CI box every time.
- Asserts *exactly* what the code produced, including the request it sent.

### After

The fix is the same move four times: **inject every uncontrolled input.** The payment client, the ID generator, and the clock all become dependencies; the `sleep` is deleted because there's nothing real to wait for.

```python
from datetime import datetime, timezone

class Checkout:
    def __init__(self, payments, ids, clock):    # inject the three uncontrolled inputs
        self.payments, self.ids, self.clock = payments, ids, clock

    def pay(self, cart):
        order_id = self.ids.next()               # deterministic in tests
        status = self.payments.charge(cart.total, order_id)   # faked in tests
        return {
            "order_id": order_id,
            "status": status,
            "paid_at": self.clock.now().isoformat(),          # fixed in tests
        }

# --- test doubles ---
class FakePayments:
    def __init__(self, status="ok"): self.status, self.calls = status, []
    def charge(self, amount, order_id):
        self.calls.append((amount, order_id))    # record for assertion
        return self.status                       # instant, deterministic

class SeqIds:
    def __init__(self): self.n = 0
    def next(self):
        self.n += 1
        return f"ord-{self.n:06d}"

class FixedClock:
    def __init__(self, t): self.t = t
    def now(self): return self.t

# --- the test: deterministic AND fast ---
def test_checkout_pays():
    payments = FakePayments(status="ok")
    clock = FixedClock(datetime(2026, 6, 15, 12, 0, tzinfo=timezone.utc))
    checkout = Checkout(payments, SeqIds(), clock)

    result = checkout.pay(Cart(total=100))       # no network, no sleep

    assert result == {
        "order_id": "ord-000001",                # exact: deterministic ID
        "status": "ok",
        "paid_at": "2026-06-15T12:00:00+00:00",  # exact: fixed clock
    }
    assert payments.calls == [(100, "ord-000001")]   # asserts the charge it issued
```

**Result:** ~2.3s → **<5ms**, 5% flake → **0%**. Every uncontrolled input (network, time, IDs, the imagined "settling") is now controlled, so the test is a pure function of `Checkout`'s logic — which is also *exactly* what a unit test should verify. Keep a *separate*, clearly-labeled integration test that hits a sandbox payment API if you genuinely need to verify the real wire contract.

---

## Case 2 — The polling job test

A background worker drains a queue. The test enqueues, sleeps, and checks — slow because the sleep is sized for the worst case, flaky because the worst case is sometimes worse.

### Before

```go
// Go — worker drains a queue on a goroutine; test sleeps then checks.
func TestWorker_DrainsQueue(t *testing.T) {
    w := StartWorker()
    for i := 0; i < 100; i++ {
        w.Enqueue(Task{ID: i})
    }
    time.Sleep(500 * time.Millisecond)     // sized for "slow CI"
    if w.Remaining() != 0 {
        t.Fatalf("queue not drained: %d left", w.Remaining())
    }
}
```

**Slow:** 500ms every run, even though draining 100 tasks takes ~3ms on a normal machine — the test is **160× slower than the work**. **Flaky:** on a genuinely loaded box, draining 100 tasks occasionally exceeds 500ms → red. The sleep is both too long (usually) and too short (sometimes) — the signature of a timing flake.

### Target

- Return as soon as the queue is actually drained (fast).
- A *generous* backstop so it only fails if draining genuinely stalls.
- No fixed-duration race.

### After

```go
func waitFor(t *testing.T, cond func() bool, timeout time.Duration) {
    t.Helper()
    deadline := time.Now().Add(timeout)
    for time.Now().Before(deadline) {
        if cond() {
            return
        }
        time.Sleep(time.Millisecond)        // poll interval, not the wait
    }
    t.Fatalf("condition not met within %s", timeout)
}

func TestWorker_DrainsQueue(t *testing.T) {
    w := StartWorker()
    for i := 0; i < 100; i++ {
        w.Enqueue(Task{ID: i})
    }
    waitFor(t, func() bool { return w.Remaining() == 0 }, 5*time.Second)
}
```

**Result:** typically **~3–5ms** (returns the instant the queue empties) instead of a flat 500ms, and the `5s` backstop is so far above normal that a loaded box still passes — it only fails if draining *truly* stalls, which is a real bug. **Faster on the common path, more reliable on the slow path** — the opposite of the sleep's trade-off.

> If the worker exposes a "drained" channel or callback, synchronize on *that* instead of polling `Remaining()` — strongest of all, zero timing dependence (see `middle.md`, Cause 2).

---

## Case 3 — The "send reminder after 24h" test

Some logic is *about* a long delay. Testing it against the real clock is absurd (you'd wait a day) or flaky (a shortened delay races the test). The fake clock makes a 24-hour rule testable in microseconds.

### Before

```java
// Java — a reminder service that fires 24h after signup.
class ReminderService {
    void onSignup(User u) {
        scheduler.schedule(() -> email.sendReminder(u),
                           Duration.ofHours(24));     // real scheduled delay
    }
}

// FLAKY + ABSURDLY SLOW attempt
@Test
void sendsReminderAfter24h() throws InterruptedException {
    var service = new ReminderService(realScheduler, email);
    service.onSignup(user);
    Thread.sleep(Duration.ofHours(24).toMillis());    // ...waits a real day. no.
    verify(email).sendReminder(user);
}
```

Obviously nobody waits a day — so in practice teams "fix" this by shortening the production delay to `ofSeconds(2)` *just for tests* (mutating production for testability, and reintroducing a 2-second timing flake), or by `sleep(2)` and hoping. Both are wrong.

**Slow:** 24h (or a hacked 2s). **Flaky:** any shortened-delay variant races the scheduler thread.

### Target

- Test the 24-hour rule in **microseconds**, deterministically.
- Don't alter production timing for tests.
- Assert it fires at the *right* logical time — not before, exactly at 24h.

### After — drive a virtual-time scheduler

```java
// Production takes a Clock/Scheduler dependency; tests pass a controllable one.
class ReminderService {
    private final VirtualScheduler scheduler;       // injected
    private final Email email;

    void onSignup(User u) {
        scheduler.schedule(() -> email.sendReminder(u), Duration.ofHours(24));
    }
}

@Test
void sendsReminderAfter24h() {
    var scheduler = new VirtualScheduler();         // logical time the test drives
    var email = mock(Email.class);
    var service = new ReminderService(scheduler, email);

    service.onSignup(user);

    scheduler.advanceBy(Duration.ofHours(23));      // just before the deadline
    verify(email, never()).sendReminder(user);      // must NOT have fired yet

    scheduler.advanceBy(Duration.ofHours(1));       // now at 24h exactly
    verify(email).sendReminder(user);               // fires — deterministic, instant
}
```

`VirtualScheduler` keeps a queue of `(fireTime, task)` and runs tasks when `advanceBy` moves logical time past their deadline — the same idea as Reactor's `VirtualTimeScheduler` or RxJava's `TestScheduler` (use those rather than hand-rolling, in real code).

**Result:** 24h (or a flaky 2s hack) → **microseconds**, and it now verifies *more* than the slow version ever could: that the reminder does **not** fire at 23h and **does** at 24h — the exact boundary, with no real waiting and no production-timing hack. Deterministic *and* fast *and* a stronger assertion.

---

## Principles that recur

Across all three cases the same moves convert flaky-and-slow into deterministic-and-fast:

| Before (flaky + slow) | After (deterministic + fast) | Wins both because… |
|---|---|---|
| `sleep(n)` then assert | Poll the condition / await a signal | Returns when work *is done*, not after a guessed duration |
| Real network/DB call | Fake the boundary (`httptest`, in-memory fake) | No latency *and* no outside-world non-determinism |
| `now()` / real delay | Inject a clock; advance logical time | No real waiting *and* an exact, repeatable value |
| Unseeded RNG / random IDs | Inject a deterministic generator / seed | Exact assertions *and* reproducible failures |
| Real `Duration.ofHours(24)` wait | Virtual-time scheduler the test advances | A day's logic in microseconds, exactly at the boundary |

> **The unifying insight:** *the thing that makes a test slow is usually the same thing that makes it flaky — an uncontrolled, real-world input the test waits on.* Control that input (await the condition, fake the dependency, inject the clock, seed the RNG, simulate the schedule) and you remove the wait *and* the non-determinism in one change. You rarely have to trade speed for reliability here; the same refactor buys both.

A caution: making the test fast-and-deterministic by faking the world means it no longer exercises the *real* network/DB/clock. That's correct for a **unit** test — but keep a small number of **integration** tests that hit the real boundary (in a controlled, possibly-retried, clearly-labeled way) so you still verify the wire contract. Fast deterministic unit tests for logic; few honest integration tests for the seams. (See [Slow Tests](../05-slow-tests/senior.md) and [Over-Mocking](../06-over-mocking/senior.md) for that balance.)

---

## Related Topics

- [`junior.md`](junior.md) — why `sleep`-based tests are both flaky and poison.
- [`middle.md`](middle.md) — the per-cause cures these transformations apply.
- [`tasks.md`](tasks.md) — single-cause drills (incl. the fake-clock and sim-time builds expanded here).
- [`find-bug.md`](find-bug.md) — naming the non-determinism source before fixing it.
- [Testing Anti-Patterns → Slow Tests](../05-slow-tests/optimize.md) — the speed half of this story in depth.
- [Testing Anti-Patterns → Over-Mocking](../06-over-mocking/senior.md) — how far to fake the boundary without testing the mock instead of the code.
- [Concurrency Anti-Patterns → Shared State](../../03-concurrency/03-shared-state/senior.md) — the production races behind async-test flakiness.
