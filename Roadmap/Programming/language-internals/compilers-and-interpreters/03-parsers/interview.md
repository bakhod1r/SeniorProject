# Parsers — Interview Level

> **Topic:** [Parsers](README.md)
> **Focus:** Interview questions on parsing — conceptual foundations, the specific tools and techniques (recursive descent, yacc/bison LALR, ANTLR LL(*), PEG, hand-written), tricky traps, and parser design decisions.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Conceptual Questions](#conceptual-questions)
3. [Tool-Specific Questions](#tool-specific-questions)
4. [Tricky-Trap Questions](#tricky-trap-questions)
5. [Design Questions](#design-questions)
6. [Summary](#summary)

---

## Introduction

This page is a question bank for parsing interviews, from junior screens to senior/staff compiler-engineering rounds. Questions are grouped so you can drill the area you're weak in: **Conceptual** (the theory — grammars, LL/LR, FIRST/FOLLOW, ambiguity), **Tool-Specific** (recursive descent, yacc/bison LALR, ANTLR LL(*), PEG, hand-written parsers), **Tricky-Trap** (the questions that catch people who memorized definitions), and **Design** (open-ended "how would you build it?" rounds). Each question includes a complete answer; treat the answer as the *floor* of what a strong candidate says, not a script — the best answers connect ideas across groups.

---

## Conceptual Questions

## Question 1

**What is the difference between a parser and a lexer, and why are they usually separate?**

The **lexer** (scanner/tokenizer) turns a character stream into a stream of **tokens** — it groups characters into meaningful units (`123` → NUMBER, `while` → keyword, `+` → operator) and discards or attaches trivia (whitespace, comments). The **parser** takes that token stream and builds a **tree** according to the grammar, checking that the tokens form valid syntactic structure. They're separated because they operate at different levels (regular languages for lexing, context-free for parsing), and the split keeps each simpler: the lexer handles the messy character-level details so the parser can reason in clean tokens. The classic exception is C/C++, where the separation leaks (the typedef hack) and the parser must feed context back to the lexer.

## Question 2

**Explain the difference between top-down (LL) and bottom-up (LR) parsing.**

**Top-down (LL)** builds the parse tree from the root down, **predicting** which production to use from lookahead before parsing the contents; it produces a leftmost derivation, and recursive descent is the hand-written form. **Bottom-up (LR)** builds from the leaves up, **recognizing** a completed production (a handle) on a stack only after seeing all of it; it produces a rightmost derivation in reverse, and shift-reduce (yacc/bison) is the engine. The one-sentence distinction: **LL decides what it's building before seeing it; LR decides what it built after seeing it.** That's why LR handles a strictly larger grammar class (including left recursion) but LL is easier to hand-write with great errors.

## Question 3

**What are FIRST and FOLLOW sets, and what are they used for?**

**FIRST(α)** is the set of terminals that can *begin* a string derived from α. **FOLLOW(A)** is the set of terminals that can appear *immediately after* nonterminal A in some derivation. A predictive top-down parser uses them to decide, at each nonterminal, which production to pick from the next token: it picks the production whose FIRST set contains the lookahead. FOLLOW is needed for **nullable** productions (those that can derive ε) — to know when to stop, you look at what can follow the nonterminal. A grammar is **LL(1)** exactly when, for each nonterminal, the productions' FIRST sets are disjoint (and FIRST/FOLLOW don't overlap for nullable rules).

## Question 4

**Why does left recursion break a recursive-descent parser, and how do you fix it?**

A rule like `E → E + T` makes `parseE()` call `parseE()` as its very first action with no token consumed — infinite recursion, stack overflow, because the parser must "finish parsing E" before consuming anything. You fix it with **left-recursion elimination**: rewrite `E → E + T | T` into `E → T E'`, `E' → + T E' | ε`, which you implement in code as a **loop** (parse one `T`, then `while next is +`). LR parsers need no such fix — they handle left recursion natively because they recognize the rule bottom-up only after seeing the whole thing.

## Question 5

**What is an ambiguous grammar? Give the canonical example.**

An **ambiguous grammar** is one where some input string has more than one valid parse tree (or leftmost derivation). The canonical example is the **dangling else**: with `S → if E then S | if E then S else S`, the input `if a then if b then c else d` can attach `else` to either the inner or outer `if` — two valid trees. The other classic is a flat expression grammar `E → E + E | E * E | id`, where `id + id * id` has two trees (different precedence). You fix ambiguity by restructuring the grammar (precedence layering, matched/unmatched statements) or, in a generator, with precedence declarations.

## Question 6

**What is the LR power ladder, and where does LALR(1) sit?**

From weakest to strongest standard bottom-up parser: **LR(0) < SLR < LALR(1) < LR(1)**. They differ in how much lookahead information their states carry, which controls how many conflicts they avoid. **LR(0)** uses no lookahead in reduce decisions (conflicts on almost any real grammar). **SLR** uses FOLLOW sets. **LALR(1)** merges LR(1) states with identical cores — it's the **yacc/bison sweet spot**: handles essentially all practical programming-language grammars with compact tables, at the price of occasional spurious reduce-reduce conflicts from merging. **LR(1)** is the most powerful but has much larger tables.

## Question 7

**What is a shift-reduce conflict versus a reduce-reduce conflict?**

A **shift-reduce conflict** occurs when, in some parser state, the parser could either shift the next token or reduce a completed rule, and the grammar doesn't determine which — the dangling-else is the textbook case. Tools default to **shift** (binding `else` to the nearest `if`), which is usually what you want. A **reduce-reduce conflict** occurs when the parser could reduce by two *different* productions; this almost always signals a genuine grammar bug or an over-merged LALR state and is fixed by restructuring the grammar. Shift-reduce has a sane default; reduce-reduce usually does not and should be treated as an error.

## Question 8

**What is the difference between a parse tree (CST) and an abstract syntax tree (AST)?**

A **parse tree** / **concrete syntax tree (CST)** mirrors the grammar exactly — it contains every token, every parenthesis, every intermediate nonterminal, and (in full-fidelity form) all trivia. An **AST** is a distilled, semantics-only tree that drops redundant syntax: `(1 + 2)` and `1 + 2` produce the same AST node, the parens vanish, intermediate nonterminals collapse. Compilers usually work on the AST; IDEs, formatters, and refactoring tools need the CST because they must reproduce or transform the exact source, including trivia. A modern front end often keeps a full-fidelity CST and derives the AST from it.

## Question 9

**What is Pratt parsing and why is it popular?**

**Pratt parsing** (precedence climbing) is a top-down expression-parsing technique driven by per-operator **binding powers** (numeric precedences; higher binds tighter). One function parses a leading operand (the **nud** — null denotation: literal, prefix op, paren) then loops, absorbing infix operators (the **led** — left denotation) while their binding power exceeds a `min_bp` threshold, recursing with the operator's right binding power. It's popular because a *single* compact function handles any number of precedence levels and both associativities (left-assoc recurses with `bp+1`, right-assoc with `bp-1`), replacing the verbose one-function-per-precedence-level approach. That's why production compilers pair recursive descent for statements with Pratt for expressions.

## Question 10

**Why does LR handle a larger class of grammars than LL?**

Because LR commits to a production only *after* seeing its entire right-hand side, while LL must commit *before*. LL must predict the rule from lookahead before parsing the contents, so it can't handle left recursion (would loop forever) and needs FIRST sets disjoint enough to predict. LR shifts tokens onto a stack and reduces only when a complete handle is unmistakably present, so it tolerates left recursion and constructs where you can't tell which rule applies until the end. Formally, every LL(k) grammar is LR(k), but not vice versa — LR strictly dominates.

---

## Tool-Specific Questions

## Question 11

**Why do most production compilers hand-write a recursive-descent parser instead of using a generator?**

GCC (which switched *away* from bison for C++), Clang, rustc, Go, V8, TypeScript, and Roslyn all hand-write recursive descent. The reasons are operational, not theoretical: (1) **error messages** — a hand-written parser knows exactly where it is and what it expected, so it produces human-meaningful diagnostics, while an LALR table fails in an automaton state that doesn't map to "I was parsing a for-loop header"; (2) **error recovery control** — construct-specific recovery is easy by hand, coarse in a generator; (3) **lexer feedback** — C/C++ require the parser to inform the lexer (typedef hack), natural by hand; (4) **context-sensitivity** — contextual keywords and the offside rule are a simple `if`; (5) **no generated-code debugging** and full performance/incrementality control. The cost is more code with no machine check against a grammar — accepted because diagnostics and control win for a flagship compiler.

## Question 12

**How do you resolve a shift-reduce conflict in a bison grammar without rewriting it?**

Use **precedence and associativity declarations**: `%left '+' '-'`, `%left '*' '/'`, `%right '^'`. These let you keep the *natural* ambiguous expression grammar (`expr : expr '+' expr | ...`) and still get a deterministic parser, because the declarations encode precedence and associativity directly into the shift/reduce table — `*` listed later binds tighter than `+`. For the dangling else, bison's default (shift) already binds `else` to the nearest `if`; you can rely on it (and comment that you did) or assign precedence to `THEN`/`ELSE` to make the resolution explicit. Reduce-reduce conflicts, by contrast, usually need a grammar restructure, not a declaration.

## Question 13

**What does ANTLR's LL(*) parsing give you over plain LL(1)?**

ANTLR uses **LL(*)** (and later **ALL(*)** — adaptive LL(\*)), which performs **arbitrary lookahead** to choose a production rather than being limited to k tokens. Where LL(1) needs FIRST sets disjoint at one token and LL(k) at k tokens, ALL(*) can look as far ahead as needed (effectively running the alternatives speculatively at parse time) to pick the right alternative, which makes many natural grammars parseable without left-factoring. ANTLR also handles **direct left recursion** by rewriting it internally, generates parsers in many target languages (Java, C#, Python, Go, JS, C++) from one `.g4` grammar, and builds parse trees with listener/visitor APIs — which is why it's popular for tooling that must run everywhere.

## Question 14

**What is a PEG, and how does its ordered choice differ from CFG alternation?**

A **Parsing Expression Grammar (PEG)** looks like a CFG but is a *recognition* formalism with **ordered choice** (`/`). In a CFG, `A | B` is symmetric — both alternatives are in the language and a parser may consider both. In a PEG, `A / B` means "try `A`; *only if* `A` fails, try `B`," and the first success **commits** — the parser never reconsiders. Consequences: PEGs are **unambiguous by construction** (exactly one parse), they never have shift-reduce conflicts (no nondeterminism), and they can express some non-context-free languages via syntactic predicates (`&`, `!`). The cost is the prefix-capture trap and generally weak error messages.

## Question 15

**What is packrat parsing, and what does it trade?**

**Packrat** is a PEG parsing strategy that **memoizes** the result of every rule at every input position, so each (rule, position) pair is computed at most once. This guarantees **linear time** even though PEGs allow unlimited lookahead and backtracking — without memoization a PEG could be exponential. The trade is **memory**: the memo table is proportional to input length × number of rules, which can be large on big inputs, so many production "PEG" parsers memoize selectively rather than fully. The linear-time guarantee is also a *security* property — it prevents catastrophic-backtracking denial-of-service.

## Question 16

**When would you choose a parser generator over a hand-written parser?**

Choose a generator when the grammar is **large, formally specified, and stable** — SQL is the canonical case (PostgreSQL's parser is bison-generated; a 500-production standardized grammar should be machine-checked, not hand-coded); when you want the **grammar to be the machine-checked source of truth** (a conflict report objectively tells you the grammar is ambiguous, which a hand-written parser silently papers over); when it's a **quick internal DSL** where great errors don't matter; or when you need a parser in **many host languages** (ANTLR). The trade-off framed honestly: generators optimize for grammar-as-spec and authoring speed; hand-written optimizes for diagnostics, recovery, and control. Compilers pick control; databases pick spec-fidelity.

## Question 17

**How does yacc/bison build its parser, at a high level?**

bison takes a context-free grammar (`.y` file) and constructs an **LALR(1) parser**: it builds the LR(0) automaton (states are sets of "items" — productions with a dot marking progress), computes lookahead sets, and merges LR(1) states with identical cores to keep tables compact. The output is a pair of tables (ACTION: shift/reduce/accept/error per state and token; GOTO: state transitions on nonterminals) plus a driver that runs the stack machine. Each grammar rule can carry a **semantic action** (`{ $$ = mkbin($1,$3); }`) executed on reduce, which is how the AST is built. Conflicts in table construction are reported as shift-reduce or reduce-reduce warnings.

## Question 18

**In a hand-written parser, how do you typically structure expression vs statement parsing?**

The production standard is a **hybrid**: **recursive descent for statements**, **Pratt parsing for expressions**. Statements have clear keyword prefixes (`if`, `while`, `return`) that make top-down prediction trivial — one function per statement form. Expressions have many precedence levels and associativities, which is exactly where one-function-per-level recursive descent gets verbose, so Pratt's binding-power loop collapses it into one elegant function. Every major hand-written compiler (Clang, rustc, Go, V8) uses this split because each technique is applied where it's strongest.

---

## Tricky-Trap Questions

## Question 19

**In a PEG, the rule `keyword <- "if" / "ifx"` — what does it match on input `ifx`?**

It matches only `if`, leaving `x` unconsumed — and **never tries** `"ifx"`. This is the **prefix-capture trap**: ordered choice tries `"if"` first, it succeeds (matching the prefix), and PEG commits on first success, so the second alternative is dead code. A CFG's alternation would consider both and could match the longer one; PEG's commit-on-success will not. The fix is to **order longest-first** (`"ifx" / "if"`) or guard with a not-predicate (`"if" !idchar`). This is the single most common PEG bug, and naming it confidently signals real PEG experience.

## Question 20

**A junior says "RWMutex... I mean, LR is always better than LL because it's more powerful — so why hand-write LL?" What's wrong with the reasoning?**

The flaw is conflating "more powerful" (handles a larger grammar class) with "better in practice." Grammar power is one axis; the axes that actually decide a production compiler are **error-message quality, recovery control, lexer feedback, context-sensitivity, and debuggability** — and on every one of those, hand-written LL (recursive descent) wins decisively, which is why GCC, Clang, rustc, Go, and V8 all chose it despite LR being theoretically stronger. "More powerful" answers "can it parse this grammar?"; it doesn't answer "will it give users good errors and survive a decade of maintenance?" The right framing is "what artifact should be authoritative — the grammar or the parser?", not "which is more powerful."

## Question 21

**Why was `vector<vector<int>>` historically a syntax error in C++, and how was it fixed?**

The `>>` lexed as a single **right-shift operator** token, not as two closing angle brackets, so the parser saw `vector < vector < int >>` and choked — requiring the programmer to write `vector<vector<int> >` with a space. The fix (C++11) was a special parser rule: in template-argument context, `>>` is **re-interpreted as two `>`**. It's a lexer-feedback case — the parser's grammatical context overrides the naive lexer's tokenization. The trap is thinking it's a lexer-only or parser-only problem; it's specifically the *interaction*, which is why C++ front ends can't cleanly separate the two phases.

## Question 22

**What is the "most vexing parse" in C++?**

Given `Widget w(Thing());`, the programmer usually intends "construct a `Widget` from a temporary `Thing`." But C++'s rule "if a construct *can* be interpreted as a declaration, it is" makes it a **function declaration**: `w` is a function returning `Widget` that takes a parameter which is a (pointer-to-)function returning `Thing`. The surface ambiguity is real and lives in the grammar; the standard resolves it by the declaration-preferring rule, and the programmer must use brace-initialization (`Widget w{Thing{}};`) to get the intended meaning. The trap is calling it a compiler bug — it's a deliberate grammar disambiguation rule that surprises everyone.

## Question 23

**Is `S → A B`, `A → a | ε`, `B → b` LL(1)? Justify.**

Yes. FIRST(A) = {a, ε}, FIRST(B) = {b}, FOLLOW(A) = FIRST(B) = {b}. For nonterminal `A` with productions `a` and `ε`, the LL(1) test is: FIRST(`a`) = {a} must be disjoint from FOLLOW(A) = {b} (since `A` can be nullable). {a} ∩ {b} = ∅, so they're disjoint — a single lookahead token (`a` → take `A → a`, `b` → take `A → ε`) deterministically picks the production. The trap is forgetting to bring **FOLLOW** into the test for the nullable production; checking only FIRST sets would miss the condition entirely.

## Question 24

**A recursive-descent JSON parser passes all tests but crashes in production on some inputs. What's the likely cause?**

A **stack-overflow denial-of-service** from deeply nested input: `[[[[[[[[...` or `{"a":{"a":{"a":...` thousands deep recurses (one stack frame per nesting level) until the native call stack overflows and the process crashes. It passes normal tests because test inputs aren't pathologically nested. The fix is a **recursion-depth limit** — count nesting and reject past a sane bound with a clean, reported error — or convert the recursion to an explicit heap-allocated stack. It's specifically a *security* issue because the parser is the first code to touch untrusted input, so a crash is a DoS vector. Many real JSON/config/query parsers have shipped exactly this bug.

## Question 25

**Why might a PEG silently give you the wrong precedence where a CFG would give a conflict warning?**

Because a PEG is **unambiguous by construction** via ordered choice, it never reports a conflict — it just *picks* whatever the rule ordering dictates. If you write the precedence rules in the wrong order, the PEG happily produces a parse with the wrong grouping and says nothing, whereas a bison grammar with the same ambiguity would emit a shift-reduce conflict warning that flags the problem. The trap is treating "no conflicts" as "no problems" — in a PEG, the absence of conflicts is by design and shifts the burden onto *you* to get the ordering right, with no tool to warn you when you don't.

---

## Design Questions

## Question 26

**Design a parser for a new general-purpose programming language whose primary tool is a great compiler and IDE. What technology and architecture do you choose?**

I'd **hand-write a recursive-descent parser with Pratt for expressions**, for the standard reasons every flagship compiler converged on it: best error messages, full recovery control, lexer feedback, and context-sensitivity. Crucially, because an IDE is in scope, I'd commit on day one to the **one-tree platform**: an **error-tolerant** parser (never aborts — inserts error/missing nodes so a tree always exists), **incremental** (re-parse only the edited span and splice into the old tree), producing a **full-fidelity CST** with trivia, stored in an **immutable** tree (red-green style) so it's sharable across the compiler, language server, and formatter. The AST is a view derived from the CST. I'd bound recursion depth for security, fuzz the parser continuously, and treat the syntax-tree shape as a versioned public API since analyzers will depend on it. The key point: deciding "compiler + IDE platform" up front avoids the front-end rewrite that an AST-only design forces later.

## Question 27

**Design the error-recovery strategy for that parser. What do you do when input is wrong?**

Since input is wrong most of the time during editing, the parser must **never abort** and must report many errors per run. I'd use **panic-mode recovery** with **per-construct synchronization sets**: on an error, skip tokens until a construct-appropriate boundary — `;`/`}` inside a block, `,`/`)` inside an argument list, a leading keyword at top level — then resume. `expect()` records a diagnostic and returns a **MISSING/error node** rather than throwing, keeping the tree complete. I'd add **error productions** for the highest-frequency mistakes (e.g. `=` where `==` was meant) to give precise, actionable messages with source carets. Critically, I'd include a **forced-progress guard** (`if pos == mark: advance()`) so recovery can never infinite-loop on a token it can neither parse nor skip. Diagnostics quality is a first-class feature, so I'd budget real engineering time here.

## Question 28

**You're parsing a configuration/protocol DSL that must be embedded and composed. Generator, hand-written, or PEG — and why?**

I'd lean **PEG** here. Config/protocol grammars benefit from PEG's **unambiguity by construction** (no conflicts to reason about), its clean **composability** (combining sub-grammars is natural), and **packrat's linear time** — which doubles as a **security** guarantee against catastrophic backtracking on untrusted protocol input. The accepted costs are weaker error messages (manageable for config, where inputs are small) and the prefix-capture trap (which I'd defend against by ordering alternatives longest-first and using not-predicates). If the DSL grew to need excellent diagnostics or heavy context-sensitivity I'd reconsider hand-written; if it were a huge standardized grammar I'd reconsider a generator. But for an embeddable, composable, untrusted-input config language, PEG/packrat fits best.

## Question 29

**How would you evolve a mature language's grammar to add a new feature without breaking existing code?**

The cardinal rule is **backward compatibility**: existing programs must keep parsing. So I'd add new syntax with a **contextual (soft) keyword** rather than a reserved word — a word that's a keyword only in a specific grammatical position and a legal identifier everywhere else (like `async`, `record`, or Python's `match`/`case`). The parser disambiguates by position with bounded lookahead, so code that already uses the word as a variable name still works. Adding a *reserved* keyword is nearly forbidden because it breaks every program using that word as an identifier. New operators with new tokens (Python's walrus `:=`) are another compatibility-safe path. I'd also weigh the permanent cost — every syntactic addition taxes readers, tools, and the parser forever — so I'd add it only if the value clearly justifies that lifelong tax, treating the syntax-tree change as a versioned API change that downstream analyzers must be migrated against.

## Question 30

**A team has two parsers for one language — one in the compiler, one in the IDE — and users report cases where the compiler and editor disagree. How do you diagnose and fix this?**

This is the classic **two-parser drift / parser differential**. Diagnosis: run **differential testing** — feed the same corpus (and fuzzer-generated inputs) to both parsers and flag every disagreement; each divergence is a candidate for a user-visible "compiles but IDE shows an error" bug. The disagreements cluster around edge cases: contextual keywords, recovery behavior, recently-added syntax. The structural fix is to move toward **one authoritative parser/tree** (the Roslyn one-tree model) that both the compiler and the language server consume, eliminating the divergence at the source — this is also a *security* improvement, since parser differentials enable input-smuggling attacks. If a full merge isn't feasible short-term (the rustc/rust-analyzer situation), I'd at least make differential testing a CI gate so divergences are caught immediately and treated as bugs, and invest continuously in shrinking the gap. The lesson for next time: decide the one-tree architecture before writing the second parser.

---

## Summary

- **Conceptual core:** lexer (chars→tokens) vs parser (tokens→tree); LL **predicts** top-down, LR **recognizes** bottom-up; FIRST/FOLLOW drive LL prediction; left recursion breaks LL (fix by rewrite-to-loop) but not LR; ambiguity (dangling else, flat expression grammars) is fixed by grammar restructure or precedence; the LR ladder is LR(0) < SLR < LALR(1) < LR(1) with LALR(1) the yacc/bison sweet spot; CST keeps everything, AST is semantics-only; Pratt parsing handles expressions with binding powers.
- **Tools:** production compilers **hand-write recursive descent + Pratt** for error messages, recovery, lexer feedback, and context-sensitivity; **bison** builds LALR(1) tables and resolves conflicts via `%left`/`%right` precedence declarations; **ANTLR** uses LL(*)/ALL(*) adaptive lookahead and generates many target languages; **PEG** uses ordered choice (unambiguous, no conflicts) and **packrat** memoizes for linear time; generators win for big stable specs like SQL.
- **Traps:** PEG prefix capture (`"if" / "ifx"` never matches `ifx` — order longest-first); "more powerful" ≠ "better in practice"; C++ `>>` template lexing and the most-vexing-parse are lexer/parser-interaction problems; nullable LL(1) tests need FOLLOW; deeply-nested input is a stack-overflow DoS; a PEG's "no conflicts" silently shifts the precedence-ordering burden onto you.
- **Design:** for a flagship compiler+IDE, hand-write recursive descent + Pratt as a one-tree platform (error-tolerant, incremental, full-fidelity CST, immutable); recover with per-construct panic-mode sync plus error productions and a forced-progress guard; pick PEG for composable untrusted config DSLs; evolve grammars with contextual keywords to preserve backward compatibility; and eliminate two-parser drift by moving to one authoritative parser, gated by differential testing.

---
