# 8.3 `time` — Interview

Twenty-eight questions on the `time` package. Each comes with a model
answer at the depth a senior backend engineer should reach in a
discussion.

## Q1. Why does `time.Time` carry both a wall and a monotonic clock?

The wall clock reflects civil time and can move backwards (NTP slew or
step, manual changes, leap-second smearing). The monotonic clock is a
process-local counter that only goes forward, used to compute correct
elapsed times even when the wall clock jumps. Storing both lets one
`time.Time` value serve two roles: human-readable instant (wall) and
basis for `Sub`/`Since`/`Until` (monotonic).

## Q2. Why does `==` on two `time.Time` values sometimes return false even when they refer to the same instant?

Because `==` compares the struct fields, including the encoding. A
`Time` with a monotonic reading and a `Time` without one (e.g., one
just deserialized from JSON) have different `wall` and `ext` fields
even when both represent the same wall instant. `t.Equal(u)` compares
the wall instant explicitly and returns the right answer. **Always use
`Equal`.**

## Q3. Walk through `Timer.Stop`'s return-value semantics.

`Stop()` returns:
- **`true`** — the timer was active and `Stop` removed it before it
  fired. The channel is empty; the callback (for `AfterFunc`) won't run.
- **`false`** — the timer had already fired (or was already stopped).
  In pre-Go 1.23 code, the value may already be sitting in the
  channel's buffer.

For pre-1.23 code that intends to `Reset` after `Stop`, the canonical
drain is:

```go
if !t.Stop() {
    select {
    case <-t.C:
    default:
    }
}
t.Reset(d)
```

Go 1.23+ has the runtime drain the channel for you, so the explicit
`select` is no longer required.

## Q4. What happens to a `Ticker`'s channel after `Stop`?

`Stop` prevents future ticks but **does not close the channel**. A
tick that was already in the buffer when you called `Stop` is still
there; you can drain it with a non-blocking receive if you want.
`for range t.C` will block forever after `Stop` because the channel
stays open with no further sends. Always exit a tick loop through a
separate condition (`ctx.Done()`, a `done` channel).

## Q5. Why is the reference time `Mon Jan 2 15:04:05 MST 2006`?

So the field order is mnemonic: 1, 2, 3, 4, 5, 6, 7 — month 1, day 2,
hour 03, minute 04, second 05, year 06, zone -07:00. The Go
designers chose specific digits so each field has a unique number,
which means the formatter can identify fields positionally without
escape sequences. This is the trade-off for the design: layouts read
like real timestamps, but you can't write `06` or `2006` literally
inside a layout — they'll be substituted.

## Q6. How do you fake time in tests?

Inject a `Clock` interface into anything that calls `time.Now`,
`Sleep`, `NewTimer`, or `NewTicker`:

```go
type Clock interface {
    Now() time.Time
    NewTimer(d time.Duration) Timer
    Sleep(d time.Duration)
}
```

Production passes a `RealClock{}` that wraps the `time` package. Tests
pass a `FakeClock` that holds an internal "now" with an `Advance(d)`
method. Existing libraries: `benbjohnson/clock`, `jonboulle/clockwork`.
For small projects, a 30-line interface is enough.

## Q7. What's the difference between `time.After` and `AfterFunc` in terms of memory?

`time.After(d)` allocates a `*Timer` plus a channel. `AfterFunc(d, f)`
allocates a `*Timer` only — no channel. When the timer fires,
`time.After` waits for someone to receive on the channel; `AfterFunc`
schedules `f` to run in a fresh goroutine.

In a loop where you always select on the channel anyway, `time.After`
is simpler. For "fire and forget" callbacks, `AfterFunc` is cheaper
because it skips the channel and the receiver goroutine.

Pre-Go 1.23, `time.After` had an additional issue: the timer (and its
channel) were kept alive by the runtime until firing, even if the
caller stopped caring. This caused leaks in `select` loops with long
durations. Go 1.23 made the runtime collect unreferenced timers, so
the leak is gone.

## Q8. How do you handle DST transitions?

Use `AddDate(0, 0, 1)` for "tomorrow at this hour", not
`Add(24 * time.Hour)`. Calendar days are 23, 24, or 25 wall-clock
hours depending on whether DST starts, ends, or doesn't change.
`AddDate` operates in the time's `Location` and resolves wall clocks
correctly; `Add` operates on absolute monotonic seconds.

For "midnight in local zone", construct with `time.Date(y, M, d, 0, 0,
0, 0, loc)` rather than `t.Truncate(24 * time.Hour)` (which truncates
to UTC midnight, not local).

For times that don't exist on the wall clock (the "skipped hour" in
spring forward) or that happen twice (the "extra hour" in fall back),
`time.Date` normalizes to the next valid instant or the first
occurrence respectively. If you need different behavior, you have to
inspect the location's transition table manually.

## Q9. Why isn't `time.Sleep` cancelable?

`time.Sleep` parks the current goroutine on the runtime's timer heap
with no way to wake it except by the timer firing. There is no API to
interrupt it from outside. To make sleeping cancelable, layer a
`select` with `ctx.Done()`:

```go
select {
case <-ctx.Done():
    return ctx.Err()
case <-time.After(d):
}
```

Or use a `*Timer` explicitly so you can `Stop()` it.

## Q10. What does `time.Tick` do that `time.NewTicker` doesn't?

`time.Tick(d)` returns just the channel from a new `Ticker`. There's
no way to access the `*Ticker` and therefore no way to call `Stop`.
The underlying ticker leaks forever. The package documentation
explicitly says so. **Treat `time.Tick` as a footgun**; use
`time.NewTicker` and `defer t.Stop()`.

## Q11. What is `time/tzdata`?

A standard-library package that, when imported for side effects (`import
_ "time/tzdata"`), embeds the IANA timezone database (~450 KB) into
the binary. After this import, `time.LoadLocation` works regardless
of whether the host filesystem has zoneinfo. Recommended for
single-binary deployments (Docker `FROM scratch`, distroless, CLIs
shipped to mixed environments).

## Q12. Why does serialization strip the monotonic clock?

The wire format (RFC3339 in JSON, similar in XML and gob) carries only
wall-clock fields. Monotonic clock readings are process-local — they
have no meaning to a different process or a different time. So
marshaling drops them, and unmarshaling can't reconstruct them.

This is why `time.Time` values that have crossed a serialization
boundary should never be compared with `==`. Use `Equal`. Round to
zero (`t.Round(0)`) before serializing if you want both sides of the
round-trip to compare equal under `==`.

## Q13. What's the difference between `Round` and `Truncate`?

Both align a `Time` (or `Duration`) to a multiple of `d`. `Truncate`
rounds **down**; `Round` rounds to the **nearest** multiple, with
halves rounding **up**.

Both operate on absolute (UTC, since-zero-time) seconds, not on
location-aware boundaries. `t.Truncate(24 * time.Hour)` gives "UTC
midnight," not "local midnight." For local-zone alignment, construct
with `time.Date`.

`t.Round(0)` is a special case: it doesn't round, it strips the
monotonic reading.

## Q14. What happens when you call `Reset` on a running `Timer`?

`Reset(d)` schedules the timer to fire after `d` from now. If the
timer was already running, the new firing replaces the old one.

The pre-Go 1.23 documentation warns that calling `Reset` on a timer
whose channel might already have a stale value is a race — the next
`<-t.C` could deliver the stale value. The drain pattern (call
`Stop` first, drain the channel non-blockingly, then `Reset`) was
required.

Go 1.23 changed the semantics: `Reset` now properly clears the
channel, making the explicit drain unnecessary. If your code targets
1.23+ exclusively, drop the drain.

## Q15. How do you parse a timestamp without a timezone but with a known zone?

Use `time.ParseInLocation`:

```go
loc, _ := time.LoadLocation("America/New_York")
t, err := time.ParseInLocation("2006-01-02 15:04:05", "2026-05-06 14:30:00", loc)
```

`time.Parse` defaults to UTC for zone-less inputs, which silently
produces the wrong instant when the input was meant as local. Use
`ParseInLocation` whenever you know the intended zone but the input
text doesn't include it.

## Q16. What's the right way to schedule "every hour at :00"?

Don't use `Ticker` — its firing schedule is from process start, not
from wall-clock alignment. Compute the next aligned target each
iteration:

```go
for {
    next := time.Now().Truncate(time.Hour).Add(time.Hour)
    select {
    case <-ctx.Done():
        return ctx.Err()
    case <-time.After(time.Until(next)):
    }
    runHourlyJob()
}
```

Each iteration wakes at the start of the next hour, regardless of how
long the job took. No drift.

## Q17. What does `t.Sub(u)` actually compute?

If both `t` and `u` carry monotonic readings, `Sub` returns the
difference of the monotonic readings (correct elapsed time, immune to
NTP jumps). Otherwise, it falls back to wall-clock subtraction.

This is why `time.Since(start)` is safe across NTP corrections only as
long as `start` retains its monotonic reading. If `start` came from a
JSON unmarshal or a `Round(0)`, you're back to wall-clock math.

## Q18. What's the cost of `time.Now()`?

On Linux amd64, `time.Now()` calls `clock_gettime` via vDSO, which is
about 20–50 ns. Fast enough for most uses. In hot loops (per-request
log lines, per-iteration metrics), it adds up — at 1M requests per
second with two `Now()` calls each, that's 6 ms of CPU per second
spent on timekeeping, ~0.6%.

If you need to optimize, batch reads (one `Now()` per measurement
instead of two) or cache the result for short windows.

## Q19. How do you bound a long-running operation by a deadline?

Use `context.WithDeadline` (or `WithTimeout`) and pass the context to
every blocking call:

```go
ctx, cancel := context.WithTimeout(parent, 5*time.Second)
defer cancel()
return doWork(ctx)
```

`doWork` should pass `ctx` to HTTP requests (`NewRequestWithContext`),
DB queries (`QueryContext`), channel reads (`select` with
`<-ctx.Done()`). The runtime's network poller and timer heap together
enforce the deadline at the syscall level.

The wrong pattern is checking `time.Now().After(deadline)` between
operations — that snapshots the deadline but doesn't interrupt
in-flight blocking calls.

## Q20. What is the format of `time.Duration.String()`?

For non-zero values: hours, minutes, seconds (with fractional), or
milliseconds/microseconds/nanoseconds for sub-second values. Examples:

- `0` → `"0s"`
- `42 * time.Nanosecond` → `"42ns"`
- `42 * time.Microsecond` → `"42µs"`
- `42 * time.Millisecond` → `"42ms"`
- `2 * time.Second + 100*time.Millisecond` → `"2.1s"`
- `time.Hour + time.Minute + time.Second` → `"1h1m1s"`

`time.ParseDuration` is the inverse and accepts the same format. No
`d` (day) unit — calendar days are not constant durations.

## Q21. What does `time.AfterFunc` do that's different from spawning a goroutine that sleeps and then runs?

The runtime mechanism. `AfterFunc` registers the callback on the timer
heap; no goroutine exists for it until firing. A "spawn-and-sleep"
goroutine occupies the goroutine stack and the scheduler queue from
the moment you spawn it.

For 100,000 deferred tasks, `AfterFunc` is roughly 100 KB of timer
state; spawn-and-sleep is 100,000 goroutines, each with at least 2 KB
of stack — 200 MB. That's why `AfterFunc` is the right tool for
deferred cleanup, debouncers, and TTL-based callbacks.

## Q22. Why are leap seconds ignored?

Civilian time on Earth is irregular — the Earth's rotation drifts and
UTC inserts a leap second occasionally to compensate. Go's `time`
package treats every UTC day as 86400 seconds. `time.Date(2016, 12,
31, 23, 59, 60, ...)` normalizes to `2017-01-01 00:00:00`.

In practice this is fine because cloud providers smear leap seconds
across the day (Google's "leap smear") and most application code never
sees them. The IERS announced in 2022 that leap seconds will be
retired by 2035, so the gap closes naturally.

For applications that need true leap-second-aware time (financial
trading, scientific instruments), Go is the wrong tool — those use
TAI or PTP at the application level.

## Q23. How do you compare two `Time` values that may have come from different sources?

Always use `Equal`:

```go
if a.Equal(b) { /* same instant */ }
```

Never `==`, because monotonic-clock differences create false negatives.
For ordering, use `Before` / `After`.

For map keys, use `t.Round(0)` to strip monotonic before insertion, or
better, use `t.UnixNano()` (an `int64`) as the key.

## Q24. What's the maximum and minimum value of `time.Duration`?

`time.Duration` is an `int64` of nanoseconds. So:

- Max: ~292 years
- Min: ~-292 years

This range is enough for any practical use, but worth knowing if
you compute `1 << attempt` in backoff code — at attempt 63, the shift
overflows and you get a negative duration. Cap before shifting.

## Q25. How would you implement a time-based one-shot cache?

Map of key → `(value, expiry time.Time)`. Lookup checks the expiry
against `time.Now()`. Set stores both:

```go
type entry struct {
    value any
    exp   time.Time
}

type cache struct {
    mu  sync.RWMutex
    m   map[string]entry
    ttl time.Duration
}

func (c *cache) Get(k string) (any, bool) {
    c.mu.RLock()
    e, ok := c.m[k]
    c.mu.RUnlock()
    if !ok || time.Now().After(e.exp) {
        return nil, false
    }
    return e.value, true
}

func (c *cache) Set(k string, v any) {
    c.mu.Lock()
    c.m[k] = entry{value: v, exp: time.Now().Add(c.ttl)}
    c.mu.Unlock()
}
```

For active eviction (rather than lazy on lookup), pair with a
`time.AfterFunc` per entry that deletes when the TTL elapses.

## Q26. What's the difference between `t.Local()` and `t.In(time.Local)`?

Functionally identical. `Local()` is shorthand for `In(time.Local)`.
Both return a `Time` with the same instant but different display
zone. Both preserve the monotonic reading.

The same is true for `t.UTC()` and `t.In(time.UTC)`.

## Q27. How do you guard against clock skew between distributed services?

Two layers:

1. **Use relative durations across the wire.** Send "5 seconds from
   now" rather than absolute timestamps. Each side computes its own
   absolute deadline from its own clock.
2. **Allow a skew window in time-based comparisons.** A token with `exp
   = T` should be valid until `T + skew` (typically 30s–5min) on the
   verifier. Without this, two services slightly out of sync reject
   each other's freshly-issued tokens.

For ordering across nodes, don't use wall clock — use a logical clock
(Lamport timestamps, vector clocks) or have one node assign all
sequence numbers.

## Q28. How can you tell if a `time.Time` has a monotonic reading?

There's no public API. The only way to find out is to round the
existing value to zero and compare with `==`:

```go
hasMono := !t.Equal(t.Round(0)) || t == t.Round(0) // not actually right
```

Better: don't ask. Code that depends on monotonic-clock presence is
fragile; instead, ensure your code path captures `time.Now()` and uses
the result before any operation that strips the monotonic reading.

For tests, you can compare two `Sub` results: one of `t.Sub(u)` and
one of `t.Round(0).Sub(u.Round(0))`. The first uses monotonic; the
second uses wall.

## What to read next

- [find-bug.md](find-bug.md) — drills based on these questions.
- [tasks.md](tasks.md) — exercises that exercise these patterns.
- [professional.md](professional.md) — production patterns the
  questions reference.
