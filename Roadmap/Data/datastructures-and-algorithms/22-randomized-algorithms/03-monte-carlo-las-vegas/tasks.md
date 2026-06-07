# Monte Carlo vs Las Vegas Randomized Algorithms — Practice Tasks

> All tasks must be solved in **Go, Java, and Python**.
> **Always inject a seeded RNG** (do not call the global default) so every run is reproducible — fix the seed in tests, log it in anything resembling production. Verify Monte Carlo answers against a deterministic oracle on small inputs, and verify Las Vegas answers are *always* correct (the count of attempts may vary, the answer may not).
> Recurring anchors: Monte Carlo error scales like `1/√N`; one-sided amplification gives error `ε^k`; a retry loop with per-try success `p` takes expected `1/p` attempts and exceeds `t` attempts with probability `(1-p)^t`.

---

## Beginner Tasks (5)

### Task 1 — Monte Carlo π with a seeded RNG

**Problem.** Implement `estimatePi(rng, n)` that throws `n` darts into the unit square and returns `4 × inside/n`. Print the estimate and absolute error vs π for `n ∈ {1e3, 1e5, 1e6}`.

**Constraints.** Inject the RNG (Go `*rand.Rand`, Java `Random`, Python `random.Random`); same seed → same output.

**Hint.** A dart `(x, y)` with `x, y ∈ [0,1)` is inside the quarter-circle iff `x² + y² ≤ 1`.

**Evaluation criteria.**
- Error roughly halves when `n` quadruples (the `1/√N` law).
- Re-running with the same seed reproduces identical numbers.
- Exactly `n` iterations — fixed time (Monte Carlo).

---

### Task 2 — Las Vegas: roll until a target

**Problem.** Implement `rollUntil(rng, target)` that rolls a fair die `[1,6]` until it shows `target`, returning the number of rolls. Run it `100000` times and print the average (should approach `6`).

**Constraints.** `1 ≤ target ≤ 6`. The returned run *always* ends on `target` (correctness is not probabilistic).

**Hint.** Each roll succeeds with `p = 1/6`; expected rolls `= 1/p = 6`.

**Evaluation criteria.**
- Average over many trials is within ~1% of `6`.
- The function returns only when the die equals `target`.
- Loop terminates with probability 1.

---

### Task 3 — Classify the paradigm

**Problem.** Write `classify(name)` returning `"Monte Carlo"` or `"Las Vegas"` for: `"pi-darts"`, `"roll-until-six"`, `"randomized-quickselect"`, `"miller-rabin"`, `"freivalds"`, `"treap-insert"`. Print each with a one-line justification.

**Constraints.** Pure logic / lookup; no RNG needed.

**Hint.** Ask "is the running time fixed or the correctness fixed?" Fixed time + maybe-wrong = Monte Carlo; always-correct + random time = Las Vegas.

**Evaluation criteria.**
- pi-darts, miller-rabin, freivalds → Monte Carlo.
- roll-until-six, randomized-quickselect, treap-insert → Las Vegas.
- Each justification names which guarantee is fixed.

---

### Task 4 — Empirical `1/√N` error curve

**Problem.** For `N ∈ {1e2, 1e3, 1e4, 1e5, 1e6}`, estimate π `R = 30` times each, and print `N` alongside the mean absolute error. Confirm the error drops by ~√10 ≈ 3.16× per 10× increase in `N`.

**Constraints.** Inject the RNG; average over the `R` repeats to smooth the wobble.

**Hint.** Mean absolute error `≈ c/√N`; plotting log-error vs log-N gives slope ≈ −1/2.

**Evaluation criteria.**
- Error decreases monotonically (on average) as `N` grows.
- Ratio of consecutive errors ≈ 3.16.
- Output is a clean table of `N` vs mean error.

---

### Task 5 — One-sided amplification counter

**Problem.** Implement `roundsForError(epsSingle, target)` returning the smallest `k` with `epsSingle^k ≤ target`. Print `k` for `(epsSingle, target)` pairs `(0.25, 1e-6)`, `(0.5, 1e-9)`, `(0.25, 2^-128)`.

**Constraints.** `0 < epsSingle < 1`, `0 < target < 1`.

**Hint.** `k = ceil(log(target) / log(epsSingle))`.

**Evaluation criteria.**
- `(0.25, 1e-6) → 10`, `(0.5, 1e-9) → 30`, `(0.25, 2^-128) → 64`.
- Result is an integer and actually satisfies `epsSingle^k ≤ target`.
- Demonstrates amplification is logarithmic in the target.

---

## Intermediate Tasks (5)

### Task 6 — Las Vegas → Monte Carlo by truncation

**Problem.** Given a Las Vegas routine `work(rng)` whose cost (number of internal steps) is random, implement `truncated(rng, deadline)` that runs `work` for at most `deadline` steps; if it finishes, return its correct answer, else return a fallback flagged as a guess. Empirically measure the error rate (fraction of guesses) and compare to the Markov bound `E[T]/deadline`.

**Constraints.** Model `work` so its step count is geometric (success prob `p`), giving `E[T] = 1/p`.

**Hint.** Set `deadline = E[T]/ε` for a target error `ε`; the measured guess rate should be `≤ ε`.

**Evaluation criteria.**
- Measured guess rate ≤ `E[T]/deadline`.
- Larger `deadline` → fewer guesses (lower error).
- The non-guessed answers are always correct.

---

### Task 7 — Monte Carlo → Las Vegas by verification

**Problem.** Implement `lasVegasFromMC(rng, mc, verify)` that calls a Monte Carlo producer `mc(rng)` and a checker `verify(ans)`, retrying until `verify` passes; return `(answer, attempts)`. Use a toy `mc` that returns a correct value with probability `p` and a wrong value otherwise. Verify the answer is always correct and the average attempts ≈ `1/p`.

**Constraints.** `verify` must be cheap and deterministic.

**Hint.** This is the MC→LV conversion; it works only because a verifier exists.

**Evaluation criteria.**
- Returned answer always passes `verify`.
- Average attempts ≈ `1/p`.
- Note (in a comment) why this fails without a verifier (e.g. Miller-Rabin "prime").

---

### Task 8 — Two-sided majority amplification

**Problem.** Given a noisy boolean oracle `oracle(rng)` that returns the true answer with probability `1/2 + δ`, implement `majority(rng, oracle, k)` that returns the majority of `k` calls. Empirically measure the error rate vs `k` for `δ = 1/6` and confirm it decays roughly like `e^{-2δ²k}`.

**Constraints.** `k` odd to avoid ties; `δ > 0`.

**Hint.** Compare with the one-sided case: two-sided needs the majority and a gap `δ`; the error decays exponentially but slower than `ε^k`.

**Evaluation criteria.**
- Error decreases as `k` grows.
- Observed error ≲ `e^{-2δ²k}` (within sampling noise).
- A short note contrasts this with one-sided `ε^k`.

---

### Task 9 — Randomized quickselect (Las Vegas)

**Problem.** Implement `quickselect(rng, a, k)` returning the `k`-th smallest element (0-indexed) using a random pivot. Validate against a sort-based oracle on 1000 random arrays. Track and print the average number of comparisons; confirm it is `O(n)`.

**Constraints.** Always correct; expected `O(n)` time. Do not mutate the caller's array unexpectedly (copy or document).

**Hint.** Random pivot → "good" split with prob ≥ 1/2 → expected linear time. Compare `< pivot`, `> pivot`, `== pivot` buckets.

**Evaluation criteria.**
- Matches the sort-based oracle on every test.
- Average comparisons scale linearly with `n` (roughly `~3.4n`), not `n log n`.
- Works for `k = 0` (min), `k = n-1` (max), and the median.

---

### Task 10 — Las Vegas retry with a cap and fallback

**Problem.** Implement `cappedRetry(rng, attempt, fallback, cap)` that retries a random `attempt` up to `cap` times, then returns a deterministic `fallback`. Compute the cap from a tail target: `cap = ceil(log(δ)/log(1-p))`. Verify empirically that the fallback fires at most a fraction `δ` of the time.

**Constraints.** `0 < p < 1`, `0 < δ < 1`. The returned value is always valid.

**Hint.** `P[> cap attempts] = (1-p)^cap ≤ δ`. This is the SLA guardrail from `senior.md`.

**Evaluation criteria.**
- Fallback rate ≤ `δ` empirically.
- The returned value is always valid (fast path or fallback).
- `cap` is derived from `(p, δ)`, not hard-coded.

---

## Advanced Tasks (5)

### Task 11 — Freivalds' matrix-product check (one-sided MC, amplified)

**Problem.** Implement `freivalds(rng, A, B, C, k)` that returns `true` (probably `A·B = C`) or `false` (certainly `A·B ≠ C`) using `k` random 0/1 vectors, each round `O(n²)`. Test on correct and corrupted `C` matrices; confirm a corrupted `C` is caught with high probability.

**Constraints.** Draw a fresh random vector each round (independence). `n×n` integer matrices.

**Hint.** Check `A·(B·r) = C·r`; a single mismatch proves inequality (a certificate). Error after `k` rounds `≤ 2^{-k}`.

**Evaluation criteria.**
- Correct `C` returns `true` for any `k`.
- Corrupted `C` returns `false` with probability ≥ `1 - 2^{-k}`.
- Each round is `O(n²)` (no `O(n³)` product computed).

---

### Task 12 — Monte Carlo integration with a confidence interval

**Problem.** Estimate `∫₀¹ f(x) dx` for a given `f` by sampling `N` points; also compute the sample standard error `s/√N` and report a 95% confidence interval (`estimate ± 1.96·s/√N`). Test on `f(x) = x²` (true value `1/3`) and confirm the true value lies in the interval ~95% of the time over many runs.

**Constraints.** Use the running mean/variance (Welford) or a two-pass formula.

**Hint.** This is two-sided Monte Carlo with a *quantified* error; the CI width shrinks like `1/√N`.

**Evaluation criteria.**
- Estimate converges to `1/3` for `f(x)=x²`.
- Coverage of the 95% CI is ≈ 95% over ≥ 200 independent runs.
- CI width halves when `N` quadruples.

---

### Task 13 — Reproducibility and replay harness

**Problem.** Build a harness that (a) runs a randomized routine with a seed drawn from entropy, (b) logs `{seed, outcome, attempts}`, and (c) given a logged seed, *replays* the exact run and reproduces the identical outcome. Demonstrate replay of a "rare" event (e.g. a Las Vegas run that took ≥ 10 attempts).

**Constraints.** All randomness must flow through the one seeded RNG; no hidden calls to the global default.

**Hint.** Replay = re-seed with the logged seed and re-run the deterministic step generator. If anything draws from the global RNG, replay breaks.

**Evaluation criteria.**
- Replaying a logged seed reproduces the outcome bit-for-bit (within one language).
- The harness detects/forbids use of the global RNG.
- A note explains why the same seed gives *different* streams across Go/Java/Python.

---

### Task 14 — Distributed randomness: correlation vs agreement

**Problem.** Simulate `R` replicas each routing `M` requests. Implement two strategies for picking a backend out of `B`: (a) **per-replica RNG seeded from a shared constant** (the bug), and (b) **per-replica RNG seeded from entropy** (the fix). Plot/print the load distribution across backends. Then show a third case: **deterministic hashing of the key** when all replicas must agree on the same backend per key.

**Constraints.** `R, B ≥ 4`, `M ≥ 1000`.

**Hint.** Shared seed → every replica picks the *same* sequence → hot backend. Entropy seeds → even load. Hashing → consistent per-key routing (not random).

**Evaluation criteria.**
- The shared-seed case produces a visibly skewed (hot-backend) load.
- The entropy-seed case produces near-uniform load.
- The hashing case routes each key to the *same* backend across all replicas (agreement, not divergence).

---

### Task 15 — Paradigm-selection advisor

**Problem.** Implement `recommend(deadline_hard, error_tolerable, has_cheap_checker, adversarial)` returning one of: `"MONTE_CARLO"`, `"LAS_VEGAS"`, `"TRUNCATED_LAS_VEGAS_HYBRID"`, plus the RNG choice (`"fast"` or `"CSPRNG"`) and a one-line justification. Encode the decision tree from `senior.md`.

**Constraints / cases.**
- hard deadline + error tolerable → `MONTE_CARLO`.
- no hard deadline + cheap checker → `LAS_VEGAS`.
- hard deadline + error NOT tolerable + cheap checker → `TRUNCATED_LAS_VEGAS_HYBRID`.
- `adversarial = true` → RNG must be `CSPRNG` regardless.

**Hint.** Name the hard constraint first; when both deadline and correctness are hard, the hybrid (truncated Las Vegas + deterministic fallback) is the answer.

**Evaluation criteria.**
- Correctly classifies all four canonical cases.
- The adversarial flag always forces `CSPRNG`.
- Justification references the right guarantee (bounded time vs always-correct vs hybrid) and, where relevant, the SLA derivation (`k`, retry cap).

---

## Benchmark Task

### Task B — Monte Carlo work vs Las Vegas tail

**Problem.** Two micro-benchmarks across Go/Java/Python on a seeded RNG:

- **(a) Monte Carlo cost vs accuracy:** measure wall-clock time and absolute π error for `N ∈ {1e4, 1e5, 1e6, 1e7}`. Show that time grows linearly with `N` while error falls like `1/√N` (so accuracy is *expensive*).
- **(b) Las Vegas attempt distribution:** for a retry loop with `p ∈ {1/2, 1/6, 1/20}`, run `1e5` trials and report mean attempts (≈ `1/p`), p99 attempts, and max attempts. Show the tail `P[>t] = (1-p)^t` matches the empirical fraction.

**Starter — Python.**
```python
import math
import random
import time


def estimate_pi(rng, n):
    inside = 0
    for _ in range(n):
        x, y = rng.random(), rng.random()
        if x * x + y * y <= 1.0:
            inside += 1
    return 4.0 * inside / n


def retry_attempts(rng, p):
    a = 0
    while True:
        a += 1
        if rng.random() < p:
            return a


def main():
    rng = random.Random(99)
    print("(a) Monte Carlo: N  time_ms  abs_error")
    for n in (10_000, 100_000, 1_000_000):
        t0 = time.perf_counter()
        est = estimate_pi(rng, n)
        ms = (time.perf_counter() - t0) * 1000
        print(f"    {n:<9} {ms:8.2f} {abs(est - math.pi):.5f}")

    print("(b) Las Vegas: p  mean  p99  max")
    for p in (0.5, 1 / 6, 1 / 20):
        xs = sorted(retry_attempts(rng, p) for _ in range(100_000))
        mean = sum(xs) / len(xs)
        p99 = xs[int(0.99 * len(xs))]
        print(f"    {p:.3f}  {mean:6.3f}  {p99:4d}  {xs[-1]:4d}  (1/p={1/p:.2f})")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same seed → same numbers within each language.
- (a) Monte Carlo time ∝ `N`; error ∝ `1/√N` (10× more work ≈ 3.16× less error).
- (b) Mean attempts ≈ `1/p`; the empirical `P[>t]` matches `(1-p)^t`; the max grows as `p` shrinks (heavier tail).
- A short writeup: Monte Carlo "pays time for accuracy," Las Vegas "pays a variable tail for guaranteed correctness."

---

## General Guidance for All Tasks

- **Inject and seed the RNG.** Never reach for the global default from reusable code; pass an RNG (or seed) in. Fix the seed in tests, log it in anything production-like.
- **Validate Monte Carlo against an oracle on small inputs**, then trust it on large ones; validate Las Vegas correctness *always* (only the attempt count may vary).
- **Match the combination rule to the error model.** One-sided → trust any certificate (`ε^k`). Two-sided → majority vote (Chernoff). Mixing them up *raises* error.
- **Size the work to the requirement.** Derive Monte Carlo rounds `k` from the target error, and Las Vegas retry caps `t` from the tail target `δ`; over-provisioning randomness wastes work.
- **Cap Las Vegas tails with a deterministic fallback** when there is a latency budget.
- **Use a CSPRNG on adversarial paths**; a predictable PRNG lets an attacker force the worst case.
- **Distinguish "random" from "agreed."** Independent randomness to *diverge* (spread load); deterministic hashing to *agree* (route a key consistently).

Each task must be implemented and tested in **Go, Java, and Python**, producing consistent results on the same seed within each language.
