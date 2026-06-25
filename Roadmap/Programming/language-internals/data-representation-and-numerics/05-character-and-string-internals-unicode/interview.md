# Character & String Internals (Unicode) — Interview Questions

> **Topic:** [Character & String Internals (Unicode)](README.md)

---

## Introduction

These questions test whether a candidate understands what a string *actually is* below the convenient abstraction — bytes, code units, code points, grapheme clusters — and whether they can reason about the operations that go wrong on real human text: length, indexing, comparison, normalization, case, sorting, and the security consequences of getting any of it wrong. A strong candidate never says "a character" without disambiguating which layer they mean, knows that `"😀".length` is `2` in Java/JS and *why*, reaches for normalization before comparing user text, and treats Unicode input as adversarial. A weaker candidate believes a `char` is a character, sorts with `<`, and lowercases for security.

The questions are grouped: **Conceptual** (the layered model and encodings), **Language-Specific** (Java, Go, Python, Rust, JavaScript, Swift), **Tricky/Trap** (where the textbook one-liner is wrong), and **Design** (real systems where text internals decide correctness and security).

## Table of Contents

- [Conceptual](#conceptual)
- [Language-Specific](#language-specific)
- [Tricky / Trap](#tricky--trap)
- [Design](#design)

---

## Conceptual

## Question 1

**What is the difference between a byte, a code unit, a code point, and a grapheme cluster?**

A **byte** is a raw 8-bit number, the unit of storage. A **code unit** is the fixed-size chunk an encoding processes — 8 bits in UTF-8, 16 bits in UTF-16, 32 bits in UTF-32. A **code point** is the Unicode number assigned to one abstract character (`U+0041` for `A`, `U+1F600` for 😀), ranging `U+0000`–`U+10FFFF`. A **grapheme cluster** is what a human perceives as a single character on screen, which may be several code points (é as `e`+combining accent, or the family emoji 👨‍👩‍👧‍👦 as seven code points). For pure ASCII all four collapse into one, which is why text bugs hide until non-ASCII input appears. The discipline is to always state which layer you mean, because `length` and indexing give different answers at each.

## Question 2

**Why did UTF-8 win over UTF-16 and UTF-32 for storage and transport?**

Four reasons. It is **backward-compatible with ASCII** — existing ASCII text is already valid UTF-8, so legacy tools and protocols keep working. It has **no byte-order ambiguity** because its code unit is a single byte (UTF-16/32 need a BOM or out-of-band agreement on endianness). It is **self-synchronizing**: lead bytes and continuation bytes are distinguishable, so a corrupted or truncated byte costs only one character, and you can find boundaries from any position. And it is **compact** for ASCII/Western text (1 byte/char) while still representing all of Unicode. UTF-16 is variable-width too (surrogate pairs) yet wastes 2 bytes on ASCII and has the endianness problem; UTF-32 is fixed-width but 4× the size. UTF-8 dominates because it is the only one that is ASCII-compatible, endianness-free, and compact at once.

## Question 3

**Walk me through how UTF-8 encodes a code point. How would you decode `F0 9F 98 80` by hand?**

UTF-8 uses a length-prefixed bit template: `0xxxxxxx` (1 byte), `110xxxxx 10xxxxxx` (2), `1110xxxx 10xxxxxx 10xxxxxx` (3), `11110xxx 10xxxxxx 10xxxxxx 10xxxxxx` (4); continuation bytes always start `10`. To decode `F0 9F 98 80`: `0xF0` is `11110000`, so it is a 4-byte sequence with 3 payload bits (`000`). The continuation bytes contribute 6 bits each: `0x9F`=`10011111`→`011111`, `0x98`=`10011000`→`011000`, `0x80`=`10000000`→`000000`. Concatenate: `000 011111 011000 000000` = `0x1F600` = `U+1F600` = 😀. No lookup table needed — the bytes are self-describing.

## Question 4

**What is a surrogate pair, and why does the `U+D800`–`U+DFFF` range exist?**

UTF-16 uses 16-bit code units, but Unicode code points go up to `U+10FFFF` (21 bits), which does not fit in one unit. The solution reserves the block `U+D800`–`U+DFFF` (2048 code points) permanently — no real character is ever assigned there — and uses it for machinery: a code point above `U+FFFF` is encoded as a **high surrogate** (`0xD800`–`0xDBFF`) followed by a **low surrogate** (`0xDC00`–`0xDFFF`). The reservation makes pairs unambiguous: a `0xD83D` can only be a high surrogate, never a standalone character. The consequence is that surrogates are not "scalar values," valid UTF-8 must never encode them, and `"😀".length === 2` in UTF-16 languages because the emoji is two code units.

## Question 5

**What are the Unicode normalization forms and when do you use each?**

There are four. **NFD** (canonical decomposition) splits characters into base + combining marks. **NFC** (decompose then recompose) prefers precomposed forms and is the storage/web default. **NFKD** and **NFKC** add *compatibility* decomposition, which is lossy — they fold ligatures (`ﬁ`→`fi`), full-width (`Ａ`→`A`), and circled/super/subscript forms. Use **NFC** for storing and transmitting general text; **NFD** when you need to strip accents or match the macOS filesystem; **NFKC** (ideally NFKC_Casefold) for identity/security canonicalization where look-alikes must merge. The fundamental need: the same character has multiple valid spellings (`é` as one code point or as `e`+combining accent), so you must normalize both operands to the same form before comparing, hashing, or deduplicating.

## Question 6

**Why is sorting by code point wrong, and what is collation?**

Code-point order puts `Z` before `a`, scatters accented letters by their arbitrary code-point values, and ignores language conventions — nonsense to a human reading an "alphabetical" list. **Collation** is locale-aware ordering, standardized by the Unicode Collation Algorithm (UCA), which compares on multiple levels: base letter first (`a`=`á`=`A`), then accents, then case, then punctuation. On top of UCA each locale *tailors* the order: Swedish sorts `å ä ö` after `z`, German phonebook order treats `ä` like `ae`. There is no single correct order — it depends on the user's language — so you use a locale-aware collator (`Intl.Collator`, ICU `Collator`, `x/text/collate`), never raw `<` on strings, for anything users read as sorted.

## Question 7

**What is the BOM and when is it useful versus harmful?**

The Byte Order Mark is `U+FEFF` placed at the start of text. For UTF-16/32 it is genuinely useful: it disambiguates endianness (`FE FF` big-endian vs `FF FE` little-endian). For **UTF-8 it is pointless** because UTF-8's unit is a single byte with no byte-order question — yet Windows tools love to prepend `EF BB BF`. That phantom 3-byte prefix is a common bug: it makes a JSON file start with an invisible `﻿` character that breaks `JSON.parse`, it breaks a shell script's `#!` shebang line, and it causes string equality and CSV header comparisons to fail. Best practice: never emit a UTF-8 BOM; strip incoming ones (decode with `utf-8-sig` or check the first three bytes).

## Question 8

**What is an overlong UTF-8 encoding and why is it a security problem?**

UTF-8 requires the *shortest* possible encoding of each code point. An overlong encoding uses more bytes than necessary — for example encoding `/` (normally `0x2F`) as `0xC0 0xAF`. Both decode to the same character in a lenient decoder, but the byte sequences differ. This is a security hole: a filter that checks for the *byte* `0x2F` to block path traversal will miss `0xC0 0xAF`, which a lenient consumer then decodes to `/`, enabling directory traversal. The 2001 IIS worm exploited exactly this. Standard UTF-8 forbids overlong forms, and conformant decoders reject them; the rule is to decode-and-validate strictly *before* any security check, never to filter raw bytes.

---

## Language-Specific

## Question 9

**In Java, what is a `char`, and why is it not a character? How do you iterate over actual code points?**

A Java `char` is a 16-bit UTF-16 **code unit**, not a character. For any code point above `U+FFFF` (emoji, astral CJK), a single character occupies *two* `char`s as a surrogate pair, so `s.charAt(i)` can return half a character, and `s.length()` counts code units (`"😀".length()` is `2`). To iterate actual code points use `s.codePoints()` (an `IntStream`) or `s.codePointCount(0, s.length())` for the count; `Character.isHighSurrogate`/`toCodePoint` handle pairs manually. Since Java 9, `String` is backed by a `byte[]` with a coder flag (compact strings, JEP 254): Latin-1 strings use 1 byte/char, anything else uses 2 bytes/char in UTF-16.

## Question 10

**In Go, explain `byte` vs `rune` and what `for i, r := range s` gives you. What does `len(s)` return?**

A Go `byte` is a `uint8`; a `rune` is an `int32` representing a Unicode code point. Go strings are immutable UTF-8 byte sequences. `len(s)` returns the number of **bytes**, so `len("😀")` is `4`. Indexing `s[i]` gives a *byte*, not a character. `for i, r := range s` decodes the UTF-8 and yields `(byteIndex, rune)` — the index is the byte offset of the rune's first byte, so indices jump (0, then 1, then 5 for `"a😀b"`). To count code points use `utf8.RuneCountInString(s)`; to get a slice of code points use `[]rune(s)`. Invalid UTF-8 decodes to `utf8.RuneError` (`U+FFFD`) with width 1.

## Question 11

**In Python 3, what is the difference between `str` and `bytes`, and how does PEP 393 store a `str`?**

`bytes` is an immutable sequence of raw 8-bit values; `str` is an immutable sequence of Unicode **code points**. You convert between them explicitly: `str.encode(encoding)` → `bytes`, `bytes.decode(encoding)` → `str`. Python deliberately forbids mixing them (no implicit coercion), which prevents whole classes of encoding bugs. Under PEP 393, CPython stores each `str` in the narrowest fixed-width form that fits its widest code point: 1 byte/char (Latin-1) if all ≤ `U+00FF`, 2 bytes (UCS-2) if all ≤ `U+FFFF`, 4 bytes (UCS-4) otherwise. This keeps indexing O(1) while exposing code points, but means one emoji in a long string promotes the *whole* string to 4 bytes/char — visible via `sys.getsizeof`.

## Question 12

**In Rust, explain `String`, `&str`, and `char`. Why does `&s[0..2]` sometimes panic?**

`String` is an owned, heap-allocated, growable UTF-8 byte buffer; `&str` is a borrowed view (a fat pointer: address + byte length) into UTF-8 bytes. A `char` is a 32-bit **Unicode scalar value** — any code point *except* the surrogate range `U+D800`–`U+DFFF` — so a Rust `char` is always a complete code point, never half a surrogate. `s.len()` is the **byte** length. Slicing `&s[a..b]` indexes by *byte* offset, and it **panics** if `a` or `b` is not on a UTF-8 character boundary (e.g. slicing into the middle of a multi-byte emoji) — Rust refuses to produce invalid UTF-8. Iterate with `s.chars()` (code points) or `s.char_indices()` (byte offset + char), and use the `unicode-segmentation` crate for graphemes.

## Question 13

**In JavaScript, why is `"😀".length` equal to `2`, and what is the difference between `charCodeAt` and `codePointAt`?**

JavaScript strings are sequences of UTF-16 code units, and `.length` counts **code units**. 😀 is `U+1F600`, above the BMP, so it is stored as a surrogate pair — two code units — hence `.length === 2`. `charCodeAt(i)` returns the single UTF-16 code unit at index `i`, which for an astral character is a lone surrogate (e.g. `0xD83D`), not the character. `codePointAt(i)` reads the full code point if index `i` starts a surrogate pair (returning `0x1F600`). To iterate or count code points, use the spread/iterator (`[...s]`) which is surrogate-aware; for grapheme clusters (family emoji, skin tones, flags) use `Intl.Segmenter` with `granularity: "grapheme"`.

## Question 14

**In Swift, why is `"👨‍👩‍👧‍👦".count` equal to `1`, when other languages report more?**

Swift's `String` is a collection of `Character` values, and a Swift `Character` is an **extended grapheme cluster** — exactly what a human perceives as one character. The family emoji is seven code points joined by ZWJ, but it is one grapheme cluster, so `"👨‍👩‍👧‍👦".count` is `1`. This makes Swift the outlier that gets human-facing length right by default, at the cost that `.count` is O(n) (it must run grapheme segmentation) and string indices are opaque `String.Index` values, not integers — you cannot do `s[5]`. Swift stores UTF-8 internally and offers `.unicodeScalars`, `.utf16`, and `.utf8` views when you need the lower layers.

## Question 15

**Across these languages, what does "string length" mean, and why is there no single answer?**

Because "length" measures a layer, and the languages count different layers by default. For `"😀"`: Java and JavaScript report `2` (UTF-16 code units), Go reports `4` and Rust reports `6`... wait — Go `len("😀")` is `4` bytes, Rust `"😀".len()` is `4` bytes (😀 is 4 UTF-8 bytes); Python reports `1` (code points); Swift reports `1` (graphemes). The right interview move is to refuse the question's premise: ask *which* length — bytes for storage limits and buffers, code units for serializers, code points for algorithms, graphemes for UI character counts — and name the API that gives each. "Length is a question, not a fact."

---

## Tricky / Trap

## Question 16

**A candidate writes `s.split('').reverse().join('')` to reverse a string. What breaks?**

It corrupts any character outside the BMP. `split('')` (in JS) splits by UTF-16 code unit, so an emoji's surrogate pair is split into its two halves; `reverse` swaps them, producing an invalid lone-surrogate sequence — a broken character, often rendered as `��`. It also breaks combining marks (the accent detaches from its base) and ZWJ emoji (the family falls apart). A correct reverse must operate on **grapheme clusters**: `[...new Intl.Segmenter().segment(s)].map(x => x.segment).reverse().join("")`. At minimum reverse by code point (`[...s].reverse()`), but only grapheme-level reversal keeps é, 👍🏽, and 👨‍👩‍👧‍👦 intact.

## Question 17

**Why might `"café" === "café"` be `false`, and how do you make it `true`?**

The two strings can be canonically equivalent but byte-different: one writes `é` as the single code point `U+00E9`, the other as `e` + combining acute `U+0301`. They display identically but have different code points (and even different lengths), so `==` fails. The fix is to **normalize both to the same form** before comparing — `unicodedata.normalize("NFC", a) == unicodedata.normalize("NFC", b)` (or NFD). This is the canonical real-world bug: any equality, hashing, set membership, or deduplication over user-entered text must normalize first, or "identical-looking" strings are treated as different.

## Question 18

**Why is `username.toLowerCase()` dangerous for a case-insensitive login check?**

`toLowerCase`/`toUpperCase` are **locale-sensitive** and meant for display, not matching. In the Turkish locale, uppercase `I` lowercases to dotless `ı`, not `i`, so `"ADMIN".toLowerCase()` becomes `"admın"` and a comparison against `"admin"` fails — or a crafted input matches when it should not (the "Turkish-i bug"). German `ß` and Greek final sigma have similar surprises, and casing can even change length (`ß`→`SS`). For caseless *security* comparison, use full Unicode **case folding** with the invariant/`ROOT` locale (Python `str.casefold()`, ICU case folding), never `toLowerCase` with the request's locale.

## Question 19

**Your "max 20 characters" username field rejects a user with six emoji. Why?**

The field almost certainly counts **code units** (or bytes), not graphemes. Six emoji can be many code units: an astral emoji is 2 UTF-16 units, a skin-tone variant is 4, the family is 11 — so six emoji easily exceed 20 units while a human counts six characters. The fix is to count **grapheme clusters** (`Intl.Segmenter`, ICU `BreakIterator`, `unicode-segmentation`) for any user-facing "number of characters" limit, and to truncate on grapheme boundaries so you never split an emoji.

## Question 20

**A filter blocks the literal `<script>` but XSS still gets through with Unicode. How?**

Normalization mismatch. The filter checks the raw input, but the downstream renderer or template engine applies NFKC normalization first. The attacker submits `＜script＞` using full-width brackets (`U+FF1C`/`U+FF1E`), which does not match the filter's `<script>` — but NFKC folds full-width forms to ASCII, producing `<script>` after the filter has already passed it. The fix is to **normalize first, then validate the normalized form**, and consume that same form — never validate one representation and consume another. The same class includes overlong UTF-8 and double-encoding bypasses.

## Question 21

**Sorting user-visible strings with the default comparator produces "wrong" order for some users. Why, and what is the fix?**

The default `<`/`compare` orders by code unit / code point, which is not human alphabetical order: `Z` precedes `a`, accents land in arbitrary places, and language conventions are ignored. Worse, the "correct" order differs by locale (Swedish vs German vs Spanish), so there is no universal fix — a single cached sort cannot be right for everyone. Use a **locale-aware collator** (`Intl.Collator(userLocale)`, ICU `Collator`) keyed to each user's locale, and never serve one locale's sort order to all users as if it were canonical.

## Question 22

**Why can adding one emoji to a long ASCII string quadruple its memory in Python?**

CPython's PEP 393 stores a `str` in the narrowest fixed-width representation that fits its **widest** code point: 1 byte/char for Latin-1, 2 for UCS-2, 4 for UCS-4. A long ASCII string is 1 byte/char; appending one astral emoji (above `U+FFFF`) forces the entire string to UCS-4 (4 bytes/char), since the representation is uniform, not per-character. So `"a"*999` and `"a"*999 + "😀"` differ roughly 4×. The JVM has the analogous "widest wins" cliff (Latin-1 → UTF-16, 1→2 bytes) with compact strings. The lesson: a string's footprint is governed by its single widest character, not its average.

---

## Design

## Question 23

**Design the username canonicalization for a system where usernames must be unique and case-insensitive. What goes wrong if you do it naively?**

Canonicalize **once**, at a single chokepoint, and compare canonical forms everywhere — registration, login, password reset, lookup. The pipeline: NFKC normalize → case fold with the invariant locale → optionally compute the UTS #39 confusable "skeleton" and enforce a single-script (or allowed-script-set) restriction. Store the canonical key for uniqueness/indexing alongside the display form. Naive failures: lowercasing with the request locale (Turkish-i bug); normalizing inconsistently between registration and lookup (the **Spotify account-takeover** class — register a username that canonicalizes to the victim's, then reset their password); and accepting homoglyphs (`раypal` with Cyrillic letters) as distinct from the real account. The rule is "one canonical form, computed once, used for every comparison."

## Question 24

**You're building a code-hosting platform's diff viewer. What text-safety concerns must you handle?**

The diff renders untrusted source code to human reviewers, so the **Trojan Source** class is the headline risk: bidi override characters (`U+202E` etc.) can make the displayed order of code differ from the compiled order, hiding backdoors; homoglyph identifiers can disguise one variable as another. Detect and visibly flag (or escape) bidi controls and invisible/zero-width characters, and warn on mixed-script identifiers. Beyond security: render with grapheme-correct cursor and selection, handle lone surrogates and invalid UTF-8 gracefully (show `U+FFFD`, do not crash the renderer), and normalize for "are these two lines equal" comparisons. GitHub, rustc, and gcc added exactly these bidi warnings after the 2021 CVE.

## Question 25

**Design a search feature where typing "café" finds documents containing "café", "cafe", and "CAFÉ". What transformations do you apply, and where?**

Build an analysis pipeline applied identically to indexed documents and to queries: normalize (NFKC or NFD), case fold, and optionally strip combining marks (accent-folding) so `café`/`cafe`/`CAFÉ` collapse to the same token. Apply it at **both** index time and query time — asymmetry is the classic bug (the document is folded but the query is not, or vice versa). Decide deliberately whether accent-insensitivity is desired (good for European text, sometimes wrong for languages where accents are meaning-bearing), and keep the original text for display/highlighting. For ranking, you may keep an un-folded field to boost exact matches. The general principle from this whole topic: **canonicalize both sides into the same form before comparing.**

## Question 26

**A service stores millions of short strings and is under memory pressure. What representation choices reduce footprint, and what are the trade-offs?**

First, exploit "widest-char-wins" representations: keep predominantly-ASCII fields free of stray wide characters so the JVM (compact strings) or CPython (PEP 393) keeps them at 1 byte/char; segregate the rare wide-character rows so one emoji does not promote a whole column's representation. Use **small-string optimization** types (`compact_str`/`smol_str` in Rust, the default `std::string` SSO in C++, Swift's inline strings) to avoid per-string heap allocations and headers for short strings. **Intern** high-cardinality-but-repeated strings (enum-like values, tags) to share one instance — but never intern unbounded user input, which is a memory-exhaustion DoS. For large *mutable* documents, use a rope/cord to avoid O(n) copies. Trade-offs: compact representations add a branch on the coder; SSO fattens the object; interning risks an uncollected pool; ropes cost O(log n) indexing and locality. Profile first and apply each only where it pays.
