# Symbolic Programming — Middle Level

> **Roadmap:** [Programming Paradigms](../README.md) → Symbolic Programming
> *Homoiconicity isn't a curiosity — it's the mechanism. Once code is data, `quote` lets you hold it, `eval` lets you run it, and **macros** let you transform it before it ever runs.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [S-Expressions, in Depth](#s-expressions-in-depth)
3. [The Read–Eval Cycle](#the-readeval-cycle)
4. [Quote and Eval — Holding and Running Code](#quote-and-eval--holding-and-running-code)
5. [Macros vs Functions](#macros-vs-functions)
6. [Building a Small DSL with a Macro](#building-a-small-dsl-with-a-macro)
7. [Term Rewriting — Pattern → Replacement](#term-rewriting--pattern--replacement)
8. [A CAS in Miniature: Symbolic Differentiation](#a-cas-in-miniature-symbolic-differentiation)
9. [Putting It Together](#putting-it-together)
10. [Common Mistakes](#common-mistakes)
11. [Summary](#summary)
12. [Further Reading](#further-reading)
13. [Related Topics](#related-topics)

---

## Introduction

> Focus: **How does it actually work, and how do I write it?**

At the junior level you saw the headline: code is data, expressions are trees you can transform, and a CAS differentiates `x²` to `2x` by rewriting. This level opens the machinery. We'll pin down **s-expressions** precisely, walk the **read–eval cycle** that turns text into structure into value, and use **quote** and **eval** deliberately. Then we'll reach the two capabilities that make symbolic programming powerful in practice:

1. **Macros** — programs that run at *compile time* and transform code-as-data into other code. This is how you extend the language itself, not just call into it.
2. **Term rewriting** — the pattern-match-and-replace engine that underlies both macros and computer algebra. We'll build a tiny symbolic differentiator from rewrite rules.

The throughline: everything here is *the same trick applied at different times*. Quote holds code as data; a macro transforms that data during compilation; a rewrite rule transforms expression-data during evaluation; a CAS is thousands of rewrite rules. One idea, many time-frames.

---

## S-Expressions, in Depth

An **s-expression** (symbolic expression) is either an **atom** (a number, string, or symbol) or a **list** of s-expressions written between parentheses. That's the entire grammar:

```
s-expr  ::=  atom  |  ( s-expr* )
atom    ::=  number | string | symbol
```

So `42`, `x`, `"hi"`, `()`, `(+ 1 2)`, and `(if (> x 0) (f x) (g x))` are all s-expressions. The evaluation rule is equally tiny: to evaluate a list `(f a b)`, evaluate `f` to get a function, evaluate `a` and `b` to get arguments, then apply. A few special forms (`quote`, `if`, `define`, `lambda`) don't follow that rule — they're the exceptions the evaluator knows about.

Two consequences fall out of this minimal design, and they're the whole reason Lisp is the canonical symbolic language:

- **Uniformity.** *Everything* — a function call, a definition, a conditional, an entire program — is the same shape: a nested list. There's no separate grammar for statements vs expressions vs declarations. One structure to inspect, one structure to build.
- **No gap between code and data.** Because the list `(+ 1 2)` is also valid *data* (a three-element list), any tool that processes lists can process code. Your program's source is reachable with `car`, `cdr`, `map`, and friends — the same functions you'd use on any list.

```scheme
(define program '(if (> x 0) "positive" "non-positive"))
(car program)         ; → if          the special form
(cadr program)        ; → (> x 0)     the condition (itself an s-expression)
(length program)      ; → 4           it's just a 4-element list
```

A language *without* this — Python, Java, C — also parses source into a tree (an AST), but that tree is hidden inside the compiler, written in a *different* structure than the language itself, and not handed to you as ordinary data. Homoiconicity is the choice to make the AST *be* the language's own list type, exposed.

---

## The Read–Eval Cycle

To use quote and eval well, you need the model of how a Lisp turns text into a value. It's a pipeline with a named stage you can intercept:

```
  text          READ            data            EVAL           value
  "(+ 1 2)"  ─────────►  list (+ 1 2)  ─────────►   3
             parse to               evaluate the
             s-expression           s-expression
```

- **READ** parses source *text* into an s-expression — a list structure. After READ, `"(+ 1 2)"` is the list `(+ 1 2)`. This is the moment "code" becomes "data."
- **EVAL** walks that list and produces a value. `(+ 1 2)` becomes `3`.

The pivotal insight: **between READ and EVAL, the program is data you could manipulate.** That gap is exactly where **macros** live — a macro is code that runs *after* READ but *before* (and producing input to) EVAL, transforming one s-expression into another. The REPL you may have used (Read-Eval-Print Loop) is just this pipeline plus a print and a loop.

Knowing the stages also disambiguates *when* things happen, which is the single most common source of confusion in this paradigm:

| Stage | What's happening | What it operates on |
|---|---|---|
| **Read** | text → s-expression | characters |
| **Macro-expand** | s-expression → s-expression | code as data |
| **Compile** | s-expression → executable | expanded code |
| **Eval / run** | executable → value | runtime values |

A function does its work at **run** time on values. A macro does its work at **macro-expand** time on code. That timing difference is the whole distinction, and we'll lean on it below.

---

## Quote and Eval — Holding and Running Code

**`quote`** suppresses evaluation: it hands you the s-expression as data instead of running it. The reader abbreviates `(quote x)` as `'x`.

```scheme
(+ 1 2)        ; → 3            evaluated
'(+ 1 2)       ; → (+ 1 2)      quoted: the literal list
(quote (+ 1 2)); → (+ 1 2)      identical — ' is just sugar for quote

'x             ; → x            the symbol x itself, not its value
```

**`eval`** is the inverse: it takes an s-expression *as data* and runs it, producing a value.

```scheme
(eval '(+ 1 2))          ; → 3
(define e (list '* 6 7)) ; build the list (* 6 7) with ordinary list ops
e                        ; → (* 6 7)
(eval e)                 ; → 42   run the code we constructed
```

Quote and eval are the two doors between the worlds: `quote` takes you from code to data, `eval` takes you from data back to a value. With them you can write a program that *builds* a program and runs it:

```scheme
;; Generate (+ 1 2 3 ... n) for any n, then evaluate it.
(define (sum-form n)
  (cons '+ (range 1 (+ n 1))))   ; build the list (+ 1 2 ... n)

(sum-form 4)        ; → (+ 1 2 3 4)
(eval (sum-form 4)) ; → 10
```

This works, but raw `eval` is a blunt tool — it runs at *runtime*, re-parses scope, and is a classic security and performance hazard when fed untrusted or hot-path input. The disciplined, compile-time version of "build code from code" is the **macro**, which is where this leads.

> **Rule of thumb:** if you find yourself reaching for `eval`, ask whether a **macro** does the same code-construction at compile time — usually safer, faster, and clearer.

---

## Macros vs Functions

This is the central distinction of the level. Both a function and a macro take arguments and produce a result. The difference is **when** they run and **what** they receive:

| | **Function** | **Macro** |
|---|---|---|
| Runs at | **run time** | **compile / macro-expand time** |
| Receives | the *values* of its arguments (already evaluated) | the *unevaluated code* of its arguments (as s-expressions) |
| Produces | a value | **new code** (an s-expression), which is then compiled |
| Can | compute results | **control evaluation** — reorder, skip, repeat, or wrap its arguments |

A function can't *not* evaluate its arguments — by the time the function body runs, the arguments are already values. A macro receives its arguments as *code*, so it can decide whether, when, and how many times to evaluate them. That's why control constructs (`if`, `and`, `while`, `unless`) must be macros (or built-in special forms): they need to *not evaluate* some branches.

A function that "implements `unless`" can't work:

```scheme
;; BROKEN as a function: both branches are evaluated before unless runs.
(define (my-unless-fn cond then) (if cond #f then))
(my-unless-fn #t (launch-missiles))   ; missiles launch anyway! `then` was evaluated.
```

A macro fixes it by transforming the *code*, deferring evaluation to where it belongs:

```scheme
;; Macro: transforms (my-unless C BODY) into (if C #f BODY) — BEFORE running.
(define-syntax my-unless
  (syntax-rules ()
    ((_ cond body) (if cond #f body))))

(my-unless #t (launch-missiles))   ; expands to (if #t #f (launch-missiles)) — no launch
```

The macro received `(launch-missiles)` as *unevaluated code*, planted it inside an `if` where it won't run, and handed the new code to the compiler. Read the slogan:

> **A function transforms values. A macro transforms code.** Macros are the reason a Lisp programmer can add new syntax — new *control flow*, new *binding forms*, entire *sublanguages* — without touching the compiler.

The cost of this power is real and we'll name it now (and dwell on it at the senior level): macros run at a different time than the surrounding code, they can capture or shadow names accidentally (**hygiene** problems), and code that freely rewrites itself is harder to read and debug. `syntax-rules` above is *hygienic* by design — it automatically renames introduced bindings so they can't clash with the caller's — which is precisely the safety net raw `eval`-based code generation lacks.

---

## Building a Small DSL with a Macro

The killer application of macros is **embedded domain-specific languages**: you make the host language *grow* a sublanguage tailored to a problem, with syntax that reads like the domain rather than like Lisp plumbing. Because a macro can transform arbitrary code, the DSL's surface syntax is yours to invent; it expands down to ordinary code.

A miniature example: a `with-logging` form that wraps any body in timing/logging, and a `cond`-like `match-first` that returns the first non-false branch.

```scheme
;; Wrap a body so it logs before and after, without the caller writing the plumbing.
(define-syntax with-logging
  (syntax-rules ()
    ((_ label body ...)
     (begin
       (printf "▶ ~a~n" label)
       (let ((result (begin body ...)))
         (printf "✓ ~a~n" label)
         result)))))

(with-logging "load-config"
  (read-file "config.edn")
  (parse-config ...))
;; expands to the begin/printf/let plumbing — the caller just states intent.
```

The `body ...` is *ellipsis* syntax: it captures zero or more forms and splices them back in. The caller writes domain-level intent (`with-logging "load-config" ...`); the macro mechanically generates the boilerplate (`begin`, `let`, the two `printf`s). This is the same idea behind real DSLs: `defroutes` in a web framework, `deftest` in a test library, a query DSL — each is a macro that expands a friendly surface form into the underlying calls. You've used such DSLs in other languages (Rails' routing block, RSpec's `describe`/`it`); in a homoiconic language *you* can build them with a few lines, because the surface syntax is just lists you rewrite.

> The DSL test: a good macro DSL lets the *reader* understand the code at the domain level and lets the *macro* handle the mechanical translation to host-language code. When the expansion gets hard to predict, you've drifted from "helpful sublanguage" to "obfuscation" — a senior-level concern.

---

## Term Rewriting — Pattern → Replacement

Macros transform *code*; **term rewriting** transforms *any* symbolic expression by the same mechanism: match a **pattern**, produce a **replacement**, repeat until nothing matches. A rewrite rule is written `pattern → replacement`, with variables (often capitalized) that match any sub-expression:

```
x + 0        →  x
0 + x        →  x
x * 1        →  x
x * 0        →  0
x + x        →  2 * x
(a + b) * c  →  a*c + b*c        (distribution)
```

A term-rewriting *system* applies these repeatedly until the expression reaches a **normal form** (no rule applies). This is exactly how compiler optimizers simplify (`x*1 → x`), how algebra simplifiers work, and how Mathematica's entire evaluation model is defined. In Wolfram-style pseudocode, rules are first-class and `/.` means "apply these rules":

```wolfram
(* Wolfram-style: ReplaceAll (/.) applies rewrite rules to an expression. *)
x + 0  /.  a_ + 0 -> a            (* → x      ;  a_ matches anything *)
2*(y + 3)  /.  c_*(a_ + b_) -> c*a + c*b   (* → 2 y + 6 *)
```

Here's a compact rewriter in Python on tuple-trees `(op, left, right)`, applying a few algebraic rules bottom-up until a fixed point:

```python
def rewrite(e):
    # Atoms (symbols, numbers) rewrite to themselves.
    if not isinstance(e, tuple):
        return e
    op, a, b = e[0], rewrite(e[1]), rewrite(e[2])   # rewrite children first
    # --- rules: pattern → replacement ---
    if op == "+" and b == 0:  return a              # x + 0 → x
    if op == "+" and a == 0:  return b              # 0 + x → x
    if op == "*" and b == 1:  return a              # x * 1 → x
    if op == "*" and (a == 0 or b == 0): return 0   # x * 0 → 0
    if op == "+" and a == b:  return ("*", 2, a)    # x + x → 2*x
    return (op, a, b)

rewrite(("+", "x", 0))                 # 'x'
rewrite(("*", ("+", "x", 0), 1))       # 'x'   (children simplified first, then outer)
rewrite(("+", "y", "y"))               # ('*', 2, 'y')
```

Two design points worth internalizing: rewriting is **bottom-up** (simplify children before the parent, so `(x+0)*1` first becomes `x*1` then `x`), and it runs to a **fixed point** (keep applying until nothing changes). Termination is not guaranteed in general — a careless rule set can loop forever (`x → x+0 → x → …`), which is one reason real systems order and constrain their rules carefully.

---

## A CAS in Miniature: Symbolic Differentiation

Now combine everything: a symbolic differentiator is just a **term-rewriting system whose rules are the rules of calculus**, walking the expression tree and building a new one. This is the SICP classic, and it's the clearest proof that "transform expressions, don't compute numbers" is a real, mechanical procedure.

The calculus rules as rewrites (differentiating with respect to `x`):

```
d/dx (c)        →  0                    (constant)
d/dx (x)        →  1                    (the variable itself)
d/dx (u + v)    →  d/dx(u) + d/dx(v)    (sum rule)
d/dx (u * v)    →  u*d/dx(v) + v*d/dx(u)  (product rule)
```

In Scheme, operating directly on s-expressions — note this is *also* a program manipulating code-as-data:

```scheme
(define (deriv expr var)
  (cond
    ((number? expr) 0)                          ; d/dx c = 0
    ((symbol? expr) (if (eq? expr var) 1 0))    ; d/dx x = 1, d/dx y = 0
    ((sum? expr)                                ; d/dx (u + v) = u' + v'
     (make-sum (deriv (addend expr) var)
               (deriv (augend expr) var)))
    ((product? expr)                            ; product rule
     (make-sum
       (make-product (multiplier expr) (deriv (multiplicand expr) var))
       (make-product (deriv (multiplier expr) var) (multiplicand expr))))))

(deriv '(+ x 3) 'x)            ; → 1            (1 + 0, simplified by make-sum)
(deriv '(* x x) 'x)            ; → (+ x x)      (then a simplifier → (* 2 x))
```

The `make-sum`/`make-product` constructors fold in basic rewrite rules (`make-sum a 0 → a`) so the output stays tidy — exactly the term-rewriting from the previous section, doing double duty as a simplifier. The same logic in SymPy is the library you'd actually use:

```python
from sympy import symbols, diff, sin, cos
x = symbols("x")
diff(sin(x) * x, x)     # x*cos(x) + sin(x)   — product rule, applied symbolically
```

The lesson lands: a CAS isn't magic. It's **pattern-matching rewrite rules over expression trees**, with `diff`, `simplify`, `integrate`, and `solve` each being a (large, carefully ordered) rule set. Everything you've learned this level — s-expressions as trees, transforming code/expressions as data, pattern→replacement — is what's running inside `diff`.

---

## Putting It Together

The four mechanisms of this level are one idea seen at four moments in the pipeline:

| Mechanism | What it transforms | When |
|---|---|---|
| **quote / eval** | code ↔ data, by hand | runtime |
| **macro** | code → code | compile / macro-expand time |
| **term rewrite rule** | expression → expression | whenever applied |
| **CAS** (`diff`, `simplify`) | math expression → math expression | runtime, via thousands of rules |

All four rest on the same homoiconic foundation: because expressions (including code) are uniform, inspectable, buildable data, *transforming them is just ordinary programming*. Macros and CAS feel like different worlds — one extends a language, one does algebra — but both are pattern-match-and-rebuild over trees. Seeing that unity is the middle-level payoff.

---

## Common Mistakes

- **Reaching for `eval` when a macro fits.** Runtime `eval` re-incurs parsing, defeats the compiler, and opens security holes. If you're constructing code from code, a compile-time macro is almost always the right tool.
- **Writing a macro where a function suffices.** Macros are heavier: they run at a different time, complicate debugging, and break composition (you can't `map` a macro). Use a macro *only* when you need to control evaluation or generate syntax; otherwise write a function.
- **Ignoring hygiene.** A non-hygienic macro that introduces a variable `tmp` can silently shadow or capture the caller's `tmp`. `syntax-rules` is hygienic; hand-rolled `defmacro` (Common Lisp/Clojure) is not, and you must `gensym` fresh names. (Senior-level topic, but the trap starts here.)
- **Writing non-terminating rewrite rules.** Rules like `x → x + 0` or a pair that undo each other (`a*b → b*a` with no ordering) loop forever. Rewrite systems need a notion of progress toward a normal form.
- **Forgetting to rewrite bottom-up.** Simplifying the parent before its children misses cascading simplifications: `(x+0)*1` only collapses fully if you reduce `x+0 → x` first, then `x*1 → x`.
- **Expecting symbolic simplification to find the "obvious" form.** Simplifiers apply *their* rules, not human intuition; `simplify` may return a form you don't consider simplest, because "simplest" isn't well-defined. This surprises people moving from algebra class to a CAS.

---

## Summary

This level exposes the machinery behind "code as data." An **s-expression** is the uniform nested-list structure in which Lisp writes *both* code and data, so the parsed program is reachable as ordinary lists. The **read–eval cycle** (text → s-expression → value) has a gap between reading and evaluating where code is data you can transform — the home of **macros**. The central distinction: a **function** runs at runtime on the *values* of its arguments and returns a value; a **macro** runs at compile time on the *unevaluated code* of its arguments and returns *new code*, which lets it control evaluation and invent new syntax — the basis of embedded **DSLs**. **`quote`** moves code to data and **`eval`** moves data to a value; macros are the disciplined, compile-time form of that round-trip. **Term rewriting** — match a pattern, produce a replacement, repeat to a fixed point — is the same transform applied to arbitrary expressions, and a **computer algebra system** is exactly a large, carefully ordered term-rewriting system: `diff` differentiates `x²` to `2x` by applying calculus rules over the expression tree. One idea — transform uniform tree-data — recurs at every stage; recognizing that unity is what this level teaches.

---

## Further Reading

- *SICP* §2.3.2 "Example: Symbolic Differentiation" — the `deriv` above, built and explained step by step. Then §4.1, "The Metacircular Evaluator," for read/eval made explicit.
- Paul Graham, *On Lisp*, Ch. 7–10 — macros from `quote`/`eval` foundations through real DSL construction. The deepest practical treatment.
- *The Little Schemer* — pattern-matching and recursion over s-expressions, the mental muscle behind term rewriting.
- Stephen Wolfram, *An Elementary Introduction to the Wolfram Language*, on rules and `ReplaceAll` (`/.`) — term rewriting as a whole language's evaluation model.
- Doug Hoyte, *Let Over Lambda* — advanced macros and the consequences of (non-)hygiene; a bridge to the senior level.

---

## Related Topics

- [`junior.md`](junior.md) — symbols vs values, expressions as data, homoiconicity, and the numeric-vs-symbolic split.
- [`senior.md`](senior.md) — macro hygiene in depth, the readability/debuggability cost, when symbolic is the right tool, and expression swell.
- [`professional.md`](professional.md) — macros in Clojure/Racket, compilers as symbolic programs, production CAS, provers, and neuro-symbolic AI.
- [`interview.md`](interview.md) — the graded Q&A bank covering homoiconicity, macro-vs-function, term rewriting, and more.
- [04 — Logic Programming](../04-logic-programming/) — **unification** is pattern matching's powerful cousin; logic programming and term rewriting are deeply related.
- [Functional Programming](../../code-craft/functional-programming/) — recursion over trees and pure transformation are the FP skills this level leans on.
