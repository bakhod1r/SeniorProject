# Shotgun Surgery - Professional

> Audience: staff engineers, tech leads, architects working on event-driven systems, microservices, and large monorepos where shotgun surgery scales from a code smell into an organizational drag.

At staff level, shotgun surgery stops being a refactoring puzzle and becomes a systems problem. Fowler in `Refactoring` (2nd ed., ch. 3) defines it crisply: "every time you make a kind of change, you have to make a lot of little changes to a lot of different classes." When that pattern emerges across services, queues, schemas, and CI pipelines, the cost of the next feature does not grow linearly - it grows with the cardinality of co-changed components. This file covers four axes: event evolution, temporal coupling mining, monorepo blast radius, and the platform decisions that prevent shotgun surgery from becoming permanent.

## 1. Event-driven systems amplify shotgun surgery

A monolith with shotgun surgery is painful. An event-driven system with shotgun surgery is dangerous. The reason is that a synchronous monolith fails loudly at compile time when a change is incomplete - a missing branch in a `switch`, an unimplemented method on an interface. Event-driven systems route messages through brokers (Kafka, RabbitMQ, SQS) and decouple producers from consumers at the type system. The compiler never sees the consumers. The shotgun blast lands at runtime, in production, on a consumer the producer team did not know existed.

Three failure modes recur:

**1.1 Schema drift across consumers.** A producer adds a new field to `OrderPlaced`. Some consumers deserialize strictly and reject the message. Others deserialize loosely, ignore the field, and silently process incomplete data. The producer team thinks the change is local; the actual change radius is every consumer subscribed to the topic, every replay job, every analytics pipeline.

**1.2 Versioned event handlers scattered everywhere.** Once a team realizes the broker is a public API, they version events: `OrderPlacedV1`, `OrderPlacedV2`. Now every consumer has parallel handlers. Adding a field requires touching N handlers across M services, plus the upcaster/downcaster, plus the schema registry config, plus the consumer group reset documentation. Classic shotgun surgery, just with YAML and Avro mixed in.

**1.3 Compensating actions duplicated per consumer.** When a saga step fails, each participant needs compensation logic. If the saga is choreographed (no central orchestrator), the compensation rules live in every service, and a business rule change becomes a coordinated multi-PR release. Fowler's prescription - `Move Field` or `Move Function` to consolidate behavior - has no direct equivalent across services, so the smell ossifies.

## 2. Versioning strategies that contain the blast

Schema evolution is the technical answer to shotgun surgery in distributed systems. The strategy matters more than the format.

**Backwards-compatible additive changes.** Add new optional fields, never remove or rename. Avro and Protobuf both support this when the schema registry is configured for `BACKWARD` (new schema can read old data) or `FULL` (both directions). Consumers ignore unknown fields; producers fill defaults for missing ones. This narrows shotgun surgery to producers only.

**Upcasters at the consumer boundary.** Borrowed from Axon Framework. Each consumer keeps a chain of `Upcaster` functions that transform `V1 -> V2 -> V3` before the handler sees the event. New version arrives, you add one upcaster, every handler keeps working. The shotgun is replaced with a single funnel.

**Polymorphic event types via sealed interfaces (Java 17+).**

```java
public sealed interface OrderEvent
    permits OrderPlaced, OrderShipped, OrderCancelled, OrderRefunded {}

public record OrderPlaced(String orderId, BigDecimal total, Instant at)
    implements OrderEvent {}
```

A pattern-matching `switch` on the sealed type fails to compile if a new variant is added without updating the handler. The compiler is now the change-radius detector. This converts a runtime shotgun surgery into a build-time error.

**Schema-first contracts.** Use Avro/Protobuf IDL as the source of truth, generate Java types from it, version the IDL in a repo shared by producer and consumer. Breaking changes become PRs against the schema repo with mandatory cross-team review. The shotgun is replaced with a single gate.

## 3. Mining co-changed files - temporal coupling at architectural scale

Adam Tornhill's `Software Design X-Rays` (Pragmatic, 2018) and the Codescene tool formalized the idea that files which change together are coupled, regardless of whether the static code shows it. The metric is **change coupling**: the percentage of commits in which file A changed that also touched file B. A pair above ~30% over a meaningful window is suspicious; above ~70% is shotgun surgery.

A minimal git log probe to find candidates:

```bash
git log --since="12 months ago" --name-only --pretty=format:"COMMIT" \
  | awk '/^COMMIT/{next} NF{print}' \
  | sort | uniq -c | sort -rn | head -40
```

That gives most-changed files. The harder, more useful query is the pair frequency. A script (Python, ~30 lines) that walks `git log --name-only` per commit, builds pairs, and reports top co-change pairs surfaces the architectural shotguns: the `Order`, `OrderDTO`, `OrderMapper`, `OrderValidator`, `OrderEventV2`, `order_schema.avsc` cluster that always moves together.

Tools that automate this:
- **Codescene** - hosted analysis, builds temporal-coupling graphs, hotspot maps, refactoring targets sorted by ROI.
- **gitqualia / git-of-theseus** - open-source variants for coupling and code-age visualization.
- **CodeMaat** (Tornhill's open-source predecessor to Codescene) - command-line, free, integrates with CI.

What to do with the data: cluster the co-changed files, then either consolidate them into one module (Fowler's `Move Function`, `Inline Class`) or introduce a single facade that the rest of the system talks to (so future changes touch one file, not the cluster).

## 4. Monorepo blast radius - build, test, deploy

In a polyglot monorepo (Bazel, Pants, Nx, Gradle composite), shotgun surgery has a second cost beyond cognitive load: the build graph re-runs. A change in a leaf utility used by 200 targets triggers 200 test runs and 200 container rebuilds. If your CI caches at the target level (Bazel remote cache, Gradle build cache, Turborepo remote cache), a shotgun change invalidates exactly the set of caches it touches - the more files, the worse the cache hit rate, the slower the next build.

Concrete numbers from a real monorepo: a change touching 1 file took 6 min in CI (cache hit on 380 of 400 targets). A change touching 23 files - the same logical refactoring, just spread - took 38 min (cache hit on 60 of 400). The 6x slowdown is shotgun surgery's tax in CI minutes, paid forever, on every retry.

Mitigations:
- **Module boundaries that match change axes.** If "adding a new payment provider" requires touching three modules, merge them or introduce a plugin SPI so new providers ship as a single new file.
- **Bazel `visibility` and Gradle `api`/`implementation`.** Restrict which targets can depend on what, so accidental cross-module references that create coupling are caught in code review.
- **Affected-only test runs.** `nx affected --target=test`, `bazel query 'rdeps(...)'`, `git diff --name-only | xargs gradle --tests`. These do not fix shotgun surgery but stop it from poisoning CI throughput.

## 5. Backwards-compatible event evolution - a worked pattern

A team owns `payments-service`, publishes `PaymentSucceeded` to Kafka, consumed by `ledger`, `notifications`, `analytics`, `fraud`, `loyalty`. Product asks for a new field: `paymentMethod` (CARD, BANK, WALLET).

**Wrong way (shotgun):**
1. Add `paymentMethod` to the Avro schema as required.
2. Coordinate a 5-team release.
3. Every consumer's deserializer breaks until they redeploy.
4. Replay of historical events fails because old events lack the field.

**Right way (single-site change):**
1. Add `paymentMethod` as optional (`union { null, string }`, default `null`).
2. Producer fills the field on new events; old events keep `null`.
3. Consumers that care about the field check for `null` and fall back to a `UNKNOWN` enum.
4. After 30 days of clean traffic, run a one-time backfill that re-emits old events with inferred `paymentMethod` (if the business cares).
5. Only after backfill, change the field to required - one schema-registry PR, zero consumer changes.

The shotgun is replaced with a sequenced rollout where each step is local and reversible.

## Quick rules

1. Sealed interfaces + exhaustive switch turn runtime shotgun into compile-time error.
2. Schema registry with `BACKWARD` compatibility makes consumers tolerant by default.
3. Run `CodeMaat` or equivalent monthly; refactor the top-3 coupled clusters.
4. If a feature touches more than 5 files, ask whether a Facade or Strategy would have collapsed it to 1.
5. Upcasters at consumer ingress beat per-handler version branches.
6. CI minutes per PR is a leading indicator of shotgun surgery; track it.
7. Cross-team coordination cost is the real price - measure PR-cycle-time, not lines changed.
8. Bazel/Gradle `visibility` rules are the only mechanical defense against new coupling.
9. Choreographed sagas accumulate compensating-action shotgun surgery; prefer orchestrated when business rules churn.
10. Mine `git log` before redesigning; the data shows where the surgery actually happens, not where you guess.

## What's next

After this file, the natural progression is to read `specification.md` for the numeric metrics (change coupling thresholds, bidirectional change count, tool calibration), then `find-bug.md` for ten concrete Java scenarios where shotgun surgery hides, then `optimize.md` for the CI and JIT cost angle. The `tasks.md` exercises will let you run `CodeMaat` against a real repo and feel the coupling graph in your own codebase. After this cluster, the next code smell - Feature Envy (file `../07-feature-envy/`) - is the natural counterpart: shotgun surgery is one change across many files; feature envy is one file reaching into many others. Reading them as a pair makes both clearer.

**Memorize this:** Shotgun surgery is a distributed-systems and CI problem before it is a refactoring problem. The fix is not just `Move Function`; it is sealed types, backwards-compatible schemas, change-coupling mining, and module boundaries that match the axes along which the business actually changes.
