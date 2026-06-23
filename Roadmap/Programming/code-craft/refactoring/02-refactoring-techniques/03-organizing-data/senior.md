# Organizing Data — Senior Level

> Architecture, schema co-evolution, identity strategies, and how data shape decisions ripple across services.

---

## Table of Contents

1. [Data shape as architecture](#data-shape-as-architecture)
2. [Identity at scale: ID strategies](#identity-at-scale-id-strategies)
3. [Schema co-evolution](#schema-co-evolution)
4. [Bounded context boundaries and data shape](#bounded-context-boundaries-and-data-shape)
5. [Encapsulation across service boundaries](#encapsulation-across-service-boundaries)
6. [Choosing reference vs. value at API boundaries](#choosing-reference-vs-value-at-api-boundaries)
7. [Type-driven design](#type-driven-design)
8. [Tooling: codemods, schema migrators, type generation](#tooling-codemods-schema-migrators-type-generation)
9. [Anti-patterns at scale](#anti-patterns-at-scale)
10. [Review questions](#review-questions)

---

## Data shape as architecture

The shape of your domain data **determines** what code is easy:

- A `String email` makes "search by partial email" easy and "verify domain" awkward.
- An `Email` object makes verification natural, but case-insensitive matching needs care.
- A `List<Order>` on `Customer` makes "loyalty status" trivial, but "5M orders per customer" forces a query.

A senior's lens: **data shape is the architecture's bones**. Changing it is the most expensive refactoring; getting it right is the most valuable.

### The diagram

```
Data shape
    │
    ▼
Operations easy on it
    │
    ▼
Code patterns that emerge
    │
    ▼
Architecture
```

Replace `String email` with `Email` and the architecture pivots — validation moves out of services, becomes a property of the type.

---

## Identity at scale: ID strategies

When `Change Value to Reference` happens at scale, the choice of ID strategy is an architecture decision.

| Strategy | Pros | Cons | Use when |
|---|---|---|---|
| **Auto-increment integer** | Compact, fast, indexable | Single-master DB; reveals scale; order leaks | Single-DB applications |
| **UUID v4** | Distributed, no coordination | Random insertion = poor B-tree locality, larger PKs | Distributed systems, multi-region |
| **UUID v7** (timestamp-prefixed) | Distributed + sortable | Larger than int; precision varies | Modern distributed systems |
| **Snowflake (Twitter)** | 64-bit, time-ordered, distributed | Requires worker-id coordination | High-throughput systems |
| **Hash of content** | Deterministic, content-addressable | No identity (same content = same id) | Git, IPFS, CDN |
| **Composite (tenant_id, local_id)** | Tenant isolation natural | Joins more complex | Multi-tenant SaaS |

### When ID strategy interacts with refactoring

`Change Value to Reference` requires picking an ID. Wrong choice cascades:
- Auto-increment that gets exposed in URLs reveals customer count.
- UUID v4 in an indexed column tanks insert performance at scale.
- Composite ID without proper schema makes ORM mappings painful.

> **Senior heuristic:** start with UUID v7 unless you have a reason. Time-ordered, distributed, sortable, no coordination.

---

## Schema co-evolution

When you reshape a class (Replace Data Value with Object, Replace Type Code with Class, etc.), the database schema must evolve in lockstep.

### Patterns

#### Expand-Contract (a.k.a. parallel-change)

Already covered in middle.md. The default for live systems.

#### Versioned schema

Each version of the table has its own table or column set. Code reads/writes the latest, with translators for legacy versions.

#### Event sourcing

The "shape" is the stream of events; current state is a fold over events. Reshape = add new event types, leave old events intact, evolve fold function.

#### CQRS

Separate read and write models. Reshape one without touching the other.

### Tooling

- **Liquibase, Flyway** — migration scripts in version control.
- **Atlas, Bytebase** — declarative schema with diff-based migrations.
- **Avro / Protobuf with schema registry** — for streams/Kafka.
- **GraphQL schema versioning** — with deprecation.

---

## Bounded context boundaries and data shape

Two services may have different shapes for "the same" concept:

- Marketing's `Customer`: name, email, preferences.
- Billing's `Customer`: id, billing_address, tax_id, payment_methods.
- Shipping's `Customer`: id, shipping_address, recent_packages.

These are **not the same Customer**. Pretending they are creates a god type that no team owns.

### Strategy

- Each bounded context has its own `Customer` type (and table).
- Shared identity via `customer_id`.
- Translate at the boundary (Anti-Corruption Layer).

### When refactoring

Replace Data Value with Object across services means **picking which context owns the canonical type** — and exposing translators for others. Don't accidentally couple the contexts.

---

## Encapsulation across service boundaries

`Encapsulate Field` makes sense within a class. Across services, the equivalent is **API design**:

- A REST endpoint exposes only the fields it should.
- Internal IDs stay internal; external IDs may be different (UUIDs vs. internal ints).
- `Encapsulate Collection` becomes "expose pagination, not the full list."

### DTO patterns

```
Domain object: full state, internal fields.
API DTO: filtered, possibly aliased.
Persistence entity: schema-shaped.
Event payload: stable, versioned.
```

A senior decoupling step: each layer gets its own type. Mapping between them (via MapStruct, ModelMapper, or manual) is a boundary, not a leak.

---

## Choosing reference vs. value at API boundaries

Inside a service, an entity is a reference. Across the API, it serializes to its ID + a payload. The payload is a value (snapshot at request time).

### Implication

- API consumers shouldn't expect their `Customer` payload to live-update. It's a snapshot.
- Internal code shouldn't return entities through APIs — return DTOs.
- Returning entities through Spring's `@RestController` automatically serializes them, often leaking internal fields.

### Rule

> Entities live on the server. Values cross the wire.

---

## Type-driven design

Modern languages with rich type systems (Rust, Haskell, TypeScript with brand types, Kotlin's value classes) let you encode invariants in types:

```rust
struct Email(String);
impl Email {
    fn new(s: &str) -> Result<Email, ValidationError> {
        if !s.contains('@') { return Err(...); }
        Ok(Email(s.to_string()))
    }
}
```

Once you have an `Email`, it's valid by construction. No runtime check needed downstream.

```typescript
type Email = string & { readonly __brand: unique symbol };
function makeEmail(s: string): Email | null {
    return s.includes("@") ? (s as Email) : null;
}
```

Brand types give you compile-time distinction without runtime cost.

### Why this matters for refactoring

When you Replace Data Value with Object in a type-rich language, the new type **carries proofs** of validity. You're not just renaming — you're enforcing invariants at compile time.

In Java pre-records, this was expensive (boilerplate). With records + Bean Validation:

```java
public record Email(@Pattern(regexp = ".+@.+") String value) {}
```

Validation at construction; type-safe everywhere.

---

## Tooling: codemods, schema migrators, type generation

### Codemods for shape changes

Renaming a field across 200 files: `ast-grep`, `comby`, `jscodeshift`, `OpenRewrite`. The codemod is the safe way to do bulk Encapsulate Field.

### Schema generation

- OpenAPI → client/server stubs.
- GraphQL → typed clients.
- Protobuf → multi-language types.

When you change the canonical schema, regenerated stubs propagate the shape change to every consumer in lockstep — *if* the build pipeline is wired to do so.

### Type-driven test generation

`fast-check` (TypeScript), `Hypothesis` (Python), `jqwik` (Java) — generate inputs based on type. When you Replace Type Code with Class, property tests run with the new type and verify invariants automatically.

---

## Anti-patterns at scale

### 1. The God Object Document

A single MongoDB collection / Postgres jsonb field that holds the whole domain. "Schemaless" was a mistake; you have a schema, it's just implicit.

### 2. Anemic domain model

Lots of `Encapsulate Field` but no behavior. Classes are just bags of getters/setters. The domain logic lives in services. (See [Couplers — Feature Envy](../../01-code-smells/05-couplers/junior.md).)

### 3. Reference all the things

Every value type became an entity. Now you have a `Currency` table, a `Color` table, a `BloodType` table. Joins everywhere. Stick with enums for closed sets.

### 4. Global registry singletons

`Customer.named(name)` returns a process-global singleton. Tests pollute each other; concurrency races. Use a repository, not a static cache.

### 5. Bidirectional everything

ORM tutorials encourage bidir; production discovers the cost. Drop bidirectional unless used both ways.

### 6. Type code zombie

Replaced int constants with an enum, but the database column is still `INT`. Now you have two systems of record. Migrate the schema or write a strict converter at the boundary.

---

## Review questions

1. Why does data shape determine architecture?
2. Compare UUID v4, UUID v7, and Snowflake IDs.
3. What's expand-contract, and why is it the default for schema migrations?
4. How does an Anti-Corruption Layer relate to Replace Data Value with Object across services?
5. Why should DTOs differ from domain objects?
6. What does "entities live on the server, values cross the wire" mean?
7. How does type-driven design (Rust newtype, TypeScript brand types) compare to Java's class wrappers?
8. What's the "Type Code Zombie" anti-pattern?
9. Why is "reference all the things" a problem?
10. When does a closed set deserve an enum vs. a table?
