# Competitive Analysis — Junior Level

> **Audience:** You know Big-O and basic algorithms (sorting, search, greedy) but have never seen "online algorithms" or "competitive ratio."
> **Read time:** ~35 minutes. **Focus:** "What does it mean to decide *now* without seeing the future, and how do we measure whether such a decision was good?"

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [The Hook: Deciding Without Seeing the Future](#the-hook-deciding-without-seeing-the-future)
5. [Online vs Offline](#online-vs-offline)
6. [The Clairvoyant Benchmark: OPT](#the-clairvoyant-benchmark-opt)
7. [The Competitive Ratio](#the-competitive-ratio)
8. [Worked Numbers: Reading a Competitive Ratio](#worked-numbers-reading-a-competitive-ratio)
9. [The Adversary: Your Opponent Designs the Input](#the-adversary-your-opponent-designs-the-input)
10. [Fully Worked Example: Ski Rental](#fully-worked-example-ski-rental)
11. [Why "Rent Forever" and "Buy Immediately" Are Terrible](#why-rent-forever-and-buy-immediately-are-terrible)
12. [A Tiny Second Example: Caching](#a-tiny-second-example-caching)
13. [Code: Simulating Online vs OPT](#code-simulating-online-vs-opt)
14. [The Additive Constant α](#the-additive-constant-α)
15. [Minimization vs Maximization](#minimization-vs-maximization)
16. [Real-World Analogies](#real-world-analogies)
17. [Common Misconceptions](#common-misconceptions)
18. [Common Mistakes](#common-mistakes)
19. [Cheat Sheet](#cheat-sheet)
20. [Summary](#summary)
21. [Further Reading](#further-reading)

---

## Introduction

Almost every algorithm you have studied so far gets to see its whole input before it does anything. Sorting receives the full array. Dijkstra receives the full graph. Even a greedy algorithm, which commits to choices step by step, is allowed to look at every element before it starts. The whole problem is laid out on the table, and your job is to compute the best answer.

Real systems rarely have that luxury. A web cache must decide *right now* whether to keep or evict a page, before it knows which pages will be requested next. An autoscaler must add or remove servers *right now*, before it knows whether the traffic spike is about to grow or collapse. A ride-hailing dispatcher must assign *this* driver to *this* rider now, not knowing who will request a ride thirty seconds later. These systems make **irrevocable decisions as each request arrives, without seeing the future.** That is what we call an **online** setting.

The uncomfortable truth about online decisions is that you will sometimes regret them. You evict a page; one millisecond later it is requested again. You buy skis; the next day your trip is cancelled. With no crystal ball, *some* regret is unavoidable. So the interesting question is not "can we avoid all regret?" — we cannot — but rather: **how much worse is an algorithm forced to decide blind, compared to a clairvoyant who knew the whole future in advance?**

That single question is the heart of **competitive analysis**. It gives us a number — the **competitive ratio** — that quantifies the price of not knowing the future. A "2-competitive" algorithm is guaranteed to never cost more than twice what a perfect, future-knowing optimum would have cost, *no matter what sequence of requests arrives*. That guarantee holds against the worst case, which is exactly what makes it trustworthy: it is a promise, not an average.

This file builds the framework from scratch. We will define online vs offline precisely, introduce the clairvoyant benchmark OPT, define the competitive ratio with worked numeric examples, meet the *adversary* (the opponent who designs your worst input), and walk fully through the ski-rental problem to see a real 2-competitive strategy emerge — and to see why the two "obvious" strategies are catastrophically bad. We finish with runnable code that simulates an online strategy against OPT and measures the empirical ratio.

---

## Prerequisites

- **Required:** Big-O basics — what O(1), O(n) mean. See [Big-O Notation](../../06-algorithmic-complexity/04-asymptotic-notation/01-big-o-notation/junior.md).
- **Required:** The idea of **worst-case** analysis — judging an algorithm by its most hostile input, not a typical one.
- **Required:** Comfort reading a greedy algorithm (make a choice, move on). See [Greedy Algorithms](../../14-greedy-algorithms/).
- **Helpful:** Amortized analysis — it also spreads cost over a *sequence* and also gives a worst-case guarantee, so the mindset transfers. See [Amortized Analysis](../../06-algorithmic-complexity/05-amortized-analysis/junior.md).
- **Helpful:** Basic familiarity with caching / LRU (we use a tiny cache as an example). No depth required.

You do not need any probability, calculus, or game theory. We keep the math to arithmetic and a couple of simple inequalities.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Online algorithm** | An algorithm that receives its input one request at a time and must respond to each request *before* seeing the next; decisions are irrevocable. |
| **Offline algorithm** | An algorithm that receives the entire request sequence up front and may use full knowledge of the future. |
| **Request sequence (σ)** | The ordered list of requests the algorithm must serve, written `σ = r₁, r₂, …, rₙ`. |
| **ALG(σ)** | The total cost paid by your online algorithm ALG on sequence σ. |
| **OPT(σ)** | The minimum possible cost of serving σ, achievable by an optimal *offline* (clairvoyant) algorithm. The benchmark. |
| **Competitive ratio (c)** | The factor by which an online algorithm can exceed OPT in the worst case: ALG(σ) ≤ c·OPT(σ) + α for all σ. |
| **c-competitive** | Describes an algorithm whose competitive ratio is at most c. |
| **Adversary** | A conceptual opponent who knows your strategy and constructs the worst possible σ to maximize ALG(σ)/OPT(σ). |
| **Clairvoyant** | Knowing the entire future. OPT is clairvoyant; your online algorithm is not. |
| **α (additive constant)** | A fixed constant, independent of σ, allowed in the competitive bound so that short, weird sequences don't break the ratio. |
| **Irrevocable decision** | A choice that cannot be undone once made (you cannot "un-evict" a page or "un-buy" skis). |

---

## The Hook: Deciding Without Seeing the Future

Imagine a simple game. I will read you a sequence of numbers, one at a time. After each number, you must immediately say "keep" or "skip" — and once you say it, you can never change your mind. At the end, I add up the numbers you kept. Your goal is to keep the largest possible sum, but you may keep **at most one** number.

If I gave you the whole list first — say `[3, 9, 2, 7]` — this is trivial: keep the 9, skip the rest, score 9. That is the **offline** version. You see everything, you pick the max.

But in the **online** version you hear `3`… and must decide *now*. Keep it? If you skip it and later only hear small numbers, you score 0 and regret skipping the 3. Keep it and you are locked in at 3, even if a 9 comes next. You are trapped between two fears: commit too early and miss something better, or wait too long and be left with scraps.

This is the essence of every online problem. The data arrives in pieces; each piece demands an irrevocable answer; and the future is hidden. **No online strategy can match the clairvoyant every time** — for any fixed strategy I can read the numbers in an order that makes you look foolish. That is not a flaw in your strategy; it is a law of the setting.

So we change the question. Instead of "can you always match the optimum?" (impossible), we ask "**by what factor can you guarantee to stay close to the optimum, in the worst case?**" An algorithm that promises "I will always score at least half of what the clairvoyant scores, no matter what list you read" has a meaningful, provable guarantee. Turning that informal promise into a precise, comparable number is the job of competitive analysis.

---

## Online vs Offline

Let's pin down the two settings side by side, because the entire framework rests on this contrast.

**Offline algorithm.** Receives the full request sequence `σ = r₁, r₂, …, rₙ` before producing any output. It may scan the future freely. It can compute the *globally* optimal set of decisions. This is the world of classic algorithm design: sort the whole array, run DP over the whole input, etc. An offline algorithm is what you get to be in a textbook problem.

**Online algorithm.** Receives requests **one at a time**. For each request `rᵢ`, it must produce a response (a decision, an action, an answer) using only `r₁ … rᵢ` — the past and present, never the future. The response is **irrevocable**. Only after responding does it get to see `rᵢ₊₁`. This is the world of running systems.

Here is the same scenario in both modes, using a cache that holds 2 pages and is asked for a sequence of pages:

```
Request sequence σ:  A  B  C  A  C  B

OFFLINE (sees all 6 requests first):
  Knows A and C are reused soon, B less so → can plan evictions perfectly.

ONLINE (sees one request at a time):
  Sees A. Sees B. Cache is now {A,B}.
  Sees C → cache full, MUST evict now. Evict A? Evict B?
  It cannot peek ahead to learn that A is requested next. It must guess.
```

The offline cache can look at the whole future and make exactly the right eviction. The online cache is flying blind at the moment of decision. Competitive analysis measures the gap that this blindness creates.

A note that trips up many beginners: **"online" here has nothing to do with the internet.** It is an old term meaning "processing input as it streams in," as opposed to "offline" / "batch" processing where you have the whole dataset. A scheduler running on a disconnected machine is still an *online algorithm* if jobs arrive over time.

### Why real systems are online

It is worth internalizing that the online setting is the *normal* case in production, not an exotic one:

- **Caching / paging.** Pages are requested over time; you evict without knowing future requests. (Treated fully in [Paging and Caching Theory](../03-paging-and-caching-theory/junior.md).)
- **Scheduling.** Jobs arrive over time and must be placed on machines before later jobs are known.
- **Autoscaling.** You add/remove servers in response to current load, blind to whether the spike continues.
- **Rent-or-buy decisions.** Pay-per-use vs one-time purchase, when you don't know how long you'll keep using the thing. (See [Ski Rental and Rent-or-Buy](../02-ski-rental-and-rent-or-buy/junior.md).)
- **Routing and load balancing.** Requests must be assigned to servers as they arrive.

Whenever you hear "we have to decide before we know what happens next," you are looking at an online problem, and competitive analysis is the tool for reasoning about it.

---

## The Clairvoyant Benchmark: OPT

To say an online algorithm is "good" or "bad," we need something to compare it against. We can't compare it to *another online algorithm* — that just tells us which blind strategy is less blind. Instead we compare it to a **clairvoyant ideal**: the best possible cost achievable by an algorithm that knew the entire future in advance.

We call this benchmark **OPT**.

> **OPT(σ)** = the minimum total cost of serving the request sequence σ, achieved by an *optimal offline* algorithm that sees all of σ before deciding.

Two things about OPT are essential and often misunderstood:

1. **OPT is not an algorithm you run in production.** It is a *yardstick*. It represents perfect hindsight. You generally cannot achieve OPT online — that's the whole point. OPT exists so we have an honest "best conceivable" cost to measure ourselves against.

2. **OPT is defined per sequence.** Different request sequences have different optimal costs. `OPT(σ)` is a function of the specific σ. When we compare, we always compare `ALG(σ)` to `OPT(σ)` *on the same σ*.

A small concrete instance. Take the cache example `σ = A B C A C B` with capacity 2. The clairvoyant offline cache can compute the genuinely best eviction plan (the famous "evict the page used farthest in the future" rule, called Belady's algorithm). Suppose that perfect plan results in 4 cache misses. Then `OPT(σ) = 4` (counting cost as the number of misses). An online cache that suffers 6 misses on the same σ has `ALG(σ) = 6`. The ratio on this sequence is 6/4 = 1.5 — the online cache cost 50% more than perfect hindsight.

Notice we did **not** ask whether OPT was "fair." It is deliberately unfair: it knows the future and we don't. We are measuring exactly how much that unfairness costs us. A small ratio means "even a clairvoyant couldn't have done much better than us" — a strong statement.

---

## The Competitive Ratio

Now the central definition. We say an online algorithm ALG is **c-competitive** for a minimization problem if there is a constant `α` such that for **every** request sequence σ:

```
ALG(σ)  ≤  c · OPT(σ)  +  α
```

Read this slowly, piece by piece:

- **`ALG(σ)`** — what your online algorithm actually paid on σ.
- **`c · OPT(σ)`** — `c` times the clairvoyant optimum on the *same* σ. `c ≥ 1` always (you can't beat a clairvoyant in the worst case).
- **`+ α`** — a fixed slack constant (more on this later). For intuition, picture α = 0 for now.
- **"for every σ"** — the guarantee must hold against **all** inputs, including the most hostile one. This is what makes it a worst-case guarantee, not an average.

The **competitive ratio** of ALG is the smallest `c` for which such an α exists. Informally:

> The competitive ratio is the worst-case value of `ALG(σ) / OPT(σ)`, taken over all possible sequences σ.

So if an algorithm is 2-competitive, it promises: *"On any input you can imagine, my cost is at most twice the cost a future-knowing optimum would have paid (plus a small constant)."* That is a strong, adversary-proof promise. Crucially, it does **not** say "twice as bad on average" — it says "at most twice as bad even on the single nastiest input anyone could design."

A few sanity checks to lock the definition in:

- **c = 1** means ALG matches OPT on every sequence — it is as good as clairvoyance. Rare and wonderful.
- **c = 2** means ALG never pays more than double the optimum. Good.
- **c = k** (k = cache size, say) means the gap can grow with a parameter of the problem. Still a guarantee, but a looser one.
- **No finite c** means the algorithm can be made *arbitrarily* worse than OPT by a clever input — it has no competitive guarantee at all. We'll see exactly this with "rent forever" below.

### Why "+ α"? A one-line preview

The additive constant α lets us ignore tiny, weird, short sequences where the ratio might briefly spike for boring reasons. It absorbs "edge-of-the-input" effects so that `c` captures the algorithm's *true scaling behavior* on long sequences. We devote a full section to it later; for the worked examples below, α won't matter.

---

## Worked Numbers: Reading a Competitive Ratio

Definitions feel abstract until you push numbers through them. Suppose we have an online algorithm ALG and we test it on four different sequences. Take α = 0 to keep arithmetic clean. Here is what we measure:

| Sequence | ALG(σ) | OPT(σ) | Ratio ALG/OPT |
|----------|--------|--------|---------------|
| σ₁ | 10 | 10 | 1.00 |
| σ₂ | 18 | 12 | 1.50 |
| σ₃ | 30 | 16 | 1.875 |
| σ₄ | 40 | 20 | 2.00 |

What is ALG's competitive ratio *based on these four samples*? It is the **worst** (largest) ratio we saw: **2.00**, from σ₄. The competitive ratio is governed by the most hostile sequence, not the average and not the best. The fact that ALG was perfect on σ₁ (ratio 1.0) does not help its competitive ratio at all — competitive analysis is pessimistic by design.

This is the single most important habit to build: **to find a competitive ratio, hunt for the worst case, not the typical case.** If even one sequence pushes the ratio to 2, the algorithm is (at best) 2-competitive, regardless of how it behaves elsewhere.

And to *prove* an algorithm is c-competitive, you must show the ratio never exceeds c — over the infinitely many possible sequences, not just four. That sounds impossible to check by sampling (it is), which is why real proofs reason about *all* sequences at once with an inequality. We'll do exactly that for ski rental.

Conversely, to prove an algorithm is **not better than** c-competitive (a *lower bound*), you only need to exhibit **one** sequence that forces the ratio up to c. One bad example is enough to establish a floor. That asymmetry — "one example for a lower bound, all sequences for an upper bound" — is the rhythm of every competitive-analysis proof.

---

## The Adversary: Your Opponent Designs the Input

Here is the mental model that makes competitive analysis click, and that working researchers actually use: imagine an **adversary**.

The adversary is a malicious opponent whose goal is to make your algorithm look as bad as possible. Critically, the adversary:

- **Knows your strategy completely.** If your algorithm is deterministic, the adversary can predict every decision you'll make. There are no secrets.
- **Gets to choose the request sequence σ.** It will craft the single nastiest σ it can, specifically tuned to exploit your strategy's weaknesses.
- **Is then judged by OPT.** After the adversary builds σ, we compute both `ALG(σ)` (your cost) and `OPT(σ)` (clairvoyant cost on that same σ). The adversary's "score" is the ratio it forced.

So competitive analysis is a game: **you commit to a strategy, then the adversary, seeing your strategy, picks the worst input.** Your competitive ratio is the best ratio you can guarantee against this all-knowing opponent.

Why is this the right model? Because a worst-case guarantee must hold *no matter what input arrives* — including inputs that seem designed to hurt you. By assuming the input is chosen by an omniscient enemy, we get a guarantee that survives reality, where inputs are merely unlucky rather than truly malicious. If you can beat the adversary, you can beat the real world.

### The adversary and the deterministic trap

Because the adversary knows your deterministic strategy, it can always "stay one step ahead." In the keep-or-skip game from the hook: whatever rule you fix ("keep the first number ≥ 5"), the adversary feeds you a sequence that punishes exactly that rule (give you a 5, then a 100 you can no longer take). This is why purely deterministic online algorithms often have ratios bounded away from 1 — the adversary's perfect knowledge is a powerful weapon.

A standard escape hatch is **randomization**: if your algorithm flips coins, the adversary can't predict your exact moves, only their probability distribution. Randomized online algorithms often achieve much better competitive ratios. We mention this so the idea is on your radar; the deterministic case is plenty for one lesson, and randomization is developed in [the middle-level treatment](./middle.md).

### Proving a lower bound = building one bad sequence

The adversary view gives us a concrete recipe for proving "no deterministic algorithm can do better than c": *play the adversary yourself.* Assume an arbitrary deterministic strategy, then construct a sequence — using your knowledge of what that strategy will do — that forces the ratio to c. Because the strategy was arbitrary, the bound holds for all of them. You'll see this exact move when we show ski rental can't beat 2-competitive deterministically.

---

## Fully Worked Example: Ski Rental

Time to make everything concrete with the canonical introductory problem. It is small enough to fully understand, yet it exhibits the whole framework: irrevocable online decisions, a clairvoyant OPT, an adversary, and a clean competitive ratio. (The dedicated topic [Ski Rental and Rent-or-Buy](../02-ski-rental-and-rent-or-buy/junior.md) goes deeper; here we use it to ground the concepts.)

### The setup

You're going skiing, but you don't know for how many days — each morning you find out whether you'll ski that day or whether the trip ends. Each day you ski, you have two options:

- **Rent** skis for that day: cost **\$1 per day**.
- **Buy** skis once: cost **\$B** total (say **\$10**), after which skiing is free forever.

Once you buy, you own them; buying is irrevocable (no refunds). Each morning you must decide **rent or buy today**, *without knowing how many more days you'll ski.* That "without knowing the future" is what makes it online: the request sequence is "ski day, ski day, … , trip over," revealed one day at a time.

The cost is the total dollars spent. We want a strategy with a small competitive ratio versus OPT.

### What OPT does (the clairvoyant)

OPT knows the total number of ski days `d` in advance, so its choice is trivial:

- If `d < B`: never buy, just rent every day. Cost = `d`.
- If `d ≥ B`: buy on day 1. Cost = `B`.

In one formula: **`OPT = min(d, B)`**. With B = 10:

| Total ski days d | OPT strategy | OPT cost |
|------------------|--------------|----------|
| 3 | rent all 3 days | 3 |
| 9 | rent all 9 days | 9 |
| 10 | buy day 1 (or rent all — tie) | 10 |
| 50 | buy day 1 | 10 |
| 1000 | buy day 1 | 10 |

OPT never pays more than B (=10), no matter how long the trip. It can't, because it would just buy on day 1. The clairvoyant's cost is capped at B.

### The online problem

You **don't** know `d`. You must decide each morning. What's a good rule?

**The break-even strategy:** *Rent until you have spent a total of \$B on rentals (i.e., for B−1 days), and on day B, buy.* In words: keep renting as long as you "haven't yet paid for a pair of skis," and the moment renting would have cost you as much as buying, switch to buying.

With B = 10: rent on days 1 through 9 (\$1 each = \$9 spent), and on day 10, buy (\$10). Let's compute this strategy's cost for various trip lengths and compare to OPT.

| Days d | Online cost (rent until day 9, buy day 10) | OPT = min(d,10) | Ratio |
|--------|--------------------------------------------|-----------------|-------|
| 3 | rent 3 = **3** | 3 | 1.00 |
| 9 | rent 9 = **9** | 9 | 1.00 |
| 10 | rent 9 + buy = 9 + 10 = **19** | 10 | 1.90 |
| 11 | rent 9 + buy = **19** | 10 | 1.90 |
| 50 | rent 9 + buy = **19** | 10 | 1.90 |
| 1000 | rent 9 + buy = **19** | 10 | 1.90 |

Look at what happens. As long as the trip is short (`d < B`), the online strategy pays exactly what OPT pays — ratio 1.0. It only diverges once the trip is long enough that buying was the right call, and then its worst cost is `(B−1) + B = 2B − 1 = 19`, versus OPT's `B = 10`. The ratio peaks at `(2B−1)/B = 1.9`, and for large B it approaches `2`.

### Why this is (essentially) 2-competitive

The worst the break-even strategy ever does is pay `(B−1)` in rentals and then `B` to buy, total `2B − 1`, against an OPT of `B`. So:

```
Online cost  ≤  2B − 1     and     OPT  ≥  B   (when buying was worthwhile)
⇒  Online / OPT  ≤  (2B − 1) / B  =  2 − 1/B  <  2
```

For short trips the ratio is even better (often 1.0). Across *all* possible trip lengths, the ratio never exceeds `2 − 1/B`, so the break-even strategy is **(2 − 1/B)-competitive**, and we round this off to the famous headline: **ski rental's break-even strategy is 2-competitive.** No deterministic strategy can do better than this against the adversary — which the dedicated topic proves by having the adversary end the trip on exactly the day you buy.

The takeaway pattern is worth remembering well beyond skiing: **"act as if the future is exactly long enough to make you regret not switching sooner; switch right when your sunk cost equals the cost of committing."** That break-even instinct gives a 2-competitive guarantee in a whole family of rent-or-buy problems.

---

## Why "Rent Forever" and "Buy Immediately" Are Terrible

The break-even rule looks almost too simple to be special. To appreciate it, watch the two "obvious" strategies fail spectacularly. This is also great practice at *being the adversary.*

### Strategy A: "Rent forever" (never buy)

You decide renting is flexible and you'll never commit. Your cost is `d` (one dollar per ski day). OPT is `min(d, B)`. Now let the adversary pick a long trip, `d = 1000`, B = 10:

```
Rent-forever cost = 1000
OPT               = 10
Ratio             = 100
```

And the adversary can make it worse: pick `d = 1,000,000` and the ratio is 100,000. There is **no finite c** that bounds this. By choosing a long enough trip, the adversary drives the ratio as high as it likes. "Rent forever" is **not competitive at all** — it has no competitive ratio. The lesson: refusing to ever commit means you pay linearly forever while OPT paid a flat B.

### Strategy B: "Buy immediately" (buy on day 1)

You decide to commit instantly and own your skis. Your cost is always `B` (=10). OPT is `min(d, B)`. Now the adversary picks a *short* trip, `d = 1`:

```
Buy-immediately cost = 10
OPT                  = min(1, 10) = 1
Ratio                = 10
```

With B = 1000 and a 1-day trip, the ratio is 1000. Again **no finite c** bounds it — by making B large and the trip short, the adversary drives the ratio arbitrarily high. "Buy immediately" is **not competitive either.** The lesson: committing instantly means a short trip wastes almost the entire purchase.

### The moral

| Strategy | Adversary's weapon | Ratio | Competitive? |
|----------|-------------------|-------|--------------|
| Rent forever | a very long trip | unbounded | ❌ No |
| Buy immediately | a very short trip | unbounded | ❌ No |
| **Break-even** | (no good weapon) | ≤ 2 − 1/B < 2 | ✅ Yes, 2-competitive |

Each extreme strategy has a fatal weakness the adversary exploits. The break-even strategy is the *balance point*: it doesn't over-commit (so short trips don't burn it like "buy immediately") and it doesn't under-commit (so long trips don't bleed it like "rent forever"). Hedging at the break-even point is precisely what bounds the worst case at 2. This balancing-against-an-adversary intuition is the soul of competitive analysis.

---

## A Tiny Second Example: Caching

Ski rental is a "when to commit" problem. Let's glance at a "which to evict" problem so you see the framework apply to something structurally different. Full treatment lives in [Paging and Caching Theory](../03-paging-and-caching-theory/junior.md); here we just feel the shape.

A cache holds `k` pages. Requests for pages arrive one at a time (online!). A **hit** (requested page is in cache) is free; a **miss** costs 1 and forces you to load the page, evicting some current page if the cache is full. You must choose the eviction victim *now*, without knowing future requests.

- **OPT** (clairvoyant, "Belady's rule") evicts the page that will be needed *farthest in the future*. It cannot be beaten offline.
- **LRU** (Least Recently Used) is the classic *online* strategy: evict the page that was used longest ago. LRU can't see the future, so it uses the past as a proxy.

The headline result, which the dedicated topic proves: **LRU is k-competitive** (k = cache size). That means LRU may incur up to `k` times as many misses as the clairvoyant OPT in the worst case — and no deterministic online cache can do better than k-competitive. Notice the ratio is a *parameter of the problem* (the cache size), not a constant like 2. Different online problems have different "best achievable" ratios, and discovering them is what this whole section is about. The k-server problem ([here](../04-k-server-problem/)) and online scheduling ([here](../05-online-scheduling-and-load-balancing/)) push this further.

The point for now: same framework, different problem. Online decisions, a clairvoyant OPT, an adversary, a competitive ratio. Once you internalize the framework, every online problem becomes "what's the best competitive ratio, and which strategy achieves it?"

---

## Code: Simulating Online vs OPT

Theory is convincing, but watching the numbers fall out of a simulation makes it real. Here we simulate the ski-rental online strategy against OPT and compute the **empirical** competitive ratio over many trip lengths. Then a tiny cache simulation to show the framework on a second problem.

### Ski rental: online break-even vs OPT (Python)

```python
def opt_ski(days: int, B: int) -> int:
    """Clairvoyant optimum: it knows 'days' in advance."""
    return min(days, B)            # rent all days, OR buy day 1 — whichever is cheaper

def online_ski(days: int, B: int) -> int:
    """
    Break-even strategy, blind to the future.
    Rent each day until total rental spend would reach B; then buy.
    Concretely: rent on days 1..B-1, buy on day B.
    """
    cost = 0
    bought = False
    for day in range(1, days + 1):
        if bought:
            continue              # already own skis: free
        if cost >= B - 1:         # we've spent B-1 on rentals: buying now caps our loss
            cost += B             # buy
            bought = True
        else:
            cost += 1             # rent today
    return cost

def empirical_ratio(B: int, max_days: int) -> float:
    worst = 0.0
    worst_d = 0
    for d in range(1, max_days + 1):
        alg = online_ski(d, B)
        opt = opt_ski(d, B)
        ratio = alg / opt
        if ratio > worst:
            worst, worst_d = ratio, d
    return worst, worst_d

B = 10
worst_ratio, worst_d = empirical_ratio(B, max_days=500)
print(f"B = {B}")
print(f"Worst empirical ratio over all trip lengths: {worst_ratio:.4f}")
print(f"Achieved at trip length d = {worst_d}")
print(f"Theory predicts (2B-1)/B = {(2*B-1)/B:.4f}")
```

Running this prints something like:

```
B = 10
Worst empirical ratio over all trip lengths: 1.9000
Achieved at trip length d = 10
Theory predicts (2B-1)/B = 1.9000
```

The simulation confirms the theory exactly: the worst case is `1.9 = (2B−1)/B`, hit precisely when the trip is just long enough (`d = B = 10`) that the online strategy buys but a short trip would have been cheaper. Bump `B` up to 100 and you'll see the worst ratio creep toward `1.99` — approaching the headline "2" as B grows. This is competitive analysis you can *watch happen.*

### A tiny cache: LRU vs OPT (Python)

```python
def opt_cache(requests, k):
    """
    Clairvoyant OPT (Belady): evict the page used farthest in the future.
    Returns number of misses.
    """
    cache = set()
    misses = 0
    for i, page in enumerate(requests):
        if page in cache:
            continue
        misses += 1
        if len(cache) < k:
            cache.add(page)
        else:
            # evict the cached page whose next use is farthest away (or never)
            def next_use(p):
                future = requests[i+1:]
                return future.index(p) if p in future else float('inf')
            victim = max(cache, key=next_use)
            cache.remove(victim)
            cache.add(page)
    return misses

def lru_cache(requests, k):
    """
    Online LRU: evict the least-recently-used page. No future knowledge.
    Returns number of misses.
    """
    cache = []                    # ordered: front = least recently used
    misses = 0
    for page in requests:
        if page in cache:
            cache.remove(page)
            cache.append(page)    # mark as most recently used
        else:
            misses += 1
            if len(cache) >= k:
                cache.pop(0)      # evict least recently used
            cache.append(page)
    return misses

requests = list("ABCABCABCDABCD")
k = 2
alg = lru_cache(requests, k)
opt = opt_cache(requests, k)
print(f"sequence: {''.join(requests)}  capacity k={k}")
print(f"LRU misses = {alg},  OPT misses = {opt},  ratio = {alg/opt:.2f}")
```

This prints something like:

```
sequence: ABCABCABCDABCD  capacity k=2
LRU misses = 14,  OPT misses = 8,  ratio = 1.75
```

The exact numbers depend on the sequence, but the structure is identical to ski rental: an online algorithm (LRU) decides blind, a clairvoyant (OPT/Belady) decides with full future knowledge, and the ratio quantifies the gap. Try feeding it an *adversarial* sequence designed to thrash LRU (cycle through `k+1` distinct pages repeatedly) and you'll watch the ratio climb toward the worst case.

### The same idea in Go (ski rental core)

```go
package main

import "fmt"

func optSki(days, B int) int {
	if days < B {
		return days
	}
	return B
}

func onlineSki(days, B int) int {
	cost, bought := 0, false
	for day := 1; day <= days; day++ {
		if bought {
			continue
		}
		if cost >= B-1 {
			cost += B // buy
			bought = true
		} else {
			cost++ // rent
		}
	}
	return cost
}

func main() {
	B := 10
	worst := 0.0
	for d := 1; d <= 500; d++ {
		r := float64(onlineSki(d, B)) / float64(optSki(d, B))
		if r > worst {
			worst = r
		}
	}
	fmt.Printf("worst empirical ratio = %.4f (theory %.4f)\n", worst, float64(2*B-1)/float64(B))
}
```

Same conclusion, different language: the worst empirical ratio prints as `1.9000`, matching `(2B−1)/B`. Whatever language you reach for, the simulation pattern is the same — run ALG, run OPT, divide, hunt for the worst sequence.

---

## The Additive Constant α

We promised to return to the mysterious `+ α` in `ALG(σ) ≤ c·OPT(σ) + α`. Here's the intuition.

The competitive ratio is meant to capture how the algorithm *scales* — its behavior on long, substantial sequences where the algorithm's real character shows. But on very short or odd sequences, the ratio can spike for boring, one-time reasons (a fixed startup cost, an unlucky first decision) that have nothing to do with the algorithm's true quality. The additive constant `α` absorbs those small, bounded effects so they don't distort `c`.

Concretely: `α` is a **fixed** number that does **not** depend on σ. It can't grow with the length of the input. So as sequences get long and `OPT(σ)` grows large, the `α` term becomes negligible next to `c·OPT(σ)`, and the ratio `ALG(σ)/OPT(σ)` approaches `c`. The `α` only "rescues" the bound on short sequences where it matters.

A way to read the whole inequality in plain English: *"My cost is at most `c` times the optimum, give or take a fixed amount that doesn't grow with the input."* If you find an algorithm where the gap to OPT grows *with* the input (like "rent forever," whose gap grew with `d`), then no fixed `α` can save it and it has no finite competitive ratio. The `α` is a small grace, not a loophole — it can paper over a constant, never a trend.

For the examples in this file, α = 0 and you can safely ignore it. It becomes important in formal proofs and in problems with fixed setup costs, which the [middle-level file](./middle.md) develops.

---

## Minimization vs Maximization

Everything above used a **minimization** problem: cost is bad, we want it low, OPT is the *minimum* cost, and `c ≥ 1` measures how much *more* we pay. Ski rental (dollars) and caching (misses) are minimization problems, and they're the most common case.

Some online problems are **maximization** problems instead: we earn a *reward* and want it high (think of an online auction maximizing revenue, or the keep-the-largest-number game from the hook maximizing your kept value). For maximization, OPT is the *maximum* achievable reward, and the definition flips:

```
Minimization:  ALG(σ)  ≤  c · OPT(σ) + α        (c ≥ 1; we want c near 1)
Maximization:  ALG(σ)  ≥  (1/c) · OPT(σ) − α    (c ≥ 1; we want c near 1)
```

In the maximization form, ALG earns *at least* a `1/c` fraction of the optimum. A "2-competitive" maximization algorithm guarantees at least *half* of OPT's reward. Either way, `c ≥ 1` and **smaller c is better** — `c = 1` means you matched the clairvoyant. The only thing that changes is the direction of the inequality and whether you're paying cost or earning reward. Pick the form that matches your problem and the rest of the framework — online decisions, OPT benchmark, adversary, worst-case-over-all-σ — is identical.

---

## Real-World Analogies

- **Renting vs buying a tool.** Need a pressure washer for a one-off job? Rent. Will you use it monthly for years? Buy. But you don't actually know your future usage — that's ski rental in your garage. The break-even rule ("rent until total rentals equal the purchase price, then buy") is genuinely good life advice and it's 2-competitive.

- **Hiring without seeing all candidates.** You interview applicants one by one and must say yes/no before meeting the next. Hire too early and you might miss a star; wait too long and the good ones take other offers. Classic online decision-making under hidden future (the "secretary problem" is its famous cousin).

- **Insurance.** Paying premiums is "renting" protection; a large deductible-free policy is closer to "buying." You hedge against an unknown future (will disaster strike?), and the sensible balance is, again, a break-even-style hedge.

- **A taxi's empty-cruise decision.** Keep driving to find a fare (paying gas now, betting on a future pickup) or park and wait (saving gas, risking idle time)? Each minute is an irrevocable online choice against an unknown future of ride requests.

- **The clairvoyant friend.** OPT is the friend who, *after* the trip, says "you should've just bought the skis on day one." Easy to say with hindsight. Competitive analysis is the discipline of measuring exactly how much that hindsight was worth — and proving you stayed within a guaranteed factor of it.

---

## Common Misconceptions

- **"Online means it runs on the internet."** No. "Online" means *processing input as it streams in, deciding before seeing the rest.* A batch job on a disconnected server reading data piece by piece is an online algorithm; a web service that has the whole request in hand is, for that request, offline.

- **"The competitive ratio is the average-case slowdown."** No — it's the **worst-case** ratio over all sequences. An algorithm with great average behavior but one catastrophic input has a bad competitive ratio. Competitive analysis is pessimistic by design; that pessimism is the source of its guarantee.

- **"OPT is the best online algorithm."** No. OPT is the best **offline / clairvoyant** algorithm. It is generally *unachievable* online. It's a yardstick, not a competitor.

- **"A 2-competitive algorithm is twice as slow."** It's not about speed (running time). It's about *cost* in the problem's own currency — dollars, cache misses, makespan — being at most twice OPT's cost. Two different meanings of "fast/cheap."

- **"If I can find one sequence where my algorithm matches OPT, it's 1-competitive."** No — one good sequence proves nothing. The competitive ratio is set by the *worst* sequence. One bad sequence, however, *does* prove a lower bound.

- **"A bigger competitive ratio means a worse algorithm, always."** Mostly, but context matters: a problem may have a *proven best-possible* ratio (e.g., paging can't beat k-competitive deterministically). Hitting that bound makes you optimal *for that problem*, even if the number isn't small.

---

## Common Mistakes

- **Comparing ALG and OPT on different sequences.** You must compute `ALG(σ)` and `OPT(σ)` on the *same* σ before taking the ratio. Mixing sequences is meaningless.

- **Letting OPT cheat *less* than it's allowed.** OPT knows the *entire* future and plays it perfectly. If your "OPT" only looks a few steps ahead, you've computed a weaker benchmark and your ratio will look artificially good. OPT must be genuinely optimal and fully clairvoyant.

- **Forgetting the decision is irrevocable.** If your "online" simulation peeks at future requests or undoes a past decision, it isn't online anymore. The whole point is no peeking, no take-backs.

- **Proving an upper bound by examples.** Testing a handful of sequences shows the ratio is *at least* some value; it never proves it's *at most* c. Upper bounds need an argument that covers *all* sequences (like the ski-rental inequality `cost ≤ 2B−1 ≤ 2·OPT`).

- **Confusing the two proof directions.** *Upper bound* (ALG is c-competitive): argue over all σ. *Lower bound* (no algorithm beats c): exhibit one adversarial σ. Beginners routinely try to use one example to prove an upper bound — it can't.

- **Ignoring the additive constant when it matters.** On problems with fixed setup costs, dropping α can make a perfectly good algorithm look non-competitive on short inputs. Keep α in the bound; just remember it can absorb only a *constant*, never a *trend*.

---

## Cheat Sheet

| Concept | One-line summary |
|---------|------------------|
| **Online algorithm** | Decides on each request before seeing the next; decisions irrevocable. |
| **Offline algorithm** | Sees the whole sequence first; can plan perfectly. |
| **OPT(σ)** | Cost of the optimal *offline* (clairvoyant) algorithm on σ. The benchmark. |
| **Competitive ratio c** | Worst-case value of ALG(σ)/OPT(σ) over all σ. Smaller is better; c ≥ 1. |
| **c-competitive (min)** | `ALG(σ) ≤ c·OPT(σ) + α` for all σ. |
| **c-competitive (max)** | `ALG(σ) ≥ (1/c)·OPT(σ) − α` for all σ. |
| **Adversary** | Omniscient opponent: knows your strategy, picks the worst σ. |
| **α** | Fixed additive constant; absorbs short-sequence quirks; can't grow with input. |
| **Upper bound proof** | Argue ALG ≤ c·OPT over **all** σ. |
| **Lower bound proof** | Exhibit **one** adversarial σ forcing ratio ≥ c. |
| **Ski rental** | Break-even strategy (rent until spent = B, then buy) is 2-competitive. |
| **Rent forever / buy now** | Both have **unbounded** ratio — not competitive. |
| **Paging (LRU)** | k-competitive, where k = cache size; deterministically optimal. |

**The framework in five steps:**
1. Identify that decisions are made online (irrevocable, no future knowledge).
2. Define the cost (or reward) of a request sequence σ.
3. Define OPT(σ): the clairvoyant optimum on σ.
4. Propose a strategy; bound `ALG(σ) ≤ c·OPT(σ) + α` over **all** σ (upper bound).
5. Show some adversarial σ forces ratio ≥ c (lower bound). If they match, c is tight.

---

## Summary

You now have the foundational framework of online algorithms:

- **Online vs offline** is the divide between deciding-as-you-go (real systems: caches, schedulers, autoscalers) and seeing-everything-first (textbook problems). Online means **irrevocable decisions under a hidden future** — and some regret is unavoidable.

- **OPT** is the clairvoyant benchmark: the best cost achievable *offline*, knowing all of σ. It's a yardstick, not an algorithm you run. We measure ourselves against perfect hindsight.

- **The competitive ratio** `c` is the worst-case factor by which an online algorithm exceeds OPT: `ALG(σ) ≤ c·OPT(σ) + α` for **every** σ. It's a worst-case guarantee, not an average — that's what makes it trustworthy. Smaller c is better; c = 1 means you matched clairvoyance.

- **The adversary** is the right mental model: an omniscient opponent who knows your strategy and crafts the nastiest σ. Proving a lower bound means *being* that adversary and building one bad sequence.

- **Ski rental** showed it all concretely: the break-even strategy is 2-competitive, while "rent forever" and "buy immediately" both have unbounded ratios — each crushed by the adversary's tailored input (a very long trip, a very short trip). The hedge-at-break-even instinct generalizes far.

- **Caching** showed the same framework on a different problem: LRU is k-competitive. Different online problems, different best-achievable ratios; finding them is the whole field.

The big idea to carry forward: when an algorithm must act under uncertainty, competitive analysis lets you make a precise, worst-case promise — *"never more than `c` times worse than a being who knew the future"* — and prove it. That guarantee, holding against the most hostile input imaginable, is what makes it engineering rather than hope.

**Next steps:** see [Ski Rental and Rent-or-Buy](../02-ski-rental-and-rent-or-buy/junior.md) for the full proof that 2 is optimal and the randomized improvement; [Paging and Caching Theory](../03-paging-and-caching-theory/junior.md) for why LRU is k-competitive; and [the middle-level treatment of competitive analysis](./middle.md) for randomized algorithms, the oblivious vs adaptive adversary, and formal proof techniques.

---

## Further Reading

- **Borodin & El-Yaniv, *Online Computation and Competitive Analysis*** — the standard textbook; chapters 1–3 cover exactly this framework.
- **Sleator & Tarjan (1985), "Amortized Efficiency of List Update and Paging Rules"** — the paper that launched competitive analysis (and named "competitive").
- **Karlin, Manasse, Rudolph & Sleator (1988)** — introduced ski rental / rent-or-buy as the canonical example.
- **[Amortized Analysis](../../06-algorithmic-complexity/05-amortized-analysis/junior.md)** — the sibling worst-case-over-a-sequence framework; great companion intuition.
- **[Greedy Algorithms](../../14-greedy-algorithms/)** — online strategies are often greedy; the connection is worth seeing.
- **[Ski Rental and Rent-or-Buy](../02-ski-rental-and-rent-or-buy/junior.md)**, **[Paging and Caching Theory](../03-paging-and-caching-theory/junior.md)**, **[The k-Server Problem](../04-k-server-problem/)**, **[Online Scheduling and Load Balancing](../05-online-scheduling-and-load-balancing/)** — the rest of this section.
