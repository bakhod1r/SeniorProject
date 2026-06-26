# DSLs in Practice — Middle Level

> **Topic:** [DSLs in Practice](README.md)
> **Focus:** Growing a toy DSL into a usable one — variables, functions, types, real error messages — and the four ways to build the parser (recursive descent, Pratt, parser combinators, ANTLR). Plus the first big decision: *interpret or transpile?*

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

> Focus: **How do real external DSLs get built, and which parsing technique should I reach for?**

At the junior level a DSL was three small functions: lex, parse, evaluate. That is enough for a calculator, but real DSLs — a rule language, a config language like HCL, a query language that turns into SQL — need more: **variables**, **functions or operators with proper precedence**, **good error messages** with line and column, a way to **report multiple errors**, and often a decision about whether to **interpret** the language or **transpile** it into a target like SQL or JavaScript.

This page is about the *engineering* of an external DSL, not just the toy. We cover:

- The four standard ways to build a parser, and when each fits: **recursive descent** (hand-written, simplest), **Pratt parsing** (the elegant way to handle operator precedence), **parser combinators** (parsers built from small composable functions — parsec, nom, FParsec), and **parser generators** (ANTLR, Lex/Yacc — you write a grammar, the tool writes the parser).
- The split between **front end** (lex + parse → AST) and **back end** (interpret OR compile/transpile). Once you have an AST you can run it, *or* turn it into something else: bytecode, SQL, another language. Transpiling a DSL to SQL or to JavaScript is one of the most common real uses.
- Why **error messages** are a first-class feature of a DSL, not an afterthought — a DSL nobody can debug is a DSL nobody uses.

We will still keep the internal-vs-external distinction front of mind. An **external** DSL (the subject here) brings its own syntax and therefore needs all this machinery. An **internal** DSL borrows the host's parser (it is just method calls) and needs none of it — but gives up syntactic freedom and dedicated error messages. The metaprogramming section covers internal DSLs; here we pay the price of external syntax and learn to do it well.

> 🎓 **Why this matters at this level:** You are now the person who *decides* how the parser is built and whether the DSL interprets or compiles. Picking recursive descent when you needed Pratt (and drowning in precedence bugs), or hand-rolling a parser when ANTLR would have been a day's work, are the mistakes this page exists to prevent.

---

## Prerequisites

- **Required:** The junior-level calculator pipeline (lex → parse → evaluate) and recursive descent. We extend it directly.
- **Required:** Recursion you are comfortable reading and writing — every parser here is recursive.
- **Required:** Basic data structures: maps/dictionaries (for variable environments), stacks, trees.
- **Helpful:** Having used SQL and at least one config DSL (Terraform/HCL, YAML pipelines) as a user, so the "transpile to SQL" examples land.
- **Helpful:** Awareness of higher-order functions / closures — parser combinators lean on them heavily.

You do **not** yet need: formal grammar theory (LL/LR, FIRST/FOLLOW sets), LLVM or native code generation, or DSL tooling like language servers. Those are senior/professional material.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Front end** | Lexer + parser: turns DSL text into an AST. Independent of what you do next. |
| **Back end** | What consumes the AST: an interpreter, a bytecode compiler, or a transpiler to another language. |
| **Recursive descent** | Hand-written top-down parser: one function per grammar rule. Simple, readable, total control over errors. |
| **Pratt parser** | A parsing technique (top-down operator precedence) that handles operator precedence and associativity cleanly via per-token "binding power." |
| **Parser combinator** | A small parser is a function; combinators (`seq`, `or`, `many`) glue small parsers into bigger ones. Libraries: parsec (Haskell), nom (Rust), FParsec (F#). |
| **Parser generator** | A tool (ANTLR, Yacc/Bison, Lex/Flex) that reads a grammar file and *generates* lexer/parser source code for you. |
| **Grammar (BNF/EBNF)** | A formal notation for the rules of a language, e.g. `expr := term ('+' term)*`. ANTLR and Yacc consume grammars like this. |
| **Interpreter (tree-walk)** | Runs the AST directly by recursively visiting nodes. Easiest back end. |
| **Compiler** | Translates the AST to a lower form: bytecode for a VM, or machine code (often via LLVM). |
| **Transpiler / source-to-source** | A compiler whose *target is another high-level language* — DSL → SQL, DSL → JavaScript, TypeScript → JavaScript. |
| **Environment / scope** | The map from variable names to values used while interpreting (`{x: 10}`). |
| **Visitor** | A pattern (and ANTLR's output) for walking an AST: one method per node type. |
| **Precedence** | Which operators bind tighter (`*` before `+`). |
| **Associativity** | For equal precedence, which side groups first. `-` is left-associative: `8 - 3 - 2 = (8-3)-2`. |
| **Token stream** | The lexer's output, consumed by the parser one token at a time, usually with one-token lookahead. |
| **Sentinel / synchronisation** | A recovery point (like a newline or `;`) the parser skips to after an error so it can report more than one error per run. |

---

## Core Concepts

### 1. The front end / back end split

Draw a hard line through your DSL:

```text
        FRONT END                         BACK END (pick one or more)
text → lex → tokens → parse → AST  ─┬─→ interpret  → run now
                                    ├─→ compile    → bytecode → VM
                                    ├─→ transpile  → SQL / JS / Go source
                                    └─→ analyse    → lints, type-check, docs
```

The AST is the contract between the two halves. This separation is the single most valuable design decision: the same front end can feed an interpreter for development, a transpiler for production, *and* a linter for editor tooling. Mixing parsing with evaluation (a classic beginner shortcut) destroys that reuse.

### 2. The four ways to build the front end

**Recursive descent (hand-written).** One function per rule. Best when: you want full control, the best possible error messages, and no build-time dependency. This is what most production language front ends actually use (Go, Clang, the V8 parser, `rustc`). Downside: operator precedence with many levels gets verbose.

**Pratt parsing (top-down operator precedence).** A refinement of recursive descent specifically for expressions with many operators and precedence levels. Each token gets a *binding power*; the parser loops, consuming operators while their binding power exceeds the current threshold. Best when: your DSL has rich expressions (`a + b * c ^ d == e`). It collapses a tower of `expression`/`term`/`factor` functions into one elegant loop.

**Parser combinators.** A parser is "a function from input to (result, rest-of-input)." Tiny parsers (`number`, `keyword("SELECT")`) combine with operators: `seq(a, b)`, `a.or(b)`, `many(a)`. Libraries: **parsec** (Haskell), **nom** (Rust), **FParsec** (F#), and ports in many languages. Best when: you want a parser that reads almost like the grammar, in code, with no separate build step. They shine for medium DSLs and config formats. Downside: error messages and left-recursion need care; performance can lag a tuned hand-written parser.

**Parser generators (ANTLR, Lex/Yacc).** You write a grammar file; the tool generates lexer + parser source. **ANTLR** is the modern go-to for external DSLs: write `Expr.g4`, run ANTLR, get a lexer, parser, and a **visitor** skeleton in Java/Python/Go/C#/JS. **Lex/Yacc** (and GNU **Flex/Bison**) are the classic C toolchain: Lex generates the lexer from regex rules, Yacc generates an **LR** parser from a grammar. Best when: the grammar is large and stable, you want the grammar itself to be the source of truth, and you can accept generated code plus a build step. Downside: less control over errors, a learning curve, and a build dependency.

A practical rule: **small/medium DSL → recursive descent or combinators; expression-heavy → add Pratt; large formal grammar → ANTLR.**

### 3. Variables and environments

The moment your DSL has names (`let x = 5`, then `x + 1`), the interpreter needs an **environment**: a map from name to value, threaded through evaluation. Nested scopes (a function body, a block) become *chained* environments — look up a name in the current scope, fall back to the parent. This is the seed of how every real language handles scope.

### 4. Interpret vs compile/transpile — the back-end choice

- **Interpret (tree-walk).** Walk the AST each time you run. Simplest, easiest to debug, fast to *build*. Slowest to *run*. Right for config evaluation, one-shot rule checks, REPLs.
- **Compile to bytecode.** Turn the AST into a flat instruction list a small VM executes. More work; much faster for repeated execution (a rules engine evaluating millions of events).
- **Transpile to another language.** Emit source in a target the host already runs well. The biggest real-world category:
  - A query DSL → **SQL** (you generate `SELECT ... WHERE ...`).
  - A template language → **HTML**/text.
  - A reactive-UI DSL → **JavaScript**.
  - A schema DSL (Protobuf `.proto`) → generated structs in many languages.
  Transpiling lets you reuse a mature engine (the SQL database, the JS runtime) instead of writing your own.

### 5. Error messages are a feature

A DSL's error messages are part of its UX. Minimum bar: report **line and column**, the **token that was unexpected**, and **what was expected**. Better: show the offending source line with a caret. Hand-written parsers (recursive descent / Pratt) give you the most control here, which is a major reason production languages avoid generators. For multi-error reporting you add **error recovery**: on a parse error, skip tokens until a *synchronisation point* (a `;`, a newline, a closing brace), then keep parsing so the user sees *all* their mistakes, not just the first.

### 6. Where the internal/external line really bites

An **internal** DSL (method chains in the host language) gives you the host's parser and error messages for free — but every expression must be valid host syntax, so you cannot have your own keywords or operators, and a typo produces a *host*-language error, not a domain error. An **external** DSL gives you any syntax and domain-specific errors, at the cost of building (and maintaining) everything on this page. Choosing external means signing up for a lexer, a parser, an evaluator/transpiler, *and* eventually tooling — forever.

---

## Real-World Analogies

**Two parser styles, two kitchens.** Recursive descent is a chef cooking from memory — total control, every dish exactly how they want, but they must know every recipe. A parser generator (ANTLR) is a meal kit: you write the recipe card (grammar), the factory pre-portions everything (generated parser). Faster to start, less control over the final plate.

**Transpiling is dubbing a film.** Interpreting a DSL is live subtitling — meaning delivered in real time. Transpiling to SQL is dubbing: you produce a whole new soundtrack (the SQL) that the cinema (the database) plays perfectly on its own equipment.

**Parser combinators are LEGO.** Each brick (`number`, `whitespace`, `keyword`) is tiny and useless alone; snapped together with combinators they build any structure. The grammar and the code look almost identical.

**Pratt's binding power is a tug-of-war rope strength.** Each operator pulls its operands with a certain strength; `*` pulls harder than `+`, so it wins the operand in the middle. The parser just compares pull strengths in a loop.

---

## Mental Models

- **AST is the contract.** Design it well and the front end and back end evolve independently. Every back end (interpreter, transpiler, linter) is "just" a walk over the same tree.
- **Precedence is binding power, not nesting of functions.** Once you see Pratt's binding-power model, the recursive-descent `expr/term/factor` tower reveals itself as one fixed precedence ladder. Pratt makes the ladder data, not code.
- **Choose the parser by the grammar's shape, not by fashion.** Expression-heavy → Pratt. Big and stable → ANTLR. Medium and you value readable code → combinators. Need the best errors and minimal deps → recursive descent.
- **"Transpile to a mature engine" beats "write my own engine."** If your DSL's semantics map onto SQL or JS, emit that. You inherit decades of optimisation and tooling for free.
- **A DSL's error messages are its user manual.** Invest there early; it is the difference between adoption and abandonment.

---

## Code Examples

### A Pratt parser for expressions

This replaces the junior tower (`expression`/`term`/`factor`) with one loop driven by binding powers. Adding a new operator is a one-line table change.

```python
# binding power (precedence). higher = binds tighter.
BP = {"+": 10, "-": 10, "*": 20, "/": 20, "^": 30}
RIGHT_ASSOC = {"^"}            # exponent groups right: 2^3^2 = 2^(3^2)

class Pratt:
    def __init__(self, tokens):
        self.toks = tokens
        self.i = 0

    def peek(self): return self.toks[self.i]
    def next(self):
        t = self.toks[self.i]; self.i += 1; return t

    # parse an expression whose operators must bind tighter than `min_bp`
    def expr(self, min_bp=0):
        tok = self.next()
        if tok[0] == "NUMBER":
            left = ("number", tok[1])
        elif tok[0] == "(":
            left = self.expr(0)
            assert self.next()[0] == ")", "expected )"
        elif tok[0] == "-":                      # unary minus (prefix)
            left = ("neg", self.expr(100))
        else:
            raise SyntaxError(f"unexpected {tok}")

        while True:
            op = self.peek()[0]
            if op not in BP or BP[op] < min_bp:
                break
            self.next()
            # for right-assoc, recurse with the SAME bp; else bp+1
            next_min = BP[op] if op in RIGHT_ASSOC else BP[op] + 1
            right = self.expr(next_min)
            left = ("binop", op, left, right)
        return left
```

The whole precedence table lives in `BP`. Compare with three near-identical functions in recursive descent — Pratt is why interpreter authors love it for expression languages.

### Transpiling a filter DSL to SQL

A common real task: a safe little filter language that users type, which you turn into a parameterised SQL `WHERE` clause. Input like `age > 18 and country = "US"` becomes SQL plus bound parameters (never string-concatenated — that would be SQL injection).

```python
# AST shape from a small parser (omitted): 
#   ("and", left, right) | ("cmp", op, field, value)
def to_sql(node, params):
    kind = node[0]
    if kind == "and":
        l = to_sql(node[1], params)
        r = to_sql(node[2], params)
        return f"({l} AND {r})"
    if kind == "or":
        l = to_sql(node[1], params)
        r = to_sql(node[2], params)
        return f"({l} OR {r})"
    if kind == "cmp":
        _, op, field, value = node
        if field not in ALLOWED_FIELDS:           # allow-list, not raw input
            raise ValueError(f"unknown field {field}")
        params.append(value)                       # parameterised!
        return f"{field} {op} ?"
    raise ValueError(node)

ALLOWED_FIELDS = {"age", "country", "status"}

params = []
where = to_sql(("and",
                ("cmp", ">", "age", 18),
                ("cmp", "=", "country", "US")), params)
print(where)    # (age > ? AND country = ?)
print(params)   # [18, 'US']
# final query:  SELECT * FROM users WHERE (age > ? AND country = ?)
```

Two things make this safe and maintainable: an **allow-list of fields** (the DSL cannot reference arbitrary columns) and **parameter binding** (values never enter the SQL string). This is the heart of "transpile a DSL to SQL," and the security points return at the senior level.

### A parser combinator sketch (in code)

Combinators in miniature, to show the style. Each parser is a function `input -> (value, rest) | None`.

```python
def lit(s):                                  # match a literal string
    def p(inp):
        if inp.startswith(s):
            return (s, inp[len(s):])
        return None
    return p

def seq(*parsers):                           # all in order
    def p(inp):
        out = []
        for parser in parsers:
            r = parser(inp)
            if r is None: return None
            val, inp = r
            out.append(val)
        return (out, inp)
    return p

def alt(*parsers):                           # first that matches
    def p(inp):
        for parser in parsers:
            r = parser(inp)
            if r is not None: return r
        return None
    return p

# grammar in code: greeting := ("hello" | "hi") " world"
greeting = seq(alt(lit("hello"), lit("hi")), lit(" world"))
print(greeting("hi world"))     # (['hi', ' world'], '')
print(greeting("bye"))          # None
```

Real libraries (parsec, nom, FParsec) add whitespace handling, error positions, `many`, `sep_by`, and backtracking control — but this is the whole idea: build big parsers from small ones.

### Interpreter with variables (an environment)

```python
def evaluate(node, env):
    kind = node[0]
    if kind == "number":  return node[1]
    if kind == "var":     return env[node[1]]
    if kind == "let":                       # ("let", name, value_expr, body)
        _, name, value_expr, body = node
        new_env = dict(env)
        new_env[name] = evaluate(value_expr, env)
        return evaluate(body, new_env)
    if kind == "binop":
        _, op, a, b = node
        x, y = evaluate(a, env), evaluate(b, env)
        return {"+": x+y, "-": x-y, "*": x*y, "/": x/y}[op]
    raise ValueError(node)

# let x = 10 in x * 2   →  20
tree = ("let", "x", ("number", 10), ("binop", "*", ("var", "x"), ("number", 2)))
print(evaluate(tree, {}))   # 20
```

A fresh `dict(env)` per scope gives correct lexical scoping cheaply. Real interpreters chain environments instead of copying, but the model is the same.

---

## Pros & Cons

**Recursive descent** — *for:* simplest mental model, best errors, no deps; *against:* precedence is verbose.

**Pratt** — *for:* elegant precedence/associativity, easy to extend; *against:* the binding-power idea takes a moment to click; only solves expressions.

**Parser combinators** — *for:* code reads like the grammar, composable, no build step; *against:* error messages and left-recursion need effort, can be slower, runtime library dependency.

**Parser generators (ANTLR/Yacc)** — *for:* grammar is the single source of truth, scales to large languages, generates visitors; *against:* build-step dependency, weaker default error messages, less control, a tool to learn and keep updated.

**Interpret vs transpile** — interpreting is *simplest to build and debug* but *slowest to run*; transpiling *reuses a mature engine* and *runs fast* but is *more work and an indirection to debug through*.

---

## Use Cases

- **Filter / search DSLs transpiled to SQL** (the example above) — extremely common in admin tools and analytics products.
- **Config languages with logic** — HCL/Terraform, Jsonnet, CUE. They parse to an AST and *evaluate* to plain JSON/config.
- **Template engines** (Jinja, Handlebars, ERB) — a DSL embedded in text that transpiles/interprets to a rendered string. (More at senior level.)
- **Rule engines** — "when X then Y" languages interpreted over events.
- **Schema DSLs** — Protobuf, GraphQL SDL, JSON Schema: parsed, then code-generated (a kind of transpile) into types for many languages.
- **ANTLR-built languages** — many real DSLs ship an ANTLR grammar (`.g4`) and generated visitors.

---

## Coding Patterns

### Pattern: separate `Lexer`, `Parser`, and `Evaluator`/`Emitter` classes

Three files, three responsibilities. The `Emitter` (for transpilers) or `Evaluator` (for interpreters) shares the same `Parser`.

### Pattern: the Visitor for AST traversal

For anything beyond a toy, give each node type a class and write a visitor with one method per type (`visit_binop`, `visit_let`). ANTLR generates exactly this. It keeps the interpreter, the transpiler, and the linter as *separate visitors* over one AST.

### Pattern: Pratt binding-power table

Keep precedence as data (`{"+": 10, "*": 20}`) so adding operators never touches control flow. Encode associativity by whether you recurse with `bp` (right) or `bp + 1` (left).

### Pattern: parameterised emission for transpilers

When transpiling to SQL or any host language, *never* inline user values into the output string. Emit placeholders and collect values separately. This is both a correctness and a security pattern.

### Pattern: error recovery via synchronisation tokens

After a parse error, skip tokens until a known boundary (`;`, newline, `}`), then resume. Collect errors in a list; report them all at the end.

---

## Best Practices

- **Pick the parser style deliberately.** Map it to the grammar's shape (see the rule in Core Concepts), not to whatever you used last.
- **Keep an explicit grammar.** Even hand-written parsers benefit from a written EBNF in comments or docs — it is the spec the code must match.
- **Make the AST back-end-agnostic.** No SQL strings or evaluation logic inside parse functions. The AST should not know whether it will be interpreted or transpiled.
- **Report line and column on every error.** Carry positions on tokens from the lexer onward; you cannot reconstruct them later.
- **Prefer transpiling onto a mature engine when semantics fit.** A DSL that compiles to SQL inherits the planner, indexes, and optimiser. Do not reinvent a query engine.
- **Version your grammar from day one.** Even a `# dsl-version: 1` header lets you evolve syntax without breaking old files. (Versioning gets serious at senior level.)
- **Test at the boundaries between stages.** Snapshot the token list and the AST, not just final outputs. A wrong AST that happens to evaluate right will bite you when you add a back end.
- **Resist feature creep.** Each new keyword is permanent grammar, parser code, docs, and tooling. "Just add loops to the config language" is how a config format becomes an accidental programming language.

---

## Edge Cases & Pitfalls

- **Left recursion in combinators and naive recursive descent.** A rule like `expr := expr '+' term` calls itself with no progress and loops forever. Rewrite to iteration (`term ('+' term)*`) or use Pratt.
- **Operator associativity bugs.** `8 - 3 - 2` must be `3`, not `7`. Right-associate by accident and your arithmetic is silently wrong. Pratt's `bp` vs `bp+1` choice is exactly this.
- **Greedy vs longest-match lexing.** Adding `==` while the lexer reads one char at a time makes it see two `=` tokens. The lexer must look ahead for multi-character operators (`==`, `<=`, `->`).
- **String concatenation into SQL/HTML when transpiling.** The injection trap. Always parameterise (SQL) or escape (HTML). A transpiler that builds output by `+`-ing user text is a vulnerability factory.
- **One-error-then-die parsing.** Users hate fixing errors one run at a time. Add synchronisation-based recovery so you can report several.
- **Environment mutation across scopes.** Sharing one mutable `env` dict between scopes leaks variables out of blocks. Copy or chain environments.
- **Forgetting to consume EOF.** `1 + 2 garbage` parses the `1 + 2` and silently ignores the rest unless you assert end-of-input.
- **Choosing ANTLR for a five-rule grammar.** The build step, generated code, and tool dependency are overkill for something a 100-line recursive-descent parser handles with better errors.
- **Choosing hand-written for a 300-rule grammar.** Conversely, hand-maintaining a huge grammar is error-prone; that is exactly where a generator earns its keep.

You now have the tools to build a *usable* external DSL: a parser chosen for the grammar, variables and scope, real error messages, and a back end that either interprets or transpiles. The `senior.md` level goes deeper on compiling DSLs (bytecode, LLVM, transpiling at scale), **sandboxing untrusted DSLs** (resource limits, no arbitrary code execution), grammar **versioning and evolution**, and building **tooling** (LSP, formatter, highlighting) for your language.
