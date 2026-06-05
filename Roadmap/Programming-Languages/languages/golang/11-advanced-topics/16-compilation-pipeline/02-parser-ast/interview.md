# Parser & AST — Interview

Twenty-five questions plus rapid-fire on parsing, recursive descent, AST nodes, the two trees, comments, and codemods. Answers are concise; expand with examples in a real interview. The recurring themes to lean on: **parsing is purely syntactic** (meaning comes later) and **the AST is the grammar made concrete** (precedence lives in tree shape).

---

**Q1. What does the parser do, and what does it produce?**
It consumes the scanner's token stream and builds an Abstract Syntax Tree (AST) — a tree of typed nodes mirroring the program's grammatical structure. It verifies the input is grammatically well-formed but does *no* type checking. The pipeline is:

```
source bytes → scanner → tokens → parser → AST → (type checker) → IR → ... → machine code
```

The parser sits between the scanner and the type checker. Its single responsibility is shape: "is this a valid sequence of declarations, statements, and expressions?"

**Q2. Which standard-library packages do you use to parse Go for tooling?**
`go/parser` (`ParseFile`), `go/token` (positions and the `FileSet`), and `go/ast` (node types and walkers like `Inspect`/`Walk`). For type-aware work add `go/types` and load with `golang.org/x/tools/go/packages`. The compiler's own parser (`cmd/compile/internal/syntax`) is internal and not what tools import.

**Q3. What kind of parser does the gc compiler use?**
A hand-written **recursive-descent** parser in `cmd/compile/internal/syntax/parser.go` — one method per grammar production, one-token lookahead. It's not table-driven/yacc-generated. The call stack mirrors the tree:

```
sourceFile() → decl() → funcDecl() → blockStmt() → stmt() → ifStmt() → expr() ...
```

Each method assumes the current token starts its production, consumes tokens, and returns a node. The nesting of calls *is* the nesting of the resulting tree.

**Q4. Why recursive descent rather than a generated parser?**
Precise, contextual error messages and full control over error recovery and sync points, plus speed. Because the parser always knows which production it's in, it can emit "expected `;`, found `}`" and choose a sensible follow set, instead of a generic "syntax error" from a table-driven engine. The downside is writing one function per production by hand. (Older Go used a yacc-generated parser; it was replaced.)

**Q5. How are binary-operator precedence and associativity handled?**
Via **precedence climbing** in a single loop: parse a unary expr, then while the next operator binds tighter than the current floor, recurse. This produces a left-associative tree where higher-precedence operators nest deeper — precedence is baked into tree shape. Go has five binary precedence levels:

```
1: ||
2: &&
3: == != < <= > >=
4: + - | ^
5: * / % << >> & &^   (tightest)
```

Without this technique you'd need one parser method per level (`orExpr → andExpr → ...`); the loop collapses them into one function.

**Q6. So where does `b*c` end up in `a + b*c`?**
Below the `+`: the tree is `+(a, *(b, c))`. `BinaryExpr.Y` of the `+` is itself a `*ast.BinaryExpr`. There's no flat operand list — to process operands you recurse:

```go
func walk(e ast.Expr) {
	if b, ok := e.(*ast.BinaryExpr); ok {
		walk(b.X); walk(b.Y) // children may themselves be BinaryExprs
		return
	}
	// leaf: Ident, BasicLit, ...
}
```

**Q7. What is error recovery and why does a compiler need it?**
To report many errors in one run, the parser must resynchronise after an error instead of stopping. It skips tokens until a known "sync"/follow token (`;`, `}`, `case`, next decl) so one bad statement doesn't cascade into spurious errors. When it can't build a real node it inserts a **bad node** (`*ast.BadExpr`/`BadStmt`/`BadDecl`) so the rest of the tree stays well-formed — which is why `ParseFile` can return a partial `*ast.File` *and* an error.

**Q8. Name the three core AST interfaces.**
`ast.Expr` (produces a value), `ast.Stmt` (performs an action), `ast.Decl` (declares names). All embed `ast.Node` (which has `Pos()`/`End()`), and unexported marker methods keep the sets disjoint:

```go
type Expr interface { Node; exprNode() }
type Stmt interface { Node; stmtNode() }
type Decl interface { Node; declNode() }
```

The marker methods are unexported, so external packages can't accidentally make a node satisfy the wrong category.

**Q9. What's the root node of a parsed file?**
`*ast.File` — holds `Name` (package ident), `Decls` (top-level declarations), `Imports`, and `Comments`. A set of files is an `*ast.Package`. Note `Decls` is **top-level only**:

```go
for _, d := range file.Decls {
	switch d := d.(type) {
	case *ast.FuncDecl: // func/method
	case *ast.GenDecl:  // import/const/type/var (grouped)
	}
}
```

Nested function literals (`*ast.FuncLit`) live inside expressions/statements, not in `Decls` — walk the tree to find them.

**Q10. What is a `token.Pos` and how do you make it human-readable?**
An opaque integer offset into a `FileSet`. Resolve it with `fset.Position(pos)`:

```go
p := fset.Position(node.Pos())
fmt.Printf("%s:%d:%d\n", p.Filename, p.Line, p.Column)
```

`token.NoPos` (0) means no position; a node spans `[Pos(), End())`.

**Q11. Why a separate FileSet instead of line numbers on nodes?**
So positions across many files share one coordinate space (one FileSet for a whole tool run), keeping nodes small (just an int) and positions globally comparable. The corollary bug: resolving a `Pos` against a *different* `FileSet` than the one that produced it yields garbage — always reuse the parsing `fset`.

**Q12. How do you keep comments, and why are they tricky?**
Parse with `parser.ParseComments`. They're tricky because comments are **not children** of nodes — they float in `file.Comments` and are re-attached by the printer based on position. `ast.NewCommentMap` helps associate them; rewrites easily lose or misplace them because moving a node changes its position. Doc comments (`FuncDecl.Doc`, etc.) are the ones directly above a declaration with no blank line.

**Q13. What is `Ident.Obj`, and should you rely on it?**
A legacy, file-local name-resolution result (`*ast.Object`). It carries **no type information** and is nil under `parser.SkipObjectResolution`. For real semantics use `go/types`:

```go
obj := info.Uses[id]  // or info.Defs[id]
typ := info.TypeOf(expr)
```

These come from running the type checker, which the parser deliberately does not do.

**Q14. Difference between `ast.Inspect` and `ast.Walk`?**
`Walk` takes an `ast.Visitor` whose `Visit` returns a visitor (`nil` to prune that subtree). `Inspect` is the convenience wrapper taking `func(ast.Node) bool` (`false` to prune). `Inspect` also calls you with `nil` after a node's children, so you can pop state:

```go
ast.Inspect(file, func(n ast.Node) bool {
	if n == nil { return false } // post-visit signal
	// ... pre-visit work ...
	return true
})
```

Neither supports structural replacement — for that use `astutil.Apply` and its cursor.

**Q15. `CallExpr.Fun` — what types can it be?**
`*ast.Ident` (`foo()`), `*ast.SelectorExpr` (`pkg.Foo()` / `x.M()`), `*ast.FuncLit` (IIFE), `*ast.IndexExpr`/`IndexListExpr` (generic instantiation), `*ast.ParenExpr`, etc. Always type-switch, never assert blindly:

```go
switch fn := call.Fun.(type) {
case *ast.Ident:        // foo()
case *ast.SelectorExpr: // pkg.Foo() or x.M()
case *ast.IndexExpr:    // Generic[int]()
}
```

A blind `call.Fun.(*ast.Ident)` panics on the very common `pkg.Func()` form.

**Q16. Explain the two ASTs in Go.**
`cmd/compile/internal/syntax` is the compiler's own lean, fast, internal tree (it can change between releases). `go/ast` is the stable, public std-lib tree used by external tooling. They hold the same information but different shapes and aren't interchangeable.

| | `syntax` | `go/ast` |
| --- | --- | --- |
| user | the gc compiler | external tools |
| stability | internal, can change | public, frozen API |
| positions | compact `syntax.Pos` | `token.Pos` + `FileSet` |
| goal | speed/low alloc | ergonomics/stability |

`go/ast` predates the rewritten compiler and must stay backward-compatible; `syntax` is tuned for compiler performance.

**Q16b. Can you convert between the two ASTs?**
Not directly — they're unrelated types. You'd re-derive one from source. In practice you never need to: tools use `go/ast`, the compiler uses `syntax`, and neither crosses into the other. The shared thing is the *source* and the *grammar* they both encode.

**Q17. After parsing, how does the compiler proceed?**
The noder (`cmd/compile/internal/noder`) walks the `*syntax.File`, type-checks via `types2` (the compiler's internal `go/types`), and builds the typed `ir` tree, which feeds SSA and code generation. Parsing and type-checking are separate phases:

```
syntax parser → *syntax.File → noder + types2 → ir.Node tree → SSA → codegen
```

This is why a syntactically valid file can still fail to compile, and why tools built only on `go/ast` (no `go/types`) can be fooled by anything semantic.

**Q18. How do you re-emit an AST as source?**
`go/printer` (`printer.Fprint`) or `go/format` (`format.Node`, which also applies gofmt):

```go
var buf bytes.Buffer
format.Node(&buf, fset, file) // gofmt-formatted source
```

Caveat: the printer reformats by gofmt rules and uses positions for layout — run on gofmt-clean input to keep diffs minimal.

**Q19. What's the biggest risk in an AST codemod, and how do you reduce it?**
Producing broken or noisy output: lost/misplaced comments (positional in go/ast), full reformatting of non-canonical files, and false positives from name-only matching. Mitigate by:

- resolving identifiers with `go/types` (load via `go/packages`),
- using `astutil.Apply`'s cursor for structural edits,
- running only on gofmt-clean input,
- re-parsing the output to confirm it still compiles,
- reaching for `dst` when comment fidelity through structural moves is critical.

**Q20. How does the parser consume the scanner, and how much lookahead does it need?**
The parser embeds the scanner and advances with `p.next()`, keeping the current token in `p.tok` (and its text in `p.lit`). It decides which production to enter from that single current token — effectively **one-token lookahead**. Where Go would otherwise be ambiguous (composite literals in `if` headers, conversions vs. calls, generic instantiation vs. indexing), the parser either restricts the grammar in that position or builds a structurally valid node and defers the meaning to the type checker, rather than peeking arbitrarily far ahead.

**Q20b. What's automatic semicolon insertion and why does it matter to the parser?**
Go's lexical rule inserts a `;` after a newline that follows certain tokens (identifiers, literals, `)`, `}`, `return`, etc.). The scanner does this, so by the time the parser runs, statement terminators are present. That's why Go source has no visible semicolons yet the grammar is semicolon-delimited — and why a misplaced newline (e.g. an opening brace on its own line after `if`) changes parsing.

**Q21. How would you find every function call in a file, and what's the gotcha?**
Walk for `*ast.CallExpr` and type-switch on `call.Fun`. The gotcha is that `Fun` is not always an `*ast.Ident` — `pkg.Foo()` is a `*ast.SelectorExpr`, generic instantiations are `*ast.IndexExpr`, and IIFEs are `*ast.FuncLit`. A blind assertion panics.

```go
ast.Inspect(file, func(n ast.Node) bool {
	if call, ok := n.(*ast.CallExpr); ok {
		switch fn := call.Fun.(type) {
		case *ast.Ident:        record(fn.Name)
		case *ast.SelectorExpr: record(fn.Sel.Name)
		}
	}
	return true
})
```

**Q22. What's the difference between `parser.ParseFile` returning an error and panicking?**
It never panics on malformed Go — it performs error recovery, fills `BadX` placeholder nodes, and returns a (possibly partial) `*ast.File` together with a non-nil `error`:

```go
file, err := parser.ParseFile(fset, name, src, 0)
if err != nil {
	log.Println(err)   // report
}
if file != nil {
	analyze(file)      // partial tree may still be usable
}
```

A panic would indicate a bug or truly invalid arguments (e.g. a nil `FileSet`). Tools should handle the partial tree gracefully — that's the whole point of error recovery.

**Q23. When do you reach for `dst` over `go/ast`?**
When a codemod must preserve comments and formatting through structural moves. `dst` attaches decorations (comments, spacing) to the nodes themselves, so moving a node moves its comments. The tradeoff is losing first-class `go/types` integration and adding a dependency, so you often parse with `dst` for fidelity but resolve types via a separate `go/ast`+`go/types` pass.

**Q24. What is the `analysis` framework and why use it?**
`golang.org/x/tools/go/analysis` is the standard plumbing behind `go vet`, `golangci-lint`, and `gopls` diagnostics. An `analysis.Analyzer` declares its dependencies (commonly `inspect.Analyzer` for a fast indexed traversal), receives a `*analysis.Pass` with `Files`, `TypesInfo`, and `Pkg`, reports via `pass.Reportf`, and can attach `SuggestedFix`es as position-keyed `TextEdit`s. Using it gives you shared parse/type passes across many checks and a uniform, testable interface (`analysistest`).

**Q24b. How would you find all callers of a specific package function across a module?**
Load with `go/packages` (`NeedSyntax|NeedTypes|NeedTypesInfo|NeedDeps`), resolve the target `*types.Func` once, then in each file walk `*ast.CallExpr` nodes and check `info.Uses[sel.Sel] == target`. This is type-correct across aliased imports and unaffected by same-named methods on other types — the whole point of resolving rather than string-matching.

**Q25. Walk me through building a tool that renames an exported function safely.**
Load the package(s) with `go/packages` requesting `NeedSyntax|NeedTypes|NeedTypesInfo`. Find the target's `types.Object` (via `Defs` at its declaration). Walk every file with `astutil.Apply`; for each `*ast.Ident`, rename it only if `info.Uses[id] == target || info.Defs[id] == target`. Re-emit with `format.Node` on gofmt-clean files, re-parse to confirm validity, and finally `go build ./...` to confirm the rename is consistent across the package graph (including other packages that import it). Object identity — not string matching — is what makes it correct across scopes and files.

---

### Rapid-fire

- **`ParseExpr` vs `ParseFile`?** `ParseExpr` parses a single expression; `ParseFile` parses a whole file.
- **What does `parser.ImportsOnly` do?** Stops parsing after the import block — fast import scans.
- **Is the AST typed?** No. Types come from `go/types`/`types2`, a later phase.
- **Left or right associative binary ops in Go?** Left.
- **What framework do `go vet` checks use?** `golang.org/x/tools/go/analysis`.
- **How does `gopls` rename safely?** By `go/types` object identity, not string matching.
- **What is `token.NoPos`?** The zero `token.Pos` — "no position", common on synthesised nodes.
- **Does `GenDecl` hold one spec or many?** Many — `var ( a int; b string )` is one `GenDecl` with multiple specs.
- **What does `parser.SkipObjectResolution` skip?** Building `Ident.Obj`/`File.Scope` — the legacy name-binding pass.
- **Span of a node?** `[Pos(), End())` — `End()` is the byte *after* the last character.
- **What does the noder do?** Walks `*syntax.File`, type-checks via `types2`, builds the `ir` tree.
- **Why not reuse `go/ast` in the compiler?** Its public API is frozen and its shape isn't ideal for a fast front-end.
- **Is `BasicLit.Value` decoded?** No — it's raw source; use `strconv.Unquote`/`ParseInt`.
- **What handles `if x == T{}` ambiguity?** The grammar forbids bare composite literals in `if`/`for`/`switch` headers.
- **Conversion vs. call disambiguation?** Deferred to the type checker; the parser builds a `CallExpr` either way.
- **What's in `*ast.File`?** `Name`, `Decls` (top-level only), `Imports`, `Comments`.
- **`CommentMap` is for?** Associating floating comments with the nodes they describe.
- **`astutil.Apply` vs `ast.Inspect`?** `Apply` has a parent-aware cursor that can Replace/Delete/Insert; `Inspect` can't.
- **What makes a codemod diff clean?** gofmt-clean input + position-keyed text edits (not full re-print).
- **Two ASTs — interchangeable?** No. `syntax.File` and `ast.File` are separate types.

---

### How to talk about this in an interview

Tie everything back to two themes and you'll sound senior: (1) **parsing is purely syntactic** — it produces structure, and all meaning (types, scopes, resolution) is a *later* phase, which is why syntactic tools get fooled and why you reach for `go/types`; (2) **the AST is a tree shaped by the grammar**, so precedence/associativity live in node nesting, `Fun` isn't always an `Ident`, and `GenDecl` groups specs. Most "gotcha" questions are an application of one of these two ideas. For tooling questions, the senior answer almost always includes "resolve with `go/types`, rewrite with `astutil.Apply`, emit minimal diffs, and verify the output compiles."
