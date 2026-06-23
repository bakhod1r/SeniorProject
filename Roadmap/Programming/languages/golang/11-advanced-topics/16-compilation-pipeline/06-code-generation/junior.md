# Code Generation — Junior

## 1. What code generation produces

Code generation is the **last stage** of the Go compiler. By the time we reach it, your source has already become an AST, then typed IR, then **SSA** (static single assignment form). The middle-end and SSA backend have optimized and *lowered* that SSA into architecture-specific operations. Code generation's job is to turn those operations into **real machine instructions** for a particular CPU, lay out a stack frame, allocate hardware registers, and emit the bytes the linker will assemble into the final binary.

The pipeline as a whole:

```
source → tokens → AST → typed IR → SSA (generic) → SSA (lowered, arch-specific)
       → code generation (regalloc + instruction emission) → obj.Prog list → object file → linker → binary
```

So this stage answers a concrete question: *which exact instructions does `a + b` become on an x86-64 chip?* On amd64 it becomes a single `ADDQ`. On arm64 it becomes a single `ADD`. The compiler picks the instruction, picks the registers, and writes it down.

The relevant Go source lives in `cmd/compile/internal/ssa` (register allocation), the per-arch packages `cmd/compile/internal/amd64`, `cmd/compile/internal/arm64`, etc. (instruction emission), and `cmd/internal/obj` (the architecture-neutral instruction list).

---

## 2. Dumping assembly with `go build -gcflags=-S`

You do not need to read the compiler's source to see what it produces. The `-S` flag tells the compiler to print the assembly it generated. You pass it *through* `go build` with `-gcflags`:

```bash
go build -gcflags=-S ./...
```

Note: it is `-gcflags=-S`, **not** `go build -S`. The `-S` is a flag for the compiler `gc`, and `-gcflags` forwards it. Output goes to **stderr**, so redirect it if you want to read it in a pager:

```bash
go build -gcflags=-S . 2>&1 | less
```

Take this tiny program:

```go
package main

//go:noinline
func Add(a, b int) int { return a + b }

func main() { println(Add(1, 2)) }
```

The `//go:noinline` pragma stops the compiler from inlining `Add` into `main`, so we actually get a function to look at. Build it for amd64:

```bash
GOOS=linux GOARCH=amd64 go build -gcflags=-S .
```

You will see, among the noise, something like:

```
main.Add STEXT nosplit size=4 args=0x10 locals=0x0 funcid=0x0 align=0x0
	0x0000 00000 (main.go:4)	TEXT	main.Add(SB), NOSPLIT|NOFRAME|ABIInternal, $0-16
	0x0000 00000 (main.go:4)	PCDATA	$3, $1
	0x0000 00000 (main.go:4)	ADDQ	BX, AX
	0x0003 00003 (main.go:4)	RET
	0x0000 48 01 d8 c3                                      H...
```

That is the whole function. Four bytes of code: `48 01 d8 c3`.

---

## 3. Reading a trivial amd64 function line by line

Let's decode the `Add` listing above one line at a time.

```
main.Add STEXT nosplit size=4 args=0x10 locals=0x0
```

This is the **symbol header**. `STEXT` means a text (code) symbol. `nosplit` means the function has no stack-growth check (it is tiny and provably safe). `size=4` is four bytes of code. `args=0x10` (16 bytes) is the space the caller reserves for arguments + results; `locals=0x0` means no stack frame for locals.

```
TEXT	main.Add(SB), NOSPLIT|NOFRAME|ABIInternal, $0-16
```

`TEXT` declares the function. `(SB)` means the address is relative to the **static base** pseudo-register. `NOFRAME` means no stack frame is set up. `ABIInternal` is the modern register-based calling convention (more in middle/senior). `$0-16` reads as *frame size 0, argument+result area 16 bytes*.

```
PCDATA	$3, $1
```

`PCDATA` is metadata the runtime uses (here, inline-tree info). It emits no machine code; it is a table keyed by program counter. Ignore it for now.

```
ADDQ	BX, AX
```

The real work. In Go assembly syntax the **destination is on the right**, so this is `AX = AX + BX`. The two `int` arguments arrived in registers `AX` (`a`) and `BX` (`b`); the result is left in `AX`. `Q` means 64-bit (quadword).

```
RET
```

Return. The result is already in `AX`, which is where the caller expects an `int` result.

```
0x0000 48 01 d8 c3
```

The raw machine-code bytes. `48 01 d8` is `ADDQ BX,AX`; `c3` is `RET`. This is literally what runs on the CPU.

You can get a cleaner disassembly of the *linked binary* (no PCDATA noise, real addresses) with `go tool objdump`:

```bash
GOOS=linux GOARCH=amd64 go build -o prog .
go tool objdump -s 'main\.Add' prog
```

```
TEXT main.Add(SB) main.go
  main.go:4	0x46fb80	4801d8	ADDQ BX, AX
  main.go:4	0x46fb83	c3	    RET
```

Same two instructions, now with absolute addresses (`0x46fb80`).

---

## 4. The three tools you'll use

| Command | What it shows | When to use |
| --- | --- | --- |
| `go build -gcflags=-S .` | Compiler's assembly *before* linking, with PCDATA/FUNCDATA and reloc notes | See exactly what the compiler emitted, per function |
| `go tool compile -S file.go` | Same listing for a single self-contained file (no imports) | Quick one-file experiments |
| `go tool objdump -s 'regexp' binary` | Disassembly of a *linked* binary | Real addresses, see what survived linking, inspect any binary |

`go tool compile -S` works only when the file has no external imports it cannot resolve standalone; for anything importing the standard library, prefer `go build -gcflags=-S`.

---

## 5. Common misconceptions

- **"`-S` shows machine code."** It shows Go's *assembly listing* (Plan 9 syntax), with the raw bytes appended per function. It is one level above pure hex but tied directly to it.
- **"Go assembly is just x86 assembly."** No. Go uses its own **Plan 9 assembler syntax**: destination on the right, pseudo-registers like `FP`/`SB`/`SP`, and its own mnemonics (`MOVQ`, not `mov`). It is portable across architectures by design.
- **"Arguments are always on the stack."** Not since Go 1.17. The register-based ABI passes the first several integer/pointer arguments in registers (`AX, BX, CX, ...` on amd64). You saw `a` in `AX` and `b` in `BX`.
- **"`go build -S` is the flag."** It is `go build -gcflags=-S`. Plain `-S` is not a `go build` flag.
- **"Inlining makes my function disappear, so codegen is broken."** Inlining is normal and good. Use `//go:noinline` when you specifically want to inspect a function in isolation.
- **"The output goes to stdout."** `-S` writes to **stderr**. Redirect with `2>&1` to pipe it.

---

## 6. Things to do today

1. Write the three-line `Add` program above and run `go build -gcflags=-S .`. Find the `ADDQ` line.
2. Remove `//go:noinline` and rebuild. Notice `main.Add` vanishes — it got inlined.
3. Build a binary and run `go tool objdump -s 'main\.Add' prog`. Compare with the `-S` output.
4. Change `int` to `float64` in `Add` and re-dump. The instruction becomes `ADDSD` and the registers become `X0`/`X1` (the XMM float registers).
5. Build the same program with `GOARCH=arm64` and find the `ADD R1, R0, R0` line. Same logic, different CPU.

---

## 7. Summary

- Code generation is the compiler's **final stage**: lowered SSA → real machine instructions → object code.
- Dump it with **`go build -gcflags=-S .`** (writes to stderr) or disassemble a binary with **`go tool objdump`**.
- Go uses **Plan 9 assembly syntax**: destination on the right, `MOVQ`/`ADDQ` mnemonics, pseudo-registers `SB`/`FP`/`SP`.
- Since Go 1.17 the **register-based ABI** passes the first arguments in registers (`AX, BX, ...` on amd64), not on the stack.
- `TEXT`, `STEXT`, `PCDATA`, and `FUNCDATA` are structural; the instructions in between are the actual code.

---

## Further reading

- [A Quick Guide to Go's Assembler](https://go.dev/doc/asm) — Plan 9 assembly syntax and pseudo-registers
- Go source: [`cmd/compile/internal/amd64`](https://github.com/golang/go/tree/master/src/cmd/compile/internal/amd64)
- Go source: [`cmd/internal/obj`](https://github.com/golang/go/tree/master/src/cmd/internal/obj)
- [`cmd/compile` README](https://github.com/golang/go/blob/master/src/cmd/compile/README.md) — compiler phase overview
- `go doc cmd/compile` and `go tool compile -help` for the full flag list
