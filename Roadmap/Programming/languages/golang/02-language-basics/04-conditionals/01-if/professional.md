# if Statement — Professional Level (Internals & Under the Hood)

## 1. How the Go Compiler Represents `if` Statements

The Go compiler translates `if` statements through several phases: parsing, type checking, SSA (Static Single Assignment) construction, and code generation.

**Phase 1: Parsing (go/parser)**

The parser produces an `*ast.IfStmt` node:

```go
// From go/ast/ast.go:
type IfStmt struct {
    If   token.Pos // position of "if" keyword
    Init Stmt      // initialization statement; or nil
    Cond Expr      // condition
    Body *BlockStmt // if body
    Else Stmt      // else branch; or nil (can be *IfStmt for else-if)
}
```

**Phase 2: Type Checking (go/types)**

The type checker verifies that `Cond` has type `bool`. Unlike C/C++, Go rejects non-boolean conditions at compile time — no implicit integer-to-bool conversion.

**Phase 3: SSA (cmd/compile/internal/ssa)**

The if statement becomes a conditional branch in SSA form:
```
b1:
    v1 = ... // condition evaluation
    If v1 → b2, b3

b2:
    // if block
    → b4

b3:
    // else block
    → b4

b4:
    // continue after if
```

---

## 2. Assembly Output for `if` Statements

```go
func isPositive(x int) bool {
    if x > 0 {
        return true
    }
    return false
}
```

```bash
go tool compile -S main.go
```

Generated assembly (amd64):
```asm
"".isPositive STEXT nosplit size=16 args=0x10 locals=0x0
    TEXT    "".isPositive(SB), NOSPLIT|ABIInternal, $0-16
    MOVQ    AX, CX          // x in AX (register ABI, Go 1.17+)
    XORL    AX, AX          // AX = 0 (false)
    TESTQ   CX, CX          // CX & CX sets flags
    SETLE   AL              // AL = 1 if CX <= 0 (NOT greater than 0)
    XORB    $1, AL          // invert: 1 if CX > 0
    RET
```

Key insight: For simple `if` statements returning a boolean, the compiler generates `SETcc` instructions (conditional set) — **no branch instruction at all**. This is branchless code, immune to branch misprediction.

---

## 3. Conditional Move Optimization (CMOV)

For simple value selection:

```go
func max(a, b int) int {
    if a > b {
        return a
    }
    return b
}
```

Assembly (amd64):
```asm
"".max STEXT nosplit
    CMPQ    AX, BX      // compare a and b
    CMOVLLEQ BX, AX    // if a <= b, move b into AX
    RET                 // return AX
```

`CMOVLE` is a conditional move — no branch, no misprediction. The compiler automatically applies this optimization for simple `if-else` patterns that select between two values.

**When CMOV is applied:**
- Simple value assignment in both branches
- No function calls in branches
- Small, register-sized values

**When CMOV is NOT applied:**
- Complex branches with function calls
- Memory operations
- Multiple assignments

---

## 4. Branch Prediction and Alignment

The CPU's branch predictor maintains a table of recent branch outcomes. For loops and common patterns, it achieves ~99% accuracy. For truly random branches, it's ~50% accurate.

```go
// CPU profiling shows branch mispredictions:
// go test -bench=. -cpuprofile=cpu.prof
// go tool pprof cpu.prof
// > weblist myFunction
// Look for: `br_miss_pred_retired` in hardware counters

// perf (Linux) to see misprediction rate:
// perf stat -e branch-misses,branches ./myapp
```

Go compiler applies **profile-guided optimization (PGO)** in Go 1.21+ to reorder branches based on actual runtime frequency data.

---

## 5. SSA Analysis: How the Compiler Eliminates Dead Branches

The Go compiler's SSA pass performs **dead code elimination** on `if` statements:

```go
const debug = false

func process() {
    if debug {           // condition is constant false
        expensiveLog()   // this code is NEVER emitted to binary
    }
    doWork()
}
```

The compiler evaluates `debug` at compile time, sees it's `false`, and the entire `if` body is eliminated from the binary. This is why build tags and compile-time constants work for conditional compilation.

```bash
# Verify: check binary size with vs without debug constant
go build -ldflags="-X main.debug=true" -o app_debug .
go build -o app_nodebug .
ls -la app_debug app_nodebug
```

---

## 6. The `if` Init Statement — Compiler Scope Analysis

The init statement creates a new lexical scope at the compiler level. Variables in the init statement are allocated to this scope.

```go
if x := compute(); x > 0 {
    use(x)
}
```

In the compiler's IR, this creates a new scope block:
```
// Compiler's internal representation:
Block {
    VarDecl: x = compute()
    IfStmt {
        Cond: x > 0
        Body: use(x)
    }
}
```

The escape analysis determines whether `x` is stack-allocated or heap-allocated. Since `x` doesn't outlive the if block, it's typically stack-allocated.

---

## 7. The `bool` Type in Go: Memory Layout

In Go, `bool` is a 1-byte type. In practice:

```
Memory layout: 0 = false, 1 = true
Other values: undefined behavior (but typically still false in Go)

In registers: typically stored in 8-bit register (AL, BL, etc.)
On stack: aligned to 1-byte boundary
In structs: may be padded for alignment
```

```go
type Data struct {
    Flag1 bool // 1 byte
    // 7 bytes padding
    Value int64 // 8 bytes (aligned to 8-byte boundary)
    Flag2 bool  // 1 byte
    // 7 bytes padding
}
// sizeof(Data) = 24 bytes (not 10!)

// Optimized:
type Data2 struct {
    Value int64 // 8 bytes first
    Flag1 bool  // 1 byte
    Flag2 bool  // 1 byte
    // 6 bytes padding
}
// sizeof(Data2) = 16 bytes
```

---

## 8. Short-Circuit Evaluation at the Assembly Level

```go
func check(a, b bool) bool {
    return a && b
}
```

Assembly:
```asm
TESTB   AX, AX    // test a
JE      .Lfalse   // jump if a == false (short-circuit)
TESTB   BX, BX    // test b
JE      .Lfalse   // jump if b == false
MOVB    $1, AX    // return true
RET
.Lfalse:
XORL    AX, AX    // return false
RET
```

The `JE` (jump if equal/zero) instruction implements short-circuit: if `a` is false (zero), `b` is never evaluated (the code for evaluating `b` is jumped over).

---

## 9. Escape Analysis with `if` Init Variables

```go
func f() {
    // Does x escape to heap?
    if x := make([]byte, 1024); someCondition() {
        use(x)
    }
}
```

```bash
go build -gcflags="-m" main.go
# Output: ./main.go:3:12: make([]byte, 1024) does not escape
```

The compiler proves that `x` doesn't outlive the `if` block (no goroutine creation, no pointer to `x` returned), so `x` is stack-allocated — no GC pressure.

---

## 10. Profile-Guided Optimization (PGO) and `if`

Go 1.21+ uses PGO to optimize branch ordering:

```bash
# Step 1: Collect a profile from production
go build -o app .
./app  # run with production workload
# (CPU profile collected via pprof)

# Step 2: Build with profile
go build -pgo=profile.pprof -o app_pgo .
```

With PGO:
- Frequently-taken branches are placed first in generated code (better instruction cache use)
- Cold branches (rarely taken) are moved to the end of the function
- Branch prediction hints can be inserted

```go
// PGO-aware pattern: hot path check first
func serve(r *Request) {
    // PGO observes: 99% of requests are GET
    if r.Method == "GET" { // hot branch — PGO puts this first
        return serveGet(r)
    }
    // cold path
    return serveOther(r)
}
```

---

## 11. The Go Specification: Formal `if` Statement Rules

From the Go specification:

```
IfStmt = "if" [ SimpleStmt ";" ] Expression Block [ "else" ( IfStmt | Block ) ] .

SimpleStmt = EmptyStmt | ExpressionStmt | SendStmt |
             IncDecStmt | Assignment | ShortVarDecl .
```

Key formal properties:
1. `Expression` must be of type `bool` — no implicit conversions
2. `SimpleStmt` creates a new scope that encloses both `Block` and else branch
3. The else branch can be another `IfStmt` (enabling `else if` chains) or a `Block`
4. Variables declared in `SimpleStmt` are in scope throughout the entire `if-else` chain

---

## 12. Boolean Expression Evaluation in the Type Checker

The type checker (go/types) ensures `if` conditions are strictly boolean:

```go
// These all fail type checking:
var x int = 1
if x { }           // ERROR: non-boolean condition in if statement (int)

var p *int = &x
if p { }           // ERROR: non-boolean condition in if statement (*int)

var s string = "go"
if s { }           // ERROR: non-boolean condition in if statement (string)
```

Internally, the type checker calls `check.expr(x, s.Cond)` and verifies the resulting type is `untyped bool` or named type `bool`.

---

## 13. Compiler Inlining and `if` Statements

The Go compiler inlines functions based on an inlining budget. `if` statements contribute to this budget.

```go
// Inlineable: simple if with low budget
func isPositive(n int) bool {
    if n > 0 {
        return true
    }
    return false
}

// May not be inlined: complex if with many branches
func classifyHTTPStatus(code int) string {
    if code >= 500 {
        return "server error"
    } else if code >= 400 {
        return "client error"
    } else if code >= 300 {
        return "redirect"
    } else if code >= 200 {
        return "success"
    }
    return "informational"
}

// Check inlining decisions:
// go build -gcflags="-m=2" main.go 2>&1 | grep inline
```

---

## 14. The `unsafe` Package and Conditional Logic

In performance-critical code, `unsafe` allows bypassing if checks:

```go
// Bounds-check elimination via unsafe:
// Normal: slice[i] with bounds check
func safeAccess(s []int, i int) int {
    if i < 0 || i >= len(s) { panic("out of bounds") }
    return s[i]
}

// With unsafe (no bounds check, no if):
func unsafeAccess(s []int, i int) int {
    return *(*int)(unsafe.Pointer(
        uintptr(unsafe.Pointer(&s[0])) + uintptr(i)*unsafe.Sizeof(s[0]),
    ))
}

// Better: use //go:nosplit and trust the compiler:
//go:nosplit
func fastAccess(s []int, i int) int {
    _ = s[i] // hint to compiler: i is in range
    return s[i]
}
```

---

## 15. The `go vet` Analysis of `if` Statements

`go vet` runs several analyzers that inspect `if` statements:

**`copylocks`:** Detects mutex copying in if-init:
```go
var mu sync.Mutex
if m := mu; m.TryLock() { }  // vet: "assignment copies lock value"
```

**`printf`:** Checks format strings in if branches:
```go
if err != nil {
    fmt.Printf("error: %s", err.Error()) // vet if %s used with error
}
```

**`shadow`:** (not built-in, but via staticcheck) Detects shadowed variables:
```go
x := 1
if x := compute(); x > 0 { } // shadow: inner x shadows outer x
```

**`sigchanyzer`:** Detects incorrect signal channel usage in if conditions.

```bash
go vet ./...
staticcheck ./...
```

---

## 16. Memory Model Implications of `if`

The Go memory model states that within a single goroutine, operations appear in source-code order. This means:

```go
// Within one goroutine: safe — compiler doesn't reorder these
x := readData()
if x != nil {
    process(x) // guaranteed: x is the value read above
}

// Across goroutines: NOT guaranteed without synchronization
var shared *Data

// Goroutine 1:
shared = newData()

// Goroutine 2:
if shared != nil { // MAY see stale nil even after goroutine 1 wrote!
    use(shared)   // data race!
}

// Fix:
var mu sync.Mutex
mu.Lock()
shared = newData()
mu.Unlock()

mu.Lock()
if shared != nil {
    use(shared)
}
mu.Unlock()
```
