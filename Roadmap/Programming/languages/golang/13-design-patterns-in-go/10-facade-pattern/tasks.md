# Facade Pattern — Hands-on Tasks

## 1. How to use this file

Fifteen progressive tasks. Each has:

- **Problem statement** — the scenario.
- **Acceptance criteria** — checkboxes you should satisfy.
- **Hints** (collapsible) — reach for them if stuck.
- **Solution** (collapsible) — full compilable Go.
- **Discussion** — trade-offs you missed.

All code is written for Go 1.22+. Use `go run` to verify; the solutions assume a `package main` unless otherwise noted.

A facade is a single object that wraps a *family of subsystems* and exposes one cohesive, narrow API for a common use case. The job is never to add new behaviour — it is to *hide composition*. If you find your facade growing methods that have nothing to do with each other, you have built a god object, not a facade.

---

## Task 1 — Warm-up: `OrderService` over Repo + Notifier + Payment

You have three small subsystems already written:

```go
type OrderRepo interface {
    Save(orderID string, total int) error
}
type Notifier interface {
    Send(to, msg string) error
}
type Payment interface {
    Charge(orderID string, amount int) error
}
```

A caller who wants to "place an order" today needs all three. Build a facade `OrderService.Place(ctx, customerEmail, orderID, total)` that hides this composition.

**Acceptance criteria:**
- [ ] One method on the facade: `Place(ctx, email, orderID, total int) error`.
- [ ] Internally: charge payment, save order, send notification — in that order.
- [ ] If any step fails, return a wrapped error and do not proceed to later steps.
- [ ] Caller code in `main` never touches the three subsystems directly.

<details><summary>Hints</summary>

- The facade owns the three dependencies as struct fields and is constructed via a `NewOrderService(...)` factory.
- Wrap errors with `fmt.Errorf("OrderService.Place: %w", err)` so the caller knows which boundary failed.
</details>

<details><summary>Solution</summary>

```go
package main

import (
    "context"
    "fmt"
)

type OrderRepo interface{ Save(orderID string, total int) error }
type Notifier interface{ Send(to, msg string) error }
type Payment interface{ Charge(orderID string, amount int) error }

// --- toy implementations ---

type memRepo struct{ orders map[string]int }

func (r *memRepo) Save(id string, total int) error {
    r.orders[id] = total
    fmt.Printf("[repo] saved %s total=%d\n", id, total)
    return nil
}

type stdoutNotifier struct{}

func (stdoutNotifier) Send(to, msg string) error {
    fmt.Printf("[notify] to=%s msg=%s\n", to, msg)
    return nil
}

type fakePayment struct{}

func (fakePayment) Charge(id string, amount int) error {
    fmt.Printf("[pay] charged %s amount=%d\n", id, amount)
    return nil
}

// --- the facade ---

type OrderService struct {
    repo    OrderRepo
    notify  Notifier
    payment Payment
}

func NewOrderService(r OrderRepo, n Notifier, p Payment) *OrderService {
    return &OrderService{repo: r, notify: n, payment: p}
}

func (s *OrderService) Place(_ context.Context, email, orderID string, total int) error {
    if err := s.payment.Charge(orderID, total); err != nil {
        return fmt.Errorf("OrderService.Place: charge: %w", err)
    }
    if err := s.repo.Save(orderID, total); err != nil {
        return fmt.Errorf("OrderService.Place: save: %w", err)
    }
    if err := s.notify.Send(email, fmt.Sprintf("order %s confirmed", orderID)); err != nil {
        return fmt.Errorf("OrderService.Place: notify: %w", err)
    }
    return nil
}

func main() {
    svc := NewOrderService(&memRepo{orders: map[string]int{}}, stdoutNotifier{}, fakePayment{})
    if err := svc.Place(context.Background(), "alice@example.com", "ord-1", 4200); err != nil {
        fmt.Println("error:", err)
    }
}
```
</details>

**Discussion:** A facade is, at its simplest, "three fields and one method that calls them in order". The win is at the call site: `svc.Place(...)` is one line, and the caller has no reason to know how many subsystems live behind it. Notice we did *not* invent business rules in the facade — no discount calculation, no inventory check. The facade only orchestrates. Push real logic into the subsystems where it belongs.

---

## Task 2 — Lifecycle facade with `Close()` that tears down subsystems

Subsystems often own resources: DB pools, HTTP clients, file handles, goroutines. A good facade owns those resources too and exposes a single `Close()` that cleans them all up — in *reverse* construction order.

```go
type AppFacade struct{ /* subsystems */ }
func NewAppFacade(...) (*AppFacade, error)
func (a *AppFacade) Close() error
```

**Acceptance criteria:**
- [ ] Facade constructs three subsystems each with a `Close() error`.
- [ ] `Close` calls them in reverse order.
- [ ] All errors are aggregated and returned via `errors.Join`.
- [ ] If construction fails halfway, anything already built is cleaned up before returning the error.

<details><summary>Hints</summary>

- Maintain a `[]func() error` in `New` so partial-construction cleanup is uniform.
- `errors.Join(...)` keeps every `Close` error visible.
</details>

<details><summary>Solution</summary>

```go
package main

import (
    "errors"
    "fmt"
)

type Cache struct{ name string }
type Queue struct{ name string }
type DB struct{ name string }

func (c *Cache) Close() error { fmt.Println("close cache"); return nil }
func (q *Queue) Close() error { fmt.Println("close queue"); return nil }
func (d *DB) Close() error    { fmt.Println("close db"); return nil }

func newDB() (*DB, error)       { return &DB{name: "pg"}, nil }
func newQueue() (*Queue, error) { return &Queue{name: "nats"}, nil }
func newCache() (*Cache, error) { return &Cache{name: "redis"}, nil }

type AppFacade struct {
    db      *DB
    queue   *Queue
    cache   *Cache
    closers []func() error // construction order
}

func (a *AppFacade) rollback() {
    for i := len(a.closers) - 1; i >= 0; i-- {
        _ = a.closers[i]()
    }
}

func NewAppFacade() (*AppFacade, error) {
    a := &AppFacade{}
    var err error
    if a.db, err = newDB(); err != nil {
        return nil, fmt.Errorf("db: %w", err)
    }
    a.closers = append(a.closers, a.db.Close)

    if a.queue, err = newQueue(); err != nil {
        a.rollback()
        return nil, fmt.Errorf("queue: %w", err)
    }
    a.closers = append(a.closers, a.queue.Close)

    if a.cache, err = newCache(); err != nil {
        a.rollback()
        return nil, fmt.Errorf("cache: %w", err)
    }
    a.closers = append(a.closers, a.cache.Close)
    return a, nil
}

func (a *AppFacade) Close() error {
    var errs []error
    for i := len(a.closers) - 1; i >= 0; i-- {
        if err := a.closers[i](); err != nil {
            errs = append(errs, err)
        }
    }
    return errors.Join(errs...)
}

func main() {
    app, err := NewAppFacade()
    if err != nil {
        panic(err)
    }
    fmt.Println("running with", app.db.name, app.queue.name, app.cache.name)
    if err := app.Close(); err != nil {
        fmt.Println("close errors:", err)
    }
}
```
</details>

**Discussion:** Reverse-order teardown is the same principle as `defer` in a function — later-built things depend on earlier-built things, so they must die first. The `closers` slice is a tiny stack; appending on success and walking it backwards on `Close` (or on partial-construction failure) keeps the logic uniform. Skipping this means leaked file descriptors and orphaned goroutines when something fails midway through `New`.

---

## Task 3 — Lazy-init facade subsystems

Sometimes a subsystem is only needed in a fraction of code paths (e.g. an email sender for password-reset endpoints). Constructing it eagerly wastes startup time and money (open SMTP connection, sign in to provider). Build a facade that constructs each subsystem on first use.

```go
type Services struct{ /* lazy fields */ }
func (s *Services) Mailer() *Mailer
func (s *Services) Search() *SearchClient
```

**Acceptance criteria:**
- [ ] Each subsystem is built at most once.
- [ ] Concurrent first-callers must not double-construct.
- [ ] Subsystems never constructed before they are needed.
- [ ] No locks on the hot path after first construction.

<details><summary>Hints</summary>

- `sync.OnceValue` (Go 1.21+) wraps a `func() T` and gives you a `func() T` that runs at most once.
- Store the once-funcs in struct fields; `Mailer()` just calls the func.
</details>

<details><summary>Solution</summary>

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
    "time"
)

type Mailer struct{ id int64 }
type SearchClient struct{ id int64 }

var nextID atomic.Int64

func buildMailer() *Mailer {
    fmt.Println("constructing mailer...")
    time.Sleep(20 * time.Millisecond)
    return &Mailer{id: nextID.Add(1)}
}
func buildSearch() *SearchClient {
    fmt.Println("constructing search...")
    return &SearchClient{id: nextID.Add(1)}
}

type Services struct {
    mailer func() *Mailer
    search func() *SearchClient
}

func NewServices() *Services {
    return &Services{
        mailer: sync.OnceValue(buildMailer),
        search: sync.OnceValue(buildSearch),
    }
}

func (s *Services) Mailer() *Mailer       { return s.mailer() }
func (s *Services) Search() *SearchClient { return s.search() }

func main() {
    svc := NewServices()
    fmt.Println("services exist, nothing built yet")

    var wg sync.WaitGroup
    for i := 0; i < 5; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            fmt.Println("mailer id:", svc.Mailer().id)
        }()
    }
    wg.Wait()
    // search is never used, so it's never built
}
```
</details>

**Discussion:** Lazy construction is one of the few places where a facade earns its keep beyond "ergonomic API". The naive alternative — let every caller construct what it needs — pushes lifecycle worries into every package; the eager alternative wastes startup. `sync.OnceValue` is the right tool: thread-safe, no boilerplate, no atomics in the user code. Pair this with task 2's `Close()` if the lazy thing also needs teardown — keep track of *what was actually built*.

---

## Task 4 — Error aggregation across subsystem calls

Imagine a `HealthCheck` facade that probes every dependency in parallel and reports *all* failures, not just the first.

```go
type HealthCheck struct{ /* subsystems */ }
func (h *HealthCheck) Run(ctx context.Context) error
```

**Acceptance criteria:**
- [ ] Probes run concurrently.
- [ ] All errors are aggregated with `errors.Join`.
- [ ] Each error message identifies the failing subsystem.
- [ ] Respects `ctx` cancellation: a cancelled context stops further work.

<details><summary>Hints</summary>

- `golang.org/x/sync/errgroup` is fine, but a `sync.WaitGroup` + a `[]error` guarded by a mutex is enough for this exercise.
- Each probe should be a method that takes `ctx` and returns `error`.
</details>

<details><summary>Solution</summary>

```go
package main

import (
    "context"
    "errors"
    "fmt"
    "sync"
    "time"
)

type Probe func(ctx context.Context) error

// fakeProbe returns err after delay, respecting ctx cancellation.
func fakeProbe(delay time.Duration, err error) Probe {
    return func(ctx context.Context) error {
        select {
        case <-time.After(delay):
            return err
        case <-ctx.Done():
            return ctx.Err()
        }
    }
}

type HealthCheck struct{ probes map[string]Probe }

func NewHealthCheck() *HealthCheck {
    return &HealthCheck{probes: map[string]Probe{
        "db":    fakeProbe(20*time.Millisecond, errors.New("connection refused")),
        "cache": fakeProbe(15*time.Millisecond, nil),
        "queue": fakeProbe(10*time.Millisecond, errors.New("stale leader")),
    }}
}

func (h *HealthCheck) Run(ctx context.Context) error {
    var (
        wg   sync.WaitGroup
        mu   sync.Mutex
        errs []error
    )
    for name, p := range h.probes {
        wg.Add(1)
        go func(name string, p Probe) {
            defer wg.Done()
            if err := p(ctx); err != nil {
                mu.Lock()
                errs = append(errs, fmt.Errorf("%s: %w", name, err))
                mu.Unlock()
            }
        }(name, p)
    }
    wg.Wait()
    return errors.Join(errs...)
}

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
    defer cancel()
    if err := NewHealthCheck().Run(ctx); err != nil {
        fmt.Println("unhealthy:")
        fmt.Println(err)
    } else {
        fmt.Println("all healthy")
    }
}
```
</details>

**Discussion:** Aggregating errors is what turns a facade from "wrapper" into "operator". Returning only the first failure leaves the user playing whack-a-mole; returning all of them lets ops fix everything in one go. `errors.Join` (Go 1.20+) makes the result one composite error that still satisfies `errors.Is`/`errors.As` for each underlying cause.

---

## Task 5 — Generic facade: typed cache over an opaque store

You have a generic key-value store interface:

```go
type RawStore interface {
    Get(key string) ([]byte, error)
    Set(key string, value []byte, ttl time.Duration) error
}
```

Build a generic facade `Cache[T any]` that hides JSON encoding/decoding and the raw store from callers. Callers only think in `T`.

**Acceptance criteria:**
- [ ] `Cache[T]` with `Get(key string) (T, bool, error)` and `Set(key string, v T, ttl time.Duration) error`.
- [ ] `Get` returns `(_, false, nil)` on a miss; an error only for transport/encoding failures.
- [ ] Encoding/decoding is JSON; not exposed in the facade's API.
- [ ] Demo with `Cache[User]`.

<details><summary>Hints</summary>

- Encoding errors and miss-vs-error are *different* — keep them distinct.
- Define a sentinel `ErrNotFound` on the raw store and translate it to the `(zero, false, nil)` shape at the facade boundary.
</details>

<details><summary>Solution</summary>

```go
package main

import (
    "encoding/json"
    "errors"
    "fmt"
    "sync"
    "time"
)

var ErrNotFound = errors.New("not found")

type RawStore interface {
    Get(key string) ([]byte, error)
    Set(key string, value []byte, ttl time.Duration) error
}

type memRawStore struct {
    mu   sync.Mutex
    data map[string][]byte
}

func (s *memRawStore) Get(k string) ([]byte, error) {
    s.mu.Lock()
    defer s.mu.Unlock()
    if v, ok := s.data[k]; ok {
        return v, nil
    }
    return nil, ErrNotFound
}

func (s *memRawStore) Set(k string, v []byte, _ time.Duration) error {
    s.mu.Lock()
    s.data[k] = v
    s.mu.Unlock()
    return nil
}

// generic facade
type Cache[T any] struct{ raw RawStore }

func NewCache[T any](r RawStore) *Cache[T] { return &Cache[T]{raw: r} }

func (c *Cache[T]) Get(key string) (T, bool, error) {
    var zero T
    raw, err := c.raw.Get(key)
    if errors.Is(err, ErrNotFound) {
        return zero, false, nil
    }
    if err != nil {
        return zero, false, fmt.Errorf("Cache.Get: %w", err)
    }
    var out T
    if err := json.Unmarshal(raw, &out); err != nil {
        return zero, false, fmt.Errorf("Cache.Get: decode: %w", err)
    }
    return out, true, nil
}

func (c *Cache[T]) Set(key string, v T, ttl time.Duration) error {
    raw, err := json.Marshal(v)
    if err != nil {
        return fmt.Errorf("Cache.Set: encode: %w", err)
    }
    return c.raw.Set(key, raw, ttl)
}

type User struct {
    ID   int    `json:"id"`
    Name string `json:"name"`
}

func main() {
    users := NewCache[User](&memRawStore{data: map[string][]byte{}})
    if err := users.Set("u:1", User{ID: 1, Name: "Alice"}, time.Minute); err != nil {
        panic(err)
    }
    u, ok, err := users.Get("u:1")
    fmt.Printf("hit: %+v ok=%v err=%v\n", u, ok, err)
    _, ok, err = users.Get("u:missing")
    fmt.Printf("miss: ok=%v err=%v\n", ok, err)
}
```
</details>

**Discussion:** This is the everyday generic-facade shape: hide `[]byte` and `encoding/json` behind a typed surface. The boundary discipline matters — `Get` distinguishes "miss" (returns `false`) from "broken" (returns error), so callers don't conflate them. Without generics you'd repeat the encode/decode boilerplate for every type or fall back to `interface{}`; with generics, one facade serves any JSON-encodable type.

---

## Task 6 — Refactor a god-class into facade + subsystems

You inherit this monster:

```go
type ShopManager struct {
    db   *sql.DB
    smtp *smtp.Client
    log  *slog.Logger
}
// 14 methods: CreateUser, AuthUser, RecordPurchase, MailReceipt,
// RefreshCatalog, ApplyDiscount, ChargeCard, IssueRefund, ...
```

Every method touches two or three of the fields. Refactor so the *facade* (`ShopManager`) only orchestrates and *subsystems* (`Users`, `Catalog`, `Billing`) own their data. The existing API of `ShopManager` must stay backwards-compatible.

**Acceptance criteria:**
- [ ] Three subsystem structs, each owning the dependencies it actually uses.
- [ ] `ShopManager` holds the subsystems, not the raw `*sql.DB`/`*smtp.Client`.
- [ ] Public methods on `ShopManager` are unchanged from the caller's POV.
- [ ] No subsystem reaches into another subsystem's fields.

<details><summary>Hints</summary>

- Group methods by which fields they touch — that grouping *is* your subsystem decomposition.
- The facade is the only thing that knows about all subsystems; subsystems talk to each other only via the facade if at all (we'll dodge that here by keeping examples non-cyclic).
</details>

<details><summary>Solution</summary>

```go
package main

import (
    "fmt"
    "log/slog"
    "os"
)

// stand-ins for the heavy dependencies
type DB struct{}
type SMTP struct{}

// --- subsystems: each owns only what it actually uses ---

type Users struct {
    db  *DB
    log *slog.Logger
}

func (u *Users) Create(email string) error { u.log.Info("user.create", "email", email); return nil }
func (u *Users) Auth(email string) (bool, error) {
    u.log.Info("user.auth", "email", email)
    return true, nil
}

type Catalog struct {
    db  *DB
    log *slog.Logger
}

func (c *Catalog) Refresh() error                       { c.log.Info("catalog.refresh"); return nil }
func (c *Catalog) Discount(sku string, pct int) error   { c.log.Info("catalog.discount", "sku", sku); return nil }

type Billing struct {
    db   *DB
    smtp *SMTP
    log  *slog.Logger
}

func (b *Billing) Charge(uid, amount int) error          { b.log.Info("billing.charge", "uid", uid); return nil }
func (b *Billing) Refund(orderID string) error           { b.log.Info("billing.refund", "ord", orderID); return nil }
func (b *Billing) MailReceipt(email, orderID string) error {
    b.log.Info("billing.mail-receipt", "to", email)
    return nil
}

// --- facade ---

type ShopManager struct {
    Users   *Users
    Catalog *Catalog
    Billing *Billing
}

func NewShopManager(db *DB, smtp *SMTP, log *slog.Logger) *ShopManager {
    return &ShopManager{
        Users:   &Users{db: db, log: log},
        Catalog: &Catalog{db: db, log: log},
        Billing: &Billing{db: db, smtp: smtp, log: log},
    }
}

// Backwards-compat: top-level methods just delegate. Only a few shown — the
// rest follow the same shape.
func (s *ShopManager) CreateUser(email string) error           { return s.Users.Create(email) }
func (s *ShopManager) RecordPurchase(uid, amount int) error    { return s.Billing.Charge(uid, amount) }
func (s *ShopManager) IssueRefund(orderID string) error        { return s.Billing.Refund(orderID) }
func (s *ShopManager) RefreshCatalog() error                   { return s.Catalog.Refresh() }
func (s *ShopManager) ApplyDiscount(sku string, pct int) error { return s.Catalog.Discount(sku, pct) }

func main() {
    log := slog.New(slog.NewTextHandler(os.Stdout, nil))
    s := NewShopManager(&DB{}, &SMTP{}, log)

    _ = s.CreateUser("a@b.c")
    _ = s.RecordPurchase(42, 1000)
    _ = s.IssueRefund("ord-9")
    fmt.Println("done")
}
```
</details>

**Discussion:** This is the most important refactor in OOP-flavoured codebases: the god class shrinks to a *thin* facade whose methods are one-liners, and the real logic lives in cohesive subsystems each owning the fields it actually uses. The trick is the grouping heuristic — methods that share fields belong together. Once subsystems exist, you can test them in isolation and even expose them directly (`s.Billing.Charge(...)`) instead of going through the facade — both styles work, with the facade providing the legacy surface.

---

## Task 7 — SDK-style facade with sub-services

A canonical pattern in SDK design: one root facade (`*Client`) exposes typed sub-service handles. Think `stripe.Client.Customers`, `aws.S3`, `github.Repositories`.

```go
client := NewClient(cfg)
client.Users.Get(ctx, "u_1")
client.Orders.Create(ctx, ...)
client.Billing.Invoice(ctx, ...)
```

Build a tiny version of this with three sub-services.

**Acceptance criteria:**
- [ ] `Client` is constructed once and shares a transport (HTTP client / logger / auth) with every sub-service.
- [ ] Each sub-service is a pointer field on the client.
- [ ] Sub-services have their own typed methods.
- [ ] No sub-service constructs a transport of its own.

<details><summary>Hints</summary>

- Sub-services hold a pointer back to the client (or to a shared "core") for transport.
- Construct sub-services in the same place you build the client.
</details>

<details><summary>Solution</summary>

```go
package main

import (
    "context"
    "fmt"
    "net/http"
    "time"
)

// shared core — every sub-service uses this
type core struct {
    http    *http.Client
    baseURL string
    apiKey  string
}

func (c *core) call(_ context.Context, method, path string) (string, error) {
    fmt.Printf("[%s %s%s] key=%s\n", method, c.baseURL, path, c.apiKey)
    return "ok", nil
}

// --- sub-services ---

type UsersAPI struct{ c *core }

func (u *UsersAPI) Get(ctx context.Context, id string) (string, error) {
    return u.c.call(ctx, "GET", "/users/"+id)
}

type OrdersAPI struct{ c *core }

func (o *OrdersAPI) Create(ctx context.Context, total int) (string, error) {
    return o.c.call(ctx, "POST", fmt.Sprintf("/orders?total=%d", total))
}

type BillingAPI struct{ c *core }

func (b *BillingAPI) Invoice(ctx context.Context, orderID string) (string, error) {
    return b.c.call(ctx, "POST", "/billing/invoice/"+orderID)
}

// --- facade ---

type Client struct {
    Users   *UsersAPI
    Orders  *OrdersAPI
    Billing *BillingAPI
}

type ClientConfig struct {
    BaseURL, APIKey string
    HTTP            *http.Client
}

func NewClient(cfg ClientConfig) *Client {
    if cfg.HTTP == nil {
        cfg.HTTP = &http.Client{Timeout: 10 * time.Second}
    }
    c := &core{http: cfg.HTTP, baseURL: cfg.BaseURL, apiKey: cfg.APIKey}
    return &Client{
        Users:   &UsersAPI{c: c},
        Orders:  &OrdersAPI{c: c},
        Billing: &BillingAPI{c: c},
    }
}

func main() {
    cli := NewClient(ClientConfig{BaseURL: "https://api.example.com", APIKey: "sk_test"})
    ctx := context.Background()
    _, _ = cli.Users.Get(ctx, "u_42")
    _, _ = cli.Orders.Create(ctx, 1999)
    _, _ = cli.Billing.Invoice(ctx, "ord_9")
}
```
</details>

**Discussion:** The SDK-style facade scales because adding a new resource is a *single* new sub-service type — no edits to existing code, no signature changes on `Client`. The shared `core` carries cross-cutting things (auth, retries, base URL, logger) so individual sub-services stay tiny. The whole point of namespacing methods as `cli.Users.Get` rather than `cli.GetUser` is that the IDE autocomplete tree tells the user where to look.

---

## Task 8 — Facade exposing only the operations a caller needs

Different callers need different slices of the same underlying subsystems. The facade's interface should match the *caller's needs*, not the subsystems' shape. This is interface segregation applied to facades.

Define `Reader`, `Writer`, and `Admin` (= `Reader+Writer+Delete`); one concrete struct satisfies all three; callers depend on the *smallest* interface they need.

**Acceptance criteria:**
- [ ] One concrete facade implementing all three interfaces.
- [ ] A "read-only handler" function accepts only `Reader`.
- [ ] A "writer handler" function accepts only `Writer`.
- [ ] The admin entrypoint takes `Admin`.

<details><summary>Hints</summary>

- Interfaces are satisfied implicitly in Go — the struct doesn't `implements` anything.
- Compile-time check: `var _ Reader = (*Catalog)(nil)`.
</details>

<details><summary>Solution</summary>

```go
package main

import (
    "context"
    "errors"
    "fmt"
    "sync"
)

type Item struct {
    ID, Name string
}

type Reader interface {
    Get(ctx context.Context, id string) (Item, error)
}
type Writer interface {
    Put(ctx context.Context, it Item) error
}
type Admin interface {
    Reader
    Writer
    Delete(ctx context.Context, id string) error
}

type Catalog struct {
    mu sync.RWMutex
    m  map[string]Item
}

func NewCatalog() *Catalog { return &Catalog{m: map[string]Item{}} }

func (c *Catalog) Get(_ context.Context, id string) (Item, error) {
    c.mu.RLock()
    defer c.mu.RUnlock()
    if it, ok := c.m[id]; ok {
        return it, nil
    }
    return Item{}, errors.New("not found")
}

func (c *Catalog) Put(_ context.Context, it Item) error {
    c.mu.Lock()
    c.m[it.ID] = it
    c.mu.Unlock()
    return nil
}

func (c *Catalog) Delete(_ context.Context, id string) error {
    c.mu.Lock()
    delete(c.m, id)
    c.mu.Unlock()
    return nil
}

// Compile-time guarantees that *Catalog satisfies every interface.
var (
    _ Reader = (*Catalog)(nil)
    _ Writer = (*Catalog)(nil)
    _ Admin  = (*Catalog)(nil)
)

func displayName(ctx context.Context, r Reader, id string) {
    it, err := r.Get(ctx, id)
    if err != nil {
        fmt.Println("read error:", err)
        return
    }
    fmt.Println("item:", it.Name)
}

func importBatch(ctx context.Context, w Writer, items []Item) {
    for _, it := range items {
        _ = w.Put(ctx, it)
    }
}

func adminConsole(ctx context.Context, a Admin) {
    _ = a.Put(ctx, Item{ID: "x", Name: "X"})
    _ = a.Delete(ctx, "x")
}

func main() {
    cat := NewCatalog()
    ctx := context.Background()
    importBatch(ctx, cat, []Item{{ID: "a", Name: "Apple"}, {ID: "b", Name: "Banana"}})
    displayName(ctx, cat, "a")
    adminConsole(ctx, cat)
}
```
</details>

**Discussion:** A facade is more than one struct — it's also *the interfaces it satisfies*. Different callers want different views. The discipline: define each interface where the *caller* lives, then make the facade implement them implicitly. This keeps the dependency graph one-way (callers depend on interfaces they own; the facade depends on nothing) and makes tests trivially substitutable.

---

## Task 9 — Multi-tenant facade routing to per-tenant subsystems

A SaaS app has a separate DB per tenant. Build a facade that hides this routing so callers say `repo.Get(ctx, key)` and never think about which underlying DB is involved.

```go
type TenantedRepo struct{ /* ... */ }
func (r *TenantedRepo) Get(ctx context.Context, key string) (string, error)
```

The tenant ID lives in the context.

**Acceptance criteria:**
- [ ] One `TenantedRepo` value handles many tenants.
- [ ] Tenant ID is read from `ctx` via a typed key.
- [ ] Unknown tenant -> typed error.
- [ ] No global mutable map; the facade owns the per-tenant store map.

<details><summary>Hints</summary>

- Use an unexported `type tenantKey struct{}` as the context key (not a string).
- Per-tenant store map is built once at facade construction.
</details>

<details><summary>Solution</summary>

```go
package main

import (
    "context"
    "errors"
    "fmt"
    "sync"
)

var (
    ErrUnknownTenant = errors.New("unknown tenant")
    ErrMissingTenant = errors.New("missing tenant in context")
)

type tenantKey struct{}

func WithTenant(ctx context.Context, id string) context.Context {
    return context.WithValue(ctx, tenantKey{}, id)
}
func tenantFrom(ctx context.Context) (string, bool) {
    v, ok := ctx.Value(tenantKey{}).(string)
    return v, ok && v != ""
}

type kvStore struct {
    mu sync.RWMutex
    m  map[string]string
}

func (s *kvStore) Get(k string) (string, bool) {
    s.mu.RLock()
    defer s.mu.RUnlock()
    v, ok := s.m[k]
    return v, ok
}

type TenantedRepo struct{ stores map[string]*kvStore }

func NewTenantedRepo() *TenantedRepo {
    return &TenantedRepo{stores: map[string]*kvStore{
        "acme":   {m: map[string]string{"theme": "blue"}},
        "globex": {m: map[string]string{"theme": "red"}},
    }}
}

func (r *TenantedRepo) Get(ctx context.Context, key string) (string, error) {
    tid, ok := tenantFrom(ctx)
    if !ok {
        return "", ErrMissingTenant
    }
    s, ok := r.stores[tid]
    if !ok {
        return "", fmt.Errorf("%w: %s", ErrUnknownTenant, tid)
    }
    v, ok := s.Get(key)
    if !ok {
        return "", fmt.Errorf("tenant %s: key %q not found", tid, key)
    }
    return v, nil
}

func main() {
    repo := NewTenantedRepo()
    for _, c := range []context.Context{
        WithTenant(context.Background(), "acme"),
        WithTenant(context.Background(), "globex"),
        WithTenant(context.Background(), "wonka"),
        context.Background(),
    } {
        v, err := repo.Get(c, "theme")
        fmt.Printf("v=%q err=%v\n", v, err)
    }
}
```
</details>

**Discussion:** Multi-tenancy is one of the cleanest reasons to introduce a facade: the routing logic exists once, in one place, and the rest of the codebase reads as if the tenant didn't exist. The context-based tenant key is the standard Go shape — typed key, no global state, no parameter pollution through every function. Watch out for the failure modes: forget-the-tenant must be a *typed* error so middleware can detect it.

---

## Task 10 — Thread-safe facade serialising concurrent calls

Sometimes the subsystem behind a facade is *not* safe for concurrent use (e.g. a single shared writer). The facade can serialise access so callers don't have to.

```go
type LogWriter struct{ /* wraps an unsafe sink */ }
func (l *LogWriter) Write(line string) error
```

**Acceptance criteria:**
- [ ] Facade wraps a deliberately non-safe sink (`UnsafeSink`).
- [ ] Concurrent calls to `Write` never interleave.
- [ ] Demonstrate with `go run -race` clean output.

<details><summary>Hints</summary>

- A `sync.Mutex` around the call is the simplest path. For higher throughput, push writes onto a buffered channel and drain on one goroutine.
</details>

<details><summary>Solution</summary>

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

// deliberately not safe
type UnsafeSink struct{ lines []string }

func (s *UnsafeSink) WriteLine(l string) {
    tmp := append(s.lines, l)
    time.Sleep(time.Millisecond) // would race under concurrent use
    s.lines = tmp
}

type LogWriter struct {
    mu   sync.Mutex
    sink *UnsafeSink
}

func NewLogWriter(s *UnsafeSink) *LogWriter { return &LogWriter{sink: s} }

func (l *LogWriter) Write(line string) error {
    l.mu.Lock()
    defer l.mu.Unlock()
    l.sink.WriteLine(line)
    return nil
}

func main() {
    sink := &UnsafeSink{}
    lw := NewLogWriter(sink)

    var wg sync.WaitGroup
    for i := 0; i < 20; i++ {
        wg.Add(1)
        go func(i int) {
            defer wg.Done()
            _ = lw.Write(fmt.Sprintf("line-%d", i))
        }(i)
    }
    wg.Wait()
    fmt.Println("total lines:", len(sink.lines))
}
```
</details>

**Discussion:** Pushing concurrency concerns into the facade means the rest of the codebase can be naive about thread safety. A mutex is the simplest policy; a buffered channel + drainer goroutine is the higher-throughput alternative and doubles as a back-pressure boundary. The facade is the right place to encode that choice — changing it later is a one-file edit.

---

## Task 11 — Facade returning context-cancellable operations

A facade method should respect `ctx.Done()`. Build a `ReportBuilder` whose `Build(ctx)` reads three independent slow data sources concurrently and aborts the whole thing on context cancel.

```go
type ReportBuilder struct{ /* sources */ }
func (r *ReportBuilder) Build(ctx context.Context) (Report, error)
```

**Acceptance criteria:**
- [ ] Three goroutines fan out reads.
- [ ] First failure cancels the others (use `context.WithCancel`).
- [ ] Returns either a complete `Report` or the first error.
- [ ] No goroutine leaks after the function returns.

<details><summary>Hints</summary>

- `errgroup.WithContext` does precisely this, but write it with `sync.WaitGroup` + a child cancel to see the mechanics.
- Each source's goroutine selects on its own work *and* `ctx.Done()`.
</details>

<details><summary>Solution</summary>

```go
package main

import (
    "context"
    "fmt"
    "sync"
    "time"
)

type Report struct{ Users, Orders, Revenue int }

type Source func(ctx context.Context) (int, error)

func slowSource(name string, value int, delay time.Duration, fail bool) Source {
    return func(ctx context.Context) (int, error) {
        if fail {
            return 0, fmt.Errorf("%s: forced failure", name)
        }
        select {
        case <-time.After(delay):
            return value, nil
        case <-ctx.Done():
            return 0, ctx.Err()
        }
    }
}

type ReportBuilder struct{ Users, Orders, Revenue Source }

func (r *ReportBuilder) Build(ctx context.Context) (Report, error) {
    ctx, cancel := context.WithCancel(ctx)
    defer cancel()

    var (
        report Report
        wg     sync.WaitGroup
        mu     sync.Mutex
        first  error
    )

    run := func(s Source, set func(int)) {
        defer wg.Done()
        v, err := s(ctx)
        mu.Lock()
        defer mu.Unlock()
        if err != nil {
            if first == nil {
                first = err
                cancel()
            }
            return
        }
        set(v)
    }

    wg.Add(3)
    go run(r.Users, func(v int) { report.Users = v })
    go run(r.Orders, func(v int) { report.Orders = v })
    go run(r.Revenue, func(v int) { report.Revenue = v })
    wg.Wait()

    if first != nil {
        return Report{}, first
    }
    return report, nil
}

func main() {
    ok := &ReportBuilder{
        Users:   slowSource("users", 100, 50*time.Millisecond, false),
        Orders:  slowSource("orders", 30, 40*time.Millisecond, false),
        Revenue: slowSource("revenue", 9999, 60*time.Millisecond, false),
    }
    r, err := ok.Build(context.Background())
    fmt.Printf("happy: %+v err=%v\n", r, err)

    bad := *ok
    bad.Orders = slowSource("orders", 0, 0, true) // fails immediately
    r, err = bad.Build(context.Background())
    fmt.Printf("sad: %+v err=%v\n", r, err)
}
```
</details>

**Discussion:** The facade's responsibility here is *coordination*. Each source already knows how to do its job and how to listen for cancellation; the facade fans them out, collects the first failure, and ensures nothing leaks. Note `defer cancel()` even though `ctx` is derived — without it, a successful run would leak the child context until the parent died. `errgroup.WithContext` is the production version of this pattern; build it once by hand so the mechanics are not magic.

---

## Task 12 — Facade with hot-reload subsystem swap

The facade holds a pointer to a subsystem (say, a feature-flag client). At runtime, operators trigger a reload that swaps in a freshly-built subsystem. Calls in flight see either the old or the new one — never a torn mix.

```go
type FeatureFacade struct{ /* atomic.Pointer to a client */ }
func (f *FeatureFacade) Enabled(flag string) bool
func (f *FeatureFacade) Reload(newClient *Client)
```

**Acceptance criteria:**
- [ ] `Enabled` is lock-free on the read path.
- [ ] `Reload` atomically replaces the underlying client.
- [ ] Demo with one goroutine spamming `Enabled` and another calling `Reload`.
- [ ] `go run -race` clean.

<details><summary>Hints</summary>

- `atomic.Pointer[Client]` (Go 1.19+).
- The replaced client should be *immutable* — never mutate after publishing.
</details>

<details><summary>Solution</summary>

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
    "time"
)

type Client struct {
    flags   map[string]bool
    version int
}

func NewClient(version int, flags map[string]bool) *Client {
    return &Client{flags: flags, version: version}
}

func (c *Client) Enabled(name string) bool { return c.flags[name] }

type FeatureFacade struct{ cli atomic.Pointer[Client] }

func NewFeatureFacade(initial *Client) *FeatureFacade {
    f := &FeatureFacade{}
    f.cli.Store(initial)
    return f
}

func (f *FeatureFacade) Enabled(flag string) bool { return f.cli.Load().Enabled(flag) }
func (f *FeatureFacade) Reload(c *Client)         { f.cli.Store(c) }

func main() {
    ff := NewFeatureFacade(NewClient(1, map[string]bool{"dark_mode": false}))

    stop := make(chan struct{})
    var wg sync.WaitGroup
    wg.Add(1)
    go func() {
        defer wg.Done()
        for {
            select {
            case <-stop:
                return
            default:
                _ = ff.Enabled("dark_mode")
            }
        }
    }()

    time.Sleep(30 * time.Millisecond)
    ff.Reload(NewClient(2, map[string]bool{"dark_mode": true}))
    fmt.Println("after reload, dark_mode =", ff.Enabled("dark_mode"))
    close(stop)
    wg.Wait()
}
```
</details>

**Discussion:** A facade that can hot-swap its subsystem is the runtime equivalent of dependency injection. Two rules: store immutable snapshots only, and never mutate them after `Store`. If the new client has its own lifecycle (background goroutine, open connections), grab a reference to the old one before swapping so you can `Close` it after the swap. The lock-free read path is critical when `Enabled` is called millions of times per second.

---

## Task 13 — Facade testing: mock individual subsystems

Refactor the Task 1 `OrderService` so each subsystem is testable in isolation. Write tests that fail when:

- Payment fails (no save, no notify).
- Save fails (payment already charged — log it; do not notify).
- Notify fails (the order is still placed but the error is surfaced).

**Acceptance criteria:**
- [ ] Subsystem fields on `OrderService` are interfaces.
- [ ] Each test injects a fake subsystem implementation.
- [ ] Tests assert on observable behaviour (which fakes were called and with what).
- [ ] No `testing/mock` library — hand-rolled fakes.

<details><summary>Hints</summary>

- A fake is just a struct implementing the interface, recording calls in a slice.
- For each behaviour, build a fake that returns the desired error.
</details>

<details><summary>Solution</summary>

`order.go` is exactly Task 1's facade (interfaces + `OrderService.Place`). `order_test.go` adds:

```go
package order

import (
    "context"
    "errors"
    "fmt"
    "strings"
    "testing"
)

// Each fake records calls and returns a pre-set error.
type fakePayment struct{ err error; calls []string }
type fakeRepo struct{ err error; calls []string }
type fakeNotifier struct{ err error; calls []string }

func (f *fakePayment) Charge(id string, amt int) error {
    f.calls = append(f.calls, fmt.Sprintf("charge:%s:%d", id, amt))
    return f.err
}
func (f *fakeRepo) Save(id string, total int) error {
    f.calls = append(f.calls, fmt.Sprintf("save:%s:%d", id, total))
    return f.err
}
func (f *fakeNotifier) Send(to, msg string) error {
    f.calls = append(f.calls, fmt.Sprintf("send:%s:%s", to, msg))
    return f.err
}

func TestPaymentFails(t *testing.T) {
    p := &fakePayment{err: errors.New("declined")}
    r, n := &fakeRepo{}, &fakeNotifier{}
    err := NewOrderService(r, n, p).Place(context.Background(), "a@b.c", "ord1", 100)
    if err == nil || !strings.Contains(err.Error(), "declined") {
        t.Fatalf("want declined, got %v", err)
    }
    if len(r.calls)+len(n.calls) != 0 {
        t.Errorf("repo/notify must not run, got r=%v n=%v", r.calls, n.calls)
    }
}

func TestSaveFails(t *testing.T) {
    p, n := &fakePayment{}, &fakeNotifier{}
    r := &fakeRepo{err: errors.New("db down")}
    if err := NewOrderService(r, n, p).Place(context.Background(), "a@b.c", "ord1", 100); err == nil {
        t.Fatal("expected error")
    }
    if len(p.calls) != 1 || len(n.calls) != 0 {
        t.Errorf("want p=1 n=0, got p=%v n=%v", p.calls, n.calls)
    }
}

func TestNotifyFails(t *testing.T) {
    p, r := &fakePayment{}, &fakeRepo{}
    n := &fakeNotifier{err: errors.New("smtp")}
    if err := NewOrderService(r, n, p).Place(context.Background(), "a@b.c", "ord1", 100); err == nil {
        t.Fatal("expected error")
    }
    if len(p.calls)*len(r.calls)*len(n.calls) != 1 {
        t.Errorf("all three must run, got p=%v r=%v n=%v", p.calls, r.calls, n.calls)
    }
}
```
</details>

**Discussion:** Hand-rolled fakes recording calls beat mocking libraries for facade tests. The assertions are concrete ("repo was called exactly once with these args") and the failure messages are obvious. The deeper lesson: a facade is testable in exact proportion to how well it isolates its subsystems behind interfaces. If your facade depends on `*sql.DB` directly, you're back to integration tests; if it depends on `OrderRepo`, you have unit tests.

---

## Task 14 — Mini-project: small DB facade with prepared-statement cache

Build `UserDB`, a facade hiding the database layer behind a typed surface. It must:

- Speak only the domain language (`User`, `id`, `name`) to callers; no SQL strings escape the package.
- Cache prepared statements so each query is prepared once.
- `Close` finalises every cached statement, then the DB.

To keep the file self-contained without a third-party driver, the solution sketches a tiny stand-in that obeys the same shape as `*sql.DB`/`*sql.Stmt`. Swap in `database/sql` + `modernc.org/sqlite` in production — the facade's surface stays identical.

```go
type UserDB struct{ /* db + stmt cache */ }
func NewUserDB(dsn string) (*UserDB, error)
func (u *UserDB) GetUser(ctx context.Context, id int) (User, error)
func (u *UserDB) CreateUser(ctx context.Context, name string) (int, error)
func (u *UserDB) Close() error
```

**Acceptance criteria:**
- [ ] No DB type leaks out of the facade.
- [ ] Prepared statements cached by query text (or named constant).
- [ ] `Close` finalises every cached statement, then the DB.
- [ ] Demo in `main` exercising create + get.

<details><summary>Hints</summary>

- A `map[string]*Stmt` guarded by `sync.Mutex` is enough for a statement cache.
- Wrap statement closing in `errors.Join` during `Close`.
</details>

<details><summary>Solution</summary>

Uses `database/sql` directly. Any driver works; the snippet imports `modernc.org/sqlite`
(pure-Go, no cgo) so `go run` succeeds with one `go get`.

```go
package main

import (
    "context"
    "database/sql"
    "errors"
    "fmt"
    "sync"

    _ "modernc.org/sqlite"
)

const (
    schema      = `CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)`
    qInsertUser = `INSERT INTO users(name) VALUES(?)`
    qSelectUser = `SELECT id, name FROM users WHERE id = ?`
)

type User struct {
    ID   int
    Name string
}

type UserDB struct {
    db      *sql.DB
    stmtsMu sync.Mutex
    stmts   map[string]*sql.Stmt
}

func NewUserDB(dsn string) (*UserDB, error) {
    db, err := sql.Open("sqlite", dsn)
    if err != nil {
        return nil, fmt.Errorf("open: %w", err)
    }
    if _, err := db.Exec(schema); err != nil {
        db.Close()
        return nil, fmt.Errorf("schema: %w", err)
    }
    return &UserDB{db: db, stmts: map[string]*sql.Stmt{}}, nil
}

func (u *UserDB) prepare(ctx context.Context, q string) (*sql.Stmt, error) {
    u.stmtsMu.Lock()
    defer u.stmtsMu.Unlock()
    if s, ok := u.stmts[q]; ok {
        return s, nil
    }
    s, err := u.db.PrepareContext(ctx, q)
    if err != nil {
        return nil, fmt.Errorf("prepare %q: %w", q, err)
    }
    u.stmts[q] = s
    return s, nil
}

func (u *UserDB) CreateUser(ctx context.Context, name string) (int, error) {
    s, err := u.prepare(ctx, qInsertUser)
    if err != nil {
        return 0, err
    }
    res, err := s.ExecContext(ctx, name)
    if err != nil {
        return 0, fmt.Errorf("CreateUser: %w", err)
    }
    id, _ := res.LastInsertId()
    return int(id), nil
}

func (u *UserDB) GetUser(ctx context.Context, id int) (User, error) {
    s, err := u.prepare(ctx, qSelectUser)
    if err != nil {
        return User{}, err
    }
    var out User
    if err := s.QueryRowContext(ctx, id).Scan(&out.ID, &out.Name); err != nil {
        return User{}, fmt.Errorf("GetUser: %w", err)
    }
    return out, nil
}

func (u *UserDB) Close() error {
    u.stmtsMu.Lock()
    defer u.stmtsMu.Unlock()
    var errs []error
    for q, s := range u.stmts {
        if err := s.Close(); err != nil {
            errs = append(errs, fmt.Errorf("stmt %q: %w", q, err))
        }
    }
    u.stmts = nil
    if err := u.db.Close(); err != nil {
        errs = append(errs, fmt.Errorf("db: %w", err))
    }
    return errors.Join(errs...)
}

func main() {
    udb, err := NewUserDB(":memory:")
    if err != nil {
        panic(err)
    }
    defer udb.Close()

    ctx := context.Background()
    id, err := udb.CreateUser(ctx, "Alice")
    if err != nil {
        panic(err)
    }
    fmt.Println("created id:", id)

    u, _ := udb.GetUser(ctx, id)
    fmt.Printf("got: %+v\n", u)
}
```
</details>

**Discussion:** The facade earns its keep three ways here. (1) Query strings stay in one file as named constants — no `SELECT ... FROM users` scattered across the codebase. (2) The prepared-statement cache exists once; callers never think about it. (3) `Close` cleans up *both* statements and the DB in correct order. The `User`/`UserDB` surface never leaks `*sql.DB` or `sql.ErrNoRows` to callers; that's the test of a good facade.

---

## Task 15 — Bonus: facade and DI integration

Wire the Task 7 SDK-style facade into a tiny dependency-injection container. The container builds the facade once and hands it (typed) to callers. No global state.

```go
type Container struct{ /* private slots */ }
func NewContainer(cfg Config) (*Container, error)
func (c *Container) Client() *Client
func (c *Container) Close() error
```

**Acceptance criteria:**
- [ ] Container constructs the SDK client and its dependencies (transport, logger).
- [ ] `Client()` returns the singleton facade.
- [ ] `Close()` shuts down everything the container created.
- [ ] No global `var client *Client` anywhere.

<details><summary>Hints</summary>

- The container itself is just another, slightly bigger facade.
- A `sync.Once` makes idempotent construction easy if you want lazy semantics; eager is also fine here.
</details>

<details><summary>Solution</summary>

```go
package main

import (
    "context"
    "errors"
    "fmt"
    "log/slog"
    "net/http"
    "os"
    "time"
)

// --- SDK pieces (compressed from Task 7) ---

type core struct {
    http    *http.Client
    baseURL string
    log     *slog.Logger
}

func (c *core) call(_ context.Context, method, path string) (string, error) {
    c.log.Info("call", "method", method, "path", path)
    return "ok", nil
}

type UsersAPI struct{ c *core }

func (u *UsersAPI) Get(ctx context.Context, id string) (string, error) {
    return u.c.call(ctx, "GET", "/users/"+id)
}

type OrdersAPI struct{ c *core }

func (o *OrdersAPI) Create(ctx context.Context, total int) (string, error) {
    return o.c.call(ctx, "POST", fmt.Sprintf("/orders?total=%d", total))
}

type Client struct {
    Users  *UsersAPI
    Orders *OrdersAPI
}

// --- DI container ---

type Config struct{ BaseURL, APIKey string }

type Container struct {
    log     *slog.Logger
    client  *Client
    closers []func() error
}

func NewContainer(cfg Config) (*Container, error) {
    if cfg.BaseURL == "" {
        return nil, errors.New("Container: BaseURL required")
    }
    log := slog.New(slog.NewTextHandler(os.Stdout, nil))
    hc := &http.Client{Timeout: 10 * time.Second}
    co := &core{http: hc, baseURL: cfg.BaseURL, log: log}
    return &Container{
        log:    log,
        client: &Client{Users: &UsersAPI{c: co}, Orders: &OrdersAPI{c: co}},
        closers: []func() error{
            func() error { hc.CloseIdleConnections(); return nil },
        },
    }, nil
}

func (c *Container) Client() *Client      { return c.client }
func (c *Container) Logger() *slog.Logger { return c.log }

func (c *Container) Close() error {
    var errs []error
    for i := len(c.closers) - 1; i >= 0; i-- {
        if err := c.closers[i](); err != nil {
            errs = append(errs, err)
        }
    }
    return errors.Join(errs...)
}

func main() {
    cont, err := NewContainer(Config{BaseURL: "https://api.example.com", APIKey: "sk_test"})
    if err != nil {
        panic(err)
    }
    defer cont.Close()

    ctx := context.Background()
    _, _ = cont.Client().Users.Get(ctx, "u_1")
    _, _ = cont.Client().Orders.Create(ctx, 1999)
    cont.Logger().Info("done")
}
```
</details>

**Discussion:** A DI container is, in many Go codebases, just a facade over construction. You don't need `wire`, `fx`, or reflection: a struct with a `New...` factory and exported `Getter()` methods does it. Two principles transfer directly: (1) reverse-order teardown via `closers`, exactly like Task 2; (2) construction-time validation, so bad config fails before the program starts. When the container becomes complex enough that this hand-rolled style hurts, switching to a framework is straightforward because the *shape* is already right.

---

## Wrap-up

You've now used facades for: simple orchestration, lifecycle ownership, lazy construction, parallel error aggregation, generic typed wrappers, god-class refactoring, SDK sub-services, interface segregation, multi-tenant routing, concurrency-safe wrapping, context-cancellable coordination, hot-reload swaps, mockable testing, prepared-statement caching, and DI integration.

The common thread: a facade is the *boundary* between callers and a family of subsystems. It says yes to orchestration, lifecycle, validation, and ergonomics; it says no to business logic and to growing methods that don't belong together. Keep it small, keep its API focused on one use case, and let the subsystems carry the weight.
