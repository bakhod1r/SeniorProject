# Escape Analysis — Specification

> **Focus:** Precise reference for Go's escape analysis pass — what it does, what it observes, what it guarantees, and how to interrogate it.
>
> **Sources:**
> - `cmd/compile/internal/escape` source: https://github.com/golang/go/tree/master/src/cmd/compile/internal/escape
> - `go help build` (`-gcflags`)
> - Design doc: https://github.com/golang/go/blob/master/src/cmd/compile/internal/escape/doc.go

---

## 1. What escape analysis is

Escape analysis is a **compile-time** static analysis run by the Go compiler. For every allocation site, it answers a single question: *can the lifetime of this value be bounded by the current function's stack frame?* If yes, the value is stack-allocated. If no — or if the compiler cannot prove it — the value escapes to the heap.

The analysis runs after type checking and before SSA-based optimizations, on a function-by-function basis with whole-package visibility for inlined calls.

---

## 2. Where it lives in the toolchain

```
parse → type-check → escape analysis → inlining → SSA → codegen
```

Escape analysis interacts with inlining: an inlined call exposes its body to the caller's escape analysis, which can prove things about pointers that crossed the call boundary. Disabling inlining (`-gcflags="-l"`) usually causes more escapes.

---

## 3. The "escape" relation

A value *escapes* if any of the following can be true at any program point reachable from its allocation:

| Cause | Example |
|-------|---------|
| Address taken and stored in a non-stack location | `g = &x` (g is a package var) |
| Address returned from the enclosing function | `return &x` |
| Address sent on a channel | `ch <- &x` |
| Address captured by a closure that itself escapes | `return func() *T { return &x }` |
| Stored in an interface whose dynamic value is too big to fit in the iface header | `var i any = bigStruct{}` |
| Stored in a slice or map element when the slice/map escapes | `globalSlice[0] = &x` |
| Object size exceeds the per-allocation stack limit (~10 MiB) | huge local array |
| Allocation size is unknown at compile time and might be large | `make([]byte, n)` with non-const `n` |

If none of these can be proved, the value is allocated on the stack.

---

## 4. Reachability vs. lifetime

The analysis approximates lifetime by reachability: if a pointer to `x` is reachable from anything that outlives the current frame, `x` escapes. The compiler is conservative — when in doubt, it escapes. This means valid stack-only programs can still get heap allocations because the compiler couldn't prove the stack-only property.

---

## 5. The `-m` flag

```bash
go build -gcflags="-m" ./...
go build -gcflags="-m=2" ./...   # more detail
go build -gcflags="-m=3" ./...   # even more, including ESC strings
```

Sample messages:

| Message | Meaning |
|---------|---------|
| `moved to heap: x` | `x` was declared on stack but had to be heap-allocated |
| `x escapes to heap` | An address-of or assignment caused `x` to escape |
| `&T literal escapes to heap` | A composite literal escapes |
| `inlining call to f` | `f` was inlined; affects subsequent escape conclusions |
| `parameter x leaks to {heap, ~r0, …}` | Function summary used by callers |

Combined with `-l` (disable inlining), `-N` (disable optimizations) you can isolate which optimization caused or prevented an escape.

---

## 6. Function summaries

Escape analysis computes, per function, a **summary** describing how each parameter's pointer escapes:

| Summary token | Meaning |
|---------------|---------|
| `leaks param to {heap, …}` | Parameter (or what it points to) escapes |
| `leaks param to ~r0` | Parameter pointer is returned via result 0 |
| `parameter does not escape` | Parameter is contained within the call |
| `parameter leaks to outer closure scope` | Captured by an escaping closure |

These summaries propagate across package boundaries via export data. When a caller sees `func f(p *T)` whose summary says `p does not escape`, the caller can stack-allocate `*T` it passes.

---

## 7. Interactions with inlining

Inlining (`-gcflags="-l"` disables it) exposes function bodies to caller-side escape analysis. Without inlining, the conservative summary must hold; with inlining, the actual flow is analyzed. Two consequences:

- Calling a small accessor that takes `&x` and reads but doesn't store can be free if inlined.
- The same code called via interface (which inhibits inlining of the implementation) often escapes when the direct call would not.

---

## 8. Interfaces and escape

Storing a value `v` in an `interface{}` boxes it:

- If `sizeof(v) == 0`, no allocation (zero-sized types share a single address).
- If `v` fits in a pointer word and contains no pointers (rare with current ABI), the runtime may store inline (no allocation). This optimization is being removed in modern Go versions; assume an allocation.
- Otherwise, the data is heap-allocated and the interface header holds a pointer to it.

Therefore: any `func f(any)` call with a non-trivial argument causes an allocation at the call site. Generic functions (`func f[T any](x T)`) do not box and are the right replacement for hot paths.

---

## 9. Maps, channels, and closures

| Construct | Escape effect |
|-----------|---------------|
| `make(map[K]V, n)` | Always heap (maps have no stack representation) |
| `make(chan T, n)` | Always heap |
| Slice with constant small capacity | May be stack-allocated if it doesn't escape |
| Closure variable captured by reference | Captured variable escapes if the closure escapes |
| Closure that doesn't escape | Captured variables stay on the stack of the enclosing frame |

Closures complicate the picture: a closure assigned to a `func` variable that is later called locally and never stored does not escape; the same closure returned from the function escapes along with its captures.

---

## 10. Compile-time bounds

| Bound | Value |
|-------|-------|
| Max single stack object | ~10 MiB (`maxStackVarSize`) |
| Max function stack frame | unbounded in principle, but practical limit is goroutine stack growth |
| Recursion depth | bounded only by stack growth budget |
| Per-function summary size | bounded; very large functions may degrade analysis precision |

When a single object exceeds the stack-object cap (e.g., a 20 MiB local array), the compiler forces it to the heap regardless of escape.

---

## 11. Stability of decisions

Escape analysis decisions are **not** part of the Go language spec. They are an implementation detail of `cmd/compile` and can change across Go releases. Two consequences:

- Don't write code that depends on a specific escape decision for correctness; the language guarantees safety either way.
- Do bench-test your hot paths across Go upgrades; sometimes allocations appear or disappear with a new compiler.

---

## 12. Public APIs that interact

None directly. Escape analysis runs entirely at compile time. The closest user-visible touch points:

- `go build -gcflags="-m..."` to inspect decisions.
- `runtime.KeepAlive` to extend the *runtime* lifetime past the analyzer's conclusion (different from escape — same object, different concept).
- Generics, used to avoid `interface{}` boxing.

---

## 13. Non-goals / limitations

- Escape analysis is not a full alias analysis. It approximates aliasing conservatively.
- It does not consider whether the heap allocation would have a perf cost — it only categorizes lifetime.
- It cannot reason across reflection (`reflect`), which forces conservative escapes.
- It cannot reason about `unsafe.Pointer` arithmetic; touching `unsafe` typically forces escape.

---

## 14. Related references

- `cmd/compile/internal/escape/doc.go`: the authoritative narrative
- "Allocation efficiency in high-performance Go": https://segment.com/blog/allocation-efficiency-in-high-performance-go-services/
- Go 1.20+ improvements to escape: https://go.dev/doc/go1.20#compiler
- Memory management: [01-memory-management-in-depth](../01-memory-management-in-depth/)
