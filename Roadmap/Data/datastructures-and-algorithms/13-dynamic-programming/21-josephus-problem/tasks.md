# The Josephus Problem — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the Josephus logic and validate against the evaluation criteria.
> **Always test against a brute-force list-simulation oracle on small inputs before trusting the recurrence, the closed form, or the Fenwick order.**

---

## Beginner Tasks (5)

### Task 1 — Survivor by the O(n) recurrence

**Problem.** Implement `josephus(n, k)` returning the **1-indexed** surviving seat for `n` people, step `k`, using the recurrence `J(1) = 0`, `J(n) = (J(n-1) + k) mod n`. Add `1` at the end.

**Input / Output spec.**
- Read `n` and `k`.
- Print the single 1-indexed survivor seat.

**Constraints.**
- `1 ≤ n ≤ 10^7`, `1 ≤ k ≤ 10^9`.
- Use 64-bit and reduce `k mod m` per step to avoid overflow.

**Hint.** Loop `m` from `2` to `n`; `res = (res + k % m) % m`. Return `res + 1`.

**Starter — Go.**
```go
package main

import "fmt"

func josephus(n, k int) int {
	// TODO: recurrence, return 1-indexed survivor
	return 0
}

func main() {
	var n, k int
	fmt.Scan(&n, &k)
	fmt.Println(josephus(n, k))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static int josephus(int n, int k) {
        // TODO
        return 0;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt(), k = sc.nextInt();
        System.out.println(josephus(n, k));
    }
}
```

**Starter — Python.**
```python
import sys


def josephus(n, k):
    # TODO
    return 0


def main():
    data = sys.stdin.read().split()
    n, k = int(data[0]), int(data[1])
    print(josephus(n, k))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- `n = 5, k = 2 → 3`; `n = 7, k = 3 → 4`; `n = 1, k = 5 → 1`.
- Matches a brute-force list simulation for all `n ≤ 50`, `k ≤ 12`.
- `O(n)` time, `O(1)` space.

---

### Task 2 — k = 2 closed form (bit rotation)

**Problem.** Implement `josephus2(n)` returning the **1-indexed** survivor for step `k = 2` in `O(1)` using `2·(n − 2^⌊log₂ n⌋) + 1`.

**Input / Output spec.**
- Read `n`. Print the survivor seat.

**Constraints.** `1 ≤ n ≤ 10^18`.

**Hint.** Use the highest-set-bit intrinsic: `bits.Len64`, `Long.highestOneBit`, `int.bit_length`.

**Starter — Python.**
```python
def josephus2(n):
    # TODO: L = largest power of two <= n; return 2*(n-L)+1
    return 0


if __name__ == "__main__":
    print(josephus2(41))  # 19
```

**Worked check.** `n = 41 = 101001₂`; rotate the leading `1` to the end → `010011₂ = 19`. Power-of-two `n` (8, 16, 32) → seat `1`.

**Evaluation criteria.**
- `n = 41 → 19`, `n = 8 → 1`, `n = 1 → 1`.
- The survivor is always **odd** (assert it).
- Matches the `O(n)` recurrence with `k = 2` for all `n ≤ 1000`.

---

### Task 3 — Full elimination order by simulation

**Problem.** Return the full elimination order (1-indexed labels, in removal order) for `n` people, step `k`, by direct list simulation. The last element is the survivor.

**Input / Output spec.**
- Read `n`, `k`. Print the order space-separated.

**Constraints.** `1 ≤ n ≤ 5000`, `1 ≤ k ≤ 10^6`.

**Hint.** Keep a list `[1..n]` and an index `idx = 0`. Each round: `idx = (idx + k - 1) % len(people)`, then remove `people[idx]` and append it to the order.

**Reference oracle (Python) — use this to validate.**
```python
def order_oracle(n, k):
    people = list(range(1, n + 1))
    idx = 0
    order = []
    while people:
        idx = (idx + k - 1) % len(people)
        order.append(people.pop(idx))
    return order
```

**Evaluation criteria.**
- `n = 5, k = 2 → [2, 4, 1, 5, 3]`.
- The last element equals `josephus(n, k)` from Task 1.
- Matches the oracle for all small `n, k`.

---

### Task 4 — Position to survive

**Problem.** Given `n` and `k`, print the seat you should stand in to survive (1-indexed). This is exactly `J(n, k) + 1`.

**Input / Output spec.**
- Read `n`, `k`. Print the safe seat.

**Constraints.** `1 ≤ n ≤ 10^7`, `1 ≤ k ≤ 10^9`.

**Hint.** Reuse the Task 1 recurrence; the "position to survive" *is* the survivor seat.

**Evaluation criteria.**
- Standing at the printed seat in a simulation survives every time.
- Matches Task 1 output (they are the same query).
- Handles `k = 1` (safe seat is `n`) and `n = 1` (safe seat is `1`).

---

### Task 5 — k = 1 special case

**Problem.** For `k = 1`, prove by code that the survivor is always person `n`. Implement `survivor_k1(n)` returning `n`, and verify it against both the recurrence and a simulation.

**Input / Output spec.**
- Read `n`. Print the survivor (should be `n`).

**Constraints.** `1 ≤ n ≤ 10^9`.

**Hint.** With `k = 1`, people are eliminated in order `1, 2, …, n−1`. The recurrence gives `J(n, 1) = n − 1` (0-indexed), seat `n`.

**Evaluation criteria.**
- Returns `n` for all `n`.
- Matches `josephus(n, 1)` from Task 1 (which must equal `n`).
- Matches a list simulation with `k = 1` for `n ≤ 50`.

---

## Intermediate Tasks (5)

### Task 6 — Huge n, small k survivor (O(k log n))

**Problem.** Return the 0-indexed survivor for huge `n` (up to `10^18`) and small `k`, in `O(k log n)`, by batching the non-wrapping steps of the recurrence.

**Constraints.** `1 ≤ n ≤ 10^18`, `2 ≤ k ≤ 10^4`.

**Hint.** While `res + k < m`, skip `cnt = (m − res − 1) / k` sizes at once: `res += cnt·k`, `m += cnt` (capped so `m + cnt ≤ n`). Otherwise `res = (res + k) % m`, `m++`.

**Reference oracle (Python).**
```python
def survivor_oracle(n, k):
    res = 0
    for m in range(2, n + 1):
        res = (res + k) % m
    return res
```

**Starter — Go.**
```go
package main

import "fmt"

func josephusFast(n, k int64) int64 {
	if k == 1 {
		return n - 1
	}
	// TODO: batch non-wrapping steps; cap cnt so m+cnt <= n
	return 0
}

func main() {
	var n, k int64
	fmt.Scan(&n, &k)
	fmt.Println(josephusFast(n, k))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task6 {
    static long josephusFast(long n, long k) {
        if (k == 1) return n - 1;
        // TODO
        return 0;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        long n = sc.nextLong(), k = sc.nextLong();
        System.out.println(josephusFast(n, k));
    }
}
```

**Evaluation criteria.**
- Matches `survivor_oracle` for all `n ≤ 5000`, `k ≤ 50`.
- Completes instantly for `n = 10^18`, `k = 7`.
- Correctly caps `cnt` so `m` never exceeds `n` (no infinite loop, no overshoot).

---

### Task 7 — The m-th person eliminated

**Problem.** Given `n`, `k`, and `m` (`1 ≤ m ≤ n`), return the 1-indexed label of the `m`-th person eliminated. Use a Fenwick tree so each removal is `O(log n)`.

**Constraints.** `1 ≤ n ≤ 10^6`, `1 ≤ k ≤ 10^9`, `1 ≤ m ≤ n`.

**Hint.** Run the Fenwick select-and-delete `m` times; return the `m`-th label found. `m = n` gives the survivor.

**Reference oracle (Python).**
```python
def mth_eliminated_oracle(n, k, m):
    people = list(range(1, n + 1))
    idx = 0
    for _ in range(m):
        idx = (idx + k - 1) % len(people)
        victim = people.pop(idx)
    return victim
```

**Evaluation criteria.**
- `n = 5, k = 2, m = 1 → 2`; `m = 5 → 3` (the survivor).
- Matches the oracle for all small `n, k, m`.
- `O(m log n)`; `m = n` agrees with the Task 1 survivor.

---

### Task 8 — Variable step per round

**Problem.** Given `n` and a list of steps `k_2, k_3, …, k_n` (the step used when the circle shrinks from size `m` to `m−1`), return the 1-indexed survivor. Use `J(n) = (J(n-1) + k_n) mod n`.

**Constraints.** `1 ≤ n ≤ 10^6`, each `k_m` in `[1, 10^9]`.

**Hint.** Same loop as Task 1, but read the step from the array for each `m`. There is no closed form.

**Reference oracle (Python).**
```python
def variable_step_oracle(n, steps):  # steps[m] used at size m+2
    people = list(range(1, n + 1))
    idx = 0
    size = n
    while len(people) > 1:
        k = steps[len(people) - 2]  # step for current size
        idx = (idx + k - 1) % len(people)
        people.pop(idx)
    return people[0]
```

**Evaluation criteria.**
- Constant-step input reproduces Task 1.
- Matches the variable-step simulation oracle for small `n`.
- `O(n)` time.

---

### Task 9 — Choose-your-seat search

**Problem.** Given `n` and a desired survivor seat `s`, find the smallest step `k` in `[1, K_max]` such that `J(n, k) + 1 = s`. Return `-1` if none exists in range.

**Constraints.** `1 ≤ n ≤ 10^4`, `1 ≤ s ≤ n`, `1 ≤ K_max ≤ 10^4`.

**Hint.** For each candidate `k` from `1` to `K_max`, evaluate `josephus(n, k)` (Task 1) and check if `+1 == s`. Return the first match.

**Evaluation criteria.**
- Returns a `k` whose survivor seat is exactly `s` (verify by re-running the recurrence).
- Returns `-1` when no `k ≤ K_max` works.
- Handles `s = n` (e.g. `k = 1` always works).

---

### Task 10 — Survivor with a non-zero start position

**Problem.** Given `n`, `k`, and a starting seat `start` (1-indexed, where the first count begins), return the 1-indexed survivor. The canonical recurrence assumes `start = 1`.

**Constraints.** `1 ≤ n ≤ 10^7`, `1 ≤ k ≤ 10^9`, `1 ≤ start ≤ n`.

**Hint.** Solve the canonical problem (`start = 1`) to get `J(n, k)` (0-indexed), then rotate: the seat is `((J(n, k) + (start − 1)) mod n) + 1`.

**Reference oracle (Python).**
```python
def start_oracle(n, k, start):
    people = list(range(1, n + 1))
    idx = start - 1
    while len(people) > 1:
        idx = (idx + k - 1) % len(people)
        people.pop(idx)
        if idx == len(people):  # wrap pointer after pop at the end
            idx = 0
    return people[0]
```

**Evaluation criteria.**
- `start = 1` reproduces Task 1.
- Matches the start-aware simulation oracle for small `n, k, start`.
- The rotation is applied exactly once.

---

## Advanced Tasks (5)

### Task 11 — Two independent verifications of the k = 2 form

**Problem.** Implement the `k = 2` survivor two independent ways — (a) the arithmetic closed form `2(n − 2^⌊log₂ n⌋) + 1`, and (b) the bit-rotation of `n`'s binary string — and assert they agree for all `n` in `[1, N]`.

**Constraints.** `1 ≤ N ≤ 10^6`.

**Hint.** For the rotation: take `n`'s bit string (leading bit is `1`), move the leading `1` to the rightmost position, parse back to an integer.

**Starter — Python.**
```python
def closed_form(n):
    L = 1 << (n.bit_length() - 1)
    return 2 * (n - L) + 1


def bit_rotation(n):
    b = bin(n)[2:]          # binary string, leading '1'
    rotated = b[1:] + b[0]  # move leading bit to the end
    return int(rotated, 2)


if __name__ == "__main__":
    for n in range(1, 1_000_000):
        assert closed_form(n) == bit_rotation(n), n
    print("closed form and bit rotation agree")
```

**Evaluation criteria.**
- The two methods agree for every `n ≤ N`.
- Both agree with the `O(n)` recurrence (`k = 2`) for `n ≤ 1000`.
- Both produce odd results and preserve `n`'s popcount.

---

### Task 12 — Fenwick elimination order at scale

**Problem.** Produce the full elimination order for `n` up to `10^6` in `O(n log n)` using a Fenwick tree with an `O(log n)` select-walk (no array-middle removal).

**Constraints.** `1 ≤ n ≤ 10^6`, `1 ≤ k ≤ 10^9`.

**Hint.** Fenwick stores `1` for alive. Maintain `alive` and a 0-indexed living pointer `cur`; victim living-rank is `(cur + k − 1) mod alive`; find its slot with the Fenwick walk; `update(idx, −1)`.

**Evaluation criteria.**
- Matches the list-simulation order (Task 3) for all small `n, k`.
- Runs in `O(n log n)`; completes for `n = 10^6` in well under a second (Go/Java).
- The pointer-to-rank arithmetic is tested entrywise against the simulation.

---

### Task 13 — Last r survivors

**Problem.** Given `n`, `k`, and `r` (`1 ≤ r ≤ n`), return the set of `r` people remaining when the process stops with `r` survivors (in seat order). Use the Fenwick order and take the last `r` eliminated... wait — the survivors are the people **never** eliminated, i.e. the labels not in the first `n − r` removals.

**Constraints.** `1 ≤ n ≤ 10^6`, `1 ≤ k ≤ 10^9`, `1 ≤ r ≤ n`.

**Hint.** Run the Fenwick elimination for `n − r` removals; the remaining living slots are the `r` survivors. Read them by scanning which slots are still `1`.

**Reference oracle (Python).**
```python
def last_r_oracle(n, k, r):
    people = list(range(1, n + 1))
    idx = 0
    while len(people) > r:
        idx = (idx + k - 1) % len(people)
        people.pop(idx)
        if idx == len(people):
            idx = 0
    return sorted(people)
```

**Evaluation criteria.**
- `r = 1` reproduces the single survivor (Task 1).
- Matches the oracle for small `n, k, r`.
- Stops after exactly `n − r` removals.

---

### Task 14 — Inverse k = 2 query

**Problem.** Given an **odd** survivor seat `s` produced by the `k = 2` process, recover the smallest `n` whose `k = 2` survivor is `s`. (The `k = 2` survivor is always odd, and the map is the bit rotation.)

**Constraints.** `1 ≤ s ≤ 10^18`, `s` odd.

**Hint.** The forward map is "rotate the leading `1` of `n` to the end". The inverse is "rotate the trailing `1` of `s` to the front": take `s`'s `b`-bit string ending in `1`, move that last `1` to the most-significant position. Verify with the forward closed form.

**Evaluation criteria.**
- For `s = 19`, recovers `n = 41` (and `josephus2(41) == 19`).
- Rejects or flags even `s` (impossible for `k = 2`).
- `forward(inverse(s)) == s` for all odd `s` in a test range.

---

### Task 15 — Decide the right Josephus method

**Problem.** Given constraints `(n, k, query_type)`, implement `classify(n, k, query_type)` returning one of: `CLOSED_FORM` (`k = 2`, survivor), `BATCHED` (small `k`, huge `n`, survivor), `RECURRENCE` (moderate `n`, survivor), `FENWICK_ORDER` (full order or `m`-th eliminated), or `INFEASIBLE` (general large `k` with huge `n`, survivor). Justify each.

**Constraints / cases to handle.**
- `k = 2`, survivor → `CLOSED_FORM`.
- `k ≤ 10^4`, `n > 10^7`, survivor → `BATCHED`.
- `n ≤ 10^7`, survivor, any `k` → `RECURRENCE`.
- query is order or `m`-th eliminated → `FENWICK_ORDER`.
- `k > 10^4`, `n > 10^9`, survivor → `INFEASIBLE`.

**Hint.** Encode the decision rules from `middle.md` and `senior.md`. The `INFEASIBLE` branch must explicitly note that general large-`k`, huge-`n` survivor has no known sublinear algorithm.

**Evaluation criteria.**
- Correctly classifies all five canonical cases.
- Cites the right complexity for each (`O(1)`, `O(k log n)`, `O(n)`, `O(n log n)`).
- The `INFEASIBLE` branch explains the missing sublinear method.

---

## Benchmark Task

### Task B — Recurrence vs simulation vs Fenwick crossover

**Problem.** Empirically compare three approaches for the *survivor* query and one for the *order* query on a fixed `n`:

- **(a) List simulation, survivor:** `O(n·k)`.
- **(b) `O(n)` recurrence, survivor:** `O(n)`.
- **(c) `O(k log n)` batched, survivor:** for small `k`.
- **(d) Fenwick order:** `O(n log n)` for the full elimination order.

Measure wall-clock time for `n ∈ {10³, 10⁴, 10⁵, 10⁶}` with `k = 5`, and report which method wins at each size. Use a fixed input so all three languages match.

**Starter — Python.**
```python
import time


def list_sim_survivor(n, k):
    # TODO: O(n*k) list simulation, return survivor
    return 0


def recurrence_survivor(n, k):
    res = 0
    for m in range(2, n + 1):
        res = (res + k) % m
    return res


def batched_survivor(n, k):
    # TODO: O(k log n) batched recurrence
    return 0


def bench(fn, *args):
    start = time.perf_counter()
    fn(*args)
    return (time.perf_counter() - start) * 1000.0


def main():
    k = 5
    print("n         list_ms     recur_ms    batched_ms")
    for n in [1000, 10000, 100000, 1000000]:
        ls = bench(list_sim_survivor, n, k) if n <= 100000 else float("nan")
        rc = bench(recurrence_survivor, n, k)
        bt = bench(batched_survivor, n, k)
        print(f"{n:<9d} {ls:<11.2f} {rc:<11.2f} {bt:<11.2f}")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same input produces the same survivor across Go, Java, and Python.
- List simulation (a) is far slower than the recurrence (b) as `n` grows; the batched method (c) is fastest for survivor-only at large `n`.
- The Fenwick order (d) is `O(n log n)` and the only feasible way to get the full order at `n = 10⁶`.
- Report mean over at least 3 runs; do not time input generation.
- Writeup: note the measured crossover and confirm the `O(n·k)` simulation becomes impractical well before the recurrence does.

---

## General Guidance for All Tasks

- **Always validate against the brute-force simulation oracle first.** Every survivor/order task ships with (or references) a slow list-simulation oracle. Run it on small `n` and a spread of `k`, diff entrywise, and only then trust the fast version on large inputs.
- **Pin the index convention as a named decision.** The recurrence is 0-indexed; humans want 1-indexed; convert with a single explicit `+1`. Decide once and document it.
- **Get the base case right.** `J(1) = 0` for the recurrence; the loop runs `m` from `2` to `n`. Do not initialize `res = 1`.
- **Mind overflow.** In Go/Java use 64-bit and reduce `res = (res + k % m) % m`; cap `cnt` in the batched method so `m + cnt ≤ n`. Python big ints avoid the issue.
- **Use the right tool for the scale.** `k = 2` → closed form (`O(1)`); small `k`, huge `n` → batched (`O(k log n)`); moderate `n` → recurrence (`O(n)`); order → Fenwick (`O(n log n)`).
- **The `k = 2` survivor is always odd** and shares `n`'s popcount — cheap invariants to assert.
- **Separate survivor from order** in your API; they are different outputs with different costs.

Each task must be implemented and tested in **Go, Java, and Python**, with identical outputs across all three on the same inputs.
