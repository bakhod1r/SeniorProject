# Go Multiple Return Values — Professional / Internals Level

## 1. Overview

This document covers what multi-result functions become at the binary level: SSA representation, the register ABI's slot allocation for N results, the layout of the `error` interface in registers, the cost of error allocations, the open-coded defer interaction with named returns, and the runtime mechanics of `errors.Is`/`errors.As` chain walking. Goal: precise enough to read assembly, predict allocations, and design error APIs that don't degrade hot paths.

---

## 2. Compilation Pipeline for Multi-Result Functions

Source:
```go
func divmod(a, b int) (int, int) {
    return a / b, a % b
}

q, r := divmod(17, 5)
```

```
Parse
    ↓
AST: FuncDecl with Type.Results = [Field{Type: int}, Field{Type: int}]
    ↓
Type checking
    ↓
SSA construction
    - The return statement becomes a Ret op consuming N value-typed results.
    - Each result is assigned to a specific outgoing slot (register or stack).
    ↓
Optimization passes (CSE, inlining, BCE)
    ↓
Register allocation
    - First N integer/pointer results → AX, BX, CX, DI, SI, R8, R9, R10, R11
    - First N float results → X0..X14
    - Overflow → caller's stack frame
    ↓
Code generation
    ↓
Final binary
```

---

## 3. AST Representation

```go
func divmod(a, b int) (int, int) {
    return a / b, a % b
}
```

AST:
```
FuncDecl
├── Name: Ident "divmod"
├── Type: FuncType
│   ├── Params: FieldList { [a, b] int }
│   └── Results: FieldList { [int, int] }
└── Body: BlockStmt
    └── ReturnStmt
        ├── BinaryExpr "/" [a, b]
        └── BinaryExpr "%" [a, b]
```

A multi-result function is represented identically to a single-result function except `Results.List` has multiple entries. There is no special "tuple" node.

---

## 4. SSA Representation

Conceptual SSA (after walk):

```
b1:
  v1 = InitMem
  v2 = Arg <int> {a}
  v3 = Arg <int> {b}
  v4 = Div64 <int> v2 v3   // a / b
  v5 = Mod64 <int> v2 v3   // a % b
  Ret v4 v5 v1             // returns (v4, v5)
```

The `Ret` op takes a variable number of value operands, one per result. The compiler then assigns each operand to the appropriate output register during regalloc.

For a function returning `(int, error)`:

```
b1:
  ...
  v10 = errorIface ...    // a 2-word interface value
  Ret v9 v10 v_mem
```

The interface value `v10` is itself two words (itab + data), which the regalloc spreads across BX and CX (or further registers).

---

## 5. The Calling Convention in Detail

### 5.1 Result Register Mapping (amd64 ABIInternal)

For a function `func f() (T1, T2, ..., Tn)`:

```
Result index 0 → AX (or X0 if float)
Result index 1 → BX (or X1)
Result index 2 → CX (or X2)
Result index 3 → DI (or X3)
Result index 4 → SI (or X4)
Result index 5 → R8 (or X5)
Result index 6 → R9 (or X6)
Result index 7 → R10 (or X7)
Result index 8 → R11 (or X8)
Result index 9+ → caller stack frame (spill area)
```

For interface results, each interface occupies TWO consecutive register slots (itab + data).

For struct results, the struct is decomposed field-by-field into registers when it fits; if it doesn't fit (~more than ~9 ints worth), the entire struct spills to the stack.

### 5.2 Example: `(int, error)` Return

Source:
```go
func parse(s string) (int, error) {
    return 42, nil
}
```

Compiled (amd64, simplified):
```asm
parse:
    MOVQ    $42, AX        ; result 0: int
    XORQ    BX, BX         ; result 1.itab = nil
    XORQ    CX, CX         ; result 1.data = nil
    RET
```

Caller:
```asm
    CALL    parse(SB)
    ; AX = 42
    ; BX, CX = nil interface
    ; check err == nil:
    ORQ     BX, BX         ; or could OR BX|CX
    JNZ     errorPath
    ; use AX
```

### 5.3 Spilling Beyond 9 Results

```go
func ten() (a, b, c, d, e, f, g, h, i, j int) { ... }
```

The 10th and beyond results are written to the caller's stack frame via reserved spill slots. The compiler emits the slot offsets in the function's outgoing parameter area.

---

## 6. The `error` Interface Layout

```go
type iface struct {
    tab  *itab     // type word (or eface uses *_type)
    data unsafe.Pointer
}

type itab struct {
    inter *interfacetype
    _type *_type
    hash  uint32
    _     [4]byte
    fun   [1]uintptr // method table, variable length
}
```

For `error`, the itab points to a per-(concrete-type, error-interface) record. The data points to the concrete error value.

When a function returns `error`:
- itab is loaded into BX (typically).
- data is loaded into CX.

A nil interface has both itab=0 AND data=0. The typed-nil bug is when itab is non-nil but data is nil.

---

## 7. The Typed-Nil Interface Bug at Bit Level

```go
type MyErr struct{}
func (e *MyErr) Error() string { return "" }

func bad() error {
    var p *MyErr = nil
    return p
}
```

Compiled `return p`:
```asm
    LEAQ    type:*main.MyErr+0(SB), BX    ; itab for (*MyErr, error)
    XORQ    CX, CX                          ; data = nil
    RET
```

Caller `if err == nil`:
```asm
    CALL    bad(SB)
    ; AX unused, BX = type, CX = 0
    TESTQ   BX, BX
    JZ      isNil
    ; itab non-nil, so err != nil even though concrete value is nil
    ...
```

The check `err == nil` lowers to `(BX | CX) == 0`. Since BX has the itab, the result is non-zero → err is "non-nil".

`errors.Is(err, nil)` is also false in this case, but the type-checker doesn't catch it.

Static analyzers (`nilness`, `errcheck`) catch many cases at lint time.

---

## 8. Inlining of Multi-Result Functions

The Go inliner treats multi-result functions like single-result. The cost of each return expression is summed. Most small `(value, error)` functions inline. Verify:

```bash
go build -gcflags="-m -m" 2>&1 | grep "inlining call to"
```

When inlined, the result-passing registers are eliminated entirely — the caller uses the inlined values directly.

---

## 9. Open-Coded Defer + Named Returns

When a function uses `defer` to modify a named return:

```go
func work() (n int, err error) {
    defer func() {
        if err != nil { n = -1 }
    }()
    n = 42
    return
}
```

The compiler may use **open-coded defer** (Go 1.14+) for the deferred closure. The deferred call is inlined into each return path:

```
b_return:
    ; ... close out body ...
    ; (open-coded) execute deferred function inline
    TEST   ; check err
    JZ     skip_modify
    MOVL   $-1, AX        ; n = -1
skip_modify:
    RET
```

Open-coded defer requires:
- ≤ 8 defers in the function.
- No defer in a loop.
- The deferred closure is straightforwardly representable.

For complex defers (loops, recover), the runtime falls back to stack/heap defer chains.

---

## 10. Cost of Error Allocations

### 10.1 `errors.New("string")`

Source:
```go
func New(text string) error {
    return &errorString{text}
}
```

Each call allocates an `*errorString` on the heap:
- 16 bytes for the struct (string header).
- The string itself is interned by the compiler if a literal.

For a sentinel:
```go
var ErrFoo = errors.New("foo") // allocated ONCE at init
```

Subsequent `return ErrFoo` is two register moves (itab+data), zero alloc.

### 10.2 `fmt.Errorf("ctx: %w", err)`

Source (approx):
```go
func Errorf(format string, args ...any) error {
    // ... format args into string, possibly building a wrapError ...
}
```

Each call:
- Allocates a `[]any` slice for variadic args.
- Boxes each non-pointer arg.
- Builds the formatted string.
- Allocates a `*wrapError` (or `*wrapErrors` for multiple `%w`s).

Total: ~3-5 allocations per call.

### 10.3 `errors.Join(errs...)`

Source:
```go
func Join(errs ...error) error {
    n := 0
    for _, err := range errs {
        if err != nil { n++ }
    }
    if n == 0 { return nil }
    e := &joinError{errs: make([]error, 0, n)}
    for _, err := range errs {
        if err != nil { e.errs = append(e.errs, err) }
    }
    return e
}
```

Per call (with N non-nil errors): 1 alloc for `joinError`, 1 for the slice. Cheap.

---

## 11. `errors.Is` Implementation

Source (simplified):
```go
func Is(err, target error) bool {
    if target == nil {
        return err == target
    }
    isComparable := reflectlite.TypeOf(target).Comparable()
    for {
        if isComparable && err == target {
            return true
        }
        if x, ok := err.(interface{ Is(error) bool }); ok && x.Is(target) {
            return true
        }
        switch x := err.(type) {
        case interface{ Unwrap() error }:
            err = x.Unwrap()
            if err == nil {
                return false
            }
        case interface{ Unwrap() []error }:
            for _, err := range x.Unwrap() {
                if Is(err, target) {
                    return true
                }
            }
            return false
        default:
            return false
        }
    }
}
```

`errors.Is` performs:
- 1 type assertion check per level.
- 1 `==` comparison per level (if comparable).
- Recursion via `Unwrap` until exhausted.

Cost is proportional to chain depth — typically <10 levels. No allocations.

---

## 12. `errors.As` Implementation

Source (simplified):
```go
func As(err error, target any) bool {
    if err == nil { return false }
    if target == nil { panic(...) }
    val := reflectlite.ValueOf(target)
    typ := val.Type()
    if typ.Kind() != reflectlite.Ptr || val.IsNil() { panic(...) }
    targetType := typ.Elem()
    // ... walk Unwrap chain, type-assert at each level ...
    for err != nil {
        if reflectlite.TypeOf(err).AssignableTo(targetType) {
            val.Elem().Set(reflectlite.ValueOf(err))
            return true
        }
        if x, ok := err.(interface{ As(any) bool }); ok && x.As(target) {
            return true
        }
        // ... unwrap ...
    }
    return false
}
```

Uses reflection at each level. More expensive than `errors.Is`. Use `errors.As` only when you need the concrete error value; `errors.Is` for sentinel checks.

---

## 13. Multi-Result and the Garbage Collector

A function returning `(*T, error)`:
- The `*T` pointer in AX is a stack root (GC will follow it from the caller's frame).
- The error itab in BX is treated as a pointer (it's a `*itab`).
- The error data in CX is treated as a pointer (it's an `unsafe.Pointer`).

The compiler emits stack maps so the GC knows which result registers (when spilled) are pointers.

---

## 14. Microbenchmarking Multi-Result

```go
package main

import "testing"

func one() int        { return 42 }
func two() (int, int) { return 42, 43 }

func BenchmarkOne(b *testing.B) {
    s := 0
    for i := 0; i < b.N; i++ {
        s += one()
    }
    _ = s
}

func BenchmarkTwo(b *testing.B) {
    s := 0
    for i := 0; i < b.N; i++ {
        a, c := two()
        s += a + c
    }
    _ = s
}

func BenchmarkValueError(b *testing.B) {
    s := 0
    for i := 0; i < b.N; i++ {
        n, err := func() (int, error) { return 42, nil }()
        if err == nil {
            s += n
        }
    }
    _ = s
}
```

Typical (Go 1.22, amd64):
- `BenchmarkOne`: ~0.5 ns/op (inlined).
- `BenchmarkTwo`: ~0.5 ns/op (inlined; both results in registers).
- `BenchmarkValueError`: ~0.5 ns/op (inlined; nil error is just zero registers).

When NOT inlined (e.g., across packages), add ~3-4 ns/op for the call.

For a function returning `(int, error)` with a real error:
- `BenchmarkErrPath`: ~30 ns/op + 16 B alloc per error allocation.

---

## 15. Reading Disassembly for Multi-Result

```go
package main

func divmod(a, b int) (int, int) {
    return a / b, a % b
}

func main() {
    q, r := divmod(17, 5)
    _, _ = q, r
}
```

```bash
go build -gcflags="-S" main.go 2>asm.txt
grep -A 10 "divmod" asm.txt
```

Expected:
```
main.divmod STEXT
    MOVQ    AX, DX        ; save a
    MOVQ    BX, CX        ; save b
    MOVQ    DX, AX
    CQO                   ; sign-extend AX → DX:AX
    IDIVQ   CX            ; AX = a/b, DX = a%b
    MOVQ    DX, BX        ; result 1 → BX
    RET
```

Two results returned in AX (quotient) and BX (remainder). No stack frame.

---

## 16. PGO and Multi-Result

PGO (Go 1.21+) helps multi-result functions in two ways:

1. **More aggressive inlining** of hot multi-result functions.
2. **Devirtualization** for interface-returning functions when one concrete type dominates (e.g., a function returning `(io.Reader, error)` where `io.Reader` is dominantly `*bufio.Reader`).

Capture profile + rebuild:
```bash
# Profile
go test -cpuprofile=cpu.prof -bench=.

# Build with PGO
go build -pgo=cpu.prof .
```

---

## 17. Tools for Inspecting Multi-Result Code

| Tool | Use |
|------|-----|
| `go vet -nilness` | Detects typed-nil interface bugs |
| `errcheck` | Finds discarded errors |
| `staticcheck` | Misuse of error-handling patterns |
| `gocritic` | Various code-quality lints |
| `pprof` | Allocation profiling |
| `go test -race` | Detects races in error/value reads |

---

## 18. Linker / Symbol Table

Multi-result functions appear identically to single-result in the symbol table. The result count is encoded in the function type signature within DWARF debug info, used by the debugger.

```bash
go tool objdump -s "main.divmod" myprog
```

---

## 19. Self-Assessment Checklist

- [ ] I can read assembly for a multi-result function and identify result registers
- [ ] I understand interface layout (itab + data) and the typed-nil bug at the bit level
- [ ] I can predict allocations for `errors.New`, `fmt.Errorf`, `errors.Join`
- [ ] I understand `errors.Is` and `errors.As` traversal mechanics
- [ ] I know when open-coded defer applies to functions with named returns
- [ ] I can use PGO to optimize hot multi-result functions
- [ ] I can use `go vet -nilness` to catch typed-nil bugs
- [ ] I know the GC sees result registers as roots
- [ ] I can microbenchmark multi-result vs struct returns

---

## 20. References

- [Go Internal ABI](https://github.com/golang/go/blob/master/src/cmd/compile/abi-internal.md)
- [`runtime.iface` source](https://cs.opensource.google/go/go/+/refs/tags/go1.22:src/runtime/iface.go)
- [`errors` package source](https://cs.opensource.google/go/go/+/refs/tags/go1.22:src/errors/)
- [Open-coded defer proposal](https://github.com/golang/proposal/blob/master/design/34481-opencoded-defers.md)
- [`go vet` nilness analyzer](https://pkg.go.dev/golang.org/x/tools/go/analysis/passes/nilness)
- [Go Blog — Working with Errors in Go 1.13](https://go.dev/blog/go1.13-errors)
- 2.6.1 Functions Basics
- 2.6.6 Named Return Values
