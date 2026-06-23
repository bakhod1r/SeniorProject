# MapReduce Patterns — Middle Level

## Table of Contents

1. [Introduction](#introduction)
2. [The Execution Model](#the-execution-model)
   - [Input Splits and M Map Tasks](#input-splits-and-m-map-tasks)
   - [The Intermediate (k, v) Stream and the Partitioner](#the-intermediate-k-v-stream-and-the-partitioner)
   - [Shuffle = a Distributed Group-by-Key (Sort + Partition)](#shuffle--a-distributed-group-by-key-sort--partition)
   - [R Reduce Tasks and the Sort Within a Reduce Input](#r-reduce-tasks-and-the-sort-within-a-reduce-input)
3. [Combiners: A Map-Side Mini-Reduce](#combiners-a-map-side-mini-reduce)
4. [The Design Patterns](#the-design-patterns)
   - [Summarization / Aggregation](#summarization--aggregation)
   - [Filtering, Sampling, and Top-K](#filtering-sampling-and-top-k)
   - [Inverted Index](#inverted-index)
   - [Join: Reduce-Side vs Map-Side](#join-reduce-side-vs-map-side)
   - [Secondary Sort](#secondary-sort)
   - [Grouping and Sessionization](#grouping-and-sessionization)
5. [Data Locality and Fault Tolerance](#data-locality-and-fault-tolerance)
6. [The Limits: Iterative Algorithms](#the-limits-iterative-algorithms)
7. [Code: In-Process MapReduce with Combiner and Partitioner](#code-in-process-mapreduce-with-combiner-and-partitioner)
   - [Go](#go)
   - [Python](#python)
8. [Pitfalls](#pitfalls)
9. [Summary](#summary)

---

## Introduction

> Focus: turn the junior picture — map → shuffle → reduce, illustrated by word count — into the rigorous **execution model** (splits, map tasks, the partitioner, the shuffle as a distributed sort, reduce tasks) and the **design-pattern vocabulary** (summarization, filtering/top-K, inverted index, joins, secondary sort, sessionization) that every real MapReduce/dataflow job is assembled from. By the end you can say exactly *why* the shuffle is the expensive step, *why* a combiner needs an associative+commutative operator, *why* average is not a monoid, and *why* a reduce-side join shuffles everything while a map-side join shuffles nothing.

At the [junior level](./junior.md) you met the three-phase model — **map** every input record to intermediate `(key, value)` pairs, **shuffle** to group all values by key, **reduce** each key's value-group to outputs — and you traced **word count** through it. You also met the two underlying primitives at [parallel reduce and map](../04-parallel-reduce-and-map/middle.md): map is embarrassingly parallel, reduce folds with an **associative** operator over a tree, and a fused **map–reduce** never stores the mapped values. MapReduce-the-framework is that pair lifted to a cluster: thousands of machines, data on disk, nodes that fail.

This file makes the model and the patterns rigorous:

- **The execution model.** Input is cut into **splits** → `M` **map tasks** emit intermediate `(k, v)` pairs → each pair is assigned to a partition by the **partitioner** (usually `hash(k) mod R`) → the **shuffle** moves and group-by-keys the data (a *distributed sort*, the subject of [parallel sorting and merging](../03-parallel-sorting-and-merging/middle.md)) → `R` **reduce tasks**, one per partition, each see their keys **in sorted order** and fold each key's values.
- **Combiners.** A map-side **mini-reduce** that pre-aggregates a mapper's output to shrink shuffle traffic. It is correct *only* when the reduce operation is a **commutative monoid** — exactly the [parallel-reduce requirement](../04-parallel-reduce-and-map/middle.md), and the reason `sum`/`count`/`max` combine but `average` does not.
- **The design patterns** — summarization, filtering/top-K, inverted index, reduce-side vs map-side **join**, secondary sort, sessionization — each given as a concrete map shape and reduce shape.
- **Data locality** (run the map where its split already lives) and **fault tolerance** (re-execute failed tasks; correctness needs deterministic, idempotent tasks).
- **The limits.** Iterative algorithms (PageRank, k-means, gradient descent) are painful: each iteration is a *whole job* that re-reads its input from disk — the motivation for Spark/dataflow, taken up at [senior](./senior.md).

A note on vocabulary used throughout:

| Symbol / term | Meaning |
|---------------|---------|
| `M` | number of map tasks (≈ number of input splits) |
| `R` | number of reduce tasks (= number of partitions) |
| `(k, v)` | an intermediate key–value pair emitted by map |
| **partitioner** | function `key → reducer index` in `0..R−1`, usually `hash(k) mod R` |
| **shuffle** | the move + group-by-key of intermediates between map and reduce |
| **combiner** | an optional map-side pre-reduce; a "mini-reducer" |
| **monoid** | `(S, ⊕, e)`: `⊕` associative with identity `e` (see [reduce](../04-parallel-reduce-and-map/middle.md)) |

Throughout, "the framework" means a classic batch MapReduce (Hadoop-style); the same shapes carry to Spark, Flink, and SQL engines, which the [senior](./senior.md) file develops.

---

## The Execution Model

The junior three-phase diagram hides the machinery that makes MapReduce work on a cluster. Here is the full pipeline.

```text
  input ──split──▶ [M map tasks] ──emit (k,v)──▶ partition ──┐
                                                              │  SHUFFLE
                        (sort + group by key, moved over net) │  (distributed
                                                              ▼   sort)
                                          [R reduce tasks, one per partition]
                                          each sees its keys in SORTED order,
                                          reduces each key's value-group ──▶ output
```

### Input Splits and M Map Tasks

The input (one or more large files) is logically divided into **splits** — contiguous byte ranges, typically one per storage block (e.g. 64–128 MB). The framework launches **one map task per split**, so `M` ≈ number of splits. Each map task reads its split as records and calls the user's `map(k, v) → list[(k', v')]` on each, emitting zero or more intermediate pairs. Map tasks are completely independent — no map reads another's input or output — which is exactly the **embarrassing parallelism** of the [map primitive](../04-parallel-reduce-and-map/middle.md). Splitting by *block* is what enables **data locality** ([§5](#data-locality-and-fault-tolerance)): a map task is scheduled on (or near) the machine that already holds its split, so the input is read locally rather than pulled over the network.

### The Intermediate (k, v) Stream and the Partitioner

As a map task emits pairs, each pair must be routed to the reduce task that will eventually fold its key. That routing is the **partitioner**:

```text
  partition(key)  =  hash(key) mod R          // default: assigns key → one of R reducers
```

The contract is the load-bearing part: **all pairs with the same key must go to the same partition** (so they meet at one reducer), and the partition must be a *deterministic* function of the key alone. Hashing satisfies both and spreads keys roughly evenly across the `R` reducers. Each map task buffers its emitted pairs, **sorts them by key**, and writes them to `R` on-disk partitions (often called *spill files*) — so a map task's output is already partitioned and locally sorted before any data moves.

The partitioner is a tuning knob, not a fixed rule. A custom partitioner is exactly how **secondary sort** ([§4](#secondary-sort)) keeps a composite key's records together while sorting on a sub-field, and how you fight a **skewed key** that would otherwise overload one reducer ([pitfalls](#pitfalls)).

### Shuffle = a Distributed Group-by-Key (Sort + Partition)

The **shuffle** is the heart — and the cost — of MapReduce. Its job is to take the intermediate pairs scattered across all `M` mappers and deliver to each reducer `r` *every* pair whose key hashes to `r`, **grouped by key**. Concretely:

1. **Partition** (map side): each mapper has already split its output into `R` sorted partitions.
2. **Transfer** (over the network): reducer `r` fetches partition `r` from *every* map task — `M` fetches per reducer, `M × R` transfers in total.
3. **Merge** (reduce side): reducer `r` merges its `M` already-sorted partition streams into one stream sorted by key — a [multiway merge](../03-parallel-sorting-and-merging/middle.md). The merged stream then presents keys grouped, each key followed by all its values.

> **The shuffle is a distributed sort.** "Group all pairs by key, globally" is precisely a partition-then-sort: hash-partition the keys across reducers, then sort within each reducer. That is why the [parallel sorting and merging](../03-parallel-sorting-and-merging/middle.md) machinery — sample/partition into buckets, then merge sorted runs — *is* the shuffle. It is also why the shuffle dominates the running time: it is the only phase that moves bulk data **across the network** and writes it to disk, while map and reduce stream their local data.

```text
   map outputs (each locally sorted, R partitions):
     M0: [p0 | p1 | p2]      M1: [p0 | p1 | p2]      M2: [p0 | p1 | p2]
          \________________________\_______________________/   reducer 0 pulls every p0
                                    merge M sorted runs  →  keys grouped & sorted at reducer 0
```

Because the shuffle is the bottleneck, *every* shuffle-reducing trick — **combiners**, map-side joins, filtering early — is worth real money. Hold this thought; it explains most MapReduce design choices.

### R Reduce Tasks and the Sort Within a Reduce Input

The framework runs **`R` reduce tasks, one per partition**. Reduce task `r` receives the merged, key-sorted stream of partition `r` and, for each distinct key, calls the user's `reduce(key, list[values]) → list[outputs]` exactly once with **all** values for that key. Two facts follow from the sorted merge and matter constantly:

- **Keys arrive at a reducer in sorted order.** This is free (a by-product of the sort the shuffle already did) and is what makes the reducer's *output* globally ordered when you concatenate reducer 0, 1, …, `R−1` — the basis of a distributed sort and of [secondary sort](#secondary-sort).
- **Values within a key are *not* sorted by default.** The merge groups by key but does not order the *values* of a key. If your reducer needs the values in some order (e.g. events by timestamp), you must arrange it deliberately — that is exactly the [secondary sort](#secondary-sort) pattern.

`R` is chosen by the user. Too small `R` and each reducer is a bottleneck handling a huge partition; too large and you pay scheduling overhead and emit many tiny output files. A common rule is `R` ≈ a small multiple of the cluster's core count, adjusted for skew.

---

## Combiners: A Map-Side Mini-Reduce

The single most effective shuffle-shrinking trick is the **combiner**: run the reduce *locally, on the map side*, over one mapper's output, **before** the data is shuffled. In word count, a mapper that reads a document emitting `("the", 1)` ten thousand times can instead emit `("the", 10000)` once — a 10000× reduction in pairs crossing the network for that key.

```text
  without combiner:  map → ("the",1) ("the",1) … (10000 pairs) → shuffle → reduce sums to 10000
  with combiner:     map → combiner sums locally → ("the",10000) (ONE pair) → shuffle → reduce sums partials
```

The combiner is a "mini-reduce" run zero, one, or **many** times on arbitrary subsets of a mapper's output — the framework decides, and you may not assume it runs at all. For the result to stay correct under *any* such schedule, the reduce operation must be a **commutative monoid**:

> **Combiner correctness.** A combiner is safe iff the reduce's combining operator `⊕` is **associative and commutative** (a commutative monoid). Then `reduce(combine(A) ⊕ combine(B)) = reduce(A ⊕ B)` for any partition of the values into `A, B`, regardless of how many times and in what order the combiner ran.

This is *exactly* the [parallel-reduce monoid requirement](../04-parallel-reduce-and-map/middle.md), restated for a distributed pre-aggregation: **associativity** lets the framework re-parenthesize (combine some values now, the rest at the reducer), and **commutativity** lets it combine values in any order (mappers finish in nondeterministic order, and the combiner sees arbitrary subsets). `sum`, `count`, `max`, `min`, `OR`, `XOR`, set-union all qualify; **average does not** ([§4](#summarization--aggregation)), and concatenation does not (not commutative).

A clean implementation rule: **make the combiner identical to the reducer** whenever the reduce is itself a commutative-monoid fold. Word count's reducer is "sum the counts," and so is its combiner — the same function reused. When the reducer is *not* a pure monoid fold (e.g. average, which needs `(sum, count)`), you cannot reuse it as a combiner directly; instead you reshape the value so that the *partial state* is a monoid (carry `(sum, count)`), combine the partial states, and finish at the reducer. We make this concrete next.

---

## The Design Patterns

A handful of patterns cover the overwhelming majority of MapReduce jobs. Each is defined by its **map shape** (what pairs it emits) and its **reduce shape** (how it folds a key's values). Learn the shapes and you can compose almost any batch computation.

### Summarization / Aggregation

The archetype: compute one aggregate **per group**. Map emits `(group_key, value)`; reduce folds the group's values with a monoid.

```text
  count:   map → (key, 1)             reduce → sum the 1s          combiner: sum
  sum:     map → (key, x)             reduce → sum the x           combiner: sum
  max:     map → (key, x)             reduce → max of x            combiner: max
  min:     map → (key, x)             reduce → min of x            combiner: min
```

All four are commutative monoids, so all four **combine**. The interesting case is the **average**, because the mean is *not* associative:

```text
  mean(mean(1,2,3), mean(4,5)) = mean(2, 4.5) = 3.25
  mean(1,2,3,4,5)              = 3.0           ← different!  the mean of means ≠ the overall mean
```

You cannot combine partial averages. The fix is to make the *partial state* a monoid by carrying **`(sum, count)`** pairs:

```text
  average via a (sum, count) monoid:
    map      → (key, (x, 1))
    combiner → (key, (Σx, Σcount))            // (sum,count) ⊕ (sum,count) = componentwise add — a monoid!
    reduce   → emit Σx / Σcount               // divide ONCE, at the very end
```

`(sum, count)` addition is associative and commutative with identity `(0, 0)`, so it combines freely; the non-monoidal division happens exactly once, after all values are gathered. This is the same lesson as [variance via a tuple monoid](../04-parallel-reduce-and-map/middle.md): **when an aggregate is not a monoid, enlarge the value to a partial state that is.** Standard deviation extends it to `(sum, sum_of_squares, count)`; a "top-3 and their average" carries a small heap plus `(sum, count)`.

### Filtering, Sampling, and Top-K

**Filtering** keeps records matching a predicate and has *no reduce at all* — it is a map-only job: `map → emit (k, v) if predicate(v)`. **Sampling** is filtering with a random predicate (keep each record with probability `p`).

**Top-K** is more interesting because a global top-K must not ship every record to one reducer. The pattern is a two-level reduction — *exactly* the [two-level reduce](../04-parallel-reduce-and-map/middle.md):

```text
  top-K (global):
    map (per mapper)  → keep a local top-K heap over the records it sees;
                        at end of the split, emit those K with one fixed key, e.g. ("TOP", record)
    reduce (one task) → merge the M local top-K lists, keep the global top-K
```

Each mapper ships only `K` records instead of all of them, so the shuffle carries `M × K` records, not `N`. The single reducer then merges `M` lists of `K` — cheap. This is a combiner-shaped optimization: "local top-K" is the combine, "merge top-K lists" is the reduce, and top-K *is* a commutative monoid (the merge-and-truncate of two sorted K-lists is associative and commutative), so it pre-aggregates correctly. Per-group top-K simply replaces the single fixed key with the group key.

### Inverted Index

The inverted index — the data structure behind search engines — maps each term to the list of documents containing it (its **posting list**). It is the canonical "build an index" MapReduce and a near-twin of word count:

```text
  inverted index:
    map(docID, text)  → for each word w in text:  emit (w, docID)
    reduce(w, docIDs) → emit (w, sorted unique posting list of docIDs)
```

Map turns each document inside out — instead of "doc → its words" it emits "word → this doc." The shuffle groups every `(word, docID)` pair by word, so the reducer for `word` sees *all* documents that contained it and writes the posting list. Enrichments fit the same shape: emit `(w, (docID, position))` to record positions for phrase queries, or `(w, (docID, count))` and have the reducer store term frequencies for ranking. A combiner can de-duplicate or pre-count `(word, docID)` pairs within one document/mapper to shrink the shuffle.

### Join: Reduce-Side vs Map-Side

Joining two datasets on a key is where the *cost model* of MapReduce becomes vivid, because there are two strategies with wildly different shuffle costs.

**Reduce-side join (the general one).** Tag each record by its source, key both datasets on the join key, and let the shuffle bring matching records together at the reducer, which forms the cross-product of the two tagged groups:

```text
  reduce-side join of Orders ⋈ Customers on customerID:
    map(order)    → (order.customerID, ("O", order))      // tag with source
    map(customer) → (customer.id,      ("C", customer))
    reduce(cid, tagged_values):
        Cs = [c for ("C", c) in values];  Os = [o for ("O", o) in values]
        for c in Cs, for o in Os:  emit joined(c, o)
```

This works for *any* join (both tables huge, many-to-many) but is **expensive**: it **shuffles both datasets in full** across the network — every record of both inputs is sorted and moved. Skew hurts badly here: a customer with a million orders sends all of them to one reducer.

**Map-side / broadcast join (the cheap special case).** When *one* table is small enough to fit in memory, **replicate it to every mapper** and join in the map phase — *no reduce, no shuffle at all*:

```text
  map-side / broadcast join (Customers is small):
    setup(each map task) → load all of Customers into an in-memory hash table by id
    map(order)           → look up order.customerID in the table; emit joined(order, customer)
    (no reduce phase; no shuffle)
```

The big table (`Orders`) is read locally split-by-split and never shuffled; only the small table crosses the network — *once, to every mapper*. That is the entire difference and it is enormous:

```text
  reduce-side join:  shuffles |Orders| + |Customers|   (both full datasets over the network)
  map-side  join:    shuffles  0;  broadcasts |Customers| to each mapper (small table only)
```

> **The join rule.** If one side fits in memory, **broadcast it** and join map-side — you pay a small broadcast and *zero* shuffle. Only when both sides are large do you fall back to the reduce-side join and pay to shuffle both. This is the single highest-leverage decision in MapReduce join performance, and it is exactly what query optimizers in Spark/Hive do automatically (a "broadcast hash join" vs a "sort-merge join").

### Secondary Sort

By default a reducer sees a key's **values in arbitrary order** ([§2](#r-reduce-tasks-and-the-sort-within-a-reduce-input)). When the reduce needs the values ordered by some secondary field — e.g. all of a user's events **by timestamp** — you use **secondary sort**: fold the sort field *into the key* (a **composite key**), then carefully control partitioning and grouping so the framework's existing key-sort does the value-sort for free.

```text
  secondary sort: order each user's events by timestamp
    composite key  = (userID, timestamp)
    PARTITION by   = userID only      (so all of a user's events land at the same reducer)
    SORT by        = (userID, timestamp)   (the natural composite-key order at the reducer)
    GROUP by       = userID only      (so one reduce() call sees the whole user, values already time-ordered)
```

The trick is the split of responsibilities: the **partitioner** uses only `userID` (keeping a user's records together on one reducer), the **sort comparator** uses the full `(userID, timestamp)` (so records arrive time-ordered), and the **grouping comparator** uses only `userID` (so one `reduce()` call receives the whole user with values already in timestamp order). No in-reducer sort, no buffering the whole group in memory — the values stream in sorted because the shuffle's sort did the work. This is the disciplined way to get ordered values, and it leans entirely on the [distributed sort](../03-parallel-sorting-and-merging/middle.md) the shuffle already performs.

### Grouping and Sessionization

**Grouping** is the generalization of summarization: gather all records sharing a key and emit some per-group structure (a list, a histogram, a small aggregate object) rather than a single scalar. **Sessionization** is the time-aware case and a frequent real job: partition a user's event stream into **sessions** (bursts of activity separated by an idle gap, say 30 minutes).

```text
  sessionization:
    map(event)    → (userID, (timestamp, event))
    secondary sort on (userID, timestamp)               // values arrive time-ordered
    reduce(userID, time_ordered_events):
        walk events; start a new session whenever gap(prev, cur) > 30 min;
        emit one record per session (session id, start, end, event count, …)
```

Sessionization is *secondary sort plus a stateful single pass* over the ordered values: because the values arrive sorted by time (the previous pattern), the reducer can detect gaps in one linear scan without holding or re-sorting the group. The same shape computes "time between consecutive purchases," "longest streak," or any windowed per-key computation — all riding on the values being pre-sorted by the shuffle.

---

## Data Locality and Fault Tolerance

Two cluster realities shape MapReduce's design as much as the algorithms do.

**Data locality — move the computation, not the data.** Input splits are storage blocks, and the scheduler tries to place each map task **on the machine that already holds its block** (or, failing that, on the same rack). Reading the input then costs a *local disk read* instead of a network transfer. Since the input is the largest dataset, this is a huge win, and it is why MapReduce is colocated with its storage layer (the distributed file system) rather than reading from a remote store. The shuffle is the phase that *cannot* be local — intermediates must move to wherever their key's reducer runs — which reinforces why the shuffle is the cost center and why combiners (which shrink what must move) pay off.

**Fault tolerance — re-execute failed tasks.** At cluster scale, machine and disk failures are routine, not exceptional. MapReduce tolerates them by **re-executing** any task that fails or runs slowly: a map task's output is just a deterministic function of its split, so a lost map task is simply rerun on another node from the same input; a lost reduce task re-fetches its partitions and reruns. The same mechanism powers **speculative execution** — when a task lags (a "straggler" on a slow disk), the framework launches a *duplicate* copy and takes whichever finishes first.

> **Re-execution demands determinism and idempotence.** Re-running a task is correct only if it produces the *same* output every time (deterministic) and if running it twice is harmless (idempotent — committed via an atomic rename so a partial/duplicate run leaves no trace). A `map`/`reduce` that reads a wall clock, a random seed, or external mutable state, or that writes outside the framework's commit protocol, breaks under re-execution: two runs of the same task can disagree or double-apply. **Pure, deterministic, side-effect-free tasks** are not a stylistic preference here; they are what makes the fault-tolerance model sound. (This is the same deterministic-vs-commutative reasoning as the [combiner](#combiners-a-map-side-mini-reduce): the framework reserves the right to run your code more than once, so it had better not matter.)

---

## The Limits: Iterative Algorithms

MapReduce is superb for a *single* pass over a huge dataset, but it is **painful for iterative algorithms** — and most of machine learning and graph analytics is iterative. PageRank, k-means, logistic-regression training, and connected-components all repeat the same computation until convergence:

```text
  PageRank (sketch): repeat until ranks converge:
      map(node, (rank, neighbors)) → for each neighbor: emit (neighbor, rank/len(neighbors))
      reduce(node, contributions)  → newRank = (1-d)/N + d·Σ contributions
```

Each iteration is **a whole MapReduce job**. The structural cost is brutal:

- **The graph is re-read from disk every iteration.** The link structure (`node → neighbors`) is *invariant* across iterations, yet vanilla MapReduce has no memory between jobs — each iteration reloads the entire graph from the distributed file system, shuffles, and writes results back to disk for the *next* job to read. For an algorithm that runs 30 iterations, that is ~30× redundant I/O over the largest dataset.
- **A full shuffle per iteration.** Every iteration pays the network-and-disk cost of a complete shuffle, even though much of the structure is unchanged.
- **Job-launch overhead per iteration**, and convergence checking awkwardly bolted on between jobs.

The disk-to-disk-per-iteration tax is the defining weakness, and it is precisely what the next generation of systems was built to fix:

> **The motivation for Spark/dataflow.** Keep the invariant data (the graph, the training set) **in memory across iterations** and express the computation as a *dataflow graph* the engine can optimize as a whole, rather than as a chain of independent disk-to-disk jobs. Caching the loop-invariant input and shuffling only what changed turns a 30× I/O penalty into roughly 1×. This is the leap from MapReduce to Spark/Flink/dataflow, and it is the subject of the [senior](./senior.md) file. MapReduce's patterns survive the transition unchanged — map, shuffle/reduce, the join strategies, secondary sort — but the *execution model* (in-memory, lazily optimized, iteration-aware) is new.

---

## Code: In-Process MapReduce with Combiner and Partitioner

The execution model predicts measurable facts we can demonstrate in a single process — a tiny MapReduce engine with a **partitioner** and an optional **combiner**, then three jobs on top of it:

1. **Word count** with a combiner — and a count of how many pairs the combiner removes from the shuffle.
2. **Inverted index** — `word → sorted posting list`.
3. **Reduce-side join** — tag records by source, join in the reducer.

The engine mirrors the real pipeline: map → (optional) per-mapper combine → partition by `hash(key) mod R` → sort-and-group per partition (the shuffle) → reduce.

### Go

```go
package main

import (
	"fmt"
	"hash/fnv"
	"sort"
	"strings"
)

// Pair is one intermediate (key, value).
type Pair struct {
	Key string
	Val interface{}
}

// Engine config: a map fn, an optional combiner, a reduce fn, and R partitions.
type Job struct {
	Mapper   func(key string, val string) []Pair
	Combiner func(key string, vals []interface{}) []interface{} // optional; nil to skip
	Reducer  func(key string, vals []interface{}) []Pair
	R        int
}

func partition(key string, R int) int {
	h := fnv.New32a()
	h.Write([]byte(key))
	return int(h.Sum32()) % R
}

// run executes map → combine → partition → shuffle(sort+group) → reduce.
// It also returns how many intermediate pairs the combiner eliminated.
func (j *Job) run(inputs map[string]string) ([]Pair, int) {
	// --- MAP, per input split (here: one split per input record) ---
	var mapped [][]Pair // one slice per "mapper"
	for k, v := range inputs {
		mapped = append(mapped, j.Mapper(k, v))
	}

	emittedByMap := 0
	for _, m := range mapped {
		emittedByMap += len(m)
	}

	// --- COMBINE, per mapper (the map-side mini-reduce) ---
	combinedTotal := 0
	if j.Combiner != nil {
		for i, m := range mapped {
			grouped := groupByKey(m)
			var out []Pair
			for _, key := range sortedKeys(grouped) {
				for _, cv := range j.Combiner(key, grouped[key]) {
					out = append(out, Pair{key, cv})
				}
			}
			mapped[i] = out
		}
	}
	for _, m := range mapped {
		combinedTotal += len(m)
	}
	shuffleSaved := emittedByMap - combinedTotal // pairs the combiner kept off the wire

	// --- PARTITION + SHUFFLE: route each pair, then sort+group per partition ---
	parts := make([]map[string][]interface{}, j.R)
	for r := range parts {
		parts[r] = map[string][]interface{}{}
	}
	for _, m := range mapped {
		for _, p := range m {
			r := partition(p.Key, j.R)
			parts[r][p.Key] = append(parts[r][p.Key], p.Val)
		}
	}

	// --- REDUCE: one task per partition; keys arrive sorted ---
	var out []Pair
	for r := 0; r < j.R; r++ {
		for _, key := range sortedKeys(parts[r]) { // keys in SORTED order
			out = append(out, j.Reducer(key, parts[r][key])...)
		}
	}
	return out, shuffleSaved
}

func groupByKey(ps []Pair) map[string][]interface{} {
	g := map[string][]interface{}{}
	for _, p := range ps {
		g[p.Key] = append(g[p.Key], p.Val)
	}
	return g
}

func sortedKeys(m map[string][]interface{}) []string {
	ks := make([]string, 0, len(m))
	for k := range m {
		ks = append(ks, k)
	}
	sort.Strings(ks)
	return ks
}

func main() {
	docs := map[string]string{
		"doc1": "the cat sat on the mat",
		"doc2": "the dog sat on the log",
		"doc3": "the cat and the dog",
	}

	// --- Job 1: WORD COUNT with a combiner (combiner == reducer: sum) ---
	sumVals := func(_ string, vals []interface{}) []interface{} {
		s := 0
		for _, v := range vals {
			s += v.(int)
		}
		return []interface{}{s}
	}
	wc := Job{
		Mapper: func(_ string, text string) []Pair {
			var ps []Pair
			for _, w := range strings.Fields(text) {
				ps = append(ps, Pair{w, 1})
			}
			return ps
		},
		Combiner: sumVals, // local pre-sum shrinks the shuffle
		Reducer: func(w string, vals []interface{}) []Pair {
			s := 0
			for _, v := range vals {
				s += v.(int)
			}
			return []Pair{{w, s}}
		},
		R: 2,
	}
	counts, saved := wc.run(docs)
	fmt.Println("word count:")
	for _, p := range counts {
		fmt.Printf("  %-5s %d\n", p.Key, p.Val)
	}
	fmt.Printf("  (combiner kept %d pairs off the shuffle)\n", saved)

	// --- Job 2: INVERTED INDEX (word → sorted posting list) ---
	idx := Job{
		Mapper: func(docID string, text string) []Pair {
			seen := map[string]bool{}
			var ps []Pair
			for _, w := range strings.Fields(text) {
				if !seen[w] { // dedup within a document
					seen[w] = true
					ps = append(ps, Pair{w, docID})
				}
			}
			return ps
		},
		Reducer: func(w string, vals []interface{}) []Pair {
			docIDs := make([]string, 0, len(vals))
			for _, v := range vals {
				docIDs = append(docIDs, v.(string))
			}
			sort.Strings(docIDs)
			return []Pair{{w, strings.Join(docIDs, ",")}}
		},
		R: 2,
	}
	index, _ := idx.run(docs)
	fmt.Println("inverted index:")
	for _, p := range index {
		fmt.Printf("  %-5s -> %s\n", p.Key, p.Val)
	}

	// --- Job 3: REDUCE-SIDE JOIN (Orders ⋈ Customers on customerID) ---
	// Encode both sources into one input: value = "SOURCE|payload".
	joinInput := map[string]string{
		"c:1": "C|Alice",
		"c:2": "C|Bob",
		"o:1": "O|1|book",   // O|customerID|item
		"o:2": "O|1|pen",
		"o:3": "O|2|lamp",
	}
	join := Job{
		Mapper: func(_ string, v string) []Pair {
			f := strings.SplitN(v, "|", 2)
			if f[0] == "C" {
				name := f[1]
				// emit keyed by the customer id itself ("c:1" → id "1")
				return []Pair{{name[:0] + customerKey(v), Pair{"C", name}}}
			}
			parts := strings.SplitN(f[1], "|", 2) // customerID | item
			return []Pair{{parts[0], Pair{"O", parts[1]}}}
		},
		Reducer: func(cid string, vals []interface{}) []Pair {
			var name string
			var items []string
			for _, v := range vals {
				p := v.(Pair)
				if p.Key == "C" {
					name = p.Val.(string)
				} else {
					items = append(items, p.Val.(string))
				}
			}
			sort.Strings(items)
			var out []Pair
			for _, it := range items { // cross-product: customer × each order
				out = append(out, Pair{cid, name + " ordered " + it})
			}
			return out
		},
		R: 2,
	}
	joined, _ := join.run(joinInput)
	fmt.Println("reduce-side join:")
	for _, p := range joined {
		fmt.Printf("  cid=%s  %s\n", p.Key, p.Val)
	}
}

// customerKey extracts the id from a "C|name" record's input key convention.
// (Here the customer's join key is encoded in the value; for the demo we
// derive it from the record by mapping name→id deterministically.)
func customerKey(v string) string {
	switch {
	case strings.HasSuffix(v, "Alice"):
		return "1"
	case strings.HasSuffix(v, "Bob"):
		return "2"
	}
	return "?"
}
```

Expected output (key order within a partition is sorted; partition order depends on the hash):

```text
word count:
  and   1
  cat   2
  dog   2
  log   1
  mat   1
  on    2
  sat   2
  the   6
  dog   2
  ...
  (combiner kept N pairs off the shuffle)
inverted index:
  and   -> doc3
  cat   -> doc1,doc3
  the   -> doc1,doc2,doc3
  ...
reduce-side join:
  cid=1  Alice ordered book
  cid=1  Alice ordered pen
  cid=2  Bob ordered lamp
```

The engine makes the model tangible: the **combiner** pre-sums each mapper's counts (the `shuffleSaved` counter reports how many `("the",1)`-style pairs never crossed the shuffle); the **partitioner** routes keys by `hash(key) mod R`; each reducer sees its keys **sorted**; the **inverted index** turns documents inside out into posting lists; and the **reduce-side join** tags each record by source (`C`/`O`) so the reducer can form the customer×orders cross-product — and, being reduce-side, every record of both inputs passed through the shuffle.

### Python

```python
from collections import defaultdict
import hashlib


def partition(key, R):
    h = int(hashlib.md5(key.encode()).hexdigest(), 16)
    return h % R


def run_job(inputs, mapper, reducer, R, combiner=None):
    """map → (optional) combine per mapper → partition → shuffle(sort+group) → reduce.
    Returns (outputs, pairs_saved_by_combiner)."""
    # --- MAP, one "mapper" per input record ---
    mapped = [mapper(k, v) for k, v in inputs.items()]
    emitted = sum(len(m) for m in mapped)

    # --- COMBINE, per mapper (the map-side mini-reduce) ---
    if combiner is not None:
        new_mapped = []
        for m in mapped:
            g = defaultdict(list)
            for k, v in m:
                g[k].append(v)
            out = []
            for k in sorted(g):
                for cv in combiner(k, g[k]):
                    out.append((k, cv))
            new_mapped.append(out)
        mapped = new_mapped
    after_combine = sum(len(m) for m in mapped)
    shuffle_saved = emitted - after_combine

    # --- PARTITION + SHUFFLE: route, then sort+group per partition ---
    parts = [defaultdict(list) for _ in range(R)]
    for m in mapped:
        for k, v in m:
            parts[partition(k, R)][k].append(v)

    # --- REDUCE: one task per partition; keys arrive sorted ---
    out = []
    for r in range(R):
        for k in sorted(parts[r]):          # keys in SORTED order
            out.extend(reducer(k, parts[r][k]))
    return out, shuffle_saved


def main():
    docs = {
        "doc1": "the cat sat on the mat",
        "doc2": "the dog sat on the log",
        "doc3": "the cat and the dog",
    }

    # --- Job 1: WORD COUNT with a combiner (combiner == reducer: sum) ---
    sum_vals = lambda _k, vals: [sum(vals)]
    counts, saved = run_job(
        docs,
        mapper=lambda _id, text: [(w, 1) for w in text.split()],
        reducer=lambda w, vals: [(w, sum(vals))],
        R=2,
        combiner=sum_vals,           # local pre-sum shrinks the shuffle
    )
    print("word count:")
    for w, c in sorted(counts):
        print(f"  {w:<5} {c}")
    print(f"  (combiner kept {saved} pairs off the shuffle)")

    # --- Job 2: INVERTED INDEX (word → sorted posting list) ---

    def idx_map(doc_id, text):
        return [(w, doc_id) for w in dict.fromkeys(text.split())]  # dedup per doc

    index, _ = run_job(
        docs,
        mapper=idx_map,
        reducer=lambda w, docs_: [(w, ",".join(sorted(set(docs_))))],
        R=2,
    )
    print("inverted index:")
    for w, posting in sorted(index):
        print(f"  {w:<5} -> {posting}")

    # --- Job 3: REDUCE-SIDE JOIN (Orders ⋈ Customers on customerID) ---
    customers = {"1": "Alice", "2": "Bob"}
    orders = [("1", "book"), ("1", "pen"), ("2", "lamp")]
    join_input = {}
    for cid, name in customers.items():
        join_input[f"c:{cid}"] = ("C", cid, name)
    for i, (cid, item) in enumerate(orders):
        join_input[f"o:{i}"] = ("O", cid, item)

    def join_map(_id, rec):
        src, cid, payload = rec
        return [(cid, (src, payload))]     # key on the join key (customerID)

    def join_reduce(cid, vals):
        name = next((p for s, p in vals if s == "C"), "?")
        items = sorted(p for s, p in vals if s == "O")
        return [(cid, f"{name} ordered {it}") for it in items]  # customer × orders

    joined, _ = run_job(join_input, mapper=join_map, reducer=join_reduce, R=2)
    print("reduce-side join:")
    for cid, line in sorted(joined):
        print(f"  cid={cid}  {line}")


if __name__ == "__main__":
    main()
```

Both programs implement the same four-stage pipeline. The **word count** job reuses its summing reducer *as* its combiner (legal because sum is a commutative monoid) and reports the pairs the combiner kept off the shuffle; the **inverted index** emits `(word, docID)` and folds each word's docs into a sorted posting list; the **reduce-side join** keys both `Customers` and `Orders` on `customerID`, tags each value by source, and forms the cross-product in the reducer — paying a full shuffle of both inputs, exactly the cost a map-side broadcast join would avoid when one table is small.

---

## Pitfalls

- **Trying to combine a non-monoid (the average trap).** A combiner is only correct when the reduce operator is **associative and commutative**. The **average is neither associative nor a monoid** — the mean of means is not the overall mean — so combining partial averages gives wrong answers. Carry **`(sum, count)`** (a componentwise-add monoid) through map and combiner, and divide **once** at the reducer. The same rule covers variance (`(sum, sum², count)`) and any aggregate richer than a running total: *enlarge the value to a partial state that is a monoid.*

- **Assuming the combiner runs (or runs once).** The framework may run a combiner zero, one, or many times on arbitrary subsets — it is an *optimization*, not a guarantee. Never put logic in the combiner whose correctness depends on it running, on running exactly once, or on seeing all of a key's values. The combiner must be a pure pre-reduce that the reducer's fold absorbs idempotently; if it isn't a commutative-monoid step, *don't have one*.

- **Skewed keys overload one reducer.** Because all values for a key go to a single reducer (`hash(key) mod R`), a hot key (a celebrity user, the word "the", a `NULL` join key) sends a huge group to *one* reducer that then dominates the wall-clock time — the classic straggler. Combiners help (they pre-shrink the hot key's volume), but for severe skew you must split the hot key (salt it: `key#0..key#n` across reducers, then a second job re-aggregates), filter `NULL`s out of joins, or use a custom partitioner. A perfectly balanced average partition with one 100× key is still bottlenecked by that key.

- **Using a reduce-side join when a broadcast join would do.** A reduce-side join **shuffles both datasets in full** — the most expensive thing in MapReduce — and is only necessary when *both* sides are large. If one side fits in memory, **broadcast it to every mapper and join map-side**: zero shuffle, just a small broadcast. Reaching for the reduce-side join by default is the most common MapReduce performance mistake; check the small-side size first.

- **Expecting values to arrive sorted.** The shuffle sorts and groups by **key**, but a reducer sees a key's **values in arbitrary order**. If your reducer needs ordered values (events by time, the latest record), do not buffer-and-sort in the reducer (it can OOM on a big group) — use **secondary sort**: fold the order field into a composite key, partition/group by the primary part, and let the shuffle's sort deliver the values pre-ordered.

- **Non-deterministic or side-effecting tasks break re-execution.** The framework re-runs failed and straggling tasks (and runs combiners speculatively), so a `map`/`reduce` that reads a clock, a random seed, or external mutable state, or that writes outside the atomic-commit protocol, can produce different or doubled results. **Tasks must be deterministic and idempotent.** This is not style; it is the precondition for the fault-tolerance model to be correct.

- **Treating an iterative algorithm as repeated MapReduce jobs.** PageRank/k-means/SGD as a chain of independent jobs **re-reads the invariant data from disk and re-shuffles every iteration** — often a >10× I/O tax. That is precisely the workload MapReduce is *bad* at and the reason Spark/dataflow exist (cache the loop-invariant input in memory, shuffle only what changes). If you find yourself launching many near-identical jobs in a loop, you have outgrown batch MapReduce.

---

## Summary

- **The execution model.** Input → **splits** → `M` **map tasks** emit intermediate `(k, v)` → the **partitioner** (`hash(k) mod R`) assigns each pair to one of `R` reducers → the **shuffle** moves and groups the data → `R` **reduce tasks**, one per partition, fold each key's values. The contract is that *all values for a key reach one reducer*; the partitioner enforces it.

- **The shuffle is a distributed sort.** "Group all pairs by key globally" = partition across reducers + sort within each — exactly the [parallel sorting and merging](../03-parallel-sorting-and-merging/middle.md) machinery (sorted runs per mapper, merged at the reducer). It is the only phase that moves bulk data over the network, so it dominates the cost, and **keys arrive at a reducer in sorted order** (values do not, by default).

- **Combiners** pre-reduce a mapper's output to shrink the shuffle. Correct **iff the reduce operator is a commutative monoid** (associative + commutative) — the [parallel-reduce requirement](../04-parallel-reduce-and-map/middle.md). `sum`/`count`/`max`/`min` combine; **average does not** (carry `(sum, count)`). The framework may run a combiner any number of times, so it must be a pure pre-fold.

- **The design patterns**, each a map shape + reduce shape: **summarization** (per-group monoid fold; average via `(sum, count)`); **filtering/sampling** (map-only) and **top-K** (local top-K → merge, a two-level reduce); **inverted index** (`map: word→docID`, `reduce: posting list`); **join** — **reduce-side** (tag by source, join in the reducer, *shuffles both datasets*) vs **map-side/broadcast** (replicate the small table to every mapper, *zero shuffle*); **secondary sort** (composite key + partition-on-primary + group-on-primary to get values pre-ordered); **grouping/sessionization** (secondary sort + a stateful single pass).

- **Data locality and fault tolerance.** Run the map **where its split lives** (local read, not network); **re-execute** failed/straggling tasks and run duplicates speculatively. Re-execution is only correct if tasks are **deterministic and idempotent**.

- **The limits.** Iterative algorithms (PageRank, k-means, SGD) are painful: each iteration is a full job that **re-reads the invariant data from disk and re-shuffles**. Caching the loop-invariant input in memory and expressing the work as an optimizable dataflow graph is the leap to **Spark/dataflow** — same patterns, new execution model.

Revisit [junior](./junior.md) for the three-phase picture and the word-count walk-through; build up from [parallel reduce and map](../04-parallel-reduce-and-map/middle.md) for the monoid/combiner foundation and from [parallel sorting and merging](../03-parallel-sorting-and-merging/middle.md) for the sort that *is* the shuffle. Advance to [senior](./senior.md) for the Spark/dataflow execution model (in-memory iteration, lazy whole-job optimization, broadcast/sort-merge join selection), skew-handling at scale, and the formal cost model of shuffle-heavy computation.
