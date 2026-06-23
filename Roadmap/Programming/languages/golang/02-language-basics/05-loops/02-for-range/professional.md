# for range — Professional Level (Internals, Compiler, Memory, Assembly)

## 1. AST Representation of for range

The Go parser produces an `*ast.RangeStmt` node:

```go
// go/ast package (simplified)
type RangeStmt struct {
    For        token.Pos   // position of "for" keyword
    Key        Expr        // Key = first variable (may be nil)
    Value      Expr        // Value = second variable (may be nil)
    TokPos     token.Pos   // position of Tok
    Tok        token.Token // ILLEGAL if Key == nil, ASSIGN, DEFINE
    X          Expr        // value to range over
    Body       *BlockStmt
}
```

The type checker resolves `X` and determines which runtime path to use: slice, array, map, string, channel, or integer (Go 1.22+).

---

## 2. SSA Representation

After type checking, the compiler generates Static Single Assignment (SSA) form. For a slice range:

```
// for i, v := range s { use(i, v) }
// SSA (simplified):

b0:
    t0 = s                          // range expression captured
    t1 = len(t0)                    // length captured once
    t2 = 0                          // i = 0
    jump b1

b1:                                 // loop header
    t3 = t2 < t1                    // i < len
    if t3 goto b2 else b3

b2:                                 // loop body
    t4 = &t0[t2]                    // address of element
    t5 = *t4                        // load (copy) — v
    use(t2, t5)
    t6 = t2 + 1                     // i++
    t2 = t6
    jump b1

b3:                                 // exit
```

---

## 3. Generated Assembly: Slice Range

```go
package main

func sumSlice(s []int) int {
    sum := 0
    for _, v := range s {
        sum += v
    }
    return sum
}
```

```bash
go tool compile -S main.go
```

Approximate x86-64 output (gc compiler):

```asm
TEXT main.sumSlice(SB)
    MOVQ    "".s+8(SP), AX   // AX = len(s)
    MOVQ    "".s+0(SP), CX   // CX = data pointer
    XORL    BX, BX           // sum = 0
    XORL    DX, DX           // i = 0
    TESTQ   AX, AX
    JLE     done
loop:
    MOVQ    0(CX)(DX*8), SI  // SI = s[i]  (8 bytes per int)
    ADDQ    SI, BX           // sum += s[i]
    INCQ    DX               // i++
    CMPQ    DX, AX           // i < len?
    JL      loop
done:
    MOVQ    BX, "".~r0+24(SP)
    RET
```

Note: No bounds check in the loop body — BCE eliminated it. The length is loaded once into AX before the loop.

---

## 4. Map Range: hiter and Runtime Functions

When the compiler sees `for k, v := range m`, it generates calls to:

- `runtime.mapiterinit(maptype, hmap, hiter)` — initialize iterator
- `runtime.mapiternext(hiter)` — advance to next element

```go
// runtime/map.go (Go source, simplified)
type hiter struct {
    key         unsafe.Pointer  // pointer to current key
    elem        unsafe.Pointer  // pointer to current value
    t           *maptype
    h           *hmap
    buckets     unsafe.Pointer  // starting bucket
    bptr        *bmap           // current bucket
    overflow    *[]*bmap
    oldoverflow *[]*bmap
    startBucket uintptr         // bucket iteration started at
    offset      uint8           // intra-bucket offset
    wrapped     bool            // already wrapped around
    B           uint8
    i           uint8
    bucket      uintptr
    checkBucket uintptr
}

func mapiterinit(t *maptype, h *hmap, it *hiter) {
    // ...
    // Randomize starting bucket using fastrand
    r := uintptr(fastrand())
    it.startBucket = r & bucketMask(h.B)
    it.offset = uint8(r >> h.B & (bucketCnt - 1))
    // ...
}
```

The randomization is intentional: it prevents code from accidentally depending on map order, and mitigates hash-flooding DoS attacks.

---

## 5. String Range: UTF-8 Decoding in the Compiler

```go
// for i, r := range s { ... }
// Compiler generates approximately:
{
    _s := s
    _i := 0
    for _i < len(_s) {
        i := _i
        var r rune
        if _s[_i] < utf8.RuneSelf {
            r = rune(_s[_i])
            _i++
        } else {
            r, _size := utf8.DecodeRuneInString(_s[_i:])
            _i += _size
        }
        // loop body with i and r
    }
}
```

The fast path for ASCII (byte < 128) avoids the function call. Multi-byte characters go through `utf8.DecodeRuneInString`.

---

## 6. Channel Range: chanrecv Internals

```go
// for v := range ch { use(v) }
// Desugars to:
for {
    v, ok := <-ch  // calls runtime.chanrecv
    if !ok { break }
    use(v)
}

// runtime/chan.go
func chanrecv(c *hchan, ep unsafe.Pointer, block bool) (selected, received bool) {
    // If channel is nil and block=true: goroutine parks forever
    // If channel is empty and closed: return zero value, received=false
    // If channel is empty and open: park goroutine (block=true)
    // If channel has data: copy from buffer or sender
}
```

The loop exits when `chanrecv` returns `received=false` (channel closed and empty).

---

## 7. Integer Range (Go 1.22+): Compiler Implementation

```go
// for i := range n { use(i) }
// Desugars to:
for i := 0; i < n; i++ {
    use(i)
}
```

The compiler type-checks that `n` is an integer type. Negative values produce zero iterations (same as `n <= 0`). The generated assembly is identical to a classic for loop.

---

## 8. Memory Allocation in for range

```go
// No allocation cases:
for i, v := range []int{1, 2, 3} { _ = i; _ = v }  // literal: may allocate once for literal
for k, v := range m { _, _ = k, v }                  // no alloc (map allocs pre-exist)
for i, r := range "hello" { _, _ = i, r }             // no alloc (string is immutable)
for v := range ch { _ = v }                           // no alloc (receives in place)

// The hiter struct for map range lives on the stack (if not too large)
// Stack allocation is elided by the compiler when the iterator doesn't escape
```

---

## 9. Bounds Check Elimination: Detailed Analysis

```go
package main

// BCE demo
func copy1(dst, src []int) {
    // NOT BCE-optimal: independent bound checks
    for i := 0; i < len(src); i++ {
        dst[i] = src[i] // two bounds checks per iteration
    }
}

func copy2(dst, src []int) {
    // BCE-optimal: range gives compiler proof that i ∈ [0, len(src))
    // The dst[i] still requires a check unless dst is proven same length
    for i, v := range src {
        dst[i] = v
    }
}

func copy3(dst, src []int) {
    // Fully BCE: hint compiler that dst is large enough
    dst = dst[:len(src)] // compiler now knows dst[i] is safe for i in src range
    for i, v := range src {
        dst[i] = v // no bounds checks!
    }
}
```

The `dst = dst[:len(src)]` pattern is a well-known BCE hint used in the Go standard library.

---

## 10. Goroutine Stack Growth and Range

Each goroutine starts with a small stack (2KB in modern Go). Range loops involving large local variables or deep call chains can trigger stack growth:

```go
func rangeWithLargeLocal(s []int) {
    for _, v := range s {
        var buf [4096]byte  // 4KB local — may trigger stack growth
        process(buf[:], v)
    }
}
```

Stack growth is handled by `runtime.morestack`. The loop body is essentially a function call boundary where the stack can grow. After Go 1.4, stacks are contiguous and can grow dynamically.

---

## 11. Profiling Range with pprof Annotations

```go
package main

import (
    "context"
    "runtime/trace"
)

func processWithTrace(ctx context.Context, items []int) {
    ctx, task := trace.NewTask(ctx, "processItems")
    defer task.End()

    for i, item := range items {
        region := trace.StartRegion(ctx, "item")
        heavyProcess(i, item)
        region.End()
    }
}
```

The trace tool (`go tool trace`) can show time spent per range iteration.

---

## 12. Inlining and Range

```go
// Small functions called inside range are inlined by the compiler
func double(x int) int { return x * 2 } // will be inlined

func main() {
    s := []int{1, 2, 3}
    for i, v := range s {
        s[i] = double(v) // double() inlined — no function call overhead
    }
}
```

The inlining budget (currently ~80 AST nodes) determines if the called function is inlined. Range loop bodies are not themselves inlined — they are unrolled only by the CPU's speculative execution.

---

## 13. Loop Unrolling by the Compiler

The gc compiler does not perform aggressive loop unrolling (unlike C++ compilers with -O3). However, the CPU's out-of-order execution effectively "unrolls" small loops via instruction-level parallelism.

```asm
; After BCE elimination, the loop body is minimal:
; for _, v := range []int{...}
loop:
    MOVQ  (CX)(DX*8), SI   ; load v
    ADDQ  SI, BX           ; sum += v
    INCQ  DX               ; i++
    CMPQ  DX, AX           ; i < len?
    JL    loop
```

Modern Intel CPUs execute 3-4 instructions per clock cycle — this loop runs at near-memory-bandwidth speed.

---

## 14. reflect.Value and Range

```go
package main

import (
    "fmt"
    "reflect"
)

func reflectRange(v interface{}) {
    rv := reflect.ValueOf(v)
    switch rv.Kind() {
    case reflect.Slice, reflect.Array:
        for i := 0; i < rv.Len(); i++ {
            fmt.Println(i, rv.Index(i).Interface())
        }
    case reflect.Map:
        for _, k := range rv.MapKeys() {
            fmt.Println(k.Interface(), rv.MapIndex(k).Interface())
        }
    case reflect.String:
        s := rv.String()
        for i, r := range s {
            fmt.Println(i, r)
        }
    }
}

func main() {
    reflectRange([]int{1, 2, 3})
}
```

Reflection-based iteration is 10-50x slower than direct range. Use only for generic code where type is truly unknown at compile time.

---

## 15. Compiler Flags and Range Optimization

```bash
# View SSA phases including range lowering
GOSSAFUNC=sumSlice go build main.go
# Opens ssa.html showing all optimization passes

# Disable optimizations (for comparison)
go build -gcflags="-N -l" main.go

# Check BCE eliminated
go build -gcflags="-d=ssa/check_bce/debug=1" main.go

# Verbose escape analysis
go build -gcflags="-m=2" main.go

# Assembly output
go tool compile -S main.go

# Disassemble binary
go tool objdump -s main.sumSlice a.out
```

---

## 16. Runtime Overhead Comparison Table

| Range Type | Runtime Cost | Allocation | Notes |
|---|---|---|---|
| Slice (int) | ~1 ns/elem | None | Near memory bandwidth |
| Slice (struct copy) | Varies | None (stack) | Proportional to struct size |
| Array (copy) | ~same as slice | None | Range over array value copies entire array! |
| Map (int→int) | ~100 ns/elem | hiter (stack) | Hash table traversal, cache misses |
| String (ASCII) | ~1 ns/char | None | Fast path: no utf8 decode |
| String (multi-byte) | ~5 ns/char | None | utf8.DecodeRuneInString called |
| Channel (buffered) | ~50-100 ns/recv | None | Lock + condition variable |
| Channel (unbuffered) | ~200 ns/recv | None | Goroutine synchronization |
| Integer (1.22+) | ~0.3 ns/iter | None | Simple counter, usually vectorized |
