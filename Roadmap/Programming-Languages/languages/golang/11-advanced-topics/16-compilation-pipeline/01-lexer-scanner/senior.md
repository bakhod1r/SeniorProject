# Lexer / Scanner — Senior

This file is about the **production scanner inside `go build`**:
`cmd/compile/internal/syntax`. We cover its mental model, the buffered
`source` rune reader, why it is fast, how it feeds the parser, error recovery,
and position encoding. The std-lib `go/scanner` is the same idea with a
simpler buffer model; the compiler one is tuned harder.

## 1. The gc scanner mental model

The compiler's lexical layer is three small, self-contained files:

| File           | Responsibility                                                  |
| -------------- | -------------------------------------------------------------- |
| `source.go`    | buffered rune reader: bytes → runes, position tracking, segments |
| `scanner.go`   | token recognizer: drives `source`, classifies tokens, ASI, errors |
| `tokens.go`    | the `token`, `Operator`, `LitKind` enums and precedence table  |

The comment at the top of `scanner.go` notes these (plus the generated
`token_string.go`) are deliberately self-contained — they compile on their own
and could be a separate package. That isolation keeps the hottest code in the
compiler decoupled from everything else.

The `scanner` struct **embeds** `source` and adds token state:

```go
type scanner struct {
	source                // embedded buffered reader
	mode   uint           // which comments/directives to report
	nlsemi bool           // pending automatic semicolon

	line, col uint        // start position of current token
	blank     bool        // line is blank up to col (for directive checks)
	tok       token       // current token kind
	lit       string      // literal text (name/literal/semi)
	bad       bool        // literal is malformed
	kind      LitKind     // IntLit/FloatLit/ImagLit/RuneLit/StringLit
	op        Operator    // for operator tokens
	prec      int         // operator precedence
}
```

The parser holds one `scanner` and calls `next()` to advance. There is no
token slice; tokens are produced one at a time, on demand, with no
look-behind buffer. The parser does at most one token of lookahead by keeping
the current token in these fields.

## 2. The `source` buffered rune reader

`source` is the cleverest part. It reads from an `io.Reader` into a byte
buffer and hands out runes one at a time, while keeping the buffer reusable
and tracking line/column. Its layout (from the file's own diagram):

```
                +------ content in use -------+
                v                             v
 buf [...read...|...segment...|ch|...unread...|s|...free...]
                ^             ^  ^            ^
                |             |  |            |
                b         r-chw  r            e
```

Three indices:

- **`b`** (begin): start of the *active segment* — the bytes of the literal or
  identifier currently being scanned, or `-1` when no segment is active.
- **`r`** (read): one past the most recently decoded character `ch`, which
  starts at `r-chw` (`chw` is its byte width).
- **`e`** (end): one past the last byte read from the underlying reader.

The buffer is always terminated at `buf[e]` with a **sentinel** byte equal to
`utf8.RuneSelf` (0x80). That sentinel is the whole trick behind fast ASCII
scanning (next section).

### `nextch` — the per-character engine

```go
func (s *source) nextch() {
redo:
	s.col += uint(s.chw)
	if s.ch == '\n' {
		s.line++
		s.col = 0
	}

	// fast common case: at least one ASCII character
	if s.ch = rune(s.buf[s.r]); s.ch < sentinel {
		s.r++
		s.chw = 1
		if s.ch == 0 {
			s.error("invalid NUL character")
			goto redo
		}
		return
	}

	// slow path: multibyte rune, refill, EOF, BOM, invalid UTF-8 ...
	for s.e-s.r < utf8.UTFMax && !utf8.FullRune(s.buf[s.r:s.e]) && s.ioerr == nil {
		s.fill()
	}
	// ... DecodeRune, handle RuneError, handle BOM ...
}
```

The single `if s.ch < sentinel` test handles the overwhelmingly common case —
ASCII source — with one comparison, one increment, and a return. Because the
buffer is sentinel-terminated at `buf[e]`, that same test *also* detects "we
ran out of buffered bytes" (the sentinel is `>= RuneSelf`), so there is no
separate bounds check in the hot path. Multibyte UTF-8, refilling, EOF, the
BOM check, and invalid-encoding handling all live on the slow path after the
fast `if`.

### Segments: zero-copy literal text

When the scanner starts a token it may call `start()` to mark `b`; when done
it calls `segment()` to get the bytes:

```go
func (s *source) start()          { s.b = s.r - s.chw }
func (s *source) stop()           { s.b = -1 }
func (s *source) segment() []byte { return s.buf[s.b : s.r-s.chw] }
```

`segment()` returns a slice **into the buffer** — no copy. The scanner only
copies to a `string` when it must keep the text (identifier or literal). For
operators, delimiters, and skipped comments it never allocates at all.

### `rewind` — one ugly corner

Go's grammar has exactly one place needing more than one rune of lookahead in
the source layer: distinguishing `...` from `..` from `.`. The scanner handles
it with `rewind`, which resets `r` and `col` to the segment start. The file
comment is blunt: *"Currently, rewind is only needed for handling the source
sequence '..'"*. It must not cross a newline (it adjusts `col`, not `line`).

### `fill` and buffer growth

`fill` preserves the active content (`b..e` or `r..e`), shifts it to the front
or grows the buffer via `nextSize`, then reads more. `nextSize` doubles from a
4 KB minimum up to 1 MB, then grows linearly:

```go
func nextSize(size int) int {
	const min = 4 << 10   // 4K minimum
	const max = 1 << 20   // 1M cap on doubling
	if size < min { return min }
	if size <= max { return size << 1 }
	return size + max
}
```

The reader is retried up to 10 times per `fill` before giving up with
`io.ErrNoProgress`, defending against pathological `io.Reader`s that return
`(0, nil)`.

## 3. Performance of scanning

Scanning runs over every byte of every file you compile, so it is engineered
to be allocation-light and branch-cheap:

- **One comparison for ASCII.** The sentinel trick collapses bounds check and
  ASCII test into a single `if`.
- **Zero-copy segments.** Operators and discarded comments allocate nothing;
  only kept literals/identifiers become strings.
- **Perfect-hash keywords.** `keywordMap[hash(lit)]` with one confirming
  string compare — no map, no allocation, no linear scan.
- **Buffer reuse across files.** `source.init` keeps an existing `s.buf` if
  present, so a scanner reused for many files does not reallocate.
- **No token objects.** Tokens are flat fields on the struct, not heap nodes.

In a normal build the scanner is a small fraction of total time (type checking
and SSA dominate), precisely because it was kept this lean.

## 4. How the scanner feeds the parser

The parser (`cmd/compile/internal/syntax/parser.go`) embeds the scanner and
drives it directly. There is no intermediate token stream and no channel
(an early, since-removed Go prototype used a goroutine + channel; it was
replaced because direct calls are far faster). The pattern:

```go
// parser advances by calling the embedded scanner's next()
func (p *parser) next() { p.scanner.next() }

// typical use: check the current token, then advance
if p.tok == _Lbrace {
	p.next()
	// ... parse block ...
}
```

ASI is invisible to the parser: by the time the parser sees tokens, a `\n`
after an identifier has already become a `_Semi`. The parser's grammar simply
expects semicolons between statements; it never reasons about newlines.

## 5. Error recovery

The scanner never panics on bad input and never stops at the first error. It
reports through an installed handler and keeps producing tokens:

```go
func (s *source) error(msg string) {
	line, col := s.pos()
	s.errh(line, col, msg)        // errh is supplied by the caller
}
```

Recovery strategy by case:

- **Malformed literal** (`bad underscore`, `unterminated string`): the token
  is still emitted as `_Literal` with `bad = true`; the parser treats it as a
  literal and continues, so one typo does not cascade.
- **Invalid UTF-8 / NUL**: reported, then `goto redo` re-reads — the bad byte
  is consumed and scanning resumes.
- **BOM mid-file**: reported but skipped; a leading BOM is silently allowed.
- **Unterminated block comment**: `comment not terminated`, then EOF.

The `errh` callback (a `func(line, col uint, msg string)`) is set by
`scanner.init`. The compiler installs one that funnels into its error list,
deduplicates, and applies the "too many errors" cutoff.

## 6. Position encoding

The compiler tracks positions with `PosBase` and `Pos` (in `pos.go` /
`positions.go`), not the std-lib `token.Pos`. Two ideas:

- **`source` keeps 0-based `line, col`** as it reads, incrementing `col` by
  `chw` per character and resetting `col` and bumping `line` on `\n`. The
  public position is 1-based: `pos()` returns `linebase+line, colbase+col`
  (both bases are 1).

- **`PosBase`** anchors a position to a file (or to a `//line`-redirected
  file). A `//line file.go:10` directive installs a new `PosBase` so that
  subsequent positions report the *directive's* file and line — essential for
  cgo and code generators that want errors to point at the original source.

```go
// conceptually:  Pos = (PosBase, line, col)
// //line foo.go:100  →  new PosBase{filename:"foo.go", line:100}
// the next physical line then reports as foo.go:100
```

This is why a stack trace from `cgo`-generated code can point back into your
`.go` file: the scanner captured the `//line` directive and rebased
subsequent positions.

The std-lib `go/token` does the analogous thing with `File.AddLineColumnInfo`
/ `File.AddLineInfo`, populated when `go/scanner` sees a `//line` directive,
so `fset.Position` reports the rebased location too.

## 7. Comments and directive capture

By default the scanner discards comments entirely — it never even allocates
their text. Two mode bits change that: `comments` (report *all* comments) and
`directives` (report *only* `//line`, `/*line`, and `//go:` comments). The
parser runs in `directives` mode because the compiler must act on pragmas and
line directives but does not care about ordinary comments.

The cheapness of directive detection is deliberate. `lineComment` bails out
before capturing text unless the very next character is `g` or `l`:

```go
// from scanner.go lineComment(), in directives mode
if s.mode&directives == 0 || (s.ch != 'g' && s.ch != 'l') {
	s.stop()       // not a directive: drop the segment
	s.skipLine()   // consume to end of line without keeping bytes
	return
}
```

Only after matching the exact `go:` or `line ` prefix does it keep the
segment. So the common case — a plain `// comment` — costs a fast scan to
end-of-line and zero allocation. This is why directives must be the glued
`//go:`/`//line` form: the scanner's first-character gate would reject anything
else before even looking at the rest.

## 8. Senior takeaways

- The gc lexer is three tight files; `source` is a sentinel-terminated
  buffered rune reader optimized so ASCII costs one comparison.
- Literal text is handed out as **zero-copy slices** (`segment()`); strings
  are materialized only when retained.
- The scanner produces tokens **on demand** with one-token lookahead; the
  parser calls `next()` directly, no channel, no token slice.
- ASI is resolved entirely in the scanner via `nlsemi`, so the parser's
  grammar is newline-agnostic.
- Errors are reported through `errh` and recovered from; bad literals are
  still emitted so parsing continues.
- Positions are `(PosBase, line, col)`; `//line` directives rebase them, which
  is how generated code reports source-accurate errors.

## Further reading

- `source.go` (buffered reader): https://go.dev/src/cmd/compile/internal/syntax/source.go
- `scanner.go`: https://go.dev/src/cmd/compile/internal/syntax/scanner.go
- `tokens.go`: https://go.dev/src/cmd/compile/internal/syntax/tokens.go
- `pos.go` / `positions.go`: https://go.dev/src/cmd/compile/internal/syntax/positions.go
- Go spec, "Semicolons": https://go.dev/ref/spec#Semicolons
- `go/token` position model: https://pkg.go.dev/go/token#FileSet
