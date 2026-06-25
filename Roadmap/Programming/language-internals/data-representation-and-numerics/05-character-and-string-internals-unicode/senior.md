# Character & String Internals (Unicode) — Senior Level

> **Topic:** [Character & String Internals (Unicode)](README.md)
> **Focus:** The semantic operations on text — normalization (NFC/NFD/NFKC/NFKD), grapheme cluster segmentation, locale-sensitive case folding, and collation. Where "two strings that look identical are not equal," and how to make them be.

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

> Focus: **Why does `"café" === "café"` return false, and what is the disciplined way to compare, sort, fold case, and count text that humans wrote?**

At the byte level (middle.md), text is mechanical: a code point maps to fixed bytes. At the *semantic* level, text is treacherous, because the relationship between code points and meaning is many-to-one and context-dependent. The letter `é` has **two** valid Unicode spellings. The uppercase of `ß` is debated. The lowercase of Turkish `İ` is not `i`. Sorting "naïve" before "naive" depends on the user's language. A single emoji on screen may be seven code points. None of these are bugs in Unicode — they are faithful reflections of how human writing actually works, and a senior engineer must handle them rather than wish them away.

This page covers the four pillars of correct text semantics:

1. **Normalization** — collapsing the multiple valid spellings of the same text into one canonical form (NFC/NFD/NFKC/NFKD).
2. **Grapheme cluster segmentation** — counting and slicing text the way a human perceives it (so 👨‍👩‍👧‍👦 is one unit and é-with-combining-mark is one unit).
3. **Case folding** — comparing text case-insensitively, with all the locale traps (Turkish `i`, German `ß`, Greek final sigma).
4. **Collation** — sorting text in a locale-correct order that is *not* code-point order.

> 🎓 **Why this matters for a senior:** These are the operations that decide whether two users can register the same username, whether a search box finds what the user typed, whether a "remove duplicates" job actually deduplicates, and whether your filename comparison on macOS matches the one on Linux. Get them wrong and you ship account-takeover vulnerabilities, broken search, and data-integrity bugs that are nearly impossible to reproduce because they depend on *how* the input was typed. The next level (`professional.md`) covers the storage internals and the security exploits that weaponize exactly these semantics.

---

## Prerequisites

- **Required:** Middle-level mechanics: UTF-8/16 byte layout, surrogate pairs, code units vs code points.
- **Required:** Comfort with the idea that one human character ≠ one code point.
- **Helpful:** Exposure to a Unicode library (ICU, Python `unicodedata`, Go `golang.org/x/text`, JS `Intl`).
- **Helpful:** Awareness that locale (language + region) affects text behavior.

You do **not** need: in-memory string storage (Latin-1 vs UTF-16 compact strings, PEP 393), SSO, ropes, or the security-attack catalogue — those are `professional.md`.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Normalization** | Transforming text to a canonical form so that equivalent strings become byte-identical. |
| **Canonical equivalence** | Two sequences that represent the *same* abstract character (e.g. precomposed `é` vs `e`+combining acute). Must display and behave identically. |
| **Compatibility equivalence** | A weaker relation: characters with the same *meaning* but different *form* (e.g. `ﬁ` ligature vs `fi`, full-width `Ａ` vs `A`). |
| **NFC** | Normalization Form C: canonical decomposition, then canonical *composition* — prefer precomposed forms. The web/storage default. |
| **NFD** | Normalization Form D: canonical decomposition — split into base + combining marks. macOS filesystem uses a variant. |
| **NFKC / NFKD** | Compatibility forms: like NFC/NFD but also collapse compatibility equivalents (ligatures, full-width, super/subscripts). Lossy. |
| **Combining mark** | A code point that attaches to the preceding base character (e.g. `U+0301` combining acute accent). |
| **Grapheme cluster** | A maximal run of code points perceived as one character; defined by UAX #29. |
| **ZWJ** | Zero-Width Joiner `U+200D`; glues code points into a single emoji (e.g. 👨‍👩‍👧‍👦). |
| **Regional indicator** | Pairs of `U+1F1E6`–`U+1F1FF` that render as flag emoji (🇺🇸 = `U+1F1FA U+1F1F8`). |
| **Case folding** | A normalization for caseless comparison; stronger and more stable than `toLowerCase`. |
| **Collation** | Locale-aware ordering of strings (UCA + locale tailoring). |
| **UCA** | Unicode Collation Algorithm, the standard multi-level comparison. |
| **Locale** | Language + region (+ variant) context that tailors case, collation, and formatting. |

---

## Core Concepts

### 1. Canonical equivalence: one character, two spellings

`é` can be:
- **Precomposed:** `U+00E9` (LATIN SMALL LETTER E WITH ACUTE) — one code point.
- **Decomposed:** `U+0065 U+0301` (`e` + COMBINING ACUTE ACCENT) — two code points.

These are **canonically equivalent**: Unicode declares they represent the same character and must display and sort identically. But their *byte sequences differ*, so naive `==` returns false. This is the single most common cause of "two identical-looking strings are not equal." The fix is to **normalize both sides to the same form** before comparing.

Decomposition can stack: Vietnamese `ệ` may be `e` + circumflex + dot-below, and the combining marks have a defined canonical ordering (by combining class) so that `e◌̂◌̣` and `e◌̣◌̂` normalize to the same thing.

### 2. The four normalization forms

| Form | Decompose? | Recompose? | Compatibility? | Use it for |
|------|-----------|-----------|----------------|-----------|
| **NFD** | yes | no | no | filesystem (macOS HFS+), algorithms that strip accents |
| **NFC** | yes | yes | no | **storage, transport, web, the default** |
| **NFKD** | yes | no | yes (lossy) | search indexing, aggressive matching |
| **NFKC** | yes | yes | yes (lossy) | identifiers, security canonicalization |

- **NFC** prefers precomposed forms; it is the W3C recommendation for the web and what most systems should store.
- **NFD** keeps base + marks separate; Apple's filesystem historically stored filenames in a near-NFD form, so a file named `é` on macOS may come back as `e`+combining-mark, breaking string comparison against a Linux copy.
- **NFKC/NFKD** also fold *compatibility* equivalents: the ligature `ﬁ` (`U+FB01`) becomes `fi`, the full-width `Ａ` becomes `A`, `①` becomes `1`, superscript `²` becomes `2`. This is **lossy** (you cannot recover the ligature) and **dangerous if misapplied** — but essential for security canonicalization, where `Ａdmin` must be recognized as `Admin`.

**Rule of thumb:** store in **NFC**; for identifier/security comparison use **NFKC** (or the specialized UTS #39 / NFKC_Casefold); never store NFKC where you need to round-trip the exact input.

### 3. Grapheme clusters: counting like a human

A grapheme cluster is what UAX #29 defines as one "user-perceived character." Examples that are **one grapheme but many code points**:

- `é` as `e`+`U+0301` — 2 code points, 1 grapheme.
- 👍🏽 (thumbs-up + medium skin tone `U+1F3FD`) — 2 code points, 1 grapheme.
- 🇺🇸 (two regional indicators) — 2 code points, 1 grapheme.
- 👨‍👩‍👧‍👦 (man ZWJ woman ZWJ girl ZWJ boy) — 7 code points, 1 grapheme.
- `각` Korean syllable when typed as jamo `ᄀ ᅡ ᆨ` — 3 code points, 1 grapheme.

**No fixed-width encoding ever makes a grapheme one unit.** Counting graphemes requires running the segmentation algorithm (UAX #29), available via `Intl.Segmenter` (JS), ICU `BreakIterator` (Java/C++), `unicode-segmentation` (Rust), or `\X` in a Unicode-aware regex engine. "Maximum 20 characters" for a display name should count *graphemes*; truncation and reversal that respect grapheme boundaries are the only ones that keep emoji intact.

### 4. Case folding ≠ lowercasing, and it is locale-sensitive

For caseless comparison, use **case folding** (`String.prototype.toLowerCase` is not it; ICU/`unicodedata` provide `casefold`). Case folding is designed to be stable and locale-independent for *matching*, whereas `toUpperCase`/`toLowerCase` are for *display* and are locale-sensitive. The traps:

- **Turkish/Azeri dotted/dotless i:** uppercase `i` is `İ` (dotted) and lowercase `I` is `ı` (dotless) in Turkish locale. So `"I".toLowerCase("tr")` is `"ı"`, not `"i"`. A case-insensitive comparison done with the Turkish locale will treat `FILE` and `file` as *different*. This has broken real authentication and config code (the "Turkish-i bug").
- **German ß:** historically `"ß".toUpperCase()` was `"SS"` (one char becomes two), and only in 2017 did the capital `ẞ` (`U+1E9E`) get official status. Case folding handles `ß` ↔ `ss` for matching.
- **Greek final sigma:** `Σ` lowercases to `σ` mid-word but `ς` at word end — a *context-dependent* lowercasing rule. So lowercasing is not a pure per-character map.
- **Expansion:** some characters change length when cased (`ß`→`SS`, `ﬁ`→`FI`), so `s.length` is not preserved by casing.

**Discipline:** for *security/identity* comparison, use full Unicode case folding (ideally NFKC_Casefold) with the **root/invariant locale**, never the user's locale. For *display*, use the user's locale.

### 5. Collation: sorting is not code-point order

Sorting strings by code point gives nonsense to humans: `Z` (`U+005A`) sorts before `a` (`U+0061`), accented letters scatter to wherever their code points fall, and `10` sorts before `9`. The **Unicode Collation Algorithm (UCA)** defines a multi-level comparison:

1. **Primary:** base letter (`a` = `á` = `A` at this level).
2. **Secondary:** accents (`a` < `á`).
3. **Tertiary:** case (`a` < `A`).
4. **Quaternary:** punctuation/variants.

On top of UCA, each **locale tailors** the order: Swedish sorts `å ä ö` *after* `z`; German phonebook order treats `ä` like `ae`; Spanish once treated `ll` as one letter. There is no single "correct" sort — it depends on the user's language. Use a locale-aware collator (`Intl.Collator`, ICU `Collator`, `golang.org/x/text/collate`), never `<` on raw strings, for anything a user will read as "alphabetical."

---

## Real-World Analogies

**Two recipes, one dish (canonical equivalence).** `é` precomposed vs decomposed is like writing "1 cup sugar" vs "16 tablespoons sugar" — different text, identical result. Normalization is converting every recipe to the same units before checking whether two recipes are the same.

**The LEGO minifig (grapheme cluster).** 👨‍👩‍👧‍👦 is a built minifig family clipped together with connector pegs (ZWJ). A human sees one family. Counting "characters" by code point is like counting every torso, leg, and peg separately and reporting "7 people."

**Library shelving (collation).** Code-point order is shelving books by the ASCII value of the first byte of the title — gibberish to a patron. Collation is shelving the way a librarian does: ignoring "The", folding accents, respecting the local alphabet. Different countries' libraries shelve differently; so do collators.

**The dotless-i border crossing (locale case).** Lowercasing `I` is like translating a word — the "correct" answer changes when you cross from English into Turkey. Code that assumes one global translation breaks at the border.

---

## Mental Models

**Model 1: Normalize, then compare. Always.** Any time you compare, hash, dedupe, or index user text, normalize both operands to the same form first (NFC for general text, NFKC_Casefold for identities). Comparison of un-normalized Unicode is comparison of accidental byte spellings.

**Model 2: Three different "same."** *Byte-equal* (raw `==`), *canonically equal* (same after NFC), and *compatibility-equal* (same after NFKC). Pick the right one for the job: byte-equal for caches keyed on exact input, canonical for "is this the same text," compatibility for "is this the same identity."

**Model 3: Three different "length/character."** Code units (for serializers/buffers), code points (for algorithms), graphemes (for humans/UI). The grapheme count is the one users mean and the one your language gives you *least* easily.

**Model 4: Locale is an input, not a constant.** Case and collation are functions of *(text, locale)*. Hard-coding the developer's locale is a latent bug. For identity/security, the locale must be the fixed *invariant* locale, never the request's.

**Model 5: NFKC is a one-way door.** It throws away distinctions (ligatures, width) you can never recover. Use it for matching keys, never for the canonical stored value you might need to render back exactly.

---

## Code Examples

### The "café ≠ café" problem and its fix

```python
import unicodedata

a = "café"          # café  (precomposed é, U+00E9)
b = "café"         # café  (e + combining acute U+0301)
print(a == b)            # False  ← different code points!
print(len(a), len(b))    # 4 5    ← even the lengths differ

# Fix: normalize both to NFC (or both to NFD) before comparing
print(unicodedata.normalize("NFC", a) == unicodedata.normalize("NFC", b))  # True
```

### Compatibility normalization (NFKC) flattens look-alikes

```python
import unicodedata
s = "ﬁle Ａdmin ②"            # ligature fi, full-width A, circled 2
print(unicodedata.normalize("NFKC", s))   # "file Admin 2"
# Essential for security: "Ａdmin" must canonicalize to "Admin"
```

### Counting and reversing by grapheme (JavaScript, Intl.Segmenter)

```javascript
const family = "👨‍👩‍👧‍👦";
console.log(family.length);              // 11  ← UTF-16 code units
console.log([...family].length);         // 7   ← code points
const seg = new Intl.Segmenter("en", { granularity: "grapheme" });
console.log([...seg.segment(family)].length); // 1  ← what a human sees

// Grapheme-safe reverse (keeps the family intact):
function reverseGraphemes(str) {
  const segs = [...new Intl.Segmenter().segment(str)].map(s => s.segment);
  return segs.reverse().join("");
}
console.log(reverseGraphemes("a👨‍👩‍👧‍👦b")); // "b👨‍👩‍👧‍👦a"  (family preserved)
```

### The Turkish-i trap

```java
String upper = "TITLE";
// Default/English locale:
System.out.println(upper.toLowerCase(Locale.ENGLISH)); // "title"
// Turkish locale: I -> ı (dotless), not i!
System.out.println(upper.toLowerCase(new Locale("tr"))); // "tıtle"

// Case-insensitive identity comparison MUST use a fixed locale (ROOT) or case folding,
// never the request's locale:
boolean same = "FILE".equalsIgnoreCase("file");          // true in most locales...
// ...but equalsIgnoreCase is locale-independent in Java; the danger is toLowerCase(userLocale).
```

### Locale-aware sorting (collation)

```javascript
const words = ["zebra", "äpfel", "apple", "Über", "apfel"];
console.log([...words].sort());                       // code-point order: ["Über","apfel","apple","zebra","äpfel"]  — wrong for humans
const de = new Intl.Collator("de");
console.log([...words].sort(de.compare));             // German order, ä grouped with a
const sv = new Intl.Collator("sv");
console.log([...words].sort(sv.compare));             // Swedish order, ä/ö after z — DIFFERENT result
```

### Case folding for safe comparison (Python)

```python
# str.casefold() is stronger than str.lower() for matching:
print("ß".casefold())            # "ss"
print("ß".lower())               # "ß"  (no change)
print("Σ".casefold(), "ς".casefold())  # both fold toward sigma for matching
# Identity comparison: normalize THEN casefold
import unicodedata
def identity_key(s):
    return unicodedata.normalize("NFKC", s).casefold()
print(identity_key("Ａdmin") == identity_key("admin"))  # True
```

---

## Pros & Cons

**Storing NFC**

| Pros | Cons |
|------|------|
| Compact (precomposed), web-standard | Must normalize on input; cost per string |
| Stable equality and hashing | Some rare characters have no precomposed form (stay decomposed) |
| Interoperates with most systems | macOS filesystem returns NFD-ish — needs re-normalization |

**Using NFKC_Casefold for identities**

| Pros | Cons |
|------|------|
| Defeats homoglyph/width/ligature spoofing | Lossy — cannot render the exact original |
| Stable caseless matching | Can over-merge distinct identities if applied too broadly |
| Aligns with UTS #39 security guidance | Extra step many teams forget, causing account-takeover bugs |

**Grapheme-aware operations**

| Pros | Cons |
|------|------|
| Correct user-facing length, truncation, reversal | Requires a Unicode library + data tables |
| Survives emoji, skin tones, flags | Slower than code-unit ops; rules update with each Unicode version |

**The core trade-off:** correctness costs a dependency and a normalization pass. The naive `==`, `<`, `.length`, and `.toLowerCase()` are fast and wrong; the correct versions need ICU-class data and locale awareness. A senior decides *where* correctness is mandatory (identity, search, sort, filenames) and where the cheap version is acceptable (internal opaque tokens, ASCII-only protocol fields).

---

## Use Cases

- **Username / email / domain canonicalization:** NFKC_Casefold + a confusable check before deciding two identities are "the same" (prevents look-alike account takeover).
- **Search and indexing:** index NFKD/NFKC-folded, accent-optionally-stripped forms so queries match regardless of how the user typed accents.
- **Deduplication and equality keys:** normalize to NFC before hashing; otherwise the same text appears twice.
- **Filename handling across OSes:** normalize to a known form when comparing paths, because macOS and Linux disagree on stored form.
- **UI character counters / truncation:** count and cut by grapheme, not code unit.
- **Locale-correct alphabetical lists:** collate with the user's locale, never raw `<`.

---

## Coding Patterns

**Pattern 1: The canonicalization pipeline.** For identities: `NFKC → casefold → confusable-skeleton check`. For general comparison: `NFC → compare`. Build this once, reuse everywhere, and make raw `==` on user text a code-review red flag.

**Pattern 2: Normalize at the boundary, store canonical.** Normalize on the way in (API/form) and store the canonical form, so every downstream comparison is already consistent. Keep the raw input separately only if you must render it back exactly.

**Pattern 3: Carry the locale explicitly.** Pass locale into every case/collation call. Use the *invariant* (`ROOT`/`und`) locale for machine comparisons and the *user* locale only for human-facing display and sorting.

**Pattern 4: Use a grapheme iterator for any "per character" UI work.** Counting, truncating with an ellipsis, cursor movement, and reversal all use the segmenter, not indexing.

**Pattern 5: Pick NFC vs NFKC by intent, and document it.** NFC preserves meaning-bearing distinctions; NFKC erases formatting distinctions. Choosing wrong either lets spoofs through (too lenient) or merges legitimately different text (too aggressive).

---

## Best Practices

1. **Normalize before you compare, hash, sort, or store.** Untreated Unicode equality is a bug waiting to happen.
2. **Store NFC; canonicalize identities with NFKC_Casefold.** Keep them as separate, intentional steps.
3. **Never lowercase with the user's locale for security decisions.** Use case folding with the invariant locale to dodge the Turkish-i and Greek-sigma traps.
4. **Sort with a locale-aware collator,** never `<` on strings, for anything users read alphabetically.
5. **Count and slice by grapheme** for user-facing length and truncation.
6. **Re-normalize filenames** when comparing paths that may have crossed macOS.
7. **Pin your Unicode/ICU version** and know that segmentation and case data change between Unicode releases — test fixtures may need updating.
8. **Add a confusable/homoglyph check** to identity canonicalization (foreshadowing `professional.md`'s security section).

---

## Edge Cases & Pitfalls

**The decomposed-é equality failure.** `"é" == "é"` is `false` when one is precomposed and one is decomposed. Every cache, set, dedupe, and `==` over user text is suspect without prior normalization. This is the canonical bug of this page.

**The Turkish-i authentication bug.** `username.toLowerCase()` on a Turkish-locale server turns `ADMIN` into `admın`, so a comparison against `admin` fails — or, worse, lets a different string match. Real systems have shipped this. Use case folding with `ROOT`.

**Grapheme-blind truncation.** Cutting a display name at code point 20 can split 👨‍👩‍👧‍👦 into orphaned people, or strip a skin-tone modifier and change the meaning. Truncate at a grapheme boundary.

**NFKC destroying meaning.** Applying NFKC to mathematical or stylized text destroys distinctions: `ℌ` (mathematical H) becomes `H`, superscripts collapse, the math symbol `∑` may merge with Greek sigma in some contexts. Do not NFKC content you must render faithfully.

**macOS filename round-trip.** A file created as `é` (NFC) may be listed back by the OS as `e`+combining-mark (NFD). String-compare against your in-memory NFC name and it "does not exist." Normalize both sides.

**Collation is not transitive across locales.** A list sorted "correctly" for German is "wrong" for Swedish. There is no global order; caching a sort and serving it to all locales is a defect.

**Combining-mark stacking and ordering.** Multiple combining marks on one base have a canonical order. Two visually identical strings with marks in different source order are canonically equal only after normalization; comparing them raw fails.

**`toUpperCase` changes length.** `"ß".toUpperCase()` → `"SS"`. Code that assumes case operations preserve length (buffer sizing, column alignment) breaks.

**Zalgo / unbounded combining marks.** A base character can carry arbitrarily many combining marks (the "Zalgo text" effect). This is valid Unicode but can be abused to overflow rendering or inflate length; some systems cap the number of combining marks per base.

---

## Summary

- The same text has **multiple valid Unicode spellings**; **normalization** (NFC/NFD/NFKC/NFKD) collapses them. Store **NFC**; canonicalize identities with **NFKC_Casefold**.
- **Canonical** equivalence preserves the character; **compatibility** equivalence (NFKC/NFKD) is lossy and flattens ligatures, width, and styling.
- A **grapheme cluster** is the human "character" — often many code points (combining marks, ZWJ emoji, skin tones, flags). Count, truncate, and reverse by grapheme.
- **Case folding** is for matching and must use the **invariant locale**; `toLowerCase`/`toUpperCase` are locale-sensitive (Turkish `i`, German `ß`, Greek final sigma) and for display only.
- **Collation** sorts in locale-tailored order, not code-point order. Use a collator, never `<`.
- The senior discipline: **normalize before comparing/hashing/sorting/storing**, carry locale explicitly, and reserve correctness-heavy operations for identity, search, sort, and filenames.

The next level, `professional.md`, covers how strings are *stored* (JVM compact strings/JEP 254, Python PEP 393, SSO, ropes, interning) and how attackers weaponize everything on this page (homoglyph/IDN spoofing, Trojan Source, overlong UTF-8, normalization filter bypass), plus the real incidents that resulted.
