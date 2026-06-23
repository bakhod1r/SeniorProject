# Go Specification: For Loop

**Source:** https://go.dev/ref/spec#For_statements
**Sections:** For statements, For statements with single condition, For statements with ForClause, For statements with range clause

---

## 1. Spec Reference

| Field | Value |
|-------|-------|
| **Official Spec** | https://go.dev/ref/spec#For_statements |
| **For (condition)** | https://go.dev/ref/spec#For_statements_with_single_condition |
| **For (ForClause)** | https://go.dev/ref/spec#For_statements_with_for_clause |
| **For (RangeClause)** | https://go.dev/ref/spec#For_statements_with_range_clause |
| **Go Version** | Go 1.0+ (loop variable semantics changed in Go 1.22) |

Official definition from the spec:

> "A 'for' statement specifies repeated execution of a block. There are three forms: The iteration may be controlled by a single condition, a 'for' clause, or a 'range' clause."

> "In its simplest form, a 'for' statement specifies the repeated execution of a block as long as a boolean condition evaluates to true. The condition is evaluated before each iteration. If the condition is absent, it is equivalent to the boolean value true."

---

## 2. Formal Grammar (EBNF)

From the Go Language Specification:

```ebnf
ForStmt     = "for" [ Condition | ForClause | RangeClause ] Block .
Condition   = Expression .

ForClause   = [ InitStmt ] ";" [ Condition ] ";" [ PostStmt ] .
InitStmt    = SimpleStmt .
PostStmt    = SimpleStmt .

RangeClause = [ ExpressionList "=" | IdentifierList ":=" ] "range" Expression .
```

Where:
- `Condition` must evaluate to type `bool`. If the condition is absent entirely (bare `for {}`), it is equivalent to the boolean value `true`.
- `ForClause` is the C-style three-component form: init; condition; post.
- `InitStmt` is a `SimpleStmt` executed once before the first iteration.
- `PostStmt` is a `SimpleStmt` executed after each iteration of the loop body (but before re-evaluating the condition).
- `RangeClause` iterates over arrays, slices, strings, maps, channels, integers, or functions.
- `Block` is a curly-brace enclosed list of statements -- always required.

**The three forms at a glance:**

```
for condition { }                          // condition-only (while-like)
for init; condition; post { }              // ForClause (C-style)
for range_clause { }                       // RangeClause (iterator)
for { }                                    // infinite loop (condition absent = true)
```

---

## 3. Core Rules & Constraints

### 3.1 Go Has Only `for` -- No `while` or `do-while`

Go unifies all loop constructs under the single keyword `for`. There is no `while`, `do-while`, or `loop` keyword. Every looping pattern expressible in other languages maps to one of the `for` forms.

```go
package main

import "fmt"

func main() {
    // "while" equivalent: condition-only for
    i := 0
    for i < 5 {
        fmt.Println(i)
        i++
    }

    // "infinite loop" equivalent: bare for
    count := 0
    for {
        if count >= 3 {
            break
        }
        fmt.Println("infinite:", count)
        count++
    }

    // "do-while" equivalent: for + break at end
    j := 0
    for {
        fmt.Println("do-while:", j)
        j++
        if j >= 3 {
            break
        }
    }
}
```

### 3.2 Three Forms of the `for` Statement

**Form 1 -- Condition-only (while-like):**

```go
package main

import "fmt"

func main() {
    n := 1
    for n < 1000 {
        n *= 2
    }
    fmt.Println(n) // 1024
}
```

**Form 2 -- ForClause (C-style three-component):**

```go
package main

import "fmt"

func main() {
    for i := 0; i < 5; i++ {
        fmt.Println(i)
    }
}
```

**Form 3 -- RangeClause (iterator):**

```go
package main

import "fmt"

func main() {
    for i, v := range []int{10, 20, 30} {
        fmt.Printf("index=%d value=%d\n", i, v)
    }
}
```

**Form 4 -- Infinite loop (no condition):**

```go
package main

import "fmt"

func main() {
    tick := 0
    for {
        tick++
        if tick == 5 {
            break
        }
    }
    fmt.Println("ticks:", tick) // 5
}
```

### 3.3 Init and Post Statements in ForClause

The `InitStmt` is executed once before the loop begins. The `PostStmt` is executed after each iteration of the loop body and before re-evaluating the condition. Both are optional.

The `InitStmt` must be a `SimpleStmt`: a short variable declaration (`:=`), assignment, send statement, increment/decrement, or expression statement.

The `PostStmt` must also be a `SimpleStmt`, but it **must not** be a short variable declaration.

```go
package main

import "fmt"

func main() {
    // Full ForClause: init + condition + post
    for i := 0; i < 5; i++ {
        fmt.Println(i)
    }

    // Init and post can be omitted (equivalent to condition-only)
    j := 0
    for ; j < 5; {
        fmt.Println(j)
        j++
    }

    // Only init present
    for k := 0; ; k++ {
        if k >= 3 {
            break
        }
        fmt.Println(k)
    }

    // Multiple assignments in init and post
    for i, j := 0, 10; i < j; i, j = i+1, j-1 {
        fmt.Printf("i=%d j=%d\n", i, j)
    }
}
```

**Post statement restriction -- no short variable declarations:**

```go
// for i := 0; i < 10; j := i + 1 { }  // compile error: cannot declare in post statement
```

### 3.4 Infinite Loop: `for {}`

When the condition is entirely absent, the loop runs indefinitely. The only way to exit is via `break`, `return`, `goto`, or a runtime panic.

```go
package main

import "fmt"

func main() {
    i := 0
    for {
        if i >= 5 {
            break
        }
        fmt.Println(i)
        i++
    }
}
```

### 3.5 Variable Scoping in For Loops

Variables declared in the `InitStmt` of a ForClause (or in the RangeClause with `:=`) are scoped to the entire `for` statement, including the condition, post statement, and body. They are not accessible outside the loop.

```go
package main

import "fmt"

func main() {
    for i := 0; i < 3; i++ {
        fmt.Println(i)
    }
    // fmt.Println(i) // compile error: undefined: i

    // Variable declared before the loop is accessible after
    sum := 0
    for j := 1; j <= 10; j++ {
        sum += j
    }
    fmt.Println("sum:", sum) // 55
}
```

### 3.6 Go 1.22 Loop Variable Semantics Change (Per-Iteration vs Per-Loop)

**This is one of the most significant changes in Go's history.**

Before Go 1.22, loop variables declared with `:=` in `for` statements were created once and reused across all iterations (per-loop semantics). This led to a notorious class of bugs when closures or goroutines captured the loop variable.

Starting with Go 1.22, each iteration of a `for` loop creates fresh variables (per-iteration semantics). This change applies to both ForClause and RangeClause forms.

**The change is controlled by the `go` directive in `go.mod`:**
- `go 1.21` or earlier: per-loop variable semantics (old behavior)
- `go 1.22` or later: per-iteration variable semantics (new behavior)

```go
package main

import "fmt"

func main() {
    // --- Per-loop semantics (Go < 1.22) ---
    // All closures would capture the SAME variable 'i',
    // so they would all print the final value (3).

    // --- Per-iteration semantics (Go >= 1.22) ---
    // Each closure captures its OWN copy of 'i',
    // so they print 0, 1, 2.

    funcs := make([]func(), 3)
    for i := 0; i < 3; i++ {
        funcs[i] = func() {
            fmt.Println(i)
        }
    }

    // Go 1.22+: prints 0, 1, 2
    // Go 1.21-: prints 3, 3, 3
    for _, f := range funcs {
        f()
    }
}
```

**Pre-1.22 workaround (shadow the variable):**

```go
package main

import "fmt"

func main() {
    funcs := make([]func(), 3)
    for i := 0; i < 3; i++ {
        i := i // re-declare i to capture a distinct copy per iteration
        funcs[i] = func() {
            fmt.Println(i)
        }
    }
    for _, f := range funcs {
        f() // prints 0, 1, 2 even in Go < 1.22
    }
}
```

**The same change applies to goroutines:**

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 5; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            fmt.Println(i) // Go 1.22+: each goroutine sees its own i
        }()
    }
    wg.Wait()
}
```

### 3.7 The Condition Must Be Boolean

Like all conditional expressions in Go, the condition in a `for` statement must be of type `bool`. There is no implicit truthiness conversion from integers, pointers, or other types.

```go
package main

import "fmt"

func main() {
    // Valid: explicit boolean expression
    for i := 10; i > 0; i-- {
        fmt.Println(i)
    }

    // Invalid: non-boolean condition
    // for i := 10; i; i-- { }  // compile error: non-boolean condition in for statement
}
```

---

## 4. Type Rules

### 4.1 ForClause Type Rules

- The `InitStmt` can declare variables of any type using `:=`.
- The `Condition` must evaluate to `bool`.
- The `PostStmt` can operate on any type (increment, assignment, function call, etc.).
- Variables declared in `InitStmt` follow standard short variable declaration type inference rules.

```go
package main

import "fmt"

func main() {
    // Multiple variables of different types in init
    for i, s := 0, ""; i < 5; i++ {
        s += fmt.Sprintf("%d", i)
        fmt.Println(s)
    }
}
```

### 4.2 Condition Expression Type

The condition must be of untyped boolean or type `bool`. Named boolean types are also allowed.

```go
package main

import "fmt"

type Flag bool

func main() {
    var active Flag = true
    count := 0
    for active {
        count++
        if count >= 3 {
            active = false
        }
    }
    fmt.Println("count:", count) // 3
}
```

### 4.3 Post Statement Restrictions

The post statement must be a `SimpleStmt` but **cannot** be a short variable declaration (`:=`). Valid post statements include:

| Post Statement Form | Example | Valid? |
|---------------------|---------|--------|
| Increment/decrement | `i++`, `i--` | Yes |
| Assignment | `i = i + 2` | Yes |
| Multiple assignment | `i, j = i+1, j-1` | Yes |
| Function call | `next()` | Yes |
| Send statement | `ch <- i` | Yes |
| Short var declaration | `j := i + 1` | No |

### 4.4 Range Clause Iteration Variable Types

When using the range form, iteration variable types are determined by the range expression type. See the sibling specification `02-for-range/specification.md` for the complete type table.

For the C-style `for` loop, the iteration variable types are whatever you declare them to be.

---

## 5. Behavioral Specification

### 5.1 Evaluation Order: init -> condition -> body -> post

The execution flow of a ForClause `for` statement is precisely defined:

1. The `InitStmt` is executed **exactly once** before anything else.
2. The `Condition` is evaluated. If `false`, the loop terminates immediately.
3. If `true`, the loop `Block` (body) executes.
4. After the body completes (without `break`/`return`), the `PostStmt` executes.
5. Go to step 2.

```go
package main

import "fmt"

func init_() int {
    fmt.Println("  [init]")
    return 0
}

func cond(i int) bool {
    fmt.Printf("  [cond] i=%d\n", i)
    return i < 3
}

func post(i *int) {
    *i++
    fmt.Printf("  [post] i=%d\n", *i)
}

func main() {
    fmt.Println("Loop execution order:")
    i := init_()
    for cond(i) {
        fmt.Printf("  [body] i=%d\n", i)
        post(&i)
    }
    // Output:
    //   [init]
    //   [cond] i=0
    //   [body] i=0
    //   [post] i=1
    //   [cond] i=1
    //   [body] i=1
    //   [post] i=2
    //   [cond] i=2
    //   [body] i=2
    //   [post] i=3
    //   [cond] i=3        <- condition false, loop exits
}
```

### 5.2 Break Statement Behavior

A `break` statement terminates the innermost `for`, `switch`, or `select` statement. In nested loops, `break` only exits the innermost loop unless a label is used.

```go
package main

import "fmt"

func main() {
    // break exits the innermost loop
    for i := 0; i < 5; i++ {
        if i == 3 {
            break
        }
        fmt.Println(i) // 0, 1, 2
    }

    // Labeled break exits the named loop
Outer:
    for i := 0; i < 3; i++ {
        for j := 0; j < 3; j++ {
            if i == 1 && j == 1 {
                break Outer
            }
            fmt.Printf("i=%d j=%d\n", i, j)
        }
    }
    // Output: i=0 j=0, i=0 j=1, i=0 j=2, i=1 j=0
}
```

### 5.3 Continue Statement Behavior

A `continue` statement skips the rest of the loop body and proceeds to the `PostStmt` (in ForClause) or the next iteration (in condition-only or range forms).

```go
package main

import "fmt"

func main() {
    // continue skips to post statement, then re-checks condition
    for i := 0; i < 10; i++ {
        if i%2 == 0 {
            continue // skip even numbers
        }
        fmt.Println(i) // 1, 3, 5, 7, 9
    }

    // Labeled continue in nested loops
Outer:
    for i := 0; i < 3; i++ {
        for j := 0; j < 3; j++ {
            if j == 1 {
                continue Outer // skip to next i
            }
            fmt.Printf("i=%d j=%d\n", i, j)
        }
    }
    // Output: i=0 j=0, i=1 j=0, i=2 j=0
}
```

### 5.4 Goto Behavior in Loops

A `goto` statement can jump to a label within the same function. However, a `goto` statement **must not** jump over variable declarations or jump into a block from outside it.

```go
package main

import "fmt"

func main() {
    i := 0
Loop:
    if i >= 5 {
        goto Done
    }
    fmt.Println(i)
    i++
    goto Loop
Done:
    fmt.Println("done")
}
```

### 5.5 Compile-Time vs Run-Time Behavior

**Compile-time checks:**
- The condition must be of type `bool` (or absent).
- `InitStmt` and `PostStmt` must be valid `SimpleStmt` forms.
- `PostStmt` must not be a short variable declaration.
- Variables declared in `InitStmt` must not conflict with outer scope names (shadowing is allowed but triggers `go vet` warnings in some cases).
- Labels used with `break`/`continue` must refer to an enclosing `for` statement.

**Run-time behavior:**
- The condition is re-evaluated on every iteration.
- Side effects in the condition expression occur on every evaluation.
- The loop body executes in the goroutine that entered the `for` statement.
- Stack growth is handled automatically by the Go runtime if deep recursion or large stack frames are needed inside the loop.

---

## 6. Defined vs Undefined Behavior

### 6.1 Defined Behavior

| Situation | Behavior |
|-----------|----------|
| Infinite loop `for {}` | Defined -- runs until `break`, `return`, `goto`, or panic |
| Condition absent | Defined -- equivalent to `for true {}` |
| `InitStmt` absent | Defined -- no initialization is performed |
| `PostStmt` absent | Defined -- no post-iteration action is performed |
| Both `InitStmt` and `PostStmt` absent | Defined -- equivalent to condition-only form |
| All three parts absent `for {}` | Defined -- infinite loop |
| `break` in loop body | Defined -- terminates innermost `for`/`switch`/`select` |
| `continue` in loop body | Defined -- proceeds to `PostStmt`, then re-checks condition |
| `return` in loop body | Defined -- exits the enclosing function |
| Modifying loop variable in body | Defined -- affects subsequent condition checks and post execution |
| Loop variable overflow | Defined -- follows Go integer overflow rules (wraps for unsigned, implementation-defined for signed but in practice wraps) |

### 6.2 Goroutine Capture of Loop Variables

**Pre-Go 1.22 (per-loop semantics):**

Loop variables were shared across iterations. Goroutines launched inside a loop that captured the loop variable would see unpredictable values -- typically the final value after the loop completed.

```go
// Pre-1.22: UNDEFINED in terms of which value each goroutine sees
// (data race on the shared loop variable)
for i := 0; i < 5; i++ {
    go func() {
        fmt.Println(i) // data race: i is shared, goroutine may see any value
    }()
}
```

**Post-Go 1.22 (per-iteration semantics):**

Each iteration has its own copy of the loop variable. Goroutines capture the per-iteration variable, which is safe and deterministic (though execution order of goroutines is still unspecified).

```go
// Post-1.22: each goroutine gets its own i
for i := 0; i < 5; i++ {
    go func() {
        fmt.Println(i) // safe: i is per-iteration
    }()
}
```

### 6.3 Modifying Loop Variable in Body

Modifying the loop variable inside the body is well-defined but can lead to surprising behavior:

```go
package main

import "fmt"

func main() {
    for i := 0; i < 10; i++ {
        fmt.Println(i)
        if i == 3 {
            i = 7 // skip ahead -- post statement will make i=8
        }
    }
    // Output: 0, 1, 2, 3, 8, 9
}
```

### 6.4 Side Effects in Condition

The condition is evaluated before every iteration. Side effects in the condition expression (function calls, channel receives) execute on each evaluation:

```go
package main

import "fmt"

var callCount int

func limit() int {
    callCount++
    return 5
}

func main() {
    for i := 0; i < limit(); i++ {
        // limit() is called on EVERY iteration
    }
    fmt.Println("limit() called", callCount, "times") // 6 times (5 true + 1 false)
}
```

---

## 7. Edge Cases from Spec

### 7.1 Empty For Body

An empty loop body is valid. This can be used for busy-waiting (not recommended) or when all logic is in the condition and post:

```go
package main

import "fmt"

func main() {
    // All logic in init, condition, and post
    sum := 0
    for i := 1; i <= 100; sum, i = sum+i, i+1 {
    }
    fmt.Println("sum:", sum) // 5050
}
```

### 7.2 Multiple Variables in Init and Post

The `InitStmt` can use a short variable declaration with multiple variables. The `PostStmt` can use parallel assignment to update multiple variables:

```go
package main

import "fmt"

func main() {
    for i, j := 0, 10; i < j; i, j = i+1, j-1 {
        fmt.Printf("i=%d j=%d\n", i, j)
    }
    // Output:
    // i=0 j=10
    // i=1 j=9
    // i=2 j=8
    // i=3 j=7
    // i=4 j=6
}
```

### 7.3 Condition-Only Form with Side Effects

```go
package main

import (
    "bufio"
    "fmt"
    "strings"
)

func main() {
    scanner := bufio.NewScanner(strings.NewReader("line1\nline2\nline3"))
    for scanner.Scan() {
        fmt.Println(scanner.Text())
    }
    // scanner.Scan() returns false when input is exhausted
}
```

### 7.4 Nested Loops with Labels

Labels allow `break` and `continue` to target an outer loop:

```go
package main

import "fmt"

func main() {
    matrix := [][]int{
        {1, 2, 3},
        {4, 5, 6},
        {7, 8, 9},
    }

    target := 5
    found := false
Search:
    for i := 0; i < len(matrix); i++ {
        for j := 0; j < len(matrix[i]); j++ {
            if matrix[i][j] == target {
                fmt.Printf("Found %d at [%d][%d]\n", target, i, j)
                found = true
                break Search
            }
        }
    }
    if !found {
        fmt.Println("not found")
    }
}
```

### 7.5 Loop Variable Shadowing

A loop variable can shadow an outer variable of the same name. This is well-defined but can be confusing:

```go
package main

import "fmt"

func main() {
    i := 100
    for i := 0; i < 3; i++ {
        fmt.Println("inner i:", i) // 0, 1, 2
    }
    fmt.Println("outer i:", i) // 100 -- unchanged
}
```

### 7.6 For Loop with Only Post Statement

You can omit init and condition while keeping the post statement, though the semicolons are still required:

```go
package main

import "fmt"

func main() {
    i := 0
    for ; ; i++ {
        if i >= 5 {
            break
        }
        fmt.Println(i)
    }
}
```

### 7.7 Modifying the Loop Counter in the Post Statement

The post statement can contain arbitrary logic, not just simple increments:

```go
package main

import "fmt"

func main() {
    // Exponential growth
    for i := 1; i < 1000; i *= 2 {
        fmt.Println(i) // 1, 2, 4, 8, 16, 32, 64, 128, 256, 512
    }

    // Fibonacci-like progression
    for a, b := 0, 1; a < 100; a, b = b, a+b {
        fmt.Println(a) // 0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89
    }
}
```

### 7.8 Zero Iterations

If the condition is false on first evaluation, the loop body never executes. The `InitStmt` still runs:

```go
package main

import "fmt"

func main() {
    for i := 0; i < 0; i++ {
        fmt.Println("never printed")
    }

    for false {
        fmt.Println("never printed")
    }
}
```

---

## 8. Version History

| Go Version | Change |
|------------|--------|
| Go 1.0 | `for` statement introduced with all three forms: condition-only, ForClause, RangeClause. Only looping construct in Go. |
| Go 1.4 | `for range x {}` with no iteration variables allowed (value-discard form). |
| Go 1.21 | `GOEXPERIMENT=loopvar` available as opt-in preview of per-iteration loop variable semantics. |
| Go 1.22 | **Per-iteration loop variable semantics** become the default for modules with `go 1.22` or later in `go.mod`. This is a backward-incompatible semantic change gated by the `go` directive. Range over integers (`for i := range n`) also added. |
| Go 1.23 | Range over functions (iterator protocol: `func(yield func(V) bool)`) added for `for-range`. No changes to ForClause or condition-only forms. |

### Go 1.22 Loop Variable Change in Detail

The Go 1.22 loop variable change addressed one of the most common bugs in Go programs. The change was carefully rolled out:

1. **Go 1.21:** The `GOEXPERIMENT=loopvar` build flag was made available so developers could test the new semantics before the official release.

2. **Go 1.22:** The new per-iteration semantics became the default for any package whose enclosing module declares `go 1.22` (or later) in its `go.mod` file. Packages in modules with earlier `go` directives retain the old per-loop semantics.

3. **Detection tool:** `go vet` and the `loopclosure` analyzer detect the old pattern and warn about it even in pre-1.22 code.

4. **Bisect tool:** The `golang.org/x/tools/cmd/bisect` tool was provided to help find code that behaves differently under the new semantics.

**Impact on existing code:**

```go
// go.mod contains: go 1.22

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
            results[i] = i * i // In Go 1.22+: safe, each goroutine has its own i
        }()
    }
    wg.Wait()
    fmt.Println(results) // [0 1 4 9 16]
}
```

**The same code under Go 1.21 semantics:**

```go
// go.mod contains: go 1.21

// The above code would be a data race:
// - All goroutines share the same 'i'
// - By the time goroutines execute, i == 5 (final value after loop)
// - results[5] would panic (index out of range)
// - Even without the panic, all entries would get the same value
```

---

## 9. Implementation-Specific Behavior

### 9.1 Compiler Optimizations

The `gc` compiler (the standard Go compiler) applies several optimizations to `for` loops:

**Dead code elimination:** If the condition is a compile-time constant `false`, the loop body is eliminated entirely.

```go
package main

import "fmt"

const debug = false

func main() {
    for i := 0; debug && i < 100; i++ {
        fmt.Println("debug:", i) // eliminated at compile time
    }
}
```

**Bounds check elimination (BCE):** When the compiler can prove that array/slice accesses within a loop are always within bounds, it eliminates the runtime bounds check.

```go
package main

func sum(s []int) int {
    total := 0
    for i := 0; i < len(s); i++ {
        total += s[i] // compiler may eliminate bounds check
    }
    return total
}

func main() {
    _ = sum([]int{1, 2, 3, 4, 5})
}
```

### 9.2 Loop Unrolling

The Go compiler performs limited loop unrolling for simple loops with known iteration counts. This is an implementation detail that may change between compiler versions. The programmer has no direct control over loop unrolling (there is no pragma or annotation for it).

### 9.3 Inlining

Short loop bodies may be inlined by the compiler, especially when the loop is inside a function that is itself a candidate for inlining. Use `go build -gcflags="-m"` to see inlining decisions.

### 9.4 Register Allocation

Loop variables used as indices are typically allocated to registers. The compiler may keep frequently accessed loop variables in registers across iterations to minimize memory access.

### 9.5 Per-Iteration Variable Implementation (Go 1.22+)

Under per-iteration semantics, the compiler does not literally create a new variable on each iteration in all cases. If no closure or goroutine captures the loop variable, the compiler optimizes it to a single stack slot (identical to the old behavior). The per-iteration copy is only materialized when the variable is actually captured.

---

## 10. Spec Compliance Checklist

- [ ] `for` is the only loop construct used (no `while`, `do-while`)
- [ ] Condition expression evaluates to `bool` (no implicit truthiness)
- [ ] Braces are mandatory around the loop body
- [ ] `InitStmt` in ForClause is a valid `SimpleStmt`
- [ ] `PostStmt` in ForClause is a valid `SimpleStmt` and is NOT a short variable declaration
- [ ] Variables declared in `InitStmt` are scoped to the `for` statement
- [ ] Infinite loop uses `for {}` (not `for true {}`, though both are valid)
- [ ] `break` targets the innermost `for`/`switch`/`select` unless labeled
- [ ] `continue` proceeds to `PostStmt` (ForClause) or next iteration (condition/range)
- [ ] Labeled `break`/`continue` targets the correct enclosing statement
- [ ] Closures in loops correctly capture per-iteration variables (Go 1.22+) or use shadowing workaround (pre-1.22)
- [ ] Goroutines launched in loops do not create data races on loop variables
- [ ] Side effects in the condition expression are intentional (evaluated every iteration)
- [ ] Loop variable modification in body accounts for the post statement also running
- [ ] `go.mod` `go` directive is set to `1.22` or later to get per-iteration semantics

---

## 11. Official Examples

### Example 1: All Three For-Loop Forms

```go
package main

import "fmt"

func main() {
    fmt.Println("=== Form 1: Condition-only (while-like) ===")
    n := 1
    for n < 100 {
        n *= 3
    }
    fmt.Println("n:", n) // 243

    fmt.Println("\n=== Form 2: ForClause (C-style) ===")
    for i := 0; i < 5; i++ {
        fmt.Printf("  i=%d\n", i)
    }

    fmt.Println("\n=== Form 3: RangeClause ===")
    fruits := []string{"apple", "banana", "cherry"}
    for i, fruit := range fruits {
        fmt.Printf("  fruits[%d] = %s\n", i, fruit)
    }

    fmt.Println("\n=== Form 4: Infinite loop with break ===")
    count := 0
    for {
        count++
        if count > 3 {
            break
        }
        fmt.Printf("  count=%d\n", count)
    }
    fmt.Println("  final count:", count)
}
```

**Expected output:**

```
=== Form 1: Condition-only (while-like) ===
n: 243

=== Form 2: ForClause (C-style) ===
  i=0
  i=1
  i=2
  i=3
  i=4

=== Form 3: RangeClause ===
  fruits[0] = apple
  fruits[1] = banana
  fruits[2] = cherry

=== Form 4: Infinite loop with break ===
  count=1
  count=2
  count=3
  final count: 4
```

### Example 2: Go 1.22 Per-Iteration Semantics Demonstration

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    fmt.Println("=== Closure capture in ForClause ===")
    closures := make([]func() int, 5)
    for i := 0; i < 5; i++ {
        closures[i] = func() int {
            return i // Go 1.22+: each closure captures its own i
        }
    }
    for _, fn := range closures {
        fmt.Println(fn()) // 0, 1, 2, 3, 4
    }

    fmt.Println("\n=== Goroutine capture in ForClause ===")
    var mu sync.Mutex
    var wg sync.WaitGroup
    results := make(map[int]bool)

    for i := 0; i < 5; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            mu.Lock()
            results[i] = true // Go 1.22+: each goroutine has its own i
            mu.Unlock()
        }()
    }
    wg.Wait()
    fmt.Println("results:", results) // map[0:true 1:true 2:true 3:true 4:true]

    fmt.Println("\n=== Address of loop variable ===")
    addrs := make([]*int, 3)
    for i := 0; i < 3; i++ {
        addrs[i] = &i // Go 1.22+: each &i is a different address
    }
    for idx, addr := range addrs {
        fmt.Printf("  addrs[%d] = %p, value = %d\n", idx, addr, *addr)
    }
    // Go 1.22+: all addresses are different, values are 0, 1, 2
    // Go 1.21-: all addresses are the same, values are all 3
}
```

### Example 3: Practical Patterns

```go
package main

import (
    "fmt"
    "math"
)

// Pattern 1: Retry with backoff
func retryWithBackoff(maxRetries int) {
    for attempt := 0; attempt < maxRetries; attempt++ {
        fmt.Printf("  attempt %d\n", attempt+1)
        // Simulate work that might fail
        if attempt == 2 {
            fmt.Println("  success!")
            return
        }
        // Exponential backoff would use time.Sleep here
    }
    fmt.Println("  all retries exhausted")
}

// Pattern 2: Two-pointer technique
func isPalindrome(s string) bool {
    runes := []rune(s)
    for left, right := 0, len(runes)-1; left < right; left, right = left+1, right-1 {
        if runes[left] != runes[right] {
            return false
        }
    }
    return true
}

// Pattern 3: Newton's method (condition-only loop)
func sqrt(x float64) float64 {
    z := x / 2
    for math.Abs(z*z-x) > 1e-10 {
        z = z - (z*z-x)/(2*z)
    }
    return z
}

func main() {
    fmt.Println("Pattern 1: Retry")
    retryWithBackoff(5)

    fmt.Println("\nPattern 2: Palindrome")
    words := []string{"racecar", "hello", "madam", "world"}
    for _, w := range words {
        fmt.Printf("  %q is palindrome: %v\n", w, isPalindrome(w))
    }

    fmt.Println("\nPattern 3: Newton's sqrt")
    fmt.Printf("  sqrt(2) = %.10f\n", sqrt(2))
    fmt.Printf("  sqrt(9) = %.10f\n", sqrt(9))
}
```

### Example 4: Valid and Invalid For Loop Constructs

```go
package main

import "fmt"

func main() {
    // --- Valid constructs ---

    // 1. Standard C-style
    for i := 0; i < 5; i++ {
        _ = i
    }
    fmt.Println("1. C-style: OK")

    // 2. Condition only
    x := 0
    for x < 5 {
        x++
    }
    fmt.Println("2. Condition-only: OK")

    // 3. Infinite loop
    y := 0
    for {
        y++
        if y >= 3 {
            break
        }
    }
    fmt.Println("3. Infinite loop: OK")

    // 4. Multiple variables in init and post
    for i, j := 0, 10; i < j; i, j = i+1, j-1 {
        _ = i
        _ = j
    }
    fmt.Println("4. Multiple vars: OK")

    // 5. Empty body
    sum := 0
    for i := 1; i <= 10; sum, i = sum+i, i+1 {
    }
    fmt.Println("5. Empty body, sum:", sum)

    // 6. Function call as post statement
    counter := 0
    increment := func() { counter++ }
    for i := 0; i < 5; increment() {
        _ = i
        i++ // manual increment since post doesn't change i
    }
    fmt.Println("6. Func call post: OK, counter:", counter)
}
```

**The following constructs are invalid (compile errors):**

```go
// 1. Non-boolean condition
// for 1 { }                         // compile error: non-boolean condition

// 2. Short declaration in post statement
// for i := 0; i < 10; j := i { }   // compile error: expected simple statement

// 3. Missing braces
// for i := 0; i < 5; i++            // compile error: expected '{'
//     fmt.Println(i)

// 4. Multiple statements in post (use parallel assignment instead)
// for i := 0; i < 5; i++; j++ { }  // compile error: expected '{', got ';'

// 5. Declaration in condition
// for i := 0; j := i < 5; i++ { }  // compile error
```

---

## 12. Related Spec Sections

| Section | URL | Relevance |
|---------|-----|-----------|
| For statements | https://go.dev/ref/spec#For_statements | Primary specification for all `for` forms |
| For with single condition | https://go.dev/ref/spec#For_statements_with_single_condition | Condition-only form (while-like) |
| For with ForClause | https://go.dev/ref/spec#For_statements_with_for_clause | C-style three-component form |
| For with RangeClause | https://go.dev/ref/spec#For_statements_with_range_clause | Range-based iteration |
| Break statements | https://go.dev/ref/spec#Break_statements | Terminating loop execution |
| Continue statements | https://go.dev/ref/spec#Continue_statements | Skipping to next iteration |
| Goto statements | https://go.dev/ref/spec#Goto_statements | Jumping within a function |
| Labeled statements | https://go.dev/ref/spec#Labeled_statements | Labels for break/continue targeting |
| Blocks | https://go.dev/ref/spec#Blocks | Loop body is always a block |
| Short variable declarations | https://go.dev/ref/spec#Short_variable_declarations | `:=` in InitStmt |
| Declarations and scope | https://go.dev/ref/spec#Declarations_and_scope | Scoping of loop variables |
| SimpleStmt | https://go.dev/ref/spec#SimpleStmt | Valid forms for InitStmt and PostStmt |
| Expressions | https://go.dev/ref/spec#Expressions | Condition evaluation |
| Go 1.22 release notes | https://go.dev/doc/go1.22 | Per-iteration loop variable semantics |
| Go 1.22 loopvar FAQ | https://go.dev/wiki/LoopvarExperiment | Background on the loop variable change |
