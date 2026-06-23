# Go Empty Struct — Middle Level

## 1. Introduction

At middle level, the empty struct stops being a curiosity and becomes a deliberate design tool. You decide between `map[K]struct{}` and `map[K]bool` for principled reasons, you use `chan struct{}` for coordination patterns (one-shot done, broadcast cancel, fan-in/fan-out), and you reach for method-only structs to satisfy interfaces without state. You also recognize the cases where an empty struct is the wrong answer.

---

## 2. Prerequisites
- Junior-level empty struct material
- Maps, channels, goroutines
- `sync.Mutex`, `sync.Once`, `sync.WaitGroup`
- `select` statements
- Method sets and interface satisfaction
- Basic understanding of escape analysis

---

## 3. Glossary

| Term | Definition |
|------|-----------|
| Set | A map whose values carry no information (`map[K]struct{}`) |
| Signal channel | A channel whose elements carry no information (`chan struct{}`) |
| Broadcast close | Closing a channel to wake every receiver |
| Sentinel struct | An empty struct used as a typed marker |
| Method receiver | The empty struct value bound to a method call |
| Tagless interface | An interface satisfied by an empty struct method-only type |
| Capacity-1 signal | A buffered `chan struct{}` of capacity 1 used as a once-flag |
| Idle-shutdown | A pattern combining `done` channel and timer to exit cleanly |

---

## 4. Core Concepts

### 4.1 Sets — `map[K]struct{}` vs `map[K]bool`

Both work. The empty-struct version costs zero bytes per value entry; the bool version costs one byte plus alignment padding. In typical Go map implementations the per-bucket overhead is similar, so the saving is the value byte itself. For 1 million entries that is roughly 1 MB.

```go
package main

import "fmt"

type Set[T comparable] map[T]struct{}

func New[T comparable](xs ...T) Set[T] {
    s := make(Set[T], len(xs))
    for _, x := range xs {
        s[x] = struct{}{}
    }
    return s
}

func (s Set[T]) Add(v T)    { s[v] = struct{}{} }
func (s Set[T]) Has(v T) bool { _, ok := s[v]; return ok }
func (s Set[T]) Del(v T)    { delete(s, v) }
func (s Set[T]) Len() int   { return len(s) }

func (s Set[T]) Union(o Set[T]) Set[T] {
    out := make(Set[T], len(s)+len(o))
    for k := range s { out[k] = struct{}{} }
    for k := range o { out[k] = struct{}{} }
    return out
}

func (s Set[T]) Inter(o Set[T]) Set[T] {
    out := Set[T]{}
    for k := range s {
        if _, ok := o[k]; ok {
            out[k] = struct{}{}
        }
    }
    return out
}

func main() {
    a := New(1, 2, 3)
    b := New(2, 3, 4)
    fmt.Println(a.Inter(b)) // map[2:{} 3:{}]
    fmt.Println(a.Union(b)) // map[1:{} 2:{} 3:{} 4:{}]
}
```

**When to choose `bool` instead**: if `false` carries semantic meaning ("known to be excluded"). For example, a feature flag map where `true` means enabled, `false` means explicitly disabled, and absence means default. There the bool's two values matter.

### 4.2 Signal Channels and Coordination Patterns

A signal channel is `chan struct{}`. The single most common pattern is **close to broadcast**:

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

func main() {
    cancel := make(chan struct{})
    var wg sync.WaitGroup

    for id := 0; id < 4; id++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            for {
                select {
                case <-cancel:
                    fmt.Println(id, "stop")
                    return
                case <-time.After(20 * time.Millisecond):
                    // do tick
                }
            }
        }(id)
    }

    time.Sleep(50 * time.Millisecond)
    close(cancel)
    wg.Wait()
}
```

A close on a channel wakes every blocked receiver simultaneously and turns the channel into a permanently-ready receiver. This is the only way to deliver one signal to N goroutines without per-goroutine bookkeeping.

### 4.3 Done Versus Cancel

There are two related signal patterns:

- **Done**: producer closes when finished. Consumers wait until closed.
- **Cancel**: any party closes to abort all consumers.

Both look like `chan struct{}`; the semantic difference is which side closes.

```go
done := make(chan struct{})
go func() { defer close(done); work() }()
<-done

cancel := make(chan struct{})
go worker(cancel)
go worker(cancel)
close(cancel) // both stop
```

`context.Context` standardizes this with `ctx.Done() <-chan struct{}`.

### 4.4 Method-Only Types and Interface Satisfaction

A type with no fields can still satisfy a rich interface:

```go
package main

import (
    "fmt"
    "io"
)

type Discard struct{}

func (Discard) Write(p []byte) (int, error) { return len(p), nil }

func main() {
    var w io.Writer = Discard{}
    fmt.Fprintf(w, "this goes nowhere\n") // returns (n, nil)
}
```

`io.Discard` in the standard library is exactly this idea. It is a value of an unexported empty-struct type.

### 4.5 Sentinel and Marker Types

```go
type none struct{}

func resolve(name string) (any, error) {
    if name == "" {
        return none{}, nil // typed marker
    }
    return "value", nil
}
```

Compared to `nil`, a sentinel struct keeps the static type information. The caller can type-switch on `none{}` rather than on `nil any` (which is brittle).

### 4.6 Capacity-1 Buffered Signal

```go
ready := make(chan struct{}, 1)
select {
case ready <- struct{}{}: // non-blocking notify
default:
}
```

A capacity-1 buffered `chan struct{}` lets a producer "ping" without blocking and without delivering more than one notification per drain. This is rarely the right choice — the close-broadcast pattern is usually clearer for one-shot signals — but it is appropriate when the consumer keeps a long-running select loop and you want a coalesced notify.

### 4.7 Comparison and Equality

`struct{}` is comparable: every value equals every other.

```go
fmt.Println(struct{}{} == struct{}{}) // true
```

A field of type `struct{}{}` does not break struct comparability. It also does not break struct hashability (the field contributes zero bits to any hash).

---

## 5. Real-World Analogies

**Library card index**: `map[string]struct{}` is a card index where the only fact recorded is "this title exists". The card carries no detail beyond the title; absence means the title is not in the catalog.

**Fire alarm**: `close(chan struct{})` is the fire alarm — pulled once, heard by everyone. After it fires, the channel cannot un-close, the same way an alarm cannot un-ring within an alert window.

**Punctuation marker**: a method-only struct is like a chapter divider in a book — it carries no content, but it gives the reader an attachment point for chapter-level operations.

---

## 6. Mental Models

### Model 1 — Empty Struct as "Yes" Token

```
map: key → "Yes"
chan: send "Yes"
type: receiver "Yes-typed"
```

The value's only role is to be present.

### Model 2 — Channel Close as Latch

```
                      close(ch)
                          │
state:    open ────────► closed (forever)
              └─ blocking ┘    └─ all receives return zero ─┘
```

Once closed, the latch never reopens. Receivers see a non-blocking return forever after.

### Model 3 — Method-Only Type as Pure Function Bundle

```
type X struct{}
  ├─ X.Foo()
  ├─ X.Bar()
  └─ X.Baz()

X{} carries no data; it is a name for the bundle.
```

---

## 7. Pros & Cons

### Pros
- Zero bytes per value
- Clear intent in maps and channels
- Free interface implementations from state
- Unique pattern for broadcast cancellation

### Cons
- Pointer identity is implementation-defined
- Trailing zero-size field can change struct size
- New developers find `struct{}{}` syntax awkward
- Sometimes a `bool`'s two states are more meaningful

---

## 8. Use Cases

1. Generic sets and dedup tables
2. `done`/`cancel`/`quit` channels
3. `io.Discard`-style writers and readers
4. Method-only loggers, marshallers, walkers
5. Sentinel values that need a typed identity
6. One-shot broadcast notifications
7. Test stubs satisfying interfaces with no state
8. Type tags for compile-time discrimination

---

## 9. Code Examples

### Example 1 — Memory Comparison Benchmark

```go
package main

import (
    "fmt"
    "runtime"
    "testing"
)

func BenchmarkSetBool(b *testing.B) {
    for i := 0; i < b.N; i++ {
        m := make(map[int]bool, 1024)
        for j := 0; j < 1024; j++ {
            m[j] = true
        }
    }
}

func BenchmarkSetStruct(b *testing.B) {
    for i := 0; i < b.N; i++ {
        m := make(map[int]struct{}, 1024)
        for j := 0; j < 1024; j++ {
            m[j] = struct{}{}
        }
    }
}

func memUsage() uint64 {
    var s runtime.MemStats
    runtime.ReadMemStats(&s)
    return s.HeapAlloc
}

func main() {
    fmt.Println("run with: go test -bench=. -benchmem")
}
```

### Example 2 — Close-to-Broadcast Pattern

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

type Notifier struct {
    once sync.Once
    ch   chan struct{}
}

func New() *Notifier { return &Notifier{ch: make(chan struct{})} }

func (n *Notifier) Done() <-chan struct{} { return n.ch }

func (n *Notifier) Fire() { n.once.Do(func() { close(n.ch) }) }

func main() {
    n := New()
    var wg sync.WaitGroup
    for i := 0; i < 3; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            <-n.Done()
            fmt.Println(id, "fired")
        }(i)
    }
    time.Sleep(20 * time.Millisecond)
    n.Fire()
    n.Fire() // safe; only the first close runs
    wg.Wait()
}
```

`sync.Once` guards `close` so callers can `Fire` repeatedly.

### Example 3 — Type-Set as Interface Implementation

```go
package main

import (
    "fmt"
    "io"
    "strings"
)

type LineCounter struct{ count int }

func (l *LineCounter) Write(p []byte) (int, error) {
    l.count += strings.Count(string(p), "\n")
    return len(p), nil
}

type Sink struct{}

func (Sink) Write(p []byte) (int, error) { return len(p), nil }

func process(w io.Writer) {
    fmt.Fprintln(w, "alpha")
    fmt.Fprintln(w, "beta")
}

func main() {
    var s Sink
    process(s)            // empty-struct sink discards
    var lc LineCounter
    process(&lc)
    fmt.Println(lc.count) // 2
}
```

### Example 4 — Set Operations With Generics

```go
package main

import "fmt"

type Set[T comparable] map[T]struct{}

func (s Set[T]) Diff(o Set[T]) Set[T] {
    out := Set[T]{}
    for k := range s {
        if _, ok := o[k]; !ok {
            out[k] = struct{}{}
        }
    }
    return out
}

func main() {
    a := Set[int]{1: {}, 2: {}, 3: {}}
    b := Set[int]{2: {}, 3: {}, 4: {}}
    fmt.Println(a.Diff(b)) // map[1:{}]
}
```

### Example 5 — Idle-Shutdown Combining Done and Timer

```go
package main

import (
    "fmt"
    "time"
)

func runAlive(quit chan struct{}, idle time.Duration) {
    timer := time.NewTimer(idle)
    defer timer.Stop()

    for {
        select {
        case <-quit:
            fmt.Println("stopped via signal")
            return
        case <-timer.C:
            fmt.Println("stopped by idle timeout")
            return
        }
    }
}

func main() {
    quit := make(chan struct{})
    go runAlive(quit, 30*time.Millisecond)
    time.Sleep(50 * time.Millisecond)
    close(quit) // safe even if timer already fired (receiver returned)
}
```

---

## 10. Coding Patterns

### Pattern 1 — Generic Set Type

```go
type Set[T comparable] map[T]struct{}
```

### Pattern 2 — Broadcast Done Wrapper

```go
type Done struct {
    once sync.Once
    ch   chan struct{}
}

func NewDone() *Done             { return &Done{ch: make(chan struct{})} }
func (d *Done) Channel() <-chan struct{} { return d.ch }
func (d *Done) Close()           { d.once.Do(func() { close(d.ch) }) }
```

### Pattern 3 — Unbuffered Signal With Select Default

```go
select {
case <-done:
    return
default:
    // not yet signaled
}
```

### Pattern 4 — Coalesced Notify (Capacity-1 Buffer)

```go
notify := make(chan struct{}, 1)

select {
case notify <- struct{}{}:
default:
    // already pending
}
```

### Pattern 5 — Method-Only Type Behind an Interface

```go
type Logger interface{ Info(string) }
type Stdout struct{}
func (Stdout) Info(msg string) { fmt.Println(msg) }
```

---

## 11. Clean Code Guidelines

1. Prefer typed wrappers (`Set[T]`, `Done`) over raw `map[K]struct{}` and `chan struct{}` in public APIs.
2. Use `close` for broadcast, send for hand-offs.
3. Guard `close` with `sync.Once` if the channel may be closed by multiple paths.
4. Document method-only types with a one-line comment about statelessness.
5. Avoid pointer identity tricks; prefer named pointers when uniqueness matters.

---

## 12. Product Use / Feature Example

A **subscription manager** that tracks active topics and signals shutdown:

```go
package main

import (
    "fmt"
    "sync"
)

type Manager struct {
    mu     sync.Mutex
    topics map[string]struct{}
    done   chan struct{}
    once   sync.Once
}

func NewManager() *Manager {
    return &Manager{
        topics: map[string]struct{}{},
        done:   make(chan struct{}),
    }
}

func (m *Manager) Subscribe(topic string) {
    m.mu.Lock()
    defer m.mu.Unlock()
    m.topics[topic] = struct{}{}
}

func (m *Manager) Unsubscribe(topic string) {
    m.mu.Lock()
    defer m.mu.Unlock()
    delete(m.topics, topic)
}

func (m *Manager) Active() []string {
    m.mu.Lock()
    defer m.mu.Unlock()
    out := make([]string, 0, len(m.topics))
    for t := range m.topics {
        out = append(out, t)
    }
    return out
}

func (m *Manager) Done() <-chan struct{} { return m.done }

func (m *Manager) Shutdown() { m.once.Do(func() { close(m.done) }) }

func main() {
    m := NewManager()
    m.Subscribe("orders")
    m.Subscribe("payments")
    fmt.Println(m.Active())
    m.Shutdown()
    <-m.Done()
    fmt.Println("clean exit")
}
```

The `topics` map uses zero-byte values; the `done` channel uses a zero-byte element; the manager's behaviour is sketched entirely with these two empty-struct idioms.

---

## 13. Error Handling

Empty struct values cannot fail. Errors come from the surrounding map/channel operations:

```go
done := make(chan struct{})
close(done)

if _, ok := <-done; !ok {
    // closed; ok is false
}

defer func() {
    if r := recover(); r != nil {
        fmt.Println("recovered:", r)
    }
}()
close(done) // panic: close of closed channel
```

Wrap closes in `sync.Once` to make `Close` idempotent.

---

## 14. Security Considerations

1. **Set membership is observable** — anyone with read access to the map can enumerate keys; the value type does not affect this.
2. **Broadcast signals trust the closer** — exposing the raw channel lets callers shut down everything; expose a method like `Shutdown` instead.
3. **Method-only types still expose behaviour** — review their methods for IO, panics, and side effects.
4. **Goroutine leaks** can pin sets and channels; design every long-lived consumer to honour cancellation.

---

## 15. Performance Tips

1. **Memory savings of `map[K]struct{}`** — about 1 byte per entry vs `map[K]bool`, sometimes amplified by alignment.
2. **`close` is O(receivers)** — every blocked receiver wakes; for many waiters this can be measurable.
3. **Allocating an empty struct value is free** — `struct{}{}` is a constant.
4. **Avoid per-iteration `struct{}{}` literals** in tight code only as a style fix; the compiler folds them to nothing.
5. **Trailing zero-size field** changes `unsafe.Sizeof` of the enclosing type — verify if you cgo or rely on layouts.

---

## 16. Metrics & Analytics

```go
package main

import (
    "fmt"
    "sync"
)

type Tracker struct {
    mu   sync.Mutex
    seen map[string]struct{}
    hits int
}

func New() *Tracker { return &Tracker{seen: map[string]struct{}{}} }

func (t *Tracker) Visit(id string) (firstTime bool) {
    t.mu.Lock()
    defer t.mu.Unlock()
    t.hits++
    if _, ok := t.seen[id]; ok {
        return false
    }
    t.seen[id] = struct{}{}
    return true
}

func (t *Tracker) Stats() (hits int, unique int) {
    t.mu.Lock()
    defer t.mu.Unlock()
    return t.hits, len(t.seen)
}

func main() {
    t := New()
    for _, id := range []string{"a", "b", "a", "c", "b"} {
        t.Visit(id)
    }
    h, u := t.Stats()
    fmt.Printf("hits=%d unique=%d\n", h, u) // hits=5 unique=3
}
```

---

## 17. Best Practices

1. Use `map[K]struct{}` for sets; wrap behind a typed API.
2. Use `chan struct{}` for signal channels; close to broadcast.
3. Guard channel close with `sync.Once` if multiple closers exist.
4. Hide raw channels behind method-only accessors.
5. Document method-only types as stateless.
6. Avoid pointer identity of zero-size values.
7. Keep trailing zero-size fields in mind when laying out structs.
8. Prefer `close(done)` over a buffered capacity-1 ping for one-shot signals.

---

## 18. Edge Cases & Pitfalls

### Pitfall 1 — Closing Twice

`close(ch)` on a closed channel panics. Use `sync.Once`.

### Pitfall 2 — Send-After-Close

Sending on a closed `chan struct{}` panics. For broadcast, never send after close.

### Pitfall 3 — Trailing Zero-Size Field

```go
type T struct {
    a int
    b struct{}
}
// unsafe.Sizeof(T{}) is larger than unsafe.Sizeof(int(0))
```

Move `b` earlier or accept the extra padding.

### Pitfall 4 — Iterating With Value

```go
for k, v := range set {
    _ = v // always struct{}{}; do not use it
    use(k)
}
```

Use `for k := range set` to drop the unused variable.

### Pitfall 5 — Capacity-1 As Signal

A buffered capacity-1 `chan struct{}` is sometimes used where `close` would be cleaner. Re-evaluate: is the consumer a one-shot waiter? Use `close`.

---

## 19. Common Mistakes

| Mistake | Fix |
|---------|-----|
| Sending on a closed signal channel | Use `close` exclusively for broadcast |
| Closing a closed channel | Wrap in `sync.Once` |
| Forgetting `{}` value syntax | Write `struct{}{}` |
| Trailing empty-struct field surprise | Place earlier in struct |
| Relying on `&struct{}{}` distinct addresses | Use named non-empty type for identity |

---

## 20. Common Misconceptions

**Misconception 1**: "Closing a channel sends `struct{}{}` to all receivers."
**Truth**: It does not send anything. Receivers see the zero value of the element type and `ok == false`.

**Misconception 2**: "Empty struct fields make a struct uncomparable."
**Truth**: They contribute nothing to comparison. Fields of comparable types preserve comparability.

**Misconception 3**: "`map[K]struct{}` is exotic — most Go code uses `map[K]bool`."
**Truth**: Both are common. Standard library and large codebases use the empty-struct idiom heavily for sets.

**Misconception 4**: "The empty struct value allocates."
**Truth**: It does not. Storage is zero. Map and channel infrastructure may allocate, but not for the value itself.

**Misconception 5**: "An interface satisfied by a method-only struct cannot have non-trivial behaviour."
**Truth**: Methods can do arbitrary work; the lack of fields only forbids per-instance state.

---

## 21. Tricky Points

1. The type `struct{}` and the value `struct{}{}` look similar but appear in different syntactic positions.
2. `close` is the broadcast primitive; sending is a hand-off.
3. Trailing zero-size fields change `unsafe.Sizeof` of the parent struct.
4. Pointer identity of zero-size values is not portable.
5. Capacity-1 buffered signal channels coalesce multiple notifies into at most one delivery.

---

## 22. Test

```go
package main

import (
    "sync"
    "testing"
)

func TestSetBasic(t *testing.T) {
    s := map[string]struct{}{}
    s["a"] = struct{}{}
    if _, ok := s["a"]; !ok {
        t.Error("expected a")
    }
}

func TestBroadcastClose(t *testing.T) {
    ch := make(chan struct{})
    var wg sync.WaitGroup
    fired := make([]bool, 4)
    for i := range fired {
        wg.Add(1)
        i := i
        go func() {
            defer wg.Done()
            <-ch
            fired[i] = true
        }()
    }
    close(ch)
    wg.Wait()
    for i, f := range fired {
        if !f {
            t.Errorf("receiver %d did not fire", i)
        }
    }
}

func TestOnceCloseGuard(t *testing.T) {
    var once sync.Once
    ch := make(chan struct{})
    closeOnce := func() { once.Do(func() { close(ch) }) }
    closeOnce()
    closeOnce()
    select {
    case <-ch:
    default:
        t.Error("channel should be closed")
    }
}
```

---

## 23. Tricky Questions

**Q1**: What does this print?
```go
ch := make(chan struct{})
close(ch)
v, ok := <-ch
fmt.Println(v, ok)
```
**A**: `{} false`. The receive returns the zero value of `struct{}` and `ok=false` because the channel is closed.

**Q2**: What is `unsafe.Sizeof([3]struct{}{})`?
**A**: `0`. Arrays of zero-size types have zero total size.

**Q3**: Can a `chan struct{}` be `nil`?
**A**: Yes. A `nil` `chan struct{}` blocks forever on send and receive, like any nil channel.

---

## 24. Cheat Sheet

```go
// Generic set
type Set[T comparable] map[T]struct{}
func (s Set[T]) Add(v T) { s[v] = struct{}{} }
func (s Set[T]) Has(v T) bool { _, ok := s[v]; return ok }

// Broadcast signal
done := make(chan struct{})
close(done) // wake all receivers

// Idempotent close
var once sync.Once
once.Do(func() { close(done) })

// Method-only type
type Discard struct{}
func (Discard) Write(p []byte) (int, error) { return len(p), nil }

// Coalesced notify
notify := make(chan struct{}, 1)
select {
case notify <- struct{}{}:
default:
}
```

---

## 25. Self-Assessment Checklist

- [ ] I can implement a generic set type
- [ ] I can broadcast cancellation with `close(chan struct{})`
- [ ] I guard repeated close with `sync.Once`
- [ ] I attach methods to empty-struct types to satisfy interfaces
- [ ] I avoid relying on `&struct{}{}` pointer identity
- [ ] I recognise the trailing-zero-size-field caveat
- [ ] I prefer `close` over send for one-shot broadcasts
- [ ] I know when a `bool` map is more meaningful than a `struct{}` map

---

## 26. Summary

Middle-level use of the empty struct is mostly an exercise in API design. Sets become typed wrappers around `map[K]struct{}`. Done/cancel signals become channels of `struct{}` closed once with `sync.Once`. Method-only structs back interface implementations that need no per-instance state. Edge cases — trailing fields, pointer identity, double close — are mostly invisible if you stay on the well-trodden patterns.

---

## 27. What You Can Build

- Generic Set with union/intersect/diff
- Cancellation primitives (Done, Notifier)
- Stateless writers, readers, codecs
- Sentinel marker types
- Broadcasters with coalesced notify
- Subscription managers and event hubs

---

## 28. Further Reading

- [Dave Cheney — The empty struct](https://dave.cheney.net/2014/03/25/the-empty-struct)
- [Go Spec — Struct types](https://go.dev/ref/spec#Struct_types)
- [`io.Discard` source](https://cs.opensource.google/go/go/+/refs/heads/master:src/io/io.go)
- [`context` package design](https://pkg.go.dev/context)

---

## 29. Related Topics

- 2.3.4 Maps
- 2.3.5 Structs
- Chapter 7 Channels and goroutines
- 2.7 Pointers
- 3.X Generics

---

## 30. Diagrams & Visual Aids

### Set vs Bool map memory

```
map[K]bool:        map[K]struct{}:
[K | bool]         [K | (no value)]
   ↑                  ↑
1 B per entry        0 B per entry
```

### Broadcast cancellation

```
                close(cancel)
                     │
       ┌─────────────┼─────────────┐
       ▼             ▼             ▼
   worker A      worker B       worker C
   <-cancel      <-cancel       <-cancel
   return        return         return
```

### Method-only type

```
type X struct{}             ┌─────────┐
                            │  X{}    │
methods on X:               └────┬────┘
   X.Foo(), X.Bar()              │
                                 │ no fields
                                 ▼
                            zero bytes
```
