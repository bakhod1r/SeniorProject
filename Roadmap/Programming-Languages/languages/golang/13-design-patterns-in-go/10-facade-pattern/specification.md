# Facade Pattern — Specification

## 1. Origins

The Facade pattern was formalized in *Design Patterns: Elements of Reusable Object-Oriented Software* (Gamma, Helm, Johnson, Vlissides, 1994):

> "Provide a unified interface to a set of interfaces in a subsystem. Facade defines a higher-level interface that makes the subsystem easier to use."

Historical predecessors:

- **Smalltalk-80 (1980)** — "module-as-facade" idiom.
- **Unix shell pipes (1973)** — composite tools hidden behind simpler shell scripts.
- **CORBA (1991)** — ORB facades over distributed object protocols.

In post-GoF history:

- **Java (1995+)** — Spring `@Service` classes are facades. Application services in DDD (Evans, 2003) are facades.
- **.NET (2002)** — Application Services in DDD-influenced architectures.
- **AWS SDK (2010+)** — per-service facades over REST APIs.
- **Go (2012+)** — `net/http.Client`, `database/sql.DB`, kubernetes/client-go clientset, aws-sdk-go-v2 service clients.

The Go community embraces Facade primarily for:
1. SDK design (`s3.Client`, `dynamodb.Client`).
2. Service-layer wrappers in application code.
3. Boundary types in hexagonal architecture.

---

## 2. Go language mechanics

### 2.1 Struct composition

Go doesn't have inheritance. Facades use *composition*: a struct holds references to subsystem types.

```go
type Facade struct {
    db    *sql.DB
    cache *Cache
    log   *log.Logger
}
```

### 2.2 Methods

Facade methods orchestrate calls:

```go
func (f *Facade) DoThing(ctx context.Context, req Request) (Response, error) {
    /* call f.db, f.cache, f.log */
}
```

### 2.3 Interfaces at boundaries

Idiomatic: declare interfaces in the consumer (Go's "accept interfaces, return structs"):

```go
// Consumer package
type BillingService interface {
    Charge(ctx context.Context, req ChargeReq) (*ChargeResp, error)
}

// Implementation
type BillingFacade struct { /* ... */ }
func (b *BillingFacade) Charge(...) (...) { /* ... */ }

var _ BillingService = (*BillingFacade)(nil)
```

### 2.4 Constructor

The facade constructor wires the subsystems:

```go
func NewBillingFacade(db *sql.DB, stripe StripeClient, log *log.Logger) *BillingFacade {
    return &BillingFacade{db: db, stripe: stripe, log: log}
}
```

Functional options are common for optional subsystems.

---

## 3. Canonical Go shapes

### 3.1 Simple facade

```go
type Facade struct {
    db    *sql.DB
    cache *Cache
}

func (f *Facade) Method(ctx context.Context, args ...) (...) { /* orchestrate */ }
```

### 3.2 Facade with sub-facades (hierarchical)

```go
type Client struct {
    /* shared state: config, http client, credentials */
}

func (c *Client) Users() *UsersService { return &UsersService{client: c} }
func (c *Client) Orders() *OrdersService { return &OrdersService{client: c} }

type UsersService struct { client *Client }
func (s *UsersService) Get(ctx context.Context, id string) (*User, error) { /* ... */ }
```

Used by AWS SDK, Google Cloud SDK.

### 3.3 Facade with lifecycle (Close)

```go
type Facade struct {
    /* ... */
}

func (f *Facade) Close() error {
    var errs []error
    if err := f.db.Close(); err != nil { errs = append(errs, err) }
    if err := f.cache.Close(); err != nil { errs = append(errs, err) }
    return errors.Join(errs...)
}
```

### 3.4 Facade with hot-reload

```go
type Facade struct {
    config atomic.Pointer[Config]
    /* ... */
}

func (f *Facade) Reload(c *Config) { f.config.Store(c) }
```

### 3.5 Facade with functional options

```go
func New(opts ...Option) (*Facade, error) {
    f := &Facade{ /* defaults */ }
    for _, opt := range opts { opt(f) }
    return f, nil
}
```

---

## 4. Standard library use

### 4.1 net/http.Client

```go
client := &http.Client{
    Transport: roundTripper,
    Jar:       cookieJar,
    Timeout:   30 * time.Second,
}
resp, err := client.Do(req)
```

Facade over `RoundTripper`, `Jar`, redirect handling, timeout coordination.

### 4.2 database/sql.DB

```go
db, _ := sql.Open("postgres", dsn)
defer db.Close()
rows, _ := db.Query("SELECT ...")
```

Facade over connection pool, driver, prepared statements, transactions.

### 4.3 net/http.Server

```go
srv := &http.Server{
    Addr:    ":8080",
    Handler: mux,
    /* timeouts */
}
srv.ListenAndServe()
```

Facade over listener, multiplexer, TLS, lifecycle.

### 4.4 net/rpc (less popular but illustrative)

`*rpc.Client` is a facade over connection, encoding, request/response correlation.

### 4.5 crypto/tls.Config

A facade-like configuration object (not a struct of methods, but holds together cipher suites, certificates, session caching).

---

## 5. Real library use

### 5.1 kubernetes/client-go

```go
clientset := kubernetes.NewForConfig(cfg)
pods, _ := clientset.CoreV1().Pods("default").List(ctx, opts)
```

Multi-level facade:
- `*Clientset` — top-level facade over API groups.
- `CoreV1()` — API-group facade.
- `Pods()` — resource facade.

### 5.2 aws-sdk-go-v2

```go
cfg, _ := config.LoadDefaultConfig(ctx)
s3 := s3.NewFromConfig(cfg)
ddb := dynamodb.NewFromConfig(cfg)

out, _ := s3.GetObject(ctx, &s3.GetObjectInput{...})
```

Per-service facade. Each `*Client` hides:
- Endpoint resolution.
- Request signing.
- Retries.
- Middleware pipeline.
- Response unmarshalling.

### 5.3 google.golang.org/api

```go
ctx := context.Background()
client, _ := storage.NewClient(ctx)
bkt := client.Bucket("my-bucket")
obj := bkt.Object("key")
```

Hierarchical sub-facades: Client → Bucket → Object → Reader.

### 5.4 stripe-go

```go
sc := &client.API{}
sc.Init("sk_test_...", nil)
cust, _ := sc.Customers.New(&stripe.CustomerParams{...})
```

`*client.API` is the top-level facade. Resource sub-facades (`Customers`, `Charges`).

### 5.5 nats.go

```go
nc, _ := nats.Connect("nats://localhost:4222")
defer nc.Close()
nc.Publish("topic", []byte("hello"))
nc.Subscribe("topic", handler)
```

`*nats.Conn` is a facade over connection, encoding, subscription registry, reconnect logic.

---

## 6. Formal specification

A Go Facade implementation consists of:

| Element | Description |
|---------|-------------|
| **Facade type** | Struct holding subsystem references. |
| **Subsystems** | Multiple types the facade orchestrates. |
| **Constructor** | Wires subsystems (often via functional options). |
| **Methods** | High-level operations that orchestrate subsystems. |
| **Lifecycle** | Optional `Close()` method for resource cleanup. |

**Invariants:**

1. The facade wraps *multiple* types (vs Adapter, which wraps one).
2. The facade exposes a *simpler* interface than the subsystems would.
3. The facade is the *only* type consumers need to know.
4. Subsystem types are private to the facade or pass through interfaces.
5. The facade is thin in business logic — it orchestrates, doesn't replace.

---

## 7. Anti-patterns

### 7.1 God facade

Grows to 50+ methods and 10+ subsystems. The facade becomes the application. **Fix:** split by bounded context.

### 7.2 Leaky facade

Exposes subsystem types via accessor methods. **Fix:** unexported fields; expose escape hatches as documented interfaces only when needed.

### 7.3 Facade chain

`F1 → F2 → F3 → F4` where each layer just renames methods. **Fix:** collapse redundant layers.

### 7.4 Facade hiding too much

No escape hatch when consumers need lower-level access. **Fix:** expose `.Inner()` or `.DB()` accessor as a documented option.

### 7.5 Facade with transaction across subsystems

Calling subsystem methods inside `db.Begin()/Commit()` — different subsystems use different connections, so they don't participate. **Fix:** pass `tx` explicitly to subsystem methods that should join the transaction.

### 7.6 Constructor doing I/O

Network calls in `NewFacade()` block startup. **Fix:** defer to first use; provide separate `Connect(ctx)` or `Verify(ctx)`.

### 7.7 Mutable public subsystem fields

```go
type Facade struct {
    DB *sql.DB  // public
}
```

Callers mutate. State leaks. **Fix:** unexported fields; methods only.

---

## 8. Variants and dialects

| Variant | Use case |
|---------|----------|
| Simple facade | One struct, several subsystems |
| Hierarchical facade | Top-level + sub-facades (AWS SDK, K8s clientset) |
| Lifecycle facade | With `Close()` for resource cleanup |
| Hot-reload facade | `atomic.Pointer` for config swaps |
| Generic facade | Type parameters for typed caches/stores |
| Composite facade | Aggregates other facades (god facade transitional shape) |

---

## 9. Naming conventions

- **`NewX(...)` / `NewXFromConfig(cfg)`** — constructor.
- **`Close() error`** — lifecycle cleanup.
- **`Default()`** — singleton accessor (if global).
- **`*Client`** — common name for SDK-style facades.
- **`*Service`** — application-layer facade (DDD influence).
- **`*Facade`** — explicit name when role is dominant.
- **`*Manager`** — alternative; less idiomatic in Go.

---

## 10. Related patterns

| Pattern | Distinction |
|---------|-------------|
| **Adapter** | Wraps *one* type to satisfy a different interface. Facade wraps *many*. |
| **Decorator** | Same interface, added behaviour. Facade has different interface than subsystems. |
| **Proxy** | Same interface, controls access. Facade simplifies. |
| **Mediator** | Centralizes complex communication between objects. Often facade-like. |
| **API Gateway** | The network-level version of Facade. |
| **Application Service** (DDD) | Domain-level facade for orchestrating use cases. |

---

## 11. Further reading

- **GoF (1994)** — original Facade
- **Eric Evans, *Domain-Driven Design*** — Application Services as facades
- **Vaughn Vernon, *Implementing DDD*** — practical service-layer patterns
- **`net/http.Client`** — canonical Go facade
- **`database/sql.DB`** — facade over pool + driver + statements
- **aws-sdk-go-v2 docs** — per-service facade design
- **kubernetes/client-go README** — clientset structure
- **Sam Newman, *Building Microservices*** — gateway and BFF patterns
- **"Hexagonal Architecture" (Alistair Cockburn, 2005)** — ports-and-adapters with facades

Facade is the *application service* pattern of Go codebases. Its closest cousin (Adapter) wraps single types; Facade aggregates several. Senior-level skill is recognising when complexity warrants Facade vs simpler patterns.

---

## 12. Glossary

| Term | Meaning |
|------|---------|
| **Subsystem** | A collaborator the facade orchestrates. |
| **Sub-facade** | A nested facade exposing related operations (e.g., `client.Users()`). |
| **Service** | DDD term for application-layer facade. |
| **Application Service** | Synonym for service-layer facade. |
| **Boundary type** | A facade at a layer or context boundary. |
| **Anti-corruption layer (ACL)** | Facade translating between bounded contexts. |
| **Composition root** | The `main()` function wiring facades. |
