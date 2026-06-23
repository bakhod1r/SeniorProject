# Code Generation — Find the Bug

Fourteen scenarios drawn from reading and writing assembly at the codegen boundary. Each has the **code/symptom**, the **cause**, and the **fix**. These are about *understanding what the compiler emitted* and *interacting with it correctly* — not application logic.

---

## Bug 1 — The intrinsic isn't firing (interface call)

**Code / symptom.** A hashing hot path uses `bits.RotateLeft64` through an abstraction:

```go
type Mixer interface{ Mix(uint64) uint64 }
type rot struct{}
func (rot) Mix(x uint64) uint64 { return bits.RotateLeft64(x, 13) }

func hash(m Mixer, x uint64) uint64 { return m.Mix(x) }
```

`go tool pprof -disasm` shows a `CALL math/bits.RotateLeft64` and the benchmark is 3× slower than expected.

**Cause.** The call goes through an interface (`m.Mix`), which is dynamically dispatched and **not inlined**. The intrinsic substitution happens during SSA generation of an *inlined* body; with no inlining, `RotateLeft64` stays a real call rather than collapsing to `ROLQ`.

**Fix.** Call the intrinsic on a concrete type so it can be inlined into the hot loop, or hoist the rotate out of the interface boundary:

```go
func mix(x uint64) uint64 { return bits.RotateLeft64(x, 13) } // concrete, inlinable
```

Verify with `go build -gcflags=-S`: you should now see `ROLQ $13, AX` and no `CALL`.

---

## Bug 2 — Wrong FP offset in an assembly stub

**Code / symptom.** A SIMD stub for `func dot(a, b []float64) float64`:

```asm
TEXT ·dot(SB), NOSPLIT, $0-56
	MOVQ a_base+0(FP), SI
	MOVQ b_base+8(FP), DI    // BUG
	MOVQ a_len+16(FP), CX    // BUG
	...
```

It returns garbage or crashes.

**Cause.** A slice header is `{ptr, len, cap}`, each 8 bytes, so one slice argument is **24 bytes** wide. `a` occupies `0..23`; `b` starts at offset **24**, not 8. `a_len` is at offset 8, not 16.

**Fix.** Use the correct offsets (and let `go vet`'s `asmdecl` check them):

```asm
	MOVQ a_base+0(FP),  SI
	MOVQ a_len+8(FP),   CX
	MOVQ b_base+24(FP), DI
```

Run `go vet ./...` — it cross-checks `.s` `(FP)` offsets against the Go signature and would have flagged this.

---

## Bug 3 — Assuming register args in an ABI0 stub

**Code / symptom.** Someone "modernized" a stub to read arguments from registers:

```asm
TEXT ·square(SB), NOSPLIT, $0-16
	IMULQ AX, AX       // assumes arg is in AX
	MOVQ  AX, ret+8(FP)
	RET
```

The function reads whatever was in `AX`, not the actual argument.

**Cause.** A plain `TEXT ·square(SB)` is **ABI0**: arguments arrive on the **stack** at `(FP)`, not in registers. Reading `AX` reads an undefined value (the linker's ABI wrapper marshals the register-ABI caller's args onto the stack before this runs).

**Fix.** Either read the stack (ABI0) …

```asm
TEXT ·square(SB), NOSPLIT, $0-16
	MOVQ x+0(FP), AX
	IMULQ AX, AX
	MOVQ AX, ret+8(FP)
	RET
```

… or explicitly opt into the register ABI with `TEXT ·square<ABIInternal>(SB)` and read `AX` (fragile; ABIInternal is unstable across releases).

---

## Bug 4 — Clobbering the g register

**Code / symptom.** A hand-written loop kernel uses `R14` as a scratch counter on amd64. Intermittently the program crashes deep in the runtime ("fatal: morestack on g0", corrupted goroutine).

**Cause.** On amd64 under ABIInternal, **`R14` holds the current goroutine pointer `g`**. The kernel overwrote it; any subsequent runtime interaction (preemption, stack growth, GC scan) read garbage.

**Fix.** Never use `R14` (amd64) or `R28` (arm64) as scratch in assembly. Pick a genuinely free register (e.g. `R12`/`R13`), or restructure so you don't need one. Likewise preserve `BP` when frame pointers are enabled.

---

## Bug 5 — Reading `-S` branch targets as addresses

**Code / symptom.** An engineer reports "the function jumps to address 18, but the function is only 27 bytes — that can't be right."

```
	0x0009 00009 (main.go:11)	JMP	18
```

**Cause.** In the **pre-link `-S` listing**, a jump target like `JMP 18` is a **byte offset within the function**, not an absolute address. The leftmost `0x0009` is the offset; the target `18` is the offset of the `CMPQ` at `0x0012`. Nothing is wrong.

**Fix.** To see absolute addresses and resolved targets, disassemble the *linked* binary: `go tool objdump -s 'main\.Sum' binary`. Don't mix pre-link and post-link views.

---

## Bug 6 — Missing write barrier reasoning ("the store isn't recorded")

**Code / symptom.** A reviewer worries that a raw pointer store via `unsafe` skips the GC write barrier:

```go
*(*unsafe.Pointer)(p) = unsafe.Pointer(obj)   // does this need a barrier?
```

They see no `runtime.gcWriteBarrier` in the assembly and conclude the GC is broken.

**Cause.** The compiler inserts write barriers for **typed pointer stores** it can see. A store through `unsafe.Pointer` to an `unsafe.Pointer` location *does* get a barrier (the compiler treats `unsafe.Pointer` as a pointer). But a store through a `*uintptr` would **not** — `uintptr` is not a pointer type, so the compiler emits a plain `MOVQ` and the GC never learns about the reference. That is the actual latent bug.

**Fix.** Never hold the only reference to a live object in a `uintptr`. Keep pointer-typed values (`unsafe.Pointer`/`*T`) so the compiler emits barriers, and use `runtime.KeepAlive` where lifetimes are subtle. Verify by looking for `CMPL runtime.writeBarrier(SB), $0` + `CALL runtime.gcWriteBarrier2(SB)` around the store in `-S`.

---

## Bug 7 — Benchmarking with `//go:noinline` left in

**Code / symptom.** A micro-benchmark of a 3-line helper shows it's "surprisingly expensive," ~5 ns/op for an add.

```go
//go:noinline
func add(a, b int) int { return a + b }
```

**Cause.** `//go:noinline` was added to *study the assembly* and never removed. It forces a real `CALL` + frame setup that the inliner would normally eliminate, so the benchmark measures call overhead, not the add.

**Fix.** Remove `//go:noinline` for benchmarking. Use it only when isolating a function in `-S` output, then delete it. The realistic number for an inlinable add is "free" (folded into the caller).

---

## Bug 8 — Wrong GOARCH assumption (reading native asm, shipping amd64)

**Code / symptom.** On an Apple-Silicon laptop, a developer reads `go tool objdump` output, sees `CLZ R0, R0`, and documents "our leading-zero count is one instruction." Production (linux/amd64, GOAMD64=v1) is slower and shows a multi-instruction sequence.

**Cause.** Native build on the laptop is **arm64**, where `bits.LeadingZeros64` is a single `CLZ`. On amd64 v1 there is no guaranteed `LZCNT`, so the compiler emits `BSRQ` + a zero-case fix-up. The analysis was done on the wrong architecture.

**Fix.** Always cross-build to the deployment target before reading assembly:

```bash
GOOS=linux GOARCH=amd64 GOAMD64=v1 go build -gcflags=-S .
```

Match `GOOS/GOARCH/GOAMD64` to production.

---

## Bug 9 — Intrinsic blocked by GOAMD64 level

**Code / symptom.** `bits.OnesCount64` shows `CALL math/bits.OnesCount64(SB)` (or a long software sequence) instead of `POPCNT`, on the production build.

```bash
GOAMD64=v1 go build -gcflags=-S .   # no POPCNT
```

**Cause.** `POPCNT` requires `GOAMD64=v2`+. At the default `v1`, the compiler cannot assume the instruction exists, so it emits the portable path.

**Fix.** If your fleet supports it, build with `GOAMD64=v2` (or `v3`). Confirm:

```bash
GOAMD64=v2 go build -gcflags=-S . 2>&1 | grep POPCNT
```

Pin `GOAMD64` in CI so the optimization is deterministic. (Only do this if every target CPU truly supports the level, or the binary will fail to start.)

---

## Bug 10 — Misreading a spill as a bug

**Code / symptom.** A function shows stores and loads to `(SP)` in the middle of arithmetic; a reviewer claims "the compiler is generating useless memory traffic."

```
	MOVQ	AX, 24(SP)     ; later:
	MOVQ	24(SP), AX
```

**Cause.** That's a **register spill/reload**: more values were live than available registers, so the allocator parked one on the stack and reloaded it. It is correct, sometimes unavoidable, behavior — not a bug.

**Fix.** If spills land on the hot path and matter, *reduce register pressure*: shorten live ranges, split the function, avoid keeping many values live across a call, or process data in smaller chunks. But don't "fix" a spill that isn't hot — it's the allocator doing its job.

---

## Bug 11 — Frame-pointer assumption in a NOFRAME stub

**Code / symptom.** A profiler can't unwind through a hand-written assembly function; flame graphs show it as a dead end.

```asm
TEXT ·kernel(SB), NOSPLIT|NOFRAME, $0-24
	... uses BP as scratch ...
```

**Cause.** With `NOFRAME` and reuse of `BP`, the function neither maintains the frame-pointer chain nor preserves the caller's `BP`. On amd64/arm64 Go keeps a frame-pointer chain for profiling; breaking it stops the unwinder.

**Fix.** Don't use `BP` as scratch. If the function is a true leaf doing no calls and you don't need it in profiles, leaving `NOFRAME` is acceptable as long as `BP` is untouched. Otherwise set up a proper frame (`PUSHQ BP; MOVQ SP, BP` … `POPQ BP`).

---

## Bug 12 — Counting PCDATA/FUNCDATA as instructions

**Code / symptom.** A script that "counts instructions on the hot path" reports inflated numbers and flags a trivial function as bloated.

```
	FUNCDATA	$0, gclocals·…(SB)
	PCDATA	$3, $1
	ADDQ	BX, AX
	RET
```

**Cause.** `FUNCDATA` and `PCDATA` lines appear in `-S` but **emit no machine code** — they're metadata. Counting them overstates instruction count.

**Fix.** Filter them. With objdump they don't appear at all, so prefer `go tool objdump` for honest instruction counts, or grep them out of `-S`:

```bash
go build -gcflags=-S . 2>&1 | grep -vE 'PCDATA|FUNCDATA'
```

---

## Bug 13 — Bounds checks not eliminated (re-derived length)

**Code / symptom.** A tight loop shows repeated `CMPQ`/`JCC` panic branches and `runtime.panicIndex` relocations; `pprof -disasm` attributes time to them.

```go
n := len(s)
for i := 0; i < n; i++ {
	total += s[i] * w[i]   // bounds checks on both s and w
}
```

**Cause.** The compiler can't always prove `i < len(w)` from a separately-captured `n`, so it keeps bounds checks (BCE — bounds-check elimination — fails).

**Fix.** Give the compiler provable invariants: range over the slice, or hoist a `w = w[:len(s)]` slice so both share a provable length.

```go
w = w[:len(s)]              // now i indexes both provably
for i := range s {
	total += s[i] * w[i]
}
```

Verify the panic branches vanished in `-S` (no more `runtime.panicIndex`). You can also audit with `go build -gcflags='-d=ssa/check_bce/debug=1'`.

---

## Bug 14 — `go tool compile -S` can't import the stdlib

**Code / symptom.** Trying to dump assembly for a file that imports `math/bits`:

```bash
go tool compile -S main.go
# main.go:3:8: could not import math/bits (file not found)
```

**Cause.** `go tool compile` compiles a single file in isolation and can't resolve imports without the build system wiring up the import map. It's the wrong tool for anything touching other packages.

**Fix.** Use `go build -gcflags=-S` (or `go test -gcflags=-S`), which drives the full build with import resolution:

```bash
go build -gcflags=-S . 2>&1 | less
```

Reserve `go tool compile -S` for truly self-contained, import-free files.

---

## Summary

- Intrinsics fail silently when blocked by **interface/no-inline boundaries** (Bug 1) or an insufficient **GOAMD64** level (Bug 9); always grep `-S` for the expected instruction vs a `CALL`.
- The assembly boundary is **ABI0**: read args from `(FP)` with correct **struct-layout offsets** (Bugs 2, 3), and never clobber **`g`** (`R14`/`R28`) or **`BP`** (Bugs 4, 11).
- `-S` is **pre-link**: jump targets are byte offsets (Bug 5) and PCDATA/FUNCDATA are not instructions (Bug 12). Use **objdump** for post-link truth.
- **Write barriers** exist for typed pointer stores; hiding pointers in `uintptr` defeats the GC (Bug 6).
- Match **GOOS/GOARCH/GOAMD64** to production (Bug 8); spills (Bug 10) and surviving bounds checks (Bug 13) are real signals — but read them correctly.
- Use the right tool: `go build -gcflags=-S`, not `go tool compile -S`, for anything with imports (Bug 14); and strip `//go:noinline` before benchmarking (Bug 7).

---

## Further reading

- [Go internal ABI specification](https://github.com/golang/go/blob/master/src/cmd/compile/abi-internal.md)
- [A Quick Guide to Go's Assembler](https://go.dev/doc/asm)
- [Bounds Check Elimination in Go](https://go101.org/article/bounds-check-elimination.html)
- Go source: [`cmd/compile/internal/ssagen/intrinsics.go`](https://github.com/golang/go/blob/master/src/cmd/compile/internal/ssagen/intrinsics.go)
- [`cmd/vet` asmdecl](https://pkg.go.dev/cmd/vet) — assembly argument-offset checker
