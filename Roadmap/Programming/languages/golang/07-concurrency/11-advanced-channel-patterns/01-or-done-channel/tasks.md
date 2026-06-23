# Or-Done-Channel — Practice Tasks

A set of graded exercises to build fluency with the pattern. Each task includes the goal, constraints, hints, and a discussion of acceptable solutions.

---

## Task 1: Write `orDone` from memory

### Goal

Implement the canonical generic `orDone` function in Go 1.18+ form.

### Specification

```go
func orDone[T any](done <-chan struct{}, c <-chan T) <-chan T
```

### Requirements

- Spawns exactly one goroutine.
- Closes the returned channel exactly once.
- Exits on `done` close or `c` close.
- Does not close `c`.

### Hints

- Use `defer close(out)`.
- Two nested `select` statements.
- Inner select must observe `done`.

### Test

```go
func TestOrDoneBasic(t *testing.T) {
    done := make(chan struct{})
    in := make(chan int, 3)
    in <- 1; in <- 2; in <- 3; close(in)

    var got []int
    for v := range orDone(done, in) {
        got = append(got, v)
    }
    if len(got) != 3 {
        t.Fatalf("expected 3 values, got %d", len(got))
    }
}
```

### Discussion

Write this without looking at the textbook. If you cannot, re-read the junior file and try again. Reaching the point where you can sketch `orDone` on a whiteboard in 60 seconds is the milestone for "you understand the pattern."

---

## Task 2: Build `take`

### Goal

Write a combinator that takes the first `n` values from a stream, then stops.

### Specification

```go
func take[T any](done <-chan struct{}, c <-chan T, n int) <-chan T
```

### Requirements

- Forwards up to `n` values from `c` to the output.
- Closes the output after `n` values *or* on `done` *or* on `c` close.
- Does not block beyond what `orDone` would.

### Hints

- Build `take` *on top of* `orDone`. Do not re-implement the cancellation logic.
- Count emitted values; return when count reaches `n`.

### Solution outline

```go
func take[T any](done <-chan struct{}, c <-chan T, n int) <-chan T {
    out := make(chan T)
    go func() {
        defer close(out)
        i := 0
        for v := range orDone(done, c) {
            if i >= n {
                return
            }
            select {
            case out <- v:
                i++
            case <-done:
                return
            }
        }
    }()
    return out
}
```

### Discussion

`take` is a sibling of `orDone`. Building it shows two things: (1) combinators compose naturally; (2) the dual-select pattern repeats inside every forwarding stage.

---

## Task 3: Implement `tee`

### Goal

Split one input channel into two output channels, where each output receives every value from the input.

### Specification

```go
func tee[T any](done <-chan struct{}, c <-chan T) (<-chan T, <-chan T)
```

### Requirements

- Both outputs receive every value from `c`, in order.
- Closes both outputs on `done` or `c` close.
- Does not deadlock if one consumer reads slowly.

### Hints

- For each value, send to *both* outputs.
- Use nil-channel trick: after sending to one output, set it to nil so the next select picks the other.
- Wrap the input with `orDone(done, c)` to inherit cancellation.

### Solution outline

```go
func tee[T any](done <-chan struct{}, c <-chan T) (<-chan T, <-chan T) {
    out1, out2 := make(chan T), make(chan T)
    go func() {
        defer close(out1)
        defer close(out2)
        for v := range orDone(done, c) {
            var a, b = out1, out2
            for i := 0; i < 2; i++ {
                select {
                case <-done:
                    return
                case a <- v:
                    a = nil
                case b <- v:
                    b = nil
                }
            }
        }
    }()
    return out1, out2
}
```

### Discussion

The nil-channel trick is essential: after sending to `a`, setting `a = nil` makes the `case a <- v` permanently non-selectable, so the next iteration must pick `b`. Without this, the loop might send to `a` twice and `b` zero times.

---

## Task 4: Implement `bridge`

### Goal

Flatten a stream of channels into one stream.

### Specification

```go
func bridge[T any](done <-chan struct{}, chans <-chan <-chan T) <-chan T
```

### Requirements

- For each channel `c` received from `chans`, forward all of `c`'s values in order before moving on to the next channel.
- Close output on `done` or when `chans` is closed (after the last sub-channel is exhausted).

### Hints

- Outer `range` over `chans`, inner `range` over each received channel.
- Wrap both with `orDone(done, ...)` to inherit cancellation.

### Solution outline

```go
func bridge[T any](done <-chan struct{}, chans <-chan <-chan T) <-chan T {
    out := make(chan T)
    go func() {
        defer close(out)
        for {
            var stream <-chan T
            select {
            case <-done:
                return
            case s, ok := <-chans:
                if !ok {
                    return
                }
                stream = s
            }
            for v := range orDone(done, stream) {
                select {
                case out <- v:
                case <-done:
                    return
                }
            }
        }
    }()
    return out
}
```

### Discussion

`bridge` is used when you have a pipeline that produces channels (a "channel of channels") and you want a flat consumer experience. Common in dynamic pipelines where each input stage produces its own short-lived stream.

---

## Task 5: Convert to `context.Context`

### Goal

Convert a `done`-channel-based pipeline to `context.Context`. Keep the same behaviour.

### Starting code

```go
func pipeline(done <-chan struct{}) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for i := 0; ; i++ {
            select {
            case <-done:
                return
            case out <- i:
            }
        }
    }()
    return orDone(done, out)
}
```

### Target

Replace `done <-chan struct{}` with `ctx context.Context` throughout, and use `ctx.Done()` everywhere `done` was used.

### Discussion

Notice that the conversion is mechanical: every `done` becomes `ctx.Done()`, and the caller switches from `close(done)` to `cancel()` (returned by `context.WithCancel`). The pattern's shape is identical.

Take a moment to consider when this conversion is worth doing. In a small program with one cancellation source, the bare `done` channel is simpler. In a service with multiple cancellation reasons (request, server shutdown, deadline), `context.Context` is worth its weight.

---

## Task 6: Compose two done signals

### Goal

Build a function that takes two `done` channels and returns a third that closes when either fires.

### Specification

```go
func anyDone(a, b <-chan struct{}) <-chan struct{}
```

### Requirements

- Returned channel closes when *either* `a` or `b` closes.
- Spawns at most one helper goroutine.
- Does not panic if both `a` and `b` close concurrently.

### Solution outline

```go
func anyDone(a, b <-chan struct{}) <-chan struct{} {
    out := make(chan struct{})
    go func() {
        defer close(out)
        select {
        case <-a:
        case <-b:
        }
    }()
    return out
}
```

### Discussion

The helper goroutine waits for either signal, then closes `out`. The `select` picks whichever closes first; the other can fire afterwards without effect because the goroutine has already exited.

Use this when nesting `orDone(a, orDone(b, c))` would be one goroutine too many.

---

## Task 7: Build a cancellable infinite generator

### Goal

Write a generator that produces an infinite sequence of integers but stops when its `done` is closed.

### Specification

```go
func count(done <-chan struct{}, start int) <-chan int
```

### Requirements

- Sends `start, start+1, start+2, ...` on the output.
- Stops when `done` closes.
- No leaks.

### Solution outline

```go
func count(done <-chan struct{}, start int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for i := start; ; i++ {
            select {
            case <-done:
                return
            case out <- i:
            }
        }
    }()
    return out
}
```

### Test it without `orDone`

```go
done := make(chan struct{})
defer close(done)
for v := range count(done, 1) {
    if v == 10 { break }
    fmt.Println(v)
}
```

This works because `count` itself observes `done` and stops sending; the consumer's `break` ends the loop. No `orDone` needed.

### Test it with `orDone`

```go
done := make(chan struct{})
defer close(done)
for v := range orDone(done, count(done, 1)) {
    if v == 10 { break }
    fmt.Println(v)
}
```

This also works, but adds an extra goroutine and hop. When is the extra wrapper useful? When the producer does *not* observe `done` itself — for instance, a third-party library you cannot modify.

---

## Task 8: Stream pipeline

### Goal

Build a three-stage pipeline that:

1. Generates integers 1, 2, 3, ...
2. Squares each.
3. Sums them, emitting partial sums as the running total.

All stages cancellable via a single `done`.

### Structure

```go
nums := count(done, 1)
squares := square(done, nums)
sums := runningSum(done, squares)
for s := range orDone(done, sums) {
    fmt.Println(s)
    if s > 1000 { close(done); break }
}
```

### Tasks

- Implement `square(done, in)` and `runningSum(done, in)`.
- Each uses `range orDone(done, in)` internally and writes to its output via `select { case out <- v: case <-done: return }`.

### Test the leak

After your code runs, assert via `runtime.NumGoroutine()` (before and after) that no goroutines leaked. Better, use `goleak`.

### Discussion

This is the canonical pipeline shape. Once you can write it from memory, you can build arbitrary stream-processing systems by composition.

---

## Task 9: Drain-on-cancel variant

### Goal

Write `drainOrDone` that, instead of dropping in-flight values when `done` closes, drains the remaining values from `c` before exiting.

### Specification

```go
func drainOrDone[T any](done <-chan struct{}, c <-chan T) <-chan T
```

### Requirements

- Behaviour identical to `orDone` while `done` has not fired.
- When `done` fires, continue forwarding values from `c` until `c` is closed.
- Exits only when `c` is closed (no cancellation observation during drain).

### Solution outline

```go
func drainOrDone[T any](done <-chan struct{}, c <-chan T) <-chan T {
    out := make(chan T)
    go func() {
        defer close(out)
        draining := false
        for {
            if draining {
                v, ok := <-c
                if !ok {
                    return
                }
                out <- v
                continue
            }
            select {
            case <-done:
                draining = true
            case v, ok := <-c:
                if !ok {
                    return
                }
                select {
                case out <- v:
                case <-done:
                    draining = true
                    // still need to deliver v if possible
                    select {
                    case out <- v:
                    default:
                    }
                }
            }
        }
    }()
    return out
}
```

### Discussion

`drainOrDone` is a different cancellation semantic (Drain instead of Drop). The implementation is more delicate than `orDone` because the post-cancel send to `out` must still be cancellable in case the *consumer* also stops reading.

Use cases: graceful shutdown of a queue where each in-flight message represents a side effect (e.g., a payment, an email send) that must not be lost.

---

## Task 10: Goroutine leak test

### Goal

Write a test suite that proves your `orDone` does not leak goroutines under any cancellation scenario.

### Setup

```go
import "go.uber.org/goleak"

func TestMain(m *testing.M) {
    goleak.VerifyTestMain(m)
}
```

### Scenarios to cover

- Done closed before any value is sent.
- Done closed mid-stream.
- Done closed after `c` is closed.
- Consumer stops reading; done closed later.
- `c` closed without `done` ever being closed.
- Nested `orDone(d1, orDone(d2, c))`, with either signal closed.
- Buffered `c` (capacity 16) with all values pre-loaded; done closed before any are read.

### Goal

Every scenario should pass with `goleak` reporting zero leaked goroutines.

### Discussion

This task is the practical test of whether you have implemented `orDone` correctly. The cases above are the same ones any cancellation review should cover. If you can pass them all, your implementation is production-ready.

---

## Task 11: Benchmark

### Goal

Compare three forms in a microbenchmark:

1. `for v := range c` (no cancellation).
2. `for v := range orDone(done, c)` (wrapped).
3. Inline `for { select { ... case v, ok := <-c: ... use(v) } }` (no wrapper).

### Setup

Stream 1,000,000 small integers from a goroutine into the consumer. Measure ns/op for each form.

### Code skeleton

```go
func BenchmarkRangeRaw(b *testing.B) {
    for i := 0; i < b.N; i++ {
        c := makeStream(1_000_000)
        for range c {
        }
    }
}

func BenchmarkRangeOrDone(b *testing.B) {
    for i := 0; i < b.N; i++ {
        done := make(chan struct{})
        c := makeStream(1_000_000)
        for range orDone(done, c) {
        }
        close(done)
    }
}

func BenchmarkInlineSelect(b *testing.B) {
    for i := 0; i < b.N; i++ {
        done := make(chan struct{})
        c := makeStream(1_000_000)
        loop:
        for {
            select {
            case <-done:
                break loop
            case _, ok := <-c:
                if !ok {
                    break loop
                }
            }
        }
        close(done)
    }
}
```

### Discussion

Typical results on modern x86_64:

- Raw: ~50 ns/op per value.
- Inline select: ~80 ns/op per value (one select overhead).
- OrDone wrapped: ~130 ns/op per value (one select + one extra goroutine hop).

The wrapper is roughly 2.5x the raw cost and 1.6x the inline cost. For most pipelines this is acceptable; for ultra-hot data planes, the inline form wins.

---

## Task 12: Real-world scenario — cancellable log tail

### Goal

Build a small CLI that tails a file (like `tail -f`), prints new lines, and exits cleanly on `Ctrl-C`.

### Requirements

- Use `orDone` (or `context`) to make the tail cancellable.
- On Ctrl-C, print "shutting down" and exit within 100 ms.
- No leaked goroutines.

### Sketch

```go
func tail(ctx context.Context, path string) <-chan string {
    out := make(chan string)
    go func() {
        defer close(out)
        // open file, seek to end, poll for new lines
        for {
            select {
            case <-ctx.Done():
                return
            default:
            }
            line, ok := readNextLine()
            if !ok {
                time.Sleep(100 * time.Millisecond)
                continue
            }
            select {
            case out <- line:
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}

func main() {
    ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
    defer cancel()

    for line := range tail(ctx, os.Args[1]) {
        fmt.Println(line)
    }
    fmt.Println("shutting down")
}
```

### Discussion

`signal.NotifyContext` makes the context cancel on Ctrl-C — a beautiful tie-in between OS signals and the `done` channel pattern. The tail goroutine observes `ctx.Done()` directly; you do not even need `orDone` because there is only one forwarding stage and the producer is in the same goroutine as the cancellation observer.

This is the natural endpoint of the pattern: at small scale, you barely need it; at large scale, you cannot live without it.

---

Practice these tasks in order. By the end you will have built a small channel-combinator library, understood the cost trade-offs, and exercised every cancellation edge case. That is the working knowledge needed to use the pattern in production confidently.
