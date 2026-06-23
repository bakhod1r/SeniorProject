# Go if-else — Senior Level

## Table of Contents
1. if-else and the Go Runtime
2. Compiler Optimizations for Branches
3. Branch Prediction in Modern CPUs
4. if-else and Escape Analysis
5. Inlining and if-else
6. Bounds Check Elimination
7. Dead Code Elimination
8. Profile-Guided Optimization (PGO)
9. if-else in Hot Paths
10. Branchless Programming Techniques
11. if-else in Concurrent Systems
12. Race Conditions in Branched Code
13. if-else and Memory Ordering
14. Designing APIs That Minimize if-else
15. Finite State Machines Instead of if-else
16. Option Pattern and if-else
17. Result Types (Go 1.18+ generics)
18. if-else in Code Generation
19. Linting and Static Analysis for if-else
20. Code Review: Red Flags in if-else
21. if-else in Large-Scale Systems
22. Monitoring and Observability at Branch Points
23. if-else and SLA/SLO Design
24. Postmortems: Real if-else Bugs in Production
25. Performance Optimization Case Studies
26. Testing Strategies for Complex Branches
27. Summary: Senior Decision Framework

---

## 1. if-else and the Go Runtime

At runtime, an `if-else` compiles to a **conditional jump instruction** (like `JNE`, `JE`, `JGE` on x86-64). The Go runtime itself uses `if-else` extensively:

```go
// From the Go runtime scheduler (simplified)
// runtime/proc.go
func schedule() {
    gp, inheritTime, tryWakeP := findRunnable()

    if gp == nil {
        // No goroutine to run
        if sched.gcwaiting.Load() != 0 {
            gcstopm()
            goto top
        }
        // ... more branching
    }
    // ...
}
```

The runtime's critical path code uses if-else extremely carefully — every branch in the scheduler has performance implications for ALL goroutines.

**Key insight**: In Go, the `if` statement generates a `CMP` + conditional `JMP` pair. The cost is:
- ~1 cycle for predictable branches (branch predictor hits)
- ~15-20 cycles for mispredicted branches (pipeline flush)

---

## 2. Compiler Optimizations for Branches

The Go compiler (`gc`) performs several optimizations on if-else:

```go
// Dead code elimination
const debug = false
if debug {
    fmt.Println("this will be eliminated at compile time")
}

// Constant folding in conditions
x := 5
if x > 3 {  // Compiler knows this is always true at compile time
    // This block is kept, else branch eliminated
}

// Checking with -gcflags
// go build -gcflags="-m=2" ./...  -- shows optimization decisions
```

```bash
# See what the compiler does with your if-else
go build -gcflags="-S" main.go 2>&1 | head -50
# Look for CMPQ, JLE, JGE, JNE instructions

# Check if code is inlined
go build -gcflags="-m" main.go
```

The SSA (Static Single Assignment) form the compiler uses:

```
# Simplified SSA for: if x > 5 { return 1 } return 0
b1:
  v1 = ConstInt 5
  v2 = Greater v0 v1  ; x > 5
  If v2 -> b2 b3
b2:  ; true branch
  Return (ConstInt 1)
b3:  ; false branch
  Return (ConstInt 0)
```

---

## 3. Branch Prediction in Modern CPUs

CPUs use branch predictors to guess which path an if-else will take BEFORE evaluating the condition:

```go
package main

import (
    "math/rand"
    "testing"
)

// Sorted data: branch predictor works great (monotone pattern)
func BenchmarkPredictable(b *testing.B) {
    data := make([]int, 1<<16)
    for i := range data {
        data[i] = i  // sorted
    }
    threshold := len(data) / 2
    b.ResetTimer()
    sum := 0
    for i := 0; i < b.N; i++ {
        for _, v := range data {
            if v < threshold {  // predictable: true then false
                sum += v
            }
        }
    }
    _ = sum
}

// Random data: branch predictor misses ~50% of the time
func BenchmarkUnpredictable(b *testing.B) {
    data := make([]int, 1<<16)
    for i := range data {
        data[i] = rand.Intn(256)
    }
    threshold := 128
    b.ResetTimer()
    sum := 0
    for i := 0; i < b.N; i++ {
        for _, v := range data {
            if v < threshold {  // random: ~50% misprediction
                sum += v
            }
        }
    }
    _ = sum
}

// Branchless alternative using arithmetic
func BenchmarkBranchless(b *testing.B) {
    data := make([]int, 1<<16)
    for i := range data {
        data[i] = rand.Intn(256)
    }
    threshold := 128
    b.ResetTimer()
    sum := 0
    for i := 0; i < b.N; i++ {
        for _, v := range data {
            // No branch: multiply by 0 or 1
            mask := -((threshold - v - 1) >> 63)  // all 1s if v < threshold, else 0
            sum += v & mask
        }
    }
    _ = sum
}
```

Typical results: sorted ~2x faster than random for the same logic.

---

## 4. if-else and Escape Analysis

Variables declared in if-else blocks may escape to the heap:

```go
package main

// go build -gcflags="-m" to see escape analysis

func makeError(cond bool) error {
    if cond {
        // This error may escape if returned as interface{}
        return &MyError{"condition met"}  // escapes to heap
    }
    return nil
}

type MyError struct{ msg string }
func (e *MyError) Error() string { return e.msg }

// Avoiding allocation with pre-allocated errors
var errConditionMet = &MyError{"condition met"}

func makeErrorOpt(cond bool) error {
    if cond {
        return errConditionMet  // no allocation — pointer to static
    }
    return nil
}

// Stack-allocated structs in if blocks
func process(large bool) {
    if large {
        // data is stack-allocated if it doesn't escape
        var data [4096]byte
        doWork(data[:])
    }
}

func doWork(b []byte) { _ = b }
```

---

## 5. Inlining and if-else

The Go compiler inlines small functions. if-else adds to inlining cost:

```go
// go build -gcflags="-m=2" shows: "can inline" or "too complex to inline"

// Small enough to inline (cost ~10)
func abs(n int) int {
    if n < 0 {
        return -n
    }
    return n
}

// Too complex — won't inline (cost > 80 by default)
func complexLogic(a, b, c, d int) int {
    if a > 0 {
        if b > 0 {
            if c > 0 {
                return a + b + c
            }
            return a + b
        }
        if d > 0 {
            return a + d
        }
        return a
    }
    return 0
}

// Forcing inlining with pragma (use sparingly)
//go:nosplit
func criticalPath(x int) int {
    if x > 0 {
        return x
    }
    return -x
}
```

---

## 6. Bounds Check Elimination

Go performs bounds checking on array/slice access. if-else can help or hurt:

```go
package main

// Bounds check NOT eliminated — compiler can't prove safety
func getUnsafe(s []int, i int) int {
    if i >= 0 {
        return s[i]  // still has bounds check
    }
    return 0
}

// Bounds check eliminated — compiler can prove safety
func getSafe(s []int, i int) int {
    if i < 0 || i >= len(s) {
        return 0
    }
    return s[i]  // BCE: no bounds check needed
}

// Pattern for multiple accesses
func processThree(s []int) (int, int, int) {
    _ = s[2]  // bounds check once — proves len >= 3
    return s[0], s[1], s[2]  // no further checks needed
}
```

Check BCE with:
```bash
go build -gcflags="-d=ssa/check_bce/debug=1" main.go
```

---

## 7. Dead Code Elimination

The compiler eliminates provably unreachable branches:

```go
package main

const Production = true

func init() {
    if !Production {
        // This entire block is eliminated at compile time
        setupDebugHandlers()
        enableVerboseLogging()
    }
}

func setupDebugHandlers() {}
func enableVerboseLogging() {}

// Build tags as alternative
// //go:build debug

// Runtime flag approach (not eliminated but negligible)
var debug = false  // set via flag or env

func maybeLog(msg string) {
    if debug {
        // Not eliminated at compile time (runtime variable)
        fmt.Println(msg)
    }
}
```

---

## 8. Profile-Guided Optimization (PGO)

Go 1.20+ supports PGO. Branch frequency data guides compiler decisions:

```bash
# Step 1: Generate CPU profile
go build -o app .
./app -cpuprofile=cpu.pprof < real_workload.txt

# Step 2: Build with PGO
go build -pgo=cpu.pprof -o app_optimized .

# The compiler now knows which branches are "hot" and optimizes accordingly
```

PGO effects on if-else:
- Hot branches may be laid out to avoid jumps (fall-through is faster)
- Cold branches may be moved out of the hot path
- Inlining decisions influenced by actual call frequency

---

## 9. if-else in Hot Paths

Critical paths need special care:

```go
package main

import "sync/atomic"

// Hot path: called millions of times per second
// Every nanosecond matters

type FastFilter struct {
    threshold int64
    accepts   atomic.Int64
    rejects   atomic.Int64
}

// BAD: atomic operations in condition (expensive)
func (f *FastFilter) FilterBad(value int64) bool {
    if value > f.threshold {
        f.accepts.Add(1)  // atomic op in hot path
        return true
    }
    f.rejects.Add(1)  // atomic op in hot path
    return false
}

// GOOD: batch counting with local vars, flush periodically
type BatchFilter struct {
    threshold  int64
    accepts    atomic.Int64
    rejects    atomic.Int64
    localAcc   int64
    localRej   int64
    batchCount int
}

func (f *BatchFilter) Filter(value int64) bool {
    var result bool
    if value > f.threshold {
        f.localAcc++
        result = true
    } else {
        f.localRej++
    }

    f.batchCount++
    if f.batchCount >= 1000 {
        f.accepts.Add(f.localAcc)
        f.rejects.Add(f.localRej)
        f.localAcc, f.localRej, f.batchCount = 0, 0, 0
    }
    return result
}
```

---

## 10. Branchless Programming Techniques

Eliminating branches for predictable speedups:

```go
package main

// Branchless min/max (avoid branch misprediction)
func minBranchless(a, b int) int {
    diff := a - b
    return b + (diff & (diff >> 63))
}

func maxBranchless(a, b int) int {
    diff := a - b
    return a - (diff & (diff >> 63))
}

// Branchless abs
func absBranchless(n int) int {
    mask := n >> 63  // all 1s if negative, all 0s if positive
    return (n ^ mask) - mask
}

// Branchless clamp
func clamp(val, lo, hi int) int {
    // Standard version with branches
    if val < lo { return lo }
    if val > hi { return hi }
    return val
}

func clampBranchless(val, lo, hi int) int {
    // Using bit tricks
    val = val + ((lo - val) & ((lo - val) >> 63))
    val = val - ((val - hi) & ((val - hi) >> 63))
    return val
}

// When to use: only in verified hot loops with random data
// Don't use by default — makes code harder to read
```

---

## 11. if-else in Concurrent Systems

```go
package main

import (
    "sync"
    "sync/atomic"
)

// Pattern: Double-checked locking with if-else
type Singleton struct {
    mu       sync.Mutex
    instance *Resource
}

type Resource struct{ data int }

func (s *Singleton) Get() *Resource {
    if s.instance != nil {  // Fast path: no lock needed
        return s.instance
    }
    s.mu.Lock()
    defer s.mu.Unlock()
    if s.instance == nil {  // Recheck after acquiring lock
        s.instance = &Resource{data: 42}
    }
    return s.instance
}

// Pattern: Lock-free check with atomic
type AtomicCache struct {
    ready atomic.Bool
    data  []byte
}

func (c *AtomicCache) Get() []byte {
    if !c.ready.Load() {
        return nil  // Not ready yet
    }
    return c.data
}
```

---

## 12. Race Conditions in Branched Code

```go
package main

import (
    "fmt"
    "sync"
)

// BUG: TOCTOU (Time-of-Check-Time-of-Use)
type UnsafeCache struct {
    data map[string]string
}

func (c *UnsafeCache) GetOrSet(key, value string) string {
    if _, ok := c.data[key]; !ok {  // CHECK
        c.data[key] = value         // USE — race condition between check and use!
    }
    return c.data[key]
}

// FIXED: Atomic check-and-set
type SafeCache struct {
    mu   sync.RWMutex
    data map[string]string
}

func (c *SafeCache) GetOrSet(key, value string) string {
    c.mu.RLock()
    if v, ok := c.data[key]; ok {
        c.mu.RUnlock()
        return v
    }
    c.mu.RUnlock()

    c.mu.Lock()
    defer c.mu.Unlock()
    // Re-check under write lock
    if v, ok := c.data[key]; ok {
        return v
    }
    c.data[key] = value
    return value
}

func main() {
    cache := &SafeCache{data: make(map[string]string)}
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func(n int) {
            defer wg.Done()
            result := cache.GetOrSet("key", fmt.Sprintf("value-%d", n))
            _ = result
        }(i)
    }
    wg.Wait()
    fmt.Println("Final:", cache.data["key"])
}
```

---

## 13. if-else and Memory Ordering

```go
package main

import (
    "sync/atomic"
    "unsafe"
)

// Pattern: Publish-subscribe with memory ordering
type PublishedData struct {
    value int64
    ready atomic.Bool
}

func (p *PublishedData) Publish(v int64) {
    // Store data FIRST
    atomic.StoreInt64(&p.value, v)
    // Then signal readiness (full memory barrier)
    p.ready.Store(true)
}

func (p *PublishedData) Read() (int64, bool) {
    // Check readiness FIRST
    if !p.ready.Load() {
        return 0, false
    }
    // Then read data
    return atomic.LoadInt64(&p.value), true
}

// Why ordering matters in if-else:
// Without memory barriers, CPU can reorder stores/loads
// The if-else check and the data access must be properly ordered

var _ = unsafe.Sizeof // keep import
```

---

## 14. Designing APIs That Minimize if-else

```go
package main

import "fmt"

// Bad API: Caller needs many if-else
type Responder struct {
    Code    int
    Body    string
    Headers map[string]string
    Err     error
}

func callAPIBad() Responder {
    // ...
    return Responder{}
}

// Better: Typed results with methods
type APIResponse struct {
    statusCode int
    body       []byte
    err        error
}

func (r *APIResponse) IsSuccess() bool   { return r.statusCode >= 200 && r.statusCode < 300 }
func (r *APIResponse) IsClientError() bool { return r.statusCode >= 400 && r.statusCode < 500 }
func (r *APIResponse) Body() []byte     { return r.body }
func (r *APIResponse) Err() error       { return r.err }

func callAPIGood() *APIResponse {
    return &APIResponse{statusCode: 200, body: []byte(`{"ok":true}`)}
}

func main() {
    resp := callAPIGood()
    // Caller's code is cleaner
    if resp.IsSuccess() {
        fmt.Printf("Got: %s\n", resp.Body())
    } else if resp.IsClientError() {
        fmt.Println("Client error")
    }
}
```

---

## 15. Finite State Machines Instead of if-else

```go
package main

import "fmt"

type State int

const (
    StateIdle State = iota
    StateRunning
    StatePaused
    StateStopped
)

type Event int

const (
    EventStart Event = iota
    EventPause
    EventResume
    EventStop
)

type FSM struct {
    state       State
    transitions map[State]map[Event]State
    actions     map[State]map[Event]func()
}

func NewFSM() *FSM {
    f := &FSM{
        state:       StateIdle,
        transitions: make(map[State]map[Event]State),
        actions:     make(map[State]map[Event]func()),
    }

    // Define valid transitions
    f.addTransition(StateIdle, EventStart, StateRunning, func() {
        fmt.Println("Starting...")
    })
    f.addTransition(StateRunning, EventPause, StatePaused, func() {
        fmt.Println("Pausing...")
    })
    f.addTransition(StatePaused, EventResume, StateRunning, func() {
        fmt.Println("Resuming...")
    })
    f.addTransition(StateRunning, EventStop, StateStopped, func() {
        fmt.Println("Stopping...")
    })

    return f
}

func (f *FSM) addTransition(from State, event Event, to State, action func()) {
    if f.transitions[from] == nil {
        f.transitions[from] = make(map[Event]State)
        f.actions[from] = make(map[Event]func())
    }
    f.transitions[from][event] = to
    f.actions[from][event] = action
}

func (f *FSM) Send(event Event) error {
    next, ok := f.transitions[f.state][event]
    if !ok {
        return fmt.Errorf("invalid transition from %d with event %d", f.state, event)
    }
    if action := f.actions[f.state][event]; action != nil {
        action()
    }
    f.state = next
    return nil
}

func main() {
    fsm := NewFSM()
    fsm.Send(EventStart)
    fsm.Send(EventPause)
    fsm.Send(EventResume)
    fsm.Send(EventStop)

    if err := fsm.Send(EventStart); err != nil {
        fmt.Println("Error:", err)  // invalid: stopped can't start
    }
}
```

---

## 16. Option Pattern and if-else

```go
package main

import "fmt"

// Optional[T] — like Rust's Option<T>
type Optional[T any] struct {
    value    T
    hasValue bool
}

func Some[T any](v T) Optional[T] {
    return Optional[T]{value: v, hasValue: true}
}

func None[T any]() Optional[T] {
    return Optional[T]{}
}

func (o Optional[T]) Get() (T, bool) {
    return o.value, o.hasValue
}

func (o Optional[T]) OrElse(def T) T {
    if o.hasValue {
        return o.value
    }
    return def
}

func findUser(id int) Optional[string] {
    users := map[int]string{1: "Alice", 2: "Bob"}
    name, ok := users[id]
    if ok {
        return Some(name)
    }
    return None[string]()
}

func main() {
    user := findUser(1)
    if name, ok := user.Get(); ok {
        fmt.Println("Found:", name)
    }

    missing := findUser(99)
    fmt.Println("Default:", missing.OrElse("anonymous"))
}
```

---

## 17. Result Types (Go 1.18+ generics)

```go
package main

import "fmt"

type Result[T any] struct {
    value T
    err   error
}

func Ok[T any](v T) Result[T]      { return Result[T]{value: v} }
func Err[T any](e error) Result[T] { return Result[T]{err: e} }

func (r Result[T]) IsOk() bool        { return r.err == nil }
func (r Result[T]) Unwrap() T         { return r.value }
func (r Result[T]) UnwrapErr() error  { return r.err }

func (r Result[T]) OrElse(def T) T {
    if r.IsOk() {
        return r.value
    }
    return def
}

func divide(a, b float64) Result[float64] {
    if b == 0 {
        return Err[float64](fmt.Errorf("division by zero"))
    }
    return Ok(a / b)
}

func main() {
    r := divide(10, 2)
    if r.IsOk() {
        fmt.Println("Result:", r.Unwrap())
    }

    r2 := divide(10, 0)
    fmt.Println("Value:", r2.OrElse(-1))
    if !r2.IsOk() {
        fmt.Println("Error:", r2.UnwrapErr())
    }
}
```

---

## 18. if-else in Code Generation

```go
package main

import (
    "fmt"
    "strings"
)

// Generating if-else code programmatically (meta-programming)
type Condition struct {
    Left  string
    Op    string
    Right string
}

type Branch struct {
    Cond Condition
    Body string
}

func generateIfElse(branches []Branch, elsebody string) string {
    var sb strings.Builder
    for i, b := range branches {
        if i == 0 {
            sb.WriteString(fmt.Sprintf("if %s %s %s {\n",
                b.Cond.Left, b.Cond.Op, b.Cond.Right))
        } else {
            sb.WriteString(fmt.Sprintf("} else if %s %s %s {\n",
                b.Cond.Left, b.Cond.Op, b.Cond.Right))
        }
        sb.WriteString("    " + b.Body + "\n")
    }
    if elsebody != "" {
        sb.WriteString("} else {\n    " + elsebody + "\n}")
    } else if len(branches) > 0 {
        sb.WriteString("}")
    }
    return sb.String()
}

func main() {
    code := generateIfElse([]Branch{
        {Condition{"score", ">=", "90"}, `return "A"`},
        {Condition{"score", ">=", "80"}, `return "B"`},
        {Condition{"score", ">=", "70"}, `return "C"`},
    }, `return "F"`)
    fmt.Println(code)
}
```

---

## 19. Linting and Static Analysis for if-else

```bash
# golangci-lint covers many if-else issues
golangci-lint run --enable=gocritic,gomnd,exhaustive

# Specific linters:
# - stylecheck: "else after return" (S1023)
# - gocritic: ifElseChain, assignOp
# - cyclop: cyclomatic complexity
# - gocognit: cognitive complexity
# - exhaustive: exhaustive switch (related)
```

```go
// .golangci.yml
linters-settings:
  cyclop:
    max-complexity: 10
  gocognit:
    min-complexity: 15
  gocritic:
    enabled-checks:
      - ifElseChain
      - elseif
```

---

## 20. Code Review: Red Flags in if-else

```go
// Red flag 1: Returning bool with if-else (can use direct return)
func isAdult(age int) bool {
    if age >= 18 {
        return true
    }
    return false
}
// Better:
func isAdult2(age int) bool {
    return age >= 18
}

// Red flag 2: Negated condition with empty if
func process(data []byte) {
    if len(data) == 0 {
        // empty — intentional?
    } else {
        doWork(data)
    }
}
// Better:
func process2(data []byte) {
    if len(data) > 0 {
        doWork(data)
    }
}

// Red flag 3: Complex boolean — extract to named function
if user != nil && user.IsActive && !user.IsBanned && user.Age >= 18 && hasPermission(user.Role) {
    // ...
}
// Better:
func canAccess(user *User) bool {
    if user == nil || !user.IsActive || user.IsBanned {
        return false
    }
    return user.Age >= 18 && hasPermission(user.Role)
}

type User struct {
    IsActive, IsBanned bool
    Age                int
    Role               string
}

func hasPermission(role string) bool { return role == "admin" }
func doWork(data []byte)             {}
```

---

## 21. if-else in Large-Scale Systems

In large systems, if-else logic is often centralized in:

```go
package main

import "fmt"

// Feature flags
type FeatureFlags struct {
    flags map[string]bool
}

func (f *FeatureFlags) IsEnabled(feature string) bool {
    return f.flags[feature]
}

var globalFlags = &FeatureFlags{
    flags: map[string]bool{
        "new-payment-flow": true,
        "dark-mode":        false,
        "beta-api":         false,
    },
}

func handlePayment(amount float64) {
    if globalFlags.IsEnabled("new-payment-flow") {
        fmt.Printf("Processing $%.2f via new flow\n", amount)
    } else {
        fmt.Printf("Processing $%.2f via legacy flow\n", amount)
    }
}

// A/B testing
type ABTest struct {
    name   string
    rollout float64  // 0.0 to 1.0
}

func (t *ABTest) IsInTreatment(userID string) bool {
    // Deterministic hash-based assignment
    hash := fnv32(userID+t.name)
    return float64(hash%100)/100.0 < t.rollout
}

func fnv32(s string) uint32 {
    var h uint32 = 2166136261
    for i := 0; i < len(s); i++ {
        h ^= uint32(s[i])
        h *= 16777619
    }
    return h
}

func main() {
    handlePayment(99.99)

    test := &ABTest{"checkout-v2", 0.5}
    for _, uid := range []string{"user1", "user2", "user3", "user4"} {
        if test.IsInTreatment(uid) {
            fmt.Println(uid, "gets new checkout")
        } else {
            fmt.Println(uid, "gets old checkout")
        }
    }
}
```

---

## 22. Monitoring and Observability at Branch Points

```go
package main

import (
    "fmt"
    "sync/atomic"
)

// Counting branch executions
type BranchCounter struct {
    trueBranch  atomic.Int64
    falseBranch atomic.Int64
}

func (bc *BranchCounter) TakeTrue() {
    bc.trueBranch.Add(1)
}

func (bc *BranchCounter) TakeFalse() {
    bc.falseBranch.Add(1)
}

func (bc *BranchCounter) Stats() (int64, int64, float64) {
    t := bc.trueBranch.Load()
    f := bc.falseBranch.Load()
    total := t + f
    if total == 0 {
        return t, f, 0
    }
    return t, f, float64(t) / float64(total) * 100
}

var cacheHitCounter BranchCounter

func getCachedValue(cache map[string]int, key string) (int, bool) {
    val, ok := cache[key]
    if ok {
        cacheHitCounter.TakeTrue()
    } else {
        cacheHitCounter.TakeFalse()
    }
    return val, ok
}

func main() {
    cache := map[string]int{"a": 1, "b": 2}
    keys := []string{"a", "c", "b", "d", "a"}

    for _, k := range keys {
        getCachedValue(cache, k)
    }

    hits, misses, pct := cacheHitCounter.Stats()
    fmt.Printf("Cache hits: %d, misses: %d, hit rate: %.1f%%\n", hits, misses, pct)
}
```

---

## 23. if-else and SLA/SLO Design

```go
package main

import (
    "fmt"
    "time"
)

// SLO-aware routing
type ServiceTier int

const (
    TierBronze ServiceTier = iota
    TierSilver
    TierGold
    TierPlatinum
)

type Request struct {
    UserTier  ServiceTier
    Timestamp time.Time
}

func getTimeout(req Request) time.Duration {
    if req.UserTier >= TierPlatinum {
        return 100 * time.Millisecond
    } else if req.UserTier >= TierGold {
        return 500 * time.Millisecond
    } else if req.UserTier >= TierSilver {
        return 2 * time.Second
    }
    return 10 * time.Second
}

func getRetryCount(req Request) int {
    if req.UserTier >= TierPlatinum {
        return 5
    } else if req.UserTier >= TierGold {
        return 3
    }
    return 1
}

func main() {
    reqs := []Request{
        {TierPlatinum, time.Now()},
        {TierGold, time.Now()},
        {TierBronze, time.Now()},
    }
    for _, r := range reqs {
        fmt.Printf("Tier %d: timeout=%v, retries=%d\n",
            r.UserTier, getTimeout(r), getRetryCount(r))
    }
}
```

---

## 24. Postmortems: Real if-else Bugs in Production

### Postmortem 1: The Sign Flip Bug (2hrs downtime)

```go
// ORIGINAL CODE (had a bug)
func applyDiscount(price, discount float64) float64 {
    if discount > 0 {
        return price - discount  // BUG: if discount=101 on price=100, returns -1
    }
    return price
}

// SHOULD HAVE BEEN
func applyDiscount(price, discount float64) float64 {
    if discount <= 0 {
        return price
    }
    if discount >= price {
        return 0  // cap at 0
    }
    return price - discount
}
```

**Root cause**: Missing upper-bound check in if-else condition.
**Fix**: Added `discount >= price` guard clause.

### Postmortem 2: The Nil Interface Bug (silent data loss)

```go
// THE BUG: returned typed nil causes incorrect nil check
func getLogger(verbose bool) Logger {
    var l *FileLogger  // typed nil
    if verbose {
        l = &FileLogger{path: "/var/log/app.log"}
    }
    return l  // returns typed nil — callers if l != nil check fails to catch it
}

// THE FIX: explicit nil return
func getLogger2(verbose bool) Logger {
    if verbose {
        return &FileLogger{path: "/var/log/app.log"}
    }
    return nil  // untyped nil
}

type Logger interface{ Log(string) }
type FileLogger struct{ path string }
func (f *FileLogger) Log(s string) { fmt.Println(f.path, s) }
```

**Root cause**: Typed nil returned as interface — classic Go gotcha.

---

## 25. Performance Optimization Case Studies

### Case 1: Hot Loop Branch Elimination

```go
package main

import "testing"

// BEFORE: Branch inside tight loop
func sumPositivesBefore(data []int) int {
    sum := 0
    for _, v := range data {
        if v > 0 {
            sum += v
        }
    }
    return sum
}

// AFTER: Pre-filter to eliminate branch
func sumPositivesAfter(data []int) int {
    // Filter first (single pass, predictable)
    positives := data[:0]
    for _, v := range data {
        if v > 0 {
            positives = append(positives, v)
        }
    }
    // Sum without branch (SIMD-friendly)
    sum := 0
    for _, v := range positives {
        sum += v
    }
    return sum
}

// Benchmark shows ~30% improvement for random data
func BenchmarkBefore(b *testing.B) {
    data := make([]int, 1000)
    for i := range data {
        if i%3 == 0 {
            data[i] = -i
        } else {
            data[i] = i
        }
    }
    for i := 0; i < b.N; i++ {
        sumPositivesBefore(data)
    }
}
```

---

## 26. Testing Strategies for Complex Branches

```go
package main

import (
    "testing"
)

// Mutation testing for if-else
// Change > to >= and verify tests catch it

func categorize(age int, income float64, creditScore int) string {
    if age < 18 {
        return "minor"
    }
    if creditScore < 600 {
        return "high-risk"
    }
    if income < 30000 && creditScore < 700 {
        return "limited"
    }
    if income >= 100000 || creditScore >= 800 {
        return "premium"
    }
    return "standard"
}

func TestCategorize(t *testing.T) {
    tests := []struct {
        age, credit int
        income      float64
        want        string
        name        string
    }{
        {17, 750, 50000, "minor", "underage"},
        {25, 550, 80000, "high-risk", "bad credit"},
        {25, 650, 25000, "limited", "low income medium credit"},
        {25, 700, 25000, "standard", "boundary income"},
        {25, 850, 50000, "premium", "excellent credit"},
        {25, 700, 100000, "premium", "high income"},
        {18, 600, 30000, "standard", "all minimums"},  // Boundary!
        {17, 600, 100000, "minor", "underage overrides"},
    }
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            if got := categorize(tt.age, tt.income, tt.credit); got != tt.want {
                t.Errorf("categorize(%d, %.0f, %d) = %q, want %q",
                    tt.age, tt.income, tt.credit, got, tt.want)
            }
        })
    }
}
```

---

## 27. Summary: Senior Decision Framework

When evaluating if-else in production code, ask:

**Performance Questions:**
1. Is this in a hot path? (>1M calls/sec)
2. Is the branch predictable? (sorted data = predictable)
3. Can escape analysis keep variables on stack?
4. Is the function small enough to inline?

**Correctness Questions:**
1. Are boundary conditions correct (`>` vs `>=`)?
2. Is there a typed nil interface trap?
3. Are concurrent accesses to branch conditions protected?
4. Is the condition order correct (most restrictive first)?

**Design Questions:**
1. Is cyclomatic complexity > 10? Consider refactoring
2. Could a FSM, strategy pattern, or dispatch table be cleaner?
3. Are error cases handled before the happy path?
4. Would a different API design eliminate this if-else?

**Testing Questions:**
1. Is every branch covered by tests?
2. Are boundary values tested?
3. Would mutation testing catch off-by-one errors?
4. Are there integration tests for the branching behavior?

```go
// The senior checklist in code:
func processRequest(req *Request) (*Response, error) {
    // 1. Guard clauses first (nil, empty, invalid)
    if req == nil {
        return nil, errors.New("nil request")
    }
    if req.ID == "" {
        return nil, errors.New("empty request ID")
    }

    // 2. Happy path flat (no else after returns)
    user, err := getUser(req.UserID)
    if err != nil {
        return nil, fmt.Errorf("get user: %w", err)
    }

    // 3. Business logic clearly separated
    if !user.CanProcess() {
        return &Response{Status: "forbidden"}, nil
    }

    // 4. Single return point for success
    result, err := process(req)
    if err != nil {
        return nil, fmt.Errorf("process: %w", err)
    }
    return result, nil
}

type Request struct{ ID, UserID string }
type Response struct{ Status string }
type User struct{}
func (u *User) CanProcess() bool { return true }
func getUser(id string) (*User, error) { return &User{}, nil }
func process(r *Request) (*Response, error) { return &Response{Status: "ok"}, nil }
```
