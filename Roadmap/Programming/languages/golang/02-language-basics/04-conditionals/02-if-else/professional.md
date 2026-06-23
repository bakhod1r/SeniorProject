# Go if-else — Professional / Internals Level

## Table of Contents
1. Go Compiler Pipeline and if-else
2. SSA (Static Single Assignment) Representation
3. x86-64 Assembly Output for if-else
4. ARM64 Assembly Output for if-else
5. The Go Linker and Branch Relocation
6. Memory Layout of Branched Code
7. CPU Pipeline and Branch Prediction Hardware
8. CMOV Instructions — Conditional Move
9. Escape Analysis and the Heap
10. Garbage Collector Interaction
11. if-else in the Go Specification
12. The Automatic Semicolon Insertion Rule
13. Parser Implementation (go/ast)
14. Type Checker Implementation
15. Runtime Reflection of Conditions
16. Profile-Guided Optimization Internals

---

## 1. Go Compiler Pipeline and if-else

The Go compiler (`cmd/compile`) processes if-else through these stages:

```
Source Code
    |
    v
Lexer (scanner) — tokenizes "if", identifiers, operators
    |
    v
Parser (syntax.go) — builds AST (IfStmt node)
    |
    v
Type Checker (typecheck.go) — verifies condition is bool
    |
    v
SSA Generation (ssagen/) — converts to SSA IR
    |
    v
SSA Passes — dead code elim, branch elim, phi elimination
    |
    v
Machine Code Generation — conditional jumps
    |
    v
Linker — resolves branch targets
```

```go
// This Go code:
func abs(n int) int {
    if n < 0 {
        return -n
    }
    return n
}

// Becomes this AST (simplified):
// IfStmt {
//     Cond: BinaryExpr { X: n, Op: <, Y: 0 }
//     Body: BlockStmt { ReturnStmt { UnaryExpr { Op: -, X: n } } }
//     Else: nil
// }
// ReturnStmt { X: n }
```

---

## 2. SSA (Static Single Assignment) Representation

After type checking, the compiler converts to SSA form. Each variable is assigned exactly once.

```
# For: if n < 0 { return -n } return n

b1:                         # Entry block
  v1 = LocalAddr &n         # address of n
  v2 = Load v1              # load n
  v3 = Const64 0            # constant 0
  v4 = Less64 v2 v3         # n < 0
  If v4 -> b2 b3            # branch

b2:                         # True block (n < 0)
  v5 = Neg64 v2             # -n
  Return v5

b3:                         # False block (n >= 0)
  Return v2
```

View SSA with:
```bash
GOSSAFUNC=abs go build main.go
# Opens ssa.html in browser showing all SSA passes
```

Key SSA passes affecting if-else:
- **deadcode**: Removes unreachable blocks
- **phiopt**: Optimizes φ (phi) nodes at branch joins
- **branchelim**: Eliminates provably one-way branches
- **nilcheckelim**: Removes redundant nil checks

---

## 3. x86-64 Assembly Output for if-else

```bash
go build -gcflags="-S" main.go 2>&1 | grep -A 20 '"".abs'
```

```asm
# func abs(n int) int
TEXT "".abs(SB), NOSPLIT|ABIInternal, $0-16

# Load parameter n (in AX register on x86-64, Go calling convention)
MOVQ    "".n+8(SP), AX

# Condition: n < 0
TESTQ   AX, AX        # test AX with itself (sets SF flag)
JGE     positive      # jump if >= 0

# True branch: return -n
NEGQ    AX            # negate AX
RET

# False branch: return n
positive:
RET
```

For more complex if-else:

```asm
# if x > 10 && x < 20 { return 1 } else { return 0 }
MOVQ    "".x+8(SP), AX
CMPQ    AX, $10       # compare x with 10
JLE     false         # if x <= 10, jump to false
CMPQ    AX, $20       # compare x with 20
JGE     false         # if x >= 20, jump to false
MOVQ    $1, AX        # true: return 1
RET
false:
XORL    AX, AX        # false: return 0 (XOR self = 0)
RET
```

---

## 4. ARM64 Assembly Output for if-else

```bash
GOARCH=arm64 go build -gcflags="-S" main.go 2>&1 | grep -A 20 '"".abs'
```

```asm
# func abs(n int) int  (ARM64)
TEXT "".abs(SB), NOSPLIT|ABIInternal, $0-16

# R0 holds parameter n in ARM64 calling convention
TST     R0, R0        # test R0 (sets condition flags)
BGE     positive      # branch if >= 0 (Greater or Equal)

# Negate: -n
NEG     R0, R0        # R0 = -R0
RET

positive:
RET                   # R0 unchanged
```

ARM64 key instructions for conditionals:
- `CMP` — compare (subtract without storing result)
- `TST` — test (AND without storing result)
- `BEQ`, `BNE`, `BLT`, `BLE`, `BGT`, `BGE` — conditional branches
- `CSEL` — conditional select (branchless alternative)

---

## 5. The Go Linker and Branch Relocation

When the compiler generates a branch (JMP/JNE/JGE), the target address is initially a placeholder:

```
# During compilation:
JGE     +PLACEHOLDER   # "jump forward N bytes"

# After linking:
JGE     0x4A23F0       # resolved absolute address
```

For small forward branches (within ~2GB), x86-64 uses relative jumps:
```
# 2-byte short jump (within -128 to +127 bytes)
7D 0C       # JGE +12

# 6-byte near jump (within ±2GB)
0F 8D 00 00 10 00    # JGE +0x100000
```

The linker resolves all placeholder addresses. Go uses a position-independent approach for shared libraries but static binary linking by default.

---

## 6. Memory Layout of Branched Code

```
Virtual Memory Layout of a Go binary:

Text Segment (executable code):
  ┌─────────────────────────────────────┐
  │  function prologue (stack setup)    │
  ├─────────────────────────────────────┤
  │  CMPQ / TESTQ (condition check)     │
  ├─────────────────────────────────────┤
  │  Jcc (conditional jump instruction) │
  ├─────────────────────────────────────┤
  │  TRUE BRANCH code                   │  ← falls through if condition true
  ├─────────────────────────────────────┤
  │  JMP (unconditional jump to exit)   │
  ├─────────────────────────────────────┤
  │  FALSE BRANCH code                  │  ← jumped to if condition false
  ├─────────────────────────────────────┤
  │  function epilogue (return)         │
  └─────────────────────────────────────┘
```

The Go compiler typically places the "hot" branch as fall-through (no jump needed). With PGO, the compiler uses profiling data to determine which branch is hot.

**Instruction Cache Impact**: Branching to cold code (rarely taken) may cause I-cache misses. PGO helps by placing hot code contiguously.

---

## 7. CPU Pipeline and Branch Prediction Hardware

Modern CPUs have multiple branch prediction mechanisms:

```
Branch Predictor Components:
┌──────────────────────────────────┐
│  Branch Target Buffer (BTB)      │  Cache of recent branch targets
│  Pattern History Table (PHT)     │  2-bit saturating counters
│  Return Stack Buffer (RSB)       │  Predicts function returns
│  Indirect Branch Predictor       │  Predicts indirect jumps
└──────────────────────────────────┘

2-bit saturating counter states:
  Strongly Not Taken (00) ─→ taken once ─→
  Weakly Not Taken   (01) ─→ taken again ─→
  Weakly Taken       (10) ─→ not taken  ─→
  Strongly Taken     (11) ─→ not taken  ─→
                     (10) ...
```

For Go code:
- Error-checking branches (`if err != nil`) are strongly-not-taken (errors are rare)
- Loop continuation branches are strongly-taken
- Alternating conditions (like sorted data traversal) may mis-predict

**Spectre mitigation** (2018): Retpoline patches affect indirect branches in Go code, adding overhead to dynamic dispatch (interfaces, function pointers) but NOT static if-else.

---

## 8. CMOV Instructions — Conditional Move

The Go compiler sometimes generates `CMOV` instead of jumps for simple if-else:

```go
func max(a, b int) int {
    if a > b {
        return a
    }
    return b
}
```

May compile to:
```asm
CMPQ    a, b
MOVQ    b, result      # assume b
CMOVGQ  a, result      # if a > b, move a into result
RET
```

`CMOVGQ` = Conditional MOVe if Greater (64-bit). No branch = no misprediction.

The compiler generates CMOV when:
- Both branches are simple and free of side effects
- The compiler determines predictability is poor
- The values are already computed (no lazy evaluation needed)

```go
// Likely compiled to CMOV (branchless):
func clamp(v, lo, hi int) int {
    if v < lo { v = lo }
    if v > hi { v = hi }
    return v
}

// NOT compiled to CMOV (side effects):
func processOrSkip(x int) {
    if x > 0 {
        expensiveOp(x)  // has side effects — must branch
    }
}

func expensiveOp(x int) {}
```

---

## 9. Escape Analysis and the Heap

The Go compiler runs escape analysis on every variable, including those in if-else branches:

```bash
go build -gcflags="-m -m" main.go 2>&1 | grep "escapes"
```

```go
// Does NOT escape (stays on stack)
func processLocal(flag bool) int {
    x := 42
    if flag {
        x = -x
    }
    return x  // returned by value, no escape
}

// ESCAPES to heap (returned as pointer)
func processEscaping(flag bool) *int {
    x := 42
    if flag {
        x = -x
    }
    return &x  // x escapes: compiler moves to heap
}

// Interface boxing causes escape
func processInterface(flag bool) interface{} {
    x := 42
    if flag {
        return x  // boxing: x escapes to heap
    }
    return nil
}

// Pre-allocated avoids repeated escape
var cachedResult = 42

func processPreallocated(flag bool) *int {
    if flag {
        return &cachedResult  // pointer to static — no allocation
    }
    return nil
}
```

---

## 10. Garbage Collector Interaction

The GC must trace pointers. if-else branches that create heap allocations affect GC pressure:

```go
package main

import (
    "runtime"
    "testing"
)

// Allocation-heavy: creates garbage every call
func heavyBranch(err error) string {
    if err != nil {
        return fmt.Sprintf("error: %v", err)  // allocation!
    }
    return "ok"
}

// GC-friendly: pre-computed strings, no allocation
const okStr = "ok"

func lightBranch(err error) string {
    if err != nil {
        return err.Error()  // may or may not allocate
    }
    return okStr  // no allocation: constant string
}

func BenchmarkHeavy(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        heavyBranch(nil)
    }
}

func BenchmarkLight(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        lightBranch(nil)
    }
}

var _ = runtime.GC // keep import
```

GC pause interaction:
- Each allocation inside if-else branches adds to GC allocation counters
- GC triggers when heap size doubles
- Hot-path if-else with allocations can trigger GC more frequently

---

## 11. if-else in the Go Specification

From the official Go specification (https://go.dev/ref/spec):

```
IfStmt      = "if" [ SimpleStmt ";" ] Expression Block
              [ "else" ( IfStmt | Block ) ] .
SimpleStmt  = EmptyStmt | ExpressionStmt | SendStmt | IncDecStmt
            | Assignment | ShortVarDecl .
```

Key specification points:

1. `[ SimpleStmt ";" ]` — optional init statement (the `;` separator is literal)
2. `Expression` — must be of type `bool` (enforced by type checker)
3. `Block` — always braces `{}` required
4. `else` followed by either another `IfStmt` or a `Block`

```go
// Valid per spec:
if x := 5; x > 0 {}             // SimpleStmt + Expression + Block
if x > 0 {}                      // Expression + Block only
if x > 0 {} else {}              // with else Block
if x > 0 {} else if y > 0 {}    // with else IfStmt

// Invalid per spec:
// if x > 0 { } else             // else with no block
// if (x > 0) { }                // parentheses are redundant but VALID
```

---

## 12. The Automatic Semicolon Insertion Rule

This rule explains why `else` must be on the same line:

**Rule**: The lexer inserts a semicolon after a line ending with:
- An identifier
- An integer, floating-point, imaginary, rune, or string literal
- One of: `break`, `continue`, `fallthrough`, `return`
- One of: `++`, `--`
- One of: `)`, `]`, `}`

```go
// After lexing, the parser sees:
if condition {
    doThis()
};          // <-- semicolon inserted after }
else {      // ERROR: unexpected else after statement
    doThat()
}
```

```go
// Correct: else on same line — no semicolon inserted
if condition {
    doThis()
} else {    // } followed by else — no semicolon
    doThat()
}
```

The lexer implementation in `cmd/compile/internal/syntax/scanner.go`:

```go
// Simplified version of what the scanner does
func (s *scanner) insertSemi(tok token) bool {
    switch tok {
    case _Name, _Literal, _Break, _Continue,
         _Fallthrough, _Return, _Inc, _Dec,
         _Rparen, _Rbracket, _Rbrace:
        return true
    }
    return false
}
```

---

## 13. Parser Implementation (go/ast)

```go
package main

import (
    "go/ast"
    "go/parser"
    "go/token"
    "fmt"
)

func main() {
    src := `
package main
func f() {
    if x > 0 {
        return 1
    } else {
        return 0
    }
}`

    fset := token.NewFileSet()
    f, err := parser.ParseFile(fset, "", src, 0)
    if err != nil {
        panic(err)
    }

    // Walk the AST to find if statements
    ast.Inspect(f, func(n ast.Node) bool {
        if ifStmt, ok := n.(*ast.IfStmt); ok {
            fmt.Printf("IfStmt at %v\n", fset.Position(ifStmt.Pos()))
            fmt.Printf("  Condition: %T\n", ifStmt.Cond)
            fmt.Printf("  Body statements: %d\n", len(ifStmt.Body.List))
            if ifStmt.Else != nil {
                fmt.Printf("  Has else: %T\n", ifStmt.Else)
            }
            if ifStmt.Init != nil {
                fmt.Printf("  Has init: %T\n", ifStmt.Init)
            }
        }
        return true
    })
}
```

The `ast.IfStmt` structure:
```go
type IfStmt struct {
    If   token.Pos  // position of "if" keyword
    Init Stmt       // initialization statement (may be nil)
    Cond Expr       // condition (always non-nil; MUST be bool)
    Body *BlockStmt // "if" body
    Else Stmt       // else branch (may be nil)
}
```

---

## 14. Type Checker Implementation

The type checker (`cmd/compile/internal/typecheck`) ensures the condition is `bool`:

```go
// Simplified from cmd/compile/internal/types2/stmt.go
func (check *Checker) stmt(inner stmtContext, s syntax.Stmt) {
    switch s := s.(type) {
    case *syntax.IfStmt:
        // Check init statement
        if s.Init != nil {
            check.stmt(inner, s.Init)
        }
        // Check condition MUST be bool
        var x operand
        check.expr(&x, s.Cond)
        if x.mode != invalid {
            check.assignment(&x, Typ[Bool], "condition")
        }
        // Check body
        check.stmtList(inner, s.Then.List)
        // Check else
        if s.Else != nil {
            check.stmt(inner|elseContext, s.Else)
        }
    }
}
```

The `check.assignment(&x, Typ[Bool], "condition")` call is what produces:

```
./main.go:5:5: non-boolean condition in if statement
```

when you write `if myInt { }`.

---

## 15. Runtime Reflection of Conditions

Go's reflect package cannot directly inspect runtime conditions, but you can use `go/ast` for static analysis:

```go
package main

import (
    "go/ast"
    "go/parser"
    "go/token"
    "fmt"
)

// Count if statements in source code
func countIfStatements(src string) int {
    fset := token.NewFileSet()
    f, err := parser.ParseFile(fset, "", src, 0)
    if err != nil {
        return -1
    }

    count := 0
    ast.Inspect(f, func(n ast.Node) bool {
        if _, ok := n.(*ast.IfStmt); ok {
            count++
        }
        return true
    })
    return count
}

// Extract all conditions from if statements
func extractConditions(src string) []string {
    fset := token.NewFileSet()
    f, err := parser.ParseFile(fset, "", src, 0)
    if err != nil {
        return nil
    }

    var conditions []string
    ast.Inspect(f, func(n ast.Node) bool {
        if ifStmt, ok := n.(*ast.IfStmt); ok {
            // Format the condition as string
            conditions = append(conditions,
                fmt.Sprintf("%T", ifStmt.Cond))
        }
        return true
    })
    return conditions
}

func main() {
    src := `package main
func f(x, y int) {
    if x > 0 { }
    if x > 0 && y > 0 { }
    if err := doSomething(); err != nil { }
}`

    fmt.Println("If count:", countIfStatements(src))
    for _, c := range extractConditions(src) {
        fmt.Println("Condition type:", c)
    }
}

func doSomething() error { return nil }
```

---

## 16. Profile-Guided Optimization Internals

PGO in Go 1.20+ changes if-else compilation based on profiling:

```go
// Step 1: Build instrumented binary
go build -o app .

// Step 2: Run with profiling
// app produces cpu.pprof via runtime/pprof

// Step 3: Build with PGO
go build -pgo=cpu.pprof -o app_pgo .
```

What PGO does with if-else:

1. **Branch probability annotation**: The compiler annotates each branch with frequency data
   ```
   # Before PGO: compiler doesn't know which branch is hot
   If v4 -> b2 b3

   # After PGO: compiler knows b3 is hot (98% of calls)
   If v4 -> b2(probability=0.02) b3(probability=0.98)
   ```

2. **Code layout optimization**: Hot branch placed as fall-through
   ```asm
   # PGO-optimized: b3 (hot) falls through, b2 (cold) jumps
   TEST    condition
   JEQ     cold_branch    # jump to rare case
   hot_code...            # fall through (no jump needed)
   JMP     done
   cold_branch:
   cold_code...
   done:
   ```

3. **Inlining decisions**: Functions called in hot branches get higher inlining priority

4. **Devirtualization**: In hot if-else paths, interface calls may be devirtualized

```go
// Concrete devirtualization example
var w io.Writer = os.Stdout  // interface

// In hot path: PGO may detect w is always *os.File and optimize
if err != nil {
    fmt.Fprintln(w, err)  // may be devirtualized to direct call
}
```

The profiling data is stored in pprof format and parsed by `cmd/compile/internal/pgo`. The compiler reads `pgoprofile.Profile` and annotates the SSA graph with branch weights before optimization passes run.
