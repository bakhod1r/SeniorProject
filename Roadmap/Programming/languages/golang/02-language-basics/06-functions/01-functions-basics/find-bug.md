# Go Functions Basics — Find the Bug

## Instructions

Each exercise contains buggy Go code related to function declarations, calls, parameters, returns, or `defer`. Identify the bug, explain why it occurs, and provide the corrected code. Difficulty: 🟢 Easy, 🟡 Medium, 🔴 Hard.

---

## Bug 1 🟢 — Missing Return

```go
package main

import "fmt"

func absolute(n int) int {
    if n < 0 {
        return -n
    }
}

func main() {
    fmt.Println(absolute(-5))
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
What does the compiler require for every code path of a function with a result type?
</details>

<details>
<summary>Solution</summary>

**Bug**: The function returns `-n` only when `n < 0`. If `n >= 0`, control falls off the end of the function with no `return` — a **compile error**: `missing return at end of function`.

**Fix**:
```go
func absolute(n int) int {
    if n < 0 {
        return -n
    }
    return n
}
```

**Key lesson**: Every code path of a non-void function must end in a terminating statement (`return`, `panic`, `os.Exit`, infinite loop, or labeled goto). The compiler does NOT analyze whether a path is logically reachable.
</details>

---

## Bug 2 🟢 — Wrong Return Type

```go
package main

import "fmt"

func ageNextYear(age int) string {
    return age + 1
}

func main() {
    fmt.Println(ageNextYear(29))
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
The declared return type vs. the type of the returned expression.
</details>

<details>
<summary>Solution</summary>

**Bug**: `age + 1` is an `int`, but the function declares its return type as `string`. **Compile error**: `cannot use age + 1 (untyped int constant 1 + age) as string in return statement`.

**Fix** (option A — convert to string):
```go
import "strconv"

func ageNextYear(age int) string {
    return strconv.Itoa(age + 1)
}
```

**Fix** (option B — change return type):
```go
func ageNextYear(age int) int {
    return age + 1
}
```

**Key lesson**: Go has no implicit conversion between numeric and string types — even between numeric types like `int` and `int64`. Use `strconv.Itoa`, `fmt.Sprintf`, or explicit conversions.
</details>

---

## Bug 3 🟢 — Trying to Mutate a Pass-by-Value Argument

```go
package main

import "fmt"

func setToZero(x int) {
    x = 0
}

func main() {
    n := 42
    setToZero(n)
    fmt.Println(n) // expected 0
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
How does Go pass arguments — by value or by reference?
</details>

<details>
<summary>Solution</summary>

**Bug**: Go passes arguments **by value**. `setToZero` receives a copy of `n`. Modifying the copy does not affect the caller's variable. Output: `42`, not `0`.

**Fix** (use a pointer):
```go
func setToZero(x *int) {
    *x = 0
}

func main() {
    n := 42
    setToZero(&n)
    fmt.Println(n) // 0
}
```

**Key lesson**: Every parameter in Go is a local copy. To allow mutation by the callee, pass a pointer. This rule applies even to slices and maps (their headers are copied; the data is shared — see 2.7.3).
</details>

---

## Bug 4 🟢 — Two Functions With the Same Name

```go
package main

import "fmt"

func add(a, b int) int     { return a + b }
func add(a, b float64) float64 { return a + b }

func main() {
    fmt.Println(add(1, 2))
    fmt.Println(add(1.5, 2.5))
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
Does Go allow function overloading?
</details>

<details>
<summary>Solution</summary>

**Bug**: Go does NOT support function overloading. Two top-level functions in the same package cannot share a name. **Compile error**: `add redeclared in this block`.

**Fix** (option A — distinct names):
```go
func addInts(a, b int) int           { return a + b }
func addFloats(a, b float64) float64 { return a + b }
```

**Fix** (option B — generics, Go 1.18+):
```go
func Add[T int | float64](a, b T) T { return a + b }
```

**Key lesson**: Each function name in a package must be unique. Use distinct names, generics, or interfaces to express polymorphism.
</details>

---

## Bug 5 🟡 — `defer` Argument Evaluated Eagerly

```go
package main

import "fmt"

func main() {
    i := 1
    defer fmt.Println("i =", i)
    i = 99
}
```

The author expected `i = 99` to print. What actually prints?

<details>
<summary>Hint</summary>
When does `defer` evaluate its arguments — at the time of the `defer` statement, or at the time of the deferred call?
</details>

<details>
<summary>Solution</summary>

**Bug**: `defer` evaluates the **arguments** of the call at the moment the `defer` statement executes, not when the deferred call runs. So `i` is captured as `1`. The deferred `fmt.Println` runs at function exit and prints `i = 1`.

Output:
```
i = 1
```

**Fix** (defer a closure that captures `i` by reference):
```go
i := 1
defer func() {
    fmt.Println("i =", i)
}()
i = 99
// At return: i = 99
```

**Key lesson**: With `defer call(args)`, **args are eager, the call is lazy**. Wrap in a closure when you want late evaluation.
</details>

---

## Bug 6 🟡 — `defer` Inside a Loop Holds Resources Too Long

```go
package main

import (
    "fmt"
    "os"
)

func processFiles(paths []string) error {
    for _, p := range paths {
        f, err := os.Open(p)
        if err != nil {
            return err
        }
        defer f.Close() // BUG
        // ... process f ...
        _ = f
    }
    return nil
}

func main() {
    _ = processFiles([]string{"a.txt", "b.txt"})
    fmt.Println("done")
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
When does each deferred `f.Close()` actually run? What if `paths` has 10 000 entries?
</details>

<details>
<summary>Solution</summary>

**Bug**: `defer` runs at **function exit**, not at the end of each loop iteration. Every `f.Close()` is queued and runs only after the loop and the entire function complete. With many files, all file descriptors stay open simultaneously — easy to hit the OS limit (`EMFILE`, "too many open files").

Additionally, the deferred records consume memory across iterations (open-coded defer optimization is disabled inside loops).

**Fix** — extract a helper so each defer scope is per-file:
```go
func processFiles(paths []string) error {
    for _, p := range paths {
        if err := processOne(p); err != nil {
            return err
        }
    }
    return nil
}

func processOne(path string) error {
    f, err := os.Open(path)
    if err != nil {
        return err
    }
    defer f.Close() // runs at end of processOne — once per file
    // ... process f ...
    _ = f
    return nil
}
```

**Key lesson**: Never `defer` a per-iteration cleanup inside a long-running loop. Extract a per-iteration helper function so the defer scope is bounded.
</details>

---

## Bug 7 🟡 — Calling a `nil` Function Variable

```go
package main

import "fmt"

type Handler func(string)

var handlers = map[string]Handler{
    "greet": func(name string) { fmt.Println("hi", name) },
}

func dispatch(event string, payload string) {
    h := handlers[event]
    h(payload)
}

func main() {
    dispatch("greet", "Ada")
    dispatch("unknown", "Linus") // BUG
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
What is the zero value of a function type? What happens when you look up a missing key in a map?
</details>

<details>
<summary>Solution</summary>

**Bug**: `handlers["unknown"]` returns the zero value for `Handler`, which is `nil`. Calling `nil(payload)` panics: `runtime error: invalid memory address or nil pointer dereference`.

**Fix** — check before calling, or use comma-ok:
```go
func dispatch(event string, payload string) {
    h, ok := handlers[event]
    if !ok {
        fmt.Println("no handler for", event)
        return
    }
    h(payload)
}
```

Or with a nil check:
```go
if h := handlers[event]; h != nil {
    h(payload)
}
```

**Key lesson**: A map lookup of a missing key returns the zero value of the value type silently. For function-typed maps, this means `nil`. Always check before invoking.
</details>

---

## Bug 8 🟡 — Method Value Captures the Receiver Wrong

```go
package main

import "fmt"

type Counter struct{ n int }

func (c Counter) Show() { fmt.Println(c.n) }

func main() {
    c := Counter{n: 1}
    show := c.Show
    c.n = 99
    show() // expected 99
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
The receiver of `Show` is a **value**, not a pointer. What does the method value capture?
</details>

<details>
<summary>Solution</summary>

**Bug**: `Show` has a **value receiver**. `c.Show` is a method value that captures a **copy** of `c` at the moment of the binding (`c.n == 1`). Subsequent modifications to `c.n` are not visible to `show`. Output: `1`.

**Fix** (option A — pointer receiver):
```go
func (c *Counter) Show() { fmt.Println(c.n) }

c := Counter{n: 1}
show := c.Show // captures &c
c.n = 99
show() // 99
```

**Fix** (option B — call the method directly each time, instead of binding):
```go
c := Counter{n: 1}
c.n = 99
c.Show() // 99
```

**Key lesson**: Method values bound to value receivers freeze a snapshot. If you need to see live updates, use a pointer receiver.
</details>

---

## Bug 9 🔴 — Init Order Trap

`config.go`:
```go
package main

import "fmt"

var Threshold = computeThreshold()

func computeThreshold() int {
    fmt.Println("computing threshold")
    return Multiplier * 10
}

var Multiplier = 5
```

`main.go`:
```go
package main

import "fmt"

func main() {
    fmt.Println("Threshold:", Threshold)
}
```

The author expects `Threshold` to be `50`. What does it actually compute?

<details>
<summary>Hint</summary>
In what order are package-level variables initialized?
</details>

<details>
<summary>Solution</summary>

**Bug**: Package-level variables are initialized in **dependency order** (variables a variable depends on are initialized first). Here, `Threshold` depends on `computeThreshold()`, which depends on `Multiplier`. Go correctly orders `Multiplier` before `Threshold` based on this dependency.

**However**, if you remove the use of `Multiplier` from `computeThreshold` (or reference it indirectly via reflection), Go falls back to source-declaration order. In *that* case, `Multiplier` would still be `0` (its zero value) when `computeThreshold` runs, producing `Threshold = 0`.

In this particular code as written, output is:
```
computing threshold
Threshold: 50
```
because Go's dependency analysis catches the reference. But the **bug pattern** is real: if the dependency is hidden behind a function or interface that the analyzer cannot trace, you get unexpected zero values.

**Robust fix** — use `init()` for ordering-sensitive setup:
```go
var Threshold int
var Multiplier = 5

func init() {
    Threshold = Multiplier * 10
}
```

Or move the constant inline:
```go
const Multiplier = 5
var Threshold = Multiplier * 10
```

**Key lesson**: Package variable initialization is dependency-driven, but only via *direct, visible* references. Hidden dependencies (through interfaces, reflection, function values) can produce zero-value bugs. Use `init()` or `sync.Once` when ordering matters.
</details>

---

## Bug 10 🔴 — Closure Capturing Loop Variable in Goroutine (Pre-1.22 Behavior)

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    var wg sync.WaitGroup
    var results = make([]int, 5)

    for i := 0; i < 5; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            results[i] = i * i
        }()
    }
    wg.Wait()
    fmt.Println(results)
}
```

The author expected `[0 1 4 9 16]`. What can actually happen?

<details>
<summary>Hint</summary>
What does Go 1.22's loop-variable semantic change cover, and what does it NOT cover?
</details>

<details>
<summary>Solution</summary>

**Bug**: This is a C-style `for` loop (not `for range`). The Go 1.22 per-iteration loop variable change applies **only to `for range`**. C-style `for` still shares one `i` variable across all iterations.

The goroutines may all see `i == 5` by the time they execute, producing `index out of range` panics on `results[5]`. Even if they hit valid indices, results are non-deterministic and you have a data race on `i`.

**Fix** (option A — pass `i` as an argument):
```go
for i := 0; i < 5; i++ {
    wg.Add(1)
    go func(i int) {
        defer wg.Done()
        results[i] = i * i
    }(i)
}
```

**Fix** (option B — shadow `i`):
```go
for i := 0; i < 5; i++ {
    i := i // create a per-iteration local copy
    wg.Add(1)
    go func() {
        defer wg.Done()
        results[i] = i * i
    }()
}
```

**Fix** (option C — use `for range`, which IS per-iteration in Go 1.22+):
```go
for i := range results {
    wg.Add(1)
    go func() {
        defer wg.Done()
        results[i] = i * i
    }()
}
```

**Key lesson**: Go 1.22's per-iteration loop variable change applies to `for range`, NOT to C-style `for i := 0; ...; i++`. The classic capture-by-shadow or capture-by-arg fixes still apply to C-style loops in all Go versions.
</details>

---

## Bug 11 🔴 — Recover Outside a Deferred Function

```go
package main

import "fmt"

func mayPanic() {
    panic("boom")
}

func safe() {
    defer fmt.Println("after panic")
    if r := recover(); r != nil {
        fmt.Println("recovered:", r)
    }
    mayPanic()
}

func main() {
    safe()
    fmt.Println("survived")
}
```

The author expected `safe` to recover. What actually happens?

<details>
<summary>Hint</summary>
What is the exact requirement for `recover` to stop a panic?
</details>

<details>
<summary>Solution</summary>

**Bug**: `recover()` only stops a panic when called **directly inside a deferred function**. Here, `recover` is called **before** `mayPanic`, in the normal execution path. At that moment there is no panic in progress, so `recover()` returns nil. The panic from `mayPanic()` then propagates and crashes the program.

The deferred `fmt.Println("after panic")` does run during unwinding, so you see:
```
after panic
panic: boom

goroutine 1 [running]:
...
```

**Fix** — wrap `recover` in a deferred closure:
```go
func safe() {
    defer func() {
        if r := recover(); r != nil {
            fmt.Println("recovered:", r)
        }
    }()
    mayPanic()
}
```

Now: when `mayPanic` panics, the deferred function runs during unwinding, `recover()` catches the panic, and `safe` returns normally.

**Key lesson**: `recover` is a "magic" builtin only effective inside a deferred function during a panic. Always pair it with `defer func() { ... recover() ... }()`.
</details>

---

## Bug 12 🔴 — Closure Holding a Large Object Alive

```go
package main

import (
    "fmt"
    "runtime"
)

type BigBlob struct {
    data [1 << 20]byte // 1 MiB
}

func makeReporter(b *BigBlob) func() int {
    return func() int {
        return int(b.data[0])
    }
}

func main() {
    var fns []func() int
    for i := 0; i < 100; i++ {
        b := &BigBlob{}
        fns = append(fns, makeReporter(b))
    }
    runtime.GC()
    var ms runtime.MemStats
    runtime.ReadMemStats(&ms)
    fmt.Printf("Heap: %d MB\n", ms.HeapAlloc/(1024*1024))
    _ = fns
}
```

The author expected the heap to be near zero after `runtime.GC()`. Instead, it shows ~100 MB. Why?

<details>
<summary>Hint</summary>
What does each closure in `fns` capture? Can the GC free the `BigBlob`s?
</details>

<details>
<summary>Solution</summary>

**Bug**: Each closure returned by `makeReporter` captures `b` (the `*BigBlob`). Because `fns` keeps each closure alive, each closure keeps its `*BigBlob` reachable. The GC cannot free any of the 100 `BigBlob` instances — total ~100 MB retained.

**Fix** (option A — capture only what you need):
```go
func makeReporter(b *BigBlob) func() int {
    first := int(b.data[0]) // capture the int, not the pointer
    return func() int {
        return first
    }
}
```

After this fix, the closure captures only an `int`. The `BigBlob` becomes unreachable as soon as `makeReporter` returns and is collected.

**Fix** (option B — clear the reference once you don't need the closure):
```go
fns = nil
runtime.GC()
```

**Key lesson**: Closures capture variables by reference (semantically, by funcval slot). Capturing a pointer to a large object keeps that object alive for the closure's lifetime. Always capture the **minimum** state required.
</details>

---

## Bug 13 🔴 — `recover` in a Goroutine Doesn't Save the Parent

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    defer func() {
        if r := recover(); r != nil {
            fmt.Println("main recovered:", r)
        }
    }()

    var wg sync.WaitGroup
    wg.Add(1)
    go func() {
        defer wg.Done()
        panic("worker failed")
    }()
    wg.Wait()
    fmt.Println("main exiting")
}
```

The author expected `main recovered: worker failed`. What actually happens?

<details>
<summary>Hint</summary>
A panic in goroutine A — does goroutine B's deferred `recover` see it?
</details>

<details>
<summary>Solution</summary>

**Bug**: Each goroutine's panic is **independent**. The `recover` in `main`'s deferred function only catches panics that happen *in `main`'s call stack*. A panic in another goroutine cannot be recovered from `main`. The worker goroutine panics, the runtime crashes the entire program, and main's recover never runs.

**Fix** — recover **inside** the goroutine that may panic:
```go
go func() {
    defer wg.Done()
    defer func() {
        if r := recover(); r != nil {
            fmt.Println("worker recovered:", r)
            // optionally: signal failure to main via a channel
        }
    }()
    panic("worker failed")
}()
```

For composability, wrap the goroutine body:
```go
func safeGo(wg *sync.WaitGroup, fn func()) {
    go func() {
        defer wg.Done()
        defer func() {
            if r := recover(); r != nil {
                // log/report
            }
        }()
        fn()
    }()
}
```

**Key lesson**: Panic / recover is goroutine-local. Each goroutine that may panic must recover for itself, or the entire program crashes. There is no parent-goroutine try/catch.
</details>

---

## Bonus Bug 🔴 — Returning a Pointer to a Local Slice Element

```go
package main

import "fmt"

func firstPointer() *int {
    s := []int{10, 20, 30}
    return &s[0]
}

func main() {
    p := firstPointer()
    fmt.Println(*p) // expected 10
    // ... but is it safe?
}
```

Is the bug *safety* or *performance*?

<details>
<summary>Hint</summary>
Go's escape analysis handles the safety. What about performance and lifetime?
</details>

<details>
<summary>Solution</summary>

**Not unsafe**: Go's escape analysis sees that `&s[0]` escapes via the return value, so the entire backing array of `s` is allocated on the **heap**. The pointer is valid; output is `10`.

**The hidden cost**:

1. The 3-element backing array is heap-allocated even though the function looks like it should be stack-allocated.
2. The returned pointer keeps the **entire backing array** alive (in a 3-element slice, this is just 3×8 bytes; in a 1-million-element slice, it would be 8 MB).
3. If the slice is much larger and you only need one element, returning the pointer holds onto far more memory than expected.

**Fix** — return a value, not a pointer:
```go
func first() int {
    s := []int{10, 20, 30}
    return s[0]
}
```

Now `s` stays on the stack (or is freed when `first` returns), and only the `int` value crosses the function boundary.

**Key lesson**: Returning a pointer to a slice element is safe (Go's GC handles it) but can extend the lifetime of the entire backing array. When you only need a single value, return the value. Reserve pointer returns for cases where mutation through the pointer is the goal.
</details>
