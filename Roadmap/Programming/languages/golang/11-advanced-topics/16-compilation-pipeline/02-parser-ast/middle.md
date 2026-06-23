# Parser & AST — Middle

## 0. From tokens to a tree, one more time

At junior level you parsed a file and walked it. The middle-level shift is to stop treating the AST as a flat bag of nodes and start seeing it as the *grammar made concrete*: every node type exists because some grammar production exists, and its fields are that production's parts. Once that clicks, you can predict a node's shape from the syntax and vice versa, which is what makes you fast at writing tools.

This file builds that intuition (grammar↔node), tours the taxonomy, gets precise about positions and comments, and then puts it to work modifying and re-printing trees and writing a small linter.

---

## 1. Grammar → tree intuition

Go's syntax is defined by a context-free grammar (EBNF) in the language spec. Each grammar **production** describes how one construct is built from smaller pieces. The parser's job is to recognise those productions and build a node for each.

A slice of the spec:

```ebnf
IfStmt = "if" [ SimpleStmt ";" ] Expression Block [ "else" ( IfStmt | Block ) ] .
```

That production maps almost one-to-one onto the node:

```go
type IfStmt struct {
	If   token.Pos  // position of "if"
	Init Stmt       // optional SimpleStmt before the condition
	Cond Expr       // the Expression
	Body *BlockStmt // the Block
	Else Stmt       // *IfStmt or *BlockStmt, or nil
}
```

When you read `ast.IfStmt` and ask "why these fields?", the answer is always "because that's what the grammar production contains." Learning the grammar and learning the node set are the same activity.

---

## 2. A tour of the node taxonomy

`go/ast` defines roughly 40 node types, but they fan out from **three interfaces**. Every node implements `ast.Node`; most also implement one of these:

```go
type Expr interface { Node; exprNode() }
type Stmt interface { Node; stmtNode() }
type Decl interface { Node; declNode() }
```

The unexported marker method (`exprNode()`, etc.) is how the package guarantees only the right concrete types satisfy each interface — you cannot accidentally pass a statement where an expression is expected, and you can't define your own type that masquerades as an `ast.Expr` from outside the package. This is a deliberate, compile-time safety net.

**Expressions** (`ast.Expr`) — things that produce a value:

| Node | Example |
| --- | --- |
| `*ast.Ident` | `x`, `foo` |
| `*ast.BasicLit` | `42`, `"hi"`, `3.14` |
| `*ast.BinaryExpr` | `a + b` |
| `*ast.UnaryExpr` | `-x`, `!ok`, `<-ch` |
| `*ast.CallExpr` | `f(a, b)` |
| `*ast.SelectorExpr` | `pkg.Name`, `x.Field` |
| `*ast.IndexExpr` | `a[i]` (also generics `T[int]`) |
| `*ast.CompositeLit` | `T{...}`, `[]int{1,2}` |
| `*ast.StarExpr` | `*p` (and pointer types) |

**Statements** (`ast.Stmt`) — things that *do*:

| Node | Example |
| --- | --- |
| `*ast.AssignStmt` | `x := 1`, `a, b = b, a` |
| `*ast.IfStmt` | `if c { }` |
| `*ast.ForStmt` / `*ast.RangeStmt` | loops |
| `*ast.ReturnStmt` | `return x` |
| `*ast.ExprStmt` | a call used as a statement: `f()` |
| `*ast.BlockStmt` | `{ ... }` |
| `*ast.SwitchStmt` / `*ast.TypeSwitchStmt` | switches |

**Declarations** (`ast.Decl`):

| Node | Example |
| --- | --- |
| `*ast.FuncDecl` | `func F() {}` |
| `*ast.GenDecl` | `import`, `const`, `var`, `type` (grouped) |

A `*ast.GenDecl` holds `Specs []Spec`, where a Spec is `*ast.ImportSpec`, `*ast.ValueSpec`, or `*ast.TypeSpec`. So `var x, y int` is a `GenDecl{Tok: VAR}` with one `ValueSpec`.

The root is `*ast.File` (`Name`, `Decls`, `Imports`, `Comments`), and a set of files forms an `*ast.Package`.

A compact mental hierarchy:

```
Node (Pos/End)
├── Expr   — Ident, BasicLit, BinaryExpr, CallExpr, SelectorExpr, ...
├── Stmt   — AssignStmt, IfStmt, ForStmt, ReturnStmt, BlockStmt, ...
└── Decl   — FuncDecl, GenDecl(→ ImportSpec/ValueSpec/TypeSpec)
File → Decls, Imports, Comments
```

A useful way to internalise the taxonomy is to print the node type of everything in a small file:

```go
counts := map[string]int{}
ast.Inspect(file, func(n ast.Node) bool {
	if n != nil {
		counts[fmt.Sprintf("%T", n)]++
	}
	return true
})
for typ, c := range counts {
	fmt.Printf("%4d  %s\n", c, typ)
}
```

Run it on real code and you'll see `*ast.Ident` dominate, followed by `*ast.SelectorExpr`, `*ast.CallExpr`, and the statement nodes. That frequency distribution is worth remembering: optimisations and rewrites mostly touch idents, selectors, and calls.

---

## 3. Positions and the FileSet

Every node exposes `Pos()` (first byte) and `End()` (one past last byte). These return `token.Pos` — an opaque integer that is only an **offset into a `FileSet`**, not a line number.

To turn a `token.Pos` into something human, ask the `FileSet`:

```go
fset := token.NewFileSet()
file, _ := parser.ParseFile(fset, "demo.go", src, 0)

ast.Inspect(file, func(n ast.Node) bool {
	if call, ok := n.(*ast.CallExpr); ok {
		pos := fset.Position(call.Pos()) // token.Position{Filename,Line,Column,Offset}
		fmt.Printf("call at %s:%d:%d\n", pos.Filename, pos.Line, pos.Column)
	}
	return true
})
```

Why a separate `FileSet`? So positions across **many** files share one coordinate space (a tool parsing 1,000 files keeps one `FileSet`). `token.NoPos` (value 0) means "no position" — common on synthesised nodes.

You can recover the *exact source text* of any node by slicing on offsets — handy for showing the original snippet in a diagnostic:

```go
start := fset.Position(node.Pos()).Offset
end := fset.Position(node.End()).Offset
snippet := src[start:end] // the literal bytes this node spans
```

`Pos()` is the first byte, `End()` is one past the last — so `[start, end)` is the node's exact span. This round-trip (node → offsets → original bytes) is the basis of position-keyed text edits, which produce minimal diffs.

---

## 4. Comments

Comments are not part of the grammar of expressions, so by default the parser throws them away. To keep them, pass `parser.ParseComments`:

```go
file, _ := parser.ParseFile(fset, "demo.go", src, parser.ParseComments)
```

Now:

- `file.Comments` is `[]*ast.CommentGroup` — **all** comments in file order.
- A `*ast.FuncDecl` (and other decls) has a `.Doc *ast.CommentGroup` — the doc comment directly above it.
- Each `*ast.CommentGroup` has `.List []*ast.Comment`; `.Text()` returns cleaned text (markers stripped).

Because comments float between nodes rather than being children, associating a comment with "the node it belongs to" is fiddly. `ast.NewCommentMap` does the heavy lifting:

```go
cmap := ast.NewCommentMap(fset, file, file.Comments)
for node, groups := range cmap {
	_ = node   // the AST node
	_ = groups // []*ast.CommentGroup attached to it
}
```

This is essential when you rewrite an AST and want comments to follow the nodes they describe.

Reading a function's doc comment is direct once you have `ParseComments`:

```go
for _, decl := range file.Decls {
	if fn, ok := decl.(*ast.FuncDecl); ok && fn.Doc != nil {
		fmt.Printf("%s:\n%s\n", fn.Name.Name, fn.Doc.Text())
	}
}
```

`fn.Doc.Text()` returns the comment with `//`/`/* */` markers stripped and lines joined — exactly what `go doc` shows. Note `fn.Doc` is only the comment **immediately above** the declaration with no blank line in between; a comment separated by a blank line is a free-floating comment in `file.Comments`, not a doc comment.

---

## 5. Modifying and printing an AST

You can mutate node fields in place and then render the tree back to source with `go/printer` (or its convenience wrapper `go/format`).

Rename every function named `Foo` to `Bar`:

```go
ast.Inspect(file, func(n ast.Node) bool {
	if fn, ok := n.(*ast.FuncDecl); ok && fn.Name.Name == "Foo" {
		fn.Name.Name = "Bar"
	}
	return true
})

import "go/printer"
printer.Fprint(os.Stdout, fset, file) // re-emit source
```

`go/format.Node` does the same but also applies `gofmt` formatting:

```go
import "go/format"
var buf bytes.Buffer
format.Node(&buf, fset, file)
```

A subtle rule: when you **add** or **move** nodes, set positions carefully (or leave them `token.NoPos`). The printer uses positions to decide line breaks; bad positions cause weird output. For structural edits prefer `astutil`.

---

## 6. `astutil` for safe rewrites

`golang.org/x/tools/go/ast/astutil` gives higher-level operations than raw mutation:

```go
import "golang.org/x/tools/go/ast/astutil"

// Add / delete imports cleanly (keeps import block tidy):
astutil.AddImport(fset, file, "fmt")
astutil.DeleteImport(fset, file, "log")

// Apply: rewrite with pre/post visit and a Cursor that can Replace/Delete/InsertBefore:
astutil.Apply(file, func(c *astutil.Cursor) bool {
	if id, ok := c.Node().(*ast.Ident); ok && id.Name == "old" {
		c.Replace(&ast.Ident{Name: "new"})
	}
	return true
}, nil)
```

`astutil.Apply`'s `Cursor` knows a node's parent and slot, so structural replacement is safe — unlike `ast.Inspect`, which gives you no way to swap a node out.

### `ast.Walk` vs `ast.Inspect`

`ast.Inspect` is sugar over `ast.Walk`. `Walk` takes a `Visitor` interface:

```go
type Visitor interface {
	Visit(node Node) (w Visitor)
}
```

`Visit` returns the visitor to use for children, or `nil` to skip them. `ast.Inspect` wraps this so you pass a `func(Node) bool` instead. Use `Walk` directly when you want to carry **state** down the tree (e.g. a per-scope visitor that resets on each block) by returning a fresh visitor for subtrees; use `Inspect` for simple top-down scans.

---

## 7. A small linter

Putting it together: a linter that flags calls to `fmt.Println` (say your codebase wants structured logging instead).

```go
func lint(fset *token.FileSet, file *ast.File) {
	ast.Inspect(file, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok {
			return true
		}
		sel, ok := call.Fun.(*ast.SelectorExpr)
		if !ok {
			return true
		}
		pkg, ok := sel.X.(*ast.Ident)
		if !ok {
			return true
		}
		if pkg.Name == "fmt" && sel.Sel.Name == "Println" {
			p := fset.Position(call.Pos())
			fmt.Printf("%s:%d:%d: avoid fmt.Println; use the logger\n",
				p.Filename, p.Line, p.Column)
		}
		return true
	})
}
```

Caveat: this is **syntactic**. If someone aliased the import (`import f "fmt"`) or shadowed `fmt` with a local variable, the check is fooled. For correctness you'd combine the AST with `go/types` (the `analysis` framework does exactly this). But for a quick lint, syntax alone is often good enough.

### Reading literal values correctly

A common follow-on: extract the actual string passed to a call. Remember `BasicLit.Value` is raw source — decode it:

```go
if lit, ok := arg.(*ast.BasicLit); ok && lit.Kind == token.STRING {
	s, _ := strconv.Unquote(lit.Value) // "hi\n" → hi + newline
	use(s)
}
```

Skipping `strconv.Unquote` leaves the surrounding quotes and un-processed escapes in your string — a frequent middle-level bug.

---

## 7b. FieldList: params, results, struct fields, receivers

One node type, `*ast.FieldList`, appears everywhere a comma/semicolon-separated list of "name(s) type" shows up: function parameters, return values, struct fields, interface methods, and method receivers. Its quirk: **one `*ast.Field` can name several entities** that share a type.

```go
// func f(a, b int, s string)  →  Params.List has TWO fields:
//   Field{Names: [a, b], Type: int}
//   Field{Names: [s],    Type: string}
for _, field := range fn.Type.Params.List {
	for _, name := range field.Names { // may be empty for unnamed/embedded
		fmt.Println(name.Name)
	}
}
```

Watch for `field.Names` being **empty**: that's an unnamed parameter (`func(int)`), an embedded struct field, or an embedded interface. Code that assumes `Names[0]` exists panics on those. The same `FieldList` shape powers `fn.Recv` (the receiver), `structType.Fields`, and `interfaceType.Methods`, so learning it once pays off across the taxonomy.

---

## 7c. Wiring it into a CLI

A complete little tool: parse every file passed on the command line and run the linter from §7.

```go
func main() {
	fset := token.NewFileSet()
	for _, path := range os.Args[1:] {
		file, err := parser.ParseFile(fset, path, nil, parser.ParseComments)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			continue // keep going; ParseFile may still give a partial tree
		}
		lint(fset, file)
	}
}
```

Two house-keeping habits worth internalising at this level: (1) **one `FileSet`** is created for the whole run and shared across every `ParseFile`, so positions are comparable across files; (2) a parse error on one file doesn't abort the others — you log it and continue, optionally still linting the partial tree the parser returned. That structure scales unchanged from a two-file demo to a thousand-file tool, and it's the same skeleton `go vet`-style tools use before they layer `go/types` on top.

---

## 7d. Checklist for middle-level AST work

- Parse with one shared `*token.FileSet`; resolve positions through it.
- Add `parser.ParseComments` only when you actually need comments.
- Walk with `ast.Inspect`; reach for `ast.Walk` when you need per-subtree state.
- Type-switch on node kinds; never blind-assert (`call.Fun` isn't always an `Ident`).
- Decode `BasicLit.Value` with `strconv` before using it.
- For struct/param/field lists, remember `FieldList` and that one `Field` can name several entities.
- Rewrite imports with `astutil`; structural edits with `astutil.Apply`'s cursor.
- Re-emit with `format.Node`; run on gofmt-clean input for minimal diffs.
- Remember the linter is syntactic — add `go/types` when correctness matters.

---

## 8. Summary

Node fields mirror grammar productions, so learning EBNF and learning `go/ast` go together. Nodes fan out from `Expr`/`Stmt`/`Decl`, rooted at `*ast.File`. Positions are opaque `token.Pos` values resolved through a `FileSet`; comments require `parser.ParseComments` and are best attached via `ast.CommentMap`. You can mutate nodes and re-emit with `go/printer`/`go/format`, and `astutil` provides safe import management and cursor-based structural rewrites. A syntactic linter is a few lines of `ast.Inspect` — but remember it sees structure, not types.

---

## Further reading
- `go/ast` overview: https://pkg.go.dev/go/ast
- `go/printer`: https://pkg.go.dev/go/printer
- `go/format`: https://pkg.go.dev/go/format
- `ast.CommentMap`: https://pkg.go.dev/go/ast#CommentMap
- `astutil`: https://pkg.go.dev/golang.org/x/tools/go/ast/astutil
- Go spec (grammar): https://go.dev/ref/spec
