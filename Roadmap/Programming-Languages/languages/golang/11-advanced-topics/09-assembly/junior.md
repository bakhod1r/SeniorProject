# Go Assembly — Junior

## 1. What is Go assembly?

Assembly is the lowest level of programming — instructions executed almost directly by the CPU. Most Go code is high-level; you never write assembly. But sometimes you'll see `.s` files in a Go project:

```
fast.go
fast_amd64.s
fast_arm64.s
```

These contain hand-tuned assembly for specific architectures. They exist when:

- The standard Go compiler's output isn't fast enough.
- A SIMD instruction set (AVX, NEON) needs to be used.
- Cryptographic primitives need constant-time, side-channel-resistant code.

For most application development, you'll never touch these files. But you should know they exist and be able to read them when debugging.

---

## 2. What Plan 9 syntax looks like

Go uses a unique assembly syntax inherited from Plan 9, the operating system Ken Thompson and friends worked on after Unix.

```
TEXT ·Add(SB), NOSPLIT, $0-24
    MOVQ a+0(FP), AX
    MOVQ b+8(FP), BX
    ADDQ BX, AX
    MOVQ AX, ret+16(FP)
    RET
```

Reading top-to-bottom:

- `TEXT ·Add(SB)`: declares a function called `Add`.
- `NOSPLIT, $0-24`: no stack-growth check; no local stack; 24 bytes of args+return.
- `MOVQ ... AX`: load the first argument into register AX.
- `ADDQ BX, AX`: add BX to AX.
- `MOVQ AX, ret+16(FP)`: store AX into the return slot.
- `RET`: return.

You don't have to understand every detail, but recognizing the shape helps when reading library code.

---

## 3. Why Go's assembly looks different

Go's syntax is NOT the same as:

- GCC's GNU assembly (AT&T or Intel).
- Apple's clang assembly.
- Windows MASM.

Specifically:

- `MOVQ`, `ADDQ`, etc., are Plan 9 mnemonics.
- Operand order is *source, destination* (like AT&T).
- Register names lack the `%` prefix.
- The `(SB)` / `(FP)` / `(SP)` pseudo-registers are Plan 9 inventions.

Searching for "x86 ADD instruction" gives you the right operation, but Go's syntax for it is different. The mapping is documented in `cmd/asm`.

---

## 4. When you'd write Go assembly

Realistically, almost never. Cases where you might:

- You're optimizing a cryptographic primitive and need constant-time guarantees.
- You're writing a SIMD-accelerated routine (image processing, vector ops).
- You're implementing low-level runtime features.
- You're building an `avo`-generated package.

In most Go codebases, the answer to "should I write assembly?" is "no, profile first and trust the compiler".

---

## 5. Reading assembly the compiler produces

```bash
go build -gcflags='-S' ./pkg
```

The compiler dumps assembly for every function. You can see exactly what instructions the compiler generated. Useful for performance investigation.

```bash
go tool objdump -s 'main\.foo' ./binary
```

Disassembles a specific function from a compiled binary.

---

## 6. A complete tiny example

```go
// pkg/fast/fast.go
package fast

func Add(a, b int64) int64
```

```
// pkg/fast/fast_amd64.s
#include "textflag.h"

// func Add(a, b int64) int64
TEXT ·Add(SB), NOSPLIT, $0-24
    MOVQ a+0(FP), AX
    MOVQ b+8(FP), BX
    ADDQ BX, AX
    MOVQ AX, ret+16(FP)
    RET
```

Build with `go build ./pkg/fast`. Use from Go code: `fast.Add(2, 3)`. Returns 5.

To support other architectures, add similar `.s` files with different `//go:build` tags.

---

## 7. Why is this so painful?

Plan 9 syntax is not standard. Most documentation, tutorials, and Stack Overflow answers use AT&T or Intel syntax. You have to translate mentally.

Tools to help:

- `avo` (https://github.com/mmcloughlin/avo) generates Plan 9 assembly from Go code.
- `lensm` (https://github.com/loov/lensm) shows Go-to-assembly mapping interactively.
- Many libraries (`klauspost/compress`, `crypto/sha256`) are good study material.

---

## 8. Risks of writing assembly

- **Architecture-specific.** Each platform needs its own implementation.
- **Hard to maintain.** Future you may not remember why each instruction.
- **Easy to miss optimizations.** Modern compilers can be remarkably clever.
- **No race detector.** Your `.s` code isn't instrumented.
- **Bugs are nasty.** A wrong offset corrupts memory.

For 99% of code, the compiler is fine. Reach for assembly when profiling shows a specific kernel dominating runtime.

---

## 9. The maintenance burden

Assembly files lock you to:

- Specific CPU instruction sets (AVX2 vs AVX-512).
- Specific calling conventions (changes between Go versions are rare but possible).
- Architecture proliferation (amd64 + arm64 + arm + riscv64 + ...).

Most projects that have `.s` files also have a pure-Go fallback (`//go:build !amd64`) for portability. The assembly is an *optimization*, not a requirement.

---

## 10. Summary

Go assembly uses Plan 9 syntax — different from what most resources teach. You'll rarely write it; you'll occasionally read it when profiling shows a specific kernel matters. Tools like `avo` and `go build -gcflags=-S` make exploration easier. For most Go programmers, "I know assembly exists and can read a simple function" is enough.

---

## Further reading
- "A Quick Guide to Go's Assembler": https://go.dev/doc/asm
- `avo`: https://github.com/mmcloughlin/avo
- `klauspost/compress` source: a model assembly-using library
