> Exercises to build **algorithmic thinking** — the discipline of turning fuzzy ideas into precise, correct, well-understood procedures. These are *reasoning* tasks first and coding tasks second. Most deliverables are a **contract, an invariant, a counterexample, a strategy choice, or pseudocode** — not a finished program. Global rules: (1) write the pre/postconditions before any pseudocode; (2) for every loop, name its invariant *and* its termination variant; (3) always check the empty / single / huge / malformed input; (4) write brute force before any optimisation. For the underlying algorithms, see the **Data Structures & Algorithms** roadmap at [../../../../Data/datastructures-and-algorithms/](../../../../Data/datastructures-and-algorithms/).

---

## Task 1 — Specify before you code: "second largest"

You're asked for "the second largest number in a list."

**Deliverable (no code yet):** Write the full contract — input, output, **precondition**, **postcondition**. Then answer in prose: what should happen for `[]`, for `[5]`, for `[5, 5]` (is the second largest `5` or undefined?), and for `[5, 5, 3]`? Each answer is a *spec decision* — state which you chose and why. Only after the contract is settled, write pseudocode and identify the loop invariant.

**What's being tested:** that you surface edge-case decisions *before* coding, not after a crash.

## Task 2 — Find the input that breaks it

Here is a procedure to "return the average of a list":

```
PROCEDURE average(list):
    total <- 0
    FOR x in list: total <- total + x
    RETURN total / length(list)
```

**Deliverable:** Find at least **three** distinct inputs that break or mislead this procedure (think empty, type, overflow, precision). For each, say *which property* it violates (definiteness, finiteness, a precondition) and propose the minimal fix or precondition. Do not rewrite the whole thing — diagnose precisely.

## Task 3 — Turn an idea into an algorithm: "remove duplicates"

The fuzzy idea: *"go through the list and remove duplicates."*

**Deliverable:** Make it precise. (a) Does order need to be preserved? Decide and state it as a postcondition. (b) Write pseudocode for the brute-force version and give its time/space cost. (c) Write an optimised version, name the data structure that makes it faster, and state the **invariant** ("before processing element `i`, the output contains exactly the distinct values from `list[0..i-1]` in first-seen order"). (d) Name the trade-off between the two versions in one sentence.

## Task 4 — Prove termination

For each loop below, either name a **variant** (a non-negative quantity that strictly decreases each iteration) proving it terminates, or show concretely that it *doesn't*:

```
(a) i <- n;     WHILE i > 0:  i <- i - 1
(b) x <- 100;   WHILE x != 1: IF x even: x <- x/2 ELSE x <- 3x+1
(c) lo<-0; hi<-n; WHILE lo < hi: mid<-(lo+hi)/2; lo<-mid+1
(d) x <- 7;     WHILE x != 0:  x <- x - 2
```

**Deliverable:** A one-line verdict per loop with the variant or the non-terminating input. (Note: (b) is the Collatz sequence — be honest about what is and isn't *known*.)

## Task 5 — Write the loop invariant

Here's a procedure that reverses a list in place using two pointers:

```
PROCEDURE reverse(a):
    l <- 0; r <- length(a) - 1
    WHILE l < r:
        swap(a[l], a[r])
        l <- l + 1; r <- r - 1
```

**Deliverable:** State the loop invariant precisely (what is guaranteed about `a` and the regions `[0,l)` and `(r, end]` at the top of each iteration). Then argue initialisation, maintenance, and how the invariant + exit condition yields the postcondition "`a` is reversed." Verify it on `[]`, `[1]`, `[1,2]`, `[1,2,3]`.

## Task 6 — Estimate cost by inspection

Without running anything, give the time complexity (big-O) of each sketch and the *single phrase* that justifies it:

```
(a) one pass summing a list
(b) for each item, scan the whole list again
(c) repeatedly halve a sorted range until size 1
(d) sort the list, then one pass over it
(e) for each of n items, recurse on two halves
```

**Deliverable:** Complexity + justification per item. Then answer: for which of these does going from `n = 1,000` to `n = 1,000,000` turn "fine" into "infeasible"? Show the rough op-count to back your verdict.

## Task 7 — Pick the strategy

For each problem, name the most fitting strategy (**divide & conquer / greedy / dynamic programming / backtracking**) and give the *tell-tale sign* that pointed you there. You do **not** need to solve them.

```
(a) Minimum number of coins to make an amount, arbitrary denominations
(b) Find an element in a sorted array
(c) Generate all valid placements of N queens on an N×N board
(d) Maximum-value subset of items fitting a weight limit (0/1 knapsack)
(e) Schedule the maximum number of non-overlapping meetings
```

**Deliverable:** Strategy + tell-tale sign per item. For (a) and (e), note that a greedy attempt is tempting — say whether greedy is *correct* and, if not, give a counterexample.

## Task 8 — Brute force first, then optimise

Problem: given an array and a target, find two indices whose values sum to the target.

**Deliverable:** (a) Write brute-force pseudocode and state its cost. (b) Identify *the wasted work* in one sentence. (c) Write the optimised version, name the data structure, state its cost and its **invariant**. (d) Name the time-vs-space trade-off you made. (e) Construct one input where the brute force and your optimised version must return the *same* answer, to use as a differential test.

## Task 9 — Exact vs approximate

You must report "the number of distinct users seen today" over a stream of billions of events, with a strict memory budget of a few kilobytes.

**Deliverable (reasoning, no implementation):** Explain why the exact approach (a set of all IDs) fails the constraint. Name a probabilistic algorithm that fits, state the **kind and rough size of error** it introduces, and write one sentence you'd put in a design doc to make the approximation an explicit, agreed decision rather than a hidden bug.

## Task 10 — The concurrency invariant breaks

This "withdraw" procedure is correct single-threaded:

```
PROCEDURE withdraw(amount):
    IF balance >= amount:
        balance <- balance - amount
        RETURN ok
    RETURN insufficient_funds
```

**Deliverable:** State the invariant the code is meant to preserve ("`balance` never goes negative"). Then describe a concrete two-thread interleaving that **violates** it, naming the pattern (check-then-act race). Finally, list two distinct algorithmic fixes and, for each, the cost or constraint it imposes. Do not just say "add a lock" — explain what the lock makes atomic and why that restores the invariant.

## Task 11 — Adversarial input and cost

A service validates uploaded filenames with a regular expression, and a teammate reports it occasionally pegs a CPU core to 100% on certain inputs.

**Deliverable (reasoning):** Explain how an algorithm that is `O(n)` on normal input can become exponential on a crafted input (catastrophic backtracking / ReDoS), and connect it to the senior-level reflex: *"what is the adversarial input for this procedure, and what does it cost me?"* State two ways to bound the cost so the worst-case input can't hurt you. No regex internals required — reason about *cost as a function of adversarial input*.

## Task 12 — Specify a protocol by its properties (stretch)

You're designing a "process each incoming order exactly once, even if the message is delivered twice and a worker can crash mid-processing" subsystem.

**Deliverable (no code — properties only):** (a) State one **safety** property and one **liveness** property this subsystem must satisfy. (b) Name the invariant that would guarantee the safety property (hint: something about an idempotency/dedup key surviving a crash). (c) Identify the failure inputs your design must treat as *normal* inputs (duplicate delivery, crash between two steps). (d) Write the one-sentence invariant you'd leave in the design doc so a future team can rewrite the code without losing correctness.

---

### How to get the most from these

- Do the **specification and reasoning** parts even for tasks you could code in two minutes — that's the muscle this topic trains.
- For any task, ask the four questions: *What's the contract? What invariant makes it correct? Does it terminate? What does it cost?*
- When you reach for a real algorithm, switch to the **Data Structures & Algorithms** roadmap; come back here to reason about *whether it's the right one and why*.
- Related practice: [problem-solving](../../02-problem-solving/), and the sibling pillars [decomposition](../01-decomposition/), [pattern recognition](../02-pattern-recognition/), [abstraction and generalisation](../03-abstraction-and-generalization/), and [modelling a problem in code](../05-modeling-a-problem-in-code/).
