# Zero Values — Interview Questions

## Table of Contents
1. [Beginner Questions (1–5)](#beginner-questions)
2. [Intermediate Questions (6–12)](#intermediate-questions)
3. [Advanced Questions (13–20)](#advanced-questions)
4. [Expert Questions (21–25)](#expert-questions)
5. [Quick Reference Table](#quick-reference-table)

---

## Beginner Questions

### Q1: What is the zero value of each basic Go type?

**Expected Answer:**

| Type | Zero Value |
|------|-----------|
| `bool` | `false` |
| `int`, `int8`, `int16`, `int32`, `int64` | `0` |
| `uint`, `uint8`, `uint16`, `uint32`, `uint64`, `uintptr` | `0` |
| `float32`, `float64` | `0.0` |
| `complex64`, `complex128` | `(0+0i)` |
| `string` | `""` |
| `pointer` | `nil` |
| `slice` | `nil` |
| `map` | `nil` |
| `channel` | `nil` |
| `func` | `nil` |
| `interface` | `nil` |
| `array` | each element = its type's zero value |
| `struct` | each field = its type's zero value |

```go
// Verification:
var i int       // 0
var s string    // ""
var b bool      // false
var f float64   // 0.0
var p *int      // nil
var sl []int    // nil
var m map[string]int // nil
```

---

### Q2: What is the difference between declaring `var x int` and `x := 0`?

**Expected Answer:**

Both result in `x` being an `int` with value `0`. The behavioral difference is:
- `var x int` — explicitly declares with zero value; only `var` form works in package scope
- `x := 0` — short declaration; only works inside functions; type inferred from literal

```go
// Package scope — only var works:
var packageLevel int  // OK
// packageLevel := 0  // COMPILE ERROR: syntax error

// Function scope — both work:
func main() {
    var a int  // a = 0
    b := 0     // b = 0, same type and value
    _ = a
    _ = b
}
```

The practical difference: `var x int` makes the intent "I want the zero value" explicit. `x := 0` implies "I'm initializing to zero on purpose."

---

### Q3: What is the zero value of a struct?

**Expected Answer:**

A struct's zero value is a struct where every field is set to its own zero value. No explicit initialization is needed.

```go
type Address struct {
    Street  string
    City    string
    Zip     string
    Country string
    Active  bool
    Code    int
}

var a Address
// a.Street  = ""
// a.City    = ""
// a.Zip     = ""
// a.Country = ""
// a.Active  = false
// a.Code    = 0

// Verify zero value:
fmt.Println(a == Address{})  // true
```

Nested structs also get their zero values recursively:
```go
type Person struct {
    Name    string
    Age     int
    Address Address  // nested struct — all fields zeroed
}

var p Person
fmt.Println(p.Address.City)  // ""
```

---

### Q4: Is it safe to read from a nil map? What about writing?

**Expected Answer:**

**Reading from a nil map is SAFE** — it returns the zero value of the map's value type.

**Writing to a nil map PANICS** with `"assignment to entry in nil map"`.

```go
var m map[string]int  // nil map

// SAFE reads:
val := m["missing"]         // val = 0, no panic
val, ok := m["missing"]     // val = 0, ok = false, no panic
for k, v := range m { ... } // 0 iterations, safe
fmt.Println(len(m))         // 0, safe

// PANIC:
m["key"] = 1  // panic: assignment to entry in nil map

// Safe pattern:
if m == nil {
    m = make(map[string]int)
}
m["key"] = 1  // now safe
```

**Why the asymmetry?** The runtime's `mapaccess1` checks for nil and returns `&zeroVal`. But `mapassign` cannot write to a nil hash table — there's no backing structure to store into.

---

### Q5: Can you append to a nil slice?

**Expected Answer:**

**Yes.** `append` works correctly on nil slices. It creates a new backing array.

```go
var s []int  // nil slice
fmt.Println(s == nil)  // true
fmt.Println(len(s))    // 0

s = append(s, 1, 2, 3)
fmt.Println(s)         // [1 2 3]
fmt.Println(s == nil)  // false (now has backing array)

// Also safe:
for _, v := range s { _ = v }  // normal iteration
```

**Common pattern:**
```go
// Collect results without pre-allocating:
var results []string  // nil slice — "no results yet"
for _, item := range items {
    if item.Valid {
        results = append(results, item.Name)
    }
}
// results is nil if nothing matched, or a slice with data
return results
```

---

## Intermediate Questions

### Q6: What is the difference between a nil slice and an empty slice?

**Expected Answer:**

```go
var nilSlice []int      // nil == true, len = 0, cap = 0
emptySlice := []int{}  // nil == false, len = 0, cap = 0
```

**Similarities:**
- Both have `len() == 0`
- Both are safe to `append` to
- Both are safe to `range` over
- Both have `cap() == 0`

**Differences:**
1. **Nil check**: `nilSlice == nil` is `true`; `emptySlice == nil` is `false`
2. **JSON**: nil slice marshals to `null`; empty slice marshals to `[]`

```go
import "encoding/json"

type Response struct {
    Items []string `json:"items"`
}

n, _ := json.Marshal(Response{Items: nil})       // {"items":null}
e, _ := json.Marshal(Response{Items: []string{}}) // {"items":[]}
```

**When to use which:**
- Use `nil` slice to mean "no data / not applicable"
- Use empty slice when you want JSON `[]` or need to distinguish "empty" from "absent"

---

### Q7: How does Go's zero value guarantee improve safety over C?

**Expected Answer:**

In **C**, uninitialized memory contains whatever bits were previously in that memory location — potentially sensitive data from previous function calls (stack reuse), random garbage, or exploit-ready values.

```c
// C: dangerous!
int values[10];
for (int i = 0; i < 10; i++) {
    printf("%d\n", values[i]);  // garbage values!
}
```

In **Go**, all memory is guaranteed to be zeroed before use:
```go
// Go: always safe
var values [10]int
for _, v := range values {
    fmt.Println(v)  // always 0
}
```

**Security implications of C uninitialized memory:**
1. **Information leakage**: Sensitive data (passwords, keys) from previous functions may be readable
2. **Security vulnerabilities**: Certain exploits rely on controlling what's in uninitialized memory
3. **Undefined behavior**: Reading uninitialized data is UB in C — anything can happen

**Go's guarantee:**
1. No information leakage through memory reuse
2. Deterministic initial state — programs behave consistently
3. No undefined behavior from uninitialized reads

---

### Q8: What is the zero value pattern for API design? Give an example.

**Expected Answer:**

The zero value pattern means designing a type so its zero value is immediately usable without a constructor. The standard library's `sync.Mutex` is the canonical example.

```go
// sync.Mutex zero value is "unlocked" — immediately usable:
var mu sync.Mutex
mu.Lock()    // works!
mu.Unlock()  // works!
```

**Designing your own type with this pattern:**

```go
// Counter: zero value is "count = 0" — immediately usable
type Counter struct {
    mu    sync.Mutex  // zero = unlocked (usable zero value)
    value int64       // zero = count is 0 (correct default)
}

func (c *Counter) Increment() {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.value++
}

func (c *Counter) Value() int64 {
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.value
}

// User code:
var c Counter   // no New() needed!
c.Increment()
c.Increment()
fmt.Println(c.Value())  // 2
```

**Key principles:**
1. Use `sync.Mutex` (not `*sync.Mutex`) embedded by value
2. Lazily initialize maps/channels on first use
3. Treat numeric zero as "use default"
4. Document that the zero value is usable

---

### Q9: What is the interface nil trap in Go? Show a code example.

**Expected Answer:**

An interface value in Go is represented as two words: `(type, value)`. An interface is only `nil` when BOTH are nil. This creates a subtle trap when returning concrete nil pointers as interface types.

```go
type MyError struct {
    Message string
}
func (e *MyError) Error() string { return e.Message }

// BUG: returns non-nil interface even when no error
func validateBug(s string) error {
    var err *MyError  // typed nil pointer
    if s == "" {
        err = &MyError{"empty string"}
    }
    return err  // PROBLEM: interface{(*MyError, nil)} is NOT nil!
}

// This will print "Error: <nil>" even for valid input:
if err := validateBug("hello"); err != nil {
    fmt.Println("Error:", err)  // This executes! Bug!
}
```

**Why this happens:**
```
nil interface:    (type=nil,      value=nil)      -> nil check: true
typed nil:        (type=*MyError, value=nil)      -> nil check: false!
```

**Correct implementation:**
```go
func validateGood(s string) error {
    if s == "" {
        return &MyError{"empty string"}  // return concrete error
    }
    return nil  // return UNTYPED nil — interface will be nil
}

if err := validateGood("hello"); err != nil {
    fmt.Println("Error:", err)  // correctly not reached
}
```

**Detection:** Use `reflect.ValueOf(err).IsNil()` to detect typed nil interfaces, or use `go vet` which catches some cases.

---

### Q10: What does `new(T)` return and how does it relate to zero values?

**Expected Answer:**

`new(T)` allocates memory for type `T`, sets it to the zero value of `T`, and returns a `*T` (pointer to the zeroed `T`).

```go
p := new(int)
fmt.Println(*p)          // 0
fmt.Println(p == nil)    // false (p is a valid pointer to 0)

// Equivalent to:
var x int
p := &x
```

**For structs:**
```go
type Config struct {
    Host string
    Port int
}

c := new(Config)
fmt.Println(c.Host)  // ""
fmt.Println(c.Port)  // 0

// Equivalent to:
var cfg Config
c := &cfg
```

**`new(T)` vs `&T{}`:**
- Semantically identical
- Both allocate zeroed memory and return a pointer
- `&T{}` is more idiomatic when you initialize some fields: `&T{Field: value}`
- `new(T)` is preferred when you want the zero value explicitly

**`new` vs `make`:**
- `new(T)` → zeroed T, returns `*T`; works for any type
- `make([]T, n)` → initialized slice with length n; only for slice/map/chan; returns the value (not pointer)

---

### Q11: How do zero values interact with JSON marshaling?

**Expected Answer:**

By default, zero values ARE included in JSON output. Use `omitempty` to exclude them.

```go
type User struct {
    ID       int    `json:"id"`
    Name     string `json:"name"`
    Email    string `json:"email,omitempty"`   // omit if ""
    Score    int    `json:"score,omitempty"`   // omit if 0
    Active   bool   `json:"active"`            // included even if false
    Tags     []string `json:"tags,omitempty"`  // omit if nil/empty
}

u := User{ID: 1, Name: "Alice"}
b, _ := json.Marshal(u)
fmt.Println(string(b))
// {"id":1,"name":"Alice","active":false}
// Email and Score are omitted (omitempty, zero value)
// Active is included (no omitempty)
```

**Problem: can't distinguish "not set" from "set to zero":**
```go
type Response struct {
    Count int `json:"count,omitempty"`
    // If count is legitimately 0, it will be omitted!
    // Can't tell "no count" from "count is 0"
}

// Solution: use pointer
type Response struct {
    Count *int `json:"count,omitempty"`
    // nil = not set (omitted)
    // &0  = count is 0 (included as 0)
}
```

**Nil vs empty slice in JSON:**
```go
// nil slice -> JSON null
// empty slice -> JSON []
// With omitempty:
// nil slice -> omitted
// empty slice -> included as []
```

---

### Q12: What is the zero value of a channel and what happens when you use it?

**Expected Answer:**

The zero value of a channel is `nil`. Operations on nil channels have specific behavior:

```go
var ch chan int  // nil channel

// Send on nil channel: blocks forever
// go func() { ch <- 1 }()  // goroutine blocked forever (goroutine leak!)

// Receive from nil channel: blocks forever
// val := <-ch  // blocks forever

// Close nil channel: PANIC
// close(ch)  // panic: close of nil channel

// nil channel in select: that case is NEVER selected
select {
case v := <-ch:   // never selected if ch is nil
    _ = v
default:
    fmt.Println("no message")  // this runs
}

// Safe usage pattern — use nil channel to disable select cases:
func merge(ch1, ch2 <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for ch1 != nil || ch2 != nil {
            select {
            case v, ok := <-ch1:
                if !ok { ch1 = nil; continue }  // disable this case
                out <- v
            case v, ok := <-ch2:
                if !ok { ch2 = nil; continue }  // disable this case
                out <- v
            }
        }
    }()
    return out
}
```

**Practical use of nil channel**: Setting a channel variable to nil in a select loop is a common pattern to "disable" that branch once the channel is closed, without breaking the select.

---

## Advanced Questions

### Q13: Explain the interface nil trap using Go's memory model.

**Expected Answer:**

An interface in Go's runtime is a two-word structure:

```
interface value:
┌─────────────────────────────────────────┐
│ word 1: *itab or *typeinfo              │
│ word 2: unsafe.Pointer to data          │
└─────────────────────────────────────────┘

nil interface: (nil, nil)     — both words nil
typed nil:     (*MyError, nil) — type set, value nil
```

The `== nil` check for an interface compares BOTH words to nil.

```go
func makeError(fail bool) error {
    var e *MyError  // typed nil: (*MyError, nil)
    if fail {
        e = &MyError{"failed"}  // (*MyError, &MyError{})
    }
    return e  // returns interface with type info always set!
}

// reflection shows the truth:
err := makeError(false)
fmt.Println(err == nil)  // false
v := reflect.ValueOf(err)
fmt.Println(v.IsNil())   // true (the VALUE is nil)
fmt.Println(v.Type())    // *main.MyError (the TYPE is set)
```

**The fix**: Always return the untyped `nil` identifier, not a typed nil variable:
```go
func makeError(fail bool) error {
    if fail {
        return &MyError{"failed"}
    }
    return nil  // untyped nil — both words will be nil in the interface
}
```

---

### Q14: How does the zero value relate to Go's garbage collector?

**Expected Answer:**

Go's GC needs accurate pointer information to trace live objects. Zero values (all-zero bits) play an important role:

1. **Pointer scanning**: A nil pointer (all-zero bits) is clearly not a valid heap pointer. The GC knows not to follow it, which is correct.

2. **Write barriers**: When zeroing memory that contains pointer fields, Go uses write barriers (`memclr`) to inform the GC that pointers are being overwritten with nil. This prevents dangling reference issues.

3. **Non-pointer types**: For types without pointers (like `[100]int`), Go uses `memclrNoHeapPointers` which skips write barriers — faster and safe since no pointers are being modified.

4. **Span needzero**: When the GC sweeps and reclaims a span, it marks it as `needzero`. The next allocation from that span will be zeroed before returning to user code — ensuring no pointer from a dead object is seen as a live reference.

```go
// Example: GC-visible effects of zeroing
type Node struct {
    Next *Node
    Data int
}

// When node is GC'd:
// 1. GC runs sweep
// 2. Span marked needzero = 1
// 3. Next allocation from span: memclr called
// 4. Node.Next = nil (zero) — GC won't follow stale pointer
```

---

### Q15: What is `sync.Mutex`'s zero value state at the bit level?

**Expected Answer:**

```go
type Mutex struct {
    state int32   // 0 = unlocked, no waiters, not starving
    sema  uint32  // 0 = no goroutines blocked on semaphore
}
```

The `state` field uses bit flags:
```
bit 0 (mutexLocked):    0 = unlocked, 1 = locked
bit 1 (mutexWoken):     0 = no goroutine woken, 1 = goroutine woken
bit 2 (mutexStarving):  0 = normal mode, 1 = starvation mode
bits 3-31:              count of goroutines waiting
```

Zero value: `state = 0b...000 = 0`:
- bit 0 = 0: **unlocked** (correct initial state)
- bit 1 = 0: **not woken**
- bit 2 = 0: **not starving**
- bits 3-31 = 0: **no waiters**

`sema = 0`: no goroutines waiting on the semaphore.

This state is a completely valid, unlocked mutex. The Go designers chose the bit encoding specifically to make zero = unlocked. An alternative where locked=0 and unlocked=1 would break the zero value pattern.

---

### Q16: When is it appropriate to use `*int` instead of `int` for a struct field?

**Expected Answer:**

Use `*int` when you need to distinguish between "zero" and "not set":

```go
// Problem with int:
type SearchFilter struct {
    MinAge int  // 0 could mean "no minimum" OR "must be 0 years old"
}

// With *int:
type SearchFilter struct {
    MinAge *int  // nil = no filter, &0 = must be exactly 0
}

// Usage:
age := 18
filter := SearchFilter{MinAge: &age}

// Or with Go 1.18+ generic helpers:
func Ptr[T any](v T) *T { return &v }
filter := SearchFilter{MinAge: Ptr(18)}
```

**When to use `*T`:**
1. Optional fields where zero has a valid distinct meaning
2. JSON fields where you need to distinguish `null` from `0`/`false`/`""`
3. Database nullable columns (`sql.NullInt64` is the stdlib approach)
4. When nil means "inherit from parent config"

**When to stick with `T` (zero value):**
1. When zero IS the correct "not set" value (e.g., counter starts at 0)
2. When the field is always required
3. When the pointer indirection cost matters in performance-critical code

---

### Q17: What happens when you copy a struct that contains a `sync.Mutex`?

**Expected Answer:**

Copying a `sync.Mutex` that has been used is **undefined behavior** and a **data race**. Go's `vet` tool detects this.

```go
type Counter struct {
    mu    sync.Mutex
    value int
}

c1 := Counter{}
c1.mu.Lock()

// BUG: copying a locked mutex
c2 := c1  // copies the mutex state!
// c2.mu might be in locked state but there's no goroutine holding it

c1.mu.Unlock()
// c2.mu is "locked" with no owner — deadlock territory!
```

**Why this is dangerous:**
The mutex's `state` field includes the locked bit and waiter count. Copying those bits without the goroutine context (who holds the lock, what the sema count means) creates an inconsistent state.

**Detection:**
```bash
go vet ./...
# Outputs: assignment copies lock value to c2: contains sync.Mutex
```

**Solution: use pointer or redesign:**
```go
// Option 1: use pointer to Counter
c1 := &Counter{}
c2 := c1  // both point to same Counter (and same mutex)

// Option 2: embed noCopy
type noCopy struct{}
func (*noCopy) Lock()   {}
func (*noCopy) Unlock() {}

type Counter struct {
    _     noCopy  // prevents vet warning from being suppressed
    mu    sync.Mutex
    value int
}
```

---

### Q18: How does Go's zero value initialization compare to Java's?

**Expected Answer:**

| Scenario | Go | Java |
|----------|-----|------|
| Instance field `int` | Always 0 | Always 0 |
| Instance field `String` | Always "" | Always null |
| Local variable | Always zero value | UNINITIALIZED — compile error if used |
| Local pointer/reference | nil (but typed) | null (must init before use) |
| Array elements | Zero-initialized | Zero-initialized (instance) / Uninitialized (local) |

**Key difference: local variables**

```java
// Java:
void method() {
    int x;  // NOT initialized
    System.out.println(x);  // COMPILE ERROR: variable x might not have been initialized
}
```

```go
// Go:
func method() {
    var x int  // ALWAYS 0
    fmt.Println(x)  // OK: prints 0
}
```

**String zero value:**
- Java: `String` reference is `null` — can cause `NullPointerException`
- Go: `string` is a value type, always `""` — can never be nil

**Performance implication:**
Go's blanket "all variables zeroed" rule is simpler than Java's "fields yes, locals compile-time-enforced" approach. Both are safe, but Go's is more uniform.

---

### Q19: Explain what happens when you call `make([]int, 5, 10)` with respect to zero values.

**Expected Answer:**

`make([]int, 5, 10)` creates a slice with:
- Backing array: 10 `int` elements, all zeroed (via `mallocgc` with `needzero=true`)
- Length: 5 (elements 0–4 are accessible and zeroed)
- Capacity: 10 (elements 5–9 exist in backing array but not accessible via slice indexing)

```go
s := make([]int, 5, 10)

// All visible elements are zero:
fmt.Println(s)          // [0 0 0 0 0]
fmt.Println(len(s))     // 5
fmt.Println(cap(s))     // 10

// Elements 5-9 exist in backing array but are not accessible:
// s[5]  // PANIC: index out of range

// append uses the pre-allocated capacity:
s = append(s, 99)
fmt.Println(s)     // [0 0 0 0 0 99]
fmt.Println(len(s)) // 6
fmt.Println(cap(s)) // 10 (no reallocation)

// The "hidden" elements 0-9 were all zeroed by make:
// When we appended, element 5 was already 0, then set to 99
```

**Underlying implementation:**
1. `make([]int, 5, 10)` calls `runtime.makeslice(int_type, 5, 10)`
2. `makeslice` calls `mallocgc(80, int_type, true)` (10 * 8 bytes)
3. `mallocgc` zeroes the 80 bytes
4. Returns slice header: `{ptr, len=5, cap=10}`

---

### Q20: What is `reflect.Value.IsZero()` and when should you use it?

**Expected Answer:**

`reflect.Value.IsZero()` (added in Go 1.13) reports whether a value is the zero value for its type. It handles all types correctly, including composites.

```go
import "reflect"

func isZero(v interface{}) bool {
    return reflect.ValueOf(v).IsZero()
}

// Usage:
fmt.Println(isZero(0))           // true
fmt.Println(isZero(""))          // true
fmt.Println(isZero(false))       // true
fmt.Println(isZero((*int)(nil))) // true
fmt.Println(isZero([]int(nil)))  // true
fmt.Println(isZero([]int{}))     // true (empty slice is also "zero" for IsZero)

// Structs:
type Point struct{ X, Y float64 }
fmt.Println(isZero(Point{}))         // true
fmt.Println(isZero(Point{X: 1.0}))  // false
```

**When to use:**
1. Generic code that needs to check for zero values across types
2. Implementing `Equal`-like methods generically
3. Custom JSON marshalers implementing `omitempty`-like logic
4. Validation code that checks for "unfilled" fields

**Important nuance:**
```go
// IsZero for slices:
reflect.ValueOf([]int(nil)).IsZero()  // true
reflect.ValueOf([]int{}).IsZero()     // true (!)
// Both nil and empty slice are "zero" — different from == nil check
```

---

## Expert Questions

### Q21: How does the compiler decide whether to zero a stack variable or let SSA handle it?

**Expected Answer:**

The Go compiler uses **definite initialization analysis** in its SSA (Static Single Assignment) pass:

1. First, ALL variables are conceptually zero
2. SSA builds a control flow graph
3. The compiler traces all paths from declaration to use
4. If EVERY path assigns before use → compiler may elide explicit zeroing
5. If ANY path reads before assignment → compiler must emit zeroing

```go
func example(cond bool) int {
    var x int  // compiler may or may not emit MOVQ $0
    if cond {
        x = 5
    }
    return x  // if !cond, x must be 0 — so zeroing is required
}

func example2() int {
    var x int  // compiler CAN elide zeroing
    x = compute()  // definitely assigned before use
    return x
}
```

This is an optimization, but it's transparent — the Go spec still guarantees zero values are observable if code reads before writing.

---

### Q22: What is the relationship between zero values and Go's memory model?

**Expected Answer:**

Go's memory model defines when values written in one goroutine are guaranteed to be seen by another. Zero values interact with this:

1. **Initial zero values are always visible**: The Go memory model guarantees that the initial zero value of any variable is visible to all goroutines before any write to that variable.

2. **goroutine start**: When a goroutine starts (`go func()`), the starting goroutine's writes happen-before the new goroutine's reads. This means the new goroutine sees any non-zero values set before `go`.

3. **Without synchronization**: Concurrent reads/writes to a variable (even setting to zero) are data races.

```go
// Safe: zero value is always visible
var x int
// Any goroutine can safely read x before it's written
// (result is guaranteed to be 0)

// Unsafe: concurrent write and read (even setting to zero)
var x int
go func() { x = 0 }()  // write
fmt.Println(x)           // read — DATA RACE!
```

---

### Q23: Can you design a type where the zero value SHOULD NOT be used? When is this appropriate?

**Expected Answer:**

Yes. Some types inherently require initialization with runtime information:

```go
// Example: Database connection pool
// Zero value is NOT usable — needs connection string, pool size, etc.
type DB struct {
    pool *connectionPool  // nil = unusable
    dsn  string          // "" = unusable
}

// This type REQUIRES a constructor:
func Open(dsn string, maxConns int) (*DB, error) {
    // validate dsn, create pool, etc.
    return &DB{dsn: dsn, pool: newPool(maxConns)}, nil
}

// Document this clearly:
// DB is a database handle. Use Open to create a DB.
// The zero value of DB is not usable.
```

**When zero value is intentionally not usable:**
1. Types that require runtime resources (connections, file handles)
2. Types that require configuration not expressible as zero
3. Types with invariants that the zero value would violate (e.g., circular data structure)

**Best practice**: Document clearly in the type's godoc: "The zero value of X is not usable; use NewX() to create an X."

---

### Q24: How does `bytes.Buffer`'s zero value work internally?

**Expected Answer:**

`bytes.Buffer` demonstrates the zero-value-is-useful pattern through lazy allocation:

```go
// Simplified bytes.Buffer:
type Buffer struct {
    buf      []byte // nil at zero value
    off      int    // 0 at zero value
    lastRead readOp  // 0 = opInvalid at zero value
}

func (b *Buffer) WriteString(s string) (n int, err error) {
    b.lastRead = opInvalid
    m, ok := b.tryGrowByReslice(len(s))
    if !ok {
        m = b.grow(len(s))  // allocates if buf is nil
    }
    return copy(b.buf[m:], s), nil
}

func (b *Buffer) grow(n int) int {
    // If buf is nil (zero value), this is the first write
    if b.buf == nil && n <= smallBufferSize {
        b.buf = make([]byte, n, smallBufferSize)
        return 0
    }
    // ... otherwise grow existing buffer
}
```

The key insight: `WriteString` → `grow` checks if `b.buf == nil` (zero value) and allocates only when needed. The zero value is valid because:
- `buf == nil` → "no data written yet" (correct empty state)
- `off == 0` → "read from beginning" (correct for empty buffer)
- `lastRead == 0` → "no recent read" (correct initial state)

---

### Q25: How do zero values affect Go's type system for generics?

**Expected Answer:**

Generics (Go 1.18+) allow you to work with zero values of unknown types:

```go
// Get zero value of a generic type:
func Zero[T any]() T {
    var zero T
    return zero  // always returns zero value of T
}

// Build optional type:
type Result[T any] struct {
    value T
    err   error
    valid bool
}

func OK[T any](v T) Result[T] {
    return Result[T]{value: v, valid: true}
}

func Err[T any](err error) Result[T] {
    return Result[T]{err: err}  // value is zero value of T
}

func (r Result[T]) Unwrap() (T, error) {
    return r.value, r.err
}
```

**Constraint: comparable with zero value:**
```go
// Check if generic value is zero:
func IsZero[T comparable](v T) bool {
    var zero T
    return v == zero
}

fmt.Println(IsZero(0))      // true
fmt.Println(IsZero(""))     // true
fmt.Println(IsZero(false))  // true
fmt.Println(IsZero(42))     // false
```

**Limitation:** This doesn't work for all types — `comparable` constraint required, which excludes slices and maps.

For truly general zero-value checking, use `reflect.ValueOf(v).IsZero()`.

---

## Quick Reference Table

| Question Type | Key Concepts |
|---------------|-------------|
| "What is zero value of X?" | See full table: false/0/0.0/""/(0+0i)/nil |
| "nil map read vs write" | Read: safe (returns 0); Write: PANIC |
| "nil vs empty slice" | Both len=0, but nil==true only for nil; JSON differs |
| "interface nil trap" | Interface is nil only when type AND value both nil |
| "zero value pattern" | sync.Mutex, bytes.Buffer — usable without constructor |
| "when to use *int" | When 0 has valid semantic different from "not set" |
| "copy mutex danger" | Copying used mutex = undefined behavior; use go vet |
| "JSON omitempty" | Omits field if it equals zero value of its type |
| "new(T)" | Allocates, zeroes, returns *T; equivalent to &T{} |
| "make vs new" | make: slice/map/chan, returns value; new: any type, returns *T |
| "nil channel in select" | Case is never selected; safe to use for disabling |
| "reflect.IsZero" | Checks all types including empty slice = zero |
| "generic zero value" | `var zero T` works for any T |
| "definite init" | Compiler may elide zeroing if all paths write first |
| "Go vs C zero values" | C: garbage; Go: guaranteed zero — eliminates class of bugs |
