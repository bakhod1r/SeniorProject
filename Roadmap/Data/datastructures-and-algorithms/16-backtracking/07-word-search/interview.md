# Word Search on a Grid (DFS Backtracking + Trie) — Interview Preparation

Word Search is a favourite interview topic because it rewards one crisp insight — *"DFS from each matching cell, mark/explore/unmark to enforce distinct cells"* — and then tests whether you can (a) get the in-place marking and restoration right, (b) recognize that a **dictionary** demands a **Trie** and a single grid sweep instead of one search per word, (c) reason about the `O(M·N·4^L)` complexity and why it is loose, and (d) avoid the classic traps (missed unmark, sentinel collision, duplicate reports). This file is a curated question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| Does a single `word` exist? | DFS backtracking, mark/explore/unmark | `O(M·N · 4^L)` |
| Find ALL dictionary words | Trie + single grid DFS | `O(M·N · 4^Lmax)` (build `O(K)`) |
| Count how many dictionary words appear | Trie sweep, count terminal hits | `O(M·N · 4^Lmax)` |
| Longest dictionary word on the board | Trie sweep, track max-length hit | `O(M·N · 4^Lmax)` |
| Boggle (8-direction) | Trie + DFS over 8 neighbors | `O(M·N · 7^Lmax)` |
| Words along straight lines only | Aho-Corasick per row/col/diagonal | `O(lines·len + matches)` |
| **Reuse a cell allowed (walks)** | **layered DP / matrix power, not this** | see `11-graphs/32-paths-fixed-length` |

The universal backtracking skeleton (the mark/explore/unmark shape never changes):

```text
dfs(r, c, idx):
    if idx == len(word):                      return true          # matched all
    if out of bounds or board[r][c] != word[idx]: return false     # fail
    saved = board[r][c]; board[r][c] = '#'    # MARK (no reuse)
    found = dfs(r-1,c,idx+1) || dfs(r+1,c,idx+1)
         || dfs(r,c-1,idx+1) || dfs(r,c+1,idx+1)
    board[r][c] = saved                       # UNMARK (backtrack)
    return found
```

Trie sweep for the multi-word case carries a Trie node instead of a word index, prunes when no child matches, and records the word at terminal nodes.

Key facts:
- **Distinct cells only** — no reuse within a path (enforced by marking).
- **4 directions** (up/down/left/right); Boggle uses 8 (with diagonals).
- **In-place marking** = O(1) extra space, safe by the restoration invariant.
- **One word → Word Search I; a dictionary → Word Search II (Trie).**
- The `4^L` bound is loose; really `≤ 3` choices after the first step.

---

## Junior Questions (12 Q&A)

### J1. What does Word Search I ask?
Whether a given `word` can be traced in a grid by moving between orthogonally adjacent cells (up/down/left/right) without using the same physical cell twice. It is a yes/no existence question.

### J2. What is the core technique?
DFS with backtracking. Start a search from every cell whose letter equals `word[0]`; at each cell, mark it, recurse into the four neighbors for the next character, then unmark on the way back.

### J3. Why do you mark cells during the search?
To enforce the "no reuse" rule. Marking the current cell (e.g. overwriting it with `'#'`) prevents the path from stepping back onto a cell it already used.

### J4. Why do you unmark (backtrack)?
So a *different* path can use that cell later. After exploring all neighbors, you restore the cell to its original letter, leaving the board unchanged for the next attempt.

### J5. What is the in-place marking trick?
Instead of a separate `visited` boolean array, you overwrite the cell's own letter with a sentinel like `'#'`, then restore it on backtrack. This uses O(1) extra space.

### J6. What are the base cases of the DFS?
(1) `index == len(word)` → matched everything, return true. (2) out of bounds → return false. (3) `board[r][c] != word[index]` (which also catches the `'#'` sentinel) → return false.

### J7. Are diagonal moves allowed?
Not in the classic problem — only the four orthogonal neighbors. Boggle is the variant that allows all eight (including diagonals).

### J8. What is the time complexity?
`O(M·N · 4^L)` where `M·N` is the grid size and `L` is the word length: a DFS from each cell, exploring a tree of branching ≤ 4 and depth `L`.

### J9. Why is `4^L` an overestimate?
After the first step you never step back to the cell you just came from (it is marked), so each deeper call has at most 3 useful choices, giving the tighter `O(M·N · 3^L)`. Letter mismatches prune even more.

### J10. Can the word have repeated letters?
Yes. You only need distinct *cells*, not distinct letters. For example `"ABCCED"` uses two different `C` cells.

### J11. What happens if you forget to unmark?
Later starting cells (or sibling branches) see a corrupted board with stale `'#'` marks and miss valid matches. It is the most common bug.

### J12 (analysis). How much extra memory does the recursion use?
`O(L)` for the call stack (one frame per matched character), bounded by `O(min(L, M·N))` since a distinct-cell path cannot be longer than the cell count. In-place marking adds only O(1) on top.

---

## Middle Questions (12 Q&A)

### M1. How do you find ALL words from a dictionary in the grid?
Build a Trie of the dictionary and DFS the grid **once**, carrying a Trie node alongside the cell. Descend the Trie child for the cell's letter; if there is none, prune. At a terminal node, record the word. This is Word Search II.

### M2. Why not just run Word Search I once per dictionary word?
That costs `O(W · M·N · 4^Lmax)` — linear in the dictionary size `W` — and re-traces shared prefixes repeatedly. The Trie sweep is `O(M·N · 4^Lmax)`, independent of `W`, because shared prefixes are explored once.

### M3. What does the Trie prune?
Branches where no dictionary word continues. Before stepping to a neighbor you check the current Trie node for a child matching that letter; if absent, the whole branch is dead and is cut immediately. The DFS only follows grid paths spelling live dictionary prefixes.

### M4. How do you avoid reporting the same word twice?
Clear the terminal marker (or the stored word) when you first record it, so a word reachable via multiple paths is only reported once. Alternatively collect into a set.

### M5. What is leaf pruning in Word Search II?
After recording a word, if its Trie node has no children and no word left, detach it from its parent. As words are found, the Trie shrinks, so later branches dead-end sooner.

### M6. Why is the in-place marking trick safe?
The restoration invariant: every code path through the DFS restores the cell before returning, so the board is identical after each call. During a path the cell holds `'#'`, blocking reuse. The only precondition is that the sentinel is not a real letter.

### M7. When would you use a `visited` array instead of in-place marking?
When you cannot mutate the board — e.g. it is shared read-only across threads — or when the alphabet is unconstrained so no safe sentinel exists. Each worker gets its own `visited` array.

### M8. What changes for Boggle?
Adjacency becomes 8-directional (diagonals included), there is usually a minimum word length (3), and you score words by length. The Trie sweep is otherwise identical; only the direction array, a length filter, and a scoring map differ.

### M9. Why store the whole word at the Trie's terminal node?
So that when the DFS reaches a terminal node it can append the word in O(1) without reconstructing it from the path. It is the standard Word Search II optimization.

### M10. Array-of-26 children or a hash map?
For a fixed lowercase alphabet, `array[26]` is faster (no hashing, cache-friendly). For large or Unicode alphabets, a map keeps nodes compact. Choose by alphabet size.

### M11. How do you count how many dictionary words appear?
Run the Trie sweep and count terminal hits (after de-dup), or return the size of the found-set. Same complexity as finding them.

### M12 (analysis). Why is the multi-word complexity independent of `W`?
The dictionary enters only through the Trie build (`O(K)`, paid once) and the *shape* of the pruned search. The grid is swept once, and shared prefixes collapse into one Trie path, so the word count `W` is not a multiplicative factor on the sweep.

---

## Senior Questions (10 Q&A)

### S1. How do you make Word Search II thread-safe for a shared dictionary?
Build the Trie once and share it **read-only**. Do not mutate it (no leaf pruning / marker clearing on the shared Trie); instead track found words in a per-solve set and give each worker its own `visited` array (or board copy). This trades the shrinking-Trie speedup for shareability.

### S2. The dictionary has 100,000 words and memory is tight. What do you do?
Replace the plain Trie with a **DAWG/DAFSA** (shares identical suffixes, often 5–10× fewer nodes), or use map-based / radix-tree nodes. With a DAWG you cannot store per-node words (nodes are shared), so reconstruct the matched word from the DFS path and track found words externally.

### S3. How do you pre-filter a large dictionary against a specific board?
Compute the board's letter multiset. Drop any word that uses a letter absent from the board, uses a letter more often than available, or is longer than `M·N`. This `O(board + word)` filter eliminates most of a large dictionary on a typical board before any DFS.

### S4. How do you parallelize?
Across **start cells** (each DFS is independent given a per-worker `visited` and an immutable Trie) or, more commonly in a service, across **boards/requests**. A single DFS path is sequential; leaf pruning cannot run on a shared Trie concurrently — use the immutable-Trie + per-solve set model.

### S5. Why doesn't Aho-Corasick apply directly?
Aho-Corasick matches many patterns in a single 1D text via failure links and a monotonic scan. A grid has exponentially many paths and the no-reuse constraint makes the search a simple-path (visited-set) computation, not a memoryless text scan, so failure links do not transfer. It *does* apply to the easier "straight lines only" variant.

### S6. What pruning order is best?
Cheapest, highest-yield first: board-letter filter and start-cell restriction before any recursion; prefix-existence pruning at every step; leaf pruning lazily as words are found. Expensive prunes (connected-region sizing) only pay off on large boards with large dictionaries.

### S7. How do you verify correctness at scale?
Keep a brute-force per-word oracle: for small boards, run Word Search I for every dictionary word and compare the result set to the Trie sweep. Add invariants: board unchanged after solve, no duplicate reports, every result in the dictionary, and every result's letters within the board's letter multiset.

### S8. What is the tightest worst-case bound, and is it realistic?
`O(M·N · 3^L)` (or `7^{Lmax}` for Boggle), tighter than `4^L` because you never step back to the previous cell. It is realistic only on adversarial boards (uniform letters); on natural inputs prefix pruning keeps the search near the count of (grid path, live prefix) coincidences, far below the bound.

### S9. How do you handle very long words / deep recursion?
Recursion depth is bounded by `L` (and by `M·N`). For pathologically long words, bound `L` up front (a word longer than `M·N` cannot fit) or convert the DFS to an explicit stack to avoid stack overflow.

### S10 (analysis). Why is the problem exponential in `L` but only linear in the grid area?
Each start cell contributes one `O(3^L)` search tree, and there are `M·N` starts — so the grid factor is linear (`M·N`) and the word-length factor is exponential (`3^L`). The exponential comes from the no-reuse simple-path constraint, which forces visited-set-style search; for fixed short words `L` is small and the method is fast.

---

## Professional Questions (8 Q&A)

### P1. Design a Boggle-scoring service handling thousands of boards per second.
Build the dictionary Trie (or DAWG) once at startup, pinned read-only in shared memory. Per request: pre-filter the dictionary by the board's letter multiset, run the Trie sweep with a per-request `visited` array and found-set (no Trie mutation), score found words by length, and return. Parallelize across requests; size the pool to cores; log Trie node count, found-count, and latency.

### P2. How do you keep the Trie immutable while still de-duplicating found words?
Move per-solve state out of the Trie: collect found words in a per-solve `set` (so a word found via multiple paths is stored once), or keep terminal markers in a side table keyed by node identity. The Trie itself is never written, so it stays shareable across boards and threads.

### P3. The board is huge and sparse. How do you avoid wasted starts?
Restrict starts to cells whose letter is a child of the Trie root (cells that begin no dictionary word never launch a DFS). Combine with the board-letter pre-filter. For very large boards, consider connected-region sizing so words longer than any reachable region are dropped.

### P4. How do you debug "a word is missing from the results"?
Run the per-word Word Search I oracle on the same board for that word; if the oracle finds it but the sweep does not, check (a) the Trie insertion (is the word actually in the Trie?), (b) prefix pruning (a wrong child lookup), and (c) a missed unmark corrupting the board mid-sweep. Assert the board is unchanged after the solve.

### P5. When is Aho-Corasick the right tool instead of the Trie DFS?
When the matching is along **straight lines** (rows, columns, diagonals) rather than free-form simple paths. Then each line is a 1D text and Aho-Corasick finds all dictionary words in `O(line length + matches)` per line, beating the backtracking search. Recognizing this variant is the key judgment.

### P6. How do you parallelize a single very large board's solve?
Distribute start cells across workers, each with its own `visited` array and a shared immutable Trie; merge per-worker found-sets at the end. Note that on small boards thread overhead dominates — parallelism pays off only for large boards or, better, across many boards.

### P7. What memory does the Trie cost and how do you reduce it?
`array[26]` nodes cost ~208 bytes each; a million-node Trie is ~200 MB. Reduce via map-based nodes (compact for sparse children), a DAWG (suffix sharing, often 5–10×), or a radix tree (compress unique stems). Measure distinct-prefix node count before choosing.

### P8 (analysis). Why is the multi-word problem no harder (in the grid factor) than single-word?
The Trie sweep is `O(M·N · 4^Lmax)` regardless of `W`: adding dictionary words shares prefixes rather than multiplying work. The hardness ceiling is the single-path exponential in `Lmax` (the no-reuse simple-path constraint), which adding words does not raise — it only adds more terminal nodes to report.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you replaced a redundant per-item loop with a shared structure.
Look for a story like replacing "run a matcher once per dictionary word" with "build a Trie and sweep once," the profiling that showed the `W` factor dominating, and the measured speedup. Strong answers mention verifying the new path against the old per-word results on small inputs.

### B2. A teammate's word-search returns each word multiple times. How do you help?
Explain that a word can be spelled by multiple distinct paths, so the terminal node fires once per path. The fix is to clear the terminal marker on first report or collect into a set. Frame it as the standard de-dup step, with a tiny example of two paths spelling the same word.

### B3. Design a feature that highlights all valid words a player could have played on a board.
This is Word Search II / Boggle: build the dictionary Trie, sweep the board (8-direction for Boggle), collect found words with their paths for highlighting, score by length. Discuss the immutable shared Trie, per-request visited state, and the board-letter pre-filter for latency.

### B4. How would you explain the backtracking marking trick to a junior?
Use the pencil analogy: put your finger on the current square so you do not land on it again this trace; lift your finger when the trace dead-ends so a different trace can use it. Lead with the two gotchas: always restore the square (unmark), and pick a sentinel that is not a real letter.

### B5. Your board-search service uses too much memory. How do you investigate?
Check whether the Trie is rebuilt per request (it should be built once, shared read-only) and whether each request copies the whole board instead of using a small `visited` array. Profile node count; if the Trie itself is the cost, switch to a DAWG or map-based nodes.

---

## Coding Challenges

### Challenge 1: Word Exists (Word Search I)

**Problem.** Given a grid of letters and a `word`, return `true` iff the word can be traced via orthogonally adjacent, non-reused cells.

**Example.**
```text
board = [[A,B,C,E],[S,F,C,S],[A,D,E,E]], word = "ABCCED"  ->  true
board = [[A,B,C,E],[S,F,C,S],[A,D,E,E]], word = "ABCB"    ->  false (would reuse B)
```

**Constraints.** `1 ≤ M, N ≤ 200`, `1 ≤ L ≤ 1000`.

**Optimal.** DFS backtracking with in-place marking, `O(M·N · 4^L)`.

**Go.**
```go
package main

import "fmt"

func exist(board [][]byte, word string) bool {
	rows, cols := len(board), len(board[0])
	var dfs func(r, c, idx int) bool
	dfs = func(r, c, idx int) bool {
		if idx == len(word) {
			return true
		}
		if r < 0 || r >= rows || c < 0 || c >= cols || board[r][c] != word[idx] {
			return false
		}
		saved := board[r][c]
		board[r][c] = '#'
		found := dfs(r-1, c, idx+1) || dfs(r+1, c, idx+1) ||
			dfs(r, c-1, idx+1) || dfs(r, c+1, idx+1)
		board[r][c] = saved
		return found
	}
	for r := 0; r < rows; r++ {
		for c := 0; c < cols; c++ {
			if dfs(r, c, 0) {
				return true
			}
		}
	}
	return false
}

func main() {
	board := [][]byte{[]byte("ABCE"), []byte("SFCS"), []byte("ADEE")}
	fmt.Println(exist(board, "ABCCED")) // true
	fmt.Println(exist(board, "ABCB"))   // false
}
```

**Java.**
```java
public class Exist {
    static int rows, cols;

    static boolean exist(char[][] b, String w) {
        rows = b.length; cols = b[0].length;
        for (int r = 0; r < rows; r++)
            for (int c = 0; c < cols; c++)
                if (dfs(b, w, r, c, 0)) return true;
        return false;
    }

    static boolean dfs(char[][] b, String w, int r, int c, int idx) {
        if (idx == w.length()) return true;
        if (r < 0 || r >= rows || c < 0 || c >= cols || b[r][c] != w.charAt(idx))
            return false;
        char saved = b[r][c];
        b[r][c] = '#';
        boolean found = dfs(b, w, r - 1, c, idx + 1) || dfs(b, w, r + 1, c, idx + 1)
                     || dfs(b, w, r, c - 1, idx + 1) || dfs(b, w, r, c + 1, idx + 1);
        b[r][c] = saved;
        return found;
    }

    public static void main(String[] args) {
        char[][] board = {{'A','B','C','E'},{'S','F','C','S'},{'A','D','E','E'}};
        System.out.println(exist(board, "ABCCED")); // true
        System.out.println(exist(board, "ABCB"));   // false
    }
}
```

**Python.**
```python
def exist(board, word):
    rows, cols = len(board), len(board[0])

    def dfs(r, c, idx):
        if idx == len(word):
            return True
        if not (0 <= r < rows and 0 <= c < cols) or board[r][c] != word[idx]:
            return False
        saved, board[r][c] = board[r][c], "#"
        found = (dfs(r - 1, c, idx + 1) or dfs(r + 1, c, idx + 1) or
                 dfs(r, c - 1, idx + 1) or dfs(r, c + 1, idx + 1))
        board[r][c] = saved
        return found

    return any(dfs(r, c, 0) for r in range(rows) for c in range(cols))


if __name__ == "__main__":
    board = [list("ABCE"), list("SFCS"), list("ADEE")]
    print(exist(board, "ABCCED"))  # True
    print(exist(board, "ABCB"))    # False
```

---

### Challenge 2: Word Search II (Find All Dictionary Words via a Trie)

**Problem.** Given a grid and a list of `words`, return all words that can be traced. Use a Trie and a single grid DFS.

**Example.**
```text
board = [[o,a,a,n],[e,t,a,e],[i,h,k,r],[i,f,l,v]], words = [oath,pea,eat,rain]
  -> [eat, oath]
```

**Optimal.** Trie + single DFS, `O(M·N · 4^Lmax)` after `O(K)` build.

**Go.**
```go
package main

import (
	"fmt"
	"sort"
)

type Node struct {
	ch   [26]*Node
	word string
}

func findWords(board [][]byte, words []string) []string {
	root := &Node{}
	for _, w := range words {
		n := root
		for i := 0; i < len(w); i++ {
			x := w[i] - 'a'
			if n.ch[x] == nil {
				n.ch[x] = &Node{}
			}
			n = n.ch[x]
		}
		n.word = w
	}
	rows, cols := len(board), len(board[0])
	var out []string
	var dfs func(r, c int, n *Node)
	dfs = func(r, c int, n *Node) {
		if r < 0 || r >= rows || c < 0 || c >= cols || board[r][c] == '#' {
			return
		}
		nx := n.ch[board[r][c]-'a']
		if nx == nil {
			return
		}
		if nx.word != "" {
			out = append(out, nx.word)
			nx.word = ""
		}
		ch := board[r][c]
		board[r][c] = '#'
		dfs(r-1, c, nx)
		dfs(r+1, c, nx)
		dfs(r, c-1, nx)
		dfs(r, c+1, nx)
		board[r][c] = ch
	}
	for r := 0; r < rows; r++ {
		for c := 0; c < cols; c++ {
			dfs(r, c, root)
		}
	}
	sort.Strings(out)
	return out
}

func main() {
	board := [][]byte{[]byte("oaan"), []byte("etae"), []byte("ihkr"), []byte("iflv")}
	fmt.Println(findWords(board, []string{"oath", "pea", "eat", "rain"})) // [eat oath]
}
```

**Java.**
```java
import java.util.*;

public class FindWords {
    static class Node { Node[] ch = new Node[26]; String word; }
    static int rows, cols;

    static List<String> findWords(char[][] b, String[] words) {
        Node root = new Node();
        for (String w : words) {
            Node n = root;
            for (char c : w.toCharArray()) {
                int x = c - 'a';
                if (n.ch[x] == null) n.ch[x] = new Node();
                n = n.ch[x];
            }
            n.word = w;
        }
        rows = b.length; cols = b[0].length;
        List<String> out = new ArrayList<>();
        for (int r = 0; r < rows; r++)
            for (int c = 0; c < cols; c++)
                dfs(b, r, c, root, out);
        Collections.sort(out);
        return out;
    }

    static void dfs(char[][] b, int r, int c, Node n, List<String> out) {
        if (r < 0 || r >= rows || c < 0 || c >= cols || b[r][c] == '#') return;
        Node nx = n.ch[b[r][c] - 'a'];
        if (nx == null) return;
        if (nx.word != null) { out.add(nx.word); nx.word = null; }
        char ch = b[r][c];
        b[r][c] = '#';
        dfs(b, r - 1, c, nx, out); dfs(b, r + 1, c, nx, out);
        dfs(b, r, c - 1, nx, out); dfs(b, r, c + 1, nx, out);
        b[r][c] = ch;
    }

    public static void main(String[] args) {
        char[][] board = {{'o','a','a','n'},{'e','t','a','e'},{'i','h','k','r'},{'i','f','l','v'}};
        System.out.println(findWords(board, new String[]{"oath","pea","eat","rain"})); // [eat, oath]
    }
}
```

**Python.**
```python
def find_words(board, words):
    root = {}
    for w in words:
        node = root
        for ch in w:
            node = node.setdefault(ch, {})
        node["$"] = w  # terminal marker stores the word
    rows, cols = len(board), len(board[0])
    out = []

    def dfs(r, c, node):
        if not (0 <= r < rows and 0 <= c < cols):
            return
        ch = board[r][c]
        if ch == "#" or ch not in node:
            return
        nxt = node[ch]
        if "$" in nxt:
            out.append(nxt.pop("$"))   # record + de-dup
        board[r][c] = "#"
        dfs(r - 1, c, nxt); dfs(r + 1, c, nxt)
        dfs(r, c - 1, nxt); dfs(r, c + 1, nxt)
        board[r][c] = ch

    for r in range(rows):
        for c in range(cols):
            dfs(r, c, root)
    return sorted(out)


if __name__ == "__main__":
    board = [list("oaan"), list("etae"), list("ihkr"), list("iflv")]
    print(find_words(board, ["oath", "pea", "eat", "rain"]))  # ['eat', 'oath']
```

---

### Challenge 3: Count Dictionary Words Found

**Problem.** Return how many distinct dictionary words appear on the board. Same Trie sweep; count terminal hits.

**Go.**
```go
package main

import "fmt"

type N3 struct {
	ch  [26]*N3
	end bool
}

func countWords(board [][]byte, words []string) int {
	root := &N3{}
	for _, w := range words {
		n := root
		for i := 0; i < len(w); i++ {
			x := w[i] - 'a'
			if n.ch[x] == nil {
				n.ch[x] = &N3{}
			}
			n = n.ch[x]
		}
		n.end = true
	}
	rows, cols := len(board), len(board[0])
	count := 0
	var dfs func(r, c int, n *N3)
	dfs = func(r, c int, n *N3) {
		if r < 0 || r >= rows || c < 0 || c >= cols || board[r][c] == '#' {
			return
		}
		nx := n.ch[board[r][c]-'a']
		if nx == nil {
			return
		}
		if nx.end {
			count++
			nx.end = false // count each word once
		}
		ch := board[r][c]
		board[r][c] = '#'
		dfs(r-1, c, nx)
		dfs(r+1, c, nx)
		dfs(r, c-1, nx)
		dfs(r, c+1, nx)
		board[r][c] = ch
	}
	for r := 0; r < rows; r++ {
		for c := 0; c < cols; c++ {
			dfs(r, c, root)
		}
	}
	return count
}

func main() {
	board := [][]byte{[]byte("oaan"), []byte("etae"), []byte("ihkr"), []byte("iflv")}
	fmt.Println(countWords(board, []string{"oath", "pea", "eat", "rain"})) // 2
}
```

**Java.**
```java
public class CountWords {
    static class N { N[] ch = new N[26]; boolean end; }
    static int rows, cols, count;

    static int countWords(char[][] b, String[] words) {
        N root = new N();
        for (String w : words) {
            N n = root;
            for (char c : w.toCharArray()) {
                int x = c - 'a';
                if (n.ch[x] == null) n.ch[x] = new N();
                n = n.ch[x];
            }
            n.end = true;
        }
        rows = b.length; cols = b[0].length; count = 0;
        for (int r = 0; r < rows; r++)
            for (int c = 0; c < cols; c++)
                dfs(b, r, c, root);
        return count;
    }

    static void dfs(char[][] b, int r, int c, N n) {
        if (r < 0 || r >= rows || c < 0 || c >= cols || b[r][c] == '#') return;
        N nx = n.ch[b[r][c] - 'a'];
        if (nx == null) return;
        if (nx.end) { count++; nx.end = false; }
        char ch = b[r][c];
        b[r][c] = '#';
        dfs(b, r - 1, c, nx); dfs(b, r + 1, c, nx);
        dfs(b, r, c - 1, nx); dfs(b, r, c + 1, nx);
        b[r][c] = ch;
    }

    public static void main(String[] args) {
        char[][] board = {{'o','a','a','n'},{'e','t','a','e'},{'i','h','k','r'},{'i','f','l','v'}};
        System.out.println(countWords(board, new String[]{"oath","pea","eat","rain"})); // 2
    }
}
```

**Python.**
```python
def count_words(board, words):
    root = {}
    for w in words:
        node = root
        for ch in w:
            node = node.setdefault(ch, {})
        node["$"] = True
    rows, cols = len(board), len(board[0])
    count = 0

    def dfs(r, c, node):
        nonlocal count
        if not (0 <= r < rows and 0 <= c < cols):
            return
        ch = board[r][c]
        if ch == "#" or ch not in node:
            return
        nxt = node[ch]
        if nxt.get("$"):
            count += 1
            nxt["$"] = False        # count each word once
        board[r][c] = "#"
        dfs(r - 1, c, nxt); dfs(r + 1, c, nxt)
        dfs(r, c - 1, nxt); dfs(r, c + 1, nxt)
        board[r][c] = ch

    for r in range(rows):
        for c in range(cols):
            dfs(r, c, root)
    return count


if __name__ == "__main__":
    board = [list("oaan"), list("etae"), list("ihkr"), list("iflv")]
    print(count_words(board, ["oath", "pea", "eat", "rain"]))  # 2
```

---

### Challenge 4: Longest Dictionary Word on the Board

**Problem.** Return the longest dictionary word that can be traced on the board (ties broken lexicographically smallest). Trie sweep tracking the best terminal hit.

**Python.**
```python
def longest_word(board, words):
    root = {}
    for w in words:
        node = root
        for ch in w:
            node = node.setdefault(ch, {})
        node["$"] = w
    rows, cols = len(board), len(board[0])
    best = ""

    def better(cand):
        return len(cand) > len(best) or (len(cand) == len(best) and cand < best)

    def dfs(r, c, node):
        nonlocal best
        if not (0 <= r < rows and 0 <= c < cols):
            return
        ch = board[r][c]
        if ch == "#" or ch not in node:
            return
        nxt = node[ch]
        w = nxt.get("$")
        if w and better(w):
            best = w
        board[r][c] = "#"
        dfs(r - 1, c, nxt); dfs(r + 1, c, nxt)
        dfs(r, c - 1, nxt); dfs(r, c + 1, nxt)
        board[r][c] = ch

    for r in range(rows):
        for c in range(cols):
            dfs(r, c, root)
    return best


if __name__ == "__main__":
    board = [list("oaan"), list("etae"), list("ihkr"), list("iflv")]
    print(longest_word(board, ["oath", "pea", "eat", "rain", "oa"]))  # 'oath'
```

**Go.**
```go
package main

import "fmt"

type N4 struct {
	ch   [26]*N4
	word string
}

func longestWord(board [][]byte, words []string) string {
	root := &N4{}
	for _, w := range words {
		n := root
		for i := 0; i < len(w); i++ {
			x := w[i] - 'a'
			if n.ch[x] == nil {
				n.ch[x] = &N4{}
			}
			n = n.ch[x]
		}
		n.word = w
	}
	rows, cols := len(board), len(board[0])
	best := ""
	better := func(cand string) bool {
		return len(cand) > len(best) || (len(cand) == len(best) && cand < best)
	}
	var dfs func(r, c int, n *N4)
	dfs = func(r, c int, n *N4) {
		if r < 0 || r >= rows || c < 0 || c >= cols || board[r][c] == '#' {
			return
		}
		nx := n.ch[board[r][c]-'a']
		if nx == nil {
			return
		}
		if nx.word != "" && better(nx.word) {
			best = nx.word
		}
		ch := board[r][c]
		board[r][c] = '#'
		dfs(r-1, c, nx)
		dfs(r+1, c, nx)
		dfs(r, c-1, nx)
		dfs(r, c+1, nx)
		board[r][c] = ch
	}
	for r := 0; r < rows; r++ {
		for c := 0; c < cols; c++ {
			dfs(r, c, root)
		}
	}
	return best
}

func main() {
	board := [][]byte{[]byte("oaan"), []byte("etae"), []byte("ihkr"), []byte("iflv")}
	fmt.Println(longestWord(board, []string{"oath", "pea", "eat", "rain", "oa"})) // oath
}
```

**Java.**
```java
public class LongestWord {
    static class N { N[] ch = new N[26]; String word; }
    static int rows, cols;
    static String best;

    static String longestWord(char[][] b, String[] words) {
        N root = new N();
        for (String w : words) {
            N n = root;
            for (char c : w.toCharArray()) {
                int x = c - 'a';
                if (n.ch[x] == null) n.ch[x] = new N();
                n = n.ch[x];
            }
            n.word = w;
        }
        rows = b.length; cols = b[0].length; best = "";
        for (int r = 0; r < rows; r++)
            for (int c = 0; c < cols; c++)
                dfs(b, r, c, root);
        return best;
    }

    static boolean better(String cand) {
        return cand.length() > best.length()
            || (cand.length() == best.length() && cand.compareTo(best) < 0);
    }

    static void dfs(char[][] b, int r, int c, N n) {
        if (r < 0 || r >= rows || c < 0 || c >= cols || b[r][c] == '#') return;
        N nx = n.ch[b[r][c] - 'a'];
        if (nx == null) return;
        if (nx.word != null && better(nx.word)) best = nx.word;
        char ch = b[r][c];
        b[r][c] = '#';
        dfs(b, r - 1, c, nx); dfs(b, r + 1, c, nx);
        dfs(b, r, c - 1, nx); dfs(b, r, c + 1, nx);
        b[r][c] = ch;
    }

    public static void main(String[] args) {
        char[][] board = {{'o','a','a','n'},{'e','t','a','e'},{'i','h','k','r'},{'i','f','l','v'}};
        System.out.println(longestWord(board, new String[]{"oath","pea","eat","rain","oa"})); // oath
    }
}
```

---

## Final Tips

- Lead with the one-liner: *"DFS from each matching cell; mark/explore/unmark to keep cells distinct; `O(M·N·4^L)`."*
- Immediately flag the two gotchas: **always unmark (restore)** and **pick a sentinel outside the alphabet** (or use a `visited` array).
- For a **dictionary**, reach for **Word Search II**: build a Trie and sweep once — never loop Word Search I per word.
- Mention the de-dup step (clear the terminal marker) and, for scale, leaf pruning and the immutable-Trie + per-solve-set pattern.
- Always offer to verify against a brute-force per-word Word Search I oracle on small inputs.
