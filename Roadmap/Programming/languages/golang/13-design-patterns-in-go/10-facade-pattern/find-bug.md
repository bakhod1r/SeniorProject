# Facade Pattern — Find the Bug

## 1. How to use this file

Fifteen short scenarios. Each has a buggy facade. Read the code, identify the bug, then expand the answer to check. The bugs are *realistic* — every one of them has shipped to production somewhere.

Difficulty varies. Some are obvious resource leaks; others are concurrency subtleties or ordering mistakes that only bite under load or during shutdown.

---

## Bug 1 — Facade exposing the internal subsystem

```go
package payments

type Facade struct {
    Gateway *StripeGateway
    Ledger  *Ledger
    Email   *EmailService
}

func New(cfg Config) *Facade {
    return &Facade{
        Gateway: NewStripeGateway(cfg.StripeKey),
        Ledger:  NewLedger(cfg.DB),
        Email:   NewEmailService(cfg.SMTP),
    }
}

func (f *Facade) Charge(userID string, amount int64) error {
    if err := f.Gateway.Charge(userID, amount); err != nil {
        return err
    }
    f.Ledger.Record(userID, amount)
    f.Email.SendReceipt(userID, amount)
    return nil
}
```

Used:

```go
pay := payments.New(cfg)
// fine for now...
pay.Charge("u1", 1000)

// six months later, in an unrelated handler:
pay.Gateway.Refund("u1", 1000) // reaches into the subsystem directly
pay.Ledger.WriteRaw("manual adjustment", -1000)
```

**What's wrong?**

<details><summary>Answer</summary>

**Bug:** Subsystem fields are exported. The whole point of a facade is to *hide* the subsystems behind a narrower, safer surface. By exporting `Gateway`, `Ledger`, and `Email`, the facade leaks every method of every subsystem to every caller. Six months later, refactoring the gateway breaks fifty call sites that bypassed the facade. The facade has degraded into a struct of pointers — a "bag of services" — with no encapsulation benefit.

Worse, callers that reach in via `pay.Ledger.WriteRaw` skip whatever invariants the facade enforces (audit logging, transaction wrapping, double-write guards). The facade is no longer the single point of policy enforcement.

**Spot in review:** Any facade with exported subsystem fields. The signature `Facade { Gateway *X; Ledger *Y }` is a red flag — those should almost always be unexported.

**Fix:**

```go
type Facade struct {
    gateway *StripeGateway
    ledger  *Ledger
    email   *EmailService
}

func New(cfg Config) *Facade {
    return &Facade{
        gateway: NewStripeGateway(cfg.StripeKey),
        ledger:  NewLedger(cfg.DB),
        email:   NewEmailService(cfg.SMTP),
    }
}

func (f *Facade) Charge(userID string, amount int64) error { /* ... */ }
func (f *Facade) Refund(userID string, amount int64) error { /* ... */ }
```

Callers can only reach the gateway *through* the facade's methods. The facade enforces policy.

**Why common:** Devs declare fields as `Gateway *StripeGateway` because they're used inside the package's methods, and the lowercase/uppercase distinction is "just a convention". Then a sibling package needs "just one direct call" and the lid is off. The encapsulation property erodes one direct access at a time.
</details>

---

## Bug 2 — `Close()` that doesn't close all subsystems

```go
type AppFacade struct {
    db    *sql.DB
    cache *redis.Client
    kafka *KafkaProducer
    metrics *MetricsClient
}

func New(cfg Config) (*AppFacade, error) {
    db, err := sql.Open("postgres", cfg.DBURL)
    if err != nil { return nil, err }
    cache := redis.NewClient(&redis.Options{Addr: cfg.RedisAddr})
    kafka, err := NewKafkaProducer(cfg.KafkaBrokers)
    if err != nil { return nil, err }
    metrics := NewMetricsClient(cfg.MetricsURL)
    return &AppFacade{db: db, cache: cache, kafka: kafka, metrics: metrics}, nil
}

func (a *AppFacade) Close() error {
    return a.db.Close()
}
```

**What's wrong?**

<details><summary>Answer</summary>

**Bug:** `Close()` closes only the database. The Redis client, Kafka producer, and metrics client are all leaked. On graceful shutdown, in-flight Kafka batches are dropped (depending on the producer's flush policy), Redis connections sit in TIME_WAIT, and the metrics client never flushes its last bucket.

In a long-running server this looks innocuous — the process exits and the OS reclaims sockets. In tests that spin up and tear down the facade thousands of times, file-descriptor and goroutine counts climb until the test runner OOMs or hits `EMFILE`.

**Spot in review:** A facade with N subsystem fields and a `Close()` that touches fewer than N. Count the closeable subsystems; count the `.Close()` calls. They must match.

**Fix:** Close everything, and collect errors:

```go
func (a *AppFacade) Close() error {
    var errs []error
    if err := a.kafka.Close(); err != nil {
        errs = append(errs, fmt.Errorf("kafka: %w", err))
    }
    if err := a.metrics.Close(); err != nil {
        errs = append(errs, fmt.Errorf("metrics: %w", err))
    }
    if err := a.cache.Close(); err != nil {
        errs = append(errs, fmt.Errorf("cache: %w", err))
    }
    if err := a.db.Close(); err != nil {
        errs = append(errs, fmt.Errorf("db: %w", err))
    }
    return errors.Join(errs...)
}
```

Keep going on error; don't short-circuit. A failure to close Kafka shouldn't leave Redis open.

**Why common:** `Close()` is written when the facade has two subsystems. Then a third and fourth are added incrementally, and nobody updates `Close()`. The compiler doesn't notice; tests rarely assert on full shutdown. The leak only surfaces under sustained re-creation.
</details>

---

## Bug 3 — Closing subsystems in the wrong order

```go
type Server struct {
    listener net.Listener
    handlers *HandlerPool   // workers drain queue, write to db
    db       *sql.DB
}

func New(cfg Config) (*Server, error) {
    db, err := sql.Open("postgres", cfg.DBURL)
    if err != nil { return nil, err }
    pool := NewHandlerPool(db, cfg.Workers)
    ln, err := net.Listen("tcp", cfg.Addr)
    if err != nil { return nil, err }
    return &Server{listener: ln, handlers: pool, db: db}, nil
}

func (s *Server) Close() error {
    s.db.Close()
    s.handlers.Close()  // workers try to flush to a closed DB
    s.listener.Close()
    return nil
}
```

**What's wrong?**

<details><summary>Answer</summary>

**Bug:** Shutdown order violates the dependency graph. The handler pool depends on the DB. Closing the DB first means in-flight handlers fail their final writes with `sql: database is closed`. The listener is closed last, so new connections continue to arrive *during* the messy shutdown.

The right order is the *reverse* of construction (mostly):

1. Stop accepting new work → close the listener first.
2. Drain in-flight work → close the handlers (they finish their writes).
3. Release the resources they depended on → close the DB last.

This is a generic principle: dependents shut down before their dependencies, mirroring how they were constructed (dependencies before dependents). Get it wrong and you race graceful-shutdown logic against resource teardown.

**Spot in review:** `Close()` methods whose order doesn't match "reverse of construction". Any closing of a resource that is still being used by another subsystem being closed later.

**Fix:**

```go
func (s *Server) Close() error {
    // 1. stop accepting new work
    if err := s.listener.Close(); err != nil { /* log */ }
    // 2. drain in-flight handlers
    if err := s.handlers.Close(); err != nil { /* log */ }
    // 3. release the DB they wrote to
    if err := s.db.Close(); err != nil { /* log */ }
    return nil
}
```

If the handler pool needs a deadline to finish, accept a `context.Context` so callers can cap the wait.

**Why common:** Developers add subsystems incrementally and call `Close()` in field declaration order — which often happens to be construction order — and that closes dependencies before dependents. The fix is to remember that *unwinding* mirrors *winding*: last in, first out, just like `defer`.
</details>

---

## Bug 4 — Lazy subsystem without `sync.Once`

```go
type Facade struct {
    mu     sync.Mutex
    db     *DBClient
    search *SearchIndex // expensive to build
}

func (f *Facade) Search(q string) ([]Result, error) {
    if f.search == nil {
        f.mu.Lock()
        if f.search == nil {
            f.search = NewSearchIndex(f.db) // 2 seconds to build
        }
        f.mu.Unlock()
    }
    return f.search.Query(q)
}
```

**What's wrong?**

<details><summary>Answer</summary>

**Bug:** The classic "double-checked locking" pattern, written incorrectly. The *first* `f.search == nil` check is unsynchronised. Two goroutines reading `f.search` concurrently with another goroutine writing `f.search` is a data race. Go's memory model is explicit: without a synchronisation primitive on both sides, there's no happens-before relationship — readers may see a half-constructed pointer, a stale nil, or torn writes.

Even when the bug doesn't surface as a panic, the race detector catches it. And on weakly ordered architectures (ARM), the read of `f.search` can be re-ordered relative to the lock, producing observable corruption.

**Spot in review:** Lazy init using `if x == nil { mu.Lock(); ... }`. Any pointer field read without synchronisation that's also written elsewhere.

**Fix:** `sync.Once`. It's purpose-built for this and has the correct memory-barrier semantics:

```go
type Facade struct {
    once   sync.Once
    db     *DBClient
    search *SearchIndex
}

func (f *Facade) Search(q string) ([]Result, error) {
    f.once.Do(func() { f.search = NewSearchIndex(f.db) })
    return f.search.Query(q)
}
```

If the initialiser can fail, use `sync.OnceValues` (Go 1.21+) so the error is returned on every call rather than swallowed.

**Why common:** Devs see "lazy init" and reach for a mutex out of habit. The double-checked-locking pattern is folklore from Java/C++ that was *also* buggy in those languages until language-level support landed. `sync.Once` exists precisely because hand-rolling this is hard to get right.
</details>

---

## Bug 5 — Facade method holding a lock during a slow subsystem call

```go
type Facade struct {
    mu    sync.Mutex
    stats map[string]int
    api   *RemoteAPIClient
}

func (f *Facade) FetchAndCount(key string) error {
    f.mu.Lock()
    defer f.mu.Unlock()

    data, err := f.api.Fetch(key) // 200ms network call
    if err != nil { return err }

    f.stats[key]++
    f.stats["total"] += len(data)
    return nil
}
```

**What's wrong?**

<details><summary>Answer</summary>

**Bug:** The mutex covers both the slow remote call *and* the map update. The map needs synchronisation; the remote call doesn't. Holding the lock for the duration of the API call means only one goroutine at a time can be making API calls — even though `FetchAndCount` is supposed to allow concurrent fetches. Throughput collapses to 1/(API latency) per second instead of being I/O parallel.

Worse, if the API hangs (no timeout), the lock is held forever, blocking every other caller of `FetchAndCount`, plus anything else that touches `f.mu`.

**Spot in review:** Any `defer mu.Unlock()` immediately followed by I/O. The lock should be held for as little time as possible, around as few statements as possible, and especially not across network calls.

**Fix:** Do the I/O outside the lock; lock only when touching the shared map:

```go
func (f *Facade) FetchAndCount(key string) error {
    data, err := f.api.Fetch(key)
    if err != nil { return err }

    f.mu.Lock()
    f.stats[key]++
    f.stats["total"] += len(data)
    f.mu.Unlock()
    return nil
}
```

For larger codebases, consider `sync.Map` or atomic counters for the stats — they remove the lock entirely.

**Why common:** `defer mu.Unlock()` is idiomatic and feels safe. Devs write it at the top of the function and forget that everything between Lock and the deferred Unlock holds the lock — including any I/O later added to the function body. Refactors that introduce new I/O inside a previously-cheap critical section silently destroy concurrency.
</details>

---

## Bug 6 — Subsystem error suppressing another error

```go
type Facade struct {
    db    *DBClient
    audit *AuditLog
}

func (f *Facade) UpdateUser(id string, name string) error {
    err := f.db.Update(id, name)
    if logErr := f.audit.Write("user.update", id); logErr != nil {
        return logErr
    }
    return err
}
```

Used:

```go
err := facade.UpdateUser("u1", "Alice")
if err != nil {
    log.Printf("update failed: %v", err)
}
// If db.Update fails but audit.Write succeeds, err is nil. Update silently fails.
```

**What's wrong?**

<details><summary>Answer</summary>

**Bug:** The DB error is captured in `err` but only returned if `audit.Write` *also* fails. If the DB update fails (record not found, constraint violation, network blip) and the audit log succeeds, the function returns `nil` — caller thinks the update worked.

Symmetrically, if `audit.Write` fails but `db.Update` succeeded, the function returns the audit error and the caller may attempt to rollback or retry, even though the user record *was* updated. Now retry causes a duplicate-key violation.

Two independent errors must be reported as two independent errors. Squashing them into one `return` produces ambiguity.

**Spot in review:** `if logErr := ...; logErr != nil { return logErr }` followed by `return err`. The structure looks tidy but loses information.

**Fix:** Combine errors with `errors.Join`:

```go
func (f *Facade) UpdateUser(id string, name string) error {
    dbErr := f.db.Update(id, name)
    auditErr := f.audit.Write("user.update", id)
    return errors.Join(dbErr, auditErr)
}
```

`errors.Join(nil, nil)` is `nil`; `errors.Join(err, nil)` is `err`; both errors are surfaced when both fail. Callers can still use `errors.Is` against either.

If the audit log is non-critical, log the audit error locally and only return the DB error:

```go
if err := f.audit.Write("user.update", id); err != nil {
    log.Printf("audit (non-fatal): %v", err)
}
return f.db.Update(id, name)
```

But that's a policy decision — be explicit about it.

**Why common:** Sequential error checks with overlapping operations naturally produce "last error wins" code. Without thinking about which error matters more — or about reporting both — the bug appears. Two-error squashing is most dangerous when one of the errors is "soft" (audit logging) and gets prioritised over a "hard" one (DB write).
</details>

---

## Bug 7 — Facade with a goroutine that's never cleaned up

```go
type Facade struct {
    cache map[string][]byte
    mu    sync.RWMutex
}

func New() *Facade {
    f := &Facade{cache: map[string][]byte{}}
    go f.expireLoop()
    return f
}

func (f *Facade) expireLoop() {
    for {
        time.Sleep(time.Minute)
        f.mu.Lock()
        for k := range f.cache {
            if shouldExpire(k) { delete(f.cache, k) }
        }
        f.mu.Unlock()
    }
}

func (f *Facade) Get(k string) []byte {
    f.mu.RLock()
    defer f.mu.RUnlock()
    return f.cache[k]
}
```

**What's wrong?**

<details><summary>Answer</summary>

**Bug:** The expiry goroutine has no exit. It loops forever, even after the facade goes out of scope. Worse, it holds a reference to `f` (via the receiver), which keeps `f` alive forever — even though no caller holds a pointer to it. Garbage collector can't reclaim the facade or its cache. In tests that construct and discard hundreds of facades, the goroutines accumulate and the memory leak grows linearly.

There's also no `Close()` method exposed. Callers have no way to stop the loop even if they wanted to.

**Spot in review:** Any constructor that does `go ...` without exposing a corresponding `Close()`. Any infinite `for { time.Sleep(...) }` loop without a `ctx.Done()` branch.

**Fix:** Provide a `Close()` and use a `context.Context` or a stop channel:

```go
type Facade struct {
    cache  map[string][]byte
    mu     sync.RWMutex
    cancel context.CancelFunc
    done   chan struct{}
}

func New() *Facade {
    ctx, cancel := context.WithCancel(context.Background())
    f := &Facade{cache: map[string][]byte{}, cancel: cancel, done: make(chan struct{})}
    go f.expireLoop(ctx)
    return f
}

func (f *Facade) expireLoop(ctx context.Context) {
    defer close(f.done)
    t := time.NewTicker(time.Minute)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done(): return
        case <-t.C:
            f.mu.Lock()
            for k := range f.cache {
                if shouldExpire(k) { delete(f.cache, k) }
            }
            f.mu.Unlock()
        }
    }
}

func (f *Facade) Close() {
    f.cancel()
    <-f.done
}
```

The caller `defer f.Close()`, the loop exits on cancel, the facade can be GC'd.

**Why common:** Background loops "obviously" need to run forever from the perspective of a single-process server. Devs forget that in tests, in plugin systems, and in any scenario where the facade has a bounded lifetime, "forever" is wrong. Cleanup is asymmetric: starting work is one line, stopping it requires plumbing.
</details>

---

## Bug 8 — Facade owns a subsystem the caller also holds

```go
type Facade struct {
    db *DBClient
}

func New(db *DBClient) *Facade {
    return &Facade{db: db}
}

func (f *Facade) Close() error {
    return f.db.Close()
}
```

Used:

```go
db := NewDBClient(cfg)
defer db.Close()

facade := facade.New(db)
defer facade.Close()
// db is closed twice
```

**What's wrong?**

<details><summary>Answer</summary>

**Bug:** Ownership is ambiguous. The caller constructs `db` and registers `defer db.Close()` — they think they own it. The caller then passes it to the facade, whose `Close()` *also* closes it. On shutdown, `db.Close()` is called twice. For some clients (e.g., `*sql.DB`) this is a no-op or returns `sql.ErrConnDone`. For others (e.g., low-level network connections), it panics or returns "use of closed connection". For HTTP/2 streams, it can corrupt accounting.

The deeper issue is that *who owns the lifecycle* of `db` is unspecified. If the facade is constructed *and disposed* with shared ownership, neither side knows whether to close.

**Spot in review:** A facade that accepts a subsystem in its constructor and also closes it in `Close()`. Two `defer X.Close()` calls in different scopes touching the same resource.

**Fix:** Pick one ownership model and document it.

Option A — facade owns the subsystem (caller doesn't close it):

```go
// New takes ownership of db; the caller must NOT close db separately.
func New(db *DBClient) *Facade {
    return &Facade{db: db}
}
func (f *Facade) Close() error { return f.db.Close() }
```

Caller: `defer facade.Close()`, do **not** `defer db.Close()`.

Option B — facade doesn't own; caller closes (facade just uses):

```go
// New borrows db; the caller is responsible for closing it.
func New(db *DBClient) *Facade {
    return &Facade{db: db}
}
// no Close() that touches db
```

Option C — facade constructs its own subsystem and owns it (`New(cfg)` returns a self-contained facade with a `Close()`). This is usually cleanest — no shared ownership to confuse anyone.

**Why common:** Refactors. The facade used to construct its own DB; then someone wanted to inject a fake for testing and added a `New(db)` overload — without removing the original `Close()` behaviour. Now two ownership models coexist in one struct.
</details>

---

## Bug 9 — Facade subsystem replaced via field assignment

```go
type Facade struct {
    client *HTTPClient
}

func New() *Facade {
    return &Facade{client: NewHTTPClient()}
}

func (f *Facade) Fetch(url string) ([]byte, error) {
    return f.client.Get(url)
}

// for tests:
func (f *Facade) SetClient(c *HTTPClient) {
    f.client = c
}
```

Used:

```go
// in a test:
facade := New()
go facade.Fetch("http://a")
facade.SetClient(&HTTPClient{}) // race
```

**What's wrong?**

<details><summary>Answer</summary>

**Bug:** `SetClient` writes `f.client`. `Fetch` reads `f.client`. There's no synchronisation. Concurrent calls produce a data race — Go's race detector flags it, and on real hardware the read can return a torn pointer (on 32-bit ARM) or a stale value (on any architecture without proper memory barriers).

The pattern is common in tests: "I just need to swap the client for a fake". But the swap method makes the field mutable, which means all reads — including production reads — must now be synchronised.

**Spot in review:** `Set...` methods on a facade that mutate a field also read by other methods. Anywhere a "test hook" mutates a previously-read-only field.

**Fix:** Use `atomic.Pointer[T]` (Go 1.19+) for lock-free reads with safe swaps:

```go
type Facade struct {
    client atomic.Pointer[HTTPClient]
}

func New() *Facade {
    f := &Facade{}
    f.client.Store(NewHTTPClient())
    return f
}

func (f *Facade) Fetch(url string) ([]byte, error) {
    return f.client.Load().Get(url)
}

func (f *Facade) SetClient(c *HTTPClient) {
    f.client.Store(c)
}
```

Better: inject the client through the constructor and don't expose `SetClient` at all. Tests construct a fresh facade with a fake:

```go
func New(client *HTTPClient) *Facade {
    return &Facade{client: client}
}
```

Tests pass in their fake; production passes in `NewHTTPClient()`. No mutation, no race.

**Why common:** "Just one little setter for tests" is the gateway drug to mutable state. Constructors that take all dependencies up front avoid the problem entirely. Whenever a setter appears, ask: can this be a constructor parameter instead?
</details>

---

## Bug 10 — Facade hides capabilities the caller needs

```go
package storage

type Facade struct {
    s3 *s3.Client
}

func (f *Facade) Get(key string) ([]byte, error) { /* ... */ return nil, nil }
func (f *Facade) Put(key string, val []byte) error { /* ... */ return nil }
func (f *Facade) Delete(key string) error { /* ... */ return nil }
```

Used:

```go
// elsewhere: I need a presigned URL for a key
url, err := storage.S3PresignSomehow(facade, "key")
// ... but Facade doesn't expose s3, and Presign isn't a method on Facade
```

The current workaround:

```go
// horrible hack — only works because we know the internals
func S3PresignSomehow(f *Facade, key string) (string, error) {
    // reach into Facade with reflection? Make Facade.s3 exported again? Add Presign to Facade?
    v := reflect.ValueOf(f).Elem().FieldByName("s3")
    client := v.Interface().(*s3.Client)
    return client.Presign(key)
}
```

**What's wrong?**

<details><summary>Answer</summary>

**Bug:** The facade is too narrow for the actual use case. The pattern says "hide the subsystems behind a small API"; but if callers genuinely need capabilities that the facade doesn't expose, the facade forces them into workarounds: reflection, re-exporting the subsystem, type assertions, or "shadow" parallel access paths.

This is a *design* bug rather than an *implementation* bug. A facade is valuable when 90% of callers want the simplified API. If 30% of callers need direct subsystem access, the facade is the wrong abstraction — it's adding indirection without proportional benefit.

**Spot in review:** Workarounds (reflection, type assertions, "raw" methods) that reach past the facade. A growing list of "passthrough" methods on the facade that just forward to a subsystem. Comments like `// expose for X` next to facade method additions.

**Fix:** Decide deliberately.

Option A — accept that those callers need direct subsystem access. Don't force them through the facade:

```go
// expose the subsystem alongside the facade
type App struct {
    Storage *storage.Facade
    S3      *s3.Client // raw, for advanced callers
}
```

The facade provides the simple path; advanced callers reach for the subsystem directly. Document the trade-off.

Option B — widen the facade's API to include the missing capability:

```go
func (f *Facade) Presign(key string, ttl time.Duration) (string, error) {
    return f.s3.Presign(key, ttl)
}
```

If lots of callers need it, it belongs on the facade.

Option C — split into multiple facades. A `StorageFacade` for the simple put/get/delete users, a `PresignFacade` for the URL-generation users.

What you should *not* do: keep the facade narrow, then introduce reflection or expose internals "just for one place".

**Why common:** Facades start narrow because the first use case is narrow. As the application grows, more use cases appear, and devs either widen the facade beyond recognition (becoming Bug 11 below) or invent workarounds that defeat the abstraction entirely. The right move is often "this isn't a facade case" — replace it with direct subsystem access.
</details>

---

## Bug 11 — God facade with 50 methods

```go
type AppFacade struct {
    db, cache, kafka, s3, smtp, search, ml, billing, audit *clients
}

func (a *AppFacade) GetUser(id string) (User, error)              { /* ... */ return User{}, nil }
func (a *AppFacade) SaveUser(u User) error                         { /* ... */ return nil }
func (a *AppFacade) ListUsers(filter Filter) ([]User, error)       { /* ... */ return nil, nil }
func (a *AppFacade) SendEmail(to, subject, body string) error      { /* ... */ return nil }
func (a *AppFacade) RenderTemplate(name string, data any) ([]byte, error) { /* ... */ return nil, nil }
func (a *AppFacade) Search(q string) ([]Doc, error)                { /* ... */ return nil, nil }
func (a *AppFacade) IndexDoc(d Doc) error                          { /* ... */ return nil }
func (a *AppFacade) Charge(userID string, amount int64) error      { /* ... */ return nil }
func (a *AppFacade) Refund(userID string, amount int64) error      { /* ... */ return nil }
func (a *AppFacade) Subscribe(userID, plan string) error           { /* ... */ return nil }
func (a *AppFacade) Cancel(userID string) error                    { /* ... */ return nil }
func (a *AppFacade) PutObject(bucket, key string, val []byte) error { /* ... */ return nil }
func (a *AppFacade) GetObject(bucket, key string) ([]byte, error)  { /* ... */ return nil, nil }
func (a *AppFacade) Audit(action, who, what string) error          { /* ... */ return nil }
// ... 36 more
```

Used everywhere:

```go
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    a := h.app // AppFacade
    u, _ := a.GetUser(r.URL.Query().Get("id"))
    a.SendEmail(u.Email, "hi", "ok")
    a.Audit("page.view", u.ID, "/")
    a.IndexDoc(Doc{ID: u.ID, Body: "..."})
}
```

**What's wrong?**

<details><summary>Answer</summary>

**Bug:** This isn't a facade — it's a *god object*. The facade pattern simplifies access to a *related* set of subsystems. When the facade grows to 50+ methods spanning user management, email, search, payments, storage, and audit, it has stopped being an abstraction; it's a globally-accessible bag of every capability in the program.

Consequences:
- **Coupling**: every consumer depends on the whole facade. A handler that only sends emails still pulls in payments, search, ML, and storage as transitive dependencies.
- **Testing**: mocking the facade for unit tests requires implementing all 50 methods. Devs default to mocking the whole struct and end up testing nothing.
- **Encapsulation lost**: any developer adding a feature reflexively reaches for `app.X()` because the facade has *something* for every need. Cross-cutting concerns proliferate.
- **Reviews are useless**: nobody can fit the whole API surface in their head. New methods get added without challenge.

The correct rule: facades should be *focused*. A `PaymentsFacade`, an `EmailFacade`, a `StorageFacade` — each one wrapping a related cluster of subsystems with a small, coherent API. Composition over conglomeration.

**Spot in review:** Any single struct with more than ~10 methods, especially when the methods span unrelated domains. Comments like `// payments stuff below; email stuff below`. Files named `facade.go` that exceed 1000 lines.

**Fix:** Break it up by domain:

```go
type App struct {
    Users    *UserFacade
    Email    *EmailFacade
    Search   *SearchFacade
    Payments *PaymentsFacade
    Storage  *StorageFacade
    Audit    *AuditFacade
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    u, _ := h.app.Users.Get(r.URL.Query().Get("id"))
    h.app.Email.Send(u.Email, "hi", "ok")
    h.app.Audit.Record("page.view", u.ID, "/")
    h.app.Search.Index(Doc{ID: u.ID})
}
```

Each facade has its own focused API. Tests mock only what they touch. New methods land in the right facade because there's a right place for them.

**Why common:** Facades are added incrementally — the first one wraps the first subsystem, then "while I'm at it, let me add email here too". Over years, the facade becomes the import target of every package. By the time anyone notices, breaking it up requires touching everything.
</details>

---

## Bug 12 — Facade method combining operations non-atomically

```go
type Facade struct {
    inventory *InventoryService
    orders    *OrderService
}

func (f *Facade) PlaceOrder(productID string, qty int, userID string) (string, error) {
    available, err := f.inventory.Get(productID)
    if err != nil { return "", err }
    if available < qty {
        return "", errors.New("insufficient stock")
    }

    orderID, err := f.orders.Create(userID, productID, qty)
    if err != nil { return "", err }

    if err := f.inventory.Decrement(productID, qty); err != nil {
        return "", err
    }

    return orderID, nil
}
```

**What's wrong?**

<details><summary>Answer</summary>

**Bug:** The facade method orchestrates three subsystem calls (`Get`, `Create`, `Decrement`) but treats the whole thing as if it were atomic. It isn't. Multiple concurrent calls to `PlaceOrder` for the same product can all observe `available > qty` before any of them decrements, then all proceed to create orders. Stock goes negative; oversold orders are placed.

Even single-threaded, the sequence is fragile:
- If `Decrement` fails after `Create` succeeded, the order exists but inventory wasn't reduced — inconsistent state.
- If the process crashes between `Create` and `Decrement`, you have the same inconsistency.

The facade is presenting the *appearance* of a single transaction, but the underlying subsystems aren't being coordinated transactionally.

**Spot in review:** Facade methods that touch two or more stateful subsystems in sequence without a transaction, lock, or compensation step. Sequences like "check, then act" where the check and the act aren't atomic.

**Fix:** Several options, depending on the constraints.

Option A — use a transactional DB call that locks the row:

```go
func (f *Facade) PlaceOrder(productID string, qty int, userID string) (string, error) {
    return f.orders.WithTx(func(tx *Tx) (string, error) {
        avail, err := f.inventory.GetForUpdate(tx, productID) // SELECT ... FOR UPDATE
        if err != nil { return "", err }
        if avail < qty { return "", errors.New("insufficient stock") }
        if err := f.inventory.Decrement(tx, productID, qty); err != nil { return "", err }
        return f.orders.Create(tx, userID, productID, qty)
    })
}
```

Option B — atomic decrement that fails on underflow:

```go
func (f *Facade) PlaceOrder(productID string, qty int, userID string) (string, error) {
    if err := f.inventory.DecrementIfAvailable(productID, qty); err != nil {
        return "", err // returns ErrInsufficientStock atomically
    }
    orderID, err := f.orders.Create(userID, productID, qty)
    if err != nil {
        // compensate: restore inventory
        _ = f.inventory.Increment(productID, qty)
        return "", err
    }
    return orderID, nil
}
```

Option C — a saga pattern: emit "order requested", a consumer allocates inventory, then emits "confirmed" or "rejected" with compensation. The right option depends on whether the subsystems share a transactional store. The wrong option — what the original code does — is "hope concurrent callers don't collide". A facade method whose name implies atomicity ("PlaceOrder", "TransferFunds", "ChargeAndShip") containing multiple subsystem calls without explicit coordination is almost always buggy.

**Why common:** Facades naturally bundle related operations. Devs assume the bundle is "the unit of work" without thinking about what that means at the subsystem level. Without transactional support or careful compensation, sequential subsystem calls are racy and crash-unsafe.
</details>

---

## Bug 13 — Facade error wrapping that loses the cause

```go
type Facade struct {
    db *DBClient
}

func (f *Facade) GetUser(id string) (User, error) {
    u, err := f.db.Query(id)
    if err != nil {
        return User{}, errors.New("failed to get user: " + err.Error())
    }
    return u, nil
}
```

Used:

```go
u, err := facade.GetUser("u1")
if errors.Is(err, sql.ErrNoRows) {
    // never matches — the chain is broken
    return notFound(w)
}
```

**What's wrong?**

<details><summary>Answer</summary>

**Bug:** The facade's error formatting uses `errors.New("... " + err.Error())`, which produces a *new* error containing only the original's message text. The error *chain* — the thing that `errors.Is` and `errors.As` walk — is broken. The caller can no longer detect that the underlying error was `sql.ErrNoRows`, a `*net.OpError`, or any other sentinel/typed error.

The result: callers fall back to string matching (`strings.Contains(err.Error(), "no rows")`), which breaks the first time the underlying error message changes. Or they treat every error as 500 Internal Server Error, losing the ability to return 404 for the "not found" case.

**Spot in review:** Any error construction using `errors.New(... + err.Error())` or `fmt.Errorf("...: " + err.Error())`. The `%w` verb is the *only* way to preserve the chain.

**Fix:** Use `fmt.Errorf` with `%w`:

```go
func (f *Facade) GetUser(id string) (User, error) {
    u, err := f.db.Query(id)
    if err != nil {
        return User{}, fmt.Errorf("get user %q: %w", id, err)
    }
    return u, nil
}
```

Now `errors.Is(err, sql.ErrNoRows)` walks the chain and returns true when appropriate. The handler can return 404 for not-found and 500 for everything else.

For domain-specific errors at the facade boundary, define a sentinel like `var ErrUserNotFound = errors.New("user not found")` and wrap it when the DB returns `sql.ErrNoRows`. Callers then match against `ErrUserNotFound` without knowing the storage layer is SQL.

**Why common:** Devs concatenate strings because that's what error messages "are". The `%w` verb is younger than the language (added in Go 1.13) and not everyone has internalised it. The bug is invisible until someone tries `errors.Is`.
</details>

---

## Bug 14 — Facade exposing a nil subsystem

```go
type Facade struct {
    db    *DBClient
    cache *CacheClient
}

func New(cfg Config) *Facade {
    f := &Facade{db: NewDB(cfg.DBURL)}
    if cfg.CacheURL != "" {
        f.cache = NewCache(cfg.CacheURL)
    }
    return f
}

func (f *Facade) GetUser(id string) (User, error) {
    if cached, ok := f.cache.Get(id); ok {
        return cached.(User), nil
    }
    return f.db.GetUser(id)
}
```

Used:

```go
cfg := Config{DBURL: "...", CacheURL: ""} // no cache configured
facade := New(cfg)
facade.GetUser("u1") // panic: nil pointer dereference
```

**What's wrong?**

<details><summary>Answer</summary>

**Bug:** `cache` is conditionally constructed. When `CacheURL` is empty, `f.cache` is nil. Every facade method that calls `f.cache.Get` / `f.cache.Set` dereferences nil and panics. The construction conditionally fails to construct, but the consumers don't check.

This is a classic "optional subsystem" misdesign. The facade lies: it implies that all subsystems are always available, then leaves one out depending on config.

**Spot in review:** Constructor branches like `if cfg.X != "" { f.x = NewX(...) }` followed by methods that unconditionally call `f.x.Y()`. The optionality is implicit; callers and methods both forget about it.

**Fix:** Three options, in order of preference.

Option A — make the subsystem always present, using a no-op implementation when disabled:

```go
type Cache interface {
    Get(string) (any, bool)
    Set(string, any)
}

type noopCache struct{}
func (noopCache) Get(string) (any, bool) { return nil, false }
func (noopCache) Set(string, any)         {}

func New(cfg Config) *Facade {
    var cache Cache = noopCache{}
    if cfg.CacheURL != "" {
        cache = NewRedisCache(cfg.CacheURL)
    }
    return &Facade{db: NewDB(cfg.DBURL), cache: cache}
}
```

Now `f.cache.Get(id)` always works. The "no cache" case is just a cache that always misses.

Option B — keep the nil and guard at every call site (`if f.cache != nil { ... }`). Pragmatic but error-prone — every method must remember the guard.

Option C — require the cache as mandatory. If the cache is "optional", that's a hint it should be its own facade composed alongside this one.

**Why common:** "Optional features" are added during refactors. The old code path didn't have a cache; the new one does, but "make it optional for backwards compatibility". The constructor branches; the methods don't. The first deploy with `CacheURL=""` panics in production.
</details>

---

## Bug 15 — Concurrent facade methods racing on shared subsystem state

```go
type RateLimitedFacade struct {
    api       *RemoteAPI
    requests  int
    lastReset time.Time
}

func New(api *RemoteAPI) *RateLimitedFacade {
    return &RateLimitedFacade{api: api, lastReset: time.Now()}
}

func (f *RateLimitedFacade) Call(req Request) (Response, error) {
    if time.Since(f.lastReset) > time.Minute {
        f.requests = 0
        f.lastReset = time.Now()
    }
    if f.requests >= 60 {
        return Response{}, errors.New("rate limit exceeded")
    }
    f.requests++
    return f.api.Send(req)
}
```

Used:

```go
facade := New(api)
for i := 0; i < 100; i++ {
    go facade.Call(req) // race on f.requests and f.lastReset
}
```

**What's wrong?**

<details><summary>Answer</summary>

**Bug:** `f.requests` and `f.lastReset` are mutated without synchronisation. Multiple goroutines read, decide, and write these fields concurrently. Symptoms:

- The rate limiter undercounts (two goroutines both read `requests=59`, both increment, only one increment survives).
- It overcounts in the other direction (read-modify-write loses updates).
- `lastReset` is partially written and corrupted (`time.Time` is a multi-word struct on 32-bit platforms).
- `time.Since(f.lastReset) > time.Minute` may evaluate to true for two goroutines simultaneously, both reset to 0, and the limiter resets twice in one window.

Go's race detector flags this immediately. The deeper issue is that *every* facade method that touches shared state needs a synchronisation strategy.

**Spot in review:** Facade fields (counters, timestamps, maps) that are mutated by methods called concurrently. The smell: a method that's a single sequence of statements touching multiple fields, with no lock or atomic primitive in sight.

**Fix:** Wrap the critical section in a mutex:

```go
type RateLimitedFacade struct {
    api       *RemoteAPI
    mu        sync.Mutex
    requests  int
    lastReset time.Time
}

func (f *RateLimitedFacade) Call(req Request) (Response, error) {
    f.mu.Lock()
    if time.Since(f.lastReset) > time.Minute {
        f.requests = 0
        f.lastReset = time.Now()
    }
    if f.requests >= 60 {
        f.mu.Unlock()
        return Response{}, errors.New("rate limit exceeded")
    }
    f.requests++
    f.mu.Unlock()
    return f.api.Send(req) // I/O outside the lock — cf. Bug 5
}
```

For higher throughput, `golang.org/x/time/rate.Limiter` is purpose-built for this and uses atomics internally — usually cleaner than hand-rolled counters.

**Why common:** Hand-rolled counters and timers look innocuous in single-goroutine code. The bug appears only under load, and the symptom (rate limiter misbehaving) is hard to attribute to a race. Devs blame the limiter algorithm, the time-source, or the network — anything but the missing lock.
</details>

---

## Summary

Three families of bugs in this set:

**Encapsulation and API-surface bugs** (1, 10, 11, 13): The facade leaks subsystems it should hide, hides capabilities it shouldn't, accumulates too many methods, or breaks the error chain. Cure: keep the facade focused; export only what the abstraction promises; preserve errors with `%w`.

**Lifecycle and resource bugs** (2, 3, 7, 8, 14): The facade mishandles construction, ownership, or shutdown — leaking subsystems, closing them in the wrong order, exposing nil subsystems, or starting goroutines with no way to stop. Cure: close everything in reverse-construction order, document ownership explicitly, provide a `Close()` for every started goroutine, and use no-op implementations rather than nil for optional subsystems.

**Concurrency and atomicity bugs** (4, 5, 6, 9, 12, 15): The facade races on shared state, holds locks during I/O, suppresses one subsystem's errors with another's, mutates fields without synchronisation, or composes non-atomic sequences of subsystem calls. Cure: `sync.Once` for lazy init, locks only around in-memory state, `errors.Join` for parallel errors, atomic pointers for swappable fields, and explicit transactions or compensation for multi-subsystem operations.

**Review checklist:**
- [ ] Subsystem fields are unexported; callers only see the facade's methods.
- [ ] `Close()` releases *every* subsystem the facade owns.
- [ ] Subsystems are closed in reverse-construction order; dependents before dependencies.
- [ ] Lazy subsystems use `sync.Once` / `sync.OnceValue`, not hand-rolled double-checked locking.
- [ ] Facade methods don't hold locks across I/O calls.
- [ ] Errors from independent subsystems are combined with `errors.Join`, not squashed.
- [ ] Goroutines started by the facade have a corresponding shutdown path.
- [ ] Ownership of injected subsystems is documented; no double `Close()`.
- [ ] Replaceable subsystem fields use `atomic.Pointer[T]` or constructor injection — not raw assignment.
- [ ] The facade is the right abstraction; advanced callers don't reach past it.
- [ ] No single facade has dozens of unrelated methods — split by domain.
- [ ] Multi-subsystem methods are explicitly atomic, transactional, or compensating.
- [ ] Errors are wrapped with `%w` so `errors.Is` / `errors.As` walk the chain.
- [ ] Optional subsystems use a no-op implementation, not nil.
- [ ] Shared facade state is protected by a mutex, atomic, or purpose-built primitive.

If you reviewed facade code with this checklist, you'd catch most of the bugs above before they reached production.
