# Struct Tags & JSON — Senior Level

## 1. Architectural Role of Struct Tags in Go Systems

Struct tags are Go's primary mechanism for declarative, cross-cutting concerns in data transformation. At the architectural level, they solve the boundary translation problem: mapping between internal domain types and external representations (JSON, SQL, YAML, etc.) without polluting domain logic.

**The clean architecture perspective:**

```
External World          Boundary Layer           Domain
─────────────          ──────────────           ──────
HTTP JSON body    →    input struct tags    →    domain model
                        (validation, mapping)
Domain model      →    output struct tags   →    HTTP JSON response
                        (field exclusion, naming)
Domain model      →    db struct tags       →    SQL rows
                        (column mapping)
```

Struct tags make these transformations declarative, keeping transformation code out of business logic.

---

## 2. Type System Design: Input/Output Type Separation

Never expose your domain model directly through an API. Design explicit DTO (Data Transfer Object) types.

```go
// domain/user.go — pure domain model, no tags
type User struct {
    ID           UserID
    Email        Email
    PasswordHash PasswordHash
    Role         Role
    Preferences  UserPreferences
    CreatedAt    time.Time
    UpdatedAt    time.Time
    DeletedAt    *time.Time
}

// api/v1/users.go — API layer types
type CreateUserInput struct {
    Name     string `json:"name"     validate:"required,min=1,max=100"`
    Email    string `json:"email"    validate:"required,email"`
    Password string `json:"password" validate:"required,min=8,max=72"`
}

type UserResponse struct {
    ID        string    `json:"id"`
    Name      string    `json:"name"`
    Email     string    `json:"email"`
    Role      string    `json:"role"`
    CreatedAt time.Time `json:"created_at"`
}

// Explicit mapping function — controlled, testable
func toUserResponse(u *domain.User) UserResponse {
    return UserResponse{
        ID:        u.ID.String(),
        Name:      u.Name.String(),
        Email:     u.Email.String(),
        Role:      u.Role.String(),
        CreatedAt: u.CreatedAt,
    }
}
```

---

## 3. Performance: Reflection Caching in `encoding/json`

The standard library caches encoder/decoder functions per type using a sync.Map. After the first call for a type, subsequent calls use cached functions.

```go
// First call: slow (builds encoderFunc via reflection)
json.Marshal(&User{})

// Subsequent calls: fast (uses cached encoderFunc)
json.Marshal(&User{})
```

Understanding this cache explains why:
- Preallocating with `sync.Pool` + `bytes.Buffer` is more effective than reducing type diversity
- Using interface{} breaks caching (dynamic dispatch prevents type-specific optimization)
- Code-generation tools (easyjson, sonic) pre-build these functions at compile time

```go
// Pool-based encoder for high-throughput scenarios
var bufPool = sync.Pool{
    New: func() interface{} { return new(bytes.Buffer) },
}

func marshalUser(u *User) ([]byte, error) {
    buf := bufPool.Get().(*bytes.Buffer)
    buf.Reset()
    defer bufPool.Put(buf)

    enc := json.NewEncoder(buf)
    if err := enc.Encode(u); err != nil {
        return nil, err
    }
    // Copy before returning to pool
    out := make([]byte, buf.Len())
    copy(out, buf.Bytes())
    return out, nil
}
```

---

## 4. High-Performance JSON: Choosing the Right Library

```
Library          Speed     Compatibility    Notes
─────────────    ─────     ─────────────    ──────────────────────────────
encoding/json    baseline  stdlib           Safe default
json-iterator    ~2-3x     stdlib-compat    Drop-in replacement
easyjson         ~4-5x     code-gen needed  No reflection at runtime
sonic            ~5-7x     code-gen+JIT     Best perf, limited platform support
segmentio/encoding/json ~3x  stdlib-compat  Better than jsoniter
```

**When to switch from `encoding/json`:**
- > 10,000 JSON marshal/unmarshal operations per second
- JSON encoding appears in profiling flame graphs
- Large structs (> 20 fields) under high load

```go
// Migration to jsoniter (zero code change besides import):
import (
    jsoniter "github.com/json-iterator/go"
)
var json = jsoniter.ConfigCompatibleWithStandardLibrary

// Now all json.Marshal/Unmarshal calls use jsoniter
```

---

## 5. Memory Layout: Tags Have Zero Runtime Cost

Tags are stored in read-only memory as part of type descriptors. Accessing a tag value via reflection does involve a string scan, but:

```go
// Tag data lives in RODATA section (read-only data)
// Not on the heap, not garbage collected
// Cost: one O(n) string scan per tag lookup (n = tag string length)

// The json package caches tag parse results per type:
// First use: reflect + parse + store in sync.Map
// Subsequent uses: sync.Map lookup only (one atomic read)
```

Adding more tags to a field adds bytes to the binary's RODATA section but has **zero impact on runtime performance** once the caching layer has warmed up.

---

## 6. Postmortem: The `omitempty` + Struct Outage

**Incident:** Production API returning full empty objects instead of omitting optional sections.

```go
// Code deployed:
type APIResponse struct {
    Data    interface{} `json:"data"`
    Errors  ErrorInfo   `json:"errors,omitempty"` // BUG
    Meta    MetaInfo    `json:"meta,omitempty"`   // BUG
}

// Result: every response included empty "errors" and "meta" objects
// Client-side JavaScript crashed interpreting empty error objects
```

**Root cause:** `ErrorInfo{}` and `MetaInfo{}` are struct values. `omitempty` never omits non-nil, non-zero-value struct values. The zero value of a struct is still a valid struct.

**Fix:**
```go
type APIResponse struct {
    Data   interface{} `json:"data"`
    Errors *ErrorInfo  `json:"errors,omitempty"` // pointer: nil = omit
    Meta   *MetaInfo   `json:"meta,omitempty"`   // pointer: nil = omit
}
```

**Prevention:** Write tests for JSON output shape, not just field values.

```go
func TestAPIResponseOmitsEmptyErrors(t *testing.T) {
    resp := APIResponse{Data: "ok"}
    data, _ := json.Marshal(resp)
    if bytes.Contains(data, []byte("errors")) {
        t.Error("errors field should not appear when nil")
    }
}
```

---

## 7. Postmortem: Password Exposed via JSON Tag

**Incident:** User passwords (bcrypt hashes) were returned in API responses for 72 hours.

```go
// Original code:
type User struct {
    ID       int    `json:"id"`
    Email    string `json:"email"`
    Password string `json:"password"` // SECURITY BUG
}
```

A developer added `json:"password"` while debugging locally and committed it.

**Fix:** Use `-` tag for sensitive fields + add test:

```go
type User struct {
    ID       int    `json:"id"`
    Email    string `json:"email"`
    Password string `json:"-"` // NEVER expose
}

// Mandatory test in CI:
func TestUserJSONNeverExposesPassword(t *testing.T) {
    u := User{ID: 1, Email: "a@b.com", Password: "hash"}
    data, _ := json.Marshal(u)
    if bytes.Contains(data, []byte("password")) {
        t.Fatal("SECURITY: password field in JSON output")
    }
}
```

---

## 8. Advanced: Conditional JSON Marshaling

Sometimes you need different JSON output for different contexts (admin vs. user, detailed vs. summary).

```go
// Pattern: multiple response types
type UserSummary struct {
    ID   int    `json:"id"`
    Name string `json:"name"`
}

type UserDetail struct {
    ID        int       `json:"id"`
    Name      string    `json:"name"`
    Email     string    `json:"email"`
    CreatedAt time.Time `json:"created_at"`
}

type UserAdmin struct {
    UserDetail
    Role         string    `json:"role"`
    LoginCount   int       `json:"login_count"`
    LastLoginAt  time.Time `json:"last_login_at"`
    InternalNote string    `json:"internal_note"`
}

// Factory functions
func NewUserSummary(u *User) UserSummary { return UserSummary{...} }
func NewUserDetail(u *User) UserDetail   { return UserDetail{...} }
func NewUserAdmin(u *User) UserAdmin     { return UserAdmin{...} }
```

---

## 9. Custom Marshaling: Avoiding Infinite Recursion

The alias pattern is the standard way to implement custom JSON methods without infinite recursion.

```go
type Order struct {
    ID        int       `json:"id"`
    Total     float64   `json:"total"`
    CreatedAt time.Time `json:"created_at"`
}

func (o Order) MarshalJSON() ([]byte, error) {
    // Alias breaks the MarshalJSON method set
    type Alias Order
    return json.Marshal(struct {
        Alias
        CreatedAt string `json:"created_at"` // override field
    }{
        Alias:     (Alias)(o),
        CreatedAt: o.CreatedAt.Format("2006-01-02"),
    })
}
```

The `type Alias Order` creates a new named type with the same fields but without the methods of `Order`. This prevents `json.Marshal(Alias)` from calling `MarshalJSON` again.

---

## 10. JSON Schema Generation from Struct Tags

In mature systems, you can generate JSON Schema from struct tags for API documentation.

```go
// Using invopop/jsonschema:
type CreateUserRequest struct {
    Name  string `json:"name" jsonschema:"required,minLength=1,maxLength=100"`
    Email string `json:"email" jsonschema:"required,format=email"`
    Age   int    `json:"age"  jsonschema:"minimum=18,maximum=120"`
}

// Generate schema:
schema := jsonschema.Reflect(&CreateUserRequest{})
schemaJSON, _ := json.MarshalIndent(schema, "", "  ")
```

This allows: API documentation from code, client-side validation, contract testing.

---

## 11. JSONL (JSON Lines) Processing

For large datasets, JSON Lines format (one JSON object per line) is more efficient than a JSON array.

```go
func processLargeDataset(r io.Reader) error {
    dec := json.NewDecoder(r)

    for {
        var record DataRecord
        err := dec.Decode(&record)
        if err == io.EOF {
            break
        }
        if err != nil {
            return fmt.Errorf("decode error: %w", err)
        }
        if err := process(record); err != nil {
            return fmt.Errorf("process error: %w", err)
        }
    }
    return nil
}

// Writing JSONL:
func writeDataset(w io.Writer, records []DataRecord) error {
    enc := json.NewEncoder(w)
    for _, r := range records {
        if err := enc.Encode(r); err != nil {
            return err
        }
    }
    return nil
}
```

---

## 12. Versioned JSON APIs with Struct Tags

Managing API versions using struct composition.

```go
// v1 (stable)
type UserV1 struct {
    ID    int    `json:"id"`
    Name  string `json:"name"`
    Email string `json:"email"`
}

// v2 (adds phone, changes name structure)
type UserV2 struct {
    ID        int    `json:"id"`
    FirstName string `json:"first_name"`
    LastName  string `json:"last_name"`
    Email     string `json:"email"`
    Phone     string `json:"phone,omitempty"`
}

// Converter
func userToV2(u *UserV1, firstName, lastName string) UserV2 {
    return UserV2{
        ID:        u.ID,
        FirstName: firstName,
        LastName:  lastName,
        Email:     u.Email,
    }
}
```

---

## 13. Testing JSON Behavior

Essential tests every JSON-using package should have.

```go
func TestMarshalRoundTrip(t *testing.T) {
    original := User{ID: 1, Name: "Alice", Email: "alice@example.com"}
    data, err := json.Marshal(original)
    require.NoError(t, err)

    var decoded User
    err = json.Unmarshal(data, &decoded)
    require.NoError(t, err)

    assert.Equal(t, original, decoded)
}

func TestSensitiveFieldsExcluded(t *testing.T) {
    u := User{ID: 1, Password: "secret"}
    data, _ := json.Marshal(u)
    assert.NotContains(t, string(data), "secret")
    assert.NotContains(t, string(data), "password")
}

func TestOmitemptyBehavior(t *testing.T) {
    u := User{ID: 1, Name: "Alice"} // Bio is empty
    data, _ := json.Marshal(u)
    assert.NotContains(t, string(data), "bio")
}

func TestUnknownFieldsRejected(t *testing.T) {
    body := `{"name":"Alice","unknown_field":"value"}`
    dec := json.NewDecoder(strings.NewReader(body))
    dec.DisallowUnknownFields()
    var req CreateUserRequest
    err := dec.Decode(&req)
    assert.Error(t, err)
}
```

---

## 14. Struct Tag Validation Framework

Building a reusable validation layer on top of struct tags.

```go
type Validator interface {
    Validate() error
}

type CreateOrderRequest struct {
    UserID   int      `json:"user_id"  validate:"required,gt=0"`
    Items    []Item   `json:"items"    validate:"required,min=1,dive"`
    Currency string   `json:"currency" validate:"required,len=3,uppercase"`
}

func (r *CreateOrderRequest) Validate() error {
    validate := validator.New()
    if err := validate.Struct(r); err != nil {
        // Transform validation errors to API-friendly format
        var ve validator.ValidationErrors
        if errors.As(err, &ve) {
            return &ValidationError{Fields: formatValidationErrors(ve)}
        }
        return err
    }
    return nil
}

func handleRequest[T Validator](w http.ResponseWriter, r *http.Request) (T, error) {
    var req T
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        return req, NewHTTPError(400, "invalid JSON")
    }
    if err := req.Validate(); err != nil {
        return req, NewHTTPError(422, err.Error())
    }
    return req, nil
}
```

---

## 15. Architectural Pattern: Tag-Driven Middleware

Use struct tags to drive middleware behavior automatically.

```go
// Example: automatic audit logging based on tags
type AuditTag string

type SensitiveAction struct {
    UserID    int    `json:"user_id"`
    Action    string `json:"action"    audit:"log"`
    IPAddress string `json:"ip_address" audit:"log"`
    Reason    string `json:"reason"`
}

func AuditMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        // Read struct tags to determine what to log
        // ... reflection-based audit logic
        next.ServeHTTP(w, r)
    })
}
```

---

## 16. JSON Merge Patch (RFC 7396)

Implementing PATCH semantics with Go struct tags.

```go
// JSON Merge Patch: only fields present in the patch document are updated
// null fields are deleted/zeroed

type UserPatch struct {
    Name  *string `json:"name"`  // nil = not in patch
    Email *string `json:"email"` // nil = not in patch
    Bio   *string `json:"bio"`   // nil = not in patch
}

func applyPatch(user *User, patch UserPatch) {
    if patch.Name != nil {
        user.Name = *patch.Name
    }
    if patch.Email != nil {
        user.Email = *patch.Email
    }
    if patch.Bio != nil {
        user.Bio = *patch.Bio
    }
}

// PATCH /users/1
// Body: {"bio": null}  → sets bio to ""
// Body: {"name": "Bob"}  → only updates name
// Body: {}  → no changes
```

---

## 17. Performance Optimization: Avoid Allocations in Hot Path

```go
// Naive approach: allocates on every call
func SerializeUser(u User) []byte {
    data, _ := json.Marshal(u)
    return data
}

// Optimized: reuse encoder and buffer
type UserSerializer struct {
    pool sync.Pool
}

func NewUserSerializer() *UserSerializer {
    return &UserSerializer{
        pool: sync.Pool{
            New: func() interface{} {
                buf := &bytes.Buffer{}
                buf.Grow(512) // pre-allocate typical size
                return buf
            },
        },
    }
}

func (s *UserSerializer) Serialize(u User) ([]byte, error) {
    buf := s.pool.Get().(*bytes.Buffer)
    buf.Reset()
    defer s.pool.Put(buf)

    enc := json.NewEncoder(buf)
    if err := enc.Encode(u); err != nil {
        return nil, err
    }

    result := make([]byte, buf.Len())
    copy(result, buf.Bytes())
    return result, nil
}
```

---

## 18. Code Generation Alternative: easyjson

For maximum performance without changing your code structure:

```bash
# Install
go install github.com/mailru/easyjson/...@latest

# Mark types for code generation
//go:generate easyjson -all model.go

# In model.go:
//easyjson:json
type User struct {
    ID   int    `json:"id"`
    Name string `json:"name"`
}
```

Generated code has no reflection, no interface conversions — direct type-specific byte operations. Suitable for services doing > 50,000 JSON operations per second.

---

## 19. Graceful API Evolution with Tag Management

Strategy for evolving JSON APIs without breaking clients.

```go
// Version 1
type ProductV1 struct {
    Name  string  `json:"name"`
    Price float64 `json:"price"`
}

// Version 2: price split into amount + currency
// Backward compatible: still emit "price" for old clients
type ProductV2 struct {
    Name         string  `json:"name"`
    PriceAmount  float64 `json:"price_amount"`
    PriceCurrency string `json:"price_currency"`
    Price        float64 `json:"price"` // deprecated, kept for compat
}

func (p ProductV2) MarshalJSON() ([]byte, error) {
    type Alias ProductV2
    return json.Marshal(struct {
        Alias
        Price float64 `json:"price"` // compute from new fields
    }{
        Alias: (Alias)(p),
        Price: p.PriceAmount, // simplified
    })
}
```

---

## 20. Observability: JSON in Error Responses

Standardize error response format with struct tags.

```go
// RFC 7807: Problem Details for HTTP APIs
type ProblemDetail struct {
    Type     string            `json:"type"`
    Title    string            `json:"title"`
    Status   int               `json:"status"`
    Detail   string            `json:"detail,omitempty"`
    Instance string            `json:"instance,omitempty"`
    Extra    map[string]string `json:"extensions,omitempty"`
}

func WriteProblem(w http.ResponseWriter, status int, title, detail string) {
    p := ProblemDetail{
        Type:   "https://example.com/errors/" + strings.ToLower(title),
        Title:  title,
        Status: status,
        Detail: detail,
    }
    w.Header().Set("Content-Type", "application/problem+json")
    w.WriteHeader(status)
    json.NewEncoder(w).Encode(p)
}
```

---

## 21. Concurrent JSON Processing

Safe pattern for parallel JSON encoding/decoding.

```go
type BatchProcessor struct {
    workers int
}

func (bp *BatchProcessor) Process(items []Item) ([]Result, error) {
    results := make([]Result, len(items))
    var eg errgroup.Group
    sem := make(chan struct{}, bp.workers)

    for i, item := range items {
        i, item := i, item // capture loop variables
        eg.Go(func() error {
            sem <- struct{}{}
            defer func() { <-sem }()

            // Each goroutine gets its own encoder/decoder — safe!
            data, err := json.Marshal(item)
            if err != nil {
                return fmt.Errorf("item %d: %w", i, err)
            }

            var result Result
            if err := json.Unmarshal(data, &result); err != nil {
                return fmt.Errorf("item %d decode: %w", i, err)
            }
            results[i] = result
            return nil
        })
    }

    return results, eg.Wait()
}
```

---

## 22. Struct Tag Linting

Configure your linter to catch common tag mistakes.

```yaml
# .golangci.yml
linters:
  enable:
    - tagliatelle    # enforces tag naming conventions
    - govet          # catches struct tag syntax errors
    - exhaustruct    # ensures all struct fields are initialized

linters-settings:
  tagliatelle:
    case:
      rules:
        json: snake  # enforce snake_case for json tags
        yaml: snake
        db: snake
```

```bash
# Check tag syntax (built into go vet):
go vet ./...
# Catches: invalid tag format, duplicate keys
```

---

## 23. Integration: Protocol Buffers vs JSON Struct Tags

When to use protobuf instead of JSON struct tags.

| Criterion | JSON + struct tags | Protocol Buffers |
|---|---|---|
| Human readability | Yes | No (binary) |
| Schema evolution | Manual | Built-in (field numbers) |
| Performance | Moderate | 3-10x faster |
| Tooling | Universal | Requires protoc |
| Browser support | Native | Needs library |
| Go code | Struct tags | Generated code |

Go can support both: use protobuf internally for service-to-service, JSON with struct tags for public APIs.

---

## 24. Architecture Decision Record: JSON Library Choice

```
ADR-001: JSON Library Selection

Context: Service handling 100K req/s with median 5KB JSON payloads.

Options evaluated:
  1. encoding/json — stdlib, 200μs per 5KB payload
  2. json-iterator  — drop-in, 80μs per 5KB payload
  3. easyjson       — code-gen, 40μs per 5KB payload
  4. sonic          — JIT+code-gen, 30μs per 5KB payload

Decision: json-iterator
Rationale:
  - 2.5x speedup eliminates JSON as bottleneck (confirmed via pprof)
  - Zero code changes (drop-in replacement)
  - Full stdlib compatibility
  - Acceptable binary size increase (+500KB)

Rejected:
  - easyjson: code-gen maintenance overhead not justified
  - sonic: Linux-only JIT, complicates CI on macOS
```

---

## 25. Future: encoding/json/v2

The proposed `encoding/json/v2` (in development as of 2024) fixes key issues:

```go
// v2 proposed changes:
// 1. omitempty works with any zero-value check (including struct{})
// 2. Case-sensitive field matching by default
// 3. Reject unknown fields by default (can opt out)
// 4. Better error messages
// 5. Support for time.Time formatting
// 6. Proper handling of cycles

// v2 API (proposed):
import "encoding/json/v2"

data, err := json.Marshal(v, json.Deterministic(true))
err = json.Unmarshal(data, &v, json.RejectUnknownMembers(true))
```

Track progress at: golang.org/issue/63397

---

## 26. Cross-Service Contract Testing

Use JSON struct tags as the source of truth for contract tests.

```go
// consumer_test.go (consumer service)
func TestUserContractConsumer(t *testing.T) {
    // Verify our expectations about the provider's JSON shape
    testCases := []struct {
        json    string
        wantErr bool
    }{
        {`{"id":1,"name":"Alice","email":"a@b.com","created_at":"2024-01-01T00:00:00Z"}`, false},
        {`{"id":1,"name":"Alice"}`, false}, // email optional
        {`{"id":0}`, false},                 // name optional
    }

    for _, tc := range testCases {
        var u UserResponse
        err := json.Unmarshal([]byte(tc.json), &u)
        if (err != nil) != tc.wantErr {
            t.Errorf("json %q: error=%v, wantErr=%v", tc.json, err, tc.wantErr)
        }
    }
}
```

---

## 27. Monitoring JSON Health in Production

Key metrics to track for JSON processing in production systems.

```go
var (
    jsonMarshalDuration = prometheus.NewHistogram(prometheus.HistogramOpts{
        Name:    "json_marshal_duration_seconds",
        Help:    "Time spent marshaling JSON",
        Buckets: prometheus.DefBuckets,
    })
    jsonUnmarshalErrors = prometheus.NewCounter(prometheus.CounterOpts{
        Name: "json_unmarshal_errors_total",
        Help: "Total JSON unmarshal errors",
    })
    jsonPayloadBytes = prometheus.NewHistogram(prometheus.HistogramOpts{
        Name:    "json_payload_bytes",
        Buckets: []float64{100, 500, 1000, 5000, 10000, 50000},
    })
)

func trackedMarshal(v interface{}) ([]byte, error) {
    start := time.Now()
    data, err := json.Marshal(v)
    jsonMarshalDuration.Observe(time.Since(start).Seconds())
    if err == nil {
        jsonPayloadBytes.Observe(float64(len(data)))
    }
    return data, err
}
```
