# Concatenative & Stack-Based — Middle Level

> **Roadmap:** [Programming Paradigms](../README.md) → Concatenative & Stack-Based
> *The defining claim of the paradigm is one equation: placing two programs side by side **is** composing them. Everything else follows from it.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Concatenation IS Composition](#concatenation-is-composition)
4. [The Stack-Manipulation Words](#the-stack-manipulation-words)
5. [Factoring Programs into Small Words](#factoring-programs-into-small-words)
6. [Quotations — Code as Stack Values](#quotations--code-as-stack-values)
7. [Point-Free / Tacit Programming](#point-free--tacit-programming)
8. [Building Control Flow from the Stack](#building-control-flow-from-the-stack)
9. [Worked Example — A Small Program, Factored](#worked-example--a-small-program-factored)
10. [Common Mistakes](#common-mistakes)
11. [Summary](#summary)
12. [Further Reading](#further-reading)
13. [Related Topics](#related-topics)

---

## Introduction

> Focus: **The defining property and the toolkit for working with the stack.**

At the junior level you learned that a program is words operating on an implicit stack, written in postfix order. That's the mechanics. This level is about the **idea that makes the mechanics matter**: in a concatenative language, **concatenation equals composition**. Writing program `f` followed by program `g` — literally putting their text next to each other — produces a program that does `f` then `g`, and that combined program is itself a first-class program you can name and reuse.

That equation sounds almost too simple to be profound, but it changes how you *build* software. There's no syntax for "compose these two functions" — you just write them in a row. There's no syntax for "pass the result of one to the next" — the stack does it. The consequence is a programming style of relentless **factoring**: you break behavior into tiny words, and you assemble bigger behavior by juxtaposing them. This level gives you the tools — the stack-manipulation words, quotations, point-free reasoning, and stack-built control flow — to actually write non-trivial concatenative code.

> **The mindset shift:** stop thinking of a function call as "apply `f` to arguments `a, b`." Start thinking of a program as "a transformation of the whole stack," and of a larger program as "transformations run back to back." Building software becomes string-concatenation of transformations.

---

## Prerequisites

- **Required:** The junior level of this topic — the stack, words, RPN, stack-effect comments, and defining a word with `: … ;`.
- **Required:** Comfort with the stack-effect notation `( before -- after )`; we use it on every word here.
- **Helpful:** Familiarity with **function composition** from FP — `compose(f, g)` or `f ∘ g`. The connection is exact and we make it explicit. See [FP → Composition](../../code-craft/functional-programming/05-composition/junior.md).
- **Helpful:** A passing acquaintance with **higher-order functions** (passing a function as a value), since quotations are the concatenative version.

---

## Concatenation IS Composition

This is the heart of the paradigm, so let's prove it to yourself carefully.

In most languages, function composition is an *operation you invoke*. In math: `(g ∘ f)(x) = g(f(x))`. In code: `compose(g, f)` or `xs.map(f).map(g)`. You need a combinator (`∘`, `compose`, `.andThen`) to express "do `f`, then feed its result to `g`."

In a concatenative language, that combinator **vanishes**. Consider two Forth words:

```forth
: inc    ( n -- n+1 )  1 + ;
: double ( n -- 2n  )  2 * ;
```

Now write them side by side:

```forth
inc double      \ ( n -- 2*(n+1) )  — add 1, then double
```

Just by *juxtaposing* `inc` and `double`, you composed them. There is no `compose` operator — the act of writing one word after another **is** composition. And `inc double` is itself a valid program you can name:

```forth
: inc-then-double ( n -- 2(n+1) )  inc double ;
5 inc-then-double .    \ → 12
```

### Why this works: every word is a stack-to-stack function

The trick is uniformity. In most languages functions have *different shapes* — `add(a, b)` takes two args, `negate(x)` takes one, `print()` takes none and returns nothing. You can't blindly chain them; the arities don't line up.

In a concatenative language, **every word has the same type**: it's a function from *a stack* to *a stack*. `+` is `Stack → Stack` (it happens to consume two and produce one). `dup` is `Stack → Stack`. `square` is `Stack → Stack`. Because they all have the identical input and output type — the whole stack — **any word can follow any word**. Composition is always well-typed, so it's always just juxtaposition.

> **Key insight:** concatenative languages make *the entire stack* the single value that every word transforms. When every function is `Stack → Stack`, composing them is concatenating them, because the output type of one always matches the input type of the next. Composition becomes the *default* operation instead of a special one.

### Programs form a monoid under concatenation

For the algebraically inclined: this gives concatenative programs a clean structure. Concatenation is **associative** (`(f g) h` ≡ `f (g h)` — grouping doesn't matter), and the **empty program** is an identity element (concatenating nothing changes nothing). An associative operation with an identity is a **monoid**. So "the set of programs, under concatenation" is a monoid — the same structure as strings under string-concatenation or lists under append. That's not a coincidence of terminology; it's *why* you can refactor concatenative code by freely cutting and pasting runs of words. (The senior level develops the algebraic-reasoning payoff.)

---

## The Stack-Manipulation Words

Because you have no named variables, you need a small vocabulary of words whose only job is to **rearrange the stack** so the right values are on top for the next operation. These are the "plumbing" words. Memorize the core five — they appear in essentially every Forth program.

```forth
dup   ( a   -- a a   )   \ duplicate the top item
drop  ( a   --       )   \ discard the top item
swap  ( a b -- b a   )   \ exchange the top two
over  ( a b -- a b a )   \ copy the SECOND item to the top
rot   ( a b c -- b c a ) \ rotate the top three; third comes to the top
```

Trace each so the effect is concrete:

```
  dup    ⟨ 5 ⟩       → ⟨ 5 5 ⟩
  drop   ⟨ 5 9 ⟩     → ⟨ 5 ⟩
  swap   ⟨ 5 9 ⟩     → ⟨ 9 5 ⟩
  over   ⟨ 5 9 ⟩     → ⟨ 5 9 5 ⟩       \ reached past the top to copy 5
  rot    ⟨ 1 2 3 ⟩   → ⟨ 2 3 1 ⟩       \ the 1 (third down) rotated to the top
```

A few more you'll meet:

```forth
nip   ( a b -- b   )     \ drop the SECOND item (= swap drop)
tuck  ( a b -- b a b )   \ copy top below the second (= swap over)
2dup  ( a b -- a b a b ) \ duplicate the top TWO items
```

These words are how you do what named parameters do elsewhere. Need a value twice? `dup` it before the first use. Need the operands in the other order (for non-commutative ops like `-` and `/`)? `swap` first. Need to reach a value buried one deep? `over`. The senior level calls the cognitive cost of planning these moves **stack juggling** — it's the paradigm's central tax.

```forth
: average ( a b -- avg )  + 2 / ;        \ sum, then halve
: distance-from ( x target -- |diff| )   \ swap so subtraction is right way round
    swap - abs ;
```

---

## Factoring Programs into Small Words

Forth culture has a single dominant value: **factor relentlessly**. A word longer than a line or two is a smell. You break it into smaller words, each with a name and a clear stack effect, until every word is obviously correct on its own.

This isn't stylistic fussiness — it's *forced* by the paradigm. Long concatenative code is unreadable because the reader must simulate a deep stack in their head. Short words keep the stack shallow and the meaning local. Good factoring is the difference between Forth that reads like prose and Forth that's write-only.

```forth
\ Unfactored: what does this even do? You must trace the whole stack.
: tax-total ( price rate -- total )  over * 100 / + ;

\ Factored: each word is named, short, and independently understandable.
: tax     ( price rate -- tax )    100 / * ;
: with-tax ( price tax -- total )  + ;
\ now compose them — and read the intent off the names
: tax-total ( price rate -- total )  over tax with-tax ;
```

The second version costs more words but reads as *intent*: compute the `tax`, then add it `with-tax`. Naming is the documentation; the stack effect is the type. Brodie's *Thinking Forth* is an entire book about this discipline, and its lessons (small units, sharp names, factor by behavior) transfer directly to clean code in any language.

> **Rule of thumb:** if you can't write a one-line English sentence for a word, or its stack effect has more than ~3 items on either side, factor it. Deep stacks are where bugs hide.

---

## Quotations — Code as Stack Values

So far, words *execute* when you write them. But how do you get **higher-order behavior** — passing a "piece of code" to another word, the way you pass a lambda to `map`? The answer is a **quotation**: a chunk of code treated as a *value* that you push onto the stack without running it, to be executed later by some word that consumes it.

In **Factor** (the leading modern concatenative language), quotations are written in square brackets `[ … ]`:

```factor
[ 2 * ]              ! a quotation: "double the top of the stack" — pushed, NOT run
{ 1 2 3 } [ 2 * ] map    ! → { 2 4 6 }   map runs the quotation on each element
{ 1 2 3 4 } [ even? ] filter  ! → { 2 4 }
5 [ "hi" print ] times   ! run the quotation 5 times
```

A quotation is the concatenative analogue of a **lambda / first-class function**. `map`, `filter`, `each`, `times`, and `if` are all words that take a quotation off the stack and apply it. This is what makes a concatenative language able to express map/filter/reduce, callbacks, and strategies — the same things first-class functions give you in FP, here delivered as bracketed code-on-the-stack.

Forth's older equivalent is the *execution token*: `'` (tick) pushes a word's address, and `EXECUTE` runs it — lower-level, but the same idea (code as a value you can pass around). Quotations make it ergonomic.

```factor
! compose two quotations into one with `compose`, or just concatenate them:
[ 1 + ] [ 2 * ] compose    ! a quotation equivalent to [ 1 + 2 * ]
```

Even quotation composition is, fittingly, concatenation — joining the two code fragments.

---

## Point-Free / Tacit Programming

Code that never mentions its arguments by name is **point-free** (the "points" are the named values/arguments; you have none) or **tacit**. Concatenative languages are point-free *by construction* — there's no place to name an argument, so all data threads implicitly through the stack.

```forth
\ point-free by nature — "n" is never written
: hypotenuse-sq ( a b -- a²+b² )  dup * swap dup * + ;
```

You'll meet point-free style elsewhere too — Haskell's `f = g . h` or `sum = foldr (+) 0`, APL/J's tacit trains, shell pipelines. Concatenative languages are simply the paradigm where point-free isn't a clever style choice but the *only* way the language works. The benefit is maximal composability (no argument plumbing to write); the cost is that complex data routing — needing the 2nd and 4th stack items but not the 1st and 3rd — turns into a tangle of `dup`/`swap`/`rot`/`over` that's hard to read. Recognizing when point-free stops paying off (and factoring to keep stacks shallow) is the practicing skill.

---

## Building Control Flow from the Stack

Concatenative languages have no special "syntax" for `if`/loops in the way C does — control flow is **words that consume a boolean (and often a quotation) off the stack**. The condition's result sits on the stack like any other value, and a word inspects it.

**Forth** uses words that bracket code, reading the flag from the stack:

```forth
: abs ( n -- |n| )  dup 0 < if negate then ;
\  dup       ⟨ n n ⟩
\  0 <       ⟨ n flag ⟩    \ flag = true if n<0
\  if … then runs `negate` only when flag is true; consumes the flag

: classify ( n -- )  dup 0 > if ." positive" else ." non-positive" then drop ;
```

```forth
: countdown ( n -- )           \ a definite loop with do … loop
    0 swap do  i . loop ;       \ i pushes the loop index
5 countdown                     \ prints 0 1 2 3 4

: shrink ( n -- )               \ an indefinite loop with begin … until
    begin  dup . 1- dup 0= until  drop ;
```

**Factor** is cleaner: control-flow words take **quotations**, so the branches are just code-values on the stack:

```factor
: abs ( n -- |n| )  dup 0 < [ neg ] when ;     ! run [ neg ] when the flag is true
: sign ( n -- str )  dup 0 > [ "pos" ] [ "neg" ] if ;   ! if takes two quotations
```

The deep point: **`if` is just a word**. It pops a boolean and (in Factor) two quotations, and runs one of them. There's no privileged syntax — control flow is built from the same stack-and-words machinery as everything else, which is exactly why concatenative languages can be so small. (PostScript works the same way: `bool { … } { … } ifelse`.)

---

## Worked Example — A Small Program, Factored

Compute the area of a triangle from base and height — `area = (base * height) / 2` — and build it the concatenative way: small words, composed.

```forth
\ Step 1: the smallest reusable pieces
: half      ( n -- n/2 )       2 / ;
: rect-area ( b h -- b*h )      * ;

\ Step 2: compose by juxtaposition — read it as "rectangle area, then halve"
: tri-area  ( base height -- area )  rect-area half ;

10 4 tri-area .     \ → 20
```

Now extend it: total area of two triangles. Notice we **reuse `tri-area` by concatenation** — no glue code:

```forth
: two-tri ( b1 h1 b2 h2 -- total )  tri-area  rot rot  ... ;
\  (the rot rot is "stack juggling" to line up the second pair — a sign we
\   should consider a data structure instead; see the senior level on this cost)
```

That trailing comment is the honest part: the moment the data routing gets non-trivial (four inputs, two pairs), the point-free style strains and you reach for `rot`-heavy juggling. A senior weighs exactly this — composability is free until the stack shape gets complicated, and then the readability tax comes due.

---

## Common Mistakes

- **Thinking you need a `compose` operator.** You don't — juxtaposition *is* composition. Writing `inc double` already composes them. Looking for a combinator means you're still thinking in non-concatenative terms.
- **Over-deep stacks.** Trying to keep five or six live values on the stack and shuffle them with `rot`/`over` chains. This is the #1 readability killer. Factor into smaller words, or accept that the problem wants a record/array, not the bare stack.
- **Running a quotation when you meant to push it.** In Factor, `2 *` runs; `[ 2 * ]` pushes the code as a value. Forgetting the brackets executes the body immediately instead of handing it to `map`/`if`.
- **`swap` blindness on non-commutative ops.** `5 2 -` is `3`, but if your operands landed in the wrong order you need `swap` first. `+` and `*` forgive bad order; `-`, `/`, and comparisons don't.
- **`over` vs `dup` confusion.** `dup` copies the **top**; `over` copies the **second** item to the top (`( a b -- a b a )`). Reaching for the wrong one quietly corrupts the stack two operations later.
- **Forgetting `if`/`do` consume the flag/limits.** Control-flow words pop their inputs off the stack just like arithmetic words. Leaving a stray flag behind shifts everything and breaks the next word.
- **Treating stack-effect comments as optional.** In factored code they *are* the type signatures. Skipping them makes your own code unreadable to you a week later.

---

## Summary

The defining property of concatenative languages is that **concatenation is composition**: because every word is uniformly a function from the whole stack to the whole stack, writing two words side by side composes them, with no `compose` operator and no argument plumbing — and programs therefore form a **monoid** under concatenation. Since there are no named variables, you reshape the stack with a small vocabulary of **manipulation words** (`dup`, `drop`, `swap`, `over`, `rot`), and the discipline of **factoring** — breaking behavior into many tiny, sharply-named words — is what keeps such code readable. **Quotations** (`[ … ]` in Factor) are code pushed onto the stack as a value, the concatenative form of first-class functions, enabling `map`/`filter`/`if`/`times` as ordinary words. All code is **point-free / tacit** by construction, and even **control flow** is built from the stack: `if`, `when`, loops, and `ifelse` are words that pop a boolean (and often quotations) — there is no special syntax. The freedom of composition-by-juxtaposition is real, but it comes with the **stack-juggling** cost that the senior level weighs head-on.

---

## Further Reading

- Leo Brodie, *Thinking Forth* — the canonical text on factoring concatenative programs into small words; its advice generalizes to all clean code.
- Manfred von Thun, *Joy* language papers — Joy made "concatenation = composition" and the monoid structure explicit; the clearest theoretical treatment.
- The Factor documentation, "Cookbook" and "Quotations" sections — modern, ergonomic concatenative programming with quotations and combinators.
- Slava Pestov et al., *Factor: A Dynamic Stack-Based Programming Language* (DLS 2010) — the design rationale behind a real, large concatenative language.

---

## Related Topics

- [`junior.md`](junior.md) — the stack, RPN, words, and stack-effect comments.
- [`senior.md`](senior.md) — the trade-offs: composability and tiny implementations vs the stack-juggling readability cost, and where stack-based wins.
- [`professional.md`](professional.md) — stack machines under the hood (JVM, WASM, CPython) and designing a stack VM.
- [`interview.md`](interview.md) — graded Q&A across all levels.
- [FP → Composition](../../code-craft/functional-programming/05-composition/junior.md) — function composition, which juxtaposition makes the default operation here.
- [02 — Imperative & Procedural](../02-imperative-and-procedural/) — the named-variable world this paradigm replaces with the stack.
