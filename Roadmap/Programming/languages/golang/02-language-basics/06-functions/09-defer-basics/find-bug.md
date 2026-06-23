# Go Defer — Find the Bug

## Instructions

Each exercise contains buggy Go code involving `defer`. Identify the bug, explain why, and provide the corrected code. Difficulty: 🟢 Easy, 🟡 Medium, 🔴 Hard.

---

## Bug 1 🟢 — Defer Before Error Check

```go
package main

import (
    "fmt"
    "os"
)

func read(path string) error {
    f, err := os.Open(path)
    defer f.Close()
    if err != nil {
        return err
    }
    // ... read from f ...
    return nil
}

func main() {
    if err := read("/does/not/exist"); err != nil {
        fmt.Println(err)
    }
}
```

What happens when the file doesn't exist?

<details>
<summary>Solution</summary>

**Bug**: When `os.Open` fails, `f` is `nil`. The deferred `f.Close()` panics with a nil-pointer dereference (or, depending on the version, the close just returns an error you're ignoring — but typically `(*os.File).Close` on nil panics).

**Fix**: check the error before deferring:
```go
f, err := os.Open(path)
if err != nil {
    return err
}
defer f.Close()
```

**Why this is a common bug**: developers reflexively type `defer f.Close()` after every `os.Open`, sometimes before the error check. It looks innocuous because the happy path always works.

**Key lesson**: never defer a release on a resource you haven't verified exists.
</details>

---

## Bug 2 🟢 — Defer Inside Loop Accumulates Handles

```go
package main

import (
    "fmt"
    "os"
)

func processAll(paths []string) error {
    for _, p := range paths {
        f, err := os.Open(p)
        if err != nil {
            return err
        }
        defer f.Close()
        // ... read from f ...
    }
    return nil
}

func main() {
    paths := generateThousandsOfPaths() // 5000 files
    if err := processAll(paths); err != nil {
        fmt.Println(err)
    }
}
```

What goes wrong with 5000 paths?

<details>
<summary>Solution</summary>

**Bug**: each iteration registers a `defer f.Close()` that runs at the end of `processAll` — not at the end of the iteration. After 1024 files (default per-process FD limit on Linux/macOS), `os.Open` starts failing with "too many open files".

**Fix**: extract a helper so each call has its own defer scope:
```go
func processAll(paths []string) error {
    for _, p := range paths {
        if err := processOne(p); err != nil {
            return err
        }
    }
    return nil
}

func processOne(p string) error {
    f, err := os.Open(p)
    if err != nil {
        return err
    }
    defer f.Close()
    // ... read from f ...
    return nil
}
```

**Why this is a common bug**: defer's "runs on function exit" is intuitive once you know it, but newcomers often expect it to behave like a destructor that fires at end-of-scope.

**Key lesson**: defer scope is the **enclosing function**, not any surrounding block. Extract a helper for per-iteration cleanup.
</details>

---

## Bug 3 🟢 — Loop Variable Captured By Reference In Deferred Closure

```go
package main

import "fmt"

func main() {
    items := []string{"alpha", "beta", "gamma"}
    for _, item := range items {
        defer func() { fmt.Println(item) }()
    }
}
```

What does this print?

<details>
<summary>Solution</summary>

**Bug**: in Go ≤ 1.21, all three deferred closures capture the **same** `item` variable. By the time defers fire, `item == "gamma"`. Output (pre-1.22):
```
gamma
gamma
gamma
```

In Go ≥ 1.22 (with `go 1.22` in `go.mod`), each iteration creates a fresh `item`, so the output is:
```
gamma
beta
alpha
```

**Fix** for pre-1.22 — pass as argument or shadow:
```go
for _, item := range items {
    defer func(item string) { fmt.Println(item) }(item) // arg evaluated NOW
}
```

Or:
```go
for _, item := range items {
    item := item
    defer func() { fmt.Println(item) }()
}
```

**Why this is a common bug**: combines two pitfalls — defer's LIFO and closures-capture-by-reference. Without Go 1.22's loop-var fix, this fooled developers for years.

**Key lesson**: deferred closures over loop variables need either Go 1.22+ or the `item := item` shadow.
</details>

---

## Bug 4 🟢 — Deferred Function Modifies Named Return Unexpectedly

```go
package main

import "fmt"

func compute() (n int) {
    defer func() {
        n = 0
    }()
    n = 42
    return n
}

func main() {
    fmt.Println(compute())
}
```

The author expected `42`. What's printed?

<details>
<summary>Solution</summary>

**Bug**: the deferred function modifies the named return `n` to 0 after the `return n` statement assigns 42. Output:
```
0
```

**Fix**: depends on intent. If the deferred logic should NOT modify the return, remove it:
```go
func compute() (n int) {
    n = 42
    return n
}
```

If the deferred logic should not modify based on success, gate it:
```go
func compute() (n int) {
    defer func() {
        if n < 0 { // some condition
            n = 0
        }
    }()
    n = 42
    return n
}
```

**Why this is a common bug**: named returns + defer is a powerful idiom (used for error wrapping), but it's easy to overlook the fact that **defer runs AFTER `return EXPR` assigns the value**.

**Key lesson**: in `func f() (x T)`, a `defer` can mutate `x` after the return statement has written to it. Sequence is: evaluate return expression, assign to named returns, run defers (LIFO), return to caller.
</details>

---

## Bug 5 🟡 — Recover Called From Non-Deferred Function

```go
package main

import "fmt"

func handlePanic() {
    if r := recover(); r != nil {
        fmt.Println("recovered:", r)
    }
}

func main() {
    defer handlePanic() // looks reasonable
    panic("oh no")
}
```

Does this recover?

<details>
<summary>Solution</summary>

**Answer**: actually, **yes**, this works! Because `handlePanic` is the function deferred. `recover` is being called inside `handlePanic`, which is the deferred function.

But wait — let's modify slightly:

```go
func handlePanic() {
    if r := recover(); r != nil {
        fmt.Println("recovered:", r)
    }
}

func cleanup() {
    handlePanic() // calling handlePanic from cleanup, not directly deferred
}

func main() {
    defer cleanup()
    panic("oh no")
}
```

**Now it doesn't work.** `recover` is called in `handlePanic`, which is called by `cleanup`, which is the deferred function. `recover` only works one frame deep — directly inside the deferred function. Output: panic crashes the program.

**Fix**: call `recover()` directly inside the deferred function, or inline `handlePanic` into the defer:
```go
func main() {
    defer func() {
        if r := recover(); r != nil {
            fmt.Println("recovered:", r)
        }
    }()
    panic("oh no")
}
```

Or pass the panic value out:
```go
func cleanup() {
    if r := recover(); r != nil { // recover lives in the deferred function
        fmt.Println("recovered:", r)
    }
}

func main() {
    defer cleanup()
    panic("oh no")
}
```

**Why this is a common bug**: developers refactor recovery logic into a helper for code reuse, then find it stops working.

**Key lesson**: `recover()` only works when called **directly** inside a deferred function. If you wrap it in another function, the wrap must itself be the deferred call.
</details>

---

## Bug 6 🟡 — Argument Evaluated Too Early

```go
package main

import "fmt"

type Logger struct {
    prefix string
}

func (l *Logger) Log(msg string) {
    fmt.Println(l.prefix + ": " + msg)
}

func main() {
    log := &Logger{prefix: "info"}
    defer log.Log("done")
    log.prefix = "debug"
}
```

What's printed?

<details>
<summary>Solution</summary>

**Output**:
```
debug: done
```

**Bug** (or, rather, a subtle non-bug): the deferred call is `log.Log("done")`. The receiver `log` is evaluated at defer-time (it's the pointer). The argument `"done"` is evaluated at defer-time. But the **value** that `log.Log` reads (the pointer's `prefix` field) is read at call-time, when defer fires.

So even though `log` was captured at defer-time, the **content** the method reads through the pointer is whatever it is at call-time.

**The bug appears** when you mutate the *pointer itself*:
```go
log := &Logger{prefix: "info"}
defer log.Log("done")
log = &Logger{prefix: "debug"} // points to a new Logger
// Output: "info: done" (defer captured the original *Logger)
```

**Fix** — to capture the entire receiver state at defer-time, copy:
```go
func main() {
    log := &Logger{prefix: "info"}
    snap := *log // value copy of the struct
    defer (&snap).Log("done")
    log.prefix = "debug"
    // Output: "info: done"
}
```

Or use a closure that captures the value:
```go
prefix := log.prefix
defer func() { fmt.Println(prefix + ": done") }()
```

**Why this is a common bug**: the line between defer-time-capture and call-time-read is subtle for method calls on pointers.

**Key lesson**: defer captures the receiver pointer at defer-time, but the method body still reads through that pointer at call-time. Use a value copy or closure if you want a snapshot.
</details>

---

## Bug 7 🟡 — Mutex Lock But Wrong Order Of Defer

```go
package main

import (
    "fmt"
    "sync"
)

type SafePair struct {
    mu1 sync.Mutex
    mu2 sync.Mutex
}

func (s *SafePair) Both() {
    s.mu1.Lock()
    s.mu2.Lock()
    defer s.mu1.Unlock()
    defer s.mu2.Unlock()
    // ... critical section ...
    fmt.Println("both held")
}
```

What's the bug?

<details>
<summary>Solution</summary>

**Bug**: the unlock order is wrong. Defers run LIFO: `mu2.Unlock` runs first, then `mu1.Unlock`. That happens to be the **correct** unlock order (release in reverse of acquire), so no deadlock here.

The actual bug is more subtle: if `mu2.Lock()` panics (e.g., bad usage), `mu1` is still held and there's no defer to release it. `mu2.Lock` can't normally panic, but the structural risk remains.

**Fix**: defer each unlock immediately after acquiring its lock:
```go
func (s *SafePair) Both() {
    s.mu1.Lock()
    defer s.mu1.Unlock()
    s.mu2.Lock()
    defer s.mu2.Unlock()
    // ... critical section ...
}
```

LIFO automatically gives the correct release order: mu2 unlocks first, then mu1.

**Why this is a common bug**: developers cluster all `defer X.Unlock()` calls at the top of a function for readability, breaking the "panic-safe" guarantee for any operation between Lock A and Lock B.

**Key lesson**: defer-release immediately after acquire. Don't batch defers at the top.
</details>

---

## Bug 8 🟡 — Captured Slice Mutation Affects Deferred Call

```go
package main

import "fmt"

func main() {
    nums := []int{1, 2, 3}
    defer fmt.Println(nums)
    nums[0] = 999
    nums = append(nums, 4)
}
```

What's printed?

<details>
<summary>Solution</summary>

**Output**:
```
[999 2 3]
```

**Bug (or surprise)**: `nums` (the slice header: pointer + len + cap) is captured at defer-time. The header points to the original backing array. Mutating `nums[0] = 999` modifies the backing array — visible to the deferred call.

But `append`'s new slice (with len=4) is **not** visible, because the deferred call has the old slice header.

**Fix** — copy if you want a true snapshot:
```go
snapshot := append([]int(nil), nums...)
defer fmt.Println(snapshot)
```

Or use a closure (sees latest `nums`):
```go
defer func() { fmt.Println(nums) }()
// Output: [999 2 3 4]
```

**Why this is a common bug**: slices are value-but-reference. Defer captures the header (a value), but the header references an array (mutable).

**Key lesson**: deferred calls see whatever the slice header pointed to at defer-time. Mutations to the backing array are visible; appends that allocate a new array are not.
</details>

---

## Bug 9 🔴 — Defer And `os.Exit`

```go
package main

import (
    "fmt"
    "os"
)

func main() {
    defer fmt.Println("cleanup")
    if len(os.Args) < 2 {
        fmt.Println("missing arg")
        os.Exit(1)
    }
    fmt.Println("arg:", os.Args[1])
}
```

Run with no args. Does "cleanup" print?

<details>
<summary>Solution</summary>

**Answer**: No. `os.Exit` terminates the process **immediately**. Deferred calls do NOT run.

**Output** (no args):
```
missing arg
```

(`cleanup` does NOT appear.)

**Fix**: return an error from main and let the program exit normally, or restructure to avoid os.Exit:
```go
func run() error {
    if len(os.Args) < 2 {
        return errors.New("missing arg")
    }
    fmt.Println("arg:", os.Args[1])
    return nil
}

func main() {
    defer fmt.Println("cleanup")
    if err := run(); err != nil {
        fmt.Println(err)
        // os.Exit(1) here would still skip the defer in main, but the
        // defer has already fired? No — main hasn't returned yet.
        // Actually, the defer has been registered but the function body
        // hasn't ended. os.Exit still skips it.
        // Use os.Exit only after manually doing cleanup.
    }
}
```

The Go FAQ explicitly notes: "Calling os.Exit will terminate the program before any deferred functions are run."

**Why this is a common bug**: `os.Exit` looks like a clean way to terminate with a status code, but it bypasses Go's normal cleanup mechanism.

**Key lesson**: never `os.Exit` in a function with deferred cleanup. Restructure to return errors and let the program unwind.
</details>

---

## Bug 10 🔴 — Defer Of Method Value Vs Method Expression

```go
package main

import "fmt"

type Counter struct{ n int }

func (c *Counter) Print() { fmt.Println("n =", c.n) }

func main() {
    c := &Counter{n: 1}
    defer c.Print()
    c.n = 42
}
```

vs:

```go
func main() {
    c := &Counter{n: 1}
    defer (*Counter).Print(c)
    c.n = 42
}
```

What does each print?

<details>
<summary>Solution</summary>

**First version**: `defer c.Print()`. The receiver `c` is evaluated at defer-time (captured as the `*Counter` pointer). The method body reads `c.n` at exit-time. Output:
```
n = 42
```

**Second version**: `defer (*Counter).Print(c)`. The method expression evaluates the function value once (at defer-time); `c` is evaluated as an argument at defer-time. Same result:
```
n = 42
```

Both print 42 because `c` is a pointer; the deferred call dereferences it at exit-time.

**Now consider a value receiver**:

```go
type Counter struct{ n int }
func (c Counter) Print() { fmt.Println("n =", c.n) }

func main() {
    c := Counter{n: 1}
    defer c.Print()
    c.n = 42
}
```

This prints:
```
n = 1
```

**Why?** With a value receiver, `c.Print()` involves an implicit copy of `c` at the call site. The defer evaluates `c` at defer-time and **copies it into the receiver slot**. Later mutations to `c` don't affect the snapshot.

**Fix** — to see the latest, use a closure:
```go
defer func() { c.Print() }()
// prints "n = 42"
```

**Why this is a common bug**: pointer vs value receivers behave differently with defer. Many bugs hinge on this distinction.

**Key lesson**: defer + value receiver = snapshot of the receiver at defer-time. Defer + pointer receiver = follows the pointer at call-time. Use closures if you want call-time evaluation regardless.
</details>

---

## Bug 11 🔴 — Defer Stack Overflow In Recursion

```go
package main

import "fmt"

func recurse(n int) {
    defer fmt.Println(n)
    if n > 0 {
        recurse(n - 1)
    }
}

func main() {
    recurse(1000000)
}
```

What goes wrong with 1,000,000?

<details>
<summary>Solution</summary>

**Bug**: each recursive call registers a defer. With 1,000,000 frames, you have 1,000,000 deferred calls. Even with open-coded defer (which doesn't allocate per defer), the stack itself grows to hold 1M frames — likely exhausting the goroutine stack (which can grow to 1 GB by default but takes substantial time and memory).

The output (if it survives the stack growth) is 1,000,000 numbers printed during unwinding, which is also slow.

**Fix**: convert to iteration, eliminating deep recursion:
```go
func iterate(n int) {
    for i := n; i >= 0; i-- {
        fmt.Println(i)
    }
}
```

Or, if you must recurse, make the defer optional or bounded:
```go
func recurse(n int) {
    if n > 0 {
        recurse(n - 1)
    }
    fmt.Println(n)
}
```

**Why this is a common bug**: programmers used to constant-stack defer overhead don't realize recursive defers compound.

**Key lesson**: recursive functions with defers can cause unexpected stack growth. Each recursion's defer must be retained until that frame returns.
</details>

---

## Bug 12 🔴 — Defer Inside Goroutine That Outlives Its Caller

```go
package main

import (
    "fmt"
    "time"
)

func startWorker() {
    f, err := openFile()
    if err != nil { return }
    defer f.Close() // looks safe

    go func() {
        time.Sleep(time.Second)
        fmt.Println(f.Read())
    }()
}

func main() {
    startWorker()
    time.Sleep(2 * time.Second)
}
```

What goes wrong?

<details>
<summary>Solution</summary>

**Bug**: `startWorker` returns immediately. The deferred `f.Close()` fires when `startWorker` returns — **before** the goroutine sleeps and tries to read from `f`. The goroutine reads from a closed file.

**Fix** — close the file inside the goroutine, or move the defer there:
```go
func startWorker() {
    f, err := openFile()
    if err != nil { return }

    go func() {
        defer f.Close() // close when the goroutine ends
        time.Sleep(time.Second)
        fmt.Println(f.Read())
    }()
}
```

Or use a wait group / channel and synchronize:
```go
func startWorker() error {
    f, err := openFile()
    if err != nil { return err }
    defer f.Close()

    done := make(chan struct{})
    go func() {
        defer close(done)
        time.Sleep(time.Second)
        fmt.Println(f.Read())
    }()
    <-done
    return nil
}
```

**Why this is a common bug**: defer is tied to the function in which it's written, NOT to any goroutine the function spawns. The goroutine outlives the function.

**Key lesson**: a defer in function F doesn't extend the lifetime of resources used by goroutines spawned in F. Move the defer into the goroutine, or join the goroutine before returning.
</details>

---

## Final Summary

The defer bugs in this document fall into a few archetypes:

1. **Resource not yet acquired** (Bug 1): defer before error check.
2. **Wrong scope** (Bugs 2, 12): defer fires too late or too early relative to where you needed cleanup.
3. **Argument evaluation timing** (Bugs 6, 8, 10): defer captured something at defer-time that you wanted at call-time.
4. **LIFO order surprises** (Bug 7): cleanup order matters; LIFO is automatic if you defer immediately after acquire.
5. **Named return mutations** (Bug 4): deferred closures can change return values; sometimes that's what you want, often not.
6. **Recover scope** (Bug 5): recover only works directly in deferred functions.
7. **Loop variable capture** (Bug 3): pre-Go 1.22 deferred closures share the same loop variable.
8. **Incompatible exit mechanisms** (Bug 9): `os.Exit` skips defers.
9. **Recursive defers** (Bug 11): each frame's defer is retained until that frame exits.

Walk through this list when reviewing any non-trivial use of defer.
