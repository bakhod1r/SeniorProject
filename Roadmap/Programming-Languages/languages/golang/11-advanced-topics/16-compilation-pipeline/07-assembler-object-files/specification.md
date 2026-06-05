# Assembler & Object Files — Specification

A reference for Go's Plan 9-style assembler and object-file model. Values are drawn from `runtime/textflag.h`, `cmd/internal/obj`, `cmd/internal/goobj`, and the [Go assembler guide](https://go.dev/doc/asm). Always confirm against the Go version you target.

## 1. Pseudo-registers

| Pseudo-reg | Full name | Refers to | Typical use |
|-----------|-----------|-----------|-------------|
| `SB` | Static Base | Global symbol space | Naming functions & globals: `name(SB)`, `runtime·x(SB)` |
| `FP` | Frame Pointer (virtual) | Incoming argument block | Read args/results: `a+0(FP)`, `ret+16(FP)` |
| `SP` | Stack Pointer (pseudo) | Current local frame | Locals & outgoing call args: `x-8(SP)`, `0(SP)` |
| `PC` | Program Counter | Instruction pointer | Branch targets, labels (mostly implicit) |

Notes:
- The **pseudo-`SP`** (frame-relative, with a symbol/offset like `x-8(SP)`) differs from the **hardware `SP`** (bare `(SP)` / `0(SP)` for outgoing args) on architectures where they diverge. Context disambiguates: a name prefix means pseudo-SP.
- `FP` offsets are non-negative (args grow upward from FP); pseudo-`SP` local offsets are typically negative (`-8(SP)`).
- Real architecture registers (`AX`, `R0`, `X0`, ...) are written bare and are arch-specific.

## 2. Directives

| Directive | Form | Purpose |
|-----------|------|---------|
| `TEXT` | `TEXT sym(SB), flags, $frame-args` | Define a code (function) symbol |
| `DATA` | `DATA sym+off(SB)/width, $value` | Initialize `width` bytes of a data symbol |
| `GLOBL` | `GLOBL sym(SB), flags, $size` | Declare a global data symbol of `size` bytes |
| `PCDATA` | `PCDATA $index, $value` | Attach a PC-indexed value (e.g. stack-map index); usually compiler-generated |
| `FUNCDATA` | `FUNCDATA $index, sym(SB)` | Associate auxiliary data (stack maps, arg/local pointer maps) with a function |
| `RET` | `RET` | Return from the current function |
| `JMP` / `CALL` | `CALL sym(SB)` | Transfer control / call |
| `#include` | `#include "textflag.h"` | Preprocessor include (for flag names) |
| `#define` | `#define NAME val` | Preprocessor macro |

`PCDATA`/`FUNCDATA` are how the runtime gets per-PC stack maps for GC and stack copying; in hand-written asm you rarely write them, but `NOSPLIT`/`NOFRAME` and frame sizes interact with them.

## 3. Text/data flags (`runtime/textflag.h`)

Values are the canonical bit values; OR them in the `TEXT`/`GLOBL` flags field.

| Flag | Value | Applies to | Meaning |
|------|------:|-----------|---------|
| `NOPROF` | 1 | text | (deprecated) don't profile |
| `DUPOK` | 2 | text/data | Duplicate definitions allowed; linker keeps one |
| `NOSPLIT` | 4 | text | Omit the stack-split (morestack) preamble |
| `RODATA` | 8 | data | Place in read-only section |
| `NOPTR` | 16 | data | Contains no pointers; GC skips scanning |
| `WRAPPER` | 32 | text | Wrapper fn; doesn't disable `recover` |
| `NEEDCTXT` | 64 | text | Uses the incoming closure context register |
| `TLSBSS` | 256 | data | Thread-local storage |
| `NOFRAME` | 512 | text | No frame setup (only valid when frame size is 0) |
| `REFLECTMETHOD` | 1024 | text | May call reflect Method/MethodByName |
| `TOPFRAME` | 2048 | text | Outermost stack frame; unwinders stop here |
| `ABIWRAPPER` | 4096 | text | This is an ABI bridge wrapper |

ABI selectors used in the flags field of newer asm: `ABIInternal` (register-based) vs the implicit default `ABI0` (stack-based).

## 4. The TEXT signature grammar

```
TEXT  symbol , [ flags ] , $framesize [ - argsize ]
```

- **`symbol`** — `«pkg»·name(SB)` where `·` is U+00B7. Bare `·name(SB)` means the current package; `import/path·name(SB)` names another package's symbol.
- **`flags`** — zero or more textflags OR-ed (`NOSPLIT|NOFRAME`), and optionally an ABI selector (`NOSPLIT|ABIInternal`). May be `0`.
- **`$framesize`** — bytes of local stack frame (locals + outgoing-call arg space). `$0` if none.
- **`argsize`** — bytes of incoming arguments + results, as the caller laid out (ABI0 memory layout). Optional only for functions with no Go prototype; mandatory and `go vet`-checked otherwise.

Examples:
```
TEXT ·Add(SB), NOSPLIT, $0-24
TEXT ·memclr(SB), NOSPLIT|NOFRAME, $0-16
TEXT ·fast(SB), NOSPLIT|ABIInternal, $0-24
TEXT runtime·morestack(SB), NOSPLIT|NOFRAME|TOPFRAME, $0-0
```

## 5. Operand syntax

| Syntax | Meaning |
|--------|---------|
| `$123`, `$0xff` | Immediate integer constant |
| `$f64.400921fb...` | Immediate float (encoded) |
| `$sym(SB)` | Address of a symbol (immediate) |
| `AX`, `R0`, `X1` | Bare register |
| `(AX)` | Memory at address in `AX` |
| `8(AX)` | Memory at `AX + 8` |
| `(AX)(BX*4)` | Indexed: `AX + BX*4` |
| `name+8(FP)` | Argument/result slot `name` at FP offset 8 |
| `name-8(SP)` | Local at pseudo-SP offset −8 |

Instruction operand order is generally **source(s), destination** (AT&T-like): `MOVQ src, dst`; `ADDQ x, y` computes `y += x`. Mnemonic size suffixes on amd64: `B`=1, `W`=2, `L`=4, `Q`=8 bytes (e.g. `MOVB`/`MOVL`/`MOVQ`).

## 6. Symbol-name syntax

- In `.s` source: `·name` (current pkg), `path/to/pkg·name` (other pkg), always suffixed `(SB)`.
- The `·` is the middle dot (U+00B7); the `/` separates package path components.
- Resolved/`nm` form: package path with `/`, then `.`, then name — e.g. `runtime.memmove`, `mymod/x.Add`.
- ABI-qualified form (in `nm -size` / linker): `name<ABI0>` vs `name<ABIInternal>`.

## 7. Object-file / relocation model (`cmd/internal/obj`, `goobj`)

`LSym` (in [`obj/link.go`](https://github.com/golang/go/blob/master/src/cmd/internal/obj/link.go)) — one symbol:

| Field | Meaning |
|-------|---------|
| `Name` | Symbol name |
| `Type` | `STEXT`, `SRODATA`, `SDATA`, `SBSS`, `SNOPTRDATA`, ... |
| `Attribute` | Bitfield: `DUPOK`, `NOSPLIT`, `RODATA`, `NOPTR`, ... |
| `Size` | Byte size |
| `P` | Raw bytes (code or data) |
| `R []Reloc` | Relocations |
| `Func` | `FuncInfo`: frame size, args, pcln tables |
| `ABI` | `ABI0` / `ABIInternal` (text symbols) |

`Reloc` — a fixup:

| Field | Meaning |
|-------|---------|
| `Off` | Offset within `P` to patch |
| `Siz` | Width of the fixup (bytes) |
| `Type` | `R_ADDR`, `R_CALL`, `R_PCREL`, `R_TLS_LE`, ... |
| `Add` | Addend |
| `Sym` | Target symbol |

The serialized form is the **goobj** format ([`cmd/internal/goobj/objfile.go`](https://github.com/golang/go/blob/master/src/cmd/internal/goobj/objfile.go)): header + string/pkg tables + symbol defs (name, ABI, type, flags, size) + per-symbol data + relocations + aux symbols (pcln, DWARF, FuncInfo). Both `cmd/compile` and `cmd/asm` emit it; `cmd/link` consumes it. Objects are bundled into a `.a` archive by `cmd/pack`.

## 8. Tooling

| Command | Purpose |
|---------|---------|
| `go tool asm file.s` | Invoke the assembler directly → `.o` |
| `go tool compile pkg.go` | Compiler (also emits goobj) |
| `go tool pack t/r/x/c file.a` | List / add / extract / create archive members |
| `go tool nm obj\|.a\|binary` | List symbols and their section codes (`T`,`D`,`R`,`B`,`U`) |
| `go tool objdump -s sym binary` | Disassemble a symbol |
| `go build -gcflags=-S` / `go tool compile -S` | Print the compiler's generated assembly |
| `go build -x` | Print build commands (see `asm`/`pack` invocations) |
| `go build -work` | Keep & print the temp `WORK=` dir (the `.o`/`.a` live there) |
| `go vet` (asmdecl) | Cross-check `.s` frame/arg/offset against Go prototypes |

`nm` symbol type codes: `T`/`t` text, `D`/`d` data, `R`/`r` rodata, `B`/`b` bss, `U` undefined (lowercase = local).

## 9. Further reading

- [A Quick Guide to Go's Assembler](https://go.dev/doc/asm) — directives, pseudo-registers, operand syntax.
- [`runtime/textflag.h`](https://github.com/golang/go/blob/master/src/runtime/textflag.h) — authoritative flag values.
- [`cmd/internal/obj/link.go`](https://github.com/golang/go/blob/master/src/cmd/internal/obj/link.go) — `LSym`/`Reloc`.
- [`cmd/internal/goobj/objfile.go`](https://github.com/golang/go/blob/master/src/cmd/internal/goobj/objfile.go) — object-file format.
- [`cmd/compile/abi-internal.md`](https://github.com/golang/go/blob/master/src/cmd/compile/abi-internal.md) — ABI0 vs ABIInternal.
- Tool docs: [`go tool nm`](https://pkg.go.dev/cmd/nm), [`go tool pack`](https://pkg.go.dev/cmd/pack), [`go tool asm`](https://pkg.go.dev/cmd/asm).
