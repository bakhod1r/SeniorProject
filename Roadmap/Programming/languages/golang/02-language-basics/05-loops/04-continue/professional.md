# Go `continue` Statement — Professional Level

## 1. AST Representation

The Go parser represents `continue` as an `*ast.BranchStmt` node. Understanding this is essential when building linters, code generators, or refactoring tools.

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
    for i := 0; i < 10; i++ {
        if i == 5 { continue }
    }
}
`
    fset := token.NewFileSet()
    file, err := parser.ParseFile(fset, "", src, 0)
    if err != nil {
        panic(err)
    }

    ast.Inspect(file, func(n ast.Node) bool {
        branch, ok := n.(*ast.BranchStmt)
        if !ok {
            return true
        }
        fmt.Printf("BranchStmt at %v: Tok=%v Label=%v\n",
            fset.Position(branch.Pos()),
            branch.Tok,  // token.CONTINUE
            branch.Label, // nil if unlabeled
        )
        return true
    })
}
// Output:
// BranchStmt at :4:24: Tok=continue Label=<nil>
```

---

## 2. SSA Form: `continue` in `cmd/compile/internal/ssagen`

The compiler's SSA generation (`ssagen` package) transforms `continue` into a jump to the loop's continuation block. The key function is `state.stmt()` in `cmd/compile/internal/ssagen/ssa.go`:

```
// Simplified internal logic (from cmd/compile/internal/ssagen/ssa.go):
case *ir.BranchStmt:
    switch n.Op() {
    case ir.OCONTINUE:
        b := s.endBlock()                  // end current SSA block
        b.AddEdgeTo(s.continueTo)          // jump to continue target
        // continueTo is set when entering a for loop
    }
```

The `s.continueTo` field is set when the compiler enters a `for` loop's body and points to the post-statement block (the `i++` block for classic `for` loops).

---

## 3. Machine Code: `amd64` Assembly for `continue`

Given:
```go
func f(n int) int {
    s := 0
    for i := 0; i < n; i++ {
        if i%2 == 0 {
            continue
        }
        s += i
    }
    return s
}
```

The relevant assembly (simplified, amd64):
```asm
TEXT main.f(SB)
    MOVQ AX, CX         ; i = 0
    MOVQ $0, DX         ; s = 0
loop:
    CMPQ CX, BX         ; compare i < n
    JGE  done
    MOVQ CX, R8
    ANDQ $1, R8
    JZ   post           ; if i%2==0: jump to post (continue)
    ADDQ CX, DX         ; s += i
post:
    INCQ CX             ; i++
    JMP  loop
done:
    MOVQ DX, AX
    RET
```

The `JZ post` is the `continue` — a conditional jump directly to the post statement block.

---

## 4. Memory Model Implications

The Go memory model guarantees that all operations before a `continue` are visible within the same goroutine. There is no memory ordering concern with `continue` since it does not cross goroutine boundaries.

However, when loop variables are shared with goroutines launched inside the loop, `continue` can mask ordering bugs:

```go
// Classic loop variable capture bug — continue makes it harder to see
results := make([]<-chan int, 10)
for i := 0; i < 10; i++ {
    if i%2 == 0 {
        continue // i is still captured by reference in closures
    }
    i := i // shadow i to capture by value
    ch := make(chan int, 1)
    go func() { ch <- i * i }()
    results[i/2] = ch
}
```

The `continue` here doesn't change the variable capture semantics, but understanding the memory model is critical when reasoning about goroutines inside loops.

---

## 5. Escape Analysis: Detailed View

Use `-gcflags="-m -m"` for detailed escape analysis. The `continue` statement itself does not affect escape — only what you do with values before/after it matters.

```go
package main

type BigStruct struct {
    data [4096]byte
}

func processStructs(items []BigStruct) {
    for i := range items {
        if items[i].data[0] == 0 {
            continue // items[i] does NOT escape — we only read its address
        }
        consume(&items[i]) // this causes escape if consume stores the pointer
    }
}
```

Run: `go build -gcflags="-m" ./...` to verify.

---

## 6. Inliner Interaction

The Go inliner (`cmd/compile/internal/inline`) scores functions for inlinability. A function body containing `continue` is not penalized by the inliner — `continue` is a simple jump and does not increase the inliner's complexity budget.

The inliner's budget (default: 80 AST nodes) is what matters. A loop with many `continue` branches costs the same as a loop with equivalent `if-else` branches.

```go
// This function IS inlinable (low AST node count despite continue)
//go:nosplit
func sumPositive(data []int) int {
    s := 0
    for _, v := range data {
        if v <= 0 {
            continue
        }
        s += v
    }
    return s
}
```

Verify with: `go build -gcflags="-m=2" ./...` — look for `can inline sumPositive`.

---

## 7. Bounds Check Elimination (BCE)

The Go compiler performs BCE to eliminate redundant bounds checks. `continue` before an array access can affect BCE if the compiler cannot prove the index is valid:

```go
func process(data []int, mask []bool) {
    // BCE: compiler knows len(mask) == len(data) if we assert it
    if len(mask) != len(data) {
        panic("length mismatch")
    }
    for i := range data {
        if !mask[i] {
            continue // compiler still knows i < len(mask) due to range
        }
        _ = data[i] // BCE: no bounds check needed
    }
}
```

After the length check assertion, the compiler can prove both accesses are in bounds, eliminating checks for both `mask[i]` and `data[i]`.

---

## 8. Compiler Directives and `continue`

Compiler directives like `//go:nosplit` and `//go:noinline` apply to entire functions, not individual loop iterations. But `//go:linkname` and `//go:noescape` interact with `continue` indirectly:

```go
//go:nosplit
func hotPath(data []int32) int64 {
    // nosplit: stack cannot grow in this function
    // continue is safe — it's a simple jump, no stack growth
    var sum int64
    for _, v := range data {
        if v == 0 {
            continue
        }
        sum += int64(v)
    }
    return sum
}
```

`//go:nosplit` is common in runtime code where `continue` is used in tight scan loops.

---

## 9. Profiling `continue` Paths with `pprof`

CPU profiles show `continue` as a branch in the loop. To identify whether the `continue` branch is on the hot path:

```bash
# Generate CPU profile
go test -bench=BenchmarkProcess -cpuprofile=cpu.out ./...

# View annotated source
go tool pprof -source cpu.out

# View assembly with profile annotations
go tool pprof -disasm=processItems cpu.out
```

In the annotated assembly output, look for the JMP/JCC instruction corresponding to `continue`. If it has a high sample count, the branch is hot — consider branchless alternatives or reordering conditions.

---

## 10. Writing a `go/analysis` Pass to Detect `continue` Anti-Patterns

```go
package continuecheck

import (
    "go/ast"
    "go/token"
    "golang.org/x/tools/go/analysis"
    "golang.org/x/tools/go/analysis/passes/inspect"
    "golang.org/x/tools/go/ast/inspector"
)

var Analyzer = &analysis.Analyzer{
    Name:     "continuecheck",
    Doc:      "detects common continue anti-patterns",
    Requires: []*analysis.Analyzer{inspect.Analyzer},
    Run:      run,
}

func run(pass *analysis.Pass) (interface{}, error) {
    ins := pass.ResultOf[inspect.Analyzer].(*inspector.Inspector)

    nodeFilter := []ast.Node{(*ast.ForStmt)(nil), (*ast.RangeStmt)(nil)}

    ins.Preorder(nodeFilter, func(n ast.Node) {
        var body *ast.BlockStmt
        switch s := n.(type) {
        case *ast.ForStmt:
            body = s.Body
        case *ast.RangeStmt:
            body = s.Body
        }
        if body == nil || len(body.List) == 0 {
            return
        }
        // Check if last statement is continue
        last := body.List[len(body.List)-1]
        if branch, ok := last.(*ast.BranchStmt); ok {
            if branch.Tok == token.CONTINUE {
                pass.Reportf(branch.Pos(),
                    "useless continue: last statement in loop body")
            }
        }
    })

    return nil, nil
}
```

---

## 11. `continue` in `go/ssa` (Static Single Assignment Package)

The `golang.org/x/tools/go/ssa` package provides a higher-level SSA representation. `continue` becomes a `Jump` instruction:

```go
import "golang.org/x/tools/go/ssa"

func analyzeContinue(fn *ssa.Function) {
    for _, block := range fn.Blocks {
        for _, instr := range block.Instrs {
            jump, ok := instr.(*ssa.Jump)
            if !ok {
                continue
            }
            // Determine if this jump corresponds to a continue
            // by checking if the target is the loop's post block
            _ = jump.Block()
        }
    }
}
```

---

## 12. Runtime Stack Frame During `continue`

When `continue` executes, the goroutine's stack frame does not change — no new frame is pushed or popped. The instruction pointer simply moves to the post-statement block. This means:

- Local variables declared before `continue` remain on the stack (their values persist to the next iteration via the post block and condition check)
- Variables declared in the loop body (after their initialization but before `continue`) are technically still on the stack but are overwritten at the start of the next iteration

```go
for i := 0; i < n; i++ {
    x := computeExpensive() // x is on the stack frame
    if x < threshold {
        continue // x's stack slot is reused next iteration
    }
    use(x)
}
```

This is why Go does not need to "clean up" local variables per iteration — the stack frame is reused.

---

## 13. `continue` and the Garbage Collector

The GC does not treat `continue` specially. Stack scanning occurs at safe points (function calls, channel operations, certain memory operations), not at `continue`. In `//go:nosplit` functions, `continue` is safe because it does not involve any GC interactions.

If a loop iteration allocates and then `continue` is taken before the allocation is used, the GC will collect it at the next safe point:

```go
for _, item := range items {
    buf := make([]byte, 1024) // allocation
    if !item.NeedsBuffer() {
        continue // buf becomes immediately collectible
    }
    processWithBuffer(item, buf)
}
```

The GC handles this correctly — the `buf` slice header on the stack will be recognized as dead at the next safe point.

---

## 14. Debugging `continue` in `dlv` (Delve)

Using Delve to debug loops with `continue`:

```bash
dlv debug ./main.go
(dlv) break main.go:15  # breakpoint at the line with continue
(dlv) condition 1 i == 5  # only break when i == 5
(dlv) continue  # run until breakpoint
(dlv) locals    # inspect local variables
(dlv) next      # step over the continue — jumps to post statement
(dlv) stack     # view stack frame (does not change at continue)
```

Delve represents `continue` as a jump in the disassembly view. Use `(dlv) disassemble` to see the actual JMP instruction.

---

## 15. `continue` in WebAssembly Compilation (TinyGo)

When compiling Go to WebAssembly with TinyGo (LLVM backend), `continue` is lowered to a WASM `br` (branch) instruction targeting the loop header. The WASM binary representation:

```wasm
;; for i := 0; i < n; i++ { if cond { continue } body() }
(loop $loop
  (block $continue_target
    ;; condition check
    (br_if $loop (i32.ge_s (local.get $i) (local.get $n)))
    ;; cond
    (br_if $continue_target (call $cond))
    ;; body
    (call $body)
  )
  ;; post: i++
  (local.set $i (i32.add (local.get $i) (i32.const 1)))
  (br $loop)
)
```

The `br_if $continue_target` is the `continue` — it branches to the block end, falling through to the post statement.

---

## 16. Professional Summary: `continue` as a Language Primitive

| Layer | Representation |
|-------|----------------|
| Source | `continue` / `continue Label` |
| AST | `*ast.BranchStmt{Tok: token.CONTINUE, Label: *ast.Ident}` |
| IR (cmd/compile) | `ir.BranchStmt{Op: ir.OCONTINUE}` |
| SSA (internal) | `Jump` to `continueTo` block |
| Machine code (amd64) | `JMP` / conditional `Jcc` to post-statement label |
| Machine code (arm64) | `B` / `B.cond` to post-statement label |
| WASM (TinyGo) | `br` / `br_if` to loop block end |
| go/ssa package | `*ssa.Jump` to loop post block |
| Delve | Shows as jump in disassembly; `next` steps over it |
| pprof | Appears as branch instruction in CPU profile |
| go/analysis | `*ast.BranchStmt` with `Tok == token.CONTINUE` |
| BCE effect | Does not break BCE if condition is before the indexed access |
| Escape analysis | No effect on escapes — value usage patterns determine escape |
| Inliner | No penalty to inliner budget |
| GC | Dead allocations before `continue` collected at next safe point |
| Memory model | No ordering implications — same goroutine, sequential consistency |
