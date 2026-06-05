# Lexer / Scanner — Middle

You know what a token is. Now we go deeper into **how each token kind is
scanned**, the **full automatic semicolon insertion (ASI) rules**, the
**directives** the scanner captures, and how to use **positions** correctly.
By the end you will have written a small tokenizer tool.

## 1. The scanning loop

A scanner is a state machine driven by one rule: look at the current
character, decide what kind of token starts here, then consume characters
until the token ends. The std-lib `go/scanner.Scanner` exposes this through a
single method:

```go
func (s *Scanner) Scan() (pos token.Pos, tok token.Token, lit string)
```

You call `Scan` in a loop until `tok == token.EOF`. Each call:

1. Skips whitespace (`' '`, `'\t'`, `'\r'`, and `'\n'` when no semicolon is
   pending).
2. Records the start position.
3. Dispatches on the first character to a sub-scanner (identifier, number,
   string, operator, ...).
4. Returns the kind, the literal text (for names/literals/comments), and the
   position.

The first character almost always determines the token kind:

| First char            | Token scanned                          |
| --------------------- | -------------------------------------- |
| letter or `_` or rune | identifier / keyword                   |
| `0`–`9`               | number (int / float / imaginary)       |
| `.` followed by digit | float starting with a dot (`.5`)       |
| `"`                   | interpreted string                     |
| `` ` ``               | raw string                             |
| `'`                   | rune literal                           |
| `/`                   | `/`, `/=`, line comment, block comment |
| operator char         | operator (possibly multi-char)         |

## 2. Scanning identifiers and keywords

An identifier is a letter (Unicode `L` category, plus `_`) followed by letters
and digits. The scanner consumes the run of ident characters, then asks: *is
this word a keyword?*

```go
foo        // IDENT  "foo"
fmt        // IDENT  "fmt"
αβγ        // IDENT  "αβγ"   (Unicode letters are allowed)
_unused    // IDENT  "_unused"
func       // keyword (token.FUNC)
range      // keyword (token.RANGE)
```

In the real compiler (`cmd/compile/internal/syntax/scanner.go`) the keyword
test uses a **perfect hash** so it never allocates and never does a map miss
loop:

```go
// from scanner.go, simplified
lit := s.segment()                 // the bytes just scanned
if len(lit) >= 2 {                 // shortest keyword is "if" / "go"... len>=2
	if tok := keywordMap[hash(lit)]; tok != 0 && tokStrFast(tok) == string(lit) {
		s.tok = tok                // it IS a keyword
		return
	}
}
s.tok = _Name                      // otherwise it is an identifier
```

The hash is `(s[0]<<4 ^ s[1] + len) & (size-1)` over a 64-entry table — chosen
so all 25 Go keywords land in distinct slots. The `tokStrFast` re-check guards
against a non-keyword that happens to hash to the same slot.

## 3. Scanning numbers

Number scanning is the trickiest sub-scanner because Go supports many forms in
one grammar:

```go
42            // INT,   decimal
0x2A          // INT,   hex      (also 0X)
0o52          // INT,   octal    (new style; 0O also)
052           // INT,   old octal (leading 0)
0b101010      // INT,   binary   (also 0B)
3.14          // FLOAT
1e9           // FLOAT, exponent
0x1p-2        // FLOAT, hex float with binary 'p' exponent
.5            // FLOAT, leading dot
1_000_000     // INT,   underscores as digit separators
3.14i         // IMAG,  imaginary
0x_FF         // INT,   underscore after prefix is allowed
```

Key rules the scanner enforces:

- **Underscores** may appear between digits and right after a base prefix
  (`0x_FF`), but **not** adjacent to each other, at the start, at the end, or
  next to the radix point. The compiler reports `'_' must separate successive
  digits`.
- A `.` only starts a float; `0o` and `0b` numbers **cannot** have a radix
  point (`invalid radix point in octal literal`).
- Hex floats **require** a `p` exponent: `0x1.8p1`. A bare `0x1.8` is an error
  (`hexadecimal mantissa requires a 'p' exponent`).
- The exponent letter depends on base: decimal/octal use `e`, hex uses `p`.
- A trailing `i` makes it imaginary, valid on ints and floats alike (`42i`,
  `3.14i`).

The scanner produces a single `FLOAT`/`INT`/`IMAG`/`CHAR`/`STRING` token even
when the literal is malformed; it reports the error separately and marks the
literal "bad" so the parser can keep going.

## 4. Scanning strings and runes

Three quote characters, three sub-scanners:

```go
"hello\n"        // interpreted string: escapes are processed
`hello\n`        // raw string: backslash is literal, no escapes, spans lines
'A'              // rune literal: a single code point, value 65 (int32)
'é'         // rune literal via Unicode escape → é
'\x41'           // rune literal via hex escape → 'A'
```

Differences that bite:

- **Interpreted** strings (`"..."`) may **not** contain a raw newline. Escapes
  like `\n`, `\t`, `\\`, `\"`, `\xFF`, `é`, `\U0001F600`, `\123` (octal)
  are recognized. An unknown escape (`\q`) is an error.
- **Raw** strings (`` `...` ``) treat every byte literally except they drop
  carriage returns; backslashes mean nothing. They may span multiple lines.
- **Rune** literals hold **exactly one** code point. `'ab'` is an error
  (`too many characters in rune literal`); `''` is an error. Escapes apply,
  so `'\n'` is the newline rune.

```go
s := "C:\new"       // BUG: \n is a newline! Probably meant raw string
s := `C:\new`       // raw: literally backslash-n-e-w
r := 'x'            // rune, type int32, value 120
r := "x"            // string of length 1 — NOT a rune
```

## 5. Scanning operators and the maximal-munch rule

Operators are scanned by **maximal munch**: the scanner consumes the longest
sequence of characters that forms a valid operator. Starting from `<` it may
produce `<`, `<=`, `<<`, `<<=`, or `<-`, depending on what follows:

```go
a < b        // _Operator, Lss  (less-than)
a <= b       // _Operator, Leq
a << b       // _Operator, Shl
a <<= b      // _AssignOp  (shift-assign)
<-ch         // _Arrow     (channel receive)
```

The compiler encodes precedence directly in the token so the parser needs no
separate lookup table. From `tokens.go`, the five binary precedence levels
(low to high) are `precOrOr` (`||`), `precAndAnd` (`&&`), `precCmp` (`== != <
<= > >=`), `precAdd` (`+ - | ^`), and `precMul` (`* / % & &^ << >>`). The `*`
token is special-cased (`_Star`) because it doubles as pointer and
multiplication.

The `op=` assignment forms (`+=`, `<<=`, `&^=`, ...) become a single
`_AssignOp` token carrying the underlying `Operator`. `++` and `--` are
`_IncOp`. `:=` is `_Define`, distinct from `=` (`_Assign`). Getting maximal
munch right is why a hand-rolled tokenizer is harder than it looks: you must
peek ahead far enough to choose the longest operator, but no further.

## 6. Automatic semicolon insertion, in depth

ASI is the most surprising thing the lexer does. The spec rule:

> When the input is broken into tokens, a semicolon is **automatically
> inserted** into the token stream immediately after a line's final token if
> that token is:
>
> 1. an identifier
> 2. an integer, floating-point, imaginary, rune, or string literal
> 3. one of the keywords `break`, `continue`, `fallthrough`, or `return`
> 4. one of the operators/delimiters `++`, `--`, `)`, `]`, or `}`

A second rule allows omitting the final `;` before a closing `)` or `}`.

In the compiler scanner this is a single boolean, `nlsemi`. Each sub-scanner
sets it. From `scanner.go`:

```go
// after scanning an identifier or literal:
s.nlsemi = true
// for the four branch keywords:
s.nlsemi = contains(1<<_Break|1<<_Continue|1<<_Fallthrough|1<<_Return, tok)
// after ')' ']' '}' '++' '--':
s.nlsemi = true
```

When `nlsemi` is set and the scanner hits a `\n` or EOF, it emits a `_Semi`
token instead of skipping the newline. Concrete consequences:

```go
// (a) function literal call — the '}' sets nlsemi, the newline becomes ';'
x := func() int { return 1 }
y := 2

// (b) the classic gofmt-incompatible mistake
a := []int{
	1,
	2,    // trailing comma REQUIRED: line ends with literal → ';' inserted,
}         // so without the comma you'd get "1\n2" → "1; 2}" → error

// (c) return on its own line drops the value
func f() int {
	return    // ';' inserted here → returns zero value, ignores next line!
		42
}

// (d) chained method calls: the '.' must lead the next line
result := obj.
	Method1().
	Method2()     // OK: each line ends with '.' or '(' — no semicolon
```

Example (c) is a real footgun: `go vet` warns, but the lexer happily inserts
the semicolon and `f` returns 0.

## 7. Comments and directives

Comments come in two forms and are normally skipped. Tooling can ask to see
them (`scanner.ScanComments`). But some comments are **directives** with
special meaning, captured even by the compiler scanner:

```go
//line file.go:10        // remaps positions (used by generated code / cgo)
/*line file.go:10:3*/    // block form of the line directive
//go:noinline            // compiler pragma — note: NO space after //
//go:build linux         // build constraint (new style)
// +build linux          // build constraint (old style, note the space)
```

Crucial scanner detail: a `//go:` directive must have **no space** between
`//` and `go:`. `// go:noinline` (with a space) is just an ordinary comment
and is ignored. The compiler scanner recognizes directives by checking the
first character after `//` is `g` (for `go:`) or `l` (for `line `) before
even bothering to capture the text:

```go
// from scanner.go lineComment(), simplified:
if s.mode&directives == 0 || (s.ch != 'g' && s.ch != 'l') {
	s.skipLine()   // not a directive: discard and move on
	return
}
```

Build-tag comments (`//go:build` / `// +build`) must appear **before** the
`package` clause, separated from it by a blank line. That positioning is
enforced downstream, but the scanner is what surfaces the comment text and its
position.

## 8. Positions with `go/token.FileSet`

A `token.Pos` is just an integer offset into a global `FileSet`. You convert
it to a human-readable line/column with `fset.Position(pos)`:

```go
fset := token.NewFileSet()
file := fset.AddFile("main.go", fset.Base(), len(src))

var s scanner.Scanner
s.Init(file, src, nil, 0)

for {
	pos, tok, lit := s.Scan()
	if tok == token.EOF {
		break
	}
	p := fset.Position(pos) // p.Filename, p.Line, p.Column, p.Offset
	fmt.Printf("%s:%d:%d  %s  %q\n", p.Filename, p.Line, p.Column, tok, lit)
}
```

`FileSet` lets one set hold positions from many files compactly: each file
gets a base offset, and `Position` maps an absolute `Pos` back to the right
file plus line/column. This is the same machinery `go/parser`, `go/types`, and
every linter uses to point at code.

## 9. Build a small tokenizer tool

A useful exercise: a CLI that prints a token histogram for a file.

```go
package main

import (
	"fmt"
	"go/scanner"
	"go/token"
	"os"
	"sort"
)

func main() {
	src, err := os.ReadFile(os.Args[1])
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

	fset := token.NewFileSet()
	file := fset.AddFile(os.Args[1], fset.Base(), len(src))

	var s scanner.Scanner
	// An error handler so malformed tokens don't go silent.
	s.Init(file, src, func(p token.Position, msg string) {
		fmt.Fprintf(os.Stderr, "%s: %s\n", p, msg)
	}, scanner.ScanComments)

	counts := map[token.Token]int{}
	total := 0
	for {
		_, tok, _ := s.Scan()
		if tok == token.EOF {
			break
		}
		counts[tok]++
		total++
	}

	type kv struct {
		tok token.Token
		n   int
	}
	var sorted []kv
	for t, n := range counts {
		sorted = append(sorted, kv{t, n})
	}
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].n > sorted[j].n })

	for _, e := range sorted {
		fmt.Printf("%6d  %s\n", e.n, e.tok)
	}
	fmt.Printf("%6d  TOTAL\n", total)
}
```

Run it on any source file: `go run hist.go yourfile.go`. You will see `;`
appear far more often than you typed it — that is ASI at work.

## 10. Summary

- The scanner dispatches on the **first character** to a sub-scanner per token
  kind: identifier, number, string, rune, operator, comment.
- Keywords are identifiers that match a fixed set — the compiler uses a
  perfect-hash lookup to find them with zero allocation.
- Number scanning handles `0x/0o/0b`, underscores, hex floats (with required
  `p`), and the imaginary `i` suffix, reporting errors without aborting.
- Strings come in interpreted (`"`), raw (`` ` ``), and rune (`'`) forms with
  different escape rules.
- **ASI** is one boolean (`nlsemi`) set by ident/literal/`)`/`]`/`}`/`++`/`--`
  and the four branch keywords; mind `return` on its own line.
- Directives like `//line`, `//go:build`, `//go:noinline` are captured by the
  scanner and need the exact `//xxx:` form (no space).
- Use `token.FileSet` + `fset.Position` to turn `token.Pos` into line/column.

## Further reading

- Go spec, "Semicolons": https://go.dev/ref/spec#Semicolons
- Go spec, "Integer/floating-point literals": https://go.dev/ref/spec#Integer_literals
- Go spec, "String literals": https://go.dev/ref/spec#String_literals
- `go/scanner` docs: https://pkg.go.dev/go/scanner
- `go/token` docs: https://pkg.go.dev/go/token
- Compiler scanner source: https://go.dev/src/cmd/compile/internal/syntax/scanner.go
- Compiler directives reference: https://pkg.go.dev/cmd/compile#hdr-Compiler_Directives
