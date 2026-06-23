# Go Empty Struct — Find the Bug

## Instructions

Each exercise contains buggy Go code involving the empty struct, set maps, signal channels, or method-only types. Identify the bug, explain why, and provide the corrected code. Difficulty: Easy, Medium, Hard.

---

## Bug 1 (Easy) — Pointer Identity of `&struct{}{}`

```go
package main

import "fmt"

func main() {
    a := &struct{}{}
    b := &struct{}{}
    if a == b {
        fmt.Println("a and b are the same allocation")
    } else {
        fmt.Println("a and b are different allocations")
    }
}
```

The author intends to assert that two distinct `&struct{}{}` allocations produce distinct addresses. Is the assertion safe?

<details>
<summary>Solution</summary>

**Bug**: The runtime is allowed to assign the same address to multiple zero-size values. In current Go, all zero-size allocations return `runtime.zerobase`. So `a == b` is typically `true`, and the author's expectation is wrong.

The Go specification says: "Two distinct zero-size variables may have the same address in memory." This is the standard licence for the runtime to collapse them.

**Fix**: do not test pointer identity of empty-struct values. Use a non-empty type when uniqueness matters:

```go
type token struct{ _ uintptr } // 1 word but distinct
a := &token{}
b := &token{}
fmt.Println(a == b) // always false
```

**Key lesson**: `&struct{}{}` returns an implementation-defined address; equality between such pointers is not portable.
</details>

---

## Bug 2 (Easy) — `map[string]bool` Where `struct{}` Belongs

```go
package main

import "fmt"

func main() {
    seen := map[string]bool{}
    for _, id := range []string{"a", "b", "a", "c"} {
        if !seen[id] {
            fmt.Println("first time:", id)
            seen[id] = true
        }
    }
}
```

The code works. Why might a reviewer ask for a change?

<details>
<summary>Solution</summary>

**Discussion**: The bool value never carries information beyond presence. `seen[id] = true` is the only write; `false` is never stored. The `bool` byte per entry is wasted, and the type signals "boolean attribute" rather than "set membership".

**Fix**:
```go
seen := map[string]struct{}{}
for _, id := range []string{"a", "b", "a", "c"} {
    if _, ok := seen[id]; !ok {
        fmt.Println("first time:", id)
        seen[id] = struct{}{}
    }
}
```

**Key lesson**: Use `map[K]struct{}` for pure presence tests. Idiomatic in Go and saves one byte per entry.
</details>

---

## Bug 3 (Easy) — Buffered `chan struct{}` Capacity 1 As Broadcast

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

func main() {
    cancel := make(chan struct{}, 1)
    var wg sync.WaitGroup
    for i := 0; i < 3; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            <-cancel
            fmt.Println(id, "stopped")
        }(i)
    }
    time.Sleep(20 * time.Millisecond)
    cancel <- struct{}{}
    wg.Wait()
}
```

What goes wrong?

<details>
<summary>Solution</summary>

**Bug**: The author wants to wake all three goroutines but uses a buffered send. Only ONE goroutine receives the value; the other two block forever. `wg.Wait()` deadlocks.

**Fix**: use `close` for broadcast.

```go
cancel := make(chan struct{})
// ...
close(cancel) // wakes every receiver
```

A closed channel returns immediately on every receive — this is the canonical broadcast primitive.

**Key lesson**: For one-to-many cancellation, `close(chan struct{})` is the right tool, not a buffered send.
</details>

---

## Bug 4 (Easy) — Sending On A Closed Signal Channel

```go
package main

func main() {
    done := make(chan struct{})
    close(done)
    done <- struct{}{} // ???
}
```

What happens?

<details>
<summary>Solution</summary>

**Bug**: Sending on a closed channel panics with `send on closed channel`. The author may have intended to wake a receiver after close — but close already does that.

**Fix**: drop the send. Consumers receive `struct{}{}, false` from a closed channel; that is enough.

```go
done := make(chan struct{})
close(done)
v, ok := <-done
fmt.Println(v, ok) // {} false
```

**Key lesson**: `close` is the only signal you ever need on a `chan struct{}` broadcast channel. Sending after close is a programming error.
</details>

---

## Bug 5 (Easy) — Trailing Zero-Size Field Surprise

```go
package main

import (
    "fmt"
    "unsafe"
)

type Packet struct {
    Magic uint32
    Len   uint32
    _     struct{} // intentional marker
}

func main() {
    fmt.Println(unsafe.Sizeof(Packet{})) // expected 8
}
```

What is the actual output?

<details>
<summary>Solution</summary>

**Bug**: Output is `16`, not `8`. The trailing `_ struct{}` field forces the compiler to add padding so `&p._` produces a unique in-bounds address.

The Go specification permits two distinct zero-size variables to share an address — but the address must remain inside the struct. With the trailing field, the natural address (struct-start + sizeof(non-zero fields)) is the byte just past the struct. The compiler grows the struct to keep that address inside.

**Fix** — move the marker to the start, or remove it:

```go
type Packet struct {
    _     struct{}
    Magic uint32
    Len   uint32
}
// unsafe.Sizeof(Packet{}) == 8
```

Or remove entirely if no marker semantics are needed.

**Key lesson**: Trailing zero-size fields cost a word. Place at the start or drop them.
</details>

---

## Bug 6 (Medium) — Iterating A Set With Both Vars

```go
package main

import "fmt"

func main() {
    set := map[string]struct{}{
        "alpha": {},
        "beta":  {},
    }
    for k, v := range set {
        fmt.Println(k, v)
    }
}
```

What's wrong?

<details>
<summary>Solution</summary>

**Bug**: The code compiles and runs, but `v` is always `struct{}{}` and provides no information. The two-variable form misleads readers into thinking the value matters.

The output is something like:
```
alpha {}
beta {}
```

The `{}` is the printed empty struct — useless.

**Fix**:
```go
for k := range set {
    fmt.Println(k)
}
```

Drop the unused variable. The intent is clear.

**Key lesson**: When iterating `map[K]struct{}`, use `for k := range set`; the value is always `struct{}{}` and printing it is noise.
</details>

---

## Bug 7 (Medium) — Confusing Type With Value

```go
package main

import "fmt"

func main() {
    m := map[string]struct{}{}
    m["alpha"] = struct{}      // ???
    fmt.Println(len(m))
}
```

What's the issue?

<details>
<summary>Solution</summary>

**Bug**: `struct{}` is the TYPE; `struct{}{}` is the VALUE. Assigning a type to a map value is a syntax error: `type struct{} is not an expression`.

Compile error:
```
./main.go:7:18: type struct {} is not an expression
```

**Fix**:
```go
m["alpha"] = struct{}{}
```

The first `{}` ends the type; the second `{}` constructs the value.

Alternative — use a named type for clarity:
```go
type Empty = struct{}
m["alpha"] = Empty{}
```

**Key lesson**: `struct{}` is a type; `struct{}{}` is its only value. The double brace catches new readers.
</details>

---

## Bug 8 (Medium) — `chan struct{}` Used As Data Channel

```go
package main

import "fmt"

func main() {
    results := make(chan struct{}, 3)
    for i := 0; i < 3; i++ {
        go func(i int) {
            // compute i*i...
            results <- struct{}{} // BUG?
        }(i)
    }
    for i := 0; i < 3; i++ {
        v := <-results
        fmt.Println(v) // {} every time
    }
}
```

What's the misuse?

<details>
<summary>Solution</summary>

**Bug**: The author meant to deliver computed values but used `chan struct{}`. The receiver gets `struct{}{}` three times — no useful data crosses the channel.

This is a misunderstanding: `chan struct{}` is for SIGNALS, not for DATA. There is nothing to deliver — the receivers learn only "something happened".

**Fix**:
```go
results := make(chan int, 3)
for i := 0; i < 3; i++ {
    go func(i int) {
        results <- i * i
    }(i)
}
for i := 0; i < 3; i++ {
    fmt.Println(<-results) // 0 1 4 (some order)
}
```

If the count of completions is the only fact you need, use a `sync.WaitGroup`. If you need to coordinate cancellation, use `chan struct{}` AND a separate data channel.

**Key lesson**: `chan struct{}` carries no data. Use a typed channel when data is needed.
</details>

---

## Bug 9 (Medium) — Closing Twice

```go
package main

import "fmt"

func cleanup(done chan struct{}) {
    close(done)
}

func main() {
    done := make(chan struct{})
    defer cleanup(done)
    close(done) // first close
    fmt.Println("done")
}
```

What happens?

<details>
<summary>Solution</summary>

**Bug**: The first `close(done)` runs in `main`; then `cleanup` runs as deferred and tries to close again. Closing an already-closed channel panics:

```
panic: close of closed channel
```

**Fix**: guard with `sync.Once`:
```go
import "sync"

type Done struct {
    once sync.Once
    ch   chan struct{}
}

func New() *Done                    { return &Done{ch: make(chan struct{})} }
func (d *Done) Close()              { d.once.Do(func() { close(d.ch) }) }
func (d *Done) Channel() <-chan struct{} { return d.ch }
```

Now multiple `Close` calls are safe.

**Key lesson**: If multiple paths can close a channel, use `sync.Once`.
</details>

---

## Bug 10 (Medium) — Using `&struct{}{}` As Map Key Identity

```go
package main

import "fmt"

func main() {
    pool := map[*struct{}]string{}
    a := &struct{}{}
    b := &struct{}{}
    pool[a] = "first"
    pool[b] = "second"
    fmt.Println(len(pool), pool[a], pool[b])
}
```

What does the program print?

<details>
<summary>Solution</summary>

**Bug**: `a` and `b` typically equal the same address (`runtime.zerobase`). The map sees them as the same key. The second assignment overwrites the first.

Likely output:
```
1 second second
```

The author wanted distinct tokens — but empty-struct pointers are not distinct.

**Fix** — use a non-empty type for token identity:
```go
type token struct{ id uintptr }
a := &token{id: 1}
b := &token{id: 2}
pool := map[*token]string{}
pool[a] = "first"
pool[b] = "second"
fmt.Println(len(pool), pool[a], pool[b]) // 2 first second
```

Or use a sequence integer directly.

**Key lesson**: `*struct{}` is a poor choice for unique tokens. Use a type with at least one byte.
</details>

---

## Bug 11 (Hard) — Buffered Capacity 1 As Once-Flag, Not Broadcast

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    once := make(chan struct{}, 1)
    var wg sync.WaitGroup
    for i := 0; i < 3; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            select {
            case once <- struct{}{}:
                fmt.Println(id, "first to fire")
            default:
                fmt.Println(id, "skipped")
            }
        }(i)
    }
    wg.Wait()
}
```

What is questionable here?

<details>
<summary>Solution</summary>

**Discussion**: The pattern uses a buffered capacity-1 `chan struct{}` as a once-flag. The first goroutine to send wins; subsequent senders see the buffer full and take the default path. It works.

But it is fragile:
1. If anyone receives from `once`, the buffer reopens and a second sender can win.
2. The pattern conflates capacity (a transient buffer) with a permanent flag.
3. `sync.Once` is clearer.

**Fix** — use `sync.Once`:
```go
var once sync.Once
for i := 0; i < 3; i++ {
    wg.Add(1)
    go func(id int) {
        defer wg.Done()
        ran := false
        once.Do(func() { ran = true; fmt.Println(id, "first to fire") })
        if !ran {
            fmt.Println(id, "skipped")
        }
    }(i)
}
```

Or, if you really want a channel because some other code waits on it, use `close`:
```go
fired := make(chan struct{})
var fireOnce sync.Once
trigger := func(id int) {
    fireOnce.Do(func() {
        fmt.Println(id, "first to fire")
        close(fired)
    })
}
```

**Key lesson**: For "exactly one path runs", `sync.Once` is direct. For "many waiters wake once", `close(chan struct{})` is direct. Avoid using buffered capacity-1 channels as once-flags unless you have a specific reason.
</details>

---

## Bug 12 (Hard) — Method-Only Type With Mutating Method

```go
package main

import "fmt"

type Counter struct{}

var globalCount int

func (Counter) Increment() { globalCount++ }
func (Counter) Get() int   { return globalCount }

func main() {
    var c Counter
    c.Increment()
    c.Increment()
    fmt.Println(c.Get()) // 2
}
```

What is wrong with this design?

<details>
<summary>Solution</summary>

**Discussion**: The empty-struct receiver hides the fact that the counter is global state. The methods compile, run, and produce 2. But:
- Multiple `Counter{}` instances share the same `globalCount`.
- The package-level variable is action-at-a-distance.
- Race conditions occur if `Increment` runs concurrently.

Two `Counter{}` values are indistinguishable, but they secretly share global state via the global. This violates least surprise.

**Fix** — add the state to the type:
```go
type Counter struct{ n int64 }

func (c *Counter) Increment() { atomic.AddInt64(&c.n, 1) }
func (c *Counter) Get() int64 { return atomic.LoadInt64(&c.n) }
```

Now each `Counter` is independent and concurrency-safe. The empty-struct version was a method-only type pretending to have no state — but the global made it lie.

**Key lesson**: Empty-struct types are stateless. If your methods touch shared state, the struct is not the right home. Either use a real struct with fields or expose package-level functions.
</details>

---

## Bug 13 (Hard) — Set Iteration With Side Effects

```go
package main

import "fmt"

func main() {
    seen := map[string]struct{}{
        "alpha": {}, "beta": {}, "gamma": {},
    }
    for k := range seen {
        if k == "alpha" {
            seen["delta"] = struct{}{} // mutate during iter
        }
        fmt.Println(k)
    }
}
```

What is the risk?

<details>
<summary>Solution</summary>

**Bug**: The Go spec permits iteration over a map being mutated, but with caveats:
- Newly added keys may or may not be visited in the same iteration.
- Deleted keys may or may not be skipped.
- The runtime may panic in some cases (concurrent map writes; read-write races).

In this code:
- "delta" might appear once, twice, or never.
- The order of "alpha", "beta", "gamma", "delta" is unspecified.

This is not a panic — it is non-deterministic behaviour that is hard to test.

**Fix** — collect deltas, apply after iteration:
```go
add := []string{}
for k := range seen {
    if k == "alpha" {
        add = append(add, "delta")
    }
    fmt.Println(k)
}
for _, k := range add {
    seen[k] = struct{}{}
}
```

**Key lesson**: Mutating a map during iteration is allowed but produces non-deterministic results. Snapshot or queue the changes for after-iteration application.
</details>

---

## Bug 14 (Hard) — `chan struct{}` Without Cancellation In A Select

```go
package main

import (
    "fmt"
    "time"
)

func worker(quit chan struct{}, work chan int) {
    for {
        select {
        case <-quit:
            fmt.Println("quitting")
            return
        case w := <-work:
            fmt.Println("got work:", w)
        }
    }
}

func main() {
    quit := make(chan struct{})
    work := make(chan int)
    go worker(quit, work)
    work <- 1
    work <- 2
    time.Sleep(10 * time.Millisecond)
    // forgot to close(quit)!
}
```

What goes wrong?

<details>
<summary>Solution</summary>

**Bug**: `main` returns without closing `quit`. The worker goroutine blocks forever on the `select` because `work` is no longer being sent to and `quit` is never closed.

The whole program exits because `main` returns, but in a long-running service, the worker leaks.

**Fix**:
```go
defer close(quit)
work <- 1
work <- 2
time.Sleep(10 * time.Millisecond)
// defer fires close(quit), worker exits
```

In a real service, ensure every spawn has a clear ownership of the cancel signal.

**Key lesson**: Long-running goroutines need a cancellation path. `chan struct{}` works only if someone closes it.
</details>

---

## Bug 15 (Hard) — Set Of Pointers To Same Empty Type

```go
package main

import "fmt"

type marker struct{}

func main() {
    s := map[*marker]string{}
    for i := 0; i < 5; i++ {
        m := &marker{}
        s[m] = fmt.Sprintf("entry-%d", i)
    }
    fmt.Println(len(s))
}
```

What does this print, and why?

<details>
<summary>Solution</summary>

**Bug**: Every `&marker{}` returns the same `runtime.zerobase` address (because `marker` is a zero-size type). All five entries collide on the same key. Output:

```
1
```

The only entry left is the last one written.

**Fix** — use a non-empty unexported field:
```go
type marker struct{ _ byte } // 1 byte
```

Now each `&marker{}` is a fresh allocation with a distinct address. The map holds five entries.

Alternatively, use an integer ID directly as the key.

**Key lesson**: Pointers to empty struct values alias to a single address; they are unsuitable as unique keys.
</details>

---

## Summary

The empty struct's quirks cluster around three areas:

1. **Pointer identity**: `&struct{}{}` is not unique. Avoid for tokens, keys, or identity tests.
2. **Channel behaviour**: `chan struct{}` is for signals, never data; `close` is the broadcast primitive; never send after close; guard double-close with `sync.Once`.
3. **Layout effects**: trailing zero-size fields force a byte of padding; types and values use slightly different syntax (`struct{}` vs `struct{}{}`).

When in doubt, prefer named types, prefer `close` over send, and avoid pointer identity tests on zero-size types.
