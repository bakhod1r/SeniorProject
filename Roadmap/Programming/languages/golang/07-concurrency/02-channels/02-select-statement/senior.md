# Select Statement — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Inside `selectgo`: How the Runtime Picks a Case](#inside-selectgo-how-the-runtime-picks-a-case)
3. [Polling Order, Lock Order, and Why They Differ](#polling-order-lock-order-and-why-they-differ)
4. [Randomisation and Fairness](#randomisation-and-fairness)
5. [Compiler Lowering: What `select` Becomes](#compiler-lowering-what-select-becomes)
6. [`select` Cost Model](#select-cost-model)
7. [Memory Ordering and Happens-before](#memory-ordering-and-happens-before)
8. [Priority-Select Patterns and Their Trade-offs](#priority-select-patterns-and-their-trade-offs)
9. [Select with Send and Receive Cases Together](#select-with-send-and-receive-cases-together)
10. [Send on Closed Channel — The Panic and How to Avoid It](#send-on-closed-channel-the-panic-and-how-to-avoid-it)
11. [Goroutine Lifetime and Leak Audit](#goroutine-lifetime-and-leak-audit)
12. [Reflect-based Dynamic Selects](#reflect-based-dynamic-selects)
13. [Combining Select with `context`, `errgroup`, and `singleflight`](#combining-select-with-context-errgroup-and-singleflight)
14. [Diagnostics and Observability](#diagnostics-and-observability)
15. [When NOT to Use Select](#when-not-to-use-select)
16. [Tricky Questions](#tricky-questions)
17. [Self-Assessment Checklist](#self-assessment-checklist)
18. [Summary](#summary)

---

## Introduction

At senior level we stop describing `select` and start asking what the runtime is actually doing when we write one. The compiler lowers `select` into a call to `runtime.selectgo`. That function shuffles the cases, sorts them by lock address, walks them looking for a ready one, parks the goroutine on every channel if none are ready, and wakes back up when a peer makes one ready. Knowing this changes how you write code: it tells you why selects with twenty cases are slow, why nil channels really are zero cost, why fairness is statistical not strict, and why "prefer this case" cannot be expressed in a flat `select`. This file walks through the internals at the level a senior engineer is expected to discuss in a code review.

---

## Inside `selectgo`: How the Runtime Picks a Case

The Go compiler turns every `select` statement into a call to:

```go
// runtime/select.go (paraphrased)
func selectgo(cas0 *scase, order0 *uint16, ncases int) (chosen int, recvOK bool)
```

`scase` is a small struct describing one case: the channel pointer, the element type, the kind (send / receive / default), and where the value lives. The compiler builds a fixed-size array of `scase` on the goroutine's stack and hands it to `selectgo`. The function returns which case index was chosen (and, for receives, whether the channel was open).

Inside `selectgo` the algorithm is:

1. **Generate two permutations.** A `pollorder` (random) and a `lockorder` (by channel address).
2. **Walk pollorder once looking for a ready case.** If one is found, jump to step 5 with that index.
3. **Lock all channels in lockorder.** If none was ready, the goroutine has to enqueue waiters on every channel.
4. **Check pollorder again under the locks.** A peer might have made a case ready between step 2 and step 3. If so, dequeue the waiters and run that case.
5. **If still nothing is ready**, attach a `sudog` (the runtime's representation of a parked goroutine) to every channel's wait queue, unlock all channels in reverse order, and park the goroutine.
6. **When unparked**, dequeue the `sudog`s from all the other channels, identify the one that triggered the wakeup, and return that case's index.

So a `select` is far from free: it builds permutations, acquires N locks, may enqueue and dequeue from N wait queues. Beginners think of `select` as a control-flow construct; seniors think of it as a multi-channel rendezvous.

---

## Polling Order, Lock Order, and Why They Differ

Two orderings, two purposes:

- **Polling order is random**, computed via a Fisher-Yates shuffle seeded from the per-P fastrand state. Its job is to give every ready case an equal chance of being picked, preventing one case from starving another when both are continually ready.
- **Lock order is by channel address**, sorted ascending. Its job is to prevent deadlock when two `select`s acquire overlapping channel sets in different orders.

If pollorder were also used for locking, two goroutines that called `select` with the same channels but different randomisations could deadlock against each other. By forcing all locking through a fixed total order (sorted addresses), no pair of goroutines can ever block each other through a `select`-internal lock cycle.

This is why the comment in `runtime/select.go` says "we put cases in lock order regardless of execution order."

---

## Randomisation and Fairness

Randomisation is intentional, not accidental. Three reasons:

1. **No starvation.** With strict priority by source order, a frequently-ready channel could prevent another from ever being read.
2. **No accidental priority.** Reordering cases for readability never changes behaviour.
3. **No inadvertent ordering bug.** Code that worked because of order would fail intermittently, surfacing the dependency early.

But "fair" here means **statistically fair across many evaluations**, not "guaranteed to pick the case that has waited longest." A `select` does not maintain per-channel arrival timestamps. If two channels are both always ready, you will see roughly 50/50 over many runs. If one is rarely ready and the other always ready, the rare one will still get its share of evaluations because each evaluation is independent.

This is **not** the same as the wait-queue fairness inside a single channel: when multiple goroutines wait to receive from one channel, they are served FIFO. The randomness is across the cases of one `select`, not across goroutines waiting on one channel.

---

## Compiler Lowering: What `select` Becomes

The compiler's lowering depends on the shape of the `select`:

| Shape | Lowering |
|-------|----------|
| `select {}` | A direct call to `runtime.block` (park forever). |
| `select { default: ... }` | Just the default body (the `select` is a no-op). |
| One case, no default | A direct call to `chansend` or `chanrecv` — no `selectgo`. |
| One case + default | A non-blocking `chansend` or `chanrecv` with the boolean return ("did it succeed?") used to choose the body. |
| Two or more cases | A real `selectgo` call. |

You can confirm this with `go build -gcflags=-S` and grep for `runtime.selectgo`. A `select` with one case is optimised so far that the runtime does not appear at all. This matters: do not wrap a single channel op in a `select` "for symmetry" — the compiler does not literally optimise it back to nothing in the source you read, but it does in the assembly. Still, write what you mean.

The order-randomisation is generated at runtime, not at compile time — the compiler emits a slot for `pollorder` and `lockorder` and `selectgo` fills them in.

---

## `select` Cost Model

Per evaluation:

1. **Stack copy of `scase` array** — O(N) bytes.
2. **Fisher-Yates shuffle for pollorder** — O(N).
3. **Sort by address for lockorder** — O(N log N) but N is small.
4. **N channel lock acquisitions if no case is immediately ready.**
5. **Possibly N enqueues onto wait queues.**
6. **One park / unpark cycle.**
7. **Symmetric dequeue from N queues on wakeup.**

Empirically:

- A 2-case select that finds an immediately ready case is ~30 ns.
- A 2-case select that has to park and is woken is ~300 ns plus the scheduler's switch time.
- Each additional case adds ~10–20 ns when ready, more when not.
- A 16-case select can run several hundred nanoseconds even on the fast path.

For most code this is negligible. For code that runs millions of times per second per goroutine, it matters. The fix is rarely "make selectgo faster" — it is "have fewer cases" or "replace `select` with a cheaper synchronisation primitive."

---

## Memory Ordering and Happens-before

The Go memory model says: a send on a channel happens before the corresponding receive from that channel completes. `select` does not change this; whichever case ran establishes the happens-before edge for the data exchanged through that case.

Concretely:

```go
var x int
ch := make(chan struct{})
done := make(chan struct{})

go func() {
    x = 42
    ch <- struct{}{}
}()

select {
case <-ch:
    // x = 42 is guaranteed to be visible here
case <-done:
    // no edge from the goroutine, x may be 0 or 42
}
```

If the `<-ch` case runs, the read of `x` after it is safe. If the `<-done` case runs, you have no synchronisation with the goroutine that wrote to `x`, and reading it would be a data race.

This is the reason "give me whichever finishes first" patterns must take their value from the case that won, not from a shared variable populated by a side effect.

---

## Priority-Select Patterns and Their Trade-offs

Go has no syntactic priority. The two-level pattern from middle.md is the standard workaround:

```go
for {
    select {
    case <-urgent:
        handleUrgent()
    default:
        select {
        case <-urgent:
            handleUrgent()
        case <-normal:
            handleNormal()
        case <-ctx.Done():
            return
        }
    }
}
```

This **prefers** `urgent` but does not **starve** `normal`. The first non-blocking `select` only runs `handleUrgent` if urgent is ready right now; otherwise the inner `select` waits on either, with random choice between them. So if `urgent` arrives during the inner wait, it has a 50% chance of being picked (assuming `normal` is also ready); the rest of the time it waits on the next outer iteration.

If you want strict starvation-allowed priority, you can drain `urgent` first:

```go
for {
    // Drain urgent
    drained := true
    for drained {
        select {
        case <-urgent:
            handleUrgent()
        default:
            drained = false
        }
    }
    // Then block on either
    select {
    case <-urgent:
        handleUrgent()
    case <-normal:
        handleNormal()
    case <-ctx.Done():
        return
    }
}
```

Strict priority is dangerous: a never-empty `urgent` will starve `normal`. Document the choice and add metrics.

A more honest design when urgency really matters is **separate goroutines per priority** with bounded queues; the operating system / Go scheduler then "prioritises" naturally because the urgent goroutine is woken first when its channel becomes ready.

---

## Select with Send and Receive Cases Together

A single `select` can mix sends and receives:

```go
select {
case x := <-in:
    handle(x)
case out <- y:
    sent++
case <-ctx.Done():
    return
}
```

The runtime treats them uniformly: each case is "an operation that may be ready." A send is ready when the channel has buffer space or a receiver waiting; a receive is ready when the channel has a buffered value or a sender waiting (or is closed).

Mixing send and receive lets you express bidirectional state machines in one loop:

```go
for {
    select {
    case in := <-incoming:
        queue.push(in)
    case outgoing <- queue.peek(): // disabled when queue empty (set chan to nil)
        queue.pop()
    case <-ctx.Done():
        return
    }
}
```

The pattern of toggling `outgoing` between `nil` and the real channel based on `queue.empty()` is the gated-send pattern from middle.md, applied cleanly inside one loop.

---

## Send on Closed Channel — The Panic and How to Avoid It

Sending on a closed channel panics. The fact that the send is inside a `select` does not protect you; if the runtime evaluates the send case and the channel is closed, the goroutine panics.

```go
ch := make(chan int)
close(ch)

select {
case ch <- 1: // PANIC
case <-time.After(time.Second):
}
```

There is no `recover` you can put before the case to make this safe. The conventions are:

1. **One writer.** Only one goroutine ever sends to a channel. That goroutine also closes it. No other goroutine sends.
2. **Close before stopping the writer.** The writer signals "no more sends" by closing the channel. After `close(ch)`, no `select` containing `ch <- v` is allowed to run — typically because the writer has exited.
3. **Use a separate "done" channel** if you want to coordinate shutdown without closing the data channel.

If you must coordinate with multiple writers (rare), use a `sync.Mutex` or `sync/atomic` flag plus a "do not write" check before the `select`. That check has a TOCTOU window — a peer can close between the check and the select — so the safer engineering is to never close a channel that has multiple writers.

---

## Goroutine Lifetime and Leak Audit

A `select` that has no exit path leaks the goroutine. Every for-select audit asks two questions:

1. **Can every case eventually fire?** If a case can never be reached, the loop will park there forever.
2. **Is there a `<-ctx.Done()` (or `<-done:`) path?** If the caller cancels, can we exit?

Common leak shapes:

- **Result channel never gets a value because the producer panicked.** Use `recover` + send the error, or buffer the channel and have the goroutine always `defer close()`.
- **Cancellation channel passed but never closed.** The caller forgot to `cancel()`. Use `defer cancel()` after `WithCancel`.
- **Loop reads from a closed channel without checking `ok`** and spins on the always-ready case. Always check `v, ok := <-ch`.
- **`time.After` reference held by select, goroutine exits before timer fires.** Timer is collected when it fires, but until then it leaks.

Leak detection in tests: `goleak` from go.uber.org checks at the end of each test that no goroutines other than the test's own remain.

---

## Reflect-based Dynamic Selects

When the set of channels is not known at compile time, you can build a `select` dynamically with `reflect`:

```go
import "reflect"

cases := []reflect.SelectCase{
    {Dir: reflect.SelectRecv, Chan: reflect.ValueOf(chA)},
    {Dir: reflect.SelectRecv, Chan: reflect.ValueOf(chB)},
    {Dir: reflect.SelectDefault},
}

chosen, recv, recvOK := reflect.Select(cases)
switch chosen {
case 0:
    // chA fired; recv holds value, recvOK reports open/closed
case 1:
    // chB fired
case 2:
    // default
}
```

Use cases:
- A pub/sub system that subscribes to a varying number of topics.
- A test harness that drives an arbitrary number of channels.
- A bridge between Go channels and an external dispatcher.

Costs:
- An order of magnitude slower than the static form (allocation per call to build the slice; `reflect.Value` boxing).
- No compile-time type checking on the channel element types.

Prefer the static `select` whenever the case count is fixed.

---

## Combining Select with `context`, `errgroup`, and `singleflight`

### `context`

`ctx.Done()` is just a channel; treat it like any other. Note that calling `ctx.Done()` is cheap (returns a cached channel) and that the channel, once closed, stays closed forever — so the case is permanently ready, which is exactly what you want for cancellation.

### `errgroup`

```go
g, ctx := errgroup.WithContext(parent)
g.Go(func() error {
    for {
        select {
        case j := <-jobs:
            if err := process(j); err != nil {
                return err
            }
        case <-ctx.Done():
            return ctx.Err()
        }
    }
})
if err := g.Wait(); err != nil { ... }
```

When any goroutine returns an error, `errgroup` cancels `ctx`; every other goroutine sees `<-ctx.Done()` fire and exits. The `select` is the glue.

### `singleflight`

`singleflight.Do` collapses concurrent calls for the same key into one. Its return type is a value plus an error, accessible via the call. To bound it with a deadline, use `DoChan` and `select`:

```go
ch := group.DoChan(key, func() (any, error) { return fetch(key) })
select {
case r := <-ch:
    return r.Val.(*Foo), r.Err
case <-ctx.Done():
    return nil, ctx.Err()
}
```

---

## Diagnostics and Observability

Tools that help with `select`-heavy code:

- **`runtime/trace`** — captures goroutine wakeups and channel events. Shows when a goroutine parked on a `select` was woken and which channel triggered it.
- **`pprof goroutine` profile** — prints stacks; goroutines parked in `selectgo` show `runtime.selectgo` in their stack. A growing count of selects in the same place is a leak signal.
- **`GODEBUG=schedtrace=1000`** — prints scheduler stats every second. Sustained high `runqueue` values can indicate `select`-driven dispatch backlog.
- **`go test -race`** — catches data races where `select` decided based on a stale value.
- **`goleak`** — assert no leftover goroutines after tests; especially good for catching `select`s without `<-ctx.Done()` paths.

In production, log the chosen case ID for non-trivial selects (`metrics.Inc("dispatcher.case." + name)`); a sudden change in the distribution is a useful symptom.

---

## When NOT to Use Select

`select` is the wrong tool when:

- **You only have one channel.** Use the bare op.
- **You want "all of them done."** Use `sync.WaitGroup` or `errgroup`.
- **You want priority that allows starvation.** A separate goroutine per priority with bounded queues is clearer.
- **You want fan-out to many workers.** A shared `chan Job` with `range` is simpler than a `select`.
- **You want a mutex.** Use `sync.Mutex`. Channels-as-mutexes is cute and slow.
- **You are passing very large values frequently.** Pointers or shared memory under a `sync.RWMutex` are often cheaper than channel transfers.

`select` is the right tool when you have several distinct event sources and need to react to whichever speaks first. That includes: jobs + tick + done; result + error + cancel; multiple sources to merge; gated send/receive in one loop.

---

## Tricky Questions

1. Why does `selectgo` use two orders — pollorder and lockorder — and what would break if either were removed?
2. Where is the happens-before edge in a `select` case?
3. Why does the runtime randomise pollorder using per-P fastrand instead of a global RNG?
4. What is the cost difference between a 2-case and a 16-case `select`?
5. Why is `select{}` not collected as a leak if the goroutine is unreachable?
6. Why does sending on a closed channel inside a `select` panic instead of returning an error?
7. What does `reflect.Select` cost relative to a static `select`?
8. How does the gated-send pattern use `nil` channels to express conditional readiness?
9. When does the compiler not lower a `select` to `selectgo`?
10. Why is fairness inside a single channel different from fairness across `select` cases?

(Answers in interview.md.)

---

## Self-Assessment Checklist

- [ ] I can describe the role of pollorder vs lockorder in `selectgo`.
- [ ] I can explain why two `select`s on the same channel set cannot deadlock against each other.
- [ ] I can read a `runtime/trace` showing a goroutine parked in `selectgo` and identify the wake source.
- [ ] I know which `select` shapes the compiler optimises away.
- [ ] I can write a leak-free for-select with cancellation propagation through `context`.
- [ ] I can express priority with a two-level `select` and explain its starvation behaviour.
- [ ] I can build a dynamic `select` with `reflect` and explain when not to.
- [ ] I can identify the panic risk of send-on-closed in a `select` and design around it.
- [ ] I know the order of magnitude of a `select` evaluation in nanoseconds.
- [ ] I can audit a goroutine's `select` for "every case can fire" and "every loop has an exit."

---

## Summary

A `select` is a multi-channel rendezvous wrapped in a randomised, lock-ordered, parkable runtime call. Internally it shuffles cases for fairness, sorts them by address for deadlock-free locking, walks them looking for a ready one, parks on every channel if none are ready, and unwinds carefully on wakeup. Senior-level fluency means knowing this picture well enough to predict cost, choose between `select` and alternatives, write leak-free for-selects, express priority without starvation, and recognise when `reflect.Select` is justified. The professional file goes the next step: production architectures, observability, and the engineering practices that keep large select-driven services healthy.
