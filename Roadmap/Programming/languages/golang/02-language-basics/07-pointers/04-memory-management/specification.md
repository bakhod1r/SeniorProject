# Go Specification: Memory Management

**Source:** https://go.dev/ref/mem, https://go.dev/doc/gc-guide

---

## 1. Spec Reference

| Field | Value |
|-------|-------|
| **Memory Model** | https://go.dev/ref/mem |
| **GC Guide** | https://go.dev/doc/gc-guide |
| **Allocation built-ins** | `new`, `make`, `&T{}` |
| **Go Version** | Go 1.0+ (memory model formalized in Go 1.19) |

---

## 2. Definition

Go manages memory automatically:
- **Stack**: per-goroutine, freed at function return.
- **Heap**: GC-managed, freed when no references remain.
- **Escape analysis** decides per-allocation.
- **GC**: concurrent, tri-color mark-sweep with write barriers.

You don't `free` or `delete` memory explicitly; the runtime does it.

---

## 3. Core Concepts

### 3.1 Stack Allocation
- Each goroutine has its own stack (starts ~2 KiB, grows as needed).
- Variables that don't escape the function stay on the stack.
- Freed implicitly at function return; no GC overhead.

### 3.2 Heap Allocation
- For values whose lifetime exceeds their declaring function.
- Triggered by `&local` escape, `new()`, `make()` for slices/maps/channels, interface boxing.
- Tracked by GC; reclaimed when unreachable.

### 3.3 Escape Analysis
The compiler decides at compile time whether each allocation goes on the stack or the heap. Visible via `go build -gcflags="-m"`.

### 3.4 Allocation Built-ins
- `new(T)`: allocate zero-initialized T, return `*T`.
- `make([]T, len, cap)`: allocate slice + backing array.
- `make(map[K]V, n)`: allocate map.
- `make(chan T, n)`: allocate channel.
- `&T{...}`: composite-literal allocation.

### 3.5 Garbage Collection
- Concurrent, tri-color mark-sweep.
- Write barriers maintain GC correctness during concurrent marking.
- Triggered by allocation rate (target heap size).
- Tunable via `GOGC` env var (default 100% growth target).

### 3.6 Memory Model
Go's memory model defines when reads can observe writes from other goroutines. Synchronization primitives (mutex, channel, atomic) establish happens-before relationships.

---

## 4. Compiler Tools

```bash
go build -gcflags="-m"        # escape decisions
go build -gcflags="-m=2"      # verbose
GODEBUG=allocfreetrace=1 ...   # trace allocations (very slow)
GODEBUG=gctrace=1 ...           # GC trace
```

---

## 5. Allocation Costs

- Stack: ~free.
- Heap small (<32 KB): ~25 ns.
- Heap large (>32 KB): direct page allocation, slower.
- GC overhead: proportional to allocation rate × pointer density.

---

## 6. Lifetime Rules

- Stack values: function scope.
- Heap values: alive until no references (no pointers from roots reach them).
- Globals: alive forever.
- Goroutine-scoped state: alive while the goroutine runs.

---

## 7. Spec Compliance Checklist

- [ ] Use `new(T)` for zero-init.
- [ ] Use `make` for slice/map/channel.
- [ ] Use `&T{...}` for initialized.
- [ ] Verify escape with `-gcflags="-m"`.
- [ ] Don't use `unsafe.Pointer` casually.
- [ ] Synchronize concurrent shared memory.

---

## 8. Related Spec Sections

| Section | URL |
|---------|-----|
| Memory model | https://go.dev/ref/mem |
| Allocation | https://go.dev/ref/spec#Allocation |
| Make | https://go.dev/ref/spec#Making_slices_maps_and_channels |
| GC guide | https://go.dev/doc/gc-guide |
