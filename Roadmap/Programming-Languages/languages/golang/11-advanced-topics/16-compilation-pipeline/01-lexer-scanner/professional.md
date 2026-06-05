# Lexer / Scanner — Professional

This file is about **shipping tooling** on top of Go's lexical layer: linters,
formatters, code generators, and analyzers. We cover the
`go/scanner`/`go/token` API as a production dependency, how it relates to the
compiler's `cmd/compile/internal/syntax`, how `gofmt` uses scanning, and the
edge cases that bite real tools.

## 1. Two scanners, two audiences

| Concern              | `go/scanner` + `go/token`            | `cmd/compile/internal/syntax`         |
| -------------------- | ------------------------------------- | -------------------------------------- |
| Audience             | tooling (gofmt, vet, linters, you)    | the `gc` compiler internals            |
| Importable           | yes, stable public API                | no (`internal/`), API can change       |
| Position model       | `token.Pos` + `token.FileSet`         | `syntax.Pos` + `syntax.PosBase`        |
| Buffer model         | whole file in a `[]byte`              | streaming `io.Reader` + growable buf   |
| Token set            | `token.Token` (has `COMMENT`, `ELLIPSIS`, etc.) | `syntax.token` (compact, 64-token set) |
| Comment handling     | `ScanComments` mode → `COMMENT` token | `comments`/`directives` mode → callback |
| Used by              | `go/parser`, `go/ast`, `go/types`     | the compiler's own parser/AST          |

**Rule of thumb:** if you are building anything outside the compiler, use
`go/scanner`/`go/token` (or, more often, `go/parser` + `go/ast` which sit on
top of them). Never import `cmd/compile/internal/*` — it is unexported and
unstable, and `go build` will refuse it from outside `GOROOT`.

A subtle difference: `go/scanner` scans an entire source `[]byte` you already
have in memory, whereas the compiler's `source` streams from an `io.Reader`
with a sliding window. For tooling the whole-file model is simpler and just as
fast at file scale.

## 2. The production `go/scanner` API

The full surface you build on:

```go
type Scanner struct{ /* ... */ }

func (s *Scanner) Init(file *token.File, src []byte, err ErrorHandler, mode Mode)
func (s *Scanner) Scan() (pos token.Pos, tok token.Token, lit string)
func (s *Scanner) ErrorCount int  // field, total errors seen

type ErrorHandler func(pos token.Position, msg string)

const (
	ScanComments Mode = 1 << iota  // return COMMENT tokens instead of skipping
	dontInsertSemis                // (internal) used by gofmt-style callers
)
```

`token` side:

```go
fset := token.NewFileSet()
file := fset.AddFile(name, fset.Base(), len(src))
// later: fset.Position(pos) -> token.Position{Filename, Offset, Line, Column}
```

A robust tool always installs an `ErrorHandler` and checks `s.ErrorCount`:

```go
var s scanner.Scanner
var firstErr error
s.Init(file, src, func(p token.Position, msg string) {
	if firstErr == nil {
		firstErr = fmt.Errorf("%s: %s", p, msg)
	}
}, scanner.ScanComments)

for {
	pos, tok, lit := s.Scan()
	if tok == token.EOF {
		break
	}
	_ = pos; _ = lit
}
if s.ErrorCount > 0 {
	return firstErr // file had lexical errors; do not trust the token stream
}
```

## 3. Most tools want the AST, not raw tokens

In practice, lexing alone is rarely what a linter needs. The standard stack:

```
src []byte
  └─ go/scanner   → tokens          (rarely used directly)
       └─ go/parser → *ast.File     (what most tools start from)
            └─ go/ast   → walk/inspect nodes
                 └─ go/types → type information
```

`go/parser.ParseFile` runs the scanner for you and returns an `*ast.File` plus
the `FileSet`. You drop to `go/scanner` directly only when you genuinely need
the *token stream* — e.g. a custom formatter, a syntax highlighter, a tool
counting tokens, or something that must inspect text the AST discards (exact
whitespace between tokens, malformed input you still want to tokenize).

When you *do* need both structure and trivia, `go/parser.ParseComments` keeps
comments in the AST (`ast.File.Comments`, `*ast.CommentGroup`), which is how
gofmt and doc tools preserve and reflow comments.

## 4. How gofmt uses scanning

`gofmt` (and `go/printer`) deliberately work at the AST level, not the token
level, for the structural rewrite — but lexical facts drive its output:

- **Comment attachment.** `go/parser` with `ParseComments` records each
  comment's position (from the scanner) so the printer can re-attach it to the
  nearest node and re-emit it. Floating comments that the scanner located
  between tokens are the hardest part of formatting.
- **Semicolon normalization.** Because ASI already happened in the scanner,
  gofmt simply omits the inserted semicolons in output and relies on the same
  rules round-tripping. This is *why* gofmt can safely delete the `;` you
  typed at a line end: the scanner would re-insert it.
- **`//line` and directives.** The printer preserves `//go:` and `//line`
  directives verbatim because the scanner surfaced them as comments with exact
  text and position; mangling them would break builds.

The practical lesson: a formatter must round-trip the scanner's decisions.
If your tool rewrites source text, re-run it through `go/parser` and compare
the resulting ASTs to guarantee you did not change meaning (gofmt's own tests
do exactly this).

## 5. Building a linter rule: a worked pattern

Say you want to flag `return` statements that are immediately followed on the
next line by an expression — the ASI footgun. You could do it lexically:

```go
// Flag the pattern: a 'return' token whose inserted ';' (the newline)
// is followed by tokens on the next line at greater indentation.
prev := token.ILLEGAL
prevLine := 0
for {
	pos, tok, _ := s.Scan()
	if tok == token.EOF {
		break
	}
	line := fset.Position(pos).Line
	if prev == token.RETURN && tok == token.SEMICOLON && /* synthetic */ true {
		// the next real token on a later line is unreachable
	}
	prev, prevLine = tok, line
	_ = prevLine
}
```

In real life you would use `go/ast` + `go/analysis` for this (it is exactly
what `vet`'s `unreachable` pass does), but the point stands: lexical tools see
the *inserted* semicolons, which is sometimes precisely the signal you want.

The modern, supported way to ship such a check is the `golang.org/x/tools/
go/analysis` framework — write an `*analysis.Analyzer`, get the `*token.FileSet`
and `[]*ast.File` handed to you, and emit diagnostics with positions. It plugs
into `go vet`, `gopls`, and CI uniformly.

## 6. Edge cases that bite real tools

These are the ones that generate bug reports:

1. **BOM at file start.** A UTF-8 BOM (`EF BB BF`) is *allowed* only as the
   first character; the scanner skips it. A BOM mid-file is an error. Tools
   that `bytes.TrimSpace` or slice the source manually can corrupt positions —
   let the scanner handle the BOM.

2. **CRLF line endings.** The scanner treats `\r` as whitespace and drops `\r`
   inside raw strings. A tool that counts `\n` for line numbers but reads
   CRLF files can be off; rely on `token.Position.Line`, never your own count.

3. **`//go:` needs no space.** Linters that "normalize" comments by inserting
   a space after `//` will silently disable `//go:noinline`, `//go:embed`,
   `//go:generate`, etc. Never touch directive comments.

4. **Build tags must precede `package`.** `//go:build` / `// +build` lines are
   only build constraints if they sit before the package clause with a blank
   line after. A tool that reorders top-of-file comments can break the build.

5. **Raw vs interpreted strings.** A rewriter that re-quotes strings must not
   turn `` `a\b` `` (literal backslash) into `"a\b"` (escape) — different
   bytes. Use `strconv.Quote`/`Unquote` and `strconv.Unquote` for raw strings
   carefully; `Unquote` handles both forms.

6. **Malformed but tokenizable input.** With an error handler installed, the
   scanner still returns tokens for bad literals (`bad = true` on the compiler
   side; in `go/scanner` the literal text is returned and `ErrorCount`
   increments). Tools must check `ErrorCount` before trusting the stream.

7. **`ELLIPSIS` and `...`.** `...` is one token (`token.ELLIPSIS`); the
   scanner's one-token lookahead distinguishes it from `..` (which is a syntax
   error) and `.`. A naive hand-rolled tokenizer often gets this wrong.

8. **Numeric literals with separators.** `1_000`, `0x_FF`, `0b1010` are valid;
   `1__0`, `_1`, `1_` are not. A tool that re-emits numbers must preserve the
   underscores exactly or it changes the source text (gofmt preserves them).

9. **Implicit semicolons and trailing commas.** Removing a trailing comma in a
   multi-line composite literal turns the prior line's literal into a
   semicolon-terminated statement, producing a syntax error. Code generators
   that emit Go must keep trailing commas.

## 7. Source rewriting safely: the round-trip rule

Any tool that emits or rewrites Go source must respect the scanner's
decisions, or it will produce code that compiles to something different — or
not at all. The discipline that makes rewriting safe:

```go
// 1. Parse the original into an AST (this runs the scanner for you).
fset := token.NewFileSet()
orig, err := parser.ParseFile(fset, name, src, parser.ParseComments)
if err != nil {
	return err
}

// 2. Mutate the AST (rename, insert, reorder nodes) — never edit text directly.

// 3. Print it back out with go/printer (or format.Node), which re-derives
//    formatting and re-applies the scanner's rules (semicolons, etc.).
var buf bytes.Buffer
if err := format.Node(&buf, fset, orig); err != nil {
	return err
}

// 4. Re-parse the output and compare ASTs to prove meaning is unchanged.
check, err := parser.ParseFile(token.NewFileSet(), name, buf.Bytes(), 0)
if err != nil {
	return fmt.Errorf("rewrite produced invalid Go: %w", err)
}
_ = check
```

The reason step 3 is safe is that `go/printer` emits source that the scanner
will re-tokenize identically: it never puts `{` on its own line after `)`,
always keeps trailing commas, never inserts a space into a directive, and
re-quotes strings with `strconv`. Hand-editing source text bypasses all of
that and is how rewriters introduce ASI bugs.

## 8. Working with directives in tooling

Because directives are *just comments* to the scanner, a tool that needs to
find or preserve them works at the comment level:

```go
// With ScanComments, COMMENT tokens carry directive text verbatim.
for {
	pos, tok, lit := s.Scan()
	if tok == token.EOF {
		break
	}
	if tok == token.COMMENT && strings.HasPrefix(lit, "//go:") {
		fmt.Printf("%s pragma: %s\n", fset.Position(pos), lit)
	}
}
```

Things tooling must get right with directives:

- **Never normalize the spacing.** `//go:embed` must stay glued; inserting a
  space silently disables it. Many naive "comment formatters" have shipped
  exactly this regression.
- **`//go:build` placement.** It must come before the `package` clause with a
  blank line after. A tool that sorts or moves leading comments must special-
  case build constraints (gofmt does, and even *synthesizes* the new-style
  `//go:build` from a legacy `// +build`).
- **`//line` rebasing.** If your tool reports positions, honor `//line`
  directives by using `fset.Position` (which already accounts for them) rather
  than counting newlines yourself.

## 9. Performance for tooling

For a one-shot CLI, scanning cost is negligible; for an editor backend
(`gopls`) that re-scans on every keystroke across thousands of files, it
matters:

- Reuse a single `token.FileSet` across files in a run; it deduplicates and
  compacts position storage.
- Reuse one `scanner.Scanner` value by calling `Init` again per file — `Init`
  resets state and the struct is cheap to keep around.
- Prefer `go/parser` incremental reuse via `gopls`' snapshot model rather than
  re-parsing whole packages; the scanner is fast but `go/types` is not.

## 10. Professional takeaways

- Build on `go/scanner`/`go/token` (and usually `go/parser`/`go/ast` above
  them); never import the compiler's `internal/syntax`.
- Always install an `ErrorHandler` and gate on `ErrorCount` before trusting
  tokens.
- gofmt round-trips the scanner's ASI and comment decisions — your rewriters
  must too; verify by re-parsing and comparing ASTs.
- The biting edge cases are directives (no space, must precede `package`),
  raw-vs-interpreted strings, numeric separators, BOM/CRLF, and trailing
  commas under ASI.
- Ship checks through `golang.org/x/tools/go/analysis` so they integrate with
  `go vet` and `gopls`.

## Further reading

- `go/scanner` docs: https://pkg.go.dev/go/scanner
- `go/token` docs: https://pkg.go.dev/go/token
- `go/parser` docs: https://pkg.go.dev/go/parser
- `go/analysis` framework: https://pkg.go.dev/golang.org/x/tools/go/analysis
- gofmt / `go/printer` source: https://go.dev/src/go/printer/printer.go
- Compiler directives: https://pkg.go.dev/cmd/compile#hdr-Compiler_Directives
- Build constraints (`//go:build`): https://pkg.go.dev/cmd/go#hdr-Build_constraints
