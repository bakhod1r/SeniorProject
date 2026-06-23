# 8.3 `time` — Senior

> **Audience.** You've shipped systems that depend on time being right.
> You've debugged a Ticker that drifted by 2 seconds over an hour, a
> monotonic clock surprise after a JSON round-trip, and a `Timer` that
> didn't free its memory. This file covers the internals: the `Time`
> struct layout, how `timerproc` schedules, what the IANA database
> actually contains, leap seconds (Go ignores them), NTP jumps, and the
> Go 1.23 timer GC story.

## 1. The `time.Time` struct, exactly

The Go runtime defines `time.Time` (paraphrased from `src/time/time.go`) as:

```go
type Time struct {
    wall uint64
    ext  int64
    loc  *Location
}
```

Three fields, 24 bytes on 64-bit. The clever encoding lives in `wall`
and `ext`:

- `wall` packs **either** a flag bit + monotonic-flag bit + 30 bits of
  seconds since 1885 + 33 bits of nanoseconds, **or** zero seconds and
  33 bits of nanoseconds (when there's no monotonic reading).
- `ext` is **either** the seconds since year 1 (when there's no
  monotonic reading) **or** the monotonic reading (when there is one).

The top bit of `wall` is the "has monotonic" flag. The next bit is
unused. The remaining 62 bits hold either:

- 30 bits of "seconds since 1885" + 32 bits of nanoseconds (when
  monotonic is present — the 30-bit window covers Jan 1 1885 through
  ~Jan 19 2157), with the actual wall instant computable, and `ext`
  holds the monotonic reading in nanoseconds since process start.

- Or, when monotonic is absent, the entire `wall` holds nanoseconds
  and `ext` holds seconds since year 1 in a wider range that covers
  all representable times.

You don't need this to use the package, but it explains:

- Why `time.Time` is 24 bytes (not the 8 you'd expect from a pointer).
- Why some operations strip the monotonic clock (they have to convert
  back to the wider, monotonic-free encoding).
- Why `Round`/`Truncate`/`In`/`UTC` are documented to preserve or
  strip the monotonic clock — it's a representation switch, not a
  semantic loss.

## 2. The monotonic clock attachment, exactly

`time.Now()`:

```go
func Now() Time {
    sec, nsec, mono := now()    // runtime: vDSO clock_gettime
    mono -= startNano
    sec += unixToInternal - minWall
    return Time{
        wall: hasMonotonic | uint64(sec)<<nsecShift | uint64(nsec),
        ext:  mono,
        loc:  Local,
    }
}
```

The `now()` runtime function reads both the wall clock (`CLOCK_REALTIME`)
and the monotonic clock (`CLOCK_MONOTONIC`) in a single vDSO call on
Linux. `startNano` is the monotonic reading at process start, set in
`runtime.nanotime` initialization. So the monotonic field of any
`time.Time` is "nanoseconds since this process began."

`time.Date(...)`, `time.Unix(...)`, `time.Parse(...)`, and JSON unmarshal
all construct a `Time` *without* a monotonic reading — there's no
process-local "since start" value to attach to a constructed instant.
That's why the round-trip strips it.

## 3. Why `==` lies and `Equal` works

`==` on a struct compares fields. Two `Time` values that disagree on
their `wall` encoding (one has the monotonic flag, the other doesn't)
fail `==` even when they refer to the same instant. The encodings are
different.

`Equal` compares the *wall instant* explicitly:

```go
func (t Time) Equal(u Time) bool {
    if t.wall&u.wall&hasMonotonic != 0 {
        return t.ext == u.ext
    }
    return t.sec() == u.sec() && t.nsec() == u.nsec()
}
```

If both have a monotonic reading, comparing `ext` is enough (both
were taken from `Now()` in the same process; same monotonic value
implies same wall instant). Otherwise, fall back to wall-clock
seconds + nanoseconds.

This is the canonical way to compare times. Using `==` on `Time` is a
code smell, even if the values happen to agree today.

## 4. Why `Sub` doesn't lie

`Sub` and `Since` always prefer the monotonic clock when both
operands have one:

```go
func (t Time) Sub(u Time) Duration {
    if t.wall&u.wall&hasMonotonic != 0 {
        te, ue := t.ext, u.ext
        return Duration(te - ue)
    }
    // fall back to wall-clock arithmetic
    ...
}
```

This is why the canonical "elapsed time" pattern works across NTP
slews and jumps:

```go
start := time.Now()              // monotonic captured
doWork()
elapsed := time.Since(start)     // monotonic - monotonic
```

Even if NTP corrects the wall clock backwards by 30 seconds during
`doWork`, `elapsed` is positive and accurate. The monotonic clock
isn't affected.

But:

```go
start := time.Now().Round(0)     // monotonic stripped
doWork()
elapsed := time.Since(start)     // wall - wall (wrong if NTP jumped)
```

Stripping monotonic on the start time defeats the protection. A
common-but-subtle bug: storing `Time` values in a struct and JSON-encoding
that struct as a side effect of logging or testing strips the monotonic
clock from the persisted copy. If you then load it back and subtract,
you're doing wall-clock math.

## 5. Tzdata: where it comes from, what it contains

The IANA timezone database (also called the Olson database, after its
maintainer) is the source of truth for civilian timezones worldwide.
It contains:

- A list of zones (`Africa/Cairo`, `America/Los_Angeles`, ...).
- For each zone, the historical and projected sequence of offset
  changes (DST transitions, political timezone changes, etc.).
- Country/zone mappings.

The data is updated several times a year as governments change their
DST rules. For example: Egypt has flipped between observing and not
observing DST at least four times in the last decade.

On a typical Linux/macOS system, you'll find the compiled-binary form
under `/usr/share/zoneinfo/`. The files are in TZif format (the binary
zoneinfo format). On Windows, the OS does not ship IANA zoneinfo at
all; Go falls back to its embedded copy.

Go's `time` package looks up zoneinfo in this order (from
`src/time/zoneinfo_unix.go` and friends):

1. `$ZONEINFO` environment variable.
2. The Go-embedded zoneinfo (only present if `time/tzdata` was imported).
3. Several well-known OS paths (`/usr/share/zoneinfo`,
   `/usr/share/lib/zoneinfo`, `/usr/lib/locale/TZ/`).
4. `$GOROOT/lib/time/zoneinfo.zip` as a last resort.

The `time/tzdata` package, when imported for side effects, registers
a function that the lookup chain consults at step 2:

```go
import _ "time/tzdata"
```

This adds ~450 KB to the binary and makes timezone lookup independent
of the host OS. It's the right choice for:

- Single-binary Docker images (`FROM scratch`, `FROM distroless`).
- CLIs distributed to mixed environments.
- Any deployment where you cannot guarantee `/usr/share/zoneinfo` is
  present and recent.

The downside of *not* using `tzdata`: a binary built today against a
host with older zoneinfo will use the older rules. If a country
changes its DST rules and your container's zoneinfo isn't updated,
your code will compute the wrong wall clock for instants near the
transition. With `tzdata` embedded, the rules are pinned to the Go
version (which gets refreshed on minor releases).

## 6. `LoadLocationFromTZData`

If you have your own TZif file (perhaps shipped in `embed.FS`), you
can construct a `*Location` directly:

```go
//go:embed zoneinfo/Antarctica/Casey
var caseyTZ []byte

loc, err := time.LoadLocationFromTZData("Antarctica/Casey", caseyTZ)
if err != nil {
    return err
}
```

This is the escape hatch when:

- You need a zone Go's embedded `tzdata` doesn't have (rare).
- You want to ship a tiny subset of zones rather than the full ~450 KB.
- You're building a service for a single deployment region and want to
  hard-code its zone.

The function expects the binary TZif format, not the text source.

## 7. Leap seconds: Go ignores them

Civilian time on Earth is *not* a uniform monotonic count of seconds.
UTC inserts (or, in principle, removes) "leap seconds" to keep up with
Earth's irregular rotation. Since 1972, 27 leap seconds have been
added; the most recent was 2016-12-31 23:59:60 UTC. The next is
indefinitely deferred — the IERS announced in 2022 that leap seconds
will be retired by 2035.

Go's `time` package ignores leap seconds. `time.Date(2016, 12, 31,
23, 59, 60, 0, time.UTC)` normalizes to `2017-01-01 00:00:00 UTC`.
`Unix` time as Go computes it does not jump on leap seconds — it
treats every day as exactly 86400 seconds.

In practice, this means:

- For most application use, you never notice. Cloud providers smear
  leap seconds across the day (Google's "leap smear") so all client
  clocks stay aligned with each other.
- For systems requiring true UTC precision (financial trading,
  scientific instruments), Go is the wrong tool, and you'd be using
  TAI or PTP at the application level anyway.
- Comparing Go-computed Unix times to clock readings during a leap
  second can be off by 1 second for the duration of the leap second.

The Go FAQ has an explicit entry on this: leap seconds are not
supported and won't be added.

## 8. NTP jumps and the monotonic clock as armor

NTP can adjust the system wall clock in two ways:

- **Slew** — slowly speed up or slow down the clock to converge.
  Wall-clock readings stay monotonically increasing but at a rate
  slightly different from real time. Doesn't break elapsed-time math.
- **Step** — instantaneously jump the clock to a new value. Can be
  forward or backward. Breaks naive `time.Now().Sub(earlier_now)`
  arithmetic when the step is between the two reads.

NTP daemons typically slew small offsets (under ~128 ms) and step
larger ones, on the assumption that small drift is best smoothed and
large offsets are emergencies. The default behavior of `chrony` is
similar.

Because Go's `Time` carries a monotonic reading, `Sub`/`Since` are
immune to NTP steps:

```go
start := time.Now()
// some external event jumps the system clock back by 30 seconds
elapsed := time.Since(start)  // still positive, still accurate
```

The only failure mode: if the monotonic reading was stripped (Round(0),
serialization round-trip, parsing), `Sub` falls back to wall-clock
math and an NTP jump can produce a negative duration or a wildly wrong
value.

For long-running processes (queue workers, schedulers), the safest
pattern is: only persist wall-clock times for storage, but always
keep an in-memory `Time` value with monotonic for elapsed calculations.

## 9. The runtime timer implementation, sketch

The runtime maintains a heap of pending timers. (Pre-Go 1.14 there was
a single global heap; Go 1.14 sharded it per-P; Go 1.23 reworked the
timer-removal path and made `time.After` GC-safe.)

The basic shape:

1. Each `runtime.P` has a min-heap of `*runtime.timer`, ordered by
   `when` (the absolute monotonic time when the timer should fire).
2. `runtime.timeSleepUntil` returns the earliest `when` across all
   `P`s. The scheduler uses this to set the deadline for the netpoll
   call, so an idle process wakes when the next timer is due.
3. When a `P` runs the scheduler, it checks its timer heap and fires
   any timer whose `when` has passed. "Firing" calls `f(arg, seq)` —
   for a channel-based timer, `f` sends the current time on the
   channel; for `AfterFunc`, `f` enqueues the callback into the
   runtime's goroutine pool.
4. `Stop` removes a timer from the heap. `Reset` updates `when` and
   re-heaps.

Implications:

- Timer firing precision is approximately the OS scheduler's
  precision, plus heap-management overhead. On Linux, expect
  millisecond-scale jitter in the worst case, microseconds in
  steady state.
- A million pending timers is fine. The heap operations are
  O(log n).
- `Stop` is O(log n), but the timer object is not freed until the
  next time the scheduler walks the heap (which happens on the next
  scheduling event for that P). This was the source of the pre-1.23
  `time.After` leak: stopped timers stayed in the heap, holding
  channels alive.

## 10. The Go 1.23 timer GC fix

Before Go 1.23:

```go
for {
    select {
    case <-ch:
    case <-time.After(time.Hour): // each call leaks until it fires
    }
}
```

Each `time.After` call allocated a `*Timer` and a channel. The runtime
held both alive in the timer heap until the timer fired. If `ch`
fired first, the `time.After` timer was stuck in the heap for an
hour, with its channel pinned, with the goroutine waiting on the
select case unable to proceed.

Go 1.23 changed two things:

1. **`Timer.Stop` now removes timers from the heap immediately** in
   the common case, rather than marking them for later removal.
2. **Timer values can be GC'd while still in the heap.** The runtime
   holds them via finalizer-safe weak references; if no application
   code holds the `*Timer` or its channel, the timer is dropped from
   the heap on the next collection.

For application code, this means `time.After` in a `select` is safe
again. The leak that was idiomatic-but-broken from 2010 to 2024 is
gone, as long as your build targets Go 1.23+.

For libraries that want to support older Go versions, the
hoisted-timer pattern (allocate a `*Timer` once, `Stop`/`Reset` on
each iteration) is still the safe choice.

## 11. Ticker drift over long intervals

A `Ticker` does **not** schedule itself relative to the previous
firing. Each tick sets the next `when` based on the **previous
intended fire time**, not the actual fire time. So small per-tick
delays don't accumulate.

```go
// Pseudocode for ticker firing:
nextFire := initialFire + period
// when current fire time arrives:
sendOnChannel(actualNow)
nextFire += period   // independent of actualNow
```

This means a 1-second ticker with occasional 50-ms scheduler delays
still fires at approximately the correct absolute times, on average.
Long-term drift is bounded by the OS clock's drift, not by
scheduling jitter.

But: if the consumer is slow and ticks pile up faster than they're
consumed, the channel buffer (length 1) means **older ticks are
dropped**. The consumer never sees them. If you need "exactly N
events per second, ever," a `Ticker` is the wrong primitive — you
need explicit accounting (a counter incremented on each tick, with
the consumer catching up).

For tasks that should run at absolute wall-clock times (e.g., "every
hour at :00"), don't use `Ticker` at all. Compute the next absolute
wall-clock target and `time.Sleep` (or `Timer`) until then:

```go
func nextHour(now time.Time) time.Time {
    return now.Truncate(time.Hour).Add(time.Hour)
}

for {
    sleep := time.Until(nextHour(time.Now()))
    select {
    case <-ctx.Done():
        return ctx.Err()
    case <-time.After(sleep):
    }
    runHourlyJob()
}
```

This sleeps to the next aligned hour each iteration. No drift.

## 12. The pending-timer GC subtlety

A pending `Timer` (one whose `Stop` has not been called and whose
`when` is in the future) holds a reference to its callback closure
(for `AfterFunc`) or its channel (for `NewTimer`). As long as the
runtime's heap holds the timer, the closure cannot be GC'd, even if
no application code holds either.

This is mostly fine but can surprise:

- `time.AfterFunc(time.Hour, func() { somePtr.do() })` keeps `somePtr`
  alive for an hour. If `somePtr` is a large object you wanted GC'd,
  it won't be.
- `time.NewTimer(time.Hour)` keeps the channel alive for an hour.
  If you discard the `*Timer` without `Stop()`, you've leaked the
  channel and the heap entry.

Always `Stop()` timers you no longer need.

Pre-Go 1.23, the same applied to `time.After`. Post-1.23, the runtime
collects unreferenced timers, so `time.After` in a `select` no longer
extends lifetimes.

## 13. `Round` vs `Truncate` semantics, formal

```go
func (t Time) Truncate(d Duration) Time
func (t Time) Round(d Duration) Time
```

Both round `t` to a multiple of `d` *since the zero time* (Jan 1
year 1 in `t.Location()`). Both work on the absolute monotonic-free
seconds-since-zero count.

- `Truncate(d)` rounds **down**.
- `Round(d)` rounds to the **nearest** multiple, with halves rounding
  **up**.
- `Round(0)` strips the monotonic reading and returns the same wall
  instant.
- `Truncate(0)` is a no-op for both wall and monotonic — returns `t`
  unchanged.

For aligning to **timezone-aware** units (start of local day, start of
local week), `Truncate` is **wrong** because it operates on UTC
seconds since year 1. To get "midnight in local time," construct
explicitly:

```go
t := time.Now().In(loc)
midnight := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, loc)
```

`t.Truncate(24 * time.Hour)` gives you "midnight UTC, regardless of
zone," which is rarely what you want.

## 14. The `time.Tick` documentation, exactly

From the package docs:

> Tick is a convenience wrapper for NewTicker providing access to the
> ticking channel only. While Tick is useful for clients that have no
> need to shut down the Ticker, **be aware that without a way to shut
> it down the underlying Ticker cannot be recovered by the garbage
> collector; it "leaks".** Unlike NewTicker, Tick will return nil if
> d <= 0.

Treat as documentation that it's a footgun. In ten years of writing
Go services, the right number of `time.Tick` uses is approximately
zero.

## 15. `*time.ParseError` shape

Parse failures return `*time.ParseError`:

```go
type ParseError struct {
    Layout     string
    Value      string
    LayoutElem string
    ValueElem  string
    Message    string
}
```

The message format is "parsing time \"VALUE\" as \"LAYOUT\":
cannot parse \"VALUE_REMAINDER\" as \"LAYOUT_REMAINDER\"" — both the
full strings and the specific element where the parse stopped.

To handle a parse error programmatically:

```go
t, err := time.Parse(layout, value)
if err != nil {
    var pe *time.ParseError
    if errors.As(err, &pe) {
        // pe.LayoutElem and pe.ValueElem tell you what failed
    }
    return err
}
```

For UI feedback, the `Message` field is human-readable enough to show
directly. For programmatic dispatch, key off `pe.LayoutElem`.

## 16. `time.Time.Format` and the "stutter" rule

Inside a layout, the package recognizes specific *number sequences*
as field placeholders. Any other character is literal:

```go
t.Format("Today is 2006-01-02 at 15:04:05")
// "Today is 2026-05-06 at 14:30:45"
```

The "stutter" rule: `06` means "two-digit year", and `2006` means
"four-digit year." If you write `06` in your layout literal text, the
formatter will substitute. To use a literal `06` (e.g., in "version
2006"), there's no escape — you have to construct the string by
splitting around the timestamp:

```go
"Version " + "06" + " released on " + t.Format("2006-01-02")
```

Or use `Sprintf`-style assembly. There are no `%`-escapes in `time`
layouts; the substitution is purely positional. This is the trade-off
for the "memorable reference time" design.

Same principle for the other digits: `2`, `02`, `15`, `04`, `05`,
`07` (zone), `2006`, `Jan`, `January`, `Mon`, `Monday`, `MST`. Avoid
these sequences in literal portions of your layout.

## 17. `time.Now` cost

On Linux amd64, `time.Now` calls into the vDSO for `clock_gettime`,
typically taking 20–50 ns. This is fast enough that you usually don't
need to worry about it, but for hot loops (per-request log lines,
metrics) it adds up.

```go
// 100k requests per second, two time.Now per request:
// 200k * 30ns = 6 ms/sec, 0.6% CPU just on time.Now
```

In tight benchmarking and very hot paths, batch time reads or use
`time.Since(start)` (one `Now` per measurement instead of two).

`time.Now` is not free of side effects: it allocates the *struct* on
the stack (8 bytes from `runtime.now()` plus a few field assigns), and
returns it by value. The struct doesn't escape unless you store it
somewhere with longer lifetime.

We come back to this in [optimize.md](optimize.md).

## 18. `time.Time` in maps

A `time.Time` is comparable (it's a struct of comparable fields), so
it works as a map key. But `==` on `Time` values has the monotonic-clock
trap: two times that mean the same wall instant can be unequal as map
keys.

```go
m := map[time.Time]string{}
m[time.Now()] = "a"
key := time.Now() // different monotonic, but maybe same wall second
_, ok := m[key]   // false
```

Rule: **strip monotonic before using as a map key.** Either
`t.Round(0)` or `t.Truncate(d)` (which also strips monotonic as a
side effect of returning a new `Time`):

```go
m := map[time.Time]string{}
m[time.Now().Round(0)] = "a"
```

Or, better, use `int64` (Unix nanos) as the key:

```go
m := map[int64]string{}
m[time.Now().UnixNano()] = "a"
```

Integer keys are smaller, faster to hash, and have no monotonic surprise.

## 19. Concurrency: which methods are safe

`time.Time` is a value type. There's no mutable state to race on.
`Now`, `Since`, `Until`, `Format`, etc., are all safe to call
concurrently from many goroutines.

`*Timer` and `*Ticker` are different stories:

- `Timer.Stop`, `Reset`, and reads from `t.C` are safe to call
  from any goroutine. The runtime synchronizes internally.
- `Ticker.Stop`, `Ticker.Reset`, and reads from `t.C` similarly.
- But: calling `Reset` on a `Timer` while another goroutine is
  reading from `t.C` is racy in pre-1.23 Go (the channel can deliver
  a stale value). Post-1.23, `Reset` blocks any pending fire and
  the channel is consistent.

For most uses, one goroutine owns a `Timer`/`Ticker` and others read
from the channel. That's the safe pattern.

## 20. `time/tzdata` and binary-size sensitivity

The embedded zoneinfo adds ~450 KB to the binary. For a typical
service, that's negligible. For a CLI that wants to be small (under
5 MB), that's noticeable.

Options:

1. Don't import `time/tzdata`. Rely on the OS. If you ship into
   environments without `/usr/share/zoneinfo`, document it.

2. Import `time/tzdata` and accept the 450 KB.

3. Embed only the zones you need with `LoadLocationFromTZData`:

   ```go
   //go:embed zoneinfo/UTC zoneinfo/America/New_York
   var zones embed.FS

   func init() {
       data, _ := zones.ReadFile("zoneinfo/America/New_York")
       loc, _ := time.LoadLocationFromTZData("America/New_York", data)
       // store loc in a global, or replace time.Local
   }
   ```

Option 3 is rarely worth the maintenance burden — you'd have to update
the embedded files when zoneinfo changes. Option 2 is the default
recommendation for any binary not measuring its size in single-digit
megabytes.

## 21. The "timer.Stop returns false" race, exactly

```go
t := time.NewTimer(d)
// ... other goroutine sends nothing, but firing happens here ...
if !t.Stop() {
    <-t.C  // can hang forever
}
t.Reset(d2)
```

The race: the timer's goroutine fires and sends on `t.C` between your
`Stop` and your read. The pre-1.23 stdlib documentation explicitly
recommended:

```go
if !t.Stop() {
    select {
    case <-t.C:
    default:
    }
}
```

The non-blocking select handles both cases:

- The fire already happened and put a value in the channel: drained.
- The fire was prevented by `Stop` returning `false` only because the
  timer was already stopped earlier: nothing in the channel; default
  branch taken.

Post-1.23, the runtime guarantees that after `Stop` returns, the
channel is empty (the runtime drains it for you). Code targeting 1.23+
exclusively can drop the explicit drain.

## 22. `time.Sleep` implementation note

`time.Sleep(d)` calls into the runtime, which puts the current
goroutine on a timer heap with `when = nanotime() + d.Nanoseconds()`.
The goroutine is parked. When the timer fires, the goroutine is
unparked and the scheduler runs it.

Two implications:

1. **No syscall is involved.** `Sleep` doesn't `nanosleep`; it parks
   the goroutine and lets other goroutines run on the same OS thread.
2. **Sleep is uninterruptible.** Once parked on a timer, the goroutine
   cannot be unblocked except by the timer firing. Cancellation
   requires layering `select` with `ctx.Done()` outside.

For long sleeps in cancellable code paths, never call `time.Sleep`
directly. Use the `select`-on-`After`-and-`ctx.Done` pattern from
[middle.md](middle.md).

## 23. What to read next

- [professional.md](professional.md) — production patterns: backoff
  with jitter, deadline propagation across services, fake clocks at
  scale.
- [specification.md](specification.md) — the formal reference
  distilled.
- [find-bug.md](find-bug.md) — drills based on the items in this file.
- [optimize.md](optimize.md) — `Now()` cost, allocation-free
  formatting, timer pooling.
