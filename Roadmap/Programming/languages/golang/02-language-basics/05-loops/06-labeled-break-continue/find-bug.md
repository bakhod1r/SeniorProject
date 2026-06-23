# Go Labeled Break and Continue — Find the Bug

## Instructions

Each exercise contains buggy Go code involving a label, `break`, or `continue`. Identify the bug, explain why, and provide the corrected code. Difficulty: 🟢 Easy, 🟡 Medium, 🔴 Hard.

---

## Bug 1 🟢 — Unused Label (Compile Error)

```go
package main

import "fmt"

func main() {
Outer:
    for i := 0; i < 3; i++ {
        fmt.Println(i)
    }
}
```

<details>
<summary>Solution</summary>

**Bug**: The label `Outer` is declared but never referenced. Go rejects this:

```
./main.go:6:1: label Outer defined and not used
```

**Fix** (option A — remove the label):
```go
for i := 0; i < 3; i++ {
    fmt.Println(i)
}
```

**Fix** (option B — use it):
```go
Outer:
for i := 0; i < 3; i++ {
    if i == 2 {
        break Outer
    }
    fmt.Println(i)
}
```

**Key lesson**: Go enforces that every declared label has at least one branch referencing it. This prevents stale labels from accumulating.
</details>

---

## Bug 2 🟢 — `break` Inside `for { select { } }`

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    quit := make(chan struct{})
    go func() {
        time.Sleep(20 * time.Millisecond)
        close(quit)
    }()

    for {
        select {
        case <-quit:
            fmt.Println("quitting")
            break
        default:
            // busy work
        }
    }
    fmt.Println("after loop")
}
```

<details>
<summary>Solution</summary>

**Bug**: `break` exits the `select`, not the `for`. After printing "quitting", the `for` re-enters the `select`. Because `quit` is closed, the case keeps firing and the loop spins indefinitely (or, with a different pattern, blocks forever).

The line `fmt.Println("after loop")` never runs.

**Fix**:
```go
Loop:
for {
    select {
    case <-quit:
        fmt.Println("quitting")
        break Loop
    default:
    }
}
fmt.Println("after loop")
```

Or use `return` from a function body where the loop is the last action.

**Key lesson**: `break` inside `select` exits the `select` only. Use a label on the surrounding `for` to escape both.
</details>

---

## Bug 3 🟢 — Surprising `break Inner` That Exits a Switch

```go
package main

import "fmt"

func main() {
    for i := 0; i < 3; i++ {
    Inner:
        switch i {
        case 0:
            fmt.Println("zero")
        case 1:
            fmt.Println("one")
            break Inner // works, but a plain break would do the same
        default:
            fmt.Println("other")
        }
    }
}
```

<details>
<summary>Solution</summary>

**Bug**: `break Inner` works, but it is misleading. Inside a `case` body, a plain `break` already exits the `switch`. The label `Inner` adds no behavior here.

**The bug is conceptual**: the reader may believe the label changes the behavior (e.g., breaks out of an outer for). It does not.

**Fix** (option A — remove the unnecessary label):
```go
for i := 0; i < 3; i++ {
    switch i {
    case 0:
        fmt.Println("zero")
    case 1:
        fmt.Println("one")
        break // exits the switch
    default:
        fmt.Println("other")
    }
}
```

**Fix** (option B — if you DID intend to break the outer for):
```go
Outer:
for i := 0; i < 3; i++ {
    switch i {
    case 1:
        fmt.Println("one")
        break Outer
    }
}
```

**Key lesson**: `break Label` where the label is on a `switch` works but is rarely what you want. Verify what the label names.
</details>

---

## Bug 4 🟢 — `continue Outer` Targeting a Switch

```go
package main

import "fmt"

func main() {
    for i := 0; i < 3; i++ {
    Inner:
        switch i {
        case 0:
            fmt.Println("zero")
        case 1:
            continue Inner // BUG
        }
    }
}
```

<details>
<summary>Solution</summary>

**Bug**: `continue` requires a label on a **for** loop. `Inner` here labels a `switch`. Compile error:

```
./main.go: invalid continue label Inner
```

**Fix** (move the label to the surrounding for):
```go
Outer:
for i := 0; i < 3; i++ {
    switch i {
    case 0:
        fmt.Println("zero")
    case 1:
        continue Outer
    }
}
```

Now `continue Outer` advances the for loop.

**Key lesson**: `continue` is for `for` only. Labels on `switch`/`select` cannot be `continue` targets.
</details>

---

## Bug 5 🟢 — Plain `break` In Nested Loop

```go
package main

import "fmt"

func main() {
    grid := [][]int{
        {1, 2, 3},
        {4, 5, 6},
    }
    target := 5
    var ri, ci int
    for i, row := range grid {
        for j, v := range row {
            if v == target {
                ri, ci = i, j
                break // BUG: only exits inner loop
            }
        }
    }
    fmt.Println(ri, ci) // 1 1, but inner loop completes after break
}
```

<details>
<summary>Solution</summary>

**Bug**: `break` exits only the inner loop. The outer `for i, row := range grid` continues, potentially overwriting `ri, ci` if a later match is found, or just doing wasted work scanning remaining rows.

In this small example, the result happens to be correct, but for a grid with multiple `5`s the LAST match wins, not the FIRST.

**Fix** — labelled break:
```go
Search:
for i, row := range grid {
    for j, v := range row {
        if v == target {
            ri, ci = i, j
            break Search
        }
    }
}
```

Or extract:
```go
ri, ci, ok := find(grid, target)

func find(grid [][]int, t int) (int, int, bool) {
    for i, row := range grid {
        for j, v := range row {
            if v == t {
                return i, j, true
            }
        }
    }
    return 0, 0, false
}
```

**Key lesson**: Plain `break` exits only the innermost enclosing for. For nested loops, use a label or extract.
</details>

---

## Bug 6 🟡 — Trying To Break Out of an Outer Function

```go
package main

import "fmt"

func main() {
Outer:
    for i := 0; i < 3; i++ {
        process(i)
    }
    fmt.Println("done")
}

func process(i int) {
    if i == 1 {
        // We want to abort the entire main loop here.
        // break Outer // ERROR: label Outer is not in scope
    }
}
```

<details>
<summary>Solution</summary>

**Bug**: Labels are function-scoped. `Outer` is declared in `main`; `process` cannot reference it.

**Fix** — use a return signal:
```go
func main() {
    for i := 0; i < 3; i++ {
        if !process(i) {
            break
        }
    }
    fmt.Println("done")
}

func process(i int) (continueLoop bool) {
    if i == 1 {
        return false
    }
    fmt.Println("processed", i)
    return true
}
```

Or use a `context.Context` for cancellation across goroutine boundaries:
```go
func main() {
    ctx, cancel := context.WithCancel(context.Background())
    for i := 0; i < 3; i++ {
        if err := process(ctx, i); err != nil {
            cancel()
            break
        }
    }
}

func process(ctx context.Context, i int) error {
    if i == 1 {
        return errors.New("abort")
    }
    return nil
}
```

**Key lesson**: Labels cannot escape a function. Use return values or context cancellation for cross-function control flow.
</details>

---

## Bug 7 🟡 — Same Label Re-Declared

```go
package main

import "fmt"

func main() {
Outer:
    for i := 0; i < 3; i++ {
        if i == 1 {
            break Outer
        }
        fmt.Println(i)
    }
Outer: // BUG
    for j := 0; j < 3; j++ {
        if j == 1 {
            break Outer
        }
        fmt.Println(j)
    }
}
```

<details>
<summary>Solution</summary>

**Bug**: Two labels named `Outer` in the same function. Compile error:

```
./main.go: label Outer already defined at ./main.go:NN
```

Labels are unique within a function regardless of scope position — even though the two loops do not overlap, the label name conflicts.

**Fix** — use distinct names:
```go
First:
for i := 0; i < 3; i++ {
    if i == 1 { break First }
    fmt.Println(i)
}
Second:
for j := 0; j < 3; j++ {
    if j == 1 { break Second }
    fmt.Println(j)
}
```

**Key lesson**: Labels are function-scoped and unique by name within the function. Two non-overlapping loops cannot share a label name.
</details>

---

## Bug 8 🟡 — Label On a Plain Block

```go
package main

import "fmt"

func main() {
Outer: { // BUG
    fmt.Println("hi")
    break Outer
}
}
```

<details>
<summary>Solution</summary>

**Bug**: Labels for `break`/`continue` must precede a `for`, `switch`, or `select`. A label on a block is only valid as a `goto` target, and even then `break Outer` is not allowed.

Compile error:
```
./main.go: invalid break label Outer
```

**Fix** (option A — use a `for`):
```go
Outer:
for {
    fmt.Println("hi")
    break Outer
}
```

**Fix** (option B — use `goto`, which CAN target a labelled block):
```go
goto Done
fmt.Println("hi")
Done:
```

**Key lesson**: `break L` and `continue L` only work when `L` labels `for`/`switch`/`select`. Labels on blocks are only useful for `goto`.
</details>

---

## Bug 9 🟡 — Defer In a Labelled Loop Body

```go
package main

import (
    "fmt"
    "os"
)

func main() {
Loop:
    for i := 0; i < 3; i++ {
        f, err := os.Open("/etc/hosts")
        if err != nil {
            break Loop
        }
        defer f.Close() // BUG
        if i == 1 {
            break Loop
        }
        fmt.Println("opened", i)
    }
    fmt.Println("done")
}
```

<details>
<summary>Solution</summary>

**Bug**: `defer f.Close()` registers a deferred call for FUNCTION exit, not loop iteration exit. Defers accumulate inside the loop. After three iterations, three `Close` calls are pending. Worse: the second `os.Open` could fail because the first file is still open (depending on resource limits).

**Fix** — close per-iteration explicitly:
```go
Loop:
for i := 0; i < 3; i++ {
    if err := process(i); err != nil {
        break Loop
    }
    fmt.Println("opened", i)
}

func process(i int) error {
    f, err := os.Open("/etc/hosts")
    if err != nil {
        return err
    }
    defer f.Close() // function-scoped: closes at process return
    if i == 1 {
        return errors.New("abort")
    }
    return nil
}
```

The label is unrelated to the bug, but the label hides it: a reader sees `break Loop` and assumes cleanup happens; it does not, until `main` returns.

**Key lesson**: `break Label` runs no `defer`s registered in the function — they wait for `return`. Avoid `defer` inside loop bodies.
</details>

---

## Bug 10 🔴 — Label Used Across Goroutine Boundary

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    var wg sync.WaitGroup
Outer:
    for i := 0; i < 3; i++ {
        wg.Add(1)
        go func(i int) {
            defer wg.Done()
            if i == 1 {
                // break Outer // ERROR: label not in scope
                fmt.Println("would break")
            }
            fmt.Println(i)
        }(i)
    }
    wg.Wait()
}
```

<details>
<summary>Solution</summary>

**Bug**: Labels are function-scoped. The goroutine body is a separate function (an anonymous one); it cannot reference `Outer`.

This compiles only because `break Outer` is commented out. Uncommenting it yields:
```
./main.go: label Outer not defined
```

**Fix** — use a cancellation signal:
```go
ctx, cancel := context.WithCancel(context.Background())
defer cancel()

var wg sync.WaitGroup
for i := 0; i < 3; i++ {
    select {
    case <-ctx.Done():
        break
    default:
    }
    wg.Add(1)
    go func(i int) {
        defer wg.Done()
        if i == 1 {
            cancel() // signal others
            return
        }
        fmt.Println(i)
    }(i)
}
wg.Wait()
```

**Key lesson**: Labels cannot cross function boundaries. For cross-goroutine signalling, use channels or contexts.
</details>

---

## Bug 11 🔴 — `continue` In a `for { select { ... } }` Targeting the Wrong Loop

```go
package main

import "fmt"

func main() {
    items := []int{1, 2, 3, 4, 5}
    for _, x := range items {
        select {
        case <-time.After(0):
            if x%2 == 0 {
                continue // BUG: continues the for-range, but is it intentional?
            }
            fmt.Println(x)
        }
    }
}
```

<details>
<summary>Solution</summary>

**Discussion**: A bare `continue` inside `for { select { } }` (with `for` having an iteration variable) targets the for. This is correct in this snippet — `continue` advances `range items`. The bug is only in code style: it can be unclear to readers.

If the writer wanted to advance to the next `select` case in a `for { select { ... } }` shape, that is meaningless — `select` already exits after one case.

**Clarification**:
```go
Items:
for _, x := range items {
    select {
    case <-time.After(0):
        if x%2 == 0 {
            continue Items // explicit
        }
        fmt.Println(x)
    }
}
```

The label makes intent obvious.

**Key lesson**: Inside `for { select { } }`, plain `continue` advances the `for`. Use a label to make intent explicit when the structure is large.
</details>

---

## Bug 12 🔴 — `break` In a Labelled Switch Inside a For

```go
package main

import "fmt"

func main() {
    for i := 0; i < 5; i++ {
    Sw:
        switch i {
        case 0, 1:
            fmt.Println("low")
        case 2:
            fmt.Println("two")
            break Sw // unnecessary label
        case 3:
            fmt.Println("three")
            // The author wanted to ALSO exit the for here.
            break Sw // BUG: only exits the switch
        case 4:
            fmt.Println("four")
        }
    }
    fmt.Println("done")
}
```

<details>
<summary>Solution</summary>

**Bug**: At `case 3`, the author intended to break out of the for entirely, but `break Sw` only exits the switch (the label is on the switch). Output:
```
low
low
two
three
four
done
```

**Fix** — label the for:
```go
Outer:
for i := 0; i < 5; i++ {
    switch i {
    case 0, 1:
        fmt.Println("low")
    case 2:
        fmt.Println("two")
    case 3:
        fmt.Println("three")
        break Outer // exits the for
    case 4:
        fmt.Println("four")
    }
}
fmt.Println("done")
```

Output:
```
low
low
two
three
done
```

**Key lesson**: A label sits where you place it. If you want to break the for, label the for, not the switch.
</details>

---

## Bonus Bug 🔴 — Forgetting Label After Refactor

```go
package main

import "fmt"

func main() {
    items := [][]int{
        {1, 2, 3},
        {4, 5, 6},
        {7, 8, 9},
    }
    var found int
Search:
    for _, row := range items {
        for _, v := range row {
            if v == 5 {
                found = v
                // After refactor, this break used to be `break Search`
                break
            }
        }
    }
    fmt.Println(found)
}
```

<details>
<summary>Solution</summary>

**Bug**: Someone refactored and removed `Search` from `break Search`, but left the label declaration. Compile error:
```
./main.go: label Search defined and not used
```

**Fix** (option A — restore the labelled break):
```go
Search:
for _, row := range items {
    for _, v := range row {
        if v == 5 {
            found = v
            break Search
        }
    }
}
```

**Fix** (option B — remove the label):
```go
for _, row := range items {
    for _, v := range row {
        if v == 5 {
            found = v
            break
        }
    }
}
```

The compiler error caught the inconsistency. This is a feature, not a nuisance.

**Key lesson**: The "unused label" rule prevents stale labels from accumulating. Trust the compiler — fix the inconsistency.
</details>
