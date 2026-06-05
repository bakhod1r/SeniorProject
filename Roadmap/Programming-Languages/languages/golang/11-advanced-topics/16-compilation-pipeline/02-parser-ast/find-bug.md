# Parser & AST — Find the Bug

Twenty realistic AST/parser bugs. For each: the **code**, the **symptom**, the **cause**, and the **fix**. Read the code first, decide where it breaks, then check yourself against the cause. They are ordered roughly from "walk mechanics" to "semantic/codemod" so the patterns build on each other.

---

## 1. Mutating a slice while iterating it in `Inspect`

```go
ast.Inspect(file, func(n ast.Node) bool {
	if blk, ok := n.(*ast.BlockStmt); ok {
		for i, s := range blk.List {
			if isDebug(s) {
				blk.List = append(blk.List[:i], blk.List[i+1:]...) // delete in place
			}
		}
	}
	return true
})
```

**Symptom:** panics, skipped statements, or stale nodes still visited.
**Cause:** you mutate `blk.List` while ranging it, and `ast.Inspect` has no notion of structural edits — it keeps walking the old children, and index `i` is wrong after the splice. This is the AST version of the classic "modify-slice-during-range" bug, made worse because the walker holds its own reference to the slice.
**Fix:** use `astutil.Apply` and `c.Delete()`, which understands the cursor's parent/slot:

```go
astutil.Apply(file, func(c *astutil.Cursor) bool {
	if isDebug(c.Node()) {
		c.Delete() // safe; cursor knows the slot
	}
	return true
}, nil)
```

If you must use raw ast, build a new slice and assign once after the loop — never splice mid-range.

---

## 2. Losing comments because `ParseComments` wasn't set

```go
file, _ := parser.ParseFile(fset, "x.go", src, 0)
// ... edit ...
format.Node(out, fset, file)
```

**Symptom:** the re-emitted file has **no comments at all**.
**Cause:** mode `0` discards comments during parsing; they were never in the tree.
**Fix:** parse with `parser.ParseComments`:

```go
file, _ := parser.ParseFile(fset, "x.go", src, parser.ParseComments)
```

(And remember comments are positional — see bugs 9 and 11.)

---

## 3. Wrong positions from a missing / wrong FileSet

```go
fset := token.NewFileSet()
file, _ := parser.ParseFile(fset, "a.go", srcA, 0)

other := token.NewFileSet()             // different FileSet!
pos := other.Position(file.Pos())       // resolve A's pos against B
```

**Symptom:** garbage filename, wrong line, or `-` / line 0.
**Cause:** a `token.Pos` is only an offset into the `FileSet` that created it. Resolving it against a *different* `FileSet` is meaningless.
**Fix:** use exactly the same `fset` you parsed with for every `fset.Position(...)` call. Pass it around; don't create a second one. A good habit is to bundle them:

```go
type parsed struct {
	fset *token.FileSet
	file *ast.File
}
```

so the two can never drift apart.

---

## 4. Forgetting precedence is already in the tree

```go
// "is this a + b * c?" — author expects a flat list of operands
bin := node.(*ast.BinaryExpr)
fmt.Println(bin.X, bin.Op, bin.Y) // expects three idents a, +, b*c flattened
```

**Symptom:** confusion that `bin.Y` is itself a `*ast.BinaryExpr`, not an ident.
**Cause:** `a + b * c` parses as `+(a, *(b, c))`. The `*` binds tighter, so it's nested below `+`. There is no flat operand list.
**Fix:** recurse. Treat `BinaryExpr.X` and `.Y` as arbitrary expressions and walk down:

```go
func operands(e ast.Expr, out *[]ast.Expr) {
	if b, ok := e.(*ast.BinaryExpr); ok {
		operands(b.X, out)
		operands(b.Y, out)
		return
	}
	*out = append(*out, e) // a leaf operand
}
```

Precedence is encoded in tree shape, not re-derivable from a flat sequence.

---

## 5. Type-asserting the wrong node type

```go
call := n.(*ast.CallExpr)
name := call.Fun.(*ast.Ident).Name   // assume Fun is always an Ident
```

**Symptom:** `panic: interface conversion: ast.Expr is *ast.SelectorExpr, not *ast.Ident` on `pkg.Func()`.
**Cause:** `CallExpr.Fun` can be `*ast.Ident` (`foo()`), `*ast.SelectorExpr` (`pkg.Foo()`), `*ast.FuncLit` (IIFE), `*ast.IndexExpr` (generic instantiation), `*ast.ParenExpr`, etc.
**Fix:** use the comma-ok form and a type switch:

```go
switch fn := call.Fun.(type) {
case *ast.Ident:        useName(fn.Name)
case *ast.SelectorExpr: useName(fn.Sel.Name)
}
```

---

## 6. `ParseExpr` vs `ParseFile` mismatch

```go
expr, err := parser.ParseExpr("package main\nfunc main(){}")
```

**Symptom:** `expected 'EOF', found 'package'` error.
**Cause:** `ParseExpr` parses a **single expression**, not a file. A package clause is not an expression.
**Fix:** use `parser.ParseFile` for whole files; reserve `ParseExpr` for snippets like `"a + b"` or `"f(x)"`:

```go
expr, _ := parser.ParseExpr("a + b*c") // single expression only
file, _ := parser.ParseFile(fset, "m.go", wholeFileSrc, 0)
```

---

## 7. Ignoring the `nil` callback call in `Inspect`

```go
depth := 0
ast.Inspect(file, func(n ast.Node) bool {
	depth++                 // increments on the nil call too
	fmt.Println(n.Pos())    // panic on nil
	return true
})
```

**Symptom:** `nil pointer dereference`, or off-by miscounts.
**Cause:** `ast.Inspect` calls the function with `nil` after visiting a node's children (so you can pop state). Author dereferences `n` without checking.
**Fix:** guard `if n == nil` before touching `n`:

```go
ast.Inspect(file, func(n ast.Node) bool {
	if n == nil {
		return false // post-visit signal, not a real node
	}
	depth++
	return true
})
```

---

## 8. Reading `Ident.Obj` expecting type information

```go
id := n.(*ast.Ident)
if id.Obj.Kind == ast.Var { ... } // assume Obj is populated and typed
```

**Symptom:** `nil` panic, or wrong answers; `id.Obj` is nil under newer code.
**Cause:** `Ident.Obj` is the **legacy, file-local** object-resolution pass — it carries no real type info and is `nil` when parsed with `SkipObjectResolution` (which many tools now set). It never knew types.
**Fix:** for semantic questions use `go/types`. Don't rely on `Ident.Obj`:

```go
if obj := pkg.TypesInfo.Uses[id]; obj != nil {
	if v, ok := obj.(*types.Var); ok {
		use(v) // a real, typed object
	}
}
```

---

## 9. Comments dropped when replacing a node

```go
astutil.Apply(file, func(c *astutil.Cursor) bool {
	if fn, ok := c.Node().(*ast.FuncDecl); ok && fn.Name.Name == "Old" {
		c.Replace(&ast.FuncDecl{Name: ast.NewIdent("New"), Type: fn.Type, Body: fn.Body})
	}
	return true
}, nil)
```

**Symptom:** the function's doc comment vanishes after printing.
**Cause:** you built a fresh `FuncDecl` without copying `Doc`, and comments are floated by position — the new node has `NoPos`, so the old doc comment no longer attaches.
**Fix:** mutate in place instead of replacing, which keeps `Doc` and positions intact:

```go
if fn, ok := c.Node().(*ast.FuncDecl); ok && fn.Name.Name == "Old" {
	fn.Name.Name = "New" // Doc, positions, everything else preserved
}
```

For heavy comment-preserving structural rewrites, use the `dst` library.

---

## 10. `ast.Walk` with a Visitor that returns the wrong thing

```go
type v struct{}
func (v v) Visit(n ast.Node) ast.Visitor { return nil } // stop immediately

ast.Walk(v{}, file)
```

**Symptom:** only the root is visited; nothing nested is seen.
**Cause:** `Visit` returning `nil` tells `ast.Walk` **not to descend**. Returning `nil` at the root prunes the entire tree.
**Fix:** return the visitor to keep descending; return `nil` only for subtrees you intentionally skip:

```go
func (v v) Visit(n ast.Node) ast.Visitor {
	if shouldSkip(n) {
		return nil // prune just this subtree
	}
	return v // keep descending
}
```

(`ast.Inspect` is the easier `bool`-returning wrapper and avoids this footgun.)

---

## 11. Re-printing a non-gofmt'd file and blaming the codemod

```go
// input file had tabs/spaces mixed, custom alignment
format.Node(out, fset, file) // after a one-line change
```

**Symptom:** the diff touches hundreds of unrelated lines.
**Cause:** `go/printer` ignores original whitespace and applies gofmt rules; a non-canonical input gets fully reformatted on output.
**Fix:** run `gofmt`/`goimports` on inputs first (or require clean input), so the only changed lines are the ones you edited. Even better for surgical changes, emit **position-keyed text edits** instead of re-printing the whole file — only the touched byte ranges change:

```go
// analysis.SuggestedFix style: edit just the bytes you mean to change
edit := analysis.TextEdit{Pos: sel.X.Pos(), End: sel.X.End(), NewText: []byte("log")}
```

---

## 12. Matching `fmt.Println` by name only

```go
sel := call.Fun.(*ast.SelectorExpr)
if sel.X.(*ast.Ident).Name == "fmt" && sel.Sel.Name == "Println" { flag() }
```

**Symptom:** false positives (a local `fmt` variable, or a different package aliased to `fmt`) and false negatives (`import f "fmt"`).
**Cause:** the AST is purely syntactic; `fmt` is just an identifier string, not a resolved package.
**Fix:** resolve with `go/types`:

```go
if fn, ok := info.Uses[sel.Sel].(*types.Func); ok &&
	fn.Pkg() != nil && fn.Pkg().Path() == "fmt" && fn.Name() == "Println" {
	flag()
}
```

Load via `go/packages` with `NeedTypes|NeedTypesInfo` so `info` is populated.

---

## 13. Assuming `*ast.GenDecl` is a single declaration

```go
gd := decl.(*ast.GenDecl)
spec := gd.Specs[0].(*ast.ValueSpec) // only look at the first
```

**Symptom:** miss variables in `var ( a int; b string )` or grouped `const (...)`.
**Cause:** a `GenDecl` groups **many** specs (the parenthesised form). Reading only `Specs[0]` ignores the rest.
**Fix:** range over `gd.Specs`, and within each `ValueSpec` range over `spec.Names`:

```go
for _, spec := range gd.Specs {
	vs, ok := spec.(*ast.ValueSpec)
	if !ok { continue }
	for _, name := range vs.Names { // a, b, c int → three names
		use(name.Name)
	}
}
```

---

## 14. Modifying `Ident.Name` but expecting all references to rename

```go
ast.Inspect(file, func(n ast.Node) bool {
	if id, ok := n.(*ast.Ident); ok && id.Name == "oldVar" {
		id.Name = "newVar" // rename "all" occurrences
	}
	return true
})
```

**Symptom:** renames unrelated identifiers in other scopes that happen to share the name; misses none but over-renames.
**Cause:** purely syntactic name matching ignores scope. Two different `oldVar`s in different functions are distinct objects but the same string.
**Fix:** use `go/types` object identity — resolve the target object once, then rename only idents that resolve to it:

```go
var target types.Object = info.Defs[declIdent] // the one we mean
ast.Inspect(file, func(n ast.Node) bool {
	if id, ok := n.(*ast.Ident); ok &&
		(info.Uses[id] == target || info.Defs[id] == target) {
		id.Name = "newVar" // only the right object, any scope
	}
	return true
})
```

This is exactly how `gopls`/`gorename` rename safely.

---

## 15. Treating `BasicLit.Value` as the decoded value

```go
lit := n.(*ast.BasicLit)
if lit.Kind == token.STRING {
	s := lit.Value           // expect: hello
	useString(s)             // actually got: "hello" (with quotes)
}
```

**Symptom:** off-by-quotes strings, or numeric parses that fail because of underscores/`0x` prefixes.
**Cause:** `BasicLit.Value` is the **raw source text** of the literal, including quotes, escapes, `0x`, digit separators, etc. It is not the decoded Go value.
**Fix:** decode it. For strings use `strconv.Unquote`; for ints, `strconv.ParseInt` with base 0 (handles `0x`, `0b`, underscores); for `token.CHAR`, unquote then take the rune. The AST stores syntax, not evaluated constants — constant *folding* is a later, type-checked phase.

```go
s, err := strconv.Unquote(lit.Value) // "hello" -> hello
```

---

## 16. Walking only `file.Decls` and missing nested functions

```go
for _, d := range file.Decls {
	if fn, ok := d.(*ast.FuncDecl); ok {
		analyze(fn) // only top-level funcs seen
	}
}
```

**Symptom:** function literals (`func(){...}` assigned to vars, passed as callbacks, used in `go`/`defer`) are never analysed.
**Cause:** `file.Decls` is only the **top-level** declarations. A `*ast.FuncLit` lives deep inside expressions/statements, not in `Decls`.
**Fix:** use `ast.Inspect` over the whole file and match both `*ast.FuncDecl` and `*ast.FuncLit` if you care about every function body:

```go
ast.Inspect(file, func(n ast.Node) bool {
	switch fn := n.(type) {
	case *ast.FuncDecl: analyzeBody(fn.Body)
	case *ast.FuncLit:  analyzeBody(fn.Body)
	}
	return true
})
```

---

## 17. Forgetting that `SelectorExpr.X` is recursive

```go
sel := call.Fun.(*ast.SelectorExpr)
pkg := sel.X.(*ast.Ident).Name // assume X is always a package ident
```

**Symptom:** panic on `a.b.C()` or `pkg.Sub.Func()` where `sel.X` is itself a `*ast.SelectorExpr`, not an `*ast.Ident`.
**Cause:** `SelectorExpr.X` is an arbitrary `ast.Expr`. `a.b.c` parses as `Selector(Selector(a, b), c)` — nested selectors, not a flat path.
**Fix:** handle the chain explicitly, or resolve with `go/types` to learn whether the leftmost ident is a package — `info.ObjectOf(base)` returns a `*types.PkgName` for a real package qualifier. For a quick "package.Name" check, assert `sel.X` is `*ast.Ident` with comma-ok and bail otherwise:

```go
if base, ok := sel.X.(*ast.Ident); ok {
	useQualified(base.Name, sel.Sel.Name)
}
```

---

## 18. Building a node with the wrong child interface

```go
ret := &ast.ReturnStmt{
	Results: []ast.Expr{
		&ast.AssignStmt{ /* ... */ }, // a Stmt where an Expr is required
	},
}
```

**Symptom:** doesn't compile — `*ast.AssignStmt` does not implement `ast.Expr`. Or, if you force it via `any`, the printer panics.
**Cause:** the AST uses `Expr`/`Stmt`/`Decl` marker interfaces precisely to prevent category errors. An assignment is a statement, not an expression.
**Fix:** put the right category in each slot. Assignment isn't an expression in Go, so emit it as a separate statement and then return the assigned ident:

```go
// x := compute(); return x
&ast.AssignStmt{Lhs: []ast.Expr{x}, Tok: token.DEFINE, Rhs: []ast.Expr{call}}
&ast.ReturnStmt{Results: []ast.Expr{x}}
```

The `Expr`/`Stmt`/`Decl` interfaces exist precisely to catch this category error at compile time.

---

## 19. Re-parsing generated output without checking it compiles

```go
out := render(file)
os.WriteFile(path, out, 0o644) // trust the rewrite blindly
```

**Symptom:** committed code that doesn't build; CI breaks across the repo.
**Cause:** an AST rewrite can produce syntactically broken output — a bad graft, a dangling import, a node with a stale position that the printer mangles. Writing it without verification ships the breakage repo-wide.
**Fix:** re-parse the bytes before writing, and treat a parse error as a hard stop (and ideally `go build` before merging):

```go
if _, err := parser.ParseFile(token.NewFileSet(), path, out, 0); err != nil {
	return fmt.Errorf("codemod produced invalid Go: %w", err)
}
os.WriteFile(path, out, 0o644)
```

---

## 20. Using `ParseDir` and missing `_test.go` or build-tagged files

```go
pkgs, _ := parser.ParseDir(fset, dir, nil, 0) // filter == nil
```

**Symptom:** analysis misses files excluded by build constraints, or unexpectedly *includes* `_test.go` files, depending on assumptions.
**Cause:** `parser.ParseDir` is naive — it parses every `.go` file in the directory regardless of build tags or GOOS/GOARCH, and its `filter` only sees `fs.FileInfo` (name/size), not build context. It does not understand `//go:build`.
**Fix:** for anything build-aware, use `go/packages` (or `go/build` + `build.Context`) which respects constraints, test files, and the active platform. Reserve `ParseDir` for simple, tag-agnostic scans.

```go
cfg := &packages.Config{Mode: packages.NeedSyntax | packages.NeedFiles}
pkgs, _ := packages.Load(cfg, dir) // respects build tags, GOOS/GOARCH, _test.go
for _, p := range pkgs {
	for _, f := range p.Syntax { analyze(f) }
}
```

---

## Summary

The recurring root causes: (1) treating the AST as flat or syntactic when it is **nested and untyped** (bugs 4, 12, 14, 17), (2) mishandling the **walk contract** — nil callbacks, visitor return values, mutation during iteration (1, 7, 10), (3) **position/FileSet** mistakes that corrupt locations (3, 9, 11), (4) **comment handling**, which is positional and fragile (2, 9, 11), (5) **wrong node assumptions** — `Fun` isn't always an `Ident`, `GenDecl` groups specs, `Ident.Obj` isn't type info, `BasicLit.Value` is raw text, `Decls` is top-level only (5, 8, 13, 15, 16, 18), and (6) **output hygiene** — verify it parses, respect build tags (19, 20). The cure for the semantic ones is almost always "add `go/types`"; the cure for the structural ones is "use `astutil.Apply` and the same `FileSet`, respect the walk contract, and re-parse your output."

Quick reference of the traps:

| # | Trap | One-line fix |
| --- | --- | --- |
| 1 | mutate slice mid-walk | `astutil.Apply` + `c.Delete` |
| 2 | comments dropped | `parser.ParseComments` |
| 3 | wrong FileSet | reuse the parsing `fset` |
| 4 | precedence flat | recurse into `BinaryExpr` |
| 5 | `Fun` not `Ident` | type-switch on `call.Fun` |
| 6 | `ParseExpr` on a file | use `ParseFile` |
| 7 | nil callback deref | guard `n == nil` |
| 8 | `Ident.Obj` for types | use `go/types` |
| 9 | comment lost on replace | mutate in place / `dst` |
| 10 | Visitor returns nil | return the visitor |
| 11 | reformat noise | gofmt-clean input |
| 12 | name-only match | resolve with `go/types` |
| 13 | one spec assumed | range `GenDecl.Specs` |
| 14 | rename ignores scope | object identity |
| 15 | `BasicLit.Value` raw | `strconv.Unquote` etc. |
| 16 | only `file.Decls` | walk for `FuncLit` too |
| 17 | `Sel.X` always ident | handle nested selectors |
| 18 | wrong child category | match `Expr`/`Stmt`/`Decl` |
| 19 | unverified output | re-parse before write |
| 20 | `ParseDir` ignores tags | use `go/packages` |

### The two questions that prevent most of these

Before writing any AST code, ask:

1. **"Is this question syntactic or semantic?"** If it touches types, scopes, package identity, or "what does this name *really* refer to," you need `go/types` — syntax alone will be wrong (bugs 8, 12, 14, 17). If it's pure shape (count `if`s, find `func`s), syntax is fine.
2. **"Am I reading or rewriting?"** Reading: respect the walk contract — guard `nil`, return the right value, don't mutate mid-iteration (bugs 1, 7, 10). Rewriting: use `astutil.Apply` for structure, keep the same `FileSet`, preserve positions/comments, run on gofmt-clean input, and re-parse the output (bugs 3, 9, 11, 19).

Answer those two and the twenty bugs above mostly can't happen.

### One more habit

When a walk does something you don't understand, **dump the subtree**: `ast.Print(fset, node)`. Most "mystery" AST bugs evaporate the moment you see the actual node types the parser produced — that `a.b.c` is nested selectors, that `Fun` is a `SelectorExpr`, that your "single" `GenDecl` has three specs. The printer is the AST debugger; reach for it before guessing.
