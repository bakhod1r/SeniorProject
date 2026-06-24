# Claim-Check Pattern

> A message broker is the worst place to store a 50 MB PDF. Push the payload to
> object storage, send only a reference through the queue, and let the consumer
> fetch it. Then earn the hard part: the blob and the reference can disagree, and
> orphaned blobs pile up cost until you build the lifecycle correctly.

| | |
|---|---|
| **Tier** | Distributed-pattern (messaging) |
| **Primary domain** | Messaging with large payloads / object storage |
| **Skills exercised** | Broker message-size limits, object storage (S3/MinIO/GCS), content-addressing, signed URLs, streaming I/O, orphan GC, idempotency, exactly-once interplay, Go (`franz-go`/`amqp091`, `aws-sdk-go-v2`) |
| **Interview sections** | 11 (messaging), 13 (distributed systems), 20 (cloud/storage) |
| **Est. effort** | 3–5 focused days |

---

## 1. Context

You own the ingestion pipeline for a document platform. Upstream services publish
events that *carry* their payload inline: scanned invoices (2–40 MB), batch
exports (100 MB–2 GB), and a firehose of moderate JSON blobs (50–500 KB). It
worked at low volume. Now, at scale, the broker is the bottleneck and the
on-call rotation is miserable: Kafka rejects anything over the default 1 MB
`message.max.bytes`, RabbitMQ frames choke and the queue's memory alarms fire,
SQS hard-caps at 256 KB so half the publishes 400 out. Even the messages that fit
are slow — a 4 MB payload replicated to three brokers, held in page cache, and
re-delivered on every consumer retry is paying for the same bytes five times.

The fix is the **claim-check pattern**: write the payload to object storage, put
only a small reference (the "claim check") on the queue, and have the consumer
fetch the blob by that reference. The broker now moves ~200-byte references at
line rate. The interesting engineering is *not* the happy path — it's the
lifecycle and the failure seams: what happens to the blob when the message is
dropped, how do you stop the reference and the blob from disagreeing, and how do
you garbage-collect orphans without deleting a blob a slow consumer still needs.

Your job is to build claim-check correctly under load, then **prove** the
broker-offload win with numbers and prove the orphan rate stays bounded through
crashes.

## 2. Goals / Non-goals

**Goals**
- Build the store-then-reference round-trip end to end: producer writes the blob,
  publishes the reference *only after the blob is durable*, consumer fetches and
  processes, then the blob is reclaimed.
- Quantify the broker-offload win: inline vs claim-check at the same logical rate
  — broker CPU, network, page-cache pressure, end-to-end latency, retention cost.
- Make the reference→blob mapping **idempotent and content-addressed** so retries
  and duplicate deliveries don't double-write or corrupt.
- Build a correct **lifecycle**: orphan detection and garbage collection that
  bounds orphaned-blob count and storage cost through dropped messages and crashes.
- Secure the blob: the reference grants access (signed URL / scoped credential),
  not "the bucket is public."

**Non-goals**
- A general object store — use MinIO or real S3/GCS; you're a *client*, not the
  storage engine (that's `senior/05-content-addressed-storage`).
- Schema evolution of the event envelope (that's `events/04-schema-registry`).
- Cross-region replication of blobs — single-region object store here.
- Encrypting payloads at rest beyond what the store gives you by default (note it,
  don't build a KMS).

## 3. Functional requirements

1. A **producer** (`cmd/producer`) accepts a payload of arbitrary size, writes it
   to object storage, then publishes a reference message to topic/queue `docs`.
   It **must** publish only after the blob write is confirmed durable (PUT 200 /
   multipart complete), never before.
2. The reference message (the claim check) carries: blob key, size, content hash,
   content-type, bucket, and the producer's idempotency key. It is small —
   target < 1 KB, hard cap well under the broker's limit.
3. A **consumer** (`cmd/consumer`) reads the reference, fetches the blob by key
   (or via a signed URL), verifies the content hash, processes it, and acks.
4. The blob key is **content-addressed**: `key = hash(payload)` (or
   `prefix/hash`), so an identical payload published twice maps to one blob and a
   retried PUT is idempotent.
5. A **reaper** (`cmd/reaper`) garbage-collects orphaned blobs — blobs whose
   reference never made it onto the queue, or whose message was dropped/expired —
   without deleting blobs still referenced by in-flight or retained messages.
6. A **chaos hook** (`cmd/chaos`) can kill the producer *between* the blob write
   and the publish, kill the consumer between fetch and ack, and drop/expire
   messages to manufacture orphans.

## 4. Load & data profile

- **Volume:** push **≥ 5 TB** of payload bytes total across runs through the
  pipeline; single sustained run ≥ 30 minutes.
- **Payload size mix (test all three, report separately):**
  - **moderate:** 50–500 KB (the high-rate firehose),
  - **large:** 10–100 MB (documents),
  - **huge:** 1–2 GB (batch exports — must stream, never buffer whole).
- **Rate:** moderate-payload firehose target ≥ 5,000 msg/s; large-payload track
  ≥ 200 msg/s; huge-payload track a handful concurrent but saturating egress.
- **Duplicate fraction:** ~10% of payloads are byte-identical to a prior one
  (exercise content-addressing dedup) and ~2% of messages are redelivered
  (exercise consumer idempotency).
- **Generator:** `cmd/gen` is deterministic given a seed; it emits a payload
  stream with the size mix and duplicate fraction above and a manifest of
  expected `(idempotency_key → content_hash)` for end-of-run reconciliation.
- **Traffic model:** open-model producer (fixed publish rate) so you can watch
  blob-store request rate and broker lag independently.

## 5. Non-functional requirements / SLOs

| Metric | Target |
|--------|--------|
| Reference message size on the wire | < 1 KB p100; broker never sees the payload |
| Broker bytes/s vs inline baseline | **≥ 50× reduction** at the moderate-payload rate; report the exact factor |
| End-to-end p99 (publish → processed), moderate (256 KB) | < 1.5 s at 80% of pipeline ceiling |
| End-to-end p99, huge (1 GB, streamed) | Report; dominated by object-store throughput, **not** broker |
| Huge-payload memory ceiling per worker | **Bounded & flat** (< 64 MB regardless of a 2 GB payload — streaming, no full buffer) |
| Orphan rate after one GC cycle | **0 reachable orphans**; transient orphans bounded by `grace_window`, count reported |
| Double-write / corruption rate | **Zero**: content-hash verify passes for every consumed blob; no blob written twice for an identical payload |

> The point isn't a magic number — it's to **find** your broker-offload factor,
> **prove** the huge-payload path never buffers, and **prove** orphans go to zero
> after GC even when producers crash mid-flow.

## 6. Architecture constraints & guidance

- Broker: pick one and **own its size limit** — Kafka (`message.max.bytes`,
  default ~1 MB) **or** RabbitMQ **or** SQS (256 KB hard cap, the cleanest forcing
  function for why inline can't work). State the limit you're designing against.
- Object store: MinIO via `docker-compose` for local, or real S3/GCS. Use
  `aws-sdk-go-v2` with the S3 API; MinIO is S3-compatible.
- **Never buffer a huge blob in memory.** Producer uses S3 multipart upload (or a
  streaming PUT) reading from an `io.Reader`; consumer streams the `GetObject`
  body to its sink. Memory must be O(part size), not O(payload).
- Publish **after** durability: the blob PUT/multipart-complete must return success
  before the reference is published. Inverting this is the classic corruption bug.
- Keep producer, consumer, and reaper as separate binaries so you can scale and
  kill them independently.
- Instrument with Prometheus: blob bytes written/read, blob PUT/GET request rate
  and p99, broker bytes/s, end-to-end p50/p99/p999, orphan count, GC reclaimed
  bytes, in-flight multipart uploads.

## 7. Data model

```
reference message (the claim check, < 1 KB):
  { bucket, key, size_bytes, content_hash, content_type,
    idempotency_key, created_at }

blob key (content-addressed):
  key = sha256(payload)            -- identical payload → identical key (dedup + idempotent PUT)

reference ledger (durability/GC source of truth, in Postgres):
  blobs(content_hash PK, size_bytes BIGINT, state TEXT, created_at, last_ref_at)
        -- state ∈ {written, published, consumed}
  refs(idempotency_key PK, content_hash, published_at, consumed_at)
```
The ledger row goes to `written` the moment the PUT succeeds; the publish flips it
to `published`; consumer ack flips it to `consumed`. A blob in `written` with no
`published` ref older than `grace_window` is an **orphan** the reaper can delete.
This is the two-phase cleanup core: a blob has a lifecycle independent of any one
message, and only the ledger — not the queue — can tell GC what is reachable.

## 8. Interface contract

- Producer API: `POST /upload` (streaming body) → writes blob, publishes ref,
  returns `{ idempotency_key, content_hash, key }`. Re-`POST` with the same
  idempotency key is a no-op returning the same reference (idempotent ingest).
- Reference message envelope as in §7; published to `docs`.
- Consumer fetch: `GetObject(bucket, key)` directly **or** producer mints a
  **signed URL** (time-boxed, GET-only) embedded in the reference; consumer needs
  no standing bucket credentials. State which model and why.
- `GET /metrics` → Prometheus exposition.
- Reaper: `cmd/reaper -grace=15m -dry-run` lists reclaimable orphans; without
  `-dry-run` it deletes and reports reclaimed bytes.

## 9. Key technical challenges

- **Why inline kills a broker.** A large message is replicated to every in-sync
  replica, pinned in page cache, counted against retention, and re-sent on every
  consumer retry and every consumer-group fan-out. One 4 MB message at `acks=all`,
  RF=3, redelivered once, with two consumer groups ≈ 4 MB × (3 + 1 + 1) of broker
  I/O. It also causes **head-of-line blocking**: one fat message stalls the whole
  partition for everyone behind it. Claim-check makes the broker move a constant
  ~200 bytes regardless of payload.
- **The reference/blob consistency seam.** If you publish *before* the blob is
  durable, a consumer can fetch a key that doesn't exist (or a half-written
  multipart) → corruption / poison message. Publish strictly after durability,
  and have the consumer verify the content hash so a mismatch is loud, not silent.
- **Orphaned blobs & the two-phase cleanup problem.** Two failure shapes leak
  storage: (a) producer crashes **after** the PUT, **before** the publish → blob
  with no reference, forever; (b) a message is dropped/DLQ'd/expired → blob nobody
  will consume. You cannot delete on a timer naively: a slow consumer might still
  fetch a blob whose message looks "old." GC must reason over the ledger + a grace
  window, not over wall-clock alone.
- **Streaming the huge path.** A 2 GB payload must never be `io.ReadAll`-ed. Get
  multipart upload, hashing-while-streaming (compute the content hash from the
  stream, not a second pass), and bounded part buffers right, or memory blows up.
- **Exactly-once interplay.** Content-addressing gives you idempotent writes for
  free (same bytes → same key). But consumer-side, a redelivered reference must
  not reprocess — dedup on `idempotency_key`, and ensure deleting the blob is the
  *last* step so a redelivery before delete is still serviceable.

## 10. Stages (0 simple → 1 big data → 2 high RPS → 3 both)

Build Stage 0 correct first — it's the control. Then push each axis alone, then
both. Don't tune what isn't yet correct.

| Stage | Payload | Rate | What it stresses |
|-------|---------|------|------------------|
| **0 · Simple** | one moderate blob | one message | the round-trip is *correct*: blob durable before publish, fetch, hash-verify, ack |
| **1 · Big data** | 1–2 GB | low | streaming store/fetch, O(part-size) memory, object-store throughput, no full buffer |
| **2 · High RPS** | 50–500 KB | very high | broker-offload win vs inline, blob-store **request** rate (small-object PUT/GET QPS), connection reuse |
| **3 · Both** | large + huge **and** high rate | high | end-to-end throughput, orphan-GC correctness under dropped messages, total cost (storage + requests + egress) |

- **Stage 0 — correct round-trip.** Producer writes one blob, confirms durable,
  publishes the reference, consumer fetches, verifies `content_hash`, processes,
  acks. Prove the broker carried < 1 KB. This is your baseline for everything else.
- **Stage 1 — big data (GB-scale).** Push 1–2 GB payloads through multipart
  upload and streaming download. Memory per worker must stay flat (< 64 MB) while
  moving a 2 GB object — show the pprof heap. Latency is now bounded by
  object-store throughput, and the broker is irrelevant to it; demonstrate that.
- **Stage 2 — high RPS.** Hammer the moderate-payload firehose at ≥ 5,000 msg/s.
  Measure broker load (bytes/s, CPU, page-cache) against an **inline baseline** at
  the same logical rate; report the reduction factor. Now the object store's
  *request* rate is the constraint — small-object PUT/GET QPS, TCP/HTTP connection
  reuse, and per-request overhead, not bandwidth.
- **Stage 3 — both, under failure.** Large + huge payloads at high rate together.
  Drive the chaos hook (crash producer mid-flow, drop messages) *during* the run
  and prove the reaper drives reachable orphans to zero while never deleting a
  blob an in-flight consumer still needs. Report end-to-end throughput and the
  full cost line: storage GB-months, request count, egress.

## 11. Experiments to run (break it / tune it)

Record before/after numbers for each:

1. **Inline vs claim-check broker load.** Same logical rate, moderate payloads.
   Inline path publishes the bytes; claim-check publishes the reference. Plot
   broker bytes/s, broker CPU, partition p99, and end-to-end p99 for both. Report
   the reduction factor and where inline first breaks (size-limit reject, memory
   alarm, head-of-line stall).
2. **Crash between blob-write and publish.** Kill the producer after the PUT
   returns but before the publish. Confirm a `written`-but-unreferenced blob
   exists; run the reaper; prove it's reclaimed after `grace_window` and that **no
   referenced blob is ever deleted**.
3. **Crash between fetch and ack.** Kill the consumer after `GetObject` but before
   ack. On redelivery, prove the blob is still fetchable (delete is the last step)
   and the payload is processed exactly once (dedup on `idempotency_key`).
4. **Orphan GC under dropped messages.** Drop/expire ~5% of references mid-run.
   Their blobs are orphans. Run the reaper; show orphan count → 0 and reclaimed
   bytes; show a slow consumer holding a reference past the grace window is **not**
   robbed of its blob (tune the GC reachability rule until both hold).
5. **Streaming proof (huge path).** Push a 2 GB payload; capture the producer and
   consumer heap profiles; prove memory is O(part size), not O(payload). Then drop
   to a buffering implementation and show it OOM or balloon — quantify the delta.
6. **Content-addressing dedup.** Replay the 10% duplicate fraction; prove
   identical payloads write **one** blob (idempotent PUT), and report storage saved
   vs a random-key scheme.
7. **Signed-URL vs direct fetch.** Compare consumer fetch via time-boxed signed
   URL vs standing bucket credentials: latency overhead, blast radius if a
   reference leaks, and URL-expiry failures under retry/backlog.

## 12. Milestones

1. Compose up MinIO + broker; Stage 0 round-trip with hash-verify; Prometheus +
   a Grafana board for broker bytes/s, blob QPS, end-to-end latency, orphan count.
2. `cmd/gen` with size mix + duplicate fraction; streaming multipart producer and
   streaming consumer (Stage 1); heap proof of bounded memory.
3. Inline-vs-claim-check broker-load experiment (exp. 1); reduction-factor curve.
4. Ledger + reaper; crash-mid-flow and dropped-message chaos (exp. 2–4); prove
   orphans → 0 without robbing slow consumers.
5. Stage 3 combined run under chaos; cost line; findings note.

## 13. Acceptance criteria (definition of done)

- [ ] Sustained ≥ 30-min combined run; dashboard screenshot showing reference size
      < 1 KB, broker bytes/s flat, and blob QPS at target.
- [ ] Inline-vs-claim-check broker-load reduction factor reported **with the inline
      failure mode named** (reject / memory / head-of-line) and proven.
- [ ] Huge-payload (≥ 1 GB) run with a **heap profile proving O(part-size)
      memory** — producer and consumer both.
- [ ] Crash between blob-write and publish: reaper reclaims the orphan and **no
      referenced blob is ever deleted** (show the ledger + object-store diff).
- [ ] After dropped-message chaos, reachable orphans = 0 post-GC, and a slow
      consumer past the grace window still gets its blob (show both).
- [ ] Content-hash verify passes for every consumed blob; duplicates write one
      blob (show dedup count).
- [ ] Every number reproducible from a committed command + config.

## 14. Evaluation rubric

| Dimension | Senior bar | Staff bar |
|-----------|-----------|-----------|
| Broker-offload analysis | Shows claim-check sends a small reference | Quantifies the reduction factor; names inline's exact failure mode (replication/page-cache/head-of-line) and proves it |
| Consistency seam | Publishes after the blob exists | Publishes after **durability**, verifies content hash, explains why the order is the only correct one |
| Streaming | Handles large payloads | Proves O(part-size) memory on a 2 GB object with a heap profile; never `ReadAll`s |
| Lifecycle / orphan GC | Has a reaper that deletes old blobs | Two-phase GC reasons over the ledger + grace window; provably never deletes a reachable blob; bounds orphan count under crashes |
| Idempotency / EOS | Dedups duplicate deliveries | Content-addresses for idempotent writes, orders delete last, defends exactly-once interplay |
| Security | Bucket isn't public | Time-boxed signed URLs / scoped creds; reasons about leaked-reference blast radius and URL-expiry-under-retry |
| Communication | Clear findings note | Could defend the reduction factor, the GC reachability rule, and the cost line to a staff panel |

## 15. Stretch goals

- **TTL / lifecycle policy on the bucket** as a second GC layer; reconcile it with
  the ledger-driven reaper and show they don't fight (double-delete races).
- **Compression before store** (zstd) for the document track; measure storage and
  egress saved vs CPU and the effect on content-addressing (compress-then-hash vs
  hash-then-compress — pick one and justify).
- **Encryption at rest with per-blob keys** (envelope encryption); measure the
  key-management overhead.
- **Reference-counted blobs** (fan-out: many messages reference one content hash);
  GC only when the last reference is consumed — show the refcount races.
- **Tiered store:** hot small references inline (< broker limit) but big payloads
  via claim-check; auto-route on size and measure the crossover point.

## 16. References

- Enterprise Integration Patterns — *Claim Check* (Hohpe & Woolf).
- Kafka `message.max.bytes` / `max.request.size`; RabbitMQ large-message guidance;
  AWS SQS 256 KB limit and the *Extended Client Library* (claim-check for SQS).
- AWS S3 multipart upload & pre-signed URLs; `aws-sdk-go-v2` S3 streaming.
- *Designing Data-Intensive Applications* — Ch. 11 (message brokers, redelivery).
- See also: `senior/05-content-addressed-storage` (the store engine), the
  `events/` track (envelope, DLQ, idempotent inbox/outbox), and the
  `Interview Question/11-messaging-and-event-streaming/` and
  `Interview Question/20-cloud-aws-gcp/` banks for the matching theory.
