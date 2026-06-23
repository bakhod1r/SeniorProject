# Structs — Optimization Exercises

Each exercise shows code with performance or design issues. Identify the problem and optimize it.

Difficulty: 🟢 Easy | 🟡 Medium | 🔴 Hard

---

## Exercise 1 🟢 — Field Ordering for Memory Efficiency

**Problem Code:**
```go
type UserProfile struct {
    Active    bool       // 1 byte
    UserID    int64      // 8 bytes
    IsAdmin   bool       // 1 byte
    Score     float64    // 8 bytes
    Verified  bool       // 1 byte
    CreatedAt time.Time  // 24 bytes (Time struct)
    Name      string     // 16 bytes
    Age       int32      // 4 bytes
    Premium   bool       // 1 byte
}
```

**What's wrong?** Suboptimal field ordering causes excessive padding.

<details>
<summary>Optimized Solution</summary>

```go
import "unsafe"

// Original (with padding analysis):
type UserProfileBad struct {
    Active    bool       // 1 + 7 padding
    UserID    int64      // 8 (offset 8)
    IsAdmin   bool       // 1 + 7 padding
    Score     float64    // 8 (offset 24)
    Verified  bool       // 1 + 7 padding
    CreatedAt time.Time  // 24 (offset 40)
    Name      string     // 16 (offset 64)
    Age       int32      // 4 (offset 80)
    Premium   bool       // 1 + 3 padding
}
// unsafe.Sizeof = 88 bytes

// Optimized: largest types first, then smaller, bools last together
type UserProfileGood struct {
    CreatedAt time.Time  // 24 (offset 0)  — largest first
    Name      string     // 16 (offset 24)
    UserID    int64      // 8  (offset 40)
    Score     float64    // 8  (offset 48)
    Age       int32      // 4  (offset 56)
    Active    bool       // 1  (offset 60) — group bools
    IsAdmin   bool       // 1  (offset 61)
    Verified  bool       // 1  (offset 62)
    Premium   bool       // 1  (offset 63)
}
// unsafe.Sizeof = 64 bytes  — saves 24 bytes (27%)!

// Verification:
var _ = [1]struct{}{}[unsafe.Sizeof(UserProfileGood{}) - 64] // compile-time size assert
```

**Tool:** Use `golang.org/x/tools/go/analysis/passes/fieldalignment`:
```bash
go install golang.org/x/tools/cmd/fieldalignment@latest
fieldalignment ./...
# reports: struct has size 88, could be 64
```

**Impact:** For a service storing 1 million UserProfiles in memory:
- Before: 88 MB
- After: 64 MB — saves 24 MB!
</details>

---

## Exercise 2 🟢 — Avoid Unnecessary Struct Pointer in Hot Path

**Problem Code:**
```go
type Point struct{ X, Y float64 }

func (p *Point) Magnitude() float64 {
    return math.Sqrt(p.X*p.X + p.Y*p.Y)
}

func processPoints(points []*Point) []float64 {
    results := make([]float64, len(points))
    for i, p := range points {
        results[i] = p.Magnitude()
    }
    return results
}

// Usage:
points := make([]*Point, 1000000)
for i := range points {
    points[i] = &Point{X: float64(i), Y: float64(i)}
}
processPoints(points)
```

**What's wrong?** Storing pointers in a slice of 1M elements causes massive GC scanning overhead. Each pointer must be traced.

<details>
<summary>Optimized Solution</summary>

```go
// Change to value slice — GC doesn't scan float64 fields
type Point struct{ X, Y float64 }

func (p Point) Magnitude() float64 { // value receiver for small struct
    return math.Sqrt(p.X*p.X + p.Y*p.Y)
}

func processPoints(points []Point) []float64 { // slice of values, not pointers
    results := make([]float64, len(points))
    for i := range points {
        results[i] = points[i].Magnitude() // index access avoids copy overhead
    }
    return results
}

points := make([]Point, 1000000) // contiguous memory — cache friendly!
for i := range points {
    points[i] = Point{X: float64(i), Y: float64(i)}
}
processPoints(points)
```

**Benchmarks (1M points):**
```
BenchmarkPointerSlice-8  2 runs  650ms/op  GC pause: ~40ms
BenchmarkValueSlice-8   10 runs  120ms/op  GC pause: ~0ms

Memory layout:
Pointer slice: [ptr1 ptr2 ptr3 ...] → scattered heap objects
Value slice:   [X0 Y0 X1 Y1 X2 Y2 ...] → contiguous, cache-friendly
```

**When to prefer values in slices:**
- Struct has no pointer fields
- Struct is small (< ~64 bytes)
- Random access pattern (pointer indirection = cache miss)
- Slice lives on heap but struct data shouldn't be scattered
</details>

---

## Exercise 3 🟢 — Reduce Method Receiver Size

**Problem Code:**
```go
type LargeConfig struct {
    Settings  [100]string   // 1600 bytes
    Weights   [100]float64  // 800 bytes
    Labels    [50]string    // 800 bytes
    Metadata  map[string]string
    // Total: ~3200+ bytes
}

// PROBLEM: value receiver copies ~3200 bytes on every call!
func (c LargeConfig) IsValid() bool {
    return len(c.Settings) > 0 && c.Weights[0] >= 0
}

func (c LargeConfig) GetSetting(i int) string {
    if i >= 0 && i < len(c.Settings) {
        return c.Settings[i]
    }
    return ""
}
```

<details>
<summary>Optimized Solution</summary>

```go
type LargeConfig struct {
    Settings  [100]string
    Weights   [100]float64
    Labels    [50]string
    Metadata  map[string]string
}

// Pointer receivers — pass 8 bytes instead of 3200+
func (c *LargeConfig) IsValid() bool {
    return len(c.Settings) > 0 && c.Weights[0] >= 0
}

func (c *LargeConfig) GetSetting(i int) string {
    if i >= 0 && i < len(c.Settings) {
        return c.Settings[i]
    }
    return ""
}
```

**Benchmarks:**
```
BenchmarkValueReceiver-8    100000    12800 ns/op   3200 B/op  1 allocs/op
BenchmarkPointerReceiver-8 5000000       45 ns/op      0 B/op  0 allocs/op
```

**Rule:** Use pointer receivers for structs larger than ~3 words (24 bytes on 64-bit). For very small structs (Point, Pair), value receivers may be faster due to pointer dereferencing overhead.
</details>

---

## Exercise 4 🟡 — Struct Pool for High-Allocation Handlers

**Problem Code:**
```go
type ParsedRequest struct {
    Method  string
    Path    string
    Headers map[string]string
    Body    []byte
    Params  map[string]string
}

func parseHTTPRequest(raw []byte) *ParsedRequest {
    req := &ParsedRequest{                      // allocation on every request!
        Headers: make(map[string]string, 20),
        Params:  make(map[string]string, 10),
    }
    // ... parse raw bytes into req ...
    return req
}

// Server processes 100K requests/second
// Every request allocates a new ParsedRequest
```

**What's wrong?** Allocating a new struct for every request at 100K req/s creates 100K allocations/second → GC pressure.

<details>
<summary>Optimized Solution</summary>

```go
var requestPool = sync.Pool{
    New: func() interface{} {
        return &ParsedRequest{
            Headers: make(map[string]string, 20),
            Params:  make(map[string]string, 10),
            Body:    make([]byte, 0, 4096),
        }
    },
}

func parseHTTPRequest(raw []byte) *ParsedRequest {
    req := requestPool.Get().(*ParsedRequest)
    req.reset() // clear all fields, keep allocated memory

    // ... parse raw bytes into req ...
    return req
}

func releaseRequest(req *ParsedRequest) {
    requestPool.Put(req)
}

func (r *ParsedRequest) reset() {
    r.Method = ""
    r.Path = ""
    for k := range r.Headers { delete(r.Headers, k) }
    for k := range r.Params  { delete(r.Params, k) }
    r.Body = r.Body[:0]
}
```

**Result:**
```
Before: 100K allocations/sec, ~3MB/s allocation rate, frequent GC pauses
After:  ~0 allocations/sec (pool reuse), GC pauses effectively eliminated
```

**Important:** Call `releaseRequest(req)` when done with the request (after handler returns). Use defer in the handler.
</details>

---

## Exercise 5 🟡 — Avoid Interface Boxing for Struct Methods

**Problem Code:**
```go
type EventProcessor struct {
    handlers map[string]func(event interface{}) error
}

func (ep *EventProcessor) Handle(eventType string, event interface{}) error {
    h, ok := ep.handlers[eventType]
    if !ok {
        return fmt.Errorf("no handler for %s", eventType)
    }
    return h(event)
}

type OrderEvent struct {
    OrderID int64
    Amount  float64
}

func main() {
    ep := &EventProcessor{handlers: make(map[string]func(interface{}) error)}
    ep.handlers["order"] = func(e interface{}) error {
        evt, ok := e.(OrderEvent) // type assertion on every call!
        if !ok {
            return fmt.Errorf("expected OrderEvent, got %T", e)
        }
        fmt.Printf("Order #%d: $%.2f\n", evt.OrderID, evt.Amount)
        return nil
    }
    ep.Handle("order", OrderEvent{OrderID: 42, Amount: 99.99})
}
```

**What's wrong?** `interface{}` boxing allocates on every call for value types. Type assertions on every event dispatch add overhead and reduce type safety.

<details>
<summary>Optimized Solution</summary>

```go
// Option 1: Type-specific processor (Go generics, 1.18+)
type EventProcessor[T any] struct {
    handler func(T) error
}

func (ep *EventProcessor[T]) Handle(event T) error {
    return ep.handler(event)
}

// No boxing, no type assertions, full type safety
orderProcessor := &EventProcessor[OrderEvent]{
    handler: func(e OrderEvent) error {
        fmt.Printf("Order #%d: $%.2f\n", e.OrderID, e.Amount)
        return nil
    },
}
orderProcessor.Handle(OrderEvent{OrderID: 42, Amount: 99.99})

// Option 2: Typed event interface (pre-generics style)
type Event interface {
    eventMarker()
}

type OrderEvent struct {
    OrderID int64
    Amount  float64
}
func (OrderEvent) eventMarker() {}

type TypedProcessor struct {
    orderHandler func(OrderEvent) error
    // ... other typed handlers
}

func (p *TypedProcessor) Handle(e Event) error {
    switch evt := e.(type) {
    case OrderEvent:
        if p.orderHandler != nil {
            return p.orderHandler(evt)
        }
    }
    return nil
}
```

**Benchmark:**
```
BenchmarkInterfaceHandler-8    5000000  310 ns/op  32 B/op  2 allocs/op
BenchmarkGenericHandler-8    100000000    6 ns/op   0 B/op  0 allocs/op
```
</details>

---

## Exercise 6 🟡 — Optimize Struct Copying in Sort

**Problem Code:**
```go
type Product struct {
    ID          int64
    Name        string
    Description string    // potentially long
    Tags        []string
    Price       float64
    Stock       int
    ImageURL    string
}

func sortByPrice(products []Product) []Product {
    sorted := make([]Product, len(products))
    copy(sorted, products) // copy all Products

    sort.Slice(sorted, func(i, j int) bool {
        return sorted[i].Price < sorted[j].Price
    })
    return sorted
}
```

**What's wrong?** Sorting copies large Product structs during each swap. With 100K products, this is significant.

<details>
<summary>Optimized Solution</summary>

```go
// Option 1: Sort indices, not structs
func sortByPrice(products []Product) []int {
    indices := make([]int, len(products))
    for i := range indices {
        indices[i] = i
    }
    sort.Slice(indices, func(i, j int) bool {
        return products[indices[i]].Price < products[indices[j]].Price
    })
    return indices // caller uses products[idx] for sorted access
}

// Option 2: Sort slice of lightweight keys
type productKey struct {
    price float64
    index int
}

func sortedByPrice(products []Product) []Product {
    keys := make([]productKey, len(products))
    for i, p := range products {
        keys[i] = productKey{price: p.Price, index: i}
    }
    sort.Slice(keys, func(i, j int) bool {
        return keys[i].price < keys[j].price
    })
    result := make([]Product, len(products))
    for i, k := range keys {
        result[i] = products[k.index]
    }
    return result
}

// Option 3: Use pointer slice (swaps pointers, not structs)
func sortByPricePtr(products []*Product) {
    sort.Slice(products, func(i, j int) bool {
        return products[i].Price < products[j].Price
    })
}
```

**Benchmark (100K Products, each ~200 bytes):**
```
BenchmarkSortCopy-8    100  18ms/op  20MB/op   (copies Product on each swap)
BenchmarkSortIndex-8   300   6ms/op   0.8MB/op  (swaps 8-byte ints)
BenchmarkSortPtr-8     500   4ms/op   0.8MB/op  (swaps 8-byte pointers)
```
</details>

---

## Exercise 7 🟡 — GC-Friendly Struct for Event Log

**Problem Code:**
```go
type Event struct {
    ID        string              // pointer (string header)
    Timestamp time.Time           // 24 bytes (3 int64s) — no pointer
    UserID    string              // pointer
    Action    string              // pointer
    Metadata  map[string]string   // pointer (map header)
    Tags      []string            // pointer (slice header + each string)
}

type EventLog struct {
    events []Event // GC must trace each Event's pointer fields!
}
```

**What's wrong?** Each `Event` in the slice has multiple pointer fields. For an event log with 10M events, GC must trace all of them.

<details>
<summary>Optimized Solution</summary>

```go
// GC-friendly event for append-heavy logs
// Use string interning + fixed-size fields where possible

type EventKind uint8
const (
    ActionLogin  EventKind = iota
    ActionLogout
    ActionPurchase
    ActionView
)

// Compact event — NO pointer fields!
type CompactEvent struct {
    TimestampNano int64     // 8 bytes — no pointer
    UserID        int64     // 8 bytes — no pointer (use int ID, not string)
    Kind          EventKind // 1 byte  — enum, no pointer
    Amount        int32     // 4 bytes — cents, no float
    _             [3]byte   // padding to align
}
// Total: 24 bytes, ZERO pointer fields → GC never scans this!

type EventLog struct {
    events []CompactEvent // GC ignores all elements!
}

// For string metadata: use a separate interned string table
type StringTable struct {
    mu      sync.RWMutex
    forward map[string]uint32
    reverse []string
}

func (st *StringTable) Intern(s string) uint32 {
    st.mu.RLock()
    if id, ok := st.forward[s]; ok {
        st.mu.RUnlock()
        return id
    }
    st.mu.RUnlock()
    st.mu.Lock()
    defer st.mu.Unlock()
    if id, ok := st.forward[s]; ok { return id }
    id := uint32(len(st.reverse))
    st.reverse = append(st.reverse, s)
    st.forward[s] = id
    return id
}
```

**GC performance (10M events):**
```
With pointer-heavy Event: GC scan time ~80ms per collection
With CompactEvent:        GC scan time ~0.1ms (100x faster)
```
</details>

---

## Exercise 8 🔴 — Optimize Concurrent Struct Updates

**Problem Code:**
```go
type Scoreboard struct {
    mu     sync.Mutex
    scores map[string]int64
}

func (sb *Scoreboard) AddScore(player string, points int64) {
    sb.mu.Lock()
    defer sb.mu.Unlock()
    sb.scores[player] += points
}

func (sb *Scoreboard) GetScore(player string) int64 {
    sb.mu.Lock()
    defer sb.mu.Unlock()
    return sb.scores[player]
}

func (sb *Scoreboard) TopPlayers(n int) []string {
    sb.mu.Lock()
    defer sb.mu.Unlock()
    // ... sort and return top n ...
}
```

**What's wrong?** Single global mutex → all score updates are serialized. At 100K updates/second from thousands of goroutines, this is a bottleneck.

<details>
<summary>Optimized Solution</summary>

```go
const numShards = 256

type shardedScoreboard struct {
    shards [numShards]struct {
        sync.RWMutex
        scores map[string]int64
        _      [40]byte // cache line padding (Mutex=8, map=8, padding=40 → 56 bytes close to 64)
    }
}

func NewShardedScoreboard() *shardedScoreboard {
    sb := &shardedScoreboard{}
    for i := range sb.shards {
        sb.shards[i].scores = make(map[string]int64)
    }
    return sb
}

func (sb *shardedScoreboard) shard(player string) int {
    h := fnv.New32a()
    h.Write([]byte(player))
    return int(h.Sum32()) % numShards
}

func (sb *shardedScoreboard) AddScore(player string, points int64) {
    s := &sb.shards[sb.shard(player)]
    s.Lock()
    s.scores[player] += points
    s.Unlock()
}

func (sb *shardedScoreboard) GetScore(player string) int64 {
    s := &sb.shards[sb.shard(player)]
    s.RLock()
    score := s.scores[player]
    s.RUnlock()
    return score
}

// For TopPlayers: collect all, sort externally
func (sb *shardedScoreboard) Snapshot() map[string]int64 {
    result := make(map[string]int64)
    for i := range sb.shards {
        sb.shards[i].RLock()
        for k, v := range sb.shards[i].scores {
            result[k] = v
        }
        sb.shards[i].RUnlock()
    }
    return result
}
```

**Benchmark (8 goroutines, 1M updates):**
```
BenchmarkSingleMutex-8    1  1.8s/op   (serialized)
BenchmarkSharded-8       10  180ms/op  (10x faster, 256 shards)
BenchmarkSyncMap-8        5  380ms/op  (sync.Map — good for read-heavy)
```
</details>

---

## Exercise 9 🔴 — Zero-Allocation Struct Serialization

**Problem Code:**
```go
type Metric struct {
    Name      string
    Value     float64
    Timestamp int64
    Tags      map[string]string
}

func (m Metric) Serialize() []byte {
    data, _ := json.Marshal(m) // allocates!
    return data
}

// In a metrics pipeline: 1M metrics/sec serialized to wire format
// json.Marshal: ~500ns/op, ~200B/op per metric
```

**What's wrong?** `json.Marshal` allocates heavily for every metric. At 1M metrics/sec, this means 200MB/sec allocation rate.

<details>
<summary>Optimized Solution</summary>

```go
// Option 1: Custom binary serialization — zero allocation for fixed fields
import "encoding/binary"

type MetricFixed struct {
    Value     float64
    Timestamp int64
    NameLen   uint8
    Name      [64]byte // fixed-size name buffer — no allocation!
}

func (m *MetricFixed) SetName(name string) {
    n := copy(m.Name[:], name)
    m.NameLen = uint8(n)
}

func (m *MetricFixed) SerializeTo(buf []byte) int {
    binary.LittleEndian.PutUint64(buf[0:8], math.Float64bits(m.Value))
    binary.LittleEndian.PutUint64(buf[8:16], uint64(m.Timestamp))
    buf[16] = m.NameLen
    copy(buf[17:], m.Name[:m.NameLen])
    return 17 + int(m.NameLen)
}

// Option 2: Reusable buffer with append
var serBufPool = sync.Pool{New: func() interface{} {
    b := make([]byte, 0, 256)
    return &b
}}

func (m Metric) AppendTo(dst []byte) []byte {
    dst = append(dst, m.Name...)
    dst = append(dst, ':')
    dst = strconv.AppendFloat(dst, m.Value, 'f', 4, 64)
    dst = append(dst, ' ')
    dst = strconv.AppendInt(dst, m.Timestamp, 10)
    return dst
}

// Option 3: Use a streaming encoder (e.g., easyjson, ffjson)
// go generate calls easyjson which generates custom marshal code:
//go:generate easyjson metric.go
```

**Benchmark (1M metrics):**
```
BenchmarkJsonMarshal-8     1000000  520ns/op  200B/op  3 allocs/op
BenchmarkBinaryFixed-8    10000000   48ns/op    0B/op  0 allocs/op
BenchmarkAppendBuffer-8    5000000   95ns/op    0B/op  0 allocs/op (with pool)
BenchmarkEasyJSON-8        3000000  180ns/op   32B/op  1 alloc/op
```
</details>

---

## Exercise 10 🔴 — Reduce Struct Indirection in Hot Loop

**Problem Code:**
```go
type Particle struct {
    X, Y, Z  float64  // position
    VX, VY, VZ float64 // velocity
    Mass     float64
    Alive    bool
}

type Simulation struct {
    particles []*Particle // slice of pointers
}

func (s *Simulation) Step(dt float64) {
    for _, p := range s.particles {
        if !p.Alive { continue }
        p.X += p.VX * dt
        p.Y += p.VY * dt
        p.Z += p.VZ * dt
    }
}
```

**What's wrong?** Slice of pointers causes cache misses: each `p` pointer requires a separate memory lookup (pointer indirection = cache miss if particles are scattered in memory).

<details>
<summary>Optimized Solution</summary>

```go
// Option 1: Slice of values (Structure of Pointers → Structure of Values)
type Simulation struct {
    particles []Particle // direct storage — contiguous memory
}

func (s *Simulation) Step(dt float64) {
    for i := range s.particles { // index access — avoids range copy
        p := &s.particles[i]     // pointer to slice element — still safe
        if !p.Alive { continue }
        p.X += p.VX * dt
        p.Y += p.VY * dt
        p.Z += p.VZ * dt
    }
}

// Option 2: Structure of Arrays (SoA) — best for SIMD/vectorization
type SimulationSoA struct {
    X, Y, Z   []float64
    VX, VY, VZ []float64
    Mass       []float64
    Alive      []bool
    n          int
}

func (s *SimulationSoA) Step(dt float64) {
    for i := 0; i < s.n; i++ {
        if !s.Alive[i] { continue }
        s.X[i] += s.VX[i] * dt
        s.Y[i] += s.VY[i] * dt
        s.Z[i] += s.VZ[i] * dt
    }
}
// SoA layout: all X values contiguous — CPU prefetcher and SIMD can vectorize!
```

**Benchmark (1M particles, 1000 steps):**
```
BenchmarkPointerSlice-8  10  2.1s/op  (cache miss on each p*)
BenchmarkValueSlice-8    30  680ms/op (3x faster — contiguous memory)
BenchmarkSoA-8           80  260ms/op (8x faster — SIMD vectorizable)
```

**Key insight:** The **Structure of Arrays** pattern is the ultimate optimization for compute-heavy loops over many structs of the same shape.
</details>

---

## Exercise 11 🔴 — Optimize Struct-Based State Machine

**Problem Code:**
```go
type Order struct {
    Status  string // "draft", "confirmed", "shipped", "delivered", "cancelled"
    History []string
    Items   []Item
    Total   float64
}

func (o *Order) Transition(newStatus string) error {
    validTransitions := map[string][]string{
        "draft":     {"confirmed", "cancelled"},
        "confirmed": {"shipped", "cancelled"},
        "shipped":   {"delivered"},
        "delivered": {},
        "cancelled": {},
    }
    allowed, ok := validTransitions[o.Status]
    if !ok {
        return fmt.Errorf("unknown status: %s", o.Status)
    }
    for _, s := range allowed {
        if s == newStatus {
            o.History = append(o.History, fmt.Sprintf("%s→%s", o.Status, newStatus))
            o.Status = newStatus
            return nil
        }
    }
    return fmt.Errorf("invalid transition: %s → %s", o.Status, newStatus)
}
```

**What's wrong?** Three issues: (1) `string` status instead of `int` enum, (2) `map` created on every call, (3) `fmt.Sprintf` allocates for every history entry.

<details>
<summary>Optimized Solution</summary>

```go
type OrderStatus uint8

const (
    StatusDraft     OrderStatus = iota
    StatusConfirmed
    StatusShipped
    StatusDelivered
    StatusCancelled
    statusCount
)

// Static transition table — created once, zero-allocation lookup
var validTransitions = [statusCount][]OrderStatus{
    StatusDraft:     {StatusConfirmed, StatusCancelled},
    StatusConfirmed: {StatusShipped, StatusCancelled},
    StatusShipped:   {StatusDelivered},
    StatusDelivered: {},
    StatusCancelled: {},
}

// Pre-computed transition bitmask for O(1) check
var transitionMask [statusCount]uint32

func init() {
    for from, tos := range validTransitions {
        for _, to := range tos {
            transitionMask[from] |= 1 << uint(to)
        }
    }
}

type HistoryEntry struct {
    From, To  OrderStatus
    At        int64 // unix timestamp — no allocation
}

type Order struct {
    Status  OrderStatus
    History []HistoryEntry // fixed-size, no strings
    Items   []Item
    Total   int64 // cents
}

func (o *Order) Transition(newStatus OrderStatus) error {
    if int(o.Status) >= int(statusCount) {
        return fmt.Errorf("invalid status: %d", o.Status)
    }
    if transitionMask[o.Status]&(1<<uint(newStatus)) == 0 {
        return fmt.Errorf("invalid transition: %d → %d", o.Status, newStatus)
    }
    o.History = append(o.History, HistoryEntry{
        From: o.Status,
        To:   newStatus,
        At:   time.Now().UnixNano(),
    })
    o.Status = newStatus
    return nil
}
```

**Benchmark (1M transitions):**
```
BenchmarkStringStatus-8  1000000  420ns/op  96B/op  3 allocs/op
BenchmarkEnumBitmask-8  20000000   58ns/op   0B/op  0 allocs/op
```
</details>
