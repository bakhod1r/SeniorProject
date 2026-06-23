# Go Short Statement in If — Senior Level

## 1. Overview

The init form is purely a syntactic and scoping feature. There is no runtime closure, no allocation, no boxing. Senior-level mastery means understanding what the parser does with `if SimpleStmt; Expression { ... }`, how the AST represents it, how `cmd/compile/internal/types2` enforces the implicit block scope, and why the compiler does not optimize the form differently from a hoisted declaration. This document covers parser rules, AST shape, type-checker behavior, and the implicit-block resolution.

---

## 2. Grammar

The Go spec gives the production for `IfStmt`:

```
IfStmt = "if" [ SimpleStmt ";" ] Expression Block [ "else" ( IfStmt | Block ) ]
```

Three observations:
1. `SimpleStmt` is optional. If omitted, the `;` is omitted as well.
2. The `Expression` is required (a boolean expression).
3. The trailing `else` may be either another `IfStmt` (chained) or a plain `Block`.

`SimpleStmt` is defined as:

```
SimpleStmt = EmptyStmt | ExpressionStmt | SendStmt | IncDecStmt | Assignment | ShortVarDecl
```

Notice what is **excluded**: `Declaration`, `LabeledStmt`, `GoStmt`, `ReturnStmt`, `BreakStmt`, `ContinueStmt`, `GotoStmt`, `FallthroughStmt`, `Block`, `IfStmt`, `SwitchStmt`, `SelectStmt`, `ForStmt`, `DeferStmt`. None of these are valid in init position.

`SwitchStmt` and `ForStmt` reuse the same `SimpleStmt` form:

```
ExprSwitchStmt   = "switch" [ SimpleStmt ";" ] [ Expression ] "{" ... "}"
TypeSwitchStmt   = "switch" [ SimpleStmt ";" ] TypeSwitchGuard "{" ... "}"
ForClause        = [ InitStmt ] ";" [ Condition ] ";" [ PostStmt ]
```

`ForClause` requires both semicolons even when init or post are empty (`for ;cond; { ... }`).

---

## 3. AST Representation

`go/ast` defines:

```go
type IfStmt struct {
    If   token.Pos // position of "if"
    Init Stmt      // initialization statement; or nil
    Cond Expr      // condition
    Body *BlockStmt
    Else Stmt      // else branch; or nil
}
```

Key points:
- `Init` is a `Stmt` (interface), not a declaration node. A short variable declaration appears as `*ast.AssignStmt` with `Tok == token.DEFINE`.
- `Cond` is an `Expr` (interface).
- `Body` is always a `*BlockStmt`.
- `Else` is either `*IfStmt` (for `else if`), `*BlockStmt` (for plain `else`), or nil (no else).

Worked example. For:

```go
if v, ok := m[k]; ok {
    use(v)
}
```

The AST node is approximately:

```go
&ast.IfStmt{
    Init: &ast.AssignStmt{
        Lhs: []ast.Expr{
            &ast.Ident{Name: "v"},
            &ast.Ident{Name: "ok"},
        },
        Tok: token.DEFINE,
        Rhs: []ast.Expr{
            &ast.IndexExpr{
                X: &ast.Ident{Name: "m"},
                Index: &ast.Ident{Name: "k"},
            },
        },
    },
    Cond: &ast.Ident{Name: "ok"},
    Body: &ast.BlockStmt{
        List: []ast.Stmt{
            &ast.ExprStmt{
                X: &ast.CallExpr{
                    Fun: &ast.Ident{Name: "use"},
                    Args: []ast.Expr{&ast.Ident{Name: "v"}},
                },
            },
        },
    },
}
```

`Switch_statements` carry a parallel `Init` field:

```go
type SwitchStmt struct {
    Switch token.Pos
    Init   Stmt
    Tag    Expr
    Body   *BlockStmt
}

type TypeSwitchStmt struct {
    Switch token.Pos
    Init   Stmt
    Assign Stmt // x := y.(type) or y.(type)
    Body   *BlockStmt
}
```

The parser itself is straightforward — `parser.parseIfStmt` reads the `if` keyword, optionally parses a `SimpleStmt`, expects `;` if a SimpleStmt was present, then parses the condition expression and the block.

---

## 4. The Implicit Block

The Go spec (Block section) states:

> "Each 'if', 'for', and 'switch' statement is considered to be in its own implicit block."
> "Each clause in a 'switch' or 'select' statement acts as an implicit block."

This rule is what gives the init's variables their scope. Conceptually:

```go
if v := f(); cond { body } else { altBody }
```

is treated as:

```go
{                       // implicit block
    v := f()
    if cond { body } else { altBody }
}
```

with the proviso that `body` and `altBody` are themselves nested blocks within. So `v` is reachable in both branches and in the cond, and unreachable after the closing `}` of the implicit block.

This is enforced by the type checker (`go/types` and `cmd/compile/internal/types2`), which builds a `Scope` for the implicit block and seats the init's declared names there. Lookups inside body or else-branches walk parent scopes; `v` is found in the implicit block's scope. Lookups outside the chain skip past it.

---

## 5. Type Checker Behavior

`types2.checker.ifStmt` performs roughly:

```go
func (check *Checker) ifStmt(s *ast.IfStmt) {
    check.openScope(s, "if")
    defer check.closeScope()

    check.simpleStmt(s.Init)         // type-check init in this fresh scope
    check.expr(s.Cond)               // expects bool
    check.stmt(s.Body)               // body inherits scope
    if s.Else != nil {
        check.stmt(s.Else)           // else inherits scope
    }
}
```

(That sketch is paraphrased — the real implementation handles a few extra details like reassignment and unused-variable diagnostics.)

The crucial point: the scope is opened **before** the init and closed **after** the body and else. Names declared in the init live in this scope; names not used anywhere within trigger the standard `declared and not used` error.

For switch and for, the parallel functions `switchStmt`, `typeSwitchStmt`, and `forStmt` follow the same pattern.

---

## 6. Compiler Treats Init Identically to a Hoisted Declaration

The init form **does not** generate special code. After parsing and type-checking, the compiler lowers:

```go
if v := f(); cond {
    body
}
```

into the same intermediate representation as:

```go
{
    v := f()
    if cond {
        body
    }
}
```

The two forms produce identical SSA, identical machine code, and identical inlining behavior. The only difference is the scope analysis — which only matters if the rest of the function tries to reference the name.

A small experiment: compile

```go
package p

func a(x int) int {
    if y := x * 2; y > 10 {
        return y
    }
    return x
}

func b(x int) int {
    y := x * 2
    if y > 10 {
        return y
    }
    return x
}
```

with `go tool compile -S`. The two functions produce identical assembly (modulo function-name labels). The init form is purely a source-level convenience.

---

## 7. Scope Resolution Walkthrough

Take this code:

```go
package main

import "fmt"

func main() {
    x := 1
    if x := x + 1; x > 0 {
        fmt.Println("inner:", x) // 2
    }
    fmt.Println("outer:", x) // 1
}
```

What happens:

1. The outer `x := 1` adds `x` to `main`'s scope.
2. The `if` opens an implicit block scope.
3. `x := x + 1` is processed: the right side resolves `x` in the parent scope (outer x = 1). The left side declares a new `x` in the implicit block's scope, value `2`.
4. The condition `x > 0` resolves `x` in the implicit block (value `2`).
5. Inside the body, `x` resolves the same way (value `2`).
6. After the closing `}` of the body, the implicit block's scope is popped.
7. The next `fmt.Println("outer:", x)` resolves `x` in `main`'s scope (value `1`).

This is the mechanical reason the err-shadowing trap occurs: the inner `:=` always introduces a fresh name in the implicit block, regardless of whether a same-named variable exists in the outer scope. To assign to the outer name, the init must use `=`, not `:=` — and `=` is a `SimpleStmt` (Assignment), not a ShortVarDecl, so it is permitted in init position.

---

## 8. Mixing `:=` and `=` in Init

The grammar allows either:

```go
if x = compute(); x > 0 { ... }   // assignment to existing x
if x := compute(); x > 0 { ... }  // declaration of new x
```

Type checker handling:
- `Assignment`: requires all left-side names to already exist in scope (or be a `_`). No new variable is introduced. `x` outside the chain is mutated.
- `ShortVarDecl`: at least one name on the left must be new in the current scope. (For init scope, the "current scope" is the freshly-opened implicit block, which is empty before the init runs, so almost any name will be considered new.) All names on the left are bound in the implicit block.

This explains `:=` always shadows in init position: the implicit block scope is empty when the init runs, so all names on the LHS are new in that scope.

A subtle case: when the LHS contains both new and existing names, `:=` reuses the existing names instead of redeclaring them only if those names are in the **same** scope. In init position, the "same scope" is the implicit block, which is empty, so this rarely applies. To rebind existing names, prefer `=`.

---

## 9. The Switch-Init and For-Init Parallels

`SwitchStmt`, `TypeSwitchStmt`, and `ForStmt` open implicit blocks in the same way:

```go
switch x := f(); x.Kind() {
case A: ...
case B: ...
}
```

is conceptually:

```go
{
    x := f()
    switch x.Kind() {
    case A: ...
    case B: ...
    }
}
```

with each `case` body being a further nested block (the spec calls this the "implicit block of a clause"). `x` reaches every case but not after the switch.

For:
```go
for i := 0; i < n; i++ { body }
```
opens an implicit block where `i` lives, and the body itself is a nested block. After the loop, `i` is unreachable.

---

## 10. Why the Spec Allows This

A historical note: in the earliest Go drafts, condition statements were a single expression. The init form was added to make idiomatic error checks tighter — without polluting outer scope with single-use names. The Go authors describe the design in their commentary on `effective_go.md`:

> "Since if and switch accept an initialization statement, it's common to see one used to set up a local variable."

The feature is not strictly necessary — a programmer can always introduce a block manually:

```go
{
    err := op()
    if err != nil { return err }
}
```

But that requires four extra lines of explicit braces. The init form bakes this idiom into syntax.

---

## 11. Linter Implementation Detail

Tools like `staticcheck` walk the AST and inspect `*ast.IfStmt` nodes:

```go
func checkIfInit(s *ast.IfStmt, scope *types.Scope) {
    if s.Init == nil {
        return
    }
    // Find names declared in the init.
    if assign, ok := s.Init.(*ast.AssignStmt); ok && assign.Tok == token.DEFINE {
        for _, lhs := range assign.Lhs {
            // Look up in outer scope: shadow report.
            if id, ok := lhs.(*ast.Ident); ok {
                if scope.Lookup(id.Name) != nil {
                    report("init shadows outer %s", id.Name)
                }
            }
        }
    }
}
```

The actual linter code is more thorough but follows this idea. The lesson: the init's `Init` field is the natural anchor for shadow checks.

---

## 12. Walk Phases After Type-Checking

Once `cmd/compile/internal/types2` has finished checking, the IR walker (`cmd/compile/internal/walk`) lowers higher-level constructs. For an `*ir.IfStmt`, the walker:

1. Walks the init statement. This often reduces to standard assignment or call expressions.
2. Walks the condition expression.
3. Walks the body and the else branch.

Crucially, the walker does not introduce a new block boundary at the if. The init has already been desugared into the function-level block during a normalization pass. By the time SSA construction runs, the init's variables are ordinary locals, indistinguishable from any other.

Path through the compiler:

```
source -> parser -> *ast.IfStmt{Init, Cond, Body, Else}
        -> typecheck (types2) -> *ir.IfStmt with bound names
        -> walk -> linearized init + branch + body
        -> SSA -> ordinary block + branch
        -> regalloc -> machine code
```

The init form is a syntactic tree node from parser through walk; from SSA onward, it is gone.

---

## 13. Edge Cases in Type Checking

### 13.1 Init That Calls a Generic Function

```go
func first[T any](xs []T) (T, bool) {
    var zero T
    if len(xs) == 0 {
        return zero, false
    }
    return xs[0], true
}

func main() {
    nums := []int{1, 2, 3}
    if v, ok := first(nums); ok {
        fmt.Println(v)
    }
}
```

The type checker resolves the generic instantiation (`first[int]`) and assigns `v` type `int` and `ok` type `bool` in the if's implicit block. Init form does not interact with type inference — generic calls in init work like any other call site.

### 13.2 Init With Receive From Generic Channel

```go
func recvFirst[T any](ch <-chan T) (T, bool) {
    if v, ok := <-ch; ok {
        return v, true
    }
    var zero T
    return zero, false
}
```

The generic type parameter `T` flows through the comma-ok receive. `v` has type `T`. Standard inference.

### 13.3 Init With Method Value

```go
type counter struct{ n int }
func (c *counter) next() (int, error) {
    c.n++
    if c.n > 10 {
        return 0, errors.New("overflow")
    }
    return c.n, nil
}

func main() {
    var c counter
    if v, err := c.next(); err != nil {
        log.Fatal(err)
    } else {
        fmt.Println(v)
    }
}
```

`c.next` is a method value bound to `&c`. The init calls it; the result is bound in the if's implicit block. Same scope rules.

### 13.4 Init's Single-Return Expression

If the init is just `f()` (an `ExpressionStmt`, not a declaration), and `f` returns something, the result is discarded. The type checker accepts this; the compiler emits the call and drops the value.

```go
if logEvent("start"); ready { ... }
```

---

## 14. Why Spec Excludes `var` From SimpleStmt

A natural question: why not allow `if var x = 1; cond { ... }`? The spec lists `Declaration` and `SimpleStmt` as separate categories. `var x = 1` is a declaration; `x := 1` is a short variable declaration (a `SimpleStmt`).

Two reasons:

1. **Grammar simplicity.** Allowing `var` in init would force the parser to disambiguate between `var x = expr; cond` (a declaration init followed by a condition) and other forms. Restricting to `SimpleStmt` makes parsing local: a single statement, then `;`, then expression.

2. **Stylistic.** `var` declarations carry more syntactic weight (typed declarations, multiple variables, optional initializer). Init position is intended for terse single-statement uses; `var` is verbose.

The practical outcome is: use `:=` in init. If you need `var`, hoist.

---

## 15. Comparison With Other Languages

C and C++ allow declarations in `if` only since C++17:

```cpp
if (auto v = compute(); v > 0) { ... }
```

Before C++17, programmers used a manual block:

```cpp
{
    auto v = compute();
    if (v > 0) { ... }
}
```

Java has no equivalent — `if` does not accept an init form, so Java code requires the explicit hoisted declaration.

Rust's `if let` is conceptually similar but pattern-based:

```rust
if let Some(v) = compute() { ... }
```

Go's design is older than C++17's adoption and was directly motivated by tightening the err-check idiom. The C++17 form looks similar by design — it cites Go's influence in proposals.

---

## 16. Take-Aways

- The init form is parsed into `*ast.IfStmt.Init`, an arbitrary `Stmt` (usually `*ast.AssignStmt`).
- The implicit block created by `if/switch/for` defines the init's lifetime.
- Type checker enforces the lifetime; compiler emits identical IR to a hoisted declaration.
- `:=` in init always shadows; `=` rebinds existing names because the implicit block is initially empty.
- Switch and for share the same shape and the same scoping rules.
- Linters use the AST `Init` field to enforce style and catch shadowing.
- After SSA construction, the init form is invisible — it is purely a parser/typecheck-stage feature.
- `var` is excluded from init for grammar and style reasons; use `:=` instead.
- Generic calls and method values in init work like any other call site; the form does not interact with type inference.
