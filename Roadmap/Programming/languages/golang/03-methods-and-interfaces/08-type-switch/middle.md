# Go Type Switch — Middle Level

## 1. Overview

Past the basic syntax, a type switch is a dispatch mechanism comparable to virtual method calls — except the dispatch is written explicitly in the caller. Middle-level mastery means choosing between three closely related tools: type assertion, type switch, and method-based polymorphism. It also means recognising the standard-library patterns where type switches are mandatory (AST walking, JSON decoding, driver value adaption) and the patterns where they are smell.

---

## 2. Type Switch vs Type Assertion vs Methods

### 2.1 Type Assertion `x.(T)`

Single test, two forms:

```go
v := x.(int)            // panics if x's dynamic type isn't int
v, ok := x.(int)        // ok = false on mismatch; v = zero T
```

The comma-ok form is the safe variant. Use it when you're testing a single type.

### 2.2 Type Switch

Multiple tests with one read of the type tag:

```go
switch v := x.(type) {
case int:    use(v)
case string: use(v)
case error:  use(v)
}
```

Generated code reads the iface header once, then dispatches. Equivalent chained assertions would re-read it per branch.

### 2.3 Method-Based Polymorphism

If the alternatives all share a common operation, define an interface and let each type implement it:

```go
type Renderable interface{ Render() string }

func renderAll(xs []Renderable) []string {
    out := make([]string, len(xs))
    for i, x := range xs {
        out[i] = x.Render()
    }
    return out
}
```

This is preferable when the set of types implements the same operation. Type switches are preferable when the operation differs per type or the set is closed/sealed.

### 2.4 Decision Table

| Situation | Tool |
|-----------|------|
| Single type, single check | Comma-ok type assertion |
| Many types, different actions | Type switch |
| Many types, same action | Method on interface |
| Closed type family with varying actions | Type switch (sealed pattern) |
| Open extensibility, plugin-like | Method on interface |

---

## 3. Real-World Patterns

### 3.1 JSON Value Decoding

`encoding/json` decodes into `any` as one of: `bool`, `float64`, `string`, `[]any`, `map[string]any`, or `nil`. Walking that tree requires a type switch:

```go
package main

import (
    "encoding/json"
    "fmt"
    "strings"
)

func walk(v any, depth int) {
    indent := strings.Repeat("  ", depth)
    switch t := v.(type) {
    case map[string]any:
        for k, val := range t {
            fmt.Printf("%s%s:\n", indent, k)
            walk(val, depth+1)
        }
    case []any:
        for i, item := range t {
            fmt.Printf("%s[%d]\n", indent, i)
            walk(item, depth+1)
        }
    case string:
        fmt.Printf("%s%q\n", indent, t)
    case float64:
        fmt.Printf("%s%g\n", indent, t)
    case bool:
        fmt.Printf("%s%t\n", indent, t)
    case nil:
        fmt.Printf("%snull\n", indent)
    }
}

func main() {
    raw := []byte(`{"name":"go","age":15,"tags":["lang","systems"]}`)
    var v any
    _ = json.Unmarshal(raw, &v)
    walk(v, 0)
}
```

### 3.2 AST Walking via `go/ast`

The `go/ast` package uses type switches to inspect every node kind. A simplified inspector:

```go
package main

import (
    "fmt"
    "go/ast"
    "go/parser"
    "go/token"
)

func describe(n ast.Node) {
    switch x := n.(type) {
    case *ast.FuncDecl:
        fmt.Println("func:", x.Name.Name)
    case *ast.CallExpr:
        if id, ok := x.Fun.(*ast.Ident); ok {
            fmt.Println("call:", id.Name)
        }
    case *ast.AssignStmt:
        fmt.Println("assign with", len(x.Lhs), "lhs")
    }
}

func main() {
    src := `package p
func add(a, b int) int { return a + b }
func main() { add(1, 2) }`
    fset := token.NewFileSet()
    f, _ := parser.ParseFile(fset, "", src, 0)
    ast.Inspect(f, func(n ast.Node) bool {
        describe(n)
        return true
    })
}
```

`ast.Inspect` calls a visitor on every node; the visitor body is almost always a type switch.

### 3.3 Database Driver Value Adaption

`database/sql/driver` requires drivers to convert Go values into a small set of supported types (`int64`, `float64`, `bool`, `[]byte`, `string`, `time.Time`, `nil`). The conversion is naturally a type switch:

```go
package main

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

func main() {
    fmt.Println(toDriverValue(42))
    fmt.Println(toDriverValue("hi"))
}
```

This mirrors the real `database/sql/convert.go` `defaultCheckNamedValue` logic.

### 3.4 Error Inspector

```go
package main

import (
    "errors"
    "fmt"
    "io"
    "net"
)

type tempError interface{ Temporary() bool }

func classify(err error) string {
    if err == nil {
        return "ok"
    }
    switch e := err.(type) {
    case *net.OpError:
        return fmt.Sprintf("net op=%s addr=%v", e.Op, e.Addr)
    case net.Error:
        if e.Timeout() {
            return "net-timeout"
        }
        return "net-other"
    case tempError:
        if e.Temporary() {
            return "temp"
        }
        return "perm"
    }
    if errors.Is(err, io.EOF) {
        return "eof"
    }
    return "unknown"
}

func main() {
    fmt.Println(classify(io.EOF))
}
```

Note that case **order matters** here — `*net.OpError` implements `net.Error`, so it must be listed first. Reversing the order would bind every `*net.OpError` to the `net.Error` case.

### 3.5 Polymorphic Dispatch in a Sealed Interface Family

```go
package main

import "fmt"

type Shape interface{ shape() }

type Circle struct{ R float64 }
type Square struct{ S float64 }
type Tri struct{ B, H float64 }

func (Circle) shape() {}
func (Square) shape() {}
func (Tri) shape()    {}

func area(s Shape) float64 {
    switch x := s.(type) {
    case Circle:
        return 3.14159 * x.R * x.R
    case Square:
        return x.S * x.S
    case Tri:
        return 0.5 * x.B * x.H
    }
    return 0
}

func main() {
    fmt.Println(area(Circle{R: 2}))
    fmt.Println(area(Square{S: 3}))
}
```

The unexported `shape()` method seals the interface — only types in this package can implement it. Now the type switch is closed: any new shape forces an update here.

---

## 4. The Order-of-Cases Trap with Interface Types

If you list both an interface type and a concrete type that implements it, the **first matching case wins**:

```go
type fooer interface{ Foo() }
type Foo struct{}
func (Foo) Foo() {}

func dispatch(x any) {
    switch v := x.(type) {
    case fooer: // matches Foo and any other fooer
        fmt.Println("fooer:", v)
    case Foo:   // dead code — fooer matched first
        fmt.Println("Foo")
    }
}
```

For concrete-type-only cases, order is irrelevant — at most one matches. The trap appears only when interface types are in the case list.

---

## 5. When NOT To Use a Type Switch

### 5.1 Sealed Interface With Uniform Behavior

If every alternative has the same operation, a method is cleaner:

```go
// Bad
switch x := s.(type) {
case Circle: return x.area()
case Square: return x.area()
}

// Good — make Shape have an Area method
```

### 5.2 Open Polymorphism

If callers add new types, every existing type switch is a maintenance burden. Use methods.

### 5.3 Generics (Go 1.18+)

When the only reason for the switch is to thread a type through generic logic:

```go
// Old
func sum(xs []any) float64 {
    var total float64
    for _, x := range xs {
        switch v := x.(type) {
        case int:    total += float64(v)
        case float64: total += v
        }
    }
    return total
}

// Better with generics
func sum[T int | float64](xs []T) T {
    var total T
    for _, x := range xs {
        total += x
    }
    return total
}
```

Generics prevent boxing and remove the runtime type check entirely.

### 5.4 The Set Is Open and Likely To Grow

If you're constantly adding cases, the type switch is brittle. Define an interface; let new types implement it.

---

## 6. Worked Examples

### Example 1 — A Configurable Visitor

```go
package main

import (
    "fmt"
    "go/ast"
    "go/parser"
    "go/token"
)

type Visitor struct {
    OnFunc func(*ast.FuncDecl)
    OnCall func(*ast.CallExpr)
}

func (v Visitor) Visit(n ast.Node) {
    switch x := n.(type) {
    case *ast.FuncDecl:
        if v.OnFunc != nil {
            v.OnFunc(x)
        }
    case *ast.CallExpr:
        if v.OnCall != nil {
            v.OnCall(x)
        }
    }
}

func main() {
    fset := token.NewFileSet()
    f, _ := parser.ParseFile(fset, "", "package p\nfunc f() { g() }", 0)
    vis := Visitor{
        OnFunc: func(fn *ast.FuncDecl) { fmt.Println("func", fn.Name.Name) },
        OnCall: func(c *ast.CallExpr) { fmt.Println("call", c.Fun) },
    }
    ast.Inspect(f, func(n ast.Node) bool { vis.Visit(n); return true })
}
```

### Example 2 — Type Switch as Filter

```go
package main

import "fmt"

func filterStrings(xs []any) []string {
    out := []string{}
    for _, x := range xs {
        if s, ok := x.(string); ok {
            out = append(out, s)
        }
    }
    return out
}

func filterByType[T any](xs []any) []T {
    out := []T{}
    for _, x := range xs {
        if v, ok := x.(T); ok {
            out = append(out, v)
        }
    }
    return out
}

func main() {
    mixed := []any{1, "a", 2, "b", true}
    fmt.Println(filterStrings(mixed))      // [a b]
    fmt.Println(filterByType[int](mixed))  // [1 2]
}
```

The single-type filter doesn't need a type switch — a comma-ok assertion is enough.

### Example 3 — Heterogeneous Container Sum

```go
package main

import "fmt"

func sum(xs []any) (int, error) {
    total := 0
    for _, x := range xs {
        switch v := x.(type) {
        case int:
            total += v
        case int64:
            total += int(v)
        case float64:
            total += int(v)
        default:
            return 0, fmt.Errorf("cannot sum %T", v)
        }
    }
    return total, nil
}

func main() {
    fmt.Println(sum([]any{1, int64(2), 3.0}))
    fmt.Println(sum([]any{1, "x"})) // error
}
```

### Example 4 — Implementing `fmt.Stringer` via Type Switch

```go
package main

import "fmt"

type Event struct{ Payload any }

func (e Event) String() string {
    switch v := e.Payload.(type) {
    case string:
        return "msg=" + v
    case int:
        return fmt.Sprintf("count=%d", v)
    case error:
        return "err=" + v.Error()
    case nil:
        return "empty"
    default:
        return fmt.Sprintf("payload=%v", v)
    }
}

func main() {
    fmt.Println(Event{Payload: "hello"})
    fmt.Println(Event{Payload: 42})
}
```

### Example 5 — Lazy Evaluation Tree

```go
package main

import "fmt"

type Expr any
type num int
type sum struct{ A, B Expr }
type prod struct{ A, B Expr }

func eval(e Expr) int {
    switch x := e.(type) {
    case num:
        return int(x)
    case sum:
        return eval(x.A) + eval(x.B)
    case prod:
        return eval(x.A) * eval(x.B)
    }
    return 0
}

func main() {
    // (1 + 2) * 3
    e := prod{A: sum{A: num(1), B: num(2)}, B: num(3)}
    fmt.Println(eval(e)) // 9
}
```

---

## 7. Stdlib Patterns Reference

| Package | File | Pattern |
|---------|------|---------|
| `go/ast` | `walk.go` | `ast.Walk` switches on every node type to recurse |
| `encoding/json` | `decode.go` | `interface{}` decode produces `bool`/`float64`/`string`/`[]any`/`map[string]any` |
| `database/sql` | `convert.go` | `defaultCheckNamedValue` adapts driver values |
| `text/template` | `exec.go` | Evaluates pipeline values via type switch |
| `reflect` | rare; `reflect` itself replaces the need for a type switch |
| `fmt` | `print.go` | `printArg` switches on common arg types for fast paths |

---

## 8. Idioms

### 8.1 Empty Interface as Sum Type

In the absence of a sum type, Go uses `any` plus a type switch as the canonical encoding. Sealed interfaces (with an unexported method) are the safe variant.

### 8.2 Implementation Probing

```go
switch v := w.(type) {
case io.WriterTo:
    return v.WriteTo(w2)
case io.ReaderFrom:
    return w2.ReadFrom(v)
default:
    return io.Copy(w2, v)
}
```

`io.Copy` itself does this to find the fastest path.

### 8.3 Wrapped Error Inspection

`errors.As` is generally preferred over a type switch for unwrapping wrapped errors. Use a type switch when you need to also handle non-error types or have nuanced fallback per type.

### 8.4 The "Pseudo-`fallthrough`" via Goto-by-Helper

Since `fallthrough` is illegal, factor common code into a function:

```go
func handleNumeric(v any) { /* ... */ }

switch v := x.(type) {
case int, int64, float64:
    handleNumeric(v)
case string:
    s := strings.TrimSpace(v)
    handleNumeric(s)
}
```

---

## 9. Performance Considerations

The compiler currently lowers a type switch to a sequence of itab/eface comparisons. A switch with N concrete cases is roughly N pointer compares plus a final fallthrough to default. The first read of the iface header is shared by all cases.

Compared to a chain of `x.(T)` assertions, the type switch is faster because:
- One iface header read.
- The compiler may emit a direct jump table when many cases share a type-tag prefix (rare in practice).

For very hot paths (millions of switches per second), consider:
- A sealed interface with method dispatch (1 indirect call vs N compares).
- A `map[reflect.Type]func(any)` dispatcher that scales O(1).

See `optimize.md` for benchmarks.

---

## 10. Refactoring a Long Type Switch

When a type switch grows past ~10 cases:

1. **Split the function** by category — switch routes to a category handler.
2. **Lift cases to methods** — define an interface with the operation.
3. **Use a registry** — `map[reflect.Type]Handler`.
4. **Generate code** — for very large families, code-gen the switch from a list.

```go
// Registry
var handlers = map[reflect.Type]func(any){
    reflect.TypeOf((*Cmd)(nil)).Elem():   handleCmd,
    reflect.TypeOf((*Event)(nil)).Elem(): handleEvent,
}

func dispatch(x any) {
    if h, ok := handlers[reflect.TypeOf(x)]; ok {
        h(x)
        return
    }
    handleUnknown(x)
}
```

---

## 11. Working With `reflect`

A type switch is sometimes faster than reflection for the same purpose. But reflection is more flexible — it lets you handle any new type without modifying the switch.

```go
// Type switch — fast, closed
switch v := x.(type) {
case int:    return float64(v)
case float64: return v
}

// Reflection — slow, open
rv := reflect.ValueOf(x)
switch rv.Kind() {
case reflect.Int, reflect.Int32, reflect.Int64:
    return float64(rv.Int())
case reflect.Float32, reflect.Float64:
    return rv.Float()
}
```

The reflection version covers all integer widths in one branch — no per-type case needed.

---

## 12. Generics as a Substitute

Many type switches over numeric kinds become unnecessary with generics:

```go
// Before
func doubleAny(x any) any {
    switch v := x.(type) {
    case int: return v * 2
    case float64: return v * 2
    }
    return nil
}

// After — type-checked at compile time
func doubleNum[T int | float64](x T) T { return x * 2 }
```

But generics don't substitute for type switches over **unrelated** types (e.g., decoding JSON values). Generics constrain by type set; type switches inspect at runtime.

---

## 13. Test Cases

```go
package main

import (
    "errors"
    "io"
    "testing"
)

func classify(err error) string {
    switch err {
    case nil:
        return "ok"
    }
    switch err.(type) {
    case *Custom:
        return "custom"
    }
    if errors.Is(err, io.EOF) {
        return "eof"
    }
    return "unknown"
}

type Custom struct{}

func (*Custom) Error() string { return "custom" }

func TestClassify(t *testing.T) {
    cases := []struct {
        in   error
        want string
    }{
        {nil, "ok"},
        {&Custom{}, "custom"},
        {io.EOF, "eof"},
        {errors.New("?"), "unknown"},
    }
    for _, c := range cases {
        if got := classify(c.in); got != c.want {
            t.Errorf("classify(%v) = %q, want %q", c.in, got, c.want)
        }
    }
}
```

---

## 14. Best Practices Summary

1. Always include a `default` clause when the operand type isn't bounded.
2. Order interface-type cases before concrete-type cases that implement them.
3. Use sealed interfaces to make the type switch exhaustive.
4. Refactor long type switches into method-based polymorphism.
5. Prefer `errors.As`/`errors.Is` for wrapped error inspection.
6. Use generics to remove type switches over numeric kinds.
7. Keep cases short — extract bodies to helpers.
8. Don't use `==` or `reflect.TypeOf(x) == ...` — use the proper syntax.

---

## 15. Anti-Patterns

| Anti-pattern | Better |
|--------------|--------|
| 50-case type switch | Method on interface |
| Type switch on `error` for control flow | `errors.Is` / `errors.As` |
| Type switch every iteration of a hot loop | Hoist or use generics |
| Type switch followed by another type assertion | Single type switch |
| `case error, *MyErr:` in same clause | Split — the typed `v` isn't useful otherwise |

---

## 16. Self-Assessment Checklist

- [ ] I can pick between type switch, type assertion, and methods
- [ ] I know that order matters when interface types are listed
- [ ] I can write a sealed-interface visitor
- [ ] I recognise stdlib patterns (`go/ast`, `encoding/json`, `database/sql`)
- [ ] I avoid type switches for numeric-only logic if generics fit
- [ ] I refactor large type switches into registries or methods
- [ ] I include a `default` clause to log unknown types

---

## 17. Summary

At the middle level, a type switch is one of three dispatch tools (the others being type assertion and method polymorphism). It shines for closed type families with varying actions per type; it loses to method dispatch for open families with uniform actions, and to generics for numeric work. Standard library code is built around type switches: AST walking, JSON decoding, driver value adaption. The two non-obvious traps are `case nil:` semantics with typed nils, and the **first matching wins** rule when interface-typed cases appear among the cases.

---

## 18. Further Reading

- [Effective Go — Type assertions and switches](https://go.dev/doc/effective_go#interfaces_and_types)
- [encoding/json source](https://cs.opensource.google/go/go/+/refs/heads/master:src/encoding/json/decode.go)
- [go/ast.Walk source](https://cs.opensource.google/go/go/+/refs/heads/master:src/go/ast/walk.go)
- [database/sql/convert.go](https://cs.opensource.google/go/go/+/refs/heads/master:src/database/sql/convert.go)
- [Russ Cox — Type assertions and type switches](https://research.swtch.com/interfaces)
