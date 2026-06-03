# Digit DP (Counting Numbers in a Range with Digit Constraints) — Interview Preparation

Digit DP is a favourite interview topic because it rewards a single crisp insight — *"count numbers `≤ N` by building them digit by digit, carrying `(pos, tight, started, accumulator)`"* — and then tests whether you can (a) handle the tight/bound flag correctly, (b) handle leading zeros, (c) decompose `[L, R]` as `f(R) − f(L−1)`, (d) pick the right accumulator (sum, remainder, last digit, mask), and (e) avoid the classic trap of caching tight states. This file is a curated question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Accumulator | Final test | Complexity |
|----------|-------------|-----------|------------|
| Count digit sum `= S` in `[0, N]` | running sum | `sum == S` | `O(D · 9D · 10)` |
| Count divisible by `K` | running value `mod K` | `rem == 0` | `O(D · K · 10)` |
| Count without forbidden digits | none (restrict loop) | reached end | `O(D · 10)` |
| No two equal adjacent digits | last digit + `started` | survived recursion | `O(D · 11 · 10)` |
| Digits non-decreasing | last digit + `started` | survived recursion | `O(D · 11 · 10)` |
| Count of a given digit (total) | running count, return it | sum over paths | `O(D · D · 10)` |
| Sum of digit sums over range | `(count, sum)` pair | return pair | `O(D · 9D · 10)` |
| Range `[L, R]` | any of the above | `f(R) − f(L−1)` | same |

Core skeleton:

```text
solve(pos, tight, started, acc):
    if pos == len(N): return isValid(acc, started) ? 1 : 0
    if not tight and memo[pos][started][acc] set: return it   # FREE states only
    limit = tight ? N[pos] : base-1
    total = 0
    for dig in 0..limit:
        total += solve(pos+1, tight && dig==limit, started || dig>0, update(acc,dig))
    if not tight: memo[pos][started][acc] = total
    return total
# cost: O(D · M · base);  range = f(R) - f(L-1)
```

Key facts:
- **Length = digit count `D`**; `N` is stored as a **string** so it scales to `10^18` and beyond.
- **Tight** caps the current digit at `N[pos]`; once below `N`, all digits are free.
- **Memoize only the free (`tight=false`) states** — tight states are unique per bound; caching them corrupts the count.
- **`started`** distinguishes real digits from leading-zero padding; needed for adjacency, monotonic, digit-frequency, mask predicates (not for plain digit sum).
- **Range** via `f(R) − f(L−1)`, with `f(−1) = 0`.

---

## Junior Questions (12 Q&A)

### J1. What problem does Digit DP solve?
Counting how many integers in `[0, N]` (or `[L, R]`) satisfy a constraint on their **digits** — digit sum, divisibility, adjacency rules, allowed digit sets, monotonic digits, etc. — without iterating over every number. It works for `N` as large as `10^18` or even a 200-digit string.

### J2. Why not just loop over all numbers?
Looping is `O(N)`. For `N = 10^18` that is a quintillion iterations — physically impossible. Digit DP is `O(D · M · base)` where `D ≈ log₁₀ N` is the digit count, which is tens of thousands of operations regardless of how large `N` is.

### J3. What is the canonical state?
`(pos, tight, started, accumulator)`: the current digit position (MSB first), whether we are still stuck to `N`'s prefix (tight), whether a real non-zero digit has been placed (started), and a problem-specific running quantity (the accumulator).

### J4. What does the tight flag mean?
`tight = true` means every digit so far equals `N`'s corresponding digit, so the current digit is capped at `N[pos]` to stay `≤ N`. Once you place a digit strictly below `N[pos]`, you drop below `N` permanently and `tight` becomes `false`, freeing all later digits to be `0..base-1`.

### J5. What is the leading-zero (`started`) flag for?
It tells you whether the "real" number has begun. The number `7` inside a 3-digit frame is `007`; those leading zeros are padding, not real digits. `started` is `false` while padding, `true` after the first non-zero digit. It matters for constraints where padding zeros would be mistaken for real digits.

### J6. Why do we store `N` as a string?
So the algorithm never needs `N` to fit in a machine integer — only its individual digits `N[pos]` and its length. This is what lets Digit DP handle `N = 10^18` or arbitrarily large bounds.

### J7. How do you count over a range `[L, R]`?
Compute `f(R) − f(L−1)`, where `f(X)` counts valid numbers in `[0, X]`. It is prefix subtraction on counts, exactly like prefix sums. Define `f(−1) = 0` for `L = 0`.

### J8. Why memoize?
A naive digit-by-digit recursion explores `base^D` leaves — exponential. But many prefixes reach the same `(pos, started, accumulator)` free state with identical completion counts, so caching that result reuses the work and collapses the tree into a small table.

### J9. Which states do you cache?
Only the **free** states (`tight = false`). The accumulator update for a single digit-sum example is `sum + dig`; for divisibility it is `(rem*base + dig) % K`.

### J10. What is the base case?
When `pos == len(N)` (past the last digit), return `1` if the accumulated state satisfies the predicate (e.g., `sum == S`), else `0`.

### J11. Does Digit DP list the numbers or count them?
It **counts** them. Listing would be `O(answer)` and defeats the purpose; Digit DP's value is producing a count in time independent of how many numbers match.

### J12. Give an example accumulator for "divisible by K".
The running value modulo `K`. Appending digit `dig` updates it as `rem = (rem * base + dig) % K`. At the end, valid iff `rem == 0`.

---

## Mid-Level Questions (10 Q&A)

### M1. Precisely why must tight states not be cached?
For a fixed `N`, there is exactly **one** tight prefix per position (the prefix equal to `N`), so a tight state is visited at most once — caching gains nothing. Worse, if the cache key omits `tight`, a tight state (capped at `N[pos]`) and a free state (all digits allowed) with the same `(pos, acc)` collide and have different counts, silently corrupting the answer. So: skip caching when tight, or include `tight` in the key.

### M2. When is the `started` flag mandatory?
Whenever leading-zero padding could be mistaken for a real digit: "no two equal adjacent digits" (two padding `0`s look adjacent-equal), "digits non-decreasing" (the first real digit must not be forced `≥ 0` of a fake zero), "count of digit 0" (padding zeros inflate the count), and bitmask predicates (padding zeros set bit 0). It is *not* needed for plain digit sum, where zeros add nothing.

### M3. How do you compute `L − 1` when `L` is a huge string?
Decrement the digit string: from the right, turn trailing `0`s into `9`s (borrow), decrement the first non-zero digit, then strip leading zeros (avoiding the empty string → "0"). For `L = "0"`, treat `f(−1) = 0`.

### M4. How does the divisibility accumulator work?
Carry `rem = value mod K`. Appending `dig`: `rem' = (rem * base + dig) % K` (Horner's method modulo `K`). The accumulator range is `0..K-1`, so the DP is `O(D · K · base)`.

### M5. What accumulator counts numbers with all-distinct digits?
A `base`-bit **bitmask** of which digits have appeared. Appending `dig` is forbidden if bit `dig` is already set; otherwise set it. Use `started` so padding zeros do not set bit 0. `M = 2^base` (1024 for decimal).

### M6. How do you total a quantity (e.g., total digit sum) over a range?
Return a `(count, sum)` pair from each state instead of a 0/1 count. When a digit `dig` is prepended to `c` numbers whose total is `s`, the new total is `s + dig*c` (each of the `c` numbers gains `dig`). Combine with `f(R) − f(L−1)` on the sum component.

### M7. What is the complexity and what dominates it?
`O(D · M · base)`, where `M` is the number of distinct accumulator (×`started`) values. `M` dominates: digit sum `M ≈ 9D`, residue `M = K`, last digit `M ≈ base`, mask `M = 2^base`. Keeping `M` small is the whole game.

### M8. How does base change the algorithm?
Not at all structurally. Replace `base = 10` with any `b`, parse `N` in base `b`, loop digits `0..min(N[pos], b-1)`, and use `rem' = (rem*b + dig) % K` for divisibility. Leading-zero and tight logic are identical.

### M9. Top-down vs bottom-up for Digit DP?
Top-down (memoized recursion) mirrors the problem and only visits reachable states; recursion depth is `D`. Bottom-up (tabulation) avoids recursion (safe for enormous `D`) and the free table is bound-independent, enabling reuse across queries, but the tight-path bookkeeping is more error-prone.

### M10. What is the single best way to gain confidence in a Digit DP?
A brute-force oracle: loop over every `N` from 0 to a few thousand for every parameter and assert the DP matches. It catches the length off-by-one, leading-zero, tight-cache, and `f(R) − f(L−1)` decrement bugs — nearly every real defect.

---

## Senior Questions (8 Q&A)

### S1. What is the structural view that unifies all Digit DP problems?
Digit DP is **DP over a DFA that reads digits**. The state `(accumulator, started)` is an automaton state; digit positions are time steps; counting valid numbers is summing accepting runs of length `D`. The bound `N` is handled separately by the tight/free decomposition. By Myhill-Nerode, the DP is efficient exactly when that DFA has few states.

### S2. How is Digit DP related to matrix exponentiation?
Without the upper-bound constraint, counting length-`D` accepted digit strings of the automaton is counting length-`D` walks: `e_{start}^⊤ T^D 1_{accept}` for the transition matrix `T`. For *fixed* automaton and astronomically large width, you literally power `T` (`O(|Q|³ log D)`). Ordinary Digit DP iterates positions directly because `D` is small; the bound adds the tight-walk correction.

### S3. How do you keep the state from exploding?
Never carry the raw value — reduce to a residue mod `K`. Clamp accumulators that only need a threshold (`min(sum, S+1)`). Use a bitmask instead of a full frequency vector. Drop the `started` dimension when the predicate (e.g., digit sum) does not need it. Each dropped/clamped dimension shrinks `M`, and cost is linear in `M`.

### S4. How do you serve thousands of range queries efficiently?
The **free-state table is bound-independent** (it never references `N[pos]`). Build it once; answer each query with a single `O(D · base)` tight walk down the query's bound. This turns each query from `O(D · M · base)` into `O(D · base)` after the first.

### S5. When is Digit DP the *wrong* tool?
When the predicate needs the whole value (e.g., "is the number prime") — no bounded accumulator exists, so `M` is exponential and there is no gain over brute force. Primality counting belongs to analytic number theory, not Digit DP.

### S6. How do you handle a 100 000-digit bound?
Top-down recursion would overflow the stack (depth `= D`). Switch to bottom-up tabulation with the free-table + tight-walk decomposition, which uses no recursion and is cache-friendly.

### S7. What are the dominant failure modes in production?
Caching tight states (silent over-count), stale cache across `f(R)` and `f(L−1)`, leading-zero corruption, a buggy `L − 1` string decrement, and endpoint-semantics confusion ("strictly less" vs "at most"). All are caught by a brute-force oracle plus a range-decomposition property test.

### S8. How do you make exact counts that exceed 64 bits?
Reduce the *count* (the `total` accumulation) modulo the prime the problem specifies: `total = (total + child) % MOD`. The digit accumulator is bounded by design and does not overflow; only the count grows.

---

## Behavioral / Communication Prompts

- **"Walk me through your state design."** Name the four fields, justify each (does this predicate need `started`? what is the accumulator range `M`?), and state the complexity `O(D · M · base)` before coding.
- **"How would you test this?"** Lead with the brute-force oracle over all small `N`, then the `f(R) − f(L−1)` range property test and the `f` monotonicity guardrail.
- **"You shipped a Digit DP that returns slightly-too-large counts. Debug it."** First hypothesis: tight states are being cached. Show the `if not tight` guard. Second: leading zeros counted as real digits.
- **"Explain the tight flag to a junior."** Use the speed-limit analogy: while you match the bound exactly you obey the cap `N[pos]`; the moment you go below, the limit lifts.
- **"When would you reach for a closed-form formula instead?"** When the predicate is clean (all-distinct digits, strictly increasing) and a binomial/falling-factorial count exists; Digit DP is the general fallback when constraints compose.

---

## Coding Challenge 1: Count Numbers with Digit Sum `= S` in `[0, N]`

**Problem.** Given `N` (as a string, up to `10^18`) and `S`, count integers in `[0, N]` whose digits sum to exactly `S`.

### Go
```go
package main

import "fmt"

func countDigitSum(N string, S int) int64 {
	d := len(N)
	memo := make([][]int64, d)
	for i := range memo {
		memo[i] = make([]int64, S+1)
		for j := range memo[i] {
			memo[i][j] = -1
		}
	}
	var solve func(pos int, tight bool, sum int) int64
	solve = func(pos int, tight bool, sum int) int64 {
		if sum > S {
			return 0
		}
		if pos == d {
			if sum == S {
				return 1
			}
			return 0
		}
		if !tight && memo[pos][sum] != -1 {
			return memo[pos][sum]
		}
		limit := 9
		if tight {
			limit = int(N[pos] - '0')
		}
		var total int64
		for dig := 0; dig <= limit; dig++ {
			total += solve(pos+1, tight && dig == limit, sum+dig)
		}
		if !tight {
			memo[pos][sum] = total
		}
		return total
	}
	return solve(0, true, 0)
}

func main() {
	fmt.Println(countDigitSum("21", 3))  // 3
	fmt.Println(countDigitSum("100", 1)) // 3: 1,10,100
}
```

### Java
```java
public class C1DigitSum {
    static int D, S;
    static int[] dig;
    static long[][] memo;

    static long solve(int pos, boolean tight, int sum) {
        if (sum > S) return 0;
        if (pos == D) return sum == S ? 1 : 0;
        if (!tight && memo[pos][sum] != -1) return memo[pos][sum];
        int limit = tight ? dig[pos] : 9;
        long total = 0;
        for (int x = 0; x <= limit; x++)
            total += solve(pos + 1, tight && x == limit, sum + x);
        if (!tight) memo[pos][sum] = total;
        return total;
    }

    static long count(String N, int s) {
        D = N.length(); S = s;
        dig = new int[D];
        for (int i = 0; i < D; i++) dig[i] = N.charAt(i) - '0';
        memo = new long[D][S + 1];
        for (long[] r : memo) java.util.Arrays.fill(r, -1);
        return solve(0, true, 0);
    }

    public static void main(String[] a) {
        System.out.println(count("21", 3));  // 3
        System.out.println(count("100", 1)); // 3
    }
}
```

### Python
```python
from functools import lru_cache


def count_digit_sum(N: str, S: int) -> int:
    digits = [int(c) for c in N]
    D = len(digits)

    @lru_cache(maxsize=None)
    def solve(pos, tight, s):
        if s > S:
            return 0
        if pos == D:
            return 1 if s == S else 0
        limit = digits[pos] if tight else 9
        total = 0
        for x in range(limit + 1):
            total += solve(pos + 1, tight and x == limit, s + x)
        return total

    res = solve(0, True, 0)
    solve.cache_clear()
    return res


if __name__ == "__main__":
    print(count_digit_sum("21", 3))   # 3
    print(count_digit_sum("100", 1))  # 3
```

---

## Coding Challenge 2: Count Numbers Divisible by `K` in `[L, R]`

**Problem.** Given `L`, `R` (strings) and `K`, count integers in `[L, R]` divisible by `K`. Use `f(R) − f(L−1)`.

### Go
```go
package main

import "fmt"

func fDiv(N string, K int) int64 {
	if N == "-1" {
		return 0
	}
	d := len(N)
	memo := make([][]int64, d)
	for i := range memo {
		memo[i] = make([]int64, K)
		for j := range memo[i] {
			memo[i][j] = -1
		}
	}
	var solve func(pos int, tight bool, rem int) int64
	solve = func(pos int, tight bool, rem int) int64 {
		if pos == d {
			if rem == 0 {
				return 1
			}
			return 0
		}
		if !tight && memo[pos][rem] != -1 {
			return memo[pos][rem]
		}
		limit := 9
		if tight {
			limit = int(N[pos] - '0')
		}
		var total int64
		for dig := 0; dig <= limit; dig++ {
			total += solve(pos+1, tight && dig == limit, (rem*10+dig)%K)
		}
		if !tight {
			memo[pos][rem] = total
		}
		return total
	}
	return solve(0, true, 0)
}

func decString(s string) string {
	b := []byte(s)
	i := len(b) - 1
	for i >= 0 && b[i] == '0' {
		b[i] = '9'
		i--
	}
	b[i]--
	k := 0
	for k < len(b)-1 && b[k] == '0' {
		k++
	}
	return string(b[k:])
}

func main() {
	L, R, K := "10", "25", 3
	lo := "-1"
	if L != "0" {
		lo = decString(L)
	}
	fmt.Println(fDiv(R, K) - fDiv(lo, K)) // 5: 12,15,18,21,24
}
```

### Java
```java
public class C2Divisible {
    static int D, K;
    static int[] dig;
    static long[][] memo;

    static long solve(int pos, boolean tight, int rem) {
        if (pos == D) return rem == 0 ? 1 : 0;
        if (!tight && memo[pos][rem] != -1) return memo[pos][rem];
        int limit = tight ? dig[pos] : 9;
        long total = 0;
        for (int x = 0; x <= limit; x++)
            total += solve(pos + 1, tight && x == limit, (rem * 10 + x) % K);
        if (!tight) memo[pos][rem] = total;
        return total;
    }

    static long f(String N, int k) {
        if (N.equals("-1")) return 0;
        D = N.length(); K = k;
        dig = new int[D];
        for (int i = 0; i < D; i++) dig[i] = N.charAt(i) - '0';
        memo = new long[D][K];
        for (long[] r : memo) java.util.Arrays.fill(r, -1);
        return solve(0, true, 0);
    }

    static String dec(String s) {
        char[] b = s.toCharArray();
        int i = b.length - 1;
        while (i >= 0 && b[i] == '0') { b[i] = '9'; i--; }
        b[i]--;
        int k = 0;
        while (k < b.length - 1 && b[k] == '0') k++;
        return new String(b, k, b.length - k);
    }

    public static void main(String[] a) {
        String L = "10", R = "25"; int k = 3;
        String lo = L.equals("0") ? "-1" : dec(L);
        System.out.println(f(R, k) - f(lo, k)); // 5
    }
}
```

### Python
```python
from functools import lru_cache


def f(N: str, K: int) -> int:
    if N == "-1":
        return 0
    digits = [int(c) for c in N]
    D = len(digits)

    @lru_cache(maxsize=None)
    def solve(pos, tight, rem):
        if pos == D:
            return 1 if rem == 0 else 0
        limit = digits[pos] if tight else 9
        total = 0
        for x in range(limit + 1):
            total += solve(pos + 1, tight and x == limit, (rem * 10 + x) % K)
        return total

    res = solve(0, True, 0)
    solve.cache_clear()
    return res


def dec_string(s):
    b = list(s)
    i = len(b) - 1
    while i >= 0 and b[i] == "0":
        b[i] = "9"; i -= 1
    b[i] = str(int(b[i]) - 1)
    return "".join(b).lstrip("0") or "0"


def count_divisible(L, R, K):
    lo = "-1" if L == "0" else dec_string(L)
    return f(R, K) - f(lo, K)


if __name__ == "__main__":
    print(count_divisible("10", "25", 3))  # 5
```

---

## Coding Challenge 3: Count Numbers Without Forbidden Digits in `[0, N]`

**Problem.** Given `N` (string) and a set of forbidden digits, count integers in `[0, N]` that use none of them. No accumulator needed — just restrict the digit loop. (Numbers like `0` are allowed unless `0` is forbidden.)

### Go
```go
package main

import "fmt"

func countNoForbidden(N string, forbidden map[int]bool) int64 {
	d := len(N)
	// memo[pos][started]; free states only.
	memo := [2][]int64{}
	for s := 0; s < 2; s++ {
		memo[s] = make([]int64, d)
		for i := range memo[s] {
			memo[s][i] = -1
		}
	}
	var solve func(pos int, tight, started bool) int64
	solve = func(pos int, tight, started bool) int64 {
		if pos == d {
			return 1 // any number that survived the forbidden filter is valid
		}
		si := 0
		if started {
			si = 1
		}
		if !tight && memo[si][pos] != -1 {
			return memo[si][pos]
		}
		limit := 9
		if tight {
			limit = int(N[pos] - '0')
		}
		var total int64
		for dig := 0; dig <= limit; dig++ {
			if forbidden[dig] {
				continue
			}
			total += solve(pos+1, tight && dig == limit, started || dig != 0)
		}
		if !tight {
			memo[si][pos] = total
		}
		return total
	}
	return solve(0, true, false)
}

func main() {
	fmt.Println(countNoForbidden("25", map[int]bool{3: true})) // [0,25] without digit 3
}
```

### Java
```java
import java.util.Set;

public class C3NoForbidden {
    static int D;
    static int[] dig;
    static Set<Integer> forb;
    static long[][] memo; // [started][pos]

    static long solve(int pos, boolean tight, boolean started) {
        if (pos == D) return 1;
        int si = started ? 1 : 0;
        if (!tight && memo[si][pos] != -1) return memo[si][pos];
        int limit = tight ? dig[pos] : 9;
        long total = 0;
        for (int x = 0; x <= limit; x++) {
            if (forb.contains(x)) continue;
            total += solve(pos + 1, tight && x == limit, started || x != 0);
        }
        if (!tight) memo[si][pos] = total;
        return total;
    }

    static long count(String N, Set<Integer> forbidden) {
        D = N.length(); forb = forbidden;
        dig = new int[D];
        for (int i = 0; i < D; i++) dig[i] = N.charAt(i) - '0';
        memo = new long[2][D];
        for (long[] r : memo) java.util.Arrays.fill(r, -1);
        return solve(0, true, false);
    }

    public static void main(String[] a) {
        System.out.println(count("25", Set.of(3)));
    }
}
```

### Python
```python
from functools import lru_cache


def count_no_forbidden(N: str, forbidden) -> int:
    digits = [int(c) for c in N]
    D = len(digits)
    forb = set(forbidden)

    @lru_cache(maxsize=None)
    def solve(pos, tight, started):
        if pos == D:
            return 1
        limit = digits[pos] if tight else 9
        total = 0
        for x in range(limit + 1):
            if x in forb:
                continue
            total += solve(pos + 1, tight and x == limit, started or x != 0)
        return total

    res = solve(0, True, False)
    solve.cache_clear()
    return res


if __name__ == "__main__":
    print(count_no_forbidden("25", {3}))  # [0,25] avoiding digit 3
```

---

## Coding Challenge 4: Sum of Digit Sums of All Numbers in `[0, N]`

**Problem.** Compute the **sum of digit sums** of every integer in `[0, N]`. E.g., for `N = 12`: digit sums of 0..12 are `0,1,...,9,1,2,3` → total `45 + 1 + 2 + 3 = 51`. Carry a `(count, sum)` pair.

### Go
```go
package main

import "fmt"

type pair struct{ cnt, sum int64 }

func totalDigitSum(N string) int64 {
	d := len(N)
	memo := make([]map[int]pair, d)
	for i := range memo {
		memo[i] = map[int]pair{}
	}
	seen := make([]map[int]bool, d)
	for i := range seen {
		seen[i] = map[int]bool{}
	}
	var solve func(pos int, tight bool, running int) pair
	solve = func(pos int, tight bool, running int) pair {
		if pos == d {
			return pair{1, int64(running)}
		}
		if !tight && seen[pos][running] {
			return memo[pos][running]
		}
		limit := 9
		if tight {
			limit = int(N[pos] - '0')
		}
		var c, s int64
		for dig := 0; dig <= limit; dig++ {
			child := solve(pos+1, tight && dig == limit, running+dig)
			c += child.cnt
			s += child.sum
		}
		res := pair{c, s}
		if !tight {
			seen[pos][running] = true
			memo[pos][running] = res
		}
		return res
	}
	return solve(0, true, 0).sum
}

func main() {
	fmt.Println(totalDigitSum("12")) // 51
}
```

### Java
```java
import java.util.HashMap;
import java.util.Map;

public class C4TotalDigitSum {
    static int D;
    static int[] dig;
    static Map<Integer, long[]>[] memo; // memo[pos] : running -> {cnt, sum}

    @SuppressWarnings("unchecked")
    static long total(String N) {
        D = N.length();
        dig = new int[D];
        for (int i = 0; i < D; i++) dig[i] = N.charAt(i) - '0';
        memo = new HashMap[D];
        for (int i = 0; i < D; i++) memo[i] = new HashMap<>();
        return solve(0, true, 0)[1];
    }

    static long[] solve(int pos, boolean tight, int running) {
        if (pos == D) return new long[]{1, running};
        if (!tight && memo[pos].containsKey(running)) return memo[pos].get(running);
        int limit = tight ? dig[pos] : 9;
        long c = 0, s = 0;
        for (int x = 0; x <= limit; x++) {
            long[] child = solve(pos + 1, tight && x == limit, running + x);
            c += child[0];
            s += child[1];
        }
        long[] res = {c, s};
        if (!tight) memo[pos].put(running, res);
        return res;
    }

    public static void main(String[] a) {
        System.out.println(total("12")); // 51
    }
}
```

### Python
```python
from functools import lru_cache


def total_digit_sum(N: str) -> int:
    digits = [int(c) for c in N]
    D = len(digits)

    @lru_cache(maxsize=None)
    def solve(pos, tight, running):
        if pos == D:
            return (1, running)  # (count, sum-of-digit-sums)
        limit = digits[pos] if tight else 9
        c = s = 0
        for x in range(limit + 1):
            cc, ss = solve(pos + 1, tight and x == limit, running + x)
            c += cc
            s += ss
        return (c, s)

    res = solve(0, True, 0)[1]
    solve.cache_clear()
    return res


if __name__ == "__main__":
    print(total_digit_sum("12"))  # 51
```

---

## Final Tips for the Interview

- **State the state out loud first.** "I'll recurse over positions carrying `(pos, tight, started, acc)`; here `acc` is the digit sum / remainder / last digit / mask." This signals mastery before a line of code.
- **Mention the tight-cache rule unprompted.** "I memoize only the free states because tight states are unique per bound and caching them corrupts the count." Interviewers love this.
- **Decompose ranges immediately.** Write `f(R) − f(L−1)` and note `f(−1) = 0`.
- **Justify `started`.** Say whether this specific predicate needs it and why (leading-zero padding).
- **Lead testing with the brute-force oracle.** It is the single most convincing correctness story.
- **Know the complexity cold:** `O(D · M · base)`, with `M` the accumulator range — and name `M` for the problem at hand.
