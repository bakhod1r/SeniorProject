# DSLs in Practice — Interview Questions

> **Topic:** [DSLs in Practice](README.md)

---

## Introduction

These questions probe whether a candidate can design, build, and *operate* an **external** domain-specific language — one with its own grammar, lexer, parser, and evaluator or transpiler — rather than merely use SQL or regex. The strongest answers move fluidly between the implementation pipeline (grammar → lexer → parser → AST → interpret/compile), the engineering trade-offs (recursive descent vs Pratt vs parser combinators vs ANTLR; interpret vs transpile), and the operational realities that sink most homegrown languages (sandboxing untrusted input, versioning a grammar with users, and the total cost of tooling). A weak answer treats a DSL as "just parsing" and ignores security, evolution, and the years of maintenance that follow.

Throughout, keep the internal/external distinction crisp: an internal/embedded DSL borrows the host language's syntax and parser (covered by metaprogramming); an external DSL brings its own and must be lexed, parsed, and evaluated by code you write. These questions are about the external kind.

## Table of Contents

- [Conceptual / Foundational](#conceptual--foundational)
- [Tool-Specific](#tool-specific)
  - [ANTLR](#antlr)
  - [Lex / Yacc](#lex--yacc)
  - [Parser Combinators](#parser-combinators)
  - [Regex](#regex)
  - [Query Languages](#query-languages)
- [Tricky / Trap Questions](#tricky--trap-questions)
- [Design Scenarios](#design-scenarios)

---

## Conceptual / Foundational

### Question 1

**What is the difference between an internal and an external DSL, and what do you give up by choosing external?**

An internal (embedded) DSL is expressed in the host language's own syntax — method chains, builders, operator overloading — so it is parsed by the host's parser and produces host-language errors. An external DSL has its own syntax stored in its own text/files; you must write the lexer, parser, and evaluator/transpiler yourself. Choosing external buys full syntactic freedom (any keywords and operators you want), domain-specific error messages, dedicated tooling, and — crucially — a *controllable* evaluation model you can sandbox, since every operation the language can perform is one you implemented. The cost is that you build and maintain the entire front end and tooling from scratch, forever: lexer, parser, error reporting, formatter, highlighting, often a language server, plus grammar versioning and migration. The trade is "freedom and safety guarantees" against "you now own a language."

### Question 2

**Walk me through the pipeline for implementing an external DSL.**

Design the grammar (which token sequences are valid programs). Then: a **lexer** turns source text into tokens; a **parser** turns tokens into an AST while enforcing the grammar and reporting errors; the AST is the contract between front end and back end. From the AST you either **interpret** it (tree-walk to produce a result or effect now), **compile** it (to bytecode for a small VM, or to native via LLVM), or **transpile** it (to another high-level language such as SQL, JavaScript, or host source). The same front end can feed an interpreter, a transpiler, and a linter — which is why you keep parsing strictly separate from evaluation.

### Question 3

**Name several external DSLs you use and classify them.**

Query: SQL, GraphQL. Pattern matching: regular expressions, glob patterns. Styling/markup: CSS, HTML, Markdown. Build/automation: Make, the shell, CI pipeline configs. Configuration: HCL/Terraform, Dhall, Jsonnet, CUE, `nginx.conf`. Schema: Protobuf `.proto`, JSON Schema. Calculation: spreadsheet formulas. Each is external — its text is not valid in any general-purpose language; something lexes and parses it. A good answer notes that several (Dhall, CUE) are deliberately *total* (non-Turing-complete) so untrusted config provably halts.

### Question 4

**When should you interpret a DSL versus compile or transpile it?**

Interpret (tree-walk) when simplicity and fast iteration matter and the program runs occasionally — config evaluation, one-shot rule checks, a REPL. Compile to bytecode when the same program runs many times and tree-walking is the bottleneck — a rules engine evaluating millions of events. Transpile to another language when its semantics map onto a mature engine you'd rather reuse: a filter DSL → SQL (inherit the query planner and indexes), a template language → HTML, a reactive DSL → JavaScript. Transpiling to native via LLVM is reserved for compute-heavy DSLs at scale. The default is "interpret first; compile or transpile only when measured need or a clear engine-reuse win justifies it."

### Question 5

**What is the "little languages" philosophy?**

Jon Bentley's idea (and the Unix tradition) that a small, focused language often beats a pile of flags or a sprawling config: `awk`, `sed`, `make`, `dc`, `find`'s expression syntax. Each does one domain extremely well and composes with others. The lesson for DSL design is to keep the language small and sharply scoped rather than letting it grow toward general-purpose programming.

### Question 6

**Why are error messages considered a first-class feature of a DSL?**

A DSL's users debug through its error messages; a language that reports only "syntax error" with no position is one nobody can use productively. The minimum bar is line, column, the unexpected token, and what was expected; better is showing the source line with a caret, and recovering at synchronisation points (newline, `;`, `}`) to report multiple errors per run. Error quality is a major reason production language front ends are hand-written (recursive descent / Pratt) rather than generated — you get full control over the message and the recovery.

### Question 7

**What is the difference between a lexer and a parser, and why separate them?**

The lexer groups characters into tokens (numbers, keywords, operators) and knows nothing about structure or precedence; the parser arranges tokens into an AST according to the grammar and enforces validity. Separation makes each independently testable — most "parser bugs" are actually lexer bugs — keeps concerns clean, and lets you swap one without the other. It also mirrors how generators split the work (Lex for the lexer, Yacc for the parser).

---

## Tool-Specific

### ANTLR

### Question 8

**What does ANTLR generate from a grammar, and why is it a popular choice for external DSLs?**

From a `.g4` grammar file ANTLR generates a lexer, a parser, and walker scaffolding (a **listener** and/or **visitor**) in your target language (Java, Python, Go, C#, JavaScript, and more). You then write a visitor with one method per rule to build an AST or evaluate. It is popular because the grammar is a single, readable source of truth that doubles as documentation, it scales to large grammars, and one grammar can generate parsers for many host languages. ANTLR uses an adaptive LL(*) parsing strategy, so it handles grammars that older LL tools could not.

### Question 9

**What are ANTLR's weaknesses compared with a hand-written parser?**

Default error messages are generic; producing great errors requires custom error-handling strategies. You accept a build step and a runtime dependency, and you have less control over error recovery and incremental parsing (which matters for a language server). For a small grammar the generated machinery and tool dependency are overkill versus a 100-line recursive-descent parser. This is why mainstream compilers (Go, Clang, `rustc`, TypeScript) hand-write their front ends despite ANTLR's convenience.

### Question 10

**Listener vs visitor in ANTLR — when do you use each?**

A listener is push-based: ANTLR walks the parse tree and calls your enter/exit callbacks automatically; you don't control traversal, which suits straightforward, stateless processing. A visitor is pull-based: you call `visit` on children explicitly and return values up, which gives you control over order and lets you compute and propagate results — better for building an AST or evaluating expressions where you need return values and conditional traversal.

### Lex / Yacc

### Question 11

**What do Lex and Yacc do, and how do they divide the work?**

Lex (and GNU **Flex**) generates a lexer from a set of regular-expression rules, each mapped to an action that returns a token. Yacc (**Yet Another Compiler-Compiler**; GNU **Bison**) generates a bottom-up **LR** parser from a grammar with embedded semantic actions. The classic pipeline: Lex tokenizes, Yacc parses and runs actions to build the AST or evaluate. They are the traditional C toolchain for building languages; Lex feeds tokens to the Yacc-generated parser.

### Question 12

**Why does Yacc produce shift/reduce conflicts, and how do you resolve them?**

Yacc builds an LR parser as a state machine; a shift/reduce conflict means that in some state the parser cannot decide whether to shift the next token or reduce by a rule (the classic example is the dangling `else`). You resolve conflicts by rewriting the grammar to be unambiguous, or by declaring operator precedence and associativity (`%left`, `%right`, `%nonassoc`) so Yacc has a rule to break the tie. Yacc defaults to shifting on shift/reduce conflicts, but relying on the default silently is a code smell; you should understand and document each conflict.

### Question 13

**LL vs LR parsing — what's the practical difference for a DSL author?**

LL parsers are top-down and predictive: they decide which rule to use from the next token(s), which maps naturally onto hand-written recursive descent and produces easy-to-follow code and good errors, but they cannot handle left recursion directly. LR parsers are bottom-up: they shift tokens onto a stack and reduce by rules, accepting a larger class of grammars (including left recursion) but producing parsers that are harder to write by hand and to debug (hence generators like Yacc). Practically: hand-written DSL front ends are LL/recursive-descent (often with Pratt for expressions); generator-built ones are frequently LR (Yacc/Bison) or adaptive LL (ANTLR).

### Parser Combinators

### Question 14

**What is a parser combinator, and name some libraries.**

A parser is modeled as a function from input to a result plus the remaining input (or a failure). Small primitive parsers (`number`, `keyword("SELECT")`) are combined with higher-order combinators — `seq`, `or`/`alt`, `many`, `sepBy`, `optional` — to build bigger parsers that read almost exactly like the grammar, in ordinary code with no separate build step. Libraries: **parsec** (Haskell), **nom** (Rust), **FParsec** (F#), with ports in many languages. They shine for small-to-medium DSLs and config formats.

### Question 15

**What are the downsides of parser combinators?**

Error messages and error positions require deliberate effort (naive combinators just say "no match"); left recursion does not work directly and must be rewritten to iteration; backtracking can be expensive and can cause exponential blowup if uncontrolled, so libraries expose commit/cut operators you must use carefully; and the runtime indirection of many small function calls can be slower than a tuned hand-written parser. They trade peak performance and error control for composability and readability.

### Regex

### Question 16

**Is a regular expression engine a DSL implementation? What is it under the hood?**

Yes — regex is a classic external DSL: a pattern language with its own syntax, compiled and executed by an engine. Classically a regex is compiled to a nondeterministic finite automaton (NFA), often converted to a DFA, giving linear-time matching in the input length. Many production engines (PCRE, and the regex engines in Perl/Python/Java) instead use backtracking to support non-regular features (backreferences, lookaround), which is more expressive but can blow up to exponential time on adversarial inputs — the basis of ReDoS attacks. RE2 and Go's `regexp` deliberately restrict the language to what an automaton can match in linear time, trading features for guaranteed performance.

### Question 17

**Why can a regex DSL be a denial-of-service risk, and how do you mitigate it?**

Backtracking engines can take exponential time on patterns like `(a+)+$` against a long non-matching string — catastrophic backtracking, or ReDoS. Mitigations: use an automaton-based engine without backtracking (RE2, Go's `regexp`); impose timeouts or input-length limits; avoid nested quantifiers and ambiguous alternation in patterns; and never compile *user-supplied* patterns in a backtracking engine without sandboxing. This is the same untrusted-DSL problem that any external DSL faces: evaluating attacker-controlled language input requires resource limits.

### Query Languages

### Question 18

**How would you safely transpile a user-facing filter DSL to SQL?**

Parse the DSL to an AST, then emit SQL from the AST with two safeguards: an **allow-list** of referenceable fields/columns (the DSL cannot name arbitrary columns or tables) and **parameterised values** — emit placeholders (`?`/`$1`) and bind user values separately so they never enter the SQL string. Never build SQL by concatenating user text; that is SQL injection. Optionally validate operators and types during emission. This reuses the database's planner and indexes while keeping the surface safe.

### Question 19

**Why is SQL described as a declarative DSL, and what does that buy implementers?**

SQL says *what* result you want, not *how* to compute it; the engine's optimiser chooses the execution plan (join order, index use, parallelism). For a DSL author this is the model to emulate when transpiling to SQL: by mapping your DSL onto SQL you inherit decades of query optimisation for free, instead of writing your own execution engine. The declarative nature also makes the language easier to reason about and to sandbox, since users describe intent rather than imperative steps.

---

## Tricky / Trap Questions

### Question 20

**"It's just a config file, so it can't be a security risk." True or false?**

False, and dangerously so. Many config formats grew into Turing-complete languages (variables, conditionals, loops, even function calls), at which point evaluating an untrusted config can loop forever, exhaust memory, or — if the implementation maps the DSL onto host `eval` or exposes host functions — execute arbitrary code. Even a "simple" template or expression in config is an attack surface. The fix is to keep the language total (no unbounded loops/recursion), allow-list capabilities, and impose resource limits — exactly the sandboxing an external DSL needs.

### Question 21

**A candidate says "I'll just use the host language's `eval()` to run my DSL." What's wrong?**

Implementing a DSL by translating it to host-language `eval()` discards the entire safety advantage of an external DSL: it exposes the full host language and standard library, so any "DSL" input can run arbitrary host code, read files, make network calls, and crash or compromise the process. It also couples your DSL's semantics to the host's quirks and makes good error messages impossible. The correct approach is a real evaluator whose operations are exactly the ones you implemented, with no path to host code.

### Question 22

**Your recursive-descent grammar has the rule `expr := expr '+' term`. What happens?**

Infinite recursion: `expr` calls itself as its first action with no input consumed, so it never terminates (and never reaches the `+`). This is left recursion, which top-down/LL parsers (and naive combinators) cannot handle. Rewrite it as iteration — `expr := term ('+' term)*` — or use a Pratt parser, which handles left-associative operators via binding power without left-recursive rules. (LR parsers, by contrast, accept left recursion directly.)

### Question 23

**Two threads... no. Trick: "Adding loops to my config language is a small feature." Agree?**

No — it is one of the most consequential changes you can make. Adding unbounded loops (or recursion) makes the language Turing-complete: it can no longer be guaranteed to halt, so it cannot be safely evaluated on untrusted input without a step/time budget, and it becomes harder to analyse, format, and tool. The "small feature" is the threshold between a safe, total config language and an accidental programming language. If users need real iteration, prefer exposing reviewed host functions or embedding a sandboxable language (CEL, Starlark) rather than growing the config format.

### Question 24

**Your DSL transpiles to SQL and a customer reports they can read other tenants' data. What likely went wrong?**

Most likely the emission concatenated user input into the SQL string (injection) or failed to allow-list fields/tables, letting the DSL reference columns or join paths it shouldn't — or it omitted the tenant predicate the application layer assumed. Transpiling does not exempt you from injection defense: emit parameterised placeholders, allow-list every referenceable identifier, and enforce tenant scoping in the generated query rather than trusting the DSL author. The same string-concatenation hazard applies to transpiling to HTML (XSS) or shell.

### Question 25

**Is `i++`... no. Trap: "ANTLR gives me great error messages out of the box." Correct?**

No. ANTLR's default error messages are generic ("mismatched input ... expecting ...") and are usually not good enough for a user-facing language. Producing high-quality errors requires writing a custom `ANTLRErrorStrategy`/error listener and often custom recovery. Teams that need excellent errors either invest heavily in ANTLR's error customisation or hand-write the front end. Assuming good errors come for free is a common mistake.

---

## Design Scenarios

### Question 26

**Design a formula language for a spreadsheet-like product where end users type expressions. Walk through the major decisions.**

Scope it as a *total* language: arithmetic, comparisons, a fixed set of builtin functions (`SUM`, `IF`, `LOOKUP`), references to other cells — no unbounded loops, no recursion, no host access. Front end: a hand-written lexer plus a Pratt parser (rich operators, best error messages for non-programmer users). Back end: interpret for simplicity first; compile to bytecode if recalculation becomes hot. Security: every input is untrusted, so impose a step/fuel limit, a memory cap, recursion-depth limits on parsing, and an allow-list of builtins and reachable cells — there must be no node type that calls host code or does I/O. Tooling: as-you-type errors and function completion (a small language server), since end users live in this surface. Versioning: a version marker and an AST-to-source migrator so future syntax changes don't break saved sheets.

### Question 27

**A team wants to build a DSL for business rules ("when cart total > $50, free shipping"). When would you advise against building one, and what would you build instead?**

Advise against a bespoke language unless the domain genuinely needs syntax or semantics nothing existing provides *and* the team can fund the lifetime cost (LSP, formatter, docs, security review, migration, support, onboarding) for years. First try cheaper options: a config schema if the rules are structured data; a library/internal DSL if programmers compose them; and especially an embeddable sandboxed language like **CEL** (built precisely for safe expression evaluation), **Starlark**, or **Lua** if non-developers write logic over untrusted input. Those give external-DSL safety and power with a fraction of the total cost of ownership. Reserve a bespoke external DSL for the rare case where it is a genuine product differentiator.

### Question 28

**You must choose between ANTLR and a hand-written parser for a new external DSL that will live for years. How do you decide?**

Weigh grammar size and stability, error-quality requirements, target languages, and team expertise. Choose ANTLR when the grammar is large and formal, you want it as a single source of truth, you must generate parsers for multiple host languages, and default-ish errors are acceptable (or you'll invest in custom error strategies). Choose hand-written (recursive descent + Pratt) when error messages are central to the user experience, you want no build/runtime dependency, you need incremental parsing for a language server, and you have the expertise to maintain a parser. A common pragmatic path: prototype with ANTLR to validate the grammar, then reimplement by hand once stable if error quality or LSP needs demand it.

### Question 29

**Your external DSL has thousands of files written by customers and you need to change the syntax. How do you do it without breaking them?**

Treat the grammar as an API. Prefer additive, backward-compatible changes; for breaking ones, introduce a version marker so old and new files parse under their own grammar in parallel, deprecate the old syntax with positioned warnings before removing it, and — because you own the parser and an AST-to-source printer — ship a mechanical migrator that parses v1, transforms the AST, and emits v2, upgrading customer files automatically. Guard the whole effort with a conformance corpus of real files and expected results run in CI so changes can't silently alter semantics.

### Question 30

**Design the sandbox for a multi-tenant system where each tenant uploads rules in your DSL, evaluated on every request.**

Make the evaluator a hard trust boundary. Allow-list the exact fields and builtins each rule may use (no ambient authority: no file, network, process, or env access). Bound execution with a deterministic step/fuel counter (primary) and a wall-clock deadline (backstop), and cap memory, collection sizes, string lengths, and parse-time nesting depth to prevent OOM and stack exhaustion. Keep the language total — no unbounded loops or recursion — so halting is guaranteed by construction. Ensure tenant isolation in whatever the rules can reference (a rule can only see its tenant's data). Compile rules to bytecode for per-request speed, carrying the fuel check in the VM loop. The security argument should be *enumerable*: list every opcode/builtin and confirm none reaches host code.
