# 8.3 `time` — Find the Bug

Thirteen buggy snippets. For each, identify the bug, explain what
happens at runtime, and write the fix. Read the snippet first; resist
scrolling to the analysis.

## Bug 1 — `==` on a time after JSON round-trip

```go
type Event struct {
    At time.Time `json:"at"`
}

func same(a, b Event) bool {
    return a.At == b.At
}

func main() {
    a := Event{At: time.Now()}
    blob, _ := json.Marshal(a)
    var b Event
    json.Unmarshal(blob, &b)
    fmt.Println(same(a, b)) // false
}
```

### Analysis

`time.Now()` returns a `Time` with a monotonic-clock reading. JSON
serialization writes only the wall clock. Unmarshaling produces a
`Time` *without* a monotonic reading. The two values represent the
same wall instant but their `wall` and `ext` struct fields differ in
encoding, so `==` returns false.

### Fix

Use `Equal`:

```go
func same(a, b Event) bool {
    return a.At.Equal(b.At)
}
```

If you need `==` to work (e.g., as a map key), strip monotonic on
construction:

```go
a := Event{At: time.Now().Round(0)}
```

## Bug 2 — Leaked Ticker

```go
func emit(events <-chan event) {
    t := time.NewTicker(time.Second)
    for {
        select {
        case e := <-events:
            handle(e)
        case <-t.C:
            heartbeat()
        }
    }
}
```

### Analysis

No `defer t.Stop()`, no exit condition. Even after `events` is closed
(if it ever is), the loop blocks forever. The ticker is leaked: the
runtime keeps it in the timer heap, firing into a channel that may
eventually have no consumer. In a service that creates these
goroutines repeatedly, memory grows without bound.

### Fix

Take a `context.Context`, defer the stop, exit on `ctx.Done`:

```go
func emit(ctx context.Context, events <-chan event) {
    t := time.NewTicker(time.Second)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case e := <-events:
            handle(e)
        case <-t.C:
            heartbeat()
        }
    }
}
```

## Bug 3 — Timer.Stop without drain, then Reset

```go
t := time.NewTimer(d)
for {
    select {
    case <-t.C:
        do()
        t.Reset(d) // sometimes fires twice in a row
    case <-stop:
        if !t.Stop() {}
        return
    }
}
```

In a different version (pre-Go 1.23):

```go
func resetTimer(t *time.Timer, d time.Duration) {
    if !t.Stop() {
        // FORGOT TO DRAIN
    }
    t.Reset(d)
}
```

### Analysis

Pre-Go 1.23, `Stop` returns `false` if the timer already fired. The
fired value sits in `t.C` until consumed. Calling `Reset` doesn't
clear it. The next `<-t.C` returns the stale value immediately,
causing the work to fire twice in quick succession.

### Fix (pre-1.23)

```go
func resetTimer(t *time.Timer, d time.Duration) {
    if !t.Stop() {
        select {
        case <-t.C:
        default:
        }
    }
    t.Reset(d)
}
```

### Fix (1.23+)

The runtime drains the channel for you. The simpler form works:

```go
func resetTimer(t *time.Timer, d time.Duration) {
    t.Stop()
    t.Reset(d)
}
```

## Bug 4 — `time.After` in a hot loop

```go
func waitOrDeadline(ch <-chan event, deadline time.Time) (event, error) {
    for {
        select {
        case e := <-ch:
            if e.useful() {
                return e, nil
            }
            // ignore and loop
        case <-time.After(time.Until(deadline)):
            return event{}, errors.New("deadline")
        }
    }
}
```

### Analysis

Pre-Go 1.23: every loop iteration that picks the first case allocates
a fresh `*Timer` via `time.After`, and the runtime keeps that timer
alive in the heap until it fires. With a 30-second deadline and a
fast event stream, this leaks a timer per useless event for up to 30
seconds at a time. Memory grows.

Post-Go 1.23: the runtime collects unreferenced timers, so the leak
is gone. But it's still wasteful if the loop is hot — every
`time.After` is a heap allocation.

### Fix (works on all versions)

Hoist the timer:

```go
func waitOrDeadline(ch <-chan event, deadline time.Time) (event, error) {
    t := time.NewTimer(time.Until(deadline))
    defer t.Stop()
    for {
        select {
        case e := <-ch:
            if e.useful() {
                return e, nil
            }
        case <-t.C:
            return event{}, errors.New("deadline")
        }
    }
}
```

The timer is created once and shared across iterations. Memory is
constant.

## Bug 5 — `Add(24 * time.Hour)` across DST

```go
func tomorrowAt(t time.Time, hour int) time.Time {
    next := t.Add(24 * time.Hour)
    return time.Date(next.Year(), next.Month(), next.Day(), hour, 0, 0, 0, next.Location())
}
```

### Analysis

On the spring-forward DST day, a local calendar day is 23 wall-clock
hours, not 24. `Add(24*time.Hour)` skips past the new local date in
some cases. The bug: `tomorrowAt(spring_forward_day, 9)` returns the
day *after* tomorrow.

### Fix

Use `AddDate`:

```go
func tomorrowAt(t time.Time, hour int) time.Time {
    next := t.AddDate(0, 0, 1)
    return time.Date(next.Year(), next.Month(), next.Day(), hour, 0, 0, 0, next.Location())
}
```

`AddDate` operates on calendar units in the time's location.

## Bug 6 — Parsing without setting Location

```go
loc, _ := time.LoadLocation("America/New_York")
// User input is "2026-05-06 14:30:00" intended in New York time.
t, _ := time.Parse("2006-01-02 15:04:05", "2026-05-06 14:30:00")
fmt.Println(t.In(loc))
```

### Analysis

`time.Parse` defaults to UTC for zone-less inputs. `t` is `2026-05-06
14:30:00 UTC`. Calling `In(loc)` then displays it as `10:30:00 EDT` —
4 hours earlier than intended.

The bug: the input was *meant* as New York local time, but the parser
treated it as UTC.

### Fix

Use `ParseInLocation`:

```go
t, err := time.ParseInLocation("2006-01-02 15:04:05", "2026-05-06 14:30:00", loc)
```

Now `t` is `2026-05-06 14:30:00 EDT`.

## Bug 7 — `time.Sleep` in a request handler

```go
func handle(w http.ResponseWriter, r *http.Request) {
    if requiresWait() {
        time.Sleep(30 * time.Second)
    }
    w.WriteHeader(200)
}
```

### Analysis

If the client disconnects during the sleep, the handler keeps
running. `time.Sleep` ignores `r.Context()`. The goroutine sits idle
for 30 seconds doing nothing useful, holding a connection slot.
Under load, this exhausts goroutines and chokes the server.

### Fix

Use a select on `r.Context().Done()`:

```go
func handle(w http.ResponseWriter, r *http.Request) {
    if requiresWait() {
        select {
        case <-r.Context().Done():
            return // client gone; exit
        case <-time.After(30 * time.Second):
        }
    }
    w.WriteHeader(200)
}
```

## Bug 8 — Comparing `time.Now()` between two machines

```go
// Service A:
sentAt := time.Now()
sendToB(payload, sentAt)

// Service B:
receivedAt := time.Now()
latency := receivedAt.Sub(sentAt) // could be negative
```

### Analysis

`sentAt` and `receivedAt` come from different machines whose clocks
are not synchronized to the nanosecond. NTP keeps them within tens of
ms in steady state, but skew of seconds is normal during clock
adjustments. The subtraction can produce negative latencies, anomalous
spikes, or — if the receiver's clock is behind — apparently
"backwards" timestamps.

The bug: trusting wall clocks across machines for ordering or
elapsed-time math.

### Fix

Compute round-trip latency from a single clock by sending a
correlation ID and matching response → request locally:

```go
// Service A:
start := time.Now()
result := sendToB(payload)
latency := time.Since(start)
```

Or accept that cross-machine latency is approximate, clamp negative
values to 0, and add slack to comparisons.

## Bug 9 — Wrong literal numbers in the format string

```go
t := time.Date(2026, 5, 6, 14, 30, 0, 0, time.UTC)
s := t.Format("2026-05-06 14:30:00") // "2026-05-06 14:30:00" always
```

### Analysis

The layout uses non-reference numbers. None of `2026`, `5`, `6`, `14`,
`30`, `00` are recognized as field placeholders. The formatter treats
them all as literal text, so the output is always the layout string
itself, regardless of `t`.

### Fix

Use the reference time:

```go
s := t.Format("2006-01-02 15:04:05")
// or
s := t.Format(time.DateTime)
```

## Bug 10 — Asymmetric format and parse layouts

```go
// Save:
s := t.Format("Jan 2, 2006 3:04 PM")
saveToDB(s)

// Load:
loaded, _ := time.Parse("January 2, 2006 3:04 PM", s) // never matches
```

### Analysis

The save layout uses `Jan` (month abbreviation); the load layout uses
`January` (full month name). The strings produced will be `"May 6,
2026 2:30 PM"` and the parser expects `"May 6, 2026 2:30 PM"` — wait,
that *would* match in this specific case (May happens to be the same
abbreviated and full). But for `Jan` vs `January` for January, you'd
get `"Jan 6, 2026"` and the parser expecting `"January 6, 2026"`
fails.

### Fix

Use the same layout for save and load. Better, define a constant:

```go
const dbDateLayout = "2006-01-02 15:04:05" // unambiguous, sortable

s := t.Format(dbDateLayout)
loaded, _ := time.Parse(dbDateLayout, s)
```

For database storage, prefer ISO-like layouts or Unix integers — never
locale-dependent month names.

## Bug 11 — Ignoring monotonic for elapsed measurement

```go
type Job struct {
    StartedAt time.Time
}

func (j *Job) Elapsed() time.Duration {
    return time.Now().Sub(j.StartedAt)
}

// Job is loaded from JSON storage:
job := loadJobFromDisk()
fmt.Println(job.Elapsed())
```

### Analysis

When `Job` is JSON-encoded and decoded, `StartedAt` loses its
monotonic clock reading. `time.Now().Sub(j.StartedAt)` then falls back
to wall-clock subtraction. If the wall clock has jumped (NTP step,
manual change), the result can be wildly wrong — even negative.

### Fix

For elapsed-time measurements within a single process, never persist
the start time. Compute the elapsed once and persist that:

```go
type Job struct {
    StartedAt time.Time     // for display
    Elapsed   time.Duration // for math
}
```

Capture `Elapsed` from a `time.Since(startedAt)` while `startedAt`
still has its monotonic reading.

## Bug 12 — `for range t.C` after `Stop`

```go
t := time.NewTicker(time.Second)
go func() {
    for tick := range t.C {
        fmt.Println(tick)
    }
}()
time.Sleep(5 * time.Second)
t.Stop()
// goroutine leaks
```

### Analysis

`Ticker.Stop` does not close the channel. `for range t.C` blocks
forever waiting for the next send. The goroutine is stuck. In a
long-running service that creates and stops many tickers, this is a
goroutine leak.

### Fix

Use a separate `done` channel and `select`:

```go
done := make(chan struct{})
t := time.NewTicker(time.Second)
go func() {
    defer t.Stop()
    for {
        select {
        case <-done:
            return
        case tick := <-t.C:
            fmt.Println(tick)
        }
    }
}()
time.Sleep(5 * time.Second)
close(done)
```

Or use a `context.Context`.

## Bug 13 — Negative duration from `1 << attempt` overflow

```go
func backoff(attempt int) time.Duration {
    return 100 * time.Millisecond * (1 << attempt)
}
```

### Analysis

For `attempt = 60`, `1 << 60` is positive but multiplying by `100ms`
overflows the `int64`. For `attempt = 63`, `1 << 63` is `MinInt64`,
making the whole expression negative. Calling `time.Sleep` with a
negative duration returns immediately, defeating the backoff.

The bug: unbounded shift in a retry loop that might run many
iterations.

### Fix

Cap the shift:

```go
func backoff(attempt int, base, cap time.Duration) time.Duration {
    if attempt > 30 {
        attempt = 30
    }
    d := base * time.Duration(1<<attempt)
    if d > cap || d < 0 {
        d = cap
    }
    return d
}
```

The cap also gives you a sane maximum wait, instead of "exponential
forever."

## What to read next

- [tasks.md](tasks.md) — write correct versions of these patterns from
  scratch.
- [optimize.md](optimize.md) — squeeze allocations and CPU out of
  correct time code.
- [interview.md](interview.md) — concept questions for each bug
  category.
