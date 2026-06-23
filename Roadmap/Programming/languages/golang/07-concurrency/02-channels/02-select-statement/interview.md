# Select Statement — Interview Questions

This file collects the questions an interviewer typically asks about Go's `select`, organised by level. Each question is followed by a model answer concise enough to recite under pressure but technical enough to demonstrate depth.

## Table of Contents
1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Staff / Architecture Questions](#staff-architecture-questions)
5. [Code-Read Questions](#code-read-questions)
6. [Live-Coding Prompts](#live-coding-prompts)

---

## Junior Questions

### Q1. What does `select` do, and how is it different from `switch`?
A `select` waits on a set of channel operations (sends and receives). It blocks until at least one case is ready, then executes that case. `switch` compares a value to constants; `select` watches channels. Cases of `select` can only be channel operations or `default`.

### Q2. What does a `default` case do?
It runs when no other case is ready at the moment of evaluation. With `default`, the `select` is non-blocking. Without it, `select` blocks until a case becomes ready.

### Q3. How do you add a timeout to a channel receive?
```go
select {
case v := <-ch:
    use(v)
case <-time.After(2 * time.Second):
    // timed out
}
```
`time.After(d)` returns a channel that produces a value after `d`; place it in a `select` to give the receive a deadline.

### Q4. What does `select{}` do?
It blocks forever. With zero cases and no default, no case can ever be ready, so the goroutine parks indefinitely. Used in `main` of a daemon to keep the process alive while other goroutines do the work.

### Q5. If two cases are both ready, which runs?
A uniformly random choice between them. Order in source code does not matter. This prevents starvation when one channel is consistently ready.

### Q6. What happens if you receive from a closed channel inside a `select`?
The case is always ready and returns the zero value of the element type with `ok=false`. If you do not check `ok` and break out of the loop, a for-select will spin on this case.

### Q7. What happens if you send on a closed channel inside a `select`?
The goroutine panics. A `select` does not protect you from this; if the runtime selects the send case and the channel is closed, the panic is unavoidable.

### Q8. What is the for-select pattern?
A `for` loop wrapping a `select` so the goroutine can react to several events repeatedly:
```go
for {
    select {
    case j := <-jobs: process(j)
    case <-tick:      flush()
    case <-done:      return
    }
}
```
This is the canonical shape of a long-running goroutine.

### Q9. How do you cancel a long-running goroutine?
Pass a `done` channel (or `context.Context`) and select on it:
```go
case <-done: return
```
or
```go
case <-ctx.Done(): return ctx.Err()
```
The caller closes `done` (or cancels the context) to request shutdown.

### Q10. What happens if you `select` on a nil channel?
The case is never ready. Receives and sends on a nil channel block forever, so `select` simply ignores the case for the purpose of selection. This makes `nil` a way to "disable" a case dynamically.

---

## Middle Questions

### Q11. Why is `time.After` problematic in a tight loop?
Each call to `time.After(d)` allocates a new `*Timer`. The timer is not eligible for garbage collection until it fires. In a hot for-select that calls `time.After` thousands of times per second, you accumulate tens of thousands of live timers until each fires. The fix is to construct one `*Timer` outside the loop with `time.NewTimer` and `Reset` it on each iteration.

### Q12. Why are result channels in timeout patterns usually buffered with capacity 1?
If the timeout case wins, the producer goroutine still wants to send its result somewhere. Without a buffer, the send blocks forever and the goroutine leaks. With capacity 1, the send completes whether or not the consumer is still listening.

### Q13. What is the nil-channel trick?
Setting a channel variable to `nil` disables its case in `select`, because nil-channel ops block forever. This lets you turn cases on and off dynamically without restructuring the `select`. Common uses: gated sends (set output to nil when buffer is empty), drain-once (set input to nil when its closed signal arrives).

### Q14. How do you implement priority among `select` cases?
Use a two-level select:
```go
select {
case <-urgent:
    handleUrgent()
default:
    select {
    case <-urgent:    handleUrgent()
    case <-normal:    handleNormal()
    case <-ctx.Done(): return
    }
}
```
The non-blocking outer select prefers urgent when ready; otherwise the inner select waits on either channel. This is "preferred not starvation-causing" priority.

### Q15. What is the difference between `time.Tick` and `time.NewTicker`?
`time.Tick(d)` returns a receive-only channel; you cannot stop the underlying ticker, so it leaks if the consumer goroutine exits. `time.NewTicker(d)` returns a `*Ticker` you can `Stop`. Production rule: never use `time.Tick`.

### Q16. How does a graceful shutdown of a worker work with `select`?
Two channels: `jobs` and `done`. The for-select's outer cases are `<-jobs` and `<-done`. When `done` closes, the worker enters a drain loop that uses non-blocking `select` (`case j := <-jobs: ...; default: return`) to empty the queue, then returns.

### Q17. How do you fan-in multiple channels into one consumer?
Spin a goroutine per source that copies into a shared output channel, with a `select` that respects cancellation:
```go
go func() {
    for v := range src {
        select {
        case out <- v:
        case <-ctx.Done():
            return
        }
    }
}()
```
A `sync.WaitGroup` plus a closer goroutine close `out` when all sources are done.

### Q18. How do you avoid sending to a closed channel?
Conventions:
1. Single writer per channel; that writer also closes.
2. Close before stopping the writer (close means "no more values").
3. If multiple writers, use a separate "stop accepting" boolean or a mutex; never close from a side that does not control writes.

### Q19. What does `select` selection randomness look like statistically?
Across many evaluations, ready cases are picked with uniform probability. If two cases are always ready, you see roughly 50/50 over thousands of iterations. This is not strict round-robin and not arrival-time-based — each evaluation is independent.

### Q20. What is the canonical shape of a goroutine that uses `errgroup` and `select`?
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
```
Returning a non-nil error cancels the shared context; sibling goroutines see `<-ctx.Done()` and exit.

---

## Senior Questions

### Q21. Walk through what `runtime.selectgo` does.
1. Build a poll order (random shuffle of case indices) and a lock order (sorted by channel address).
2. Walk poll order; if any case is ready, jump to commit.
3. Acquire all channel locks in lock order.
4. Walk poll order again under locks; if a case became ready, commit.
5. Otherwise enqueue a `sudog` on each channel's wait queue, release locks in reverse order, and park.
6. On wakeup, identify which channel triggered, dequeue the `sudog`s from the others, and return that case index.

The two orders prevent both starvation (random poll) and inter-`select` deadlock (canonical lock order).

### Q22. Why does the runtime use two different orders for polling and locking?
**Random poll** ensures fairness — no case starves when several are continuously ready. **Sorted lock order** ensures that two `select`s on overlapping channel sets cannot deadlock against each other, because all goroutines acquire those channels' locks in the same order.

### Q23. What is the cost model of `select`?
Per evaluation:
- O(N) shuffle + O(N log N) sort.
- N lock acquisitions if no case is ready immediately.
- Possible park/unpark cycle (~microseconds).

Empirically, a 2-case ready select is ~30 ns; a parking-then-woken select is hundreds of nanoseconds plus scheduler switch time. Cost grows roughly linearly in N up to about 16 cases.

### Q24. Where does the happens-before edge live for a `select` case?
The case that ran establishes a happens-before edge between the matched send and the receive (or vice versa). Other cases establish no edges. This means data passed through the chosen channel is safely visible after the case body begins; data written by goroutines that did not communicate via the chosen case is still subject to ordinary memory-model rules and may need other synchronisation.

### Q25. When does the compiler not lower a `select` to `selectgo`?
Special shapes:
- `select {}` → `runtime.block`.
- Only `default` → just the body.
- One case + nothing else → direct `chansend`/`chanrecv`.
- One case + `default` → non-blocking `selectnbsend`/`selectnbrecv`.

Two or more non-default cases always go through `selectgo`.

### Q26. What is `reflect.Select` and when do you use it?
A dynamic version that takes a `[]reflect.SelectCase` and performs the same semantics as a static `select`. Use it when the set of channels is genuinely unknown at compile time — pub/sub bridges, test harnesses, plugin systems. Cost is an order of magnitude higher than static `select` due to interface boxing and per-call slice allocation; prefer static when you can.

### Q27. How do you detect a leaked goroutine sitting in `selectgo`?
Capture a goroutine profile (`pprof`); group by stack. Goroutines parked in `select` show `runtime.selectgo` in their stack. A growing count over time, especially on the same source line, is a leak signal. `goleak` automates this in tests.

### Q28. Why is starvation possible despite random selection?
Random selection only operates on cases that are **currently ready**. If a case is rarely ready, it cannot be selected often. "Starvation" usually means producer or scheduling starvation — a case is never ready because the upstream system isn't producing — not select-internal unfairness.

Inside a hot `select`, however, if you implement strict priority by polling the urgent case in a non-blocking outer select, you can starve the normal case when urgent is always at least somewhat hot. Use the budgeted-priority pattern.

### Q29. Why should `time.After` be banned in production code?
Even outside hot loops, it is too easy for a `time.After` reference to outlive the surrounding scope, leaking the timer until it fires. CI lint rules typically reject `time.After`, requiring `time.NewTimer` (with `Stop`) or a deadline-bearing context instead. The exceptions are one-shot waits at API boundaries where the value is consumed immediately.

### Q30. How does `errgroup.WithContext` use selects internally?
`errgroup` maintains a context derived from the parent and a `cancel` function. When any goroutine returns a non-nil error, the group calls `cancel`, closing the context's `Done()` channel. Other goroutines block on `<-ctx.Done()` (in their own selects) and exit. The group's `Wait` blocks on a `sync.WaitGroup` for all goroutines to finish, then returns the first error.

---

## Staff / Architecture Questions

### Q31. Design a graceful shutdown for a service with N worker goroutines.
- Pass `ctx` to every worker; every worker has `<-ctx.Done()` in its for-select.
- Wrap the workers in `errgroup.WithContext`.
- On signal (SIGTERM), call `cancel()`.
- For request-handling servers, call `Server.Shutdown(ctx)` with a fresh deadlined context (not the cancelled one) so it has a drain window.
- `errgroup.Wait` returns when all workers exit.
- Hard-deadline the entire shutdown with a top-level `time.AfterFunc(30*time.Second, os.Exit)` so a stuck worker cannot wedge the process.

### Q32. How would you find which `select` is leaking goroutines in production?
1. Check `runtime.NumGoroutine()` over time; look for monotonic growth.
2. Capture `pprof goroutine` profiles at start and after some hours; diff.
3. Grouped stacks ending in `runtime.selectgo` at the same line are the suspect.
4. Read that select; check whether every case can fire and whether `<-ctx.Done()` is present and reachable.
5. Reproduce with `goleak` in a test, fix, and add the test as regression coverage.

### Q33. What metrics do you expose for a hot for-select loop?
- Per-case selection counter (which case won).
- Channel depth for each input/output channel.
- Drop counter when `default` triggers backpressure.
- Loop iterations per second.
- Time-in-case histogram (especially for the work case, to find slowdowns).

These four together let you diagnose almost any production issue in a select-driven loop.

### Q34. How would you implement priority that does not starve?
Three options, in order of complexity:
1. Two-level `select` (preferred, not starvation-causing).
2. Budgeted priority: count urgent runs and yield to normal after N consecutive.
3. Separate goroutines per priority with bounded queues; the scheduler "naturally" prefers a goroutine that is ready over one that is not.

Option 3 is the cleanest at scale because it pushes the priority decision into the OS / Go scheduler rather than encoding it in case-selection logic.

### Q35. Design a fan-in that supports dynamic add and remove of sources.
Use a coordination goroutine that owns a map of source channels. New subscriptions are sent on a registration channel; cancellations on a deregistration channel. The coordinator uses `reflect.Select` to wait on the union of source channels plus the registration and deregistration channels and the context. When `reflect.Select` returns the index of a source, forward the value to `out`; when registration arrives, add to the slice rebuilding the SelectCase array; on dereg, remove. This is the only place `reflect.Select` is genuinely the right tool.

### Q36. Why is "channel as mutex" considered a code smell?
A buffered-1 channel can encode mutual exclusion (`acquire` = receive, `release` = send), but:
- It is roughly 2-3x slower than `sync.Mutex` for the same semantics.
- It cannot express RWLock.
- It has no `TryLock` equivalent without a `default` case.
- It misleads readers about the intent (mutex-vs-coordination).

Use `sync.Mutex` for mutual exclusion. Channels are for ownership transfer, signalling, and coordination.

### Q37. How does the Go scheduler interact with `select`?
A goroutine parked in `select` is not on any P's run queue; it lives on the wait queues of the channels it selected on, as `sudog` records. When a peer makes one of those channels ready (a send for our receive case, etc.), the runtime walks the wait queue, picks the right `sudog`, dequeues the goroutine, and puts it on a P's local run queue. The cost is a few atomic operations and a queue manipulation — well-tuned and not the typical bottleneck.

### Q38. Is there ever a reason to use a `select` with a single case?
Almost never. A single case `select` (without `default`) compiles to a direct `chansend` or `chanrecv`; it is no faster but no slower. It can hurt readability by suggesting there's a multiplexed choice when there is not. The exceptions are:
- Code generation / templates that always emit `select` to keep the shape uniform.
- Tests that want to express "with the default added later" intent.

Generally: write the bare op.

### Q39. How do you test for fairness in a select-driven router?
Run the router under uniform load with two or more inputs and assert that the per-input throughput is within an acceptable percentage of the expected share (e.g., each within 40% of the mean). Do not assert exact equality; randomness gives statistical not strict fairness.

### Q40. What lessons do you teach junior engineers about `select`?
1. Always include `<-ctx.Done()` in for-select.
2. Never use `time.After` in a loop.
3. Never use `time.Tick`.
4. Buffer result channels in timeout patterns with capacity 1.
5. Close channels from the writer side; never from the reader.
6. Random selection — do not depend on case order.
7. Nil channels disable cases dynamically.
8. Send on closed channel panics (no `select` rescue).
9. `select{}` is intentional and idiomatic.
10. If a select has more than five cases, refactor.

---

## Code-Read Questions

### Q41. What is wrong with this code?
```go
for {
    select {
    case j := <-jobs:
        process(j)
    case <-time.After(time.Second):
        idle()
    }
}
```
**Answer.** Two issues. (1) `time.After` allocates a new timer each iteration; under load this leaks memory until each fires. (2) No `<-ctx.Done()` case — the goroutine cannot be stopped. Fix by hoisting a `time.NewTimer` and adding cancellation.

### Q42. What is wrong with this code?
```go
go func() {
    for j := range jobs {
        select {
        case results <- compute(j):
        case <-ctx.Done():
            return
        }
    }
    close(results)
}()
```
**Answer.** If `ctx.Done()` fires, the goroutine returns without closing `results`. Downstream `for r := range results` blocks forever. Either `defer close(results)` or move `close` to a coordinator goroutine that knows when all producers are done.

### Q43. What does this print?
```go
ch := make(chan int)
close(ch)
for i := 0; i < 3; i++ {
    select {
    case v := <-ch:
        fmt.Println(v)
    }
}
```
**Answer.** `0\n0\n0\n`. The closed channel returns the zero value immediately each time. Without `v, ok` and a break, a real for-select would spin.

### Q44. Will this leak?
```go
out := make(chan int)
go func() {
    out <- expensive()
}()
select {
case v := <-out:
    use(v)
case <-time.After(time.Second):
    return
}
```
**Answer.** Yes. If the timeout wins, the goroutine is still parked on the unbuffered `out`. Make `out` buffered with capacity 1.

### Q45. What does this do under load?
```go
for {
    select {
    case j := <-jobs:
        process(j)
    default:
    }
}
```
**Answer.** Burns 100% of a CPU core. Without backpressure or a timer, the loop spins as fast as the hardware allows. Replace `default` with a real waitable case (timer, ticker, ctx.Done) or remove it entirely so the select blocks.

---

## Live-Coding Prompts

### Prompt 1 — Timeout helper

> Implement `func WithTimeout[T any](ctx context.Context, d time.Duration, f func() (T, error)) (T, error)` that runs `f` in a goroutine and returns either its result or `context.DeadlineExceeded`/`ctx.Err()`. Avoid leaking the goroutine.

Solution sketch:
```go
type res[T any] struct { v T; err error }
ch := make(chan res[T], 1)
go func() { v, err := f(); ch <- res[T]{v, err} }()
deadline, cancel := context.WithTimeout(ctx, d)
defer cancel()
select {
case r := <-ch:
    return r.v, r.err
case <-deadline.Done():
    var zero T
    return zero, deadline.Err()
}
```

### Prompt 2 — Rate-limited fan-in

> Merge two channels into one, dropping if downstream is full.

```go
func merge(ctx context.Context, a, b <-chan int) <-chan int {
    out := make(chan int, 16)
    go func() {
        defer close(out)
        for {
            select {
            case v, ok := <-a:
                if !ok { a = nil; if b == nil { return }; continue }
                trySend(out, v)
            case v, ok := <-b:
                if !ok { b = nil; if a == nil { return }; continue }
                trySend(out, v)
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}

func trySend(out chan<- int, v int) {
    select {
    case out <- v:
    default:
    }
}
```

### Prompt 3 — Heartbeat-aware worker

> Write a worker that processes jobs and emits a heartbeat every 5 seconds.

```go
func worker(ctx context.Context, jobs <-chan Job, hb chan<- struct{}) {
    t := time.NewTicker(5 * time.Second)
    defer t.Stop()
    for {
        select {
        case j, ok := <-jobs:
            if !ok { return }
            process(j)
        case <-t.C:
            select {
            case hb <- struct{}{}:
            default: // skip if nobody is listening
            }
        case <-ctx.Done():
            return
        }
    }
}
```

### Prompt 4 — Bounded retry with cancellation

> Retry up to 3 times with exponential back-off; bail on context cancellation.

```go
func retry(ctx context.Context, f func() error) error {
    var err error
    backoff := 100 * time.Millisecond
    for i := 0; i < 3; i++ {
        err = f()
        if err == nil { return nil }
        select {
        case <-time.After(backoff):
        case <-ctx.Done():
            return ctx.Err()
        }
        backoff *= 2
    }
    return err
}
```

(Time.After is acceptable here because the loop runs at most three times.)

---

These questions cover the typical interview surface from junior to staff. Combined with the rest of the suite (junior, middle, senior, professional), they should fully prepare you to discuss `select` in any depth.
