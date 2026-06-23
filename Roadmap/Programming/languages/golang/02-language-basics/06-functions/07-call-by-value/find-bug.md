# Go Call by Value — Find the Bug

## Instructions

Each exercise contains buggy Go code involving call-by-value semantics. Identify the bug, explain why, and provide the corrected code. Difficulty: 🟢 Easy, 🟡 Medium, 🔴 Hard.

---

## Bug 1 🟢 — Mutation Doesn't Persist

```go
package main

import "fmt"

type User struct {
    Age int
}

func birthday(u User) {
    u.Age++
}

func main() {
    u := User{Age: 30}
    birthday(u)
    fmt.Println(u.Age) // expected 31
}
```

What's the bug?

<details>
<summary>Solution</summary>

**Bug**: `birthday` takes `User` by value. The function operates on a copy. The caller's `u` is unchanged.

Output:
```
30
```

**Fix** — pass a pointer:
```go
func birthday(u *User) {
    u.Age++
}

func main() {
    u := User{Age: 30}
    birthday(&u)
    fmt.Println(u.Age) // 31
}
```

**Key lesson**: Go passes by value. To mutate, pass a pointer.
</details>

---

## Bug 2 🟢 — Slice Append Doesn't Propagate

```go
package main

import "fmt"

func add(s []int, v int) {
    s = append(s, v)
}

func main() {
    s := []int{1, 2, 3}
    add(s, 99)
    fmt.Println(s) // expected [1 2 3 99]
}
```

<details>
<summary>Solution</summary>

**Bug**: `s = append(s, v)` modifies the LOCAL `s`. The caller's slice header is unchanged. Output:
```
[1 2 3]
```

**Fix** (option A — return the new slice):
```go
func add(s []int, v int) []int {
    return append(s, v)
}

s = add(s, 99)
fmt.Println(s) // [1 2 3 99]
```

**Fix** (option B — pointer to slice):
```go
func add(sp *[]int, v int) {
    *sp = append(*sp, v)
}

add(&s, 99)
fmt.Println(s) // [1 2 3 99]
```

**Key lesson**: Slice header reassignment is local. Return the new slice or pass `*[]T`.
</details>

---

## Bug 3 🟢 — Storing Slice Without Defensive Copy

```go
package main

import "fmt"

type Cache struct {
    items []int
}

func (c *Cache) Set(items []int) {
    c.items = items // BUG: aliases caller's slice
}

func main() {
    c := &Cache{}
    src := []int{1, 2, 3}
    c.Set(src)
    src[0] = 999
    fmt.Println(c.items) // expected [1 2 3]
}
```

<details>
<summary>Solution</summary>

**Bug**: `c.items = items` stores a slice that aliases the caller's backing array. When the caller mutates `src[0]`, the cache reflects it. Output:
```
[999 2 3]
```

**Fix** — defensive copy:
```go
func (c *Cache) Set(items []int) {
    c.items = append([]int(nil), items...)
}
```

Now `c.items` has its own backing array.

**Key lesson**: When a function stores caller-provided slices/maps, defensively copy to prevent caller-side mutation from corrupting the storage.
</details>

---

## Bug 4 🟢 — Nil Map Write Panic

```go
package main

func main() {
    var m map[string]int
    m["x"] = 1
}
```

<details>
<summary>Solution</summary>

**Bug**: `var m map[string]int` declares a NIL map. Writing to a nil map panics: `assignment to entry in nil map`.

**Fix** — initialize:
```go
m := make(map[string]int)
m["x"] = 1
```

Or use a literal:
```go
m := map[string]int{}
m["x"] = 1
```

**Key lesson**: Nil maps allow reads (return zero value) but panic on writes. Always initialize before writing.
</details>

---

## Bug 5 🟡 — Method With Value Receiver Doesn't Mutate

```go
package main

import "fmt"

type Counter struct {
    n int
}

func (c Counter) Inc() {
    c.n++
}

func main() {
    c := Counter{}
    c.Inc(); c.Inc(); c.Inc()
    fmt.Println(c.n) // expected 3
}
```

<details>
<summary>Solution</summary>

**Bug**: `Inc` has a value receiver. Each call operates on a COPY; caller's `c.n` never changes. Output:
```
0
```

**Fix** — use pointer receiver:
```go
func (c *Counter) Inc() {
    c.n++
}
```

Now `c.Inc()` (with `c` a value) automatically takes the address; mutations persist.

**Key lesson**: Value receivers operate on copies; for mutation use pointer receivers.
</details>

---

## Bug 6 🟡 — Pointer Receiver on Non-Addressable Value

```go
package main

type T struct{ n int }

func (t *T) Inc() { t.n++ }

func main() {
    // Method call on map value (not addressable)
    m := map[string]T{"a": {n: 1}}
    // m["a"].Inc() // compile error
    _ = m
}
```

<details>
<summary>Solution</summary>

**Bug** (commented in starter): `m["a"]` is not addressable; you cannot call a pointer-receiver method on it. **Compile error**: `cannot call pointer method on m["a"]`.

**Fix** — extract, mutate, re-store:
```go
v := m["a"]
v.Inc()
m["a"] = v
```

Or store pointers in the map:
```go
m := map[string]*T{"a": {n: 1}}
m["a"].Inc() // OK; *T is addressable
fmt.Println(m["a"].n)
```

**Key lesson**: Map values are not addressable. To mutate a struct stored in a map, either re-store after mutation or store pointers.
</details>

---

## Bug 7 🟡 — Loop Variable Address

```go
package main

import "fmt"

func main() {
    items := []int{1, 2, 3}
    var ptrs []*int
    for _, x := range items {
        ptrs = append(ptrs, &x)
    }
    for _, p := range ptrs {
        fmt.Println(*p)
    }
}
```

In Go ≤ 1.21, what's the bug? In 1.22+?

<details>
<summary>Solution</summary>

**Pre Go 1.22**: `x` is the same variable across all iterations. All `&x` are the same pointer. After the loop, x = 3 (final value). Output:
```
3
3
3
```

**Go 1.22+**: each iteration's `x` is a fresh variable. `&x` differs per iteration. Output:
```
1
2
3
```

**Fix for pre-1.22**:
```go
for _, x := range items {
    x := x // shadow per iteration
    ptrs = append(ptrs, &x)
}
```

Or pass through a function:
```go
for _, x := range items {
    ptrs = append(ptrs, ptrTo(x))
}

func ptrTo(x int) *int { return &x }
```

**Key lesson**: Pre-1.22 loop variables are shared. Taking `&x` of a loop variable in the buggy way gives the same pointer N times. Go 1.22 fixes this.
</details>

---

## Bug 8 🟡 — Method Value Captures Stale Receiver

```go
package main

import "fmt"

type S struct{ v int }

func (s S) Show() { fmt.Println(s.v) }

func main() {
    s := S{v: 1}
    show := s.Show
    s.v = 99
    show() // expected 99
}
```

<details>
<summary>Solution</summary>

**Bug**: Method value with VALUE receiver captures a COPY of `s` at binding time (when `v == 1`). Subsequent mutations don't affect the captured copy. Output:
```
1
```

**Fix** (option A — pointer receiver):
```go
func (s *S) Show() { fmt.Println(s.v) }

s := S{v: 1}
show := s.Show // captures &s
s.v = 99
show() // 99
```

**Fix** (option B — call the method directly):
```go
s.v = 99
s.Show() // 99
```

**Key lesson**: Method values bound to value receivers freeze a snapshot. Use pointer receivers for live updates.
</details>

---

## Bug 9 🟡 — Returning Sub-slice Pins Large Array

```go
package main

import "fmt"

func first(big []byte) []byte {
    return big[:10]
}

func main() {
    big := make([]byte, 1<<20) // 1 MB
    first10 := first(big)
    big = nil // try to release big
    
    // first10 keeps the 1 MB array alive
    fmt.Println(len(first10), cap(first10))
}
```

<details>
<summary>Solution</summary>

**Bug**: `first` returns a sub-slice that shares the backing array with `big`. As long as `first10` exists, the entire 1 MB array stays alive — even though we only use 10 bytes.

Setting `big = nil` doesn't help; `first10` still references the array.

**Fix** — copy out the bytes:
```go
func first(big []byte) []byte {
    out := make([]byte, 10)
    copy(out, big[:10])
    return out
}
```

Now `first10` has its own 10-byte backing; `big`'s array is collectable.

**Key lesson**: Sub-slices keep the entire backing array alive. For long-term storage of small portions, copy out explicitly.
</details>

---

## Bug 10 🔴 — Race on Captured Slice

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    s := []int{1, 2, 3}
    var wg sync.WaitGroup
    for i := range s {
        wg.Add(1)
        go func() {
            defer wg.Done()
            s[i] *= 2 // BUG?
        }()
    }
    wg.Wait()
    fmt.Println(s)
}
```

<details>
<summary>Solution</summary>

**Bugs** (pre-1.22):
1. `i` is shared across goroutines — they may all read the same final `i`.
2. Even with that fixed, concurrent writes to different elements of `s` are SAFE (different memory locations), but if the slice were resized, races could appear.

For pre-1.22, the iteration `i` issue is the main bug. Each goroutine sees `i = 3` (out of bounds) → panic.

**Fix** (option A — pass i as arg):
```go
for i := range s {
    wg.Add(1)
    go func(i int) {
        defer wg.Done()
        s[i] *= 2
    }(i)
}
```

**Fix** (option B — Go 1.22+, no fix needed):
Each iteration's `i` is per-iteration; no race on i.

**Note**: Concurrent writes to different elements of a slice (different indices) are NOT a data race in Go's memory model. Reading and writing the same index would be.

**Key lesson**: Loop-variable capture interacts with goroutines. Fix with shadowing, arg-passing, or Go 1.22.
</details>

---

## Bug 11 🔴 — Struct Returned by Value Allocates

```go
package main

import "fmt"

type State struct {
    Data [256]int
}

func newState() State {
    return State{}
}

func main() {
    var states []State
    for i := 0; i < 100000; i++ {
        states = append(states, newState())
    }
    fmt.Println(len(states))
}
```

What's the cost?

<details>
<summary>Solution</summary>

**Discussion**: `newState()` returns a 2 KB struct by value. The compiler may pre-allocate space in the caller for the return; the call writes into that space.

For `append(states, newState())`:
- Each call returns 2 KB on the stack.
- `append` copies the 2 KB into the slice's backing array.
- Total memory traffic: 100k × 2 KB × 2 (return + append) = 400 MB.

**Optimization 1** — pre-allocate slice capacity:
```go
states := make([]State, 0, 100000) // 200 MB allocated once
for i := 0; i < 100000; i++ {
    states = append(states, newState())
}
```

This avoids slice growth reallocations.

**Optimization 2** — fill in place:
```go
states := make([]State, 100000)
for i := range states {
    fillState(&states[i])
}

func fillState(s *State) {
    *s = State{} // or set fields directly
}
```

This avoids the return-value copy.

**Benchmark** (100k iterations):
- Naive append: ~100 ms
- Pre-allocated cap: ~50 ms
- Fill in place: ~20 ms

**Key lesson**: Large struct returns + slice append pay double for memory traffic. Pre-allocate or fill in place for hot paths.
</details>

---

## Bug 12 🔴 — Mutating Map Value Field

```go
package main

import "fmt"

type Stats struct {
    Count int
}

func main() {
    m := map[string]Stats{"a": {Count: 1}}
    // m["a"].Count++ // compile error
    _ = m
}
```

What's the issue?

<details>
<summary>Solution</summary>

**Bug** (commented): `m["a"]` returns a COPY of the Stats value. You cannot modify a field of a copy through the map index expression. **Compile error**: `cannot assign to struct field m["a"].Count in map`.

**Fix** (option A — extract, mutate, re-store):
```go
s := m["a"]
s.Count++
m["a"] = s
```

**Fix** (option B — store pointers in the map):
```go
m := map[string]*Stats{"a": {Count: 1}}
m["a"].Count++ // OK: *Stats is addressable through the pointer
fmt.Println(m["a"].Count) // 2
```

**Key lesson**: Map values are not addressable. Either store pointers, or extract-mutate-restore.
</details>

---

## Bug 13 🔴 — Channel Direction Conversion

```go
package main

import "fmt"

func send(ch chan<- int, v int) { ch <- v }
func recv(ch <-chan int) int    { return <-ch }

func main() {
    ch := make(chan int, 1)
    go send(ch, 42)
    fmt.Println(recv(ch))
    
    // Now try to convert back
    var bidi chan int = ch // OK
    var sendOnly chan<- int = ch // OK
    var recvOnly <-chan int = ch // OK
    
    var bidi2 chan int = sendOnly // ?
}
```

<details>
<summary>Solution</summary>

**Bug**: `var bidi2 chan int = sendOnly` is a **compile error**. Once a channel is converted to a directional type (`chan<-` or `<-chan`), it cannot be converted back to bidirectional.

**Fix**: keep the bidirectional reference somewhere:
```go
ch := make(chan int, 1)
sendOnly := chan<- int(ch)
recvOnly := <-chan int(ch)
// To use bidirectional, use the original ch.
```

**Key lesson**: Channel direction is a one-way conversion. Hold onto the bidirectional reference if you need both directions later.
</details>

---

## Bonus Bug 🔴 — Storing Pointer to Local

```go
package main

import "fmt"

type Manager struct {
    last *int
}

func (m *Manager) Track(values []int) {
    for _, v := range values {
        m.last = &v // BUG?
    }
}

func main() {
    m := &Manager{}
    m.Track([]int{1, 2, 3})
    fmt.Println(*m.last)
}
```

In Go 1.21 vs 1.22, what does this print?

<details>
<summary>Solution</summary>

**Pre Go 1.22**: `v` is the same variable across iterations. `&v` is the same pointer. After the loop, v = 3. `*m.last == 3`.

**Go 1.22+**: each iteration's `v` is a fresh variable. After the loop, `m.last` points to the iteration where v=3 (the last). All earlier `&v` were different but overwritten by `m.last = &v` reassignments. The final `*m.last` is still 3.

In both cases the OUTPUT is `3`, but for different reasons:
- Pre-1.22: shared variable, all assignments wrote to same location.
- Post-1.22: distinct variables; only the last one is referenced.

**Lesson**: This pattern of "store pointer to loop variable" is rarely what the author intends. They probably wanted a slice of pointers to all values:

```go
type Manager struct {
    history []*int
}

func (m *Manager) Track(values []int) {
    for _, v := range values {
        v := v
        m.history = append(m.history, &v)
    }
}
```

In Go 1.22+, the inner `v := v` is unnecessary (per-iteration semantics handle it).

**Key lesson**: Storing pointers to loop variables interacts subtly with the Go 1.22 change. Be aware of which Go version your module targets.
</details>
