# Go switch — Middle Level

## Table of Contents
1. Why switch Exists — Design Rationale
2. Go switch vs C/Java switch — Key Differences
3. switch Internals: Jump Tables and Binary Search
4. Expressionless switch — When and Why
5. Type switch — Deep Dive
6. Type switch with Multiple Interface Types
7. fallthrough — Semantics and Use Cases
8. switch in Error Handling
9. switch with Interface Values
10. Switch and the Comparable Constraint
11. Exhaustiveness Checking
12. switch in State Machines
13. switch vs Map Dispatch — Trade-offs
14. switch vs if-else Chain — Performance
15. Labeled break in Loops with switch
16. switch with Goroutines and Select
17. Testing switch Statements
18. Anti-Patterns in Go switch
19. Refactoring: if-else to switch
20. switch and Cyclomatic Complexity
21. switch in Code Generation
22. Evolution of switch in Go Versions
23. Alternative Approaches: dispatch tables, interfaces
24. Language Comparison: Go vs Rust match
25. switch in Standard Library
26. Debugging switch Logic
27. switch and Zero Values
28. switch with Error Types
29. Performance: Switch vs Map for Different Sizes
30. Debugging Guide and Common Pitfalls

---

## 1. Why switch Exists — Design Rationale

`switch` is fundamentally about **dispatching** on a value. Its existence simplifies code where you have multiple discrete outcomes:

```go
// Without switch: verbose if-else chain
func getHandler(path string) http.HandlerFunc {
    if path == "/" { return homeHandler }
    if path == "/about" { return aboutHandler }
    if path == "/contact" { return contactHandler }
    return notFoundHandler
}

// With switch: cleaner dispatch
func getHandler(path string) http.HandlerFunc {
    switch path {
    case "/":         return homeHandler
    case "/about":    return aboutHandler
    case "/contact":  return contactHandler
    default:          return notFoundHandler
    }
}
```

Go's switch design decisions:
- **No implicit fallthrough**: Prevents accidental bugs that plague C code
- **Multiple values per case**: `case "a", "b":` eliminates duplication
- **Expressionless switch**: Replaces if-else chains cleanly
- **Type switch**: Replaces `reflect.TypeOf()` comparisons

---

## 2. Go switch vs C/Java switch — Key Differences

```go
// Go switch — key differences:

// 1. No implicit fallthrough
switch x {
case 1:
    fmt.Println("one")
    // Automatically exits switch — no "break" needed
case 2:
    fmt.Println("two")
}

// 2. Explicit fallthrough (unconditional!)
switch x {
case 1:
    fmt.Println("one")
    fallthrough  // Always falls to case 2, regardless of x
case 2:
    fmt.Println("two")
}

// 3. Multiple values per case
switch x {
case 1, 2, 3:
    fmt.Println("small")
}
// C equivalent: case 1: case 2: case 3: (separate lines!)

// 4. Expression-less switch
switch {
case x > 0:
    fmt.Println("positive")
}
// C: switch(1) { case (x > 0): } — not idiomatic in C

// 5. Type switch (no C equivalent)
switch v := i.(type) {
case int: fmt.Println("int", v)
}
```

| Feature | Go | C | Java |
|---------|-----|---|------|
| Implicit fallthrough | No | Yes | No (enhanced switch) |
| Explicit fallthrough | `fallthrough` | (default) | No |
| Multiple values/case | `case 1,2,3:` | Separate cases | `case 1,2,3:` (switch expr) |
| Expression-less switch | Yes | No | No |
| Type switch | Yes | No | `instanceof` chain |
| break required | No | Yes | No (enhanced switch) |
| Return from switch | Yes | Yes | Yes |

---

## 3. switch Internals: Jump Tables and Binary Search

For small numbers of integer cases, the compiler generates a **jump table** (O(1)):

```go
// This likely compiles to a jump table (O(1))
switch n {
case 0: return "zero"
case 1: return "one"
case 2: return "two"
case 3: return "three"
case 4: return "four"
}
```

Assembly (simplified):
```asm
CMPQ    n, $4
JA      default     ; if n > 4, go to default
JMPQ    *table(n*8) ; jump table lookup

table:
  .quad case0
  .quad case1
  .quad case2
  .quad case3
  .quad case4
```

For sparse integer values or large ranges, the compiler may use **binary search** (O(log n)):

```go
// Sparse values — binary search (not jump table)
switch n {
case 1:   return "a"
case 10:  return "b"
case 100: return "c"
case 1000: return "d"
}
```

For string switches, the compiler often generates:
1. Compare lengths first (cheap)
2. Hash comparison or sequential comparison

View with:
```bash
go build -gcflags="-S" main.go 2>&1 | grep -A 50 '"".yourFunc'
```

---

## 4. Expressionless switch — When and Why

Expressionless `switch` is `switch true`:

```go
// These are identical:
switch true {
case x > 0:
    fmt.Println("positive")
}

switch {
case x > 0:
    fmt.Println("positive")
}
```

**When to use expressionless switch:**
1. Range conditions on different variables
2. Complex boolean expressions per case
3. When cases test different things

```go
func describeNumber(n float64) string {
    switch {
    case math.IsNaN(n):
        return "NaN"
    case math.IsInf(n, 1):
        return "+Infinity"
    case math.IsInf(n, -1):
        return "-Infinity"
    case n < 0:
        return "negative"
    case n == 0:
        return "zero"
    case n < 1:
        return "fractional positive"
    default:
        return "positive"
    }
}
```

**Vs if-else:** For 4+ unrelated boolean conditions, switch is cleaner. For 2-3 conditions, if-else is fine.

---

## 5. Type switch — Deep Dive

Type switch is powered by Go's runtime type information (RTTI):

```go
package main

import "fmt"

// The type assertion x.(type) is only valid in a switch statement
// var v interface{} = 42
// t := v.(type)  // COMPILE ERROR: use of .(type) outside type switch

func processAny(v interface{}) {
    switch x := v.(type) {
    case nil:
        fmt.Println("nil")
    case int, int8, int16, int32, int64:
        fmt.Printf("some integer: %v (type %T)\n", x, x)
        // NOTE: x is still interface{} here when multiple types!
    case uint, uint8, uint16, uint32, uint64:
        fmt.Printf("unsigned integer: %v\n", x)
    case float32:
        fmt.Printf("float32: %f\n", x)
    case float64:
        fmt.Printf("float64: %f\n", x)
    case string:
        fmt.Printf("string of length %d: %q\n", len(x), x)
    case []byte:
        fmt.Printf("byte slice of length %d\n", len(x))
    case error:
        fmt.Printf("error: %v\n", x)
    default:
        fmt.Printf("unhandled type: %T\n", x)
    }
}

func main() {
    processAny(42)
    processAny("hello")
    processAny(3.14)
    processAny([]byte{1, 2, 3})
    processAny(fmt.Errorf("test"))
    processAny(nil)
}
```

**Key**: When a case lists multiple types, `x` retains the interface type (not the concrete type).

---

## 6. Type switch with Multiple Interface Types

```go
package main

import (
    "fmt"
    "io"
    "os"
)

type Closer interface{ Close() error }
type Flusher interface{ Flush() error }
type ReadWriter interface {
    io.Reader
    io.Writer
}

func describe(v interface{}) string {
    switch v := v.(type) {
    case ReadWriter:
        return fmt.Sprintf("ReadWriter: %T", v)
    case io.Writer:
        return fmt.Sprintf("Writer only: %T", v)
    case io.Reader:
        return fmt.Sprintf("Reader only: %T", v)
    case Closer:
        return fmt.Sprintf("Closer: %T", v)
    default:
        return fmt.Sprintf("other: %T", v)
    }
}

func main() {
    describe(os.Stdout)  // *os.File implements ReadWriter
    describe(os.Stdin)   // *os.File implements ReadWriter
    _ = v  // silence unused
}

var v = describe
```

**Important**: Interface cases in type switch check if the value implements the interface. More specific interfaces should come first.

---

## 7. fallthrough — Semantics and Use Cases

`fallthrough` in Go is **unconditional** — it does NOT check the next case's condition:

```go
package main

import "fmt"

func main() {
    x := 1
    switch x {
    case 1:
        fmt.Println("one")
        fallthrough  // Always executes case 2 body, regardless of condition
    case 2:
        fmt.Println("two or fell through from one")
    }
    // Output: "one" then "two or fell through from one"
}

// Legitimate use: version compatibility
func handleVersion(version int) {
    switch {
    case version >= 3:
        fmt.Println("v3 features")
        fallthrough
    case version >= 2:
        fmt.Println("v2 features")
        fallthrough
    case version >= 1:
        fmt.Println("v1 features")
    }
}

// Legitimate use: accumulating behaviors
func describeN(n int) {
    s := ""
    switch {
    case n >= 3:
        s += "[3+]"
        fallthrough
    case n >= 2:
        s += "[2+]"
        fallthrough
    case n >= 1:
        s += "[1+]"
    }
    fmt.Println(n, "->", s)
}
```

**When NOT to use fallthrough:** Most of the time. It reduces readability and is a code smell in most Go code.

---

## 8. switch in Error Handling

```go
package main

import (
    "errors"
    "fmt"
    "net"
    "syscall"
)

type NotFoundError struct{ ID string }
func (e *NotFoundError) Error() string { return "not found: " + e.ID }

type PermissionError struct{ Action string }
func (e *PermissionError) Error() string { return "permission denied: " + e.Action }

type RateLimitError struct{ RetryAfter int }
func (e *RateLimitError) Error() string { return fmt.Sprintf("rate limited, retry after %ds", e.RetryAfter) }

func handleError(err error) {
    if err == nil {
        return
    }

    // Type switch for error handling
    switch e := err.(type) {
    case *NotFoundError:
        fmt.Printf("Resource %s not found — check the ID\n", e.ID)
    case *PermissionError:
        fmt.Printf("No permission to %s — check your role\n", e.Action)
    case *RateLimitError:
        fmt.Printf("Rate limited — try again in %d seconds\n", e.RetryAfter)
    case *net.OpError:
        fmt.Printf("Network error: op=%s, net=%s\n", e.Op, e.Net)
    default:
        // Check wrapped errors with errors.Is
        if errors.Is(err, syscall.ECONNREFUSED) {
            fmt.Println("Connection refused — is the server running?")
        } else {
            fmt.Printf("Unknown error: %T: %v\n", err, err)
        }
    }
}

func main() {
    handleError(&NotFoundError{"user-42"})
    handleError(&PermissionError{"delete"})
    handleError(&RateLimitError{30})
    handleError(fmt.Errorf("some other error"))
}
```

---

## 9. switch with Interface Values

```go
package main

import "fmt"

type Animal interface {
    Speak() string
    Name() string
}

type Dog struct{ name string }
func (d Dog) Speak() string { return "Woof!" }
func (d Dog) Name() string  { return d.name }

type Cat struct{ name string }
func (c Cat) Speak() string { return "Meow!" }
func (c Cat) Name() string  { return c.name }

type Bird struct{ name string }
func (b Bird) Speak() string { return "Tweet!" }
func (b Bird) Name() string  { return b.name }

func describeAnimal(a Animal) {
    // Type switch gives you access to concrete type's methods
    switch pet := a.(type) {
    case Dog:
        fmt.Printf("Dog %s says: %s (loyal!)\n", pet.Name(), pet.Speak())
    case Cat:
        fmt.Printf("Cat %s says: %s (independent!)\n", pet.Name(), pet.Speak())
    case Bird:
        fmt.Printf("Bird %s says: %s (free!)\n", pet.Name(), pet.Speak())
    default:
        fmt.Printf("Unknown animal: %T says %s\n", a, a.Speak())
    }
}

func main() {
    animals := []Animal{
        Dog{"Rex"},
        Cat{"Whiskers"},
        Bird{"Tweety"},
    }
    for _, a := range animals {
        describeAnimal(a)
    }
}
```

---

## 10. Switch and the Comparable Constraint

Go switch can be used with any **comparable** type. Non-comparable types (slices, maps, functions) cannot be used as case values:

```go
package main

import "fmt"

type Point struct{ X, Y int }

func main() {
    // Comparable types work
    p := Point{1, 2}
    switch p {
    case Point{0, 0}:
        fmt.Println("origin")
    case Point{1, 2}:
        fmt.Println("target")  // This matches
    }

    // Arrays are comparable
    arr := [3]int{1, 2, 3}
    switch arr {
    case [3]int{1, 2, 3}:
        fmt.Println("our array")
    }

    // Slices, maps, functions are NOT comparable
    // switch []int{1,2,3} { case []int{1,2,3}: }  // COMPILE ERROR

    // Workaround: use expressionless switch
    s := []int{1, 2, 3}
    switch {
    case len(s) == 3 && s[0] == 1:
        fmt.Println("might be our slice")
    }
}
```

---

## 11. Exhaustiveness Checking

Go's switch doesn't require exhaustive case coverage (unlike Rust's match). This can lead to unhandled cases:

```go
package main

import "fmt"

type Status int

const (
    Pending Status = iota
    Active
    Suspended
    Deleted
)

// BUG: Deleted status is not handled!
func processStatus(s Status) string {
    switch s {
    case Pending:
        return "pending"
    case Active:
        return "active"
    case Suspended:
        return "suspended"
    // Deleted is missing!
    }
    return ""  // Silent default
}

func main() {
    fmt.Println(processStatus(Deleted))  // Returns "" silently
}
```

**Tools for exhaustiveness:**
```bash
# Install exhaustive linter
go install github.com/nishanths/exhaustive/cmd/exhaustive@latest
exhaustive ./...
```

```go
// Using default to catch missing cases (but loses type safety)
switch s {
case Pending:  return "pending"
case Active:   return "active"
case Suspended: return "suspended"
default:
    panic(fmt.Sprintf("unhandled status: %d", s))  // Fail-fast
}
```

---

## 12. switch in State Machines

Switch is the natural fit for FSM implementations:

```go
package main

import "fmt"

type State int

const (
    StateIdle State = iota
    StateConnecting
    StateConnected
    StateDisconnecting
)

type Event int

const (
    EventConnect Event = iota
    EventConnected
    EventDisconnect
    EventDisconnected
    EventError
)

func transition(current State, event Event) (State, error) {
    switch current {
    case StateIdle:
        switch event {
        case EventConnect:
            return StateConnecting, nil
        default:
            return current, fmt.Errorf("invalid event %d in idle state", event)
        }

    case StateConnecting:
        switch event {
        case EventConnected:
            return StateConnected, nil
        case EventError:
            return StateIdle, nil
        default:
            return current, fmt.Errorf("invalid event %d in connecting state", event)
        }

    case StateConnected:
        switch event {
        case EventDisconnect:
            return StateDisconnecting, nil
        case EventError:
            return StateIdle, nil
        default:
            return current, fmt.Errorf("invalid event %d in connected state", event)
        }

    case StateDisconnecting:
        switch event {
        case EventDisconnected:
            return StateIdle, nil
        default:
            return current, fmt.Errorf("invalid event %d in disconnecting state", event)
        }
    }
    return current, fmt.Errorf("unknown state %d", current)
}

func main() {
    state := StateIdle
    events := []Event{EventConnect, EventConnected, EventDisconnect, EventDisconnected}

    stateNames := map[State]string{
        StateIdle: "Idle", StateConnecting: "Connecting",
        StateConnected: "Connected", StateDisconnecting: "Disconnecting",
    }

    for _, e := range events {
        next, err := transition(state, e)
        if err != nil {
            fmt.Println("Error:", err)
        } else {
            fmt.Printf("%s -> %s\n", stateNames[state], stateNames[next])
            state = next
        }
    }
}
```

---

## 13. switch vs Map Dispatch — Trade-offs

```go
package main

import (
    "fmt"
    "testing"
)

// switch approach: compile-time checked, no closures
func processSwitch(cmd string) string {
    switch cmd {
    case "start":   return "starting"
    case "stop":    return "stopping"
    case "restart": return "restarting"
    case "status":  return "checking status"
    default:        return "unknown"
    }
}

// map approach: runtime extensible, closures
var handlers = map[string]func() string{
    "start":   func() string { return "starting" },
    "stop":    func() string { return "stopping" },
    "restart": func() string { return "restarting" },
    "status":  func() string { return "checking status" },
}

func processMap(cmd string) string {
    if h, ok := handlers[cmd]; ok {
        return h()
    }
    return "unknown"
}

func BenchmarkSwitch(b *testing.B) {
    for i := 0; i < b.N; i++ {
        processSwitch("restart")
    }
}

func BenchmarkMap(b *testing.B) {
    for i := 0; i < b.N; i++ {
        processMap("restart")
    }
}
```

**Trade-offs:**

| Aspect | switch | map dispatch |
|--------|--------|--------------|
| Performance | Fastest (jump table) | Fast (hash lookup) |
| Extensibility | Requires code change | Add to map at runtime |
| Type safety | Compile-time | Runtime (interface) |
| Closures/state | No | Yes |
| Testing | Easy | Easy |
| Number of cases | Works well < 20 | Better for 50+ |

---

## 14. switch vs if-else Chain — Performance

```go
package main

import "testing"

var result string

func classify_switch(n int) string {
    switch {
    case n < -100:   return "very negative"
    case n < 0:      return "negative"
    case n == 0:     return "zero"
    case n < 100:    return "positive"
    default:         return "very positive"
    }
}

func classify_ifelsechain(n int) string {
    if n < -100 {
        return "very negative"
    } else if n < 0 {
        return "negative"
    } else if n == 0 {
        return "zero"
    } else if n < 100 {
        return "positive"
    } else {
        return "very positive"
    }
}

func BenchmarkSwitch(b *testing.B) {
    for i := 0; i < b.N; i++ {
        result = classify_switch(i % 300 - 150)
    }
}

func BenchmarkIfElse(b *testing.B) {
    for i := 0; i < b.N; i++ {
        result = classify_ifelsechain(i % 300 - 150)
    }
}
// Result: essentially identical — same machine code generated
```

**Conclusion:** For expressionless switch vs if-else, performance is equivalent. The difference comes from integer switch with jump tables.

---

## 15. Labeled break in Loops with switch

```go
package main

import "fmt"

func searchMatrix(matrix [][]int, target int) (int, int) {
outer:
    for i, row := range matrix {
        for j, val := range row {
            if val == target {
                fmt.Printf("Found %d at (%d,%d)\n", target, i, j)
                break outer  // Exits both loops!
            }
        }
        // Without label: switch break only exits switch, not the for loop
        switch {
        case i > 10:
            break outer  // Exits outer for loop
        }
    }
    return -1, -1
}

func processCommands(commands []string) {
loop:
    for _, cmd := range commands {
        switch cmd {
        case "quit":
            fmt.Println("Quitting")
            break loop  // Exits the for loop (not just switch)
        case "skip":
            continue loop  // continue works with labels too
        default:
            fmt.Println("Processing:", cmd)
        }
    }
}

func main() {
    matrix := [][]int{{1, 2, 3}, {4, 5, 6}, {7, 8, 9}}
    searchMatrix(matrix, 5)
    processCommands([]string{"start", "skip", "work", "quit", "after"})
}
```

---

## 16. switch with Goroutines and Select

```go
package main

import (
    "fmt"
    "time"
)

func processor(jobs <-chan string, results chan<- string, done <-chan struct{}) {
    for {
        select {
        case job, ok := <-jobs:
            if !ok {
                return
            }
            // Inner switch to process job type
            switch job {
            case "heavy":
                time.Sleep(10 * time.Millisecond)
                results <- "heavy done"
            case "light":
                results <- "light done"
            default:
                results <- "unknown: " + job
            }
        case <-done:
            fmt.Println("Worker shutting down")
            return
        }
    }
}

func main() {
    jobs := make(chan string, 5)
    results := make(chan string, 5)
    done := make(chan struct{})

    go processor(jobs, results, done)

    jobs <- "heavy"
    jobs <- "light"
    jobs <- "unknown"
    close(jobs)

    for i := 0; i < 3; i++ {
        fmt.Println(<-results)
    }
}
```

Note: `select` itself is a special form of switch for channels.

---

## 17. Testing switch Statements

```go
package main

import (
    "testing"
)

func httpStatusCategory(code int) string {
    switch {
    case code >= 500:
        return "server_error"
    case code >= 400:
        return "client_error"
    case code >= 300:
        return "redirect"
    case code >= 200:
        return "success"
    case code >= 100:
        return "informational"
    default:
        return "unknown"
    }
}

func TestHttpStatusCategory(t *testing.T) {
    tests := []struct {
        code int
        want string
    }{
        // Test boundaries for each case
        {200, "success"},
        {299, "success"},
        {300, "redirect"},
        {399, "redirect"},
        {400, "client_error"},
        {404, "client_error"},
        {499, "client_error"},
        {500, "server_error"},
        {503, "server_error"},
        {100, "informational"},
        {99, "unknown"},
        {0, "unknown"},
    }

    for _, tt := range tests {
        t.Run(fmt.Sprintf("code=%d", tt.code), func(t *testing.T) {
            if got := httpStatusCategory(tt.code); got != tt.want {
                t.Errorf("httpStatusCategory(%d) = %q; want %q",
                    tt.code, got, tt.want)
            }
        })
    }
}
```

Coverage requirement: At least one test per case, including the boundary values.

---

## 18. Anti-Patterns in Go switch

```go
package main

import "fmt"

// Anti-pattern 1: Using switch where if is cleaner (2 cases)
func isPositive_bad(n int) string {
    switch {
    case n > 0:
        return "positive"
    default:
        return "non-positive"
    }
}
// Better: just use if-else for 2 cases

// Anti-pattern 2: Using fallthrough unnecessarily
func monthDays_bad(month int) int {
    days := 0
    switch month {
    case 1:
        days = 31
        fallthrough
    case 2:
        days = 28  // BUG: overwrites 31!
    }
    return days
}

// Correct:
func monthDays_good(month int) int {
    switch month {
    case 2:
        return 28
    case 4, 6, 9, 11:
        return 30
    default:
        return 31
    }
}

// Anti-pattern 3: Checking same condition twice
func check_bad(x int) {
    switch x > 0 {
    case true:
        fmt.Println("positive")
    case false:
        fmt.Println("non-positive")
    }
}
// Better: if x > 0 { ... } else { ... }

// Anti-pattern 4: Using type switch when interface is better
func process_bad(v interface{}) {
    switch v.(type) {
    case *Dog:
        v.(*Dog).Bark()  // redundant type assertion
    }
}
// Better: use the typed variable from switch
func process_good(v interface{}) {
    switch dog := v.(type) {
    case *Dog:
        dog.Bark()
    }
}

type Dog struct{}
func (d *Dog) Bark() { fmt.Println("Woof") }
```

---

## 19. Refactoring: if-else to switch

```go
package main

import "fmt"

// BEFORE: if-else chain (hard to read)
func handleHTTPMethod_before(method string) {
    if method == "GET" {
        fmt.Println("Fetching resource")
    } else if method == "POST" {
        fmt.Println("Creating resource")
    } else if method == "PUT" {
        fmt.Println("Updating resource")
    } else if method == "PATCH" {
        fmt.Println("Partially updating")
    } else if method == "DELETE" {
        fmt.Println("Deleting resource")
    } else if method == "HEAD" || method == "OPTIONS" {
        fmt.Println("Metadata request")
    } else {
        fmt.Println("Method not allowed:", method)
    }
}

// AFTER: switch (clean, scannable)
func handleHTTPMethod_after(method string) {
    switch method {
    case "GET":
        fmt.Println("Fetching resource")
    case "POST":
        fmt.Println("Creating resource")
    case "PUT":
        fmt.Println("Updating resource")
    case "PATCH":
        fmt.Println("Partially updating")
    case "DELETE":
        fmt.Println("Deleting resource")
    case "HEAD", "OPTIONS":
        fmt.Println("Metadata request")
    default:
        fmt.Println("Method not allowed:", method)
    }
}

func main() {
    methods := []string{"GET", "POST", "DELETE", "TRACE"}
    for _, m := range methods {
        handleHTTPMethod_after(m)
    }
}
```

**When to refactor if-else to switch:**
- 4+ branches comparing the same variable
- The cases are discrete values (not ranges)
- You want cleaner visual structure

---

## 20. switch and Cyclomatic Complexity

Each `case` in a switch adds 1 to cyclomatic complexity (same as each branch in if-else):

```go
// Cyclomatic complexity: 1 (base) + 4 (cases) + 1 (default) = 6
func getDiscount(tier string) float64 {  // CC = 1
    switch tier {                         //   +0 (switch itself)
    case "bronze":  return 0.05           //   +1
    case "silver":  return 0.10           //   +1
    case "gold":    return 0.15           //   +1
    case "platinum": return 0.20          //   +1
    default:        return 0.0            //   +1
    }
}                                         // Total: 6
```

Reducing complexity with a map (reduces to 2):

```go
var discounts = map[string]float64{
    "bronze": 0.05, "silver": 0.10,
    "gold": 0.15, "platinum": 0.20,
}

func getDiscount(tier string) float64 {  // CC = 1
    d, ok := discounts[tier]            // +0 (no branch in code)
    if !ok {                             // +1
        return 0.0
    }
    return d
}                                        // Total: 2
```

---

## 21. switch in Code Generation

```go
package main

import (
    "fmt"
    "strings"
)

// Generating switch statements programmatically
type SwitchCase struct {
    Values []string
    Body   string
}

func generateSwitch(varName string, cases []SwitchCase, defaultBody string) string {
    var sb strings.Builder
    sb.WriteString(fmt.Sprintf("switch %s {\n", varName))
    for _, c := range cases {
        quoted := make([]string, len(c.Values))
        for i, v := range c.Values {
            quoted[i] = fmt.Sprintf("%q", v)
        }
        sb.WriteString(fmt.Sprintf("case %s:\n    %s\n",
            strings.Join(quoted, ", "), c.Body))
    }
    if defaultBody != "" {
        sb.WriteString("default:\n    " + defaultBody + "\n")
    }
    sb.WriteString("}")
    return sb.String()
}

func main() {
    code := generateSwitch("status", []SwitchCase{
        {[]string{"pending"}, `return "processing"`},
        {[]string{"active", "running"}, `return "ok"`},
        {[]string{"failed", "error"}, `return "failed"`},
    }, `return "unknown"`)
    fmt.Println(code)
}
```

---

## 22. Evolution of switch in Go Versions

Go's switch has been stable since 1.0. Notable related changes:

- **Go 1.18 (2022)**: Generic functions can use switch on type parameters
- **Go 1.21 (2023)**: min/max/clear builtins (reduce need for switch)
- No changes to switch syntax itself

```go
// Go 1.18+: switch in generic functions
func processNumber[T int | float64](v T) string {
    // Can't do type switch on T, but can do value switch
    switch any(v).(type) {
    case int:
        return fmt.Sprintf("int: %v", v)
    case float64:
        return fmt.Sprintf("float64: %v", v)
    }
    return "unknown"
}
```

---

## 23. Alternative Approaches: dispatch tables, interfaces

```go
package main

import "fmt"

// Approach 1: switch (good for 3-10 cases)
func processSwitch(action string) {
    switch action {
    case "start":  fmt.Println("starting")
    case "stop":   fmt.Println("stopping")
    default:       fmt.Println("unknown")
    }
}

// Approach 2: Map of functions (good for 10+ extensible cases)
var processors = map[string]func(){
    "start": func() { fmt.Println("starting") },
    "stop":  func() { fmt.Println("stopping") },
}

func processMap(action string) {
    if fn, ok := processors[action]; ok {
        fn()
    } else {
        fmt.Println("unknown")
    }
}

// Approach 3: Interface dispatch (best for complex behaviors)
type Action interface{ Execute() }

type StartAction struct{}
func (s StartAction) Execute() { fmt.Println("starting") }

type StopAction struct{}
func (s StopAction) Execute() { fmt.Println("stopping") }

func processInterface(a Action) {
    a.Execute()  // No switch needed!
}
```

---

## 24. Language Comparison: Go vs Rust match

```go
// GO switch
switch status {
case 200, 201:
    fmt.Println("success")
case 404:
    fmt.Println("not found")
default:
    fmt.Println("other")
}

// RUST match (for comparison — not Go code)
// match status {
//     200 | 201 => println!("success"),
//     404 => println!("not found"),
//     _ => println!("other"),
// }
```

Key differences:
| Feature | Go switch | Rust match |
|---------|-----------|------------|
| Exhaustiveness | Not required | Required |
| Pattern matching | Limited | Full |
| Guards | Via expressionless switch | `if` guards in patterns |
| Binding | `switch v := x.(type)` | `v @ pattern` |
| Return value | No (statement) | Yes (expression) |
| Tuple matching | No | Yes |
| Range patterns | Via expressionless | `1..=10` |

---

## 25. switch in Standard Library

```go
// From encoding/json (simplified)
func (d *decodeState) value(v reflect.Value) {
    switch d.opcode {
    case scanBeginArray:
        d.array(v)
    case scanBeginObject:
        d.object(v)
    case scanBeginLiteral:
        d.literalStore(d.literalInterface(), v, false)
    }
}

// From net/http (simplified)
func (mux *ServeMux) Handler(r *Request) (h Handler, pattern string) {
    switch {
    case r.Method != "CONNECT":
        // Handle redirect
    }
}

// From os package
func (f *File) Write(b []byte) (n int, err error) {
    if err := f.checkValid("write"); err != nil {
        return 0, err
    }
    n, e := f.write(b)
    if n < 0 {
        n = 0
    }
    if n != len(b) {
        err = io.ErrShortWrite
    }
    // ...
}
```

---

## 26. Debugging switch Logic

```go
package main

import "fmt"

// Add tracing to understand which case fires
func tracedSwitch(x int) string {
    var result string
    switch {
    case x < 0:
        result = "negative"
        fmt.Printf("  [trace] case: x < 0 (x=%d)\n", x)
    case x == 0:
        result = "zero"
        fmt.Printf("  [trace] case: x == 0\n")
    case x < 100:
        result = "small"
        fmt.Printf("  [trace] case: 0 < x < 100 (x=%d)\n", x)
    default:
        result = "large"
        fmt.Printf("  [trace] case: default (x=%d)\n", x)
    }
    return result
}

// Debugging type switch
func debugTypeSwitch(v interface{}) {
    fmt.Printf("Input: %v (runtime type: %T)\n", v, v)
    switch x := v.(type) {
    case int:
        fmt.Printf("  -> int case: %d\n", x)
    case string:
        fmt.Printf("  -> string case: %q\n", x)
    default:
        fmt.Printf("  -> default case: %T = %v\n", x, x)
    }
}

func main() {
    for _, n := range []int{-5, 0, 50, 200} {
        fmt.Printf("Input %d -> %q\n", n, tracedSwitch(n))
    }
}
```

---

## 27. switch and Zero Values

```go
package main

import "fmt"

type Priority int

const (
    Low    Priority = 1
    Medium Priority = 2
    High   Priority = 3
)

// BUG: Priority zero value (0) is unhandled!
func describeTaskBad(p Priority) string {
    switch p {
    case Low:    return "low priority"
    case Medium: return "medium priority"
    case High:   return "high priority"
    }
    return ""  // Zero value returns ""
}

// GOOD: Handle zero value explicitly
func describeTask(p Priority) string {
    switch p {
    case 0:      return "unset/default"  // explicit zero value handling
    case Low:    return "low priority"
    case Medium: return "medium priority"
    case High:   return "high priority"
    default:
        return fmt.Sprintf("unknown priority: %d", p)
    }
}

func main() {
    var p Priority  // zero value = 0
    fmt.Println(describeTask(p))   // "unset/default"
    fmt.Println(describeTask(Low)) // "low priority"
}
```

---

## 28. switch with Error Types

```go
package main

import (
    "errors"
    "fmt"
    "io"
    "net"
)

// Using errors.As with switch alternative
func categorizeError(err error) string {
    if err == nil {
        return "no error"
    }

    var netErr *net.OpError
    var pathErr *net.AddrError

    switch {
    case errors.Is(err, io.EOF):
        return "end of stream"
    case errors.Is(err, io.ErrUnexpectedEOF):
        return "truncated data"
    case errors.As(err, &netErr):
        return "network error: " + netErr.Op
    case errors.As(err, &pathErr):
        return "address error: " + pathErr.Addr
    default:
        return "unknown: " + err.Error()
    }
}

func main() {
    errors_list := []error{
        nil,
        io.EOF,
        fmt.Errorf("wrapped: %w", io.EOF),
        fmt.Errorf("other error"),
    }
    for _, e := range errors_list {
        fmt.Printf("%v -> %s\n", e, categorizeError(e))
    }
}
```

---

## 29. Performance: Switch vs Map for Different Sizes

```go
package main

import "testing"

// For N=5: switch is faster (no hash overhead)
// For N=50: comparable
// For N=500: map becomes faster

var cases5 = map[string]int{
    "a": 1, "b": 2, "c": 3, "d": 4, "e": 5,
}

func switch5(s string) int {
    switch s {
    case "a": return 1
    case "b": return 2
    case "c": return 3
    case "d": return 4
    case "e": return 5
    }
    return 0
}

func map5(s string) int {
    return cases5[s]
}

var sink int

func BenchmarkSwitch5(b *testing.B) {
    for i := 0; i < b.N; i++ {
        sink = switch5("c")
    }
}

func BenchmarkMap5(b *testing.B) {
    for i := 0; i < b.N; i++ {
        sink = map5("c")
    }
}
// switch5 typically wins for small N due to no hash computation
```

---

## 30. Debugging Guide and Common Pitfalls

| Pitfall | Example | Fix |
|---------|---------|-----|
| Missing default | No default for new enum values | Always add default |
| Duplicate case | `case 1: ... case 1:` | Compile error — fix duplicate |
| Wrong fallthrough | Unexpected behavior | Use explicit cases or no fallthrough |
| Type case not specific enough | `case error:` matches too much | Order more specific interfaces first |
| Zero value unhandled | New variable with zero value hits default | Handle zero explicitly |
| String case sensitivity | `case "Admin"` misses `"admin"` | Normalize with `strings.ToLower` |
| Float comparison | `case 0.1 + 0.2:` may not match `0.3` | Use expressionless switch with epsilon |
| Shadowed variable | `switch v := v.(type)` shadows outer `v` | Use different name if needed |

```go
// Debugging checklist:
// 1. Add default case to catch unexpected values
// 2. Log which case was taken in development
// 3. Test boundary values for expressionless switch
// 4. Use go vet and staticcheck to find issues
// 5. Consider exhaustive linter for enum switches
```
