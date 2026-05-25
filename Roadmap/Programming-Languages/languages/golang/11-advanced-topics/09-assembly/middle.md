# Go Assembly — Middle

## 1. Plan 9 syntax in one paragraph

Go assembly is **Plan 9 assembly**, not GNU `as`, not Intel, not AT&T. It's a single dialect that the Go toolchain (`cmd/asm`) translates into the target architecture's native instructions. The same mental model — pseudo-registers, FP-relative arg access, `TEXT ·Func(SB)` declarations — applies to amd64, arm64, riscv64, and the rest. You learn it once and read assembly across architectures, with per-arch instruction tables for the mnemonics.

The trade is that almost no documentation on the wider internet uses this syntax. You read AT&T or Intel, then translate. The translation rules are tabular; with practice it's mechanical.

---

## 2. Pseudo-registers, the four that matter

| Pseudo | What it is | Used for |
|--------|------------|----------|
| `SB` (static base) | A virtual register at "address 0 of the program" | Symbol addressing: `·Func(SB)`, `runtime·gopanic(SB)` |
| `FP` (frame pointer) | Virtual; points to the caller's argument area | Reading args and writing return values: `a+0(FP)` |
| `SP` (stack pointer) | Virtual local frame pointer (not the hardware `SP` directly) | Local variables: `tmp-8(SP)` |
| `PC` (program counter) | Current instruction address | Labels, indirect jumps |

The assembler maps each pseudo to real hardware registers per architecture. On amd64, hardware `SP` is `SP` in instructions, but the Plan 9 `SP` you write at function entry refers to a frame-relative location — the assembler resolves the difference using symbol names. **Always name your offsets** (`a+0(FP)`, not `0(FP)`); the assembler verifies the names against the Go signature and catches typos.

---

## 3. The `TEXT` directive, completely

```
TEXT package·funcname(SB), FLAGS, $framesize-argsize
```

- `package·funcname` — the symbol. `·` is the package separator (U+00B7). An unqualified `·Foo` means "current package's `Foo`".
- `(SB)` — required; the symbol is global, addressed relative to the static base.
- `FLAGS` — bit mask from `textflag.h`. Most common: `NOSPLIT`, `WRAPPER`, `NEEDCTXT`, `NOFRAME`.
- `$framesize` — bytes of local stack the function uses. `$0` for no locals.
- `-argsize` — bytes of caller-provided argument area (args + return). The toolchain checks this against the Go declaration.

Example with locals:

```
TEXT ·Hash(SB), NOSPLIT, $16-24
    // 16 bytes of local stack, 24 bytes of args+return
    MOVQ data+0(FP), SI       // data ptr
    MOVQ data+8(FP), CX       // data len
    MOVQ AX, 0(SP)            // store into local
    MOVQ DX, 8(SP)            // store into local
    MOVQ DX, ret+16(FP)
    RET
```

If you omit `-argsize`, `go vet` will complain. If you get it wrong, the linker may catch it; if not, your function reads or writes garbage past the caller's frame.

---

## 4. TEXT flags in practice

```c
// textflag.h (excerpt)
#define NOPROF      1
#define DUPOK       2
#define NOSPLIT     4
#define RODATA      8
#define NOPTR       16
#define WRAPPER     32
#define NEEDCTXT    64
#define TLSBSS      256
#define NOFRAME     512
```

- **`NOSPLIT`** — skip the stack-growth prologue. Use for tiny leaf functions that don't call into Go. The prologue adds ~5 instructions and a possible call to `runtime.morestack`; for a 3-instruction add, it doubles the size.
- **`WRAPPER`** — this function is a wrapper; the runtime should skip it in stack traces.
- **`NEEDCTXT`** — the function uses the closure context register (DX on amd64). Necessary for closures or methods on concrete types.
- **`NOFRAME`** — the function doesn't have a stack frame; doesn't save BP. Implies `NOSPLIT` for the most part.

You include `textflag.h` at the top of every `.s` file:

```
#include "textflag.h"
```

---

## 5. Argument access via FP

For a Go function `func Add(a, b int64) int64`, the layout at FP is:

```
FP +0  : a    (8 bytes)
FP +8  : b    (8 bytes)
FP +16 : ret  (8 bytes)
```

Read and write with named offsets:

```
TEXT ·Add(SB), NOSPLIT, $0-24
    MOVQ a+0(FP), AX
    MOVQ b+8(FP), BX
    ADDQ BX, AX
    MOVQ AX, ret+16(FP)
    RET
```

For slices, the layout is `(ptr, len, cap)` — three 8-byte fields on 64-bit platforms:

```
// func Sum(xs []int64) int64
TEXT ·Sum(SB), NOSPLIT, $0-32
    MOVQ xs_base+0(FP), SI    // ptr
    MOVQ xs_len+8(FP), CX     // len
    // xs_cap+16(FP) — cap, often unused
    // ret+24(FP) — return slot
```

For strings: `(ptr, len)` — two fields. For interfaces: `(itab, data)` — two pointers. Get this wrong and you read garbage. `go vet` checks the offsets against the Go declaration if you name them.

---

## 6. Return slots

The return value goes into the same caller-supplied argument area, immediately after the args. Just write to it:

```
MOVQ AX, ret+16(FP)
RET
```

Multiple returns get successive offsets:

```go
func Divmod(a, b int64) (q, r int64)
```

```
TEXT ·Divmod(SB), NOSPLIT, $0-32
    MOVQ a+0(FP), AX
    MOVQ b+8(FP), CX
    CQO
    IDIVQ CX
    MOVQ AX, q+16(FP)
    MOVQ DX, r+24(FP)
    RET
```

The toolchain doesn't enforce that you wrote into the return slots — if you forget, the caller reads whatever was on the stack. Always write before `RET`.

---

## 7. Local stack frame

When you need scratch space, declare a non-zero frame size:

```
TEXT ·Hash(SB), NOSPLIT, $32-24
    MOVQ AX, 0(SP)    // 32 bytes of local: 0..31
    MOVQ BX, 8(SP)
    MOVQ CX, 16(SP)
    MOVQ DX, 24(SP)
    // ...
    RET
```

The prologue (which `NOSPLIT` does *not* skip — `NOFRAME` does) subtracts `$32` from the hardware SP and saves the BP. The epilogue undoes it on `RET`. Locals are addressed from the frame-relative `SP`.

---

## 8. Calling Go from assembly

```
MOVQ $42, AX
MOVQ AX, arg+0(FP)
CALL runtime·printlock(SB)
```

The assembler inserts ABI translation wrappers between assembly (default ABI0) and Go (default ABIInternal in 1.17+). You write to the FP offsets the *callee* expects; the toolchain bridges to register-based ABI if needed.

When calling Go from assembly:
- Save any caller-clobbered registers you care about.
- Make sure your function isn't `NOSPLIT` if the called Go function might grow the stack — the prologue check is what allows the runtime to detect and handle that.

---

## 9. Calling assembly from Go

```go
package fast

//go:noescape
func Add(a, b int64) int64
```

The Go side declares the signature with no body. The `.s` file provides it. Two annotations matter:

- **`//go:noescape`** — tells the compiler that pointer arguments don't escape via this function. Without it, slice/pointer args may be moved to the heap pessimistically.
- **`//go:nosplit`** on the *Go declaration* — rare, but propagates the no-stack-split contract.

For a function declared in Go but defined in `.s`, the compiler accepts the empty body as long as a matching `.s` file exists for the build's GOARCH.

---

## 10. The Go ABI: ABI0 vs ABIInternal

Go 1.17 introduced **ABIInternal**, a register-based calling convention. Args go in registers (AX, BX, CX, DI, SI, R8, R9, R10, R11, R12, R13, X0..X14 on amd64) instead of the stack. Faster, but harder to write by hand.

Assembly defaults to **ABI0** — arguments on the stack at FP offsets. The toolchain auto-generates ABI wrappers, so:

- Go (ABIInternal) → assembly (ABI0): the wrapper moves register args onto the stack before the `CALL`.
- Assembly (ABI0) → Go (ABIInternal): the wrapper reads the stack args and loads them into registers.

You can opt assembly into ABIInternal explicitly:

```
TEXT ·Add<ABIInternal>(SB), NOSPLIT, $0-24
    ADDQ BX, AX
    RET
```

But for hand-written code, stick with ABI0 unless the wrapper overhead matters in a tight benchmark. The runtime itself has a mix of both.

---

## 11. Instruction naming

Plan 9 mnemonics carry the operand size as a suffix:

| Suffix | Width | Example |
|--------|-------|---------|
| `B` | 8-bit (byte) | `MOVB`, `ADDB` |
| `W` | 16-bit (word) | `MOVW`, `ADDW` |
| `L` | 32-bit (long) | `MOVL`, `ADDL` |
| `Q` | 64-bit (quad) | `MOVQ`, `ADDQ` |
| `O` | 128-bit | `MOVOU` (unaligned XMM move) |

For arm64, the convention differs: register suffix indicates width (`X0` is 64-bit, `W0` is the 32-bit view). Instructions like `ADD`, `LDR`, `STR` don't take size suffixes; the register name carries it.

Operand order is **source, destination**:

```
MOVQ AX, BX     ; BX = AX (NOT AX = BX)
ADDQ AX, BX     ; BX = BX + AX
```

This is AT&T order, not Intel. A frequent source of confusion when porting code.

---

## 12. Branches and labels

```
TEXT ·Find(SB), NOSPLIT, $0-32
    MOVQ xs_base+0(FP), SI
    MOVQ xs_len+8(FP), CX
    MOVQ target+24(FP), DX
    XORQ AX, AX
loop:
    CMPQ AX, CX
    JGE  notfound
    CMPQ (SI)(AX*8), DX
    JEQ  found
    INCQ AX
    JMP  loop
found:
    MOVQ AX, ret+32(FP)
    RET
notfound:
    MOVQ $-1, ret+32(FP)
    RET
```

Labels are local to the function; conditional jumps include `JEQ` (equal), `JNE`, `JLT`, `JGE`, `JLS` (unsigned less-or-same), `JHI` (unsigned higher), and the rest. The unsigned variants matter for unsigned comparisons (lengths, sizes).

---

## 13. Includes and macros

```
#include "textflag.h"          // NOSPLIT, NEEDCTXT, ...
#include "go_asm.h"            // generated; constants from Go source
```

`go_asm.h` is generated by `go tool compile -asmhdr` and exports Go-side constants (struct field offsets, `unsafe.Sizeof` of named types) as `#define`s. This is how the runtime's assembly references `g_m`, `m_p`, etc. — symbols that match Go struct layout but stay synchronized as the layout evolves.

```
MOVQ g_m(R14), AX     // R14 holds g on amd64 register ABI
MOVQ m_p(AX), BX
```

For your own code, you rarely need `go_asm.h` unless you're crossing into runtime internals.

---

## 14. A complete cross-arch package

```
fast/
├── fast.go            // declarations
├── fast_amd64.s       // amd64 implementation
├── fast_arm64.s       // arm64 implementation
├── fast_other.go      // pure-Go fallback
└── fast_test.go
```

```go
// fast.go
package fast

//go:noescape
func Sum(xs []int64) int64
```

```go
// fast_other.go
//go:build !amd64 && !arm64

package fast

func Sum(xs []int64) int64 {
    var s int64
    for _, x := range xs { s += x }
    return s
}
```

Build tags on the `.s` files come from the filename suffix automatically. The `_other.go` file's build constraint excludes architectures that have assembly. The Go side has one declaration that all builds compile against.

---

## 15. Summary

The middle-level mental model is: pseudo-registers (SB/FP/SP/PC) plus `TEXT ·Name(SB), FLAGS, $frame-args` plus FP-relative argument access plus a per-arch instruction table. The assembler does the mapping; you do the bookkeeping. `NOSPLIT` is a sharp tool — use it only for short leaf functions. ABI0 is the default and is fine for hand-written code; the toolchain bridges to ABIInternal automatically. Build constraints via filename suffixes keep per-arch code organized, and a Go fallback keeps the package portable. From here, the [senior](senior.md) level dives into SIMD, the runtime's use of assembly, and the corners where the ABI matters.

---

## Further reading
- "A Quick Guide to Go's Assembler": https://go.dev/doc/asm
- Plan 9 assembler manual: http://9p.io/sys/doc/asm.html
- `cmd/asm` reference: https://pkg.go.dev/cmd/asm
- `textflag.h` source: https://github.com/golang/go/blob/master/src/runtime/textflag.h
- Internal ABI specification: https://github.com/golang/go/blob/master/src/cmd/compile/abi-internal.md
