# Lexer / Scanner — Tasks

Hands-on exercises. Each has a **goal** and **steps**. They build on
`go/scanner` + `go/token`; later tasks reference the compiler's
`cmd/compile/internal/syntax` for reading, not importing. Work top to bottom —
they roughly increase in difficulty.

---

## Task 1: Tokenize a file

**Goal.** Print every token of a `.go` file as `position kind literal`.

**Steps.**
1. `os.ReadFile` the file into `src`.
2. Build a `token.NewFileSet()` and `fset.AddFile(name, fset.Base(), len(src))`.
3. `var s scanner.Scanner; s.Init(file, src, nil, scanner.ScanComments)`.
4. Loop calling `s.Scan()`; stop at `token.EOF`.
5. Print `fset.Position(pos)`, `tok`, `lit` for each token.

---

## Task 2: Count tokens by kind

**Goal.** Produce a histogram of token kinds, sorted by frequency.

**Steps.**
1. Reuse Task 1's loop.
2. Keep a `map[token.Token]int`, increment per token.
3. After EOF, sort entries by count descending and print.
4. Observe how often `token.SEMICOLON` appears versus how many you typed.

---

## Task 3: Detect automatic semicolon insertions

**Goal.** Report every `;` the scanner inserted that you did **not** type.

**Steps.**
1. Scan with the error handler installed.
2. For each `token.SEMICOLON`, inspect `lit`: a real `;` you typed reports
   `lit == ";"`, while an inserted one reports `lit == "\n"` (the newline) or
   `"EOF"`.
3. Print the position of every inserted semicolon.
4. Verify against the ASI rules: each should follow an ident, literal,
   `)`/`]`/`}`, `++`/`--`, or `return`/`break`/`continue`/`fallthrough`.

---

## Task 4: Find the last token of each line

**Goal.** For each source line, print its final token kind — the thing ASI
keys on.

**Steps.**
1. Scan, tracking `fset.Position(pos).Line` for each token.
2. When the line number changes, the *previous* token was the last on the old
   line; record it.
3. Print `line -> lastTokenKind`.
4. Cross-check: lines whose last token is in the ASI set get a synthetic `;`.

---

## Task 5: Classify every literal

**Goal.** List all literals in a file grouped by kind (INT, FLOAT, IMAG, CHAR,
STRING).

**Steps.**
1. Scan; collect tokens where `tok` is `token.INT`, `FLOAT`, `IMAG`, `CHAR`, or
   `STRING`.
2. Bucket them into a `map[token.Token][]string` keyed by kind.
3. Print each bucket. Add a file containing `42`, `0x2A`, `0o52`, `0b1010`,
   `3.14`, `1e9`, `0x1p-2`, `1_000`, `3i`, `'x'`, `"s"`, `` `raw` `` and
   confirm the classification.

---

## Task 6: Validate numeric separators

**Goal.** Flag numeric literals with illegal underscores.

**Steps.**
1. Build small test sources containing `1_000` (ok), `0xFF_` (bad), `1__0`
   (bad), `_500` (bad), `0x_FF` (ok).
2. Scan each with an `ErrorHandler` that records messages.
3. Confirm the bad ones produce `'_' must separate successive digits` and the
   good ones produce no error.

---

## Task 7: Tell raw strings from interpreted strings

**Goal.** For each string literal, report whether it is raw (backtick) or
interpreted, and its unquoted value.

**Steps.**
1. Scan and collect `token.STRING` literals.
2. The first byte of `lit` is `` ` `` for raw, `"` for interpreted.
3. Use `strconv.Unquote(lit)` to get the actual string value (it handles both
   forms) and print it.
4. Test with `"a\tb"` vs `` `a\tb` `` and observe the different unquoted bytes.

---

## Task 8: Find all directives in a repository

**Goal.** List every `//go:` and `//line` directive across a tree.

**Steps.**
1. `filepath.WalkDir` over a repo, selecting `.go` files.
2. Scan each with `scanner.ScanComments` so `COMMENT` tokens appear.
3. For each `token.COMMENT`, check whether the text begins with `//go:` or
   `//line ` (exact, no space after `//`).
4. Print `file:line directive`. Tally the most common pragmas (`//go:build`,
   `//go:generate`, `//go:embed`, ...).

---

## Task 9: Build a token-stream diff

**Goal.** Decide whether two files are token-equivalent (differ only in
whitespace/comments).

**Steps.**
1. Tokenize both files, skipping `token.COMMENT` and ignoring positions.
2. Compare the resulting `(kind, lit)` sequences element by element.
3. Report the first divergence, or "token-equivalent".
4. Test with a file and its `gofmt`ed version — they should be token-equivalent.

---

## Task 10: Reproduce the brace-ASI bug programmatically

**Goal.** Show that `func f()\n{` tokenizes with an inserted `;`.

**Steps.**
1. Put `func f()\n{\n}\n` in a `[]byte`.
2. Scan it; print the token stream.
3. Confirm a `token.SEMICOLON` (lit `"\n"`) appears between `)` and `{`.
4. Now scan `func f() {\n}\n` and confirm no semicolon appears there.

---

## Task 11: Measure scanner throughput

**Goal.** Benchmark scanning in MB/s and allocations per file.

**Steps.**
1. Write a `BenchmarkScan` (see the optimize file) using a large `.go` file.
2. Call `b.SetBytes(int64(len(src)))` and `b.ReportAllocs()`.
3. Run `go test -bench=Scan -benchmem`.
4. Record MB/s and allocs/op. Try a file with many comments vs none.

---

## Task 12: Read the gc scanner source

**Goal.** Map the std-lib behavior you observed onto the compiler's code.

**Steps.**
1. Open `cmd/compile/internal/syntax/source.go`; find `nextch` and the
   sentinel fast path.
2. Open `scanner.go`; find `next`, `ident`, `number`, and the `nlsemi`
   assignments.
3. List which sub-scanners set `s.nlsemi = true` and match them to the ASI
   spec rule.
4. Find `hash` and `keywordMap`; confirm the perfect-hash keyword lookup.

---

## Task 13: Tokenize from an `io.Reader` (compiler style)

**Goal.** Appreciate the streaming model by scanning without reading the whole
file first.

**Steps.**
1. The std-lib `go/scanner` needs the full `[]byte`, so read the file fully —
   but note the contrast.
2. Read `source.go`'s `fill`/`nextSize` to see how the compiler streams from an
   `io.Reader` with a growable buffer instead.
3. Write a short note (for yourself) on when streaming matters (huge generated
   files) versus when whole-file is simpler (tooling).

---

## Task 14: Build a minimal highlighter

**Goal.** Emit ANSI-colored source by token kind.

**Steps.**
1. Scan with `ScanComments`, keeping each token's start offset
   (`fset.Position(pos).Offset`) and `lit`.
2. Map kinds to colors: keywords one color, literals another, comments a third,
   identifiers default.
3. Walk the original `src` bytes, wrapping each token's span in the ANSI code,
   preserving the whitespace between tokens (the scanner skips it, so copy the
   gap bytes verbatim).
4. Print to a terminal and eyeball the result.

---

## Stretch goals

- Add a flag to Task 1 that prints only tokens matching a kind.
- Extend Task 8 to also flag `//go:` directives that have an illegal space
  (`//go: name`) — a real lint.
- Make Task 9 a CI check that fails if two files diverge in tokens.
