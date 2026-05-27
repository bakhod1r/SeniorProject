# Iterator Pattern — Under the Hood

## 1. The runtime framing

Junior taught the four iterator shapes — `Next()/Value()`, channel-based, callback-based, and Go 1.23's `iter.Seq` / `iter.Seq2`. Middle taught when to pick each and how to fold cancellation in. This file is about what the compiler and runtime actually do when `for v := range seq` runs, when `iter.Pull` is invoked, when `for k, v := range m` is compiled, and when `for x := range ch` blocks on `runtime.chanrecv`. The source is short; the machine code is dense.

Three things make Iterator interesting at the lowest level. First, Go 1.23's range-over-func is the only construct in the language where a `for` loop body is compiled to a *closure passed as an argument* to the iterator. Second, `iter.Pull` performs push-to-pull conversion via `runtime.coro` (a stack-switching primitive) or, in older designs, via a goroutine plus a channel — a real scheduling cost. Third, the three classical range targets (slice, map, channel) lower to three completely different SSA shapes, each with its own bounds checks, randomised start (maps), and recv loop (channels).

We work in Go 1.23 / amd64 unless stated otherwise. References point at the `go1.23.x` source tree: `src/cmd/compile/internal/rangefunc/rewrite.go` for the range-over-func lowering, `src/iter/iter.go` and `src/runtime/coro.go` for `iter.Pull`, `src/runtime/map.go` for `mapiterinit` / `mapiternext`, `src/runtime/chan.go` for `chanrecv`, and `src/cmd/compile/internal/walk/range.go` for the classical three-target range lowering.

The questions answered:

- How does `for v := range seq` (where `seq iter.Seq[V]`) compile? What is the yield function? What is the body-as-closure?
- What does the rewriter emit for `break`, `return`, `goto label` inside a range-over-func body?
- How does `iter.Pull` convert a push iterator to a pull iterator? What does it cost?
- What's in the SSA for `for i, v := range s` (slice)? When does bounds-check elimination happen?
- Why does `for k, v := range m` iterate in randomised order, and where in the runtime?
- What's the recv loop for `for x := range ch`?
- When does an iterator closure escape?
- What does the assembly for a tight `iter.Seq` consumer look like?
- What do `bufio.Scanner.Scan()` and `sql.Rows.Next()` actually do per call?

This file pairs with [`../06-factory-pattern/professional.md`](../06-factory-pattern/professional.md) (funcval layout, escape analysis) and [`../04-decorator-pattern/professional.md`](../04-decorator-pattern/professional.md) (closure layout, R15 calling convention). Read those first — this file builds on their closure and dispatch models.

---

## 2. Table of Contents

1. [The runtime framing](#1-the-runtime-framing)
2. [Table of Contents](#2-table-of-contents)
3. [Range-over-func — the compiler's lowering](#3-range-over-func--the-compilers-lowering)
4. [The yield function value and the body-as-closure](#4-the-yield-function-value-and-the-body-as-closure)
5. [`break`, `return`, `goto` — state encoding](#5-break-return-goto--state-encoding)
6. [`iter.Seq` compilation as a function call](#6-iterseq-compilation-as-a-function-call)
7. [`iter.Pull` — push-to-pull via runtime.coro](#7-iterpull--push-to-pull-via-runtimecoro)
8. [Range over slice — SSA, length caching, BCE](#8-range-over-slice--ssa-length-caching-bce)
9. [Range over map — `hmap` iterator and randomised start](#9-range-over-map--hmap-iterator-and-randomised-start)
10. [Range over channel — `hchan` and the recv loop](#10-range-over-channel--hchan-and-the-recv-loop)
11. [Escape analysis for iterator closures](#11-escape-analysis-for-iterator-closures)
12. [Channel-based iterator: the goroutine cost](#12-channel-based-iterator-the-goroutine-cost)
13. [Memory layout of common iterator types](#13-memory-layout-of-common-iterator-types)
14. [Assembly for a typical `iter.Seq` consumption](#14-assembly-for-a-typical-iterseq-consumption)
15. [`bufio.Scanner` source dive](#15-bufioscanner-source-dive)
16. [`sql.Rows` source dive](#16-sqlrows-source-dive)
17. [Benchmarks across iterator styles](#17-benchmarks-across-iterator-styles)
18. [Reading the Go source](#18-reading-the-go-source)
19. [Edge cases at the lowest level](#19-edge-cases-at-the-lowest-level)
20. [Test](#20-test)
21. [Tricky questions](#21-tricky-questions)
22. [Summary](#22-summary)
23. [Further reading](#23-further-reading)

---

## 3. Range-over-func — the compiler's lowering

Go 1.23 made `for v := range f` legal when `f` has one of three signatures:

```go
func(yield func() bool)         // iter.Seq0
func(yield func(V) bool)        // iter.Seq[V]
func(yield func(K, V) bool)     // iter.Seq2[K, V]
```

Anything else is rejected by the type checker. The lowering is performed in `src/cmd/compile/internal/rangefunc/rewrite.go` before SSA generation. For:

```go
for v := range seq {
    fmt.Println(v)
}
```

where `seq iter.Seq[int]`, the compiler rewrites to (paraphrased Go):

```go
seq(func(v int) bool {
    fmt.Println(v)
    return true
})
```

The `for` body becomes the body of a closure passed as the `yield` argument. The producer (`seq`) is in charge of the loop; the consumer (the body) is a callback the producer invokes. `true` means "keep going"; `false` means "stop".

This is a complete inversion of control compared to a classical `Next()` iterator. A closure can capture the surrounding scope's locals, defers, and `return` statement, which is why the lowered code feels like an ordinary `for` from the consumer's perspective:

```go
total := 0
for v := range seq {
    total += v
    if total > 100 { break }
}
return total
```

`total`, `break`, and `return` all just work — the rewriter takes care of them (see §5).

### 3.1 The lowered IR

```go
func sum(seq iter.Seq[int]) int {
    var total int
    seq(func(v int) bool {
        total += v
        return true
    })
    return total
}
```

`total` is captured by reference; the closure mutates it. `seq` runs the loop; each call to the closure adds to `total`. When `seq` returns, the sum is in `total`.

The rewrite is *before* SSA. Inspect post-rewrite IR with `-gcflags="-d=rangefunc=1"` or via the SSA dump (`GOSSAFUNC=sum`).

### 3.2 Per-iteration variable freshness

The body's parameters are per-call fresh — each `v` is a new parameter binding. Capturing `v` in a spawned goroutine snapshots that iteration's value:

```go
for v := range seq {
    go func() { use(v) }()   // captures v safely (per-iteration)
}
```

This matches the Go 1.22 loop-variable change for classical ranges. For range-over-func, it's inherent to the closure-parameter design.

---

## 4. The yield function value and the body-as-closure

`yield` is a function value (a `funcval`) constructed by the rewrite, passed by argument, called per element.

### 4.1 The funcval shape

For:

```go
func sum(seq iter.Seq[int]) int {
    total := 0
    for v := range seq { total += v }
    return total
}
```

The yield closure captures `&total`. Funcval layout (see `../06-factory-pattern/professional.md` §3 and `../04-decorator-pattern/professional.md` §9 for the general model):

```
funcval (16 bytes):
    fn:     uintptr     → PC of the synthesised yield body
    &total: *int        → pointer to total in sum's frame
```

`fn` points to the compiled body. `&total` is the one capture. Small.

### 4.2 Where the closure lives

The closure stack-allocates when the producer is synchronous and doesn't retain yield. Escape analysis report for `sum`:

```
./sum.go:5:9: func literal does not escape
./sum.go:1:6: leaking param: seq
```

Stack-allocated closure. No heap alloc per range. This is the intended design — range-over-func is as cheap as a classical loop body, ignoring the per-element dispatch.

### 4.3 When the closure escapes

The closure escapes when the producer keeps a reference past its own return — e.g., spawning a goroutine that uses `yield`. The Go spec forbids calling `yield` after the producer returns; the runtime panics in obvious cases.

### 4.4 The yield's PC

The body is compiled as a separate function with a synthesised name like `pkg.sum.func1`. The PC stored in the funcval is its address in `.text`. Multiple range loops in one function produce `func1`, `func2`, etc. Inspect with `go tool objdump -s 'pkg\.sum\..*' binary`.

### 4.5 The yield call from the producer's side

```asm
; yield is in the standard ABI arg register, say AX
MOVQ    AX, R15            ; R15 = closure context (Go 1.18+ ABI)
MOVQ    (R15), CX          ; CX = funcval.fn (body PC)
MOVQ    $42, AX            ; AX = first arg (the value)
CALL    CX                 ; → run the body
TESTB   AL, AL             ; AL = bool return; nonzero = continue
JZ      done               ; if false, exit producer's loop
```

Per-element cost: one funcval indirect call. ~1.5–2 ns when the funcval is in cache. Comparable to one iface dispatch in a decorator chain.

---

## 5. `break`, `return`, `goto` — state encoding

The rewriter encodes non-trivial control flow as state variables. The body returns `false` to signal "stop", plus an extra state to encode *why* it stopped.

### 5.1 `continue` and `break`

`continue` → `return true`. `break` → `return false`. If `break` is the only loop exit, the producer returns, the wrapper falls through to post-loop code.

### 5.2 `return` from the enclosing function

`return` inside the body must return from the *enclosing* function, not from the yield closure. Source:

```go
func find(seq iter.Seq[int], target int) (int, bool) {
    for v := range seq {
        if v == target { return v, true }
    }
    return 0, false
}
```

Lowered (paraphrased):

```go
func find(seq iter.Seq[int], target int) (int, bool) {
    var ret0 int
    var ret1 bool
    var state int = 0           // 0 = normal, 1 = body did "return"
    seq(func(v int) bool {
        if v == target {
            ret0, ret1, state = v, true, 1
            return false        // tell producer to stop
        }
        return true
    })
    if state == 1 { return ret0, ret1 }
    return 0, false
}
```

`state` records why the producer stopped. After `seq` returns, the wrapper dispatches on `state` and either returns the captured values or falls through.

### 5.3 `goto label` outside the loop

Same scheme: each external label gets a state value. The body sets `state` and returns false. After `seq` returns, a switch dispatches to the right label. Cost: one int store per non-trivial exit (rare), one switch after (cheap).

### 5.4 The double-return diagnostic

If the producer ignores the `false` return and keeps calling `yield`, Go 1.23 panics with `range-over-func: yield called after iteration end`. The check is implemented inside the synthesised body itself: the body remembers whether it returned false and, on subsequent calls, panics. One boolean check per yield call — cheap, but real.

---

## 6. `iter.Seq` compilation as a function call

Full pipeline: rewriter forms the closure and producer call → walk → SSA → escape analysis → inlining → regalloc → codegen.

### 6.1 The type and the call

```go
// src/iter/iter.go
type Seq[V any]     func(yield func(V) bool)
type Seq2[K, V any] func(yield func(K, V) bool)
```

Consumer:

```go
func printAll(seq iter.Seq[string]) {
    for s := range seq { fmt.Println(s) }
}
```

becomes `seq(func(s string) bool { fmt.Println(s); return true })` — a single function call.

### 6.2 Producer with captures, dispatch chain

```go
func count(n int) iter.Seq[int] {
    return func(yield func(int) bool) {
        for i := 0; i < n; i++ {
            if !yield(i) { return }
        }
    }
}
```

`count(10)` allocates the producer closure (captures `n`, 16 B funcval). Then `for v := range count(10) { ... }` becomes `count(10)(func(v int) bool { ...; return true })`.

Per element flowing through:

1. Funcval indirect call to producer.
2. Inside producer, funcval indirect to `yield(i)`.
3. Yield body runs.
4. Return up the stack.

Per element: 1 funcval indirect (~2 ns). Per range setup: 1 alloc (the producer closure).

### 6.3 Zero-allocation producer

```go
func count10(yield func(int) bool) {
    for i := 0; i < 10; i++ { if !yield(i) { return } }
}

var seq iter.Seq[int] = count10   // no-op cast, no allocation
```

`count10` is a static function; converting to `iter.Seq[int]` is a no-op (same shape). Funcval lives in rodata.

### 6.4 PGO devirtualization

PGO (Go 1.21+) devirtualizes the yield call site when one body dominates the profile:

```asm
MOVQ    yield+0(SP), AX
LEAQ    expected_yield_body(SB), CX
CMPQ    (AX), CX                   ; check funcval.fn against expected
JNE     fallback
CALL    expected_yield_body(SB)    ; direct call (inlinable)
JMP     done
fallback:
    MOVQ    (AX), CX
    CALL    CX
done:
```

Per-element saving: ~1.5 ns. The inliner doesn't cross funcval indirect calls by default — same wall as iface dispatch (`../03-strategy-pattern/professional.md` §5). After PGO devirts, the inliner *can* fold the yield body into the producer if both fit the budget — trivial cases sometimes flatten fully.

---

## 7. `iter.Pull` — push-to-pull via runtime.coro

`iter.Pull` converts a push iterator (`iter.Seq[V]`) into a pull iterator (`next() (V, bool)` plus `stop()`). Useful when merging two iterators or matching a legacy pull-style API. Not free — it constructs a coroutine.

### 7.1 The API

```go
// src/iter/iter.go
func Pull[V any](seq Seq[V]) (next func() (V, bool), stop func())
func Pull2[K, V any](seq Seq2[K, V]) (next func() (K, V, bool), stop func())
```

`next` returns the next value and `true`, or zero+`false` when exhausted. `stop` cleans up early. Must be called if you stop iterating before exhaustion or you leak the producer's execution context.

### 7.2 The runtime.coro model (Go 1.23+)

Go 1.23 added `runtime.coro` — a stack-switching coroutine primitive specifically for `iter.Pull`. Instead of a goroutine + channels, the producer and consumer share a goroutine but switch stacks (saved PC, SP, BP, R15).

```go
// src/runtime/coro.go (paraphrased)
type coro struct {
    gp     guintptr
    f      func(*coro)
    mp     *m
    flag   uint32
    // ... saved register snapshot ...
}

func newcoro(f func(*coro)) *coro
func coroswitch(c *coro)
```

`Pull` uses `newcoro` to create the producer's execution context and `coroswitch` to transfer control. Each transfer:

- Save 5–6 registers.
- Restore the partner's saved registers.
- Continue executing.

Per-transfer cost: ~10–20 ns. Pull's per-element cost: ~30–40 ns (transfer to producer + value passing + transfer back). Compared to ~2 ns for direct push — Pull is ~15× more expensive.

### 7.3 The fallback channel model (illustrative)

A pre-coro implementation for comparison:

```go
func Pull[V any](seq Seq[V]) (next func() (V, bool), stop func()) {
    valueCh := make(chan V); doneCh := make(chan struct{})
    go func() {
        defer close(valueCh)
        seq(func(v V) bool {
            select {
            case valueCh <- v: return true
            case <-doneCh: return false
            }
        })
    }()
    next = func() (V, bool) { v, ok := <-valueCh; return v, ok }
    stop = func() { close(doneCh); for range valueCh {} }
    return
}
```

Per-element: ~100 ns (channel send/recv + goroutine park/unpark). ~3× slower than the coro version.

### 7.4 `stop` must be called, memory, misuse

`defer stop()` is the safe idiom; without it, the producer is parked forever waiting for the next `next()` — leak.

Memory: coro model ~1 KB per Pull (coro struct ~200 B + stack snapshot + 2 closures); channel model ~10 KB (channels + ~8 KB goroutine stack).

`runtime.coro` is bound to its creating goroutine — cross-goroutine `next()` panics. For fan-out, build a channel layer on top.

### 7.5 When Pull is right

Merging two sorted iterators (independent advancement); legacy APIs expecting pull semantics; producer doing slow I/O you want to interleave. For pure in-process iteration, prefer `iter.Seq` — ~15× cheaper.

---

## 8. Range over slice — SSA, length caching, BCE

The classical workhorse. Lowering lives in `src/cmd/compile/internal/walk/range.go`.

### 8.1 The lowering

```go
for i, v := range s { body }
```

becomes (paraphrased from `walk.go`):

```go
ha := s              // copy of slice header (24 bytes)
hv := len(ha)        // length cached ONCE
hb := &ha[0]         // base pointer (only if hv > 0)
for i := 0; i < hv; i++ {
    v := *(hb + i*sizeof(T))
    body
}
```

Three key facts:

1. **Slice header copied once.** Mutations to `s` in the body don't change `ha`.
2. **Length cached once.** `append`ing to `s` mid-loop doesn't extend iteration.
3. **Pointer arithmetic for element load.** The compiler emits `ADDQ $size, ptr` to advance; no per-element bounds check on the induction var.

### 8.2 SSA and BCE

```
b1 (loop header):
    v1 = phi i  (0, or i+1 from b2)
    v3 = LessThan v1 hv
    If v3 → b2 else → b3

b2 (loop body):
    v4 = OffPtr [v1 * sz] hb
    v5 = Load v4
    ; ... body ...
    v7 = Add v1 $1
    Goto b1
```

No `BoundsCheck` op. The SSA `prove` pass recognises `0 ≤ v1 < hv` and elides the check. BCE in action.

### 8.3 When BCE fails

```go
for i, v := range s {
    total += s[i+1]   // bounds check NOT elided
    _ = v
}
```

The prover can't bound `i+1 < len(s)`. SSA emits `IsInBounds` per iteration — one extra compare + branch (~1 ns each). Hoist with `_ = s[len(s)-1]` before the loop, or restructure.

### 8.4 Large-element slices and arrays

```go
type Big struct { data [128]byte }
for _, v := range bigSlice { use(v) }   // copies 128 bytes per iter (Move op)
```

For large elements, use indices: `for i := range bigSlice { use(&bigSlice[i]) }`. Slice element-copy is not auto-elided.

For ranges over arrays (`var arr [10000]int; for i, v := range arr`), `ha := arr` copies the entire 80 KB. Go 1.22+ elides the array copy when the body doesn't mutate or take addresses; to be safe, range a slice header (`arr[:]`).

### 8.5 Index-only

`for i := range s` has no element load — only `i` is materialised. Faster than `for i, _ := range s` (which still loads on some Go versions).

---

## 9. Range over map — `hmap` iterator and randomised start

Maps have no defined order; Go enforces this by randomising the iteration start. Implementation in `src/runtime/map.go`.

### 9.1 `hmap`, `bmap`, `hiter` (abbreviated)

```go
type hmap struct {
    count     int
    B         uint8           // log2(# buckets)
    hash0     uint32          // hash seed, randomised per map
    buckets   unsafe.Pointer  // → [2^B]bmap
    oldbuckets unsafe.Pointer // non-nil during growth
    flags     uint8
    // ...
}

type bmap struct {
    tophash [8]uint8
    // keys [8]K, values [8]V, overflow *bmap follow
}

type hiter struct {
    key, elem    unsafe.Pointer
    h            *hmap
    buckets      unsafe.Pointer
    startBucket  uintptr      // ← randomised
    offset       uint8        // ← randomised
    bucket       uintptr
    i            uint8
    wrapped      bool
    // ...
}
```

### 9.2 `mapiterinit` — where randomisation happens

```go
func mapiterinit(t *maptype, h *hmap, it *hiter) {
    it.h = h; it.B = h.B; it.buckets = h.buckets
    r := uintptr(fastrand())
    it.startBucket = r & bucketMask(h.B)
    it.offset = uint8(r >> h.B & (abi.MapBucketCount - 1))
    it.bucket = it.startBucket
    mapiternext(it)
}
```

`fastrand()` is the runtime's xorshift PRNG. Lower bits pick the start bucket; further bits pick the offset. ~5 ns per init, paid once per range loop.

### 9.3 `mapiternext` and the range lowering

`mapiternext` walks to the next live entry, handles overflow chains and wrap-around, and checks `h.flags & hashWriting` — concurrent write throws.

The compiler lowers `for k, v := range m` to:

```go
var it hiter
runtime.mapiterinit(typeOf(m), m, &it)
for ; it.key != nil; runtime.mapiternext(&it) {
    k := *(*K)(it.key); v := *(*V)(it.elem)
    use(k, v)
}
```

`it` is stack-allocated. Per iteration: one runtime call + two pointer loads.

### 9.4 Per-iteration cost and behaviour

`mapiternext` does: load tophash array, scan for next non-tombstone (~10 cycles in-bucket), follow overflow if needed, concurrent-write check, wrap-around bookkeeping. **~10–20 ns per iteration — ~10× slower than slice iteration.** For high-frequency iteration over a stable map, materialise into a slice once.

Single-goroutine mutation during iteration is lenient: keys added may or may not be visited; keys deleted ahead of the cursor are skipped; growth via `oldbuckets` is transparent. Concurrent writes panic.

Randomisation matters because (a) tests that depend on order fail predictably under randomisation, and (b) the implementation can change (e.g., the rumoured Swiss-table rewrite) without breaking consumers.

---

## 10. Range over channel — `hchan` and the recv loop

Channel iteration is a tight loop calling `runtime.chanrecv2` until the channel is closed and drained.

### 10.1 The `hchan` struct (abbreviated)

```go
type hchan struct {
    qcount   uint            // # elements in buffer
    dataqsiz uint            // buffer capacity
    buf      unsafe.Pointer  // ring buffer
    elemsize uint16
    closed   uint32
    sendx, recvx uint
    recvq    waitq           // goroutines blocked on recv
    sendq    waitq           // goroutines blocked on send
    lock     mutex
}
```

Unbuffered channels have `dataqsiz == 0` and use the wait queues to rendezvous. Buffered channels use the ring buffer.

### 10.2 The range lowering

`for v := range ch { use(v) }` becomes:

```go
for {
    v, ok := <-ch
    if !ok { break }
    use(v)
}
```

`<-ch` (two-value form) compiles to `runtime.chanrecv2`. When the channel is closed and empty, `ok = false`.

### 10.3 `runtime.chanrecv` outline

```go
func chanrecv(c *hchan, ep unsafe.Pointer, block bool) (selected, received bool) {
    if c == nil { gopark(...) }   // park forever on nil
    lock(&c.lock)
    if c.closed != 0 && c.qcount == 0 {
        unlock(&c.lock); return true, false
    }
    if sg := c.sendq.dequeue(); sg != nil {
        recv(c, sg, ep, ...)      // direct sender→receiver copy
        return true, true
    }
    if c.qcount > 0 {             // dequeue from buffer
        return true, true
    }
    gopark(...)                   // block on recvq
    return true, !closed
}
```

Mutex + sendq/recvq + `gopark` parking + close flag — several runtime subsystems in one function.

### 10.4 Per-receive cost

- Buffered, data ready: ~30–40 ns (lock + buffer copy + unlock).
- Unbuffered: ~150–200 ns (park + wake context switch + copy).

**Unbuffered channel range is ~100× slower than slice range.**

### 10.5 Close detection and nil channel

`close(ch)` sets `c.closed = 1`. Pending senders panic; pending receivers are woken with `ok = false`. Buffered remaining elements drain first; the loop exits when buffer is empty and closed.

`for v := range (chan int)(nil) { ... }` parks the goroutine forever on the first receive.

---

## 11. Escape analysis for iterator closures

For range-over-func, the yield closure's escape decision is critical: stack-allocated is free; heap-allocated costs one alloc per range loop.

### 11.1 The simple consumer

```go
func sum(seq iter.Seq[int]) int {
    total := 0
    for v := range seq { total += v }
    return total
}
```

`-gcflags="-m"` reports:

```
./sum.go:5:9: func literal does not escape
./sum.go:1:6: leaking param: seq
```

Stack-allocated yield closure. No heap alloc per range. "leaking param: seq" is the analyser being conservative — the seq value might escape into the producer, but here it doesn't.

### 11.2 The producer side

```go
func count(n int) iter.Seq[int] {
    return func(yield func(int) bool) {
        for i := 0; i < n; i++ { if !yield(i) { return } }
    }
}
```

Reports `func literal escapes to heap` and `moved to heap: n`. The producer closure escapes (returned); `n` is captured. One ~16-byte alloc per `count(...)` call. Hoist outside hot paths; for closure-free producers, write a plain function.

### 11.3 Misuse-driven escape

```go
func bad(yield func(int) bool) {
    go func() { yield(1) }()  // BUG: yield escapes; spec violation
}
```

`yield` flows into the spawned goroutine; the analyser forces it to the heap. The spec violation (calling yield after producer return) is worse — but escape is the first visible cost.

### 11.4 Capture-by-pointer to keep funcvals small

```go
func paginate(opts *Options) iter.Seq[Row] {
    return func(yield func(Row) bool) { ... opts.skip ... }
}
```

Funcval: `fn` + `*Options` = 16 bytes regardless of `Options` size. Capturing by value would copy the whole struct. Trade-off: pointer capture means the closure sees post-construction mutations; for long-lived producers, snapshot to a local in the closure.

---

## 12. Channel-based iterator: the goroutine cost

Pre-1.23, the classical Go iterator pattern was a producer goroutine sending on a channel. Clean to write, expensive at runtime.

```go
func gen(n int) <-chan int {
    ch := make(chan int)
    go func() {
        defer close(ch)
        for i := 0; i < n; i++ { ch <- i }
    }()
    return ch
}

for v := range gen(10) { use(v) }
```

Costs:

- Channel allocation: ~100 bytes for unbuffered.
- Goroutine spawn: ~1 KB stack + scheduler bookkeeping, ~2 µs setup.
- Per element: ~80–200 ns (unbuffered) or ~10 ns (well-buffered).

### 12.1 Comparison with `iter.Seq`

| Operation | Channel iterator | `iter.Seq` |
|---|---|---|
| Setup | ~2 µs | ~0 ns (closure if needed) |
| Per element | ~100 ns | ~2 ns |
| Memory | ~1 KB (stack) | ~16 bytes (closure) |
| Cancel | needs context/done channel | return false from yield |

`iter.Seq` is ~50× cheaper per element. The reason channel iterators were popular: before 1.23, the only way to express "lazy infinite generator with cancellation".

### 12.2 The leak trap

```go
ch := gen(infinite)
for v := range ch {
    if v > 10 { return }   // LEAK: gen's goroutine blocked forever
}
```

Fix with context:

```go
func gen(ctx context.Context, n int) <-chan int {
    ch := make(chan int)
    go func() {
        defer close(ch)
        for i := 0; i < n; i++ {
            select {
            case ch <- i:
            case <-ctx.Done(): return
            }
        }
    }()
    return ch
}
```

`iter.Seq` doesn't leak — the producer returns when yield returns false.

### 12.3 Buffer-size dependence

| Buffer | ns/elem (10-elem iter) | Allocs |
|---|---|---|
| Unbuffered | ~2400 | 2 |
| 16 | ~420 | 2 |
| 1024 (≥N) | ~140 | 2 |

Large buffers approach the per-element copy cost but defeat laziness — you've materialised the data.

### 12.4 When channels are still right

- Producer does concurrent I/O; overlap with consumer is the point.
- Producer and consumer cross trust boundaries.
- Channel-shaped API is required by the caller.

For pure in-process iteration over data in memory, `iter.Seq` wins decisively.

---

## 13. Memory layout of common iterator types

| Iterator | Per-instance size | Heap allocs |
|---|---|---|
| `iter.Seq[V]` (closure-free producer) | 8 B (funcval ptr to rodata) | 0 |
| `iter.Seq[V]` (closure producer) | 8 B + ~16 B funcval | 1 |
| Hand-rolled `Next()/Value()` struct | depends on state (~32 B for slice iter) | 1 (the struct) |
| Channel iterator | ~96 B header + buffer + ~1 KB goroutine stack | 2–3 |
| `iter.Pull` (coro) | ~200 B coro + stack + 2 closures ≈ 1 KB | 5 |
| Map `hiter` | ~80 B | 0 (stack) |
| Channel `hchan` | ~96 B + buffer | 1 |

### 13.1 Composed `iter.Seq`

A `Filter(Take(N, Map(double, source)))` chain: each layer is a closure capturing the inner iterator.

```go
func Map[V any](f func(V) V, in iter.Seq[V]) iter.Seq[V] {
    return func(yield func(V) bool) { in(func(v V) bool { return yield(f(v)) }) }
}
```

Three closures, ~24–32 B each. Per-element cost: 3 funcval indirect calls ≈ 6 ns. Linear in depth — same model as the decorator pattern's iface chain (`../04-decorator-pattern/professional.md` §3), funcval substituting for iface dispatch.

---

## 14. Assembly for a typical `iter.Seq` consumption

```go
package main

func sum(seq func(yield func(int) bool)) int {
    total := 0
    for v := range seq { total += v }
    return total
}
```

Compile with `go build -gcflags="-l" -o /tmp/sum sum.go` then `go tool objdump -s 'main\.sum' /tmp/sum`:

```asm
TEXT main.sum(SB)
    SUBQ    $40, SP
    MOVQ    BP, 32(SP)
    LEAQ    32(SP), BP

    MOVQ    $0, "".total+24(SP)        ; total = 0

    ; Construct yield closure on the stack.
    LEAQ    main.sum.func1(SB), AX
    MOVQ    AX, 0(SP)                  ; closure.fn
    LEAQ    "".total+24(SP), AX
    MOVQ    AX, 8(SP)                  ; closure.&total

    ; Call seq with the closure.
    LEAQ    0(SP), AX                  ; AX = ptr to yield closure
    MOVQ    "".seq+48(SP), CX          ; CX = seq's funcval
    MOVQ    (CX), DX                   ; DX = producer's fn
    MOVQ    CX, R15                    ; R15 = producer's context
    CALL    DX

    MOVQ    "".total+24(SP), AX
    MOVQ    32(SP), BP
    ADDQ    $40, SP
    RET

TEXT main.sum.func1(SB)                ; the yield body
    ; AX = v (the yielded value)
    ; R15 = closure context
    MOVQ    8(R15), CX                 ; CX = &total
    ADDQ    AX, (CX)                   ; *total += v
    MOVB    $1, AX                     ; return true
    RET
```

Observations:

1. **Stack-allocated closure.** `0(SP)` and `8(SP)` hold the funcval — no heap.
2. **One call to the producer.** The entire `for-range` is one function call to `seq`.
3. **Per-yield work:** load fn (1 instr), set R15 (1 instr), CALL (1 instr) — ~7–10 cycles before the body's own work. Below ~3 ns on amd64.
4. **The body is 4 instructions.** Once PGO devirtualizes and the inliner folds, the entire loop can collapse into the producer's body.

---

## 15. `bufio.Scanner` source dive

The canonical hand-rolled `Next()/Value()` iterator in the standard library.

### 15.1 The struct (abbreviated)

```go
// src/bufio/scan.go
type Scanner struct {
    r            io.Reader
    split        SplitFunc
    maxTokenSize int
    token        []byte    // current token
    buf          []byte    // read buffer
    start, end   int       // cursors into buf
    err          error
    done         bool
}
```

A reader, a split function (line/word/byte/rune/custom), a buffer with cursors, an error, state flags.

### 15.2 `Scan()` — the `Next` equivalent

```go
func (s *Scanner) Scan() bool {
    if s.done { return false }
    for {
        if s.end > s.start || s.err != nil {
            advance, token, err := s.split(s.buf[s.start:s.end], s.err != nil)
            if err != nil { s.setErr(err); return false }
            if token != nil {
                s.token = token; s.start += advance
                return true
            }
        }
        if s.err != nil { s.token = nil; s.done = true; return false }
        // compact buffer, grow if needed, then Read more from s.r
        // ... (compaction + growth omitted)
        n, err := s.r.Read(s.buf[s.end:])
        s.end += n
        if err != nil { s.setErr(err) }
    }
}
```

Each `Scan()`: try to extract a token from the buffer; if none, compact/grow/read; loop. Cost varies — ~10 ns for a buffered token, microseconds for a Read that hits the underlying reader.

### 15.3 Accessors and usage

```go
func (s *Scanner) Text() string { return string(s.token) }   // copies (alloc)
func (s *Scanner) Bytes() []byte { return s.token }          // no copy, slice valid until next Scan()

sc := bufio.NewScanner(r)
for sc.Scan() { use(sc.Text()) }
if err := sc.Err(); err != nil { log.Fatal(err) }
```

`for sc.Scan()` is the loop. `sc.Err()` after the loop separates iteration from error reporting.

### 15.4 Wrapping in `iter.Seq`

```go
func ScanLines(sc *bufio.Scanner) iter.Seq[string] {
    return func(yield func(string) bool) {
        for sc.Scan() {
            if !yield(sc.Text()) { return }
        }
    }
}

for line := range ScanLines(sc) { use(line) }
if err := sc.Err(); err != nil { log.Fatal(err) }
```

No perf loss — one funcval indirect per element. Consumers can `break` cleanly.

---

## 16. `sql.Rows` source dive

The canonical iterator-with-cleanup.

### 16.1 The struct (abbreviated)

```go
// src/database/sql/sql.go
type Rows struct {
    dc          *driverConn
    releaseConn func(error)
    rowsi       driver.Rows
    cancel      func()
    contextDone atomic.Value
    closemu     sync.RWMutex
    closed      bool
    lasterr     error
    lastcols    []driver.Value
}
```

Driver connection, rowset, cancellation, close mutex, current row values, error state.

### 16.2 `Next()`

```go
func (rs *Rows) Next() bool {
    if rs.contextDone.Load() != nil { return false }
    var doClose, ok bool
    withLock(rs.closemu.RLocker(), func() {
        if rs.closed { return }
        rs.lastcols = make([]driver.Value, len(rs.rowsi.Columns()))   // alloc!
        rs.lasterr = rs.rowsi.Next(rs.lastcols)
        if rs.lasterr != nil { doClose = true; return }
        ok = true
    })
    if doClose { rs.Close() }
    return ok
}
```

Each `Next()`: check context, acquire read lock, call the driver's Next, return ok. The `make(...)` per call is one allocation per row — material on large result sets.

### 16.3 `Scan()`, `Close()`, `Err()`

`Scan(&id, &name)` copies the current row's columns into the caller-provided destinations via `convertAssign` (type-converting copy). `Close()` releases the driver connection back to the pool; must be called or the pool leaks. `Err()` returns any error that ended iteration early.

### 16.4 Usage pattern

```go
rows, err := db.Query("SELECT id, name FROM users")
if err != nil { return err }
defer rows.Close()

for rows.Next() {
    var id int; var name string
    if err := rows.Scan(&id, &name); err != nil { return err }
    use(id, name)
}
return rows.Err()
```

Four idioms: `defer rows.Close()` (mandatory), `for rows.Next()` (loop), `rows.Scan(...)` (typed extraction), `rows.Err()` (post-loop error).

### 16.5 Wrapping in `iter.Seq2`

```go
func QueryRows[T any](rows *sql.Rows, scan func(*sql.Rows) (T, error)) iter.Seq2[T, error] {
    return func(yield func(T, error) bool) {
        defer rows.Close()
        for rows.Next() {
            v, err := scan(rows)
            if !yield(v, err) { return }
            if err != nil { return }
        }
        if err := rows.Err(); err != nil {
            var zero T
            yield(zero, err)
        }
    }
}

for user, err := range QueryRows(rows, scanUser) {
    if err != nil { return err }
    use(user)
}
```

The wrapper adds one funcval indirect per row (~2 ns) — negligible against the DB round-trip cost.

---

## 17. Benchmarks across iterator styles

1000-int iteration in memory; body is `sum += v`. Five harnesses:

```go
func slice() []int { s := make([]int, 1000); for i := range s { s[i] = i }; return s }

// 1. Plain slice range — the baseline.
for _, v := range s { sum += v }

// 2. Hand-rolled Next()/Value().
type sliceIter struct { s []int; i int }
func (it *sliceIter) Next() bool { it.i++; return it.i <= len(it.s) }
func (it *sliceIter) Value() int { return it.s[it.i-1] }
it := &sliceIter{s: s}
for it.Next() { sum += it.Value() }

// 3. iter.Seq.
func sliceSeq(s []int) iter.Seq[int] {
    return func(yield func(int) bool) {
        for _, v := range s { if !yield(v) { return } }
    }
}
for v := range sliceSeq(s) { sum += v }

// 4. Channel (buf 16).
ch := make(chan int, 16)
go func() { defer close(ch); for _, v := range s { ch <- v } }()
for v := range ch { sum += v }

// 5. iter.Pull.
next, stop := iter.Pull(sliceSeq(s))
defer stop()
for { v, ok := next(); if !ok { break }; sum += v }
```

### 17.1 Results (Go 1.23, amd64, no PGO)

```
BenchmarkSliceRange-8        3000000     400 ns/op    0 B/op   0 allocs/op
BenchmarkNextValue-8         1500000     780 ns/op   32 B/op   1 allocs/op
BenchmarkIterSeq-8           1500000     820 ns/op    0 B/op   0 allocs/op
BenchmarkIterPull-8           200000    5200 ns/op  ~400 B/op  5 allocs/op
BenchmarkChanIter_Buf16-8     100000   10800 ns/op   272 B/op  3 allocs/op
BenchmarkChanIter_Unbuf-8      30000   41200 ns/op   240 B/op  3 allocs/op
```

(1000 elements per op.)

### 17.2 Per-element breakdown

| Iterator | ns/elem | Relative |
|---|---|---|
| Slice range | 0.4 | 1× |
| `iter.Seq` | 0.8 | 2× |
| Hand-rolled `Next()` | 0.8 | 2× |
| `iter.Pull` (coro) | 5 | 13× |
| Channel buf 16 | 11 | 27× |
| Channel unbuffered | 41 | 100× |

With PGO, `iter.Seq` drops to ~0.6 ns/elem (~1.5× slice range). The yield call site devirtualises; the inliner may fold trivial cases.

### 17.3 Composition test

`Filter → Map → Take(100) → source`:

```
BenchmarkComposedSeq-8      500000   2200 ns/op   ~80 B/op  2 allocs/op    (100 elements)
BenchmarkComposedManual-8  1000000   1100 ns/op    0 B/op    0 allocs/op
```

Composed `iter.Seq` is ~22 ns/elem; manual fusion (one loop, all three transforms inline) is ~11 ns/elem. The 2× overhead is the funcval indirect calls between layers. For perf-sensitive composed iterators, fuse manually. For most code, the readability of composed iterators is worth the 2× cost.

### 17.4 Takeaway

`iter.Seq` is competitive with hand-rolled `Next()` (~0.8 ns/elem either way), allocation-free when the closure stays on the stack, and ergonomically far better. Use it for new code. Reserve channel iterators for genuinely concurrent producer/consumer scenarios; reserve `iter.Pull` for pull-API requirements.

---

## 18. Reading the Go source

- **`src/cmd/compile/internal/rangefunc/rewrite.go`** — source-level rewriter for `for v := range seqFunc`. The `break`/`return`/`goto` state encoding lives here.
- **`src/cmd/compile/internal/walk/range.go`** — lowerings for the three classical range targets. Functions: `walkRangeSlice`, `walkRangeMap`, `walkRangeChan`. Length-cached-once rule is in `walkRangeSlice`.
- **`src/iter/iter.go`** — public iter package. `Seq`, `Seq2`, `Pull`, `Pull2`. Pull uses `runtime.coro`.
- **`src/runtime/coro.go`** (Go 1.23+) — stack-switching coroutine for `iter.Pull`. `newcoro`, `coroswitch`.
- **`src/runtime/iter.go`** (Go 1.23+) — runtime bridge between iter and coro. Watch for optimisations across versions.
- **`src/runtime/map.go`** — `hmap`, `bmap`, `hiter`; `mapiterinit` (randomisation) and `mapiternext` (advance).
- **`src/runtime/chan.go`** — `hchan`; `chanrecv` / `chanrecv2`. Close detection inside `chanrecv`.
- **`src/cmd/compile/internal/escape/escape.go`** — closure escape rules. `escapeClosure` and the "leaking param" diagnostics.
- **`src/cmd/compile/internal/inline/inl.go`** — why the inliner can't cross funcval indirect calls.
- **`src/bufio/scan.go`** — the canonical hand-rolled `Next()/Value()` iterator. ~200 lines, worth a full read.
- **`src/database/sql/sql.go`** — `Rows` iterator with explicit `Close()`. Read the `Next`/`Scan`/`Close`/`Err` sequence.

---

## 19. Edge cases at the lowest level

### 19.1 Yield called after producer returned

```go
func bad(yield func(int) bool) {
    defer func() { yield(1) }()   // PANIC: yield called after iteration end
}
```

The defer fires after `bad` returns. The yield closure may be freed (stack-allocated). Go 1.23 panics in obvious cases via a "closed" flag in the synthesised body.

### 19.2 Reuse and single-use producers

```go
seq := func(yield func(int) bool) { for i := 0; i < 5; i++ { if !yield(i) { return } } }
for v := range seq { ... }   // 0..4
for v := range seq { ... }   // also 0..4 — producer is restartable
```

vs:

```go
ch := makeBufferedChan()
for v := range ch { ... }   // drains it
for v := range ch { ... }   // empty
```

Channels are single-use after exhaustion; closures may or may not be — depends on the producer. Document the contract.

### 19.3 Nil iter.Seq

`var seq iter.Seq[int]` is nil. `for v := range seq { ... }` dereferences a nil function pointer → "nil pointer dereference" panic. Guard if `seq` might be nil.

### 19.4 Reading the loop variable after the loop

In a classical loop, `i` (if declared outside) persists. In range-over-func, the loop variable is in scope only inside the body. To preserve state, capture explicitly:

```go
var lastV int
for v := range seq { lastV = v; if cond { break } }
use(lastV)
```

### 19.5 Concurrent map iteration (read-only)

Two goroutines `for k, v := range m { ... }` on the same map with no writes is safe — each has its own `hiter`. Add a writer and the runtime panics.

### 19.6 `for range done` for signalling

```go
done := make(chan struct{})
go func() { close(done) }()
for range done { /* body */ }
```

Receives until closed; loop body runs zero times for a close-only channel. Common pattern, but `<-done` (single receive) is usually clearer.

### 19.7 Unused parameter in `iter.Seq2`

```go
for k, _ := range seqKV { use(k) }
```

The closure still has the full `(K, V) bool` signature; the unused parameter is dead-stored. ~1 ns of waste per call. Not worth eliminating.

---

## 20. Test

### Internal knowledge questions

**1. What does `for v := range seq` (with `seq iter.Seq[int]`) compile to?**

<details>
<summary>Answer</summary>

`src/cmd/compile/internal/rangefunc/rewrite.go` rewrites it to `seq(func(v int) bool { /* body */; return true })`. The for body becomes a closure passed as `yield`. The closure typically stack-allocates. `break`/`return`/`goto` are translated via state variables: the body sets `state`, returns false; after `seq` returns, a wrapper switch dispatches.

</details>

**2. Funcval layout for the yield closure in `func sum(seq iter.Seq[int]) int { total := 0; for v := range seq { total += v }; return total }`?**

<details>
<summary>Answer</summary>

```
funcval (16 bytes):
    fn:     uintptr     → PC of the synthesised body
    &total: *int        → pointer into sum's stack frame
```

Stack-allocated. The body accesses `&total` via `MOVQ 8(R15), reg`, where R15 is the closure context register (Go 1.18+ amd64 ABI).

</details>

**3. How does `iter.Pull` convert push to pull?**

<details>
<summary>Answer</summary>

Go 1.23+ uses `runtime.coro` — a stack-switching primitive. `Pull` calls `newcoro` to create the producer's execution context. Each `next()` calls `coroswitch` to resume the producer; the producer runs to the next `yield`; the yield implementation switches back with the value. Per-element cost: ~30–40 ns. Memory: ~1 KB per Pull. The consumer must call `stop()` (typically `defer stop()`) or the producer is parked forever.

</details>

**4. Why is map iteration randomised, and where?**

<details>
<summary>Answer</summary>

In `src/runtime/map.go`'s `mapiterinit`:

```go
r := fastrand()
it.startBucket = r & bucketMask(h.B)
it.offset = uint8(r >> h.B & (abi.MapBucketCount - 1))
```

Lower bits pick start bucket; further bits pick offset. ~5 ns per init. Randomisation prevents consumers from depending on iteration order, freeing the runtime to change implementation.

</details>

**5. Per-element cost of buffered vs unbuffered channel range?**

<details>
<summary>Answer</summary>

Buffered (data ready): ~30–40 ns (lock + buffer copy + unlock). Unbuffered: ~150–200 ns (park + wake context switch + copy). `iter.Seq`: ~2 ns. Use channels only when concurrent producer/consumer is the goal.

</details>

**6. When does the yield closure escape to the heap?**

<details>
<summary>Answer</summary>

When the producer is misbehaved — captures `yield` and uses it after returning (spawning a goroutine using yield, storing yield in a long-lived field). Well-behaved producers run yield synchronously; escape analysis keeps the closure on the stack. Verify with `-gcflags="-m"`.

</details>

### Reading assembly

**7. What does this fragment do?**

```asm
MOVQ    seq+0(SP), AX
MOVQ    (AX), CX
MOVQ    AX, R15
LEAQ    pkg.main.func1(SB), DX
MOVQ    DX, 0(SP)
LEAQ    "".total+8(SP), DX
MOVQ    DX, 8(SP)
LEAQ    0(SP), AX
CALL    CX
```

<details>
<summary>Answer</summary>

Sets up and calls a range-over-func producer: load producer funcval ptr and fn into AX/CX; set R15 to the producer's funcval (so it can access its captures); construct the yield closure on the stack (`0(SP)` = body PC, `8(SP)` = `&total` capture); load the yield closure address into AX (first arg); CALL the producer. Stack-allocated yield; producer may call it many times via funcval indirect.

</details>

---

## 21. Tricky questions

**1. Why does this panic with "range-over-func: yield called after iteration end"?**

```go
func bad(yield func(int) bool) {
    for i := 0; i < 10; i++ {
        if !yield(i) { /* forgot to return */ }
    }
}
```

<details>
<summary>Answer</summary>

The producer ignores the false return and keeps calling yield. After the body returns false once, the synthesised body sets a "closed" flag; subsequent calls panic. Fix: `if !yield(i) { return }`.

</details>

**2. Difference between `iter.Pull(seq)` and `go produce(seq)` + a channel?**

<details>
<summary>Answer</summary>

Functionally equivalent (both expose `next()`-style advance). `iter.Pull` (coro, Go 1.23+): ~30 ns/elem, ~1 KB memory. Channel + goroutine: ~100–200 ns/elem, ~10 KB memory. `iter.Pull` is ~5× cheaper. Channels remain better when producer concurrency or cross-package channel-shaped APIs matter.

</details>

**3. `for v := range seq { go doWork(v) }` — what happens to `v`?**

<details>
<summary>Answer</summary>

Each iteration's `v` is a fresh per-call parameter of the yield closure. The spawned goroutine captures *that iteration's* `v` — snapshotted correctly. Per-iteration freshness is inherent to range-over-func; matches Go 1.22's loop-variable change for classical ranges.

The spawned goroutine causes `v` to escape — one alloc per iteration. For perf, pass `v` explicitly: `go func(v T) { doWork(v) }(v)`.

</details>

**4. Why is `for k, v := range m` ~10× slower than `for i, v := range s` of the same length?**

<details>
<summary>Answer</summary>

Slice iteration is pointer arithmetic with cached length and BCE — ~1 ns/elem. Map iteration calls `runtime.mapiternext` per element (tophash scan, key compare, overflow chain, concurrent-write check, wrap-around) — ~10–20 ns/elem. Intrinsic to the data structure. For stable maps with hot iteration, materialise into a slice once.

</details>

**5. Calling `next()` from a different goroutine than `Pull` was created in — what happens?**

<details>
<summary>Answer</summary>

`runtime.coro` is bound to its creating goroutine. Cross-goroutine `coroswitch` panics. Pull is single-consumer. For fan-out, build a channel layer on top.

</details>

**6. Why does this code *not* allocate, even though the yield body captures state?**

```go
func sumAll(seqs []iter.Seq[int]) int {
    total := 0
    for _, seq := range seqs {
        for v := range seq { total += v }
    }
    return total
}
```

<details>
<summary>Answer</summary>

The yield closure captures `&total` but stays on the stack: it doesn't outlive `sumAll`, and each inner `seq(yield)` returns before the outer loop iterates. One stack slot is reused across all inner ranges. Heap alloc happens only if one of the `seqs[i]` producers is misbehaved.

</details>

---

## 22. Summary

- Go 1.23's range-over-func compiles `for v := range seq` into `seq(func(v) bool { body; return true })`. The for body becomes the yield closure body. Rewrite is in `src/cmd/compile/internal/rangefunc/rewrite.go`, before SSA.
- `break`/`return`/`goto label` inside the body are encoded as state variables: body sets `state`, returns false; after the producer returns, a wrapper switch dispatches.
- The yield closure typically stack-allocates because well-behaved producers don't outlive it. Per-range: 0 heap allocs. Per-element: 1 funcval indirect call ≈ 2 ns.
- Producers that close over local state allocate ~16 B per construction. Hoist `count(N)`-style producer constructors outside hot paths. Closure-free producers (plain functions converted via `iter.Seq[T](funcName)`) are zero-allocation.
- `iter.Pull(seq)` converts push to pull via `runtime.coro` (Go 1.23+): a stack-switching primitive. Per-element: ~30–40 ns (vs ~2 ns for direct push). Memory: ~1 KB per Pull (vs ~10 KB for channel-based). `defer stop()` is mandatory.
- Range over slice is lowered (in `walk/range.go`) to pointer arithmetic with the length cached at loop entry. The SSA `prove` pass elides per-element bounds checks. Per-element: ~0.4 ns.
- Range over map calls `runtime.mapiterinit` (which randomises start bucket and offset via `fastrand()`) and `runtime.mapiternext` per element. Per-element: ~10–20 ns — ~10× slower than slice.
- Range over channel calls `runtime.chanrecv2` per element. Per-element: ~30–40 ns buffered, ~150–200 ns unbuffered.
- Pre-1.23 channel iterators cost ~100 ns/element + ~10 KB per iterator. `iter.Seq` matches their semantics at ~50× lower cost. Channel iterators remain right when concurrent producer/consumer is the goal.
- The yield function value is a funcval (PC + captures). Producer calls it via R15 + indirect CALL; body accesses captures via `MOVQ N(R15), reg`.
- Composition of `iter.Seq` (Filter, Map, Take) is a chain of closures. Per-element cost grows linearly with depth — same model as the decorator pattern with iface dispatch replaced by funcval dispatch. ~2 ns per layer.
- `bufio.Scanner` is the canonical hand-rolled `Next()/Value()`: state machine, `Scan() bool` advances, `Text()`/`Bytes()` extracts. `sql.Rows` is the canonical iterator-with-cleanup: `Next()`/`Scan(&dst...)`/`Close()`/`Err()`. `defer rows.Close()` is mandatory.
- Per-element cost ordering (Go 1.23, no PGO): slice (0.4 ns) < `iter.Seq` (0.8 ns) ≈ hand-rolled `Next()` (0.8 ns) < `iter.Pull` (5 ns) < map (10–20 ns) < channel buf (~10–40 ns) < channel unbuf (~150–200 ns). With PGO, `iter.Seq` drops to ~0.6 ns.
- The deepest truth: `iter.Seq` is structurally a function value invoked once per element via funcval indirect. Runtime cost is dominated by that single indirect — ~2 ns. Escape analysis, closure capture, break/return/goto encoding, PGO devirt, `runtime.coro` for Pull — all of it is the compiler making the source-level shape efficient. The pattern itself is just "call yield per element"; the engineering is in making yield's call site as cheap as a slice index.

---

## 23. Further reading

- Range-over-func rewriter: `src/cmd/compile/internal/rangefunc/rewrite.go`. Dense but readable; the `break`/`return`/`goto` encoding lives in `rewriteContinue`/`rewriteReturn`.
- Classical range lowering: `src/cmd/compile/internal/walk/range.go`. `walkRangeSlice`, `walkRangeMap`, `walkRangeChan`.
- The `iter` package: `src/iter/iter.go` (Go 1.23+). `Seq`, `Seq2`, `Pull`, `Pull2`.
- `runtime.coro` primitive: `src/runtime/coro.go` (Go 1.23+). `newcoro`, `coroswitch`.
- Map iterator: `src/runtime/map.go`. `hmap`, `bmap`, `hiter`; `mapiterinit` and `mapiternext`.
- Channel iterator: `src/runtime/chan.go`. `hchan`; `chanrecv`/`chanrecv2`.
- `bufio.Scanner`: `src/bufio/scan.go`. The canonical hand-rolled `Next()/Value()` iterator.
- `sql.Rows`: `src/database/sql/sql.go`. The canonical iterator-with-cleanup.
- Escape analysis: `src/cmd/compile/internal/escape/escape.go`. `escapeClosure`.
- Inliner: `src/cmd/compile/internal/inline/inl.go`. The funcval-indirect-call wall.
- PGO devirtualization: `src/cmd/compile/internal/devirtualize/pgo.go`. Specialises monomorphic yield call sites.
- Per-iteration loop-variable freshness (Go 1.22+): the spec change at https://go.dev/blog/loopvar-preview; implementation in `src/cmd/compile/internal/loopvar/loopvar.go`.
- Related: `../06-factory-pattern/professional.md` — funcval layout and closure escape; this file builds on its model.
- Related: `../04-decorator-pattern/professional.md` — closure capture, R15 calling convention, chained dispatch cost. The composed-`iter.Seq` cost model is the funcval analogue of the decorator pattern's iface chain.
- Related: `../03-strategy-pattern/professional.md` — iface dispatch, itab cache, devirtualization. The inliner's wall at indirect calls.
- Related: junior.md and middle.md in this directory — the user-level and design-level perspectives this file complements with runtime detail.
