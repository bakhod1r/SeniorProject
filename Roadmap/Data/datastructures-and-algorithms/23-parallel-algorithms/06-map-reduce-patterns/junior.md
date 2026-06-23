# MapReduce Patterns — Junior Level

> **Audience:** You've met the two data-parallel primitives — **map** (transform every element independently) and **reduce** (combine everything associatively) — and the *map-then-reduce* pattern from [the previous topic](../04-parallel-reduce-and-map/junior.md). Now you'll see that *same idea* scaled from a handful of cores to **thousands of machines**, with one new ingredient bolted into the middle: a **shuffle** that groups data by key. That's the **MapReduce framework**, and the patterns that fit it.
> **Read time:** ~45 minutes. **Focus:** "I write two little functions — `map` and `reduce` — and a framework runs them across a cluster, parallel, fault-tolerant, automatic. How does that work, why does it scale, and what shape of problem fits it?"

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [The MapReduce Model: You Write Two Functions](#the-mapreduce-model-you-write-two-functions)
5. [The Three Phases: Map, Shuffle, Reduce](#the-three-phases-map-shuffle-reduce)
6. [The Canonical Example: Word Count, Traced End to End](#the-canonical-example-word-count-traced-end-to-end)
7. [Why It Scales: Splits, Parallel Keys, and the Shuffle](#why-it-scales-splits-parallel-keys-and-the-shuffle)
8. [Fault Tolerance: Just Re-Run the Task](#fault-tolerance-just-re-run-the-task)
9. [The Shape of Many Problems Fits Map → Shuffle → Reduce](#the-shape-of-many-problems-fits-map--shuffle--reduce)
10. [More Patterns: Filter, Sum-by-Key, Inverted Index](#more-patterns-filter-sum-by-key-inverted-index)
11. [Relation to the Map/Reduce Primitives](#relation-to-the-mapreduce-primitives)
12. [Code: A Tiny In-Process MapReduce Engine](#code-a-tiny-in-process-mapreduce-engine)
13. [Code: Word Count on the Engine](#code-word-count-on-the-engine)
14. [Code: Sum-by-Key and Average-by-Key](#code-sum-by-key-and-average-by-key)
15. [Common Misconceptions](#common-misconceptions)
16. [Common Mistakes](#common-mistakes)
17. [Cheat Sheet](#cheat-sheet)
18. [Summary](#summary)
19. [Further Reading](#further-reading)

---

## Introduction

In the previous topic you learned the two bedrock data-parallel operations — **map** (do something to every element, independently) and **reduce** (combine all the elements into one, associatively) — and the *map-then-reduce* pattern that chains them: `reduce(⊕, map(f, data))`. That pattern was so good that it ran in `Θ(log n)` span and expressed an enormous fraction of all batch computation. But it lived on *one machine*: many cores, one shared memory, one array.

This topic is about what happens when the data no longer fits on one machine — when you have a *petabyte* of web pages, or a *month* of server logs, or *billions* of records — and you want to process it across a **cluster** of hundreds or thousands of computers. The breakthrough came in a 2004 Google paper by **Jeffrey Dean and Sanjay Ghemawat**, *"MapReduce: Simplified Data Processing on Large Clusters."* Their insight was beautiful and pragmatic: programmers kept writing the *same* distributed program over and over — read a mountain of data, transform each record, group the results, aggregate each group — and getting the *distribution* wrong every time (how to split the data, how to parallelize, what to do when machine #487 dies mid-job). So they built a **framework** that handles all the hard distributed-systems parts *once*, and asks the programmer for only **two small functions.**

Here is the whole deal. You write **`map(key, value)`**, which the framework applies to *every input record* in parallel — it emits a list of intermediate **`(key2, value2)`** pairs. Then the framework **shuffles**: it takes all those intermediate pairs from all the machines and *groups them by `key2`*, so every value that shares a key ends up together. Then you write **`reduce(key2, list-of-values)`**, which the framework applies *per group* in parallel — it folds the list of values for one key into the final output. **That's it.** You never write a line of networking, scheduling, retry, or data-movement code. The framework distributes the work, runs it on thousands of machines, moves the data where it needs to go, and — crucially — **survives machine failures by just re-running the failed task.** You think in `map` and `reduce`; the framework thinks in clusters.

The example everyone learns first — the *"hello world"* of distributed computing — is **word count**: given a huge pile of documents, count how many times each distinct word appears. With MapReduce it's almost trivially short. `map(document)` walks the words and emits `(word, 1)` for each one. The shuffle groups all those pairs by word, so every `1` for `"the"` lands in one list. `reduce(word, [1, 1, 1, …])` sums the list to produce `(word, count)`. Two tiny functions — emit-ones and sum — and the framework counts words across a thousand machines and a billion documents. We'll trace this example all the way through, every pair, every group, every sum.

Why does this scale so well? Because the **map phase is embarrassingly parallel** — the input is chopped into independent *splits*, and every machine maps its own split with no coordination — and the **reduce phase is parallel across keys** — each distinct `key2` can be reduced independently of every other key. The *only* coordination is the **shuffle** in the middle, a giant distributed *group-by* (a sort/partition by key). Map scales with the number of input splits; reduce scales with the number of distinct keys; and because each map task and each reduce task is independent and stateless, a failed task can simply be **re-run on another machine** — that's the entire fault-tolerance story, and it's why MapReduce can finish a job correctly even when machines die during it (and at cluster scale, machines *always* die during it).

This file builds the picture from the ground up, assuming only the single-machine map/reduce primitives. We'll lay out the **model** (the two functions), draw the **map → shuffle → reduce** pipeline as a diagram, trace **word count** end to end (documents → map pairs → shuffled groups → reduced counts), explain **why it scales** (splits, parallel keys, shuffle) and the **fault-tolerance** idea (re-run a task), and sketch **three more patterns** — filter, sum-by-key, and the inverted index that powers search. Then you'll build a small **in-process MapReduce engine** (a map step, a group-by-key shuffle, a reduce step) and run word count and a sum/average-by-key on it — so you can *see* the whole framework as about forty lines of code, stripped of the cluster.

---

## Prerequisites

- **Required:** The **map** and **reduce** primitives — `map(f, data)` transforms every element independently (embarrassingly parallel), `reduce(⊕, data)` combines all elements with an associative operator into one value. Both, and the *map-then-reduce* pattern, are set up in [Parallel Reduce and Map](../04-parallel-reduce-and-map/junior.md). This topic is that pattern scaled to a cluster, so it's the essential prerequisite.
- **Required:** **Associativity** — `(a ⊕ b) ⊕ c = a ⊕ (b ⊕ c)` — and why it lets you combine in any grouping. The reduce step relies on it for the same reason the single-machine tree reduce did. Covered in [Parallel Reduce and Map](../04-parallel-reduce-and-map/junior.md).
- **Required:** The **work–span** vocabulary — what it means for a phase to be "embarrassingly parallel" (no dependencies) versus "parallel across keys." From [Models of Parallel Computation: PRAM and Work–Span](../01-models-pram-work-span/junior.md).
- **Helpful:** Having seen a **group-by** / `GROUP BY` (in SQL, or `groupby` in Python/pandas). The shuffle *is* a distributed group-by; the connection lands faster if grouping is familiar.
- **Helpful:** A rough mental picture of a **cluster** — many separate computers connected by a network, each with its own disk and memory, no shared RAM. We keep the distributed details light and let a tiny in-process engine stand in for the cluster.

No specific framework (Hadoop, Spark) knowledge is needed — we build a miniature MapReduce ourselves so the *model* is what you take away.

---

## Glossary

| Term | Definition |
|------|-----------|
| **MapReduce** | A programming model (and the framework implementing it) for processing huge datasets on a cluster: you write `map` and `reduce`; the framework does the rest. |
| **Map function** | `map(key, value) → list of (key2, value2)`. Applied to *every* input record, independently and in parallel. Emits zero or more intermediate pairs. |
| **Reduce function** | `reduce(key2, [v1, v2, …]) → output`. Applied *per distinct key2*, independently and in parallel. Folds the list of values for one key. |
| **Intermediate pair** | A `(key2, value2)` emitted by `map`, before grouping. The bridge between the two functions. |
| **Shuffle** | The framework phase between map and reduce: it **groups all intermediate pairs by `key2`** (a distributed sort / group-by) so each reducer gets one key's full list. |
| **Input split** | A chunk of the input data assigned to one map task. The input is chopped into many splits so map runs in parallel. |
| **Map task / Reduce task** | One unit of work: a map task processes one split; a reduce task processes one (or several) key's grouped values. Each is independent and re-runnable. |
| **Embarrassingly parallel** | A phase whose pieces are fully independent (no coordination). The map phase is embarrassingly parallel over splits. |
| **Combiner** | An optional "mini-reduce" run *on the map side* to pre-aggregate before the shuffle, cutting network traffic (e.g. sum the `1`s locally first). Introduced here, detailed in [middle](./middle.md). |
| **Inverted index** | A map from each word to the list of documents containing it — the core data structure of a search engine, built with one MapReduce. |
| **Partition function** | Decides which reducer a given `key2` goes to (typically `hash(key2) mod R`). Determines the shuffle's destinations. |

---

## The MapReduce Model: You Write Two Functions

Strip away the cluster and the model is astonishingly small. To run a MapReduce job, **you provide exactly two functions**, and the framework supplies everything else.

The **map** function takes one input record — a `(key, value)` pair — and emits a list of **intermediate** `(key2, value2)` pairs:

```
  map(key, value)  →  list of (key2, value2)
```

It's called **once per input record**, and every call is **completely independent** of every other — `map` of document #7 knows nothing about document #6. That independence is exactly the property that made the single-machine `map` embarrassingly parallel, and it's why the framework can run `map` on thousands of records at once across the cluster. A `map` call can emit zero pairs (a filter), one pair (a transform), or many pairs (one per word in a document).

The **reduce** function takes an intermediate key and **the list of all values that were emitted for that key**, and produces the final output for that key:

```
  reduce(key2, [value2, value2, value2, ...])  →  output
```

It's called **once per distinct intermediate key**, and again every call is **independent** — `reduce("apple", …)` has nothing to do with `reduce("banana", …)`. So reduce parallelizes across keys: with a thousand distinct keys you could run a thousand reducers at once. The list handed to `reduce` is *every* value emitted for that key, *gathered from every map task across the whole cluster* — and gathering it is the framework's job, not yours.

```
  YOU WRITE:                         THE FRAMEWORK DOES:
  ─────────────                      ─────────────────────────────
  map(key, value)                    • split the input into chunks
    → emit (key2, value2)...         • run map on every chunk, in parallel, on many machines
                                     • SHUFFLE: group all emitted pairs by key2
  reduce(key2, [values])             • run reduce on every key's group, in parallel
    → emit output...                 • handle distribution, data movement, retries, failures
```

The genius is the **division of labor**. You express the *what* — the per-record transform and the per-key aggregation, two small pure functions with no notion of machines or networks. The framework owns the *how* — splitting, scheduling, parallelizing, moving terabytes of intermediate data across the network, and recovering from the machines that inevitably crash. You write maybe twenty lines; the framework's distributed runtime is tens of thousands. That's the trade that made distributed data processing accessible to ordinary programmers.

> **The mental model:** MapReduce is a **fill-in-the-blanks** template. The framework is a giant machine with two slots: "what do I do to each record?" (`map`) and "what do I do with all the values for one key?" (`reduce`). You fill the two slots with small functions; the machine runs them across a cluster. You think about *your data*; the framework thinks about *the cluster*.

---

## The Three Phases: Map, Shuffle, Reduce

Every MapReduce job is three phases in strict order. Two of them are *your* functions; the middle one is *all* the framework's magic.

```
  ┌─────────────┐     ┌─────────────────────┐     ┌──────────────┐
  │    MAP      │ →   │       SHUFFLE        │ →   │    REDUCE    │
  │  (your fn)  │     │   (the framework)    │     │  (your fn)   │
  └─────────────┘     └─────────────────────┘     └──────────────┘
  apply map to         GROUP all emitted          apply reduce to
  every input          (key2, value2) pairs        every key2's
  record, in           BY key2 — gather each       value-list, in
  parallel; emit       key's values together       parallel; emit
  (key2, value2)       (a distributed group-by)    the final output
```

**Phase 1 — Map.** The input is split into many chunks, and a *map task* runs on each chunk in parallel. Each task calls your `map(key, value)` on every record in its chunk and emits intermediate `(key2, value2)` pairs. Because the chunks are independent, this phase is **embarrassingly parallel** — pure spread-it-out, no coordination. The output is a big bag of intermediate pairs scattered across all the map machines.

**Phase 2 — Shuffle.** This is the phase the framework owns entirely, and the one that makes MapReduce *more* than a single-machine map-reduce. It takes the entire bag of intermediate pairs — from *every* map task on *every* machine — and **groups them by `key2`**, so that for each distinct key, *all* of its values (no matter which map task emitted them) end up collected into one list, on one machine, ready for one reducer. Concretely, each key is hashed to decide which reducer owns it (`partition = hash(key2) mod R`), the pairs are sent across the network to that reducer, and the reducer sorts/groups them by key. The shuffle is a **distributed group-by** (often implemented as a distributed sort). It is the heart of the framework, the most expensive phase (it moves data across the network), and the source of most of the engineering difficulty — which is exactly why you're glad the framework does it and not you.

**Phase 3 — Reduce.** Now every distinct key has its full list of values gathered. A *reduce task* runs your `reduce(key2, [values])` on each key's group, in parallel across keys, and emits the final output. Because the keys are independent, this phase is **parallel across keys**.

The strict ordering matters: **reduce cannot start until the shuffle has gathered a key's complete list**, because `reduce` needs *all* the values for its key (you can't sum the `1`s for `"the"` until you've collected every `1` from every document). So there's a barrier between map+shuffle and reduce. Within each phase, though, the parallelism is wide open.

> **The shape to memorize:** **map → shuffle → reduce.** Map transforms each record independently and tags the output with a key. Shuffle gathers everything sharing a key into one place. Reduce folds each key's gathered values. Map is the *transform*, reduce is the *aggregate*, and the shuffle is the *group-by* that connects them — and the shuffle is the one new piece that the single-machine map-reduce didn't have.

---

## The Canonical Example: Word Count, Traced End to End

Let's run the *"hello world"* of MapReduce — **counting how many times each word appears** across a set of documents — and trace every pair through all three phases. Say we have three tiny documents:

```
  doc1:  "the cat sat"
  doc2:  "the dog sat"
  doc3:  "the cat ran"
```

The two functions are almost embarrassingly short:

```
  map(docName, text):
      for each word in text:
          emit (word, 1)          # "I saw this word once"

  reduce(word, counts):
      emit (word, sum(counts))    # "add up all the ones"
```

**Phase 1 — Map.** Each document is mapped independently (in parallel — three map tasks, one per doc). Every word becomes a `(word, 1)` pair:

```
  map(doc1, "the cat sat")  →  (the,1) (cat,1) (sat,1)
  map(doc2, "the dog sat")  →  (the,1) (dog,1) (sat,1)
  map(doc3, "the cat ran")  →  (the,1) (cat,1) (ran,1)
```

So the bag of intermediate pairs, scattered across the three map tasks, is:

```
  (the,1) (cat,1) (sat,1)  (the,1) (dog,1) (sat,1)  (the,1) (cat,1) (ran,1)
```

**Phase 2 — Shuffle.** The framework groups every pair **by word**. All the `(the, 1)`s — from all three documents — gather into one list; all the `(cat, 1)`s into another; and so on:

```
  GROUPED BY KEY (the shuffle's output):
    the → [1, 1, 1]      ← one 1 from each of doc1, doc2, doc3
    cat → [1, 1]         ← from doc1 and doc3
    sat → [1, 1]         ← from doc1 and doc2
    dog → [1]            ← from doc2 only
    ran → [1]            ← from doc3 only
```

Notice what the shuffle did: the three `1`s for `"the"` came from three *different* map tasks (three different documents, possibly three different machines), and the framework reached across all of them to assemble `the → [1, 1, 1]`. *You* wrote no code to do that gathering — it's the shuffle.

**Phase 3 — Reduce.** Each word's list is reduced independently (in parallel — one reducer per word) by summing:

```
  reduce(the, [1, 1, 1])  →  (the, 3)
  reduce(cat, [1, 1])     →  (cat, 2)
  reduce(sat, [1, 1])     →  (sat, 2)
  reduce(dog, [1])        →  (dog, 1)
  reduce(ran, [1])        →  (ran, 1)
```

And the final output is the word counts:

```
  the: 3   cat: 2   sat: 2   dog: 1   ran: 1
```

Stack the whole pipeline into one picture and you can see the data flowing left to right:

```
  INPUT DOCS          MAP emits             SHUFFLE groups        REDUCE sums
  ──────────          ─────────             ──────────────        ───────────
  doc1: the cat sat   (the,1)(cat,1)(sat,1)
  doc2: the dog sat   (the,1)(dog,1)(sat,1) →  the → [1,1,1]   →   (the, 3)
  doc3: the cat ran   (the,1)(cat,1)(ran,1)    cat → [1,1]     →   (cat, 2)
                                               sat → [1,1]     →   (sat, 2)
                                               dog → [1]       →   (dog, 1)
                                               ran → [1]       →   (ran, 1)
```

That's the entire algorithm. The map said "emit a 1 for every word I see"; the shuffle gathered all the 1s for each word; the reduce summed them. **Two trivial functions** — and this *identical* pair of functions, unchanged, would count words across a billion documents on a thousand machines, because the framework handles the scaling. Word count is the canonical example precisely because it shows the whole `map → shuffle → reduce` skeleton with the simplest possible `map` (emit ones) and `reduce` (sum) — once you see it here, you see it everywhere.

> **Why word count is the "hello world":** it exposes all three phases with nothing to distract you. `map` emits one pair per occurrence (the *transform*); the shuffle does the heavy lifting of gathering by key (the *group-by* you didn't write); `reduce` sums (the *aggregate*). The pattern — *emit a (key, partial) per record, then aggregate per key* — is the template for counting, summing, averaging, indexing, and joining. Learn word count cold and you've learned the shape of half of all MapReduce jobs.

---

## Why It Scales: Splits, Parallel Keys, and the Shuffle

The reason MapReduce can run on thousands of machines comes straight from where the parallelism lives in each phase. Let's name it precisely.

**The map phase scales with the number of input splits.** The input — say a petabyte of documents — is chopped into many **splits**, each a manageable chunk (often ~64 MB, one block of the distributed file system). Every split is mapped *independently*: map task #5 doesn't read, wait for, or coordinate with map task #4. So this phase is **embarrassingly parallel** — exactly like the single-machine `map`, just spread over machines instead of cores. With a thousand splits and a thousand machines, all thousand map tasks run at once. More data simply means more splits, which means you can use more machines. The framework also tries to run each map task **on the machine that already stores its split** (*data locality*), so most data is read from local disk rather than dragged across the network — a key reason it scales.

**The reduce phase scales with the number of distinct keys.** After the shuffle, each distinct `key2` has its own gathered list, and `reduce(key2, …)` for one key is **independent** of `reduce` for every other key. So reduce is **parallel across keys** — with a million distinct keys you can keep many reducers busy, each chewing through a different subset of keys (the partition function `hash(key2) mod R` hands each key to one of `R` reducers).

**The only coordination is the shuffle.** Map needs no coordination; reduce needs no coordination *across* keys. The single point where data must move and synchronize is the **shuffle** in the middle — the distributed group-by that gathers each key's values onto its reducer. This is why the shuffle is the expensive, network-bound, carefully-engineered heart of the framework: it's the *one* place global coordination happens. Everything else is independent pieces.

```
  WHERE THE PARALLELISM LIVES:

  MAP        ████████████████████   embarrassingly parallel over SPLITS
             (1000 splits → 1000 map tasks at once, no coordination)
                       │
  SHUFFLE    ░░░░░░░░░░░░░░░░░░░░░   the ONLY coordination: group by key
             (data crosses the network — the expensive phase)
                       │
  REDUCE     ████████████████████   parallel across KEYS
             (1M keys → many reducers, each independent)
```

Put together: map scales with data volume (more splits), reduce scales with key cardinality (more distinct keys), and the shuffle is the lone bottleneck the framework optimizes hard. Because every map task and every reduce task is a small, independent, **stateless** unit of work, the scheduler can pack thousands of them onto whatever machines are free — and, as the next section shows, re-run any one that fails without disturbing the others. *Independence is what scales, and MapReduce manufactures independence at every step except the shuffle.*

> **The takeaway:** MapReduce scales because two of its three phases are *coordination-free*. Map is independent over input splits (embarrassingly parallel); reduce is independent over keys; and the shuffle — the one place data must be gathered and moved — is the framework's job to do efficiently. Throw more machines at more data and the map and reduce phases just spread wider. The shuffle is the price you pay for the group-by, and the framework pays it for you.

---

## Fault Tolerance: Just Re-Run the Task

At cluster scale, **machines fail constantly.** With a thousand commodity machines running a long job, it's not *if* one crashes — disks die, networks hiccup, processes get OOM-killed — it's *when*, and usually several times per job. A distributed framework that couldn't survive a single machine failure would be useless. MapReduce's answer is so simple it's almost anticlimactic: **if a task fails, just run it again.**

This works because of a property we've leaned on the whole way: **every map task and every reduce task is independent and re-runnable.** A map task reads its split (which lives on the durable distributed file system) and produces intermediate pairs — it depends on *nothing else*, so if the machine running it dies, the scheduler simply assigns that same split to a different machine and runs the map task again. The re-run produces the same pairs (the input is the same, the function is pure), and the job continues as if nothing happened. Same for a reduce task: its input is a key's gathered values; if a reducer dies, its keys are re-assigned and re-reduced elsewhere.

```
  Machine #487 dies while running map task on split 12:

   1. The framework notices (heartbeat stops / task times out).
   2. It re-schedules the SAME map task (split 12) onto a healthy machine.
   3. The re-run reads split 12 again, re-emits the same pairs.
   4. The job proceeds. Nothing else had to change.

   Because tasks are INDEPENDENT and re-runnable, a failure is local —
   it costs one task's worth of redo, not the whole job.
```

Two properties make this safe. First, the input data lives on a **replicated, durable file system** (so a dead machine doesn't take the data with it — the split still exists on other machines). Second, the tasks are **deterministic and side-effect-free** until they commit their output — re-running produces the same result, and the framework only "commits" a task's output once (so a slow task that gets re-run as a backup doesn't double-count). Together these mean a failure costs only the *redo of one task*, not a restart of the whole job — and that's the difference between a job that finishes on a flaky cluster and one that never does.

There's a bonus: the same re-run machinery handles **stragglers** (a machine that's alive but slow). Near the end of a job, the framework can launch *backup* copies of the last few in-progress tasks on other machines and take whichever finishes first — so one slow disk doesn't hold up the whole job. Re-running isn't just for crashes; it's a general tool for robustness.

> **The fault-tolerance idea in one line:** because map and reduce tasks are **independent, stateless, and deterministic**, a failed task is simply **re-run** — on another machine, from the durable input — and the rest of the job is unaffected. No checkpoints, no rollback, no global recovery: just redo the one piece that broke. This is *why* the same `map`/`reduce` you wrote for word count survives a cluster where machines die mid-job. The independence that gives MapReduce its parallelism gives it its fault tolerance for free.

---

## The Shape of Many Problems Fits Map → Shuffle → Reduce

Word count is one instance of a *much* broader shape. A huge fraction of data-processing problems have the form: **transform each record, then group and aggregate by some key.** Whenever a problem fits that sentence, it fits MapReduce — and learning to *hear* that sentence inside a problem is the core skill.

The recipe for fitting a problem to MapReduce is always the same two questions:

1. **What key should I group by?** (This decides what `map` *emits* — the `key2`.)
2. **What do I do with all the values for one key?** (This is `reduce`.)

Answer those two and you have a MapReduce job. Here's the shape recognized across a range of tasks:

```
  Problem                              map emits (key2, value2)        reduce does
  ──────────────────────────────────   ─────────────────────────────  ──────────────────
  Count words                          (word, 1)                       sum the 1s
  Total sales per region               (region, amount)                sum the amounts
  Average temperature per city         (city, temp)                    average the temps
  Max price per product                (product, price)                max of the prices
  Distinct visitors per page           (page, visitorID)               count distinct IDs
  Inverted index (search)              (word, docID)                   collect docIDs into a list
  Count log lines per status code      (statusCode, 1)                 sum the 1s
  Group orders by customer             (customerID, order)             collect / process orders
```

Look at the pattern: in every row, `map` **tags each record with the key you want to group by** and carries along a partial value; the shuffle gathers; `reduce` **aggregates the group** (sum, average, max, count, collect…). That's *counting*, *summarizing*, *grouping*, and *indexing* — the staples of analytics and data engineering — all wearing the same `map → shuffle → reduce` clothes.

Two slightly different shapes round out the repertoire:

- **Filtering** doesn't even need a reduce in spirit: `map(record)` emits the record *only if* it passes a predicate (and emits nothing otherwise). Since a `map` call can emit zero pairs, filtering is just "map that sometimes stays silent." (You'd often still group the survivors, but the filter itself lives entirely in `map`.)
- **Joining two datasets** on a shared key fits too: `map` tags each record from *both* datasets with the join key (emitting, say, `(userID, ("orders", order))` and `(userID, ("users", profile))`); the shuffle gathers both sides of each key together; and `reduce(userID, [both sides])` combines them — matching every order to its user. The shuffle's group-by *is* the join.

> **The shape to recognize:** *"transform each record, then group and aggregate by key."* If you can name the **grouping key** (what `map` emits) and the **per-group aggregation** (what `reduce` does), it's a MapReduce job — and the framework will run it across a cluster, in parallel, fault-tolerant. Counting, summing, averaging, filtering, indexing, joining, grouping: all the same skeleton. The art is spotting the key.

---

## More Patterns: Filter, Sum-by-Key, Inverted Index

Let's make three of those patterns concrete, because they show the *range* of `map`/`reduce` beyond just summing ones.

**Pattern 1 — Filter (map-only).** Suppose you want only the log lines that contain `"ERROR"`. The `map` emits the line if it matches and nothing if it doesn't:

```
  map(lineNum, line):
      if "ERROR" in line:
          emit (lineNum, line)     # keep it
      # else: emit nothing → the line is dropped

  (no reduce needed — or an identity reduce that just passes values through)
```

This is the distributed cousin of stream compaction / parallel filter — a `map` that *sometimes stays silent* drops records, and because each record decides independently, it's embarrassingly parallel over splits. The connection to single-machine parallel filter is direct (see [Parallel Prefix Sum / Scan](../02-parallel-prefix-sum-scan/junior.md), where filter becomes flags → scan → scatter).

**Pattern 2 — Sum-by-key (and average-by-key).** This is word count's big sibling: instead of summing ones, sum (or average) a real quantity per group. To total **sales per region**:

```
  map(saleID, sale):
      emit (sale.region, sale.amount)      # tag each sale with its region

  reduce(region, amounts):
      emit (region, sum(amounts))          # total per region
```

Swap `sum` for an average and you have *average temperature per city*. One subtlety: averaging needs a little care because **average is not associative** — you can't average the partial averages. The fix is to carry `(sum, count)` pairs and combine those: `reduce` sums all the sums and all the counts, then divides at the very end. (We'll code exactly this below.) This `(sum, count)` trick is the standard way to do associative averaging — keep the two associative quantities, divide last.

**Pattern 3 — Inverted index (the search-engine pattern).** This is the one Dean and Ghemawat highlight, because building an **inverted index** — a map from each word to *the list of documents that contain it* — is literally how a search engine indexes the web, and it's a textbook MapReduce. The `map` emits, for each word in a document, `(word, docID)`; the shuffle gathers all the docIDs per word; the `reduce` collects them into a (sorted, deduplicated) list:

```
  map(docID, text):
      for each distinct word in text:
          emit (word, docID)           # "this word appears in this doc"

  reduce(word, docIDs):
      emit (word, sorted(unique(docIDs)))   # the posting list for the word
```

Trace it on our three documents (`doc1: "the cat sat"`, `doc2: "the dog sat"`, `doc3: "the cat ran"`):

```
  map →   (the,doc1)(cat,doc1)(sat,doc1)  (the,doc2)(dog,doc2)(sat,doc2)  (the,doc3)(cat,doc3)(ran,doc3)

  shuffle (group by word):
    the → [doc1, doc2, doc3]
    cat → [doc1, doc3]
    sat → [doc1, doc2]
    dog → [doc2]
    ran → [doc3]

  reduce → the posting lists:
    the: doc1, doc2, doc3
    cat: doc1, doc3
    sat: doc1, doc2
    dog: doc2
    ran: doc3
```

The output — *for each word, which documents contain it* — is precisely what a search engine consults when you type a query: to find pages containing `"cat"`, it looks up `cat → [doc1, doc3]`. The *only* difference between this and word count is what `map` emits as the value (`docID` instead of `1`) and what `reduce` does (collect instead of sum). **Same skeleton, different blanks** — which is the whole lesson of MapReduce patterns.

> **The pattern family:** *filter* is a `map` that stays silent on non-matches; *sum/average-by-key* tags each record with a group key and aggregates the group (carry `(sum, count)` for associative averages); *inverted index* tags each word with its document and collects the documents per word — the heart of search. All three are the same `map → shuffle → reduce` skeleton with different blanks filled in. Once you internalize "what's the key, what's the per-group aggregation," writing a new MapReduce job is mostly filling in two functions.

---

## Relation to the Map/Reduce Primitives

It's worth pinning down *exactly* how the MapReduce framework relates to the [single-machine map/reduce primitives](../04-parallel-reduce-and-map/junior.md) you learned, because they share a name and a soul but differ in one crucial way.

**What's the same.** The two ideas are identical at heart: an **independent per-element transform** (map) followed by an **associative combine** (reduce). The framework's `map` is the primitive `map` — apply a function to every record, independently, embarrassingly parallel. The framework's `reduce` is the primitive `reduce` — fold a collection of values with an (ideally associative) operator. The *reason* both phases parallelize is the same reason from the primitives: map's independence and reduce's associativity. If you understood `reduce(⊕, map(f, data))` on one machine, you already understand the spirit of MapReduce.

**What's new: the key-based shuffle in the middle.** The single-machine map-reduce produced *one* result — `reduce(+, map(f, data))` collapses everything to a single value. The MapReduce framework produces *one result **per key***. That's the difference, and the **shuffle** is what creates it. The primitive map-reduce had nothing between map and reduce; the framework inserts a **group-by-key** step that *splits* the data into per-key groups, so reduce runs once *per key* rather than once over everything. In primitive terms, MapReduce is closer to **`reduceByKey`** (group, then reduce each group) than to a plain global `reduce` — and indeed `reduceByKey` is exactly the grouped-reduction primitive the [middle file on parallel reduce](../04-parallel-reduce-and-map/middle.md) discusses.

```
  SINGLE-MACHINE (the primitives):
     data ──map──► transformed ──reduce──► ONE result
              (no grouping in between)

  MAPREDUCE FRAMEWORK:
     data ──map──► (key,value) pairs ──SHUFFLE (group by key)──► reduce ──► ONE result PER KEY
              (the new piece: a distributed group-by between map and reduce)
```

**And: distributed scale.** The other difference is *where* it runs. The primitives ran on cores sharing one memory and one array. The framework runs on a **cluster** — separate machines, separate disks, no shared memory — which is *why* the shuffle has to physically move data across the network, and *why* fault tolerance (re-run a task) becomes essential. The single-machine version never worried about a core "dying" mid-reduce; the distributed version must.

So: **MapReduce = the map/reduce primitives + a key-based shuffle + distributed-scale fault tolerance.** The primitives are the idea; the framework is the idea grown up to handle a thousand machines and a key-grouped result. Everything you learned about *why* map and reduce parallelize still applies — the framework just adds the group-by that turns "one answer" into "one answer per key," and the machinery that keeps it running when hardware fails.

> **The relationship in one line:** the primitive `reduce(⊕, map(f, data))` gives **one** answer on **one** machine; the MapReduce framework adds a **shuffle** (group by key) to give **one answer per key** across **many** machines, with **re-run-on-failure** fault tolerance. Same map, same associative reduce, plus a distributed group-by in the middle. If you know the primitives, MapReduce is "the primitives, keyed and clustered."

---

## Code: A Tiny In-Process MapReduce Engine

The best way to *believe* the framework is to build a miniature one. Stripped of the cluster — the networking, scheduling, and fault tolerance — the *model* is about forty lines: a map step, a group-by-key shuffle, and a reduce step. We'll write a generic engine that takes your `map` and `reduce` functions and runs the three phases. Then any job (word count, sum-by-key, inverted index) is just *supplying the two functions*.

### Python: a generic MapReduce engine

```python
from collections import defaultdict

def map_reduce(inputs, map_fn, reduce_fn):
    """
    A tiny in-process MapReduce engine — the three phases, no cluster.

    inputs    : list of (key, value) input records
    map_fn    : (key, value) -> list of (key2, value2) intermediate pairs
    reduce_fn : (key2, [value2, ...]) -> output for that key

    Returns a dict {key2: reduce_output}.
    """
    # ---- PHASE 1: MAP ----------------------------------------------------
    # Apply map_fn to every input record, independently. On a cluster this
    # runs in parallel across machines; here it's a simple loop, but note
    # that NOTHING here depends on another record — it's embarrassingly parallel.
    intermediate = []
    for key, value in inputs:
        for pair in map_fn(key, value):   # map may emit 0, 1, or many pairs
            intermediate.append(pair)

    # ---- PHASE 2: SHUFFLE (group by key2) --------------------------------
    # Gather every value emitted for each key into one list. THIS is the
    # framework's signature step — the distributed group-by. We do it with a
    # dict; a real cluster does it by hashing keys to reducers + sorting.
    groups = defaultdict(list)
    for key2, value2 in intermediate:
        groups[key2].append(value2)

    # ---- PHASE 3: REDUCE -------------------------------------------------
    # Apply reduce_fn to each key's gathered values, independently. Parallel
    # across keys on a cluster; a loop over distinct keys here.
    results = {}
    for key2, values in groups.items():
        results[key2] = reduce_fn(key2, values)
    return results
```

That's the whole engine. Read it as the three phases we drew: build the intermediate bag (**map**), group it by key (**shuffle**), fold each group (**reduce**). The only "magic" — the shuffle — is a `defaultdict(list)` that gathers values per key; on a real cluster that one line becomes a network-spanning sort, but the *semantics* are exactly this `groups[key2].append(value2)`.

### Go: a generic MapReduce engine

```go
package main

import "fmt"

// Pair is an intermediate (key, value) emitted by map.
type Pair struct {
	Key   string
	Value int
}

// MapReduce runs the three phases over `inputs` using the supplied functions.
// mapFn:    (key, value) -> []Pair          (emit 0, 1, or many intermediate pairs)
// reduceFn: (key, []int) -> int             (fold one key's gathered values)
// Returns map[key]reducedValue.
func MapReduce(
	inputs []Pair,
	mapFn func(key string, value int) []Pair,
	reduceFn func(key string, values []int) int,
) map[string]int {

	// PHASE 1 — MAP: apply mapFn to every record, independently.
	var intermediate []Pair
	for _, in := range inputs {
		intermediate = append(intermediate, mapFn(in.Key, in.Value)...)
	}

	// PHASE 2 — SHUFFLE: group every value by its key (the framework's job).
	groups := make(map[string][]int)
	for _, p := range intermediate {
		groups[p.Key] = append(groups[p.Key], p.Value)
	}

	// PHASE 3 — REDUCE: fold each key's gathered values, independently per key.
	results := make(map[string]int)
	for key, values := range groups {
		results[key] = reduceFn(key, values)
	}
	return results
}

func main() {
	// A trivial demo; real jobs live in the sections below.
	inputs := []Pair{{"a", 1}, {"b", 1}, {"a", 1}}
	sum := func(key string, vs []int) int {
		t := 0
		for _, v := range vs {
			t += v
		}
		return t
	}
	identityMap := func(k string, v int) []Pair { return []Pair{{k, v}} }
	fmt.Println(MapReduce(inputs, identityMap, sum)) // map[a:2 b:1]
}
```

> **What the engine teaches.** The framework is *three loops*: emit pairs (map), bucket them by key (shuffle), fold each bucket (reduce). Everything that makes the real thing hard — running map on a thousand machines, moving terabytes across the network for the shuffle, re-running failed tasks — is *implementation* of these same three semantics. The model you've now coded is the contract; the cluster is the engineering. Note the shuffle is the one phase you didn't have to think about as a job author: you supply `map` and `reduce`, the engine supplies the group-by.

---

## Code: Word Count on the Engine

Now the payoff: word count is just *two small functions* handed to the engine above. The engine does the rest.

### Python: word count

```python
def word_count(documents):
    """Count word occurrences across documents using the MapReduce engine.
    `documents` is a list of (docName, text). Only the two functions are ours."""

    def map_fn(doc_name, text):
        # Emit (word, 1) for every word — the transform.
        return [(word, 1) for word in text.split()]

    def reduce_fn(word, counts):
        # Sum the 1s — the aggregate.
        return sum(counts)

    return map_reduce(documents, map_fn, reduce_fn)


if __name__ == "__main__":
    docs = [
        ("doc1", "the cat sat"),
        ("doc2", "the dog sat"),
        ("doc3", "the cat ran"),
    ]
    counts = word_count(docs)
    for word in sorted(counts):
        print(f"{word}: {counts[word]}")
    # cat: 2
    # dog: 1
    # ran: 1
    # sat: 2
    # the: 3
```

The two functions are exactly the `emit (word, 1)` and `sum(counts)` from our hand-trace — nothing more. Hand them to `map_reduce` and you get the counts. To count words across a billion documents on a cluster, you'd change *nothing* about these two functions; you'd only swap the in-process engine for a real one (Hadoop, Spark). **That portability — same job, any scale — is the entire point of the model.**

### Go: word count

```go
package main

import (
	"fmt"
	"sort"
	"strings"
)

func wordCount(docs []Pair) map[string]int {
	// NOTE: here Pair.Value is unused for input; we pass the text via a parallel
	// slice for clarity. (A real API would carry string values; we keep the
	// engine's int-valued signature and split text inside the closure.)
	// For this demo we instead inline the documents as (name, text) strings.
	return nil // replaced by the inline version in main below
}

func main() {
	docs := map[string]string{
		"doc1": "the cat sat",
		"doc2": "the dog sat",
		"doc3": "the cat ran",
	}

	// PHASE 1 — MAP: emit (word, 1) for every word.
	groups := make(map[string][]int)
	for _, text := range docs {
		for _, word := range strings.Fields(text) {
			// emit (word, 1); the shuffle (grouping) is fused into the append.
			groups[word] = append(groups[word], 1)
		}
	}

	// PHASE 3 — REDUCE: sum the 1s for each word.
	counts := make(map[string]int)
	for word, ones := range groups {
		total := 0
		for _, c := range ones {
			total += c
		}
		counts[word] = total
	}

	words := make([]string, 0, len(counts))
	for w := range counts {
		words = append(words, w)
	}
	sort.Strings(words)
	for _, w := range words {
		fmt.Printf("%s: %d\n", w, counts[w]) // the:3 cat:2 sat:2 dog:1 ran:1
	}
}
```

> **Read the two functions, not the plumbing.** In both languages the *job* is two ideas — `map`: emit `(word, 1)`; `reduce`: sum — and everything else is the engine. The Go version inlines the three phases to keep the example self-contained (and to show the shuffle as the `groups[word] = append(...)` line), but conceptually it's the same `map → shuffle → reduce`. The lesson: **a MapReduce program is the two functions; the framework is the rest.**

---

## Code: Sum-by-Key and Average-by-Key

Finally, the pattern beyond counting ones — aggregating a real quantity per group, including the **associative-average trick** with `(sum, count)` pairs. This shows that `map` can emit a meaningful *value* (not just `1`) and that `reduce` can compute more than a sum.

### Python: sum-by-key and average-by-key

```python
def sum_by_key(records):
    """Total a value per key. records: list of (key, number)."""
    def map_fn(key, value):
        return [(key, value)]          # tag the value with its key
    def reduce_fn(key, values):
        return sum(values)             # total the group
    return map_reduce(records, map_fn, reduce_fn)


def average_by_key(records):
    """Average a value per key, the ASSOCIATIVE way: carry (sum, count) pairs
    and divide only at the very end. (Averaging partial averages is WRONG —
    average is not associative — so we reduce the two associative quantities,
    sum and count, and divide last.)"""
    def map_fn(key, value):
        return [(key, (value, 1))]     # each record contributes (value, count=1)
    def reduce_fn(key, pairs):
        total = sum(v for v, _ in pairs)
        count = sum(c for _, c in pairs)
        return total / count           # divide ONCE, at the end
    return map_reduce(records, map_fn, reduce_fn)


if __name__ == "__main__":
    sales = [
        ("north", 100), ("south", 200), ("north", 50),
        ("south", 75),  ("north", 25),
    ]
    print("sum per region:", sum_by_key(sales))
    # {'north': 175, 'south': 275}

    temps = [
        ("NYC", 70), ("LA", 85), ("NYC", 72),
        ("LA", 90),  ("NYC", 68),
    ]
    print("avg per city:  ", average_by_key(temps))
    # {'NYC': 70.0, 'LA': 87.5}
```

Trace `average_by_key` for `"NYC"`: the maps emit `(NYC, (70,1))`, `(NYC, (72,1))`, `(NYC, (68,1))`; the shuffle gathers `NYC → [(70,1), (72,1), (68,1)]`; the reduce sums the values to `210` and the counts to `3`, then divides: `210/3 = 70.0`. The `(sum, count)` carry is what keeps the aggregation **associative** — both `sum` and `count` combine by addition (associative), and the single division at the end gives the correct mean. Try to average partial averages instead and you'd get the wrong answer the moment the groups are uneven.

### Go: sum-by-key and average-by-key

```go
package main

import "fmt"

type Record struct {
	Key   string
	Value float64
}

// sumByKey totals Value per Key.
func sumByKey(records []Record) map[string]float64 {
	groups := make(map[string][]float64) // shuffle: group values by key
	for _, r := range records {
		groups[r.Key] = append(groups[r.Key], r.Value) // map: emit (key, value)
	}
	out := make(map[string]float64)
	for k, vs := range groups {
		total := 0.0
		for _, v := range vs {
			total += v // reduce: sum the group
		}
		out[k] = total
	}
	return out
}

// averageByKey averages Value per Key via the associative (sum, count) trick.
func averageByKey(records []Record) map[string]float64 {
	type sc struct {
		sum   float64
		count int
	}
	groups := make(map[string]*sc)
	for _, r := range records {
		g := groups[r.Key]
		if g == nil {
			g = &sc{}
			groups[r.Key] = g
		}
		g.sum += r.Value // carry sum and count — both associative
		g.count++
	}
	out := make(map[string]float64)
	for k, g := range groups {
		out[k] = g.sum / float64(g.count) // divide ONCE, at the end
	}
	return out
}

func main() {
	sales := []Record{
		{"north", 100}, {"south", 200}, {"north", 50},
		{"south", 75}, {"north", 25},
	}
	fmt.Println("sum per region:", sumByKey(sales))
	// map[north:175 south:275]

	temps := []Record{
		{"NYC", 70}, {"LA", 85}, {"NYC", 72},
		{"LA", 90}, {"NYC", 68},
	}
	fmt.Println("avg per city:  ", averageByKey(temps))
	// map[LA:87.5 NYC:70]
}
```

> **Why the `(sum, count)` trick matters.** Sum-by-key is word count with a real value instead of `1` — `map` emits `(key, amount)`, `reduce` sums. Average-by-key is the one that catches people: **average is not associative**, so you can't combine partial averages. The fix is to reduce the two quantities that *are* associative — the running `sum` and the running `count` — and divide a single time at the very end. This is the standard recipe for any "associative-ize a non-associative aggregate" problem, and it's exactly the kind of thing a **combiner** (a map-side mini-reduce) would pre-aggregate to shrink the shuffle — a topic the [middle file](./middle.md) develops.

---

## Common Misconceptions

- **"MapReduce is the same as the single-machine map and reduce."** Same soul, one big addition. The framework's map and reduce *are* the primitives — independent transform, associative combine — but MapReduce inserts a **key-based shuffle** between them, so reduce runs **once per key** instead of once over everything. The primitive `reduce(⊕, map(f, data))` gives one answer; MapReduce gives one answer *per key*. It's closer to `reduceByKey` (group then reduce) than to a global reduce.

- **"MapReduce *is* Hadoop (or Spark)."** Those are *implementations* of the model; MapReduce is first a **model** — write `map`, write `reduce`, let a framework shuffle and run them. The model came from Google's 2004 paper; Hadoop was the open-source clone; Spark generalized it. Learn the model (the two functions + the shuffle), and the specific framework is interchangeable. Our forty-line engine implements the same model.

- **"The shuffle is something I have to write."** No — the shuffle is the framework's signature service, and the entire reason MapReduce exists. *You* write only `map` and `reduce`; the **framework** does the distributed group-by (hash keys to reducers, move data across the network, sort/group by key). Not having to write the shuffle is the whole convenience.

- **"`reduce` runs once for the whole job."** It runs **once per distinct key**. Word count's `reduce` is called once for `"the"`, once for `"cat"`, once for each word — and those calls are independent and parallel. That per-key independence is what lets reduce scale across many machines.

- **"Any aggregation works in `reduce`."** Reduce parallelizes cleanly only for **associative** aggregations (sum, max, min, count, collect). Non-associative ones (average, "median") need reshaping — average becomes associative by carrying `(sum, count)` and dividing last. If your reduce can't be split-and-recombined, it won't parallelize (and a combiner can't help it).

- **"Map must emit exactly one pair per input."** A `map` call can emit **zero** pairs (a filter — drop the record), **one** pair (a transform), or **many** pairs (word count emits one per word). That flexibility is what lets the same `map` slot express filtering, transformation, and one-to-many expansion.

- **"If a machine dies, the job fails."** The opposite is the point: because every task is independent and re-runnable from durable input, a failed task is simply **re-run elsewhere**, and the job survives. At cluster scale machines die routinely; MapReduce is built to finish anyway.

---

## Common Mistakes

- **Using a non-associative reduce and getting wrong answers at scale.** Averaging partial averages, or any reduce that can't be split-and-recombined, breaks the moment the framework splits a key's values across combiners/partitions. Carry associative quantities instead — for average, `(sum, count)`, dividing only at the very end. Confirm your reduce gives the same answer however the values are grouped.

- **Choosing a key with terrible skew.** If one key has *most* of the values (e.g. grouping web logs by a single dominant URL, or word count where one stopword dominates), its reducer becomes a bottleneck while the others sit idle — the job is only as fast as its biggest group. Watch for skewed keys; sometimes you split a hot key or pre-aggregate with a combiner.

- **Forgetting the combiner and drowning the shuffle in tiny pairs.** Emitting a billion `(word, 1)` pairs and shipping every one across the network is wasteful when you could **pre-sum locally** on each map task first (a *combiner*) and ship `(word, partial_count)` instead. The shuffle is the expensive phase; pre-aggregating shrinks it dramatically. (Only valid for associative reduces.)

- **Putting state or side effects in `map`/`reduce`.** The functions must be **pure and deterministic** — re-running a task (after a failure or as a straggler backup) must produce the same result. A `map` that writes to a shared counter, depends on wall-clock time, or mutates external state breaks fault tolerance and can double-count when tasks are re-run.

- **Treating the in-process engine's loops as the real cost.** Our engine runs map and reduce in sequential `for` loops for clarity, but the *model* has all map tasks parallel over splits and all reduce tasks parallel over keys. The cost to reason about is "how parallel is each phase, and how big is the shuffle," not the toy engine's loop count.

- **Designing a job that needs reducers to talk to each other.** Reduce tasks are independent *by design* — `reduce("cat", …)` can't see `reduce("dog", …)`. If your logic needs cross-key communication, you've mis-shaped the problem (often you need a second MapReduce job, or a different key). Keep each reduce self-contained.

- **Picking the wrong grouping key.** The key *is* the design. If you group by the wrong field, the shuffle gathers the wrong things together and `reduce` aggregates the wrong groups. Before coding, answer "what am I grouping by?" precisely — that single decision determines the whole job.

---

## Cheat Sheet

```
THE MAPREDUCE MODEL — you write TWO functions; the framework does the rest.
  map(key, value)      -> list of (key2, value2)   applied to EVERY record, parallel
  reduce(key2, [vals]) -> output                    applied per DISTINCT key2, parallel

THE THREE PHASES:   MAP  →  SHUFFLE  →  REDUCE
  MAP     transform each record independently, emit (key2, value2)   (your fn)
  SHUFFLE group ALL emitted pairs BY key2 (a distributed group-by)   (the framework!)
  REDUCE  fold each key2's gathered value-list                        (your fn)
  reduce can't start until the shuffle gathers a key's FULL list (a barrier in the middle).

WORD COUNT (the "hello world"):
  map(doc, text):  for word in text: emit (word, 1)
  reduce(word, counts): emit (word, sum(counts))
  docs → (word,1) pairs → shuffle groups by word → sum each → counts.

WHY IT SCALES:
  MAP     = embarrassingly parallel over SPLITS (more data → more splits → more machines)
  REDUCE  = parallel across KEYS (more distinct keys → more reducers)
  SHUFFLE = the ONLY coordination (group-by across the network — the expensive phase)

FAULT TOLERANCE: tasks are INDEPENDENT, STATELESS, DETERMINISTIC → a failed task is
  just RE-RUN on another machine, from durable input. (Also handles stragglers via backups.)

THE SHAPE OF MANY PROBLEMS:  "transform each record, then group & aggregate by key."
  Ask: (1) what KEY to group by? (= what map emits)  (2) what to do per group? (= reduce)
  fits: counting, summing, averaging, filtering, inverted index, joining, grouping.

MORE PATTERNS:
  FILTER:        map emits the record only if it passes (emits NOTHING otherwise). map-only.
  SUM-BY-KEY:    map emit (key, amount);     reduce sum.
  AVG-BY-KEY:    map emit (key, (value, 1)); reduce sum the sums & counts, DIVIDE LAST.
                 (average is NOT associative → carry (sum, count), divide once at the end)
  INVERTED IDX:  map emit (word, docID);     reduce collect docIDs → search engine index.

RELATION TO THE PRIMITIVES:
  primitive reduce(⊕, map(f, data)) → ONE answer, one machine.
  MapReduce = map + KEY-BASED SHUFFLE + reduce → ONE answer PER KEY, many machines, re-run-on-fail.
  (it's reduceByKey at cluster scale.)

COMBINER (optional): a map-side mini-reduce that pre-aggregates before the shuffle
  (sum the 1s locally → ship (word, partial)) to cut network traffic. Associative only.
```

---

## Summary

**MapReduce** is a programming model — and the framework implementing it — for processing huge datasets across a cluster, born from Dean & Ghemawat's 2004 Google paper. Its premise is that you write **two small functions** and the framework handles all of distribution, parallelism, data movement, and fault tolerance.

- **The model is two functions.** `map(key, value)` emits a list of intermediate `(key2, value2)` pairs, applied to *every* input record independently (so the map phase is **embarrassingly parallel**). `reduce(key2, [values])` folds the list of all values for one key, applied *per distinct key* independently (so the reduce phase is **parallel across keys**). You write the *what*; the framework owns the *how*.

- **Three phases: map → shuffle → reduce.** Map transforms each record and tags it with a key; the **shuffle** — the framework's signature step — **groups all intermediate pairs by key** (a distributed group-by / sort) so each reducer gets one key's full list; reduce aggregates each key's group. The shuffle is the one new ingredient the single-machine map-reduce lacked, and the framework does it for you.

- **Word count is the canonical example.** `map(doc)` emits `(word, 1)` for each word; the shuffle gathers all the `1`s per word; `reduce(word, [1,1,…])` sums them. Two trivial functions count words across a billion documents — *unchanged* — because the framework scales the execution. We traced it end to end: documents → map pairs → shuffled groups → reduced counts.

- **Why it scales: independence everywhere except the shuffle.** Map scales with the number of input **splits** (independent chunks → run on more machines, with data locality); reduce scales with the number of distinct **keys** (independent groups → more reducers). The **shuffle** is the lone coordination point — a network-bound group-by the framework optimizes hard.

- **Fault tolerance is "re-run the task."** Because every map and reduce task is **independent, stateless, and deterministic**, a failed task is simply re-run on another machine from durable input — no checkpoints, no rollback, just redo the one broken piece. The same machinery launches backups for slow stragglers. The independence that gives parallelism gives fault tolerance for free.

- **A huge range of problems fits the shape** *"transform each record, then group and aggregate by key."* Name the **grouping key** (what `map` emits) and the **per-group aggregation** (what `reduce` does), and you have a job: counting, summing, averaging, **filtering** (a `map` that stays silent on non-matches), building an **inverted index** (`map` emits `(word, docID)`, `reduce` collects — the heart of search), and **joining** (tag both datasets with the join key, let the shuffle gather both sides). For averages, carry `(sum, count)` and divide last, since average isn't associative.

- **Relation to the primitives:** MapReduce *is* the [map and reduce primitives](../04-parallel-reduce-and-map/junior.md) — independent transform, associative combine — **plus a key-based shuffle** (turning "one answer" into "one answer per key", i.e. `reduceByKey`) **plus distributed-scale fault tolerance**. If you know why map and reduce parallelize on one machine, you know why MapReduce parallelizes on a thousand.

The big idea to carry forward: **you express a massive distributed computation as two small pure functions — `map` (transform-and-tag each record) and `reduce` (aggregate each key's group) — and a framework's shuffle-and-schedule machinery turns them into a parallel, fault-tolerant job across a cluster.** Learning to see the *"transform, then group-and-aggregate by key"* shape in a problem is the skill that lets you parallelize it across machines on sight.

**Next steps:** [the middle-level treatment](./middle.md) digs into **combiners** (map-side pre-aggregation to shrink the shuffle), partitioning and key skew, the cost model of the shuffle, multi-stage MapReduce jobs (joins, secondary sort), and how Spark generalizes the model beyond a single map-then-reduce. Then [Parallel Reduce and Map](../04-parallel-reduce-and-map/junior.md) is the single-machine root of this whole idea; [Parallel Sorting and Merging](../03-parallel-sorting-and-merging/junior.md) underlies the shuffle's distributed sort; and the [work–span model](../01-models-pram-work-span/junior.md) is the lens for reasoning about each phase's parallelism.

---

## Further Reading

- **Jeffrey Dean & Sanjay Ghemawat, "MapReduce: Simplified Data Processing on Large Clusters" (Google, OSDI 2004)** — the original paper, and still the clearest. It introduces the model, walks word count and the inverted index, and explains the execution, the shuffle, fault tolerance via re-execution, and the combiner. Read it right after this file; it will click.
- **Tom White, *Hadoop: The Definitive Guide*** — the canonical practical treatment of an open-source MapReduce, with the anatomy of a job (splits, map, shuffle-and-sort, reduce), combiners, partitioners, and joins worked in detail.
- **Jimmy Lin & Chris Dyer, *Data-Intensive Text Processing with MapReduce*** — a wonderful tour of MapReduce *patterns* (counting, inverted indexing, graph algorithms, joins) with careful attention to combiners and the "design the key" mindset.
- **Zaharia et al., "Resilient Distributed Datasets" (Spark, NSDI 2012)** — how Spark generalizes MapReduce beyond a single map-then-reduce into chained transformations, while keeping the same map/shuffle/reduce DNA and fault-tolerance-by-recomputation idea.
- **[Parallel Reduce and Map](../04-parallel-reduce-and-map/junior.md)** — the single-machine map and reduce primitives this framework scales; `reduceByKey` is the grouped reduction MapReduce generalizes.
- **[Parallel Sorting and Merging](../03-parallel-sorting-and-merging/junior.md)** — the distributed sort/merge underlying the shuffle phase.
- **[Models of Parallel Computation: PRAM and Work–Span](../01-models-pram-work-span/junior.md)** — the work/span lens for reasoning about each phase's parallelism.
- **[MapReduce Patterns — Middle](./middle.md)** — combiners, partitioning and key skew, the shuffle cost model, multi-stage jobs and joins, and how Spark extends the model.
