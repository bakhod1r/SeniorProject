# continue Statement — Specification
> Source: [Go Language Specification](https://go.dev/ref/spec) — §Continue_statements

---

## 1. Spec Reference

The `continue` statement is defined in the Go Language Specification at:

https://go.dev/ref/spec#Continue_statements

Official spec text:
> "A 'continue' statement begins the next iteration of the innermost enclosing 'for' loop by advancing control to the end of the loop's block. The 'for' loop must be within the same function."

And for the labeled form:
> "If there is a label, it must be that of an enclosing 'for' statement, and that is the one whose execution advances."

---

## 2. Formal Grammar

From the Go Language Specification:

```ebnf
ContinueStmt = "continue" [ Label ] .
Label        = identifier .
LabeledStmt  = Label ":" Statement .
```

Valid forms:

```go
continue         // without label — continues innermost for loop
continue MyLabel // with label — continues the for loop labeled MyLabel
```

---

## 3. Core Rules & Constraints

1. `continue` may only appear inside a `for` statement (including `for`, `for condition`, and `for range`).
2. `continue` outside a `for` loop is a **compile-time error**.
3. Without a label, `continue` terminates the current iteration of the **innermost** enclosing `for` loop.
4. With a label, the label must refer to an enclosing `for` statement — **not** a `switch`, `select`, or any other statement.
5. A label on a non-`for` statement used with `continue` is a **compile-time error**.
6. The label must be **in the same function** as the `continue` statement.
7. `continue` causes execution to jump to the **post statement** of the `for` loop (the third clause in `for init; cond; post { }`).
8. For `for range` loops, `continue` causes the loop to advance to the next element.
9. `continue` within a `switch` or `select` nested inside a `for` loop continues the **for** loop, not the `switch`/`select`.
10. Labels are function-scoped — two different functions may use the same label name.

---

## 4. Type Rules

`continue` is a **statement**, not an expression. It has no type and produces no value.

The label identifier follows standard Go identifier rules:
- Unicode letters and digits, starting with a letter or underscore.
- Labels have their own namespace and do not conflict with variable names.
- An unused label is a **compile-time error** (unlike unused variables, this applies only in some versions — see below).

Note: Go does **not** produce a compile error for declared but unused labels in all versions. As of current Go, an unused label (a label with no corresponding `goto`, `break`, or `continue`) produces a **compile-time error**: "label X defined and not used".

---

## 5. Behavioral Specification

### Without label

When `continue` executes inside a `for` loop without a label:

1. Any remaining statements in the current loop body are skipped.
2. Control transfers to the **post statement** of the `for` clause (if present).
3. The condition is evaluated.
4. If true, the loop body executes again from the top.

```
for init; condition; post {
    // ...
    continue   ←─────── jumps here ─────────────┐
    // ...skipped              ↓                  │
}              ←── post runs, condition checked ──┘
```

For `for range`:
```
for i, v := range slice {
    // ...
    continue   ←── advances to next element
    // ...skipped
}
```

### With label

```go
Outer:
for i := 0; i < 3; i++ {
    for j := 0; j < 3; j++ {
        if j == 1 {
            continue Outer  // skips rest of inner loop AND advances outer loop's post statement
        }
        fmt.Printf("(%d,%d) ", i, j)
    }
}
// Output: (0,0) (1,0) (2,0)
```

When `continue Outer` executes:
1. The inner loop's remaining body is skipped.
2. The inner loop itself is exited entirely.
3. The outer loop's post statement (`i++`) executes.
4. The outer loop's condition is checked.

### continue inside switch nested in for

```go
for i := 0; i < 5; i++ {
    switch i {
    case 2:
        continue // continues the FOR loop, not the switch
    }
    fmt.Println(i) // prints 0, 1, 3, 4
}
```

This is a key distinction from languages like Java where `continue` cannot be used inside a `switch`.

### continue inside select nested in for

```go
ch := make(chan int, 3)
ch <- 1; ch <- 2; ch <- 3
close(ch)

for {
    select {
    case v, ok := <-ch:
        if !ok {
            goto done
        }
        if v == 2 {
            continue // continues the enclosing for loop
        }
        fmt.Println(v)
    }
}
done:
```

---

## 6. Defined vs Undefined Behavior

| Situation | Behavior |
|-----------|----------|
| `continue` inside `for` | Defined — advances to post statement |
| `continue` inside `for range` | Defined — advances to next element |
| `continue` inside `switch` in `for` | Defined — continues the `for` loop |
| `continue` inside `select` in `for` | Defined — continues the `for` loop |
| `continue` outside any `for` loop | **Compile-time error** |
| `continue Label` where label is on `switch` | **Compile-time error** |
| `continue Label` where label is on `if` | **Compile-time error** |
| `continue Label` where label is undeclared | **Compile-time error** |
| `continue Label` in different function than label | **Compile-time error** |
| Label declared but never used | **Compile-time error** |
| Deferred functions before `continue` | Defined — defers are NOT run on `continue` (only on function return) |

---

## 7. Edge Cases from Spec

### continue does NOT trigger deferred functions

```go
for i := 0; i < 3; i++ {
    defer fmt.Println("deferred", i) // accumulates, runs at function return
    if i == 1 {
        continue // deferred calls are NOT run here
    }
    fmt.Println("body", i)
}
// Output:
// body 0
// body 2
// deferred 2   ← runs at function return
// deferred 1
// deferred 0
```

### continue with for-range and maps

```go
m := map[string]int{"a": 1, "b": 2, "c": 3}
for k, v := range m {
    if v < 2 {
        continue // skip entries with small values
    }
    fmt.Println(k, v)
}
```

### continue in triple-nested loops with label

```go
package main

import "fmt"

func main() {
Outer:
    for x := 0; x < 3; x++ {
        for y := 0; y < 3; y++ {
            for z := 0; z < 3; z++ {
                if z == 0 {
                    continue Outer // skips both inner loops, advances x
                }
                fmt.Printf("(%d,%d,%d) ", x, y, z) // never prints
            }
        }
    }
}
// Output: (nothing — every z starts at 0 and immediately continues Outer)
```

### Label positioning

The label must be on the `for` statement directly. Placing it on a block or other statement is a compile error:

```go
// INVALID:
MyLabel:
{
    for i := 0; i < 5; i++ {
        continue MyLabel // error: invalid continue label MyLabel
    }
}

// VALID:
MyLabel:
for i := 0; i < 5; i++ {
    continue MyLabel // ok
}
```

### continue vs break in switch-inside-for

```go
for i := 0; i < 5; i++ {
    switch i {
    case 3:
        break    // breaks the SWITCH, not the for loop — continues to fmt.Println
    case 4:
        continue // continues the FOR loop — skips fmt.Println
    }
    fmt.Println(i) // prints 0, 1, 2, 3  (not 4)
}
```

---

## 8. Version History

| Version | Change |
|---------|--------|
| Go 1.0  | `continue` statement introduced with full label support |
| Go 1.0  | `continue` in `switch`-inside-`for` continues the `for` (same as today) |

The `continue` statement has not changed since Go 1.0.

---

## 9. Implementation-Specific Behavior

### Code generation

The `continue` statement is compiled to an unconditional jump instruction targeting the loop's post-statement label. For `for range` loops over slices and arrays, the post statement increments an internal counter. For `for range` over maps, the runtime's `mapiternext` is called.

### Interaction with the garbage collector

`continue` does not affect garbage collection. Variables declared inside the loop body that go out of scope due to `continue` may be collected at any point thereafter, per the Go memory model.

### Inlining

Function calls inside the loop body before `continue` are subject to normal inlining rules. `continue` itself has no special interaction with the inliner.

---

## 10. Spec Compliance Checklist

- [ ] `continue` is only used inside `for` statements
- [ ] Labeled `continue` uses a label that is on an enclosing `for` statement (not `switch`/`select`/`if`)
- [ ] All declared labels are referenced (no unused label compile errors)
- [ ] The distinction between `continue` (for loop) and `break` (switch) is understood when using switch-inside-for
- [ ] Deferred functions are not expected to run on `continue`
- [ ] Labels use PascalCase or ALL_CAPS by convention (e.g., `Outer`, `Loop`, `OUTER`)
- [ ] Deeply nested loops with labeled `continue` are documented for clarity

---

## 11. Official Examples

### Basic continue

```go
package main

import "fmt"

func main() {
    // Print only odd numbers
    for i := 0; i < 10; i++ {
        if i%2 == 0 {
            continue // skip even numbers
        }
        fmt.Println(i) // 1 3 5 7 9
    }
}
```

### Continue in for-range

```go
package main

import "fmt"

func main() {
    words := []string{"hello", "", "world", "", "go"}

    var result []string
    for _, w := range words {
        if w == "" {
            continue // skip empty strings
        }
        result = append(result, w)
    }
    fmt.Println(result) // [hello world go]
}
```

### Labeled continue for nested loops

```go
package main

import "fmt"

func main() {
    matrix := [][]int{
        {1, 2, 3},
        {4, -1, 6}, // row with negative number
        {7, 8, 9},
    }

    // Print only rows with no negative numbers
    fmt.Println("Rows with all non-negative values:")
Rows:
    for i, row := range matrix {
        for _, val := range row {
            if val < 0 {
                fmt.Printf("  Skipping row %d (has negative)\n", i)
                continue Rows
            }
        }
        fmt.Printf("  Row %d: %v\n", i, row)
    }
    // Skipping row 1 (has negative)
    // Row 0: [1 2 3]
    // Row 2: [7 8 9]
}
```

### Continue in switch-inside-for

```go
package main

import "fmt"

func classify(nums []int) {
    for _, n := range nums {
        switch {
        case n < 0:
            fmt.Printf("%d is negative, skipping\n", n)
            continue // continues the for loop
        case n == 0:
            fmt.Printf("%d is zero, skipping\n", n)
            continue // continues the for loop
        }
        // Only reached for positive numbers
        fmt.Printf("%d is positive\n", n)
    }
}

func main() {
    classify([]int{-2, 0, 3, -1, 5})
    // -2 is negative, skipping
    // 0 is zero, skipping
    // 3 is positive
    // -1 is negative, skipping
    // 5 is positive
}
```

### Continue with for-range over channel

```go
package main

import "fmt"

func main() {
    ch := make(chan int, 10)
    for i := 0; i < 10; i++ {
        ch <- i
    }
    close(ch)

    sum := 0
    for v := range ch {
        if v%3 == 0 {
            continue // skip multiples of 3
        }
        sum += v
    }
    fmt.Println("sum:", sum) // 1+2+4+5+7+8 = 27
}
```

### Multi-level labeled continue

```go
package main

import "fmt"

func findPairs(limit int) {
    fmt.Printf("Pairs (a,b) where a+b is prime, up to %d:\n", limit)
Outer:
    for a := 2; a <= limit; a++ {
        for b := 2; b <= limit; b++ {
            sum := a + b
            for d := 2; d < sum; d++ {
                if sum%d == 0 {
                    continue Outer // sum is not prime, try next a
                }
            }
            fmt.Printf("  (%d, %d) -> sum %d\n", a, b, sum)
            continue Outer // found one pair for this a, move on
        }
    }
}

func main() {
    findPairs(6)
}
```

---

## 12. Related Spec Sections

| Section | URL |
|---------|-----|
| Continue statements | https://go.dev/ref/spec#Continue_statements |
| For statements | https://go.dev/ref/spec#For_statements |
| Break statements | https://go.dev/ref/spec#Break_statements |
| Goto statements | https://go.dev/ref/spec#Goto_statements |
| Labeled statements | https://go.dev/ref/spec#Labeled_statements |
| Switch statements | https://go.dev/ref/spec#Switch_statements |
| Select statements | https://go.dev/ref/spec#Select_statements |
| Terminating statements | https://go.dev/ref/spec#Terminating_statements |
