# Generator Pattern — Find the Bug

Each section presents code that *looks* like a working generator. Find the bug, then read the explanation.

---

## Bug 1. The forgotten close

```go
func Gen(values ...int) <-chan int {
    out := make(chan int)
    go func() {
        for _, v := range values {
            out <- v
        }
    }()
    return out
}
```

**Symptom.** Consumer's `for v := range gen(...)` runs forever; the program hangs after the last value.

**Root cause.** The goroutine never closes `out`. `range` exits only when the channel is closed; since it is not, the consumer blocks on the next receive.

**Fix.**
```go
go func() {
    defer close(out)
    for _, v := range values {
        out <- v
    }
}()
```

---

## Bug 2. Defer order

```go
func Lines(path string) <-chan string {
    out := make(chan string)
    go func() {
        f, err := os.Open(path)
        if err != nil {
            return
        }
        defer close(out)
        defer f.Close()
        s := bufio.NewScanner(f)
        for s.Scan() {
            out <- s.Text()
        }
    }()
    return out
}
```

**Symptom.** On a missing file, the consumer's `range` hangs forever.

**Root cause.** When `os.Open` fails, the goroutine returns *before* `defer close(out)` is registered. The channel is never closed.

**Fix.** Defer the close first, then open the file. Surface setup errors synchronously:

```go
func Lines(path string) (<-chan string, error) {
    f, err := os.Open(path)
    if err != nil {
        return nil, err
    }
    out := make(chan string)
    go func() {
        defer close(out)
        defer f.Close()
        s := bufio.NewScanner(f)
        for s.Scan() {
            out <- s.Text()
        }
    }()
    return out, nil
}
```

---

## Bug 3. Missing cancel case

```go
func Counter(done <-chan struct{}) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for i := 0; ; i++ {
            out <- i
            if isDone(done) {
                return
            }
        }
    }()
    return out
}

func isDone(done <-chan struct{}) bool {
    select {
    case <-done:
        return true
    default:
        return false
    }
}
```

**Symptom.** After `close(done)`, the goroutine still leaks under load. The counter sometimes never stops.

**Root cause.** The cancel check happens *after* the send. If the consumer stops reading, `out <- i` blocks forever; `isDone(done)` never runs. The check must be on the send itself.

**Fix.**
```go
for i := 0; ; i++ {
    select {
    case <-done:
        return
    case out <- i:
    }
}
```

---

## Bug 4. Spurious default

```go
for i := 0; ; i++ {
    select {
    case <-ctx.Done():
        return
    case out <- i:
    default:
    }
}
```

**Symptom.** CPU pegs at 100%. The counter blasts items so fast the consumer cannot keep up.

**Root cause.** The `default` makes the `select` non-blocking. When `out <- i` would block, the select returns via `default`, the loop iterates immediately, and the CPU melts. `i` is incremented even when no send happened, so values are also skipped.

**Fix.** Remove the `default`. A `select` without `default` blocks until a case is ready, which is what you want.

---

## Bug 5. Close-on-return-after-panic

```go
func Lines(ctx context.Context, path string) <-chan string {
    out := make(chan string)
    go func() {
        defer close(out)
        f, err := os.Open(path)
        if err != nil {
            panic(err)
        }
        defer f.Close()
        // ...
    }()
    return out
}
```

**Symptom.** Consumer sees a closed channel and assumes EOF. The program continues. Hours later, an investigation reveals the file was never opened.

**Root cause.** `panic` runs deferred functions, including `defer close(out)`. The consumer cannot tell EOF from panic. Worse, the program crashes the next time the runtime gets around to it, but the consumer has already moved on.

**Fix.** Either return setup errors synchronously, or wrap the panic and emit it on the channel:

```go
defer func() {
    if r := recover(); r != nil {
        // optionally emit a streaming error on a side channel
        log.Error("generator panic", "err", r)
    }
    close(out)
}()
```

---

## Bug 6. Multiple producers, one closer race

```go
func Merge(a, b <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for v := range a {
            out <- v
        }
    }()
    go func() {
        defer close(out)
        for v := range b {
            out <- v
        }
    }()
    return out
}
```

**Symptom.** Random panic: `close of closed channel`.

**Root cause.** Two goroutines both defer `close(out)`. Whichever finishes first closes the channel; the second's `defer close(out)` panics. Also: whichever is *still sending* when the other closes will panic on `send on closed channel`.

**Fix.** One closer goroutine that waits for both producers:

```go
func Merge(a, b <-chan int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup
    wg.Add(2)
    go func() {
        defer wg.Done()
        for v := range a {
            out <- v
        }
    }()
    go func() {
        defer wg.Done()
        for v := range b {
            out <- v
        }
    }()
    go func() {
        wg.Wait()
        close(out)
    }()
    return out
}
```

---

## Bug 7. Cancel only at the top

```go
func Pages(ctx context.Context, fetch func(string) (Page, error)) <-chan Item {
    out := make(chan Item)
    go func() {
        defer close(out)
        cursor := ""
        for {
            select {
            case <-ctx.Done():
                return
            default:
            }
            page, err := fetch(cursor)
            if err != nil {
                return
            }
            for _, it := range page.Items {
                out <- it
            }
            if page.Next == "" {
                return
            }
            cursor = page.Next
        }
    }()
    return out
}
```

**Symptom.** Cancellation works between pages, but if a page has 10,000 items, the goroutine takes seconds to respond to cancel — and may leak if the consumer stops reading mid-page.

**Root cause.** Cancellation is observed only between pages. The inner `out <- it` is plain, so the goroutine blocks there indefinitely if the consumer stops reading.

**Fix.** Move the cancel into the inner `select`:

```go
for _, it := range page.Items {
    select {
    case <-ctx.Done():
        return
    case out <- it:
    }
}
```

---

## Bug 8. Returning bidirectional channel

```go
func Gen(values ...int) chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for _, v := range values {
            out <- v
        }
    }()
    return out
}
```

**Symptom.** A consumer calls `close(ch)` early, panicking the producer with `send on closed channel`. Or sends a value, racing the producer.

**Root cause.** Returning `chan int` (bidirectional) lets the caller close or send. Both are illegal for a generator.

**Fix.** Return `<-chan int`:

```go
func Gen(values ...int) <-chan int { ... }
```

---

## Bug 9. Setup error swallowed

```go
func Lines(ctx context.Context, path string) <-chan string {
    out := make(chan string)
    go func() {
        defer close(out)
        f, err := os.Open(path)
        if err != nil {
            return
        }
        defer f.Close()
        s := bufio.NewScanner(f)
        for s.Scan() {
            select {
            case <-ctx.Done():
                return
            case out <- s.Text():
            }
        }
    }()
    return out
}
```

**Symptom.** Caller cannot tell "file is empty" from "file does not exist". Both look like a closed channel with zero values.

**Root cause.** Setup error swallowed silently. The caller has no way to know production never started.

**Fix.** Return setup errors synchronously:

```go
func Lines(ctx context.Context, path string) (<-chan string, error) {
    f, err := os.Open(path)
    if err != nil {
        return nil, err
    }
    out := make(chan string)
    go func() { ... }()
    return out, nil
}
```

---

## Bug 10. Buffer hides deadlock

```go
func Worker(in <-chan int, out chan<- int) {
    for v := range in {
        if v == 0 {
            // intentionally block to test backpressure
            time.Sleep(time.Hour)
        }
        out <- v * 2
    }
}

func main() {
    src := Gen(1, 2, 3, 0, 4, 5)
    out := make(chan int, 10) // generous buffer
    go Worker(src, out)
    for v := range out {
        fmt.Println(v)
    }
}
```

**Symptom.** In tests with a small buffer, the deadlock surfaces immediately. With `buffer=10`, the program prints 1, 2, 3 then hangs — and the test passes locally but fails in CI.

**Root cause.** Buffers absorb backpressure up to their capacity. The deadlock (when `Worker` sleeps on `v==0`) is hidden as long as the buffer accepts the previous values. The hang happens only after `cap` items are queued.

**Fix.** Default to unbuffered channels. Add buffer only with measurement and justification. Stress-test with small buffers in CI to surface latent deadlocks.

---

## Bug 11. Closure captures by reference

```go
func GenAll(slices [][]int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for _, s := range slices {
            for _, v := range s {
                out <- v
            }
        }
    }()
    return out
}
```

This is fine. But consider the broken version:

```go
func GenAll(slices [][]int) []<-chan int {
    var gens []<-chan int
    for _, s := range slices {
        out := make(chan int)
        go func() {
            defer close(out)
            for _, v := range s { // BUG: captures s by reference (pre-Go 1.22)
                out <- v
            }
        }()
        gens = append(gens, out)
    }
    return gens
}
```

**Symptom.** Pre-Go 1.22, every generator yields the values of the *last* slice, not its own. Post-Go 1.22, this is fixed by the new loopvar semantics, but the bug still appears in older Go versions.

**Root cause.** Loop variable `s` was shared across iterations until Go 1.22. The closure captured the *variable*, not the *value*.

**Fix (any Go version).** Pass the value as a function argument:

```go
for _, s := range slices {
    s := s // shadow (Go <1.22)
    go func(s []int) {
        // use s
    }(s)
}
```

---

## Bug 12. Returning before goroutine spawns

```go
func Counter(ctx context.Context) <-chan int {
    out := make(chan int)
    if ctx.Err() != nil {
        return out
    }
    go func() {
        defer close(out)
        for i := 0; ; i++ {
            select {
            case <-ctx.Done():
                return
            case out <- i:
            }
        }
    }()
    return out
}
```

**Symptom.** Calling `Counter` with an already-cancelled `ctx` returns a non-closed channel. Consumer hangs on the first receive.

**Root cause.** Early return skips both the goroutine spawn *and* the close. The channel exists but nobody owns it.

**Fix.** If you must early-return on a cancelled context, close the channel first:

```go
if ctx.Err() != nil {
    close(out)
    return out
}
```

Or just spawn the goroutine; the `<-ctx.Done()` case fires immediately and `defer close(out)` runs.

---

## Bug 13. Two consumers expecting all values

```go
src := Gen(1, 2, 3, 4, 5, 6)
go func() {
    for v := range src {
        fmt.Println("A:", v)
    }
}()
for v := range src {
    fmt.Println("B:", v)
}
```

**Symptom.** Each consumer sees only some of the values. The user expected both to see all six.

**Root cause.** A channel is a *queue*. Each value is delivered to exactly one receiver. Two consumers split the stream, they do not duplicate it.

**Fix.** Use `tee` to duplicate the stream:

```go
a, b := Tee(ctx, src)
// a and b each see all 6 values
```

---

## Bug 14. Forgot to drain after cancel

```go
ctx, cancel := context.WithCancel(context.Background())
ch := Counter(ctx)
<-ch
cancel()
// program exits here
```

**Symptom.** `goleak` reports a leaked goroutine.

**Root cause.** After `cancel()`, the producer goroutine wants to exit, but the channel may have one buffered value queued (or the producer is mid-send). Without a final drain, the goroutine sits waiting for the consumer one last time.

**Fix.** Drain after cancel:

```go
cancel()
for range ch {
}
```

Or build the generator to be tolerant of fast cancel paths.

---

## Bug 15. Sending nil to mean EOF

```go
func Words(text string) <-chan string {
    out := make(chan string)
    go func() {
        for _, w := range strings.Fields(text) {
            out <- w
        }
        out <- "" // "EOF marker"
    }()
    return out
}

// Consumer:
for w := range words {
    if w == "" {
        break
    }
    fmt.Println(w)
}
```

**Symptom.** Consumer hangs after `break` because the channel is never closed. Producer hangs on the next call (if multiple words).

**Root cause.** `close` is the correct EOF signal. Sending a sentinel value couples producer and consumer to a magic value and prevents `range` from terminating.

**Fix.**
```go
go func() {
    defer close(out)
    for _, w := range strings.Fields(text) {
        out <- w
    }
}()
```

Consumer just `range`s; `range` exits when the channel closes.

---

Each of these bugs is real: most appear in production code somewhere right now. Walk through them, write the broken version, then the fix. Your future self will thank you.
