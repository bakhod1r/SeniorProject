# Type Checking — Junior

Type checking is the **third stage** of `go build`, after scanning (lexing) and
parsing. The parser hands the type checker a syntax tree (an AST) that is
*syntactically* valid but completely untyped: the compiler knows you wrote
`x + y`, but it does not yet know what `x` and `y` *are*, whether `+` is even
legal on them, or what the type of the whole expression is. Type checking is the
phase that answers those questions and rejects programs that violate the
language's typing rules (`undefined: foo`, `mismatched types int and string`,
`cannot use ... as ... value`).

## 1. What type checking actually does

Given a parsed package, the type checker:

1. **Resolves names** — every identifier (`fmt`, `Println`, `x`, `T`) is linked
   to the *object* it refers to (a variable, constant, function, type, package).
2. **Computes a type for every expression** — `len(s)` is `int`, `s[0]` is
   `byte`, `&x` is `*T`.
3. **Evaluates constants** — `const KB = 1 << 10` becomes the value `1024`.
4. **Enforces the rules** — assignability, convertibility, operand legality,
   interface satisfaction, method-set rules, generic constraint satisfaction.

If any rule is broken, you get a compile error. If everything passes, the
checker produces a fully typed model of the package that later stages (IR
generation, optimization, code generation) build on.

There are **two real type checkers** in the Go world, and they share almost all
their code:

| Checker | Location | Who uses it |
| --- | --- | --- |
| `go/types` | `src/go/types` (standard library) | tools: `gopls`, `vet`, linters, *you* |
| `types2` | `src/cmd/compile/internal/types2` | the production `gc` compiler |

They are forks of the same algorithm. `go/types` works on the standard
`go/ast` tree; `types2` works on the compiler's own `cmd/compile/internal/syntax`
tree, which is faster to produce. As a junior, you will use **`go/types`**,
because it is the public API. Everything you learn there transfers directly to
understanding what the compiler does internally.

## 2. Type-check a package with `go/types`

The minimal flow: parse files into an AST, then call `(*types.Config).Check`.

```go
package main

import (
	"fmt"
	"go/ast"
	"go/importer"
	"go/parser"
	"go/token"
	"go/types"
	"log"
)

const src = `
package demo

import "strings"

const KB = 1 << 10

func Greet(name string) string {
	return "hello, " + strings.ToUpper(name)
}
`

func main() {
	fset := token.NewFileSet()
	f, err := parser.ParseFile(fset, "demo.go", src, 0)
	if err != nil {
		log.Fatal(err)
	}

	conf := types.Config{Importer: importer.Default()}
	pkg, err := conf.Check("demo", fset, []*ast.File{f}, nil)
	if err != nil {
		log.Fatal(err) // type errors land here
	}

	fmt.Println("package:", pkg.Name())     // demo
	fmt.Println("KB =", pkg.Scope().Lookup("KB").(*types.Const).Val()) // 1024
}
```

Three things you must always supply:

- **A `FileSet`** so positions in error messages make sense.
- **The `[]*ast.File`** — *all* files of the one package, parsed together.
- **An `Importer`** so the checker can resolve imported packages like `strings`.
  Forgetting `Importer` is the single most common beginner mistake — see
  *Misconceptions*. `importer.Default()` reads compiled package data; for real
  tools you'll later use `golang.org/x/tools/go/packages`.

## 3. Look up the type of an expression

To get *types of expressions* (not just top-level objects), pass an
`Info` struct. The checker fills its maps as it runs.

```go
info := &types.Info{
	Types: make(map[ast.Expr]types.TypeAndValue),
	Defs:  make(map[*ast.Ident]types.Object),
	Uses:  make(map[*ast.Ident]types.Object),
}
conf := types.Config{Importer: importer.Default()}
if _, err := conf.Check("demo", fset, []*ast.File{f}, info); err != nil {
	log.Fatal(err)
}

ast.Inspect(f, func(n ast.Node) bool {
	if e, ok := n.(ast.Expr); ok {
		if tv, ok := info.Types[e]; ok {
			fmt.Printf("%-20T  type=%s\n", e, tv.Type)
		}
	}
	return true
})
```

The `Info` maps you'll use earliest:

| Field | Maps | Gives you |
| --- | --- | --- |
| `Types` | expression → `TypeAndValue` | the type (and constant value) of any expression |
| `Defs`  | identifier → object | where a name is **declared** (`x` in `var x int`) |
| `Uses`  | identifier → object | where a name is **used** (`x` in `x + 1`) |

`TypeAndValue` is rich: `tv.Type` is the type, `tv.Value` is the constant value
(if any), and predicates like `tv.IsValue()`, `tv.IsType()`, `tv.Addressable()`,
`tv.HasOk()` describe the expression's role. Only ask for the maps you need —
each one costs memory.

## 4. Untyped constants — the intuition

This trips up everyone. In Go, constant literals are **untyped** until they are
forced into a typed context. `1 << 10`, `3.14`, `"hi"`, `true` carry a *kind*
(integer, float, string, bool) and an arbitrary-precision value, but no concrete
type yet.

```go
const Big = 1 << 62      // fine: untyped, huge precision allowed
var x int8 = 200         // ERROR: 200 overflows int8 in a typed context
const c = 1.0            // untyped float kind
var i int = c            // OK! c has integer value, fits int
```

Each untyped constant has a **default type** used when context doesn't pin one
down:

| Untyped kind | Default type |
| --- | --- |
| integer | `int` |
| floating | `float64` |
| rune | `rune` (`int32`) |
| complex | `complex128` |
| string | `string` |
| bool | `bool` |

`go/constant` is the package that represents these values exactly:

```go
import "go/constant"

a := constant.MakeInt64(1)
b := constant.Shift(a, token.SHL, 10) // 1 << 10
fmt.Println(b.Kind(), b.String())     // Int 1024
```

The compiler does *all* constant folding in arbitrary precision via this
package, then checks the result fits when it lands in a typed slot. That is why
`var x int8 = 128` fails at **compile time**, not runtime.

## 5. Misconceptions

- **"Type checking is just the parser being strict."** No — parsing only checks
  grammar. `var x int = "hi"` parses perfectly; it fails in *type checking*.
- **"I don't need an importer for simple code."** If your package imports
  *anything*, a `nil` importer gives `could not import strings (...)`. Always set
  one.
- **"`==` on `types.Type` compares structure."** It does not. Two structurally
  identical types can be different pointers. Use `types.Identical(a, b)`.
- **"Untyped constants have type `int`/`float64`."** They have a *default* type,
  applied only when needed. Until then they are untyped and higher precision.
- **"`go/types` is a toy; the compiler is different."** `go/types` and the
  compiler's `types2` are forks of the same algorithm. Learning one teaches you
  the other.

## 6. Things to do today

1. Run the `Check` example above on your own snippet; add a deliberate type error
   and read the message.
2. Print `info.Types` for every expression in a small file and predict each type
   before looking.
3. Use `pkg.Scope().Lookup(name)` to inspect a constant, a func, and a type;
   print `obj.Type()`.
4. Replace `importer.Default()` with `nil` and watch the import failure.
5. Play with `go/constant`: build `1<<10`, `3/2` (integer), `3.0/2` (float),
   and print kinds.

## 7. Summary

Type checking turns an untyped AST into a fully typed model: it resolves every
name to an object, assigns a type to every expression, folds constants in
arbitrary precision, and enforces Go's typing rules. You drive it with
`go/types`: parse files, build a `types.Config` with an `Importer`, call
`Check`, and read results from the returned `*types.Package` and the `Info`
maps (`Types`, `Defs`, `Uses`). Untyped constants are the one concept worth
internalizing early — they explain overflow errors, default types, and why
`1 << 62` is fine as a constant but not as an `int8`.

## Further reading

- [`go/types` package docs](https://pkg.go.dev/go/types)
- [Go blog: "The go/types package — an introduction"](https://go.dev/blog/go-types)
- [`golang.org/x/tools/go/types/typeutil` tutorial (go/types README)](https://github.com/golang/example/tree/master/gotypes)
- [`go/constant` package docs](https://pkg.go.dev/go/constant)
- [Go spec: Constants](https://go.dev/ref/spec#Constants)
- [Source: `src/go/types/api.go`](https://github.com/golang/go/blob/master/src/go/types/api.go)
