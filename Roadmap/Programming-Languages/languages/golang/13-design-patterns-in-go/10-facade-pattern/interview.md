# Facade Pattern — Interview Preparation

## 1. What interviewers test for

The Facade pattern is the most pragmatic and most misunderstood pattern in Go interviews. Almost every Go binary contains at least one facade — `*http.Client`, `*sql.DB`, `*s3.Client` — but most engineers can't articulate *why* a facade is a facade, or *when* introducing one becomes harmful. Interviewers probe four areas:

1. **Recognition** — Can you point at `http.Client.Do` and explain what it hides (DNS, dialing, TLS, keep-alive, redirects, cookies, retries)? Do you see that `sql.DB` is a facade over `driver.Driver`, `driver.Conn`, `driver.Stmt`, `driver.Tx`?
2. **Facade vs Adapter vs Proxy** — A facade *simplifies* (many small things into one ergonomic API). An adapter *translates* (one shape into another). A proxy *intercepts* (controls access to one thing). Mixing them up is the most common red flag.
3. **When to apply** — A facade is correct when the subsystem is complex *and* the simplification is durable. It's wrong when it hides things the caller actually needs to tune, or when it adds a layer with no real value.
4. **Production traps** — Hiding too much (callers can't customize), hiding too little (the "facade" exposes 80% of the underlying types and adds confusion), lifecycle leaks (facade owns resources but has no `Close`), error mapping that destroys diagnostic information.

Signals by level:

| Level | What they're looking for |
|-------|--------------------------|
| Junior | Can name a facade in the stdlib and explain what it hides; doesn't confuse facade with adapter |
| Middle | Designs an SDK facade with clean error mapping, lifecycle, and an escape hatch for advanced users |
| Senior | Refactors a god-class into a layered facade; reasons about lazy subsystems, versioning, observability, and aggregation of errors across subsystem calls |

Red flag at any level: claiming "a facade is just a wrapper". Wrappers are a syntactic notion; facades are a semantic one. A facade has *intent* — to present a simpler conceptual surface than the subsystem behind it.

A second red flag: "Go doesn't need facades because interfaces". Interfaces describe a contract; facades package a *workflow* across multiple contracts. They solve different problems.

---

## 2. Table of Contents

1. [What interviewers test for](#1-what-interviewers-test-for)
2. [Table of Contents](#2-table-of-contents)
3. [Junior questions](#3-junior-questions)
4. [Middle questions](#4-middle-questions)
5. [Senior questions](#5-senior-questions)
6. [Live coding challenges](#6-live-coding-challenges)
7. [System design starters](#7-system-design-starters)
8. [Traps and red flags](#8-traps-and-red-flags)
9. [Questions to ASK the interviewer](#9-questions-to-ask-the-interviewer)
10. [Cross-references](#10-cross-references)

---

## 3. Junior questions

### Q1. What is the Facade pattern? When would you use it in Go?

**Answer:** A facade is a single, narrow API that hides a complex subsystem of cooperating types behind it. The caller speaks one verb; the facade orchestrates many internal calls. Use it when:

- A workflow requires coordinated calls across multiple types and you want one entry point.
- The subsystem exposes details (low-level options, lifecycle objects, intermediate states) that 90% of callers don't need.
- You want to keep the *option* of changing the subsystem without breaking callers.

Canonical Go examples: `http.Client.Get(url)` hides DNS, dialing, TLS handshake, request building, header negotiation, redirect handling, response parsing. `sql.DB.QueryContext(ctx, q)` hides connection acquisition, prepared-statement caching, driver dispatch, row materialization. `s3.Client.PutObject(ctx, input)` (aws-sdk-go-v2) hides signing, retry, content-MD5, chunking, multipart promotion.

**Common wrong answer:** "It's any wrapper around something." A wrapper that exposes 1:1 the same shape isn't a facade — it's an adapter or a proxy. A facade *narrows* the surface.

**Follow-up:** Name three facades in the stdlib.

> `*http.Client` (hides `Transport`, `RoundTripper`, dialers, connection pool). `*sql.DB` (hides drivers, connection pool, prepared statements). `*template.Template` (hides parsing, AST nodes, function maps, execution context). Each gives the caller a few verbs while orchestrating many subsystems.

---

### Q2. What's the difference between Facade and Adapter?

**Answer:** They serve different needs:

- **Adapter** translates *shape*. You have `OldAPI` and you need `NewAPI`; the adapter implements `NewAPI` by calling `OldAPI`. The number of underlying objects stays the same; only the surface changes.
- **Facade** reduces *count*. You have ten cooperating types and the caller only wants to perform one workflow; the facade exposes one method that orchestrates the ten.

A telling test: if you remove the facade, does the caller need to make multiple, sequenced calls to multiple objects? If yes — facade. If they'd just call one differently-shaped method on one object — adapter.

```go
// Adapter: same number of moving parts, different shape.
type StripeAdapter struct{ raw *stripe.Client }
func (a *StripeAdapter) Charge(amount Money) error { /* translate to stripe.ChargeParams */ }

// Facade: orchestrates many parts, one verb.
type PaymentService struct{
    stripe   *stripe.Client
    audit    *audit.Logger
    riskScan *risk.Scanner
    notify   *notify.Mailer
}
func (s *PaymentService) Charge(ctx context.Context, in ChargeRequest) (*Receipt, error) { ... }
```

---

### Q3. What's the difference between Facade and Proxy?

**Answer:** Direction of effort:

- **Proxy** controls *access* to a single subject. It implements the same interface as the subject, intercepting calls (caching, lazy-loading, auth, rate-limiting). One subject in, one interface out, same shape.
- **Facade** simplifies *use* of many subjects. It doesn't preserve the underlying interfaces; it presents a brand new, narrower interface that hides the multiplicity.

```go
// Proxy: same interface, intercepts.
type CachingDB struct{ inner DB; cache Cache }
func (p *CachingDB) Get(k string) (Value, error) { /* check cache, defer to inner */ }

// Facade: new interface, hides many objects.
type Storage struct{ db *sql.DB; cache *redis.Client; cdn *cdn.Client }
func (s *Storage) Read(key string) ([]byte, error) { /* orchestrate cdn → cache → db */ }
```

A useful slogan: a *proxy* has the same shape as what it wraps; a *facade* doesn't. If your "facade" matches the underlying interface 1:1, it's a proxy or an adapter.

---

### Q4. Show me the simplest facade.

**Answer:**

```go
// Subsystem types (would normally live in separate packages).
type userRepo  struct{ db *sql.DB }
type passwords struct{ /* bcrypt config */ }
type sessions  struct{ store sessionStore }

// Facade.
type Auth struct {
    users  *userRepo
    pw     *passwords
    sess   *sessions
}

func NewAuth(db *sql.DB, store sessionStore) *Auth {
    return &Auth{
        users: &userRepo{db: db},
        pw:    &passwords{},
        sess:  &sessions{store: store},
    }
}

// One verb the caller cares about. Orchestrates three subsystems.
func (a *Auth) Login(ctx context.Context, email, password string) (string, error) {
    u, err := a.users.find(ctx, email)
    if err != nil { return "", err }
    if !a.pw.verify(password, u.Hash) { return "", ErrBadCreds }
    return a.sess.create(ctx, u.ID)
}
```

The facade is the package's public type. `userRepo`, `passwords`, `sessions` are unexported — the caller never names them. That's the point: the caller imports `auth`, sees `Auth.Login`, and never learns the internals.

**Junior signal:** Knowing the subsystems can stay unexported. If everything's exported, the facade is leaking.

---

### Q5. Why does `*http.Client` qualify as a facade?

**Answer:** Look at what one line orchestrates:

```go
resp, err := http.Get("https://api.example.com/v1/users")
```

`http.Get` calls `http.DefaultClient.Get`, which calls `Do`, which:

1. Resolves DNS via the configured `Dialer`.
2. Opens a TCP connection (or pulls one from the keep-alive pool).
3. Performs TLS handshake if HTTPS.
4. Negotiates HTTP/2 if both sides support it.
5. Writes request headers, applies cookies from the jar.
6. Streams the body if non-nil.
7. Reads the status line and headers.
8. Follows redirects per `Client.CheckRedirect`.
9. Returns `(*Response, error)`.

The caller sees one verb. The subsystem (`Transport`, `RoundTripper`, `Dialer`, `tls.Config`, `cookiejar.Jar`, redirect policy) is hidden but customizable. That's the textbook facade: simple default, deep escape hatch.

**Follow-up:** How does `*http.Client` allow customization without leaking the subsystem?

> Through composition. `Client.Transport` is an `http.RoundTripper` interface. The default is `http.DefaultTransport`. Advanced users supply their own — adding retries, metrics, custom dialers — without the facade exposing its inner types. The escape hatch is a single interface field; the facade stays narrow.

---

### Q6. What does `*sql.DB` hide?

**Answer:** A *lot*:

- **Connection pooling.** `sql.DB` manages a pool of `driver.Conn` instances. The caller never thinks about checking out or returning a connection.
- **Driver dispatch.** `sql.Open("postgres", dsn)` routes through a driver registry. The caller's code is driver-agnostic above the DSN.
- **Prepared-statement caching.** Repeated `db.QueryContext(ctx, "SELECT ...")` calls cache the compiled statement on the connection.
- **Transaction lifecycle.** `db.BeginTx` returns a `*sql.Tx` that pins a connection; commit/rollback returns it to the pool.
- **Context cancellation.** Each `*Context` variant wires the context into the driver call so cancellation works end-to-end.
- **Result-set materialization.** `Rows.Scan` converts driver-typed values into Go-typed destinations, handling NULLs, byte slices, time conversions.

The caller writes `db.QueryContext(ctx, q, args...)` and gets `*Rows`. Behind that one call sit five subsystems.

**Junior signal:** Knowing `sql.Open` doesn't actually connect — it just validates the driver name. The first connection happens lazily, when the pool needs it. That's a deliberate facade choice: cheap construction, lazy expensive work.

---

### Q7. What's wrong with this "facade"?

```go
type Storage struct {
    DB    *sql.DB
    Cache *redis.Client
    CDN   *cdn.Client
}

func NewStorage(db *sql.DB, cache *redis.Client, cdn *cdn.Client) *Storage {
    return &Storage{DB: db, Cache: cache, CDN: cdn}
}
```

**Answer:** Two structural problems:

1. **Nothing is hidden.** All three fields are exported. Callers reach in and call `s.DB.Query(...)` directly, bypassing the facade. The facade adds no value; it's a struct that holds three things.
2. **No verbs.** A facade is defined by the *methods* it exposes, not the fields. If `Storage` has no methods, there's no orchestration — it's a holder, not a facade.

**Fix:**

```go
type Storage struct {
    db    *sql.DB
    cache *redis.Client
    cdn   *cdn.Client
}

func NewStorage(db *sql.DB, cache *redis.Client, cdn *cdn.Client) *Storage {
    return &Storage{db: db, cache: cache, cdn: cdn}
}

// Verbs that orchestrate the subsystems.
func (s *Storage) Read(ctx context.Context, key string) ([]byte, error) { ... }
func (s *Storage) Write(ctx context.Context, key string, data []byte) error { ... }
func (s *Storage) Delete(ctx context.Context, key string) error { ... }
```

Now the caller imports `storage` and calls `s.Read(ctx, k)`. They never see `*sql.DB`, `*redis.Client`, or `*cdn.Client`. That's a facade.

---

### Q8. Should a facade return concrete types or interfaces?

**Answer:** The facade itself is usually a *concrete type* — a struct with methods. The thing it returns from its methods depends on what the caller does with it:

- **Return concrete types** when the caller will use methods specific to that type. `Storage.Read` returns `[]byte`, not `io.Reader`.
- **Return interfaces** when the caller should depend only on a narrow contract. `Auth.Login` might return a `Session` interface so the implementation can evolve.

The classic Go advice "accept interfaces, return structs" applies to *most* facade methods. The exception: when the facade is intentionally a substitution point for tests, expose it via an interface its callers depend on.

```go
// The facade is concrete.
type Auth struct{ /* fields */ }
func (a *Auth) Login(ctx context.Context, email, pw string) (*Session, error) { ... }

// Callers depend on an interface they define.
type AuthService interface {
    Login(ctx context.Context, email, pw string) (*Session, error)
}
// (interface defined in the *caller's* package, not in auth)
```

**Wrong answer:** "Always return an interface from the facade." Premature. Define the interface where it's consumed, not where it's produced.

---

### Q9. What does `aws-sdk-go-v2` show us about facades?

**Answer:** Each AWS service client (`s3.Client`, `dynamodb.Client`, `sqs.Client`) is a facade over:

- A signed-request builder (SigV4).
- An HTTP transport configured with retries and timeouts.
- A middleware stack (request building, serialization, signing, deserialization, error mapping).
- Endpoint resolution (region → URL).
- Pagination helpers (`NewListObjectsV2Paginator`).

The caller writes `s3.PutObject(ctx, &s3.PutObjectInput{...})` and gets `*s3.PutObjectOutput`. Behind that single call: middleware composition, retries with jittered backoff, request signing, response parsing, error categorization.

Key design choices worth noting:

- **Options for customization.** `s3.NewFromConfig(cfg, func(o *s3.Options) { o.Retryer = ... })` — the facade has an extensive options struct for tuning without exposing internals.
- **Per-call options.** Each `PutObject(ctx, in, optFns ...func(*Options))` accepts per-call overrides. Default behavior comes from the client; rare overrides come per-call.
- **Middleware-based extension.** Advanced users insert middleware steps. The facade exposes the middleware *stack* as the escape hatch, not the internal types.

**Lesson:** A real-world facade has tiered access. Default API for 90% of callers, options struct for 9%, middleware/transport for 1%. Hide the rest.

---

### Q10. Is `context.Context` a facade?

**Answer:** Not in the GoF sense, but it's instructive. `context.Context` is a *unified interface* over four otherwise separate concerns: deadlines, cancellation signals, request-scoped values, and parent-child propagation. Callers learn one type and get all four behaviors. By that yardstick, it's facade-flavored.

More precisely, `context.Context` is an interface, not a struct, so it's not a classic facade. But the *pattern* — unify multiple cooperating concerns behind one ergonomic API — is the same idea.

**Junior signal:** Spotting that "facade" is a description of intent, not a Go-specific construct. The pattern shows up wherever a designer chose to narrow a surface deliberately.

---

## 4. Middle questions

### Q1. Walk me through designing an SDK facade.

**Answer:** Six pieces, in order:

1. **The use case the SDK exists for.** What workflow do callers want? `PutObject`, `Query`, `SendMessage`. The verbs come first.
2. **The facade type.** A struct (`Client`) holding the configured subsystems (transport, signer, retryer, middleware).
3. **The constructor.** `NewClient(cfg, opts ...func(*Options)) *Client`. Cheap — no I/O. Validates config; lazy-connects on first use.
4. **Per-method options.** Each method takes `optFns ...func(*Options)` for per-call overrides (retries, timeout, endpoint).
5. **Escape hatches.** Expose the transport, the middleware stack, or a low-level method (`Do`) so power users aren't stuck.
6. **Lifecycle.** If the facade owns resources (connections, background goroutines), provide `Close(ctx) error`.

```go
type Client struct {
    options    Options
    httpClient *http.Client
    signer     *Signer
    retryer    Retryer
    mw         middleware.Stack
}

type Options struct {
    Region      string
    Credentials CredentialsProvider
    Retryer     Retryer
    HTTPClient  *http.Client
    Endpoint    string
}

func NewFromConfig(cfg Config, optFns ...func(*Options)) *Client {
    o := defaultOptions(cfg)
    for _, fn := range optFns { fn(&o) }
    return &Client{options: o /* ... */}
}

func (c *Client) PutObject(ctx context.Context, in *PutObjectInput, optFns ...func(*Options)) (*PutObjectOutput, error) {
    o := c.options
    for _, fn := range optFns { fn(&o) }
    // Build request, sign, send through middleware, deserialize response.
    return nil, nil
}
```

**Middle signal:** Mentioning the per-call options pattern. Most engineers forget callers want per-request overrides (different timeout, different region) without rebuilding the whole client.

---

### Q2. How does a facade handle errors from multiple subsystems?

**Answer:** Three strategies, depending on what the caller needs:

1. **Pass through unchanged.** Return the underlying error as-is. Simplest. Loses context — the caller can't tell if the failure came from cache, db, or CDN.

2. **Wrap with subsystem context.** `fmt.Errorf("storage: cache read: %w", err)`. Preserves the chain via `%w`; `errors.Is` and `errors.As` still work. Adds breadcrumbs.

3. **Categorize into facade-level errors.** Define `ErrNotFound`, `ErrUnavailable`, `ErrConflict` at the facade level. Map subsystem-specific errors to these. Caller depends on the facade's vocabulary, not the subsystem's.

```go
var (
    ErrNotFound    = errors.New("storage: not found")
    ErrUnavailable = errors.New("storage: unavailable")
)

func (s *Storage) Read(ctx context.Context, key string) ([]byte, error) {
    data, err := s.cache.Get(ctx, key).Bytes()
    if err == nil { return data, nil }
    if !errors.Is(err, redis.Nil) {
        // Cache failure shouldn't propagate; degrade to DB.
        s.log.Warn("cache read failed", "err", err)
    }

    data, err = s.db.read(ctx, key)
    if err != nil {
        if errors.Is(err, sql.ErrNoRows) {
            return nil, ErrNotFound
        }
        return nil, fmt.Errorf("storage: db read: %w", err)
    }
    return data, nil
}
```

**Middle signal:** Knowing when *not* to map. If the caller might want to inspect the underlying error (retryable? authentication problem?), preserve it via `%w`. Mapping to opaque facade errors is hostile to debugging.

---

### Q3. The "thin facade" anti-pattern — recognize and refactor.

**Prompt:** Look at this code. What's wrong?

```go
type CacheFacade struct{ r *redis.Client }

func (c *CacheFacade) Get(ctx context.Context, k string) (string, error) {
    return c.r.Get(ctx, k).Result()
}
func (c *CacheFacade) Set(ctx context.Context, k, v string, ttl time.Duration) error {
    return c.r.Set(ctx, k, v, ttl).Err()
}
```

**Answer:** Two problems:

1. **Not a facade — it's a thin pass-through.** `CacheFacade.Get` is the same shape as `redis.Client.Get`. There's no orchestration, no simplification, no hidden complexity. It's a wrapper that adds an unnecessary type.

2. **Over-abstraction without a use case.** What is `CacheFacade` for? If it's to allow swapping Redis for Memcached, the caller defines the interface where it's *used*, not here. If it's to add metrics, that's a Decorator, not a facade.

**When the same code *would* be a facade:**

```go
type Cache struct{ r *redis.Client; serializer Serializer; locker *redislock.Client }

func (c *Cache) Get(ctx context.Context, k string, dst any) error {
    raw, err := c.r.Get(ctx, k).Bytes()
    if err != nil { return err }
    return c.serializer.Decode(raw, dst)
}

func (c *Cache) GetOrLoad(ctx context.Context, k string, dst any, load func() (any, error)) error {
    // Try cache; on miss, take a distributed lock to avoid thundering herd;
    // load from source; serialize; store; release lock.
    ...
}
```

Now it's a facade: it orchestrates Redis, serialization, and distributed locking; the caller writes one line.

---

### Q4. How does a facade interact with `context.Context`?

**Answer:** Every method that touches the subsystem should take a `context.Context`. The facade doesn't store a context; it forwards the one passed per call. Reasons:

- The subsystem (DB, HTTP) needs the context for cancellation and deadlines.
- The caller controls request scope; the facade shouldn't override.
- Tracing/logging/metrics extracted from the context propagate through the call chain.

```go
// Right.
func (a *Auth) Login(ctx context.Context, email, pw string) (*Session, error) { ... }

// Wrong — context in the struct.
type Auth struct{ ctx context.Context; ... }
func NewAuth(ctx context.Context, ...) *Auth { ... }
```

**Middle signal:** Spotting the "context in struct" antipattern and explaining why it's wrong (ownership, lifecycle, parallel requests, can't override per call). Same rule as factories: take context per call, not at construction.

---

### Q5. How do you make a facade testable without exposing its internals?

**Answer:** Three approaches, increasingly invasive:

1. **Inject the dependencies into the facade constructor.** Each subsystem is taken as a parameter — `*sql.DB`, `*redis.Client`, `*s3.Client`. Tests pass fakes. The facade itself stays concrete.

2. **Define an interface in the caller.** The caller depends on `type Storage interface { Read(...); Write(...) }`; production wires the real facade; tests pass a fake that satisfies the interface. The facade itself doesn't need to be an interface.

3. **Expose seam interfaces inside the facade.** Replace `*redis.Client` with `type Cache interface { Get/Set }` so the facade depends on the seam, not the concrete client. Useful but verbose.

```go
// auth package: concrete facade.
type Auth struct{ users *userRepo; pw *passwords }
func (a *Auth) Login(ctx context.Context, email, pw string) (*Session, error) { ... }

// handlers package: caller defines its own interface.
type Authenticator interface {
    Login(ctx context.Context, email, pw string) (*Session, error)
}
type Handler struct{ auth Authenticator }
// Production wires *Auth; tests wire a fake satisfying Authenticator.
```

**Middle signal:** Recommending approach 2 over approach 3. Defining an interface where it's used avoids the "interface in the producer package" antipattern that bloats facade packages.

---

### Q6. How does the facade pattern interact with lazy initialization?

**Answer:** A well-built facade is *cheap to construct* (no I/O) and *expensive on first use*. The facade hides the laziness:

```go
type S3Client struct {
    options Options
    once    sync.Once
    creds   aws.Credentials
    err     error
}

func NewS3Client(opts Options) *S3Client { return &S3Client{options: opts} }

func (c *S3Client) ensureCreds(ctx context.Context) error {
    c.once.Do(func() { c.creds, c.err = c.options.CredentialsProvider.Retrieve(ctx) })
    return c.err
}

func (c *S3Client) PutObject(ctx context.Context, in *PutObjectInput) (*PutObjectOutput, error) {
    if err := c.ensureCreds(ctx); err != nil { return nil, err }
    // Sign, send, decode.
}
```

`NewS3Client` returns immediately. The first `PutObject` triggers credential retrieval (which may fetch from IMDS, an STS call, or a file). Subsequent calls reuse the cached credentials. The caller never sees `sync.Once`, never sees the credential provider, never thinks about lazy init.

`sql.Open` is the same pattern: cheap, validates the driver name; first `Query` or `Ping` triggers connection.

**Follow-up:** What if first-use fails and the caller wants to retry?

> `sync.Once` caches success and failure equally. For retryable failures (transient network), replace `sync.Once` with a mutex + state machine that retries on subsequent calls. Or expose an explicit `Refresh(ctx)` method.

---

### Q7. What's the difference between a facade and a service object?

**Answer:** Significant overlap, but distinct emphasis:

- **Facade** is a structural pattern. The point is *the surface*: one ergonomic interface over many subsystems.
- **Service object** is a domain-modeling pattern. The point is *the behavior*: a coordinator for a business workflow.

In practice, a service object is often *implemented* as a facade. `PaymentService.Charge` is a service object (domain verb) implemented as a facade (orchestrates Stripe, audit, risk, notify).

The distinction matters for naming. Don't call your domain coordinator "PaymentFacade" — that's structural language. Call it `PaymentService`. The fact that internally it's a facade is an implementation detail.

**Middle signal:** Resisting the urge to overload "facade" as a name suffix. `OrderFacade`, `UserFacade`, `BillingFacade` is a code smell — it suggests the developer is naming by pattern, not by domain.

---

### Q8. Show me a facade with an escape hatch.

**Answer:** A good facade has a *default* API for common cases and an *escape hatch* for advanced ones. Three escape-hatch shapes:

1. **Exposed transport/middleware.** `*http.Client` exposes `Transport`. Power users replace it.
2. **Per-call options.** AWS SDK clients take `optFns ...func(*Options)` on each call.
3. **A low-level method.** `*http.Client.Do(*Request)` is the escape hatch behind `Get`/`Post`/`Head`.

```go
type Storage struct {
    db    *sql.DB
    cache *redis.Client
    log   *slog.Logger
}

// Default API: simple, common case.
func (s *Storage) Read(ctx context.Context, key string) ([]byte, error) { ... }

// Escape hatch: caller wants to bypass cache, or read a specific version.
type ReadOptions struct {
    BypassCache bool
    Version     int64
}
func (s *Storage) ReadWith(ctx context.Context, key string, opts ReadOptions) ([]byte, error) { ... }

// Bottom-level escape hatch: caller really needs the raw connection.
func (s *Storage) DB() *sql.DB { return s.db }
```

**Middle signal:** Knowing that exposing `DB()` is a *deliberate* design choice with a cost. It leaks the underlying type; future migration to a different DB breaks every caller of `DB()`. Use sparingly, and only for cases the facade truly can't cover.

---

### Q9. How do facades interact with the "accept interfaces, return structs" rule?

**Answer:** Smoothly, with one twist:

- **Accept interfaces** — the facade's constructor takes interfaces for its dependencies. `NewAuth(users UserRepo, sessions SessionStore)`. Tests pass fakes; production passes real implementations.
- **Return structs** — the facade itself is a concrete struct. Callers get `*Auth`, not `Authenticator`. Adding a method to `*Auth` doesn't break callers.

The twist: when *callers of the facade* want to swap it for tests, they define an interface in *their* package consuming `*Auth`. Production wires `*Auth`; tests wire a fake. The interface lives at the consumption site, not the production site.

```go
// auth package
type Auth struct{ users UserRepo; sessions SessionStore }  // accepts interfaces
func NewAuth(u UserRepo, s SessionStore) *Auth { ... }     // returns struct

// http package
type Authenticator interface { Login(...) (*Session, error) }
type LoginHandler struct{ auth Authenticator }

// production: wires *Auth into LoginHandler.auth (it satisfies Authenticator)
// tests:      wires fakeAuth into LoginHandler.auth
```

---

### Q10. What's the trade-off between one big facade and several small ones?

**Answer:**

| Aspect | One big facade | Several small facades |
|--------|----------------|------------------------|
| Discoverability | Easy — one type | Harder — caller learns multiple |
| Coupling | Higher — fields and methods accrete | Lower — each facade is focused |
| Testing | All deps required to construct | Test each facade independently |
| Evolution | Hard — touching anything affects all callers | Easier — change one without rippling |
| Cohesion | Often drops as scope grows | Higher per-facade |

A facade with 30 methods spanning auth, storage, billing, and notifications is a god-class. Split it into `Auth`, `Storage`, `Billing`, `Notifier`. Each is a small facade. Cross-cutting workflows (e.g., signup that touches all four) live in a higher-level *service* that depends on the four smaller facades.

**Middle signal:** Mentioning the "depth of nesting" rule. A facade should be at most two layers thick. If `Service.X` calls `Facade.Y` which calls `SubFacade.Z`, you've built a turducken. Flatten.

---

## 5. Senior questions

### Q1. How do you design a facade API for an SDK?

**Answer:** Six principles, drawn from production SDK design (`aws-sdk-go-v2`, `cloud.google.com/go`):

1. **Verb-oriented, not noun-oriented.** Name methods for what the caller wants done — `PutObject`, `ListBuckets` — not for what objects exist underneath.
2. **Default + options + middleware.** Default API is one positional input. Options struct for tuning. Middleware/transport stack for advanced extension. Three tiers, increasing in power and decreasing in audience size.
3. **No I/O in the constructor.** `NewFromConfig` is cheap; first method call does the work. Tests construct freely; CLI tools that don't make calls don't fail.
4. **Per-call options.** Each method accepts `optFns ...func(*Options)` to override per call without rebuilding the client.
5. **Stable surface.** Adding a method is non-breaking. Adding a field to an options struct (set via `func(*Options)`) is non-breaking. Changing a method signature is breaking — design like you're stuck with it for five years.
6. **Lifecycle if needed.** If the facade owns goroutines or pooled connections, expose `Close(ctx) error`. Document the lifecycle.

**Senior signal:** Articulating that the SDK facade is also a *versioning contract*. Once shipped, every method, every options field, every default behavior is something callers will depend on. Design for the migration you'll force on them in five years.

---

### Q2. Refactor a god-class into a layered facade — walk me through it.

**Prompt:** "You inherit a `UserService` with 47 methods covering auth, profile, billing, notifications, audit logging, and analytics. How do you refactor?"

**Answer:** Six steps:

1. **Map the methods by cohesion.** Group by domain concept: 8 auth methods, 12 profile, 7 billing, 9 notification, 6 audit, 5 analytics.
2. **Extract small facades per group.** `AuthService`, `ProfileService`, `BillingService`, `NotificationService`, `AuditLogger`, `Analytics`. Each is constructed with its own dependencies.
3. **Identify cross-cutting workflows.** "User signup" touches Auth, Profile, Notification. Don't put it on any single facade. Create a higher-level `Onboarding` coordinator that depends on the small facades.
4. **Move shared state out.** Many god-classes have a shared `*sql.DB` field. Pass it to each small facade's constructor; don't share via the god-class.
5. **Decompose incrementally.** Keep the old `UserService` as a delegator initially: `func (s *UserService) Login(...) { return s.auth.Login(...) }`. Migrate callers one at a time. Remove the delegator once callers are migrated.
6. **Test the seams.** Each small facade gets a unit-test suite; the coordinator gets an integration-test suite that exercises the cross-cutting workflows.

```go
// Before: god-class with 47 methods.
type UserService struct{ db *sql.DB; mail *Mailer; metrics *Metrics /* ... 12 fields */ }

// After: domain-cohesive facades + cross-cutting coordinator.
type AuthService    struct{ users UserRepo; sessions SessionStore }
type ProfileService struct{ users UserRepo; storage BlobStorage }
type BillingService struct{ stripe *stripe.Client; ledger Ledger }

type Onboarding struct{ auth *AuthService; profile *ProfileService; notify *NotificationService }
func (o *Onboarding) Signup(ctx context.Context, req SignupRequest) (*User, error) {
    // orchestrate auth.Register, profile.Create, notify.SendWelcome
}
```

**Senior signal:** Mentioning the *incremental delegator* — you don't atomically replace the god-class. You shrink it over weeks while callers migrate.

---

### Q3. How do you version a facade's API?

**Answer:** Three lanes, in order of breakage cost:

1. **Add a new method.** Always safe. Existing callers ignore the new method.
2. **Extend an options struct.** Safe if options are set via `func(*Options)` builders. Unsafe if callers construct the struct as a literal (`Options{Region: "..."}`) and a new required field is added.
3. **Change a method signature.** Always breaking. The only safe path is a new method name or a major version bump.

For SDKs published as Go modules:

- Minor versions add methods and options. Patch fixes bugs. Major versions allow signature changes (`v2`).
- Deprecated methods stay for one major version with `// Deprecated: use NewMethod instead` comments. Linters flag callers.
- Document a *stability contract* in the README: which fields are public surface, which are subject to change.

**Senior signal:** Knowing that returning a struct (not interface) from a facade method is a *versioning constraint*. Adding a method to the returned struct is safe; adding a method to an interface breaks every implementor. Facades returning structs evolve more freely than facades returning interfaces.

---

### Q4. The facade has a concurrency bug — find it.

```go
type Cache struct {
    redis *redis.Client
    local map[string][]byte
}

func NewCache(r *redis.Client) *Cache {
    return &Cache{redis: r, local: map[string][]byte{}}
}

func (c *Cache) Get(ctx context.Context, k string) ([]byte, error) {
    if v, ok := c.local[k]; ok { return v, nil }
    v, err := c.redis.Get(ctx, k).Bytes()
    if err != nil { return nil, err }
    c.local[k] = v
    return v, nil
}
```

**Answer:** Three bugs:

1. **Map concurrent access.** `c.local` is read and written from concurrent goroutines without synchronization. Go's race detector will catch it; production will crash with `concurrent map writes`.

2. **No bound on local cache.** It grows forever. Long-running services OOM.

3. **No TTL on local cache.** Stale data lives until restart even if Redis updates.

**Fix:**

```go
type Cache struct {
    redis *redis.Client
    local *lru.Cache[string, cacheEntry]  // sync, bounded, TTL via entry
    sf    singleflight.Group               // dedupe concurrent loads
}
type cacheEntry struct{ data []byte; exp time.Time }

func (c *Cache) Get(ctx context.Context, k string) ([]byte, error) {
    if e, ok := c.local.Get(k); ok && time.Now().Before(e.exp) {
        return e.data, nil
    }
    v, err, _ := c.sf.Do(k, func() (any, error) { return c.redis.Get(ctx, k).Bytes() })
    if err != nil { return nil, err }
    data := v.([]byte)
    c.local.Set(k, cacheEntry{data: data, exp: time.Now().Add(time.Minute)})
    return data, nil
}
```

**Senior signal:** Spotting all three without prompting. Map races and unbounded caches are real production bugs; `singleflight` for stampede protection shows familiarity with the subsystem the facade hides.

---

### Q5. How do you handle observability through a facade?

**Answer:** Four hooks, layered:

1. **Span around the public method.** Each public method opens a tracing span. Attributes describe the operation, not the internals.
2. **Counter/histogram on outcomes.** Increment `auth_login_total{outcome="success|invalid|error"}` and observe latency.
3. **Structured logs at boundaries.** Log on entry/exit (debug level) and on errors (warn/error). Include request IDs from context.
4. **Internal trace points.** Sub-spans for expensive subsystem calls (DB, HTTP). Helps diagnose latency without forcing the caller to instrument every layer.

```go
func (a *Auth) Login(ctx context.Context, email, pw string) (s *Session, err error) {
    ctx, span := a.tracer.Start(ctx, "Auth.Login")
    start := time.Now()
    defer func() {
        if err != nil { span.RecordError(err) }
        span.End()
        outcome := "success"
        if err != nil { outcome = classifyError(err) }
        a.metrics.LoginLatency.WithLabelValues(outcome).Observe(time.Since(start).Seconds())
    }()

    u, err := a.users.find(ctx, email)
    if err != nil               { return nil, fmt.Errorf("login: lookup: %w", err) }
    if !a.pw.verify(pw, u.Hash) { return nil, ErrBadCreds }
    return a.sess.create(ctx, u.ID)
}
```

**Senior signal:** Recommending a *middleware* approach over scattered instrumentation. If every facade method needs spans+metrics+logs, factor a generic `instrument(name, fn)` helper or wrap the facade in a Decorator that adds observability. Don't copy-paste instrumentation into every method.

---

### Q6. When is a facade the *wrong* answer?

**Answer:** Four scenarios:

1. **The subsystem is already simple.** A single-method type doesn't need a facade. Wrapping it adds layers without simplifying.

2. **Callers need fine-grained control.** A library for benchmarking or profiling subsystems shouldn't hide them — the caller wants to drive each piece independently. A facade collapses the dials the caller exists to manipulate.

3. **The facade conflates unrelated concerns.** If `OrderService.PlaceOrder` and `OrderService.SendInvoice` have no shared dependencies and no shared workflow, putting them on one facade just because they relate to orders is artificial cohesion.

4. **The "facade" leaks the subsystem types in its method signatures.** If every facade method returns `*sql.Rows` or `*redis.Cmd`, the facade isn't hiding anything — it's adding a `.` to the call chain. Either commit to a real abstraction or drop the facade.

**Senior signal:** Articulating that adding a facade is *not always* worth it. The pattern is a tool, not a virtue. Some subsystems are best used directly.

---

### Q7. How do you decide what *not* to expose through the facade?

**Answer:** Three filters, in order:

1. **What's the use case the facade exists for?** Anything orthogonal to that use case is noise. `Storage.Read` exists to read data. Exposing the underlying connection pool's metrics is a different concern — it goes on a different surface (monitoring endpoint, debug method).

2. **Will exposing it lock you into the implementation?** Returning `*sql.Rows` from the facade locks you into `database/sql`. You can never swap to `pgx` directly without breaking callers. If a method exposes a subsystem type, you've created a coupling that survives long after the convenience pays off.

3. **Will callers use it?** A real-world test: search the codebase six months after adding the method. If it has fewer than three callers, it shouldn't be on the facade. Move it to a debug helper or remove it.

```go
// Bad: leaks *sql.Rows.
func (s *Storage) Query(q string) (*sql.Rows, error) { ... }

// Better: returns a structured result the facade defines.
func (s *Storage) FindUsers(ctx context.Context, f UserFilter) ([]User, error) { ... }

// If you really need raw query escape, name it accordingly.
func (s *Storage) UnsafeQuery(ctx context.Context, q string, args ...any) (*sql.Rows, error) {
    // Documented as "use only for tests or migration scripts."
}
```

**Senior signal:** Knowing how to *name* the escape hatch. `UnsafeX`, `RawX`, `LowLevelX` signal "don't reach for this casually". The naming is part of the API contract.

---

### Q8. Facade lifecycle: how do you handle `Close`?

**Answer:** A facade owning resources (connections, goroutines, file handles) needs lifecycle management. Three concerns:

1. **Order of close.** If the facade has multiple subsystems, close in reverse construction order. Close the API surface before the underlying transport. Close goroutine consumers before their channels.

2. **Idempotency.** `Close` should be safe to call twice. Use `sync.Once` to gate the actual shutdown.

3. **Context for shutdown.** `Close(ctx context.Context) error` lets the caller bound shutdown time. After deadline, force-close.

```go
type Service struct {
    db        *sql.DB
    publisher *amqp.Publisher
    workers   *workerPool
    closeOnce sync.Once
    closeErr  error
}

func (s *Service) Close(ctx context.Context) error {
    s.closeOnce.Do(func() {
        var errs []error
        // Drain workers first — they may still publish.
        if err := s.workers.Drain(ctx); err != nil { errs = append(errs, fmt.Errorf("drain workers: %w", err)) }
        // Close publisher — flushes pending sends.
        if err := s.publisher.Close();    err != nil { errs = append(errs, fmt.Errorf("close publisher: %w", err)) }
        // Finally close DB.
        if err := s.db.Close();           err != nil { errs = append(errs, fmt.Errorf("close db: %w", err)) }
        s.closeErr = errors.Join(errs...)
    })
    return s.closeErr
}
```

**Senior signal:** Using `errors.Join` (Go 1.20+) to aggregate errors from multiple subsystems instead of returning only the first. Production debugging hates "we logged one error but three things failed".

---

### Q9. Facade plus Decorator — how do they compose?

**Answer:** A facade is the *target*; decorators wrap *around* it to add cross-cutting behavior (logging, metrics, retries, rate limiting). The facade's concrete struct doesn't know about decorators; the wiring layer composes them.

```go
// Core facade.
type Storage interface {
    Read(ctx context.Context, k string) ([]byte, error)
    Write(ctx context.Context, k string, v []byte) error
}

type storage struct{ db *sql.DB; cache *redis.Client }
func (s *storage) Read(ctx context.Context, k string) ([]byte, error) { /* real impl */ return nil, nil }

// Decorators.
type metricsStorage struct{ inner Storage; m *Metrics }
func (s *metricsStorage) Read(ctx context.Context, k string) ([]byte, error) {
    start := time.Now()
    defer func() { s.m.ReadLatency.Observe(time.Since(start).Seconds()) }()
    return s.inner.Read(ctx, k)
}

type retryStorage struct{ inner Storage; n int }
func (s *retryStorage) Read(ctx context.Context, k string) ([]byte, error) {
    var err error
    for i := 0; i < s.n; i++ {
        b, e := s.inner.Read(ctx, k)
        if e == nil               { return b, nil }
        if !isRetryable(e)        { return nil, e }
        err = e
    }
    return nil, err
}

// Wiring composes from inside out: real → retry → metrics.
func BuildStorage() Storage {
    var s Storage = &storage{ /* ... */ }
    s = &retryStorage{inner: s, n: 3}
    s = &metricsStorage{inner: s, m: metrics}
    return s
}
```

**Senior signal:** Spotting that the facade is the *innermost* layer and decorators wrap outward. The reverse — putting decorators inside the facade — fuses cross-cutting concerns with the facade's logic and prevents independent reuse.

---

### Q10. Facade in a microservice gateway — design walk-through.

**Prompt:** "We have 12 backend services. The mobile app shouldn't know about them. Design the facade."

**Answer:** Three layers:

1. **API surface (the facade).** The gateway exposes a coarse-grained REST or GraphQL API tailored to the mobile app's screens. `GET /home` returns a composite of user profile, recent activity, and recommendations — three backend calls aggregated into one response.

2. **Service clients (subsystems behind the facade).** Each backend has a typed client (`UserClient`, `ActivityClient`, `RecommendationClient`). The facade method calls all three concurrently via `errgroup.Group`, aggregates the results, and shapes them for the mobile response.

3. **Cross-cutting concerns at the edge.** Authentication, rate limiting, tracing, and request validation are middleware around the gateway, not inside the facade. The facade method only orchestrates the business workflow.

```go
type HomeFacade struct {
    users UserClient; feed ActivityClient; recos RecommendationClient
    log   *slog.Logger
}

func (h *HomeFacade) Home(ctx context.Context, userID string) (*HomeResponse, error) {
    g, gctx := errgroup.WithContext(ctx)
    var profile *UserProfile
    var feed   []ActivityItem
    var recos  []Recommendation

    // Essential — failure fails the request.
    g.Go(func() (err error) { profile, err = h.users.GetProfile(gctx, userID); return })

    // Non-essential — log on failure, return nil so g.Wait succeeds.
    g.Go(func() error {
        var err error
        if feed, err = h.feed.RecentActivity(gctx, userID, 20); err != nil {
            h.log.Warn("feed failed", "err", err)
        }
        return nil
    })
    g.Go(func() error {
        var err error
        if recos, err = h.recos.ForUser(gctx, userID, 10); err != nil {
            h.log.Warn("recos failed", "err", err)
        }
        return nil
    })

    if err := g.Wait(); err != nil { return nil, err }
    return &HomeResponse{Profile: profile, Feed: feed, Recos: recos}, nil
}
```

**Senior signal:** Mentioning *soft-failures* for non-essential subsystems. The home screen survives without recommendations; it doesn't survive without the user profile. The facade encodes that policy.

---

## 6. Live coding challenges

### Challenge 1: Build an SDK facade

**Prompt:** Design a minimal SDK client for a fictional "Orderly" service. It needs to:

- Be cheap to construct (no I/O).
- Expose `CreateOrder(ctx, input)`, `GetOrder(ctx, id)`, `CancelOrder(ctx, id)`.
- Support per-call options for retries and timeout overrides.
- Validate input before sending.
- Wrap underlying errors with subsystem context.
- Be safe to call concurrently.

**What's being tested:** SDK facade design — constructor, per-call options, error wrapping, concurrency safety.

**Solution:**

```go
package orderly

type Client struct {
    options Options
    http    *http.Client
}

type Options struct {
    BaseURL    string
    APIKey     string
    Retries    int
    HTTPClient *http.Client
}

type CallOptions struct {
    Retries int
    Timeout time.Duration
}

func New(opts Options) (*Client, error) {
    if opts.BaseURL == "" { return nil, errors.New("orderly: BaseURL required") }
    if opts.APIKey == "" { return nil, errors.New("orderly: APIKey required") }
    if opts.HTTPClient == nil {
        opts.HTTPClient = &http.Client{Timeout: 30 * time.Second}
    }
    return &Client{options: opts, http: opts.HTTPClient}, nil
}

func (c *Client) CreateOrder(ctx context.Context, in *CreateOrderInput, optFns ...func(*CallOptions)) (*Order, error) {
    if in == nil || in.CustomerID == "" || len(in.Items) == 0 {
        return nil, errors.New("orderly: input invalid")
    }
    callOpts := c.callOptions(optFns)
    var out Order
    if err := c.do(ctx, http.MethodPost, "/orders", in, &out, callOpts); err != nil {
        return nil, fmt.Errorf("orderly: create order: %w", err)
    }
    return &out, nil
}

func (c *Client) GetOrder(ctx context.Context, id string, optFns ...func(*CallOptions)) (*Order, error) {
    if id == "" { return nil, errors.New("orderly: id required") }
    var out Order
    if err := c.do(ctx, http.MethodGet, "/orders/"+id, nil, &out, c.callOptions(optFns)); err != nil {
        return nil, fmt.Errorf("orderly: get order %q: %w", id, err)
    }
    return &out, nil
}

func (c *Client) CancelOrder(ctx context.Context, id string, optFns ...func(*CallOptions)) error {
    if id == "" { return errors.New("orderly: id required") }
    if err := c.do(ctx, http.MethodDelete, "/orders/"+id, nil, nil, c.callOptions(optFns)); err != nil {
        return fmt.Errorf("orderly: cancel order %q: %w", id, err)
    }
    return nil
}

func (c *Client) do(ctx context.Context, method, path string, in, out any, opts CallOptions) error {
    if opts.Timeout > 0 {
        var cancel context.CancelFunc
        ctx, cancel = context.WithTimeout(ctx, opts.Timeout)
        defer cancel()
    }
    var lastErr error
    for attempt := 0; attempt <= opts.Retries; attempt++ {
        if attempt > 0 {
            select {
            case <-ctx.Done(): return ctx.Err()
            case <-time.After(time.Duration(attempt*attempt) * 100 * time.Millisecond):
            }
        }
        if err := c.send(ctx, method, path, in, out); err != nil {
            if isRetryable(err) { lastErr = err; continue }
            return err
        }
        return nil
    }
    return lastErr
}
```

**Follow-ups:**

- Where would you add retries? *Inside `do`, with exponential backoff. Don't let retries leak into method bodies.*
- How would you add request signing? *Middleware around `send` — a `RoundTripper` configured on `http.Client`. The facade doesn't change.*
- How do you test? *Inject a custom `http.Client` with a `RoundTripper` that returns canned responses.*

---

### Challenge 2: Refactor a god-class into a facade

**Prompt:** Refactor this god-class into a clean facade + small subsystem types.

```go
type UserService struct {
    db    *sql.DB
    mail  *smtp.Client
    cache *redis.Client
}

func (s *UserService) Register(ctx context.Context, email, password string) (int64, error) {
    // 1) validate email format
    // 2) check uniqueness in db
    // 3) hash password with bcrypt
    // 4) insert into users table
    // 5) generate email verification token
    // 6) store token in cache with TTL
    // 7) send verification email
    // 8) emit metric "user.registered"
    // ... 80 lines
}
```

**What's being tested:** Decomposition, dependency injection, error handling across subsystems.

**Solution:**

```go
// Subsystem types — small, focused, testable, unexported.
type userRepo  struct{ db *sql.DB }
type tokens    struct{ cache *redis.Client }
type mailer    struct{ smtp *smtp.Client }
type passwords struct{}

func (r *userRepo) emailExists(ctx context.Context, email string) (bool, error) { ... }
func (r *userRepo) insert(ctx context.Context, u *User) (int64, error)          { ... }
func (t *tokens) issue(ctx context.Context, userID int64, kind string, ttl time.Duration) (string, error) { ... }
func (m *mailer) sendVerification(ctx context.Context, email, token string) error { ... }
func (p *passwords) hash(plain string) (string, error) { ... }

// Facade — orchestrates the subsystems.
type Registration struct {
    users  *userRepo
    tokens *tokens
    mailer *mailer
    pw     *passwords
    log    *slog.Logger
}

func NewRegistration(db *sql.DB, cache *redis.Client, smtpClient *smtp.Client, log *slog.Logger) *Registration {
    return &Registration{
        users: &userRepo{db: db}, tokens: &tokens{cache: cache},
        mailer: &mailer{smtp: smtpClient}, pw: &passwords{}, log: log,
    }
}

var (
    ErrInvalidEmail = errors.New("registration: invalid email")
    ErrEmailExists  = errors.New("registration: email already registered")
    ErrWeakPassword = errors.New("registration: password too weak")
)

func (r *Registration) Register(ctx context.Context, email, password string) (int64, error) {
    if !isValidEmail(email) { return 0, ErrInvalidEmail }
    if len(password) < 8    { return 0, ErrWeakPassword }

    exists, err := r.users.emailExists(ctx, email)
    if err != nil  { return 0, fmt.Errorf("registration: check uniqueness: %w", err) }
    if exists      { return 0, ErrEmailExists }

    hash, err := r.pw.hash(password)
    if err != nil { return 0, fmt.Errorf("registration: hash password: %w", err) }

    id, err := r.users.insert(ctx, &User{Email: email, PasswordHash: hash})
    if err != nil { return 0, fmt.Errorf("registration: insert user: %w", err) }

    token, err := r.tokens.issue(ctx, id, "verify", 24*time.Hour)
    if err != nil {
        // Soft-fail: user can re-request verification.
        r.log.Warn("registration: issue token failed", "user_id", id, "err", err)
        return id, nil
    }
    if err := r.mailer.sendVerification(ctx, email, token); err != nil {
        r.log.Warn("registration: send verification failed", "user_id", id, "err", err)
    }
    return id, nil
}
```

**Discussion:**

- Subsystem types are unexported (`userRepo`, `tokens`, `mailer`). The package's public surface is `Registration` plus its errors.
- Each subsystem has one responsibility. Tests instantiate each independently.
- Errors at the *registration level* (invalid email, weak password, duplicate) are sentinel errors. Errors at the subsystem level (DB failure, mail failure) are wrapped with `%w`.
- Soft failures (token issuance, email send) log and continue. The user is registered; verification is async.

**Follow-up:** What if mail failures should be retried via a queue?

> Add a `queue` subsystem. On mail-send failure, enqueue a retry job. The facade method stays the same; the failure mode shifts from "logged warning" to "enqueued for retry". Caller sees no change.

---

### Challenge 3: Lifecycle-managed facade

**Prompt:** Build a `Worker` facade that owns a worker pool, a publisher, and a database connection. Provide `Start(ctx)` and `Close(ctx)` methods. Closing should be idempotent, drain in-flight work, and aggregate errors.

**What's being tested:** Lifecycle management, idempotent close, error aggregation, ordered shutdown.

**Solution:**

```go
type Worker struct {
    db   *sql.DB
    pool Pool
    pub  Publisher
    log  *slog.Logger

    startOnce sync.Once
    closeOnce sync.Once
    closeErr  error
    started   bool
}

func New(db *sql.DB, pool Pool, pub Publisher, log *slog.Logger) *Worker {
    return &Worker{db: db, pool: pool, pub: pub, log: log}
}

func (w *Worker) Start(ctx context.Context) error {
    var startErr error
    w.startOnce.Do(func() {
        if err := w.db.PingContext(ctx); err != nil {
            startErr = fmt.Errorf("worker: db ping: %w", err)
            return
        }
        w.started = true
    })
    if startErr != nil { return startErr }
    if !w.started { return errors.New("worker: not started") }
    return nil
}

func (w *Worker) Submit(ctx context.Context, j Job) error {
    if !w.started { return errors.New("worker: not started") }
    return w.pool.Submit(j)
}

func (w *Worker) Close(ctx context.Context) error {
    w.closeOnce.Do(func() {
        var errs []error
        // Drain pool first — workers may still publish.
        if err := w.pool.Drain(ctx); err != nil {
            errs = append(errs, fmt.Errorf("worker: drain pool: %w", err))
        }
        // Close publisher — flushes pending sends.
        if err := w.pub.Close(); err != nil {
            errs = append(errs, fmt.Errorf("worker: close publisher: %w", err))
        }
        // Close DB last.
        if err := w.db.Close(); err != nil {
            errs = append(errs, fmt.Errorf("worker: close db: %w", err))
        }
        w.closeErr = errors.Join(errs...)
    })
    return w.closeErr
}
```

**Discussion:**

- `sync.Once` for both `Start` and `Close`. Caller can invoke either repeatedly; only the first call does work.
- Close in *reverse* dependency order. Pool drains first because workers may publish; publisher flushes; then DB closes.
- `errors.Join` aggregates failures so the caller sees *all* problems, not just the first.
- `started` flag prevents `Submit` before `Start`.

**Follow-ups:**

- What about a stuck drain that exceeds `ctx`? *Drain should respect `ctx.Done()` and return early; the remaining work is the caller's problem to log.*
- How would you support graceful vs forceful close? *Two methods: `Close(ctx)` graceful, `Kill()` immediate. Or one method with a `Forceful bool` option.*

---

### Challenge 4: Lazy facade subsystems

**Prompt:** Build a `CloudClient` facade for AWS S3, DynamoDB, and SQS. The clients are expensive to construct (credentials lookup). Most callers use only one. Initialize each subsystem lazily on first access.

**What's being tested:** Lazy initialization, thread safety, per-subsystem error caching.

**Solution:**

```go
type CloudClient struct {
    cfg aws.Config

    s3Once   sync.Once; s3Client  *s3.Client;       s3Err  error
    ddbOnce  sync.Once; ddbClient *dynamodb.Client; ddbErr error
    sqsOnce  sync.Once; sqsClient *sqs.Client;      sqsErr error
}

func New(cfg aws.Config) *CloudClient { return &CloudClient{cfg: cfg} }

func (c *CloudClient) S3() (*s3.Client, error) {
    c.s3Once.Do(func() { c.s3Client = s3.NewFromConfig(c.cfg) })
    return c.s3Client, c.s3Err
}
func (c *CloudClient) DynamoDB() (*dynamodb.Client, error) {
    c.ddbOnce.Do(func() { c.ddbClient = dynamodb.NewFromConfig(c.cfg) })
    return c.ddbClient, c.ddbErr
}
func (c *CloudClient) SQS() (*sqs.Client, error) {
    c.sqsOnce.Do(func() { c.sqsClient = sqs.NewFromConfig(c.cfg) })
    return c.sqsClient, c.sqsErr
}

// Higher-level facade method orchestrating multiple subsystems.
func (c *CloudClient) ArchiveAndNotify(ctx context.Context, bucket, key, queueURL string) error {
    s3c,  err := c.S3();  if err != nil { return fmt.Errorf("cloud: s3: %w", err) }
    sqsc, err := c.SQS(); if err != nil { return fmt.Errorf("cloud: sqs: %w", err) }

    if _, err := s3c.PutObject(ctx, &s3.PutObjectInput{Bucket: &bucket, Key: &key, Body: ...}); err != nil {
        return fmt.Errorf("cloud: put object: %w", err)
    }
    if _, err := sqsc.SendMessage(ctx, &sqs.SendMessageInput{
        QueueUrl: &queueURL, MessageBody: aws.String("uploaded:"+key),
    }); err != nil {
        return fmt.Errorf("cloud: send message: %w", err)
    }
    return nil
}
```

**Discussion:**

- Each subsystem gets its own `sync.Once`. A caller using only S3 never initializes DynamoDB or SQS.
- Error caching: if `s3.NewFromConfig` ever returned an error, it would be cached in `s3Err`. (In `aws-sdk-go-v2`, `NewFromConfig` is cheap and doesn't return error; the lazy pattern is more relevant for clients that *do* perform setup work.)
- Higher-level facade methods (`ArchiveAndNotify`) compose subsystem accessors.
- Subsystem accessors are *exported* — callers can drop down to `s3.Client` for advanced usage. That's the escape hatch.

**Follow-ups:**

- What if the user wants to override the S3 client (e.g., for testing)? *Add `SetS3Client(c *s3.Client)` or accept the clients in the constructor. `sync.Once` makes overrides after first access impossible; design for that.*
- What about the case where `s3.NewFromConfig` *does* do I/O? *Wrap the call in a function that takes context; pass context through the accessor: `S3(ctx)`.*

---

### Challenge 5: Error aggregation facade

**Prompt:** Build a `HealthChecker` facade that probes 5 subsystems (DB, cache, queue, downstream API, file storage) in parallel, aggregates results, and returns a structured health report. Slow probes shouldn't block fast ones; total runtime should be bounded by the slowest probe.

**What's being tested:** Concurrent orchestration with `errgroup`, structured error aggregation, deadline propagation.

**Solution:**

```go
type Status string

const (
    StatusHealthy   Status = "healthy"
    StatusDegraded  Status = "degraded"
    StatusUnhealthy Status = "unhealthy"
)

type Result struct {
    Name    string        `json:"name"`
    Status  Status        `json:"status"`
    Latency time.Duration `json:"latency_ms"`
    Error   string        `json:"error,omitempty"`
}

type Report struct {
    Overall Status   `json:"overall"`
    Results []Result `json:"results"`
}

type Probe interface {
    Name() string
    Check(ctx context.Context) error
}

type HealthChecker struct {
    probes  []Probe
    timeout time.Duration
}

func (h *HealthChecker) Run(ctx context.Context) *Report {
    ctx, cancel := context.WithTimeout(ctx, h.timeout)
    defer cancel()

    results := make([]Result, len(h.probes))
    var wg sync.WaitGroup
    for i, p := range h.probes {
        wg.Add(1)
        go func(i int, p Probe) {
            defer wg.Done()
            start := time.Now()
            err := p.Check(ctx)
            r := Result{Name: p.Name(), Latency: time.Since(start), Status: StatusHealthy}
            if err != nil { r.Status = StatusUnhealthy; r.Error = err.Error() }
            results[i] = r
        }(i, p)
    }
    wg.Wait()
    return &Report{Overall: overall(results), Results: results}
}

func overall(results []Result) Status {
    unhealthy := 0
    for _, r := range results {
        if r.Status == StatusUnhealthy { unhealthy++ }
    }
    if unhealthy == 0           { return StatusHealthy }
    if unhealthy < len(results) { return StatusDegraded }
    return StatusUnhealthy
}
```

**Discussion:**

- Probes run concurrently via `sync.WaitGroup`. A slow probe doesn't block fast ones; total time = max probe time.
- Per-probe results are captured by *index* in a pre-allocated slice — avoids needing locks or channels for collecting.
- The facade method (`Run`) returns a single `*Report` regardless of how many probes failed. Caller doesn't deal with individual errors.
- `errgroup` could replace `sync.WaitGroup`, but we *don't* want to short-circuit on the first error — we want every probe's result. So plain `WaitGroup` is correct here.

**Follow-ups:**

- What if a probe panics? *Wrap the goroutine body in a `defer recover()` and convert to an error. Otherwise a buggy probe takes down the health check.*
- How would you cache results to avoid hammering subsystems? *Add a cache: store `*Report` for `cacheTTL` (e.g., 10s). Stale-while-revalidate keeps response fast.*
- What about probe weights (DB outage is critical, cache outage is degraded)? *Add a `Critical bool` to each probe; aggregation considers critical failures separately from non-critical.*

---

## 7. System design starters

### Starter 1: SDK facade for a B2B API

**Prompt:** "We're building an SDK for our REST API. Customers will use it from Go services. Design the facade."

**Direction:**

1. **Verb-oriented public methods.** Mirror the API's verbs: `CreateCustomer`, `ChargeCard`, `SendInvoice`. One method per business operation, not one method per HTTP endpoint.
2. **Cheap constructor.** `NewClient(apiKey, opts...)` doesn't dial. First method call does the work.
3. **Per-call options.** Each method accepts `optFns ...func(*CallOptions)` for retries, timeout, idempotency keys.
4. **Idempotency keys.** Generate one per call (or accept caller-supplied) so retries are safe.
5. **Error categorization.** Map HTTP responses to sentinel errors: `ErrUnauthorized`, `ErrRateLimited`, `ErrConflict`. Preserve underlying response via `%w`.
6. **Pagination helpers.** `NewListCustomersIterator(ctx, filter)` hides the next-token pagination.
7. **Observability hooks.** Optional callbacks for request/response logging. Don't force a logger on customers.
8. **Versioning policy.** Document which fields are stable. Use options for new features so existing callers don't break.

**Trade-offs:**

- Auto-retry vs caller control: enabled by default is friendly; disabled by default puts control in the caller's hands. AWS chose enabled by default with knobs to tune.
- Error mapping depth: too coarse and callers can't react precisely; too fine and the API surface bloats. Balance based on the API's domain.
- Synchronous vs streaming: long-running operations (exports, batch jobs) need a separate API shape. Don't shoehorn them into the request-response facade.

---

### Starter 2: Microservice gateway facade

**Prompt:** "Our backend has 15 microservices. The mobile app's home screen needs data from 6 of them. How do we structure the gateway?"

**Direction:**

1. **One facade method per UI screen, not per backend service.** `Home`, `Profile`, `Search`. Each method orchestrates the backend calls needed for that screen.
2. **Typed clients for each backend.** Generate from gRPC/OpenAPI; cache them in the gateway.
3. **Concurrent fan-out.** `errgroup.Group` to call backends in parallel. Bound the wait time with `context.WithTimeout`.
4. **Soft-fail policy.** Non-essential subsystems (recommendations) log on failure and return a default. Essential subsystems (user profile) fail the whole request.
5. **Response shaping.** The gateway transforms backend responses into mobile-optimized JSON. Less data, denormalized for the screen.
6. **Caching.** Per-user response cache with short TTL (30s-2m). Avoids re-running fan-out on every page load.
7. **Tracing.** Propagate trace context through every backend call so a slow home screen is debuggable end-to-end.
8. **Versioning.** Mobile clients are sticky — old versions stay deployed. Gateway must support N-1 mobile versions concurrently.

**Trade-offs:**

- Coarse-grained vs fine-grained API: coarse (one call per screen) is fewer round-trips, more rigid; fine (one call per resource) is flexible, chattier. Coarse usually wins for mobile.
- BFF (Backend for Frontend) per platform vs one gateway: separate gateway per platform (iOS, Android, Web) lets each evolve independently; one gateway is less work but constrains response shape.
- Where caching lives: in the gateway (simple, shared cache invalidation) or per-backend client (smaller TTL, more freshness). Often both.

---

### Starter 3: Legacy refactor — god-service into facades

**Prompt:** "We have a 200KLOC monolithic Go service with a single `Service` type containing 300 methods. How do we refactor?"

**Direction:**

1. **Inventory the methods.** Group by domain — auth, billing, orders, inventory, notifications, reporting. Expect 8-15 groups.
2. **Find true dependencies.** For each method, identify *which other methods it calls*. Methods clustered into call chains belong together.
3. **Extract one facade per domain.** Each facade has its own struct, its own constructor, its own dependencies.
4. **Use a delegator during migration.** The old `Service` becomes a thin shell that delegates to the new facades. Callers migrate one at a time.
5. **Move tests with code.** Don't try to rewrite tests after extraction; bring them along, refactor in place.
6. **Beware shared mutable state.** If methods share a `*sql.DB` (fine) or a cache map (sometimes fine) or a counter (refactor first), you need to handle the shared state explicitly.
7. **Cross-cutting workflows.** Signup, checkout, refund — these span multiple domains. Create *coordinator* services that depend on the small facades.
8. **Acceptance tests at the seam.** Before extracting, build integration tests around the cross-domain workflows. Make sure behavior survives extraction.

**Trade-offs:**

- Big-bang vs incremental: incremental wins. A six-month "rewrite" rarely lands; six months of weekly extractions does.
- Internal interfaces vs concrete types: extract interfaces *where they're consumed*, not at the facade. Avoid the "every struct gets an interface" pattern.
- Database boundaries: refactoring code while keeping the DB monolithic is fine. Don't try to split the schema at the same time.

---

### Starter 4: Observability facade

**Prompt:** "Our services use Prometheus for metrics, OpenTelemetry for tracing, slog for logs. Wiring all three into every handler is painful. How do we facade?"

**Direction:**

1. **An `Observability` facade with three sub-facades.** `obs.Tracer`, `obs.Metrics`, `obs.Logger`. The top-level `Observability` constructs and owns all three.
2. **Per-request scoping.** `obs.FromContext(ctx)` returns a request-scoped triple — tracer with the current span, metrics with request labels, logger with request fields.
3. **Middleware sets up the triple.** Per HTTP handler, a middleware extracts trace context, opens a span, builds the logger with `trace_id` and `span_id`, and stuffs the triple into the context.
4. **Domain code calls one accessor.** Handlers and services do `obs.FromContext(ctx).Logger.Info(...)` — no need to know how the logger was built.
5. **Lifecycle.** The top-level `Observability` owns the OTel SDK, the Prometheus registry, the log writer. `Close(ctx)` flushes pending spans and metrics.
6. **Test mode.** `obs.NewNoop()` returns a triple that discards everything — for unit tests that don't care about observability.

**Trade-offs:**

- One facade vs three independent: one facade is easier to inject; three are more orthogonal. Choose based on whether you ever want partial observability (logs only, no traces).
- Context-based vs explicit passing: context is idiomatic Go but hides the dependency. Explicit passing (every function takes `Logger`) is verbose but visible. Most teams choose context.
- Cardinality: metrics with too many labels (user ID, request ID) explode Prometheus. The facade should enforce label allowlists or split high-cardinality labels into traces only.

---

### Starter 5: Multi-cloud storage facade

**Prompt:** "We deploy to AWS, GCP, and on-prem. Our code shouldn't know which cloud. Design the storage facade."

**Direction:**

1. **One facade interface.** `Blob`, `Queue`, `KV`. Each is a small interface. The application code depends on the interface.
2. **Per-cloud implementations.** `s3Blob`, `gcsBlob`, `minioBlob`. Each implements `Blob`. The configuration system picks one at startup.
3. **Capability gaps.** Not every cloud supports every feature (presigned URLs, server-side copy, lifecycle rules). The facade interface exposes only the *intersection*. Cloud-specific features go on a separate, optional interface.
4. **Per-cloud auth.** AWS uses IAM roles; GCP uses service accounts; on-prem uses static creds. The facade hides the auth ceremony.
5. **Error mapping.** Each cloud's SDK returns its own error types. Map to facade-level errors: `ErrNotFound`, `ErrUnauthorized`, `ErrConflict`.
6. **Cost-of-portability.** Real talk: portable storage abstractions are often slower or more limited than cloud-native usage. Document the trade-off.

**Trade-offs:**

- Lowest common denominator vs cloud-native: the facade locks you out of cloud-specific features. Mitigate via the optional capability interface, but accept the limitation.
- One huge facade vs domain-specific facades: a `Storage` facade for all storage operations is unwieldy; one per domain (`UserAvatars`, `OrderArchive`) is cleaner.
- Migration story: switching clouds means switching the configuration knob, not rewriting code. That's the payoff; make sure your test suite exercises both backends.

---

## 8. Traps and red flags

### Trap 1: The thin pass-through "facade"

```go
type RedisFacade struct{ r *redis.Client }
func (f *RedisFacade) Get(ctx context.Context, k string) (string, error) {
    return f.r.Get(ctx, k).Result()
}
```

This isn't a facade. It's a wrapper that adds no value — same shape, same complexity, one extra type to learn. Either commit to orchestration (real facade) or use `*redis.Client` directly.

---

### Trap 2: Leaking subsystem types

```go
func (s *Storage) Read(ctx context.Context, key string) (*sql.Rows, error) { ... }
```

Returning `*sql.Rows` from the facade exposes `database/sql`. Switching to `pgx` later breaks every caller. The facade method should return a domain type or a structured result.

---

### Trap 3: Constructor doing I/O

```go
func NewService(cfg Config) (*Service, error) {
    conn, err := sql.Open(...)
    if err != nil { return nil, err }
    if err := conn.Ping(); err != nil { return nil, err }  // network at startup
    return &Service{db: conn}, nil
}
```

`main()` blocks on DB before the service can boot. Tests can't construct without a fake DB. CLI tools that don't make calls still pay the cost. Defer I/O to first use or to an explicit `Start(ctx)`.

---

### Trap 4: Hiding *too* much

```go
type Email struct{ /* private */ }
func (e *Email) Send(to, subject, body string) error { ... }
```

No `SetTimeout`, no `WithCC`, no `WithAttachment`. Callers who need anything beyond the basic case have to fork your library. Provide an escape hatch — options struct, custom transport, or a low-level method.

---

### Trap 5: Hiding *too little*

```go
type Email struct {
    SMTPHost, SMTPPort, Username, Password string
    TLSConfig *tls.Config
    Timeout   time.Duration
    Retries   int
    DialFunc  func(...) (net.Conn, error)
}
func (e *Email) Send(to, subject, body string) error { ... }
```

If the facade requires 8 fields to construct, what was it hiding? Nothing. The caller is configuring SMTP themselves; the facade adds boilerplate. Either provide better defaults or accept a pre-configured transport.

---

### Trap 6: Facade owns goroutines but has no Close

```go
type Cache struct {
    data map[string]entry
    mu   sync.RWMutex
}
func NewCache() *Cache {
    c := &Cache{data: map[string]entry{}}
    go c.evictLoop()  // background goroutine
    return c
}
```

The eviction goroutine runs forever. Every `NewCache()` leaks one. Provide `Close()` (or `Stop()`) and document that callers must invoke it.

---

### Trap 7: Concurrent access without protection

```go
type Cache struct{ data map[string][]byte }
func (c *Cache) Get(k string) []byte    { return c.data[k] }
func (c *Cache) Set(k string, v []byte) { c.data[k] = v }
```

`map` is not safe for concurrent read+write. The race detector flags it; production crashes with `concurrent map writes`. Use `sync.RWMutex`, `sync.Map`, or a real cache library.

---

### Trap 8: Mapping errors to opaque types

```go
func (s *Storage) Read(...) ([]byte, error) {
    if err := s.db.QueryRow(...).Scan(&data); err != nil {
        return nil, errors.New("storage: read failed")  // throws away detail
    }
    return data, nil
}
```

The caller can't tell timeout from missing row from auth failure. Wrap with `%w` so the chain is preserved: `fmt.Errorf("storage: read %q: %w", key, err)`. Then map *categories* (not throw away) to sentinel errors.

---

### Trap 9: Facade with stateful per-request data on the struct

```go
type APIClient struct {
    baseURL string
    currentRequestID string  // mutated per call
}
func (c *APIClient) Do(req Request) Response {
    c.currentRequestID = newID()  // RACE if concurrent
    ...
}
```

Per-call state on a shared struct is a race waiting to happen. Pass the data through parameters or through `context.Context`.

---

### Trap 10: Pattern naming pollution

```go
type UserFacade struct{ ... }
type OrderFacade struct{ ... }
type BillingFacade struct{ ... }
```

Naming by pattern (`*Facade`, `*Service`, `*Manager`) signals the author didn't pick a domain noun. `UserAccount`, `Order`, `Billing` are better. Internal implementation being a facade is a detail; the consumer doesn't care.

---

## 9. Questions to ASK the interviewer

### Junior-level questions

- "When you reach for a new struct in this codebase, how do you decide whether to expose its underlying dependencies?"
- "Do you wrap third-party SDKs (AWS, Stripe) or use them directly in handlers?"

### Middle-level questions

- "When a workflow spans 3-4 internal services, do you build a coordinator type, or do you call them directly from the HTTP handler?"
- "How do you handle errors from multiple subsystems — pass through, wrap, or remap to sentinel errors?"
- "What's the team's policy on lifecycle methods? Do all 'service' types have `Close`?"
- "How do you scope observability — global tracer/metrics, or context-scoped per request?"

### Senior-level questions

- "How do you decide when a facade has grown into a god-class and needs to be split?"
- "Do you allow your facades to leak subsystem types as escape hatches, or do you require everything to go through the facade's API?"
- "How do you version a facade API across consumers — same module, semantic versioning, separate SDK?"
- "What's your approach to lazy initialization in facades that own expensive subsystems?"
- "When refactoring a legacy god-class, how do you handle in-flight production traffic during the migration?"
- "How do you handle observability and error aggregation across a facade that fans out to 5+ backends?"

---

## 10. Cross-references

- **[../05-adapter-pattern/](../05-adapter-pattern/)** — Adapter is the closest sibling. Adapter translates shape (one API to another); Facade simplifies count (many APIs to one). They're often confused; if your wrapper has the same number of moving parts as what it wraps, it's an adapter, not a facade.
- **[../11-proxy-pattern/](../11-proxy-pattern/)** — Proxy preserves the underlying interface and intercepts calls (caching, lazy-loading, auth). Facade *changes* the interface to be narrower. If your wrapper has the same shape as what it wraps, it's a proxy.
- **[../04-decorator-pattern/](../04-decorator-pattern/)** — Decorator adds cross-cutting concerns (logging, retries, metrics) around an existing interface. Often paired with a Facade: build the facade, then wrap it in decorators at wiring time.
- **[../06-factory-pattern/](../06-factory-pattern/)** — Constructors for facades are factories. The factory builds the facade with its subsystems wired together. Functional options on the factory configure the facade.
- **[../01-functional-options/](../01-functional-options/)** — The standard way to make facade constructors configurable. `NewClient(required, opts...)` is the universal Go SDK shape; options carry the optional tuning.
- **[../08-singleton-pattern/](../08-singleton-pattern/)** — Some facades are singletons (`http.DefaultClient`, `slog.Default()`). The patterns overlap; a singleton facade trades testability for ergonomics.
- **[../15-object-pool-pattern/](../15-object-pool-pattern/)** — A facade like `*sql.DB` *contains* a pool. The pool is a subsystem; the facade exposes high-level verbs. Caller never sees the pool.
- **[../18-registry-pattern/](../18-registry-pattern/)** — A facade often dispatches via an internal registry (e.g., `*sql.DB` looks up the driver). The registry is hidden; the facade exposes the dispatch as a high-level verb.

Facades in Go are the bread-and-butter of every nontrivial service. `*http.Client`, `*sql.DB`, every SDK client, every domain-layer "service" — they're all facades. The hard part isn't building them; it's deciding what to hide, what to expose, what to map, and what to pass through. Get that decision wrong and the facade becomes a god-class or a thin wrapper that adds no value. Get it right and the rest of your codebase becomes dramatically easier to reason about, test, and evolve.
