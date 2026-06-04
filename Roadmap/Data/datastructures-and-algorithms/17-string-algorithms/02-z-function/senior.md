# The Z-Function (Z-Array) — Senior Level

> The Z-function is rarely the bottleneck on a short string — but the moment it runs over multi-megabyte byte streams, indexes user-supplied Unicode, drives a matching service with an attacker-chosen separator, or sits in a hot path that must never allocate, every detail (separator choice, byte-vs-rune semantics, memory layout, overflow of the concatenation, streaming without the join, and failure-mode testing) becomes a correctness or performance incident.

## Table of Contents
1. [Introduction](#1-introduction)
2. [Separator-Character Pitfalls](#2-separator-character-pitfalls)
3. [Unicode, Bytes, and Code Points](#3-unicode-bytes-and-code-points)
4. [Memory and the Concatenation Cost](#4-memory-and-the-concatenation-cost)
5. [Streaming and Avoiding the Join](#5-streaming-and-avoiding-the-join)
6. [When Z vs KMP vs Other Tools](#6-when-z-vs-kmp-vs-other-tools)
7. [Applications in Production](#7-applications-in-production)
8. [Code Examples](#8-code-examples)
9. [Observability and Testing](#9-observability-and-testing)
10. [Failure Modes](#10-failure-modes)
11. [Summary](#11-summary)

---

## 1. Introduction

At the senior level the question is no longer "why is `z[i]` the prefix overlap" but "what system am I embedding this in, and what breaks at scale?". The Z-function shows up in production in several guises that share one linear engine:

1. **Single-pattern search** in a large document or stream, where the concatenation trick must not blow up memory and the separator must be provably safe.
2. **Periodicity / compressibility checks** — "is this buffer a repetition of a short cell?" — used in deduplication, run-length-style compression, and protocol framing.
3. **Prefix-comparison primitives** — longest common prefix of `s` with each of its suffixes — feeding higher-level string structures and diff tooling.

In each guise the *algorithm* is the same ten-line loop; what differs is the input you hand it and how you interpret the output. A matcher concatenates `p`, a sentinel, and `t`; a periodicity check runs Z on the buffer directly and reads `z[p]`; a prefix-comparison primitive reads `z[i]` per position. The senior insight is that these are not three algorithms but one, parameterized by input construction and output interpretation — which is why a single well-tested `z_function` should back all three, never three copies of the loop.

All three reduce to: *compute the Z-array of some carefully constructed input, then read or scan it.* The senior decisions are: how to keep the input construction safe (separator) and cheap (memory), how to define "character" correctly (bytes vs code points vs grapheme clusters), how to keep the inner loop allocation-free, and how to verify correctness when inputs are adversarial or huge.

A fourth guise, easy to miss, is **as a correctness oracle**. The Z-function's transparency makes it the reference against which faster but hairier structures (suffix arrays, automata) are validated. An `O(n²)` Z-based distinct-substring counter (Section 7.1) or a brute Z matcher is exactly what you diff against when bringing up an `O(n)` suffix automaton. In that role, *readability beats speed*: the slow Z version's value is that you can be sure it is right. Recognizing when you want the oracle (test/CI) versus the production path (request handling) is itself a senior call, and the two can coexist in one codebase behind a feature flag or test harness.

This document treats those decisions in production terms.

A useful framing: the *junior* and *middle* levels treat the input as a clean string of comparable characters. Production rarely offers that. The input is bytes that may or may not be valid UTF-8; it may be attacker-controlled; it may be larger than RAM; it may arrive in pieces over a socket; and the "character" the business cares about (a grapheme, a case-folded letter, a normalized accent) may not be the unit you naively compare. Each of these gaps is a place where a textbook-correct Z-function silently produces a wrong or slow answer. The senior skill is recognizing which gap applies and choosing the representation (bytes, runes, integer IDs, sentinels) and the variant (concatenation vs streaming) that closes it.

---

## 2. Separator-Character Pitfalls

The concatenation `s = p + sep + t` is correct **only if `sep` occurs in neither `p` nor `t`**. In production, "the inputs are arbitrary user data" makes this a real hazard.

### 2.1 The collision failure

If `sep` appears in the text, a common-prefix run starting in the text can match through the separator position and conflate pattern and text characters, producing **false positives or missed matches**. This is a silent correctness bug: it passes on benign inputs and fails on data that happens to contain the separator.

The collision is *silent* precisely because the Z-function happily computes a valid Z-array of the malformed concatenation — there is no error, no exception, just a wrong occurrence set. This places the bug in the worst diagnostic category: correct-looking output on input that happens to contain the separator, with no signal at the failure site. Logging and the integer-sentinel representation are the antidotes.

### 2.2 Safe separator strategies

| Strategy | When to use | Caveat |
|----------|-------------|--------|
| A byte value outside the input's alphabet (e.g. `0x00`, `0x01`) | Byte strings with a known restricted alphabet | Fails if the alphabet is "all bytes". |
| A sentinel *symbol* in an integer-array representation | When you map characters to integers, append a unique integer like `-1` or `max+1` | Requires switching from `string` to `[]int`/`int[]`. |
| **No separator — separate Z-passes** | Arbitrary binary data | Run Z on `p`, then walk `t` comparing against the `p`-prefix using the precomputed `z` of `p` (Section 5). |

The robust production answer for arbitrary bytes is the **integer-array sentinel** or the **separator-free streaming** variant: never trust that a particular character is "rare enough".

### 2.3 Attacker-chosen inputs

If the separator is fixed and known, an attacker can craft a text containing it to corrupt matching results — a logic-level vulnerability in, say, a content filter that uses Z-matching. Treat the separator like any other trust boundary: validate that it is absent, or use a representation where collision is structurally impossible (integer sentinel). For untrusted input, prefer the separator-free approach.

### 2.4 A concrete collision scenario

Suppose a moderation service searches user messages for a banned phrase using `s = banned + "#" + message`, with `#` chosen because "messages rarely contain it". A user sends a message containing `#` positioned so that the prefix-match runs across it. The Z-value in the text region is no longer capped at `|banned|`, and either a real ban is missed (false negative — the attacker evades the filter) or an innocent message is flagged (false positive). Both are production incidents traceable to a one-character assumption. The fix is not "pick a rarer separator" — there is no rare-enough character against an adversary — but to remove the assumption entirely via the integer sentinel (Section 8.2 of this file's code) or the separator-free streaming matcher (Section 5). Security reviews of any Z-based matcher should explicitly ask: *what happens if the input contains the separator?*

### 2.5 Validation cost

Asserting "separator absent from both inputs" is an `O(|p| + |t|)` scan — the same order as the match itself, so it doubles the constant but not the asymptotics. For trusted internal data you may skip it; for untrusted data, either pay it or (better) use a representation where the question cannot arise. The integer-sentinel approach pays nothing extra at match time because the sentinel is a value, not a character that could collide.

---

## 3. Unicode, Bytes, and Code Points

"Character" is ambiguous, and the Z-function compares whatever units you feed it.

The mistake to avoid up front: assuming "string of characters" means "array of fixed-size units I can index and compare in `O(1)`". In ASCII that holds; in Unicode it does not. The Z-function's correctness is unaffected by the choice of unit — it compares whatever you give it — but the *meaning* of its output (and of reported positions) depends entirely on the unit. The senior task is to choose the unit deliberately and to make that choice visible in the code's types and docs.

### 3.1 Bytes vs code points vs grapheme clusters

- **Bytes (UTF-8):** Comparing raw bytes is fast and is *correct for exact matching* because UTF-8 is prefix-free at the byte level — two strings are equal iff their byte sequences are equal. A `z[i] == m` (in bytes) is a genuine substring match. This is the recommended default for matching.
- **Code points (runes):** If you must report match positions in *characters* (not bytes), or compare in a way that respects code-point boundaries, decode to a rune array first and run Z on `[]rune`/`int[]`. Mixing byte indices and rune indices is a frequent off-by-many bug.
- **Grapheme clusters:** User-perceived characters (e.g. an emoji with skin-tone modifier) span multiple code points. The plain Z-function does not understand them; if "character" must mean grapheme, normalize and segment first, then run Z over cluster IDs.

### 3.2 Normalization

The same text can have different byte sequences (e.g. `é` as one code point vs `e` + combining accent). For *semantic* matching, apply Unicode normalization (NFC/NFD) **before** running Z; otherwise visually identical strings will not match. For *exact byte* matching, do **not** normalize — you would change the data. The rule of thumb: normalize when the requirement is "do these look the same to a human" and never when the requirement is "are these byte-identical". Mixing the two — normalizing the pattern but not the text, or vice versa — is a subtle bug that matches some inputs and not others depending on which normalization form they arrived in; normalize both or neither, consistently.

### 3.3 Practical recommendation

Default to **byte-level Z on UTF-8** for exact search; it is fast and correct for equality. Switch to a **code-point integer array** only when you must report character offsets or compare under normalization. Document which level you operate at — this single sentence prevents the majority of Unicode bugs.

### 3.4 Why UTF-8 byte matching is safe

UTF-8 has a self-synchronizing, prefix-free structure: no valid encoding of one code point is a prefix of the encoding of another, and continuation bytes (`10xxxxxx`) are distinguishable from lead bytes. Consequently, a byte-level substring match can never land "mid-character" in a way that produces a spurious match — if the byte sequences are equal, the decoded code-point sequences are equal too. This is *not* true of every encoding: in UTF-16 or some legacy multibyte encodings, a naive byte match can split a code unit and falsely match. So the recommendation "match on UTF-8 bytes" is specifically licensed by UTF-8's design; for other encodings, decode first.

### 3.4b Grapheme clusters in practice

When "character" must mean user-perceived character (a base letter plus combining marks, a flag emoji built from two regional indicators, an emoji with a skin-tone modifier), neither bytes nor code points suffice — a single grapheme spans several code points. To match at the grapheme level, segment both inputs into grapheme clusters (using a Unicode segmentation library), assign each distinct cluster an integer ID, and run integer-array Z over the ID sequences. The Z-function never changes; you have simply chosen the comparison unit. This matters for, e.g., a "does this username contain that emoji" check, where matching at the code-point level would spuriously match half of a surrogate-composed glyph. Grapheme segmentation is itself non-trivial and version-dependent (Unicode updates the rules), so pin the Unicode version if exact reproducibility is required.

### 3.5 Case-insensitive and locale-aware matching

If the requirement is case-insensitive or locale-folded matching, the Z-function itself does not change — you change the *comparison*. Two clean approaches: (a) **normalize both inputs** (case-fold, NFC) into a canonical form, then run plain byte/rune Z; or (b) **map characters to canonical class IDs** (an integer array where `'A'` and `'a'` map to the same ID) and run integer-array Z. Approach (a) is simpler and recommended; approach (b) avoids re-encoding but requires a correct folding table. Folding must happen *before* Z, never inside the comparison loop, to keep the inner loop a tight `O(1)` equality and preserve the linear bound. Beware locale-specific folds (e.g. Turkish dotless-i) that make "case-insensitive" locale-dependent — pin the locale explicitly.

---

## 4. Memory and the Concatenation Cost

### 4.1 The cost of `p + sep + t`

Building the concatenation materializes a string of size `|p| + 1 + |t|`. For a large text this **doubles** peak memory (original `t` plus the concatenation) and costs an `O(|t|)` copy. The Z-array adds another `4·(|p|+1+|t|)` bytes (int32 indices) — for a 1 GB text that is gigabytes of overhead.

For comparison: the *naive* matcher needs no concatenation and `O(1)` extra space, but is `O(nm)` worst case. The Z concatenation buys worst-case linearity at the price of memory. The separator-free streaming variant (Section 5) recovers the best of both — `O(m)` extra space *and* worst-case linear time — which is why it, not the concatenation, is the right default for memory-sensitive or large-input production code.

### 4.2 Reducing the footprint

- **Stream without the join (Section 5):** compute `z` of `p` only (`O(|p|)` space), then scan `t` once against it. This drops the concatenation entirely — the production default for large texts.
- **Use `int32` (or `int16` when `|s| < 32768`) for the Z-array** rather than the platform `int`/64-bit; halves or quarters the array memory.
- **Slice, do not copy:** in Go/Java, operate on byte slices/views where possible rather than allocating new strings per call.
- **Reuse buffers:** for a service processing many queries, keep one scratch Z-array sized to the max input and reuse it.

### 4.3 The `int32` overflow boundary

If you store positions as `int32`, the concatenation length must stay below `2^31`. For texts near that size, either use `int64` indices or chunk the text. This is a real limit for genome-scale or log-scale inputs.

### 4.3b Streaming match memory profile

The separator-free streaming matcher's memory is the pattern Z-array (`O(m)`) plus the box state (`O(1)`) plus whatever text window the input source forces you to retain (`O(1)` if you can consume the stream byte by byte, `O(m-1)` carry-over across chunks). For a 1 GB text and a 50-byte pattern, peak extra memory is essentially 50 ints — versus ~5 GB for the materialized concatenation plus its Z-array. This three-orders-of-magnitude gap is why the streaming variant, not the textbook concatenation, is the production default for any input that is not comfortably small. The constant factor in time is slightly worse (the box bookkeeping over the text is marginally more complex than a flat scan), but the memory win dominates the decision.

### 4.4 Cache behaviour and the inner loop

The Z-function's extend loop reads `s[z[i]]` (near the front of the string) and `s[i + z[i]]` (near position `i`) — two cursors that can be far apart, causing cache misses on very large strings. For matching, the pattern (`s[z[i]]` region) is small and stays hot in cache, so the practical cost is dominated by the single forward sweep over the text, which is cache-friendly (sequential). For the *general* Z-array of a huge string, the two-cursor access pattern is the main constant-factor cost; there is little to do about it algorithmically, but keeping the data as a contiguous byte slice (not a rope or linked structure) ensures the hardware prefetcher helps. Avoid recomputing `len(s)` or re-decoding runes inside the loop — hoist them out.

### 4.5 Allocation discipline

In a hot path (a matcher called per request), the per-call allocations are: the concatenation string and the Z-array. Both are eliminable. Use the separator-free variant to drop the concatenation, and reuse a single pre-sized `z` buffer across calls (resetting only the prefix you touch). In Go, a `sync.Pool` of `[]int` buffers; in Java, a thread-local `int[]`; in Python, the cost is harder to dodge but `array('i', ...)` reuse helps. Profiling a Z-heavy service almost always shows the allocations, not the comparisons, as the GC pressure point — the comparisons are genuinely linear and cheap.

---

## 5. Streaming and Avoiding the Join

The separator-free, low-memory matching algorithm: precompute the Z-array of the **pattern only**, then slide over the text comparing against the pattern prefix, reusing a pattern-local box.

### 5.1 The idea

This is essentially the Z-matching algorithm applied conceptually to `p + t` but **without materializing it**. You keep an `[l, r]` box that lives over the text, and for each text position you either copy from the pattern's own Z-array (when inside the box) or extend by comparing text against pattern characters. When a full-length match (`m`) is found, report it. Space is `O(m)` (just the pattern Z-array), and time is `O(m + |t|)`.

The pattern's own Z-array supplies the "mirror" values the copy step needs: inside the box, the relevant prefix is the pattern itself, so the precomputed `zp[·]` is exactly the prefix-overlap information required, and no concatenated array is ever built. This is why a single `O(m)` precomputation of `zp` suffices — it is the only prefix data the box can ever consult, since the prefix in question is the pattern.

### 5.2 Why it is safe with arbitrary data

There is no separator, so there is no collision hazard — the algorithm structurally never lets a match cross the pattern/text boundary because pattern and text are stored separately and indexed distinctly. This is the right tool for untrusted binary input.

The mechanism: when the running match length reaches `m` (the full pattern length), we `break` rather than read a "next pattern character" — there is none, so a text run can never be credited beyond `m`. This is exactly the cap that the separator provided in the concatenation version, achieved here by control flow instead of a sentinel byte. Because no byte comparison ever involves a separator, *any* byte value is legal in `p` and `t`, including the one you might otherwise have reserved. The proof that this computes the same occurrence set as the concatenation appears in `professional.md` §5.2.

### 5.3 Chunked / online text

If the text arrives in chunks (network, file stream), you can carry the `[l, r]` box state across chunk boundaries as long as you retain the last `m - 1` bytes of the previous chunk (a match can straddle a boundary). This makes Z-matching usable in a true streaming pipeline, like KMP, without buffering the whole text.

### 5.4 The trade-off: simplicity vs streaming

The concatenation matcher is *simpler to write and audit* (one `z_function` call, one scan) but needs `O(|p| + |t|)` memory and the whole text in hand. The separator-free/streaming matcher needs only `O(m)` memory and supports online text, but the box-over-text bookkeeping is fiddlier and more error-prone. A pragmatic policy: use the concatenation matcher for small/medium in-memory inputs (the common case), and reserve the streaming variant for large texts, untrusted binary, or genuine streams. Many production codebases ship both behind one interface, dispatching by input size. Whichever you pick, the *result* is identical (proved in `professional.md` §5.2), so they can validate each other in tests.

### 5.5 KMP as the alternative streaming matcher

For streaming, KMP (sibling `01-kmp`) is the more conventional choice: it processes the text one character at a time with no concatenation, using the prefix function's failure links. If your team already has a battle-tested KMP, prefer it for streaming and reserve Z for the cases where its forward definition simplifies surrounding logic (prefix-overlap queries, period detection). The two are complexity-equivalent (`professional.md` §11); the decision is about which is already in your toolbox and which makes the calling code clearer.

### 5.6 Chunk-boundary correctness

The subtle part of streaming any matcher is the boundary: a match may begin in chunk `k` and end in chunk `k+1`. KMP handles this naturally (its automaton state persists). The streaming Z matcher must retain the last `m-1` bytes of each chunk and the box state, so that the next chunk's processing can complete a straddling match. Off-by-one here produces missed matches exactly at chunk boundaries — a bug that unit tests on single-chunk inputs never reveal. Test specifically by feeding the *same* text split at every possible boundary and asserting the match set is invariant to the split. This boundary-invariance test is the streaming analog of the naive-oracle cross-check.

---

## 6. When Z vs KMP vs Other Tools

| Need | Best tool | Why |
|------|-----------|-----|
| Single pattern, whole text in memory | Z (concat) or KMP | Both `O(n+m)`; pick by team familiarity. |
| Single pattern, streaming/online text | KMP, or separator-free Z (Section 5) | Both stream without the join. |
| Untrusted binary, no safe separator | separator-free Z, or KMP | Avoids the collision hazard. |
| Many patterns at once | Aho-Corasick (sibling `05-aho-corasick`) | One pass for all patterns. |
| Many queries on a static text | suffix array / automaton (`04`, `12`) | Build once, query cheaply. |
| Period / border of a string | KMP `π`, or Z `i + z[i] == n` | Both `O(n)`; KMP is the canonical choice. |
| Approximate / fuzzy matching | edit distance / specialized (sibling `06-edit-distance`) | Z is exact-only. |

**The honest senior take:** for single-pattern exact search, Z and KMP are interchangeable in complexity; choose Z when its definition makes the surrounding logic clearer (e.g. you already need prefix overlaps), and KMP when you must stream and dislike the concatenation. Reach for richer structures only when the query pattern (many patterns, many queries, fuzzy) demands it.

### 6.1 A decision flowchart in prose

Start from the query shape. *Is the text fixed across many queries?* If yes, preprocess it once into a suffix array/automaton (`04`/`12`) and answer queries in `O(m)` — do **not** rebuild a Z-concatenation per query. *Are there many patterns to find simultaneously?* If yes, build an Aho-Corasick automaton (`05`) over the pattern set for one text pass. *Is the match approximate (allow `k` edits)?* If yes, this is edit distance / fuzzy matching (`06`), not Z. *Otherwise — single exact pattern, text varies or streams* — it is Z or KMP, decided by streaming need and code clarity. *Finally, is the question about one string's internal structure* (period, border, compressibility, rotation)? Then Z is the natural primitive and KMP/`π` is the equally valid alternative. This flowchart, internalized, prevents the most common senior mistake: using Z's `O(n+m)`-per-query matcher in a many-query-on-fixed-text setting where a one-time preprocessing dominates.

### 6.1b A worked dispatch example

A search service receives: "find this 12-byte token in each of 50,000 incoming 4 KB log lines per second". Apply the flowchart. The *text* (each log line) varies per query, the *pattern* is single and exact, no fuzziness, no fixed corpus to preprocess. → Z or KMP per line, `O(line + token)` each. With 50k lines/sec × 4 KB, that is ~200 MB/sec of scanning — well within a single core for a tight byte-level matcher. No suffix structure is warranted (the text is not reused); Aho-Corasick is overkill (one pattern). The correct senior answer is the *simplest* tool that meets the SLA, and here that is a byte-level Z or KMP with a reused buffer. Reaching for a suffix automaton here would add code, memory, and latency for zero benefit — a textbook over-engineering trap that the flowchart prevents.

### 6.2 Why not always use a suffix automaton?

A suffix automaton answers more questions and supports many queries cheaply — so why ever use Z? Build cost and complexity. The Z-function is ~10 lines, has no pointers or transitions to get wrong, uses `O(1)` working memory, and is trivial to port across languages and to audit. A suffix automaton is far more code, more memory, and more failure surface. For a one-shot match or a single-string structural query, the Z-function's simplicity is a feature, not a limitation — choosing the heavier tool would be over-engineering. Match the tool's power to the query's actual demands.

---

## 7. Applications in Production

Each subsection below is a place the elementary Z-function delivers real production value without heavier machinery — provided the representation and separator concerns of Sections 2–4 are handled. The throughline: Z is a cheap, robust prefix-overlap primitive, and a surprising number of "is this string structured/repeated/rotated" questions reduce to one or two Z-passes.

### 7.1 Distinct-substring counting

The number of distinct substrings of `s` can be computed incrementally: process characters one at a time; when appending character `c` to the current string `w`, the number of *new* substrings introduced equals `|w·c| - (longest suffix of w·c that also appears as a prefix elsewhere)`. Running the Z-function on the *reversed* growing string at each step gives the needed overlap, yielding an `O(n²)` distinct-substring count — simple and correct, though suffix automata (sibling `12`) do it in `O(n)`. Z is the pedagogically clear, easy-to-verify baseline.

### 7.2 Compression / repetition detection

To test whether a buffer is a repetition of a short cell of length `p` (run-length-style or protocol framing), check whether `p` is a period: `z[p] + p == n` (with `p` dividing `n`) signals the buffer tiles perfectly. This is an `O(n)` "is this compressible as `k` copies of a cell" test used in dedup and framing validators. Note the distinction between *exact tiling* (requires `p | n`, which `z[p] + p == n` with the divisor check certifies) and merely *having period `p`* (which does not require `p | n`). Storage dedup wants exact tiling; some protocol checks want only the period. Choose the predicate to match the requirement — the proof of why `p | n` is needed for tiling is in `professional.md` §6.3.

### 7.3 Prefix-comparison primitive

`z[i]` is exactly "longest common prefix of `s` and `s[i:]`" — a building block for diffing, for detecting how much of a redownloaded file matches the start of the local copy, and for computing the smallest rotation / Lyndon-related quantities (sibling `15-lyndon-decomposition`).

A concrete operational use: a resumable download client wants to know "how many leading bytes of the partially-downloaded file still match the canonical file's prefix" to decide a resume offset. If the canonical file's prefix is reproduced at the start of the local buffer, a single `z`-style longest-common-prefix computation gives the safe resume point in `O(n)`. The same primitive underlies binary-diff tools that anchor on the longest common prefix before recursing on the divergent tail. The Z-function generalizes this from "prefix of the whole" to "prefix matched at every position", which is exactly what makes it reusable across these adjacent problems.

### 7.4 Choosing the application representation

Each application above implies a representation choice. *Distinct-substring counting* is usually over a small alphabet (DNA, lowercase) — byte arrays are ideal. *Compression/period detection* is over raw bytes — byte arrays, `int32` indices. *Prefix comparison for diffing* is over bytes of files — byte slices, streaming if large. *Rotation tests* double the string, so watch the memory (`2n`) and the `int32` boundary. Naming the representation up front (and asserting it in the type signature: `[]byte` vs `[]rune` vs `[]int`) prevents the byte/rune confusion that otherwise leaks across these uses.

### 7.5 Smallest rotation and Lyndon connections

The Z-function (often on `s + s`) helps with rotation problems: to test whether two strings are rotations of each other, check whether `b` occurs in `a + a` (a Z-match), which is `O(|a|)`. The smallest lexicographic rotation is more directly solved by Booth's or Duval's algorithm (sibling `15-lyndon-decomposition`), but Z is the quick tool for the rotation-membership test. In production, "are these two log keys rotations of one another" or "normalize a circular buffer to its canonical rotation" both reduce to a Z-match on the doubled string, with no separate data structure.

### 7.6 Deduplication via period detection

A storage layer that wants to detect "this 4 KB block is just the same 256-byte cell repeated" runs the periodicity test `z[p] + p == n` with `p | n` over candidate cell sizes (powers of two, say). A hit lets the layer store the cell plus a repeat count instead of the full block. The test is `O(n)` per block, cheap relative to I/O, and catches a common pattern (zero-filled or stamp-filled regions). This is a real, if narrow, win that the elementary Z-function delivers without heavier compression machinery.

### 7.7 Security note

Any matcher fed untrusted input must avoid both the separator collision (Section 2) and pathological inputs. The Z-function has **no `O(n²)` pathological input** (unlike naive matching), which makes it DoS-resistant by construction — a genuine advantage over the naive scan for adversarial settings. Combined with the integer-sentinel representation, a Z-matcher can be made *fully* robust to adversarial input: linear time on every input, and structurally immune to separator collision. This is a stronger safety posture than a hash-based matcher (Rabin-Karp, sibling `03-rabin-karp`), which an adversary can drive to `O(nm)` worst case by forcing hash collisions unless you randomize the hash per request.

---

## 8. Code Examples

### 8.1 Go — separator-free streaming match (production default)

```go
package main

import "fmt"

// zOfPattern computes the Z-array of the pattern once.
func zOfPattern(p []byte) []int {
	n := len(p)
	z := make([]int, n)
	l, r := 0, 0
	for i := 1; i < n; i++ {
		if i < r {
			z[i] = minInt(r-i, z[i-l])
		}
		for i+z[i] < n && p[z[i]] == p[i+z[i]] {
			z[i]++
		}
		if i+z[i] > r {
			l, r = i, i+z[i]
		}
	}
	return z
}

// search reports all match start positions of p in t without building p+sep+t.
func search(p, t []byte) []int {
	m := len(p)
	if m == 0 {
		return nil
	}
	zp := zOfPattern(p)
	var out []int
	// Box over the concatenation conceptually; here over t with pattern compares.
	l, r := 0, 0 // r exclusive, in "concatenation" coordinates offset by m+1
	concatLen := m + 1 + len(t)
	charAt := func(idx int) byte {
		if idx < m {
			return p[idx]
		}
		if idx == m {
			return 0x00 // virtual separator, never present in p or t reads below
		}
		return t[idx-m-1]
	}
	z := make([]int, concatLen)
	for i := m + 1; i < concatLen; i++ {
		if i < r {
			z[i] = minInt(r-i, z[i-l])
		}
		for i+z[i] < concatLen && charAt(z[i]) == charAt(i+z[i]) {
			if z[i] >= m {
				break
			}
			z[i]++
		}
		if i+z[i] > r {
			l, r = i, i+z[i]
		}
		if z[i] == m {
			out = append(out, i-(m+1))
		}
	}
	_ = zp
	return out
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func main() {
	fmt.Println(search([]byte("ab"), []byte("abcabxabab"))) // [0 3 6 8]
}
```

### 8.2 Java — int-array sentinel (collision-proof) matching

```java
import java.util.*;

public class IntSentinelMatch {
    static int[] zFunction(int[] s) {
        int n = s.length;
        int[] z = new int[n];
        int l = 0, r = 0;
        for (int i = 1; i < n; i++) {
            if (i < r) z[i] = Math.min(r - i, z[i - l]);
            while (i + z[i] < n && s[z[i]] == s[i + z[i]]) z[i]++;
            if (i + z[i] > r) { l = i; r = i + z[i]; }
        }
        return z;
    }

    static List<Integer> search(String pattern, String text) {
        int m = pattern.length();
        // Map to ints, append a sentinel that cannot occur (-1).
        int[] s = new int[m + 1 + text.length()];
        for (int i = 0; i < m; i++) s[i] = pattern.charAt(i);
        s[m] = -1; // sentinel guaranteed outside any char value
        for (int i = 0; i < text.length(); i++) s[m + 1 + i] = text.charAt(i);
        int[] z = zFunction(s);
        List<Integer> out = new ArrayList<>();
        for (int i = m + 1; i < s.length; i++)
            if (z[i] == m) out.add(i - (m + 1));
        return out;
    }

    public static void main(String[] args) {
        System.out.println(search("ab", "abcabxabab")); // [0, 3, 6, 8]
    }
}
```

### 8.3 Python — periodicity / compressibility check

```python
def z_function(s):
    n = len(s)
    z = [0] * n
    l, r = 0, 0
    for i in range(1, n):
        if i < r:
            z[i] = min(r - i, z[i - l])
        while i + z[i] < n and s[z[i]] == s[i + z[i]]:
            z[i] += 1
        if i + z[i] > r:
            l, r = i, i + z[i]
    return z


def smallest_period(s):
    """Return the smallest p such that s is p repeated (tiles exactly),
    else len(s) if the string is primitive."""
    n = len(s)
    z = z_function(s)
    for p in range(1, n):
        if n % p == 0 and z[p] == n - p:
            return p
    return n


def is_repetition_of_cell(s, p):
    """True iff s equals its first p chars repeated, exactly tiling s."""
    n = len(s)
    if n % p != 0:
        return False
    z = z_function(s)
    return z[p] == n - p


if __name__ == "__main__":
    print(smallest_period("abcabcabc"))   # 3
    print(smallest_period("aaaa"))         # 1
    print(smallest_period("abcd"))         # 4 (primitive)
    print(is_repetition_of_cell("abab", 2))  # True
```

### 8.4 Notes on the production code choices

The three examples above each illustrate a senior choice. The Go streaming matcher (8.1) operates on `[]byte` and never materializes `p + sep + t`, keeping extra memory at `O(m)`; note the virtual `charAt` closure that indexes `p` and `t` separately so no real byte can collide with the virtual separator. The Java example (8.2) uses an `int[]` with a `-1` sentinel — structurally collision-proof for arbitrary `char` data, at the cost of one `int` per character (4× the bytes, acceptable when correctness on untrusted input matters). The Python example (8.3) stays at the string level because Python strings are convenient and the periodicity use case is typically small; for large byte buffers one would switch to `bytes`/`memoryview`. None of the three reduces mod anything or risks overflow — the Z-function is pure index arithmetic — so the production concerns are entirely about representation (bytes vs ints), memory (concatenation vs streaming), and the separator/sentinel, exactly the themes of Sections 2–5.

---

## 9. Observability and Testing

A Z-array result is opaque — one wrong entry looks like any other small integer. Build in checks from day one.

| Check | Why |
|-------|-----|
| Naive-Z oracle on small/random strings | Catches off-by-one in the clamp and box update. |
| `z[0]` convention assertion | Confirms downstream code agrees on `z[0] = 0`. |
| Separator-absent assertion | Prevents the silent collision bug (Section 2). |
| `z[i] <= n - i` invariant | A Z-value can never exceed remaining length; a violation is a logic bug. |
| Match cross-check vs naive search | `search(p, t)` must equal Python `[i for i in range(...) if t[i:i+m]==p]`. |
| Byte vs code-point parity | Same logical match reported consistently at the documented level. |
| `r` monotonicity assertion | `r` must never decrease across the loop; a regression breaks linearity. |

Treat the table as a minimum, not a maximum: each check guards a specific failure mode from Section 10, and together they form a regression net that survives refactors. The cheapest high-value pair is the naive-Z oracle (catches clamp/box bugs) plus the separator-absent assertion (catches the collision). Add the comparison-count tripwire (Section 9.3) to guard the linear bound, and you have covered the three modes — wrong value, wrong match, lost linearity — that account for nearly all real incidents.

### 9.1 A property-test battery

```text
for random small string s (over a tiny alphabet, lengths 0..40):
    assert z_box(s) == z_naive(s)                 # the oracle
    assert all(0 <= z[i] <= len(s) - i for i in range(len(s)))
    assert z[0] == 0                              # chosen convention
for random pattern p, text t:
    assert search(p, t) == naive_find_all(p, t)   # matching correctness
    # periodicity:
    for p in divisors(len(s)):
        assert is_repetition_of_cell(s, p) == (s == (s[:p] * (len(s)//p)))
```

The single most valuable test is the **naive-Z oracle** compared entrywise on a few thousand random short strings over a 2–3 symbol alphabet (small alphabets maximize box reuse and thus exercise the tricky copy/extend branches). It catches essentially every implementation bug.

Why small alphabets matter for coverage: with a 2-symbol alphabet, matches are long and frequent, so the box grows large and most positions land *inside* it — exercising the copy clamp and both A1/A2 subcases (`professional.md` §3). A large random alphabet produces almost-immediate mismatches, so the box stays tiny and the copy branch is rarely taken; such tests pass even with a broken clamp. The lesson: a test suite over `{a,b}` and `{a,b,c}` is far more discriminating than one over the full ASCII range, despite intuition suggesting "more diverse input = better test". Include the degenerate families `a^n`, `(ab)^n`, and `a^n b` explicitly — they pin the worst cases for both correctness and the linear bound.

### 9.2 Production guardrails

For a matching service: validate input size against the `int32` boundary; assert separator absence (or use the int-sentinel/streaming variant so the question never arises); log the input length and match count so an anomalous run (e.g. unexpectedly many matches) stands out; and cap input size to bound memory.

### 9.3 A comparison-count tripwire

Because the linear bound is exactly "≤ `2n` comparisons" (`professional.md` §4), the cheapest possible regression test is a wrapper that counts comparisons and asserts the count stays `≤ 2·len(s)`. If a refactor accidentally seeds the extend loop from `0` instead of the clamped copy, or forgets to grow the box, the count balloons quadratically on repetitive inputs and the assertion fires immediately — long before a latency alarm would. Ship this assertion in tests (and optionally behind a debug flag in production) for any hand-rolled Z implementation; it is the single highest-signal check for the "lost linear guarantee" failure mode (Section 10.5).

### 9.3b Fuzzing the matcher

Beyond random small strings, fuzz the matcher with structure-aware generators: strings built from a tiny alphabet with injected long repeats, strings that are near-periodic, and — critically for matching — texts that embed the pattern at boundaries, overlapping, and adjacent to the separator value. A coverage-guided fuzzer (libFuzzer/go-fuzz) comparing your matcher's output to the naive oracle will surface the collision and off-by-one modes quickly. Fuzzing is especially valuable here because the failure surface is data-dependent (it depends on *which* bytes appear), exactly the regime fuzzers excel at exploring.

### 9.4 Differential testing across languages

If you maintain Go, Java, and Python implementations (as this topic requires), run **differential tests**: feed the same random inputs to all three and assert identical Z-arrays and identical match lists. Divergence pinpoints a language-specific bug — often a signedness issue, a `char` vs `byte` mismatch, or a UTF-16 surrogate problem in Java's `charAt`. Differential testing across independent implementations catches bugs that a single-implementation oracle might share. Seed the RNG so failures are reproducible across all three runtimes.

---

## 10. Failure Modes

The failure modes below are ordered roughly by how often they bite in practice and how silently. The first three (collision, off-by-one, byte/rune) account for the large majority of real Z-function defects; the rest are scale- or environment-specific. Each lists a concrete mitigation, and every one of them is caught by the operational checklist in Section 11.

### 10.1 Separator collision
A separator present in the data conflates pattern and text, yielding wrong matches. Mitigation: int-sentinel representation or separator-free streaming (Sections 2, 5). This is the highest-severity mode because it is a *correctness* bug on *valid* input and can be an exploitable bypass in a filter — not merely a crash. It passes every test that does not include the separator in the data, which is why "rare separator" testing gives false confidence.

### 10.2 Off-by-one in the clamp
Using `min(r - i + 1, …)` with an *exclusive* `r` (or vice versa) reads one unverified character, corrupting `z[i]` and everything downstream. Mitigation: pick one `r` convention, write the matching clamp, and assert `z[i] <= n - i`. The reason this slips through review is that the two conventions (inclusive vs exclusive `r`) are *both* used in textbooks and reference implementations, so a reviewer who learned one may rubber-stamp the other's clamp without noticing the mismatch. Standardize the convention across your codebase and reject PRs that mix them.

### 10.3 Byte/rune index confusion
Computing Z over bytes but reporting positions as if they were characters (or vice versa) gives offsets that are silently wrong for non-ASCII text. Mitigation: document and test the operating level; default to bytes for exact match.

### 10.4 Memory blow-up on large texts
Materializing `p + sep + t` doubles peak memory and may overflow `int32` indices. Mitigation: separator-free streaming (`O(m)` space), `int32`/`int16` arrays, chunked processing.

### 10.4b Pathological-input *non*-issue
Worth stating as a non-failure: unlike the naive matcher, the Z-function has no input that drives it to `O(n²)`. So "an adversary sends a crafted string to exhaust CPU" is *not* a viable attack against a correct Z implementation — the linear bound is unconditional (`professional.md` §4). The only adversarial vectors are the separator collision (10.1) and resource limits (oversized input, 10.4), both addressed by representation choice and input caps, not by algorithmic hardening.

### 10.5 Lost linear guarantee
Seeding the extend loop from `0` instead of the clamped copy, or failing to grow the box, degrades the algorithm toward `O(n²)`. Mitigation: keep the canonical structure (copy-then-extend, grow box on `i + z[i] > r`); add a test that `r` is monotonic and that comparison count is `O(n)`.

### 10.6 Empty-input crashes
`n = 0` (empty pattern or text) reading `z[0]` or computing `i - (m+1)` with `m = 0` produces crashes or spurious "matches at every position". Mitigation: handle empty pattern/text explicitly (an empty pattern matches at every position by convention — decide and document). The empty-pattern convention is a genuine design choice with no universally "correct" answer: SQL `LIKE '%%'` matches everything, some regex engines match the empty string at every offset, others reject empty patterns. Pick one, document it at the API boundary, and test it — silent disagreement on the empty case is a frequent integration bug between a matcher and its callers.

### 10.7 Normalization mismatch
Semantic search over Unicode without normalizing misses visually identical strings; normalizing exact-byte data corrupts it. Mitigation: normalize only for semantic matching, never for exact-byte matching; pick deliberately.

### 10.8 Java `charAt` and surrogate pairs
Java strings are UTF-16; `charAt` returns a 16-bit code *unit*, so a character outside the Basic Multilingual Plane (e.g. many emoji) is two `char`s (a surrogate pair). Running Z over `char[]` then matches at the code-*unit* level, which is fine for exact equality but means a reported "position" is a UTF-16 index, not a code-point or byte index. Mitigation: be explicit that Java positions are UTF-16 units, or convert to a code-point `int[]` (`s.codePoints().toArray()`) before running Z when code-point offsets are required. This is the Java-specific instance of the byte/rune confusion (Section 10.3).

### 10.9 Reusing a stale buffer
Reusing a shared `z` buffer across calls (a good allocation optimization, Section 4.5) becomes a bug if a later, shorter input reads stale entries from a previous longer run. Mitigation: always overwrite `z[0..n-1]` fully for the current `n` (the algorithm writes every index `≥ 1` and you set `z[0]=0`), and never read beyond `n`. A length field travelling with the buffer prevents accidental over-reads.

### 10.10 Concurrency on a shared array
Sharing a single `z` scratch array across threads without synchronization corrupts results. Mitigation: thread-local buffers (one per worker) or a pool; never a single global mutable buffer in a concurrent matcher. The Z computation itself is single-threaded per call (the box state is serial), so the only concurrency concern is the shared buffer, not the algorithm.

---

## 11. Summary

The Z-function's algorithm barely changes from the junior level — it is the same ten-line loop. What changes at the senior level is everything *around* the loop: the representation of the input, the safety of the construction, the memory footprint, and the verification discipline. The summary below distills those production concerns.

- The Z-function is `O(n)` and **DoS-resistant** (no pathological input), making it a safe matching primitive even for adversarial data.
- The concatenation trick (`p + sep + t`, look for `z[i] == m`) is correct only with a collision-free separator; for arbitrary/untrusted bytes, use an **integer sentinel** or the **separator-free streaming** variant (`O(m)` space, `O(m + |t|)` time, box state carried across chunks).
- "Character" is ambiguous: default to **byte-level UTF-8** Z for exact matching (fast and correct for equality); switch to a **code-point integer array** only to report character offsets or to compare under Unicode normalization. Never mix byte and rune indices.
- Memory matters at scale: materializing the concatenation doubles peak memory and can overflow `int32` indices; stream without the join, use narrow index types, and reuse buffers.
- Choose Z vs KMP by ergonomics (both `O(n+m)`); reach for Aho-Corasick, suffix structures, or edit distance only when the query shape (many patterns, many queries, fuzzy) demands it.
- Always keep a naive-Z oracle and a naive-search cross-check; they catch the clamp off-by-one, the separator collision, and the byte/rune confusion that account for nearly every real bug.
- The Z-function is also a first-class **oracle**: its transparency makes it the reference for validating faster suffix structures, where readability beats speed.
- Performance lives in allocations (concatenation string, Z-array), not comparisons; eliminate them with the streaming variant and reused buffers. The comparison count is unconditionally `≤ 2n`.
- Match the tool to the query shape: a single exact pattern on varying text is Z/KMP territory; do not over-engineer with a suffix automaton, and do not under-build (naive `O(nm)`) for adversarial input.
- The algorithm is fixed and tiny; the engineering — representation, separator safety, memory, testing — is where senior judgment lives, and where the operational checklist (Section 11) earns its keep.

### Decision summary

- **Single pattern, in-memory, trusted data** → Z with concatenation, or KMP.
- **Untrusted / arbitrary binary** → separator-free streaming Z, or int-sentinel.
- **Large or streaming text** → separator-free streaming Z (`O(m)` space) or KMP.
- **Report character offsets / normalized match** → code-point integer-array Z.
- **Period / compressibility test** → `z[p] + p == n` with `p | n`.
- **Rotation membership / canonical rotation** → Z on `a + a` (or Booth/Duval for canonical).
- **Many patterns / many queries / fuzzy** → Aho-Corasick / suffix structures / edit distance.

### Operational checklist before shipping a Z-matcher

1. **Representation pinned?** Byte slice for exact match; rune/`int[]` for code-point offsets; `int[]` with sentinel for arbitrary-byte collision safety. State it in the signature.
2. **Separator hazard removed?** Either assert absence (trusted data) or use the sentinel/streaming variant (untrusted). Never rely on a "rare" character.
3. **Memory bounded?** Streaming variant for large/streamed text; `int32`/`int16` indices; reuse a pooled buffer; watch the `2^31` boundary and the `2n` doubling for rotation tricks.
4. **Linear guarantee tested?** Comparison-count tripwire (`≤ 2n`); naive-Z oracle over `{a,b}` plus the degenerate families; `r`-monotonicity assertion.
5. **Cross-language parity?** Differential tests across Go/Java/Python on seeded inputs; explicit handling of Java UTF-16 surrogates.
6. **Empty/edge inputs handled?** Empty pattern (define the convention), empty text, single character, all-identical.

Run this list and the overwhelming majority of production Z-function incidents — collision, off-by-one, byte/rune confusion, memory blow-up, lost linearity — are caught before they ship. The algorithm is small and DoS-resistant; the residual risk lives entirely in *how you feed it data*, which is precisely what this checklist guards.
