# Go Call by Value — Senior Level

## 1. Overview

Senior-level mastery of call-by-value means understanding the precise cost model for argument passing across all type categories, the register ABI's struct decomposition, the escape implications of pointer parameters, the production patterns that arise from misuse (defensive copies, slice aliasing, interface boxing), and how to design APIs that are both safe and efficient.

---

## 2. Advanced Semantics

### 2.1 The Register ABI's Argument Decomposition

Since Go 1.17 (amd64) and 1.18 (arm64), small values pass through registers:

```
Args go into:    AX, BX, CX, DI, SI, R8, R9, R10, R11   (up to 9 int/ptr)
                 X0..X14                                  (up to 15 float)
```

Structs are decomposed field-by-field:
- `struct{X, Y int}` (16 B) → AX, BX
- `struct{X int; Y string}` (24 B: 8+16) → AX, BX, CX (string takes 2 words)

If a struct exceeds the register budget, it spills to the stack (caller's outgoing frame). The threshold depends on field count and types; typically structs > ~64 B spill.

### 2.2 Cost Per Type Category

| Type | Cost | Notes |
|------|------|-------|
| `int`, `bool`, `float64`, etc. | 1 register | ~free |
| `string` | 2 registers (ptr + len) | ~free |
| Pointer | 1 register | ~free |
| `error` interface | 2 registers | ~free |
| `[]T` slice | 3 registers | ~free |
| `map[K]V` | 1 register | ~free |
| `chan T` | 1 register | ~free |
| `func(...) ...` | 1 register (funcval ptr) | ~free; closure context loaded inside |
| Small struct (≤ ~64 B) | N registers | small cost |
| Medium struct (64-512 B) | stack copy | measurable |
| Large struct (> 512 B) | stack copy | significant |
| Large array (`[N]T`) | stack copy | significant |

### 2.3 Slice Header Layout

```go
type slice struct {
    array unsafe.Pointer
    len   int
    cap   int
}
```

24 bytes on 64-bit. Passing a slice copies these 24 bytes — typically into 3 registers.

### 2.4 Map Handle Layout

```go
type hmap struct {
    count     int
    flags     uint8
    B         uint8
    noverflow uint16
    hash0     uint32
    buckets   unsafe.Pointer
    oldbuckets unsafe.Pointer
    nevacuate uintptr
    extra     *mapextra
}
```

But you don't pass `hmap`; you pass `*hmap` (a single pointer). The map "value" is essentially a pointer to the hmap struct.

### 2.5 Channel Handle Layout

```go
type hchan struct {
    qcount   uint
    dataqsiz uint
    buf      unsafe.Pointer
    elemsize uint16
    closed   uint32
    elemtype *_type
    sendx    uint
    recvx    uint
    recvq    waitq
    sendq    waitq
    lock     mutex
}
```

Again, you pass a `*hchan` (1 word). Channel operations go through this pointer.

### 2.6 Interface Value Layout

```go
type iface struct {
    tab  *itab           // type info + method table
    data unsafe.Pointer  // pointer to (or sometimes value of) the concrete object
}
```

For a value receiver method on a small type, `data` may hold the value directly (no allocation). For larger types or pointer-receivers, `data` is a pointer to heap-allocated state.

### 2.7 Boxing on Interface Assignment

When you assign a concrete value to an interface, the concrete value is "boxed":

```go
var i any = 42 // boxes int 42 into interface
```

For small ints (0-255), Go uses a static pool — no allocation. For other ints/strings/bools, an allocation may occur. For pointers, the boxing is essentially free (data slot holds the pointer).

---

## 3. Production Patterns

### 3.1 Pointer for Mutation, Value for Reading

```go
// Read-only: value
func formatUser(u User) string { return u.Name + "/" + strconv.Itoa(u.Age) }

// Mutate: pointer
func ageUser(u *User) { u.Age++ }
```

Symmetric design helps callers reason about side effects.

### 3.2 Defensive Copy at API Boundaries

```go
type Buffer struct {
    data []byte
}

// New takes ownership of the bytes by copying.
func New(initial []byte) *Buffer {
    return &Buffer{data: append([]byte(nil), initial...)}
}
```

Without the copy, callers could mutate `initial` later, corrupting the buffer.

### 3.3 Pointer Receivers for Mutation, Value for Read

For consistency, if any method on a type uses a pointer receiver, ALL methods should:

```go
type Counter struct{ n int }
func (c *Counter) Inc() { c.n++ } // mutates
func (c *Counter) Get() int { return c.n } // reads via pointer too
```

Mixing value and pointer receivers leads to subtle interface-satisfaction bugs.

### 3.4 Avoid Passing Huge Structs

```go
type State struct {
    Buffer [1 << 16]byte // 64 KB
}

// BAD
func process(s State) { /* 64 KB copy each call */ }

// GOOD
func process(s *State) { /* 8 B pointer */ }
```

Especially in hot loops. Use `-gcflags="-m"` to spot escape implications.

### 3.5 Returning Values vs Pointers

For small types, return values:
```go
func newPoint(x, y int) Point { return Point{X: x, Y: y} } // value, register-passed
```

For large types, return pointers:
```go
func newState() *State { return &State{} } // single allocation, pointer returned
```

---

## 4. Concurrency Considerations

### 4.1 Goroutines Capturing Caller's Variables

When a goroutine captures a caller variable via closure, the variable becomes shared. Concurrent access requires synchronization:

```go
counter := 0
go func() { counter++ }() // race
```

Pass-by-value via argument avoids this:
```go
go func(c int) { _ = c }(counter) // passes a snapshot; no race on counter
```

### 4.2 Slice/Map Sharing Across Goroutines

A slice/map passed to a goroutine is the SAME slice/map (header copied; backing data shared). Concurrent mutation needs synchronization:

```go
m := map[string]int{}
go func() { m["a"] = 1 }() // race
go func() { m["b"] = 2 }() // race
```

Use `sync.Map`, mutex, or channel-based coordination.

### 4.3 Defensive Copy for Goroutine Boundaries

```go
go process(append([]int(nil), data...)) // independent copy; goroutine can mutate freely
```

Or document the contract: "the caller must not mutate `data` while the goroutine runs".

---

## 5. Memory and GC Interactions

### 5.1 Pointer Parameters Don't Force Heap Allocation

A function taking `*T` doesn't make T heap-allocated. The CALLER might keep T on the stack:

```go
func use(p *T) { /* ... */ }

t := T{}
use(&t) // t stays on caller's stack; pointer to stack passed
```

Only if the callee retains the pointer beyond its lifetime would `t` need to escape.

### 5.2 Returning Pointer Forces Escape

```go
func make() *T {
    return &T{} // T escapes to heap
}
```

Each call allocates `T` on the heap.

### 5.3 Large Value Returns

For large struct returns, the caller often pre-allocates space in its frame. The callee writes into that space. No heap allocation, but a stack copy.

For very large returns, consider taking a pointer parameter and writing through it:
```go
func fill(out *State) { /* fill *out */ }
var s State
fill(&s)
```

### 5.4 Slice Backing Array Lifetime

A slice keeps its entire backing array alive as long as the slice header is reachable. If a function returns a slice that's a sub-slice of a larger one, the whole large array stays alive:

```go
func first(s []int) []int {
    return s[:1] // returned slice keeps s's entire backing alive
}
```

To shrink:
```go
func first(s []int) []int {
    out := make([]int, 1)
    out[0] = s[0]
    return out
}
```

---

## 6. Production Incidents

### 6.1 Caller Mutated Stored Slice

A team's cache stored caller-provided slices without copying. Callers mutated the slices later, corrupting the cache. Random failures in production.

Fix: defensive copy at `Set`:
```go
func (c *Cache) Set(items []int) {
    c.items = append([]int(nil), items...)
}
```

### 6.2 Method Mixing Causes Interface Failure

```go
type T struct{}
func (t T) A()   {}
func (t *T) B()  {}

type I interface { A(); B() }

var x I = T{}     // ERROR: T does not implement I (missing method B with pointer receiver)
var x I = &T{}    // OK: *T has both A and B
```

Mixing value and pointer receivers means the value-T type doesn't satisfy interfaces requiring pointer-receiver methods.

### 6.3 Huge Struct in Hot Path

A method took a `Config` struct (~10 KB) by value. Called 1M times/sec. CPU profile showed massive `runtime.memmove` time.

Fix: change to `*Config`. CPU dropped 30%.

### 6.4 Race on Returned Slice

A function returned a slice that was a view into shared state. Callers mutated it concurrently → race + corruption.

Fix: return a defensive copy.

---

## 7. Best Practices

1. **Use pointers for mutation; values for reading**.
2. **For large structs, prefer pointer parameters**.
3. **For small types, value parameters are clearer and free**.
4. **Document mutation contracts** in function comments.
5. **Defensive copy at API boundaries** when storing caller data.
6. **Be consistent with receiver type** for a given type.
7. **Avoid returning slices that view internal state** unless documented.
8. **Profile before optimizing** — Go's register ABI handles small types well.
9. **Use `-gcflags="-m"` to verify escape behavior**.
10. **Test with `-race` to catch concurrent mutation**.

---

## 8. Reading the Compiler Output

```bash
# Argument register usage:
go build -gcflags="-S" 2>asm.txt

# Escape analysis:
go build -gcflags="-m=2"

# Inlining:
go build -gcflags="-m -m"
```

Look for:
- "moved to heap: <var>" — escape from arg or local.
- "func parameter <name> escapes" — caller's var escapes through callee.
- Direct register loads (AX, BX, ...) for arguments.

---

## 9. Self-Assessment Checklist

- [ ] I understand the cost model per type category
- [ ] I know when struct decomposition kicks in
- [ ] I use pointers vs values intentionally
- [ ] I avoid huge struct copies in hot paths
- [ ] I document mutation contracts
- [ ] I defensively copy at API boundaries
- [ ] I read `-gcflags="-m"` output
- [ ] I keep receiver type consistent
- [ ] I test with `-race`

---

## 10. Summary

At senior level, Go's pass-by-value is a deliberate design with predictable cost: small types via registers (~free), reference types via small headers (~free), large structs via stack copy (measurable). Use pointers when mutation or large-struct copy makes sense; otherwise prefer values for clarity and immutability. Document contracts; defensively copy at API boundaries. Verify escape behavior with compiler flags.

---

## 11. Further Reading

- [Go Internal ABI](https://github.com/golang/go/blob/master/src/cmd/compile/abi-internal.md)
- [Dave Cheney — There is no "pass-by-reference" in Go](https://dave.cheney.net/2017/04/29/there-is-no-pass-by-reference-in-go)
- [Go Blog — Slice internals](https://go.dev/blog/slices-intro)
- [Effective Go — Pointers vs values](https://go.dev/doc/effective_go#pointers_vs_values)
- 2.7 Pointers (deep dive)
- 2.7.3 With Maps & Slices
- Chapter 3 Methods
