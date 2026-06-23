# Go Empty Struct — Junior Level

## 1. Introduction

### What is it?
An **empty struct** is a struct type that has **zero fields**: `struct{}`. The single value of this type is `struct{}{}` — the empty struct value. It carries no data, takes zero bytes of memory, and serves as a way to represent presence/absence or signal events without storing payload.

### How to use it?
```go
package main

import (
    "fmt"
    "unsafe"
)

func main() {
    var e struct{}                  // a variable of empty-struct type
    fmt.Println(unsafe.Sizeof(e))   // 0

    set := map[string]struct{}{}    // a set of strings
    set["hello"] = struct{}{}
    set["world"] = struct{}{}
    _, found := set["hello"]
    fmt.Println(found)              // true

    done := make(chan struct{})     // a signal channel
    go func() {
        // do work
        close(done)
    }()
    <-done
    fmt.Println("worker finished")
}
```

The empty struct is used in three classic places: as a map value to make a set, as a channel element type for signals, and as a method-set-only type with no state.

---

## 2. Prerequisites
- Structs basics (3.5)
- Maps basics (3.4)
- Channels basics (Chapter 7)
- Variable declarations
- The `unsafe.Sizeof` helper

---

## 3. Glossary

| Term | Definition |
|------|-----------|
| empty struct | The type `struct{}` with no fields |
| empty struct value | `struct{}{}` — the only value of type `struct{}` |
| zero-size type | A type whose size is 0 bytes (`struct{}` and `[0]T`) |
| set | A collection where membership is the only fact stored |
| signal channel | A `chan struct{}` used only to coordinate, never to carry data |
| zerobase | A runtime symbol used as the address for zero-size allocations |
| close-broadcast | Pattern of `close(chan struct{})` to wake every receiver |
| done channel | A signal channel that is closed when work is finished |
| identity collapse | Two distinct empty struct values may share an address |
| method-only type | A struct that exists only to attach methods via its method set |

---

## 4. Core Concepts

### 4.1 The Type and Its Single Value

`struct{}` is a struct type with no fields. There is exactly one value of this type: `struct{}{}`.

```go
package main

import "fmt"

func main() {
    var a, b struct{}
    fmt.Println(a == b) // true — every empty struct equals every other
    a = struct{}{}      // the only assignable value
    fmt.Println(a == b) // true
}
```

There is nothing to differentiate two values; the type carries zero bits of information.

### 4.2 Size Is Zero

```go
package main

import (
    "fmt"
    "unsafe"
)

func main() {
    fmt.Println(unsafe.Sizeof(struct{}{}))            // 0
    fmt.Println(unsafe.Sizeof([100]struct{}{}))       // 0
    fmt.Println(unsafe.Sizeof(map[string]struct{}{})) // 8 (the map header pointer)
}
```

Even an array of 100 empty structs has size 0. The map header itself has size, but its values do not.

### 4.3 Set Semantics — `map[K]struct{}`

Go has no built-in set type. The idiomatic substitute is a map whose value is `struct{}`:

```go
package main

import "fmt"

func main() {
    seen := map[string]struct{}{}
    seen["alpha"] = struct{}{}
    seen["beta"]  = struct{}{}

    if _, ok := seen["alpha"]; ok {
        fmt.Println("alpha is in")
    }

    delete(seen, "beta")
    fmt.Println(len(seen)) // 1
}
```

Compared with `map[string]bool`, the empty-struct version stores no per-entry value bytes — only the keys plus the map's internal bookkeeping.

### 4.4 Signal Channels — `chan struct{}`

When a channel is used purely to coordinate (start, stop, done), the element type carries no information. Use `struct{}`:

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    done := make(chan struct{})

    go func() {
        time.Sleep(10 * time.Millisecond)
        close(done)
    }()

    <-done
    fmt.Println("worker finished")
}
```

Closing the channel wakes every receiver (`close-broadcast` pattern). No data is ever sent — `done <- struct{}{}` is rare; the more common idiom is `close(done)`.

### 4.5 Method-Only Type

A struct exists not to hold data but to attach a method set. Empty structs are perfect when no state is needed:

```go
package main

import "fmt"

type StdoutLogger struct{}

func (StdoutLogger) Info(msg string)  { fmt.Println("INFO:", msg) }
func (StdoutLogger) Error(msg string) { fmt.Println("ERROR:", msg) }

type Logger interface {
    Info(string)
    Error(string)
}

func main() {
    var l Logger = StdoutLogger{}
    l.Info("starting")
}
```

`StdoutLogger{}` carries no per-instance state; the methods all act through `fmt`.

### 4.6 Address Identity Is Implementation-Defined

Two distinct empty struct values may share the same address. The Go specification permits this because the values have zero size:

```go
package main

import "fmt"

func main() {
    a := &struct{}{}
    b := &struct{}{}
    fmt.Println(a == b) // implementation-defined; often true
}
```

The runtime uses an internal symbol named `zerobase` for these allocations. Do not write code that depends on `&struct{}{}` producing distinct pointers.

---

## 5. Real-World Analogies

**A checkbox**: an empty struct in a map says "yes, this key is present" without storing extra data, the same way a checked box says "yes" without filling in any text.

**A doorbell button**: a signal channel of empty structs is a doorbell. Pressing the button (closing the channel) tells everyone listening that something happened. The button itself has no message; only the press matters.

**A namespace tag**: a method-only struct is like a folder name with no files — it groups related operations under one identifier without storing anything itself.

---

## 6. Mental Models

```
map[string]struct{}              chan struct{}                 type X struct{}
┌──────────┐ ┌──┐                ┌──────────────┐               type with method set;
│ "alpha"  │→│∅│                 │ close → wake │               no fields, no state
├──────────┤ ├──┤                │ all readers  │
│ "beta"   │→│∅│                 └──────────────┘
└──────────┘ └──┘
```

The empty struct is the placeholder symbol "the value exists; nothing else to say".

---

## 7. Pros & Cons

### Pros
- Zero memory per value
- Clear intent for set membership
- Clear intent for signal-only channels
- No allocation overhead for the value itself
- Supports interface satisfaction without state

### Cons
- Pointer comparisons are not portable
- Slightly more typing than `map[K]bool`
- New Go developers find the syntax surprising (`struct{}{}` looks odd)
- Trailing zero-size fields can subtly change struct layout

---

## 8. Use Cases

1. Sets backed by `map[K]struct{}`
2. Signal channels (`done`, `quit`, `cancel`)
3. Method-only types attached to interfaces
4. Marker types for type-safe tags
5. Sentinel values that take no memory
6. Test doubles that satisfy interfaces with no fields
7. Event broadcasters using `close(chan struct{})`
8. Constants that need a method set

---

## 9. Code Examples

### Example 1 — Building a Set

```go
package main

import "fmt"

type StringSet map[string]struct{}

func (s StringSet) Add(v string)   { s[v] = struct{}{} }
func (s StringSet) Has(v string) bool {
    _, ok := s[v]
    return ok
}
func (s StringSet) Remove(v string) { delete(s, v) }

func main() {
    s := StringSet{}
    s.Add("go")
    s.Add("rust")
    fmt.Println(s.Has("go"), s.Has("c++")) // true false
    s.Remove("go")
    fmt.Println(s.Has("go")) // false
}
```

### Example 2 — A Done Channel

```go
package main

import (
    "fmt"
    "time"
)

func runWorker(done chan struct{}) {
    time.Sleep(20 * time.Millisecond)
    close(done)
}

func main() {
    done := make(chan struct{})
    go runWorker(done)
    <-done
    fmt.Println("worker exited")
}
```

### Example 3 — Broadcasting Cancellation

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

    for i := 0; i < 3; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            select {
            case <-cancel:
                fmt.Println(id, "cancelled")
            case <-time.After(time.Second):
                fmt.Println(id, "completed")
            }
        }(i)
    }

    time.Sleep(50 * time.Millisecond)
    close(cancel) // wakes every receiver at once
    wg.Wait()
}
```

### Example 4 — Method-Only Type

```go
package main

import "fmt"

type NopWriter struct{}

func (NopWriter) Write(p []byte) (int, error) { return len(p), nil }

func main() {
    var w NopWriter
    n, err := w.Write([]byte("hello"))
    fmt.Println(n, err) // 5 <nil>
}
```

### Example 5 — Comparing the Two Set Idioms

```go
package main

import (
    "fmt"
    "unsafe"
)

func main() {
    boolSet := map[string]bool{"a": true, "b": true}
    structSet := map[string]struct{}{"a": {}, "b": {}}

    fmt.Println(unsafe.Sizeof(true))         // 1 byte per bool entry
    fmt.Println(unsafe.Sizeof(struct{}{}))   // 0 bytes per struct entry
    fmt.Println(len(boolSet), len(structSet))
}
```

### Example 6 — Iterating a Set

```go
package main

import "fmt"

func main() {
    set := map[string]struct{}{
        "red":  {},
        "blue": {},
    }
    for k := range set { // ignore the value; it is always struct{}{}
        fmt.Println(k)
    }
}
```

---

## 10. Coding Patterns

### Pattern 1 — Set Type Wrapper

```go
type Set[T comparable] map[T]struct{}

func (s Set[T]) Add(v T)            { s[v] = struct{}{} }
func (s Set[T]) Has(v T) bool       { _, ok := s[v]; return ok }
func (s Set[T]) Delete(v T)         { delete(s, v) }
func (s Set[T]) Len() int           { return len(s) }
```

### Pattern 2 — Done Channel

```go
done := make(chan struct{})
go func() {
    defer close(done)
    work()
}()
<-done
```

### Pattern 3 — Cancel Broadcast

```go
cancel := make(chan struct{})
for _, w := range workers {
    go w.run(cancel)
}
close(cancel) // every worker sees a closed channel
```

### Pattern 4 — Marker Type

```go
type sentinel struct{}

var stop = sentinel{} // a typed marker
```

### Pattern 5 — Method-Only Implementation of an Interface

```go
type DiscardLogger struct{}
func (DiscardLogger) Info(string) {}
func (DiscardLogger) Error(string) {}
```

---

## 11. Clean Code Guidelines

1. Use `map[K]struct{}` for sets — it states intent.
2. Use `chan struct{}` when no payload is needed.
3. Prefer `close(ch)` over sending values for one-shot signals.
4. Hide the empty struct value behind a typed wrapper (`Set.Add`, `Done()`).
5. Avoid relying on pointer identity of empty struct values.

```go
// Good — the type tells the reader this is a set
seen := map[string]struct{}{}

// Acceptable — but uses one extra byte per value
seen := map[string]bool{}
```

---

## 12. Product Use / Feature Example

A small **rate limit allowlist**:

```go
package main

import "fmt"

type AllowList struct {
    ids map[string]struct{}
}

func New(ids ...string) *AllowList {
    a := &AllowList{ids: make(map[string]struct{}, len(ids))}
    for _, id := range ids {
        a.ids[id] = struct{}{}
    }
    return a
}

func (a *AllowList) Allowed(id string) bool {
    _, ok := a.ids[id]
    return ok
}

func main() {
    a := New("u1", "u2", "u3")
    fmt.Println(a.Allowed("u2")) // true
    fmt.Println(a.Allowed("u9")) // false
}
```

The set holds 3 keys and 0 bytes of value payload.

---

## 13. Error Handling

Empty struct itself never errors. Operations on maps and channels follow normal rules:

```go
set := map[string]struct{}{}
if _, ok := set["missing"]; !ok {
    // "ok" idiom signals absence
}

done := make(chan struct{})
close(done)
close(done) // panics: close of closed channel
```

---

## 14. Security Considerations

1. **Set membership leaks** — knowing a key is in a `map[K]struct{}` is the same disclosure as knowing it is in a `map[K]bool`. The choice of value type is a memory optimization, not a security one.
2. **Signal channels do not authenticate** — anyone with the channel can broadcast `close`. Limit channel scope to trusted code.
3. **Method-only types still expose method behavior** — review `Read`, `Write`, etc. for side effects.

---

## 15. Performance Tips

1. **Smaller maps, faster scans** — `map[K]struct{}` skips per-entry value bytes.
2. **Closing a `chan struct{}` is O(receivers)** — every blocked receiver wakes once.
3. **Do not allocate `struct{}{}` repeatedly** — it is free, but writing `struct{}{}` over and over hurts readability; consider a constant.
4. **Avoid pointer arithmetic on empty struct addresses** — even when it appears to work.

---

## 16. Metrics & Analytics

```go
package main

import "fmt"

func main() {
    visitors := map[string]struct{}{}
    events := []string{"u1", "u2", "u1", "u3", "u2"}
    for _, e := range events {
        visitors[e] = struct{}{}
    }
    fmt.Println("unique visitors:", len(visitors)) // 3
}
```

A cheap deduplicator: zero bytes per recorded id beyond the key itself.

---

## 17. Best Practices

1. Use `map[K]struct{}` for sets.
2. Use `chan struct{}` for signals.
3. Prefer `close` over sending for broadcast.
4. Wrap sets behind a typed API (Add/Has/Delete).
5. Document method-only structs with a comment explaining no state is held.
6. Do not depend on empty-struct pointer identity.
7. Prefer named types for sets in public APIs.

---

## 18. Edge Cases & Pitfalls

### Pitfall 1 — Pointer Comparison

```go
a := &struct{}{}
b := &struct{}{}
// a == b may be true or false; do not rely on either outcome.
```

### Pitfall 2 — Closing a Closed Channel

```go
done := make(chan struct{})
close(done)
close(done) // panic
```

Use `sync.Once` or a guarded boolean to close exactly once.

### Pitfall 3 — Sending on a Closed Signal Channel

```go
done := make(chan struct{})
close(done)
done <- struct{}{} // panic: send on closed channel
```

For broadcast, use `close`. Never send afterward.

### Pitfall 4 — Wrong Value Syntax

```go
m := map[string]struct{}{}
m["a"] = struct{}      // compile error: missing {} — this is the type
m["a"] = struct{}{}    // correct: this is the value
```

### Pitfall 5 — Trailing Empty-Struct Field Surprise

```go
type T struct {
    A int
    B struct{}
}
// unsafe.Sizeof(T{}) may be 16, not 8, in current Go versions
// because a trailing zero-size field gets a distinct address.
```

If the struct is at the very end, the compiler may add padding so taking `&t.B` returns a unique address.

---

## 19. Common Mistakes

| Mistake | Fix |
|---------|-----|
| Using `map[K]bool` when only presence matters | Switch to `map[K]struct{}` |
| Sending on a `chan struct{}` after close | Use `close` only |
| Comparing `&struct{}{}` pointers for identity | Use a regular pointer to a non-empty type |
| Forgetting `{}` value syntax | Write `struct{}{}` for a value, `struct{}` for the type |
| Putting `struct{}{}` field at the end of a struct | Place it earlier or accept the extra byte |

---

## 20. Common Misconceptions

**Misconception 1**: "An empty struct takes 1 byte."
**Truth**: `unsafe.Sizeof(struct{}{}) == 0`. Trailing zero-size fields may change the enclosing struct's size, but the value itself is zero bytes.

**Misconception 2**: "Sending on a `chan struct{}` is the way to signal."
**Truth**: `close(ch)` wakes every receiver simultaneously. Sending wakes only one.

**Misconception 3**: "`map[string]struct{}` is slower than `map[string]bool`."
**Truth**: It is at worst equal, often slightly faster because each entry stores no value bytes.

**Misconception 4**: "Different `&struct{}{}` always have different addresses."
**Truth**: The Go spec allows the runtime to collapse them onto a single address (`zerobase`).

**Misconception 5**: "Empty struct types cannot have methods."
**Truth**: They can. They are useful precisely because the method set is everything.

---

## 21. Tricky Points

1. The type is `struct{}`; the value is `struct{}{}`.
2. Pointer identity of zero-size values is implementation-defined.
3. A trailing zero-size field forces the enclosing struct to gain a byte.
4. A signal channel is best closed, not sent on.
5. `for k := range set` iterates only keys; the value is always `struct{}{}`.

---

## 22. Test

```go
package main

import (
    "testing"
    "unsafe"
)

func TestSize(t *testing.T) {
    if unsafe.Sizeof(struct{}{}) != 0 {
        t.Errorf("expected 0, got %d", unsafe.Sizeof(struct{}{}))
    }
}

func TestSet(t *testing.T) {
    s := map[string]struct{}{}
    s["a"] = struct{}{}
    if _, ok := s["a"]; !ok {
        t.Error("a should be in set")
    }
    if _, ok := s["b"]; ok {
        t.Error("b should not be in set")
    }
}

func TestDoneChannel(t *testing.T) {
    done := make(chan struct{})
    go close(done)
    <-done // should not block
}
```

---

## 23. Tricky Questions

**Q1**: What is the size of `[1000]struct{}`?
**A**: `0`. An array of zero-size elements has zero total size.

**Q2**: Why does this compile?
```go
var x struct{} = struct{}{}
```
**A**: The right-hand side is the value of type `struct{}`. The variable holds it; both are zero bytes.

**Q3**: What does this print?
```go
a := &struct{}{}
b := &struct{}{}
fmt.Println(a == b)
```
**A**: Implementation-defined. In current Go runtimes both pointers usually equal `runtime.zerobase`, so the answer is often `true`. Do not rely on it.

---

## 24. Cheat Sheet

```go
// type vs value
type S = struct{}
var v struct{} = struct{}{} // type then value

// set
seen := map[string]struct{}{}
seen[k] = struct{}{}
_, ok := seen[k]

// signal channel
done := make(chan struct{})
go func() { defer close(done); work() }()
<-done

// broadcast cancel
cancel := make(chan struct{})
close(cancel) // wakes every reader

// method-only
type Discard struct{}
func (Discard) Write(p []byte) (int, error) { return len(p), nil }

// size
unsafe.Sizeof(struct{}{}) // 0
```

---

## 25. Self-Assessment Checklist

- [ ] I can declare and use the empty struct type
- [ ] I know `unsafe.Sizeof(struct{}{}) == 0`
- [ ] I know how to build a set with `map[K]struct{}`
- [ ] I know how to broadcast with `close(chan struct{})`
- [ ] I know how to attach methods to an empty struct
- [ ] I avoid relying on empty-struct pointer identity
- [ ] I understand the trailing-zero-size-field caveat
- [ ] I prefer `close` over send on signal channels
- [ ] I wrap sets behind typed APIs

---

## 26. Summary

The empty struct `struct{}` has zero fields and zero bytes. Its single value, `struct{}{}`, is a placeholder used to give shape to maps, channels, and types where no payload is needed. Three idioms drive almost all use: `map[K]struct{}` for sets, `chan struct{}` for signals (closed for broadcast), and `type X struct{}` for method-only types. Address identity of zero-size values is implementation-defined, and trailing zero-size fields can change a struct's size — keep both quirks in mind when reading low-level code.

---

## 27. What You Can Build

- Generic set type with Add/Has/Delete
- Done/cancel/quit channels
- Method-only loggers, no-op writers, sentinel values
- Marker types for type-safe tags
- Deduplicators for events and identifiers
- One-shot broadcast notifications across goroutines

---

## 28. Further Reading

- [Go Spec — Struct types](https://go.dev/ref/spec#Struct_types)
- [Go Spec — Size and alignment guarantees](https://go.dev/ref/spec#Size_and_alignment_guarantees)
- [Effective Go — Concurrency](https://go.dev/doc/effective_go#concurrency)
- [Dave Cheney — The empty struct](https://dave.cheney.net/2014/03/25/the-empty-struct)

---

## 29. Related Topics

- 2.3.4 Maps
- 2.3.5 Structs
- Chapter 7 Channels
- 2.7 Pointers (zerobase, address identity)
- 2.7.4 Memory Management

---

## 30. Diagrams & Visual Aids

### Set with empty struct values

```
map[string]struct{}
key      → value
"alpha"  → ∅   (zero bytes)
"beta"   → ∅
"gamma"  → ∅
```

### Broadcast via close

```
       close(cancel)
            │
   ┌────────┼────────┐
   ▼        ▼        ▼
 worker   worker   worker
 wake     wake     wake
```

### Trailing zero-size field padding

```
type T struct {
    A int       ; 8 bytes
    B struct{}  ; 0 bytes — but at the END
}                ; sizeof(T) may be 16, not 8
```
