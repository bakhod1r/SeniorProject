# 8.3 `time` — Tasks

Twelve exercises with acceptance criteria. Each one is sized to fit in
a single file plus a `_test.go`. Resist the urge to reach for
`golang.org/x/time/rate` or `benbjohnson/clock` — these tasks build
the primitives those libraries are made of.

## Task 1 — Stopwatch

Implement a `Stopwatch` type with `Start`, `Stop`, `Reset`, `Elapsed`.
Multiple `Start`/`Stop` cycles accumulate. `Elapsed` returns total time
spent in the running state.

```go
type Stopwatch struct {
    // your fields
}

func (s *Stopwatch) Start()
func (s *Stopwatch) Stop()
func (s *Stopwatch) Reset()
func (s *Stopwatch) Elapsed() time.Duration
```

**Acceptance:**
- `Start` while running is a no-op.
- `Stop` while not running is a no-op.
- `Elapsed` is monotonic-clock-based (use `time.Since`, not wall math).
- A test that does `Start, Sleep(50ms), Stop, Sleep(100ms), Start,
  Sleep(50ms), Stop, Elapsed()` returns ~100ms ±10ms.

**Hint:** Store a "running since" `time.Time` and an accumulated
`time.Duration`. On `Stop`, add `time.Since(runningSince)` to the
accumulator.

## Task 2 — Cron-like scheduler with cancellation

Build a `Schedule` that runs `func(context.Context)` callbacks at
fixed intervals, supports adding and removing entries while running,
and shuts down cleanly on `ctx.Done()`.

```go
type Job func(context.Context)

type Schedule struct{ /* ... */ }

func New() *Schedule
func (s *Schedule) Every(d time.Duration, f Job) (id int)
func (s *Schedule) Cancel(id int)
func (s *Schedule) Run(ctx context.Context) error
```

**Acceptance:**
- Each job runs on its own ticker; jobs don't block each other.
- `Cancel(id)` stops a job; the goroutine exits.
- `Run` returns `ctx.Err()` once `ctx` is done; all jobs are
  stopped before return.
- A test verifies that a 100ms job runs ~10 times in 1s, and that
  cancelling it mid-run stops further runs within one tick.

**Hint:** Each `Every` spawns a goroutine that owns its `*time.Ticker`
and `defer t.Stop()`s. A `sync.WaitGroup` lets `Run` wait for all
job goroutines before returning.

## Task 3 — Timezone-aware date formatter for users

Given a `time.Time` (in UTC) and a user's `*time.Location`, return a
human-readable string in the user's zone, using:

- "today HH:MM" if the date is the user's current date.
- "yesterday HH:MM" if the date is one day before.
- "tomorrow HH:MM" if the date is one day after.
- "Mon, Jan 02" if within the same year.
- "Mon, Jan 02 2006" otherwise.

```go
func HumanTime(t time.Time, userLoc *time.Location, now time.Time) string
```

**Acceptance:**
- DST transitions don't break the "yesterday" check.
- A test in `Asia/Tashkent` and a test in `America/Los_Angeles`
  produce different strings for the same UTC instant when the local
  date differs.
- The `now` parameter is injectable for testability.

**Hint:** Convert `t` and `now` to `userLoc` first, then compare via
`time.Date(y, m, d, 0, 0, 0, 0, loc)` for each.

## Task 4 — Debounce wrapper

Implement a `Debounce(quiet time.Duration, f func())` that returns a
function `g`. Calling `g` schedules `f` to run after `quiet`; further
`g` calls reset the timer. After `quiet` of inactivity, `f` runs once.

```go
func Debounce(quiet time.Duration, f func()) (trigger func(), cancel func())
```

**Acceptance:**
- Five rapid `trigger` calls within `quiet` result in one `f` call.
- `cancel` prevents any pending `f` from running.
- Concurrent `trigger` calls are safe.
- The returned `trigger` does not block.

**Hint:** Use `time.AfterFunc`; on each `trigger`, `Stop` the existing
timer and create a new one (or use `Reset`).

## Task 5 — Rate limiter using time.Time

Token-bucket rate limiter from scratch:

```go
type Limiter struct{ /* ... */ }

func NewLimiter(rps float64, burst int) *Limiter
func (l *Limiter) Allow() bool
func (l *Limiter) Wait(ctx context.Context) error
```

Refill rate is `rps` tokens per second up to `burst`. `Allow` returns
true if a token is available, decrementing it. `Wait` blocks until a
token is available or `ctx` is done.

**Acceptance:**
- A test runs 100 `Allow` calls in a tight loop with `rps=10, burst=5`
  and verifies that ~6 returned true within the first 100ms (5 burst +
  ~1 refill).
- `Wait` does not busy-loop; it uses `time.NewTimer`.
- `ctx` cancellation returns `ctx.Err()` immediately.

**Hint:** Track `tokens float64` and `lastUpdate time.Time`. On each
call, add `(now - lastUpdate) * rps` tokens (capped at burst), then
either decrement by 1 (success) or compute the wait time to the next
token.

## Task 6 — Time-based one-shot cache

```go
type Cache struct{ /* ... */ }

func New(ttl time.Duration) *Cache
func (c *Cache) Set(key string, value any)
func (c *Cache) Get(key string) (any, bool)
```

After `ttl`, an entry is no longer returned by `Get`.

**Acceptance:**
- Lazy eviction: an entry past TTL is dropped on `Get` (and not
  served).
- Active eviction: the cache exposes `Stop()` that halts a background
  goroutine cleaning expired entries every `ttl/2`.
- Concurrent `Get`/`Set` is safe.
- A test using a `FakeClock` verifies expiry exactly at TTL.

**Hint:** Cache stores `(value, expiry time.Time)`. `Get` checks
`time.Now().After(expiry)`. Background loop iterates the map and
deletes expired entries.

## Task 7 — Exponential backoff with jitter

```go
type Backoff struct{ /* ... */ }

func NewBackoff(base, cap time.Duration) *Backoff
func (b *Backoff) Next() time.Duration
func (b *Backoff) Reset()
```

`Next` returns a randomized backoff: `[0, base * 2^attempt)`, capped
at `cap`. `Reset` returns to attempt 0.

**Acceptance:**
- `Next` for attempts 0..10 produces durations whose maxima follow
  the doubling schedule.
- After enough attempts, `Next` returns durations capped at `cap`.
- A test with a fixed seed produces deterministic output.

**Hint:** `1 << attempt` overflows around attempt 63 — cap the shift
before computing. Use `math/rand/v2` (Go 1.22+) for a cleaner API
than the deprecated `rand.Seed`.

## Task 8 — Fake clock for tests

Build a `FakeClock` with these operations:

```go
type FakeClock struct{ /* ... */ }
type FakeTimer struct{ /* ... */ }

func NewFakeClock(now time.Time) *FakeClock
func (f *FakeClock) Now() time.Time
func (f *FakeClock) NewTimer(d time.Duration) *FakeTimer
func (f *FakeClock) Sleep(d time.Duration)
func (f *FakeClock) Advance(d time.Duration)

func (t *FakeTimer) C() <-chan time.Time
func (t *FakeTimer) Stop() bool
func (t *FakeTimer) Reset(d time.Duration) bool
```

`Advance(d)` advances `now` by `d`, fires any timers whose deadline
has passed, and unblocks any `Sleep` calls.

**Acceptance:**
- A test creates two timers (50ms and 100ms apart), advances 75ms,
  and observes the first timer fired and the second did not.
- `Sleep(d)` blocks until `Advance` reaches the wake time.
- `Stop` and `Reset` work correctly.

**Hint:** Maintain a sorted (or heap) list of pending timers. On
`Advance`, walk the list and fire timers whose `when <= newNow`.

## Task 9 — Reminder service with persisted deadlines

Build a `Reminders` service that:

- Accepts `Add(at time.Time, payload string)` and persists to a JSON
  file.
- On startup, reloads the file and schedules pending reminders.
- Fires each reminder at its `at` time by writing `payload` to a
  user-supplied `chan string`.
- Tolerates restarts (a reminder due during downtime fires immediately
  after restart).

```go
type Reminders struct{ /* ... */ }

func Open(path string, out chan<- string) (*Reminders, error)
func (r *Reminders) Add(at time.Time, payload string) error
func (r *Reminders) Run(ctx context.Context) error
```

**Acceptance:**
- A test adds a reminder for 100ms in the future, runs the service for
  500ms, and verifies the channel received the payload.
- A test adds a reminder for 100ms in the past, opens a fresh service,
  and verifies the payload arrives within 100ms.

**Hint:** Use `time.Until(at)` to compute the wait. Reminder file is
just `[]Entry{}` JSON-encoded — re-write atomically (temp file +
rename) on each `Add`. Note: timestamps survive serialization but
lose monotonic readings, so on reload, recompute deadlines as
`time.Until(entry.At)`.

## Task 10 — Benchmark Timer vs AfterFunc memory

Write a benchmark that compares the memory cost of:

- 10,000 `time.NewTimer(time.Hour)` (each followed by `Stop`).
- 10,000 `time.AfterFunc(time.Hour, func(){})` (each followed by `Stop`).

```go
func BenchmarkTimerVsAfterFunc(b *testing.B) {
    // ...
}
```

**Acceptance:**
- The benchmark reports `B/op` and `allocs/op`.
- A short note in a `_test.go` comment summarizes which one allocates
  more, and why (`AfterFunc` has no channel; `NewTimer` allocates a
  buffered channel of length 1).
- Run with `go test -bench=. -benchmem`.

**Hint:** `runtime.MemStats` `HeapAlloc` and `HeapObjects` snapshots
before and after creating the timers, after `Stop`ping them, and
after a `runtime.GC()` call.

## Task 11 — Aligned hourly job

Build a job runner that runs `f` exactly at the top of every hour, in
a given location:

```go
func RunHourly(ctx context.Context, loc *time.Location, f func(context.Context) error) error
```

**Acceptance:**
- The first run is at the next aligned hour after `RunHourly` is
  called (e.g., if called at 14:23, first run is 15:00).
- DST transitions are handled — at fall-back, the 02:00 hour runs
  twice; at spring-forward, the 02:00 hour is skipped (no run, since
  it didn't exist).
- The function returns `ctx.Err()` when `ctx` is done.

**Hint:** Each iteration computes the next hour with `time.Date(y, M,
d, h+1, 0, 0, 0, loc)`. The DST behavior follows from
`time.Date`'s normalization.

## Task 12 — Detect NTP jumps

Write a function that runs in the background and detects when the wall
clock has jumped by more than 5 seconds relative to the monotonic
clock:

```go
func DetectClockJump(ctx context.Context, every time.Duration, threshold time.Duration, onJump func(prev, now time.Time, drift time.Duration)) error
```

Every `every`, sample both the wall and the monotonic clock. If the
ratio between elapsed-monotonic and elapsed-wall is off by more than
`threshold`, call `onJump`.

**Acceptance:**
- A test injects a "jumped" wall clock by mocking `time.Now` (via the
  `Clock` interface from earlier tasks) and verifies `onJump` is
  called with the correct drift.
- The function exits cleanly on `ctx.Done()`.

**Hint:** On each tick, take `time.Now()` and `time.Now().Round(0)`
of a stored "last sample". The difference between
`now.Sub(last)` (uses monotonic) and
`now.Round(0).Sub(last.Round(0))` (uses wall) is the NTP jump.

## What to read next

- [find-bug.md](find-bug.md) — buggy versions of these exercises.
- [optimize.md](optimize.md) — performance optimization for the cache,
  rate limiter, and reminder service.
- [interview.md](interview.md) — concept questions that map to each
  task.
