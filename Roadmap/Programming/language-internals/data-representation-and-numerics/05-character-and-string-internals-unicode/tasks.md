# Character & String Internals (Unicode) — Hands-On Tasks

> **Topic:** [Character & String Internals (Unicode)](README.md)

---

## Introduction

This file takes you from "a string is text" to "I can decode UTF-8 by hand, count graphemes, normalize for comparison, and spot a homoglyph attack." Each task is small and self-contained, but they build a coherent mental model. Do them in a language with first-class Unicode support (Python is easiest for inspection; Go, Rust, JS, or Java work too), and **look at the actual bytes** whenever a result surprises you — the bytes never lie.

How to use this file: read the task, write the code, run it, and only then open the hints. Mark a self-check box when you can *explain* the result to someone else, not when the program merely runs. Solutions are sparse — they appear only where the canonical answer teaches more than your first attempt would.

## Table of Contents

- [Warm-Up](#warm-up)
- [Core](#core)
- [Advanced](#advanced)
- [Capstone](#capstone)

---

## Warm-Up

These rebuild the layered model. Short, but each introduces a primitive you reuse later.

### Task 1: The length is a lie

**Problem.** Take the string `"a😀b"`. In your language, print: the byte length (UTF-8), the code-unit length, the code-point count, and (if available) the grapheme count. Then repeat for `"é"` written two ways (precomposed `é` and decomposed `é`) and for the family emoji `"👨‍👩‍👧‍👦"`.

**Constraints.**
- Show all four numbers explicitly; do not assume any two are equal.
- Use the language's *correct* APIs for each layer (no guessing).

**Hints (try without first).**
- In JS: `Buffer.byteLength(s,'utf8')`, `s.length`, `[...s].length`, `[...new Intl.Segmenter().segment(s)].length`.
- In Python: `len(s.encode())`, (no separate code-unit layer), `len(s)`, and a grapheme lib for the last.
- For `"👨‍👩‍👧‍👦"` you should see something like bytes=25, code points=7, graphemes=1.

**Self-check.**
- [ ] You can explain why `"😀"` gives byte≠code-unit≠code-point.
- [ ] You can explain why the two spellings of `é` have different lengths.
- [ ] You can name which length to use for a DB column limit vs a UI character counter.

### Task 2: Manufacture mojibake

**Problem.** Encode `"Héllo, café"` to UTF-8 bytes, then *decode those bytes as Latin-1* and print the result. Then do the reverse mistake. Explain in one sentence what produced the garbage.

**Hints.**
- Python: `s.encode("utf-8").decode("latin-1")`.
- You should see `Ã©` where `é` was.

**Self-check.**
- [ ] You can state the rule: "the bytes were fine; the *interpretation* was wrong."
- [ ] You can identify which byte(s) became which garbled characters.

### Task 3: Spot and strip a BOM

**Problem.** Create two files: one UTF-8 without a BOM, one with (`EF BB BF` prefix). Write a function that reads bytes, detects whether a UTF-8 BOM is present, strips it, and returns clean text. Then show that naive `JSON.parse`/`json.loads` of the BOM file fails or yields a key with a leading `﻿`.

**Hints.**
- Python: check `data.startswith(b"\xef\xbb\xbf")`, or decode with `"utf-8-sig"`.
- The BOM character is `U+FEFF`, invisible, length 1.

**Self-check.**
- [ ] You can explain why a UTF-8 BOM is pointless yet harmful.
- [ ] You reproduced a real parse failure caused by the BOM.

---

## Core

These tasks make you operate the encodings and semantics directly.

### Task 4: Decode UTF-8 by hand

**Problem.** Without using your language's UTF-8 decoder, write a function `decode_first(bytes) -> (code_point, num_bytes)` that reads the first character. Test it on `b"A"`, `b"\xc3\xa9"` (é), `b"\xe6\x97\xa5"` (日), and `b"\xf0\x9f\x98\x80"` (😀). Then make it reject an invalid lead byte and a truncated sequence.

**Constraints.**
- Use only bit operations (`&`, `|`, `<<`, `>>`).
- Derive the length from the first byte's high bits.

**Hints.**
- `0xxxxxxx`→1, `110xxxxx`→2, `1110xxxx`→3, `11110xxx`→4; continuation bytes are `10xxxxxx`.
- Mask payload bits: `b0 & 0x1F` for a 2-byte lead, `& 0x0F` for 3-byte, `& 0x07` for 4-byte; each continuation contributes `b & 0x3F`.

**Solution sketch.**
```python
def decode_first(b):
    b0 = b[0]
    if b0 < 0x80:           return b0, 1
    if b0 >> 5 == 0b110:    return ((b0 & 0x1F) << 6) | (b[1] & 0x3F), 2
    if b0 >> 4 == 0b1110:   return ((b0 & 0x0F) << 12) | ((b[1] & 0x3F) << 6) | (b[2] & 0x3F), 3
    if b0 >> 3 == 0b11110:  return ((b0 & 0x07) << 18) | ((b[1] & 0x3F) << 12) | ((b[2] & 0x3F) << 6) | (b[3] & 0x3F), 4
    raise ValueError("bad lead byte")
```

**Self-check.**
- [ ] Your decoder matches the stdlib on all valid inputs.
- [ ] It rejects a `10xxxxxx` byte appearing as a lead byte.
- [ ] You understand why this needs no lookup table (self-describing bytes).

### Task 5: Surrogate pair round-trip

**Problem.** Write `to_pair(cp) -> (high, low)` for a code point above `U+FFFF`, and `from_pair(high, low) -> cp` to invert it. Verify on 😀 (`U+1F600` ↔ `D83D DE00`) and on `U+10FFFF` (the maximum). Then explain why `U+D800`–`U+DFFF` can never be a real character.

**Hints.**
- Encode: `cp -= 0x10000; high = 0xD800 + (cp >> 10); low = 0xDC00 + (cp & 0x3FF)`.
- Decode: `cp = 0x10000 + ((high - 0xD800) << 10) + (low - 0xDC00)`.

**Self-check.**
- [ ] Round-trip is exact for the whole astral range.
- [ ] You can explain why the reserved range makes pairs unambiguous.

### Task 6: Safe byte-bounded truncation

**Problem.** A field must fit in **20 UTF-8 bytes**. Write `truncate_bytes(s, 20)` that returns the longest valid-UTF-8 prefix of `s` that fits, never cutting a character in half. Test on a string where byte 20 lands mid-emoji.

**Constraints.**
- The result must be valid UTF-8 (no broken trailing character).
- Maximize the kept content (do not over-trim).

**Hints.**
- Encode to bytes, slice to 20, then back up to the last character boundary.
- In Python, `bytes[:20].decode("utf-8", errors="ignore")` drops the broken tail — verify it does the right thing.
- Better: find the boundary by checking that the next byte is not a `10xxxxxx` continuation byte.

**Self-check.**
- [ ] Output is always ≤ 20 bytes and always valid UTF-8.
- [ ] You handled the case where a single character is itself > 20 bytes (impossible in UTF-8, but reason about why — max is 4).

### Task 7: Normalize before comparing

**Problem.** Build a set/dictionary keyed on user names. Insert `"café"` (precomposed). Then look up `"café"` typed with a decomposed `é`. Show the lookup *fails*. Fix it by normalizing keys (NFC) on insert and lookup, and show it now succeeds.

**Hints.**
- Python: `unicodedata.normalize("NFC", s)`.
- Construct the decomposed version as `"café"`.

**Self-check.**
- [ ] You reproduced the failure, then fixed it with one normalization step.
- [ ] You can explain why this affects *every* `==`, hash, set, and dedupe over user text.

### Task 8: Grapheme-correct reverse

**Problem.** Write `reverse(s)` that reverses by **grapheme cluster**, then prove it on `"a👨‍👩‍👧‍👦b"`, `"é"` (decomposed), and `"👍🏽"`. Compare against the naive code-unit reverse and show how the naive version corrupts the emoji.

**Hints.**
- JS: segment with `Intl.Segmenter({granularity:"grapheme"})`, map to `.segment`, reverse, join.
- The naive `[...s].reverse()` (code points) still breaks the family and the combining accent; only grapheme-level is fully correct.

**Self-check.**
- [ ] Naive reverse produces `��` or a detached accent; yours does not.
- [ ] The family emoji and skin-tone emoji survive intact.

---

## Advanced

These tasks reach into semantics and security.

### Task 9: NFC vs NFKC, and what each destroys

**Problem.** Take `s = "ﬁle Ａdmin ② café ℌ"` (ligature fi, full-width A, circled 2, decomposed é, math H). Print `NFC(s)` and `NFKC(s)` side by side. List exactly which characters NFKC changed that NFC did not, and argue when each form is appropriate.

**Hints.**
- NFC fixes the decomposed `é` but leaves the ligature, full-width, circled, and math forms.
- NFKC additionally folds `ﬁ`→`fi`, `Ａ`→`A`, `②`→`2`, `ℌ`→`H`.

**Self-check.**
- [ ] You can name a use case where NFKC is required (identity/security) and one where it is harmful (rendering math/styled text).
- [ ] You can state why NFKC is a one-way door (lossy).

### Task 10: The Turkish-i trap

**Problem.** Show that `"TITLE".toLowerCase(turkishLocale)` differs from the English result. Then build a *correct* case-insensitive identity comparison that is immune to locale (use case folding with the invariant locale). Demonstrate it treats `"FILE"`/`"file"` as equal regardless of locale.

**Hints.**
- Java: `toLowerCase(new Locale("tr"))` turns `I`→`ı`.
- Python: prefer `str.casefold()` over `str.lower()`; combine with NFKC for identities.

**Self-check.**
- [ ] You reproduced the locale-dependent divergence.
- [ ] Your identity comparison does not depend on the request locale.

### Task 11: Locale-aware collation

**Problem.** Sort `["zebra","äpfel","apple","Über","apfel","zürich"]` three ways: raw `<`, German collation, and Swedish collation. Show that all three differ, and explain why `ä` lands in a different place each time.

**Hints.**
- JS: `Intl.Collator("de")` vs `Intl.Collator("sv")`.
- Swedish sorts `ä`/`ö` after `z`; German groups `ä` with `a`; raw `<` scatters by code point.

**Self-check.**
- [ ] All three orderings differ.
- [ ] You can explain why there is no single "correct" sort.

### Task 12: Detect a homoglyph / mixed-script identifier

**Problem.** Write `is_suspicious(name)` that flags strings mixing scripts likely to be confusables — e.g. `"аpple"` (Cyrillic `а` + Latin) or `"раypal"`. Return the set of scripts present and flag any name that mixes Latin with Cyrillic/Greek.

**Hints.**
- Python: derive each letter's script from `unicodedata.name(ch)` (first token) or use a script-property table.
- A robust real defense uses the UTS #39 confusable "skeleton"; the mixed-script heuristic is a good first cut.

**Self-check.**
- [ ] `"apple"` passes; `"аpple"` is flagged.
- [ ] You can explain why this matters for usernames, domains, and package names.

### Task 13: Catch a Trojan Source bidi attack

**Problem.** Write `scan_source(text)` that flags any bidi override / isolate control characters (`U+202A`–`U+202E`, `U+2066`–`U+2069`) and zero-width characters. Test it on a benign file and on a snippet containing `U+202E`. Explain how such a character makes displayed code differ from compiled code.

**Hints.**
- The dangerous set: LRE/RLE/PDF/LRO/RLO and the isolates LRI/RLI/FSI/PDI.
- Modern compilers (rustc, gcc) and GitHub already warn on these — your scanner reproduces that defense.

**Self-check.**
- [ ] Your scanner flags the malicious snippet and passes the benign one.
- [ ] You can explain the display-vs-semantics gap the attack exploits.

### Task 14: Overlong-encoding rejection

**Problem.** Construct the overlong 2-byte encoding of `/` (`0xC0 0xAF`) and of NUL (`0xC0 0x80`). Show that your hand-written decoder from Task 4 currently *accepts* them, then fix it to reject overlong forms. Verify the stdlib (`utf8.Valid` in Go, `str()` decode in Python with `errors="strict"`) also rejects them.

**Hints.**
- A 2-byte sequence is overlong if its decoded code point is < `0x80`; 3-byte if < `0x800`; 4-byte if < `0x10000`.
- Also reject any 3-byte sequence decoding into the surrogate range.

**Self-check.**
- [ ] Your decoder now rejects all overlong forms.
- [ ] You can explain the IIS-worm-style filter bypass these enable.

---

## Capstone

### Task 15: A correct, secure username canonicalizer

**Problem.** Implement `canonical_username(raw) -> key` and `display_username(raw) -> str` for a system where usernames must be unique and case-insensitive and must resist look-alike spoofing. The canonical key is used for uniqueness and all comparisons; the display form preserves the user's intended appearance.

**Requirements.**
- Canonical key: NFKC normalize → case fold (invariant locale) → reject or skeleton-collapse confusables → enforce a single allowed script set.
- Reject control characters, bidi overrides, and unassigned/private-use code points.
- Reject inputs whose canonical form collides with an existing user's key.
- Count length by **grapheme** for any min/max length rule.
- Keep the original (NFC) input as the display form.

**Hints.**
- This is the pipeline that prevents the **Spotify account-takeover** class (canonicalize once, compare canonical forms everywhere).
- Test that `"Admin"`, `"admin"`, `"ＡＤＭＩＮ"` (full-width), and `"аdmin"` (Cyrillic) all either map to the same key or are rejected as confusable — decide your policy and enforce it consistently.

**Self-check.**
- [ ] Registration and lookup use the *same* canonicalization, computed once.
- [ ] A homoglyph of an existing user is rejected.
- [ ] A locale-dependent casing can never change the canonical key.
- [ ] The display form round-trips to the user's intended appearance.

### Task 16: A robust text-field validator

**Problem.** Build `validate_text(raw, max_graphemes)` for a public form field that must be safe to store, index, search, and display. It should: strictly decode/validate UTF-8 (reject overlong, surrogate, truncated); strip a BOM; reject disallowed control and bidi characters; normalize to NFC for storage; enforce the limit by grapheme count; and return both a storage form and a search-fold form (accent- and case-folded).

**Requirements.**
- Normalize **before** validating, and validate the normalized form.
- Never silently drop bytes (reject, or replace with `U+FFFD` explicitly and log it).
- Produce a separate folded key for search that matches `café`/`cafe`/`CAFÉ`.

**Self-check.**
- [ ] An overlong-encoded or full-width payload cannot slip a forbidden substring past validation.
- [ ] The grapheme limit is correct for emoji and combining-mark input.
- [ ] The same fold is applied at index time and query time (no asymmetry bug).
- [ ] You can articulate, for each transformation, *why* it is applied and at which boundary.

---

Work through these in order; by Task 16 you will have built, from scratch, the canonicalization and validation logic that production identity and content systems depend on — and you will have re-derived the defenses behind several real CVEs.
