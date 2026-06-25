# Data Representation & Numerics

Every value your program manipulates is, at the bottom, a finite pattern of bits with an *interpretation* layered on top. This section is about that interpretation: how integers wrap, why `0.1 + 0.2 != 0.3`, what a "string" actually is once you cross an ASCII boundary, and the tricks runtimes use to stuff a 64-bit float, a pointer, and a small integer into the same machine word.

> *"There are only two hard problems in computer science: cache invalidation, naming things, and off-by-one errors."* — and at least one and a half of those live here.

The unifying theme: **the map is not the territory.** A `float` is not a real number, an `int` is not an integer, and a `String` is not a sequence of characters in any naïve sense. Senior engineers are the ones who know exactly where each abstraction leaks — and that knowledge is the difference between a financial system that balances to the penny and one that quietly loses money in the fifth decimal place.

---

## Why this matters

Bugs that originate here are the worst kind: they are silent, data-dependent, and survive every code review that doesn't specifically look for them.

- An integer overflow turned a 32-bit counter negative and grounded a fleet of aircraft (the Boeing 787 GCU 248-day bug).
- A floating-point rounding error in the Patriot missile system caused a tracking failure that cost 28 lives.
- A mishandled Unicode normalization let attackers smuggle `admin` past a username filter.
- An endianness mismatch corrupted every multi-byte field crossing a network boundary.

None of these are exotic. They are the everyday physics of how data is stored, and they bite hardest the moment your data leaves the cozy world of a single language's defaults.

---

## The topics

| # | Topic | The question it answers |
|---|---|---|
| 01 | [Integer Representation & Overflow](01-integer-representation-and-overflow/) | How are signed/unsigned integers stored, and what happens at the boundaries? |
| 02 | [Floating-Point (IEEE 754)](02-floating-point-ieee-754/) | Why is floating-point "wrong," and how is it actually defined? |
| 03 | [Fixed-Point & Arbitrary Precision](03-fixed-point-and-arbitrary-precision/) | What do you reach for when `float` isn't exact enough — money, crypto, bignums? |
| 04 | [Endianness & Byte Order](04-endianness-and-byte-order/) | In what order do bytes hit memory and the wire, and when does it bite? |
| 05 | [Character & String Internals (Unicode)](05-character-and-string-internals-unicode/) | What is a "character," and what is a string *really* made of? |
| 06 | [Boxing, Tagging & NaN-Boxing](06-boxing-tagging-and-nan-boxing/) | How do dynamic runtimes pack a type tag and a value into one word? |

---

## How to read this section

Read **01** and **02** first — integer and floating-point representation are the bedrock everything else builds on, and the overflow/rounding intuitions transfer everywhere. **03** is the practical "so what do I use instead" follow-up for money and big numbers. **04** (endianness) is short and mostly matters at I/O boundaries; read it when you next touch a binary protocol or file format. **05** (Unicode) is deep and unavoidable the moment you handle real-world text. **06** (boxing/tagging) is the most "internals" of the set — it explains how V8, the JVM, LuaJIT, and CPython actually represent values, and it ties the integer and float material back together.

Each topic ships the standard five-tier set — `junior` → `middle` → `senior` → `professional` — plus an `interview` question bank and a `tasks` workbook.

---

## Related sections

- **[Memory Management](../memory-management/)** — boxing and tagging are fundamentally about where a value lives (stack word vs. heap object) and who owns it.
- **[Runtime Systems](../runtime-systems/)** — the object model and value representation are two halves of the same story.
- **[Compilers & Interpreters](../compilers-and-interpreters/)** — constant folding, overflow checks, and `NaN` handling are all things the compiler must reason about.
- **[Concurrency, Async & Parallel](../concurrency-async-parallel/)** — atomicity of multi-word values and the memory model both assume a representation.
