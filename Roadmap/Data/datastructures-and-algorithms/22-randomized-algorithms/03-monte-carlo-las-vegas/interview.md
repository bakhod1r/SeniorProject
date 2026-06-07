# Monte Carlo vs Las Vegas Randomized Algorithms — Interview Preparation

> **How to use this file.** Questions are grouped into four tiers — **Junior**, **Middle**, **Senior**, **Professional** — mirroring the four level files. Each question has a concise "expected answer focus" so you can self-check. Aim to answer a tier comfortably before moving up. The file closes with a **coding challenge** (Monte Carlo π estimation + a Las Vegas retry algorithm) implemented in Go, Java, and Python.
>
> **The one-line anchor for the whole topic:** *Monte Carlo = fixed time, maybe-wrong answer; Las Vegas = always-right answer, random time.* Almost every question reduces to "which guarantee is fixed and which one wobbles?"
>
> **How to read the tiers.** Junior tests the definitions and the two flagship examples (π darts, retry-until-success). Middle tests *how* error behaves (one-sided vs two-sided, amplification) and the two conversions. Senior tests *operating* randomized code under an SLA (error budgets, tail latency, seeding, distributed correlation). Professional tests *rigor* (the RP/ZPP/BPP classes, Chernoff, expected-time proofs, derandomization). The same handful of facts — `1/√N`, `1/p`, `ε^k`, `(1-p)^t` — reappear at every tier in a deeper form.

---

## Table of Contents

1. [Junior Questions (Q1–Q12)](#junior-questions)
2. [Middle Questions (Q13–Q26)](#middle-questions)
3. [Senior Questions (Q27–Q38)](#senior-questions)
4. [Professional Questions (Q39–Q48)](#professional-questions)
5. [Scenario / Whiteboard Questions](#scenario--whiteboard-questions)
6. [Common Mistakes Interviewers Probe](#common-mistakes-interviewers-probe)
7. [Rapid-Fire One-Liners](#rapid-fire-one-liners)
8. [Worked Long-Form Answers](#worked-long-form-answers)
9. [Mock Interview Flow](#mock-interview-flow)
10. [Coding Challenge (3 Languages)](#coding-challenge)

---

## Junior Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | What is a randomized algorithm? | An algorithm that uses random numbers (coin flips) during execution, so its behaviour can differ run to run on the same input. |
| 2 | Define Monte Carlo and Las Vegas in one sentence each. | Monte Carlo: bounded time, answer may be wrong with small probability. Las Vegas: always correct, but running time is random. |
| 3 | Give the slogan that distinguishes them. | "Monte Carlo: fast but maybe wrong; Las Vegas: always right but maybe slow." MC fixes time; LV fixes correctness. |
| 4 | Why use randomness at all? | Speed (accept tiny error to go much faster), simplicity (shorter than the clever deterministic version), and beating adversarial worst-case inputs (coins are hidden). |
| 5 | How does the π-dart estimator work? | Throw `N` random darts in a unit square; the fraction inside the quarter-circle (radius 1, area π/4) times 4 estimates π. Fixed `N` throws, approximate answer → Monte Carlo. |
| 6 | Is "roll a die until you get a 6" Monte Carlo or Las Vegas? | Las Vegas: the result is always a 6 (correct), but the number of rolls is random. |
| 7 | What is the error probability of a Monte Carlo algorithm? | The chance it returns a wrong answer; we want it small and it is tunable by doing more work. |
| 8 | What is "expected running time"? | The average running time over the algorithm's own coin flips, with the input fixed. |
| 9 | Roughly how does the π estimate's error shrink with `N`? | Like `1/√N` — to get one more decimal digit you need ~100× more darts (diminishing returns). |
| 10 | Does a "retry until success" loop ever finish? | Yes, with probability 1, as long as each try succeeds with some `p > 0`; on average it takes `1/p` tries. |
| 11 | What is a seed and why does it matter? | A starting value for the RNG; the same seed reproduces the same "random" sequence, which is essential for reproducing bugs and writing deterministic tests. |
| 12 | Why does the π estimate change between two runs? | Because the random darts differ each run — that variability is the Monte Carlo "wobble." |

**Junior deep-dives**

- **Q5 follow-up — why area π/4?** A uniformly random point in the unit square lands inside the quarter-circle with probability = (area of quarter-circle)/(area of square) = `(π/4)/1`. So `4 × fraction_inside ≈ π`.
- **Q10 follow-up — expected tries for `p = 1/6`?** `1/p = 6`. The number of attempts is geometric; `(1-p)^k` is the chance of `k` failures in a row, which → 0.
- **Q11 follow-up — when do you *not* want a fixed seed?** In production, where you want fresh, independent randomness each run; fixed seeds are for tests and replay.

---

## Middle Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 13 | What is the difference between one-sided and two-sided error? | One-sided: the algorithm can only be wrong in one direction (one answer is a certificate). Two-sided: it can be wrong either way. |
| 14 | Why is Miller-Rabin one-sided? | A "composite" verdict is backed by a witness (always correct); "probably prime" can be wrong. |
| 15 | How do you amplify a one-sided Monte Carlo algorithm? | Repeat `k` times and trust *any* certain answer; error drops to `ε^k`. Do NOT majority-vote. |
| 16 | How do you amplify a two-sided one? | Repeat `k` times and take the **majority**; error drops like `e^{-Θ(δ²k)}` (Chernoff), needing a gap `δ > 1/2`. |
| 17 | What happens if you vote a one-sided test or AND a two-sided test? | You waste the certificate / get a logically wrong combination — error can *increase*. The combination rule must match the error model. |
| 18 | "Expected `O(n log n)`" is averaged over what? | The algorithm's random coins, for a *fixed* input — not over random inputs (that is average-case analysis). |
| 19 | Why does randomized quicksort beat fixed-pivot quicksort? | The deterministic version has a worst-case input (sorted data); the randomized version is expected `O(n log n)` on *every* input because the adversary cannot see the pivots. |
| 20 | Convert a Las Vegas algorithm to Monte Carlo. | Truncate it at a deadline `D`; if unfinished, output a guess. Error `≤ E[T]/D` (Markov). |
| 21 | Convert a Monte Carlo algorithm to Las Vegas. | Verify the output with a cheap checker; retry on failure. Always correct, expected `1/p` runs. Requires a verifier. |
| 22 | What is the dividing line for the MC→LV conversion? | Verifiability — you must be able to cheaply check a candidate answer. |
| 23 | What is Freivalds' algorithm and why is it a win? | Checks `A·B = C` by testing `A(Br) = Cr` for a random 0/1 vector `r` in `O(n²)` instead of recomputing `A·B` in `O(n³)`; one-sided, error `≤ 2^{-k}` after `k` rounds. |
| 24 | What two tools bound Las Vegas expected time? | The geometric mean `1/p` for retry loops, and linearity of expectation for sums of (even dependent) costs. |
| 25 | How many rounds to push a `1/4`-error one-sided test below `10^{-12}`? | `(1/4)^k ≤ 10^{-12}` → `k ≈ 20`. Amplification is logarithmic in the target error. |
| 26 | Expected vs worst-case time for randomized quicksort? | Expected `O(n log n)` on every input; `O(n²)` worst case exists but only for astronomically unlucky coin sequences. |

**Middle deep-dives**

- **Q15 vs Q16 — why the asymmetry?** One-sided has a certificate, so a single certain answer settles it (`ε^k`). Two-sided has no certificate, so you must vote, and voting needs the runs to be *better than a coin flip* (`δ > 0`), giving the weaker `e^{-Θ(δ²k)}`.
- **Q19 follow-up — average-case vs randomized.** Average-case fixes the algorithm and randomizes the *input* — an adversary can still hand a bad input. Randomized fixes the input and randomizes the *coins* — the guarantee holds for *every* input.
- **Q20 follow-up — why Markov, not Chernoff?** Markov needs only `E[T]`, which is all you are given; it is the weakest but most general tail bound.

---

## Senior Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 27 | How do you choose the paradigm for a production component? | Name the hard constraint first: hard deadline + tolerable error → Monte Carlo; mandatory correctness + cheap check → Las Vegas; both hard → truncated Las Vegas (hybrid). |
| 28 | Derive the number of Monte Carlo rounds from an SLA. | `k ≥ log(target)/log(ε₁)`. e.g. `ε₁=1/4`, target `1e-9` → `k ≈ 15`. Make it a tested, commented constant. |
| 29 | How do you bound a Las Vegas component's tail latency? | `P[>t attempts] = (1-p)^t`; pick a retry cap `t` with `(1-p)^t ≤ δ`, plus a deterministic fallback so the tail is bounded. |
| 30 | How do error budgets compose across components? | Union bound: total error `≤ Σ εᵢ`. Allocate the SLA error budget across components like a latency budget across hops. |
| 31 | How do you make randomized code reproducible without making it predictable? | Inject one seeded RNG; log the seed of any op that can fail; fixed seeds in tests, entropy seeds in prod, CSPRNG on adversarial paths. |
| 32 | What goes wrong if all replicas share a seed? | Correlated coins: every replica "randomly" picks the same backend/pivot/shard — hot shard, defeated "power of two choices." Seed per process from entropy. |
| 33 | When should nodes use a deterministic hash instead of an RNG? | When they must *agree* (route a key to the same shard) — use consistent hashing. Use independent randomness only when they must *diverge* (spread load). |
| 34 | What is the thundering-herd problem and the randomized fix? | Synchronized retries spike load; add jitter (randomized backoff) so retries spread out. |
| 35 | How do you monitor a Monte Carlo component's error rate without a full oracle? | Shadow-verify a sample of traffic with the expensive deterministic check; the disagreement rate estimates `ε`. Alert on its upper confidence bound. |
| 36 | What metric matters for a Las Vegas loop, and why not the mean? | The retry-count histogram (p99) and timeout rate — an SLA cares about the tail; a drifting mean signals `p` is degrading before the tail breaches. |
| 37 | Why use a CSPRNG on adversarial paths? | A predictable PRNG lets an attacker force the worst case (quicksort `O(n²)`, repeated primality base). CSPRNG hides the coins. |
| 38 | Describe the truncated-Las-Vegas hybrid pattern. | Run a Las Vegas core under a deadline; on timeout emit a deterministic fallback / flagged estimate. Gives both a correctness guarantee and a latency bound; error = timeout rate ≤ `E[T]/D`. |

**Senior deep-dives**

- **Q31 follow-up — cross-language seeds.** The same integer seed gives *different* streams in Go/Java/Python; for bit-identical cross-language fixtures, implement a shared explicit PRNG (LCG/xorshift).
- **Q33 — the trap.** "Random" and "agreed" are opposite requirements; mixing them up causes either hot shards (used RNG where you needed agreement) or lockstep (used hashing where you needed divergence).
- **Q35 follow-up — one-sided certificate-rate monitoring.** A one-sided MC that suddenly stops producing certificates may have a broken RNG (always drawing the same base) — track the certain-outcome rate.

---

## Professional Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 39 | Define RP, co-RP, ZPP, BPP. | RP: one-sided (never accept a "no", accept "yes" w.p. ≥ 1/2). co-RP: complement. ZPP: zero error, expected poly time (Las Vegas). BPP: two-sided, correct w.p. ≥ 2/3. |
| 40 | Which class is Las Vegas? Which is one-sided / two-sided Monte Carlo? | Las Vegas = ZPP; one-sided MC = RP/co-RP; two-sided MC = BPP. |
| 41 | State and apply the Chernoff bound for majority amplification. | `Pr[X ≤ (1-γ)μ] ≤ e^{-μγ²/2}`; for gap `δ`, majority error `≤ e^{-Θ(δ²k)}`, so `k = O(t/δ²)` for error `2^{-t}`. |
| 42 | Why is one-sided amplification cheaper than two-sided? | One-sided trusts a certificate: error `(1-p)^k`, `O(t)` runs, no gap needed. Two-sided needs majority + a gap `δ`, paying a `1/δ²` factor. |
| 43 | Prove the geometric retry expectation `E[T] = 1/p`. | `E[T] = Σ t(1-p)^{t-1}p = p/(1-(1-p))² = 1/p` via the derivative-of-geometric-series identity. |
| 44 | Prove randomized quicksort's expected comparison count. | Indicators `X_{ij}`; `Pr[z_i,z_j compared] = 2/(j-i+1)`; by linearity `E[X] = Σ 2/(j-i+1) = 2n ln n + O(n)`. |
| 45 | Prove the Las Vegas → Monte Carlo conversion bound. | Truncate at `D`; error `= Pr[T>D] ≤ E[T]/D` by Markov; choose `D = E[T]/ε`. |
| 46 | State and sketch ZPP = RP ∩ co-RP. | (⊆) truncate ZPP, default reject → RP, default accept → co-RP. (⊇) run M_RP and M_coRP in a loop, commit on whichever fires its certificate; expected ≤ 2 rounds. |
| 47 | What is the method of conditional expectations? | Fix random bits one at a time, each time choosing the value keeping the conditional expectation ≥ the target; yields a deterministic solution at least as good as the random average (e.g. MAX-CUT ≥ m/2). |
| 48 | Is randomness essential? State the BPP vs P conjecture. | Conjecturally `BPP = P` under circuit-lower-bound hypotheses (Impagliazzo–Wigderson): strong PRGs derandomize BPP. Randomness is then a convenience, not an essential resource for decision problems. |

**Professional deep-dives**

- **Q41 follow-up — why does `δ = 0` break it?** With no gap, the majority of fair coins is correct with prob → 1/2; no repetition helps. This is why PP (gap `2^{-n}`) is not poly-amplifiable while BPP (constant gap) is.
- **Q44 follow-up — why does linearity not need independence?** `E[ΣX_{ij}] = ΣE[X_{ij}]` holds for *any* random variables; the `X_{ij}` are dependent, but we never multiply them.
- **Q48 follow-up — pairwise independence.** Many proofs use only pairwise independence, generatable from `O(log n)` bits, so all `poly(n)` seeds can be enumerated — a concrete, unconditional derandomization for those algorithms.

---

## Scenario / Whiteboard Questions

These are the "design / reason it through" questions that interviewers use to separate memorization from understanding. Talk through the reasoning out loud.

### S1 — "You have a 10 ms budget to score ad relevance. Exact scoring takes 40 ms. What do you do?"

**Strong answer.** The hard constraint is the **deadline**, and an approximate score is acceptable for ranking, so this is a **Monte Carlo** fit: sample a subset of features/candidates and return an estimate within the budget. Size the sample so the estimate's standard error (`~1/√N`) is small enough that the *ranking* is stable. Add a fallback: if even the sample cannot finish (e.g. a slow feature store), return a cached or default score rather than miss the deadline. Monitor a shadow-verified error rate against full scoring on 1% of traffic.

### S2 — "Implement quickselect that an adversary cannot force into O(n²)."

**Strong answer.** Use a **random pivot** (Las Vegas): expected `O(n)` on *every* input because the adversary cannot see the coins. Crucially, draw the pivot from a **CSPRNG** on any path where the input is attacker-controlled — a predictable PRNG lets the adversary reconstruct the pivot sequence and rebuild the worst case. The answer is always correct; only the time is random, and the `O(n²)` tail is astronomically unlikely (Chernoff on the recursion depth).

### S3 — "A Las Vegas routine occasionally takes 50× its average time and blows our p99 SLA. Fix it."

**Strong answer.** The mean is fine; the **tail** is the problem (`P[>t attempts] = (1-p)^t`). Two moves: (1) **cap the retries** at `t = ceil(log δ / log(1-p))` so at most a fraction `δ` of requests hit the cap, and back the cap with a **deterministic fallback** that is slower but guaranteed — this is the Las Vegas → Monte Carlo truncation used as an SLA guardrail. (2) Investigate whether `p` itself has degraded (more contention, a flaky backend); a drifting retry-count histogram is the early warning. Also add **jitter** if many clients retry in lockstep (thundering herd).

### S4 — "Two service replicas both run 'power of two random choices' load balancing, yet one backend is always hot. Why?"

**Strong answer.** Almost certainly **correlated coins**: the replicas share a seed (baked into the image or config), so they draw the *same* "random" backends in lockstep — defeating the independence the algorithm relies on. Fix: seed each process from high entropy (PID + hostname + nanotime, or `crypto/rand`). If you also need replay, seed per-(replica, request) as `hash(replica_id, request_id)` — independent across replicas yet reproducible from logged ids.

### S5 — "When would you NOT convert a Monte Carlo algorithm to Las Vegas?"

**Strong answer.** When there is **no cheap verifier**. The MC→LV conversion is "produce → check → retry," and it only works if checking is cheap and correct. Miller-Rabin's "probably prime" has no cheap certificate (verifying primality independently is the hard part), so you cannot make it Las Vegas by retrying — you amplify instead. Sorting *does* have a linear checker, so randomized quicksort is naturally Las Vegas. Verifiability is the dividing line.

### S6 — "Estimate π to 4 correct decimal places with Monte Carlo. Feasible?"

**Strong answer.** Be honest about the `1/√N` law. The estimate's standard error is `≈ 1.64/√N`; for `~4` decimals you need error `~10^{-4}`, i.e. `N ≈ (1.64/10^{-4})² ≈ 2.7×10^8` darts *per* run, and even then any single run wobbles. Monte Carlo is excellent for a *rough, fast* π but a poor way to chase many digits — a deterministic series (e.g. Machin/Chudnovsky) is the right tool for precision. Knowing *when randomization is the wrong tool* is itself a senior signal.

### S7 — "Your randomized test is flaky in CI — fails ~1 run in 50. How do you debug it?"

**Strong answer.** Make it reproducible first. Inject a **seeded RNG** and **log the seed** on every run; when CI fails, the seed in the log replays the exact coin sequence locally and the "Heisenbug" becomes deterministic. If randomness leaks through a global default RNG anywhere, replay breaks — route *all* randomness through the one injected source. Separately, decide whether the flake is a real bug or an under-amplified Monte Carlo step whose error budget is too loose for CI (tighten `k`, or fix the seed in tests so the test is deterministic by construction).

---

## Common Mistakes Interviewers Probe

- **Swapping the definitions** — "Monte Carlo is always correct." It is the opposite; MC fixes *time*, LV fixes *correctness*.
- **Majority-voting a one-sided test** (or AND-ing a two-sided one) — wrong combination rule *raises* error.
- **Claiming a retry loop can hang forever** — it terminates with probability 1 for any `p > 0`, expected `1/p` tries.
- **Confusing expected with worst-case time** — a Las Vegas run *can* be slow; the guarantee is on the average and the (exponentially small) tail.
- **Saying "more samples removes all error"** — for an estimator, error shrinks like `1/√N` but never hits zero in finite time.
- **Forgetting the verifier** in MC→LV — "retry until success" is meaningless without a correctness check.
- **Ignoring reproducibility** — an unseeded randomized bug is the hardest kind to debug; seed and log.
- **Using a fast PRNG on an adversarial path** — invites a forced worst case; use a CSPRNG.

---

## Rapid-Fire One-Liners

- *MC fixes ___, LV fixes ___.* → time; correctness.
- *Amplify one-sided by ___; two-sided by ___.* → trusting any certificate; majority vote.
- *π error scales like ___.* → `1/√N`.
- *Retry loop expected tries = ___.* → `1/p`.
- *LV→MC uses ___; MC→LV needs ___.* → truncation (Markov); a verifier.
- *Las Vegas class = ___.* → ZPP.
- *`ZPP = ___ ∩ ___`.* → RP; co-RP.
- *Shared seed across replicas causes ___.* → correlated coins / hot shard.
- *Tail of a retry loop = ___.* → `(1-p)^t`.
- *Adversarial path RNG = ___.* → CSPRNG.

---

## Worked Long-Form Answers

A handful of questions deserve a full, spoken-aloud answer rather than a one-liner. These are the ones interviewers most often ask you to "go deeper" on.

### L1 — "Walk me through *why* the two paradigms exist at all."

Start from the trade-off. A deterministic algorithm gives you *both* a fixed running time *and* a guaranteed-correct answer — but it can have a worst-case input an adversary can hand you on purpose. Once you introduce randomness to escape that worst case (or to go faster), you can no longer hold *both* guarantees fixed *and* keep the speed benefit; something has to wobble. You then choose **which guarantee you cannot give up**:

- If the **deadline** is sacred (real-time systems, request budgets), you fix the running time and let the *answer* wobble — that is **Monte Carlo**. You pay for quality with more work, and the error shrinks as you amplify.
- If **correctness** is sacred (you must never return a wrong answer), you fix the answer and let the *time* wobble — that is **Las Vegas**. You retry random attempts until one verifiably works, paying a random number of tries.

So the two paradigms are not arbitrary categories; they are the two ways to spend the "something must wobble" budget. The slogan captures it: *Monte Carlo is fast but maybe wrong; Las Vegas is always right but maybe slow.*

### L2 — "Derive the expected number of rolls to see a 6, from scratch."

Each roll is independent and shows a 6 with probability `p = 1/6`. Let `T` be the number of rolls until the first 6. The probability the first success is on roll `t` is "fail `t-1` times, then succeed": `Pr[T = t] = (1-p)^{t-1} · p`. So

```text
E[T] = Σ_{t≥1} t · (1-p)^{t-1} · p.
```

Using the identity `Σ_{t≥1} t q^{t-1} = 1/(1-q)²` for `|q| < 1` with `q = 1-p`,

```text
E[T] = p · 1/(1-(1-p))² = p / p² = 1/p = 6.
```

That `1/p` is the workhorse bound for every Las Vegas retry loop: if each attempt succeeds with probability `p`, expect `1/p` attempts. The tail follows the same geometry: `Pr[T > t] = (1-p)^t`, which is exactly the formula a production retry-cap is sized against.

### L3 — "Prove randomized quicksort is O(n log n) expected without hand-waving."

Sort the values as `z₁ < … < z_n`. The only thing that costs time is *comparisons*. Define an indicator `X_{ij} = 1` if `z_i` and `z_j` are ever directly compared (for `i < j`). Total comparisons `X = Σ_{i<j} X_{ij}`, and by **linearity of expectation** — which needs no independence — `E[X] = Σ_{i<j} Pr[z_i, z_j compared]`.

Now the key observation: `z_i` and `z_j` are compared **iff** the first pivot chosen from the contiguous block `{z_i, …, z_j}` is either `z_i` or `z_j`. If some interior element is picked first, it separates them into different subarrays and they never meet; if an endpoint is picked first, they are compared exactly once. The block has `j - i + 1` elements, each equally likely to be the first pivot, so `Pr[compared] = 2/(j-i+1)`. Summing,

```text
E[X] = Σ_{i<j} 2/(j-i+1) ≤ 2n · H_n = 2n ln n + O(n) = O(n log n).
```

The answer is always correct (it is a real sort), so quicksort is a **Las Vegas** algorithm with expected `O(n log n)` — the variable being the time, never the correctness.

### L4 — "Explain ZPP = RP ∩ co-RP to someone who knows the paradigms but not the classes."

ZPP is the formal name for **Las Vegas** (zero error, expected-poly time). RP is **one-sided Monte Carlo** where *accept* is a certificate; co-RP is its mirror where *reject* is a certificate. The claim is that a Las Vegas algorithm is exactly the *intersection* of two complementary one-sided Monte Carlo algorithms.

One direction: take a Las Vegas algorithm and **truncate** it at twice its expected time. By Markov it finishes at least half the time; if it finishes you trust its answer, and if it times out you default to "reject" — that never wrongly accepts a "no," which is the RP condition. Defaulting to "accept" instead gives co-RP. The other direction: given an RP machine (accept = "yes" certificate) and a co-RP machine (reject = "no" certificate), loop running both; on each input, the correct side fires its certificate with probability `≥ 1/2`, so you commit to a *certainly correct* answer in expected `≤ 2` rounds — that is a Las Vegas algorithm. So the two one-sided tests, run until one produces its certificate, *are* the zero-error algorithm.

### L5 — "Is randomness fundamentally necessary, or just convenient?"

For *decision problems*, the prevailing belief is that it is mostly **convenient, not fundamental**. The conjecture `BPP = P` says every bounded-error randomized poly-time algorithm can be derandomized; it follows from plausible circuit-lower-bound assumptions (Impagliazzo–Wigderson) via pseudorandom generators that fool poly-time tests using a short seed you can enumerate. Concrete derandomizations already exist — the method of conditional expectations turns "expected good" into "deterministically good" (MAX-CUT ≥ m/2), and analyses relying only on pairwise independence run off `O(log n)` random bits, so all `poly(n)` seeds can be tried deterministically.

That said, randomness remains genuinely valuable in practice and essential elsewhere: it gives **simpler** algorithms, **constant-factor** speedups, and — operationally most important — it **defeats adversarial worst cases** because the adversary cannot see your coins. It is also irreplaceable in cryptography, interactive proofs, and sublinear sampling. So: probably not fundamental for *deciding* languages, but indispensable for *building robust systems*.

---

## Mock Interview Flow

A realistic 45-minute interview on this topic tends to escalate through the tiers. Here is a sample arc and what a strong candidate signals at each step.

1. **Opener (junior).** "What is the difference between Monte Carlo and Las Vegas?" — Answer with the slogan and the "which guarantee is fixed" framing. *Signal:* you understand the core trade-off, not just memorized labels.
2. **Concrete example (junior→middle).** "Code Monte Carlo π / a retry loop." — Write it cleanly with an **injected, seeded RNG**. *Signal:* you write reproducible randomized code by habit, not as an afterthought.
3. **Error model (middle).** "Your check can be wrong — how do you make it reliable?" — Distinguish one-sided (trust any certificate, `ε^k`) from two-sided (majority vote, Chernoff), and pick the right combination rule. *Signal:* you reason about *how* error behaves, not just *that* it exists.
4. **Conversion (middle→senior).** "Can you make this never-wrong / meet a deadline?" — Explain truncation (LV→MC, Markov) and verification (MC→LV, needs a checker). *Signal:* you can adapt a paradigm to changing requirements.
5. **Production (senior).** "Ship it behind a 99.9% SLA." — Derive `k` from the error budget, cap the Las Vegas tail with a fallback, inject + log the seed, use a CSPRNG on adversarial paths, and name the metric you would dashboard. *Signal:* you operate randomized systems, not just write them.
6. **Theory (professional).** "Place this in the complexity hierarchy / prove a bound." — Name RP/co-RP/ZPP/BPP, prove the geometric `1/p` or the quicksort `2n ln n`, and state `ZPP = RP ∩ co-RP`. *Signal:* you can be rigorous when it matters.

The candidates who stand out treat **reproducibility** and the **error/tail budget** as first-class from the very first line of code — these are the senior tells that separate "knows the definitions" from "has run this in production."

### Quick self-check before the interview

- Can you state the slogan and the "which guarantee is fixed" framing in one breath?
- Can you write Monte Carlo π and a Las Vegas retry from memory, with a seeded RNG, in your strongest language?
- Can you say *why* one-sided amplification (`ε^k`) beats two-sided (`e^{-Θ(δ²k)}`)?
- Can you derive the retry cap `t` from a tail target `δ`, and the round count `k` from an error budget?
- Can you explain the *one* precondition for MC→LV (a cheap verifier) and give an example where it fails (Miller-Rabin "prime")?
- Can you name the class for Las Vegas (ZPP) and state `ZPP = RP ∩ co-RP`?
- Can you give a real-system example for each paradigm (e.g. HyperLogLog / Bloom filter for Monte Carlo; randomized quickselect / leader-election backoff for Las Vegas)?
- Can you explain when randomization is the *wrong* tool (e.g. chasing many digits of π, where a deterministic series wins)?

If any answer is shaky, re-read the corresponding level file before the interview: `junior.md`/`middle.md` for the first three, `senior.md` for production, `professional.md` for the theory.

---

## Coding Challenge

> Implement both parts in **Go, Java, and Python**. Part A is a Monte Carlo algorithm (fixed work, approximate answer); Part B is a Las Vegas algorithm (always correct, random time). Both must run on an **injected, seeded RNG** so results are reproducible — exactly the discipline from `senior.md`.

### The problem

**Part A — Monte Carlo π estimation.** Write `estimatePi(rng, n)` that throws `n` random darts into the unit square and returns `4 × inside/n`. Report the estimate and its absolute error vs `math.Pi` for `n ∈ {1e3, 1e5, 1e7}`. The error should shrink roughly like `1/√n`.

**Part B — Las Vegas retry.** Write `lasVegasSample(rng, accept)` that repeatedly draws a uniform integer in `[1, 6]` and returns the first draw that satisfies a predicate `accept` (e.g. "≥ 5"), together with the number of attempts. The returned value is always valid (Las Vegas); the attempt count is random. Run it `100000` times and verify the average attempt count converges to `1/p` (for "≥ 5", `p = 2/6 = 1/3`, so ≈ 3).

### Go

```go
package main

import (
	"fmt"
	"math"
	"math/rand"
)

// --- Part A: Monte Carlo pi (fixed n darts, approximate answer) ---
func estimatePi(rng *rand.Rand, n int) float64 {
	inside := 0
	for i := 0; i < n; i++ {
		x, y := rng.Float64(), rng.Float64()
		if x*x+y*y <= 1.0 {
			inside++
		}
	}
	return 4.0 * float64(inside) / float64(n)
}

// --- Part B: Las Vegas retry (always valid value, random attempts) ---
func lasVegasSample(rng *rand.Rand, accept func(int) bool) (int, int) {
	attempts := 0
	for {
		attempts++
		v := rng.Intn(6) + 1 // [1,6]
		if accept(v) {
			return v, attempts // value is ALWAYS valid; attempts is random
		}
	}
}

func main() {
	rng := rand.New(rand.NewSource(2024)) // injected, seeded -> reproducible

	fmt.Println("Part A — Monte Carlo pi:")
	for _, n := range []int{1000, 100000, 10000000} {
		est := estimatePi(rng, n)
		fmt.Printf("  n=%-9d est=%.5f err=%.5f\n", n, est, math.Abs(est-math.Pi))
	}

	fmt.Println("Part B — Las Vegas retry (accept v >= 5, p = 1/3):")
	accept := func(v int) bool { return v >= 5 }
	const trials = 100000
	total := 0
	for i := 0; i < trials; i++ {
		_, a := lasVegasSample(rng, accept)
		total += a
	}
	fmt.Printf("  avg attempts = %.3f (theory 1/p = 3.000)\n",
		float64(total)/float64(trials))
}
```

### Java

```java
import java.util.Random;
import java.util.function.IntPredicate;

public class RandomizedChallenge {
    // Part A: Monte Carlo pi — fixed n darts, approximate answer.
    static double estimatePi(Random rng, int n) {
        int inside = 0;
        for (int i = 0; i < n; i++) {
            double x = rng.nextDouble(), y = rng.nextDouble();
            if (x * x + y * y <= 1.0) inside++;
        }
        return 4.0 * inside / n;
    }

    // Part B: Las Vegas retry — value always valid, attempts random.
    static int[] lasVegasSample(Random rng, IntPredicate accept) {
        int attempts = 0;
        while (true) {
            attempts++;
            int v = rng.nextInt(6) + 1;
            if (accept.test(v)) return new int[]{v, attempts};
        }
    }

    public static void main(String[] args) {
        Random rng = new Random(2024); // injected, seeded -> reproducible

        System.out.println("Part A — Monte Carlo pi:");
        for (int n : new int[]{1000, 100000, 10000000}) {
            double est = estimatePi(rng, n);
            System.out.printf("  n=%-9d est=%.5f err=%.5f%n",
                    n, est, Math.abs(est - Math.PI));
        }

        System.out.println("Part B — Las Vegas retry (accept v >= 5, p = 1/3):");
        IntPredicate accept = v -> v >= 5;
        int trials = 100000;
        long total = 0;
        for (int i = 0; i < trials; i++) total += lasVegasSample(rng, accept)[1];
        System.out.printf("  avg attempts = %.3f (theory 1/p = 3.000)%n",
                (double) total / trials);
    }
}
```

### Python

```python
import math
import random


# Part A: Monte Carlo pi — fixed n darts, approximate answer.
def estimate_pi(rng, n):
    inside = 0
    for _ in range(n):
        x, y = rng.random(), rng.random()
        if x * x + y * y <= 1.0:
            inside += 1
    return 4.0 * inside / n


# Part B: Las Vegas retry — value always valid, attempts random.
def las_vegas_sample(rng, accept):
    attempts = 0
    while True:
        attempts += 1
        v = rng.randint(1, 6)
        if accept(v):
            return v, attempts


if __name__ == "__main__":
    rng = random.Random(2024)  # injected, seeded -> reproducible

    print("Part A — Monte Carlo pi:")
    for n in (1000, 100_000, 10_000_000):
        est = estimate_pi(rng, n)
        print(f"  n={n:<9} est={est:.5f} err={abs(est - math.pi):.5f}")

    print("Part B — Las Vegas retry (accept v >= 5, p = 1/3):")
    accept = lambda v: v >= 5
    trials = 100_000
    total = sum(las_vegas_sample(rng, accept)[1] for _ in range(trials))
    print(f"  avg attempts = {total / trials:.3f} (theory 1/p = 3.000)")
```

### Part C (follow-up) — one-sided amplification

A frequent live extension: "now make a *one-sided* Monte Carlo and amplify it." Implement `oneSidedCheck(rng, isYes, k)` for a property where a single round catches a "no" with probability `≥ 1/2` and never falsely flags a "yes." Running `k` rounds and trusting any "no"-certificate drives error to `≤ 2^{-k}`. The point to demonstrate verbally: this is *cheaper* than two-sided majority voting because one direction is a certificate.

#### Go

```go
package main

import (
	"fmt"
	"math/rand"
)

// oneSidedCheck: returns false (certain "no") if any round catches a witness;
// returns true (probable "yes") only if all k rounds passed. Error <= 2^-k.
func oneSidedCheck(rng *rand.Rand, catchesNo func(*rand.Rand) bool, k int) bool {
	for i := 0; i < k; i++ {
		if catchesNo(rng) {
			return false // certificate: certainly "no"
		}
	}
	return true
}

func main() {
	rng := rand.New(rand.NewSource(5))
	// a true "no" instance: each round catches it with prob 1/2
	noInstance := func(r *rand.Rand) bool { return r.Float64() < 0.5 }
	// a true "yes" instance: never caught
	yesInstance := func(r *rand.Rand) bool { return false }
	fmt.Println("no-instance, k=20  ->", oneSidedCheck(rng, noInstance, 20))   // false
	fmt.Println("yes-instance, k=20 ->", oneSidedCheck(rng, yesInstance, 20))  // true
}
```

#### Java

```java
import java.util.Random;
import java.util.function.Predicate;

public class OneSided {
    static boolean check(Random rng, Predicate<Random> catchesNo, int k) {
        for (int i = 0; i < k; i++) {
            if (catchesNo.test(rng)) return false; // certain "no"
        }
        return true; // probable "yes", error <= 2^-k
    }

    public static void main(String[] args) {
        Random rng = new Random(5);
        Predicate<Random> noInstance = r -> r.nextDouble() < 0.5;
        Predicate<Random> yesInstance = r -> false;
        System.out.println("no-instance, k=20  -> " + check(rng, noInstance, 20));
        System.out.println("yes-instance, k=20 -> " + check(rng, yesInstance, 20));
    }
}
```

#### Python

```python
import random


def one_sided_check(rng, catches_no, k):
    """False = certain 'no' (any round caught a witness); True = probable 'yes'."""
    for _ in range(k):
        if catches_no(rng):
            return False
    return True  # error <= 2**-k


if __name__ == "__main__":
    rng = random.Random(5)
    no_instance = lambda r: r.random() < 0.5
    yes_instance = lambda r: False
    print("no-instance, k=20  ->", one_sided_check(rng, no_instance, 20))   # False
    print("yes-instance, k=20 ->", one_sided_check(rng, yes_instance, 20))  # True
```

### Evaluation criteria

- **Part A:** the absolute error decreases as `n` grows, roughly like `1/√n` (expect ~`0.05` at `n=1e3`, ~`0.005` at `n=1e5`, ~`0.0005` at `n=1e7`, with run-to-run wobble).
- **Part B:** every returned value satisfies the predicate (correctness is *not* probabilistic — that is the Las Vegas guarantee), and the average attempt count converges to `1/p` (≈ 3 for "≥ 5").
- **Part C:** a true "no" instance is reported `false` with probability `≥ 1 - 2^{-k}`; a true "yes" instance is *never* falsely reported `false`; the candidate explains why this one-sided amplification (`2^{-k}`) is cheaper than two-sided majority voting (`e^{-Θ(δ²k)}`).
- **All parts:** the RNG is injected and seeded, so re-running with the same seed reproduces identical output (within one language); the candidate notes that the *same* seed gives *different* streams across Go/Java/Python.
- **Stretch goals:** (1) amplify Part A by running it `k` times and averaging — does the error fall like `1/√(kn)`? (2) Add a *retry cap + deterministic fallback* to Part B (return a guaranteed-valid value after `cap` failures) and confirm the tail is bounded, as in `senior.md`. (3) For Part C, plot the empirical false-"yes" rate against `2^{-k}` and confirm the bound holds.

---

**Next step:** Practice the hands-on exercises in [`tasks.md`](./tasks.md) — five beginner, five intermediate, and five advanced tasks across Go, Java, and Python — then explore the interactive [`animation.html`](./animation.html).
