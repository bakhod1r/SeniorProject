# 8.3 `time` — Junior

> **Audience.** You've used `time.Now()` and maybe `time.Sleep`, and
> you've seen `time.Time` show up as a struct field in JSON. By the end
> of this file you will know what a `time.Time` actually is, what a
> `Duration` actually is, how to read clocks, sleep, format, parse,
> handle a timezone, and use `Timer`/`Ticker` without leaking goroutines.

## 1. `time.Time` is a value, not a handle

`time.Time` is a small struct (24 bytes on 64-bit). It represents an
instant in time with nanosecond precision. You pass it by value, you
compare it with package methods, and you do not keep pointers to it.

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    t := time.Now()
    fmt.Println(t)              // e.g. 2026-05-06 10:00:00.123456 +0000 UTC m=+0.000123
    fmt.Println(t.Year(), t.Month(), t.Day())
    fmt.Println(t.Hour(), t.Minute(), t.Second())
    fmt.Println(t.UnixNano())   // ns since Unix epoch
}
```

The zero value (`time.Time{}`) is January 1, year 1, 00:00:00 UTC. Use
`t.IsZero()` to check for "unset" — never compare `t == time.Time{}`,
which works but reads worse and breaks if the value carried a
monotonic reading.

```go
var when time.Time
if when.IsZero() {
    when = time.Now()
}
```

## 2. `time.Duration` is an integer

A `Duration` is an `int64` counting *nanoseconds*. Arithmetic on
durations is integer arithmetic. The package gives you constants for
the common units:

```go
const (
    Nanosecond  Duration = 1
    Microsecond          = 1000 * Nanosecond
    Millisecond          = 1000 * Microsecond
    Second               = 1000 * Millisecond
    Minute               = 60 * Second
    Hour                 = 60 * Minute
)
```

You build durations by multiplying. Don't write `5 * time.Second` and
forget that the result is still a `Duration`:

```go
d := 250 * time.Millisecond
fmt.Println(d)              // 250ms
fmt.Println(d.Seconds())    // 0.25 (float64)
fmt.Println(int64(d))       // 250000000
```

There is **no `Day` constant** — and not because the package designers
forgot. A "day" depends on the calendar (DST, leap seconds, timezone),
and a `Duration` is an absolute span. To add a calendar day, use
`AddDate(0, 0, 1)` on a `Time`, not `Add(24 * time.Hour)`. We come back
to this in [middle.md](middle.md).

## 3. Reading the clock: `Now`, `Since`, `Until`

```go
t := time.Now()              // wall + monotonic clock at this instant
elapsed := time.Since(t)     // shortcut for time.Now().Sub(t)
remaining := time.Until(deadline)
```

`time.Since(t)` is the single most-used function in the package. It is
literally:

```go
func Since(t Time) Duration { return Now().Sub(t) }
```

Use it for "how long did this take" and elapsed-time logging:

```go
start := time.Now()
doExpensiveThing()
log.Printf("took %s", time.Since(start))
```

Use `time.Until(deadline)` for "how long until the deadline":

```go
deadline := time.Now().Add(5 * time.Second)
fmt.Println(time.Until(deadline)) // ~5s
```

Both functions use the *monotonic* clock that `Now` records, which
means they don't get confused by NTP jumping the wall clock backwards.
You'll see the why in middle.md and senior.md; for now, just trust that
`Since`/`Until` are the right primitives for elapsed-time.

## 4. Sleeping: `time.Sleep`

```go
time.Sleep(2 * time.Second)
```

`Sleep` blocks the current goroutine for at least the given duration.
A few things to internalize on day one:

1. **`Sleep` is not cancelable.** A goroutine stuck in `time.Sleep(time.Hour)`
   will not wake up if you cancel a context. For anything in a request
   path, use `<-ctx.Done()` or `time.After(...)` selected against
   `ctx.Done()`. We cover this in [middle.md](middle.md) and
   [professional.md](professional.md).
2. **`Sleep` is not exact.** The OS scheduler decides when to wake you.
   Expect microseconds-to-milliseconds of jitter on top of the
   requested duration.
3. **For polling, `time.Sleep` in a tight loop is almost always wrong.**
   A `time.Ticker` or a watch on `ctx.Done()` is better.

For top-level scripts and tests, `time.Sleep` is fine. In a service,
think twice.

## 5. Adding and subtracting time

```go
later := t.Add(10 * time.Minute)        // Time + Duration → Time
earlier := t.Add(-10 * time.Minute)
diff := later.Sub(earlier)              // Time - Time → Duration
```

`AddDate` works in calendar units, respecting month length and DST:

```go
nextMonth := t.AddDate(0, 1, 0)         // y, m, d
nextYear  := t.AddDate(1, 0, 0)
tomorrow  := t.AddDate(0, 0, 1)         // calendar day, not 24h
```

`AddDate` is normalizing — `AddDate(0, 0, 31)` to January 31 produces
March 3 (not March 31), because it adds 31 days, not "advance one
month and two days." If you want "the same day next month, clamped to
the last day if the month is shorter," you have to write that yourself.

## 6. Comparing times: `Before`, `After`, `Equal`

```go
if a.Before(b) { /* a is earlier */ }
if a.After(b)  { /* a is later   */ }
if a.Equal(b)  { /* same instant */ }
```

Use these methods, not `<`, `>`, or `==`. The reason `==` can lie comes
from the monotonic-clock reading attached to a `time.Time` returned by
`Now`. Two `Time` values can refer to the same instant but have
different monotonic readings (one was deserialized, one was not), and
`==` will say they differ. `Equal` compares only the wall reading and
gives you the right answer.

```go
a := time.Now()
b := a.Round(0)              // strips monotonic; same instant
fmt.Println(a == b)          // false (monotonic differs)
fmt.Println(a.Equal(b))      // true
```

Rule: **always use `Equal`, never `==`.** It costs nothing extra and
saves you from confusing bugs. (More on `Round(0)` and the monotonic
clock in middle.md.)

## 7. Timezones, day one

A `time.Time` carries a `*time.Location`. The location decides how the
wall clock breaks the instant into year/month/day/hour/minute/second
when you call accessors or format the value.

Two locations are always available:

```go
time.UTC          // Coordinated Universal Time
time.Local        // The local timezone of the running process
```

Convert between them with `In`:

```go
t := time.Now()
fmt.Println(t.In(time.UTC))
fmt.Println(t.In(time.Local))
```

`In` does not change the instant — it only changes how the value will
be presented. The underlying point in time is the same.

To load a named IANA timezone (`Europe/Berlin`, `Asia/Tashkent`,
`America/Sao_Paulo`):

```go
loc, err := time.LoadLocation("Europe/Berlin")
if err != nil {
    return err
}
fmt.Println(t.In(loc))
```

`LoadLocation` reads from the operating system's timezone database
(`/usr/share/zoneinfo` on Linux/macOS). On systems where that doesn't
exist (minimal Docker images, Windows in some configurations), it
fails. The fix is the embedded zoneinfo, covered in [middle.md](middle.md):

```go
import _ "time/tzdata" // pulls the IANA database into the binary
```

For now, know that `LoadLocation` *can* fail and you should check it.

## 8. Constructing a `Time` explicitly

```go
t := time.Date(2026, time.May, 6, 14, 30, 0, 0, time.UTC)
//          year, month,    d,  h,  m, s, ns, location
```

`Month` is a typed enum (`time.January`, `time.February`, …). `time.Date`
normalizes out-of-range values: `time.Date(2026, 13, 1, ...)` becomes
January 2027, and `(2026, 5, 32, ...)` becomes June 1, 2026.

```go
unsafe := time.Date(2026, 13, 1, 0, 0, 0, 0, time.UTC)
fmt.Println(unsafe)  // 2027-01-01 00:00:00 +0000 UTC
```

Useful for date arithmetic: "the first day of next month" is
`time.Date(y, m+1, 1, 0, 0, 0, 0, loc)`.

## 9. Formatting: the reference time

Go does not use `%Y-%m-%d` or `dd/MM/yyyy`. It uses *one specific
moment* as the template:

```
Mon Jan 2 15:04:05 MST 2006
```

Each field is a particular number, and the formatter substitutes the
corresponding field from your `Time` value:

| Reference | Meaning |
|-----------|---------|
| `2006` | 4-digit year |
| `06`   | 2-digit year |
| `01`   | Month (zero-padded) |
| `1`    | Month (no padding) |
| `Jan`  | Month abbreviation |
| `January` | Month full name |
| `02`   | Day of month (zero-padded) |
| `2`    | Day of month (no padding) |
| `Mon`  | Weekday abbrev |
| `Monday` | Weekday full |
| `15`   | Hour 24h (zero-padded) |
| `03`   | Hour 12h (zero-padded) |
| `04`   | Minute |
| `05`   | Second |
| `MST`  | Timezone abbreviation |
| `-0700`| Timezone offset |
| `Z07:00` | Timezone offset, with `Z` for UTC (RFC3339 style) |

```go
t := time.Date(2026, 5, 6, 14, 30, 45, 0, time.UTC)
fmt.Println(t.Format("2006-01-02 15:04:05"))           // 2026-05-06 14:30:45
fmt.Println(t.Format("Mon, 02 Jan 2006 15:04:05 MST")) // Wed, 06 May 2026 14:30:45 UTC
fmt.Println(t.Format("Jan 2, 2006"))                   // May 6, 2026
fmt.Println(t.Format(time.RFC3339))                    // 2026-05-06T14:30:45Z
```

The mnemonic for the reference time: 1, 2, 3, 4, 5, 6, 7 — month 1,
day 2, hour 03, minute 04, second 05, year 06, zone -07:00. The Go
designers chose it on purpose so the order of fields is memorable.

### Pre-defined layouts

The package ships layout constants for the formats you want most often:

```go
time.RFC3339         // "2006-01-02T15:04:05Z07:00"
time.RFC3339Nano     // ...with nanoseconds
time.RFC1123         // "Mon, 02 Jan 2006 15:04:05 MST"
time.Kitchen         // "3:04PM"
time.Stamp           // "Jan _2 15:04:05"
time.DateTime        // "2006-01-02 15:04:05"  (Go 1.20+)
time.DateOnly        // "2006-01-02"           (Go 1.20+)
time.TimeOnly        // "15:04:05"             (Go 1.20+)
```

Prefer `time.DateTime` and `time.DateOnly` over hand-written layouts
where they fit — they read better.

## 10. Parsing: same reference time, in reverse

`time.Parse(layout, value)` reads `value` according to `layout`:

```go
t, err := time.Parse(time.RFC3339, "2026-05-06T14:30:45Z")
if err != nil {
    return err
}
fmt.Println(t)
```

`Parse` returns a `Time` in UTC unless the value's text supplies a
zone. For values that omit the zone but should be interpreted in a
specific one, use `time.ParseInLocation`:

```go
loc, _ := time.LoadLocation("Europe/Berlin")
t, err := time.ParseInLocation("2006-01-02 15:04:05", "2026-05-06 14:30:00", loc)
// t represents 14:30 Berlin time
```

If the text does not match the layout, you get a `*time.ParseError`
with a useful message:

```go
_, err := time.Parse("2006-01-02", "May 6, 2026")
fmt.Println(err) // parsing time "May 6, 2026" as "2006-01-02": cannot parse "May 6, 2026" as "2006"
```

The most common parse mistake is using a layout from another language:
`yyyy-MM-dd` will not work. Always use the reference numbers.

## 11. Unix time

```go
secs := time.Now().Unix()         // int64 seconds since 1970-01-01 UTC
nanos := time.Now().UnixNano()    // int64 nanoseconds
millis := time.Now().UnixMilli()  // Go 1.17+
micros := time.Now().UnixMicro()  // Go 1.17+

// Reverse direction:
t := time.Unix(secs, 0)           // (sec, nsec) → Time in time.Local
t2 := time.UnixMilli(millis)
```

Unix times are timezone-independent — they always count from a fixed
UTC instant. The `Time` you get back is in `time.Local` by default;
call `.UTC()` if you want UTC.

For storing timestamps in databases or wire formats, prefer Unix
seconds (or milliseconds) over formatted strings. They sort correctly
as integers, never have parsing ambiguity, and are 8 bytes.

## 12. `time.Timer` — fire once

A `Timer` sends the current time on its channel after a duration:

```go
t := time.NewTimer(2 * time.Second)
<-t.C
fmt.Println("two seconds later")
```

You can stop a timer that hasn't fired:

```go
t := time.NewTimer(time.Hour)
if !t.Stop() {
    // already fired or stopped; if needed, drain t.C
}
```

`Stop` returns `true` if it stopped the timer before it fired, `false`
otherwise. The drain pattern (when you might race with the firing) is
in [middle.md](middle.md); for one-shot uses where you know the timer
hasn't fired, just call `Stop()`.

### `time.After` — the convenient one-shot

`time.After(d)` is a shortcut: it creates a `Timer` and returns its
channel. You don't have a handle to stop it.

```go
select {
case <-time.After(5 * time.Second):
    return errors.New("timeout")
case result := <-work:
    return result
}
```

Convenient. The catch: every `time.After` call allocates a new `Timer`
and, **before Go 1.23**, that timer was kept alive by the runtime
until it fired, even if you stopped caring. In a hot loop with a long
duration, this leaked memory. Go 1.23 fixed this: an unreferenced
`time.After` timer is now collectable. We come back to this in
[senior.md](senior.md) and [optimize.md](optimize.md). For day-one use
in `select` with short durations, `time.After` is fine.

## 13. `time.Ticker` — fire repeatedly

A `Ticker` fires every `d`:

```go
t := time.NewTicker(1 * time.Second)
defer t.Stop()                      // ALWAYS stop a ticker

for i := 0; i < 5; i++ {
    now := <-t.C
    fmt.Println("tick", now.Unix())
}
```

Two day-one rules:

1. **Always `Stop()` a `Ticker`.** A ticker you forget keeps firing
   forever and the runtime keeps it alive. This is a leak.
2. **The channel buffers exactly one tick.** If you don't drain fast
   enough, ticks are dropped (not queued). The `Ticker` is for "do
   something at a steady rate," not "exactly N events per second."

`for tick := range t.C` works:

```go
t := time.NewTicker(500 * time.Millisecond)
defer t.Stop()
for now := range t.C {
    fmt.Println(now)
    if shouldStop() {
        return
    }
}
```

But `range` over `t.C` never ends on its own — `Stop()` does not close
the channel. You have to break out manually. For long-running tickers
in services, it's safer to put the ticker inside a `select` that also
watches `ctx.Done()`:

```go
t := time.NewTicker(time.Minute)
defer t.Stop()
for {
    select {
    case <-ctx.Done():
        return ctx.Err()
    case <-t.C:
        if err := doWork(); err != nil {
            return err
        }
    }
}
```

This is the canonical "scheduled job inside a service" loop.

## 14. `time.AfterFunc` — fire once, in a goroutine

`AfterFunc(d, f)` schedules `f` to run in its own goroutine after `d`:

```go
t := time.AfterFunc(5*time.Second, func() {
    log.Println("five seconds later")
})

// You can cancel it before it runs:
if !t.Stop() {
    // already fired
}
```

`AfterFunc` is the right tool when you don't need to receive on a
channel — debounces, deferred cleanup, "if the user doesn't click in
3 seconds, dismiss the popup." Compared to `time.After`, it's
**cheaper**: no channel allocation, no goroutine waiting on the
channel. We come back to this in [middle.md](middle.md).

## 15. `time.Round` and `time.Truncate`

`Round(d)` rounds the time to the nearest multiple of `d`. `Truncate(d)`
rounds down. Both return a new `Time`.

```go
t := time.Date(2026, 5, 6, 14, 37, 28, 0, time.UTC)
fmt.Println(t.Truncate(time.Hour))  // 2026-05-06 14:00:00 UTC
fmt.Println(t.Round(time.Hour))     // 2026-05-06 15:00:00 UTC (37m28s rounds up)
fmt.Println(t.Truncate(15*time.Minute)) // 2026-05-06 14:30:00 UTC
```

Use `Truncate` for bucketing: aligning timestamps to the start of an
hour, day, or 5-minute window for metrics. Use `Round` for display
("nearest minute").

There is one special case: `t.Round(0)` strips the monotonic clock
reading from `t`. We'll use this trick in [middle.md](middle.md).

## 16. `time.Duration.Round` and `Truncate`

The same idea applies to durations:

```go
d := 1*time.Hour + 23*time.Minute + 45*time.Second
fmt.Println(d.Round(time.Minute))    // 1h24m0s
fmt.Println(d.Truncate(time.Minute)) // 1h23m0s
```

Often used right before logging a duration to suppress noisy
nanoseconds:

```go
log.Printf("request took %s", time.Since(start).Round(time.Millisecond))
```

## 17. The `time.Weekday`, `time.Month`, `time.YearDay`

```go
t := time.Now()
fmt.Println(t.Weekday())       // Wednesday
fmt.Println(t.Weekday() == time.Sunday)
fmt.Println(t.Month())         // May
fmt.Println(t.YearDay())       // 1..366
fmt.Println(t.ISOWeek())       // year, week (ISO 8601)
```

`Weekday` returns a `time.Weekday` int (Sunday = 0, Saturday = 6).
`Month` returns a `time.Month` int (January = 1). Both have `.String()`
methods, so they print as words.

## 18. Putting it together: a tiny "ago" helper

```go
func humanAgo(t time.Time) string {
    d := time.Since(t)
    switch {
    case d < time.Minute:
        return fmt.Sprintf("%ds ago", int(d.Seconds()))
    case d < time.Hour:
        return fmt.Sprintf("%dm ago", int(d.Minutes()))
    case d < 24*time.Hour:
        return fmt.Sprintf("%dh ago", int(d.Hours()))
    default:
        return t.Format("2006-01-02")
    }
}
```

Two things to notice: we used `time.Since` (monotonic-safe), and we
fell back to a `Format` call once the duration was big enough to be a
date rather than an elapsed time.

## 19. Putting it together: a `withTimeout` style call

`time.After` plus `select` is the most-Googled pattern in the package:

```go
func fetchWithTimeout(d time.Duration) (Result, error) {
    done := make(chan Result, 1)
    go func() {
        done <- fetch()
    }()
    select {
    case r := <-done:
        return r, nil
    case <-time.After(d):
        return Result{}, errors.New("timeout")
    }
}
```

This works, but it has a subtlety: if `fetch()` keeps running after
the timeout, you've just leaked a goroutine and a result. The proper
fix is to plumb a `context.Context` into `fetch` and let it observe
cancellation. `time.After` is fine for "give up locally"; for
plumbing across functions, use `context.WithTimeout` ([middle.md](middle.md)).

## 20. Putting it together: a 1-second heartbeat

```go
func heartbeat(ctx context.Context, w io.Writer) error {
    t := time.NewTicker(time.Second)
    defer t.Stop()

    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case now := <-t.C:
            if _, err := fmt.Fprintf(w, "alive at %s\n", now.Format(time.RFC3339)); err != nil {
                return err
            }
        }
    }
}
```

Note the order: declare the ticker, defer its stop, then loop. If you
ever forget the `defer t.Stop()`, the ticker keeps firing into a
channel nobody reads, and the runtime keeps a goroutine alive. For
short-lived tickers it's a few KiB; for long-lived services that spawn
many tickers, it's a leak you'll notice in production.

## 21. Errors and gotchas at this level

| Symptom | Likely cause |
|---------|--------------|
| `Parse` returns "cannot parse" | Layout uses non-reference numbers (e.g. `yyyy`) |
| `Time` comparison with `==` returns false unexpectedly | Monotonic clock attached on one side |
| `time.After` in a hot loop bloats memory | Pre-Go 1.23 leak; use `NewTimer` and `Reset` |
| Ticker never fires after a while | Forgot `Stop()`, then `Reset()` on a stale timer |
| Wrong wall-clock time after suspend/resume | NTP skew; use `time.Since` not `t1.Sub(t0)` for elapsed |
| `LoadLocation` errors in a Docker image | Missing `tzdata`; either install it or import `_ "time/tzdata"` |
| Adding 24h across DST puts you in the wrong hour | Use `AddDate(0, 0, 1)` for calendar days |

## 22. What to read next

- [middle.md](middle.md) — the monotonic clock, `Timer.Stop` drain
  pattern, `context.WithTimeout`, JSON marshaling, custom layouts.
- [senior.md](senior.md) — internals: how the runtime stores wall +
  monotonic, how the timer heap works, leap seconds, NTP jumps.
- [tasks.md](tasks.md) — a stopwatch, a debounce, a small scheduler.
- The official package docs:
  [`time`](https://pkg.go.dev/time).
