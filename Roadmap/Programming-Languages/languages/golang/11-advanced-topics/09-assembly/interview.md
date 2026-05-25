# Go Assembly — Interview Questions

A focused set of questions for senior-level interviews. Each has a detailed answer; together they cover what an interviewer can reasonably expect a candidate who claims "I know Go assembly" to be able to discuss.

---

## Q1: Why does Go use Plan 9 syntax instead of GNU `as` or Intel?

Go inherits the Plan 9 toolchain Ken Thompson and Rob Pike built. The deeper reason is **portability**: a single dialect describes assembly across amd64, arm64, riscv64, ppc64, mips64, and s390x. The toolchain (`cmd/asm`) translates Plan 9 mnemonics into each architecture's native encoding. Pseudo-registers (`SB`, `FP`, `SP`, `PC`) and the `TEXT` directive are uniform; only the instruction mnemonics differ per arch.

The trade is friction: most external documentation uses Intel or AT&T syntax. You translate mentally, or use tools like `go tool objdump -gnu` to see both side by side.

---

## Q2: What are SB, FP, SP, and PC?

Pseudo-registers — virtual identifiers the assembler maps to real registers (or addresses) per architecture.

- **SB** (static base): addresses zero of the program. All symbols are referenced relative to SB (`·Func(SB)`, `runtime·gopanic(SB)`).
- **FP** (frame pointer): points to the caller's argument area. Read args and write returns at FP-relative offsets (`a+0(FP)`, `ret+16(FP)`).
- **SP** (stack pointer): the Plan 9 SP refers to a local frame-relative location, not necessarily the hardware SP. The assembler resolves the difference.
- **PC** (program counter): used for labels and indirect jumps.

They unify cross-architecture code: the same Plan 9 source means the same thing on amd64 (where hardware SP differs) as on arm64.

---

## Q3: What does `TEXT ·Add(SB), NOSPLIT, $0-24` mean?

Decomposing:

- `TEXT` — declares a code symbol.
- `·Add` — function named `Add` in the current package (the `·` is U+00B7, the Plan 9 package separator).
- `(SB)` — symbol addressed relative to the static base; required syntax.
- `NOSPLIT` — flag telling the linker not to emit a stack-growth check prologue.
- `$0` — local frame size in bytes. Zero means no local stack storage.
- `-24` — combined size of caller's argument area + return area in bytes. For `func Add(a, b int64) int64`: 8 + 8 + 8 = 24.

`go vet` cross-checks `$0-24` against the Go signature.

---

## Q4: What is `NOSPLIT` and when should you use it?

`NOSPLIT` skips the prologue that checks `g.stackguard` and calls `runtime.morestack` when the stack would overflow. Use it when:

- The function is a tight leaf (no `CALL`, or all calls also `NOSPLIT`).
- The frame is small (the budget is ~792 bytes on amd64).
- The prologue overhead is significant relative to the body (true for 3-instruction functions, not for 300-instruction SIMD loops).

Misuse:
- Long `NOSPLIT` chains can blow the budget — the linker checks the worst-case sum.
- A `NOSPLIT` function that calls into Go which might grow the stack can corrupt memory silently.

Required in signal handlers (which run on `g0`, the non-growable system stack).

---

## Q5: What's the difference between ABI0 and ABIInternal?

ABI0 — Go's original calling convention. Arguments and returns passed on the stack at FP-relative offsets. Stable.

ABIInternal — register-based, introduced in Go 1.17. On amd64, args go in `AX, BX, CX, DI, SI, R8, R9, R10, R11`; floats in `X0..X14`. Faster, but **explicitly not stable** — the register order, caller-saved set, etc., can change between Go releases.

The compiler emits ABIInternal calls between Go functions. Assembly defaults to ABI0. The toolchain inserts ABI wrappers automatically between the two. You opt assembly into ABIInternal with `TEXT ·Foo<ABIInternal>(SB)`, but most hand-written code stays on ABI0.

---

## Q6: How do you call a Go function from assembly?

```
MOVQ $42, AX
MOVQ AX, arg+0(FP)
CALL pkg·GoFunc(SB)
```

A few rules:

- The assembler inserts an ABI wrapper if the callee is ABIInternal. You write args as if calling ABI0.
- Across the `CALL`, treat all caller-saved registers as garbage; save what you need.
- If the Go function might grow the stack, your function should *not* be `NOSPLIT` — the prologue is what allows preemption and stack growth to happen safely.

For calling runtime helpers: `CALL runtime·morestack_noctxt(SB)`, `CALL runtime·gcWriteBarrier(SB)`, etc. Symbols use `package·name` with the middle dot.

---

## Q7: How do you call assembly from Go?

```go
package fast

//go:noescape
func Add(a, b int64) int64
```

Just declare the function with no body. The matching `.s` file (or `.s` files, one per supported arch) provides the implementation. Two important annotations:

- `//go:noescape` — assert that pointer arguments do not escape via the call. Required for slice/pointer args that would otherwise pessimize to heap.
- The Go signature is the contract; `go vet` checks the `.s` offsets against it.

For unsupported architectures, provide a pure-Go fallback in a file with the inverse build tag (`//go:build !amd64 && !arm64`).

---

## Q8: What is `avo`?

[`avo`](https://github.com/mmcloughlin/avo) is a Go DSL that generates Plan 9 assembly. You write:

```go
TEXT("Add", NOSPLIT, "func(a, b int64) int64")
a := Load(Param("a"), GP64())
b := Load(Param("b"), GP64())
ADDQ(b, a)
Store(a, ReturnIndex(0))
RET()
Generate()
```

avo handles FP offset bookkeeping, register allocation, label scoping, AVX-512 encoding, and emits both the `.s` file and a stub `.go` file with the right declarations.

Most production Go assembly (`klauspost/compress`, `klauspost/reedsolomon`, `minio/sha256-simd`) is avo-generated. Hand-rolled assembly is reserved for the runtime and audited crypto code.

---

## Q9: When should you write Go assembly?

Realistic criteria:

1. **SIMD** — your loop is data-parallel and the Go compiler isn't vectorizing it (it rarely auto-vectorizes).
2. **Specialty CPU instructions** — AES-NI, SHA-NI, PCLMULQDQ, CRC32. These do orders of magnitude more per instruction than scalar ops.
3. **Constant-time crypto** — the compiler makes no constant-time promises; assembly does.
4. **Multiprecision arithmetic** — `math/big` uses `ADC` (add-with-carry) chains, which Go can't express.

In all cases: profile first. If the kernel isn't 30%+ of runtime, the speedup won't matter at the service level.

---

## Q10: What are alternatives to writing assembly?

Often cheaper and good enough:

- **Compiler intrinsics** — Go has limited intrinsics in `math/bits` and `runtime/internal/atomic`. The compiler recognizes calls like `bits.OnesCount64` and emits `POPCNTQ`.
- **`unsafe` slice tricks** — `unsafe.Slice`, `unsafe.SliceData` can sometimes express memmem patterns the compiler vectorizes.
- **Algorithmic change** — a better algorithm in Go beats assembly of the worse one.
- **cgo into a vetted C library** — for very specialized cases, with the cgo call overhead caveat.
- **WASM SIMD** for portable SIMD (very limited audience).

For most projects, "trust the compiler and profile" answers 95% of performance questions.

---

## Q11: Name three stdlib packages that ship assembly and what for.

- **`crypto/aes`** — AES rounds on AES-NI hardware; ~10× the pure-Go path.
- **`crypto/sha256`** — block function via SHA-NI / AVX2 / SSSE3; ~2–10× depending on CPU.
- **`internal/bytealg`** — `IndexByte`, `Compare`, `Equal` vectorized over 16/32-byte chunks; powers `strings.Index`, `bytes.Equal`, etc.

Honorable mentions: `math/big` (multiprecision), `crypto/elliptic` (constant-time P-256), `hash/crc32` (PCLMULQDQ), `encoding/base64` (vectorized decode).

---

## Q12: Why doesn't the race detector instrument assembly?

The race detector relies on the compiler inserting calls into `racefuncenter`, `raceread`, `racewrite` around memory accesses. Assembly code isn't passed through the compiler — the assembler emits raw instructions. The race detector therefore can't see assembly's memory accesses.

Practical implications:

- A race condition rooted in your `.s` code may go undetected.
- Cross-language races (Go writes, assembly reads) may still be detected on the Go side.
- For crypto/SIMD assembly, races are typically a non-issue (the kernel works on caller-provided buffers, not shared state). For data-structure assembly, this absence is one more reason such code is rare.

---

## Q13: How do you debug Go assembly?

Tools:

```bash
# Disassemble the binary
go tool objdump -s 'pkg\.Func' ./binary

# With GNU mnemonics alongside Plan 9
go tool objdump -gnu -s 'pkg\.Func' ./binary

# Compiler's assembly output for Go code
go build -gcflags='-S' ./pkg

# Step through with delve
dlv exec ./binary
(dlv) break pkg.Func
(dlv) disassemble
(dlv) si    # step instruction
```

`go vet` catches FP offset mistakes before runtime. Bench harnesses compare against pure-Go references to catch correctness issues. For SIMD bugs, `perf stat -e cache-misses,branch-misses` exposes microarchitectural surprises.

---

## Q14: What is a write barrier and why does it matter for assembly?

Go's GC is concurrent with a hybrid (Yuasa + Dijkstra) write barrier. When user code stores a pointer during the mark phase, the runtime shades both the old and new pointer values to maintain the marking invariant. The Go compiler emits the barrier automatically.

Assembly doesn't. If you store a pointer into GC-tracked memory from assembly without calling `runtime.gcWriteBarrier`, you can:
- Lose the new pointer reference (GC frees the pointee mid-mark).
- Cause "found bad pointer" or "scanobject" runtime panics under load.

For SIMD math, hashing, comparison — no pointer stores into tracked memory, no barrier needed. The danger is exclusively in data-structure code: channels, maps, slices. Which is exactly why the runtime, not user code, owns those.

---

## Q15: What does `//go:noescape` do?

It tells the compiler that pointer arguments don't escape via this function call. Without it, the compiler — unable to see the assembly body — assumes the worst and may force heap allocation of slice backing arrays at the call site.

```go
//go:noescape
func ProcessBuffer(p []byte) int
```

If your assembly stashes the pointer somewhere (global, channel, struct field), `//go:noescape` is *wrong* and you create use-after-free. For SIMD math kernels operating only on the caller's buffer, it's almost always correct and important for performance.

---

## Q16: What's the layout of a `[]byte` argument in FP?

A slice is a header of three machine words: `(ptr, len, cap)`. For a function `func F(xs []byte)`:

```
FP +0  : xs_base   (8 bytes, pointer)
FP +8  : xs_len    (8 bytes)
FP +16 : xs_cap    (8 bytes)
```

Total 24 bytes for one slice arg. Named offsets via `xs_base+0(FP)`, `xs_len+8(FP)`, `xs_cap+16(FP)`. `go vet` verifies these against the Go declaration.

For strings: `(ptr, len)` — two words. For interfaces: `(itab, data)` — two pointers. For maps and channels: a single pointer (to the runtime hmap or hchan).

---

## Q17: Why `VZEROUPPER` before returning?

On Intel (Sandy Bridge through some Skylake variants), mixing AVX-encoded VEX instructions with legacy SSE costs ~70 cycles per transition. If your function used `Y` registers and the caller (or surrounding code) uses SSE, you cross the boundary on return.

`VZEROUPPER` clears the upper 128 bits of every Y register, telling the CPU "no AVX state to preserve". It's nearly free (zero to one cycle) and eliminates the transition penalty.

Always emit `VZEROUPPER` (or `VZEROALL`) just before `RET` in any function that touched Y registers. One of the most common SIMD bugs.

---

## Q18: How would you support multiple amd64 micro-architectures?

Use `internal/cpu` (stdlib) or `golang.org/x/sys/cpu` (third-party) for runtime feature detection:

```go
import "golang.org/x/sys/cpu"

var hashImpl func([]byte) uint64

func init() {
    switch {
    case cpu.X86.HasAVX2:
        hashImpl = hashAVX2
    case cpu.X86.HasSSE42:
        hashImpl = hashSSE42
    default:
        hashImpl = hashGeneric
    }
}
```

Ship multiple `.s` files (`_amd64.s`, `_amd64_avx2.s`) or a dispatcher inside one file. For deploy targets known to all support a feature, set `GOAMD64=v3` to let the Go compiler also assume it for surrounding code.

---

## Q19: What's the difference between `MOVQ`, `MOVL`, `MOVW`, `MOVB`?

The suffix is the operand size:

| Mnemonic | Width | Bits |
|----------|-------|------|
| `MOVB` | byte | 8 |
| `MOVW` | word | 16 |
| `MOVL` | long | 32 |
| `MOVQ` | quad | 64 |

This is amd64 convention. For arm64, the operand width is encoded in the register name (`X0` = 64-bit, `W0` = 32-bit), so instructions like `MOV` carry no suffix.

For larger operations: `MOVO`/`MOVOU` for 128-bit XMM, `VMOVDQU` for 256-bit YMM, `VMOVDQU64` for 512-bit ZMM.

---

## Q20: How do you handle a new CPU instruction not in the assembler's tables?

Two options:

1. **Raw byte encoding.** Look up the encoding (Intel SDM, AMD APM, ARM ARM) and emit:
   ```
   BYTE $0xC4; BYTE $0xE2; BYTE $0x7D; BYTE $0xF7; BYTE $0xC1
   ```

2. **Use `avo`,** which has broader instruction support and active development. avo emits the bytes for you.

Long-term, the Go toolchain catches up; you migrate to the native mnemonic when it lands. The `crypto/aes` and `crypto/sha256` code has historically used `BYTE` sequences during the gap.

---

## Cheat sheet

```
// Function declaration
TEXT ·Name(SB), FLAGS, $framesize-argsize
  - FLAGS: NOSPLIT | WRAPPER | NEEDCTXT | NOFRAME (OR-ed)
  - framesize: bytes of local stack
  - argsize: bytes of args + return area

// Pseudo-registers
SB - static base (symbols)
FP - frame pointer (args)
SP - stack pointer (locals)
PC - program counter

// Argument access
MOVQ name+offset(FP), DEST    // use named offsets, always

// Instruction sizes (amd64)
B = 8-bit, W = 16-bit, L = 32-bit, Q = 64-bit
MOV order: src, dst (AT&T-style)

// Common SIMD widths
X = 128-bit, Y = 256-bit, Z = 512-bit

// Before returning from an AVX function
VZEROUPPER

// Call into Go
CALL package·name(SB)

// Build constraint
file_amd64.s automatically has //go:build amd64

// Vet your code
go vet ./...        // catches FP offset mistakes

// Disassemble
go tool objdump -s 'pkg\.Func' ./binary

// Compiler-emitted assembly
go build -gcflags='-S' ./pkg
```

---

## Further reading
- "A Quick Guide to Go's Assembler": https://go.dev/doc/asm
- `cmd/asm` reference: https://pkg.go.dev/cmd/asm
- Go internal ABI: https://github.com/golang/go/blob/master/src/cmd/compile/abi-internal.md
- `avo`: https://github.com/mmcloughlin/avo
- Stdlib examples: `crypto/sha256`, `crypto/aes`, `math/big`, `internal/bytealg`
- See [middle.md](middle.md), [senior.md](senior.md), [optimize.md](optimize.md), [find-bug.md](find-bug.md), [tasks.md](tasks.md)
