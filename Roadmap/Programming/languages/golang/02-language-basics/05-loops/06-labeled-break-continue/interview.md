# Go Labeled Break and Continue — Interview Questions

## Table of Contents
1. [Junior Level Questions](#junior-level-questions)
2. [Middle Level Questions](#middle-level-questions)
3. [Senior Level Questions](#senior-level-questions)
4. [Scenario-Based Questions](#scenario-based-questions)
5. [FAQ](#faq)

---

## Junior Level Questions

**Q1: What is a label in Go?**

**Answer**: A label is an identifier followed by `:` that names a `for`, `switch`, or `select` statement. It allows `break` and `continue` to target a specific outer statement instead of the innermost one.

```go
Outer:
for i := 0; i < 3; i++ {
    for j := 0; j < 3; j++ {
        if i+j > 3 {
            break Outer
        }
    }
}
```

---

**Q2: What's the difference between `break` and `break Label`?**

**Answer**: A plain `break` exits the **innermost** enclosing `for`, `switch`, or `select`. A `break Label` exits the **labelled** statement, no matter how deeply nested the branch is.

```go
for i := 0; i < 3; i++ {       // Outer
    for j := 0; j < 3; j++ {   // Inner
        break       // exits Inner
        break Outer // exits Outer (and Inner along the way)
    }
}
```

---

**Q3: Can `continue` target a `switch` or `select`?**

**Answer**: No. `continue` requires a label that names a `for` loop. The reason is conceptual: `switch` and `select` have no notion of "next iteration" — they execute one case and exit. There is nothing to continue to.

```go
Inner:
switch x {
case 1:
    continue Inner // compile error
}
```

---

**Q4: What's the scope of a label in Go?**

**Answer**: A label is visible only inside the function in which it is declared. You cannot use `break Label` or `continue Label` from another function, including from goroutine bodies (which are separate functions).

```go
func main() {
Outer:
    for ... { ... }
}

func helper() {
    // break Outer // ERROR: label not in scope
}
```

---

**Q5: Why does Go disallow unused labels?**

**Answer**: To prevent stale labels from accumulating in the codebase. If a label is no longer referenced (perhaps because of a refactor), the compiler tells you immediately so you can either restore the branch or remove the label. This is the same philosophy as Go's "unused variables" and "unused imports" rules.

```go
Outer:
for i := 0; i < 3; i++ { _ = i }
// compile error: label Outer defined and not used
```

---

**Q6: When would you use a labeled break instead of a flag variable or refactor?**

**Answer**:
- **Use a labelled break** when you have nested loops and the inner block uses many outer locals (extraction would create a long parameter list), or when you have a `for { select { } }` loop that needs to exit on a signal.
- **Use a flag variable** — almost never. The label is shorter, faster (one less branch per outer iteration), and clearer.
- **Refactor into a function** when the inner block is self-contained, when it would benefit from its own name, or when extraction simplifies testing.

The order of preference: extracted helper > labelled break > flag variable.

---

**Q7: How do you exit a `for { select { ... } }` loop cleanly?**

**Answer**: Label the `for` and use `break Label`:

```go
Loop:
for {
    select {
    case <-quit:
        break Loop
    case j := <-jobs:
        handle(j)
    }
}
```

A plain `break` would exit the `select` only, leaving the `for` running. If the function ends with the loop, `return` is also a valid alternative.

---

## Middle Level Questions

**Q8: What's the difference between labeled break and goto?**

**Answer**: Both produce control-flow jumps, but they have different validity rules and intent:

- `break L` jumps to **the position immediately after** the labelled `for`/`switch`/`select`. It can only target an enclosing loop or switch/select.
- `continue L` jumps to **the next iteration** of the labelled `for`. It can only target an enclosing for.
- `goto L` jumps to **any** labelled statement in the same function, with restrictions (cannot jump into a block; cannot skip variable declarations).

`break`/`continue L` are structurally guaranteed safe. `goto` requires the spec's stricter rules to remain safe. Idiomatic Go prefers labelled break/continue and reserves `goto` for forward error-handling jumps that the structured forms cannot express.

---

**Q9: What happens to `defer` when you use `break Label`?**

**Answer**: `defer` is tied to **function** exit, not loop exit. A `break Label` does not run any deferred calls — they wait until the function returns.

```go
func f() {
    defer fmt.Println("function defer")
Loop:
    for i := 0; i < 3; i++ {
        defer fmt.Println("loop defer", i) // accumulates per iter
        if i == 1 {
            break Loop
        }
    }
    fmt.Println("after loop")
}
```

Output:
```
after loop
loop defer 1
loop defer 0
function defer
```

The deferred calls run on `return`, not on `break Loop`.

This is why `defer` inside a loop body is usually a bug.

---

**Q10: Can the same label name be used in two non-overlapping loops in one function?**

**Answer**: No. Labels are unique within a function regardless of position.

```go
func f() {
Outer:
    for i := 0; i < 3; i++ { break Outer }
Outer: // compile error: label already defined
    for j := 0; j < 3; j++ { break Outer }
}
```

Use distinct names: `First`, `Second`, etc.

---

**Q11: What's the convention for naming labels?**

**Answer**:
- Capitalize (`Outer`, `Loop`, `Search`).
- Keep them short — one or two words.
- Use a descriptive name when there are multiple labels in a function (`OuterScan`, `InnerSelect`).
- Place the label on its own line directly above the targeted statement.

This is style, not a language rule. The compiler accepts any identifier.

---

**Q12: Show how to break out of a nested loop with both a labelled break and an extracted function.**

**Answer**:

Labelled break:
```go
Search:
for _, row := range grid {
    for _, v := range row {
        if v == target {
            result = v
            break Search
        }
    }
}
```

Extracted function:
```go
result, ok := find(grid, target)

func find(grid [][]int, t int) (int, bool) {
    for _, row := range grid {
        for _, v := range row {
            if v == t {
                return v, true
            }
        }
    }
    return 0, false
}
```

Both are idiomatic. Choose based on whether the inner block is self-contained or shares many outer locals.

---

**Q13: Can you label any statement, or only `for`/`switch`/`select`?**

**Answer**: Any statement can have a label, but `break`/`continue` only work when the label names `for`/`switch`/`select`. A label on a block or arbitrary statement is only useful as a `goto` target.

```go
Outer: { fmt.Println("hi") } // legal as a goto target
break Outer // compile error: invalid break label
goto Outer  // legal (with goto's own restrictions)
```

---

**Q14: How does Go 1.22's loop variable change interact with labelled break/continue?**

**Answer**: It does not change the semantics of labels. `continue L` advances the labelled `for` to its next iteration, which under Go 1.22+ creates a fresh iteration variable per iteration. `break L` exits the labelled for entirely.

The only thing to remember is that Go 1.22+ closures inside the loop see distinct per-iteration variables, regardless of whether `break L` or `continue L` are used.

---

## Senior Level Questions

**Q15: What does the compiler do when it sees a labelled statement?**

**Answer**:
1. **Parser**: produces an `*ast.LabeledStmt` node with the label identifier and the targeted statement.
2. **Type checker** (`cmd/compile/internal/types2/labels.go`): validates uniqueness, builds a label map, resolves each `break`/`continue` to its target, and reports unused labels.
3. **Walk pass** (`cmd/compile/internal/walk/stmt.go`): lowers `OBREAK` and `OCONTINUE` IR nodes to control-flow edges pointing at the resolved targets.
4. **SSA pass**: represents each labelled jump as an unconditional edge between basic blocks.
5. **Code gen**: emits a `JMP` to the target's basic block.

Labels are entirely a compile-time construct. They have zero runtime cost.

---

**Q16: Why is `break Label` safer than `goto Label`?**

**Answer**: `break Label` can only target an **enclosing** `for`/`switch`/`select`. By construction, it cannot:
- Jump into the middle of an unrelated block.
- Skip variable declarations that other code depends on.
- Create unreachable code paths in surprising places.

`goto`'s validity rules try to prevent the same problems but are more complex and easier to misuse. `break`/`continue L` get correctness for free.

---

**Q17: Walk through the AST representation of `for { Outer: for { break Outer } }`.**

**Answer**:
```
ForStmt {
    Body: BlockStmt {
        LabeledStmt {
            Label: Ident "Outer"
            Stmt: ForStmt {
                Body: BlockStmt {
                    BranchStmt {
                        Tok: BREAK
                        Label: Ident "Outer"
                    }
                }
            }
        }
    }
}
```

The outer for has no label; the inner for has a `LabeledStmt` wrapper. The `BranchStmt` carries the label identifier. The type checker links the `BranchStmt.Label` to the `LabeledStmt.Label` it references.

---

**Q18: Do labels affect function inlining?**

**Answer**: No. Labels are erased during the walk pass; the resulting IR has only basic blocks and edges. Inlining decisions are based on size and shape, not on the presence of labels.

A function containing labelled branches inlines normally if the size budget allows.

---

**Q19: What's the runtime cost of `break Label` vs. `break`?**

**Answer**: Identical. Both produce an unconditional branch instruction. The compiler emits the same machine code; only the target differs. There is no allocation, no extra check, and no indirection.

Verify with `go build -gcflags="-S"` and compare the disassembly.

---

**Q20: What lint or static-analysis rules touch labels?**

**Answer**:
- The Go compiler itself rejects unused labels and labels with conflicting names.
- `staticcheck` SA5004 covers `for { select { default: } }` patterns that may interact with labelled break (the canonical labelled-break-from-select uses no `default:`).
- `revive` style rules suggest naming and placement conventions but do not have a dedicated label rule.
- `gocritic` may suggest replacing flag-variable simulations with labelled break.

The compiler does most of the heavy lifting.

---

## Scenario-Based Questions

**Q21: A code reviewer says "extract this labelled inner block into a helper". When should you push back?**

**Answer**: Push back when:
- The inner block uses many outer locals; extraction would force a long parameter list.
- The labelled jump signals a single early-exit path that does not have a meaningful name.
- The function is small enough that extraction adds noise without clarifying.

Accept the suggestion when:
- The inner block is self-contained.
- It deserves its own name (`find`, `validate`, `scanRow`).
- It would benefit from direct testing.
- Extraction makes the function under review noticeably shorter.

---

**Q22: A goroutine has `for { select { case <-quit: break } }` and now leaks on shutdown. How do you debug?**

**Answer**:
1. **Identify the leak**: `pprof` goroutine profile shows the worker goroutine is still alive after shutdown.
2. **Inspect the loop**: notice that `break` exits only the `select`, not the `for`. The for re-enters the select indefinitely.
3. **Fix**:
   ```go
   Loop:
   for {
       select {
       case <-quit:
           break Loop
       case ...
       }
   }
   ```
   Or use `return` from the function body.
4. **Verify**: run the same shutdown test and confirm the goroutine exits.

This is the most common label-related bug in Go production code.

---

**Q23: A function has three nested loops and four flag variables to control early exit. Refactor.**

**Answer**:

Before:
```go
func scan(d [][][]int, t int) (int, int, int, bool) {
    var gI, iI, jI int
    found := false
    for g, plane := range d {
        for i, row := range plane {
            for j, v := range row {
                if v == t {
                    gI, iI, jI = g, i, j
                    found = true
                    break
                }
            }
            if found { break }
        }
        if found { break }
    }
    return gI, iI, jI, found
}
```

After (extraction with direct `return`):
```go
func scan(d [][][]int, t int) (int, int, int, bool) {
    for g, plane := range d {
        for i, row := range plane {
            for j, v := range row {
                if v == t {
                    return g, i, j, true
                }
            }
        }
    }
    return 0, 0, 0, false
}
```

After (labelled break, if `return` is not appropriate):
```go
func scan(d [][][]int, t int) (g, i, j int, ok bool) {
Search:
    for g, plane := range d {
        for i, row := range plane {
            for j, v := range row {
                if v == t {
                    ok = true
                    break Search
                }
            }
        }
    }
    return
}
```

Both versions remove the four flag variables and three flag checks.

---

**Q24: A new team member adds a label inside an inner switch and uses `continue Label`. The compiler rejects it. Explain.**

**Answer**: `continue` requires a label on a `for`, not on a `switch` or `select`. A `switch` has no concept of "next iteration".

```go
Outer:
for i := 0; i < 3; i++ {
Inner:
    switch i {
    case 1:
        continue Inner // compile error
    }
}
```

Fix: move the label to the `for`, or use plain `continue` (which targets the innermost enclosing for):
```go
Outer:
for i := 0; i < 3; i++ {
    switch i {
    case 1:
        continue Outer
    }
}
```

---

## FAQ

**When would you use a labeled break instead of a flag variable or refactor?**

When extraction is awkward (the inner block uses many outer locals) and a flag variable would add noise. The labelled break is concise and faster (one less branch per outer iteration).

---

**Can `continue` target a switch label? Why or why not?**

No. A `switch` has no "next iteration" — it executes one case and exits. `continue` requires a `for` to advance to. The spec restricts `continue L` to `for` labels precisely for this reason.

---

**What's the scope of a label?**

Labels are function-scoped and visible only within the function in which they are declared. They cannot cross function boundaries (including goroutine bodies, which are separate anonymous functions).

---

**Why does Go disallow unused labels?**

To prevent stale labels from accumulating in the codebase, especially after refactors. The compiler enforces the rule at build time, mirroring the policy on unused variables and imports.

---

**What's the difference between labeled break and goto?**

- `break L` jumps to **after** the labelled `for`/`switch`/`select`. Restricted to enclosing structured statements.
- `continue L` jumps to **the next iteration** of the labelled `for`.
- `goto L` jumps to any labelled statement, with restrictions (cannot jump into a block, cannot skip variable declarations).

`break`/`continue L` are structurally safe; `goto` is more flexible but easier to misuse.

---

**Can I label a function, an `if`, or a regular block?**

You can place a label syntactically before any statement, but `break`/`continue` only work when the label is on `for`/`switch`/`select`. A label on a block or `if` is only useful as a `goto` target, and `goto` has its own restrictions.

---

**Are labels namespaced?**

No. Labels share a single namespace per function. There is no notion of nested label scopes for `break`/`continue`.

---

**Does `break Label` run `defer`s registered earlier?**

Only at function `return`. `break Label` is a control-flow jump, not a function exit. `defer`s wait for `return` to fire.

---

**Are labels visible to debuggers?**

Yes, the compiler includes label information in DWARF debug info so debuggers can step over labelled statements coherently.

---

**Can I label a goroutine call?**

You can place a label before a `go` statement, but the label is unused for `break`/`continue` purposes (a `go` statement is not a `for`/`switch`/`select`). The compiler will reject the label as "defined and not used".

---

**Does `break Label` work in a function that does not contain that label?**

No. The label must be declared in the same function. Cross-function jumps require return values, channels, or contexts.
