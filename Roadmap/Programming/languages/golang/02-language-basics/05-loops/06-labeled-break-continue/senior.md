# Go Labeled Break and Continue — Senior Level

## 1. Overview

Senior-level mastery of labelled `break`/`continue` means understanding the parser AST, the IR lowering, the validity rules that make labelled branches safer than `goto`, the SSA representation, and the compiler-emitted control-flow edges. The runtime cost is identical to plain `break`/`continue`. The interesting story is at compile time: scope checking, target-type validation, and the relationship to `goto`.

---

## 2. Advanced Semantics

### 2.1 Parser AST Representation

In `cmd/compile/internal/syntax/parser.go`, the parser produces:

- A `*ast.LabeledStmt` for each labelled statement, with fields `Label *Ident` and `Stmt Stmt`.
- A `*ast.BranchStmt` for each `break`/`continue`/`goto`/`fallthrough`, with fields `Tok` (the keyword) and `Label *Ident` (nil if unlabelled).

For the source:

```go
Outer:
for i := 0; i < 3; i++ {
    break Outer
}
```

The AST is approximately:

```
LabeledStmt {
    Label: Ident "Outer"
    Stmt: ForStmt {
        Init: AssignStmt i := 0
        Cond: BinaryExpr i < 3
        Post: IncDecStmt i++
        Body: BlockStmt {
            BranchStmt { Tok: BREAK, Label: Ident "Outer" }
        }
    }
}
```

The label and the branch are separate AST nodes; the type checker resolves the link.

### 2.2 Type Checking and Resolution

In `cmd/compile/internal/types2`:

1. The first pass collects all label declarations within the function.
2. The second pass walks branches and resolves each `Label` identifier:
   - For `break L`: `L` must label an enclosing `for`/`switch`/`select`.
   - For `continue L`: `L` must label an enclosing `for`.
   - For `goto L`: `L` must be on a labelled statement reachable forward, with restrictions on jumping over variable declarations.
3. After resolution, the checker reports unused labels.

Errors emitted at this stage:
- `label X already defined at ...`
- `label X not defined`
- `label X defined and not used`
- `invalid continue label X` (when L names switch/select)
- `invalid break label X` (when L is not for/switch/select)

### 2.3 Lowering in `cmd/compile/internal/walk/stmt.go`

After type checking, the walk pass lowers structured statements to lower-level IR:

- A labelled `for` becomes a labelled IR loop with a known "break-target" and "continue-target".
- A `break L` becomes an IR `OBREAK` with a pointer to the resolved label's break-target.
- A `continue L` becomes an IR `OCONTINUE` with a pointer to the resolved label's continue-target.

The IR carries the resolved targets; later passes treat them as ordinary control-flow edges.

### 2.4 SSA Representation

In SSA form, `break L` and `continue L` are simply unconditional jumps:

```
b1:                 // Outer for header
    cond = ...
    If cond goto b2 else b5

b2:                 // inner loop body
    cond2 = ...
    If cond2 goto b3 else b4

b3:                 // break Outer
    goto b5         // jumps directly to the "after Outer" block

b4:                 // continue Outer
    goto b1         // jumps to outer for header (or post)

b5:                 // after Outer
    ...
```

There is no special opcode for "labelled jump" — the IR resolves it to an edge to the proper basic block. Plain `break` and `break L` produce the same kind of edge; only the target differs.

### 2.5 Relationship to `goto`

Both `break L`, `continue L`, and `goto L` produce control-flow edges, but the spec imposes different validity rules:

| Construct | Allowed targets | Restrictions |
|-----------|-----------------|--------------|
| `break L` | enclosing for/switch/select | none beyond enclosing |
| `continue L` | enclosing for | none beyond enclosing |
| `goto L` | any labelled statement in same function | cannot jump into a block; cannot skip variable declarations in scope |

The `goto` restriction prevents jumping past variable initializations in a way that creates uninitialized state. `break L` and `continue L` cannot violate that rule by construction — they always jump to the start or end of an enclosing structured statement, never into the middle of an unrelated block.

This is why "labelled break" is preferred over `goto`: it is structurally guaranteed safe.

### 2.6 Defer Behavior

Like plain `break`/`continue`, a labelled branch does not bypass `defer`:

- `break L` runs all `defer`s for scopes left between the branch and the labelled statement's exit position.
- `continue L` runs `defer`s for scopes left between the branch and the labelled `for`'s body re-entry.

Specifically, only `defer`s registered in the function (and not yet executed) run when the function returns. `break L` does not return — so deferred calls registered in the function but outside the labelled loop continue to wait for return.

### 2.7 Interaction With `for-range` Loop Variable Semantics (Go 1.22+)

Each iteration of a `for-range` creates fresh iteration variables (Go 1.22+). `continue L` and `break L` interact normally:

- `continue L` causes the next iteration to allocate fresh iteration vars (under Go 1.22+ semantics).
- `break L` exits the labelled `for` entirely; no further iterations occur.

The labelled branch does not change capture semantics — it only changes which loop the branch targets.

---

## 3. Validity Rules in Detail

### 3.1 Unused Label

```go
Outer:
for i := 0; i < 3; i++ { _ = i }
// compile error: label Outer defined and not used
```

Rule: every label must be referenced by at least one branch.

This rule appears in `cmd/compile/internal/types2/labels.go`. The checker walks the function body, collects all label declarations, and verifies each has a use.

### 3.2 Multiple Definitions

```go
Outer:
for i := 0; i < 3; i++ { break Outer }
Outer: // ERROR: label Outer already defined
for j := 0; j < 3; j++ { break Outer }
```

Rule: each label name is unique within a function.

### 3.3 Wrong Target Type for `continue`

```go
Inner:
switch x {
case 1:
    continue Inner // ERROR: continue label not associated with for
}
```

Rule: `continue L` requires `L` to label a `for`.

### 3.4 Branch Out of Scope

```go
func helper() {
    break Outer // ERROR: label Outer not defined
}
```

Rule: branches resolve labels only in the same function.

### 3.5 Label On Non-targetable Statement

```go
Outer: { ... } // ERROR for break/continue use
```

A label on a block is allowed only as a `goto` target, and only for forward jumps obeying the `goto` rules.

---

## 4. Compiler Emission

### 4.1 Plain `break` vs. `break L`

The IR distinguishes them via the resolved target. The generated machine code is the same: an unconditional branch to a basic block.

In `cmd/compile/internal/walk/stmt.go`:

```go
// (sketch)
case OBREAK:
    if label != nil {
        target = labelMap[label].breakTarget
    } else {
        target = innerBreakTarget
    }
    emitGoto(target)
```

### 4.2 Plain `continue` vs. `continue L`

```go
// (sketch)
case OCONTINUE:
    if label != nil {
        target = labelMap[label].continueTarget
    } else {
        target = innerContinueTarget
    }
    emitGoto(target)
```

### 4.3 No Per-Branch Allocation

Labelled branches do not allocate. They are pure control-flow.

### 4.4 Inlining Considerations

A function containing labelled branches inlines normally if it meets the size budget. The labels are erased during inlining since they only exist for resolution; the resulting IR has no label nodes, only edges.

---

## 5. Production Patterns

### 5.1 `for { select { ... } }` Cancellation

The most common use of labels in production Go is the for-select shutdown:

```go
Loop:
for {
    select {
    case <-ctx.Done():
        return ctx.Err()
    case j, ok := <-jobs:
        if !ok {
            break Loop
        }
        if err := handle(j); err != nil {
            return err
        }
    }
}
```

The label is required because plain `break` inside `select` exits only the `select`. This pattern appears throughout the standard library and in major OSS Go services.

### 5.2 Search With Single Result

```go
Search:
for _, row := range grid {
    for _, v := range row {
        if v == target {
            result = v
            found = true
            break Search
        }
    }
}
```

Equivalent to extracting a helper function with `return v, true`. Use the helper if extraction does not pull in too many parameters.

### 5.3 Skip Outer Iteration on Sub-Item

```go
Group:
for _, g := range groups {
    for _, item := range g.Items {
        if !item.Valid() {
            continue Group
        }
    }
    process(g)
}
```

### 5.4 Multi-Reason Loop Exit

```go
Loop:
for {
    select {
    case <-deadline:
        reason = "timeout"
        break Loop
    case <-quit:
        reason = "user"
        break Loop
    case ev := <-events:
        if ev.Fatal {
            reason = "fatal"
            break Loop
        }
        handle(ev)
    }
}
```

Each `break Loop` records a different reason then exits.

---

## 6. Anti-Patterns

### 6.1 Flag Variable Instead of Label

```go
done := false
for _, row := range grid {
    for _, v := range row {
        if v == target {
            done = true
            break
        }
    }
    if done {
        break
    }
}
```

Replace with `break Search` after labelling the outer for.

### 6.2 Excessive Nesting

If your inner block uses few outer locals, extract:

```go
v, ok := find(grid, target)
```

Labels are not a cure for over-deep nesting.

### 6.3 Same Label Across Loops

Labels are unique within a function, but a tempting habit is reusing the name `Loop` everywhere. Use distinct names if there are multiple labelled loops in one function: `OuterScan`, `InnerSelect`, etc.

---

## 7. Concurrency Considerations

### 7.1 Labelled Break and `defer`

Defer remains tied to function exit. A `break L` does not run `defer`s registered in the function; they wait for `return`.

```go
func f() {
    defer cleanup1()
Loop:
    for {
        defer cleanup2() // INSIDE LOOP — bad practice
        break Loop
    }
    // cleanup2 not run yet — it runs at f's return
    fmt.Println("after loop")
    // f returns: cleanup2 then cleanup1 run
}
```

The `defer` registered inside the loop accumulates one entry. This is a known anti-pattern (defer-in-loop); labels do not change it.

### 7.2 Labelled Break In Goroutine Bodies

Labelled break works inside goroutine bodies normally. The label cannot reach into a parent goroutine's function scope. Each goroutine is its own function.

### 7.3 `for { select { ... } }` Race-Free Quit

```go
Loop:
for {
    select {
    case <-ctx.Done():
        break Loop
    case j := <-jobs:
        handle(j)
    }
}
```

The label causes a clean exit. Without it, the for would re-enter `select` infinitely. This is a correctness issue, not a performance one.

---

## 8. Memory and GC Interactions

### 8.1 No Memory Cost

Labels are compile-time constructs. They have zero runtime, allocation, or GC overhead.

### 8.2 Variable Escape Through the Branch

A `break L` does not cause variables to escape. Variables escape based on whether their addresses are taken or stored where the GC can see them. The labelled branch is purely control-flow.

---

## 9. Production Incidents

### 9.1 Infinite Loop From Missing Label

A service had:

```go
for {
    select {
    case <-ctx.Done():
        break // bug: only exits select
    case msg := <-events:
        handle(msg)
    }
}
```

On shutdown, the goroutine never exited. CPU stayed at 100%. Fix: label the for and use `break Loop`.

This is the single most common label-related bug in Go production code.

### 9.2 Unused Label Discovered in CI

A code change deleted a `break Outer` but left the `Outer:` declaration. The build broke immediately on `go build`:

```
./main.go:5: label Outer defined and not used
```

The error is friendly: it forces deletion of the label or restoration of the branch.

### 9.3 Refactoring Erased a Necessary Label

A developer extracted an inner block to a helper, replacing `break Search` with `return`. They then deleted the `Search:` label — but missed one `continue Search` elsewhere in the original function. Compile failed cleanly. Fix: also remove the orphan `continue Search`.

---

## 10. Best Practices

1. **Use labels for nested-loop early exit and `for-select` quit**.
2. **Capitalize label names** (`Outer`, `Loop`, `Search`).
3. **One label per loop** with a meaningful name.
4. **Place labels on their own line** above the targeted statement.
5. **Avoid flag variables** — labels are clearer.
6. **Avoid `goto`** unless forward error-handling demands it.
7. **Refactor when nesting exceeds three levels** — use helper functions.
8. **Comment label intent** when the reader cannot infer it.
9. **Test labelled paths** explicitly — they are easy to forget.
10. **Verify defer behavior** — defers registered in the loop body do not run on `break L`; they run on function return.

---

## 11. Reading the Compiler

Inspect the AST:

```bash
go run -gcflags="-W=2" main.go
```

This dumps the IR with branch targets resolved. You will see `OBREAK` and `OCONTINUE` nodes pointing at the resolved label.

Inspect SSA:

```bash
GOSSAFUNC=main go build .
# open ssa.html in a browser
```

The SSA view shows basic blocks and the edges produced by labelled branches.

Inspect assembly:

```bash
go build -gcflags="-S" main.go 2>asm.txt
```

Search for `JMP` instructions in the function — the labelled branch is one of them.

---

## 12. Self-Assessment Checklist

- [ ] I can describe the AST representation of a labelled statement
- [ ] I know which validity rules the type checker enforces for labels
- [ ] I can explain why `continue L` is restricted to `for` labels
- [ ] I can describe the SSA representation of a labelled branch
- [ ] I understand the relationship to `goto` and why `break L` is safer
- [ ] I know labels have zero runtime cost
- [ ] I know `defer` semantics around labelled branches
- [ ] I can debug an infinite loop caused by a missing label

---

## 13. Summary

Labels are compile-time markers on `for`/`switch`/`select`. The parser produces `*ast.LabeledStmt` and `*ast.BranchStmt` nodes; the type checker validates uniqueness, usage, and target type; the walk pass lowers branches to control-flow edges; SSA represents them as ordinary jumps. There is no runtime cost. The two most common production uses are nested-loop early exit and `for { select { } }` quit. Validity rules — unused labels rejected, `continue` only on `for`, function-scoped — keep the construct disciplined and prevent the broader class of bugs that `goto` can introduce.

---

## 14. Further Reading

- [Go Spec — Break statements](https://go.dev/ref/spec#Break_statements)
- [Go Spec — Continue statements](https://go.dev/ref/spec#Continue_statements)
- [Go Spec — Labeled statements](https://go.dev/ref/spec#Labeled_statements)
- [Go Spec — Goto statements](https://go.dev/ref/spec#Goto_statements)
- [`cmd/compile/internal/syntax/parser.go`](https://cs.opensource.google/go/go/+/refs/tags/go1.22:src/cmd/compile/internal/syntax/parser.go)
- [`cmd/compile/internal/walk/stmt.go`](https://cs.opensource.google/go/go/+/refs/tags/go1.22:src/cmd/compile/internal/walk/stmt.go)
- [`cmd/compile/internal/types2/labels.go`](https://cs.opensource.google/go/go/+/refs/tags/go1.22:src/cmd/compile/internal/types2/labels.go)
- 2.5.5 Goto
- 2.6 Functions
