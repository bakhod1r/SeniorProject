# Fibonacci Search — Interview Preparation

> A topic that almost never appears in coding-interview problems but is a favorite **whiteboard discussion question** at companies that build numerical libraries, embedded firmware, or scientific software (SciPy contributors, MATLAB engineers, control-systems firms, scientific HPC shops). Knowing it cleanly distinguishes a strong candidate.

---

## Junior Questions

| # | Question | Expected Answer Focus |
|---|---|---|
| 1 | What is Fibonacci search and when would you use it? | Sorted-array search using Fibonacci-numbered splits; division-free; embedded systems / golden-section pedagogy. |
| 2 | What is the time complexity? | O(log_φ n) ≈ 1.44 · log₂(n); same asymptotic class as binary search but ~44% more iterations. |
| 3 | How does it differ from binary search? | Picks probe at offset `F_{k-2}` rather than midpoint; uses only addition / subtraction. |
| 4 | Why "Fibonacci"? | Because the bracket lengths after each iteration form a decreasing Fibonacci sequence. |
| 5 | What is the precondition on the input? | Sorted ascending, random-access (no linked lists), total order (no NaN). |
| 6 | How do you find the smallest `F_k >= n`? | Iteratively compute Fibonacci numbers `F_{k+1} = F_k + F_{k-1}` until `F_{k+1} >= n`. |
| 7 | Show the algorithm on `[10, 22, 35, 40, 45, 50, 80, 82, 85, 90, 100, 235]`, target = 85. | Smallest `F_k >= 12` is 13; probe at index 4 (45 < 85), then 7 (82 < 85), then 9 (90 > 85), then 8 (found). |
| 8 | What is the space complexity? | O(1) iterative — three Fibonacci variables and an offset. |
| 9 | Why is the offset initialized to `-1`? | So the first probe `offset + F_{k-2}` lands at index `F_{k-2} - 1`, the natural left-biased split. |
| 10 | What does the tail check after the loop do? | Handles the final unexamined position when `F_k = 1` and `F_{k-1} = 1`. |

## Middle Questions

| # | Question | Expected Answer Focus |
|---|---|---|
| 1 | When does Fibonacci search beat binary search in practice? | CPUs without hardware division: Cortex-M0, 8051, AVR, RV32I; software-divide overhead dominates. |
| 2 | Implement `find_first` (leftmost match) for Fibonacci search. | Record candidate when `arr[i] == target`, then shift right-discarding (treat as `>` case) to continue searching left. |
| 3 | What is the relation between Fibonacci search and the golden ratio? | `lim F_{k+1} / F_k = φ`; split ratios converge to `1/φ` and `1/φ²`. |
| 4 | Explain why Fibonacci search's iteration count is 1.44× binary's. | `log_φ(n) / log_2(n) = log_2(2) / log_2(φ) = 1 / log_2(φ) ≈ 1.4404`. |
| 5 | What is golden-section search, and how does it differ from Fibonacci search? | Continuous-domain analogue; uses the limit ratio φ; one new evaluation per iteration (vs ternary's two). |
| 6 | Why does golden-section search reuse one probe per iteration? | The golden ratio is the unique split where one of the previous interior points lands at the symmetric position of the new bracket. |
| 7 | Can Fibonacci search handle duplicate values? | Yes — it returns some valid index; use `find_first` variant for the leftmost. |
| 8 | What is the worst-case input for Fibonacci search? | Any input requiring the maximum `log_φ(n)` iterations — e.g., target absent and falling on the boundary of every split. |
| 9 | Compose Fibonacci search with exponential search for an unbounded sorted stream. | First, double the upper bound until target is exceeded; then Fibonacci-search the resulting bounded range. |
| 10 | Why is `(lo + hi) / 2` avoided in Fibonacci search? | Because the entire point is to avoid division; the algorithm operates with adds and subtracts only. |

## Senior Questions

| # | Question | Expected Answer Focus |
|---|---|---|
| 1 | When would you reach for golden-section search in a production system? | Minimizing expensive black-box unimodal functions: hyperparameter tuning, sensor calibration, capacity tuning. |
| 2 | Why is golden-section search the default fallback in `scipy.optimize.minimize_scalar`? | Robust unimodal convergence at the asymptotic Kiefer optimum; one eval per iter; simple to fall back to from parabolic interpolation. |
| 3 | Explain Brent's method as a hybrid of golden-section and parabolic interpolation. | Tries parabolic step first; falls back to golden-section if step is outside bracket or doesn't improve sufficiently. |
| 4 | What does "one new evaluation per iteration" buy you? | Doubles throughput vs ternary search when evaluations are the cost bottleneck (minutes per evaluation in ML hyperparameter sweeps). |
| 5 | How does the secant method's convergence rate relate to φ? | Order-φ superlinear convergence; same Fibonacci recurrence on error magnitudes. |
| 6 | Architect a distributed Fibonacci-style optimizer over a worker pool. | Single-eval-per-iter property allows clean fan-out: dispatch one job per iteration, await result, advance. |
| 7 | How would you observe / monitor a golden-section search in production? | Track interval shrink ratio per iter (should be ≈ 1/φ); alert if deviating, indicating non-unimodal `f`. |
| 8 | When does golden-section search fail catastrophically? | Non-unimodal `f` (converges to local min); noisy `f` (random walk); flat regions (infinite loop without iteration cap). |
| 9 | Cost-model: when should you NOT use golden-section search even for unimodal `f`? | When you have a cheap derivative — use Newton's method or BFGS; far superlinear convergence. |
| 10 | Why do Cortex-M0 firmware engineers care about Fibonacci search? | No hardware divider; software divide takes ~20 cycles; Fibonacci search is 3-5× faster for sorted-table lookups. |

## Professional Questions

| # | Question | Expected Answer Focus |
|---|---|---|
| 1 | Prove the loop invariant `target in [offset+1, offset+F_c]`. | Inductive argument using `F_a + F_b = F_c`; base case at `offset = -1, F_c = F_m`; step splits into Case <, =, >. |
| 2 | Derive the iteration bound `T(n) = log_φ(n) + O(1)`. | `T(F_k) = k - 1` from recurrence; Binet's `F_k ≈ φ^k / sqrt(5)` gives `k ≈ log_φ(n · sqrt(5))`. |
| 3 | State Kiefer's theorem (1953) on optimal sequential minimax search. | Among fixed-evaluation-count strategies for unimodal continuous minimization, Fibonacci probe placement minimizes worst-case final bracket size. |
| 4 | Prove that the golden ratio is the unique split ratio enabling probe reuse. | Setup `r · (1-r) = (1-r)²` gives `r² - 3r + 1 = 0`, root `(3 - sqrt(5))/2 = 2 - φ ≈ 0.382`. |
| 5 | Show that φ has the slowest-converging continued-fraction expansion. | `φ = [1; 1, 1, 1, ...]`; convergents are `F_{k+1} / F_k`; Hurwitz's theorem tightness constant `sqrt(5)`. |
| 6 | Explain why the decision-tree lower bound rules out Fibonacci search as optimal for sorted-array search. | Need `≥ log₂(n+1)` comparisons in worst case; binary search achieves this; Fibonacci search uses 1.44× more. |
| 7 | Compare cache I/O complexity of binary and Fibonacci search. | Both O(log(N/M)) but Fibonacci has 1.44× constant; no clean Eytzinger analogue. |
| 8 | Why is the secant method's order of convergence exactly φ? | Error recurrence `e_{n+1} ~ K · e_n · e_{n-1}` produces solutions of the form `e_n ~ C · r^{F_n}` with `r = φ`. |
| 9 | What is the connection to the Euclidean GCD's worst case? | Worst-case inputs are consecutive Fibonacci numbers; iteration count is exactly `log_φ(min(a, b))`. |
| 10 | Sketch a proof of Kiefer's optimality theorem. | Define `L(n)` = worst-case bracket after `n` evals on `[0,1]`; recurrence `L(n) = L(n-1)^2 / L(n-2)`; inductive solution `L(n) = 1/F_n`. |

---

## Coding Challenge (3 Languages)

### Challenge: Implement Fibonacci search and verify against binary search

> Write `fib_search(arr, target)` that returns any valid index of `target` (or `-1`), using only addition / subtraction (no `/`, no `*`). Then test it against a binary-search reference on 10,000 random sorted arrays.

#### Go

```go
package main

import (
    "fmt"
    "math/rand"
    "sort"
)

func FibSearch(arr []int, target int) int {
    n := len(arr)
    if n == 0 {
        return -1
    }
    fkm2, fkm1, fk := 0, 1, 1
    for fk < n {
        fkm2, fkm1, fk = fkm1, fk, fkm1+fk
    }
    offset := -1
    for fk > 1 {
        i := offset + fkm2
        if i > n-1 {
            i = n - 1
        }
        if arr[i] < target {
            fk, fkm1, fkm2 = fkm1, fkm2, fkm1-fkm2
            offset = i
        } else if arr[i] > target {
            fk, fkm1, fkm2 = fkm2, fkm1-fkm2, fkm2-(fkm1-fkm2)
        } else {
            return i
        }
    }
    if fkm1 == 1 && offset+1 < n && arr[offset+1] == target {
        return offset + 1
    }
    return -1
}

func BinarySearch(arr []int, target int) int {
    lo, hi := 0, len(arr)-1
    for lo <= hi {
        mid := lo + (hi-lo)/2
        if arr[mid] == target {
            return mid
        } else if arr[mid] < target {
            lo = mid + 1
        } else {
            hi = mid - 1
        }
    }
    return -1
}

func main() {
    for k := 0; k < 10_000; k++ {
        n := rand.Intn(200)
        arr := make([]int, n)
        for i := range arr {
            arr[i] = rand.Intn(500)
        }
        sort.Ints(arr)
        target := rand.Intn(500)
        a := BinarySearch(arr, target)
        b := FibSearch(arr, target)
        ok := (a == -1 && b == -1) || (a >= 0 && b >= 0 && arr[a] == arr[b])
        if !ok {
            fmt.Printf("MISMATCH a=%d b=%d arr=%v target=%d\n", a, b, arr, target)
            return
        }
    }
    fmt.Println("10000 random tests passed")
}
```

#### Java

```java
import java.util.Arrays;
import java.util.Random;

public class FibSearchChallenge {
    public static int fibSearch(int[] arr, int target) {
        int n = arr.length;
        if (n == 0) return -1;
        int fkm2 = 0, fkm1 = 1, fk = 1;
        while (fk < n) { int t = fk; fk = fk + fkm1; fkm2 = fkm1; fkm1 = t; }
        int offset = -1;
        while (fk > 1) {
            int i = Math.min(offset + fkm2, n - 1);
            if (arr[i] < target) { fk = fkm1; fkm1 = fkm2; fkm2 = fk - fkm1; offset = i; }
            else if (arr[i] > target) { fk = fkm2; fkm1 = fkm1 - fkm2; fkm2 = fk - fkm1; }
            else return i;
        }
        if (fkm1 == 1 && offset + 1 < n && arr[offset + 1] == target) return offset + 1;
        return -1;
    }

    public static int binarySearch(int[] arr, int target) {
        int lo = 0, hi = arr.length - 1;
        while (lo <= hi) {
            int mid = lo + (hi - lo) / 2;
            if (arr[mid] == target) return mid;
            else if (arr[mid] < target) lo = mid + 1;
            else hi = mid - 1;
        }
        return -1;
    }

    public static void main(String[] args) {
        Random rng = new Random(0xC0FFEE);
        for (int k = 0; k < 10_000; k++) {
            int n = rng.nextInt(200);
            int[] arr = new int[n];
            for (int i = 0; i < n; i++) arr[i] = rng.nextInt(500);
            Arrays.sort(arr);
            int target = rng.nextInt(500);
            int a = binarySearch(arr, target);
            int b = fibSearch(arr, target);
            boolean ok = (a == -1 && b == -1) || (a >= 0 && b >= 0 && arr[a] == arr[b]);
            if (!ok) throw new AssertionError("mismatch");
        }
        System.out.println("10000 random tests passed");
    }
}
```

#### Python

```python
import random

def fib_search(arr, target):
    n = len(arr)
    if n == 0:
        return -1
    fkm2, fkm1, fk = 0, 1, 1
    while fk < n:
        fkm2, fkm1, fk = fkm1, fk, fk + fkm1
    offset = -1
    while fk > 1:
        i = min(offset + fkm2, n - 1)
        if arr[i] < target:
            fk, fkm1, fkm2 = fkm1, fkm2, fkm1 - fkm2
            offset = i
        elif arr[i] > target:
            fk, fkm1, fkm2 = fkm2, fkm1 - fkm2, fkm2 - (fkm1 - fkm2)
        else:
            return i
    if fkm1 == 1 and offset + 1 < n and arr[offset + 1] == target:
        return offset + 1
    return -1

def binary_search(arr, target):
    lo, hi = 0, len(arr) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if arr[mid] == target:
            return mid
        elif arr[mid] < target:
            lo = mid + 1
        else:
            hi = mid - 1
    return -1

if __name__ == "__main__":
    random.seed(0xC0FFEE)
    for _ in range(10_000):
        n = random.randint(0, 200)
        arr = sorted(random.randint(0, 500) for _ in range(n))
        target = random.randint(0, 500)
        a = binary_search(arr, target)
        b = fib_search(arr, target)
        ok = (a == -1 and b == -1) or (a >= 0 and b >= 0 and arr[a] == arr[b])
        assert ok, f"mismatch arr={arr} target={target} a={a} b={b}"
    print("10000 random tests passed")
```

---

## Behavioral / System Design Questions

| # | Question |
|---|---|
| 1 | Walk me through a production incident where a sorted-array search ran slowly. Could Fibonacci search have helped? |
| 2 | You're designing the lookup logic in a battery-powered IoT device with a 16-bit MCU. Justify your choice of search algorithm. |
| 3 | A teammate proposes Fibonacci search "because it's elegant". What questions do you ask? |
| 4 | Explain golden-section search to a non-engineer using only an everyday analogy. |
| 5 | Describe a hyperparameter-tuning pipeline that uses golden-section as a sub-component. |

---

## Common Follow-Up Probes from Interviewers

After your initial answer, expect any of these:

| Probe | What they're testing |
|---|---|
| "Walk me through your algorithm on this specific array..." | Whether you actually understand the index arithmetic, not just memorized code. |
| "Why `min(offset + F_{k-2}, n - 1)` and not just `offset + F_{k-2}`?" | Edge-case awareness; you padded conceptually to `F_k >= n`. |
| "What happens if I pass an unsorted array?" | Precondition discipline. |
| "Can you do this on a linked list?" | Understanding of access cost models — random access is required. |
| "Modify it to find the first occurrence with duplicates." | Comfort with bisection variants. |
| "Compare wall-clock to binary search — predict the ratio." | Mental model of cycle cost; 1.44 iteration ratio + constant per-iter overhead. |
| "Where does this beat binary search in real life?" | Hardware awareness — embedded MCUs, division-poor cores. |
| "What is the connection to the secant method?" | Cross-topic understanding of φ-rate convergence. |
| "Prove the iteration bound." | Mathematical maturity; Binet's formula. |
| "Is Fibonacci search information-theoretically optimal?" | NO — binary search achieves the decision-tree lower bound; Fibonacci does not for fixed-array search. |

---

## Whiteboard Variants

### Variant A — Modify for a sorted descending array

Flip every comparison: `arr[i] > target` triggers the "discard left" branch, etc. Don't change the Fibonacci bookkeeping.

### Variant B — Fibonacci search on a `Comparable<T>` array

Replace `<`, `>`, `==` with `compareTo`. Otherwise identical.

### Variant C — Iterative bracket-shrink instead of fixed iteration count

Run until the bracket has only 1 element, then directly check. This is the most readable form.

### Variant D — Find the closest value, not the exact target

Run the lower-bound variant; then compare `arr[result - 1]` and `arr[result]` to target; return whichever is closer.

### Variant E — Fibonacci search over a memoized function (golden-section-style)

Cache `arr[i]` evaluations; when an `arr[i]` is requested twice (rare with the standard pattern but possible with the lower-bound variant), serve from cache.

---

## "Why Do I Care?" Talking Points for Behavioral Rounds

When an interviewer asks "why did you study Fibonacci search?", strong answers connect it to broader competencies:

1. **Algorithmic literacy.** Understanding why binary search is optimal requires knowing what suboptimal alternatives exist.
2. **Numerical optimization.** Golden-section search is the entry point to derivative-free 1D optimization, which is fundamental to ML hyperparameter tuning, control-system calibration, and scientific computing.
3. **Hardware awareness.** Knowing when division is expensive vs free shapes embedded firmware design.
4. **Mathematical foundation.** The golden ratio's role as the "most irrational number" connects to continued fractions, Diophantine approximation, and the Euclidean GCD.
5. **History.** The fact that this algorithm was invented in 1960 for tape-drive search — a context that no longer exists — illustrates how cost models drive algorithm design.

---

## Final Tips

- **Don't oversell Fibonacci search.** Acknowledge upfront that binary search is usually better.
- **Connect to golden-section search.** This is where the interview gets interesting; senior interviewers love the pedagogical chain.
- **Be precise about the 1.44 constant.** `1 / log_2(φ) = 1.4404...` Memorize this.
- **Know the proof structure.** Even if you don't memorize the full Kiefer proof, sketch the invariant and recurrence.
- **Have an embedded story.** "On a Cortex-M0 firmware I worked on..." beats abstract theory.
- **Bring `bisect_left` / `Arrays.binarySearch` / `slices.BinarySearch` to mind as the default.** Recommend these unless the constraints rule them out.
- **Mention the SciPy connection.** `minimize_scalar(method='golden')` is the production Python answer; `fminbnd` for MATLAB; `optimize` for R.
- **Be ready to draw φ on a number line.** Many interviewers find this clarifying when discussing the 38/62 split.
- **Don't memorize all 30 questions.** The graders want depth on 3-5 questions, not surface coverage of 30.

---

## Five-Minute Mock-Interview Script

> **Interviewer:** Describe Fibonacci search and when it's useful.

You: Fibonacci search is a sorted-array search algorithm that runs in O(log_φ n) ≈ 1.44 · log₂ n iterations. Unlike binary search, which probes the midpoint, Fibonacci search probes at offset `F_{k-2}` from the current left edge, using consecutive Fibonacci numbers. The key property is that it uses only addition and subtraction — no division or multiplication. It's useful on CPUs without hardware divide (Cortex-M0, AVR, RV32I base) and as the conceptual ancestor of golden-section search.

> **Interviewer:** Why are Fibonacci numbers the natural splitter?

You: Because `F_{k-2} + F_{k-1} = F_k`, so when you probe at offset `F_{k-2}` in a window of size `F_k`, the two halves have sizes `F_{k-2}` and `F_{k-1}` — both still Fibonacci numbers, so the recursion is self-similar.

> **Interviewer:** Walk me through it on `[10, 22, 35, 40, 45, 50, 80, 82, 85, 90, 100, 235]`, target 85.

You: n=12, smallest Fib ≥ 12 is 13, so `F_k=13, F_{k-1}=8, F_{k-2}=5`. Offset=−1. Iter 1: probe at index 4, value 45 < 85, shift twice, F_k=8, F_{k-1}=5, F_{k-2}=3, offset=4. Iter 2: probe at 7, value 82 < 85, shift twice, F_k=5, F_{k-1}=3, F_{k-2}=2, offset=7. Iter 3: probe at 9, value 90 > 85, shift once, F_k=2, F_{k-1}=1, F_{k-2}=1, offset=7. Iter 4: probe at 8, value 85 == 85, return 8.

> **Interviewer:** How does this relate to golden-section search?

You: Golden-section search is the continuous analogue. It uses the limit ratio `φ = (1 + √5) / 2` as the split, and it has the unique property that one of the previous probe positions falls exactly at the symmetric golden-ratio position of the new bracket — so only one new function evaluation per iteration. That makes it the default 1D minimizer in `scipy.optimize.minimize_scalar(method='golden')` and the fallback in Brent's method.

> **Interviewer:** What would you actually use in production?

You: For sorted-array search, binary search — every time. For unimodal optimization with expensive evaluations, golden-section or Brent's method.
