# Boolean — Interview Questions

## Table of Contents
1. [Junior Level Questions](#junior-level-questions)
2. [Middle Level Questions](#middle-level-questions)
3. [Senior Level Questions](#senior-level-questions)
4. [Scenario-Based Questions](#scenario-based-questions)
5. [FAQ — Common Interview Topics](#faq-common-interview-topics)

---

## Junior Level Questions

### Q1: What are the two values a `bool` can hold in Go?

**Answer:** `true` and `false`. These are keywords in Go, not variables or constants.

```go
var isReady bool = true
var isDone bool = false
var defaultBool bool // false (zero value)
```

---

### Q2: What is the zero value of `bool` in Go?

**Answer:** `false`. When a boolean variable is declared without initialization, it defaults to `false`.

```go
var flag bool
fmt.Println(flag) // false

type Config struct {
    Debug bool
}
c := Config{}
fmt.Println(c.Debug) // false
```

---

### Q3: What are the logical operators for `bool` in Go?

**Answer:**
- `&&` — AND: true only if both operands are true
- `||` — OR: true if at least one operand is true
- `!` — NOT: inverts the value

```go
fmt.Println(true && false) // false
fmt.Println(true || false) // true
fmt.Println(!true)         // false
```

---

### Q4: Can you use an integer as a boolean in Go? E.g., `if 1 { }`

**Answer:** No. Go does NOT allow non-boolean expressions in boolean contexts. This is a compile error:

```go
x := 1
if x { // ERROR: non-bool x (type int) used as if condition
    fmt.Println("yes")
}

// Correct:
if x != 0 {
    fmt.Println("yes")
}
```

---

### Q5: What is short-circuit evaluation?

**Answer:** Go evaluates `&&` and `||` from left to right and stops as soon as the result is known:
- `false && anything` → result is `false`, right side is NOT evaluated
- `true || anything` → result is `true`, right side is NOT evaluated

```go
x := 0
// Safe: 10/x is never evaluated because x != 0 is false
if x != 0 && 10/x > 1 {
    fmt.Println("safe")
}
// Without short-circuit, 10/x would panic (division by zero)
```

---

### Q6: What is the size of a `bool` in Go?

**Answer:** 1 byte (8 bits), even though only 1 bit of information is stored. This is due to memory alignment requirements — the smallest addressable unit is 1 byte.

```go
import "unsafe"
fmt.Println(unsafe.Sizeof(true))  // 1
fmt.Println(unsafe.Sizeof(false)) // 1
```

---

### Q7: Is it good practice to write `if flag == true`?

**Answer:** No. It's redundant. Since `flag` is already a `bool`, you can use it directly:

```go
// Redundant
if flag == true { }
if flag == false { }

// Idiomatic Go
if flag { }
if !flag { }
```

---

### Q8: How do you name boolean variables idiomatically in Go?

**Answer:** Use `is`, `has`, `can`, `should` prefixes:

```go
isActive := true
hasError := false
canProceed := true
shouldRetry := false
```

Avoid double negatives:
```go
isNotInactive := true  // BAD: confusing
isActive := true       // GOOD: clear
```

---

### Q9: How can `bool` be used as a set in Go?

**Answer:** Use `map[string]bool`:

```go
visited := map[string]bool{
    "home":  true,
    "about": true,
}

if visited["home"] {
    fmt.Println("Already visited home")
}

// Check membership
_, exists := visited["contact"]
// or simply:
if visited["contact"] {
    // only true if key exists AND value is true
}
```

---

### Q10: What do comparison operators return in Go?

**Answer:** All comparison operators (`==`, `!=`, `<`, `>`, `<=`, `>=`) return `bool`.

```go
a, b := 5, 10
fmt.Println(a == b)  // false
fmt.Println(a != b)  // true
fmt.Println(a < b)   // true
fmt.Println(a > b)   // false
fmt.Println(a <= 5)  // true
fmt.Println(b >= 10) // true
```

---

## Middle Level Questions

### Q11: What is "boolean blindness" and how do you fix it?

**Answer:** Boolean blindness is when a function accepts `bool` parameters and call sites are unreadable:

```go
// BLIND: what does true, false, true mean?
createUser("Alice", true, false, true)

// Fix: use an options struct with named fields
type CreateUserOptions struct {
    IsAdmin    bool
    SendEmail  bool
    Verify     bool
}
createUser("Alice", CreateUserOptions{
    IsAdmin:   true,
    SendEmail: false,
    Verify:    true,
})
```

---

### Q12: What is the `ok` idiom in Go and how does it use `bool`?

**Answer:** The `ok` idiom returns a second `bool` value indicating success:

```go
// Map lookup
value, ok := myMap["key"]
if !ok {
    // key not found
}

// Type assertion
s, ok := interface{}("hello").(string)
if !ok {
    // not a string
}

// Channel receive
v, ok := <-ch
if !ok {
    // channel closed
}
```

---

### Q13: When should you use `iota` instead of multiple `bool` fields?

**Answer:** When you have mutually exclusive states (more than 2), use `iota`:

```go
// Too many booleans:
type Order struct {
    IsPending   bool
    IsPaid      bool
    IsShipped   bool
    IsDelivered bool
    IsCancelled bool
}
// 5 booleans = 32 possible states, many invalid

// Better:
type OrderStatus int
const (
    StatusPending   OrderStatus = iota
    StatusPaid
    StatusShipped
    StatusDelivered
    StatusCancelled
)
type Order struct {
    Status OrderStatus
}
```

---

### Q14: Is a `bool` in Go thread-safe?

**Answer:** No. Reading and writing a `bool` from multiple goroutines without synchronization is a data race:

```go
var isRunning bool

// RACE:
go func() { isRunning = true }()
go func() { fmt.Println(isRunning) }()

// FIX with atomic:
var isRunning int32
go func() { atomic.StoreInt32(&isRunning, 1) }()
go func() { fmt.Println(atomic.LoadInt32(&isRunning) == 1) }()
```

---

### Q15: What is De Morgan's Law and when is it useful in Go?

**Answer:**
- `!(A && B)` equals `!A || !B`
- `!(A || B)` equals `!A && !B`

Useful for simplifying complex boolean logic:

```go
// Complex: double negation
if !(isBlocked || isBanned) {
    // user can access
}

// Simplified by De Morgan's:
if !isBlocked && !isBanned {
    // same logic, more readable
}
```

---

### Q16: What's wrong with the following code? `if ptr.field > 0 && ptr != nil`

**Answer:** The nil check is on the WRONG side. With short-circuit `&&`, if `ptr.field > 0` panics (because `ptr` is nil), the nil check is never evaluated.

```go
// PANIC if ptr is nil:
if ptr.field > 0 && ptr != nil { }

// CORRECT: nil check first
if ptr != nil && ptr.field > 0 { }
```

---

### Q17: What is the difference between `map[string]bool` and `map[string]struct{}` for implementing a set?

**Answer:**
- `map[string]bool`: value is 1 byte; lookup returns `false` for missing keys
- `map[string]struct{}`: value is 0 bytes (empty struct); must use two-value form to check existence

```go
// bool set
boolSet := map[string]bool{"a": true}
isMember := boolSet["a"]    // true
isMember = boolSet["z"]     // false (zero value, can't distinguish "not in set" from "in set as false")

// struct{} set (preferred for large sets — saves 1 byte per entry)
structSet := map[string]struct{}{"a": {}}
_, isMember2 := structSet["a"]  // true
_, isMember2 = structSet["z"]   // false
```

---

### Q18: What happens when you have 5 `bool` fields representing state? What's the maximum number of states?

**Answer:** 2^5 = 32 possible combinations. Many of these will be invalid/impossible, making the code hard to reason about. Use a state type:

```go
// 5 booleans = 32 possible states, ~20 of which are probably invalid
// Replace with explicit state enumeration
type Status int
const (
    StatusPending Status = iota
    StatusActive
    StatusSuspended
    StatusCancelled
    StatusCompleted
)
// Only 5 valid states, enforced by the type system
```

---

## Senior Level Questions

### Q19: Explain how short-circuit evaluation works at the assembly level for `a && b`.

**Answer:** The compiler generates a conditional jump:

```asm
; a && b
MOVBLZX "a", AX
TESTB   AL, AL       ; test if a is zero (false)
JEQ     L_false      ; jump if false — b is NOT evaluated
MOVBLZX "b", AX     ; a was true, now evaluate b
; return b's value
L_false:
; return false
```

The `JEQ L_false` instruction is the short-circuit: if `a` is false (zero), we jump past b's evaluation entirely.

---

### Q20: How does Go's compiler optimize `const debug = false`?

**Answer:** Constant folding + dead code elimination:

```go
const debug = false

func process() {
    if debug {                  // constant folding: if false
        log("processing...")    // dead code: removed entirely
    }
    // Only remaining code
}
```

The compiler replaces `debug` with `false`, then the SSA pass eliminates the unreachable block. The log call doesn't appear in the binary at all.

---

### Q21: What is the memory impact of struct padding with `bool` fields?

**Answer:**

```go
type BadLayout struct {
    Flag1 bool   // 1 byte + 7 bytes padding
    Value int64  // 8 bytes
    Flag2 bool   // 1 byte + 7 bytes padding
}
// Total: 24 bytes

type GoodLayout struct {
    Value int64  // 8 bytes
    Flag1 bool   // 1 byte
    Flag2 bool   // 1 byte + 6 bytes padding
}
// Total: 16 bytes
```

Fix: group small fields together, large fields first.

---

### Q22: How would you implement a thread-safe boolean flag for a long-running goroutine?

**Answer:**

```go
import (
    "context"
    "sync"
)

type Worker struct {
    mu      sync.Mutex
    running bool
    ctx     context.Context
    cancel  context.CancelFunc
}

func (w *Worker) Start() error {
    w.mu.Lock()
    defer w.mu.Unlock()
    if w.running {
        return fmt.Errorf("already running")
    }
    w.ctx, w.cancel = context.WithCancel(context.Background())
    w.running = true
    go w.run(w.ctx)
    return nil
}

func (w *Worker) Stop() {
    w.mu.Lock()
    w.running = false
    cancel := w.cancel
    w.mu.Unlock()
    cancel()
}

func (w *Worker) run(ctx context.Context) {
    for {
        select {
        case <-ctx.Done():
            return
        default:
            // do work
        }
    }
}
```

---

### Q23: What is the difference between `&&` and `&` for booleans in Go?

**Answer:**
- `&&` (logical AND): short-circuit, right side may not be evaluated
- `&` (bitwise AND): **not valid** for `bool` type in Go — compile error

```go
a, b := true, false

_ = a && b  // OK: logical AND, short-circuit
_ = a & b   // ERROR: operator & not defined on bool

// Note: & works on integers for bitwise AND
x, y := 0b1010, 0b1100
fmt.Println(x & y) // 0b1000 = 8
```

---

### Q24: How do you detect a data race on a boolean in Go?

**Answer:** Use the race detector:

```bash
go test -race ./...
go run -race main.go
```

Example detection:
```go
var flag bool

go func() { flag = true }()   // concurrent write
go func() { _ = flag }()      // concurrent read
// Race detector reports: DATA RACE on flag
```

The race detector uses shadow memory to track all memory accesses and their goroutines.

---

### Q25: When would you use bit-packing instead of individual `bool` fields?

**Answer:** When you have many boolean flags per record AND memory is critical:

```go
// 8 individual bool fields: 8 bytes per record
type UserFlags struct {
    IsActive    bool // 1 byte
    IsVerified  bool // 1 byte
    IsPremium   bool // 1 byte
    Is2FA       bool // 1 byte
    IsAdmin     bool // 1 byte
    IsSuspended bool // 1 byte
    IsDeleted   bool // 1 byte
    IsEmployee  bool // 1 byte
}

// Bit-packed: 1 byte per record (8x reduction)
type UserFlags uint8
const (
    FlagActive    UserFlags = 1 << 0
    FlagVerified  UserFlags = 1 << 1
    FlagPremium   UserFlags = 1 << 2
    Flag2FA       UserFlags = 1 << 3
    FlagAdmin     UserFlags = 1 << 4
    FlagSuspended UserFlags = 1 << 5
    FlagDeleted   UserFlags = 1 << 6
    FlagEmployee  UserFlags = 1 << 7
)

func (f UserFlags) Has(flag UserFlags) bool { return f&flag != 0 }
```

For 10M user records: 80MB → 10MB.

---

## Scenario-Based Questions

### Scenario Q1: Your team is building a feature flag system that handles 500,000 requests/second. How would you design the `IsEnabled(flagName, userID string) bool` function?

**Answer:**

```go
// Multi-tier caching:
// Tier 1: goroutine-local copy (fastest, no synchronization)
// Tier 2: in-process atomic (fast, lock-free)
// Tier 3: Redis (fast, network hop)
// Tier 4: Database (slow, authoritative)

type FlagService struct {
    // Atomic snapshot, updated periodically
    snapshot atomic.Value // holds map[string]bool

    redis *redis.Client
    db    *sql.DB
}

func (fs *FlagService) IsEnabled(flagName string) bool {
    // Tier 1: read from atomic snapshot (no lock, ~1ns)
    if m, ok := fs.snapshot.Load().(map[string]bool); ok {
        return m[flagName]
    }
    return false
}

func (fs *FlagService) refresh(ctx context.Context) {
    // Background goroutine updates snapshot every 30s
    ticker := time.NewTicker(30 * time.Second)
    for {
        select {
        case <-ticker.C:
            flags := fs.loadFromRedis(ctx)
            fs.snapshot.Store(flags)
        case <-ctx.Done():
            return
        }
    }
}
```

---

### Scenario Q2: A bug is filed: users who were "active" yesterday appear as "inactive" today, but the database shows them as active. Debug this.

**Answer:** Likely causes:
1. **Caching issue**: stale cache serving `false` while DB has `true`
2. **Race condition**: unsynchronized bool read getting stale value
3. **JSON parsing**: `is_active` field not being deserialized (missing/wrong tag)
4. **Zero value bug**: creating struct without setting `IsActive`, relying on zero value

```go
// Debugging steps:
// 1. Add logging around the boolean read
fmt.Printf("[DEBUG] isActive for user %s: %v (source: cache)\n", userID, isActive)

// 2. Compare cache vs DB
cacheVal := cache.GetActive(userID)
dbVal := db.GetActive(userID)
if cacheVal != dbVal {
    log.Printf("MISMATCH: cache=%v db=%v for user %s", cacheVal, dbVal, userID)
}

// 3. Check struct deserialization
type User struct {
    IsActive bool `json:"is_active"` // ensure tag matches API
}
```

---

### Scenario Q3: You need to roll out a new feature to 10% of users. How do you implement this with booleans?

**Answer:**

```go
import (
    "crypto/sha256"
    "encoding/binary"
)

type RolloutConfig struct {
    Name       string
    Percentage float64 // 0.0 to 1.0
}

func isInRollout(config RolloutConfig, userID string) bool {
    // Hash the user ID to get a consistent, pseudo-random bucket
    h := sha256.Sum256([]byte(config.Name + ":" + userID))
    bucket := binary.BigEndian.Uint64(h[:8])

    // Determine which "bucket" (out of 100) this user falls into
    userBucket := float64(bucket%100) / 100.0
    return userBucket < config.Percentage
}

func main() {
    config := RolloutConfig{Name: "new_checkout", Percentage: 0.10}
    fmt.Println(isInRollout(config, "user-123")) // deterministic per user
}
```

---

### Scenario Q4: Code review — what's wrong with this code?

```go
func processOrder(order Order, forceApprove bool, skipValidation bool, sendEmail bool) error {
    if skipValidation || forceApprove {
        return saveOrder(order)
    }
    // ...
}
```

**Answer:**
1. **Boolean blindness**: callers write `processOrder(o, true, false, true)` — unreadable
2. **Security risk**: `forceApprove` and `skipValidation` are dangerous flags accessible to any caller
3. **Unclear semantics**: `skipValidation || forceApprove` — do these mean the same thing?

**Fix:**
```go
type ProcessOrderOptions struct {
    ForceApprove    bool
    SkipValidation  bool
    SendEmail       bool
}

func processOrder(order Order, opts ProcessOrderOptions) error {
    if opts.SkipValidation || opts.ForceApprove {
        return saveOrder(order)
    }
    // ...
}

// Call site is now readable:
processOrder(order, ProcessOrderOptions{SendEmail: true})
```

For `forceApprove` and `skipValidation` — consider if these should be configurable at all, and add authorization checks.

---

## FAQ — Common Interview Topics

### FAQ1: "Bool is just an int under the hood, right?"

**Not quite.** In Go, `bool` is a distinct type. It cannot be used where `int` is expected and vice versa. Under the hood, it IS stored as a single byte (0 or 1), but the type system enforces that you can't mix them.

---

### FAQ2: "Why does Go not have `bool + 1` like in Python?"

**By design.** Go's philosophy is explicit over implicit. In Python, `True + 1 == 2` because `bool` is a subtype of `int`. This causes subtle bugs. Go's `bool` cannot be added to `int`.

```go
// Python: True + 1 == 2 (works)
// Go:
b := true
// n := b + 1  // COMPILE ERROR
n := 0
if b { n = 1 }
n++ // n == 2
```

---

### FAQ3: "What's faster: `if a == true` or `if a`?"

**Same performance.** The compiler eliminates the `== true` comparison — it's a no-op. Use `if a` (idiomatic).

---

### FAQ4: "Can Go booleans be compared with `<` or `>`?"

**No.** Booleans only support `==` and `!=`. They cannot be ordered:

```go
true > false  // COMPILE ERROR: operator > not defined on bool
true == false // false (OK)
true != false // true (OK)
```

---

### FAQ5: "How does `recover()` work with boolean panics?"

```go
func safeExecute(fn func() bool) (result bool, err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("panic: %v", r)
        }
    }()
    result = fn()
    return
}
```

This is a common pattern for wrapping potentially panicking code that returns a bool.

---

### FAQ6: Operator Precedence Quick Reference

In Go, operators have this precedence (highest to lowest):
```
Unary:    !
Binary:   *  /  %  <<  >>  &  &^
          +  -  |  ^
          ==  !=  <  <=  >  >=
          &&
          ||
```

Key point: `&&` binds tighter than `||`:
```go
a || b && c   // a || (b && c) — && evaluated first
(a || b) && c // explicit grouping if you want OR first
```

---

### FAQ7: What does `_ = false && sideEffect()` guarantee?

**Guaranteed**: `sideEffect()` is never called. Short-circuit evaluation in `&&` is part of the Go specification, not an optimization hint. The language spec guarantees it.

```go
called := false
_ = false && func() bool { called = true; return true }()
fmt.Println(called) // always: false
```

---

### FAQ8: What's the idiomatic way to signal goroutine completion — `chan bool` or `chan struct{}`?

**`chan struct{}`** is idiomatic when you only need a signal (no data):

```go
// Idiomatic: no data needed
done := make(chan struct{})
go func() {
    doWork()
    close(done) // signal
}()
<-done // wait

// Use chan bool only when the result value matters:
result := make(chan bool, 1)
go func() {
    result <- validate(input)
}()
if <-result { ... }
```

`struct{}` has zero size, so no data is copied through the channel. It's slightly more efficient and more clearly expresses intent.
