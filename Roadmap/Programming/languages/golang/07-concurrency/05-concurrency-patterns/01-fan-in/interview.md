# Fan-In — Interview Questions

## Table of Contents
1. [Junior](#junior)
2. [Mid-Level](#mid-level)
3. [Senior](#senior)
4. [Staff](#staff)
5. [Whiteboard / Coding](#whiteboard-coding)
6. [Debugging](#debugging)
7. [System Design](#system-design)

---

## Junior

**Q1. What is fan-in?**
A pattern that merges values from N input channels into a single output channel. The output yields every value from every input, in arrival order, until every input is closed.

**Q2. Sketch a `merge2` for two channels.**
```go
func merge2(a, b <-chan int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup
    wg.Add(2)
    go func() { defer wg.Done(); for v := range a { out <- v } }()
    go func() { defer wg.Done(); for v := range b { out <- v } }()
    go func() { wg.Wait(); close(out) }()
    return out
}
```

**Q3. Why do we need a `WaitGroup`?**
To know when *every* forwarder has finished, so we can close `out` exactly once. Without it, we cannot tell whether all inputs are drained.

**Q4. Who closes the output channel?**
A dedicated closer goroutine that calls `wg.Wait()` then `close(out)`. Forwarders never close `out`.

**Q5. Why must `wg.Add` come before `go`?**
If a forwarder finishes before `wg.Add` runs, `wg.Wait` may return zero too early and the closer fires while another forwarder is still running.

**Q6. Does fan-in preserve order?**
No. Cross-input order is not guaranteed; the scheduler decides who runs first.

**Q7. What happens at N=0?**
WaitGroup counter is zero, the closer fires immediately, `out` is closed at once. The consumer's `range` exits.

**Q8. What if a producer never closes its channel?**
The forwarder's `range` blocks forever. The WaitGroup counter never reaches zero. `out` is never closed. The consumer hangs.

---

## Mid-Level

**Q9. How do you make a fan-in cancellable?**
Pass a `context.Context`. Use the two-select sandwich in each forwarder: one select around the receive, one around the send to `out`. Both check `ctx.Done()`.

**Q10. Show the two-select sandwich.**
```go
for {
    select {
    case <-ctx.Done(): return
    case v, ok := <-c:
        if !ok { return }
        select {
        case <-ctx.Done(): return
        case out <- v:
        }
    }
}
```

**Q11. Compare the WaitGroup merge with a `select`-based merge.**
WaitGroup: handles dynamic N, uses N+1 goroutines. Select-based: only fixed N known at compile time, uses 1 goroutine; close detection requires nil-channel trick.

**Q12. What is the nil-channel trick?**
Setting a channel variable to `nil` after it closes causes its `select` case to never fire — effectively removing that case. Useful in single-goroutine merges.

**Q13. How would you preserve order across inputs?**
Use a k-way merge with a min-heap of `(value, source_index)`. Each input must be already sorted. Cost: O(log N) per emission.

**Q14. How do you make fan-in generic?**
Go 1.18+ type parameters: `func Merge[T any](ctx context.Context, cs ...<-chan T) <-chan T`.

**Q15. How do you handle errors in a fan-in?**
Either:
- `Result[T]{Val, Err}` per emission.
- Parallel error channel.
- `errgroup.WithContext` with first-error abort.

---

## Senior

**Q16. What is `reflect.Select` and when do you use it?**
A reflective form of `select` that operates on a runtime-determined slice of cases. Use when N inputs are unknown at compile time and you want a single-goroutine merge. Trade-off: ~10x slower per select call due to reflection overhead.

**Q17. What memory-model edges does fan-in create?**
Channel send happens-before matching receive. So a producer's writes before sending happen-before a consumer's reads after receiving. Fan-in is safe for "transferring ownership" of memory across goroutines.

**Q18. How do you avoid goroutine leaks in fan-in?**
Two-select sandwich on every forwarder; ctx propagated; consumer either drains to completion or cancels ctx. Test with `goleak`.

**Q19. What backpressure does fan-in produce?**
A single output channel imposes uniform backpressure on all producers. A slow consumer slows every producer to the same rate.

**Q20. How do you scale fan-in to thousands of inputs?**
Layer the merge into a tree: groups of 100, then merge of those. Reduces contention on a single output channel. Profile first; flat merge is fine up to a few hundred inputs.

---

## Staff

**Q21. Design a fan-in service that supports hot-reload of producers.**
Use a supervisor pattern: a manager goroutine owns a control channel. On `Register`, it spawns a forwarder; on `Unregister`, it cancels that forwarder's ctx. The closer waits for all live forwarders.

**Q22. What metrics would you expose for production fan-in?**
- Per-input emission rate.
- Per-input drop count (if drop-on-full).
- Output buffer pending.
- Active inputs gauge.
- Goroutine count.
- Latency histogram from input send to merged emit.

**Q23. How do you decide between drop-newest, drop-oldest, and block?**
Block: fairness preferred, memory bounded. Drop-newest: producer cannot block (event handler). Drop-oldest: recent values matter more (logs). Spill-to-disk: never drop, accept latency.

**Q24. Where does fan-in fit in a pipeline?**
Often as the merge stage after a fan-out: `fan-out → workers → fan-in`. Also as the producer aggregator at the start of pipelines.

---

## Whiteboard / Coding

**T1. Write a generic, ctx-aware Merge.**
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
                case <-ctx.Done(): return
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
```

**T2. Write a stable k-way merge.**
Use `container/heap` with a head per input; pop smallest, advance that input.

**T3. Write a single-goroutine merge for a fixed pair.**
```go
func merge2(a, b <-chan int) <-chan int {
    out := make(chan int)
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

**T4. Write a `reflect.Select`-based merge for dynamic N.**
See senior.md for the reference implementation.

**T5. Write tests covering: empty inputs, single input, many inputs, cancellation mid-stream.**
Each test should run under `-race`.

---

## Debugging

**D1. Consumer's `range out` never exits. What are the possibilities?**
- A producer never closed its channel.
- A nil channel was passed.
- A forwarder is blocked on `out <- v` because the consumer is gone.
- The closer goroutine was never started (bug).

**D2. Goroutine count keeps growing in a test. Why?**
The merge leaks because consumers are not draining or ctx is never cancelled. Use `goleak` to assert.

**D3. Some values appear twice on the merged stream.**
The same input channel was passed twice, so two forwarders compete for its values — but they both forward, so it should not duplicate. Likely the producer is sending to two channels both of which are passed.

**D4. Race detector flags a write-write race on the merged stream.**
You probably mutated a value after sending it. Stop mutating sent values.

---

## System Design

**S1. Design a multi-source log aggregator.**
- Per-source goroutine writing to per-source channel.
- Merge into one stream.
- Batcher: 1000 records or 200ms.
- HTTP shipper to remote collector.
- Drop-newest under collector outage.
- Per-source metrics.

**S2. Design a search aggregator that fans queries to N backends.**
- Per-query merge with per-request ctx.
- Deadline 200ms.
- Each backend's results carry a relevance score.
- UI sorts a sliding window; cross-backend order not preserved.
- N+1 goroutines per query; fine at moderate QPS.

**S3. Design fan-in for 10K Kafka consumers.**
- Layered merge: 100 leaf merges of 100 each, then a top merge of 100.
- Per-leaf metrics.
- Hot-add via supervisor pattern.
- Bounded per-input buffers (256).

---

## Summary

The interview spectrum from junior to staff:
- Junior: write merge2, explain WaitGroup, who closes.
- Mid: ctx, generic, two-select sandwich, error semantics.
- Senior: order, layered topology, memory model, hot-reload supervisor.
- Staff: production case studies, metrics, drop policy, design under outage.

Fan-in is small in code; the engineering is in the operational discipline.
