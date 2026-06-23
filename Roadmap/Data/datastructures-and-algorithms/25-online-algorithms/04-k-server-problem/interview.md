# The k-Server Problem — Interview Questions

## Table of Contents

1. [Conceptual Questions](#conceptual-questions)
2. [The Marquee: Double Coverage & the Lower Bound](#the-marquee-double-coverage--the-lower-bound)
3. [The Work Function Algorithm](#the-work-function-algorithm)
4. [Randomization & Generalization](#randomization--generalization)
5. [Applied: Real Systems](#applied-real-systems)
6. [Gotcha / Trick Questions](#gotcha--trick-questions)
7. [Rapid-Fire Q&A](#rapid-fire-qa)
8. [Common Mistakes](#common-mistakes)
9. [Tips & Summary](#tips--summary)

---

## Conceptual Questions

### Q1: State the k-server problem. *(Easy)*

**Answer**: We have `k` mobile **servers** sitting on points of a **metric space** `(M, d)` (any space with a distance obeying the triangle inequality). Requests arrive online as a sequence `σ = ⟨r₁, r₂, …⟩` of points in `M`. To **serve** request `rᵢ`, some server must be **moved to `rᵢ`** (at least one server must occupy the requested point). The cost of a move is the distance travelled. The objective is to **minimize the total distance** moved over the whole sequence, deciding online — *which* server to send to each request *before* seeing the next one.

The only decision is **which of the `k` servers to dispatch** to each request; the position is forced (it must end up on `rᵢ`). It is the canonical online problem on metric spaces.

### Q2: How is paging a special case of k-server? *(Medium)*

**Answer**: Paging is **k-server on the uniform metric**. Put one point per distinct page, with **all pairwise distances equal to 1** (the uniform metric). The `k` servers correspond to the `k` cache slots: a server sitting on a point means that page is **resident**.

- A request to a page already covered by a server = a **cache hit**, cost 0 (no move).
- A request to an uncovered page forces a server to **move there** (cost 1) — equivalently, **evict** the page that server was on and load the new one. That is exactly a **page fault**.

So minimizing total movement on the uniform metric = minimizing faults. Choosing *which server to move* = choosing *which page to evict*. Every k-server result specializes to a paging result on the uniform metric: the deterministic lower bound `k`, LRU/FIFO being `k`-competitive, and Belady's MIN as the offline optimum. See [../03-paging-and-caching-theory/interview.md](../03-paging-and-caching-theory/interview.md).

### Q3: Why is greedy "move the nearest server" not competitive? *(Medium)*

**Answer**: Greedy always sends the **closest** server to the request. It is myopic and can be trapped into ignoring a server forever. The standard counterexample lives **on the line** with `k = 2`:

- Put servers at positions `0` and `10`. Requests alternate between two nearby points, say `5` and `6`, repeatedly: `5, 6, 5, 6, …`.
- Greedy always uses the **same** server (the one that first reached `5`), shuttling it back and forth `5 → 6 → 5 → 6` while the **other server sits idle at `0`** forever. Each oscillation costs `1`, so over `N` requests greedy pays `≈ N`.
- The **offline optimum** moves the *second* server in once (`0 → 5`, cost 5), parks one server near `5` and one near `6`, and then serves everything for **free**. So `OPT = O(1)`.

The ratio `ALG/OPT → ∞` is **unbounded** — greedy is **not competitive on any constant**. The lesson: a good k-server algorithm must sometimes move a server that is *not* the nearest, anticipating future requests so it doesn't strand servers in useless positions.

---

## The Marquee: Double Coverage & the Lower Bound

### Q4: Describe the Double Coverage algorithm and its guarantee. *(Hard)*

**Answer**: **Double Coverage (DC)** is the canonical competitive algorithm **on the line** (and, suitably generalized, on **trees**). When a request `r` arrives:

- If `r` lies **outside the span** of the servers (beyond the leftmost or rightmost server), move the single nearest server to `r`.
- If `r` lies **between** two servers, move **both** the nearest server on the left **and** the nearest server on the right **toward `r` at equal speed**, until one of them reaches `r`. The one that arrives serves the request; the other stops where it landed (it has moved the same distance the winner moved to close the gap).

Moving both neighbours symmetrically keeps the servers from "clumping" and spreads them to anticipate requests on either side — directly fixing greedy's stranding failure.

**Guarantee**: Double Coverage is **exactly `k`-competitive on the line** (and on trees). The proof uses a **potential function** — typically `Φ = k·(sum of consecutive-server gaps in a min-cost matching to OPT) + (sum of pairwise server distances)` — and an amortized argument showing DC's move plus the change in `Φ` is bounded by `k` times OPT's move. Since the deterministic lower bound is `k` (Q5), DC is **optimal** for the line.

### Q5: Why can no deterministic algorithm beat k-competitive? *(Hard — the lower bound)*

**Answer**: The deterministic lower bound is **`k`**, on *every* metric with at least `k + 1` points. The argument mirrors paging's. Restrict attention to `k + 1` fixed points. At any moment the `k` servers cover `k` of them, leaving **exactly one point uncovered**. The **adversary always requests the uncovered point**, forcing the online algorithm to move a server there every single step.

- The online algorithm pays a positive cost on **every** request — sum it to `ALG`.
- The key averaging trick: compare against `k` *different* offline algorithms (or the single optimum) simultaneously. One can show that the **sum** of the costs of `k` cleverly chosen offline strategies is at most `ALG` over the same stream, so the **best** of them — and hence `OPT` — pays at most `ALG / k`. Equivalently, OPT can pre-position to avoid most moves while the deterministic online player, pinned by the adversary, cannot.

Therefore `ALG ≥ k · OPT − O(1)`, giving a competitive ratio of at least `k` against *any* deterministic algorithm. On the uniform metric this collapses to the familiar paging lower bound. Because Double Coverage **matches** `k` on the line, the bound is **tight** there.

---

## The Work Function Algorithm

### Q6: What is the work function, and what does it tell you? *(Hard)*

**Answer**: The **work function** `w_t(X)` is the **minimum total cost of serving the first `t` requests and ending with the servers in configuration `X`** (a multiset of `k` points), computed **offline / optimally**. It is a dynamic-programming value: `w_t` is obtained from `w_{t−1}` by the recurrence

```
w_t(X) = min over configs Y that cover request r_t of [ w_{t−1}(Y) + d(Y, X) ],
```

where `d(Y, X)` is the min-cost matching distance between configurations. Intuitively, `w_t(X)` encodes the **entire optimal-offline history** as a function of where you want to end up. `min_X w_t(X)` is exactly `OPT` on the first `t` requests.

### Q7: Describe the Work Function Algorithm and the Koutsoupias–Papadimitriou result. *(Hard — the headline)*

**Answer**: The **Work Function Algorithm (WFA)** chooses its move to balance two competing goals: stay cheap to reach, and stay consistent with optimal-offline play. On request `r_t`, among all servers `s` (currently at point `p_s`), it moves the server minimizing

```
w_t(X_s) + d(p_s, r_t),
```

where `X_s` is the resulting configuration after sending server `s` to `r_t`. The first term penalizes ending in a configuration that optimal play would find expensive; the second is the literal move cost. WFA blends *greedy* (small move) with *retrospection* (consistency with the offline optimum encoded in `w`).

**Koutsoupias–Papadimitriou (1995)**: WFA is **`(2k − 1)`-competitive on *every* metric space**. This is the strongest general upper bound known and the headline result of the area — a *uniform* guarantee that does not depend on the metric. It is within a factor of ~2 of the lower bound `k`.

### Q8: Is the k-server conjecture solved? *(Medium)*

**Answer**: **No — it remains open in general.** The **k-server conjecture** states that there exists a **deterministic algorithm that is exactly `k`-competitive on every metric space**, matching the lower bound. As of today:

- It is **proven** for special metrics: the **line** and **trees** (Double Coverage is `k`-competitive), the **uniform metric** (paging, `k`), and a few others.
- For **general** metrics the best deterministic bound is WFA's **`(2k − 1)`** (Koutsoupias–Papadimitriou). Closing the gap from `2k − 1` to `k` in full generality is a celebrated **open problem** in online algorithms. Do not claim it is resolved.

---

## Randomization & Generalization

### Q9: What is known for randomized k-server? *(Hard)*

**Answer**: Randomization is expected to help dramatically, paralleling paging's deterministic `k` → randomized `H_k ≈ ln k` improvement.

- **The randomized k-server conjecture** posits an **`O(log k)`-competitive** randomized algorithm against an oblivious adversary on every metric — an exponential improvement over `k`.
- The breakthrough came via embedding metrics into **hierarchically separated trees (HSTs)** and the **online primal-dual / mirror-descent** framework. Bansal–Buchbinder–Madry–Naor and successors achieved **`polylog(k)`** competitive ratios on general metrics (roughly `O(log²k · log n)` and refinements). This is far better than `(2k − 1)` for large `k` but still **above** the conjectured `O(log k)`.
- As with all randomized online bounds, these are against the **oblivious adversary**. The tight `O(log k)` randomized conjecture, like its deterministic cousin, is **still open**. See [../01-competitive-analysis/interview.md](../01-competitive-analysis/interview.md) for the adversary models.

### Q10: How does the Metrical Task System (MTS) generalize k-server? *(Medium)*

**Answer**: A **Metrical Task System (MTS)** is the broad abstraction underneath k-server. You have a set of `N` **states** with a metric (transition cost `d(i, j)` between states). Each arriving **task** specifies a cost vector — a processing cost for being in each state when the task is served. At each step you may **move** to a new state (paying the transition distance), then **pay** that state's task cost. The objective minimizes **movement + processing** cost.

**k-server is an MTS** whose states are the configurations (the `\binom{|M|}{k}` ways to place `k` servers), with transition cost = configuration matching distance, and task cost `0` for configurations covering the request and `∞` otherwise. The general MTS bounds — deterministic **`2N − 1`-competitive** (the Work Function Algorithm again, Borodin–Linial–Saks) and randomized **`O(log N / log log N)`** — apply, but they are weak when specialized because `N` is exponential in `k`. So MTS provides the **unifying framework and proof techniques** (work functions, potential arguments), while k-server's *better* bounds come from exploiting its special structure. MTS in turn sits under the still-more-general **online convex/metrical optimization** umbrella.

---

## Applied: Real Systems

### Q11: Name real systems shaped like k-server. *(Medium)*

**Answer**: Any setting where a few mobile resources serve a stream of location-based demands, paying for movement:

- **Caching & data migration** — the original motivation; `k` cache slots / replicas, requests to data items, cost = fetch/migration distance. Uniform metric → paging; weighted/graph metrics → file migration and replication.
- **Disk-head / storage scheduling** — physical read/write heads moving across cylinders to serve I/O requests; minimizing seek distance is a k-server instance on the line.
- **Fleet dispatch / mobile units** — `k` taxis, ambulances, drones, or repair vans positioned in a city (a graph or geometric metric), each request a pickup that the nearest-but-strategically-chosen unit must reach; minimize total travel.
- **Two-headed / multi-arm robotics and elevator banks** — `k` elevators serving floor-call requests (the line/tree), or `k` robot arms over a workspace.

The throughline: **a small number of expensive-to-move resources serving an online stream of point demands.** The k-server theory says: don't just send the nearest unit (Q3) — anticipate, spread, and occasionally reposition a non-nearest server.

### Q12: "Why not just always move the nearest server?" *(Medium — the practitioner's trap)*

**Answer**: Because **greedy-nearest is not competitive** (Q3): it strands servers and can be driven to an **unbounded** ratio versus optimal by an oscillating request pattern, while the offline optimum repositions once and serves the rest for free. The fix every competitive algorithm encodes is to **move servers that are *not* nearest**:

- **Double Coverage** moves *both* flanking servers toward an interior request, deliberately repositioning the far one to keep coverage spread (Q4).
- **WFA** trades a slightly longer move now for consistency with optimal-offline play, avoiding the stranding greedy falls into (Q7).

So in a real dispatch or cache-migration system, a purely "send the closest unit" heuristic is fine on benign traffic but pathological under adversarial or oscillating load; the competitive algorithms buy you a worst-case guarantee at the cost of occasionally repositioning idle resources.

---

## Gotcha / Trick Questions

### Q13: "WFA is `(2k−1)`-competitive, so the k-server problem is basically solved, right?" *(Medium)*

**Answer**: **No.** `(2k − 1)` is the best *known* general upper bound, but the **k-server conjecture** asks for exactly **`k`** on every metric, and that gap is **open**. `(2k − 1)` is roughly twice the lower bound `k`, so the problem is *not* settled in general — only on the line, trees, the uniform metric, and other special cases is the tight `k` achieved (by Double Coverage / specialized algorithms). Calling it "solved" conflates a strong upper bound with the open tight bound.

### Q14: "Paging's lower bound is `k`, so k-server's must also be exactly `k` everywhere." *(Medium)*

**Answer**: The **lower bound** is indeed `k` on every metric (Q5) — that part transfers. But a matching **upper bound** of `k` on *every* metric is exactly the **unproven conjecture**. Paging (uniform metric) achieves `k` because the metric is simple; general metrics only have the `(2k − 1)` upper bound. So the lower bound is universal, but tightness is **not** established in general.

### Q15: "Greedy is at least `k`-competitive since it always serves the request." *(Easy)*

**Answer**: **No — greedy-nearest is not competitive at all** (no finite ratio, not even a function of `k`). Serving every request says nothing about *total distance*; the oscillation example (Q3) drives `ALG/OPT → ∞` with `OPT = O(1)`. "Always serves the request" is necessary but nowhere near sufficient for competitiveness.

---

## Rapid-Fire Q&A

| # | Question | Answer |
|---|----------|--------|
| 1 | What does k-server minimize? | Total **distance** moved by `k` servers on a metric space |
| 2 | Decision the algorithm makes? | **Which** server to send to each request |
| 3 | Paging is k-server on which metric? | The **uniform** metric (all distances 1) |
| 4 | Server on a point = ? (paging) | That page is **resident** (cache slot) |
| 5 | Is greedy-nearest competitive? | **No** — unbounded ratio (line oscillation) |
| 6 | Best algorithm on the line/trees? | **Double Coverage** |
| 7 | Double Coverage's ratio? | **`k`** (tight) on line and trees |
| 8 | Deterministic lower bound? | **`k`** on every metric (≥ k+1 points) |
| 9 | What is the work function `w_t(X)`? | Min offline cost to serve `t` requests ending at config `X` |
| 10 | WFA's general guarantee? | **`(2k − 1)`**-competitive on every metric |
| 11 | Who proved `(2k−1)`? | **Koutsoupias–Papadimitriou** (1995) |
| 12 | k-server conjecture? | Exists a **`k`-competitive** det. algo on every metric — **open** |
| 13 | Best randomized (general)? | **`polylog(k)`** (primal-dual / HST embeddings) |
| 14 | Randomized k-server conjecture? | **`O(log k)`** vs oblivious adversary — open |
| 15 | k-server generalizes to? | **Metrical Task System (MTS)** |
| 16 | MTS deterministic ratio? | **`2N − 1`** (`N` = states), via WFA |
| 17 | Offline optimum (uniform metric)? | Belady's MIN (k-server = paging) |
| 18 | Real systems shaped like k-server? | Caching/migration, disk heads, fleet dispatch |

---

## Common Mistakes

1. **Thinking greedy-nearest is competitive.** It has *no* finite ratio — the line oscillation strands a server while OPT pays `O(1)`.
2. **Claiming the k-server conjecture is solved.** The tight `k` upper bound on general metrics is **open**; only `(2k − 1)` (WFA) is proven in general, with `k` known on the line/trees/uniform.
3. **Quoting `(2k−1)` as the answer to "best possible."** It's the best *known general upper bound*, not a tight bound; the lower bound is `k`.
4. **Forgetting Double Coverage moves *two* servers.** On an interior request it advances both flanking servers equally — that symmetry is the whole point.
5. **Confusing the work function with a heuristic.** `w_t(X)` is the *exact offline optimum* to end at `X`; WFA *uses* it but is itself online.
6. **Dropping the adversary model for randomized bounds.** `polylog(k)` and the conjectured `O(log k)` are **oblivious-adversary** results.
7. **Treating MTS bounds as k-server bounds.** MTS gives `2N − 1`, but `N` is exponential in `k`; k-server's structure yields the far better `(2k − 1)`.

---

## Tips & Summary

- **Lead with the definition and the paging link**: "`k` servers on a metric, serve a request by moving a server there, minimize total distance — and *paging is the uniform-metric special case*." That framing makes every later answer click.
- **Always have the greedy counterexample ready**: two servers on the line, requests oscillating between two nearby points; greedy shuttles one server forever (`≈ N`) while OPT repositions once (`O(1)`) — unbounded ratio, so greedy is *not* competitive.
- **Memorize the canonical numbers**: deterministic lower bound **`k`** (every metric); **Double Coverage `k`** on line/trees (tight); **WFA `(2k − 1)`** on every metric (Koutsoupias–Papadimitriou); randomized **`polylog(k)`** with conjectured **`O(log k)`**. Flag the **k-server conjecture (`k` everywhere) as open**.
- **Describe Double Coverage precisely**: interior request → move both neighbours toward it at equal speed; exterior request → move the nearest. The two-sided move is what prevents stranding.
- **Explain WFA in one line**: pick the server minimizing `w_t(X_s) + d(p_s, r_t)` — balance "cheap to move now" against "consistent with optimal-offline history."
- **Place it in the hierarchy**: k-server ⊂ MTS ⊂ online metrical optimization; MTS supplies the work-function and potential-function techniques, but k-server's special structure earns the better bounds.

**Related:** [Paging & Caching Theory — Interview](../03-paging-and-caching-theory/interview.md) · [Competitive Analysis — Interview](../01-competitive-analysis/interview.md) · [k-Server Problem — Middle](./middle.md)
