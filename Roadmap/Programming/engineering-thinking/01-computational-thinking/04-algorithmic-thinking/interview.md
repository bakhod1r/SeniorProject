> Interview questions for **algorithmic thinking** — the *thinking discipline*, not a quiz on specific algorithms. Interviewers use these to see whether you reason about correctness, edge cases, cost, and strategy *before* and *while* you code. Answers are short and precise, with the traps and follow-ups an interviewer will push on. For implementations of named algorithms, see the **Data Structures & Algorithms** roadmap at [../../../../Data/datastructures-and-algorithms/](../../../../Data/datastructures-and-algorithms/).

---

## Q1. What actually makes a procedure an "algorithm"?

It must be **finite** (always terminates), **definite** (each step unambiguous), have well-defined **inputs and outputs**, and be **effective** (each step is a basic, doable operation) — Knuth's classic properties. The one engineers under-weight is *correct for all valid inputs*, not just the happy path.

**Trap:** candidates describe an idea ("loop and keep the biggest") without confirming it terminates and handles empty/edge inputs. An idea isn't an algorithm until it survives an adversarial input.

## Q2. You're given an unseen algorithmic problem. Walk me through your approach before writing any code.

1. **Clarify the contract** — restate inputs, outputs, constraints, and ask about edge cases (empty? duplicates? sorted? size of `n`? negative? malformed?).
2. **State pre/postconditions** out loud.
3. **Write/describe a brute force** for correctness.
4. **Estimate its cost**, ask if it's acceptable at the real `n`.
5. **Optimise only if needed**, matching the bottleneck to a strategy.
6. **Test against edge cases**, then walk the happy path.

**Follow-up they'll ask:** "Why brute force first?" — Because a correct slow solution is your oracle; you can't optimise toward a target you haven't pinned down, and a fast wrong answer is worthless.

## Q3. Should you really write brute force first? Isn't that wasting interview time?

Yes, write it (or at least state it). It demonstrates you can produce a *correct* solution, gives you something concrete to optimise, and reveals the structure that suggests the better approach. Say "the brute force is `O(n²)`; let me confirm it's correct, then improve it." Interviewers read that as senior judgment, not slowness.

**Trap:** jumping straight to a clever solution, getting it subtly wrong, and having no correct fallback. That reads worse than a clean brute force.

## Q4. How do you convince yourself (or me) that a loop is correct?

State a **loop invariant** — something true before the loop, preserved by each iteration, and which, combined with the exit condition, yields the postcondition. Show initialisation, maintenance, and termination. This is induction over iterations.

**Follow-up:** "What's the invariant for your two-pointer / sliding-window solution?" — Be ready to articulate it ("the window `[l, r)` always contains no duplicate characters"). If you can't state the invariant, you don't yet know why your code is correct.

## Q5. How do you reason about edge cases systematically?

Deliberately enumerate **empty, single, huge, and malformed** inputs, plus boundaries (min/max values, off-by-one at array ends), duplicates, and already-sorted/reverse-sorted data. Decide each case's behaviour *before* coding — often it surfaces a spec question to ask the interviewer.

**Trap:** testing only "normal" inputs. Bugs live in the corners; interviewers seed corner cases on purpose.

## Q6. How do you know a loop or recursion terminates?

Name a **variant**: a non-negative quantity that strictly decreases each iteration (e.g. `hi - lo` in binary search, the remaining unprocessed elements). If it's bounded below and always decreases, the loop must stop. For recursion, every call must shrink the problem toward a base case.

**Trap:** a `while` whose condition can be skipped over (`while x != 0: x -= 2` starting odd) — the variant doesn't actually reach the stopping point.

## Q7. You estimate a solution is `O(n²)`. Is that good or bad?

It depends entirely on `n`. `O(n²)` is fine for `n = 100` (10k ops) and unacceptable for `n = 1,000,000` (a trillion ops). **Cost is only meaningful relative to the real input size and the latency budget.** Ask for the expected `n` before declaring a complexity acceptable or not.

**Follow-up:** "When would you *choose* the `O(n²)` over the `O(n log n)`?" — When `n` is small and the simpler version is more obviously correct and maintainable; clarity beats cleverness when the speed difference doesn't matter.

## Q8. How do you decide between divide & conquer, greedy, DP, and backtracking?

Match the **problem's shape** to the strategy: independent same-shape subproblems → divide & conquer; locally-best stays globally-best → greedy; overlapping subproblems + optimal substructure → DP; explore configurations and prune dead ends → backtracking. It's a decision lens, not a memorised implementation.

**Trap:** applying **greedy** without proving the local choice is safe. Greedy is the most seductive and most often wrong. If you can find one counterexample, greedy is dead.

## Q9. Give me a case where greedy looks right but is wrong.

Coin change with denominations `{1, 3, 4}`, amount `6`. Greedy (largest-first) gives `4 + 1 + 1` = 3 coins; optimal is `3 + 3` = 2 coins. The problem has optimal substructure with overlapping subproblems → it's a **DP** problem. The lesson: verify greedy's precondition (the exchange/matroid argument) before trusting it.

## Q10. What's the difference between "I have an idea" and "I have an algorithm"?

An idea sounds right when spoken; an algorithm **survives an adversarial input** and has a stated contract, edge-case behaviour, termination guarantee, and known cost. The gap between them is exactly the work of algorithmic thinking — making the fuzzy precise.

## Q11. When is an *approximate* answer the right engineering choice?

When exact is intractable or unnecessary and the consumer tolerates bounded error: count-distinct via **HyperLogLog** (~2% error, kilobytes vs gigabytes), set membership via **Bloom filters** (no false negatives, tunable false positives), quantiles via **t-digest**. The discipline is *stating the error bound* so the approximation is a decision, not a latent bug.

**Follow-up:** "What error can a Bloom filter make?" — False positives only, never false negatives. That one-sidedness is why it's safe as a pre-filter.

## Q12. Your single-threaded algorithm is correct. What changes under concurrency?

Loop invariants assume exclusive access. Under interleaving, **check-then-act** patterns break (`if balance >= amount: balance -= amount` lets two threads both pass the check). You must ask which invariants must hold *across interleavings* and enforce them — atomicity, locking, compare-and-swap, or a single-writer redesign. The procedure isn't specified until its concurrency contract is.

## Q13. How would you reason about the correctness of a distributed protocol?

State its **safety** properties ("nothing bad happens" — e.g. no two leaders, no committed write lost) and **liveness** properties ("something good eventually happens" — e.g. a request eventually commits). Then identify the failure model (crash, partition) and what you must trade. **FLP** says you can't guarantee both safety and liveness in an async network with failures, so real protocols keep safety and make liveness conditional.

**Follow-up:** "Safety or liveness — which would you sacrifice for a payments system?" — Never safety; accept that progress may stall during a partition (a CP choice under CAP).

## Q14. Walk me through a time-vs-space trade-off you'd make consciously.

"Has this value appeared before?" — a hash set answers in `O(1)` time but `O(n)` memory; re-scanning is `O(1)` memory but `O(n)` per query; sorting first is `O(n log n)` time and `O(1)` extra space. None is universally best — I pick based on whether the constraint is latency, memory, or input size, and I *say which* in review.

**Trap:** treating "fastest" as automatically correct without naming what you spent to get it.

## Q15. Your fast solution and your brute force disagree on one input. What now?

Trust the **brute force** (your correctness oracle) and treat the fast version as the suspect. Minimise the failing input to the smallest reproducer, then locate which invariant the fast version violates on it. This differential-testing instinct — fast path vs slow path on random inputs, assert they agree — is how you catch subtle optimisation bugs in practice.

---

### Closing tips

- **Think out loud.** Interviewers grade the *reasoning* (contract → brute force → cost → strategy → edge cases), not just the final code.
- **Ask before assuming.** Clarifying inputs and edge cases is a strength, not a weakness.
- **State your invariant and your cost.** Those two sentences signal seniority faster than any clever trick.
- For the algorithms themselves, drill the **Data Structures & Algorithms** roadmap; this page is about the *thinking* that makes you choose and verify them.
