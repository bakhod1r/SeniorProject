# Struct Tags & JSON — Optimization Exercises

## Exercise 1 🟢 Reduce Repeated Marshaling

**Problem:** The following code marshals the same configuration object on every HTTP request.

```go
type AppConfig struct {
    Version     string `json:"version"`
    Environment string `json:"environment"`
    Features    []string `json:"features"`
}

var config = AppConfig{
    Version:     "1.0.0",
    Environment: "production",
    Features:    []string{"feature_a", "feature_b"},
}

func configHandler(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(config) // marshals every request
}
```

**Task:** Cache the marshaled bytes since `config` is static.

<details>
<summary>Solution</summary>

```go
var (
    configOnce  sync.Once
    configBytes []byte
)

func initConfigBytes() {
    configOnce.Do(func() {
        var err error
        configBytes, err = json.Marshal(config)
        if err != nil {
            panic(fmt.Sprintf("failed to marshal config: %v", err))
        }
    })
}

func configHandler(w http.ResponseWriter, r *http.Request) {
    initConfigBytes()
    w.Header().Set("Content-Type", "application/json")
    w.Write(configBytes) // zero allocations, no marshaling
}
```

**Improvement:** 0 allocations per request vs 2+ allocations. For high-traffic config endpoints, this is a significant gain.

**When to use:** Only for truly immutable data. If config can change, use a RWMutex-protected cache with TTL.
</details>

---

## Exercise 2 🟢 Use Encoder Instead of Marshal for HTTP

**Problem:** Unnecessary intermediate buffer allocation.

```go
func userHandler(w http.ResponseWriter, r *http.Request) {
    user := User{ID: 1, Name: "Alice", Email: "alice@example.com"}

    data, err := json.Marshal(user) // allocates []byte
    if err != nil {
        http.Error(w, "error", 500)
        return
    }

    w.Header().Set("Content-Type", "application/json")
    w.Write(data) // copy to response writer
}
```

**Task:** Eliminate the intermediate `[]byte` allocation.

<details>
<summary>Solution</summary>

```go
func userHandler(w http.ResponseWriter, r *http.Request) {
    user := User{ID: 1, Name: "Alice", Email: "alice@example.com"}

    w.Header().Set("Content-Type", "application/json")

    if err := json.NewEncoder(w).Encode(user); err != nil {
        // Note: can't change status code here if headers already sent
        // Log the error instead
        log.Printf("encode user: %v", err)
        return
    }
}
```

**Improvement:** Eliminates 1 allocation (the `[]byte`). The encoder writes directly to `w` (an `io.Writer`) without creating an intermediate buffer.

**Note:** `json.NewEncoder` itself allocates a small `Encoder` struct. For ultra-hot paths, you can pool encoders, but typically the direct-to-writer benefit is sufficient.
</details>

---

## Exercise 3 🟢 Avoid Marshaling Unnecessary Fields

**Problem:** Large structs with many fields, most unused in this response.

```go
type UserFull struct {
    ID             int         `json:"id"`
    Name           string      `json:"name"`
    Email          string      `json:"email"`
    Bio            string      `json:"bio"`
    AvatarURL      string      `json:"avatar_url"`
    Preferences    Preferences `json:"preferences"`
    ActivityLog    []Activity  `json:"activity_log"` // could be 1000s of entries
    Friends        []Friend    `json:"friends"`
    Notifications  []Notif     `json:"notifications"`
    InternalNote   string      `json:"-"`
    // ... 20 more fields
}

func getUserSummary(w http.ResponseWriter, r *http.Request) {
    user := loadFullUser(r) // loads everything from DB
    json.NewEncoder(w).Encode(user) // sends everything!
}
```

**Task:** Create a summary type that only includes needed fields.

<details>
<summary>Solution</summary>

```go
// Define a minimal response type
type UserSummary struct {
    ID        int    `json:"id"`
    Name      string `json:"name"`
    AvatarURL string `json:"avatar_url,omitempty"`
}

func toUserSummary(u *UserFull) UserSummary {
    return UserSummary{
        ID:        u.ID,
        Name:      u.Name,
        AvatarURL: u.AvatarURL,
    }
}

func getUserSummary(w http.ResponseWriter, r *http.Request) {
    user := loadPartialUser(r) // only load needed columns from DB
    // Or if you must load full:
    // user := loadFullUser(r)

    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(toUserSummary(user))
}
```

**Improvements:**
1. Smaller JSON payload (network bandwidth)
2. Faster marshaling (fewer fields to process)
3. Load only needed DB columns (query performance)
4. Explicit API contract (client knows exactly what to expect)

**Measurement:** If `ActivityLog` has 1000 entries with 5 fields each, this could reduce response size from 100KB to < 1KB.
</details>

---

## Exercise 4 🟡 Pool Buffers for High-Throughput Marshaling

**Problem:** High allocation rate in a batch processing endpoint.

```go
type BatchResponse struct {
    Items []Item `json:"items"`
    Total int    `json:"total"`
}

func processBatch(items []Item) ([]byte, error) {
    resp := BatchResponse{Items: items, Total: len(items)}
    return json.Marshal(resp) // allocates new []byte every call
}

// Called 10,000 times per second
func batchHandler(w http.ResponseWriter, r *http.Request) {
    items := fetchItems()
    data, _ := processBatch(items)
    w.Write(data)
}
```

**Task:** Reduce allocations using `sync.Pool`.

<details>
<summary>Solution</summary>

```go
var bufPool = sync.Pool{
    New: func() interface{} {
        buf := &bytes.Buffer{}
        buf.Grow(4096) // pre-allocate typical size
        return buf
    },
}

func processBatch(w io.Writer, items []Item) error {
    buf := bufPool.Get().(*bytes.Buffer)
    buf.Reset()
    defer bufPool.Put(buf)

    resp := BatchResponse{Items: items, Total: len(items)}
    enc := json.NewEncoder(buf)
    if err := enc.Encode(resp); err != nil {
        return err
    }

    _, err := w.Write(buf.Bytes())
    return err
}

func batchHandler(w http.ResponseWriter, r *http.Request) {
    items := fetchItems()
    w.Header().Set("Content-Type", "application/json")
    if err := processBatch(w, items); err != nil {
        log.Printf("batch encode: %v", err)
    }
}
```

**Improvement:**
- Before: 2 allocs per call (encoder + buffer)
- After: ~0 amortized allocs (buffer reused from pool)
- At 10,000 calls/sec: saves ~20,000 allocations/sec, reducing GC pressure significantly
</details>

---

## Exercise 5 🟡 Eliminate Reflection with Code Generation

**Problem:** Hot path that marshals the same struct type millions of times per day.

```go
type Event struct {
    ID        int64     `json:"id"`
    Type      string    `json:"type"`
    UserID    int64     `json:"user_id"`
    Timestamp time.Time `json:"timestamp"`
    Data      map[string]interface{} `json:"data"`
}

// This runs 1M times/day
func publishEvent(e Event) error {
    data, err := json.Marshal(e) // reflection every time
    return sendToKafka(data)
}
```

**Task:** Profile and switch to code-generated marshaling.

<details>
<summary>Solution</summary>

**Step 1: Benchmark to confirm JSON is the bottleneck**
```go
func BenchmarkPublishEvent(b *testing.B) {
    e := Event{ID: 1, Type: "click", UserID: 42, Timestamp: time.Now()}
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        json.Marshal(e)
    }
}
// go test -bench=BenchmarkPublishEvent -benchmem -cpuprofile=cpu.prof
// go tool pprof cpu.prof → look for json/reflect in hot path
```

**Step 2: Try jsoniter first (zero code change)**
```go
import jsoniter "github.com/json-iterator/go"
var json = jsoniter.ConfigCompatibleWithStandardLibrary
```

**Step 3: If more needed, use easyjson**
```bash
# Add go:generate directive to Event file:
//go:generate easyjson -all event.go

# Generate:
go generate ./...
```

Generated code (conceptual, easyjson does this automatically):
```go
// event_easyjson.go (generated, do not edit)
func (e *Event) MarshalJSON() ([]byte, error) {
    w := jwriter.Writer{}
    e.MarshalEasyJSON(&w)
    return w.BuildBytes()
}

func (e *Event) MarshalEasyJSON(w *jwriter.Writer) {
    w.RawByte('{')
    w.RawString(`"id":`)
    w.Int64(e.ID)
    w.RawByte(',')
    w.RawString(`"type":`)
    w.String(e.Type)
    // ... no reflection!
}
```

**Performance comparison:**
```
BenchmarkMarshal/stdlib-8      500000    2100 ns/op   512 B/op  5 allocs/op
BenchmarkMarshal/jsoniter-8    800000    1400 ns/op   512 B/op  4 allocs/op
BenchmarkMarshal/easyjson-8   2000000     580 ns/op   128 B/op  2 allocs/op
```
</details>

---

## Exercise 6 🟡 Avoid Re-Allocating for Repeated Fields

**Problem:** Building JSON responses with many common fields repeated.

```go
type APIResponse struct {
    RequestID string      `json:"request_id"`
    Version   string      `json:"api_version"`
    Timestamp time.Time   `json:"timestamp"`
    Data      interface{} `json:"data"`
}

// Every request builds a new APIResponse
func wrap(data interface{}) APIResponse {
    return APIResponse{
        RequestID: uuid.New().String(),
        Version:   "v1",
        Timestamp: time.Now(),
        Data:      data,
    }
}
```

**Task:** Pre-build the static parts of the JSON response.

<details>
<summary>Solution</summary>

```go
// Use json.RawMessage to compose JSON from pre-built parts
func buildResponse(requestID string, data interface{}) ([]byte, error) {
    dataBytes, err := json.Marshal(data)
    if err != nil {
        return nil, err
    }

    // Build response manually to avoid full struct marshal
    var buf bytes.Buffer
    buf.WriteString(`{"request_id":`)
    jsonRequestID, _ := json.Marshal(requestID)
    buf.Write(jsonRequestID)
    buf.WriteString(`,"api_version":"v1","timestamp":"`)
    buf.WriteString(time.Now().UTC().Format(time.RFC3339))
    buf.WriteString(`","data":`)
    buf.Write(dataBytes)
    buf.WriteByte('}')

    return buf.Bytes(), nil
}

// Or more cleanly:
type APIResponse struct {
    RequestID string          `json:"request_id"`
    Version   string          `json:"api_version"`
    Timestamp string          `json:"timestamp"` // pre-formatted string
    Data      json.RawMessage `json:"data"`       // pre-marshaled
}

func buildResponseClean(requestID string, data interface{}) ([]byte, error) {
    dataBytes, err := json.Marshal(data)
    if err != nil {
        return nil, err
    }
    return json.Marshal(APIResponse{
        RequestID: requestID,
        Version:   "v1",
        Timestamp: time.Now().UTC().Format(time.RFC3339),
        Data:      dataBytes, // already marshaled, not re-encoded
    })
}
```

**Key insight:** Using `json.RawMessage` for `Data` means the data is marshaled once (in `json.Marshal(data)`) and then embedded as-is, not re-marshaled through the struct encoder.
</details>

---

## Exercise 7 🟡 Struct Tag for Database + JSON Sync

**Problem:** Maintaining separate JSON and DB field names when both use the same logical names.

```go
// Problem: changing a field name requires updating both tags
type User struct {
    UserID   int    `json:"user_id" db:"user_id"`
    FullName string `json:"full_name" db:"full_name"`
    Email    string `json:"email" db:"email"`
    // If we rename json:"full_name" → json:"name", we must remember db:"full_name"
}
```

**Task:** Create a convention and helper to keep tags in sync and make intent clear.

<details>
<summary>Solution</summary>

```go
// Strategy 1: Use a consistent naming helper struct
type User struct {
    // When json and db names differ, make it explicit:
    UserID   int    `json:"id" db:"user_id"`  // json uses "id", db uses "user_id"
    FullName string `json:"name" db:"full_name"` // json uses "name"
    Email    string `json:"email" db:"email"` // same in both

    // Internal comment explaining the difference:
    // json "id" is shorter for API clients
    // db "user_id" is explicit for SQL joins
}

// Strategy 2: Generate DB tags from a single source of truth
//go:generate go run ./tools/gentags -input types.go -output types_db.go

// Strategy 3: Use the same name for both where possible
type Product struct {
    ID    int     `json:"id"    db:"id"`
    Name  string  `json:"name"  db:"name"`
    Price float64 `json:"price" db:"price"`
    // Alignment helps spot inconsistencies at a glance
}

// Tool: validate tag consistency at test time
func TestTagConsistency(t *testing.T) {
    typ := reflect.TypeOf(User{})
    for i := 0; i < typ.NumField(); i++ {
        f := typ.Field(i)
        jsonTag := f.Tag.Get("json")
        dbTag := f.Tag.Get("db")
        // Both should be present or neither
        if (jsonTag == "") != (dbTag == "") {
            t.Errorf("Field %s: has json=%q but db=%q — inconsistent",
                f.Name, jsonTag, dbTag)
        }
    }
}
```
</details>

---

## Exercise 8 🔴 Optimize Large JSON Array Streaming

**Problem:** Loading all records into memory before streaming response.

```go
func exportUsers(w http.ResponseWriter, r *http.Request) {
    users, err := db.GetAllUsers() // loads 100,000 users into memory!
    if err != nil {
        http.Error(w, "error", 500)
        return
    }

    data, _ := json.Marshal(users) // another full copy in memory!
    w.Write(data)
}
```

**Task:** Stream users row by row without loading all into memory.

<details>
<summary>Solution</summary>

```go
func exportUsers(w http.ResponseWriter, r *http.Request) {
    rows, err := db.QueryRows("SELECT id, name, email FROM users ORDER BY id")
    if err != nil {
        http.Error(w, "internal error", 500)
        return
    }
    defer rows.Close()

    w.Header().Set("Content-Type", "application/json")

    enc := json.NewEncoder(w)

    // Write opening bracket
    w.Write([]byte("["))

    first := true
    for rows.Next() {
        var u User
        if err := rows.Scan(&u.ID, &u.Name, &u.Email); err != nil {
            log.Printf("scan user: %v", err)
            continue
        }

        if !first {
            w.Write([]byte(","))
        }
        first = false

        if err := enc.Encode(u); err != nil {
            log.Printf("encode user: %v", err)
            return
        }
    }

    // Write closing bracket
    w.Write([]byte("]"))
}
```

**Better approach — use JSON Lines format:**
```go
func exportUsersJSONL(w http.ResponseWriter, r *http.Request) {
    rows, err := db.QueryRows("SELECT id, name, email FROM users")
    if err != nil {
        http.Error(w, "internal error", 500)
        return
    }
    defer rows.Close()

    w.Header().Set("Content-Type", "application/x-ndjson")
    enc := json.NewEncoder(w) // writes one JSON object per line

    for rows.Next() {
        var u User
        rows.Scan(&u.ID, &u.Name, &u.Email)
        enc.Encode(u) // automatically adds newline
    }
}
```

**Memory comparison:**
- Before: O(n) memory for n=100,000 users (could be 500MB+)
- After: O(1) memory — one user at a time
</details>

---

## Exercise 9 🔴 Reduce `interface{}` Usage in JSON

**Problem:** Overuse of `interface{}` eliminates type safety and caching benefits.

```go
type AnyResponse struct {
    Data   interface{}            `json:"data"`
    Meta   map[string]interface{} `json:"meta"`
    Errors []interface{}          `json:"errors"`
}

func respond(w http.ResponseWriter, data interface{}) {
    resp := AnyResponse{
        Data: data,
        Meta: map[string]interface{}{
            "version":   "v1",
            "timestamp": time.Now().Unix(),
        },
    }
    json.NewEncoder(w).Encode(resp)
}
```

**Task:** Replace `interface{}` with concrete types where possible.

<details>
<summary>Solution</summary>

```go
// Define concrete Meta type
type ResponseMeta struct {
    Version   string `json:"version"`
    Timestamp int64  `json:"timestamp"`
}

// Define concrete Error type
type APIError struct {
    Code    string `json:"code"`
    Message string `json:"message"`
    Field   string `json:"field,omitempty"`
}

// Generic response (Go 1.18+)
type Response[T any] struct {
    Data   T              `json:"data"`
    Meta   ResponseMeta   `json:"meta"`
    Errors []APIError     `json:"errors,omitempty"`
}

func respond[T any](w http.ResponseWriter, data T) {
    resp := Response[T]{
        Data: data,
        Meta: ResponseMeta{
            Version:   "v1",
            Timestamp: time.Now().Unix(),
        },
    }
    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(resp)
}

// Usage:
respond(w, UserResponse{ID: 1, Name: "Alice"})
respond(w, []ProductResponse{{ID: 1, Name: "Widget"}})
```

**Benefits of concrete types:**
1. Type safety — compile-time error if wrong type passed
2. Better JSON encoder caching — no interface dispatch
3. Clearer API contract — clients know exact shape
4. Better IDE support and documentation
5. Faster marshaling — no interface unwrapping
</details>

---

## Exercise 10 🔴 Lazy JSON Marshaling for Logging

**Problem:** JSON marshaling done eagerly for debug logging that may be disabled.

```go
func processRequest(req *Request) error {
    data, _ := json.Marshal(req) // always marshals, even if debug is off
    log.Printf("Processing request: %s", data)

    // ... actual processing
    return nil
}
```

**Task:** Implement lazy marshaling that only happens when logging is actually needed.

<details>
<summary>Solution</summary>

```go
// Lazy JSON string for logging
type LazyJSON struct {
    v interface{}
}

func (l LazyJSON) String() string {
    data, err := json.Marshal(l.v)
    if err != nil {
        return fmt.Sprintf("<marshal error: %v>", err)
    }
    return string(data)
}

// Usage:
func processRequest(req *Request) error {
    log.Printf("Processing request: %v", LazyJSON{req})
    // String() only called if log.Printf actually formats the message
    // With structured logging (zerolog, zap), this is even more important

    return nil
}

// With zerolog for true lazy evaluation:
import "github.com/rs/zerolog/log"

func processRequestZerolog(req *Request) error {
    log.Debug().
        Interface("request", req). // only marshaled if Debug level enabled
        Msg("processing request")
    return nil
}

// With zap for field-level laziness:
import "go.uber.org/zap"

func processRequestZap(req *Request, logger *zap.Logger) error {
    logger.Debug("processing request",
        zap.Any("request", req), // marshaled only at Debug level
    )
    return nil
}
```

**Performance impact:**
- If debug logging is disabled at production level
- Before: 1000 ns/op for marshal even when logs are discarded
- After: 0 ns/op — String() never called

**Benchmark:**
```go
func BenchmarkLazyVsEager(b *testing.B) {
    req := &Request{ID: 1, Body: "test"}

    b.Run("eager", func(b *testing.B) {
        for i := 0; i < b.N; i++ {
            data, _ := json.Marshal(req)
            _ = data // discarded
        }
    })

    b.Run("lazy", func(b *testing.B) {
        for i := 0; i < b.N; i++ {
            _ = LazyJSON{req} // no marshal if String() not called
        }
    })
}
// eager: 800 ns/op  2 allocs/op
// lazy:    1 ns/op  0 allocs/op
```
</details>

---

## Exercise 11 🔴 Optimize JSON Unmarshal in High-Frequency Parsing

**Problem:** Repeated unmarshaling of known-format webhook payloads.

```go
// Webhook received 50,000 times per second
func handleWebhook(body []byte) error {
    var payload WebhookPayload
    if err := json.Unmarshal(body, &payload); err != nil {
        return err
    }
    return process(payload)
}
```

**Task:** Profile and optimize for this access pattern.

<details>
<summary>Solution</summary>

```go
// Step 1: Benchmark current performance
func BenchmarkHandleWebhook(b *testing.B) {
    body := []byte(`{"event":"purchase","user_id":42,"amount":99.99}`)
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        var p WebhookPayload
        json.Unmarshal(body, &p)
    }
}

// Step 2: Try jsoniter (drop-in, significant improvement)
import jsoniter "github.com/json-iterator/go"
var json = jsoniter.ConfigFastest // fastest, may not be 100% stdlib compat

// Step 3: For maximum throughput, use gjson (no struct, direct field access)
import "github.com/tidwall/gjson"

func handleWebhookFast(body []byte) error {
    s := string(body)

    event := gjson.Get(s, "event").String()
    userID := gjson.Get(s, "user_id").Int()
    amount := gjson.Get(s, "amount").Float()

    return process(WebhookPayload{
        Event:  event,
        UserID: userID,
        Amount: amount,
    })
}

// Step 4: Or use sonic with JIT compilation
import "github.com/bytedance/sonic"

func handleWebhookSonic(body []byte) error {
    var payload WebhookPayload
    return sonic.Unmarshal(body, &payload)
}

// Benchmark comparison:
// stdlib json.Unmarshal:    1200 ns/op  240 B/op  4 allocs
// jsoniter ConfigFastest:    450 ns/op  160 B/op  3 allocs
// gjson direct access:       280 ns/op   64 B/op  1 alloc
// sonic:                     180 ns/op   80 B/op  1 alloc
```
</details>
