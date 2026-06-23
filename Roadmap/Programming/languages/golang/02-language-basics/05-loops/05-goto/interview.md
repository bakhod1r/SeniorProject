# Go `goto` Statement — Interview Questions

> **Note:** Interview questions about `goto` focus heavily on WHY it is discouraged, WHAT alternatives exist, and HOW to refactor it. Candidates who answer "use goto for X" without discussing alternatives will raise red flags.

---

## Junior Level Questions

---

### Q1. Does Go have a `goto` statement? Should you use it?

**Answer:**
Yes, Go has `goto`. You should almost never use it in application code. `goto` makes code harder to read, debug, and maintain by creating non-linear control flow. Go provides better structured alternatives:

- `for` loops instead of `goto`-based loops
- `return` instead of `goto` to error labels
- `defer` instead of `goto` to cleanup labels
- labeled `break` instead of `goto` to exit nested loops

The only legitimate use of `goto` in Go is in machine-generated code (like `goyacc` output) where a human would not read or maintain the code directly.

---

### Q2. What does this code print?

```go
func main() {
    fmt.Println("A")
    goto skip
    fmt.Println("B")
skip:
    fmt.Println("C")
}
```

**Answer:**
```
A
C
```

`goto skip` jumps directly to the `skip:` label, skipping `fmt.Println("B")`. Line B is unreachable code.

---

### Q3. What are the three main restrictions on `goto` in Go?

**Answer:**
1. **Same function:** The label must be in the same function as the `goto` — you cannot jump to a label in another function.
2. **No jumping over variable declarations:** If there is a variable declaration between the `goto` and the label, and the variable's scope includes the label, the `goto` is a compile error.
3. **No jumping into blocks:** `goto` cannot jump into an `if`, `for`, `switch`, or other block `{}`.

---

### Q4. What is the clean Go alternative to this code?

```go
func abs(n int) int {
    if n >= 0 {
        goto positive
    }
    n = -n
positive:
    return n
}
```

**Answer:**
```go
func abs(n int) int {
    if n < 0 {
        return -n
    }
    return n
}
```

The `goto` here is an unnecessarily complex way to write a simple conditional. Early return is clearer.

---

### Q5. Why does this code fail to compile?

```go
func f() {
    goto end
    x := 5
end:
    fmt.Println(x)
}
```

**Answer:**
Compile error: `goto end jumps over declaration of x`.

`goto end` would skip the declaration `x := 5`. But `x` is used at the label `end:` (in `fmt.Println(x)`). This would leave `x` in an undefined state. Go prevents this to avoid bugs.

---

### Q6. What does `go vet` say about `goto`?

**Answer:**
`go vet` does not flag `goto` usage by itself. It may catch related issues like unreachable code. The compile errors (jumping over declarations, jumping into blocks) are caught at compile time. For style-based detection of `goto`, use `staticcheck` or a custom linter.

---

### Q7. Refactor this function to not use `goto`:

```go
func sumTo(n int) int {
    sum := 0
    i := 1
start:
    if i > n { goto done }
    sum += i
    i++
    goto start
done:
    return sum
}
```

**Answer:**
```go
func sumTo(n int) int {
    sum := 0
    for i := 1; i <= n; i++ {
        sum += i
    }
    return sum
}
```

Or even simpler using the arithmetic formula: `return n * (n + 1) / 2`

The `for` loop version expresses the iteration bounds and increment in one line, making the intent immediately clear.

---

### Q8. Name two places in the Go ecosystem where `goto` IS legitimately used.

**Answer:**
1. **`goyacc`-generated parsers** — The `goyacc` tool generates Go code for LALR parsers, and the generated code uses `goto` for state machine transitions. These are not hand-written.
2. **The Go runtime** — In a few low-level functions in `src/runtime/`, `goto` is used for performance-critical paths that require precise control flow, particularly in the GC and scheduler.

---

## Middle Level Questions

---

### Q9. What is the primary historical argument against `goto`?

**Answer:**
Edsger W. Dijkstra's 1968 paper "Go To Statement Considered Harmful" argued that the "progress" of a program (where it is in execution and how it got there) should be derivable from the program's structure. `goto` breaks this by allowing arbitrary jumps that make it impossible to reason about the program state from its textual structure alone. Structured programming (sequences, selections, repetitions) was proposed as the alternative, enabling provably correct programs.

---

### Q10. Can `goto` jump into an `if` block? Show an example.

**Answer:**
No, `goto` cannot jump into a block. The following is a compile error:

```go
func f() {
    goto target // ERROR: goto target jumps into block
    if true {
target:
        fmt.Println("inside if")
    }
}
// Error: goto target jumps into block starting at line N
```

This restriction prevents scenarios where variables declared inside the block would be in scope but uninitialized.

---

### Q11. Why is `defer` preferred over `goto cleanup` for resource cleanup?

**Answer:**
Four reasons:

1. **Panic safety:** `defer` runs even if the function panics. `goto cleanup` is only reached via explicit jumps — a panic bypasses it.

2. **Future-proofing:** If new return paths are added to a function, `defer` handles them all automatically. `goto cleanup` requires the developer to manually add `goto cleanup` to every new early exit.

3. **Clarity:** `defer` at the top of a function makes the cleanup intent visible immediately. `goto cleanup` requires reading to the end to understand cleanup behavior.

4. **Multiple resources:** Multiple `defer` statements stack naturally. Multiple `goto cleanup` labels or multi-stage cleanup labels become complex quickly.

```go
// goto cleanup (fragile)
func f() error {
    r1 := acquire1()
    if err := use1(r1); err != nil { goto c1 }
    r2 := acquire2()
    if err := use2(r2); err != nil { goto c2 }
    r2.Release(); r1.Release()
    return nil
c2: r2.Release()
c1: r1.Release()
    return err
}

// defer (clear and safe)
func f() error {
    r1 := acquire1()
    defer r1.Release()
    if err := use1(r1); err != nil { return err }
    r2 := acquire2()
    defer r2.Release()
    if err := use2(r2); err != nil { return err }
    return nil
}
```

---

### Q12. What is "spaghetti code" and how does `goto` cause it?

**Answer:**
Spaghetti code is code where the control flow is so tangled and non-linear that it resembles a bowl of spaghetti — impossible to follow from top to bottom. `goto` causes this by allowing jumps to arbitrary points in the code, creating multiple entry and exit paths for the same block.

With `goto`, you cannot read a function top-to-bottom and understand its behavior. You must trace every possible jump to follow the logic. This makes:
- Code review difficult (reviewer must trace all paths)
- Refactoring dangerous (adding code near a `goto` may accidentally be bypassed)
- Testing complex (coverage paths are non-obvious)

---

### Q13. How would you handle this pattern in Go without `goto`?

```go
// Pattern: multi-step initialization with cleanup on failure
func setupServer() error {
    db, err := openDB()
    if err != nil { goto fail }

    cache, err := openCache()
    if err != nil { db.Close(); goto fail }

    worker, err := startWorker(db, cache)
    if err != nil { cache.Close(); db.Close(); goto fail }

    server.db = db
    server.cache = cache
    server.worker = worker
    return nil

fail:
    return err
}
```

**Answer:**
```go
func setupServer() error {
    db, err := openDB()
    if err != nil {
        return fmt.Errorf("open db: %w", err)
    }

    cache, err := openCache()
    if err != nil {
        db.Close()
        return fmt.Errorf("open cache: %w", err)
    }

    worker, err := startWorker(db, cache)
    if err != nil {
        cache.Close()
        db.Close()
        return fmt.Errorf("start worker: %w", err)
    }

    server.db = db
    server.cache = cache
    server.worker = worker
    return nil
}
```

Or using a cleanup tracker:
```go
func setupServer() (err error) {
    db, err := openDB()
    if err != nil { return }
    defer func() {
        if err != nil { db.Close() }
    }()

    cache, err := openCache()
    if err != nil { return }
    defer func() {
        if err != nil { cache.Close() }
    }()

    worker, err := startWorker(db, cache)
    if err != nil { return }

    server.db = db
    server.cache = cache
    server.worker = worker
    return nil
}
```

---

### Q14. Does `goto` have any performance advantage over `for` loops?

**Answer:**
No. A `goto`-based loop compiles to the same machine code as an equivalent `for` loop — both become a conditional jump and an unconditional jump back. However, `for` loops may receive additional compiler optimizations that `goto` loops do not:

- Loop unrolling (compiler recognizes `for` structure)
- Auto-vectorization (SIMD)
- Bounds check elimination (BCE via range analysis)
- `loopbce` pass (specifically looks for `*ir.ForStmt`)

A `goto` loop may miss these optimizations because the compiler does not always recognize the goto pattern as a loop.

---

## Senior Level Questions

---

### Q15. How does `goto` affect the SSA control flow graph in `cmd/compile`?

**Answer:**
In the `cmd/compile` SSA representation, `goto` generates an unconditional `Jump` edge from the current SSA block to the target block. This is identical to the edge generated by reaching the end of a for loop body and going back to the loop header.

The key difference: for `for` loops, the compiler knows during SSA construction that the edge is a back edge (a loop). For `goto` backward jumps, the compiler must analyze the CFG to determine the loop structure post-construction. Some optimization passes (like `loopbce`) require the loop structure to be identified, and `goto` loops may be missed.

Additionally, `goto` can create **non-reducible** CFGs (multiple-entry loops), which are significantly harder to optimize than reducible CFGs that `for` loops always produce.

---

### Q16. What is the "jumping over variable declaration" restriction at the compiler implementation level?

**Answer:**
The restriction is implemented in `cmd/compile/internal/typecheck` (and `go/types` for the `go/types` type-checker). The algorithm:

1. Build a map of all labels in the function → their positions and AST nodes
2. For each `goto`, determine the range `[goto_pos, label_pos]`
3. Walk all variable declarations in the function
4. If a declaration is at position `p` where `goto_pos < p < label_pos`, AND the declaration's scope extends past `label_pos`, report an error

The restriction ensures that every variable is always initialized before use. Without it, you could jump past `x := 5` and then use `x` with its zero value — which would be a subtle bug (the zero value might be a valid value, masking the bug).

---

### Q17. How would you build a `go/analysis` pass to detect `goto` in non-generated code?

**Answer:**
```go
var Analyzer = &analysis.Analyzer{
    Name:     "nogoto",
    Doc:      "reports goto in non-generated files",
    Requires: []*analysis.Analyzer{inspect.Analyzer},
    Run: func(pass *analysis.Pass) (interface{}, error) {
        ins := pass.ResultOf[inspect.Analyzer].(*inspector.Inspector)
        ins.Preorder([]ast.Node{(*ast.BranchStmt)(nil)}, func(n ast.Node) bool {
            b := n.(*ast.BranchStmt)
            if b.Tok != token.GOTO { return true }

            // Check if this is a generated file
            pos := pass.Fset.Position(b.Pos())
            if isGenerated(pass, pos.Filename) { return true }

            pass.Reportf(b.Pos(),
                "goto %s: use for/return/defer/break instead",
                b.Label.Name)
            return true
        })
        return nil, nil
    },
}

func isGenerated(pass *analysis.Pass, filename string) bool {
    for _, f := range pass.Files {
        if pass.Fset.File(f.Pos()).Name() != filename { continue }
        for _, comment := range f.Comments {
            for _, c := range comment.List {
                if strings.Contains(c.Text, "DO NOT EDIT") { return true }
            }
        }
    }
    return false
}
```

---

### Q18. In what scenario does `goto` appear legitimately in hand-written Go code?

**Answer:**
The most defensible case is a **state machine lexer or parser** where each state is clearly named and the transitions are direct jumps between states. Some argue this matches the formal definition of a finite state machine more directly than a `switch` + state variable approach.

However, even this case has better alternatives:
- `switch` + state enum (most readable)
- Table-driven parser (most extensible)
- Recursive descent (most composable)

In practice, if you encounter `goto` in hand-written Go code in a production codebase, it almost always indicates a problem that should be refactored, not a deliberate design choice.

---

### Q19. What postmortem lessons commonly emerge from `goto`-related bugs?

**Answer:**
Three recurring postmortem lessons from `goto`-related bugs in production systems:

1. **Code added between `goto` and label is silently bypassed.** A developer adds new logic (logging, metrics, validation) after a `goto` but before its target label, not realizing the `goto` skips it. Fix: eliminate `goto`; the structured alternative cannot be bypassed this way.

2. **Cleanup code (unlock, close, release) is skipped.** A `goto` jumps over a mutex unlock or file close, leaving the resource locked/open. Manifests as deadlocks or file handle exhaustion. Fix: use `defer` which cannot be bypassed.

3. **Loop variables and retry counters not updated before `goto` (backward jump).** A `goto` backward jump misses the counter increment, creating infinite loops. Manifests as 100% CPU usage and service unresponsiveness. Fix: use `for` which guarantees the post statement always runs.

---

## Scenario Questions

---

### Q20. A code review shows this function. How do you respond?

```go
func processRequest(r *Request) error {
    if !r.IsValid() {
        goto done
    }

    if err := authenticate(r); err != nil {
        goto done
    }

    if err := authorize(r); err != nil {
        goto done
    }

    return handleRequest(r)

done:
    return ErrRejected
}
```

**Answer:**
This code is functionally correct but should be refactored. The `goto done` pattern with a single error label is a common C idiom that is unnecessary in Go. The issues:

1. All error cases return the same generic `ErrRejected` — callers cannot distinguish invalid request from auth failure.
2. The `goto` adds cognitive overhead — readers must look for the label.
3. Adding new code between any `goto done` and `done:` accidentally creates unreachable code.

Suggested refactor:
```go
func processRequest(r *Request) error {
    if !r.IsValid() {
        return fmt.Errorf("processRequest: %w", ErrInvalidRequest)
    }
    if err := authenticate(r); err != nil {
        return fmt.Errorf("processRequest: authentication: %w", err)
    }
    if err := authorize(r); err != nil {
        return fmt.Errorf("processRequest: authorization: %w", err)
    }
    return handleRequest(r)
}
```

This is shorter, provides better error context, and uses idiomatic Go early returns.

---

### Q21. You are onboarding a C developer to Go. They write:

```go
func writeData(w io.Writer, data [][]byte) error {
    for _, chunk := range data {
        _, err := w.Write(chunk)
        if err != nil { goto fail }
    }
    return nil
fail:
    return err
}
```

How do you explain this and what do you suggest?

**Answer:**
"This is idiomatic C translated to Go. In Go, we handle this pattern differently. The `goto fail` is redundant because `return err` is directly available:

```go
func writeData(w io.Writer, data [][]byte) error {
    for _, chunk := range data {
        if _, err := w.Write(chunk); err != nil {
            return err
        }
    }
    return nil
}
```

This is shorter, cleaner, and idiomatic Go. In C, `goto fail` was useful for cleanup (free, close), but Go's `defer` handles cleanup automatically. You'll almost never need `goto` in Go."

---

### Q22. What output does this code produce, and what is the bug?

```go
func main() {
    i := 0
    goto check
loop:
    fmt.Println(i)
    i++
check:
    if i < 3 { goto loop }
    fmt.Println("done")
}
```

**Answer:**
Output:
```
0
1
2
done
```

This is actually a working (but convoluted) loop. The flow is:
- `goto check` → jumps to `check:` label
- `i < 3` → `goto loop` → prints 0, i++
- Check: `goto loop` → prints 1, i++
- Check: `goto loop` → prints 2, i++
- Check: `i >= 3` → falls through to `fmt.Println("done")`

The bug is not a logic error but a readability and maintainability problem. The equivalent, readable version:
```go
for i := 0; i < 3; i++ {
    fmt.Println(i)
}
fmt.Println("done")
```

---

## FAQ

---

### FAQ1. Is `goto` ever the "right" choice in Go?

Rarely, and almost always only in generated code. The only debated cases are:
- Generated parser code (`goyacc`)
- Direct ports of C code (as a temporary step before proper refactoring)
- Some argue for state machine lexers, but `switch` is cleaner

For all other cases: `for`, `return`, `defer`, and labeled `break` cover every legitimate use case.

---

### FAQ2. Can I use `goto` inside a goroutine?

Yes, `goto` works inside goroutines the same as in regular functions. The label must be in the same function (goroutine body). The same restrictions apply. The same "don't use it" advice applies.

---

### FAQ3. Does `goto` work with closures?

No — the label and `goto` must be in the **same** function. A `goto` inside a closure cannot target a label in the enclosing function.

```go
func outer() {
label:
    // ...
    f := func() {
        goto label // ERROR: undefined label label (not in inner func's scope)
    }
    _ = f
}
```

---

### FAQ4. Can two different `goto` statements jump to the same label?

Yes. Multiple `goto` statements can target the same label:

```go
func f(a, b bool) {
    if a { goto done }
    // work
    if b { goto done }
    // more work
done:
    cleanup()
}
// Still: use defer cleanup() and return instead
```

---

### FAQ5. What does `golangci-lint` report for `goto`?

By default, `golangci-lint` does not report `goto`. To enable `goto` detection, configure the `revive` linter with the `banned-characters` rule or write a custom rule. Many teams add a comment in their `.golangci.yml`:

```yaml
# Add custom analysis pass to detect goto:
linters:
  enable:
    - gocritic
linters-settings:
  gocritic:
    enabled-checks:
      - commentedOutCode # Not goto-specific, but catches commented goto
```

For strict `goto` prevention, a custom `go/analysis` pass is the most reliable approach.

---

### FAQ6. Is `goto` in Go faster than a `for` loop?

No. They compile to the same machine code. `for` loops additionally receive compiler optimizations that `goto` loops may not (BCE, vectorization, loop unrolling). `goto` is never faster and is often slower for hot loops due to missed optimizations.
