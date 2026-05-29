# Introduction to DSA — Practice Tasks

These tasks build the most important habit an engineer needs before learning specific data structures: matching a problem's access pattern to the right tool. Before you memorize a binary tree or a hash map, you should be able to look at a scenario and say "this needs O(1) lookup by key" or "this needs ordered traversal." Every task below trains that judgment.

The tasks are split into three levels. Beginner tasks focus on recognition — naming the right structure, counting operations, and writing one-screen implementations. Intermediate tasks introduce common access patterns (FIFO, frequency, kth-element, cycle, balanced brackets). Advanced tasks compose structures (hash map plus linked list, two heaps, monotonic deque) and let you feel why a single structure is rarely enough for a real problem.

Solve each task in **Go, Java, and Python** (in that order). Starter code is provided as stubs — they compile and run as-is, but return placeholder values. Replace the stubs with working implementations. Time budget per task: 20–60 minutes. If a task takes longer than 90 minutes, jump to the next one and come back later.

## Table of Contents

1. [Beginner Tasks](#beginner-tasks)
   - [Task 1: Pick the Right Data Structure](#task-1-pick-the-right-data-structure)
   - [Task 2: First Duplicate — Three Ways](#task-2-first-duplicate--three-ways)
   - [Task 3: Big-O Self-Grader](#task-3-big-o-self-grader)
   - [Task 4: Word Frequency Counter](#task-4-word-frequency-counter)
   - [Task 5: Reverse — Array vs Linked List](#task-5-reverse--array-vs-linked-list)
2. [Intermediate Tasks](#intermediate-tasks)
   - [Task 6: Recent Items Tracker (Bounded FIFO)](#task-6-recent-items-tracker-bounded-fifo)
   - [Task 7: Is Anagram](#task-7-is-anagram)
   - [Task 8: Kth Largest Element — Sort vs Heap](#task-8-kth-largest-element--sort-vs-heap)
   - [Task 9: Detect Cycle in a Linked List](#task-9-detect-cycle-in-a-linked-list)
   - [Task 10: Balanced Parentheses](#task-10-balanced-parentheses)
3. [Advanced Tasks](#advanced-tasks)
   - [Task 11: LRU Cache from Scratch](#task-11-lru-cache-from-scratch)
   - [Task 12: Running Median of a Stream](#task-12-running-median-of-a-stream)
   - [Task 13: Sliding Window Maximum](#task-13-sliding-window-maximum)
   - [Task 14: Basic Bloom Filter](#task-14-basic-bloom-filter)
   - [Task 15: Two-Sum and Three-Sum](#task-15-two-sum-and-three-sum)
4. [Benchmark Task](#benchmark-task)

---

## Beginner Tasks

### Task 1: Pick the Right Data Structure

**Problem.** You are given five short scenarios. For each one, return the **name** of the data structure that fits best (one of: `array`, `linked-list`, `hash-map`, `hash-set`, `stack`, `queue`, `deque`, `heap`, `tree`, `trie`). This is a "paper task" in disguise — the implementation is a `recommend(scenario)` function that maps each scenario string to your chosen structure. A test harness checks your answers.

The scenarios:

1. `"undo history for a text editor"` — last action must be the first one reverted
2. `"phonebook lookup by name"` — fast lookup by a string key
3. `"breadth-first traversal of a website's pages"` — process in arrival order
4. `"streaming top-K largest values"` — keep the smallest of the current top-K cheap to drop
5. `"detect whether a username was already seen"` — exists / not exists check

- **Constraints:** input scenario string is one of the five above; case-sensitive match; function must be pure (no I/O); answer in O(1)
- **Expected output:** `recommend("undo history for a text editor")` returns `"stack"`
- **Evaluation:** all five scenarios mapped correctly; the rationale is consistent (last-in-first-out, key lookup, FIFO, min-heap, set membership); no overengineering — a switch/if-chain is enough

#### Go

```go
package main

import "fmt"

// recommend returns the data structure name that best fits the scenario.
// Implementation note: a single switch is enough; do not call any library.
func recommend(scenario string) string {
	// TODO: return the right structure name for each scenario
	return ""
}

func main() {
	cases := []string{
		"undo history for a text editor",
		"phonebook lookup by name",
		"breadth-first traversal of a website's pages",
		"streaming top-K largest values",
		"detect whether a username was already seen",
	}
	for _, c := range cases {
		fmt.Printf("%-50s -> %s\n", c, recommend(c))
	}
}
```

#### Java

```java
public class Task1 {
	// Map each scenario string to the data structure name.
	// Use a switch — no external libraries, no I/O.
	public static String recommend(String scenario) {
		// TODO: return the right structure name for each scenario
		return "";
	}

	public static void main(String[] args) {
		String[] cases = {
			"undo history for a text editor",
			"phonebook lookup by name",
			"breadth-first traversal of a website's pages",
			"streaming top-K largest values",
			"detect whether a username was already seen"
		};
		for (String c : cases) {
			System.out.printf("%-50s -> %s%n", c, recommend(c));
		}
	}
}
```

#### Python

```python
# Map each scenario string to a data structure name.
# Use an if/elif chain or a dict — no I/O inside the function.

def recommend(scenario: str) -> str:
    # TODO: return the right structure name for each scenario
    return ""


if __name__ == "__main__":
    cases = [
        "undo history for a text editor",
        "phonebook lookup by name",
        "breadth-first traversal of a website's pages",
        "streaming top-K largest values",
        "detect whether a username was already seen",
    ]
    for c in cases:
        print(f"{c:<50} -> {recommend(c)}")
```

---

### Task 2: First Duplicate — Three Ways

**Problem.** Given a list of integers, find the value of the first element that appears at least twice (the duplicate whose **second occurrence** has the smallest index). Implement three versions: brute-force `O(n^2)`, sort-and-scan `O(n log n)`, and hash set `O(n)`. Time each implementation and print the results.

- **Constraints:** `1 <= n <= 10^5`; values fit in `int32`; if no duplicate exists, return `-1`
- **Expected output:** for `[3, 1, 4, 1, 5, 9, 2, 6, 5]` all three implementations return `1`
- **Evaluation:** all three return the same answer for the same input; you can articulate why sort+scan is `O(n log n)` and hash set is `O(n)`; you noticed that sort-and-scan does not preserve original order, so it needs care when reading the "first" duplicate

#### Go

```go
package main

import (
	"fmt"
	"sort"
	"time"
)

// Brute force: for each pair (i, j) check arr[i] == arr[j]. O(n^2) time.
func firstDupBrute(arr []int) int {
	// TODO
	return -1
}

// Sort then scan adjacent pairs. O(n log n) time.
// Hint: sort a copy, do not mutate input.
func firstDupSort(arr []int) int {
	_ = sort.Ints
	// TODO
	return -1
}

// Hash set: first value whose second occurrence is hit. O(n) time, O(n) space.
func firstDupHash(arr []int) int {
	// TODO
	return -1
}

func timed(name string, fn func() int) {
	start := time.Now()
	result := fn()
	fmt.Printf("%-20s -> %d (%v)\n", name, result, time.Since(start))
}

func main() {
	arr := []int{3, 1, 4, 1, 5, 9, 2, 6, 5}
	timed("brute", func() int { return firstDupBrute(arr) })
	timed("sort", func() int { return firstDupSort(arr) })
	timed("hash", func() int { return firstDupHash(arr) })
}
```

#### Java

```java
import java.util.Arrays;

public class Task2 {
	// Brute force, O(n^2)
	public static int firstDupBrute(int[] arr) {
		// TODO
		return -1;
	}

	// Sort a copy then scan adjacent pairs, O(n log n)
	public static int firstDupSort(int[] arr) {
		int[] copy = Arrays.copyOf(arr, arr.length);
		// TODO
		return -1;
	}

	// Hash set, O(n)
	public static int firstDupHash(int[] arr) {
		// TODO
		return -1;
	}

	static void timed(String name, java.util.function.IntSupplier fn) {
		long start = System.nanoTime();
		int result = fn.getAsInt();
		long elapsed = System.nanoTime() - start;
		System.out.printf("%-20s -> %d (%.3f ms)%n", name, result, elapsed / 1_000_000.0);
	}

	public static void main(String[] args) {
		int[] arr = {3, 1, 4, 1, 5, 9, 2, 6, 5};
		timed("brute", () -> firstDupBrute(arr));
		timed("sort",  () -> firstDupSort(arr));
		timed("hash",  () -> firstDupHash(arr));
	}
}
```

#### Python

```python
import time
from typing import List


def first_dup_brute(arr: List[int]) -> int:
    # O(n^2): two nested loops
    # TODO
    return -1


def first_dup_sort(arr: List[int]) -> int:
    # O(n log n): sort a copy and scan adjacent pairs
    # TODO
    return -1


def first_dup_hash(arr: List[int]) -> int:
    # O(n): set of seen values; return on second occurrence
    # TODO
    return -1


def timed(name, fn):
    start = time.perf_counter()
    result = fn()
    print(f"{name:<20} -> {result} ({(time.perf_counter() - start) * 1000:.3f} ms)")


if __name__ == "__main__":
    arr = [3, 1, 4, 1, 5, 9, 2, 6, 5]
    timed("brute", lambda: first_dup_brute(arr))
    timed("sort",  lambda: first_dup_sort(arr))
    timed("hash",  lambda: first_dup_hash(arr))
```

---

### Task 3: Big-O Self-Grader

**Problem.** You are given ten short code snippets (as strings). For each one, decide its Big-O class — one of `O(1)`, `O(log n)`, `O(n)`, `O(n log n)`, `O(n^2)`, `O(2^n)`. The starter code provides a `grade(snippet, guess)` helper that compares your guess against the expected answer and prints a pass/fail line. Run the grader and chase 10/10.

The snippets (study them carefully — pay attention to nested loops, the loop step, and any recursion):

```
S1: for i in range(n): print(i)
S2: while n > 1: n //= 2
S3: for i in range(n):
        for j in range(n): print(i, j)
S4: return arr[0]
S5: for i in range(n):
        for j in range(i): print(j)
S6: merge_sort(arr)
S7: def fib(k):
        if k < 2: return k
        return fib(k-1) + fib(k-2)
S8: binary_search(sorted_arr, target)
S9: for i in range(n):
        x = n
        while x > 1: x //= 2
S10: return sum(arr)
```

- **Constraints:** answers are one of the six classes above; ignore constant factors; treat all built-in calls as their textbook complexity
- **Expected output:** for `S1` the answer is `O(n)`; the grader prints `S1: PASS (O(n))` when your guess matches
- **Evaluation:** 10/10 on the grader; you can verbally justify each guess; you correctly recognize that `S5` is still `O(n^2)` even though the inner loop is bounded by `i`, and that `S9` is `O(n log n)` because the inner loop is logarithmic

#### Go

```go
package main

import "fmt"

// expected holds the correct Big-O for each snippet ID.
var expected = map[string]string{
	"S1": "O(n)", "S2": "O(log n)", "S3": "O(n^2)", "S4": "O(1)",
	"S5": "O(n^2)", "S6": "O(n log n)", "S7": "O(2^n)", "S8": "O(log n)",
	"S9": "O(n log n)", "S10": "O(n)",
}

// grade compares the learner's guess against the expected answer.
func grade(id, guess string) bool {
	want := expected[id]
	ok := guess == want
	tag := "FAIL"
	if ok {
		tag = "PASS"
	}
	fmt.Printf("%s: %s (guess=%s, want=%s)\n", id, tag, guess, want)
	return ok
}

func main() {
	// TODO: replace empty strings with your guesses
	guesses := map[string]string{
		"S1": "", "S2": "", "S3": "", "S4": "", "S5": "",
		"S6": "", "S7": "", "S8": "", "S9": "", "S10": "",
	}
	score := 0
	for id := 1; id <= 10; id++ {
		key := fmt.Sprintf("S%d", id)
		if grade(key, guesses[key]) {
			score++
		}
	}
	fmt.Printf("Score: %d/10\n", score)
}
```

#### Java

```java
import java.util.*;

public class Task3 {
	static Map<String, String> expected = Map.of(
		"S1", "O(n)", "S2", "O(log n)", "S3", "O(n^2)", "S4", "O(1)",
		"S5", "O(n^2)", "S6", "O(n log n)", "S7", "O(2^n)", "S8", "O(log n)",
		"S9", "O(n log n)", "S10", "O(n)"
	);

	// Compare a learner's guess against the expected complexity.
	static boolean grade(String id, String guess) {
		String want = expected.get(id);
		boolean ok = want.equals(guess);
		System.out.printf("%s: %s (guess=%s, want=%s)%n",
			id, ok ? "PASS" : "FAIL", guess, want);
		return ok;
	}

	public static void main(String[] args) {
		// TODO: replace empty strings with your guesses
		Map<String, String> guesses = new HashMap<>();
		for (int i = 1; i <= 10; i++) guesses.put("S" + i, "");

		int score = 0;
		for (int i = 1; i <= 10; i++) {
			if (grade("S" + i, guesses.get("S" + i))) score++;
		}
		System.out.println("Score: " + score + "/10");
	}
}
```

#### Python

```python
EXPECTED = {
    "S1": "O(n)", "S2": "O(log n)", "S3": "O(n^2)", "S4": "O(1)",
    "S5": "O(n^2)", "S6": "O(n log n)", "S7": "O(2^n)", "S8": "O(log n)",
    "S9": "O(n log n)", "S10": "O(n)",
}


def grade(snippet_id: str, guess: str) -> bool:
    want = EXPECTED[snippet_id]
    ok = guess == want
    print(f"{snippet_id}: {'PASS' if ok else 'FAIL'} (guess={guess!r}, want={want!r})")
    return ok


if __name__ == "__main__":
    # TODO: replace empty strings with your guesses
    guesses = {f"S{i}": "" for i in range(1, 11)}
    score = sum(grade(k, guesses[k]) for k in sorted(guesses, key=lambda s: int(s[1:])))
    print(f"Score: {score}/10")
```

---

### Task 4: Word Frequency Counter

**Problem.** Given a string of text, return a hash map of `word -> count` and the single most common word. Words are split on whitespace; comparison is case-insensitive; punctuation is stripped from the edges of each token (`.`, `,`, `!`, `?`, `;`, `:`).

- **Constraints:** `1 <= len(text) <= 10^6` characters; ASCII only; ties broken by the word that appears first
- **Expected output:** for `"The quick brown fox. The lazy dog!"` the most common word is `"the"` with count `2`
- **Evaluation:** correct word splitting and lowercasing; hash map used (not a sorted structure); tie-break documented; runs in `O(n)` over the input length

#### Go

```go
package main

import (
	"fmt"
	"strings"
)

// wordFreq splits text on whitespace, strips edge punctuation, lowercases,
// and returns the counts. Most-common word ties are broken by first appearance.
func wordFreq(text string) (map[string]int, string) {
	_ = strings.ToLower
	// TODO: 1) split, 2) clean each token, 3) count, 4) track best
	return nil, ""
}

func main() {
	text := "The quick brown fox. The lazy dog!"
	freq, top := wordFreq(text)
	fmt.Println(freq)
	fmt.Println("Most common:", top)
}
```

#### Java

```java
import java.util.*;

public class Task4 {
	// Returns a (freq, top) pair via a small holder.
	public static Map<String, Integer> wordFreq(String text, String[] topOut) {
		// TODO: split on whitespace, strip edge punctuation, lowercase, count.
		// Write the most common word into topOut[0].
		topOut[0] = "";
		return new HashMap<>();
	}

	public static void main(String[] args) {
		String text = "The quick brown fox. The lazy dog!";
		String[] top = new String[1];
		Map<String, Integer> freq = wordFreq(text, top);
		System.out.println(freq);
		System.out.println("Most common: " + top[0]);
	}
}
```

#### Python

```python
from typing import Dict, Tuple


def word_freq(text: str) -> Tuple[Dict[str, int], str]:
    # TODO: split on whitespace, strip edge punctuation, lowercase, count.
    # Return (counts, most_common_word). Tie-break by first appearance.
    return {}, ""


if __name__ == "__main__":
    text = "The quick brown fox. The lazy dog!"
    freq, top = word_freq(text)
    print(freq)
    print("Most common:", top)
```

---

### Task 5: Reverse — Array vs Linked List

**Problem.** Reverse a sequence of integers two ways. First, reverse an array in place using two indices that walk toward each other. Second, build a singly linked list from scratch (your own `Node` type — no library list) and reverse it by rewiring pointers. Compare the two implementations: what is the runtime, what is the extra space, which one is easier to get right?

- **Constraints:** `0 <= n <= 10^5`; both implementations must run in `O(n)` time; the array version is in place (`O(1)` extra space); the linked list version is also in place (`O(1)` extra space — no new nodes allocated during the reverse)
- **Expected output:** input `[1, 2, 3, 4, 5]` becomes `[5, 4, 3, 2, 1]` for both
- **Evaluation:** correct on empty, single-element, and odd/even length inputs; you implemented the linked-list node from scratch (not the standard library `list` / `LinkedList`); you can explain the three-pointer pattern (`prev`, `curr`, `next`) used in the linked-list reverse

#### Go

```go
package main

import "fmt"

// reverseArray reverses arr in place using two pointers walking toward each other.
func reverseArray(arr []int) {
	// TODO: left, right := 0, len(arr)-1; swap while left < right
}

// Node is a singly linked node built from scratch (no container/list).
type Node struct {
	Val  int
	Next *Node
}

// fromSlice builds a linked list from a Go slice.
func fromSlice(arr []int) *Node {
	var head *Node
	for i := len(arr) - 1; i >= 0; i-- {
		head = &Node{Val: arr[i], Next: head}
	}
	return head
}

// reverseList reverses the linked list in place using prev/curr/next pointers.
func reverseList(head *Node) *Node {
	// TODO: prev, curr := (*Node)(nil), head; walk and flip pointers
	return head
}

func toSlice(head *Node) []int {
	out := []int{}
	for n := head; n != nil; n = n.Next {
		out = append(out, n.Val)
	}
	return out
}

func main() {
	arr := []int{1, 2, 3, 4, 5}
	reverseArray(arr)
	fmt.Println("array:", arr)

	head := fromSlice([]int{1, 2, 3, 4, 5})
	head = reverseList(head)
	fmt.Println("list :", toSlice(head))
}
```

#### Java

```java
import java.util.*;

public class Task5 {
	// In-place array reverse with two indices walking inward.
	public static void reverseArray(int[] arr) {
		// TODO
	}

	// Hand-rolled singly linked node — do not use java.util.LinkedList.
	static class Node {
		int val;
		Node next;
		Node(int val, Node next) { this.val = val; this.next = next; }
	}

	public static Node fromArray(int[] arr) {
		Node head = null;
		for (int i = arr.length - 1; i >= 0; i--) head = new Node(arr[i], head);
		return head;
	}

	// In-place linked-list reverse using prev/curr/next.
	public static Node reverseList(Node head) {
		// TODO
		return head;
	}

	public static List<Integer> toList(Node head) {
		List<Integer> out = new ArrayList<>();
		for (Node n = head; n != null; n = n.next) out.add(n.val);
		return out;
	}

	public static void main(String[] args) {
		int[] arr = {1, 2, 3, 4, 5};
		reverseArray(arr);
		System.out.println("array: " + Arrays.toString(arr));

		Node head = fromArray(new int[]{1, 2, 3, 4, 5});
		head = reverseList(head);
		System.out.println("list : " + toList(head));
	}
}
```

#### Python

```python
from typing import List, Optional


def reverse_array(arr: List[int]) -> None:
    # In-place using two indices. Do not use arr.reverse() or arr[::-1].
    # TODO
    pass


class Node:
    # Hand-rolled singly linked node — do not use collections.deque.
    def __init__(self, val: int, nxt: "Optional[Node]" = None) -> None:
        self.val = val
        self.next = nxt


def from_list(arr: List[int]) -> Optional[Node]:
    head: Optional[Node] = None
    for v in reversed(arr):
        head = Node(v, head)
    return head


def reverse_list(head: Optional[Node]) -> Optional[Node]:
    # In place using prev / curr / nxt pointers. O(1) extra space.
    # TODO
    return head


def to_list(head: Optional[Node]) -> List[int]:
    out: List[int] = []
    n = head
    while n is not None:
        out.append(n.val)
        n = n.next
    return out


if __name__ == "__main__":
    arr = [1, 2, 3, 4, 5]
    reverse_array(arr)
    print("array:", arr)

    head = from_list([1, 2, 3, 4, 5])
    head = reverse_list(head)
    print("list :", to_list(head))
```

---

## Intermediate Tasks

### Task 6: Recent Items Tracker (Bounded FIFO)

**Problem.** Build a tracker that remembers the last 10 items pushed into it. When an 11th item arrives, the oldest one is dropped. Expose `push(item)` and `recent()` which returns the items in oldest-to-newest order. The bounded FIFO requirement naturally pushes you toward a deque (two-ended queue) — both ends must be cheap.

- **Constraints:** capacity is fixed at 10; `push` and `recent` are both called up to `10^6` times across the program; `push` must be `O(1)`
- **Expected output:** after `push(1) .. push(12)`, `recent()` returns `[3, 4, 5, 6, 7, 8, 9, 10, 11, 12]`
- **Evaluation:** `push` is `O(1)` not `O(n)`; you understand why a plain array shifts every time and a deque does not; `recent()` does not mutate the internal state

#### Go

```go
package main

import "fmt"

// RecentTracker keeps the last 10 pushed items in insertion order.
// Internal storage: a fixed-capacity ring buffer or a doubly-linked deque.
type RecentTracker struct {
	// TODO: pick a representation that gives O(1) push and O(1) drop-oldest
}

func NewRecentTracker() *RecentTracker {
	return &RecentTracker{}
}

func (r *RecentTracker) Push(item int) {
	// TODO: append; if size > 10, drop oldest
}

func (r *RecentTracker) Recent() []int {
	// TODO: return items in oldest-first order
	return nil
}

func main() {
	r := NewRecentTracker()
	for i := 1; i <= 12; i++ {
		r.Push(i)
	}
	fmt.Println(r.Recent()) // [3 4 5 6 7 8 9 10 11 12]
}
```

#### Java

```java
import java.util.*;

public class Task6 {
	public static class RecentTracker {
		// TODO: pick a representation with O(1) push and O(1) drop-oldest

		public void push(int item) {
			// TODO
		}

		public List<Integer> recent() {
			// TODO: return oldest-first
			return new ArrayList<>();
		}
	}

	public static void main(String[] args) {
		RecentTracker r = new RecentTracker();
		for (int i = 1; i <= 12; i++) r.push(i);
		System.out.println(r.recent()); // [3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
	}
}
```

#### Python

```python
from typing import List


class RecentTracker:
    """Keeps the last 10 pushed items. push/drop-oldest must be O(1)."""

    def __init__(self) -> None:
        # TODO: pick a representation with O(1) push and O(1) drop-oldest
        pass

    def push(self, item: int) -> None:
        # TODO
        pass

    def recent(self) -> List[int]:
        # TODO: return oldest-first list
        return []


if __name__ == "__main__":
    r = RecentTracker()
    for i in range(1, 13):
        r.push(i)
    print(r.recent())  # [3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
```

---

### Task 7: Is Anagram

**Problem.** Given two strings, return `true` if one is an anagram of the other (same characters with the same multiplicity, possibly reordered). Implement two ways: with a hash map of character counts, and with sorting. Both should handle case-insensitivity and ignore spaces.

- **Constraints:** `1 <= len(a), len(b) <= 10^5`; ASCII only
- **Expected output:** `isAnagram("Listen", "Silent")` returns `true`; `isAnagram("abc", "abd")` returns `false`
- **Evaluation:** the hash-map version runs in `O(n)`, the sort version in `O(n log n)`; both correctly return `false` for inputs of different cleaned length; you decremented as well as incremented (or counted both sides) — not just "every char of a is in b"

#### Go

```go
package main

import "fmt"

// isAnagramHash: count characters of a, decrement for b, all zero at the end.
func isAnagramHash(a, b string) bool {
	// TODO
	return false
}

// isAnagramSort: lowercase, strip spaces, sort the runes, compare.
func isAnagramSort(a, b string) bool {
	// TODO
	return false
}

func main() {
	fmt.Println(isAnagramHash("Listen", "Silent")) // true
	fmt.Println(isAnagramSort("Listen", "Silent")) // true
	fmt.Println(isAnagramHash("abc", "abd"))       // false
}
```

#### Java

```java
import java.util.Arrays;

public class Task7 {
	// O(n) using a 26-slot count array (after cleaning).
	public static boolean isAnagramHash(String a, String b) {
		// TODO
		return false;
	}

	// O(n log n) by sorting cleaned char arrays.
	public static boolean isAnagramSort(String a, String b) {
		// TODO: clean (lowercase, drop spaces), toCharArray, sort, compare
		// Hint: use Arrays.sort on a char[]
		return false;
	}

	public static void main(String[] args) {
		System.out.println(isAnagramHash("Listen", "Silent")); // true
		System.out.println(isAnagramSort("Listen", "Silent")); // true
		System.out.println(isAnagramHash("abc", "abd"));       // false
	}
}
```

#### Python

```python
def is_anagram_hash(a: str, b: str) -> bool:
    # Count chars of a, decrement with b's chars, then check all counts are zero.
    # TODO
    return False


def is_anagram_sort(a: str, b: str) -> bool:
    # Clean (lower, no spaces), sort, compare.
    # TODO
    return False


if __name__ == "__main__":
    print(is_anagram_hash("Listen", "Silent"))  # True
    print(is_anagram_sort("Listen", "Silent"))  # True
    print(is_anagram_hash("abc", "abd"))        # False
```

---

### Task 8: Kth Largest Element — Sort vs Heap

**Problem.** Given an array of integers and a value `k`, return the kth largest element (1-indexed: `k = 1` is the maximum). Implement two ways: full sort then index, and a min-heap of size `k`. Reason about both — which one is better when `n = 10^7` and `k = 5`? Which one is better when `k = n / 2`?

- **Constraints:** `1 <= k <= n <= 10^6`; values fit in `int32`; assume duplicates are allowed and counted (so the 2nd largest in `[5, 5, 4]` is `5`)
- **Expected output:** `kthLargest([3, 2, 1, 5, 6, 4], 2)` returns `5`
- **Evaluation:** both implementations return the same answer; the sort version is `O(n log n)`; the heap version is `O(n log k)` and uses `O(k)` extra space; you can verbalize when each beats the other

#### Go

```go
package main

import (
	"container/heap"
	"fmt"
	"sort"
)

// kthLargestSort: sort descending and index.
func kthLargestSort(arr []int, k int) int {
	_ = sort.Ints
	// TODO
	return 0
}

// minHeap implements container/heap.Interface for ints.
type minHeap []int

func (h minHeap) Len() int            { return len(h) }
func (h minHeap) Less(i, j int) bool  { return h[i] < h[j] }
func (h minHeap) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *minHeap) Push(x interface{}) { *h = append(*h, x.(int)) }
func (h *minHeap) Pop() interface{}   { old := *h; n := len(old); x := old[n-1]; *h = old[:n-1]; return x }

// kthLargestHeap: maintain a min-heap of size k; the heap's root is the answer.
func kthLargestHeap(arr []int, k int) int {
	_ = heap.Init
	// TODO
	return 0
}

func main() {
	arr := []int{3, 2, 1, 5, 6, 4}
	fmt.Println(kthLargestSort(arr, 2)) // 5
	fmt.Println(kthLargestHeap(arr, 2)) // 5
}
```

#### Java

```java
import java.util.*;

public class Task8 {
	// Full sort, O(n log n).
	public static int kthLargestSort(int[] arr, int k) {
		// TODO: clone, sort, return [length - k]
		return 0;
	}

	// Min-heap of size k, O(n log k).
	public static int kthLargestHeap(int[] arr, int k) {
		// TODO: PriorityQueue<Integer> sized k (min-heap by default); root is the answer
		PriorityQueue<Integer> pq = new PriorityQueue<>();
		return 0;
	}

	public static void main(String[] args) {
		int[] arr = {3, 2, 1, 5, 6, 4};
		System.out.println(kthLargestSort(arr, 2)); // 5
		System.out.println(kthLargestHeap(arr, 2)); // 5
	}
}
```

#### Python

```python
import heapq
from typing import List


def kth_largest_sort(arr: List[int], k: int) -> int:
    # Sort and index — O(n log n).
    # TODO
    return 0


def kth_largest_heap(arr: List[int], k: int) -> int:
    # Maintain a min-heap of size k; the root is the answer. O(n log k).
    # TODO
    return 0


if __name__ == "__main__":
    arr = [3, 2, 1, 5, 6, 4]
    print(kth_largest_sort(arr, 2))  # 5
    print(kth_largest_heap(arr, 2))  # 5
```

---

### Task 9: Detect Cycle in a Linked List

**Problem.** Given the head of a singly linked list, return `true` if the list contains a cycle (some node's `next` points back to an earlier node). Use Floyd's tortoise-and-hare: two pointers, one stepping one node at a time and one stepping two. If they meet, there is a cycle; if the fast pointer reaches `nil`, there is no cycle.

- **Constraints:** `0 <= n <= 10^5` nodes; you must not modify the node values; `O(1)` extra space (no hash set of visited nodes)
- **Expected output:** for a list `1 -> 2 -> 3 -> 4 -> 2` (where node `4.next` is node `2`), return `true`; for `1 -> 2 -> 3 -> nil`, return `false`
- **Evaluation:** correct on empty list, single-node, single-node self-cycle, and a long acyclic list; `O(1)` extra space (no `visited` set); the fast pointer's null check covers both `fast` and `fast.Next`

#### Go

```go
package main

import "fmt"

type Node struct {
	Val  int
	Next *Node
}

// hasCycle uses two pointers: slow steps once, fast steps twice. If they meet, cycle.
func hasCycle(head *Node) bool {
	// TODO
	return false
}

func main() {
	// Build 1 -> 2 -> 3 -> 4 -> 2 (cycle back to node 2)
	n4 := &Node{Val: 4}
	n3 := &Node{Val: 3, Next: n4}
	n2 := &Node{Val: 2, Next: n3}
	n1 := &Node{Val: 1, Next: n2}
	n4.Next = n2
	fmt.Println(hasCycle(n1)) // true

	// Acyclic 10 -> 20 -> 30
	a := &Node{Val: 10, Next: &Node{Val: 20, Next: &Node{Val: 30}}}
	fmt.Println(hasCycle(a)) // false
}
```

#### Java

```java
public class Task9 {
	static class Node {
		int val;
		Node next;
		Node(int val) { this.val = val; }
	}

	// Floyd's tortoise-and-hare. O(1) extra space.
	public static boolean hasCycle(Node head) {
		// TODO
		return false;
	}

	public static void main(String[] args) {
		Node n4 = new Node(4), n3 = new Node(3), n2 = new Node(2), n1 = new Node(1);
		n1.next = n2; n2.next = n3; n3.next = n4; n4.next = n2;
		System.out.println(hasCycle(n1)); // true

		Node a = new Node(10); a.next = new Node(20); a.next.next = new Node(30);
		System.out.println(hasCycle(a)); // false
	}
}
```

#### Python

```python
from typing import Optional


class Node:
    def __init__(self, val: int, nxt: "Optional[Node]" = None) -> None:
        self.val = val
        self.next = nxt


def has_cycle(head: Optional[Node]) -> bool:
    # Tortoise and hare. O(1) extra space, O(n) time.
    # TODO
    return False


if __name__ == "__main__":
    n4 = Node(4); n3 = Node(3, n4); n2 = Node(2, n3); n1 = Node(1, n2)
    n4.next = n2
    print(has_cycle(n1))  # True

    a = Node(10, Node(20, Node(30)))
    print(has_cycle(a))   # False
```

---

### Task 10: Balanced Parentheses

**Problem.** Given a string containing only the characters `(`, `)`, `[`, `]`, `{`, `}`, return `true` if every opening bracket is closed by the correct matching bracket in the right order. Use a stack: push opening brackets, pop and match on closing brackets, and at the end the stack must be empty.

- **Constraints:** `0 <= len(s) <= 10^5`; only the six characters listed; `O(n)` time, `O(n)` space worst case
- **Expected output:** `isBalanced("({[]})")` returns `true`; `isBalanced("(]")` returns `false`; `isBalanced("")` returns `true`
- **Evaluation:** handles the empty string; rejects strings that close brackets the input never opened (`"()]"`); rejects strings that leave brackets open (`"((("`); uses a stack (not a counter — `"([)]"` must fail)

#### Go

```go
package main

import "fmt"

// isBalanced returns true if every bracket is closed by the right partner in order.
func isBalanced(s string) bool {
	// TODO: stack of opening brackets; match on every closing one; final stack empty
	return false
}

func main() {
	fmt.Println(isBalanced("({[]})")) // true
	fmt.Println(isBalanced("(]"))     // false
	fmt.Println(isBalanced("([)]"))   // false
	fmt.Println(isBalanced(""))       // true
}
```

#### Java

```java
import java.util.*;

public class Task10 {
	// Use a stack of opening brackets. Pop and match on every closing bracket.
	public static boolean isBalanced(String s) {
		Deque<Character> stack = new ArrayDeque<>();
		// TODO
		return false;
	}

	public static void main(String[] args) {
		System.out.println(isBalanced("({[]})")); // true
		System.out.println(isBalanced("(]"));     // false
		System.out.println(isBalanced("([)]"));   // false
		System.out.println(isBalanced(""));       // true
	}
}
```

#### Python

```python
def is_balanced(s: str) -> bool:
    # Stack of opening brackets. On every closer, pop and check the partner.
    # TODO
    return False


if __name__ == "__main__":
    print(is_balanced("({[]})"))  # True
    print(is_balanced("(]"))      # False
    print(is_balanced("([)]"))    # False
    print(is_balanced(""))        # True
```

---

## Advanced Tasks

### Task 11: LRU Cache from Scratch

**Problem.** Build a Least-Recently-Used cache with `get(key)` and `put(key, value)`, both in `O(1)` average time. Use a hash map (key -> node) combined with a doubly linked list (most-recent at head, least-recent at tail). On `get`, move the node to the head. On `put`, insert or update and move to head; if the cache is over capacity, drop the tail and remove it from the map.

- **Constraints:** `1 <= capacity <= 10^4`; keys and values are integers; up to `10^5` operations total
- **Expected output:** with capacity 2 — `put(1,1)`, `put(2,2)`, `get(1)` returns `1`, `put(3,3)` evicts key `2`, `get(2)` returns `-1`, `put(4,4)` evicts key `1`, `get(1)` returns `-1`, `get(3)` returns `3`, `get(4)` returns `4`
- **Evaluation:** both `get` and `put` are `O(1)` (not `O(n)` from iterating the list to find a node); sentinel head and tail nodes (so insertions don't need a "is the list empty?" branch); correct eviction order

#### Go

```go
package main

import "fmt"

type lruNode struct {
	key, val   int
	prev, next *lruNode
}

type LRUCache struct {
	cap        int
	store      map[int]*lruNode
	head, tail *lruNode // sentinels
}

func NewLRUCache(capacity int) *LRUCache {
	head, tail := &lruNode{}, &lruNode{}
	head.next, tail.prev = tail, head
	return &LRUCache{
		cap:   capacity,
		store: make(map[int]*lruNode),
		head:  head, tail: tail,
	}
}

func (c *LRUCache) Get(key int) int {
	// TODO: lookup in map; if hit, move node to head; return value or -1
	return -1
}

func (c *LRUCache) Put(key, val int) {
	// TODO: if exists, update val + move to head; else insert at head;
	// if over capacity, drop the node before tail and delete from map
}

func main() {
	c := NewLRUCache(2)
	c.Put(1, 1)
	c.Put(2, 2)
	fmt.Println(c.Get(1)) // 1
	c.Put(3, 3)
	fmt.Println(c.Get(2)) // -1
	c.Put(4, 4)
	fmt.Println(c.Get(1)) // -1
	fmt.Println(c.Get(3)) // 3
	fmt.Println(c.Get(4)) // 4
}
```

#### Java

```java
import java.util.*;

public class Task11 {
	static class Node {
		int key, val;
		Node prev, next;
		Node(int key, int val) { this.key = key; this.val = val; }
	}

	int cap;
	Map<Integer, Node> store = new HashMap<>();
	Node head = new Node(0, 0), tail = new Node(0, 0);

	public Task11(int capacity) {
		this.cap = capacity;
		head.next = tail;
		tail.prev = head;
	}

	public int get(int key) {
		// TODO: O(1) lookup, move-to-head if hit
		return -1;
	}

	public void put(int key, int val) {
		// TODO: insert/update + move to head; evict tail-1 if over capacity
	}

	public static void main(String[] args) {
		Task11 c = new Task11(2);
		c.put(1, 1);
		c.put(2, 2);
		System.out.println(c.get(1)); // 1
		c.put(3, 3);
		System.out.println(c.get(2)); // -1
		c.put(4, 4);
		System.out.println(c.get(1)); // -1
		System.out.println(c.get(3)); // 3
		System.out.println(c.get(4)); // 4
	}
}
```

#### Python

```python
class _Node:
    __slots__ = ("key", "val", "prev", "next")

    def __init__(self, key: int = 0, val: int = 0) -> None:
        self.key = key
        self.val = val
        self.prev: "_Node | None" = None
        self.next: "_Node | None" = None


class LRUCache:
    def __init__(self, capacity: int) -> None:
        self.cap = capacity
        self.store: dict[int, _Node] = {}
        self.head = _Node()
        self.tail = _Node()
        self.head.next = self.tail
        self.tail.prev = self.head

    def get(self, key: int) -> int:
        # TODO: O(1) hit + move-to-head
        return -1

    def put(self, key: int, val: int) -> None:
        # TODO: insert/update + move-to-head; evict tail.prev if over capacity
        pass


if __name__ == "__main__":
    c = LRUCache(2)
    c.put(1, 1)
    c.put(2, 2)
    print(c.get(1))  # 1
    c.put(3, 3)
    print(c.get(2))  # -1
    c.put(4, 4)
    print(c.get(1))  # -1
    print(c.get(3))  # 3
    print(c.get(4))  # 4
```

---

### Task 12: Running Median of a Stream

**Problem.** Numbers arrive one at a time. After each `add(value)`, return the median of every value seen so far. Maintain two heaps: a max-heap for the lower half and a min-heap for the upper half. Keep their sizes within one of each other. The median is the top of the larger heap, or the average of both tops if the heaps are the same size.

- **Constraints:** up to `10^5` values; values fit in `int32`; both `add` and `median` should be `O(log n)`
- **Expected output:** stream `[1, 2, 3, 4]` produces medians `[1.0, 1.5, 2.0, 2.5]`
- **Evaluation:** correct after every insert (not just at the end); the heap sizes never differ by more than 1; you handled the integer/float return type cleanly; you can explain why a single sorted list would be `O(n)` per insert and is the wrong choice here

#### Go

```go
package main

import (
	"container/heap"
	"fmt"
)

// Two heap helpers.
type maxIntHeap []int
type minIntHeap []int

func (h maxIntHeap) Len() int            { return len(h) }
func (h maxIntHeap) Less(i, j int) bool  { return h[i] > h[j] }
func (h maxIntHeap) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *maxIntHeap) Push(x interface{}) { *h = append(*h, x.(int)) }
func (h *maxIntHeap) Pop() interface{}   { old := *h; n := len(old); x := old[n-1]; *h = old[:n-1]; return x }

func (h minIntHeap) Len() int            { return len(h) }
func (h minIntHeap) Less(i, j int) bool  { return h[i] < h[j] }
func (h minIntHeap) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *minIntHeap) Push(x interface{}) { *h = append(*h, x.(int)) }
func (h *minIntHeap) Pop() interface{}   { old := *h; n := len(old); x := old[n-1]; *h = old[:n-1]; return x }

type MedianFinder struct {
	lower *maxIntHeap // max-heap with the lower half
	upper *minIntHeap // min-heap with the upper half
}

func NewMedianFinder() *MedianFinder {
	return &MedianFinder{lower: &maxIntHeap{}, upper: &minIntHeap{}}
}

func (m *MedianFinder) Add(val int) {
	// TODO: push to the right heap, then rebalance so sizes differ by at most 1
	_ = heap.Push
}

func (m *MedianFinder) Median() float64 {
	// TODO: top of larger heap, or average of two tops if equal
	return 0
}

func main() {
	mf := NewMedianFinder()
	for _, v := range []int{1, 2, 3, 4} {
		mf.Add(v)
		fmt.Println(mf.Median())
	}
}
```

#### Java

```java
import java.util.*;

public class Task12 {
	PriorityQueue<Integer> lower = new PriorityQueue<>(Comparator.reverseOrder()); // max-heap
	PriorityQueue<Integer> upper = new PriorityQueue<>(); // min-heap

	public void add(int val) {
		// TODO: push to the correct heap; rebalance if size difference > 1
	}

	public double median() {
		// TODO: bigger heap's top, or average of both tops when equal
		return 0.0;
	}

	public static void main(String[] args) {
		Task12 mf = new Task12();
		for (int v : new int[]{1, 2, 3, 4}) {
			mf.add(v);
			System.out.println(mf.median());
		}
	}
}
```

#### Python

```python
import heapq
from typing import List


class MedianFinder:
    def __init__(self) -> None:
        # Python's heapq is a min-heap. Store negatives in the lower half to fake a max-heap.
        self.lower: List[int] = []  # max-heap (negated)
        self.upper: List[int] = []  # min-heap

    def add(self, val: int) -> None:
        # TODO: push to the right heap, then rebalance
        pass

    def median(self) -> float:
        # TODO: top of bigger heap, or average of both tops if equal
        return 0.0


if __name__ == "__main__":
    mf = MedianFinder()
    for v in [1, 2, 3, 4]:
        mf.add(v)
        print(mf.median())
```

---

### Task 13: Sliding Window Maximum

**Problem.** Given an array and a window size `k`, return the maximum value of every contiguous window of size `k`. The textbook trick is a **monotonic deque** that stores indices: when a new element enters the window, pop indices from the back whose values are smaller (they can never be the max again); when the front index falls out of the window, pop it from the front. The front of the deque is always the current window's max.

- **Constraints:** `1 <= k <= n <= 10^5`; values fit in `int32`; `O(n)` time, `O(k)` extra space
- **Expected output:** `slidingMax([1, 3, -1, -3, 5, 3, 6, 7], 3)` returns `[3, 3, 5, 5, 6, 7]`
- **Evaluation:** correct on `k = 1` (returns the original array), `k = n` (returns one element — the global max), and an array of duplicates; you stored **indices** (not values) — you need the index to know when to pop from the front; the deque is monotonically decreasing in value

#### Go

```go
package main

import "fmt"

// slidingMax returns the max of every window of size k using a monotonic deque of indices.
func slidingMax(arr []int, k int) []int {
	// TODO: deque (use a Go slice) storing indices; values at those indices strictly decrease
	return nil
}

func main() {
	fmt.Println(slidingMax([]int{1, 3, -1, -3, 5, 3, 6, 7}, 3)) // [3 3 5 5 6 7]
}
```

#### Java

```java
import java.util.*;

public class Task13 {
	// Monotonic deque of indices. O(n) time, O(k) space.
	public static int[] slidingMax(int[] arr, int k) {
		Deque<Integer> dq = new ArrayDeque<>();
		// TODO
		return new int[0];
	}

	public static void main(String[] args) {
		System.out.println(Arrays.toString(slidingMax(
			new int[]{1, 3, -1, -3, 5, 3, 6, 7}, 3))); // [3, 3, 5, 5, 6, 7]
	}
}
```

#### Python

```python
from collections import deque
from typing import List


def sliding_max(arr: List[int], k: int) -> List[int]:
    # Monotonic deque of indices, decreasing in values.
    # TODO
    return []


if __name__ == "__main__":
    print(sliding_max([1, 3, -1, -3, 5, 3, 6, 7], 3))  # [3, 3, 5, 5, 6, 7]
```

---

### Task 14: Basic Bloom Filter

**Problem.** Build a basic Bloom filter: a bit array of size `m` and `k` independent hash functions. `add(x)` sets the `k` bits for `x`; `contains(x)` returns `true` only if **all** `k` bits are set. False positives are possible (a `true` may be wrong); false negatives are not (a `false` is always correct). Use two simple integer hashes and derive the `k` hashes as `h_i(x) = (h1(x) + i * h2(x)) mod m` (double-hashing).

- **Constraints:** `m = 1024`, `k = 3`; only positive integers up to `10^9`; do not allocate a Python `set` to "fake" membership
- **Expected output:** after `add(42)`, `contains(42)` returns `true`; `contains(99)` usually returns `false` (but may rarely return `true` — that is the expected false positive behavior)
- **Evaluation:** the bit array is actually a bit array (or `[]byte` / `BitSet` / `bytearray`) — not a list of booleans; the `k` hashes are deterministic and independent of insertion order; `contains` does not modify any bit; you understand why a "remove" operation is not safe in a basic Bloom filter

#### Go

```go
package main

import "fmt"

type BloomFilter struct {
	bits []uint64 // m bits packed into uint64 words
	m    int      // number of bits
	k    int      // number of hashes
}

func NewBloomFilter(m, k int) *BloomFilter {
	words := (m + 63) / 64
	return &BloomFilter{bits: make([]uint64, words), m: m, k: k}
}

func (b *BloomFilter) hash1(x int) int { return ((x * 2654435761) & 0x7fffffff) % b.m }
func (b *BloomFilter) hash2(x int) int { return ((x*40499 + 17) & 0x7fffffff) % b.m }

func (b *BloomFilter) Add(x int) {
	// TODO: for i in 0..k-1, set bit at (hash1(x) + i*hash2(x)) % m
}

func (b *BloomFilter) Contains(x int) bool {
	// TODO: return false on the first bit that is not set
	return false
}

func main() {
	bf := NewBloomFilter(1024, 3)
	bf.Add(42)
	fmt.Println(bf.Contains(42)) // true
	fmt.Println(bf.Contains(99)) // usually false
}
```

#### Java

```java
import java.util.BitSet;

public class Task14 {
	BitSet bits;
	int m, k;

	public Task14(int m, int k) {
		this.m = m;
		this.k = k;
		this.bits = new BitSet(m);
	}

	int hash1(int x) { return ((x * 2654435761) & 0x7fffffff) % m; }
	int hash2(int x) { return ((x * 40499 + 17) & 0x7fffffff) % m; }

	public void add(int x) {
		// TODO: set k bits using double hashing
	}

	public boolean contains(int x) {
		// TODO: return false on the first unset bit
		return false;
	}

	public static void main(String[] args) {
		Task14 bf = new Task14(1024, 3);
		bf.add(42);
		System.out.println(bf.contains(42)); // true
		System.out.println(bf.contains(99)); // usually false
	}
}
```

#### Python

```python
class BloomFilter:
    def __init__(self, m: int = 1024, k: int = 3) -> None:
        self.m = m
        self.k = k
        self.bits = bytearray((m + 7) // 8)

    def _h1(self, x: int) -> int:
        return ((x * 2654435761) & 0x7fffffff) % self.m

    def _h2(self, x: int) -> int:
        return ((x * 40499 + 17) & 0x7fffffff) % self.m

    def _set_bit(self, idx: int) -> None:
        self.bits[idx >> 3] |= 1 << (idx & 7)

    def _get_bit(self, idx: int) -> bool:
        return bool(self.bits[idx >> 3] & (1 << (idx & 7)))

    def add(self, x: int) -> None:
        # TODO: set k bits using double hashing
        pass

    def contains(self, x: int) -> bool:
        # TODO: return False on the first unset bit
        return False


if __name__ == "__main__":
    bf = BloomFilter(1024, 3)
    bf.add(42)
    print(bf.contains(42))  # True
    print(bf.contains(99))  # usually False
```

---

### Task 15: Two-Sum and Three-Sum

**Problem.** Implement two related problems. **Two-sum**: given an unsorted array and a target, return the indices of two numbers that add up to the target (use a hash map of value -> index for `O(n)`). **Three-sum**: given an array, return all unique triplets `(a, b, c)` with `a + b + c == 0` (sort first, then for each `a` use the two-pointer technique on the remaining array).

- **Constraints:** for two-sum, `2 <= n <= 10^5`, exactly one solution exists; for three-sum, `3 <= n <= 3*10^3`, values fit in `int32`; results should not contain duplicate triplets
- **Expected output:** `twoSum([2, 7, 11, 15], 9)` returns `[0, 1]`; `threeSum([-1, 0, 1, 2, -1, -4])` returns `[[-1, -1, 2], [-1, 0, 1]]`
- **Evaluation:** two-sum is `O(n)` time, `O(n)` space (hash map); three-sum is `O(n^2)` time, `O(1)` extra space beyond the output (sort + two pointers); your three-sum skips duplicate values both at the outer loop and during the two-pointer sweep

#### Go

```go
package main

import (
	"fmt"
	"sort"
)

// twoSum: hash map of value -> index for O(n) lookup.
func twoSum(arr []int, target int) []int {
	// TODO
	return nil
}

// threeSum: sort, then for each i use two pointers on i+1..n-1. Skip duplicates.
func threeSum(arr []int) [][]int {
	_ = sort.Ints
	// TODO
	return nil
}

func main() {
	fmt.Println(twoSum([]int{2, 7, 11, 15}, 9)) // [0 1]
	fmt.Println(threeSum([]int{-1, 0, 1, 2, -1, -4}))
}
```

#### Java

```java
import java.util.*;

public class Task15 {
	// O(n) using a value -> index hash map.
	public static int[] twoSum(int[] arr, int target) {
		// TODO
		return new int[0];
	}

	// O(n^2): sort, fix a, two-pointer search for b + c == -a.
	public static List<List<Integer>> threeSum(int[] arr) {
		// TODO
		return new ArrayList<>();
	}

	public static void main(String[] args) {
		System.out.println(Arrays.toString(twoSum(new int[]{2, 7, 11, 15}, 9))); // [0, 1]
		System.out.println(threeSum(new int[]{-1, 0, 1, 2, -1, -4}));
	}
}
```

#### Python

```python
from typing import List


def two_sum(arr: List[int], target: int) -> List[int]:
    # O(n) using a {value -> index} dict.
    # TODO
    return []


def three_sum(arr: List[int]) -> List[List[int]]:
    # O(n^2): sort, fix a, two-pointer for the remaining pair. Skip dups.
    # TODO
    return []


if __name__ == "__main__":
    print(two_sum([2, 7, 11, 15], 9))             # [0, 1]
    print(three_sum([-1, 0, 1, 2, -1, -4]))       # [[-1, -1, 2], [-1, 0, 1]]
```

---

## Benchmark Task

### Objective

Take your **linked-list-from-scratch** from Task 5 and compare it against the language's built-in dynamic list across four operations:

| Operation     | Description                                |
|---------------|--------------------------------------------|
| `append`      | Add to the end                             |
| `prepend`     | Add to the front                           |
| `get`         | Access the element at a given index        |
| `contains`    | Check whether a value exists in the list   |

Run each operation for `n = 10`, `100`, `1_000`, `10_000`, `100_000`. Use `time.Now()` in Go, `System.nanoTime()` in Java, and `timeit.timeit` in Python. Average the measurement over multiple runs so the numbers are not lost in jitter. Record results in the table at the bottom of this section.

**Why this benchmark matters.** Most "intuitive" mental models of linked lists are wrong: they look like they should be fast for prepend, but cache misses and pointer overhead usually make them slower than a dynamic array even for that. Measuring this once builds permanent intuition.

### Starter Code

#### Go

```go
package main

import (
	"fmt"
	"time"
)

// LLNode is the hand-rolled singly linked list node.
type LLNode struct {
	Val  int
	Next *LLNode
}

// LinkedList wraps head + tail + count.
type LinkedList struct {
	head, tail *LLNode
	count      int
}

func (l *LinkedList) Append(v int) {
	// TODO: O(1) with tail pointer
}

func (l *LinkedList) Prepend(v int) {
	// TODO: O(1)
}

func (l *LinkedList) Get(i int) int {
	// TODO: O(n) walk from head
	return 0
}

func (l *LinkedList) Contains(v int) bool {
	// TODO: O(n) walk from head
	return false
}

func benchAppend(n int) (slice, linked time.Duration) {
	// Built-in slice
	start := time.Now()
	s := make([]int, 0, 0) // intentionally no capacity hint, to be fair
	for i := 0; i < n; i++ {
		s = append(s, i)
	}
	slice = time.Since(start)

	// Linked list
	start = time.Now()
	ll := &LinkedList{}
	for i := 0; i < n; i++ {
		ll.Append(i)
	}
	linked = time.Since(start)
	return
}

func benchPrepend(n int) (slice, linked time.Duration) {
	start := time.Now()
	s := []int{}
	for i := 0; i < n; i++ {
		s = append([]int{i}, s...) // O(n) per op — that's the point
	}
	slice = time.Since(start)

	start = time.Now()
	ll := &LinkedList{}
	for i := 0; i < n; i++ {
		ll.Prepend(i)
	}
	linked = time.Since(start)
	return
}

func benchGet(n int) (slice, linked time.Duration) {
	s := make([]int, n)
	ll := &LinkedList{}
	for i := 0; i < n; i++ {
		s[i] = i
		ll.Append(i)
	}
	start := time.Now()
	for i := 0; i < n; i++ {
		_ = s[i]
	}
	slice = time.Since(start)

	start = time.Now()
	for i := 0; i < n; i++ {
		_ = ll.Get(i)
	}
	linked = time.Since(start)
	return
}

func benchContains(n int) (slice, linked time.Duration) {
	s := make([]int, n)
	ll := &LinkedList{}
	for i := 0; i < n; i++ {
		s[i] = i
		ll.Append(i)
	}
	target := n - 1
	start := time.Now()
	for _, v := range s {
		if v == target {
			break
		}
	}
	slice = time.Since(start)

	start = time.Now()
	_ = ll.Contains(target)
	linked = time.Since(start)
	return
}

func main() {
	sizes := []int{10, 100, 1_000, 10_000, 100_000}
	fmt.Printf("%-8s | %-10s | %-12s | %-12s | %-12s | %-12s\n",
		"n", "op", "slice", "linked", "slice/op", "linked/op")
	for _, n := range sizes {
		for _, op := range []struct {
			name string
			fn   func(int) (time.Duration, time.Duration)
		}{
			{"append", benchAppend},
			{"prepend", benchPrepend},
			{"get", benchGet},
			{"contains", benchContains},
		} {
			s, l := op.fn(n)
			fmt.Printf("%-8d | %-10s | %-12v | %-12v | %-12v | %-12v\n",
				n, op.name, s, l, s/time.Duration(n), l/time.Duration(n))
		}
	}
}
```

#### Java

```java
import java.util.*;

public class Bench {
	// Hand-rolled linked list (no java.util.LinkedList).
	static class LLNode {
		int val;
		LLNode next;
		LLNode(int val) { this.val = val; }
	}

	static class LinkedListLite {
		LLNode head, tail;
		int count;

		void append(int v) {
			// TODO: O(1)
		}

		void prepend(int v) {
			// TODO: O(1)
		}

		int get(int i) {
			// TODO: O(n)
			return 0;
		}

		boolean contains(int v) {
			// TODO: O(n)
			return false;
		}
	}

	static long benchAppendList(int n) {
		long start = System.nanoTime();
		ArrayList<Integer> a = new ArrayList<>();
		for (int i = 0; i < n; i++) a.add(i);
		return System.nanoTime() - start;
	}

	static long benchAppendLL(int n) {
		long start = System.nanoTime();
		LinkedListLite l = new LinkedListLite();
		for (int i = 0; i < n; i++) l.append(i);
		return System.nanoTime() - start;
	}

	static long benchPrependList(int n) {
		long start = System.nanoTime();
		ArrayList<Integer> a = new ArrayList<>();
		for (int i = 0; i < n; i++) a.add(0, i); // O(n)
		return System.nanoTime() - start;
	}

	static long benchPrependLL(int n) {
		long start = System.nanoTime();
		LinkedListLite l = new LinkedListLite();
		for (int i = 0; i < n; i++) l.prepend(i);
		return System.nanoTime() - start;
	}

	static long benchGetList(int n) {
		ArrayList<Integer> a = new ArrayList<>();
		for (int i = 0; i < n; i++) a.add(i);
		long start = System.nanoTime();
		for (int i = 0; i < n; i++) a.get(i);
		return System.nanoTime() - start;
	}

	static long benchGetLL(int n) {
		LinkedListLite l = new LinkedListLite();
		for (int i = 0; i < n; i++) l.append(i);
		long start = System.nanoTime();
		for (int i = 0; i < n; i++) l.get(i);
		return System.nanoTime() - start;
	}

	static long benchContainsList(int n) {
		ArrayList<Integer> a = new ArrayList<>();
		for (int i = 0; i < n; i++) a.add(i);
		long start = System.nanoTime();
		a.contains(n - 1);
		return System.nanoTime() - start;
	}

	static long benchContainsLL(int n) {
		LinkedListLite l = new LinkedListLite();
		for (int i = 0; i < n; i++) l.append(i);
		long start = System.nanoTime();
		l.contains(n - 1);
		return System.nanoTime() - start;
	}

	public static void main(String[] args) {
		int[] sizes = {10, 100, 1_000, 10_000, 100_000};
		System.out.printf("%-8s | %-10s | %-15s | %-15s%n", "n", "op", "list (ns)", "linked (ns)");
		for (int n : sizes) {
			System.out.printf("%-8d | %-10s | %-15d | %-15d%n", n, "append",   benchAppendList(n),   benchAppendLL(n));
			System.out.printf("%-8d | %-10s | %-15d | %-15d%n", n, "prepend",  benchPrependList(n),  benchPrependLL(n));
			System.out.printf("%-8d | %-10s | %-15d | %-15d%n", n, "get",      benchGetList(n),      benchGetLL(n));
			System.out.printf("%-8d | %-10s | %-15d | %-15d%n", n, "contains", benchContainsList(n), benchContainsLL(n));
		}
	}
}
```

#### Python

```python
import timeit
from typing import Optional


class LLNode:
    __slots__ = ("val", "next")

    def __init__(self, val: int) -> None:
        self.val = val
        self.next: Optional["LLNode"] = None


class LinkedListLite:
    def __init__(self) -> None:
        self.head: Optional[LLNode] = None
        self.tail: Optional[LLNode] = None
        self.count = 0

    def append(self, v: int) -> None:
        # TODO: O(1) with tail pointer
        pass

    def prepend(self, v: int) -> None:
        # TODO: O(1)
        pass

    def get(self, i: int) -> int:
        # TODO: O(n)
        return 0

    def contains(self, v: int) -> bool:
        # TODO: O(n)
        return False


def bench_append(n: int):
    list_time = timeit.timeit(
        stmt="a=[];\nfor i in range(n): a.append(i)",
        globals={"n": n}, number=1,
    )
    ll_time = timeit.timeit(
        stmt="ll=LinkedListLite();\nfor i in range(n): ll.append(i)",
        globals={"n": n, "LinkedListLite": LinkedListLite}, number=1,
    )
    return list_time, ll_time


def bench_prepend(n: int):
    list_time = timeit.timeit(
        stmt="a=[];\nfor i in range(n): a.insert(0, i)",
        globals={"n": n}, number=1,
    )
    ll_time = timeit.timeit(
        stmt="ll=LinkedListLite();\nfor i in range(n): ll.prepend(i)",
        globals={"n": n, "LinkedListLite": LinkedListLite}, number=1,
    )
    return list_time, ll_time


def bench_get(n: int):
    a = list(range(n))
    ll = LinkedListLite()
    for i in range(n):
        ll.append(i)
    list_time = timeit.timeit(
        stmt="for i in range(n): a[i]",
        globals={"n": n, "a": a}, number=1,
    )
    ll_time = timeit.timeit(
        stmt="for i in range(n): ll.get(i)",
        globals={"n": n, "ll": ll}, number=1,
    )
    return list_time, ll_time


def bench_contains(n: int):
    a = list(range(n))
    ll = LinkedListLite()
    for i in range(n):
        ll.append(i)
    target = n - 1
    list_time = timeit.timeit(
        stmt="target in a",
        globals={"a": a, "target": target}, number=1,
    )
    ll_time = timeit.timeit(
        stmt="ll.contains(target)",
        globals={"ll": ll, "target": target}, number=1,
    )
    return list_time, ll_time


if __name__ == "__main__":
    sizes = [10, 100, 1_000, 10_000, 100_000]
    print(f"{'n':<8} | {'op':<10} | {'list (s)':<14} | {'linked (s)':<14}")
    for n in sizes:
        for name, fn in [("append", bench_append), ("prepend", bench_prepend),
                         ("get", bench_get), ("contains", bench_contains)]:
            t_list, t_ll = fn(n)
            print(f"{n:<8} | {name:<10} | {t_list:<14.6f} | {t_ll:<14.6f}")
```

### Results Table

Fill in these tables as you run the benchmarks on your machine. Keep a separate table per operation so you can spot the scaling behavior at a glance.

#### append (built-in list vs hand-rolled linked list)

| n       | list   | linked | linked / list |
|---------|--------|--------|---------------|
| 10      |        |        |               |
| 100     |        |        |               |
| 1 000   |        |        |               |
| 10 000  |        |        |               |
| 100 000 |        |        |               |

#### prepend (built-in list vs hand-rolled linked list)

| n       | list   | linked | linked / list |
|---------|--------|--------|---------------|
| 10      |        |        |               |
| 100     |        |        |               |
| 1 000   |        |        |               |
| 10 000  |        |        |               |
| 100 000 |        |        |               |

#### get-by-index (built-in list vs hand-rolled linked list)

| n       | list   | linked | linked / list |
|---------|--------|--------|---------------|
| 10      |        |        |               |
| 100     |        |        |               |
| 1 000   |        |        |               |
| 10 000  |        |        |               |
| 100 000 |        |        |               |

#### contains (built-in list vs hand-rolled linked list)

| n       | list   | linked | linked / list |
|---------|--------|--------|---------------|
| 10      |        |        |               |
| 100     |        |        |               |
| 1 000   |        |        |               |
| 10 000  |        |        |               |
| 100 000 |        |        |               |

### Questions to Answer After Running the Benchmark

1. For `append`, both data structures are `O(1)` per op. Which one is actually faster, and by how much? Why?
2. For `prepend`, the asymptotic story flips: the array is `O(n)` and the linked list is `O(1)`. At what value of `n` does the linked list become faster on your machine?
3. For `get`, the linked list is `O(n)` per access. The benchmark performs `n` accesses, so the total cost is `O(n^2)`. Does the measured ratio match that prediction?
4. For `contains`, both are `O(n)`. Which one wins, and why? (Hint: cache locality.)
5. After staring at the numbers, write down one sentence on when you would actually pick a linked list in production code.

---

> **Note.** Practice tasks live on a budget. If you find yourself spending more than 90 minutes on a single beginner or intermediate task, you are missing a smaller skill — drop down a level, learn the missing piece, then come back. The advanced tasks are deliberately harder; expect to spend a full hour on each, and do not feel bad about reading a reference implementation after you have made an honest attempt.
