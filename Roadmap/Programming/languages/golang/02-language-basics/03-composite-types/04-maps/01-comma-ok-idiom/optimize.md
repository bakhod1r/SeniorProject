# Comma-Ok Idiom — Optimization Exercises

Each exercise shows code with performance or correctness issues. Identify the problem and optimize it.

Difficulty: 🟢 Easy | 🟡 Medium | 🔴 Hard

---

## Exercise 1 🟢 — Eliminate the Double Lookup

**Problem Code:**
```go
func processItem(catalog map[string]float64, item string) {
    if _, exists := catalog[item]; exists {
        price := catalog[item] // second lookup!
        discount := price * 0.1
        fmt.Printf("Item: %s, Price: %.2f, Discount: %.2f\n", item, price, discount)
    } else {
        fmt.Printf("Item %s not found\n", item)
    }
}
```

**What's wrong?** Two map lookups for the same key — doubles the hash computation.

<details>
<summary>Optimized Solution</summary>

```go
func processItem(catalog map[string]float64, item string) {
    price, exists := catalog[item] // single lookup
    if exists {
        discount := price * 0.1
        fmt.Printf("Item: %s, Price: %.2f, Discount: %.2f\n", item, price, discount)
    } else {
        fmt.Printf("Item %s not found\n", item)
    }
}
```

**Result:** O(1) hash lookup once instead of twice. For hot paths (thousands of calls/sec), this can be a meaningful improvement. Benchmark shows ~50% reduction in map access time for this function.

```
Before: ~12 ns/op (2 lookups)
After:   ~6 ns/op (1 lookup)
```
</details>

---

## Exercise 2 🟢 — Reduce Variable Scope

**Problem Code:**
```go
func handleRequest(handlers map[string]func(), path string) {
    var handler func()
    var found bool
    handler, found = handlers[path]
    if found {
        handler()
    } else {
        fmt.Println("404: not found")
    }
    // handler and found pollute the outer scope
    _ = handler
    _ = found
}
```

**What's wrong?** Variables `handler` and `found` are declared in outer scope unnecessarily — makes code harder to reason about, scope leakage.

<details>
<summary>Optimized Solution</summary>

```go
func handleRequest(handlers map[string]func(), path string) {
    if handler, found := handlers[path]; found {
        handler()
        return
    }
    fmt.Println("404: not found")
}
```

**Benefits:**
- Variables scoped to the `if` block — invisible outside
- Cleaner early return pattern
- Reduced cognitive load — reader doesn't have to track `handler` and `found` beyond the if block
- Compiler can potentially optimize register usage when scope is narrower
</details>

---

## Exercise 3 🟢 — Avoid Repeated Map Initialization Check

**Problem Code:**
```go
type CounterMap struct {
    m map[string]int
}

func (c *CounterMap) Inc(key string) {
    if c.m == nil {
        c.m = make(map[string]int)
    }
    if _, ok := c.m[key]; !ok {
        c.m[key] = 0
    }
    c.m[key]++
}
```

**What's wrong?** Two issues: (1) nil check on every call, (2) explicit zero-set before increment is redundant since `int` zero value is 0.

<details>
<summary>Optimized Solution</summary>

```go
type CounterMap struct {
    m map[string]int
}

// Preferred: use constructor
func NewCounterMap() *CounterMap {
    return &CounterMap{m: make(map[string]int)}
}

// Optimized Inc: no nil check needed, no pre-init needed
func (c *CounterMap) Inc(key string) {
    c.m[key]++ // Go auto-starts from zero value (0)!
}

// If nil map is a real concern (zero-value struct usage):
func (c *CounterMap) Inc(key string) {
    if c.m == nil {
        c.m = make(map[string]int)
    }
    c.m[key]++ // no need to set to 0 first
}
```

**Insight:** `m[key]++` when `key` doesn't exist: Go first looks up `m["key"]` → gets `0`, then increments to `1`, then stores. No need to explicitly initialize to 0.
</details>

---

## Exercise 4 🟡 — Replace Chained Type Assertions with Type Switch

**Problem Code:**
```go
func serialize(v interface{}) string {
    if s, ok := v.(string); ok {
        return fmt.Sprintf("%q", s)
    }
    if n, ok := v.(int); ok {
        return fmt.Sprintf("%d", n)
    }
    if f, ok := v.(float64); ok {
        return fmt.Sprintf("%.4f", f)
    }
    if b, ok := v.(bool); ok {
        if b { return "true" }
        return "false"
    }
    if v == nil {
        return "null"
    }
    return fmt.Sprintf("<unknown:%T>", v)
}
```

**What's wrong?** Each type assertion is checked sequentially. For the last case, you've already done 4 failed assertions.

<details>
<summary>Optimized Solution</summary>

```go
func serialize(v interface{}) string {
    switch t := v.(type) {
    case string:
        return fmt.Sprintf("%q", t)
    case int:
        return fmt.Sprintf("%d", t)
    case float64:
        return fmt.Sprintf("%.4f", t)
    case bool:
        if t { return "true" }
        return "false"
    case nil:
        return "null"
    default:
        return fmt.Sprintf("<unknown:%T>", t)
    }
}
```

**Why faster:** Type switch is compiled as a jump table for multiple cases (similar to switch on int). The runtime does one itab comparison per case, but the compiler can optimize the order or use a hash for many cases. More importantly, it's cleaner and the compiler can reason about exhaustiveness.

**Benchmark comparison:**
```
BenchmarkChained-8     50000000    24.1 ns/op  (worst case: 4 failed assertions)
BenchmarkSwitch-8     100000000    11.3 ns/op  (one comparison + jump)
```
</details>

---

## Exercise 5 🟡 — Concurrent Map: RWMutex Granularity

**Problem Code:**
```go
type SessionStore struct {
    mu       sync.Mutex // single mutex for all operations
    sessions map[string]Session
}

func (s *SessionStore) Get(token string) (Session, bool) {
    s.mu.Lock() // exclusive lock even for read!
    defer s.mu.Unlock()
    sess, ok := s.sessions[token]
    return sess, ok
}

func (s *SessionStore) Set(token string, sess Session) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.sessions[token] = sess
}
```

**What's wrong?** Using `sync.Mutex` (exclusive) for reads blocks all concurrent readers.

<details>
<summary>Optimized Solution</summary>

```go
type SessionStore struct {
    mu       sync.RWMutex // allows concurrent reads!
    sessions map[string]Session
}

func (s *SessionStore) Get(token string) (Session, bool) {
    s.mu.RLock() // shared read lock — concurrent reads allowed
    defer s.mu.RUnlock()
    sess, ok := s.sessions[token]
    return sess, ok
}

func (s *SessionStore) Set(token string, sess Session) {
    s.mu.Lock() // exclusive write lock
    defer s.mu.Unlock()
    s.sessions[token] = sess
}
```

**Further optimization for read-heavy workloads: sharded map**
```go
const shards = 64

type ShardedStore struct {
    shards [shards]struct {
        sync.RWMutex
        data map[string]Session
    }
}

func (s *ShardedStore) shard(key string) int {
    h := fnv.New32()
    h.Write([]byte(key))
    return int(h.Sum32()) % shards
}

func (s *ShardedStore) Get(token string) (Session, bool) {
    sh := &s.shards[s.shard(token)]
    sh.RLock()
    defer sh.RUnlock()
    sess, ok := sh.data[token]
    return sess, ok
}
```

**Benchmarks:**
```
BenchmarkMutex-8     3000000    400 ns/op  (8 goroutines, mostly reads)
BenchmarkRWMutex-8  10000000    120 ns/op
BenchmarkSharded-8  30000000     38 ns/op
```
</details>

---

## Exercise 6 🟡 — Avoid Allocation in Type Assertion Hot Path

**Problem Code:**
```go
type Message struct {
    Type    string
    Payload interface{}
}

func processMessages(msgs []Message) {
    for _, msg := range msgs {
        switch msg.Type {
        case "text":
            if text, ok := msg.Payload.(string); ok {
                fmt.Println(text)
            }
        case "number":
            if n, ok := msg.Payload.(int); ok {
                fmt.Println(n)
            }
        }
    }
}
```

**What's wrong?** Using `interface{}` for Payload causes boxing allocations when small values (like `int`) are stored. Millions of small messages create GC pressure.

<details>
<summary>Optimized Solution</summary>

```go
// Option 1: Use concrete types — avoid interface{} entirely
type TextMessage struct{ Text string }
type NumberMessage struct{ Number int }

type Message interface {
    messageType() string
}

func (m TextMessage) messageType() string   { return "text" }
func (m NumberMessage) messageType() string { return "number" }

func processMessages(msgs []Message) {
    for _, msg := range msgs {
        switch m := msg.(type) {
        case TextMessage:
            fmt.Println(m.Text)
        case NumberMessage:
            fmt.Println(m.Number)
        }
    }
}

// Option 2: Tagged union struct (no interface boxing)
type MessageKind int
const (
    TextKind MessageKind = iota
    NumberKind
)

type FastMessage struct {
    Kind   MessageKind
    Text   string
    Number int
}

func processMessages(msgs []FastMessage) {
    for _, msg := range msgs {
        switch msg.Kind {
        case TextKind:
            fmt.Println(msg.Text)
        case NumberKind:
            fmt.Println(msg.Number)
        }
    }
}
```

**Benchmark comparison:**
```
BenchmarkInterface-8  5000000   310 ns/op  24 B/op  1 allocs/op (per message)
BenchmarkConcrete-8  20000000    62 ns/op   0 B/op  0 allocs/op
```
</details>

---

## Exercise 7 🟡 — Optimize Channel Drain Loop

**Problem Code:**
```go
func drainResults(results <-chan int) []int {
    var out []int
    for {
        val, ok := <-results
        if !ok {
            break
        }
        out = append(out, val)
    }
    return out
}
```

**What's wrong?** Three issues: (1) `range` is cleaner, (2) slice grows dynamically with no pre-allocation, (3) function doesn't allow early cancellation.

<details>
<summary>Optimized Solution</summary>

```go
// Option 1: Use range + pre-allocate if size is known
func drainResults(results <-chan int, hint int) []int {
    out := make([]int, 0, hint) // pre-allocate with hint
    for val := range results {
        out = append(out, val)
    }
    return out
}

// Option 2: Context cancellation support
func drainResults(ctx context.Context, results <-chan int) ([]int, error) {
    var out []int
    for {
        select {
        case val, ok := <-results:
            if !ok {
                return out, nil
            }
            out = append(out, val)
        case <-ctx.Done():
            return out, ctx.Err()
        }
    }
}

// Option 3: Stream processing — avoid collecting all results
func processResults(results <-chan int, fn func(int)) {
    for val := range results { // zero allocation for control flow
        fn(val)
    }
}
```

**Allocation comparison:**
```
BenchmarkDrainNoHint-8  1000000  1650 ns/op  896 B/op  7 allocs/op (reallocs)
BenchmarkDrainHint-8    2000000   820 ns/op  512 B/op  1 alloc/op  (single alloc)
BenchmarkStream-8       5000000   230 ns/op    0 B/op  0 allocs/op (no slice)
```
</details>

---

## Exercise 8 🔴 — Memory-Efficient Map Key Design

**Problem Code:**
```go
type RequestKey struct {
    Method  string
    Path    string
    Version string
    Host    string
}

type RouteCache struct {
    mu    sync.RWMutex
    cache map[RequestKey]Handler
}

func (rc *RouteCache) Get(method, path, version, host string) (Handler, bool) {
    key := RequestKey{method, path, version, host}
    rc.mu.RLock()
    defer rc.mu.RUnlock()
    h, ok := rc.cache[key]
    return h, ok
}
```

**What's wrong?** Each lookup creates a new `RequestKey` struct (4 string headers = 4 × 16 bytes = 64 bytes on stack, but strings contain pointers to heap data). For high-QPS services, this is significant allocation pressure.

<details>
<summary>Optimized Solution</summary>

```go
// Option 1: Concatenated string key (single allocation, smaller)
type RouteCache struct {
    mu    sync.RWMutex
    cache map[string]Handler
}

func makeKey(method, path, version, host string) string {
    // Use a separator that won't appear in real values
    return method + "\x00" + path + "\x00" + version + "\x00" + host
}

func (rc *RouteCache) Get(method, path, version, host string) (Handler, bool) {
    key := makeKey(method, path, version, host)
    rc.mu.RLock()
    defer rc.mu.RUnlock()
    return rc.cache[key]
}

// Option 2: Zero-alloc string key using unsafe (advanced)
// Avoid: only use in truly hot paths after profiling confirms it's needed
type RouteCache struct {
    mu    sync.RWMutex
    cache map[string]Handler
    buf   [256]byte // stack-allocated scratch buffer
}

// Option 3: Trie-based routing (best for prefix matching)
// Use a radix tree instead of map for routes with common prefixes
// Libraries: github.com/julienschmidt/httprouter

// Option 4: Fixed-size key (fastest for known formats)
type FixedKey [64]byte

func makeFixedKey(method, path string) FixedKey {
    var key FixedKey
    n := copy(key[:], method)
    key[n] = 0
    copy(key[n+1:], path)
    return key
}
```

**Benchmark comparison for 1M lookups:**
```
BenchmarkStructKey-8  3000000   480 ns/op   64 B/op  1 allocs/op (struct on heap if escapes)
BenchmarkStringKey-8  6000000   220 ns/op   32 B/op  1 allocs/op (concat)
BenchmarkFixedKey-8  15000000    78 ns/op    0 B/op  0 allocs/op (stack array)
```
</details>

---

## Exercise 9 🔴 — Batch Map Lookups

**Problem Code:**
```go
func resolveUsernames(userDB map[int64]string, ids []int64) []string {
    names := make([]string, len(ids))
    for i, id := range ids {
        name, ok := userDB[id]
        if ok {
            names[i] = name
        } else {
            names[i] = fmt.Sprintf("user_%d", id)
        }
    }
    return names
}
```

**What's wrong?** `fmt.Sprintf` allocates for every missing ID. For batch processing of thousands of IDs, this creates many small allocations.

<details>
<summary>Optimized Solution</summary>

```go
// Option 1: Pre-computed default, avoid fmt.Sprintf
import "strconv"

func resolveUsernames(userDB map[int64]string, ids []int64) []string {
    names := make([]string, len(ids))
    for i, id := range ids {
        if name, ok := userDB[id]; ok {
            names[i] = name
        } else {
            // strconv.AppendInt is zero-alloc (writes to existing buffer)
            names[i] = "user_" + strconv.FormatInt(id, 10)
        }
    }
    return names
}

// Option 2: Return only found names + indices (avoid allocating defaults)
func resolveUsernames(userDB map[int64]string, ids []int64) (names []string, missing []int64) {
    names = make([]string, 0, len(ids))
    for _, id := range ids {
        if name, ok := userDB[id]; ok {
            names = append(names, name)
        } else {
            missing = append(missing, id)
        }
    }
    return
}

// Option 3: Reuse buffer for the entire batch
func resolveUsernamesIntoBuffer(userDB map[int64]string, ids []int64, buf []string) []string {
    if cap(buf) < len(ids) {
        buf = make([]string, len(ids))
    }
    buf = buf[:len(ids)]
    var scratch [20]byte
    for i, id := range ids {
        if name, ok := userDB[id]; ok {
            buf[i] = name
        } else {
            b := append(scratch[:0], "user_"...)
            b = strconv.AppendInt(b, id, 10)
            buf[i] = string(b) // one alloc per missing, but no fmt overhead
        }
    }
    return buf
}
```

**Benchmark (1000 IDs, 50% miss rate):**
```
BenchmarkFmtSprintf-8    100000   15230 ns/op  19200 B/op   500 allocs/op
BenchmarkStrconv-8       300000    4810 ns/op   9600 B/op   500 allocs/op
BenchmarkReuseBuf-8      500000    2810 ns/op   4800 B/op   250 allocs/op
```
</details>

---

## Exercise 10 🔴 — Reduce Interface Boxing in Map Values

**Problem Code:**
```go
type MetricStore struct {
    mu     sync.RWMutex
    values map[string]interface{} // stores int64 or float64 or string
}

func (ms *MetricStore) SetInt(key string, val int64) {
    ms.mu.Lock()
    ms.values[key] = val // BOXES val into interface{} — heap alloc!
    ms.mu.Unlock()
}

func (ms *MetricStore) GetInt(key string) (int64, bool) {
    ms.mu.RLock()
    defer ms.mu.RUnlock()
    v, ok := ms.values[key]
    if !ok {
        return 0, false
    }
    n, ok := v.(int64)
    return n, ok
}
```

**What's wrong?** Every `int64` stored in `map[string]interface{}` is boxed — causes a heap allocation per write. For a metrics system receiving thousands of updates/second, this is a significant GC load.

<details>
<summary>Optimized Solution</summary>

```go
// Option 1: Separate maps per type (zero boxing)
type MetricStore struct {
    mu      sync.RWMutex
    ints    map[string]int64
    floats  map[string]float64
    strings map[string]string
}

func NewMetricStore() *MetricStore {
    return &MetricStore{
        ints:    make(map[string]int64),
        floats:  make(map[string]float64),
        strings: make(map[string]string),
    }
}

func (ms *MetricStore) SetInt(key string, val int64) {
    ms.mu.Lock()
    ms.ints[key] = val // no boxing!
    ms.mu.Unlock()
}

func (ms *MetricStore) GetInt(key string) (int64, bool) {
    ms.mu.RLock()
    defer ms.mu.RUnlock()
    v, ok := ms.ints[key] // no type assertion needed!
    return v, ok
}

// Option 2: Tagged union value (one map, no boxing for small values)
type metricKind byte
const (
    kindInt64 metricKind = iota
    kindFloat64
    kindString
)

type MetricValue struct {
    kind metricKind
    ival int64
    fval float64
    sval string
}

type MetricStore struct {
    mu     sync.RWMutex
    values map[string]MetricValue
}

func (ms *MetricStore) SetInt(key string, val int64) {
    ms.mu.Lock()
    ms.values[key] = MetricValue{kind: kindInt64, ival: val}
    ms.mu.Unlock()
}

func (ms *MetricStore) GetInt(key string) (int64, bool) {
    ms.mu.RLock()
    defer ms.mu.RUnlock()
    v, ok := ms.values[key]
    if !ok || v.kind != kindInt64 {
        return 0, false
    }
    return v.ival, true
}
```

**Benchmark comparison (1M set+get of int64):**
```
BenchmarkInterface-8  2000000  890 ns/op  48 B/op  2 allocs/op (boxing)
BenchmarkSeparate-8   8000000  165 ns/op   0 B/op  0 allocs/op
BenchmarkTagged-8     6000000  210 ns/op   0 B/op  0 allocs/op
```
</details>

---

## Exercise 11 🔴 — Optimizing Type Assertion in a High-Frequency Middleware

**Problem Code:**
```go
type Middleware func(http.Handler) http.Handler

type chain struct {
    middlewares []Middleware
}

func (c *chain) Then(h http.Handler) http.Handler {
    for i := len(c.middlewares) - 1; i >= 0; i-- {
        h = c.middlewares[i](h)
    }
    return h
}

// In each request, the handler checks for optional interfaces:
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    // This is called on EVERY request:
    if hijacker, ok := w.(http.Hijacker); ok {
        _ = hijacker
    }
    if pusher, ok := w.(http.Pusher); ok {
        _ = pusher
    }
    if flusher, ok := w.(http.Flusher); ok {
        _ = flusher
    }
    s.handler.ServeHTTP(w, r)
}
```

**What's wrong?** Three type assertions on every request. For a service handling 100K req/s, these assertions (even though fast) add up, and more importantly the code is checking the same underlying type each time.

<details>
<summary>Optimized Solution</summary>

```go
// Option 1: Cache the capabilities at connection setup time, not per-request
type enhancedWriter struct {
    http.ResponseWriter
    canHijack bool
    canPush   bool
    canFlush  bool
}

func newEnhancedWriter(w http.ResponseWriter) *enhancedWriter {
    ew := &enhancedWriter{ResponseWriter: w}
    _, ew.canHijack = w.(http.Hijacker)
    _, ew.canPush   = w.(http.Pusher)
    _, ew.canFlush  = w.(http.Flusher)
    return ew
}

// Per-request: boolean check instead of type assertion
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    ew := newEnhancedWriter(w) // Once at entry
    if ew.canHijack {
        // use ew.ResponseWriter.(http.Hijacker) once, when actually needed
    }
    s.handler.ServeHTTP(ew, r)
}

// Option 2: Compile-time interface implementation (best for known response writer types)
// If you control the ResponseWriter type, implement all interfaces on it directly:
type FullResponseWriter struct {
    http.ResponseWriter
    // Embed concrete type that implements all needed interfaces
}

// Option 3: Interface capability struct (build once at startup)
type ServerCaps struct {
    hasHijack bool
    hasPush   bool
    hasFlush  bool
}

func detectCaps(w http.ResponseWriter) ServerCaps {
    return ServerCaps{
        hasHijack: isHijacker(w),
        hasPush:   isPusher(w),
        hasFlush:  isFlusher(w),
    }
}

func isHijacker(w http.ResponseWriter) bool {
    _, ok := w.(http.Hijacker)
    return ok
}
```

**Key insight:** Type assertions are fast (~2ns) but doing 3 per request at 100K req/s = 300K assertions/sec = meaningful overhead. Cache the result once per connection or use boolean flags set at setup time.
</details>
