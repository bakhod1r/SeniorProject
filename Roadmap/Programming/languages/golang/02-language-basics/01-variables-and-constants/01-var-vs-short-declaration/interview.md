# var vs := — Interview Questions

## Table of Contents
1. [Junior Level Questions](#junior-level-questions)
2. [Middle Level Questions](#middle-level-questions)
3. [Senior Level Questions](#senior-level-questions)
4. [Scenario-Based Questions](#scenario-based-questions)
5. [FAQ](#faq)

---

## Junior Level Questions

### Q1. What is the difference between `var` and `:=` in Go?

**Answer:**

`var` is the explicit variable declaration keyword. It can be used anywhere — inside functions and at package level. You can optionally specify the type, the value, or both.

`:=` is the short variable declaration operator. It can **only** be used inside functions. It declares and initializes a variable in one step, with the type inferred from the right-hand side.

```go
package main

import "fmt"

// var at package level (required here)
var appName = "MyApp"

func main() {
    // var inside function
    var x int = 10

    // := inside function (shorter form, same result)
    y := 20

    fmt.Println(appName, x, y)
    // Output: MyApp 10 20
}
```

---

### Q2. Can you use `:=` at package level?

**Answer:**

No. `:=` is only allowed inside functions. Using it at package level causes a compile error: `non-declaration statement outside function body`.

```go
package main

// COMPILE ERROR:
// x := 10

// CORRECT:
var x = 10

func main() {
    y := 20  // OK — inside function
    _ = y
}
```

---

### Q3. What is the zero value in Go, and how does it relate to `var`?

**Answer:**

In Go, every type has a zero value — the default value it takes when no value is assigned:
- `int`, `float64`: `0`
- `string`: `""`
- `bool`: `false`
- pointers, slices, maps, channels, functions: `nil`

When you declare a variable with `var` and do not assign a value, it automatically gets the zero value. This makes Go memory-safe — you never read garbage data from an uninitialized variable.

```go
package main

import "fmt"

func main() {
    var i int       // i = 0
    var s string    // s = ""
    var b bool      // b = false
    var p *int      // p = nil

    fmt.Println(i, s, b, p)
    // Output: 0  false <nil>
}
```

---

### Q4. What is the blank identifier `_` and when do you use it?

**Answer:**

`_` (underscore) is the blank identifier. It discards a value you do not need. It is useful when a function returns multiple values but you only care about some of them.

```go
package main

import (
    "fmt"
    "os"
)

func main() {
    // We only care about the error, not the file object
    _, err := os.Open("file.txt")
    if err != nil {
        fmt.Println("Error:", err)
    }

    // Discard index in range loop
    words := []string{"a", "b", "c"}
    for _, word := range words {
        fmt.Println(word)
    }
}
```

---

### Q5. How do you declare multiple variables at once?

**Answer:**

You can declare multiple variables in a single line using `:=` or `var`, and you can use a grouped `var` block:

```go
package main

import "fmt"

var (
    host = "localhost"
    port = 8080
)

func main() {
    // Multiple with :=
    a, b := 1, 2

    // Multiple with var
    var x, y int = 10, 20

    fmt.Println(host, port, a, b, x, y)
    // Output: localhost 8080 1 2 10 20
}
```

---

### Q6. What happens if you declare a variable but never use it?

**Answer:**

Go will refuse to compile the program with the error `x declared and not used`. This is a deliberate design decision to keep code clean.

The exception: package-level variables are allowed to be unused (they might be used by other packages). Also, the blank identifier `_` is always valid.

```go
func main() {
    x := 5  // COMPILE ERROR if x is never used
    _ = x   // Fix: use it or assign to _
}
```

---

### Q7. Can `var` and `:=` be used in the same function?

**Answer:**

Yes. You can freely mix both forms in the same function. Use whichever is more appropriate for the situation.

```go
package main

import "fmt"

func main() {
    var count int         // zero value signal
    name := "Alice"       // short form for quick local var
    var score float64 = 9.5  // explicit type for clarity

    count = 42
    fmt.Println(count, name, score)
    // Output: 42 Alice 9.5
}
```

---

## Middle Level Questions

### Q8. Explain the `:=` "at least one new variable" rule.

**Answer:**

When using `:=`, at least one variable on the left side must be new (not previously declared in the current scope). If all variables already exist, it is a compile error.

This rule is what makes error-handling chains work cleanly — you can reuse `err` across multiple calls because each call introduces at least one new variable.

```go
package main

import (
    "fmt"
    "strconv"
)

func main() {
    // a and err are both NEW
    a, err := strconv.Atoi("10")
    if err != nil { return }

    // b is NEW, err is REASSIGNED (not redeclared)
    b, err := strconv.Atoi("20")
    if err != nil { return }

    // COMPILE ERROR — both a and b already exist
    // a, b := 100, 200

    fmt.Println(a + b) // 30
}
```

---

### Q9. What is variable shadowing and why is it dangerous?

**Answer:**

Shadowing occurs when a variable in an inner scope has the same name as a variable in an outer scope. The inner variable "shadows" the outer one — any changes to the inner variable do NOT affect the outer one.

It is dangerous because it is completely silent (no error or warning by default) and can cause bugs where you think you are updating a variable but you are actually creating a new one.

```go
package main

import "fmt"

func checkAccess(token string) bool {
    allowed := false

    if token != "" {
        allowed := true  // BUG: shadows outer allowed!
        _ = allowed
    }

    return allowed // always returns false!
}

func checkAccessFixed(token string) bool {
    allowed := false

    if token != "" {
        allowed = true  // correct: assigns to outer allowed
    }

    return allowed
}

func main() {
    fmt.Println(checkAccess("secret"))      // false (BUG)
    fmt.Println(checkAccessFixed("secret")) // true (CORRECT)
}
```

Detection: use `go vet -vettool=$(which shadow)` or `staticcheck`.

---

### Q10. What is the difference between `var s []string` and `s := []string{}`?

**Answer:**

`var s []string` creates a **nil slice** — the slice header exists but points to no underlying array. `s == nil` is `true`.

`s := []string{}` creates an **empty slice** — the slice header points to a zero-length array. `s == nil` is `false`.

Both have length 0 and can be appended to. The practical difference matters in JSON marshaling (`null` vs `[]`) and when code explicitly checks for `nil`.

```go
package main

import (
    "encoding/json"
    "fmt"
)

func main() {
    var s1 []string     // nil slice
    s2 := []string{}    // empty slice

    fmt.Println(s1 == nil)  // true
    fmt.Println(s2 == nil)  // false
    fmt.Println(len(s1), len(s2)) // 0 0

    j1, _ := json.Marshal(s1)
    j2, _ := json.Marshal(s2)
    fmt.Println(string(j1)) // null
    fmt.Println(string(j2)) // []
}
```

---

### Q11. How does the if-init statement work with `:=`?

**Answer:**

Go allows a short initialization statement before the condition in an `if` statement: `if init; condition`. The variable declared in the init is scoped to the entire `if/else` block.

This pattern keeps the outer scope clean and limits the lifetime of variables used only for the conditional check.

```go
package main

import (
    "fmt"
    "strconv"
)

func main() {
    input := "42"

    if n, err := strconv.Atoi(input); err != nil {
        fmt.Println("parse error:", err)
    } else {
        fmt.Println("parsed:", n)  // n is accessible here
    }
    // n and err are NOT accessible here
}
```

---

### Q12. Why might you use `var w io.Writer = os.Stdout` instead of `w := os.Stdout`?

**Answer:**

`w := os.Stdout` infers the concrete type `*os.File`. `var w io.Writer = os.Stdout` explicitly declares `w` as the `io.Writer` interface type.

Choosing the interface type:
1. Prevents accidentally calling `*os.File`-specific methods (enforces interface discipline)
2. Makes the variable substitutable with any `io.Writer` implementation
3. Makes intent clear: "I only care about Write behavior"

```go
package main

import (
    "io"
    "os"
)

func writeHello(w io.Writer) {
    w.Write([]byte("hello\n"))
}

func main() {
    var w io.Writer = os.Stdout  // w is io.Writer
    writeHello(w)

    // w2 := os.Stdout  // w2 would be *os.File
    // writeHello(w2)   // still works, but type is different
}
```

---

### Q13. What is the scope of a variable declared in a `for` init statement?

**Answer:**

A variable declared in the init part of a `for` statement is scoped to the entire `for` loop (including the condition and post statement). It is not accessible outside the loop.

```go
package main

import "fmt"

func main() {
    for i := 0; i < 3; i++ {
        fmt.Println(i)
    }
    // fmt.Println(i)  // COMPILE ERROR: undefined: i

    // This works because j is declared outside
    var j int
    for j = 0; j < 3; j++ {}
    fmt.Println(j) // 3 — accessible here
}
```

---

### Q14. Explain the loop variable capture problem (pre-Go 1.22).

**Answer:**

In Go versions before 1.22, the loop variable in a `for` loop is a single variable that is reused in every iteration. If a closure captures this variable, all closures end up referencing the same variable (which has the final value after the loop ends).

```go
package main

import "fmt"

func main() {
    // BUG (Go < 1.22): all funcs print 3
    funcs := make([]func(), 3)
    for i := 0; i < 3; i++ {
        // i := i  // FIX: create new variable per iteration
        funcs[i] = func() { fmt.Println(i) }
    }
    for _, f := range funcs {
        f() // all print 3 (the final value of i)
    }
}
```

Fix: add `i := i` inside the loop body to create a new variable per iteration. In Go 1.22+, each iteration automatically gets its own variable.

---

## Senior Level Questions

### Q15. How does escape analysis interact with variable declarations?

**Answer:**

Escape analysis is the compiler's process of determining whether a variable can live on the stack or must be moved to the heap. The declaration syntax (`var` vs `:=`) does not affect this — what matters is how the variable is used.

A variable escapes to the heap when:
- Its address is returned from a function
- It is stored in a heap-allocated structure
- It is captured by a goroutine that outlives the function
- It is passed to an interface method (may escape depending on size)

```go
// Does NOT escape: value returned, not pointer
func stackAlloc() int {
    x := 42  // stays on stack
    return x
}

// ESCAPES: pointer to local variable returned
func heapAlloc() *int {
    x := 42  // x escapes to heap
    return &x
}
```

To inspect: `go build -gcflags='-m' ./...`

---

### Q16. What does the Go compiler generate for `var x int` vs `var x int = 0`?

**Answer:**

Both are functionally identical — the zero value of `int` is `0`. However, at the binary level:

- **Inside a function**: both generate a zero-initialization instruction on the stack.
- **At package level**: `var x int` places `x` in the `.bss` segment (zero-initialized by OS at startup). `var x int = 0` may also be placed in `.bss` since the compiler recognizes `0` is the zero value and optimizes accordingly.

The key: there is no runtime difference, and idiomatic Go prefers `var x int` (without the `= 0`) to signal intent.

```go
// These are equivalent at the machine level:
var a int      // .bss segment
var b int = 0  // compiler likely optimizes to .bss too

func f() {
    x := 0     // zero-initialized stack slot
    var y int  // same
    _ = x
    _ = y
}
```

---

### Q17. How do you design a package API that uses zero values effectively?

**Answer:**

A well-designed Go type has a useful zero value — the type is ready to use without initialization. This is sometimes called "zero-value-ready" design.

Examples from the standard library:
- `sync.Mutex` — zero value is an unlocked mutex, ready to use
- `bytes.Buffer` — zero value is an empty buffer, ready to read/write
- `sync.WaitGroup` — zero value is a counter at 0

Design principle: instead of requiring `New()` calls, make the zero value of your struct do something useful.

```go
package cache

import "sync"

// Cache is ready to use without initialization
// var c Cache  — immediately usable
type Cache struct {
    mu    sync.Mutex
    items map[string]string
}

func (c *Cache) Get(key string) (string, bool) {
    c.mu.Lock()
    defer c.mu.Unlock()
    if c.items == nil {
        return "", false
    }
    v, ok := c.items[key]
    return v, ok
}

func (c *Cache) Set(key, value string) {
    c.mu.Lock()
    defer c.mu.Unlock()
    if c.items == nil {
        c.items = make(map[string]string)
    }
    c.items[key] = value
}
```

---

### Q18. What are the linter rules for variable declaration in Go?

**Answer:**

Key linter rules:

| Tool | Rule | Description |
|------|------|-------------|
| `go vet` + `shadow` | shadow | Detects shadowed variables |
| `staticcheck` | SA1001 | Variable shadowing |
| `revive` | `var-declaration` | Unnecessary type in var decl |
| `revive` | `redefines-builtin-id` | Shadows builtin names |
| `golangci-lint` | `unused` | Declared but not used (compiler catches this) |
| `gocritic` | `sloppyReassign` | Detects unintentional reassignment |

Configuration in `.golangci.yml`:
```yaml
linters:
  enable:
    - govet
    - staticcheck
    - revive

linters-settings:
  govet:
    enable:
      - shadow
```

---

### Q19. Explain how package-level variable initialization order works and what can go wrong.

**Answer:**

Go initializes package-level variables in dependency order. If `a` depends on `b`, `b` is initialized first. Variables within a single package that have no dependencies are initialized in the order they appear in source files (alphabetical file order).

Common pitfall: using a package-level variable before it is initialized (in a var that depends on a function that uses another var that isn't initialized yet).

```go
package main

import "fmt"

var (
    // Order: b initialized first (no deps), then a
    a = b * 2   // a depends on b
    b = 10
)

func main() {
    fmt.Println(a, b) // 20 10
}
```

What can go wrong:
```go
var db = openDB()       // openDB uses logger
var logger = newLogger() // not initialized yet when openDB runs!
```

Fix: use `init()` functions to enforce order, or use lazy initialization:
```go
var logger *Logger
var db *sql.DB

func init() {
    logger = newLogger()  // logger first
    db = openDB(logger)   // then db
}
```

---

### Q20. How does Go 1.22 change loop variable semantics?

**Answer:**

In Go 1.22+, each iteration of a `for` loop creates a new variable for the loop variable. This eliminates the classic closure capture bug.

```go
// Go 1.22+: each iteration gets its own i
funcs := make([]func(), 3)
for i := range 3 {
    funcs[i] = func() { fmt.Println(i) }
}
for _, f := range funcs {
    f() // prints 0, 1, 2 (correct)
}
```

Before Go 1.22, you needed:
```go
for i := 0; i < 3; i++ {
    i := i  // capture own copy
    funcs[i] = func() { fmt.Println(i) }
}
```

This change was enabled via `GOEXPERIMENT=loopvar` in Go 1.21 and became the default in Go 1.22.

---

## Scenario-Based Questions

### Q21. You are reviewing a PR and find this code. What is wrong?

```go
func getUserRole(userID int) (string, error) {
    role := "guest"

    user, err := db.FindUser(userID)
    if err != nil {
        return "", err
    }

    if user.IsAdmin {
        role := "admin"
        _ = role
    }

    return role, nil
}
```

**Answer:**

The bug is on the line `role := "admin"`. This uses `:=` which creates a **new local variable** `role` that shadows the outer `role`. When the `if` block exits, the inner `role` is destroyed. The function always returns `"guest"` even for admins.

**Fix:**
```go
if user.IsAdmin {
    role = "admin"  // use = not :=
}
```

This is a classic and dangerous shadowing bug. Detection: `go vet -vettool=$(which shadow)`.

---

### Q22. What is wrong with this `init()` function?

```go
package main

import (
    "database/sql"
    "log"
)

var db *sql.DB

func init() {
    db, err := sql.Open("postgres", "postgres://localhost/mydb")
    if err != nil {
        log.Fatal(err)
    }
    _ = db
}

func main() {
    row := db.QueryRow("SELECT 1")
    // ...
    _ = row
}
```

**Answer:**

The `:=` on `db, err := sql.Open(...)` creates a **new local** `db` variable inside `init()`. The package-level `db` variable remains `nil`. The `_ = db` line suppresses the "declared and not used" error, hiding the bug.

When `main()` calls `db.QueryRow(...)`, it panics because `db` is `nil`.

**Fix:**
```go
func init() {
    var err error
    db, err = sql.Open("postgres", "postgres://localhost/mydb")
    if err != nil {
        log.Fatal(err)
    }
}
```

---

### Q23. A developer says this code is correct. Is it?

```go
func process(items []string) []string {
    var results []string  // nil slice
    for _, item := range items {
        results = append(results, item+"_processed")
    }
    return results
}
```

**Answer:**

Yes, this is correct and idiomatic. `var results []string` creates a nil slice, but `append` handles nil slices correctly — it allocates a new backing array as needed. This is the standard Go pattern for accumulating results.

The only concern: for large `items`, consider pre-allocating with `results := make([]string, 0, len(items))` to avoid repeated reallocations.

---

### Q24. How would you fix this concurrent code?

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    var wg sync.WaitGroup
    results := make([]int, 5)

    for i := 0; i < 5; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            results[i] = i * i  // BUG: i captured by reference
        }()
    }

    wg.Wait()
    fmt.Println(results)
}
```

**Answer:**

The bug: all goroutines capture the same loop variable `i`. By the time goroutines run, the loop may have completed and `i` is out of bounds (5) or has an unexpected value.

**Fix 1 (pre-Go 1.22):** Create a new variable per iteration.
```go
for i := 0; i < 5; i++ {
    i := i  // new variable per iteration
    wg.Add(1)
    go func() {
        defer wg.Done()
        results[i] = i * i
    }()
}
```

**Fix 2:** Pass as argument.
```go
for i := 0; i < 5; i++ {
    wg.Add(1)
    go func(idx int) {
        defer wg.Done()
        results[idx] = idx * idx
    }(i)
}
```

**Fix 3 (Go 1.22+):** The loop variable is automatically per-iteration.

---

### Q25. What does this print and why?

```go
package main

import "fmt"

func main() {
    x := 1

    func() {
        x := 2  // shadows outer x
        fmt.Println(x)
    }()

    fmt.Println(x)
}
```

**Answer:**

Output:
```
2
1
```

The anonymous function creates its own `x := 2` which shadows the outer `x`. Printing inside the function prints `2`. After the function returns, the outer `x` is still `1`. The inner `x` was a completely separate variable.

---

## FAQ

### FAQ 1: Should I always use `:=` inside functions?

Not always. Use `var` when:
- You want the zero value and want to signal that intent explicitly
- You need a specific type that differs from what would be inferred
- You are declaring a variable whose value will be set conditionally later
- You want to use a grouped `var` block for clarity

Use `:=` for most other local variables — it is the idiomatic Go way.

### FAQ 2: Is there a performance difference between `var` and `:=`?

No. Inside a function, both declarations compile to identical machine code. The Go compiler's SSA optimization pass eliminates any syntactic differences. Performance depends on whether the variable escapes to the heap (determined by escape analysis, not the declaration syntax).

### FAQ 3: What does "no new variables on left side of :=" mean?

It means you tried to use `:=` but all variables on the left side already exist in the current scope:
```go
a := 1
b := 2
a, b := 3, 4  // COMPILE ERROR: a and b already declared
a, b = 3, 4   // CORRECT: plain assignment
```

### FAQ 4: Can you use `:=` to assign to struct fields?

No. `:=` only works with simple identifiers on the left side, not field selectors:
```go
type S struct{ X int }
s := S{}
s.X := 5  // COMPILE ERROR: non-name s.X on left side of :=
s.X = 5   // CORRECT
```

### FAQ 5: How do I know if a linter is catching my shadowing bugs?

Run:
```bash
# Install shadow analyzer
go install golang.org/x/tools/go/analysis/passes/shadow/cmd/shadow@latest

# Run it
go vet -vettool=$(which shadow) ./...

# Or use staticcheck
staticcheck ./...

# Or use golangci-lint with shadow enabled
golangci-lint run --enable-all ./...
```
