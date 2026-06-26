# Practical Type-System Patterns — Professional Level

> **Focus:** Applying these patterns at system scale — across service boundaries, in long-lived codebases, in teams. Migration strategy, the cost model, organizational tradeoffs, and war stories where a type either saved a release or where over-typing sank one.

> **Topic:** [Practical Type-System Patterns](README.md)

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
13. [Summary](#summary)

---

## Introduction

> Focus: **Where do these patterns pay off across a whole system and a whole team — and what is the real, fully-loaded cost of adopting them in a codebase that already exists, that ships daily, and that twenty other people maintain?**

By now the patterns are clear: illegal states unrepresentable, parse-don't-validate, newtypes, smart constructors, typestate, phantom types. The junior-through-senior pages established *what* and *how*. This page is about *where, when, how much, and at what cost* — the decisions you make as the person responsible for an architecture, not just a function.

At system scale, new forces appear that don't exist in a single file:

- **Boundaries are everywhere.** Every HTTP handler, every queue consumer, every DB read, every gRPC call is a place where typed and untyped worlds meet. "Parse at the boundary" stops being a slogan and becomes an *architectural layer* — and you have to decide where that layer lives and who owns it.
- **The type is a contract across teams.** When your `Money` type or `UserId` newtype crosses a service boundary, it must survive serialization, versioning, and a team that didn't read your design doc. The type's guarantee is only as strong as its weakest deserialization path.
- **Migration, not greenfield.** You almost never get to design the perfect type model from scratch. You inherit a million lines of `any`, nullable-everything, and string-typed ids, and you have to improve it *incrementally* without halting feature work.
- **The cost is organizational.** A clever type isn't free even if it compiles instantly — it costs every future reader's comprehension, every onboarding engineer's ramp, every refactor's risk. The fully-loaded cost includes people, not just CPU.

> 🎓 **Why this matters for a professional:** Your leverage is no longer the bugs *you* prevent — it's the bugs *the whole org* can no longer write. A well-placed newtype at a service boundary can eliminate a category of incident across every team that consumes your API, for years. But a misjudged typestate API can become the thing everyone files tickets to work around. The professional skill is portfolio management: investing type-system effort where the risk-adjusted return is highest, and explicitly *declining* to over-invest where it isn't.

---

## Prerequisites

- **Required:** Fluency with every pattern from the junior through senior pages.
- **Required:** Experience owning a service or library with external consumers.
- **Required:** Having done at least one incremental migration of a real codebase (typing, lint, framework, etc.).
- **Helpful:** Exposure to gradual typing (TS `strict` rollout, Python `mypy`, Sorbet for Ruby), and to schema/codegen tooling (OpenAPI, protobuf, GraphQL).
- **Helpful:** Having been on call for an incident caused by a type-shaped bug (null, wrong-id, unvalidated input).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Boundary layer** | The architectural layer (DTOs, deserializers, request parsers) where untyped external data becomes typed domain values, and vice versa. |
| **Anti-corruption layer (ACL)** | A boundary that translates an external system's model into your clean internal model, preventing their concepts from leaking in. |
| **Gradual typing** | Adding/strengthening types incrementally in an existing codebase rather than all at once. |
| **`strict` rollout** | Enabling stricter type checking (e.g. TS `strictNullChecks`) file-by-file or with a ratchet so it never regresses. |
| **Ratchet** | A CI mechanism that prevents new violations while tolerating existing ones, so the count only goes down. |
| **Codegen** | Generating types/clients from a schema (OpenAPI, protobuf, GraphQL SDL) so the wire contract and the types can't drift. |
| **Cost model** | The fully-loaded cost of a type technique: design time, read time, onboarding, refactor friction, build time, error-message legibility. |
| **Misuse-resistance** | The degree to which an API makes incorrect use impossible or hard, as opposed to merely documented as wrong. |
| **Type-level contract** | A guarantee expressed in a type that crosses a team or service boundary and must hold on both sides. |
| **Smart constructor at the edge** | Routing all deserialized data through validating constructors so even internal/DB data is re-parsed into valid domain types. |

---

## Core Concepts

### 1. The boundary layer is an architecture, not a habit

In a single file, "parse at the boundary" means one `parseEmail` call. In a system, it's a *layer*: a ring around your domain core where every piece of external data is parsed into rich types and every outbound value is serialized. The discipline:

- **Inbound:** raw `unknown`/`[]byte`/JSON → validate/parse → domain types (`UserId`, `Email`, `Money`, validated DTOs). Nothing untyped crosses inward.
- **Core:** operates only on rich domain types. No `any`, no raw strings-with-meaning, no defensive re-validation.
- **Outbound:** domain types → serialized wire formats at the edge.

This is the hexagonal/ports-and-adapters idea, but the *enforcement* is the type system: if your core functions only accept `Email`, no un-parsed string can reach them, structurally. The boundary becomes the single place validation lives, which means the single place to audit, test, and reason about untrusted data.

### 2. Types as cross-team contracts

A `Money` newtype that prevents `cents + dollars` is wonderful inside one service. Across a boundary, it faces new threats:

- **Serialization erases the type.** On the wire, `Money` is just a number. The receiving service must *re-parse* it into its own `Money`; if it doesn't, the guarantee ends at the boundary.
- **Schema drift.** If two services hand-maintain their own `Money` type, they drift. Use **codegen from a shared schema** (protobuf, OpenAPI, GraphQL) so the wire contract is the single source and both sides' types are generated from it.
- **Versioning.** Adding a sum-type case (a new event kind) is safe *within* a codebase (exhaustiveness flags every handler) but *dangerous* across versions — an old consumer doesn't know the new case. Plan for "unknown case" handling at boundaries even when your local exhaustiveness check is green.

The lesson: **the type guarantee is local; the boundary must reconstruct it.** Design boundaries assuming the other side has no idea about your types.

### 3. Migration: the ratchet, not the rewrite

You inherit `any`-everywhere and nullable-everything. You cannot stop the world to fix it. The professional move is the **ratchet**:

1. Turn on the stricter check (e.g. TS `strictNullChecks`) but *grandfather* existing violations (`// @ts-expect-error`, allowlist, baseline file).
2. Make CI **fail on new violations** while tolerating old ones. The count can only decrease.
3. Pay down the baseline opportunistically — every time you touch a file, fix its violations.

The same pattern works for introducing newtypes (start at the highest-risk ids — money, auth tokens, the id that's been mixed up before), for `mypy`/Sorbet adoption, for `any` elimination. **Strengthen monotonically.** Never let the codebase regress; let it improve as a side effect of normal work.

### 4. The cost model: what a type really costs

A type technique's cost is not just "does it compile." Account for:

| Cost | Description |
|------|-------------|
| **Design time** | Thinking through the FSM / invariants. One-time, but real. |
| **Read time** | Every future reader pays to understand it. Multiplied by team size and code lifetime. |
| **Onboarding** | New engineers must learn the pattern before they can be productive in that area. |
| **Refactor friction** | A clever type can make a change that *should* be small require touching many type definitions. |
| **Build time** | Heavy type-level computation (recursive conditional types) slows CI for everyone. |
| **Error legibility** | Cryptic type errors cost debugging time across the whole team. |

The return is **incidents prevented × their cost × number of consumers × code lifetime.** Invest where that product is large (auth, money, public APIs, high-traffic protocols). *Decline* to invest where it's small (internal throwaway code, rapidly-changing prototypes). This is the metaprogramming "when not to" wisdom applied at portfolio scale: cleverness is capital, and you allocate it.

### 5. Misuse-resistance as an API quality

The best APIs make the wrong thing *impossible*, the next-best make it *hard*, the worst make it *documented as wrong* (everyone ignores docs). Typestate and newtypes move APIs up this ladder. When you own a library that hundreds of callers use, every wrong-state call you make impossible is an incident that can never happen, in code you'll never see. This is the highest-leverage place to spend type effort — at the chokepoints many teams depend on. A single well-typed `Transaction` handle that can't be committed twice prevents that bug org-wide forever.

### 6. Know when the simpler thing wins

At scale, the failure mode flips: juniors under-type; seniors sometimes *over*-type. A professional explicitly chooses *not* to encode something in types when:

- The rule changes faster than the type can be maintained.
- The type's error messages would cost more debugging time than the bug it prevents.
- The team lacks the fluency to maintain it, creating a bus-factor-of-one.
- A runtime check plus a test communicates the constraint more clearly to more people.

Choosing the runtime check here is not a failure of skill — it's the skill. The goal is shipped, maintainable, correct software, not maximal type cleverness.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Boundary layer** | Customs at a border: everything entering is inspected and stamped once; inside the country, you move freely without re-inspection. |
| **Anti-corruption layer** | A translator at a negotiation who converts the other party's terms into yours, so their jargon never confuses your team. |
| **Ratchet migration** | A socket wrench that only turns one way — the bolt tightens with every motion and never loosens. |
| **Type as cross-team contract** | A shipping container's ISO standard: it survives transfer between truck, ship, and crane because every party reconstructs the same interface. |
| **Cost model / portfolio** | An investment portfolio: you allocate limited capital (cleverness) to the highest risk-adjusted returns, and decline low-return bets. |
| **Misuse-resistance** | Child-proof caps: the *wrong* way to open is engineered to be hard, so a whole population of accidents never happens. |
| **Over-typing sinking a release** | Gold-plating a bridge so heavily it's too expensive to finish and too rigid to adapt when the river shifts. |

---

## Mental Models

### The "guarantee ends at the wire" model

Every type guarantee is local to one process's memory. The moment a value is serialized — to JSON, protobuf, a DB column — its type is gone; it's bytes. At every boundary you must *re-parse* to re-establish the guarantee, and you must assume the sender is malicious or buggy. Draw your system as islands of strong typing connected by untyped wires; the parsing layer is the bridge guard on each island. A guarantee you don't reconstruct at the boundary is a guarantee you don't have.

### The "improvement as a monotonic function" model

In a long-lived codebase, don't think in terms of "is it perfectly typed?" Think in terms of *direction*: is the type safety monotonically increasing? A ratchet that never regresses, applied over a year of normal feature work, transforms a codebase more reliably than any heroic rewrite — which usually stalls. Your job is to install the ratchet and keep the gradient pointing up, not to reach the summit in one leap.

### The "cleverness is a shared bank account" model

The team has one account of comprehension capital. Every clever type withdraws from it; every clear, conventional type leaves it untouched. Withdraw for the bets that prevent expensive, likely incidents (auth, money, public API). Don't drain the account on internal code where a comment and a test would do. When the account is overdrawn, velocity collapses: PRs stall in review, refactors get abandoned, and people route around the "scary" modules. Manage the balance.

---

## Code Examples

### TypeScript — a boundary layer that parses inbound and serializes outbound

```ts
// domain/types.ts — rich types the core uses
type UserId = number & { readonly __b: "UserId" };
type Email  = string & { readonly __b: "Email" };
interface User { id: UserId; email: Email; name: string }

// boundary/parse.ts — the ONLY place raw data becomes domain types
function parseUserId(n: unknown): UserId | null {
  return typeof n === "number" && Number.isInteger(n) && n > 0 ? (n as UserId) : null;
}
function parseEmail(s: unknown): Email | null {
  return typeof s === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s) ? (s as Email) : null;
}
function parseUser(raw: unknown): User | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const id = parseUserId(r.id), email = parseEmail(r.email);
  if (!id || !email || typeof r.name !== "string") return null;
  return { id, email, name: r.name };
}

// http/handler.ts — boundary in action
async function createUserHandler(body: unknown): Promise<Response> {
  const user = parseUser(body);
  if (!user) return badRequest("invalid user payload");
  await core.saveUser(user);   // core only ever sees a valid User
  return ok();
}
```

`core.saveUser` accepts `User`, so no unparsed payload can reach it. All validation lives in `boundary/parse.ts` — one place to audit and test.

### TypeScript — re-parsing across a service boundary (the guarantee ends at the wire)

```ts
// Service A serializes Money as a plain number; Service B must re-parse it.
type Cents = number & { readonly __u: "Cents" };
function parseCents(n: unknown): Cents | null {
  return typeof n === "number" && Number.isInteger(n) && n >= 0 ? (n as Cents) : null;
}

// In Service B's deserializer:
const amount = parseCents(jsonFromServiceA.amountCents);
if (amount === null) throw new ProtocolError("bad amount from Service A");
// only now do we hold a Cents in Service B's type world
```

### Codegen — single source of truth across teams (protobuf sketch)

```proto
// money.proto — the shared contract, owned by neither consumer
message Money {
  int64 amount_cents = 1;
  string currency = 2;   // ISO 4217
}
```

Both services generate their `Money` type from this `.proto`. Neither hand-maintains it, so they cannot drift. Local newtype wrappers can still be layered on top of the generated type inside each service for added safety.

### Ratchet migration — strengthening monotonically (TS config + CI)

```jsonc
// tsconfig.json — turn the check ON
{ "compilerOptions": { "strictNullChecks": true } }
```

```ts
// Grandfather existing violations explicitly so CI is green today:
function legacy(u: User | null) {
  // @ts-expect-error: pre-existing null unsafety, tracked in TYPING-DEBT.md
  return u.name;
}
```

CI fails on any *new* `strictNullChecks` violation; old ones are tagged and burned down when files are touched. The unsafety count only ever decreases.

### Rust — smart constructor at the deserialization edge

```rust
#[derive(serde::Deserialize)]
struct RawOrder { quantity: i64, email: String }

struct Order { quantity: Quantity, email: Email }   // domain types with invariants

impl TryFrom<RawOrder> for Order {
    type Error = ParseError;
    fn try_from(raw: RawOrder) -> Result<Self, ParseError> {
        Ok(Order {
            quantity: Quantity::new(raw.quantity).ok_or(ParseError::Quantity)?,
            email:    Email::parse(&raw.email).ok_or(ParseError::Email)?,
        })
    }
}
```

`serde` deserializes the *raw* shape; `TryFrom` is the boundary that re-establishes invariants. The rest of the service handles only `Order`, never `RawOrder`.

---

## Pros & Cons

| Aspect | Pros | Cons |
|--------|------|------|
| **System-wide bug prevention** | A boundary newtype eliminates a bug class across every consumer, for years. | Requires discipline to keep *all* boundaries parsing; one leaky deserializer breaks the guarantee. |
| **Cross-team contracts** | Codegen from a shared schema stops type drift between services. | Schema/codegen tooling is infrastructure to build and maintain. |
| **Migration** | The ratchet improves a codebase monotonically during normal work, no rewrite. | Slow; the baseline of debt lingers for a long time. |
| **Misuse-resistance** | Chokepoint APIs made un-misusable prevent org-wide incidents. | Over-applied at a chokepoint, a bad type becomes an org-wide friction everyone fights. |
| **Cost control** | Explicit cost model directs effort to highest-ROI spots. | Requires saying "no" to clever types people *want* to write — political cost. |
| **Onboarding** | Conventional patterns ramp new hires fast. | Heavy type machinery raises the ramp and creates bus-factor risk. |

---

## Use Cases

- **Service boundaries:** parse inbound payloads into domain types; re-parse cross-service values; codegen shared contracts.
- **High-risk domains org-wide:** money, identity/auth, PII, anything where a wrong value is an incident — invest type effort heavily here.
- **Chokepoint libraries:** an internal SDK or client used by many teams is the highest-leverage place for typestate/newtype misuse-resistance.
- **Legacy hardening:** ratchet `strictNullChecks`/`mypy`/Sorbet onto an existing codebase; introduce newtypes for the ids that have caused incidents.
- **Event/message schemas:** discriminated unions for events, with explicit unknown-case handling at version boundaries.

**Decline to invest** when: the code is a short-lived prototype; the domain rules are still churning weekly; the team can't maintain the technique; or a runtime check plus a test communicates the rule to more people more clearly.

---

## Coding Patterns

### Pattern 1: ports-and-adapters with type-enforced core

Core functions accept only domain types. Adapters (HTTP, queue, DB) own the parse/serialize. The compiler enforces that nothing untyped reaches the core.

### Pattern 2: `TryFrom`/`parse` at every deserializer

Never let `serde`/`JSON.parse`/ORM rows produce domain types directly. Always route through a validating conversion that can fail loudly.

### Pattern 3: codegen the wire, wrap locally

Generate types from the shared schema; layer thin local newtypes on top for in-process safety. Single source of truth on the wire, extra safety in the core.

### Pattern 4: the CI ratchet

Baseline existing violations; fail on new ones; burn down on touch. Apply to null-safety, `any` count, untyped boundaries.

### Pattern 5: unknown-case handling at version boundaries

For sum types that cross versions, include a default/`unknown` branch at the boundary even though local exhaustiveness would otherwise forbid it — old consumers must survive new cases.

```ts
switch (event.type) {
  case "created": return onCreated(event);
  case "deleted": return onDeleted(event);
  default:        return onUnknownEvent(event);  // forward-compat at the wire
}
```

---

## Best Practices

- **Make the boundary a real, owned layer.** One place parses inbound, one place serializes outbound. Audit it; test it hard; keep the core free of `any`.
- **Re-parse at every wire crossing.** Treat all deserialized data — even from your own DB or sister services — as untrusted until a smart constructor blesses it.
- **Codegen shared contracts.** Don't hand-maintain the same DTO in two services. Generate from one schema so drift is impossible.
- **Migrate with a ratchet, never a freeze.** Strengthen monotonically as a side effect of normal work; don't bet on a big-bang rewrite.
- **Spend cleverness where the ROI is highest.** Auth, money, public APIs, chokepoint libraries. Explicitly economize elsewhere.
- **Budget for error legibility and build time.** Before shipping heavy type machinery, check the error message a teammate will see and the compile time it adds.
- **Write down the typing debt.** A tracked baseline turns vague "we should type this someday" into a burn-down with ownership.
- **Say no to type gold-plating.** The professional move is sometimes a runtime check and a test. Optimize for shipped, maintainable correctness — not maximal type theater.

---

## Edge Cases & Pitfalls

- **The leaky boundary.** One deserializer that skips parsing (a quick `as User` cast, an ORM mapping straight to domain types) silently voids the whole-system guarantee. Audit for casts at boundaries; they're where guarantees die.
- **Cross-version sum-type breakage.** Local exhaustiveness gives false confidence: it proves *your* code handles every case *it knows*, not that an old deployed consumer handles a *new* case. Always design unknown-case handling into wire protocols.
- **Schema/codegen drift when hand-edited.** Engineers editing generated files defeats codegen. Mark generated files read-only / lint against manual edits.
- **Ratchet erosion.** If `// @ts-expect-error` or allowlists grow instead of shrink, the ratchet is broken. Track the count in CI; alert if it rises.
- **Over-typed chokepoint backfire.** A too-clever shared SDK type forces every consuming team to fight the compiler; they file tickets, copy-paste workarounds, or fork. A bad type at a chokepoint scales the *cost*, not just the benefit.
- **Serialization of newtypes.** A `UserId(u64)` must serialize as a bare value and round-trip through re-parsing. Misconfigured serde/JSON wrappers can emit `{"UserId": 7}` and break consumers.
- **Performance of validation at scale.** Parsing every field of every high-QPS request has a cost. Profile; some hot paths need streamlined validators or schema-compiled validators (e.g. compiled JSON schema) rather than ad-hoc regexes.
- **The bus factor of cleverness.** A powerful type only one person understands is a single point of failure for the whole module. If that person leaves, the module freezes. Prefer patterns the team can collectively maintain.

---

## Summary

- At system scale, "parse, don't validate" becomes an **architectural boundary layer**: inbound raw data is parsed into rich domain types in one owned place, the core operates only on typed values, and outbound values are serialized at the edge. The compiler enforces that nothing untyped reaches the core.
- **Every type guarantee is local to a process.** It ends at the wire. Across service boundaries you must *re-parse* deserialized data — even from your own DB and sister services — and treat it as untrusted. Use **codegen from a shared schema** so cross-team types can't drift.
- **Cross-version sum types** are dangerous even when local exhaustiveness is green; design explicit unknown-case handling into wire protocols so old consumers survive new cases.
- **Migrate with a ratchet, not a rewrite:** turn on the stricter check, grandfather existing violations, fail CI on new ones, and burn the baseline down during normal work. Type safety increases monotonically.
- The **cost model** of a type technique includes design time, read time, onboarding, refactor friction, build time, and error legibility — multiplied across team size and code lifetime. The return is incidents-prevented × cost × consumers × lifetime.
- **Misuse-resistance** at chokepoint libraries is the highest-leverage place to spend type effort: a wrong-state call you make impossible is an incident that can never happen across every consuming team.
- The professional **judgment** runs both ways: juniors under-type, seniors sometimes over-type. Decline to encode rules in types when they churn fast, when error messages cost more than the bug, when the team can't maintain the pattern, or when a runtime check plus a test communicates better. Cleverness is shared capital — allocate it to the highest risk-adjusted returns and *say no* to gold-plating. Optimize for shipped, maintainable correctness.
