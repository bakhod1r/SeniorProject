# Character & String Internals (Unicode) — Junior Level

> **Topic:** [Character & String Internals (Unicode)](README.md)
> **Focus:** A string is not a sequence of letters. It is a sequence of bytes that *pretends* to be letters. Learn the four layers between "the bytes on disk" and "the smiley face you see."

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
13. [Summary](#summary)

---

## Introduction

> Focus: **What is a string actually made of, and why does `"😀".length` sometimes say `2`?**

You have used strings since your very first `Hello, world`. You think you know what a string is: a sequence of characters, where each character is a letter, digit, space, or punctuation mark. That mental model is wrong, and it is wrong in a way that will eventually corrupt someone's name, break a search box, or crash an app.

Here is the truth. A string, at the machine level, is **a sequence of bytes**. A byte is a number from 0 to 255. By itself a byte means nothing — `0x41` is just the number 65. To turn bytes into text you need an **encoding**: an agreed-upon rule that says "byte 65 means the letter `A`." For decades there were dozens of incompatible encodings, and sending text from one computer to another was a gamble. Then the world (mostly) agreed on **Unicode**, a single gigantic catalogue that assigns a number — a **code point** — to every character humanity uses, from `A` to `あ` to `😀` to ancient Egyptian hieroglyphs. And it agreed on **UTF-8**, a way to pack those code points into bytes.

The single most important idea on this page is that there are **four different layers**, and confusing them is the root of almost every text bug:

1. **Bytes** — raw 8-bit numbers. What is on disk, in a file, on the network.
2. **Code units** — the chunks an encoding works in (1 byte for UTF-8, 2 bytes for UTF-16).
3. **Code points** — the Unicode number for one character (`U+0041` for `A`, `U+1F600` for 😀).
4. **Grapheme clusters** — what a *human* calls "one character" on screen (the family emoji 👨‍👩‍👧‍👦 is *one* of these but several code points).

> 🎓 **Why this matters for a junior:** The moment your app handles a name with an accent, a Japanese username, or an emoji, the gap between these four layers becomes real. `len(string)` gives you a different answer at each layer. If you pick the wrong one, you truncate a name in the middle of a letter, you reverse a string and turn 😀 into garbage, or you tell a user their password is "too long" when it is six emoji. Getting this right in your first year separates engineers who ship correct software from those who ship "works on my machine (with ASCII)."

This page covers the four layers, what ASCII and Unicode are, why UTF-8 won, and how to *not* break text in five languages. The next level (`middle.md`) goes deep on UTF-8/UTF-16 byte mechanics and surrogate pairs; `senior.md` covers normalization, case folding, and collation; `professional.md` covers string storage internals and security attacks.

---

## Prerequisites

What you should know before reading this:

- **Required:** What a byte is (an 8-bit number, 0–255) and that everything in a computer is ultimately bytes.
- **Required:** How to write and run a simple program in at least one language (Java, Python, Go, JavaScript, or Rust).
- **Required:** Basic familiarity with `length`/`len` on a string and indexing like `s[0]`.
- **Helpful but not required:** Having seen hexadecimal (`0x41` = 65).
- **Helpful but not required:** Having once seen a "weird character" like `Ã©` appear where `é` should be — that is mojibake, and you will learn why.

You do **not** need to know:

- The exact bit layout of UTF-8 (that is `middle.md`).
- Normalization forms NFC/NFD or case folding (that is `senior.md`).
- How strings are stored in memory by the JVM or Python (that is `professional.md`).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Byte** | An 8-bit number, 0–255. The raw unit of storage. Text on disk is bytes. |
| **Character** | An informal, ambiguous word. Sometimes means a code point, sometimes a grapheme. Avoid it when you want to be precise. |
| **Encoding** | A rule mapping between abstract characters and bytes. UTF-8, UTF-16, ASCII, Windows-1252 are encodings. |
| **ASCII** | The original 7-bit encoding: 128 characters (`A`–`Z`, `a`–`z`, `0`–`9`, punctuation, control codes). Bytes 0–127. |
| **Unicode** | A universal catalogue assigning a unique number (code point) to every character. *Not* an encoding by itself. |
| **Code point** | The Unicode number for one abstract character. Written `U+` then hex: `U+0041` is `A`, `U+1F600` is 😀. Range: `U+0000` to `U+10FFFF`. |
| **Code unit** | The fixed-size chunk an encoding processes. 8 bits in UTF-8, 16 bits in UTF-16. One code point may take several code units. |
| **UTF-8** | The dominant encoding. Variable width: 1 to 4 bytes per code point. ASCII bytes are unchanged. |
| **UTF-16** | An encoding using 16-bit code units. Used internally by Java, JavaScript, C#, Windows. |
| **Grapheme cluster** | What a human perceives as a single character on screen. May be many code points (e.g. é written as `e` + combining accent). |
| **Glyph** | The actual visual shape a font draws for a grapheme. The font's job, not the encoding's. |
| **Mojibake** | Garbled text from decoding bytes with the wrong encoding. `café` becoming `cafÃ©`. |
| **Rune** | Go's name for a code point (a 32-bit value). |
| **Surrogate pair** | Two UTF-16 code units used together to encode one code point above `U+FFFF` (like an emoji). |

---

## Core Concepts

### 1. Bytes are not text — an encoding is required

When you save the word `café` to a file, the file contains bytes. *Which* bytes depends on the encoding:

```
"café" in UTF-8:          63 61 66 C3 A9       (5 bytes — é is two bytes)
"café" in Latin-1:        63 61 66 E9          (4 bytes — é is one byte)
"café" in UTF-16LE:       63 00 61 00 66 00 E9 00   (8 bytes — 2 per char)
```

The same word, three different byte sequences. If you write the file as UTF-8 and someone reads it as Latin-1, they see garbage. **There is no such thing as "plain text."** Every text has an encoding, even when nobody told you what it is. The famous rule from Joel Spolsky: *it does not make sense to have a string without knowing what encoding it uses.*

### 2. The four layers

Take the family emoji, 👨‍👩‍👧‍👦. Let us count it at each layer (in UTF-8):

| Layer | What it counts | Count for 👨‍👩‍👧‍👦 |
|-------|----------------|---------------------|
| **Bytes** | Raw 8-bit numbers | 25 |
| **Code units** (UTF-8) | 1-byte chunks (same as bytes here) | 25 |
| **Code points** | Unicode numbers | 7 (four people + three "joiners") |
| **Grapheme clusters** | What a human sees | **1** |

One emoji. Seven code points. Twenty-five bytes. A human sees *one* character. When you ask `length`, the answer depends entirely on which layer your language counts, and most languages count code units — the *least* human-meaningful layer.

### 3. ASCII: the 128-character ancestor

ASCII (1963) used 7 bits, giving 128 codes:
- 0–31: control characters (newline = 10, tab = 9, etc.)
- 32–126: printable (`space` = 32, `A` = 65, `a` = 97, `0` = 48)
- 127: delete

ASCII covers English and nothing else. No `é`, no `ñ`, no `日本語`. A byte has 8 bits, so 128 more values (128–255) sat unused — and *everyone* used them differently. That is where mojibake comes from.

### 4. The mojibake era: legacy encodings

Before Unicode, every region invented its own way to use bytes 128–255:
- **Latin-1 / ISO-8859-1**: Western European (`é`, `ñ`, `ü`).
- **Windows-1252**: Microsoft's near-clone of Latin-1 with curly quotes and the € sign.
- **ISO-8859-5**: Cyrillic. **ISO-8859-7**: Greek.
- **Shift-JIS, EUC-JP**: Japanese (used *two* bytes per character — already breaking the "one byte one char" idea).

The same byte `0xE9` was `é` in Latin-1, `щ` in one Cyrillic encoding, and part of a kanji in Shift-JIS. Email and web pages constantly displayed garbage because the sender's encoding and the reader's encoding disagreed. This chaos is *why* Unicode exists.

### 5. Unicode: one catalogue for everything

Unicode does **one job**: it assigns every character a unique number, the code point. It does not say how to store them in bytes — that is the encoding's job. Unicode has room for `U+0000` to `U+10FFFF` (about 1.1 million slots), organized into **17 planes** of 65,536 each. The first plane, the **Basic Multilingual Plane (BMP)**, holds almost everything you use daily (Latin, Cyrillic, CJK, Greek). Characters above `U+FFFF` — emoji, rare CJK, ancient scripts — live in the **astral planes** (also called supplementary planes), and they are exactly the ones that break naive code.

### 6. UTF-8: why it won

UTF-8 encodes each code point in 1 to 4 bytes:
- 1 byte for ASCII (`U+0000`–`U+007F`) — **identical to ASCII**.
- 2 bytes for Latin accents, Greek, Cyrillic, Hebrew, Arabic.
- 3 bytes for most CJK (Chinese, Japanese, Korean).
- 4 bytes for emoji and astral characters.

UTF-8 won the web (over 98% of pages) because:
- **It is backward-compatible with ASCII** — old English text is already valid UTF-8.
- **It has no byte-order problem** (UTF-16 does; see `middle.md`).
- **It is self-synchronizing** — if you land in the middle of a file you can find the next character boundary easily.
- **It is compact for English/Western text.**

The practical advice for a junior: **use UTF-8 everywhere** — files, APIs, databases, source code — unless something forces you otherwise.

---

## Real-World Analogies

**The shipping container.** Bytes are like the contents of a shipping container: just stuff. The encoding is the customs manifest that says what the stuff *means*. Hand the wrong manifest to the wrong port and they unpack your electronics thinking they are bananas. That is mojibake.

**The phone-number directory.** Unicode is a giant phone book that gives every person (character) a unique number (code point). It does *not* tell you how to dial — that is the encoding. UTF-8 and UTF-16 are two different dialing plans for the same phone book.

**LEGO bricks.** A grapheme cluster is like a LEGO spaceship a child calls "one ship." It is built from many bricks (code points). If you grab it by one brick and pull, it falls apart. That is what happens when you reverse 👨‍👩‍👧‍👦 brick-by-brick: you get a pile of disconnected pieces, not a mirrored ship.

**Accent stickers.** The accented `é` can be made two ways: a pre-printed `é` stamp (one code point, `U+00E9`), or a plain `e` with an accent sticker placed on top (two code points, `e` + `U+0301`). They look identical on screen but are different byte sequences — which is why "search for café" can fail to find a café spelled the other way. (Fixing this is *normalization*, covered in `senior.md`.)

---

## Mental Models

**Model 1: A string is bytes wearing a costume.** Never forget the bytes are underneath. When something goes wrong with text, drop down a layer and look at the actual bytes. Tools: `hexdump`, `s.encode('utf-8')` in Python, `[]byte(s)` in Go.

**Model 2: The ladder of layers.** Bytes → code units → code points → graphemes → glyphs. Each rung is *more* human and *less* machine. When a library gives you a "length" or lets you index, the first question is always: **which rung am I on?** Most languages put you on the code-unit rung whether you like it or not.

**Model 3: ASCII is a happy lie.** As long as your data is pure ASCII, all four layers collapse into one: 1 byte = 1 code unit = 1 code point = 1 grapheme. Every bug on this page is invisible. This is why text bugs "work on my machine" — the developer tested with English. The lie breaks the instant a real user types `Müller`, `田中`, or `🎉`.

**Model 4: Length is a question, not a fact.** "How long is this string?" has at least four valid answers. "How long" for a database column limit (bytes), for a UI character count (graphemes), for a JSON serializer (code units), and for an algorithm (code points) are all different. Pick deliberately.

---

## Code Examples

### The "length is a lie" demo across five languages

Take the string `"a😀b"`: one ASCII letter, one astral emoji, one ASCII letter. It is **3 code points** and a human sees **3 characters**.

**JavaScript** (UTF-16 internally — counts code units):

```javascript
const s = "a😀b";
console.log(s.length);              // 4  ← WRONG for humans (😀 = 2 UTF-16 units)
console.log([...s].length);         // 3  ← spread iterates code points
console.log(s[1]);                  // "\uD83D"  ← half an emoji! a lone surrogate
console.log([...s][1]);             // "😀"       ← correct
console.log(s.codePointAt(1).toString(16)); // 1f600
```

**Java** (UTF-16 internally — `char` is a 16-bit code unit):

```java
String s = "a😀b";
System.out.println(s.length());                  // 4  ← counts UTF-16 code units
System.out.println(s.codePointCount(0, s.length())); // 3  ← counts code points
System.out.println((int) s.charAt(1));           // 55357 ← a surrogate, NOT 😀
s.chars().forEach(c -> System.out.print(c + " ")); // wrong: 97 55357 56832 98
s.codePoints().forEach(c -> System.out.print(c + " ")); // right: 97 128512 98
```

**Go** (bytes internally, but `range` decodes UTF-8 into runes):

```go
s := "a😀b"
fmt.Println(len(s))                 // 7  ← BYTES (😀 = 4 bytes in UTF-8)
fmt.Println(utf8.RuneCountInString(s)) // 3  ← code points
fmt.Println(s[1])                   // 240 ← a raw byte, not a character
for i, r := range s {               // range gives (byteIndex, rune)
    fmt.Printf("%d:%c ", i, r)      // 0:a 1:😀 5:b  ← note indices skip
}
```

**Python 3** (`str` is a sequence of code points — the friendliest model):

```python
s = "a😀b"
print(len(s))           # 3  ← code points. Python str hides bytes from you.
print(s[1])             # 😀  ← one full code point
print(ord(s[1]))        # 128512 = 0x1F600
print(len(s.encode("utf-8")))  # 6  ← bytes, only when you ask
```

**Rust** (`String` is UTF-8 bytes; `.chars()` gives code points):

```rust
let s = "a😀b";
println!("{}", s.len());                  // 6  ← BYTES (len is byte length)
println!("{}", s.chars().count());        // 3  ← code points (char = code point)
// println!("{}", &s[1..2]);              // PANIC: byte 1 is mid-emoji, not a char boundary
println!("{}", s.chars().nth(1).unwrap()); // 😀
```

**The lesson:** five languages, five different default answers (`4`, `4`, `7`, `3`, `6`) for the *same three-character string*. None of them is "the length" — each measures a different layer. Know which one your language gives you for free.

### Seeing the bytes

```python
# Python: prove that an encoding is a choice
text = "café"
print(text.encode("utf-8"))    # b'caf\xc3\xa9'   (é = 2 bytes: c3 a9)
print(text.encode("latin-1"))  # b'caf\xe9'       (é = 1 byte: e9)
print(text.encode("utf-16le")) # b'c\x00a\x00f\x00\xe9\x00'

# Decode the UTF-8 bytes as Latin-1 to manufacture mojibake:
b = text.encode("utf-8")
print(b.decode("latin-1"))     # 'cafÃ©'  ← the classic garble
```

### Safely truncating to N characters (not N bytes)

A database column is `VARCHAR(20)` and you naively cut the string to 20 *bytes*. If byte 20 lands in the middle of a multi-byte character, you write half a character.

```python
# Python: truncate by code points (safe), not bytes
def truncate_chars(s, n):
    return s[:n]            # str indexing is by code point — safe here

# But if you must fit BYTES (e.g. a fixed buffer), cut on a boundary:
def truncate_bytes(s, max_bytes):
    b = s.encode("utf-8")[:max_bytes]
    return b.decode("utf-8", errors="ignore")  # drop the broken tail
```

---

## Pros & Cons

**UTF-8**

| Pros | Cons |
|------|------|
| ASCII-compatible; old text just works | Cannot index to the Nth character in O(1) — must scan |
| Compact for English/Western text | CJK text is 3 bytes/char (vs 2 in UTF-16) |
| No byte-order ambiguity | Variable width complicates naive substring code |
| Self-synchronizing; robust to corruption | Byte length ≠ character length, surprising beginners |
| The web standard; universally supported | |

**UTF-16** (Java/JS/Windows)

| Pros | Cons |
|------|------|
| Most BMP characters are exactly 2 bytes | Has surrogate pairs — *still* variable width, despite the myth |
| `char` maps to one code unit cleanly | Byte-order problem (needs a BOM or known endianness) |
| Compact for CJK | Not ASCII-compatible; full of `\x00` bytes |
| | `length` lies for any emoji/astral character |

**The core trade-off:** there is no encoding where "one unit = one human character" for *all* text. Variable-width is unavoidable because human "characters" are not fixed-size. Any model that pretends otherwise (like "a `char` is a character") is a simplification that breaks on emoji.

---

## Use Cases

- **Web forms and APIs:** always UTF-8 in, UTF-8 out. Set `Content-Type: application/json; charset=utf-8`.
- **File I/O:** open files with an explicit encoding (`open(path, encoding="utf-8")` in Python; never rely on the platform default, which differs on Windows).
- **Database columns:** use `utf8mb4` in MySQL (plain `utf8` there is a 3-byte trap that rejects emoji), `UTF8` in PostgreSQL.
- **Username / display-name validation:** count *graphemes* for a "max 20 characters" rule, not code units, or a user with emoji hits the limit early.
- **Search boxes:** normalize before comparing (see `senior.md`) so `café` finds both spellings of `é`.
- **Log files and debugging:** be ready to `hexdump` when text looks wrong — the bytes never lie.

---

## Coding Patterns

**Pattern 1: Decode at the boundary, work in code points, encode at the boundary.** Your program's *inside* should hold decoded text (Python `str`, Go `[]rune` when needed, Java `String`). Bytes appear only at the edges: reading files, network, databases. Decode immediately on the way in, encode at the last moment on the way out. Never let raw bytes leak into business logic.

```python
raw = sock.recv(1024)              # bytes at the boundary
text = raw.decode("utf-8")         # decode immediately
result = process(text)             # work in text
sock.send(result.encode("utf-8"))  # encode at the boundary
```

**Pattern 2: Iterate by the right unit.** When you need "each character," use the code-point iterator your language provides (`for r := range s` in Go, `[...s]` in JS, `s.chars()` in Rust, plain iteration in Python). Never iterate by raw index when the string might be non-ASCII.

**Pattern 3: Specify the encoding, always.** Every `open`, every `decode`, every HTTP header, every DB connection string should name the encoding explicitly. "It defaulted to the right thing on my laptop" is how production breaks.

**Pattern 4: Use a grapheme library for user-facing length.** When you truly need "what a human counts," reach for a grapheme-aware library (`Intl.Segmenter` in JS, `unicode-segmentation` in Rust, ICU in Java) rather than rolling your own.

---

## Best Practices

1. **UTF-8 everywhere by default.** Source files, configs, APIs, storage. Make it boring and consistent.
2. **Never use `string[i]` for non-ASCII iteration.** Indexing addresses code units or bytes, not characters. Use the proper iterator.
3. **Always declare the encoding.** No `open(path)` without `encoding="utf-8"`. No HTTP response without a charset.
4. **Pick your "length" on purpose.** Bytes for storage limits, code points for algorithms, graphemes for UI counts. Comment which one and why.
5. **Use `utf8mb4`, not `utf8`, in MySQL.** The 3-byte `utf8` silently rejects emoji and 4-byte CJK.
6. **Test with non-ASCII fixtures.** Put `Müller`, `日本語`, `😀`, and `👨‍👩‍👧‍👦` in your test data from day one.
7. **Never hand-roll UTF-8/UTF-16 parsing.** The standard library is correct; your loop will have an off-by-one on the surrogate boundary.

---

## Edge Cases & Pitfalls

**The emoji that doubled.** `"😀".length` is `2` in JS and Java because 😀 is one astral code point stored as two UTF-16 code units (a surrogate pair). A character counter that uses `.length` tells the user a single emoji is two characters. Use a code-point or grapheme count.

**Reversing a string corrupts emoji.** The classic "reverse a string" interview answer (`s.split('').reverse().join('')` in JS) splits *between* the two surrogate code units of 😀, swaps them, and produces an invalid lone surrogate — a broken character. Reverse by code point (`[...s].reverse()`) at minimum; by grapheme to also keep family emoji intact.

**Mojibake from a wrong default encoding.** Reading a UTF-8 file as Latin-1 (or the OS default) turns `é` into `Ã©`. The bytes were fine; the *interpretation* was wrong. Always decode with the encoding the data was written in.

**Truncating in the middle of a character.** Cutting a UTF-8 string to N *bytes* can slice a multi-byte character in half, producing an invalid byte sequence that crashes downstream parsers. Cut on a character boundary.

**Indexing a Go or Rust string by byte.** `s[1]` in Go gives a `byte`, not a character. In Rust, slicing `&s[0..2]` *panics* if byte 2 is not a character boundary. These languages expose the byte layer directly — respect it.

**The "café" that won't match "café".** Two strings can look identical but differ in bytes because `é` was written as one code point in one and as `e` + combining accent in the other. String equality fails. This is a normalization problem — see `senior.md`.

**MySQL `utf8` is a lie.** MySQL's `utf8` is actually a maximum-3-byte encoding that cannot store emoji or some CJK. Inserting `😀` silently truncates or errors. The real UTF-8 in MySQL is named `utf8mb4`.

---

## Summary

- A string is **bytes plus an encoding**. There is no plain text.
- There are **four layers**: bytes → code units → code points → grapheme clusters. Confusing them causes nearly every text bug.
- **ASCII** is 128 characters; **Unicode** assigns a code point to every character; **UTF-8** packs code points into 1–4 bytes and is the modern default.
- **Length is ambiguous**: the same string reports `3`, `4`, `6`, or `7` depending on the layer your language counts. Choose deliberately.
- **Emoji and astral characters** (above `U+FFFF`) are where naive code breaks: doubled lengths, corrupted reverses, broken truncation.
- **Best practice:** UTF-8 everywhere, declare encodings explicitly, iterate by the right unit, test with non-ASCII data.

The next level, `middle.md`, opens up the bytes themselves: exactly how UTF-8 encodes 1–4 bytes, what surrogate pairs are in UTF-16, the reserved `0xD800–0xDFFF` range, and the BOM.
