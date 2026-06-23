# Zero Values — Practice Tasks

## Table of Contents
1. [Task 1: Identify Zero Values](#task-1-identify-zero-values)
2. [Task 2: Struct Zero Value Design](#task-2-struct-zero-value-design)
3. [Task 3: Safe nil Slice Usage](#task-3-safe-nil-slice-usage)
4. [Task 4: nil Map Safe Patterns](#task-4-nil-map-safe-patterns)
5. [Task 5: JSON omitempty Control](#task-5-json-omitempty-control)
6. [Task 6: Zero Value Pattern (Counter)](#task-6-zero-value-pattern-counter)
7. [Task 7: Optional Fields with Pointers](#task-7-optional-fields-with-pointers)
8. [Task 8: Interface nil Trap Fix](#task-8-interface-nil-trap-fix)
9. [Task 9: Channel Zero Value Behavior](#task-9-channel-zero-value-behavior)
10. [Task 10: Generic Zero Value Utility](#task-10-generic-zero-value-utility)
11. [Task 11: Lazy Map Initialization](#task-11-lazy-map-initialization)
12. [Task 12: Zero Value Audit](#task-12-zero-value-audit)

---

## Task 1: Identify Zero Values

**Level**: Beginner
**Estimated Time**: 15 minutes

### Description
Write a Go program that declares one variable of each primitive type without initialization and prints both the value and the type. Use `fmt.Printf` with `%T` and `%v` format verbs.

### Requirements
1. Declare at least 10 different types without initialization
2. Print each variable's value and its type
3. For pointer, slice, map, func, interface, channel: verify they equal `nil`
4. For struct: print each field's zero value

### Starter Code

```go
package main

import "fmt"

type SampleStruct struct {
    Name    string
    Age     int
    Active  bool
    Score   float64
    Tags    []string
    Meta    map[string]string
}

func main() {
    // TODO: Declare variables of different types without initialization
    // and print their zero values

    // Hint: Use fmt.Printf("Type: %T, Value: %v\n", x, x)
}
```

### Expected Output
```
Type: bool, Value: false
Type: int, Value: 0
Type: float64, Value: 0
Type: string, Value:
Type: *int, Value: <nil>
Type: []int, Value: []
...
```

### Evaluation Criteria
- [ ] At least 10 types declared and printed
- [ ] All basic types covered (bool, int, float64, string)
- [ ] All nil types covered (pointer, slice, map, channel, func, interface)
- [ ] Struct zero value printed field by field
- [ ] No explicit initialization used (all rely on zero values)
- [ ] Code compiles without warnings

### Bonus
- Print whether each nil-able type equals nil using `== nil`
- Print `unsafe.Sizeof` for each variable to show memory layout

---

## Task 2: Struct Zero Value Design

**Level**: Beginner–Intermediate
**Estimated Time**: 25 minutes

### Description
Design a `ServerConfig` struct where the zero value represents a valid development configuration that can be used without any initialization. Then write a `Normalize()` method that applies defaults where needed.

### Requirements
1. Design the struct fields so zero values make semantic sense
2. Write a `Normalize()` method that fills in defaults where zero isn't appropriate
3. Write a `Validate()` method that checks the config is ready to use
4. Write a test to verify the zero value can be normalized and validated

### Starter Code

```go
package main

import (
    "errors"
    "fmt"
)

// TODO: Design ServerConfig with meaningful zero values
// Fields to include:
// - Host (string): "" should mean "localhost"
// - Port (int): 0 should mean 8080
// - MaxConnections (int): 0 should mean 100
// - ReadTimeout (int): 0 should mean 30 (seconds)
// - WriteTimeout (int): 0 should mean 30 (seconds)
// - Debug (bool): false = production mode (correct default)
// - TLS (bool): false = no TLS (correct for dev)
type ServerConfig struct {
    // TODO: Add fields
}

// Normalize applies defaults to zero-value fields
func (c *ServerConfig) Normalize() {
    // TODO: Fill in defaults
}

// Validate checks if the config is ready to use
func (c *ServerConfig) Validate() error {
    // TODO: Validate the config
    return nil
}

func main() {
    // Test 1: Zero value should work after Normalize
    var cfg ServerConfig
    cfg.Normalize()
    if err := cfg.Validate(); err != nil {
        fmt.Printf("FAIL: zero value config not valid after normalize: %v\n", err)
        return
    }
    fmt.Printf("PASS: zero value config is valid: %+v\n", cfg)

    // Test 2: Partial initialization should be preserved
    partial := ServerConfig{Port: 9090}
    partial.Normalize()
    if partial.Port != 9090 {
        fmt.Println("FAIL: explicit port overridden by normalize")
        return
    }
    fmt.Printf("PASS: partial config preserved: %+v\n", partial)
}
```

### Expected Behavior
```
PASS: zero value config is valid: {Host:localhost Port:8080 MaxConnections:100 ...}
PASS: partial config preserved: {Host:localhost Port:9090 MaxConnections:100 ...}
```

### Evaluation Criteria
- [ ] All fields have sensible zero value semantics
- [ ] Normalize sets defaults for zero-value fields
- [ ] Normalize does NOT override non-zero fields
- [ ] Validate catches invalid configurations
- [ ] Zero value + Normalize = valid config
- [ ] Code follows Go conventions

---

## Task 3: Safe nil Slice Usage

**Level**: Beginner
**Estimated Time**: 20 minutes

### Description
Write a function `FilterPositive(numbers []int) []int` that returns only the positive numbers from the input. The function must handle nil and empty slices correctly and return nil (not `[]int{}`) when there are no positive numbers.

### Requirements
1. Handle nil input slice
2. Handle empty input slice
3. Return nil (not empty slice) when no positive numbers found
4. Work correctly with mixed positive/negative/zero numbers
5. Write tests for all cases

### Starter Code

```go
package main

import "fmt"

// FilterPositive returns a slice of positive numbers from the input.
// Returns nil if no positive numbers are found.
// Safe to call with nil or empty input.
func FilterPositive(numbers []int) []int {
    // TODO: Implement this function
    // Rules:
    // 1. nil input -> nil output
    // 2. empty input -> nil output (no positives found)
    // 3. no positives -> nil output
    // 4. some positives -> slice containing only positive numbers
    return nil
}

func main() {
    tests := []struct {
        name  string
        input []int
        check func(result []int) bool
    }{
        {
            name:  "nil input",
            input: nil,
            check: func(r []int) bool { return r == nil },
        },
        {
            name:  "empty input",
            input: []int{},
            check: func(r []int) bool { return r == nil },
        },
        {
            name:  "no positives",
            input: []int{-1, -2, 0, -3},
            check: func(r []int) bool { return r == nil },
        },
        {
            name:  "all positives",
            input: []int{1, 2, 3},
            check: func(r []int) bool {
                return len(r) == 3 && r[0] == 1 && r[1] == 2 && r[2] == 3
            },
        },
        {
            name:  "mixed",
            input: []int{-1, 2, -3, 4, 0},
            check: func(r []int) bool {
                return len(r) == 2 && r[0] == 2 && r[1] == 4
            },
        },
    }

    for _, tt := range tests {
        result := FilterPositive(tt.input)
        if tt.check(result) {
            fmt.Printf("PASS: %s\n", tt.name)
        } else {
            fmt.Printf("FAIL: %s (got %v)\n", tt.name, result)
        }
    }
}
```

### Evaluation Criteria
- [ ] nil input returns nil
- [ ] empty input returns nil
- [ ] no matching elements returns nil (not `[]int{}`)
- [ ] matching elements returned correctly
- [ ] Uses `append` correctly on nil slice
- [ ] No panic on any input
- [ ] Function is idiomatic Go

---

## Task 4: nil Map Safe Patterns

**Level**: Intermediate
**Estimated Time**: 30 minutes

### Description
Implement a `Registry` type that stores handlers by name. It must use the zero value pattern (no constructor needed) and handle nil map initialization safely and concurrently.

### Requirements
1. `Register(name string, handler func())` — safely adds a handler
2. `Execute(name string) error` — safely calls a handler
3. `List() []string` — safely lists all handler names
4. Thread-safe implementation using `sync.Mutex`
5. Zero value must be immediately usable (no `New()` required)

### Starter Code

```go
package main

import (
    "fmt"
    "sort"
    "sync"
)

// Registry stores named functions.
// The zero value of Registry is ready to use.
// A Registry must not be copied after first use.
type Registry struct {
    // TODO: Add fields
    // Hint: sync.Mutex and map[string]func()
    // Both have usable zero values — leverage this!
}

// Register adds a named handler.
// Safe to call concurrently.
// Panics if name is empty or handler is nil.
func (r *Registry) Register(name string, handler func()) {
    // TODO: Implement
    // Remember: initialize map lazily (nil check + make)
}

// Execute calls the named handler.
// Returns error if the handler doesn't exist.
// Safe to call concurrently.
func (r *Registry) Execute(name string) error {
    // TODO: Implement
    return nil
}

// List returns all registered handler names in sorted order.
// Returns nil if no handlers registered.
// Safe to call concurrently.
func (r *Registry) List() []string {
    // TODO: Implement
    return nil
}

func main() {
    // Test: zero value works
    var reg Registry

    // Register handlers
    reg.Register("greet", func() { fmt.Println("Hello!") })
    reg.Register("farewell", func() { fmt.Println("Goodbye!") })

    // List
    fmt.Println("Handlers:", reg.List())  // [farewell greet]

    // Execute
    if err := reg.Execute("greet"); err != nil {
        fmt.Println("Error:", err)
    }

    // Execute missing
    if err := reg.Execute("missing"); err != nil {
        fmt.Println("Expected error:", err)
    }
}
```

### Expected Output
```
Handlers: [farewell greet]
Hello!
Expected error: handler not found: missing
```

### Evaluation Criteria
- [ ] Zero value works without calling a constructor
- [ ] Map initialized lazily (nil check before write)
- [ ] Reading from nil map is safe (returns zero/error appropriately)
- [ ] sync.Mutex embedded by value (not pointer)
- [ ] All operations are thread-safe
- [ ] List returns nil when empty
- [ ] List returns sorted names

---

## Task 5: JSON omitempty Control

**Level**: Intermediate
**Estimated Time**: 30 minutes

### Description
Design a Go struct for a user profile API response that properly uses zero values and `omitempty` tags. Different fields should have different behaviors: always included, omitted when zero, or distinguished between null and zero.

### Requirements
1. Fields that are ALWAYS included: `ID`, `Username`, `Active`
2. Fields OMITTED when zero: `Bio`, `Location`
3. Fields where you must distinguish null from zero: `Score`, `FollowerCount`
4. Write code showing the JSON output for different configurations

### Starter Code

```go
package main

import (
    "encoding/json"
    "fmt"
)

// UserProfile represents a user's profile in API responses.
// Design the struct tags to control JSON serialization of zero values.
type UserProfile struct {
    // Always included (no omitempty):
    ID       int    `json:"id"`
    Username string `json:"username"`
    Active   bool   `json:"active"`

    // TODO: Add Bio and Location — should be omitted when zero (empty string)
    // Bio      ...
    // Location ...

    // TODO: Add Score and FollowerCount — must distinguish null from 0
    // Use pointer type so nil = "not set" and &0 = "explicitly 0"
    // Score         ...
    // FollowerCount ...
}

func main() {
    // Case 1: New user — only required fields
    newUser := UserProfile{
        ID:       1,
        Username: "alice",
    }
    printJSON("New user", newUser)
    // Expected: {"id":1,"username":"alice","active":false}
    // Bio, Location, Score, FollowerCount should not appear

    // Case 2: Full profile
    score := 100
    followers := 0  // explicitly zero followers
    fullUser := UserProfile{
        ID:       2,
        Username: "bob",
        Active:   true,
        // TODO: Set Bio, Location
        // TODO: Set Score and FollowerCount
    }
    _ = score
    _ = followers
    printJSON("Full user", fullUser)

    // Case 3: User with 0 score (must appear as 0, not omitted)
    zeroScore := 0
    userWithZeroScore := UserProfile{
        ID:       3,
        Username: "carol",
        // TODO: Set score to &zeroScore
    }
    _ = zeroScore
    printJSON("Zero score user", userWithZeroScore)
    // Expected: score should appear as 0, not omitted
}

func printJSON(label string, v interface{}) {
    b, err := json.MarshalIndent(v, "", "  ")
    if err != nil {
        fmt.Printf("%s: ERROR: %v\n", label, err)
        return
    }
    fmt.Printf("%s:\n%s\n\n", label, b)
}
```

### Evaluation Criteria
- [ ] `Active` always appears in JSON (even as `false`)
- [ ] `Bio` and `Location` omitted when empty string
- [ ] `Score` appears as `null` when nil, `0` when explicitly set to 0
- [ ] `FollowerCount` same as Score
- [ ] Demonstrates difference between `omitempty` with int vs `*int`
- [ ] All test cases produce correct JSON

---

## Task 6: Zero Value Pattern (Counter)

**Level**: Intermediate
**Estimated Time**: 35 minutes

### Description
Build a thread-safe `RateCounter` that tracks the number of events per time window. The zero value should be immediately usable with sensible defaults.

### Requirements
1. Counts events in a rolling time window
2. Zero value is immediately usable (window defaults to 1 minute, max to unlimited)
3. Thread-safe
4. Methods: `Record()`, `Count() int`, `Reset()`

### Starter Code

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

// RateCounter counts events within a time window.
// Zero value is usable: window = 1 minute, no max limit.
// A RateCounter must not be copied after first use.
type RateCounter struct {
    mu       sync.Mutex
    window   time.Duration // 0 = use 1 minute
    events   []time.Time   // nil = no events yet (safe with append)
    maxCount int           // 0 = no limit
}

// SetWindow sets the time window. Must be called before first Record.
func (c *RateCounter) SetWindow(d time.Duration) {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.window = d
}

// Record records one event at the current time.
func (c *RateCounter) Record() {
    // TODO: Implement
    // 1. Lock
    // 2. Initialize window to 1 minute if zero
    // 3. Append current time to events (nil slice is safe)
    // 4. Remove events outside the window
    // 5. Unlock
}

// Count returns the number of events within the current window.
func (c *RateCounter) Count() int {
    // TODO: Implement
    // 1. Lock
    // 2. Initialize window if zero
    // 3. Count events within window
    // 4. Return count
    return 0
}

// Reset clears all recorded events.
func (c *RateCounter) Reset() {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.events = nil  // back to zero value (nil slice)
}

func main() {
    // Test 1: Zero value works
    var counter RateCounter

    counter.Record()
    counter.Record()
    counter.Record()

    fmt.Printf("Count: %d (expected 3)\n", counter.Count())

    counter.Reset()
    fmt.Printf("Count after reset: %d (expected 0)\n", counter.Count())

    // Test 2: Custom window
    var counter2 RateCounter
    counter2.SetWindow(100 * time.Millisecond)

    counter2.Record()
    fmt.Printf("Count immediately: %d (expected 1)\n", counter2.Count())

    time.Sleep(200 * time.Millisecond)
    fmt.Printf("Count after window: %d (expected 0)\n", counter2.Count())
}
```

### Evaluation Criteria
- [ ] Zero value works without initialization
- [ ] `window = 0` defaults to 1 minute
- [ ] nil events slice works with append
- [ ] Record correctly removes expired events
- [ ] Count correctly filters by window
- [ ] Reset returns to zero value state
- [ ] All operations are thread-safe

---

## Task 7: Optional Fields with Pointers

**Level**: Intermediate
**Estimated Time**: 25 minutes

### Description
Implement a search filter for a database query that uses pointer fields to distinguish "not set" from "zero value." Write helper functions for creating filters.

### Starter Code

```go
package main

import (
    "fmt"
    "strings"
)

// UserFilter represents optional search criteria.
// nil pointer = no filter (match any)
// non-nil pointer = filter by that value
type UserFilter struct {
    MinAge    *int    // nil = no min age filter
    MaxAge    *int    // nil = no max age filter
    Active    *bool   // nil = both active and inactive
    MinScore  *float64 // nil = no min score filter
    Country   *string // nil = any country
}

// Helper to create int pointer
func IntPtr(v int) *int { return &v }

// Helper to create bool pointer
func BoolPtr(v bool) *bool { return &v }

// Helper to create string pointer
func StringPtr(v string) *string { return &v }

// Helper to create float64 pointer
func Float64Ptr(v float64) *float64 { return &v }

// BuildSQL generates a WHERE clause from the filter.
// Returns empty string if no filters set.
func BuildSQL(f UserFilter) string {
    // TODO: Implement
    // Build WHERE clause based on non-nil fields
    // Example: "WHERE age >= 18 AND active = true"
    var conditions []string

    // TODO: Check each field for nil and add condition if not nil

    if len(conditions) == 0 {
        return ""
    }
    return "WHERE " + strings.Join(conditions, " AND ")
}

func main() {
    // Test 1: No filters
    f1 := UserFilter{}
    fmt.Printf("No filters: %q\n", BuildSQL(f1))
    // Expected: ""

    // Test 2: Active users only
    f2 := UserFilter{Active: BoolPtr(true)}
    fmt.Printf("Active only: %q\n", BuildSQL(f2))
    // Expected: "WHERE active = true"

    // Test 3: Age range
    f3 := UserFilter{
        MinAge: IntPtr(18),
        MaxAge: IntPtr(65),
    }
    fmt.Printf("Age range: %q\n", BuildSQL(f3))
    // Expected: "WHERE age >= 18 AND age <= 65"

    // Test 4: Complex filter
    f4 := UserFilter{
        MinAge:  IntPtr(21),
        Active:  BoolPtr(true),
        Country: StringPtr("US"),
    }
    fmt.Printf("Complex: %q\n", BuildSQL(f4))

    // Test 5: Zero value distinction
    // MinScore of 0.0 is different from "no score filter"
    f5 := UserFilter{MinScore: Float64Ptr(0.0)}
    fmt.Printf("Zero score filter: %q\n", BuildSQL(f5))
    // Expected: "WHERE score >= 0.00" (0.0 explicitly set, not omitted)
}
```

### Evaluation Criteria
- [ ] nil pointer fields are correctly ignored
- [ ] Non-nil pointer fields generate SQL conditions
- [ ] `*int` with value 0 generates condition (not ignored)
- [ ] `*bool` with value `false` generates condition (not ignored)
- [ ] Helper functions (`IntPtr`, `BoolPtr`, etc.) work correctly
- [ ] Multiple conditions joined with AND
- [ ] Empty filter returns empty string

---

## Task 8: Interface nil Trap Fix

**Level**: Intermediate–Advanced
**Estimated Time**: 30 minutes

### Description
You're given buggy code that contains the interface nil trap. Find and fix all occurrences. Then write tests to verify the fix.

### Starter Code (Contains Bugs)

```go
package main

import (
    "errors"
    "fmt"
)

type ValidationError struct {
    Field   string
    Message string
}

func (e *ValidationError) Error() string {
    return fmt.Sprintf("validation error on %s: %s", e.Field, e.Message)
}

type DatabaseError struct {
    Code    int
    Message string
}

func (e *DatabaseError) Error() string {
    return fmt.Sprintf("database error %d: %s", e.Code, e.Message)
}

// BUG 1: validateUsername returns typed nil
func validateUsername(username string) error {
    var err *ValidationError
    if username == "" {
        err = &ValidationError{Field: "username", Message: "cannot be empty"}
    }
    if len(username) > 50 {
        err = &ValidationError{Field: "username", Message: "too long"}
    }
    return err  // BUG: always returns non-nil interface!
}

// BUG 2: saveUser returns typed nil
func saveUser(username string) error {
    var dbErr *DatabaseError
    if username == "banned" {
        dbErr = &DatabaseError{Code: 403, Message: "user is banned"}
    }
    return dbErr  // BUG: always returns non-nil interface!
}

// BUG 3: processUser chains errors incorrectly
func processUser(username string) error {
    if err := validateUsername(username); err != nil {
        return err
    }
    if err := saveUser(username); err != nil {
        return err
    }
    return nil
}

func main() {
    // These should print "OK" but they won't due to the bugs:
    cases := []string{"alice", "bob", "carol"}
    for _, name := range cases {
        err := processUser(name)
        if err != nil {
            fmt.Printf("FAIL %s: unexpected error: %v\n", name, err)
        } else {
            fmt.Printf("OK: %s\n", name)
        }
    }

    // These should print errors:
    badCases := []struct {
        name     string
        input    string
        wantType string
    }{
        {"empty", "", "validation"},
        {"banned", "banned", "database"},
    }
    for _, c := range badCases {
        err := processUser(c.input)
        if err == nil {
            fmt.Printf("FAIL %s: expected error but got nil\n", c.name)
        } else {
            fmt.Printf("OK %s: got error: %v\n", c.name, err)
        }
    }

    // Demonstrate the trap:
    err := validateUsername("alice")
    fmt.Printf("validateUsername('alice') == nil: %v (should be true!)\n", err == nil)

    _ = errors.New("sentinel")
}
```

### Evaluation Criteria
- [ ] All three bugs identified and explained
- [ ] All bugs fixed without changing function signatures
- [ ] "alice", "bob", "carol" now return nil error
- [ ] "" returns ValidationError
- [ ] "banned" returns DatabaseError
- [ ] Explanation of why typed nil != untyped nil provided in comments

---

## Task 9: Channel Zero Value Behavior

**Level**: Advanced
**Estimated Time**: 35 minutes

### Description
Use the nil channel property (nil channel in select is never selected) to implement a fan-in merger that gracefully handles channel completion.

### Requirements
1. `Merge(channels ...<-chan int) <-chan int` — merges multiple channels
2. When a channel is closed, disable it (set to nil) without stopping other channels
3. Return when all input channels are closed

### Starter Code

```go
package main

import (
    "fmt"
    "sync"
)

// Merge combines multiple channels into a single channel.
// When an input channel closes, it's removed from the merge.
// The output channel closes when ALL input channels are closed.
func Merge(channels ...<-chan int) <-chan int {
    out := make(chan int)

    go func() {
        defer close(out)

        // TODO: Implement using nil channel trick
        // 1. Make a copy of the channels slice (don't modify original)
        // 2. Use a select over all channels
        // 3. When a channel closes (ok = false), set that element to nil
        // 4. Count remaining non-nil channels; stop when 0
        // Hint: You cannot use variadic select, but you can use reflection
        //       OR you can limit to a fixed number of channels for simplicity

        // Simple approach: limit to 3 channels
        // Advanced: use reflect.Select for arbitrary number
    }()

    return out
}

// generateInts creates a channel that sends n integers and closes
func generateInts(n int, vals ...int) <-chan int {
    ch := make(chan int, len(vals))
    for _, v := range vals {
        ch <- v
    }
    close(ch)
    return ch
}

func main() {
    ch1 := generateInts(3, 1, 2, 3)
    ch2 := generateInts(3, 4, 5, 6)
    ch3 := generateInts(3, 7, 8, 9)

    merged := Merge(ch1, ch2, ch3)

    var results []int
    for v := range merged {
        results = append(results, v)
    }

    fmt.Println("Received:", len(results), "values")
    // All 9 values should be received (order may vary)

    // Test with nil channel in select demonstration:
    var nilCh <-chan int  // nil channel

    // This should immediately hit default (nil channel never fires):
    select {
    case v := <-nilCh:
        fmt.Println("Received from nil:", v)  // should NOT happen
    default:
        fmt.Println("nil channel correctly ignored in select")  // should happen
    }
}
```

### Evaluation Criteria
- [ ] Correctly merges multiple channels
- [ ] Closed channels are disabled (set to nil) without affecting others
- [ ] Output channel closes when all inputs are closed
- [ ] nil channel in select correctly never fires (demonstrated)
- [ ] No goroutine leaks
- [ ] All values from all channels are received

---

## Task 10: Generic Zero Value Utility

**Level**: Advanced (Go 1.18+)
**Estimated Time**: 40 minutes

### Description
Build a generic `Optional[T]` type that leverages zero values, and a set of utility functions for working with zero values generically.

### Requirements
1. `Optional[T]` type with `Some(value)` and `None()` constructors
2. `IsZero[T comparable](v T) bool` — checks if value equals zero
3. `ZeroOf[T any]() T` — returns zero value of type T
4. `Coalesce[T comparable](values ...T) T` — returns first non-zero value
5. Write tests for all functions

### Starter Code

```go
package main

import "fmt"

// Optional represents a value that may or may not be present.
// Zero value of Optional[T] is None (not present).
type Optional[T any] struct {
    // TODO: Add fields
    // value T
    // valid bool  (false = None, true = Some)
}

// Some creates an Optional with a value.
func Some[T any](v T) Optional[T] {
    // TODO: Implement
    return Optional[T]{}
}

// None creates an Optional with no value.
// Note: var opt Optional[T] already creates None — this is for explicitness.
func None[T any]() Optional[T] {
    return Optional[T]{}  // zero value = None
}

// IsSome reports whether the Optional has a value.
func (o Optional[T]) IsSome() bool {
    // TODO: Implement
    return false
}

// Get returns the value and whether it's present.
func (o Optional[T]) Get() (T, bool) {
    // TODO: Implement
    var zero T
    return zero, false
}

// OrDefault returns the value if present, or the provided default.
func (o Optional[T]) OrDefault(def T) T {
    // TODO: Implement
    return def
}

// IsZero checks if a comparable value equals its zero value.
func IsZero[T comparable](v T) bool {
    // TODO: Implement
    // Hint: var zero T; return v == zero
    return false
}

// ZeroOf returns the zero value of type T.
func ZeroOf[T any]() T {
    // TODO: Implement
    var zero T
    return zero
}

// Coalesce returns the first non-zero value from the arguments.
// Returns zero value if all arguments are zero.
func Coalesce[T comparable](values ...T) T {
    // TODO: Implement
    var zero T
    return zero
}

func main() {
    // Test Optional[int]
    some := Some(42)
    none := None[int]()
    var zeroOpt Optional[string]  // zero value = None

    fmt.Println("Some(42).IsSome():", some.IsSome())             // true
    fmt.Println("None().IsSome():", none.IsSome())               // false
    fmt.Println("zero Optional IsSome:", zeroOpt.IsSome())       // false

    val, ok := some.Get()
    fmt.Printf("Some(42).Get(): %d, %v\n", val, ok)             // 42, true

    _, ok2 := none.Get()
    fmt.Printf("None().Get(): _, %v\n", ok2)                    // false

    fmt.Println("Some(42).OrDefault(0):", some.OrDefault(0))    // 42
    fmt.Println("None().OrDefault(99):", none.OrDefault(99))    // 99

    // Test IsZero
    fmt.Println("IsZero(0):", IsZero(0))          // true
    fmt.Println("IsZero(1):", IsZero(1))          // false
    fmt.Println("IsZero(\"\"):", IsZero(""))      // true
    fmt.Println("IsZero(\"a\"):", IsZero("a"))    // false
    fmt.Println("IsZero(false):", IsZero(false))  // true
    fmt.Println("IsZero(true):", IsZero(true))    // false

    // Test ZeroOf
    fmt.Println("ZeroOf[int]():", ZeroOf[int]())         // 0
    fmt.Println("ZeroOf[string]():", ZeroOf[string]())   // ""
    fmt.Println("ZeroOf[bool]():", ZeroOf[bool]())       // false

    // Test Coalesce
    fmt.Println("Coalesce(0, 0, 3, 4):", Coalesce(0, 0, 3, 4))          // 3
    fmt.Println("Coalesce(\"\", \"\", \"a\"):", Coalesce("", "", "a"))   // "a"
    fmt.Println("Coalesce(0, 0, 0):", Coalesce(0, 0, 0))                 // 0
}
```

### Evaluation Criteria
- [ ] `Optional[T]` zero value represents None
- [ ] `Some(v).IsSome()` returns true
- [ ] `None[T]().IsSome()` returns false
- [ ] `var opt Optional[T]` is equivalent to `None[T]()`
- [ ] `IsZero` works for int, string, bool, struct
- [ ] `ZeroOf` returns correct zero for each type
- [ ] `Coalesce` returns first non-zero or zero if all zero
- [ ] Code compiles with Go 1.18+

---

## Task 11: Lazy Map Initialization

**Level**: Intermediate
**Estimated Time**: 25 minutes

### Description
Implement a `MultiMap[K, V]` generic type that maps keys to multiple values. The zero value must be immediately usable, with the internal map initialized lazily.

### Starter Code

```go
package main

import (
    "fmt"
    "sync"
)

// MultiMap maps each key to a slice of values.
// Zero value is immediately usable.
// Thread-safe.
type MultiMap[K comparable, V any] struct {
    mu   sync.Mutex
    data map[K][]V
}

// Add adds a value to the key's collection.
func (m *MultiMap[K, V]) Add(key K, value V) {
    // TODO: Implement with lazy initialization
}

// Get returns all values for the key, or nil if none.
func (m *MultiMap[K, V]) Get(key K) []V {
    // TODO: Implement (safe even if internal map is nil)
    return nil
}

// Keys returns all keys that have at least one value.
func (m *MultiMap[K, V]) Keys() []K {
    // TODO: Implement (return nil if empty)
    return nil
}

// Remove removes all values for the key.
func (m *MultiMap[K, V]) Remove(key K) {
    // TODO: Implement
}

func main() {
    var mm MultiMap[string, int]

    mm.Add("a", 1)
    mm.Add("a", 2)
    mm.Add("b", 3)

    fmt.Println("a:", mm.Get("a"))          // [1 2]
    fmt.Println("b:", mm.Get("b"))          // [3]
    fmt.Println("c:", mm.Get("c"))          // []  or nil
    fmt.Println("keys:", mm.Keys())         // [a b] (order may vary)

    mm.Remove("a")
    fmt.Println("after remove a:", mm.Get("a")) // [] or nil
}
```

### Evaluation Criteria
- [ ] Zero value usable without constructor
- [ ] Map initialized lazily on first Add
- [ ] Get is safe even when internal map is nil
- [ ] Multiple values per key work correctly
- [ ] Remove correctly clears a key's values
- [ ] Thread-safe (sync.Mutex by value)

---

## Task 12: Zero Value Audit

**Level**: Intermediate–Advanced
**Estimated Time**: 40 minutes

### Description
Audit the given codebase for zero value misuse. Identify all issues, categorize them, and provide fixes.

### Code to Audit

```go
package main

import (
    "encoding/json"
    "fmt"
    "sync"
)

// Issue: findable?
type UserStore struct {
    mu   *sync.Mutex           // Issue 1
    data map[string]User       // Issue 2
}

func NewUserStore() *UserStore {
    return &UserStore{
        mu:   &sync.Mutex{},
        data: make(map[string]User),
    }
}

type User struct {
    ID      int    `json:"id"`
    Name    string `json:"name"`
    Role    string `json:"role"`    // Issue 3: "" means what?
    Active  bool   `json:"active"`  // Issue 4: false = inactive? or unset?
    Score   int    `json:"score"`   // Issue 5: 0 means not scored or scored 0?
    Tags    []string `json:"tags"`  // Issue 6: nil vs empty?
}

// Issue: findable?
func (us *UserStore) GetUser(id string) error {
    var user *User              // Issue 7
    // ... imagine fetching from DB
    if user == nil {
        return nil             // Issue 8: should this be an error?
    }
    _ = user
    return nil
}

// Issue: findable?
func (us *UserStore) CountActive() int {
    if us.data == nil || len(us.data) == 0 {  // Issue 9
        return 0
    }
    count := 0                 // Issue 10: style issue
    for _, u := range us.data {
        if u.Active {
            count++
        }
    }
    return count
}

// Issue: findable?
type Result struct {
    Data  []User              `json:"data"`
    Total int                 `json:"total"`
    Error string              `json:"error"`  // Issue 11
}

func search(term string) Result {
    var result Result         // zero value
    result.Data = []User{}   // Issue 12: unnecessary
    result.Total = 0          // Issue 13: unnecessary
    // ... do search
    return result
}

func main() {
    store := NewUserStore()
    _ = store

    // Demonstrate issue 6:
    u := User{Name: "Alice"}
    b, _ := json.Marshal(u)
    fmt.Println(string(b))  // Tags appears as null - is that right?
}
```

### Your Task
1. Identify and categorize all 13 issues
2. For each issue, explain WHY it's a problem
3. Provide the corrected code

### Evaluation Criteria
- [ ] All 13 issues identified
- [ ] Each issue correctly categorized (anti-pattern, bug, style, design)
- [ ] Correct explanation for each issue
- [ ] Fixed code compiles and runs correctly
- [ ] Fixed code follows Go zero value idioms
- [ ] Fixed code has improved API design where relevant
