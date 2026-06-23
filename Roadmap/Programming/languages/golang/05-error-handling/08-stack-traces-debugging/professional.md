# Stack Traces & Debugging — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [How the Runtime Walks a Stack](#how-the-runtime-walks-a-stack)
3. [PCs, FuncTab, and PCDATA](#pcs-functab-and-pcdata)
4. [The Cost of `runtime.Callers`](#the-cost-of-runtimecallers)
5. [Symbolization: `CallersFrames` Internals](#symbolization-callersframes-internals)
6. [Inlining and Frame Reconstruction](#inlining-and-frame-reconstruction)
7. [Escape Analysis Effects on Stack Capture](#escape-analysis-effects-on-stack-capture)
8. [Why Stack Traces Are Sometimes "Empty"](#why-stack-traces-are-sometimes-empty)
9. [The Cost of `debug.Stack`](#the-cost-of-debugstack)
10. [Goroutine Dump Internals](#goroutine-dump-internals)
11. [Signal Handling and Crash Paths](#signal-handling-and-crash-paths)
12. [Trimpath, Symbol Stripping, DWARF](#trimpath-symbol-stripping-dwarf)
13. [Allocation Profiles of Stack Capture](#allocation-profiles-of-stack-capture)
14. [Disassembly: What `runtime.Callers` Compiles To](#disassembly-what-runtimecallers-compiles-to)
15. [Summary](#summary)
16. [Further Reading](#further-reading)

---

## Introduction
> Focus: "What happens under the hood?"

At professional level, you stop talking about a stack trace as text and start talking about it as a runtime artifact: a sequence of program counters extracted from frame pointers and PC tables, resolved through compiler-emitted metadata, possibly de-inlined into multiple virtual frames, and printed via the runtime's own formatter. You can predict the cost of a capture to within a microsecond and tell which lines will be missing because the inliner ate them.

This file is Go stack-tracing at the level of bits, bytes, and CPU cycles.

---

## How the Runtime Walks a Stack

Go does **frame-pointer-based unwinding** on amd64/arm64 since 1.21. Earlier Go versions used PC tables exclusively. The current model is a hybrid.

A goroutine's stack looks like this in memory (grows downward on most architectures):

```
high address
+---------------------+
| caller frame        |
| ...                 |
| return PC -> caller |
| saved BP   -> caller |
+---------------------+ <- BP
| local variables     |
| spilled args        |
+---------------------+ <- SP
low address
```

To walk: start at the current SP/BP, follow the chain of saved BPs, and read the saved return PC at each frame. That gives you the PC slice — exactly what `runtime.Callers` returns.

Without frame pointers (older Go, or stripped builds), the runtime falls back to **PC tables** stored in the binary: at each PC, the metadata says "frame size is X, the return PC is at offset Y." Slower to walk but always correct.

You almost never need to know which mode is active. You do need to know that *both* exist and that exotic builds (cgo, custom linkers) can affect either.

---

## PCs, FuncTab, and PCDATA

A **program counter (PC)** is the instruction address. The Go binary contains a `pclntab` (PC line-number table) that maps every PC range to:

- **Function name** — via the symbol table.
- **File and line** — via PC-to-line lookup.
- **Inlining info** — list of inlined functions covering the PC.
- **Frame metadata** — frame size, where the FP is, etc.

`pclntab` lives in a dedicated section (`.gopclntab`) and is large — easily 5-20% of a binary's size. Stripping it (`-ldflags='-w -s'`) shrinks the binary but breaks `runtime.CallersFrames` symbolization.

The shape:

```
pclntab:
  function_table:       function name -> PC range
  line_table:           PC -> file, line
  pcdata_inline:        PC -> list of inlined call sites
  funcdata:             per-function GC and frame metadata
```

`runtime.FuncForPC` looks up the function table; `runtime.CallersFrames` looks up *both* the function table and the inline table.

---

## The Cost of `runtime.Callers`

Source: `$GOROOT/src/runtime/traceback.go` and `$GOROOT/src/runtime/symtab.go`.

`runtime.Callers(skip, pcs)`:

1. Acquires the current goroutine's `g`.
2. Calls `runtime.callers(skip, pcs)` — assembly that reads SP/BP and walks frames.
3. Returns the count of PCs filled.

Cost on amd64, modern hardware:
- **Per-frame walk**: ~10-20 ns (reading two pointers and a return PC).
- **Total for 8-frame capture**: ~150 ns.
- **Allocation**: 0 if the slice is caller-supplied (which it should be).

It does **not** symbolize; the PCs are raw addresses. That is why this step is cheap.

```go
var pcs [32]uintptr
n := runtime.Callers(2, pcs[:])
```

A stack-allocated array (`[32]uintptr`) avoids any heap allocation. Use this pattern in performance-sensitive code.

---

## Symbolization: `CallersFrames` Internals

`runtime.CallersFrames(pcs)` returns a `*Frames` iterator. Each call to `Next()`:

1. Pops the next PC from the slice.
2. Looks up the *outermost* function in the function table.
3. Walks the inlining list for that PC, emitting one virtual frame per inlined call.
4. Returns the frame and a `more` flag.

This costs roughly **100-300 ns per frame** because it involves:
- Binary search in the function table.
- Linear walk of the inline metadata.
- String allocation for `f.Function` and `f.File`.

For a 10-frame trace, expect ~1-3 µs of symbolization work.

`runtime.FuncForPC` is the older, simpler API:

```go
fn := runtime.FuncForPC(pc)
file, line := fn.FileLine(pc)
```

It does **not** account for inlining: an inlined call is reported as the *outer* function. New code should always prefer `CallersFrames`.

---

## Inlining and Frame Reconstruction

Consider:

```go
func A() { B() }
func B() { panic("x") }
```

If `B` is inlined into `A`, the compiled `A` directly contains the panic. The PC at the panic site lives inside the body of `A`, not `B`. Without inline metadata, your trace shows only `A`.

With inline metadata, the runtime knows: *this PC is in `A` at offset 17, which is the inlined body of `B`*. `CallersFrames` then emits two frames — `B` and `A` — even though only one PC was captured.

```go
frames := runtime.CallersFrames([]uintptr{pc})
for {
    f, more := frames.Next()
    fmt.Println(f.Function)
    if !more { break }
}
// prints: main.B, main.A
```

Compiler flag to disable inlining (debugging only):

```bash
go build -gcflags='all=-l' .
```

When traces look "wrong" — e.g., `A.go:17` reports a function that does not appear there — inlining is usually the culprit.

---

## Escape Analysis Effects on Stack Capture

Escape analysis decides whether a value lives on the stack or the heap. Two interactions with stack tracing:

### 1. Stack-allocated structures do not appear in heap profiles

A struct that lives entirely on the stack will not show up in `pprof heap`. If you suspect a struct is escaping but pprof says it isn't, build with `-gcflags='-m=2'` to confirm.

### 2. Captured PCs reference live code

A captured `[]uintptr` slice contains addresses inside compiled function bodies. If the GC decides to remove a function (it does not — Go keeps all code at all times), the addresses would be invalid. Because Go does not unload code, this is a non-issue for live processes — but for plugin-based architectures (`plugin` package), you can hit dangling PC errors.

### 3. Struct embedding in error types

If your stack-aware error embeds the PCs as a value (not a pointer), the slice header and backing array escape together when the error is returned. `errors.go` package style typically uses a pointer slice or a fixed array to control this.

```go
type fastErr struct {
    msg string
    pcs [16]uintptr // fixed-size, no heap slice
    n   int
}
```

This keeps the PC array inline in the struct, reducing the allocation count from 2 (struct + slice) to 1 (struct).

---

## Why Stack Traces Are Sometimes "Empty"

The most common puzzles:

### 1. Inlining swallowed the frames

Already covered. Use `CallersFrames`, not `FuncForPC`. Disable inlining with `-gcflags='all=-l'` if needed.

### 2. Optimized builds with `-ldflags='-s -w'`

`-s` strips the symbol table; `-w` strips DWARF. After stripping, `runtime.FuncForPC` returns nil-equivalent results and `CallersFrames` cannot resolve. The trace appears as a list of hex addresses.

**Fix**: do not strip in development. For release builds, keep `-trimpath` (strips file path prefixes) but keep symbols.

### 3. `runtime.Stack` buffer too small

```go
buf := make([]byte, 1024) // too small for many goroutines
n := runtime.Stack(buf, true)
```

When the buffer is too small, `runtime.Stack` truncates without warning. Always start with `1<<16` or `1<<20` for goroutine dumps.

### 4. cgo frames

Goroutines that have called into C code show their Go frames *up to* the cgo boundary, then "[C function]" or similar. The C side is invisible to Go's tracer.

### 5. Goroutines blocked in syscalls

A goroutine in `syscall` shows the syscall it is in but no further. That is normally enough.

### 6. tail-called helpers

Go does not do classical TCO, but small leaf functions are sometimes optimized in ways that make their frames degenerate. With recent Go versions this is rare.

---

## The Cost of `debug.Stack`

`runtime/debug.Stack()` is implemented as:

```go
func Stack() []byte {
    buf := make([]byte, 1024)
    for {
        n := runtime.Stack(buf, false)
        if n < len(buf) {
            return buf[:n]
        }
        buf = make([]byte, 2*len(buf))
    }
}
```

It captures, formats, and returns. It is **single-goroutine** (`false` argument).

Cost:
- One `runtime.Stack` call (capture + format).
- Allocates `buf` (potentially multiple times if the trace is large).
- Returns a `[]byte` that escapes to the heap.

Total: ~5-10 µs and 1-3 allocations. Acceptable at panic recovery, expensive in a hot loop.

`runtime/debug.PrintStack()` is the same plus a write to `os.Stderr`.

---

## Goroutine Dump Internals

`runtime.Stack(buf, true)`:

1. Calls `runtime.gcallers` for each goroutine (with `casgstatus(_Gwaiting)` to prevent the goroutine from moving while inspected).
2. Formats each goroutine's frames into the buffer.
3. Cooperatively pauses some scheduler activity but **does not stop the world**.

Cost grows with the number of goroutines and the length of each stack. A program with 10,000 goroutines can take tens of milliseconds for a full dump and produce megabytes of text. Plan accordingly: dump *occasionally*, not in a tight loop.

`pprof.Lookup("goroutine").WriteTo(w, debug)`:
- `debug=0` — binary protobuf, smallest.
- `debug=1` — text, deduplicated by stack hash. Use this for memory-efficient periodic dumps.
- `debug=2` — verbose, one block per goroutine, identical format to `runtime.Stack(buf, true)`.

For monitoring, `debug=1` is usually the right choice: 1000 goroutines blocked at the same line collapse into one entry with a count.

---

## Signal Handling and Crash Paths

Go installs runtime signal handlers for SIGABRT, SIGBUS, SIGFPE, SIGILL, SIGPIPE, SIGSEGV, SIGTRAP, and SIGQUIT. The relevant ones for traces:

- **SIGSEGV / SIGBUS** — usually a runtime bug or cgo memory error. The runtime panics, prints, and exits.
- **SIGQUIT** — the runtime prints all goroutine stacks and exits with code 2 + 128 (= 131 typically).
- **SIGABRT** — when `GOTRACEBACK=crash`, the runtime calls `abort()` after printing, allowing core dumps.

`os/signal` re-routes signals to user code, but the runtime keeps its own handlers for fatal ones unless you opt out. To customize SIGQUIT behavior (rare), see `runtime/debug.SetTraceback` plus your own handler.

The traceback format itself is fixed by the runtime in `$GOROOT/src/runtime/traceback.go`. You cannot easily change it for the panic path; if you need a custom format you must `recover()` and format yourself.

---

## Trimpath, Symbol Stripping, DWARF

Three separate concerns when you ship a binary:

### `-trimpath`

Removes the build-time GOPATH/module-cache prefix from file paths in the binary. Stack traces show `mymod/foo.go` instead of `/Users/alice/go/pkg/mod/.../foo.go`. **Recommended for any distributed binary.**

```bash
go build -trimpath ./cmd/mysvc
```

Downside: no automatic mapping back to source. Local debugging needs the unstripped binary.

### `-ldflags='-s'`

Strips the **Go symbol table**. After this, `runtime.FuncForPC` and `runtime.CallersFrames` return placeholder values and traces are mostly addresses.

### `-ldflags='-w'`

Strips **DWARF debug info**. Without DWARF, `dlv` cannot symbolicate variables or set source-level breakpoints. Stack traces still work because they use `pclntab`, not DWARF.

| Flag | Stack traces | Variable inspection (dlv) | Binary size |
|------|--------------|---------------------------|-------------|
| (none) | Full | Full | Largest |
| `-trimpath` | Full (relative paths) | Full | Same |
| `-ldflags='-w'` | Full | Limited | -10% |
| `-ldflags='-s -w'` | Names mostly missing | Broken | -20% |

For services that need production stacks, never use `-s`. `-w` is acceptable; `-trimpath` is encouraged.

---

## Allocation Profiles of Stack Capture

A breakdown of what allocates and what does not:

| Operation | Allocs | Bytes |
|-----------|--------|-------|
| `runtime.Callers(skip, pcs[:])` (caller buffer) | 0 | 0 |
| `runtime.Caller(1)` | 1 | string for file path |
| `runtime.FuncForPC(pc).Name()` | 0 | name is interned |
| `runtime.CallersFrames(pcs)` | 1 | iterator state |
| `frames.Next()` | 1-2 | `Function`, `File` strings |
| `runtime.Stack(buf, false)` | 0 (caller buffer) | formatting may grow |
| `runtime/debug.Stack()` | 1+ | the returned slice |

For high-volume capture without allocation, use a fixed array and resolve only when needed:

```go
type capturedStack struct {
    pcs [16]uintptr
    n   int
}

func (c *capturedStack) capture() {
    c.n = runtime.Callers(2, c.pcs[:])
}

func (c *capturedStack) frames() *runtime.Frames {
    return runtime.CallersFrames(c.pcs[:c.n])
}
```

Capture is allocation-free; symbolization happens later, only if needed.

---

## Disassembly: What `runtime.Callers` Compiles To

A simple capture function:

```go
func capture() int {
    var pcs [8]uintptr
    return runtime.Callers(2, pcs[:])
}
```

On amd64 (Go 1.21, simplified):

```asm
TEXT main.capture(SB)
    SUBQ    $72, SP            ; allocate frame
    MOVQ    BP, 64(SP)
    LEAQ    64(SP), BP
    LEAQ    pcs+0(SP), AX      ; address of pcs
    MOVQ    $8, BX             ; len(pcs)
    MOVQ    $8, CX             ; cap(pcs)
    MOVQ    $2, DX             ; skip = 2
    CALL    runtime.Callers(SB)
    MOVQ    n+0(SP), AX        ; return value
    ...
```

Highlights:
- `pcs[:]` is a stack slice header — no heap allocation.
- `runtime.Callers` is a regular function call.
- The runtime walks frames using saved BPs (or PCDATA) inside `runtime.callers`.

The work is in `runtime.callers` (lowercase), the assembly that does the actual unwinding. It is short but tight: read SP/BP, follow the chain, store PCs.

For comparison, `debug.Stack` does the unwind, calls into the formatter (`runtime/traceback.go::traceback1`), allocates strings for every frame, and copies them into the output buffer. Orders of magnitude more work.

---

## Summary

At professional level, stack tracing is a runtime feature with a known cost model: PCs are cheap to capture (frame walking, ~150 ns for 8 frames), symbolization is moderate (~100-300 ns per frame), and full text formatting is expensive (microseconds). Inlining is the dominant reason traces look surprising; `runtime.CallersFrames` is the modern API that handles it correctly. Trimpath, symbol stripping, and DWARF settings all interact with what your trace looks like in production. Knowing these mechanics turns "the trace is empty, what now?" from a guess into a diagnosis.

---

## Further Reading

- `$GOROOT/src/runtime/traceback.go` — read it.
- `$GOROOT/src/runtime/symtab.go` — `FuncForPC`, `CallersFrames`.
- `$GOROOT/src/runtime/debug/stack.go` — `Stack`, `PrintStack`.
- [The Go Programming Language Specification](https://go.dev/ref/spec) — stack growth and goroutine semantics.
- [Go Compiler Inlining](https://github.com/golang/go/wiki/CompilerOptimizations) — when functions get inlined.
- [Frame Pointers in Go (Go 1.21 release)](https://go.dev/doc/go1.21#frame-pointers).
- `go build -gcflags='-m=2' ./...` — escape analysis details.
- `go tool objdump` — disassembly.
- `go tool pprof` — profile inspection.
