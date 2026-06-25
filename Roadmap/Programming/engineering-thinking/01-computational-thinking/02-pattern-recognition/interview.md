> Pattern-recognition questions probe whether you can *classify* a problem before solving it, and whether you know the limits of your own pattern-matching. Interviewers care less about whether you recall a pattern's name and more about whether you can name the **signal** that triggers it — and whether you know when a familiar pattern is the wrong tool. Answers below are short and direct; the **trap** and **follow-up** lines are what separate strong candidates.

---

## Q1. What is pattern recognition in computational thinking, and why does it matter?

Noticing that a new, surface-different problem has the same underlying *structure* as one already solved, so you reuse a known solution instead of inventing one. It's the second pillar of computational thinking, after decomposition. It matters because a small, finite set of patterns covers a huge, effectively infinite set of surface problems — patterns are **compressed experience**, far more leverage than memorizing individual solutions.

**Follow-up:** *How is it different from just remembering solutions?* You remember the *shape and its signal*, not the specific code — so it transfers to problems you've never seen.

## Q2. Walk me through how you'd recognize "what pattern is this problem?" for a problem you've never seen.

Strip the domain nouns and look at the shape that's left. Concretely: identify the input structure (sequence? graph? tree? key-value?), the operation requested (search? shortest path? all-paths? optimize over choices?), and the constraints. Then match those to known signals — "contiguous subrange + optimize" → sliding window; "shortest in unweighted graph" → BFS; "choices with optimal substructure + overlap" → DP.

**Trap:** Jumping to a pattern from a *surface* keyword ("it mentions a tree, must be recursion") instead of the actual structure. State the signal, then verify it's present.

## Q3. Give a problem statement and the pattern it maps to — show the mapping out loud.

> *"Find the longest substring with at most K distinct characters."*

Signals: **contiguous** substring (window), a constraint that can be maintained **incrementally** as the window grows/shrinks (count of distinct chars). Two signals for **sliding window**. Solution: expand right, when distinct > K shrink left, track best length.

**Follow-up:** *What if it allowed non-contiguous characters?* Then it's *not* a sliding window — the contiguity signal is gone. Probably a counting/greedy or DP problem instead.

## Q4. When does pattern-matching mislead you?

When you match on **familiarity** instead of **fit** — you force a pattern you know onto a problem that lacks its signal. The classic name is Maslow's **law of the instrument** ("if all you have is a hammer…"), called the **golden hammer** anti-pattern in software. The guard is to make each pattern's *precondition* explicit and verify it's actually present before committing.

**Follow-up:** *How do you catch yourself doing it?* The tell is reaching for the same tool regardless of the problem; the discipline is stating the signal before the solution and arguing the "do-nothing/boring" alternative.

## Q5. How do you tell a real pattern from a coincidence or superstition?

Three checks: **count the cases** (two co-occurrences is a coincidence, not a pattern); **find the mechanism** (a real pattern has a *reason* it recurs — "deploys fail Friday" has no mechanism beyond "fewer people to fix them"); and **try to falsify it** (find a case where it should apply but doesn't). This is correlation-vs-causation applied to your own pattern library — otherwise you build cargo-cult rules like "always restart twice."

**Trap:** Treating personal anecdote as a pattern. "It worked the last two times" is evidence of nothing without a mechanism.

## Q6. What's the relationship between pattern recognition and abstraction?

Recognition is the **prerequisite** for abstraction. You can't factor out a reusable `retryWithBackoff` until you've *noticed* that five call-sites do the same retry dance. The order is: notice the recurrence → name it → factor out the shared shape. Reverse it — abstract before you've seen a *real* pattern across enough cases — and you get the wrong abstraction, which is worse than duplication.

**Follow-up:** *How many cases before you abstract?* A common rule of thumb is the "rule of three" — wait for the third genuine occurrence so you abstract the real commonality, not a coincidence between two.

## Q7. Explain the chess-master studies and what they imply for engineers.

Chase & Simon (1973): chess masters reconstruct a *realistic* board far better than novices, but on a *randomly arranged* board they do no better. They weren't memorizing pieces — they were memorizing **chunks** (known formations). Implication: expert speed is **pattern-specific, not general intelligence**; you build it by accumulating and naming chunks, and it disappears the moment the input has no real structure to chunk.

**Follow-up:** *Why does this make experts seem faster?* A chunk is one working-memory slot, so they spend scarce working memory only on the genuinely novel part of the problem.

## Q8. A service is "slow sometimes." How does pattern recognition drive your investigation?

Treat the first matched pattern as a *hypothesis*, not a conclusion. Gather the signature: is it p99 only (tail latency — GC, contention, a slow shard) or p50 too (systemic)? Does latency rise *with* concurrency while throughput plateaus (contention — adding machines makes it worse) or does throughput keep scaling (capacity)? Each signature has a cheap distinguishing check. Run the cheapest one before committing to a fix.

**Trap:** "It's slow, let's add servers." If it's contention, that makes it *worse.* The distinguishing check (does throughput rise or fall with load?) tells contention from capacity, and their fixes are opposite.

## Q9. How do bug symptoms act as patterns? Give examples.

Bugs have **signatures** — recurring symptom→cause-class mappings. Memory climbs monotonically then OOM → leak (unbounded cache/listener). Works alone, fails under load → concurrency/shared-state. Errors start exactly at a deploy timestamp → bad deploy (roll back first). TLS errors on a round date → cert expiry. Recognizing the signature lets you skip from-scratch debugging straight to a small set of likely causes.

**Follow-up:** *How do you avoid misdiagnosing?* Confirm with one observation that *distinguishes* the class from look-alikes before acting — recognition narrows, evidence confirms.

## Q10. What are anti-patterns, and why are they worth naming?

Anti-patterns are recurring "solutions" that look reasonable but reliably cause harm — God object, golden hammer, spaghetti, N+1 queries, distributed monolith, cargo cult (Brown et al., *AntiPatterns*, 1998). Naming them turns a vague "I don't like this" in review into a **shared, checkable category** the author can act on, and builds institutional memory that outlives the people who learned the lesson the hard way.

**Follow-up:** *Name one and its signature.* N+1 queries — a database call inside a loop; it's a batch/cache problem ignored.

## Q11. You join a team that "always does X." How do you decide if X is a real pattern or a superstition?

Ask for the **mechanism**: *why* does X produce the good outcome here? Check it survives **transplant** — a practice that worked at a 100,000-engineer company may have no supporting force at 30. Run the **counterfactual**: what breaks if we stop? If nothing breaks and there's no mechanism, it's a frozen accident (cargo cult), not a pattern.

**Trap:** Dismissing it as superstition *too* fast — some "always do X" rules encode a hard-won incident. The discriminator is the mechanism, not how arbitrary it feels.

## Q12. When does a pattern that was once correct become the wrong choice?

When the **forces** that made it right have shifted — scale, team size, hardware cost, tooling maturity, regulation. "Start with a monolith" is right for a small team and wrong at 200 engineers with deploy contention; "cache everything" is right when the DB is the bottleneck and wrong once the DB is fast and the cache becomes the bug source. The danger sign: the pattern is defended by **tradition** ("we've always…") rather than by *current* forces.

**Follow-up:** *How do you catch an expired pattern?* Periodically re-ask "what were the forces that made this right, and are they still true?" of load-bearing decisions.

## Q13. Two valid patterns fit the same problem and prescribe different solutions. How do you choose?

Decide by the **forces** — the competing pressures each pattern balances — and pick the one whose assumptions match the situation. Sync request/response vs. async pub/sub: need strong consistency and low latency, or decoupling and buffering? Orchestration vs. choreography: central visibility, or team autonomy? Same shape, opposite trade-offs; name the forces out loud because that's the part that determines correctness.

**Trap:** Choosing the one you used last time. Last time's forces may not be this time's.

## Q14. How do you deliberately build your pattern library?

Reflect after every problem ("what *class* was that, what was the signal?" — the reflection files the chunk, not the solving). Read others' code and name the patterns you see. Read **post-mortems** across the org — the densest source of symptom→root-cause mappings, including rare ones you won't hit personally for years. Study catalogs (GoF, AntiPatterns, integration patterns) for *shared names*. And refactor the library as contexts change so it doesn't match stale shapes confidently.

**Follow-up:** *Why group practice problems by pattern, not by company/topic?* "Sliding-window problem" transfers to new problems; "Amazon problem" transfers to nothing.

## Q15. As a staff/principal engineer, what does pattern recognition add beyond the individual level?

Recognizing patterns across **systems and org structures** (Conway's law, distributed monolith, strangler fig), **naming** them so the whole org shares vocabulary, and **encoding** them — golden paths, runbooks, design-review checklists, architecture fitness functions — so the org matches patterns automatically instead of relearning them team by team. The endpoint is making *the system* recognize patterns (a fitness function that fails the build on a known anti-pattern), which scales past any one person.

**Follow-up:** *Why is naming so high-leverage?* A pattern only you recognize is worth one engineer; a pattern the org can name is worth the org.

---

### Related
[Decomposition](../01-decomposition/) · [Abstraction & generalization](../03-abstraction-and-generalization/) · [Algorithmic thinking](../04-algorithmic-thinking/) · [Modeling a problem in code](../05-modeling-a-problem-in-code/) · [Learning how to learn](../../10-metacognition-and-learning/01-learning-how-to-learn/) · [Section overview](../)
