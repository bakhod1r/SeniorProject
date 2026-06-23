# Go Type Switch — Practice Tasks

## Instructions

Difficulty: 🟢 Easy, 🟡 Medium, 🔴 Hard, 🟣 Extra-hard. Each task includes a hidden hint and reference solution. Work through each before unfolding the solution.

---

## Task 1 🟢 — Classify JSON Values

Write `kind(v any) string` returning one of `"object"`, `"array"`, `"string"`, `"number"`, `"bool"`, `"null"`, or `"unknown"` based on what `encoding/json.Unmarshal` produces.

**Constraints**:
- Use a single type switch.
- Numbers in JSON decode to `float64` by default.
- Include `default`.

**Example**:
```go
kind(nil)                       // "null"
kind(map[string]any{})          // "object"
kind([]any{})                   // "array"
kind(true)                      // "bool"
kind(3.14)                      // "number"
kind("hi")                      // "string"
kind(make(chan int))            // "unknown"
```

<details>
<summary>Hint</summary>
JSON decodes into `bool`, `float64`, `string`, `[]any`, `map[string]any`, or `nil`. List each as a case.
</details>

<details>
<summary>Solution</summary>

```go
func kind(v any) string {
    switch v.(type) {
    case nil:
        return "null"
    case bool:
        return "bool"
    case float64:
        return "number"
    case string:
        return "string"
    case []any:
        return "array"
    case map[string]any:
        return "object"
    default:
        return "unknown"
    }
}
```
</details>

**Self-check**: Does `kind(json.Number("1"))` return `"unknown"` or `"number"`? Why?

---

## Task 2 🟢 — Sum Heterogeneous Numbers

Write `sumNumbers(values ...any) (float64, error)` that adds all values that are `int`, `int64`, or `float64`. Return an error if any value isn't one of those.

**Example**:
```go
sumNumbers(1, int64(2), 3.5)        // 6.5, nil
sumNumbers(1, "x", 2)               // 0, error
```

<details>
<summary>Hint</summary>
Iterate, type-switch each value, accumulate.
</details>

<details>
<summary>Solution</summary>

```go
import "fmt"

func sumNumbers(values ...any) (float64, error) {
    var total float64
    for _, v := range values {
        switch x := v.(type) {
        case int:
            total += float64(x)
        case int64:
            total += float64(x)
        case float64:
            total += x
        default:
            return 0, fmt.Errorf("unsupported type %T", v)
        }
    }
    return total, nil
}
```
</details>

**Self-check**: What if `int32` is passed? Should it be supported? Update the solution if so.

---

## Task 3 🟢 — Pretty-Print Any Value

Write `pretty(v any) string` that:
- For `nil`, returns `"null"`.
- For `bool`, returns `"true"` / `"false"`.
- For `int`, returns the decimal representation.
- For `string`, returns the value wrapped in double quotes with simple escaping (just `\"`).
- For `[]any`, returns `[a, b, c]` recursively.
- For other types, returns `fmt.Sprintf("%v", v)`.

<details>
<summary>Hint</summary>
Recurse for slices. Use `fmt.Sprintf` only as a last resort.
</details>

<details>
<summary>Solution</summary>

```go
import (
    "fmt"
    "strconv"
    "strings"
)

func pretty(v any) string {
    switch x := v.(type) {
    case nil:
        return "null"
    case bool:
        return strconv.FormatBool(x)
    case int:
        return strconv.Itoa(x)
    case string:
        return `"` + strings.ReplaceAll(x, `"`, `\"`) + `"`
    case []any:
        parts := make([]string, 0, len(x))
        for _, item := range x {
            parts = append(parts, pretty(item))
        }
        return "[" + strings.Join(parts, ", ") + "]"
    default:
        return fmt.Sprintf("%v", x)
    }
}
```
</details>

**Self-check**: Does `pretty([]any{1, "a", []any{true, nil}})` produce `[1, "a", [true, null]]`?

---

## Task 4 🟡 — AST Node Counter

Write `countNodes(src string) (map[string]int, error)` that parses Go source code and returns a count of each node-kind name (e.g., `"FuncDecl": 2`, `"CallExpr": 5`).

**Constraints**:
- Use `go/parser`, `go/ast`, `go/token`.
- Walk the AST; type-switch each node to extract the name.

<details>
<summary>Hint</summary>
Use `ast.Inspect`. Inside, type-switch on `n` and use `fmt.Sprintf("%T", n)` for the name (then trim the `*ast.` prefix).
</details>

<details>
<summary>Solution</summary>

```go
import (
    "go/ast"
    "go/parser"
    "go/token"
    "strings"
)

func countNodes(src string) (map[string]int, error) {
    fset := token.NewFileSet()
    f, err := parser.ParseFile(fset, "", src, 0)
    if err != nil {
        return nil, err
    }
    counts := map[string]int{}
    ast.Inspect(f, func(n ast.Node) bool {
        if n == nil {
            return false
        }
        // Manual type-switch for the most common kinds; fall back to %T.
        var name string
        switch n.(type) {
        case *ast.FuncDecl:
            name = "FuncDecl"
        case *ast.CallExpr:
            name = "CallExpr"
        case *ast.AssignStmt:
            name = "AssignStmt"
        case *ast.Ident:
            name = "Ident"
        case *ast.BasicLit:
            name = "BasicLit"
        default:
            tn := strings.TrimPrefix(strings.TrimPrefix(
                strings.TrimPrefix("(%T)", "(*"), "ast."), ")")
            _ = tn
            // Use printf-style %T for the actual type name:
            name = strings.TrimPrefix(stringType(n), "*ast.")
        }
        counts[name]++
        return true
    })
    return counts, nil
}

// helper to avoid importing fmt for one call
func stringType(n ast.Node) string {
    return /* fmt.Sprintf("%T", n) */ ""
}
```

A cleaner version drops the manual cases and uses `fmt.Sprintf("%T", n)` directly:

```go
import (
    "fmt"
    "go/ast"
    "go/parser"
    "go/token"
    "strings"
)

func countNodes(src string) (map[string]int, error) {
    fset := token.NewFileSet()
    f, err := parser.ParseFile(fset, "", src, 0)
    if err != nil {
        return nil, err
    }
    counts := map[string]int{}
    ast.Inspect(f, func(n ast.Node) bool {
        if n == nil {
            return false
        }
        name := strings.TrimPrefix(fmt.Sprintf("%T", n), "*ast.")
        counts[name]++
        return true
    })
    return counts, nil
}
```
</details>

**Self-check**: How would you make this *exhaustive* over node types — listing every kind, even if count is zero?

---

## Task 5 🟡 — Polymorphic Op Dispatcher

Define a sealed interface `Op` with three implementations: `AddOp{X, Y int}`, `MulOp{X, Y int}`, and `NegOp{X int}`. Write `eval(op Op) int` that returns the result via type switch.

**Constraints**:
- `Op` must be sealed (unexported method).
- `eval` uses a type switch with a default that panics.

<details>
<summary>Hint</summary>
The unexported method `op()` makes the interface sealed.
</details>

<details>
<summary>Solution</summary>

```go
package ops

import "fmt"

type Op interface{ op() }

type AddOp struct{ X, Y int }
type MulOp struct{ X, Y int }
type NegOp struct{ X int }

func (AddOp) op() {}
func (MulOp) op() {}
func (NegOp) op() {}

func eval(op Op) int {
    switch o := op.(type) {
    case AddOp:
        return o.X + o.Y
    case MulOp:
        return o.X * o.Y
    case NegOp:
        return -o.X
    default:
        panic(fmt.Sprintf("eval: unhandled op %T", op))
    }
}
```
</details>

**Self-check**: If you add `SubOp` without updating `eval`, what happens? Run with the `exhaustive` linter.

---

## Task 6 🟡 — Filter By Type

Write a generic `filterByType[T any](xs []any) []T` that returns all elements of `xs` whose dynamic type is exactly `T`.

**Example**:
```go
filterByType[int]([]any{1, "a", 2, "b", 3.0}) // [1, 2]
filterByType[string]([]any{1, "a", 2, "b"})   // ["a", "b"]
```

<details>
<summary>Hint</summary>
Comma-ok type assertion is enough — no need for a switch.
</details>

<details>
<summary>Solution</summary>

```go
func filterByType[T any](xs []any) []T {
    out := []T{}
    for _, x := range xs {
        if v, ok := x.(T); ok {
            out = append(out, v)
        }
    }
    return out
}
```
</details>

**Self-check**: Why doesn't this need a type switch? When would a switch be a better fit?

---

## Task 7 🟡 — Error Classifier

Write `classify(err error) string` that returns:
- `"timeout"` if `err` (possibly wrapped) is a `net.Error` and `Timeout()` returns true.
- `"path"` if `err` is a `*os.PathError`.
- `"eof"` if `errors.Is(err, io.EOF)`.
- `"nil"` if `err == nil`.
- `"other"` otherwise.

**Constraints**:
- Use `errors.As` for unwrapping where needed.
- Use a type switch only where it adds clarity.

<details>
<summary>Hint</summary>
`errors.As` walks the wrap chain; it's the right tool for `*os.PathError`. Use a type switch only when you need a multi-way branch on the top-level type.
</details>

<details>
<summary>Solution</summary>

```go
import (
    "errors"
    "io"
    "net"
    "os"
)

func classify(err error) string {
    if err == nil {
        return "nil"
    }
    var pathErr *os.PathError
    if errors.As(err, &pathErr) {
        return "path"
    }
    var netErr net.Error
    if errors.As(err, &netErr) && netErr.Timeout() {
        return "timeout"
    }
    if errors.Is(err, io.EOF) {
        return "eof"
    }
    return "other"
}
```
</details>

**Self-check**: Why is `errors.As` preferred over a type switch here?

---

## Task 8 🔴 — Tree Walker With Type Switch

Define an expression tree:

```go
type Expr interface{ expr() }
type Num struct{ V int }
type Add struct{ L, R Expr }
type Mul struct{ L, R Expr }
type Var struct{ Name string }
```

Write `eval(e Expr, env map[string]int) (int, error)` that evaluates the tree. Return an error if a `Var` references an undefined name.

<details>
<summary>Hint</summary>
Recurse via type switch. `Var` lookup fails if the name isn't in `env`.
</details>

<details>
<summary>Solution</summary>

```go
import "fmt"

type Expr interface{ expr() }
type Num struct{ V int }
type Add struct{ L, R Expr }
type Mul struct{ L, R Expr }
type Var struct{ Name string }

func (Num) expr() {}
func (Add) expr() {}
func (Mul) expr() {}
func (Var) expr() {}

func eval(e Expr, env map[string]int) (int, error) {
    switch x := e.(type) {
    case Num:
        return x.V, nil
    case Add:
        l, err := eval(x.L, env)
        if err != nil {
            return 0, err
        }
        r, err := eval(x.R, env)
        if err != nil {
            return 0, err
        }
        return l + r, nil
    case Mul:
        l, err := eval(x.L, env)
        if err != nil {
            return 0, err
        }
        r, err := eval(x.R, env)
        if err != nil {
            return 0, err
        }
        return l * r, nil
    case Var:
        v, ok := env[x.Name]
        if !ok {
            return 0, fmt.Errorf("undefined variable %q", x.Name)
        }
        return v, nil
    default:
        return 0, fmt.Errorf("unhandled expression %T", e)
    }
}
```
</details>

**Self-check**: Add a `Sub` node. What changes? Did the compiler help?

---

## Task 9 🔴 — Driver Value Adapter

Implement `toDriverValue(x any) (driver.Value, error)` matching `database/sql/driver`'s set of allowed values: `int64`, `float64`, `bool`, `[]byte`, `string`, `time.Time`, or `nil`. Convert `int`, `int32` to `int64`; convert `float32` to `float64`. Reject everything else.

<details>
<summary>Hint</summary>
Type switch with case blocks per source type, returning the converted value.
</details>

<details>
<summary>Solution</summary>

```go
import (
    "database/sql/driver"
    "fmt"
    "time"
)

func toDriverValue(x any) (driver.Value, error) {
    switch v := x.(type) {
    case int:
        return int64(v), nil
    case int32:
        return int64(v), nil
    case int64:
        return v, nil
    case float32:
        return float64(v), nil
    case float64:
        return v, nil
    case bool:
        return v, nil
    case []byte:
        return v, nil
    case string:
        return v, nil
    case time.Time:
        return v, nil
    case nil:
        return nil, nil
    default:
        return nil, fmt.Errorf("unsupported type %T", v)
    }
}
```
</details>

**Self-check**: How would you support `uint64` (which is too large to convert to `int64` losslessly)?

---

## Task 10 🔴 — Diff Two Heterogeneous Trees

Given two values produced by `json.Unmarshal` into `*any`, write `diff(a, b any) []string` returning a list of differences (paths and reasons). Recurse through `map[string]any` and `[]any`; report mismatched scalars and structural differences.

<details>
<summary>Hint</summary>
Type-switch on `a` and call recursively. Compare types first; if they differ, log "type mismatch". Then compare values per type.
</details>

<details>
<summary>Solution</summary>

```go
import "fmt"

func diff(a, b any) []string {
    return diffPath(a, b, "")
}

func diffPath(a, b any, path string) []string {
    if path == "" {
        path = "$"
    }
    
    // Type check first
    switch x := a.(type) {
    case map[string]any:
        y, ok := b.(map[string]any)
        if !ok {
            return []string{fmt.Sprintf("%s: type mismatch (object vs %T)", path, b)}
        }
        var out []string
        keys := unionKeys(x, y)
        for _, k := range keys {
            xv, xok := x[k]
            yv, yok := y[k]
            if !xok {
                out = append(out, fmt.Sprintf("%s.%s: missing in left", path, k))
                continue
            }
            if !yok {
                out = append(out, fmt.Sprintf("%s.%s: missing in right", path, k))
                continue
            }
            out = append(out, diffPath(xv, yv, path+"."+k)...)
        }
        return out
    case []any:
        y, ok := b.([]any)
        if !ok {
            return []string{fmt.Sprintf("%s: type mismatch (array vs %T)", path, b)}
        }
        var out []string
        if len(x) != len(y) {
            out = append(out, fmt.Sprintf("%s: length %d vs %d", path, len(x), len(y)))
        }
        n := len(x)
        if len(y) < n {
            n = len(y)
        }
        for i := 0; i < n; i++ {
            out = append(out, diffPath(x[i], y[i], fmt.Sprintf("%s[%d]", path, i))...)
        }
        return out
    default:
        if !equal(a, b) {
            return []string{fmt.Sprintf("%s: %v vs %v", path, a, b)}
        }
        return nil
    }
}

func equal(a, b any) bool {
    return fmt.Sprintf("%v %T", a, a) == fmt.Sprintf("%v %T", b, b)
}

func unionKeys(a, b map[string]any) []string {
    seen := map[string]struct{}{}
    var keys []string
    for k := range a {
        if _, ok := seen[k]; !ok {
            seen[k] = struct{}{}
            keys = append(keys, k)
        }
    }
    for k := range b {
        if _, ok := seen[k]; !ok {
            seen[k] = struct{}{}
            keys = append(keys, k)
        }
    }
    return keys
}
```
</details>

**Self-check**: How do you handle nested arrays of different lengths gracefully?

---

## Task 11 🔴 — Hot-Path Type Dispatch

Given a slice `[]any` of millions of elements, each one of `int`, `int64`, or `float64`, write `sum(xs []any) float64` minimizing per-element overhead.

**Constraints**:
- No `reflect`.
- Single pass.
- Profile if needed.

<details>
<summary>Hint</summary>
Order the most common case first. Avoid multi-type cases. Consider whether boxing dominates — if you control the input, you could use generics instead.
</details>

<details>
<summary>Solution</summary>

```go
func sum(xs []any) float64 {
    var total float64
    for _, x := range xs {
        switch v := x.(type) {
        case float64:  // assumed most common
            total += v
        case int:
            total += float64(v)
        case int64:
            total += float64(v)
        }
    }
    return total
}
```

If callers can pass `[]float64` directly, a generic version is far faster:

```go
func sumNumeric[T int | int64 | float64](xs []T) float64 {
    var total float64
    for _, x := range xs {
        total += float64(x)
    }
    return total
}
```
</details>

**Self-check**: Benchmark both versions. How much faster is the generic one? Where does the difference come from?

---

## Task 12 🟣 — Reusable Visitor

Write a generic visitor pattern. Define:

```go
type Visitor[N any] interface {
    Visit(n N)
}
```

Implement `Walk(root Node, v Visitor[Node])` for the expression tree from Task 8 (`Num`, `Add`, `Mul`, `Var`). The walker should call `v.Visit(node)` on each node, then recurse into children.

**Constraints**:
- Use a type switch inside `Walk` to handle children.
- The visitor itself must be reusable across runs.

<details>
<summary>Hint</summary>
`Walk(n)` calls `v.Visit(n)` and then for each child `c` calls `Walk(c, v)`. Inside, type-switch to find children.
</details>

<details>
<summary>Solution</summary>

```go
package main

import "fmt"

type Node interface{ node() }
type Num struct{ V int }
type Add struct{ L, R Node }
type Mul struct{ L, R Node }
type Var struct{ Name string }

func (Num) node() {}
func (Add) node() {}
func (Mul) node() {}
func (Var) node() {}

type Visitor interface {
    Visit(n Node)
}

func Walk(root Node, v Visitor) {
    if root == nil {
        return
    }
    v.Visit(root)
    switch n := root.(type) {
    case Num, Var:
        // leaves
    case Add:
        Walk(n.L, v)
        Walk(n.R, v)
    case Mul:
        Walk(n.L, v)
        Walk(n.R, v)
    }
}

type printer struct{ depth int }

func (p *printer) Visit(n Node) {
    fmt.Printf("%*s%T\n", p.depth*2, "", n)
}

func main() {
    tree := Add{L: Mul{L: Num{V: 2}, R: Var{Name: "x"}}, R: Num{V: 3}}
    Walk(tree, &printer{})
}
```
</details>

**Self-check**: How do you stop the walk early (e.g., stop after the first `Var`)?

---

## Task 13 🟣 — Sealed Type Switch With `exhaustive` Lint

Set up a small Go module that:
- Defines a sealed interface `Event` with 4 implementations.
- Has a function `handle(e Event)` with a type switch over them.
- Configures the `exhaustive` linter to flag missing cases.

Then add a fifth implementation and verify the linter catches the missing case.

<details>
<summary>Hint</summary>
Install `exhaustive` from https://github.com/nishanths/exhaustive. Add a `//exhaustive:enforce` comment above the interface declaration.
</details>

<details>
<summary>Solution</summary>

```go
//go:generate exhaustive -default-signifies-exhaustive=true ./...

package events

import "fmt"

//exhaustive:enforce
type Event interface{ event() }

type Login struct{ User string }
type Logout struct{ User string }
type Click struct{ Target string }
type Error struct{ Code int }

func (Login) event()  {}
func (Logout) event() {}
func (Click) event()  {}
func (Error) event()  {}

func handle(e Event) string {
    switch x := e.(type) {
    case Login:
        return "login: " + x.User
    case Logout:
        return "logout: " + x.User
    case Click:
        return "click: " + x.Target
    case Error:
        return fmt.Sprintf("error: %d", x.Code)
    default:
        return "unknown"
    }
}
```

Adding a fifth event:

```go
type Pageview struct{ Path string }
func (Pageview) event() {}
```

Running `exhaustive ./...` flags `handle` because `Pageview` is missing.
</details>

**Self-check**: What's the best location for `//exhaustive:enforce` — on the interface or on the switch?

---

## Task 14 🟣 — Convert a Heterogeneous Tree to Strings

Given a tree of `any` (nested `map[string]any` and `[]any` with scalar leaves), write `toStrings(root any) map[string]string` mapping every leaf path to a string representation.

**Example input**:
```go
{"a": 1, "b": [true, "hi", 3.0]}
```

**Example output**:
```go
{
    "a":     "1",
    "b[0]":  "true",
    "b[1]":  "hi",
    "b[2]":  "3",
}
```

<details>
<summary>Hint</summary>
Recurse, building paths. Use a type switch to decide between recursion and emitting a leaf.
</details>

<details>
<summary>Solution</summary>

```go
import (
    "fmt"
    "strconv"
)

func toStrings(root any) map[string]string {
    out := map[string]string{}
    walk(root, "", out)
    return out
}

func walk(v any, path string, out map[string]string) {
    switch x := v.(type) {
    case map[string]any:
        for k, val := range x {
            sub := k
            if path != "" {
                sub = path + "." + k
            }
            walk(val, sub, out)
        }
    case []any:
        for i, val := range x {
            walk(val, fmt.Sprintf("%s[%d]", path, i), out)
        }
    case string:
        out[path] = x
    case bool:
        out[path] = strconv.FormatBool(x)
    case float64:
        out[path] = strconv.FormatFloat(x, 'f', -1, 64)
    case int:
        out[path] = strconv.Itoa(x)
    case nil:
        out[path] = "null"
    default:
        out[path] = fmt.Sprintf("%v", x)
    }
}
```
</details>

**Self-check**: How do you handle a top-level scalar — is the path empty? Does the test cover it?

---

## Task 15 🟣 — Generic Polymorphic Adder

Write a function `add(a, b any) (any, error)` that adds two values if they're the same numeric or string type:
- `int + int = int`
- `int64 + int64 = int64`
- `float64 + float64 = float64`
- `string + string = string`
- Otherwise, error.

**Constraints**:
- Use one type switch, with a nested check for `b`'s type.
- Return a typed error mentioning both types.

<details>
<summary>Hint</summary>
Type-switch on `a`. In each case, comma-ok-assert `b` to the same type; if no match, error.
</details>

<details>
<summary>Solution</summary>

```go
import "fmt"

func add(a, b any) (any, error) {
    switch x := a.(type) {
    case int:
        if y, ok := b.(int); ok {
            return x + y, nil
        }
    case int64:
        if y, ok := b.(int64); ok {
            return x + y, nil
        }
    case float64:
        if y, ok := b.(float64); ok {
            return x + y, nil
        }
    case string:
        if y, ok := b.(string); ok {
            return x + y, nil
        }
    default:
        return nil, fmt.Errorf("unsupported type %T", a)
    }
    return nil, fmt.Errorf("type mismatch: %T + %T", a, b)
}
```
</details>

**Self-check**: How would you support `int + int64` by promoting? What's the trade-off in API simplicity?

---

## Difficulty Index

| # | Title | Difficulty |
|---|-------|------------|
| 1 | Classify JSON Values | 🟢 |
| 2 | Sum Heterogeneous Numbers | 🟢 |
| 3 | Pretty-Print Any Value | 🟢 |
| 4 | AST Node Counter | 🟡 |
| 5 | Polymorphic Op Dispatcher | 🟡 |
| 6 | Filter By Type | 🟡 |
| 7 | Error Classifier | 🟡 |
| 8 | Tree Walker With Type Switch | 🔴 |
| 9 | Driver Value Adapter | 🔴 |
| 10 | Diff Two Heterogeneous Trees | 🔴 |
| 11 | Hot-Path Type Dispatch | 🔴 |
| 12 | Reusable Visitor | 🟣 |
| 13 | Sealed Type Switch With Lint | 🟣 |
| 14 | Convert Heterogeneous Tree to Strings | 🟣 |
| 15 | Generic Polymorphic Adder | 🟣 |
