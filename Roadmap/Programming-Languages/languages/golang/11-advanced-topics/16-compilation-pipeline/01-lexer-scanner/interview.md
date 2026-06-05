# Lexer / Scanner — Interview

About twenty questions and answers on Go's lexical layer: tokens, ASI,
literals, the gc scanner, `go/scanner` vs `go/token`, and directives. Answers
are concise but complete enough to say out loud.

## Q1. What is a lexer and where does it sit in `go build`?

A lexer (scanner/tokenizer) is the first stage of compilation. It reads source
**bytes** and emits a stream of **tokens** — meaningful units with a kind,
optional literal text, and a position. The pipeline is: bytes → lexer → tokens
→ parser → AST → type check → SSA → machine code. The lexer does *not* check
whether the program is valid Go; it only splits tokens.

## Q2. What are the two scanners in the Go ecosystem?

`go/scanner` + `go/token` is the **public, stable** standard library scanner
used by tooling (gofmt, vet, linters). `cmd/compile/internal/syntax` is the
**internal** scanner the actual compiler uses. Same job; the compiler one
streams from an `io.Reader` with a sliding buffer and is tuned harder. Tools
should never import the internal package.

## Q3. What information does a token carry?

A **kind** (identifier, keyword, operator, literal, semicolon, ...), the
**literal text** for names and literals, and a **position**. In the compiler's
`scanner` struct that is `tok`, `lit`, plus `kind` (`LitKind`), `op`
(`Operator`), `prec`, `bad`, and the start `line`/`col`.

## Q4. Explain automatic semicolon insertion.

Go's grammar needs semicolons between statements, but you rarely type them
because the **lexer inserts them**. The rule: at a line's end, insert `;` if
the final token was an identifier; an int/float/imaginary/rune/string literal;
one of `break`/`continue`/`fallthrough`/`return`; or one of `++`/`--`/`)`/`]`/
`}`. A second rule lets you omit `;` before a closing `)` or `}`.

## Q5. Why must the opening brace be on the same line as `func`/`if`?

Because of ASI. `func main()` ends with `)`, which triggers a semicolon. If
`{` is on the next line, the scanner produces `func main() ;` then a stray
block — a syntax error (`missing function body`). The "One True Brace Style" is
enforced by the lexer, not by convention.

## Q6. What is a classic ASI bug with `return`?

```go
return
	x
```

`return` triggers ASI, so a `;` is inserted right after it. The function
returns its zero value and `x` is unreachable code. `go vet` flags it, but it
compiles. Always keep the return value on the same line as `return`.

## Q7. How does the scanner implement ASI internally?

A single boolean `nlsemi` on the scanner. Each sub-scanner sets it: after an
identifier or literal (`s.nlsemi = true`), after `)`/`]`/`}`/`++`/`--`, and for
the four branch keywords via a bitset test. When `nlsemi` is set and the next
character is `\n` or EOF, the scanner emits a `_Semi` token instead of skipping
the newline.

## Q8. How are keywords distinguished from identifiers?

The scanner reads the whole identifier, then checks if it is one of the 25
keywords. The gc scanner uses a **perfect hash**:
`hash(s) = (s[0]<<4 ^ s[1] + len) & 63` into a 64-entry `keywordMap`, confirmed
by a string compare. No map, no allocation, no linear scan. If it matches a
keyword slot, the token is that keyword; otherwise it is `_Name`.

## Q9. What numeric literal forms does the scanner accept?

Decimal (`42`), hex (`0x2A`), new octal (`0o52`), old octal (`052`), binary
(`0b1010`); floats (`3.14`, `1e9`, leading-dot `.5`); hex floats with a
required `p` exponent (`0x1.8p1`); imaginary with `i` (`3.14i`, `42i`); and
underscores as digit separators (`1_000`, `0x_FF`).

## Q10. What are the rules for underscores in numbers?

`_` may appear between two digits or right after a base prefix. It may **not**
be leading, trailing, doubled, or adjacent to the radix point. Violations give
`'_' must separate successive digits`. So `1_000` and `0x_FF` are fine;
`1__0`, `0xFF_`, `_5` are errors.

## Q11. Why does a hex float need a `p` exponent?

`0x1.8` is ambiguous/incomplete: the scanner requires hex floats to carry a
binary (`p`/`P`) exponent, e.g. `0x1.8p0` = 1.5. A hex mantissa without a `p`
gives `hexadecimal mantissa requires a 'p' exponent`. Decimal floats use `e`;
hex floats use `p`. `0o`/`0b` literals cannot be floats at all.

## Q12. Difference between `'a'`, `"a"`, and `` `a` ``?

`'a'` is a **rune** literal — exactly one code point, type `rune`/`int32`.
`"a"` is an **interpreted string** — escapes processed, no raw newlines.
`` `a` `` is a **raw string** — no escapes, backslash literal, may span lines.
A rune must hold exactly one code point; `'ab'` and `''` are errors.

## Q13. Raw string vs interpreted string escapes?

Interpreted (`"..."`) processes escapes: `\n`, `\t`, `\xFF`, `é`,
`\U0001F600`, octal `\123`. Raw (`` `...` ``) processes none — every byte is
literal (it does drop `\r`). So `"C:\new"` has a newline (probably a bug) while
`` `C:\new` `` is literally backslash-n-e-w. Raw strings cannot contain a
backtick.

## Q14. How does the scanner read bytes — what's the `source` struct?

`source` (in `source.go`) is a buffered rune reader. It keeps a byte buffer
with three indices: `b` (segment begin), `r` (read pointer), `e` (end of valid
bytes). The buffer is terminated with a **sentinel** (`utf8.RuneSelf`). The
`nextch` method handles ASCII with a single `if ch < sentinel` test that also
detects buffer end, then falls to a slow path for multibyte runes, refills,
EOF, BOM, and invalid UTF-8.

## Q15. Why is the sentinel trick fast?

For ASCII source (the common case) every character is read with one comparison
(`ch < sentinel`), one increment, and a return — no `utf8.DecodeRune`, no
allocation, and no separate bounds check, because the sentinel at `buf[e]` is
`>= RuneSelf` and so fails the same test that ASCII passes. Multibyte decoding
only happens on the slow path.

## Q16. How does the scanner avoid allocating for literal text?

Via **zero-copy segments**: `segment()` returns a `[]byte` slice into the
buffer. The scanner converts to a `string` only when it must keep the text
(names and literals). Operators, delimiters, and discarded comments allocate
nothing.

## Q17. How does the scanner feed the parser?

The parser **embeds** the scanner and calls `next()` to advance one token at a
time — no token slice, no channel. There is at most one token of lookahead
(the current token in the struct fields). ASI is resolved entirely in the
scanner, so the parser's grammar is newline-agnostic.

## Q18. How does error handling work in the scanner?

Errors are reported through an installed handler (`errh func(line, col uint,
msg string)`); the scanner never panics on bad input and never stops at the
first error. A malformed literal is still emitted as `_Literal` with
`bad = true` so parsing continues; invalid UTF-8 / NUL / mid-file BOM are
reported and skipped. The compiler installs a handler that collects, dedupes,
and applies a "too many errors" cutoff.

## Q19. What directives does the scanner capture, and what's the gotcha?

`//line file:line[:col]` (and the `/*line ...*/` block form) which rebases
positions, and `//go:NAME` pragmas like `//go:noinline`, `//go:embed`,
`//go:generate`, `//go:build`. The gotcha: **no space** — `//go:noinline`
works, `//go: noinline` and `// go:noinline` are plain comments and silently
ignored. The scanner only treats a `//` comment as a directive when the next
char is `g`/`l` and the exact prefix follows.

## Q20. What is `//line` for, and how does position rebasing work?

`//line foo.go:100` tells the compiler that subsequent code "really" comes from
`foo.go` starting at line 100. The scanner installs a new `PosBase` so later
positions report the directive's file/line. This is how cgo- and generator-
produced `.go` files make compiler errors and stack traces point back at the
original source. The std-lib analog populates `token.File` line info so
`fset.Position` reports the rebased location.

## Q21. `token.Pos` vs `token.Position` — what's the difference?

`token.Pos` is a compact integer offset into a `FileSet` (cheap to store on AST
nodes). `token.Position` is the expanded human-readable form with `Filename`,
`Offset`, `Line`, and `Column`. You convert with `fset.Position(pos)`. The
`FileSet` lets one set hold positions from many files compactly.

## Q22. How would you observe the gc scanner's tokens?

You can't directly — there's no public flag to dump the compiler's internal
token stream, and `GOSSAFUNC` is a much later (SSA) stage. To see the *same*
tokenization, use `go/scanner` in a small program. To study the gc scanner
itself, read `cmd/compile/internal/syntax/{source,scanner,tokens}.go`, which
are deliberately self-contained.

## Q23. What modes does `go/scanner` support, and why does `ScanComments` matter?

`scanner.Mode` has effectively one flag you use: `ScanComments`. Without it,
comments are silently skipped (treated as whitespace). With it, the scanner
returns `token.COMMENT` tokens so a tool can see them. This matters for
formatters, doc extractors, and directive scanners — anything that must reason
about comment text and position. The compiler's internal scanner has analogous
`comments` and `directives` modes, but it reports comments via a callback
rather than as tokens.

## Q24. How does the scanner distinguish `.`, `..`, and `...`?

`.` is a selector/dot, `...` is the ellipsis token, and `..` is a syntax
error. This needs more than one rune of lookahead, which is the *only* place
the compiler's `source` reader uses `rewind`: it reads ahead, and if it sees
`..` but not a third `.`, it rewinds the read pointer to re-emit a single `.`.
A leading dot followed by a digit (`.5`) is instead scanned as a float.

## Q25. Why is the token set capped at 64?

So the whole set fits in a `uint64` bitset. The compiler uses
`contains(tokset, tok)` with a single mask-and-test to ask "is this token in
this group?" — for example, checking whether a keyword is one of the four
branch keywords that trigger ASI (`1<<_Break | 1<<_Continue | ...`). A
`tokenCount` assertion (`const _ uint64 = 1 << (tokenCount - 1)`) makes the
build fail if anyone adds a 65th token.

## Q26. If you were writing your own lexer, what would you borrow from the gc scanner?

Four ideas: (1) sentinel-terminate the buffer so the fast-path test also
detects end-of-input with no extra bounds check; (2) decide on raw bytes and
only decode a full rune when the byte is non-ASCII; (3) hand out literal text
as zero-copy slices into the buffer, allocating a string only for tokens you
retain; (4) use a perfect hash (or a `[]byte`-keyed lookup) for keywords to
avoid map allocation. Each keeps the per-byte cost tiny.

## Further reading

- Go spec, "Lexical elements": https://go.dev/ref/spec#Lexical_elements
- Go spec, "Semicolons": https://go.dev/ref/spec#Semicolons
- `go/scanner`: https://pkg.go.dev/go/scanner
- `go/token`: https://pkg.go.dev/go/token
- `scanner.go`: https://go.dev/src/cmd/compile/internal/syntax/scanner.go
- `source.go`: https://go.dev/src/cmd/compile/internal/syntax/source.go
- Compiler directives: https://pkg.go.dev/cmd/compile#hdr-Compiler_Directives
