# Ski Rental and Rent-or-Buy — Junior Level

> **Audience:** You have seen the competitive-analysis framework (competitive ratio, OPT, adversary) from [Competitive Analysis](../01-competitive-analysis/junior.md). You have never studied ski rental as its own problem.
> **Read time:** ~35 minutes. **Focus:** "When do I keep renting, and when do I commit to buying — without knowing how long I'll need the thing?"

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [The Ski Rental Story](#the-ski-rental-story)
5. [What OPT Does (the Clairvoyant)](#what-opt-does-the-clairvoyant)
6. [The Two Obvious Strategies, and Why They Fail](#the-two-obvious-strategies-and-why-they-fail)
7. [The Break-Even Strategy](#the-break-even-strategy)
8. [A Fully Worked Trace](#a-fully-worked-trace)
9. [Computing the Competitive Ratio](#computing-the-competitive-ratio)
10. [The Adversary's Best Shot](#the-adversarys-best-shot)
11. [A Table of Strategies vs Worst-Case Ratios](#a-table-of-strategies-vs-worst-case-ratios)
12. [The Intuition: Hedge at the Break-Even Point](#the-intuition-hedge-at-the-break-even-point)
13. [Rent-or-Buy in the Real World](#rent-or-buy-in-the-real-world)
14. [Spin-Then-Block Locks in Detail](#spin-then-block-locks-in-detail)
15. [Code: Simulating Break-Even vs OPT](#code-simulating-break-even-vs-opt)
16. [A Peek Ahead: Can We Beat 2?](#a-peek-ahead-can-we-beat-2)
17. [Common Misconceptions](#common-misconceptions)
18. [Common Mistakes](#common-mistakes)
19. [Cheat Sheet](#cheat-sheet)
20. [Summary](#summary)
21. [Further Reading](#further-reading)

---

## Introduction

There is a small decision you have probably made in real life without realizing it has a beautiful theory behind it. You need some piece of equipment — skis, a power tool, a software license, a cloud server — and you can either **pay a little each time you use it** (rent) or **pay a lot once and use it forever** (buy). If you knew exactly how much you'd use it, the choice would be trivial arithmetic. The catch is that you almost never know. You decide today, blind to how the future unfolds.

This is the **ski rental problem**, and it is the single most famous example in online algorithms — the "hello, world" of [competitive analysis](../01-competitive-analysis/junior.md). It is famous for three reasons. First, it is tiny: the whole problem fits in one sentence, and you can work every case by hand. Second, it is *complete*: it exhibits the entire framework — irrevocable online decisions, a clairvoyant OPT, an adversary, and a clean competitive ratio — with nothing extra to distract you. Third, and most importantly, it is *everywhere*: once you learn the shape of "pay-per-use vs pay-once under uncertainty," you start seeing it in spinlocks, in TCP connections, in cloud autoscaling, in caching, and in your own household.

The competitive-analysis file already used ski rental as a quick example to ground the definitions. This file is the dedicated, careful treatment. We will derive the famous **break-even strategy**, prove it is **2-competitive** (more precisely, `2 − 1/B`-competitive), watch the adversary try and fail to break it, build a full table of strategies against their worst-case ratios, and then — the payoff — map the abstract problem onto real systems engineering, with the **spin-then-block lock** as the headline application. We finish with runnable code that simulates the strategy against OPT and prints the empirical worst-case ratio, which you will watch land exactly on `2 − 1/B`.

If you take one idea away, let it be this: **when you don't know the future, commit at the moment your accumulated rental spend equals the purchase price.** That one rule is provably never worse than twice optimal, and it generalizes far beyond skiing.

---

## Prerequisites

- **Required:** The competitive-analysis framework — competitive ratio, OPT, adversary, the worst-case-over-all-inputs mindset. This file *uses* that vocabulary without re-deriving it. See [Competitive Analysis](../01-competitive-analysis/junior.md).
- **Required:** Big-O basics and comfort reading a small inequality like `(2B − 1)/B = 2 − 1/B`. See [Big-O Notation](../../06-algorithmic-complexity/04-asymptotic-notation/01-big-o-notation/junior.md).
- **Helpful:** Amortized analysis — it also reasons about cost over a *sequence* with a worst-case guarantee, so the mindset transfers. See [Amortized Analysis](../../06-algorithmic-complexity/05-amortized-analysis/junior.md).
- **Helpful:** A passing familiarity with locks/mutexes and TCP connections for the real-world applications. No depth required — we explain what we need.

No probability or calculus is needed for the core. The deterministic break-even analysis is pure arithmetic. (The randomized improvement that beats 2 is sketched at the end and developed in [the middle level](./middle.md).)

---

## Glossary

| Term | Definition |
|------|-----------|
| **Ski rental problem** | You ski an unknown number of days `D`. Each ski day you either rent for \$1 or buy once for \$B (free forever after). Decide day by day, blind to `D`. Minimize total cost. |
| **D (or d)** | The total number of days you end up skiing. *Unknown to you* while deciding; known to OPT. |
| **B** | The one-time purchase price, expressed as a multiple of the daily rental (rent = \$1/day, so buying = `B` rental-days). |
| **OPT(D)** | The clairvoyant minimum cost, achievable knowing `D` in advance: `OPT(D) = min(D, B)`. |
| **Break-even strategy** | Rent for the first `B − 1` days, then buy on day `B`. The canonical 2-competitive online strategy. |
| **Break-even point** | The usage level at which renting so far has cost as much as buying would have — here, day `B`. |
| **Competitive ratio** | Worst-case value of `ALG(D) / OPT(D)` over all `D`. For break-even it is `2 − 1/B`. |
| **2-competitive** | Cost is never more than twice OPT (here, slightly under: `2 − 1/B`). |
| **Rent-or-buy** | The general family: a recurring "pay-per-use vs pay-once" choice made under an unknown future. |
| **Spin-then-block** | The lock analogue: spin (rent CPU cycles) for a while, then block (buy a context switch) if the lock is still held. |

---

## The Ski Rental Story

Let's tell the story precisely, because every detail matters for the analysis.

You arrive at a ski resort. You will ski for some number of days `D`, but **you do not know `D`** — each morning you simply learn whether there's another ski day or whether the trip is over (weather, plans, a cancelled flight — the reason doesn't matter). For each day you actually ski, you face one choice, made *that morning*:

- **Rent** skis for the day: costs **\$1**, good for that day only.
- **Buy** skis outright: costs **\$B** once (say **\$10**), after which every future ski day is **free**.

Buying is **irrevocable** — no refunds, no resale. Renting is per-day and carries no commitment. Your total cost is the sum of all your daily decisions. You want it small.

To normalize, we measure everything in units of one day's rental: renting is \$1/day, and the purchase costs `B` of those units. So `B = 10` means "buying costs the same as 10 days of renting." This framing strips the problem to its essence: **how many rental-days is the purchase worth, and how do you decide to cross that line without seeing the future?**

Why is this *online* (in the [competitive-analysis](../01-competitive-analysis/junior.md) sense)? Because the input — the sequence "ski day, ski day, …, trip over" — is revealed one day at a time, and each morning's rent-or-buy decision is irrevocable and made with no knowledge of how many ski days remain. You are deciding blind, exactly the setting where competitive analysis applies.

Here is the timeline, drawn out:

```
Morning 1:  ski today? YES → rent or buy?  (you don't know if there's a day 2)
Morning 2:  ski today? YES → rent or buy?  (you don't know if there's a day 3)
   ...
Morning D:  ski today? YES → rent or buy?
Morning D+1: ski today? NO  → trip over. Tally the bill.
```

You never get to see "Morning D+1" coming. The adversary controls when the trip ends.

---

## What OPT Does (the Clairvoyant)

Before judging any online strategy, we need the benchmark: **OPT**, the clairvoyant who knows `D` in advance. (Recall from [competitive analysis](../01-competitive-analysis/junior.md) that OPT is a yardstick, not an algorithm you run — it represents perfect hindsight.)

Knowing `D`, OPT's choice is a one-line decision:

- If `D < B`: the trip is short, so **never buy** — just rent every day. Cost = `D`.
- If `D ≥ B`: the trip is long enough that buying pays off, so **buy on day 1**. Cost = `B`.

In a single formula:

> **`OPT(D) = min(D, B)`**

With `B = 10`:

| Total ski days `D` | OPT strategy | OPT cost |
|------------------|--------------|----------|
| 1 | rent the 1 day | 1 |
| 5 | rent all 5 days | 5 |
| 9 | rent all 9 days | 9 |
| 10 | buy day 1 (ties renting) | 10 |
| 30 | buy day 1 | 10 |
| 1000 | buy day 1 | 10 |

The crucial feature: **OPT's cost is capped at `B`.** No matter how long the trip, the clairvoyant never pays more than `B`, because it could always have bought on day 1. And for short trips, it pays the bare minimum `D`. This is the line we must stay close to. The whole challenge is that we can't see `D`, so we don't know whether we're in the "rent forever" world (`D < B`) or the "should have bought" world (`D ≥ B`) until it's too late.

Keep `OPT(D) = min(D, B)` firmly in mind — every ratio in this file divides some online cost by it.

---

## The Two Obvious Strategies, and Why They Fail

Faced with the problem, two strategies jump out immediately. Both are catastrophic, and seeing exactly *how* they fail is the best motivation for the clever one. This is also great practice at **being the adversary**: you fix a strategy, then design the input that humiliates it.

### Strategy A: "Buy on day 1" (commit instantly)

You reason: "Buying is cheaper for long trips, so I'll just buy immediately and never rent." Your cost is always `B`, no matter what. Now let the adversary pick a **short** trip — say `D = 1`, with `B = 10`:

```
Buy-on-day-1 cost = 10   (you bought, then skied one day)
OPT               = min(1, 10) = 1   (just rent the single day)
Ratio             = 10 / 1 = 10
```

You paid ten times what you needed to. And the adversary can crank `B` higher: with `B = 1000` and a 1-day trip, the ratio is `1000`. By making `B` large and the trip short, the adversary drives the ratio **arbitrarily high** — there is **no finite `c`** bounding it. "Buy immediately" is *not competitive at all*. The regret here is **regret-for-buying**: you committed to an expensive purchase that a one-day trip wasted.

### Strategy B: "Rent forever" (never commit)

You reason the opposite way: "Renting is flexible and I'll never lock myself in." Your cost is `D` (one dollar per ski day). Now the adversary picks a **long** trip — `D = 1000`, `B = 10`:

```
Rent-forever cost = 1000
OPT               = min(1000, 10) = 10   (buy on day 1)
Ratio             = 1000 / 10 = 100
```

And it gets worse without bound: `D = 1,000,000` gives a ratio of `100,000`. By choosing a long enough trip, the adversary drives the ratio as high as it likes — again **no finite `c`**. "Rent forever" is *not competitive either*. The regret here is **regret-for-renting**: you bled a dollar a day forever while OPT paid a flat `B` once.

### The shape of the dilemma

Notice the symmetry. Each obvious strategy is destroyed by the *opposite* kind of trip:

- "Buy now" dies to a **short** trip (you over-committed).
- "Rent forever" dies to a **long** trip (you under-committed).

Whatever you do, the adversary picks the trip length that exploits your bias. A good strategy must **hedge** — refuse to over-commit *and* refuse to under-commit. That balance point is the break-even strategy.

---

## The Break-Even Strategy

Here is the rule that hedges perfectly:

> **Break-even strategy:** Rent for the first `B − 1` days. If you're still skiing on day `B`, **buy** then. After buying, ski free forever.

In plain words: *keep renting as long as the total you've spent on rentals is less than the price of a pair of skis; the moment one more rental would push your rental spend to equal the purchase price, buy instead.* You commit exactly when your sunk rental cost reaches `B`.

With `B = 10`: rent on days 1 through 9 (spending \$1 each, \$9 total), and if day 10 arrives, buy (\$10). After that, free.

Why `B − 1` and then buy on day `B`, rather than some other threshold? Because day `B` is the **break-even point**: it's the first day where the cumulative rental you've already paid (`B − 1`) plus today's decision makes buying no worse than continuing to rent. Renting through day `B − 1` keeps you matching OPT exactly on every short trip (you never over-commit), while buying on day `B` caps your worst-case loss before the rentals run away (you never under-commit). It threads the needle between the two failures above.

A subtle but important point: the break-even strategy is **deterministic** and uses **no future knowledge**. It doesn't peek at `D`. It only looks at how much it has spent so far — a quantity entirely in the past and present. That's what makes it a legitimate online strategy.

Let's watch it run.

---

## A Fully Worked Trace

Take `B = 10` and trace the break-even strategy day by day, tracking running cost. We'll do a short trip and a long trip.

### Trace 1: a short trip, `D = 6`

| Day | Still skiing? | Already own skis? | Decision | Cost today | Running total |
|----:|:-------------:|:-----------------:|----------|-----------:|--------------:|
| 1 | yes | no | rent (spent < B) | 1 | 1 |
| 2 | yes | no | rent | 1 | 2 |
| 3 | yes | no | rent | 1 | 3 |
| 4 | yes | no | rent | 1 | 4 |
| 5 | yes | no | rent | 1 | 5 |
| 6 | yes | no | rent | 1 | 6 |
| 7 | **no — trip over** | — | — | — | **6** |

Break-even cost = **6**. OPT = `min(6, 10) = 6`. **Ratio = 1.00.** On a short trip, break-even is *perfect* — it never bought, so it matched the clairvoyant exactly.

### Trace 2: a long trip, `D = 30`

| Day | Still skiing? | Already own skis? | Decision | Cost today | Running total |
|----:|:-------------:|:-----------------:|----------|-----------:|--------------:|
| 1 | yes | no | rent | 1 | 1 |
| 2 | yes | no | rent | 1 | 2 |
| … | … | no | rent | 1 | … |
| 9 | yes | no | rent (9th rental) | 1 | 9 |
| 10 | yes | no | **BUY** (spent 9, buying caps loss) | 10 | 19 |
| 11 | yes | **yes** | ski free | 0 | 19 |
| … | yes | yes | ski free | 0 | 19 |
| 30 | yes | yes | ski free | 0 | 19 |
| 31 | **no — trip over** | — | — | — | **19** |

Break-even cost = **19** (nine \$1 rentals + one \$10 purchase, then free). OPT = `min(30, 10) = 10` (buy day 1). **Ratio = 19 / 10 = 1.90.**

Notice how the running total *freezes at 19* the moment you buy. No matter how long the trip continues — `D = 30`, `D = 300`, `D = 30000` — your cost is stuck at `19`, because owning is free. That's the power of buying: it bounds your downside. OPT's cost is likewise frozen at `10`. So the ratio for *every* long trip is `19/10 = 1.90`, and it never grows.

Now compare across many trip lengths in one table:

| Days `D` | Break-even cost | OPT = min(D, 10) | Ratio |
|--------:|----------------:|-----------------:|------:|
| 1 | 1 | 1 | 1.00 |
| 5 | 5 | 5 | 1.00 |
| 9 | 9 | 9 | 1.00 |
| **10** | **19** | **10** | **1.90** |
| 11 | 19 | 10 | 1.90 |
| 50 | 19 | 10 | 1.90 |
| 1000 | 19 | 10 | 1.90 |

The ratio is `1.00` for every short trip and jumps to its maximum `1.90` exactly at `D = 10` (the break-even day), then stays flat forever. **The worst case is `D = B`.** That single observation drives the whole proof.

---

## Computing the Competitive Ratio

Now let's nail down the worst-case ratio with a clean argument, not just a table.

**Step 1 — bound the online cost.** The most the break-even strategy can ever pay is: rent for `B − 1` days, then buy once. That's

```
break-even cost  ≤  (B − 1) · 1  +  B  =  2B − 1
```

It can pay *less* (on short trips it pays only `D < B`), but it never pays more than `2B − 1`. The cost is capped because, once you buy, skiing is free.

**Step 2 — bound OPT from below, when it matters.** The ratio is only interesting when the online cost is large, i.e., when you actually bought, which happens only if the trip reached day `B`, i.e., `D ≥ B`. But when `D ≥ B`, OPT buys on day 1 and pays exactly `B`. So in the only regime where break-even pays its maximum,

```
OPT  =  B
```

**Step 3 — divide.** In that worst regime,

```
break-even / OPT  ≤  (2B − 1) / B  =  2 − 1/B
```

And for short trips (`D < B`), break-even matches OPT exactly (ratio `1`), which is even better. So across **all** trip lengths, the ratio never exceeds `2 − 1/B`:

```
break-even cost  ≤  (2 − 1/B) · OPT(D)     for every D
```

That inequality — holding for *every* `D` — is exactly what it means (from the [competitive-analysis](../01-competitive-analysis/junior.md) definition) to be **`(2 − 1/B)-competitive`**. Since `2 − 1/B < 2` always, we round off to the famous headline:

> **The break-even strategy for ski rental is 2-competitive.**

Plug in numbers to feel it: `B = 10` gives `2 − 1/10 = 1.9`; `B = 100` gives `1.99`; `B = 1000` gives `1.999`. As `B` grows, the worst-case ratio creeps up toward (but never reaches) `2`. The "minus `1/B`" is the small bonus you get from the fact that on the worst day you'd already sunk `B − 1`, not a full `B`, into rentals.

This is a genuine **upper-bound proof**: it argues over *all* `D` at once with an inequality, not by testing examples. (Recall the rhythm from competitive analysis: upper bounds require an argument over all inputs; one example is never enough.)

---

## The Adversary's Best Shot

We claimed `D = B` is the worst case. Let's confirm it from the adversary's point of view, and use it to see *why no deterministic strategy can beat 2*.

The adversary knows your strategy is "rent until day `B`, then buy." Its job is to pick the `D` that maximizes your ratio. It reasons:

- If it ends the trip **before** day `B`, you only rented, you matched OPT, ratio `1`. Useless to the adversary.
- If it ends the trip on or **after** day `B`, you paid the full `2B − 1` and OPT paid `B`, ratio `2 − 1/B`. 

So the adversary's best move is to **let the trip reach day `B` so you commit to buying — and then end it immediately, on day `B` itself.** You just paid `B` to buy, and the trip ends that very day, so your purchase bought you nothing. Meanwhile OPT, knowing the trip was exactly `B` days, would have... well, `OPT(B) = min(B, B) = B`, so OPT pays `B`. Your `2B − 1` against OPT's `B` gives the ratio `2 − 1/B`. The adversary cannot do any better against the break-even strategy. That confirms `2 − 1/B` is *tight* for this strategy: it's not just an upper bound we proved, it's actually achieved.

### Why no deterministic strategy beats 2

Here's the deeper point. *Any* deterministic strategy is just "buy on some fixed day `t`" (it must pick a day to commit, or never commit). The adversary, knowing `t`, plays the same trick: let the trip reach day `t` so you buy, then end it on day `t`. You paid `(t − 1) + B` and skied `t` days; OPT paid `min(t, B)`. Working through the arithmetic, the best any fixed `t` can do is `t = B`, giving ratio `2 − 1/B`. Commit earlier and a short trip burns you (regret-for-buying); commit later and a moderately long trip bleeds you (regret-for-renting). **`2 − 1/B` is the best a deterministic online strategy can achieve** — break-even is optimal among deterministic strategies. (The full lower-bound argument and the randomized strategy that gets below 2 live in [the middle level](./middle.md).)

---

## A Table of Strategies vs Worst-Case Ratios

Let's collect every strategy we've discussed and stare at their worst-case behavior side by side, with `B = 10`. The "adversary's weapon" column names the trip length that maximizes each strategy's ratio.

| Strategy | Rule | Adversary's weapon | Worst-case ratio | Competitive? |
|----------|------|--------------------|-----------------:|:------------:|
| Buy on day 1 | commit instantly | a 1-day trip | `B` (= 10, → ∞ as B grows) | ❌ No |
| Rent forever | never commit | a very long trip | unbounded (→ ∞ with D) | ❌ No |
| Buy on day 2 | commit very early | a 1-day trip | `(1 + B)/1 = 11` | ❌ No (unbounded in B) |
| Buy on day `B/2` (= day 5) | commit early | end trip on day 5 | `(4 + 10)/5 = 2.8` | ⚠️ Bounded but worse than 2 |
| **Buy on day `B`** (break-even) | rent B−1, then buy | end trip on day `B` | **`2 − 1/B` (= 1.9)** | ✅ **Yes, optimal deterministic** |
| Buy on day `2B` (= day 20) | commit late | end trip on day 20 | `(19 + 10)/10 = 2.9` | ⚠️ Bounded but worse than 2 |

A few things to read out of this table:

- The two extremes ("buy now," "rent forever") are **unbounded** — no finite ratio. They have *no* competitive guarantee.
- Committing on *any* fixed day gives *some* bounded ratio (for days near `B`), but only `t = B` minimizes it. Buying too early (day 5) or too late (day 20) both land near `2.8–2.9` — worse than break-even.
- The minimum over all fixed days sits exactly at day `B`, value `2 − 1/B`. That's the bottom of the valley. Break-even isn't just *a* good strategy; it's *the* best deterministic one.

The U-shape is the whole story: regret-for-buying dominates when you commit too early (left side of the table), regret-for-renting dominates when you commit too late (right side), and the two regrets balance precisely at the break-even point.

---

## The Intuition: Hedge at the Break-Even Point

Strip away the arithmetic and here is the reusable instinct:

> **Spend on renting until your accumulated rental cost equals the purchase price; at that exact moment, buy.**

Why does balancing at the break-even point cap the worst case at `2 − 1/B`? Think of it as bounding two regrets simultaneously:

- **Regret-for-buying.** Suppose the trip ends right after you buy. You "wasted" the purchase. But you only buy *after* renting `B − 1` days, so your total is `2B − 1`, versus OPT's `B` (OPT, seeing a `B`-day trip, paid `B`). The waste is bounded: you're at most `(2B − 1)/B ≈ 2×` over.
- **Regret-for-renting.** Suppose the trip is enormous and you *should* have bought on day 1. But you *do* buy — on day `B` — so your rental bleeding stops at `B − 1`. Your total freezes at `2B − 1`, never growing with `D`, versus OPT's `B`. Again at most `≈ 2×`.

The magic is that the break-even point is the *unique* day where **both** regrets are simultaneously bounded by the same factor. Commit earlier and regret-for-buying grows (a short trip wastes a purchase you made too eagerly). Commit later and regret-for-renting grows (you keep paying \$1/day past the point you should have committed). Day `B` is where the two curves cross — the saddle that the adversary cannot exploit in either direction.

This is why the rule generalizes so widely: **any time you face "small recurring cost vs large one-time cost under an unknown future," renting until sunk cost equals the buy price is 2-competitive.** It is, quite literally, provably-good life advice — for skis, pressure washers, software licenses, and, as we'll see, CPU spinlocks.

---

## Rent-or-Buy in the Real World

Ski rental's fame comes from how often its skeleton appears in systems engineering. The pattern is always: a **cheap action you can repeat** (rent) versus an **expensive action that ends the recurring cost** (buy), chosen **without knowing how long the situation lasts**. Here are the canonical mappings.

| System | "Rent" (cheap, repeated) | "Buy" (expensive, once) | Unknown future |
|--------|--------------------------|--------------------------|----------------|
| **Spinlocks** | spin: burn CPU cycles waiting | block: pay a context switch | how long until the lock frees? |
| **TCP / connection reuse** | keep a connection alive (idle cost) | tear down + reconnect later (setup cost) | will another request come soon? |
| **Cloud VM warm/cold** | keep a VM warm (pay for idle compute) | let it go cold; eat a cold-start later | will traffic arrive before timeout? |
| **Cache / snapshot** | recompute on each access | materialize/snapshot once | how many future accesses? |
| **Buy vs lease (hardware)** | lease/rent monthly | purchase outright | how long will you need it? |

In every row, the break-even rule says: **keep renting until the accumulated rental cost equals the one-time buy cost, then buy.** And the guarantee is the same: you're never worse than `2 − 1/B` times the clairvoyant who knew the future.

A couple of these deserve a sentence each:

- **TCP keep-alive.** Holding an idle connection open consumes resources (memory, file descriptors) — that's "rent." Closing it and re-establishing later costs a full handshake (and, for TLS, a cryptographic negotiation) — that's "buy." The keep-alive *timeout* is exactly a break-even threshold: keep the connection until the cumulative idle cost would equal the reconnect cost, then close. Set it well and you're 2-competitive against an oracle that knew whether another request was coming.

- **Cloud cold starts.** A serverless platform keeping a function "warm" pays for idle compute (rent); letting it go cold saves that but forces a slow cold-start on the next call (buy, paid in latency). The warm-pool keep-alive window is a rent-or-buy threshold tuned to the same break-even logic.

- **Snapshot/materialization.** Recomputing a derived value on every read is "rent"; persisting it once (a cache entry, a materialized view) is "buy." Without knowing how many reads are coming, the break-even rule tells you when caching pays off.

The single most classic and instructive instance, though, is the spinlock. Let's give it its own section.

---

## Spin-Then-Block Locks in Detail

When a thread wants a lock that another thread currently holds, it has two ways to wait:

- **Spin** (busy-wait): sit in a tight loop repeatedly checking "is the lock free yet?" This burns CPU cycles but, the instant the lock frees, you grab it with essentially zero extra delay. Spinning is **cheap per unit time but wasteful if it lasts** — it's the "rent" action: each spin-cycle costs a little CPU.

- **Block** (sleep): tell the OS scheduler "wake me when the lock is available," and yield the CPU to someone else. This costs a **context switch** — saving your state, switching to another thread, and later a second context switch to wake you back up. That fixed cost is the "buy" action: pay it once and stop burning CPU.

The dilemma is pure ski rental. If the lock frees *very soon*, spinning was right — blocking would have wasted two context switches for a wait that was about to end (regret-for-buying). If the lock is held *for a long time*, blocking was right — spinning would have burned enormous CPU for nothing (regret-for-renting). And **you don't know in advance how long the current holder will keep the lock.** Online decision, unknown future, cheap-repeated vs expensive-once. Ski rental, wearing a systems-programming costume.

The mapping is exact:

| Ski rental | Spin-then-block lock |
|------------|----------------------|
| rent \$1/day | spin for one more "quantum" of CPU time |
| buy for \$B | block (pay one context switch, cost ≈ `B` spin-quanta) |
| `D` = trip length | how long until the lock actually frees |
| `OPT = min(D, B)` | spin if it'll free fast, else block immediately |
| break-even: rent `B−1`, then buy | **spin for ~`B` worth of CPU time, then block** |

So the break-even strategy becomes a real, widely-deployed locking policy: **spin for an amount of time roughly equal to the cost of a context switch; if the lock still isn't free, block.** This is called **adaptive** or **spin-then-block** locking, and it's 2-competitive — guaranteed within a factor of two of the unattainable oracle that knew exactly how long each lock would be held. Real implementations (futexes on Linux, adaptive mutexes in many runtimes) use exactly this hedge, sometimes with the spin threshold tuned by measured context-switch cost. When you next see a mutex that "spins a bit before sleeping," you're looking at the ski-rental break-even rule running in production.

---

## Code: Simulating Break-Even vs OPT

Let's watch the `2 − 1/B` bound fall out of a simulation. We run the break-even strategy and OPT over many trip lengths `D`, compute the ratio for each, and report the **empirical worst** — which should land exactly on `2 − 1/B`.

### Python

```python
def opt_ski(days: int, B: int) -> int:
    """Clairvoyant optimum: it knows 'days' in advance. OPT = min(days, B)."""
    return min(days, B)

def break_even_ski(days: int, B: int) -> int:
    """
    Break-even strategy, blind to the future.
    Rent until total rental spend reaches B-1; on day B, buy. Then ski free.
    """
    cost = 0
    bought = False
    for _day in range(1, days + 1):
        if bought:
            continue                 # own skis: today is free
        if cost >= B - 1:            # already spent B-1 renting → buy now
            cost += B                # pay the one-time purchase
            bought = True
        else:
            cost += 1                # rent today
    return cost

def empirical_worst_ratio(B: int, max_days: int):
    worst_ratio, worst_d = 0.0, 0
    for d in range(1, max_days + 1):
        alg = break_even_ski(d, B)
        opt = opt_ski(d, B)
        ratio = alg / opt
        if ratio > worst_ratio:
            worst_ratio, worst_d = ratio, d
    return worst_ratio, worst_d

if __name__ == "__main__":
    for B in (10, 100, 1000):
        worst, d = empirical_worst_ratio(B, max_days=5 * B)
        theory = (2 * B - 1) / B           # = 2 - 1/B
        print(f"B={B:>4}  worst ratio={worst:.4f} at D={d:>4}  "
              f"theory (2 - 1/B)={theory:.4f}")
```

Running this prints something like:

```
B=  10  worst ratio=1.9000 at D=  10  theory (2 - 1/B)=1.9000
B= 100  worst ratio=1.9900 at D= 100  theory (2 - 1/B)=1.9900
B=1000  worst ratio=1.9990 at D=1000  theory (2 - 1/B)=1.9990
```

Three things to notice, all predicted by the theory:

1. **The empirical worst ratio equals `2 − 1/B` exactly** — `1.9`, `1.99`, `1.999`. The simulation confirms the upper-bound proof.
2. **The worst case occurs precisely at `D = B`** — the break-even day, exactly where the adversary ends the trip to make your purchase worthless.
3. **As `B` grows, the ratio creeps toward 2** but never reaches it. The "minus `1/B`" shrinks but never vanishes.

This is competitive analysis you can *watch happen*: run ALG, run OPT, divide, hunt for the worst `D`.

### Go

```go
package main

import "fmt"

func optSki(days, B int) int {
	if days < B {
		return days
	}
	return B // min(days, B)
}

func breakEvenSki(days, B int) int {
	cost, bought := 0, false
	for day := 1; day <= days; day++ {
		if bought {
			continue // own skis: free
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
	for _, B := range []int{10, 100, 1000} {
		worst, worstD := 0.0, 0
		for d := 1; d <= 5*B; d++ {
			r := float64(breakEvenSki(d, B)) / float64(optSki(d, B))
			if r > worst {
				worst, worstD = r, d
			}
		}
		theory := float64(2*B-1) / float64(B) // 2 - 1/B
		fmt.Printf("B=%4d  worst ratio=%.4f at D=%4d  theory (2 - 1/B)=%.4f\n",
			B, worst, worstD, theory)
	}
}
```

Same conclusion, different language: the worst empirical ratio prints `1.9000`, `1.9900`, `1.9990`, each matching `(2B − 1)/B`, each achieved exactly at `D = B`. Whatever language you reach for, the simulation pattern is identical — run both strategies, divide, find the worst trip.

> **Try the adversary yourself.** Change `max_days` to anything ≥ `B`; the worst ratio never exceeds `2 − 1/B`, and it's always hit at `D = B`. Then try a *bad* strategy — buy on day `2*B` instead — and watch the worst ratio climb past `2`. The simulation makes the table from earlier tangible.

---

## A Peek Ahead: Can We Beat 2?

We proved `2 − 1/B` is the best a **deterministic** strategy can do — the adversary always ends the trip on the exact day you commit. But there's an escape hatch, the same one from [competitive analysis](../01-competitive-analysis/junior.md): **randomization.**

If you flip coins to decide *when* to buy — picking your buy-day from a cleverly chosen probability distribution rather than a fixed day `B` — the adversary can no longer end the trip on "the day you buy," because it doesn't know which day that is. It only knows the *odds*. This denies the adversary its perfect counter-move, and the expected competitive ratio drops from `2` down to about **`e/(e − 1) ≈ 1.58`**. That's a real, provable improvement — roughly 42% of the way from 2 back toward the ideal of 1 — bought purely with randomness, no extra information about the future.

You don't need the distribution or the proof yet; just carry away the shape of the idea: **deterministic ski rental is stuck at 2, but randomized ski rental gets to ≈ 1.58.** The full derivation — the optimal distribution, why `e` appears, and the oblivious-vs-adaptive adversary distinction — is developed in [the middle level](./middle.md).

---

## Common Misconceptions

- **"Break-even means buy as soon as one rental equals the daily savings."** No — break-even means buy when your *cumulative* rental spend reaches the *purchase price* `B`, i.e., on day `B`, not after a single rental. It's the running total that matters, not any one day.

- **"2-competitive means it costs twice as much as renting."** No. It means the worst-case cost is at most twice **OPT** — the clairvoyant optimum — not twice some other baseline. And on most trips it does far better than 2× (it matches OPT exactly on every short trip).

- **"The competitive ratio depends on `D`."** No — the *ratio for a given trip* depends on `D`, but the **competitive ratio** is the worst over all `D`, a single number: `2 − 1/B`. It's a property of the strategy, not of any particular trip.

- **"OPT is the best online strategy."** No (same point as in competitive analysis). OPT is the best **offline / clairvoyant** strategy — it knows `D`. You can't achieve it online; it's a yardstick.

- **"Spinlocks spin because spinning is faster."** Spinning is only faster *if the lock frees soon*. Spin-then-block hedges precisely because you don't know that. The spinning is bounded (by roughly the context-switch cost) exactly so the worst case stays 2-competitive.

- **"Randomization is cheating / uses future knowledge."** No — a randomized strategy uses no information about `D`. It just hides its decisions from the adversary by flipping coins, which is enough to beat the deterministic bound.

---

## Common Mistakes

- **Buying too early "to be safe."** Committing before day `B` (e.g., buy on day 2) feels prudent but *raises* your worst-case ratio — a 1-day trip now wastes most of an early purchase. Earlier is not safer; day `B` is the optimum.

- **Comparing your cost to renting instead of to OPT.** The benchmark is always `OPT(D) = min(D, B)`, on the *same* trip. Dividing by "what renting would have cost" gives a meaningless number.

- **Letting the simulation peek at `D`.** If your "online" code reads `days` to decide when to buy, it isn't online — it's secretly OPT. The break-even function must decide using only `cost` (the past), never `days` (the future).

- **Forgetting buying is irrevocable and renting is per-day.** If your model allows refunds or a "buy" that you can undo, you've changed the problem. The irrevocability is what makes the future-uncertainty bite.

- **Proving 2-competitiveness by examples.** Tracing a few `D` values shows the ratio *reaches* `2 − 1/B`; it doesn't prove it never *exceeds* it. The upper bound needs the inequality `cost ≤ 2B − 1 ≤ (2 − 1/B)·OPT` over **all** `D`.

- **Treating `B` as dollars, not rental-days.** Always normalize: rent = 1 unit/day, buy = `B` units. Mixing real currencies into the ratio (e.g., \$/day vs total \$) is the most common arithmetic slip.

---

## Cheat Sheet

```
THE PROBLEM
  Ski D days (D unknown). Each day: rent $1, or buy once for $B (free after).
  Decide each morning, blind to D. Minimize total cost.

THE BENCHMARK
  OPT(D) = min(D, B)        (clairvoyant: knows D; buys day 1 iff D >= B)
  OPT's cost is capped at B.

THE WINNING STRATEGY  (break-even)
  Rent days 1..B-1, then BUY on day B. Free forever after.
  Rule of thumb: buy when cumulative rental spend reaches the purchase price.

THE GUARANTEE
  Worst-case cost = (B-1) rentals + 1 buy = 2B - 1, hit at D = B.
  OPT(B) = B.   Ratio = (2B - 1)/B = 2 - 1/B  <  2.
  => break-even is (2 - 1/B)-competitive  ≈  2-COMPETITIVE.
  Optimal among DETERMINISTIC strategies. Randomized gets ≈ e/(e-1) ≈ 1.58.

WHY EXTREMES FAIL
  Buy on day 1   → 1-day trip → ratio B    (unbounded) ❌  regret-for-buying
  Rent forever   → long trip  → ratio → ∞  (unbounded) ❌  regret-for-renting
  Break-even balances both regrets at day B.

REAL-WORLD MAPPINGS  (rent = cheap/repeated, buy = expensive/once)
  Spinlocks ...... spin (CPU) then BLOCK (context switch)  ← the classic
  TCP keep-alive . hold connection vs reconnect handshake
  Cloud VM ....... keep warm vs cold-start
  Cache/snapshot . recompute each access vs materialize once
  Buy vs lease ... rent monthly vs purchase outright

THE GOLDEN RULE
  Rent until accumulated rental cost = buy price, then buy. → 2-competitive.
```

---

## Summary

Ski rental is the canonical online problem and the friendliest doorway into [competitive analysis](../01-competitive-analysis/junior.md). You ski an unknown number of days `D`; each day you rent for \$1 or buy once for \$B; you decide blind to `D`, against a clairvoyant **OPT** that pays `min(D, B)`.

- **The two obvious strategies are catastrophic.** "Buy on day 1" is crushed by a short trip (ratio `B`, unbounded); "rent forever" is crushed by a long trip (ratio → ∞). Each over- or under-commits, and the adversary picks the trip that exploits the bias.

- **The break-even strategy hedges:** rent for `B − 1` days, then buy on day `B`. Its worst case is `2B − 1` (rent `B − 1`, then buy), hit exactly at `D = B`, against OPT's `B`. The ratio is `(2B − 1)/B = 2 − 1/B < 2`, so it's **2-competitive** — and provably the *best* deterministic strategy.

- **The intuition generalizes far:** *commit the moment your accumulated rental cost equals the purchase price.* This balances regret-for-buying against regret-for-renting at the unique break-even point the adversary can't exploit.

- **It's everywhere in systems.** Spin-then-block locks (spin = rent CPU, block = buy a context switch) are the headline application — a real, deployed 2-competitive policy. The same skeleton governs TCP keep-alive, cloud warm/cold-start, cache materialization, and buy-vs-lease.

- **Randomization breaks the deterministic barrier:** flipping coins to hide your buy-day from the adversary drops the expected ratio from `2` to `≈ e/(e − 1) ≈ 1.58`.

The big idea to carry forward: under an unknown future, "rent until sunk cost equals the buy price, then buy" is a *provably* near-optimal rule — never worse than twice the cost of a being who knew the future. That's a guarantee you can deploy, in skis and in spinlocks alike.

**Next steps:** [Middle Level](./middle.md) for the deterministic lower-bound proof, the randomized `e/(e − 1)` strategy, and the oblivious-vs-adaptive adversary; [Paging and Caching Theory](../03-paging-and-caching-theory/junior.md) for a different online problem (which page to evict, not when to commit); and a refresher on the framework in [Competitive Analysis](../01-competitive-analysis/junior.md).

---

## Further Reading

- **Karlin, Manasse, Rudolph & Sleator (1988), "Competitive Snoopy Caching"** — introduced ski rental / rent-or-buy as the canonical online example, motivated precisely by the spin-vs-block lock problem.
- **Borodin & El-Yaniv, *Online Computation and Competitive Analysis*** — the standard textbook; covers ski rental, the randomized `e/(e−1)` strategy, and the lower bounds.
- **Karlin, Manasse, McGeoch & Owicki, "Competitive Randomized Algorithms for Nonuniform Problems"** — the randomized ski-rental result and the spin-block application in depth.
- **[Competitive Analysis](../01-competitive-analysis/junior.md)** — the framework (competitive ratio, OPT, adversary) this file builds on.
- **[Amortized Analysis](../../06-algorithmic-complexity/05-amortized-analysis/junior.md)** — the sibling worst-case-over-a-sequence mindset; good companion intuition.
- **[Ski Rental and Rent-or-Buy — Middle](./middle.md)** — randomized strategies, lower-bound proofs, and adversary models.
- **[Paging and Caching Theory](../03-paging-and-caching-theory/junior.md)** — the next online problem in this section.
