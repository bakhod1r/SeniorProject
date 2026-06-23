# Go Specification: Labeled Break and Continue

**Source:** https://go.dev/ref/spec#Break_statements, https://go.dev/ref/spec#Continue_statements, https://go.dev/ref/spec#Labeled_statements
**Sections:** Labeled statements, Break statements, Continue statements

---

## 1. Spec References

| Field | Value |
|-------|-------|
| **Labeled statements** | https://go.dev/ref/spec#Labeled_statements |
| **Break statements** | https://go.dev/ref/spec#Break_statements |
| **Continue statements** | https://go.dev/ref/spec#Continue_statements |
| **Goto statements** | https://go.dev/ref/spec#Goto_statements |
| **Go Version** | Go 1.0+ (semantics unchanged since 1.0) |

Official spec text:

> "A labeled statement may be the target of a goto, break or continue statement."

> "A 'break' statement terminates execution of the innermost 'for', 'switch', or 'select' statement within the same function. If there is a label, it must be that of an enclosing 'for', 'switch', or 'select' statement, and that is the one whose execution terminates."

> "A 'continue' statement begins the next iteration of the innermost enclosing 'for' loop by advancing control to the end of the loop block. The 'for' loop must be within the same function. If there is a label, it must be that of an enclosing 'for' statement, and that is the one whose execution advances."

---

## 2. Definition

A **labeled statement** is a statement preceded by an identifier and a colon, marking that statement as the target of `break`, `continue`, or `goto`. For `break` and `continue`, the labelled statement must be a `for`, `switch`, or `select` (with `continue` further restricted to `for`).

Grammar (informal):

```
LabeledStmt = Label ":" Statement .
Label       = identifier .
BreakStmt   = "break" [ Label ] .
ContinueStmt = "continue" [ Label ] .
```

---

## 3. Core Rules & Constraints

### 3.1 A Label Names a `for`/`switch`/`select` for `break`

Per spec: `break` with a label requires the label to name an enclosing `for`, `switch`, or `select`.

```go
package main

import "fmt"

func main() {
Outer:
    for i := 0; i < 3; i++ {
        for j := 0; j < 3; j++ {
            if i+j > 2 {
                break Outer
            }
            fmt.Println(i, j)
        }
    }
}
```

### 3.2 `continue` Requires a Label on a `for`

Per spec: `continue` with a label requires the label to name an enclosing `for` statement (not `switch`, not `select`).

```go
Outer:
for i := 0; i < 3; i++ {
    switch x {
    case 0:
        continue Outer
    }
}
```

A label on a `switch`/`select` cannot be a `continue` target:

```go
Inner:
switch x {
case 1:
    continue Inner // ERROR
}
```

### 3.3 Labels Are Function-Scoped

Per spec: "If there is a label, it must be that of an enclosing 'for', 'switch', or 'select' statement, and that is the one whose execution terminates." The "within the same function" qualifier is implicit through the requirement that the label be on an enclosing statement.

```go
func main() {
Outer:
    for ... { ... }
}

func helper() {
    // break Outer // ERROR: not in scope
}
```

### 3.4 Each Label Must Be Used

The compiler rejects unused labels:

```go
Outer:
for i := 0; i < 3; i++ { _ = i }
// compile error: label Outer defined and not used
```

This rule appears in `cmd/compile/internal/types2/labels.go`.

### 3.5 Each Label Name Is Unique Within a Function

```go
Outer:
for i := 0; i < 3; i++ { break Outer }
Outer: // ERROR: label already defined
for j := 0; j < 3; j++ { break Outer }
```

### 3.6 A Label Applies Only to the Statement It Precedes

A labelled statement is a single labelled statement; the label does not "wrap" subsequent statements.

```go
Outer:
for i := 0; i < 3; i++ {
    // body
}
// the label Outer applies to the for above, not to anything below
```

### 3.7 `break L` Jumps to After the Labelled Statement

`break Outer` transfers control to the position immediately after the `for`/`switch`/`select` named `Outer`. Any code after that statement runs normally.

### 3.8 `continue L` Jumps to the Next Iteration of the Labelled `for`

`continue Outer` runs the post-statement (if any) of the labelled `for`, then re-evaluates its condition and starts the next iteration.

### 3.9 Multiple Labels Can Coexist If They Have Different Names

```go
Outer:
for i := 0; i < 3; i++ {
Inner:
    switch i {
    case 0: break Inner
    case 1: break Outer
    }
}
```

Both labels are used; both are unique.

### 3.10 A Label Is Required to Break Out of `for { select { } }`

A plain `break` inside a `select` exits the `select`, not the surrounding `for`. To exit the `for`, label it and use `break Label`.

```go
Loop:
for {
    select {
    case <-quit:
        break Loop
    case j := <-jobs:
        handle(j)
    }
}
```

---

## 4. Type Rules

### 4.1 Labels Have No Type

A label is purely a control-flow marker. It does not declare a variable; it has no type and cannot appear in expressions.

### 4.2 Branch Statements Have No Value

`break L` and `continue L` are statements, not expressions. They cannot be assigned, compared, or returned.

### 4.3 Branch Resolution Happens at Compile Time

The link from a `break L`/`continue L` to its target is established by the type checker, not at runtime.

---

## 5. Behavioral Specification

### 5.1 Plain `break` Behavior

A plain `break` (without label) exits the innermost enclosing `for`, `switch`, or `select`.

```go
for i := 0; i < 3; i++ {
    for j := 0; j < 3; j++ {
        break // exits inner for only
    }
}
```

### 5.2 Plain `continue` Behavior

A plain `continue` (without label) advances the innermost enclosing `for`.

```go
for i := 0; i < 3; i++ {
    switch i {
    case 1:
        continue // advances the for
    }
}
```

### 5.3 `break Label` Behavior

`break Label` exits the labelled `for`/`switch`/`select`. Control transfers to the position immediately following that statement.

```go
Outer:
for i := 0; i < 3; i++ {
    for j := 0; j < 3; j++ {
        break Outer
    }
}
// execution continues here
```

### 5.4 `continue Label` Behavior

`continue Label` runs the post-statement of the labelled `for`, re-evaluates its condition, and starts the next iteration.

```go
Outer:
for i := 0; i < 3; i++ {
    for j := 0; j < 3; j++ {
        if cond {
            continue Outer // i++ runs, then i loop re-enters
        }
    }
}
```

### 5.5 Defer Semantics

`break Label` and `continue Label` do not run any deferred calls. Defers wait for function `return`.

### 5.6 Goroutine Boundaries

Labels cannot cross function boundaries. A goroutine body is a separate function; it cannot reference labels of the outer function.

```go
go func() {
    // break Outer // ERROR: label not in scope
}()
```

---

## 6. Defined vs Undefined Behavior

| Situation | Behavior |
|-----------|----------|
| `break Label` where `Label` is on enclosing for/switch/select | Defined |
| `continue Label` where `Label` is on enclosing for | Defined |
| `continue Label` where `Label` is on switch/select | Compile error |
| `break Label` where `Label` is on a block | Compile error |
| Unused label | Compile error |
| Two labels with same name in one function | Compile error |
| `break Label` from goroutine body referencing outer-function label | Compile error |
| `break Label` runs deferred calls | No (defers run at function return) |
| Labelled break in `for { select { } }` exits the for | Defined |

---

## 7. Edge Cases from Spec

### 7.1 Label Scope Across Switch Fallthrough

`fallthrough` continues into the next case. A `break Label` from inside a fall-through case still works as expected:

```go
Outer:
for i := 0; i < 3; i++ {
    switch i {
    case 0:
        fallthrough
    case 1:
        if i == 1 {
            break Outer
        }
    }
}
```

### 7.2 Multiple Targetable Statements

A label can name any of `for`, `switch`, or `select`. The same label rules apply to all three for `break`. Only `for` labels are valid `continue` targets.

### 7.3 Label On a Single-Iteration For

```go
Loop:
for {
    if cond {
        break Loop
    }
}
```

A label on a `for {}` (infinite loop) is the canonical way to exit cleanly.

### 7.4 Label On a Range Loop

```go
Items:
for i, item := range items {
    if item.Bad() {
        continue Items // advance to next i
    }
    process(i, item)
}
```

`continue Items` works correctly under both pre-1.22 and Go 1.22+ loop variable semantics.

### 7.5 Label Across Goroutine Boundary (Forbidden)

```go
Outer:
for i := 0; i < 3; i++ {
    go func() {
        // break Outer // ERROR
    }()
}
```

Each goroutine body is a separate function; the label is not in scope.

### 7.6 Label Hidden by Inner Scope

A label declared in an outer function is invisible inside a nested function literal:

```go
Outer:
for i := 0; i < 3; i++ {
    fn := func() {
        // break Outer // ERROR
    }
    fn()
}
```

### 7.7 Empty Labelled Statement

A label must precede a `for`/`switch`/`select` for `break`/`continue` to work. A label on an empty statement is only valid as a `goto` target.

```go
Done: // valid as goto target only
return
```

---

## 8. Version History

| Go Version | Change |
|------------|--------|
| Go 1.0 | Labelled break and continue with current semantics |

The semantics of labelled `break`/`continue` have not changed since Go 1.0. The Go 1.22 loop variable change affects iteration variable lifetime but not the behavior of `break L`/`continue L`.

---

## 9. Implementation-Specific Behavior

### 9.1 Compile-Time Resolution

Labels are resolved at compile time. The `cmd/compile/internal/types2/labels.go` file collects label declarations, validates them (uniqueness, target type), and links each `break`/`continue` to its target.

### 9.2 IR Lowering

In `cmd/compile/internal/walk/stmt.go`, labelled `break`/`continue` are lowered to IR `OBREAK`/`OCONTINUE` nodes pointing at the resolved targets. The labels themselves are erased.

### 9.3 Code Generation

The SSA pass represents labelled jumps as ordinary control-flow edges. Code generation emits a `JMP` to the target's basic block. There is no per-label runtime data.

### 9.4 No Runtime Cost

Labels have zero runtime cost. The generated machine code for `break L` is the same as for `break` — only the target differs.

---

## 10. Spec Compliance Checklist

- [ ] Every label declared is used by at least one branch
- [ ] Every `break L` references a label on an enclosing `for`/`switch`/`select`
- [ ] Every `continue L` references a label on an enclosing `for`
- [ ] No two labels in the same function share a name
- [ ] No `break L`/`continue L` references a label outside its function
- [ ] `break Label` is used to exit `for { select { } }` cleanly
- [ ] No flag-variable simulation of labelled break

---

## 11. Official Examples

### Example 1: Labeled Break in Nested Loop

```go
package main

import "fmt"

func main() {
OuterLoop:
    for i := 0; i < 3; i++ {
        for j := 0; j < 3; j++ {
            if i*j > 2 {
                break OuterLoop
            }
            fmt.Println(i, j)
        }
    }
}
```

Output:
```
0 0
0 1
0 2
1 0
1 1
1 2
2 0
```

### Example 2: Labeled Continue

```go
package main

import "fmt"

func main() {
OuterLoop:
    for i := 0; i < 3; i++ {
        for j := 0; j < 3; j++ {
            if j > i {
                continue OuterLoop
            }
            fmt.Println(i, j)
        }
    }
}
```

Output:
```
0 0
1 0
1 1
2 0
2 1
2 2
```

### Example 3: For-Select Quit

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    quit := time.After(20 * time.Millisecond)
    ticker := time.Tick(5 * time.Millisecond)

Loop:
    for {
        select {
        case <-quit:
            fmt.Println("done")
            break Loop
        case <-ticker:
            fmt.Println("tick")
        }
    }
}
```

Output (approximately):
```
tick
tick
tick
done
```

### Example 4: Multiple Labels

```go
package main

import "fmt"

func main() {
Rows:
    for r := 0; r < 3; r++ {
    Cols:
        for c := 0; c < 3; c++ {
            switch {
            case r == c:
                continue Cols
            case r+c == 4:
                break Rows
            default:
                fmt.Println(r, c)
            }
        }
    }
}
```

---

## 12. Related Spec Sections

| Section | URL | Relevance |
|---------|-----|-----------|
| Labeled statements | https://go.dev/ref/spec#Labeled_statements | Definition of labels |
| Break statements | https://go.dev/ref/spec#Break_statements | Behavior of `break` and `break L` |
| Continue statements | https://go.dev/ref/spec#Continue_statements | Behavior of `continue` and `continue L` |
| Goto statements | https://go.dev/ref/spec#Goto_statements | Related but distinct construct |
| For statements | https://go.dev/ref/spec#For_statements | Loop semantics |
| Switch statements | https://go.dev/ref/spec#Switch_statements | Switch semantics |
| Select statements | https://go.dev/ref/spec#Select_statements | Select semantics |
| Defer statements | https://go.dev/ref/spec#Defer_statements | Defer interaction with branches |
