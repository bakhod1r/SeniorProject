# Adapter Pattern — Hands-on Tasks

## 1. How to use this file

Fifteen progressive tasks. Each has:

- **Problem statement** — the scenario.
- **Acceptance criteria** — checkboxes you should satisfy.
- **Hints** (collapsible) — reach for them if stuck.
- **Solution** (collapsible) — full compilable Go.
- **Discussion** — trade-offs you missed.

All code is written for Go 1.22+. Use `go run` to verify; the solutions assume a `package main` unless otherwise noted.

---

## Task 1 — Adapt a custom reader to `io.Reader`

You have:

```go
type StringStream struct{ data string; pos int }
func (s *StringStream) Next(n int) []byte {
    end := s.pos + n
    if end > len(s.data) { end = len(s.data) }
    chunk := []byte(s.data[s.pos:end])
    s.pos = end
    return chunk
}
```

Make `*StringStream` usable as an `io.Reader`.

**Acceptance criteria:**
- [ ] An adapter type whose method satisfies `io.Reader`.
- [ ] EOF is reported correctly when the stream is exhausted.
- [ ] The original `StringStream` is unchanged.

<details><summary>Hints</summary>

- `io.Reader.Read(p []byte) (n int, err error)` — read up to `len(p)` bytes, return `io.EOF` when exhausted.
- The adapter holds a `*StringStream`. Its `Read` method calls `Next` and copies into `p`.
</details>

<details><summary>Solution</summary>

```go
package main

import (
    "fmt"
    "io"
)

type StringStream struct{ data string; pos int }

func (s *StringStream) Next(n int) []byte {
    end := s.pos + n
    if end > len(s.data) { end = len(s.data) }
    chunk := []byte(s.data[s.pos:end])
    s.pos = end
    return chunk
}

type StreamReader struct{ S *StringStream }

func (r *StreamReader) Read(p []byte) (int, error) {
    chunk := r.S.Next(len(p))
    if len(chunk) == 0 {
        return 0, io.EOF
    }
    return copy(p, chunk), nil
}

var _ io.Reader = (*StreamReader)(nil)

func main() {
    s := &StringStream{data: "hello world"}
    r := &StreamReader{S: s}
    data, _ := io.ReadAll(r)
    fmt.Println(string(data))
}
```
</details>

**Discussion:** The adapter is 6 lines. Note the compile-time check `var _ io.Reader = ...` — it catches signature drift without runtime cost. `io.ReadAll` repeatedly calls `Read` until EOF.

---

## Task 2 — Build a `ChargerFunc` adapter

Given:

```go
type Charger interface {
    Charge(ctx context.Context, amount int) error
}
```

Make any plain function satisfy `Charger`.

**Acceptance criteria:**
- [ ] A named function type with a method that satisfies `Charger`.
- [ ] Compile-time check at the type definition.
- [ ] Example showing a plain function being passed where `Charger` is required.

<details><summary>Solution</summary>

```go
package main

import (
    "context"
    "fmt"
)

type Charger interface {
    Charge(ctx context.Context, amount int) error
}

type ChargerFunc func(ctx context.Context, amount int) error

func (f ChargerFunc) Charge(ctx context.Context, amount int) error {
    return f(ctx, amount)
}

var _ Charger = ChargerFunc(nil)

func process(c Charger) error {
    return c.Charge(context.Background(), 100)
}

func main() {
    c := ChargerFunc(func(_ context.Context, amount int) error {
        fmt.Printf("charging %d cents\n", amount)
        return nil
    })
    process(c)
}
```
</details>

**Discussion:** This is the `http.HandlerFunc` pattern. Five lines of code (named type + method + check) and now callers can pass either a struct or a function.

---

## Task 3 — Bridge a callback API to context

A library exposes:

```go
type Fetcher struct{}
func (f *Fetcher) FetchAsync(id string, cb func(data []byte, err error))
```

Adapt to:

```go
type ContextFetcher interface {
    Fetch(ctx context.Context, id string) ([]byte, error)
}
```

**Acceptance criteria:**
- [ ] Adapter type with `Fetch(ctx, id)`.
- [ ] Cancellation: if ctx cancels before the callback fires, return `ctx.Err()`.
- [ ] No goroutine leak after cancellation.

<details><summary>Hints</summary>

- Channel + `select` between `ctx.Done()` and the callback's result.
- Buffer the channel so the callback never blocks even if the ctx cancelled first.
</details>

<details><summary>Solution</summary>

```go
package main

import (
    "context"
    "fmt"
    "time"
)

type Fetcher struct{}

func (f *Fetcher) FetchAsync(id string, cb func(data []byte, err error)) {
    go func() {
        time.Sleep(100 * time.Millisecond)
        cb([]byte("data for "+id), nil)
    }()
}

type ContextFetcherAdapter struct{ F *Fetcher }

type fetchResult struct {
    data []byte
    err  error
}

func (a *ContextFetcherAdapter) Fetch(ctx context.Context, id string) ([]byte, error) {
    done := make(chan fetchResult, 1) // buffered so callback doesn't block
    a.F.FetchAsync(id, func(data []byte, err error) {
        done <- fetchResult{data, err}
    })
    select {
    case r := <-done:
        return r.data, r.err
    case <-ctx.Done():
        return nil, ctx.Err()
    }
}

func main() {
    a := &ContextFetcherAdapter{F: &Fetcher{}}

    ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
    defer cancel()

    data, err := a.Fetch(ctx, "user-42")
    fmt.Printf("data=%s err=%v\n", string(data), err)
}
```
</details>

**Discussion:** The callback always fires (the goroutine completes), but if the context cancelled first, the result is silently discarded via the buffered channel. The underlying call cannot be aborted — document this limitation.

---

## Task 4 — Polling to streaming

Given:

```go
type Pollable interface {
    Poll(ctx context.Context) ([]Event, error)
}
type Event struct{ ID int }
```

Adapt to a streaming channel:

```go
type Streamer interface {
    Stream(ctx context.Context) (<-chan Event, error)
}
```

**Acceptance criteria:**
- [ ] Returns a channel that produces events from successive polls.
- [ ] Closes the channel when ctx is cancelled or polling errors.
- [ ] No goroutine leak.

<details><summary>Solution</summary>

```go
package main

import (
    "context"
    "fmt"
    "time"
)

type Event struct{ ID int }

type Pollable interface {
    Poll(ctx context.Context) ([]Event, error)
}

type Streamer interface {
    Stream(ctx context.Context) (<-chan Event, error)
}

type fakePollable struct{ next int }

func (f *fakePollable) Poll(_ context.Context) ([]Event, error) {
    f.next++
    return []Event{{ID: f.next}}, nil
}

type PollAdapter struct {
    Pollable Pollable
    Interval time.Duration
}

func (a *PollAdapter) Stream(ctx context.Context) (<-chan Event, error) {
    out := make(chan Event, 16)
    go func() {
        defer close(out)
        t := time.NewTicker(a.Interval)
        defer t.Stop()
        for {
            select {
            case <-ctx.Done():
                return
            case <-t.C:
                events, err := a.Pollable.Poll(ctx)
                if err != nil { return }
                for _, e := range events {
                    select {
                    case out <- e:
                    case <-ctx.Done(): return
                    }
                }
            }
        }
    }()
    return out, nil
}

func main() {
    p := &fakePollable{}
    a := &PollAdapter{Pollable: p, Interval: 50 * time.Millisecond}

    ctx, cancel := context.WithTimeout(context.Background(), 250*time.Millisecond)
    defer cancel()

    ch, _ := a.Stream(ctx)
    for ev := range ch {
        fmt.Println("got", ev.ID)
    }
}
```
</details>

**Discussion:** The adapter introduces a goroutine — make sure it terminates when ctx is cancelled. The inner `select` for sending guards against blocked consumers if the channel is full.

---

## Task 5 — Adapt slog to a printf-style logger

Wrap a legacy logger that takes printf-style strings, exposing it as `log/slog`.

```go
type Legacy interface {
    Print(format string, args ...any)
}
```

Build an adapter such that you can do:

```go
slog.New(adapter).Info("loading", "user", uid)
```

**Acceptance criteria:**
- [ ] Implements `slog.Handler`.
- [ ] Each `slog.Record` becomes one `Print` call with a formatted string.
- [ ] Key-value pairs included in the formatted string.

<details><summary>Solution</summary>

```go
package main

import (
    "context"
    "fmt"
    "log/slog"
    "strings"
)

type Legacy interface {
    Print(format string, args ...any)
}

type legacyHandler struct {
    L Legacy
}

func NewLegacyHandler(l Legacy) slog.Handler { return &legacyHandler{L: l} }

func (h *legacyHandler) Enabled(_ context.Context, _ slog.Level) bool { return true }

func (h *legacyHandler) Handle(_ context.Context, r slog.Record) error {
    var sb strings.Builder
    sb.WriteString(r.Level.String())
    sb.WriteString(" ")
    sb.WriteString(r.Message)
    r.Attrs(func(a slog.Attr) bool {
        sb.WriteString(fmt.Sprintf(" %s=%v", a.Key, a.Value))
        return true
    })
    h.L.Print("%s", sb.String())
    return nil
}

func (h *legacyHandler) WithAttrs(_ []slog.Attr) slog.Handler { return h }
func (h *legacyHandler) WithGroup(_ string) slog.Handler { return h }

type stdoutLegacy struct{}
func (stdoutLegacy) Print(format string, args ...any) { fmt.Printf(format+"\n", args...) }

func main() {
    log := slog.New(NewLegacyHandler(stdoutLegacy{}))
    log.Info("loading", "user", "alice", "tenant", 42)
}
```
</details>

**Discussion:** `WithAttrs` and `WithGroup` would normally need to bind extra context. For brevity we return `h` unchanged — a production adapter handles them. The translation is *lossy*: structured fields collapse into a string. Document this.

---

## Task 6 — Bridge two repository interfaces

Given:

```go
package userv1
type Repo interface {
    GetUser(id string) (User, error)
    PutUser(u User) error
}
type User struct{ ID, Name string }
```

Adapt to:

```go
package userv2
type Repo interface {
    Find(ctx context.Context, id string) (User, error)
    Save(ctx context.Context, u User) error
}
type User struct{ ID, Name string }
```

**Acceptance criteria:**
- [ ] Adapter v1 → v2.
- [ ] Adapter v2 → v1 (other direction).
- [ ] Both ignore context where the inner side doesn't support it but check `ctx.Err()` first.

<details><summary>Solution</summary>

```go
// v2 adapter wrapping v1
type V1ToV2 struct{ V1 userv1.Repo }

func (a *V1ToV2) Find(ctx context.Context, id string) (userv2.User, error) {
    if err := ctx.Err(); err != nil { return userv2.User{}, err }
    u1, err := a.V1.GetUser(id)
    if err != nil { return userv2.User{}, err }
    return userv2.User{ID: u1.ID, Name: u1.Name}, nil
}

func (a *V1ToV2) Save(ctx context.Context, u userv2.User) error {
    if err := ctx.Err(); err != nil { return err }
    return a.V1.PutUser(userv1.User{ID: u.ID, Name: u.Name})
}

// v1 adapter wrapping v2
type V2ToV1 struct{ V2 userv2.Repo }

func (a *V2ToV1) GetUser(id string) (userv1.User, error) {
    u2, err := a.V2.Find(context.Background(), id)
    if err != nil { return userv1.User{}, err }
    return userv1.User{ID: u2.ID, Name: u2.Name}, nil
}

func (a *V2ToV1) PutUser(u userv1.User) error {
    return a.V2.Save(context.Background(), userv2.User{ID: u.ID, Name: u.Name})
}
```
</details>

**Discussion:** v2→v1 has to *synthesise* a context (`context.Background()`) because v1's API doesn't accept one. The v1 callers can no longer cancel. Acceptable during migration; problematic if v1 calls live in latency-sensitive paths.

---

## Task 7 — Wrap an HTTP client as a custom Fetcher

```go
type Fetcher interface {
    Get(ctx context.Context, url string) ([]byte, error)
}
```

Wrap `*http.Client`.

**Acceptance criteria:**
- [ ] Adapter satisfies `Fetcher`.
- [ ] Context cancellation works (via `http.NewRequestWithContext`).
- [ ] Non-2xx responses return an error.

<details><summary>Solution</summary>

```go
type HTTPClientAdapter struct{ Client *http.Client }

func (a *HTTPClientAdapter) Get(ctx context.Context, url string) ([]byte, error) {
    req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
    if err != nil { return nil, fmt.Errorf("HTTPClientAdapter.Get: %w", err) }
    resp, err := a.Client.Do(req)
    if err != nil { return nil, err }
    defer resp.Body.Close()
    if resp.StatusCode < 200 || resp.StatusCode >= 300 {
        return nil, fmt.Errorf("HTTPClientAdapter.Get: status %d", resp.StatusCode)
    }
    return io.ReadAll(resp.Body)
}
```
</details>

**Discussion:** Always close the response body. The adapter folds three operations (build request, do, read body) into one — appropriate for a `Get` abstraction. For more complex needs, the adapter would expose more methods.

---

## Task 8 — Adapt `database/sql` to a QueryRunner

```go
type QueryRunner interface {
    Query(ctx context.Context, query string, args ...any) (Rows, error)
}
type Rows interface {
    Next() bool
    Scan(dest ...any) error
    Close() error
}
```

Wrap `*sql.DB`.

**Acceptance criteria:**
- [ ] Adapter satisfies `QueryRunner`.
- [ ] Returned `Rows` correctly implements `Next`, `Scan`, `Close`.

<details><summary>Solution</summary>

```go
type SQLAdapter struct{ DB *sql.DB }

func (a *SQLAdapter) Query(ctx context.Context, query string, args ...any) (Rows, error) {
    rows, err := a.DB.QueryContext(ctx, query, args...)
    if err != nil { return nil, err }
    return &sqlRows{rows: rows}, nil
}

type sqlRows struct{ rows *sql.Rows }
func (r *sqlRows) Next() bool                  { return r.rows.Next() }
func (r *sqlRows) Scan(dest ...any) error      { return r.rows.Scan(dest...) }
func (r *sqlRows) Close() error                { return r.rows.Close() }
```
</details>

**Discussion:** Two adapters — one for the query runner, one for the rows. Each is thin. `*sql.Rows` already has these methods; we're effectively just re-exporting them under our own interface. The point is that consumers depend on *our* `Rows` interface, not `*sql.Rows`, so we could swap to a different SQL library later.

---

## Task 9 — Adapt any iterable to `Stream[T]`

Using Go 1.18+ generics, build:

```go
type Stream[T any] interface {
    Next() (T, bool)
}
```

Adapt slices, channels, and `bufio.Scanner` (as a `Stream[string]`) to this interface.

**Acceptance criteria:**
- [ ] Three constructors: `FromSlice[T](...)`, `FromChan[T](...)`, `FromScanner(...)`.
- [ ] Each returns a `Stream[T]`.

<details><summary>Solution</summary>

```go
type Stream[T any] interface { Next() (T, bool) }

// FromSlice
type sliceStream[T any] struct {
    items []T
    pos   int
}
func (s *sliceStream[T]) Next() (T, bool) {
    var zero T
    if s.pos >= len(s.items) { return zero, false }
    v := s.items[s.pos]
    s.pos++
    return v, true
}
func FromSlice[T any](items []T) Stream[T] { return &sliceStream[T]{items: items} }

// FromChan
type chanStream[T any] struct { ch <-chan T }
func (c *chanStream[T]) Next() (T, bool) { v, ok := <-c.ch; return v, ok }
func FromChan[T any](ch <-chan T) Stream[T] { return &chanStream[T]{ch: ch} }

// FromScanner
type scannerStream struct { s *bufio.Scanner }
func (s *scannerStream) Next() (string, bool) {
    if !s.s.Scan() { return "", false }
    return s.s.Text(), true
}
func FromScanner(s *bufio.Scanner) Stream[string] { return &scannerStream{s: s} }
```
</details>

**Discussion:** Three structurally different sources, one shared abstraction. Consumers write generic code against `Stream[T]` and don't care where the data comes from. Generics make this clean; pre-generics, you'd need three separate interfaces or `interface{}`.

---

## Task 10 — Adapt Future/Promise to context-aware Get()

A library exposes:

```go
type Promise struct{ /* ... */ }
func (p *Promise) Then(cb func(value string, err error))
```

Adapt to:

```go
type Future interface {
    Get(ctx context.Context) (string, error)
}
```

**Acceptance criteria:**
- [ ] Adapter type satisfies `Future`.
- [ ] Context cancellation works.

<details><summary>Solution</summary>

```go
type PromiseAdapter struct{ P *Promise }

func (a *PromiseAdapter) Get(ctx context.Context) (string, error) {
    type result struct { val string; err error }
    done := make(chan result, 1)
    a.P.Then(func(v string, err error) { done <- result{v, err} })
    select {
    case r := <-done: return r.val, r.err
    case <-ctx.Done(): return "", ctx.Err()
    }
}
```
</details>

**Discussion:** Same idiom as callbacks (Task 3). Promise/Future APIs from JS-style libraries are common; this adapter pattern bridges them to Go's context-driven world.

---

## Task 11 — Custom metrics → prometheus.Collector

Build an adapter that makes a custom metrics struct satisfy `prometheus.Collector`.

```go
type MyCounter struct{ name string; value int64 }
```

Adapt to:

```go
type Collector interface {
    Describe(chan<- *Desc)
    Collect(chan<- Metric)
}
```

(Simplified `Desc` and `Metric` shown.)

**Acceptance criteria:**
- [ ] Adapter struct holds a `*MyCounter`.
- [ ] `Describe` emits one desc.
- [ ] `Collect` emits one metric with the current value.

<details><summary>Solution</summary>

```go
type Desc struct{ Name string }
type Metric struct{ Name string; Value int64 }
type Collector interface {
    Describe(chan<- *Desc)
    Collect(chan<- Metric)
}

type MyCounter struct{ name string; value int64 }
func (c *MyCounter) Inc() { c.value++ }

type CounterAdapter struct{ C *MyCounter }

func (a *CounterAdapter) Describe(ch chan<- *Desc) {
    ch <- &Desc{Name: a.C.name}
}
func (a *CounterAdapter) Collect(ch chan<- Metric) {
    ch <- Metric{Name: a.C.name, Value: a.C.value}
}
```
</details>

**Discussion:** Prometheus' real `Collector` interface is similar. This pattern lets you instrument any custom metric source uniformly.

---

## Task 12 — Implement `io.NopCloser` from scratch

Without looking at the stdlib source, build a `NopCloser` that turns any `io.Reader` into an `io.ReadCloser`.

**Acceptance criteria:**
- [ ] One unexported struct, one method.
- [ ] Exported constructor returning `io.ReadCloser`.
- [ ] Uses embedding for `Read`.

<details><summary>Solution</summary>

```go
type nopCloser struct {
    io.Reader
}

func (nopCloser) Close() error { return nil }

func NopCloser(r io.Reader) io.ReadCloser { return nopCloser{r} }
```
</details>

**Discussion:** Five lines. The embedded `io.Reader` provides `Read`; `Close` is a no-op. The struct is unexported — callers can't pattern-match on it. The real `io.NopCloser` adds a small extra: if the wrapped reader is already an `io.WriterTo`, the wrapper exposes `WriteTo` too. Optional interface in action.

---

## Task 13 — Hexagonal layout

Build a tiny `order` package with two adapter targets (`Repo` and `Notifier`) plus a stub for each.

**Layout:**

```
order/service.go      # domain
order/repo.go         # Repo interface
order/notifier.go     # Notifier interface
adapters/inmem.go     # InMemRepo
adapters/log.go       # LogNotifier
main.go               # wires them
```

**Acceptance criteria:**
- [ ] `order` package has no imports outside stdlib.
- [ ] Each adapter lives in `adapters/` and imports both `order` and (in real life) the external system.
- [ ] `main.go` constructs adapters and injects.

<details><summary>Solution sketch</summary>

```go
// order/service.go
package order

type Order struct{ ID, User string }

type Service struct {
    Repo     Repo
    Notifier Notifier
}

func (s *Service) Place(ctx context.Context, o Order) error {
    if err := s.Repo.Save(ctx, o); err != nil { return err }
    return s.Notifier.Notify(ctx, "order placed: "+o.ID)
}

// order/repo.go
package order
type Repo interface { Save(ctx context.Context, o Order) error }

// order/notifier.go
package order
type Notifier interface { Notify(ctx context.Context, msg string) error }

// adapters/inmem.go
package adapters

type InMemRepo struct{ orders map[string]order.Order; mu sync.Mutex }

func (r *InMemRepo) Save(_ context.Context, o order.Order) error {
    r.mu.Lock(); defer r.mu.Unlock()
    if r.orders == nil { r.orders = map[string]order.Order{} }
    r.orders[o.ID] = o
    return nil
}

// main.go
func main() {
    svc := &order.Service{
        Repo:     &adapters.InMemRepo{},
        Notifier: &adapters.LogNotifier{Log: log.Default()},
    }
    svc.Place(context.Background(), order.Order{ID: "o1", User: "alice"})
}
```
</details>

**Discussion:** Replacing `InMemRepo` with a Postgres adapter is a one-line `main()` change. Order tests can use the in-memory adapter without spinning up Postgres. This is the payoff of hexagonal layout.

---

## Task 14 — Refactor: Convert duplicated try/log/return into a decorator

You have three services that each look like:

```go
func (s *OrderService) Place(ctx context.Context, o Order) error {
    s.log.Printf("Place: %v", o)
    err := s.repo.Save(ctx, o)
    if err != nil {
        s.log.Printf("Place failed: %v", err)
        return err
    }
    s.log.Printf("Place ok")
    return nil
}
// repeated for Edit, Cancel, etc.
```

Refactor by extracting a *logging decorator* around the inner repo, leaving the service free of logging code.

**Acceptance criteria:**
- [ ] A `LoggingRepo` decorator that wraps a `Repo` and adds logging.
- [ ] The service no longer has any `log.Printf` calls.
- [ ] Logging happens at the same call sites.

<details><summary>Solution</summary>

```go
type Repo interface {
    Save(ctx context.Context, o Order) error
}

type LoggingRepo struct {
    Inner Repo
    Log   *log.Logger
}

func (l *LoggingRepo) Save(ctx context.Context, o Order) error {
    l.Log.Printf("Save: %v", o)
    err := l.Inner.Save(ctx, o)
    if err != nil { l.Log.Printf("Save failed: %v", err); return err }
    l.Log.Printf("Save ok")
    return nil
}

// In main:
repo := &PostgresRepo{...}
repo = &LoggingRepo{Inner: repo, Log: log.Default()}
svc := &OrderService{Repo: repo}
```
</details>

**Discussion:** This is a *decorator*, not an adapter — it preserves the `Repo` interface. The service no longer cares about logging. Cross-cutting concerns (logging, metrics, retry, tracing) belong in decorators wrapping adapters, not inside the service or the adapter itself.

---

## Task 15 — Mini-project: Payment service with Stripe + PayPal

Build a tiny payment service:

```go
package payment

type Payer interface {
    Charge(ctx context.Context, amount int, currency string) (chargeID string, err error)
}

type Service struct{ Payer Payer }
func (s *Service) Process(ctx context.Context, amount int) (string, error) {
    return s.Payer.Charge(ctx, amount, "USD")
}
```

Provide *two* adapter implementations: `StripeAdapter` and `PayPalAdapter`. Each wraps a fake "SDK" (just a struct that returns a deterministic ID).

**Acceptance criteria:**
- [ ] Both adapters satisfy `payment.Payer`.
- [ ] Each adapter lives in its own subpackage.
- [ ] `main` shows the service running against each.
- [ ] A `routing.SmartPayer` (composite) picks an adapter based on a region flag.

<details><summary>Solution sketch</summary>

```go
// adapters/stripe/stripe.go
package stripe
type SDK struct{}
func (SDK) ChargeCard(amount int, currency string) (string, error) {
    return "ch_stripe_" + currency, nil
}

type Adapter struct{ SDK SDK }
func (a *Adapter) Charge(_ context.Context, amount int, currency string) (string, error) {
    return a.SDK.ChargeCard(amount, currency)
}

// adapters/paypal/paypal.go
package paypal
type SDK struct{}
func (SDK) Execute(amt int, ccy string) (string, error) {
    return "pp_paypal_" + ccy, nil
}

type Adapter struct{ SDK SDK }
func (a *Adapter) Charge(_ context.Context, amount int, currency string) (string, error) {
    return a.SDK.Execute(amount, currency)
}

// routing/smart.go
package routing
type SmartPayer struct {
    Stripe payment.Payer
    PayPal payment.Payer
    Region string
}
func (s *SmartPayer) Charge(ctx context.Context, amount int, currency string) (string, error) {
    if s.Region == "EU" {
        return s.PayPal.Charge(ctx, amount, currency)
    }
    return s.Stripe.Charge(ctx, amount, currency)
}

// main.go
func main() {
    p := &routing.SmartPayer{
        Stripe: &stripe.Adapter{SDK: stripe.SDK{}},
        PayPal: &paypal.Adapter{SDK: paypal.SDK{}},
        Region: "EU",
    }
    svc := &payment.Service{Payer: p}
    id, _ := svc.Process(context.Background(), 1000)
    fmt.Println("charge id:", id)
}
```
</details>

**Discussion:** Three layers of adaptation working together:
- `stripe.Adapter` / `paypal.Adapter` translate vendor SDKs to the `Payer` interface.
- `routing.SmartPayer` is itself a `Payer` — composes the two underlying adapters.
- `payment.Service` doesn't know about Stripe, PayPal, or routing — just `Payer`.

To add a third vendor (Square), write a `square.Adapter` and add a branch to `SmartPayer.Charge`. No other changes.

This is the architecture in `senior.md` §5 made concrete. Build it once; reach for it whenever you have multiple external dependencies behind one domain operation.
