# Fan-In — Find the Bug

> Each snippet contains a real-world fan-in bug: leaked goroutines, double-closes, dropped values, races, broken cancellation, and the long tail of merge-day surprises. Read the snippet first. Try to spot the bug yourself before reading the explanation. The fix is provided at the end of every section, with a brief discussion of what the original author probably intended.

---

## Bug 1 — Leaked merge goroutines on early consumer exit

```go
func Merge[T any](cs ...<-chan T) <-chan T {
    out := make(chan T)
    var wg sync.WaitGroup
    wg.Add(len(cs))
    for _, c := range cs {
        go func(c <-chan T) {
            defer wg.Done()
            for v := range c {
                out <- v
            }
        }(c)
    }
    go func() { wg.Wait(); close(out) }()
    return out
}

func main() {
    a := genForever(1)
    b := genForever(100)

    for v := range Merge(a, b) {
        fmt.Println(v)
        if v == 5 {
            break // <-- early exit
        }
    }
}
```

**Bug:** The consumer breaks out of the loop after seeing `5`, but every forwarder is still sitting on `out <- v`. Nothing reads from `out` anymore. Each forwarder blocks forever. The producers also block (they cannot push into a forwarder that is blocked on send). The whole pipeline leaks.

**Why it is hard to spot:** It compiles, the test that consumes everything passes, and the leak only manifests when someone stops reading early — exactly the case unit tests rarely cover.

**Fix:** Pass a `context.Context` and gate sends with a select. When the consumer is done, cancel the context.

```go
func Merge[T any](ctx context.Context, cs ...<-chan T) <-chan T {
    out := make(chan T)
    var wg sync.WaitGroup
    wg.Add(len(cs))
    for _, c := range cs {
        go func(c <-chan T) {
            defer wg.Done()
            for {
                select {
                case <-ctx.Done():
                    return
                case v, ok := <-c:
                    if !ok { return }
                    select {
                    case <-ctx.Done(): return
                    case out <- v:
                    }
                }
            }
        }(c)
    }
    go func() { wg.Wait(); close(out) }()
    return out
}

// caller:
ctx, cancel := context.WithCancel(context.Background())
defer cancel()
for v := range Merge(ctx, a, b) {
    if v == 5 { cancel(); break }
}
```

The `defer cancel()` is the safety net. Even on a panic the forwarders unwind.

---

## Bug 2 — Output channel closed twice (panic)

```go
func merge(a, b <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        for v := range a {
            out <- v
        }
        close(out)
    }()
    go func() {
        for v := range b {
            out <- v
        }
        close(out)
    }()
    return out
}
```

**Bug:** Each forwarder closes `out` when its input is drained. Whichever forwarder finishes second panics with `panic: close of closed channel`. The fact that "the merge sometimes works" depends entirely on whether `a` or `b` is empty.

**Why it is hard to spot:** With `b` empty (closed immediately) and `a` non-empty, `b`'s forwarder closes `out` first. Then `a`'s forwarder calls `out <- v` on a closed channel and panics with `panic: send on closed channel`. With both non-empty, the second forwarder panics with `close of closed channel`. Different panics depending on timing.

**Fix:** A single closer goroutine that waits on a WaitGroup. Forwarders never close.

```go
func merge(a, b <-chan int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup
    wg.Add(2)
    forward := func(c <-chan int) {
        defer wg.Done()
        for v := range c { out <- v }
    }
    go forward(a)
    go forward(b)
    go func() { wg.Wait(); close(out) }()
    return out
}
```

Rule: **only one place closes `out`, and that place is not a forwarder.**

---

## Bug 3 — Dropping values when the consumer is slow

```go
func Merge[T any](cs ...<-chan T) <-chan T {
    out := make(chan T, 1) // tiny buffer
    var wg sync.WaitGroup
    wg.Add(len(cs))
    for _, c := range cs {
        go func(c <-chan T) {
            defer wg.Done()
            for v := range c {
                select {
                case out <- v:
                default: // drop on full buffer
                }
            }
        }(c)
    }
    go func() { wg.Wait(); close(out) }()
    return out
}
```

**Bug:** The author tried to "avoid blocking" by using a `default` branch on the send. The intent was probably "be lossy under pressure", but a fan-in helper should not silently drop data. The caller of `Merge` cannot tell whether `out` saw every value or only some — and the bug shows up only when the consumer is slow, in production, where it is hardest to debug.

**Why it is hard to spot:** Tests that drain `out` faster than producers fill it never trigger the drop. The contract violation only appears on the consumer's slow path.

**Fix:** Remove the `default` branch. If you want a bounded queue with explicit dropping, build it as a separate stage with logging or metrics on the drop.

```go
for v := range c {
    out <- v // back-pressures naturally
}
```

If lossiness is a feature, expose it: `MergeLossy[T any](cs ...<-chan T) (<-chan T, *DropCounter)` so the caller knows what to expect.

---

## Bug 4 — Deadlock from unsynchronised close

```go
func merge[T any](cs ...<-chan T) <-chan T {
    out := make(chan T)
    var done int
    for _, c := range cs {
        go func(c <-chan T) {
            for v := range c { out <- v }
            done++
            if done == len(cs) {
                close(out)
            }
        }(c)
    }
    return out
}
```

**Bug:** `done` is incremented from multiple goroutines without synchronisation. This is a data race. Worse, the test `done == len(cs)` may be true in zero, one, or all goroutines depending on timing. If two goroutines both see "I am the last one", both call `close(out)` and the second panics. If none see it (because of the race), `out` is never closed and the consumer hangs.

**Why it is hard to spot:** With small N and small data, the race usually does not fire. With the `-race` flag, the data race is reported immediately, but plenty of teams forget to run with `-race`.

**Fix:** Use `sync.WaitGroup`. Do not roll your own counter.

```go
func merge[T any](cs ...<-chan T) <-chan T {
    out := make(chan T)
    var wg sync.WaitGroup
    wg.Add(len(cs))
    for _, c := range cs {
        go func(c <-chan T) {
            defer wg.Done()
            for v := range c { out <- v }
        }(c)
    }
    go func() { wg.Wait(); close(out) }()
    return out
}
```

If you really need a custom counter, it must be `atomic.Int64` and only one goroutine may call `close(out)` (use `sync.Once`).

---

## Bug 5 — Race on output channel during close

```go
type Pipe[T any] struct {
    out chan T
}

func (p *Pipe[T]) Send(v T) { p.out <- v }
func (p *Pipe[T]) Close()   { close(p.out) }

func merge[T any](cs []*Pipe[T]) <-chan T {
    out := make(chan T)
    var wg sync.WaitGroup
    wg.Add(len(cs))
    for _, c := range cs {
        go func(c *Pipe[T]) {
            defer wg.Done()
            for v := range c.out { out <- v }
        }(c)
    }
    go func() { wg.Wait(); close(out) }()

    // closer for cancellation
    go func() {
        <-time.After(100 * time.Millisecond)
        close(out)
    }()
    return out
}
```

**Bug:** Two closer goroutines exist. One closes after `wg.Wait`. Another closes after 100ms. They race. Whichever runs second panics with `close of closed channel`. If a forwarder happens to be sending right when the timer fires, it panics with `send on closed channel`.

**Why it is hard to spot:** The author was probably trying to add a "deadline" on top of a normal merge. The two close paths look unrelated until you trace the goroutines.

**Fix:** There must be exactly one path that closes the output. Use a context for cancellation; let the WaitGroup-driven closer remain the only closer.

```go
func merge[T any](ctx context.Context, cs []*Pipe[T]) <-chan T {
    out := make(chan T)
    var wg sync.WaitGroup
    wg.Add(len(cs))
    for _, c := range cs {
        go func(c *Pipe[T]) {
            defer wg.Done()
            for {
                select {
                case <-ctx.Done(): return
                case v, ok := <-c.out:
                    if !ok { return }
                    select {
                    case <-ctx.Done(): return
                    case out <- v:
                    }
                }
            }
        }(c)
    }
    go func() { wg.Wait(); close(out) }()
    return out
}

// caller controls the deadline
ctx, cancel := context.WithTimeout(parent, 100*time.Millisecond)
defer cancel()
```

Cancellation lives in the context, not in a second close path.

---

## Bug 6 — Generic merge bug with channel direction

```go
func Merge[T any](cs ...chan T) chan T {
    out := make(chan T)
    var wg sync.WaitGroup
    wg.Add(len(cs))
    for _, c := range cs {
        go func(c chan T) {
            defer wg.Done()
            for v := range c { out <- v }
        }(c)
    }
    go func() { wg.Wait(); close(out) }()
    return out
}
```

**Bug:** The signature uses `chan T` (bidirectional) for both inputs and the return value. A caller can now `close(merged)` from the outside, panicking the closer goroutine. A caller can also `merged <- v` and inject values that no forwarder produced. The merge has lost ownership of its output.

**Why it is hard to spot:** It compiles, runs, and passes most tests. The bug only fires when a downstream developer mistakes the merged channel for a normal one and tries to close it ("just to be safe").

**Fix:** Inputs as receive-only, output as receive-only.

```go
func Merge[T any](cs ...<-chan T) <-chan T {
    out := make(chan T)
    var wg sync.WaitGroup
    wg.Add(len(cs))
    for _, c := range cs {
        go func(c <-chan T) {
            defer wg.Done()
            for v := range c { out <- v }
        }(c)
    }
    go func() { wg.Wait(); close(out) }()
    return out
}
```

The compiler now refuses any caller's attempt to close or send on the merged channel.

---

## Bug 7 — Forgotten `Done()` in merge worker

```go
func Merge[T any](cs ...<-chan T) <-chan T {
    out := make(chan T)
    var wg sync.WaitGroup
    wg.Add(len(cs))
    for _, c := range cs {
        go func(c <-chan T) {
            for v := range c {
                out <- v
            }
            // forgot wg.Done()
        }(c)
    }
    go func() { wg.Wait(); close(out) }()
    return out
}
```

**Bug:** The forwarder never calls `wg.Done`. The closer goroutine waits forever; `out` is never closed; the consumer's `for range out` never returns.

**Why it is hard to spot:** It looks fine on inspection — the loop is in the right place, the `Add` count matches `len(cs)`. The omission of one line breaks the whole pipeline silently.

**Fix:** Always use `defer wg.Done()` as the very first line of the goroutine body. `defer` survives panics and early returns.

```go
go func(c <-chan T) {
    defer wg.Done()
    for v := range c {
        out <- v
    }
}(c)
```

Treat the pair `wg.Add(1)` ... `defer wg.Done()` as a single atomic edit. If you write one without the other, you have a bug.

---

## Bug 8 — `reflect.Select` with the wrong `SelectCase` setup

```go
func MergeReflect[T any](cs ...<-chan T) <-chan T {
    out := make(chan T)
    cases := make([]reflect.SelectCase, len(cs))
    for i, c := range cs {
        cases[i] = reflect.SelectCase{
            Dir: reflect.SelectSend,            // <-- WRONG: should be Recv
            Chan: reflect.ValueOf(c),
        }
    }
    go func() {
        defer close(out)
        for len(cases) > 0 {
            i, v, ok := reflect.Select(cases)
            if !ok {
                cases = append(cases[:i], cases[i+1:]...)
                continue
            }
            out <- v.Interface().(T)
        }
    }()
    return out
}
```

**Bug:** `Dir: reflect.SelectSend` declares each case as a *send* on the input channel. But the inputs are receive-only and the goroutine is supposed to read from them, not write to them. `reflect.Select` will panic at the first iteration with "reflect.Select: SendDir case missing Send".

**Why it is hard to spot:** Authors copying `SelectCase` examples sometimes pick the wrong direction. The compiler accepts it because `Dir` is a runtime field. The panic only fires when `reflect.Select` is actually invoked.

**Fix:** Use `reflect.SelectRecv`. For send cases, you would also need to set the `Send reflect.Value` field.

```go
cases[i] = reflect.SelectCase{
    Dir:  reflect.SelectRecv,
    Chan: reflect.ValueOf(c),
}
```

When the case fires, `recv reflect.Value` is the value pulled from the channel; `recvOK bool` is false if the channel was closed.

---

## Bug 9 — Capacity-zero output channel starving producers

```go
func Merge[T any](cs ...<-chan T) <-chan T {
    out := make(chan T) // unbuffered; that's fine
    var wg sync.WaitGroup
    wg.Add(len(cs))
    for _, c := range cs {
        go func(c <-chan T) {
            defer wg.Done()
            for v := range c { out <- v }
        }(c)
    }
    go func() { wg.Wait(); close(out) }()
    return out
}

func main() {
    a := gen(1, 2, 3)
    b := gen(10, 20, 30)
    out := Merge(a, b)

    // Consumer doesn't actually read until later.
    time.Sleep(100 * time.Millisecond)
    for v := range out {
        fmt.Println(v)
    }
}
```

**Bug:** The consumer sleeps before reading. With an unbuffered output, every forwarder blocks on its first `out <- v` send until the consumer is ready. The producers also block (because forwarders cannot drain them). For 100ms the entire pipeline is frozen — the merge is correct, but the *system* hangs.

**Why it is hard to spot:** The merge is technically correct. The bug is interaction-level: a contract that a fast consumer must be ready, paired with a consumer that delays. Code review focused on the merge in isolation will miss it.

**Fix:** Either drain immediately on the consumer side, or give the merge a small buffer to absorb the latency:

```go
out := make(chan T, len(cs)) // one slot per forwarder
```

Document the contract: "the merge produces backpressure; a consumer must read promptly."

---

## Bug 10 — Premature close before producers finish

```go
func Merge[T any](cs ...<-chan T) <-chan T {
    out := make(chan T)
    var wg sync.WaitGroup
    for _, c := range cs {
        go func(c <-chan T) {
            wg.Add(1) // <-- WRONG: Add inside the goroutine
            defer wg.Done()
            for v := range c { out <- v }
        }(c)
    }
    go func() { wg.Wait(); close(out) }()
    return out
}
```

**Bug:** `wg.Add(1)` is called inside the forwarder goroutine. The closer goroutine may run `wg.Wait()` *before* any forwarder has executed its `Add`. With counter zero, `Wait` returns immediately and `close(out)` runs while forwarders are still alive. They then attempt `out <- v` on a closed channel and panic.

**Why it is hard to spot:** With one input it usually works because the scheduler tends to start the forwarder before the closer. With many inputs and a busy CPU it fails almost every time.

**Fix:** `Add` before `go`. Always.

```go
wg.Add(len(cs))
for _, c := range cs {
    go func(c <-chan T) {
        defer wg.Done()
        for v := range c { out <- v }
    }(c)
}
```

The rule: a `WaitGroup`'s counter must be incremented in the goroutine that *will eventually call* `Wait`, before launching the goroutines being waited on. Doing the `Add` inside the goroutine being launched is a classic race.

---

## Bug 11 — Forwarder shared between two channels

```go
func Merge[T any](a, b <-chan T) <-chan T {
    out := make(chan T)
    go func() {
        defer close(out)
        for {
            select {
            case v, ok := <-a:
                if !ok { return }
                out <- v
            case v, ok := <-b:
                if !ok { return }
                out <- v
            }
        }
    }()
    return out
}
```

**Bug:** The single `select`-based forwarder returns as soon as **either** input closes. Values still in the other input are dropped. With `a` short and `b` long, the merge ends prematurely; with `b` short, again the same.

**Why it is hard to spot:** The fix-up is subtle: the author probably wanted "stop when both are closed", but the `if !ok { return }` aborts on the first close. The test "send 3 to a, 0 to b, close both" passes; the test "send 3 to a, 5 to b, close a first" fails silently.

**Fix:** Use the nil-channel trick — a nil channel never fires in a `select`. Set `a = nil` after it closes; loop until both are nil.

```go
func Merge[T any](a, b <-chan T) <-chan T {
    out := make(chan T)
    go func() {
        defer close(out)
        for a != nil || b != nil {
            select {
            case v, ok := <-a:
                if !ok { a = nil; continue }
                out <- v
            case v, ok := <-b:
                if !ok { b = nil; continue }
                out <- v
            }
        }
    }()
    return out
}
```

Now the `select` keeps running until both inputs are drained.

---

## Bug 12 — Nil input channel hangs the merge

```go
func Merge[T any](cs ...<-chan T) <-chan T {
    out := make(chan T)
    var wg sync.WaitGroup
    wg.Add(len(cs))
    for _, c := range cs {
        go func(c <-chan T) {
            defer wg.Done()
            for v := range c { out <- v }
        }(c)
    }
    go func() { wg.Wait(); close(out) }()
    return out
}

// caller
out := Merge(a, nil, b)
```

**Bug:** A `range` over a `nil` channel blocks forever. The forwarder for the nil input never returns; `wg.Done` is never called; `out` is never closed; the consumer hangs.

**Why it is hard to spot:** The caller passed `nil` accidentally — perhaps they conditionally constructed a channel and forgot the `else` branch. The merge looks correct in isolation; the bug is at the caller site, but its symptoms appear in the merge.

**Fix:** Filter nil inputs at the entry of the merge, with a clear contract that nil is invalid.

```go
func Merge[T any](cs ...<-chan T) <-chan T {
    filtered := cs[:0]
    for _, c := range cs {
        if c != nil {
            filtered = append(filtered, c)
        }
    }
    cs = filtered
    // ... rest as before
}
```

Or panic on nil, depending on whether you treat nil as "no input" (skip) or "programmer error" (panic). Document the choice.

---

## Bug 13 — Send on closed `out` after late producer

```go
func Merge[T any](ctx context.Context, cs ...<-chan T) <-chan T {
    out := make(chan T)
    var wg sync.WaitGroup
    wg.Add(len(cs))
    for _, c := range cs {
        go func(c <-chan T) {
            defer wg.Done()
            for v := range c {
                select {
                case <-ctx.Done():
                    return
                case out <- v:
                }
            }
        }(c)
    }
    go func() {
        select {
        case <-ctx.Done():
            close(out) // close on cancel
        }
    }()
    go func() {
        wg.Wait()
        close(out) // close on completion
    }()
    return out
}
```

**Bug:** Two closer goroutines, again. On cancellation, both fire: one immediately on `ctx.Done()`, another after `wg.Wait()` completes once the forwarders unwind. The second `close(out)` panics. There may also be a forwarder mid-send when the cancel-closer runs, producing `send on closed channel`.

**Why it is hard to spot:** It looks like a thoughtful "close on cancel" addition. The author forgot that `wg.Wait()` will *also* finish after cancel (because forwarders will return) and therefore the WG-closer will also try to close.

**Fix:** Only one closer. Have the WG-closer be authoritative. Cancellation makes forwarders return, the WG counter drops, the WG-closer fires once.

```go
go func() { wg.Wait(); close(out) }()
```

Drop the cancel-closer entirely.

---

## Bug 14 — Forwarder reads after close (use of stale value)

```go
go func(c <-chan T) {
    defer wg.Done()
    for {
        v, ok := <-c
        if !ok {
            // channel closed; emit zero value as sentinel
            out <- v
            return
        }
        out <- v
    }
}(c)
```

**Bug:** When the channel is closed, `v` is the zero value of `T`. Sending it on `out` injects a phantom message into the merged stream. Consumers see an "extra" value at the end of each input.

**Why it is hard to spot:** Tests with non-zero values may pass because the consumer ignores the trailing zero. With `T = int`, an extra `0` slips into the output and changes counts.

**Fix:** Just `return` when `!ok`. Do not emit the zero.

```go
v, ok := <-c
if !ok { return }
out <- v
```

Or simpler, use `range`:

```go
for v := range c {
    out <- v
}
```

---

## Bug 15 — Loop variable captured in closure (pre-Go 1.22)

```go
// Compiled with Go 1.21 or earlier
func Merge[T any](cs ...<-chan T) <-chan T {
    out := make(chan T)
    var wg sync.WaitGroup
    wg.Add(len(cs))
    for _, c := range cs {
        go func() {
            defer wg.Done()
            for v := range c { out <- v } // captures c
        }()
    }
    go func() { wg.Wait(); close(out) }()
    return out
}
```

**Bug:** Before Go 1.22, the loop variable `c` was a single variable reused across iterations. Every goroutine captured the *same* `c`, which by the time the goroutines run is the last channel in `cs`. The merge effectively reads from the last channel `len(cs)` times and ignores the others. Earlier inputs are never drained, so their producers block forever.

**Why it is hard to spot:** With Go 1.22+ this bug disappears because the loop variable scoping changed. Many codebases pinning to older Go versions still have it. With one input it appears to work; with N > 1 it leaks N-1 producers.

**Fix:** Pass the channel into the goroutine as an argument, or upgrade to Go 1.22+.

```go
for _, c := range cs {
    go func(c <-chan T) {
        defer wg.Done()
        for v := range c { out <- v }
    }(c)
}
```

The `c <-chan T` parameter creates a fresh variable per goroutine. This idiom is harmless under Go 1.22+ and required under earlier versions — write it always.

---

## Wrap-up

The bugs above cluster into a few families:

1. **Closing the output wrong** — twice, never, or from the wrong goroutine (#2, #4, #5, #7, #10, #13).
2. **Cancellation that does not propagate** — leaked forwarders on early consumer exit (#1, #3).
3. **Concurrency primitives misused** — race on counters, `Add` after `go`, captured loop variables (#4, #10, #15).
4. **Direction and signature mistakes** — bidirectional channels exposed to callers, wrong `reflect.Select` direction (#6, #8).
5. **Edge-case inputs** — nil, empty, premature-close, zero-value sentinel (#11, #12, #14).

The strongest defence against all of them is a small, idiomatic merge function copy-pasted from a tested utility package — *not* re-derived per project. Once you have one good `Merge[T]`, never write another.
