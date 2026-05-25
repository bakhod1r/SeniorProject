# Go Assembly — Specification

> **Focus:** Precise reference for Go's Plan 9 assembly dialect — syntax, register conventions, calling convention, and integration with Go source.
>
> **Sources:**
> - `cmd/asm` documentation: https://pkg.go.dev/cmd/asm
> - "A Quick Guide to Go's Assembler": https://go.dev/doc/asm
> - Plan 9 assembler manual: http://9p.io/sys/doc/asm.html

---

## 1. What Go assembly is

Go uses a unified assembly syntax derived from Plan 9. It's **not** standard GNU `as` syntax — instructions and operand syntax differ. The Go toolchain translates this universal assembly into the target architecture's native instructions at build time.

Why? Portability across architectures with a single tool, integration with the Go calling convention, and tight coupling with the runtime (stack-growth checks, write barriers).

---

## 2. File naming

Assembly files use the `.s` extension and follow the same `_GOOS_GOARCH` naming rules as Go:

```
fast.go                 // Go entry points (declarations)
fast_amd64.s            //go:build amd64
fast_arm64.s            //go:build arm64
fast_other.go           //go:build !amd64 && !arm64
```

Build constraints work in `.s` files via `//go:build`.

---

## 3. Function declarations

Go side declares the function with no body:

```go
package fast

//go:noescape
func Sum(xs []int64) int64
```

Assembly side defines it:

```
#include "textflag.h"

// func Sum(xs []int64) int64
TEXT ·Sum(SB), NOSPLIT, $0-32
    // body
    RET
```

The `·` (middle dot) is Plan 9's package-separator. `Sum` without prefix is in the current file's package. Wide forms: `example.com/pkg·Sum`.

---

## 4. The `TEXT` directive

```
TEXT package·funcname(SB), FLAGS, $framesize-argsize
```

| Field | Meaning |
|-------|---------|
| `package·funcname` | Symbol name |
| `(SB)` | Static base pointer; required for symbols |
| `FLAGS` | Function flags (see below) |
| `$framesize` | Local frame size in bytes |
| `-argsize` | Caller-arg + return size in bytes |

Common flags:

| Flag | Effect |
|------|--------|
| `NOSPLIT` | Don't insert stack-split check (use for tiny leaf functions) |
| `WRAPPER` | Function wraps another (affects stack traces) |
| `NEEDCTXT` | Function needs the closure context register |
| `TLSBSS` | Function uses thread-local storage |

---

## 5. Pseudo-registers

Plan 9 assembly uses pseudo-registers that the assembler maps to real registers per architecture:

| Pseudo | Meaning |
|--------|---------|
| `SB` | Static base — for symbol addressing |
| `FP` | Frame pointer — for argument access |
| `PC` | Program counter |
| `SP` | Stack pointer (Go's, not the hardware's directly) |

Argument access:

```
MOVQ xs_base+0(FP), AX     // first slice's pointer
MOVQ xs_len+8(FP), CX      // first slice's length
MOVQ ret+24(FP), DX        // return value slot
```

The offsets are relative to FP and must match the Go signature's layout.

---

## 6. Hardware registers (amd64 example)

| Register | Common use |
|----------|-----------|
| `AX`, `BX`, `CX`, `DX` | General purpose |
| `SI`, `DI` | Source/destination index |
| `R8` – `R15` | Additional general purpose |
| `X0` – `X15` | SSE/XMM (128-bit) |
| `Y0` – `Y15` | AVX (256-bit) |
| `Z0` – `Z31` | AVX-512 (512-bit) |

Plan 9 names these `AX`, `BX`, etc. without the `R` prefix that Intel uses. Sizes are encoded in the instruction suffix (`MOVB`, `MOVW`, `MOVL`, `MOVQ`).

---

## 7. Instruction names

Plan 9 mnemonics are unique:

| Plan 9 | Intel/AT&T equivalent |
|--------|----------------------|
| `MOVQ` | `mov` (64-bit) |
| `MOVL` | `mov` (32-bit) |
| `MOVW` | `mov` (16-bit) |
| `MOVB` | `mov` (8-bit) |
| `ADDQ` | `add` (64-bit) |
| `CMPQ` | `cmp` (64-bit) |
| `JNE`, `JEQ` | `jne`, `je` |
| `CALL` | `call` |
| `RET` | `ret` |

The suffix `B`/`W`/`L`/`Q` indicates operand size (byte/word/long/quad). For ARM, `S`/`X` indicates 32/64-bit operations.

---

## 8. The Go ABI

Go 1.17 introduced a register-based calling convention (ABIInternal); previous versions used stack-based (ABI0). Assembly functions can use either:

- **ABI0** (default for `.s` files): args and returns on the stack at FP-relative offsets.
- **ABIInternal**: args and returns in registers. Used by the Go compiler; assembly must declare `ABIInternal` explicitly.

Most assembly uses ABI0 with FP-offset access. Bridges to ABI0 are inserted automatically when assembly calls Go (and vice versa).

---

## 9. Stack management

```
TEXT ·foo(SB), NOSPLIT, $0
```

`NOSPLIT` skips the stack-growth check. Use only for short leaf functions; longer ones must allow stack growth.

The frame size `$N` declares how much local stack space the function uses. `$0` means no locals.

---

## 10. Constants and macros

```
#include "textflag.h"

#define BLOCKSIZE 32
```

`textflag.h` defines `NOSPLIT`, `NEEDCTXT`, etc. Include it in every `.s` file.

For platform-specific constants, use `#ifdef` (a limited form is supported).

---

## 11. Calling Go from assembly

```
CALL runtime·gopanic(SB)
```

Calling into runtime or other Go functions follows the Go ABI. The assembler inserts ABI wrappers as needed.

---

## 12. Loop and branching

```
loop:
    MOVQ (BX), AX
    ADDQ AX, R8
    ADDQ $8, BX
    DECQ CX
    JNE  loop
```

Labels are local to the function; conditional/unconditional jumps use them.

---

## 13. SIMD / vector instructions

```
VPADDQ Y0, Y1, Y2       // packed 64-bit add (AVX)
VMOVDQU 0(SI), Y0       // unaligned 256-bit load
```

Available instructions depend on architecture. The assembler accepts most amd64 vector instructions. For specialized ones, you may need to emit raw bytes:

```
BYTE $0xC4; BYTE $0xE2; BYTE $0x7B; BYTE $0xF7; BYTE $0xC0
```

---

## 14. Generating from intrinsics

For complex SIMD code, hand-writing Plan 9 assembly is painful. Tools like [`avo`](https://github.com/mmcloughlin/avo) let you generate Plan 9 assembly from a Go DSL:

```go
package main

import . "github.com/mmcloughlin/avo/build"

func main() {
    TEXT("Add", NOSPLIT, "func(a, b []int64, dst []int64)")
    // ... avo DSL ...
    Generate()
}
```

`avo` is how many high-performance Go libraries produce their `.s` files.

---

## 15. Limitations

- No standard arithmetic on `SP` directly (use FP).
- Some debug info less detailed than for Go code.
- Disassembling Go assembly requires `go tool objdump`, not `objdump`.
- Race detector doesn't instrument `.s` code.

---

## 16. Related references

- Plan 9 assembler reference: http://9p.io/sys/doc/asm.html
- Go assembly guide: https://go.dev/doc/asm
- `cmd/asm`: https://pkg.go.dev/cmd/asm
- `avo`: https://github.com/mmcloughlin/avo
