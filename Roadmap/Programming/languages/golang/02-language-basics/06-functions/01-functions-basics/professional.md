# Go Functions Basics — Professional / Internals Level

## 1. Overview

This document covers what a Go function actually *is* at the binary level: how the source declaration becomes an AST node, how it lowers through the SSA pipeline, how the register-based ABI lays out arguments and results, what a stack frame looks like, how the runtime grows stacks during a call, how the GC walks frames, and how `defer` is compiled in its three different shapes (heap / stack / open-coded). The goal is a mental model precise enough to read assembly output, profile call-heavy code, and reason about why a single function call costs 1 ns in one configuration and 60 ns in another.

---

## 2. The Go Compiler Pipeline for Functions

```
Source: func add(a, b int) int { return a + b }
    ↓ Parsing (cmd/compile/internal/syntax)
AST: FuncDecl{Name, Type, Body}
    ↓ Type checking (cmd/compile/internal/types2)
Typed AST + irgen
    ↓ SSA construction (cmd/compile/internal/ssagen)
SSA IR (function-shaped: entry block, exit block, arg/result moves)
    ↓ Optimization passes (cmd/compile/internal/ssa)
      - early dead-code
      - cse (common subexpression elimination)
      - opt (peephole)
      - prove (range/nil prove pass)
      - fuse (block fusion)
      - inline (after lowering)
      - regalloc (register allocation)
      - spill / reload
    ↓ Code generation (cmd/compile/internal/<arch>)
amd64 / arm64 / arm / 386 / wasm machine code
    ↓ Linker (cmd/link)
Final binary with symbol table and DWARF
```

---

## 3. AST Representation

Source:
```go
package main

func add(a, b int) int {
    return a + b
}
```

AST shape (simplified):
```
File
└── FuncDecl
    ├── Name: Ident "add"
    ├── Type: FuncType
    │   ├── Params: FieldList
    │   │   └── Field [Name "a", Name "b"] Type *Ident "int"
    │   └── Results: FieldList
    │       └── Field Type *Ident "int"
    └── Body: BlockStmt
        └── ReturnStmt
            └── BinaryExpr "+"
                ├── X: Ident "a"
                └── Y: Ident "b"
```

Inspect with the public AST tooling:
```go
package main

import (
    "go/parser"
    "go/printer"
    "go/token"
    "os"
)

func main() {
    fset := token.NewFileSet()
    src := `package main; func add(a, b int) int { return a + b }`
    f, _ := parser.ParseFile(fset, "x.go", src, 0)
    printer.Fprint(os.Stdout, fset, f)
}
```

---

## 4. SSA Representation

Inspect SSA visually:
```bash
GOSSAFUNC=add go build main.go
# Opens ssa.html in your browser with each pass shown side-by-side.
```

Conceptual SSA (after early lowering):
```
b1: (entry)
  v1 = InitMem
  v2 = SP
  v3 = SB
  v4 = Arg <int> {a}
  v5 = Arg <int> {b}
  v6 = Add64 <int> v4 v5
  Ret v6 v1
```

After register allocation on amd64, this becomes (rough):
```
add:
    LEAQ (AX)(BX*1), AX     ; AX = a + b   (a in AX, b in BX)
    RET
```

Two registers in (`AX`, `BX`), one register out (`AX`). No stack frame at all for this leaf function.

---

## 5. Calling Convention (ABIInternal)

Since Go 1.17, the standard internal ABI passes scalar arguments and results in registers. The amd64 ABIInternal register list (excerpt):

| Purpose | Registers (amd64) |
|---------|-------------------|
| Integer/pointer args | RAX, RBX, RCX, RDI, RSI, R8, R9, R10, R11 (9 total) |
| Floating-point args | X0-X14 (15 total) |
| Integer/pointer results | Same as args (RAX first) |
| Stack pointer | RSP |
| Goroutine pointer | R14 |

Arguments beyond the register count spill to the stack. A struct argument is decomposed field-by-field into registers if it fits.

**Boundary functions** (assembly stubs, CGO trampolines, `//go:nosplit` runtime helpers) sometimes use the older stack-based ABI0. The linker generates ABI wrappers automatically when the two are mixed.

Inspect:
```bash
go tool objdump -s "main\.add" myprog
```

---

## 6. Stack Frame Layout

A typical Go function frame on amd64 (caller's stack growing downward):

```
high addr
  ┌──────────────────────────┐
  │ caller's locals & saved  │
  ├──────────────────────────┤  ← caller SP before call
  │ return address (RIP)     │
  ├──────────────────────────┤
  │ saved BP (frame pointer) │  ← present in -gcflags="-N -l" or with frame pointers enabled
  ├──────────────────────────┤
  │ callee locals            │
  │ (ordered by liveness)    │
  ├──────────────────────────┤
  │ arg/result spill area    │  ← for register args that may need to be spilled
  ├──────────────────────────┤  ← callee SP
  │ ...                      │
low addr (stack grows down)
```

The **frame size** is fixed per function (no alloca). It includes:
- Spill slots for register arguments and results.
- Locals that survive across calls (callee-saved-equivalent).
- Padding for stack alignment (16-byte aligned on entry).

The compiler emits a `funcdata` record alongside the function describing which words in the frame are pointers, for the GC.

---

## 7. The Function Prologue and Epilogue

Every non-leaf, non-`//go:nosplit` function starts with a stack-overflow check:

```asm
; Prologue (amd64, cooperative scheduling check + stack growth check)
add:
    MOVQ (TLS), CX            ; load g (current goroutine pointer)
    CMPQ SP, 16(CX)           ; SP vs g.stackguard0
    JLS  morestack            ; jump to runtime.morestack if low
    SUBQ $framesize, SP        ; allocate frame
    ; ... body ...
    ; Epilogue:
    ADDQ $framesize, SP
    RET
```

`runtime.morestack`:
1. Saves the current g's state.
2. Calls into `runtime.newstack`, which allocates a larger stack.
3. Copies all live data from the old stack to the new one.
4. Adjusts every pointer in the new stack (using the function's pointer maps).
5. Resumes the function from the prologue, this time with enough stack.

This mechanism is what makes goroutines cheap: a 2 KiB initial stack scales to whatever each goroutine needs, on demand.

`//go:nosplit` skips the check — used in `runtime` for code that runs in contexts where stack growth is unsafe (e.g., signal handlers, GC).

---

## 8. The Register Set Across a Call

```
caller:                              callee:
  AX = arg0          ──call──►        AX = arg0  (input)
  BX = arg1                            BX = arg1
                                        ...
  ...                                  AX = result0  (output)
  AX = result0      ◄──ret──            ...
```

The standard convention says **all registers are caller-saved** in ABIInternal — the callee may clobber any register. The caller must save anything it needs across the call. This avoids a per-callee save/restore cost but pushes the cost to the caller, which the compiler optimizes globally.

---

## 9. Inlining Pass

The inliner runs in two phases:

1. **Inlinability marking** (`canInline`): visits each function, computes a "cost" by walking its IR, and marks it inlinable if cost < budget (default 80 in Go 1.20+).
2. **Inline expansion** (`inlineCalls`): at each callsite, if the callee is inlinable, splices the callee body into the caller, renaming locals and propagating constants.

The cost budget grew over time:

| Go Version | Budget | Notable change |
|------------|--------|----------------|
| Go 1.0-1.11 | 40 | Conservative |
| Go 1.12 | 80 with hairy node penalty | Mid-stack inlining |
| Go 1.20 | Allows inlining of `for` loops | |
| Go 1.21 | Allows inlining of functions with `range` | |
| Go 1.22 | Closures, type switches more inlinable | |

Force-disable inlining for a function:
```go
//go:noinline
func bench(a, b int) int { return a + b }
```

Force-disable for an entire package (testing only):
```bash
go build -gcflags="all=-l" .
```

Inspect inlining:
```bash
go build -gcflags="-m -m" 2>&1 | grep -E "inline|cannot"
```

---

## 10. Indirect Calls (Function Values)

Source:
```go
var f func(int) int = add
y := f(7)
```

Compiled (amd64, conceptual):
```asm
    MOVQ    f(SB), DX            ; load funcval pointer
    MOVQ    (DX), CX             ; load code pointer (first word of funcval)
    MOVL    $7, AX               ; arg0
    CALL    CX                   ; indirect call
```

Costs vs a direct call:
- 1 extra load (funcval → code pointer).
- Branch predictor may mispredict if `f` varies.
- **No inlining** — the compiler doesn't know what `f` is.

For a closure with captures:
```
funcval = [ codePtr | capture0 | capture1 | ... ]
```
The captures are accessed via `MOVQ disp(DX), reg`. The DX register acts as the "context pointer" for the closure — the standard Go ABI reserves DX for this purpose on amd64.

---

## 11. The `defer` Implementations in Detail

### 11.1 Heap Defer (Go ≤ 1.13)

```c
type _defer struct {
    siz     int32
    started bool
    sp      uintptr
    pc      uintptr
    fn      *funcval
    _panic  *_panic
    link    *_defer
}
```

Each `defer` allocates a `_defer` on the per-goroutine free-list (or heap if exhausted) and links it to `g._defer`. On function exit, `runtime.deferreturn` walks the list LIFO, calling each `fn`. Cost: ~50 ns per defer + heap pressure.

### 11.2 Stack Defer (Go 1.13)

The compiler emits the `_defer` record on the caller's stack frame (no allocation). Same linked-list mechanism. Cost: ~30 ns per defer.

### 11.3 Open-Coded Defer (Go ≥ 1.14)

When a function:
- has at most 8 defers,
- has no defer in a loop,
- doesn't recover or do something exotic,

the compiler **inlines** each deferred call directly into every return path, with a single 8-bit bitmap that tracks which defers are active at each point. Cost: ~1-2 ns per defer in the no-panic case.

When a panic occurs, the runtime walks frames via `funcdata` to find open-coded defer info and execute them. This is slower than the linked-list mechanism but the rare-event cost is acceptable.

### 11.4 Choosing the Path

The compiler chooses per function. Use:
```bash
go build -gcflags="-d=defer=2" 2>&1
```
to print which defer mode each function uses.

---

## 12. The GC Sees Function Frames

For each goroutine, on each GC cycle, the runtime walks the goroutine's stack from top to bottom, scanning each frame's pointer-typed slots as roots.

Each frame has an associated **stack map** generated by the compiler:
- `argInfo`: which words in the argument area are pointers.
- `argLiveInfo`: which arguments are live at each call site.
- `localsInfo`: which words in locals are pointers.

These maps are emitted as `funcdata` and read by `runtime.gentraceback`. Functions written in assembly must declare their pointer maps via `FUNCDATA` and `PCDATA` directives, or risk GC corruption.

This is also why precise GC requires precise types — Go does NOT use conservative scanning of the stack.

---

## 13. Function Symbol Table

In the final binary, each function corresponds to a symbol like `main.add` (package.name) with an associated:
- `_funcInfo`: PC range, frame size, file/line info.
- `funcdata`: pointer maps, defer info, line tables.
- `pcsp`, `pcfile`, `pcln`: per-PC tables for the SP delta, source file, and line number.

Inspect:
```bash
go tool nm myprog | grep main\.add
go tool objdump -s "main\.add" myprog
go tool addr2line myprog 0x46e2d0
```

The `funcdata`/`pcdata` mechanism is what makes Go stack traces, profiler symbolication, and the GC work — all built on the same per-function metadata.

---

## 14. Method Dispatch: Direct, Method Value, Interface

Three ways to call a method `func (t *T) F()`:

```go
// 1. Direct (concrete) — fully inlinable
t.F()

// 2. Method value — funcval with bound receiver
m := t.F
m()  // indirect call through funcval

// 3. Interface call — itab lookup
var i I = t
i.F()  // load itab, find F slot, indirect call
```

Costs (rough, amd64, modern CPU):

| Form | Cycles | Inlinable? |
|------|--------|------------|
| Direct call | 1-2 | Yes |
| Method value call | 5-8 | No |
| Interface call (cached itab) | 3-5 | No (devirtualization in some cases) |
| Interface call (cold itab) | 30+ | No |

Devirtualization (Go 1.21+): the inliner can sometimes inline through a known interface assignment when the concrete type is visible at the call site.

---

## 15. Cross-Package Calls and Inlining Export Data

When `pkg/foo` declares `func Add(a, b int) int { return a + b }`, the compiler stores the function body in `foo.a` (Go archive) under the `inl` section, so other packages importing `foo` can inline `foo.Add`. The export data carries the function body for any inlinable function.

Without inlining info, calls across packages would be opaque to the optimizer and slower. The export data inflates somewhat (~10-30%), but it's the price of cross-package optimization.

---

## 16. Profiling Function Hotspots

CPU profile (sampling-based, ~100 Hz):
```go
import _ "net/http/pprof"
// or:
import "runtime/pprof"

f, _ := os.Create("cpu.prof")
pprof.StartCPUProfile(f)
defer pprof.StopCPUProfile()
// ... workload ...
```

Then:
```bash
go tool pprof -http=:8080 cpu.prof
```

Top reasons a function appears in the profile:
- Hot loop with non-inlinable callee.
- Excessive allocations (most time in `runtime.mallocgc`).
- Mutex contention (most time in `sync.(*Mutex).Lock`).
- Indirect call cache misses.

---

## 17. PGO (Profile-Guided Optimization)

Since Go 1.21, PGO is stable. Provide a CPU profile from a representative production workload; the compiler uses it to:
- Inline more aggressively at hot call sites (raises the inlining budget).
- Devirtualize hot interface calls when one concrete type dominates.
- Guide register allocation.

```bash
go build -pgo=cpu.prof .
```

Typical wins: 2-7% throughput on serving binaries. Hot, function-call-heavy code benefits most.

---

## 18. Linkname and Externally Implemented Functions

Use `//go:linkname` to bind a Go-declared function to a symbol in another package or assembly. Requires `import "unsafe"`.

```go
package mypkg

import _ "unsafe" // for go:linkname

//go:linkname runtimeNanotime runtime.nanotime
func runtimeNanotime() int64
```

This bypasses Go's visibility rules and is reserved for runtime/stdlib internal use. User code that does this is fragile and may break across Go versions; Go 1.23+ tightens the rules and warns.

---

## 19. Cooperative Scheduling Points

Most function prologues include the morestack check. This same check is the primary **goroutine preemption** point: the scheduler signals the goroutine to yield by setting `g.stackguard0 = stackPreempt`, causing the next call's prologue to deflect into `runtime.gosched`.

Since Go 1.14, the runtime also supports **asynchronous preemption** via signals (`SIGURG` on Unix), so even tight loops without function calls can be preempted.

A `//go:nosplit` function does NOT preempt; long `nosplit` chains can starve the scheduler.

---

## 20. Putting It Together — A Minimal Function End-to-End

Source:
```go
package main

import "fmt"

func add(a, b int) int {
    return a + b
}

func main() {
    fmt.Println(add(2, 3))
}
```

What happens, step by step:

1. **Compile time**: `add` is parsed → typed → SSA-built. Cost = 3 nodes; well under the inline budget. Marked inlinable.
2. **Inline phase**: the call `add(2, 3)` in `main` is replaced with `2 + 3`, then constant-folded to `5`.
3. **Code generation**: `main` ends up containing roughly `MOVL $5, AX; CALL fmt.Println; RET`.
4. **Linking**: `main`, `fmt.Println`, and runtime support are merged; `add` may be eliminated entirely as dead.
5. **Runtime**: the goroutine running `main` enters `fmt.Println` via the function prologue, the morestack check passes, the body runs, the epilogue restores SP, control returns.

Verify:
```bash
go build -gcflags="-m" main.go
# inlining call to add
# inlining call to fmt.Println
# ...

go build -gcflags="-S" main.go 2>asm.txt
grep -A 5 "main\.main" asm.txt
```

---

## 21. Self-Assessment Checklist

- [ ] I can read the SSA dump of a simple function and identify each pass
- [ ] I can read amd64 assembly for a Go function and identify args/results in registers
- [ ] I understand the role of `morestack` and stack growth
- [ ] I can describe the open-coded defer fast path and when it kicks in
- [ ] I can enumerate the cost components of an indirect call
- [ ] I know how to use `go tool objdump` and `go tool nm`
- [ ] I can apply PGO and reason about which call sites benefit
- [ ] I know what `funcdata` and `pcdata` are for
- [ ] I can write `//go:noinline`, `//go:nosplit` and explain when (rarely) to use them

---

## 22. References

- [Go Internal ABI Specification](https://github.com/golang/go/blob/master/src/cmd/compile/abi-internal.md)
- [Go runtime: stack package](https://github.com/golang/go/blob/master/src/runtime/stack.go)
- [Open-coded defers proposal #34481](https://github.com/golang/proposal/blob/master/design/34481-opencoded-defers.md)
- [Inlining proposal #19348](https://github.com/golang/go/issues/19348)
- [Profile-Guided Optimization in Go](https://go.dev/doc/pgo)
- [Dave Cheney — High Performance Go Workshop](https://dave.cheney.net/high-performance-go-workshop/dotgo-paris.html)
- 2.6.5 Closures
- 2.7.4 Memory Management
