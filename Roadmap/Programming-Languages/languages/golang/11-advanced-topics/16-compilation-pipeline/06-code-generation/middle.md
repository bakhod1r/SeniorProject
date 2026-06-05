# Code Generation — Middle

## 1. Registers and the calling convention

A CPU does arithmetic in a small set of named **registers**. On amd64 the general-purpose 64-bit registers are `AX, BX, CX, DX, SI, DI, BP, SP, R8`–`R15`. Code generation must decide which value lives in which register at each moment — that is *register allocation* — and it must obey a **calling convention**: the agreed rules for how arguments and results are handed between caller and callee.

Since Go 1.17 the `gc` compiler uses a **register-based calling convention** internally, called **ABIInternal**. The first nine integer/pointer arguments are passed in this order on amd64:

```
AX, BX, CX, DI, SI, R8, R9, R10, R11
```

Floating-point arguments use `X0`–`X14`. Results come back the same way (first integer result in `AX`, first float result in `X0`). If a function has more arguments than there are registers, the overflow **spills** to the stack.

Recall the `Add` function from the junior tier:

```go
//go:noinline
func Add(a, b int) int { return a + b }
```

```
TEXT	main.Add(SB), NOSPLIT|NOFRAME|ABIInternal, $0-16
	ADDQ	BX, AX        // AX = a + b   (a in AX, b in BX)
	RET                   // result already in AX
```

`a` arrived in `AX`, `b` in `BX`, and the `int` result is left in `AX`. No stack touch at all — this is what the register ABI buys you. The `ABIInternal` tag on the `TEXT` line confirms which convention is in force. (Functions that talk to hand-written assembly use the older stack-based **ABI0**; see the senior tier.)

---

## 2. Prologue, epilogue, and stack frames

`Add` had `NOFRAME`: no stack frame. As soon as a function needs local storage, calls another function, or might need its stack grown, the compiler emits a **prologue** and **epilogue**.

Here is a function that stores a pointer (which triggers a frame and a stack-growth check):

```go
//go:noinline
func Store(t *T, p *int) { t.p = p }
```

The amd64 `-S` listing (write-barrier lines elided for now) begins:

```
TEXT	main.Store(SB), ABIInternal, $8-16
	CMPQ	SP, 16(R14)        // stack-bound check: is SP below the limit?
	JLS	morestack           // if so, jump to grow the stack
	PUSHQ	BP                  // save caller's frame pointer
	MOVQ	SP, BP              // set up this frame's frame pointer
	... body ...
	POPQ	BP                  // restore frame pointer
	RET
```

The pieces:

- **`$8-16`** on the `TEXT` line: frame size 8 bytes, args+results area 16 bytes.
- **`CMPQ SP, 16(R14)` / `JLS`** — the **stack-bound check** (the *prologue split check*). `R14` holds the `g` (goroutine) pointer in ABIInternal; `16(R14)` is the goroutine's stack limit. If the stack pointer has dropped below the limit, the function jumps to `runtime.morestack` to grow the stack, then retries. Tiny leaf functions are marked `nosplit` and skip this.
- **`PUSHQ BP` / `MOVQ SP, BP`** — the prologue saves and sets the **frame pointer** (`BP`), so debuggers and profilers can walk the stack. The epilogue's `POPQ BP` restores it.

The `g` register (`R14` on amd64, `R28` on arm64) always points to the current goroutine. The runtime relies on it being there; this is one reason you cannot freely clobber registers in hand-written assembly.

---

## 3. Intrinsics: standard-library calls that become one instruction

Some standard-library functions are special-cased by the compiler so that a *call* turns into a *single CPU instruction*. These are **intrinsics**, defined in `cmd/compile/internal/ssagen/intrinsics.go`. The classic examples are in `math/bits` and `sync/atomic`.

```go
//go:noinline
func Lead(x uint64) int { return bits.LeadingZeros64(x) }
```

There is no `CALL` in the output. On amd64:

```
TEXT	main.Lead(SB), NOSPLIT|NOFRAME|ABIInternal, $0-8
	BSRQ	AX, AX             // bit-scan-reverse: index of highest set bit
	MOVQ	$-1, CX
	CMOVQEQ	CX, AX             // handle x==0 case
	ADDQ	$-63, AX
	NEGQ	AX
	RET
```

`bits.LeadingZeros64` compiled to a `BSRQ` (bit scan reverse) plus a tiny fix-up for the zero case — no function call, no stack frame. On a chip with the LZCNT instruction (see GOAMD64 in the professional tier) it can become a single `LZCNT`. On arm64 the whole thing collapses to one instruction:

```
TEXT	main.Lead(SB), LEAF|NOFRAME|ABIInternal, $0-8
	CLZ	R0, R0             // count-leading-zeros, one instruction
	RET	(R30)
```

Intrinsics matter for performance: if you see a `CALL math/bits.LeadingZeros64` in your output instead of `BSRQ`/`CLZ`, the intrinsic did **not** fire and you are paying full call overhead. Common intrinsic families:

| Package | Examples | Typical instruction |
| --- | --- | --- |
| `math/bits` | `LeadingZeros`, `TrailingZeros`, `OnesCount`, `RotateLeft`, `ReverseBytes` | `BSR`/`LZCNT`, `BSF`/`TZCNT`, `POPCNT`, `ROL`, `BSWAP` |
| `sync/atomic` | `AddInt64`, `CompareAndSwapInt64`, `LoadInt64` | `LOCK XADD`, `LOCK CMPXCHG`, `MOV` |
| `math` | `Sqrt`, `Abs`, `RoundToEven` | `SQRTSD`, etc. |
| `runtime` | `getg`, slice/`memmove` helpers | register reads, inlined copies |

---

## 4. Comparing amd64 vs arm64 output

Build the *same source* twice, changing only `GOARCH`:

```bash
GOARCH=amd64 go build -gcflags=-S . 2>&1 | less
GOARCH=arm64 go build -gcflags=-S . 2>&1 | less
```

For `Add`:

```
; amd64
	ADD	R1, R0, R0   ← arm64
	ADDQ	BX, AX       ← amd64
```

Differences you will notice:

- **Register names.** amd64 uses `AX, BX, CX, ...`; arm64 uses `R0, R1, R2, ...` and `R30` as the link register (return address).
- **Instruction width suffixes.** amd64 tags width on the mnemonic (`ADDQ` = 64-bit, `ADDL` = 32-bit). arm64 encodes width in the register form, so it is just `ADD`.
- **Leaf functions and returns.** arm64 marks small functions `LEAF` and returns with `RET (R30)` (jump to the link register). amd64 uses a bare `RET`.
- **Three-operand form.** arm64 is a RISC ISA: `ADD R1, R0, R0` means `R0 = R0 + R1` with an explicit destination. amd64 is two-operand: `ADDQ BX, AX` means `AX += BX`, destination doubles as a source.
- **Frame-growth check.** Both arches emit the morestack check, but compare different registers (`16(R14)` on amd64 vs the equivalent on arm64's `R28`).

The *logic* is identical because it all came from the same architecture-neutral SSA; only the final instruction-selection table differs per arch.

---

## 5. GOARCH (and a peek at GOAMD64) effects

`GOARCH` selects the target CPU family and therefore the entire instruction-selection backend. Cross-dumping is free — you do not need that hardware:

```bash
GOARCH=amd64 go build -gcflags=-S .
GOARCH=arm64 go build -gcflags=-S .
GOARCH=riscv64 go build -gcflags=-S .
```

Within amd64 there is a second knob, **`GOAMD64`**, selecting a microarchitecture level (`v1` default, `v2`, `v3`, `v4`). Higher levels let the compiler assume newer instructions exist. For example, with `GOAMD64=v3` a leading-zeros count can use the single `LZCNT` instruction instead of the `BSRQ`+fix-up sequence shown above:

```bash
GOAMD64=v3 GOARCH=amd64 go build -gcflags=-S .
```

This is fully covered in the professional and optimize tiers; for now just know that the *same Go code* can produce different instructions depending on `GOARCH` and `GOAMD64`.

---

## 6. Summary

- The **register-based ABI (ABIInternal)**, Go 1.17+, passes the first integer args in `AX, BX, CX, DI, SI, R8–R11` on amd64 and `R0–R7` on arm64; floats in `X0`/`V0` registers.
- **Prologue/epilogue**: a `CMPQ SP, 16(R14)` + `JLS morestack` stack-bound check, plus `PUSHQ BP`/`POPQ BP` frame-pointer maintenance. Tiny leaf functions are `nosplit`/`NOFRAME`.
- The **`g` register** (`R14` amd64, `R28` arm64) always holds the current goroutine pointer.
- **Intrinsics** (`cmd/compile/internal/ssagen/intrinsics.go`) turn `math/bits`, `sync/atomic`, and some `math` calls into single instructions; a stray `CALL` means the intrinsic did not fire.
- Switching **`GOARCH`** changes register names and instruction forms; **`GOAMD64`** levels unlock newer amd64 instructions.

---

## Further reading

- [Go internal ABI specification (ABIInternal)](https://github.com/golang/go/blob/master/src/cmd/compile/abi-internal.md) — register assignment rules per arch
- [A Quick Guide to Go's Assembler](https://go.dev/doc/asm)
- Go source: [`cmd/compile/internal/ssagen/intrinsics.go`](https://github.com/golang/go/blob/master/src/cmd/compile/internal/ssagen/intrinsics.go)
- [GOAMD64 microarchitecture levels](https://go.dev/wiki/MinimumRequirements#amd64)
- Go source: [`cmd/compile/internal/arm64`](https://github.com/golang/go/tree/master/src/cmd/compile/internal/arm64)
