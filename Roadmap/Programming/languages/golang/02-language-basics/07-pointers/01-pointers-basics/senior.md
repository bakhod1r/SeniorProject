# Go Pointers Basics — Senior Level

## 1. Overview

Senior-level mastery of pointers means understanding their precise cost model, escape analysis decisions, the GC's treatment of pointer roots, the production patterns and pitfalls (nil panics, aliasing races, leaks), and the trade-offs between pointer-heavy and value-heavy designs.

---

## 2. Advanced Semantics

### 2.1 Escape Analysis Decisions

Each `&x` expression triggers escape analysis. Common reasons for escape:

- Returned from function.
- Stored in package global.
- Sent on a channel as `interface{}` (boxing).
- Captured by an escaping closure.
- Passed to a function whose signature accepts a pointer that the function retains.

Verify: `go build -gcflags="-m=2"`.

### 2.2 Pointer Aliasing and the Compiler

The Go compiler is conservative about pointer aliasing — it can't always prove two pointers point to different locations, which limits optimizations. For example:

```go
func add(a, b *int) {
    *a = *a + *b  // compiler can't assume a != b
}
```

If a and b might alias, the compiler can't optimize aggressively. Avoid pointer aliasing in hot paths.

### 2.3 Cost of Pointer Indirection

Each `*p` access:
- ~1-2 cycles for the load.
- Plus a potential cache miss (if pointee not in cache).
- vs direct register access (~0).

For very hot loops, value-based code outperforms pointer-based code.

### 2.4 GC and Pointers

Pointers are GC roots. The GC scans:
- All goroutine stacks.
- Package-level variables.
- For each, follows pointer fields recursively.

More pointers → more GC work per cycle. For high-throughput services, reducing pointer density (preferring values, arrays of structs vs structs of pointers) reduces GC pressure.

### 2.5 nil Pointer Performance

A nil check + branch is ~1 cycle on modern CPUs (branch prediction often correctly predicts non-nil). Negligible cost.

But: dereferencing nil panics; the runtime walks the stack to print the trace. Slow path.

---

## 3. Production Patterns

### 3.1 Constructor Returning Pointer (Standard)

```go
func NewUser(name string) *User {
    return &User{Name: name}
}
```

Allocates on heap; returns single pointer. Idiomatic for any type that has methods or is mutated.

### 3.2 Sentinel Pointer for "Empty"

```go
var emptyConfig = &Config{} // shared singleton for default state

func defaultConfig() *Config { return emptyConfig }
```

Reuses one allocation. Safe if Config is read-only.

### 3.3 Pointer Pool for Reuse

```go
var pool = sync.Pool{
    New: func() any { return new(Buffer) },
}

func getBuffer() *Buffer {
    return pool.Get().(*Buffer)
}

func putBuffer(b *Buffer) {
    b.Reset()
    pool.Put(b)
}
```

Reduces GC pressure for short-lived large allocations.

### 3.4 Optional Field via Pointer

```go
type Settings struct {
    Threshold *int // nil = no threshold
}
```

Use sparingly; for primitives, pointers add complexity. Consider `Threshold int` with sentinel value (e.g., -1 = unset) as alternative.

### 3.5 Avoiding the Nil-Receiver Trap

```go
type Logger struct{ /* ... */ }

func (l *Logger) Log(msg string) {
    if l == nil { return } // safe even if l is nil
    // ... log ...
}
```

Methods on `*T` can handle nil receivers if you explicitly check. Useful for "no-op" patterns.

---

## 4. Concurrency Considerations

### 4.1 Atomic Pointer Operations

```go
import "sync/atomic"

type Cache struct {
    data atomic.Pointer[Map] // Go 1.19+
}

func (c *Cache) Update(m *Map) {
    c.data.Store(m)
}
```

`atomic.Pointer[T]` enables lock-free pointer swaps.

### 4.2 Pointer Sharing Across Goroutines

```go
shared := &State{}
go func() { shared.X = 1 }()  // race
go func() { shared.X = 2 }()  // race
```

Synchronize with mutex or atomic.

### 4.3 Read-Mostly Snapshot Pattern

```go
var configPtr atomic.Pointer[Config]

// Reader
cfg := configPtr.Load()
// use cfg

// Writer
newCfg := buildConfig()
configPtr.Store(newCfg)
```

Readers see consistent snapshots without locking. Writes atomically swap.

---

## 5. Memory and GC Interactions

### 5.1 Escape Costs

Heap allocation: ~25 ns + GC tracking. Stack allocation: ~free.

For high allocation rates, escape decisions matter. `-gcflags="-m"` shows them.

### 5.2 Pointer Density

A struct with many pointer fields adds many GC roots. Consider:
- Replace `[]*T` with `[]T` if you don't need shared references.
- Embed values instead of pointers when possible.

### 5.3 Sub-Object Lifetime

A pointer to a struct field keeps the entire struct alive:
```go
big := &Big{Field: someValue}
sub := &big.Field
big = nil
// sub keeps Big alive (because Field is part of Big's allocation)
```

For most code this is invisible; for memory-constrained services, be aware.

---

## 6. Production Incidents

### 6.1 Nil Pointer Panic in Production

A request handler called a method on a possibly-nil receiver. In rare cases (under load), the panic crashed the goroutine. Recovery middleware caught it but logged an unhelpful trace.

Fix: explicit nil check at the method entry; return early or with an error.

### 6.2 Aliasing-Driven Race

Two services shared a `*Config` pointer. One read, one updated. Without atomics, readers saw torn values. CPU profile showed `*Config`'s fields randomly.

Fix: `atomic.Pointer[Config]` for swap, immutable Config struct.

### 6.3 Massive Pointer Density Causing GC Pauses

A service stored `[]*Event` with 10M events. Each event was a pointer with ~10 pointer fields. GC scanned 100M roots per cycle; pause times exceeded SLO.

Fix: convert to `[]Event` (struct value slice). GC scanning dropped 10×; pauses met SLO.

### 6.4 Pointer to Loop Variable in Pre-1.22

```go
var ptrs []*int
for _, x := range items {
    ptrs = append(ptrs, &x) // all same pointer pre-1.22
}
```

After Go 1.22, the same code creates distinct pointers per iteration.

Fix: `i := i` shadow OR upgrade to Go 1.22.

---

## 7. Best Practices

1. **Use pointers for mutation, large structs, optional values, linked structures**.
2. **Always nil-check at boundaries** for pointers from external sources.
3. **Use pointer receivers consistently** per type.
4. **Profile to verify pointer choices** — don't speculate.
5. **Reduce pointer density** for high-throughput services.
6. **Use `atomic.Pointer[T]`** for lock-free shared pointers.
7. **Use `sync.Pool`** for pooling short-lived large allocations.
8. **Avoid `unsafe.Pointer`** unless you understand the safety implications.
9. **Use `-gcflags="-m"`** to verify escape behavior.

---

## 8. Reading the Compiler Output

```bash
# Escape analysis
go build -gcflags="-m=2"

# Inlining + escape
go build -gcflags="-m -m"

# Assembly
go build -gcflags="-S"
```

Look for:
- "moved to heap: <var>"
- "&<var> escapes to heap"
- "<var> does not escape"

---

## 9. Self-Assessment Checklist

- [ ] I understand escape analysis decisions
- [ ] I can predict pointer cost in hot paths
- [ ] I know GC's treatment of pointer roots
- [ ] I avoid pointer aliasing in hot paths
- [ ] I use atomic.Pointer for lock-free swaps
- [ ] I use sync.Pool for reusable allocations
- [ ] I handle nil receivers explicitly when appropriate
- [ ] I reduce pointer density for high-throughput services

---

## 10. Summary

Pointers are typed addresses with strict escape semantics. Use them deliberately. The compiler's escape analysis decides stack vs heap; verify with `-gcflags="-m"`. For concurrent shared state, prefer `atomic.Pointer` or mutexes. For high-throughput services, reduce pointer density to lower GC overhead. Always nil-check at API boundaries.

---

## 11. Further Reading

- [Go Internal ABI](https://github.com/golang/go/blob/master/src/cmd/compile/abi-internal.md)
- [`sync/atomic.Pointer`](https://pkg.go.dev/sync/atomic#Pointer)
- [`sync.Pool`](https://pkg.go.dev/sync#Pool)
- [Dave Cheney — Allocations](https://dave.cheney.net/2018/01/24/allocations-on-the-go-heap)
- 2.7.4 Memory Management
- 2.6.7 Call by Value
