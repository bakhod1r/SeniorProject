> **What?** A *leverage point* is a place in a system where a small push produces a large change. A *bottleneck* is the single slowest part that caps the whole system's output. The core idea: most of a system's behavior is controlled by a tiny fraction of it, so where you push matters far more than how hard.
>
> **How?** Before you optimize anything, find the part that actually limits the result — measure, don't guess — and work only on that part. Speeding up anything else is wasted effort.

---

## 1. The one idea: push in the right place

Imagine a pipeline of four stages. Each stage processes requests at a different rate:

```
[Parse 1000/s] → [Validate 1000/s] → [DB write 200/s] → [Notify 5000/s]
```

How fast is the whole pipeline? Not 1000/s. Not the average. It runs at **200/s** — the rate of its slowest stage, the DB write. That slowest stage is the **bottleneck** (also called the *constraint*).

Now the trap. A junior engineer looks at this and thinks "let me make parsing faster, I know how to do that." They spend a week optimizing the parser from 1000/s to 2000/s. Result: the pipeline still runs at **200/s**. Zero improvement. The work was real, the effort was real, the outcome was nothing.

> The throughput of a system is set by its single slowest part. Improving anything else changes nothing.

This sounds obvious written down. In practice, engineers violate it constantly — because the slow part is usually *not* the part that's easy or fun to work on, and not the part where the pain is felt.

## 2. The bottleneck rules

Three rules to memorize:

1. **Only the bottleneck sets the throughput.** Make the bottleneck faster → the whole system gets faster. Make anything else faster → nothing happens.
2. **Optimizing a non-bottleneck is worthless** (you sped up something with spare capacity) **or harmful** (you spent time you could have spent on the real constraint, and you may have just piled more work in front of the bottleneck).
3. **When you fix the bottleneck, it moves.** Speed up the DB write to 3000/s and now Parse (1000/s) is the slowest. The constraint never disappears — it relocates. So you find the *new* bottleneck and repeat.

### Before / after

| Stage | Before | You optimize Parse | You optimize DB write |
|---|---|---|---|
| Parse | 1000/s | 2000/s | 1000/s |
| Validate | 1000/s | 1000/s | 1000/s |
| DB write | **200/s** | **200/s** | 3000/s |
| Notify | 5000/s | 5000/s | 5000/s |
| **Pipeline** | **200/s** | **200/s** (no change) | **1000/s** (5× — now Parse is the constraint) |

The right-hand column is the only one where effort produced output. Same amount of engineering work, wildly different result, decided entirely by *which* stage you picked.

## 3. The constraint is rarely where the pain is felt

Here's the part that catches everyone. The place that *hurts* is usually not the place that's *broken*.

A real example. Users complain the dashboard is slow. The slowness is felt in the **frontend** — the page takes 4 seconds to render. The natural reaction: "optimize the frontend." A new engineer spends days shaving 200ms off React render time.

But when you actually measure where the 4 seconds go:

```
Frontend render:     0.3s
Network:             0.2s
API handler logic:   0.1s
One database query:  3.4s   ← the constraint
```

The pain is in the frontend; the cause is a missing database index. The 3.4s query is the bottleneck. Fixing the frontend render (0.3s → 0.1s) saves 0.2s of a 4-second problem. Adding the index drops the query to 0.05s and the page loads in 0.65s.

> The symptom is not the cause. The place it hurts is not the place to push. Always trace the pain back to the part that actually limits the outcome.

## 4. Measure first — you cannot find the bottleneck by guessing

The single most important habit: **measure before you optimize.** Your intuition about what's slow is usually wrong, because the slow thing is often invisible (a query, a lock, a network round trip) while the visible thing (a loop you wrote) is fast.

Tools that show you the real bottleneck instead of your guess:
- A **profiler** — shows where CPU time actually goes.
- **Timing/logging** — wrap each stage, print how long each took.
- **Database `EXPLAIN`** — shows which query is slow and why.
- **Request tracing** — shows where the milliseconds go across services.

The simplest version is timing each stage by hand:

```python
import time

t0 = time.perf_counter()
data = parse(raw)            # stage 1
t1 = time.perf_counter()
validate(data)               # stage 2
t2 = time.perf_counter()
write_to_db(data)            # stage 3
t3 = time.perf_counter()

print(f"parse={t1-t0:.3f}s validate={t2-t1:.3f}s db={t3-t2:.3f}s")
# parse=0.002s validate=0.001s db=1.840s
#                                    ^^^^ there's your bottleneck
```

You don't get to pick the bottleneck. The measurement tells you. This connects directly to [measure before you optimize](../../09-scientific-and-hypothesis-driven/03-measure-before-optimize/) — guessing wastes the effort that finding the real constraint would have saved.

## 5. A tiny taste of Amdahl's law

Here's the math that proves "speed up the small part = wasted effort."

Suppose a task takes 100 seconds. 90 of those seconds are one slow part; 10 seconds are everything else.

- You make the **everything else** infinitely fast (10s → 0s). New time: 90s. You shaved **10%**.
- You make the **slow part** 2× faster (90s → 45s). New time: 55s. You shaved **45%**.

Even *infinitely* fast on the small part beats a modest improvement on the big part. The lesson, which you'll see formalized later: **the most you can gain is limited by the size of the part you're not touching.** Work on the big part.

## 6. High-leverage vs low-leverage moves

Not all engineering tasks are equal. Some change the whole system; most don't.

| Low leverage (busywork) | High leverage |
|---|---|
| Micro-optimizing a fast function | Fixing the one slow query everything waits on |
| Reformatting code, renaming variables | Fixing the flaky test that blocks every deploy |
| Speeding up a stage with spare capacity | Speeding up the actual bottleneck stage |
| Adding a 5th retry to a working call | Removing the manual approval step that delays every release |

The high-leverage moves share a shape: they touch the **one thing everything else depends on or waits for**. A flaky test that fails 1-in-5 CI runs blocks the whole team's merges — fixing it is worth more than a month of small speedups, because it's the constraint on shipping.

> Before starting any task, ask: **is this the constraint, or am I just busy?**

## 7. The simple checklist

For now, the junior version of this skill is a habit, not a theory:

1. **What is the result I want to improve?** (page speed, throughput, deploy time)
2. **Measure where the time/effort actually goes.** Don't guess. Use a profiler, timers, or `EXPLAIN`.
3. **Find the single slowest part** — that's the bottleneck.
4. **Work only on that part.** Everything else is wasted effort right now.
5. **Re-measure.** The bottleneck moved. Repeat from step 2.

That loop — measure, find the constraint, fix it, re-measure — is the entire foundation. Everything in the higher levels (Theory of Constraints, Amdahl's law, Donella Meadows' leverage hierarchy, org-level constraints) is a deeper version of this one loop.

## Where this sits

- It builds on [parts, whole, and emergence](../01-parts-whole-and-emergence/) — the bottleneck is a property of the *whole*, not any single part in isolation.
- The bottleneck "moving" is a [second-order effect](../03-second-order-effects/) — fixing one thing changes what the next problem is.
- Next, [middle](./middle.md) introduces Goldratt's Theory of Constraints and the five focusing steps that turn this habit into a repeatable method.
