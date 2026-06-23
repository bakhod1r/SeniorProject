# Boolean — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Architecture Decisions](#architecture-decisions)
3. [Performance Benchmarks](#performance-benchmarks)
4. [Memory Layout & Internals](#memory-layout-internals)
5. [Concurrency Deep Dive](#concurrency-deep-dive)
6. [Compiler Optimizations](#compiler-optimizations)
7. [Boolean in System Design](#boolean-in-system-design)
8. [Large-Scale Patterns](#large-scale-patterns)
9. [Postmortem Analysis](#postmortem-analysis)
10. [Advanced Code Examples](#advanced-code-examples)
11. [Testing Strategies](#testing-strategies)
12. [Profiling Boolean-Heavy Code](#profiling-boolean-heavy-code)
13. [Optimization Techniques](#optimization-techniques)
14. [Code Review Checklist](#code-review-checklist)
15. [Edge Cases at Scale](#edge-cases-at-scale)
16. [Anti-Patterns at Scale](#anti-patterns-at-scale)
17. [Design Patterns](#design-patterns)
18. [Cross-Service Boolean Design](#cross-service-boolean-design)
19. [Observability](#observability)
20. [Security at Scale](#security-at-scale)
21. [Tricky Questions](#tricky-questions)
22. [Cheat Sheet](#cheat-sheet)
23. [Self-Assessment Checklist](#self-assessment-checklist)
24. [Summary](#summary)
25. [Further Reading](#further-reading)
26. [Diagrams & Visual Aids](#diagrams-visual-aids)
27. [What You Can Build](#what-you-can-build)

---

## Introduction

> **Focus:** "How to optimize?" and "How to architect?"

At the senior level, boolean design choices affect system architecture, concurrency safety, performance at scale, and maintainability across teams. What looks like a simple `bool` field can become a source of:
- Race conditions in concurrent systems
- Boolean explosions in domain models
- API versioning problems in distributed systems
- Subtle security vulnerabilities

The goal at this level: make boolean usage decisions that remain correct and maintainable as systems grow from single-process to distributed.

---

## Architecture Decisions

### When `bool` Breaks at Scale

A common pattern in growing systems:

```
v1: IsActive bool
v2: IsActive bool, IsSuspended bool
v3: IsActive bool, IsSuspended bool, IsPendingVerification bool
v4: ... (now you have 8 booleans and 256 possible states)
```

**Decision Framework:**

```
Ask: Are these states mutually exclusive?
  YES → Use iota enum
  NO  → booleans are valid, but document invariants

Ask: Will this state be serialized (JSON/DB/protobuf)?
  YES → Enum is more forward-compatible
  NO  → bool is fine if scope is local

Ask: Will external systems need to reason about this?
  YES → Use string enum for readability
  NO  → iota is fine
```

### Designing Boolean APIs for Versioning

```go
// v1: Bool in JSON API
type UserV1 struct {
    IsActive bool `json:"is_active"`
}

// v2: You want to add "suspended" but can't break v1 clients
// Problem: is_active=false could mean inactive OR suspended

// Solution: use string enum from the start
type UserV2 struct {
    Status string `json:"status"` // "active", "inactive", "suspended"
}

// Or use int with named constants
type AccountStatus int
const (
    AccountActive    AccountStatus = 1
    AccountInactive  AccountStatus = 2
    AccountSuspended AccountStatus = 3
)
```

### Bool in Protobuf / gRPC

```protobuf
// Fragile: changing semantics of a bool requires a new field
message User {
  bool is_active = 1;  // what if we add "suspended" later?
}

// Better: use enum from the start
message User {
  enum Status {
    STATUS_UNSPECIFIED = 0;
    STATUS_ACTIVE = 1;
    STATUS_INACTIVE = 2;
    STATUS_SUSPENDED = 3;
  }
  Status status = 1;
}
```

---

## Performance Benchmarks

```go
package main

import (
    "testing"
)

// Benchmark: direct bool vs function call
var result bool

func BenchmarkDirectBool(b *testing.B) {
    x := 5
    for i := 0; i < b.N; i++ {
        result = x > 3
    }
}

func BenchmarkFunctionBool(b *testing.B) {
    x := 5
    for i := 0; i < b.N; i++ {
        result = isGreaterThan3(x)
    }
}

func isGreaterThan3(x int) bool { return x > 3 }

// Benchmark: map[string]bool vs map[string]struct{} for sets
var setResult bool

func BenchmarkMapBool(b *testing.B) {
    m := map[string]bool{"key": true}
    for i := 0; i < b.N; i++ {
        setResult = m["key"]
    }
}

func BenchmarkMapStruct(b *testing.B) {
    m := map[string]struct{}{"key": {}}
    for i := 0; i < b.N; i++ {
        _, setResult = m["key"]
    }
}
```

Typical results:
- Direct bool: ~0.3ns/op
- Function bool (inlined): ~0.3ns/op (compiler inlines it)
- Function bool (not inlined): ~2ns/op
- `map[string]bool` vs `map[string]struct{}`: functionally identical performance; struct{} saves ~1 byte/entry

### Branch Prediction Impact

```go
// Predictable pattern (branch predictor loves this):
for i := 0; i < n; i++ {
    if items[i].IsActive {  // mostly true or mostly false = fast
        process(items[i])
    }
}

// Unpredictable pattern (branch misprediction = slow):
// If IsActive alternates randomly, CPU pays misprediction penalty (~15 cycles)
// Consider: sort items by IsActive, process all active first
```

---

## Memory Layout & Internals

### Bool in Struct Padding

```go
// Inefficient: bool causes padding
type Bad struct {
    IsActive bool   // 1 byte
    // 7 bytes padding
    Count    int64  // 8 bytes
    IsReady  bool   // 1 byte
    // 7 bytes padding
    Size     int64  // 8 bytes
}
// Total: 32 bytes

// Efficient: group small types together
type Good struct {
    Count    int64  // 8 bytes
    Size     int64  // 8 bytes
    IsActive bool   // 1 byte
    IsReady  bool   // 1 byte
    // 6 bytes padding
}
// Total: 24 bytes
```

Check with:
```go
import (
    "fmt"
    "unsafe"
)

fmt.Println(unsafe.Sizeof(Bad{}))  // 32
fmt.Println(unsafe.Sizeof(Good{})) // 24
```

### Bit Packing (When Memory is Critical)

```go
// For very large slices of boolean flags
type Flags uint8

const (
    FlagActive    Flags = 1 << 0  // bit 0
    FlagPaid      Flags = 1 << 1  // bit 1
    FlagShipped   Flags = 1 << 2  // bit 2
    FlagDelivered Flags = 1 << 3  // bit 3
)

func (f Flags) Has(flag Flags) bool {
    return f&flag != 0
}

func (f *Flags) Set(flag Flags) {
    *f |= flag
}

func (f *Flags) Clear(flag Flags) {
    *f &^= flag
}

// Usage
var flags Flags
flags.Set(FlagActive | FlagPaid)
fmt.Println(flags.Has(FlagActive)) // true
fmt.Println(flags.Has(FlagShipped)) // false

// Memory: 8 booleans in 1 byte vs 8 bytes
// For a slice of 1M records: 1MB vs 8MB
```

---

## Concurrency Deep Dive

### The Bool Race Condition Pattern

```go
// This is a classic mistake even experienced developers make
type Server struct {
    isRunning bool
}

func (s *Server) Start() {
    s.isRunning = true // RACE: if called from multiple goroutines
    go s.serve()
}

func (s *Server) Stop() {
    s.isRunning = false // RACE
}

func (s *Server) serve() {
    for s.isRunning { // RACE
        // ...
    }
}
```

**Production-grade fix:**

```go
import (
    "context"
    "sync"
)

type Server struct {
    mu      sync.RWMutex
    running bool
    ctx     context.Context
    cancel  context.CancelFunc
    wg      sync.WaitGroup
}

func (s *Server) Start() error {
    s.mu.Lock()
    defer s.mu.Unlock()

    if s.running {
        return fmt.Errorf("server already running")
    }

    s.ctx, s.cancel = context.WithCancel(context.Background())
    s.running = true

    s.wg.Add(1)
    go func() {
        defer s.wg.Done()
        s.serve(s.ctx)
    }()
    return nil
}

func (s *Server) Stop() {
    s.mu.Lock()
    if !s.running {
        s.mu.Unlock()
        return
    }
    s.running = false
    s.cancel()
    s.mu.Unlock()

    s.wg.Wait() // wait for goroutine to finish
}

func (s *Server) serve(ctx context.Context) {
    for {
        select {
        case <-ctx.Done():
            return
        default:
            // process work
        }
    }
}
```

### Compare-and-Swap Pattern

```go
import "sync/atomic"

type Once struct {
    done int32
}

func (o *Once) Do(f func()) {
    // CAS: only one goroutine can transition 0→1
    if atomic.CompareAndSwapInt32(&o.done, 0, 1) {
        f()
    }
}
```

---

## Compiler Optimizations

### Inlining of Bool Functions

```go
// go:noinline prevents inlining (for benchmarking)
//go:noinline
func isPositive(x int) bool { return x > 0 }

// Without //go:noinline, the compiler inlines this:
// if isPositive(x) becomes if x > 0 directly
```

Check inlining:
```bash
go build -gcflags="-m" ./...
# Output shows: can inline isPositive
```

### Dead Code Elimination with Const Bool

```go
const Debug = false

func process() {
    if Debug {
        fmt.Println("debug info") // This block is compiled out when Debug=false
    }
    // ...
}
```

The compiler eliminates the entire `if Debug` block when `Debug` is a `const false`.

### Branch Elimination

```go
// Compiler can sometimes eliminate branches for always-true/always-false conditions
// This is useful for build tags:

//go:build debug

const isDebug = true
```

---

## Boolean in System Design

### Feature Flags at Scale

```
Feature Flag Architecture:

┌─────────────┐    ┌──────────────┐    ┌─────────────────┐
│  Config DB   │───▶│  Flag Cache  │───▶│  Your Service   │
│ (Postgres)   │    │  (Redis)     │    │  flag.IsEnabled │
└─────────────┘    └──────────────┘    └─────────────────┘
      │                                        │
      └─────── Flag Change Event ─────────────▶│
                (invalidate cache)
```

```go
type FlagEvaluator struct {
    cache  *redis.Client
    db     *sql.DB
    mu     sync.RWMutex
    local  map[string]bool // in-memory fallback
}

func (fe *FlagEvaluator) IsEnabled(ctx context.Context, flag, userID string) bool {
    // 1. Check local cache (fastest)
    fe.mu.RLock()
    if v, ok := fe.local[flag+":"+userID]; ok {
        fe.mu.RUnlock()
        return v
    }
    fe.mu.RUnlock()

    // 2. Check Redis (fast)
    key := fmt.Sprintf("flag:%s:user:%s", flag, userID)
    val, err := fe.cache.Get(ctx, key).Bool()
    if err == nil {
        return val
    }

    // 3. Fall back to DB (slow, populate cache)
    result := fe.evaluateFromDB(ctx, flag, userID)
    fe.cache.Set(ctx, key, result, 5*time.Minute)
    return result
}
```

### Event Sourcing with Boolean State

```go
// Instead of storing current bool state, store events
type Event struct {
    Type      string    // "user.activated", "user.deactivated"
    Timestamp time.Time
    UserID    string
}

// Derive current bool from event history
func isUserActive(events []Event, userID string) bool {
    var active bool
    for _, e := range events {
        if e.UserID != userID { continue }
        switch e.Type {
        case "user.activated":
            active = true
        case "user.deactivated":
            active = false
        }
    }
    return active
}
```

---

## Large-Scale Patterns

### Boolean Normalization in Database

```sql
-- Denormalized (booleans scattered)
ALTER TABLE users ADD COLUMN is_active BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN is_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN is_premium BOOLEAN DEFAULT FALSE;

-- Better: normalized status table for audit trail
CREATE TABLE user_status (
    user_id    INT,
    status     VARCHAR(20),
    changed_at TIMESTAMP,
    changed_by INT
);
```

### Distributed Boolean with Consensus

When a boolean flag must be consistent across multiple nodes:

```
Node 1: isLeader = true   ← must be exactly ONE leader
Node 2: isLeader = false
Node 3: isLeader = false

Use Raft/Paxos to agree on which node is leader.
Never use a simple shared bool — it will diverge under partitions.
```

---

## Postmortem Analysis

### Incident: Data Race on Service Bool Flag

**Scenario**: High-traffic service. Engineers added `isMaintenanceMode bool` to a global struct. Works fine in staging. In production under load, the service panics with "concurrent map writes" (triggered by other code) and some requests see stale `isMaintenanceMode = false` during maintenance window.

**Root Cause**: Unsynchronized read/write of `isMaintenanceMode` across goroutines. The Go memory model does not guarantee visibility of unsynchronized writes.

**Detection**: `go test -race` would have caught this immediately.

**Fix**:
```go
var maintenanceMode int32

func SetMaintenanceMode(enabled bool) {
    if enabled {
        atomic.StoreInt32(&maintenanceMode, 1)
    } else {
        atomic.StoreInt32(&maintenanceMode, 0)
    }
}

func IsMaintenanceMode() bool {
    return atomic.LoadInt32(&maintenanceMode) == 1
}
```

**Prevention**: Always run `go test -race ./...` in CI.

---

## Advanced Code Examples

### Bitset for High-Performance Boolean Collections

```go
package bitset

// Bitset stores N booleans in N/8 bytes
type Bitset struct {
    data []byte
    size int
}

func New(size int) *Bitset {
    return &Bitset{
        data: make([]byte, (size+7)/8),
        size: size,
    }
}

func (b *Bitset) Set(i int) {
    if i < 0 || i >= b.size { return }
    b.data[i/8] |= 1 << uint(i%8)
}

func (b *Bitset) Clear(i int) {
    if i < 0 || i >= b.size { return }
    b.data[i/8] &^= 1 << uint(i%8)
}

func (b *Bitset) Get(i int) bool {
    if i < 0 || i >= b.size { return false }
    return b.data[i/8]&(1<<uint(i%8)) != 0
}

func (b *Bitset) Count() int {
    count := 0
    for _, byte_ := range b.data {
        for byte_ != 0 {
            count += int(byte_ & 1)
            byte_ >>= 1
        }
    }
    return count
}
```

### Thread-Safe Feature Flag Registry

```go
package flags

import (
    "sync"
)

type Registry struct {
    mu    sync.RWMutex
    flags map[string]bool
}

func NewRegistry() *Registry {
    return &Registry{flags: make(map[string]bool)}
}

func (r *Registry) Set(name string, value bool) {
    r.mu.Lock()
    defer r.mu.Unlock()
    r.flags[name] = value
}

func (r *Registry) Get(name string) bool {
    r.mu.RLock()
    defer r.mu.RUnlock()
    return r.flags[name] // false if not set — safe default
}

func (r *Registry) Toggle(name string) {
    r.mu.Lock()
    defer r.mu.Unlock()
    r.flags[name] = !r.flags[name]
}

func (r *Registry) Snapshot() map[string]bool {
    r.mu.RLock()
    defer r.mu.RUnlock()
    snap := make(map[string]bool, len(r.flags))
    for k, v := range r.flags {
        snap[k] = v
    }
    return snap
}
```

---

## Testing Strategies

### Property-Based Testing of Bool Logic

```go
import "testing/quick"

func TestDeMorgansLaw(t *testing.T) {
    f := func(a, b bool) bool {
        // De Morgan: !(a && b) == !a || !b
        return !(a && b) == (!a || !b)
    }
    if err := quick.Check(f, nil); err != nil {
        t.Error(err)
    }
}

func TestShortCircuitProperty(t *testing.T) {
    // Property: false && X is always false regardless of X
    f := func(x bool) bool {
        return (false && x) == false
    }
    if err := quick.Check(f, nil); err != nil {
        t.Error(err)
    }
}
```

### Race Detector in Tests

```go
// Always run with -race in CI
// go test -race -count=100 ./...

func TestConcurrentFlag(t *testing.T) {
    r := NewRegistry()
    var wg sync.WaitGroup

    // 100 concurrent writers
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            r.Set("flag", true)
        }()
    }

    // 100 concurrent readers
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            _ = r.Get("flag")
        }()
    }

    wg.Wait()
}
```

---

## Profiling Boolean-Heavy Code

```go
// Profile branch mispredictions:
// go test -bench=. -cpuprofile=cpu.prof
// go tool pprof cpu.prof

// For branch prediction optimization:
// Sort data so booleans are predictable
import "sort"

type Item struct {
    IsActive bool
    Data     string
}

func optimizeForBranchPrediction(items []Item) []Item {
    // Sort: all active first, then inactive
    sort.Slice(items, func(i, j int) bool {
        if items[i].IsActive != items[j].IsActive {
            return items[i].IsActive // true (active) comes first
        }
        return false
    })
    return items
}
```

---

## Optimization Techniques

### 1. Avoid Boolean Parameters in Hot Paths

```go
// Slow: branch in hot loop
for _, item := range items {
    process(item, true) // bool branch inside process()
}

// Fast: two separate loops or two separate functions
for _, item := range activeItems {
    processActive(item)
}
for _, item := range inactiveItems {
    processInactive(item)
}
```

### 2. Compile-Time Constants for Dead Code Elimination

```go
const Production = true

func log(msg string) {
    if !Production {
        fmt.Println(msg) // compiled out in production build
    }
}
```

### 3. Batch Boolean Operations with SIMD (via Assembly)

For processing millions of boolean flags (e.g., Bloom filter, Roaring Bitmap), assembly or CGO with SIMD instructions can process 256 bits (32 booleans) at once. This is advanced territory — Go's `math/bits` package provides some POPCNT support.

---

## Code Review Checklist

When reviewing code with boolean usage:

- [ ] Is a `bool` the right type or should it be an enum/state type?
- [ ] Are bool struct fields named with positive, clear names?
- [ ] Are bool function parameters replaced with options structs?
- [ ] Is the bool accessed from multiple goroutines? If so, is it protected?
- [ ] Does `go test -race` pass?
- [ ] Is the zero value (`false`) the safe default?
- [ ] Are there more than 3 related bool fields (state explosion risk)?
- [ ] Is short-circuit order correct (cheap checks first, nil checks before dereference)?
- [ ] Are there any double negatives in naming?
- [ ] Is `map[string]bool` used as a set? Consider `map[string]struct{}` for large sets.

---

## Edge Cases at Scale

### Bool in Database Schema Evolution

```sql
-- v1: simple bool
ALTER TABLE users ADD COLUMN is_premium BOOLEAN DEFAULT FALSE;

-- v2: now you need "premium_until" date — bool can't express this
-- You're forced to add another column and maintain both
ALTER TABLE users ADD COLUMN premium_until TIMESTAMP;

-- This creates an invariant: is_premium MUST match (premium_until > now())
-- These invariants are hard to maintain at scale
```

**Solution**: Use `premium_until` timestamp from the start. Derive `is_premium` as a computed column or view.

### Bool in JSON Schema — Forward Compatibility

```json
// v1 client sends:
{"is_active": true}

// v2 server receives it fine.
// But now v2 adds "is_suspended".
// Old clients can't send it — all v1 users will appear non-suspended.
// THIS IS ACTUALLY FINE if you default to false (safe default).
// Problem arises if you need "unknown" state — bool can't express that.
```

---

## Anti-Patterns at Scale

### The "Boolean Bag" Anti-Pattern

```go
// 10 bool fields — this is a design smell
type User struct {
    IsActive         bool
    IsSuspended      bool
    IsVerified       bool
    IsPremium        bool
    IsEmployee       bool
    IsDeleted        bool
    IsNewsletterSub  bool
    IsAPIEnabled     bool
    Is2FAEnabled     bool
    IsPhoneVerified  bool
}
// Better: separate concerns into UserStatus, UserFeatures, UserPermissions
```

### The "Mutable Singleton Bool" Anti-Pattern

```go
var globalFlag bool // package-level mutable bool

func SetGlobal(b bool) { globalFlag = b }     // NOT thread-safe
func GetGlobal() bool  { return globalFlag }  // NOT thread-safe

// Use atomic or proper synchronization
```

---

## Design Patterns

### Strategy Pattern with Bool Toggle

```go
type Validator interface {
    Validate(s string) bool
}

type EmailValidator struct{}
func (e EmailValidator) Validate(s string) bool { return strings.Contains(s, "@") }

type NoopValidator struct{}
func (n NoopValidator) Validate(s string) bool { return true } // always valid

func getValidator(strict bool) Validator {
    if strict {
        return EmailValidator{}
    }
    return NoopValidator{}
}
```

### Observer Pattern for Bool State Changes

```go
type BoolState struct {
    mu        sync.RWMutex
    value     bool
    listeners []func(bool)
}

func (s *BoolState) Set(v bool) {
    s.mu.Lock()
    changed := s.value != v
    s.value = v
    listeners := s.listeners
    s.mu.Unlock()

    if changed {
        for _, l := range listeners {
            l(v)
        }
    }
}

func (s *BoolState) Subscribe(fn func(bool)) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.listeners = append(s.listeners, fn)
}
```

---

## Cross-Service Boolean Design

### Bool in Event-Driven Systems

```go
// When publishing events, avoid booleans in event names
// BAD: "user.is_active.changed" (what changed to what?)
// GOOD: "user.activated" / "user.deactivated"

type UserEvent struct {
    Type      string    // "user.activated" or "user.deactivated"
    UserID    string
    Timestamp time.Time
}
```

### Bool in gRPC Response

```go
// Fragile: bool response
rpc IsUserActive(UserRequest) returns (BoolResponse);

// Better: explicit status
rpc GetUserStatus(UserRequest) returns (UserStatusResponse);

message UserStatusResponse {
  enum Status { UNKNOWN = 0; ACTIVE = 1; INACTIVE = 2; SUSPENDED = 3; }
  Status status = 1;
}
```

---

## Observability

### Tracking Bool State Changes

```go
import "github.com/prometheus/client_golang/prometheus"

var (
    featureFlagGauge = prometheus.NewGaugeVec(
        prometheus.GaugeOpts{
            Name: "feature_flag_enabled",
            Help: "1 if feature flag is enabled, 0 if disabled",
        },
        []string{"flag_name"},
    )
)

func setFlag(name string, enabled bool) {
    // Business logic...

    // Metrics
    val := 0.0
    if enabled { val = 1.0 }
    featureFlagGauge.WithLabelValues(name).Set(val)
}
```

---

## Security at Scale

### Bool for Auth Token Claims

```go
// JWT claim: "is_admin": true
// Risk: if JWT secret is weak, attacker can forge tokens with is_admin=true

// Better: store permissions in DB, use JWT only for identity
type Claims struct {
    UserID string `json:"sub"`
    // NO permission booleans in JWT
    jwt.RegisteredClaims
}

// Check permissions from DB/cache, not from token
func hasPermission(userID, permission string) bool {
    return permCache.Check(userID, permission)
}
```

### Audit Trail for Bool State Changes

```go
type AuditEntry struct {
    UserID    string
    Field     string
    OldValue  bool
    NewValue  bool
    ChangedBy string
    ChangedAt time.Time
    Reason    string
}

func (svc *UserService) SetActive(userID string, active bool, changedBy, reason string) error {
    old, err := svc.getActiveStatus(userID)
    if err != nil { return err }

    if err := svc.db.SetActive(userID, active); err != nil { return err }

    svc.audit.Log(AuditEntry{
        UserID:    userID,
        Field:     "is_active",
        OldValue:  old,
        NewValue:  active,
        ChangedBy: changedBy,
        ChangedAt: time.Now(),
        Reason:    reason,
    })
    return nil
}
```

---

## Tricky Questions

**Q1: A bool field in a struct is being set from one goroutine and read from another. You're using `sync.Mutex`. Is there a faster option?**
A: Yes. Use `sync/atomic` with an `int32` — atomic ops are lock-free and use CPU-level instructions (LOCK XCHG) which are faster than mutex locking.

**Q2: You have a feature flag that 1M requests/second check. What's the most efficient implementation?**
A: In-process atomic int32 (`atomic.LoadInt32`). No network, no lock contention. ~1ns/op.

**Q3: Your struct has 8 bool fields. Each struct is stored in a slice of 10M items. How can you reduce memory?**
A: Use a `uint8` bitmask. 8 booleans = 8 bytes normally; with bitmask = 1 byte. For 10M items: 80MB → 10MB.

**Q4: How do you test a function that uses short-circuit evaluation for correctness?**
A: Use a mock/spy function that records whether it was called. Verify it's NOT called when short-circuit should prevent it.

**Q5: A distributed system needs a "leader elected" bool. What are the failure modes of a simple shared bool?**
A: Network partition — two nodes can both see themselves as leader. Need consensus (Raft/Paxos), not a shared bool.

---

## Cheat Sheet

```
Senior Bool Decisions:
  3+ related bools?        → use iota/enum
  Bool in goroutine?       → sync/atomic (int32) or sync.Mutex
  Bool param in function?  → options struct
  Bool in JSON API?        → consider enum for future versioning
  Bool in hot loop?        → sort data for branch prediction
  Many bools per record?   → bitpacking (uint8/uint16)
  Bool for distributed state → need consensus, not shared var

Memory:
  bool:         1 byte
  8 bools:      8 bytes (struct) vs 1 byte (uint8 bitmask)
  struct padding: group small fields together

Thread Safety:
  bool          → NOT thread safe
  int32 + atomic → thread safe, lock-free
  bool + mutex  → thread safe, lock-based

Testing:
  go test -race ./...  → ALWAYS in CI
  quick.Check          → property-based testing
```

---

## Self-Assessment Checklist

- [ ] I can identify when multiple booleans should become a state type
- [ ] I understand struct padding and can optimize bool layout
- [ ] I can implement thread-safe boolean patterns with atomic
- [ ] I know the performance implications of bool vs. bitset
- [ ] I can design bool APIs that are version-safe in distributed systems
- [ ] I use `go test -race` and understand what it detects
- [ ] I can design feature flag systems with appropriate caching
- [ ] I can write audit trails for boolean state changes
- [ ] I understand branch prediction and can optimize for it

---

## Summary

At the senior level, `bool` decisions cascade into system design:
- **Struct design**: avoid bool explosion; use state types
- **Concurrency**: always synchronize shared booleans
- **Performance**: bitpacking, branch prediction, inlining
- **Distributed systems**: booleans can't express consensus; use proper coordination
- **API design**: prefer enums over booleans for versioning safety
- **Security**: audit bool state changes; don't store permissions in tokens

---

## Further Reading

- [The Go Memory Model](https://go.dev/ref/mem)
- [sync/atomic package docs](https://pkg.go.dev/sync/atomic)
- [Designing Data-Intensive Applications — Chapter on distributed state](https://dataintensive.net/)
- [Feature Toggles — Martin Fowler](https://martinfowler.com/articles/feature-toggles.html)
- [Go Compiler Optimization Notes](https://github.com/golang/go/wiki/CompilerOptimizations)

---

## Diagrams & Visual Aids

### Bool in Struct Padding

```
Bad layout (32 bytes):
┌────────┬─────────────────┬────────┬─────────────────┐
│IsActive│   7B padding    │ Count  │   IsReady + 7B  │
│ 1 byte │                 │ 8 bytes│                  │
└────────┴─────────────────┴────────┴─────────────────┘

Good layout (24 bytes):
┌────────────────┬────────────────┬─────────┬──────────┐
│     Count      │      Size      │IsActive │IsReady+6B│
│    8 bytes     │    8 bytes     │ 1 byte  │          │
└────────────────┴────────────────┴─────────┴──────────┘
```

### Boolean State in Distributed System

```
                    ┌───────────────────────────┐
                    │    Consensus Layer (Raft)  │
                    │  isLeader for each node    │
                    └───────────────────────────┘
                          │          │          │
                     ┌────┘     ┌────┘     ┌────┘
                  Node 1     Node 2     Node 3
                isLeader=T isLeader=F isLeader=F
```

---

## What You Can Build

- **High-performance feature flag system** with atomic reads and Redis-backed distribution
- **Bitset-based permission system** for millions of users
- **Thread-safe circuit breaker** with atomic state transitions
- **Event-sourced boolean state** with full audit trail
- **Distributed leader election** using consensus (etcd/Raft) for the "isLeader" boolean
- **Prometheus-instrumented flag registry** for observability
