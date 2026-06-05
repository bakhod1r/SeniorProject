# Assembler & Object Files — Middle

At the junior tier you wrote `Add` in assembly and built it. Now we make the mechanics precise: how the `TEXT` directive encodes frame and argument sizes, how `FP` offsets are computed for real argument types, what `NOSPLIT` actually does, how Go and assembly call each other, how to define package-level data with `DATA`/`GLOBL`, and how to inspect what the assembler produced with `go tool nm` and the `-x -work` temp directory.

## 1. The TEXT directive in full

Every function defined in assembly begins with a `TEXT` line:

```
TEXT ·funcname(SB), FLAGS, $framesize-argsize
```

Four parts:

1. **`·funcname(SB)`** — the symbol. `·` (middle dot, U+00B7) stands for the package-path separator; the assembler expands `·funcname` to `yourpkg.funcname`. `(SB)` marks it as a named symbol relative to the static base. A fully qualified name like `runtime·memmove(SB)` is also legal.
2. **`FLAGS`** — a bitmask of textflags (`NOSPLIT`, `NOFRAME`, `WRAPPER`, etc.) OR-ed together, or `0`. Defined in `runtime/textflag.h` and kept in sync with `cmd/internal/obj/textflag.go`. You may also write the ABI selector here in newer code (`NOSPLIT|ABIInternal`); see the senior tier.
3. **`$framesize`** — the number of bytes of **local stack frame** this function needs (locals + space for outgoing call arguments). `$0` means no locals and no calls.
4. **`-argsize`** — after the dash, the size in bytes of the **arguments + return values** as the caller laid them out. This is how the assembler and the garbage collector know how big the argument area is.

So `$0-24` means: zero local frame, 24 bytes of args+results. The two numbers are independent; `$24-16` is perfectly valid (24 bytes of locals/outgoing-call space, 16 bytes of incoming args).

> The `-argsize` is mandatory for functions with a Go prototype, and `go vet`'s `asmdecl` check (covered in the professional tier) verifies it against the Go signature. Getting it wrong corrupts the stack or confuses the GC.

## 2. Computing FP offsets for real argument types

`FP` is the **pseudo frame pointer** pointing at the start of the incoming argument block. You access arguments as `name+offset(FP)`. The `name+` is documentation that `go vet` checks; the `offset` is what matters to the assembler.

Offsets follow the Go calling convention's *memory layout* (note: with the register-based ABIInternal, args may actually arrive in registers, but the `FP` view still describes the logical stack layout that vet validates and that ABI0 functions use). Sizes on a 64-bit platform:

| Go type | Size (bytes) | Notes |
|---------|-------------|-------|
| `bool`, `int8`, `uint8` | 1 | aligned to 1 |
| `int16` | 2 | |
| `int32`, `float32`, `rune` | 4 | |
| `int`, `int64`, `uint`, `uintptr`, pointer, `float64` | 8 | aligned to 8 |
| `string` | 16 | ptr (8) + len (8) |
| `[]T` slice | 24 | ptr + len + cap |
| `interface{}` | 16 | type word + data word |

Fields are laid out in declaration order with each field aligned, and the whole block is padded so the result area is aligned. Example:

```go
func Frob(a int32, b int64, s string) (n int, ok bool)
```

| Slot | Offset(FP) | Size |
|------|-----------|------|
| `a` (int32) | 0 | 4 |
| (padding) | 4 | 4 |
| `b` (int64) | 8 | 8 |
| `s.ptr` | 16 | 8 |
| `s.len` | 24 | 8 |
| `n` (int) | 32 | 8 |
| `ok` (bool) | 40 | 1 |

`argsize` is then 48 (40 + 1 rounded up to 8-byte alignment of the frame). In assembly you would write `s_base+16(FP)`, `s_len+24(FP)`, `n+32(FP)`, `ok+40(FP)`. **Always let `go vet` confirm these — manual arithmetic is the #1 source of bugs.**

## 3. NOSPLIT and the stack-growth preamble

By default the assembler/linker prepend a **stack-growth check** (the "split-stack" or "morestack" preamble) to every function: a few instructions that compare the stack pointer against the goroutine's stack guard and call `runtime.morestack` to grow the stack if needed. Go's goroutine stacks start small (a few KB) and grow on demand; this preamble is what makes that work.

`NOSPLIT` tells the toolchain **"do not insert that check."** You use it when:

- The function's frame is tiny and it makes no further calls (a leaf), so it cannot overflow the small guaranteed headroom.
- The function runs in a context where growing the stack is illegal (e.g. inside the runtime, during a stack copy, in signal handlers).

The catch: NOSPLIT functions consume from a **limited reserved budget** (the "nosplit limit," 128 bytes of red zone plus a small system reserve). If a chain of NOSPLIT functions needs too much stack, the linker fails with:

```
nosplit stack overflow
```

Rule of thumb for hand-written asm: use `NOSPLIT` for small leaf helpers with frame `$0` or a few bytes. If your asm function *calls* into Go or the runtime and needs real stack, leave NOSPLIT off (frame `> 0`, no flag) so the preamble is inserted.

`NOFRAME` is related but different: it suppresses *frame pointer setup* and is only valid when `$framesize` is 0. Don't confuse the two.

## 4. Calling between Go and assembly

**Go calling asm** is what we did with `Add`: a body-less Go declaration plus a matching `TEXT`. The compiler emits a normal call; the linker resolves the symbol to your assembly.

**Asm calling Go** is also possible. You issue a `CALL` to the Go function's symbol:

```
CALL runtime·printint(SB)
```

But there are rules:

- The caller must have a real frame (`$framesize > 0`) with enough room for the callee's arguments, written through `SP` (the pseudo stack pointer): `MOVQ $42, 0(SP)` puts the first outgoing argument in place before the `CALL`.
- The function generally must **not** be `NOSPLIT` if the callee might grow the stack.
- You must respect the ABI of the target. ABI-mismatched calls fail at link time or crash; the senior tier covers ABI0 vs ABIInternal and the wrappers the toolchain inserts.

In practice, hand-written asm that calls back into Go is rare outside the runtime. Most production asm (crypto, SIMD) is leaf code: read args via `FP`, compute, write results, `RET`.

## 5. DATA and GLOBL: package-level data in assembly

Sometimes assembly needs constants — lookup tables, masks, magic numbers. You define them with `GLOBL` (declare the symbol and its size) and `DATA` (fill in bytes):

```
// var mask [16]byte = {0xff, 0xff, ...}
GLOBL ·mask(SB), RODATA|NOPTR, $16
DATA  ·mask+0(SB)/8, $0xffffffffffffffff
DATA  ·mask+8(SB)/8, $0xffffffffffffffff
```

- `GLOBL ·mask(SB), RODATA|NOPTR, $16` declares a global symbol `mask`, 16 bytes, flagged read-only (`RODATA`) and pointer-free (`NOPTR`).
- Each `DATA sym+offset(SB)/width, $value` initializes `width` bytes at `offset`. The widths must tile the whole object exactly.

Flags you'll meet on data:

| Flag | Meaning |
|------|---------|
| `RODATA` | Place in the read-only section; attempts to write fault. |
| `NOPTR` | Contains no pointers — the GC will skip scanning it. **Required** if your data has no pointers and is in a writable section, otherwise the GC may misinterpret bytes as pointers. |
| `DUPOK` | It's fine if the linker sees multiple definitions; it keeps one. |

To expose the symbol to Go, declare a matching variable with no initializer in a Go file (and often a `//go:linkname` or simply a `var mask [16]byte` if names match the package convention). For pure-asm internal tables this is usually consumed only by other asm in the package.

## 6. Inspecting symbols with `go tool nm`

After building, `go tool nm` lists the symbols in an object file, archive, or binary:

```bash
$ go build -o app .
$ go tool nm app | grep -i '\.Add$'
  10a4f20 T mymod/addasm.Add
```

The middle column is the symbol *type*:

| Code | Meaning |
|------|---------|
| `T` / `t` | Text (code) symbol, global / local |
| `D` / `d` | Data section |
| `R` / `r` | Read-only data (`RODATA`) |
| `B` / `b` | BSS (zero-initialized data) |
| `U` | Undefined (referenced, defined elsewhere) |

You can also run `nm` directly on a compiled object or archive:

```bash
$ go tool nm $(go env GOROOT)/pkg/.../runtime.a 2>/dev/null | head
```

Notice symbol names: package path with `/`, a `.` separator, the function name — e.g. `runtime.memmove`. The middle-dot `·` you wrote in `.s` becomes a plain `.` in the resolved name.

## 7. Seeing the temp `.o` and `.a` with `-x -work`

`go build` does its work in a temporary directory and normally deletes it. Two flags reveal it:

- `-x` prints every command the build runs.
- `-work` prints the temp `WORK=` directory and **does not delete it**.

```bash
$ go build -x -work . 2>&1 | head
WORK=/var/folders/.../go-buildNNN
mkdir -p $WORK/b001/
...
.../compile -o $WORK/b001/_pkg_.a ...
.../asm -o $WORK/b001/asm.o ... add_amd64.s
.../pack r $WORK/b001/_pkg_.a $WORK/b001/asm.o
...
```

Then explore it:

```bash
$ cd /var/folders/.../go-buildNNN/b001
$ ls
$ go tool nm _pkg_.a | head      # symbols inside the package archive
$ go tool pack t _pkg_.a         # list files inside the .a archive
```

You will see your assembled object joined into the package archive (`_pkg_.a`, the goobj format inside a Go archive) by `cmd/pack`. The senior tier explains that format and how the linker reads it.

## 8. Summary

The `TEXT ·name(SB), FLAGS, $frame-args` line encodes the symbol, its flags, the local frame size, and the args+results size — and `go vet` checks that last number against the Go prototype. Arguments are read via `name+offset(FP)` using Go's struct-layout offsets and type sizes; results live just past the args. `NOSPLIT` suppresses the stack-growth preamble and is only safe for small leaf code, on pain of `nosplit stack overflow`. Go↔asm calls are possible but require correct frames and ABI; most real asm is leaf code. `DATA`/`GLOBL` define package data with `RODATA`/`NOPTR`/`DUPOK` flags. Finally, `go tool nm` shows you the resulting symbols and their section codes, while `go build -x -work` lets you walk into the temp directory and see the real `.o`/`.a` files the assembler and `cmd/pack` produced.

## Further reading

- [A Quick Guide to Go's Assembler](https://go.dev/doc/asm) — frame/arg sizes, FP, directives.
- [Go source: `src/cmd/internal/obj/textflag.go`](https://github.com/golang/go/blob/master/src/cmd/internal/obj/textflag.go) and [`runtime/textflag.h`](https://github.com/golang/go/blob/master/src/runtime/textflag.h) — the canonical flag definitions.
- [`go tool nm` documentation](https://pkg.go.dev/cmd/nm) and [`go tool pack`](https://pkg.go.dev/cmd/pack).
- [`cmd/go` build flags](https://pkg.go.dev/cmd/go#hdr-Compile_packages_and_dependencies) — `-x`, `-work`.
