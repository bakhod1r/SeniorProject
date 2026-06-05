# Lexer / Scanner — Find the Bug

Fourteen scenarios where the **lexer** is the real cause of confusion. Each
has the code, the observed symptom, the lexical root cause, and the fix. These
are the bugs that make people say "the compiler is wrong" when really the
tokenizer did exactly what the spec says.

---

## Bug 1: Opening brace on its own line

```go
func main()
{
	fmt.Println("hi")
}
```

**Symptom.** Compile error:

```
./main.go:1:13: missing function body
./main.go:2:1: syntax error: unexpected semicolon or newline before {
```

**Root cause.** The line `func main()` ends with `)`, which is in the ASI
trigger set. The scanner inserts a semicolon, producing the token stream
`func main ( ) ;` followed by `{ }`. The parser sees a function declaration
with no body, then a stray block.

**Fix.** Put the brace on the same line — the One True Brace Style is mandated
by the lexer, not by convention:

```go
func main() {
	fmt.Println("hi")
}
```

---

## Bug 2: `return` value on the next line

```go
func area(r float64) float64 {
	return
		3.14159 * r * r
}
```

**Symptom.** `area(2)` returns `0`, and `go vet` reports
`unreachable code`. No compile error.

**Root cause.** `return` is one of the four keywords that trigger ASI. The
line ends with `return`, so the scanner inserts `;`. The function returns its
zero value immediately; the `3.14159 * r * r` line is dead code.

**Fix.** Keep the value on the same line as `return`:

```go
func area(r float64) float64 {
	return 3.14159 * r * r
}
```

If the expression is long, break **after** an operator so the line does not
end in a literal/ident:

```go
	return 3.14159 * r * r +
		correction
```

---

## Bug 3: Missing trailing comma in a multi-line literal

```go
nums := []int{
	1,
	2,
	3
}
```

**Symptom.**

```
syntax error: unexpected newline in composite literal; possibly missing comma or }
```

**Root cause.** The line `3` ends with an integer literal — an ASI trigger. The
scanner inserts `;` after `3`, so the parser sees `... 3 ; }` inside a
composite literal, which is invalid.

**Fix.** Add the trailing comma. gofmt does this automatically; the comma
*is* the line's final token, and `,` is not an ASI trigger:

```go
nums := []int{
	1,
	2,
	3,
}
```

---

## Bug 4: Method chain broken before the dot

```go
result := builder
	.Add(1)
	.Add(2)
	.Build()
```

**Symptom.**

```
syntax error: unexpected . after top level declaration
```

(or `unexpected .` mid-expression).

**Root cause.** The line `result := builder` ends with the identifier
`builder` — an ASI trigger — so `;` is inserted, terminating the statement.
The following `.Add(1)` then starts a new, invalid statement.

**Fix.** End each line with the `.` (or with `(`), which is **not** an ASI
trigger, so the statement continues:

```go
result := builder.
	Add(1).
	Add(2).
	Build()
```

---

## Bug 5: Backslash in a Windows path string

```go
path := "C:\Users\new\test"
fmt.Println(path)
```

**Symptom.** Either a compile error
(`unknown escape sequence` for `\U`, `\t` is fine but...) or surprising
output. With `\U` it is:

```
syntax error: \U must be followed by 8 hex digits
```

and `\n` silently becomes a newline.

**Root cause.** In an **interpreted** string (`"..."`), `\` starts an escape.
`\U` expects 8 hex digits, `\n` is a newline, `\t` is a tab. The scanner is
processing escapes you did not intend.

**Fix.** Use a **raw** string (backticks), where backslashes are literal:

```go
path := `C:\Users\new\test`
```

Or escape each backslash: `"C:\\Users\\new\\test"`.

---

## Bug 6: Raw string can't contain a backtick

```go
tmpl := `He said `hello` to me`
```

**Symptom.**

```
syntax error: unexpected name hello
```

**Root cause.** A raw string is delimited by backticks and **cannot contain
one** — there is no escape inside raw strings. The scanner closes the string at
the second backtick (`He said `), then tries to tokenize `hello`.

**Fix.** Use an interpreted string with escaped backticks, or concatenate:

```go
tmpl := "He said `hello` to me"
// or
tmpl := "He said " + "`hello`" + " to me"
```

---

## Bug 7: Rune literal with more than one character

```go
sep := 'ab'
```

**Symptom.**

```
more than one character in rune literal
```

**Root cause.** Single quotes mean a **rune literal** — exactly one Unicode
code point. `'ab'` is two characters. The scanner counts code points inside
the rune and rejects it.

**Fix.** If you wanted a string, use double quotes:

```go
sep := "ab"     // string
```

If you wanted a single character/rune:

```go
sep := 'a'      // rune, type int32
```

---

## Bug 8: Empty rune literal

```go
empty := ''
```

**Symptom.**

```
empty rune literal or unescaped ' in rune literal
```

**Root cause.** A rune literal must contain exactly one code point; `''` has
zero. There is no "empty rune". (The analogous string `""` is fine — an empty
string is valid.)

**Fix.** Decide what you meant:

```go
empty := ""          // empty string
nul   := '\x00'      // the NUL rune, if that is what you need
```

---

## Bug 9: `//go:` directive with a space

```go
//go: noinline
func hot() int { return 1 }
```

**Symptom.** The function is still inlined; the pragma has no effect. No error,
no warning — silent.

**Root cause.** A directive must be `//go:NAME` with **no space** after `//`
and the `go:` glued to it. `//go: noinline` (space after the colon) — and even
worse `// go:noinline` (space after `//`) — is just an ordinary comment. The
scanner only treats `//` comments as directives when the next char is `g`/`l`
and the exact `go:` / `line ` prefix follows.

**Fix.** Remove the space:

```go
//go:noinline
func hot() int { return 1 }
```

---

## Bug 10: Bad underscore in a numeric literal

```go
mask := 0xFF_
count := 1__000
lead := _500
```

**Symptom.**

```
'_' must separate successive digits
```

(one error per offending literal).

**Root cause.** Underscores in numbers are *digit separators*: allowed between
two digits or right after a base prefix, but not trailing (`0xFF_`), not
doubled (`1__000`), and not leading (`_500` is actually scanned as an
identifier, then `500` — a different error). The scanner's `invalidSep` check
flags these.

**Fix.** Place underscores only between digits:

```go
mask  := 0xFF
count := 1_000
lead  := 500
```

---

## Bug 11: Octal/binary literal with a decimal point

```go
x := 0o3.14
y := 0b1.01
```

**Symptom.**

```
invalid radix point in octal literal
invalid radix point in binary literal
```

**Root cause.** Only decimal and hexadecimal numbers can be floating-point.
`0o`/`0b` prefixes are integer-only; a `.` after them is an invalid radix
point. (Even hex floats need the `p` form — see Bug 14.)

**Fix.** Use a decimal float, or drop the fractional part:

```go
x := 3.14      // decimal float
y := 0b101     // binary int
```

---

## Bug 12: BOM in the middle of the file

```go
package main

func main() {<BOM>
	println("hi")
}
```

(An editor inserted a stray `U+FEFF` after the brace.)

**Symptom.**

```
invalid BOM in the middle of the file
```

**Root cause.** A UTF-8 BOM (`EF BB BF`) is allowed **only** as the very first
code point of a file, where the scanner silently drops it. Anywhere else the
`source.nextch` BOM check reports an error.

**Fix.** Strip the stray BOM. Configure your editor to save UTF-8 **without**
BOM, or with the BOM only at position 0. A quick check:

```bash
head -c3 file.go | xxd   # leading "efbbbf" is the only acceptable BOM
```

---

## Bug 13: Unterminated block comment swallows the file

```go
package main

/* TODO: finish this
func main() {
	println("hi")
}
```

**Symptom.**

```
comment not terminated
```

and apparently *everything* after `/*` is gone — `main` is "missing".

**Root cause.** `/*` opens a block comment that runs until `*/`. There is no
closing `*/`, so the scanner consumes the rest of the file as comment text and
reports `comment not terminated` at EOF. The "missing function" is a
*consequence*, not a separate bug.

**Fix.** Close the comment (or use `//` line comments which auto-terminate at
the newline):

```go
/* TODO: finish this */
func main() {
	println("hi")
}
```

---

## Bug 14: Hex float without a `p` exponent

```go
half := 0x1.8
```

**Symptom.**

```
hexadecimal mantissa requires a 'p' exponent
```

**Root cause.** A hexadecimal floating-point literal **must** have a binary
exponent introduced by `p`/`P`. `0x1.8` has a hex mantissa but no `p`
exponent, so it is rejected. (`p` denotes a power-of-two exponent: `0x1.8p1`
is `1.5 × 2¹ = 3.0`.)

**Fix.** Add the exponent, or write a decimal float:

```go
half := 0x1.8p0    // 1.5
// or
half := 1.5
```

---

## Bonus Bug 15: Shadowing a keyword by accident

```go
func process(type string) {}
```

**Symptom.**

```
syntax error: unexpected type, expected name
```

**Root cause.** `type` is a keyword, so the scanner tokenizes it as `_Type`,
not as an identifier. You cannot use it as a parameter name. The scanner's
keyword lookup is unconditional — there is no context where `type` becomes a
plain name.

**Fix.** Rename the parameter:

```go
func process(typ string) {}   // common Go convention: "typ"
```

---

## Bonus Bug 16: `..` typo instead of `...`

```go
func sum(nums ..int) int { return 0 }
```

**Symptom.**

```
syntax error: unexpected ., expected name
```

**Root cause.** The variadic marker is `...` (three dots), tokenized as a
single `ELLIPSIS` token. Two dots (`..`) is **not** a token at all — it is a
syntax error. The scanner reads `.`, looks ahead for more dots, finds only
one more, and (via its one-shot `rewind`) emits a single `.` followed by
another `.`, neither of which fits here.

**Fix.** Use three dots:

```go
func sum(nums ...int) int { return 0 }
```

---

## Bonus Bug 17: Invalid escape in an interpreted string

```go
msg := "100\% done"
```

**Symptom.**

```
syntax error: unknown escape
```

**Root cause.** In an interpreted string, `\` must begin a *recognized* escape
(`\n`, `\t`, `\\`, `\"`, `\xNN`, `\uNNNN`, `\UNNNNNNNN`, `\OOO`, ...). `\%` is
not a valid escape, so the scanner rejects it. (This trips people coming from
`printf`-style languages where `\%` or `%%` is a thing.)

**Fix.** `%` needs no escaping in a Go string; just drop the backslash:

```go
msg := "100% done"
```

If you genuinely need a literal backslash, double it: `"100\\% done"`.

---

## Summary

| #  | Trigger                              | Lexical cause                         |
| -- | ------------------------------------ | ------------------------------------- |
| 1  | `{` on its own line after `)`        | ASI inserts `;` after `)`             |
| 2  | `return` then value on next line     | ASI inserts `;` after `return`        |
| 3  | missing trailing comma               | ASI inserts `;` after the literal     |
| 4  | method chain split before `.`        | ASI inserts `;` after the identifier  |
| 5  | `\` in a Windows path string         | interpreted-string escape processing  |
| 6  | backtick inside a raw string         | raw strings have no escapes           |
| 7  | `'ab'`                               | rune holds exactly one code point     |
| 8  | `''`                                 | empty rune literal not allowed        |
| 9  | `//go: noinline` with a space        | directive needs exact `//go:` form    |
| 10 | `0xFF_`, `1__000`, `_500`            | underscore placement rules            |
| 11 | `0o3.14`, `0b1.01`                   | only dec/hex can be float             |
| 12 | BOM mid-file                         | BOM allowed only at offset 0          |
| 13 | unterminated `/* ... */`             | block comment runs to EOF             |
| 14 | `0x1.8`                              | hex float needs a `p` exponent        |
| 15 | keyword as identifier (`type`)       | keywords are not names                |
| 16 | `..` instead of `...`                | two dots is not a token               |
| 17 | unknown escape (`\%`) in a string    | only recognized escapes allowed       |

The pattern: **most "weird" Go errors are the lexer doing exactly what the
spec says** — especially semicolon insertion (bugs 1–4) and literal grammar
(bugs 5–14). When a one-line-off error makes no sense, ask "what token did the
line *end* with, and did the scanner insert a `;`?"
