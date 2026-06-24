# Event Schema Registry & Contract Evolution

> Events are an API — and most teams ship them with no compiler. Stand up a
> schema registry, encode events with Avro/Protobuf, then *evolve* the contract
> under a fleet of producers and consumers running mixed versions — with zero
> downtime and zero broken consumers. Prove which changes are safe, which are
> not, and why.

| | |
|---|---|
| **Tier** | Lab (event-engineering) |
| **Primary domain** | Event contracts / schema governance |
| **Skills exercised** | Schema registry, Avro/Protobuf, compatibility modes, wire format, serde caching, rolling upgrades, CI contract checks, Go (`hamba/avro`, `linkedin/goavro`, `protobuf`) |
| **Interview sections** | 10 (API design), 11 (messaging), 12 (architecture) |
| **Est. effort** | 3–5 focused days |

---

## 1. Context

You own the `orders` event stream at a company where **40+ services** in **6
languages** consume it. Last quarter a backend team added a non-nullable field
to the `OrderPlaced` event "because it's just a struct change," and three
downstream consumers crashed in a deserialization loop at 02:00 — the analytics
pipeline, the fraud scorer, and the notification fan-out. The post-mortem
conclusion: **the event payload is a public API with no contract enforcement and
no review gate.**

Your job in this lab is to make event schemas a *governed contract*. You will
run a **schema registry** (Confluent Schema Registry, or build a minimal
compatible one), encode events with **Avro and Protobuf**, and then deliberately
evolve schemas — add, remove, rename, retype fields — across a live fleet of
producers and consumers on mixed versions. You will produce a table of *which
change is safe under which compatibility mode*, backed by runs, not by the docs.
And you will prove the registry never becomes the throughput bottleneck.

## 2. Goals / Non-goals

**Goals**
- Run a schema registry and put **compatibility enforcement** in the produce
  path: an incompatible schema registration is *rejected*, not silently accepted.
- Implement the **Confluent wire format** (magic byte `0x00` + 4-byte big-endian
  schema id + payload) and a Go serde with a **schema-id cache** so the registry
  is hit once per schema, not once per message.
- Build a **mixed-version fleet** (N producers, M consumers on different schema
  versions) and survive a rolling upgrade with **zero broken consumers** and
  **zero consumer lag spike** attributable to schema handling.
- Empirically map every change class (add optional, add required, remove, rename,
  retype) to each compatibility mode (`BACKWARD`, `FORWARD`, `FULL`, `*_TRANSITIVE`)
  and state the **upgrade order** (consumers-first vs producers-first) each mode
  forces.
- Replay **historical events written under old schemas** with new code, and read
  new events with old code — both must succeed where the mode promises it.

**Non-goals**
- Building a UI/admin console for the registry — CLI + HTTP is enough.
- Cross-format migration (Avro → Protobuf on the same topic). Pick a format per
  topic; compare them on *separate* topics.
- A full streaming app — the consumer just deserializes and asserts; correctness
  of business logic is out of scope, **contract correctness is the whole point.**

## 3. Functional requirements

1. A **registry** (`cmd/registry` if self-built, else Confluent in compose)
   exposing the standard REST surface: `POST /subjects/{subject}/versions`,
   `GET /schemas/ids/{id}`, `POST /compatibility/subjects/{subject}/versions/{v}`,
   and per-subject compatibility-mode config (`PUT /config/{subject}`).
2. A **producer** (`cmd/producer`) that, given a schema file, registers it (which
   **must pass** the subject's compatibility check), caches the returned id, and
   emits framed records (`magic + id + payload`) to Kafka.
3. A **consumer** (`cmd/consumer`) that reads the 5-byte header, fetches the
   *writer* schema by id (cached), and deserializes against its own *reader*
   schema. On a schema it cannot resolve, it does **not** crash the group — it
   routes to a quarantine path and increments a metric.
4. Both Avro and Protobuf code paths, switchable by topic/flag, over identical
   logical events so the comparison is apples-to-apples.
5. A **CI gate** (`cmd/compat-check` + a Makefile target) that, given a proposed
   schema and the registered latest version(s), exits non-zero on an incompatible
   change *before* merge.
6. A **chaos/upgrade driver** (`cmd/rollout`) that runs a mixed-version fleet and
   performs a rolling upgrade in a chosen order while load is live.

## 4. Load & data profile

- **Topology:** **N = 24 producer** instances and **M = 48 consumer** instances
  (split across ≥2 consumer groups), so a rolling upgrade always leaves old and
  new schema versions live *simultaneously* for minutes, not seconds.
- **Throughput:** sustained **≥ 200k events/s** aggregate on the hot produce path;
  single run ≥ 20 minutes. Event payload ~512 B (an `Order` with ~12 fields, a
  nested `LineItem[]`, and an enum `status`).
- **Schema churn:** at least **6 schema versions** of the `Order` subject created
  during the lab, exercising each change class at least once.
- **Historical corpus:** **≥ 500M events** persisted across ≥3 distinct schema
  versions on disk/topic, for the replay experiment (mix versions within one
  partition so a single consumer pass sees them interleaved).
- **Generator:** `cmd/gen` is deterministic given a seed; it can emit any
  registered schema version on demand so you can synthesize mixed-version streams.

## 5. Non-functional requirements / SLOs

| Metric | Target |
|--------|--------|
| Registry lookup p99 (**warm** schema-id cache) | < 1 ms (in-process cache hit; effectively a map lookup) |
| Registry lookup p99 (**cold**, cache miss → HTTP round-trip) | < 25 ms; must occur **≤ once per schema id per process** |
| Serde + framing overhead on produce hot path | < 8 µs/event median, < 30 µs p99 *over* a raw-bytes baseline; report both |
| Sustained produce throughput with serde + cache on | ≥ 200k events/s aggregate; serde must not be the bottleneck (prove it) |
| Cache-miss amplification under N=24 producers cold-start | Registry QPS bounded by **#processes × #distinct schemas**, not by event rate |
| Broken consumers during a rolling upgrade | **Zero** — `deserialize_errors_total == 0` for any mode-compliant change |
| Consumer lag during rolling upgrade | No sustained rise attributable to schema handling; bounded and recovers |
| Historical replay across schema change | 100% of ≥500M old-format events deserialize with new reader schema (mode-permitting) |

> The point is not a magic latency — it's that the registry sits **off** the hot
> path after warm-up, and that every compatibility claim is backed by a run where
> `deserialize_errors_total == 0` (or a clearly-explained nonzero you predicted).

## 6. Architecture constraints & guidance

- **Registry:** Confluent Schema Registry via `docker-compose` (pin the version),
  **or** a self-built minimal registry. If you self-build, you must implement
  compatibility checking yourself — that *is* the interesting part.
- **Kafka:** 3 brokers, KRaft mode, pinned version. The registry is the subject of
  the lab, not Kafka.
- **Go clients:**
  - Avro: `hamba/avro/v2` (fast, good schema-resolution support) or
    `linkedin/goavro` (canonical, schema-evolution-aware). State which and why.
  - Protobuf: `google.golang.org/protobuf` with generated types; for registry
    integration use the Confluent Protobuf serde framing (message-index prefix).
  - Confluent serde behavior in Go: model it on `confluentinc/confluent-kafka-go`
    serde, but a hand-rolled framing codec is encouraged so you *see* the bytes.
- **Caching:** two caches per process — **schema → id** (write path) and
  **id → parsed schema** (read path). Both unbounded-but-tiny (schemas are few);
  a cold miss is the *only* time you touch the registry. Instrument hit ratio.
- **Instrument with Prometheus:** registry RPS, cache hit ratio, serde latency
  histogram (separate from network), `deserialize_errors_total{subject,reason}`,
  per-consumer reader-schema version, produce throughput, consumer lag.

## 7. Data model

The logical event (rendered in both Avro and Protobuf):

```
Order v1 (Avro):
  { order_id string, account_id long, status enum{PLACED,PAID,SHIPPED},
    amount_cents long, currency string, ts long,
    items array<{ sku string, qty int, price_cents long }> }
```

The wire frame on every Kafka record value (Confluent format):

```
 0        1                 5
 +--------+-----------------+------------------------------------+
 | 0x00   |  schema id (BE) |  Avro/Protobuf-encoded payload     |
 +--------+-----------------+------------------------------------+
 magic    4-byte uint32      (Protobuf adds a varint message-index array here)
```

The registry's subject/version/id model:

```
subjects(subject TEXT, compatibility TEXT)              -- e.g. orders-value, BACKWARD
versions(subject, version INT, schema_id INT)           -- ordered history per subject
schemas(schema_id INT PK, schema_text TEXT, format TEXT)-- global, dedup by canonical form
```

The **writer** schema (id on the wire) and the **reader** schema (compiled into
the consumer) are generally *different versions* — Avro resolves between them.
That gap is the entire game.

## 8. Interface contract

- Registry (Confluent-compatible subset):
  - `POST /subjects/{subject}/versions` → `{ "id": N }` (registers; **409/422** on
    incompatible).
  - `GET /schemas/ids/{id}` → `{ "schema": "...", "schemaType": "AVRO|PROTOBUF" }`.
  - `POST /compatibility/subjects/{subject}/versions/{v}` → `{ "is_compatible": bool }`.
  - `PUT /config/{subject}` `{ "compatibility": "BACKWARD|FORWARD|FULL|...TRANSITIVE" }`.
- Producer/consumer flags: `-format=avro|protobuf`, `-schema=path`,
  `-subject`, `-compat`, `-reader-version`, `-rate`, `-instances`.
- `cmd/compat-check -subject orders-value -proposed new.avsc` → exit 0/1 + a
  human-readable diff of what broke.
- `GET /metrics` → Prometheus exposition on every binary.

## 9. Key technical challenges

- **Keeping the registry off the hot path.** A naive serde fetches the schema per
  message and turns the registry into a single point of throughput collapse. The
  schema-id cache is load-bearing — and a *cold* fleet of 24 producers must not
  stampede the registry. Quantify the with/without-cache delta.
- **Compatibility direction is not intuitive.** `BACKWARD` means *new reader can
  read old data* → upgrade **consumers first**. `FORWARD` means *old reader can
  read new data* → upgrade **producers first**. Getting this backwards is exactly
  how the 02:00 outage happened. You must derive the order, not memorize it.
- **Avro defaults vs Protobuf field presence.** Avro tolerates a *removed* field
  on read only if the reader has a default; "add a required field" is unsafe
  precisely because old data has no value for it. Protobuf's "everything optional,
  field numbers are the contract" model permits different changes — and forbids
  others (reusing a field number is catastrophic). Compare them head-to-head.
- **Mixed-version steady state.** During a rolling upgrade, *both* directions are
  exercised at once: new consumers read old producers' data **and** old consumers
  read new producers' data, for the whole rollout window. Only `FULL` survives
  arbitrary ordering — and that's the trade-off you must articulate.
- **Reading the past.** Historical replay is forward/backward compatibility under
  a microscope: 500M records written by long-dead schema versions must still
  decode with today's reader, or your event log is a liability, not an asset.

## 10. Experiments to run (break it / tune it)

Record before/after numbers for each.

1. **Serde + registry overhead, cache on vs off.** Disable the schema-id cache and
   measure produce throughput, registry RPS, and serde p99; re-enable it. Report
   the throughput cliff and the registry-RPS reduction. **Measure:** events/s,
   registry RPS, serde latency histogram, cache hit ratio.
2. **Cold-fleet stampede.** Cold-start all 24 producers simultaneously against an
   empty cache. **Measure:** peak registry RPS, p99 of first-event latency, and
   confirm steady-state registry RPS ≈ 0 once warm.
3. **Change-class × compatibility-mode matrix.** For each change — *add optional
   field (with default)*, *add required field (no default)*, *remove field*,
   *rename field*, *change type* (e.g. `int`→`long`, `int`→`string`) — attempt to
   register under `BACKWARD`, `FORWARD`, and `FULL`. **Measure:** registration
   accepted/rejected, and then a live read test proving it actually decodes (or
   the exact deserialization error). Fill the matrix from runs, not docs.
4. **Upgrade-order proof per mode.** Under `BACKWARD`, do a rolling upgrade
   **producers-first** (the *wrong* order) and show old consumers breaking; then
   **consumers-first** and show zero errors. Reverse the experiment for `FORWARD`.
   **Measure:** `deserialize_errors_total` over the rollout window for each order.
5. **Mixed-version live rollout.** With N=24/M=48, run a 15-minute rolling upgrade
   under each mode while producing ≥200k/s. **Measure:** error count, lag curve,
   and the duration both versions coexist. Show `FULL` survives arbitrary order.
6. **Avro vs Protobuf head-to-head.** Same logical change set on two topics.
   **Measure:** payload size, serde CPU/latency, and which change classes each
   format permits (e.g. Protobuf field-number reuse vs Avro rename-by-alias).
7. **Historical replay across a schema change.** Replay ≥500M events spanning ≥3
   writer versions through a single new-reader consumer. **Measure:** % decoded,
   error count by writer version, and throughput vs a single-version replay.
8. **CI gate enforcement.** Submit a known-breaking schema through
   `cmd/compat-check` in a Makefile/CI target. **Measure:** non-zero exit, and the
   produced diff naming the offending field — then confirm the registry would also
   have rejected it (defense in depth).

## 11. Milestones

1. Compose up: Kafka (KRaft) + registry; producer/consumer with the 5-byte frame;
   Prometheus + a Grafana board for registry RPS, cache hit ratio, serde latency.
2. Schema-id caches both directions; experiment 1–2 (overhead + stampede) with
   numbers; prove registry is off the hot path warm.
3. Compatibility matrix (experiment 3) for Avro; `cmd/compat-check` + CI gate
   (experiment 8).
4. Rolling-upgrade order proofs and mixed-version live rollout (experiments 4–5)
   under BACKWARD/FORWARD/FULL.
5. Protobuf path + format bake-off (experiment 6); historical replay (experiment
   7); findings note.

## 12. Acceptance criteria (definition of done)

- [ ] The 5-byte Confluent frame is implemented and decoded from raw bytes (show a
      hexdump of one record annotated: magic, id, payload).
- [ ] Warm registry-lookup p99 < 1 ms and serde overhead reported against a
      raw-bytes baseline; cache hit ratio > 99.99% at steady state.
- [ ] A completed **change-class × mode matrix**, each cell backed by a registration
      result **and** a live decode test (not just "the docs say so").
- [ ] A rolling upgrade in the **correct** order per mode with
      `deserialize_errors_total == 0`, and the **wrong** order shown breaking on
      purpose, both with screenshots.
- [ ] A 15-min mixed-version live rollout at ≥200k/s under FULL with zero broken
      consumers and a flat (recovering) lag curve.
- [ ] Historical replay of ≥500M events across ≥3 writer versions: 100% decode
      under the mode that permits it, with per-version counts.
- [ ] CI gate rejects a breaking change with a useful diff; every number is
      reproducible from a committed command + config.

## 13. Stretch goals

- **Self-built registry** with full compatibility checking (Avro schema resolution
  + Protobuf descriptor diff) and `*_TRANSITIVE` modes; diff it against Confluent's
  verdicts on the same schema pairs.
- **Schema references** (a shared `Address` type referenced by multiple subjects)
  and the compatibility implications of evolving a referenced schema.
- **Soft-delete + alias-based rename** in Avro: show a "rename" done safely via
  `aliases` + default, surviving both directions.
- **Contract testing across repos:** a consumer publishes its *reader* schema; the
  producer's CI checks compatibility against *all* registered reader schemas
  (consumer-driven contracts), not just the latest.
- **Wire-format fuzzing:** feed truncated/garbage frames and prove the consumer
  quarantines rather than crashes (DLQ tie-in to lab `events/05`).

## 14. Evaluation rubric

| Dimension | Senior bar | Staff bar |
|-----------|-----------|-----------|
| Compatibility modes | Knows backward/forward/full exist | Derives the **upgrade order** each forces and proves it with a broken-then-fixed rollout |
| Wire format | Uses a serde library | Implements + reads the magic-byte/id frame from raw bytes; explains schema-id resolution |
| Hot-path performance | Adds a schema-id cache | Proves the registry is off the hot path; quantifies cache-on/off cliff and bounds cold-fleet RPS |
| Change safety | Knows "add required = bad" | Produces the full change×mode matrix from runs; explains Avro defaults vs Protobuf field-number semantics |
| Format judgment | Can use Avro or Protobuf | Recommends one per use case with measured size/CPU/evolution trade-offs |
| Evolution under load | Survives a single rollout | Survives mixed-version live rollout + 500M-event historical replay; defends FULL's cost |
| Communication | Clear findings note | Could defend the matrix and the outage post-mortem to a staff panel |

## 15. References

- Confluent: "Schema Registry Concepts", "Schema Evolution and Compatibility",
  and the wire-format spec (magic byte + schema id framing).
- Avro spec — schema resolution rules (reader vs writer schema, defaults, aliases).
- Protocol Buffers — "Updating A Message Type" (field numbers, reserved, presence).
- `hamba/avro`, `linkedin/goavro`, `google.golang.org/protobuf`,
  `confluentinc/confluent-kafka-go` (serde framing) docs.
- *Designing Data-Intensive Applications* — Ch. 4 (encoding & evolution).
- See also: `Interview Question/10-api-design/` (events-as-API, versioning,
  contract evolution) and `Interview Question/11-messaging-and-event-streaming/`
  (schema registry, compatibility, replay).
