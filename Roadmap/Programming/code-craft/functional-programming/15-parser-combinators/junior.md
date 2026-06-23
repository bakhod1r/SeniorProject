# Parser Combinators (Junior Level)

> **Roadmap:** [Functional Programming](../README.md) → Parser Combinators
>
> *A parser is just a **function** that takes some input text and tries to turn the front of it into a value, returning that value plus whatever text is left over. Small parsers are values you can **glue together** with ordinary functions — and that's all a "parser combinator" is: a function that takes parsers and gives you back a bigger parser.*

---

## Table of Contents

1. [Introduction: Parsing Without the Magic](#introduction-parsing-without-the-magic)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [The One Big Idea: A Parser Is a Function](#the-one-big-idea-a-parser-is-a-function)
5. [Our First Parsers: `char` and `satisfy`](#our-first-parsers-char-and-satisfy)
6. [Combining Parsers: the Four Moves](#combining-parsers-the-four-moves)
   - [`map` — change the value you got](#map--change-the-value-you-got)
   - [`andThen` — one parser after another](#andthen--one-parser-after-another)
   - [`or` — try this, or else that](#or--try-this-or-else-that)
   - [`many` — zero or more of the same thing](#many--zero-or-more-of-the-same-thing)
7. [Building Up: Parsing a Number](#building-up-parsing-a-number)
8. [A Taste of the Real Thing: Haskell and JavaScript](#a-taste-of-the-real-thing-haskell-and-javascript)
9. [Why This Is Nice](#why-this-is-nice)
10. [Common Mistakes](#common-mistakes)
11. [Test Yourself](#test-yourself)
12. [Cheat Sheet](#cheat-sheet)
13. [Summary](#summary)
14. [Further Reading](#further-reading)
15. [Related Topics](#related-topics)

---

## Introduction: Parsing Without the Magic

"Parsing" sounds like something only compiler authors do. It is not. Every time you read a date string into a `Date`, decode JSON into objects, interpret a command-line flag, or split a CSV row, you are **parsing** — turning flat text into structured values. Most of the time you reach for a regex, a `split`, or a hand-written loop with a lot of `if` statements, and it works until the format gets the slightest bit nested, and then it doesn't.

Parser combinators are a different way to build parsers that scales gracefully from "read one character" to "read a whole programming language" — and the surprising part is that it's *not a special tool you install and configure*. It's just functions calling functions. Here is the entire idea, which the rest of this file unpacks slowly:

> A **parser** is a function: you give it the input text, and it tries to consume the front of that text and hand you back a **value** plus **the text it didn't use**. A **parser combinator** is a function that takes one or more parsers and returns a new, bigger parser. You build a parser for something complicated by gluing together parsers for the simple pieces.

That's it. No grammar files, no code generation, no separate "parser language." A parser is an ordinary value in your program, and you build big ones out of small ones the same way you build any other program: by composing functions. If you've ever chained `.map()` and `.filter()` on a list, you already know the shape of this. By the end of this file you'll have built a small parser library from scratch and used it to read a number out of a string.

> **The one move to learn here:** stop thinking of parsing as "scan the whole string and figure it out." Think of it as "a function that nibbles the front off the input and tells me what it found." Once a parser is just a function returning *(value, leftovers)*, you can combine those functions endlessly.

---

## Prerequisites

- **Required:** You can read and write functions in at least one language. Examples use Python first (we build a tiny library you can run), then Haskell and JavaScript for flavor.
- **Required:** You're comfortable with functions that *return other functions*, or at least won't panic when you see one. See [First-Class & Higher-Order Functions](../01-first-class-and-higher-order-functions/junior.md).
- **Helpful:** You've used `map` on a list (`[len(w) for w in words]`). The parser `map` is the exact same idea. See [Map / Filter / Reduce](../04-map-filter-reduce/junior.md).
- **Helpful:** You've felt the pain of a regex that started simple and became an unreadable monster, or a hand-written parsing loop that turned into a nest of flags. That pain is what combinators relieve.

---

## Glossary

| Term | Plain-English meaning |
|------|----------------------|
| **Parser** | A function that takes input text and returns either *"success: here's a value and the leftover text"* or *"failure: I couldn't parse that."* |
| **Input** | The text we're trying to parse. As we consume it, the "leftover" shrinks. |
| **Result** | What a parser hands back: on success, a **value** plus the **remaining** unparsed text; on failure, an error. |
| **Combinator** | A function that takes parsers and returns a new parser. The glue. |
| **Primitive parser** | A tiny built-in parser like "match one specific character." The atoms you build everything else from. |
| **Consume** | To use up part of the input. A parser that matches `"abc"` *consumes* three characters. |
| **`map`** | Transform the *value* a parser produced without changing what it matches (e.g. turn the matched text `"42"` into the number `42`). |
| **`andThen` / sequence** | Run one parser, then another, on what's left; combine their results. |
| **`or` / choice** | Try one parser; if it fails, try a different one on the original input. |
| **`many`** | Run a parser over and over until it stops matching; collect all the values. |

---

## The One Big Idea: A Parser Is a Function

Let's make the definition concrete. In Python, we'll say a parser is a function that takes a string and returns one of two things:

- **Success:** a little record holding the **value** we parsed and the **remaining** string.
- **Failure:** something that says "nope."

We'll use a tiny class for the success case and `None` for failure, to keep things simple:

```python
# Python — the entire foundation. A parser is a function: str -> (Success | None).
from dataclasses import dataclass
from typing import Any, Callable, Optional

@dataclass
class Success:
    value: Any      # what we parsed
    rest: str       # the input we have NOT consumed yet

# A "Parser" is just any function with this shape:
#   Callable[[str], Optional[Success]]
# Returns a Success on a match, or None when it can't parse the front of the input.
Parser = Callable[[str], Optional[Success]]
```

Read that twice, because it's the whole topic. A parser is **not** an object with methods you configure. It is a plain function `input -> maybe (value, leftover)`. Everything else — every fancy combinator — is just a way to build a new function of this shape out of existing ones.

> **Why "value plus leftover"?** Because parsers run *in sequence*. After one parser eats the first three characters, the next parser needs to start where the first one stopped. Returning the leftover text is how each parser tells the next one "here's where I left off." This little detail is what makes parsers *composable* — it's the thread that lets you stitch them together.

```
  Input:  "42 cats"
            │
            ▼
  ┌──────────────────────┐
  │  numberParser        │   a function: str -> (value, rest)
  └──────────────────────┘
            │
            ▼
  Success(value=42, rest=" cats")
            ▲          ▲
        what we got   what's left for the next parser
```

---

## Our First Parsers: `char` and `satisfy`

The smallest useful parser matches **one specific character**. We'll write `char(c)`: a function that *makes* a parser which succeeds only if the input starts with the character `c`.

```python
# Python — char(c) BUILDS a parser that matches exactly the character c.
def char(c: str) -> Parser:
    def parser(inp: str) -> Optional[Success]:
        if inp and inp[0] == c:
            return Success(value=c, rest=inp[1:])   # consumed one char
        return None                                 # didn't match → failure
    return parser

# Use it:
parse_a = char("a")
print(parse_a("apple"))   # Success(value='a', rest='pple')
print(parse_a("banana"))  # None  — input didn't start with 'a'
```

Notice `char` is a function that *returns a function*. `char("a")` gives you back a parser; that parser is then called with input. This "function that builds a parser" pattern is everywhere in this topic — keep an eye out for it.

`char` is a special case of a more general and more useful primitive: `satisfy(predicate)`, which matches one character *if it passes a test*. This lets us say "any digit" or "any letter" instead of one specific character.

```python
# Python — satisfy(test) matches ONE char that passes the test function.
def satisfy(test: Callable[[str], bool]) -> Parser:
    def parser(inp: str) -> Optional[Success]:
        if inp and test(inp[0]):
            return Success(value=inp[0], rest=inp[1:])
        return None
    return parser

digit  = satisfy(str.isdigit)   # matches one digit character
letter = satisfy(str.isalpha)   # matches one letter

print(digit("7up"))     # Success(value='7', rest='up')
print(digit("up7"))     # None  — 'u' is not a digit
print(letter("up7"))    # Success(value='u', rest='p7')
```

With `char` and `satisfy` we have our **atoms**. They each consume at most one character. On their own they're nearly useless — you can't parse much with "match one digit." The power comes from *combining* them, which is the rest of the story.

---

## Combining Parsers: the Four Moves

There are four fundamental ways to combine parsers. Learn these four and you can parse almost anything. Each one is a **combinator**: a function that takes parser(s) and returns a new parser.

### `map` — change the value you got

A parser hands back a *value*. Often that value isn't quite what you want — you matched the *character* `'7'` but you want the *number* `7`. `map` lets you transform the value a parser produces, **without changing what the parser matches**.

```python
# Python — map_p runs a parser, then applies f to whatever value it produced.
def map_p(parser: Parser, f: Callable[[Any], Any]) -> Parser:
    def new_parser(inp: str) -> Optional[Success]:
        result = parser(inp)
        if result is None:
            return None                          # failure passes through unchanged
        return Success(value=f(result.value), rest=result.rest)
    return new_parser

# Turn the matched digit CHARACTER into an integer:
digit_value = map_p(digit, int)
print(digit_value("7up"))   # Success(value=7, rest='up')   ← 7 the int, not '7' the char
```

This is *the same `map`* you know from lists and from [Map / Filter / Reduce](../04-map-filter-reduce/junior.md). On a list, `map` transforms each element. On a parser, `map` transforms the value the parser produced. Same name, same idea, different container.

### `andThen` — one parser after another

To parse `"ab"`, we run a parser for `'a'`, **then** a parser for `'b'` on whatever's left. `andThen` sequences two parsers: it runs the first, and if it succeeds, runs the second on the *remaining* input.

```python
# Python — andThen runs p1, then p2 on the leftover. Returns BOTH values as a pair.
def and_then(p1: Parser, p2: Parser) -> Parser:
    def new_parser(inp: str) -> Optional[Success]:
        r1 = p1(inp)
        if r1 is None:
            return None                          # first parser failed → whole thing fails
        r2 = p2(r1.rest)                         # run p2 on what p1 left behind
        if r2 is None:
            return None
        return Success(value=(r1.value, r2.value), rest=r2.rest)
    return new_parser

ab = and_then(char("a"), char("b"))
print(ab("abc"))   # Success(value=('a', 'b'), rest='c')
print(ab("axc"))   # None — second parser wanted 'b' but found 'x'
```

The key move is `p2(r1.rest)`: the second parser starts *where the first one stopped*. That "pass the leftovers along" is exactly why we made parsers return their remaining input. Sequencing is impossible without it.

### `or` — try this, or else that

To parse "a digit **or** a letter," we try one parser; if it fails, we try another *on the original input* (not the leftovers — the first one consumed nothing useful, so we start over).

```python
# Python — or_p tries p1; if it fails, tries p2 on the SAME original input.
def or_p(p1: Parser, p2: Parser) -> Parser:
    def new_parser(inp: str) -> Optional[Success]:
        r1 = p1(inp)
        if r1 is not None:
            return r1                            # p1 succeeded → use it
        return p2(inp)                           # p1 failed → try p2 from the start
    return new_parser

digit_or_letter = or_p(digit, letter)
print(digit_or_letter("7up"))   # Success(value='7', rest='up')
print(digit_or_letter("up7"))   # Success(value='u', rest='p7')
print(digit_or_letter("$$$"))   # None — neither matched
```

`or` is how you express *choice*: "this format, or that format." It's the parsing version of an `if/else`, but built out of parsers instead of conditions.

### `many` — zero or more of the same thing

A digit is one character. A *number* is one or more digits in a row. `many` runs a parser repeatedly until it stops matching, collecting all the values into a list. It **never fails** — if the parser matches zero times, `many` just returns an empty list.

```python
# Python — many runs `parser` over and over, collecting values, until it stops matching.
def many(parser: Parser) -> Parser:
    def new_parser(inp: str) -> Optional[Success]:
        values = []
        rest = inp
        while True:
            r = parser(rest)
            if r is None:
                break                            # parser stopped matching → done
            values.append(r.value)
            rest = r.rest                        # advance past what we just consumed
        return Success(value=values, rest=rest)  # always succeeds (maybe with [])
    return new_parser

digits = many(digit)
print(digits("123abc"))   # Success(value=['1','2','3'], rest='abc')
print(digits("abc"))      # Success(value=[], rest='abc')  — zero matches, still a success
```

`many` is the workhorse for *repetition*: many digits, many list items, many lines. Almost every real parser uses it.

---

## Building Up: Parsing a Number

Now we combine all four moves to do something genuinely useful: parse a non-empty run of digits into an integer. This is the moment combinators pay off — watch how we build a real parser purely by gluing the small ones together.

```python
# Python — a NUMBER parser, built entirely from the pieces above.

# Step 1: one or more digits. `many(digit)` allows zero, but a number needs ≥1.
#         We sequence "one digit" andThen "many more digits", then glue them.
def one_or_more(parser: Parser) -> Parser:
    # at least one match, then as many more as possible
    combined = and_then(parser, many(parser))
    # combined gives (first, [rest...]); flatten into one list with map:
    return map_p(combined, lambda pair: [pair[0]] + pair[1])

# Step 2: a run of digit CHARACTERS, e.g. ['1','2','3']
digit_run = one_or_more(digit)

# Step 3: join those characters and turn them into an int — that's a `map`.
number = map_p(digit_run, lambda chars: int("".join(chars)))

print(number("123abc"))   # Success(value=123, rest='abc')   ← the integer 123
print(number("42"))       # Success(value=42,  rest='')
print(number("abc"))      # None — needs at least one digit
```

Look at what just happened. We never wrote a loop that scans characters and tracks state and handles edge cases. We described a number *declaratively*: "one or more digits, joined and converted to an int." Each piece — `digit`, `one_or_more`, `map_p` — is independently understandable and testable. And the moment we need something more complex (a decimal point? a minus sign?), we *add another combinator* rather than rewrite the loop.

That last sentence is the whole pitch. Here's "an optional minus sign, then a number," added without touching anything we already wrote:

```python
# Python — extend with a minus sign, by composition. Nothing above changes.
def optional(parser: Parser, default=None) -> Parser:
    # try the parser; if it fails, succeed with `default` and consume nothing
    return or_p(parser, lambda inp: Success(value=default, rest=inp))

minus = char("-")
signed_number = map_p(
    and_then(optional(minus, default=""), number),
    lambda pair: -pair[1] if pair[0] == "-" else pair[1]
)

print(signed_number("-7xyz"))   # Success(value=-7, rest='xyz')
print(signed_number("7xyz"))    # Success(value=7,  rest='xyz')
```

We grew the parser by *adding*, never by *editing*. That's the property that makes combinators scale to real grammars.

---

## A Taste of the Real Thing: Haskell and JavaScript

You won't usually hand-roll the library — mature ones exist in every language. The names differ but the *shape* is identical to what we just built. A 20-second look at two so the idea sticks.

In **Haskell**, the famous library is `parsec` (or its modern cousin `megaparsec`). Our number parser looks like this:

```haskell
-- Haskell (megaparsec) — the SAME number parser, in the idiomatic library.
-- `many1 digitChar` is our one_or_more(digit); `read` is the int conversion (our map).
import Text.Megaparsec
import Text.Megaparsec.Char (digitChar)

number :: Parser Int
number = read <$> some digitChar
--       ^^^^   ^^^^ ^^^^^^^^^^^^
--       map    (    one-or-more digits   )
--   `<$>` is map; `some` is one-or-more; the result is an Int
```

`<$>` is `map`. `some` is "one or more." It reads as "map `read` over one-or-more digit characters" — exactly our `number`, just shorter because the library ships the combinators.

In **JavaScript**, the popular library is `parsimmon`:

```javascript
// JavaScript (Parsimmon) — same parser again. `.map` is our map_p,
// `digit.atLeast(1)` is one_or_more(digit), `.tie()` joins the chars.
import P from "parsimmon";

const number = P.digit              // a parser that matches one digit
  .atLeast(1)                       // one or more  → array of digit chars
  .tie()                            // join them into a string "123"
  .map(Number);                     // map: string → number 123

number.parse("123");   // { status: true, value: 123 }
```

Three libraries, three languages, one idea: **small parsers, combined**. Once you've built the tiny version yourself, every real library is just "the same thing, with more combinators and nicer names."

---

## Why This Is Nice

Step back and compare the combinator approach to the two things you'd reach for today.

**Versus a regex.** A regex like `-?\d+` is great for "a signed integer" and unbeatable for one-line patterns. But regexes can't *return structured values* — they give you matched strings, and you re-parse those by hand. And the moment your format *nests* (parentheses inside parentheses, lists of objects), regexes hit a wall: they fundamentally can't count balanced brackets. Combinators return real values and handle nesting naturally (a parser can call itself).

**Versus a hand-written loop.** A loop with an index and a pile of flags works, but it grows into a tangle where the parsing logic and the bookkeeping (where am I? what state am I in?) are hopelessly mixed. With combinators, the bookkeeping (passing leftovers along, short-circuiting on failure) lives *inside the combinators, written once*. Your code expresses only the *structure* of the thing you're parsing.

The concrete wins for you, today:

1. **Parsers are values you build, not loops you write.** You describe *what* the format is; the combinators handle *how* to walk the input.
2. **You grow a parser by adding, not editing.** Need to handle a new case? Add an `or`. Need optional parts? Wrap in `optional`. The existing parser is untouched.
3. **Every piece is testable in isolation.** `digit`, `number`, `signed_number` — each is a function you can call on a string and check. No setup, no fixtures.
4. **The same four moves cover everything.** `map`, `andThen`, `or`, `many`. Learn them once; they parse numbers, dates, JSON, and programming languages.

> **One honest caveat:** for a genuine one-off — "split this comma-separated line" — a `split(",")` or a small regex is the right tool, and reaching for a parser library would be overkill. Combinators earn their keep when the format has *structure*: nesting, choices, repetition, the need to produce real objects. We'll sharpen exactly when to use which at the higher levels.

---

## Common Mistakes

1. **Forgetting that a parser returns the *leftover* input.** A parser doesn't return just a value — it returns the value *and the rest of the string*. If you ignore the leftover, you can't sequence parsers, and sequencing is the whole point.
2. **Using `map` when you mean `andThen`.** `map` changes the *value* a single parser produced; it does **not** run a second parser. To run parser B after parser A, you need `andThen` (sequencing), not `map`.
3. **Expecting `or` to start the second parser from where the first stopped.** `or` tries the alternative on the *original* input, because the first attempt failed and shouldn't have consumed anything you keep. (Real libraries get subtle here — that's a senior topic — but the mental model is "start over.")
4. **Thinking `many` can fail.** `many` matches *zero or more*, so it always succeeds — possibly with an empty list. If you need *at least one*, use `one_or_more` (a.k.a. `many1`/`some`).
5. **Trying to parse nested formats with a regex.** Balanced brackets, nested JSON, arithmetic with parentheses — regexes can't do these in general. This is precisely where combinators (which can recurse) shine.
6. **Reaching for a parser library for a trivial split.** For "one comma-separated line, no nesting," `split(",")` wins. Combinators are for *structured* input; don't bring the cannon to swat a fly.

---

## Test Yourself

1. In one sentence: what does a parser function take in, and what does it return on success?
2. Why must a successful parser return the *leftover* (unconsumed) input, not just the value it parsed?
3. You have a parser `digit` that matches one digit. Which combinator turns the matched character `'5'` into the integer `5` — `map`, `andThen`, `or`, or `many`?
4. To parse the literal text `"ok"` (an `'o'` then a `'k'`), which combinator do you use to run the `'o'` parser and the `'k'` parser one after the other?
5. `digit_or_letter = or_p(digit, letter)`. What does it produce for input `"7a"`? For `"a7"`? For `"$"`?
6. True or false: `many(digit)` applied to `"abc"` fails because there are no digits. Explain.
7. Why can a parser combinator parse nested parentheses `((()))` while a basic regex cannot?

<details>
<summary>Answers</summary>

1. A parser takes the **input text**; on success it returns the **value it parsed** plus the **remaining unconsumed text**. (On failure it returns an error / `None`.)
2. Because parsers run *in sequence*: the next parser must start where the previous one stopped. The leftover string is how each parser tells the next one "here's where I left off." Without it, you can't chain parsers together.
3. **`map`.** It transforms the value a parser produced (`'5'` → `5`) without changing what the parser matches.
4. **`andThen`** (sequencing). It runs the first parser, then runs the second on the leftover, and combines their results.
5. `"7a"` → `Success('7', rest='a')` (digit matched). `"a7"` → `Success('a', rest='7')` (digit failed, letter matched). `"$"` → `None` (neither matched).
6. **False.** `many` matches *zero or more*, so it always succeeds — here it succeeds with an **empty list** `[]` and leaves `"abc"` as leftover. Only `one_or_more`/`many1` would fail on zero matches.
7. A combinator parser can **call itself** (recursion): "a parenthesized group is `'('` then *another parenthesized group* then `')'`." That self-reference lets it match arbitrarily deep nesting. A basic regex has no way to count balanced brackets — it can't recurse, so it can't match nesting of arbitrary depth.

</details>

---

## Cheat Sheet

| Concept | What it is |
|---|---|
| **Parser** | A function `input -> (value, leftover)` on success, or failure. |
| **`char(c)`** | Primitive: match exactly the character `c`. |
| **`satisfy(test)`** | Primitive: match one character that passes `test` (e.g. `isdigit`). |
| **`map(p, f)`** | Transform the *value* `p` produced; don't change what it matches. |
| **`andThen(p1, p2)`** | Run `p1`, then `p2` on the leftover; combine both values. |
| **`or(p1, p2)`** | Try `p1`; if it fails, try `p2` on the original input. |
| **`many(p)`** | Run `p` zero-or-more times; collect values; never fails. |
| **`one_or_more(p)`** | Like `many`, but requires at least one match (`many1`/`some`). |
| **`optional(p)`** | Try `p`; if it fails, succeed with a default and consume nothing. |

| You want to… | Reach for |
|---|---|
| Change the parsed value (`'7'` → `7`) | `map` |
| Match A then B in sequence | `andThen` |
| Match A or else B | `or` |
| Match something repeatedly | `many` / `one_or_more` |
| Make a part optional | `optional` |

> **The one rule:** a parser is just a function `input → (value, leftover)`. Everything else is gluing those functions together with `map`, `andThen`, `or`, and `many`.

---

## Summary

- A **parser** is a plain function: it takes input text and returns a **value plus the leftover text** on success, or a failure. That definition — `input -> (value, rest)` — is the entire foundation of the topic.
- A **parser combinator** is a function that takes parsers and returns a bigger parser. You build complex parsers by **gluing small ones together**, not by writing a single big loop.
- The **four moves** are `map` (transform the value), `andThen` (sequence two parsers), `or` (choose between parsers), and `many` (repeat a parser). With these you parsed a real number from scratch.
- The leftover-text return value is the secret sauce: it's what lets one parser hand off to the next, making parsers *composable*.
- You **grow** a parser by *adding* combinators (a minus sign, an optional part), never by rewriting — and each piece stays independently testable.
- Real libraries (`parsec`/`megaparsec` in Haskell, `parsimmon` in JS, `parsy`/`pyparsing` in Python) are *the same idea* with more combinators and friendlier names.
- Use combinators when the format has **structure** (nesting, choices, repetition, real output values); use a `split` or regex for trivial one-offs. Next: [`middle.md`](middle.md) builds the full combinator set and parses arithmetic with operator precedence.

---

## Further Reading

- **"Functional Pearls: Monadic Parsing in Haskell"** — Graham Hutton & Erik Meijer (1998) — the classic, readable paper that builds exactly this library from scratch; the source of the modern style.
- **Parsimmon documentation** (JavaScript) — a gentle, example-first tour of combinators in a language you may already know.
- **"Understanding Parser Combinators"** — Scott Wlaschin (fsharpforfunandprofit.com) — a beautifully paced from-scratch build-up in F#, very close in spirit to this file.
- **parsy documentation** (Python) — a small, clean combinator library; reading its tutorial reinforces the four moves with runnable code.

---

## Related Topics

- [First-Class & Higher-Order Functions](../01-first-class-and-higher-order-functions/junior.md) — parsers *are* functions, and combinators are functions that take and return functions.
- [Map / Filter / Reduce](../04-map-filter-reduce/junior.md) — the parser `map` is the same `map` you already know from lists.
- [Composition](../05-composition/junior.md) — combinators are how you compose parsers into bigger parsers.
- [Algebraic Data Types](../06-algebraic-data-types/junior.md) — the structured values (the AST) your parser produces are sum/product types.
- [Recursion & Tail Calls](../08-recursion-and-tail-calls/junior.md) — recursive grammars (nested parentheses, JSON) need a parser that calls itself.
- [Monads — Plain English](../09-monads-plain-english/junior.md) — `map`/`andThen`/`or` are the functor/monad/alternative operations; the same "box and chain" shape powers parsers.
