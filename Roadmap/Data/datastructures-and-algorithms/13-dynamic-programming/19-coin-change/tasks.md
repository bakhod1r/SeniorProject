# Coin Change (Unbounded Counting DP) — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the coin-change DP logic and validate against the evaluation criteria.
> **Always test against a brute-force recursive oracle on small inputs before trusting the DP result. Decide combinations vs permutations BEFORE writing the loops.**

---

## Beginner Tasks (5)

### Task 1 — Minimum coins to make an amount

**Problem.** Given coins (unbounded supply) and an amount, return the fewest coins summing to exactly the amount, or `-1` if impossible.

**Input / Output spec.**
- Read `n` (number of coins), `amount`, then the `n` coin values.
- Print a single integer: the fewest coins, or `-1`.

**Constraints.**
- `1 ≤ n ≤ 100`, `0 ≤ amount ≤ 10^4`, `1 ≤ coin ≤ 10^4`.
- Use `INF = amount + 1` (or `1<<30`), never `MAX_INT`.

**Hint.** `dp[0]=0`, rest `INF`; `dp[v]=min(dp[v],dp[v-c]+1)`. Map `dp[amount] >= INF` to `-1`.

**Starter — Go.**
```go
package main

import "fmt"

func minCoins(coins []int, amount int) int {
	// TODO: dp[0]=0, rest INF; coin loop, dp[v]=min(dp[v],dp[v-c]+1)
	return -1
}

func main() {
	var n, amount int
	fmt.Scan(&n, &amount)
	coins := make([]int, n)
	for i := range coins {
		fmt.Scan(&coins[i])
	}
	fmt.Println(minCoins(coins, amount))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static int minCoins(int[] coins, int amount) {
        // TODO
        return -1;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt(), amount = sc.nextInt();
        int[] coins = new int[n];
        for (int i = 0; i < n; i++) coins[i] = sc.nextInt();
        System.out.println(minCoins(coins, amount));
    }
}
```

**Starter — Python.**
```python
import sys


def min_coins(coins, amount):
    # TODO
    return -1


def main():
    data = iter(sys.stdin.read().split())
    n, amount = int(next(data)), int(next(data))
    coins = [int(next(data)) for _ in range(n)]
    print(min_coins(coins, amount))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- `amount = 0` returns `0`.
- Impossible amounts return `-1` (not a huge number).
- Matches a brute-force recursion for small amounts.

---

### Task 2 — Count combinations to make an amount

**Problem.** Count the number of coin **combinations** (multisets; order irrelevant) making the amount, modulo `10^9 + 7`. Use the coin-outer loop.

**Input / Output spec.**
- Read `n`, `amount`, then `n` coins. Print the count mod `10^9+7`.

**Constraints.** `1 ≤ n ≤ 100`, `0 ≤ amount ≤ 5000`.

**Hint.** `dp[0]=1`; for each coin (outer), for `v=c..amount`: `dp[v]+=dp[v-c]`.

**Reference oracle (Python) — use this to validate.**
```python
def brute_combinations(coins, amount):
    coins = sorted(set(coins))
    def rec(i, rem):
        if rem == 0:
            return 1
        if i == len(coins) or rem < 0:
            return 0
        # use coin i zero+ times, or skip to next coin (canonical order)
        return rec(i + 1, rem) + rec(i, rem - coins[i])
    return rec(0, amount)
```

**Starter — Go.**
```go
func countCombinations(coins []int, amount int) int64 {
	const MOD = 1_000_000_007
	dp := make([]int64, amount+1)
	dp[0] = 1
	// TODO: coin-outer, forward sweep, dp[v] = (dp[v]+dp[v-c]) % MOD
	return dp[amount]
}
```

**Starter — Java.**
```java
static long countCombinations(int[] coins, int amount) {
    final long MOD = 1_000_000_007L;
    long[] dp = new long[amount + 1];
    dp[0] = 1;
    // TODO: coin-outer, forward sweep
    return dp[amount];
}
```

**Starter — Python.**
```python
def count_combinations(coins, amount):
    MOD = 1_000_000_007
    dp = [0] * (amount + 1)
    dp[0] = 1
    # TODO: coin-outer, forward sweep
    return dp[amount]
```

**Evaluation criteria.**
- `coins=[1,2,5], amount=5` returns `4`.
- `amount = 0` returns `1`.
- Matches `brute_combinations` for small amounts.

---

### Task 3 — Count permutations to make an amount

**Problem.** Count the number of ordered coin **sequences** (permutations; `1+2 != 2+1`) making the amount, modulo `10^9 + 7`. Use the amount-outer loop.

**Input / Output spec.**
- Read `n`, `amount`, then `n` coins. Print the count mod `10^9+7`.

**Constraints.** `1 ≤ n ≤ 100`, `0 ≤ amount ≤ 5000`.

**Hint.** `dp[0]=1`; for `v=1..amount` (outer), for each coin `c<=v` (inner): `dp[v]+=dp[v-c]`.

**Worked check.** For `coins=[1,2], amount=3`: permutations = `3` (`1+1+1`, `1+2`, `2+1`), combinations = `2`. The permutation count must always be `>=` the combination count.

**Starter — Python.**
```python
def count_permutations(coins, amount):
    MOD = 1_000_000_007
    dp = [0] * (amount + 1)
    dp[0] = 1
    for v in range(1, amount + 1):       # amount-outer => permutations
        for c in coins:
            if c <= v:
                dp[v] = (dp[v] + dp[v - c]) % MOD
    return dp[amount]
```

(Implement the Go and Java equivalents by swapping the loop nesting relative to Task 2.)

**Evaluation criteria.**
- `coins=[1,2], amount=3` returns `3`.
- Permutation count `>=` combination count for the same input (assert it).
- Matches a brute-force enumeration for small amounts.

---

### Task 4 — Min coins with reconstruction

**Problem.** Return both the fewest coins and the actual multiset of coins used (any valid optimal multiset). If impossible, return `-1` and an empty list.

**Input / Output spec.**
- Read `n`, `amount`, then `n` coins. Print the count, then the coins used (space-separated), or `-1` on a line by itself.

**Constraints.** `1 ≤ n ≤ 100`, `0 ≤ amount ≤ 10^4`.

**Hint.** Keep `parent[v]` = the coin that produced `dp[v]`. Walk back from `amount`: `c=parent[v]; record c; v-=c` until `v==0`.

**Evaluation criteria.**
- The reported coins sum to the amount and have cardinality equal to the min.
- Impossible amounts report `-1` and no coins.
- Verified against the min-coins count from Task 1.

---

### Task 5 — Detect unreachable amounts

**Problem.** Given coins and a list of query amounts, for each query print `YES` if the amount is reachable (some combination sums to it) and `NO` otherwise. Use a boolean reachability DP.

**Input / Output spec.**
- Read `n`, the `n` coins, `q`, then `q` query amounts (all `≤ maxAmount`). Print `YES`/`NO` per query.

**Constraints.** `1 ≤ n ≤ 100`, amounts `≤ 10^4`, `1 ≤ q ≤ 10^4`.

**Hint.** `reach[0]=true`; for each coin `c`, for `v=c..maxAmount`: `reach[v] = reach[v] OR reach[v-c]`. Precompute once, answer all queries in `O(1)`.

**Worked check.** Coins `{2}`: every odd amount is `NO`; every even amount is `YES`. Coins `{1, ...}`: every amount is `YES`.

**Evaluation criteria.**
- `coins={2}` ⇒ odd amounts `NO`, even `YES`.
- Single DP pass precomputes reachability; queries are `O(1)`.
- Matches the min-coins `!= -1` test from Task 1.

---

## Intermediate Tasks (5)

### Task 6 — Bounded coin change (limited supply), combinations

**Problem.** Each coin `coins[i]` is available at most `counts[i]` times. Count the number of combinations making the amount, modulo `10^9 + 7`. Use binary splitting into 0/1 items and a backward sweep.

**Constraints.** `1 ≤ n ≤ 50`, `1 ≤ counts[i] ≤ 10^4`, `0 ≤ amount ≤ 2000`.

**Hint.** Split each `(coin, count)` into chunks of size `1,2,4,…` (last chunk = remainder); each chunk is a 0/1 item of value `coin*chunk`. Run `dp[v]+=dp[v-w]` with `v` going **down** to `w`.

**Reference oracle (Python).**
```python
def brute_bounded(coins, counts, amount):
    def rec(i, rem):
        if rem == 0:
            return 1
        if i == len(coins) or rem < 0:
            return 0
        total = 0
        for use in range(counts[i] + 1):
            if use * coins[i] > rem:
                break
            total += rec(i + 1, rem - use * coins[i])
        return total
    return rec(0, amount)
```

**Evaluation criteria.**
- `coins=[1,2], counts=[2,1], amount=3` returns `1`.
- Backward sweep (each 0/1 item used at most once).
- Matches `brute_bounded` for small inputs.

---

### Task 7 — Count ways to make amount using exactly m coins

**Problem.** Count combinations making the amount using **exactly** `m` coins, modulo `10^9 + 7`. Add a coin-count dimension.

**Constraints.** `1 ≤ n ≤ 50`, `0 ≤ amount ≤ 2000`, `0 ≤ m ≤ 2000`.

**Hint.** `dp[j][v]` = ways to make `v` with exactly `j` coins. Recurrence (combinations, coin-outer): `dp[j][v] += dp[j-1][v-c]`. Roll the coin dimension; keep the `j`,`v` table.

**Evaluation criteria.**
- `coins=[1,2], amount=4, m=2` returns `1` (`2+2`).
- Matches a brute-force recursion for small inputs.
- `O(amount · m · n)`.

---

### Task 8 — Two-coin closed form vs DP

**Problem.** For exactly two coins `a, b` (coprime), the number of combinations of `V` can be computed in `O(1)`-ish via the floor-sum formula; verify your DP against it. Implement both and assert agreement.

**Constraints.** `1 ≤ a < b ≤ 10^3`, `gcd(a,b)=1`, `0 ≤ V ≤ 10^4`.

**Hint.** The count is the number of non-negative `(x, y)` with `a·x + b·y = V`, i.e. the number of valid `y` in `0..V/b` with `(V - b·y) % a == 0`. For `{1,2}` it equals `⌊V/2⌋+1`. Compare against the coin-outer DP.

**Reference check.**
```python
def two_coin_count(a, b, V):
    cnt = 0
    y = 0
    while b * y <= V:
        if (V - b * y) % a == 0:
            cnt += 1
        y += 1
    return cnt
```

**Evaluation criteria.**
- `two_coin_count(1,2,6) == 4` and equals the DP.
- DP and formula agree across a range of `V`.
- Documents that this is `[x^V]` of `1/((1-x^a)(1-x^b))`.

---

### Task 9 — Canonicity tester

**Problem.** Implement `isCanonical(coins)` that returns the smallest amount where greedy (largest-first) is suboptimal, or `-1` if the system is canonical. Test up to a safe bound derived from the two largest coins.

**Constraints.** `1 ≤ n ≤ 30`, coins contain `1`, `1 ≤ coin ≤ 10^4`.

**Hint.** Bound `= c_{n-1} + c_n` (sorted ascending). Build a min-coins DP up to the bound; compare against greedy at each amount; return the first mismatch.

**Reference cases.**
```text
{1,3,4}      -> 6   (non-canonical)
{1,5,10,25}  -> -1  (canonical)
{1,2,5}      -> -1  (canonical)
{1,7,10}     -> 14  (non-canonical: greedy 10+1+1+1+1=5, optimal 7+7=2)
```

**Evaluation criteria.**
- Correctly classifies the four reference cases above.
- Bounded window check (no infinite loop).
- Greedy and DP both implemented and compared.

---

### Task 10 — Min coins, greedy fast path with DP fallback

**Problem.** Build a function that, given a coin system, first checks canonicity (Task 9). If canonical, answer min-coins queries with greedy (`O(n)`); otherwise fall back to the DP. Answer `q` queries.

**Constraints.** `1 ≤ n ≤ 30`, `1 ≤ q ≤ 10^5`, amounts `≤ 10^4`.

**Hint.** Run the canonicity test once. Cache the verdict. For canonical systems greedy each query in `O(n)`; otherwise precompute the DP table once up to `maxAmount` and answer in `O(1)`.

**Evaluation criteria.**
- Uses greedy only when the system is verified canonical.
- Falls back to DP for non-canonical systems and still returns the true minimum.
- Both paths agree with a brute-force min on small inputs.

---

## Advanced Tasks (5)

### Task 11 — Huge-V count via linear recurrence + matrix exponentiation

**Problem.** For a fixed small coin set, count combinations of an astronomically large `V` (up to `10^18`) modulo `10^9 + 7`. Derive the linear recurrence from the generating-function denominator and evaluate it with matrix exponentiation.

**Constraints.** `coins ⊆ {1..6}`, `0 ≤ V ≤ 10^18`.

**Hint.** `N(V)` satisfies a recurrence whose order ≤ `Σ c_i` (denominator `Π(1-x^{c_i})`). Compute enough initial terms by the ordinary DP, fit/derive the recurrence coefficients, then power the companion matrix. (See `professional.md` Section 11 and `11-graphs/32-paths-fixed-length`.)

**Two-coin sanity.** For `{1,2}`, `N(V) = ⌊V/2⌋+1`; check your matrix result against this closed form for several `V` including very large ones.

**Evaluation criteria.**
- Matches the ordinary DP for `V` up to a few thousand.
- Matches the `{1,2}` closed form for huge `V`.
- `O(d³ log V)` where `d` is the recurrence order.

---

### Task 12 — CRT-combined exact count across two primes

**Problem.** Count combinations of `V` exactly (the true value may exceed `10^9+7`). Run the counting DP under two coprime primes and reconstruct via CRT.

**Constraints.** `1 ≤ n ≤ 30`, `0 ≤ amount ≤ 2000`. Guarantee the true count `< p₁·p₂`.

**Hint.** Run the identical coin-outer DP twice (once per prime), then apply the two-prime CRT formula. The runs are independent and parallelizable.

**Two-prime CRT (Python).**
```python
def crt2(r1, p1, r2, p2):
    inv = pow(p1, -1, p2)
    t = ((r2 - r1) * inv) % p2
    return r1 + p1 * t   # in [0, p1*p2)
```

**Evaluation criteria.**
- Recovers values larger than a single prime for small inputs where the true count is known (compare against Python big-int DP).
- Both modular runs agree with `(true) mod pᵢ`.
- `crt2` output equals the exact count when it fits below `p₁·p₂`.

---

### Task 13 — Count ways with at most k of each coin (bounded counting, GF)

**Problem.** Count combinations of `V` using coin `i` **at most** `k_i` times, modulo `10^9 + 7`, but implement it as a **polynomial product** of the bounded factors `(1 + x^{c_i} + … + x^{k_i c_i})` truncated mod `x^{V+1}` — i.e. the generating-function view, not binary splitting.

**Constraints.** `1 ≤ n ≤ 30`, `1 ≤ k_i ≤ 100`, `0 ≤ V ≤ 3000`.

**Hint.** Maintain a polynomial `poly[0..V]` (start `poly[0]=1`). For each coin, convolve with its bounded factor: `new[v] = Σ_{t=0}^{k_i, t·c_i ≤ v} poly[v - t·c_i]`. Use a sliding-window / prefix trick to make each convolution `O(V)` instead of `O(V·k_i)`.

**Evaluation criteria.**
- Matches the binary-splitting bounded DP (Task 6) and the brute oracle for small inputs.
- The sliding-window convolution is `O(V)` per coin (not `O(V·k_i)`).
- Documents the factor `(1 - x^{(k_i+1)c_i})/(1 - x^{c_i})`.

---

### Task 14 — Frobenius number for two coprime coins

**Problem.** Given two coprime coins `a, b`, output the Frobenius number (largest non-representable amount) and the count of non-representable amounts. Then verify by a reachability DP up to the Frobenius number.

**Constraints.** `1 ≤ a < b ≤ 10^4`, `gcd(a,b)=1`.

**Hint.** Frobenius number `= a·b - a - b`; number of non-representable amounts `= (a-1)(b-1)/2`. Build a reachability DP up to `a·b` and assert exactly that many `false` entries, with the last `false` index equal to the Frobenius number.

**Evaluation criteria.**
- `a=3, b=5` ⇒ Frobenius `7`, non-representable count `4` (`1,2,4,7`).
- The reachability DP confirms both the count and the largest non-representable amount.
- Handles the gcd assumption (reject non-coprime input).

---

### Task 15 — Classify the right tool for a coin-change variant

**Problem.** Implement `classify(problem)` (or a short analysis) that, given `(n, V, objective, order, supply, canonical)`, returns one of: `DP_TABLE`, `GREEDY`, `MATRIX_EXP`, `BOUNDED_01`, or `UNREACHABLE_CHECK`. Justify each decision.

**Constraints / cases to handle.**
- Moderate `V`, arbitrary coins, count → `DP_TABLE`.
- Min-coins on a verified canonical system → `GREEDY`.
- Huge `V` (`>10^7`), tiny fixed coin set, count → `MATRIX_EXP`.
- Limited supply per coin → `BOUNDED_01`.
- Only need "is `V` reachable?" with `gcd`/Frobenius logic → `UNREACHABLE_CHECK`.

**Hint.** Encode the decision rules from `middle.md` and `senior.md`. The trap is using greedy on a non-canonical system, or a `dp[]` table for `V = 10^9`.

**Evaluation criteria.**
- Correctly classifies all five canonical cases.
- The `GREEDY` branch explicitly requires a canonicity verdict.
- Justification references the right complexity (`O(V·n)`, `O(n log n)`, `O(d³ log V)`, `O(V·Σ log k_i)`, `O(n)`).

---

## Benchmark Task

### Task B — Greedy vs DP correctness and speed across coin systems

**Problem.** Empirically compare greedy and DP for min-coins across several coin systems and a range of amounts. For each system, report (a) whether greedy ever disagrees with DP and the first disagreement, and (b) the wall-clock time of greedy vs DP for answering `Q` queries.

Test systems: `{1,5,10,25}` (canonical), `{1,3,4}` (non-canonical), `{1,7,10}` (non-canonical), `{1,2,5,10,20,50}` (canonical-ish — verify), and a random system.

**Starter — Python.**
```python
import random
import time


def greedy_count(desc, v):
    cnt = 0
    for c in desc:
        cnt += v // c
        v %= c
    return cnt


def dp_table(coins, limit):
    INF = 1 << 30
    dp = [0] + [INF] * limit
    for v in range(1, limit + 1):
        for c in coins:
            if c <= v and dp[v - c] + 1 < dp[v]:
                dp[v] = dp[v - c] + 1
    return dp


def first_disagreement(coins, limit):
    desc = sorted(coins, reverse=True)
    dp = dp_table(coins, limit)
    for v in range(1, limit + 1):
        if greedy_count(desc, v) != dp[v]:
            return v
    return -1


def main():
    systems = {
        "US": [1, 5, 10, 25],
        "{1,3,4}": [1, 3, 4],
        "{1,7,10}": [1, 7, 10],
        "euro-ish": [1, 2, 5, 10, 20, 50],
        "random": sorted(set([1] + [random.Random(7).randint(2, 40) for _ in range(5)])),
    }
    limit = 2000
    print(f"{'system':<12} first_disagreement   dp_ms")
    for name, coins in systems.items():
        t = time.perf_counter()
        fd = first_disagreement(coins, limit)
        ms = (time.perf_counter() - t) * 1000
        print(f"{name:<12} {fd:<20d} {ms:.2f}")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same coin systems and seed produce identical results across Go, Java, and Python.
- Canonical systems report `first_disagreement == -1`; non-canonical report the correct first counterexample (`{1,3,4}`→6, `{1,7,10}`→14).
- DP timing scales with `limit · n`; greedy is `O(n)` per query.
- Writeup: a short note on which systems are canonical and why greedy is unsafe in general.

---

## General Guidance for All Tasks

- **Always validate against the brute-force oracle first.** Every counting/min task above ships with (or references) a slow recursion. Run it on small inputs, diff exactly, and only then trust the DP on large inputs.
- **Decide combinations vs permutations before writing loops.** Coin-outer = combinations; amount-outer = permutations. This is a correctness choice, not a style choice.
- **Get the base cases right.** Min: `dp[0]=0`, rest `∞`. Count: `dp[0]=1`, rest `0`. A wrong base wrecks everything.
- **Use `INF = amount + 1` (or `1<<30`)**, never `MAX_INT`, so `dp[v-c]+1` cannot overflow.
- **Forward sweep = unbounded reuse; backward sweep = use-once (0/1).** Bounded coins ⇒ binary-split to 0/1, backward sweep.
- **Take `mod p` only in counting** (and only if asked); min-coins answers are bounded by `V` and never need a modulus.
- **Never use greedy on a non-canonical system.** Verify canonicity (Task 9) or use the DP.
- **Mind the pseudo-polynomial trap.** `dp[]` is `O(V)`; for `V = 10^9` switch to the recurrence/matrix route or a reachability/Frobenius shortcut.

- **Reuse the core DP across variants.** Most bugs live in the loop nesting and sweep direction; write the core once, parameterize objective/order/supply, and test each combination against the oracle.

Each task must be implemented and tested in **Go, Java, and Python**, with identical outputs across all three on the same inputs.
