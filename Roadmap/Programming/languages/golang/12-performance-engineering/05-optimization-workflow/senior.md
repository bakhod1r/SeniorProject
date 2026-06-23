# Optimization Workflow — Senior

## 1. The senior shift: decisions over techniques

At the junior and middle levels the workflow is mechanical: measure, identify, change, re-measure. At the senior level the loop is the same, but the binding constraint shifts from "how do I make this fast" to "should I be working on this at all". The senior engineer's job in performance work is to decide:

- Which problem to take on.
- When to stop a line of work.
- Whether the optimization is worth the long-term cost.
- Whether the team can sustain the change.

The technique table is shared by every Go engineer above junior level. What separates senior is the judgment about *which entry on the table to apply, when, and at what cost*.

---

## 2. Opportunity cost is the senior's lens

Engineering time is the scarcest resource on a team. The right framing for a candidate optimization is not "is it possible?" but "is it the best use of the next two weeks?"

| Candidate work | Opportunity cost |
|----------------|------------------|
| Shave 5% off a function used 10× per second | Two weeks of engineer time |
| Add a missing index to a query that runs 10k× per second | Same two weeks |
| Fix a goroutine leak crashing one pod a week | Same two weeks |
| Build a benchmark harness that catches regressions for the next year | Same two weeks |

All four are "performance work." Only one of them is the right thing to do this sprint. The senior calls that out before anyone writes code.

---

## 3. The "don't optimize" decision

There are concrete situations where the right senior move is to decline the optimization request entirely.

| Situation | Why decline |
|-----------|------------|
| The code isn't on a hot path | Confirmed by a real production profile; cold paths don't move user-visible numbers |
| The system is bottlenecked elsewhere | Optimizing X helps nothing if database queries dominate |
| The change risks correctness or readability disproportionately | The bug introduced will cost more than the latency gained |
| The workload will change soon | The hot function next quarter will be different |
| The user-visible improvement is below the threshold of perception | A 3 ms improvement in a 200 ms API response is not noticed |

"Not now" or "not ever" is a valid output of the optimization workflow. Saying it requires confidence, which requires data — even a "no" needs a profile to back it up.

---

## 4. Goal-setting at the system level

Junior goals are per-benchmark. Middle goals are per-endpoint. Senior goals are per-system, expressed as SLOs:

- "p99 of `/checkout` ≤ 200 ms at 1000 RPS, 99.9% of the time, over rolling 28 days."
- "Idle service memory ≤ 400 MiB, peak ≤ 800 MiB."
- "Per-request CPU-seconds ≤ 8 ms at steady state."

These numbers come from the business (or implied by user expectations) and constrain which optimizations are worth doing. A 30% improvement in a function that's not on the SLO's critical path is, at the system level, often invisible.

The senior version of "set the goal" is "set the goal in terms of what users and operators perceive."

---

## 5. The cost model

Every optimization has a four-part cost. The senior tracks all four explicitly.

| Cost dimension | Example |
|----------------|---------|
| **Engineering hours** | "Two weeks to land, with a 60% chance of needing a follow-up" |
| **Ongoing maintenance** | "Adds a `sync.Pool` we'll have to remember when refactoring" |
| **Readability** | "The clear loop becomes a hand-unrolled, lookup-table version" |
| **Failure modes** | "Cache invalidation bugs, retention quirks" |

A 5% latency improvement that costs four weeks of work and adds a new failure mode is a bad deal in most contexts. A 5% improvement that takes 30 minutes and removes a footgun is excellent. Senior judgment is in the multiplier you put on each cost.

---

## 6. Diminishing returns, formalized

The first time through the loop on a service typically nets 20–50% improvement in the hotspot. The second pass often nets another 15–25%. The third pass tends to be 5–10%. The fourth is 2–5%. After that you are spending engineering time for variance-level wins.

The Pareto curve is steep. The senior decision: claim "good enough" earlier than feels comfortable. The 80/20 split is the real one — get the first 80% of available wins quickly, then stop. The remaining 20% is rarely worth its long-term cost.

---

## 7. Where the next 5% comes from

When the first round of wins is gone, the second round is qualitatively different. Common second-round sources:

| Source | Typical mechanism |
|--------|-------------------|
| Algorithmic recast | Replace the algorithm entirely — not optimize, *rewrite* |
| Data layout | Field reordering, SoA over AoS, denser representation |
| Batching | Amortize fixed costs across many items |
| Removing a step | Cache results, precompute at startup, eliminate redundant work |
| Concurrency | Parallelize a serial step, with care |
| Specialization | A separate fast path for the common case |
| Language-level move | Generics over interface, avoid reflection, inline-friendly helpers |

The senior engineer notices when round-one moves stop yielding and *steps back* to ask "is there a different algorithm or shape entirely?" rather than continuing to inch the same loop forward.

---

## 8. When not to chase a profile result

A CPU profile is a snapshot. A 30-second sample of a service at 11 PM on a Tuesday is not the average workload. The senior reads profiles with these reservations:

| Reservation | Implication |
|-------------|-------------|
| Sample may not be representative | Capture multiple profiles across times of day, traffic types |
| The hot function may be hot because of a bug | The fix is not optimization but correctness |
| Profile may show framework overhead | "X% is in gRPC unmarshaling" — irreducible unless you switch frameworks |
| The hot function may be intentionally hot | Sometimes the encryption is *supposed* to dominate |
| The numbers may be inflated by debug code | `if debug { ... }` paths still allocate the formatted string |

The skill is reading the profile in context, not just sorting by sample count.

---

## 9. The "performance is a feature" principle

The opposite of "premature optimization is the root of all evil" is "performance is a feature". Both are correct in different contexts.

| Context | Which principle wins |
|---------|---------------------|
| Prototype code, internal tool | "Don't optimize prematurely" |
| User-facing latency-sensitive endpoint | "Performance is a feature" |
| Library code | Both; design for performance, but don't micro-optimize without data |
| Code that runs at cost-relevant scale | "Performance is a feature" (cost is the customer) |
| Test helpers | "Don't optimize prematurely" |

Most engineers absorb one principle and apply it everywhere. The senior knows when to switch contexts.

---

## 10. Three things juniors over-rotate on

| Pattern | Why it's overdone |
|---------|-------------------|
| `sync.Pool` everywhere | Adds complexity; only pays off in hot allocation paths |
| `unsafe.String`/`unsafe.Slice` | Risk is real; the few hundred ns saved is rarely worth it |
| Replacing `interface{}` with generics indiscriminately | Generics aren't free; the call site cost depends on monomorphization shape |

The senior knows these tools and uses them sparingly. The middle engineer uses them when needed. The junior uses them everywhere.

---

## 11. The opportunity for system-level wins

Single-function optimizations rarely move the needle on system-level latency. The wins that do, at the senior level:

| System-level lever | Typical impact |
|--------------------|----------------|
| Removing an N+1 query pattern | 10×–100× on the affected endpoint |
| Adding a coherent cache layer with proper invalidation | 5×–50× on read-heavy paths |
| Switching from sync to async where the API allows | 2×–10× on throughput |
| Replacing a slow downstream call with a batched / parallel one | 2×–10× on tail latency |
| Reducing payload size by half (smaller JSON, gzip, schema changes) | 1.5×–3× on network-bound paths |
| Right-sizing the connection pool or worker count | Variable; often dramatic in contention-bound services |

A senior optimization pass spends as much time on the dependency graph and architecture as on hot functions.

---

## 12. Pushback as a skill

Performance asks land on the senior engineer constantly. Many of them are wrong, or premature, or pointed at the wrong place. The senior is comfortable saying things like:

- "Show me a profile from prod that says this function is the cost."
- "What's the user-visible improvement? Not just the percentage."
- "What does this break for the next engineer who reads the code?"
- "What was the goal again? If we're already meeting it, why this?"
- "We can do this, but the next sprint's roadmap loses item X. Is that the trade you want?"

The pushback isn't obstruction; it's the senior's contribution. Doing the wrong optimization fast is a worse outcome than doing the right one slowly.

---

## 13. The "is this regression real" judgment

When CI shows a benchmark slowed down 8%, three responses are reasonable depending on context:

| Response | Reasoning |
|----------|-----------|
| Block the PR | This benchmark is on a critical path; tolerance is < 2% |
| Investigate | It might be noise; re-run with `-count=20` and check the spread |
| Accept | The PR fixes a correctness bug; the trade is worth it |

The senior decides which. Treating every regression as a block creates noise; treating none as a block creates drift. The judgment lives in knowing which benchmarks measure things that matter to users.

---

## 14. Documenting *why this is fast*

Every non-obvious optimization gets a comment that future readers can act on.

```go
// We use a fixed-size [20]byte stack buffer because Itoa on int64 needs
// at most 20 bytes (including sign). Stack-allocating it avoids the heap
// allocation that strconv.FormatInt would do, which mattered in
// BenchmarkEncode_NoAlloc (allocs/op dropped from 3 to 1).
//
// Do NOT replace with strconv.FormatInt without first re-running that
// benchmark and the BenchmarkRender_p99 in pkg/render.
var buf [20]byte
b := strconv.AppendInt(buf[:0], n, 10)
```

The comment names:

- The technique (fixed-size stack buffer).
- The reason (avoid heap allocation in a hot path).
- The proof (benchmark name + measured improvement).
- The hazard (the obvious-looking refactor that would silently undo it).

Future-you, six months from now, will not remember any of this. The comment is what protects the optimization from being reverted by accident.

---

## 15. The senior optimization checklist

Before declaring an optimization done, the senior verifies:

| Check | Why |
|-------|-----|
| The numbers are reproducible (`benchstat` p < 0.05) | No win exists without statistical significance |
| The hot path no longer appears in `top10` | The optimization solved the original problem, not a side issue |
| Functional tests, including race, still pass | Performance isn't worth correctness |
| The change is reviewable | Five small commits are better than one giant one |
| A regression test exists | If the optimization gets undone, CI catches it |
| The trade-offs are documented | Readability, memory, complexity costs noted |
| The team understands the change | Not just the author |

Skipping any item is an open invitation for the optimization to silently regress, fail, or confuse the next reader.

---

## 16. Summary

Senior performance work is mostly judgment: about which problem to take on, which signal to trust, when to stop, and how to communicate trade-offs. The mechanical loop you learned at the junior and middle levels is still the engine, but the senior decides when to start it, what target to aim it at, and when to declare it finished. The technical tools are public; the discipline of using them well is what makes the role.

---

## Further reading
- Brendan Gregg, "Systems Performance: Enterprise and the Cloud" (book)
- Carlos Bueno, "Mature Optimization Handbook" (free): https://www.facebook.com/notes/facebook-engineering/the-mature-optimization-handbook/10151784131623920/
- Damian Gryski, go-perfbook: https://github.com/dgryski/go-perfbook
- Frank McSherry, "Scalability! But at what COST?": https://www.usenix.org/system/files/conference/hotos15/hotos15-paper-mcsherry.pdf
