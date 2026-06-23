# Escape Analysis — Interview

Common interview questions about escape analysis, with the kind of answer a senior candidate would give.

---

## Q1. What is escape analysis?

A compile-time analysis the Go compiler performs to decide, for each value, whether it can live on the stack (cheap, scoped to a function call) or must be allocated on the heap (managed by the GC). The rule: if the value's address can be observed after the function returns, it escapes.

---

## Q2. How do you inspect escape analysis decisions?

```
go build -gcflags="-m" ./...
```

`-m=2` for more detail, `-m=3` for full flow strings. Combine with `-l` to disable inlining and isolate which decision an inline pass changed.

---

## Q3. Name five things that cause a value to escape.

1. Returning a pointer to a local variable.
2. Storing a pointer in a global, channel, or heap-resident container.
3. Capturing a variable in a closure that itself escapes.
4. Storing a value in `interface{}` (boxing).
5. Using `reflect` or `unsafe` on the value.

Also: very large objects (>~10 MiB), `make` of unknown size, and being sent on a channel.

---

## Q4. Does `&x` always cause `x` to escape?

No. `&x` causes escape only if the address can reach a location that outlives the frame. Taking the address and immediately reading through it inside the function, where the pointer doesn't leak, keeps `x` on the stack.

---

## Q5. Why does putting a value in an `interface{}` allocate?

An interface header is two words (`itab*`, `data*`). For non-pointer values, the data slot must point at a separately allocated location (the interface can't hold arbitrary-sized data inline). The runtime allocates on the heap and stores the pointer.

Pointer-shaped, word-sized values used to be stored inline, but that optimization has been removed or tightened over time; assume an allocation.

---

## Q6. What's the relationship between escape analysis and inlining?

Inlining concretizes flow that summaries can only approximate. With inlining enabled, the compiler can prove a pointer doesn't leak across what was a function boundary. Without inlining (e.g., method calls through interfaces, or `//go:noinline`), the conservative summary is used and more values escape.

---

## Q7. Does using generics avoid escape costs?

Generics replace boxing — they pass typed values directly instead of through `interface{}`. So `Max[int](a, b)` doesn't box, while `Max(a, b interface{}) interface{}` would. But generics monomorphize per shape; if your generic code converts `T` to `any` internally, you're back to boxing at that point.

---

## Q8. What does "leaks param to ~r0" mean in `-m` output?

The function's parameter pointer escapes by being returned through result 0. Callers analyze the call site by following result 0's escape, which may or may not actually escape depending on what the caller does with the return value.

---

## Q9. Are maps ever stack-allocated?

No. Maps are always heap-allocated. The map header is small, but the buckets and the housekeeping make stack allocation impractical. If you need a tiny, fixed-shape lookup, prefer a slice or a `switch` statement.

---

## Q10. Are closures always heap-allocated?

No. A closure that's called locally and never escapes can be stack-allocated, including its captures. A closure stored in a long-lived location, returned, or sent through a channel escapes, and its captured variables escape with it.

---

## Q11. What's the difference between `runtime.KeepAlive` and escape analysis?

Escape analysis decides *where* a value is allocated. `runtime.KeepAlive` extends a value's *lifetime* at runtime — telling the GC not to collect it until a certain point. They're orthogonal: an object can be heap-allocated and still be collected before a cgo call finishes if the compiler can't see a later use; `KeepAlive` bridges that gap.

---

## Q12. How do you measure allocation behavior in a test?

```go
func BenchmarkX(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ { _ = work() }
}
```

`go test -bench=. -benchmem` shows `B/op` and `allocs/op`. For tracking over time, use `benchstat` to compare runs statistically.

---

## Q13. What's the cost of a heap allocation in Go?

Roughly:

- Small allocations hit the per-P `mcache` and complete in tens of nanoseconds.
- The real cost is GC pressure: each heap object adds to the mark phase's work.
- Indirectly: more allocations mean more frequent GC cycles, more mark-assist debt for goroutines, more CPU.

Stack allocation is essentially a pointer bump.

---

## Q14. How does escape analysis interact with `defer`?

`defer f(args)` evaluates the args eagerly and stores them in a per-call record. In Go 1.14+ "open-coded defers", these records are stack-allocated for the common case (≤ 8 defers per function, no defers inside loops or via function values). Pathological cases fall back to heap-allocated records.

---

## Q15. What's the best workflow for fixing an allocation hotspot?

1. Profile (`-benchmem`, `pprof -alloc_objects`).
2. Pick the top allocation site.
3. Look at the code; read `-gcflags="-m=2"` for that file.
4. Apply one focused change.
5. Re-bench with `benchstat`.
6. Keep or revert based on the result.

Don't change five things at once. Don't optimize without a profile.

---

## Q16. Why does `fmt.Sprintf` allocate?

Multiple reasons:

- The variadic `args ...any` requires boxing each non-pointer argument.
- The formatter constructs a `pp` state object.
- The result is built into a `bytes.Buffer` that's then converted to a string.

For hot paths, use `strconv.AppendInt`-style buffer assembly.

---

## Q17. When would you use `sync.Pool`?

When you have many short-lived allocations of similar size on concurrent paths — typically per-request scratch buffers, encoders, parsers. Not a cache: the GC can drain pools at any cycle. Not for long-lived or unbounded-size objects. Always reset before put.

---

## Q18. Can the same function show different escape behavior in different Go versions?

Yes. Escape analysis is part of `cmd/compile`, not the language spec. Improvements (and occasional regressions) change decisions across releases. Treat zero-alloc benchmarks as regression guards, and re-bench when you upgrade Go.

---

## Q19. Why does the compiler escape a variable I know is safe?

Because the compiler is *conservative*. It can fail to prove safety even when the code is in fact safe — particularly through reflection, unsafe casts, indirect calls, or large closures. The remedies are: restructure the code to make safety provable, or accept the heap allocation.

---

## Q20. Bonus — describe an escape bug you've found and fixed in real code.

Open-ended; strong candidates have a story like "a hot loop was boxing int args into a logger's variadic `any`; we switched to typed slog attrs and saved ~15% CPU". The point is to see whether you've done this kind of work, not to test a specific answer.

---

## Cheat sheet

- "Address escapes the frame" → heap.
- Use `-gcflags="-m"` to see decisions.
- Interface, reflect, unsafe, big object, returned pointer → escape.
- Stack-only paths: small values, no pointer leaks, inline-friendly code.
- Tools: `-benchmem`, `benchstat`, `pprof -alloc_objects`.

---

## Further reading
- `cmd/compile/internal/escape/doc.go`
- "Allocation efficiency in high-performance Go services" — Segment
- `slog` performance notes
