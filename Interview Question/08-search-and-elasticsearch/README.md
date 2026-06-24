# Search & Elasticsearch

> Senior Go backend interview questions covering Elasticsearch/Lucene internals, mapping and analysis, relevance scoring, Query DSL, aggregations, pagination, cluster topology, durability, and operations including ES-vs-Postgres and source-of-truth sync.

**29 questions** across **12 topics** · Level: senior

## Topics

- [Inverted Index](#inverted-index) (2)
- [Documents, Indices, Shards & Segments](#documents-indices-shards-segments) (3)
- [Mapping & Field Types](#mapping-field-types) (2)
- [Analyzers & Tokenizers](#analyzers-tokenizers) (2)
- [Relevance Scoring](#relevance-scoring) (2)
- [Query DSL](#query-dsl) (3)
- [Aggregations](#aggregations) (2)
- [Pagination](#pagination) (2)
- [Cluster Topology & Allocation](#cluster-topology-allocation) (3)
- [Consistency & Durability](#consistency-durability) (2)
- [Operations](#operations) (3)
- [ELK, ES vs Postgres & Source-of-Truth Sync](#elk-es-vs-postgres-source-of-truth-sync) (3)

---

## Inverted Index

#### 1. What is an inverted index and why does it make full-text search fast?

*Difficulty:* 🟢 warm-up  ·  *Tags:* `inverted-index`, `lucene`, `fundamentals`

An inverted index maps each **term** to the list of documents containing it (the **postings list**), instead of mapping documents to their content (a 'forward' index). At index time the analyzer breaks text into terms; for each term Lucene stores a sorted postings list plus per-term metadata. At query time, finding documents for a term is a single dictionary lookup followed by a sequential scan of an already-sorted postings list, rather than scanning every document. This is why search is O(matching terms) not O(corpus size). The cost is paid up front: indexing is heavier, the index is larger than the raw data, and updates are not in-place — a changed document is a delete-plus-reinsert. The structure is also append-friendly, which is what lets Lucene write immutable segments.

**Key points**
- term -> sorted postings list (doc IDs), opposite of forward index
- query cost scales with matched terms, not corpus size
- postings are sorted so AND/OR merges are linear scans
- trade-off: heavier indexing, larger on-disk size, no in-place update

**Follow-ups**
- How are positions stored to support phrase queries?
- Why does deleting a doc not immediately reclaim space?

---

#### 2. What does the term dictionary store beyond the term -> postings mapping, and how is it kept compact?

*Difficulty:* 🟡 medium  ·  *Tags:* `term-dictionary`, `fst`, `postings`, `compression`

The **term dictionary** is the sorted set of all unique terms in a segment, each pointing to its postings. Per term it tracks document frequency (how many docs contain it) and offsets into the postings, positions, and offsets files. To keep it compact and fast, Lucene stores the dictionary as an **FST (finite state transducer)** in memory, which shares common prefixes/suffixes between terms so a dictionary of millions of terms fits in a small amount of RAM and supports prefix and range scans. Postings themselves are stored separately and **delta-encoded** (store gaps between sorted doc IDs) then bit-packed, so high-frequency terms compress well. The failure mode to know: high-cardinality fields (UUIDs, free-form analyzed text) blow up the term dictionary and postings, hurting memory and merge cost — which is why you map identifiers as `keyword`, not analyzed `text`.

**Key points**
- term dictionary stored as in-memory FST (prefix/suffix sharing)
- per term: doc frequency + offsets into postings/positions/offsets
- postings delta-encoded + bit-packed for compression
- high-cardinality terms bloat the dictionary -> memory/merge cost

**Follow-ups**
- Why use keyword instead of text for an ID field?
- How does doc frequency feed into BM25 scoring?

---

## Documents, Indices, Shards & Segments

#### 3. Walk through the hierarchy: document -> index -> shard -> segment. What is each and how do they relate?

*Difficulty:* 🟢 warm-up  ·  *Tags:* `architecture`, `shards`, `segments`, `lucene`

A **document** is a JSON object — the unit of indexing and retrieval. An **index** is a logical collection of documents with a shared mapping. An index is physically split into **shards**; each shard is a self-contained **Lucene index** and is the unit of scaling and distribution — a query fans out to all shards and merges results. Each shard is composed of immutable **segments**: each segment is a mini inverted index with its own term dictionary and postings. New documents are buffered in memory and periodically written as a new segment (on refresh). Segments are never modified in place; deletes are recorded in a per-segment `.liv` tombstone bitset and updates are delete + reindex. A background **merge** combines small segments into larger ones and physically drops deleted docs. So: documents live in segments, segments compose a shard, shards compose an index.

**Key points**
- document = JSON unit; index = logical group with one mapping
- shard = one Lucene index = unit of distribution/scaling
- segment = immutable mini inverted index
- deletes are tombstones; merges reclaim space and reduce segment count

**Follow-ups**
- Why are segments immutable and what does that buy you?
- What happens to query latency if a shard has thousands of tiny segments?

---

#### 4. Distinguish primary and replica shards. What does each do for write path, read path, and failure tolerance?

*Difficulty:* 🟡 medium  ·  *Tags:* `shards`, `primary-replica`, `write-path`, `ha`

Every shard is either a **primary** or a **replica**. A primary owns the write: a write is routed (by `_routing`, default the doc `_id` hashed mod number_of_primaries) to its primary, applied, then forwarded to all in-sync replicas before the primary acknowledges. Replicas are exact copies that (a) provide redundancy — if a primary's node dies, a replica is promoted — and (b) serve reads, so replicas increase read throughput. Key constraints: `number_of_primaries` is **fixed at index creation** (you must reindex/split/shrink to change it), while `number_of_replicas` is changeable live. Failure modes: with `number_of_replicas: 0` losing a node loses data; replicas on the same node as their primary give no fault tolerance (ES avoids this by default). Write latency is gated by the slowest in-sync replica because the primary waits for it.

**Key points**
- primary owns writes; routing = hash(_routing) % primaries (fixed at creation)
- replicas = redundancy + read scaling; count is changeable live
- primary waits for in-sync replicas before ack -> latency tied to slowest replica
- replica promoted on primary loss; replicas=0 means a node loss = data loss

**Follow-ups**
- Why can't you change the primary count without reindex/split/shrink?
- What is the in-sync allocation set and why does it matter?

---

#### 5. Explain refresh vs flush vs commit, and how they enable near-real-time (NRT) search.

*Difficulty:* 🟠 hard  ·  *Tags:* `refresh`, `flush`, `translog`, `nrt`, `performance`

Three distinct operations on the write path. **Refresh** takes the in-memory indexing buffer and makes it a new searchable segment in the OS filesystem cache — *without* an fsync. This is what makes a freshly indexed doc searchable; the default interval is 1s, hence **near**-real-time (not real-time). **Flush** fsyncs the Lucene segments to disk and starts a fresh translog, performing a Lucene **commit** so the data is durable and recovery won't need to replay the old translog. So: refresh = visibility (cheap, no fsync); flush/commit = durability (expensive, fsync). Durability between flushes is provided by the **translog**, which is fsync'd on every request by default (`index.translog.durability: request`). Failure modes: too-frequent refresh (e.g. refresh per bulk on a heavy ingest) creates many tiny segments and crushes merge/throughput — so for bulk loads set `refresh_interval: -1` and refresh once at the end. Confusing refresh with durability is the classic bug: a refreshed-but-unflushed doc is searchable but only recoverable via the translog.

**Key points**
- refresh = new segment in filecache, no fsync -> makes docs searchable (~1s, NRT)
- flush = fsync segments + Lucene commit + roll translog -> durability
- translog provides durability between flushes; fsync'd per request by default
- bulk-load tuning: refresh_interval=-1 then one refresh; over-refresh = tiny-segment storm


```
PUT /logs-2026/_settings
{ "index": { "refresh_interval": "-1" } }
# ... bulk load ...
POST /logs-2026/_refresh
PUT /logs-2026/_settings
{ "index": { "refresh_interval": "1s" } }
```

**Follow-ups**
- What happens on crash before a flush — what is replayed?
- When would you set translog durability to async and what's the risk?

---

## Mapping & Field Types

#### 6. text vs keyword: how are they indexed differently and when do you choose each?

*Difficulty:* 🟢 warm-up  ·  *Tags:* `mapping`, `text`, `keyword`, `multi-field`

`text` is **analyzed**: the value runs through an analyzer (tokenized, lowercased, stemmed, etc.) and the resulting terms are stored — built for full-text relevance (`match` queries). It is *not* good for exact equality, sorting, or aggregations because the original value is gone (it's been broken into terms), and by default it has no doc_values. `keyword` is stored as a **single, exact, un-analyzed term**: ideal for exact matching (`term`), filtering, sorting, and aggregations, and it has doc_values on by default. Rule of thumb: a status, tag, ID, email, or enum is `keyword`; an article body or product description is `text`. The common pattern is a **multi-field**: index the field as `text` for search and `text.keyword` for aggregation/sorting. Failure mode: putting `term` queries on a `text` field silently matches the analyzed token, not the literal string, so `term` on `text:"Open Source"` won't match because the stored terms are `open` and `source`.

**Key points**
- text = analyzed -> full-text relevance; no exact/sort/agg by default
- keyword = single exact term -> term/filter/sort/agg, doc_values on
- IDs/status/tags/enums => keyword; bodies/descriptions => text
- term-on-text matches analyzed tokens, not the literal value (classic bug)


```
PUT /products
{
  "mappings": {
    "properties": {
      "title": {
        "type": "text",
        "fields": { "raw": { "type": "keyword", "ignore_above": 256 } }
      },
      "status": { "type": "keyword" }
    }
  }
}
```

**Follow-ups**
- What does ignore_above do and why set it on keyword?
- How would you sort by a text field?

---

#### 7. What are the pitfalls of dynamic mapping, and how do you control mapping explosion in production?

*Difficulty:* 🟠 hard  ·  *Tags:* `mapping`, `dynamic-mapping`, `mapping-explosion`, `production`

**Dynamic mapping** auto-creates a field type the first time it sees a value. Pitfalls: (1) **type inference is sticky and wrong** — the first doc decides; a value that arrives as `"123"` makes the field `text`/`keyword` forever, and a later numeric query fails or a conflicting type triggers a mapping conflict. (2) **Mapping explosion** — unbounded keys (e.g. indexing a map of user-supplied attributes, or per-tenant field names) create thousands of fields; each field has memory/cluster-state cost and ES enforces `index.mapping.total_fields.limit` (default 1000) — hit it and indexing fails. (3) **Date detection** turning strings into dates unexpectedly. Controls: set `dynamic: strict` (reject unknown fields) or `dynamic: false` (store but don't index) at the index or object level; use **dynamic templates** to pin types by name/pattern; disable `date_detection`; flatten unbounded key spaces with the `flattened` field type; and always define an explicit mapping for production indices rather than relying on inference.

**Key points**
- first-seen value picks the type and it's sticky -> wrong/conflicting types
- unbounded keys cause mapping explosion; total_fields.limit blocks indexing
- dynamic: strict/false to reject/ignore; dynamic templates to pin types
- use flattened for arbitrary key-value blobs; disable date_detection


```
PUT /events
{
  "mappings": {
    "dynamic": "strict",
    "dynamic_templates": [
      { "ids_as_keyword": {
          "match": "*_id",
          "mapping": { "type": "keyword" } } }
    ],
    "properties": { "attributes": { "type": "flattened" } }
  }
}
```

**Follow-ups**
- How does the flattened type query differently from nested objects?
- What breaks if two indices behind an alias have conflicting dynamic types?

---

## Analyzers & Tokenizers

#### 8. Describe the analyzer pipeline: char filters -> tokenizer -> token filters. Give a concrete example of each stage.

*Difficulty:* 🟡 medium  ·  *Tags:* `analysis`, `tokenizer`, `token-filter`, `stemming`

An analyzer runs text through three ordered stages. **Character filters** transform the raw character stream before tokenization — e.g. `html_strip` removes tags, or a `mapping` filter rewrites `&` to `and`. **The tokenizer** splits the stream into tokens and is the heart of the analyzer — e.g. the `standard` tokenizer splits on Unicode word boundaries, `whitespace` splits on spaces, `ngram`/`edge_ngram` produce partial tokens for autocomplete, `keyword` emits the whole input as one token. **Token filters** transform/add/remove tokens — `lowercase`, `stop` (remove stop words), `stemmer` or `snowball` (reduce to root forms), `synonym`, `asciifolding`. Exactly one tokenizer is allowed; zero or more of the other two. The crucial invariant: **the same analyzer must apply at index time and query time** (or at least produce compatible terms) — if you stem at index time but not query time, a search for 'running' won't hit the indexed term 'run'. This is the single most common analyzer bug.

**Key points**
- order: char filters -> exactly one tokenizer -> token filters
- char filter ex: html_strip; tokenizer ex: standard/edge_ngram; filter ex: lowercase/stemmer
- tokenizer is mandatory and singular; filters are optional and stacked
- index-time and query-time analysis must produce compatible terms


```
PUT /docs
{
  "settings": {
    "analysis": {
      "analyzer": {
        "my_en": {
          "char_filter": ["html_strip"],
          "tokenizer": "standard",
          "filter": ["lowercase", "english_stop", "english_stemmer"]
        }
      },
      "filter": {
        "english_stop": { "type": "stop", "stopwords": "_english_" },
        "english_stemmer": { "type": "stemmer", "language": "english" }
      }
    }
  }
}
```

**Follow-ups**
- How do you set a different search_analyzer from the index analyzer and why?
- What's the index-size/precision trade-off of edge_ngram autocomplete vs a completion suggester?

---

#### 9. When would you deliberately use a different analyzer at index time vs query time?

*Difficulty:* 🟠 hard  ·  *Tags:* `analysis`, `search-analyzer`, `autocomplete`, `synonyms`

You set a separate `search_analyzer` when index-time expansion should not be repeated at query time, or vice versa. The canonical case is **edge n-gram autocomplete**: at index time you analyze 'elastic' into `e, el, ela, elas, ...` so prefixes are indexed; but at query time you must use a plain analyzer (e.g. `standard`) on the user's input 'ela' — otherwise the query 'ela' would itself be n-grammed into `e, el, ela` and match far too broadly, destroying precision. Another case is **synonyms applied only at query time** (`search_analyzer` with a synonym filter) so you can edit the synonym list without reindexing the whole corpus — index-time synonyms bake terms into segments and require reindex to change. The trade-offs: query-time synonyms cost more per query and can complicate scoring/phrase matching; index-time analysis is fixed and cheaper at query time but immutable without reindex. The constant risk is **term mismatch** — index and query analyzers must still emit overlapping terms or you silently get zero hits.

**Key points**
- edge_ngram: ngram at index time, plain analyzer at query time to keep precision
- query-time synonyms = editable without reindex; index-time = baked, cheaper queries
- trade-off: query-time work/scoring complexity vs reindex cost
- asymmetric analyzers must still produce overlapping terms or you get zero hits


```
"title": {
  "type": "text",
  "analyzer": "autocomplete_index",
  "search_analyzer": "standard"
}
```

**Follow-ups**
- Why do index-time synonyms break if you add a multi-word synonym later?
- How does the _analyze API help you debug a zero-hit query?

---

## Relevance Scoring

#### 10. Compare TF-IDF and BM25. Why is BM25 the Elasticsearch default?

*Difficulty:* 🟡 medium  ·  *Tags:* `relevance`, `bm25`, `tf-idf`, `scoring`

Both score a doc for a query term using **term frequency (TF)** — more occurrences = more relevant — and **inverse document frequency (IDF)** — rarer terms are more discriminating. Classic TF-IDF scales TF roughly **linearly**: a term appearing 100 times scores ~100x a single occurrence, which over-rewards keyword stuffing and very long documents. **BM25** fixes two things: (1) **TF saturation** — via the `k1` parameter, additional occurrences give diminishing returns, so the 10th occurrence barely adds score; and (2) **length normalization** — via the `b` parameter, it penalizes long documents relative to the average field length, so a match in a short title outranks the same term buried in a long body. BM25 is more robust on real corpora and resistant to spam, which is why it's been the Lucene/Elasticsearch default since 5.0. Tuning knobs: `k1` (TF saturation, default ~1.2) and `b` (length penalty, default ~0.75). Failure mode: identical IDF can drift per shard because document frequency is computed **per shard** by default, so small indices may score inconsistently — use `dfs_query_then_fetch` if needed.

**Key points**
- both use TF + IDF; TF-IDF scales TF linearly, BM25 saturates it (k1)
- BM25 adds length normalization (b) penalizing long docs
- BM25 is spam/length-robust -> Lucene/ES default since 5.0
- IDF is per-shard by default; use dfs_query_then_fetch for small/uneven indices

**Follow-ups**
- What does setting b=0 do to scoring?
- How does dfs_query_then_fetch change cost and accuracy?

---

#### 11. How do boosting and function_score let you shape relevance beyond raw text match? What are the risks?

*Difficulty:* 🟠 hard  ·  *Tags:* `relevance`, `function-score`, `boosting`, `ranking`

Beyond the BM25 text score you can layer business signals. **Field/query boosting** multiplies a clause's contribution — e.g. boost `title` over `body`, or boost a `should` clause. **function_score** wraps a query and rewrites its score using functions: `field_value_factor` (e.g. multiply by popularity/sales), `gauss`/`linear`/`exp` decay (recency or geo proximity — newer/closer scores higher), `script_score` for arbitrary math, and `random_score` for tie-breaking/sampling. You control combination via `score_mode` (how functions combine: sum/multiply/max) and `boost_mode` (how the function result combines with the query score: multiply/replace/sum). Risks and failure modes: it's easy to let a popularity factor **swamp text relevance** so irrelevant-but-popular docs win — clamp with `modifier: log1p` and a `factor`, or use `boost_mode: multiply` carefully; `script_score` runs per matching doc and can be a serious performance/CPU cost; and decay functions need a sane `scale`/`offset` or recency dominates everything. Always evaluate changes against a judged relevance set (NDCG/MRR), not by eyeballing.

**Key points**
- boosting multiplies clause contribution; function_score rewrites the score
- functions: field_value_factor, gauss/linear/exp decay, script_score, random_score
- score_mode combines functions; boost_mode combines with query score
- risk: signals swamp text relevance; script_score CPU cost; measure with NDCG/MRR


```
GET /products/_search
{
  "query": {
    "function_score": {
      "query": { "match": { "title": "wireless headphones" } },
      "functions": [
        { "field_value_factor": { "field": "sales", "modifier": "log1p", "factor": 0.5 } },
        { "gauss": { "created_at": { "scale": "30d", "offset": "7d", "decay": 0.5 } } }
      ],
      "score_mode": "sum",
      "boost_mode": "multiply"
    }
  }
}
```

**Follow-ups**
- How would you A/B test a relevance change safely?
- Why prefer field_value_factor with log1p over a raw multiply?

---

## Query DSL

#### 12. match vs term: what's the difference and when does each one trip people up?

*Difficulty:* 🟢 warm-up  ·  *Tags:* `query-dsl`, `match`, `term`, `fundamentals`

`match` is a **full-text** query: it runs the query string through the field's analyzer, producing terms, then looks those terms up. So `match` on `title: "Open Source"` analyzes to `open`, `source` and matches docs containing either (OR by default). `term` is a **term-level** query: it takes the value **literally, un-analyzed**, and looks for that exact term in the index. The classic trip-up: running `term` against a `text` field. Because the field was analyzed at index time into lowercased tokens, `term: { title: "Open Source" }` looks for the literal string 'Open Source' as one term — which doesn't exist — so it returns nothing. Rule: use `match` for analyzed `text` fields, use `term` for `keyword`/exact fields (status, IDs, enums). For multi-term exact-phrase requirements on text, use `match_phrase` (respects positions). Use `terms` for an IN-list of exact values.

**Key points**
- match analyzes the input; term is literal/un-analyzed
- term on a text field usually returns nothing (case + tokenization mismatch)
- match for text fields; term/terms for keyword/exact fields
- match_phrase for ordered exact phrases (uses positions)

**Follow-ups**
- How does match_phrase use position data?
- What does the operator/minimum_should_match parameter on match do?

---

#### 13. Explain bool query clauses (must / should / filter / must_not) and the difference between query context and filter context, including caching.

*Difficulty:* 🟠 hard  ·  *Tags:* `query-dsl`, `bool`, `filter-context`, `caching`

A `bool` query composes clauses: **must** (AND, contributes to score), **should** (OR; contributes to score; if there are no must/filter clauses at least one should must match), **must_not** (exclude, no score), and **filter** (AND, but **does not score** — pure yes/no). This maps to two contexts. In **query context** ('does this match *and how well*?') ES computes a relevance score — `must` and `should` run here. In **filter context** ('does this match, yes/no?') no score is computed — `filter` and `must_not` run here. Two big consequences: (1) filter clauses are **cheaper** because skipping scoring avoids BM25 math, and (2) filter results are **cacheable** in the node query cache (a bitset of matching docs), so repeated filters (e.g. `status: active`, a date range bucket) are near-free on subsequent queries. The senior move: put everything that's a boolean predicate (terms, ranges, exists) in `filter`, and reserve `must`/`should` for the parts that should actually influence ranking. Over-using `must` for predicates wastes CPU on scoring and forgoes caching.

**Key points**
- must=AND+score, should=OR+score, must_not=exclude, filter=AND no score
- query context scores; filter context is yes/no only
- filter clauses are cheaper (no BM25) and cacheable as bitsets
- put predicates in filter; reserve must/should for ranking signals


```
GET /orders/_search
{
  "query": {
    "bool": {
      "must":   [ { "match": { "description": "refund issue" } } ],
      "filter": [
        { "term":  { "status": "open" } },
        { "range": { "created_at": { "gte": "now-30d/d" } } }
      ],
      "must_not": [ { "term": { "spam": true } } ]
    }
  }
}
```

**Follow-ups**
- Why does using now (without rounding) hurt filter cache hit rate?
- When does ES decide a filter is worth caching?

---

#### 14. Compare phrase, fuzzy, and wildcard queries by use case and cost. Which are dangerous at scale?

*Difficulty:* 🟡 medium  ·  *Tags:* `query-dsl`, `phrase`, `fuzzy`, `wildcard`, `performance`

**match_phrase** requires terms to appear adjacent and in order, using indexed **positions** (e.g. `"quick brown fox"`); `slop` allows some reordering/gaps. Cost is moderate — it's a positional intersection. **fuzzy** matches terms within an edit distance (Levenshtein, `fuzziness: AUTO`) to tolerate typos; it expands the query term into all index terms within that distance, so cost grows with the number of matching terms — bounded by `max_expansions` and `prefix_length` (a fixed prefix dramatically cuts candidates). **wildcard** (`fox*`, `*fox*`) matches a pattern against the term dictionary; a **leading wildcard** (`*fox`) forces a full term-dictionary scan and is the dangerous one — it can't use the FST prefix structure and is effectively O(distinct terms). At scale: avoid leading/unbounded wildcards (offer a dedicated edge_ngram or completion field for prefix autocomplete instead); cap fuzzy with `prefix_length`; and remember regexp/wildcard run on the *terms*, so an analyzed field's terms (lowercased/stemmed) are what you're matching, not the original text.

**Key points**
- match_phrase uses positions (+slop); moderate cost
- fuzzy expands to terms within edit distance; bound with prefix_length/max_expansions
- leading wildcard *foo = full term-dictionary scan -> dangerous at scale
- prefer edge_ngram/completion for prefix search; patterns match terms not raw text

**Follow-ups**
- How does prefix_length cut fuzzy cost specifically?
- Why is the completion suggester better than wildcard for autocomplete?

---

## Aggregations

#### 15. Distinguish bucket and metric aggregations, and explain how nesting them works.

*Difficulty:* 🟢 warm-up  ·  *Tags:* `aggregations`, `bucket`, `metric`, `doc-values`

**Bucket aggregations** group documents into buckets by some criterion and (optionally) count them — `terms` (group by field value), `date_histogram` (group by time interval), `range`, `histogram`, `filters`. **Metric aggregations** compute a number over the documents in scope — `avg`, `sum`, `min`/`max`, `stats`, `percentiles`, `cardinality`. Power comes from **nesting**: you put metric (or further bucket) aggs *inside* a bucket agg's `aggs`, and they execute per bucket. E.g. a `terms` bucket on `region` with a nested `avg` on `price` yields the average price per region; nest a `date_histogram` inside `region` and you get a time series per region. Buckets rely on **doc_values** (columnar per-field storage) to iterate values efficiently, which is why aggregations need doc_values-enabled fields (default on for keyword/numeric, off for analyzed text). The structural caveat: deep nesting multiplies bucket counts combinatorially and can be very expensive in memory.

**Key points**
- bucket = group docs (terms, date_histogram, range); metric = compute a value (avg, cardinality)
- nest metrics/buckets inside a bucket's aggs -> per-bucket computation
- aggregations read doc_values (columnar), not the inverted index
- deep nesting multiplies buckets -> memory blowup


```
GET /sales/_search
{
  "size": 0,
  "aggs": {
    "by_region": {
      "terms": { "field": "region", "size": 10 },
      "aggs": { "avg_price": { "avg": { "field": "price" } } }
    }
  }
}
```

**Follow-ups**
- Why set size: 0 on an aggregation request?
- Why can't you aggregate on a text field by default?

---

#### 16. How does the cardinality aggregation work, and what are the accuracy/cost trade-offs of high-cardinality and nested aggregations?

*Difficulty:* 🟠 hard  ·  *Tags:* `aggregations`, `cardinality`, `hyperloglog`, `performance`

`cardinality` returns an **approximate** distinct count using the **HyperLogLog++** algorithm — it does not store every value, it maintains a fixed-size sketch, so memory is roughly constant regardless of how many distinct values exist. The `precision_threshold` (max 40000) sets where it switches from exact to approximate; higher = more accurate but more memory. So 'how many unique users' is cheap and bounded but **not exact** — typically within ~1-2% error. Cost/failure modes for aggregations generally: (1) high-cardinality `terms` aggs are expensive because the coordinating node must merge per-shard partial results, and the per-shard `shard_size` heuristic can make a `terms` count on a high-cardinality field both slow and **inaccurate** (the `doc_count_error_upper_bound` warns you). (2) Deep nesting (`terms` inside `terms` inside `date_histogram`) multiplies bucket counts and can exhaust the request circuit breaker. (3) `global ordinals` for high-cardinality keyword terms aggs are rebuilt on refresh, adding latency. Mitigations: prefer `cardinality` over exact distinct, set `size`/`shard_size` deliberately, use `composite` aggregation for paginating huge bucket spaces, and pre-aggregate via rollups/transforms for dashboards.

**Key points**
- cardinality = approximate distinct via HyperLogLog++, constant memory (precision_threshold)
- terms on high-cardinality fields: slow merge + inaccurate (doc_count_error_upper_bound)
- deep nesting multiplies buckets -> circuit breaker / OOM risk
- mitigate with composite agg, shard_size tuning, rollups/transforms


```
GET /events/_search
{
  "size": 0,
  "aggs": {
    "unique_users": {
      "cardinality": { "field": "user_id", "precision_threshold": 3000 }
    }
  }
}
```

**Follow-ups**
- What does doc_count_error_upper_bound tell you and how do you reduce it?
- When would you reach for the composite aggregation?

---

## Pagination

#### 17. Why does from/size pagination break down for deep pages, and what is the index.max_result_window limit?

*Difficulty:* 🟡 medium  ·  *Tags:* `pagination`, `from-size`, `max-result-window`

With `from`/`size`, ES must, for page N, gather `from + size` results **from every shard**, ship them to the coordinating node, and merge-sort to discard the first `from`. So requesting `from: 100000, size: 10` makes each shard return 100010 docs to be sorted and thrown away — cost and memory grow linearly with depth and with shard count. To protect the cluster, `index.max_result_window` (default **10000**) caps `from + size`; exceed it and the query is rejected. This is by design: deep `from`/`size` is an anti-pattern. It's fine for a UI that only ever shows the first few pages, but for 'scroll through everything', 'export', or infinite scroll you must switch to `search_after` (or scroll/PIT). Raising `max_result_window` to paper over deep pagination just moves the OOM risk onto the cluster.

**Key points**
- from/size makes every shard return from+size docs to merge -> cost grows with depth
- index.max_result_window default 10000 caps from+size; deep pages rejected
- fine for shallow UI pagination; wrong for export/infinite scroll
- raising the window doesn't fix the underlying O(depth) cost

**Follow-ups**
- How does search_after avoid the deep-page cost?
- What sort tiebreaker does search_after require?

---

#### 18. Compare search_after, scroll, and PIT (point-in-time). When do you use each?

*Difficulty:* 🟠 hard  ·  *Tags:* `pagination`, `search-after`, `scroll`, `pit`

**search_after** is stateless cursor pagination: you sort by a **unique, total ordering** (e.g. `[score, _id]` or a timestamp plus a tiebreaker) and pass the last hit's sort values as `search_after` for the next page. Each shard seeks directly past the cursor — no `from` accumulation — so cost is constant per page. It's the recommended way to paginate deeply and for live infinite scroll, but by itself it sees a **moving index** (results can shift if data changes between pages). **scroll** takes a **frozen snapshot** of the index at request time and streams batches via a scroll_id; great for a one-shot full export/reindex where you need a consistent view, but it pins segments (resource cost), is stateful, and is now discouraged for user-facing pagination. **PIT (point-in-time)** is the modern fix: you open a lightweight named snapshot (`_pit`) and combine it with `search_after`, getting **both** a consistent view *and* stateless cursoring — this is the recommended pattern for deep, consistent pagination. Rule of thumb: shallow UI -> from/size; live deep scroll -> search_after; consistent deep export/reindex -> PIT + search_after (scroll only for legacy/full-snapshot needs).

**Key points**
- search_after: stateless cursor on a unique sort; constant per-page cost; sees a moving index
- scroll: frozen snapshot, consistent, but stateful + pins segments; for exports/reindex
- PIT + search_after: consistent snapshot AND stateless cursor -> modern deep pagination
- choose: shallow=from/size, live deep=search_after, consistent deep=PIT+search_after


```
POST /logs/_pit?keep_alive=2m
# -> { "id": "<pit_id>" }
GET /_search
{
  "pit": { "id": "<pit_id>", "keep_alive": "2m" },
  "size": 100,
  "sort": [ { "created_at": "asc" }, { "_shard_doc": "asc" } ],
  "search_after": [ 1718000000000, 42 ]
}
```

**Follow-ups**
- Why must search_after include a unique tiebreaker like _shard_doc?
- What resource does an open PIT/scroll hold and why should keep_alive be short?

---

## Cluster Topology & Allocation

#### 19. Describe the main node roles (master, data, coordinating, ingest) and why role separation matters at scale.

*Difficulty:* 🟡 medium  ·  *Tags:* `cluster`, `node-roles`, `topology`

Every node can hold one or more roles. **Master-eligible** nodes manage **cluster state** — index/mapping/shard-allocation metadata — and one is elected active master; this is metadata work, not data work. **Data nodes** hold shards and do the actual indexing/search/aggregation CPU and I/O; sub-roles (`data_hot`, `data_warm`, `data_cold`, `data_content`) support tiered storage. **Coordinating** nodes (any node with no other role, or implicitly every node) receive a client request, fan it out to the relevant data shards, then **gather and merge** results — the reduce phase, which can be memory-heavy for big aggregations. **Ingest** nodes run ingest pipelines (enrich/transform before indexing). Why separate them at scale: a heavy aggregation merge or a GC pause on a combined master+data node can stall the master and destabilize the whole cluster (lost leadership, shard reallocation storms). Dedicating small, stable master nodes protects cluster-state management from data-plane load, and dedicated coordinating nodes absorb the merge cost so data nodes aren't doing double duty.

**Key points**
- master-eligible = cluster state/metadata + leader election (not data work)
- data nodes = shards + indexing/search/agg CPU & I/O; hot/warm/cold tiers
- coordinating = fan-out + gather/merge (reduce phase, memory heavy)
- separate roles so data-plane load/GC can't destabilize the master

**Follow-ups**
- Why keep dedicated master nodes small and many (odd count)?
- How can a huge aggregation OOM a coordinating node?

---

#### 20. How do you choose the number of primary shards for an index, and what goes wrong if you over- or under-shard?

*Difficulty:* 🟠 hard  ·  *Tags:* `cluster`, `sharding`, `capacity-planning`

Primary shard count is **fixed at creation** and is a capacity/scaling decision. Guidance: target shard sizes in the tens of GB (commonly ~10-50 GB for search, often larger for logs), and keep total shards per node proportional to heap (rule of thumb ~20 shards per GB of heap). You estimate total data over the index's lifetime, divide by target shard size, and round. **Over-sharding** (too many tiny shards): each shard is a Lucene index with fixed overhead (memory for FSTs, file handles, cluster-state entries) and every search fans out to all shards, so query coordination/merge overhead and cluster-state size explode — death by a thousand tiny shards is a classic ops failure. **Under-sharding** (too few, too large): a single shard can't be split across nodes, so you can't scale out, recovery/relocation of a huge shard is slow, and a hot shard becomes a bottleneck. Because the count is immutable, the operational levers are: use the `_split` API to multiply shards or `_shrink` to reduce, use **rollover** + time-based indices (ILM) for logs so each index is sized right, and front everything with **aliases** so applications never bind to a specific shard layout.

**Key points**
- primary count fixed at creation; size to ~tens of GB per shard, ~20 shards/GB heap
- over-shard: per-shard overhead + fan-out merge cost + cluster-state bloat
- under-shard: can't scale out, slow recovery, hot-shard bottleneck
- levers: _split/_shrink, rollover+ILM time-based indices, aliases to decouple apps

**Follow-ups**
- How does rollover keep per-index shard size in a healthy range?
- What does _split require about the original primary count?

---

#### 21. Explain split-brain in Elasticsearch and how quorum-based master election (and the legacy minimum_master_nodes) prevents it.

*Difficulty:* 🟠 hard  ·  *Tags:* `cluster`, `split-brain`, `quorum`, `master-election`

**Split-brain** is when a network partition lets two halves of the cluster each elect their own master, so both independently accept writes and mutate cluster state — on heal you have divergent, conflicting state and likely data loss. The defense is **quorum**: a master can only be elected/operate if it has votes from a **majority** of master-eligible (voting) nodes, so at most one side of any partition can ever hold a majority and the minority side steps down (refuses to elect a master). In ES 6.x and earlier this was a manual, footgun-prone setting: `discovery.zen.minimum_master_nodes`, which you had to set to `(N/2)+1` for N master-eligible nodes — set it too low and you risked split-brain; forget to update it when scaling and it broke. ES **7.x replaced this with a built-in voting configuration** managed automatically (Zen2 / Raft-like), so you no longer set the quorum manually — you just run an **odd number** of master-eligible nodes (3 is the standard) and ES maintains the voting set. The practical rules: always have ≥3 master-eligible nodes, keep the count odd, and never run exactly 2 (a partition leaves neither side with a majority -> no master, cluster red).

**Key points**
- split-brain = partition -> two masters -> divergent state/data loss
- quorum: master needs majority of voting nodes; only one partition side can win
- legacy minimum_master_nodes=(N/2)+1 was manual and error-prone
- ES7+ auto voting config; run an odd number (3) of master-eligible nodes, never 2

**Follow-ups**
- Why is exactly 2 master-eligible nodes the worst case?
- What does the active master do on losing quorum?

---

## Consistency & Durability

#### 22. Walk through the write path and the role of the translog. What is guaranteed durable, and when?

*Difficulty:* 🟠 hard  ·  *Tags:* `durability`, `translog`, `write-path`, `consistency`

A write is routed to the document's **primary shard** (routing = hash(_routing) % primaries). The primary validates and applies it: the doc is added to the **in-memory indexing buffer** and **appended to the translog (transaction log)**. The primary then forwards the operation **in parallel to all in-sync replicas**; each replica applies it and appends to its own translog, and only after the required replicas ack does the primary acknowledge to the client. Durability comes from the translog, not from segments: by default `index.translog.durability: request` means the translog is **fsync'd before the write is acknowledged**, so an acked write survives a crash even though it isn't yet in a committed Lucene segment. The in-memory buffer becomes a searchable (but not fsync'd) segment on **refresh** (~1s); it becomes durable on disk via **flush** (Lucene commit + fsync + roll translog). On crash recovery, the shard replays the translog from the last commit point. The trade-off knob: `durability: async` fsyncs the translog every `sync_interval` (default 5s) instead of per request — higher throughput, but you can lose the last few seconds of acked writes on a crash.

**Key points**
- route to primary -> buffer + translog append -> forward to in-sync replicas -> ack after replica acks
- durability is via translog fsync (request mode = fsync before ack), not segments
- refresh makes searchable (no fsync); flush makes durable (commit+fsync+roll translog)
- recovery replays translog from last commit; async durability risks last ~5s of writes

**Follow-ups**
- How does wait_for_active_shards affect write acknowledgement?
- What is the cost of refreshing every 1s under heavy ingest and how do you tune it?

---

#### 23. Is Elasticsearch strongly consistent for reads? Explain the consistency model and its read-path implications.

*Difficulty:* 🟠 hard  ·  *Tags:* `consistency`, `read-path`, `nrt`, `eventual-consistency`

Elasticsearch is **not** strongly consistent for search; it's **near-real-time and eventually consistent** for queries. Two effects: (1) **visibility lag** — a write is durable on ack but not *searchable* until the next refresh (~1s), so an index-then-search immediately may not see your own write unless you force `?refresh=true` (or `wait_for`). (2) **read path** — a search is routed by the coordinating node to a copy of each shard (primary *or* replica) chosen by adaptive replica selection; different replicas may be at slightly different refresh points, so two identical queries can return slightly different results during indexing (and scores can differ because IDF/document-frequency is computed per shard). However, **get-by-id** (`GET /index/_doc/id`) *is* real-time and consistent: it's served from the translog if not yet refreshed, so it always reflects the latest acked write. Practical guidance: rely on real-time `_get` for read-your-own-write by primary key; for search-after-write workflows use `refresh=wait_for` (which waits for the next scheduled refresh rather than forcing one), and don't depend on cross-shard score stability — use `dfs_query_then_fetch` when consistent scoring matters.

**Key points**
- search is NRT + eventually consistent; not strongly consistent
- writes invisible to search until refresh (~1s); use refresh=wait_for after a write
- GET by id is real-time/consistent (served from translog) unlike search
- replicas at different refresh points + per-shard IDF -> result/score variance

**Follow-ups**
- Why prefer refresh=wait_for over refresh=true after a write?
- How does optimistic concurrency (if_seq_no/if_primary_term) help with conflicting updates?

---

## Operations

#### 24. How do index aliases enable zero-downtime mapping changes, and what's the full reindex workflow?

*Difficulty:* 🟠 hard  ·  *Tags:* `operations`, `aliases`, `reindex`, `zero-downtime`

Because most mapping changes (changing a field type, analyzer, or primary shard count) **cannot be applied in place**, you reindex into a new index and **swap an alias** so clients never change. Workflow: (1) the app reads/writes through an alias, e.g. `products` -> `products_v1`. (2) Create `products_v2` with the new mapping/settings. (3) `POST /_reindex` from v1 to v2 (optionally with a `script` to transform docs); for big indices run it async (`wait_for_completion=false`) with slicing for parallelism. (4) Catch up any writes that happened during reindex (dual-write to both, or reindex with a `range` on an updated_at watermark, or use a changes feed). (5) **Atomically** switch the alias in one call that removes v1 and adds v2 — the alias update is atomic so there's no window with zero or two targets. (6) Verify, then drop v1. Aliases also support **filtered aliases** (per-tenant views), **write aliases** (`is_write_index`) so an alias can span multiple indices with one write target, and **search across many indices**. The failure mode to avoid: a non-atomic 'delete old / create new' alias swap leaves a gap where the alias points nowhere.

**Key points**
- clients talk to an alias, never a concrete index -> swap is invisible to apps
- reindex into a new index with the new mapping, transform via script if needed
- handle in-flight writes (dual-write / updated_at watermark) before cutover
- atomically move the alias (remove old + add new in one call); then drop old


```
POST /_aliases
{
  "actions": [
    { "remove": { "index": "products_v1", "alias": "products" } },
    { "add":    { "index": "products_v2", "alias": "products" } }
  ]
}
```

**Follow-ups**
- How do you reconcile writes that landed in v1 during the reindex?
- What does is_write_index do for an alias spanning multiple indices?

---

#### 25. What problem does the bulk API solve, and how do you tune and handle errors with it correctly?

*Difficulty:* 🟡 medium  ·  *Tags:* `operations`, `bulk-api`, `ingest`, `throughput`

Indexing one doc per HTTP request is dominated by per-request overhead (network round trips, translog fsyncs, refresh churn). The **bulk API** batches many index/create/update/delete actions into one request (NDJSON: an action line then a source line per op), amortizing that overhead and dramatically raising ingest throughput. Tuning: pick a batch **size by bytes** (commonly ~5-15 MB per bulk) rather than a fixed doc count, run **multiple bulk requests in parallel** up to the point of diminishing returns / `429` rejections, and for big loads set `refresh_interval: -1` and `number_of_replicas: 0` during load (restore after) to avoid segment/replica churn. Error handling is the senior gotcha: a bulk request returns HTTP 200 even when **individual items failed** — you must inspect `errors: true` and iterate per-item statuses, retrying *only* the failed items (especially `429 es_rejected_execution_exception` from a full write queue) with **exponential backoff**. Don't blindly retry the whole batch (you'd duplicate or re-fail succeeded ops) and use idempotent `create`/`_id`/optimistic concurrency so retries don't double-write.

**Key points**
- bulk batches ops in one NDJSON request -> amortizes round trips/fsync/refresh
- size batches by bytes (~5-15MB), parallelize until 429s, drop replicas/refresh during load
- HTTP 200 can still contain item failures -> check errors flag, retry failed items only
- back off on 429 es_rejected_execution; use idempotent create/_id for safe retries


```
POST /_bulk
{ "index": { "_index": "products", "_id": "1" } }
{ "title": "Wireless mouse", "price": 29.9 }
{ "index": { "_index": "products", "_id": "2" } }
{ "title": "Keyboard", "price": 49.0 }
```

**Follow-ups**
- Why retry only failed items and not the whole bulk?
- What causes es_rejected_execution_exception and how do you back-pressure?

---

#### 26. Explain ILM and the hot-warm-cold(-frozen) tiering model. What problem does it solve for time-series/log data?

*Difficulty:* 🟡 medium  ·  *Tags:* `operations`, `ilm`, `hot-warm-cold`, `time-series`

**Index Lifecycle Management (ILM)** automates the lifecycle of time-based indices through phases — **hot, warm, cold, frozen, delete** — driven by a policy attached via an index template. The motivation: log/metric data is write-heavy and frequently queried when new, but rarely queried when old, yet you still must retain it. **Hot** holds actively-written, recently-queried indices on the fastest (SSD) nodes; **rollover** creates a new index when the current one hits a size/age/doc threshold so each index stays well-sized. As data ages it moves to **warm** (still searchable but on cheaper hardware, often force-merged to fewer segments and replicas reduced), then **cold** (rarely queried, can be made read-only / searchable snapshots on cheap storage), then **frozen** (searchable snapshots in object storage, near-zero local footprint, slower queries), then **delete** at the retention boundary. This matches storage cost to access patterns and enforces retention automatically. Failure modes: forgetting to pair ILM with a **rollover alias** (so the policy has new indices to roll into), or setting force-merge in the warm phase too aggressively (force-merge is expensive I/O). Modern setups use **data streams** which bake in rollover + ILM for append-only time series.

**Key points**
- ILM automates hot->warm->cold->frozen->delete phases via policy
- matches hardware cost to access pattern; enforces retention automatically
- rollover keeps each index sized right; warm phase force-merges + cuts replicas
- frozen = searchable snapshots (cheap, slow); data streams bundle rollover+ILM

**Follow-ups**
- Why force-merge in the warm phase and what's the cost?
- How do data streams differ from a manual rollover alias setup?

---

## ELK, ES vs Postgres & Source-of-Truth Sync

#### 27. What is the ELK/Elastic stack and why is Elasticsearch a strong fit for centralized log analytics?

*Difficulty:* 🟢 warm-up  ·  *Tags:* `elk`, `logging`, `observability`, `kibana`

ELK = **Elasticsearch + Logstash + Kibana**, now the 'Elastic Stack' with **Beats** (lightweight shippers like Filebeat/Metricbeat) added. The flow: Beats/Logstash collect, parse (e.g. grok), and enrich logs/metrics from many hosts; Elasticsearch indexes them; Kibana provides search, dashboards, and alerting. ES fits log analytics because: logs are **append-only time-series** (no updates) which matches immutable segments and time-based indices; full-text search over unstructured messages plus structured-field filtering is exactly the inverted-index + doc_values sweet spot; aggregations power dashboards (counts/percentiles over time, top-N errors); and ILM + rollover + tiered storage handle the huge volume and retention economically. The trade-offs to acknowledge: ES is not a system of record (eventual consistency, no transactions/joins), it's storage-hungry (the index is larger than raw logs), and high-cardinality fields/dynamic mapping on messy log JSON can explode mappings — which is why production log pipelines use ECS-style schemas and structured logging rather than dumping raw blobs.

**Key points**
- ELK = Elasticsearch + Logstash + Kibana (+ Beats shippers)
- logs are append-only time-series -> fits immutable segments + time-based indices
- inverted index + doc_values + aggregations power search and dashboards
- not a system of record; storage-heavy; needs schema discipline to avoid mapping explosion

**Follow-ups**
- Where does Logstash vs an ingest pipeline do the parsing?
- How do you keep messy log JSON from exploding the mapping?

---

#### 28. When should you use Elasticsearch vs PostgreSQL full-text search? Give the decision criteria.

*Difficulty:* 🟠 hard  ·  *Tags:* `postgres`, `full-text-search`, `architecture`, `decision`

Postgres has real full-text search (`tsvector`/`tsquery`, GIN indexes, `ts_rank`) and it's the right choice when: your data already lives in Postgres, search volume is modest, you want **transactional consistency** (search reflects committed data immediately, no separate sync), you need to combine search with relational joins/constraints, and you don't want to operate a second datastore. **Choose Elasticsearch** when you need: relevance quality and tunability (BM25, custom analyzers/stemmers/synonyms per language, function_score, learning-to-rank), search-specific features (fuzzy/typo tolerance, faceted aggregations at scale, autocomplete, highlighting, geo), **horizontal scale** for large corpora / high query throughput via sharding, and analytics dashboards over huge volumes. The core trade-off is **consistency vs capability + scale**: Postgres FTS keeps one source of truth and strong consistency but caps out on relevance tuning and scale; Elasticsearch gives best-in-class search and scale but adds an **eventually-consistent replica you must keep in sync** with the source DB — operational complexity and a class of sync bugs. Pragmatic rule: start with Postgres FTS until relevance/scale/feature requirements clearly exceed it, then add ES as a search index fed from Postgres (with the source DB remaining the system of record).

**Key points**
- Postgres FTS: data already there, transactional consistency, joins, one datastore, modest scale
- ES: superior relevance tuning, analyzers/synonyms, fuzzy, facets, geo, horizontal scale
- core trade-off = consistency/simplicity (PG) vs capability+scale (ES, but must sync)
- default to PG FTS; add ES as a derived index when requirements exceed it

**Follow-ups**
- What relevance features does Postgres FTS lack that ES provides?
- If you add ES, what stays the system of record and why?

---

#### 29. How do you keep Elasticsearch in sync with the source-of-truth database? Compare dual-write vs CDC and their failure modes.

*Difficulty:* 🔴 staff  ·  *Tags:* `cdc`, `sync`, `dual-write`, `outbox`, `source-of-truth`

Since ES is a derived index, the DB stays the system of record and ES is rebuilt from it. **Dual-write** = the application writes to the DB and to ES in the same code path. It's simple but unsafe: the two writes aren't a single transaction, so a crash/error between them leaves them **inconsistent** (DB committed, ES missed, or vice versa), there's no ordering guarantee under concurrency (out-of-order updates can resurrect stale data), and partial failure handling/retries are bolted on. It's acceptable only for low-stakes, low-volume cases. The robust pattern is **CDC (change data capture)**: read the DB's commit log (e.g. Postgres logical replication / WAL via Debezium) and stream every committed change through a log/queue (Kafka) to an indexer that upserts into ES. This guarantees ES reflects **exactly what was committed**, in order, and the queue gives durability/replay/backfill. To make it correct: make ES upserts **idempotent** and **ordered per document** using the DB's monotonically increasing version (LSN / updated_at / xmin) with ES **external versioning** (`version_type=external`) so an older event can never overwrite a newer one; key the queue by document id to preserve per-doc order; and handle reindex/backfill by replaying from a snapshot + the CDC stream. A common refinement is the **transactional outbox**: write changes to an outbox table in the same DB transaction, then ship the outbox via CDC — eliminating dual-write's atomicity gap entirely. Failure modes to name: lost updates from unordered dual-writes, duplicate/replayed events (solved by idempotent upserts), schema drift between DB and ES mapping, and reindex lag during mapping changes (solved with aliases + replay).

**Key points**
- DB = system of record; ES = derived index rebuilt from it
- dual-write is non-atomic + unordered -> inconsistency/lost updates; only for low-stakes
- CDC (WAL/Debezium -> Kafka -> indexer) reflects committed changes in order, with replay
- idempotent + ordered upserts via external versioning (LSN/updated_at); outbox closes the atomicity gap


```
POST /products/_doc/42?version=1718000000&version_type=external
{ "title": "Wireless mouse", "price": 24.99 }
# older event (lower version) -> 409 version_conflict, safely ignored
```

**Follow-ups**
- Why does external versioning protect against out-of-order CDC events?
- How does the transactional outbox pattern eliminate the dual-write race?
- How do you backfill/reindex without losing live CDC updates?

---
