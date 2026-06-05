# Boyer-Moore-Horspool — Middle Level

> **Focus:** Building the single last-char-of-window shift table precisely, why the matching loop is uniform on match and mismatch, the Sunday variant's bigger jump, average-case vs `O(nm)` worst case, and an explicit comparison with full Boyer-Moore (sibling `08`) and KMP (sibling `01`).

---

## Table of Contents

1. [Introduction](#introduction)
2. [Deeper Concepts](#deeper-concepts)
3. [A Full Worked Trace](#a-full-worked-trace)
4. [Comparison with Alternatives](#comparison-with-alternatives)
4. [Advanced Patterns](#advanced-patterns)
5. [The Sunday Variant](#the-sunday-variant)
6. [Average vs Worst Case](#average-vs-worst-case)
7. [Code Examples](#code-examples)
8. [Error Handling](#error-handling)
9. [Performance Analysis](#performance-analysis)
10. [Best Practices](#best-practices)
11. [Visual Animation](#visual-animation)
12. [Summary](#summary)

---

## Introduction

At junior level the message was: Horspool keeps a single shift table, compares right-to-left, and jumps by `shift[T[i + m - 1]]`. At middle level you start asking the engineering questions that decide whether your implementation is correct, fast, and the right choice:

- Exactly how is the shift table built, and *why* must the last character be excluded?
- Why is the shift identical whether the window matched or mismatched, and is that actually correct?
- The Sunday variant keys on a different character — when does its slightly larger jump help, and what does it cost?
- What makes the average case so good, and what input triggers the `O(nm)` worst case?
- When should I pick Horspool over full Boyer-Moore (sibling `08`) or KMP (sibling `01`)?

These questions separate "I memorized the loop" from "I can choose and tune the right string searcher for the data in front of me." We use `n` = text length, `m` = pattern length, `sigma` = alphabet size throughout.

---

## Deeper Concepts

### Building the shift table, restated precisely

The Horspool shift table answers one question: *if the text character aligned with the window's last position is `c`, how far can I safely slide the pattern?* The answer is the distance from the last position back to the **rightmost occurrence of `c` in `P[0..m-2]`** (excluding the final character):

```
for every character c in the alphabet:  shift[c] = m            # c absent -> slide whole window
for j = 0 .. m-2:                         shift[P[j]] = m - 1 - j # rightmost wins (later j overwrites)
```

Two details matter:

1. **Exclude the last character (`j` stops at `m-2`).** The final character `P[m-1]` is the one we key the shift on. If we let it set its own entry, `shift[P[m-1]]` would become `m-1-(m-1) = 0`, and a zero shift means the loop never advances → infinite loop. By excluding it, every entry is at least `1`.
2. **Rightmost occurrence wins.** Because the loop runs left-to-right and overwrites, the *last* assignment for a repeated character is the one from the largest `j`, i.e. the rightmost occurrence — which gives the smallest safe shift for that character.

### Why the uniform shift is correct

After comparing the window (right-to-left), Horspool shifts by `shift[T[i + m - 1]]` **regardless of whether it matched**. Why is this safe in both cases?

- On a **mismatch**, the character `c = T[i + m - 1]` at the window's last position must, in any future successful alignment, line up with a pattern position that equals `c`. The smallest such re-alignment moves the pattern by the distance to `c`'s rightmost occurrence in `P[0..m-2]` (or by `m` if `c` never occurs there). That is exactly `shift[c]`.
- On a **full match**, we have already reported the occurrence; we still need to move forward to look for the next one. The same `shift[c]` is a safe, non-zero advance (it never skips a possible overlapping match because it is bounded by the same rightmost-occurrence logic).

So the single rule is correct in both branches, which is why the loop body needs no special case — a key reason Horspool is so compact. (Full correctness proof: `professional.md`.)

### What Horspool drops vs full Boyer-Moore

Full Boyer-Moore (sibling `08`) uses **two** rules and takes the maximum shift of the two:

- **Bad-character rule** — keyed on the *actual mismatched* character and its position (more information than Horspool uses).
- **Good-suffix rule** — uses the matched suffix to shift, which is what bounds the worst case to `O(n + m)` (with Galil's rule).

Horspool simplifies the bad-character rule to "always use the last-window char" and **drops the good-suffix rule entirely**. This removes the good-suffix preprocessing (the hard part) and the second table, at the cost of the worst-case guarantee.

### A worked table build, step by step

Let `P = "abcab"` (`m = 5`). Build by scanning `j = 0..3` (excluding the last `b` at index 4):

```
default shift[c] = 5 for all c
j=0: P[0]='a' -> shift['a'] = 5-1-0 = 4
j=1: P[1]='b' -> shift['b'] = 5-1-1 = 3
j=2: P[2]='c' -> shift['c'] = 5-1-2 = 2
j=3: P[3]='a' -> shift['a'] = 5-1-3 = 1   (overwrites the earlier 4)

Result: shift['a']=1, shift['b']=3, shift['c']=2, everything else 5
```

Two things to notice. First, `'a'` appears twice (indices 0 and 3); the *rightmost* (index 3) wins, giving the smaller, safer shift `1`. Second, the last character `'b'` (index 4) is excluded — but `'b'` also appears at index 1, so `shift['b'] = 3` comes from that earlier occurrence, not zero. The exclusion only stops the *last position* from contributing; earlier occurrences of the same character still count. This is exactly why "exclude the last character" and "rightmost occurrence wins" are two separate, both-necessary rules.

---

## A Full Worked Trace

Tables and formulas only convince once you have watched them drive an actual search. Here is a complete Horspool run, window by window, on a concrete input — then the **same input** under the Sunday variant for contrast, so you can see exactly where the two algorithms diverge.

### Setup

```
Text    T = G C A T C G C A G A G A G T A T A C A G T A C G   (n = 24)
Pattern P = G C A G A G A G                                    (m = 8)
Indices   0 1 2 3 4 5 6 7 8 9 ...                              (0-based)
```

### Step 1 — Build the Horspool shift table

Scan `P = "GCAGAGAG"` for `j = 0..6` (excluding the final `G` at index 7), with `shift[P[j]] = m - 1 - j = 7 - j`:

```
default shift[c] = 8 for every c
j=0: P[0]='G' -> shift['G'] = 7-0 = 7
j=1: P[1]='C' -> shift['C'] = 7-1 = 6
j=2: P[2]='A' -> shift['A'] = 7-2 = 5
j=3: P[3]='G' -> shift['G'] = 7-3 = 4   (overwrites 7)
j=4: P[4]='A' -> shift['A'] = 7-4 = 3   (overwrites 5)
j=5: P[5]='G' -> shift['G'] = 7-5 = 2   (overwrites 4)
j=6: P[6]='A' -> shift['A'] = 7-6 = 1   (overwrites 3)

Final:  shift['G']=2, shift['A']=1, shift['C']=6, everything else 8
```

Notice how the repeated `'G'` and `'A'` get overwritten down to their *rightmost* (smallest) values: `'G'` settles at `2` (rightmost non-final `G` is index 5), `'A'` settles at `1` (rightmost `A` is index 6). The final `G` at index 7 contributed nothing — exactly the exclusion rule.

### Step 2 — Slide the window, comparing right-to-left

Each row shows the window position `i`, the text character aligned with the window's **last** position (`c = T[i+7]`, which keys the shift), the right-to-left comparison result, and the resulting shift `shift[c]`.

```
i=0   window T[0..7]  = "GCATCGCA"   vs  P="GCAGAGAG"
      last char c = T[7] = 'A'
      compare j=7: T[7]='A' vs P[7]='G'  -> mismatch immediately
      shift = shift['A'] = 1            -> i becomes 1

i=1   window T[1..8]  = "CATCGCAG"   vs  P="GCAGAGAG"
      last char c = T[8] = 'G'
      compare j=7: T[8]='G' vs P[7]='G'  -> match
              j=6: T[7]='A' vs P[6]='A'  -> match
              j=5: T[6]='C' vs P[5]='G'  -> mismatch
      shift = shift['G'] = 2            -> i becomes 3

i=3   window T[3..10] = "TCGCAGAG"   vs  P="GCAGAGAG"
      last char c = T[10] = 'G'
      compare j=7: T[10]='G' vs P[7]='G' -> match
              j=6: T[9]='A'  vs P[6]='A' -> match
              j=5: T[8]='G'  vs P[5]='G' -> match
              j=4: T[7]='A'  vs P[4]='A' -> match
              j=3: T[6]='C'  vs P[3]='G' -> mismatch
      shift = shift['G'] = 2            -> i becomes 5

i=5   window T[5..12] = "GCAGAGAG"   vs  P="GCAGAGAG"
      last char c = T[12] = 'G'
      compare j=7..0: all 8 characters match  -> FULL MATCH at i=5
      shift = shift['G'] = 2            -> i becomes 7
```

The pattern occurs at index `5`. After reporting it, Horspool still advances by `shift['G'] = 2` (the uniform rule — same advance on a match as on a mismatch), continuing the scan for further occurrences:

```
i=7   window T[7..14] = "AGAGTATA"   vs  P="GCAGAGAG"
      last char c = T[14] = 'A'
      compare j=7: T[14]='A' vs P[7]='G' -> mismatch
      shift = shift['A'] = 1            -> i becomes 8
... (the search continues; no further match exists, windows keep
     bailing on the last-character compare and shifting 1 or 2)
```

**What to take away from the trace:**

- The shift key is *always* the character at the window's last position, read **before** any compare — `'A'` at `i=0`, `'G'` at `i=1,3,5`. The mismatch position does not influence the shift (that is the information Horspool throws away versus full Boyer-Moore).
- Windows that mismatch on the very first (last-position) compare cost a single comparison — the cheap common case.
- A full match advances by the same table value as a mismatch (`2` here), never by a hand-tuned amount; overlap handling is a *reporting* decision, not a shift decision.

### Step 3 — The same input under Sunday

Now run **Sunday** on the identical `T` and `P`. First build the Sunday table — include **all** `m = 8` characters (`j = 0..7`), formula `shift[P[j]] = m - j = 8 - j`, default `m + 1 = 9`:

```
default shift[c] = 9
j=0: 'G' -> 8
j=1: 'C' -> 7
j=2: 'A' -> 6
j=3: 'G' -> 5   (overwrites 8)
j=4: 'A' -> 4   (overwrites 6)
j=5: 'G' -> 3   (overwrites 5)
j=6: 'A' -> 2   (overwrites 4)
j=7: 'G' -> 1   (overwrites 3)   <- the final G IS included for Sunday

Final:  shift['G']=1, shift['A']=2, shift['C']=7, everything else 9
```

Sunday keys the shift on the character **one past** the window, `T[i+m] = T[i+8]`, and (conventionally) compares left-to-right:

```
i=0   window T[0..7] = "GCATCGCA" vs P="GCAGAGAG"
      compare L->R j=0:'G'='G', j=1:'C'='C', j=2:'A'='A', j=3:'T' vs 'G' -> mismatch
      char past window: T[0+8] = T[8] = 'G'
      shift = shift['G'] = 1            -> i becomes 1

i=1   window T[1..8] = "CATCGCAG" vs P="GCAGAGAG"
      compare L->R j=0:'C' vs 'G' -> mismatch immediately
      char past window: T[1+8] = T[9] = 'A'
      shift = shift['A'] = 2            -> i becomes 3

i=3   window T[3..10] = "TCGCAGAG" vs P="GCAGAGAG"
      compare L->R j=0:'T' vs 'G' -> mismatch immediately
      char past window: T[3+8] = T[11] = 'A'
      shift = shift['A'] = 2            -> i becomes 5

i=5   window T[5..12] = "GCAGAGAG" vs P="GCAGAGAG"
      compare L->R j=0..7: all match  -> FULL MATCH at i=5
      char past window: T[5+8] = T[13] = 'G'
      shift = shift['G'] = 1            -> i becomes 6
```

Sunday also finds the match at index `5`, reaching it in the same number of window placements here (`i = 0, 1, 3, 5`). The instructive contrast is *what drives each shift*:

| At window | Horspool keys on | value | Sunday keys on | value |
|-----------|------------------|-------|----------------|-------|
| `i=0` | `T[7]='A'` | shift 1 | `T[8]='G'` | shift 1 |
| `i=1` | `T[8]='G'` | shift 2 | `T[9]='A'` | shift 2 |
| `i=3` | `T[10]='G'` | shift 2 | `T[11]='A'` | shift 2 |
| `i=5` (match) | `T[12]='G'` | shift 2 | `T[13]='G'` | shift 1 |

On this particular text the two land on the same alignments, but the *reason* differs at every step: Horspool reacts to the last character already inside the window, Sunday reacts to the character it is about to swallow next. On texts where the just-past character happens to be absent from the pattern, Sunday leaps a full `m + 1 = 9` while Horspool (keyed on a character still inside the window) can only manage up to `m = 8` — that one-position-further reach is Sunday's entire structural advantage, and the trace makes visible exactly which character produces it.

---

## Comparison with Alternatives

### Horspool vs full Boyer-Moore vs KMP

| Property | KMP (sibling `01`) | Full Boyer-Moore (sibling `08`) | **Horspool** |
|----------|--------------------|---------------------------------|--------------|
| Scan direction | left-to-right | right-to-left | right-to-left |
| Skips text? | never | yes (big skips) | yes (big skips) |
| Rules / tables | failure function | bad-char + good-suffix | one bad-char (last-window) |
| Preprocessing | `O(m)` | `O(m + sigma)` | `O(m + sigma)` |
| Extra space | `O(m)` | `O(m + sigma)` | `O(sigma)` |
| Worst case | `O(n + m)` guaranteed | `O(n + m)` (with Galil) | `O(nm)` |
| Average case | `O(n)` | sub-linear, very fast | sub-linear, very fast |
| Code complexity | medium | high (good-suffix is fiddly) | **low** |

The takeaways:

- **KMP** never skips text and guarantees `O(n + m)`; ideal when you need a hard linear bound or are streaming and cannot look ahead/back freely.
- **Full Boyer-Moore** is the fastest with a strong worst case, but the good-suffix preprocessing is intricate and bug-prone.
- **Horspool** gets most of Boyer-Moore's average speed with a fraction of the code and half the tables, accepting an `O(nm)` worst case that rarely materializes on real text.

### Concrete cost comparison (`sigma = 256`, English-like text)

| `m` | KMP chars examined | BM chars examined | Horspool chars examined |
|-----|--------------------|--------------------|--------------------------|
| 4 | ~`n` | ~`n/3` | ~`n/3` |
| 8 | ~`n` | ~`n/6` | ~`n/6` |
| 16 | ~`n` | ~`n/12` | ~`n/11` |
| 32 | ~`n` | ~`n/22` | ~`n/20` |

The numbers are illustrative, but the pattern holds: Horspool tracks full Boyer-Moore closely on large-ish alphabets and longer patterns, while KMP examines essentially every character (it never skips).

---

## Advanced Patterns

### Pattern: Search returning all occurrences

```python
def build_shift(pattern):
    m = len(pattern)
    shift = {}
    for j in range(m - 1):              # exclude last char
        shift[pattern[j]] = m - 1 - j   # rightmost wins
    return shift


def horspool_all(text, pattern):
    n, m = len(text), len(pattern)
    if m == 0 or m > n:
        return []
    shift = build_shift(pattern)
    res, i = [], 0
    while i <= n - m:
        j = m - 1
        while j >= 0 and text[i + j] == pattern[j]:
            j -= 1
        if j < 0:
            res.append(i)
        i += shift.get(text[i + m - 1], m)
    return res
```

### Pattern: Case-insensitive Horspool

Lowercase both the pattern (when building the table) and each compared character. Keep the comparison and the shift lookup consistent — both must use the same normalization, or shifts will not align with comparisons.

### Pattern: Searching over bytes

Operate on raw bytes with a fixed `[256]int` table. This avoids Unicode pitfalls and is what real `memmem`-style implementations do; multi-byte text is searched as its UTF-8 byte sequence.

### Pattern: The last-character guard

A simple constant-factor speedup: before entering the right-to-left inner loop, test whether the window's last character equals the pattern's last character. On a large alphabet this single test fails for most windows, letting you skip the inner loop and shift immediately:

```python
def horspool_guarded(text, pattern):
    n, m = len(text), len(pattern)
    if m == 0 or m > n:
        return -1 if m > n else 0
    shift = build_shift(pattern)
    last = pattern[-1]
    i = 0
    while i <= n - m:
        c = text[i + m - 1]
        if c == last:                          # only then bother with the full compare
            j = m - 2
            while j >= 0 and text[i + j] == pattern[j]:
                j -= 1
            if j < 0:
                return i
        i += shift.get(c, m)
    return -1
```

The guard does not change the asymptotics but converts the common-case window into a single comparison plus a lookup — exactly the hot path real implementations optimize.

---

## The Sunday Variant

The **Sunday** algorithm (Daniel Sunday, 1990) is Horspool's sibling. It makes one change: instead of keying the shift on the char aligned with the window's **last** position (`T[i + m - 1]`), it keys on the character **one position past** the window, `T[i + m]`.

The reasoning: after the current alignment, the next alignment must cover position `i + m` (the character right after the window). So that character *will* be inside the next window. By aligning it with its rightmost occurrence in the **whole pattern** (this time including the last character), Sunday can shift by up to `m + 1`.

### Building the Sunday table

```
for every character c:  shift[c] = m + 1            # absent -> jump past it entirely
for j = 0 .. m-1:        shift[P[j]] = m - j          # include ALL chars; rightmost wins
```

Compare to Horspool: the loop now runs the full `j = 0..m-1` (includes the last char), the formula is `m - j` (not `m - 1 - j`), and the default is `m + 1` (not `m`). The "include the last char" is safe here because Sunday looks one beyond the window, so a zero shift cannot occur (minimum is `1`).

### Sunday matching loop

```
build sunday table from P
i = 0
while i <= n - m:
    j = 0
    while j < m and T[i+j] == P[j]:   # Sunday often compares left-to-right
        j += 1
    if j == m: report match at i
    if i + m >= n: break               # no char past the window
    i += shift[T[i + m]]               # shift keyed on the char PAST the window
```

Note Sunday is commonly implemented with a **left-to-right** inner compare (either direction works for correctness; the shift rule is what matters). The bounds check `i + m >= n` is essential — there is no character past the window at the very end.

### Horspool vs Sunday

| | Horspool | Sunday |
|---|----------|--------|
| Shift keyed on | `T[i + m - 1]` (last window char) | `T[i + m]` (char past window) |
| Table includes last char? | no (exclude) | yes (include) |
| Default shift | `m` | `m + 1` |
| Max single shift | `m` | `m + 1` |
| Bounds care | none extra | must check `i + m < n` |

Sunday's jumps are slightly larger on average (it can leap a full `m + 1`), so it is often marginally faster; Horspool is marginally simpler (no past-window bounds check). Both share the same `O(nm)` worst case and `O(m + sigma)` preprocessing.

---

## Average vs Worst Case

### Why the average case is good

On text drawn from a large alphabet, most windows mismatch at the very last character (the first one Horspool compares). The shift is then `shift[c]`, which averages around `m / 2` to `m` for a large alphabet because most characters either do not occur in the pattern (shift `m`) or occur only near the left. So the expected number of windows is roughly `n / E[shift]`, and the expected characters examined is **sub-linear** in `n` — frequently around `n (1 + 1/m)` total comparisons over the search, dropping as `m` grows and `sigma` grows. (Quantified in `professional.md`.)

### What triggers the `O(nm)` worst case

The worst case appears when shifts are always tiny and comparisons are always long. The canonical adversary:

```
P = "aaaa...a"   (m copies of 'a')
T = "aaaa...a"   (n copies of 'a')
```

Every window fully matches (or mismatches only at the front after `m` comparisons), and the shift is always `shift['a'] = 1` (the rightmost `a` in `P[0..m-2]` is at `m-2`, giving shift `1`). So each of the `~n` alignments does `~m` comparisons → `O(nm)`. This is exactly the worst case the **good-suffix rule** would have prevented in full Boyer-Moore.

### Alphabet size matters

Average-case speed shrinks as `sigma` shrinks. On DNA (`sigma = 4`), most characters *do* occur in any reasonably long pattern, so shifts are small and Horspool's edge over KMP narrows. On byte/ASCII English text, shifts are large and Horspool shines.

### Reading the worst case off the table

You can spot a worst-case-prone pattern by inspecting its shift table: if the *most common text character* maps to a tiny shift (especially `1`), and that character is frequent in the text, every window will shift by little. The extreme is an all-same-character pattern, where the only table entry is `shift[that char] = 1`. More subtly, a pattern like `"aaaab"` searched in a text rich in `'a'` has `shift['a'] = 1` (the rightmost `'a'` in `P[0..3]` is at index 3), so each window over a run of `'a'`s creeps forward by one. The table is thus a diagnostic: small shifts on common characters predict slow searches, which is the practical signal to consider a fallback or a different algorithm.

---

## Code Examples

### Full Horspool with an array table (byte alphabet)

#### Go

```go
package main

import "fmt"

func buildShift(p string) [256]int {
	m := len(p)
	var shift [256]int
	for c := range shift {
		shift[c] = m
	}
	for j := 0; j < m-1; j++ { // exclude last char
		shift[p[j]] = m - 1 - j
	}
	return shift
}

func horspoolAll(text, p string) []int {
	n, m := len(text), len(p)
	var res []int
	if m == 0 || m > n {
		return res
	}
	shift := buildShift(p)
	for i := 0; i <= n-m; {
		j := m - 1
		for j >= 0 && text[i+j] == p[j] {
			j--
		}
		if j < 0 {
			res = append(res, i)
		}
		i += shift[text[i+m-1]]
	}
	return res
}

func main() {
	fmt.Println(horspoolAll("abxabcabcaby", "abc")) // [3 6]
	fmt.Println(horspoolAll("aaaaaa", "aa"))        // [0 1 2 3 4]
}
```

#### Java

```java
import java.util.*;

public class HorspoolAll {

    static int[] buildShift(String p) {
        int m = p.length();
        int[] shift = new int[256];
        Arrays.fill(shift, m);
        for (int j = 0; j < m - 1; j++) {     // exclude last char
            shift[p.charAt(j) & 0xFF] = m - 1 - j;
        }
        return shift;
    }

    static List<Integer> horspoolAll(String text, String p) {
        int n = text.length(), m = p.length();
        List<Integer> res = new ArrayList<>();
        if (m == 0 || m > n) return res;
        int[] shift = buildShift(p);
        int i = 0;
        while (i <= n - m) {
            int j = m - 1;
            while (j >= 0 && text.charAt(i + j) == p.charAt(j)) j--;
            if (j < 0) res.add(i);
            i += shift[text.charAt(i + m - 1) & 0xFF];
        }
        return res;
    }

    public static void main(String[] args) {
        System.out.println(horspoolAll("abxabcabcaby", "abc")); // [3, 6]
        System.out.println(horspoolAll("aaaaaa", "aa"));        // [0, 1, 2, 3, 4]
    }
}
```

#### Python

```python
def build_shift(p):
    m = len(p)
    shift = {}
    for j in range(m - 1):          # exclude last char
        shift[p[j]] = m - 1 - j
    return shift


def horspool_all(text, p):
    n, m = len(text), len(p)
    if m == 0 or m > n:
        return []
    shift = build_shift(p)
    res, i = [], 0
    while i <= n - m:
        j = m - 1
        while j >= 0 and text[i + j] == p[j]:
            j -= 1
        if j < 0:
            res.append(i)
        i += shift.get(text[i + m - 1], m)
    return res


if __name__ == "__main__":
    print(horspool_all("abxabcabcaby", "abc"))  # [3, 6]
    print(horspool_all("aaaaaa", "aa"))         # [0, 1, 2, 3, 4]
```

### Sunday variant

#### Python

```python
def build_sunday(p):
    m = len(p)
    shift = {}
    for j in range(m):              # include ALL chars
        shift[p[j]] = m - j         # rightmost wins
    return shift


def sunday_search(text, p):
    n, m = len(text), len(p)
    if m == 0 or m > n:
        return -1
    shift = build_sunday(p)
    i = 0
    while i <= n - m:
        j = 0
        while j < m and text[i + j] == p[j]:
            j += 1
        if j == m:
            return i
        if i + m >= n:
            break
        i += shift.get(text[i + m], m + 1)   # char PAST the window; default m+1
    return -1


if __name__ == "__main__":
    print(sunday_search("TRUSTHARDTEETH", "TEETH"))  # 9
```

---

## Error Handling

| Scenario | What goes wrong | Correct approach |
|----------|-----------------|------------------|
| Last char included in table | `shift[P[m-1]] = 0` → infinite loop | Loop `j` to `m-2` for Horspool; `m-1` is OK only for Sunday. |
| Sunday at end of text | `T[i + m]` out of bounds | Check `i + m < n` before the past-window lookup. |
| Empty pattern / `m > n` | Index errors, wrong result | Guard both before building the table. |
| Signed-byte indexing (Java/Go) | Negative array index | Mask with `& 0xFF`. |
| Wrong shift key | Used mismatch position, not last-window char | Horspool always keys on `T[i + m - 1]`. |
| Map vs array mismatch | Default not applied for absent char | Use `.get(c, m)` (Python) or pre-fill the array with `m`. |

---

## Performance Analysis

| `m` (sigma=256) | Expected shift | Approx windows for `n` chars | Notes |
|-----------------|----------------|------------------------------|-------|
| 4 | ~3.0 | ~`n/3` | small pattern, modest skip |
| 8 | ~6.5 | ~`n/6` | good skip |
| 16 | ~13 | ~`n/12` | strong skip |
| 32 | ~26 | ~`n/24` | excellent skip |

The dominant cost is the number of windows times the comparisons per window. With a large alphabet, most windows do exactly one comparison (the last char mismatches) and then shift far. With a small alphabet, shifts shrink and comparisons lengthen, pushing toward the `O(nm)` regime. Preprocessing is always `O(m + sigma)` and the table is `O(sigma)`.

```python
import time, random

def benchmark(n, m):
    text = "".join(random.choice("ACGTacgtXYZ ") for _ in range(n))
    pat = text[n // 2: n // 2 + m]
    start = time.perf_counter()
    horspool_all(text, pat)
    return time.perf_counter() - start

# Larger alphabets and longer patterns => fewer windows => faster.
```

The single biggest constant-factor win is using an array-indexed table for byte alphabets and letting the right-to-left inner loop bail on the first (last-position) mismatch.

---

## Best Practices

- **Exclude the last char (Horspool) / include it (Sunday)** — the single most important correctness detail; comment it.
- **Pick the table type by alphabet:** array for bytes/ASCII, map for large/Unicode.
- **Build the table once per pattern** and reuse across searches; preprocessing is `O(m + sigma)`.
- **Always test against the naive oracle** on random small inputs and on adversarial inputs (all-same-char).
- **Choose the algorithm by guarantee needs:** Horspool/Sunday for average speed and simplicity; KMP or full Boyer-Moore when a hard `O(n + m)` is required.
- **Mind the alphabet size:** on tiny alphabets (DNA), measure — the skip advantage shrinks and KMP may win.

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive view.
>
> The middle-level animation highlights:
> - The shift table built from the pattern (with the last char excluded).
> - The window sliding and the right-to-left compare bailing on the first mismatch.
> - The shift keyed on the **last-window character** `T[i + m - 1]`, shown as a highlighted lookup.
> - Editable text and pattern so you can construct the `O(nm)` worst case yourself.

---

## Summary

Horspool's correctness rests on two precise details: build the shift table by excluding the last pattern character (so every shift is at least `1` and no infinite loop occurs) and keep the rightmost occurrence per character. The matching loop is uniform — the same `shift[T[i + m - 1]]` advance on match and mismatch — which is both correct and the reason the code is tiny. The **Sunday** variant swaps the key character to the one just past the window (`T[i + m]`), includes the last character in its table, and can jump up to `m + 1`. The average case is sub-linear in characters examined and tracks full Boyer-Moore closely for large alphabets, while the worst case is `O(nm)` (e.g. all-same-character inputs) — the cost of dropping the good-suffix rule. Pick Horspool/Sunday for simplicity and great average speed; pick KMP (sibling `01`) or full Boyer-Moore (sibling `08`) when you need a guaranteed linear worst case.
