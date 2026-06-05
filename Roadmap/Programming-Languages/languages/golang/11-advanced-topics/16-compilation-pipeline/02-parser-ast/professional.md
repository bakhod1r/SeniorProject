# Parser & AST — Professional

## 0. The landscape of real tools

Before writing your own, know what production tools already do this — and what techniques they use, because you'll borrow them:

| Tool | Technique |
| --- | --- |
| `gofmt` / `gofumpt` | parse → `go/printer` round-trip (canonical formatting) |
| `goimports` | AST + import resolution to add/remove imports |
| `gopls` rename | `go/types` object identity across the whole package graph |
| `golangci-lint` | runs many `analysis.Analyzer`s over a shared parse/type pass |
| `go fix` / `gofmt -r` | rule-based AST rewrites |
| `eg` (x/tools) | example-based template rewrites |
| `dst`-based codemods | comment-preserving structural edits |

The common thread: the serious ones resolve types, not just syntax, and they emit minimal diffs. Your tool should do the same.

---

## 1. The job: codemods at scale

At a professional level you stop writing toy linters and start writing **codemods** — programs that mechanically rewrite hundreds or thousands of files: renaming an API, migrating a deprecated call, injecting context parameters, restructuring imports across a monorepo. The AST is the substrate. The hard part is almost never "find the node." It is **emitting code a human will accept in review** — formatting preserved, comments intact, diffs minimal — and being *correct* across aliased imports, shadowed names, generics, and build-tagged files.

The mental shift from earlier tiers: a junior asks "how do I match this node?"; a professional asks "how do I match it *without false positives*, rewrite it *without losing comments*, and ship it *without breaking the build*?" Almost everything below is about those three "withouts."

The standard toolchain:

| Tool | Role |
| --- | --- |
| `go/parser` + `go/ast` | parse and match |
| `go/types` + `go/packages` | resolve identifiers to real definitions (kill false positives) |
| `astutil.Apply` | structural rewrite with a parent-aware cursor |
| `go/format` / `go/printer` | re-emit |
| `golang.org/x/tools/go/analysis` | the framework `go vet` and most linters use |
| `dst` (decorated syntax tree) | when comment/formatting fidelity is critical |

---

## 2. Load packages properly, not files

A real refactoring tool must resolve types. `go/packages` loads a package with full type information (it drives `go build`/`go list` under the hood):

```go
import "golang.org/x/tools/go/packages"

cfg := &packages.Config{
	Mode: packages.NeedSyntax | packages.NeedTypes |
		packages.NeedTypesInfo | packages.NeedName | packages.NeedFiles,
}
pkgs, err := packages.Load(cfg, "./...")
```

Now for each `pkg` you have `pkg.Syntax []*ast.File` **and** `pkg.TypesInfo`, which maps `*ast.Ident` to the `types.Object` it refers to. This is how you distinguish "the real `fmt.Println`" from "a method named `Println` on some local type" or "`fmt` shadowed by a variable." Skipping this step is the single biggest source of broken codemods.

```go
// Is this selector REALLY net/http.Get, not some other .Get?
sel := call.Fun.(*ast.SelectorExpr)
if obj := pkg.TypesInfo.Uses[sel.Sel]; obj != nil {
	if fn, ok := obj.(*types.Func); ok &&
		fn.Pkg() != nil && fn.Pkg().Path() == "net/http" && fn.Name() == "Get" {
		// safe to rewrite
	}
}
```

The `TypesInfo` maps are the workhorses:

| Map | Maps | Use |
| --- | --- | --- |
| `Defs[*ast.Ident]` | the object **defined** by this ident | find declarations |
| `Uses[*ast.Ident]` | the object this ident **refers to** | resolve references |
| `Types[ast.Expr]` | the type & value of an expression | "is this an `io.Reader`?" |
| `Selections[*ast.SelectorExpr]` | field/method selection details | distinguish field vs method |

With these you stop guessing from names and start asking the type system. This is the single dividing line between toy and production tooling.

---

## 3. Rewriting with `astutil.Apply`

`astutil.Apply` gives you a `*astutil.Cursor` that knows the node's parent and slot, so you can replace, delete, or insert safely:

```go
astutil.Apply(file, func(c *astutil.Cursor) bool {
	call, ok := c.Node().(*ast.CallExpr)
	if !ok {
		return true
	}
	if isTargetCall(call, info) {
		c.Replace(buildReplacement(call))
	}
	return true
}, nil)
```

The pre-func returns `false` to prune. The post-func (second arg) runs after children — useful when a rewrite depends on already-transformed children. **Never** mutate the slice you're ranging in `ast.Inspect`; use `Apply`'s cursor instead.

The cursor's full vocabulary is what makes structural edits possible:

| Method | Effect |
| --- | --- |
| `c.Node()` | the current node |
| `c.Parent()` | its parent node |
| `c.Name()`, `c.Index()` | which field/slot it occupies |
| `c.Replace(n)` | swap this node for `n` |
| `c.Delete()` | remove from a slice-valued slot |
| `c.InsertBefore(n)` / `c.InsertAfter(n)` | insert siblings (slice slots only) |

`Delete` and `Insert*` only work where the node lives in a slice (e.g. `BlockStmt.List`, `GenDecl.Specs`) — calling them on a scalar field panics. That constraint is exactly why naive `ast.Inspect` deletion is unsafe: `Inspect` has no parent/slot concept at all.

---

## 3.5 Matching with the `inspector` for speed

When you scan many files for a few node kinds, the `golang.org/x/tools/go/ast/inspector` package builds an index once and filters by type without re-walking:

```go
import "golang.org/x/tools/go/ast/inspector"

insp := inspector.New(pkg.Syntax)
insp.WithStack([]ast.Node{(*ast.CallExpr)(nil)},
	func(n ast.Node, push bool, stack []ast.Node) bool {
		if !push { return true }
		call := n.(*ast.CallExpr)
		_ = stack // ancestors, parent-aware without astutil
		return true
	})
```

`WithStack` even gives you the ancestor stack, so you get parent context for read-only analysis. The `analysis` framework's `inspect.Analyzer` is exactly this, shared across all analyzers in a run — which is why a hundred linters can share one traversal.

---

## 4. The fragility of AST rewrites

The brutal truth: **`go/ast` was designed for reading, not for surgical editing.** Several footguns recur.

### 4.1 Printing re-formats everything

`go/printer` ignores your original whitespace and applies `gofmt` rules. If your codebase is already gofmt-clean, the *only* lines that change are the ones you touched — good. But if you re-print a file that had non-canonical formatting, you get a giant diff. **Always run codemods on gofmt-clean input**, or your "rename one function" PR rewrites 400 lines.

### 4.2 Comments float and get lost or misplaced

Comments in `go/ast` are **not children** of the nodes they describe. They live in `file.Comments` and are re-attached by the printer based on **positions**. When you move or replace a node, its position changes (or becomes `NoPos`), and the printer can:

- drop the comment entirely,
- attach it to the wrong node,
- duplicate it.

`ast.CommentMap` helps you read associations, but keeping them correct through a rewrite is genuinely hard. This is the #1 complaint about go/ast codemods.

### 4.3 Position-driven layout

The printer uses node positions to decide line breaks and blank lines. New nodes with `token.NoPos` collapse onto one line; nodes carrying stale positions from elsewhere produce bizarre spacing. You must either set sane positions or accept reflowing.

### 4.4 Synthesised nodes are easy to get subtly wrong

Hand-building an `*ast.CallExpr` is verbose and error-prone. Many teams build replacement snippets by **parsing a template string** instead:

```go
expr, _ := parser.ParseExpr("log.Info().Msg(MSG)")
// then graft real args into the parsed tree
```

`parser.ParseExpr` parses a single expression — handy, but note it returns a tree with positions relative to its own tiny source, which complicates grafting into a larger file.

---

## 4.5 A complete small codemod, end to end

Tying §2–§4 together: migrate every `errors.New(fmt.Sprintf(...))` to `fmt.Errorf(...)` across a module. The skeleton of a production-grade run:

```go
func main() {
	cfg := &packages.Config{Mode: packages.NeedSyntax | packages.NeedTypes |
		packages.NeedTypesInfo | packages.NeedName | packages.NeedFiles}
	pkgs, _ := packages.Load(cfg, "./...")

	for _, pkg := range pkgs {
		for i, file := range pkg.Syntax {
			if isGenerated(file) {
				continue // skip "DO NOT EDIT" files
			}
			changed := false
			astutil.Apply(file, func(c *astutil.Cursor) bool {
				call, ok := c.Node().(*ast.CallExpr)
				if !ok || !isErrorsNewOfSprintf(call, pkg.TypesInfo) {
					return true
				}
				c.Replace(buildErrorf(call)) // errors.New(fmt.Sprintf(a,b)) → fmt.Errorf(a,b)
				changed = true
				return true
			}, nil)

			if !changed {
				continue
			}
			path := pkg.GoFiles[i]
			var buf bytes.Buffer
			if err := format.Node(&buf, pkg.Fset, file); err != nil {
				log.Printf("%s: print failed: %v", path, err)
				continue
			}
			// Verify before writing.
			if _, err := parser.ParseFile(token.NewFileSet(), path, buf.Bytes(), 0); err != nil {
				log.Printf("%s: codemod produced invalid Go, skipping: %v", path, err)
				continue
			}
			os.WriteFile(path, buf.Bytes(), 0o644)
		}
	}
}
```

The professional habits on display: load with types, skip generated files, only touch files you changed, print with `format.Node`, and **re-parse before writing**. The two helpers (`isErrorsNewOfSprintf`, `buildErrorf`) carry the actual logic; the harness around them is what keeps the change safe and reviewable.

---

## 5. The `dst` library tradeoff

`github.com/dave/dst` ("decorated syntax tree") exists precisely to fix the comment/formatting fragility. In `dst`, **comments and spacing are attached to the nodes themselves** (as "decorations"), not floated by position. Move a node and its comments move with it.

```go
import "github.com/dave/dst/decorator"

f, _ := decorator.Parse(src)        // dst.File, comments attached to nodes
// ... rewrite the dst tree; comments follow their nodes ...
decorator.Print(f)                  // emits, comments preserved correctly
```

| | `go/ast` | `dst` |
| --- | --- | --- |
| Comment fidelity through rewrites | poor (position-based) | strong (node-attached) |
| Std-lib / stable | yes | third-party |
| `go/types` integration | first-class (`TypesInfo`) | needs mapping back to ast |
| API familiarity | universal | extra learning curve |

The honest tradeoff: `dst` makes **comment-preserving structural edits** dramatically easier, but you lose direct `go/types` integration (you map dst↔ast to get type info) and add a dependency. Rule of thumb: pure-syntactic, comment-sensitive codemods → `dst`; type-aware analysis or `analysis.Analyzer` plugins → `go/ast` + `go/types`. Many production tools parse with `dst` for editing fidelity and run a separate `go/types` pass for resolution.

In `dst`, decorations live on each node as `Start`/`End`/`After` slots, so you write comments explicitly where you want them — moving a node carries them along instead of leaving them stranded by position. That single design difference eliminates the most painful class of `go/ast` codemod bugs.

---

## 6. The `analysis` framework

For anything that ships (vet checks, golangci-lint plugins), use `golang.org/x/tools/go/analysis`. It standardises: receiving `*analysis.Pass` (with `pass.Files`, `pass.TypesInfo`, `pass.Pkg`), reporting diagnostics via `pass.Reportf`, declaring dependencies on other analyzers (`inspect.Analyzer` for a pre-built, fast AST traversal), and even **suggested fixes** (`analysis.SuggestedFix` with `TextEdit`s) that tools can auto-apply.

```go
var Analyzer = &analysis.Analyzer{
	Name:     "noprintln",
	Requires: []*analysis.Analyzer{inspect.Analyzer},
	Run:      run,
}
```

Suggested fixes are **text edits keyed by position**, not AST mutations — sidestepping the print-reformatting problem entirely because only the targeted byte ranges change.

A minimal analyzer that reports and offers a fix:

```go
func run(pass *analysis.Pass) (any, error) {
	insp := pass.ResultOf[inspect.Analyzer].(*inspector.Inspector)
	insp.Preorder([]ast.Node{(*ast.CallExpr)(nil)}, func(n ast.Node) {
		call := n.(*ast.CallExpr)
		sel, ok := call.Fun.(*ast.SelectorExpr)
		if !ok { return }
		obj := pass.TypesInfo.Uses[sel.Sel]
		fn, ok := obj.(*types.Func)
		if !ok || fn.Pkg() == nil || fn.Pkg().Path() != "fmt" || fn.Name() != "Println" {
			return
		}
		pass.Report(analysis.Diagnostic{
			Pos:     call.Pos(),
			Message: "avoid fmt.Println; use the logger",
			SuggestedFixes: []analysis.SuggestedFix{{
				Message: "replace fmt with log",
				TextEdits: []analysis.TextEdit{{
					Pos: sel.X.Pos(), End: sel.X.End(), NewText: []byte("log"),
				}},
			}},
		})
	})
	return nil, nil
}
```

Note three professional touches: it uses the shared `inspect.Analyzer` for a fast indexed traversal, it resolves the call via `pass.TypesInfo.Uses` (not by name), and the fix is a byte-range `TextEdit` so the diff is exactly the four characters `fmt` → `log`.

---

## 6.5 Testing codemods and analyzers

A codemod without tests is a liability — it runs over your whole repo. Two established patterns:

- **Golden files.** Keep `testdata/in/foo.go` and `testdata/out/foo.go`; the test runs the codemod on the input and diffs against the expected output. Regenerate goldens with a `-update` flag. This catches formatting and comment regressions, not just logic.
- **`analysistest` for analyzers.** `golang.org/x/tools/go/analysis/analysistest` runs an analyzer against `testdata` packages and checks `// want "regexp"` comments on the exact lines diagnostics should appear:

```go
func TestAnalyzer(t *testing.T) {
	dir := analysistest.TestData()
	analysistest.RunWithSuggestedFixes(t, dir, Analyzer, "a")
}
```

```go
// in testdata/src/a/a.go
fmt.Println("x") // want "avoid fmt.Println"
```

`RunWithSuggestedFixes` also applies the analyzer's `SuggestedFix` edits and compares against a `.golden` file — so you test both the diagnostic *and* the fix.

Always include adversarial fixtures: aliased imports, shadowed names, generated files, build-tagged files, and the no-op (idempotency) case. Those are exactly where name-based or position-based logic breaks.

---

## 7. Real footguns checklist

- **Run on gofmt-clean files** or accept noisy diffs.
- **Resolve with `go/types`** before rewriting; never match on names alone (imports get aliased and shadowed).
- **Use `astutil.Apply`'s cursor**, never mutate slices mid-`Inspect`.
- **Comments are positional in go/ast** — verify them in output; consider `dst` if they matter.
- **Generated files** (`// Code generated ... DO NOT EDIT.`) should usually be skipped.
- **Build tags / multiple files per package**: load with `go/packages`, handle every file, not just `*.go` you happened to glob.
- **`parser.ParseExpr` positions** don't align with the target file — fix positions or use text-edit output.
- **Idempotency**: running the codemod twice should be a no-op. Test it.
- **Always re-parse the output** to confirm it still compiles before writing to disk.

---

## 7.5 Rolling a codemod across a large repo

The technical rewrite is half the job; landing it without breaking everyone is the other half.

- **Idempotency is non-negotiable.** Running the codemod twice must be a no-op. Test it explicitly — a non-idempotent codemod produces churn on every rerun and makes rebases hell. The usual cause is matching the *output* form as if it were input (e.g. rewriting `fmt.Errorf` again into itself).
- **Split mechanical from semantic changes.** Land the pure rename/migration in one PR with no behaviour change, so reviewers can trust the diff is mechanical. Bundle nothing else.
- **Respect ownership and CI.** A repo-wide change touches many teams' code. Generate per-package or per-owner PRs rather than one giant diff; run each package's tests.
- **Handle partial failures gracefully.** If file N fails to type-check or re-parse, skip it and report — don't abort the whole run or, worse, write half a file.
- **Provide an escape comment.** A `//nolint`-style opt-out or a allowlist lets teams defer adoption without blocking the rollout.
- **Verify the build after, not just the parse.** Re-parsing proves syntactic validity; only `go build ./...` (and tests) proves the migration is semantically correct. Run it before merging.

These are the differences between a script that "works on my three test files" and a tool that safely rewrites a million-line monorepo.

---

## 7.6 When to use `gofmt -r` instead of writing code

Not every rewrite needs a Go program. `gofmt -r 'pattern -> replacement'` does syntactic, type-blind rewrites with wildcard placeholders:

```sh
gofmt -r 'a[b:len(a)] -> a[b:]' -w ./...
```

Lowercase single-letter identifiers in the pattern are wildcards. It's perfect for **purely syntactic, type-independent** transforms (simplifications, mechanical API shape changes) and it preserves formatting well. Reach for a full `go/ast`+`go/types` tool only when you need type resolution, scope awareness, or logic a pattern can't express. Knowing this saves you from writing a 200-line codemod for a one-line `gofmt -r`.

The decision rule:

| Situation | Tool |
| --- | --- |
| simple syntactic pattern, no types needed | `gofmt -r` |
| import add/remove | `goimports` / `astutil` |
| needs type resolution or scope | `go/ast` + `go/types` + `astutil.Apply` |
| comment-critical structural move | `dst` |
| ships as a reusable check | `analysis.Analyzer` |

---

## 8. Summary

Production AST work is codemods, and the difficulty is producing review-clean output, not finding nodes. Load packages with `go/packages` so you can resolve identifiers via `go/types` and avoid name-based false positives; rewrite with `astutil.Apply`'s parent-aware cursor; re-emit with `go/format`. The core fragilities are that `go/printer` reformats and that comments are positional and easily lost — `dst` solves comment fidelity at the cost of std-lib integration. For shipped checks, the `analysis` framework with position-keyed `SuggestedFix` edits gives the cleanest diffs. Run on gofmt-clean input, skip generated files, ensure idempotency, and re-parse output before writing.

---

## Further reading
- `go/packages`: https://pkg.go.dev/golang.org/x/tools/go/packages
- `go/analysis`: https://pkg.go.dev/golang.org/x/tools/go/analysis
- `astutil`: https://pkg.go.dev/golang.org/x/tools/go/ast/astutil
- `go/types`: https://pkg.go.dev/go/types
- `dst`: https://pkg.go.dev/github.com/dave/dst
- Writing analyzers (passes README): https://github.com/golang/tools/blob/master/go/analysis/passes/README.md
