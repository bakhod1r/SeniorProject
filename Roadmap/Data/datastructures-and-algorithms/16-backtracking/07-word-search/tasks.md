# Word Search on a Grid (DFS Backtracking + Trie) — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the DFS-backtracking (and, for the multi-word tasks, the Trie) logic and validate against the evaluation criteria.
> **Always test against a brute-force oracle on small inputs before trusting an optimized version.** For Word Search II, the oracle is "run Word Search I once per dictionary word."

---

## Beginner Tasks (5)

### Task 1 — Word exists (Word Search I)

**Problem.** Implement `exist(board, word)` returning `true` iff `word` can be traced through orthogonally adjacent, non-reused cells. Use DFS backtracking with in-place marking.

**Input / Output spec.**
- Read `M`, `N`, then `M` rows of the grid (a string each), then `word`.
- Print `true` or `false`.

**Constraints.**
- `1 ≤ M, N ≤ 200`, `1 ≤ |word| ≤ 1000`. Letters are uppercase `A–Z`.

**Hint.** Three base cases (matched all / out of bounds / mismatch), then mark `'#'`, recurse 4 neighbors, unmark.

**Starter — Go.**
```go
package main

import "fmt"

func exist(board [][]byte, word string) bool {
	// TODO: DFS from each cell; mark/explore/unmark
	return false
}

func main() {
	var m, n int
	fmt.Scan(&m, &n)
	board := make([][]byte, m)
	for i := 0; i < m; i++ {
		var row string
		fmt.Scan(&row)
		board[i] = []byte(row)
	}
	var word string
	fmt.Scan(&word)
	fmt.Println(exist(board, word))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static int rows, cols;

    static boolean exist(char[][] board, String word) {
        // TODO
        return false;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int m = sc.nextInt(), n = sc.nextInt();
        char[][] board = new char[m][];
        for (int i = 0; i < m; i++) board[i] = sc.next().toCharArray();
        String word = sc.next();
        System.out.println(exist(board, word));
    }
}
```

**Starter — Python.**
```python
import sys


def exist(board, word):
    # TODO: DFS from each cell; mark/explore/unmark
    return False


def main():
    data = sys.stdin.read().split()
    it = iter(data)
    m, n = int(next(it)), int(next(it))
    board = [list(next(it)) for _ in range(m)]
    word = next(it)
    print(str(exist(board, word)).lower())


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Correct existence result, verified by hand on a small board.
- The board is unchanged after the call (restoration invariant).
- No out-of-bounds access; O(1) extra space via in-place marking.

---

### Task 2 — Word exists with a separate `visited` array

**Problem.** Re-implement `exist` using a separate `M × N` boolean `visited` array instead of in-place marking. Confirm it gives identical results.

**Input / Output spec.** Same as Task 1.

**Constraints.** `1 ≤ M, N ≤ 200`, `1 ≤ |word| ≤ 1000`.

**Hint.** Set `visited[r][c] = true` on the way in, `false` on backtrack. The board is read-only this time.

**Evaluation criteria.**
- Matches Task 1 on every input.
- The board is never mutated (only `visited` changes).
- Demonstrates the thread-safe-board alternative to the sentinel trick.

---

### Task 3 — Count starting cells that can begin the word

**Problem.** Given a board and a word, count how many distinct starting cells `(r, c)` can begin a successful trace of the word.

**Input / Output spec.**
- Read `M`, `N`, the grid, then `word`. Print the count.

**Constraints.** `1 ≤ M, N ≤ 50`, `1 ≤ |word| ≤ 20`.

**Hint.** Run the DFS from each cell, but instead of short-circuiting on the first success, tally how many starts return `true`.

**Worked check.** On a board where the word appears via two different starting cells, the count is 2. On a board where it does not appear at all, the count is 0.

**Evaluation criteria.**
- Counts distinct *starts*, not distinct paths.
- Matches a brute-force enumeration on small boards.
- Board unchanged after counting.

---

### Task 4 — Build a Trie and test prefix/word membership

**Problem.** Implement a `Trie` with `insert(word)`, `search(word)` (exact word present), and `startsWith(prefix)` (some word has this prefix). This Trie powers Word Search II.

**Input / Output spec.**
- Read a list of words to insert, then a list of `(op, string)` queries; print `true`/`false` per query.

**Constraints.** Up to `10^4` words, lowercase `a–z`.

**Hint.** Use `array[26]` children and a boolean `end` flag (or store the word at the terminal node). `search` checks `end`; `startsWith` just checks the path exists.

**Evaluation criteria.**
- `search` distinguishes a full word from a mere prefix.
- `startsWith` returns true for any inserted prefix.
- `O(L)` per operation.

---

### Task 5 — Single-word search on a Boggle board (8 directions)

**Problem.** Implement `existBoggle(board, word)` allowing all **8** neighbors (including diagonals). Same mark/explore/unmark, larger direction set.

**Input / Output spec.** Same as Task 1; print `true`/`false`.

**Constraints.** `1 ≤ M, N ≤ 50`, `1 ≤ |word| ≤ 50`.

**Hint.** Use a direction array of 8 offsets `(±1, 0), (0, ±1), (±1, ±1)`. Bounds-check every neighbor.

**Evaluation criteria.**
- Correctly uses 8 directions (diagonal traces succeed where 4-dir would fail).
- Board unchanged after the call.
- Matches a brute-force enumeration on small boards.

---

## Intermediate Tasks (5)

### Task 6 — Word Search II (find all dictionary words)

**Problem.** Implement `findWords(board, words)` returning all dictionary words that can be traced. Build a Trie and DFS the grid **once** with prefix pruning. De-duplicate results.

**Input / Output spec.**
- Read the grid, then the dictionary. Print the found words sorted, one per line.

**Constraints.** `1 ≤ M, N ≤ 12`, up to `3·10^4` words, `1 ≤ |word| ≤ 10`, lowercase.

**Hint.** Carry a Trie node in the DFS. Prune when the node lacks a child for the cell's letter. Store the word at the terminal node and clear it on report.

**Reference oracle (Python) — use this to validate.**
```python
def brute_find_words(board, words):
    def exist(word):
        rows, cols = len(board), len(board[0])
        def dfs(r, c, i):
            if i == len(word):
                return True
            if not (0 <= r < rows and 0 <= c < cols) or board[r][c] != word[i]:
                return False
            s, board[r][c] = board[r][c], "#"
            ok = (dfs(r-1,c,i+1) or dfs(r+1,c,i+1) or
                  dfs(r,c-1,i+1) or dfs(r,c+1,i+1))
            board[r][c] = s
            return ok
        return any(dfs(r, c, 0) for r in range(rows) for c in range(cols))
    return sorted({w for w in words if exist(w)})
```

**Evaluation criteria.**
- Output equals `brute_find_words` on small boards/dictionaries.
- Each word reported at most once.
- Single grid sweep (not one DFS per word).

---

### Task 7 — Word Search II with leaf pruning

**Problem.** Extend Task 6 to **prune dead Trie leaves**: after recording a word, detach any Trie node that has no children and no word, propagating up. Measure the speedup on a large dictionary.

**Constraints.** `1 ≤ M, N ≤ 12`, up to `5·10^4` words.

**Hint.** Pass the parent (and the child index) into the DFS, or return a "prune me" signal upward. Detach only when a node is truly dead (no children, no word).

**Evaluation criteria.**
- Identical results to Task 6.
- Trie node count decreases as words are found (assert/log it).
- Measurable speedup vs Task 6 on a large dictionary.

---

### Task 8 — Count and score (Boggle scoring)

**Problem.** On a Boggle board (8 directions, minimum word length 3), find all dictionary words and compute the total **score** using the table below. Each distinct word counts once.

| Word length | Points |
|-------------|--------|
| 3–4 | 1 |
| 5 | 2 |
| 6 | 3 |
| 7 | 5 |
| 8+ | 11 |

**Constraints.** `1 ≤ M, N ≤ 8`, up to `10^4` words.

**Hint.** Reuse the Trie sweep with 8 directions; filter words shorter than 3; map each found word's length to points and sum.

**Reference oracle (Python).**
```python
def score_of(word):
    L = len(word)
    if L < 3: return 0
    if L <= 4: return 1
    if L == 5: return 2
    if L == 6: return 3
    if L == 7: return 5
    return 11
```

**Evaluation criteria.**
- Total score matches summing `score_of` over the brute-force found set.
- Words shorter than 3 are excluded.
- Uses 8-direction adjacency.

---

### Task 9 — Longest word on the board

**Problem.** Return the longest dictionary word that can be traced (ties broken lexicographically smallest). Use the Trie sweep.

**Constraints.** `1 ≤ M, N ≤ 12`, up to `3·10^4` words.

**Hint.** Track the best terminal hit during the sweep; update when a found word is longer, or equal length but lexicographically smaller.

**Evaluation criteria.**
- Matches the max-length (tie: smallest) word from the brute-force found set.
- Single sweep.
- Handles the case where no word is found (return empty string).

---

### Task 10 — Word Search I that returns the path

**Problem.** Modify Word Search I to return the **list of cells** `[(r,c), …]` forming a successful trace, or an empty list if none. Useful for highlighting in a UI.

**Constraints.** `1 ≤ M, N ≤ 50`, `1 ≤ |word| ≤ 30`.

**Hint.** Push `(r, c)` onto a path list before recursing and pop it on backtrack (parallel to mark/unmark). On the success base case, return a copy of the path.

**Evaluation criteria.**
- Returned path is adjacent, distinct, and spells the word.
- Empty list iff the word does not exist.
- Path length equals `|word|`.

---

## Advanced Tasks (5)

### Task 11 — Thread-safe Word Search II (immutable Trie)

**Problem.** Solve Word Search II without mutating the Trie or the board, so the same Trie and board can be searched concurrently. Use a per-solve `visited` array and a per-solve found-set.

**Constraints.** `1 ≤ M, N ≤ 12`, up to `5·10^4` words, multiple boards solved in parallel.

**Hint.** Do not clear terminal markers or prune leaves on the shared Trie. Collect found words in a per-solve `set`. Each goroutine/thread owns its `visited` grid.

**Evaluation criteria.**
- Results identical to the single-threaded Task 6.
- The shared Trie is provably unmodified after all solves (checksum or re-search test).
- No data races (run with the race detector / thread sanitizer where available).

---

### Task 12 — Board-letter pre-filter

**Problem.** Before the Trie sweep, drop dictionary words that cannot possibly appear: words using a letter absent from the board, using a letter more often than available, or longer than `M·N`. Report how many words were filtered.

**Constraints.** `1 ≤ M, N ≤ 12`, up to `10^5` words.

**Hint.** Build a 26-length count of board letters; for each word build its own count and compare. The filter is `O(board + word)`.

**Evaluation criteria.**
- Filtered set produces the same found words as the unfiltered sweep.
- Reports a correct filtered count.
- Measurable speedup on a large dictionary with a small board.

---

### Task 13 — Aho-Corasick along straight lines (variant)

**Problem.** For the **straight-line** variant (words must appear along a full row, column, or diagonal, reading forward), find all dictionary words using Aho-Corasick on each line as a 1D text. This is a different, easier problem than free-form grid paths.

**Constraints.** `1 ≤ M, N ≤ 500`, up to `10^4` words.

**Hint.** Extract each row, column, and diagonal as a string; run a single Aho-Corasick automaton over each. No backtracking is needed because there is no turning and no visited-set constraint.

**Evaluation criteria.**
- Finds all words that appear along a straight line.
- Does **not** find words requiring a turn (that is Word Search II, not this variant).
- `O(lines · length + matches)`; documents why backtracking is unnecessary here.

---

### Task 14 — DAWG-style suffix sharing (memory)

**Problem.** Build a Trie, then measure node count; implement a simple suffix-merging pass (or use a known DAWG construction) and re-measure. Run Word Search II on the compacted structure, reconstructing matched words from the DFS path.

**Constraints.** Up to `10^5` words, lowercase.

**Hint.** A DAWG shares identical suffix subtrees, so you cannot store a per-node word — rebuild the word from the path during the DFS and collect into a set.

**Degree/size sanity check.** For a natural-language dictionary, the DAWG should have far fewer nodes than the Trie (English shares many suffixes like `-ing`, `-ed`). Assert `dawg_nodes < trie_nodes`.

**Evaluation criteria.**
- Same found words as the plain-Trie sweep.
- Fewer nodes than the plain Trie (report both counts).
- Word reconstruction from the path is correct (subset of dictionary).

---

### Task 15 — Decide when matrix exponentiation (walks) is the wrong tool

**Problem.** You are given a problem statement and must decide whether Word Search backtracking applies or whether the problem actually allows **cell reuse** (walks), which is a different polynomial problem. Implement `classify(problem)` returning one of: `WORD_SEARCH_DFS` (distinct cells, single/few words), `WORD_SEARCH_II_TRIE` (distinct cells, dictionary), `AHO_CORASICK_LINES` (straight-line matching), or `WALK_COUNT_MATRIX` (cell reuse allowed → not backtracking; see `11-graphs/32-paths-fixed-length`).

**Constraints / cases to handle.**
- Distinct-cell trace of one word → `WORD_SEARCH_DFS`.
- Distinct-cell trace of a dictionary → `WORD_SEARCH_II_TRIE`.
- Words along rows/cols/diagonals only → `AHO_CORASICK_LINES`.
- Count length-`k` label sequences with **reuse allowed** → `WALK_COUNT_MATRIX`.

**Hint.** The pivotal question is the **no-reuse (distinct cells) constraint**. If reuse is allowed, the problem is a memoryless walk count (polynomial, matrix power); if reuse is forbidden, it is a simple-path backtracking search.

**Evaluation criteria.**
- Correctly classifies all four canonical cases.
- The `WALK_COUNT_MATRIX` branch explicitly cites the memoryless-vs-visited-set distinction.
- Justification references the right complexity (`O(M·N·4^L)` for DFS, etc.).

---

## Benchmark Task

### Task B — Naive per-word loop vs Trie sweep crossover

**Problem.** Empirically find the dictionary size `W` at which the Trie sweep (Word Search II) overtakes the naive "Word Search I per word" loop on a fixed board. Implement two workloads on a random board (fixed seed):

- **(a) Naive loop:** run Word Search I for each of `W` words — `O(W · M·N · 4^Lmax)`.
- **(b) Trie sweep:** build a Trie once, DFS the grid once — `O(K + M·N · 4^Lmax)`.

Measure wall-clock time for a `12×12` board across `W ∈ {1, 10, 100, 1000, 10000}`. Report a table and identify the crossover `W`.

**Starter — Python.**
```python
import random
import time
import string


def gen_board(m, n, seed):
    r = random.Random(seed)
    return [[r.choice("abcde") for _ in range(n)] for _ in range(m)]


def gen_words(count, seed):
    r = random.Random(seed + 1)
    return ["".join(r.choice("abcde") for _ in range(r.randint(3, 6)))
            for _ in range(count)]


def word_search_i(board, word):
    # TODO: single-word DFS backtracking
    return False


def naive_loop(board, words):
    # TODO: run word_search_i for each word; return found set
    return set()


def trie_sweep(board, words):
    # TODO: build Trie, single DFS sweep; return found set
    return set()


def bench(fn, board, words):
    start = time.perf_counter()
    fn(board, words)
    return (time.perf_counter() - start) * 1000.0


def main():
    board = gen_board(12, 12, 42)
    print("W        naive_ms     trie_ms")
    for w in [1, 10, 100, 1000, 10000]:
        words = gen_words(w, 7)
        na = bench(naive_loop, [row[:] for row in board], words)
        tr = bench(trie_sweep, [row[:] for row in board], words)
        print(f"{w:<8d} {na:<12.2f} {tr:<10.2f}")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same seed produces the same board and word list across Go, Java, and Python.
- Naive loop (a) and Trie sweep (b) return the **same found set** at every `W`.
- The naive loop's time grows ~linearly in `W`; the Trie sweep stays roughly flat. Report the crossover `W`.
- Report includes the mean across at least 3 runs and does not time board/word generation or cloning.
- Writeup: a short note on the measured crossover and why the Trie sweep is essentially independent of `W`.

---

## Stretch Tasks (3)

### Task S1 — Word Search I that returns ALL distinct paths

**Problem.** Given a board and a word, return every distinct spelling path (each as a list of cells). Unlike Task 10 (which returns one path), enumerate them all.

**Input / Output spec.**
- Read `M`, `N`, the grid, then `word`. Print each path on its own line as `(r,c) (r,c) …`.

**Constraints.** `1 ≤ M, N ≤ 8`, `1 ≤ |word| ≤ 8` (small, because the count can be large).

**Hint.** Do not short-circuit on the first success. On the success base case, append a copy of the current path to a results list, then continue exploring (still unmarking on the way out so later paths are found).

**Evaluation criteria.**
- Returns every distinct path, each spelling the word with distinct cells.
- The count matches a brute-force enumeration on small boards.
- Board unchanged after the call.

### Task S2 — Boggle solver with `Qu` tile

**Problem.** Solve Word Search II on a Boggle board where one tile may be the two-letter `Qu`. A `Qu` tile matches two characters of the word in a single grid step. Find all dictionary words (8 directions, length ≥ 3).

**Constraints.** `1 ≤ M, N ≤ 5`, up to `10^4` words.

**Hint.** When the current cell is a `Qu` tile, descend the Trie by two characters (`q` then `u`) in one step; mark the single cell as usual. Bounds-check 8 neighbors.

**Evaluation criteria.**
- Words crossing a `Qu` tile (e.g. `"quit"`) are found.
- The single `Qu` cell is marked once and restored once.
- Matches a brute-force solver that treats `Qu` as an atomic two-letter step.

### Task S3 — Parallel multi-board scoring service

**Problem.** Given one shared dictionary and `B` boards, score every board (Boggle scoring) in parallel against an **immutable** shared Trie, using a per-board `visited` array and found-set. Return the score of each board.

**Constraints.** `1 ≤ M, N ≤ 5`, up to `10^4` words, `1 ≤ B ≤ 10^3` boards.

**Hint.** Build the Trie once. Launch one worker per board (goroutine / thread / process). No Trie mutation — collect found words per board in a local set, then score. Merge nothing across boards.

**Evaluation criteria.**
- Per-board scores match a single-threaded reference.
- The shared Trie is provably unmodified after all boards are scored.
- No data races (run with the race detector / thread sanitizer where available).
- Throughput scales with worker count up to the core count.

---

## General Guidance for All Tasks

- **Always validate against the brute-force oracle first.** For single-word tasks, hand-check small boards; for Word Search II, run Word Search I per word and compare the result sets.
- **Get the unmark right.** The most common bug is failing to restore the cell on every return path. Assert the board is unchanged after each solve.
- **Pick a sentinel outside the alphabet** (`'#'` for `a–z`/`A–Z`), or use a `visited` array when the board must stay read-only (e.g. concurrency).
- **One word → Word Search I; a dictionary → Word Search II (Trie).** Never loop Word Search I over a dictionary in production.
- **De-duplicate found words** (clear the terminal marker or use a set) — one word can be spelled by multiple paths.
- **Keep the Trie shareable when concurrent:** do not mutate it (no leaf pruning on a shared Trie); track per-solve state externally.
- **Distinct cells only.** Word Search forbids reuse; if a problem allows reuse it is a *walk* problem (matrix power / layered DP), not backtracking — see `11-graphs/32-paths-fixed-length`.

### Suggested progression

Work the tasks in this order to build the topic from the ground up:

1. **Tasks 1–2** establish the single-word DFS in both marking styles (in-place and `visited`); confirm they agree.
2. **Tasks 3, 10** vary the *output* of the single-word search (count starts, return the path) — same engine, different reporting.
3. **Task 4** builds the Trie in isolation, decoupled from the grid, so its bugs are caught before the sweep.
4. **Tasks 5, 6** introduce the two big generalizations: 8-direction adjacency and the Trie sweep.
5. **Tasks 7–9** layer on the production optimizations (leaf pruning, scoring, longest word).
6. **Tasks 11–14** add concurrency, pre-filtering, the line-only Aho-Corasick variant, and memory (DAWG).
7. **Task 15 and S1–S3** test judgment (which tool applies) and advanced engineering (all-paths, `Qu` tile, parallel service).
8. **Task B** ties it together empirically: measure the naive-vs-Trie crossover and confirm it matches the theory.

### Common cross-task pitfalls

- Forgetting to **unmark on the success path** (not just the failure path) — the early `return true` must still restore the cell.
- **Counting paths instead of starts** (Task 3) or **paths instead of words** (Tasks 6, 9) — clarify which the spec wants.
- **Mutating a shared Trie** in the concurrent tasks (11, S3) — use a per-solve set instead.
- **Off-by-one in adjacency** when switching to 8 directions (Tasks 5, 8, S2) — bounds-check every neighbor.

Each task must be implemented and tested in **Go, Java, and Python**, with identical outputs across all three on the same seeded inputs.
