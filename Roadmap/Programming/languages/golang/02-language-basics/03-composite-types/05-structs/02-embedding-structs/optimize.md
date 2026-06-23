# Embedding Structs — Optimization Exercises

## Exercise 1 🟢 Eliminate Repeated Logger Field

**Problem:** Every service struct duplicates the logger field.

```go
type UserService struct {
    db     *sql.DB
    logger *slog.Logger
    cache  *redis.Client
}

type OrderService struct {
    db     *sql.DB
    logger *slog.Logger
    cache  *redis.Client
}

type ProductService struct {
    db     *sql.DB
    logger *slog.Logger
    cache  *redis.Client
}

func (s *UserService) doSomething() {
    s.logger.Info("doing something")
}
```

**Task:** Create a base struct and embed it to eliminate the duplication.

<details>
<summary>Solution</summary>

```go
// Base infrastructure struct
type ServiceBase struct {
    db     *sql.DB
    logger *slog.Logger
    cache  *redis.Client
}

func NewServiceBase(db *sql.DB, log *slog.Logger, cache *redis.Client) ServiceBase {
    return ServiceBase{db: db, logger: log, cache: cache}
}

func (b *ServiceBase) log() *slog.Logger { return b.logger }

type UserService struct {
    ServiceBase // promoted: db, logger, cache
}

type OrderService struct {
    ServiceBase
}

type ProductService struct {
    ServiceBase
}

func (s *UserService) doSomething() {
    s.logger.Info("doing something") // promoted access
}

// Construction:
base := NewServiceBase(db, log, cache)
userSvc := &UserService{ServiceBase: base}
orderSvc := &OrderService{ServiceBase: base}
```

**Benefits:**
- DRY: infrastructure fields defined once
- Consistent initialization across all services
- Add new infrastructure (tracer, meter) once in ServiceBase
- Easy to mock the entire base for testing
</details>

---

## Exercise 2 🟢 Reduce Interface Method Boilerplate

**Problem:** Multiple types need to wrap an interface but add only one method.

```go
type Store interface {
    Get(id string) (*Entity, error)
    Set(id string, e *Entity) error
    Delete(id string) error
    List() ([]*Entity, error)
    Count() int
}

// CachedStore needs to override only Get:
type CachedStore struct {
    inner Store    // named field — must delegate all methods manually
    cache *Cache
}

func (c *CachedStore) Get(id string) (*Entity, error) { /* cache logic */ return c.inner.Get(id) }
func (c *CachedStore) Set(id string, e *Entity) error  { return c.inner.Set(id, e) }
func (c *CachedStore) Delete(id string) error          { return c.inner.Delete(id) }
func (c *CachedStore) List() ([]*Entity, error)        { return c.inner.List() }
func (c *CachedStore) Count() int                      { return c.inner.Count() }
// 5 methods, only 1 is custom
```

**Task:** Use interface embedding to eliminate delegation boilerplate.

<details>
<summary>Solution</summary>

```go
// Using embedding — only override what you customize
type CachedStore struct {
    Store // embedded interface — all methods promoted
    cache *Cache
}

// Override ONLY the method that differs:
func (c *CachedStore) Get(id string) (*Entity, error) {
    if data := c.cache.Get(id); data != nil {
        return data, nil
    }
    entity, err := c.Store.Get(id) // delegate to wrapped store
    if err == nil {
        c.cache.Set(id, entity)
    }
    return entity, err
}

// All other methods (Set, Delete, List, Count) are promoted from c.Store
// No boilerplate needed!

// Usage:
cached := &CachedStore{
    Store: realStore, // concrete implementation
    cache: newCache(),
}
var _ Store = cached // still satisfies interface
```

**Before:** 5 delegation methods + 1 custom = 6 methods
**After:** 1 custom method (4 delegations eliminated via embedding)

This pattern is especially powerful for large interfaces — save N-1 delegation methods where N is interface size.
</details>

---

## Exercise 3 🟢 Avoid Rewriting HTTP Handler Methods

**Problem:** Custom response writer wrapper duplicates all `ResponseWriter` methods.

```go
type TimingWriter struct {
    w         http.ResponseWriter
    startTime time.Time
}

func (tw *TimingWriter) Header() http.Header               { return tw.w.Header() }
func (tw *TimingWriter) Write(b []byte) (int, error)       { return tw.w.Write(b) }
func (tw *TimingWriter) WriteHeader(statusCode int)        { tw.w.WriteHeader(statusCode) }
// All three methods are pure delegation
```

**Task:** Use embedding to eliminate the delegation methods.

<details>
<summary>Solution</summary>

```go
type TimingWriter struct {
    http.ResponseWriter // embedded — Header, Write, WriteHeader all promoted
    startTime time.Time
}

// Only override the one method that needs custom behavior:
func (tw *TimingWriter) WriteHeader(statusCode int) {
    duration := time.Since(tw.startTime)
    log.Printf("Response %d after %v", statusCode, duration)
    tw.ResponseWriter.WriteHeader(statusCode) // delegate
}

// Header() and Write() are promoted from embedded ResponseWriter — no code needed!

// Usage in middleware:
func TimingMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        tw := &TimingWriter{ResponseWriter: w, startTime: time.Now()}
        next.ServeHTTP(tw, r)
    })
}
```

**Before:** 3 delegation methods
**After:** 1 override method (2 delegations eliminated)

Any future methods added to `http.ResponseWriter` are automatically promoted.
</details>

---

## Exercise 4 🟡 Reduce Memory Usage with Value vs Pointer Embedding

**Problem:** Large structs embedded by pointer cause cache misses.

```go
type LargeConfig struct {
    Data [4096]byte
    Meta [512]byte
}

type ServiceA struct {
    *LargeConfig // pointer — each access requires following the pointer
    ID int
}

// Under high load: many ServiceA instances accessing Config causes cache thrashing
// Each config access = pointer dereference = potential cache miss
```

**Task:** Analyze when to embed by value vs pointer, and design accordingly.

<details>
<summary>Solution</summary>

```go
// Key question: Is LargeConfig shared or owned?

// Pattern 1: Config is small and owned → embed by value
type SmallConfig struct {
    Debug bool
    Port  int
    // ~16 bytes total — fits in 1 cache line with ServiceA
}

type Service struct {
    SmallConfig // by value — config is IN the service struct, no indirection
    ID int
}

// Benchmark impact:
// Value embedding: 1 cache line load gets both Service.ID and Service.Debug
// Pointer embedding: 1 load for Service, then 1 more for Config data

// Pattern 2: Config is large → keep as pointer but prefetch/batch
type LargeConfig struct {
    Data [4096]byte
}

// Separate hot (frequently accessed) from cold (rarely accessed) config:
type HotConfig struct {
    Debug bool   // accessed every request
    Port  int    // accessed every request
}

type ColdConfig struct {
    TLSCert string // accessed once at startup
    TLSKey  string
}

type Service struct {
    HotConfig  // by value — accessed every request, cache-friendly
    cold *ColdConfig // by pointer — accessed rarely, cache miss OK
    ID   int
}
```

**Measurement approach:**
```bash
go test -bench=BenchmarkServiceProcess -benchmem -cpuprofile=cpu.prof
go tool pprof cpu.prof
# Look for cache miss patterns in flame graph
```
</details>

---

## Exercise 5 🟡 Replace Embedding with Interface for Better Testability

**Problem:** Embedding concrete type makes testing difficult.

```go
type EmailClient struct {
    apiKey string
}
func (c *EmailClient) Send(to, subject, body string) error {
    // Actually sends email via SMTP
    return nil
}

type NotificationService struct {
    *EmailClient // embedded — hard to mock in tests!
    templates map[string]string
}

func (s *NotificationService) SendWelcome(userEmail string) error {
    return s.Send(userEmail, "Welcome!", s.templates["welcome"])
}

// In tests: creating NotificationService requires a real EmailClient
// Cannot mock Send to avoid actual email sending
```

**Task:** Refactor to use interface-based dependency for testability.

<details>
<summary>Solution</summary>

```go
// Define interface
type Mailer interface {
    Send(to, subject, body string) error
}

// EmailClient satisfies Mailer (via its Send method)
// No changes to EmailClient needed

type NotificationService struct {
    mailer    Mailer // interface — not embedding
    templates map[string]string
}

func NewNotificationService(mailer Mailer, templates map[string]string) *NotificationService {
    return &NotificationService{mailer: mailer, templates: templates}
}

func (s *NotificationService) SendWelcome(userEmail string) error {
    return s.mailer.Send(userEmail, "Welcome!", s.templates["welcome"])
}

// Test with a fake:
type fakeMailer struct {
    sentEmails []string
}
func (f *fakeMailer) Send(to, subject, body string) error {
    f.sentEmails = append(f.sentEmails, to)
    return nil
}

func TestSendWelcome(t *testing.T) {
    fake := &fakeMailer{}
    svc := NewNotificationService(fake, map[string]string{"welcome": "Hello!"})
    svc.SendWelcome("alice@example.com")
    if len(fake.sentEmails) != 1 || fake.sentEmails[0] != "alice@example.com" {
        t.Error("expected welcome email")
    }
}
```

**Trade-off:** We lose the brevity of `s.Send()` vs `s.mailer.Send()`, but gain testability and flexibility. This is almost always the right trade for business logic.
</details>

---

## Exercise 6 🟡 Flatten Deep Embedding with a Shared Mixin

**Problem:** Same fields duplicated at multiple levels.

```go
type Auditable struct {
    CreatedBy string
    UpdatedBy string
}

type Model struct {
    Auditable        // embedded
    CreatedAt time.Time
    UpdatedAt time.Time
}

type User struct {
    Model         // embeds Model which embeds Auditable
    Name string
}
// User access: u.CreatedBy (2 levels deep), u.CreatedAt (1 level deep)

type Order struct {
    Model
    Total float64
}
// Same depth issue for Order
```

**Task:** Flatten the structure for simpler access.

<details>
<summary>Solution</summary>

```go
// Option 1: Flatten into single mixin
type Metadata struct {
    CreatedAt time.Time
    UpdatedAt time.Time
    CreatedBy string
    UpdatedBy string
}

func (m *Metadata) SetCreated(by string) {
    now := time.Now()
    m.CreatedAt = now
    m.UpdatedAt = now
    m.CreatedBy = by
    m.UpdatedBy = by
}

func (m *Metadata) SetUpdated(by string) {
    m.UpdatedAt = time.Now()
    m.UpdatedBy = by
}

type User struct {
    Metadata      // single level embedding — all fields at same depth
    ID   int
    Name string
}

type Order struct {
    Metadata
    ID    int
    Total float64
}

// Access is now at the same depth for all metadata:
u.CreatedAt  // was u.Model.CreatedAt (1 hop) — now 0 hops
u.CreatedBy  // was u.Model.Auditable.CreatedBy (2 hops) — now 0 hops

// Option 2: Keep separate but use interface
type HasAudit interface {
    SetCreated(by string)
    SetUpdated(by string)
}

// Both approaches reduce the embedding depth for cleaner access
```
</details>

---

## Exercise 7 🟡 Optimize Interface Satisfaction via Embedding

**Problem:** Implementing a large interface for a decorator type.

```go
type DatabaseIterator interface {
    Next() bool
    Scan(dest ...interface{}) error
    Close() error
    Columns() ([]string, error)
    ColumnTypes() ([]*sql.ColumnType, error)
    Err() error
}

// Decorator that adds logging — must implement ALL 6 methods:
type LoggingIterator struct {
    iter   DatabaseIterator
    logger *slog.Logger
}

func (l *LoggingIterator) Next() bool               { return l.iter.Next() }
func (l *LoggingIterator) Scan(d ...interface{}) error { return l.iter.Scan(d...) }
func (l *LoggingIterator) Close() error              { return l.iter.Close() }
func (l *LoggingIterator) Columns() ([]string, error) { return l.iter.Columns() }
func (l *LoggingIterator) ColumnTypes() ([]*sql.ColumnType, error) { return l.iter.ColumnTypes() }
func (l *LoggingIterator) Err() error                { return l.iter.Err() }
// All 6 methods are pure delegation except maybe Next!
```

**Task:** Use interface embedding to eliminate delegation.

<details>
<summary>Solution</summary>

```go
type LoggingIterator struct {
    DatabaseIterator // embedded interface — 5 methods promoted automatically
    logger *slog.Logger
}

// Only override the method(s) you actually customize:
func (l *LoggingIterator) Next() bool {
    ok := l.DatabaseIterator.Next()
    if !ok {
        l.logger.Info("iterator exhausted")
    }
    return ok
}

func (l *LoggingIterator) Close() error {
    err := l.DatabaseIterator.Close()
    if err != nil {
        l.logger.Error("close failed", "err", err)
    }
    return err
}

// Scan, Columns, ColumnTypes, Err are promoted — no code needed!

// Usage:
logIter := &LoggingIterator{
    DatabaseIterator: realIterator,
    logger:           slog.Default(),
}
var _ DatabaseIterator = logIter // still satisfies interface
```

**Reduction:** 6 methods → 2 methods (4 delegations eliminated).

The interface embedding technique is most valuable for large interfaces where your decorator only customizes 1-2 methods.
</details>

---

## Exercise 8 🔴 Optimize Method Set for Interface Compliance

**Problem:** Failing to satisfy an interface due to incorrect embedding strategy.

```go
type Processor interface {
    Process(data []byte) ([]byte, error)
    Reset()
}

type BaseProcessor struct{}
func (b *BaseProcessor) Reset() { } // pointer receiver

type CompressionProcessor struct {
    BaseProcessor // embedded by value
}
func (c *CompressionProcessor) Process(data []byte) ([]byte, error) {
    return compress(data), nil
}

// Problem: CompressionProcessor (value) doesn't satisfy Processor
// because Reset requires *BaseProcessor but we embed BaseProcessor (value)
var _ Processor = CompressionProcessor{} // COMPILE ERROR
```

**Task:** Fix the embedding strategy so `CompressionProcessor` satisfies `Processor`.

<details>
<summary>Solution</summary>

```go
// Fix 1: Change embedding to pointer
type CompressionProcessor struct {
    *BaseProcessor // pointer embedding — Reset promoted to both value and pointer types
}

var _ Processor = &CompressionProcessor{} // satisfies Processor

// Initialization requires explicit pointer:
cp := &CompressionProcessor{BaseProcessor: &BaseProcessor{}}
cp.Process(data)
cp.Reset()

// Fix 2: Change Reset to value receiver (if no mutation needed)
func (b BaseProcessor) Reset() {} // value receiver — promoted to both value and *value

type CompressionProcessor struct {
    BaseProcessor // value embedding OK now
}

var _ Processor = CompressionProcessor{} // now satisfies Processor

// Fix 3: Add Reset directly to CompressionProcessor
type CompressionProcessor struct {
    BaseProcessor
}

func (c *CompressionProcessor) Reset() {
    c.BaseProcessor.Reset() // explicit delegation
}

// This shadows the promoted Reset — CompressionProcessor.Reset has pointer receiver
// *CompressionProcessor satisfies Processor
var _ Processor = &CompressionProcessor{}
```

**Decision matrix:**
- Small embedded type, no pointer semantics needed → change to value receiver
- Embedded type has important pointer semantics → use pointer embedding
- Need full control over both value and pointer method sets → explicitly define on outer
</details>

---

## Exercise 9 🔴 Benchmark Embedded vs Named Field Method Call Overhead

**Problem:** Team disputes whether embedding adds method call overhead vs named fields.

**Task:** Write benchmarks to measure the actual performance difference.

<details>
<summary>Solution</summary>

```go
package embedding_test

import (
    "testing"
)

type Counter struct{ n int64 }
func (c *Counter) Inc() { c.n++ }
func (c *Counter) Value() int64 { return c.n }

// Embedding:
type EmbeddedCounter struct {
    Counter
    name string
}

// Named field:
type NamedCounter struct {
    c    Counter
    name string
}

func (nc *NamedCounter) Inc()         { nc.c.Inc() }
func (nc *NamedCounter) Value() int64 { return nc.c.Value() }

func BenchmarkEmbedded(b *testing.B) {
    ec := &EmbeddedCounter{name: "test"}
    for i := 0; i < b.N; i++ {
        ec.Inc() // calls Counter.Inc via promotion
    }
    _ = ec.Value()
}

func BenchmarkNamed(b *testing.B) {
    nc := &NamedCounter{name: "test"}
    for i := 0; i < b.N; i++ {
        nc.Inc() // calls delegation method → Counter.Inc
    }
    _ = nc.Value()
}

// Expected results (when methods are inlined):
// BenchmarkEmbedded-8  1000000000  0.25 ns/op
// BenchmarkNamed-8     1000000000  0.25 ns/op  ← identical (both inlined)

// When methods are NOT inlined (//go:noinline):
// BenchmarkEmbedded-8  500000000  1.2 ns/op
// BenchmarkNamed-8     300000000  2.1 ns/op  ← extra call frame for delegation
```

**Conclusion:** For inlinable methods, embedding and named fields have identical performance. For non-inlinable methods, embedding is slightly faster (one fewer call frame). The performance difference is rarely significant — choose based on API clarity.
</details>

---

## Exercise 10 🔴 Optimize Large Interface Implementation via Embedding

**Problem:** Large `io.ReadWriteCloser` + extra methods must be wrapped.

```go
type ExtendedRWC interface {
    io.ReadWriteCloser     // Read, Write, Close
    Flush() error
    Stat() (os.FileInfo, error)
    Seek(offset int64, whence int) (int64, error)
    Truncate(size int64) error
    Sync() error
}

// Logging wrapper must implement all 8 methods:
type LoggingRWC struct {
    inner  ExtendedRWC
    logger *slog.Logger
}
// 8 delegation methods needed...
```

**Task:** Use embedding to minimize the implementation.

<details>
<summary>Solution</summary>

```go
type LoggingRWC struct {
    ExtendedRWC // embedded interface — 7 methods promoted
    logger *slog.Logger
}

// Only override methods that need logging:
func (l *LoggingRWC) Read(p []byte) (int, error) {
    n, err := l.ExtendedRWC.Read(p)
    if err != nil && err != io.EOF {
        l.logger.Error("read failed", "err", err, "n", n)
    }
    return n, err
}

func (l *LoggingRWC) Write(p []byte) (int, error) {
    n, err := l.ExtendedRWC.Write(p)
    if err != nil {
        l.logger.Error("write failed", "err", err, "wrote", n, "wanted", len(p))
    }
    return n, err
}

func (l *LoggingRWC) Close() error {
    err := l.ExtendedRWC.Close()
    if err != nil {
        l.logger.Error("close failed", "err", err)
    }
    return err
}

// Flush, Stat, Seek, Truncate, Sync are promoted — no code needed!

// Verify:
var _ ExtendedRWC = &LoggingRWC{}

// Usage:
loggedFile := &LoggingRWC{
    ExtendedRWC: os.Stdout, // or any file
    logger:      slog.Default(),
}
loggedFile.Write([]byte("hello")) // logged
loggedFile.Flush()                // delegated to os.Stdout (no-op)
```

**Before:** 8 delegation/custom methods
**After:** 3 custom methods (5 delegations eliminated)

For a 20-method interface with 3 customizations, this saves 17 boilerplate methods.
</details>

---

## Exercise 11 🔴 Memory-Efficient Embedding for High-Volume Objects

**Problem:** Creating millions of small objects where each carries embedded data.

```go
type Event struct {
    Metadata struct {
        TraceID   string
        RequestID string
        UserID    string
    }
    Payload []byte
    Kind    string
}
// Each Event: ~80 bytes for metadata strings + payload
// At 1M events/second: 80MB/sec of metadata alone
```

**Task:** Optimize memory usage for high-volume event objects.

<details>
<summary>Solution</summary>

```go
// Strategy 1: Intern common strings (TraceID, UserID often repeat)
var internPool sync.Map

func intern(s string) string {
    if v, ok := internPool.Load(s); ok {
        return v.(string)
    }
    internPool.Store(s, s)
    return s
}

type Event struct {
    traceID   string // interned — same string shared
    requestID string // unique per request — not interned
    userID    string // interned — users repeat
    Payload   []byte
    Kind      string
}

// Strategy 2: Pool Events to reduce GC pressure
var eventPool = sync.Pool{
    New: func() interface{} { return &Event{} },
}

func NewEvent(kind string, payload []byte) *Event {
    e := eventPool.Get().(*Event)
    e.Kind = kind
    e.Payload = payload[:len(payload)] // reuse payload slice if possible
    return e
}

func ReleaseEvent(e *Event) {
    e.traceID = ""
    e.requestID = ""
    e.userID = ""
    e.Payload = e.Payload[:0]
    e.Kind = ""
    eventPool.Put(e)
}

// Strategy 3: Separate hot and cold embedding
type EventHot struct {
    Kind    string // always accessed
    Payload []byte // always accessed
}

type EventCold struct {
    TraceID   string // only accessed in error paths
    RequestID string
    UserID    string
}

type Event struct {
    EventHot        // hot fields first — cache line friendly
    cold *EventCold // pointer to cold — only allocated when needed
}

// 1M events: hot path only touches EventHot (24 bytes)
// EventCold (48+ bytes) only allocated when metadata needed (e.g., error logging)
```
</details>
