# Go Type Switch — Professional Level

## 1. Overview

In production Go codebases, type switches are everywhere — but they're not the right tool for every problem. Senior engineers know when to use them, when to refactor them away, and how to keep them maintainable as the code evolves. This document collects production conventions, real OSS examples, review-checklist items, and lint rules.

---

## 2. Real-World OSS Examples

### 2.1 `go/ast` — `ast.Walk` and `ast.Inspect`

**File**: `src/go/ast/walk.go`

`ast.Walk` is a giant type switch over every node kind. A simplified excerpt:

```go
// From src/go/ast/walk.go
func Walk(v Visitor, node Node) {
    if v = v.Visit(node); v == nil {
        return
    }
    switch n := node.(type) {
    case *Comment:
        // nothing to do
    case *CommentGroup:
        for _, c := range n.List {
            Walk(v, c)
        }
    case *Field:
        if n.Doc != nil { Walk(v, n.Doc) }
        walkList(v, n.Names)
        if n.Type != nil { Walk(v, n.Type) }
        // ...
    case *FieldList:
        for _, f := range n.List { Walk(v, f) }
    case *BadExpr, *Ident, *BasicLit:
        // nothing more to do
    case *Ellipsis:
        if n.Elt != nil { Walk(v, n.Elt) }
    case *FuncLit:
        Walk(v, n.Type); Walk(v, n.Body)
    // ... ~70 more cases ...
    default:
        panic(fmt.Sprintf("ast.Walk: unexpected node type %T", n))
    }
    v.Visit(nil)
}
```

`ast.Inspect` wraps `ast.Walk` with a function-as-Visitor adapter. Both are textbook type switches over a closed family of node types.

### 2.2 `encoding/json` — Decoding Into `interface{}`

**File**: `src/encoding/json/decode.go`

When `Unmarshal` decodes into `*interface{}`, it picks one of: `bool`, `float64`, `Number`, `string`, `[]any`, `map[string]any`, or `nil`. Encoders walking that result use a type switch:

```go
// Common pattern in user code that mirrors json's decoding:
func walk(v any, fn func(path string, leaf any), path string) {
    switch x := v.(type) {
    case map[string]any:
        for k, val := range x {
            walk(val, fn, path+"."+k)
        }
    case []any:
        for i, item := range x {
            walk(item, fn, fmt.Sprintf("%s[%d]", path, i))
        }
    default:
        fn(path, x)
    }
}
```

In `decode.go` itself, the dispatch is reversed — the decoder writes into the destination by inspecting `reflect.Kind`. But the symmetric encoder side, `encoding/json/encode.go`, uses type switches.

### 2.3 `database/sql` — Driver Value Adaption

**File**: `src/database/sql/convert.go`

The function `defaultCheckNamedValue` (and `convertAssign`, `convertAssignRows`) is a long type switch translating Go values into `driver.Value`:

```go
// From src/database/sql/convert.go (simplified)
func defaultCheckNamedValue(nv *driver.NamedValue) (err error) {
    nv.Value, err = driver.DefaultParameterConverter.ConvertValue(nv.Value)
    return err
}

// ConvertValue is in src/database/sql/driver/types.go:
// func (defaultConverter) ConvertValue(v any) (Value, error) {
//     if IsValue(v) { return v, nil }
//     switch vr := v.(type) {
//     case Valuer:
//         sv, err := callValuerValue(vr)
//         // ...
//     case decimalDecompose:
//         return vr, nil
//     }
//     rv := reflect.ValueOf(v)
//     switch rv.Kind() {
//     case reflect.Ptr:
//         // ...
//     }
//     return nil, fmt.Errorf("unsupported type %T, a %s", v, rv.Kind())
// }
```

Note the **two-stage** dispatch: a type switch for known interfaces, then a `reflect.Kind` switch as a fallback for unrecognized concrete types. This is a common production pattern.

### 2.4 `fmt` — Print Argument Formatting

**File**: `src/fmt/print.go`

`printArg` is a type switch optimized for the common cases:

```go
// From src/fmt/print.go (simplified)
func (p *pp) printArg(arg any, verb rune) {
    p.arg = arg
    p.value = reflect.Value{}
    if arg == nil {
        p.fmt.padString(nilAngleString)
        return
    }
    // Some types can be done without reflection.
    switch f := arg.(type) {
    case bool:
        p.fmtBool(f, verb)
    case float32:
        p.fmtFloat(float64(f), 32, verb)
    case float64:
        p.fmtFloat(f, 64, verb)
    case int:
        p.fmtInteger(uint64(f), signed, verb)
    case int8:
        p.fmtInteger(uint64(f), signed, verb)
    // ... all integer / float / string / complex variants ...
    case string:
        p.fmtString(f, verb)
    case []byte:
        p.fmtBytes(f, verb, "[]byte")
    case reflect.Value:
        // ... handle reflection wrappers
    default:
        // fall back to reflection
        p.printValue(reflect.ValueOf(f), verb, 0)
    }
}
```

The fast path avoids reflection. The default falls back to `reflect.Value`-based printing.

### 2.5 Kubernetes — `runtime.Object` Type Switching

**File**: `staging/src/k8s.io/apimachinery/pkg/runtime/serializer/json/json.go` and many others.

Kubernetes API machinery uses type switches when adapting `runtime.Object` to specific kinds. Patterns:

```go
// Conceptual — paraphrased from kube apimachinery
func extract(obj runtime.Object) (string, error) {
    switch o := obj.(type) {
    case *unstructured.Unstructured:
        return o.GetKind(), nil
    case *unstructured.UnstructuredList:
        return o.GetKind(), nil
    case *runtime.Unknown:
        return o.Kind, nil
    case *metav1.Status:
        return "Status", nil
    default:
        gvk := obj.GetObjectKind().GroupVersionKind()
        return gvk.Kind, nil
    }
}
```

### 2.6 CockroachDB — SQL Parser AST

**Repo**: `cockroachdb/cockroach`, `pkg/sql/parser` and `pkg/sql/sem/tree`

The CockroachDB SQL parser produces a large AST (`tree.Statement`, `tree.Expr`, ...) that walkers traverse via type switches. A representative snippet (paraphrased):

```go
// pkg/sql/sem/tree/walk.go (paraphrased)
func walkStmt(v Visitor, stmt Statement) (Statement, error) {
    switch t := stmt.(type) {
    case *Select:
        // recurse into each clause
    case *Insert:
        // ...
    case *Update:
        // ...
    case *Delete:
        // ...
    default:
        // unsupported
    }
    return stmt, nil
}
```

### 2.7 Prometheus — Metric Type Dispatch

**Repo**: `prometheus/client_golang`, `prometheus/prometheus`

Prometheus uses type switches to handle different metric types when scraping:

```go
// Conceptual — from prometheus/prometheus
func process(m prom.Metric) {
    switch v := m.(type) {
    case *Counter:
        // increment
    case *Gauge:
        // set
    case *Histogram:
        // observe
    case *Summary:
        // observe
    }
}
```

### 2.8 Etcd — Raft Message Types

**Repo**: `etcd-io/etcd`, `pkg/raft`

Raft messages have a `Type` enum, but the framework also has a Go-side `raftpb.Message` that's a sum type encoded via a discriminator field. Etcd code commonly does:

```go
// pkg/raft/raft.go (paraphrased)
switch m.Type {
case pb.MsgVote:    // ...
case pb.MsgApp:     // ...
case pb.MsgHeartbeat: // ...
}
```

This is a value-switch, but mirrors the pattern of a type switch — the discriminator is the runtime type.

---

## 3. Team Conventions

### 3.1 Always Include `default`

For every type switch on `any`, `error`, or any unsealed interface, include a `default` clause that:
- Logs the unexpected type with `fmt.Sprintf("%T", v)`.
- Returns a sentinel error or panics with a descriptive message.

```go
default:
    return fmt.Errorf("dispatch: unexpected type %T", v)
```

### 3.2 Order Concrete Cases Before Interface Cases They Implement

```go
// Correct order
switch x.(type) {
case *os.PathError: // concrete
case net.Error:     // interface
}

// Wrong order — *os.PathError can implement net.Error in some chains
switch x.(type) {
case net.Error:
case *os.PathError: // dead code
}
```

Document this rule with a comment. Linters don't catch it consistently.

### 3.3 Use Sealed Interfaces

When the type family is closed within a package, use an unexported method to seal it:

```go
type Cmd interface{ cmd() }

type StartCmd struct{}
type StopCmd struct{}

func (StartCmd) cmd() {}
func (StopCmd) cmd()  {}
```

Sealed families help reviewers and the `exhaustive` linter spot missing cases.

### 3.4 Limit Cases per Switch

If a type switch has more than ~10 cases, consider:
- Splitting into multiple switches by category.
- Replacing with a `map[reflect.Type]Handler`.
- Extracting bodies into named helpers.

### 3.5 Don't Mix Type Switch with `errors.As`

`errors.As` walks the wrap chain. A type switch only inspects the top-level concrete type. For wrapped errors:

```go
// Bad — misses wrapped errors
switch err.(type) {
case *MyErr:
}

// Good
var my *MyErr
if errors.As(err, &my) {
    // ...
}
```

Reserve type switches on errors for cases where you have many distinct error types and prefer the switch syntax — and document that wrapping is not handled.

### 3.6 Comment the Operand Source

```go
// dispatch handles values from json.Unmarshal into *any.
// Expected types: bool, float64, string, []any, map[string]any, nil.
func dispatch(x any) { ... }
```

A short comment about the operand's origin saves reviewers from reverse-engineering the case set.

---

## 4. Review Checklist

- [ ] Operand is an interface type (not a concrete type).
- [ ] `default` clause present.
- [ ] `case nil:` handled if the operand can be nil-interface.
- [ ] No `fallthrough` (compile error anyway, but check intent).
- [ ] Concrete cases listed before interface cases they implement.
- [ ] Multi-type case (`case T1, T2:`) doesn't try to use `v` as a specific type.
- [ ] Bound `v` doesn't shadow a useful outer variable.
- [ ] Long bodies extracted to helper functions.
- [ ] Wrapped errors handled with `errors.As`/`errors.Is` instead of (or alongside) the switch.
- [ ] Switch is documented (operand source, expected case set).

---

## 5. Lint Rules

### 5.1 `staticcheck`

- **SA4020**: unreachable case — flags duplicate or shadowed cases (e.g., concrete case after a matching interface case).
- **SA1019** (deprecation): catches deprecated types in case clauses.

Run with:
```bash
staticcheck ./...
```

### 5.2 `exhaustive` Linter

Third-party (https://github.com/nishanths/exhaustive). Checks `switch` and `type switch` over enums and sealed interface types for missing cases.

```bash
go install github.com/nishanths/exhaustive/cmd/exhaustive@latest
exhaustive -default-signifies-exhaustive=true ./...
```

Sealed-interface support requires opt-in via `//exhaustive:enforce` directive on the interface.

### 5.3 `errcheck`

Catches missed return-value checks; not directly type-switch related but relevant when type switches drive error handling.

### 5.4 Custom Vet Pass

For very large codebases, write a custom `go/analysis` pass that:
- Verifies every `type switch` on a sealed interface lists every implementer.
- Flags `case T1, T2:` with attempts to use `v` as a specific type.
- Flags missing `default` on switches over `any`.

Skeleton:

```go
package mylint

import (
    "go/ast"
    "golang.org/x/tools/go/analysis"
)

var Analyzer = &analysis.Analyzer{
    Name: "typeswitchchecks",
    Doc:  "checks type switches for common pitfalls",
    Run:  run,
}

func run(pass *analysis.Pass) (any, error) {
    for _, file := range pass.Files {
        ast.Inspect(file, func(n ast.Node) bool {
            ts, ok := n.(*ast.TypeSwitchStmt)
            if !ok {
                return true
            }
            checkDefault(pass, ts)
            checkCaseOrder(pass, ts)
            return true
        })
    }
    return nil, nil
}
```

---

## 6. Maintenance Patterns

### 6.1 Adding a New Type to a Family

When a new concrete type joins a sealed family:

1. Implement the sealed interface.
2. Search for `\.\(type\)` in the codebase (`grep -rn '\.(\s*type\s*)\s*' .`).
3. Add a case in every relevant switch.
4. Add a default-path test for the new type.

The `exhaustive` linter automates step 2 + 3.

### 6.2 Removing a Type

1. Mark the type deprecated.
2. Remove its sealed-interface implementation last.
3. Search for case clauses naming the type and remove them.
4. Run tests with `-race` to catch any silent fall-through.

### 6.3 Changing a Concrete Type to Interface (or vice versa)

Risky. The case order rules change. Audit every type switch that mentions the type or its supertype.

---

## 7. Anti-Patterns Seen in Code Reviews

### 7.1 Type Switch as Hidden `if`

```go
switch x.(type) {
case error:
    log.Print(x)
}
```

Should be:

```go
if err, ok := x.(error); ok {
    log.Print(err)
}
```

### 7.2 Boxing a Concrete Value Just to Switch on It

```go
func process(n int) {
    var x any = n
    switch x.(type) {
    case int:
        // ...
    }
}
```

The static type already says it's `int`. Remove the indirection.

### 7.3 Switching on `reflect.TypeOf(x)`

```go
switch reflect.TypeOf(x) {
case reflect.TypeOf(0):
    // ...
}
```

This works but is clumsier and slower than a real type switch.

### 7.4 Long-Bodied Cases

```go
switch x.(type) {
case A:
    // 50 lines
case B:
    // 50 lines
}
```

Extract each body to a function. The switch becomes a one-liner per case.

### 7.5 Type Switch with `fallthrough` Wishfulness

```go
// Doesn't compile
switch x.(type) {
case int:
    // some setup
    fallthrough
case int64:
    // shared logic
}
```

Refactor to a helper:

```go
func handleInt(v any) { ... }

switch v := x.(type) {
case int:
    handleInt(v)
case int64:
    handleInt(v)
}
```

---

## 8. Documentation Patterns

When publishing a library API that takes `any` and dispatches via type switch, document the accepted types in the godoc:

```go
// Format renders v as a string.
//
// Accepted types: bool, int, int64, float64, string, []byte, time.Time, nil.
// Other types return an error.
func Format(v any) (string, error) {
    switch x := v.(type) {
    // ...
    }
}
```

Without this, callers must read the implementation to learn the contract.

---

## 9. Testing Patterns

### 9.1 One Test Per Case

```go
func TestDispatch(t *testing.T) {
    cases := []struct {
        name string
        in   any
        want string
    }{
        {"int", 1, "int"},
        {"string", "x", "string"},
        {"nil", nil, "nil"},
        {"unknown", 3.14, "default"},
    }
    for _, c := range cases {
        t.Run(c.name, func(t *testing.T) {
            if got := dispatch(c.in); got != c.want {
                t.Errorf("got %q want %q", got, c.want)
            }
        })
    }
}
```

### 9.2 Property Testing for Closed Families

```go
import "testing/quick"

func TestDispatchPanicsForUnknown(t *testing.T) {
    f := func(x int) bool {
        defer func() { _ = recover() }()
        dispatch(struct{ X int }{x}) // unknown type
        return false // should have panicked
    }
    if err := quick.Check(f, nil); err == nil {
        t.Error("expected panic for unknown type")
    }
}
```

### 9.3 Coverage of `default`

Default branches often go untested. Add at least one test that exercises an unknown type to confirm the default path.

---

## 10. CI Integration

### 10.1 Pre-merge

```yaml
# .github/workflows/lint.yml
- run: go vet ./...
- run: staticcheck ./...
- run: exhaustive ./...
- run: go test -race ./...
```

### 10.2 Coverage

Use `go test -cover -coverprofile=cover.out` and inspect that every case branch is covered. Uncovered cases often hide stale code.

---

## 11. Self-Assessment Checklist

- [ ] I can recall production OSS code that uses a type switch
- [ ] I run `staticcheck` and `exhaustive` on type-switch-heavy code
- [ ] I document expected types in godoc
- [ ] I test every case branch including `default`
- [ ] I refactor type switches to method dispatch when they grow large
- [ ] I order concrete cases before interface cases they implement
- [ ] I document the operand's source (where the `any` came from)

---

## 12. Summary

Production type switches show up in: AST walking (`go/ast`), JSON value decoding (`encoding/json`), database driver value adaption (`database/sql`), and the `fmt` package's fast paths. Team conventions to enforce: always-default, order interface cases after concrete ones, use sealed interfaces, document expected types, run `staticcheck` + `exhaustive`. Refactor to method dispatch or registries when the case count grows.

---

## 13. Further Reading

- [Go source: src/go/ast/walk.go](https://cs.opensource.google/go/go/+/refs/heads/master:src/go/ast/walk.go)
- [Go source: src/encoding/json/decode.go](https://cs.opensource.google/go/go/+/refs/heads/master:src/encoding/json/decode.go)
- [Go source: src/database/sql/convert.go](https://cs.opensource.google/go/go/+/refs/heads/master:src/database/sql/convert.go)
- [Go source: src/fmt/print.go](https://cs.opensource.google/go/go/+/refs/heads/master:src/fmt/print.go)
- [staticcheck SA4020](https://staticcheck.dev/docs/checks#SA4020)
- [exhaustive linter](https://github.com/nishanths/exhaustive)
- [Kubernetes apimachinery](https://github.com/kubernetes/apimachinery)
- [CockroachDB SQL parser](https://github.com/cockroachdb/cockroach/tree/master/pkg/sql)
