# Go Empty Struct — Senior Level

## 1. Overview

Senior-level mastery of the empty struct means understanding what zero-size values mean to the runtime and the compiler: the `runtime.zerobase` symbol that backs every empty-struct allocation, the rule that a trailing zero-size field forces the enclosing struct to grow by one byte (or pointer-size) so distinct instances retain distinct addresses, the absence of any GC scan for zero-size values, and how the SSA backend handles them. You also know the production patterns that arise — broadcast cancellation, lock-free presence sets, no-op interface implementations — and the pathologies that follow when the patterns are misapplied.

---

## 2. Advanced Semantics

### 2.1 Zero-Size Types in the Type System

The Go specification defines size and alignment in terms of implementation. Two relevant rules:

> "A struct or array type has size zero if it contains no fields (or elements, respectively) that have a size greater than zero."

> "Two distinct zero-size variables may have the same address in memory."

These two rules together permit the runtime to allocate zero-size values from a single shared address — the symbol `runtime.zerobase`.

```go
package main

import (
    "fmt"
    "unsafe"
)

func main() {
    fmt.Println(unsafe.Sizeof(struct{}{}))      // 0
    fmt.Println(unsafe.Sizeof([1024]struct{}{})) // 0

    type Z struct{ a [0]int; b [0]string }
    fmt.Println(unsafe.Sizeof(Z{}))              // 0
}
```

Any struct made entirely of zero-size fields has zero size.

### 2.2 `runtime.zerobase`

Inside the runtime, `mallocgc` short-circuits zero-size allocations:

```
if size == 0 {
    return unsafe.Pointer(&zerobase)
}
```

`zerobase` is a global byte declared in `runtime/malloc.go`. Every `new(struct{})` and every `&struct{}{}` returns this same address.

```go
package main

import (
    "fmt"
    "unsafe"
)

func main() {
    a := new(struct{})
    b := &struct{}{}
    fmt.Println(unsafe.Pointer(a), unsafe.Pointer(b))
    fmt.Println(a == b) // typically true
}
```

The runtime does not allocate a heap cell at all; it returns a pointer into `.data`/`.bss`. Consequently:
- Garbage collector ignores the returned pointer (it points outside the heap).
- The pointer is stable and cheap to produce.
- The pointer is not unique.

### 2.3 Trailing Zero-Size Field Padding

The spec rule "two distinct zero-size variables may have the same address" interacts with `&` (address-of). When a zero-size field sits at the end of a struct, taking the address of that field gives a pointer to "one past the struct". To keep this pointer from aliasing the next allocation, the compiler **pads the struct by one byte** (effectively, by aligning up the size).

```go
package main

import (
    "fmt"
    "unsafe"
)

type A struct {
    x int
    z struct{} // trailing zero-size field
}

type B struct {
    z struct{}
    x int       // zero-size field FIRST
}

func main() {
    fmt.Println(unsafe.Sizeof(A{})) // 16 on amd64 — one extra word for the trailing field
    fmt.Println(unsafe.Sizeof(B{})) //  8 on amd64 — leading field collapses to zero
}
```

In current Go (1.5+) the compiler issues this padding so taking `&a.z` produces an address inside the struct rather than past it. Production code rarely cares, but it surprises authors of low-level layouts and cgo bindings.

The same rule applies to arrays whose element is zero-size — the element addresses may all alias, but `array + len*elemSize` would overflow the parent if no padding existed.

### 2.4 GC Behaviour

Zero-size allocations:
- Do not consume heap memory.
- Are not tracked as separate objects.
- Are not scanned (no fields to scan).
- Do not contribute to GC pressure.

The `runtime` will, however, return a non-nil pointer for `new(struct{})`, making it usable for nil-checks and pointer comparisons. The pointer just always equals `&zerobase`.

### 2.5 Channels of `struct{}`

A `chan struct{}` is a channel whose element type has zero size. Internal sendq/recvq operations still serialise senders and receivers, but the actual element copy is a no-op. The runtime still does the work of waking receivers; the only saving is the byte that would otherwise be copied per send.

For close-broadcast, the cost is: walk every blocked receiver in the recvq, mark the channel closed, signal each waiter. This is `O(N)` in the number of receivers — close is not free, just data-free.

### 2.6 Maps of `struct{}` Values

The Go map implementation stores entries in buckets shaped roughly:

```
struct bucket {
    tophash [bucketCnt]uint8
    keys    [bucketCnt]K
    values  [bucketCnt]V
    overflow *bucket
}
```

When `V == struct{}`, the `values` array has zero size. The compiler statically removes the value field from the bucket layout. The bucket consequently has no value bytes — only tophash, keys, and overflow.

For `bucketCnt = 8`:
- `map[int]bool` bucket: ~88 bytes (8 keys × 8 bytes + 8 values × 1 byte + 8 tophash + overflow).
- `map[int]struct{}` bucket: ~80 bytes (no value bytes).

The saving scales with bucket count. For maps with millions of entries the difference is real.

### 2.7 SSA Representation

In the compiler's SSA backend, zero-size types are mostly invisible. Values of zero-size types fold to `OpStructMake` with no members, or simply disappear at the value-numbering stage. Stores and loads of zero-size values become no-ops; the SSA `MakeResult` for a zero-size return uses no register.

For `chan struct{}` operations the runtime call `chansend` and `chanrecv` still receives a pointer (to nothing), but the typeinfo says "size 0" and the copy loop in `typedmemmove` short-circuits.

### 2.8 Comparison Semantics

`struct{}` is comparable; all values compare equal. This is consistent with the rule that comparing structs compares each field — there are no fields, so the result is `true`. It is also consistent with hash behaviour — hashing a struct hashes its fields; with no fields the hash is constant.

```go
m := map[struct{}]int{} // legal — struct{} is comparable
m[struct{}{}] = 1
m[struct{}{}] = 2
fmt.Println(len(m), m[struct{}{}]) // 1 2
```

The map degenerates to a one-element map. The key carries no information.

---

## 3. Production Patterns

### 3.1 Broadcast Cancellation

```go
type Cancel struct {
    once sync.Once
    ch   chan struct{}
}

func New() *Cancel             { return &Cancel{ch: make(chan struct{})} }
func (c *Cancel) Done() <-chan struct{} { return c.ch }
func (c *Cancel) Fire()        { c.once.Do(func() { close(c.ch) }) }
```

This is the building block of `context.cancelCtx` in the standard library. The `done` field is `chan struct{}`; `cancel(...)` calls `close(done)` under a mutex.

### 3.2 Presence Sets in Hot Paths

```go
var blocked atomic.Pointer[map[string]struct{}]

func reload(ids []string) {
    m := make(map[string]struct{}, len(ids))
    for _, id := range ids {
        m[id] = struct{}{}
    }
    blocked.Store(&m)
}

func isBlocked(id string) bool {
    m := blocked.Load()
    if m == nil { return false }
    _, ok := (*m)[id]
    return ok
}
```

A read-mostly set works well as `*map[K]struct{}` swapped atomically. The empty-struct value avoids per-entry bytes that otherwise inflate cache pressure.

### 3.3 Method-Only Singleton

```go
type Discard struct{}
var DiscardWriter = Discard{}

func (Discard) Write(p []byte) (int, error) { return len(p), nil }
```

`io.Discard` is exactly this idea (with an unexported empty struct type). The package exports the value, not the type, which makes the singleton-ness explicit.

### 3.4 Marker Types in Public APIs

```go
type Stop struct{}

type Visitor interface {
    Visit(node Node) any // returns Stop{} to stop walk
}
```

A typed marker beats a magic string or `nil any`.

### 3.5 Channel of Cancel-and-Replace

```go
type Service struct {
    mu   sync.Mutex
    quit chan struct{}
}

func (s *Service) Restart() {
    s.mu.Lock()
    defer s.mu.Unlock()
    if s.quit != nil { close(s.quit) }
    s.quit = make(chan struct{})
    go s.run(s.quit)
}
```

Each restart produces a fresh `chan struct{}`; old workers see their previous channel closed and exit.

---

## 4. Concurrency Considerations

### 4.1 Close Is the Broadcast Primitive

A buffered channel of capacity N can deliver at most N notifications. Close delivers an infinite sequence of "channel closed" returns, which is what makes it suitable for fan-out cancellation.

### 4.2 Send-After-Close Panics

A `chan struct{}` used as broadcast must never be sent to after close. Hide the channel behind a `Cancel` type that exposes only `Done()` and `Fire()`.

### 4.3 Select on Done Plus Work

```go
for {
    select {
    case <-ctx.Done():
        return
    case msg := <-work:
        process(msg)
    }
}
```

The `Done()` channel is `<-chan struct{}`. The receive returns `struct{}{}, false` once closed, which is how the loop notices cancellation.

### 4.4 Multiple Closers

If two paths can call `close`, the second panics. Use `sync.Once`:

```go
var once sync.Once
closeFn := func() { once.Do(func() { close(quit) }) }
```

### 4.5 Idle Memory From Open Channels

A `chan struct{}` itself costs ~96 bytes (channel header). Closing does not free the header — only making the channel unreferenced does. For high-volume restart patterns, do not leak channels by ignoring old ones.

---

## 5. Memory and GC Interactions

### 5.1 No Per-Value Allocation

A literal `struct{}{}` becomes a no-op at the SSA level. Storing `struct{}{}` in a map slot stores nothing. Receiving from `chan struct{}` produces no copy.

### 5.2 Pointer to Empty Struct

`&struct{}{}` is a pointer into `.bss` (the `zerobase` symbol). It does not pin a heap object. The GC sees the pointer as outside the heap and ignores it.

```go
package main

import (
    "fmt"
    "runtime"
    "unsafe"
)

func main() {
    var before, after runtime.MemStats
    runtime.GC()
    runtime.ReadMemStats(&before)
    var ps []*struct{}
    for i := 0; i < 1_000_000; i++ {
        ps = append(ps, &struct{}{})
    }
    runtime.ReadMemStats(&after)
    fmt.Println("heap delta:", after.HeapAlloc-before.HeapAlloc)
    fmt.Println("first ptr:", unsafe.Pointer(ps[0]))
}
```

`ps` itself grows (one slice of pointers), but each pointer points to `zerobase`. The empty struct values themselves cost nothing.

### 5.3 Trailing Field Padding And Layout

A type with a trailing zero-size field grows by one word. This affects:
- `unsafe.Sizeof`
- Packed binary layouts (cgo, network protocols)
- Field alignment if the struct is embedded into another

Fix: place zero-size fields at the start or middle of the struct, not at the end. Or add a non-zero trailing field intentionally.

### 5.4 Map Bucket Layout

When the value type is `struct{}`, the bucket has no `values` array. Iteration walks fewer bytes; cache lines hold more entries; hashing and hit-tests run faster on average. The win is small (~5-10%) but free.

---

## 6. Production Incidents

### 6.1 Forgotten Trailing Field Breaks cgo Layout

A team added an empty-struct "marker" field at the end of a C-compatible struct:

```go
type Header struct {
    Magic uint32
    Len   uint32
    _     struct{} // marker — do not embed!
}
```

Go reported `unsafe.Sizeof(Header{}) == 12`, but the C side expected 8. The `_` field (a blank-name zero-size field at the end) added padding. Fix: remove the marker or move it to position 0.

### 6.2 Leaked Goroutines on a `chan struct{}`

A health-check used a buffered `chan struct{}` of capacity 1 with `select { case ch <- struct{}{}: default: }` to ping. A consumer leaked. Over weeks, ~50k goroutines accumulated, each blocked on the receive. Fix: switch to `close`-broadcast and a single shared channel; the new design has no per-consumer goroutine.

### 6.3 Two Sets of Truth

A service kept both `map[string]bool` (legacy) and `map[string]struct{}` (new). The two maps drifted. Fix: pick one — the empty-struct version since `false` carried no semantics — and remove the other.

### 6.4 Pointer Identity Test in a Pool

A pool stored `*struct{}` as tokens. A test used `if p1 == p2` to assert different tokens. The runtime collapsed both onto `zerobase`; the test was flaky on some Go versions. Fix: use `*struct{ id int }` instead.

---

## 7. Best Practices

1. Use `map[K]struct{}` for sets in hot paths.
2. Use `chan struct{}` for cancellation, never for data.
3. Hide `close` behind a `Cancel` or `Done` type with `sync.Once`.
4. Place zero-size fields at the start of structs, not the end.
5. Do not depend on `&struct{}{}` pointer identity.
6. Use generics to write a single `Set[T]` for the codebase.
7. Document every method-only type as stateless.
8. When auditing hot map types, swap `bool` for `struct{}` if the value is unused.
9. Verify cgo and network-encoded structs have zero zero-size fields.
10. Read the `runtime.zerobase` declaration to internalise the address-collapse rule.

---

## 8. Reading the Compiler Output

```bash
# Inspect struct sizes:
go vet -unsafeptr=false ./...
go run -gcflags="-m" ./...

# Check escape:
go build -gcflags="-m" 2>&1 | grep "moved to heap"

# Disassemble close-broadcast:
go tool objdump -s "close" ./bin
```

Look for `runtime.closechan`, `runtime.zerobase`, and `runtime.chansend1` calls.

---

## 9. Self-Assessment Checklist

- [ ] I know `runtime.zerobase` and why empty-struct pointers may alias
- [ ] I can predict the size of a struct that contains zero-size fields
- [ ] I know the trailing-zero-size-field padding rule
- [ ] I know `close` is the broadcast primitive
- [ ] I guard close with `sync.Once`
- [ ] I can describe how `map[K]struct{}` saves memory at the bucket level
- [ ] I avoid pointer identity tests on empty-struct values
- [ ] I can explain why GC ignores empty-struct values
- [ ] I have used `chan struct{}` correctly in `select` cancellation patterns

---

## 10. Summary

Empty struct values are a runtime and compiler convention as much as a language feature. The compiler treats their stores and loads as no-ops, the runtime allocates them at a single shared address (`zerobase`), and the GC ignores them. Three idioms drive almost all production usage: presence sets via `map[K]struct{}`, broadcast cancellation via `close(chan struct{})`, and method-only types satisfying interfaces. The two trips are pointer identity (implementation-defined) and trailing zero-size fields (force one byte of padding).

---

## 11. Further Reading

- [`runtime/malloc.go` — zerobase declaration](https://cs.opensource.google/go/go/+/refs/heads/master:src/runtime/malloc.go)
- [`runtime/runtime.go` — runtime symbols](https://cs.opensource.google/go/go/+/refs/heads/master:src/runtime/runtime.go)
- [Go Spec — Struct types](https://go.dev/ref/spec#Struct_types)
- [Go Spec — Size and alignment guarantees](https://go.dev/ref/spec#Size_and_alignment_guarantees)
- [Dave Cheney — The empty struct](https://dave.cheney.net/2014/03/25/the-empty-struct)
- [`context/context.go` — done channel](https://cs.opensource.google/go/go/+/refs/heads/master:src/context/context.go)
- 2.3.4 Maps (bucket layout)
- 2.7 Pointers (zerobase, identity)
- 2.7.4 Memory Management
