# Lexers & Tokenizers — Junior Level

> **Topic:** [Lexers & Tokenizers](README.md)
> **Focus:** Turning a raw stream of characters into a clean stream of tokens — the very first thing every compiler and interpreter does.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Code Examples](#code-examples)
8. [Pros & Cons](#pros--cons)
9. [Use Cases](#use-cases)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Best Practices](#best-practices)
13. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
14. [Common Mistakes](#common-mistakes)
15. [Tricky Points](#tricky-points)
16. [Test Yourself](#test-yourself)
17. [Tricky Questions](#tricky-questions)
18. [Cheat Sheet](#cheat-sheet)
19. [Summary](#summary)
20. [What You Can Build](#what-you-can-build)
21. [Further Reading](#further-reading)
22. [Related Topics](#related-topics)
23. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> Focus: **What is a token, and how does a lexer chop source code into a list of them?**

When you write `x = 42 + y`, your editor shows you eight characters of meaning and some spaces. The computer sees a flat sequence of bytes: `x`, ` `, `=`, ` `, `4`, `2`, ` `, `+`, ` `, `y`. Before a compiler can do anything intelligent — parse the grammar, check types, generate code — it has to group those bytes into meaningful chunks: the *name* `x`, the *equals sign* `=`, the *number* `42`, the *plus* `+`, the *name* `y`. Each of those chunks is a **token**, and the component that produces them is the **lexer** (also called a *scanner* or *tokenizer*).

The lexer's whole job is narrow and concrete: **read characters from left to right, skip whitespace and comments, and emit a token every time it recognizes a complete unit — a keyword, an identifier, a number, a string, an operator, or a piece of punctuation.** It throws away the boring stuff (spaces, tabs, newlines, `// comments`) and keeps the meaningful stuff, tagging each piece with what *kind* of thing it is and where in the source it came from.

In one sentence: **a lexer is a meat grinder for source code — characters go in one end, a tidy stream of labeled tokens comes out the other.**

> 🎓 **Why this matters for a junior:** Every parser, syntax highlighter, linter, code formatter, and language server starts with lexing. It is the simplest phase of a compiler to understand fully, and getting it right teaches you the single most important pattern in all of compiler construction: *recognize a category of input, consume exactly the right number of characters, and produce a structured value.* If you understand lexing deeply, the rest of the front-end gets much less mysterious.

This page covers: what a token actually is (a *type*, a *lexeme*, and a *source position*), how a hand-written lexer reads character by character, the rules it follows (whitespace skipping, keyword-vs-identifier lookup, longest-match), and a complete working lexer for a tiny calculator language. Later levels go deeper: `middle.md` covers the theory (regular expressions, finite automata, longest-match formally), `senior.md` covers the hard cases (significant whitespace, string interpolation, the C "lexer hack"), and `professional.md` covers performance and incremental lexing for editors.

---

## Prerequisites

What you should know before reading this:

- **Required:** How to write and run a program with functions, loops, and arrays/lists in at least one language (Python, Go, Java, JavaScript, or C all work).
- **Required:** What a string is and how to index into it (`s[i]`) and check characters (`c >= '0' && c <= '9'`).
- **Required:** Basic `switch`/`if-else` branching on a single character.
- **Helpful but not required:** A vague sense that a program is compiled or interpreted in *phases* (lex → parse → analyze → generate).
- **Helpful but not required:** Having seen a regular expression like `[a-zA-Z_][a-zA-Z0-9_]*` even if you don't fully understand it.

You do **not** need to know:

- Finite automata, NFA/DFA, or Thompson's construction (that's `middle.md`).
- How to write a parser or a grammar (that's the next topic in this folder).
- Anything about Unicode normalization, string interpolation, or the typedef problem (that's `senior.md`).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Lexer** | The component that turns a character stream into a token stream. Also called *scanner* or *tokenizer*. |
| **Token** | A single meaningful unit of source code: a keyword, identifier, literal, operator, or punctuation mark. The lexer's output. |
| **Lexeme** | The actual run of characters a token was made from. For the token "number 42", the lexeme is the string `"42"`. |
| **Token type / kind** | The *category* of a token: `IDENTIFIER`, `NUMBER`, `PLUS`, `LPAREN`, `KEYWORD_IF`, etc. |
| **Token value** | The interpreted payload, e.g. the integer `42` parsed from the lexeme `"42"`. Not every token has one. |
| **Source position / span** | Where in the file the token came from: line, column, byte offset, or a start/end pair. Essential for error messages. |
| **Whitespace** | Spaces, tabs, newlines, carriage returns. Usually skipped (but not always — see significant whitespace at higher levels). |
| **Comment** | Text the programmer wrote for humans (`// ...`, `/* ... */`, `# ...`). Usually skipped by the lexer. |
| **Identifier** | A programmer-chosen name: `x`, `total`, `parseUser`. Matches a pattern like *letter followed by letters/digits*. |
| **Keyword** | A reserved word with built-in meaning: `if`, `while`, `return`, `func`. Looks like an identifier but is special. |
| **Literal** | A value written directly in the source: `42`, `3.14`, `"hello"`, `true`. |
| **Operator** | A symbol that combines values: `+`, `-`, `==`, `<=`, `&&`. |
| **Punctuation / delimiter** | Structural symbols: `(`, `)`, `{`, `}`, `,`, `;`. |
| **Maximal munch / longest match** | The rule that the lexer always takes the *longest* token it can. `<=` is one token, not `<` then `=`. |
| **Lookahead** | Peeking at the next character (or few characters) without consuming it, to decide what token you're building. |
| **EOF** | "End of file" — a special token the lexer emits when the input runs out, so the parser knows when to stop. |
| **Cursor / position** | The index of the next character the lexer will read. The lexer advances it as it consumes characters. |

---

## Core Concepts

### 1. A Token Is Three Things

When the lexer recognizes `42`, it doesn't just remember "there was a number." It produces a small record with (at least) three parts:

```text
Token {
    type:   NUMBER          // what kind of thing
    lexeme: "42"            // the exact text it matched
    span:   line 3, col 9   // where it came from
}
```

- The **type** tells the parser what grammatical role this token can play.
- The **lexeme** is the raw text — useful for identifiers (`x` vs `total`) and for reconstructing the source.
- The **span** (position) is what lets a compiler say *"error on line 3, column 9"* instead of a useless *"syntax error somewhere."*

A common mistake juniors make is to throw away the lexeme or the position because "the parser only needs the type." You almost always need all three. Error messages, IDE tooltips, and refactoring tools all depend on positions.

### 2. The Lexer's Loop

Every hand-written lexer has the same shape:

```text
loop:
    skip whitespace and comments
    if at end of input: emit EOF and stop
    look at the current character:
        a letter?           -> read an identifier or keyword
        a digit?            -> read a number
        a quote?            -> read a string
        an operator char?   -> read an operator (maybe multi-char)
        punctuation?        -> emit that single token
        anything else?      -> error: unexpected character
    emit the token, advance the cursor past it
```

That's it. A lexer is fundamentally a `while` loop with a `switch` on the first character of each token. The cleverness is all in "read an identifier" and "read a number" — small helper functions that keep consuming characters as long as they fit the pattern.

### 3. Skipping Whitespace and Comments

Most languages treat whitespace as a *separator* — it tells the lexer where one token ends and the next begins, but it isn't itself a token. So the lexer eats it silently:

```text
while current char is space, tab, newline, or carriage return:
    advance
```

Comments are skipped the same way, but they're trickier because you have to recognize where they start and end. A `// line comment` runs to the end of the line; a `/* block comment */` runs until the closing `*/`. The lexer consumes all of it and emits nothing.

### 4. Recognizing Identifiers and Keywords

An identifier matches a simple rule: it starts with a letter (or `_`), then continues with letters, digits, or underscores. So the lexer reads:

```text
read one letter/underscore
while next char is letter, digit, or underscore:
    advance
the lexeme is everything you just read
```

Now the crucial trick: **keywords look exactly like identifiers.** `if` matches the identifier pattern perfectly. So how does the lexer know `if` is a keyword but `iffy` is a name? The standard answer: **lex it as an identifier first, then look the lexeme up in a keyword table.** If `"if"` is in the table, emit a `KEYWORD_IF` token; otherwise emit an `IDENTIFIER` token. This "lex-then-look-up" pattern is used by virtually every real compiler — it's simpler and faster than trying to special-case every keyword in the scanning logic.

### 5. Recognizing Numbers

For a junior calculator, a number is *one or more digits, optionally with a decimal point and more digits*:

```text
read one digit
while next char is a digit:
    advance
if next char is '.' and the one after is a digit:
    advance past the '.'
    while next char is a digit:
        advance
```

The lexeme might be `"42"` or `"3.14"`. The lexer usually also computes the numeric *value* (the actual `42` or `3.14`) and stores it in the token. Real languages have far more numeric forms (hex `0xFF`, binary `0b101`, underscores `1_000`, exponents `1e10`) — those are covered at higher levels — but the digit-loop idea is the same.

### 6. Maximal Munch — Always Take the Longest Token

Here is the single most important *rule* in lexing. When the lexer is looking at `<=`, it has a choice: it could emit a `<` token and leave `=` for next time, or it could emit a single `<=` token. The rule, called **maximal munch** or **longest match**, says: **always grab the longest valid token.** So `<=` is one token.

Why does this matter? Because operators overlap. `<`, `<=`, `<<`, `<<=` all start with `<`. The lexer can't decide which one it's seeing until it looks ahead. Maximal munch makes the rule unambiguous: keep extending the token as long as the result is still a valid token. This is why you peek at the next character before committing.

### 7. Why Skip to a Token Stream at All?

Why not just let the parser read characters directly? Two reasons:

1. **Separation of concerns.** The parser works with grammar rules like *"an expression is a term plus a term."* It's far cleaner if "term" means a single `NUMBER` token than if it means "read a digit, then maybe more digits, then maybe a dot…". Lexing hides all that character-level detail.
2. **It's faster.** The lexer does one cheap left-to-right pass and hands the parser a compact stream. The parser never has to re-examine whitespace or comments again.

The token stream is the clean interface between the messy world of characters and the structured world of grammar.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Lexer** | A mailroom clerk who sorts a pile of loose mail into labeled bins. |
| **Character stream** | The unsorted pile of letters, flyers, and postcards. |
| **Token** | A single piece of mail, stamped with its category ("bill", "postcard", "junk"). |
| **Token type** | The label on the bin: BILL, LETTER, PACKAGE. |
| **Lexeme** | The actual envelope and its printed address. |
| **Skipping whitespace** | Throwing the empty padding and bubble wrap straight in the recycling. |
| **Skipping comments** | Tossing the junk flyers no one downstream cares about. |
| **Keyword lookup** | Checking each "letter" against a list of VIP senders; if the address matches, it goes in the special VIP bin instead of the generic one. |
| **Maximal munch** | When two stamps are stuck together, treating them as one combined postage, not two separate stamps. |
| **Source position** | Writing on each item which page and line of the original stack it came from, so you can find it again. |
| **EOF token** | The "no more mail" note the clerk leaves so the next office knows the batch is finished. |

---

## Mental Models

### The Conveyor Belt Model

Picture a conveyor belt carrying characters one at a time past you. You stand at a station with a label gun. You watch the characters go by; the moment you recognize a complete unit (a name, a number, a symbol), you grab that run of characters, slap a label on it, and drop it into the outgoing bin. Whitespace and comments you let fall off the end of the belt unlabeled. You never go backward — the belt only moves forward — but you *are* allowed to glance one step ahead before deciding where a token ends. This forward-only, look-one-ahead model is exactly how a hand-written lexer works.

### The "Read Until It Stops Fitting" Model

For each kind of token, you have a rule for what characters belong to it. To read an identifier, you keep consuming characters *as long as they're letters or digits*. The moment you hit a character that *doesn't* fit — a space, a `+`, a `(` — you stop, and that character becomes the start of the next token. Every token-reading helper has this shape: "consume the first character that starts this token, then keep consuming while the following characters still fit." Internalize this and you can write a lexer for almost anything.

### The "Type, Text, Place" Model

Whenever you produce a token, ask three questions: *What kind is it?* (the type), *What were the exact characters?* (the lexeme), *Where did it come from?* (the position). If your token answers all three, your downstream parser, error reporter, and IDE will all have what they need. A token that only answers the first question is a token you'll regret later.

---

## Code Examples

We'll build the same thing in every language: **a lexer for a tiny calculator language** that handles numbers, identifiers, the keywords `let` and `print`, the operators `+ - * /`, parentheses, and the assignment `=`. It skips whitespace and `#` line comments. Input like `let x = 3 + 4 * (2 - 1)` becomes a token stream.

### Python — A Complete Hand-Written Lexer

```python
from dataclasses import dataclass

@dataclass
class Token:
    type: str       # "NUMBER", "IDENT", "PLUS", "EOF", ...
    lexeme: str     # the exact characters
    line: int       # 1-based line number
    col: int        # 1-based column number

KEYWORDS = {"let", "print"}

class Lexer:
    def __init__(self, src: str):
        self.src = src
        self.pos = 0          # index of next char to read
        self.line = 1
        self.col = 1

    def _peek(self) -> str:
        return self.src[self.pos] if self.pos < len(self.src) else "\0"

    def _advance(self) -> str:
        c = self.src[self.pos]
        self.pos += 1
        if c == "\n":
            self.line += 1
            self.col = 1
        else:
            self.col += 1
        return c

    def tokens(self) -> list[Token]:
        out = []
        while True:
            self._skip_trivia()
            start_line, start_col = self.line, self.col
            c = self._peek()
            if c == "\0":
                out.append(Token("EOF", "", start_line, start_col))
                return out
            if c.isalpha() or c == "_":
                out.append(self._read_ident(start_line, start_col))
            elif c.isdigit():
                out.append(self._read_number(start_line, start_col))
            elif c in "+-*/()=":
                self._advance()
                kind = {"+": "PLUS", "-": "MINUS", "*": "STAR",
                        "/": "SLASH", "(": "LPAREN", ")": "RPAREN",
                        "=": "ASSIGN"}[c]
                out.append(Token(kind, c, start_line, start_col))
            else:
                raise SyntaxError(f"unexpected char {c!r} at line {self.line} col {self.col}")

    def _skip_trivia(self):
        while True:
            c = self._peek()
            if c in " \t\r\n":
                self._advance()
            elif c == "#":                      # line comment
                while self._peek() not in ("\n", "\0"):
                    self._advance()
            else:
                return

    def _read_ident(self, line, col) -> Token:
        start = self.pos
        while self._peek().isalnum() or self._peek() == "_":
            self._advance()
        lexeme = self.src[start:self.pos]
        kind = "KEYWORD" if lexeme in KEYWORDS else "IDENT"
        return Token(kind, lexeme, line, col)

    def _read_number(self, line, col) -> Token:
        start = self.pos
        while self._peek().isdigit():
            self._advance()
        if self._peek() == "." and self.pos + 1 < len(self.src) and self.src[self.pos + 1].isdigit():
            self._advance()                     # consume '.'
            while self._peek().isdigit():
                self._advance()
        return Token("NUMBER", self.src[start:self.pos], line, col)

if __name__ == "__main__":
    src = "let x = 3 + 4 * (2 - 1)  # a comment\nprint x"
    for t in Lexer(src).tokens():
        print(t)
```

Run it and you get a token per line, ending with `Token(type='EOF', ...)`. Notice the structure: a main loop, a "skip trivia" helper, and one helper per multi-character token kind. This is the shape of essentially every hand-written lexer.

### Go — The Same Lexer

```go
package main

import (
	"fmt"
	"unicode"
)

type Token struct {
	Type   string
	Lexeme string
	Line   int
	Col    int
}

var keywords = map[string]bool{"let": true, "print": true}

type Lexer struct {
	src  []rune
	pos  int
	line int
	col  int
}

func NewLexer(s string) *Lexer { return &Lexer{src: []rune(s), line: 1, col: 1} }

func (l *Lexer) peek() rune {
	if l.pos < len(l.src) {
		return l.src[l.pos]
	}
	return 0
}

func (l *Lexer) advance() rune {
	c := l.src[l.pos]
	l.pos++
	if c == '\n' {
		l.line++
		l.col = 1
	} else {
		l.col++
	}
	return c
}

func (l *Lexer) skipTrivia() {
	for {
		c := l.peek()
		switch {
		case c == ' ' || c == '\t' || c == '\r' || c == '\n':
			l.advance()
		case c == '#':
			for l.peek() != '\n' && l.peek() != 0 {
				l.advance()
			}
		default:
			return
		}
	}
}

func (l *Lexer) Tokens() []Token {
	var out []Token
	for {
		l.skipTrivia()
		line, col := l.line, l.col
		c := l.peek()
		switch {
		case c == 0:
			out = append(out, Token{"EOF", "", line, col})
			return out
		case unicode.IsLetter(c) || c == '_':
			out = append(out, l.readIdent(line, col))
		case unicode.IsDigit(c):
			out = append(out, l.readNumber(line, col))
		default:
			kinds := map[rune]string{'+': "PLUS", '-': "MINUS", '*': "STAR",
				'/': "SLASH", '(': "LPAREN", ')': "RPAREN", '=': "ASSIGN"}
			if k, ok := kinds[c]; ok {
				l.advance()
				out = append(out, Token{k, string(c), line, col})
			} else {
				panic(fmt.Sprintf("unexpected char %q at line %d col %d", c, l.line, l.col))
			}
		}
	}
}

func (l *Lexer) readIdent(line, col int) Token {
	start := l.pos
	for unicode.IsLetter(l.peek()) || unicode.IsDigit(l.peek()) || l.peek() == '_' {
		l.advance()
	}
	lexeme := string(l.src[start:l.pos])
	kind := "IDENT"
	if keywords[lexeme] {
		kind = "KEYWORD"
	}
	return Token{kind, lexeme, line, col}
}

func (l *Lexer) readNumber(line, col int) Token {
	start := l.pos
	for unicode.IsDigit(l.peek()) {
		l.advance()
	}
	if l.peek() == '.' && l.pos+1 < len(l.src) && unicode.IsDigit(l.src[l.pos+1]) {
		l.advance()
		for unicode.IsDigit(l.peek()) {
			l.advance()
		}
	}
	return Token{"NUMBER", string(l.src[start:l.pos]), line, col}
}

func main() {
	l := NewLexer("let x = 3 + 4 * (2 - 1)\nprint x")
	for _, t := range l.Tokens() {
		fmt.Printf("%-8s %q (%d:%d)\n", t.Type, t.Lexeme, t.Line, t.Col)
	}
}
```

Same structure as Python, just with Go's `[]rune` so multi-byte characters count as one. Notice both versions follow the identical loop-and-helpers pattern.

### Maximal Munch in Action

To handle two-character operators like `==`, `<=`, `!=`, the operator branch needs one character of lookahead. Here's the idea (Python):

```python
def _read_operator(self, line, col):
    c = self._advance()
    if c == "=" and self._peek() == "=":     # "==" beats "="
        self._advance()
        return Token("EQ", "==", line, col)
    if c == "<" and self._peek() == "=":     # "<=" beats "<"
        self._advance()
        return Token("LE", "<=", line, col)
    single = {"=": "ASSIGN", "<": "LT", ">": "GT", "+": "PLUS"}[c]
    return Token(single, c, line, col)
```

The rule: **check for the longer operator first.** If `=` is followed by `=`, take the two-character `==`. Otherwise fall back to the single-character `=`. That "try long, fall back to short" pattern *is* maximal munch implemented by hand.

### JavaScript — A Minimal Tokenizer (regex flavor)

```javascript
function tokenize(src) {
  const spec = [
    ["WS",      /^[ \t\r\n]+/],
    ["COMMENT", /^#[^\n]*/],
    ["NUMBER",  /^\d+(\.\d+)?/],
    ["IDENT",   /^[A-Za-z_]\w*/],
    ["OP",      /^[+\-*/()=]/],
  ];
  const keywords = new Set(["let", "print"]);
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    let matched = false;
    for (const [type, re] of spec) {
      const m = re.exec(src.slice(i));
      if (m) {
        const text = m[0];
        i += text.length;
        matched = true;
        if (type === "WS" || type === "COMMENT") break;   // skip trivia
        let kind = type;
        if (type === "IDENT" && keywords.has(text)) kind = "KEYWORD";
        tokens.push({ type: kind, lexeme: text });
        break;
      }
    }
    if (!matched) throw new Error(`unexpected char ${src[i]!} at index ${i}`);
  }
  tokens.push({ type: "EOF", lexeme: "" });
  return tokens;
}

console.log(tokenize("let x = 3 + 4 # hi"));
```

This is the "list of regular expressions, try each in order" approach. It's quick to write, but notice the subtle requirement: the rules are tried *in order*, and ordering matters — if you put `IDENT` before `KEYWORD` handling you'd never see keywords, and a regex engine evaluating each at every position can be slower than a hand-written character switch on big files. Higher levels explain why production compilers rarely lex with regexes at runtime.

---

## Pros & Cons

| Aspect | Pros | Cons |
|--------|------|------|
| **Separating lexing from parsing** | The parser deals with clean tokens, not raw characters — far simpler grammar code. | One more phase to write and keep in sync; some context-sensitive cases force the two to talk (covered later). |
| **Hand-written lexer** | Full control, great error messages, fast, easy to handle weird cases. | More code than a generated one; you implement maximal munch and lookahead yourself. |
| **Generated lexer (lex/flex, ANTLR)** | Write regular expressions, get a lexer; concise for simple languages. | Harder to produce friendly error messages; awkward for context-sensitive tokens; another build step. |
| **Regex-per-rule tokenizer** | Fastest to prototype; very readable. | Can be slow at scale (regex backtracking); ordering bugs; clumsy for indentation/interpolation. |
| **Throwing away whitespace/comments** | Smaller, cleaner token stream. | Formatters and refactoring tools *need* comments and exact spacing, so they keep them as "trivia." |

---

## Use Cases

Lexing is the entry point for nearly every tool that reads code or structured text:

- **Compilers and interpreters.** Lex → parse → analyze → generate. The lexer is always step one.
- **Syntax highlighters.** Your editor lexes the visible code and colors each token by its type (keywords blue, strings green, comments gray).
- **Linters and formatters.** `gofmt`, `prettier`, `eslint`, `clang-format` all tokenize first. Formatters keep comments and whitespace as trivia so they can put them back.
- **Configuration and data formats.** JSON, YAML, TOML, INI parsers all begin with a tokenizer.
- **Template engines and query languages.** SQL, GraphQL, Jinja, regex engines themselves — all lex their input first.
- **Calculators and small DSLs.** Any time you let users type expressions, the first thing you write is a lexer.

It is the **wrong** focus when:

- You're parsing a trivial fixed format (e.g. comma-separated numbers) — `split(",")` is fine, no lexer needed.
- The input is binary, not text — you want a binary decoder, not a character lexer.

---

## Coding Patterns

### Pattern 1: The peek/advance pair

Every lexer has two primitives: `peek()` returns the current character *without* consuming it, and `advance()` returns it *and* moves the cursor forward. Lookahead is just `peek`. All token-reading logic is built from these two.

```python
def peek(self):    return self.src[self.pos] if self.pos < len(self.src) else "\0"
def advance(self): c = self.src[self.pos]; self.pos += 1; return c
```

### Pattern 2: "Consume while" helpers

To read a run of characters that all match a rule, loop on `peek`:

```python
def consume_while(self, predicate):
    start = self.pos
    while predicate(self.peek()):
        self.advance()
    return self.src[start:self.pos]
```

Then `read_number` is `consume_while(str.isdigit)` and `read_ident` is `consume_while(is_ident_char)`. This collapses repetitive loops into one reusable helper.

### Pattern 3: Lex-then-look-up for keywords

Don't try to detect keywords while scanning. Read the whole identifier, then check a set:

```python
lexeme = self.read_ident()
kind = "KEYWORD" if lexeme in KEYWORDS else "IDENT"
```

### Pattern 4: A sentinel EOF token

Append a single `EOF` token at the end instead of returning a flag or `None`. The parser can then treat "end of input" like any other token (`if token.type == "EOF"`), which removes special-case branching everywhere.

### Pattern 5: Capture the start position before reading

Record `(line, col)` *before* you start consuming a token, so the position points at the token's first character, not its last:

```python
start_line, start_col = self.line, self.col
tok = self.read_number()      # reads several chars
# attach (start_line, start_col) to tok
```

---

## Clean Code

- **One helper per token kind.** `read_ident`, `read_number`, `read_string`. Each does one thing and is easy to test.
- **Never index `src[pos]` directly in the main loop.** Go through `peek`/`advance` so bounds-checking and position-tracking live in one place.
- **Keep the token type names as constants or an enum**, not raw strings scattered around. A typo in `"NUMBR"` is a silent bug.
- **Attach positions at creation, not later.** A token born without a position rarely gets one retrofitted correctly.
- **Make the lexer produce a clear error, not a crash,** on an unexpected character: include the character and its position.
- **Don't interpret values you don't have to yet.** Storing the lexeme `"42"` is fine; converting to the integer `42` can happen here or later, but be consistent.

---

## Best Practices

- **Always emit an EOF token.** It simplifies the parser and prevents "ran off the end of the array" bugs.
- **Track line and column from the start.** Retrofitting positions into a lexer that ignored them is painful. Bump the line counter on every `\n`.
- **Decide your whitespace policy explicitly.** Most languages skip it; a few (Python, YAML, Haskell) make it significant. Know which you are before you write code.
- **Implement maximal munch by checking longer operators first.** `==` before `=`, `<=` before `<`. It's a tiny bit of lookahead that prevents real bugs.
- **Keep comments and whitespace as "trivia" if you're building a formatter or IDE tool**, even though a compiler throws them away. You can't pretty-print code whose comments you deleted.
- **Test the lexer in isolation** before wiring it to a parser. Feed it tricky inputs and assert on the exact token list. Lexer bugs are much easier to find here than after the parser mangles them.
- **Reject, don't guess, on bad input.** If you see a character you don't recognize, produce a precise error. Silent skipping hides typos.

---

## Edge Cases & Pitfalls

- **Numbers ending in a dot.** Is `1.` a float, or the integer `1` followed by a `.`? Is `.5` a float? Languages differ. Your digit-loop needs an explicit rule. (The calculator above requires a digit after the dot, so `1.` lexes as `1` then `.`.)
- **Forgetting maximal munch.** If you emit `<` and `=` as two tokens, `<=` breaks. Always try the longer operator first.
- **Off-by-one in positions.** Recording the position *after* consuming a token points at the wrong spot. Capture it before.
- **Comments that contain token-like text.** `# let x = 5` must be skipped entirely; the lexer must not lex `let` inside a comment. This is why comment-skipping happens *before* the token switch.
- **Unterminated strings/comments.** `/* never closed` should be a clear error, not an infinite loop or an off-the-end crash. Always check for EOF inside your "read until closer" loops.
- **Identifiers that start with a digit.** `3x` is not a valid identifier; the lexer should read `3` as a number and then hit `x`. Make sure your "start of identifier" check excludes digits.
- **The empty input.** A lexer on `""` should produce exactly one token: `EOF`. Test this.
- **Whitespace inside what you thought was one token.** `3 . 14` is *not* the number `3.14` — the spaces separate it into three tokens. The lexer only joins adjacent characters.

---

## Common Mistakes

1. **Lexing directly off `src[i]` everywhere** instead of through `peek`/`advance`, leading to scattered bounds bugs and broken position tracking.
2. **Detecting keywords during scanning** with a tangle of special cases, instead of lex-as-identifier-then-look-up.
3. **Throwing away source positions** because "the parser doesn't need them" — then being unable to produce a decent error message.
4. **Not handling EOF inside loops.** A `while peek() != '"'` loop with no EOF check spins forever on an unterminated string.
5. **Emitting single-character operators only,** so `==`, `<=`, `!=` get split into two tokens and the parser chokes.
6. **Forgetting to skip whitespace before *every* token,** so leading spaces produce a spurious "unexpected character" error.
7. **Mixing the lexeme and the value.** Storing only the parsed integer loses the original text you might need for errors; storing only the text means re-parsing later. Decide and document.
8. **Treating bytes as characters in a Unicode source.** A multi-byte character read one byte at a time corrupts identifiers and positions. Use the language's character/rune type.

---

## Tricky Points

- **Whitespace is usually a separator, not a token — but not always.** In Python, indentation is meaningful, and the lexer has to emit synthetic INDENT/DEDENT tokens. That's a `senior.md` topic, but it's why "lexers always skip whitespace" is an oversimplification.
- **Keywords aren't a separate character pattern.** They share the identifier pattern exactly; the *only* difference is a table lookup after scanning. This surprises people who expect the lexer to "know" `if` is special from its shape.
- **Maximal munch can produce a "wrong" but correct split.** In C, `a+++b` lexes as `a ++ + b` (not `a + ++ b`) because the lexer greedily grabs `++` first. The result compiles strangely but the lexer is behaving exactly as specified.
- **The lexer doesn't understand grammar.** It happily tokenizes `) ) ) + + +` — nonsense to a parser, but each token is individually valid. Catching that nonsense is the *parser's* job, not the lexer's. Keep the responsibilities separate.
- **A number's lexeme and value can disagree on edge cases.** `0xFF` has lexeme `"0xFF"` and value `255`. Don't assume the lexeme *is* the value.

---

## Test Yourself

1. Tokenize `let total = (a + 12) * 3` by hand. List every token with its type and lexeme. How many tokens (including EOF)?
2. Why does the lexer read an identifier *first* and only then check whether it's a keyword, instead of checking for keywords directly?
3. Show the token stream for `x<=y`. Now show it if your lexer forgot maximal munch and only emitted single-character operators. Which one can the parser use?
4. What single token does the calculator lexer produce for `3.14`? What two (or three) tokens does it produce for `3 . 14`? Why the difference?
5. Run the calculator lexer mentally on `print # done`. What tokens come out? Trace where the comment gets skipped.
6. The empty string `""` should produce how many tokens, and which one(s)?
7. Add a `==` (equality) operator to one of the example lexers. Which existing branch do you modify, and what lookahead do you need?
8. Why does the lexer emit an `EOF` token instead of just returning the list and letting the parser check `len`?

---

## Tricky Questions

**Q1: Is `if` a keyword to the lexer, or just an identifier that the parser treats specially?**

It depends on the design, but the most common approach makes the *lexer* responsible: it scans `if` as an identifier, looks it up in a keyword table, finds a match, and emits a distinct `KEYWORD_IF` token. The parser then sees a keyword token directly. Some languages instead lex everything as `IDENT` and let later phases distinguish — but the standard, fast pattern is the lexer's keyword table.

**Q2: Does the lexer skip whitespace, or does it produce whitespace tokens?**

In most languages, it skips whitespace silently — whitespace is a separator, not a token. But tools that need to reproduce source exactly (formatters, IDEs) keep whitespace and comments as "trivia" attached to tokens. And in whitespace-significant languages (Python, Haskell), the lexer must emit special indentation tokens. So the honest answer is "usually skips, sometimes keeps, occasionally turns into a token."

**Q3: For `1+2`, how many tokens does the lexer produce, and does whitespace matter?**

Three tokens: `NUMBER(1)`, `PLUS`, `NUMBER(2)`, plus an EOF. Whitespace does *not* matter here — `1+2`, `1 + 2`, and `1  +  2` all produce the identical token stream, because the lexer treats spaces purely as separators and discards them.

**Q4: Why does `<=` become one token but `< =` (with a space) becomes two?**

Maximal munch operates on *adjacent* characters. In `<=`, the `<` and `=` are adjacent, so the lexer extends the operator to the two-character `<=`. In `< =`, the space breaks adjacency: the lexer reads `<`, then skips the space, then reads `=` separately. The lexer only ever combines characters that touch.

**Q5: Can the lexer tell that `) ( + +` is invalid?**

No — and it's not supposed to. The lexer's job is only to recognize *individual* tokens. Each of `)`, `(`, `+`, `+` is a perfectly valid token. Whether they can appear in that *order* is a grammar question, which the parser answers. Keeping this boundary clean is fundamental to compiler design.

**Q6: If you delete the EOF token, what breaks?**

The parser loses a reliable signal that input is finished. Instead of cleanly checking `token.type == "EOF"`, it has to check the list length everywhere it reads, which is error-prone and tends to cause "index out of range" crashes when it reads one past the end. The EOF token is a tiny convention that removes a whole class of bugs.

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────┐
│                     LEXER / TOKENIZER                            │
├──────────────────────────────────────────────────────────────────┤
│ JOB: characters in  ─►  tokens out                               │
│      (skip whitespace + comments, label the meaningful runs)     │
├──────────────────────────────────────────────────────────────────┤
│ A TOKEN =  type   ("NUMBER", "IDENT", "PLUS", "EOF" ...)         │
│            lexeme ("42", "total", "+")                            │
│            span   (line, col / byte offset)                      │
├──────────────────────────────────────────────────────────────────┤
│ THE LOOP:                                                        │
│   skip whitespace & comments                                     │
│   at EOF?  -> emit EOF, stop                                      │
│   letter?  -> read ident, then keyword-table lookup              │
│   digit?   -> read number                                        │
│   quote?   -> read string                                        │
│   symbol?  -> read operator (longest match!)                     │
│   else     -> error: unexpected character                        │
├──────────────────────────────────────────────────────────────────┤
│ TWO PRIMITIVES:                                                  │
│   peek()    look at current char, don't consume                  │
│   advance() return current char, move cursor forward             │
├──────────────────────────────────────────────────────────────────┤
│ KEY RULES:                                                       │
│   * maximal munch: always take the LONGEST valid token           │
│     (<= is one token; check long operators before short)         │
│   * keywords = identifiers + a table lookup                      │
│   * capture position BEFORE consuming the token                  │
│   * always emit a trailing EOF token                             │
│   * lexer recognizes tokens; PARSER checks their order           │
└──────────────────────────────────────────────────────────────────┘
```

---

## Summary

- A **lexer** (scanner, tokenizer) turns a flat stream of characters into a clean stream of **tokens** — the first phase of every compiler, interpreter, highlighter, and linter.
- A **token** carries three things: a **type** (its category), a **lexeme** (the exact characters), and a **position/span** (where it came from, for error messages).
- The lexer is a simple loop: **skip whitespace and comments, switch on the first character, read a complete token, repeat.** It emits an **EOF** token at the end.
- **Identifiers and keywords share the same character pattern**; the lexer reads an identifier, then looks the lexeme up in a **keyword table** to decide which it is.
- **Maximal munch (longest match)** is the core rule: always grab the longest valid token, so `<=` is one token, not two. Implement it by checking longer operators before shorter ones.
- The lexer recognizes tokens *individually*; it does **not** understand grammar. `) ) +` is fine to the lexer and a problem for the parser. This clean split is the point.
- Build lexers around two primitives — **peek** and **advance** — and one helper per token kind. Track line and column from the very start.
- This level is the foundation. Higher levels add the theory (regular languages and finite automata), the hard cases (significant whitespace, string interpolation, the C lexer hack), and performance for huge files and live editors.

---

## What You Can Build

- **A calculator language lexer.** Extend the examples to handle `% ** == != < > <= >=` and a `mod` keyword. Test that maximal munch picks the right operators.
- **A JSON tokenizer.** Numbers, strings (with escapes), `true`/`false`/`null`, and the `{ } [ ] : ,` punctuation. A great first "real format" lexer.
- **A syntax highlighter for a small language.** Lex the input, then print each token wrapped in a color code based on its type. You now have a toy editor highlighter.
- **A token-stream pretty-printer.** Read a file and print one labeled token per line with positions. Useful for debugging any language you're implementing.
- **An "unexpected character" linter.** Run your lexer over a directory and report the exact line and column of any character it can't recognize.
- **A configuration-file reader.** Tokenize a tiny INI-style format (`key = value`, `# comments`, `[sections]`) and turn the token stream into a dictionary.

---

## Further Reading

- *Crafting Interpreters* — Robert Nystrom. Chapter 4 ("Scanning") is the best beginner-friendly hand-written-lexer walkthrough in existence. Free online.
- *Compilers: Principles, Techniques, and Tools* ("the Dragon Book") — Aho, Lam, Sethi, Ullman. Chapter 3 is the classic treatment of lexical analysis.
- *Writing An Interpreter In Go* — Thorsten Ball. Builds a lexer from scratch in clear, idiomatic Go.
- *Engineering a Compiler* — Cooper & Torczon. A rigorous but readable chapter on scanners and finite automata.
- The `flex` manual — the GNU lexer generator; useful even if you hand-write, to understand the generated approach.
- *Let's Build a Compiler* — Jack Crenshaw. A gentle, old-school series that starts with a character-at-a-time scanner.

---

## Related Topics

- Next levels of this same topic: middle (the theory of regular languages and finite automata, formal maximal munch), senior (significant whitespace, string interpolation, the C lexer hack, Unicode identifiers), professional (lexer performance, interning, incremental lexing for editors), interview (questions and answers), and tasks (exercises, including a full lexer capstone).
- The next phase after lexing is **parsing** — turning the token stream into a syntax tree. That is the sibling topic in this same compilers-and-interpreters folder, and it consumes exactly the token stream you produce here.
- Lexing builds on the idea of **regular expressions and regular languages**, covered in the language-internals theory material; a token type is just a regular expression over characters.
- Downstream phases — semantic analysis, type checking, and code generation — all rely on the source positions the lexer attaches, so error reporting threads back to this phase.

---

## Diagrams & Visual Aids

### Characters In, Tokens Out

```text
SOURCE TEXT:   l e t   x   =   3 . 1 4   +   y
               └─┬─┘   │   │   └──┬──┘   │   │
                 ▼     ▼   ▼      ▼      ▼   ▼
TOKENS:     [KEYWORD "let"] [IDENT "x"] [ASSIGN "="]
            [NUMBER "3.14"] [PLUS "+"]  [IDENT "y"]
            [EOF ""]

   (the spaces are skipped — they don't become tokens)
```

### The Main Loop

```text
            ┌───────────────────────────┐
            │   skip whitespace/comment │
            └─────────────┬─────────────┘
                          ▼
                   ┌─────────────┐    yes
                   │  at EOF?    │ ─────────►  emit EOF, STOP
                   └──────┬──────┘
                          │ no
                          ▼
            ┌──────────────────────────────┐
            │  switch on current character │
            ├──────────────────────────────┤
            │  letter  -> read identifier  │──► keyword-table lookup
            │  digit   -> read number      │
            │  quote   -> read string      │
            │  symbol  -> read operator    │──► longest match
            │  other   -> ERROR            │
            └──────────────┬───────────────┘
                           ▼
                     emit token, loop
```

### Maximal Munch

```text
INPUT:  < = y

step 1: see '<'         candidate token: "<"
step 2: peek next '='   "<=" is also a valid token, and it's LONGER
            ───────────────►  take "<="     (maximal munch)
step 3: cursor now at 'y'

RESULT:  [LE "<="]  [IDENT "y"]

INPUT:  < space = y
        the space breaks adjacency:
RESULT:  [LT "<"]  [ASSIGN "="]  [IDENT "y"]
```

### A Token's Anatomy

```text
            source:  ... = 3.14 + ...
                          └──┬─┘
                             │
                  ┌──────────▼───────────┐
                  │  TOKEN               │
                  │   type   = NUMBER    │
                  │   lexeme = "3.14"    │
                  │   value  = 3.14      │
                  │   line   = 3         │
                  │   col    = 9         │
                  └──────────────────────┘
```
