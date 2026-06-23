# Concatenative & Stack-Based — Junior Level

> **Roadmap:** [Programming Paradigms](../README.md) → Concatenative & Stack-Based
> *Most languages pass data through named variables. Here, data flows through an invisible stack, and a program is just words placed side by side.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The Stack as Implicit Memory](#core-concept-1--the-stack-as-implicit-memory)
5. [Core Concept 2 — Words Consume and Produce Stack Items](#core-concept-2--words-consume-and-produce-stack-items)
6. [Core Concept 3 — Reverse Polish Notation (RPN)](#core-concept-3--reverse-polish-notation-rpn)
7. [Core Concept 4 — Defining a New Word](#core-concept-4--defining-a-new-word)
8. [Core Concept 5 — Why There Are No Variable Names](#core-concept-5--why-there-are-no-variable-names)
9. [Reading Stack-Effect Comments](#reading-stack-effect-comments)
10. [Real-World Examples](#real-world-examples)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **What is it, and why does it matter?**

You have written `add(3, 4)` thousands of times. The function name comes first, the arguments sit inside parentheses, and the result comes back to whoever called. That ordering feels like *the* way to call a function — but it isn't. It's one convention among several.

Here is the same addition in a **concatenative, stack-based** language (Forth):

```forth
3 4 +    \ pushes 3, pushes 4, then + adds them → 7 is now on the stack
```

No parentheses. No commas. No argument names. The numbers `3` and `4` are *placed onto a stack*, and the word `+` *takes the top two items off the stack and pushes their sum back*. The program is literally a sequence of words written one after another, and running it means executing each word left to right against a shared, invisible pile of data — the **stack**.

That single idea — **a program is words juxtaposed (placed side by side) operating on an implicit stack** — is the whole paradigm. It powers Forth (embedded systems, boot firmware), PostScript (the language inside every printer and PDF), Factor (a modern descendant), and, under the hood, the *bytecode* of the JVM, WebAssembly, and CPython. You have been running stack machines your entire career without seeing them.

> **The mindset shift:** stop thinking "call a function *with* named arguments." Start thinking "data sits on a stack, and each word reaches into that stack to do its job." The arguments are wherever you last left them — on top of the pile.

---

## Prerequisites

- **Required:** You can read basic code in some language — you know what a function and a return value are. Examples use **Forth** (the canonical stack language) with asides in **PostScript** and **Factor**.
- **Required:** You understand a **stack** as a data structure: last-in, first-out (LIFO) — like a stack of plates, you add and remove from the top.
- **Helpful:** You have used an RPN (Reverse Polish Notation) calculator, or an old HP calculator, or seen `3 4 +` somewhere and wondered what it meant.
- **Not required:** Any prior exposure to Forth or assembly. This page builds the intuition from zero.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Stack** | A last-in-first-out pile of data values. You **push** onto the top and **pop** off the top. The paradigm's only shared memory. |
| **Word** | The unit of program in Forth — what other languages call a *function* or *command*. `+`, `dup`, and `square` are all words. |
| **Push** | Place a value on top of the stack. Writing a number (`5`) pushes it. |
| **Pop** | Remove the top value off the stack. `+` pops two values to add them. |
| **Concatenative** | A style where placing two programs **next to each other** (concatenating their text) **composes** them — runs one then the other. |
| **Juxtaposition** | Putting two things side by side. In this paradigm, juxtaposition *is* function composition. |
| **RPN** | Reverse Polish Notation — operators come *after* their operands (`3 4 +`), so no parentheses are needed. |
| **Stack effect** | A comment describing what a word takes off the stack and what it leaves, written `( before -- after )`. |
| **Point-free / tacit** | Code that never names its arguments — data flows implicitly through the stack. Concatenative languages are point-free by nature. |

> Lock in two words: **stack** (the implicit memory everything flows through) and **word** (a named operation, what you'd elsewhere call a function).

---

## Core Concept 1 — The Stack as Implicit Memory

In a normal language, when you write `x = 3`, the value `3` is stored under the **name** `x`. To use it later, you say its name. Concatenative languages throw away the names. There is one shared place where values live: **the stack**. You don't name a value; you just leave it on top of the stack, and the next word picks it up.

Watch the stack change as Forth runs `3 4 +`, reading left to right. The stack grows to the **right**, so the rightmost item is the top:

```
                  Stack (top is rightmost)
  (start)         ⟨ empty ⟩
  3               ⟨ 3 ⟩            \ literal 3 → pushed
  4               ⟨ 3 4 ⟩          \ literal 4 → pushed
  +               ⟨ 7 ⟩            \ + pops 4 and 3, pushes 3+4 = 7
```

Every Forth program is this: a value is either **pushed** (when you write a literal like `3`) or **transformed** (when you write a word like `+` that pops some items and pushes others). There is no other kind of step. The stack is the program's entire short-term memory, and it is *implicit* — you never declared it, never named it, but every word reads and writes it.

This is why the order is `3 4 +` and not `+ 3 4`. The operands must already be **on the stack** before `+` can grab them. You set the table first, then call the word that eats from it.

---

## Core Concept 2 — Words Consume and Produce Stack Items

Every word has a contract: *how many items it pops* and *how many it pushes*. Learn a word by learning its effect on the stack, not by memorizing a parameter list.

```forth
\  word      pops        pushes      meaning
\  +         2 numbers   1 number    sum
\  *         2 numbers   1 number    product
\  negate    1 number    1 number    flips the sign
\  .         1 number    0           prints it (and removes it)
\  dup       1 item      2 items     duplicates the top item
\  drop      1 item      0           throws the top item away
```

Because words chain, the *output* of one word is automatically the *input* of the next — they share the stack. Compute `(3 + 4) * 2`:

```forth
3 4 + 2 *        \ → 14
\  3       ⟨ 3 ⟩
\  4       ⟨ 3 4 ⟩
\  +       ⟨ 7 ⟩         \ 3+4
\  2       ⟨ 7 2 ⟩
\  *       ⟨ 14 ⟩        \ 7*2
```

Notice there was never a temporary variable for the intermediate `7`. It simply stayed on the stack until `*` consumed it. Data flows from word to word through the stack like water through a pipe — each word taps in, does its bit, and leaves the result for the next.

---

## Core Concept 3 — Reverse Polish Notation (RPN)

The notation where operators come **after** their operands is called **Reverse Polish Notation** (RPN), named after the Polish logician Jan Łukasiewicz. The "normal" math you learned — `3 + 4` with the operator *between* the operands — is **infix**. Concatenative languages use **postfix** (RPN) because it matches the stack perfectly: by the time you reach `+`, both operands are already pushed.

The killer feature of RPN: **you never need parentheses**, and there is no operator precedence to memorize. The order you write the words *is* the order they execute.

```
Infix (needs parentheses & precedence)     RPN (needs neither)
  (3 + 4) * 2                                3 4 + 2 *
  3 + 4 * 2                                  3 4 2 * +
  ((1 + 2) * (3 + 4))                        1 2 + 3 4 + *
```

Look at the last line. In infix you need two pairs of parentheses to force the additions before the multiply. In RPN the structure is unambiguous from the order alone: push 1, push 2, add (→3), push 3, push 4, add (→7), multiply (→21). This is exactly why RPN calculators (the classic HP-12C, used by accountants for decades) and printer languages chose postfix — it's simpler for a machine to evaluate and has no ambiguity.

---

## Core Concept 4 — Defining a New Word

You don't just use built-in words — you **define your own**, and that's where the paradigm gets its power. In Forth, `:` starts a definition and `;` ends it. Everything between is the body — itself just a sequence of words.

```forth
: square ( n -- n*n )  dup * ;     \ duplicate the top number, then multiply
: cube   ( n -- n^3 )  dup square * ;  \ a word can use words you defined!

5 square .     \ prints 25
3 cube .       \ prints 27
```

Read `square` aloud: "take the number on top, `dup` it (now there are two copies), `*` them together." It works for *whatever* number is on the stack — you never named that number, because `dup` and `*` just operate on whatever's there.

This is the second half of the paradigm. A program is built **bottom-up** from tiny words, each one a name for a useful stack transformation. `cube` is defined in terms of `square`, which is defined in terms of `dup` and `*`. You grow a vocabulary, and the vocabulary *is* the program. Forth programmers call this **factoring**: breaking a big behavior into many small, sharply-named words.

---

## Core Concept 5 — Why There Are No Variable Names

This is the part that feels strangest at first, so let's name it directly. In `square`, where is the parameter? In Python you'd write `def square(n): return n * n` — the `n` is a **named parameter**. In Forth's `square`, there is no `n`. The value is "the thing on top of the stack," and you refer to it only through the stack words (`dup`, `swap`, `drop`).

Programs that never name their arguments are called **point-free** or **tacit**. Concatenative languages are point-free *by their very nature* — there's nowhere to put a name, because data flows through the implicit stack instead of through named slots.

```forth
\ Python:   def add1(n): return n + 1     ← names its parameter "n"
: add1 ( n -- n+1 )  1 + ;                \ Forth: no name; "the top item, plus 1"
```

Why would anyone want this? Two reasons you can appreciate now:

1. **Composition is free.** Since words just consume and produce stack items, you glue them together by writing them in a row — no plumbing of arguments. `1 + 2 *` is "add one, then double," built by concatenation. (The senior level shows why this makes the language unusually composable.)
2. **It's minimal.** A Forth interpreter can be astonishingly tiny — a few kilobytes — because there's almost no machinery: push literals, look up words, run them against a stack. That minimalism is exactly why Forth lives in boot loaders and tiny embedded chips.

The cost — which you'll feel the moment you write anything non-trivial — is that *you* must keep track of what's on the stack in your head, since the language won't name it for you. That trade-off is the heart of the paradigm, and the senior level weighs it honestly.

---

## Reading Stack-Effect Comments

You will see this notation constantly, so learn to read it cold. A **stack-effect comment** documents what a word does to the stack:

```forth
( before -- after )
```

- Left of `--`: what the word **expects on the stack** (and consumes), top item rightmost.
- Right of `--`: what the word **leaves on the stack**, top item rightmost.

```forth
( a b -- sum )       \ + : takes two items a and b, leaves their sum
( n -- n n )         \ dup : takes one item, leaves two copies of it
( a b -- b a )       \ swap : takes two items, leaves them in swapped order
( x -- )             \ drop : takes one item, leaves nothing
( -- x )             \ a word that pushes a value and consumes nothing
( a b c -- a c )     \ takes three, leaves two (the middle one is gone)
```

These comments aren't enforced by the compiler — they're documentation — but in stack-based code they are *essential*, because without them a reader has no way to know how a word reshapes the stack. Treat the stack effect as the word's true signature; in this paradigm it replaces the parameter list you're used to.

---

## Real-World Examples

| Thing you've used | Where the stack/concatenative idea lives |
|---|---|
| An old **HP calculator** (HP-12C, HP-48) | Pure RPN: you key `3 [Enter] 4 +`, no `=` button needed. |
| Every **PostScript / PDF** file | PostScript is a stack-based language; `100 200 moveto` pushes coordinates, then draws. |
| **Boot firmware** (Open Firmware on old Macs/Suns, U-Boot) | Forth runs before your OS, sized to fit in a ROM. |
| **JVM `.class` bytecode** | `iload`, `iadd`, `istore` push/pop on an operand stack — a stack machine. |
| **WebAssembly** (`wasm`) | A stack machine bytecode that runs in every modern browser. |
| **CPython bytecode** | `LOAD_FAST`, `BINARY_ADD` operate on a value stack inside the interpreter. |
| A **shell pipeline** `cat f \| sort \| uniq` | The same *concatenative* spirit — each stage's output feeds the next by position, not by name. |

The surface languages (Forth, Factor, PostScript) are niche. But the *stack machine* — the engine underneath — is one of the most widely deployed computing models in existence. Learning the paradigm explains what's really happening when your Java or Python compiles.

---

## Mental Models

- **The assembly line.** The stack is a conveyor belt; each word is a station that takes items off the belt, does something, and puts results back. The belt carries data from station to station with no labels — just position.
- **The pile of plates.** The stack is plates stacked on a counter. You can only touch the top plate. `push` adds a plate, `pop` takes the top one. `dup` is "make a copy of the top plate"; `swap` is "exchange the top two."
- **Words are LEGO bricks.** Each word is a brick with a fixed number of studs it sits on (what it pops) and studs on top (what it pushes). You build programs by snapping bricks in a row — and the studs always line up because everything connects through the one stack.
- **RPN is "operands first, then the verb."** "Three, four, *add them*." You gather the things, then say what to do — which is why the operator comes last.

---

## Common Mistakes

- **Writing infix order.** Newcomers write `3 + 4` and get an error or wrong result. The operator comes *after*: `3 4 +`. In RPN, the verb is last.
- **Losing track of the stack.** You think the top is `7` but it's actually `7 2` because you forgot a value is still sitting there. The fix: write the **stack-effect comment** and mentally trace `⟨ … ⟩` after each word.
- **Forgetting a word consumes its inputs.** `+` *removes* the two numbers it adds. After `3 4 +`, the `3` and `4` are gone — only `7` remains. Words eat their operands.
- **Confusing `dup` and `swap`.** `dup` copies the top item (`( n -- n n )`); `swap` reorders the top two (`( a b -- b a )`). Reaching for the wrong one silently corrupts the stack.
- **Expecting named parameters.** There is no `n` to refer to. If you need a value twice, you `dup` it; if you need to reach a value buried under another, you `swap` or `rot`. Stack juggling *is* the parameter handling.
- **Assuming `.` is harmless.** In Forth `.` prints **and pops**. After `5 .`, the stack is empty again — the value is consumed by printing, just like any other word.

---

## Test Yourself

1. In your own words, what *is* the stack in a concatenative language, and why is it called "implicit"?
2. Trace the stack step by step for `2 3 + 4 *`. What's the final result?
3. Rewrite the infix expression `(5 - 2) * 3` in RPN.
4. What does the stack-effect comment `( a b -- b a )` describe? Which built-in word is it?
5. Define a Forth word `double` that takes a number and leaves twice that number. Write its stack-effect comment too.
6. Why does `3 4 +` have to be in *that* order — why can't `+` come first?
7. After running `7 dup`, what is on the stack? After then running `*`?

> Try each before reading on. If #2 or #3 is shaky, re-read [RPN](#core-concept-3--reverse-polish-notation-rpn) and trace every word with `⟨ … ⟩` notation.

---

## Cheat Sheet

```
CONCATENATIVE & STACK-BASED in one breath:
  A program is WORDS placed side by side, each operating on an implicit STACK.
  Juxtaposition (writing words in a row) = composition (do this, then that).

THE STACK (LIFO, top = rightmost in our notation ⟨ a b c ⟩, c is top):
  writing a literal   →  PUSHES it          5        ⟨ 5 ⟩
  a word              →  POPS inputs, PUSHES outputs

RPN (postfix): operator AFTER operands, no parens, no precedence.
  infix (3 + 4) * 2   ≡   RPN  3 4 + 2 *

ESSENTIAL WORDS (stack effects):
  +  ( a b -- a+b )      dup  ( n -- n n )       swap ( a b -- b a )
  *  ( a b -- a*b )      drop ( x -- )           .    ( n -- )  prints+pops

DEFINE A WORD (Forth):
  : square ( n -- n*n )  dup * ;        \ build vocabulary bottom-up
  5 square .                            \ → 25

NO VARIABLE NAMES → point-free / tacit. Data flows through the stack.
READ ( before -- after ) as the word's real signature.
```

---

## Summary

A **concatenative, stack-based** language structures a program as a sequence of **words** placed side by side, each operating on a single shared, implicit **stack**. Writing a literal **pushes** a value; writing a word **pops** its inputs and **pushes** its outputs — so data flows from word to word through the stack with no named variables. Because operators come *after* their operands (**Reverse Polish Notation**), there are no parentheses and no precedence rules; the order you write the words is the order they run. You build programs **bottom-up** by defining small new words (`: square dup * ;`) in terms of existing ones — a practice called **factoring**. The defining property is that **putting two programs side by side composes them**, which is why the style is called *concatenative*, and the absence of argument names is why it's called *point-free* or *tacit*. The surface languages (Forth, Factor, PostScript) are niche, but the **stack machine** underneath powers JVM bytecode, WebAssembly, CPython, PDF, and embedded firmware — so this paradigm runs far more code than its obscurity suggests.

---

## Further Reading

- Leo Brodie, *Starting Forth* — the legendary, friendly introduction to Forth; the stack-effect comment convention comes from here.
- Leo Brodie, *Thinking Forth* — the philosophy of factoring programs into small words; readable even if you never write Forth.
- *PostScript Language Tutorial and Cookbook* ("the Blue Book", Adobe) — see a stack-based language drawing real graphics.
- The Factor language documentation — a modern concatenative language with a tutorial that shows where the ideas went next.

---

## Related Topics

- [`middle.md`](middle.md) — concatenation *is* composition, the stack-manipulation words (`dup`/`swap`/`over`/`rot`), quotations, and point-free programming.
- [`senior.md`](senior.md) — the real trade-offs: composability and tiny implementations vs the "stack juggling" readability cost.
- [01 — Overview & Taxonomy](../01-overview-and-taxonomy/) — where this paradigm sits on the imperative ↔ declarative map.
- [02 — Imperative & Procedural](../02-imperative-and-procedural/) — the named-variable, statement-sequence world this paradigm rejects.
- [Functional Programming → Composition](../../code-craft/functional-programming/05-composition/junior.md) — function composition, which juxtaposition here makes implicit and free.
