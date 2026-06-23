# Go `goto` Statement — Professional Level

> This document explores `goto` at the compiler, runtime, and toolchain level — how it is represented internally, how it is validated, how it affects optimization, and how to build tools that detect and eliminate it.

---

## 1. AST Representation

The Go parser represents `goto` and its target label as two separate AST nodes:

```go
package main

import (
    "fmt"
    "go/ast"
    "go/parser"
    "go/token"
)

func main() {
    src := `package main
func f() {
    i := 0
loop:
    if i < 5 {
        i++
        goto loop
    }
}
`
    fset := token.NewFileSet()
    file, _ := parser.ParseFile(fset, "", src, 0)

    ast.Inspect(file, func(n ast.Node) bool {
        switch v := n.(type) {
        case *ast.BranchStmt:
            if v.Tok == token.GOTO {
                fmt.Printf("GOTO at %v → label: %q\n",
                    fset.Position(v.Pos()), v.Label.Name)
            }
        case *ast.LabeledStmt:
            fmt.Printf("LABEL %q at %v\n",
                v.Label.Name, fset.Position(v.Pos()))
        }
        return true
    })
}
// Output:
// LABEL "loop" at :4:1
// GOTO at :7:3 → label: "loop"
```

Key types:
- `*ast.BranchStmt{Tok: token.GOTO, Label: *ast.Ident{Name: "loop"}}` — the goto
- `*ast.LabeledStmt{Label: *ast.Ident{Name: "loop"}, Stmt: ...}` — the label target

---

## 2. Compiler Phase: Label Resolution in `go/types`

The `go/types` package resolves labels during type-checking. Labels in Go have their own scope (separate from the block scope of variables). The type checker:

1. Collects all labels in a function
2. Checks that each `goto` references a defined label
3. Checks that no `goto` jumps over a variable declaration in scope
4. Checks that no `goto` jumps into a block

```go
// From src/go/types/labels.go (simplified):
type jumpChecker struct {
    fset  *token.FileSet
    pkg   *Package
    scope *Scope
}

func (c *jumpChecker) checkGoto(s *ast.BranchStmt) {
    label := s.Label
    // Look up label in current function scope
    obj := c.scope.Lookup(label.Name)
    if obj == nil {
        c.pkg.errorf(s.Pos(), "undefined label %s", label.Name)
        return
    }
    // Check for variable declarations between goto and label
    c.checkJumpOverDecls(s, obj.(*LabelObj).stmt)
}
```

The "jump over variable declaration" check is the most complex: it walks all statements between the `goto` and the label, looking for `*ast.DeclStmt` nodes whose declared variables are in scope at the label.

---

## 3. SSA Generation: `goto` in `cmd/compile/internal/ssagen`

In the SSA generation phase (`ssagen/ssa.go`), `goto` is handled in `state.stmt()`:

```go
// Simplified from cmd/compile/internal/ssagen/ssa.go
case *ir.BranchStmt:
    switch n.Op() {
    case ir.OGOTO:
        // End the current SSA block with an unconditional jump
        b := s.endBlock()
        // jmpname maps label names to SSA blocks
        target := s.jmpname[n.Label.Sym()]
        if target == nil {
            // Forward reference: create placeholder, fill in later
            target = s.f.NewBlock(ssa.BlockPlain)
            s.jmpname[n.Label.Sym()] = target
        }
        b.AddEdgeTo(target)

    case ir.OLABEL:
        // Define the label's SSA block
        sym := n.Label.Sym()
        if target, ok := s.jmpname[sym]; ok {
            // Already referenced by a goto: start using this block
            s.startBlock(target)
        } else {
            // First mention: create new block
            block := s.f.NewBlock(ssa.BlockPlain)
            s.jmpname[sym] = block
            s.startBlock(block)
        }
    }
```

Forward references (goto to a label not yet seen) are handled by creating placeholder SSA blocks that are filled in when the label is encountered.

---

## 4. Machine Code: `goto` Generates `JMP`

```go
func gotoLoop() int {
    n := 0
    i := 0
loop:
    if i >= 10 { goto done }
    n += i
    i++
    goto loop
done:
    return n
}
```

amd64 assembly (`go build -gcflags="-S"`):
```asm
TEXT main.gotoLoop(SB)
    XORL  AX, AX        ; n = 0
    XORL  CX, CX        ; i = 0
.loop:
    CMPL  CX, $10       ; i >= 10?
    JGE   .done         ; if yes, goto done
    ADDL  CX, AX        ; n += i
    INCL  CX            ; i++
    JMP   .loop         ; goto loop
.done:
    MOVL  AX, "".~r0+8(SP)
    RET
```

Identical assembly to the equivalent `for` loop. The compiler collapses both to the same JMP/conditional-JMP pattern. The difference is entirely at the source level.

---

## 5. Escape Analysis and `goto`

The escape analyzer traces data flow through all paths, including `goto` jumps. Because `goto` creates non-standard control flow, the escape analyzer must handle it specially:

```go
func escapeWithGoto() *int {
    x := 5
    goto escape
    // unreachable, but x's address is taken below
escape:
    return &x // x escapes to heap
}
```

The escape analyzer correctly determines that `x` escapes, even though the only path to `return &x` is via `goto escape`. The analyzer uses the full CFG (including `goto` edges) to determine reachability and escape.

Verify: `go build -gcflags="-m" ./...`
Output: `x escapes to heap` ← correct.

---

## 6. Bounds Check Elimination (BCE) and `goto`

BCE relies on proving that array/slice indices are in bounds at compile time. For `for range` loops, the compiler knows the index is always `[0, len(slice))`. For `goto`-based loops, the compiler must perform general dataflow analysis:

```go
// goto loop — BCE may not apply
func sumGoto(arr []int) int {
    sum := 0
    i := 0
loop:
    sum += arr[i]   // bounds check: is i < len(arr)?
    i++
    if i < len(arr) { goto loop }
    return sum
}

// for range — BCE applies (compiler knows i is always in bounds)
func sumRange(arr []int) int {
    sum := 0
    for _, v := range arr {
        sum += v // no bounds check needed
    }
    return sum
}
```

Check with: `go build -gcflags="-d=ssa/check_bce/debug=1" ./...`
The `goto` version will show `boundCheck` annotations; the `range` version will not.

---

## 7. Loop Recognition for SIMD/Vectorization

The Go compiler's `loopbce` pass recognizes loop patterns for optimization. It specifically looks for `*ir.ForStmt` nodes. A `goto`-based loop expressed with `goto` is NOT recognized as a loop by `loopbce`:

```go
// NOT recognized as a vectorizable loop by loopbce
i := 0
loop:
    result[i] = a[i] + b[i]
    i++
    if i < n { goto loop }

// IS recognized as a vectorizable loop
for i := 0; i < n; i++ {
    result[i] = a[i] + b[i]
}
```

The second version may receive auto-vectorization passes on platforms with SIMD support. The `goto` version will not.

---

## 8. Stack Frame: Variables Skipped by `goto`

The Go compiler allocates stack space for all local variables declared in a function, regardless of reachability. This means variables in code skipped by `goto` still consume stack space:

```go
//go:noinline
func wasteStack() {
    goto skip
    var arr [10000]int // 80KB — allocated even though unreachable
    _ = arr
skip:
    return
}
```

The stack frame for `wasteStack` is 80KB+, even though `arr` is never initialized. This is because Go's variable lifetime analysis does not prune dead variables at the stack layout phase.

**Practical implication:** Avoid `goto skip` over large local variable declarations. The variables are allocated but useless.

---

## 9. `goto` and the Goroutine Stack Growth Protocol

In Go's goroutine model, each goroutine starts with a small stack (8KB) that grows as needed via stack copying. The stack growth mechanism checks for available stack space at function entry via the `runtime.morestack` mechanism.

`goto` within a function does not trigger stack growth checks — it is a simple jump within an already-allocated frame. However, `goto`-based loops that call functions will trigger growth checks at each function call, the same as `for`-based loops.

`//go:nosplit` functions (which must not grow the stack) can safely use `goto` as long as no function calls are made on any path through the function.

---

## 10. `goto` and the Go Memory Model

The Go memory model defines "happens-before" relationships for synchronization operations. `goto` does not introduce any synchronization:

```go
var x int

func f() {
    x = 1
    goto end
end:
    y := x // reads x — always sees 1 (same goroutine, sequentially consistent)
}
```

Within a single goroutine, all operations are sequentially consistent regardless of `goto`. The memory model guarantees intra-goroutine consistency. `goto` does not create any inter-goroutine visibility issues by itself.

---

## 11. `goto` in the `go/ssa` Package (x/tools)

The `golang.org/x/tools/go/ssa` package represents `goto` as direct edges in the CFG. A `goto` becomes an unconditional `*ssa.Jump` from the current block to the target block:

```go
import "golang.org/x/tools/go/ssa"

func analyzeGotos(fn *ssa.Function) {
    for _, block := range fn.Blocks {
        for _, instr := range block.Instrs {
            if jump, ok := instr.(*ssa.Jump); ok {
                // Determine if this was a goto or natural fallthrough
                // by checking if the jump target is the next block
                if jump.Block().Index+1 != block.Index {
                    // Non-sequential jump — likely a goto
                    fmt.Printf("potential goto: block %d → block %d\n",
                        block.Index, jump.Block().Index)
                }
            }
        }
    }
}
```

---

## 12. Building a `goto`-to-`for` Refactoring Tool

A basic automated refactoring using `go/ast` and `go/format`:

```go
package main

import (
    "bytes"
    "fmt"
    "go/ast"
    "go/format"
    "go/parser"
    "go/token"
)

// detectGotoLoop identifies simple goto-based loops:
// labelName: if cond { goto labelName }
// and returns the label name if found
func detectGotoLoop(fn *ast.FuncDecl) (string, bool) {
    var gotoLabel string
    ast.Inspect(fn, func(n ast.Node) bool {
        branch, ok := n.(*ast.BranchStmt)
        if !ok || branch.Tok != token.GOTO {
            return true
        }
        gotoLabel = branch.Label.Name
        return false
    })
    if gotoLabel == "" {
        return "", false
    }
    // Check if the label is before the goto (backward jump = loop)
    labelPos := -1
    gotoPos := -1
    ast.Inspect(fn, func(n ast.Node) bool {
        switch v := n.(type) {
        case *ast.LabeledStmt:
            if v.Label.Name == gotoLabel {
                labelPos = int(v.Pos())
            }
        case *ast.BranchStmt:
            if v.Tok == token.GOTO && v.Label.Name == gotoLabel {
                gotoPos = int(v.Pos())
            }
        }
        return true
    })
    return gotoLabel, labelPos < gotoPos // backward jump = loop
}

func main() {
    src := `package main
import "fmt"
func count() {
    i := 0
loop:
    if i >= 5 { return }
    fmt.Println(i)
    i++
    goto loop
}
`
    fset := token.NewFileSet()
    file, err := parser.ParseFile(fset, "", src, parser.ParseComments)
    if err != nil {
        panic(err)
    }

    for _, decl := range file.Decls {
        fn, ok := decl.(*ast.FuncDecl)
        if !ok { continue }
        if label, isLoop := detectGotoLoop(fn); isLoop {
            fmt.Printf("Function %q has a goto loop with label %q — consider refactoring to for loop\n",
                fn.Name.Name, label)
        }
    }

    var buf bytes.Buffer
    format.Node(&buf, fset, file)
    fmt.Println(buf.String())
}
```

---

## 13. `goto` Restriction Implementation in `cmd/compile`

The "cannot jump over variable declaration" restriction is implemented in `src/cmd/compile/internal/typecheck/typecheck.go`. The algorithm:

1. For each function, compute a map of `label → position`
2. For each `goto`, compute the range `[goto_pos, label_pos]`
3. Walk all variable declarations in the function
4. If a declaration is in the range AND its scope extends past the label, report an error

```go
// Simplified from cmd/compile/internal/typecheck/stmt.go
func checkGoto(stmt *ir.BranchStmt, decls []*ir.Decl) {
    gotoPos := stmt.Pos()
    labelPos := stmt.Label.Pos()

    if gotoPos < labelPos {
        // Forward goto: check for declarations between goto and label
        for _, d := range decls {
            if d.Pos() > gotoPos && d.Pos() < labelPos {
                if scopeContains(d.Scope, labelPos) {
                    base.ErrorfAt(stmt.Pos(),
                        "goto %v jumps over declaration of %v at %v",
                        stmt.Label, d.Name, d.Pos())
                }
            }
        }
    }
}
```

---

## 14. `go/vet` Internal: Why `goto` is Not Flagged

`go vet`'s job is to find provably incorrect code. `goto` itself is not incorrect — it can be used correctly. The restrictions (no variable declaration crossing, no block entry) are compile errors, not vet warnings.

`go vet` focuses on:
- Incorrect format strings
- Lock copying
- Unreachable code
- Misuse of `sync.Mutex`
- etc.

A `goto` that compiles is not a vet concern by default. This is a deliberate design decision: `vet` flags bugs, not style issues. For style-based `goto` detection, use `staticcheck` or a custom `go/analysis` pass.

---

## 15. Professional Summary: `goto` Across All Layers

| Layer | `goto` representation |
|-------|-----------------------|
| Source | `goto LabelName` / `LabelName:` |
| AST | `*ast.BranchStmt{Tok: token.GOTO}` + `*ast.LabeledStmt` |
| Type-check | Label resolution, var-declaration-crossing check, block-entry check |
| IR (cmd/compile) | `ir.BranchStmt{Op: ir.OGOTO}` |
| SSA (internal) | Unconditional `Jump` edge between SSA blocks |
| Optimization | goto loops NOT recognized by loopbce; BCE may not apply; SIMD not applied |
| Machine code (amd64) | Unconditional `JMP` instruction |
| Machine code (arm64) | Unconditional `B` instruction |
| go/ssa (x/tools) | `*ssa.Jump` to non-sequential block |
| Escape analysis | Correctly handles goto edges in CFG |
| Stack frame | Variables in skipped code still allocated |
| Memory model | No synchronization implications (intra-goroutine sequential) |
| GC | Conservative: variables in skipped code may be scanned |
| `go vet` | Not flagged (style, not correctness) |
| `staticcheck` | Can be configured to flag |
| Custom analysis | Use `go/analysis` pass detecting `*ast.BranchStmt{Tok: token.GOTO}` |
| go/format | Preserves `goto`; no automatic refactoring |
| Generated code | `goyacc` and similar tools emit `goto` legitimately |
| Runtime | Used in a few low-level functions; not a model for app code |
