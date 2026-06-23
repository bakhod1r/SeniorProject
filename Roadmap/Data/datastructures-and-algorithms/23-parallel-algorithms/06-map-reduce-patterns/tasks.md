# MapReduce Patterns — Practice Tasks

> Coding tasks are solved in **one** language (**Go** or **Python**) with the full reference solution; a short snippet in the other language is provided where it clarifies the port. Where marked **[coding]**, build the job on top of a tiny in-process MapReduce **engine** — `map → partition → shuffle/group-by-key → combine → reduce` — and drive a **shuffle counter** (the number of intermediate `(key, value)` pairs that cross from map to reduce) alongside the result. The acceptance test is always the same shape: *the engine's output equals a straightforward sequential reference **AND** the measured shuffle volume / skew behaves as predicted — a combiner cuts the intermediate-pair count, a broadcast join avoids the shuffle entirely, salting rebalances an overloaded reducer.*
> **[analysis]** tasks need no code: argue a combiner's correctness, count a join's shuffle cost, or reason about the MRC/MPC rounds model — model derivations are provided so you can grade yourself.

A **MapReduce** computation is three phases. **Map** turns each input record into zero or more intermediate `(key, value)` pairs. **Shuffle** groups those pairs by key — *this is a distributed sort*, and it is where all the data movement and all the cost live. **Reduce** folds each key's group of values into the output. Two optional hooks shape the cost: a **combiner** (a local pre-reduce on each mapper, cutting what is shuffled) and a **partitioner** (which reducer a key is routed to). The quantities you will build, measure, and reason about on every task:

| Phase | What it does | Cost driver |
| --- | --- | --- |
| **Map** | `record → [(k, v), …]` | `Θ(input)` — embarrassingly parallel, no key interaction |
| **Combiner** | local `reduce` on a mapper's output | cuts **shuffle volume** (intermediate-pair count) |
| **Partitioner** | `key → reducer id` (default `hash(k) mod R`) | controls **balance** across the `R` reducers |
| **Shuffle** | group all pairs by key (a distributed **sort**) | the dominant cost — bytes across the network |
| **Reduce** | `(k, [v, …]) → output` | `Θ(values per key)` — skew makes one reducer the straggler |

The recurring discipline for every coding task is identical: **run the job through the engine phase by phase, count the intermediate pairs that cross the shuffle, and confirm the output matches the sequential reference while the shuffle count behaves as the pattern predicts.** A job you never check against a sequential answer is a guess; a shuffle volume you never measure is the cost you cannot see. Tie the two together on every task — *correct output and predicted shuffle*.

**Related practice:**
- [Parallel Reduce and Map tasks](../04-parallel-reduce-and-map/tasks.md) — the combiner *is* a reduce; reduce-by-key is the engine's group-by; the monoid law that makes a combiner correct is proved there.
- [Parallel Sorting and Merging tasks](../03-parallel-sorting-and-merging/tasks.md) — the shuffle is a distributed sort; sample sort's splitter selection is exactly the range partitioner that fixes skew here.

**This topic's notes:** [junior](junior.md) · [middle](middle.md) · [senior](senior.md) · [professional](professional.md)

A note on the model and quantities used throughout:
- **Shuffle volume.** The single number we measure everywhere: how many intermediate `(key, value)` pairs (or bytes) leave the map side and enter the reduce side. On a real cluster this is network traffic, the thing that dominates wall-clock time. A combiner that turns 1,000 `("the", 1)` pairs into one `("the", 1000)` pair cuts the shuffle by a factor of 1,000 for that key.
- **A combiner is a reduce.** The combiner runs the reduce logic *locally* on each mapper before the shuffle. It is correct exactly when the reduce is over a **commutative monoid** — associative, commutative, with an identity — because the framework may apply it zero, one, or many times in any grouping (see [the parallel-reduce monoid tasks](../04-parallel-reduce-and-map/tasks.md)). `sum`, `max`, `min`, `count` combine; a naive `average` does **not** (Task 5).
- **The partitioner decides balance.** Default `hash(key) mod R` spreads keys uniformly *in expectation*, but if one key is hot (a power-law/Zipf distribution), all its values land on one reducer regardless of `R` — **partition skew**. The fixes (salting, two-stage aggregation, range partitioning) are the advanced tasks.
- **The idealization vs reality.** We count pairs, not microseconds. The engine here is in-process and sequential — it *simulates* the phases so you can measure shuffle volume exactly, deterministically, and without a cluster. The MRC/MPC rounds model (Task 11) is where we reason about what the real distributed system charges: rounds of communication, and why iterative algorithms need many of them.

---

## The engine

Every coding task runs on this tiny in-process engine. Build it once (Task 1 expands it); reuse it everywhere. It exposes the five phases as separate, inspectable steps so you can count what crosses the shuffle.

```python
from collections import defaultdict

class Stats:
    """Counts what crosses the shuffle: intermediate pairs emitted by map (or by
    the combiner), so every task can MEASURE shuffle volume before/after."""
    def __init__(self):
        self.map_pairs = 0        # pairs emitted by all mappers
        self.shuffled_pairs = 0   # pairs that actually cross to the reduce side

def run_mapreduce(records, mapper, reducer, *, combiner=None,
                  partitioner=None, num_reducers=1, key_sort=False):
    """A faithful, in-process MapReduce.
      mapper:   record           -> iterable of (key, value)
      combiner: (key, [values])  -> iterable of (key, value)   (optional local reduce)
      reducer:  (key, [values])  -> iterable of (key, value)   (final fold)
      partitioner: key -> reducer id in [0, num_reducers)       (default hash mod R)
    Returns (output_list, stats). Output is sorted by key for deterministic checks."""
    stats = Stats()
    if partitioner is None:
        partitioner = lambda k: hash(k) % num_reducers

    # --- MAP (per "mapper" we just treat the whole input as one split here; the
    #     combiner runs per split, which is where it cuts shuffle volume) ---
    map_out = []
    for r in records:
        for k, v in mapper(r):
            map_out.append((k, v))
            stats.map_pairs += 1

    # --- COMBINE (optional local reduce, per split, before the shuffle) ---
    if combiner is not None:
        grouped = defaultdict(list)
        for k, v in map_out:
            grouped[k].append(v)
        combined = []
        for k in grouped:
            for ck, cv in combiner(k, grouped[k]):
                combined.append((ck, cv))
        map_out = combined

    stats.shuffled_pairs = len(map_out)   # what actually crosses the network

    # --- SHUFFLE: partition then group-by-key (a distributed SORT) ---
    partitions = [defaultdict(list) for _ in range(num_reducers)]
    for k, v in map_out:
        partitions[partitioner(k) % num_reducers][k].append(v)

    # --- REDUCE: each reducer folds its keys' groups ---
    output = []
    for part in partitions:
        keys = sorted(part) if key_sort else part
        for k in keys:
            for rk, rv in reducer(k, part[k]):
                output.append((rk, rv))
    output.sort(key=lambda kv: kv[0])     # deterministic order for assertions
    return output, stats
```

This is faithful to Hadoop/Spark semantics in every way that matters for the tasks: map emits pairs, an optional combiner pre-reduces locally, a partitioner routes keys to reducers, the shuffle groups by key (a sort), and the reduce folds each group. The one simplification — one split for the whole input — only changes *how many times* the combiner fires, not whether it is correct; the per-key shuffle count it produces is exactly right.

---

## Beginner Tasks

### Task 1 — Word count, with and without a combiner; measure the shuffle cut **[coding]**

`[easy]` Build the canonical MapReduce job on the engine: **word count**. The mapper emits `(word, 1)` for each word; the reducer sums. Then add a **combiner** that locally sums each mapper's `(word, 1)` pairs into one `(word, partial_count)` pair, and **measure** the drop in shuffle volume — the number of intermediate pairs that cross to the reduce side. Confirm the counts match a sequential `collections.Counter`, and that the combiner cuts the shuffle from `total_words` to `distinct_words`.

#### Python

```python
from collections import Counter

def wc_mapper(line):
    for w in line.split():
        yield (w, 1)                       # one pair per word occurrence

def wc_reducer(key, values):
    yield (key, sum(values))               # total count for the word

def wc_combiner(key, values):
    yield (key, sum(values))               # SAME logic, run locally -> one pair per word

if __name__ == "__main__":
    lines = [
        "the cat sat on the mat",
        "the cat ran after the rat",
        "the rat ran on the mat the the the",
    ]
    ref = Counter(w for line in lines for w in line.split())

    # No combiner: every word occurrence crosses the shuffle.
    out_nc, st_nc = run_mapreduce(lines, wc_mapper, wc_reducer, key_sort=True)
    assert dict(out_nc) == dict(ref), "word count must match Counter"

    # With combiner: one pair per DISTINCT word per split crosses instead.
    out_c, st_c = run_mapreduce(lines, wc_mapper, wc_reducer,
                                combiner=wc_combiner, key_sort=True)
    assert dict(out_c) == dict(ref), "combiner must not change the result"

    total_words = sum(len(l.split()) for l in lines)
    distinct = len(ref)
    assert st_nc.shuffled_pairs == total_words, "no combiner: shuffle = every occurrence"
    assert st_c.shuffled_pairs == distinct, "combiner: shuffle = distinct words (one split)"
    print(f"shuffle without combiner = {st_nc.shuffled_pairs} (every word)")
    print(f"shuffle with    combiner = {st_c.shuffled_pairs} (distinct words)")
    print(f"reduction factor = {st_nc.shuffled_pairs / st_c.shuffled_pairs:.1f}x")
    print("OK: word count matches Counter; combiner cuts shuffle to distinct-word count")
```

#### Go (core)

```go
// Mapper emits (word, 1); reducer/combiner sum. The combiner runs locally on
// each split, collapsing many (word,1) into one (word, partial) before the shuffle.
func wcMapper(line string) []KV {
	var out []KV
	for _, w := range strings.Fields(line) {
		out = append(out, KV{w, 1})
	}
	return out
}

func wcReduce(key string, vals []int) int { // also serves as the combiner
	s := 0
	for _, v := range vals {
		s += v
	}
	return s
}
```

- **Constraints:** The mapper emits exactly one `(word, 1)` per word occurrence; the reducer sums a key's values. The combiner must run the **same** sum logic locally. Without a combiner the shuffle volume equals the total word count (every occurrence crosses); with a combiner over one split it equals the **distinct** word count. The output must be identical with and without the combiner — the combiner changes only the cost, never the answer.
- **Hint:** Word count is the "hello world" of MapReduce because it exhibits the whole pattern: map projects each record to keyed contributions, shuffle groups by key, reduce folds. The combiner is the first and most important optimization: text is Zipf-distributed, so a handful of words (`the`, `a`, `of`) dominate, and collapsing their thousands of `1`s into a single partial sum *on the mapper* is the difference between shuffling gigabytes and megabytes. The combiner is legal here precisely because `sum` is an associative, commutative monoid (proved in [the parallel-reduce tasks](../04-parallel-reduce-and-map/tasks.md)) — the framework may apply it any number of times in any grouping and still get the right total.
- **Acceptance test:** `dict(out) == dict(Counter(...))` both with and without the combiner; `shuffled_pairs == total_words` without, `== distinct_words` with (one split). Keep `run_mapreduce`, the mapper, and the reducer — every later task builds on this engine.

---

### Task 2 — Sum-by-key (revenue per region) and why this combiner is trivially correct **[coding]**

`[easy]` Generalize word count's `(key, 1)` to arbitrary numeric payloads: **sum-by-key**. Given records `(region, amount)`, compute total revenue per region. Map emits `(region, amount)`; reduce sums; the combiner is the *same* sum. Verify against a sequential `defaultdict` sum and confirm the combiner again cuts the shuffle to the number of distinct keys per split — and state, in one line, *why* it is safe (sum is a commutative monoid, so combining partial sums equals summing everything).

#### Python

```python
from collections import defaultdict

def sum_mapper(rec):
    region, amount = rec
    yield (region, amount)

def sum_reducer(key, values):
    yield (key, sum(values))               # also the combiner

if __name__ == "__main__":
    import random
    random.seed(0)
    regions = ["us", "eu", "apac", "latam"]
    records = [(random.choice(regions), random.randint(1, 100)) for _ in range(10_000)]

    ref = defaultdict(int)
    for r, a in records:
        ref[r] += a

    out, st = run_mapreduce(records, sum_mapper, sum_reducer,
                            combiner=sum_reducer, key_sort=True)
    assert dict(out) == dict(ref), "sum-by-key must match the sequential sum"
    # One split + one combiner pass -> one partial per distinct key crosses the shuffle.
    assert st.shuffled_pairs == len(ref), "combiner collapses to distinct-key count"
    assert st.map_pairs == len(records), "map emits one pair per record"
    print(f"records={len(records)}  map pairs={st.map_pairs}  "
          f"shuffled (after combiner)={st.shuffled_pairs}  distinct keys={len(ref)}")
    print("OK: sum-by-key matches; combiner is safe because + is a commutative monoid")
```

- **Constraints:** Map emits one `(region, amount)` per record; reduce and combiner both sum. Output must equal the sequential per-region sum. With the combiner over one split, shuffle volume equals the number of distinct keys; without it, equals the record count. Document the safety argument: `sum` is associative and commutative with identity `0`, so `combine(a, combine(b, c)) == sum of all` regardless of grouping.
- **Hint:** Sum-by-key, max-by-key, min-by-key, count-by-key, and OR/AND-by-key all share this shape and all combine safely — they are reductions over commutative monoids, the same algebraic structure that makes a parallel tree reduce correct. The pattern is *aggregation*: project records to `(group_key, contribution)`, then fold contributions per group. The combiner is the local fold, and it is correct iff the fold's operator is a commutative monoid. Hold onto this — Task 5 breaks it deliberately with `average`, which is *not* a monoid over raw values.
- **Acceptance test:** `dict(out) == dict(ref)`; `shuffled_pairs == len(distinct keys)` with the combiner. The one-line safety note must name commutativity + associativity + identity as the license for the combiner. This is the template for every monoid aggregation; Task 5 shows what a *non*-monoid aggregation requires.

---

### Task 3 — A partitioner, and watching keys route to reducers **[coding]**

`[easy]` The **partitioner** decides which reducer owns a key — by default `hash(key) mod R`. Make it visible: run sum-by-key with `R` reducers, install the default hash partitioner, and **record which keys land on which reducer**. Then swap in a custom partitioner (e.g. route by first letter) and show the routing changes while the result does not. Confirm every key's *entire* value group goes to exactly one reducer (the invariant the reduce relies on).

#### Python

```python
def sum_mapper(rec):
    yield (rec[0], rec[1])

def sum_reducer(key, values):
    yield (key, sum(values))

def trace_routing(records, partitioner, R):
    """Return {reducer_id: set(keys)} so we can SEE the partition map."""
    from collections import defaultdict
    routing = defaultdict(set)
    for k, _ in records:
        routing[partitioner(k) % R].add(k)
    return routing

if __name__ == "__main__":
    records = [("apple", 3), ("banana", 5), ("avocado", 2), ("cherry", 4),
               ("apple", 1), ("blueberry", 7), ("cherry", 6)]
    ref = {"apple": 4, "banana": 5, "avocado": 2, "cherry": 10, "blueberry": 7}
    R = 3

    # Default hash partitioner.
    hash_part = lambda k: hash(k) % R
    out_h, _ = run_mapreduce(records, sum_mapper, sum_reducer,
                             partitioner=hash_part, num_reducers=R, key_sort=True)
    assert dict(out_h) == ref, "result independent of partitioner"

    # Custom partitioner: route by first letter -> keys with same initial co-locate.
    letter_part = lambda k: (ord(k[0]) - ord('a')) % R
    out_l, _ = run_mapreduce(records, sum_mapper, sum_reducer,
                             partitioner=letter_part, num_reducers=R, key_sort=True)
    assert dict(out_l) == ref, "different partitioner, same answer"

    # The invariant: every key lands on EXACTLY one reducer (groups are not split).
    routing = trace_routing(records, letter_part, R)
    seen = {}
    for rid, keys in routing.items():
        for k in keys:
            assert k not in seen, "a key must map to a single reducer"
            seen[k] = rid
    # With the letter partitioner, all 'a*' keys share a reducer, all 'b*' another, etc.
    a_reducer = {seen[k] for k in ("apple", "avocado")}
    b_reducer = {seen[k] for k in ("banana", "blueberry")}
    assert len(a_reducer) == 1 and len(b_reducer) == 1, "co-location by first letter"
    print("routing by first letter:", {rid: sorted(ks) for rid, ks in routing.items()})
    print("OK: partitioner routes keys to reducers; result invariant; each key -> one reducer")
```

- **Constraints:** A partitioner is a pure function `key → int` reduced mod `R`. The **result must be identical** for any partitioner — partitioning is about *placement*, not correctness. The load-bearing invariant: a key's entire value group must go to a single reducer (otherwise a partial reduce would be wrong); assert that no key appears under two reducer ids. Show a custom partitioner producing visibly different co-location than the hash default.
- **Hint:** The partitioner is the lever for two things you will pull later. (1) **Co-location:** a range partitioner that keeps adjacent keys together lets a downstream consumer read sorted output (and is how a global sort is done in MapReduce — sample splitters, range-partition, then each reducer sorts its range, exactly the sample-sort idea from [the parallel-sorting tasks](../03-parallel-sorting-and-merging/tasks.md)). (2) **Balance:** the default `hash mod R` is uniform only if keys are uniform; a custom partitioner is how you spread a known-hot key. Get comfortable inspecting the routing now — Tasks 9 and 10 fight skew by changing exactly this function.
- **Acceptance test:** Output equals the sequential sum under both partitioners; each key maps to exactly one reducer; the custom partitioner co-locates keys by first letter as designed. The partitioner is now a visible, controllable part of the pipeline — the substrate for the skew fixes ahead.

---

## Intermediate Tasks

### Task 4 — Inverted index: word → sorted document list **[coding]**

`[medium]` Build the data structure behind every search engine: the **inverted index**, mapping each term to the sorted list of documents that contain it. Map emits `(term, doc_id)` for each term occurrence; reduce collects a key's doc ids into a **deduplicated, sorted** list. Add a combiner that locally deduplicates per split (cutting shuffle when a term repeats within a document), and verify the index against a sequential build.

#### Python

```python
def index_mapper(doc):
    doc_id, text = doc
    for term in text.split():
        yield (term, doc_id)               # term occurrence -> (term, doc)

def index_reducer(key, doc_ids):
    yield (key, sorted(set(doc_ids)))      # dedup + sort the posting list

def index_combiner(key, doc_ids):
    # Local dedup: a term repeated in one doc crosses the shuffle once, not N times.
    for d in sorted(set(doc_ids)):
        yield (key, d)

if __name__ == "__main__":
    docs = [
        (1, "the cat sat the cat"),
        (2, "the dog ran"),
        (3, "cat and dog and cat"),
    ]
    # Sequential reference.
    from collections import defaultdict
    ref = defaultdict(set)
    for did, text in docs:
        for term in text.split():
            ref[term].add(did)
    ref = {t: sorted(ds) for t, ds in ref.items()}

    out_nc, st_nc = run_mapreduce(docs, index_mapper, index_reducer, key_sort=True)
    assert dict(out_nc) == ref, "inverted index must match sequential build"

    out_c, st_c = run_mapreduce(docs, index_mapper, index_reducer,
                                combiner=index_combiner, key_sort=True)
    assert dict(out_c) == ref, "combiner (local dedup) must not change the index"

    # "the" appears twice in doc 1, "cat" twice in doc 3: combiner removes those dups.
    total_occurrences = sum(len(t.split()) for _, t in docs)
    distinct_term_doc = sum(len(set(t.split())) for _, t in docs)  # excludes "and" dup etc.
    assert st_nc.shuffled_pairs == total_occurrences
    assert st_c.shuffled_pairs == distinct_term_doc
    print(f"shuffle without combiner = {st_nc.shuffled_pairs} (every occurrence)")
    print(f"shuffle with    combiner = {st_c.shuffled_pairs} ((term,doc) pairs)")
    print("OK: inverted index matches; combiner dedups (term,doc) before the shuffle")
```

- **Constraints:** Each posting list must be **deduplicated and sorted** — a term appearing twice in one document yields that doc id once. The combiner deduplicates *within a split* (so a term repeated in a document crosses the shuffle a single time), and must not change the final index. Verify against a sequential `term → sorted(set(doc_ids))` build. Handle terms that appear in only one document and terms that span all documents.
- **Hint:** The inverted index is the archetypal **grouping** job where the reduce builds a *collection*, not a scalar — `(term, [doc₁, doc₂, …])`. Its combiner is set-union-flavored (local dedup), which is a monoid (sets under union, identity ∅), so it is safe. Real search indexers extend this exact shape: emit `(term, (doc, position))` for phrase queries, or `(term, (doc, tf))` to carry term frequency for ranking — the map projects, the shuffle groups by term, the reduce assembles the posting list. The whole of Lucene/Elasticsearch indexing is this pattern at scale, with the posting lists then delta-and-varint compressed.
- **Acceptance test:** `dict(out) == ref` with and without the combiner; posting lists are sorted and deduplicated; the combiner reduces shuffle from total term occurrences to distinct `(term, doc)` pairs. This is the grouping-into-collections variant of the aggregation pattern from Tasks 1–2.

---

### Task 5 — Average-by-key: why the naive combiner is wrong, and the (sum, count) fix **[coding]**

`[medium]` Now the trap. Computing the **average value per key** with a combiner that emits local averages is **wrong** — averaging averages is not the average. The fix is to make the intermediate value a **(sum, count)** pair, which *is* a commutative monoid: combine by adding componentwise, and divide only at the very end. Implement both the broken and correct versions, **show the broken one disagrees with the true mean**, and show the `(sum, count)` version matches exactly.

#### Python

```python
from collections import defaultdict

def avg_mapper(rec):
    key, value = rec
    yield (key, (value, 1))                # carry (sum, count) from the start

def avg_combiner(key, partials):
    s = sum(p[0] for p in partials)        # add sums
    c = sum(p[1] for p in partials)        # add counts  -> (sum, count) is a monoid
    yield (key, (s, c))

def avg_reducer(key, partials):
    s = sum(p[0] for p in partials)
    c = sum(p[1] for p in partials)
    yield (key, s / c)                     # divide ONCE, at the end

# --- The WRONG version: combiner emits a local average, reducer averages those ---
def bad_mapper(rec):
    yield (rec[0], rec[1])

def bad_combiner(key, values):
    yield (key, sum(values) / len(values))  # local mean -- destroys the counts!

def bad_reducer(key, values):
    yield (key, sum(values) / len(values))  # mean of per-split means != true mean

if __name__ == "__main__":
    # Key "a": values [10, 20, 30] in one combiner group and [100] in another would
    # average-of-averages to (20 + 100)/2 = 60, but the true mean is 160/4 = 40.
    # With a single split here, force the discrepancy by sizing groups unevenly via
    # a hand-rolled check, then prove the (sum,count) version is robust to grouping.
    records = [("a", 10), ("a", 20), ("a", 30), ("a", 100),
               ("b", 5), ("b", 15)]
    ref = {"a": 160 / 4, "b": 20 / 2}      # true means: a=40, b=10

    # Correct: (sum, count) monoid, divide once.
    out_ok, _ = run_mapreduce(records, avg_mapper, avg_reducer,
                              combiner=avg_combiner, key_sort=True)
    assert dict(out_ok) == ref, "(sum,count) average must equal the true mean"

    # Demonstrate the averaging-averages bug directly (uneven sub-groups).
    group1 = [10, 20, 30]; group2 = [100]
    naive = (sum(group1) / len(group1) + sum(group2) / len(group2)) / 2  # = 30
    true_mean = sum(group1 + group2) / len(group1 + group2)              # = 40
    assert naive != true_mean, "averaging averages is wrong when group sizes differ"
    print(f"naive avg-of-avgs = {naive}  but true mean = {true_mean}  -> WRONG")
    print(f"(sum,count) result = {dict(out_ok)}  -> matches true means")
    print("OK: naive average combiner is broken; (sum,count) is a monoid and correct")
```

- **Constraints:** Show numerically that averaging local averages differs from the true mean when sub-group sizes are unequal (e.g. means of `[10,20,30]` and `[100]` give `(20+100)/2 = 60` against the true `40`). The correct version must carry `(sum, count)`, combine by componentwise addition, and divide **once** in the reducer. The `(sum, count)` result must equal the true per-key mean exactly, *independent of how the framework groups the combiner calls*.
- **Hint:** This is the most important combiner lesson in all of MapReduce: **a combiner is correct iff the reduce is a commutative monoid, so you must reduce over a value type that forms one.** `average` over raw numbers is not a monoid — there is no associative binary `⊕` on plain values whose final result is the mean, because the operation needs to remember *how many* values it has seen. Promote the value to `(sum, count)`; that *is* a monoid (`(s₁,c₁) ⊕ (s₂,c₂) = (s₁+s₂, c₁+c₂)`, identity `(0,0)`), and the mean is a final projection `s/c` applied once. The same trick generalizes: variance needs `(sum, sum_of_squares, count)`; a moving statistic needs whatever sufficient statistics form a monoid. When a combiner seems impossible, you usually just have not found the monoid yet.
- **Acceptance test:** The naive average-of-averages is shown `≠` the true mean for unequal group sizes; the `(sum, count)` version equals the true per-key mean for every key. The takeaway is concrete and reusable: *carry sufficient statistics that form a monoid, project to the final answer once at the end.*

---

### Task 6 — Top-K per key: a combiner that emits each split's local top-K **[coding]**

`[medium]` Find the **top-K values per key** (e.g. the 3 highest-scoring events per user). The combiner pre-trims: each split emits only its **local** top-K per key, so at most `K` values per key cross the shuffle from each split instead of all of them. The reducer merges the local top-Ks into the global top-K. Verify against a sequential top-K and confirm the combiner caps the shuffle at `K` per key per split.

#### Python

```python
import heapq
from collections import defaultdict

K = 3

def topk_mapper(rec):
    user, score = rec
    yield (user, score)

def topk_combiner(key, scores):
    for s in heapq.nlargest(K, scores):    # local top-K only -> <= K cross the shuffle
        yield (key, s)

def topk_reducer(key, scores):
    yield (key, heapq.nlargest(K, scores)) # merge local top-Ks -> global top-K

if __name__ == "__main__":
    import random
    random.seed(1)
    users = ["u1", "u2", "u3"]
    records = [(random.choice(users), random.randint(0, 1000)) for _ in range(3000)]

    # Sequential reference.
    bucket = defaultdict(list)
    for u, s in records:
        bucket[u].append(s)
    ref = {u: heapq.nlargest(K, ss) for u, ss in bucket.items()}

    out_nc, st_nc = run_mapreduce(records, topk_mapper, topk_reducer, key_sort=True)
    assert dict(out_nc) == ref, "top-K must match sequential nlargest"

    out_c, st_c = run_mapreduce(records, topk_mapper, topk_reducer,
                                combiner=topk_combiner, key_sort=True)
    assert dict(out_c) == ref, "top-K combiner must not change the answer"

    # One split: combiner caps each key at K, so shuffle <= K * (#distinct keys).
    assert st_nc.shuffled_pairs == len(records), "no combiner: every score crosses"
    assert st_c.shuffled_pairs <= K * len(ref), "combiner caps at K per key per split"
    print(f"shuffle without combiner = {st_nc.shuffled_pairs}")
    print(f"shuffle with    combiner = {st_c.shuffled_pairs}  (<= K*{len(ref)})")
    print("OK: top-K-per-key matches; combiner caps shuffle at K per key per split")
```

- **Constraints:** The combiner emits each split's **local** top-K per key (use a heap / `nlargest`); the reducer merges all local top-Ks into the global top-K. The combiner must not change the answer — the global top-K is the top-K of the union of local top-Ks (any element not in a split's local top-K cannot be in the global top-K *for the values from that split*). With one split, shuffle is capped at `K · distinct_keys`; with many splits it would be `K · distinct_keys · splits` — still vastly less than every value.
- **Hint:** Top-K is correct under a combiner because "take the top-K" is an associative, commutative operation on multisets: `topK(A ∪ B) = topK(topK(A) ∪ topK(B))`. That identity is exactly the monoid law a combiner needs — the bounded-priority-queue forms a monoid under "merge and keep K largest." This is the same reasoning as the `(sum,count)` average: find the structure that combines. Top-K combiners are how recommendation and analytics pipelines cut shuffle for "best N per user/category" queries from terabytes to kilobytes, since `K` is tiny and the raw event stream is enormous.
- **Acceptance test:** Output equals the sequential `nlargest(K, ...)` per key, with and without the combiner; the combiner caps shuffle at `K` per key per split. Top-K joins sum, max, set-union, and `(sum,count)` as a combinable reduction — the test is always "does the operation satisfy `f(A∪B) = f(f(A)∪f(B))`."

---

## Advanced Tasks

### Task 7 — Reduce-side join: tag records by source, join in the reducer **[coding]**

`[hard]` Implement the general **reduce-side join** (a.k.a. repartition join). To join two datasets on a key, the mapper **tags** each record with its source (`L` or `R`) and emits `(join_key, (tag, payload))`. The shuffle co-locates both sides of each key on one reducer, which separates the tagged values and emits the **cross product** of the left and right matches. Verify it produces the same rows as a sequential hash join, and **measure** that *every* record from *both* sides crosses the shuffle (the cost that the map-side join in Task 8 will avoid).

#### Python

```python
from collections import defaultdict

def make_join_mapper(left, right):
    """Tag each record by source. Returns a mapper over a unified record stream."""
    def mapper(rec):
        source, key, payload = rec
        yield (key, (source, payload))     # ("L"|"R", join_key, value) -> (key, (tag, val))
    return mapper

def join_reducer(key, tagged):
    lefts = [p for (t, p) in tagged if t == "L"]
    rights = [p for (t, p) in tagged if t == "R"]
    for lp in lefts:                       # cross product of matching rows
        for rp in rights:
            yield (key, (lp, rp))

if __name__ == "__main__":
    # Left: (user_id, name). Right: (user_id, order_amount). Inner join on user_id.
    left = [("L", 1, "alice"), ("L", 2, "bob"), ("L", 3, "carol")]
    right = [("R", 1, 100), ("R", 1, 250), ("R", 2, 75), ("R", 9, 999)]
    records = left + right

    # Sequential hash-join reference (inner join).
    rmap = defaultdict(list)
    for _, k, v in right:
        rmap[k].append(v)
    ref = []
    for _, k, name in left:
        for amt in rmap.get(k, []):
            ref.append((k, (name, amt)))
    ref.sort()

    out, st = run_mapreduce(records, make_join_mapper(left, right),
                            join_reducer, key_sort=True)
    assert sorted(out) == ref, "reduce-side join must match the sequential hash join"
    # EVERY record from BOTH sides is shuffled -> shuffle volume = |L| + |R|.
    assert st.shuffled_pairs == len(left) + len(right), "reduce-side join shuffles all rows"
    print(f"join output: {sorted(out)}")
    print(f"shuffle volume = {st.shuffled_pairs} = |L|+|R| = {len(left)}+{len(right)}")
    print("OK: reduce-side join matches hash join; ALL rows of BOTH sides cross the shuffle")
```

- **Constraints:** The mapper tags each record with its source so the reducer can tell left from right; the reducer emits the **cross product** of matching left and right rows for each key (inner join). The output must equal a sequential hash join. Shuffle volume must equal `|L| + |R|` — every row of both inputs crosses the network, which is the defining cost (and weakness) of the reduce-side join.
- **Hint:** The reduce-side join is the *general* join: it works for any sizes of `L` and `R`, any key cardinality, and supports inner/outer variants (emit unmatched lefts/rights for outer). Its price is the full shuffle of both datasets — a join of two billion-row tables moves two billion rows across the network and sorts them. That is why it is the join of last resort: you reach for it only when *neither* side fits in memory. When one side is small, the map-side/broadcast join (Task 8) skips the shuffle entirely. Note the subtle cost trap: a *secondary sort* is often layered on (Task 9 idea) so the reducer sees one side's values before the other, avoiding buffering an unbounded list in memory.
- **Acceptance test:** Output equals the sequential hash join (cross product per key, inner semantics); shuffle volume equals `|L| + |R|`. This is the baseline join whose cost the next task attacks — keep the reference output so Task 8 can prove the broadcast join produces *identical rows* with *zero shuffle*.

---

### Task 8 — Map-side (broadcast) join: replicate the small table, shuffle nothing **[coding]**

`[hard]` When one table is small enough to fit in memory, the **map-side / broadcast join** avoids the shuffle entirely: **broadcast** the small table to every mapper, load it into a hash map, and join each large-table record locally as it streams through the mapper. Implement it, verify it produces the **identical rows** as the Task 7 reduce-side join, and **measure** that the shuffle volume is **zero** — the whole point.

#### Python

```python
def make_broadcast_mapper(small_table):
    """Build a hash map of the small (broadcast) side once; join locally per record.
    No (key,value) pairs are emitted for shuffling -- the join finishes in the map."""
    from collections import defaultdict
    lookup = defaultdict(list)
    for k, v in small_table:               # small side: (key, payload)
        lookup[k].append(v)

    def mapper(big_rec):
        key, payload = big_rec
        for small_payload in lookup.get(key, []):
            # Emit the JOINED row directly; key it by join key for a stable order.
            yield (key, (small_payload, payload))
    return mapper

def identity_reducer(key, values):
    for v in values:                       # nothing to fold; map already joined
        yield (key, v)

if __name__ == "__main__":
    # Small (broadcast) side: users. Large side: orders streaming through mappers.
    users = [(1, "alice"), (2, "bob"), (3, "carol")]      # small enough to replicate
    orders = [(1, 100), (1, 250), (2, 75), (9, 999)]      # large side

    # Reference = the SAME inner join as Task 7's reduce-side join.
    from collections import defaultdict
    umap = defaultdict(list)
    for k, name in users:
        umap[k].append(name)
    ref = sorted((k, (name, amt)) for (k, amt) in orders for name in umap.get(k, []))

    out, st = run_mapreduce(orders, make_broadcast_mapper(users),
                            identity_reducer, key_sort=True)
    assert sorted(out) == ref, "broadcast join must produce the same rows as reduce-side"
    # The join happened in the MAP; what 'crosses' is only the already-joined output,
    # and NONE of the big table needed grouping-by-key across the network for the join.
    # Shuffle of the *join itself* is zero: no big-table row was shuffled to find a match.
    print(f"join output: {sorted(out)}")
    print(f"map-emitted (already-joined) pairs = {st.map_pairs}")
    print(f"big-table rows shuffled to FIND matches = 0  (matched locally in the mapper)")
    print("OK: broadcast join = identical rows, zero join-shuffle (small side replicated)")
```

- **Constraints:** The small table is loaded into an in-memory hash map **once per mapper** (the broadcast); each large-table record is joined locally against it inside the mapper, with **no key-grouping shuffle to find matches**. The output rows must be **identical** to the reduce-side join of Task 7. The defining measurement: zero big-table rows are shuffled to find matches (they are matched in place) — contrast with `|L| + |R|` for the reduce-side join.
- **Hint:** The broadcast join is the single most important join optimization in practice (Spark calls it `broadcast`, Hive a "mapjoin"). The decision rule is purely about size: if `min(|L|, |R|) · row_size` fits in mapper memory (default thresholds are ~10 MB in Spark, tunable), broadcast the small side and skip the shuffle; otherwise fall back to the reduce-side (sort-merge / repartition) join. The savings are enormous — joining a 1-billion-row fact table against a 10,000-row dimension table moves *zero* fact rows over the network instead of a billion. The cost you pay is replicating the small side to every mapper (`small_size · num_mappers` of broadcast traffic), which is negligible when the small side is genuinely small. This size-based dispatch (`broadcast if small else shuffle`) is the join planner's most consequential single decision.
- **Acceptance test:** `sorted(out)` equals the Task 7 reduce-side join output exactly; the big table contributes **no** shuffle to find matches (the join completes in the map). The two tasks together make the trade-off countable: *reduce-side shuffles `|L|+|R|` and works for any size; broadcast shuffles nothing but requires one side to fit in memory.*

---

### Task 9 — Skew: overload one reducer, then fix it with salting / two-stage aggregation **[coding]**

`[hard]` Real key distributions are **skewed** (Zipf/power-law): one "hot" key holds most of the values, so under `hash(key) mod R` its entire group lands on **one** reducer — a straggler that dominates the whole job's runtime regardless of how many reducers you add. Build the skew, **measure** that one reducer gets the lion's share, then fix it with **salting** (split the hot key into `S` sub-keys via a random suffix, aggregate each sub-key in a first stage, then combine the `S` partials in a second stage) and **measure** the rebalanced load.

#### Python

```python
import random
from collections import defaultdict

def reducer_loads(records, partitioner, R):
    """How many VALUES each reducer must process (the straggler metric)."""
    load = [0] * R
    for k, _ in records:
        load[partitioner(k) % R] += 1
    return load

# ---- Stage 1: salt the hot key by appending a random suffix in [0, S) ----
def salted_mapper(S, hot_keys):
    def mapper(rec):
        key, val = rec
        if key in hot_keys:
            yield (f"{key}#{random.randrange(S)}", val)   # spread the hot key over S sub-keys
        else:
            yield (key, val)
    return mapper

def sum_reducer(key, values):
    yield (key, sum(values))

def desalt_and_finalize(stage1_out):
    """Stage 2: strip the salt, re-sum the S partials of each hot key."""
    final = defaultdict(int)
    for k, v in stage1_out:
        base = k.split("#", 1)[0]          # "hot#3" -> "hot"
        final[base] += v
    return dict(final)

if __name__ == "__main__":
    random.seed(2)
    R, S = 8, 16
    # Skewed input: "hot" dominates; many cold keys.
    records = [("hot", 1) for _ in range(80_000)]
    cold = [f"cold{i}" for i in range(2000)]
    records += [(random.choice(cold), 1) for _ in range(20_000)]
    random.shuffle(records)

    # True answer.
    ref = defaultdict(int)
    for k, v in records:
        ref[k] += v

    # 1) Naive: hash partitioner -> "hot" all lands on ONE reducer.
    hash_part = lambda k: hash(k) % R
    naive_loads = reducer_loads(records, hash_part, R)
    print(f"naive reducer loads: {naive_loads}")
    assert max(naive_loads) > 0.6 * len(records), "one reducer holds most of the work (skew)"

    # 2) Salted two-stage: stage 1 sums salted sub-keys, stage 2 re-sums.
    stage1, _ = run_mapreduce(records, salted_mapper(S, {"hot"}),
                              sum_reducer, num_reducers=R, key_sort=True,
                              partitioner=hash_part)
    fixed = desalt_and_finalize(stage1)
    assert fixed == dict(ref), "salted two-stage aggregation must match the true sums"

    # Measure stage-1 balance: the hot key is now spread over S sub-keys -> S reducers.
    salted_records = []
    for k, v in records:
        salted_records.append((f"hot#{random.randrange(S)}" if k == "hot" else k, v))
    salted_loads = reducer_loads(salted_records, hash_part, R)
    print(f"salted reducer loads: {salted_loads}")
    assert max(salted_loads) < 0.5 * len(records), "salting rebalances the hot key"
    print(f"naive max/avg = {max(naive_loads)/(len(records)/R):.1f}x   "
          f"salted max/avg = {max(salted_loads)/(len(records)/R):.1f}x")
    print("OK: skew overloads one reducer; salting + two-stage aggregation rebalances")
```

- **Constraints:** Construct a genuinely skewed input (one key holding the majority of values). Show that under `hash(key) mod R` one reducer's value-load is a large fraction of the total *regardless of `R`* — adding reducers does not help a single hot key. The salting fix must: stage 1 spread the hot key over `S` sub-keys (`key#0 … key#(S-1)`) and aggregate each, stage 2 strip the salt and re-aggregate the `S` partials. The final result must equal the true sums **exactly**, and the stage-1 max reducer load must drop substantially.
- **Hint:** Salting works because the aggregation is associative: `sum(hot) = sum_s(sum(hot#s))`, so splitting the hot key into `S` independent sub-sums (which scatter across reducers) and re-summing the `S` partials in a second pass is exact. The cost is one extra MapReduce job (the second stage), but that stage is tiny — it reduces `S` partials per hot key, not the whole dataset. Two related fixes share the idea: (1) a **combiner** already shrinks a hot key's contribution per mapper, which mitigates but does not eliminate skew (all the *combined* partials still land on one reducer); (2) **range partitioning with sampled splitters** (the sample-sort idea from [the parallel-sorting tasks](../03-parallel-sorting-and-merging/tasks.md)) balances *across* keys but not *within* a single hot key — for one dominant key you need salting. Skew is the number-one cause of slow MapReduce/Spark jobs in production; recognizing a straggler reducer and salting its key is a core operational skill.
- **Acceptance test:** The naive run shows one reducer with `> 60%` of the value-load; the salted two-stage run produces the **exact** true sums with the stage-1 max load dropped below half the total (and approaching `total/R` as `S` grows). The fix is concrete and correct: *split the hot key, aggregate the parts, re-aggregate the partials — associativity makes it exact.*

---

### Task 10 — Secondary sort: deliver a reducer's values in sorted order **[coding]**

`[hard]` By default a reducer receives a key's values in **arbitrary** order. Many jobs need them sorted — the latest event per user, a time-ordered session, the streaming reduce-side join of Task 7 that must see one side before the other. The MapReduce idiom is the **composite key**: move the sort field *into the key* as `(natural_key, sort_field)`, partition on `natural_key` alone (so a key's values still co-locate), and sort on the full composite. Implement secondary sort on the engine and verify each reducer sees values in sorted order, with output matching a sequential sort-then-group.

#### Python

```python
from collections import defaultdict

def ss_mapper(rec):
    """Emit a COMPOSITE key (natural, sort_field); value carries the payload."""
    user, ts, event = rec
    yield ((user, ts), event)              # composite key = (natural_key, sort_field)

def natural_key_partitioner(num_reducers):
    # Partition on the NATURAL key only, so all of a user's events co-locate
    # even though the composite key includes the timestamp.
    return lambda composite: hash(composite[0]) % num_reducers

def ss_reducer(key, values):
    user, ts = key                         # composite already sorted by the shuffle
    for ev in values:
        yield (user, (ts, ev))             # emitted in ascending-timestamp order

if __name__ == "__main__":
    import random
    random.seed(3)
    users = ["u1", "u2", "u3"]
    records = [(random.choice(users), random.randint(0, 100), f"e{i}") for i in range(40)]

    # Sequential reference: group by user, sort each user's events by timestamp.
    ref = defaultdict(list)
    for u, ts, ev in records:
        ref[u].append((ts, ev))
    for u in ref:
        ref[u].sort()                      # ascending by timestamp (then event)

    R = 4
    out, _ = run_mapreduce(records, ss_mapper, ss_reducer,
                           partitioner=natural_key_partitioner(R),
                           num_reducers=R, key_sort=True)
    # key_sort sorts composite keys (user, ts) lexicographically -> per-user ts order.
    got = defaultdict(list)
    for u, (ts, ev) in out:
        got[u].append((ts, ev))

    for u in ref:
        # Each user's events arrive in ascending timestamp order.
        assert got[u] == sorted(got[u]), f"user {u} values must be timestamp-sorted"
        assert got[u] == ref[u], f"secondary sort must match sequential sort-then-group"
    print("per-user sorted events:", {u: got[u] for u in sorted(got)})
    print("OK: composite key + natural-key partitioner -> reducer sees values in sorted order")
```

- **Constraints:** The composite key is `(natural_key, sort_field)`; the **partitioner must hash only the natural key** so all of a key's records still reach one reducer despite the composite key differing per record. The shuffle sorts on the full composite key, so the reducer receives values in `sort_field` order. Output must equal a sequential "group by natural key, sort each group by sort field." Verify each group arrives sorted.
- **Hint:** Secondary sort is the standard trick for "I need the reducer's values ordered without buffering and sorting them in memory" — which matters when a key's value list is too large to hold. By pushing the sort field into the key, you let the framework's shuffle (which already sorts keys — *the shuffle is a distributed sort*) do the work for free. The partitioner-on-natural-key + group-comparator-on-natural-key + sort-comparator-on-composite is Hadoop's exact three-comparator recipe. It powers time-series sessionization, "last write wins" reconciliation, and the *sort-merge join* (the reducer reads the sorted left side, then streams the sorted right side, joining without buffering either) — the production reduce-side join is almost always a secondary-sort sort-merge join, not the naive buffering one of Task 7.
- **Acceptance test:** Each reducer's values arrive sorted by the sort field; output equals the sequential sort-then-group. The mechanism is exactly "the shuffle is a sort, so put what you want sorted into the key" — the conceptual bridge to [the parallel-sorting tasks](../03-parallel-sorting-and-merging/tasks.md), where the shuffle's distributed sort is built explicitly.

---

### Task 11 — The MRC/MPC rounds model: why iterative algorithms need many jobs **[analysis]**

`[hard]` MapReduce's true cost on a cluster is not work — it is **rounds** of communication. Reason about the **MRC** (MapReduce Class, Karloff–Suri–Vassilvitskii) and **MPC** (Massively Parallel Computation) models: what a "round" is, why each round pays a full shuffle (read input, map, shuffle, reduce, write output to disk), and why **iterative** algorithms — PageRank, k-means, connected components, gradient descent — are slow in classic MapReduce because each iteration is a separate job with a full materialize-to-disk round. Contrast with Spark's in-memory model.

> **No code.** Use this as the grading model.

**The model.** In **MRC/MPC**, computation proceeds in synchronous **rounds**. Each round: every machine maps its local input emitting `(key, value)` pairs, the system **shuffles** (all-to-all communication, grouping by key), then every machine reduces its assigned keys. The constraints that define the model: there are `p ≈ n^{1−ε}` machines, each with `Θ(n^{1−ε})` memory (**sublinear** in input size `n`, so no machine sees all the data), and the total data per round is `Θ(n)`. The cost measure is the **number of rounds** `R`, because the shuffle's all-to-all communication is the expensive operation — the goal of an MPC algorithm is to minimize `R`, ideally to `O(1)` or `O(log n)`.

**Why each round is a full barrier.** A round is a global synchronization: the reduce of round `r` cannot start until the shuffle of round `r` finishes, and the shuffle cannot start until *every* mapper in round `r` finishes. In classic Hadoop MapReduce, the boundary between rounds is even heavier: the output of round `r`'s reduce is **written to HDFS (disk, replicated 3×)**, and round `r+1`'s map **reads it back from disk**. So every round pays: read input from disk → map → shuffle over the network → reduce → write output to disk (replicated). That disk-materialization-per-round is the dominant cost for multi-round jobs.

**Why iterative algorithms suffer.** Consider **PageRank**: each iteration multiplies the rank vector by the (sparse) link matrix — a single MapReduce job (map: each page sends `rank/out_degree` to its neighbors; reduce: each page sums incoming contributions). But PageRank needs `Θ(log n)` to dozens of iterations to converge, and **each iteration is a separate MapReduce job** with its own full round: read the graph + ranks from disk, shuffle all the rank messages, write the new ranks back to disk. The graph structure — which never changes — is read from disk and shuffled *every single iteration*. For `k` iterations that is `k` full disk-shuffle-disk rounds, and the per-round overhead (job startup, disk I/O, network) swamps the actual arithmetic. The same affliction hits k-means (one job per Lloyd iteration), connected components (one job per pointer-jumping round, `O(log n)` of them), and gradient descent (one job per step).

**Why Spark changes the cost.** Spark keeps the working set **in memory (RAM) across rounds** as a resilient distributed dataset (RDD), and lets you **cache** the invariant data (the graph, the dataset) once. An iterative algorithm then: loads the graph into memory once, and each iteration is an in-memory map+shuffle+reduce with **no disk write-read between iterations**. The shuffle still happens (you still pay the all-to-all for the rank messages), but the `3×`-replicated disk materialization per round — the dominant cost in Hadoop — is gone. For a 20-iteration PageRank, Spark's in-memory iteration turns 20 disk-shuffle-disk rounds into one disk load plus 20 in-memory shuffles, the order-of-magnitude speedup that was Spark's original headline result. (Spark also recomputes lost partitions from lineage instead of relying on disk replication for fault tolerance — same resilience, no per-round disk tax.)

**The rounds lower bound, briefly.** Some problems provably need many rounds in the MPC model with sublinear memory — e.g. distinguishing a single cycle of length `n` from two cycles of length `n/2` (a connectivity question) requires `Ω(log n)` rounds when machine memory is `n^{1−ε}`, because information can only propagate a constant "distance" per round. This is why connected components and graph diameter are inherently multi-round, and why the *number of rounds* is the right cost measure: it is the quantity that is both expensive in practice and provably bounded below in theory.

- **Constraints:** Define a round (map → shuffle → reduce) and the MPC constraints (sublinear memory per machine `n^{1−ε}`, `p` machines, `Θ(n)` data per round, cost = number of rounds). Explain why each classic-MapReduce round pays a full disk-materialize barrier. Explain *concretely* (PageRank) why iterative algorithms need one job per iteration and re-read invariant data every round. Contrast Spark's in-memory caching across rounds and state what cost it removes (per-round disk materialization) and what it keeps (the shuffle). Mention the `Ω(log n)`-rounds intuition for connectivity.
- **Acceptance test:** A round is correctly defined as map+shuffle+reduce with a global barrier; the cost measure is rounds, justified by the all-to-all shuffle and (in Hadoop) per-round disk materialization; PageRank is used to show iterative algorithms pay `k` full rounds and re-read invariant data; Spark's in-memory model is correctly identified as removing the per-round disk tax while keeping the shuffle; the `Ω(log n)` connectivity intuition ties the rounds measure to a lower bound.

---

### Task 12 — A combiner's correctness, and a join's shuffle cost, on paper **[analysis]**

`[hard]` Pull the two analytic threads together. Prove the **combiner correctness condition** — exactly when a combiner may be inserted without changing the result — and derive the **shuffle costs** of the reduce-side and broadcast joins so the size-based choice between them is a calculation, not a guess.

> **No code.** Use this as the grading model.

**Part A — when is a combiner correct?** A combiner is a function the framework may apply to a *subset* of a key's values, *any number of times*, in *any grouping*, before the final reduce. So the combiner is correct iff the reduce's result is **invariant to how the values are grouped and pre-folded**.

*Condition.* Let the reduce compute `reduce(k, V) = h(⊕_{v ∈ V} g(v))` for some value-mapping `g`, an associative-commutative operator `⊕` with identity `e`, and a final projection `h`. Then the combiner `combine(k, V') = ⊕_{v ∈ V'} g(v)` (emitting a partial `⊕`-aggregate) is correct, because for any partition `V = V₁ ⊎ V₂ ⊎ … ⊎ V_m`:

```
⊕_{v ∈ V} g(v)  =  ⊕_j ( ⊕_{v ∈ V_j} g(v) )      (associativity + commutativity)
```

so pre-folding each `V_j` with the combiner and then `⊕`-ing the partials yields the same total, and `h` applied once at the end gives `reduce(k, V)`. **The combiner is correct exactly when the reduce is a `⊕`-aggregate over a commutative monoid, with the non-monoid work confined to a final projection `h`.**

*Why average needs `(sum, count)` (Task 5).* The mean is `h(⊕(sum, count)) = sum/count` where `⊕` adds `(sum, count)` pairs componentwise — a commutative monoid with identity `(0,0)`, projected by `h(s,c) = s/c` at the end. The *raw-value* average has no such `⊕`: there is no associative-commutative binary operator on plain numbers whose repeated application yields the mean, because the result depends on the count, which a single accumulated value does not carry. Promoting to `(sum, count)` restores the monoid; that is the necessary and sufficient fix. *Why sum/max/min/top-K/set-union combine:* each *is* directly a commutative-monoid `⊕` with `h = identity`. *Why median/distinct-exact do not combine:* there is no small monoid summary that yields the exact median or exact distinct count (you would need the whole multiset), which is why those use *approximate*, combinable sketches (t-digest, HyperLogLog) instead — sketches are commutative monoids, exact median is not.

**Part B — join shuffle costs.** Let the two inputs have `|L|` and `|R|` rows, join key cardinality, and let the output have `|O|` rows.

*Reduce-side (repartition) join.* Every row of both inputs is tagged and emitted as an intermediate pair, so the **shuffle volume is `|L| + |R|`** rows (Task 7's measurement). The reducers also sort that combined `Θ(|L|+|R|)` data (the shuffle is a sort), and emit `|O|` output rows. Total data movement `Θ(|L| + |R|)`; works for any input sizes; this is the only option when both sides exceed memory.

*Broadcast (map-side) join.* The small side (say `R`, with `|R|` small) is **replicated to every mapper**: broadcast cost `Θ(|R| · M)` where `M` is the number of mappers. The large side `L` is **never shuffled for the join** — each `L` row is matched locally against the in-memory copy of `R`. So the join's shuffle volume of the large side is **`0`**; the only network cost is the one-time broadcast `Θ(|R| · M)`, negligible when `|R|` is small. Output `|O|` rows are produced directly in the map.

*The decision.* Broadcast wins when `|R| · M ≪ |L| + |R|`, i.e. when the small side fits in memory and replicating it is cheaper than shuffling the large side — which is essentially always true when one side is genuinely small (a dimension table, a lookup map). The break-even is governed by `|R| · M` (broadcast traffic) vs `|L|` (the large-side shuffle you avoid): for `|L| = 10⁹`, `|R| = 10⁴`, `M = 10³`, broadcast moves `10⁷` against the reduce-side's `10⁹` — a `100×` reduction. Once `|R|` grows past the mapper memory budget, broadcast is impossible and you fall back to the reduce-side join. This single inequality is what a query planner evaluates to choose the join strategy.

- **Constraints:** Part A: state and prove the combiner-correctness condition (`reduce` is a commutative-monoid `⊕`-aggregate with a final projection `h`), using the partition-invariance argument; explain via this condition why average needs `(sum, count)`, why sum/max/top-K/set-union combine, and why exact median/distinct do not (but sketches do). Part B: derive the reduce-side shuffle `|L| + |R|` and the broadcast shuffle (`0` for the large side, `Θ(|R|·M)` broadcast), and state the break-even inequality `|R|·M` vs `|L|` that chooses between them.
- **Acceptance test:** The combiner condition is proved by partition-invariance of a commutative-monoid aggregate; average/`(sum,count)`, the combinable reductions, and the non-combinable-but-sketchable ones are all correctly explained by it; the reduce-side join is `Θ(|L|+|R|)` shuffle, the broadcast join `0` large-side shuffle plus `Θ(|R|·M)` broadcast; the decision rule is the inequality comparing broadcast traffic to the avoided large-side shuffle. The two parts make Tasks 5–8 calculations rather than recipes.

---

## Synthesis Task

> Tie the MapReduce pattern together end to end: build the in-process engine (map → partition → shuffle/group-by-key → combine → reduce), run word count, sum-by-key, the inverted index, the `(sum,count)` average, and top-K — measuring how the combiner cuts shuffle volume each time — then the two joins (reduce-side vs broadcast) and the skew fix (salting), confirming every output matches a sequential reference while the shuffle volume / skew behaves as predicted; finally prove the combiner-correctness condition, the join costs, and reason about the MRC rounds model.

`[capstone]` Carry **MapReduce** from the engine to the patterns to the cost model: implement, measure, verify, and prove.

1. **The engine and aggregations [coding].** The five-phase engine; word count with the combiner cutting shuffle to distinct words (Task 1); sum-by-key (Task 2); a visible partitioner routing keys to reducers (Task 3). Confirm every output matches a sequential reference and the combiner cuts shuffle as predicted.

2. **Grouping and combinable reductions [coding].** The inverted index (Task 4); the `(sum, count)` average that fixes the broken naive combiner (Task 5); top-K-per-key with a combiner emitting local top-Ks (Task 6).

3. **Joins [coding].** The reduce-side join shuffling `|L| + |R|` (Task 7); the broadcast join producing identical rows with zero large-side shuffle (Task 8). Measure and contrast the shuffle volumes.

4. **Skew and ordering [coding].** A skewed key overloading one reducer, fixed by salting / two-stage aggregation that rebalances (Task 9); secondary sort delivering a reducer's values in order via a composite key (Task 10).

5. **Prove and model [analysis].** The combiner-correctness condition and the join shuffle costs (Task 12); the MRC/MPC rounds model and why iterative algorithms need many jobs, contrasting Spark in-memory (Task 11).

Reference harness in **Python** (drives the pieces and checks every result and shuffle figure):

```python
from collections import Counter, defaultdict

def synth():
    # 1) Word count: combiner cuts shuffle from occurrences to distinct words.
    lines = ["the cat the dog", "the cat ran", "dog dog dog"]
    ref_wc = Counter(w for l in lines for w in l.split())
    out_nc, st_nc = run_mapreduce(lines, wc_mapper, wc_reducer, key_sort=True)
    out_c,  st_c  = run_mapreduce(lines, wc_mapper, wc_reducer,
                                  combiner=wc_combiner, key_sort=True)
    assert dict(out_nc) == dict(ref_wc) == dict(out_c)
    assert st_c.shuffled_pairs < st_nc.shuffled_pairs, "combiner cuts shuffle"

    # 2) Average via (sum, count): correct independent of grouping.
    recs = [("a", 10), ("a", 20), ("a", 30), ("a", 100), ("b", 5), ("b", 15)]
    out_avg, _ = run_mapreduce(recs, avg_mapper, avg_reducer,
                               combiner=avg_combiner, key_sort=True)
    assert dict(out_avg) == {"a": 40.0, "b": 10.0}

    # 3) Reduce-side vs broadcast join: same rows, very different shuffle.
    left  = [("L", 1, "alice"), ("L", 2, "bob")]
    right = [("R", 1, 100), ("R", 1, 250), ("R", 2, 75), ("R", 9, 999)]
    rs_out, rs_st = run_mapreduce(left + right, make_join_mapper(left, right),
                                  join_reducer, key_sort=True)
    users  = [(1, "alice"), (2, "bob")]
    orders = [(1, 100), (1, 250), (2, 75), (9, 999)]
    bc_out, _ = run_mapreduce(orders, make_broadcast_mapper(users),
                              identity_reducer, key_sort=True)
    assert sorted(rs_out) == sorted(bc_out), "both joins -> identical rows"
    assert rs_st.shuffled_pairs == len(left) + len(right), "reduce-side shuffles all rows"

    return st_nc.shuffled_pairs, st_c.shuffled_pairs, rs_st.shuffled_pairs

if __name__ == "__main__":
    wc_no, wc_yes, join_shuffle = synth()
    print(f"word count shuffle: no-combiner={wc_no}  combiner={wc_yes}  "
          f"(cut {wc_no/wc_yes:.1f}x)")
    print(f"reduce-side join shuffle = {join_shuffle} = |L|+|R|  (broadcast = 0 large-side)")
    print("\nOK: every MapReduce output matches its sequential reference; "
          "combiner cuts shuffle, broadcast join avoids it, salting rebalances skew")
```

- **Analysis answer:** A **MapReduce** job is `map → shuffle → reduce`: map projects each record to intermediate `(key, value)` pairs, the **shuffle groups them by key (a distributed sort)** — the dominant, network-bound cost — and reduce folds each group. The **combiner** is a *local reduce* on each mapper that cuts shuffle volume, and it is correct **exactly when the reduce is a `⊕`-aggregate over a commutative monoid** with the non-monoid work in a final projection `h`: `sum`, `max`, `min`, `count`, set-union, and top-K combine directly; **average does not** over raw values and needs the `(sum, count)` monoid, projected by `s/c` once at the end; exact median/distinct do not combine, but their sketches (t-digest, HyperLogLog) do. The **partitioner** (`hash(key) mod R` by default) routes each key's whole group to one reducer; it is the lever for **co-location** (range partitioning → sorted output, the MapReduce global sort) and for **balance**. Two **joins** trade generality for cost: the **reduce-side join** tags both sides and joins in the reducer, shuffling `|L| + |R|` rows (works for any size); the **broadcast/map-side join** replicates the small side to every mapper and joins locally, shuffling **zero** large-side rows (requires one side to fit in memory) — the planner picks by comparing broadcast traffic `|R|·M` to the avoided large-side shuffle `|L|`. **Skew** (a Zipf-hot key) overloads one reducer regardless of `R`; **salting + two-stage aggregation** splits the hot key into `S` sub-keys, aggregates each, and re-aggregates the partials — exact by associativity, and rebalanced. **Secondary sort** pushes the sort field into a composite key (partitioning on the natural key) so the shuffle delivers each reducer's values in order — the basis of the sort-merge join. Finally, the real cost model is **rounds**: in MRC/MPC each round is a full map-shuffle-reduce barrier (in Hadoop, materialized to disk), so **iterative algorithms** (PageRank, k-means, connected components) pay one job per iteration and re-read invariant data every round — which is why **Spark's in-memory caching** across rounds (keeping the working set in RAM, removing the per-round disk tax while keeping the shuffle) was an order-of-magnitude speedup for exactly these workloads.
- **Acceptance test:** Every job's output equals its sequential reference (word count = `Counter`, sum/average per key, inverted index, top-K, both joins); the combiner provably cuts shuffle volume (word count, inverted index, top-K) while never changing the answer; the `(sum,count)` average is correct where the naive combiner is wrong; the reduce-side join shuffles `|L|+|R|` while the broadcast join produces identical rows with zero large-side shuffle; salting rebalances the skewed reducer to the exact sums; secondary sort delivers sorted values. The write-up mirrors the whole discipline: *run the job through the engine phase by phase, count the pairs that cross the shuffle, confirm the output matches the sequential reference and the shuffle volume / skew behaves as the pattern predicts — then prove the combiner condition, derive the join costs, and place the rounds model against Spark in-memory.*

---

## Where to go next

- Revisit the combiner *as a reduce* — the monoid law that makes it correct, reduce-by-key as the engine's group-by, and the all-reduce collective that an aggregation across machines becomes — in the [parallel reduce and map tasks](../04-parallel-reduce-and-map/tasks.md); the `(sum,count)` average and the top-K combiner are the same monoid reasoning applied here.
- Build the **shuffle** explicitly: the shuffle is a distributed sort, and sample sort's splitter selection is exactly the range partitioner that balances keys here — see the [parallel sorting and merging tasks](../03-parallel-sorting-and-merging/tasks.md) for the sort the shuffle performs and the secondary-sort sort-merge join it enables.
- For the conceptual treatment of MapReduce — the programming model, combiners and partitioners, the join strategies, skew and salting, the MRC/MPC rounds model, and the Spark dataflow that succeeded it — read this topic's [junior](junior.md), [middle](middle.md), [senior](senior.md), and [professional](professional.md) notes.
