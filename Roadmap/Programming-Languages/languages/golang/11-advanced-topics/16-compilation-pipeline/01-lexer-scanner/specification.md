# Lexer / Scanner — Specification

A reference for Go's lexical layer: the token set, the formal automatic
semicolon insertion rules, the literal grammars (including underscores),
directive syntax, and the scanner API surface. EBNF here follows the style of
the Go language specification.

## 1. Lexical structure overview

Source text is Unicode encoded as **UTF-8**. The grammar's terminal symbols
are tokens. Whitespace (`U+0020`, `U+0009`, `U+000D`, `U+000A`) separates
tokens; consecutive whitespace collapses except as it triggers semicolon
insertion at line ends. Comments are not tokens (except as captured
directives) and act as whitespace.

```
newline        = /* U+000A */ .
unicode_char   = /* an arbitrary Unicode code point except newline */ .
letter         = unicode_letter | "_" .
unicode_letter = /* a Unicode code point categorized as "Letter" */ .
unicode_digit  = /* a Unicode code point categorized as "Number, decimal digit" */ .
```

A BOM (`U+FEFF`) is permitted **only** as the first code point of the file and
is discarded; elsewhere it is an error.

## 2. Token categories

Tokens fall into five groups: identifiers, keywords, operators/punctuation,
literals, and the synthetic semicolon. The compiler's `token` type
(`cmd/compile/internal/syntax/tokens.go`) enumerates them; the std-lib
equivalent is `go/token.Token`.

### Compiler token kinds (representative)

| Constant       | Meaning                                  |
| -------------- | ---------------------------------------- |
| `_EOF`         | end of input                             |
| `_Name`        | identifier                               |
| `_Literal`     | int/float/imag/rune/string (see `kind`)  |
| `_Operator`    | binary/unary operator (excludes `*`)     |
| `_AssignOp`    | `op=` form (`+=`, `<<=`, ...)            |
| `_IncOp`       | `++` / `--`                              |
| `_Assign`      | `=`                                      |
| `_Define`      | `:=`                                     |
| `_Arrow`       | `<-`                                     |
| `_Star`        | `*` (separate from `_Operator`)          |
| `_Lparen` `_Lbrack` `_Lbrace` | `(` `[` `{`               |
| `_Rparen` `_Rbrack` `_Rbrace` | `)` `]` `}`               |
| `_Comma` `_Semi` `_Colon` `_Dot` `_DotDotDot` | `,` `;` `:` `.` `...` |
| keyword tokens | `_Break` ... `_Var` (the 25 keywords)    |

The whole token set is constrained to **at most 64** values so it fits a
`uint64` bitset (`const _ uint64 = 1 << (tokenCount - 1)`), enabling
`contains(tokset, tok)` membership tests with a single mask.

### Literal kinds (`LitKind`)

```
IntLit | FloatLit | ImagLit | RuneLit | StringLit
```

### Keywords (exactly 25)

```
break        case         chan         const        continue
default      defer        else         fallthrough  for
func         go           goto         if           import
interface    map          package      range        return
select       struct       switch       type         var
```

Keyword recognition uses a perfect hash:
`hash(s) = (s[0]<<4 ^ s[1] + len(s)) & 63` over a 64-entry `keywordMap`,
confirmed by a string compare.

## 3. Operators and precedence

The `Operator` enum encodes precedence so the parser does not need a separate
table. The five binary precedence levels (low → high):

| Level        | Operators           |
| ------------ | ------------------- |
| `precOrOr`   | `\|\|`              |
| `precAndAnd` | `&&`                |
| `precCmp`    | `== != < <= > >=`   |
| `precAdd`    | `+ - \| ^`          |
| `precMul`    | `* / % & &^ << >>`  |

Unary operators (`Def` for `:`, `Not` for `!`, `Recv` for `<-`, `Tilde` for
`~`) sit outside the binary precedence ladder. `*` is its own token (`_Star`)
because it is both multiplication and pointer/deref.

## 4. Identifiers

```
identifier = letter { letter | unicode_digit } .
```

The first character is a Unicode letter or `_`; subsequent characters add
Unicode decimal digits. The blank identifier `_` is a valid identifier.
Identifiers equal to a keyword are tokenized as that keyword, not as a name.

## 5. Automatic semicolon insertion (formal)

The grammar uses the terminal `";"`. Two rules make most explicit semicolons
unnecessary:

> **Rule 1.** When the input is broken into tokens, a semicolon is
> automatically inserted into the token stream immediately after a line's
> final token if that token is
>
> - an identifier
> - an integer, floating-point, imaginary, rune, or string literal
> - one of the keywords `break`, `continue`, `fallthrough`, or `return`
> - one of the operators and punctuation `++`, `--`, `)`, `]`, or `}`
>
> **Rule 2.** To allow complex statements to occupy a single line, a semicolon
> may be omitted before a closing `)` or `}`.

In the scanner this is the `nlsemi` flag: it is set when one of the above
tokens is produced, and when set, a newline or EOF yields a `_Semi` token
(`lit` = `"newline"` / `"EOF"`) instead of being skipped. An explicit `;`
yields `_Semi` with `lit` = `"semicolon"`.

## 6. Integer literals

```
int_lit        = decimal_lit | binary_lit | octal_lit | hex_lit .
decimal_lit    = "0" | ( "1" … "9" ) [ [ "_" ] decimal_digits ] .
binary_lit     = "0" ( "b" | "B" ) [ "_" ] binary_digits .
octal_lit      = "0" [ "o" | "O" ] [ "_" ] octal_digits .
hex_lit        = "0" ( "x" | "X" ) [ "_" ] hex_digits .

decimal_digits = decimal_digit { [ "_" ] decimal_digit } .
binary_digits  = binary_digit  { [ "_" ] binary_digit } .
octal_digits   = octal_digit   { [ "_" ] octal_digit } .
hex_digits     = hex_digit     { [ "_" ] hex_digit } .
```

Underscore rule: `_` may appear after the base prefix or between successive
digits; it may not be leading, trailing, doubled, or adjacent to the radix
point. Violations: `'_' must separate successive digits`.

## 7. Floating-point literals

```
float_lit         = decimal_float_lit | hex_float_lit .

decimal_float_lit = decimal_digits "." [ decimal_digits ] [ decimal_exponent ]
                  | decimal_digits decimal_exponent
                  | "." decimal_digits [ decimal_exponent ] .
decimal_exponent  = ( "e" | "E" ) [ "+" | "-" ] decimal_digits .

hex_float_lit     = "0" ( "x" | "X" ) hex_mantissa hex_exponent .
hex_mantissa      = [ "_" ] hex_digits "." [ hex_digits ]
                  | [ "_" ] hex_digits
                  | "." hex_digits .
hex_exponent      = ( "p" | "P" ) [ "+" | "-" ] decimal_digits .
```

Constraints enforced by the scanner: a hex float **must** have a `p` exponent
(`hexadecimal mantissa requires a 'p' exponent`); `0o`/`0b` numbers may not
have a radix point; a decimal exponent uses `e`, a hex exponent uses `p`.

## 8. Imaginary, rune, and string literals

```
imaginary_lit = (decimal_digits | int_lit | float_lit) "i" .
```

The `i` suffix is permitted on integer and floating forms alike.

```
rune_lit         = "'" ( unicode_value | byte_value ) "'" .
unicode_value    = unicode_char | little_u_value | big_u_value | escaped_char .
byte_value       = octal_byte_value | hex_byte_value .
octal_byte_value = "\" octal_digit octal_digit octal_digit .
hex_byte_value   = "\" "x" hex_digit hex_digit .
little_u_value   = "\" "u" hex_digit hex_digit hex_digit hex_digit .
big_u_value      = "\" "U" hex_digit hex_digit hex_digit hex_digit
                            hex_digit hex_digit hex_digit hex_digit .
escaped_char     = "\" ( "a" | "b" | "f" | "n" | "r" | "t" | "v" | "\" | "'" | "\"" ) .

string_lit             = raw_string_lit | interpreted_string_lit .
raw_string_lit         = "`" { unicode_char | newline } "`" .
interpreted_string_lit = "\"" { unicode_value | byte_value } "\"" .
```

A rune literal must hold **exactly one** code point. Raw strings (backtick)
process no escapes and drop carriage returns; interpreted strings (`"`)
process escapes and may not contain a raw newline. A code point above
`U+10FFFF` or in the surrogate range `U+D800`–`U+DFFF` is an error.

## 9. Comments and directives

```
line_comment  = "//" { unicode_char } newline .
block_comment = "/*" { unicode_char | newline } "*/" .
```

Comments are whitespace except for **directives**, which the scanner captures:

| Directive form          | Meaning                                            |
| ----------------------- | -------------------------------------------------- |
| `//line file:line`      | rebase position info to `file:line`                |
| `//line file:line:col`  | rebase including column                            |
| `/*line file:line*/`    | inline (block) form of `//line`                    |
| `//go:NAME args`        | compiler pragma (e.g. `//go:noinline`, `//go:embed`) |
| `//go:build EXPR`       | build constraint (must precede `package`)          |

Directive form is strict: **no space** between `//` and the keyword. The
scanner recognizes a directive only when the character after `//` is `g`
(`go:`) or `l` (`line `); otherwise the comment is discarded. The legacy
`// +build` constraint (note the required space) is handled by the build
system, not as a scanner directive.

## 10. Scanner API surface

### Standard library (`go/scanner`, `go/token`)

```go
type Scanner struct{ ErrorCount int /* ... */ }
func (s *Scanner) Init(file *token.File, src []byte, err ErrorHandler, mode Mode)
func (s *Scanner) Scan() (pos token.Pos, tok token.Token, lit string)

type Mode uint
const ScanComments Mode = 1 << 0  // emit COMMENT tokens

type ErrorHandler func(pos token.Position, msg string)

// go/token
func NewFileSet() *FileSet
func (s *FileSet) AddFile(filename string, base, size int) *File
func (s *FileSet) Position(p Pos) Position   // -> {Filename, Offset, Line, Column}
```

### Compiler (`cmd/compile/internal/syntax`, internal)

```go
type scanner struct {
	source
	mode      uint        // comments | directives
	nlsemi    bool        // pending semicolon
	tok       token       // current token
	lit       string      // literal text
	bad       bool        // malformed literal
	kind      LitKind     // literal kind
	op        Operator    // operator
	prec      int         // operator precedence
	line, col uint        // token start position
}

func (s *scanner) init(src io.Reader, errh func(line, col uint, msg string), mode uint)
func (s *scanner) next()  // advance one token

// modes:
const (
	comments   uint = 1 << iota  // report all comments via errh
	directives                   // report only //line, /*line, //go: comments
)
```

## 11. Specification summary

- Source is UTF-8; tokens are identifiers, keywords, operators, literals, and
  the synthetic semicolon, all within a 64-token set.
- ASI inserts `;` after identifiers, literals, `break`/`continue`/
  `fallthrough`/`return`, and `++ -- ) ] }` at line end.
- Literal grammars permit `0x`/`0o`/`0b`, `_` digit separators (with strict
  placement), hex floats with a required `p` exponent, and an `i` suffix.
- Runes hold one code point; raw strings ignore escapes, interpreted strings
  process them.
- Directives (`//line`, `//go:...`) require the exact no-space `//keyword`
  form and are captured by the scanner.

## Further reading

- Go spec, "Lexical elements": https://go.dev/ref/spec#Lexical_elements
- Go spec, "Semicolons": https://go.dev/ref/spec#Semicolons
- Go spec, "Integer literals": https://go.dev/ref/spec#Integer_literals
- Go spec, "Floating-point literals": https://go.dev/ref/spec#Floating-point_literals
- Go spec, "Rune literals": https://go.dev/ref/spec#Rune_literals
- Go spec, "String literals": https://go.dev/ref/spec#String_literals
- `tokens.go`: https://go.dev/src/cmd/compile/internal/syntax/tokens.go
- `go/token` docs: https://pkg.go.dev/go/token
