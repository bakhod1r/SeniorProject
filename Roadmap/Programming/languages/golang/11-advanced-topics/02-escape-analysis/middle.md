# Escape Analysis — Middle

## 1. The analysis in a paragraph

Escape analysis runs after type checking, before SSA. The compiler builds a graph where nodes are syntactic locations (variables, parameters, results) and edges represent "this location's address can reach that location". If a node reaches a node that outlives the current frame — globals, the heap, a return value, a goroutine — the source location escapes. The analysis is intra-function but uses **summaries** of called functions, exported across packages.

---

## 2. The escape summary

Every function the compiler analyzes gets a *summary* describing how each parameter's pointer can leak. Three buckets:

- **No leak:** parameter pointer stays inside the call.
- **Leak to heap:** parameter pointer ends up stored somewhere with longer lifetime.
- **Leak to result:** parameter pointer comes back as part of a return value.

Read summaries with `-gcflags="-m=2"`:

```
./pkg.go:10:6: parameter x leaks to ~r0 with derefs=0
./pkg.go:20:6: parameter buf does not escape
./pkg.go:30:6: leaking param: cb
```

`cb` is a callback the function stored somewhere — the closure's captures escape too.

---

## 3. Inlining changes everything

Inlining lets the caller see the callee's body and reason about pointers concretely instead of via summary. Two consequences:

```go
//go:noinline
func leak(p *int) { _ = *p }   // summary: does not escape

func bad() {
    x := 42
    leak(&x)
}
```

With the noinline directive, `bad`'s analysis relies on the summary and concludes `x` doesn't escape — correct. Strip the directive and the compiler inlines, sees the body directly, still concludes no escape. Either way, the answer is right.

Where it matters is **interfaces and indirect calls**. The compiler can't inline through an interface dispatch, so the summary alone is consulted. For methods called via interface, summaries are pessimistic and you often get unnecessary escapes.

```go
type reader interface { Read([]byte) (int, error) }

func use(r reader, buf []byte) (int, error) {
    return r.Read(buf)        // buf may escape because the dynamic Read could store it
}
```

Direct calls to a concrete type don't have this problem.

---

## 4. Closures, decoded

```go
func a() *int {
    x := 42
    return &x                  // x → heap (returned address)
}

func b() {
    x := 42
    f := func() { fmt.Println(x) }   // captures by value: no escape
    f()
}

func c() func() int {
    x := 42
    return func() int { x++; return x }   // captures by reference; closure escapes; x → heap
}
```

A closure captures `x` by reference only if the closure mutates `x` or the analyzer can't otherwise prove safety. A closure that escapes drags its captures with it.

---

## 5. Slices, channels, maps

```go
make(map[K]V)        // always heap (map header + buckets)
make(chan T, n)      // always heap
make([]T, 0, 8)      // stack if doesn't escape
```

A slice header is three words (ptr, len, cap) and lives in whatever frame the variable is in. The *backing array* may live on the stack if its size is known and the slice doesn't escape. As soon as the slice is stored somewhere durable, the backing array goes to the heap.

```go
func f() []int {
    s := make([]int, 4)        // backing array escapes (returned)
    return s
}

func g() int {
    s := make([]int, 4)        // backing array stays on the stack
    return s[0]
}
```

---

## 6. Composite literals

`&T{...}` and `new(T)` are the same — both produce a pointer to a zero-allocated `T`. Whether the storage is stack or heap depends on whether the resulting pointer escapes.

```go
p := &Point{1, 2}      // p doesn't escape: Point stays on stack
return &Point{1, 2}    // result escapes: heap
```

For slices and maps, the *header* is small enough to be cheap; it's the *backing storage* the escape rules care about.

---

## 7. Interfaces and boxing

A value `v` stored into an interface header (`any`, `error`, any single-method interface) is boxed:

- If `sizeof(v) <= word size` *and* `v` is pointer-shaped (and recent enough Go), the data is inlined into the iface header — no allocation. This optimization is increasingly fragile across versions; do not depend on it.
- Otherwise, the runtime allocates a heap copy of `v` and stores its address in the iface data slot.

Practical advice: in hot paths, avoid `interface{}` and `any` parameters. Use generics where the call site is monomorphic per type.

```go
func sumAny(xs []any) (s int64) { /* boxes every int */ }
func sum[T constraints.Integer](xs []T) T { /* no box */ }
```

---

## 8. Reflection forces escape

Anything that flows into `reflect.Value` is treated conservatively. The reflection runtime stores values in interface boxes internally; the compiler can't track those uses precisely and assumes the worst. Therefore:

```go
func dump(x any) {
    v := reflect.ValueOf(x)    // x escapes
    fmt.Println(v.Kind())
}
```

This is why reflection is slow not only at the call site but for the entire chain of values that flow through it.

---

## 9. `unsafe` forces escape

```go
func u(x int) uintptr {
    return uintptr(unsafe.Pointer(&x))   // x escapes
}
```

Once a pointer becomes `unsafe.Pointer` or `uintptr`, the analyzer can't track it anymore, so it assumes escape. (And remember — `uintptr` is not a pointer to the GC, so the underlying object is **not** kept alive by the `uintptr` even though it's on the heap. Use `runtime.KeepAlive`.)

---

## 10. Practical reading of `-m` output

```
./main.go:14:6: can inline f
./main.go:18:9: inlining call to f
./main.go:22:6: parameter x leaks to ~r0
./main.go:25:9: &T{...} escapes to heap
./main.go:27:9: ... argument does not escape
./main.go:30:6: moved to heap: result
```

| Line | Meaning |
|------|---------|
| `can inline f` | `f` is small enough to inline; callers will be analyzed with its body visible |
| `inlining call to f` | This particular call site was inlined |
| `parameter x leaks to ~r0` | Function returns its parameter pointer through result 0 |
| `&T{...} escapes to heap` | Composite literal could not be stack-allocated |
| `... argument does not escape` | Variadic args' backing array stays on stack |
| `moved to heap: result` | A declared variable had to be moved to heap |

Combine with `-l` (no inlining) and `-N` (no optimizations) to isolate which step changed a decision.

---

## 11. Generics

Generic functions don't box. The compiler **stenciling** strategy (with shape-based instantiations) produces one body per "shape" of the type parameter, so an `int` and a `uint32` may share a body but the value is passed as the actual type, not boxed.

```go
func Max[T constraints.Ordered](a, b T) T {
    if a > b { return a }
    return b
}
```

Calling `Max(3, 5)` does not allocate. Calling `Max(largeStruct1, largeStruct2)` may copy, but doesn't box.

There's a subtlety: when a generic function takes a `T` and uses it as an `any`, the boxing happens at the `any` conversion, not at the generic boundary. Keep your hot paths free of interface conversions.

---

## 12. Tooling

| Tool | What it gives you |
|------|-------------------|
| `go build -gcflags="-m"` | Basic escape decisions |
| `go build -gcflags="-m=2"` | Detailed summaries, debug strings |
| `go build -gcflags="-m -l"` | Decisions with inlining disabled |
| `go test -benchmem` | allocs/op + bytes/op per benchmark |
| `go tool compile -m -m -L file.go` | Standalone analysis on one file |
| `pprof -alloc_objects` | Per-callsite allocation counts |

`benchstat` quantifies the change between two runs — non-negotiable for serious work.

---

## 13. Summary

Escape analysis is a compile-time pass that decides stack vs heap, using function-level summaries and inlining-driven optimization. The cases you'll meet repeatedly are: returned addresses, captured closures, `interface{}` boxing, reflection, `unsafe`, large objects, and slices/maps where the backing storage outlives the frame. The tools to inspect — `-gcflags="-m"`, `benchstat`, pprof — pay for themselves the first time you find a 10× allocation hiding in a hot path.

---

## Further reading
- `cmd/compile/internal/escape/doc.go` (the authoritative source)
- "Go's Escape Analysis" — Bill Kennedy series
- Generics performance: https://planetscale.com/blog/generics-can-make-your-go-code-slower
