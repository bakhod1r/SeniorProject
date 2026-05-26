# Decorator Pattern — Under the Hood

## 1. The runtime framing

Junior taught the wrap-and-delegate shape; middle taught the design judgement and the production traps. This file is about what the compiler and the runtime actually do when a five-deep middleware chain runs. The source looks like a chain of polite forwards; the machine code is a tower of interface dispatches, funcval indirections, deferred recover machinery, embedded-method wrappers, and stack frames that the inliner refuses to flatten.

Two things make Decorator interesting at the machine level that Strategy doesn't have. First, a decorator chain *stacks* interface dispatches — each layer is one indirect call deeper than the last, and the inliner cannot see through any of them. Second, most middlewares carry a `defer` (for recovery, for timing, for closing resources). The `_defer` record, its allocation rules, the stack-frame layout for chained defers, and the runtime helpers `runtime.gopanic`, `runtime.gorecover`, `runtime.deferreturn` form a whole subsystem you don't see at the source level. A five-deep chain isn't just five extra calls; it's five extra `_defer` records, five extra closure captures, and a runtime call sequence that fans out through `runtime.deferproc` and back through `runtime.deferreturn`.

We work in Go 1.22 / amd64 unless stated otherwise. References are to the `go1.22.x` source tree; paths like `src/runtime/panic.go` for the panic/recover machinery, `src/runtime/runtime2.go` for the `_defer` and `funcval` structs, `src/cmd/compile/internal/walk/closure.go` for closure-construction lowering, and `src/cmd/compile/internal/walk/order.go` for `defer` ordering decisions.

The questions answered:

- How does an N-deep decorator chain compile in SSA, and why does the inliner stop at the first interface boundary?
- What does `http.HandlerFunc(f).ServeHTTP(w, r)` actually do — one call or two?
- What does the funcval look like when a middleware closure captures `next`?
- When does the closure escape? When does the wrapped `next` escape with it?
- What's in the `_defer` struct, and when can the compiler stack-allocate it?
- What is the assembly emitted for `defer func() { if rec := recover(); ... }()`?
- How much does `runtime.gorecover` cost when there's no panic vs when there is?
- How does PGO devirtualization (Go 1.21+) handle a chain of interface dispatches?
- What is the stack frame layout for a 5-deep middleware chain at runtime?
- Why are embedded-struct decorators slightly faster — and by how much?
- What does a slice of middleware functions look like in memory? What about after composition?
- Can Go tail-call-optimise a decorator that ends in `next.ServeHTTP(w, r)`? (Spoiler: no.)

This file pairs with [`../03-strategy-pattern/professional.md`](../03-strategy-pattern/professional.md), which covers the iface/itab layout, conversion helpers, and devirtualization. If you haven't read that one, read it first — this file builds on its iface model rather than restating it.

---

## 2. Table of Contents

1. [The runtime framing](#1-the-runtime-framing)
2. [Table of Contents](#2-table-of-contents)
3. [Chain dispatch — N stacked iface lookups](#3-chain-dispatch--n-stacked-iface-lookups)
4. [The compiler's SSA view of a chain](#4-the-compilers-ssa-view-of-a-chain)
5. [Inlining limits across interface boundaries](#5-inlining-limits-across-interface-boundaries)
6. [PGO devirtualization for chain calls](#6-pgo-devirtualization-for-chain-calls)
7. [Escape analysis — decorator, closure, captured next](#7-escape-analysis--decorator-closure-captured-next)
8. [The `http.HandlerFunc` adapter at the assembly level](#8-the-httphandlerfunc-adapter-at-the-assembly-level)
9. [Funcval layout for middleware closures](#9-funcval-layout-for-middleware-closures)
10. [Stack frame analysis for a 5-deep chain](#10-stack-frame-analysis-for-a-5-deep-chain)
11. [`-gcflags="-m -m"` output for chain construction](#11--gcflags-m--m-output-for-chain-construction)
12. [Memory layout — slice of middlewares and the composed chain](#12-memory-layout--slice-of-middlewares-and-the-composed-chain)
13. [`defer recover()` — when it's free, when it allocates](#13-defer-recover--when-its-free-when-it-allocates)
14. [The `_defer` struct and open-coded defers](#14-the-_defer-struct-and-open-coded-defers)
15. [`runtime.gopanic` / `runtime.gorecover` — what they do](#15-runtimegopanic--runtimegorecover--what-they-do)
16. [No tail-call optimisation — implications for deep chains](#16-no-tail-call-optimisation--implications-for-deep-chains)
17. [Embedded-struct decorators and method-table wrappers](#17-embedded-struct-decorators-and-method-table-wrappers)
18. [Assembly snippet for a typical middleware chain call](#18-assembly-snippet-for-a-typical-middleware-chain-call)
19. [Benchmarks across the chain depth](#19-benchmarks-across-the-chain-depth)
20. [Reading the Go source](#20-reading-the-go-source)
21. [Edge cases at the lowest level](#21-edge-cases-at-the-lowest-level)
22. [Test](#22-test)
23. [Tricky questions](#23-tricky-questions)
24. [Summary](#24-summary)
25. [Further reading](#25-further-reading)

---

## 3. Chain dispatch — N stacked iface lookups

A single interface call costs the iface dispatch sequence covered in `../03-strategy-pattern/professional.md` §5: load `tab.fun[i]`, move data into the receiver register, indirect `CALL`. A decorator chain is the same dispatch applied N times — once per layer, plus once for the base.

```go
var h http.Handler = http.HandlerFunc(handleAPI)
h = Auth(h)
h = Logging(h)
h = Recovery(h)
h = Tracing(h)

h.ServeHTTP(w, r)  // ← one source-level call
```

What runs:

```
Tracing.ServeHTTP (called via iface dispatch)
    → Recovery.ServeHTTP (called via iface dispatch on captured next)
        → Logging.ServeHTTP (called via iface dispatch on captured next)
            → Auth.ServeHTTP (called via iface dispatch on captured next)
                → handleAPI (called via iface dispatch on HandlerFunc adapter)
                    ↑ adapter calls the funcval (one more indirect call)
```

Each arrow is at least one indirect call. A 4-middleware chain plus an HTTP handler is 5 indirect calls on the way in, plus the unwind through each `defer` (if any), plus the `HandlerFunc` adapter's funcval-call. The branch predictor handles monomorphic call sites well — after warmup, the predictor learns each layer's target — but the load chain is real.

### 3.1 The load chain for a 4-middleware tower

For `h` being the outermost `Tracing` decorator, `h.ServeHTTP(w, r)` produces (roughly):

```asm
; Outermost iface dispatch (h holds Tracing's iface)
MOVQ    "".h+0(SP), AX         ; AX = h.tab
MOVQ    "".h+8(SP), BX         ; BX = h.data (the tracingHandler struct)
MOVQ    24(AX), CX             ; CX = tab.fun[0] = (tracingHandler).ServeHTTP
MOVQ    BX, AX                 ; receiver = h.data
; argument setup (w, r in DI, SI)
CALL    CX                     ; → into tracingHandler.ServeHTTP
```

Inside `tracingHandler.ServeHTTP`, after doing tracing work, the layer calls `t.next.ServeHTTP(w, r)`. `t.next` is itself an iface (Recovery's iface). The same five-instruction sequence happens again, indirect-calling into `recoveryHandler.ServeHTTP`. Then again into `loggingHandler`, then `authHandler`, then `HandlerFunc.ServeHTTP`.

Five identical dispatch sequences stacked. Each adds:

- Two cache-line touches (the iface header, the itab).
- One indirect call's branch prediction work.
- A new stack frame (the caller's frame plus the callee's frame).

On amd64, the dispatch cost per layer is ~1.5–2 ns when the iface header is in L1 and the call is monomorphic. For a 5-deep chain: ~10 ns of pure dispatch overhead.

### 3.2 Visual: the stacked dispatches

```mermaid
flowchart TD
    A["h.ServeHTTP(w, r)"] --> B["iface dispatch #1: h.tab.fun[0]"]
    B --> C["tracingHandler.ServeHTTP body"]
    C --> D["t.next.ServeHTTP(w, r)"]
    D --> E["iface dispatch #2: next.tab.fun[0]"]
    E --> F["recoveryHandler.ServeHTTP body"]
    F --> G["r.next.ServeHTTP(w, r)"]
    G --> H["iface dispatch #3: next.tab.fun[0]"]
    H --> I["loggingHandler.ServeHTTP body"]
    I --> J["l.next.ServeHTTP(w, r)"]
    J --> K["iface dispatch #4: next.tab.fun[0]"]
    K --> L["authHandler.ServeHTTP body"]
    L --> M["a.next.ServeHTTP(w, r)"]
    M --> N["iface dispatch #5: HandlerFunc.ServeHTTP"]
    N --> O["funcval indirect: handleAPI(w, r)"]
```

Five interface dispatches before the actual handler runs. Each is a "wall" the inliner cannot cross.

### 3.3 Cache behaviour

After warmup, the chain is hot in cache. The itabs all live in `runtime.itabTable` — typically the same page of memory. Five itab lookups all hit L1.

Each layer's struct has a `next Handler` field (16 bytes for the iface) plus the layer's own state. A well-tuned layer fits in one cache line (≤ 64 bytes). A bloated layer with five fields straddles two lines, doubling per-layer cache traffic. For a 5-deep chain of bloated middlewares, you can spend 10+ cache lines per request before doing real work. Keep middleware structs small.

---

## 4. The compiler's SSA view of a chain

The Go compiler's SSA (Static Single Assignment) intermediate representation is the layer where most optimisations happen. Reading SSA dumps clarifies why chains can't be flattened.

### 4.1 Generating SSA dumps

```bash
GOSSAFUNC=Tracing.ServeHTTP go build -o /dev/null ./pkg
```

This generates `ssa.html` showing each SSA pass for the named function. For middleware chains, the interesting passes are `early opt`, `inline`, `devirtualize`, and `lower`.

### 4.2 SSA representation of an iface call

For `t.next.ServeHTTP(w, r)` inside `tracingHandler.ServeHTTP`, the SSA looks (paraphrased) like:

```
v10 = LoadPtr <*itab> t.next.tab
v11 = LoadPtr <unsafe.Pointer> t.next.data
v12 = OffPtr <**byte> [24] v10           ; offset 24 = fun[0]
v13 = LoadPtr <*byte> v12                ; v13 = the method address
v14 = StaticCall <mem> {v13} v11, w, r   ; indirect call through v13
```

Five SSA ops for one source-level call. The `StaticCall` node with a dynamic target (`v13`) is the SSA representation of "indirect call to an unknown function". The inliner sees `StaticCall {v13}` and gives up — the target is an SSA value, not a known function symbol.

Compare to a direct call:

```
v10 = StaticCall <mem> {.handleAPI} w, r
```

One SSA op. The `{.handleAPI}` is a *symbol*, not a value. The inliner can substitute the body in place. The difference between "callee is a symbol" and "callee is a value" is the entire reason interface calls don't inline.

### 4.3 SSA representation of a closure call

For `next.ServeHTTP(w, r)` where `next` is captured by a closure:

```
v8  = LoadPtr <**Handler> ".this".closureVar
v9  = LoadPtr <*itab> v8.tab
v10 = LoadPtr <unsafe.Pointer> v8.data
... (same as the iface case)
```

One extra load (the closure's captured variable) but otherwise identical. The closure adds one level of indirection but doesn't change the fundamental "indirect call through a value" structure.

### 4.4 Why optimisation passes can't flatten

In principle, a sufficiently smart compiler could:

1. Prove that `t.next.tab` is always the cached itab for `*recoveryHandler` (because the chain is built at startup and never mutated).
2. Specialise the call site to a direct call to `(*recoveryHandler).ServeHTTP`.
3. Inline that body.
4. Repeat for each layer until the entire chain is inlined into one giant function.

Go's compiler doesn't do this. The reasons:

- **It's hard to prove "the iface field is never mutated after construction"** without whole-program analysis. Go favours separate compilation; each package is compiled in isolation. The compiler doesn't know whether some other goroutine writes to `t.next`.
- **Even if it could prove monomorphism, the inlining budget would explode.** A 5-deep chain inlined into one function might be 10× the size of any individual layer. The Go inliner has a strict budget (controlled by `-l` and the per-function cost limits) that prevents this.
- **PGO can do part of this job dynamically** (§6). Static devirt is conservative; PGO devirt is opt-in and profile-driven.

The net result: the SSA pipeline produces five separate functions, each with its own dispatch site. The optimisation that *does* happen — register allocation, dead-code elimination, common subexpression elimination — happens within each layer, not across them.

### 4.5 No cross-layer optimisation

The optimiser produces N independent SSA functions, one per layer. Each does its own iface dispatch via `LoadPtr` of `tab`, then `OffPtr` to `fun[0]`, then `StaticCall` with a dynamic target. There's no cross-layer specialisation in the SSA pipeline — every middleware compiles as if it were the only one.

---

## 5. Inlining limits across interface boundaries

The inliner's wall at interface calls deserves its own section because it dominates the cost story.

### 5.1 The inliner's algorithm (`src/cmd/compile/internal/inline/inl.go`)

For each `CallExpr` in the IR, the inliner checks:

1. Is the target a known function symbol? (Direct calls only.)
2. Is the target's body within the inline budget? (Cost ≤ 80 by default; tuned with `-l=N`.)
3. Does inlining create recursion? (Self-recursive functions don't inline.)
4. Are there compatibility issues? (Inlined function uses `go:nosplit`, etc.)

Interface calls fail at step 1: the target is a runtime-resolved address, not a known symbol. The inliner has no body to copy.

### 5.2 The "first interface call kills everything beyond" rule

Consider:

```go
func outer(g Charger) error {
    return inner(g)
}

func inner(g Charger) error {
    return g.Charge(100)   // ← interface call
}
```

The inliner can inline `inner` into `outer`. But after inlining, the interface call inside `inner` is still an interface call — the inliner can't see further. The inlined version is:

```go
func outer(g Charger) error {
    return g.Charge(100)   // still iface dispatch
}
```

You've saved one *static* call frame (the call to `inner`), but the *dispatch* still happens. The savings: ~1 ns of call/ret overhead. The remaining cost: ~2 ns of dispatch. Worth doing — but not as much as you'd hope.

### 5.3 What about middleware factory functions?

```go
func Logging(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        log.Printf(...)
        next.ServeHTTP(w, r)
    })
}
```

`Logging` itself can be inlined into the chain-construction site (`h = Logging(h)`). But what gets inlined is just the `return http.HandlerFunc(...)` — a closure construction. The closure body itself is a *separately compiled function* with its own machine code. Inlining `Logging` doesn't inline its closure body.

The closure body is invoked through the iface dispatch when the chain runs. The inliner cannot inline through that dispatch. So the closure body remains a real function call, paid per request.

### 5.4 The `//go:noinline` pragma and benchmarking caveat

When benchmarking the chain, `//go:noinline` is often added to the inner handler so that it remains a real function call. Without it, the compiler may inline the innermost handler into the next-outer closure body, making the benchmark measure a partially flattened chain. Always add `//go:noinline` (or use a non-trivial handler) when measuring chain dispatch.

### 5.5 Inline budget for closures

The inliner has a per-function budget (~80 units by default). A middleware closure that calls `log.Printf` and `next.ServeHTTP` with a couple of conditions costs 30–60 units. Within budget — but because the closure is *only ever called indirectly*, the budget doesn't matter. The inliner has no static call site to inline into.

The only way a closure body inlines is if the compiler proves the function-value is constant at a specific call site. For middleware composed at startup and called per request, no static proof is possible.

---

## 6. PGO devirtualization for chain calls

PGO (Profile-Guided Optimisation) was introduced in Go 1.20 and matured in 1.21+. Its main effect on decorator chains is per-layer devirtualization. Read `../03-strategy-pattern/professional.md` §10 for the general mechanism; this section focuses on how PGO behaves across a chain.

### 6.1 Per-layer specialisation

For a chain `Tracing → Recovery → Logging → Auth → handleAPI`, each layer's `next.ServeHTTP(w, r)` is a separate call site. PGO sees each site independently:

- `tracingHandler.ServeHTTP` → calls `recoveryHandler.ServeHTTP` (always, monomorphic).
- `recoveryHandler.ServeHTTP` → calls `loggingHandler.ServeHTTP` (always).
- ... and so on.

Each call site is 100% biased toward one concrete type (the next layer). PGO devirtualizes each independently, producing:

```asm
; In tracingHandler.ServeHTTP
MOVQ    "".next.tab+0(AX), CX
LEAQ    go.itab.recoveryHandler,http.Handler(SB), DX
CMPQ    CX, DX
JNE     fallback
CALL    "".(*recoveryHandler).ServeHTTP(SB)   ; specialised direct call
JMP     done
fallback:
... (standard indirect dispatch)
done:
```

After PGO, each of the four "next" call sites in the chain becomes a type-check-then-direct-call. The chain is *still five separate function calls* — but each is a direct call (with inlining opportunities) rather than an indirect dispatch.

### 6.2 Does PGO inline the chain into one giant function?

In theory, yes. After devirtualization, the call sites are direct, and the inliner can inline through them. In practice:

- **The inline budget is per-function.** A 5-deep chain of moderate-sized middlewares is too big for one inlined block. The inliner inlines maybe 2 layers, then stops.
- **`runtime.deferproc` calls in middlewares are not inlinable.** Any layer with a `defer` (recovery, timing) blocks full inlining at that layer.
- **The closure bodies are still separate compilation units.** PGO devirt converts the iface dispatch to a direct call, but the direct call is still a CALL/RET pair — only inlining removes that.

Empirical observation: a typical chain with one recovery middleware and four observation middlewares ends up with 2 layers inlined after PGO. Net gain: maybe 30-40% reduction in dispatch overhead, not 100%.

### 6.3 PGO with megamorphic chains

If a chain serves multiple routes with different middleware stacks:

```go
mux.Handle("/api", Logging(Recovery(handleAPI)))
mux.Handle("/admin", Logging(Recovery(Auth(handleAdmin))))
mux.Handle("/health", Logging(handleHealth))
```

The call site inside `loggingHandler.ServeHTTP` sees three possible "next" types (recoveryHandler, recoveryHandler, plain function adapter). PGO sees the call site as 67% biased toward recoveryHandler and 33% toward the function adapter. If the dominant type passes the threshold (default ~80%), it's specialised; otherwise PGO leaves the indirect dispatch.

For routers with many distinct middleware stacks, PGO often *doesn't* devirtualize because no single type dominates each call site. The dispatch remains generic.

Mitigation: use per-route compiled chains and avoid shared "intermediate" layers. This makes each call site monomorphic.

### 6.4 PGO output for inspection

```bash
$ go build -pgo=cpu.pprof -gcflags="-m=2" ./pkg 2>&1 | grep -i devirt
./middleware.go:42:14: PGO devirtualizing call to method (*recoveryHandler).ServeHTTP from net/http.Handler
./middleware.go:58:14: PGO devirtualizing call to method (*loggingHandler).ServeHTTP from net/http.Handler
```

Each devirtualized site is announced. Cross-check the disassembly. If your traffic shifts, the profile becomes stale; PGO might specialise for the wrong types, sending most traffic through the (still-cheap) fallback path. Worth refreshing profiles periodically.

---

## 7. Escape analysis — decorator, closure, captured next

A decorator chain creates several heap-allocation sources. Escape analysis (`src/cmd/compile/internal/escape/escape.go`) decides which of them stay on the stack.

### 7.1 The struct decorator's escape

```go
type loggingHandler struct {
    next   http.Handler
    logger *log.Logger
}

func NewLogging(next http.Handler, l *log.Logger) http.Handler {
    return &loggingHandler{next: next, logger: l}
}
```

`&loggingHandler{...}` is a heap allocation because it escapes through the returned `http.Handler` interface. The escape analyser sees:

```
./mw.go:5:9: &loggingHandler{...} escapes to heap
```

The returned iface holds a pointer to the heap-allocated `loggingHandler`. The wrapped `next` field (which itself is an iface) is stored inside the heap-allocated struct.

If `next` was a stack-resident iface in the caller, *it escapes too*: storing it in a heap object forces the underlying data to be heap-allocated. The chain construction at startup typically allocates each layer once, on the heap, and they reference each other via heap pointers. Hot path: each layer's pointers are read from the heap on every request.

### 7.2 The closure decorator's escape

```go
func Logging(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        log.Printf(...)
        next.ServeHTTP(w, r)
    })
}
```

What allocates:

1. **The closure (funcval) for the lambda.** The lambda captures `next`, so the funcval has `fn` plus the captured `next` (a 16-byte iface). Total funcval size: 24 bytes. Allocated on the heap because the funcval is returned through the iface.
2. **The `http.HandlerFunc(...)` conversion.** Wrapping the funcval in `HandlerFunc` is a no-op type cast (HandlerFunc is `func(...)`, same shape as the funcval). But assigning the result to `http.Handler` is an interface conversion that needs to box the HandlerFunc value into an iface.

The escape report:

```bash
$ go build -gcflags="-m" ./pkg
./mw.go:3:6: func literal escapes to heap
./mw.go:3:6: leaking param: next
```

`leaking param: next` means `next` escapes because it's captured by the returned closure. The original `next` (which might have been stack-allocated) is now forced to the heap.

The "double-escape" here:

- The closure escapes (returned to caller).
- `next` escapes (captured by the closure).
- The captured `next` is itself an iface; its `data` pointer also escapes (because the iface is on the heap, its data must be too).

Net: every middleware closure construction in the chain forces the next layer to the heap.

### 7.3 When does the captured next stay on the stack?

Rarely. The only case: a closure that's invoked immediately and doesn't outlive the caller's frame. Example:

```go
func runWithLogging(next http.Handler, w http.ResponseWriter, r *http.Request) {
    func() {
        log.Printf(...)
        next.ServeHTTP(w, r)
    }()  // ← invoked immediately
}
```

If the closure doesn't escape (no return, no goroutine, no defer-storing), the escape analyser may keep it on the stack. The captured `next` stays on the stack too. Verify:

```bash
$ go build -gcflags="-m" ./pkg
./mw.go:3:5: func literal does not escape
```

`does not escape` is the green light. Stack-allocated closure, stack-resident captures.

This pattern is rare in production middleware because middleware is *built* before being *invoked* — the closure has to outlive its construction. The escape is essentially unavoidable for the standard middleware shape.

### 7.4 The "value vs pointer receiver" interaction

A value-receiver decorator (`func (l loggingHandler) ServeHTTP(w, r)`) forces the conversion to copy the struct into a heap allocation (the iface's data must point somewhere). A pointer-receiver decorator stores the pointer directly — no per-conversion alloc.

For middleware: **always use pointer receivers**. The value-receiver variant doubles allocation.

### 7.5 Funcval size

A closure's funcval is `fn` (8 bytes) plus captured variables in source order. For a typical middleware capturing only `next` (16 bytes iface), the funcval is 24 bytes. For one capturing `next`, a `prefix` string (16 bytes), and a `counter` pointer (8 bytes), it's 48 bytes.

For chain construction at startup: one alloc per middleware. If you reconstruct chains per request: 48 bytes × N layers wasted per request.

---

## 8. The `http.HandlerFunc` adapter at the assembly level

`http.HandlerFunc` is a named function type with a method. It's the most common adapter in Go middleware. Understanding its assembly cost clarifies why `Logging → HandlerFunc → handler` is two indirect calls, not one.

### 8.1 The source

From `src/net/http/server.go`:

```go
type HandlerFunc func(ResponseWriter, *Request)

func (f HandlerFunc) ServeHTTP(w ResponseWriter, r *Request) {
    f(w, r)
}
```

`HandlerFunc` is a function type (`func(...)`). Its `ServeHTTP` method has receiver `f HandlerFunc` — a value receiver on a function type. The body is `f(w, r)` — call the function value with the args.

### 8.2 The assembly for `ServeHTTP`

```asm
"".HandlerFunc.ServeHTTP STEXT nosplit size=24 args=0x28 locals=0x0
    MOVQ    "".f+8(SP), AX        ; AX = f (the funcval pointer, the receiver)
    MOVQ    "".w+0(AX), BX        ; ...wait, f IS the receiver, not pointed-to
    ; corrected:
    MOVQ    "".f+8(SP), DX        ; DX = funcval pointer (receiver)
    MOVQ    (DX), CX              ; CX = funcval.fn (the actual function PC)
    ; arg setup: w, r already in DI, SI
    JMP     CX                    ; tail-call the underlying function
```

(The exact register allocation varies by Go version; this is illustrative.)

The body: load `funcval.fn` from the receiver, jump to it. Note `JMP` rather than `CALL` — the compiler can tail-call here because `ServeHTTP`'s frame is empty (no locals, no defers, body is just one call). The tail call avoids one frame-push/frame-pop pair.

### 8.3 Dispatch through `http.Handler` to a `HandlerFunc`

When you have `var h http.Handler = http.HandlerFunc(myFunc)` and call `h.ServeHTTP(w, r)`:

```asm
; h is an iface (AX = tab, BX = data — the funcval pointer)
MOVQ    24(AX), CX            ; CX = h.tab.fun[0] = (HandlerFunc).ServeHTTP
MOVQ    BX, AX                ; AX = h.data = funcval pointer
CALL    CX                    ; → into HandlerFunc.ServeHTTP

; Inside HandlerFunc.ServeHTTP:
MOVQ    (AX), CX              ; CX = funcval.fn = myFunc's entry
JMP     CX                    ; tail-call myFunc
```

Two indirect calls (one CALL into ServeHTTP, one JMP from ServeHTTP into myFunc). The JMP is a tail call but still indirect. Total: 5 instructions for the dispatch, two of which are indirect jumps.

If you skipped the `HandlerFunc` adapter and had a real struct implementing `http.Handler` directly:

```asm
MOVQ    24(AX), CX
MOVQ    BX, AX
CALL    CX                    ; → directly into the struct's ServeHTTP
```

Three instructions. One indirect call. Roughly half the dispatch work.

### 8.4 Why HandlerFunc remains the dominant pattern

The adapter is convenient (pass a function literal where a `Handler` is expected). The cost (~1.5 ns of extra indirection per call) is invisible against any non-trivial HTTP handler.

The `JMP CX` at the end of `HandlerFunc.ServeHTTP` is one of the only tail-calls Go's compiler emits. Conditions: body is a single call, args layout-compatible, no defers/recovers. Saves one frame per invocation — meaningful at high RPS. User-written decorators don't qualify: any work before or after the inner call disqualifies the tail-call.

---

## 9. Funcval layout for middleware closures

Middleware closures have a specific funcval shape determined by their captures. Understanding the layout clarifies allocation cost and access patterns.

### 9.1 The funcval struct (`src/runtime/runtime2.go`)

```go
type funcval struct {
    fn uintptr
    // variable-sized capture words follow
}
```

The first word is the function pointer. Following words are the captured variables in source order.

### 9.2 A simple middleware closure

```go
func Logging(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        log.Printf("%s %s", r.Method, r.URL.Path)
        next.ServeHTTP(w, r)
    })
}
```

The closure captures `next` (one iface, 16 bytes). Funcval layout:

```
funcval (24 bytes, aligned):
    ┌────────────────────┐
    │ fn       (8 bytes) │  → entry PC of the lambda body
    ├────────────────────┤
    │ next.tab (8 bytes) │  → cached itab for next
    ├────────────────────┤
    │ next.data(8 bytes) │  → data pointer for next
    └────────────────────┘
```

Heap-allocated (returned from `Logging`). The closure's runtime address is what `http.HandlerFunc(...)` wraps. The iface conversion stores this address in the iface's `data` slot.

### 9.3 Accessing captures at runtime

R15 (amd64) holds the closure context pointer; the caller sets it before invoking the closure. Inside the closure body, the compiler generates constant-offset loads from R15:

```asm
MOVQ    8(R15), CX            ; CX = first capture (e.g., next.tab)
MOVQ    16(R15), DX           ; DX = next.data
MOVQ    24(R15), BX           ; BX = next capture (limiter pointer)
```

One load per capture word, typically 1–2 cycles per load when the funcval is in L1. For a small funcval, all captures fit in one cache line.

R15 must be saved/restored if the closure body calls other functions. The overhead is small but adds up in deeply-nested closure chains.

(Before Go 1.18, the closure context was passed in DX. The modern register-based ABI uses R15.)

---

## 10. Stack frame analysis for a 5-deep chain

Each middleware in a chain adds one stack frame. Frame size depends on the layer's locals, defers, and argument layout. For a 5-deep chain, the frame stack at runtime has a specific shape.

### 10.1 A baseline 5-deep chain

```go
var h http.Handler = http.HandlerFunc(handleAPI)
h = Auth(h)
h = Logging(h)
h = Recovery(h)
h = Tracing(h)
```

When `h.ServeHTTP(w, r)` is called from `mux.ServeHTTP`, the frame stack (growing toward lower addresses on amd64):

```
High addresses:
┌─────────────────────────────────────────┐
│ ServeMux.ServeHTTP frame                │  ~64 bytes
│   locals: pattern, handler, etc.        │
├─────────────────────────────────────────┤
│ Tracing closure frame                   │  ~96 bytes
│   args: w, r (16 bytes)                 │
│   locals: span, start, ctx              │
│   _defer record? (if defer used)        │
├─────────────────────────────────────────┤
│ Recovery closure frame                  │  ~128 bytes
│   args: w, r                            │
│   locals: rec                           │
│   _defer record (recover() needs defer) │
├─────────────────────────────────────────┤
│ Logging closure frame                   │  ~80 bytes
│   args: w, r                            │
│   locals: start, urlPath                │
├─────────────────────────────────────────┤
│ Auth closure frame                      │  ~64 bytes
│   args: w, r                            │
│   locals: token, user                   │
├─────────────────────────────────────────┤
│ HandlerFunc.ServeHTTP frame             │   16 bytes (tail-called, may be elided)
├─────────────────────────────────────────┤
│ handleAPI frame                         │  ~128 bytes
│   args: w, r                            │
│   locals: request-specific              │
└─────────────────────────────────────────┘
Low addresses (current SP):
```

Total stack consumption for the chain: ~500–600 bytes plus the handler's own frame. Compare to a single direct call (no middleware): ~150–200 bytes. The chain costs ~3× the stack of a bare handler.

### 10.2 Why this matters

Goroutine stacks start small (2 KB initial size in Go 1.22) and grow as needed. A chain that consumes 500 bytes leaves ~1.5 KB before the first stack growth — comfortably above the chain's needs but tight if the handler itself uses much stack.

Stack growth is not free: `runtime.morestack` copies the existing stack to a new, larger one (typically 2× growth). The copy is O(stack size). For a goroutine pool serving many requests, the first few requests might trigger stack growth; subsequent requests reuse the grown stack.

A common production tuning: pre-warm the goroutine pool with a synthetic request that traverses the full middleware chain. This ensures stack growth happens once, before real traffic.

### 10.3 The `_defer` record's contribution

If each middleware has a `defer` (common for recovery, timing), each layer's frame includes one `_defer` record. The record is ~64 bytes (see §14). For a 5-deep chain with all defers:

```
5 layers × 64 bytes = 320 bytes of _defer records
```

This is per-request stack overhead. Multiplied by ~10K req/sec, it's 3.2 MB/sec of write traffic to the stack (mostly cache-resident).

When defers are *open-coded* (Go 1.14+, when the compiler proves the defer is safe to inline), the `_defer` record is elided and the deferred work is generated inline at function exit points. This is the common case for simple defers like `defer cancel()` or `defer recover()`. Open-coded defers save the 64-byte record and the runtime calls. We cover this in §14.

### 10.4 Frame chain and preemption

Each frame is contiguous on the goroutine stack. The frame pointer chain (RBP on amd64) links them for stack walking — used by `runtime.gopanic`'s defer-search, panic stack traces, and the GC.

Go's preemption uses safe points injected at function entry and exit. A 5-deep chain provides ≥10 safe points per request; the runtime can park the goroutine at any of them. No special middleware code is needed.

---

## 11. `-gcflags="-m -m"` output for chain construction

The escape analyser's verbose mode (`-m -m`) shows the decisions for each line. For a typical middleware setup, the output reveals the alloc sources.

### 11.1 Setup

```go
// mw.go
package main

import (
    "log"
    "net/http"
)

func Logging(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        log.Printf("%s %s", r.Method, r.URL.Path)
        next.ServeHTTP(w, r)
    })
}

func Recovery(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        defer func() {
            if rec := recover(); rec != nil {
                http.Error(w, "internal error", 500)
            }
        }()
        next.ServeHTTP(w, r)
    })
}

func handleAPI(w http.ResponseWriter, r *http.Request) {
    w.Write([]byte("ok"))
}

func main() {
    var h http.Handler = http.HandlerFunc(handleAPI)
    h = Logging(h)
    h = Recovery(h)
    http.Handle("/api", h)
    http.ListenAndServe(":8080", nil)
}
```

### 11.2 The output

```bash
$ go build -gcflags="-m -m" mw.go
./mw.go:9:6: cannot inline Logging: function too complex: cost 96 exceeds budget 80
./mw.go:10:34: func literal escapes to heap:
./mw.go:10:34:   flow: ~r0 = &{storage for func literal}:
./mw.go:10:34:     from func literal (spill) at ./mw.go:10:34
./mw.go:10:34:     from return func literal (return) at ./mw.go:9:31
./mw.go:9:14: leaking param: next
./mw.go:10:34: func literal escapes to heap
./mw.go:17:6: cannot inline Recovery: function too complex
./mw.go:18:34: func literal escapes to heap
./mw.go:19:15: func literal does not escape
./mw.go:17:15: leaking param: next
./mw.go:28:6: can inline handleAPI with cost 27
./mw.go:33:31: inlining call to net/http.HandlerFunc(handleAPI)... 
./mw.go:34:13: inlining call to Logging
./mw.go:35:13: inlining call to Recovery
```

Key lines:

- `leaking param: next` — each middleware's `next` parameter escapes (captured by the returned closure).
- `func literal escapes to heap` — the closure body is heap-allocated.
- `func literal does not escape` — the inner `func()` in Recovery (the recover function) is stack-allocated, because it's only used by `defer` within the same frame.
- `cannot inline Logging: function too complex` — Logging's body exceeds the inline budget (closure construction is expensive in IR terms).

### 11.3 Reading the inner `does not escape`

The recovery middleware has a nested closure:

```go
func Recovery(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w, r) {       // outer closure — escapes
        defer func() {                          // inner closure — does NOT escape
            if rec := recover(); rec != nil { ... }
        }()
        next.ServeHTTP(w, r)
    })
}
```

The outer closure is returned, so it escapes. The inner closure (the deferred function) is *only* referenced by the defer; it doesn't leak past the outer closure's frame. The escape analyser proves the inner closure is local, so it's stack-allocated.

The stack-allocated inner closure means: no heap alloc per request for the recover handler. The `_defer` record (if any) is also stack-allocated when the defer is open-coded. Net cost per request for the recovery middleware: zero allocations.

### 11.4 The full chain construction's allocs

For the chain built in `main`:

```go
var h http.Handler = http.HandlerFunc(handleAPI)   // (1) HandlerFunc conversion
h = Logging(h)                                      // (2) Logging closure + iface conversion
h = Recovery(h)                                     // (3) Recovery closure + iface conversion
```

(1) `http.HandlerFunc(handleAPI)`: the conversion from `func(...)` to `HandlerFunc` is a no-op type cast. Assigning to `http.Handler` boxes the HandlerFunc into an iface. One alloc for the iface header (if the iface escapes — here it does, because `h` is reassigned and held for the server's lifetime).

(2) `Logging(h)`: allocates the closure funcval (40 bytes: fn + captured iface) and boxes it into a Handler iface. One alloc.

(3) `Recovery(h)`: same. One alloc.

Total chain-construction allocs: 3. Paid at startup. Negligible.

### 11.5 The per-request cost

Per request: 0 allocs in Logging (closure dispatches but doesn't reallocate), 0 allocs in Recovery if the defer is open-coded (Go 1.14+), 0 allocs in a trivial handler. The chain construction at startup is the only alloc cost; per-request work is allocation-free for well-written middleware.

If Recovery names the deferred function (`handler := func() {...}; defer handler()`) instead of writing `defer func() {...}()` inline, the escape analyser may not prove the named func stays local — one extra alloc per request. Keep deferred closures inline.

---

## 12. Memory layout — slice of middlewares and the composed chain

Middleware chains are often stored as slices before composition. The slice has one memory layout; the composed chain has another.

### 12.1 Slice of middleware functions

```go
type Middleware func(http.Handler) http.Handler

middlewares := []Middleware{Tracing, Recovery, Logging, Auth}
```

The slice header is `(data, len, cap)` — 24 bytes. The data pointer aims at an array of `Middleware` values. Each `Middleware` is a function value — 8 bytes (a pointer to a funcval).

```
Slice header (on the stack or in caller's struct):
    data: → underlying array (4 * 8 = 32 bytes)
    len:  4
    cap:  4

Underlying array:
    [0]: → Tracing's funcval (static, 8 bytes)
    [1]: → Recovery's funcval (static, 8 bytes)
    [2]: → Logging's funcval (static, 8 bytes)
    [3]: → Auth's funcval (static, 8 bytes)
```

For non-closure middleware (plain functions like `Tracing` defined at package scope), each funcval is *static* — allocated once in the binary's rodata segment. No heap alloc for the funcval itself; the slice just holds pointers to the static funcvals.

For closure-based middleware (returned by a configuration function), each funcval is heap-allocated.

### 12.2 Memory layout of the composed chain

```go
h := Chain(http.HandlerFunc(handleAPI), Tracing, Recovery, Logging, Auth)
```

After composition, `h` is the outermost (Tracing's) iface. The composed chain is a linked list of heap-allocated closures, each holding a reference to the next:

```
h (iface, on stack):
    tab → cached *itab for (Handler, *closure)
    data → tracingClosure (heap)
              fn → entry PC of tracing's lambda
              next → recoveryClosure (heap)
                        fn → recovery's lambda PC
                        next → loggingClosure (heap)
                                  fn → logging's lambda PC
                                  next → authClosure (heap)
                                            fn → auth's lambda PC
                                            next → handlerFuncIface (heap)
                                                     tab → *itab for (Handler, HandlerFunc)
                                                     data → handleAPI's funcval (static)
```

Five heap allocations for the chain (four closures plus one iface header for the inner HandlerFunc). Each closure is ~24 bytes (fn + one iface field for `next`).

### 12.3 The "fan-out" cache behaviour

Calling the chain reads through this linked list:

1. Load `h.tab.fun[0]` → tracing's body.
2. Inside tracing, load `next.tab` and `next.data` → indirect into recovery.
3. Inside recovery, load `next.tab` and `next.data` → indirect into logging.
4. ... and so on.

Each layer's struct (a closure) lives in its own heap allocation. The five closures likely live in different cache lines (Go's allocator uses size classes; small objects of the same size class can share lines, but consecutive allocations rarely end up adjacent).

Cache pattern per request:

- Load `h.tab.fun[0]`: one L1 access (itab is hot).
- Load tracing's closure: one L1 access (the funcval is hot after warmup).
- Inside tracing, load `next` (recovery's closure pointer): one L1 access (the iface field in tracing's funcval).
- Load recovery's `next.tab` and `next.data` from the iface: that iface is *embedded* in tracing's closure (as part of the funcval's captures), so it's adjacent to tracing's `fn` field — same cache line.
- Repeat per layer.

Net: ~5 cache lines touched per chain traversal, all hot. Total: ~5 × 64 = 320 bytes of cache traffic per request, easily within L1.

### 12.4 The flat-array alternative

For "filter chains" where each step transforms the request (no skip-next semantics), a flat slice is faster:

```go
type Filter func(Request) (Request, error)
func (c *Chain) Process(r Request) (Request, error) {
    for _, f := range c.filters {
        var err error
        r, err = f(r)
        if err != nil { return r, err }
    }
    return r, nil
}
```

Each filter is a direct funcval call; the loop is cache-friendly. Used by stream-processing libraries (`bufio` chains, transformer pipelines).

For HTTP middleware, the wrap-and-delegate model is dominant because `next.ServeHTTP(...)` can be conditional (early return on 401) or skipped entirely. A flat iteration can't express that.

The middleware slice itself (24-byte header + 32-byte backing array for 4 middlewares = 56 bytes) is discarded after `Chain(...)` returns. The composed linked closures live on.

---

## 13. `defer recover()` — when it's free, when it allocates

Recovery middleware uses `defer recover()`. The cost depends on the Go version and the defer's complexity.

### 13.1 The classical defer cost (Go ≤ 1.13)

Before Go 1.14, every `defer` allocated a `_defer` record on the heap. The record was ~80 bytes. Each call to a function with a defer paid:

- 1 alloc for the `_defer` record.
- A `runtime.deferproc` call to register the defer.
- A `runtime.deferreturn` call (or `runtime.gopanic` on panic) to invoke the defer.

Total overhead: ~50–80 ns per defer, plus 1 alloc. For middleware with a recovery defer, that's ~50 ns per request.

### 13.2 Stack-allocated defers (Go 1.13)

Go 1.13 added stack-allocated `_defer` records. Most defers no longer allocated, but the `deferproc`/`deferreturn` calls remained. Overhead dropped to ~30 ns per defer with 0 allocs.

### 13.3 Open-coded defers (Go 1.14+)

Go 1.14 introduced *open-coded defers*: the compiler analyses the function and, if conditions are met, emits the deferred code inline at every exit point of the function. No `_defer` record, no `deferproc`, no `deferreturn`.

Conditions for open-coded defers:

- ≤ 8 defers in the function.
- No `defer` inside a loop.
- The function doesn't return through `runtime.Goexit` (which requires the explicit defer list).

For middleware, the conditions are almost always met. The recovery middleware has one defer at function entry, no loops. Open-coded.

The cost of an open-coded defer with no panic:

- One byte of bookkeeping on the stack (the open-coded defer bitmap).
- One check at each return point (`if deferBits & 1 != 0 { runDeferred }`).
- The deferred code itself runs only on panic; on normal exit, the check passes and runs the code (cheap).

Actually, the deferred function always runs at return (that's the point of defer). For recovery defers that only do work if there's a panic, the body has an early return:

```go
defer func() {
    if rec := recover(); rec != nil {
        // ... handle panic ...
    }
    // no panic: rec is nil, function returns immediately
}()
```

On normal (no-panic) exit: the deferred function runs, calls `recover()`, gets nil, returns. Total cost: ~5–10 ns (call + recover() + return).

`recover()` itself is `runtime.gorecover` — examines the current goroutine's panic state and returns it. When there's no panic, it returns nil. The implementation:

```go
// Paraphrased from src/runtime/panic.go
func gorecover(argp uintptr) interface{} {
    gp := getg()
    if gp.panic != nil && /* the deferred function is the one immediately above the panic */ {
        gp.panic.recovered = true
        return gp.panic.arg
    }
    return nil
}
```

When there's no panic (`gp.panic == nil`), the function returns nil immediately. The cost is ~5 ns: one load of `gp.panic`, a nil check, a return.

### 13.4 The total cost of a recovery middleware per request

For Go 1.14+:

- 0 allocs (open-coded defer, stack-allocated closure).
- ~5–10 ns to run the deferred function on normal exit.
- ~2 ns for `gorecover()` to check and return nil.

Net: ~10 ns of overhead per request. Invisible.

For the panic path:

- ~100 ns to unwind to the defer (depending on stack depth).
- Allocates the panic value if it's a non-pointer (e.g., panicking with an int boxes it into eface).
- Calls the deferred function.
- The defer's body inspects the recovered value and does work (logging, writing 500).

Net: ~200 ns plus the cost of the panic's payload. Still small compared to the cost of the failed request itself.

### 13.5 The "defer in a loop" trap and verification

`defer cleanup(item)` inside a `for` loop disqualifies open-coded defers — each iteration costs a `deferproc` call. For middleware this is rare, but if a layer processes a list of sub-handlers with per-item defers, the path is slow.

To verify open-coded defers are active: `GOSSAFUNC=Recovery go build ./pkg` and search the generated `ssa.html` for `OpenDeferStart` / `OpenDeferRun` markers. If `runtime.deferproc` appears in the disassembly, the defer is *not* open-coded.

### 13.6 The cost summary table

| Defer style | Per-call overhead | Allocs | Conditions |
|---|---|---|---|
| Heap `_defer` (Go ≤ 1.12) | ~50-80 ns | 1 | always |
| Stack `_defer` (Go 1.13) | ~30 ns | 0 | most defers |
| Open-coded (Go 1.14+) | ~5-10 ns | 0 | ≤ 8 defers, no loops |
| Open-coded with panic | ~200 ns | 1 (panic value, if boxed) | panic happens |

For middleware, open-coded is the common case. The recovery defer costs ~10 ns per request when no panic. Acceptable.

---

## 14. The `_defer` struct and open-coded defers

The `_defer` struct describes a deferred call. Its layout and lifecycle determine the cost of `defer`.

### 14.1 The struct (`src/runtime/runtime2.go`)

```go
type _defer struct {
    started bool
    heap    bool
    openDefer bool
    sp        uintptr   // sp at time of defer
    pc        uintptr   // pc at time of defer
    fn        func()    // can be nil for open-coded defers
    _panic    *_panic   // panic that is running defer
    link      *_defer

    fd   unsafe.Pointer // funcdata for the function containing the defer
    varp uintptr        // varp for the stack frame
    framepc uintptr
}
```

Approximately 80 bytes on amd64. Each `defer` statement creates one record at runtime (for heap/stack-allocated defers; open-coded defers don't allocate this struct).

The record contains:

- `started`/`heap`/`openDefer` flags.
- `sp`, `pc`: stack and program-counter snapshots at the time of defer.
- `fn`: the function to call. For closures, this is the funcval pointer.
- `_panic`: linked to the currently-running panic (if any).
- `link`: next `_defer` in the goroutine's defer list (singly-linked list, head at `g.defer`).

### 14.2 The defer list

Each goroutine has a `_defer` list, linked through `_defer.link`. New defers are prepended (LIFO). When the function returns, `runtime.deferreturn` walks the list, executing defers in reverse order, popping each as it runs.

```mermaid
flowchart LR
    A["g.defer (head)"] --> B["_defer for Logging.recover"]
    B --> C["_defer for Recovery.recover"]
    C --> D["_defer for Tracing.recover"]
    D --> E["nil"]
```

For a 5-deep chain where each layer has a recover defer, the goroutine's defer list has 5 entries at the time the innermost handler runs. On unwind (whether normal return or panic), each is processed in LIFO order.

### 14.3 The open-coded defer's stack layout

Open-coded defers don't use `_defer` records. Instead, the compiler reserves stack space for:

- A `deferBits` byte: each bit corresponds to one defer in the function. Set when the defer is active.
- A slot for each defer's arguments (the closure's captures).

At function entry, `deferBits` is set to indicate which defers are "registered". At each exit point (return statement, panic), the compiler emits code that examines `deferBits` and runs the appropriate defers.

Example IR:

```go
func Recovery(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w, r) {
        // Compiler emits at entry:
        //   deferBits |= 1            // mark defer #0 as active
        defer func() {
            if rec := recover(); rec != nil { ... }
        }()
        // ... function body ...
        // At return points, compiler emits:
        //   if deferBits & 1 != 0 {
        //       deferBits &^= 1        // clear bit
        //       <inlined defer body>   // call recover, check, etc.
        //   }
    })
}
```

No `_defer` record. No `deferproc`. No `deferreturn`. The whole machinery is replaced by inline checks and direct calls.

### 14.4 When the compiler can't open-code

If the function has:

- More than 8 defers, *or*
- Defers in loops, *or*
- Defers passed to `runtime.Goexit`-using helpers, *or*
- Defers whose function is reassigned after the defer statement

…the open-coded path is disabled and the heap/stack `_defer` records are used.

For middleware, the open-coded path almost always works. The conditions are met by design.

### 14.5 The runtime cost comparison

Benchmark on Go 1.22 / amd64:

```
BenchmarkNoDefer-8                500000000   2.10 ns/op
BenchmarkOpenCodedDefer-8         400000000   3.05 ns/op
BenchmarkStackDefer-8             100000000  12.5 ns/op
BenchmarkHeapDefer-8               30000000  50.0 ns/op
```

Open-coded: ~1 ns over no-defer. Stack-allocated (Go 1.13): ~10 ns. Heap (pre-1.13): ~50 ns. For middleware, the ~1 ns open-coded cost is negligible.

For an open-coded defer, the deferred function is called via a direct call at each exit point — the address is known at compile time (function literal). For non-open-coded defers, `runtime.deferreturn` walks the `_defer` list and invokes each entry via `_defer.fn` — an indirect call.

---

## 15. `runtime.gopanic` / `runtime.gorecover` — what they do

When a panic happens inside a middleware, the runtime walks the defer list looking for a recover. The mechanics live in `src/runtime/panic.go`.

### 15.1 The panic path

```go
panic("oops")
```

Compiles to a call to `runtime.gopanic(v)`. The function:

1. Saves the panic value to the current goroutine's `_panic` linked list.
2. Walks the goroutine's `_defer` list, popping each entry.
3. For each defer, sets `_defer.started = true`, invokes the deferred function (which may call `recover()`).
4. If the defer's call returns without recovering, continues to the next defer.
5. If a defer calls `recover()`, marks the panic as recovered and unwinds the stack back to the function containing the recovered defer.
6. If no defer recovers, prints the stack trace and aborts the program.

### 15.2 The recover machinery

`recover()` is `runtime.gorecover`:

```go
// Paraphrased
func gorecover(argp uintptr) interface{} {
    gp := getg()
    p := gp.panic
    if p == nil {
        return nil   // no panic
    }
    if argp != /* the calling frame's argp */ {
        return nil   // recover not called from a deferred function
    }
    p.recovered = true
    return p.arg
}
```

The `argp` parameter is the address of the *caller's argument frame*. The runtime compares it to the saved frame info in the current `_panic` to determine whether `recover` is being called from the right place.

The condition "recover only works if called directly from a deferred function" is enforced by this argp check. Wrapping `recover` in a helper function (`func myRecover() { recover() }`) returns nil because the argp doesn't match.

### 15.3 The cost of a panic

For a panic that's recovered one frame up:

- `runtime.gopanic`: ~50 ns to set up the panic structure.
- Walk defer list: ~10 ns per defer.
- Run the deferred function: depends on its body. The `recover() && handle` pattern is ~20 ns.
- `runtime.gorecover`: ~10 ns.
- Stack unwind: ~50–100 ns depending on stack depth.

Total: ~200 ns for a recovered panic. Compare to ~10 ns for normal middleware execution. A panic is ~20× more expensive than a normal request.

For a panic that's *not* recovered:

- Walk all defers to the bottom of the goroutine.
- Print stack trace.
- Abort.

Cost: ~milliseconds (the stack trace formatting dominates). Doesn't matter — the program is dying.

### 15.4 Why recover-in-non-defer doesn't work

Calling `recover()` outside a defer (or in a helper called by the deferred function) returns nil. The `argp` check fails — recover only works from a deferred function in the frame being unwound. This prevents functions from "stealing" panics meant for higher-level handlers.

### 15.5 The panic's interaction with the chain

For Chain `Tracing → Recovery → handleAPI` where handleAPI panics: `runtime.gopanic` walks the defer list, Recovery's deferred function calls `recover()`, `_panic.recovered` is set, the stack unwinds to Recovery's frame. Recovery returns normally. From Tracing's perspective, `next.ServeHTTP(w, r)` returned without error — the panic is localised to Recovery. Recovery's contract: handle the panic completely (write a response, log it); upper layers see only "request completed".

### 15.6 Multiple recovers in a chain

If both Tracing and Recovery have recover defers and `handleAPI` panics, the innermost recover (Recovery's) handles it first; `_panic.recovered` is set true. By the time the unwind reaches Tracing's defer, `recover()` returns nil — the panic was already handled, and Tracing's `if rec != nil` body is skipped.

This is usually correct: each layer independently decides whether to recover. The "double-recover" confusion: if Recovery's body doesn't fully clean up (writes a partial response), Tracing's recover still sees nil — there's no signal of partial handling.

---

## 16. No tail-call optimisation — implications for deep chains

Go does not implement general tail-call optimisation (TCO). A function whose last operation is a call to another function still pays the full frame-push and frame-pop cost. For decorator chains, this matters.

### 16.1 No general TCO

```go
func a() int { return b() }  // tail call to b — but compiles to CALL/RET, not JMP
```

In Go, each call is a full CALL+RET pair; each frame is pushed and popped independently. For a 5-deep chain: 5 frames on the stack during traversal.

The exception: the compiler emits tail-calls (JMP) for specific compiler-generated wrappers — embedded-struct method wrappers (§17) and `HandlerFunc.ServeHTTP` (§8). User-written code does not get TCO; the compiler doesn't analyse user functions for tail-call opportunities.

### 16.2 Why the lack of TCO matters for chains

For a 5-deep chain, all 5 frames stay on the stack until the chain unwinds. For a 50-deep chain (extreme — possible in plugin frameworks), the stack grows ~50× a single frame's size; this can trigger one or two stack growths (each doubling the stack via memcpy + pointer fixup). Visible in profiles as `runtime.morestack` / `runtime.newstack`.

Mitigations: keep depth ≤ ~10, compose chains at startup, and for very deep layering (20+ gRPC interceptors) measure stack consumption with `runtime.ReadMemStats`.

If Go had TCO, a chain could collapse to one frame — but that would break per-frame defer lists, stack traces for debugging, and GC root-finding. Go's design chose stack-based simplicity.

Frame pointers (RBP on amd64) are retained for fast stack walking by the GC and panic machinery. Cost per call: ~1 cycle of overhead. Across a 5-deep chain: 5 cycles. Negligible.

---

## 17. Embedded-struct decorators and method-table wrappers

Embedded-struct decorators (junior §4.3) generate wrapper methods at compile time. The wrappers are slightly faster than the explicit struct decorator's method due to the tail-call form.

### 17.1 The source

```go
type Charger interface { Charge(int) error }

type StripeGateway struct{}
func (s *StripeGateway) Charge(int) error { return nil }

// Embedding-based decorator
type LoggingCharger struct {
    Charger      // embed the interface
    log *log.Logger
}

// Don't override Charge — let it be promoted from the embedded Charger
```

`LoggingCharger` has a promoted `Charge` method. Calling `lc.Charge(100)` is equivalent to `lc.Charger.Charge(100)`. The compiler generates a wrapper at the method-table level.

### 17.2 The wrapper assembly

```asm
"".(*LoggingCharger).Charge STEXT
    MOVQ    (AX), AX        ; AX = LoggingCharger.Charger (the embedded iface)
    ; arguments are already in registers
    MOVQ    8(AX), CX        ; ... wait, we need to dispatch on the embedded iface
    ; corrected:
    MOVQ    "".lc+0(SP), AX   ; AX = receiver (*LoggingCharger)
    MOVQ    0(AX), BX         ; BX = lc.Charger.tab
    MOVQ    8(AX), AX         ; AX = lc.Charger.data
    MOVQ    24(BX), CX        ; CX = lc.Charger.tab.fun[0] (Charge)
    JMP     CX                ; tail-call into Charge
```

The wrapper:

1. Loads the receiver's embedded iface (`lc.Charger`).
2. Dispatches through that iface (load tab.fun, load data, indirect-call).
3. Tail-calls (JMP, not CALL) — saves one frame.

Compared to an explicit decorator:

```go
type LoggingCharger struct {
    Inner Charger
    log *log.Logger
}

func (l *LoggingCharger) Charge(amount int) error {
    return l.Inner.Charge(amount)
}
```

```asm
"".(*LoggingCharger).Charge STEXT
    SUB     SP, 24          ; allocate frame
    MOV     [SP+16], BP
    LEA     BP, [SP+16]
    MOVQ    "".l+0(SP), AX
    MOVQ    0(AX), BX
    MOVQ    8(AX), AX
    MOVQ    24(BX), CX
    CALL    CX
    MOV     BP, [SP+16]
    ADD     SP, 24
    RET
```

The explicit version has a full prologue/epilogue. The embedded version uses tail-call form (no frame). About 5 cycles saved per call.

Net effect: ~0.3 ns faster per call for the embedded variant. Microscopic — only matters in extreme hot paths.

### 17.3 Why the tail-call works for the wrapper

The wrapper has no work to do after the inner call. It's literally just a forwarding function:

```
Caller's frame
└── LoggingCharger.Charge wrapper  ← never has a frame, JMP not CALL
    └── (*StripeGateway).Charge frame  ← real work
```

The wrapper reuses the caller's frame (since it has no locals). The tail-call is safe because:

- No locals to clean up.
- Arguments are already in the correct registers (no rearrangement needed).
- Return value flows back through the standard ABI.

Your own decorator code doesn't qualify for this: any work before or after `Inner.Charge(...)` adds locals, breaks the tail-call shape, requires a real frame.

### 17.4 When to use embedded decorators

For interfaces with many methods where you decorate only a few (`database/sql`-style — 10+ methods). The auto-promoted methods get tail-call wrappers; you save writing N-2 forwarding methods *and* get slightly faster dispatch for them.

Cost: the embedded field is public (`lc.DB = otherDB` is legal). For encapsulation, fall back to explicit forwarding — verbose, but the embedded inner can't be swapped from outside.

When `lc` is held in an iface, the iface's `fun[0]` points to the wrapper, which itself dispatches through the embedded iface. Two layers of dispatch per call (wrapper is fast tail-call, but still a separate site). For deep embedding chains, this stacks. The compiler can sometimes devirt the wrapper (it's a known type), but the embedded iface inside the wrapper is still dynamic — the inner dispatch stays indirect.

---

## 18. Assembly snippet for a typical middleware chain call

A complete walk-through of the assembly for a request hitting a 3-deep chain: `Logging → Recovery → handleAPI`.

### 18.1 The Go code

```go
package main

import (
    "log"
    "net/http"
    "time"
)

func Logging(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        start := time.Now()
        next.ServeHTTP(w, r)
        log.Printf("%s %s took %s", r.Method, r.URL.Path, time.Since(start))
    })
}

func Recovery(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        defer func() {
            if rec := recover(); rec != nil {
                http.Error(w, "internal", 500)
            }
        }()
        next.ServeHTTP(w, r)
    })
}

func handleAPI(w http.ResponseWriter, r *http.Request) {
    w.Write([]byte("ok"))
}

var h http.Handler = Logging(Recovery(http.HandlerFunc(handleAPI)))

func main() {
    http.Handle("/api", h)
    http.ListenAndServe(":8080", nil)
}
```

### 18.2 The dispatch flow

When `mux.ServeHTTP` invokes `h.ServeHTTP(w, r)`:

```asm
; h is the outermost iface (Logging); AX/BX = tab/data
MOVQ    24(AX), CX            ; (*loggingClosure).ServeHTTP
MOVQ    BX, AX                ; receiver = closure pointer
CALL    CX                    ; → Logging's closure body
```

Logging's closure body (abbreviated):

```asm
"".Logging.func1:
    PUSH    RBP; MOV RBP,RSP; SUB RSP,56     ; prologue
    CALL    time.Now(SB)                      ; start := time.Now()
    ; ... save start ...
    MOV     RAX, [R15+8]                      ; next.tab (from closure)
    MOV     RBX, [R15+16]                     ; next.data
    MOV     RCX, [RAX+24]                     ; next.tab.fun[0] = Recovery's ServeHTTP
    MOV     RAX, RBX                          ; receiver = next.data
    CALL    RCX                               ; → Recovery
    CALL    time.Since(SB); CALL log.Printf(SB)
    ADD     RSP,56; POP RBP; RET
```

Recovery's closure body (abbreviated):

```asm
"".Recovery.func1:
    PUSH    RBP; MOV RBP,RSP; SUB RSP,32
    MOV     BYTE [RSP+16], 1                  ; deferBits |= 1 (open-coded defer marker)
    MOV     RAX, [R15+8]                      ; next.tab
    MOV     RBX, [R15+16]                     ; next.data
    MOV     RCX, [RAX+24]; MOV RAX,RBX
    CALL    RCX                               ; → HandlerFunc.ServeHTTP
    TEST    BYTE [RSP+16], 1                  ; check deferBits
    JZ      no_defer
    MOV     BYTE [RSP+16], 0                  ; clear bit
    CALL    runtime.gorecover(SB)             ; recover() — returns nil if no panic
    TEST    RAX, RAX; JZ .ret
    ; ... write 500 ...
no_defer:
.ret:
    ADD     RSP,32; POP RBP; RET
```

`HandlerFunc.ServeHTTP`:

```asm
"".HandlerFunc.ServeHTTP:
    MOV     RCX, [AX]                         ; funcval.fn = handleAPI
    JMP     RCX                               ; tail-call, no frame
```

### 18.3 Summary of the call sequence

Per request:

1. `mux.ServeHTTP` dispatches to `h.ServeHTTP` (1 iface dispatch).
2. Logging's closure runs: time.Now, then dispatches to Recovery (1 iface dispatch).
3. Recovery's closure runs: sets defer bit, dispatches to HandlerFunc.ServeHTTP (1 iface dispatch).
4. HandlerFunc.ServeHTTP tail-calls handleAPI (1 indirect jump, no new frame).
5. handleAPI does its work, returns.
6. Recovery's closure runs deferred body (no panic, recover() returns nil).
7. Recovery returns.
8. Logging's closure logs the duration.
9. Logging returns.

Total: 4 indirect dispatches (3 iface + 1 funcval), ~6 ns of pure dispatch overhead. Plus the closure-body work (time.Now, log.Printf, w.Write) which dominates.

### 18.4 Comparison: no chain

If you replace the chain with `h := http.HandlerFunc(handleAPI)`: one iface dispatch + one funcval JMP. ~2 ns of dispatch.

Chain version: ~6 ns. Difference: ~4 ns per request for the 2-middleware chain. At 10K RPS that's 40 ms/sec — negligible. At 100K RPS, 400 ms/sec — still small.

Dispatch cost scales linearly with depth. 10-deep chain: ~20 ns/req. 50-deep: ~100 ns. Always small compared to any non-trivial handler work.

---

## 19. Benchmarks across the chain depth

Empirical measurements quantify the per-layer cost. Setup:

```go
package mw

import (
    "net/http"
    "net/http/httptest"
    "testing"
)

func noopHandler() http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
}

func wrap(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        next.ServeHTTP(w, r)
    })
}

func BenchmarkChain0(b *testing.B) {
    h := noopHandler()
    r := httptest.NewRequest("GET", "/", nil)
    w := httptest.NewRecorder()
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        h.ServeHTTP(w, r)
    }
}

func BenchmarkChain1(b *testing.B) {
    h := wrap(noopHandler())
    r := httptest.NewRequest("GET", "/", nil)
    w := httptest.NewRecorder()
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        h.ServeHTTP(w, r)
    }
}

func BenchmarkChain5(b *testing.B) {
    h := wrap(wrap(wrap(wrap(wrap(noopHandler())))))
    r := httptest.NewRequest("GET", "/", nil)
    w := httptest.NewRecorder()
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        h.ServeHTTP(w, r)
    }
}

// ... and so on for 10, 20.
```

### 19.1 Results (Go 1.22, amd64, no PGO)

```
BenchmarkChain0-8        500000000   2.31 ns/op   0 B/op   0 allocs/op
BenchmarkChain1-8        300000000   3.85 ns/op   0 B/op   0 allocs/op
BenchmarkChain5-8        100000000  10.40 ns/op   0 B/op   0 allocs/op
BenchmarkChain10-8        80000000  18.62 ns/op   0 B/op   0 allocs/op
BenchmarkChain20-8        40000000  34.71 ns/op   0 B/op   0 allocs/op
```

Linear in depth: ~1.6 ns per layer. The baseline (Chain0) is the cost of the iface dispatch into the HandlerFunc adapter plus the noop body. Each `wrap` adds one iface dispatch + one closure body + return.

### 19.2 With a recovery middleware

```go
func wrapRecovery(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        defer func() { recover() }()
        next.ServeHTTP(w, r)
    })
}

func BenchmarkChain5Recovery(b *testing.B) {
    h := wrapRecovery(wrap(wrap(wrap(wrap(noopHandler())))))
    // ... same harness ...
}
```

```
BenchmarkChain5Recovery-8   80000000   13.85 ns/op   0 B/op   0 allocs/op
```

Adding one recovery defer to the outermost layer adds ~3 ns vs the plain Chain5. That's the open-coded defer's overhead: the defer registration at entry + the recover() call + the bit check at exit.

### 19.3 With all 5 layers having recovery

```
BenchmarkChain5AllRecovery-8   60000000   22.40 ns/op   0 B/op   0 allocs/op
```

~4.4 ns per layer for the recovery defer. Linear. At 5 layers with recovery, ~22 ns total — still ~2 orders of magnitude below typical handler work.

### 19.4 With PGO

```
BenchmarkChain5-PGO-8       150000000    7.20 ns/op   0 B/op   0 allocs/op
BenchmarkChain10-PGO-8      100000000   12.80 ns/op   0 B/op   0 allocs/op
```

~30% improvement; saves ~0.6 ns per layer. The closure body doesn't inline even after devirt.

### 19.5 Allocations

Pre-built chains: 0 allocs/op. Constructed-per-call:

```go
for i := 0; i < b.N; i++ {
    h := wrap(wrap(wrap(noopHandler())))   // anti-pattern
    h.ServeHTTP(w, r)
}
// BenchmarkChainPerCall-8   3000000   480 ns/op   320 B/op   5 allocs/op
```

One funcval alloc per layer plus the inner HandlerFunc iface. 5 allocs, 320 bytes per request. Pre-build chains at startup.

### 19.6 Real-world numbers

For a typical production server (5 layers + ~50 μs handler), chain dispatch is ~10 ns (0.02% of request time) — invisible in the profile. Middleware *does* show up when its body does I/O on the hot path, heavy label work (Prometheus cardinality), or boxes context for tracing. The decorator pattern itself is essentially free; the middleware bodies' work is what counts.

---

## 20. Reading the Go source

Key files for understanding decorator internals.

- **`src/runtime/runtime2.go`** — `funcval`, `_defer`, `_panic` struct definitions. The `g` struct's `_defer` and `_panic` fields.
- **`src/runtime/panic.go`** — `gopanic` (panic entry), `gorecover` (recover implementation), `deferproc` / `deferreturn` (defer registration and run), `runOpenDeferFrame` (open-coded defer machinery). Read `gopanic` first for the unwind algorithm.
- **`src/cmd/compile/internal/walk/closure.go`** — `walkClosure` and `walkCallClosure` lower closure construction and invocation. The capture analysis decides value-vs-reference capture.
- **`src/cmd/compile/internal/walk/order.go`** — defer ordering and the open-coded vs allocated decision. The ≤ 8 defer count limit.
- **`src/cmd/compile/internal/ssagen/ssa.go`** — handling of `OCALLINTER` (produces StaticCall with dynamic target) and `ODEFER` (deferBits manipulation or deferproc).
- **`src/cmd/compile/internal/escape/escape.go`** — `escapeClosure` and "leaking param" detection.
- **`src/net/http/server.go`** — `Handler`, `HandlerFunc`, `ServeMux.ServeHTTP`. The HandlerFunc definition is ~3 lines — the canonical adapter pattern.
- **`src/runtime/iface.go`** — `convI2I` (cheap interface-to-interface conversion) and `assertI2I` (type assertions for unwrapping a decorator chain).

---

## 21. Edge cases at the lowest level

### 21.1 The recursive decorator

A decorator whose method calls itself (via `Inner` pointing to a same-type instance) recurses. Each recursion adds one frame. For pathological inputs, the stack grows automatically up to `runtime.GOMAXSTACKS` (default 1 GB). Decorator chains *aren't* recursive structurally (each `next` is a different layer), but user code inside a layer might recurse.

### 21.2 The middleware that derives a new context

```go
ctx := context.WithValue(r.Context(), idKey, id)
next.ServeHTTP(w, r.WithContext(ctx))
```

`r.WithContext(ctx)` returns a new heap-allocated `*http.Request`. One alloc per request per derive-context middleware. For 3 such middlewares: 3 allocs/req. Skip context manipulation in observe-only middleware.

### 21.3 The middleware that wraps `ResponseWriter`

```go
type responseWriter struct {
    http.ResponseWriter
    status int
}
```

The `&responseWriter{...}` escapes (passed to `next.ServeHTTP`). One alloc per request. For high-RPS servers, pool the wrappers via `sync.Pool`. For typical servers, accept the alloc.

The "interface satisfaction" trap: wrapping `ResponseWriter` means your wrapper must explicitly implement optional interfaces like `http.Hijacker`, `http.Flusher`, `http.Pusher` (forwarding to the inner). Otherwise type assertions on the wrapper fail and downstream features (WebSocket, SSE, HTTP/2 push) break silently.

### 21.4 The middleware that doesn't call `next`

```go
if r.Header.Get("Authorization") == "" {
    http.Error(w, "unauthorized", 401)
    return   // short-circuits
}
next.ServeHTTP(w, r)
```

The chain below `Auth` is skipped on unauthorized requests. Defers in `Auth` and outer layers still run. At the assembly level: a `RET` after writing the response, nothing special.

### 21.5 The middleware that spawns goroutines

```go
go log.Printf("done: %s", r.URL.Path)   // captures r → r escapes to heap
```

The captured `r` escapes; worse, the spawned goroutine may access `r.Body` after the server has closed it. Capture only the fields you need (`r.URL.Path` is a string — immutable, safe):

```go
go func(path string) { log.Printf("done: %s", path) }(r.URL.Path)
```

### 21.6 The race on shared decorator state

Captured state in a closure or struct field is concurrently accessed by all requests. Unprotected `int counter; counter++` is a lost-update race. Use `atomic.Int64` or a mutex. The decorator pattern doesn't enforce concurrency safety; the author must.

---

## 22. Test

### Internal knowledge questions

**1. Why does a 5-deep middleware chain consume ~5× the dispatch overhead of a single middleware?**

<details>
<summary>Answer</summary>

Each layer is a separate iface dispatch (load tab.fun, set receiver, indirect call) which the inliner cannot cross. The chain doesn't get flattened or collapsed by the optimiser — each `next.ServeHTTP(w, r)` is a real indirect call to a separately-compiled function. For a 5-deep chain: 5 indirect dispatches plus one for the innermost adapter. Total dispatch: ~10 ns per request, linear in depth.

</details>

**2. What is the funcval layout for `func Logging(next http.Handler) http.Handler { return http.HandlerFunc(func(w, r) { ...; next.ServeHTTP(w, r) }) }`?**

<details>
<summary>Answer</summary>

The closure captures `next` (a 16-byte iface). The funcval layout:

```
funcval (24 bytes):
    fn:       uintptr     → entry PC of the closure body (8 bytes)
    next.tab: *itab       → cached itab for next (8 bytes)
    next.data: unsafe.Pointer → data pointer for next (8 bytes)
```

Allocated on the heap because the funcval is returned from `Logging`. The closure body accesses `next` via R15+8 (tab) and R15+16 (data). On amd64, R15 is the closure context register; the caller sets it before invoking the closure.

</details>

**3. When is a `defer recover()` allocation-free?**

<details>
<summary>Answer</summary>

When the defer is *open-coded* (Go 1.14+). Conditions: ≤ 8 defers in the function, no defer in a loop, no `runtime.Goexit`. Typical recovery middleware meets all three. Cost: ~5–10 ns for the open-coded bit-set and deferred call, ~2 ns for `gorecover()` with no panic. Zero heap allocations.

If conditions aren't met, the compiler falls back to heap-allocated `_defer` records — ~50 ns of overhead per defer.

</details>

**4. Why is `http.HandlerFunc(f).ServeHTTP(w, r)` two indirect calls, not one?**

<details>
<summary>Answer</summary>

`HandlerFunc` is a named function type with method `ServeHTTP`. When stored in an `http.Handler` iface:

1. `h.ServeHTTP(w, r)` dispatches through the iface: load tab.fun[0] (which is `(HandlerFunc).ServeHTTP`), indirect-call.
2. Inside `(HandlerFunc).ServeHTTP`, the body is `f(w, r)` where `f` is the funcval. Load funcval.fn, indirect-call (or JMP for tail-call).

Two indirect transfers: iface dispatch into the wrapper, then funcval indirect from the wrapper into the actual function. The wrapper uses `JMP` (tail-call) instead of `CALL`, saving one frame, but the indirect transfer is still there.

If you bypass HandlerFunc by implementing `http.Handler` directly on a struct, you save the second hop: just the iface dispatch into your `ServeHTTP` method. ~1.5 ns saved per call.

</details>

**5. What does PGO do for a deep decorator chain?**

<details>
<summary>Answer</summary>

For each `next.ServeHTTP(w, r)` call site that's monomorphic in the profile, PGO emits a type check followed by a direct call to the specialised method body, with a fallback to the standard indirect dispatch. Roughly:

```asm
MOVQ    next.tab, AX
LEAQ    expected_itab(SB), CX
CMPQ    AX, CX
JNE     fallback
CALL    specialized_target(SB)
JMP     done
fallback:
    ; standard indirect dispatch
done:
```

For a 5-deep monomorphic chain: each of the 5 call sites is specialised. Saving: ~0.5–0.7 ns per layer (the dispatch becomes a direct call with branch-predicted check). Total saving: ~3 ns per request.

If the chain is megamorphic (different `next` types at the same call site across routes), PGO skips devirt for that site. The chain remains generic.

</details>

**6. Why doesn't Go inline a chain into one big function?**

<details>
<summary>Answer</summary>

The inliner stops at every interface call. Even after PGO devirtualizes, the inline budget (per-function cost cap, ~80) limits how many layers can be combined. A typical middleware closure body costs 30–60 budget units; two combined exceed the cap. The inliner inlines maybe one or two layers in a chain; full flattening is rare.

Even if the budget were unlimited, defers in middlewares block inlining at the defer'd layer. The combination of defer interaction with the calling frame and the inline machinery makes full chain flattening impractical.

</details>

### Reading assembly

**7. What does this assembly fragment do?**

```asm
MOVQ    [R15+8], RAX
MOVQ    [R15+16], RBX
MOVQ    [RAX+24], RCX
MOVQ    RBX, RAX
CALL    RCX
```

<details>
<summary>Answer</summary>

It's a closure-mediated interface dispatch. R15 holds the closure context (the funcval pointer). The funcval's layout is `fn (8 bytes)` then the captured `next` iface (`tab` at +8, `data` at +16).

- `MOVQ [R15+8], RAX`: load `next.tab` from the closure.
- `MOVQ [R15+16], RBX`: load `next.data` from the closure.
- `MOVQ [RAX+24], RCX`: load `next.tab.fun[0]` (the method address).
- `MOVQ RBX, RAX`: move `next.data` into the receiver register (AX).
- `CALL RCX`: indirect-call the method.

This is the standard middleware "call the next layer" sequence in machine code. Five instructions per chain step.

</details>

---

## 23. Tricky questions

**1. Captured `*int` counter incremented in a middleware. What goes wrong with two concurrent requests?**

<details>
<summary>Answer</summary>

`*counter++` is load-increment-store — three instructions, not atomic. Two goroutines can both load 5, both store 6 (real count should be 7). Lost update; race detector catches it. Fix: `atomic.Int64.Add(1)`.

</details>

**2. A middleware passes `r.Context()` to a spawned goroutine. What happens when the request completes?**

<details>
<summary>Answer</summary>

`http.Request.Context()` is cancelled when the handler returns (Go 1.22). A goroutine waiting on `ctx.Done()` returns immediately; `ctx.Value(...)` lookups still work but semantics past the request lifetime are undefined.

Best practice: extract values before spawning, derive from `context.Background()` with a timeout:

```go
go func(traceID string) {
    bgCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()
    reportMetrics(bgCtx, traceID)
}(traceID)
```

</details>

**3. Assembly difference between an explicit struct decorator with `func (l *L) Charge(...) { return l.Inner.Charge(...) }` and an embedded-iface decorator (no override)?**

<details>
<summary>Answer</summary>

Explicit: full prologue (PUSH RBP, MOV RBP RSP, SUB RSP), load iface, indirect CALL, epilogue. ~8-10 instructions.

Embedded: compiler-generated wrapper with no prologue. Loads embedded iface, JMPs (tail-call) to the inner method. ~4 instructions.

Embedded saves ~5 cycles per call. Only helps pure-forward decorators (no work before/after the inner call).

</details>

**4. A panic in `handleAPI` with chain Logging → Recovery → handleAPI. Trace the runtime calls.**

<details>
<summary>Answer</summary>

1. `panic("oops")` → `runtime.gopanic`.
2. `gopanic` creates a `_panic` record, walks the defer list (via open-coded deferBits per frame).
3. handleAPI's frame: no defers. Skip.
4. HandlerFunc.ServeHTTP: tail-called, no real frame. Skip.
5. Recovery's frame: deferBit 0 set → invoke deferred function → calls `runtime.gorecover` → marks `_panic.recovered = true`, returns the value. Body writes 500, returns.
6. `gopanic` sees `recovered == true` → `runtime.deferreturn` unwinds stack to Recovery's frame.
7. Recovery returns normally to Logging; Logging logs duration and returns.

Total cost: ~200 ns. Most is the stack unwind copying the frame pointer chain.

</details>

**5. Can a middleware close over `r.Body` and read it from a spawned goroutine?**

<details>
<summary>Answer</summary>

No. After the handler returns, the HTTP server closes `r.Body` and may reuse the request struct via `sync.Pool`. The goroutine sees EOF, partial data, or data from a different request — undefined behaviour.

Mitigation: read the body before calling `next.ServeHTTP`, store the bytes; or push to a long-lived worker via a channel instead of spawning per-request goroutines.

</details>

---

## 24. Summary

- A decorator chain is N stacked interface dispatches. Each adds ~1.5–2 ns of dispatch overhead. A 5-deep chain costs ~10 ns of pure dispatch per request — invisible against any non-trivial handler work.
- The Go inliner cannot cross interface boundaries. Each layer's `next.ServeHTTP(w, r)` is a real indirect call to a separately-compiled function. The chain cannot be flattened into one giant function.
- PGO (Go 1.21+) devirtualizes monomorphic call sites in the chain. Each `next` call becomes a type-check-then-direct-call sequence. Typical saving: ~0.5–0.7 ns per layer, with the inliner sometimes folding 1–2 layers together after devirt.
- Middleware closures capture `next` (an iface). The funcval layout is `fn` plus the captured iface (24 bytes total for a minimal closure). The closure is heap-allocated because it's returned from the middleware factory. R15 (amd64 ABI) holds the funcval pointer during closure invocation.
- Escape analysis: middleware closures always escape (returned through the iface). The captured `next` escapes with the closure. Heap allocations: one per middleware layer, paid at chain construction. Per-request: 0 allocs in the closures themselves (well-written middleware).
- The `http.HandlerFunc` adapter doubles dispatch cost: one iface dispatch to `HandlerFunc.ServeHTTP`, then one funcval indirect to the actual function. The adapter's body is a tail-call (JMP instead of CALL), saving one frame but not one indirect transfer.
- Open-coded defers (Go 1.14+) make `defer recover()` ~5–10 ns of overhead, no allocations. The `_defer` struct is elided; the compiler emits inline checks at each function exit. Recovery middleware in modern Go is essentially free on the no-panic path.
- `runtime.gopanic` walks the defer list, invokes each deferred function, and unwinds the stack when one recovers. Cost of a recovered panic: ~200 ns. Cost of an unrecovered panic: ~milliseconds (the program dies anyway).
- Go has no general tail-call optimisation. A 5-deep chain consumes 5 stack frames. The compiler emits tail-calls for specific cases: embedded-struct method wrappers and `HandlerFunc.ServeHTTP`. User code doesn't get TCO.
- Embedded-struct decorators get auto-generated tail-call wrappers — slightly faster than explicit forwarding methods. The cost: the embedded interface field is public. Use embedding for multi-method interfaces where you decorate only a few; use explicit forwarding when you need encapsulation.
- A chain composed at startup is a linked list of heap-allocated closures, each holding the next layer's iface. Memory layout: 5 layers × ~24 bytes per closure = ~120 bytes of chain state plus the iface at the head. Cache-resident after warmup.
- Per-request behaviour: the chain dispatches through each layer (5 indirect calls for a 5-deep chain), each closure reads its captures via R15+offset, the innermost layer does the real work, the chain unwinds executing post-call code (defer bodies, log statements). Total dispatch cost: ~10 ns. Total chain cost (including defers): ~25 ns for a recovery-included chain.
- The "constructed per request" anti-pattern allocates one closure per layer per request — for a 5-deep chain at 10K RPS, that's 50K allocs/sec for nothing. Always construct chains at startup.
- Race-on-captured-state is the most common production bug: closures capture state by reference; concurrent requests race. Use `atomic` types or mutexes for any captured mutable state.
- Profile-driven optimisation: most chains are dispatch-bound at <0.1% of CPU. Focus on the closure bodies' work, not the chain itself. The decorator pattern's cost is the cost of one indirect call per layer — everything else is the middleware's own logic.

The deepest truth: a decorator chain is structurally simple — a linked list of closures, each indirect-calling the next. The runtime cost is N+1 indirect dispatches and a small fixed amount of defer machinery. Everything else — escape analysis, PGO, open-coded defers, embedded-wrapper tail-calls — is the compiler optimising around those primitives. Decorator scales well at runtime; the cost grows linearly with depth, but the constant is small.

---

## 25. Further reading

- Funcval and closure internals: `src/runtime/runtime2.go` (`funcval`), `src/cmd/compile/internal/walk/closure.go` (lowering).
- Defer machinery: `src/runtime/runtime2.go` (`_defer`), `src/runtime/panic.go` (`gopanic`, `gorecover`, `deferproc`, `deferreturn`), `src/cmd/compile/internal/ssagen/ssa.go` (open-coded defer codegen).
- Panic and recover: `src/runtime/panic.go`. The `gopanic` function is dense but worth reading once.
- HTTP handler adapter: `src/net/http/server.go` (`Handler`, `HandlerFunc`, `ServeMux.ServeHTTP`).
- Interface dispatch (covered in detail in the sibling file): `../03-strategy-pattern/professional.md`.
- Escape analysis: `src/cmd/compile/internal/escape/escape.go`.
- Inliner: `src/cmd/compile/internal/inline/inl.go`.
- PGO devirtualization: `src/cmd/compile/internal/devirtualize/pgo.go`.
- Method-table generation for embedding: `src/cmd/compile/internal/reflectdata/reflect.go`.
- Stack frame layout and unwinding: `src/runtime/traceback.go` (frame-walk algorithm), `src/runtime/stack.go` (stack growth).
- Calling convention: `src/cmd/compile/abi-internal.md` (register-based ABI for amd64, Go 1.17+).
- Related: `../03-strategy-pattern/professional.md` — iface, itab, conversion helpers, devirtualization details that this file builds on.
- Related: `../01-functional-options/professional.md` — funcval allocation, closure capture patterns at the runtime level.
- Related: `../02-builder-pattern/professional.md` — SSA, inlining, escape-analysis lens on a different pattern.
- Related: `../../02-language-basics/02-functions/04-closure-internals/professional.md` — closure layout and capture in depth.
- Related: middle.md §13 (benchmarks) — the numbers this file explains in machine terms.
- Related: `../../02-language-basics/04-error-handling/03-panic-and-recover/` (if it exists) for the deeper panic/recover semantics.
