# Go Pointers Basics — Interview Questions

## Table of Contents
1. [Junior Level Questions](#junior-level-questions)
2. [Middle Level Questions](#middle-level-questions)
3. [Senior Level Questions](#senior-level-questions)
4. [Scenario-Based Questions](#scenario-based-questions)
5. [FAQ](#faq)

---

## Junior Level Questions

**Q1: What is a pointer in Go?**

**Answer**: A pointer is a value that holds the memory address of another value. Type `*T` means "pointer to T". Use `&x` to take the address of `x`, and `*p` to access the value at pointer `p`.

```go
x := 42
p := &x
fmt.Println(*p) // 42
*p = 99
fmt.Println(x)  // 99
```

---

**Q2: What's the zero value of a pointer?**

**Answer**: `nil`. Dereferencing a nil pointer panics.

```go
var p *int
if p == nil { fmt.Println("nil") }
// *p // panic
```

Always nil-check before dereferencing.

---

**Q3: What's the difference between `new(T)` and `&T{}`?**

**Answer**: Both allocate a `T` on the heap and return `*T`. They're equivalent for zero-initialization.

```go
p1 := new(int)        // *int → 0
p2 := &Point{}         // *Point → {0, 0}
p3 := &Point{X: 1}    // *Point → {1, 0}
```

`&T{}` is more flexible (allows specifying field values); `new(T)` is shorter for zero-init.

---

**Q4: Does Go support pointer arithmetic?**

**Answer**: **No**. Unlike C, you cannot do `p++` or `p + 1`. To access elements at offsets, use slices (which provide indexed access).

---

**Q5: What does "auto-dereference" mean for pointers in Go?**

**Answer**: When accessing a struct field or calling a method on a pointer, Go inserts the dereference automatically:

```go
p := &Point{X: 1}
fmt.Println(p.X)   // same as (*p).X
p.Move(10, 0)      // method call; Go auto-dereferences
```

You don't need to write `(*p).X` explicitly.

---

**Q6: Can you take the address of a function?**

**Answer**: Not of a function literal or named function directly. But you can take the address of a variable holding a function value:

```go
// _ = &fmt.Println // ERROR
f := fmt.Println
_ = &f // OK: address of variable f
```

---

## Middle Level Questions

**Q7: When should you use a pointer parameter vs a value parameter?**

**Answer**:
- **Pointer**: when mutation is needed, when the type is large (avoid copy), or for consistency with method receivers.
- **Value**: when read-only, for small types, or to express immutability.

For small types, value pass is faster (registers, no indirection). For large types, pointer pass avoids the memcpy.

---

**Q8: What's the difference between value and pointer receivers?**

**Answer**:
- **Value receiver** (`func (t T) M()`): operates on a COPY of the receiver. Modifications don't persist.
- **Pointer receiver** (`func (t *T) M()`): operates on the original via pointer. Modifications persist.

For a type, choose pointer receivers when:
- Methods mutate the receiver.
- Receiver is large.
- Other methods on the type use pointer receivers (consistency).

---

**Q9: What does it mean that a pointer "escapes to the heap"?**

**Answer**: When the compiler determines a variable's address is taken AND the pointer outlives the function (e.g., returned, stored in global), the variable is allocated on the heap instead of the stack.

```go
func newPtr() *int {
    n := 5
    return &n // n escapes; heap-allocated
}
```

Verify: `go build -gcflags="-m"`. Heap allocation costs ~25 ns + GC tracking.

---

**Q10: Can you call a method on a nil pointer?**

**Answer**: Yes — the call doesn't panic immediately. It panics only if the method dereferences the receiver:

```go
type T struct{ n int }
func (t *T) Show() { fmt.Println(t.n) } // panics if t is nil

var p *T
p.Show() // panic: nil pointer dereference
```

Some methods explicitly handle nil:
```go
func (l *Logger) Log(s string) {
    if l == nil { return } // safe
    // ...
}
```

This pattern is sometimes used for optional behavior.

---

**Q11: What's `unsafe.Pointer`?**

**Answer**: A special type that can be converted to/from any other pointer type and to `uintptr`. Bypasses Go's type safety; reserved for low-level interop with C, runtime, or memory layout tricks.

```go
import "unsafe"

x := int64(42)
p := unsafe.Pointer(&x)
i32 := *(*int32)(p) // reinterpret as int32
```

Most code should never use `unsafe.Pointer`.

---

**Q12: Can you compare pointers?**

**Answer**: Yes, with `==` and `!=`. Equality is address equality:

```go
p1 := new(int)
p2 := new(int)
p3 := p1
fmt.Println(p1 == p2) // false (different addresses)
fmt.Println(p1 == p3) // true (same)
fmt.Println(p1 == nil) // false
```

To compare pointed-to values, dereference: `*p1 == *p2`.

---

## Senior Level Questions

**Q13: How does Go's escape analysis work?**

**Answer**: The compiler builds a graph of pointer flows. If a pointer to a local variable can reach a "global" sink (return value, package-level var, escaping closure, channel as interface{}), the variable is marked as escaping.

The decision is per-allocation. Heap allocation costs ~25 ns; stack is free.

Verify: `go build -gcflags="-m=2"`.

---

**Q14: How does GC handle pointers?**

**Answer**: Go uses a precise, concurrent, tri-color mark-sweep GC.

For pointers:
- Each goroutine stack has stack maps describing which slots are pointers at each safepoint.
- Each heap object has a type descriptor with a pointer map.
- The GC marks reachable objects by following pointers from roots (stacks + globals).

**Write barriers** are inserted by the compiler to track pointer changes during concurrent marking.

---

**Q15: What's the cost of a pointer dereference?**

**Answer**: ~1-2 cycles for the load (from L1 cache). Plus potential cache miss (~10s of cycles for L2, ~100s for memory).

For tight loops, value-based code can outperform pointer-based code by avoiding the load.

---

**Q16: How do you safely share a pointer across goroutines?**

**Answer**: Three options:

1. **Mutex**: protect access with `sync.Mutex` / `sync.RWMutex`.
2. **`atomic.Pointer[T]`** (Go 1.19+): for lock-free swaps.
3. **Channel**: send the pointer through a channel; receiver becomes sole owner.

```go
import "sync/atomic"
var ptr atomic.Pointer[Config]

ptr.Store(&Config{...}) // writer
cfg := ptr.Load()        // reader
```

---

**Q17: What's pointer aliasing and why does it matter for the compiler?**

**Answer**: Aliasing is when two pointers refer to the same memory. The compiler can't always prove that distinct pointers don't alias, which limits optimization (e.g., can't reorder loads/stores safely).

```go
func add(a, b *int) {
    *a = *a + *b // compiler must reload *a if a == b
}
```

For hot paths, prefer values or distinct memory regions to enable optimization.

---

**Q18: How do `sync.Pool` and pointer pooling reduce GC pressure?**

**Answer**: `sync.Pool` is a per-P (per-processor) freelist. Allocations come from the pool first; freed objects are returned to it.

```go
var pool = sync.Pool{
    New: func() any { return new(Buffer) },
}

func use() {
    b := pool.Get().(*Buffer)
    defer func() {
        b.Reset()
        pool.Put(b)
    }()
    // ... use b ...
}
```

Reduces allocation rate; GC has fewer objects to manage.

Caveat: `Pool.Put`'s objects may be reclaimed by GC at any safepoint; don't rely on the pool to hold state.

---

## Scenario-Based Questions

**Q19: A service has high allocation rate, all from `&T{}` constructors. How do you reduce?**

**Answer**:
1. **Profile** with `pprof -alloc_objects` to find hot spots.
2. **Pool** with `sync.Pool` for short-lived large allocations.
3. **Return values** instead of pointers when callers don't store them.
4. **Inline** allocation: don't allocate if you can use a stack value.

---

**Q20: A method is unexpectedly mutating shared state. The receiver is a value. What's wrong?**

**Answer**: A value receiver operates on a COPY. If state IS being mutated, it's likely:
- Through a pointer field within the struct (the field's pointee is shared).
- Through a slice/map field (shared backing).

Example:
```go
type T struct { data []int }
func (t T) Mutate() { t.data[0] = 99 } // mutates shared backing
```

This isn't a bug per se but surprises if you expect value-receiver isolation. Defensive copy if needed.

---

## FAQ

**Why doesn't Go have pointer arithmetic?**

Safety. Pointer arithmetic is a major source of memory-corruption bugs in C. Go provides slices for indexed access, which is bounds-checked and safe.

---

**Should I always use pointers for struct parameters?**

No. For small structs (≤ 64 B), value pass is often faster. For large structs, pointers avoid the copy.

---

**Why is `unsafe.Pointer` discouraged?**

It bypasses Go's type safety and the GC's tracking. Misuse can cause crashes, corruption, or subtle bugs. Reserved for runtime, CGO, and very low-level libraries.

---

**Where can I see the compiler's escape decisions?**

```bash
go build -gcflags="-m=2"
```

Look for "moved to heap" or "does not escape".
