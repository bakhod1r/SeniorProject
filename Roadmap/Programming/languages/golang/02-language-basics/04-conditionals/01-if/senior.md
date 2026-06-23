# if Statement — Senior Level

## 1. Architectural Role of `if` in Go Systems

At the architectural level, `if` statements are the primary mechanism for expressing **invariants and pre-conditions** in Go code. Unlike exception-based languages that separate the happy path from error handling, Go uses explicit `if` checks, making the control flow visible at every function boundary.

**Architectural impact:**

```
Decision Point        Go Pattern              Architectural Intent
─────────────────     ────────────────────    ──────────────────────────────
Pre-condition check   if !valid { return }    Fail-fast, no defensive copying
Error propagation     if err != nil { ... }   Explicit, no hidden jumps
Feature toggle        if flags.Feature { }    Runtime configuration
Rate limit            if !limiter.Allow() { } Circuit breaker implementation
Auth check            if !authenticated { }   Security boundary
```

---

## 2. The Error Handling Spectrum

Go's `if err != nil` is a deliberate choice on the spectrum of error handling designs:

```
Implicit (exceptions)          Explicit (values)
────────────────────────────────────────────────
Python try/except              Go if err != nil
Java throws/catch              Rust Result<T,E>
Swift throws                   Haskell Either
                                   ↑
                               Go is here:
                               maximum visibility
                               minimum magic
```

This has architectural consequences:
- Every function boundary is a potential failure point — visible in the code
- Error paths are as first-class as success paths — must be designed
- Can't accidentally swallow errors — must be explicitly ignored with `_`

---

## 3. Postmortem: The Ignored Error

**Incident:** Service silently drops 5% of messages from a queue.

```go
// Original code:
func processMessages(msgs []Message) {
    for _, msg := range msgs {
        if err := process(msg); err != nil {
            log.Printf("process error: %v", err) // logs but continues
        }
    }
}

// The real bug: `process` returns error but the caller silently continued
// 5% of messages had validation errors that were logged and dropped
```

**Fix:** Make the intent explicit — is this intentional best-effort, or should we stop?

```go
// Option 1: Best-effort with metrics
func processMessages(msgs []Message) {
    for _, msg := range msgs {
        if err := process(msg); err != nil {
            log.Printf("process error: %v", err)
            processErrorsTotal.Inc() // track the drop rate
            if processErrorsTotal.Value() > len(msgs)*0.01 {
                panic("error rate > 1% — something is seriously wrong")
            }
        }
    }
}

// Option 2: Fail fast on first error
func processMessages(msgs []Message) error {
    for _, msg := range msgs {
        if err := process(msg); err != nil {
            return fmt.Errorf("process message %v: %w", msg.ID, err)
        }
    }
    return nil
}
```

---

## 4. Postmortem: The Missing Guard for Nil Pointer

**Incident:** Service panics in production after adding optional caching layer.

```go
// Before cache was added (worked fine):
type UserService struct {
    repo UserRepository
}

func (s *UserService) GetUser(id int) (*User, error) {
    return s.repo.FindByID(id)
}

// After cache was added (introduced bug):
type UserService struct {
    repo  UserRepository
    cache *Cache // optional — sometimes nil
}

func (s *UserService) GetUser(id int) (*User, error) {
    cached := s.cache.Get(id)  // PANIC if cache is nil!
    if cached != nil {
        return cached, nil
    }
    return s.repo.FindByID(id)
}
```

**Fix:** Guard for optional dependencies:

```go
func (s *UserService) GetUser(id int) (*User, error) {
    if s.cache != nil {
        if cached := s.cache.Get(id); cached != nil {
            return cached, nil
        }
    }
    user, err := s.repo.FindByID(id)
    if err != nil {
        return nil, err
    }
    if s.cache != nil {
        s.cache.Set(id, user)
    }
    return user, nil
}
```

**Prevention rule:** Any optional dependency stored as pointer must be guarded with `if field != nil` before use.

---

## 5. Optimizing `if` for Hot Paths

In performance-critical code, `if` statement ordering matters.

```go
// Optimize: put most likely branch first
func classifyRequest(r *Request) RequestType {
    // 95% of requests are reads:
    if r.Method == "GET" { // most likely — checked first
        return TypeRead
    }
    // 4% are writes:
    if r.Method == "POST" {
        return TypeWrite
    }
    // 1% are other:
    return TypeOther
}

// Avoid: rarely-true condition checked first
func classifyRequestBad(r *Request) RequestType {
    if r.Method == "DELETE" { // rare — wastes cycles on hot path
        return TypeDelete
    }
    if r.Method == "GET" { // common — should be first
        return TypeRead
    }
    // ...
}
```

---

## 6. Branch-Free Code — Eliminating `if` in Critical Paths

```go
// Traditional if-based max (may cause branch misprediction):
func maxInt(a, b int) int {
    if a > b { return a }
    return b
}

// Go compiler often generates CMOV (no branch) for simple cases:
// Verify with: go tool compile -S main.go | grep CMOV

// Manual branch-free (for when compiler doesn't optimize):
func maxIntBranchFree(a, b int) int {
    diff := a - b
    // If a > b: diff > 0, sign bit = 0, mask = 0 (all zeros), returns a
    // If a < b: diff < 0, sign bit = 1, mask = -1 (all ones), returns b
    mask := diff >> (bits.UintSize - 1)
    return a - (diff & mask) // a & 0 = a, or a - diff = b
}

// Benchmark to verify improvement before using unsafe tricks:
// go test -bench=BenchmarkMax -benchmem
```

---

## 7. `if` and Interface Design: Asserting Capabilities

```go
// Check for optional interface implementation:
type Flusher interface {
    Flush() error
}

func writeAll(w io.Writer, data []byte) error {
    if _, err := w.Write(data); err != nil {
        return err
    }
    // Only flush if the writer supports it
    if f, ok := w.(Flusher); ok {
        return f.Flush()
    }
    return nil
}

// This pattern appears throughout the standard library:
// http.ResponseWriter → http.Flusher
// net.Conn → net.PacketConn
// io.Reader → io.ReaderAt
```

---

## 8. Sentinel Values and `if`: When to Use Each

```go
// Sentinel value pattern (fast, simple):
var ErrNotFound = errors.New("not found")

func findItem(id string) (*Item, error) {
    // ...
    return nil, ErrNotFound
}

if errors.Is(err, ErrNotFound) { handle404() }

// Error type pattern (more context):
type NotFoundError struct {
    Resource string
    ID       string
}
func (e *NotFoundError) Error() string {
    return fmt.Sprintf("%s %q not found", e.Resource, e.ID)
}

var nfe *NotFoundError
if errors.As(err, &nfe) {
    log.Printf("missing %s %s", nfe.Resource, nfe.ID)
    handle404(nfe)
}
```

---

## 9. Validation Composition Pattern

Building composable validation with `if`:

```go
type ValidationResult struct {
    Valid  bool
    Errors []FieldError
}

type FieldError struct {
    Field   string
    Message string
}

type FieldValidator func(v interface{}) *FieldError

func validate(value interface{}, validators ...FieldValidator) ValidationResult {
    var result ValidationResult
    result.Valid = true
    for _, v := range validators {
        if err := v(value); err != nil {
            result.Valid = false
            result.Errors = append(result.Errors, *err)
        }
    }
    return result
}

func minLength(field string, min int) FieldValidator {
    return func(v interface{}) *FieldError {
        s, ok := v.(string)
        if !ok || len(s) < min {
            return &FieldError{Field: field,
                Message: fmt.Sprintf("minimum length is %d", min)}
        }
        return nil
    }
}
```

---

## 10. `if` in Circuit Breaker Implementation

```go
type CircuitBreaker struct {
    mu           sync.Mutex
    failures     int
    lastFailTime time.Time
    state        string // "closed", "open", "half-open"
    threshold    int
    timeout      time.Duration
}

func (cb *CircuitBreaker) Allow() bool {
    cb.mu.Lock()
    defer cb.mu.Unlock()

    if cb.state == "closed" {
        return true
    }

    if cb.state == "open" {
        if time.Since(cb.lastFailTime) > cb.timeout {
            cb.state = "half-open"
            return true
        }
        return false
    }

    // half-open: allow one request through
    return true
}

func (cb *CircuitBreaker) RecordFailure() {
    cb.mu.Lock()
    defer cb.mu.Unlock()

    cb.failures++
    cb.lastFailTime = time.Now()
    if cb.failures >= cb.threshold {
        cb.state = "open"
    }
}
```

---

## 11. Defensive Programming with `if`

```go
// Panic-safe type assertion:
func safeAssert(i interface{}) (string, bool) {
    s, ok := i.(string) // comma-ok idiom — never panics
    return s, ok
}

// vs unsafe single-value assertion:
// s := i.(string)  // panics if i is not string!

// Defensive map access:
func safeGet(m map[string][]int, key string) []int {
    if v, ok := m[key]; ok {
        return v
    }
    return nil // not []int{} — return nil for zero-allocation
}

// Defensive slice access:
func safeIndex(s []string, i int) string {
    if i < 0 || i >= len(s) {
        return ""
    }
    return s[i]
}
```

---

## 12. `if` in Rate Limiting

```go
type RateLimiter struct {
    tokens chan struct{}
    ticker *time.Ticker
    done   chan struct{}
}

func NewRateLimiter(rps int) *RateLimiter {
    rl := &RateLimiter{
        tokens: make(chan struct{}, rps),
        ticker: time.NewTicker(time.Second / time.Duration(rps)),
        done:   make(chan struct{}),
    }
    go rl.refill()
    return rl
}

func (rl *RateLimiter) Allow() bool {
    select {
    case <-rl.tokens:
        return true
    default:
        return false
    }
}

func handleRequest(w http.ResponseWriter, r *http.Request, rl *RateLimiter) {
    if !rl.Allow() {
        http.Error(w, "rate limit exceeded", http.StatusTooManyRequests)
        return
    }
    // process request
}
```

---

## 13. `if` for Security Boundaries

Security checks must be explicit, not implicit. `if` is the mechanism.

```go
func adminHandler(w http.ResponseWriter, r *http.Request) {
    // Authentication check
    user := getUserFromContext(r.Context())
    if user == nil {
        http.Error(w, "unauthorized", http.StatusUnauthorized)
        return
    }

    // Authorization check
    if !user.HasRole("admin") {
        http.Error(w, "forbidden", http.StatusForbidden)
        return
    }

    // CSRF protection
    if !validateCSRFToken(r) {
        http.Error(w, "invalid CSRF token", http.StatusForbidden)
        return
    }

    // Only admins with valid CSRF token reach here
    performAdminAction(w, r)
}
```

**Security rule:** Never use `else` for security checks — always guard with early return. This prevents accidentally reaching the privileged code path.

---

## 14. `if` in Graceful Shutdown

```go
func (s *Server) Shutdown(ctx context.Context) error {
    if !atomic.CompareAndSwapInt32(&s.shutdownFlag, 0, 1) {
        return ErrAlreadyShuttingDown
    }

    close(s.quit) // signal goroutines to stop

    // Wait for ongoing requests with timeout
    done := make(chan struct{})
    go func() {
        s.wg.Wait()
        close(done)
    }()

    select {
    case <-ctx.Done():
        if ctx.Err() == context.DeadlineExceeded {
            return fmt.Errorf("shutdown timed out: %d requests still active", s.activeRequests)
        }
        return ctx.Err()
    case <-done:
        return nil
    }
}
```

---

## 15. Observability: Instrumenting `if` Branches

```go
var (
    requestsTotal   = prometheus.NewCounterVec(...)
    cacheHitsTotal  = prometheus.NewCounter(...)
    cacheMissesTotal = prometheus.NewCounter(...)
)

func (h *Handler) GetUser(ctx context.Context, id string) (*User, error) {
    // Instrument every branch for observability
    if user := h.cache.Get(id); user != nil {
        cacheHitsTotal.Inc()
        return user, nil
    }
    cacheMissesTotal.Inc()

    user, err := h.repo.Find(ctx, id)
    if err != nil {
        if errors.Is(err, ErrNotFound) {
            requestsTotal.WithLabelValues("not_found").Inc()
            return nil, err
        }
        requestsTotal.WithLabelValues("error").Inc()
        return nil, err
    }

    requestsTotal.WithLabelValues("ok").Inc()
    h.cache.Set(id, user)
    return user, nil
}
```

---

## 16. Cross-Cutting Concerns via `if` Guards

```go
// Middleware pattern using if guards:
func withTracing(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        if !tracingEnabled {
            next.ServeHTTP(w, r)
            return
        }

        ctx, span := tracer.Start(r.Context(), r.URL.Path)
        defer span.End()

        next.ServeHTTP(w, r.WithContext(ctx))
    })
}

func withMetrics(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        if !metricsEnabled {
            next.ServeHTTP(w, r)
            return
        }

        start := time.Now()
        rec := newResponseRecorder(w)
        next.ServeHTTP(rec, r)
        requestDuration.WithLabelValues(r.Method, strconv.Itoa(rec.status)).
            Observe(time.Since(start).Seconds())
    })
}
```

---

## 17. `if` in Retry Logic

```go
func withRetry(ctx context.Context, maxAttempts int, fn func() error) error {
    var lastErr error
    for attempt := 1; attempt <= maxAttempts; attempt++ {
        if err := ctx.Err(); err != nil {
            return fmt.Errorf("retry: context cancelled: %w", err)
        }

        if err := fn(); err != nil {
            lastErr = err

            // Don't retry on non-retryable errors
            if !isRetryable(err) {
                return fmt.Errorf("non-retryable error: %w", err)
            }

            // Exponential backoff
            backoff := time.Duration(attempt) * 100 * time.Millisecond
            select {
            case <-time.After(backoff):
            case <-ctx.Done():
                return fmt.Errorf("retry: context cancelled during backoff: %w", ctx.Err())
            }
            continue
        }
        return nil // success
    }
    return fmt.Errorf("all %d attempts failed, last error: %w", maxAttempts, lastErr)
}
```

---

## 18. Testing `if` Branches in Integration Tests

```go
func TestUserService_GetUser_Integration(t *testing.T) {
    db := setupTestDB(t)
    svc := NewUserService(db, nil) // cache = nil

    t.Run("found", func(t *testing.T) {
        user := createTestUser(t, db)
        got, err := svc.GetUser(context.Background(), user.ID)
        require.NoError(t, err)
        assert.Equal(t, user.ID, got.ID)
    })

    t.Run("not found — tests nil return branch", func(t *testing.T) {
        _, err := svc.GetUser(context.Background(), "nonexistent")
        require.ErrorIs(t, err, ErrNotFound)
    })

    t.Run("with cache — tests cache branch", func(t *testing.T) {
        cache := newTestCache()
        svc2 := NewUserService(db, cache)
        user := createTestUser(t, db)

        // First call — cache miss
        got, _ := svc2.GetUser(context.Background(), user.ID)
        assert.Equal(t, 1, cache.GetCount()) // fetched from DB

        // Second call — cache hit
        got2, _ := svc2.GetUser(context.Background(), user.ID)
        assert.Equal(t, 1, cache.GetCount()) // NOT incremented
        assert.Equal(t, got.ID, got2.ID)
    })
}
```

---

## 19. `if` and the Go Scheduler

```go
// Long-running computations should check for preemption:
func heavyComputation(data []int, ctx context.Context) error {
    for i, v := range data {
        // Check context every N iterations
        if i%1000 == 0 {
            if err := ctx.Err(); err != nil {
                return fmt.Errorf("cancelled at position %d: %w", i, err)
            }
            runtime.Gosched() // yield to other goroutines
        }
        process(v)
    }
    return nil
}
```

---

## 20. Architecture Decision: `if` Chains vs Strategy Pattern

```go
// if-else chain (appropriate for 2-4 cases):
func renderFormat(data interface{}, format string) ([]byte, error) {
    if format == "json" {
        return json.Marshal(data)
    }
    if format == "yaml" {
        return yaml.Marshal(data)
    }
    return nil, fmt.Errorf("unknown format: %s", format)
}

// Strategy pattern (appropriate for 5+ cases, extensible):
type Renderer interface {
    Render(data interface{}) ([]byte, error)
}

var renderers = map[string]Renderer{
    "json": &JSONRenderer{},
    "yaml": &YAMLRenderer{},
    "xml":  &XMLRenderer{},
    "csv":  &CSVRenderer{},
    "toml": &TOMLRenderer{},
}

func renderFormat(data interface{}, format string) ([]byte, error) {
    r, ok := renderers[format]
    if !ok {
        return nil, fmt.Errorf("unknown format: %s", format)
    }
    return r.Render(data)
}
```

---

## 21. Concurrency-Safe `if` Patterns

```go
// WRONG: check-then-act race condition
if _, ok := m[key]; !ok {
    m[key] = value // race: another goroutine may have set key
}

// CORRECT: atomic load-or-store
var mu sync.Mutex
mu.Lock()
if _, ok := m[key]; !ok {
    m[key] = value
}
mu.Unlock()

// Or use sync.Map for simple cases:
actual, loaded := sm.LoadOrStore(key, value)
if !loaded {
    // we stored the new value
}
```

---

## 22. `if` for Data Consistency Checks

```go
// Invariant checking in critical code paths:
func (tx *Transaction) Commit() error {
    if tx.committed {
        return ErrAlreadyCommitted
    }
    if tx.rolledBack {
        return ErrAlreadyRolledBack
    }
    if len(tx.operations) == 0 {
        return ErrEmptyTransaction
    }

    // Validate consistency of operations
    for i, op := range tx.operations {
        if op.Version != tx.expectedVersion+int64(i) {
            return fmt.Errorf("version mismatch at operation %d", i)
        }
    }

    return tx.doCommit()
}
```

---

## 23. `if` Complexity Metrics in Code Review

Rules for code review:
- **Nesting depth > 3:** Must be refactored (guard clauses or extracted function)
- **else after return:** Flag and fix
- **Boolean flag parameters:** Candidate for separate functions
- **Complex conditions (> 3 operators):** Extract to named variable

```go
// Code review: too complex — extract and name
if user.Age >= 18 && user.IsActive && !user.IsBlocked &&
   user.Balance >= item.Price && item.Stock > 0 &&
   user.Country == item.AvailableCountry {
   // ...
}

// Better: extract to method or named bool
canPurchase := user.CanPurchase(item)
if canPurchase {
    // ...
}
```

---

## 24. Pattern: `if` in Health Check Handlers

```go
func (h *HealthHandler) Ready(w http.ResponseWriter, r *http.Request) {
    type Check struct {
        Name   string
        Status string
        Error  string `json:",omitempty"`
    }
    var checks []Check
    allOK := true

    // Database check
    if err := h.db.PingContext(r.Context()); err != nil {
        checks = append(checks, Check{"database", "unhealthy", err.Error()})
        allOK = false
    } else {
        checks = append(checks, Check{"database", "healthy", ""})
    }

    // Cache check
    if err := h.cache.Ping(r.Context()); err != nil {
        checks = append(checks, Check{"cache", "degraded", err.Error()})
        // Don't set allOK=false: cache is optional
    } else {
        checks = append(checks, Check{"cache", "healthy", ""})
    }

    status := http.StatusOK
    if !allOK {
        status = http.StatusServiceUnavailable
    }

    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(status)
    json.NewEncoder(w).Encode(map[string]interface{}{
        "status": map[bool]string{true: "ready", false: "not ready"}[allOK],
        "checks": checks,
    })
}
```

---

## 25. The `if` Statement and API Design

Well-designed APIs minimize the `if` statements callers need:

```go
// Bad API: callers write many if checks
func GetUser(id string) *User         // nil on error — forces nil check
func CountUsers() int                  // -1 on error — forces error check
func IsEnabled(feature string) bool    // false on error — ambiguous

// Good API: explicit types reduce needed if checks
func GetUser(id string) (*User, error) // caller checks err, never nil checks unexpectedly
func CountUsers() (int, error)         // caller checks err once
func IsEnabled(feature string) (bool, error) // caller checks err, knows result is intentional

// Even better for callers: zero value design
type FeatureSet struct{ features map[string]bool }
func (f *FeatureSet) IsEnabled(name string) bool {
    return f.features[name] // false for unknown features — no error needed
}
```

---

## 26. `if` in Cleanup Patterns

```go
// Safe cleanup with if checks:
func cleanupResources(resources []io.Closer) error {
    var errs []error
    for _, r := range resources {
        if r == nil {
            continue // skip nil resources
        }
        if err := r.Close(); err != nil {
            errs = append(errs, err)
        }
    }
    if len(errs) > 0 {
        return fmt.Errorf("cleanup errors: %v", errs)
    }
    return nil
}
```

---

## 27. Future Proofing: `if err != nil` and Go 2

Proposed Go changes to reduce `if err != nil` verbosity (not yet accepted):

```go
// Proposed (not in Go yet):
result := must parse(data)  // panics on error
result := check parse(data) // returns error up call stack

// Current Go (and likely to stay):
result, err := parse(data)
if err != nil {
    return fmt.Errorf("parse: %w", err)
}
```

Understanding why this hasn't changed: Go prioritizes explicitness and teachability over brevity. Every `if err != nil` is clear about what it does — no magic.

