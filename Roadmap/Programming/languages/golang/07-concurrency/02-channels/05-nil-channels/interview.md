# Nil Channels — Interview Q&A

> Questions and reference answers from junior through staff level. Each question begins with the level it is most commonly asked at; senior engineers should be comfortable with all of them. Answers are deliberately concise — interview-pace, not textbook-pace.

---

## Junior

### Q1. What is a nil channel?

**A.** A channel-typed variable whose value is nil. The zero value of any channel type. Produced by `var ch chan int`, by leaving a struct field of channel type uninitialised, or by explicit assignment `ch = nil`.

### Q2. What happens if you send to a nil channel?

**A.** The goroutine blocks forever. The runtime parks it with the wait reason `chan send (nil chan)`. There is no way to wake it. If it is the only goroutine, the runtime detects deadlock and aborts; otherwise it is a silent leak.

### Q3. What happens if you receive from a nil channel?

**A.** Same as send: the goroutine blocks forever. Wait reason is `chan receive (nil chan)`. The receive never returns a value or completes.

### Q4. What happens if you close a nil channel?

**A.** Runtime panic: `close of nil channel`. Unlike send and receive, close on nil does not block — it crashes immediately.

### Q5. Is `var ch chan int` a valid declaration?

**A.** Yes. It declares a channel variable with the zero value (nil). The compiler does not require `make`. Any send/receive on it will block; any close will panic.

### Q6. What does this print?

```go
var ch chan int
fmt.Println(ch == nil)
```

**A.** `true`.

### Q7. What is the difference between a nil channel and a closed channel?

**A.** A nil channel blocks all operations forever (except close, which panics). A closed channel is always ready to receive (returns zero value with `ok==false`) and panics on send or close. They are opposite ends of the readiness spectrum.

### Q8. What does this print?

```go
var ch chan int
select {
case <-ch:
    println("a")
default:
    println("b")
}
```

**A.** `b`. The nil case cannot proceed; the default fires.

### Q9. Can you use `len()` and `cap()` on a nil channel?

**A.** Yes; both return 0. The nil channel has zero buffered values and zero capacity.

### Q10. What is the most common bug related to nil channels?

**A.** Forgetting to call `make`. A struct field of channel type defaults to nil; sending or receiving on it blocks the goroutine forever.

---

## Middle

### Q11. Why would you ever want a nil channel on purpose?

**A.** To disable a `select` case dynamically. When a case's channel is nil, `select` skips it. This lets you turn cases on and off by reassigning the channel variable, without restructuring the loop or carrying boolean flags.

### Q12. Show the "off switch" pattern.

**A.**

```go
for {
    select {
    case v := <-once:
        handle(v)
        once = nil // disable from now on
    case <-other:
        // ...
    }
}
```

After the first value, `once = nil` removes the case from selection. The loop continues on remaining cases.

### Q13. Show the "drain then disable" pattern.

**A.**

```go
for {
    select {
    case v, ok := <-in:
        if !ok {
            in = nil
            continue
        }
        process(v)
    case <-ctx.Done():
        return
    }
}
```

When `in` closes, the receive returns `ok==false`. Nil-ing `in` stops the case from busy-looping on the always-ready closed channel.

### Q14. What's the bug here?

```go
for v := range ch {
    fmt.Println(v)
}
```

(Where `ch` may be nil.)

**A.** If `ch` is nil, the `range` blocks forever on its first receive. Defend with `if ch == nil { return }` before the loop, or use a `select` with a cancellation case.

### Q15. Why does this select hang?

```go
var a, b chan int
select {
case <-a:
case <-b:
}
```

**A.** Both channels are nil. Neither case can proceed. No default. The goroutine parks with no possibility of wake. If it is the only goroutine, the deadlock detector fires.

### Q16. Why is `close(ch)` where `ch` might be nil a production hazard?

**A.** `close(nil)` panics. A `defer close(ch)` where the channel was never initialised crashes the program. Guard with `if ch != nil { close(ch) }` or ensure channels are always initialised before defer runs.

### Q17. What pattern would you use to pause and resume a periodic emitter?

**A.** Keep a local `tickCh` variable referencing the ticker's channel. To pause: `tickCh = nil`. To resume: `tickCh = ticker.C`. The ticker keeps running; you just stop selecting on it.

```go
ticker := time.NewTicker(time.Second)
tickCh := ticker.C
for {
    select {
    case <-tickCh:
        emit()
    case cmd := <-control:
        if cmd == pause { tickCh = nil }
        if cmd == resume { tickCh = ticker.C }
    }
}
```

### Q18. Why is the closure-capture trap dangerous with nil channels?

**A.** A goroutine that captures a channel variable via closure sees the *current* value when it dereferences, not the value at the time `go func` was called. If the outer code later sets the variable to nil, the goroutine ends up sending or receiving on nil — block forever.

```go
ch := make(chan int)
go func() { ch <- 1 }() // captures ch by reference
ch = nil                 // goroutine now blocks forever
```

Fix: pass the channel as an argument: `go func(ch chan int) { ch <- 1 }(ch)`.

### Q19. Can `range` over a nil channel work if the channel is later initialised?

**A.** No. The `range` reads the channel value once when the loop starts (or on each iteration's receive — same nil). The compiler does not insert nil-checks. Once you enter `range` on a nil channel, the goroutine is parked indefinitely.

### Q20. How do you test for nil-channel leaks?

**A.** Use `go.uber.org/goleak` in tests. After each test, `goleak.VerifyNone(t)` checks that no goroutines linger. A nil-channel leak shows up as a goroutine parked on `chan send (nil chan)` or `chan receive (nil chan)`. In production, scrape `/debug/pprof/goroutine?debug=2` for the `(nil chan)` suffix.

---

## Senior

### Q21. Compare the nil-channel pattern against using a boolean flag for select gating.

**A.** Boolean flag:

```go
var active bool
for {
    select {
    case v := <-ch:
        if active { handle(v) } // case still fires; conditional ignored
    case ...
    }
}
```

The flag does not prevent the case from firing; it just discards the value. If `ch` is closed, the case fires *constantly*, busy-looping. The nil-channel approach disables the case at the runtime level; the case does not fire and the loop blocks until another case is ready.

### Q22. Why does the runtime treat nil channels symmetrically across send, receive, and select?

**A.** A nil channel has no underlying `hchan` struct — no buffer, no lock, no waitq. The runtime's three entry points (`chansend`, `chanrecv`, `selectgo`) all begin with `if c == nil` and route to either a forever-park or panic. The symmetry simplifies the runtime and makes the semantics predictable.

### Q23. How does `select` skip nil-channel cases internally?

**A.** `selectgo` builds an array of `scase` structs from the compiler. It computes a randomised `pollorder` to fairly select among ready cases. When iterating `pollorder`, it checks `c == nil` and skips. It also builds a `lockorder` (channels sorted by pointer to prevent lock-ordering deadlocks) — nil channels are skipped there too. Finally, the goroutine is enqueued only on non-nil channels' waitqs.

### Q24. What is the wait reason for a goroutine parked on a nil-channel receive in `select`?

**A.** It depends. If the `select` had no cases that could proceed and no default, the goroutine parks with `waitReasonSelect` (or `waitReasonSelectNoCases` if zero cases). The "chan receive (nil chan)" wait reason is specific to a *direct* receive on a nil channel, outside of `select`.

### Q25. Can a goroutine parked on a nil-channel receive ever be unblocked?

**A.** Only by goroutine destruction at program exit. There is no waitq to enqueue it on, no `goready` ever fires. The internal `gopark` call passes nil for both `unlockf` and `lock`. The goroutine is permanently parked.

### Q26. How would you implement a fan-in over an unbounded number of channels?

**A.** Use `reflect.Select`. Pre-allocate a `[]reflect.SelectCase` slice. As each source closes, set `cases[i].Chan = reflect.Value{}` to disable that case. The runtime treats invalid `reflect.Value{}` the same as a nil channel — skipped. Exit when all data cases are disabled (or on cancellation).

### Q27. What's wrong with this attempted shutdown?

```go
go func() { for v := range ch { handle(v) } }()
ch = nil // try to stop
```

**A.** Setting `ch = nil` does not stop the goroutine. The goroutine's `range` is still iterating on whatever `ch` *was* (or what the closure currently sees). If the closure sees the new nil value, the goroutine parks forever. If it sees the original channel, it keeps reading. Either way, the goroutine doesn't gracefully exit. Use `close(ch)` instead; the `range` exits cleanly when the channel is drained.

### Q28. Explain the race-detector implications of nil-channel mutation.

**A.** Mutating a channel variable from one goroutine while another reads it (in a `select`) is a data race on the variable itself, not on the channel operation. The race detector flags it. Fix: mutate only from the owning goroutine, or use `sync/atomic.Pointer[chan T]` for cross-goroutine assignment, or redesign to use a control channel.

### Q29. Why might `context.Context.Done()` return a nil channel?

**A.** From the standard library: "Done may return nil if this context can never be canceled." A context like `context.Background()` is never cancellable, so its `Done()` is nil. In `select`, this gives you the dormant-case behaviour automatically — the cancellation case never fires.

### Q30. Design a generic merge function that uses nil-channel disabling.

**A.**

```go
func Merge[T any](ctx context.Context, ins ...<-chan T) <-chan T {
    out := make(chan T)
    go func() {
        defer close(out)
        srcs := make([]<-chan T, len(ins))
        copy(srcs, ins)
        alive := len(srcs)
        for alive > 0 {
            cases := make([]reflect.SelectCase, 0, len(srcs)+1)
            indices := []int{}
            for i, s := range srcs {
                if s != nil {
                    cases = append(cases, reflect.SelectCase{
                        Dir: reflect.SelectRecv, Chan: reflect.ValueOf(s),
                    })
                    indices = append(indices, i)
                }
            }
            cases = append(cases, reflect.SelectCase{
                Dir: reflect.SelectRecv, Chan: reflect.ValueOf(ctx.Done()),
            })
            chosen, val, ok := reflect.Select(cases)
            if chosen == len(cases)-1 {
                return
            }
            if !ok {
                srcs[indices[chosen]] = nil
                alive--
                continue
            }
            select {
            case out <- val.Interface().(T):
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}
```

For production, pre-allocate `cases` outside the loop and mutate in place to avoid GC pressure.

---

## Staff

### Q31. You see a production memory leak. `pprof goroutine?debug=2` shows 50,000 goroutines parked on `chan send (nil chan)`. How do you diagnose?

**A.** Steps:

1. Look at the stack traces — they all point to one source location. Identify it.
2. Inspect the channel variable's mutation history. Is it ever set to nil? Where?
3. Check for closure-capture: is a goroutine capturing the channel by reference and seeing a later nil assignment?
4. Audit constructors: was the channel ever initialised, or does a code path skip `make`?
5. Check API contracts: does the function returning the channel sometimes return nil?

Likely culprits: (a) a struct field defaulted to nil, (b) a function returning nil on an error path that the caller ignored, (c) a configuration toggle that nils a channel still being written to by other goroutines.

### Q32. You're designing a library that returns a channel. Should it ever return nil?

**A.** Two valid designs:

- **Never nil, eventually closed.** Caller uses `for v := range ch` confidently. Simpler caller code.
- **Sometimes nil, meaning "this is dormant by design"** (e.g., `Context.Done()` for a never-cancellable context). Caller must use `select`, with the nil case becoming dormant.

Choose nil-returning *only* if the caller's natural code is `select` (not `range`) and dormancy is a meaningful state. Document the contract explicitly. If a caller might do `range`, never return nil — the loop will hang.

### Q33. Why is the deadlock detector unreliable for nil-channel bugs in production?

**A.** The detector (`checkdead` in `runtime/proc.go`) fires only when *every* user goroutine is parked. In production, there are always background goroutines making progress (HTTP server, metrics emitter, GC). A handful of nil-parked goroutines do not trip the detector. Production-grade detection requires `pprof` scraping, `goleak` in tests, and `runtime.NumGoroutine` monitoring.

### Q34. How does the `select` statement's compilation differ for cases with nil channels?

**A.** It doesn't, structurally. The compiler emits the same `runtime.selectgo` call with an `scase` array. The `scase.c` field holds the channel pointer — nil if the channel is nil. The runtime's `selectgo` checks each case's channel and skips nil ones during polling and lock-ordering. There is no compile-time optimisation that removes a known-nil case (because nil-ness can change at runtime).

### Q35. Design a state-machine `select`-loop using nil channels.

**A.** A web crawler that has three states: Idle, Crawling, Throttled.

```go
type Crawler struct {
    fetch  chan URL    // requests to fetch
    result chan Result // results out
    ctrl   chan string // control: start, stop, throttle
}

func (c *Crawler) Run(ctx context.Context) {
    var fetchCh chan URL    // nil in Idle and Throttled, real in Crawling
    var resultCh chan Result // nil in Idle, real otherwise
    state := "idle"

    for {
        switch state {
        case "idle":
            fetchCh = nil
            resultCh = nil
        case "crawling":
            fetchCh = c.fetch
            resultCh = c.result
        case "throttled":
            fetchCh = nil
            resultCh = c.result // can still emit pending results
        }

        select {
        case url := <-fetchCh:
            go c.do(url)
        case r := <-c.results:
            select {
            case resultCh <- r:
            case <-ctx.Done():
                return
            }
        case cmd := <-c.ctrl:
            state = cmd
        case <-ctx.Done():
            return
        }
    }
}
```

State changes drive channel reassignment. The `select` body never branches on state; it just sees the right channels for the current state.

### Q36. What is the cost of evaluating a nil case in `select`?

**A.** Approximately one comparison plus the cost of the random shuffle (pollorder includes nil cases but skips them quickly). For a `select` with `n` cases, the polling loop is `O(n)` whether cases are nil or not. The optimisation "remove nil cases at compile time" is not done because nil-ness is runtime state.

### Q37. Can `reflect.Select` simulate the nil-disabling pattern?

**A.** Yes. Set the case's `Chan` field to the zero `reflect.Value{}` (the invalid value). `reflect.Select` skips invalid cases. This is the documented mechanism for "remove this case at runtime." Performance is the main caveat: `reflect.Select` is 10-100x slower than a static `select`, so use it only for genuinely dynamic case sets.

### Q38. Architectural question: when would you choose nil-channel disabling over context cancellation?

**A.** Nil-channel disabling is local to one goroutine and reversible (you can re-enable). Context cancellation is global and one-way. Use nil-channel disabling for:

- Per-source state transitions (drain, pause, throttle).
- Conditional emit/receive within a single goroutine.

Use context cancellation for:

- Whole-tree shutdown.
- Deadlines and timeouts.
- Cross-goroutine coordination of "we are done."

They compose: a goroutine listens to `ctx.Done()` (cancellation) and toggles local channels (disabling) inside the same `select`.

### Q39. Why does Go choose "block forever" instead of "panic" for send/receive on nil?

**A.** The design rationale appears in Rob Pike's talks and the Go FAQ. "Block forever" enables the nil-as-dormant pattern in `select`. If nil sends/receives panicked, the disable-case idiom would not work — every `select` iteration with a nil case would crash. Block-forever is uniformly safe: in `select` it means "skip this case"; outside `select` it means "this is a bug, but at least the goroutine is in a clean state for pprof to surface."

### Q40. A code reviewer flags `ch = nil` in your code as "looks like a bug." How do you defend the design?

**A.** Explain the off-switch idiom. Show how the alternative — boolean flags or duplicated select blocks — is more verbose, harder to read, and more error-prone (a closed-channel case in a `select` busy-loops). Show that the reviewer can verify safety by checking: (1) the nil assignment is in the same goroutine that reads the channel, (2) at least one case in the `select` is always live (cancellation or default), (3) the goroutine has a documented exit condition. If all three hold, the pattern is idiomatic.

### Q41. How would you instrument production code to detect nil-channel waits early?

**A.** Three layers:

1. **`runtime.NumGoroutine` as a Prometheus gauge.** Alert on monotonic growth.
2. **Periodic `pprof goroutine?debug=2` snapshots.** Grep for `(nil chan)` and report count by stack frame.
3. **Custom wait-reason histograms** via `runtime/pprof` programmatic API. Bucket by wait reason; visualise "chan send (nil chan)" and "chan receive (nil chan)" as separate series.

In CI, run all tests with `goleak.VerifyNone(t)` to catch leaks before they reach production.

### Q42. Suppose you must use nil-channel disabling but multiple goroutines need to mutate the channel variable. How do you make it safe?

**A.** Three approaches:

- **Ownership transfer via channel.** The mutation is done by one goroutine; others request changes via a control channel.
- **`atomic.Pointer[chan T]`.** All reads/writes go through atomic load/store. Verbose; rare in idiomatic Go.
- **Mutex.** Lock around every read/write of the channel variable. Simple, but introduces lock contention in the `select` hot path.

The first is most idiomatic Go: "share memory by communicating."

---

## Bonus Tricky Questions

### Q43. Will this program deadlock?

```go
func main() {
    ch := make(chan int)
    go func() { ch <- 1 }()
    ch = nil
    fmt.Println(<-ch) // ???
}
```

**A.** The goroutine sends on the *original* channel (captured by reference, but the value is unchanged at this point — depends on timing). The main goroutine receives on the *now-nil* channel. The receive on nil blocks forever. If the spawned goroutine successfully sends on the original channel, there is nothing receiving — it also blocks. Eventually all goroutines are parked: deadlock fatal.

The exact behaviour depends on scheduling. In practice: `ch = nil` happens before the goroutine sends, the goroutine's `ch` (via closure) is *also* nil now, so it parks on send. Main parks on receive. Deadlock.

### Q44. Can you have a nil channel of a directional type?

**A.** Yes. `var ch chan<- int` and `var ch <-chan int` are valid; both are nil. The directional restriction is purely a compile-time check; the runtime treats them identically. A nil receive-only channel blocks forever on `<-ch`; a nil send-only channel blocks forever on `ch <- v`.

### Q45. What does this print?

```go
var ch chan int
ch2 := make(chan int)
fmt.Println(ch == ch2) // ?
```

**A.** `false`. Channel comparison is by pointer identity. `ch` is nil; `ch2` points to an `hchan`. They are not equal.

---

## Wrap-up

Nil-channel questions test three things:

1. **Knowledge of the rules** — block forever, panic on close, skip in `select`.
2. **Awareness of patterns** — off-switch, drain-then-disable, pause/resume.
3. **Architectural judgement** — when to nil, when to close, when to cancel.

A junior should know the rules. A middle engineer should know the patterns. A senior engineer should choose the right tool for the architecture and predict where the bugs will hide. A staff engineer should design APIs and observability such that nil-channel leaks are impossible (or, failing impossibility, surfaced within minutes of occurrence).
