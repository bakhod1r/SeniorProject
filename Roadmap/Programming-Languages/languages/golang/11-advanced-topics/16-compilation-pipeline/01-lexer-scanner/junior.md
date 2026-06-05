# Lexer / Scanner — Junior

The first thing `go build` does with your `.go` file is read it byte by byte
and chop it into *tokens*. The piece of code that does this is called the
**lexer** (also called the **scanner** or **tokenizer**). This file explains
what that means with small, runnable examples.

## 1. What is a lexer?

A source file is just a long sequence of bytes on disk:

```
p a c k a g e   m a i n \n \n f u n c   m a i n ( )   {   } \n
```

The compiler cannot reason about raw bytes. Before it can check types, build
an abstract syntax tree, or generate machine code, it needs to group those
bytes into meaningful chunks. Those chunks are **tokens**.

A lexer reads characters and emits tokens:

```
package  main  func  main  (  )  {  }
```

Each token has a **kind** (is it an identifier? a keyword? a brace?), an
optional **literal text** (the actual characters, like `main`), and a
**position** (which line and column it came from). The lexer is stage one of
the compilation pipeline:

```
source bytes ──▶ [ LEXER ] ──▶ tokens ──▶ [ PARSER ] ──▶ AST ──▶ ... ──▶ machine code
```

## 2. Tokens vs characters

The key mental shift is: **characters are small, tokens are meaningful.**

| Characters you typed | Token kind        | Literal text |
| -------------------- | ----------------- | ------------ |
| `func`               | keyword           | `func`       |
| `main`               | identifier (name) | `main`       |
| `(`                  | left paren        |              |
| `)`                  | right paren       |              |
| `42`                 | integer literal   | `42`         |
| `"hi"`               | string literal    | `"hi"`       |
| `+`                  | operator          | `+`          |
| `;`                  | semicolon         |              |

The lexer does **not** care whether `func main()` makes sense — that is the
parser's job. The lexer only guarantees "here is a well-formed sequence of
tokens". Whitespace and comments are usually thrown away (they separate tokens
but are not tokens the parser needs).

## 3. A tiny example you can run

Go ships a standard-library scanner, `go/scanner`, used by tools like
`gofmt`. Let us tokenize a real file. First create `hello.go`:

```go
package main

import "fmt"

func main() {
	fmt.Println("hello", 42)
}
```

Now a small program that prints every token (`tokenize.go`):

```go
package main

import (
	"fmt"
	"go/scanner"
	"go/token"
	"os"
)

func main() {
	src, err := os.ReadFile("hello.go")
	if err != nil {
		panic(err)
	}

	// A FileSet records position information (file name, line, column).
	fset := token.NewFileSet()
	file := fset.AddFile("hello.go", fset.Base(), len(src))

	var s scanner.Scanner
	s.Init(file, src, nil /* no error handler */, scanner.ScanComments)

	for {
		pos, tok, lit := s.Scan()
		if tok == token.EOF {
			break
		}
		fmt.Printf("%-10s %-8s %q\n", fset.Position(pos), tok, lit)
	}
}
```

Run it:

```bash
go run tokenize.go
```

Abbreviated output:

```
hello.go:1:1   package  "package"
hello.go:1:9   IDENT    "main"
hello.go:1:13  ;        "\n"
hello.go:3:1   import   "import"
hello.go:3:8   STRING   "\"fmt\""
hello.go:3:13  ;        "\n"
hello.go:5:1   func     "func"
hello.go:5:6   IDENT    "main"
hello.go:5:10  (        ""
hello.go:5:11  )        ""
hello.go:5:13  {        ""
hello.go:6:2   IDENT    "fmt"
hello.go:6:5   .        ""
hello.go:6:6   IDENT    "Println"
hello.go:6:13  (        ""
hello.go:6:14  STRING   "\"hello\""
hello.go:6:21  ,        ""
hello.go:6:23  INT      "42"
hello.go:6:25  )        ""
hello.go:6:26  ;        "\n"
hello.go:7:1   }        ""
hello.go:7:2   ;        "\n"
```

Notice three columns: **position**, **token kind**, and **literal**. Keywords
like `package` and `func` are their own kinds. Names like `main` and `fmt`
are `IDENT`. The string `"fmt"` keeps its quotes in the literal.

## 4. Where did those semicolons come from?

Look closely at the output above. You never typed a `;` anywhere in
`hello.go`, yet the scanner emitted several `;` tokens (with literal `"\n"`).

This is **automatic semicolon insertion** (ASI). Go's grammar technically
requires semicolons between statements, just like C. But the language spec
says the *lexer* inserts them for you so you never have to type them. The rule
is simple:

> At the end of a line, the scanner inserts a semicolon if the **last token**
> on that line was one of:
>
> - an identifier (`main`, `x`, ...)
> - a literal (`42`, `"hi"`, `3.14`)
> - one of the keywords `break`, `continue`, `fallthrough`, `return`
> - one of `++`, `--`, `)`, `]`, `}`

That is it. If a line ends with anything else (an operator like `+`, a comma,
an opening `{`), **no** semicolon is inserted, because the statement obviously
continues.

This is why Go has the famous brace rule:

```go
// CORRECT — '{' is on the same line as func, so no semicolon is inserted
func main() {
}

// BROKEN — line ends with ')', which triggers a semicolon.
// The scanner sees:  func main() ;  { }   →  syntax error!
func main()
{
}
```

That second form fails with `missing function body` / `unexpected semicolon`.
It is not a style rule the compiler nags you about — it is a direct
consequence of how the lexer works.

## 5. Common beginner misunderstandings

| Belief                                      | Reality                                                                       |
| ------------------------------------------- | ----------------------------------------------------------------------------- |
| "Go has no semicolons."                     | Go has semicolons; the *lexer* inserts them so you rarely type them.          |
| "The opening brace style is just a guideline." | It is enforced by ASI. `{` on its own line after `)` is a real syntax error. |
| "The lexer checks if my code is valid Go."  | No. The lexer only splits tokens. The parser checks structure.                |
| "Comments are tokens."                      | Comments are normally discarded; you must opt in (`ScanComments`) to see them. |
| "`'a'` and `"a"` are the same."             | `'a'` is a rune (int32) literal; `"a"` is a string literal. Different kinds.   |
| "Whitespace is meaningful like in Python."  | No — only *line ends* matter, and only for semicolon insertion.               |
| "`42` and `"42"` tokenize the same."        | `42` is `INT`; `"42"` is `STRING`. The lexer decides by the first character.  |

## 6. Things you can do today

1. **Tokenize your own files.** Take the `tokenize.go` program above and run
   it on a file in your project. Watch where semicolons appear.

2. **Break the brace rule on purpose.** Put `{` on the next line after `func
   main()` and read the error message. Now you understand *why* it happens.

3. **Spot the literal kinds.** Add a line with an int, a float, a string, a
   raw string (backticks), and a rune (`'x'`) and see how the scanner labels
   each one (`INT`, `FLOAT`, `STRING`, `CHAR`).

4. **Count tokens.** Modify the loop to count how many tokens are in a file.
   It is a one-line change and a good feel for how dense Go source is.

5. **Look at comments.** Because we passed `scanner.ScanComments`, try adding
   a `// hello` comment and see the `COMMENT` token appear.

## 7. Two scanners, briefly

There are two scanners in the Go world, and it is worth knowing they exist:

- **`go/scanner` + `go/token`** — the standard-library scanner. It is what
  *tools* use (gofmt, linters, your own programs). This is the one you ran
  above. It is stable, public, and documented.

- **`cmd/compile/internal/syntax`** — the scanner the *actual compiler* uses
  inside `go build`. It is internal and not importable, but it does the same
  job, just optimized for compiler speed. You will meet it in the senior file.

For everything you will write as a beginner, `go/scanner` is the one to use.

## 8. Reading the token table

When you run the tokenizer, the middle column shows the **token kind**. Here is
a cheat sheet for the names you will see most:

| Printed kind | What it is                          | Example source |
| ------------ | ----------------------------------- | -------------- |
| `IDENT`      | an identifier (name)                | `main`, `fmt`  |
| `INT`        | integer literal                     | `42`, `0xFF`   |
| `FLOAT`      | floating-point literal              | `3.14`, `1e9`  |
| `IMAG`       | imaginary literal                   | `3i`           |
| `CHAR`       | rune literal (single quotes)        | `'a'`          |
| `STRING`     | string literal (double/backtick)    | `"hi"`         |
| `COMMENT`    | a comment (only with ScanComments)  | `// note`      |
| `;`          | semicolon (often inserted for you)  |                |
| `package`    | a keyword (prints as itself)        | `package`      |

Keywords always print as themselves (`func`, `return`, `if`, ...), so they are
easy to spot. Anything that prints as `IDENT` is a name you (or the standard
library) chose. The literal column repeats the exact text for names and
literals, and is empty for punctuation like `(` or `{`.

One detail worth noticing in the output: a `;` token's literal is `"\n"` when
the scanner *inserted* it (because the line ended), and `";"` only when you
actually typed a semicolon. That is a handy way to see ASI happening.

## 9. Summary

- A lexer turns raw source **bytes** into **tokens**: small meaningful units
  with a kind, optional literal text, and a position.
- The lexer is **stage one** of `go build`; the parser comes next.
- Go's scanner performs **automatic semicolon insertion** at line ends after
  identifiers, literals, `return`/`break`/`continue`/`fallthrough`, and
  `++ -- ) ] }`. This is why the brace must hug the line above it.
- Comments and whitespace separate tokens but are normally discarded.
- You can watch all of this with `go/scanner` + `go/token` in ~20 lines of
  code — try it today.

## Further reading

- Go spec, "Tokens": https://go.dev/ref/spec#Tokens
- Go spec, "Semicolons": https://go.dev/ref/spec#Semicolons
- `go/scanner` package docs: https://pkg.go.dev/go/scanner
- `go/token` package docs: https://pkg.go.dev/go/token
- The std-lib scanner source: https://go.dev/src/go/scanner/scanner.go
- "Lexical elements" in the spec: https://go.dev/ref/spec#Lexical_elements
