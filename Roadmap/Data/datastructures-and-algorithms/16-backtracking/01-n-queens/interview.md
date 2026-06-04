# N-Queens — Interview Preparation

N-Queens is the single most-asked backtracking question. It rewards one crisp insight — *one queen per row, `O(1)` conflict checks via column/diagonal/anti-diagonal keys* — and then probes whether you can (a) make it fast with the **bitmask** representation, (b) keep it correct with the right diagonal indices and undo discipline, (c) distinguish *find one* vs *count all* vs *print all*, and (d) recognize the deeper facts (no closed-form count, D4 symmetry, NP-complete completion). This file is a question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| Is a square `(r,c)` safe? | `!cols[c] && !diag[r-c+N-1] && !anti[r+c]` | `O(1)` |
| Place / undo a queen | set/unset three keys | `O(1)` |
| Find one solution | backtracking + early exit | exponential, fast in practice |
| Count all solutions | backtracking, no early exit | exponential (`Q(n)`, A000170) |
| Print all boards | backtracking + reconstruct `pos[]` | `O(#sol · N)` to emit |
| Fast count | bitmask + lowbit + symmetry | same big-O, small constant |
| One board, huge N | constructive `O(N)` formula | `O(N)` |
| Complete a partial board | seeded search | NP-complete |

Core recursion:

```text
solve(r):
    if r == N: record/count/print; return
    for c in 0..N-1:
        if cols[c] or diag[r-c+N-1] or anti[r+c]: continue
        place(r, c); solve(r+1); undo(r, c)
```

Bitmask kernel:

```text
solve(cols, diag, anti):
    if cols == full: count++; return
    avail = ~(cols|diag|anti) & full
    while avail:
        p = avail & -avail; avail -= p
        solve(cols|p, (diag|p)<<1 & full, (anti|p)>>1)
```

Key facts:
- **Length/structure:** exactly one queen per row; solution ⇔ a permutation with distinct `r-c` and `r+c`.
- Diagonal index `r - c + N - 1` (size `2N-1`); anti-diagonal `r + c` (size `2N-1`).
- Solution counts: `1, 0, 0, 2, 10, 4, 40, 92, 352, …` (A000170). No solution for `N = 2, 3`.
- **No closed-form** count; **completion is NP-complete**; symmetry group is **D4** (8 elements).

---

## Junior Questions (12 Q&A)

### J1. What is the N-Queens problem?
Place `N` queens on an `N×N` board so no two attack — no shared row, column, or diagonal. Solve by backtracking, placing one queen per row.

### J2. Why exactly one queen per row?
Two queens in the same row always attack. With `N` queens, `N` rows, at most one per row, pigeonhole forces exactly one per row. This is why we choose only a *column* for each row.

### J3. How do you check if a square is safe in `O(1)`?
Keep three sets: occupied columns, occupied main diagonals (keyed by `r - c`), and occupied anti-diagonals (keyed by `r + c`). A square is safe iff its column, its `r-c`, and its `r+c` are all free — three lookups, constant time.

### J4. Why `r - c + N - 1` instead of `r - c`?
`r - c` ranges from `-(N-1)` to `N-1` and can be negative. Adding `N - 1` shifts it to `0 .. 2N-2` so it indexes an array of size `2N - 1`.

### J5. What is backtracking?
Build a solution incrementally; when a partial solution can't be completed, undo the last choice and try the next. Here: place a queen, recurse to the next row, and if that fails, remove the queen and try the next column.

### J6. What does "undo" mean and why is it critical?
After recursing, you must unset the three keys you set, so the next column starts from a clean state. Forgetting the undo is the #1 backtracking bug — it corrupts every later branch.

### J7. How do you find just one solution vs count all?
Find one: return `true` at the base case and propagate it up to stop the search. Count all: increment a counter at the base case and keep going (never early-exit).

### J8. What is the base case?
`r == N` — all rows have a queen. That partial placement is a complete, valid board.

### J9. For which `N` are there no solutions?
`N = 2` and `N = 3`. Every other `N` (1 and all `≥ 4`) has at least one.

### J10. How many solutions for `N = 8`?
92.

### J11. What is the space complexity?
`O(N)` — recursion depth `N` plus three `O(N)` sets. Counting needs no board.

### J12. Do diagonals attack at any distance?
Yes — two queens on the same diagonal attack no matter how far apart. That's why we track the whole diagonal line, not just neighbours.

---

## Middle Questions (10 Q&A)

### M1. Describe the bitmask representation.
Use three integers `cols, diag, anti` where bit `c` set means column `c` is attacked. Safe columns for the row are `available = ~(cols|diag|anti) & ((1<<N)-1)`.

### M2. How do you iterate only the free columns?
With the lowbit trick: `p = available & -available` isolates the lowest set bit (one free column); `available -= p` (or `available &= available-1`) removes it. The loop runs exactly once per free column.

### M3. Why do the diagonal masks shift between rows?
Moving down a row, a `↘` diagonal moves one column right, so its attack mask shifts **left** (`(diag|p) << 1`); a `↙` diagonal moves left, so its mask shifts **right** (`(anti|p) >> 1`).

### M4. Why is there no explicit undo in the bitmask version?
Masks are passed **by value**. Each recursive call gets its own copy; returning naturally restores the caller's masks. No shared mutable state, no undo needed.

### M5. Why `& full` after the left shift?
`(diag|p) << 1` can set a bit beyond column `N-1`; masking with `full = (1<<N)-1` keeps it within the board. (Right shift needs no mask.)

### M6. How does symmetry reduction work?
Mirror symmetry: count solutions with the row-0 queen in the left half of columns, double the count. For odd `N`, the center column is its own mirror — search it once and add without doubling. Roughly halves the work.

### M7. Why can't you just divide the total count by 8 to get fundamental solutions?
Orbits under the D4 symmetry group vary in size (8, 4, 2, or 1). Symmetric solutions sit in smaller orbits, so naive division fails. Use canonicalization or Burnside's lemma.

### M8. What's the time complexity of counting?
Exponential — proportional to the number of valid partial placements visited. No sub-exponential algorithm is known; bitmask/symmetry only improve constants.

### M9. Is there a formula for the number of solutions?
No closed-form formula and no known polynomial formula. The counts (A000170) are found by search; only an asymptotic growth *rate* is known.

### M10. A nice last-row optimization?
When only the final row remains, every free column is exactly one solution — return `popcount(available)` instead of recursing. Collapses the last tree level.

---

## Senior Questions (8 Q&A)

### S1. How do you parallelize counting?
Split on the first row (or first two): each row-0 column defines an independent subtree (masks by value ⇒ no shared state). Sum partial counts. Use work-stealing because subtrees are unequal in size.

### S2. What overflow concern exists?
For `N ≳ 18` counts exceed 32-bit range (e.g. `N=27` is ~2.34×10¹⁶). Always count in 64-bit.

### S3. How do you produce one solution for `N = 1,000,000`?
Don't search — use the `O(N)` constructive formula (Hoffman–Loessi–Moore), then verify with the `O(N)` triple-set check. Searching huge `N` for "find one" would time out unnecessarily.

### S4. What is the symmetry group, and how many fundamental solutions for `N=8`?
The dihedral group D4 (8 elements: 4 rotations, 4 reflections). For `N=8`: 92 total, **12** fundamental (11 orbits of size 8 + 1 of size 4).

### S5. State the completion result.
N-Queens *Completion* (given some pre-placed queens, can it be finished?) is **NP-complete**; counting completions is #P-complete. The blank-board problem, by contrast, is trivial.

### S6. How do you test a counting implementation?
Assert `count(N)` matches OEIS A000170 for `N=0..14` in CI; cross-validate boolean vs bitmask vs symmetry versions; property-test that completion counts never exceed the unseeded count.

### S7. What are the main correctness pitfalls?
Wrong diagonal shift direction, missing `& full`, 32-bit counter overflow, double-counting the odd-`N` center column.

### S8. When is plain DFS preferable to bitmask?
When you must *print* boards: keeping an explicit `pos[]` is clearer than reconstructing from masks, and printing dominates runtime anyway.

---

## Behavioral / Communication Prompts

- **"Walk me through your approach before coding."** Say: one queen per row → choose a column per row → `O(1)` safety via three keys → place/recurse/undo → prune dead rows. State complexity and the find-one vs count-all distinction up front.
- **"How would you test this?"** Mention the known sequence (1,0,0,2,10,4,40,92), cross-validating two implementations, and edge cases `N=1,2,3`.
- **"You shipped a bug where counts were slightly off for large N."** Diagnose: likely a missing `& full` or wrong shift direction; the golden A000170 test would have caught it.
- **"Optimize for counting `N=15` under 200ms."** Bitmask + symmetry + last-row popcount; mention parallel split if needed.
- **"Explain it to a non-engineer."** Use the Sudoku-in-pencil analogy: write a value, erase and retry on contradiction.

---

## Coding Challenge 1: Place N Queens (Return One Board)

**Problem.** Return one valid board as a list of strings (`'Q'` and `'.'`), or empty if none exists.

### Go
```go
package main

import "fmt"

func solveOne(n int) []string {
	pos := make([]int, n)
	cols := make([]bool, n)
	diag := make([]bool, 2*n-1)
	anti := make([]bool, 2*n-1)

	var solve func(r int) bool
	solve = func(r int) bool {
		if r == n {
			return true
		}
		for c := 0; c < n; c++ {
			d, a := r-c+n-1, r+c
			if cols[c] || diag[d] || anti[a] {
				continue
			}
			pos[r] = c
			cols[c], diag[d], anti[a] = true, true, true
			if solve(r + 1) {
				return true
			}
			cols[c], diag[d], anti[a] = false, false, false
		}
		return false
	}

	if !solve(0) {
		return nil
	}
	board := make([]string, n)
	for r := 0; r < n; r++ {
		row := make([]byte, n)
		for c := 0; c < n; c++ {
			if pos[r] == c {
				row[c] = 'Q'
			} else {
				row[c] = '.'
			}
		}
		board[r] = string(row)
	}
	return board
}

func main() {
	for _, line := range solveOne(8) {
		fmt.Println(line)
	}
}
```

### Java
```java
import java.util.*;

public class PlaceOne {
    static int n;
    static int[] pos;
    static boolean[] cols, diag, anti;

    static boolean solve(int r) {
        if (r == n) return true;
        for (int c = 0; c < n; c++) {
            int d = r - c + n - 1, a = r + c;
            if (cols[c] || diag[d] || anti[a]) continue;
            pos[r] = c;
            cols[c] = diag[d] = anti[a] = true;
            if (solve(r + 1)) return true;
            cols[c] = diag[d] = anti[a] = false;
        }
        return false;
    }

    static List<String> solveOne(int N) {
        n = N; pos = new int[n];
        cols = new boolean[n]; diag = new boolean[2*n-1]; anti = new boolean[2*n-1];
        if (!solve(0)) return Collections.emptyList();
        List<String> board = new ArrayList<>();
        for (int r = 0; r < n; r++) {
            StringBuilder sb = new StringBuilder();
            for (int c = 0; c < n; c++) sb.append(pos[r] == c ? 'Q' : '.');
            board.add(sb.toString());
        }
        return board;
    }

    public static void main(String[] args) {
        for (String line : solveOne(8)) System.out.println(line);
    }
}
```

### Python
```python
def solve_one(n: int):
    pos = [0] * n
    cols = [False] * n
    diag = [False] * (2 * n - 1)
    anti = [False] * (2 * n - 1)

    def solve(r: int) -> bool:
        if r == n:
            return True
        for c in range(n):
            d, a = r - c + n - 1, r + c
            if cols[c] or diag[d] or anti[a]:
                continue
            pos[r] = c
            cols[c] = diag[d] = anti[a] = True
            if solve(r + 1):
                return True
            cols[c] = diag[d] = anti[a] = False
        return False

    if not solve(0):
        return []
    return ["".join("Q" if pos[r] == c else "." for c in range(n)) for r in range(n)]


if __name__ == "__main__":
    print("\n".join(solve_one(8)))
```

---

## Coding Challenge 2: Count All Solutions

**Problem.** Return the number of distinct solutions for given `N`.

### Go
```go
package main

import "fmt"

func totalNQueens(n int) int {
	full := (1 << n) - 1
	var solve func(cols, diag, anti int) int
	solve = func(cols, diag, anti int) int {
		if cols == full {
			return 1
		}
		count, avail := 0, ^(cols|diag|anti)&full
		for avail != 0 {
			p := avail & -avail
			avail -= p
			count += solve(cols|p, (diag|p)<<1&full, (anti|p)>>1)
		}
		return count
	}
	return solve(0, 0, 0)
}

func main() { fmt.Println(totalNQueens(8)) } // 92
```

### Java
```java
public class CountAll {
    static int full;
    static int solve(int cols, int diag, int anti) {
        if (cols == full) return 1;
        int count = 0, avail = ~(cols | diag | anti) & full;
        while (avail != 0) {
            int p = avail & -avail; avail -= p;
            count += solve(cols | p, ((diag | p) << 1) & full, (anti | p) >> 1);
        }
        return count;
    }
    static int totalNQueens(int n) { full = (1 << n) - 1; return solve(0, 0, 0); }
    public static void main(String[] args) { System.out.println(totalNQueens(8)); } // 92
}
```

### Python
```python
def total_n_queens(n: int) -> int:
    full = (1 << n) - 1

    def solve(cols: int, diag: int, anti: int) -> int:
        if cols == full:
            return 1
        total, avail = 0, ~(cols | diag | anti) & full
        while avail:
            p = avail & -avail
            avail -= p
            total += solve(cols | p, ((diag | p) << 1) & full, (anti | p) >> 1)
        return total

    return solve(0, 0, 0)


if __name__ == "__main__":
    print(total_n_queens(8))  # 92
```

---

## Coding Challenge 3: Bitmask Version with Last-Row Popcount

**Problem.** Count solutions using the last-row `popcount` shortcut for speed.

### Go
```go
package main

import (
	"fmt"
	"math/bits"
)

func countFast(n int) int {
	full := (1 << n) - 1
	if n == 1 {
		return 1
	}
	var rec func(row, cols, diag, anti int) int
	rec = func(row, cols, diag, anti int) int {
		avail := ^(cols | diag | anti) & full
		if row == n-1 {
			return bits.OnesCount(uint(avail)) // each free col is a solution
		}
		count := 0
		for avail != 0 {
			p := avail & -avail
			avail -= p
			count += rec(row+1, cols|p, (diag|p)<<1&full, (anti|p)>>1)
		}
		return count
	}
	return rec(0, 0, 0, 0)
}

func main() { fmt.Println(countFast(12)) } // 14200
```

### Java
```java
public class CountFast {
    static int n, full;
    static int rec(int row, int cols, int diag, int anti) {
        int avail = ~(cols | diag | anti) & full;
        if (row == n - 1) return Integer.bitCount(avail);
        int count = 0;
        while (avail != 0) {
            int p = avail & -avail; avail -= p;
            count += rec(row + 1, cols | p, ((diag | p) << 1) & full, (anti | p) >> 1);
        }
        return count;
    }
    static int countFast(int N) {
        n = N; full = (1 << N) - 1;
        if (N == 1) return 1;
        return rec(0, 0, 0, 0);
    }
    public static void main(String[] args) { System.out.println(countFast(12)); } // 14200
}
```

### Python
```python
def count_fast(n: int) -> int:
    full = (1 << n) - 1
    if n == 1:
        return 1

    def rec(row: int, cols: int, diag: int, anti: int) -> int:
        avail = ~(cols | diag | anti) & full
        if row == n - 1:
            return bin(avail).count("1")   # each free col is a solution
        count = 0
        while avail:
            p = avail & -avail
            avail -= p
            count += rec(row + 1, cols | p, ((diag | p) << 1) & full, (anti | p) >> 1)
        return count

    return rec(0, 0, 0, 0)


if __name__ == "__main__":
    print(count_fast(12))  # 14200
```

---

## Coding Challenge 4: Print All Boards

**Problem.** Print every solution board for a small `N` (e.g. `N = 5`).

### Go
```go
package main

import "fmt"

func printAll(n int) {
	pos := make([]int, n)
	cols := make([]bool, n)
	diag := make([]bool, 2*n-1)
	anti := make([]bool, 2*n-1)
	num := 0
	var solve func(r int)
	solve = func(r int) {
		if r == n {
			num++
			fmt.Printf("Solution %d:\n", num)
			for i := 0; i < n; i++ {
				for j := 0; j < n; j++ {
					if pos[i] == j {
						fmt.Print("Q")
					} else {
						fmt.Print(".")
					}
				}
				fmt.Println()
			}
			fmt.Println()
			return
		}
		for c := 0; c < n; c++ {
			d, a := r-c+n-1, r+c
			if cols[c] || diag[d] || anti[a] {
				continue
			}
			pos[r] = c
			cols[c], diag[d], anti[a] = true, true, true
			solve(r + 1)
			cols[c], diag[d], anti[a] = false, false, false
		}
	}
	solve(0)
}

func main() { printAll(5) } // 10 boards
```

### Java
```java
public class PrintAll {
    static int n, num;
    static int[] pos;
    static boolean[] cols, diag, anti;
    static void solve(int r) {
        if (r == n) {
            System.out.println("Solution " + (++num) + ":");
            for (int i = 0; i < n; i++) {
                StringBuilder sb = new StringBuilder();
                for (int j = 0; j < n; j++) sb.append(pos[i] == j ? 'Q' : '.');
                System.out.println(sb);
            }
            System.out.println();
            return;
        }
        for (int c = 0; c < n; c++) {
            int d = r - c + n - 1, a = r + c;
            if (cols[c] || diag[d] || anti[a]) continue;
            pos[r] = c; cols[c] = diag[d] = anti[a] = true;
            solve(r + 1);
            cols[c] = diag[d] = anti[a] = false;
        }
    }
    public static void main(String[] args) {
        n = 5; pos = new int[n];
        cols = new boolean[n]; diag = new boolean[2*n-1]; anti = new boolean[2*n-1];
        solve(0);
    }
}
```

### Python
```python
def print_all(n: int) -> None:
    pos = [0] * n
    cols = [False] * n
    diag = [False] * (2 * n - 1)
    anti = [False] * (2 * n - 1)
    num = 0

    def solve(r: int) -> None:
        nonlocal num
        if r == n:
            num += 1
            print(f"Solution {num}:")
            for i in range(n):
                print("".join("Q" if pos[i] == j else "." for j in range(n)))
            print()
            return
        for c in range(n):
            d, a = r - c + n - 1, r + c
            if cols[c] or diag[d] or anti[a]:
                continue
            pos[r] = c
            cols[c] = diag[d] = anti[a] = True
            solve(r + 1)
            cols[c] = diag[d] = anti[a] = False

    solve(0)


if __name__ == "__main__":
    print_all(5)  # 10 boards
```

---

## Final Tips

- Lead with the **structure** (one per row) before any code; it makes everything else fall out.
- Get the **diagonal indices** right out loud: `r - c + N - 1` and `r + c`. Interviewers watch for the off-by-one.
- Mention the **find-one / count-all / print-all** fork — it shows you understand the search shape.
- Know the **headline numbers** (92 for N=8; no solution for N=2,3; no closed form) and the deeper facts (D4, Burnside 12 fundamentals, NP-complete completion) for senior rounds.
- For "make it fast," reach for the **bitmask** + last-row **popcount** + **symmetry**, and explain why undo is free with by-value masks.
