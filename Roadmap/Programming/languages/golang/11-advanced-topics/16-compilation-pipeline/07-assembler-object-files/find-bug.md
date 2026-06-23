# Assembler & Object Files — Find the Bug

Fourteen scenarios drawn from real classes of Go-assembly mistakes. Each gives the code or symptom, the cause, and the fix. The unifying theme: assembly bugs are *silent* — the build often succeeds and the program corrupts memory at runtime. `go vet` (the `asmdecl` pass) and differential tests against a Go fallback are your real defenses.

## Bug 1 — Wrong `argsize` in TEXT

```
// func Add(a, b int) int   // 24 bytes of args+result
TEXT ·Add(SB), NOSPLIT, $0-16   // BUG: says 16, should be 24
    MOVQ a+0(FP), AX
    MOVQ b+8(FP), BX
    ADDQ BX, AX
    MOVQ AX, ret+16(FP)
    RET
```

**Symptom:** `go vet` fails; or if vet is skipped, the GC's stack map for this frame is wrong → crashes during GC/stack growth.
**Cause:** `-16` undercounts the 24-byte args+result block (two `int` args + one `int` result).
**Fix:** `TEXT ·Add(SB), NOSPLIT, $0-24`. Compute argsize as the *aligned* total of args+results from the Go signature; let `go vet` confirm it.

## Bug 2 — FP offset off by a field's size

```
// func Add(a, b int) int
    MOVQ a+0(FP), AX
    MOVQ b+4(FP), BX   // BUG: int is 8 bytes, b is at offset 8 not 4
```

**Symptom:** `go vet`: `invalid offset b+4(FP); expected b+8(FP)`. Without vet: garbage second operand.
**Cause:** Treated `int` as 4 bytes. On 64-bit, `int` is 8 bytes, so `b` sits at offset 8.
**Fix:** `MOVQ b+8(FP), BX`. Use the type-size table; vet validates every `name+off(FP)`.

## Bug 3 — Wrong move width for the type

```
// func Lo(x int64) int32
    MOVQ x+0(FP), AX
    MOVQ AX, ret+8(FP)   // BUG: result is int32 (4 bytes), MOVQ writes 8
```

**Symptom:** vet: width mismatch at `ret+8(FP)`; or you clobber 4 bytes past the result slot.
**Cause:** Used `MOVQ` (8-byte) to store into a 4-byte `int32` slot.
**Fix:** `MOVL AX, ret+8(FP)` — `MOVL` writes 4 bytes. Match the mnemonic width to the field size.

## Bug 4 — Missing NOSPLIT on a runtime-context leaf

```
TEXT ·fastpath(SB), $0-8   // BUG: no NOSPLIT, called where stack can't grow
    ...
    RET
```

**Symptom:** Crash/deadlock when called from a no-stack-growth context (signal handler, during stack copy), because the inserted morestack preamble tried to grow the stack illegally.
**Cause:** Without `NOSPLIT` the toolchain inserts the stack-split preamble.
**Fix:** `TEXT ·fastpath(SB), NOSPLIT, $0-8` — but only because this is a tiny leaf. NOSPLIT is a correctness statement, not free decoration.

## Bug 5 — NOSPLIT with too-big a frame → nosplit overflow

```
TEXT ·bigbuf(SB), NOSPLIT, $4096-0   // BUG: huge frame under NOSPLIT
    ...
```

**Symptom:** Link error: `nosplit stack overflow`.
**Cause:** NOSPLIT functions draw from a small reserved nosplit budget; a 4 KB frame blows it, especially in a chain of NOSPLIT callers.
**Fix:** Drop `NOSPLIT` (let the preamble handle growth) or shrink the frame. NOSPLIT is for *small* leaf frames.

## Bug 6 — Missing `//go:noescape` forces allocation

```go
// no pragma
func xorBytes(dst, a, b *byte, n int)
```

**Symptom:** Benchmarks show heap allocations at every call site; pointers escape.
**Cause:** With a body-less function the compiler can't analyze escapes, so it assumes pointer args escape → forces heap allocation.
**Fix:** Add `//go:noescape` above the declaration — *but only if the asm truly never retains the pointers past the call* (see Bug 7).

## Bug 7 — `//go:noescape` that lies

```go
//go:noescape
func register(p *T)   // asm stashes p into a global slice
```

**Symptom:** Intermittent corruption / use-after-free; race detector may not catch it.
**Cause:** `//go:noescape` promised no pointer escapes, so the compiler stack-allocated `*T`; the asm then kept the pointer beyond the call. The object is freed/reused while still referenced.
**Fix:** Remove `//go:noescape` (the pointer *does* escape), or rewrite the asm so it doesn't retain the pointer. The pragma is a contract; honor it.

## Bug 8 — ABI mismatch: ABIInternal symbol reading FP

```
TEXT ·dot(SB), NOSPLIT|ABIInternal, $0-24
    MOVQ a+0(FP), AX   // BUG: ABIInternal passes args in registers, not FP
    MOVQ b+8(FP), BX
```

**Symptom:** Garbage arguments; wrong results or crash.
**Cause:** Declared `ABIInternal` (register-based) but read args from the stack via `FP` as if ABI0.
**Fix:** Either drop `ABIInternal` to use ABI0 (then `FP` is correct), or keep `ABIInternal` and read the real argument registers per the ABI (amd64: AX, BX, CX, ...). For hand-written asm, ABI0 is usually the safer choice.

## Bug 9 — Forgetting the Go stub (or mismatched name)

```
// add_amd64.s defines ·Add, but no Go declaration exists
```

**Symptom:** Link error: `undefined: Add` (Go side), or the asm symbol is dead-code-eliminated.
**Cause:** The body-less Go declaration is required to give the compiler a callable name bound to the symbol.
**Fix:** Add `func Add(a, b int) int` (no body) in a Go file of the same package, with the exact name.

## Bug 10 — Missing `NOPTR` on pointer-free data → GC misread

```
GLOBL ·table(SB), $64        // BUG: writable data, no NOPTR, holds raw offsets
DATA  ·table+0(SB)/8, $0x10
```

**Symptom:** Random crashes during GC; the collector treats table bytes as pointers and follows garbage.
**Cause:** Without `NOPTR`, the GC scans the (writable) symbol's words as potential pointers.
**Fix:** `GLOBL ·table(SB), NOPTR|RODATA, $64` — mark it pointer-free, and `RODATA` if it's constant.

## Bug 11 — DATA widths don't tile the GLOBL size

```
GLOBL ·mask(SB), RODATA|NOPTR, $16
DATA  ·mask+0(SB)/8, $0xff   // only 8 of 16 bytes initialized
```

**Symptom:** Assembler error or zero-filled tail you didn't intend; sometimes a layout/relocation surprise.
**Cause:** `DATA` directives must exactly cover the declared `$size`. Here only bytes 0–7 are set.
**Fix:** Add `DATA ·mask+8(SB)/8, $0xff` so the two `DATA`s tile all 16 bytes.

## Bug 12 — Stale `argsize` after a signature change

```go
func Frob(a int32, b int64) int   // someone added b later
```
```
TEXT ·Frob(SB), NOSPLIT, $0-12    // BUG: still the old size for (int32)int
```

**Symptom:** vet failure, or wrong stack map → GC crash.
**Cause:** The Go signature grew but the `.s` `-argsize` and FP offsets weren't updated.
**Fix:** Recompute: `a`@0 (4) + pad + `b`@8 (8) + `ret`@16 (8) = 24 → `$0-24`, and fix all `(FP)` offsets. Run `go vet`. **Lesson:** any signature change demands an asm review.

## Bug 13 — Hardware SP vs pseudo-SP confusion

```
TEXT ·f(SB), $16-0
    MOVQ $42, x-8(SP)   // pseudo-SP local — fine
    MOVQ $7, 0(SP)      // hardware-SP outgoing-arg slot — DIFFERENT location
    CALL ·g(SB)
```

**Symptom:** Local you "stored" isn't where you read it; outgoing call gets the wrong arg.
**Cause:** `x-8(SP)` (named offset) is the *pseudo* stack pointer; bare `0(SP)` is the *hardware* SP used for outgoing args. They are different views.
**Fix:** Keep them straight: use `name-off(SP)` for locals, bare `off(SP)` only for outgoing call arguments, and ensure the frame size reserves room for both.

## Bug 14 — Relocation form wrong for PIE/global reference

```
TEXT ·load(SB), NOSPLIT, $0-8
    MOVQ ·global(SB), AX   // absolute reference; breaks under -buildmode=pie
```

**Symptom:** Works in a normal build, fails or relocates wrong under `-buildmode=pie` / position-independent linking.
**Cause:** An absolute `R_ADDR`-style reference where the link mode needs a PC-relative (`R_PCREL`) form.
**Fix:** Use the architecture's PC-relative addressing idiom for `(SB)` data loads (on amd64 the assembler emits a PC-relative form for `sym(SB)` operands automatically in the right context — write the operand as the guide shows and let `cmd/asm` choose). Test under the link modes you ship.

## Summary

The recurring lessons: (1) the `TEXT` `$frame-args` numbers and every `name+off(FP)` must match the Go signature's *sizes and offsets* exactly — `go vet`'s `asmdecl` is non-negotiable; (2) `NOSPLIT` is a correctness claim, safe only for small leaf frames and fatal when overused (`nosplit stack overflow`); (3) `//go:noescape` is a contract — use it to avoid allocation only when pointers genuinely don't escape; (4) ABI0 vs ABIInternal must agree with how you read arguments (prefer ABI0); (5) data needs the right flags (`NOPTR`, `RODATA`) and `DATA` must tile the `GLOBL` size; and (6) signature changes require re-auditing the `.s`. Pair vet with differential/fuzz tests against a Go fallback on every target arch.
