> **What?** At this level, pattern recognition is the disciplined skill of **classifying a messy, real-world problem as an instance of a known class** — "this is really a cache-invalidation problem," "this is producer-consumer," "this is a state machine" — and pulling the matching solution, *while checking that the match is genuine and not wishful thinking.*
>
> **How?** You maintain a working library of algorithmic, design, and architectural patterns. When a feature request or a bug lands, you strip away the domain noise, identify the underlying shape, name it, and then *verify the signal fits* before committing to the implied solution.

---

## 1. From algorithmic patterns to design and architectural patterns

As a junior you learn algorithmic patterns. As a mid-level engineer your library has to widen into three layers, because real work spans all three:

| Layer | Granularity | Examples | Where you meet it |
|---|---|---|---|
| **Algorithmic** | function / loop | sliding window, two pointers, BFS/DFS, DP, memoization | implementing a feature, optimizing a hot path |
| **Design** | class / module | Strategy, Observer, Adapter, Factory, State, Decorator | structuring code, taming conditionals, decoupling |
| **Architectural** | service / system | producer-consumer, request-response, pub/sub, CQRS, cache-aside, leader-follower | wiring services, choosing a queue, scaling reads |

The recognition skill is identical across layers — *"what known shape is this?"* — only the vocabulary changes. The **Gang of Four** design-patterns book (Gamma, Helm, Johnson, Vlissides, 1994) exists precisely because the same OO design shapes recurred so often they were worth naming once and reusing forever. (Concrete catalog: [code-craft/design-patterns](../../../code-craft/design-patterns/).)

## 2. Mapping a messy real problem onto a known class

Real problems don't arrive labeled "DFS." They arrive as: *"When a user updates their profile photo, the old one keeps showing for a few minutes on some pages."* Recognition is the act of **translating domain language into pattern language.**

| What the ticket says | What it really is |
|---|---|
| "Old photo shows for a few minutes after update" | **cache-invalidation** problem |
| "Reports time out when 50 people export at once" | **producer-consumer / backpressure** problem |
| "The checkout flow has 14 nested `if` branches" | a **state machine** asking to be made explicit |
| "Two services overwrite each other's writes" | a **concurrency / last-write-wins / locking** problem |
| "We call the same slow API 1000 times in a loop" | an **N+1** problem → batch / memoize / cache |
| "Order can be: created → paid → shipped, but never shipped → paid" | a **state machine** with allowed transitions |

The move: read the symptom, *delete the nouns specific to your domain* (photo, report, checkout), and see what general shape is left. "Stale data after a write" with the nouns removed is just **cache invalidation** — a problem class with well-known solutions (TTL, write-through, explicit eviction, versioned keys).

### A worked mapping

> *"Background workers occasionally process the same job twice, double-charging customers."*

Strip the domain:

1. "Same unit of work handled more than once" → the general class is **idempotency / exactly-once delivery**.
2. That's a *known* hard problem in distributed systems with *known* solutions: idempotency keys, dedup tables, `INSERT … ON CONFLICT`, conditional writes.
3. Now you're not inventing — you're choosing among standard tools for a named problem.

Without recognition, you'd "fix the bug" with an ad-hoc lock and re-encounter it in three other places. With it, you fix the *class*.

## 3. Patterns as chunks: why experts recognize faster

There's a real cognitive mechanism here, and it's worth understanding because it tells you *how to practice.*

Chase and Simon's classic chess studies (1973, building on de Groot) showed that chess masters don't have better raw memory than novices. Shown a **realistic** board for five seconds, masters reconstruct it almost perfectly; novices can't. But shown a board of **randomly placed** pieces, masters do *no better than novices.* The masters weren't memorizing 25 pieces — they were memorizing ~6 **chunks** ("a castled-kingside structure," "an isolated-pawn formation"). Random boards have no chunks, so the advantage vanishes.

The lesson for engineers:

- An expert reads a 500-line module and "sees" a handful of patterns (a repository here, a strategy there, a retry-with-backoff over there), the same way the master sees chunks. You see 500 lines.
- The advantage is **domain-specific and pattern-specific**, not general intelligence. You build it by accumulating chunks, not by getting smarter.
- Working memory holds ~4–7 items. A chunk *is* one item. So the engineer who thinks in patterns has effectively a bigger working memory for the problem — they spend it on the genuinely novel part. (More on chunking: [learning how to learn](../../10-metacognition-and-learning/01-learning-how-to-learn/).)

## 4. The golden hammer: the failure mode of fluency

The flip side of having patterns is over-applying them. When a pattern has paid off for you, you reach for it reflexively — even when the **signal isn't there.**

This is the **golden hammer** anti-pattern (Brown, Malveau, McCormick, Mowbray, *AntiPatterns*, 1998), the engineering name for Maslow's **law of the instrument**. Symptoms:

- The same engineer's PRs always reach for the same tool: everything becomes a microservice; or every state becomes Redux; or every problem gets a queue.
- A pattern is chosen *before* the problem is understood ("let's use event sourcing" on day one).
- A simple problem is wrapped in three layers of indirection because the pattern "felt professional."

### Guard: confirm the signal before you commit

A pattern is a *conditional* tool — it pays off **only when its preconditions hold.** Make the preconditions explicit and check them:

| Pattern you want to use | Required signal — verify it's present |
|---|---|
| Sliding window | the answer is over a **contiguous** subrange |
| Caching | reads ≫ writes **and** staleness is tolerable for the TTL |
| Message queue | producer/consumer rates differ **and** async is acceptable |
| Strategy pattern | there are genuinely **multiple, swappable** algorithms, not one |
| Microservices | independent scaling/deploy **and** the team can own the ops cost |

If you can't point at the signal, you're pattern-matching on *familiarity*, not on *fit.* Drop it.

## 5. True pattern vs. coincidence: don't build superstitions

A subtler trap than the golden hammer: mistaking a **coincidence** for a pattern. You saw X and Y together twice, so you "learn" the rule *X causes Y.* That's how cargo-cult code and team superstitions form — "always restart the service twice," "never deploy on Friday," "wrap it in a try/catch and it works."

This is the **correlation-vs-causation** problem applied to your own pattern library. Treat a candidate pattern like a claim that needs evidence (see [scientific and hypothesis-driven thinking](../../09-scientific-and-hypothesis-driven/)):

- **Count the cases.** Two co-occurrences is a coincidence, not a pattern. Look for the rule across many independent instances.
- **Look for the mechanism.** A real pattern has a *reason* it recurs. "Sliding window works because window state updates incrementally as you slide" — there's a mechanism. "Deploys fail on Friday" has no mechanism beyond "fewer people around to fix them," which is the *real* pattern.
- **Try to falsify it.** Find a case where the supposed pattern *should* apply but doesn't. If you can't explain the misses, your pattern is fiction.

A real pattern survives this; a superstition doesn't.

## 6. Anti-patterns: recognizing the patterns of *failure*

Recognition cuts both ways. Just as you learn good shapes to reuse, you learn bad shapes to *avoid* — and to spot in review. Anti-patterns are recurring "solutions" that look reasonable but reliably cause trouble.

| Anti-pattern | Signature you'll recognize | What it really is |
|---|---|---|
| **God object** | one class knows/does everything, 2000 lines | failed decomposition |
| **Golden hammer** | one tool applied to every problem | over-fit pattern matching |
| **Spaghetti** | control flow you can't follow | missing structure/abstraction |
| **N+1 queries** | a query inside a loop | a batch/cache problem ignored |
| **Lava flow** | dead code nobody dares delete | accreted, never refactored |
| **Cargo cult** | code copied without understanding | coincidence mistaken for pattern |

Naming these in a review (*"this is a God object — let's split responsibilities"*) is high-leverage: it turns a vague "I don't like this" into a shared, recognized category the author can act on.

## 7. Recognition feeds abstraction

Recognizing a pattern is the **prerequisite** for abstracting it. You can't extract a reusable `retryWithBackoff` helper until you've *noticed* that five call-sites all do the same retry dance. The sequence is always:

```
notice the recurrence (recognition) → name it → factor out the shared shape (abstraction)
```

This is the bridge to the next topic. See [abstraction and generalization](../03-abstraction-and-generalization/) — recognition spots the duplication; abstraction removes it. Get the order wrong (abstract before you've recognized a *real* pattern across enough cases) and you get the wrong abstraction, which is famously worse than duplication.

---

## Key takeaways

- Your library must span **three layers**: algorithmic, design ([GoF](../../../code-craft/design-patterns/)), and architectural patterns. Recognition is the same skill at each; only the vocabulary scales.
- Map messy tickets to known classes by **deleting the domain nouns** and seeing the shape left over ("stale data after write" = cache invalidation).
- Patterns are **chunks** (Chase & Simon); experts recognize fast because they've accumulated chunks, not because they're smarter — so practice by *accumulating and naming*, not just solving.
- The **golden hammer** / law of the instrument is the failure mode of fluency: verify a pattern's **required signal** is present before committing to it.
- Distinguish a true pattern from a **coincidence**: count cases, demand a mechanism, try to falsify — don't build superstitions.
- Learn **anti-patterns** as recognized shapes of failure to spot in review.
- Recognition is the prerequisite for [abstraction](../03-abstraction-and-generalization/): notice the recurrence first, then factor it out.
