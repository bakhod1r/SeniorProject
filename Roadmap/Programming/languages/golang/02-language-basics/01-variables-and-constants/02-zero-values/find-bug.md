# Zero Values — Find the Bug

Each section contains buggy Go code. Find the bug, explain why it's wrong, and provide the correct solution.

---

## Bug 1: Writing to a nil map

```go
package main

import "fmt"

type Counter struct {
    counts map[string]int
}

func (c *Counter) Increment(key string) {
    c.counts[key]++
}

func (c *Counter) Get(key string) int {
    return c.counts[key]
}

func main() {
    var c Counter
    c.Increment("hits")
    fmt.Println(c.Get("hits"))
}
```

**Symptom**: Program panics with `assignment to entry in nil map`

<details>
<summary>Hint</summary>

The `counts` field is a map. What is the zero value of a map? What happens when you write to a nil map?

</details>

<details>
<summary>Solution</summary>

**Problem**: `Counter`'s zero value has `counts == nil`. Calling `c.Increment` attempts to write to `c.counts`, which is nil — this causes a panic.

**Why it panics**: Go's map runtime checks for nil in `mapassign` and panics with "assignment to entry in nil map". This is by design — there's no backing hash table to write to.

**Note**: `c.Get("hits")` would actually be safe (returns 0), but `Increment` writes and panics first.

**Fix — Option 1: Lazy initialization in method**
```go
func (c *Counter) Increment(key string) {
    if c.counts == nil {
        c.counts = make(map[string]int)
    }
    c.counts[key]++
}
```

**Fix — Option 2: Constructor (when lazy init isn't appropriate)**
```go
func NewCounter() *Counter {
    return &Counter{counts: make(map[string]int)}
}

func main() {
    c := NewCounter()
    c.Increment("hits")
    fmt.Println(c.Get("hits"))  // 1
}
```

**Fix — Option 3: Zero Value Pattern with lazy init (most idiomatic)**
```go
func (c *Counter) init() {
    if c.counts == nil {
        c.counts = make(map[string]int)
    }
}

func (c *Counter) Increment(key string) {
    c.init()
    c.counts[key]++
}
```

</details>

---

## Bug 2: Returning Typed nil as error Interface

```go
package main

import "fmt"

type AppError struct {
    Code    int
    Message string
}

func (e *AppError) Error() string {
    return fmt.Sprintf("[%d] %s", e.Code, e.Message)
}

func validateAge(age int) error {
    var err *AppError
    if age < 0 {
        err = &AppError{Code: 400, Message: "age cannot be negative"}
    }
    if age > 150 {
        err = &AppError{Code: 400, Message: "age is unrealistically large"}
    }
    return err  // BUG
}

func main() {
    err := validateAge(25)
    if err != nil {
        fmt.Printf("ERROR: %v\n", err)  // This prints! But 25 is valid!
    } else {
        fmt.Println("Valid age")
    }
}
```

**Symptom**: `"ERROR: <nil>"` is printed for valid input (age = 25)

<details>
<summary>Hint</summary>

An interface value is nil only when BOTH its type AND its value are nil. What type is stored in the returned `error` interface?

</details>

<details>
<summary>Solution</summary>

**Problem**: `var err *AppError` is a typed nil pointer. When returned as `error`, the interface contains `(*AppError, nil)` — type is set, value is nil. The `err != nil` check sees the non-nil type and evaluates to `true` even though no error occurred.

**Go's interface representation:**
```
nil error:    (type=nil,       value=nil)   → == nil is true
typed nil:    (type=*AppError, value=nil)   → == nil is FALSE!
real error:   (type=*AppError, value=ptr)   → == nil is false
```

**Fix: Always return explicit `nil` for the no-error case:**
```go
func validateAge(age int) error {
    if age < 0 {
        return &AppError{Code: 400, Message: "age cannot be negative"}
    }
    if age > 150 {
        return &AppError{Code: 400, Message: "age is unrealistically large"}
    }
    return nil  // untyped nil — interface is truly nil
}

func main() {
    err := validateAge(25)
    if err != nil {
        fmt.Printf("ERROR: %v\n", err)
    } else {
        fmt.Println("Valid age")  // Now this prints correctly
    }
}
```

**Rule**: Never do `var err *ConcreteType` and then `return err`. Always return `nil` or a concrete value.

</details>

---

## Bug 3: nil Pointer Dereference in Struct Method

```go
package main

import "fmt"

type User struct {
    Name  string
    Email string
    Admin *Role
}

type Role struct {
    Name        string
    Permissions []string
}

func (u *User) HasPermission(perm string) bool {
    for _, p := range u.Admin.Permissions {  // BUG
        if p == perm {
            return true
        }
    }
    return false
}

func main() {
    user := User{Name: "Alice", Email: "alice@example.com"}
    // Admin is nil (zero value for pointer)
    fmt.Println(user.HasPermission("read"))
}
```

**Symptom**: `panic: runtime error: invalid memory address or nil pointer dereference`

<details>
<summary>Hint</summary>

The `Admin` field is a pointer (`*Role`). What is the zero value of a pointer? What happens when you access a field on a nil pointer?

</details>

<details>
<summary>Solution</summary>

**Problem**: `User.Admin` is a `*Role` pointer. Its zero value is `nil`. Accessing `u.Admin.Permissions` dereferences the nil pointer, causing a panic.

**Fix — Option 1: Guard with nil check**
```go
func (u *User) HasPermission(perm string) bool {
    if u.Admin == nil {
        return false  // no role = no permissions
    }
    for _, p := range u.Admin.Permissions {
        if p == perm {
            return true
        }
    }
    return false
}
```

**Fix — Option 2: Use a method on Role with nil receiver check**
```go
func (r *Role) HasPermission(perm string) bool {
    if r == nil {
        return false  // nil Role has no permissions
    }
    for _, p := range r.Permissions {
        if p == perm {
            return true
        }
    }
    return false
}

func (u *User) HasPermission(perm string) bool {
    return u.Admin.HasPermission(perm)  // nil check inside Role method
}
```

**Fix — Option 3: Change Admin to value type (embed Role)**
```go
type User struct {
    Name  string
    Email string
    Admin Role  // value type, zero value is safe
}
// Role.Permissions is nil slice — ranging over it is safe (0 iterations)
```

</details>

---

## Bug 4: Assuming nil Slice Is Unusable

```go
package main

import "fmt"

func processItems(items []string) {
    if items == nil {
        fmt.Println("Error: no items to process")
        return
    }
    for _, item := range items {
        fmt.Println("Processing:", item)
    }
}

func collectItems(data []string) []string {
    var result []string
    for _, d := range data {
        if len(d) > 3 {
            result = append(result, d)
        }
    }
    return result  // may return nil
}

func main() {
    data := []string{"hi", "ok"}
    items := collectItems(data)
    processItems(items)
    // Output: "Error: no items to process" even though this is valid behavior
}
```

**Symptom**: "Error: no items to process" — but the input was valid; we just had no items that matched the filter. The nil return is treated as an error when it shouldn't be.

<details>
<summary>Hint</summary>

Is a nil slice actually an error condition? Can you iterate over a nil slice? What does nil mean here — is it different from "empty"?

</details>

<details>
<summary>Solution</summary>

**Problem**: `processItems` treats `nil` slice as an error, but nil slice is a perfectly valid "empty collection." In Go, `range` over a nil slice is safe and produces 0 iterations. Treating nil as an error misuses Go's nil slice semantics.

**Fix**: Remove the nil check — nil and empty slices should be treated the same:
```go
func processItems(items []string) {
    // No need to check for nil — range handles nil slice
    if len(items) == 0 {
        fmt.Println("No items to process")
        return
    }
    for _, item := range items {
        fmt.Println("Processing:", item)
    }
}
```

**Even simpler** — just range directly:
```go
func processItems(items []string) {
    for _, item := range items {
        fmt.Println("Processing:", item)
    }
    // If items is nil or empty, the loop simply doesn't execute
    // No special case needed
}
```

**Key insight**: In Go, the idiom is to use `len(s) == 0` to check for empty (handles both nil and empty), not `s == nil`. The nil check is only needed when you need to semantically distinguish "no slice was provided" from "empty slice was provided."

</details>

---

## Bug 5: nil Map Read Followed by Write Without Check

```go
package main

import "fmt"

type Cache struct {
    data map[string][]byte
}

func (c *Cache) GetOrLoad(key string, loader func() []byte) []byte {
    // Check if in cache
    if val, ok := c.data[key]; ok {  // safe read from nil map
        return val
    }
    // Load and store
    val := loader()
    c.data[key] = val  // BUG: c.data is still nil!
    return val
}

func main() {
    var c Cache
    result := c.GetOrLoad("config", func() []byte {
        return []byte("loaded-config")
    })
    fmt.Println(string(result))
}
```

**Symptom**: Panic on `c.data[key] = val` — "assignment to entry in nil map"

<details>
<summary>Hint</summary>

Reading from a nil map is safe, but what about writing? You need to initialize the map before the first write.

</details>

<details>
<summary>Solution</summary>

**Problem**: `c.data` is nil (zero value). Reading with `c.data[key]` is safe and returns `nil, false`. But then `c.data[key] = val` attempts to write to a nil map — panic.

**Fix: Initialize map before first write**
```go
func (c *Cache) GetOrLoad(key string, loader func() []byte) []byte {
    if val, ok := c.data[key]; ok {
        return val
    }
    val := loader()
    // Initialize map lazily before first write
    if c.data == nil {
        c.data = make(map[string][]byte)
    }
    c.data[key] = val
    return val
}
```

**Better fix: Thread-safe with mutex**
```go
type Cache struct {
    mu   sync.Mutex
    data map[string][]byte
}

func (c *Cache) GetOrLoad(key string, loader func() []byte) []byte {
    c.mu.Lock()
    defer c.mu.Unlock()

    if val, ok := c.data[key]; ok {
        return val
    }
    val := loader()
    if c.data == nil {
        c.data = make(map[string][]byte)
    }
    c.data[key] = val
    return val
}
```

</details>

---

## Bug 6: Incorrectly Comparing Struct to Zero Value

```go
package main

import "fmt"

type Config struct {
    Host    string
    Port    int
    Tags    []string
    Options map[string]string
}

func isZeroConfig(c Config) bool {
    return c == Config{}  // BUG
}

func main() {
    c := Config{Host: "localhost", Port: 8080}
    fmt.Println(isZeroConfig(c))  // false — correct

    zero := Config{}
    fmt.Println(isZeroConfig(zero))  // compile error or unexpected behavior
}
```

**Symptom**: This actually causes a **compile error**: `invalid operation: c == Config{} (struct containing []string cannot be compared)`

<details>
<summary>Hint</summary>

Slices and maps are not comparable in Go. What special rules apply to struct comparison? What alternative approach can you use?

</details>

<details>
<summary>Solution</summary>

**Problem**: `Config` contains a `[]string` (slice) and a `map[string]string` (map). In Go, structs containing non-comparable types (slice, map, func) cannot be compared with `==`. This causes a compile error.

**Fix — Option 1: Remove non-comparable fields or use reflect.DeepEqual**
```go
import "reflect"

func isZeroConfig(c Config) bool {
    return reflect.DeepEqual(c, Config{})
}
```

**Fix — Option 2: Check fields individually**
```go
func isZeroConfig(c Config) bool {
    return c.Host == "" &&
        c.Port == 0 &&
        len(c.Tags) == 0 &&
        len(c.Options) == 0
}
```

**Fix — Option 3: Redesign struct to be comparable (if possible)**
```go
type Config struct {
    Host string
    Port int
    // Remove or replace slice/map fields if comparison is needed
}

func isZeroConfig(c Config) bool {
    return c == Config{}  // now works
}
```

**Fix — Option 4: Use reflect.Value.IsZero (Go 1.13+)**
```go
import "reflect"

func isZeroConfig(c Config) bool {
    return reflect.ValueOf(c).IsZero()
}
```

**Key rule**: Structs are comparable only if ALL their fields are comparable. Slices, maps, and functions make structs non-comparable.

</details>

---

## Bug 7: Zero Value of function Type Called Without Check

```go
package main

import "fmt"

type EventProcessor struct {
    OnSuccess func(event string)
    OnError   func(err error)
    OnRetry   func(attempt int) bool
}

func (ep *EventProcessor) Process(event string) {
    defer func() {
        if r := recover(); r != nil {
            ep.OnError(fmt.Errorf("panic: %v", r))  // BUG: OnError may be nil
        }
    }()

    // Process event
    if event == "" {
        ep.OnError(fmt.Errorf("empty event"))  // BUG: OnError may be nil
        return
    }

    ep.OnSuccess(event)  // BUG: OnSuccess may be nil
}

func main() {
    var ep EventProcessor
    ep.Process("user.login")
}
```

**Symptom**: `panic: runtime error: invalid memory address or nil pointer dereference` when calling `ep.OnSuccess(event)` since `OnSuccess` is nil.

<details>
<summary>Hint</summary>

The zero value of a function type is `nil`. What happens when you call a nil function?

</details>

<details>
<summary>Solution</summary>

**Problem**: `EventProcessor`'s function fields (`OnSuccess`, `OnError`, `OnRetry`) are all nil at zero value. Calling a nil function causes a panic.

**Fix — Check before calling:**
```go
func (ep *EventProcessor) Process(event string) {
    defer func() {
        if r := recover(); r != nil {
            if ep.OnError != nil {
                ep.OnError(fmt.Errorf("panic: %v", r))
            }
        }
    }()

    if event == "" {
        if ep.OnError != nil {
            ep.OnError(fmt.Errorf("empty event"))
        }
        return
    }

    if ep.OnSuccess != nil {
        ep.OnSuccess(event)
    }
}
```

**Better fix — Use default no-op functions:**
```go
func (ep *EventProcessor) normalize() {
    if ep.OnSuccess == nil {
        ep.OnSuccess = func(event string) {}  // no-op
    }
    if ep.OnError == nil {
        ep.OnError = func(err error) {
            fmt.Fprintf(os.Stderr, "error: %v\n", err)  // default: log
        }
    }
    if ep.OnRetry == nil {
        ep.OnRetry = func(attempt int) bool { return attempt < 3 }
    }
}

func (ep *EventProcessor) Process(event string) {
    ep.normalize()  // ensure no nil functions
    // ... now safe to call any function
    ep.OnSuccess(event)
}
```

**Design principle**: For callback/hook fields, either check before calling OR normalize to no-op defaults.

</details>

---

## Bug 8: Copying a Struct With sync.Mutex

```go
package main

import (
    "fmt"
    "sync"
)

type SafeCounter struct {
    mu    sync.Mutex
    value int
}

func (c *SafeCounter) Increment() {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.value++
}

func (c *SafeCounter) Value() int {
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.value
}

func cloneCounter(c SafeCounter) SafeCounter {  // BUG: copies mutex!
    return c
}

func main() {
    var original SafeCounter
    original.Increment()
    original.Increment()

    clone := cloneCounter(original)  // copies the mutex by value!
    clone.Increment()

    fmt.Println("Original:", original.Value())  // 2
    fmt.Println("Clone:", clone.Value())         // 1... but mutex is corrupted
}
```

**Symptom**: `go vet` reports `call of cloneCounter copies lock value: contains sync.Mutex`. In production, this can cause deadlocks or incorrect locking behavior.

<details>
<summary>Hint</summary>

`sync.Mutex` is a value type, but copying a used mutex is undefined behavior. Why? What does the copied mutex's internal state represent?

</details>

<details>
<summary>Solution</summary>

**Problem**: `sync.Mutex` tracks lock state in its internal fields (`state`, `sema`). When you copy a `SafeCounter` by value, you copy the mutex's current state bits. The copied mutex's state may represent "locked" or "has waiters" which are no longer valid in the new context — this can cause deadlocks.

**`go vet` detects this**:
```bash
go vet ./...
# ./main.go:25:22: call of cloneCounter copies lock value: main.SafeCounter contains sync.Mutex
```

**Fix — Pass and return pointer:**
```go
func cloneCounter(c *SafeCounter) *SafeCounter {
    c.mu.Lock()
    defer c.mu.Unlock()
    // Copy the VALUE, not the mutex
    newCounter := &SafeCounter{value: c.value}
    return newCounter
    // newCounter.mu is zero value (unlocked) — correct!
}
```

**Fix — Redesign clone to be explicit:**
```go
func (c *SafeCounter) Clone() *SafeCounter {
    c.mu.Lock()
    defer c.mu.Unlock()
    return &SafeCounter{value: c.value}  // new mutex at zero value
}
```

**Rule**: Never copy a struct that embeds `sync.Mutex` (or any `sync.*` type) by value after first use. Use pointers. Enable `go vet` to catch this.

</details>

---

## Bug 9: JSON Serialization with Zero Value Fields

```go
package main

import (
    "encoding/json"
    "fmt"
)

type Player struct {
    Name     string `json:"name"`
    Score    int    `json:"score"`
    Level    int    `json:"level"`
    Deaths   int    `json:"deaths"`
    IsActive bool   `json:"is_active"`
}

func newPlayer(name string) Player {
    return Player{Name: name}
}

func main() {
    player := newPlayer("Alice")
    // Player just created: Score=0, Level=0, Deaths=0, IsActive=false

    b, _ := json.Marshal(player)
    fmt.Println(string(b))
    // Output: {"name":"Alice","score":0,"level":0,"deaths":0,"is_active":false}

    // Problem: Client receives level=0 and thinks player is level 0
    // But we want level=1 for new players
    // Also: deaths=0 looks weird in JSON when player hasn't played yet
    // Also: is_active=false makes player look inactive when they just registered
}
```

**Symptom**: JSON output includes zero values that misrepresent the actual state. `level=0` should be `level=1` for new players. `is_active=false` makes new players look inactive.

<details>
<summary>Hint</summary>

Consider: (1) which fields need `omitempty`? (2) which fields need a non-zero default? (3) which fields should use pointer type to distinguish "not set" from "zero"?

</details>

<details>
<summary>Solution</summary>

**Problem**: The struct's zero values don't match the intended business semantics:
- New players should be level 1 (not 0)
- New players should be active (not inactive)
- `deaths=0` is actually correct — new player has 0 deaths
- `score=0` is correct — new player has 0 score

**Fix 1: Use a constructor with correct defaults:**
```go
func newPlayer(name string) Player {
    return Player{
        Name:     name,
        Level:    1,        // new players start at level 1
        IsActive: true,     // new players are active
        // Score and Deaths default to 0 — correct!
    }
}
```

**Fix 2: For JSON — use omitempty for "not yet applicable" fields:**
```go
type Player struct {
    Name     string `json:"name"`
    Score    int    `json:"score"`
    Level    int    `json:"level"`
    Deaths   int    `json:"deaths,omitempty"`   // omit if 0 (never died)
    IsActive bool   `json:"is_active"`           // always include (meaningful false)
}
```

**Fix 3: For truly optional fields — use pointers:**
```go
type Player struct {
    Name      string  `json:"name"`
    Score     int     `json:"score"`
    Level     int     `json:"level"`
    LastLogin *string `json:"last_login,omitempty"`  // null = never logged in
    Rank      *int    `json:"rank,omitempty"`         // null = unranked
}
```

**Complete fix:**
```go
func newPlayer(name string) Player {
    return Player{Name: name, Level: 1, IsActive: true}
}
// Now zero value is correctly set through constructor
```

</details>

---

## Bug 10: nil Slice vs Empty Slice in API Response

```go
package main

import (
    "encoding/json"
    "fmt"
)

type SearchResult struct {
    Query   string   `json:"query"`
    Results []string `json:"results"`
    Total   int      `json:"total"`
}

func search(query string, items []string) SearchResult {
    var matches []string  // nil slice

    for _, item := range items {
        if len(item) > 0 && item[0] == query[0] {
            matches = append(matches, item)
        }
    }

    return SearchResult{
        Query:   query,
        Results: matches,  // BUG: nil when no results
        Total:   len(matches),
    }
}

func main() {
    items := []string{"apple", "banana", "avocado", "cherry"}

    // Search with results:
    r1 := search("a", items)
    b1, _ := json.Marshal(r1)
    fmt.Println(string(b1))
    // {"query":"a","results":["apple","avocado"],"total":2}

    // Search with NO results:
    r2 := search("z", items)
    b2, _ := json.Marshal(r2)
    fmt.Println(string(b2))
    // {"query":"z","results":null,"total":0}  ← BUG: should be []
    // API clients expect [] for empty, not null!
}
```

**Symptom**: When there are no results, the JSON contains `"results":null` instead of `"results":[]`. This breaks API clients expecting an array.

<details>
<summary>Hint</summary>

What is the JSON representation of a nil slice vs an empty slice? How can you ensure an empty array `[]` is always returned, not `null`?

</details>

<details>
<summary>Solution</summary>

**Problem**: `var matches []string` creates a nil slice. `json.Marshal` encodes nil slices as `null`, not `[]`. API consumers usually expect an empty array `[]` when there are no results, not `null`.

**Fix 1: Initialize to empty slice instead of nil:**
```go
func search(query string, items []string) SearchResult {
    matches := []string{}  // empty slice, not nil

    for _, item := range items {
        if len(item) > 0 && item[0] == query[0] {
            matches = append(matches, item)
        }
    }

    return SearchResult{
        Query:   query,
        Results: matches,
        Total:   len(matches),
    }
}
```

**Fix 2: Convert nil to empty after the loop:**
```go
func search(query string, items []string) SearchResult {
    var matches []string

    for _, item := range items {
        if len(item) > 0 && item[0] == query[0] {
            matches = append(matches, item)
        }
    }

    if matches == nil {
        matches = []string{}  // ensure JSON [] not null
    }

    return SearchResult{
        Query:   query,
        Results: matches,
        Total:   len(matches),
    }
}
```

**Fix 3: Use a custom MarshalJSON on the struct:**
```go
func (r SearchResult) MarshalJSON() ([]byte, error) {
    type Alias SearchResult
    results := r.Results
    if results == nil {
        results = []string{}
    }
    return json.Marshal(Alias{
        Query:   r.Query,
        Results: results,
        Total:   r.Total,
    })
}
```

**Fix 4: Change struct tag to handle this pattern:**
Note: `omitempty` with a slice omits it entirely when nil — that's worse. The correct fix is to use `[]string{}` for "no results".

**Best practice**: Use `[]string{}` (or `make([]string, 0)`) when you want JSON `[]`. Use `nil` (or `var s []string`) when you want JSON `null` or when the distinction between "empty" and "not applicable" matters.

</details>

---

## Bug 11: Zero Value of time.Time Causes Database Issue

```go
package main

import (
    "fmt"
    "time"
)

type Event struct {
    ID          int
    Name        string
    ScheduledAt time.Time  // zero value is 0001-01-01 00:00:00
    CompletedAt time.Time  // zero value is 0001-01-01 00:00:00
}

func scheduleEvent(name string, when time.Time) Event {
    return Event{
        Name:        name,
        ScheduledAt: when,
        // CompletedAt uses zero value — event not completed yet
    }
}

func isCompleted(e Event) bool {
    return e.CompletedAt != time.Time{}  // BUG: verbose and fragile
}

func isPastDue(e Event) bool {
    return e.ScheduledAt.Before(time.Now())  // works, but...
}

func main() {
    event := scheduleEvent("meeting", time.Now().Add(time.Hour))

    fmt.Println("Completed:", isCompleted(event))
    fmt.Println("Scheduled at:", event.ScheduledAt)
    fmt.Println("CompletedAt zero:", event.CompletedAt.IsZero())
}
```

**Issues**:
1. `isCompleted` uses `!= time.Time{}` which is verbose and confusing
2. A `time.Time` zero value in a database appears as year 0001 — potentially problematic
3. There's no way to distinguish "not scheduled yet" from "scheduled at time.Time{}"

<details>
<summary>Hint</summary>

Use `time.Time.IsZero()` for checking zero. Consider using `*time.Time` for optional time fields. Consider database implications.

</details>

<details>
<summary>Solution</summary>

**Problems**:
1. `e.CompletedAt != time.Time{}` — use `IsZero()` instead
2. `time.Time` zero value is `0001-01-01` — many databases don't support dates before 1000 AD or even 1970
3. `ScheduledAt` zero value could mean "never scheduled" but a zero time is stored in DB

**Fix:**
```go
type Event struct {
    ID          int
    Name        string
    ScheduledAt *time.Time `db:"scheduled_at"` // nil = not yet scheduled
    CompletedAt *time.Time `db:"completed_at"` // nil = not completed
}

func isCompleted(e Event) bool {
    return e.CompletedAt != nil  // clean nil check
}

func isScheduled(e Event) bool {
    return e.ScheduledAt != nil
}

func scheduleEvent(name string, when time.Time) Event {
    return Event{
        Name:        name,
        ScheduledAt: &when,
        // CompletedAt: nil — not completed
    }
}
```

**For non-pointer time.Time — use IsZero():**
```go
func isCompleted(e Event) bool {
    return !e.CompletedAt.IsZero()  // correct Go idiom
}

// NEVER do:
// e.CompletedAt == time.Time{}  // works but unusual
// e.CompletedAt == (time.Time{}) // same
// Use IsZero() — it's the idiomatic way
```

</details>

---

## Bug 12: Channel Close and nil Channel Confusion

```go
package main

import (
    "fmt"
    "time"
)

func producer(done <-chan struct{}) <-chan int {
    ch := make(chan int)
    go func() {
        defer close(ch)
        for i := 0; ; i++ {
            select {
            case <-done:
                return
            case ch <- i:
            }
        }
    }()
    return ch
}

func main() {
    done := make(chan struct{})
    nums := producer(done)

    // BUG: trying to merge with a "disabled" nil channel
    var extra <-chan int = nil  // intentionally nil

    timeout := time.After(100 * time.Millisecond)
    count := 0

    for {
        select {
        case n, ok := <-nums:
            if !ok {
                fmt.Println("nums closed")
                goto done
            }
            count++
            _ = n
        case n, ok := <-extra:  // BUG: this is fine (nil ignored), but...
            if !ok {
                extra = nil  // BUG: redundant, already nil, but would work
            }
            _ = n
        case <-timeout:
            close(done)
        }
    }
done:
    fmt.Println("Received", count, "values")
}
```

**Issue**: The code actually works correctly (nil channel in select is ignored), but there's a logical error: when `nums` is closed, the code tries to set `nums = nil` to disable it, but it's not doing so. The bigger bug is that after `nums` closes, the select might spin selecting the closed `nums` repeatedly, causing 100% CPU usage.

<details>
<summary>Hint</summary>

When a channel is closed, receiving from it always succeeds immediately (returns zero value and `ok=false`). What happens in a select loop when one channel is closed but not disabled?

</details>

<details>
<summary>Solution</summary>

**Problem**: After `nums` closes (when `close(done)` is called and producer exits), the `case n, ok := <-nums` will fire on every select iteration with `ok=false` — causing an infinite tight loop at 100% CPU. The code should set `nums = nil` to disable the case.

**Fix: Set channel to nil after it closes to disable the select case:**
```go
func main() {
    done := make(chan struct{})
    nums := producer(done)

    var extra <-chan int  // nil = disabled

    timeout := time.After(100 * time.Millisecond)
    count := 0

    for nums != nil {  // exit loop when all channels are nil
        select {
        case n, ok := <-nums:
            if !ok {
                nums = nil  // DISABLE this case — nil channel never fires
                continue
            }
            count++
            _ = n
        case n, ok := <-extra:
            if !ok {
                extra = nil  // DISABLE this case
                continue
            }
            _ = n
        case <-timeout:
            close(done)
            // nums will close on its own when producer sees done
        }
    }

    fmt.Println("Received", count, "values")
}
```

**The nil channel pattern for select:**
- When a channel closes, set it to `nil` to prevent the case from firing again
- This is the canonical Go pattern for "disabling" a select case
- The for loop condition `nums != nil || extra != nil` determines when to exit

</details>

---

## Bug 13: Interface Nil and Error Wrapping

```go
package main

import (
    "errors"
    "fmt"
)

type NotFoundError struct {
    Resource string
    ID       int
}

func (e *NotFoundError) Error() string {
    return fmt.Sprintf("%s with id %d not found", e.Resource, e.ID)
}

func findUser(id int) (*User, error) {
    var nfe *NotFoundError
    if id <= 0 {
        nfe = &NotFoundError{Resource: "user", ID: id}
    }
    // Simulate: return error if not found
    if id > 1000 {
        nfe = &NotFoundError{Resource: "user", ID: id}
    }
    return nil, nfe  // BUG: always returns non-nil error!
}

type User struct{ ID int }

func main() {
    user, err := findUser(42)
    if err != nil {
        fmt.Println("Error:", err)  // BUG: prints even for valid user
        return
    }
    _ = user
    fmt.Println("Found user!")

    // The correct error check:
    var nfe *NotFoundError
    if errors.As(err, &nfe) {
        fmt.Println("Not found:", nfe)
    }
}
```

**Symptom**: `findUser(42)` returns a non-nil error even though id=42 is a valid ID (no error should occur).

<details>
<summary>Hint</summary>

This is the interface nil trap again, but in a different context. What is `var nfe *NotFoundError`? What happens when you return it as `error`?

</details>

<details>
<summary>Solution</summary>

**Problem**: `var nfe *NotFoundError` is a typed nil. When returned as the `error` interface (second return value), it becomes a non-nil interface value with type `*NotFoundError` and nil value. So `err != nil` is always `true`.

**Fix:**
```go
func findUser(id int) (*User, error) {
    if id <= 0 || id > 1000 {
        return nil, &NotFoundError{Resource: "user", ID: id}
    }
    return &User{ID: id}, nil  // Return explicit nil, not typed nil
}
```

**Alternative fix if you need the variable:**
```go
func findUser(id int) (*User, error) {
    if id <= 0 {
        return nil, &NotFoundError{Resource: "user", ID: id}
    }
    if id > 1000 {
        return nil, &NotFoundError{Resource: "user", ID: id}
    }
    return &User{ID: id}, nil  // No error
}
```

**If you absolutely must use a variable:**
```go
func findUser(id int) (*User, error) {
    var nfe *NotFoundError
    if id <= 0 || id > 1000 {
        nfe = &NotFoundError{Resource: "user", ID: id}
    }

    if nfe != nil {
        return nil, nfe  // Only return it as error if it's actually set
    }
    return &User{ID: id}, nil
}
```

**Rule**: The fix is always the same — return explicit `nil` as the error interface, never return a typed nil pointer as an error.

</details>
