# Elasticsearch Indexing & Relevance at Scale

> Bulk-load 100M documents into Elasticsearch, then make search *fast* and *good*
> at the same time. Find the shard count where query p99 stops improving and
> starts hurting, and learn — with numbers — exactly what relevance costs you in
> latency.

| | |
|---|---|
| **Tier** | Lab (data-systems) |
| **Primary domain** | Search / full-text retrieval |
| **Skills exercised** | Inverted index & segment internals, shard sizing, bulk ingest tuning, mappings (keyword/text/doc_values), query DSL (match/bool/filter), BM25 relevance, aggregations, ILM, Go (`go-elasticsearch` + a bulk loader) |
| **Interview sections** | 8 (search & Elasticsearch), 17 (performance), 22 (scalability) |
| **Est. effort** | 3–5 focused days |

---

## 1. Context

You own search at a company whose catalog (or log estate) just crossed **100M
documents and several hundred GB**. Product complains search is slow during peak;
the data team complains the nightly reindex takes "all night"; and someone added
an aggregation on a `text` field last week and took a node down with an OOM. Nobody
can tell you how many shards the index *should* have, why p99 doubled after the
last reindex, or what a "good" relevance ranking is costing in latency.

Your job is to *characterize* an Elasticsearch index under realistic ingest and
query load, then *tune* it: get bulk-index throughput up, get query p99 down, and
make the relevance-vs-speed trade-off an explicit, measured decision instead of an
accident. You will produce numbers, not opinions.

## 2. Goals / Non-goals

**Goals**
- Bulk-index ≥ 50–100M documents and find the sustained **index throughput
  ceiling** (docs/s), then explain what bounds it (refresh, merges, bulk size, I/O).
- Find the **shard count** that minimizes query p99 for this corpus, and
  demonstrate the over-sharding penalty on either side of it.
- Quantify the latency difference between **filtered** (cached, non-scoring) and
  **scored** (BM25) queries, and between cheap and high-cardinality **aggregations**.
- Use **replicas**, **force-merge**, and **ILM/rollover** deliberately and measure
  each one's effect.

**Non-goals**
- Running a managed cluster (Elastic Cloud / OpenSearch Service). Run it yourself
  so you see refresh, merges, and heap.
- Vector / kNN / semantic search (that's a separate lab) — stay on lexical BM25.
- Cross-cluster replication or snapshot/restore DR (out of scope here).

## 3. Functional requirements

1. A **bulk loader** (`cmd/loader`) reads a corpus and indexes it via the `_bulk`
   API using `go-elasticsearch`'s `esutil.BulkIndexer`, with configurable bulk
   size, worker count, target index, and `refresh_interval`.
2. A **search service** (`cmd/search`) exposes a query API over the index
   supporting at least: a scored `match`/`multi_match` query, a `bool` query with
   `filter` clauses (term/range), and a `terms`/`date_histogram` aggregation.
3. The index mapping is **explicit** (no dynamic guessing): `keyword` vs `text`
   chosen per field, `doc_values` on/off stated, and at least one field deliberately
   set up to expose the `fielddata`/text-aggregation trap (see §10.7).
4. A **load driver** (`cmd/bench`) replays a realistic query mix at a configurable
   concurrency and records latency percentiles.
5. An **ILM policy** + alias/rollover for the time-series variant of the corpus,
   and a **force-merge** path for read-only indices.

## 4. Load & data profile

- **Volume:** ≥ 50–100M documents, several hundred GB on disk. Two corpus shapes,
  pick one and state it:
  - **Product catalog** — `title` (text), `brand`/`category` (keyword),
    `price` (float), `attrs` (nested/object), `created_at` (date).
  - **Log/event** — `message` (text), `service`/`level`/`host` (keyword),
    `status` (int), `@timestamp` (date) — drives the ILM/rollover path.
- **Document size:** state avg doc size (e.g. ~1–4 KB); report it — it sets the
  ~30–50 GB/shard math.
- **Query mix (realistic, not a single query):** ~70% filtered lookups (term/range,
  non-scoring), ~20% scored full-text (`match`/`multi_match` + `bool`), ~10%
  aggregations (`terms`, `date_histogram`). Keys/terms are **Zipfian** so some
  filter values are hot.
- **Generator:** `cmd/gen` is deterministic given a seed; same corpus reproducible.
- **Traffic model:** closed-loop concurrency sweep (N concurrent clients) for the
  query benches; open-model fixed-rate for ingest.

## 5. Non-functional requirements / SLOs

| Metric | Target |
|--------|--------|
| Sustained bulk-index throughput (state doc size, shards, `refresh_interval`) | Find & report the ceiling (docs/s + MB/s); name the bound (merges? refresh? bulk size? I/O?) |
| Search p99 — **filtered** query (cached, non-scoring) | < 50 ms at target concurrency |
| Search p99 — **scored** full-text query (BM25, `bool`) | < 200 ms at target concurrency |
| Aggregation p99 — `terms`/`date_histogram` over full index | < 1 s; report how it scales with cardinality |
| Shard sizing | Each primary shard lands in the **~30–50 GB** band; over-shard penalty demonstrated, not assumed |
| Heap / GC under aggregation load | No OOM; report old-gen pressure and circuit-breaker trips |

> The point of the lab is not to hit a magic number — it's to **find** your index's
> numbers and **explain** them: why p99 has that shape, why shard N is right.

## 6. Architecture constraints & guidance

- A **multi-node** Elasticsearch cluster (3 data nodes) via `docker-compose`. Pin
  the version (ES 8.x). Set JVM heap explicitly (≤ 50% RAM, ≤ ~31 GB) and **bound
  container memory** so you can actually trip circuit breakers, not the OOM killer.
- Go client: `elastic/go-elasticsearch`; use `esutil.BulkIndexer` for ingest and
  the typed query builders (or raw JSON bodies) for search.
- Keep loader, search service, and bench as separate binaries so you can ingest and
  query concurrently and isolate their resource use.
- Instrument everything: index rate (docs/s, bytes/s), merge count/time, refresh
  time, segment count, search p50/p99/p999 per query class, JVM heap/GC, and
  circuit-breaker trips. Scrape ES `_nodes/stats` + `_cat/segments` into Prometheus;
  a Grafana board for ingest, latency, and merges.

## 7. Data model

```
Mapping (catalog example) — explicit, no dynamic mapping:
  title       text       (analyzed; BM25 scoring)
  brand       keyword    (doc_values: true → fast filter/agg/sort)
  category    keyword    (doc_values: true)
  price       float      (doc_values: true → range filter + sort)
  created_at  date       (doc_values: true)
  description text       (analyzed; index:true, doc_values:false)
  raw_blob    keyword    (index:false → stored but not searchable; saves index)

Settings:
  number_of_shards    : <tuned in §10.2>     # target ~30–50 GB/primary
  number_of_replicas  : <tuned in §10.5>     # 0 during bulk load, raise after
  refresh_interval    : -1 during bulk load  # then back to 1s (or longer)
```

The trap field for §10.7: keep `description` as `text` and then *aggregate on it*
to reproduce the `fielddata`/heap blowup; the correct fix is a `keyword`
sub-field with `doc_values`.

## 8. Interface contract

- `POST /search` → `{ query, filters, page, size, sort }` ⇒ hits + total + `took_ms`.
- `POST /agg` → `{ field, type: "terms"|"date_histogram", size|interval }` ⇒ buckets + `took_ms`.
- `GET /metrics` → Prometheus exposition.
- Loader flags: `-corpus`, `-index`, `-bulk-size`, `-workers`, `-refresh`,
  `-shards`, `-replicas`.
- Bench flags: `-concurrency`, `-mix` (filtered/scored/agg ratios), `-duration`.

## 9. Key technical challenges

- **Finding the ingest ceiling.** Throughput is bounded by different things at
  different settings — too-frequent refresh wastes work, undersized bulks waste
  round-trips, oversized bulks trip the bulk queue, and **segment merges** quietly
  eat I/O and CPU. You must isolate which.
- **Shard count is a latency knob, not a capacity knob.** A scored query fans out
  to every shard and merges results; too many small shards means per-shard
  fixed-cost overhead dominates (the **over-sharding penalty**), too few means each
  shard is huge and CPU-bound. The ~30–50 GB/shard guidance is a starting point,
  not the answer — find the knee.
- **Relevance costs latency.** A `filter` clause is non-scoring and **cacheable**
  (the filter/query cache); a scored `match` runs BM25 per matching doc and can't
  be cached the same way. Boosting and `multi_match` add more. Quantify the tax.
- **Aggregations scale with cardinality, not just doc count.** A `terms` agg over
  a low-cardinality `keyword` is cheap; over a high-cardinality field it builds
  large bucket sets in heap and can trip the circuit breaker. And aggregating a
  `text` field forces **fielddata** into heap — the classic OOM.
- **Replicas trade disk for query throughput.** Replicas don't help a single slow
  query, but they add searchable copies so concurrent load spreads. Measure where
  that actually starts paying off.

## 10. Experiments to run (break it / tune it)

Record before/after numbers for each.

1. **Bulk-ingest sweep:** vary `refresh_interval` (`1s` vs `30s` vs `-1`) × bulk
   size (500 / 2,000 / 10,000 docs) × workers. Plot docs/s and merge time. Find the
   throughput ceiling and name the bound. (Expect `refresh=-1` + `replicas=0`
   during load to win big.)
2. **Shard-count sweep (the headline):** index the *same* corpus at 3, 6, 12, 24,
   and 60 shards. Run the scored-query bench at fixed concurrency. Plot query p99
   vs shard count and **find the over-sharding knee** — the point where more shards
   stop helping and start hurting. Tie it back to GB/shard.
3. **Filtered vs scored latency:** the *same* logical query as a non-scoring
   `filter` (term/range in a `bool.filter`) vs a scored `match`. Run twice (cold vs
   warm) to show the filter cache kicking in. Report the BM25 latency tax.
4. **Aggregation cost vs cardinality:** `terms` agg on fields of increasing
   cardinality (10 → 1k → 100k → 10M distinct values). Plot agg p99 and heap usage;
   show where the circuit breaker trips.
5. **Replica count vs query throughput:** 0 → 1 → 2 replicas, run the query bench
   at rising concurrency. Plot achievable QPS at fixed p99. Show where adding
   replicas stops helping (and costs disk + index time).
6. **Force-merge on a static index:** take a read-only (finished) index, record
   segment count and query p99, `_forcemerge?max_num_segments=1`, then re-measure.
   Report the p99 improvement and the merge cost.
7. **The fielddata blowup (cautionary):** deliberately run a `terms` aggregation on
   a `text` field. Capture the `fielddata`/circuit-breaker error (or the heap
   spike), then fix it with a `keyword` sub-field + `doc_values` and re-measure.
   Document the failure mode — this is the one everyone hits in production.

## 11. Milestones

1. Compose cluster up (3 data nodes, pinned ES 8.x, bounded heap); explicit mapping;
   loader streaming via `BulkIndexer`; Prometheus + Grafana board for ingest/latency/merges.
2. `cmd/gen` deterministic corpus; first full 50–100M bulk load; ingest-ceiling run
   and bound named (experiment 1).
3. Shard-count sweep + over-sharding knee (experiment 2); GB/shard reported.
4. Query-class benches: filtered vs scored vs agg-cardinality (experiments 3, 4);
   relevance/latency tax and breaker trips documented.
5. Replicas, force-merge, ILM/rollover + the fielddata cautionary run (experiments
   5, 6, 7); findings note.

## 12. Acceptance criteria (definition of done)

- [ ] ≥ 50–100M docs indexed; sustained ingest run with the **throughput ceiling
      reported and its bottleneck named and proven** (merge time / refresh / bulk
      queue / `iostat` evidence).
- [ ] Shard-count vs query-p99 curve plotted, with the **over-sharding knee
      identified** and tied to GB/shard.
- [ ] Filtered-vs-scored p99 reported, with the filter-cache warm-up visible and the
      BM25 tax quantified.
- [ ] Aggregation p99-vs-cardinality curve, including the **circuit-breaker trip
      point**.
- [ ] Replica-count vs achievable-QPS-at-fixed-p99 curve.
- [ ] Force-merge before/after p99 on a static index.
- [ ] The fielddata/text-aggregation failure **reproduced and then fixed**, both
      shown.
- [ ] Every number reproducible from a committed command + config (index settings
      and bench params).

## 13. Stretch goals

- **ILM end-to-end:** hot→warm→cold rollover on the log corpus by size/age, with
  force-merge on rollover; measure query latency across tiers.
- **Index sorting** on a frequent sort field; measure early-termination wins.
- **Search-after / PIT** deep pagination vs `from`/`size`; show where `from` blows up.
- **Relevance tuning:** `function_score`/field boosts + a tiny judged query set;
  report nDCG@10 vs the latency cost of the scoring complexity.
- **Custom routing** to co-locate a tenant's docs on one shard; measure the
  single-shard query win vs the skew risk.

## 14. Evaluation rubric

| Dimension | Senior bar | Staff bar |
|-----------|-----------|-----------|
| Ingest throughput | Reports a docs/s ceiling | Names and **proves** the bound (merges/refresh/I/O); knows the next one |
| Shard sizing | Knows ~30–50 GB/shard guidance | **Finds** the over-sharding knee for this corpus and explains the fan-out cost |
| Mapping choices | Uses keyword vs text correctly | Reasons about `doc_values`/`fielddata` heap cost; predicted the trap before hitting it |
| Relevance vs latency | Shows scored is slower than filtered | Quantifies the BM25 tax; recommends filter/score split for an SLO |
| Aggregations | Knows aggs are expensive | Ties cost to cardinality + heap; knows where the breaker trips and why |
| Replicas / force-merge | Knows replicas add read capacity | Measures the QPS payoff and force-merge p99 win; uses them deliberately |
| Communication | Clear findings note | Could defend every curve to a staff panel |

## 15. References

- Elasticsearch docs: bulk API, `refresh_interval`, shard sizing guidance, mapping
  parameters (`doc_values`, `fielddata`), query DSL (`bool`/`filter`), aggregations,
  ILM & rollover, force-merge, circuit breakers.
- `elastic/go-elasticsearch` — `esutil.BulkIndexer` and search examples.
- "Practical BM25" (Elastic blog) and the Lucene similarity/scoring docs.
- *Relevant Search* (Turnbull & Berryman) for the relevance-vs-latency framing.
- See also: `Interview Question/08-search-and-elasticsearch/` and
  `Interview Question/17-performance-engineering/`.
