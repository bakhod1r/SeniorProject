# Parsers — Junior Level

> **Topic:** [Parsers](README.md)
> **Focus:** Turning a flat stream of tokens into a tree. What a grammar is, what a parse tree and an AST are, and how to write a parser by hand for simple expressions.

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
11. [Best Practices](#best-practices)
12. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)

---

## Introduction

> Focus: **What is parsing, and why is it a separate step from reading characters?**

A compiler reads your source code in two stages. First the **lexer** (or scanner) chops the raw character stream into **tokens** — the words of the language: `if`, `(`, `x`, `<`, `10`, `)`, `{`. Then the **parser** takes that flat list of tokens and discovers its *structure*: that `x < 10` is a comparison, that the comparison is the condition of an `if`, that the `if` has a body. The parser's output is a **tree**, because the structure of a program is fundamentally nested — expressions inside conditions inside statements inside functions.

That is the whole job of a parser: **a flat sequence in, a tree out**, where the tree must obey the rules of the language's **grammar**. If the tokens don't fit the grammar — `if x < { 10` — the parser reports a **syntax error**.

In one sentence: **the lexer turns characters into words; the parser turns words into sentences.** And just like English, the "sentence" has a hidden tree shape — subject, verb, object, clauses — that you don't see written out but that determines what the sentence *means*.

> 🎓 **Why this matters for a junior:** Almost every tool you use is a parser underneath. JSON loaders, config readers, SQL clients, template engines, regular-expression engines, the compiler for whatever language you write in, your editor's syntax highlighter — all of them parse. Once you understand the parse-tree idea and can write a small recursive-descent parser by hand, a huge category of "magic" tools stops being magic. You will also write better grammars, get clearer error messages, and stop being afraid of the phrase "context-free grammar."

This page covers: what a **grammar** is (terminals, nonterminals, productions), what a **parse tree** is versus an **abstract syntax tree (AST)**, the difference between **top-down** and **bottom-up** parsing at a beginner level, and how to hand-write a small **recursive-descent** parser and evaluator for arithmetic with correct precedence. The next level (`middle.md`) goes deep on LL vs LR, FIRST/FOLLOW sets, and Pratt parsing; `senior.md` covers parser generators, PEG/packrat, and conflict resolution; `professional.md` covers production compiler architecture and error-tolerant IDE parsing.

---

## Prerequisites

What you should know before reading this:

- **Required:** How to write functions, loops, and `if` statements in at least one language (Python, JavaScript, Go, Java, or C are all fine).
- **Required:** What **recursion** is — a function calling itself. Parsers are built on recursion.
- **Required:** What an **array** or **list** is, and how to walk through one with an index.
- **Helpful but not required:** A vague sense of what a **token** is — the smallest meaningful unit of code, like a keyword or a number. We treat tokens as already produced by a lexer.
- **Helpful but not required:** Having seen a **tree** data structure (nodes with children). The output of a parser *is* a tree.

You do **not** need to know:

- Formal language theory, automata, or the Chomsky hierarchy (touched on lightly in `middle.md`).
- How lexers are built (that is the previous topic — we assume tokens already exist).
- LR parsing tables, FIRST/FOLLOW sets, or parser generators (those are `middle.md` and `senior.md`).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Token** | The smallest meaningful unit produced by the lexer: a keyword, identifier, number, operator, or punctuation. The parser's *input*. |
| **Lexer / Scanner** | The stage *before* the parser. Turns characters into tokens. Not covered here in depth. |
| **Parser** | The stage that turns a flat token stream into a tree, checking it against the grammar. |
| **Grammar** | A formal set of rules describing which token sequences are valid and how they nest. |
| **Terminal** | A symbol that appears literally in the input: a token like `+`, `if`, or `NUMBER`. The "leaves." |
| **Nonterminal** | A named grammar rule that expands into other symbols: `Expression`, `Statement`. The "branches." |
| **Production / Rule** | One way a nonterminal can expand, e.g. `Expression → Expression + Term`. |
| **Parse tree (CST)** | A tree that records *every* grammar rule applied, including punctuation. Also called the **concrete syntax tree**. |
| **AST** | **Abstract syntax tree** — a cleaned-up tree that keeps only what matters for meaning, dropping parentheses and redundant nodes. |
| **Syntax error** | The input does not match the grammar. The parser's job is to detect and report it. |
| **Recursive descent** | The most common hand-written parsing style: one function per grammar rule, calling each other recursively. |
| **Top-down parsing** | Building the tree from the root (start symbol) downward, predicting which rule applies next. |
| **Bottom-up parsing** | Building the tree from the leaves (tokens) upward, combining pieces into bigger ones. |
| **Precedence** | Which operator binds tighter: `*` binds tighter than `+`, so `2 + 3 * 4` is `2 + (3 * 4)`. |
| **Associativity** | Which way same-precedence operators group: `1 - 2 - 3` is `(1 - 2) - 3` (left-associative). |
| **Lookahead** | The next token(s) the parser peeks at to decide what to do, without consuming them. |

---

## Core Concepts

### 1. The Two-Stage Pipeline: Lexer then Parser

Source code is just a string of characters. Trying to find structure character-by-character is painful. So compilers split the work:

```text
  "x = 3 + 4 * 2"
        │
        ▼   LEXER (characters → tokens)
  [ IDENT("x"), EQUALS, NUMBER(3), PLUS, NUMBER(4), STAR, NUMBER(2) ]
        │
        ▼   PARSER (tokens → tree)
        =
       / \
      x   +
         / \
        3   *
           / \
          4   2
```

The lexer handles "what are the words?" The parser handles "how do the words fit together?" Keeping them separate makes both simpler. The parser never deals with whitespace, comments, or how many digits a number has — that's all the lexer's job.

### 2. A Grammar Is a Set of Rules

A **grammar** describes the legal shapes of a language. The standard notation is a list of **productions**, each saying "this nonterminal can be replaced by this sequence of symbols." Here is a tiny grammar for arithmetic:

```text
Expression → Expression + Term
Expression → Expression - Term
Expression → Term
Term       → Term * Factor
Term       → Term / Factor
Term       → Factor
Factor     → ( Expression )
Factor     → NUMBER
```

- **Nonterminals** (`Expression`, `Term`, `Factor`) are the named rules — the parts you can expand.
- **Terminals** (`+`, `-`, `*`, `/`, `(`, `)`, `NUMBER`) are the actual tokens — you can't expand them further.
- The **start symbol** is the top rule, here `Expression`. A whole program is one big `Expression`.

This kind of grammar — where each rule's left side is a *single* nonterminal — is called a **context-free grammar (CFG)**. "Context-free" means a rule like `Term → Term * Factor` applies no matter what surrounds it. CFGs are the workhorse of programming-language syntax.

Notice how the grammar *encodes precedence*: `Term` (which handles `*` and `/`) sits *below* `Expression` (which handles `+` and `-`), so multiplication naturally groups tighter. We'll see why this works in the examples.

### 3. Derivations: Growing the Tree

A **derivation** is a sequence of rule applications that turns the start symbol into your actual tokens. To check that `3 + 4 * 2` is valid, you find a derivation:

```text
Expression
→ Expression + Term            (apply Expression → Expression + Term)
→ Term + Term                  (Expression → Term)
→ Factor + Term                (Term → Factor)
→ 3 + Term                     (Factor → NUMBER)
→ 3 + Term * Factor            (Term → Term * Factor)
→ 3 + Factor * Factor          (Term → Factor)
→ 3 + 4 * Factor               (Factor → NUMBER)
→ 3 + 4 * 2                    (Factor → NUMBER)
```

If a derivation exists, the input is valid. If none exists, it's a syntax error. The **parse tree** is just this derivation drawn as a tree.

### 4. Parse Tree vs Abstract Syntax Tree (AST)

A **parse tree** (concrete syntax tree) records *every* rule and *every* token, including parentheses and the chain of single-child rules like `Expression → Term → Factor → NUMBER`. It's faithful but verbose.

An **AST** throws away the noise and keeps only meaning. For `(3 + 4)`:

```text
PARSE TREE (concrete)           AST (abstract)
   Factor                            +
  / |   \                           / \
 (  Expr  )                        3   4
     |
   Expr + Term
    |       |
  Term    Factor
    |       |
  Factor    4
    |
    3
```

The AST has no `(` or `)` node — the parentheses did their job (grouping) during parsing and aren't needed afterward. The AST has no redundant `Expr → Term → Factor` chain either. **Every later stage of the compiler works on the AST, not the parse tree.** As a junior, the practical takeaway: your parser should *produce an AST*, using the grammar only as a guide for the parsing logic.

### 5. Two Families: Top-Down and Bottom-Up

There are two big strategies for parsing.

- **Top-down** starts at the root (the start symbol) and works downward, asking "given the next token, which rule should I expand?" The most popular hand-written form is **recursive descent**: you write one function per nonterminal. This is what we'll do in the code examples. It's intuitive — the call stack *is* the tree.
- **Bottom-up** starts at the tokens (leaves) and combines them into bigger pieces until it reaches the root. The classic form is **shift-reduce / LR parsing**, usually produced by a tool like yacc or bison. It handles a larger class of grammars but is harder to write by hand.

At the junior level, focus on top-down recursive descent — it's how most real compilers (GCC, Clang, the Go compiler, V8) actually parse, and it's something you can write yourself today. `middle.md` explains the bottom-up family in detail.

### 6. Precedence and Associativity

Two rules govern how operators group:

- **Precedence**: `*` and `/` bind tighter than `+` and `-`. So `2 + 3 * 4` means `2 + (3 * 4) = 14`, not `(2 + 3) * 4 = 20`.
- **Associativity**: when operators have the *same* precedence, which side wins? Subtraction is **left-associative**: `10 - 3 - 2` is `(10 - 3) - 2 = 5`, not `10 - (3 - 2) = 9`. Exponentiation (in many languages) is **right-associative**: `2 ^ 3 ^ 2` is `2 ^ (3 ^ 2)`.

A parser must get these right, or `1 + 2 * 3` computes the wrong answer. The grammar above bakes precedence in by *layering* the rules (`Expression` over `Term` over `Factor`). In recursive descent, this becomes a chain of functions: `parseExpression` calls `parseTerm` calls `parseFactor`.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Lexer** | Cutting a sentence into individual words and punctuation marks. |
| **Parser** | Diagramming the sentence — finding subject, verb, object, and clauses. |
| **Grammar** | The rules of English grammar that say a sentence needs a subject and a verb. |
| **Terminal** | An actual word, like "cat" or "runs." |
| **Nonterminal** | A grammatical category, like "noun phrase" or "verb phrase." |
| **Parse tree** | The full sentence diagram with every word labeled. |
| **AST** | A summary that keeps only "who did what to whom," dropping filler words. |
| **Syntax error** | A sentence that breaks the rules: "Cat the runs quickly the." |
| **Recursive descent** | Reading a nested outline: heading, then sub-points, then sub-sub-points, descending into each. |
| **Precedence** | Order of operations in math class: multiply before you add. |
| **Lookahead** | Peeking at the next word to decide what kind of phrase you're starting. |

---

## Mental Models

### The "One Function Per Rule" Model

In recursive descent, the grammar and the code line up almost one-to-one. A rule `Expression → Term (('+' | '-') Term)*` becomes a function `parseExpression()` that calls `parseTerm()`, then loops while the next token is `+` or `-`. The grammar is your blueprint; the functions are the building. If you can read the grammar, you can write the parser.

### The "Call Stack Is the Tree" Model

When `parseExpression` calls `parseTerm` which calls `parseFactor`, the chain of pending function calls *mirrors the shape of the tree you're building*. The deepest call is at a leaf (a number); as each function returns, it hands a finished subtree up to its caller, who plugs it in. You don't build the tree separately — the recursion builds it for you. Picture the call stack growing down into the input and the tree growing up out of the returns.

### The "Predict, Then Commit" Model (top-down)

A top-down parser is always at some point in the grammar with a choice: which rule applies next? It looks at the next token (lookahead) to *predict* the right rule, then commits to it. "The next token is `(`, so I'm parsing a parenthesized group." "The next token is a number, so I'm parsing a literal." When the language is designed so one token of lookahead always picks the right rule, parsing is clean and fast. When it isn't, you need cleverness (later levels cover this).

---

## Code Examples

We'll build a small **recursive-descent calculator**: parse and evaluate arithmetic like `3 + 4 * 2 - (1 + 1)`, respecting precedence and left-associativity. We assume the lexer already gave us a token list. We'll show the same parser in Python, JavaScript, and Go.

### The Grammar We Implement

```text
expression → term (('+' | '-') term)*
term       → factor (('*' | '/') factor)*
factor     → NUMBER | '(' expression ')'
```

This is the same arithmetic grammar, rewritten to avoid **left recursion** (a rule referring to itself as its first symbol, like `Expression → Expression + Term`). Left recursion makes naive recursive descent loop forever, so we replace it with a **loop** — `term (('+' | '-') term)*`. (The deep "why" is in `middle.md`; for now, just know: recursive descent uses loops, not self-first recursion.)

### Python

```python
# Tokens are simple tuples: ("NUMBER", 3), ("PLUS", "+"), ("LPAREN", "("), ...
class Parser:
    def __init__(self, tokens):
        self.tokens = tokens
        self.pos = 0

    def peek(self):
        return self.tokens[self.pos] if self.pos < len(self.tokens) else ("EOF", None)

    def advance(self):
        tok = self.peek()
        self.pos += 1
        return tok

    def expect(self, kind):
        tok = self.peek()
        if tok[0] != kind:
            raise SyntaxError(f"expected {kind}, got {tok[0]} at position {self.pos}")
        return self.advance()

    # expression → term (('+' | '-') term)*
    def expression(self):
        node = self.term()
        while self.peek()[0] in ("PLUS", "MINUS"):
            op = self.advance()[0]
            right = self.term()
            node = ("binop", op, node, right)   # build an AST node
        return node

    # term → factor (('*' | '/') factor)*
    def term(self):
        node = self.factor()
        while self.peek()[0] in ("STAR", "SLASH"):
            op = self.advance()[0]
            right = self.factor()
            node = ("binop", op, node, right)
        return node

    # factor → NUMBER | '(' expression ')'
    def factor(self):
        tok = self.peek()
        if tok[0] == "NUMBER":
            self.advance()
            return ("num", tok[1])
        if tok[0] == "LPAREN":
            self.advance()
            node = self.expression()
            self.expect("RPAREN")
            return node
        raise SyntaxError(f"unexpected token {tok[0]}")

def evaluate(node):
    if node[0] == "num":
        return node[1]
    _, op, left, right = node
    l, r = evaluate(left), evaluate(right)
    return {"PLUS": l + r, "MINUS": l - r, "STAR": l * r, "SLASH": l / r}[op]

# 3 + 4 * 2 - (1 + 1)  ==  3 + 8 - 2  ==  9
tokens = [("NUMBER", 3), ("PLUS", "+"), ("NUMBER", 4), ("STAR", "*"),
          ("NUMBER", 2), ("MINUS", "-"), ("LPAREN", "("), ("NUMBER", 1),
          ("PLUS", "+"), ("NUMBER", 1), ("RPAREN", ")")]
ast = Parser(tokens).expression()
print(evaluate(ast))   # 9
```

Read the three functions next to the three grammar rules — they match line for line. `expression` handles `+`/`-`, `term` handles `*`/`/`, and because `term` is *called inside* `expression`, multiplication binds tighter automatically. The `while` loop gives **left-associativity**: each new operator wraps the running result on the left.

### JavaScript

```javascript
function makeParser(tokens) {
  let pos = 0;
  const peek = () => tokens[pos] ?? { kind: "EOF" };
  const advance = () => tokens[pos++];
  const expect = (kind) => {
    if (peek().kind !== kind) throw new SyntaxError(`expected ${kind}, got ${peek().kind}`);
    return advance();
  };

  function expression() {              // term (('+'|'-') term)*
    let node = term();
    while (peek().kind === "PLUS" || peek().kind === "MINUS") {
      const op = advance().kind;
      node = { type: "binop", op, left: node, right: term() };
    }
    return node;
  }
  function term() {                    // factor (('*'|'/') factor)*
    let node = factor();
    while (peek().kind === "STAR" || peek().kind === "SLASH") {
      const op = advance().kind;
      node = { type: "binop", op, left: node, right: factor() };
    }
    return node;
  }
  function factor() {                  // NUMBER | '(' expression ')'
    const t = peek();
    if (t.kind === "NUMBER") { advance(); return { type: "num", value: t.value }; }
    if (t.kind === "LPAREN") { advance(); const n = expression(); expect("RPAREN"); return n; }
    throw new SyntaxError(`unexpected ${t.kind}`);
  }
  return { parse: expression };
}

function evaluate(node) {
  if (node.type === "num") return node.value;
  const l = evaluate(node.left), r = evaluate(node.right);
  return { PLUS: l + r, MINUS: l - r, STAR: l * r, SLASH: l / r }[node.op];
}
```

Same structure, different syntax. The shape of a recursive-descent parser is the same in every language: peek, decide, advance, recurse, loop, build a node.

### Go

```go
package main

import "fmt"

type Token struct {
	Kind  string
	Value float64
}

type Node struct {
	Kind        string // "num" or "binop"
	Op          string
	Value       float64
	Left, Right *Node
}

type Parser struct {
	tokens []Token
	pos    int
}

func (p *Parser) peek() Token {
	if p.pos < len(p.tokens) {
		return p.tokens[p.pos]
	}
	return Token{Kind: "EOF"}
}
func (p *Parser) advance() Token { t := p.peek(); p.pos++; return t }

func (p *Parser) expression() *Node { // term (('+'|'-') term)*
	node := p.term()
	for p.peek().Kind == "PLUS" || p.peek().Kind == "MINUS" {
		op := p.advance().Kind
		node = &Node{Kind: "binop", Op: op, Left: node, Right: p.term()}
	}
	return node
}
func (p *Parser) term() *Node { // factor (('*'|'/') factor)*
	node := p.factor()
	for p.peek().Kind == "STAR" || p.peek().Kind == "SLASH" {
		op := p.advance().Kind
		node = &Node{Kind: "binop", Op: op, Left: node, Right: p.factor()}
	}
	return node
}
func (p *Parser) factor() *Node { // NUMBER | '(' expression ')'
	t := p.peek()
	if t.Kind == "NUMBER" {
		p.advance()
		return &Node{Kind: "num", Value: t.Value}
	}
	if t.Kind == "LPAREN" {
		p.advance()
		n := p.expression()
		if p.peek().Kind != "RPAREN" {
			panic("expected )")
		}
		p.advance()
		return n
	}
	panic("unexpected token " + t.Kind)
}

func eval(n *Node) float64 {
	if n.Kind == "num" {
		return n.Value
	}
	l, r := eval(n.Left), eval(n.Right)
	switch n.Op {
	case "PLUS":
		return l + r
	case "MINUS":
		return l - r
	case "STAR":
		return l * r
	default:
		return l / r
	}
}

func main() {
	toks := []Token{{"NUMBER", 3}, {"PLUS", 0}, {"NUMBER", 4}, {"STAR", 0},
		{"NUMBER", 2}, {"MINUS", 0}, {"LPAREN", 0}, {"NUMBER", 1},
		{"PLUS", 0}, {"NUMBER", 1}, {"RPAREN", 0}}
	ast := (&Parser{tokens: toks}).expression()
	fmt.Println(eval(ast)) // 9
}
```

Three languages, one idea. This *is* how production compilers parse — they hand-write functions like these (with far more cases). You now know the core technique.

---

## Pros & Cons

This section compares **hand-written recursive descent** (what a junior should learn first) against the broad alternative of using a tool.

| Aspect | Recursive descent (hand-written) | Parser generator (tool-built) |
|--------|----------------------------------|-------------------------------|
| **Ease of starting** | Write functions that mirror the grammar — very intuitive. | Write a grammar file; the tool generates code you don't read. |
| **Readability** | The code *is* the grammar; easy to follow and debug. | Generated tables are opaque; debugging means reading the grammar, not the code. |
| **Error messages** | You control them — can be excellent and specific. | Often generic ("syntax error near X") unless heavily customized. |
| **Grammar power** | Handles most real languages, but you must rewrite left recursion. | Bottom-up generators handle a larger grammar class with less rewriting. |
| **Speed to a working parser** | Slower for big grammars — lots of functions to write. | Fast — feed a grammar, get a parser. |
| **Used by** | GCC, Clang, Go, rustc, V8 — most production compilers. | Many DSLs, SQL engines, quick prototypes, academic projects. |

For a junior, recursive descent wins because it teaches you what's actually happening. Generators are covered in `senior.md`.

---

## Use Cases

You are (often without realizing it) writing a parser whenever you:

- **Read a config or data format** — JSON, YAML, TOML, `.env`, CSV. Each has a grammar.
- **Build a calculator or formula engine** — spreadsheets, query filters, rule engines.
- **Write a mini-language or DSL** — a template language, a search-query syntax (`status:open AND priority:high`), a command interpreter.
- **Process structured text** — parsing log lines with a fixed structure, URL routes, version strings.
- **Implement an interpreter or compiler** — the obvious one. The parser is stage two.
- **Validate input with structure** — phone numbers, dates, arithmetic in a form field.

When *not* to hand-write a parser as a junior:

- If a **library already exists** (JSON, YAML, a real SQL parser), use it. Don't reinvent.
- If the input is **truly flat** with no nesting, a simple split or a regex may be enough — you don't need a tree.

---

## Coding Patterns

### Pattern 1: One Function Per Nonterminal

The defining pattern of recursive descent. Each grammar rule becomes a function. `parseExpression`, `parseTerm`, `parseFactor`, `parseStatement`, `parseIf`. The function names read like the grammar.

### Pattern 2: peek / advance / expect

Three tiny helpers underpin every hand-written parser:

```python
def peek(self):    return self.tokens[self.pos]          # look, don't consume
def advance(self): self.pos += 1; return self.tokens[self.pos-1]  # consume one
def expect(self, kind):                                  # consume or error
    if self.peek().kind != kind: raise SyntaxError(...)
    return self.advance()
```

`peek` lets you decide what to do; `advance` consumes a token; `expect` consumes a *required* token and errors if it's missing (used for closing `)`, `}`, `;`).

### Pattern 3: Loop for Repetition, Recursion for Nesting

A grammar like `term (('+' | '-') term)*` has a `*` (zero or more). Implement `*` with a **`while` loop**, not recursion. Use **recursion** only for genuine nesting, like a parenthesized `expression` inside a `factor`. This is the trick that avoids left-recursion infinite loops.

### Pattern 4: Build the AST as You Return

Don't build a parse tree and then convert it. Each parse function directly constructs and returns the **AST node** it represents. `factor` returns a `num` node; `expression` returns a `binop` node. The tree assembles itself from the bottom up as functions return.

### Pattern 5: Layer Functions for Precedence

Lowest-precedence operator at the top, highest at the bottom: `expression` (`+ -`) → `term` (`* /`) → `factor` (numbers, parens). Because the lower-precedence function *calls* the higher-precedence one, tighter-binding operators end up deeper in the tree. To add a new precedence level, insert a new function in the chain.

---

## Best Practices

- **Write the grammar first.** Before any code, write the grammar on paper. The parser is a transcription of it. Skipping this step is the #1 cause of tangled parser code.
- **One token of lookahead is usually enough.** Design your grammar so the next single token tells you which rule applies. This keeps the parser simple and fast.
- **Always produce an AST, not a parse tree.** Drop parentheses and redundant nodes immediately. Downstream code wants meaning, not punctuation.
- **Make `expect` produce a good error.** "Expected `)` to close the group opened at line 3, but found `;`" beats "syntax error." Your future self will thank you.
- **Keep the lexer and parser separate.** The parser should never look at raw characters or whitespace. If you find yourself checking `if char == ' '` in the parser, that logic belongs in the lexer.
- **Test with both valid and invalid input.** A parser that accepts valid programs but crashes ugly on bad input is half-done. Feed it garbage on purpose.
- **Rewrite left recursion into loops.** Any rule of the form `A → A op B` must become `A → B (op B)*` (a loop) for recursive descent to work.

---

## Edge Cases & Pitfalls

- **Left recursion = infinite loop.** If `expression()` calls `expression()` as its *very first* action, it recurses forever without consuming a token. Always rewrite `A → A op B` as a loop. This is the single most common beginner crash.
- **Forgetting to consume a token.** If a parse function reaches a token but never calls `advance()`, the parser gets stuck reading the same token forever. Every path must make progress.
- **Wrong precedence from a flat grammar.** If you put `+` and `*` at the *same* level, you get `2 + 3 * 4 = 20`. Layering the functions is what fixes it.
- **Wrong associativity from recursion.** Implementing `term (op term)*` with right-recursion instead of a loop makes `10 - 3 - 2` evaluate as `10 - (3 - 2) = 9` instead of `5`. Use the loop for left-associative operators.
- **Not checking for leftover tokens.** After parsing, if tokens remain (e.g. `3 + 4 )` has a stray `)`), that's an error. A clean parser checks that it consumed everything up to EOF.
- **Off-by-one in `peek`/`advance`.** Calling `advance` when you meant `peek` skips a token; the bug shows up as a confusing later error. Be disciplined about which one you call.
- **The dangling-else ambiguity (preview).** In `if a then if b then x else y`, which `if` does the `else` belong to? Languages resolve this by a rule (the `else` binds to the *nearest* `if`). You'll meet this properly in `middle.md`; just know it exists.
- **Empty input.** A grammar that requires at least one token will crash on `""`. Decide what an empty program means and handle it explicitly.

---

## Test Yourself

1. Write the grammar (in `nonterminal → ...` form) for a comma-separated list of numbers, like `1, 2, 3`. What's the terminal, what's the nonterminal?
2. In the calculator code, trace by hand what happens when parsing `2 * 3 + 4`. Which function gets called first, and what does the final AST look like?
3. Why does `expression` call `term`, and `term` call `factor`, rather than the other way around? What would break if you swapped them?
4. The loop `while peek is + or -` gives left-associativity. Rewrite `expression` using recursion instead of a loop and trace `10 - 3 - 2`. What answer do you get, and why is it wrong?
5. Add support for unary minus (`-5`, `-(2 + 3)`) to the `factor` function. Where does it go, and why there?
6. What is the difference between a parse tree and an AST for the input `(7)`? Draw both.
7. Feed the parser the invalid input `3 + + 4`. At which function does it fail, and what token is it looking at when it does?
8. The grammar `Expression → Expression + Term` is left-recursive. Rewrite it so recursive descent can handle it, and explain in one sentence why the rewrite terminates.

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────┐
│                        PARSING BASICS                            │
├──────────────────────────────────────────────────────────────────┤
│ Pipeline:   characters ─► LEXER ─► tokens ─► PARSER ─► tree (AST) │
├──────────────────────────────────────────────────────────────────┤
│ Grammar parts:                                                   │
│   terminal     = a real token  (+  NUMBER  if  ( )               │
│   nonterminal  = a named rule  (Expression, Term, Factor)        │
│   production   = one expansion (Expression → Term + Term)        │
│   start symbol = the top rule  (whole program)                   │
├──────────────────────────────────────────────────────────────────┤
│ Parse tree (CST) = every rule + every token (verbose)            │
│ AST              = only meaning, no parens/noise (use this)      │
├──────────────────────────────────────────────────────────────────┤
│ Recursive descent recipe:                                        │
│   * one function per nonterminal                                 │
│   * peek() to decide, advance() to consume, expect() to require  │
│   * loop for ( ... )*   recursion for nesting                    │
│   * build & return AST nodes as you go                           │
├──────────────────────────────────────────────────────────────────┤
│ Precedence:  layer functions  expression → term → factor         │
│   (lower precedence on top, higher on the bottom)                │
│ Associativity:  while-loop = left-assoc (10-3-2 = 5)             │
├──────────────────────────────────────────────────────────────────┤
│ Top pitfalls:                                                    │
│   * LEFT RECURSION = infinite loop → rewrite as a loop           │
│   * forgetting to advance() = stuck forever                      │
│   * flat grammar = wrong precedence                              │
│   * leftover tokens not checked = silent partial parse           │
└──────────────────────────────────────────────────────────────────┘
```

---

## Summary

- A **parser** turns a flat stream of **tokens** (from the lexer) into a **tree** that obeys the language's **grammar**.
- A **grammar** is a set of **productions** built from **terminals** (real tokens) and **nonterminals** (named rules). The kind used for programming languages is a **context-free grammar (CFG)**.
- The verbose **parse tree (CST)** records every rule and token; the clean **AST** keeps only meaning. **Every later compiler stage works on the AST.**
- There are two families: **top-down** (build from the root, e.g. recursive descent) and **bottom-up** (build from the leaves, e.g. shift-reduce). Most real compilers hand-write **recursive descent**.
- **Recursive descent** = one function per nonterminal, using `peek`/`advance`/`expect`, loops for repetition, and recursion for nesting. The call stack mirrors the tree.
- **Precedence** comes from *layering* functions (`expression → term → factor`); **associativity** comes from using a loop (left) vs recursion (right).
- The #1 beginner pitfall is **left recursion**, which makes naive recursive descent loop forever — rewrite `A → A op B` as `A → B (op B)*`.
- You parse constantly without noticing: config files, calculators, DSLs, query syntaxes. Knowing the parse-tree idea demystifies a huge swath of everyday tools.
- A junior's #1 habit: **write the grammar first, then transcribe it into one function per rule, and always return an AST.**

---
