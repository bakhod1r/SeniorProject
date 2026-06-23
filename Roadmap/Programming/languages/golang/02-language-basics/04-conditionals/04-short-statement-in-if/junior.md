# Go Short Statement in If — Junior Level

## 1. Introduction

### What is it?
The **short statement in if** is a Go feature that lets you place a small initializer statement before the boolean condition of an `if`. It runs first; then the condition is evaluated; then the body or the `else` chain executes. The variables declared in the initializer are visible only inside the `if` and any attached `else` branches — they vanish after the chain ends.

### How to use it?
```go
if x := compute(); x > 0 {
    fmt.Println("positive:", x)
} else {
    fmt.Println("non-positive:", x)
}
// x is no longer in scope here.
```

The form `if simpleStmt; condition { ... }` is two parts separated by a semicolon: the **init statement** (left of `;`) and the **boolean expression** (right of `;`). The same shape exists for `switch` and `for`. This single keystroke savings is responsible for the most common shape of idiomatic Go error handling: `if err := op(); err != nil { ... }`.

---

## 2. Prerequisites

- Variables and short variable declaration `:=` (2.2)
- `if` and `if/else` chains (2.4.1, 2.4.2)
- Function calls and multiple return values
- Lexical scope and block scoping
- Comma-ok idioms (`v, ok := m[k]`, `v, ok := <-ch`, `v, ok := i.(T)`)

---

## 3. Glossary

| Term | Definition |
|------|-----------|
| init statement | The simple statement preceding the `;` in an `if`, `switch`, or `for` |
| simple statement | A non-declaration statement that the spec allows in this position: assignment, increment, decrement, send, expression, short variable declaration |
| short variable declaration | A statement of the form `name := expr` (or `a, b := ..., ...`) introducing one or more new variables |
| implicit block | The conceptual block that wraps the entire `if/else if/else` chain so the init's variables remain visible in every branch |
| scope | The region of source where a name refers to its declared entity |
| shadow | Re-declaring a name in an inner scope so the outer name is hidden inside that block |
| comma-ok | The two-result form of map index, type assertion, or channel receive that signals success in a second boolean |
| guard pattern | The idiom of `if err := op(); err != nil { return err }` to keep error variables out of the surrounding scope |
| sentinel error | A package-level error value compared with `errors.Is` |

---

## 4. Core Concepts

### 4.1 Basic Syntax

The grammar is `if SimpleStmt ; Expression Block [ "else" ( IfStmt | Block ) ]`. The `SimpleStmt` is optional. If present, it runs before `Expression`.

```go
package main

import "fmt"

func main() {
    if x := 7; x > 5 {
        fmt.Println("big:", x) // x in scope
    } else {
        fmt.Println("small:", x) // still in scope
    }
    // fmt.Println(x) -- compile error: undefined x
}
```

The semicolon is mandatory when an init is present; the body's `{` follows the condition immediately.

### 4.2 Scope Is the Whole If/Else Chain

A name declared in the init is visible across the entire `if/else if/else` ladder, but never after the closing brace of the last branch.

```go
package main

import "fmt"

func main() {
    if n := len("hello"); n > 10 {
        fmt.Println("long:", n)
    } else if n > 3 {
        fmt.Println("medium:", n)
    } else {
        fmt.Println("short:", n)
    }
    // n is gone here.
}
```

This is sometimes called the **implicit block** that wraps the entire chain. Every branch sits inside it, so each branch can read (and write) `n`.

### 4.3 The Idiomatic err-Handling Form

The dominant use of the init is to keep an error variable scoped to its check:

```go
package main

import (
    "fmt"
    "os"
)

func main() {
    if data, err := os.ReadFile("config.json"); err != nil {
        fmt.Println("read failed:", err)
    } else {
        fmt.Println("got bytes:", len(data))
    }
    // Neither data nor err leak into the rest of main.
}
```

`os.ReadFile` returns `([]byte, error)`. Both names are introduced by `:=` and confined to the chain. After the `}`, neither is reachable, so you cannot accidentally test a stale `err` later.

### 4.4 Comma-ok in If-Init

The init accepts a short variable declaration with multiple targets, which is exactly what comma-ok forms produce.

**Map lookup:**
```go
package main

import "fmt"

func main() {
    prices := map[string]int{"apple": 30, "pear": 50}
    if p, ok := prices["apple"]; ok {
        fmt.Println("apple costs", p)
    } else {
        fmt.Println("apple not in catalog")
    }
}
```

**Type assertion:**
```go
package main

import "fmt"

func describe(i any) {
    if s, ok := i.(string); ok {
        fmt.Println("a string of length", len(s))
        return
    }
    fmt.Println("not a string")
}

func main() {
    describe("hello")
    describe(42)
}
```

**Channel receive:**
```go
package main

import "fmt"

func main() {
    ch := make(chan int, 1)
    ch <- 9
    close(ch)
    if v, ok := <-ch; ok {
        fmt.Println("got:", v)
    } else {
        fmt.Println("channel closed")
    }
}
```

The combination "init + condition that tests `ok`" is so common that it deserves a name — the **comma-ok guard**.

### 4.5 The Same Shape in Switch

A `switch` may also have an init statement, with identical scope rules:

```go
package main

import "fmt"

func main() {
    switch hour := timeOfDay(); {
    case hour < 12:
        fmt.Println("morning")
    case hour < 18:
        fmt.Println("afternoon")
    default:
        fmt.Println("evening")
    }
}

func timeOfDay() int { return 14 }
```

`hour` is in scope across every `case` arm and falls out of scope after `}`. The shape `switch init; { ... }` (with no tag) gives a clean way to introduce a value used by several cases.

### 4.6 Type Switch With Init

Type switches accept an init too:

```go
package main

import "fmt"

func first(values []any) {
    switch x := values[0]; v := x.(type) {
    case int:
        fmt.Println("int:", v)
    case string:
        fmt.Println("string:", v)
    default:
        fmt.Println("other")
    }
}

func main() {
    first([]any{42})
    first([]any{"hi"})
}
```

The init `x := values[0]` runs once; then the type-switch declares `v` of the dynamic type per case.

### 4.7 The For-Init Cousin

The same conceptual init exists in `for`:

```go
for i := 0; i < 3; i++ { ... }
```

The init introduces `i`, and `i` is scoped to the loop. This is mentioned for completeness — the article focuses on `if`, but the same scoping rules apply.

### 4.8 What Counts as a "Simple Statement"?

The Go spec lists which statements may appear here. A simple statement is **not** a `var` declaration, `const` declaration, `type` declaration, `return`, `break`, or `continue`. Allowed forms include:

- Empty statement
- Expression statement: `f(x)`
- Send: `ch <- v`
- IncDec: `i++`, `i--`
- Assignment: `x = 1`
- Short variable declaration: `x := 1`

```go
// Allowed:
if i++; i > 10 { ... }
if doSetup(); ready { ... }   // expression statement; condition uses ready (must already exist)
if v := compute(); v.Valid() { ... }

// Not allowed (not a SimpleStmt):
if var x = 1; x > 0 { ... }   // compile error
if return f(); true { ... }   // compile error
```

### 4.9 Multiple Variables in One Init

You can declare multiple variables together — they all share the chain's scope:

```go
package main

import "fmt"

func main() {
    if a, b := 3, 4; a*a+b*b == 25 {
        fmt.Println("3-4-5 triangle:", a, b)
    }
}
```

Mixing existing and new names: at least one name on the left of `:=` must be new in the current scope. The init statement creates a fresh scope, so any local from outside is treated as outer; you usually want fresh names anyway.

---

## 5. Real-World Analogies

**A library reading room:** you check out a book at the counter (init), read it inside the room (the if/else chain), and you must return the book before you leave. The book is not allowed to leave the room.

**A receipt at checkout:** the cashier prints a receipt (the init), uses it for the next two questions ("did the card go through? do you want a bag?"), and tosses it as you walk away. You don't carry the receipt out the door.

**A kitchen prep step:** chop the onion right before the stir-fry section ("init"), use it across the multiple stages of cooking ("branches"), then the cutting board is cleared once the dish is plated.

---

## 6. Mental Models

```
if    INIT;    COND   {  body }  else  if  ...  else  { ... }
      ──┬──         └──── implicit block ─────────────────┘
        │
        └── visible only inside that implicit block.
```

Equivalent rewrite (without init), to see the lifetime explicitly:

```go
{
    INIT
    if COND {
        // body
    } else if COND2 {
        // ...
    } else {
        // ...
    }
}
```

The outer `{}` is the implicit block. The init lives in it; the condition and every branch are inside it; the world outside the `}` cannot see init's names.

---

## 7. Pros & Cons

### Pros
- Tightens variable lifetime to where the variable is actually used
- Prevents "stale variable" mistakes after the check
- Reads naturally for one-shot calls feeding directly into a guard
- Avoids polluting the surrounding scope with single-use names
- Keeps the err-shadowing problem manageable

### Cons
- Less obvious to readers learning Go
- Tempts overuse — long init lines with side effects hurt clarity
- Not every "simple statement" fits — multi-step setups should be moved out
- Combining with a long boolean condition becomes a wall of code

---

## 8. Use Cases

1. Error checks tied to a single call: `if err := op(); err != nil { ... }`.
2. Map lookups: `if v, ok := m[k]; ok { ... }`.
3. Type assertions: `if s, ok := i.(string); ok { ... }`.
4. Channel receives: `if v, ok := <-ch; ok { ... }`.
5. One-shot computation feeding both branches: `if x := f(); x < 0 { neg(x) } else { pos(x) }`.
6. Read-then-write toggles: `if was, set := flip(); set { ... }`.
7. Mutex-bounded inspection (rare): `if v := snapshot(); v != nil { use(v) }`.
8. Switch initialization for multi-case dispatch on the same value.

---

## 9. Code Examples

### Example 1 — Bare Read-Then-Test
```go
package main

import "fmt"

func compute() int { return 42 }

func main() {
    if v := compute(); v%2 == 0 {
        fmt.Println("even:", v)
    } else {
        fmt.Println("odd:", v)
    }
}
```

### Example 2 — Err Guard
```go
package main

import (
    "fmt"
    "strconv"
)

func main() {
    s := "123"
    if n, err := strconv.Atoi(s); err == nil {
        fmt.Println("parsed:", n)
    } else {
        fmt.Println("parse failed:", err)
    }
}
```

### Example 3 — Map Comma-Ok
```go
package main

import "fmt"

func main() {
    sizes := map[string]int{"S": 36, "M": 38, "L": 40}
    if size, ok := sizes["XL"]; ok {
        fmt.Println("XL size is", size)
    } else {
        fmt.Println("XL not stocked")
    }
}
```

### Example 4 — Type Assertion Guard
```go
package main

import "fmt"

func describe(i any) {
    if n, ok := i.(int); ok {
        fmt.Println("int +1:", n+1)
        return
    }
    if s, ok := i.(string); ok {
        fmt.Println("string len:", len(s))
        return
    }
    fmt.Println("unknown")
}

func main() {
    describe(7)
    describe("Go")
    describe(3.14)
}
```

### Example 5 — Channel Receive
```go
package main

import "fmt"

func main() {
    ch := make(chan string, 2)
    ch <- "a"
    close(ch)

    if v, ok := <-ch; ok {
        fmt.Println("first:", v)
    }
    if v, ok := <-ch; ok {
        fmt.Println("second:", v)
    } else {
        fmt.Println("channel drained")
    }
}
```

### Example 6 — Switch With Init
```go
package main

import "fmt"

func sign(x int) string {
    switch r := x; {
    case r > 0:
        return "+"
    case r < 0:
        return "-"
    default:
        return "0"
    }
}

func main() {
    fmt.Println(sign(3), sign(-2), sign(0))
}
```

### Example 7 — Combined: Read + Validate
```go
package main

import (
    "fmt"
    "strings"
)

func main() {
    raw := "  hello  "
    if t := strings.TrimSpace(raw); t == "" {
        fmt.Println("empty input")
    } else if len(t) > 100 {
        fmt.Println("too long")
    } else {
        fmt.Println("ok:", t)
    }
}
```

### Example 8 — Else-If Chain Sharing Init
```go
package main

import "fmt"

func grade(score int) string {
    if g := score / 10; g >= 9 {
        return "A"
    } else if g >= 8 {
        return "B"
    } else if g >= 7 {
        return "C"
    } else {
        return "F"
    }
}

func main() {
    fmt.Println(grade(95), grade(82), grade(73), grade(40))
}
```

### Example 9 — Type Switch Init
```go
package main

import "fmt"

func main() {
    var things = []any{1, "two", 3.0}
    for i := range things {
        switch t := things[i]; v := t.(type) {
        case int:
            fmt.Println("int*2 =", v*2)
        case string:
            fmt.Println("string upper-len =", len(v))
        case float64:
            fmt.Println("float halved =", v/2)
        }
    }
}
```

### Example 10 — Avoid Leak Across Loop Iterations
```go
package main

import "fmt"

func main() {
    paths := []string{"a.txt", "b.txt", "c.txt"}
    for _, p := range paths {
        if got, err := pretendOpen(p); err != nil {
            fmt.Println(p, "->", err)
        } else {
            fmt.Println(p, "->", got)
        }
        // got, err do not leak into the next iteration.
    }
}

func pretendOpen(p string) (string, error) {
    if p == "b.txt" {
        return "", fmt.Errorf("missing")
    }
    return "ok", nil
}
```

---

## 10. Common Mistakes

1. **Trying to use the init variable after the chain.**
   ```go
   if v := compute(); v > 0 { fmt.Println(v) }
   fmt.Println(v) // compile error: undefined v
   ```
   Move the declaration outside the `if` if you need the value later.

2. **Confusing `:=` with `=`.**
   ```go
   x := 0
   if x = compute(); x > 0 { ... } // assigns existing x; legal
   if x := compute(); x > 0 { ... } // declares new inner x; outer x unchanged
   ```
   They are different statements with different scoping.

3. **Accidentally shadowing an outer `err`.**
   ```go
   var err error
   if err := op(); err != nil { ... } // inner err shadows outer
   if err != nil { return err }       // checks the OUTER (still nil)
   ```

4. **Putting heavy work in the init.**
   ```go
   if results := slowQuery(ctx, db); len(results) > 0 { ... }
   // The slow call sits in a hard-to-read place. Hoist it.
   ```

5. **Treating the init as a `var` declaration.**
   ```go
   if var x = 1; x > 0 { ... } // compile error
   ```

6. **Writing `if x; x > 0` (just an identifier) instead of an expression statement.**
   ```go
   if x; x > 0 { ... } // compile error: x evaluated but not used
   ```
   The init must be a `SimpleStmt`. An ExpressionStmt may only be a function call, method call, or receive — a bare identifier is not allowed there.

7. **Init line side effects that confuse readers.**
   ```go
   if state.counter++; state.counter == 1 { ... }
   ```
   Legal; rarely worth the surprise.

---

## 11. Mini Exercises

### Exercise 1
Write a function `firstEven(ns []int) (int, bool)` that returns the first even element. Inside `main`, call it with `if/else` using the init form.

<details><summary>Solution</summary>

```go
package main

import "fmt"

func firstEven(ns []int) (int, bool) {
    for _, n := range ns {
        if n%2 == 0 {
            return n, true
        }
    }
    return 0, false
}

func main() {
    if v, ok := firstEven([]int{1, 3, 4, 5}); ok {
        fmt.Println("found:", v)
    } else {
        fmt.Println("no even number")
    }
}
```
</details>

### Exercise 2
Refactor this code to keep `err` out of the surrounding scope:
```go
data, err := os.ReadFile("a.txt")
if err != nil { fmt.Println(err); return }
fmt.Println(string(data))
```

<details><summary>Solution</summary>

You cannot directly inline this if you need `data` after the check. Either accept that `data` and `err` stay in scope, or split:

```go
data, err := os.ReadFile("a.txt")
if err != nil { fmt.Println(err); return }
fmt.Println(string(data))
```

is already the idiomatic shape when both `data` and `err` are needed past the check. The init form is best when the result is consumed inside the chain only:

```go
if err := os.WriteFile("a.txt", []byte("hi"), 0o644); err != nil {
    fmt.Println(err)
    return
}
```
</details>

### Exercise 3
Rewrite this map check using if-init:
```go
v, ok := scores[name]
if ok { fmt.Println(v) } else { fmt.Println("missing") }
```

<details><summary>Solution</summary>

```go
if v, ok := scores[name]; ok {
    fmt.Println(v)
} else {
    fmt.Println("missing")
}
```
</details>

### Exercise 4
Write a `switch` with init that prints "weekday" for Mon–Fri and "weekend" otherwise, using a `time.Weekday` value.

<details><summary>Solution</summary>

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    switch d := time.Now().Weekday(); {
    case d == time.Saturday || d == time.Sunday:
        fmt.Println("weekend")
    default:
        fmt.Println("weekday")
    }
}
```
</details>

### Exercise 5
Find the bug:
```go
err := db.Ping()
if err := query(); err != nil { return err }
return err
```

<details><summary>Solution</summary>

The inner `err` shadows the outer. The outer `err` from `db.Ping()` is never checked, and the `return err` at the end returns the (possibly stale) outer value. Fix by using one or the other:

```go
if e := query(); e != nil {
    return e
}
return err
```
</details>

### Exercise 6
Predict the output:
```go
m := map[string]int{"x": 1}
if v, ok := m["x"]; ok {
    v++
}
fmt.Println(m["x"])
```

<details><summary>Solution</summary>

`1`. `v` is a copy of `m["x"]`. Incrementing `v` doesn't change the map. To mutate the map you must assign back: `m["x"] = v + 1`.
</details>

---

## 12. Cheat Sheet

| Form | Meaning |
|------|---------|
| `if simpleStmt; cond { ... }` | Run init, then test cond, then body |
| `if a := f(); a > 0 { ... } else { ... }` | `a` visible in body and else |
| `if v, ok := m[k]; ok { ... }` | Map comma-ok guard |
| `if s, ok := i.(T); ok { ... }` | Type assertion guard |
| `if v, ok := <-ch; ok { ... }` | Channel receive guard |
| `if err := op(); err != nil { ... }` | Error guard, err stays local |
| `switch x := v; { case ...: }` | Switch with init, no tag |
| `switch t := i; v := t.(type) { case T: }` | Type switch with init |
| `for i := 0; i < n; i++ { ... }` | For init (parallel feature) |

Rules you should be able to recite:
- The init may be any **simple statement**. Not `var`, not `return`, not `break`, not `continue`.
- The names introduced are visible in the body and every `else` branch — not after the chain.
- `:=` declares fresh names in the implicit block; existing outer names are shadowed.
- The same form exists in `switch` and `for`.
- Use it for short, single-purpose initializers, especially error and comma-ok checks.
