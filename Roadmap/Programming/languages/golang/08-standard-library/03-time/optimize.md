# 8.3 `time` — Optimize

Performance-shaped patterns for the `time` package: the cost of
`time.Now`, allocation-free formatting, timer pooling, ticker drift
correction, monotonic vs wall arithmetic, and the Go 1.23 timer GC
improvements.

## 1. The cost of `time.Now()`

On Linux amd64 with vDSO `clock_gettime`, `time.Now()` costs about
20–50 ns per call. The breakdown:

- One vDSO call to read both `CLOCK_REALTIME` and `CLOCK_MONOTONIC`.
- A handful of arithmetic ops to convert to Go's internal encoding.
- A 24-byte struct returned by value on the stack.

Concrete benchmark on a modern x86 machine:

```
BenchmarkNow-12    50000000    25.4 ns/op    0 B/op    0 allocs/op
```

Zero allocations because the `Time` struct stays on the stack. For
most application code, this is fast enough that you don't care.
For very hot paths, batch reads (one `Now` per operation, not several)
or reduce the number of timestamped events.

A common mistake is taking `time.Now()` twice in a loop:

```go
// Two Now calls per iteration:
for _, item := range items {
    if time.Since(item.Created) > maxAge {
        ...
    }
}
```

Each `time.Since` calls `Now()` internally. Hoist:

```go
now := time.Now()
for _, item := range items {
    if now.Sub(item.Created) > maxAge {
        ...
    }
}
```

For 1M items, this saves ~25 ms of CPU per iteration through the loop.

## 2. Allocation-free formatting with `AppendFormat`

`(time.Time).Format(layout)` allocates a `string`. For log lines and
hot output paths, use `AppendFormat`:

```go
// Allocates per call:
line := fmt.Sprintf("[%s] event\n", t.Format(time.RFC3339))

// Allocation-free into a reused buffer:
buf = buf[:0]
buf = append(buf, '[')
buf = t.AppendFormat(buf, time.RFC3339)
buf = append(buf, "] event\n"...)
w.Write(buf)
```

Benchmark: `Format` allocates ~32 bytes (the result string).
`AppendFormat` allocates 0 if the buffer has capacity.

For structured logging, `slog.Time` and `slog.TimeValue` use
`AppendFormat` internally — that's why `slog` is faster than
hand-rolled `fmt.Fprintf` formatting.

For a log writer that emits millions of lines per second, the
difference between `Format` and `AppendFormat` is real:

```
BenchmarkFormat-12       30000000   45 ns/op   32 B/op   1 allocs/op
BenchmarkAppendFormat-12 50000000   28 ns/op    0 B/op   0 allocs/op
```

## 3. Avoiding `time.Now()` in hot allocation paths

If you have a per-request log line and a rate-limited metric and a
TTL check, you may have called `time.Now()` four times for one
request. Capture once:

```go
func handle(w http.ResponseWriter, r *http.Request) {
    now := time.Now()
    if !rateLimit.Allow(now) {
        http.Error(w, "rate", 429)
        return
    }
    if cached, ok := cache.Get(r.URL.Path, now); ok {
        write(w, cached)
        return
    }
    out := compute(r)
    cache.Set(r.URL.Path, out, now)
    log.Printf("[%s] %s", now.Format(time.RFC3339), r.URL.Path)
}
```

Each helper takes `now` rather than calling `Now()` itself. Test
double-bonus: passing `now` is the seam where you inject a fake clock
in tests.

## 4. Timer pooling with `sync.Pool`

`time.NewTimer` allocates a `*Timer` and a buffered channel of length
1. For a hot path that creates many timers (request-scoped timeouts in
a high-QPS server), this is a measurable allocation cost.

`sync.Pool` for timers, with the proper Stop/Reset dance:

```go
var timerPool = sync.Pool{
    New: func() any {
        // Create a stopped timer (use long duration + immediate Stop).
        t := time.NewTimer(time.Hour)
        t.Stop()
        return t
    },
}

func acquireTimer(d time.Duration) *time.Timer {
    t := timerPool.Get().(*time.Timer)
    t.Reset(d)
    return t
}

func releaseTimer(t *time.Timer) {
    if !t.Stop() {
        select {
        case <-t.C:
        default:
        }
    }
    timerPool.Put(t)
}
```

Usage:

```go
t := acquireTimer(2 * time.Second)
defer releaseTimer(t)

select {
case <-ch:
case <-t.C:
    return errors.New("timeout")
}
```

Pre-Go 1.23, this saved both the allocation and the `time.After`
leak. Post-Go 1.23, the runtime's GC improvements remove the leak,
but pooling still saves allocations on hot paths. The `fasthttp`
project uses this pattern; `net/http` introduced its own variant in
Go 1.23 for the same reason.

The `select`-with-default drain is important even with pooling:
without it, a stale value in the channel would mislead the next user.

## 5. Ticker drift and absolute scheduling

A `Ticker` schedules its next fire from the previous *intended*
firing time, not the actual one, so per-tick scheduling jitter
doesn't accumulate. But long-term:

- The OS clock itself can drift (especially under VM load).
- A consumer that occasionally takes longer than `period` causes
  ticks to be dropped (channel buffer = 1).

For "every second do X" workloads, this is fine. For "exactly N
events per minute, ever" workloads, you need explicit accounting.

The pattern: track the next intended fire time as an absolute
monotonic timestamp, sleep to it explicitly, recompute.

```go
func steadyTicker(ctx context.Context, period time.Duration, work func()) error {
    next := time.Now().Add(period)
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-time.After(time.Until(next)):
        }
        work()
        next = next.Add(period)
    }
}
```

If `work()` takes longer than `period`, `next` falls into the past
and the next iteration runs immediately, "catching up." For more
robust catch-up, increment `next` until it's in the future:

```go
for !next.After(time.Now()) {
    next = next.Add(period)
}
```

This skips missed ticks rather than running them all back-to-back.

## 6. `NewTimer` vs `time.After` in selects

The trade-off table:

| | `time.After(d)` | `time.NewTimer(d)` |
|--|--|--|
| Allocation per use | 1 timer + 1 channel | 1 timer + 1 channel (same) |
| Stoppable | No (no handle) | Yes |
| Reusable | No | Yes (with Stop+Reset) |
| Pre-1.23 leak in select | Yes | No (you can Stop) |
| Post-1.23 leak in select | No | No |

For a one-shot select where you don't care about cancellation,
`time.After` is fine on Go 1.23+. For hot paths (per-request
timeouts), pool and reuse via `NewTimer`.

## 7. Monotonic vs wall arithmetic — cost

Both use the same `Sub` implementation; the path is selected by a
single flag check on the operands. The cost difference at the call
site is one branch — negligible.

The win from the monotonic clock isn't speed; it's correctness across
NTP jumps. There's no tradeoff between "fast" and "monotonic-safe."
Use `time.Since` and `time.Until` everywhere; the cost is the same
as wall arithmetic.

## 8. Pre-Go 1.23 `time.After` memory: real numbers

A program that runs `time.After(time.Hour)` in a hot loop, choosing
the other case 1000 times per second, on Go 1.22:

- 1000 timers/sec × 3600 sec/hour = 3.6M live timers steady-state.
- Each timer ≈ 200 bytes (timer struct + channel).
- ~720 MB of timer state held by the runtime.

On Go 1.23, the same loop:

- Each `time.After` timer is collectable as soon as the goroutine
  loses its reference to the channel.
- Steady-state memory: a few MB.

The fix from §6 (hoisted `NewTimer`) had constant memory regardless
of Go version. This is why the hoist pattern was the textbook answer
for years; Go 1.23 finally made it the convenience pattern's
default behavior.

If you maintain code that must run on multiple Go versions, the hoist
pattern is the lowest-common-denominator safe choice.

## 9. NTP-induced jumps and how to detect them

The monotonic clock isolates `Sub`/`Since` from wall-clock jumps. To
detect a jump (for monitoring or alerting), compare:

```go
// At T0:
mark := time.Now()
wallStart := time.Now().Round(0) // strips monotonic

// Later:
wallElapsed := time.Now().Round(0).Sub(wallStart)  // wall - wall
monoElapsed := time.Since(mark)                    // monotonic
drift := wallElapsed - monoElapsed
if drift.Abs() > 5*time.Second {
    // wall clock jumped by approximately `drift`
}
```

Background goroutine pattern:

```go
func detectClockJump(ctx context.Context, threshold time.Duration, onJump func(time.Duration)) {
    ticker := time.NewTicker(time.Minute)
    defer ticker.Stop()

    mark := time.Now()
    wallMark := mark.Round(0)
    for {
        select {
        case <-ctx.Done():
            return
        case <-ticker.C:
            now := time.Now()
            wallNow := now.Round(0)
            wallDelta := wallNow.Sub(wallMark)
            monoDelta := now.Sub(mark)
            drift := wallDelta - monoDelta
            if abs(drift) > threshold {
                onJump(drift)
            }
            mark = now
            wallMark = wallNow
        }
    }
}

func abs(d time.Duration) time.Duration {
    if d < 0 {
        return -d
    }
    return d
}
```

Useful in services that depend on wall-clock correctness — log
correlation, billing, scheduled tasks.

## 10. Reducing parse cost

`time.Parse` is more expensive than formatting because it has to
recognize layout elements at runtime. Benchmark on RFC3339:

```
BenchmarkParseRFC3339-12  10000000  120 ns/op   0 B/op  0 allocs/op
BenchmarkFormatRFC3339-12 30000000   45 ns/op   0 B/op  0 allocs/op (with AppendFormat)
```

Optimizations:

- **Choose the simplest layout that fits the input.** Parsing
  `time.RFC3339Nano` is slightly faster than parsing a custom layout
  with the same fields, because the package recognizes constant
  layouts and uses optimized fast paths (Go 1.20+).
- **For Unix-time integer inputs, `strconv.ParseInt` + `time.Unix`** is
  several times faster than `time.Parse`.
- **For known-format wire formats**, skip `time.Parse` and write a
  hand-rolled parser. Eight digits plus three colons plus four hyphens
  is straightforward to parse with a few `strconv.Atoi` calls.

## 11. Avoiding allocations in JSON time round-trips

The default JSON marshaling uses `AppendFormat` and is already
allocation-friendly on the marshal side (the `[]byte` is reused by
the JSON encoder). On the unmarshal side, `Parse` is called per field
and is hot.

If your service marshals millions of `Time` values per second, two
options:

1. Use Unix timestamps (integers) instead of RFC3339 strings.
   Parsing is 5x faster; the wire size is half.

2. Use a typed alias with a custom `UnmarshalJSON` that knows your
   exact layout (avoiding `time.Parse`'s general-purpose machinery):

   ```go
   type IsoDate time.Time

   func (d *IsoDate) UnmarshalJSON(b []byte) error {
       // b is "YYYY-MM-DD" with quotes, length 12 always
       if len(b) != 12 || b[0] != '"' || b[11] != '"' {
           return fmt.Errorf("bad date: %s", b)
       }
       y, _ := strconv.Atoi(string(b[1:5]))
       m, _ := strconv.Atoi(string(b[6:8]))
       day, _ := strconv.Atoi(string(b[9:11]))
       *d = IsoDate(time.Date(y, time.Month(m), day, 0, 0, 0, 0, time.UTC))
       return nil
   }
   ```

The savings only matter at scale — for an API serving 100 req/s, the
default is fine.

## 12. Go 1.23 timer/ticker improvements summary

| Change | Pre-1.23 | Post-1.23 |
|--------|----------|-----------|
| `time.After` GC | Held until fire | Collectable when unreferenced |
| `Timer.Stop` channel state | Stale value may remain | Channel drained automatically |
| `Timer.Reset` after fire | Required explicit drain | Channel cleared by runtime |
| `Ticker` GC | Held until `Stop` | Same — `Stop` is still the right answer |

For new code targeting 1.23+:

- `time.After` in select loops is safe.
- `Timer.Stop` followed by `Reset` is safe without explicit drain.
- The hoist-and-reuse pattern is still slightly faster (avoids
  per-iteration allocation) but no longer required for correctness.

For libraries targeting older versions:

- Keep the explicit drain pattern.
- Hoist timers out of hot loops.

## 13. When to stop optimizing

Most `time`-shaped optimizations buy hundreds of nanoseconds. They
matter when:

- You're serving 100k+ requests per second per core.
- Profiling shows `time.Now`, `Format`, or `Parse` in the top 10 by
  cumulative time.
- A specific allocation hotspot is identified by `pprof -alloc_objects`.

They don't matter when:

- Your service is I/O-bound (which most are).
- A request is already 2ms+; saving 50ns is noise.

Profile first. The patterns in this file are documented because they
matter at scale, not because they always matter.

## 14. What to read next

- [senior.md](senior.md) — internals that explain why the costs are
  what they are.
- [find-bug.md](find-bug.md) — performance bugs (leaked timers, hot
  `time.After`).
- [tasks.md](tasks.md) — the timer-pooling and benchmark-AfterFunc
  exercises.
