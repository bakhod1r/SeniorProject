# break Statement — Specification
> Source: [Go Language Specification](https://go.dev/ref/spec) — §Break_statements

---

## 1. Spec Reference

The `break` statement is defined in the Go Language Specification at:

https://go.dev/ref/spec#Break_statements

| Field | Value |
|-------|-------|
| Official Spec | https://go.dev/ref/spec |
| Primary Section | §Break_statements |
| Related Sections | §For_statements, §Switch_statements, §Select_statements, §Labeled_statements |
| Go Version | Go 1.0+ (unchanged since initial release) |

Official spec text:
> "A 'break' statement terminates execution of the innermost 'for', 'switch', or 'select' statement within the same function."

And for the labeled form:
> "If there is a label, it must be that of an enclosing 'for', 'switch', or 'select' statement, and that is the one whose execution terminates."

Key distinction from C/C++/Java:
> In Go, `break` in a `switch` case terminates the **switch** statement. There is no fallthrough by default, and `break` does **not** mean "stop falling through" as it does in C. Instead, Go has an explicit `fallthrough` keyword.

---

## 2. Formal Grammar (EBNF)

From the Go Language Specification:

```ebnf
BreakStmt   = "break" [ Label ] .
Label       = identifier .
LabeledStmt = Label ":" Statement .
```

### Valid syntactic forms

```go
break              // without label — terminates innermost for, switch, or select
break OuterLoop    // with label — terminates the for/switch/select labeled OuterLoop
```

### Grammar breakdown

| Component | Description |
|-----------|-------------|
| `break` | The keyword itself — always required |
| `Label` | Optional — an identifier referencing a labeled enclosing statement |
| `identifier` | A sequence of letters (including `_`) and digits, starting with a letter |

The label, if present, must refer to a `LabeledStmt` where the `Statement` is a `for`, `switch`, or `select` statement. The label must be in the same function as the `break`.

---

## 3. Core Rules & Constraints

### Rule 1: break terminates the innermost for, switch, or select

Without a label, `break` terminates the execution of the **innermost** enclosing `for`, `switch`, or `select` statement. Control passes to the statement immediately following the terminated construct.

```go
// break terminates the for loop
for i := 0; i < 10; i++ {
    if i == 5 {
        break // exits the for loop
    }
}
// execution continues here after break
```

### Rule 2: break with label terminates the labeled statement

When a label is provided, `break` terminates the `for`, `switch`, or `select` statement that the label identifies, regardless of nesting depth.

```go
Outer:
for i := 0; i < 10; i++ {
    for j := 0; j < 10; j++ {
        if i+j == 5 {
            break Outer // exits BOTH loops
        }
    }
}
// execution continues here
```

### Rule 3: Label must refer to an enclosing for, switch, or select

The label used with `break` must satisfy all of the following:
- It must be **declared** in the same function.
- It must be **attached** to a `for`, `switch`, or `select` statement.
- That statement must **enclose** the `break` statement.

```go
// INVALID — label on an if statement
MyIf:
if true {
    break MyIf // compile error: invalid break label MyIf
}

// INVALID — label on a block
MyBlock:
{
    break MyBlock // compile error: invalid break label MyBlock
}
```

### Rule 4: break cannot cross function boundaries

A `break` statement cannot break out of a function boundary. The enclosing `for`, `switch`, or `select` must be in the **same function** as the `break`.

```go
func inner() {
    break // compile error: break is not in a loop, switch, or select
}

func outer() {
    for i := 0; i < 10; i++ {
        inner() // inner's break does NOT affect outer's for loop
    }
}
```

This includes closures and anonymous functions — a `break` inside a closure does **not** affect loops outside that closure:

```go
for i := 0; i < 10; i++ {
    func() {
        break // compile error: break is not in a loop, switch, or select
    }()
}
```

### Rule 5: break in switch does NOT cause fallthrough (unlike C)

In C, `break` inside a `switch` case prevents fallthrough to the next case. In Go, there is **no implicit fallthrough** — each case body terminates automatically. Using `break` inside a `switch` case simply exits the `switch` statement early (before the end of the case body).

```go
switch x {
case 1:
    fmt.Println("one")
    // no break needed — Go does not fall through
case 2:
    fmt.Println("two")
    break // legal but redundant — same effect as reaching end of case
case 3:
    fmt.Println("three")
}
```

### Rule 6: break outside for/switch/select is a compile-time error

```go
func main() {
    break // compile error: break is not in a loop, switch, or select
}
```

### Rule 7: Unreachable code after break

Code after a `break` statement within the same block is unreachable. The Go compiler does **not** produce a compile error for unreachable code after `break` (unlike after `return`), but the code will never execute.

```go
for i := 0; i < 10; i++ {
    break
    fmt.Println(i) // unreachable — no compile error, but never runs
}
```

---

## 4. Type Rules

### break is a statement, not an expression

`break` produces no value and has no type. It cannot be used in an expression context:

```go
x := break // compile error: syntax error
```

### Label scoping rules

Labels in Go follow specific scoping rules:

1. **Labels have their own namespace** — a label name does not conflict with variable, function, type, or package names.

```go
x := 10
x: // legal — label "x" does not conflict with variable "x"
for i := 0; i < 5; i++ {
    break x // breaks the labeled for loop
}
```

2. **Labels are function-scoped** — a label is visible throughout the entire function body, regardless of where it is declared. Two labels in the same function cannot share the same name.

```go
func f() {
    Loop:
    for {
        break Loop
    }

    Loop: // compile error: label Loop already defined
    for {
        break Loop
    }
}
```

3. **Different functions may use the same label name** — labels do not conflict across function boundaries.

```go
func f() {
    Loop:
    for {
        break Loop
    }
}

func g() {
    Loop: // perfectly legal — different function
    for {
        break Loop
    }
}
```

4. **Unused labels are compile-time errors** — every declared label must be referenced by a `goto`, `break`, or `continue`.

```go
func f() {
    Unused: // compile error: label Unused defined and not used
    for {
        break
    }
}
```

### Label identifier rules

Labels follow Go's standard identifier rules:
- Must start with a Unicode letter or underscore (`_`).
- May contain Unicode letters, digits, and underscores.
- Convention: PascalCase (e.g., `OuterLoop`, `RetryLoop`) or ALL_CAPS (e.g., `OUTER`).

---

## 5. Behavioral Specification

### Normal break (no label)

When `break` executes without a label, it terminates the **innermost** enclosing `for`, `switch`, or `select` statement. The term "innermost" means the closest enclosing construct of those three types in the lexical structure.

```
for i := 0; i < N; i++ {      // <-- this is the innermost for
    if condition {
        break                   // terminates this for loop
    }
}
// control resumes here
```

### What "innermost" means with nested constructs

The "innermost" rule applies to the **nearest enclosing** `for`, `switch`, or `select`. This creates important distinctions when these constructs are nested:

**Scenario 1: switch inside for**

```go
for i := 0; i < 10; i++ {
    switch i % 3 {
    case 0:
        break // breaks the SWITCH, not the for loop
    }
    fmt.Println(i) // this STILL executes for case 0
}
```

Here, `break` terminates the `switch` (the innermost enclosing breakable statement), **not** the `for` loop. This is a common source of bugs.

**Scenario 2: select inside for**

```go
for {
    select {
    case msg := <-ch:
        if msg == "quit" {
            break // breaks the SELECT, not the for loop
        }
        process(msg)
    }
    // this STILL executes after break
}
```

Again, `break` only exits the `select`, not the `for` loop.

**Scenario 3: for inside switch**

```go
switch mode {
case "fast":
    for i := 0; i < 100; i++ {
        if done(i) {
            break // breaks the FOR loop, not the switch
        }
    }
    fmt.Println("after inner for") // this executes after break
}
```

### Labeled break — bypassing the innermost rule

The labeled form of `break` lets you specify exactly which enclosing construct to terminate:

```go
Loop:
for i := 0; i < 10; i++ {
    switch i % 3 {
    case 0:
        break Loop // breaks the FOR loop (labeled), not the switch
    }
    fmt.Println(i) // NOT reached when i%3 == 0
}
```

### Compile-time label validation

The Go compiler performs **static validation** of all labels at compile time:

1. **Existence check** — the label must be declared.
2. **Enclosure check** — the labeled statement must enclose the `break`.
3. **Statement type check** — the labeled statement must be `for`, `switch`, or `select`.
4. **Function boundary check** — the label must be in the same function.
5. **Usage check** — the label must be referenced somewhere.

All of these produce compile-time errors, never runtime errors. There is no runtime cost to labeled breaks.

### Interaction with defer

`break` does **not** trigger deferred functions. Deferred functions only execute when their enclosing **function** returns, not when a loop, switch, or select is exited.

```go
func f() {
    defer fmt.Println("function deferred") // runs at function return

    for i := 0; i < 5; i++ {
        defer fmt.Println("loop deferred", i) // accumulates, runs at function return
        if i == 2 {
            break // does NOT trigger any deferred calls
        }
    }
    fmt.Println("after loop")
}
// Output:
// after loop
// loop deferred 2
// loop deferred 1
// loop deferred 0
// function deferred
```

### Interaction with goroutines

`break` cannot cross goroutine boundaries. A `break` inside a goroutine's function only affects constructs within that function:

```go
Loop:
for i := 0; i < 10; i++ {
    go func() {
        break Loop // compile error: break is not in a loop, switch, or select
                   // (also: label Loop is in a different function)
    }()
}
```

---

## 6. Defined vs Undefined Behavior

Go's specification fully defines all behaviors related to `break`. There is no undefined behavior — violations are caught at compile time.

| Situation | Behavior |
|-----------|----------|
| `break` inside `for` | **Defined** — terminates the `for` loop |
| `break` inside `switch` | **Defined** — terminates the `switch` statement |
| `break` inside `select` | **Defined** — terminates the `select` statement |
| `break Label` where label is on enclosing `for` | **Defined** — terminates the labeled `for` |
| `break Label` where label is on enclosing `switch` | **Defined** — terminates the labeled `switch` |
| `break Label` where label is on enclosing `select` | **Defined** — terminates the labeled `select` |
| `break` outside `for`/`switch`/`select` | **Compile-time error**: "break is not in a loop, switch, or select" |
| `break Label` with non-existent label | **Compile-time error**: "undefined label Label" |
| `break Label` where label is on `if`/block/`goto` | **Compile-time error**: "invalid break label Label" |
| `break Label` where label is not enclosing | **Compile-time error**: "invalid break label Label" |
| `break Label` across function boundary | **Compile-time error** |
| `break` inside closure affecting outer loop | **Compile-time error** |
| Label declared but never referenced | **Compile-time error**: "label Label defined and not used" |
| Deferred functions on `break` | **Defined** — defers are NOT triggered (only on function return) |
| Code after `break` in same block | **Defined** — unreachable but compiles without error |

---

## 7. Edge Cases from Spec

### Edge Case 1: break in switch nested inside for (the most common pitfall)

This is the single most common mistake with `break` in Go. Developers coming from other languages expect `break` to exit the `for` loop, but it only exits the `switch`.

```go
package main

import "fmt"

func main() {
    // BUG: break exits the switch, not the for loop
    for i := 0; i < 5; i++ {
        switch i {
        case 3:
            fmt.Println("found 3, trying to exit loop...")
            break // only exits the switch!
        }
        fmt.Println("still in loop, i =", i) // this prints for ALL values including 3
    }
    fmt.Println("---")

    // FIX: use labeled break to exit the for loop
Loop:
    for i := 0; i < 5; i++ {
        switch i {
        case 3:
            fmt.Println("found 3, exiting loop...")
            break Loop // exits the for loop
        }
        fmt.Println("still in loop, i =", i) // NOT reached when i == 3
    }
}
// Output:
// found 3, trying to exit loop...
// still in loop, i = 0
// still in loop, i = 1
// still in loop, i = 2
// still in loop, i = 3
// still in loop, i = 4
// ---
// still in loop, i = 0
// still in loop, i = 1
// still in loop, i = 2
// found 3, exiting loop...
```

### Edge Case 2: Labeled break from deeply nested inner loop

```go
package main

import "fmt"

func main() {
    matrix := [][]int{
        {1, 2, 3},
        {4, 5, 6},
        {7, 0, 9}, // contains zero
        {10, 11, 12},
    }

    found := false
    var foundRow, foundCol int

Search:
    for i, row := range matrix {
        for j, val := range row {
            if val == 0 {
                found = true
                foundRow, foundCol = i, j
                break Search // exits BOTH loops immediately
            }
        }
    }

    if found {
        fmt.Printf("Zero found at [%d][%d]\n", foundRow, foundCol)
    } else {
        fmt.Println("Zero not found")
    }
}
// Output: Zero found at [2][1]
```

### Edge Case 3: break in select case (event loop pattern)

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    ch := make(chan string, 3)
    ch <- "hello"
    ch <- "world"
    ch <- "done"

    timeout := time.After(1 * time.Second)

    // break inside select only exits the select, NOT the for loop
    for {
        select {
        case msg := <-ch:
            if msg == "done" {
                fmt.Println("Received done signal")
                break // only exits the select — loop continues!
            }
            fmt.Println("Received:", msg)
        case <-timeout:
            fmt.Println("Timeout")
            break // only exits the select — loop continues!
        }
        fmt.Println("  (still in for loop)") // always reached after select
        // Without a way to exit the for loop, this runs forever
        // after all channel messages and timeout are consumed.
        break // explicit break to exit the for loop for this demo
    }
}
```

The correct pattern uses a labeled break:

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    ch := make(chan string, 3)
    ch <- "hello"
    ch <- "world"
    ch <- "done"

    timeout := time.After(1 * time.Second)

Loop:
    for {
        select {
        case msg := <-ch:
            if msg == "done" {
                fmt.Println("Received done signal, exiting loop")
                break Loop // exits the FOR loop
            }
            fmt.Println("Received:", msg)
        case <-timeout:
            fmt.Println("Timeout, exiting loop")
            break Loop // exits the FOR loop
        }
    }
    fmt.Println("Loop exited cleanly")
}
// Output:
// Received: hello
// Received: world
// Received done signal, exiting loop
// Loop exited cleanly
```

### Edge Case 4: break vs return in goroutines

`break` is purely a control flow statement for loops/switches/selects. It cannot be used to exit goroutines. To stop a goroutine, use `return`, context cancellation, or channel signaling.

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    var wg sync.WaitGroup
    done := make(chan struct{})

    wg.Add(1)
    go func() {
        defer wg.Done()
        for i := 0; ; i++ {
            select {
            case <-done:
                fmt.Println("goroutine: received done signal")
                return // use return, not break, to exit the goroutine
            default:
                if i >= 5 {
                    close(done)
                    return // return exits the goroutine
                }
                fmt.Println("goroutine: working", i)
            }
        }
    }()

    wg.Wait()
    fmt.Println("main: goroutine finished")
}
```

### Edge Case 5: break in type switch

`break` works the same way in type switches as in expression switches:

```go
package main

import "fmt"

func classify(values []interface{}) {
    for _, v := range values {
        switch v.(type) {
        case int:
            fmt.Printf("%v is int\n", v)
            break // exits the type switch (redundant, but legal)
        case string:
            fmt.Printf("%v is string\n", v)
        case nil:
            fmt.Println("nil value encountered")
            break // exits the type switch (redundant)
        default:
            fmt.Printf("%v is unknown type\n", v)
        }
    }
}

func main() {
    classify([]interface{}{42, "hello", nil, 3.14})
}
// Output:
// 42 is int
// hello is string
// nil value encountered
// 3.14 is unknown type
```

### Edge Case 6: Labeled break on switch (less common, but valid)

You can label a `switch` statement and use `break Label` to exit it. This is useful when the switch is nested inside another switch:

```go
package main

import "fmt"

func process(action string, mode int) {
OuterSwitch:
    switch action {
    case "run":
        switch mode {
        case 1:
            fmt.Println("run mode 1")
        case 2:
            fmt.Println("run mode 2 — aborting action")
            break OuterSwitch // exits the OUTER switch
        case 3:
            fmt.Println("run mode 3")
        }
        fmt.Println("after inner switch") // NOT reached when mode == 2
    case "stop":
        fmt.Println("stopping")
    }
    fmt.Println("after outer switch") // always reached
}

func main() {
    process("run", 1)
    fmt.Println("---")
    process("run", 2)
    fmt.Println("---")
    process("run", 3)
}
// Output:
// run mode 1
// after inner switch
// after outer switch
// ---
// run mode 2 — aborting action
// after outer switch
// ---
// run mode 3
// after inner switch
// after outer switch
```

### Edge Case 7: Labeled break on select (less common, but valid)

```go
package main

import "fmt"

func main() {
    ch1 := make(chan int, 1)
    ch2 := make(chan int, 1)
    ch1 <- 42

Sel:
    select {
    case v := <-ch1:
        if v > 40 {
            fmt.Println("got high value, breaking select")
            break Sel // explicit labeled break on the select
        }
        fmt.Println("got:", v)
    case v := <-ch2:
        fmt.Println("from ch2:", v)
    }
    fmt.Println("after select")
}
// Output:
// got high value, breaking select
// after select
```

### Edge Case 8: Triple-nested loop with labeled break

```go
package main

import "fmt"

func main() {
    // Find the first triple (x, y, z) where x*y*z == 60
Outer:
    for x := 1; x <= 10; x++ {
        for y := 1; y <= 10; y++ {
            for z := 1; z <= 10; z++ {
                if x*y*z == 60 {
                    fmt.Printf("Found: %d * %d * %d = 60\n", x, y, z)
                    break Outer // exits all three loops
                }
            }
        }
    }
    fmt.Println("Search complete")
}
// Output:
// Found: 1 * 6 * 10 = 60
// Search complete
```

### Edge Case 9: break with for-range over string (runes)

```go
package main

import "fmt"

func main() {
    text := "Hello, World!"

    // Find the first comma
    for i, r := range text {
        if r == ',' {
            fmt.Printf("Comma found at byte index %d\n", i)
            break // exits the for-range loop
        }
        fmt.Printf("%c ", r)
    }
    fmt.Println()
}
// Output:
// H e l l o
// Comma found at byte index 5
```

---

## 8. Version History

| Version | Change |
|---------|--------|
| Go 1.0 (2012) | `break` statement introduced with full semantics: unlabeled and labeled forms, applicable to `for`, `switch`, and `select` |
| Go 1.0+ | No changes to break semantics in any subsequent release |

The `break` statement has been **completely stable** since Go 1.0. The Go1 compatibility guarantee ensures that its behavior will not change in any future Go 1.x release.

Notable design decisions made before Go 1.0:
- **No implicit fallthrough in switch** — Go deliberately diverged from C's switch semantics, making `break` inside switch less essential but still valid.
- **Labeled break applies to for/switch/select** — unlike some languages where labeled break only applies to loops, Go extends it to `switch` and `select` as well.
- **No multi-level numeric break** — Go does not support `break 2` or `break N` syntax found in some languages (e.g., PHP). Labels are the mechanism for multi-level breaks.

---

## 9. Implementation-Specific Behavior

### Jump instruction generation

The `break` statement compiles to an **unconditional jump** instruction (`JMP` on x86/AMD64, `B` on ARM64) that targets the instruction immediately following the terminated construct.

For labeled breaks, the compiler resolves the target label at compile time. There is no runtime overhead compared to an unlabeled break — both result in a single jump instruction.

### SSA (Static Single Assignment) form

In the Go compiler's SSA intermediate representation, `break` creates a **basic block boundary**. The current basic block terminates with an unconditional branch to the block representing the code after the loop/switch/select.

### Stack and registers

`break` does not affect the call stack. No stack frames are pushed or popped. The compiler may need to generate code to:
- Restore registers that held loop variables (for optimized builds where loop variables are in registers).
- No cleanup of local variables is needed — Go's garbage collector handles memory.

### Comparison with return

Unlike `return`, `break` does **not**:
- Trigger deferred function calls.
- Copy return values to the caller's stack frame.
- Execute the function epilogue.

`break` is purely an intra-function, intra-statement control transfer.

---

## 10. Spec Compliance Checklist

- [ ] `break` is only used inside `for`, `switch`, or `select` statements
- [ ] When using `break` inside a `switch` nested in a `for`, the intention is verified — did you mean to exit the switch or the for loop?
- [ ] When using `break` inside a `select` nested in a `for`, the intention is verified — did you mean to exit the select or the for loop?
- [ ] Labeled `break` uses a label that is on an enclosing `for`, `switch`, or `select` (not `if`, block, or other statements)
- [ ] All declared labels are referenced (no unused label compile errors)
- [ ] Labels do not attempt to cross function boundaries (including closures and goroutines)
- [ ] Deferred functions are not expected to run on `break` (only on function return)
- [ ] Labels follow Go naming conventions (PascalCase: `OuterLoop`, `Retry`, `Search`)
- [ ] Labeled breaks in complex nested structures are documented with comments for clarity
- [ ] `break` is not confused with `return` when the goal is to exit a goroutine
- [ ] The distinction between `break` (exits switch) and no-op end-of-case (also exits switch) is understood

---

## 11. Official Examples

### Example 1: Simple break in a for loop

```go
package main

import "fmt"

func main() {
    // Find the first number divisible by 7 in range [1, 100]
    for i := 1; i <= 100; i++ {
        if i%7 == 0 {
            fmt.Println("First multiple of 7:", i)
            break // exit the loop immediately
        }
    }

    // Sum numbers until the running total exceeds 50
    sum := 0
    for i := 1; ; i++ { // infinite loop
        sum += i
        if sum > 50 {
            fmt.Printf("Sum exceeded 50 at i=%d, sum=%d\n", i, sum)
            break // exit the infinite loop
        }
    }
}
// Output:
// First multiple of 7: 7
// Sum exceeded 50 at i=10, sum=55
```

### Example 2: Labeled break to exit nested loops

```go
package main

import "fmt"

func main() {
    // Search for a target value in a 2D grid
    grid := [][]int{
        {11, 22, 33},
        {44, 55, 66},
        {77, 88, 99},
    }
    target := 55

    found := false
Search:
    for row := 0; row < len(grid); row++ {
        for col := 0; col < len(grid[row]); col++ {
            if grid[row][col] == target {
                fmt.Printf("Found %d at grid[%d][%d]\n", target, row, col)
                found = true
                break Search // exit BOTH loops
            }
        }
    }

    if !found {
        fmt.Printf("%d not found in grid\n", target)
    }
}
// Output: Found 55 at grid[1][1]
```

### Example 3: break in switch inside for — the pitfall and the fix

```go
package main

import "fmt"

func main() {
    commands := []string{"start", "process", "stop", "process", "end"}

    // WRONG: break exits the switch, not the for loop
    fmt.Println("=== Wrong (break exits switch) ===")
    for _, cmd := range commands {
        switch cmd {
        case "stop":
            fmt.Println("Stop command received!")
            break // exits the switch only
        default:
            fmt.Println("Executing:", cmd)
        }
        fmt.Println("  (loop continues)") // always reached
    }

    // CORRECT: labeled break exits the for loop
    fmt.Println("\n=== Correct (labeled break exits for) ===")
CmdLoop:
    for _, cmd := range commands {
        switch cmd {
        case "stop":
            fmt.Println("Stop command received!")
            break CmdLoop // exits the for loop
        default:
            fmt.Println("Executing:", cmd)
        }
        fmt.Println("  (loop continues)") // NOT reached on "stop"
    }

    fmt.Println("Done")
}
// Output:
// === Wrong (break exits switch) ===
// Executing: start
//   (loop continues)
// Executing: process
//   (loop continues)
// Stop command received!
//   (loop continues)
// Executing: process
//   (loop continues)
// Executing: end
//   (loop continues)
//
// === Correct (labeled break exits for) ===
// Executing: start
//   (loop continues)
// Executing: process
//   (loop continues)
// Stop command received!
// Done
```

### Example 4: break in select inside for — event loop pattern

```go
package main

import (
    "context"
    "fmt"
    "time"
)

func eventLoop(ctx context.Context, events <-chan string) {
    processed := 0

Loop:
    for {
        select {
        case <-ctx.Done():
            fmt.Println("Context cancelled, exiting event loop")
            break Loop // exits the for loop
        case event, ok := <-events:
            if !ok {
                fmt.Println("Event channel closed, exiting event loop")
                break Loop // exits the for loop
            }
            fmt.Printf("Processing event: %s\n", event)
            processed++
        }
    }

    fmt.Printf("Total events processed: %d\n", processed)
}

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
    defer cancel()

    events := make(chan string, 5)
    events <- "click"
    events <- "scroll"
    events <- "keypress"
    close(events) // close the channel to trigger the exit

    eventLoop(ctx, events)
}
// Output:
// Processing event: click
// Processing event: scroll
// Processing event: keypress
// Event channel closed, exiting event loop
// Total events processed: 3
```

### Example 5: break with for-range and early termination

```go
package main

import (
    "fmt"
    "strings"
)

func findFirstError(logs []string) (string, bool) {
    for _, line := range logs {
        if strings.Contains(line, "ERROR") {
            return line, true // could also use break + variable
        }
    }
    return "", false
}

func findAllBeforeError(logs []string) []string {
    var clean []string
    for _, line := range logs {
        if strings.Contains(line, "ERROR") {
            break // stop processing at first error
        }
        clean = append(clean, line)
    }
    return clean
}

func main() {
    logs := []string{
        "INFO: Starting server",
        "INFO: Listening on :8080",
        "WARN: High memory usage",
        "ERROR: Connection refused",
        "INFO: Retrying",
    }

    if errLine, found := findFirstError(logs); found {
        fmt.Println("First error:", errLine)
    }

    clean := findAllBeforeError(logs)
    fmt.Println("Logs before first error:")
    for _, line := range clean {
        fmt.Println(" ", line)
    }
}
// Output:
// First error: ERROR: Connection refused
// Logs before first error:
//   INFO: Starting server
//   INFO: Listening on :8080
//   WARN: High memory usage
```

### Example 6: Compile error examples (invalid usage)

```go
// These examples demonstrate compile-time errors.
// Each function would fail to compile.

package main

// Example 1: break outside any breakable statement
func invalidBreakOutside() {
    break // compile error: break is not in a loop, switch, or select
}

// Example 2: break with undefined label
func invalidUndefinedLabel() {
    for i := 0; i < 10; i++ {
        break NonExistent // compile error: undefined label NonExistent
    }
}

// Example 3: break with label on non-breakable statement
func invalidLabelOnIf() {
    MyIf:
    if true {
        break MyIf // compile error: invalid break label MyIf
    }
}

// Example 4: break in closure cannot affect outer loop
func invalidBreakInClosure() {
    for i := 0; i < 10; i++ {
        func() {
            break // compile error: break is not in a loop, switch, or select
        }()
    }
}

// Example 5: labeled break where label is not enclosing
func invalidNonEnclosingLabel() {
    Other:
    for j := 0; j < 5; j++ {
        // Other encloses this
    }

    for i := 0; i < 10; i++ {
        break Other // compile error: invalid break label Other
                    // (Other does not enclose this break)
    }
}

// Example 6: unused label
func invalidUnusedLabel() {
    Unused: // compile error: label Unused defined and not used
    for {
        break // unlabeled break does not "use" the label
    }
}
```

### Example 7: Labeled break with three levels of nesting

```go
package main

import "fmt"

func main() {
    type Cell struct {
        layers [][]int
    }

    grid := [][]Cell{
        {
            {layers: [][]int{{1, 2}, {3, 4}}},
            {layers: [][]int{{5, 6}, {7, 8}}},
        },
        {
            {layers: [][]int{{9, 10}, {11, 12}}},
            {layers: [][]int{{13, -1}, {15, 16}}}, // contains -1
        },
    }

    // Find the first negative value in the entire 4-level structure
    target := -1
    foundPath := ""

Level1:
    for i, row := range grid {
        for j, cell := range row {
            for k, layer := range cell.layers {
                for l, val := range layer {
                    if val == target {
                        foundPath = fmt.Sprintf("grid[%d][%d].layers[%d][%d]", i, j, k, l)
                        break Level1 // exits ALL four loops
                    }
                }
            }
        }
    }

    if foundPath != "" {
        fmt.Printf("Found %d at %s\n", target, foundPath)
    } else {
        fmt.Println("Not found")
    }
}
// Output: Found -1 at grid[1][1].layers[0][1]
```

---

## 12. Related Spec Sections

| Section | URL | Relationship to break |
|---------|-----|----------------------|
| Break statements | https://go.dev/ref/spec#Break_statements | Primary definition |
| Continue statements | https://go.dev/ref/spec#Continue_statements | Sibling flow control — advances loop iteration instead of terminating |
| Goto statements | https://go.dev/ref/spec#Goto_statements | Alternative control transfer — jumps to arbitrary label |
| For statements | https://go.dev/ref/spec#For_statements | Target of break — `break` can terminate `for` loops |
| Switch statements | https://go.dev/ref/spec#Switch_statements | Target of break — `break` can terminate `switch` statements |
| Select statements | https://go.dev/ref/spec#Select_statements | Target of break — `break` can terminate `select` statements |
| Labeled statements | https://go.dev/ref/spec#Labeled_statements | Mechanism for labeled break — labels identify the target statement |
| Terminating statements | https://go.dev/ref/spec#Terminating_statements | `break` is NOT a terminating statement (it terminates a construct, not the function) |
| Return statements | https://go.dev/ref/spec#Return_statements | Alternative — use `return` to exit functions; `break` only exits loops/switch/select |
| Fallthrough statements | https://go.dev/ref/spec#Fallthrough_statements | Go's explicit fallthrough replaces C's implicit fallthrough, making `break` in switch less essential |
| Defer statements | https://go.dev/ref/spec#Defer_statements | Interaction — `break` does NOT trigger deferred calls |

---

## Appendix: break vs continue vs goto vs return — Quick Comparison

| Statement | Exits | Triggers defer? | Can use label? | Applies to |
|-----------|-------|-----------------|----------------|------------|
| `break` | Innermost `for`/`switch`/`select` (or labeled one) | No | Yes — `for`/`switch`/`select` labels | `for`, `switch`, `select` |
| `continue` | Current iteration of innermost `for` (or labeled one) | No | Yes — `for` labels only | `for` only |
| `goto` | N/A — transfers to label | No | Yes — any label in function | Any point in function |
| `return` | Entire function | Yes | No | Functions |

---

## Appendix: Common Patterns Using break

### Pattern 1: Search with early exit

```go
func contains(slice []int, target int) bool {
    for _, v := range slice {
        if v == target {
            return true // return is cleaner than break + flag for functions
        }
    }
    return false
}
```

### Pattern 2: Process until sentinel value

```go
func processUntilDone(ch <-chan string) []string {
    var results []string
    for msg := range ch {
        if msg == "DONE" {
            break
        }
        results = append(results, msg)
    }
    return results
}
```

### Pattern 3: Timeout with labeled break in select-for

```go
func waitForResult(result <-chan int, timeout time.Duration) (int, bool) {
    timer := time.NewTimer(timeout)
    defer timer.Stop()

    select {
    case v := <-result:
        return v, true
    case <-timer.C:
        return 0, false
    }
}
```

### Pattern 4: Breaking out of infinite loop on condition

```go
func readLines(scanner *bufio.Scanner) []string {
    var lines []string
    for scanner.Scan() { // Scan returns false on EOF or error
        line := scanner.Text()
        if line == "" {
            break // stop at first empty line
        }
        lines = append(lines, line)
    }
    return lines
}
```

---

## Summary

The `break` statement in Go is a fundamental control flow mechanism with two forms:

1. **Unlabeled**: `break` — terminates the innermost enclosing `for`, `switch`, or `select`.
2. **Labeled**: `break Label` — terminates the `for`, `switch`, or `select` identified by the label.

Key points to remember:
- `break` in a `switch` exits the switch, not an enclosing loop. Use `break Label` to exit the loop.
- `break` in a `select` exits the select, not an enclosing loop. Use `break Label` to exit the loop.
- Labels must be on `for`, `switch`, or `select` statements and must enclose the `break`.
- `break` cannot cross function boundaries (including closures and goroutines).
- `break` does not trigger deferred functions.
- All label-related errors are caught at compile time — there are no runtime surprises.
