# Assembler & Object Files — Senior

The middle tier treated the object file as a black box that `cmd/pack` stuffs into an archive. At the senior level you should understand the **object-file model itself**: the `obj` package's symbol representation (`LSym`), how relocations connect symbols, the new `goobj` on-disk format, why ABI0 and ABIInternal symbols coexist and how wrappers bridge them, and the crucial fact that **the compiler and the assembler emit the exact same object format** that the linker consumes.

## 1. One backend: `cmd/internal/obj`

Both `cmd/compile` and `cmd/asm` are front ends that lower their input down to a shared intermediate representation defined in [`cmd/internal/obj`](https://github.com/golang/go/tree/master/src/cmd/internal/obj). The compiler turns Go into this IR; the assembler turns Plan 9 asm into this IR. From there a per-architecture backend (`obj/x86`, `obj/arm64`, ...) does instruction selection/encoding, inserts the stack-split preamble, generates PC-value tables (line numbers, stack maps), and finally writes the object file.

This is why everything in the assembler "feels like" the compiler: the directives (`TEXT`, `DATA`, `GLOBL`), the flags (`textflag.go`), the symbol naming — they are the `obj` package's concepts, shared by both tools. The assembler is essentially a thin parser feeding `obj`.

## 2. LSym: the in-memory symbol

The unit of code or data in `obj` is an `LSym` ("linker symbol"), declared in [`cmd/internal/obj/link.go`](https://github.com/golang/go/blob/master/src/cmd/internal/obj/link.go). Conceptually:

```go
type LSym struct {
    Name string
    Type objabi.SymKind // STEXT, SRODATA, SBSS, SDATA, ...
    Attribute          // bitfield: DUPOK, NOSPLIT, RODATA, NOPTR, ...
    Size  int64
    Gotype *LSym
    P      []byte       // the raw bytes (machine code or data)
    R      []Reloc      // relocations
    Func   *FuncInfo    // for STEXT: frame size, args size, pcln tables, ...
    ABI    // ABI0 or ABIInternal (for text symbols)
    ...
}
```

Key fields:

- **`Type`** is the symbol kind: `STEXT` for code, `SRODATA`/`SDATA`/`SBSS`/`SNOPTRDATA` for various data sections. This is where your `TEXT` vs `DATA`/`GLOBL` + flags end up.
- **`P`** holds the assembled bytes — actual machine code for a `TEXT` symbol, or the `DATA`-filled bytes for a data symbol.
- **`R`** is the list of relocations (next section).
- **`Func`** (for code) carries `FuncInfo`: the `$framesize`, the args size, the `pcln` tables (PC→line, PC→stackmap via `PCDATA`/`FUNCDATA`), and more.

The `TEXT ·Add(SB), NOSPLIT, $0-24` you wrote becomes an `LSym` named `pkg.Add`, `Type=STEXT`, `Attribute` has the NOSPLIT bit, `Func.FramePointerSize`/args recorded, `P` filled with the encoded `MOVQ/ADDQ/MOVQ/RET` bytes.

## 3. Relocations: `obj.Reloc`

Object code can't be fully resolved in isolation. When `Add` references another symbol — a global, a called function, a string constant — the assembler does not yet know that symbol's final address (it depends on linking and layout). Instead it emits a **relocation**: "at offset *O* in my bytes, patch in the address of symbol *S*, with addend *A*, of kind *K*." This is `obj.Reloc` ([`link.go`](https://github.com/golang/go/blob/master/src/cmd/internal/obj/link.go)):

```go
type Reloc struct {
    Off  int32          // byte offset within the symbol's P where the fixup goes
    Siz  uint8          // width of the fixup (4 or 8 bytes typically)
    Type objabi.RelocType // R_CALL, R_PCREL, R_ADDR, R_TLS_LE, ...
    Add  int64          // addend
    Sym  *LSym          // the target symbol
}
```

Relocation kinds (defined in `cmd/internal/objabi/reloctype.go`):

| RelocType | Use |
|-----------|-----|
| `R_ADDR` | Absolute address of `Sym` (+addend). |
| `R_CALL` / `R_CALLARM64` | A call instruction's target. |
| `R_PCREL` | PC-relative reference (common on amd64 for data loads). |
| `R_TLS_LE` / `R_TLS_IE` | Thread-local storage offsets. |
| `R_USETYPE`, `R_USEIFACE` | Liveness/dead-code "this symbol is used" markers, no bytes. |

The linker (`cmd/link`) walks every symbol's `R` slice and applies each relocation once final addresses are known. A "relocation surprise" in hand-written asm usually means you referenced a symbol with the wrong relocation form for the architecture, or referenced an `SB` symbol where a PC-relative form was needed (see find-bug).

## 4. The goobj on-disk format

When `obj` finishes a compilation unit it serializes all the `LSym`s to a **Go object file** in the *new object file format*, defined and documented in [`cmd/internal/goobj/objfile.go`](https://github.com/golang/go/blob/master/src/cmd/internal/goobj/objfile.go). The header comment in that file is the spec; it is a structured, indexed, `mmap`-friendly format (not ELF, not Mach-O — Go's own). High level, a goobj file contains:

- A magic header (`go object` ...) and flags.
- String and "referenced-package" tables.
- A list of **symbol definitions** (`SymRef`s) with name, ABI, type, flags, size.
- Per-symbol **data** (the `P` bytes) and **relocations**.
- **Auxiliary symbols**: pcln tables, DWARF, FuncInfo, etc.

Both the compiler and the assembler write this *same* format. The linker reads goobj files (whether they came from `cmd/compile` or `cmd/asm`) uniformly — it neither knows nor cares which front end produced a given symbol. That uniformity is the whole point: assembly and Go are just two sources of `LSym`s.

You normally never see a raw `.o`; it lives in the build's temp dir (`-work`) and is immediately packed into the package archive.

## 5. Symbol ABIs: ABI0 vs ABIInternal

A function symbol carries an **ABI** marking its calling convention:

- **ABI0** — the older, **stack-based** convention. All arguments and results pass on the stack (the `FP` layout from the middle tier *is* ABI0's memory layout). Hand-written assembly historically targets ABI0 because stack passing is simple and stable.
- **ABIInternal** — the current **register-based** internal convention introduced in Go 1.17. Integer/pointer args go in registers (on amd64: AX, BX, CX, DI, SI, R8, R9, R10, R11; results similarly), spilling to the stack only when they run out. This is faster and is what the Go compiler uses for Go↔Go calls.

Both ABIs can exist for the *same function name* as two distinct symbols (e.g. `runtime.foo<ABI0>` and `runtime.foo<ABIInternal>`). `go tool nm` and the linker disambiguate them by ABI. You select the ABI in a `TEXT` line's flags field:

```
TEXT ·fast(SB), NOSPLIT|ABIInternal, $0-24   // args arrive in registers
TEXT ·slow(SB), NOSPLIT, $0-24               // ABI0: args on the stack via FP
```

If you omit the selector, an assembly `TEXT` defaults to **ABI0**.

## 6. ABI wrappers

Here's the friction: Go-compiled code calls functions via **ABIInternal**, but your hand-written assembly is **ABI0**. When a Go caller wants to call an ABI0 asm function (or an asm function wants to call an ABIInternal Go function), the linker must bridge the two conventions. It does so by generating an **ABI wrapper** (flagged `ABIWRAPPER`, value 4096 in `textflag.h`): a tiny shim that takes args in one convention and re-lays them out for the other before jumping through.

Consequences you should know:

- A name like `pkg.Add` may end up with **two symbols** — your ABI0 definition plus a generated ABIInternal wrapper — so don't be surprised when `nm` shows duplicates.
- Wrappers cost a few instructions per cross-ABI call. For hot code you can write the asm directly in `ABIInternal` to skip the wrapper (at the cost of dealing with register-passed args yourself — error-prone, see professional tier).
- An **ABI mismatch** (declaring `ABIInternal` but reading args from `FP` as if ABI0) produces garbage args or a link error. This is a classic senior-level bug.

The mechanism lives in the linker (`cmd/link/internal/loader` and `ld`), driven by the ABI recorded on each `LSym`.

## 7. Archives via `cmd/pack`

A compiled package is distributed as a `.a` **archive** — historically a Unix `ar`-style archive, now Go's own variant produced by [`cmd/pack`](https://pkg.go.dev/cmd/pack). For a package containing both Go and assembly, the build:

1. Runs `cmd/compile` → goobj for the Go files.
2. Runs `cmd/asm` once per `.s` file → one goobj each.
3. Runs `cmd/pack r _pkg_.a <objs...>` to bundle them into a single archive.

```bash
$ go tool pack t _pkg_.a        # list members
$ go tool pack x _pkg_.a        # extract members
```

The linker reads the archive, pulls out the goobj members, builds the global symbol table, resolves relocations, generates ABI wrappers, and writes the final executable. The compiler and assembler having converged on one format is what makes this pipeline uniform.

## 8. Summary

`cmd/compile` and `cmd/asm` are both front ends to the shared `cmd/internal/obj` backend; each produces `LSym`s (name, `Type` like `STEXT`/`SRODATA`, raw bytes `P`, relocations `R`, and `FuncInfo` with frame/args). Cross-symbol references become `obj.Reloc` records (`R_CALL`, `R_PCREL`, `R_ADDR`, ...) that the linker applies after layout. Everything is serialized to the **goobj** on-disk format (`cmd/internal/goobj/objfile.go`) — Go's own object format, identical whether emitted by the compiler or assembler. Function symbols carry an **ABI**: stack-based **ABI0** (the default for hand-written asm, the `FP` layout) versus register-based **ABIInternal** (the compiler's internal convention since Go 1.17); the linker inserts **ABI wrappers** to bridge them, which is why you sometimes see two symbols per function. Finally, `cmd/pack` bundles the per-file goobj objects into a `.a` archive the linker consumes.

## Further reading

- [Go source: `src/cmd/internal/obj/link.go`](https://github.com/golang/go/blob/master/src/cmd/internal/obj/link.go) — `LSym`, `Reloc`, `FuncInfo`.
- [Go source: `src/cmd/internal/goobj/objfile.go`](https://github.com/golang/go/blob/master/src/cmd/internal/goobj/objfile.go) — the object-file format spec (read the header comment).
- [Go design doc: Register-based Go calling convention (ABIInternal)](https://github.com/golang/go/blob/master/src/cmd/compile/abi-internal.md) — ABI0 vs ABIInternal in detail.
- [`cmd/internal/objabi/reloctype.go`](https://github.com/golang/go/blob/master/src/cmd/internal/objabi/reloctype.go) — relocation kinds.
- [`go tool pack` documentation](https://pkg.go.dev/cmd/pack).
