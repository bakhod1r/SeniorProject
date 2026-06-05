# Parser & AST — Junior

## 1. What is an AST?

After the **scanner** (lexer) turns your source text into a stream of tokens (`package`, `IDENT`, `func`, `{`, `+`, ...), the **parser** arranges those tokens into a tree that mirrors the grammatical structure of the program. That tree is the **Abstract Syntax Tree (AST)**.

"Abstract" means the tree drops noise that doesn't affect meaning — parentheses used only for grouping, exact whitespace, the literal token positions of every brace. It keeps the *structure*: this is a function declaration, its body holds an `if` statement, whose condition is a `<` comparison of two expressions.

A tiny example. The source:

```go
x := a + b*c
```

parses (conceptually) to:

```
AssignStmt
├── Lhs: [Ident "x"]
├── Tok: :=
└── Rhs: [BinaryExpr "+"
          ├── X: Ident "a"
          └── Y: BinaryExpr "*"
                 ├── X: Ident "b"
                 └── Y: Ident "c"]
```

Notice that `b*c` sits **below** the `+`. The parser already encoded precedence (`*` binds tighter than `+`) into the shape of the tree. You never have to re-derive it.

---

## 2. The packages you'll actually use

The Go compiler (`gc`) has its own internal parser in `cmd/compile/internal/syntax`, but that is not what you import. For tools — linters, code generators, refactoring scripts — you use the **standard library** trio:

| Package | Job |
| --- | --- |
| `go/token` | positions, the `FileSet`, token constants |
| `go/parser` | turns source into an AST |
| `go/ast` | the AST node types and helpers to walk them |

These three are stable, documented, and what 99% of Go tooling is built on.

---

## 3. Parse a file

`parser.ParseFile` reads one `.go` file (from disk or from a `[]byte`/string) and returns an `*ast.File`.

```go
package main

import (
	"go/parser"
	"go/token"
	"log"
)

func main() {
	src := `package demo

func Add(a, b int) int {
	return a + b
}`

	fset := token.NewFileSet()                       // tracks positions
	file, err := parser.ParseFile(fset, "demo.go", src, 0)
	if err != nil {
		log.Fatal(err)
	}
	_ = file // *ast.File — root of the tree
}
```

The arguments:

- `fset` — a `*token.FileSet`, the registry that turns numeric positions into "file:line:col".
- `"demo.go"` — the filename (used only for error messages and positions).
- `src` — the source. If you pass `nil`, the parser reads the named file from disk.
- `0` — parse **mode** flags. `0` means "parse everything, no comments retained."

---

## 4. Print the tree with `ast.Print`

The fastest way to *see* an AST is `ast.Print`. It dumps the whole tree with field names.

```go
import "go/ast"

ast.Print(fset, file)
```

Output (trimmed) looks like:

```
 0  *ast.File {
 1  .  Name: *ast.Ident { Name: "demo" }
 2  .  Decls: []ast.Decl (len = 1) {
 3  .  .  0: *ast.FuncDecl {
 4  .  .  .  Name: *ast.Ident { Name: "Add" }
 5  .  .  .  Type: *ast.FuncType { ... }
 6  .  .  .  Body: *ast.BlockStmt { ... }
...
```

Passing `fset` makes positions print as readable `file:line:col`. Pass `nil` to omit them. This is your debugger for AST work.

---

## 5. Walk the tree with `ast.Inspect`

To *do something* with every node, walk the tree. `ast.Inspect` calls your function once per node, top-down.

```go
ast.Inspect(file, func(n ast.Node) bool {
	if n != nil {
		fmt.Printf("%T\n", n)
	}
	return true // true = descend into children
})
```

Return `true` to keep going into children, `false` to skip a subtree. The function is also called with `nil` after finishing a node's children, so guard against `nil`.

---

## 6. Find all function names

A real mini-task: list every top-level function and method in a file. Use a **type switch** to react only to `*ast.FuncDecl` nodes.

```go
ast.Inspect(file, func(n ast.Node) bool {
	if fn, ok := n.(*ast.FuncDecl); ok {
		fmt.Println(fn.Name.Name)        // the identifier text
	}
	return true
})
```

`fn.Name` is an `*ast.Ident`; its `.Name` field is the string. For top-level decls you could also just range over `file.Decls` and type-assert, but `ast.Inspect` also finds nested function literals if you want them.

If you only want **top-level** functions and methods (no nested literals), ranging is clearer:

```go
for _, decl := range file.Decls {
	if fn, ok := decl.(*ast.FuncDecl); ok {
		kind := "func"
		if fn.Recv != nil {
			kind = "method" // has a receiver
		}
		fmt.Printf("%s %s\n", kind, fn.Name.Name)
	}
}
```

`fn.Recv` is the receiver field list — non-nil for methods like `func (s *Server) Run()`, nil for plain functions.

---

## 7. Find all function *calls*

The same pattern, but match `*ast.CallExpr`:

```go
ast.Inspect(file, func(n ast.Node) bool {
	call, ok := n.(*ast.CallExpr)
	if !ok {
		return true
	}
	switch fn := call.Fun.(type) {
	case *ast.Ident:               // foo(...)
		fmt.Println("call:", fn.Name)
	case *ast.SelectorExpr:        // pkg.Foo(...) or x.Method(...)
		fmt.Println("call:", fn.Sel.Name)
	}
	return true
})
```

`CallExpr.Fun` is whatever is being called. A bare function is an `*ast.Ident`; a `pkg.Func` or `recv.Method` is a `*ast.SelectorExpr` whose `.Sel` is the final name. Always use the comma-ok form (`call, ok := ...`) and a type switch — never a bare `call.Fun.(*ast.Ident)`, which panics the moment it meets `fmt.Println`.

---

## 7b. Reading a node's position

Every node knows where it came from. Combine `node.Pos()` with the `FileSet` to print a location:

```go
ast.Inspect(file, func(n ast.Node) bool {
	if fn, ok := n.(*ast.FuncDecl); ok {
		pos := fset.Position(fn.Pos())
		fmt.Printf("%s at %s:%d\n", fn.Name.Name, pos.Filename, pos.Line)
	}
	return true
})
```

This is how linters say "x.go:42: ...". Without the `FileSet`, `fn.Pos()` is just an opaque number — the `FileSet` is what turns it into a real file/line/column.

---

## 8. Misconceptions

| Misconception | Reality |
| --- | --- |
| "The AST is the bytes of my file." | It's a tree of typed nodes; whitespace and most parens are gone. |
| "I can skip the `FileSet`." | Without it positions are meaningless and `ast.Print`/error messages are useless. |
| "`ast.Inspect` only visits top-level nodes." | It visits **every** node recursively, including expressions. |
| "Comments are in the tree by default." | No — you must pass `parser.ParseComments` to keep them. |
| "The AST knows the type of `x`." | The parser does **not** do type checking; an AST has no type info. That's a later stage (`go/types`). |
| "`go/ast` is what the compiler uses." | The compiler uses its own `cmd/compile/internal/syntax` tree; `go/ast` is the std-lib mirror for tooling. |

---

## 9. Things to do today

1. Parse one of your own `.go` files and run `ast.Print` on it. Scroll the output.
2. Print the type (`%T`) of every node with `ast.Inspect`. Notice how many `*ast.Ident` you see.
3. List all function/method names in a file.
4. List all called function names (idents + selectors).
5. Count how many `*ast.IfStmt` nodes a file has.
6. Print the position (`file:line`) of every function declaration.

A quick template for the counting tasks:

```go
count := 0
ast.Inspect(file, func(n ast.Node) bool {
	if _, ok := n.(*ast.IfStmt); ok {
		count++
	}
	return true
})
fmt.Println("if statements:", count)
```

Swap the type in the assertion to count any node kind — `*ast.ForStmt`, `*ast.ReturnStmt`, `*ast.CallExpr`, and so on. This one pattern (walk + type-assert + tally) is the backbone of most simple Go tooling.

---

6. Print the position (`file:line`) of every function declaration (combine §6 and §7b).

These five-minute drills cement the one pattern you'll reuse forever: **parse → walk → type-switch → act.**

---

## 10. Summary

The parser turns the scanner's token stream into an **AST** — a typed tree that encodes structure and precedence but drops formatting noise. For tooling you use `go/parser` (`parser.ParseFile`), `go/token` (the `FileSet`), and `go/ast` (node types + walkers). `ast.Print` shows the tree; `ast.Inspect` walks it; a type switch lets you react to specific node kinds like `*ast.FuncDecl` and `*ast.CallExpr`. The AST carries **no type information** — that comes later. Master parse → print → walk → match and you can already build useful tools.

---

## Further reading
- `go/parser`: https://pkg.go.dev/go/parser
- `go/ast`: https://pkg.go.dev/go/ast
- `go/token`: https://pkg.go.dev/go/token
- `ast.Inspect`: https://pkg.go.dev/go/ast#Inspect
- `ast.Print`: https://pkg.go.dev/go/ast#Print
