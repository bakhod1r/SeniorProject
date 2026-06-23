# Go Specification: Short Statement in If

**Source:** https://go.dev/ref/spec#If_statements
**Sections:** If statements, Switch statements, For statements, Blocks, SimpleStmt

---

## 1. Spec Reference

| Field | Value |
|-------|-------|
| **Official Spec** | https://go.dev/ref/spec#If_statements |
| **Switch with init** | https://go.dev/ref/spec#Switch_statements |
| **Type switch with init** | https://go.dev/ref/spec#Type_switches |
| **For with init** | https://go.dev/ref/spec#For_statements |
| **SimpleStmt definition** | https://go.dev/ref/spec#Statements |
| **Block / Implicit block** | https://go.dev/ref/spec#Blocks |
| **Go Version** | Go 1.0 (the form has existed since the language's first release) |
| **Effective Go reference** | https://go.dev/doc/effective_go#if |

Official text from the spec:

> "If statements specify the conditional execution of two branches according to the value of a boolean expression. If the expression evaluates to true, the 'if' branch is executed, otherwise, if present, the 'else' branch is executed.
>
> The expression may be preceded by a simple statement, which executes before the expression is evaluated."

And from the Blocks section:

> "Each 'if', 'for', and 'switch' statement is considered to be in its own implicit block."
>
> "Each clause in a 'switch' or 'select' statement acts as an implicit block."

---

## 2. Definition

The **short statement in if** (also called the **if-init** form) is the optional simple statement that may appear immediately after the `if` keyword and before the boolean expression, separated by a semicolon. The form is:

```
if SimpleStmt ; Expression Block [ "else" ( IfStmt | Block ) ]
```

The init runs before the condition is evaluated. Variables introduced by the init via short variable declaration are scoped to the implicit block formed by the `if/else if/else` chain — visible inside the condition, body, every `else if`, and the final `else`, but not after the chain's closing brace.

---

## 3. Grammar

From the Go spec:

```
IfStmt = "if" [ SimpleStmt ";" ] Expression Block [ "else" ( IfStmt | Block ) ] .
```

Where `SimpleStmt` is:

```
SimpleStmt = EmptyStmt | ExpressionStmt | SendStmt | IncDecStmt | Assignment | ShortVarDecl .
```

Excluded from `SimpleStmt`:
- Declarations (`var`, `const`, `type`)
- Labeled statements
- `go`, `defer`
- `return`, `break`, `continue`, `goto`, `fallthrough`
- Block, IfStmt, SwitchStmt, SelectStmt, ForStmt

Switch statements parallel:

```
ExprSwitchStmt = "switch" [ SimpleStmt ";" ] [ Expression ] "{" { ExprCaseClause } "}" .
TypeSwitchStmt = "switch" [ SimpleStmt ";" ] TypeSwitchGuard "{" { TypeCaseClause } "}" .
```

For:

```
ForClause = [ InitStmt ] ";" [ Condition ] ";" [ PostStmt ] .
InitStmt  = SimpleStmt .
PostStmt  = SimpleStmt .
```

For-clause requires both semicolons even if init/condition/post are empty.

---

## 4. Core Rules & Constraints

### 4.1 Init Is Optional

```go
if cond { ... }              // no init
if x := f(); cond { ... }    // with init
```

When omitted, the leading `;` is omitted as well. The grammar requires `;` only when init is present.

### 4.2 Init Runs Before the Condition

```go
package main

import "fmt"

func main() {
    if x := 7; x > 5 {
        fmt.Println(x) // 7
    }
}
```

The init `x := 7` executes; then `x > 5` is evaluated; then the body runs.

### 4.3 Init Is a SimpleStmt — Not a Declaration

A `var x = 1` declaration is a `Declaration`, not a `SimpleStmt`, and is not allowed:

```go
if var x = 1; x > 0 { ... } // compile error: syntax error
```

Use `:=` (a `ShortVarDecl`, which is a `SimpleStmt`):

```go
if x := 1; x > 0 { ... }
```

### 4.4 Implicit Block Scope

The if statement defines an implicit block that contains the init's declarations. The body and every `else` branch are nested inside this implicit block. Names declared in init are visible inside the chain and only inside the chain.

```go
if v, ok := m[k]; ok {
    use(v) // v, ok visible
} else {
    fallback() // v, ok still visible
}
// v, ok out of scope
```

### 4.5 `:=` in Init Always Shadows

The implicit block is empty when the init runs. A short variable declaration in init introduces all names on the LHS into this fresh scope, regardless of any same-named variables in the surrounding scope.

```go
x := 10
if x := x + 1; x > 5 { // inner x shadows outer
    fmt.Println(x)     // 11
}
fmt.Println(x)         // 10 (outer untouched)
```

### 4.6 `=` in Init Reuses Existing Names

When the init uses `=` (an `Assignment`), no new variable is introduced. All names on the LHS must already exist in scope.

```go
var x int
if x = compute(); x > 0 { ... } // mutates outer x
```

This is the way to update an outer variable (e.g., a named return) from inside the init.

### 4.7 Multiple Names in Init

Multi-variable short declarations are allowed:

```go
if a, b := f(), g(); a > b { ... }
if v, ok := m[k]; ok { ... }
```

All declared names share the implicit block's scope.

### 4.8 Switch and Type Switch Init

Switch statements may have an init using the same syntax:

```go
switch x := f(); x {
case 1: ...
case 2: ...
}

switch x := f(); { // tagless switch
case x > 0: ...
case x < 0: ...
}

switch x := f(); v := x.(type) { // type switch
case int: ...
case string: ...
}
```

The init's variables are scoped to the switch's implicit block.

### 4.9 For Init

The for statement's init slot is a `SimpleStmt`:

```go
for i := 0; i < n; i++ { body }
for i := range items { body } // range form, no SimpleStmt slot
```

The init's variables are scoped to the for's implicit block (covering condition, body, post). For-clause requires both semicolons even if any of init/cond/post are empty.

### 4.10 Compiler Behavior

After parsing and type-checking, the compiler treats the init form as if the init were a separate statement preceding the if. SSA, register allocation, and machine code are identical to the hoisted form. There is no runtime cost or benefit; the form is purely syntactic.

---

## 5. Edge Cases

### 5.1 Init With No Useful Side Effect

A function call whose results are ignored is a legal init:

```go
if logEvent("start"); ready { ... } // legal; calls logEvent for side effect
```

But the spec restricts `ExpressionStmt` to function calls, method calls, and receive operations. A bare identifier or arithmetic expression is **not** a valid ExpressionStmt:

```go
x := 5
if x; x > 0 { ... } // compile error: x evaluated but not used
if x + 1; x > 0 { ... } // compile error: same reason
```

Avoid init forms whose only purpose is to call a function whose result is discarded — they hide whether the call mattered.

### 5.2 Empty Init

The grammar permits an empty `SimpleStmt`, but `gofmt` removes the leading `;` if empty. In practice, you never see `if ;cond { ... }`.

### 5.3 Increment/Decrement in Init

```go
if i++; i > 10 { ... } // legal
```

`i` must already be in scope. The `i++` runs as init, then condition is evaluated.

### 5.4 Send in Init

```go
if ch <- v; cond { ... } // legal
```

Sends to `ch`, then evaluates `cond`. Rare in practice.

### 5.5 Init in `else if`

```go
if a := 1; a > 0 {
    ...
} else if b := 2; a == 0 && b == 2 {
    ...
}
```

The `else if` opens its own nested implicit block. `b` is in scope for the `else if`'s condition, body, and any subsequent `else`/`else if`. `a` from the outer init is still in scope throughout.

### 5.6 Init With Function Call That Has No Result

```go
if f(); cond { ... } // legal (ExpressionStmt of a call)
```

Calls `f` for side effects, then evaluates `cond`. Rarely useful since you cannot capture the result without `:=`.

### 5.7 Init Variable Shadowed in Body

Inside the body, you can shadow the init variable with a deeper block:

```go
if v := 1; v > 0 {
    {
        v := 2
        fmt.Println(v) // 2 (inner shadow)
    }
    fmt.Println(v) // 1 (init's v)
}
```

Standard nested-scope behavior.

### 5.8 Init Cannot Reference Names From the Body

The init runs before the body, so it cannot reference names declared inside the body:

```go
if x := y; cond { y := 5; ... } // y must exist BEFORE the if
```

This is by definition — the body has not run yet.

### 5.9 Init Variables and Closures

A function literal inside the body that captures the init's variable does so by reference:

```go
if v := 5; cond {
    f := func() int { return v } // captures v by reference
    use(f)
}
```

If `f` escapes, `v` escapes too. The init form does not affect escape analysis differently from a hoisted declaration.

### 5.10 Init In a `select` Case Body

`select` cases do not have an init slot themselves, but you can nest an `if` with init inside:

```go
select {
case msg := <-ch:
    if v, ok := decode(msg); ok {
        handle(v)
    }
}
```

`msg` is bound by the case; `v, ok` are bound by the if-init. Two nested implicit blocks.

---

## 6. Type Rules

### 6.1 The Condition Must Be Boolean

The condition expression must be of type `bool`. Init does not change this:

```go
if x := 5; x { ... } // compile error: non-bool x
if x := 5; x > 0 { ... } // ok
```

### 6.2 Init's Variables Have Their Declared Types

Short declarations follow the standard type-inference rules:

```go
if v, ok := m[k]; ok { ... }
// v has the map's value type; ok is bool
```

Multi-return calls assign types per position:

```go
if data, err := os.ReadFile(p); err != nil { ... }
// data: []byte; err: error
```

### 6.3 Init's Names Cannot Conflict With Body Declarations

Inside the body, a re-declaration with `:=` opens a new inner scope:

```go
if x := 5; x > 0 {
    x := 10 // legal — new x in body scope
    fmt.Println(x) // 10
}
```

Or with `=` to mutate the init's `x`:

```go
if x := 5; x > 0 {
    x = 10 // mutates init's x
    fmt.Println(x) // 10
}
```

---

## 7. Related Specs

### 7.1 [If statements](https://go.dev/ref/spec#If_statements)

The primary reference. Defines the grammar, evaluation order, and scope of init.

### 7.2 [Switch statements](https://go.dev/ref/spec#Switch_statements)

Defines the parallel init form for `switch`. Same `SimpleStmt ;` shape.

### 7.3 [Type switches](https://go.dev/ref/spec#Type_switches)

Defines `switch x := y.(type) { ... }` and the optional init: `switch t := f(); v := t.(type) { ... }`.

### 7.4 [For statements](https://go.dev/ref/spec#For_statements)

Defines the for-clause `InitStmt ; Condition ; PostStmt`, which uses `SimpleStmt` for both init and post.

### 7.5 [Blocks](https://go.dev/ref/spec#Blocks)

Defines explicit and implicit blocks. The implicit block of an `if`, `switch`, or `for` is what scopes the init's variables.

### 7.6 [SimpleStmt](https://go.dev/ref/spec#Statements)

Defines `SimpleStmt = EmptyStmt | ExpressionStmt | SendStmt | IncDecStmt | Assignment | ShortVarDecl`.

### 7.7 [Short variable declarations](https://go.dev/ref/spec#Short_variable_declarations)

Defines `:=`. The init form's most common shape uses this.

### 7.8 [Assignments](https://go.dev/ref/spec#Assignments)

Defines `=`. Init form may use this to mutate existing variables.

### 7.9 [Effective Go: If](https://go.dev/doc/effective_go#if)

Style guide endorsement of the init form.

---

## 8. Version History

| Version | Change |
|---------|--------|
| Go 1.0 | If-init form present from initial release. Same for switch and for. |
| Go 1.0+ | No semantic changes to if-init. |
| Go 1.18 | Generics arrive but do not affect if-init syntax or scope. |
| Go 1.22 | Loop-variable per-iteration semantics — affects `for` only, not if-init. |

The if-init form has been stable since Go 1.0. Future Go versions are unlikely to change it; it is part of the language's core syntax.

---

## 9. Summary of Spec Rules

1. Init is optional. Grammar: `if SimpleStmt ; Expression Block [ else ... ]`.
2. Init must be a `SimpleStmt` — not a declaration, return, break, etc.
3. Init runs before the condition.
4. Init's `:=` creates names in the implicit block (always shadows outer).
5. Init's `=` mutates existing names (no new declaration).
6. Variables declared in init are visible across the entire if/else if/else chain and not after.
7. The same form exists in `switch`, `type switch`, and `for`.
8. Each clause of a `switch` or `select` is a further implicit block.
9. The condition must be of type `bool`.
10. Init form has no runtime cost difference vs a hoisted declaration.

These rules have been stable since Go 1.0 and are unlikely to change.

---

## 10. Spec Quotations Reference

A consolidated list of the exact spec text relevant to init form. All quotes are from `https://go.dev/ref/spec`.

### From "If statements"

> "If statements specify the conditional execution of two branches according to the value of a boolean expression. If the expression evaluates to true, the 'if' branch is executed, otherwise, if present, the 'else' branch is executed."

> "The expression may be preceded by a simple statement, which executes before the expression is evaluated."

### From "Switch statements"

> "Switch statements provide multi-way execution. An expression or type is compared to the 'cases' inside the 'switch' to determine which branch to execute."

> "Both a 'switch' statement and a 'type switch' statement may be preceded by a simple statement that executes before the expression is evaluated."

### From "For statements"

> "For statements with for clause have an init statement, a condition, and a post statement, all of which are optional."

### From "Blocks"

> "A block is a possibly empty sequence of declarations and statements within matching brace brackets."

> "In addition to explicit blocks in the source code, there are implicit blocks:
> 1. The universe block encompasses all Go source text.
> 2. Each package has a package block containing all Go source text for that package.
> 3. Each file has a file block containing all Go source text in that file.
> 4. Each 'if', 'for', and 'switch' statement is considered to be in its own implicit block.
> 5. Each clause in a 'switch' or 'select' statement acts as an implicit block."

The spec rule (4) is the foundation of init's scope; (5) is why each switch/select case has its own further nested scope.

### From "Statements" (SimpleStmt)

> "SimpleStmt = EmptyStmt | ExpressionStmt | SendStmt | IncDecStmt | Assignment | ShortVarDecl ."

This is the exhaustive list of what may appear in init position.

### From "Declarations and scope"

> "The scope of a constant or variable identifier declared inside a function begins at the end of the ConstSpec or VarSpec (ShortVarDecl for short variable declarations) and ends at the end of the innermost containing block."

For init form, the "innermost containing block" is the implicit block of the if/switch/for. This is what makes the init's variables die at the closing `}`.

---

## 11. Worked Spec Compliance Examples

### 11.1 Init Variable Cannot Escape Block

```go
package main

import "fmt"

func main() {
    if x := 1; x > 0 {
        fmt.Println(x)
    }
    // fmt.Println(x) -- compile error: undefined: x
}
```

Spec compliance: the implicit block ends at `}`; `x` was scoped to that block; references outside are unresolved.

### 11.2 Init Variable Visible In Else

```go
if x := 1; x > 0 {
    // x in scope
} else {
    // x still in scope here
    fmt.Println(x)
}
```

Spec compliance: the else clause is part of the if's implicit block; the init's declarations cover both branches.

### 11.3 Init Variable Visible In Else-If Chain

```go
if x := compute(); x > 5 {
    // x = result
} else if x > 0 {
    // x still visible
} else {
    // x still visible
}
```

Spec compliance: an else-if is parsed as another `IfStmt` nested inside the outer if's else clause. The outer if's implicit block contains everything; `x` is in scope throughout.

### 11.4 Multiple Levels of Init

```go
if a := 1; a > 0 {
    if b := 2; b > a {
        // a and b both visible
        fmt.Println(a, b)
    }
    // only a visible here
}
// neither visible
```

Spec compliance: each if has its own implicit block. The inner if's block is nested inside the outer's. Names are visible in their declaring block and any nested blocks.

### 11.5 Init Variable Shadowed Inside Body

```go
if x := 1; x > 0 {
    x := 100 // shadows init's x
    fmt.Println(x) // 100
}
```

Spec compliance: the body is a nested block. The body's `:=` introduces a new `x` in the body scope, shadowing the implicit block's `x`. After the body's closing `}`, the body scope ends; the init's `x` is reachable again (but the if has already finished, so this is moot).

---

## 12. Summary of Spec Rules

1. Init is optional. Grammar: `if SimpleStmt ; Expression Block [ else ... ]`.
2. Init must be a `SimpleStmt` — not a declaration, return, break, etc.
3. Init runs before the condition.
4. Init's `:=` creates names in the implicit block (always shadows outer).
5. Init's `=` mutates existing names (no new declaration).
6. Variables declared in init are visible across the entire if/else if/else chain and not after.
7. The same form exists in `switch`, `type switch`, and `for`.
8. Each clause of a `switch` or `select` is a further implicit block.
9. The condition must be of type `bool`.
10. Init form has no runtime cost difference vs a hoisted declaration.

These rules have remained stable since Go 1.0 and are unlikely to change in any future revision.
