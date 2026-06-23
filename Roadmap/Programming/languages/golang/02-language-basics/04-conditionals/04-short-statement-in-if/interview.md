# Go Short Statement in If — Interview Questions

## Table of Contents
1. [Junior Level Questions](#junior-level-questions)
2. [Middle Level Questions](#middle-level-questions)
3. [Senior Level Questions](#senior-level-questions)
4. [Trap Questions](#trap-questions)
5. [FAQ](#faq)

---

## Junior Level Questions

**Q1: What is a short statement in `if`?**

**Answer**: It is a simple statement (most often a short variable declaration `x := f()`) placed before the boolean condition, separated by a semicolon: `if simpleStmt; cond { ... }`. The init runs first; then the condition is evaluated; then the appropriate branch executes. Variables declared in the init are scoped to the entire if/else chain.

```go
if x := compute(); x > 0 {
    fmt.Println("positive:", x)
}
```

---

**Q2: What's the scope of a variable declared in the if-init?**

**Answer**: It is scoped to the **implicit block** that wraps the entire if/else if/else chain. The variable is visible:
- Inside the condition
- Inside the body of the `if`
- Inside every `else if` condition and body
- Inside the final `else` body

It is NOT visible after the chain's closing `}`.

```go
if v, ok := m[k]; ok {
    use(v) // v in scope
} else {
    fallback() // v still in scope here too
}
// v out of scope here
```

---

**Q3: Why would you use this over a separate `:=` line?**

**Answer**: To tighten the variable's scope to exactly the lines that need it. This:
- Prevents the variable from being mistakenly read after the check.
- Avoids polluting the surrounding scope with single-use names.
- Makes the err-check pattern (`if err := op(); err != nil { ... }`) one tight phrase.
- Reads as a single thought: "do this, then test the result".

When the value is needed past the chain, use a separate declaration instead.

---

**Q4: Can you use any statement in the init?**

**Answer**: No. The init must be a `SimpleStmt`. Allowed:
- Empty statement
- Expression statement: `f(x)`
- Send: `ch <- v`
- IncDec: `i++`, `i--`
- Assignment: `x = 1`
- Short variable declaration: `x := 1`

Not allowed: `var x = 1`, `const`, `type`, `return`, `break`, `continue`, `goto`, `defer`, `go`, another `if`, `for`, `switch`, `select`.

---

**Q5: Why does it help with the err-shadowing problem?**

**Answer**: It depends — it can both **prevent** and **cause** the err-shadowing problem.

It **prevents** it when there is no surrounding `err` to shadow:
```go
func step1() error {
    if err := callA(); err != nil { return err }
    if err := callB(); err != nil { return err }
    return nil
}
```
Each `err` is fresh and lives only in its own if. There is no outer `err` to be confused with.

It **causes** it when an outer `err` exists and you accidentally use `:=` in the init:
```go
var err error
if err := callA(); err != nil { ... } // shadows outer
return err // outer err is still nil
```

The fix: either eliminate the outer `err`, or use `=` to assign to it (`if err = callA(); err != nil { ... }`).

---

**Q6: Can you declare multiple variables in if-init?**

**Answer**: Yes. The short variable declaration accepts multiple names on the LHS:

```go
if a, b := f(), g(); a > b { ... }
if v, ok := m[k]; ok { ... }
if data, err := os.ReadFile(p); err != nil { ... }
```

All declared names share the implicit block's scope. They all vanish after the chain's closing `}`.

---

**Q7: Is the same syntax allowed in `switch` and `for`?**

**Answer**: Yes.

- `switch`: `switch x := f(); x { case ... }` or `switch x := f(); { case cond1: ... }`. Type switch: `switch x := f(); v := x.(type) { case T: ... }`.
- `for`: `for i := 0; i < n; i++ { ... }`. The init is the first part of the three-part for clause.

The scope rules are parallel: init variables live in the implicit block of the surrounding statement and die at its closing `}`.

---

**Q8: Show the comma-ok form in if-init.**

**Answer**:

Map:
```go
if v, ok := m[k]; ok {
    use(v)
}
```

Type assertion:
```go
if s, ok := i.(string); ok {
    use(s)
}
```

Channel receive:
```go
if v, ok := <-ch; ok {
    use(v)
} else {
    // channel closed
}
```

---

## Middle Level Questions

**Q9: When would you avoid using if-init?**

**Answer**:
- When a value or error must outlive the chain.
- When the init has multiple statements or is heavy work that hurts readability.
- When the boolean condition is long and adding init makes a wide line.
- When the init has side effects that surprise readers (e.g., `state.counter++`).

In these cases, hoist the work above the if.

---

**Q10: What's the difference between `if x := f(); ...` and `if x = f(); ...`?**

**Answer**:
- `:=` declares a new variable in the implicit block. Always shadows any outer same-named variable.
- `=` is an assignment. Reuses an existing variable in scope. No new variable is introduced.

In init position, `=` is useful when you have a named return or outer variable you want to mutate:

```go
func work() (err error) {
    if err = step1(); err != nil { return }
    if err = step2(); err != nil { return }
    return
}
```

---

**Q11: Explain the err-shadowing trap with a code sample.**

**Answer**:

```go
func process() error {
    var err error
    for _, x := range items {
        if err := handle(x); err != nil {
            log.Println(err)
            continue
        }
    }
    return err // outer err is never written; always nil
}
```

The inner `err` shadows the outer. Real errors are logged but never surfaced via `return err`. To fix, either drop the outer `err` and propagate via another mechanism, or use `=`:

```go
for _, x := range items {
    if err = handle(x); err != nil {
        log.Println(err)
        continue
    }
}
return err
```

---

**Q12: Predict the output:**

```go
x := 10
if x := x + 1; x > 5 {
    fmt.Println("inner:", x)
}
fmt.Println("outer:", x)
```

**Answer**:
```
inner: 11
outer: 10
```

The init's `x := x + 1` reads outer `x` (10) and declares an inner `x` (11). The body uses inner. After the chain, the outer `x` is still 10.

---

**Q13: Show how if-init interacts with `defer`.**

**Answer**: A `defer` inside an if-branch is registered only if that branch executes:

```go
func use(path string) error {
    if f, err := os.Open(path); err != nil {
        return err
    } else {
        defer f.Close() // only registered if open succeeded
        return readAll(f)
    }
}
```

This works but is unusual. Most Go code splits the open and the defer to keep the defer at function-top level:

```go
f, err := os.Open(path)
if err != nil {
    return err
}
defer f.Close()
return readAll(f)
```

---

**Q14: Why does `if v, _ := m[k]; v > 0 { ... }` lose information?**

**Answer**: The comma-ok form distinguishes "absent" from "present-and-zero". Discarding `ok` with `_` collapses both into the same condition (`v == 0`). The check `v > 0` is true only for present-and-positive, which happens to coincide with what most callers want, but the intent is unclear and the missing case is silently treated as zero.

Better: `if v, ok := m[k]; ok && v > 0 { ... }`.

---

**Q15: What does `staticcheck` or `revive` enforce around if-init?**

**Answer**:
- `revive`'s `if-return` rule prefers `if err := op(); err != nil { return err }` over the split form when the value is unused later.
- `revive`'s `indent-error-flow` prefers early-return shapes that pair with init.
- `staticcheck` SA4006 catches dead writes, including outer `err` overwritten by an inner shadow without being checked.
- Other rules in `gocritic` and the deprecated `ifshort` historically suggested the form.

---

## Senior Level Questions

**Q16: How is the init form represented in the AST?**

**Answer**: As `*ast.IfStmt.Init`, an `ast.Stmt`. For `if v := f(); cond { ... }`, the `Init` is `*ast.AssignStmt{Tok: token.DEFINE, Lhs: [v], Rhs: [f()]}`. For `if v = f(); cond { ... }`, it is `*ast.AssignStmt{Tok: token.ASSIGN, ...}`. For an expression-statement init, it is `*ast.ExprStmt`. The grammar matches `SimpleStmt`.

`*ast.SwitchStmt` and `*ast.TypeSwitchStmt` carry parallel `Init` fields.

---

**Q17: How does the type checker enforce the implicit-block scope?**

**Answer**: When type-checking an `*ast.IfStmt`, the checker opens a new `Scope` before processing the init. The init's declared names are bound in this scope. The condition, body, and else branches are type-checked in this scope. After the else (or the body if no else), the scope is popped. Names declared in init are inaccessible to any code outside this implicit block.

`cmd/compile/internal/types2.checker.ifStmt` implements this. The `go/types` package has the same logic.

---

**Q18: Does the compiler optimize the init form differently from a hoisted declaration?**

**Answer**: No. After parsing and type-checking, the IR sees a sequence: init-statement, branch, body. This is identical to what the compiler produces for an explicit block:

```go
{
    v := f()
    if cond { body }
}
```

The two forms produce byte-identical assembly. Verify with `go tool compile -S`. The init form is purely syntactic and scope-related; the optimizer does not see the source-level structure.

---

**Q19: What is the relation between if-init and the implicit block?**

**Answer**: The Go spec says: "Each `if`, `for`, and `switch` statement is considered to be in its own implicit block." This implicit block is the parent scope of the body and any else branches. The init's declarations are placed in this implicit block. They live across the entire chain because every branch is nested inside the same implicit block.

Conceptually:
```
{ // implicit block
    INIT
    if COND { body } else if COND2 { body2 } else { body3 }
}
```

---

**Q20: How does the parser handle the optional init?**

**Answer**: `parser.parseIfStmt` reads the `if` keyword, then attempts to parse a `SimpleStmt`. If the next token after the simple statement is `;`, it consumes it and parses the condition. If there is no `;` after the simple statement, the parser treats the simple statement as the condition (a bare boolean expression). The parser uses lookahead to disambiguate; this is one of the few places in Go's grammar that requires non-trivial lookahead.

---

**Q21: Can you write `if x := f(); ; ` with a trailing semicolon?**

**Answer**: No. The grammar is `if SimpleStmt ; Expression Block`. The expression is required if a simple statement is present. You cannot omit the expression, and you cannot have two semicolons. Parsing this produces a syntax error.

(Contrast with `for`, which permits empty init/condition/post: `for ;cond; { ... }` or `for ;; { ... }`.)

---

**Q22: How does Go 1.22's loop variable change interact with if-init?**

**Answer**: Not at all directly. The loop-variable change applies only to `for` loops, where each iteration's variable is now distinct (under `go 1.22+` in `go.mod`). If-init's variable is created once per if execution; there is no "iteration" concept in if-init. The two features are independent.

If an if-init is **inside** a for loop, the init runs each iteration and produces a fresh variable each time — but that has always been the case, not a 1.22 change.

---

**Q23: Show the pattern for switch-init type switching.**

**Answer**:

```go
switch t := lookup(); v := t.(type) {
case int:
    fmt.Println("int:", v)
case string:
    fmt.Println("string:", v)
default:
    fmt.Println("other")
}
```

`lookup()` runs once. The type switch dispatches on the dynamic type of `t`. `v` has the specific type in each case. Both `t` and `v` live until the switch closes.

---

**Q24: How does `go/types` handle the conflict when init's `:=` reuses a name from the surrounding scope?**

**Answer**: The init's `:=` opens declarations in a freshly created implicit block. Because the implicit block is empty when the init runs, all names on the LHS are new in that scope. There is no conflict — the surrounding name is simply shadowed. If you wanted to assign to the outer name, you would use `=` instead of `:=`.

---

**Q25: When would you reach for switch-init over multiple if-init blocks?**

**Answer**: When several mutually exclusive cases dispatch on the same computed value. Switch-init computes once and shares; multiple if-init blocks would compute multiple times unless hoisted. Switch-init also reads more uniformly when there are 3+ branches and is preferred by linters (`gocritic`'s `ifElseChain`).

---

## Trap Questions

**Q26: Trap — The Named Returns Surprise.**

```go
func work() (n int, err error) {
    if n, err := compute(); err != nil {
        return n, err
    }
    return n, nil
}
```

What is wrong?

**Answer**: The init's `:=` introduces fresh inner `n` and `err`, shadowing the named returns. When the if-branch is taken, `return n, err` returns the inner names. When the if-branch is not taken (err == nil), the outer named returns are used — but the inner `n` (which had the real result) is gone. The function returns `(0, nil)` regardless of what `compute` actually computed.

Fix: use `=` to assign to the named returns:

```go
if n, err = compute(); err != nil {
    return n, err
}
return n, nil
```

---

**Q27: Trap — Multi-Var Init With One Reused Name.**

```go
n := 0
if n, err := f(); err != nil {
    log.Println(err)
}
fmt.Println(n) // ???
```

What does `fmt.Println` print?

**Answer**: It prints `0`. The init's `:=` declares **both** `n` and `err` in the implicit block (the implicit block is empty when init runs, so both names are fresh in it). The outer `n` is shadowed inside the if and unchanged outside. After the chain, the outer `n` is still `0`, regardless of what `f` returned.

If you wanted to update outer `n`, declare `err` separately or use `=`:

```go
n := 0
err := error(nil)
if n, err = f(); err != nil { ... }
```

---

**Q28: Trap — `else` After a Returning `if` Branch.**

```go
if v := f(); v > 0 {
    return v
} else {
    return -v
}
```

What is the lint complaint, and is it a bug?

**Answer**: It is not a bug — both branches return. But linters (`revive`'s `indent-error-flow`) prefer the flatter shape:

```go
if v := f(); v > 0 {
    return v
}
return -v
```

The `else` is redundant when the `if` returns. But removing the `else` also drops `v` out of scope sooner — if `v` is needed after the if, you must hoist:

```go
v := f()
if v > 0 {
    return v
}
return -v
```

---

**Q29: Trap — Init in `else if`.**

```go
if a := 1; a > 0 {
    fmt.Println("a:", a)
} else if b := 2; a == 0 && b == 2 {
    fmt.Println("b:", a, b)
}
```

What scope does `b` have?

**Answer**: `b` is declared in a **second** implicit block, nested inside the first. It is in scope for the `else if`'s condition, body, and any subsequent `else if` / `else` of that nested chain. After the entire outer chain's closing `}`, both `a` and `b` are gone.

The trap: people sometimes assume `b` is local only to the `else if` body, but it is also visible in any later `else` on the same nesting level.

---

**Q30: Trap — Combining `if` and `defer`.**

```go
func read(path string) ([]byte, error) {
    if f, err := os.Open(path); err != nil {
        return nil, err
    } else {
        defer f.Close()
        return io.ReadAll(f)
    }
}
```

What is the issue?

**Answer**: It is correct but unidiomatic. The `defer f.Close()` runs at function return — that is fine. The reason most Go code splits this:

```go
f, err := os.Open(path)
if err != nil {
    return nil, err
}
defer f.Close()
return io.ReadAll(f)
```

is that the deferred call sits at function-top level, where readers expect cleanup. Tucking `defer` inside an `else` works but reads awkwardly and looks like the close is conditional (it is, but only on the success path that you usually want anyway).

---

## FAQ

**Q: Is the init form mandatory?**

**A**: No. It is always optional. Code without init form is equally valid Go.

**Q: Can the init be empty?**

**A**: Effectively, no — if you write `if ;cond { ... }`, the parser accepts the empty simple statement, but `gofmt` removes it. The convention is to omit the init entirely if you have nothing for it.

**Q: Can I declare a `var` in init?**

**A**: No. `var` is a `Declaration`, not a `SimpleStmt`. Use `:=` instead.

**Q: Can I have multiple statements in init?**

**A**: No. The init is a single `SimpleStmt`. Use multiple lines outside the if for multi-statement setup.

**Q: Does init form run if the condition short-circuits?**

**A**: The init runs first, always (when the if is reached). The condition is then evaluated. Short-circuiting applies inside the condition (e.g., `a && b`), not between init and condition.

**Q: Does the init see `defer` from the surrounding function?**

**A**: The init is executed normally; surrounding `defer`s are registered to fire at the surrounding function's return. The init itself does not register any defer.

**Q: Can `defer` be used in init?**

**A**: No. `defer` is not a `SimpleStmt`.

**Q: What about `go`?**

**A**: Same — `go` is not a `SimpleStmt` and cannot appear in init.
