# Assembler & Object Files — Interview

Twenty questions covering Plan 9 assembly, pseudo-registers, the `TEXT` directive, ABIs, object files, relocations, `cmd/pack`, and `//go:noescape`. Answers are concise but complete enough to defend in a follow-up.

## Plan 9 assembly basics

**1. Why does Go have its own assembler instead of using `gas`?**
Go's toolchain (`cmd/asm`) inherits the Plan 9 toolchain conventions from its Bell Labs authors. The Plan 9-style assembly is *portable in form* across architectures — same directives, pseudo-registers, and operand syntax everywhere — and integrates with the Go-specific needs (stack-split preamble, GC stack maps, goobj output). It's a semi-abstract layer over the hardware, not a one-to-one mirror.

**2. Is Go assembly the same as AT&T x86 syntax?**
No. It's superficially AT&T-like (source, destination operand order; `$` immediates) but has Go-specific pseudo-registers (`SB`/`FP`/`SP`/`PC`), its own directive set (`TEXT`/`DATA`/`GLOBL`), and mnemonics that may not map 1:1 to machine instructions. It is nobody's native assembly.

**3. What does the `·` (middle dot) mean in a symbol like `·Add`?**
It's the package-path separator (Unicode U+00B7). `·Add` means `Add` in the current package; `runtime·memmove` names `memmove` in `runtime`. In resolved/`nm` output it becomes a plain `.` (e.g. `runtime.memmove`).

## Pseudo-registers

**4. Name the four pseudo-registers and what each refers to.**
`SB` (Static Base) — names globals and functions, e.g. `foo(SB)`. `FP` (Frame Pointer) — the incoming argument block, e.g. `a+0(FP)`. `SP` (pseudo Stack Pointer) — the local frame, e.g. `x-8(SP)`. `PC` (Program Counter) — the instruction pointer, mostly implicit.

**5. How do you access the second `int` argument of a function in assembly?**
`b+8(FP)`: arguments are laid out from `FP` using Go's struct layout; an `int` is 8 bytes on 64-bit, so the second one is at offset 8. The `b+` is a name vet checks; the offset is what matters.

**6. What's the difference between the pseudo-SP and the hardware SP?**
The *pseudo*-SP is referenced with a name and offset (`x-8(SP)`) and points into the current frame's locals; the assembler resolves it to the right real offset. The *hardware* SP is the bare `0(SP)` form used for outgoing call arguments. On some architectures they're different locations, so mixing them up is a real bug.

## TEXT directive & frame sizes

**7. Decode `TEXT ·Add(SB), NOSPLIT, $0-24`.**
Define symbol `Add` in the current package; flag `NOSPLIT` (no stack-split preamble); local frame size `$0`; arguments+results size `24` bytes (two `int` args + one `int` result).

**8. What are the two numbers in `$frame-args` and how do they differ?**
`frame` is the bytes of local stack frame (locals plus space for outgoing-call arguments). `args` is the bytes of incoming arguments + return values as the caller laid them out (ABI0 memory layout). They are independent; vet checks `args` against the Go prototype.

**9. What does `NOSPLIT` do and when is it dangerous?**
It omits the stack-growth check the toolchain normally inserts. Safe only for small leaf frames; a chain of NOSPLIT functions drawing too much stack causes a link-time `nosplit stack overflow`. It's a correctness statement, not an optimization knob.

**10. What's `NOFRAME`, and how does it relate to `NOSPLIT`?**
`NOFRAME` suppresses frame-pointer setup and is only valid when the frame size is `$0`. It's distinct from `NOSPLIT` (which suppresses the morestack preamble); they're often combined on tiny leaf/runtime functions.

## ABIs

**11. What's the difference between ABI0 and ABIInternal?**
ABI0 is the older stack-based calling convention — all args/results pass on the stack (the `FP` layout). ABIInternal (Go 1.17+) is register-based — integer/pointer args go in registers, spilling to the stack only when they run out. The Go compiler uses ABIInternal for Go↔Go calls; hand-written asm usually targets ABI0.

**12. A function can have two symbols with the same name — why?**
Because the same function may exist in both ABI0 and ABIInternal forms (`f<ABI0>` and `f<ABIInternal>`), plus the linker may generate an `ABIWRAPPER` shim to bridge a caller's convention to the callee's. So `nm` can show duplicates.

**13. What's an ABI wrapper and when is it generated?**
A linker-generated shim (flagged `ABIWRAPPER`) that re-lays-out arguments from one calling convention to the other — e.g. when ABIInternal Go code calls an ABI0 assembly function. It costs a few instructions per cross-ABI call.

**14. If you write `ABIInternal` in a `TEXT` line but read args via `FP`, what happens?**
You read stack garbage, because ABIInternal passes args in registers, not on the stack. Results are wrong or it crashes. For hand-written asm, default to ABI0 (where `FP` is correct) unless you've measured the wrapper cost matters.

## Object files & relocations

**15. What is an `LSym`?**
The `obj` package's representation of one symbol: name, `Type` (`STEXT`, `SRODATA`, `SDATA`, ...), attributes (`NOSPLIT`/`RODATA`/`NOPTR`/...), size, the raw bytes `P`, relocations `R`, `FuncInfo` (frame/args/pcln) for code, and an ABI. Both the compiler and assembler produce `LSym`s.

**16. What is a relocation and why is it needed?**
A record (`obj.Reloc`: offset, size, type, addend, target symbol) saying "patch the address of symbol *S* into my bytes at offset *O*." It's needed because a symbol's final address isn't known until link-time layout. The linker applies all relocations (`R_CALL`, `R_PCREL`, `R_ADDR`, ...) after placing symbols.

**17. Do the compiler and assembler produce different object formats?**
No — both emit the same **goobj** format (`cmd/internal/goobj/objfile.go`), Go's own indexed object-file format. The linker reads goobj uniformly regardless of which front end produced a symbol. That convergence is what makes mixing Go and asm seamless.

**18. What is `cmd/pack` and what's a `.a` file?**
`cmd/pack` (`go tool pack`) bundles the per-file goobj objects of a package into a single `.a` **archive** (Go's `ar`-style format). The linker reads the archive, extracts members, and links them. Use `go tool pack t/x` to list/extract members.

## Pragmas & tooling

**19. What does `//go:noescape` do and what's the catch?**
On a body-less (asm-provided) Go declaration it tells the compiler that no pointer argument escapes the call, so callers can keep arguments on the stack instead of heap-allocating. The catch: it's a *promise*. If the assembly actually retains a pointer past the call, you get memory corruption. Use it only when truthful.

**20. How does `go vet` help with assembly, and why is it essential?**
Its `asmdecl` pass cross-checks each `.s` `TEXT` against its Go prototype: argsize, every `name+offset(FP)` offset/width, and multi-word field suffixes (`_base`/`_len`/...). Since asm bugs are silent (the build succeeds, the stack corrupts at runtime), `asmdecl` is the primary automatic guard against frame/offset/width mistakes — run it in CI on every target arch, backed by differential tests against a Go fallback.

## Further reading

- [A Quick Guide to Go's Assembler](https://go.dev/doc/asm).
- [`cmd/compile/abi-internal.md`](https://github.com/golang/go/blob/master/src/cmd/compile/abi-internal.md) — ABI0 vs ABIInternal.
- [`cmd/internal/obj/link.go`](https://github.com/golang/go/blob/master/src/cmd/internal/obj/link.go) and [`goobj/objfile.go`](https://github.com/golang/go/blob/master/src/cmd/internal/goobj/objfile.go).
- [`runtime/textflag.h`](https://github.com/golang/go/blob/master/src/runtime/textflag.h) — flag values.
