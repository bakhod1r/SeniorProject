---
layout: default
title: When to Use sync.Cond — Interview
parent: When to Use sync.Cond
grand_parent: Primitives Decision Guide
ancestor: Go
nav_order: 5
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/24-primitives-decision-guide/03-when-to-use-cond/interview/
---

# When to Use sync.Cond — Interview

[← Back](../)

The following 28 questions are organized from junior fundamentals up to staff-level design questions. Practice answering them aloud, in under a minute each where possible.

## Fundamentals (1–8)

### 1. What is a condition variable?

A condition variable is a synchronization primitive that lets one or more goroutines wait for a predicate over shared state to become true, without busy-spinning. It must be paired with a mutex that protects that shared state. Goroutines call `Wait`, which atomically releases the mutex and parks them; another goroutine eventually changes the state under the lock and calls `Signal` or `Broadcast` to wake one or all waiters.

### 2. What three operations does `sync.Cond` provide?

`Wait()`, `Signal()`, and `Broadcast()`. Plus the implicit constructor `sync.NewCond(l Locker)`.

### 3. Why must the lock be held when calling `Wait`?

Because `Wait` is implemented as "atomically register on the notify list, then unlock, then park." If you do not hold the lock, you could read the predicate, decide to wait, and then have another goroutine change the predicate and call `Signal` *before* you actually park — you would miss the wakeup. The lock prevents this lost-wakeup race.

### 4. Why do you wrap `Wait` in a `for` loop and not an `if`?

Even though Go forbids spurious wakeups, another goroutine can grab the lock between the `Signal` and your wake-up, mutate the predicate back to false, and release the lock — so when your `Wait` returns and you hold the lock again, the predicate may already be false. Re-checking in a loop is the only safe pattern.

### 5. Does Go's `sync.Cond` have spurious wakeups?

No. The docstring on `sync.Cond.Wait` says "Unlike in other systems, Wait cannot return unless awoken by Broadcast or Signal." POSIX permits spurious wakeups; Go does not. You still wrap in a loop for the stolen-wakeup reason described in question 4.

### 6. What is the difference between `Signal` and `Broadcast`?

`Signal` wakes one goroutine, FIFO by arrival. `Broadcast` wakes every parked waiter. If multiple waiters are waiting on different predicates protected by the same lock, you must use `Broadcast` — otherwise the wrong one might wake up, see its predicate is false, and go back to sleep, while the right waiter is never woken.

### 7. Is it required to hold the lock during `Signal` or `Broadcast`?

No, the docs say it is "allowed but not required." Best practice is to hold it, because doing so makes the order of operations easy to reason about and avoids missed wakeups in some unusual patterns. Releasing before signal can be a micro-optimization but is rarely worth it.

### 8. What is the `noCopy` field for?

It is a marker struct that triggers `go vet`'s `copylocks` analyzer. If you copy a `sync.Cond` by value, `go vet` will warn. There is also a runtime `copyChecker` that panics if you copy after first use.

## Pattern recognition (9–16)

### 9. Show the canonical Wait pattern in five lines.

```go
c.L.Lock()
for !condition() {
    c.Wait()
}
// condition is true, c.L is held
c.L.Unlock()
```

### 10. Show the canonical signal pattern.

```go
c.L.Lock()
changePredicate()
c.Broadcast() // or Signal()
c.L.Unlock()
```

### 11. When would you choose `Cond` over a channel?

Three honest situations: (a) waiters are waiting on a complex predicate involving multiple variables that does not factor cleanly into one channel; (b) you need to wake an unbounded number of waiters at once (`Broadcast` ≡ `close(ch)`, but you need to keep using the variable afterward); (c) you are integrating with code that already has a mutex protecting the state, and inventing a channel would mean a second source of truth.

### 12. What does the Go team itself recommend?

The `sync.Cond` docstring says "For many simple use cases, users will be better off using channels than a Cond." There is a long-standing draft proposal to deprecate `sync.Cond`, and senior maintainers have publicly called it the most-misused primitive.

### 13. Give a real standard-library use of `sync.Cond`.

`io.Pipe` uses Conds (in the implementation, see `src/io/pipe.go`) to coordinate one-reader-one-writer back-pressure. The reader blocks on a Cond until the writer puts data in; the writer blocks on a Cond until the reader consumes it. The pattern requires careful handling because both sides may be closed.

### 14. How would you replace a Cond-based bounded buffer with channels?

You would replace the whole thing with a buffered channel of the buffer's capacity. `Push` becomes `ch <- v`; `Pop` becomes `<-ch`. The channel runtime handles waiting and waking. The Cond-based version is around 40 lines; the channel version is one line at the use site.

### 15. When is `Broadcast` strictly necessary?

When more than one waiter could make progress after the predicate change. Classic example: a barrier that releases N goroutines at once. With `Signal` you would wake them one at a time, which both serializes them and risks deadlock if your code expects them to all be running simultaneously.

### 16. What is the "lost wakeup" problem and how does Cond avoid it?

It is the race where a signal happens before the waiter has parked, so the waiter parks forever. Cond avoids it by registering on the notify list *while holding the lock* (the `runtime_notifyListAdd` call in `Wait`'s implementation happens before `c.L.Unlock`). Any subsequent `Signal` either matches the registered ticket or arrives later and waits for some other waiter to register.

## Bugs and pitfalls (17–22)

### 17. What is wrong with calling `Wait` without holding the lock?

`Wait`'s first action is to register on the notify list, but its second action is to `c.L.Unlock()`. If you did not hold the lock, `Unlock` panics. So this is loud — the program crashes immediately. The subtler bug is in nominally correct code where the predicate check happens outside the lock: that gives a TOCTOU race even if Wait technically succeeds because someone else holds the lock.

### 18. What is wrong with `if !cond { c.Wait() }`?

A goroutine signals; a third goroutine grabs the lock between the signal and your wake-up, undoes the predicate, and releases. When your `Wait` returns, the lock is held by you but the predicate is false. The `if` form proceeds anyway and corrupts state. The `for` form re-checks.

### 19. What is wrong with using `Signal` when multiple waiters are waiting on the same Cond but on different predicates?

You can wake the "wrong" waiter, who sees its predicate is false and goes back to sleep. The waiter whose predicate is now true is never told. Lost progress. Use `Broadcast`.

### 20. What is wrong with copying a `sync.Cond`?

The runtime `copyChecker` will panic on first use of the copy with `sync.Cond is copied`. Even before that, the notify list and the embedded lock would be split into two disjoint instances — a recipe for deadlock and lost wakeups. Always pass `*sync.Cond`.

### 21. Why does my goroutine block forever in `Wait` even though I called `Signal`?

Most likely cause: the predicate was already true at the moment of `Signal`, but the waiter had not yet called `Wait` — so it parked after the signal, with nothing to wake it. Fix: signal under the lock so the predicate change and the signal are atomic from the waiter's perspective.

### 22. Why does `Wait` sometimes panic with "sync: unlock of unlocked mutex"?

Because the lock was not held when `Wait` was called. `Wait` calls `c.L.Unlock()` internally; if you didn't hold the lock, unlock panics.

## Design and trade-offs (23–28)

### 23. Implement "wait for N events" with `sync.Cond`.

```go
type Latch struct {
    mu      sync.Mutex
    c       *sync.Cond
    pending int
}
func New(n int) *Latch {
    l := &Latch{pending: n}
    l.c = sync.NewCond(&l.mu)
    return l
}
func (l *Latch) Done() {
    l.mu.Lock()
    l.pending--
    if l.pending == 0 {
        l.c.Broadcast()
    }
    l.mu.Unlock()
}
func (l *Latch) Wait() {
    l.mu.Lock()
    for l.pending > 0 {
        l.c.Wait()
    }
    l.mu.Unlock()
}
```

This is essentially `sync.WaitGroup` reimplemented. The point of the question is to show you can write the pattern correctly; the meta-point is "and that is why `sync.WaitGroup` exists."

### 24. How would you implement timeout on `Wait`?

Run a side goroutine on `time.After`; when it fires, take the lock, set a `timedOut` flag, and `Broadcast`. The wait loop checks both the predicate and the flag. Or, equivalently, give up and use a channel + `select` with a timeout.

### 25. How would you compare `sync.Cond` to a `sync.WaitGroup` with `Wait`?

A `WaitGroup` is essentially a specialized Cond that counts down a single integer to zero. You should use `WaitGroup` for "wait for N tasks to finish" and `Cond` only when the predicate is genuinely more complex.

### 26. How does `sync.Cond` compare to `chan struct{}` for one-time broadcast?

For one-time fan-out, `close(ch)` on a `chan struct{}` is strictly better: `Broadcast` requires a paired lock; `close` does not. Every receiver of a closed channel gets a non-blocking zero value, and the close-event is visible to all current and future receivers. The Go memory model gives you the same happens-before relationship as `Broadcast`.

### 27. When would you reject a Cond-based solution in code review?

When the predicate is "channel-shaped": a single boolean transition, a queue depth, or "one event happened." Also when the design uses `Signal` with multiple waiters of different conditions — that is almost always a latent bug. And when there is any cancellation/timeout requirement: `Cond` does not natively support it.

### 28. Walk me through what `Wait` does internally, line by line.

From `src/sync/cond.go`:

```go
func (c *Cond) Wait() {
    c.checker.check()                                  // 1
    t := runtime_notifyListAdd(&c.notify)              // 2
    c.L.Unlock()                                       // 3
    runtime_notifyListWait(&c.notify, t)               // 4
    c.L.Lock()                                         // 5
}
```

1. The runtime copy-checker asserts we have not been copied. CAS-writes the address on first use.
2. `notifyListAdd` returns a monotonically increasing ticket number and links this goroutine onto the FIFO. Happens *before* unlock.
3. Unlock the user mutex so other goroutines can change the predicate.
4. `notifyListWait` parks the goroutine on the runtime's notify list until its ticket is matched by `notifyListNotifyOne` or `notifyListNotifyAll`.
5. Re-acquire the user mutex before returning, so the predicate test post-Wait is under the lock.

The atomicity that prevents lost wakeups is in step 2 happening before step 3: any `Signal` that races with `Unlock` will see this ticket and match it.

## Quick fire (29–40)

### 29. Does `sync.Cond` allocate per `Wait`?

No. The runtime uses a per-P `sudog` pool. After steady state, both `Wait` and `Signal`/`Broadcast` are allocation-free.

### 30. Can you `select` on a `sync.Cond` wake-up?

No. `select` works on channel operations. Cond waiters cannot be composed with other events without an external broadcaster goroutine.

### 31. How do you implement `WaitTimeout`?

Spawn a goroutine that broadcasts on timer fire and adds a `timedOut` flag to the predicate. Then the waiter checks `predicate() || timedOut` in its loop. This is the "use channels instead" pattern in disguise.

### 32. If `Signal` is called and no waiter is parked, what happens?

Nothing. `Signal` is a no-op when the notify list is empty. This is the key reason you must signal *under the lock that protects the predicate change* — otherwise the waiter may park after the signal and miss it.

### 33. If `Broadcast` is called and no waiter is parked, what happens?

Same as `Signal`: it is a no-op. No state is changed; future waiters will not see the broadcast.

### 34. What is a "stolen wakeup"?

When goroutine A signals B, then C grabs the lock before B does and mutates the predicate back to false. B wakes, sees a false predicate, must re-park. This is why `for`, not `if`, around `Wait`.

### 35. Can multiple Conds share one mutex?

Yes, and this is the canonical "two-condition" pattern (e.g., `notFull` and `notEmpty` on a single buffer mutex). The Conds are independent FIFO queues; they share the lock that protects the underlying state.

### 36. Can one Cond cover multiple predicates?

Yes, but you must use `Broadcast` to wake correctly. Splitting into one Cond per predicate is usually cleaner.

### 37. What is the relation between `sync.Cond` and `sync.WaitGroup`?

`WaitGroup` is a specialized Cond: the predicate is "counter == 0," the wakers call `Done` (decrement and signal-on-zero), and the waiters call `Wait`. It is implemented at the runtime level for efficiency but is conceptually a Cond.

### 38. What is the relation between `sync.Cond` and `sync.Once`?

`Once` is a specialized Cond: the predicate is "init has run," wakers call `Do` (which runs init the first time), and waiters call `Do` (which blocks until init completes). It uses a faster path than Cond because the predicate is monotonic.

### 39. What is the relation between `sync.Cond` and `close(chan struct{})`?

`close(chan)` is a one-shot broadcast: it sets a permanent "you may proceed" flag for the channel, visible to current and all future receivers. Cond's `Broadcast` only wakes currently-parked waiters; future calls to `Wait` will park again.

### 40. If you had to explain to a junior engineer when to use Cond in one sentence, what would you say?

"Use a condition variable when you have shared mutable state under a mutex, multiple goroutines waiting on different predicates over that state, and no need for cancellation or timeout; otherwise use a channel."

## Senior-level deep dives (41–50)

### 41. Explain the lost-wakeup race and how Cond prevents it.

Without proper sequencing, a signaller could call `Signal` after a waiter has decided to wait but before it has parked, causing the waiter to miss the signal and block forever. Cond prevents this by having `Wait` register on the notify list *before* releasing the user lock. So any `Signal` that runs after the lock release will either match the existing ticket (waking the waiter) or arrive too late and find a parked goroutine. The ticket allocation happens under the lock, and the lock protects the predicate change, so there is a strict happens-before from "predicate change & signal" to "waiter wakes up."

### 42. What is "Mesa semantics" and how does it differ from "Hoare semantics"?

Mesa: the signaller calls `Signal`/`Broadcast` and continues running; waiters are queued and run only after re-acquiring the lock. Other goroutines may run between signal and waiter resume. Hoare: the signaller transfers the lock directly to the waiter, which runs immediately; predicate is guaranteed true at waiter's resume. Go's Cond uses Mesa semantics, which is why the for-loop around Wait is required (the predicate may change between signal and waiter resume).

### 43. Could you implement a fair Cond where the longest-waiting goroutine always wakes first?

`sync.Cond` already wakes in FIFO order (by arrival ticket). So `Signal` is fair in that sense. What it does not guarantee is *priority* fairness — i.e., if you want to wake the goroutine that has been waiting the longest *across all signalling sources*, you have it. If you want priority fairness based on something else (job priority, resource type), you would build that on top by tracking priorities in your own data structure under the same lock.

### 44. What is the cost of `Broadcast` for N waiters?

O(N) work in the runtime: the notify list is walked head-to-tail, calling `goready` on each `sudog`. Each `goready` is roughly the cost of a goroutine wake-up, ~1µs. So `Broadcast` of 100 waiters is ~100µs of runtime work, plus whatever happens when those goroutines all re-acquire the lock (which serializes them). The lock-acquire serialization can dwarf the wake-up cost under contention.

### 45. Why is there no `sync.RWCond`?

Because `sync.Cond` can already use any `sync.Locker`, including `*sync.RWMutex` via `mu.RLocker()` or directly. The semantics are not always what people want — `Wait` releases and re-acquires whichever mode the locker presents, so all your waiters must use the same mode. This is a footgun more than a feature, and the Go team has not added a dedicated `RWCond` because it would not solve a real problem.

### 46. What happens if you nest Cond waits (Cond inside Cond)?

Each Cond has its own notify list and its own associated Locker. You can technically have a goroutine that holds lock A, calls `condA.Wait`, and then while waiting, lock A is released and held by someone else. Nesting Cond waits where the inner Cond's lock is different from the outer is well-defined but uncommon. Nesting with the same lock is impossible because `Wait` releases the lock; you would re-acquire it on inner Wait, and the inner Wait would release-and-park, leaving the outer Cond's predicate state ambiguous. Best practice: do not nest Cond waits.

### 47. How would you implement a recursive Cond?

You wouldn't. Cond requires that the lock be held when calling `Wait`, and `Wait` calls `Unlock` once. If the lock is recursive (held multiple times by the same goroutine), `Wait` will only release one level, and other waiters can't acquire it. Go does not have recursive mutexes by design; if you find yourself wanting one, you have a structural problem with your lock ownership.

### 48. Why does the Go memory model give Cond the "synchronizes before" guarantee?

Because that is the entire point of a condition variable: the signaller has changed shared state, and the waiter must see that change after waking. Without the "synchronizes before" guarantee, the waiter could wake up and read stale values. The implementation uses the runtime's notify-list machinery, which has release/acquire semantics on the underlying futex; this propagates to the user-visible memory ordering.

### 49. Would you ever use `Cond` with an `sync.RWMutex`'s write side?

Rarely. The usual pattern with `RWMutex` is many readers, few writers. A Cond waiting on the write side would block all readers too (because they need RLock, which is blocked by a pending writer). This is usually not what you want. If you have a writer Cond, the underlying Locker should typically be the full Lock, and you should use RW only for the read paths that do not interact with the Cond.

### 50. If you were redesigning Go's sync package today, would you include `sync.Cond`?

Honest answer: probably not as a first-class primitive. The Go team has said publicly that they would not add it today. The cases where Cond is the right tool are rare enough that they could be solved by composing channels and `sync.Mutex` with a couple of extra lines. Removing Cond would simplify the mental model: "share state? Use a mutex. Communicate? Use a channel." Cond muddles this. But the cost of removing it now (breaking thousands of dependent packages) outweighs the benefit, so it stays.

### 51. How would you teach a junior the difference between Signal and Broadcast?

I would use a hotel analogy. Signal is "ring the front-desk bell once; the next person in line gets called." Broadcast is "fire alarm; everyone leaves the building and re-checks whether they actually need to be inside." Signal is efficient when only one waiter can be served. Broadcast is universally safe when multiple waiters might be served — wasted wake-ups are cheap.

### 52. What does `runtime_notifyListAdd` do and why does its position in `Wait` matter?

It atomically increments a ticket counter on the notify list and links the calling goroutine onto the FIFO. The position matters: it happens *before* `c.L.Unlock()` in `Wait`. This means any `Signal` or `Broadcast` that runs after the unlock will see the ticket and either match it (waking the goroutine) or wait for the ticket to be consumed. Without this ordering, a signal could run between the unlock and the park, finding an empty list, and the waiter would park with no future wake-up.

### 53. Can a `sync.Cond` be used across goroutines created by different parents?

Yes. Cond does not care about goroutine parentage. Any goroutine that holds the Cond's Locker can call `Wait`, `Signal`, or `Broadcast`. The only constraints are: the Cond must be referenced by pointer (or in-place; never copied), and the Locker must be the same instance for all callers.

### 54. What is the cost of `Signal` when there is no waiter?

A single atomic load to check the notify list head. Cheap — a few nanoseconds. So calling `Signal` defensively when there might not be a waiter is fine. The cost is in the `Broadcast` case where the list is empty: still cheap, just slightly more bookkeeping.

[← Back](../)
