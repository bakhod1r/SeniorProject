# Go Assembly — Senior

## 1. The mental model in one paragraph

Plan 9 assembly is **one source, many targets**. You write `MOVQ a+0(FP), AX` and the assembler picks the right encoding for amd64, with parallel mnemonic tables for arm64, riscv64, ppc64, and mips64. The Go ABI is what binds the two worlds: ABI0 (stack-based) is the default for `.s` files; ABIInternal (register-based, Go 1.17+) is what the compiler emits and what the runtime increasingly uses for hot paths. The toolchain inserts ABI wrappers automatically, but knowing where they sit changes how you write tight code. The runtime is also a participant — write barriers, stack-growth checks, and scheduler preemption all reach into assembly, and assembly can either cooperate or sabotage them.

---

## 2. One source, many architectures

A single Go package can ship assembly for multiple architectures:

```
crypto/sha256/
├── sha256.go               // pure-Go fallback
├── sha256block.go          // dispatcher
├── sha256block_amd64.go    // amd64 entry
├── sha256block_amd64.s     // SHA-NI / SSE / AVX paths
├── sha256block_arm64.go
├── sha256block_arm64.s     // ARMv8 SHA extensions
├── sha256block_ppc64x.s
└── sha256block_s390x.s
```

Each `.s` file uses Plan 9 syntax but mnemonics from its target ISA. On amd64 you write `MOVQ`, `ADDQ`, `VPSHUFB`; on arm64 you write `MOVD`, `ADD`, `REV32`. The pseudo-registers (`SB`, `FP`) and the `TEXT` directive are the same everywhere.

The dispatcher selects at runtime based on CPU features (`internal/cpu` on stdlib, `golang.org/x/sys/cpu` for third-party). Cold path stays pure Go; hot path picks the best assembly variant.

---

## 3. ABIInternal — the register-based convention

Since Go 1.17, the compiler uses ABIInternal for Go-to-Go calls. On amd64, the first nine integer/pointer arguments go in `AX, BX, CX, DI, SI, R8, R9, R10, R11`. Floats use `X0..X14`. Return values use the same registers as if the return tuple were appended to the arguments. The frame pointer `BP` is still saved; `R14` holds `g` (the current goroutine).

Assembly defaults to ABI0 — args on the stack at FP offsets. Two practical implications:

1. **Calling Go from ABI0 assembly.** The toolchain inserts a wrapper that reads your FP-laid-out args and loads the appropriate registers for the Go callee. You don't write it; you just pay the wrapper's couple of `MOV`s.
2. **Opting assembly into ABIInternal.** Append `<ABIInternal>` to the symbol:

```
TEXT ·Add<ABIInternal>(SB), NOSPLIT, $0-24
    ADDQ BX, AX        // args in AX, BX; return in AX
    RET
```

You get zero-overhead calls from Go, but you must follow the convention precisely — wrong register, wrong result. Reserved for tight bridges. The convention is documented in `src/cmd/compile/abi-internal.md` and is **explicitly not stable** across Go versions, so most projects target ABI0.

---

## 4. Stack-growth checks and split stacks

Every non-`NOSPLIT` function starts with a small prologue:

```
CMPQ SP, 16(R14)       ; compare SP against g.stackguard
JLS  morestack
```

If SP would drop below `g.stackguard` after subtracting the frame size, the runtime calls `runtime.morestack`, allocates a larger stack, copies the old stack into the new one (rewriting pointers per the metadata in the function's stack map), and resumes. This is what lets goroutines start with 2 KiB stacks and grow on demand.

`NOSPLIT` skips this check. It's required for:

- Functions called by the runtime in stack-sensitive contexts (signal handlers, the scheduler itself).
- Tiny leaf functions where the prologue dwarfs the body.

It's dangerous because:

- If you exceed the budget (~792 bytes on amd64, less on some arches), the linker errors.
- If you call into Go that *itself* might `morestack`, you can blow the stack and crash undetected.

The linker enforces a transitive budget for `NOSPLIT` chains. If `A NOSPLIT → B NOSPLIT → C NOSPLIT`, the sum of their frames must fit. Adding a frame later can break the build of an entirely different function.

---

## 5. Write barriers in assembly

Go's GC is concurrent, with a hybrid write barrier that shades both the old and new pointer values on a pointer store during marking. The Go compiler emits the barrier automatically. Assembly does **not** — you must call into the runtime explicitly when storing a pointer to memory the GC might trace:

```
// Stores ptr into *slot. Slot is in heap memory.
MOVQ slot+8(FP), DI
MOVQ ptr+16(FP), SI
CALL runtime·gcWriteBarrier(SB)   // expects DI=slot, SI=val
```

There's a runtime helper for this exact purpose. Skipping it during a GC mark phase yields a *use-after-free* in the GC: a freshly stored pointer may not be marked, the object it points to may be reclaimed, and a subsequent dereference reads garbage.

For most assembly — arithmetic, hashing, SIMD math — there are no pointer stores into heap memory, so you never write a barrier. The danger zone is data-structure code (channels, maps, slices) which is why almost none of it is hand-written assembly.

---

## 6. SIMD on amd64: SSE, AVX, AVX-512

The big win for assembly is **SIMD** — single instruction, multiple data. Modern x86 ISAs offer increasingly wide vector registers:

| Extension | Width | Registers |
|-----------|-------|-----------|
| SSE2 | 128 bits | X0..X15 |
| AVX | 256 bits | Y0..Y15 |
| AVX2 | 256 bits + integer ops | Y0..Y15 |
| AVX-512 | 512 bits | Z0..Z31, opmask K0..K7 |

A loop summing 64-bit integers gains ~4× from AVX2 (`VPADDQ` over `Y` registers) over scalar `ADDQ`. Beyond raw width, AVX adds non-destructive three-operand encoding (`VPADDQ Y0, Y1, Y2` → `Y2 = Y0 + Y1`), which reduces register pressure.

CPU feature detection in stdlib goes through `internal/cpu.X86.HasAVX2`. The dispatcher picks the widest supported variant; you ship multiple `.s` files (`_amd64.s`, `_amd64_avx2.s`) or branch internally.

---

## 7. SIMD on arm64: NEON and SVE

Apple Silicon, ARM servers, and most modern arm64 hardware support NEON — 128-bit vectors in `V0..V31`. Wider data per cycle than scalar 64-bit, single-instruction reductions, and saturating arithmetic for media code.

```
// arm64 vector add: V2 = V0 + V1 (8 bytes per lane)
VADD V0.D2, V1.D2, V2.D2
```

The Plan 9 mnemonic differs from the GCC `VADD` in width syntax: Plan 9 spells the arrangement `.D2` (two 64-bit lanes) where GCC writes `.2D`. Mostly cosmetic but trips porting.

SVE (Scalable Vector Extension) supports vector lengths up to 2048 bits and is on some newer ARM cores. Go 1.22 added basic SVE assembler support; usage is rare outside HPC code.

---

## 8. Constant-time crypto patterns

Cryptographic code must run in time independent of its secret inputs. That means:

- **No data-dependent branches.** Replace `if x == y` with bitwise mask construction: `mask = -CMPEQ(x, y); result = (a & mask) | (b & ~mask)`.
- **No data-dependent memory access.** A table lookup with a secret index reveals the index through cache timing. Replace with vectorized "compare and select".
- **No division.** Division latency depends on operand values on some CPUs.

In Go assembly this typically looks like:

```
// Constant-time conditional move: if mask==0xFF...FF, AX = BX
MOVQ mask, CX
ANDQ CX, BX
NOTQ CX
ANDQ CX, AX
ORQ  BX, AX
```

Or, faster, `CMOVQ` (conditional move based on flags) — both branches execute; the flag selects the result. The `crypto/subtle` package in stdlib has primitives (`ConstantTimeEq`, `ConstantTimeCopy`) for the same purpose. Inspection: `go tool objdump` on the final binary to confirm no `JNE` or `JEQ` depends on secret data.

---

## 9. Raw byte encoding for new instructions

When the Go assembler doesn't yet support an instruction (common during CPU-vendor pushes — AVX-512 subsets, ARMv9 features), you emit raw bytes:

```
// VPCLMULQDQ Y1, Y2, Y3, $0  (PCLMUL on 256-bit lanes)
BYTE $0xC4; BYTE $0xE3; BYTE $0x6D; BYTE $0x44; BYTE $0xDA; BYTE $0x00
```

Painful but works. The Go assembler's instruction tables are conservative; AVX-512 in particular took several Go releases to stabilize. Code in `crypto/aes` and `crypto/sha256` had `BYTE` sequences for years and migrated to native mnemonics as support landed.

`avo` (see [optimize.md](optimize.md)) makes this less painful — you describe operations at a higher level and avo emits the bytes.

---

## 10. Calling assembly across cgo boundaries

When Go assembly calls into a C library via cgo:

- The cgo wrapper transitions Go → C ABI (System V on Linux/macOS, MS x64 on Windows). Stack switches (Go uses small segmented stacks; C wants a big contiguous one) happen automatically.
- The assembly side calls the Go wrapper (`_cgo_XYZ`), not the C function directly.
- Pointer safety: Go pointers passed to C must obey the cgo pointer-passing rules (no Go pointers stored *into* C-visible memory unless explicitly pinned with `runtime.Pinner` since Go 1.21).

For high-performance code, cgo is usually a worse choice than pure Go assembly: the cgo call itself costs hundreds of nanoseconds (stack switch, scheduler interaction). Go assembly stays inside the Go ABI and avoids that.

When you do mix them, `//go:noescape` on the Go side prevents pointers from being moved to the heap pessimistically:

```go
//go:noescape
func ProcessBuffer(p *byte, n int)
```

Without `//go:noescape`, the compiler may decide `p` escapes through the assembly call (it can't see the body), and force a heap allocation at every call site.

---

## 11. Preemption and assembly

Go's scheduler can preempt a goroutine asynchronously (since Go 1.14). For assembly, this means:

- A long `NOSPLIT` loop with no calls becomes unpreemptible. The scheduler sends a `SIGURG`, but the signal handler can only safely preempt at a "safe point" — places where the stack map is correct. Inside hand-written assembly, safe points exist only where you've explicitly placed `PCDATA` / `FUNCDATA` annotations.
- The standard fix: don't write long uninterruptible loops in assembly. If you must (cryptography), the runtime tolerates it — preemption simply doesn't fire there.

You almost never need to think about this for typical SIMD loops; they're short relative to the scheduler quantum.

---

## 12. Frame-pointer support

amd64 Go binaries include frame pointers (`BP`) for profiler-friendly stack traces. The compiler emits the prologue/epilogue automatically; for assembly, you get it for free as long as you don't use `NOFRAME`. With `NOFRAME` you must not push/pop BP and must keep the frame zero. Tools like `perf` rely on frame pointers to walk the stack quickly without DWARF.

For arm64, the equivalent is `R29`. Same conventions apply.

---

## 13. The `g` register and runtime hot paths

On amd64, the current goroutine's `g` pointer lives in `R14` (under ABIInternal). On arm64 it's `R28`. The runtime uses it heavily:

```
MOVQ g_m(R14), AX        // current g.m
MOVQ m_p(AX), BX         // current m.p
MOVQ p_runqhead(BX), CX
```

Field offsets (`g_m`, `m_p`) come from `go_asm.h`, regenerated by `go tool compile -asmhdr`. The struct layout changes between Go versions; your assembly stays correct because the header is regenerated each build. This is how the runtime can refactor `g`/`m`/`p` without breaking all the architectural variants of its assembly.

For user code, touching `g` directly is unusual. The scenario is implementing `runtime.GetG()`-equivalent helpers or specialty profiling tools.

---

## 14. Debugging assembly

```bash
# Disassemble a specific function
go tool objdump -s 'pkg\.Func' ./binary

# Annotate with source mapping (for Go code)
go build -gcflags='-S' ./pkg

# Step through with delve
dlv exec ./binary
(dlv) break pkg.Func
(dlv) disassemble
(dlv) step

# Trace into runtime
GODEBUG=cgocheck=2 GORACE='atexit_sleep_ms=1000' ./binary
```

`go tool objdump -gnu` adds GNU-style mnemonics alongside Plan 9, useful when correlating with vendor optimization manuals. For SIMD, you'll often verify the encoded instructions match what you intended by reading the disassembly back.

---

## 15. Where the stdlib uses assembly

A non-exhaustive list:

- **`crypto/aes`** — AES-NI on amd64, ARMv8 crypto on arm64.
- **`crypto/sha256`, `crypto/sha512`** — SHA-NI / SSE / AVX2 / NEON.
- **`crypto/elliptic`** — P-256 field arithmetic (Montgomery multiply) in assembly.
- **`math/big`** — `addVV`, `subVV`, `mulAddVWW` — multiprecision arithmetic.
- **`runtime`** — context switches, `morestack`, `gcWriteBarrier`, atomic ops, signal handling.
- **`internal/bytealg`** — `IndexByte`, `Compare`, `Equal` — vectorized.
- **`hash/crc32`, `hash/crc64`** — PCLMULQDQ on amd64.
- **`encoding/base64`** — vectorized decode in the AVX path.

These are the canonical references. When in doubt about an idiom, grep the stdlib for it.

---

## 16. Summary

At the senior level, Go assembly is a tool for SIMD, constant-time crypto, and the runtime's lowest layers. The single dialect (Plan 9) hides per-arch differences but doesn't eliminate them; you still ship one `.s` per architecture. ABI0 vs ABIInternal is the boundary between assembly and Go-compiler-emitted code; the toolchain bridges them automatically. The runtime cooperates via stack-growth checks (which `NOSPLIT` opts out of, dangerously) and write barriers (which assembly *must* call explicitly when storing pointers). Knowing those contracts is what separates assembly that works from assembly that crashes in production at 1 AM. From here, [professional.md](professional.md) covers what shipping assembly looks like at scale.

---

## Further reading
- Go ABI internal: https://github.com/golang/go/blob/master/src/cmd/compile/abi-internal.md
- Runtime asm overview: https://github.com/golang/go/blob/master/src/runtime/HACKING.md
- `avo` (assembly generator): https://github.com/mmcloughlin/avo
- `klauspost/compress` assembly examples: https://github.com/klauspost/compress
- Constant-time programming: https://www.bearssl.org/constanttime.html
