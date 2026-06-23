# 8.3 `time` — Middle

> **Audience.** You've written services that schedule things, parse
> timestamps from third-party APIs, and put a deadline on outbound RPCs.
> You've also been bitten by `==` on `time.Time` after a JSON
> round-trip. This file covers the monotonic clock in detail, timezone
> loading, Timer/Ticker pitfalls, `context` integration, JSON
> marshaling, custom layouts, and the production-shaped uses of
> `AfterFunc` vs `Timer`.

## 1. The monotonic clock, and why `==` lies

A `time.Time` returned by `time.Now()` carries **two readings**:

- **Wall clock** — the calendar date and time (1970-based, can jump
  backwards on NTP correction).
- **Monotonic clock** — a process-local counter that only goes
  forward, used for elapsed-time arithmetic.

The wall clock is what you format and serialize. The monotonic clock
is what `Sub`, `Since`, and `Until` actually use to compute durations.
This split matters because the wall clock can move backwards (NTP
slew, manual clock change, leap-second smearing). The monotonic clock
cannot, so elapsed-time math stays sane.

```go
a := time.Now()
time.Sleep(100 * time.Millisecond)
b := time.Now()
fmt.Println(b.Sub(a))    // ~100ms, computed from monotonic readings
```

Internally, `b.Sub(a)` checks whether both `a` and `b` have a
monotonic reading; if so, it subtracts those. Otherwise, it falls back
to wall-clock subtraction.

### When the monotonic reading goes away

Three operations strip the monotonic reading:

1. **Round/Truncate.** `t.Round(0)`, `t.Round(d)`, `t.Truncate(d)` —
   these all return a wall-only `Time`.
2. **In/Local/UTC.** `t.In(loc)`, `t.Local()`, `t.UTC()` keep the
   monotonic reading (Go 1.9+ behavior). The monotonic clock is
   process-local, not zone-dependent.
3. **Marshaling/unmarshaling.** Any serialization/deserialization
   round-trip loses the monotonic reading, because the wire format
   only carries wall-clock data.

```go
a := time.Now()
b := a.Round(0)         // strips monotonic
fmt.Println(a == b)     // false (one has m, other doesn't)
fmt.Println(a.Equal(b)) // true (same wall instant)
```

This is why **always use `Equal`, never `==`**. Two `Time` values that
represent the same instant can fail `==` because one has a monotonic
reading and the other doesn't.

### When you *want* to strip monotonic

For storage, comparison keys, and structs that go through equality
checks (map keys, `reflect.DeepEqual` in tests), the monotonic
reading is noise. Strip it explicitly with `Round(0)`:

```go
key := time.Now().Round(0) // wall-only; safe to compare with ==
```

This is especially relevant for tests: `reflect.DeepEqual(t1, t2)`
will return false on otherwise-identical `Time` values if their
monotonic readings differ. Round to 0 before comparing.

## 2. The serialization story

Standard library marshalers strip the monotonic clock because the
wire format has no field for it.

| Format | Monotonic preserved? | Default layout |
|--------|----------------------|----------------|
| `json.Marshal` | No | RFC3339 with nanoseconds |
| `xml.Marshal`  | No | RFC3339 |
| `(*Time).MarshalText` | No | RFC3339 |
| `(*Time).MarshalBinary` / `gob` | No | Custom binary, no monotonic |
| `time.Time.Format(...)` | No | What you ask for |

Round-tripping through any of them gives you back a wall-only `Time`:

```go
a := time.Now()
b, _ := json.Marshal(a)
var c time.Time
_ = json.Unmarshal(b, &c)
fmt.Println(a.Equal(c))  // true
fmt.Println(a == c)      // false (a has monotonic, c doesn't)
```

So: never use `==` on times that may have crossed a wire.

## 3. JSON: the default and the custom

The default JSON encoding of `time.Time` is RFC3339 with nanoseconds:

```go
type Event struct {
    At   time.Time `json:"at"`
    Note string    `json:"note"`
}

e := Event{At: time.Now(), Note: "hi"}
b, _ := json.Marshal(e)
fmt.Println(string(b))
// {"at":"2026-05-06T14:30:45.123456789Z","note":"hi"}
```

The `time.Time.MarshalJSON` method calls `Format(`"2006-01-02T15:04:05.999999999Z07:00"`)`.
On unmarshal, it accepts RFC3339 with or without fractional seconds.

If your wire format is different, wrap `time.Time` in a custom type:

```go
type DateOnly time.Time

func (d DateOnly) MarshalJSON() ([]byte, error) {
    s := time.Time(d).Format(`"2006-01-02"`)
    return []byte(s), nil
}

func (d *DateOnly) UnmarshalJSON(b []byte) error {
    t, err := time.Parse(`"2006-01-02"`, string(b))
    if err != nil {
        return err
    }
    *d = DateOnly(t)
    return nil
}
```

The trick of putting the quotes inside the layout (`"2006-01-02"`) is
common in custom JSON time types — it saves you from stripping and
re-adding the surrounding bytes manually.

For Unix timestamps over JSON:

```go
type UnixSecs time.Time

func (u UnixSecs) MarshalJSON() ([]byte, error) {
    return strconv.AppendInt(nil, time.Time(u).Unix(), 10), nil
}

func (u *UnixSecs) UnmarshalJSON(b []byte) error {
    n, err := strconv.ParseInt(string(b), 10, 64)
    if err != nil {
        return err
    }
    *u = UnixSecs(time.Unix(n, 0))
    return nil
}
```

## 4. Loading timezones, and the `_ "time/tzdata"` import

`time.LoadLocation("Asia/Tashkent")` consults, in order:

1. The `ZONEINFO` environment variable, if set (path to a zoneinfo
   directory or a zip file).
2. The Go-embedded zoneinfo, if you imported `time/tzdata` for side
   effects.
3. The OS zoneinfo directory (`/usr/share/zoneinfo` on Linux/macOS).
4. `$GOROOT/lib/time/zoneinfo.zip` as a last resort.

In a typical Linux desktop or full-fat server image, step 3 succeeds.
In `FROM scratch` Docker images, in `distroless`, in some Alpine
configurations, and on Windows in some configurations, it fails.

The robust answer: **import `time/tzdata` for side effects** and pay
the ~450 KB binary-size cost in exchange for guaranteed timezone
availability:

```go
import _ "time/tzdata"
```

After that, every `LoadLocation` call works regardless of the host
filesystem. For binaries that ship into restricted environments (CLIs,
single-binary Docker images), this import is part of the standard
recipe.

You can also load from in-memory zoneinfo data via
`time.LoadLocationFromTZData(name, data)`, useful when you have a
specific TZif file shipped with your application.

## 5. RFC3339 round-trips, exactly

RFC3339 is the right wire format for instants. Things to know:

- The `Z` at the end means UTC. Equivalent to `+00:00`.
- Fractional seconds are optional and variable-precision (1–9 digits).
- The zone offset is mandatory — no "naive" timestamps in RFC3339.
- A space separator (`2026-05-06 14:30:45Z`) is *not* RFC3339; that's
  ISO 8601's looser cousin. Use `T` in the middle.

```go
const layout = time.RFC3339Nano

t := time.Now()
s := t.Format(layout)
back, err := time.Parse(layout, s)
if err != nil {
    return err
}
fmt.Println(t.Equal(back)) // true (wall-clock equal)
fmt.Println(t == back)     // false (monotonic stripped on parse)
```

If you control both ends, use `RFC3339Nano` for outgoing and
`RFC3339` (which accepts `RFC3339Nano` too) for incoming. The package
parses either when the layout is `RFC3339` because the trailing
fractional component is optional in the layout itself.

For "wall clock with no zone" inputs from spreadsheets and forms,
`time.ParseInLocation` is the only safe choice — `time.Parse` defaults
to UTC and silently mislabels values that were intended as local time.

## 6. Timer.Stop, Timer.Reset, and the drain pattern

`Timer.Stop()` returns:

- `true` — the timer was active and Stop prevented it from firing.
- `false` — the timer had already fired (or already been stopped).

When `Stop` returns `false`, the value may already be sitting in the
channel. For one-shot timers you're throwing away, this is fine. For
timers you intend to `Reset` and re-use, you must drain the channel
first:

```go
t := time.NewTimer(d)

// later, you want to cancel and reuse:
if !t.Stop() {
    select {
    case <-t.C:
    default:
    }
}
t.Reset(newDuration)
```

The `select` with `default` is non-blocking — it pulls a stale value
from the channel if there is one, otherwise moves on. Without this
drain, the next `<-t.C` might immediately return the stale value
instead of the fresh one.

**Go 1.23 made this easier.** As of Go 1.23, `Reset` and `Stop` no
longer leave stale values in the channel — the timer's channel is
unbuffered (length 1) and drained automatically. Code written for
Go 1.23+ does not need the explicit drain after `Stop`. For code that
must compile on older versions, keep the drain pattern.

```go
// Go 1.23+:
t := time.NewTimer(d)
if !t.Stop() {
    // already fired; no drain needed
}
t.Reset(newDuration)
```

The release notes for Go 1.23 are explicit about this behavior change.
Check the version your build targets before relying on it.

## 7. `time.After` in a loop — the leak

`time.After(d)` allocates a new `Timer` every call. Before Go 1.23,
that timer was *kept alive* by the runtime until it fired, even if
you stopped caring (e.g., the `select` chose another case). A loop
using `time.After` with a long duration leaked memory at the rate of
one timer per iteration:

```go
// PRE-GO 1.23 LEAK
for {
    select {
    case <-ch:
        // got a value; the time.After timer is still alive in the runtime
    case <-time.After(time.Hour):
        return errors.New("hour passed without any value")
    }
}
```

The fix on older Go: hoist the timer outside the loop, `Stop` and
`Reset` it explicitly:

```go
t := time.NewTimer(time.Hour)
defer t.Stop()
for {
    if !t.Stop() {
        select {
        case <-t.C:
        default:
        }
    }
    t.Reset(time.Hour)
    select {
    case <-ch:
    case <-t.C:
        return errors.New("hour passed without any value")
    }
}
```

Go 1.23 made `time.After` safe in this pattern: unreferenced timers
become garbage. If your code targets Go 1.23+ exclusively, the simple
`time.After` form is fine. If you might run on older versions, the
hoisted-timer form is the safe choice.

## 8. `Ticker.Stop` semantics — what's still in the channel

`Ticker.Stop()` does two things:

1. Stops future ticks from being sent on the channel.
2. **Does not close the channel.**

If a tick was already in the channel buffer (length 1) when you
stopped, it's still there. Code that tries to do "drain after stop"
should look like:

```go
t := time.NewTicker(time.Second)
// ... some loop ...
t.Stop()
select {
case <-t.C:
default:
}
```

Because the channel is never closed, `for range t.C` after `Stop` does
not exit on its own — it just blocks forever. Always exit the loop
through some other condition (a `done` channel, `ctx.Done()`).

## 9. `time.AfterFunc` vs `time.NewTimer`

| Aspect | `NewTimer(d)` | `AfterFunc(d, f)` |
|--------|---------------|-------------------|
| Result | `*Timer`, you read from `.C` | `*Timer`, no channel; `f` runs in its own goroutine |
| When the goroutine starts | Whenever you read `<-t.C` | When the timer fires |
| Cost when not fired | A pending timer + an unread channel | Just a pending timer |
| Cancel | `t.Stop()` + drain | `t.Stop()` |
| Right for | `select` with multiple cases | Fire-and-forget callbacks |

`AfterFunc` is cheaper when you don't need to multiplex against other
events. Concretely: if all you want is "in 5 seconds, do X," `AfterFunc`
saves a goroutine that would otherwise sit blocked on `<-t.C`.

```go
// Cancellable cleanup after 5 seconds of inactivity.
cleanup := time.AfterFunc(5*time.Second, func() {
    closeIdleConnection()
})
// later, when activity arrives:
cleanup.Reset(5 * time.Second)
```

If `Reset` is called while the timer is pending, it reschedules the
firing time. If the timer has already fired, calling `Reset` again
schedules a new firing.

`AfterFunc` callbacks run in a fresh goroutine. **The runtime does not
serialize them.** If you `AfterFunc` the same function from many timers
at once and they all fire near the same time, they all run
concurrently. Lock or queue accordingly.

## 10. `context.WithTimeout` and `WithDeadline`

The right way to bound work in a request path:

```go
func handle(ctx context.Context) error {
    ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
    defer cancel()
    return upstream(ctx)
}
```

`WithTimeout(parent, d)` is `WithDeadline(parent, time.Now().Add(d))`.
Either way, the returned context's `Done()` channel closes after the
deadline, and `Err()` returns `context.DeadlineExceeded`.

Three rules:

1. **Always defer the `cancel`.** Even if the timeout fires, `cancel`
   is what releases the timer associated with the context. Forgetting
   it is a leak (until the deadline elapses).
2. **Pass `ctx` through.** Functions that take a `context.Context`
   should pass it to every blocking call inside them: HTTP requests,
   DB queries, channel reads. The deadline propagates automatically.
3. **Distinguish `DeadlineExceeded` from `Canceled`.** Both close the
   `Done` channel. `Err()` tells them apart. For metrics and retry
   logic, treat them differently — a timeout means "the upstream was
   slow," cancellation means "the user went away."

```go
if err := upstream(ctx); err != nil {
    if errors.Is(err, context.DeadlineExceeded) {
        // metric: timeout
    } else if errors.Is(err, context.Canceled) {
        // metric: client gone
    }
    return err
}
```

For deadlines computed from absolute times (not "duration from now"):

```go
deadline := time.Now().Add(remainingBudget)
ctx, cancel := context.WithDeadline(ctx, deadline)
defer cancel()
```

## 11. `time.Sleep` is not for production

`time.Sleep` blocks the current goroutine and is not cancelable.
A goroutine in `time.Sleep(time.Hour)` ignores `ctx.Done()`,
ignores `Stop()` calls from outside, ignores everything until the
duration elapses.

The fix in any function that takes a `context`: replace
`time.Sleep(d)` with a select on `time.After(d)` and `ctx.Done()`:

```go
func sleepCtx(ctx context.Context, d time.Duration) error {
    select {
    case <-ctx.Done():
        return ctx.Err()
    case <-time.After(d):
        return nil
    }
}
```

(Or use `time.NewTimer` for the older-Go-version safety we discussed.)

For backoff loops, the same pattern:

```go
backoff := 100 * time.Millisecond
for attempt := 0; attempt < maxAttempts; attempt++ {
    err := try()
    if err == nil {
        return nil
    }
    select {
    case <-ctx.Done():
        return ctx.Err()
    case <-time.After(backoff):
    }
    backoff *= 2
}
```

We come back to backoff with jitter in [professional.md](professional.md).

## 12. DST and the calendar-day hazard

Adding `24 * time.Hour` is *not* the same as "tomorrow." On the
spring-forward DST day, a calendar day is 23 hours; on the fall-back
day, 25.

```go
loc, _ := time.LoadLocation("America/New_York")
t := time.Date(2026, 3, 8, 1, 0, 0, 0, loc) // before spring-forward
fmt.Println(t.Add(24 * time.Hour).Format(time.DateTime))
// 2026-03-09 02:00:00 (skipped 02:00 because of DST)

fmt.Println(t.AddDate(0, 0, 1).Format(time.DateTime))
// 2026-03-09 01:00:00 (calendar day, same wall hour)
```

Rule:

- For **elapsed time** ("24 hours from now"), use `Add(24 * time.Hour)`.
- For **calendar arithmetic** ("tomorrow at this hour"), use
  `AddDate(0, 0, 1)`.

The same applies to months and years. `Add(30 * 24 * time.Hour)` is
not "next month." Use `AddDate(0, 1, 0)`.

### "Time that doesn't exist"

In a spring-forward DST transition, the local clock skips an hour.
`time.Date(2026, 3, 8, 2, 30, 0, 0, NY)` produces a time that didn't
happen on the wall clock — Go normalizes it to the next valid instant
(2026-03-08 03:30:00 in EDT). If you're parsing user input and need
to flag impossible times, you have to compare your input against the
zone's transition table; the standard library doesn't expose
"is this time valid in this zone."

In a fall-back DST transition, the same wall-clock time exists twice.
`time.Date` resolves the ambiguity to the *first* occurrence (the
pre-transition one). If you need the second occurrence, you have to
construct it from the offset directly.

## 13. Custom layouts in practice

The reference time digits are easy to misremember. A few patterns
that come up often:

```go
// ISO-like, no nanos, with timezone offset
"2006-01-02T15:04:05-07:00"

// Apache common log format
"02/Jan/2006:15:04:05 -0700"

// PostgreSQL TIMESTAMPTZ default
"2006-01-02 15:04:05.999999-07"

// File-safe sortable timestamp
"20060102T150405Z"
```

The trickiest field is the timezone:

| Layout | Behavior on UTC | Behavior on +05:00 |
|--------|----------------|--------------------|
| `MST`  | "UTC"          | Zone abbreviation if known, else `+0500` |
| `-0700`| `+0000`        | `+0500` |
| `-07:00`| `+00:00`      | `+05:00` |
| `Z0700`| `Z`            | `+0500` |
| `Z07:00`| `Z`           | `+05:00` |

For RFC3339 you want `Z07:00` (UTC becomes `Z`, others get
`±HH:MM`). For Apache/HTTP-style logs, you want `-0700`.

`time.RFC3339` is exactly:

```
"2006-01-02T15:04:05Z07:00"
```

Note the `Z07:00` form — that's the magic that prints `Z` for UTC.

## 14. Working with durations from strings: `ParseDuration`

`time.ParseDuration("1h30m")` returns a `Duration`:

```go
d, err := time.ParseDuration("1h30m45.5s")
fmt.Println(d) // 1h30m45.5s
```

Accepts: `ns`, `us`, `µs`, `ms`, `s`, `m`, `h`. No `d` (day) — see the
DST discussion. No years. The string can mix units and have a fractional
component.

`Duration.String()` is the inverse, returning a canonical form:

```go
fmt.Println((90 * time.Minute).String()) // 1h30m0s
```

Useful for config files, CLI flags, environment variables. `flag.Duration`
uses `ParseDuration`, so:

```go
timeout := flag.Duration("timeout", 5*time.Second, "request timeout")
flag.Parse()
// users can pass -timeout=2m or -timeout=500ms
```

## 15. `time.Tick` — the trap

`time.Tick(d)` returns a `<-chan Time` that fires every `d`, like a
ticker — but **you can never stop it**. The underlying ticker leaks
forever.

```go
// LEAK if 'd' is large
for now := range time.Tick(time.Hour) {
    fmt.Println(now)
}
```

Use `time.NewTicker(d)` and call `Stop()`. `time.Tick` is acceptable
only when the channel is intended to live for the entire process —
practically, never. Treat it as a footgun.

## 16. Duration formatting for humans

`Duration.String()` produces compact output, but it's not always what
you want:

```go
fmt.Println((3 * time.Hour).String())               // 3h0m0s
fmt.Println((90*time.Minute + 500*time.Millisecond).String()) // 1h30m0.5s
```

For "human" formatting, write a helper:

```go
func human(d time.Duration) string {
    d = d.Round(time.Second)
    h := d / time.Hour
    d -= h * time.Hour
    m := d / time.Minute
    d -= m * time.Minute
    s := d / time.Second
    return fmt.Sprintf("%02d:%02d:%02d", h, m, s)
}
```

Round once at the start so the math stays exact.

## 17. `time.Time.Format` allocations

`Format` allocates a new string per call. In hot paths, use
`AppendFormat`:

```go
buf := make([]byte, 0, 64)
buf = t.AppendFormat(buf, time.RFC3339)
// buf is now the formatted bytes; reuse buf across calls
```

This matters for log lines and tight loops. We return to it in
[optimize.md](optimize.md).

## 18. Testing time-dependent code

Hard-coded `time.Now()` in business logic is the single biggest
obstacle to testing. The fix is dependency injection: pass a `func()
time.Time` (or a small `Clock` interface) into anything that needs the
current time.

```go
type Clock interface {
    Now() time.Time
}

type RealClock struct{}
func (RealClock) Now() time.Time { return time.Now() }

type FakeClock struct{ t time.Time }
func (f *FakeClock) Now() time.Time     { return f.t }
func (f *FakeClock) Advance(d time.Duration) { f.t = f.t.Add(d) }
```

Now production uses `RealClock{}` and tests use `FakeClock{...}` and
control time exactly. This pattern is so common that several libraries
implement it (`benbjohnson/clock`, `jonboulle/clockwork`); for a small
project, the four-line interface above is fine.

For more advanced fakes that interact with `Timer`/`Ticker`, see
[professional.md](professional.md) and [tasks.md](tasks.md).

## 19. A debounce, end-to-end

A debounce delays an action until activity has stopped for a quiet
interval. Built from `AfterFunc`:

```go
type debounce struct {
    mu    sync.Mutex
    timer *time.Timer
    quiet time.Duration
    f     func()
}

func newDebounce(quiet time.Duration, f func()) *debounce {
    return &debounce{quiet: quiet, f: f}
}

func (d *debounce) Trigger() {
    d.mu.Lock()
    defer d.mu.Unlock()
    if d.timer != nil {
        d.timer.Stop()
    }
    d.timer = time.AfterFunc(d.quiet, d.f)
}
```

Every call to `Trigger` resets the clock. `f` runs once, `quiet` after
the *last* trigger. Simple, allocation-light, no goroutine sitting
idle.

## 20. A single-shot rate limiter using `Time`

```go
type limiter struct {
    mu   sync.Mutex
    next time.Time
    gap  time.Duration
}

func newLimiter(rps int) *limiter {
    return &limiter{gap: time.Second / time.Duration(rps)}
}

func (l *limiter) Allow() bool {
    l.mu.Lock()
    defer l.mu.Unlock()
    now := time.Now()
    if now.Before(l.next) {
        return false
    }
    l.next = now.Add(l.gap)
    return true
}
```

Each `Allow` call returns `true` at most once per `gap`. For a real
production rate limiter, use `golang.org/x/time/rate` (token bucket,
burst support, `WaitN`); the snippet above shows the time-arithmetic
core in plain stdlib.

## 21. Cross-references for what's next

- [senior.md](senior.md) — internals: how the runtime stores wall +
  monotonic, how `timerproc` works, the `time/tzdata` shape, the
  ignored leap-second story.
- [professional.md](professional.md) — backoff with jitter, key
  rotation, distributed clock skew, fake clocks at scale.
- [find-bug.md](find-bug.md) — drills targeting the bugs in this file.
- [optimize.md](optimize.md) — `AppendFormat`, timer pooling, drift
  correction.
