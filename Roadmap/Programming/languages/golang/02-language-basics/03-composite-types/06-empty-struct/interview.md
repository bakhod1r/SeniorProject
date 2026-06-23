# Go Empty Struct — Interview Questions

## Table of Contents
1. [Junior Level Questions](#junior-level-questions)
2. [Middle Level Questions](#middle-level-questions)
3. [Senior Level Questions](#senior-level-questions)
4. [Scenario-Based Questions](#scenario-based-questions)
5. [FAQ](#faq)

---

## Junior Level Questions

**Q1: What's the size of `struct{}` in Go and why?**

**Answer**: Zero bytes. `unsafe.Sizeof(struct{}{}) == 0`. The type has no fields, so there is nothing to store. The Go specification says: "A struct or array type has size zero if it contains no fields (or elements, respectively) that have a size greater than zero." Since `struct{}` has no fields at all, size is zero.

```go
import "unsafe"
fmt.Println(unsafe.Sizeof(struct{}{})) // 0
```

This holds regardless of how many empty-struct values you put together: `[1024]struct{}` also has size zero.

---

**Q2: Why use `map[string]struct{}` instead of `map[string]bool`?**

**Answer**: When the map is used as a SET (only membership matters, the value carries no information), the empty struct version saves the value-byte per entry. `map[string]bool` stores one byte (plus alignment padding) per value; `map[string]struct{}` stores zero. For large maps the saving is meaningful.

The type also signals intent: `map[K]struct{}` says "this is a set", whereas `map[K]bool` reads as "an attribute table".

```go
seen := map[string]struct{}{}
seen[id] = struct{}{}
if _, ok := seen[id]; ok {
    // id is present
}
```

If the map ever stores `false` to mean "explicitly excluded", keep the bool — there's a meaningful second value.

---

**Q3: How do you broadcast a cancellation signal to many goroutines using `chan struct{}`?**

**Answer**: Create an unbuffered `chan struct{}`, share it with all consumers, and `close` it once. Every blocked receiver wakes simultaneously.

```go
cancel := make(chan struct{})

for i := 0; i < N; i++ {
    go func() {
        select {
        case <-cancel:
            // exit on signal
            return
        case <-work:
            // do work
        }
    }()
}

// Later:
close(cancel) // wakes every consumer
```

A close on a channel makes every subsequent receive return the zero value immediately. This is the canonical broadcast primitive in Go. Sending one value would only wake one goroutine.

Always guard `close` with `sync.Once` if multiple paths can trigger it, to avoid panicking on double-close.

---

**Q4: What does `unsafe.Sizeof(struct{}{})` return?**

**Answer**: `0`. The empty struct is a zero-size type. This is consistent across all Go versions and platforms.

```go
fmt.Println(unsafe.Sizeof(struct{}{}))            // 0
fmt.Println(unsafe.Sizeof([100]struct{}{}))       // 0
fmt.Println(unsafe.Sizeof(map[int]struct{}(nil))) // 8 (the map header pointer)
```

The map header itself has size (it's a pointer to the runtime's `hmap`), but the value type does not contribute to per-entry size.

---

**Q5: Why might two pointers to distinct `struct{}{}` values compare equal?**

**Answer**: The Go specification permits the runtime to give two distinct zero-size variables the same address. The Go runtime takes advantage of this: every zero-size allocation returns the address of a single global byte called `runtime.zerobase`. Therefore:

```go
a := &struct{}{}
b := &struct{}{}
fmt.Println(a == b) // typically true
```

Both `a` and `b` point to `&runtime.zerobase`. The behaviour is implementation-defined per the spec, but in practice every supported Go runtime exhibits it.

Consequence: never rely on `&struct{}{}` producing distinct pointers. If you need unique tokens, use a non-zero-size type:

```go
type token struct{ _ byte }
a := &token{}
b := &token{}
// a and b are distinct allocations
```

---

**Q6: What's the difference between `struct{}` and `struct{}{}`?**

**Answer**: `struct{}` is a TYPE (a struct with no fields). `struct{}{}` is the unique VALUE of that type — a composite literal where the inner braces are the empty body and the outer braces construct the value.

```go
var t struct{} = struct{}{}
//      type           value
```

Common sources of confusion:
- `m["key"] = struct{}` is a compile error (type is not an expression).
- `m["key"] = struct{}{}` is the correct value assignment.

In a map literal you can use shorthand:
```go
m := map[string]struct{}{"a": {}, "b": {}}
// {} is the empty composite literal of type struct{}
```

---

## Middle Level Questions

**Q7: How does `map[K]struct{}` save memory compared to `map[K]bool` at the bucket level?**

**Answer**: Go's map implementation organises entries into buckets. Each bucket holds 8 keys, 8 values, an 8-byte tophash array, and an overflow pointer. When `V == struct{}`, the values array has zero size. The compiler omits it; the bucket is smaller.

For `map[int]bool`:
- Bucket: 8 (tophash) + 8×8 (keys) + 8×1 (values) + 8 (overflow) = 88 bytes.

For `map[int]struct{}`:
- Bucket: 8 (tophash) + 8×8 (keys) + 0 + 8 (overflow) = 80 bytes.

A 10% saving per bucket. Combined with cache-line effects, larger maps see proportional speedups in iteration and lookup.

---

**Q8: When should you NOT use `map[K]struct{}`?**

**Answer**: When the value carries information. Common cases:

1. **Feature flags**: `map[string]bool` where `false` means "explicitly off" and absence means "default on" (or vice versa).
2. **Two-state predicates**: `map[Key]bool` recording the result of a check.
3. **Caches with negative results**: `map[Key]bool` where `true` means "exists" and `false` means "checked, doesn't exist" — distinguishing from absence ("not yet checked").

In all of these the bool's two values (and the missing-key state) form a tri-state that drives logic.

If only presence matters, switch to `struct{}`. If `false` carries semantics, keep `bool`.

---

**Q9: How do you make a `chan struct{}` close safe to call multiple times?**

**Answer**: Wrap the close in `sync.Once`:

```go
type Cancel struct {
    once sync.Once
    ch   chan struct{}
}

func New() *Cancel             { return &Cancel{ch: make(chan struct{})} }
func (c *Cancel) Done() <-chan struct{} { return c.ch }
func (c *Cancel) Fire()        { c.once.Do(func() { close(c.ch) }) }
```

Now `c.Fire()` can be called any number of times; the channel closes exactly once. The standard library's `context.cancelCtx` uses this exact pattern.

---

**Q10: How does `io.Discard` work, and why is it an empty struct type?**

**Answer**: `io.Discard` is exported as `var Discard io.Writer`. Internally:

```go
type discard struct{}

func (discard) Write(p []byte) (int, error)         { return len(p), nil }
func (discard) WriteString(s string) (int, error)   { return len(s), nil }
func (discard) ReadFrom(r io.Reader) (int64, error) { /* drains r */ }

var Discard io.Writer = discard{}
```

The type `discard` has no fields because it carries no state. Every method ignores its receiver; the value `discard{}` is just a tag for "this implementation". By making the type unexported and exporting only the value, the package controls how it is used — callers can compare `w == io.Discard` (in newer Go versions where this is meaningful) but cannot subtype it.

The empty struct is the right choice because there is genuinely no per-instance state; multiple `discard{}` values are indistinguishable.

---

**Q11: What's the trailing-zero-size-field rule?**

**Answer**: When a struct's last field has zero size, taking the address of that field would produce a pointer one byte past the struct end. The Go compiler adds padding so the address remains inside the struct. Consequently, structs with a trailing zero-size field are larger than the sum of their non-zero fields.

```go
type A struct {
    x int
    z struct{}
}
unsafe.Sizeof(A{}) // 16 on amd64, not 8

type B struct {
    z struct{}
    x int
}
unsafe.Sizeof(B{}) // 8 — leading zero-size field collapses
```

This matters for:
- cgo bindings expecting a specific layout.
- Network protocols with packed structs.
- Performance-critical code where struct size affects cache behaviour.

Fix: place zero-size fields at the start, not the end.

---

**Q12: Why does this code work even though `struct{}` looks weird?**

```go
done := make(chan struct{})
go func() {
    work()
    done <- struct{}{}
}()
<-done
```

**Answer**: The channel's element type is `struct{}`. Sending `struct{}{}` works because that is the (only) value of type `struct{}`. The receive on the main goroutine gets back the same zero value. No data crosses; only the synchronisation happens.

That said, this code is more idiomatically written with `close(done)` instead of a send:

```go
done := make(chan struct{})
go func() {
    defer close(done)
    work()
}()
<-done
```

The close form makes the one-shot intent obvious and removes the awkward `struct{}{}` literal.

---

## Senior Level Questions

**Q13: What is `runtime.zerobase` and how does it interact with the GC?**

**Answer**: `runtime.zerobase` is a global `uintptr` declared in `src/runtime/malloc.go`. The runtime's allocator (`mallocgc`) returns its address for any zero-size allocation:

```go
if size == 0 {
    return unsafe.Pointer(&zerobase)
}
```

Consequences:
- All `new(struct{})` and `&struct{}{}` calls return the same pointer.
- The pointer points into the runtime's `.bss` section, not the heap.
- The GC scanner ignores pointers to non-heap addresses, so empty-struct pointers do not pin anything.
- No heap allocation occurs; no `mcache` slot is consumed.

Practical effect: even creating millions of `&struct{}{}` is free in terms of allocation and GC pressure (modulo any container holding the pointers).

---

**Q14: Walk through what happens when you call `close(c)` on a `chan struct{}`.**

**Answer**:
1. `close` calls the runtime function `closechan` (in `src/runtime/chan.go`).
2. `closechan` acquires the channel's lock.
3. It sets `c.closed = 1`.
4. It walks the recvq (queue of blocked receivers), making each runnable. Each receive returns `(zero value, false)`.
5. It walks the sendq similarly — but sending on a closed channel is illegal, so any waiting senders cause a panic.
6. It releases the lock.

For `chan struct{}` the "zero value" copy is a no-op (size is 0), so the only work per receiver is making the goroutine runnable. Cost: O(N) where N is the number of blocked receivers.

After close, every subsequent receive returns immediately. The channel cannot be reopened.

---

**Q15: Why might a linter flag a leading `_ struct{}` field?**

**Answer**: Some lint tools (e.g. `staticcheck`'s U1000, `structcheck`) report unused fields. A `_ struct{}` leading field is sometimes used as a marker to:
- Disallow unkeyed struct literals (`Foo{1, 2}` becomes a compile error because the field is unnamed).
- Provide an attachment point for `//go:nosplit` or other compiler directives.

Linters that don't understand the idiom warn anyway. Suppression options:
- `//nolint:unused` directive.
- A non-empty unexported field of size zero like `_ [0]int`.
- Configure the linter to ignore zero-size fields.

The trailing zero-size field has the additional cost of padding; the leading one does not.

---

**Q16: How does `context.cancelCtx` use empty-struct idioms?**

**Answer**: `context.cancelCtx` (in `src/context/context.go`) uses two empty-struct patterns:

1. **`done` channel of `chan struct{}`**: when `cancel` is called, the ctx closes `done`, broadcasting to every consumer of `ctx.Done()`. The signal carries no data — only the fact of cancellation.

2. **`children map[canceler]struct{}`**: a set of child contexts that should be cancelled when the parent is cancelled. The map's value is `struct{}{}` because only the key (the child reference) matters.

```go
type cancelCtx struct {
    Context
    mu       sync.Mutex
    done     atomic.Value          // chan struct{}
    children map[canceler]struct{} // set of children
    err      error
}
```

The `cancel` method closes `done` and walks `children`, calling `cancel` on each. The empty-struct idioms make the implementation small and clear.

---

**Q17: Two `*struct{}` values may equal one another. How do you ensure unique identity for tokens?**

**Answer**: Use a type that is not zero size. Even one byte is enough:

```go
type token struct{ _ byte }
a := &token{}
b := &token{}
fmt.Println(a == b) // false — distinct allocations
```

Or use a type with a meaningful field for debugging:

```go
type token struct{ id uint64 }
var nextID atomic.Uint64
new := func() *token { return &token{id: nextID.Add(1)} }
```

Pointer identity is preserved for any non-zero-size type because each `new` allocation reserves a distinct heap address.

---

**Q18: How does the compiler decide whether to allocate an empty-struct receiver on the stack or the heap?**

**Answer**: Empty-struct values themselves do not allocate anywhere — they have no storage. Pointers to them are returned as `&runtime.zerobase`. The compiler doesn't need a heap or stack slot for the value.

If a method receives an empty struct by value (`func (X) M()`), the call has no per-call allocation. The receiver is essentially a no-op pass.

If a method receives a pointer (`func (*X) M()`), the pointer is loaded as `&zerobase` and stored in the receiver register. Still no allocation.

Empty-struct types are essentially free at the calling-convention level.

---

**Q19: A test relies on `&struct{}{}` producing distinct pointers. How do you fix it?**

**Answer**: Replace `*struct{}` with a non-empty type. Refactor:

```go
// Before: token type with no body
type token struct{}

// After:
type token struct{ _ byte }
```

All `&token{}` allocations now produce distinct pointers, and the struct still carries (effectively) no information for the user.

If the test cannot change the type, refactor the test to assert behaviour rather than identity:
```go
// Bad: relies on pointer identity
if t1 != t2 { ... }

// Good: tracks via an ID
type token struct{ id int }
if t1.id != t2.id { ... }
```

---

**Q20: Closure-based DSL vs interface-based design — when do you choose each? (with empty-struct twist)**

**Answer**:
- **Empty-struct interface implementations** make sense when an interface is satisfied by truly stateless behaviour: `io.Discard`, no-op loggers, sentinel iterators. The empty struct is the smallest possible implementation type.
- **Stateful structs** are right when per-instance fields are needed.
- **Closures** are right when the behaviour is small and one-off, with limited captures.

The empty-struct interface implementation reads as "this implementation is truly stateless and singleton-like". The named type makes the intent and the singleton-ness easier to test, document, and replace.

---

## Scenario-Based Questions

**Q21: Your service uses a 10-million-entry `map[string]bool` for an allowlist. Profiling shows it dominates memory. What do you do?**

**Answer**:
1. **Inspect the bool**: is `false` ever stored? If only `true` is set, the map is a set.
2. **Switch to `map[string]struct{}`**: removes the value byte per entry. For 10M entries, ~10 MB direct + bucket savings.
3. **Consider an atomic-pointer pattern** if reads dominate writes — swap the map atomically rather than locking.
4. **For very large allowlists**, consider a Bloom filter as a first-pass filter and the map as a confirmation lookup.

The `struct{}` switch is the easiest win and rarely has downsides.

---

**Q22: Two paths in your code call `close(done)`. The race detector flags it intermittently. Fix?**

**Answer**: Use `sync.Once`:

```go
type Done struct {
    once sync.Once
    ch   chan struct{}
}

func New() *Done             { return &Done{ch: make(chan struct{})} }
func (d *Done) Channel() <-chan struct{} { return d.ch }
func (d *Done) Close()       { d.once.Do(func() { close(d.ch) }) }
```

`sync.Once.Do` is goroutine-safe and runs the function exactly once. Subsequent calls return immediately.

If the two paths really need to know which fired first, expose a "WhoClosed" method that records the caller before closing:
```go
func (d *Done) Close(name string) {
    d.once.Do(func() { d.who = name; close(d.ch) })
}
```

---

**Q23: A new hire reviews your code and asks "why not use `map[string]bool`? It is more readable." Justify the choice.**

**Answer**: Reasons to prefer `map[string]struct{}`:

1. **Intent**: the type signature reads "a set". `map[string]bool` reads as "a string-to-bool table" — less specific.
2. **Memory**: zero value bytes per entry, smaller buckets, marginally better cache behaviour.
3. **Idiom**: the Go standard library and major third-party codebases (Kubernetes, etcd) use it consistently. Following the convention reduces friction for other Go developers.
4. **No silent semantic regression**: `map[string]bool` invites future code to set `false`, conflating presence with attribute. The empty-struct version cannot be misused this way.

Acknowledge the cost: `struct{}{}` is more verbose. Wrapping in a `Set[T]` type erases the verbosity:

```go
type Set[T comparable] map[T]struct{}
```

---

**Q24: You inherit a service that uses buffered `chan struct{}` capacity 1 for cancellation. Refactor.**

**Answer**:
1. **Identify the producer-consumer roles**: who sends, who receives, how many of each?
2. **For one-to-many**: replace with `close(chan struct{})`. The consumer simply selects on the channel; close wakes everyone.
3. **For one-to-one with strict delivery**: an unbuffered `chan struct{}` and a single send is fine, but consider whether `close` would be clearer.
4. **For coalesced notify (multiple producers, single consumer)**: keep the buffered capacity-1 with `select-default`. This is the legitimate use of that pattern.

Add `sync.Once` if the close path can be triggered from multiple goroutines.

---

## FAQ

**Are empty struct values allocated on the heap?**

No. `struct{}{}` is a constant; no allocation occurs. `&struct{}{}` returns the address of `runtime.zerobase` — also no heap allocation.

---

**Can you have a method with an empty-struct receiver?**

Yes. The receiver is effectively a phantom — no data is passed. The method body has access to the type's method set but not to any per-instance state.

```go
type Discard struct{}
func (Discard) Write(p []byte) (int, error) { return len(p), nil }
```

---

**Does `for _ = range chan struct{}` make sense?**

Yes. It iterates over receives until the channel is closed. The value is always `struct{}{}` and uninteresting; the form is a clean way to "wait for close":

```go
for range done {
    // body runs zero times if done is just closed; otherwise once per send.
}
```

In practice, `<-done` is more idiomatic for a one-shot signal.

---

**Can `struct{}` be used as a map key?**

Yes. Every value compares equal, so a `map[struct{}]V` collapses to at most one entry. There are no realistic uses, but the language permits it.

---

**Does `chan struct{}` have less overhead than `chan bool`?**

Marginally. The element copy in send/receive is zero bytes vs one byte. The channel header itself is the same size. For very high-throughput channels, `chan struct{}` saves a small amount per operation; for typical use, the difference is unmeasurable.

---

**Is `[0]byte` equivalent to `struct{}`?**

Both are zero-size types. The runtime treats them similarly. Differences:
- `[0]byte` cannot have methods directly — it is an array type. You can wrap it in a named type and add methods.
- `struct{}` is more idiomatic for the patterns covered above.

In low-level code (e.g., cgo `_Ctype_struct_X`), you sometimes see `[0]byte` as a marker.

---

**Does a struct with only zero-size fields have size zero?**

Yes:
```go
type T struct {
    a struct{}
    b [0]int
    c struct{}
}
unsafe.Sizeof(T{}) // 0
```

The trailing-zero-size-field rule applies only when the struct has at least one non-zero field followed by a zero-size field.

---

**Can `chan struct{}` be `nil`?**

Yes. A `nil` `chan struct{}` blocks forever on send and receive, like any nil channel. This is occasionally used in `select` to disable a case dynamically:

```go
var done chan struct{} // nil
select {
case <-done:    // never fires
case <-other:
}
```

Setting `done = make(chan struct{})` enables the case.

---

**Is `struct{}{}` a constant?**

Yes, in the sense that the compiler folds it to a no-op. It is not a typed constant in the same way `1` or `"x"` is, but it has no runtime cost.

---

**Where do I find `runtime.zerobase` in the source?**

`src/runtime/malloc.go`. Search for `var zerobase uintptr`. The allocator returns its address for every zero-size allocation.
