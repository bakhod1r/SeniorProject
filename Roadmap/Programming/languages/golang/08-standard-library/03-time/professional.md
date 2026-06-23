# 8.3 `time` — Professional

> **Audience.** You're shipping services where time correctness is part
> of the SLA: deadlines that propagate across calls, retries that don't
> stampede, scheduled jobs that survive restarts, tokens that expire at
> the right moment, and tests that don't sleep. This file is the set of
> patterns you reach for when "it works on my machine at 2pm" isn't
> enough.

## 1. Timeout budgets

A request enters your system with a budget. Each downstream call should
consume part of that budget, never the whole thing. If you set a fresh
2-second timeout on every hop, your 5-hop chain has a 10-second
worst-case latency the entry point doesn't know about.

```go
func handle(ctx context.Context, req Request) (Response, error) {
    // Use the deadline already on ctx if present, else 2s.
    if _, ok := ctx.Deadline(); !ok {
        var cancel context.CancelFunc
        ctx, cancel = context.WithTimeout(ctx, 2*time.Second)
        defer cancel()
    }
    return doWork(ctx, req)
}
```

The pattern: **propagate the deadline from the inbound `ctx`**. Add a
local timeout only if the caller didn't impose one. Inside, give each
downstream a budget computed from `time.Until(deadline)` rather than a
fixed duration:

```go
func doWork(ctx context.Context, req Request) (Response, error) {
    deadline, _ := ctx.Deadline()
    remaining := time.Until(deadline)
    perHopBudget := remaining / 3 // we have three hops left

    aCtx, aCancel := context.WithTimeout(ctx, perHopBudget)
    defer aCancel()
    a, err := callA(aCtx)
    if err != nil {
        return Response{}, err
    }
    // ... calls B, C similarly
}
```

This way, slow upstream calls don't starve downstream ones, and the
total budget is honored.

## 2. Deadline propagation across services

When you make an outbound HTTP/gRPC call, the deadline on `ctx` should
travel with the request. gRPC does this automatically via the
`grpc-timeout` header. For HTTP, you have to do it yourself if your
upstream cares:

```go
req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
if dl, ok := ctx.Deadline(); ok {
    remaining := time.Until(dl)
    req.Header.Set("X-Deadline-Ms", strconv.FormatInt(remaining.Milliseconds(), 10))
}
resp, err := http.DefaultClient.Do(req)
```

The receiver can then construct its own context with the matching
deadline:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    if hdr := r.Header.Get("X-Deadline-Ms"); hdr != "" {
        if ms, err := strconv.ParseInt(hdr, 10, 64); err == nil {
            var cancel context.CancelFunc
            ctx, cancel = context.WithTimeout(ctx, time.Duration(ms)*time.Millisecond)
            defer cancel()
        }
    }
    // serve with ctx
}
```

Why milliseconds, not absolute timestamps: clock skew. If the upstream
sent `1746540045123` (a Unix milli) and your local clock is 200 ms
behind, the deadline is computed wrong. A relative duration is
clock-independent.

## 3. Exponential backoff with jitter

A retry loop without jitter creates *thundering herds*: every client
that hit the same outage retries at exactly the same moment, hammering
the recovering service in lockstep. The fix is randomized backoff —
"full jitter" is the canonical recipe:

```go
// sleep = random in [0, base * 2^attempt), capped.
func backoff(attempt int, base, cap time.Duration) time.Duration {
    exp := time.Duration(1) << attempt
    d := base * exp
    if d > cap || d < 0 {
        d = cap
    }
    // full jitter
    return time.Duration(rand.Int63n(int64(d)))
}

func retry(ctx context.Context, op func() error) error {
    var err error
    for attempt := 0; attempt < 6; attempt++ {
        err = op()
        if err == nil {
            return nil
        }
        if !isRetryable(err) {
            return err
        }
        wait := backoff(attempt, 100*time.Millisecond, 10*time.Second)
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-time.After(wait):
        }
    }
    return err
}
```

Three things:

- **Cap the maximum wait.** Otherwise `attempt = 30` waits longer than
  the universe is old. The cap is also where you protect against
  integer overflow of `1 << attempt`.
- **Always select against `ctx.Done()`.** If the context is cancelled
  during a backoff, return immediately. Otherwise the retry loop
  outlives the request.
- **Use `crypto/rand` or a properly-seeded `math/rand/v2` source.** The
  default `math/rand.Int63n` (pre-Go 1.22) used a global
  non-cryptographic generator with a deterministic seed, which is fine
  for jitter but worth knowing if you migrate code.

For "decorrelated jitter" (smoother distribution across many retries),
swap the formula: `wait = random in [base, prev*3)`. The AWS
Architecture Blog has the canonical write-up.

## 4. Observable retries

Production retries should emit metrics — at minimum, "attempt count"
and "outcome." Otherwise you'll find out about a retry storm the hard
way, when your downstream gets paged.

```go
func retryObserved(ctx context.Context, op func() error, observe func(attempt int, err error)) error {
    for attempt := 0; ; attempt++ {
        err := op()
        observe(attempt, err)
        if err == nil {
            return nil
        }
        if !isRetryable(err) || attempt >= 5 {
            return err
        }
        wait := backoff(attempt, 100*time.Millisecond, 10*time.Second)
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-time.After(wait):
        }
    }
}

// in production:
retryObserved(ctx, op, func(a int, err error) {
    metrics.Counter("upstream_retries", "attempt", strconv.Itoa(a), "outcome", outcomeOf(err)).Inc()
})
```

The `observe` callback also gives you a place to log "we retried 4
times before succeeding" — a slow signal that something upstream is
fragile.

## 5. Scheduled jobs with `NewTicker` + `ctx`

The "scheduled job inside a service" pattern, fleshed out:

```go
func runJob(ctx context.Context, period time.Duration, work func(context.Context) error, logger *slog.Logger) error {
    ticker := time.NewTicker(period)
    defer ticker.Stop()

    // run once immediately, before waiting a full period
    if err := work(ctx); err != nil {
        logger.Error("job failed", "err", err)
    }

    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-ticker.C:
            jobCtx, cancel := context.WithTimeout(ctx, period)
            err := work(jobCtx)
            cancel()
            if err != nil {
                logger.Error("job failed", "err", err)
            }
        }
    }
}
```

Notes:

- **Run once on startup**, then enter the tick loop. Otherwise the
  first execution is one full period after start, which is rarely what
  operators expect.
- **Each invocation gets its own bounded context.** A job that runs
  longer than `period` would otherwise overlap with the next tick.
  The bounded context kills it instead.
- **Errors are logged, not returned.** A scheduled job is a long-lived
  loop; one failure shouldn't kill it. Page on a metric, not on a
  function return.

If the job *must* not overlap (e.g., it acquires a lock or modifies
state), the bounded context plus the rule that the next tick fires at
its own schedule means a slow job's leftover work is dropped. That's
usually correct; if not, queue work into a buffered channel and have a
single worker drain it.

## 6. Aligned scheduling: "at the top of every hour"

`Ticker` fires every period from start. For absolute alignment ("at
:00 every hour"), compute the next aligned target each iteration:

```go
func runHourly(ctx context.Context, work func(context.Context) error) error {
    for {
        next := time.Now().Truncate(time.Hour).Add(time.Hour)
        sleep := time.Until(next)
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-time.After(sleep):
        }
        wctx, cancel := context.WithTimeout(ctx, time.Hour)
        if err := work(wctx); err != nil {
            slog.Error("hourly job failed", "err", err)
        }
        cancel()
    }
}
```

`Truncate(time.Hour)` rounds down to the start of the current UTC
hour. `.Add(time.Hour)` is the next one. `time.Until` gives the sleep
duration. No drift.

For local-time alignment ("9 AM every day in `loc`"), don't use
`Truncate` — it works in UTC. Construct explicitly:

```go
func nextDailyAt(now time.Time, hour, min int, loc *time.Location) time.Time {
    n := now.In(loc)
    next := time.Date(n.Year(), n.Month(), n.Day(), hour, min, 0, 0, loc)
    if !next.After(n) {
        next = next.AddDate(0, 0, 1)
    }
    return next
}
```

This handles DST correctly because `time.Date` lets the location
resolve the wall instant.

## 7. Time-based key rotation

API keys, encryption keys, JWT signing keys all need rotation. The
standard pattern keeps two keys live: the *current* one (for new
issuance) and the *previous* one (still accepted on inbound), with a
background ticker that promotes new → current → previous → expired.

```go
type KeySet struct {
    mu       sync.RWMutex
    current  Key
    previous Key
    period   time.Duration
}

func (k *KeySet) Current() Key {
    k.mu.RLock()
    defer k.mu.RUnlock()
    return k.current
}

func (k *KeySet) Verify(token string) error {
    k.mu.RLock()
    cur, prev := k.current, k.previous
    k.mu.RUnlock()
    if err := verifyWith(cur, token); err == nil {
        return nil
    }
    return verifyWith(prev, token)
}

func (k *KeySet) Run(ctx context.Context) error {
    t := time.NewTicker(k.period)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-t.C:
            newKey, err := generateKey()
            if err != nil {
                slog.Error("key generation failed", "err", err)
                continue
            }
            k.mu.Lock()
            k.previous = k.current
            k.current = newKey
            k.mu.Unlock()
        }
    }
}
```

The grace window for the previous key is `period`. For longer overlap,
keep three or more historical keys. The pattern generalizes to JWKS
rotation, internal HMAC keys, and database encryption keys.

## 8. Token expiry and replay windows

A signed token with `exp` (expiry) and `nbf` (not before) claims is
the simplest defense against replay. The verification:

```go
type Claims struct {
    NotBefore int64 `json:"nbf"`
    Expiry    int64 `json:"exp"`
    JTI       string `json:"jti"`
}

func verifyClaims(c Claims, now time.Time, skew time.Duration) error {
    nowU := now.Unix()
    if c.NotBefore != 0 && nowU+int64(skew.Seconds()) < c.NotBefore {
        return errors.New("token not yet valid")
    }
    if c.Expiry != 0 && nowU-int64(skew.Seconds()) > c.Expiry {
        return errors.New("token expired")
    }
    return nil
}
```

The `skew` parameter (typically 30s–5min) accounts for clock drift
between the issuer and the verifier. Without it, two servers slightly
out of sync will reject each other's freshly-issued tokens. With it,
you accept tokens that are technically expired by less than `skew`.

For replay protection, also persist `jti` for the lifetime of the
token (via Redis with `EXPIREAT`). The cost is low (one set membership
check per request) and the protection is meaningful.

## 9. Freezing time in tests

Tests that depend on `time.Now()` are flaky tests waiting to happen.
The fix is to inject the clock:

```go
type Clock interface {
    Now() time.Time
    NewTimer(d time.Duration) Timer
    NewTicker(d time.Duration) Ticker
    Sleep(d time.Duration)
}

type Timer interface {
    C() <-chan time.Time
    Stop() bool
    Reset(d time.Duration) bool
}

type Ticker interface {
    C() <-chan time.Time
    Stop()
}
```

Production uses a `RealClock` that wraps the `time` package. Tests use
a `FakeClock` that maintains an internal "now" you can advance:

```go
type FakeClock struct {
    mu      sync.Mutex
    now     time.Time
    timers  []*fakeTimer
}

func (f *FakeClock) Now() time.Time {
    f.mu.Lock()
    defer f.mu.Unlock()
    return f.now
}

func (f *FakeClock) Advance(d time.Duration) {
    f.mu.Lock()
    f.now = f.now.Add(d)
    target := f.now
    var due []*fakeTimer
    remaining := f.timers[:0]
    for _, t := range f.timers {
        if !t.when.After(target) {
            due = append(due, t)
        } else {
            remaining = append(remaining, t)
        }
    }
    f.timers = remaining
    f.mu.Unlock()

    for _, t := range due {
        t.fire()
    }
}
```

A test can now write:

```go
func TestExpiry(t *testing.T) {
    clk := NewFakeClock(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
    cache := NewCache(clk, 5*time.Minute)
    cache.Set("k", "v")
    clk.Advance(4 * time.Minute)
    if _, ok := cache.Get("k"); !ok {
        t.Fatal("should still be present")
    }
    clk.Advance(2 * time.Minute)
    if _, ok := cache.Get("k"); ok {
        t.Fatal("should have expired")
    }
}
```

No `time.Sleep`, deterministic, fast. Existing libraries that
implement this well: `github.com/benbjohnson/clock`,
`github.com/jonboulle/clockwork`. For small projects, the snippet
above is enough.

## 10. Distributed time and clock skew

In a single-machine test, `time.Now()` is canonical. In a distributed
system, **every node has its own clock** and they drift relative to
each other. NTP keeps them within tens of milliseconds in steady
state, but:

- Cloud VMs can drift seconds during pauses (live migration, hypervisor
  scheduling).
- Containers can inherit the host clock or have their own (depending
  on the runtime); some configurations expose flaws in the clock
  source.
- Cross-region differences add latency that swamps clock-precision
  effort.

Concrete rules:

- **Never use wall clock for ordering.** If you need "this happened
  before that" across machines, use a logical clock (vector clocks,
  Lamport timestamps) or have one machine assign all sequence numbers
  (a master, or a Snowflake-style ID generator).
- **Use server-issued timestamps for "when did this happen."** Don't
  trust client-supplied wall times.
- **Add slack to time-based comparisons.** A token with `exp` should
  be valid for `skew` seconds after `exp` to account for clock drift
  between issuer and verifier.
- **Use monotonic clocks for "elapsed since."** Wall clock can jump,
  monotonic doesn't.

For logs: include `time.Now().UTC().Format(time.RFC3339Nano)` rather
than local time. Cross-machine log alignment is impossible if every
machine logs in its own zone.

## 11. The `time.Now()` dependency-injection trap

It's tempting to make `time.Now()` injectable as a function variable:

```go
var Now = time.Now // tests can swap

// production code:
t := Now()
```

This works for trivial cases but doesn't extend to `Sleep`, `After`,
`Ticker`, etc. — and it makes `Now` a global, which races if tests run
in parallel.

The `Clock` interface from §9 is more verbose but composes cleanly:
each thing that needs time receives a `Clock` and tests inject a fake.
Resist the urge to take the shortcut.

## 12. Per-call timeouts vs per-stage timeouts

Long-lived operations (a streaming download, a long DB query) need
different deadline semantics than short RPCs. For streams, the
right primitive is often a *per-stage* deadline that resets on
progress:

```go
func readWithIdleTimeout(ctx context.Context, r io.Reader, idle time.Duration) ([]byte, error) {
    var out []byte
    buf := make([]byte, 32*1024)

    for {
        readCtx, cancel := context.WithTimeout(ctx, idle)
        done := make(chan struct{})
        var n int
        var err error
        go func() {
            n, err = r.Read(buf)
            close(done)
        }()
        select {
        case <-readCtx.Done():
            cancel()
            return out, readCtx.Err()
        case <-done:
            cancel()
        }
        out = append(out, buf[:n]...)
        if err == io.EOF {
            return out, nil
        }
        if err != nil {
            return out, err
        }
    }
}
```

A bounded "if I haven't read in `idle` seconds, give up" deadline that
resets on every successful read. Useful for clients that want to
tolerate slow servers but not stuck ones.

## 13. The "deadline race" anti-pattern

```go
deadline := time.Now().Add(timeout)
// ... lots of work ...
if time.Now().After(deadline) {
    return errors.New("timed out")
}
```

The problem: between the deadline check and the next blocking call,
new work happens. By the time you check again, you've already done
work past the deadline. This is the difference between *checking* a
deadline (snapshots state) and *enforcing* it (interrupts blocking
calls).

Use `context.WithDeadline` and pass `ctx` to every blocking call. The
runtime's poller and the timer heap together enforce the deadline at
the syscall level.

## 14. Logging time correctly

A log line's timestamp should be:

- UTC (or include the offset explicitly).
- Sortable as a string (RFC3339 / RFC3339Nano).
- Generated as close to the event as possible (not when the line is
  flushed).

```go
slog.Default().LogAttrs(ctx, slog.LevelInfo, "request done",
    slog.Time("at", time.Now().UTC()),
    slog.Duration("dur", time.Since(start)),
)
```

`slog` records `time.Now()` at the call site. Format-on-output keeps
the actual timestamp accurate; format-at-call would do the same but
costs string allocation per line.

## 15. Time as part of security: replay windows

For request signing (HMAC-SHA256 over a payload + timestamp), include
the timestamp in the signed material and reject requests whose
timestamps differ from the receiver's clock by more than a window:

```go
func verify(req Request, secret []byte, window time.Duration) error {
    age := time.Since(req.Timestamp).Abs()
    if age > window {
        return errors.New("timestamp outside window")
    }
    expected := hmacSHA256(secret, req.Body, req.Timestamp.Format(time.RFC3339))
    if !hmac.Equal(expected, req.Signature) {
        return errors.New("bad signature")
    }
    return nil
}
```

The `window` is typically 5 minutes — small enough to limit replay,
large enough to tolerate clock skew. Pair with a replay cache (Redis,
nonces) for stronger protection.

`time.Since(req.Timestamp).Abs()` requires Go 1.19+; older code uses
`if d := time.Since(...); d < -window || d > window`.

## 16. What to read next

- [interview.md](interview.md) — questions probing exactly this layer.
- [tasks.md](tasks.md) — exercises for backoff, fake clocks, and
  scheduled jobs.
- [find-bug.md](find-bug.md) — buggy versions of these patterns.
