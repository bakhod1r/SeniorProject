# IR & Middle-End — Find the Bug

Each scenario gives **code/symptom**, then **cause**, then **fix**. "Bug" here usually means *unexpected heap allocation* or *missed optimization* — the kind of thing `go build -gcflags=-m` exposes. Reproduce each with:

```bash
go build -gcflags='-m=2' ./...   # decisions on stderr
go test -bench=. -benchmem ./... # allocs/op to confirm
```

---

## 1. Pointer escaping via an interface

**Symptom.** A "value" function unexpectedly allocates.

```go
func emit(v any) { sink = v }   // sink is a package var
var sink any

func hot() {
    x := 12345
    emit(x) // ./x.go: x escapes to heap
}
```

**Cause.** `x` is boxed into `any` (`OCONVIFACE`) and then stored in the package-level `sink`, whose lifetime is unbounded. Boxing into an interface that escapes forces the boxed value onto the heap.

**Fix.** Don't retain the boxed value, or store a typed copy you control. If `sink` only ever needs the int, make it `var sink int` and pass `x` by value — no boxing, no escape.

---

## 2. Returning a pointer to a local

**Symptom.** Constructor allocates on every call in a hot loop.

```go
type V3 struct{ X, Y, Z float64 }
func NewV3(x, y, z float64) *V3 { return &V3{x, y, z} } // &V3{...} escapes to heap
```

**Cause.** Returning `&V3{...}` means the value must outlive the function frame, so it is heap-allocated.

**Fix.** Return by value when the struct is small: `func NewV3(...) V3 { return V3{x,y,z} }`. After inlining at the call site the value stays on the stack and the copy is usually elided. Reserve pointer returns for large structs or when identity/mutation semantics are required.

---

## 3. Closure captured by reference outlives its scope

**Symptom.** A counter factory allocates; the captured int is on the heap.

```go
func counter() func() int {
    n := 0                       // moved to heap: n
    return func() int { n++; return n }
}
```

**Cause.** The returned closure outlives `counter`, and it captures `n` by reference. So `n` must live on the heap. This is correct behavior, but surprising if you expected a stack int.

**Fix.** It's only a "bug" if the closure didn't need to escape. If you call the closure locally and synchronously and never return/store it, the compiler keeps `n` on the stack. If you do need the factory pattern, accept the one allocation — or pass the counter state in explicitly (e.g., return a small struct with a method) if you want to control layout.

---

## 4. `//go:noinline` silently killing a hot path

**Symptom.** A trivial accessor that "should be free" shows up hot in profiles; call overhead dominates.

```go
//go:noinline
func (c *Cache) get(k key) (val, bool) { return c.m[k], true }
```

**Cause.** A `//go:noinline` left over from a debugging/benchmark session prevents the inliner from folding this one-liner; every call is a real function call (and the map index can't be specialized into the caller).

**Fix.** Remove the directive. Confirm with `go build -gcflags=-m` that you now see `can inline get` and `inlining call to get`. Add a CI grep so a stray `//go:noinline` on hot code is caught in review.

---

## 5. Devirtualization missed because the type is hidden behind an interface

**Symptom.** A hot interface call won't go direct; profile shows itab indirection.

```go
func process(r io.Reader, b []byte) (int, error) {
    return r.Read(b) // OCALLINTER — stays indirect
}
```

**Cause.** `process` is called from many places with different concrete types, and it is itself too big to inline at those sites, so the compiler never learns a single concrete type for `r`. Without a known type (or a profile), it cannot devirtualize.

**Fix.** Three options: (a) make `process` small enough to inline so the concrete type flows in and static devirtualization fires; (b) if one concrete type dominates at runtime, enable **PGO** so profile-guided devirtualization inserts a fast direct path; (c) if you control the call, accept the concrete type (`*bytes.Reader`) instead of `io.Reader` on the hot path.

---

## 6. Slice grows past a provable bound and escapes

**Symptom.** A function that builds a small result slice allocates its backing array.

```go
func ids(items []Item) []int {
    var out []int               // make([]int, 0) escapes via growslice / return
    for _, it := range items {
        out = append(out, it.ID)
    }
    return out
}
```

**Cause.** Two things: the slice is **returned** (so its backing array must outlive the frame), and the final length is unknown to the compiler, so `append` may call `runtime.growslice` and reallocate.

**Fix.** You can't avoid the escape if you must return it, but you can avoid repeated growth: `out := make([]int, 0, len(items))`. One allocation instead of log-many. If the caller can supply a reusable buffer (`out []int` param, `out[:0]`), even the single allocation can be amortized away.

---

## 7. `defer` blocking inlining of a tiny function

**Symptom.** A small helper won't inline; `-m` says `cannot inline ...: function too complex` or unmarked.

```go
func withLock(mu *sync.Mutex, f func()) {
    mu.Lock()
    defer mu.Unlock()
    f()
}
```

**Cause.** Historically `defer` raised the inline cost / blocked inlining; the indirect call `f()` also adds cost. Even with open-coded defers, this shape is often over budget.

**Fix.** If this is genuinely hot, hand-inline the critical sections: `mu.Lock(); f(); mu.Unlock()` (carefully, only where no panic recovery is needed). Generally, prefer correctness — but know that wrapping helpers around `defer` are not free, and measure before relying on them inlining.

---

## 8. Interface conversion in `fmt` allocating per call

**Symptom.** A log line allocates several objects.

```go
log.Printf("user=%d action=%s", uid, action) // uid, action escape to heap
```

**Cause.** Variadic `...any` boxes every argument (`OCONVIFACE`), and the boxed values escape into `fmt`'s machinery. Each `%v`/`%d`/`%s` arg is a heap box.

**Fix.** On hot paths, bypass `fmt`: build the message with `strconv.AppendInt`/`append` into a reused buffer, or use a structured logger with typed fields (`zap.Int`, `slog` with typed attrs) that avoids boxing common types. Keep `fmt` for cold/error paths.

---

## 9. Method value capturing the receiver onto the heap

**Symptom.** Taking a method value allocates.

```go
type Server struct{ /* large */ }
func (s *Server) handle() { /* ... */ }

func register(h func()) { handlers = append(handlers, h) }
var handlers []func()

func (s *Server) setup() {
    register(s.handle) // method value: bound receiver escapes
}
```

**Cause.** `s.handle` is a *method value* — it creates a closure binding the receiver `s`. Because the closure is stored in the package-level `handlers`, the binding escapes.

**Fix.** If you don't need to retain it, pass `s` and call `s.handle()` at the use site instead of storing a bound method value. If you must store callables, that allocation is inherent to the design — pool or pre-size `handlers`, and accept it.

---

## 10. Map value of large struct type forcing copies/allocs

**Symptom.** Reads/writes of a map with big struct values are slow and allocate.

```go
type Big struct{ buf [4096]byte; meta Meta }
var m map[string]Big

func update(k string, meta Meta) {
    v := m[k]      // copies 4KB out
    v.meta = meta
    m[k] = v       // copies 4KB back; mapassign may grow → escape
}
```

**Cause.** Map values are not addressable, so you must copy the whole `Big` out and back. Large value types in maps cause big memmoves; growth reallocates.

**Fix.** Store pointers: `map[string]*Big`. Then `m[k].meta = meta` mutates in place (after a nil check) with no 4KB copies. (Trade-off: pointer values defeat some locality and add GC scan work — measure.)

---

## 11. `new(T)` that you assumed was stack, escaping through a field store

**Symptom.** `new` allocates even though the object seems local.

```go
type Node struct{ next *Node; v int }
var head *Node

func push(v int) {
    n := new(Node)  // moved to heap: new(Node)
    n.v = v
    n.next = head
    head = n
}
```

**Cause.** `n` is linked into `head`, a package-global list. Anything reachable from a global escapes. `new` vs `&T{}` makes no difference — escape analysis decides by reachability.

**Fix.** This escape is correct (the node really does outlive `push`). The lesson: don't assume `new` is stack or heap by syntax. If you wanted stack lifetime, you'd have to not store it in a longer-lived structure.

---

## 12. `-m` shows "does not escape" but benchmark still allocates

**Symptom.** `-m` is clean for your function, yet `-benchmem` reports `allocs/op > 0`.

```go
func parse(b []byte) Result { /* ... */ }
// -m: no escapes in parse
// bench: 3 allocs/op
```

**Cause.** The allocation is in a **callee** that `parse` invokes (e.g., a `regexp` call, a `strings.Split`, a map insert), not in `parse`'s own frame. `-m` reports per-function; you scoped it to the wrong package. Standard-library callees were built separately and their `-m` wasn't shown.

**Fix.** Build with `-gcflags='all=-m'` to include dependencies (noisy), or use an **alloc profile** (`go test -memprofile`) / `pprof -alloc_objects` to find the allocating frame. Don't trust a single-package `-m` to account for transitive allocations.

---

## 13. Bounds/format making append re-slice and escape unexpectedly

**Symptom.** A buffer you thought was reused allocates each iteration.

```go
func render(rows []Row) {
    for _, r := range rows {
        buf := make([]byte, 0, 64) // allocated every iteration; may escape
        buf = appendRow(buf, r)
        write(buf)                 // write stores buf somewhere?
    }
}
```

**Cause.** Two issues: `buf` is allocated *inside* the loop, and if `write` retains `buf` (stores it), the backing array escapes, defeating any reuse.

**Fix.** Hoist the buffer out and reset it: declare `buf := make([]byte, 0, 64)` before the loop, do `buf = buf[:0]` each iteration. Ensure `write` *copies* what it needs rather than retaining the slice; otherwise document that `write` takes ownership.

---

## 14. Generic function instantiation defeating inlining/devirt expectations

**Symptom.** A generic helper allocates or doesn't inline where the non-generic version did.

```go
func Map[T, U any](s []T, f func(T) U) []U {
    out := make([]U, len(s))
    for i, v := range s { out[i] = f(v) }
    return out
}
```

**Cause.** For interface-shaped type arguments, Go uses **GC-shape stenciling** with a dictionary; calls through the type parameter can become indirect (dictionary-mediated) and the passed `f` is an indirect call that may not inline. Boxing can sneak in for `any`-constrained types.

**Fix.** For truly hot paths, a monomorphic (concretely typed) version can inline and devirtualize where the generic one can't. Check `-m` for the *instantiated* function. Generics are great for clarity; verify the codegen on hot paths rather than assuming zero cost.

---

## Summary

- Most "bugs" here are **unexpected heap allocations** or **missed inlining/devirtualization**, surfaced by `-gcflags=-m`.
- Recurring causes: **interface boxing** (`OCONVIFACE`), returning pointers/slices/closures that **outlive the frame**, storing into **globals/long-lived structures**, **`defer`/indirect calls** raising inline cost, stray **`//go:noinline`**, and **per-iteration allocation** that should be hoisted.
- Always confirm with both `-m` (the decision) and `-benchmem`/alloc profile (the runtime truth) — and remember `-m` is per-package and stderr-only.
- Some escapes are *correct* (linked into a global, returned closure); the skill is telling necessary heap lifetime from accidental.

---

## Further reading

- [Go FAQ: stack or heap](https://go.dev/doc/faq#stack_or_heap)
- Go source: [`cmd/compile/internal/escape`](https://github.com/golang/go/tree/master/src/cmd/compile/internal/escape)
- [Diagnostics](https://go.dev/doc/diagnostics) — memory profiling to find transitive allocs
- [Profile-guided optimization](https://go.dev/doc/pgo) — for devirtualization on hot interface calls
- [Compiler directives](https://pkg.go.dev/cmd/compile#hdr-Compiler_Directives)
