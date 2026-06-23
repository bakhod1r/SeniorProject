# Go Anonymous Functions — Find the Bug

## Instructions

Each exercise contains buggy Go code involving anonymous functions or closures. Identify the bug, explain why it occurs, and provide the corrected code. Difficulty: 🟢 Easy, 🟡 Medium, 🔴 Hard.

---

## Bug 1 🟢 — Defer Without Invocation

```go
package main

import "fmt"

func main() {
    defer func() {
        fmt.Println("cleanup")
    }
    fmt.Println("main")
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
What kind of expression does `defer` expect?
</details>

<details>
<summary>Solution</summary>

**Bug**: `defer func() { ... }` is a syntax/semantic error — `defer` requires a function CALL expression, not a function value. The trailing `()` is missing.

**Compile error**: `defer requires function call, not function value`.

**Fix**:
```go
defer func() {
    fmt.Println("cleanup")
}()
```

**Key lesson**: Always end an anonymous-function defer with `()` to make it a call.
</details>

---

## Bug 2 🟢 — Recursion By Name

```go
package main

import "fmt"

func main() {
    fact := func(n int) int {
        if n <= 1 {
            return 1
        }
        return n * fact(n-1)
    }
    fmt.Println(fact(5))
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
Inside the literal body, when does `fact` become defined?
</details>

<details>
<summary>Solution</summary>

**Bug**: `fact` is being declared by the `:=` assignment. The literal on the right side is type-checked and compiled BEFORE `fact` is in scope. **Compile error**: `undefined: fact` (or "fact declared but not used" on the inner reference).

**Fix** — declare the variable first, then assign:
```go
var fact func(int) int
fact = func(n int) int {
    if n <= 1 {
        return 1
    }
    return n * fact(n-1)
}
fmt.Println(fact(5))
```

This works because the variable `fact` exists when the literal references it; the captured pointer/value is updated by the assignment before the call.

**Key lesson**: Anonymous functions can't recurse by name directly. Use `var fact ...; fact = ...` to enable recursion.
</details>

---

## Bug 3 🟢 — Loop Variable in Goroutine (Pre-1.22)

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
            fmt.Println(i)
        }()
    }
    wg.Wait()
}
```

(Assume `go.mod` declares `go 1.21` or earlier.)

What does this print?

<details>
<summary>Hint</summary>
What value of `i` does each goroutine see in pre-1.22 Go?
</details>

<details>
<summary>Solution</summary>

**Bug**: All goroutines capture the SAME `i` variable. By the time most run, the loop has finished and `i == 5`. Output (often):
```
5
5
5
5
5
```

**Fix** (option A — pass as argument):
```go
for i := 0; i < 5; i++ {
    wg.Add(1)
    go func(i int) {
        defer wg.Done()
        fmt.Println(i)
    }(i)
}
```

**Fix** (option B — shadow with `i := i`):
```go
for i := 0; i < 5; i++ {
    i := i
    wg.Add(1)
    go func() {
        defer wg.Done()
        fmt.Println(i)
    }()
}
```

**Fix** (option C — upgrade to Go 1.22):
Update `go.mod` to `go 1.22`. Each iteration creates a fresh `i`, and the original code works.

**Key lesson**: Pre-1.22 Go shares loop variables across iterations. Goroutines capturing them see the final value. Pass as argument or shadow.
</details>

---

## Bug 4 🟢 — IIFE Without Result

```go
package main

import "fmt"

func main() {
    result := func(a, b int) int { return a + b }(3, 4)
    fmt.Println(result)

    // What about this?
    result2 := func() {
        fmt.Println("hello")
    }()
    fmt.Println(result2)
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
What does `result2` get assigned?
</details>

<details>
<summary>Solution</summary>

**Bug**: The second IIFE returns no values. **Compile error**: `result2 declared but not used` and/or `func() { ... }() used as value`.

**Fix** (option A — make the IIFE return a value):
```go
result2 := func() string {
    return "hello"
}()
fmt.Println(result2)
```

**Fix** (option B — call the IIFE for its side effect, no assignment):
```go
func() {
    fmt.Println("hello")
}()
```

**Key lesson**: IIFE returns whatever the literal returns. If it returns nothing, you can't assign the result.
</details>

---

## Bug 5 🟡 — Closure Captures Loop Variable in Slice of Closures

```go
package main

import "fmt"

func main() {
    fns := []func() int{}
    for i := 0; i < 3; i++ {
        fns = append(fns, func() int {
            return i * 10
        })
    }
    for _, f := range fns {
        fmt.Println(f())
    }
}
```

In Go 1.21, what does this print? In Go 1.22+?

<details>
<summary>Hint</summary>
The 1.22 change applies to all loop forms when iteration var is `:=`.
</details>

<details>
<summary>Solution</summary>

**Pre Go 1.22**: All closures share the same `i`. After the loop, `i == 3`. Output:
```
30
30
30
```

**Go 1.22+**: Each iteration creates a fresh `i`. Output:
```
0
10
20
```

**Fix for pre-1.22** — shadow:
```go
for i := 0; i < 3; i++ {
    i := i
    fns = append(fns, func() int { return i * 10 })
}
```

Or pass as a factory argument:
```go
makeFn := func(i int) func() int { return func() int { return i * 10 } }
for i := 0; i < 3; i++ {
    fns = append(fns, makeFn(i))
}
```

**Key lesson**: Closure capture interacts with loop semantics. Behavior changed in Go 1.22.
</details>

---

## Bug 6 🟡 — Heavy Capture Pinning Memory

```go
package main

import "fmt"

type BigData struct {
    buf [1 << 20]byte // 1 MB
}

func makeReader(b *BigData) func() byte {
    return func() byte {
        return b.buf[0]
    }
}

func main() {
    var fns []func() byte
    for i := 0; i < 100; i++ {
        b := &BigData{}
        fns = append(fns, makeReader(b))
    }
    fmt.Println("total functions:", len(fns))
    // Each closure pins 1 MB
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
What does each closure capture? How long does it live?
</details>

<details>
<summary>Solution</summary>

**Bug**: Each closure captures `b` (a `*BigData`). All 100 BigData instances stay alive as long as the closures exist. Total: ~100 MB pinned.

**Fix** — capture only what you need:
```go
func makeReader(b *BigData) func() byte {
    first := b.buf[0] // capture the byte, not the pointer
    return func() byte {
        return first
    }
}
```

Now each closure captures 1 byte; the BigData instances are eligible for GC after `makeReader` returns.

**Key lesson**: Closures capture by reference; capturing a pointer keeps the entire pointee alive. Extract only what's needed.
</details>

---

## Bug 7 🟡 — Defer Inside Loop

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
        defer func() {
            f.Close()
            fmt.Println("closed", p)
        }()
        // ... read f ...
    }
    return nil
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
When does each deferred close run?
</details>

<details>
<summary>Solution</summary>

**Bug**: Each `defer` runs at function exit, not loop-iteration exit. For 1000 files, all 1000 file descriptors stay open until the loop completes — easy to hit `EMFILE` ("too many open files").

Also: each iteration's closure captures `f` and `p`. With pre-1.22 Go, `p` is shared across iterations and may show the final value.

**Fix** — extract a per-iteration helper:
```go
func processFiles(paths []string) error {
    for _, p := range paths {
        if err := processOne(p); err != nil {
            return err
        }
    }
    return nil
}

func processOne(p string) error {
    f, err := os.Open(p)
    if err != nil { return err }
    defer func() {
        f.Close()
        fmt.Println("closed", p)
    }()
    // ... read f ...
    return nil
}
```

Now each defer scope is per-call to `processOne`.

**Key lesson**: Don't `defer` inside a loop unless you understand the cumulative behavior. Extract per-iteration helper functions.
</details>

---

## Bug 8 🟡 — Closure Variable Mutation

```go
package main

import "fmt"

func main() {
    counter := func() func() int {
        n := 0
        return func() int {
            n = n + 1
            return n
        }
    }()
    
    for i := 0; i < 3; i++ {
        fmt.Println(counter())
    }
}
```

This prints 1, 2, 3 — but is there a hidden race condition if used concurrently?

<details>
<summary>Hint</summary>
What if multiple goroutines call counter concurrently?
</details>

<details>
<summary>Solution</summary>

**Bug (latent)**: The counter captures `n` and increments it without synchronization. Concurrent calls cause a data race.

```go
// Race-prone usage:
go func() { for { counter() } }()
go func() { for { counter() } }()
```

`go test -race` would flag this.

**Fix** — use atomic operations:
```go
import "sync/atomic"

counter := func() func() int64 {
    var n int64
    return func() int64 {
        return atomic.AddInt64(&n, 1)
    }
}()
```

Or use a mutex:
```go
var mu sync.Mutex
counter := func() func() int {
    n := 0
    return func() int {
        mu.Lock()
        defer mu.Unlock()
        n++
        return n
    }
}()
```

**Key lesson**: Closures capture by reference. Concurrent access to captured mutable state requires synchronization, just like any shared variable.
</details>

---

## Bug 9 🔴 — Closure-Caused Goroutine Leak

```go
package main

import (
    "fmt"
    "time"
)

func startWorker() {
    bigData := make([]byte, 1<<20)
    go func() {
        for {
            time.Sleep(10 * time.Second)
            _ = bigData
        }
    }()
}

func main() {
    for i := 0; i < 100; i++ {
        startWorker()
    }
    fmt.Println("started 100 workers")
    select {} // block forever
}
```

What's wrong?

<details>
<summary>Hint</summary>
Do the goroutines ever exit? What does each one keep alive?
</details>

<details>
<summary>Solution</summary>

**Bug**: 100 goroutines, each capturing 1 MB of `bigData`, never exit. Total pinned memory: 100 MB. The program "leaks" goroutines and memory linearly.

**Fix** — make the goroutine respect cancellation:
```go
import "context"

func startWorker(ctx context.Context) {
    bigData := make([]byte, 1<<20)
    go func() {
        defer func() { bigData = nil }() // help GC
        ticker := time.NewTicker(10 * time.Second)
        defer ticker.Stop()
        for {
            select {
            case <-ctx.Done():
                return
            case <-ticker.C:
                _ = bigData
            }
        }
    }()
}
```

Or extract minimal data to capture:
```go
func startWorker() {
    bigData := make([]byte, 1<<20)
    summary := compute(bigData) // small derived value
    go func() {
        for {
            time.Sleep(10 * time.Second)
            _ = summary // captures only summary, not bigData
        }
    }()
}
```

**Key lesson**: Goroutines that never exit are leaks. Combined with closures capturing large data, they can pin gigabytes. Always design goroutines for cancellation.
</details>

---

## Bug 10 🔴 — Method Value Captures Stale Receiver

```go
package main

import "fmt"

type S struct{ v int }

func (s S) Show() { fmt.Println(s.v) }

func main() {
    s := S{v: 1}
    show := s.Show
    s.v = 99
    show()
}
```

The author expected `99`. What prints?

<details>
<summary>Hint</summary>
Is the receiver of `Show` a value or pointer?
</details>

<details>
<summary>Solution</summary>

**Bug**: `Show` has a value receiver. `s.Show` creates a method value that captures a COPY of `s` at the time of binding (when `s.v == 1`). Later mutation to `s.v` doesn't affect the captured copy. Output: `1`.

**Fix** (option A — pointer receiver):
```go
func (s *S) Show() { fmt.Println(s.v) }

s := &S{v: 1}
show := s.Show // captures &s
s.v = 99
show() // 99 — sees current state via the pointer
```

**Fix** (option B — call the method directly each time, no binding):
```go
s.v = 99
s.Show() // 99
```

**Key lesson**: Method values bound to value receivers capture a snapshot. Use pointer receivers for live-state behavior, or call the method directly.
</details>

---

## Bug 11 🔴 — Anonymous Function Allocates Per Iteration

```go
package main

import "fmt"

func process(items []int, transform func(int) int) []int {
    out := make([]int, len(items))
    for i, x := range items {
        out[i] = transform(x)
    }
    return out
}

func main() {
    items := []int{1, 2, 3, 4, 5}
    for i := 0; i < 1000; i++ {
        result := process(items, func(n int) int { return n * 2 })
        _ = result
    }
    fmt.Println("done")
}
```

The anonymous function is created 1000 times. Is this wasteful?

<details>
<summary>Hint</summary>
Does the literal capture anything?
</details>

<details>
<summary>Solution</summary>

**Discussion**: The literal captures nothing. Non-capturing function literals are essentially free — the compiler emits a single shared funcval per literal, hoisted to a global. There's no per-iteration allocation.

But if the literal captured something:
```go
for i := 0; i < 1000; i++ {
    factor := i
    result := process(items, func(n int) int { return n * factor })
    _ = result
}
```

Each iteration's literal captures `factor` — heap allocation per iteration if it escapes.

**Fix** when capturing IS needed and is hot:
```go
// Hoist the literal out:
transform := func(n int) int { return n * 2 } // factor must be invariant
for i := 0; i < 1000; i++ {
    result := process(items, transform)
    _ = result
}
```

Or restructure so `transform` doesn't need to capture (pass via arg):
```go
func process(items []int, transform func(int, int) int, arg int) []int {
    // transform takes the loop-specific arg explicitly
}
```

**Key lesson**: Non-capturing literals are free. Capturing literals in hot loops may allocate; verify with `-gcflags="-m"`. Lift them out or restructure.
</details>

---

## Bug 12 🔴 — Closure Returned From Loop in Map

```go
package main

import "fmt"

func main() {
    handlers := map[string]func() string{}
    names := []string{"a", "b", "c"}
    for _, name := range names {
        handlers[name] = func() string {
            return "handler for " + name
        }
    }
    for _, name := range names {
        fmt.Println(handlers[name]())
    }
}
```

In Go 1.21, what does this print? In Go 1.22+?

<details>
<summary>Hint</summary>
Same loop-variable capture issue as Bug 5 but with `for ... range`.
</details>

<details>
<summary>Solution</summary>

**Pre Go 1.22**: All closures share the same `name` variable. After the loop, `name == "c"`. Output:
```
handler for c
handler for c
handler for c
```

**Go 1.22+**: Each iteration creates a fresh `name`. Output:
```
handler for a
handler for b
handler for c
```

**Fix for pre-1.22** — shadow:
```go
for _, name := range names {
    name := name
    handlers[name] = func() string { return "handler for " + name }
}
```

**Key lesson**: The Go 1.22 change applies to `for ... range` (and all loop forms with `:=` iteration vars). Both for-clause and range-clause loops create per-iteration variables now.
</details>

---

## Bonus Bug 🔴 — Defer Closure in Recursive Function

```go
package main

import "fmt"

func deepCall(n int) {
    defer func() {
        fmt.Println("returning from", n)
    }()
    if n > 0 {
        deepCall(n - 1)
    }
}

func main() {
    deepCall(3)
}
```

What does this print? Is there a performance concern?

<details>
<summary>Hint</summary>
LIFO defer order; what's the cost of each defer?
</details>

<details>
<summary>Solution</summary>

**Output** (LIFO order, deepest defer runs first):
```
returning from 0
returning from 1
returning from 2
returning from 3
```

**Performance concern**: Each call to `deepCall` pushes a defer record onto the goroutine's defer stack. For deep recursion (say n=10000), that's 10000 defer allocations + the call frames.

In Go 1.14+, open-coded defer optimizes most cases — but recursive functions create one defer per call frame, which is unavoidable with this pattern.

**Fix** for very deep recursion: avoid defer:
```go
func deepCall(n int) {
    if n > 0 {
        deepCall(n - 1)
    }
    fmt.Println("returning from", n)
}
```

This achieves the same output without per-call defer overhead.

**Key lesson**: defer in recursive functions multiplies its cost by recursion depth. For deep recursion, restructure to avoid defer.
</details>
