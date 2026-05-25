# Go Assembly — Find the Bug

A collection of realistic Go-assembly bugs. For each: the code, the symptom, the (often subtle) cause, and the fix. Reading them in order builds the intuition you need to diagnose assembly issues in the wild. The patterns repeat — wrong offsets, wrong flags, wrong assumptions about the runtime — but each surfaces differently.

---

## Bug 1: The wrong FP offset

```
// func Add(a, b int64) int64
TEXT ·Add(SB), NOSPLIT, $0-24
    MOVQ a+0(FP), AX
    MOVQ b+16(FP), BX     // WRONG: should be +8
    ADDQ BX, AX
    MOVQ AX, ret+16(FP)
    RET
```

**Symptom.** `Add(2, 3)` returns 2 (or a stack-resident garbage value plus 2). `Add(2, 3)` then writes the result into `b`'s slot, corrupting whatever the caller had there.

**Cause.** Int64 args are 8 bytes apart. The second argument is at `+8`, not `+16`. The `+16` slot is the return value's location.

**Fix.**

```
MOVQ b+8(FP), BX
MOVQ AX, ret+16(FP)
```

`go vet` catches this when offsets are named ("unknown variable") if the names don't match the Go declaration. Always name your FP offsets — `a+0(FP)`, not `0(FP)` — and vet will diff them against the signature.

---

## Bug 2: Missing NOSPLIT on a tiny function

```
TEXT ·FastInc(SB), $0-16
    MOVQ x+0(FP), AX
    INCQ AX
    MOVQ AX, ret+8(FP)
    RET
```

**Symptom.** A microbenchmark of `FastInc` is 2× slower than expected. The prologue dominates the body.

**Cause.** Without `NOSPLIT`, the function gets a stack-growth check prologue:

```
CMPQ SP, 16(R14)
JLS  morestack
SUBQ $0, SP        // frame alloc
...
ADDQ $0, SP
RET
```

For a single-instruction body, that's >10× overhead.

**Fix.**

```
TEXT ·FastInc(SB), NOSPLIT, $0-16
```

But verify: the function must be a leaf (no `CALL`) and the budget (frame + caller) must fit the `NOSPLIT` ceiling. For an `INCQ`, both conditions trivially hold.

---

## Bug 3: NOSPLIT chain blowing the stack

```
TEXT ·Outer(SB), NOSPLIT, $64-0
    SUBQ $64, SP
    CALL ·Middle(SB)
    ADDQ $64, SP
    RET

TEXT ·Middle(SB), NOSPLIT, $128-0
    SUBQ $128, SP
    CALL ·Inner(SB)
    ADDQ $128, SP
    RET

TEXT ·Inner(SB), NOSPLIT, $512-0
    ...
```

**Symptom.** Linker error: `nosplit stack overflow`. Or — worse — it builds, runs, and segfaults when the chain executes near a low stack guard.

**Cause.** The linker computes the worst-case sum of `NOSPLIT` frames along every call chain and compares to a fixed budget (currently 792 bytes on amd64). 64+128+512 = 704, plus per-call save areas, exceeds the budget.

**Fix.** Drop `NOSPLIT` on the deepest function (`Inner`), or refactor so the chain isn't all `NOSPLIT`. Only the truly hot tiny leaves benefit from `NOSPLIT`; pushing it into deep chains is almost always a mistake.

---

## Bug 4: ABI0 vs ABIInternal mismatch

```go
// fast.go
//go:noescape
func Hash(p []byte) uint64
```

```
// fast_amd64.s
TEXT ·Hash<ABIInternal>(SB), NOSPLIT, $0
    // assumes args in AX, BX, CX
    ...
```

**Symptom.** `Hash` returns wildly wrong results, or segfaults. Works in isolation but breaks when called from certain Go contexts.

**Cause.** The Go declaration uses default ABI0 (stack args). The assembly uses ABIInternal (register args). The toolchain inserts no wrapper because the assembly opted into ABIInternal. The two halves disagree.

**Fix.** Either remove `<ABIInternal>` and read args from FP, or accept that the Go signature must match. The pragmatic choice: stay on ABI0 unless you have a measured reason to need ABIInternal.

```
TEXT ·Hash(SB), NOSPLIT, $0-32
    MOVQ p_base+0(FP), SI
    MOVQ p_len+8(FP), CX
    ...
    MOVQ AX, ret+24(FP)
    RET
```

---

## Bug 5: Missing write barrier on pointer store

```
// func storePtr(slot **Node, val *Node)
TEXT ·storePtr(SB), NOSPLIT, $0-16
    MOVQ slot+0(FP), DI
    MOVQ val+8(FP), SI
    MOVQ SI, (DI)
    RET
```

**Symptom.** Intermittent crashes during GC, often as "fatal error: scanobject: span hasn't grown" or "found bad pointer". Reproduces under load, vanishes under debugger.

**Cause.** Storing a pointer to GC-tracked memory **must** invoke the write barrier during the mark phase. A bare `MOVQ` skips it. The GC then misses the new pointer, may free the pointee, and a later dereference reads freed memory.

**Fix.** Call `runtime.gcWriteBarrier`:

```
MOVQ slot+0(FP), DI
MOVQ val+8(FP), SI
CALL runtime·gcWriteBarrier(SB)   // expects slot in DI, val in SI
RET
```

Better: don't write data-structure code in assembly. Pointer stores are exactly the case where the Go compiler's automatic barrier is doing important work.

---

## Bug 6: Wrong register clobber

```
TEXT ·DoubleSum(SB), NOSPLIT, $0-32
    MOVQ xs_base+0(FP), SI
    MOVQ xs_len+8(FP), CX
    XORQ AX, AX
loop:
    MOVQ (SI), DX
    ADDQ DX, AX
    SHLQ $1, DX
    ADDQ DX, AX
    ADDQ $8, SI
    DECQ CX
    JNZ loop
    MOVQ AX, ret+24(FP)
    CALL runtime·printlock(SB)    // debug print
    RET
```

**Symptom.** The result is wrong when the debug print is uncommented. Comment it out and it's correct.

**Cause.** `CALL runtime·printlock(SB)` clobbers caller-saved registers (per the Go internal ABI, that's most GP registers). The Go caller restores them, but inside this function, `AX` is gone — and `MOVQ AX, ret+24(FP)` ran *before* the call, so the return value is already on the stack. But if you were using `AX` after the call, it would be garbage.

**Fix.** This particular code is fine because the store happens first. But the lesson generalizes: across any `CALL`, treat all caller-saved registers as garbage. Save what you need to the stack frame, or finish using them before the call.

For a real fix to a related bug:

```
loop:
    ...
    MOVQ AX, 0(SP)         // save result before call
    CALL runtime·printlock(SB)
    MOVQ 0(SP), AX
    ...
```

(With a non-zero frame size to make room: `TEXT ·DoubleSum(SB), NOSPLIT, $16-32`.)

---

## Bug 7: AVX state not preserved (the AVX-SSE transition penalty)

```
TEXT ·VectorOp(SB), NOSPLIT, $0-32
    VPXOR Y0, Y0, Y0
    // ... uses Y registers ...
    MOVQ result, ret+24(FP)
    RET                    // returns with upper YMM bits still in "dirty" state
```

**Symptom.** Calling `VectorOp` in a tight loop with surrounding scalar SSE code is much slower than expected. `perf stat` shows hundreds of thousands of AVX-SSE transition cycles.

**Cause.** On Intel CPUs (Sandy Bridge through Skylake-X), mixing AVX-encoded VEX instructions with legacy SSE instructions costs ~70 cycles per transition. The CPU saves the upper YMM halves to a hidden register, restores them when AVX runs again, etc. You enter the slow path on every transition.

**Fix.** Always `VZEROUPPER` (or `VZEROALL`) before returning from a function that used Y registers:

```
    VZEROUPPER
    RET
```

`VZEROUPPER` is cheap (zero or one cycle). Skipping it is one of the most common SIMD bugs. AMD CPUs handle this better, but assume Intel-worst-case for portability.

---

## Bug 8: SIMD on unaligned data

```
TEXT ·Sum(SB), NOSPLIT, $0-32
    MOVQ xs_base+0(FP), SI
    ...
    MOVAPS (SI), X0       // aligned load
    ...
```

**Symptom.** `SIGSEGV: segmentation violation` on some inputs, not others.

**Cause.** `MOVAPS` requires 16-byte alignment. Go slice backing arrays are *not* guaranteed to be 16-byte aligned (they're 8-byte aligned on 64-bit platforms). A slice obtained from elsewhere may start at an 8-byte offset and crash on `MOVAPS`.

**Fix.** Use the unaligned variant:

```
MOVUPS (SI), X0
```

Or for AVX, `VMOVDQU` instead of `VMOVDQA`. Modern Intel CPUs (Nehalem+) have nearly identical performance for aligned and unaligned loads when the address *happens* to be aligned. The cost of unaligned is paid only when crossing a cache line, which is rare. Default to unaligned variants and don't worry about it.

---

## Bug 9: Calling assembly without `//go:noescape`

```go
// pkg.go
package pkg

func ProcessBuffer(p []byte) int
```

```
// pkg_amd64.s
TEXT ·ProcessBuffer(SB), NOSPLIT, $0-32
    ...
```

**Symptom.** Calling `ProcessBuffer(make([]byte, 1024))` allocates the slice on the heap when, without the assembly, it would be stack-allocated. Allocations climb in profile.

**Cause.** The compiler sees a function declaration with no Go body. It can't analyze whether `p` escapes through the call. To stay safe, it assumes `p` escapes — forcing the backing array to the heap.

**Fix.** Add `//go:noescape` to the Go declaration:

```go
//go:noescape
func ProcessBuffer(p []byte) int
```

You're asserting to the compiler that pointer arguments don't escape via this function. If your assembly *does* leak the pointer (e.g., stashes it in a global), `//go:noescape` is wrong and creates use-after-free bugs. For SIMD math kernels, it's almost always correct.

---

## Bug 10: Building for the wrong architecture

```
// pkg/fast/fast.s
TEXT ·Hash(SB), NOSPLIT, $0-32
    VPXOR Y0, Y0, Y0      // AVX2 instruction
    ...
```

```go
// pkg/fast/fast.go
package fast

func Hash(p []byte) uint64
```

**Symptom.** `GOARCH=arm64 go build` fails with assembler errors. Or worse, builds but `Hash` is not the assembly version (silently uses no implementation, or hits a linker error about unresolved symbol).

**Cause.** No build constraint on the `.s` file. It's compiled for every architecture, but AVX2 only exists on amd64. arm64 has no `VPXOR Y0, Y0, Y0`.

**Fix.** Use the filename suffix `_amd64.s` for architecture restriction:

```
mv fast.s fast_amd64.s
```

The Go build system automatically applies the `//go:build amd64` constraint based on the filename. Add a parallel `fast_arm64.s` with NEON code, or a pure-Go fallback:

```go
// fast_other.go
//go:build !amd64 && !arm64
package fast

func Hash(p []byte) uint64 {
    // pure Go
}
```

---

## Bug 11: Stack-growth check in a signal handler

```
TEXT ·signalHandler(SB), $0-0
    // not NOSPLIT
    // ... handle signal ...
    RET
```

**Symptom.** Process crashes with "morestack on g0" or "fatal error: scheduler is running" when a signal fires.

**Cause.** Signal handlers run on the system stack (`g0`), which is not growable. The standard stack-growth prologue checks `g.stackguard` and calls `morestack` if the budget is exceeded — but `g0` doesn't support morestack. The runtime detects this and panics.

**Fix.** Make every function reachable from a signal handler `NOSPLIT`:

```
TEXT ·signalHandler(SB), NOSPLIT, $0-0
    ...
```

This is one of the few places where `NOSPLIT` is non-negotiable. Look at `runtime/sigtramp_*.s` for examples.

---

## Bug 12: Floating-point return value in wrong register

```go
// fast.go
//go:noescape
func Dot(a, b []float64) float64
```

```
// fast_amd64.s — WRONG
TEXT ·Dot(SB), NOSPLIT, $0-56
    ...
    MOVSD X0, ret+48(FP)
    RET
```

**Symptom.** With ABIInternal-using callers, the return value is read from `X0` directly — but the caller-vs-callee disagreement leads to wrong values.

**Cause.** On ABI0 (which is what this assembly defaults to), the return goes in the FP-relative slot. That works for an ABI0 caller; for an ABIInternal caller, the toolchain inserts a wrapper that reads from FP and returns in the right register. *That* works.

Actually this code is correct! The bug is more subtle when the float is written to the wrong slot offset. For `func(a, b []float64) float64`, layout: `a_base+0`, `a_len+8`, `a_cap+16`, `b_base+24`, `b_len+32`, `b_cap+40`, `ret+48`. If you mis-counted and wrote `ret+40(FP)`, you'd corrupt `b_cap` and the return value would be uninitialized.

**Fix.** Always name the offsets so `go vet` can verify:

```
TEXT ·Dot(SB), NOSPLIT, $0-56
    MOVQ a_base+0(FP), SI
    MOVQ a_len+8(FP), CX
    MOVQ b_base+24(FP), DI
    ...
    MOVSD X0, ret+48(FP)
    RET
```

Run `go vet ./...` — vet computes the layout from the Go signature and checks every named offset matches. This single tool catches the majority of FP-offset bugs.

---

## Bug 13: Forgetting to update assembly when changing the Go signature

```go
// before
func Sum(xs []int64) int64

// after — added a multiplier arg
func Sum(xs []int64, m int64) int64
```

The `.s` file:

```
TEXT ·Sum(SB), NOSPLIT, $0-32     // unchanged frame size
    MOVQ xs_base+0(FP), SI
    MOVQ xs_len+8(FP), CX
    MOVQ xs_cap+16(FP), DX
    // ret should be at +32 now (was +24)
    MOVQ AX, ret+24(FP)             // WRONG, writes into m
    RET
```

**Symptom.** Result is silently wrong. The new `m` parameter is overwritten with the return value; the return slot stays uninitialized.

**Cause.** The Go signature changed (adding `m int64` shifted the return slot from `+24` to `+32`), but the assembly wasn't updated.

**Fix.** Update everything — frame size, all offsets. With named offsets, `go vet` would have caught it:

```
TEXT ·Sum(SB), NOSPLIT, $0-40
    MOVQ xs_base+0(FP), SI
    MOVQ xs_len+8(FP), CX
    MOVQ xs_cap+16(FP), DX
    MOVQ m+24(FP), R8
    ...
    MOVQ AX, ret+32(FP)
    RET
```

**Lesson**: when you change a Go signature with associated assembly, run `go vet` before you run anything else. This is exactly the bug avo prevents by regenerating the FP layout from the signature.

---

## 14. Summary

Go-assembly bugs cluster into a small number of archetypes: wrong FP offsets (the #1 cause), wrong `TEXT` flags (`NOSPLIT` chains, missing `NOSPLIT` in signal paths), ABI mismatches (ABI0 vs ABIInternal), missing write barriers on pointer stores, register clobber after `CALL`, AVX/SSE transition cost, unaligned loads, build-constraint mistakes, and signature drift. `go vet` catches a surprising fraction. Property-based tests against a pure-Go reference catch most of the rest. The remainder require reading the disassembly with `go tool objdump` and understanding the runtime's contract. From here, [interview.md](interview.md) drills these as questions you might be asked, and [tasks.md](tasks.md) gives exercises to encounter the bugs first-hand.

---

## Further reading
- `cmd/asm` documentation: https://pkg.go.dev/cmd/asm
- `go vet` asm checks: https://pkg.go.dev/cmd/vet
- Runtime ABI internal: https://github.com/golang/go/blob/master/src/cmd/compile/abi-internal.md
- AVX-SSE transition penalty: https://www.agner.org/optimize/blog/read.php?i=761
- `runtime.gcWriteBarrier` source: https://github.com/golang/go/blob/master/src/runtime/asm_amd64.s
