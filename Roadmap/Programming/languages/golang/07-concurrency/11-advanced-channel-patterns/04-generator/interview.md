# Generator Pattern — Interview Questions

Questions ordered roughly from junior to senior. Each has a short ideal answer.

## Conceptual

### Q1. What is a generator in Go?
A function that returns `<-chan T` and spawns one goroutine to send values on that channel, closing it when production ends. The caller reads with `range` or repeated `<-`.

### Q2. Why return `<-chan T` rather than `chan T`?
To prevent the caller from sending values or closing the channel. The receive-only type encodes the ownership rule in the type system.

### Q3. Who closes the channel returned by a generator?
The producer goroutine, exactly once, via `defer close(out)` as the first deferred statement.

### Q4. Why does the consumer not close the channel?
Closing is the producer's signal of "no more values". A consumer closing would race with sends and could cause a panic on send-after-close.

### Q5. What is the canonical generator template?
```go
func Gen[T any](values ...T) <-chan T {
    out := make(chan T)
    go func() {
        defer close(out)
        for _, v := range values {
            out <- v
        }
    }()
    return out
}
```

### Q6. Why does the goroutine produce lazily?
Because the unbuffered `out <- v` send blocks until a consumer is ready to receive. If the consumer is slow, the producer waits — natural backpressure.

### Q7. What happens to the producer goroutine if the consumer stops reading?
With a non-cancellable generator, the goroutine blocks on `out <- v` forever — a leak. The fix is a cancellation signal in a `select`.

### Q8. How do you make an infinite generator cancellable?
Wrap every send in a `select` that also receives from `ctx.Done()` or a `done` channel:
```go
select {
case <-ctx.Done():
    return
case out <- v:
}
```

### Q9. What is the difference between `done <-chan struct{}` and `context.Context`?
Functionally similar for cancellation. `Context` also carries deadlines, values, and is the standard library convention; `done` is a minimalist alternative used in pattern libraries (e.g., Cox-Buday).

### Q10. Why is `defer close(out)` the first defer in the goroutine?
Defers run LIFO. Being first means it runs last — after any other cleanup defers. The channel is closed only after resources are released.

## Patterns

### Q11. How do you turn a callback-based API into a generator?
Spawn a goroutine that invokes the callback by sending on a channel; return the channel; use `defer close` and `ctx.Done()` to handle shutdown.

### Q12. How does a generator compose with fan-out?
The single generator yields values; N consumer goroutines all read from the same `<-chan T`; each value goes to whichever consumer wins the race. Order across consumers is not preserved.

### Q13. How does a generator compose with fan-in?
You have N generators; a fan-in adapter reads from all and forwards to a single output channel. The output closes only after all inputs close.

### Q14. How does a generator compose with tee?
A tee adapter duplicates each value to two output channels. The original generator is unchanged; tee sits between it and the two consumers.

### Q15. What is a bridge channel and how does it relate to generators?
A bridge flattens `<-chan (<-chan T)` to `<-chan T`. Useful when a generator yields generators — for example, paginating per tenant.

### Q16. Where should setup errors go?
Returned synchronously from the generator function: `func Gen(...) (<-chan T, error)`. If setup fails, the channel is `nil`.

### Q17. Where should streaming errors go?
Either embedded in the element via `Result[T]`, sent on a side error channel, or exposed via a trailing `Err()` accessor. Pick one per package and apply consistently.

## Bugs

### Q18. A generator hangs the consumer. What is the most likely cause?
Missing `defer close(out)` (or the close is unreachable due to early return).

### Q19. A generator leaks goroutines under load. What is the most likely cause?
The infinite send loop is not inside a `select` with a cancellation case. The consumer stops reading; the producer blocks forever.

### Q20. A buffered generator hides a deadlock that only appears in production. Why?
The buffer absorbs early backpressure; deadlocks surface only when the buffer fills. Profile and stress-test before adding buffer.

### Q21. A generator returns `(<-chan T, error)` but the error is always nil. The streaming fails sometimes. What is the bug?
Streaming errors are being silently dropped inside the producer goroutine. Either propagate via `Result[T]` or via a side channel.

### Q22. A generator panics under rare input. The consumer sees half the data, then a closed channel — no error. Why?
`defer close(out)` runs on panic, so the channel closes "normally". The consumer cannot distinguish panic from EOF. Add `recover()` and emit a streaming error.

### Q23. A consumer calls `close(ch)` on the generator's channel. What happens?
Panic if the generator's goroutine later tries to send. The consumer must never close; only the producer closes.

### Q24. Why does `select { case <-ctx.Done(): ...; default: out <- v }` cause 100% CPU?
The `default` makes the select non-blocking. If the consumer is slow and `out <- v` would block, the `select` returns immediately via `default`, the loop runs again, and the CPU melts. Remove `default`.

## Trade-offs and design

### Q25. When should you use a channel generator vs Go 1.23 `iter.Seq`?
Channel generator when the producer needs to run concurrently with the consumer (I/O-bound vs CPU-bound), or when multiple consumers will read from one source, or as the head of a channel pipeline. `iter.Seq` for in-process synchronous iteration — faster (~5ns/item vs ~50ns/item), simpler, and no goroutine.

### Q26. When does a buffer on the generator's channel make sense?
When measurements show the producer waiting frequently on sends due to short bursts of consumer slowness. Buffer size should match expected burst size. Default unbuffered; tune by profiling.

### Q27. Two consumers read from the same generator. Each sees half the values. Is that a bug?
Not necessarily — that is the defined behaviour of multiple consumers on one channel. If both should see every value, use `tee`.

### Q28. The same generator is called twice — does it produce the same values?
A new goroutine and channel are created each call. If the underlying source is repeatable (a slice), yes. If the source is single-use (an open file, a network cursor), the second call sees an empty or errored stream.

### Q29. How would you make a generator resumable from a checkpoint?
Expose the cursor in the yielded type and accept a starting cursor as input. The consumer persists the last successfully processed cursor; on restart, the generator is called with that cursor.

### Q30. How would you implement rate-limited yields?
Either (a) wrap the generator's output in a rate-limiter stage, or (b) insert `<-ticker.C` inside the producer's `select`. Prefer (a) — it keeps the generator simple and the rate policy swappable.

## Implementation challenges

### Q31. Implement a generic generator from a slice.
```go
func FromSlice[T any](s []T) <-chan T {
    out := make(chan T)
    go func() {
        defer close(out)
        for _, v := range s {
            out <- v
        }
    }()
    return out
}
```

### Q32. Implement a cancellable infinite counter.
```go
func Counter(ctx context.Context) <-chan int {
    out := make(chan int)
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

### Q33. Implement a paginator that yields items across multiple API pages.
```go
type Page struct {
    Items []Item
    Next  string
}

func Pages(ctx context.Context, fetch func(string) (Page, error)) <-chan Item {
    out := make(chan Item)
    go func() {
        defer close(out)
        cursor := ""
        for {
            page, err := fetch(cursor)
            if err != nil {
                return
            }
            for _, it := range page.Items {
                select {
                case <-ctx.Done():
                    return
                case out <- it:
                }
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

### Q34. Implement a line generator over a file.
```go
func Lines(ctx context.Context, path string) (<-chan string, error) {
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
            select {
            case <-ctx.Done():
                return
            case out <- s.Text():
            }
        }
    }()
    return out, nil
}
```

### Q35. Convert an `iter.Seq[T]` to a `<-chan T` with cancellation.
```go
func ToChan[T any](ctx context.Context, seq iter.Seq[T]) <-chan T {
    out := make(chan T)
    go func() {
        defer close(out)
        for v := range seq {
            select {
            case <-ctx.Done():
                return
            case out <- v:
            }
        }
    }()
    return out
}
```

### Q36. Convert a `<-chan T` to an `iter.Seq[T]`.
```go
func FromChan[T any](ch <-chan T) iter.Seq[T] {
    return func(yield func(T) bool) {
        for v := range ch {
            if !yield(v) {
                return
            }
        }
    }
}
```

Note: this does not cancel the upstream producer when `yield` returns false. A `ctx` would have to be plumbed separately.

### Q37. Implement a tee for a generator's output.
```go
func Tee[T any](ctx context.Context, in <-chan T) (<-chan T, <-chan T) {
    a, b := make(chan T), make(chan T)
    go func() {
        defer close(a)
        defer close(b)
        for v := range in {
            // send to both, both must accept before next iter
            var aDone, bDone bool
            for !aDone || !bDone {
                select {
                case <-ctx.Done():
                    return
                case a <- v:
                    aDone = true
                    a = nil // disable this case after send
                case b <- v:
                    bDone = true
                    b = nil
                }
            }
            // restore for the next iteration
            // (in real code, you'd structure differently; this shows the idea)
        }
    }()
    return a, b
}
```

The trick: a `nil` channel in a `select` is never selected, so once `a <- v` has succeeded, only `b <- v` remains active.

### Q38. Make a generator that fans into N workers.
```go
nums := Counter(ctx)
results := make([]<-chan int, N)
for i := range results {
    results[i] = squareWorker(nums)
}
merged := fanIn(ctx, results...)
```

The same generator is read concurrently by N worker goroutines. Each worker has its own output channel. A fan-in merges them.

## Final round

### Q39. Walk through every failure mode of an infinite cancellable generator in a production pipeline.

- **Consumer stops reading:** producer blocks on send; `<-ctx.Done()` should fire; if it does, goroutine exits cleanly.
- **`ctx` never cancelled:** producer runs forever, consuming CPU and memory; a supervisor `ctx` should bound the lifetime.
- **Upstream fetch fails transiently:** retry with backoff inside the goroutine; do not surface.
- **Upstream fetch fails permanently:** emit streaming error; exit.
- **Producer panics:** `recover()` in goroutine; emit metric; close channel; consumer drains.
- **Consumer panics:** producer eventually blocks on send; `ctx` cancel from supervisor unblocks; goroutine exits.
- **Buffer fills:** producer blocks; saturation metric should alert; either fan-out consumers or drop policy.

### Q40. You have a `<-chan T` generator that's leaking goroutines. Walk me through diagnosing it.

1. Run `go tool pprof` with the goroutine profile; see thousands of goroutines stuck on `chan send` at the generator's line.
2. Check the generator's source: is the send inside a `select` with `ctx.Done()`?
3. Check the caller: is the `ctx` ever cancelled? Is the channel still in scope on a path that abandons it?
4. Add a `goleak` test that exercises the abandonment path; reproduce locally.
5. Fix either by adding the cancel case to the generator or by ensuring the caller cancels its context on the abandonment path.
6. Backstop with the leak-detection test.
