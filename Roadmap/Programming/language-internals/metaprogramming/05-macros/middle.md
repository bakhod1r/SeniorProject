# Macros — Middle Level

> **Topic:** [Macros](README.md)
> **Focus:** Macros that understand *syntax*, not just text. Lisp's homoiconicity, `defmacro`, quasiquotation, and the leap from "paste tokens" to "transform an abstract syntax tree" — plus Scheme's automatically hygienic `syntax-rules`.

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
13. [Common Mistakes](#common-mistakes)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [Further Reading](#further-reading)

---

## Introduction

> Focus: **The C preprocessor manipulates text. Lisp macros manipulate the program's tree.** That one difference is the whole reason Lisp macros are powerful enough to define new control structures, while C macros are powerful enough only to make subtle bugs.

At junior level we saw the C preprocessor: blind textual substitution, full of foot-guns precisely because it understands *nothing* about the code it pastes. A natural question follows: what if a macro could operate on the *structure* of the program — the parsed tree — instead of raw characters? Then precedence bugs would be impossible (the structure is already determined), and the macro could reason about the code intelligently.

This is exactly what **Lisp** macros do, and they are the gold standard of macro systems. The key enabling property is **homoiconicity**: in Lisp, *code is written in the same notation as data*. A Lisp program is a nested list, and a list is Lisp's fundamental data structure. So `(+ 1 2)` is simultaneously "a function call that adds 1 and 2" **and** "a three-element list containing the symbol `+`, the number `1`, and the number `2`." Because code *is* data, a macro is just an ordinary function that takes a list (your code) and returns a list (new code) — and the compiler substitutes the returned list in place of the macro call before evaluating it.

This collapses metaprogramming into normal programming. You manipulate code with `car`, `cdr`, `cons`, `map` — the same tools you use on any list. There is no separate "macro language": the language for transforming programs is the language itself. That is why the saying goes, *"Lisp's macros let you grow the language toward your problem."*

In one sentence: **a C macro splices text into your source; a Lisp macro is a function from syntax tree to syntax tree, run by the compiler.** This page builds that idea up — homoiconicity, `defmacro`, quasiquotation (the templating trick that makes writing macros bearable), `gensym` for safety in Common Lisp, and Scheme's `syntax-rules`, which gives you all of this with *automatic hygiene*.

> 🎓 **Why this matters at middle level:** Once you understand AST-level macros, you understand what every modern macro system (Rust, Elixir, Julia, even C++ templates) is *trying* to approximate. You also understand why "macro" means something completely different to a C programmer than to a Lisp programmer, and why interview questions about hygiene and quasiquotation separate people who have *read* about macros from people who have *written* them.

`junior.md` covered textual macros and their bugs. This page covers syntactic macros (Lisp/Scheme). `senior.md` covers Rust's `macro_rules!` and procedural macros and treats hygiene formally. `professional.md` covers shipping macro-heavy systems and the engineering trade-offs.

---

## Prerequisites

What you should know before reading this:

- **Required:** The junior page — what a macro is, and why text substitution causes precedence and double-evaluation bugs.
- **Required:** The idea of an **abstract syntax tree (AST)**: the tree a parser builds from source. `2 + 3 * 4` parses to a tree where `*` is below `+`.
- **Required:** Basic recursion and list operations (build, traverse, transform a list).
- **Helpful but not required:** Any exposure to Lisp/Scheme/Clojure syntax — prefix notation `(f a b)`. We will explain as we go.
- **Helpful but not required:** The idea of *evaluation order* — that `(if c a b)` must *not* evaluate both `a` and `b`.

You do **not** need to know:

- Rust `macro_rules!` or procedural macros (`senior.md`).
- The formal definition of hygiene via renaming algorithms (`senior.md` sketches it).
- C++ templates as compile-time computation (`senior.md`).

---

## Glossary

| Term | Definition |
|------|-----------|
| **AST (abstract syntax tree)** | The tree representation of parsed source code. Operators and calls become nodes; operands become children. |
| **Homoiconicity** | "Same representation." A property where a language's code is written in one of its own data structures — in Lisp, the list. Code is data. |
| **S-expression** | "Symbolic expression." Lisp's parenthesized list notation, e.g. `(+ 1 (* 2 3))`. Both the syntax and the data structure. |
| **Symbol** | A Lisp identifier as a first-class value — e.g. the symbol `x`, distinct from the *value* bound to `x`. |
| **`defmacro`** | Common Lisp's macro definition form. Defines a function from un-evaluated code (an s-expression) to replacement code. |
| **Macroexpansion** | The compile-time step where a macro call is replaced by the s-expression the macro returns. |
| **Quote (`'` or `quote`)** | Stops evaluation: `'(+ 1 2)` is the *list* `(+ 1 2)`, not the number `3`. The bridge from code to data. |
| **Quasiquote / backquote (`` ` ``)** | A template: like quote, but with "holes" you can fill. Most of the template is literal; marked parts are evaluated. |
| **Unquote (`,`)** | Inside a quasiquote, evaluate this and splice the *single* result in. |
| **Unquote-splicing (`,@`)** | Inside a quasiquote, evaluate this to a *list* and splice its elements in (no surrounding parentheses). |
| **`gensym`** | "Generate symbol." Produces a fresh, guaranteed-unique symbol, used in Common Lisp macros to avoid variable capture. |
| **Variable capture** | A bug where a name the macro introduces collides with a name from the caller (or vice versa). |
| **Hygiene** | The property that macro-introduced names never accidentally collide with the caller's names. Scheme's `syntax-rules` is hygienic *automatically*; Common Lisp's `defmacro` is not (you use `gensym`). |
| **`syntax-rules`** | Scheme's declarative, *hygienic* macro form: you write patterns and templates, and the system handles renaming for you. |
| **`define-syntax`** | Scheme's form for binding a macro name to a transformer (often a `syntax-rules`). |

---

## Core Concepts

### 1. Homoiconicity: Code Is a List

In most languages, source code is text, and the parser converts it into an internal tree you never see. In Lisp, the tree *is* the surface syntax. `(if test then else)` is a four-element list: the symbol `if`, and three sub-expressions. There is nothing else. The parser's job is trivial because the programmer already wrote the tree.

This means you can take a piece of code and treat it as data with a single operation — `quote`:

```lisp
(+ 1 2)        ; => 3        (evaluated: a function call)
'(+ 1 2)       ; => (+ 1 2)  (quoted: a list of three elements)
(first '(+ 1 2))  ; => +     (the symbol +)
(rest  '(+ 1 2))  ; => (1 2) (the arguments, as a list)
```

Because code is just lists, **a macro is a function that takes lists and returns a list.** That returned list *is* code, and the compiler substitutes it for the macro call. No separate template engine, no text munging — just list processing.

### 2. `defmacro`: A Function from Code to Code

Here is a macro that defines a `when`-style conditional (run the body only if the test is true):

```lisp
(defmacro my-when (test &rest body)
  (list 'if test (cons 'progn body)))
```

When you write `(my-when (> x 0) (print x) (incr count))`, the macro receives:
- `test` bound to the *unevaluated* list `(> x 0)`
- `body` bound to the list `((print x) (incr count))`

and returns the list:

```lisp
(if (> x 0) (progn (print x) (incr count)))
```

which the compiler then compiles. Notice the macro received **unevaluated** code — `(> x 0)` was *not* run before the macro saw it; that is exactly what lets a macro control evaluation. A function could never do this: `(my-when-function (> x 0) (print x))` would evaluate `(print x)` *before* the function ran, defeating the point.

That is the deep reason macros exist and functions are not enough: **macros control whether and when their arguments are evaluated.** `if`, `and`, `or`, `while`, `loop` — every short-circuiting or control-flow construct *must* be a macro (or a built-in special form), because a function always evaluates all its arguments first.

### 3. Quasiquotation: Templates for Code

Building lists by hand with `list`, `cons`, and `'` gets unreadable fast. Quasiquotation is a templating syntax that makes the *output code* look like the code it produces. Three pieces:

- **`` ` ``** (backquote / quasiquote): start a template. Everything is literal *unless* marked.
- **`,`** (unquote): "evaluate this and drop the result in here."
- **`,@`** (unquote-splicing): "evaluate this to a list and splice its elements in here."

Rewriting `my-when` with quasiquote:

```lisp
(defmacro my-when (test &rest body)
  `(if ,test (progn ,@body)))
```

Read it as: *"produce the code `(if … (progn …))`, where `,test` is replaced by the actual test expression and `,@body` splices in the body forms one by one."* The template *looks like* the generated code, which is exactly what makes quasiquotation the single most important macro-writing tool. The difference between `,` and `,@`:

```lisp
(let ((xs '(1 2 3)))
  `(list ,xs))     ; => (list (1 2 3))   ; xs dropped in as ONE element
(let ((xs '(1 2 3)))
  `(list ,@xs))    ; => (list 1 2 3)     ; xs SPLICED, parens removed
```

### 4. The Capture Problem and `gensym`

Common Lisp's `defmacro` is **not hygienic**: names you introduce in the expansion live in the caller's namespace and can collide. Consider a macro that swaps two places using a temporary:

```lisp
(defmacro swap (a b)
  `(let ((tmp ,a))      ; <-- introduces a binding named 'tmp'
     (setf ,a ,b)
     (setf ,b tmp)))
```

This looks fine until the caller's code *also* uses `tmp`:

```lisp
(let ((tmp 10) (x 1))
  (swap tmp x))   ; BROKEN: the macro's 'tmp' shadows the caller's 'tmp'
```

The expansion binds a `tmp` that captures the caller's variable, and the swap goes wrong. This is **variable capture** — the syntactic-macro version of the C `tmp`-collision bug. The Common Lisp fix is **`gensym`**, which mints a fresh symbol guaranteed not to appear anywhere else:

```lisp
(defmacro swap (a b)
  (let ((tmp (gensym "TMP")))   ; a unique symbol, e.g. TMP4271
    `(let ((,tmp ,a))
       (setf ,a ,b)
       (setf ,b ,tmp))))
```

Now the temporary has a name no human could have typed, so capture is impossible. Every experienced Common Lisp macro author reaches for `gensym` reflexively when introducing a binding. The lesson: **even syntactic macros need a discipline to avoid capture — unless the language enforces hygiene for you.**

### 5. Scheme's `syntax-rules`: Hygiene for Free

Scheme took a different design path. Its `syntax-rules` macros are **declarative** (you write pattern → template pairs, no list-building code) and **automatically hygienic** (the system renames introduced identifiers so capture *cannot happen*). The same `swap`, in Scheme:

```scheme
(define-syntax swap!
  (syntax-rules ()
    ((swap! a b)
     (let ((tmp a))
       (set! a b)
       (set! b tmp)))))
```

There is no `gensym` here, yet `(let ((tmp 10) (x 1)) (swap! tmp x))` works correctly. The `tmp` introduced *by the macro* is automatically distinct from the `tmp` in the caller — the macro expander renames it behind the scenes. This automatic renaming is the essence of **hygiene**, and it is the headline feature that makes Scheme macros (and, later, Rust's) safe by default.

A `syntax-rules` definition is a set of `(pattern template)` clauses. The pattern matches the *shape* of the macro call; the template is the replacement, with pattern variables filled in. Ellipsis `...` handles repetition:

```scheme
(define-syntax my-or
  (syntax-rules ()
    ((my-or) #f)
    ((my-or e) e)
    ((my-or e1 e2 ...)              ; e2 ... matches "zero or more"
     (let ((t e1))
       (if t t (my-or e2 ...))))))  ; recursive, and 't' is hygienic
```

Note `my-or` is recursive *and* introduces `t` — and hygiene guarantees `t` never collides with any expression the caller passes. (In Common Lisp you would `gensym` that `t`.)

### 6. Macroexpansion Is a Phase Before Evaluation

It is worth being precise about *when* macros run. Compilation proceeds roughly:

1. **Read**: parse text into s-expressions (lists/symbols/numbers).
2. **Macroexpand**: repeatedly replace each macro call with its expansion, until no macros remain. (Expansion can produce more macro calls, which are expanded in turn.)
3. **Compile / evaluate**: process the fully-expanded, macro-free code.

Macros live entirely in step 2. By the time the program runs, every macro is gone, replaced by ordinary code. You can watch step 2 directly: `macroexpand-1` (Common Lisp) or `(syntax->datum (expand …))`-style tools (Scheme/Racket) show you the expansion, the Lisp analog of `gcc -E`.

---

## Real-World Analogies

**LEGO instructions vs. a Xerox machine.** The C preprocessor is a Xerox machine: it copies shapes of ink without knowing what they depict. A Lisp macro is a LEGO instruction booklet that works on *assembled sub-models*: it can take the "wheel assembly" you handed it and snap it into a "car frame," because it understands the pieces are structured objects with connection points, not flat pictures. Structure-awareness is the whole difference.

**A contractor reading blueprints vs. a stencil.** A textual macro is a stencil sprayed over a wall — it does not know if it is painting over a window. A syntactic macro is a contractor who reads the *blueprint* (the AST): "put a door in this wall" is understood in terms of walls and doors, so it never accidentally bricks up a window. Hygiene is the contractor labelling every new pipe with a unique serial number so it is never confused with the building's existing plumbing.

**Mad Libs with type-checked blanks.** Quasiquotation is Mad Libs: most of the sentence is fixed (`` ` ``), and a few blanks (`,`) get filled with words you compute. `,@` is the blank that says "insert this whole *list* of words, no quotes around them." The fixed text shows you the shape of the result at a glance — which is why macros are written as quasiquoted templates, not assembled by hand.

---

## Mental Models

- **Code is data; a macro is a function over that data.** This single idea — homoiconicity — is what makes Lisp macros first-class and trivial to write. Everything else follows.
- **Macros receive unevaluated forms.** That is *why* they can implement `if`, `and`, `while` — constructs that must control evaluation. A function evaluates all arguments first and so can never short-circuit.
- **Quote turns code into data; quasiquote builds data that is code.** `'` freezes; `` ` `` templates. Write expansions as quasiquoted templates so the output is legible.
- **Hygiene is "no accidental name collisions."** Scheme/Racket give it automatically; Common Lisp makes you earn it with `gensym`. Either way, *introducing a binding in a macro is the dangerous moment* — that is when capture happens.
- **Macroexpansion is a separate compile phase.** Everything a macro does is finished before run time. Debug by *expanding*, not by stepping the runtime.

---

## Code Examples

### A `unless` macro (Common Lisp), with quasiquote

```lisp
(defmacro unless (test &rest body)
  `(if (not ,test)
       (progn ,@body)))

(unless (member x banned)
  (process x)
  (log-success x))
;; expands to:
;; (if (not (member x banned))
;;     (progn (process x) (log-success x)))
```

### `gensym` in action: a `with-timing` macro

```lisp
(defmacro with-timing (&rest body)
  (let ((start (gensym "START"))     ; fresh symbols so we never
        (result (gensym "RESULT")))  ; capture the caller's names
    `(let ((,start (get-internal-real-time)))
       (let ((,result (progn ,@body)))
         (format t "took ~D ticks~%"
                 (- (get-internal-real-time) ,start))
         ,result))))

(with-timing (slow-computation))   ; runs body, prints elapsed, returns its value
```

Without `gensym`, a caller who happened to use a variable named `start` or `result` inside the body could be silently broken. With it, the macro is robust.

### Seeing the expansion

```lisp
(macroexpand-1 '(unless done (cleanup)))
;; => (IF (NOT DONE) (PROGN (CLEANUP)))   ; the macro's output, before compile
```

`macroexpand-1` expands one level; `macroexpand` expands fully. This is your `gcc -E` for Lisp.

### Scheme `syntax-rules`: `swap!`, `my-list-of`, and recursion

```scheme
;; Hygienic swap — no gensym needed.
(define-syntax swap!
  (syntax-rules ()
    ((_ a b) (let ((tmp a)) (set! a b) (set! b tmp)))))

;; Repetition with ellipsis: build a list, doubling each element.
(define-syntax doubled-list
  (syntax-rules ()
    ((_ x ...) (list (* 2 x) ...))))   ; (doubled-list 1 2 3) => (2 4 6)

;; Recursive, hygienic 'and'.
(define-syntax my-and
  (syntax-rules ()
    ((_) #t)
    ((_ e) e)
    ((_ e1 e2 ...) (if e1 (my-and e2 ...) #f))))
```

The `_` is a conventional placeholder for the macro's own name in the pattern. `...` after a pattern variable means "zero or more," and using `...` in the template repeats the surrounding template once per match.

---

## Pros & Cons

**Pros**

- **No precedence or double-evaluation surprises from text** — the macro works on structure that is already parsed.
- **Macros are ordinary list-processing functions** (in Lisp) — no separate macro language to learn.
- **Can define new control flow and whole DSLs** — `if`, `loop`, pattern matchers, embedded query languages — because they control evaluation.
- **Quasiquotation makes the output readable**, so the macro source resembles the code it emits.
- **Scheme `syntax-rules` gives hygiene for free**, eliminating the most common macro bug.

**Cons**

- **Common Lisp `defmacro` is unhygienic** — you must remember `gensym` for every introduced binding, and forgetting is a silent bug.
- **Macros run at compile time**, so they cannot depend on run-time values, and mixing the two (the *phase distinction*) confuses newcomers.
- **Heavy macro use can make code hard to follow** — a reader must know which forms are macros to understand evaluation order.
- **Error messages can point at expanded code**, far from what you wrote (though Lisp tooling is better at this than C).
- **`syntax-rules` is declarative but limited** — complex transformations need the more powerful `syntax-case` / procedural macros, which reintroduce complexity.

---

## Use Cases

- **New control structures** — `unless`, `when`, `with-open-file`, `with-lock-held`, `do-times` — any construct that must wrap or conditionally run a body. These *cannot* be functions.
- **Resource-safety wrappers** — `with-X` macros that acquire a resource, run a body, and guarantee release, even on error. The body must be unevaluated so the macro can wrap it in cleanup.
- **Embedded DSLs** — query languages, state machines, parser combinators expressed in friendly syntax that expands to efficient code.
- **Boilerplate elimination** — generating accessor functions, struct definitions, or repetitive case dispatch from a compact description.
- **Compile-time computation** — precomputing tables or constants so the run-time program does less work.

Where a function is the right tool instead: anything that operates on *values* and does not need to control evaluation or see source structure. The discipline "use a function unless you genuinely need to control evaluation or transform syntax" is as true in Lisp as in C.

---

## Coding Patterns

**Pattern: `with-X` resource wrapper (controls evaluation of a body).**

```lisp
(defmacro with-lock ((lock) &rest body)
  `(progn (acquire ,lock)
          (unwind-protect (progn ,@body)
            (release ,lock))))
```

`unwind-protect` guarantees `release` runs even if the body throws — only a macro can wrap the body like this.

**Pattern: always `gensym` an introduced binding (Common Lisp).**

```lisp
(let ((g (gensym))) `(let ((,g ,init)) ... ,g))
```

**Pattern: prefer `syntax-rules` when the transformation is structural (Scheme).** Reach for procedural `syntax-case` only when pattern/template is insufficient.

**Pattern: recursive macro with a base case (`syntax-rules`).** Multiple clauses, terminating clause first or last, recurse on the "rest."

---

## Best Practices

- **Write expansions with quasiquote**, not hand-assembled `list`/`cons` — readability is correctness here.
- **Always `gensym` (Common Lisp) or rely on hygiene (Scheme/Racket)** for any binding the macro introduces. Treat "I am introducing a variable" as a red flag to check capture.
- **Expand the macro during development** (`macroexpand-1`) and read the output — confirm it is what you intended.
- **Evaluate each macro argument exactly once** in the expansion if it could have side effects: bind it to a `gensym`med variable first, then use that variable.
- **Document the macro's *expansion contract*** — what shape of call it accepts and what code it produces — because callers cannot infer it from a function signature.
- **Prefer a function unless you need to control evaluation or transform syntax.** Macros are a sharp tool; do not reach for them out of habit.

---

## Edge Cases & Pitfalls

- **Evaluating an argument more than once.** If a macro template uses `,x` in two places and `x` has a side effect, it runs twice — the *same* double-evaluation bug as C, just at the AST level. Bind it once: `` `(let ((,g ,x)) ... ,g ... ,g) ``.
- **Capturing a caller's variable (Common Lisp).** Forgetting `gensym`. Silent and nasty.
- **Being captured *by* a caller's macro/redefinition.** Hygienic systems protect against this too; unhygienic ones do not.
- **Phase confusion.** A macro runs at compile time and cannot see run-time values. Trying to "pass a run-time number to a macro" reflects a misunderstanding of *when* macros execute.
- **`,@` vs `,`.** Splicing vs inserting. Using `,` where you needed `,@` puts a list where you wanted its elements (or vice versa). A very common beginner slip.
- **Macros that look like functions but are not.** A reader who assumes `(my-when c a b)` evaluates all of `c`, `a`, `b` will mis-reason about side effects. Macros change evaluation order; that is their power and their footgun.
- **Recursion that does not terminate** in a `syntax-rules` macro will hang the *compiler*, not the program.

---

## Common Mistakes

1. **Forgetting `gensym`** and shipping a capture bug in Common Lisp.
2. **Using `,` instead of `,@`** (or vice versa) and producing malformed code.
3. **Evaluating an argument multiple times** by repeating `,x` instead of binding it once.
4. **Writing a macro where a function would do** — losing readability and tooling for no benefit.
5. **Confusing compile-time and run-time** — expecting a macro to react to data that only exists at run time.
6. **Not expanding the macro to check it** before assuming it is correct.

---

## Test Yourself

1. What is homoiconicity, and why does it make Lisp macros easy to write?
2. Why must `if`, `and`, and `or` be macros (or special forms) rather than functions?
3. What is the difference between `'`, `` ` ``, `,`, and `,@`?
4. What bug does `gensym` prevent, and why does Scheme's `syntax-rules` not need it?
5. A macro template uses `,x` twice and `x` is `(pop stack)`. What goes wrong, and how do you fix it?
6. What is the Lisp equivalent of `gcc -E`?

<details>
<summary>Answers</summary>

1. Code is written in the language's own list data structure, so a macro is just a function that transforms lists with ordinary list operations — no separate template language.
2. Functions evaluate all arguments before running; these constructs must *not* evaluate some arguments (short-circuit / branch). Controlling evaluation requires receiving unevaluated forms, which only macros/special forms do.
3. `'` quotes (freezes code as data); `` ` `` quasiquotes (a template); `,` unquotes (evaluate and insert one value); `,@` unquote-splices (evaluate to a list and splice its elements without surrounding parens).
4. Variable capture — a macro-introduced name colliding with the caller's. `syntax-rules` automatically renames introduced identifiers (hygiene), so capture cannot occur.
5. `(pop stack)` runs twice — two elements popped instead of one. Fix: `` `(let ((g (gensym))) ...) `` then template `` `(let ((,g ,x)) ... ,g ... ,g) `` so the side effect runs once.
6. `macroexpand-1` / `macroexpand` (Common Lisp); Racket's expansion/`syntax->datum` tools.

</details>

---

## Cheat Sheet

```text
HOMOICONICITY = code IS data (a Lisp program is a list)
MACRO         = a function: list (code) -> list (code), run at compile time
WHY NOT A FN  = macros get UNEVALUATED forms → can control evaluation
                (this is why if/and/or/while/with-X must be macros)

QUOTING
  'x      quote          -> the code as data, frozen
  `(...)  quasiquote     -> a template; literal except marked holes
  ,x      unquote        -> evaluate x, insert the single result
  ,@xs    unquote-splice -> evaluate xs to a list, splice its elements

HYGIENE (no name collisions)
  Common Lisp defmacro  -> NOT hygienic; use (gensym) for every binding
  Scheme  syntax-rules  -> AUTOMATICALLY hygienic; no gensym needed

EXPAND TO DEBUG
  (macroexpand-1 'form)   ; Common Lisp — the Lisp 'gcc -E'

PATTERNS
  with-X wrapper:  `(progn (acquire r) (unwind-protect (progn ,@body) (release r)))
  eval-once:       `(let ((,g ,x)) ... ,g ... ,g)   ; g from gensym
  syntax-rules repetition:  ((_ x ...) (list (f x) ...))
```

---

## Summary

Syntactic macros operate on the program's **structure**, not its text — and in **Lisp** that structure is a list, because Lisp is **homoiconic**: code is data. A macro is therefore an ordinary function from code to code, run during a dedicated **macroexpansion** phase before evaluation. Because macros receive *unevaluated* forms, they can do what functions cannot: define new control flow (`if`, `unless`, `with-lock`) and embed entire DSLs. **Quasiquotation** (`` ` ``, `,`, `,@`) makes writing expansions tractable by letting the macro source mirror its output. The recurring hazard is **variable capture**; **Common Lisp** demands `gensym` discipline to avoid it, while **Scheme's `syntax-rules`** is *hygienic automatically*, renaming introduced identifiers so collisions cannot occur. Hygiene is the headline idea to carry into `senior.md`, where Rust's `macro_rules!` and procedural macros bring hygienic, structured macros into a statically typed systems language — and where we treat hygiene, expansion ordering, and the engineering trade-offs formally.

---

## Further Reading

- *On Lisp* (Paul Graham) — the definitive treatment of Common Lisp macros, `gensym`, and macro-driven design. Free online.
- *Practical Common Lisp* (Peter Seibel), the macro chapters — a gentler, example-driven introduction.
- *The Scheme Programming Language* (R. Kent Dybvig) — `syntax-rules`, hygiene, and `syntax-case`.
- The Racket Guide's "Macros" section — modern, well-tooled hygienic macros with excellent expansion-debugging tools.
- Try it: in any Common Lisp REPL, define `unless` and run `macroexpand-1` on a call; in Racket, write a `syntax-rules` `swap!` and confirm it survives a caller's `tmp`.
