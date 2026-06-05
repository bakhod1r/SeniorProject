# Assembler & Object Files — Junior

You have probably never written a line of assembly in your life, and you may go your whole Go career without doing so. That is fine. But understanding *that* Go has an assembler, *why* it looks so strange, and *what* it produces is part of knowing how `go build` actually turns your code into a runnable program. This tier gives you the mental model and one tiny working example.

## 1. Why does Go ship its own assembler?

When you run `go build`, the compiler (`cmd/compile`) translates your `.go` files into machine instructions. But a handful of things cannot be expressed in Go: the lowest-level pieces of the runtime (the scheduler's context switch, signal handling, the entry point of the program), and a few hot routines (crypto, `math`, parts of `runtime`) where hand-tuned assembly beats the compiler. Those are written in assembly.

Go does **not** use the GNU assembler (`gas`) or the syntax you would see in a typical x86 tutorial. It uses its own assembler, `cmd/asm`, which accepts a **Plan 9-style assembly language**. Plan 9 was the operating system the original Go authors (Ken Thompson, Rob Pike, Russ Cox) worked on at Bell Labs, and they brought its toolchain conventions with them.

The key consequences:

- The assembly is **portable in form across architectures** — the same directives (`TEXT`, `DATA`, `GLOBL`), the same pseudo-registers, the same operand syntax appear whether you target `amd64`, `arm64`, or `riscv64`. Only the actual instruction mnemonics and real registers change.
- The assembler is **not a faithful mirror of the hardware**. It is a semi-abstract layer. `cmd/asm` plus `cmd/internal/obj` decide the final encoding, insert the stack-growth preamble, and so on.
- It is **nobody's native assembly**. If you know Intel or AT&T x86 syntax, Go assembly will still surprise you. Operands often read in a different order, constants need a `$`, memory dereferences use `(R)`, and there are these strange "pseudo-registers."

The canonical reference is the Go team's own document: [A Quick Guide to Go's Assembler](https://go.dev/doc/asm).

## 2. The four pseudo-registers: SB, FP, SP, PC

A *pseudo-register* is a register that the assembler understands but that may not correspond to a real hardware register. They are how Go assembly stays portable. There are four:

| Pseudo-reg | Name | What it refers to |
|-----------|------|-------------------|
| `SB` | Static Base | The base of the address space. Used to name **globals and functions**. `foo(SB)` means "the symbol foo." |
| `FP` | Frame Pointer | A virtual pointer to the **function's incoming arguments**. `arg+0(FP)` is the first argument. |
| `SP` | Stack Pointer | The **local stack frame**. `x-8(SP)` is a local variable. (Beware: this is the *pseudo*-SP, distinct from the hardware SP on some arches.) |
| `PC` | Program Counter | The instruction pointer; mostly used implicitly by branches and labels. |

The most important one to learn first is `SB`. Every function and every global has a name, and you refer to it as `name(SB)`. When you write:

```
TEXT ·Add(SB), NOSPLIT, $0-24
```

the `·Add(SB)` part means "the symbol named `Add` in the current package." The `·` is a literal middle-dot character (Unicode U+00B7), Go's way of writing the package-qualified separator. We will explain the rest of that line in the middle tier.

## 3. A tiny `Add(a, b int) int` in assembly

Let's write the simplest possible thing: a function that adds two `int`s. You need **two files** in the same package: a Go file with the function *declaration* (no body), and a `.s` file with the implementation.

`add.go` — the Go stub:

```go
package addasm

// Add returns a + b. Implemented in add_amd64.s.
func Add(a, b int) int
```

Notice there is no `{ ... }` body. The Go compiler accepts a body-less function declaration *as long as* an assembly definition with the matching symbol exists at link time.

`add_amd64.s` — the implementation (amd64 only):

```
#include "textflag.h"

// func Add(a, b int) int
TEXT ·Add(SB), NOSPLIT, $0-24
    MOVQ a+0(FP), AX   // load first argument into AX
    MOVQ b+8(FP), BX   // load second argument into BX
    ADDQ BX, AX        // AX = AX + BX
    MOVQ AX, ret+16(FP) // store result into the return slot
    RET
```

Reading it line by line:

- `#include "textflag.h"` pulls in flag names like `NOSPLIT`.
- `TEXT ·Add(SB), NOSPLIT, $0-24` declares the function `Add`. `$0` is the local frame size (we use no locals). `24` is the size of arguments + results: two 8-byte `int` args plus one 8-byte return = 24 bytes.
- `MOVQ a+0(FP), AX` — `MOVQ` moves a 64-bit ("quad") value. `a+0(FP)` is the argument named `a` at offset 0 in the argument frame. The destination, `AX`, is a real amd64 register. **In Go asm the source is on the left, destination on the right.**
- `b+8(FP)` is the second argument; an `int` is 8 bytes so it sits at offset 8.
- `ADDQ BX, AX` computes `AX = AX + BX`.
- `ret+16(FP)` is the return slot, right after the two arguments (offset 16). The name `ret` is conventional for an unnamed return value.
- `RET` returns.

## 4. Build and run it

Put both files in a package and write a tiny test or `main`:

```go
package main

import "fmt"

func Add(a, b int) int // matches add_amd64.s if you put it in package main

func main() {
    fmt.Println(Add(2, 40)) // 42
}
```

```bash
$ go build ./...
$ go run .
42
```

`go build` automatically feeds `.s` files in a package to `go tool asm` and links the resulting object code. You do not invoke the assembler by hand for a normal build. If you want to *see* the assembler being called, add `-x`:

```bash
$ go build -x . 2>&1 | grep asm
```

You will see a line invoking `.../compile`/`asm` on your `.s` file.

## 5. Common misconceptions

- **"Go assembly is just AT&T x86 syntax."** No. The operand order is similar to AT&T (source, destination) but the registers, the `(FP)`/`(SB)` pseudo-registers, the `$` for immediates, and the directive set are Go-specific.
- **"The mnemonics map 1:1 to CPU instructions."** Mostly, but not always. `cmd/asm` can synthesize sequences, and the same mnemonic may assemble differently depending on operands. Treat it as a portable-ish layer, not raw machine code.
- **"I can omit the Go stub."** No. Without the body-less Go declaration the compiler will not know the function exists, and you cannot call it from Go.
- **"FP is the same as the hardware frame pointer."** No — `FP` is a *virtual* register the assembler resolves to the right real offset. Same for the pseudo-`SP`.
- **"NOSPLIT is optional decoration."** It changes whether the runtime inserts a stack-growth check. Use it only when you know your frame is tiny; we cover this in the middle tier.

## 6. Things to do today

1. Run `go version` and `go env GOROOT`, then `ls $(go env GOROOT)/src/runtime/*.s` to see real production assembly.
2. Open `runtime/asm_amd64.s` and just *look* at the `TEXT` lines — you will recognize the shape now.
3. Write the `Add` example above for your machine's architecture (use `_arm64.s` and `arm64` registers if you are on Apple Silicon — see the spec tier).
4. Run `go build -x` on a package containing a `.s` file and find the `asm` invocation.
5. Run `go tool nm` on a compiled binary and find the `T` (text) symbols.

## 7. Summary

Go has its own assembler, `cmd/asm`, using a **Plan 9-style** language that is portable in form across architectures and is *nobody's* native syntax. The four pseudo-registers — `SB` (globals/functions), `FP` (incoming arguments), `SP` (local frame), `PC` (program counter) — are the heart of how that portability works. To write assembly you pair a **body-less Go declaration** with a `.s` file whose `TEXT ·Name(SB), FLAGS, $frame-args` line defines the symbol, read arguments via `name+offset(FP)`, and finish with `RET`. `go build` wires the `.s` file in automatically. You almost never need to write assembly, but you should now be able to read it and know where it comes from.

## Further reading

- [A Quick Guide to Go's Assembler](https://go.dev/doc/asm) — the authoritative reference.
- [Go source: `src/cmd/asm`](https://github.com/golang/go/tree/master/src/cmd/asm) — the assembler itself.
- [Go source: `src/runtime/asm_amd64.s`](https://github.com/golang/go/blob/master/src/runtime/asm_amd64.s) — real, production assembly.
- [Rob Pike, "The Design of the Go Assembler" (GopherCon 2016)](https://www.youtube.com/watch?v=KINIAgRpkDA) — talk by one of the authors.
