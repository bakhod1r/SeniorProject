# Go switch Statement — Find the Bug

## Instructions

Each exercise contains buggy Go code. Your task is to identify the bug, explain why it is wrong, and provide the correct fix. Difficulty levels: 🟢 Easy, 🟡 Medium, 🔴 Hard.

---

## Bug 1 🟢 — Missing Default in Security Check

```go
package main

import "fmt"

func checkPermission(role string) bool {
    switch role {
    case "admin":
        return true
    case "user":
        return false
    }
    return true // intention: fallback to allow
}

func main() {
    fmt.Println(checkPermission("admin"))    // true
    fmt.Println(checkPermission("user"))     // false
    fmt.Println(checkPermission("attacker")) // ???
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
What does the function return when the role is not "admin" or "user"? Is that the intended behavior for an unknown role?
</details>

<details>
<summary>Solution</summary>

**Bug**: The function returns `true` (allow) for any unknown role. An attacker can pass any string not in the switch and gain access. The `return true` after the switch is a security vulnerability.

**Fix**:
```go
func checkPermission(role string) bool {
    switch role {
    case "admin":
        return true
    case "user":
        return false
    default:
        // Unknown role: deny by default
        return false
    }
}
```

**Key lesson**: In security-sensitive code, always use `default` that denies/rejects. Never fall through to a permissive default.
</details>

---

## Bug 2 🟢 — Break Does Not Exit the Loop

```go
package main

import "fmt"

func findFirst(items []string, target string) int {
    for i, item := range items {
        switch item {
        case target:
            fmt.Printf("Found at index %d\n", i)
            break // intention: stop searching
        }
    }
    return -1
}

func main() {
    items := []string{"apple", "banana", "cherry", "date"}
    findFirst(items, "banana")
    // Expected: prints once and stops
    // Actual: keeps looping
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
What does `break` exit when it is inside a switch that is inside a for loop?
</details>

<details>
<summary>Solution</summary>

**Bug**: `break` inside a switch exits only the switch, not the enclosing `for` loop. The loop continues checking all items even after finding the target.

**Fix** (use labeled break):
```go
func findFirst(items []string, target string) int {
loop:
    for i, item := range items {
        switch item {
        case target:
            fmt.Printf("Found at index %d\n", i)
            break loop // exits the for loop
        }
    }
    return -1
}
```

**Alternative fix** (use return):
```go
func findFirst(items []string, target string) int {
    for i, item := range items {
        if item == target {
            fmt.Printf("Found at index %d\n", i)
            return i
        }
    }
    return -1
}
```
</details>

---

## Bug 3 🟢 — Fallthrough is Unconditional

```go
package main

import "fmt"

func describeNumber(n int) {
    switch {
    case n < 0:
        fmt.Println("negative")
        fallthrough
    case n == 0:
        fmt.Println("zero")
    case n > 0:
        fmt.Println("positive")
    }
}

func main() {
    describeNumber(-5)
    // Expected: "negative"
    // Actual: ???
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
What does `fallthrough` do exactly? Does it check the next case's condition?
</details>

<details>
<summary>Solution</summary>

**Bug**: `fallthrough` does NOT check the condition of the next case. It unconditionally executes the next case body. So for `n = -5`, the code prints "negative" AND "zero" even though `n == 0` is false.

**Output of buggy code for -5**: 
```
negative
zero
```

**Fix** (remove fallthrough):
```go
func describeNumber(n int) {
    switch {
    case n < 0:
        fmt.Println("negative")
    case n == 0:
        fmt.Println("zero")
    case n > 0:
        fmt.Println("positive")
    }
}
```

**Key lesson**: `fallthrough` is unconditional — it always executes the next case body regardless of that case's condition.
</details>

---

## Bug 4 🟢 — fallthrough in Last Case

```go
package main

import "fmt"

func process(x int) {
    switch x {
    case 1:
        fmt.Println("one")
        fallthrough
    case 2:
        fmt.Println("two")
        fallthrough // BUG
    }
}

func main() {
    process(1)
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
Where is `fallthrough` not allowed?
</details>

<details>
<summary>Solution</summary>

**Bug**: `fallthrough` cannot appear in the last case of a switch statement. This is a **compile error**: `cannot fallthrough final case in switch`.

**Fix**:
```go
func process(x int) {
    switch x {
    case 1:
        fmt.Println("one")
        fallthrough
    case 2:
        fmt.Println("two")
        // No fallthrough needed — case 2 is last
    }
}
```

**Key lesson**: `fallthrough` can only appear in a non-final case. If you want the last case to do something additional, call a function explicitly.
</details>

---

## Bug 5 🟡 — Typed Nil Does Not Match nil Case

```go
package main

import "fmt"

type MyError struct{ msg string }

func (e *MyError) Error() string { return e.msg }

func process() error {
    var err *MyError = nil  // typed nil
    return err              // returns typed nil as error interface
}

func main() {
    err := process()
    switch err {
    case nil:
        fmt.Println("no error")  // Expected to print this
    default:
        fmt.Println("error occurred:", err)  // Actually prints this!
    }
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
An `error` interface value is nil only when BOTH its type AND value pointers are nil. What happens when you return a typed nil as an interface?
</details>

<details>
<summary>Solution</summary>

**Bug**: When `*MyError(nil)` is returned as `error`, the resulting interface has a non-nil type pointer (`*MyError`) and a nil value pointer. This interface is NOT nil even though the underlying value is nil. So `err == nil` is false.

**Fix 1** — Return untyped nil:
```go
func process() error {
    // Check the typed nil before returning
    var err *MyError = nil
    if err == nil {
        return nil  // return untyped nil
    }
    return err
}
```

**Fix 2** — Check at the call site with type assertion:
```go
err := process()
if err == nil {
    fmt.Println("no error")
} else {
    fmt.Println("error:", err)
}
// This still won't work for the typed nil case

// Correct check:
switch e := err.(type) {
case *MyError:
    if e == nil {
        fmt.Println("no error (typed nil)")
    } else {
        fmt.Println("MyError:", e.msg)
    }
case nil:
    fmt.Println("no error")
}
```

**Key lesson**: Never return a typed nil as an interface from a function. Always return untyped `nil` when there is no error.
</details>

---

## Bug 6 🟡 — Multiple Interface Types per Case Loses Type Info

```go
package main

import "fmt"

type Cat struct{ name string }
type Dog struct{ name string }

func (c Cat) Speak() string { return "meow" }
func (d Dog) Speak() string { return "woof" }

func greet(animal interface{}) {
    switch v := animal.(type) {
    case Cat, Dog:  // Multiple types in one case
        fmt.Printf("Hello %s, you say %s\n", v.name, v.Speak())
        // BUG: v.name and v.Speak() won't work here
    }
}

func main() {
    greet(Cat{name: "Whiskers"})
    greet(Dog{name: "Rex"})
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
When multiple types are listed in a single type switch case, what type does `v` have?
</details>

<details>
<summary>Solution</summary>

**Bug**: When multiple types appear in one case (`case Cat, Dog:`), the variable `v` has type `interface{}` — NOT `Cat` or `Dog`. You cannot call `v.name` (unexported via interface) or `v.Speak()` (not in the interface) on an `interface{}` value. This is a **compile error**.

**Fix** — Separate the cases:
```go
type Animal interface {
    Speak() string
    Name() string
}

type Cat struct{ name string }
type Dog struct{ name string }

func (c Cat) Speak() string { return "meow" }
func (d Dog) Speak() string { return "woof" }
func (c Cat) Name() string  { return c.name }
func (d Dog) Name() string  { return d.name }

func greet(animal interface{}) {
    switch v := animal.(type) {
    case Cat:
        fmt.Printf("Hello %s, you say %s\n", v.name, v.Speak())
    case Dog:
        fmt.Printf("Hello %s, you say %s\n", v.name, v.Speak())
    default:
        fmt.Printf("Unknown animal: %T\n", v)
    }
}
```

**Alternative** — Use an interface:
```go
func greet(animal interface{}) {
    switch v := animal.(type) {
    case Animal:  // single interface type
        fmt.Printf("Hello %s, you say %s\n", v.Name(), v.Speak())
    default:
        fmt.Printf("Unknown: %T\n", v)
    }
}
```
</details>

---

## Bug 7 🟡 — Switch Expression Evaluated With Side Effect

```go
package main

import "fmt"

var callCount int

func getValue() int {
    callCount++
    return 42
}

func main() {
    switch getValue() {
    case 42:
        fmt.Println("got 42")
        // Thinking: re-evaluate getValue() for each case check
    case 0:
        fmt.Println("got 0")
    }
    fmt.Printf("getValue called %d time(s)\n", callCount)
    // Expected by confused developer: called 2 times
    // Actual: called 1 time
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
How many times is the switch expression evaluated? Is this a bug in understanding or in the code?
</details>

<details>
<summary>Solution</summary>

**Bug**: This is a conceptual misunderstanding. The switch expression is evaluated EXACTLY ONCE, not once per case. So `getValue()` is called only 1 time. The developer may have incorrectly assumed it was called for each case.

**This is actually correct behavior** — but if a developer writes code EXPECTING multiple evaluations, they have a design bug.

**Example of the real bug** — modifying state in the switch expression:
```go
// BUG: developer expects i++ to run for each case check
i := 0
switch i++ {  // i becomes 1, but switch is on original value 0
case 0:
    fmt.Println("zero")   // prints — because switch value is 0
case 1:
    fmt.Println("one")    // never runs
}
fmt.Println(i)  // 1 (i was incremented once)
```

**Key lesson**: The switch expression is evaluated once. Do not use expressions with side effects in switch.
</details>

---

## Bug 8 🟡 — Using switch in goroutine Without Synchronization

```go
package main

import (
    "fmt"
    "sync"
)

type State int

const (
    StateIdle State = iota
    StateRunning
    StateStopped
)

type Machine struct {
    state State
}

func (m *Machine) Process(cmd string) {
    // BUG: reading m.state without lock
    switch m.state {
    case StateIdle:
        if cmd == "start" {
            m.state = StateRunning
            fmt.Println("started")
        }
    case StateRunning:
        if cmd == "stop" {
            m.state = StateStopped
            fmt.Println("stopped")
        }
    case StateStopped:
        fmt.Println("already stopped")
    }
}

func main() {
    m := &Machine{state: StateIdle}
    var wg sync.WaitGroup
    for i := 0; i < 10; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            m.Process("start")
        }()
    }
    wg.Wait()
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
What happens when multiple goroutines read and write `m.state` concurrently without synchronization?
</details>

<details>
<summary>Solution</summary>

**Bug**: Data race. Multiple goroutines concurrently read `m.state` (in the switch) and write it (`m.state = StateRunning`). This is undefined behavior in Go's memory model.

Detect with: `go run -race main.go`

**Fix** — Use a mutex:
```go
type Machine struct {
    mu    sync.Mutex
    state State
}

func (m *Machine) Process(cmd string) {
    m.mu.Lock()
    defer m.mu.Unlock()

    switch m.state {
    case StateIdle:
        if cmd == "start" {
            m.state = StateRunning
            fmt.Println("started")
        }
    case StateRunning:
        if cmd == "stop" {
            m.state = StateStopped
            fmt.Println("stopped")
        }
    case StateStopped:
        fmt.Println("already stopped")
    }
}
```

**Key lesson**: Any switch that reads shared mutable state must be protected by a mutex or use atomic operations.
</details>

---

## Bug 9 🔴 — Fallthrough in Type Switch

```go
package main

import "fmt"

func process(v interface{}) {
    switch t := v.(type) {
    case int:
        fmt.Println("int:", t)
        fallthrough  // attempt to share string processing
    case string:
        fmt.Println("string:", t)
    default:
        fmt.Printf("other: %T\n", t)
    }
}

func main() {
    process(42)
    process("hello")
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
Is `fallthrough` allowed in type switches?
</details>

<details>
<summary>Solution</summary>

**Bug**: `fallthrough` is NOT allowed in type switch statements. This is a **compile error**: `cannot fallthrough in type switch`.

The reason: in a type switch, `t` is bound to a different concrete type in each case. Using `fallthrough` would require `t` to be both `int` and `string` simultaneously — impossible.

**Fix** — Extract shared logic to a function:
```go
func process(v interface{}) {
    switch t := v.(type) {
    case int:
        fmt.Println("int:", t)
        printValue(fmt.Sprintf("%d", t))
    case string:
        fmt.Println("string:", t)
        printValue(t)
    default:
        fmt.Printf("other: %T\n", t)
    }
}

func printValue(s string) {
    fmt.Println("value:", s)
}
```

**Key lesson**: Shared logic between type switch cases must be expressed via function calls, not `fallthrough`.
</details>

---

## Bug 10 🔴 — Incorrect State Transition Order

```go
package main

import "fmt"

type Phase int

const (
    PhaseInit Phase = iota
    PhaseRunning
    PhaseDone
    PhaseError
)

func (p Phase) String() string {
    switch p {
    case PhaseInit:    return "Init"
    case PhaseRunning: return "Running"
    case PhaseDone:    return "Done"
    case PhaseError:   return "Error"
    default:           return "Unknown"
    }
}

func advance(p Phase) Phase {
    switch p {
    case PhaseInit:
        return PhaseRunning
    case PhaseRunning:
        return PhaseDone
    case PhaseDone:
        return PhaseInit // BUG: resets to Init instead of terminal
    default:
        return PhaseError
    }
}

func runPipeline() {
    phase := PhaseInit
    for phase != PhaseDone {
        fmt.Printf("Phase: %s\n", phase)
        phase = advance(phase)
        if phase == PhaseError {
            fmt.Println("Error!")
            return
        }
    }
    fmt.Printf("Phase: %s\n", phase)
    fmt.Println("Pipeline complete!")
}

func main() {
    runPipeline()
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
What happens when `advance(PhaseDone)` is called? Does the loop termination condition ever become true?
</details>

<details>
<summary>Solution</summary>

**Bug**: `advance(PhaseDone)` returns `PhaseInit` instead of `PhaseDone` (terminal). The loop condition is `phase != PhaseDone`, so when we reach Done, we advance it back to Init, and the pipeline loops forever (or until PhaseError which never happens here).

**Expected behavior**: `PhaseDone` is a terminal state — it should not advance.

**Fix**:
```go
func advance(p Phase) Phase {
    switch p {
    case PhaseInit:
        return PhaseRunning
    case PhaseRunning:
        return PhaseDone
    case PhaseDone:
        return PhaseDone // terminal — stay in Done
    default:
        return PhaseError
    }
}
```

**Or** — return error for invalid advance on terminal state:
```go
func advance(p Phase) (Phase, error) {
    switch p {
    case PhaseInit:
        return PhaseRunning, nil
    case PhaseRunning:
        return PhaseDone, nil
    case PhaseDone:
        return PhaseDone, fmt.Errorf("advance called on terminal state Done")
    default:
        return PhaseError, fmt.Errorf("advance called on unknown phase: %v", p)
    }
}
```
</details>

---

## Bug 11 🔴 — Switch on Interface{} vs concrete type

```go
package main

import "fmt"

func classify(v interface{}) string {
    switch v {
    case 0:
        return "zero int"
    case "":
        return "empty string"
    case false:
        return "false bool"
    default:
        return fmt.Sprintf("other: %v (%T)", v, v)
    }
}

func main() {
    fmt.Println(classify(0))
    fmt.Println(classify(int64(0)))  // Does this match case 0?
    fmt.Println(classify(0.0))       // Does this match case 0?
    fmt.Println(classify(""))
    fmt.Println(classify(false))
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
When switching on an `interface{}`, how does Go compare case values? Does `0` (int) equal `int64(0)` or `0.0` (float64)?
</details>

<details>
<summary>Solution</summary>

**Bug**: When switching on `interface{}`, Go uses interface equality. Two interface values are equal only if they have the same dynamic type AND equal values. So:
- `interface{}(0)` (type=int) != `interface{}(int64(0))` (type=int64) — different types!
- `interface{}(0)` (type=int) != `interface{}(0.0)` (type=float64) — different types!

**Output of buggy code**:
```
zero int
other: 0 (int64)    ← did NOT match case 0
other: 0 (float64)  ← did NOT match case 0
empty string
false bool
```

This is usually unexpected behavior. The developer likely intended all numeric zeros to match.

**Fix** — Use type switch for proper type-aware matching:
```go
func classify(v interface{}) string {
    switch val := v.(type) {
    case int:
        if val == 0 { return "zero int" }
        return fmt.Sprintf("int: %d", val)
    case int64:
        if val == 0 { return "zero int64" }
        return fmt.Sprintf("int64: %d", val)
    case float64:
        if val == 0.0 { return "zero float64" }
        return fmt.Sprintf("float64: %f", val)
    case string:
        if val == "" { return "empty string" }
        return fmt.Sprintf("string: %q", val)
    case bool:
        if !val { return "false bool" }
        return "true bool"
    default:
        return fmt.Sprintf("other: %v (%T)", val, val)
    }
}
```
</details>

---

## Bug 12 🔴 — Init Statement Variable Shadow

```go
package main

import "fmt"

func getStatus() string { return "active" }

func main() {
    status := "inactive"
    fmt.Println("Before:", status)

    switch status := getStatus(); status {
    case "active":
        fmt.Println("Switch: active")
        // Intend to use outer status here
        fmt.Println("Outer status:", status) // BUG: prints inner status
    case "inactive":
        fmt.Println("Switch: inactive")
    }

    fmt.Println("After:", status) // Is this "inactive" or "active"?
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
The switch init statement declares a new `status` variable. Does it shadow the outer `status`?
</details>

<details>
<summary>Solution</summary>

**Bug**: The init statement `status := getStatus()` declares a NEW variable `status` scoped to the switch block. It shadows the outer `status`. Inside the switch cases, `status` refers to the inner variable ("active"), not the outer one ("inactive").

**Output**:
```
Before: inactive
Switch: active
Outer status: active   ← shows inner "active", not outer "inactive"
After: inactive        ← outer status is unchanged
```

If the developer intended to update the outer `status`, this is a bug.

**Fix** — Use a different variable name in the init statement:
```go
switch s := getStatus(); s {
case "active":
    fmt.Println("Switch: active")
    fmt.Println("Outer status:", status) // now correctly shows outer
case "inactive":
    fmt.Println("Switch: inactive")
}
```

**Or** — Assign to outer variable:
```go
status = getStatus()  // assign (not declare) before switch
switch status {
case "active":
    fmt.Println("active, outer status:", status)
}
```
</details>
