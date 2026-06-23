# Parser & AST — Tasks

Sixteen hands-on exercises plus stretch goals. Each builds a small real tool with `go/parser`, `go/ast`, and `go/token`. Start from this skeleton:

```go
fset := token.NewFileSet()
file, err := parser.ParseFile(fset, path, nil, parser.ParseComments)
if err != nil { log.Fatal(err) }
```

Do them in order — later tasks reuse patterns from earlier ones.

---

## 1. Dump a tree

Parse one of your `.go` files and print it with `ast.Print(fset, file)`. Identify the `*ast.File`, its `Decls`, and one `*ast.FuncDecl`. Find the `*ast.BlockStmt` body in the dump.

## 2. Count functions and methods

Walk with `ast.Inspect`; for each `*ast.FuncDecl`, print the name and whether `Recv != nil` (method vs function). Report a final count of each.

```go
funcs, methods := 0, 0
ast.Inspect(file, func(n ast.Node) bool {
	if fn, ok := n.(*ast.FuncDecl); ok {
		if fn.Recv != nil { methods++ } else { funcs++ }
	}
	return true
})
```

## 3. Find all TODO/FIXME comments

Parse with `parser.ParseComments`. Range over `file.Comments`; for each `*ast.CommentGroup` whose `.Text()` contains `TODO` or `FIXME`, print `file:line: text` using `fset.Position(group.Pos())`.

```go
for _, g := range file.Comments {
	if strings.Contains(g.Text(), "TODO") {
		p := fset.Position(g.Pos())
		fmt.Printf("%s:%d: %s", p.Filename, p.Line, g.Text())
	}
}
```

Expected output is one line per TODO group, sorted by file position.

## 4. List every imported package

Range over `file.Imports` (`[]*ast.ImportSpec`); print each `imp.Path.Value` (the quoted path) and `imp.Name` if an alias is present. Bonus: flag dot-imports (`.`) and blank imports (`_`).

```go
for _, imp := range file.Imports {
	path, _ := strconv.Unquote(imp.Path.Value)
	alias := ""
	if imp.Name != nil { alias = imp.Name.Name } // "_", ".", or a real alias
	fmt.Printf("%-8s %s\n", alias, path)
}
```

## 5. List all called function names

Match `*ast.CallExpr`; type-switch on `call.Fun` to handle `*ast.Ident` (bare calls) and `*ast.SelectorExpr` (`pkg.Func` / `recv.Method`). Print each name with its position.

```go
switch fn := call.Fun.(type) {
case *ast.Ident:        report(fn.Name, fn.Pos())
case *ast.SelectorExpr: report(fn.Sel.Name, fn.Sel.Pos())
}
```

Verify you also see calls inside `go`, `defer`, and function literals.

## 6. Build a call-graph sketch

For each `*ast.FuncDecl`, walk **its body** and collect the names it calls (reuse task 5). Print `caller -> callee` edges. Note in a comment why this is approximate (no type info, so you can't tell two methods named `Run` apart).

## 7. Detect functions over N statements

For each `*ast.FuncDecl` with a body, count statements in `Body.List` (top level only). Flag any function with more than, say, 40 statements. Print name, count, position.

## 8. Detect unused function parameters

For each `*ast.FuncDecl`, collect parameter names from `Type.Params` (`*ast.FieldList`), then walk the body counting `*ast.Ident` uses. Flag params (other than `_`) never referenced. Caveat: this is heuristic without `go/types` scope resolution — write down two cases where it could be wrong.

```go
params := map[string]bool{}
for _, field := range fn.Type.Params.List {
	for _, name := range field.Names { // one field can name several params
		if name.Name != "_" { params[name.Name] = false }
	}
}
ast.Inspect(fn.Body, func(n ast.Node) bool {
	if id, ok := n.(*ast.Ident); ok {
		if _, isParam := params[id.Name]; isParam { params[id.Name] = true }
	}
	return true
})
```

## 9. Find empty `if` / `for` bodies

Match `*ast.IfStmt` and `*ast.ForStmt`; flag any whose `Body.List` is empty (a likely bug or stray `;`). Report positions.

## 10. Rename one identifier (syntactic)

Given an old and new name, walk with `ast.Inspect`, set `id.Name = new` on every matching `*ast.Ident`, then re-emit with `format.Node`. Then write a note: why is this unsafe across scopes, and what would `go/types` add (object identity)?

```go
ast.Inspect(file, func(n ast.Node) bool {
	if id, ok := n.(*ast.Ident); ok && id.Name == old {
		id.Name = newName
	}
	return true
})
format.Node(os.Stdout, fset, file)
```

## 11. Add an import cleanly

Use `astutil.AddImport(fset, file, "strings")` and re-print. Confirm the import block stays sorted and grouped. Then `astutil.DeleteImport` it back out.

```go
astutil.AddImport(fset, file, "strings")
format.Node(os.Stdout, fset, file)
// later:
astutil.DeleteImport(fset, file, "strings")
```

Observe that adding an already-present import is a no-op — `AddImport` is idempotent.

## 12. Wrap every `fmt.Println` argument list (codemod)

With `astutil.Apply`, find calls to `fmt.Println` and rewrite them to `log.Println` (swap the selector's `X` ident from `fmt` to `log`, add the `log` import). Re-emit and diff. Verify the output still parses by re-running `parser.ParseFile` on it.

```go
astutil.Apply(file, func(c *astutil.Cursor) bool {
	if sel, ok := c.Node().(*ast.SelectorExpr); ok {
		if x, ok := sel.X.(*ast.Ident); ok && x.Name == "fmt" && sel.Sel.Name == "Println" {
			x.Name = "log"
		}
	}
	return true
}, nil)
astutil.AddImport(fset, file, "log")
```

Then re-parse the printed bytes and fail loudly if they don't compile.

## 13. Position round-trip

For a chosen node, print `Pos()` and `End()`, resolve both via `fset.Position`, and slice the original source bytes `[offsetStart:offsetEnd]` to confirm you recovered the exact text the node spans.

## 14. Comment-preserving rename with `dst`

Repeat task 10 using `github.com/dave/dst` (`decorator.Parse` → mutate → `decorator.Print`). Rename a documented function and confirm its doc comment survives. Compare the diff quality against your go/ast version from task 10.

---

## 15. Count node kinds

In one `ast.Inspect`, tally `fmt.Sprintf("%T", n)` into a map and print the distribution sorted by count. This builds intuition for which node types dominate real code (spoiler: `*ast.Ident`).

## 16. Find the deepest nesting

Walk while tracking depth (increment on entry, decrement on the `nil` post-visit call) and report the maximum block-nesting depth and where it occurs — a simple complexity signal.

---

## Stretch goals

- **Mini-linter as an `analysis.Analyzer`:** wrap task 12's check using `golang.org/x/tools/go/analysis` with a `SuggestedFix`, and run it under `singlechecker`.
- **Whole-module scan:** load with `go/packages` (`./...`) and run task 3 (TODOs) across every file, sorted by location.
- **Type-aware call graph:** redo task 6 with `pkg.TypesInfo.Uses` so two `Run` methods on different types become distinct edges.

## How to check your work

For each task:

1. **Start small.** Run against a single file you wrote and fully understand, where you can predict the exact output by hand.
2. **Then scale.** Point it at a real package (e.g. something in the standard library or your own module) and sanity-check the volume and shape of results.
3. **Dump when confused.** If a walk does something surprising, `ast.Print(fset, node)` on the offending subtree shows exactly what the parser built.
4. **For codemods, always re-parse the output** before trusting it, and diff against the input to confirm only intended lines changed.

These four habits — predict, scale, dump, verify — turn AST exercises into reliable tools.
