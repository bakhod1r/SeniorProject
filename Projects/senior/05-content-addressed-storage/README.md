# Content-Addressed Object Storage (S3-like)

> Build an object store where the *content* is the address. Hash the bytes,
> store each unique chunk once, reference-count the rest. Stream multi-GB
> objects through a fixed-size buffer, never the whole thing in RAM — and find
> exactly where hashing, disk, and metadata stop being free.

| | |
|---|---|
| **Tier** | Senior (own a service end-to-end) |
| **Primary domain** | Storage systems |
| **Skills exercised** | Content addressing (SHA-256), fixed vs content-defined chunking, dedup, multipart upload, streaming I/O (`io.Reader`/`io.Writer`), Postgres metadata, range reads, GC, backpressure |
| **Interview sections** | 5 (Postgres/SQL), 20 (cloud — AWS/GCP), 16 (security) |
| **Est. effort** | 4–6 focused days |

---

## 1. Context

You're the engineer who owns "blob storage" for a product that stores user
uploads, backups, and build artifacts — a private S3. The dataset is already in
the **tens of TB across millions of objects**, and it's growing because nothing
is deduplicated: the same 2 GB VM image gets uploaded by 40 teams and stored 40
times. Finance sees the disk bill. Meanwhile a naive `ReadAll`-into-`[]byte`
upload path OOMs the moment someone PUTs a 5 GB object, and listing a bucket with
2M keys takes 8 seconds.

Your job is to build the storage service properly: **content-addressed** so
identical bytes are stored once, **streaming** so object size is decoupled from
memory, **multipart** so a multi-GB upload survives a dropped connection, with a
**Postgres metadata plane** separate from the **blob plane on disk**. You will
produce a dedup ratio, a throughput ceiling, and a GC that doesn't delete live
data — with numbers, not opinions.

## 2. Goals / Non-goals

**Goals**
- Store an object by **chunking it, hashing each chunk (SHA-256), and storing each
  unique chunk exactly once**, reference-counted. Identical content costs zero
  extra bytes.
- Stream PUT and GET of **multi-GB objects** through a bounded buffer — peak RSS
  must be independent of object size.
- Implement **multipart upload**: init → upload parts (out of order, in parallel)
  → complete, **resumable** after an interrupted upload.
- Run the **metadata store (Postgres)** separately from the **blob store
  (filesystem)** and keep both correct under concurrent writes.
- Support **range reads** (`GET` with `Range:` over chunk boundaries) and
  **integrity verification** (re-hash on read; detect bit-rot).
- Implement **garbage collection** of unreferenced chunks that is provably safe
  under concurrent uploads.
- Measure the **dedup ratio** of fixed-size vs content-defined chunking on
  realistic data, and find where **hashing CPU** becomes the throughput bound.

**Non-goals**
- Reimplementing the full S3 API surface (ACLs, lifecycle policies, versioning) —
  pick the slice in §8.
- A distributed multi-node blob plane. Single node, local disk(s). Erasure
  coding/replication is a stretch goal (§13).
- A custom hash function or cipher. Use `crypto/sha256` and standard AES-GCM.

## 3. Functional requirements

1. An **object API** (`cmd/objstore`) exposes PUT/GET/HEAD/DELETE and List over
   HTTP. PUT accepts a streamed body; GET streams the body back.
2. **Content-addressed write path:** the body is split into chunks; each chunk is
   hashed with SHA-256; the chunk is written to the blob store under its hash
   **only if not already present**; an object is a *manifest* — an ordered list of
   chunk hashes plus offsets.
3. **Chunking is pluggable** behind one interface, with two implementations:
   - `fixed` — fixed-size chunks (e.g. 4 MB).
   - `cdc` — content-defined chunking via a rolling hash (Rabin or Buzhash /
     FastCDC), with `min`/`avg`/`max` chunk size.
4. **Multipart upload:** `init` returns an `upload_id`; clients `PUT` numbered
   parts (≥ 5 MB each except the last) in any order; `complete` assembles the
   manifest. An interrupted upload is **resumable** — already-received parts are
   not re-sent.
5. **Range reads:** `GET` with `Range: bytes=START-END` returns exactly that byte
   range by reading only the chunks it overlaps — never the whole object.
6. **Integrity:** on read, optionally re-hash chunks and reject on mismatch
   (`-verify`); a `cmd/fsck` walks the store and reports corrupt/orphaned chunks.
7. **Garbage collection:** `cmd/gc` deletes chunks whose reference count is zero,
   correctly, while uploads are concurrently *creating* references.

## 4. Load & data profile

- **Scale:** populate **≥ 10 TB logical** across **≥ 2M objects**. (Use sparse /
  synthetic bytes so you don't need 10 TB of physical disk to *test the
  metadata*; but run the throughput experiments on real multi-GB objects.)
- **Object size mix:** long-tail — most objects 10 KB–1 MB, but include
  **multi-GB objects (≥ 5 GB)** for the streaming/multipart path. Report both.
- **Realistic dedup data:** the generator must produce data with **real,
  measurable redundancy**, not random bytes (random data dedups to ~0% and proves
  nothing). Use at least: (a) near-duplicate files (same base + small edits /
  inserted bytes — the case CDC wins), (b) exact-duplicate objects, (c) tarballs
  of overlapping directory trees. State the *expected* dedup ratio of your corpus.
- **Generator:** `cmd/gen` is deterministic given a seed.
- **Concurrency:** drive ≥ 64 concurrent uploads and a separate GC pass at the
  same time — the write/GC race is the point.

## 5. Non-functional requirements / SLOs

| Metric | Target |
|--------|--------|
| Streaming PUT throughput (single 5 GB object, `fixed` chunking) | Find & report the ceiling; name the bound (disk write? SHA-256 CPU? chunking?) |
| Peak process RSS during a 5 GB PUT and GET | **< 256 MB** — independent of object size (prove it) |
| Aggregate upload throughput (64 concurrent streams) | Report MB/s; show it scales until the disk or CPU saturates |
| GET p99 latency, small object (≤ 1 MB), warm | < 50 ms |
| Range-read p99 (1 MB range out of a 5 GB object) | < 100 ms; reads **only** overlapping chunks (prove via I/O counters) |
| Dedup ratio, `fixed` vs `cdc`, on the realistic corpus | Measured & reported for both; CDC ≥ fixed on near-dup data |
| Metadata: List 1 page (1000 keys) of a 2M-object bucket | < 100 ms p99 (keyset pagination, not OFFSET) |
| Metadata: object lookup by key at 2M objects | < 10 ms p99 |
| GC correctness | **Zero** live chunks deleted, ever, under concurrent writes |
| Integrity | Re-hash on read matches stored hash for 100% of chunks; bit-rot detected by `fsck` |

> The point isn't to hit a magic MB/s — it's to **find** where bytes, hashing,
> and metadata bottleneck on *your* machine and **explain** each one.

## 6. Architecture constraints & guidance

- **Two planes, kept separate:** Postgres holds *metadata only* (objects, chunks,
  refs, uploads); the **blob plane** is the raw chunk bytes on a local filesystem.
  Never store chunk bytes in Postgres.
- **Blob layout:** content-address on disk — store a chunk at a path derived from
  its hash, e.g. `blobs/ab/cd/abcd…` (2-level fan-out to avoid a million files in
  one directory). Writes are **write-to-temp + fsync + atomic rename** so a crash
  never leaves a half-written, wrongly-named chunk.
- **Streaming is mandatory.** The write path is an `io.Reader` pipeline:
  `request.Body → chunker → sha256 → dedup-check → writer`. The read path is a
  `MultiReader` / `io.Copy` over the manifest's chunks straight to
  `http.ResponseWriter`. **At no point** may you hold a whole object in memory —
  `io.ReadAll` on the body is an automatic fail.
- **Backpressure:** bound in-flight chunk writes (a semaphore / bounded worker
  pool). A fast client must not let unbounded chunks queue in RAM — `io.Copy`
  through a fixed buffer gives you natural backpressure; respect it.
- **Hashing:** `crypto/sha256` (or `sha256.New()` streamed via `io.MultiWriter`
  so you hash *while* you copy, not in a second pass). SHA-256 is the likely CPU
  bound at high throughput — measure it and consider hardware-accelerated
  variants / parallel chunk hashing.
- **Postgres:** ref-count updates and manifest inserts happen in transactions;
  the chunk write to disk happens *before* the ref is committed (write-blob-then-
  commit-ref ordering matters for GC safety — see §9).
- Instrument with Prometheus: bytes in/out, chunks written vs deduped, dedup
  ratio, SHA-256 ns/byte, in-flight writes, GET/PUT p50/p99/p999, GC chunks
  scanned/deleted.

## 7. Data model

```
-- METADATA PLANE (Postgres) — bytes never live here.

objects(
  id           BIGINT PRIMARY KEY,
  bucket       TEXT NOT NULL,
  key          TEXT NOT NULL,
  size         BIGINT NOT NULL,
  etag         TEXT NOT NULL,           -- hash of the manifest (S3-style)
  content_type TEXT,
  created_at   TIMESTAMPTZ NOT NULL,
  UNIQUE(bucket, key)                   -- last-writer-wins per key
)

chunks(
  hash       BYTEA PRIMARY KEY,         -- SHA-256 of the chunk bytes (32 B)
  size       INT NOT NULL,
  refcount   BIGINT NOT NULL DEFAULT 0, -- # of manifest entries pointing here
  created_at TIMESTAMPTZ NOT NULL
)

manifest(                              -- ordered chunk list for an object
  object_id  BIGINT NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  seq        INT NOT NULL,             -- chunk order within the object
  hash       BYTEA NOT NULL REFERENCES chunks(hash),
  offset     BIGINT NOT NULL,          -- byte offset of this chunk in the object
  PRIMARY KEY(object_id, seq)
)

-- MULTIPART
uploads(
  upload_id  UUID PRIMARY KEY,
  bucket     TEXT, key TEXT,
  created_at TIMESTAMPTZ,
  state      TEXT                       -- 'open' | 'completed' | 'aborted'
)
upload_parts(
  upload_id  UUID REFERENCES uploads(upload_id) ON DELETE CASCADE,
  part_no    INT NOT NULL,
  size       BIGINT NOT NULL,
  etag       TEXT NOT NULL,            -- hash of the part's manifest slice
  PRIMARY KEY(upload_id, part_no)      -- re-PUT of a part is idempotent
)
```

```
-- BLOB PLANE (filesystem)
blobs/<hh[0:2]>/<hh[2:4]>/<full-hex-hash>      -- one file per unique chunk
```

The `etag` of an object derives from its manifest (chunk hashes), so two objects
with identical content get the same etag for free. Dedup is enforced at the
`chunks` table: a chunk hash either already exists (bump `refcount`) or is new
(write blob, insert row).

## 8. Interface contract

S3-style HTTP. (Range and multipart semantics intentionally mirror S3 so the
mental model transfers.)

**Single-object**
- `PUT /{bucket}/{key}` — body is the object **stream**; response `ETag`.
- `GET /{bucket}/{key}` — streams body; supports `Range: bytes=START-END`
  → `206 Partial Content` reading only overlapping chunks.
- `HEAD /{bucket}/{key}` — size, etag, content-type; no body.
- `DELETE /{bucket}/{key}` — removes the object + decrements chunk refcounts.
- `GET /{bucket}?prefix=&marker=&max-keys=1000` — **keyset-paginated** list
  (cursor = last key), never SQL `OFFSET`.

**Multipart**
- `POST /{bucket}/{key}?uploads` → `{ upload_id }`.
- `PUT /{bucket}/{key}?uploadId=…&partNumber=N` — upload one part (idempotent on
  `(upload_id, part_no)`); response part `ETag`.
- `GET /{bucket}/{key}?uploadId=…` → list received parts (for **resume**).
- `POST /{bucket}/{key}?uploadId=…` (complete) with the part list → assembles the
  object manifest, returns the object `ETag`.
- `DELETE /{bucket}/{key}?uploadId=…` (abort) → drops parts; their unreferenced
  chunks become GC-eligible.

**Ops**
- `GET /metrics` — Prometheus exposition.
- Flags/env: `-chunker=fixed|cdc`, `-chunk-size`, `-cdc-min/-cdc-avg/-cdc-max`,
  `-verify`, `-blob-dir`, `-max-inflight-writes`.

## 9. Key technical challenges

- **Streaming without buffering.** Splitting a stream into chunks *and* hashing
  *and* dedup-checking *and* writing — all in one pass, with bounded memory — is
  the core skill. The naive `ReadAll` works at 10 KB and OOMs at 10 GB. Build the
  `io.Reader` pipeline so RSS is flat.
- **GC vs concurrent writes (the hard one).** GC deletes chunks with
  `refcount = 0`. But an in-flight upload may have *just written a blob* and not
  *yet committed its ref*. Delete it and you corrupt a live object. You must order
  operations and/or grace-window so GC is **provably safe**: e.g. write-blob →
  commit-ref, and GC only deletes chunks that have been `refcount = 0` **and**
  older than the longest possible in-flight upload (a quarantine/sweep two-phase).
  State your invariant and defend it.
- **Hashing as the throughput bound.** At multi-GB/s disk, SHA-256 (≈ GB/s per
  core) becomes the ceiling. Measure ns/byte; parallelize chunk hashing across
  cores; know what your CPU's SHA extensions buy you.
- **Chunk-size vs dedup vs metadata.** Small chunks → better dedup but **more
  rows in `chunks`/`manifest`** (metadata explosion) and more files on disk.
  Large chunks → cheap metadata, worse dedup. CDC fixes the *boundary-shift*
  problem (an inserted byte re-chunks the whole file under `fixed`) at a CPU cost.
  Quantify the three-way trade-off.
- **Metadata at millions of rows.** Listing and lookup at 2M objects must use the
  right indexes and **keyset pagination** — `OFFSET 1990000` is a full scan. The
  `chunks` table can have far more rows than `objects`; index and size accordingly.

## 10. Experiments to run (break it / tune it)

Record before/after numbers for each:

1. **Streaming vs naive buffering.** PUT and GET a 5 GB object two ways:
   `io.Copy` streaming vs `io.ReadAll` into `[]byte`. Plot **peak RSS** and
   **wall-clock** for both. Show streaming is flat-memory; show where buffering
   OOMs.
2. **Dedup ratio: fixed vs CDC.** Run the realistic corpus through `fixed` (try
   1 MB / 4 MB) and `cdc` (e.g. avg 1 MB). Report **logical bytes / physical bytes
   stored** for each, and the chunk count. Demonstrate CDC's win on the
   near-duplicate (inserted-byte) files specifically.
3. **Hashing as the bottleneck.** Drive max upload throughput and profile
   (`pprof`). Show SHA-256 in the flame graph; report **ns/byte**. Then parallelize
   chunk hashing across N cores and re-measure the ceiling. Name the new bound.
4. **Chunk-size sweep.** 256 KB → 1 MB → 4 MB → 16 MB. For each, record dedup
   ratio, `chunks` row count, files-on-disk, and PUT throughput. Find the knee.
5. **Metadata at scale.** With 2M objects: time `List` page-1 via **OFFSET** vs
   **keyset** pagination; time a key lookup with and without the right index; show
   `EXPLAIN (ANALYZE, BUFFERS)` for each. Report p99 at 2M.
6. **Multipart resumability.** Start a multi-GB multipart upload, **kill the
   client mid-upload**, restart, and resume — only the missing parts are re-sent.
   Prove the completed object's etag matches a one-shot upload of the same bytes.
7. **GC correctness under load.** Run 64 concurrent uploads (constantly creating
   refs) *while* `gc` sweeps. Afterward prove: (a) **no live chunk was deleted**
   (every manifest hash still resolves to a blob), and (b) genuinely orphaned
   chunks *were* reclaimed. Report GC scan cost (chunks/s) and space reclaimed.
8. **Range reads touch only needed chunks.** `GET` a 1 MB range out of a 5 GB
   object; instrument chunk opens / bytes read from disk and prove it reads only
   the overlapping chunks, not 5 GB.

## 11. Milestones

1. Single-object PUT/GET streaming through a fixed buffer; `fixed` chunker;
   SHA-256 content addressing; blobs on disk with atomic write; Postgres
   objects/chunks/manifest. Prove flat RSS on a 5 GB PUT (experiment 1).
2. Dedup working with refcounts; `cmd/gen` realistic corpus; dedup-ratio
   measurement (experiment 2). Add CDC chunker; chunk-size sweep (experiment 4).
3. Multipart init/part/complete + resume (experiment 6); range reads
   (experiment 8); integrity verify + `fsck`.
4. Metadata at 2M objects: keyset pagination, indexes, `EXPLAIN` (experiment 5).
5. GC: ref-count decrement on delete, safe two-phase sweep, concurrent-write
   correctness proof (experiment 7). Hashing-bottleneck profile + parallel hashing
   (experiment 3). Findings note.

## 12. Acceptance criteria (definition of done)

- [ ] 5 GB object PUT **and** GET with peak RSS **< 256 MB** — `/proc`/`pprof`
      evidence attached; `io.ReadAll` is nowhere in the object path.
- [ ] Dedup ratio reported for **both** `fixed` and `cdc` on the realistic corpus,
      with logical-vs-physical byte counts and chunk counts.
- [ ] Streaming-throughput ceiling reported **with the bottleneck named and
      proven** (SHA-256 / disk / chunking — flame graph or iostat).
- [ ] Multipart upload survives a mid-upload client kill and **resumes**; resumed
      object etag == one-shot etag (show the diff).
- [ ] List + lookup at **2M objects** meet the §5 SLOs via keyset pagination and
      indexes; `EXPLAIN (ANALYZE, BUFFERS)` attached.
- [ ] GC ran concurrently with 64 uploads and deleted **zero** live chunks (proof:
      every manifest hash resolves) while reclaiming genuine orphans.
- [ ] Range read of 1 MB from a 5 GB object reads only overlapping chunks (I/O
      counter proof).
- [ ] Every number reproducible from a committed command + config + seed.

## 13. Stretch goals

- **Erasure coding / replication** for durability: store each chunk as
  Reed-Solomon shards (or N-way replicas) and survive losing a disk; measure the
  storage overhead and reconstruction cost.
- **Encryption at rest:** per-chunk AES-GCM with a separate key (convergent
  encryption trade-offs — note that naive convergent encryption *leaks* dedup
  across tenants; discuss the security implication, see §15/section 16).
- **Compression** of chunks before storing (zstd) and its interaction with dedup
  (compress *after* chunking so dedup still works).
- **Tiered storage:** spill cold chunks to an S3 backend; hot chunks on local
  disk; transparent read-through.
- **Cross-tenant dedup isolation:** decide whether tenants share the chunk pool
  (max dedup, but enables existence-oracle attacks) or are isolated (safe, less
  dedup). Implement and justify.

## 14. Evaluation rubric

| Dimension | Senior bar | Staff bar |
|-----------|-----------|-----------|
| Streaming I/O | Object path streams; RSS flat on 5 GB | Backpressure bounded and measured; explains the `io.Reader` pipeline end to end |
| Content addressing & dedup | Stores unique chunks once; reports a dedup ratio | Quantifies fixed-vs-CDC, chunk-size knee, and the metadata cost of small chunks |
| Hashing bottleneck | Knows SHA-256 costs CPU | Measures ns/byte, parallelizes hashing, names the next bound |
| GC correctness | Deletes orphaned chunks | **Proves** no live chunk is ever deleted under concurrent writes; states the invariant |
| Metadata at scale | List/lookup work at 2M | Keyset pagination + right indexes; reads `EXPLAIN`; sizes the chunks table |
| Multipart | Parts assemble into an object | Resumable after interruption; idempotent part PUTs; etag-stable |
| Security | Verifies integrity on read | Reasons about convergent-encryption dedup leakage and tenant isolation |
| Communication | Clear findings note | Could defend every curve and the GC invariant to a staff panel |

## 15. References

- `crypto/sha256` and `io` (`io.Reader`, `io.Copy`, `io.MultiReader`,
  `io.MultiWriter`, `io.TeeReader`) — the streaming primitives this whole service
  is built on.
- FastCDC / Rabin fingerprinting papers — content-defined chunking and the
  boundary-shift problem; `restic`/`bup`/`casync` as real CAS implementations to
  study.
- AWS S3 docs: multipart upload (init/part/complete/abort), Range GET semantics,
  ETag rules — the contract this project mirrors.
- *Designing Data-Intensive Applications* — Ch. 3 (storage engines), for the
  metadata-vs-blob separation and write-ordering intuition.
- Postgres docs: keyset pagination, partial/covering indexes, `EXPLAIN (ANALYZE,
  BUFFERS)`.
- See also: `Interview Question/20-cloud-aws-gcp/` (object storage, S3 semantics,
  durability/availability), `Interview Question/05-postgresql-and-sql/`
  (indexing, pagination, transactions for the metadata plane), and
  `Interview Question/16-security/` (encryption at rest, convergent-encryption
  dedup leakage, integrity verification).
