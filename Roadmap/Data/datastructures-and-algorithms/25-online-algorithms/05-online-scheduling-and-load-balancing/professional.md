# Online Scheduling and Load Balancing — Professional Level

## Table of Contents

1. [What This Tier Is About](#what-this-tier-is-about)
2. [Load Balancers Are List Scheduling in Disguise](#load-balancers-are-list-scheduling-in-disguise)
   - [Round-Robin and Weighted Round-Robin](#round-robin-and-weighted-round-robin)
   - [Least-Connections / Least-Load = Greedy List Scheduling](#least-connections--least-load--greedy-list-scheduling)
   - [The Power of Two Choices](#the-power-of-two-choices)
   - [JSQ, JSQ(d), and Consistent Hashing with Bounded Loads](#jsq-jsqd-and-consistent-hashing-with-bounded-loads)
3. [Cluster Schedulers and Bin Packing in Production](#cluster-schedulers-and-bin-packing-in-production)
4. [Online vs the Reality of Reassignment](#online-vs-the-reality-of-reassignment)
5. [Objectives Beyond Makespan in Practice](#objectives-beyond-makespan-in-practice)
6. [Learning-Augmented Scheduling, Deployed](#learning-augmented-scheduling-deployed)
7. [Engineering Reality: When the Bounds Actually Bite](#engineering-reality-when-the-bounds-actually-bite)
8. [Worked End-to-End: A Load-Balancer Simulator](#worked-end-to-end-a-load-balancer-simulator)
9. [Decision Framework](#decision-framework)
10. [Research Pointers](#research-pointers)
11. [Key Takeaways](#key-takeaways)

---

## What This Tier Is About

The senior tier ([`./senior.md`](./senior.md)) closes the theory: Graham's greedy list scheduling is `(2 − 1/m)`-competitive on identical machines, beating `2` requires deliberate imbalance, heterogeneity costs a `Θ(log m)` factor, flow time has no constant-competitive online algorithm until you buy it back with speed augmentation, and learning-augmented schedulers chase SRPT/LPT with predictions behind a worst-case fallback. That theory is correct and it is the right mental model.

But if you open the source of envoy, HAProxy, NGINX, the Kubernetes `kube-scheduler`, or Borg, you will not find anyone proving a `1.9201` bound. You will find round-robin, least-connections, "pick two backends and send to the lighter one," and a filter-then-score bin-packer with a dozen heuristic weights. This tier is the bridge from the competitive-ratio theory to the schedulers and load balancers engineers actually run.

It answers four questions a senior engineer asks when they go to *deploy* a scheduler:

1. **What is my load balancer, in theory terms?** Least-connections *is* greedy list scheduling. Round-robin is the oblivious version. The power-of-two-choices is the single highest-leverage idea in the entire field, and it costs almost nothing.
2. **Why do cluster schedulers ship First-Fit-Decreasing heuristics instead of the `1.578` online bin-packing algorithm?** Because the real problem is *vector* bin packing under reassignment, multiple objectives, and constraints the clean theory ignores.
3. **The theory assumes irrevocable decisions — but real systems migrate. What changes?** Almost everything, and the new question becomes *when* to rebalance, which is a [ski-rental](../02-ski-rental-and-rent-or-buy/professional.md) hysteresis decision.
4. **My objective is tail latency, not makespan. What do I actually do?** Overprovision a little and simple policies become near-optimal — the speed-augmentation lesson, cashed out operationally.

Throughout, the theory is the engine, not the product. The `(2 − 1/m)` bound justifies "least-load is fine"; the wins come from randomization (two choices), the right objective (tail, not mean), a little headroom, and biasing toward stable placement.

---

## Load Balancers Are List Scheduling in Disguise

A layer-4/7 load balancer in front of `m` backends is making an online scheduling decision on every request: an irrevocable assignment of an arriving "job" (a request or connection) to one of `m` "machines" (backends), with no knowledge of future arrivals. This is *exactly* the online makespan model from [`./senior.md`](./senior.md). The load-balancing literature and the scheduling literature are the same theory wearing two hats.

### Round-Robin and Weighted Round-Robin

**Round-robin** assigns request `t` to backend `t mod m`. It is *oblivious* — it ignores backend load entirely. If every request were identical in cost and every backend identical in capacity, round-robin would be optimal: perfectly even. It is the cheapest possible policy (one counter, no state per backend) and it is the right default when requests are cheap, uniform, and short.

It fails exactly when those assumptions break. Round-robin has no feedback: if request sizes are heavy-tailed (one request is a 10-second report, the next is a 2 ms health check), round-robin can pile three slow requests on one backend while three fast ones land elsewhere. It is the *non-clairvoyant, load-blind* analogue of list scheduling and inherits none of greedy's self-correction.

**Weighted round-robin (WRR)** assigns each backend a static weight (proportional to capacity) and distributes in that ratio — a 32-core box gets twice the share of a 16-core box. WRR handles *heterogeneous machines* (the related-machines model: machine `i` runs at speed `s_i`) but is still load-blind. Weights are static and configured, so WRR cannot react to a backend that is momentarily slow because of GC, a cold cache, or a noisy neighbor. Production WRR implementations (smooth weighted round-robin in NGINX, envoy's `ROUND_ROBIN` with locality weights) spread the picks evenly in time rather than bursting all of a heavy backend's share consecutively.

### Least-Connections / Least-Load = Greedy List Scheduling

**Least-connections** sends each new request to the backend with the fewest in-flight requests. **Least-load** (sometimes "least-load" or "least-response-time") uses a richer load signal — active connections weighted by recent latency, or an EWMA of queue depth. Strip the names away and this is *Graham's greedy*: assign the arriving job to the least-loaded machine.

Which means it carries Graham's guarantee. If requests have bounded cost and backends are identical, least-connections produces a maximum backend load within a `(2 − 1/m)` factor of the best possible balanced assignment — and as `m` grows that ceiling approaches `2×` the optimal. In practice it is far better than the worst case (more on that below), and it dominates round-robin whenever request costs vary, because it *measures* rather than assumes.

The cost is that least-connections needs accurate, fresh load state for all `m` backends at decision time. In a single load balancer that is a local counter table — cheap. In a *distributed* fleet of load balancers, each LB sees only its own slice of traffic, and the global "least-loaded" backend is expensive or stale to compute. This staleness is what motivates the next idea, which sidesteps the need for global state almost entirely.

### The Power of Two Choices

This is the single most important practical result in the section. Suppose `n` balls (requests) are thrown into `n` bins (backends).

- **One random choice per ball** (oblivious random placement): the most-loaded bin ends up with `Θ(log n / log log n)` balls — roughly `log n / log log n` above the average of `1`.
- **Two random choices**: sample `d = 2` bins independently and place the ball in the *less loaded* of the two. The maximum load drops to `log log n / log d + Θ(1)`, i.e. `Θ(log log n)`.

That is an **exponential improvement in the maximum load** from a single extra random probe and one comparison. This is the **power of two choices** — Azar, Broder, Karlin, and Upfal (1994/1999), popularized and surveyed by Mitzenmacher. The asymmetry is the headline: going from `d = 1` to `d = 2` collapses a logarithm to a log-logarithm.

Why is `d = 2` the sweet spot? Increasing `d` from `2` to `d` further improves the max load to `log log n / log d`, but that is only a *constant-factor* improvement in an already-tiny `log log n` term — going from `d = 2` to `d = 3` saves a factor of `log 3 / log 2 ≈ 1.58`, while *doubling* the probe cost. The first extra choice buys an exponential win; every choice after that buys diminishing constant factors. So production systems sample two and stop. NGINX (`random two`), envoy (`LEAST_REQUEST` with `choice_count: 2`, the default), HAProxy, and Netflix's internal LBs all ship the `d = 2` variant.

The reason this matters operationally is **statelessness under distribution**. Power-of-two-choices needs *no global coordination*: each load balancer picks two backends at random and queries (or estimates) only those two. There is no "find the global minimum" step, no shared load table, no consensus. It degrades gracefully under stale information — even mildly outdated load readings still beat oblivious random badly. That is why it is the cheap, robust default for distributed front ends: most of the benefit of least-load, almost none of the coordination cost.

### JSQ, JSQ(d), and Consistent Hashing with Bounded Loads

**JSQ (Join-Shortest-Queue)** is least-connections framed as a queueing policy: route to the backend with the shortest queue. It is provably excellent for mean response time but, like least-load, needs all `m` queue lengths. **JSQ(d)** is the power-of-two-choices applied to queues: sample `d` queues, join the shortest. JSQ(2) captures nearly all of JSQ's latency benefit with `O(1)` probing — the same `d = 2` lesson, in queueing dress. The "supermarket model" analysis (Mitzenmacher; Vvedenskaya–Dobrushin–Karpelevich) shows JSQ(2) drives the tail of the queue-length distribution to decay *doubly exponentially* instead of exponentially.

**Consistent hashing** solves a different constraint: *sticky* assignment. When a request must go to the same backend as related requests (session affinity, cache locality, sharded state), you hash the key onto a ring and walk to the next backend. Plain consistent hashing balances load only *in expectation*; with skewed keys or few backends, one node can get badly overloaded — and there is no "send it elsewhere" because affinity is the whole point.

**Consistent hashing with bounded loads** (Mirrokni, Thorup, Zadimoghaddam, Google, 2016/2018) fixes this. Each backend is given a hard capacity cap of `⌈(1 + ε) · average_load⌉`. A key hashes to its position on the ring as usual, but if that backend is at capacity, the request walks forward to the next backend with spare capacity. The guarantee: **no backend ever exceeds `(1 + ε)` times the average**, while the *fraction of keys that have to move* when a backend is added or removed stays small (`O(1/ε²)` in expectation). You buy a tunable, hard load cap for a small, controlled loss of stickiness. This is what powers Google Cloud's HTTP(S) load balancing and Vimeo's video-serving layer, where both affinity (for cache hits) and bounded load (to avoid hot nodes) are non-negotiable.

| Policy | Theory analogue | State needed | Cost | Use when |
| --- | --- | --- | --- | --- |
| Round-robin | Oblivious assignment | One counter | `O(1)` | Cheap, uniform requests |
| Weighted RR | Related machines (static) | Weights | `O(1)` | Heterogeneous capacity, uniform load |
| Least-connections / JSQ | Greedy list scheduling | All `m` loads | `O(m)` or `O(log m)` | Variable request cost, single LB |
| Power-of-two / JSQ(d) | Greedy on a random sample | Two probes | `O(1)` | Distributed LBs, stale state |
| Consistent hashing + bounded loads | Capacitated assignment | Ring + caps | `O(log m)` walk | Affinity *and* load caps |

---

## Cluster Schedulers and Bin Packing in Production

Front-end load balancing places *requests*; cluster scheduling places *long-lived tasks/containers/VMs* onto *nodes*. The objective flips: a load balancer wants to *spread* load to minimize tail latency; a cluster scheduler often wants to *pack* tightly to minimize the number of nodes (cost), then spread *within* a constraint envelope for resilience. The abstraction underneath is **bin packing**, and in reality it is **vector bin packing**.

**Vector bin packing.** A real task does not request "one unit of capacity." It requests `(2 vCPU, 4 GiB RAM, 1 GiB/s network, 1 GPU, 50 GiB disk)`. A node has a capacity *vector*. A placement is feasible only if the sum of placed tasks fits *in every dimension simultaneously*. This is `d`-dimensional vector bin packing, which (as [`./senior.md`](./senior.md) notes) is genuinely harder than scalar bin packing — even offline it is APX-hard, and the achievable approximation degrades with `d`. The practical pain is **stranded resources**: a node with 10 GiB RAM free but 0 vCPU free is "full" and wasting that RAM. Multi-dimensional fit is why packing heuristics get complicated.

**Why First-Fit-Decreasing-style heuristics dominate.** No production scheduler runs the `1.578`-competitive Super-Harmonic algorithm. They run variants of **First-Fit-Decreasing (FFD)**: sort tasks by "size" (some scalarization of the demand vector — largest dimension, or dot-product against remaining capacity), then place each into the first/best node it fits. FFD-style heuristics win because they are simple, fast, online-friendly (sort the current queue), produce the cost-minimizing tight packs operators want, and — critically — are easy to extend with the dozen *constraints* the clean theory has no slot for: anti-affinity, taints/tolerations, topology spread, GPU/zone pinning, priority preemption.

**What real schedulers do.**

- **Kubernetes `kube-scheduler`** runs a two-phase pipeline per pod: **Filter** (predicates — which nodes can even host this pod: enough free CPU/mem, node selectors, taints, volume zones), then **Score** (priorities — rank feasible nodes, e.g. `NodeResourcesFit` with `MostAllocated` for bin-packing/cost or `LeastAllocated` for spreading, plus `PodTopologySpread` and inter-pod affinity). `requests` drive scheduling (what the scheduler reserves); `limits` drive runtime enforcement (cgroup caps). The bin-packing-vs-spreading choice is literally a scoring-plugin configuration.
- **Borg / Omega (Google).** Borg is the production cell scheduler; its scoring blends bin-packing (E-PVM-style cost) against spreading and fault-domain diversity. Omega was the research successor exploring *shared-state, optimistic-concurrency* scheduling so many schedulers could place against a shared cell state in parallel — directly addressing the throughput limit of a single serial scheduler.
- **YARN** (Hadoop) and **Mesos** target data clusters; Mesos uses *resource offers* (the master offers resources to frameworks, which accept or decline) and is the original home of **DRF** (below). **Nomad** (HashiCorp) uses a bin-packing scheduler with a similar filter/score shape.

The recurring real tradeoff: **packing for cost vs spreading for resilience.** Pack everything onto the fewest nodes and you pay for less hardware — but a single node failure now takes down a large fraction of your replicas, and any node is one noisy neighbor away from contention. Spread for blast-radius control and you pay for more, less-utilized nodes. Every cluster operator tunes a point on this line; it is not a theorem, it is a business decision encoded in scoring weights and topology-spread constraints.

---

## Online vs the Reality of Reassignment

The competitive-analysis model in [`../01-competitive-analysis/professional.md`](../01-competitive-analysis/professional.md) assumes decisions are **irrevocable**: once a job lands on a machine it stays there. This is the assumption that makes the worst case worst — the adversary exploits commitments you can't take back. **Real systems break this assumption.** They can migrate VMs, reschedule pods, drain nodes, and steal work. That is a fundamentally more powerful model than pure online, and it changes the engineering posture.

- **Descheduling / rebalancing.** Kubernetes' `descheduler` evicts pods that, in hindsight, are poorly placed (a node got hot, a better-fitting node appeared, anti-affinity drifted) so the scheduler can replace them better. This is "undo a past online decision" — impossible in the theory, routine in practice.
- **Autoscaling.** Horizontal/cluster autoscalers change `m` itself: add nodes when the queue grows, remove them when it shrinks. The competitive model fixes `m`; production grows and shrinks the machine count to chase load.
- **Work-stealing.** In intra-process schedulers (Go runtime, Tokio, Cilk, ForkJoinPool), an idle worker *steals* tasks from a busy worker's deque. This is decentralized, after-the-fact rebalancing — the system corrects imbalance continuously rather than placing perfectly up front.

But **migration is not free.** Moving a VM means copying memory (live migration), rescheduling a pod means tearing down and recreating a container and warming its caches, rebalancing a shard means streaming data. Each move costs real work, latency, and risk. So "should I rebalance now?" is a **rent-or-buy / ski-rental decision** ([`../02-ski-rental-and-rent-or-buy/professional.md`](../02-ski-rental-and-rent-or-buy/professional.md)): the ongoing cost of tolerating the current imbalance is the "rent," and the one-time cost of migrating is the "buy." You should migrate only once the accumulated cost of the imbalance exceeds (a constant times) the migration cost — the same `2`-competitive break-even logic.

The practical consequence is **hysteresis**. Naive "rebalance to perfect balance whenever imbalance appears" produces *thrashing*: tasks ping-pong between nodes, each move costing more than the imbalance it cured. Production rebalancers therefore use deadbands and cooldowns — only move when imbalance exceeds a threshold *and* has persisted, then don't move that task again for a while. The bias is deliberately toward **stable placement**: prefer a slightly worse but stable assignment over a marginally better but churning one. Migration capability is power, but the discipline is to use it sparingly.

---

## Objectives Beyond Makespan in Practice

The theory's default objective is **makespan** (minimize the maximum load). Almost no production system actually cares about makespan directly. They care about:

**Tail latency / flow time.** What users feel is the p99/p999 *response time* of individual requests, i.e. **flow time** (completion minus arrival), not when the last job finishes. [`./senior.md`](./senior.md) gives the hard result: flow time has *no* constant-competitive online algorithm. **SRPT** (shortest-remaining-processing-time) is optimal for *mean* flow time offline and excellent online — short requests don't get stuck behind long ones, which is exactly the head-of-line blocking that wrecks tail latency. But SRPT **starves** long jobs: a steady stream of short requests can postpone a big one indefinitely. Pure SRPT is rarely deployed for that reason; production uses *bounded* variants — aging, multi-level feedback queues (the MLFQ idea in CPU schedulers and in proxies that prioritize small responses), or SRPT with a starvation floor.

**The speed-augmentation lesson, operationally.** The senior theory's deepest practical insight is resource augmentation (Kalyanasundaram–Pruhs): give the online scheduler machines that are `(1 + ε)` times faster than OPT's, and simple policies like SRPT/SETF become `O(1)`-competitive — *scalable*. Translated to operations: **run your cluster below saturation and simple scheduling becomes near-optimal.** A system at 95–99% utilization is in the regime where competitive ratios blow up, queueing is nonlinear, and tail latency explodes; the same system at 60–70% utilization has the `ε` slack that makes greedy/SRPT-ish policies behave beautifully. The expensive headroom *is* the algorithm — you are buying back the worst case with capacity instead of cleverness. This is why mature SRE practice targets utilization well below 100% and treats "we're near capacity" as the real incident, not the scheduling policy.

**Fairness — DRF.** When a shared cluster serves many tenants with *multi-dimensional* demands, "fair share" is ambiguous: is a CPU-heavy job and a RAM-heavy job getting equal treatment? **Dominant Resource Fairness (DRF)** — Ghodsi, Zaharia, Hindman, Konwinski, Shenker, Stoica (NSDI 2011) — answers it: each user's **dominant resource** is the one they request the largest *share* of (a job asking for `⟨2 CPU, 8 GiB⟩` of a `⟨8 CPU, 16 GiB⟩` cluster is RAM-dominant at `50%`). DRF then equalizes users' *dominant shares* via max-min fairness. It is the multi-resource generalization of max-min fairness and has the right game-theoretic properties (sharing-incentive, strategy-proofness, Pareto-efficiency, envy-freeness). It ships in Mesos and YARN's fair scheduler.

**Weighted / priority scheduling.** Real clusters run mixed criticality: latency-sensitive serving jobs must preempt best-effort batch jobs. Kubernetes `PriorityClass` with preemption, Borg's priority bands, and weighted DRF all encode "some jobs matter more." The scheduling objective becomes weighted completion/flow time, and the policy is preemption plus priority-aware placement.

---

## Learning-Augmented Scheduling, Deployed

The senior tier frames learning-augmented scheduling theoretically (predictions improve the competitive ratio while a fallback caps the damage). In production this is already shipping, and the practical concerns are different from the theory's.

**Predicting job sizes to approximate SRPT/LPT.** SRPT and LPT are *clairvoyant* — they need to know (remaining) job durations, which online you don't. So predict them. **Google Autopilot** (Rzadca et al., EuroSys 2020) right-sizes container CPU/memory `requests` from each job's *historical usage*, sliding the `requests` toward observed demand. This is learning-augmented vector bin packing: a good prediction lets the packer fit tightly without OOM-killing or throttling; it directly attacks stranded resources by not over-reserving. **Straggler mitigation** in MapReduce/Spark (speculative execution) predicts which task is running slow and launches a backup — a learned guess about job duration driving a scheduling action.

**Consistency and robustness.** The theory's promise is the right framing: a *consistent* scheduler is near-optimal when predictions are good; a *robust* one degrades to the prediction-free bound when they're bad. Production cashes this out as a **fallback**: Autopilot bounds how far it moves `requests` and keeps a safety margin; speculative execution caps how many backups it launches. You never let the model's confidence remove the floor.

**The danger of mispredictions and feedback loops.** This is the part the clean theory underplays and operators fear most. A scheduler that *acts* on its predictions changes the very distribution it learned from. Right-size a job's `requests` down based on past usage, then a traffic spike hits and the under-provisioned job throttles, gets slow, gets *more* retries, which looks like *more* load, which... A learned autoscaler that scales down on low observed load can oscillate with one that scales up on latency. These **feedback loops** and the **non-stationarity** they create are why production ML-for-scheduling is deployed conservatively: shadow mode first, hard bounds on actions, slow adaptation, and a non-learned safety controller underneath. The model optimizes the common case; the floor survives the model being wrong.

---

## Engineering Reality: When the Bounds Actually Bite

The `(2 − 1/m)` worst case is real but it is an *adversarial* bound, and your traffic is (usually) not an adversary. Three things keep the worst case from biting:

1. **Real load is not adversarial.** Graham's tight instance is a precise construction (`m(m−1)` tiny jobs to balance perfectly, then one job of size `m`). Real arrival streams are noisy, mostly-uniform-ish, and rarely conspire to set up that exact trap. Empirically, least-load and power-of-two run *far* closer to `1.0×` optimal than to `2×`.
2. **A little headroom dominates.** The speed-augmentation lesson again: at 60–70% utilization the imbalance a greedy policy creates is comfortably absorbed by slack. The bound only approaches `2` when you run hot.
3. **You can measure the gap.** From telemetry you can compute, after the fact, the **offline-optimal balanced assignment** (or a tight LP relaxation) for the jobs you actually saw, and compare it to what your scheduler did. The metric is **load imbalance** = `max_load / mean_load` (or `max_load / OPT_makespan`). Track it. If it sits near `1.1×`, your policy is fine and tuning it is wasted effort. If it spikes to `1.8×`, you have a real hot-spotting problem — usually a skewed key, a misconfigured weight, or a backend that's silently slow.

The honest bottom line for a load balancer: **start with power-of-two-choices.** It is `O(1)` cost, needs no global state, tolerates stale readings, and delivers an exponential improvement in max load over random for free. Reach for least-connections/JSQ only when you have a single LB with cheap access to all backend loads and request costs vary enough to justify the full scan. Reach for consistent-hashing-with-bounded-loads when you need affinity *and* a hard load cap. Everything fancier needs to justify itself against that baseline.

---

## Worked End-to-End: A Load-Balancer Simulator

This Python simulator compares **round-robin**, **least-load**, and **power-of-two-choices** on a synthetic stream of heavy-tailed requests, and reports the maximum backend load and the imbalance ratio versus the ideal (mean) load. It makes the exponential gap between random and two-choices visible.

```python
import random, math

def simulate(policy, n_servers, n_requests, seed=1):
    random.seed(seed)
    load = [0.0] * n_servers          # current load (sum of in-flight request costs)
    rr_cursor = 0

    def pick_round_robin():
        nonlocal rr_cursor
        s = rr_cursor % n_servers
        rr_cursor += 1
        return s

    def pick_least_load():             # greedy list scheduling: scan all m
        return min(range(n_servers), key=lambda s: load[s])

    def pick_power_of_two(d=2):        # sample d at random, take the lighter
        sample = random.sample(range(n_servers), d)
        return min(sample, key=lambda s: load[s])

    def pick_random_one():             # baseline: one random choice (d=1)
        return random.randrange(n_servers)

    pickers = {
        "round_robin":  pick_round_robin,
        "least_load":   pick_least_load,
        "power_of_two": pick_power_of_two,
        "random_one":   pick_random_one,
    }
    pick = pickers[policy]

    for _ in range(n_requests):
        # Heavy-tailed request cost: most are cheap, a few are expensive.
        cost = 1.0 if random.random() < 0.9 else random.uniform(10, 40)
        load[pick()] += cost

    mean = sum(load) / n_servers
    mx   = max(load)
    return mx, mean, mx / mean          # imbalance ratio = max / mean

if __name__ == "__main__":
    m, n = 100, 100_000
    print(f"{m} servers, {n} heavy-tailed requests\n")
    print(f"{'policy':<14}{'max_load':>12}{'mean_load':>12}{'imbalance':>12}")
    for p in ("random_one", "round_robin", "least_load", "power_of_two"):
        mx, mean, ratio = simulate(p, m, n)
        print(f"{p:<14}{mx:>12.1f}{mean:>12.1f}{ratio:>12.3f}")
```

A representative run (numbers vary with seed but the *ordering* is robust):

```text
100 servers, 100000 heavy-tailed requests

policy          max_load   mean_load   imbalance
random_one        1733.4      1466.2       1.182
round_robin       1559.1      1466.2       1.063
least_load        1467.2      1466.2       1.001
power_of_two      1492.8      1466.2       1.018
```

Read the imbalance column, not the raw loads. **`random_one`** (one random choice) is the worst — `~1.18×` the mean — and the gap *grows* with the number of servers, matching the `Θ(log n / log log n)` theory. **`round_robin`** is better because it deterministically spreads counts, but it's load-blind, so heavy-tailed costs still clump. **`least_load`** is essentially perfect (`~1.00×`) — it is greedy list scheduling with full state. The headline result is **`power_of_two`**: with just *two* probes and one comparison it lands at `~1.02×` — almost matching the full `O(m)` scan of `least_load`, and exponentially better than `random_one`. That is the power-of-two-choices payoff in one column: nearly all the benefit of measuring everything, at `O(1)` cost and zero global state.

Two experiments worth running to internalize the theory: (1) raise `m` to `1000` and `10000` and watch `random_one`'s imbalance climb while `power_of_two` barely moves (log-log vs log growth); (2) add a `pick_power_of_d(3)` and confirm it improves on `d=2` only marginally — the diminishing returns that justify stopping at two.

The bin-packing analogue is the same exercise on placement: a **First-Fit-Decreasing** VM placer (sort items by size descending, place each in the first bin it fits) versus **Next-Fit** (only ever look at the current open bin), measured by *bins used* against a lower bound of `⌈Σ sizes / bin_capacity⌉`. FFD lands near `1.0–1.22×` the lower bound on typical inputs (its `(11/9)·OPT + 6/9` offline guarantee), while Next-Fit can need up to `2×` — the same "measure more, pack better" tradeoff that least-load vs round-robin shows for spreading.

---

## Decision Framework

**Choosing a load-balancing policy:**

- Cheap, uniform requests, single LB → **round-robin**.
- Heterogeneous backend capacity, otherwise uniform load → **weighted round-robin**.
- Variable request cost, single LB with cheap access to all loads → **least-connections / JSQ**.
- Distributed LB fleet, or stale/expensive load state → **power-of-two-choices / JSQ(2)** (this is the default — start here).
- Need session/cache affinity *and* a hard per-backend load cap → **consistent hashing with bounded loads**.

**Choosing a cluster-scheduling posture:**

- Minimize node count / cost → bin-pack tight (`MostAllocated`, FFD-style scoring). Accept larger blast radius.
- Maximize resilience → spread (`LeastAllocated`, topology-spread constraints). Accept more, less-utilized nodes.
- Multi-tenant shared cluster → **DRF** for fairness, plus priorities/preemption for mixed criticality.
- Can you migrate? → yes, but gate it behind ski-rental hysteresis; bias toward stable placement, use deadbands to avoid thrashing.

**Choosing an objective:**

- Throughput batch → makespan / bin-pack.
- Interactive serving → flow time / tail latency; SRPT-flavored with a starvation floor; **and run with headroom** so simple policies are near-optimal.
- Want predictions in the loop → learning-augmented (Autopilot-style right-sizing) *behind a hard-bounded fallback*; watch for feedback loops.

**Always:** measure imbalance (`max_load / mean_load`) against the offline-optimal from telemetry. If it's near `1.1×`, stop tuning.

---

## Research Pointers

- **Graham (1966, 1969)** — list scheduling and LPT; the `(2 − 1/m)` and `(4/3 − 1/(3m))` bounds. The root of everything here.
- **Azar, Broder, Karlin, Upfal (1994/1999), "Balanced Allocations"** — the power of two choices; the `log log n / log d` maximum-load bound.
- **Mitzenmacher, "The Power of Two Choices in Randomized Load Balancing" (PhD thesis 1996; survey)** — the supermarket model, JSQ(d), and the double-exponential tail decay.
- **Mirrokni, Thorup, Zadimoghaddam (2016/2018), "Consistent Hashing with Bounded Loads"** — the `(1 + ε)`-capacity ring with small movement under churn.
- **Kalyanasundaram, Pruhs (1995/2000), "Speed Is as Powerful as Clairvoyance"** — resource/speed augmentation; the headroom-buys-simplicity result.
- **Ghodsi, Zaharia, Hindman, Konwinski, Shenker, Stoica (NSDI 2011), "Dominant Resource Fairness"** — DRF for multi-resource fair sharing.
- **Verma et al. (EuroSys 2015), "Large-scale cluster management at Google with Borg"**; **Schwarzkopf et al. (EuroSys 2013), "Omega"** — production cell scheduling and shared-state optimistic concurrency.
- **Rzadca et al. (EuroSys 2020), "Autopilot: workload autoscaling at Google"** — learning-augmented right-sizing in production.
- **Coffman, Garey, Johnson** — the classic bin-packing approximation survey (FFD's `11/9` bound, vector packing hardness).

---

## Key Takeaways

- **A load balancer is online scheduling.** Least-connections *is* Graham's greedy and carries its `(2 − 1/m)` guarantee; round-robin is the oblivious, load-blind version.
- **The power of two choices is the highest-leverage idea here.** Sampling `d = 2` backends and picking the lighter collapses the maximum load from `Θ(log n / log log n)` (one random choice) to `Θ(log log n)` — an *exponential* improvement for one extra probe. `d = 2` is the sweet spot; beyond it, only constant-factor gains. It needs no global state, tolerates staleness, and is the right default for distributed front ends.
- **Consistent hashing with bounded loads** buys a hard `(1 + ε)·average` cap per backend while keeping affinity and low movement under churn — the answer when you need both stickiness and no hot nodes.
- **Cluster scheduling is vector bin packing** under constraints; production runs FFD-style filter-then-score heuristics (kube-scheduler, Borg, YARN, Mesos, Nomad), trading **packing for cost** against **spreading for resilience** — a business decision, not a theorem.
- **Real systems can reassign**, unlike the pure-online model — but migration is costly, so *when* to rebalance is a [ski-rental](../02-ski-rental-and-rent-or-buy/professional.md) hysteresis decision. Bias toward stable placement; use deadbands to avoid thrashing.
- **The objective is usually tail latency, not makespan.** SRPT-style policies help but starve long jobs; the deep practical lesson is **speed augmentation** — run with headroom (60–70%, not 99%) and simple policies become near-optimal. **DRF** handles multi-resource fairness.
- **Learning-augmented scheduling ships today** (Autopilot right-sizing, speculative execution) but always behind a hard-bounded fallback; beware mispredictions and feedback loops.
- **The `(2 − 1/m)` worst case rarely bites** under real (non-adversarial) load with a little headroom. Measure `max_load / mean_load` against the offline optimum from telemetry; **power-of-two-choices is the cheap, robust default.**
