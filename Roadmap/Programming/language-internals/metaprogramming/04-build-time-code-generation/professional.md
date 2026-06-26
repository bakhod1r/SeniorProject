# Build-Time Code Generation — Professional Level

> **Topic:** [Build-Time Code Generation](README.md)
> **Focus:** Owning code generation as organization-wide infrastructure — schema registries, generator toolchain ownership, hermetic and reproducible generation at scale, supply-chain integrity, and the migration of large fleets across generator and schema versions.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Code Examples](#code-examples)
8. [Pros & Cons](#pros--cons)
9. [Use Cases](#use-cases)
10. [Coding Patterns](#coding-patterns)
11. [Best Practices](#best-practices)
12. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)

---

## Introduction

> Focus: **When hundreds of services share schemas and generators, who owns the toolchain, how do you keep generation hermetic and reproducible, and how do you migrate the whole fleet when the generator or schema must change?**

At the professional level, code generation is no longer a per-repo convenience; it is **shared infrastructure** with the same governance demands as a compiler, a package registry, or a CI system. A single `.proto` defines a contract consumed by a Go server, a Java client, a TypeScript frontend, and a mobile app — across teams that deploy independently. The generator that turns that schema into code is a tool every one of those builds depends on. Get the version, the configuration, or the distribution of that generator wrong, and you have a fleet-wide problem: incompatible stubs, broken builds, or a silent wire incompatibility that surfaces as production errors days after a deploy.

The professional owns the *system around* generation: a **schema registry** (a versioned, governed home for IDLs with compatibility enforcement), a **generator toolchain** (pinned, distributed, reproducible — often containerized and run hermetically), the **CI topology** that regenerates and gates on drift and breaking changes, the **supply-chain integrity** of generated artifacts (signing, provenance, SBOM), and the **migration machinery** to roll the whole organization from generator vN to vN+1 without a flag day. These are platform-engineering problems where generated code is the substrate.

This page covers: schema registries and centralized contract governance; hermetic/reproducible generation (Bazel, containerized `protoc`, `buf`); generator version management across a fleet; CI/CD topologies for generation; supply-chain concerns; and large-scale migration patterns (schema version bumps, generator upgrades, mono-repo vs poly-repo distribution of generated code).

> 🎓 **Why this matters at the professional level:** A bad day here is not "my build failed" — it is "every service that depends on the payments schema produced incompatible code after the registry pushed a generator upgrade, and we cannot tell which deploys are affected." Generation at scale is a reliability and supply-chain surface, and owning it is platform work.

---

## Prerequisites

- **Required:** `senior.md` — the codegen/macro/reflection triangle, schema evolution, committed-vs-gitignored as architecture.
- **Required:** Experience operating CI/CD for multiple services and a release/versioning discipline.
- **Required:** Familiarity with at least one hermetic build system (Bazel) or container-based reproducible builds.
- **Helpful but not required:** Exposure to supply-chain tooling (SBOM, signing, provenance/SLSA).
- **Helpful but not required:** Having run a cross-team migration (library major-version bump, API deprecation) before.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Schema registry** | A versioned, governed store for IDLs (`.proto`, OpenAPI, Avro, GraphQL SDL) with compatibility checks and access control. Examples: Buf Schema Registry, Confluent Schema Registry (Avro/Kafka). |
| **Contract governance** | Org-wide rules for who may change a schema, what compatibility is enforced, and how versions are released. |
| **Hermetic build** | A build whose output depends only on explicitly declared, pinned inputs (compiler, generator, sources), reproducible byte-for-byte anywhere. |
| **Reproducible generation** | Running the generator in a way that yields identical output across machines and time (pinned generator + deterministic generator). |
| **Generator determinism** | Whether a generator emits byte-identical output for identical input (no timestamps, no map-iteration nondeterminism). Required for reproducibility. |
| **SBOM** | Software Bill of Materials — an inventory of components in a build artifact, including generators and generated code provenance. |
| **Provenance (SLSA)** | Verifiable metadata about how an artifact (including generated code) was produced and by what toolchain. |
| **Mono-repo distribution** | Generated code lives in one repo with the schema and all consumers — atomic cross-cutting changes. |
| **Poly-repo distribution** | Schema in one repo; generated SDKs published as versioned packages consumed by other repos. |
| **Flag day** | A migration requiring all consumers to switch simultaneously — to be avoided. |
| **Expand-migrate-contract** | A staged migration: add the new shape (expand), move consumers (migrate), remove the old (contract) — avoids flag days. |
| **`buf`** | A protobuf toolchain providing a registry, breaking-change detection, lint, and hermetic generation without managing `protoc` plugins manually. |

---

## Core Concepts

### 1. The Schema Registry — Contracts as Governed Artifacts

At scale, schemas cannot live as loose files in dozens of repos. A **schema registry** makes the IDL a first-class, versioned, governed artifact:

- **Single source of truth, centrally hosted.** The `payments.proto` everyone depends on has one canonical, versioned home.
- **Compatibility enforced at push time.** The registry rejects a schema change that breaks wire compatibility (reused field number, type change) *before* it can affect any consumer — the gate the generator itself never provides.
- **Access control and ownership.** Who may change the payments contract is governed, not implicit.
- **Generation as a service.** Consumers fetch generated code for a pinned schema version (and a pinned generator version) from the registry, rather than each running `protoc` with bespoke plugins.

The registry turns "every team runs their own generator on copied `.proto` files" (chaos, skew, incompatibility) into "one governed contract, compatibility-gated, with reproducible generation." This is the single highest-leverage structural change for generation at scale.

### 2. Hermetic, Reproducible Generation

Reproducibility means: the *same* schema + the *same* pinned generator produces *byte-identical* output, anywhere, any time. Two requirements:

1. **A pinned, hermetic generator.** The generator (and every plugin) is version-locked and supplied as a declared build input — via Bazel's build graph, a pinned container image, or a tool like `buf` that bundles the toolchain. No reliance on whatever `protoc` happens to be on the developer's `PATH`.
2. **A deterministic generator.** The generator must emit identical bytes for identical input — no embedded timestamps, no nondeterministic map iteration ordering the output, no absolute paths. A nondeterministic generator makes reproducibility and drift checks impossible (every run "differs"). Mature generators document and guarantee determinism.

Bazel is the archetype: `proto_library` + language rules make the schema a declared input, the generated code a declared output, and the generator a pinned tool in the build graph — generation is incremental, cached, and hermetic by construction. Outside Bazel, the common pattern is **containerized generation**: a pinned image with the exact generator+plugins, run identically in CI and locally.

### 3. Generator Version Management Across a Fleet

A generator upgrade (e.g. a new `protoc-gen-go` major) can change generated output — new APIs, renamed symbols, different defaults. Across hundreds of consumers this is a coordinated migration, not a `bump-and-pray`:

- **Pin centrally, roll deliberately.** The registry/platform owns the blessed generator version; consumers do not each pick their own.
- **Canary the upgrade.** Regenerate a few representative services with vN+1, build and test them, before rolling fleet-wide.
- **Decouple generator upgrades from schema changes.** Never change the schema *and* bump the generator in the same step — you cannot tell which caused a difference.
- **Diff the generated output across generator versions** as part of the upgrade review, not just the schema diff.

Version skew (`senior.md`) at fleet scale is not a churning diff — it is *incompatible generated code across services*, which is a production incident waiting to happen.

### 4. CI/CD Topologies for Generation

Three common topologies, each with trade-offs:

```text
  A. GENERATE-IN-EACH-BUILD (gitignored)
     schema ──▶ each CI build runs the pinned generator ──▶ compile
     + DRY, no committed artifacts   − every build needs the toolchain; slower

  B. COMMIT-AND-DRIFT-CHECK
     schema ──▶ author regenerates + commits ──▶ CI drift-check gates staleness
     + zero-setup clones, fast builds, auditable   − two-step authoring, diff noise

  C. PUBLISH-AS-PACKAGES (registry/poly-repo)
     schema ──▶ registry generates + publishes versioned SDKs ──▶ consumers depend on a version
     + clean consumers, explicit versioning, decoupled rollout   − registry infra, lag between schema and SDK
```

At scale, **C (publish generated SDKs as versioned packages)** is the mature pattern for cross-team contracts: a service depends on `payments-client@2.3.0`, upgrades on its own schedule, and the schema/generator infrastructure is owned by a platform team. **B** remains common within a repo; **A** suits hermetic mono-repos (Bazel).

### 5. Supply-Chain Integrity of Generated Code

Generated code is *executable code in your supply chain*, produced by a tool — so it inherits supply-chain risk:

- **Provenance.** Record which generator (name, version, hash) produced which artifact, so an SBOM/SLSA attestation covers generated code, not just hand-written code.
- **Integrity of the generator itself.** A compromised generator (or a malicious plugin) can inject code into *every* artifact it produces — a high-value supply-chain target. Pin by content hash, fetch from trusted registries, verify signatures.
- **Reproducibility as a security control.** If generation is reproducible, an auditor can independently re-run it and confirm the committed/published generated code matches the schema — detecting tampering.
- **Committed generated code aids audit.** Reviewers and scanners see exactly what ships; gitignored generated code is invisible until build time, which complicates audit.

The mental shift: the generator is a privileged build component with write access to your binary, and must be governed like one.

### 6. Mono-Repo vs Poly-Repo Distribution

Where generated code lives shapes how cross-cutting schema changes propagate:

- **Mono-repo:** schema, generated code, and all consumers in one repo. A schema change and its consumer updates land in *one atomic commit* — no version negotiation, no flag day, instant fleet-wide consistency. Cost: requires a mono-repo and (usually) a hermetic build (Bazel) to scale.
- **Poly-repo + published SDKs:** schema in one repo; generated SDKs published as versioned packages; consumers upgrade independently. Cost: version negotiation, lag, the **expand-migrate-contract** dance for breaking changes — but teams deploy on their own schedule and ownership is clean.

Most large organizations run **poly-repo with a schema registry and published SDKs**, because independent deployment outweighs atomic consistency; the very largest (Google-style) run mono-repos where atomic schema migrations are the norm.

### 7. Large-Scale Migration Patterns

Migrating a schema across a fleet without a flag day uses **expand-migrate-contract**, the same staged pattern as a zero-downtime database migration:

1. **Expand:** add the new field/method/version *additively* (new protobuf field number, new API version). Old and new coexist; nothing breaks. Regenerate; all consumers still compile.
2. **Migrate:** move consumers to the new shape, one team/service at a time, on their own schedule.
3. **Contract:** once telemetry confirms no consumer uses the old shape, remove it and `reserve` the field number.

This works precisely *because* generation makes the contract explicit and compatibility-checkable — the registry can gate each step, and the generated code makes "who still uses the old field" answerable.

---

## Real-World Analogies

**The schema registry is a standards body.** It owns the canonical spec, enforces backward compatibility, and licenses conformant implementations (generated SDKs). Individual teams do not fork the standard; they consume a governed version.

**Hermetic generation is a sealed clean-room.** The same inputs and the same equipment produce the same output every time, anywhere — and you can audit the room to prove no contamination entered.

**Fleet generator upgrades are a software recall with staged rollout.** You do not swap the part in every vehicle overnight; you canary it, watch for failures, then roll it out in waves.

**Expand-migrate-contract is replacing a bridge while traffic flows.** Build the new span alongside the old (expand), reroute traffic lane by lane (migrate), demolish the old span only when it is empty (contract).

---

## Mental Models

**Model 1 — "The generator is privileged build infrastructure."** Treat it like the compiler and the package registry: pinned, governed, reproducible, supply-chain-secured. It has write access to your binaries.

**Model 2 — "Schemas are products with consumers."** A widely-used schema is a published contract with a compatibility guarantee and a version, not a file. Govern it accordingly.

**Model 3 — "Reproducibility is the lever for both reliability and security."** Deterministic, hermetic generation makes drift checks meaningful, migrations diffable, and tampering detectable — all from one property.

**Model 4 — "Migrate in stages; never declare a flag day."** Expand-migrate-contract is the only way to change a shared contract across independently-deployed consumers without an outage.

---

## Code Examples

### Example 1: `buf` registry-based hermetic generation

```yaml
# buf.gen.yaml — pinned plugins, reproducible output, no local protoc-plugin management.
version: v2
plugins:
  - remote: buf.build/protocolbuffers/go:v1.34.2   # version-pinned, hermetic
    out: gen/go
  - remote: buf.build/grpc/go:v1.4.0
    out: gen/go
```

```bash
buf generate            # runs pinned remote plugins reproducibly
buf breaking --against 'buf.build/acme/payments'   # fleet-wide compatibility gate
```

The generator toolchain is pinned by version and run hermetically; compatibility is gated against the registry's canonical version.

### Example 2: Provenance for generated code in CI

```yaml
- name: Generate
  run: buf generate
- name: Record provenance
  run: |
    echo "generator=protocolbuffers/go:v1.34.2" >> gen/PROVENANCE
    echo "schema_commit=$(git rev-parse HEAD)"   >> gen/PROVENANCE
    echo "generated_at=reproducible"             >> gen/PROVENANCE
```

The SBOM/attestation now covers *how* the generated code was produced, not just that it exists.

### Example 3: Bazel hermetic proto generation

```python
# BUILD — schema is a declared input, generated code a declared output,
# the generator a pinned tool in the build graph.
proto_library(name = "payments_proto", srcs = ["payments.proto"])

go_proto_library(
    name = "payments_go_proto",
    proto = ":payments_proto",
    importpath = "acme/payments",
)
```

Generation is incremental, cached, and reproducible by construction; the generator version is part of the workspace, not the developer's `PATH`.

### Example 4: Fleet generator-upgrade canary

```bash
# Regenerate a representative service with the candidate generator,
# build + test it, and DIFF the generated output before fleet rollout.
PROTOC_GEN_GO=v1.35.0 buf generate --path services/canary
git diff --stat gen/                 # inspect generated-output delta
go test ./services/canary/...        # confirm behavior unchanged
```

Generator upgrades are migrations, canaried like any other.

### Example 5: Expand-migrate-contract on a shared schema

```proto
// EXPAND: add the new field additively; old consumers unaffected.
message Payment {
  uint64 amount_cents = 1;          // legacy
  Money  amount       = 2;          // new richer type, NEW number
  // MIGRATE consumers from amount_cents -> amount over time.
  // CONTRACT (later): remove amount_cents and `reserved 1;`
}
```

---

## Pros & Cons

### Pros

- **A schema registry gives org-wide compatibility enforcement** the generator alone cannot provide.
- **Hermetic, reproducible generation makes drift checks, migrations, and audits sound.**
- **Published-SDK distribution lets teams deploy independently** while sharing one contract.
- **Provenance + reproducibility turn generated code into an auditable, tamper-evident supply-chain artifact.**
- **Expand-migrate-contract enables breaking changes across a fleet without a flag day.**

### Cons

- **Registry + hermetic toolchain is real platform infrastructure** to build and operate.
- **Fleet generator upgrades are coordinated migrations**, not version bumps.
- **A nondeterministic generator silently defeats reproducibility** and every check built on it.
- **The generator is a high-value supply-chain target** — compromise propagates to every artifact.
- **Poly-repo SDK distribution adds version-negotiation lag** between schema and consumers.

---

## Use Cases

- **Cross-team API/wire contracts at scale:** schema registry + published SDKs (Buf, Confluent).
- **Hermetic mono-repos:** Bazel-driven generation with atomic cross-cutting schema changes.
- **Regulated/audited environments:** committed, reproducible, provenance-tracked generated code.
- **Independent-deploy microservice fleets:** versioned generated SDKs + expand-migrate-contract.
- **Streaming/event platforms:** Avro/Confluent registry enforcing producer/consumer compatibility.

---

## Coding Patterns

**Pattern: Centralize the contract in a registry; consume pinned versions.** No team forks or copies the canonical schema.

**Pattern: Make generation hermetic and deterministic.** Pinned, containerized/Bazel-driven generator; assert byte-stable output.

**Pattern: Distribute generated code as versioned SDKs across a poly-repo.** Consumers depend on a version and upgrade on their schedule.

**Pattern: Gate every schema change on a breaking-change check at push.** Compatibility is enforced before consumers are affected.

**Pattern: Treat generator upgrades as canaried, staged migrations** decoupled from schema changes.

**Pattern: Attach provenance to generated artifacts** so the SBOM/attestation covers them.

---

## Best Practices

1. **Host shared schemas in a governed registry with push-time compatibility enforcement.**
2. **Make generation hermetic, pinned, and deterministic** — Bazel or containerized toolchains; assert reproducibility.
3. **Distribute generated code as versioned SDKs** for independently-deployed consumers; mono-repo + atomic only where the build supports it.
4. **Roll generator upgrades as canaried migrations**, decoupled from schema changes, diffing generated output.
5. **Use expand-migrate-contract for every breaking schema change**; never a flag day.
6. **Secure the generator supply chain** — pin by hash, verify signatures, record provenance.
7. **Own generation as a platform service**, not a per-repo afterthought.

---

## Edge Cases & Pitfalls

**A nondeterministic generator.** Map-iteration ordering or embedded timestamps make every run differ; drift checks fire constantly and reproducibility is impossible. Fix the generator (or its config) to be deterministic, or pin it and normalize output.

**Coupling a generator upgrade with a schema change.** When output changes, you cannot attribute it. Always separate the two commits.

**Registry compatibility gate bypassed.** A team copies the `.proto` locally and regenerates, skipping the registry's compatibility check, and ships an incompatible change. Enforce that generation flows through the registry.

**Published-SDK version lag.** The schema changed but the generated SDK is not yet published, so consumers are stuck or pin an old version. Automate SDK publication on schema merge.

**Generator supply-chain compromise.** A malicious plugin injects code into every generated artifact — invisible if generated code is gitignored and unaudited. Pin by hash, verify, and prefer committed + reproducible for audit.

**Mono-repo migrations that touch thousands of files.** An additive schema change regenerates a huge swath; review tooling must collapse generated diffs or reviewers drown. Configure generated-file diff suppression.

**Contract phase skipped.** Old fields are never removed because no one confirms they are unused; schemas bloat for years. Use telemetry to drive the contract step.

---

## Cheat Sheet

| Concern | Professional answer |
|------|------|
| Where do shared schemas live? | A governed schema registry with push-time compatibility checks. |
| How is generation reproducible? | Pinned + deterministic generator, run hermetically (Bazel/container). |
| How is generated code distributed? | Versioned SDKs (poly-repo) or atomic mono-repo with hermetic build. |
| How do generator upgrades happen? | Canaried, staged migrations, decoupled from schema changes. |
| How do breaking schema changes ship? | Expand-migrate-contract — never a flag day. |
| Why is the generator a security concern? | It writes code into every artifact; pin, verify, record provenance. |
| What makes drift checks/migrations sound? | Deterministic, reproducible generation. |
| Who owns it? | A platform team — generation is shared infrastructure. |

---

## Summary

At professional scale, build-time code generation is **shared infrastructure** governed like a compiler or package registry. A **schema registry** makes IDLs versioned, access-controlled, and — crucially — *compatibility-gated at push time*, supplying the enforcement the generator itself never does. **Hermetic, deterministic generation** (Bazel, containerized `protoc`, `buf`) is the foundation that makes drift checks, migrations, and audits sound; a nondeterministic generator silently defeats all of them. Generated code is distributed either via an atomic **mono-repo** or, more commonly, as **versioned SDKs across a poly-repo**, letting teams deploy independently. The generator is **privileged supply-chain infrastructure** with write access to every artifact, so it must be pinned by hash, verified, and provenance-tracked. Fleet-wide change is staged, never a flag day: **generator upgrades are canaried migrations decoupled from schema changes**, and **breaking schema changes use expand-migrate-contract**, gated at each step by the registry. The unifying idea: generation at scale is a reliability and supply-chain surface, and owning the registry, the toolchain, the CI topology, and the migration machinery — not just running `protoc` — is the platform engineer's job.

---

## Further Reading

- The Buf Schema Registry documentation and `buf breaking`/`buf lint` model.
- Confluent Schema Registry compatibility modes (Avro/Kafka) — the same governance idea for streaming.
- Bazel's `proto_library` and language `*_proto_library` rules for hermetic generation.
- SLSA provenance and SBOM standards as applied to generated artifacts.
- Reproducible-builds.org on deterministic toolchains.
- `interview.md` and `tasks.md` in this folder to consolidate and practice.
