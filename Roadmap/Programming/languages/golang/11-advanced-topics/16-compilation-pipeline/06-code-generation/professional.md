# Code Generation — Professional

## 1. Assembly-level performance analysis in production

When a benchmark plateaus or a profiler points at a hot function, reading the generated assembly is often the only way to see *why*. The professional workflow combines three signals:

```bash
# 1. What did the compiler emit for this function?
go build -gcflags='-S' ./pkg 2>&1 | sed -n '/mypkg\.Hot STEXT/,/^$/p'

# 2. What survived linking, and at what addresses?
go build -o app ./cmd/app
go tool objdump -s 'mypkg\.Hot' app

# 3. Does it actually matter? (CPU profile lands on real instructions)
go test -bench=Hot -cpuprofile=cpu.out ./pkg
go tool pprof -disasm=mypkg.Hot app cpu.out
```

`pprof -disasm` is the highest-value tool here: it annotates the disassembly with **sample counts per instruction**, so you see exactly which instructions burn cycles — a spill reload, a bounds check, a `CALL` you thought was inlined.

A note on inlining and `-S`: `-gcflags='-m -m'` prints inline decisions, and adding `-gcflags='-S'` shows the result. If the function you care about does not appear as its own `STEXT`, it was inlined — search the *caller's* listing instead, or add `//go:noinline` temporarily to study it in isolation (remember to remove it; it changes performance).

---

## 2. Verifying intrinsics actually fired

An intrinsic that silently *doesn't* fire is a common, invisible regression. The check is mechanical: dump the assembly and look for the expected instruction vs a `CALL`.

```go
//go:noinline
func PopCount(x uint64) int { return bits.OnesCount64(x) }
```

Fired (good):

```
	POPCNT	AX, AX
	RET
```

Not fired (bad — falls back to the generic software implementation):

```
	CALL	math/bits.OnesCount64(SB)
```

`bits.OnesCount64` becomes `POPCNT` only when the target supports it. On baseline `GOAMD64=v1`, POPCNT is not guaranteed, so the compiler emits the portable algorithm; with `GOAMD64=v2` or higher it emits `POPCNT`. Always verify under the **GOAMD64 you actually ship**:

```bash
GOAMD64=v1 go build -gcflags=-S . 2>&1 | grep -A6 'PopCount STEXT'   # CALL or software
GOAMD64=v3 go build -gcflags=-S . 2>&1 | grep -A6 'PopCount STEXT'   # POPCNT
```

The same applies to `bits.LeadingZeros64`: `BSRQ`+fix-up on v1, single `LZCNT` on v3. Atomics (`sync/atomic`, `atomic.Int64`) lower to `LOCK`-prefixed instructions and are intrinsic on all levels.

---

## 3. GOAMD64 microarchitecture levels

`GOAMD64` (Go 1.18+) tells the compiler which x86-64 feature baseline it may assume. The binary will **refuse to run** on a CPU below that level (it checks at startup), in exchange for better codegen.

| Level | Assumes (roughly) | Unlocks |
| --- | --- | --- |
| `v1` (default) | Original x86-64 (2003) | baseline only |
| `v2` | SSE3, SSSE3, SSE4.1/4.2, POPCNT, CMPXCHG16B | `POPCNT`, better atomics |
| `v3` | AVX, AVX2, BMI1/2, FMA, LZCNT, MOVBE | `LZCNT`, `TZCNT`, AVX2 vector ops, FMA |
| `v4` | AVX-512 | AVX-512 registers/ops |

Most cloud fleets are safely `v2` or `v3`. Set it for the build:

```bash
GOAMD64=v3 go build -o app ./cmd/app
```

The analogous arm64 knob is `GOARM64` (Go 1.23+, e.g. `v8.0`, `v9.0`), and there is `GOARM` for 32-bit ARM. Always pin these in CI so the assembly you analyze matches production.

---

## 4. SIMD via hand-written assembly stubs

Go's compiler does **not** auto-vectorize. If you need SSE/AVX/NEON, you write the kernel in a `.s` file and call it from Go. The pattern:

```go
// vec_amd64.go
//go:noescape
func addVec(dst, a, b []float64)   // declaration only; body in .s
```

```asm
// vec_amd64.s — Plan 9 syntax
#include "textflag.h"
// func addVec(dst, a, b []float64)
TEXT ·addVec(SB), NOSPLIT, $0-72
	MOVQ dst_base+0(FP), DI
	MOVQ a_base+24(FP), SI
	MOVQ b_base+48(FP), DX
	MOVQ a_len+32(FP), CX
	// ... VADDPD loop over CX/4 lanes ...
	RET
```

Key facts:

- A Go function with no body + a matching `TEXT ·name(SB)` in a `.s` file is the standard FFI-to-assembly mechanism. The middle dot `·` is the package-qualified name separator.
- Assembly stubs default to **ABI0** (stack args, FP-relative). Argument offsets (`a_base+24(FP)`, `a_len+32(FP)`) follow the *struct layout* of a slice header (`ptr, len, cap` = 24 bytes each). Get these offsets wrong and you read garbage — there is no type checking across this boundary. `go vet` (which runs `asmdecl`) catches many mismatches; run it.
- `//go:noescape` tells escape analysis the stub does not leak its pointer arguments to the heap. Use it only if true.
- Build-tag the file by arch suffix (`_amd64.s`, `_arm64.s`) and provide a pure-Go fallback for other arches.

The cost: hand assembly is unportable, unchecked, hard to maintain, and frozen against future compiler improvements. Reach for it only when profiling proves the win and the compiler genuinely cannot match it.

---

## 5. ABI boundaries when writing `.s` files

Because assembly stubs are ABI0 by default but Go-to-Go calls are ABIInternal, the boundary has sharp edges:

- A stub declared `TEXT ·foo(SB)` is **ABI0**: it must read args from `(FP)` offsets, not registers. The linker generates a wrapper so ABIInternal Go callers can reach it.
- To write a stub that participates in the register ABI (e.g. a runtime helper), declare `TEXT ·foo<ABIInternal>(SB)` and read args from the ABI registers (`AX, BX, ...`). This is fragile across releases — ABIInternal is explicitly *not* stable.
- The `g` register (`R14`/`R28`) must be preserved. So must `BP` if frame pointers are enabled (the default on amd64/arm64). Clobbering them corrupts stack unwinding and the runtime.
- If your stub calls back into Go or might grow the stack, it cannot be `NOSPLIT` blindly; you need a correct frame size on the `TEXT` line and possibly a stack map. Most leaf SIMD kernels are `NOSPLIT, $0`.

---

## 6. Footguns of reading assembly

- **`-S` is pre-link; objdump is post-link.** Branch targets are symbolic in `-S` (`JMP 18` = byte offset) but absolute in objdump. Don't compare addresses across the two.
- **PCDATA/FUNCDATA noise.** They look like instructions in `-S` but emit no code. Filter them when counting "real" instructions.
- **Inlining hides functions.** A missing `STEXT` usually means inlined, not "not compiled."
- **`//go:noinline` distorts measurements.** It's a study aid; never benchmark with it left in.
- **Optimizations move/merge instructions.** A source line can map to zero instructions (folded away) or several; the `(file:line)` column is best-effort.
- **GOAMD64/GOARCH drift.** Assembly you read on your laptop (`arm64`, native) is not what ships to a `linux/amd64 v3` fleet. Always cross-build to the target.
- **`go tool compile -S` can't import.** It works only for self-contained files; use `go build -gcflags=-S` for anything touching the stdlib.

---

## 7. Real cases

- **Hash inner loop, intrinsic regression.** A `bits.RotateLeft64` that had compiled to `ROLQ` started emitting a `CALL` after a refactor wrapped it behind an interface — the interface call blocked inlining, so the intrinsic never reached the call site. Fix: keep the rotate on a concrete type; verify `ROLQ` in `-S`.
- **Bounds checks in a tight loop.** `pprof -disasm` showed repeated `CMPQ`/`JLS` panic branches. Restructuring the loop so the compiler could prove the index in range (`for i := range s` instead of `for i := 0; i < n; i++` with a separate len) eliminated them (visible as the disappearance of `runtime.panicIndex` relocations).
- **Atomic counter on a hot path.** `atomic.AddInt64` correctly lowered to `LOCK XADDQ` (intrinsic), but the `LOCK` prefix serialized the core; the real fix was sharding the counter, not the codegen — assembly reading *confirmed* the instruction was already optimal and redirected the effort.

---

## 8. Summary

- Combine **`-gcflags=-S`** (what was emitted), **`go tool objdump`** (what shipped), and **`pprof -disasm`** (what costs cycles).
- **Verify intrinsics** by grepping for the expected instruction vs a `CALL`, under the **GOAMD64/GOARCH you actually ship**.
- **GOAMD64 v2/v3/v4** unlock `POPCNT`/`LZCNT`/AVX at the price of requiring newer CPUs; pin it in CI.
- Go does **not** auto-vectorize; SIMD means a `.s` stub (ABI0, `(FP)` offsets, preserve `g`/`BP`, `go vet` it).
- Watch the footguns: pre- vs post-link, PCDATA noise, inlining, `//go:noinline` distortion, and arch drift.

---

## Further reading

- [Go internal ABI specification](https://github.com/golang/go/blob/master/src/cmd/compile/abi-internal.md)
- [GOAMD64 minimum requirements / microarch levels](https://go.dev/wiki/MinimumRequirements#amd64)
- [A Quick Guide to Go's Assembler](https://go.dev/doc/asm)
- [`go tool pprof` disassembly](https://github.com/google/pprof/blob/main/doc/README.md)
- Go source: [`cmd/compile/internal/ssagen/intrinsics.go`](https://github.com/golang/go/blob/master/src/cmd/compile/internal/ssagen/intrinsics.go)
- [`cmd/vet` asmdecl checker](https://pkg.go.dev/cmd/vet) — validates `.s` arg offsets
