# Embedding Structs — Senior Level

## 1. Architectural Role of Embedding in Go Systems

Embedding is Go's primary mechanism for horizontal code reuse — adding capabilities to types without inheritance chains. At the architectural level, embedding solves different problems than inheritance:

- **Inheritance solves:** "How do I get polymorphic behavior from a hierarchy of types?"
- **Embedding solves:** "How do I add capabilities to types without code duplication?"

The architectural implications:

```
Layer               Pattern              Go Mechanism
─────────────       ───────────          ─────────────────
Polymorphism        Interface dispatch   interface{}
Code reuse          Mixin composition    struct embedding
Capability access   Transparent API      promoted fields/methods
Testability         Partial impl        interface embedding in struct
```

---

## 2. The Repository Pattern with Embedding

A mature pattern for database access layers:

```go
// base/repository.go
type Repository struct {
    db    *sqlx.DB
    table string
    log   *slog.Logger
}

func NewRepository(db *sqlx.DB, table string, log *slog.Logger) Repository {
    return Repository{db: db, table: table, log: log}
}

func (r *Repository) Count(ctx context.Context) (int, error) {
    var count int
    err := r.db.GetContext(ctx, &count, fmt.Sprintf("SELECT COUNT(*) FROM %s", r.table))
    return count, err
}

func (r *Repository) Exec(ctx context.Context, query string, args ...interface{}) (sql.Result, error) {
    r.log.Info("executing query", "query", query)
    return r.db.ExecContext(ctx, query, args...)
}

func (r *Repository) Transaction(ctx context.Context, fn func(*sqlx.Tx) error) error {
    tx, err := r.db.BeginTxx(ctx, nil)
    if err != nil {
        return fmt.Errorf("begin transaction: %w", err)
    }
    if err := fn(tx); err != nil {
        tx.Rollback()
        return err
    }
    return tx.Commit()
}

// user/repository.go
type UserRepository struct {
    base.Repository // promoted: Count, Exec, Transaction
    cache *redis.Client
}

func (r *UserRepository) FindByEmail(ctx context.Context, email string) (*User, error) {
    // Uses promoted r.db and r.log implicitly via r.Repository
    var u User
    err := r.db.GetContext(ctx, &u, "SELECT * FROM users WHERE email=$1", email)
    return &u, err
}
```

---

## 3. The Decorator Pattern via Embedding

Embedding `http.ResponseWriter` to add cross-cutting concerns:

```go
// Capture status code:
type StatusRecorder struct {
    http.ResponseWriter
    Status int
    size   int
}

func NewStatusRecorder(w http.ResponseWriter) *StatusRecorder {
    return &StatusRecorder{ResponseWriter: w, Status: http.StatusOK}
}

func (r *StatusRecorder) WriteHeader(status int) {
    r.Status = status
    r.ResponseWriter.WriteHeader(status)
}

func (r *StatusRecorder) Write(b []byte) (int, error) {
    n, err := r.ResponseWriter.Write(b)
    r.size += n
    return n, err
}

// Composition: wrap with multiple decorators
type CachingWriter struct {
    *StatusRecorder // embed StatusRecorder (which embeds ResponseWriter)
    cacheKey string
    buf      bytes.Buffer
}

func (cw *CachingWriter) Write(b []byte) (int, error) {
    cw.buf.Write(b) // cache the response
    return cw.StatusRecorder.Write(b)
}

func (cw *CachingWriter) CacheResponse(ttl time.Duration) {
    if cw.Status == http.StatusOK {
        cache.Set(cw.cacheKey, cw.buf.Bytes(), ttl)
    }
}
```

---

## 4. Postmortem: The Mutex Copy Bug

**Incident:** Production service experiencing intermittent deadlocks under load.

**Root Cause:**
```go
type RateLimiter struct {
    sync.Mutex
    tokens int
    limit  int
}

func NewRateLimiter(limit int) *RateLimiter {
    return &RateLimiter{tokens: limit, limit: limit}
}

// BUG: This copies the RateLimiter, including its Mutex state
func checkLimit(rl RateLimiter) bool { // ← value receiver copies mutex!
    rl.Lock()
    defer rl.Unlock()
    return rl.tokens > 0
}
```

**Symptom:** After `checkLimit` copied a locked mutex, the copy's lock state was inconsistent with the original.

**Fix:**
```go
// Always use pointer receiver for types with embedded mutex
func checkLimit(rl *RateLimiter) bool {
    rl.Lock()
    defer rl.Unlock()
    return rl.tokens > 0
}
```

**Prevention:**
```go
// go vet catches this automatically:
// go vet ./...
// → assignment copies lock value to rl: sync.Mutex

// Add noCopy sentinel (prevents copying):
type RateLimiter struct {
    noCopy noCopy // zero-size type that go vet detects
    sync.Mutex
    tokens int
    limit  int
}

type noCopy struct{}
func (*noCopy) Lock()   {}
func (*noCopy) Unlock() {}
```

---

## 5. Postmortem: The Nil Pointer from Uninitialized Pointer Embedding

**Incident:** Service crashes on startup under certain config combinations.

```go
type Config struct {
    Debug bool
    Port  int
}

type App struct {
    *Config // pointer embedding
    Name string
}

// Somewhere in initialization:
func NewApp(name string) *App {
    return &App{Name: name} // Config is nil!
}

// Later:
func (a *App) IsDebug() bool {
    return a.Debug // PANIC: nil pointer dereference
}
```

**Fix:**
```go
func NewApp(name string) *App {
    return &App{
        Config: &Config{Port: 8080}, // always initialize
        Name:   name,
    }
}
```

Or use value embedding when the struct is small:
```go
type App struct {
    Config Config // value embedding — always initialized to zero values
    Name   string
}
```

**Monitoring:** Add startup validation:
```go
func (a *App) Validate() error {
    if a.Config == nil {
        return errors.New("App.Config must not be nil")
    }
    return nil
}
```

---

## 6. Performance: Embedding and CPU Cache Efficiency

The memory layout of embedded structs affects cache performance.

```go
// Cache-friendly: small, frequently used fields first
type HotPath struct {
    sync.Mutex     // 8 bytes (state + signal)
    count   int64  // 8 bytes — hot field together with mutex
    // ... cold fields below
    stats   [100]byte // 100 bytes — cold, rarely accessed
}

// Cache-hostile: hot fields scattered with cold fields
type BadLayout struct {
    name    [256]byte  // cold — strings are rarely hot
    sync.Mutex         // hot (in hot path)
    count   int64      // hot
    meta    [100]byte  // cold
}
```

A single cache line is 64 bytes. Keeping mutex + counter in the same cache line means a single cache miss to access both — instead of two separate misses.

```go
// Tool: go build with -gcflags="-m" to see escape analysis
// Tool: structlayout to visualize struct memory layout
// go install github.com/dominikh/go-tools/cmd/structlayout@latest
// structlayout mypackage HotPath
```

---

## 7. Interface Embedding for Progressive Disclosure

Design large interfaces using embedding of smaller ones:

```go
// Atomic interfaces (single responsibility)
type Reader interface {
    Get(ctx context.Context, id string) (*Entity, error)
    List(ctx context.Context, filter Filter) ([]*Entity, Cursor, error)
}

type Writer interface {
    Create(ctx context.Context, e *Entity) (*Entity, error)
    Update(ctx context.Context, id string, updates map[string]interface{}) (*Entity, error)
    Delete(ctx context.Context, id string) error
}

type Watcher interface {
    Subscribe(ctx context.Context, filter Filter) (<-chan Event, error)
}

// Composed interfaces for specific needs
type ReadWriteRepository interface {
    Reader
    Writer
}

type FullRepository interface {
    Reader
    Writer
    Watcher
}

// Each component only requires what it needs:
func ReadOnlyHandler(store Reader) http.Handler { ... }
func AdminHandler(store ReadWriteRepository) http.Handler { ... }
```

---

## 8. Embedding for Observability

Add metrics/tracing to any type via embedding:

```go
type InstrumentedReader struct {
    io.Reader
    bytesRead prometheus.Counter
    readDuration prometheus.Histogram
}

func NewInstrumentedReader(r io.Reader, name string) *InstrumentedReader {
    return &InstrumentedReader{
        Reader: r,
        bytesRead: prometheus.MustRegisterOrGet(prometheus.NewCounter(prometheus.CounterOpts{
            Name: "bytes_read_total",
            ConstLabels: prometheus.Labels{"source": name},
        })).(prometheus.Counter),
    }
}

func (ir *InstrumentedReader) Read(p []byte) (int, error) {
    start := time.Now()
    n, err := ir.Reader.Read(p) // delegate
    ir.bytesRead.Add(float64(n))
    ir.readDuration.Observe(time.Since(start).Seconds())
    return n, err
}

// Usage: transparent — callers see io.Reader interface
var r io.Reader = NewInstrumentedReader(f, "config-file")
config.Parse(r) // metrics recorded transparently
```

---

## 9. Embedding in Test Doubles

Comprehensive test double patterns using embedding:

```go
// Test spy — records calls
type SpyStore struct {
    store.Interface
    calls []string
}

func (s *SpyStore) Get(id string) (*Entity, error) {
    s.calls = append(s.calls, fmt.Sprintf("Get(%s)", id))
    return s.Interface.Get(id)
}

// Test stub — returns predetermined data
type StubStore struct {
    store.Interface
    entities map[string]*Entity
}

func (s *StubStore) Get(id string) (*Entity, error) {
    if e, ok := s.entities[id]; ok {
        return e, nil
    }
    return nil, store.ErrNotFound
}

// Test fake — in-memory implementation
type FakeStore struct {
    entities map[string]*Entity
    mu       sync.RWMutex
}

func (s *FakeStore) Get(id string) (*Entity, error) {
    s.mu.RLock()
    defer s.mu.RUnlock()
    e, ok := s.entities[id]
    if !ok {
        return nil, store.ErrNotFound
    }
    return e, nil
}

// NOTE: FakeStore does NOT embed store.Interface
// It provides a full in-memory implementation
```

---

## 10. Middleware Chain via Interface Embedding

Building a composable middleware system:

```go
type Handler interface {
    Handle(ctx context.Context, req Request) Response
}

type HandlerFunc func(ctx context.Context, req Request) Response
func (f HandlerFunc) Handle(ctx context.Context, req Request) Response { return f(ctx, req) }

// Middleware wraps Handler:
type LoggingMiddleware struct {
    Handler
    logger *slog.Logger
}

func (m *LoggingMiddleware) Handle(ctx context.Context, req Request) Response {
    m.logger.Info("request", "path", req.Path)
    resp := m.Handler.Handle(ctx, req) // delegate
    m.logger.Info("response", "status", resp.Status)
    return resp
}

type RateLimitMiddleware struct {
    Handler
    limiter *rate.Limiter
}

func (m *RateLimitMiddleware) Handle(ctx context.Context, req Request) Response {
    if !m.limiter.Allow() {
        return Response{Status: 429}
    }
    return m.Handler.Handle(ctx, req)
}

// Compose:
func chain(h Handler, middlewares ...func(Handler) Handler) Handler {
    for i := len(middlewares) - 1; i >= 0; i-- {
        h = middlewares[i](h)
    }
    return h
}
```

---

## 11. The Protocol Buffer Pattern with Embedding

Protobuf-generated code uses embedding for message composition:

```go
// Generated code pattern (similar to what protoc generates):
type BaseMessage struct {
    state         protoimpl.MessageState
    sizeCache     protoimpl.SizeCache
    unknownFields protoimpl.UnknownFields
}

type UserMessage struct {
    BaseMessage // state, size, unknowns promoted
    ID    int64  `protobuf:"varint,1,opt"`
    Name  string `protobuf:"bytes,2,opt"`
}

// Our code can use a similar pattern for versioned messages:
type MessageV1 struct {
    ID   int64  `json:"id"`
    Name string `json:"name"`
}

type MessageV2 struct {
    MessageV1                    // backward compat: embed v1
    Email string `json:"email"` // new field in v2
}
```

---

## 12. Embedding Sync Primitives — Thread Safety Patterns

```go
// Pattern 1: Embedded RWMutex for concurrent map
type ConcurrentMap[K comparable, V any] struct {
    sync.RWMutex
    data map[K]V
}

func NewConcurrentMap[K comparable, V any]() *ConcurrentMap[K, V] {
    return &ConcurrentMap[K, V]{data: make(map[K]V)}
}

func (m *ConcurrentMap[K, V]) Get(key K) (V, bool) {
    m.RLock()
    defer m.RUnlock()
    v, ok := m.data[key]
    return v, ok
}

func (m *ConcurrentMap[K, V]) Set(key K, value V) {
    m.Lock()
    defer m.Unlock()
    m.data[key] = value
}

// Pattern 2: Embedded WaitGroup for graceful shutdown
type WorkerPool struct {
    sync.WaitGroup
    sem chan struct{}
}

func NewWorkerPool(size int) *WorkerPool {
    return &WorkerPool{sem: make(chan struct{}, size)}
}

func (p *WorkerPool) Submit(fn func()) {
    p.sem <- struct{}{}
    p.Add(1)
    go func() {
        defer func() {
            <-p.sem
            p.Done()
        }()
        fn()
    }()
}
```

---

## 13. Anti-Pattern: "God Struct" via Excessive Embedding

```go
// ANTI-PATTERN: too many embeddings → confusing promoted API
type GodService struct {
    *http.Client           // HTTP methods
    *redis.Client          // Redis commands
    *sql.DB                // SQL methods
    *slog.Logger           // logging methods
    *rate.Limiter          // rate limiting
    prometheus.Registerer  // metrics registration
    // All these methods are NOW PUBLIC on GodService:
    // Get(), Post(), Set(), Ping(), QueryRow(), Info(), Allow(), Register()...
}
```

This is the "God struct" anti-pattern — a struct that does everything. It:
- Has an enormous, confusing public API (all promoted methods)
- Is hard to test (you need real DB, Redis, HTTP for any test)
- Violates single responsibility principle
- Makes it impossible to use any component independently

**Fix:** Use dependency injection with named fields:
```go
type UserService struct {
    httpClient   *http.Client
    cache        *redis.Client
    db           *sql.DB
    logger       *slog.Logger
    // Only public what you explicitly choose
}
```

---

## 14. Embedding in the context.Context Pattern

```go
// Context key types prevent collisions:
type contextKey struct{ name string }

var (
    userKey    = contextKey{"user"}
    requestKey = contextKey{"request"}
)

// Request context struct embeds common context values:
type RequestContext struct {
    context.Context
    User      *User
    RequestID string
    StartTime time.Time
}

func NewRequestContext(ctx context.Context, user *User) *RequestContext {
    return &RequestContext{
        Context:   ctx,
        User:      user,
        RequestID: generateID(),
        StartTime: time.Now(),
    }
}

// Using promoted context methods:
func processRequest(rc *RequestContext) {
    // rc.Done() — from embedded context.Context
    // rc.Err()  — from embedded context.Context
    // rc.User   — own field

    select {
    case <-rc.Done(): // promoted from context.Context
        return
    default:
        doWork(rc.User)
    }
}
```

---

## 15. Versioned API with Embedding

Evolution-safe API design using embedding:

```go
// v1 API types
package v1

type CreateUserRequest struct {
    Name     string `json:"name"     validate:"required"`
    Email    string `json:"email"    validate:"required,email"`
    Password string `json:"password" validate:"required,min=8"`
}

// v2 extends v1
package v2

type CreateUserRequest struct {
    v1.CreateUserRequest           // backward compat — all v1 fields promoted
    Phone   string `json:"phone"   validate:"omitempty,e164"`
    Country string `json:"country" validate:"omitempty,iso3166_1_alpha2"`
}

// v2 handler can accept both v1 and v2 requests via interface:
type UserCreator interface {
    GetEmail() string
    GetPassword() string
}

func (r v1.CreateUserRequest) GetEmail() string    { return r.Email }
func (r v1.CreateUserRequest) GetPassword() string { return r.Password }
// v2.CreateUserRequest inherits these via embedding
```

---

## 16. Observability: Tracing Method Calls Through Embedding

```go
// Instrumented wrapper pattern
type InstrumentedDB struct {
    *sql.DB
    tracer trace.Tracer
}

func (db *InstrumentedDB) QueryContext(ctx context.Context, query string, args ...interface{}) (*sql.Rows, error) {
    ctx, span := db.tracer.Start(ctx, "db.query",
        trace.WithAttributes(attribute.String("db.statement", query)),
    )
    defer span.End()

    rows, err := db.DB.QueryContext(ctx, query, args...) // delegate
    if err != nil {
        span.RecordError(err)
        span.SetStatus(codes.Error, err.Error())
    }
    return rows, err
}

// All other *sql.DB methods are promoted unchanged
// Only QueryContext, ExecContext are overridden with tracing
```

---

## 17. Security Pattern: Restricted Interface via Embedding

Use embedding to create restricted views of types:

```go
// Full admin service
type AdminService struct {
    db *DB
}

func (s *AdminService) DeleteUser(id int) error     { ... }
func (s *AdminService) GetUser(id int) (*User, error) { ... }
func (s *AdminService) ListUsers() ([]*User, error)  { ... }
func (s *AdminService) ResetPassword(id int) error   { ... }

// Read-only view for regular users — embeds only read methods
type UserReadService interface {
    GetUser(id int) (*User, error)
    ListUsers() ([]*User, error)
}

// In handlers: only inject what the handler needs
func userHandler(s UserReadService) http.Handler {
    // Cannot call s.DeleteUser or s.ResetPassword
    // Interface enforces the security boundary
}
```

---

## 18. Monitoring Embedding Health in Production

Key signals to watch when using embedding patterns:

```go
// Track method call distribution via embedding layers
type MetricedRepository struct {
    base.Repository
    calls *prometheus.CounterVec
}

func (r *MetricedRepository) instrumentedFind(ctx context.Context, method string, fn func() error) error {
    timer := prometheus.NewTimer(r.queryDuration.WithLabelValues(method))
    defer timer.ObserveDuration()

    err := fn()
    status := "ok"
    if err != nil {
        status = "error"
    }
    r.calls.WithLabelValues(method, status).Inc()
    return err
}

// Use in promoted methods:
func (r *MetricedRepository) FindByID(ctx context.Context, id string) (*Entity, error) {
    var result *Entity
    err := r.instrumentedFind(ctx, "find_by_id", func() error {
        var e error
        result, e = r.Repository.FindByID(ctx, id) // calls base
        return e
    })
    return result, err
}
```

---

## 19. When to Use Embedding vs Generics (Go 1.18+)

```go
// BEFORE generics (embedding pattern):
type IntSlice struct{ data []int }
func (s *IntSlice) Add(v int) { s.data = append(s.data, v) }
func (s *IntSlice) Len() int  { return len(s.data) }

type StringSlice struct{ data []string }
func (s *StringSlice) Add(v string) { s.data = append(s.data, v) }
func (s *StringSlice) Len() int     { return len(s.data) }

// AFTER generics (cleaner for type-parameterized behavior):
type Slice[T any] struct{ data []T }
func (s *Slice[T]) Add(v T)  { s.data = append(s.data, v) }
func (s *Slice[T]) Len() int { return len(s.data) }

type IntSlice = Slice[int]
type StringSlice = Slice[string]

// STILL use embedding for mixins (generics don't replace this):
type Model[ID any] struct {
    Auditable   // embedding still valuable for mixins
    SoftDeletable
    id ID
}
```

Embedding and generics solve different problems — they're complementary, not competing.

---

## 20. Comprehensive Architecture: Service Layer with Embedding

```go
// Framework layer (shared infrastructure)
package framework

type BaseService struct {
    logger *slog.Logger
    tracer trace.Tracer
    meter  metric.Meter
}

func (b *BaseService) Logger() *slog.Logger { return b.logger }

func (b *BaseService) Span(ctx context.Context, name string) (context.Context, trace.Span) {
    return b.tracer.Start(ctx, name)
}

// Domain layer
package user

type UserService struct {
    framework.BaseService // promoted: Logger, Span
    repo UserRepository
    cache *redis.Client
}

func (s *UserService) GetUser(ctx context.Context, id string) (*User, error) {
    ctx, span := s.Span(ctx, "user.get") // promoted from BaseService
    defer span.End()

    s.Logger().Info("getting user", "id", id) // promoted from BaseService

    // Check cache first
    if u := s.getFromCache(id); u != nil {
        return u, nil
    }

    return s.repo.FindByID(ctx, id)
}

// Application layer
package app

type Application struct {
    Users   *user.UserService
    Orders  *order.OrderService
    Products *product.ProductService
}
```

---

## 21. Testing the Embedding Hierarchy

```go
// Test that embedding satisfies expected interfaces
func TestInterfaceSatisfaction(t *testing.T) {
    // These lines don't execute — they're compile-time checks
    var _ io.Reader = (*InstrumentedReader)(nil)
    var _ http.ResponseWriter = (*StatusRecorder)(nil)
    var _ store.Interface = (*SpyStore)(nil)
}

// Test that shadowed methods work correctly
func TestShadowingBehavior(t *testing.T) {
    spy := &SpyStore{Interface: newRealStore()}
    spy.Get("id-1")

    if len(spy.calls) != 1 || spy.calls[0] != "Get(id-1)" {
        t.Errorf("expected spy to record Get call, got: %v", spy.calls)
    }
}

// Test that promoted methods delegate correctly
func TestPromotedMethodDelegation(t *testing.T) {
    base := &base.Repository{...}
    user := &UserRepository{Repository: *base}

    count, err := user.Count(ctx) // promoted method
    if err != nil {
        t.Fatal(err)
    }
    if count < 0 {
        t.Errorf("count must be non-negative")
    }
}
```

---

## 22. Documentation Strategy for Embedded Types

```go
// Package doc should describe the embedding contract:

// UserService manages user lifecycle operations.
//
// Embedding contract:
//   UserService embeds framework.BaseService to provide
//   logging, tracing, and metrics. Callers can use
//   service.Logger() and service.Span() directly.
//
// Thread safety:
//   All methods are safe for concurrent use.
//   The embedded BaseService fields are read-only after initialization.
//
// Example:
//   svc := user.NewUserService(repo, cache, baseService)
//   user, err := svc.GetUser(ctx, "user-123")
type UserService struct {
    framework.BaseService
    // ...
}
```

---

## 23. Embedding in CLI Tools

```go
// cobra/urfave-cli pattern: shared flags via embedding

type GlobalFlags struct {
    Verbose bool
    Config  string
    Format  string
}

type UserCreateCmd struct {
    GlobalFlags // promoted: Verbose, Config, Format
    Name  string
    Email string
    Admin bool
}

type UserListCmd struct {
    GlobalFlags // same flags, promoted
    Filter string
    Limit  int
}

// Handler uses only its own command's fields + globals via promotion:
func (cmd *UserCreateCmd) Run() error {
    if cmd.Verbose { // promoted from GlobalFlags
        fmt.Println("Creating user:", cmd.Name)
    }
    // ...
}
```

---

## 24. The Go Standard Library's Embedding Wisdom

Key embedding usages in the standard library to study:

```go
// net/http: ResponseWriter decoration
type http.response struct{ ... }
// Internal, not exported — demonstrates the pattern

// bufio: combining Reader and Writer
type bufio.ReadWriter struct {
    *Reader
    *Writer
}

// sync: embedding in higher-level constructs
type sync.Map struct { ... }
// NOT embedded publicly — teaches when NOT to embed

// context: interface embedding
type valueCtx struct {
    Context           // embeds context.Context interface
    key, val any
}
// Overrides Value() only; all other Context methods promoted

// testing: embedding for extensibility
type testing.common struct { ... }
type testing.T struct { common; ... }
type testing.B struct { common; ... }
// common is embedded in both T and B — shared behavior
```

---

## 25. Reflection and Embedding

Embedded struct fields appear in `reflect.Type.Field()` but are marked as anonymous:

```go
type Inner struct { Value int }
type Outer struct { Inner; Extra string }

t := reflect.TypeOf(Outer{})
for i := 0; i < t.NumField(); i++ {
    f := t.Field(i)
    fmt.Printf("Name=%-10s Anonymous=%-5v Type=%v\n",
        f.Name, f.Anonymous, f.Type)
}
// Name=Inner      Anonymous=true  Type=main.Inner
// Name=Extra      Anonymous=false Type=string

// To find promoted fields (including from embedded):
// use reflect.Type.FieldByName for lookup across embedding levels
val, ok := t.FieldByName("Value") // found in Inner, returns correctly
fmt.Println(val.Index) // [0 0] — path: field[0].field[0]
```

---

## 26. Memory Alignment and Struct Padding with Embedding

```go
// Understanding alignment is critical for performance
type Small struct {
    Flag bool  // 1 byte
}

type Outer struct {
    Small        // 1 byte for bool
    // 7 bytes padding (to align int64 to 8-byte boundary)
    ID int64     // 8 bytes
}
// Outer total: 16 bytes (not 9!)

// Optimized layout (keep same-size fields together):
type OuterOpt struct {
    ID    int64  // 8 bytes first
    Small        // 1 byte + 7 padding at end
}
// OuterOpt total: 16 bytes — same, but cache-line efficiency differs

// Tool: go-tools structlayout shows exact layout
```

---

## 27. The Complete Embedding Decision Matrix

```
Question                              → Answer                → Use
─────────────────────────────────────────────────────────────────────
Do I need polymorphism?               Yes                     Interface
Do I want transparent access?         Yes + no polymorphism   Embedding
Do I want controlled access?          Yes                     Named field
Is this a mixin/capability?           Yes                     Embedding
Does inner type have many methods?    Yes + all relevant      Embedding
Does inner type have many methods?    Yes + only some         Named field + delegation
Do I need multiple dispatch?          Yes                     Interface + embedding
Is type stability important?          Yes                     Interface
Is performance critical?              Yes                     Value embedding (no pointer)
Is type shared/large?                 Yes                     Pointer embedding
```
