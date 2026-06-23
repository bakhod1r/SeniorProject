# Domain-Driven Design

The **architecture-level** answer to "how do we split this system?" — bounded contexts, ubiquitous language, and the strategic/tactical patterns that align software structure with the business domain rather than with technology layers.

> Content under this section is being filled in. The structure below shows the planned coverage; pages marked _coming soon_ link to themselves until written.

---

## Planned sections

- **[Strategic Design](01-strategic-design/)** — bounded contexts, context maps, ubiquitous language, subdomain classification (core / supporting / generic).
- **[Tactical Design](02-tactical-design/)** — entities, value objects, aggregates, repositories, domain events, factories, services.
- **[Anti-Corruption Layer](03-anti-corruption-layer/)** — protecting a clean model from legacy or third-party concepts; translation layers between contexts.
- **[Hexagonal Architecture](04-hexagonal-architecture/)** — ports and adapters; isolating the domain model from delivery and persistence concerns.
- **[Event Storming](05-event-storming/)** — collaborative modelling technique; discovering aggregates and bounded contexts from domain events with stakeholders in the room.

---

## Why this lives in Architecture, not Programming

DDD is about how a *system* is sliced — the seams between services, modules, and teams. The actual code-level techniques (rich domain models, anemic vs. behaviour-rich entities, repository interfaces) build *on top* of these slices. When the bounded contexts are wrong, no amount of clean code rescues the architecture.

---

## Related

- **[System Design](../system-design/)** — the catalog of architectural patterns; DDD provides the language for *where* to apply them.
- **[Architecture Anti-Patterns](../anti-patterns/)** — Big Ball of Mud, Stovepipe Enterprise, Distributed Monolith — the failure modes DDD's bounded contexts are designed to prevent.
- **[Software Design & Architecture](../software-design-architecture/)** — the broader umbrella of design styles in which DDD lives.

---

## References

- **Domain-Driven Design: Tackling Complexity in the Heart of Software** — Eric Evans (2003) — the founding text ("the Blue Book").
- **Implementing Domain-Driven Design** — Vaughn Vernon (2013) — the practical companion ("the Red Book").
- **Domain-Driven Design Distilled** — Vaughn Vernon (2016) — short overview if the two above are too dense.
- **Patterns, Principles, and Practices of Domain-Driven Design** — Scott Millett & Nick Tune (2015) — with concrete .NET examples.

---

## Project Context

Part of the [Senior Project](../../../index.md) — a personal effort to consolidate the essential knowledge of software engineering in one place.
