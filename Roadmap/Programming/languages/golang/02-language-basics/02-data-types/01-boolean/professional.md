# Boolean — Professional Level

## Table of Contents
1. [How It Works Internally](#how-it-works-internally)
2. [Runtime Deep Dive](#runtime-deep-dive)
3. [Compiler Perspective](#compiler-perspective)
4. [Memory Layout](#memory-layout)
5. [OS / Syscall Level](#os-syscall-level)
6. [Source Code Walkthrough](#source-code-walkthrough)
7. [Assembly Output Analysis](#assembly-output-analysis)
8. [Performance Internals](#performance-internals)
9. [Garbage Collector Interaction](#garbage-collector-interaction)
10. [Scheduler Interaction](#scheduler-interaction)
11. [Escape Analysis](#escape-analysis)
12. [Compiler Flags & Build Tags](#compiler-flags-build-tags)
13. [SSA Form & Optimization Passes](#ssa-form-optimization-passes)
14. [Unsafe Operations](#unsafe-operations)
15. [ABI & Calling Conventions](#abi-calling-conventions)
16. [Tricky Questions](#tricky-questions)

---

## How It Works Internally

> **Focus:** "What happens under the hood?"

### The `bool` Type in the Go Type System

In Go's type system (`src/go/types/basic.go`), `bool` is defined as:

```go
// From Go source: src/go/types/type.go
type BasicKind int

const (
    Invalid BasicKind = iota
    Bool                      // bool
    Int                       // int
    // ...
)

type Basic struct {
    kind BasicKind
    info BasicInfo
    name string
}
```

The `bool` type's `kind` is `Bool = 1`. It's a "basic type" — one of the fundamental types built into the language, not defined in terms of other types.

### Internal Representation

At runtime, `bool` values are stored as bytes:
- `false` = `0x00`
- `true`  = `0x01`

This is not specified by the language spec (which only says "true and false"), but it is guaranteed by the implementation. The Go runtime, compiler-generated code, and `reflect` package all rely on this.

From `src/reflect/value.go`:
```go
func (v Value) Bool() bool {
    v.mustBe(Bool)
    return *(*bool)(v.ptr) // direct memory access
}
```

### The `reflect` Package View

```go
import "reflect"

var b bool = true
t := reflect.TypeOf(b)
fmt.Println(t.Kind())   // bool
fmt.Println(t.Size())   // 1
fmt.Println(t.Align())  // 1 (1-byte alignment)

v := reflect.ValueOf(b)
fmt.Println(v.Bool())   // true
```

`reflect.Type.Size()` returns 1 byte; `Align()` returns 1 (no alignment requirement beyond byte boundary).

---

## Runtime Deep Dive

### Bool in the Go Runtime (`src/runtime`)

The Go runtime does not have special handling for bool at the runtime level. It is treated as a 1-byte scalar value. The scheduler, GC, and memory allocator treat it identically to `uint8`.

### Bool Zeroing During Allocation

When Go allocates a struct or array, it zeros all memory (`runtime.memclrNoHeapPointers`). This is why `var b bool` is guaranteed to be `false` — the zeroed byte `0x00` is interpreted as `false`.

```go
// From src/runtime/memclr_amd64.s (simplified concept):
// When allocating `var b bool`, Go calls
// runtime.memclrNoHeapPointers(ptr, 1)
// which writes 0x00 to that byte
```

### Bool in Interface Values

When a `bool` is stored in an `interface{}`:

```go
var i interface{} = true
```

This creates an "iface" or "eface" pair on the heap:
```
eface {
    _type: *runtime._type  // pointer to bool's type descriptor
    data:  unsafe.Pointer  // for small values like bool: points to static true/false
}
```

The Go runtime has static `true` and `false` values to avoid heap allocation for interface-wrapped bools:

```go
// From src/cmd/compile/internal/walk/convert.go (conceptually)
// Small constants like true/false are stored as static data
// boolStaticData = [2]bool{false, true}
// interface wrapping true uses &boolStaticData[1]
```

---

## Compiler Perspective

### How the Compiler Handles Bool Expressions

The Go compiler (`cmd/compile`) processes boolean expressions through several phases:

1. **Parsing**: `ast.BinaryExpr{Op: token.LAND}` for `&&`
2. **Type checking**: verifies both operands are `bool`
3. **AST to IR**: converts to `ir.OANDAND` node
4. **SSA generation**: generates SSA form with basic blocks

### Short-Circuit in SSA

Consider `a && b`:

```
SSA (simplified):
  b1: entry block
    if a goto b2 else b3
  b2: a was true, evaluate b
    if b goto b4 else b3
  b3: result = false
    goto b5
  b4: result = true
    goto b5
  b5: phi(b3=false, b4=true) → final result
```

The `phi` node merges the two paths. This is how SSA represents conditional values without mutation.

### The `phi` Node

```
result = phi [b3: false], [b4: true]
```

A phi node says "this variable has different values depending on which basic block we came from." This is fundamental to how SSA (Static Single Assignment) represents branching logic.

---

## Memory Layout

### Bool Alignment and Padding

```go
// Single bool: 1 byte, alignment 1
var b bool
// Address: any byte boundary

// Bool in struct: alignment rules apply to the STRUCT, not to bool itself
type A struct {
    B bool    // offset 0
    N int64   // offset 8 (padded to 8-byte boundary for int64 alignment)
}
// sizeof(A) = 16

type B struct {
    N int64   // offset 0
    B bool    // offset 8
    // 7 bytes padding to maintain struct alignment (= max alignment of any field = 8)
}
// sizeof(B) = 16

type C struct {
    B1 bool   // offset 0
    B2 bool   // offset 1
    // 6 bytes padding
    N  int64  // offset 8
}
// sizeof(C) = 16
```

Check with `unsafe.Offsetof`:
```go
type MyStruct struct {
    Flag1 bool
    Value int64
    Flag2 bool
}
fmt.Println(unsafe.Offsetof(MyStruct{}.Value)) // 8
fmt.Println(unsafe.Sizeof(MyStruct{}))          // 24
```

### Bool Slice Memory

```go
var flags []bool = make([]bool, 1000000)
// Memory: 1,000,000 bytes = ~1MB
// Each bool is 1 byte

// Compare to bit-packed:
// 1,000,000 bits = 125,000 bytes = ~125KB
// 8x memory reduction
```

### Bool Array vs. Slice Headers

```go
// Array: stored inline in the enclosing struct/stack frame
var arr [3]bool
// Memory: 3 bytes, no indirection

// Slice: 24-byte header on stack + data on heap
var sl []bool = make([]bool, 3)
// Stack: {ptr(8) + len(8) + cap(8)} = 24 bytes header
// Heap: 3 bytes data
```

---

## OS / Syscall Level

### Bool at the Syscall Boundary

When Go calls OS syscalls, booleans must be converted to OS-native types. For example, `syscall.O_RDONLY` (for file open flags) uses integer constants, not booleans.

Go's `net` package converts boolean socket options:

```go
// From src/net/sockopt_posix.go
func setIPv6Only(fd *netFD, family int, ipv6only bool) error {
    v := boolint(ipv6only) // convert bool to int
    return fd.pfd.SetsockoptInt(syscall.IPPROTO_IPV6, syscall.IPV6_V6ONLY, v)
}

func boolint(b bool) int {
    if b { return 1 }
    return 0
}
```

The kernel expects 0/1 integers for socket boolean options — Go must convert.

### Bool in CGO

```go
// cgo bool handling
/*
#include <stdbool.h>
bool my_func(bool input);
*/
import "C"

func callC(b bool) bool {
    return bool(C.my_func(C.bool(b)))
}
```

Go's `bool` maps to C99's `_Bool` (or `bool` with `<stdbool.h>`). Both are 1 byte with 0/1 values.

---

## Source Code Walkthrough

### Key Files in Go Source

```
src/
  builtin/builtin.go          - bool type documented
  go/types/basic.go           - Bool BasicKind constant
  cmd/compile/internal/
    typecheck/typecheck.go     - type checking && and ||
    walk/expr.go               - code generation for bool ops
    ssagen/ssa.go              - SSA generation for bool
    ir/op.go                   - OANDAND, OOROR, ONOT opcodes
  reflect/type.go              - Bool kind in reflect
  runtime/memclr_amd64.s      - zeroing memory (sets bool to false)
```

### Compiler IR Opcodes for Bool

```go
// From src/cmd/compile/internal/ir/op.go
const (
    ONOT   Op = iota // !X
    OANDAND          // X && Y
    OOROR            // X || Y
    OEQ              // X == Y  (returns bool)
    ONE              // X != Y
    OLT              // X < Y
    OLE              // X <= Y
    OGT              // X > Y
    OGE              // X >= Y
)
```

Each opcode corresponds directly to a Go operator. The SSA pass converts these into branches and phi nodes.

---

## Assembly Output Analysis

### Viewing Generated Assembly

```bash
# Generate assembly
go tool compile -S main.go

# Or with optimizations disabled for clarity
go tool compile -S -N -l main.go
```

### Simple Bool Assignment

```go
func main() {
    b := true
    _ = b
}
```

Generated x86-64 assembly (simplified):
```asm
MOVB    $1, (SP)      ; move byte value 1 to stack (true)
```

### Bool Comparison (`a == b`)

```go
func equal(a, b bool) bool {
    return a == b
}
```

Assembly (amd64):
```asm
MOVBLZX  "".a(SP), AX    ; load a (zero-extend byte to int)
MOVBLZX  "".b+1(SP), CX  ; load b
CMPB     AL, CL           ; compare bytes
SETEQ    AL               ; set AL to 1 if equal, 0 otherwise
MOVB     AL, "".~r2+2(SP) ; store result
RET
```

### Short-Circuit Assembly

```go
func andShortCircuit(a, b bool) bool {
    return a && b
}
```

Assembly (simplified):
```asm
MOVBLZX  "".a(SP), AX
TESTB    AL, AL            ; test if a is zero (false)
JEQ      L_false           ; if false, jump to return false
MOVBLZX  "".b+1(SP), AX   ; a was true, now check b
MOVB     AL, "".~r2+2(SP)  ; return b's value
RET
L_false:
MOVB     $0, "".~r2+2(SP)  ; return false
RET
```

The short-circuit is visible at the assembly level: `JEQ L_false` jumps past b's evaluation.

### `!` (NOT) Assembly

```go
func notBool(b bool) bool {
    return !b
}
```

Assembly:
```asm
MOVBLZX  "".b(SP), AX
XORB     $1, AL       ; XOR with 1 flips bit 0: 0→1, 1→0
MOVB     AL, "".~r1+1(SP)
RET
```

`XOR with 1` is the most efficient NOT for a boolean byte.

---

## Performance Internals

### Branch Prediction in Modern CPUs

Modern CPUs (Intel Ice Lake, AMD Zen 3) have sophisticated branch predictors. For `bool` in a branch:

- **Strongly biased** (>99% true or false): ~0.5 cycles/branch
- **Weakly biased** (60/40 split): ~1-2 cycles/branch
- **Unpredictable** (50/50 random): ~15 cycles/branch (misprediction penalty)

This is why sorting data before processing can dramatically improve performance of boolean-heavy loops.

### SETCC Family Instructions

Boolean comparisons compile to `SETCC` instructions (SETEqual, SETLess, etc.) which set a byte register to 0 or 1 based on the flags register. This avoids branching entirely:

```go
func isPositive(x int) bool {
    return x > 0
}
```

Assembly:
```asm
CMPQ  "".x(SP), $0    ; compare x with 0
SETGT AL               ; set AL = 1 if x > 0, else 0 (no branch!)
MOVB  AL, "".~r1+8(SP)
RET
```

No branch instruction — the CPU computes the bool without branch prediction pressure.

### CMOV (Conditional Move) for Branchless Bool

```go
func boolToInt(b bool) int {
    if b { return 1 }
    return 0
}
```

The compiler may generate:
```asm
MOVBLZX "".b(SP), AX   ; load bool (0 or 1)
; result is already 0 or 1 — no branch needed
```

---

## Garbage Collector Interaction

### Bool Pointers and GC

`*bool` pointers ARE tracked by the GC. A bool pointed to on the heap will not be collected as long as a live pointer exists.

```go
b := new(bool) // allocates bool on heap
*b = true
// 'b' keeps the bool alive
```

### Escape Analysis for Bool

```go
func main() {
    b := true    // stack-allocated (does not escape)
    fmt.Println(b) // passing to interface causes escape analysis
}
```

Check escape analysis:
```bash
go build -gcflags="-m" main.go
# Output: "b does not escape" (stack allocated)
# But: "b escapes to heap" if passed to an interface
```

When a `bool` is stored in an `interface{}`, it MIGHT escape to the heap. The compiler has an optimization: for small constant values like `true` and `false`, it uses static storage instead of heap allocation.

```go
// These do NOT cause heap allocation (compiler optimization):
var i interface{} = true   // uses static bool data
var j interface{} = false  // uses static bool data
```

### GC Pointer Maps for Bool

The GC needs to know which words in a struct/stack frame are pointers (to trace). `bool` is a scalar — not a pointer — so it is NOT included in the GC's pointer maps. This means GC scanning overhead is zero for bool fields.

---

## Scheduler Interaction

### Bool in `select` Statements

```go
done := make(chan bool, 1)

select {
case v := <-done:
    // v is bool
    if v {
        fmt.Println("success")
    }
case <-time.After(5 * time.Second):
    fmt.Println("timeout")
}
```

The Go scheduler (`goroutine scheduler`) handles `select` with `selectgo` (in `src/runtime/select.go`). The bool value is passed through the channel's data buffer, which is sized by `unsafe.Sizeof(bool{})` = 1 byte.

### Bool Channels and Goroutine Signaling

```go
// Idiomatic signaling: use struct{} for pure signaling (no data needed)
done := make(chan struct{})
go func() {
    // ... work ...
    close(done) // signal completion
}()
<-done // wait

// Use bool channel only when the value matters:
result := make(chan bool, 1)
go func() {
    result <- validate(input)
}()
if <-result {
    fmt.Println("valid")
}
```

`chan struct{}` is preferred for signaling because `struct{}` has zero size (no data to copy through the channel). `chan bool` copies 1 byte.

---

## Escape Analysis

### Detailed Escape Analysis for Bool

```go
package main

func stackBool() bool {
    b := true // stack
    return b  // value copy, b stays on stack
}

func heapBool() *bool {
    b := true  // ESCAPES to heap (address taken, returned)
    return &b
}

func interfaceBool() interface{} {
    b := true  // May escape to heap (interface wrapping)
    return b   // Compiler optimizes: uses static data for true
}
```

Run with:
```bash
go build -gcflags="-m=2" .
```

### When Does Bool Escape?

1. **Address taken and returned**: `return &b` → heap
2. **Stored in a heap-allocated struct**: `s.flag = &b` where `s` is on heap → heap
3. **Passed to `interface{}`**: usually stack (compiler optimization for bool constants)
4. **Captured in a goroutine closure**: `go func() { use(b) }()` → heap

---

## Compiler Flags & Build Tags

### Dead Code Elimination with Const Bool

```go
// build_debug.go — only compiled with `-tags debug`
//go:build debug

package main

const isDebugMode = true
```

```go
// build_release.go — compiled without debug tag
//go:build !debug

package main

const isDebugMode = false
```

```go
// main.go
func processRequest() {
    if isDebugMode {
        logDebugInfo() // compiled OUT in release builds
    }
}
```

The compiler eliminates dead code when it can prove at compile time that a const bool is `false`. This is more efficient than runtime flags.

### Link-Time Bool Optimization

```bash
go build -ldflags="-X 'main.isProduction=true'"
# Note: ldflags set strings, not bools
# You'd need: var isProduction string = "false"
# Then: if isProduction == "true" { ... }
# Or better: use build tags
```

---

## SSA Form & Optimization Passes

### How `&&` Becomes SSA

Source:
```go
if a && b { doWork() }
```

SSA (simplified representation):
```
b0:
  If a → b1, b2

b1:  ; a was true
  If b → b3, b2

b2:  ; result is false (either a or b was false)
  goto b4

b3:  ; both true
  call doWork()
  goto b4

b4:  ; merge point
  ...
```

### SSA Optimization: Constant Propagation

```go
const debug = false
if debug && expensiveCheck() { // → if false && X → always false
    // This entire block is removed
}
```

SSA pass: constant fold `false && X` → `false`. Then dead code elimination removes the block.

### SSA Optimization: Boolean Simplification

```go
x != 0 && x != 0  // duplicate condition
```

SSA's value numbering recognizes that both `x != 0` nodes are identical, replaces the second with the first. Result: `x != 0`.

### Viewing SSA

```bash
GOSSAFUNC=myFunc go build .
# Opens a browser with SSA visualization for myFunc
```

---

## Unsafe Operations

### Inspecting Bool Memory

```go
import "unsafe"

b := true
ptr := unsafe.Pointer(&b)
byteVal := *(*byte)(ptr) // read bool as byte
fmt.Printf("bool %v = byte %d\n", b, byteVal) // bool true = byte 1

// DANGEROUS: setting bool to values other than 0 or 1
*(*byte)(ptr) = 42 // undefined behavior!
fmt.Println(b) // could print true, but behavior is undefined
```

**Never set a bool to a value other than 0 or 1 via unsafe.** The compiler may generate code that assumes `bool` is exactly 0 or 1 (e.g., the XOR-1 NOT optimization would break).

### Comparing Bool Memory Directly

```go
a := true
b := true
// Direct memory comparison
aPtr := (*byte)(unsafe.Pointer(&a))
bPtr := (*byte)(unsafe.Pointer(&b))
fmt.Println(*aPtr == *bPtr) // true (same byte value)
```

This is unnecessary (just use `a == b`) but illustrates the underlying storage.

---

## ABI & Calling Conventions

### Register-Based ABI (Go 1.17+)

Since Go 1.17, the compiler uses a register-based ABI (Application Binary Interface) for function calls on amd64. `bool` values are passed in integer registers:

```go
func isPositive(x int) bool { return x > 0 }
```

ABI:
- Input: `x` in `AX` register
- Output: `bool` in `AX` register (as 0 or 1)

Before Go 1.17 (stack-based ABI):
- Input: `x` at `8(SP)`
- Output: `bool` at `16(SP)`

The register-based ABI significantly reduces function call overhead for small types like `bool`.

### Bool in Variadic Functions

```go
fmt.Println(true, false) // interface{} wrapping occurs
```

When passing `bool` to `interface{}` in variadic calls, the compiler uses static addresses for `true` and `false` to avoid allocation. This is an important optimization for logging and debugging code.

---

## Tricky Questions

**Q1: What guarantees that `var b bool` is `false` and not some other zero byte?**
A: Two things: (1) the Go spec guarantees bool's zero value is `false`; (2) the runtime zeroes all allocated memory, and `false` is represented as `0x00`.

**Q2: Why does `XOR $1, AL` implement boolean NOT?**
A: Because Go booleans are stored as 0 (`false`) or 1 (`true`). XOR with 1 flips bit 0: `0 XOR 1 = 1` (false→true), `1 XOR 1 = 0` (true→false). All other bits are zero, so `XOR 1` is equivalent to `NOT` for this single-bit representation.

**Q3: What happens if you use `unsafe` to set a bool byte to `2`?**
A: Undefined behavior. The compiler generates code assuming bool is exactly 0 or 1. For example, `!b` compiles to `XOR $1, b` — if `b` is `2`, then `!b` = `2 XOR 1` = `3`, which is neither 0 nor 1. The program will behave incorrectly.

**Q4: Does `interface{} = true` allocate on the heap?**
A: No. The compiler uses a static address for the `true` constant (an optimization). This avoids GC pressure for common bool-to-interface conversions.

**Q5: Why is `SETGT` instruction branchless but `if x > 0 { return true }` might generate a branch?**
A: The compiler chooses between `SETCC` (branchless) and `JCC` (branch) based on profiling and heuristics. For simple comparisons without complex control flow, `SETCC` is preferred. Use `-gcflags="-N -l"` to see unoptimized output; the optimized output usually uses `SETCC`.

**Q6: What is the wire size of `bool` in Go's binary encoding (`encoding/gob`, `encoding/json`)?**
A: JSON: `"true"` (4 bytes) or `"false"` (5 bytes). Gob: 1 byte (0 or 1). Protobuf: varint, 1 byte (0x00 or 0x01). The wire representation is much larger than the in-memory 1-byte representation for text formats.

---

## Diagrams & Visual Aids

### Bool Representation in Memory

```
Memory address: 0x...
┌──────────────────┐
│     bool byte    │
│  0x00 = false    │
│  0x01 = true     │
│ (0x02..0xFF: UB) │
└──────────────────┘
```

### SSA for `a && b`

```
                  ┌─────────────┐
                  │   b0: entry │
                  │  if a: b1/b2│
                  └─────────────┘
                  /              \
    ┌──────────────────┐    ┌──────────────────┐
    │  b1: a was true  │    │  b2: a was false  │
    │  if b: b3/b4     │    │  result = false   │
    └──────────────────┘    └──────────────────┘
     /         \                    \
┌──────┐   ┌──────┐          ┌──────────────┐
│ b3:  │   │ b4:  │          │ b5: merge    │
│true  │   │false │──────────│ phi(b3,b4,b2)│
└──────┘   └──────┘          └──────────────┘
```

### Register ABI Bool Passing

```
Go function: func f(a bool) bool

Caller:
  MOV  $0x01, AX    ; a = true
  CALL f

Callee (f):
  ; AX contains 'a' (0 or 1)
  ; compute result...
  ; put result in AX
  RET

Caller:
  ; AX contains return value
```
