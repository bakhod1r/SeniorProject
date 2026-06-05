# IR & Middle-End — Interview

About 20 questions and answers spanning the IR, escape analysis, inlining, devirtualization, `walk`/desugaring, and PGO. Answers are concise but complete enough to defend in a follow-up.

---

### 1. What is an IR and why does the Go compiler use one?

An **intermediate representation** is the compiler's internal program data structure, between source text and machine code. Go's `gc` compiler builds a typed IR (in `cmd/compile/internal/ir`) where every node is an `ir.Node` discriminated by an `Op` enum (`ir.OADD`, `ir.OCALLFUNC`, …). It gives uniformity (one shape to analyze), enables machine-independent analysis/transformation (escape, inline, desugaring), and lets one front/middle-end target many architectures.

---

### 2. Where does the IR sit in the pipeline?

`parser → types2 type-checker → unified IR (noder) → middle-end (inline, devirtualize, escape, walk) → ssagen → SSA → back-end → machine code`. The IR + middle-end is everything after type-checking and before SSA construction.

---

### 3. What is the "unified IR"?

Since Go 1.18, the compiler uses a single representation that doubles as the package **export data** format. `cmd/compile/internal/noder` reads it back into `ir.Node` trees for the current package and lazily for imported packages. This is what makes **cross-package inlining and devirtualization** practical — the inliner can pull a callee's body out of imported package data.

---

### 4. What is escape analysis and what does it decide?

A compile-time middle-end pass (`cmd/compile/internal/escape`) that builds a pointer-flow graph and decides whether each value can live on the **stack** (freed with the frame) or must go on the **heap** (GC-managed). Stack allocation is free; heap allocation adds GC pressure. It runs after inlining so it sees post-inline shapes.

---

### 5. Name the common reasons a value escapes.

Returning a pointer/slice/closure that outlives the frame; storing into a global or into a heap-resident field; **boxing a value into an interface** (`any`/`error`) that escapes; slices that grow past a compile-time-provable bound; method values binding a receiver that's then retained.

---

### 6. Does `new(T)` always heap-allocate? Does `:=` always stack-allocate?

No — neither keyword decides allocation. Escape analysis decides by **reachability**. `new(T)` can stay on the stack if it doesn't escape; a `:=` value can be moved to the heap if it does.

---

### 7. How do you see escape decisions, and what's the exact flag?

`go build -gcflags=-m` (add `=2` for reasoning). It's `-gcflags=-m`, **not** `go build -m` — `-m` is a compiler flag forwarded by `-gcflags`. Output is on **stderr**, so pipe with `2>&1`. Scope it with `importpath=-m` to cut noise.

---

### 8. What does `leaking param: p` mean? Is it the same as "escapes"?

It means parameter `p` (or what it points to) outlives the call — typically `p` flows to a return value or a heap store. It's a *callee-side tag*; whether it causes an allocation is decided at the **caller**. Reading both sides of `-m` gives the full picture.

---

### 9. Why does `fmt.Println(x)` allocate?

`x` is boxed into the variadic `...interface{}` (an `OCONVIFACE` conversion), and the boxed value escapes into `fmt`'s reflection machinery. Each argument is a heap box. On hot paths, prefer typed paths (`strconv.Append*`, structured loggers with typed fields).

---

### 10. What is inlining and what are its benefits beyond removing call overhead?

Inlining copies a callee's body into the caller (`cmd/compile/internal/inline`). Beyond eliminating the call, it exposes the callee's code to the caller's context, enabling **escape analysis to keep values on the stack**, **devirtualization**, constant folding, and dead-code elimination. That's why inlining often *reduces* allocations.

---

### 11. How does the inliner decide what to inline?

It computes a **cost** by summing per-node costs over the body; if the cost is at/under the budget (`inlineMaxBudget`, ~80) the function is eligible. Some constructs (e.g. `select`, heavy `defer`/`recover`, very large bodies) raise cost or flatly block inlining. Modern Go adds call-site scoring to prefer call sites likely to pay off.

---

### 12. What is mid-stack inlining?

Since Go 1.9, a function that *itself calls other functions* can be inlined (not just leaf functions), as long as its own cost fits. This makes idiomatic Go's many tiny wrapper/accessor methods effectively free, folding through several layers.

---

### 13. What does `//go:noinline` do and when is it legitimate?

It forces the compiler to never inline that function. Legitimate uses: honest microbenchmarks (so the call isn't optimized away/specialized), keeping a function visible in profiles, **outlining a cold slow path** so the hot fast path stays small and inlinable. It should not be scattered casually — it silently costs performance.

---

### 14. What is devirtualization?

Converting an **interface method call** (`OCALLINTER`, an indirect jump through the itab) into a **direct call** when the concrete type is known (`cmd/compile/internal/devirtualize`). Static devirtualization fires when inlining/local analysis reveals the type; the resulting direct call is then itself an inline candidate. It removes indirection and helps branch prediction.

---

### 15. How does PGO change inlining and devirtualization?

With a CPU profile (`-pgo=FILE`, or auto-detected `default.pgo`), the compiler raises the inline **budget on hot call sites** (inlining functions normally too big, only where it pays) and performs **profile-guided devirtualization** on hot interface calls dominated by one concrete type. Profiles affect heuristics only — never correctness — and tolerate staleness. Typical wins: a few percent CPU.

---

### 16. What is `walk` and give examples of what it desugars.

`walk` (`cmd/compile/internal/walk`) lowers high-level IR into near-runtime form: `range` over a map → `runtime.mapiterinit`/`mapiternext`; `m[k]` → `runtime.mapaccess*`; `m[k]=v` → `runtime.mapassign*`; `append` → cap check + `runtime.growslice`; channel ops → `runtime.chansend1`/`chanrecv1`; type switches → itab compares + assert helpers; `string([]byte)` → `runtime.slicebytetostring`. It explains where "hidden" runtime calls come from.

---

### 17. What does the `order` pass do?

`order` (in `walk/order.go`) normalizes **evaluation order**, introduces temporaries, and ensures side effects sequence correctly — e.g., evaluating a map key into a temp before the assignment runtime call. It runs alongside `walk` to produce IR that ssagen can consume.

---

### 18. Why does inlining run before escape analysis?

Because inlining changes the shape escape analysis sees. A constructor that escapes its return value *in isolation* often stays on the stack once inlined into a caller that doesn't let the value leak. Running escape analysis after inlining lets it prove more values stay on the stack.

---

### 19. How does IR feed SSA? What's already decided by then?

After `walk`, IR is lowered (no `range` sugar, map ops are runtime calls, multi-assigns split, eval order fixed). `cmd/compile/internal/ssagen` walks this and emits SSA. By then, **escape decisions are baked in** (escaped names emit `runtime.newobject`), **inlined bodies are spliced** (with `OINLMARK` frame markers preserved for tracebacks/profiles), and devirtualized calls are direct.

---

### 20. A function shows no escapes under `-m`, but the benchmark reports allocations. Why?

The allocations are in **callees**, not in this function's own frame — `-m` reports per-function, and you likely scoped it to one package while a stdlib/other-package callee allocates. Use `-gcflags='all=-m'` (noisy) or, better, a heap **alloc profile** (`go tool pprof -alloc_objects`) to find the actual allocating frame.

---

### 21. (Bonus) Why might a generic function allocate where a concrete one didn't?

Go implements generics via **GC-shape stenciling** with runtime dictionaries. For pointer/interface-shaped type arguments, calls through the type parameter can be dictionary-mediated (indirect) and a passed-in function may not inline; `any`-constrained values can box. On hot paths, check `-m` on the *instantiated* function; a monomorphic version sometimes inlines/devirtualizes where the generic one can't.

---

## Summary

- IR = typed `ir.Node`/`Op` tree (unified IR via `noder`); middle-end order is **inline → devirtualize → escape → walk/order → ssagen**.
- Escape analysis (compile-time) decides stack vs heap by reachability; boxing, returned pointers/closures, and global stores escape. See it with `-gcflags=-m` (stderr).
- Inlining uses a ~80 cost budget; mid-stack inlining folds wrappers; it unlocks escape analysis and devirtualization. `//go:noinline` forces out-of-line.
- Devirtualization turns interface calls direct (static or PGO); `walk` desugars high-level constructs into `runtime.*` calls; PGO buys hot-path inline/devirt for a few percent.

---

## Further reading

- [`cmd/compile` README](https://github.com/golang/go/blob/master/src/cmd/compile/README.md)
- [Profile-guided optimization](https://go.dev/doc/pgo)
- [Go FAQ: stack or heap](https://go.dev/doc/faq#stack_or_heap)
- Go source: [`cmd/compile/internal/ir`](https://github.com/golang/go/tree/master/src/cmd/compile/internal/ir), [`internal/inline`](https://github.com/golang/go/tree/master/src/cmd/compile/internal/inline), [`internal/escape`](https://github.com/golang/go/tree/master/src/cmd/compile/internal/escape)
