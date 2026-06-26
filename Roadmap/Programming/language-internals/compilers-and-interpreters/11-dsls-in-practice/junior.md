# DSLs in Practice — Junior Level

> **Topic:** [DSLs in Practice](README.md)
> **Focus:** What a domain-specific language actually is, the difference between an *external* DSL (its own syntax, lexer, parser) and an *internal* one, and the small pipeline you build to turn DSL text into behaviour.

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

---

## Introduction

> Focus: **What is a DSL, why is SQL one, and what does "external" mean?**

A **domain-specific language (DSL)** is a small programming language built to solve problems in *one* narrow area really well, rather than to be a general tool for any problem. You already use several every day without calling them languages:

- **SQL** describes *what* data you want, not how to fetch it: `SELECT name FROM users WHERE age > 18`.
- **Regular expressions** describe text patterns: `^\d{3}-\d{4}$`.
- **CSS** describes how a page looks: `h1 { color: rebeccapurple; }`.
- A **Makefile** describes how to build software from sources.
- The **shell** (`bash`) is a language for gluing programs together.

None of these is a "general-purpose language" like Python, Java, or Go — you would not write a web server in regex. Each is tuned to one job. That focus is the entire point: a person who knows the domain can read and write the DSL even if they are not a deep programmer. A data analyst writes SQL; a designer writes CSS.

There are two flavours of DSL, and this topic is about the second one:

- An **internal (or *embedded*) DSL** is built *inside* a host language using that language's own syntax — method chains, operator overloading, builders. A query builder like `db.users().where(age.gt(18))` is an internal DSL: it is just normal method calls dressed up to read like a query. You get internal DSLs "for free" from the host. (The metaprogramming part of this roadmap covers them in depth.)
- An **external DSL** has *its own syntax* — its own keywords, its own grammar, its own files. SQL, regex, and CSS are external DSLs: `SELECT name FROM users` is not valid Python or Java; something has to *read those characters and understand them*. That "something" is a program you (or a library) write: a **lexer**, a **parser**, and an **interpreter** or **compiler**.

This page is about external DSLs — the applied capstone of everything else in this section. Lexing, parsing, building an AST, and evaluating it are exactly the techniques you have been learning; a DSL is where you put them all together to make a *real little language*. By the end of this level you will understand the pipeline `text → tokens → tree → result` and be able to read the code for a tiny calculator language.

> 🎓 **Why this matters for a junior:** The first time you write code that *reads another little language and runs it* — even a four-function calculator — something clicks. You stop seeing languages as magic and start seeing them as programs that process text. That intuition makes you better at using SQL, regex, and config formats, and far better at debugging them.

---

## Prerequisites

What you should be comfortable with before this page:

- **Required:** Writing functions, loops, and `if` statements in at least one language (examples here are in Python and a little JavaScript/Go).
- **Required:** Strings and arrays — you will be walking over characters and lists of tokens.
- **Required:** The idea of a **tree** as a data structure (a node that holds children). If you can picture a folder tree, you are fine.
- **Helpful:** Having used SQL, regex, or CSS as a *user*. You do not need to know how they are implemented — that is what we are about to learn.
- **Helpful:** A vague memory of "tokens" and "parsing" from earlier topics in this section. We will re-explain the basics here.

You do **not** need:

- Compiler theory, grammars in formal notation (BNF), or parser-generator tools like ANTLR — those appear at higher levels.
- Knowledge of bytecode, LLVM, or code generation. At this level a DSL just *runs* by walking its tree.

---

## Glossary

| Term | Definition |
|------|-----------|
| **DSL** | Domain-specific language. A small language aimed at one problem area (queries, styling, build rules). |
| **GPL** | General-purpose language (Python, Java, Go). Confusingly the same acronym as a software license; in this topic it always means the language kind. |
| **External DSL** | A DSL with its *own* syntax, stored in its own text/files, that you must lex and parse yourself. SQL, regex, CSS. |
| **Internal / embedded DSL** | A DSL expressed using a host language's existing syntax (method chains, builders). No separate parser needed. |
| **Host language** | The general-purpose language your DSL implementation is written in (and, for an internal DSL, the language the DSL is embedded in). |
| **Lexer (tokenizer / scanner)** | The program that turns raw DSL text into a list of **tokens**. Turns `"3 + 4"` into `[NUMBER(3), PLUS, NUMBER(4)]`. |
| **Token** | One meaningful chunk of input: a number, a keyword, an operator, a name. The "words" of the language. |
| **Parser** | The program that turns the flat list of tokens into a **tree** (the AST), checking that the tokens are in a valid order. |
| **Grammar** | The rules describing which sequences of tokens form valid programs. "An expression is a number, or an expression `+` an expression." |
| **AST (abstract syntax tree)** | The tree representation of a parsed program. `3 + 4` becomes a `Plus` node with two number children. |
| **Interpreter** | A program that *runs* the AST directly by walking it — also called **tree-walking**. |
| **Compiler / transpiler** | A program that *translates* the DSL into something else (machine code, bytecode, or another language like SQL or JavaScript) instead of running it directly. |
| **Evaluate / eval** | To compute the value or effect of a node in the AST. |
| **Recursive descent** | The simplest hand-written parsing style: one function per grammar rule, calling each other. |
| **Little language** | Jon Bentley's term (and Unix's philosophy) for a small, focused DSL such as `awk`, `sed`, or `dc`. |

---

## Core Concepts

### 1. A DSL is *text that a program reads*

The single most important idea: when you write `SELECT name FROM users`, those characters are just a **string**. Some program — the database — reads that string, figures out what it means, and acts on it. A DSL implementation is exactly such a program. Our job in this topic is to *be* that program for a language of our own.

So an external DSL always has two sides:

1. The **language** itself: its keywords, syntax, and meaning (the part a *user* sees).
2. The **implementation**: the lexer + parser + evaluator that reads the language (the part a *builder* writes).

A junior usually only ever sees side 1. This topic is about side 2.

### 2. The pipeline: text → tokens → tree → result

Almost every external DSL is processed the same way:

```text
"3 + 4 * 2"
     │
     ▼  LEXER  (split into tokens)
[ NUMBER(3), PLUS, NUMBER(4), STAR, NUMBER(2) ]
     │
     ▼  PARSER  (arrange into a tree by grammar rules)
        ( + )
       /     \
    3       ( * )
            /    \
          4       2
     │
     ▼  INTERPRETER  (walk the tree, compute)
11
```

- The **lexer** does *not* understand `+` versus `*` precedence. It just chops the string into meaningful pieces. It would reject `3 @ 4` only if `@` is not a valid character.
- The **parser** understands structure. It knows `*` binds tighter than `+`, so it builds `3 + (4 * 2)`, not `(3 + 4) * 2`. It rejects nonsense like `3 + + 4`.
- The **interpreter** understands meaning. It walks the tree bottom-up: compute `4 * 2 = 8`, then `3 + 8 = 11`.

This is the whole game. Every DSL — SQL, a config language, a rules engine — is some version of this pipeline.

### 3. Lexing: from characters to tokens

The lexer reads the input one character at a time and groups characters into tokens:

- It skips whitespace (`" "`, tabs, newlines) — those usually do not matter.
- When it sees a digit, it keeps reading digits to form a whole `NUMBER`.
- When it sees a letter, it keeps reading letters to form a `WORD` (which might be a keyword like `SELECT` or a name like `users`).
- Single characters like `+`, `*`, `(`, `)` become their own tokens.

Each token carries a **type** (`NUMBER`, `PLUS`, `NAME`) and sometimes a **value** (the actual number `3`, the actual name `"users"`).

### 4. Parsing: from tokens to a tree

The parser asks: *do these tokens form a valid program, and what is its structure?* The simplest way to write a parser by hand is **recursive descent**: you write one function per "shape" in the language. For a calculator:

- `parseExpression()` handles `+` and `-`.
- `parseTerm()` handles `*` and `/`.
- `parseFactor()` handles a number or a parenthesised sub-expression.

These functions call each other, and the nesting of the calls *is* the tree. We will see the code shortly.

### 5. Interpreting vs compiling

Once you have a tree you can do one of two things:

- **Interpret it** — walk the tree and produce a result *right now*. This is the easiest and what we do at this level. A spreadsheet evaluating `=A1+A2` interprets a tiny formula DSL.
- **Compile / transpile it** — translate the tree into something else: bytecode, machine code, or another language (a DSL that turns into SQL, or into JavaScript). The result runs later. This is more work but can be faster and reusable. Higher levels cover it.

For a junior, "DSL" mostly means "I parse it and interpret it."

### 6. The "little languages" idea

Unix is full of tiny DSLs: `awk` for text processing, `sed` for stream edits, `make` for builds, `dc` for arithmetic, `find`'s expression syntax. The philosophy — credited to Jon Bentley's *Little Languages* essay — is that a small, focused language often beats a pile of command-line flags or a big config file. You are learning to build exactly these.

---

## Real-World Analogies

**A vending machine.** You press `B`, then `4`. The machine does not understand "B4" as one thing instantly — it reads `B` (a column), then `4` (a row), then looks up what is at B4 and dispenses it. Lexing is reading the button presses into tokens; parsing is checking "is B4 a valid slot?"; interpreting is dropping the snack.

**Reading a recipe out loud.** "Two cups flour, one egg." Your eyes *lex* the words, your brain *parses* "quantity + ingredient" pairs, and your hands *interpret* by actually scooping flour. If the recipe said "flour two egg cups one," you would stumble — a parse error.

**A translator at the UN.** A *compiler* DSL is like a translator who rewrites a French speech into English text you read later. An *interpreter* DSL is like a live interpreter speaking the meaning right now. Same input language, two ways to act on it.

**A restaurant order ticket.** The waiter's shorthand ("2× burger, no onion") is a tiny external DSL. The kitchen has learned its grammar. It is unreadable to outsiders but perfectly efficient for the domain.

---

## Mental Models

- **A DSL is a program that reads a language.** Whenever you feel intimidated, remember: it is string processing with structure on top.
- **Three jobs, three programs.** Lexer = words. Parser = grammar. Interpreter = meaning. Keep them separate in your head and in your code; bugs become obvious ("is my lexer producing the right tokens?" is a different question from "is my parser building the right tree?").
- **The tree is the meaning.** Once you have the AST, the original text no longer matters. `3+4` and `3   +   4` and even a totally different syntax that produced the same tree all mean the same thing.
- **Internal DSL = borrow the host's parser. External DSL = bring your own.** That one sentence captures the whole trade-off you will weigh later: an external DSL gives you any syntax you want but you build (and forever maintain) the lexer, parser, and tooling yourself.
- **Most "config files" are secretly DSLs.** A `.env` file, a JSON config, an `nginx.conf` — each has a grammar and a reader. Seeing them this way demystifies them.

---

## Code Examples

We will build a **four-function calculator DSL** end to end in Python: it reads strings like `"3 + 4 * (2 - 1)"` and prints the answer. This is the smallest complete external DSL — lexer, parser, interpreter — and the foundation for everything later.

### Step 1 — The lexer (text → tokens)

```python
# tokens are just (type, value) pairs
def lex(src):
    tokens = []
    i = 0
    while i < len(src):
        c = src[i]
        if c.isspace():                 # skip spaces, tabs, newlines
            i += 1
        elif c.isdigit():               # read a whole number
            num = ""
            while i < len(src) and src[i].isdigit():
                num += src[i]
                i += 1
            tokens.append(("NUMBER", int(num)))
        elif c in "+-*/()":             # single-character tokens
            tokens.append((c, c))
            i += 1
        else:
            raise SyntaxError(f"unexpected character: {c!r}")
    tokens.append(("EOF", None))        # marks the end of input
    return tokens

print(lex("3 + 4 * 2"))
# [('NUMBER', 3), ('+', '+'), ('NUMBER', 4), ('*', '*'), ('NUMBER', 2), ('EOF', None)]
```

The lexer never thinks about precedence or validity of *structure*. It only knows characters. Notice the `EOF` token at the end — a tiny trick that makes the parser simpler because it always has "one more token" to look at.

### Step 2 — The parser (tokens → AST)

We use **recursive descent**, with three functions matching three grammar rules. The AST is just nested tuples.

```python
class Parser:
    def __init__(self, tokens):
        self.tokens = tokens
        self.pos = 0

    def peek(self):
        return self.tokens[self.pos]

    def eat(self, kind):
        tok = self.tokens[self.pos]
        if tok[0] != kind:
            raise SyntaxError(f"expected {kind}, got {tok[0]}")
        self.pos += 1
        return tok

    # expression := term (('+' | '-') term)*
    def expression(self):
        node = self.term()
        while self.peek()[0] in ("+", "-"):
            op = self.eat(self.peek()[0])[0]
            right = self.term()
            node = ("binop", op, node, right)
        return node

    # term := factor (('*' | '/') factor)*
    def term(self):
        node = self.factor()
        while self.peek()[0] in ("*", "/"):
            op = self.eat(self.peek()[0])[0]
            right = self.factor()
            node = ("binop", op, node, right)
        return node

    # factor := NUMBER | '(' expression ')'
    def factor(self):
        tok = self.peek()
        if tok[0] == "NUMBER":
            self.eat("NUMBER")
            return ("number", tok[1])
        if tok[0] == "(":
            self.eat("(")
            node = self.expression()
            self.eat(")")
            return node
        raise SyntaxError(f"unexpected token {tok[0]}")

def parse(src):
    p = Parser(lex(src))
    tree = p.expression()
    p.eat("EOF")               # nothing should be left over
    return tree

print(parse("3 + 4 * 2"))
# ('binop', '+', ('number', 3), ('binop', '*', ('number', 4), ('number', 2)))
```

The magic of precedence: because `expression` calls `term`, and `term` reads all the `*`/`/` it can before returning, multiplication "sticks together" *below* addition in the tree. We did not write any precedence table — the *shape of the function calls* encodes it.

### Step 3 — The interpreter (AST → value)

```python
def evaluate(node):
    kind = node[0]
    if kind == "number":
        return node[1]
    if kind == "binop":
        _, op, left, right = node
        a = evaluate(left)        # recurse into children first
        b = evaluate(right)
        if op == "+": return a + b
        if op == "-": return a - b
        if op == "*": return a * b
        if op == "/": return a / b
    raise ValueError(f"unknown node {node}")

def run(src):
    return evaluate(parse(src))

print(run("3 + 4 * 2"))      # 11
print(run("(3 + 4) * 2"))    # 14
print(run("10 / 4 - 1"))     # 1.5
```

That is a complete external DSL: 60-ish lines, three clearly separated stages, its own syntax. Everything in this topic is an elaboration of these three steps.

### A second tiny DSL: a key=value config reader

Not every DSL is arithmetic. Here is a minimal config language (`port = 8080` style), to show the same pipeline applied to a different domain.

```python
def parse_config(text):
    config = {}
    for lineno, line in enumerate(text.splitlines(), start=1):
        line = line.split("#", 1)[0].strip()   # strip comments + whitespace
        if not line:
            continue
        if "=" not in line:
            raise SyntaxError(f"line {lineno}: expected key = value")
        key, value = line.split("=", 1)
        config[key.strip()] = value.strip()
    return config

cfg = parse_config("""
    # server settings
    port = 8080
    host = localhost
""")
print(cfg)   # {'port': '8080', 'host': 'localhost'}
```

This is a *line-oriented* DSL — no recursion needed because the structure is flat. Recognising when your DSL is flat (config) versus nested (expressions) tells you how much parsing machinery you actually need.

---

## Pros & Cons

**Pros of an external DSL (from a junior's view):**

- **Readable by domain experts.** A non-programmer can read `WHEN order.total > 100 THEN discount 10%`.
- **Exactly the syntax you want.** You are not limited by the host language's punctuation.
- **Concise.** One line of DSL can replace pages of general code.
- **Separation.** The DSL lives in its own files; you can change rules without recompiling the whole app.

**Cons (the catch you must respect):**

- **You build the whole front end yourself** — lexer, parser, error messages, and later editor support. That is real, ongoing work.
- **Error messages are your responsibility.** A bad parser gives users "syntax error" with no line number; that frustration is on you.
- **It is a language to maintain forever.** Every new feature means new grammar, new parser code, new docs.
- **Learning curve for users.** A new syntax is one more thing people must learn.

A good rule for now: build an external DSL only when the domain is important and stable, and a plain config file or a library function would be genuinely awkward.

---

## Use Cases

External DSLs you will recognise, by category:

- **Query:** SQL, GraphQL — say *what* data you want.
- **Pattern matching:** regular expressions, glob patterns (`*.txt`).
- **Styling / markup:** CSS, HTML, Markdown.
- **Build / automation:** Makefiles, shell scripts, CI pipeline YAML (with its own mini-grammar).
- **Configuration:** `.env`, `nginx.conf`, `HCL`/Terraform, Dhall, Jsonnet.
- **Calculation:** spreadsheet formulas (`=SUM(A1:A10)`), a calculator like ours.
- **Schemas:** Protobuf `.proto` files, JSON Schema.
- **Rules:** "if cart over $50, free shipping" rule languages in e-commerce.

When *you* might build one early in your career: a small formula or filter language inside an app ("show rows where price < 20 and category = 'books'"), a config format with validation, or a teaching calculator. Start small.

---

## Coding Patterns

### Pattern: keep the three stages separate

```text
lex(text)        -> [tokens]
parse([tokens])  -> AST
evaluate(AST)    -> result
```

Never mix them. If lexing happens inside parsing, a bug in one hides the other. Three functions, three responsibilities.

### Pattern: one parse function per grammar rule

In recursive descent, the cleanest design maps each rule to a method (`expression`, `term`, `factor`). If you can write the rule in English, you can write the method.

### Pattern: a `peek`/`eat` pair for the parser

`peek()` looks at the current token without consuming it; `eat(kind)` consumes it and errors if it is the wrong kind. Almost every hand-written parser has this pair. It keeps position-tracking in one place.

### Pattern: represent the AST as simple data

At this level, use tuples or small dicts (`("binop", "+", left, right)`). You do not need classes yet. The interpreter just matches on the first element.

### Pattern: an `EOF` sentinel token

Always append an end-of-input token in the lexer so the parser never indexes past the end of the list. It also gives you a clean "expected end of input but found extra tokens" error.

---

## Best Practices

- **Build the smallest thing that works first.** Get `1 + 1` returning `2` before adding parentheses or variables. A DSL grows feature by feature.
- **Test the lexer alone.** Print the token list for a few inputs and eyeball it before touching the parser. Most "parser bugs" are actually lexer bugs.
- **Give errors a position.** Even just "syntax error at character 7" is hugely kinder to users than "syntax error."
- **Reject leftover input.** After parsing, assert you reached `EOF`. Otherwise `3 + 4 garbage` silently returns `7` and ignores the garbage.
- **Write down your grammar in comments.** The three-line grammar above is documentation *and* the structure of your code.
- **Don't add features you don't need.** A calculator does not need variables until something actually needs variables. (Higher levels discuss the "config language that grew into a programming language" trap — the seed of it is added "just one more feature.")
- **Prefer interpreting first.** Compiling/transpiling is an optimisation. Make it correct by interpreting, then make it fast if you must.

---

## Edge Cases & Pitfalls

- **Empty input.** What does your DSL do with `""`? Decide: error, or "no result." Handle it explicitly so it does not crash mysteriously.
- **Numbers that touch operators.** `3+4` (no spaces) must work just as well as `3 + 4`. Because the lexer skips whitespace and reads digits greedily, ours already handles both — verify it does.
- **Unbalanced parentheses.** `(3 + 4` should produce a clear error ("expected `)`"), not an index crash. Our `eat(")")` does this, but check it.
- **Division by zero.** `4 / 0` will throw a Python error. Decide whether the DSL should report a friendly "division by zero" instead.
- **Leftover tokens.** `1 2 3` lexes fine but is not a valid expression. The `EOF` check catches it; without that check you would silently return `1`.
- **Multi-character operators.** If you ever add `==` or `<=`, the lexer's "one character at a time" loop must look ahead. A single-char lexer cannot see `==` — a common first stumbling block.
- **Confusing the two acronyms.** "GPL" in this topic means general-purpose language, *not* the software license. Context makes it clear, but it trips people up.
- **Treating a config file's grammar as "not a real DSL."** It is. A `.env` parser is a DSL implementation, just a flat one. Respecting that helps you write better parsers for them.

Master the calculator until you can write it from memory. Every larger DSL — config languages, rule engines, query languages — is the same three stages with a bigger grammar. The `middle.md` level adds variables, functions, better error messages, and the idea of *transpiling* a DSL into another language.
