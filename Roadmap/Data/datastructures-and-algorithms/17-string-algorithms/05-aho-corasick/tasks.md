# Aho-Corasick Multi-Pattern String Matching — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the Aho-Corasick logic and validate against the evaluation criteria.
> **Always test against a brute-force naive multi-search oracle (`str.find` per pattern) on small inputs before trusting the automaton.**

---

## Beginner Tasks (5)

### Task 1 — Build a trie of patterns and count nodes

**Problem.** Insert a list of lowercase patterns into a trie (children indexed by `c - 'a'`). Output the total number of trie nodes (including the root). Shared prefixes must share nodes.

**Input / Output spec.**
- Read `P`, then `P` patterns.
- Print the node count (root counts as 1).

**Constraints.**
- `1 ≤ P ≤ 1000`, patterns lowercase `a`–`z`, total length `≤ 10^5`.

**Hint.** Each distinct prefix is exactly one node. `{he, hers}` shares `h`, `he`, so the node count is 1 (root) + |distinct prefixes|.

**Starter — Go.**
```go
package main

import "fmt"

const SIGMA = 26

func main() {
	var p int
	fmt.Scan(&p)
	next := [][SIGMA]int{}
	// TODO: add a root node, insert each pattern, count nodes
	_ = next
	fmt.Println( /* node count */ )
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static final int SIGMA = 26;
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int p = sc.nextInt();
        // TODO: build trie, count nodes
        System.out.println(/* node count */ 0);
    }
}
```

**Starter — Python.**
```python
import sys

SIGMA = 26


def main():
    data = sys.stdin.read().split()
    p = int(data[0])
    pats = data[1:1 + p]
    # TODO: build trie, count nodes including root
    print(0)


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- `{he, hers, his}` produces the correct shared-prefix node count.
- Root is counted; empty pattern list yields node count 1.
- `O(total length)` insertion.

---

### Task 2 — Naive multi-search oracle

**Problem.** Implement `naive_search(patterns, text)` that returns all `(pattern_index, start_index)` occurrences (overlaps included), using only repeated substring search. This is your correctness oracle for all later tasks.

**Input / Output spec.**
- Read `P`, the patterns, then the text.
- Print each `(id, start)` sorted by `(start, id)`.

**Constraints.** `1 ≤ P ≤ 50`, total length `≤ 2000`, `|text| ≤ 2000`.

**Hint.** For each pattern, repeatedly call `find(pattern, fromIndex)` advancing by 1 each time to catch overlaps. `O(P · n · maxlen)` is fine here.

**Reference (Python).**
```python
def naive_search(patterns, text):
    res = []
    for pid, p in enumerate(patterns):
        start = text.find(p)
        while start != -1:
            res.append((pid, start))
            start = text.find(p, start + 1)
    return sorted(res, key=lambda r: (r[1], r[0]))
```

**Evaluation criteria.**
- Catches overlapping occurrences (`aa` in `aaa` at starts 0 and 1).
- Sorted output; deterministic across all three languages.

---

### Task 3 — Failure links by BFS

**Problem.** After inserting patterns, compute the failure link `fail[u]` for every node using BFS, following the rule `fail(u) = goto(fail(parent), c)`. Output `fail[u]` for all nodes in node-id order.

**Input / Output spec.**
- Read `P`, the patterns.
- Print `fail[0], fail[1], …` (root's fail is 0).

**Constraints.** `1 ≤ P ≤ 500`, total length `≤ 10^4`.

**Hint.** Initialize the root's children with `fail = 0` and enqueue them. Process the queue in FIFO order. To compute `fail(child)`, you need the parent's completed transitions — so completing `goto` and computing `fail` happen together in the BFS.

**Worked check.** For `{he, she, his, hers}` (trie from `junior.md`), `fail(node "she") = node "he"` and `fail(node "hers")` follows the suffix `s`. Verify a few links by hand.

**Evaluation criteria.**
- `fail[root] == 0`; all depth-1 nodes have `fail == 0`.
- `fail[u]` is always strictly shallower than `u` (no cycles except the root self-link).
- Matches a hand trace on `{he, she, his, hers}`.

---

### Task 4 — Report all matches (full Aho-Corasick)

**Problem.** Given patterns and a text, report every `(pattern_id, end_index)` occurrence, including overlaps, using the complete automaton (goto + fail + merged outputs).

**Input / Output spec.**
- Read `P`, patterns, then the text.
- Print each `(id, end)` sorted by `(end, id)`.

**Constraints.** `1 ≤ P ≤ 10^4`, total length `≤ 10^5`, `|text| ≤ 10^6`.

**Hint.** Merge `output[u] += output[fail[u]]` during BFS so reporting at a state is one list walk. The match at state `u` after reading index `i` *ends* at `i`.

**Evaluation criteria.**
- Matches `naive_search` (converted to end indices) for small inputs.
- Reports overlapping matches and shorter patterns that are suffixes of longer ones.
- `O(n + z)` scan after `O(m·σ)` build.

---

### Task 5 — Contains any keyword (boolean)

**Problem.** Given a banned-word list and a text, return `true` iff the text contains at least one banned word as a substring. Early-exit on the first match.

**Input / Output spec.**
- Read `P`, the words, then the text.
- Print `true` or `false`.

**Constraints.** `1 ≤ P ≤ 10^4`, `|text| ≤ 10^6`.

**Hint.** Build the automaton; during the scan, the moment you reach a state with a nonempty output, return `true`. No need to enumerate all matches.

**Evaluation criteria.**
- Returns `true` on the first match and stops scanning.
- Returns `false` when no word occurs.
- Correct when one word is a substring of another.

**Starter — Python.**
```python
def contains_any(words, text):
    # TODO: build automaton; scan; return True at first nonempty output
    return False
```

---

## Intermediate Tasks (5)

### Task 6 — Count occurrences of every pattern (fail-tree aggregation)

**Problem.** Given patterns and a text, output, for each pattern id, the number of times it occurs (overlaps counted), computed in `O(n + m)` via fail-tree subtree sums — **not** by enumerating matches.

**Constraints.** `1 ≤ P ≤ 10^5`, total length `≤ 10^5`, `|text| ≤ 10^6`.

**Hint.** Scan once, incrementing `cnt[state]` on each landing. Then process nodes in reverse BFS order, doing `cnt[fail[u]] += cnt[u]`. A pattern's count is `cnt[its end node]`.

**Reference oracle (Python).**
```python
def brute_counts(patterns, text):
    res = []
    for p in patterns:
        c, start = 0, text.find(p)
        while start != -1:
            c += 1
            start = text.find(p, start + 1)
        res.append(c)
    return res
```

**Starter — Python (fail-tree skeleton).**
```python
from collections import deque

SIGMA = 26


def count_each(patterns, text):
    nxt = [[-1] * SIGMA]
    fail = [0]
    end_node = []          # node where each pattern ends
    cnt = [0]

    def node():
        nxt.append([-1] * SIGMA)
        fail.append(0)
        cnt.append(0)
        return len(nxt) - 1

    for p in patterns:
        cur = 0
        for ch in p:
            c = ord(ch) - 97
            if nxt[cur][c] == -1:
                nxt[cur][c] = node()
            cur = nxt[cur][c]
        end_node.append(cur)
    # TODO: BFS to build fail + complete goto, record order
    # TODO: scan text, increment cnt[state]
    # TODO: reverse-BFS push cnt up the fail tree
    # TODO: return [cnt[end_node[p]] for p in range(len(patterns))]
    return [0] * len(patterns)
```

**Evaluation criteria.**
- `["a","aa"]` on `"aaaa"` returns `[4, 3]`.
- Matches `brute_counts` for small inputs.
- No per-occurrence enumeration; `O(n + m)`.

---

### Task 7 — First occurrence end-position of each pattern

**Problem.** Given patterns and a text, output for each pattern the **end index** of its first occurrence, or `-1` if it never occurs.

**Constraints.** `1 ≤ P ≤ 10^4`, total length `≤ 10^5`, `|text| ≤ 10^6`.

**Hint.** Scan once. At each state, walk merged outputs; for each pattern id not yet seen, record the current index as its first end. Use a `seen` / `firstEnd` array initialized to `-1`.

**Evaluation criteria.**
- Reports the earliest end index per pattern.
- `-1` for patterns that never occur.
- Single pass; matches a naive per-pattern `find`.

**Worked check.** For `["he","she"]` and text `she`, `he` first ends at index 2 (via the output link from `she`), and `she` first ends at index 2. Both are reported from the same scan position, demonstrating that output links surface co-terminating patterns.

---

### Task 8 — Censor banned words

**Problem.** Replace every character covered by any banned word with `*` (union of all match ranges). Overlapping matches all contribute.

**Constraints.** `1 ≤ P ≤ 10^4`, total length `≤ 10^5`, `|text| ≤ 10^6`.

**Hint.** Get all `(start, end)` matches via the automaton, mark a boolean `cover[]` array over text positions, then rebuild masking covered positions. For large match counts, prefer a difference-array (`+1` at start, `-1` at end+1) over per-character marking.

**Reference check (Python).**
```python
# censor(["ab","bc"], "xabcy") == "x***y"

def naive_censor(banned, text):
    cover = [False] * len(text)
    for p in banned:
        start = text.find(p)
        while start != -1:
            for j in range(start, start + len(p)):
                cover[j] = True
            start = text.find(p, start + 1)
    return "".join("*" if cover[i] else ch for i, ch in enumerate(text))
```

**Evaluation criteria.**
- Correct union masking for overlapping matches.
- `["ab","bc"]` on `"xabcy"` yields `"x***y"`.
- Uses a difference array for the cover marking when matches are dense.

---

### Task 9 — Longest pattern matched at each position

**Problem.** For each text index `i`, output the length of the **longest** pattern that ends at `i`, or `0` if none ends there.

**Constraints.** `1 ≤ P ≤ 10^4`, total length `≤ 10^5`, `|text| ≤ 10^6`.

**Hint.** Precompute for each node the maximum pattern length in its merged output set (`maxLen[u] = max over outputs`). During the scan, `maxLen[state(i)]` is the answer at `i`. This avoids walking the output list per position.

**Evaluation criteria.**
- For `{he, hers}` and text `hers`, position 1 (`he`) gives 2, position 3 (`hers`) gives 4.
- `0` where no pattern ends.
- `O(n)` scan after `O(m)` precompute of `maxLen`.

---

### Task 10 — Streaming scan across chunks

**Problem.** Implement `scan(state, chunk, baseOffset)` that processes a chunk of text starting from a carried automaton `state` and returns the new state, reporting matches at absolute offsets. Demonstrate that splitting a text into chunks produces the same matches as scanning it whole.

**Constraints.** `1 ≤ P ≤ 10^4`, total length `≤ 10^5`, total stream length `≤ 10^7`, chunk size arbitrary.

**Hint.** The entire scan state is one integer; thread it across chunk calls. A pattern straddling a boundary is handled automatically because no character is re-read and state is preserved. Report end positions as `baseOffset + i`.

**Evaluation criteria.**
- Chunked scan and whole-text scan produce identical match sets.
- Matches straddling chunk boundaries are caught.
- Only `O(1)` state carried between chunks (no buffering of prior chunks).

---

## Advanced Tasks (5)

### Task 11 — Alphabet reduction for byte input

**Problem.** Build an Aho-Corasick automaton over arbitrary bytes (`σ` up to 256) using **alphabet reduction**: map only the byte values that appear in patterns to a dense range `[0, σ')`, build transition rows of width `σ'`, and translate each text byte through the map during scanning. Report all matches.

**Constraints.** `1 ≤ P ≤ 10^4`, total pattern length `≤ 10^5`, `|text| ≤ 10^7`, byte alphabet.

**Hint.** First pass over patterns marks used bytes; assign each a dense index. A byte not in any pattern routes the automaton to the root path. Compare memory against a dense `[256]` build.

**Evaluation criteria.**
- Correct matches identical to a full `[256]`-width build.
- Memory measurably lower than the unreduced build (report the row width `σ'`).
- Handles bytes absent from all patterns (route to root).

---

### Task 12 — Replace-and-rebuild (atomic dictionary swap)

**Problem.** Implement a matcher whose dictionary can be replaced at runtime. `rebuild(patterns)` constructs a fresh immutable automaton; `search(text)` uses whatever automaton is currently published. Concurrent searches during a rebuild must use a consistent (old or new) automaton, never a half-built one.

**Constraints.** `1 ≤ P ≤ 10^5`, total length `≤ 10^6`, searches may run concurrently with a rebuild.

**Hint.** Build the new automaton fully into local structures, then publish it via an atomic reference/pointer swap. Readers snapshot the reference at the start of a scan. The automaton is read-only, so sharing is safe.

**Evaluation criteria.**
- A search started before a swap sees the old dictionary throughout.
- No reader ever observes a partially built automaton.
- Build is off the critical path; publish is a single atomic store.

---

### Task 13 — Shortest substring containing all patterns

**Problem.** Given patterns (all present at least once is not guaranteed) and a text, find the length of the shortest substring of the text that contains **every** pattern as a substring; `-1` if impossible.

**Constraints.** `1 ≤ P ≤ 1000`, total length `≤ 10^5`, `|text| ≤ 10^6`.

**Hint.** Collect all occurrence intervals `(start, end)` via the automaton; sort by end; slide a window over occurrences requiring all `P` pattern ids covered, tracking the minimum span `[min start in window, current end]`. This is the interview "shortest window" challenge.

**Reference oracle (Python).**
```python
def brute_shortest_window(patterns, text):
    n = len(text)
    best = float("inf")
    for i in range(n):
        for j in range(i, n):
            sub = text[i:j + 1]
            if all(p in sub for p in patterns):
                best = min(best, j - i + 1)
                break  # shortest ending at this start
    return -1 if best == float("inf") else best
```

**Evaluation criteria.**
- `["ab","bc"]` on `"zzabxbcyy"` returns 5 (span covering `ab` and `bc`).
- `-1` when some pattern never occurs.
- Two-pointer window over occurrences, not brute-force over all substrings.
- Matches `brute_shortest_window` for small inputs.

---

### Task 14 — DNA motif counting (small alphabet)

**Problem.** Over the DNA alphabet `{A, C, G, T}` (`σ = 4`), count occurrences of many short motifs in a long sequence. Use the dense array automaton (the small alphabet makes it ideal) and fail-tree counting.

**Constraints.** `1 ≤ P ≤ 10^5`, total motif length `≤ 10^6`, sequence length `≤ 10^7`, alphabet `{A,C,G,T}`.

**Hint.** Map `A,C,G,T → 0,1,2,3`. The dense `[4]` rows are tiny, so the full goto table is cheap. Use the `O(n + m)` fail-tree count from Task 6. Note that overlapping motif occurrences are counted (e.g. `AA` in `AAA`).

**Degree sanity check.** With `σ = 4`, each node has exactly 4 transitions after completion; total transition table size is `4 × nodes`. Assert this after building to catch row-width bugs.

**Evaluation criteria.**
- Correct overlapping counts for motifs like `AA`, `ACA`.
- Dense `[4]` rows; full goto table built and scanned in linear time.
- Matches a naive per-motif count on small sequences.

---

### Task 15 — Decide whether Aho-Corasick is the right tool

**Problem.** Given a problem description with constraints `(P, m, n, query_type, dictionary_volatility)`, classify the best approach as one of: `AHO_CORASICK`, `KMP_SINGLE`, `KMP_PER_PATTERN`, `SUFFIX_STRUCTURE_OF_TEXT`, or `WRONG_FOR_FUZZY`. Justify each decision.

**Constraints / cases to handle.**
- Many patterns, one or few reused texts, exact match → `AHO_CORASICK`.
- Exactly one pattern → `KMP_SINGLE` (sibling `01-kmp`).
- Pattern set changes every query (no reuse), few patterns → `KMP_PER_PATTERN`.
- One fixed text, many changing pattern sets → `SUFFIX_STRUCTURE_OF_TEXT` (suffix automaton/array).
- Approximate / fuzzy / regex matching → `WRONG_FOR_FUZZY` (Aho-Corasick is exact substring only).

**Hint.** Encode the decision rules from `middle.md` and `senior.md`. The trap cases are the single-pattern one (use KMP) and the fuzzy one (Aho-Corasick does not do approximate matching).

**Evaluation criteria.**
- Correctly classifies all five canonical cases with justification.
- The `KMP_SINGLE` and `WRONG_FOR_FUZZY` branches explicitly explain why Aho-Corasick is suboptimal/inapplicable.
- References the right complexity (`O(n + z)`, `O(P·n + m)`, etc.).

---

## Benchmark Task

### Task B — Aho-Corasick vs KMP-per-pattern crossover

**Problem.** Empirically find the pattern count `P` at which Aho-Corasick overtakes running KMP once per pattern, for a fixed text length `n`. Implement two workloads on a random text and random short patterns (fixed seed):

- **(a) KMP-per-pattern:** build each pattern's prefix function and scan the text per pattern — `O(P·n + m)`.
- **(b) Aho-Corasick:** build one automaton and scan the text once — `O(m·σ + n + z)`.

Measure wall-clock time for `n = 10^6` across `P ∈ {1, 4, 16, 64, 256, 1024}`. Report a table and identify the crossover `P`.

**Starter — Python.**
```python
import random
import time


def gen_patterns(p, seed, length=8):
    r = random.Random(seed)
    return ["".join(r.choice("abcd") for _ in range(length)) for _ in range(p)]


def gen_text(n, seed):
    r = random.Random(seed + 1)
    return "".join(r.choice("abcd") for _ in range(n))


def kmp_search_all(patterns, text):
    # TODO: prefix function per pattern, scan text per pattern; count matches
    return 0


def aho_search_all(patterns, text):
    # TODO: build one automaton, scan once; count matches
    return 0


def bench(fn, patterns, text):
    start = time.perf_counter()
    fn(patterns, text)
    return time.perf_counter() - start


def main():
    n = 1_000_000
    text = gen_text(n, 42)
    print("P        kmp_per_pattern_ms     aho_ms")
    for p in [1, 4, 16, 64, 256, 1024]:
        pats = gen_patterns(p, 7)
        a = [bench(kmp_search_all, pats, text) for _ in range(3)]
        b = [bench(aho_search_all, pats, text) for _ in range(3)]
        ms = lambda xs: sum(xs) / len(xs) * 1000
        print(f"{p:<8d} {ms(a):<22.2f} {ms(b):<10.2f}")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same seed produces the same patterns and text across Go, Java, and Python.
- KMP-per-pattern (a) wins or ties for `P = 1`; Aho-Corasick (b) wins for large `P`. Report the crossover `P`.
- Both methods report identical total match counts on the same inputs.
- Report includes the mean across at least 3 runs and does not time pattern/text generation.
- Writeup: a short note on the measured crossover `P` and how it compares to theory (the `P·n` term of KMP-per-pattern vs the single `n` of Aho-Corasick).

---

## General Guidance for All Tasks

- **Always validate against the naive oracle first.** Every search/count task above ships with (or references) a slow per-pattern oracle. Run it on small `P`, `m`, `n`, diff against the automaton, and only then trust it on large inputs.
- **Handle the root correctly.** `fail[root] = root`, and the root's missing transitions loop back to the root. This is the single most common build bug.
- **Build failure links in BFS order.** A fail link points to a shallower node, so all shallower nodes must be finalized first.
- **Merge or walk output links.** Forgetting `output[u] += output[fail[u]]` (or skipping the output chain) silently drops overlapping/suffix patterns — test `he` inside `she`.
- **Be consistent about end vs start positions.** A match at state `u` after index `i` ends at `i`; start = `i − len + 1`.
- **Choose representation by alphabet.** Dense arrays for small alphabets (DNA, lowercase); alphabet reduction or maps for byte/Unicode input.
- **Build once, scan many.** Never rebuild the automaton inside a per-text or per-query loop.

## Suggested Test Vectors

Use these shared cases across all three language implementations so outputs can be diffed directly:

| Patterns | Text | Expected (matches as `pattern@end`) |
|----------|------|--------------------------------------|
| `he she his hers` | `ushers` | `she@3`, `he@3`, `hers@5` |
| `a aa` | `aaaa` | counts `a=4`, `aa=3` (total 7) |
| `ab bc` | `xabcy` | censor → `x***y` |
| `ab bc` | `zzabxbcyy` | shortest window length 5 |
| `abc` | `xyz` | no matches; `contains` → false |
| `a` | `` (empty) | no matches |

## Progression and Difficulty Notes

- **Beginner (1–5)** establishes the data structure: trie construction, the oracle you validate against, failure-link BFS, the full reporting scan, and the boolean early-exit variant. Finish these before attempting the rest — every later task reuses the `build` routine.
- **Intermediate (6–10)** layers the standard production variants on top: counting via the fail tree, first-occurrence tracking, censoring, longest-match-per-position, and streaming across chunks. These exercise the *output* machinery and the online property.
- **Advanced (11–15)** stresses scale and judgement: byte alphabets with reduction, runtime dictionary swaps, the shortest-window two-pointer combination, small-alphabet bioinformatics counting, and the meta-skill of deciding when Aho-Corasick is the wrong tool at all.
- **Benchmark (B)** ties it together empirically by locating the Aho-Corasick vs KMP-per-pattern crossover, the single most important practical fact: the `P` factor.

## Common Grading Pitfalls

- Forgetting to merge `output[fail[u]]` — passes the single-pattern cases, fails on overlapping/suffix patterns (`he` in `she`). Always include an overlap test.
- Mishandling the root so the scan dereferences `-1` — crashes on the very first character that has no root edge.
- Counting via per-position enumeration in Task 6 instead of fail-tree aggregation — passes correctness but violates the `O(n + m)` requirement; check the complexity, not just the answer.
- Off-by-one between start and end positions — surfaces only in position-sensitive tasks (censor, shortest window); pin the convention and assert it.

## How to Validate Your Solutions

A disciplined validation loop catches nearly all bugs before they reach the large test cases:

1. **Hand-trace the tiny case.** Run `{he, she, his, hers}` on `ushers` and confirm `she@3`, `he@3`, `hers@5`. If this fails, your output-link merging or root handling is wrong — fix it before anything else.
2. **Diff against the naive oracle.** Generate random small dictionaries (`P ≤ 8`, lengths `≤ 5`) and random texts (`≤ 30` chars) over a 3-letter alphabet; compare your automaton's sorted output against the brute-force `str.find` oracle for hundreds of trials.
3. **Check the degenerate cases.** Empty text, empty dictionary, a single pattern (must equal KMP), duplicate patterns, and a pattern equal to the whole text.
4. **Cross-language determinism.** Feed the same seeded inputs to your Go, Java, and Python solutions and diff the outputs byte-for-byte. Divergence usually means an unstable sort or a normalization difference.
5. **Scale up last.** Only after 1–4 pass should you run the large constraint-sized inputs to check performance (`O(n + z)` scan, `O(n + m)` count).

Each task must be implemented and tested in **Go, Java, and Python**, with identical outputs across all three on the same seeded inputs.
