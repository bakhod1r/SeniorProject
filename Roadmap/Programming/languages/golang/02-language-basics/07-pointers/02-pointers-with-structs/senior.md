# Go Pointers with Structs — Senior Level

## 1. Overview

Senior-level mastery means precise reasoning about memory layout, allocation patterns, GC implications of pointer-heavy struct designs, and the trade-offs between value/pointer designs in production systems.

---

## 2. Advanced Semantics

### 2.1 Memory Layout

`*Struct` is an 8-byte address. The struct it points to has a layout:
- Fields in declaration order.
- Padding for alignment.
- Total size = sum of field sizes + padding (rounded to alignment).

Use `unsafe.Sizeof(T{})` to inspect.

### 2.2 Field Access

`p.Field` lowers to `MOVQ offset(p_register), reg` — single load.

Field offsets are compile-time constants from the struct layout.

### 2.3 Method Dispatch

For a pointer receiver method:
- Direct call: compiled to `CALL T_M(SB)` with the pointer as first arg.
- Through interface: vtable lookup + indirect call.

### 2.4 Escape and Constructor Pattern

```go
func New() *T { return &T{} } // T escapes; heap-allocated
```

Each call to `New()` allocates one T on the heap. For high-throughput code, consider `sync.Pool`.

### 2.5 GC Roots in Pointer Fields

Each `*T` field in a heap struct is a GC root. The GC follows it during marking. Pointer-heavy structs add to GC scan time.

For data-only structs, prefer value fields over pointer fields when the data is owned exclusively.

---

## 3. Production Patterns

### 3.1 Struct Pooling
```go
var pool = sync.Pool{New: func() any { return new(Buffer) }}

func acquire() *Buffer {
    b := pool.Get().(*Buffer)
    return b
}

func release(b *Buffer) {
    b.Reset()
    pool.Put(b)
}
```

### 3.2 Snapshot Pattern via atomic.Pointer
```go
var configPtr atomic.Pointer[Config]

// Reader
cfg := configPtr.Load()
// Writer
configPtr.Store(&Config{...})
```

Lock-free configuration swap.

### 3.3 Avoiding Pointer Density
For high-throughput data structures, prefer:
```go
type EventList struct{ items []Event } // value slice
```
over:
```go
type EventList struct{ items []*Event } // pointer slice — more GC roots
```

Value slice = single allocation, contiguous memory, fewer roots.

---

## 4. Concurrency Considerations

### 4.1 Shared Pointer Mutation
```go
shared := &State{}
go func() { shared.X = 1 }()
go func() { shared.X = 2 }()
// race
```

Synchronize with mutex or atomic.

### 4.2 Immutable Pointer Pattern
```go
// Build state once, share immutable pointer:
state := build()       // build complete
ptr.Store(state)        // publish

// Readers:
s := ptr.Load()
// read s; never mutate
```

If readers don't mutate, no synchronization needed beyond the atomic publish.

---

## 5. Memory and GC Interactions

### 5.1 Cost of `&T{}` per Call

Each constructor call: ~25 ns + GC tracking. For 1M calls/sec, GC pressure is meaningful.

`sync.Pool` reduces allocation rate.

### 5.2 Sub-Object Lifetimes

Pointer to a struct field keeps the entire struct alive:
```go
big := &Big{Sub: SubStruct{...}}
sub := &big.Sub
big = nil
// sub keeps Big alive (Sub is part of Big's allocation)
```

For long-term storage of small portions, copy out.

---

## 6. Production Incidents

### 6.1 Receiver Inconsistency Caused Interface Failure

A type had mixed value/pointer receivers. An interface expected all methods; the compiler accepted `*T` but not `T`. Tests passed; production failed when callers passed value-typed instances.

Fix: use only pointer receivers.

### 6.2 Pointer Density Slowed GC

A service stored `[]*Event` with 5M events; each Event had 8 pointer fields. GC roots = 40M; pause time exceeded SLO.

Fix: convert to `[]Event`. GC scan dropped 90%.

### 6.3 Constructor Allocates in Hot Path

A handler called `NewParser()` per request, allocating a 2 KB struct. 50k req/sec → 100 MB/sec allocation.

Fix: `sync.Pool` for parser instances.

---

## 7. Best Practices

1. Receiver consistency.
2. Constructors for non-trivial types.
3. `sync.Pool` for hot constructor allocations.
4. `atomic.Pointer` for shared snapshots.
5. Reduce pointer density for high-throughput.
6. Profile before optimizing.

---

## 8. Reading the Compiler Output

```bash
go build -gcflags="-m=2"  # escape decisions
go build -gcflags="-S"     # assembly
```

Look for "moved to heap" on struct allocations.

---

## 9. Self-Assessment Checklist

- [ ] I understand memory layout
- [ ] I use receiver consistency
- [ ] I employ sync.Pool for hot allocations
- [ ] I use atomic.Pointer for shared state
- [ ] I reduce pointer density when appropriate
- [ ] I profile production allocation patterns

---

## 10. Summary

`*Struct` is a fundamental Go pattern. Use receiver consistency, constructors, and sync.Pool. For shared state, prefer atomic.Pointer or mutex. Reduce pointer density to lower GC overhead. Profile to verify your choices.

---

## 11. Further Reading

- [`atomic.Pointer`](https://pkg.go.dev/sync/atomic#Pointer)
- [`sync.Pool`](https://pkg.go.dev/sync#Pool)
- [Dave Cheney — Allocations](https://dave.cheney.net/2018/01/24/allocations-on-the-go-heap)
- 2.7.4 Memory Management
