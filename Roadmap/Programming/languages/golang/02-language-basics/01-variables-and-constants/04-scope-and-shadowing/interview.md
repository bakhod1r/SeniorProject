# Scope and Shadowing — Interview Questions

## Table of Contents
1. [Beginner Questions (Q1–Q7)](#beginner-questions-q1q7)
2. [Intermediate Questions (Q8–Q14)](#intermediate-questions-q8q14)
3. [Advanced Questions (Q15–Q20)](#advanced-questions-q15q20)
4. [Coding Challenge Questions (Q21–Q25)](#coding-challenge-questions-q21q25)
5. [Quick-Fire Round](#quick-fire-round)
6. [Behavioral Questions](#behavioral-questions)
7. [Interview Tips](#interview-tips)

---

> These questions cover Go scope and shadowing at all levels — from junior to principal engineer. Each answer is detailed and complete.

---

## Beginner Questions (Q1–Q7)

---

### Q1: What are the different scopes in Go? Explain each one.

**Answer:**

Go has four levels of scope, from outermost to innermost:

**1. Universe Scope**
The outermost scope, predeclared by Go itself. Contains all built-in identifiers:
- Types: `bool`, `int`, `int8`, `int16`, `int32`, `int64`, `uint`, `uint8` (alias `byte`), `uint16`, `uint32`, `uint64`, `uintptr`, `float32`, `float64`, `complex64`, `complex128`, `string`, `rune`, `error`
- Constants: `true`, `false`, `iota`
- Zero value: `nil`
- Built-in functions: `len`, `cap`, `make`, `new`, `append`, `copy`, `delete`, `close`, `panic`, `recover`, `print`, `println`

These are available in every Go file without importing anything.

**2. Package Scope**
Top-level declarations in any file within a package. Accessible from every file in the same package:
```go
package main

var packageVar = 42       // package scope
func packageFunc() {}     // package scope
type PackageType struct{}  // package scope
```

**3. File Scope**
Only `import` declarations have file scope. An import in `file_a.go` is NOT visible in `file_b.go`:
```go
// file_a.go
import "fmt"  // only visible in file_a.go
```

**4. Function/Block Scope**
Variables declared inside `{}` braces are visible only within that block and nested blocks:
```go
func example() {
    funcVar := 1  // function scope
    if true {
        blockVar := 2  // block scope — only here
        _ = funcVar    // funcVar visible (outer scope)
    }
    // blockVar not visible here
}
```

**Follow-up**: "Why is import file-scoped?" — Because each file should explicitly declare its dependencies. This makes individual files self-contained and analyzable without reading all other files in the package.

---

### Q2: What is variable shadowing in Go?

**Answer:**

Variable shadowing occurs when a declaration inside a nested scope uses the same name as a variable in an outer scope. The inner variable **hides** (shadows) the outer one within that inner scope. The outer variable is NOT modified — it remains unchanged.

```go
x := 1
fmt.Println(x)  // prints 1

if true {
    x := 2           // NEW variable, shadows outer x
    fmt.Println(x)   // prints 2
}

fmt.Println(x)       // prints 1 — outer x unchanged!
```

Key points:
- Shadowing is **legal Go** — the compiler does not report an error
- It can be detected by `go vet` with the `-shadow` flag
- It is one of the most common sources of silent bugs in Go

---

### Q3: What is the difference between `=` and `:=` in Go, and how does it relate to scope?

**Answer:**

- **`=`** (assignment): Updates the value of an **existing** variable. The variable must already be declared.
- **`:=`** (short variable declaration): **Creates a new variable** in the **current scope** and initializes it.

The critical scope-related difference:

```go
err := errors.New("first")  // declares err in current scope

if condition {
    err := errors.New("second") // := ALWAYS creates new var in current scope
    _ = err                      // inner err — outer err unchanged
}

// err still holds "first"

// To update outer err:
if condition {
    err = errors.New("second") // = updates existing err
}
```

**The multi-assignment exception**: When `:=` is used with multiple variables, existing variables in the **same scope** are reused:
```go
x, err := step1()  // new: x and err
y, err := step2()  // new: y; REUSED: err (same scope)
```

This is NOT shadowing — `err` is reassigned, not shadowed.

---

### Q4: Show a simple example of a shadow bug that causes incorrect program behavior.

**Answer:**

```go
package main

import "fmt"

func sumSlice(nums []int) int {
    total := 0
    for _, n := range nums {
        total := total + n  // BUG: := creates new total each iteration!
        _ = total           // inner total is discarded
    }
    return total // always returns 0!
}

func main() {
    result := sumSlice([]int{1, 2, 3, 4, 5})
    fmt.Println(result) // prints 0, not 15!
}
```

The fix:
```go
func sumSliceFixed(nums []int) int {
    total := 0
    for _, n := range nums {
        total += n  // = updates the outer total
    }
    return total // returns 15 correctly
}
```

This is a particularly dangerous bug because it compiles cleanly, runs without panic, but produces wrong results.

---

### Q5: What identifiers does Go make available in the "universe scope"?

**Answer:**

The universe scope contains all predeclared identifiers in Go:

**Predeclared Types:**
`bool`, `byte`, `complex64`, `complex128`, `error`, `float32`, `float64`, `int`, `int8`, `int16`, `int32`, `int64`, `rune`, `string`, `uint`, `uint8`, `uint16`, `uint32`, `uint64`, `uintptr`

**Predeclared Constants:**
`true`, `false`, `iota`

**Predeclared Zero Value:**
`nil`

**Predeclared Functions:**
`append`, `cap`, `clear` (Go 1.21+), `close`, `complex`, `copy`, `delete`, `imag`, `len`, `make`, `max` (Go 1.21+), `min` (Go 1.21+), `new`, `panic`, `print`, `println`, `real`, `recover`

**Important**: These can be shadowed by user declarations, which is almost always a bug:
```go
len := 5         // shadows built-in len function!
true := false    // shadows built-in true constant! (compiles but is insane)
```

---

### Q6: What is the difference between package scope and file scope?

**Answer:**

**Package scope** applies to top-level declarations (variables, functions, types, constants) and is accessible from **every file** in the same package:

```go
// fileA.go
package mypackage
var SharedVar = 42      // package scope

// fileB.go
package mypackage
func useIt() {
    fmt.Println(SharedVar) // accessible — same package
}
```

**File scope** applies only to `import` declarations. Each file's imports are visible only in that file:

```go
// fileA.go
import "fmt"  // only visible in fileA.go

// fileB.go
// must import fmt independently
import "fmt"  // NOT inherited from fileA.go
```

**Key distinction**: If you declare `var x = 1` at the top level of `fileA.go`, it is visible in `fileB.go` (same package). But if you `import "os"` in `fileA.go`, you cannot use `os` in `fileB.go` — you must import it separately.

---

### Q7: Can you shadow a function parameter in Go? Give an example.

**Answer:**

Yes. Function parameters are in function scope, so any inner block can declare a variable with the same name:

```go
func greet(name string) {
    fmt.Println("Outer name:", name) // "Alice"

    if true {
        name := "Bob"             // shadows the parameter
        fmt.Println("Inner name:", name) // "Bob"
    }

    fmt.Println("After block:", name) // "Alice" — parameter unchanged
}

func main() {
    greet("Alice")
}
// Output:
// Outer name: Alice
// Inner name: Bob
// After block: Alice
```

This can also happen in for loops:

```go
func process(items []string, prefix string) {
    for _, prefix := range items {  // shadows parameter prefix!
        fmt.Println(prefix)         // prints items, not the parameter prefix
    }
    fmt.Println(prefix) // original parameter
}
```

---

## Intermediate Questions (Q8–Q14)

---

### Q8: Explain the goroutine loop variable capture bug. Show the bug and all fixes.

**Answer:**

**The Bug (Pre-Go 1.22):**

Before Go 1.22, `for` loop variables were shared across all iterations. When goroutines capture the variable, they all capture a reference to the same storage location:

```go
// BUG: all goroutines see the final value of i
for i := 0; i < 3; i++ {
    go func() {
        fmt.Println(i) // captures &i, not value of i
    }()
}
// All goroutines print 3 (loop finishes before goroutines run)
```

**Fix 1: Pass as function argument (pre-1.22 idiom)**
```go
for i := 0; i < 3; i++ {
    go func(n int) {  // n is a copy of i at this point
        fmt.Println(n)
    }(i)
}
// Prints 0, 1, 2 (in any order)
```

**Fix 2: Create a new variable in each iteration (pre-1.22 idiom)**
```go
for i := 0; i < 3; i++ {
    i := i  // shadows loop var — creates a new i per iteration
    go func() {
        fmt.Println(i)
    }()
}
// Prints 0, 1, 2 (in any order)
```

**Fix 3: Upgrade to Go 1.22 (modern)**
```go
// In go.mod: go 1.22
// No code change needed!
for i := 0; i < 3; i++ {
    go func() {
        fmt.Println(i) // Go 1.22: each iteration gets its own i
    }()
}
// Prints 0, 1, 2 (in any order)
```

**Why this happened**: The shared-variable design was intentional for efficiency — creating a new variable each iteration has a cost. For loops without closures, it makes no difference. The decision was revisited in Go 1.22 when the bug class became well-documented.

---

### Q9: How does Go 1.22 change loop variable semantics? What are the implications?

**Answer:**

**Before Go 1.22:**
- Loop variables (`i` in `for i := 0; i < n; i++`, `v` in `for _, v := range slice`) are created once and reused across all iterations.
- All goroutines or closures that capture the variable share the same storage.

**Go 1.22 Change:**
- When a loop variable's address is taken (e.g., by a closure), the compiler creates a **new copy of the variable per iteration**.
- This is only triggered when needed — simple loops without closure capture are unaffected.
- Applies to both `for` and `range` loops.
- Requires `go 1.22` (or later) in `go.mod`.

**Implications for existing code:**

1. **Old workarounds become unnecessary** (but harmless):
   ```go
   // This was needed before 1.22:
   i := i  // can now be removed
   ```

2. **Tests may change behavior** — code that relied on all closures seeing the final value will now behave differently.

3. **Migration step**: Update `go.mod` to `go 1.22`, then run all tests. Remove `i := i` patterns.

4. **Performance**: The compiler is smart — it only creates per-iteration copies when the variable is actually captured. Simple loops have no overhead.

**Enabling it before Go 1.22:**
```bash
GOEXPERIMENT=loopvar go test ./...
```

---

### Q10: Show the classic "shadowed err" bug in sequential operations and explain why it's dangerous.

**Answer:**

```go
package main

import (
    "errors"
    "fmt"
)

func step1() (string, error) { return "data", nil }
func step2(s string) error   { return errors.New("step2 failed") }
func step3() error           { return nil }

// BUG VERSION:
func buggyProcess() error {
    result, err := step1()
    if err != nil {
        return err
    }

    if err := step2(result); err != nil {  // new err scoped to if block
        fmt.Println("step2 error:", err)
        // This err is handled locally — outer err unchanged
    }

    // BUG: outer err is still nil from step1!
    // Even if step2 failed, we continue here!

    if err != nil {  // outer err — always nil at this point
        return err
    }

    return step3()
}

func main() {
    err := buggyProcess()
    fmt.Println("result:", err) // nil — but step2 failed!
}
```

**Why it's dangerous:**
1. The compiler does not report an error
2. The program runs without panicking
3. A critical error (step2 failure) is silently swallowed
4. In production, this could mean: missing database writes, failed payment charges, incomplete security checks

**Correct version:**
```go
func correctProcess() error {
    result, err := step1()
    if err != nil {
        return fmt.Errorf("step1: %w", err)
    }

    if err = step2(result); err != nil {  // = updates outer err
        return fmt.Errorf("step2: %w", err)
    }

    if err = step3(); err != nil {
        return fmt.Errorf("step3: %w", err)
    }

    return nil
}
```

---

### Q11: What happens when you shadow a package name? Show an example.

**Answer:**

Shadowing a package name makes the package inaccessible within that scope. The identifier now refers to the local variable, not the package:

```go
package main

import (
    "fmt"
    "os"
)

func bad() {
    fmt := "hello"      // shadows the fmt package
    os := struct{}{}     // shadows the os package

    // Now these are compile errors:
    // fmt.Println("test")    // ERROR: fmt.Println undefined (fmt is a string)
    // os.Exit(1)             // ERROR: os.Exit undefined (os is struct{})

    _ = fmt
    _ = os
}

func alsoProblematic() {
    // Even more subtle: function parameter shadows package
    func serve(http string) {  // http shadows the "net/http" package!
        // can't use http.ListenAndServe here
    }
}
```

**Real impact:** If you import `"net/http"` and then write:
```go
http := r.Header.Get("X-Custom")  // shadows http package
// http.StatusOK is now a compile error!
```

**Best practice:** Never use package names as variable names. Common offenders: `fmt`, `os`, `io`, `http`, `url`, `log`, `json`, `sync`, `math`, `time`.

---

### Q12: Explain how the `:=` multi-variable declaration rule interacts with shadowing.

**Answer:**

The rule: When using `:=` with multiple variables on the left side, **at least one** variable must be new in the **current scope**. Existing variables in the same scope are reassigned.

```go
x, err := step1()   // DECLARES both x and err (both new)
y, err := step2()   // DECLARES y, REASSIGNS err (err already in this scope)
// This is NOT shadowing — err is the same variable

z, err := step3()   // DECLARES z, REASSIGNS err
```

**The critical catch**: This only applies within the **same scope**. In a nested scope, `:=` always creates new variables:

```go
x, err := step1()   // outer scope: x, err declared

if condition {
    // NEW scope! err from outer scope is NOT in this scope's table
    y, err := step2()  // DECLARES both y AND err (new in this scope)
    // This IS shadowing — inner err shadows outer err
    _ = y
}
```

**Interview tip**: Many candidates think `:=` in a nested if always reuses the outer `err`. It does NOT — it creates a new `err` in the new scope.

---

### Q13: How do you detect variable shadowing using Go tools?

**Answer:**

**Method 1: go vet with shadow tool**
```bash
# Install the shadow tool
go install golang.org/x/tools/go/analysis/passes/shadow/cmd/shadow@latest

# Run it
shadow ./...

# Or via go vet
go vet -vettool=$(which shadow) ./...
```

**Method 2: golangci-lint (recommended for teams)**
```bash
# Install
brew install golangci-lint

# Run with shadow enabled
golangci-lint run --enable-all ./...
```

Configure in `.golangci.yml`:
```yaml
linters-settings:
  govet:
    enable:
      - shadow
```

**Method 3: staticcheck**
```bash
go install honnef.co/go/tools/cmd/staticcheck@latest
staticcheck ./...
```

**Method 4: Manual address comparison (debugging)**
```go
x := 1
fmt.Printf("outer &x = %p\n", &x)
if true {
    x := 2
    fmt.Printf("inner &x = %p\n", &x) // different address if shadowed
}
```

**Method 5: IDE integration**
- GoLand: `Preferences → Editor → Inspections → Go → Declaration shadowed`
- VS Code with gopls: Highlights shadows when configured

---

### Q14: What is the scope of variables declared in an if-statement initializer?

**Answer:**

Variables declared in an `if` statement's init part (before the semicolon) are scoped to the **entire if-else chain**, including the `else` block:

```go
// Both 'conn' and 'err' are scoped to the entire if-else block
if conn, err := net.Dial("tcp", "localhost:8080"); err != nil {
    fmt.Println("connection failed:", err)
    // conn is accessible here (even though it might be nil)
} else {
    defer conn.Close()
    // conn and err both accessible here
    doWork(conn)
}

// conn and err are NOT accessible here!
```

This is a powerful pattern because:
1. Variables have the minimal possible scope
2. Both the error case and success case can access the same `conn`
3. The outer scope is not polluted with `conn` and `err`

**Common usage patterns:**
```go
// Type assertion with scoped result
if str, ok := val.(string); ok {
    use(str)
}

// Database query with scoped row
if row := db.QueryRow(query, args...); row.Err() != nil {
    return row.Err()
} else {
    return row.Scan(dest...)
}
```

---

## Advanced Questions (Q15–Q20)

---

### Q15: How does escape analysis interact with variable scope in Go?

**Answer:**

**Escape analysis** determines whether a variable's memory should be on the stack (fast, automatically freed when function returns) or the heap (slower, garbage collected).

Scope is syntactic — it determines where a name is visible. Lifetime is dynamic — it determines when memory is needed. They often align but don't always:

**Case 1: Scope ends → variable freed from stack (common case)**
```go
func local() int {
    x := 42     // stack-allocated, freed when function returns
    return x
}
```

**Case 2: Scope ends → variable still lives on heap (closure capture)**
```go
func escape() func() int {
    x := 42     // x escapes to heap — closure captures it
    return func() int { return x }
    // Even though x's syntactic scope ends here,
    // the closure keeps the heap allocation live
}
```

**Case 3: Address returned → escapes**
```go
func addrReturn() *int {
    x := 42  // escapes to heap — address returned
    return &x
}
```

**Checking escape analysis:**
```bash
go build -gcflags="-m" . 2>&1
# ./main.go:3:2: x does not escape
# ./main.go:8:2: x escapes to heap
```

**Performance implication**: Variables in tight scopes (never captured, never addressed externally) stay on the stack. This is ~100x faster than heap allocation. Deep nesting does not cause escapes — only closure capture or address exposure does.

---

### Q16: Explain how closures capture variables in Go at a low level.

**Answer:**

A Go closure is implemented as a **struct containing a function pointer and pointers to all captured variables**. When a variable is captured by a closure, the compiler:

1. Moves the variable from the stack frame to the heap
2. All accesses (from both the outer function and the closure) go through the heap pointer

**Conceptual transformation:**
```go
// Source code:
func makeCounter() func() int {
    count := 0
    return func() int {
        count++
        return count
    }
}

// Compiler generates (conceptually):
type closureEnv_makeCounter struct {
    count int
}

func closureImpl(env *closureEnv_makeCounter) int {
    env.count++
    return env.count
}

func makeCounter() func() int {
    env := &closureEnv_makeCounter{count: 0}  // heap allocated
    return func() int { return closureImpl(env) }
}
```

**Multiple closures sharing a variable:**
```go
func shared() (inc, dec func()) {
    n := 0  // single heap location
    inc = func() { n++ }  // both point to same heap n
    dec = func() { n-- }
    return
}
```

**Why this matters for shadowing:** When you shadow a variable inside a closure, the inner variable is separate from the outer:
```go
n := 0
inner := func() {
    n := 1    // new local n — does NOT modify outer n
    _ = n
}
inner()
fmt.Println(n) // still 0
```

---

### Q17: What does the Go memory model say about closure-captured variables accessed from multiple goroutines?

**Answer:**

The Go Memory Model does NOT guarantee visibility of writes to closure-captured variables across goroutines without synchronization, even though the variable is in scope for both.

**Data race example:**
```go
var done bool

go func() {
    done = true  // write in goroutine
}()

for !done {     // read in main goroutine — DATA RACE!
    runtime.Gosched()
}
```

Even though `done` is captured by reference and syntactically visible, the memory model requires explicit happens-before relationships for visibility:

**Correct patterns:**

Pattern 1: Channel synchronization
```go
doneCh := make(chan struct{})
go func() {
    close(doneCh)  // send on channel creates happens-before
}()
<-doneCh  // receive happens-after the close
```

Pattern 2: sync/atomic
```go
var done int32
go func() {
    atomic.StoreInt32(&done, 1)
}()
for atomic.LoadInt32(&done) == 0 {
    runtime.Gosched()
}
```

Pattern 3: sync.WaitGroup / sync.Mutex

**The key insight**: Scope determines visibility (can you name the variable), but the memory model determines safety (can you read/write without a race). You need both.

---

### Q18: How does the Go compiler handle named return values, and how can they be accidentally shadowed?

**Answer:**

Named return values are variables declared in the function signature with function scope. They can be returned by bare `return` statements.

**Normal usage:**
```go
func divide(a, b float64) (result float64, err error) {
    if b == 0 {
        err = errors.New("division by zero")
        return  // bare return: returns result=0, err=<error>
    }
    result = a / b
    return  // bare return: returns computed result, nil
}
```

**Shadowing trap:**
```go
func fetchData() (data []byte, err error) {
    // BUG: data and err are named returns, but := creates new variables!
    if data, err := readFromDB(); err != nil {  // NEW data, NEW err
        return nil, err  // explicit return — OK
    } else {
        // Here 'data' refers to inner data (from readFromDB)
        // Named return 'data' was never assigned!
        return data, nil  // returns inner data
    }
    // If neither branch executes (impossible here, but conceptually):
    // named return data = nil, err = nil
}

// CORRECT:
func fetchDataCorrect() (data []byte, err error) {
    data, err = readFromDB()  // assigns to named returns
    return
}
```

**Defer interaction with named returns:**
```go
func withDefer() (result int, err error) {
    defer func() {
        if err != nil {
            result = -1  // can modify named returns!
        }
    }()
    result, err = compute()
    return  // defer runs AFTER return evaluates named returns
}
```

**Interview tip**: Named returns are one of the more subtle scope features. The key: always use `=` (not `:=`) when you want to assign to a named return value inside a nested block.

---

### Q19: How does the `go/types` package represent scope, and how would you use it to build a shadow detector?

**Answer:**

The `go/types` package represents scope as a chain of `*types.Scope` objects, each containing a map of names to `types.Object` values.

**Core types:**
```go
// types.Scope methods:
func (s *Scope) Lookup(name string) Object    // search THIS scope only
func (s *Scope) LookupParent(name string, pos token.Pos) (*Scope, Object)  // search chain
func (s *Scope) Parent() *Scope               // enclosing scope
func (s *Scope) Names() []string              // all names in this scope
```

**Building a shadow detector:**
```go
func findShadows(pass *analysis.Pass) {
    for ident, obj := range pass.TypesInfo.Defs {
        if ident.Name == "_" {
            continue  // blank identifier never shadows
        }

        declScope := obj.Parent()
        if declScope == nil {
            continue
        }

        // Walk up the scope chain
        for outer := declScope.Parent(); outer != nil; outer = outer.Parent() {
            outerObj := outer.Lookup(ident.Name)
            if outerObj == nil {
                continue
            }

            // Found a shadow!
            fmt.Printf("%s shadows %s (declared at %s)\n",
                pass.Fset.Position(ident.Pos()),
                ident.Name,
                pass.Fset.Position(outerObj.Pos()))
            break
        }
    }
}
```

**Key distinction:**
- `scope.Lookup(name)` — searches ONLY this scope
- `scope.LookupParent(name, pos)` — searches this scope AND all ancestors

The shadow detector needs to use `Lookup` (not `LookupParent`) at each level to find specifically where a name is declared in the chain.

---

### Q20: What are the real-world consequences of the goroutine loop capture bug, and describe a production scenario where it caused a serious issue.

**Answer:**

**The Bug:**
```go
for _, user := range users {
    go func() {
        sendEmail(user.Email)  // captures user by reference
    }()
}
// All goroutines see the last user in the slice
// Only the last user gets emails (or all emails go to the last user)
```

**Production Scenario: Email Notification Service**

Imagine an e-commerce platform sending order confirmation emails:

```go
// BUG in production (pre-1.22):
func sendOrderConfirmations(orders []Order) {
    var wg sync.WaitGroup
    for _, order := range orders {
        wg.Add(1)
        go func() {
            defer wg.Done()
            email := buildEmail(order)     // captures order by ref
            if err := emailClient.Send(email); err != nil {
                log.Printf("email failed: %v", err)
            }
        }()
    }
    wg.Wait()
}

// Result: If processing 100 orders:
// - 99 customers receive no confirmation email
// - 1 customer (last order) receives 100 confirmation emails
// - Customer service is flooded with complaints
// - Regulatory compliance issues (customers not notified of purchases)
```

**Real consequences documented in the wild:**
1. Email duplication: One user gets N emails instead of 1
2. Data not saved: Database writes go to the wrong record
3. Cache poisoning: All cache entries point to the same key
4. HTTP request confusion: All goroutines serve the same response

**The fix applied:**
```go
func sendOrderConfirmationsFixed(orders []Order) {
    var wg sync.WaitGroup
    for _, order := range orders {
        order := order  // pre-1.22 fix
        wg.Add(1)
        go func() {
            defer wg.Done()
            email := buildEmail(order)
            if err := emailClient.Send(email); err != nil {
                log.Printf("email failed for order %s: %v", order.ID, err)
            }
        }()
    }
    wg.Wait()
}
```

**Prevention (modern)**: Use Go 1.22, run `go test -race ./...` regularly, and enable the `loopclosure` vet check in CI.

---

## Coding Challenge Questions (Q21–Q25)

---

### Q21: Fix this function — what's wrong, and what is the output vs expected?

```go
func getPositives(nums []int) []int {
    result := []int{}
    for _, n := range nums {
        if n > 0 {
            result := append(result, n)
            _ = result
        }
    }
    return result
}
```

**Answer:**

**Bug:** `result := append(result, n)` uses `:=` which creates a new `result` inside the if block. The outer `result` (the one being returned) is never modified.

**Output:** Always returns `[]int{}` (empty slice), regardless of input.

**Fix:**
```go
func getPositives(nums []int) []int {
    result := []int{}
    for _, n := range nums {
        if n > 0 {
            result = append(result, n)  // = not :=
        }
    }
    return result
}
```

---

### Q22: What does this print? Explain step by step.

```go
x := "global"
func() {
    fmt.Println(x) // line A
    x := "inner"
    fmt.Println(x) // line B
}()
fmt.Println(x) // line C
```

**Answer:**

- **Line A**: `"global"` — the closure captures the outer `x` by reference. At this point, the outer `x = "global"`.
- **Line B**: `"inner"` — `x := "inner"` creates a new `x` in the function literal's scope. From this point, `x` inside the closure refers to the inner variable.
- **Line C**: `"global"` — the outer `x` was never modified. The `x := "inner"` inside the closure is a separate variable.

Output:
```
global
inner
global
```

---

### Q23: There is a security bug in this code. Find and fix it.

```go
func authorize(token string, admin bool) bool {
    canAccess := false

    if token != "" {
        canAccess := validateToken(token)
        if admin {
            canAccess := checkAdminPrivileges(token)
            _ = canAccess
        }
        _ = canAccess
    }

    return canAccess
}
```

**Answer:**

**Bug:** `canAccess` is shadowed twice. The outer `canAccess` (initialized to `false`) is never updated. The function always returns `false` — but it should return the result of `validateToken`.

**Security Impact:** All access is denied regardless of token validity — OR, if the intent was to grant access conditionally, the security check is bypassed.

**Fix:**
```go
func authorize(token string, admin bool) bool {
    if token == "" {
        return false
    }

    if !validateToken(token) {
        return false
    }

    if admin {
        return checkAdminPrivileges(token)
    }

    return true
}
```

---

### Q24: How many different variables named `x` exist in this function, and what are their values when printed?

```go
func puzzle() {
    x := 1
    {
        x := x + 1  // note: uses outer x on right side
        {
            x := x + 1  // note: uses the x from the block above
            fmt.Println(x) // A
        }
        fmt.Println(x) // B
    }
    fmt.Println(x) // C
}
```

**Answer:**

There are **3 different variables** named `x`:
- Outer `x`: value `1`
- Middle `x`: value `2` (outer x + 1)
- Inner `x`: value `3` (middle x + 1)

Output:
```
3  (A: inner x)
2  (B: middle x)
1  (C: outer x)
```

**Key insight:** The right-hand side of `x := x + 1` is evaluated using the **current scope at that point** — before the new `x` is declared. So the right-hand `x` refers to the outer `x`.

---

### Q25: What is wrong with this concurrent code? How do you fix it for Go 1.21? For Go 1.22?

```go
func fetchAll(urls []string) []string {
    results := make([]string, len(urls))
    var wg sync.WaitGroup

    for i, url := range urls {
        wg.Add(1)
        go func() {
            defer wg.Done()
            resp, err := http.Get(url)
            if err != nil {
                results[i] = "error"
                return
            }
            defer resp.Body.Close()
            body, _ := io.ReadAll(resp.Body)
            results[i] = string(body)
        }()
    }

    wg.Wait()
    return results
}
```

**Answer:**

**Bugs:**
1. `url` and `i` are captured by reference — all goroutines may see the same (final) values
2. No mutex protecting `results` slice writes (though writing to different indices is safe in Go, it's still good practice to be explicit)

**Fix for Go 1.21:**
```go
for i, url := range urls {
    i, url := i, url  // create per-iteration copies
    wg.Add(1)
    go func() {
        defer wg.Done()
        resp, err := http.Get(url)
        if err != nil {
            results[i] = "error"
            return
        }
        defer resp.Body.Close()
        body, _ := io.ReadAll(resp.Body)
        results[i] = string(body)
    }()
}
```

**Fix for Go 1.22:**
```go
// go.mod: go 1.22
// No change needed to the goroutine — i and url are per-iteration automatically
// But you can also use the explicit argument form for clarity:
for i, url := range urls {
    wg.Add(1)
    go func(idx int, u string) {
        defer wg.Done()
        resp, err := http.Get(u)
        if err != nil {
            results[idx] = "error"
            return
        }
        defer resp.Body.Close()
        body, _ := io.ReadAll(resp.Body)
        results[idx] = string(body)
    }(i, url)
}
```

---

## Quick-Fire Round

| Question | Answer |
|----------|--------|
| Does shadowing cause a compile error? | No — it compiles silently |
| Is `err` special in Go's scope rules? | No — `err` follows the same rules as any other variable |
| Can you shadow `true`? | Yes, but you should never do it |
| What flag detects shadowing? | `go vet -vettool=$(which shadow) ./...` |
| Does `:=` always create a new variable? | In a new scope yes; in the same scope with multiple vars, existing vars are reassigned |
| What Go version fixed the loop variable bug? | Go 1.22 |
| Is import package-scoped or file-scoped? | File-scoped |
| Can a constant be shadowed? | Yes, constants can be shadowed just like variables |
| What is the blank identifier's scope? | `_` has no scope — it's never declared and never shadows |
| What does `i := i` do in a loop body? | Creates a per-iteration copy of `i` (pre-1.22 workaround) |

---

## Behavioral Questions

**"Tell me about a time you caused a bug related to variable scope."**

Good answer structure:
1. Briefly describe the context (production system, code review, etc.)
2. What specifically happened (shadow with `:=`, goroutine capture, etc.)
3. How you discovered it (linter, test failure, production incident, etc.)
4. What you did to fix it
5. What you changed in your process to prevent it (enabled linters, wrote tests, etc.)

**"How would you teach a junior developer about Go variable shadowing?"**

Good points to cover:
- Use the address-printing trick to show concretely they are different variables
- Explain `:=` as "declaration" not "assignment"
- Show the difference between `=` and `:=` in sequential error handling
- Enable linters from day one in their editor
- Pair program through a real shadow bug

---

## Interview Tips

### What interviewers are really testing:

1. **Understanding vs memorization**: Can you derive WHY shadowing happens from first principles (scope chain, `:=` semantics)?

2. **Production awareness**: Do you know the real-world impact? (silent security bugs, error swallowing, goroutine data corruption)

3. **Tooling knowledge**: Do you know `go vet`, `golangci-lint`, and how to configure them?

4. **Go 1.22 awareness**: Have you kept up with recent Go changes?

5. **Code quality mindset**: Do you treat shadow warnings as serious bugs or minor style issues?

### Red flags interviewers watch for:

- "Shadowing is just a style issue" — No, it causes real bugs
- Not knowing the difference between `=` and `:=`
- Unaware of `go vet` or linters
- No knowledge of Go 1.22 loop change
- Can't trace through code with multiple scopes

### Pro tips for the interview:

- When shown code with a bug, **trace through it step by step** rather than guessing
- Use the phrase "innermost scope wins" to explain resolution
- Mention `go vet -shadow` and `golangci-lint` proactively — shows tool awareness
- Mention Go 1.22 — shows you follow Go development
