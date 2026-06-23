# Code Generation — Specification

A reference for the final compiler stage: the register-based ABI, the tooling to inspect output, the obj layer model, GC metadata, and intrinsic categories. Behavior described matches the `gc` toolchain (Go 1.17+ for the register ABI).

---

## 1. The register-based ABI (ABIInternal) — argument & result registers

Since Go 1.17, Go-to-Go calls pass arguments and results in registers. Spec: `cmd/compile/abi-internal.md`.

### amd64

| Purpose | Registers (in order) |
| --- | --- |
| Integer/pointer args & results | `AX, BX, CX, DI, SI, R8, R9, R10, R11` |
| Floating-point args & results | `X0`–`X14` |
| Overflow | spilled to the stack (FP-relative) |
| `g` (current goroutine) | `R14` (reserved) |
| Stack / frame pointer | `SP` / `BP` (reserved) |
| Scratch at calls | `R12`, `R13`, `R15` (used by the toolchain) |

### arm64

| Purpose | Registers (in order) |
| --- | --- |
| Integer/pointer args & results | `R0`–`R15` |
| Floating-point args & results | `F0`–`F15` (V registers) |
| `g` (current goroutine) | `R28` (reserved) |
| Link register (return addr) | `R30` |
| Stack / frame pointer | `RSP` / `R29` (reserved) |

Rules of thumb: a struct/array is spread across consecutive registers field-by-field if it fits; otherwise it goes to the stack. Aggregates with no pointers and ≤ the register budget are passed in registers. Results follow the same allocation as arguments. The first integer result is in `AX` (amd64) / `R0` (arm64); the first float result in `X0` / `F0`.

### ABI0 (assembly boundary)

The stable, stack-based convention used for hand-written `.s` files and the assembly↔Go boundary. All arguments and results live on the stack, addressed as `name+offset(FP)`. A linker-generated wrapper translates between ABI0 and ABIInternal.

---

## 2. Inspection tooling

| Command | Scope | Notes |
| --- | --- | --- |
| `go build -gcflags=-S ./...` | Per-package, all funcs | Pre-link listing; includes PCDATA/FUNCDATA + `rel` reloc notes. Writes to **stderr**. |
| `go tool compile -S file.go` | Single file | Only for self-contained files (no unresolvable imports). |
| `go tool objdump -s 'regexp' binary` | Linked binary | Post-link, absolute addresses; `-s` filters symbols by regexp. |
| `go tool objdump -S binary` | Linked binary | Interleaves source lines with disassembly. |
| `go tool pprof -disasm=Func bin prof` | Hot functions | Per-instruction sample counts from a CPU profile. |
| `go build -gcflags='-m'` | — | Inline/escape decisions (context for why a func is/ isn't its own symbol). |

`-S` listing anatomy:

```
SYM STEXT [nosplit] size=N args=0xA locals=0xL funcid=… align=…   ← symbol header
	TEXT  Sym(SB), FLAGS, $frame-argsize                             ← function declaration
	FUNCDATA $idx, table(SB)                                         ← GC/liveness side tables
	PCDATA   $idx, $val                                              ← PC-indexed selector
	<MNEMONIC> src, dst                                              ← real instruction (dst on right)
	rel off+sz t=RELOC sym+add                                       ← relocation to resolve at link
	0x.... <hex bytes>                                               ← assembled machine code
```

`TEXT` flags include `NOSPLIT` (no stack check), `NOFRAME` (no frame), `LEAF` (arm64, no calls), `ABIInternal` (register ABI), `DUPOK`, `WRAPPER`.

---

## 3. The obj layer model

```
lowered SSA value ──ssaGenValue──▶ obj.Prog ──┐
SSA block         ──ssaGenBlock──▶ obj.Prog ──┤── linked list per func, hung off obj.LSym
                                              ▼
                          obj backend (cmd/internal/obj/<arch>)
                                              ▼
                         machine-code bytes + relocations in the object file
                                              ▼
                                          linker
```

| Type (`cmd/internal/obj`) | Role |
| --- | --- |
| `obj.Prog` | One symbolic instruction: opcode `As`, operands `From`/`To`/`RestArgs` (each an `obj.Addr`), `Link` to next. |
| `obj.Addr` | An operand: register, memory `offset(reg)`, immediate `$n`, or symbol `sym(SB)`. |
| `obj.LSym` | A linker symbol (function, global). The function's `Prog` list and metadata attach here. |
| `obj.Reloc` | A relocation: where + type (`R_CALL`, `R_PCREL`, `R_ADDR`, …) + target symbol. |

`ssaGenValue` / `ssaGenBlock` live in the per-arch compiler packages (`cmd/compile/internal/amd64`, `arm64`, …). The byte-encoding assembler backends live in `cmd/internal/obj/x86`, `cmd/internal/obj/arm64`, etc.

---

## 4. PCDATA / FUNCDATA roles

These tables carry runtime metadata; they emit **no** machine code.

| Directive | Index | Meaning |
| --- | --- | --- |
| `FUNCDATA` | `$0` `FUNCDATA_LocalsPointerMaps` | Stack map: which local slots hold pointers (GC scan). |
| `FUNCDATA` | `$1` `FUNCDATA_ArgsPointerMaps` | Stack map: which argument slots hold pointers. |
| `FUNCDATA` | `$2` `FUNCDATA_StackObjects` | Addressable stack objects (for the GC). |
| `FUNCDATA` | `$5`/`$6` `arginfo`/`argliveinfo` | Argument layout & liveness for tracebacks. |
| `PCDATA` | `$0` `PCDATA_UnsafePoint` / stackmap index | Selects the live stack-map row at this PC. |
| `PCDATA` | `$1` `PCDATA_StackMapIndex` | Stack-map / preemption-point index, changes through the function. |
| `PCDATA` | `$3` `PCDATA_InlTreeIndex` | Inline-tree index for accurate inlined stack traces. |

The runtime consults these when a goroutine stops (precise GC scan), when growing a stack (`morestack` needs the pointer map at the call PC), and when building tracebacks. Index constants are defined in `runtime/funcdata.h` / `cmd/internal/objabi`.

---

## 5. Intrinsic categories

Intrinsics are registered in `cmd/compile/internal/ssagen/intrinsics.go`; a qualifying call is replaced by SSA ops that lower to one (or few) instructions instead of a `CALL`. Major categories:

| Package | Functions | Lowers to (amd64 example) |
| --- | --- | --- |
| `math/bits` | `LeadingZeros*`, `TrailingZeros*`, `OnesCount*`, `RotateLeft*`, `ReverseBytes*`, `Len*` | `BSR`/`LZCNT`, `BSF`/`TZCNT`, `POPCNT`, `ROL`, `BSWAP` |
| `sync/atomic` & `atomic.*` types | `Add*`, `CompareAndSwap*`, `Swap*`, `Load*`, `Store*` | `LOCK XADD`, `LOCK CMPXCHG`, `XCHG`, `MOV` |
| `math` | `Sqrt`, `Abs`, `Float64bits`, `Float64frombits`, `RoundToEven` | `SQRTSD`, bit moves, `ROUNDSD` |
| `runtime` internal | `getg`, `getcallerpc`, `KeepAlive`, slicebyte helpers | register reads / inlined ops |
| `runtime/internal` & `internal/cpu` | feature flags | direct loads |

Availability can depend on **GOAMD64** (e.g. `POPCNT` needs v2, `LZCNT` needs v3); below the required level the compiler emits a portable software sequence or a `CALL`.

---

## 6. Frame layout & prologue (reference)

A non-leaf, splittable function on amd64:

```
[ prologue ]
  CMPQ SP, 16(R14)        ; stack-bound check vs g.stackguard
  JLS  <morestack tail>
  PUSHQ BP                ; save caller frame pointer
  MOVQ  SP, BP            ; establish frame pointer
[ body ]                  ; locals at fixed (SP)/(BP) offsets; args via registers or (FP)
[ epilogue ]
  POPQ BP
  RET
[ morestack tail ]        ; spill live regs, CALL runtime.morestack_noctxt, JMP entry
```

`$frame-argsize` on the `TEXT` line: `frame` = bytes of locals (excluding saved BP/return address), `argsize` = bytes of args+results. `nosplit`/`LEAF`/`NOFRAME` functions omit the prologue.

---

## 7. Summary

- **ABIInternal** passes integer args in `AX,BX,CX,DI,SI,R8–R11` (amd64) / `R0–R15` (arm64); floats in `X*`/`F*`; `g` in `R14`/`R28`. **ABI0** is the stack-based assembly-boundary convention.
- Inspect with **`-gcflags=-S`** (pre-link, stderr), **`go tool objdump`** (post-link), **`go tool compile -S`** (single file), and **`pprof -disasm`** (with profile).
- The **obj layer**: `ssaGenValue`/`ssaGenBlock` build an `obj.Prog` list per `obj.LSym`; the obj backend emits bytes + `obj.Reloc`s.
- **PCDATA/FUNCDATA** carry stack maps & liveness for GC, stack growth, and tracebacks — no machine code.
- **Intrinsics** cover `math/bits`, `sync/atomic`, parts of `math`/`runtime`; availability can hinge on **GOAMD64**.

---

## Further reading

- [Go internal ABI specification](https://github.com/golang/go/blob/master/src/cmd/compile/abi-internal.md)
- [A Quick Guide to Go's Assembler](https://go.dev/doc/asm)
- Go source: [`cmd/internal/obj`](https://github.com/golang/go/tree/master/src/cmd/internal/obj) and [`cmd/internal/objabi`](https://github.com/golang/go/tree/master/src/cmd/internal/objabi)
- Go source: [`runtime/funcdata.h`](https://github.com/golang/go/blob/master/src/runtime/funcdata.h) — PCDATA/FUNCDATA index constants
- Go source: [`cmd/compile/internal/ssagen/intrinsics.go`](https://github.com/golang/go/blob/master/src/cmd/compile/internal/ssagen/intrinsics.go)
