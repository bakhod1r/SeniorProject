# Go Closures — Find the Bug

## Instructions

Each exercise contains buggy Go code involving closures or capture. Identify the bug, explain why, and provide the corrected code. Difficulty: 🟢 Easy, 🟡 Medium, 🔴 Hard.

---

## Bug 1 🟢 — Loop Variable Capture (Pre 1.22)

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

(`go.mod`: `go 1.21`.) What's printed?

<details>
<summary>Solution</summary>

**Bug**: All goroutines capture the SAME `i`. By the time most run, `i == 5`. Output (in pre-1.22):
```
5 5 5 5 5
```

**Fix** (option A — pass as argument):
```go
go func(i int) { fmt.Println(i) }(i)
```

**Fix** (option B — shadow):
```go
i := i
go func() { fmt.Println(i) }()
```

**Fix** (option C — upgrade `go.mod` to `go 1.22`+).

**Key lesson**: Pre-1.22 loop variables are shared. Pass as arg or shadow.
</details>

---

## Bug 2 🟢 — Recursion-By-Name

```go
package main

import "fmt"

func main() {
    fact := func(n int) int {
        if n <= 1 { return 1 }
        return n * fact(n-1)
    }
    fmt.Println(fact(5))
}
```

<details>
<summary>Solution</summary>

**Bug**: `fact` is not yet declared when the literal references it. **Compile error**: `undefined: fact`.

**Fix**:
```go
var fact func(int) int
fact = func(n int) int {
    if n <= 1 { return 1 }
    return n * fact(n-1)
}
```

The captured variable `fact` is set BEFORE the closure is called.

**Key lesson**: Closures can recurse via captured variables. Declare with `var` first.
</details>

---

## Bug 3 🟢 — Capture by Reference (Surprise)

```go
package main

import "fmt"

func main() {
    x := 1
    f := func() int { return x }
    x = 99
    fmt.Println(f())
}
```

The author expected `1`. What prints?

<details>
<summary>Solution</summary>

**Bug**: Closures capture by REFERENCE. `x` is the same variable inside and outside. After `x = 99`, the closure sees 99.

Output:
```
99
```

**Fix** — for snapshot capture, shadow with `x := x` inside:
```go
x := 1
f := func() int {
    x := x // snapshot
    return x
}
x = 99
fmt.Println(f()) // 1
```

Or pass as argument:
```go
f := func(x int) func() int {
    return func() int { return x }
}(x) // snapshot via the IIFE arg
```

**Key lesson**: Default capture is by reference. Use shadow for snapshots.
</details>

---

## Bug 4 🟢 — Concurrent Mutation Without Lock

```go
package main

import (
    "fmt"
    "sync"
)

func newCounter() func() int {
    n := 0
    return func() int {
        n++
        return n
    }
}

func main() {
    c := newCounter()
    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            c()
        }()
    }
    wg.Wait()
    fmt.Println(c())
}
```

What's the issue?

<details>
<summary>Solution</summary>

**Bug**: Captured `n` is modified concurrently from 1000 goroutines without synchronization. Data race; final value may not be 1001.

`go run -race main.go` flags it: WARNING DATA RACE.

**Fix** — synchronize:
```go
func newCounter() func() int {
    var mu sync.Mutex
    n := 0
    return func() int {
        mu.Lock()
        defer mu.Unlock()
        n++
        return n
    }
}
```

Or use atomic:
```go
import "sync/atomic"

func newCounter() func() int64 {
    var n int64
    return func() int64 {
        return atomic.AddInt64(&n, 1)
    }
}
```

**Key lesson**: Captured mutable state shared across goroutines requires synchronization, like any shared variable.
</details>

---

## Bug 5 🟡 — Heavy Capture Pinning Memory

```go
package main

import "fmt"

type BigData struct{ buf [1 << 20]byte }

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
    fmt.Println(len(fns)) // 100
    // Each closure pins 1 MB; total ~100 MB
}
```

<details>
<summary>Solution</summary>

**Bug**: Each closure captures `b` (the `*BigData`). The 100 BigData instances stay alive as long as their closures exist.

**Fix** — capture only what you need:
```go
func makeReader(b *BigData) func() byte {
    first := b.buf[0] // capture the byte
    return func() byte {
        return first
    }
}
```

Now each closure captures 1 byte. The BigData instances are reclaimable as soon as `makeReader` returns.

**Key lesson**: Closures pin captured pointers. Extract minimum data.
</details>

---

## Bug 6 🟡 — Snapshot via `i := i` Misplaced

```go
package main

import "fmt"

func main() {
    fns := []func() int{}
    i := 0
    for i = 0; i < 3; i++ {
        fns = append(fns, func() int {
            i := i // BUG?
            return i
        })
    }
    for _, f := range fns {
        fmt.Println(f())
    }
}
```

<details>
<summary>Solution</summary>

**Discussion**: This is interesting. The shadow `i := i` is INSIDE the closure body — it runs each time the closure is called, capturing the CURRENT value of the outer `i`.

After the loop, the outer `i == 3`. So when the closures run later, they all read 3.

Output:
```
3
3
3
```

**Fix** — shadow OUTSIDE the literal, INSIDE the loop body:
```go
for i = 0; i < 3; i++ {
    i := i // creates per-iteration variable
    fns = append(fns, func() int {
        return i // captures the per-iteration shadow
    })
}
```

Now each closure captures a distinct `i`.

**Key lesson**: The shadow `i := i` must be done BEFORE creating the closure, in the loop's scope, not inside the closure body.
</details>

---

## Bug 7 🟡 — Closure Holding Resource

```go
package main

import (
    "fmt"
    "os"
    "time"
)

func startWatcher(path string) {
    f, err := os.Open(path)
    if err != nil {
        return
    }
    go func() {
        for {
            time.Sleep(10 * time.Second)
            // f is captured but never used or closed
            _ = f
        }
    }()
}

func main() {
    for i := 0; i < 1000; i++ {
        startWatcher("/etc/hosts")
    }
    select {} // block
}
```

What's the bug?

<details>
<summary>Solution</summary>

**Bug**: 1000 goroutines never exit, each capturing a `*os.File`. 1000 file descriptors stay open forever — easy to hit `EMFILE` on Linux.

The captured `f` keeps the file open because Go's GC won't finalize it (the closure references it).

**Fix** — make goroutines respect cancellation, and close on exit:
```go
func startWatcher(ctx context.Context, path string) {
    f, err := os.Open(path)
    if err != nil { return }
    go func() {
        defer f.Close()
        for {
            select {
            case <-ctx.Done(): return
            case <-time.After(10 * time.Second):
                // do work
            }
        }
    }()
}
```

**Key lesson**: Long-lived goroutines pin captured resources. Always design for cancellation and explicit cleanup.
</details>

---

## Bug 8 🟡 — Method Value Captures Stale Receiver

```go
package main

import "fmt"

type S struct{ v int }

func (s S) Get() int { return s.v }

func main() {
    s := S{v: 1}
    get := s.Get
    s.v = 99
    fmt.Println(get())
}
```

<details>
<summary>Solution</summary>

**Bug**: Method value with VALUE receiver captures a COPY of `s` at binding time (when `v == 1`). Subsequent mutations don't affect the captured copy. Output: `1`.

**Fix** (option A — pointer receiver):
```go
func (s *S) Get() int { return s.v }

s := &S{v: 1}
get := s.Get
s.v = 99
fmt.Println(get()) // 99
```

**Fix** (option B — call directly each time):
```go
s.v = 99
fmt.Println(s.Get()) // 99
```

**Key lesson**: Method values bind to value receivers by snapshot. Use pointer receivers or direct calls for live state.
</details>

---

## Bug 9 🔴 — Inadvertent Closure-Capture Race

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    cache := map[string]int{}
    var mu sync.Mutex
    
    update := func(key string, value int) {
        cache[key] = value
    }
    
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func(i int) {
            defer wg.Done()
            update(fmt.Sprintf("key%d", i), i)
        }(i)
    }
    wg.Wait()
    
    mu.Lock()
    fmt.Println(len(cache))
    mu.Unlock()
}
```

The author added a mutex but never uses it inside `update`. What goes wrong?

<details>
<summary>Solution</summary>

**Bug**: `mu` is captured but `update` doesn't lock it. 100 goroutines write to `cache` concurrently — race condition. Map writes from concurrent goroutines may panic or corrupt.

`go run -race main.go` flags it.

**Fix** — use the mutex inside `update`:
```go
update := func(key string, value int) {
    mu.Lock()
    defer mu.Unlock()
    cache[key] = value
}
```

**Key lesson**: Capturing a mutex doesn't synchronize anything. You must explicitly Lock/Unlock at every access site.
</details>

---

## Bug 10 🔴 — Closure Captures Slice Header

```go
package main

import "fmt"

func main() {
    s := []int{1, 2, 3}
    
    f := func() {
        s = append(s, 99)
    }
    
    f()
    fmt.Println(s) // expected [1 2 3 99]
    f()
    fmt.Println(s)
}
```

<details>
<summary>Solution</summary>

**Discussion**: The closure captures `s` by reference. `s = append(s, 99)` reassigns the captured `s` variable. The outer `s` sees the update because they share the variable.

Output:
```
[1 2 3 99]
[1 2 3 99 99]
```

This works correctly — but watch out for confusion about whether you're modifying the slice header (reassigning `s`) vs the underlying array.

**Caveat** — if multiple closures or goroutines do this concurrently, races on the slice header are possible:
```go
go func() { s = append(s, 1) }() // race on s
go func() { s = append(s, 2) }()
```

Use a mutex.

**Key lesson**: Closures capture slice variables (the header), not the underlying array. Reassignments are visible across the closure boundary.
</details>

---

## Bug 11 🔴 — Closure in `defer` With Late Variable

```go
package main

import "fmt"

func process() error {
    var err error
    defer fmt.Println("err is:", err) // BUG
    err = fmt.Errorf("something failed")
    return err
}

func main() {
    process()
}
```

<details>
<summary>Solution</summary>

**Bug**: `defer fmt.Println("err is:", err)` evaluates ARGS eagerly, at defer time, when `err == nil`. The deferred call prints "err is: <nil>", not the assigned error.

Output:
```
err is: <nil>
```

**Fix** — wrap in a closure to defer the read:
```go
defer func() {
    fmt.Println("err is:", err)
}()
err = fmt.Errorf("something failed")
return err
```

Now the closure runs at function exit and reads `err` at that time. Output:
```
err is: something failed
```

**Key lesson**: `defer call(args)` evaluates args eagerly. Use `defer func(){...}()` to defer evaluation along with the call.
</details>

---

## Bug 12 🔴 — Goroutine Captures `for range` Variable

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    items := []string{"a", "b", "c"}
    var wg sync.WaitGroup
    for _, item := range items {
        wg.Add(1)
        go func() {
            defer wg.Done()
            fmt.Println(item)
        }()
    }
    wg.Wait()
}
```

(`go.mod`: `go 1.21`.) What's printed?

<details>
<summary>Solution</summary>

**Bug** (pre-1.22): All goroutines share the same `item`. The loop completes quickly; goroutines see `item == "c"` (the final value).

Output (pre-1.22):
```
c
c
c
```

**Fix** (option A — pass as arg):
```go
go func(item string) {
    defer wg.Done()
    fmt.Println(item)
}(item)
```

**Fix** (option B — shadow):
```go
for _, item := range items {
    item := item
    go func() {
        defer wg.Done()
        fmt.Println(item)
    }()
}
```

**Fix** (option C — upgrade to Go 1.22+):
Bump `go.mod` to `go 1.22`. Each `item` is per-iteration. Original code prints `a b c` (in some order).

**Key lesson**: The Go 1.22 loop-variable change covers `for ... range` as well as C-style `for`.
</details>

---

## Bonus Bug 🔴 — Closure Captures Incorrectly Cleared

```go
package main

import "fmt"

type Cleaner struct {
    cleanup func()
}

func newCleaner(big *[1024]int) *Cleaner {
    c := &Cleaner{}
    c.cleanup = func() {
        big = nil // BUG?
        fmt.Println("cleaned")
    }
    return c
}

func main() {
    big := &[1024]int{}
    c := newCleaner(big)
    c.cleanup()
    // After cleanup, is `big` still alive?
}
```

<details>
<summary>Solution</summary>

**Discussion**: Inside the closure, `big = nil` sets the LOCAL `big` (a parameter of `newCleaner`) to nil — but the OUTER `big` in `main` is unaffected.

The closure captures `big` (the parameter variable). Setting it to nil clears the closure's reference. After cleanup runs, the closure no longer holds the array.

But: the outer `main`'s `big` still references the array. If `c.cleanup` was supposed to release the array, it failed to (the array is still alive via main's `big`).

**Key lesson**: Closures capture by reference, but the reference is to a SPECIFIC variable. Setting that variable to nil only affects the captures pointing to it. Other references (e.g., the outer `main`'s `big`) are unaffected.

**Fix** — pass the array address explicitly and clear it via the original variable:
```go
func newCleaner(bigPtr **[1024]int) *Cleaner {
    return &Cleaner{
        cleanup: func() {
            *bigPtr = nil // clears the caller's variable
            fmt.Println("cleaned")
        },
    }
}

big := &[1024]int{}
c := newCleaner(&big)
c.cleanup() // big is now nil in main
```

This is rarely a good design — usually you want explicit release semantics, not magical nil-clearing.
</details>
