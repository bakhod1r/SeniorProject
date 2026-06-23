# Architecture Patterns — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [Layered Architecture: Origins](#layered-architecture-origins)
3. [Hexagonal Architecture: Cockburn (2005)](#hexagonal-architecture-cockburn-2005)
4. [Onion Architecture: Palermo (2008)](#onion-architecture-palermo-2008)
5. [Clean Architecture: Martin (2012)](#clean-architecture-martin-2012)
6. [What the Sources Agree On](#what-the-sources-agree-on)
7. [What the Sources Differ On](#what-the-sources-differ-on)
8. [Mapping the Sources to Go](#mapping-the-sources-to-go)
9. [References](#references)

---

## Introduction

There is no formal language specification for any of these architecture patterns. They live in articles, books, and blog posts. This file is a careful, paraphrased reference to the *original* sources, plus the points where Go practice has diverged from the source.

No verbatim quotes are used. Every paraphrase is faithful to the source's intent; if you need the exact wording, consult the citations in the [References](#references) section.

For deeper individual treatments see [`../../19-architecture-patterns/`](../../19-architecture-patterns/).

---

## Layered Architecture: Origins

Layered architecture has no single inventor. It descends from:

- **Edsger Dijkstra's "THE" multiprogramming system (1968).** Often cited as the earliest formal layered architecture in software, with a strict bottom-up dependency rule.
- **Trygve Reenskaug's MVC (1979).** A three-layer separation of model, view, and controller for interactive systems.
- **Pattern-Oriented Software Architecture, vol. 1 (Buschmann et al., 1996).** Catalogues "Layers" as a named pattern with explicit consequences.

### What the pattern says (paraphrase)

Decompose the system into a stack of horizontal slices, each providing services to the slice immediately above and consuming services from the slice immediately below. Strictly, a layer interacts only with the layer directly below it; in the "relaxed" form, a layer may interact with any layer below it. The defining rule is that no layer interacts with a layer above it.

### Typical four-layer division

1. **Presentation.** User-facing input/output: HTTP handlers, CLI, GUI.
2. **Application.** Use-case orchestration; coordinates the lower layers to fulfil a request.
3. **Domain.** Business rules and entities.
4. **Infrastructure.** Persistence, messaging, external services.

The number of layers is not fixed. Three- and five-layer variants exist; the *direction* of dependencies is what matters.

---

## Hexagonal Architecture: Cockburn (2005)

Alistair Cockburn introduced the pattern in an article titled *Hexagonal Architecture* on his personal site in 2005. It also goes by the more descriptive name *Ports and Adapters*.

### What Cockburn proposed (paraphrase)

A system has an "inside" — the application — and an "outside" — every external system that drives it or that it drives. The application defines abstractions ("ports") that describe how it communicates across this boundary. Each port is implemented by one or more "adapters" — concrete pieces of code that translate between the port's API and the external technology.

The hexagon shape is *incidental*: Cockburn chose six sides because it allowed the diagram to depict multiple ports clearly, not because any system has exactly six ports.

### Two kinds of ports

- **Driving (input) ports.** The interfaces the outside calls *into* the application through. Their adapters are HTTP servers, CLI parsers, message-queue listeners.
- **Driven (output) ports.** The interfaces the application calls *out through*. Their adapters are database clients, message-queue publishers, third-party API clients.

### The architectural promise

Because every external system is mediated by an adapter, the application logic can be tested with stub or in-memory adapters and can be redeployed against a different technology without changing the core. Replacement of an adapter does not change the inside.

### Note on terminology drift

Some later authors use "primary" and "secondary" instead of "driving" and "driven." The semantics are identical.

---

## Onion Architecture: Palermo (2008)

Jeffrey Palermo published a three-part blog series titled *The Onion Architecture* in 2008.

### What Palermo proposed (paraphrase)

Concentric rings, with dependencies flowing only inward:

1. **Domain Model** (innermost) — entities and value objects, the business's central abstractions.
2. **Domain Services** — operations on the domain model that span multiple entities or that are themselves domain concerns.
3. **Application Services** — use cases / orchestration; coordinates domain services and infrastructure to fulfil application-level requests.
4. **Infrastructure / UI / Tests** (outermost) — everything that is not domain.

### The dependency rule (paraphrase)

Source-code dependencies point only toward the centre. The domain model knows nothing of any other ring. Application services may depend on domain services, which may depend on the domain model. The outer ring depends on whatever it needs from the inner rings; no inner ring depends on it.

### What is distinctive about onion

The explicit *Domain Services* ring. Layered architecture has no dedicated home for cross-entity domain logic; it tends to land in "service" classes that mix orchestration with rules. Onion gives that logic a separate ring, which makes the domain layer richer and the application layer thinner.

### Onion vs MVC vs N-tier (Palermo's framing, paraphrased)

Palermo positioned onion explicitly as an alternative to traditional N-tier ("data layer at the bottom, UI on top"). His objection to N-tier: putting data at the bottom forces the domain to depend on persistence, which inverts the proper direction.

---

## Clean Architecture: Martin (2012)

Robert C. Martin (*Uncle Bob*) introduced "The Clean Architecture" in a blog post in 2012, and elaborated it in his 2017 book *Clean Architecture: A Craftsman's Guide to Software Structure and Design*.

### What Martin proposed (paraphrase)

Concentric rings, with the **dependency rule**: source-code dependencies point only inward. The four canonical rings are:

1. **Entities** (innermost) — enterprise-wide business rules. Generic; not specific to any application.
2. **Use Cases** — application-specific business rules; orchestrate entities to fulfil application operations.
3. **Interface Adapters** — converters between the formats most convenient for use cases and entities, and the formats most convenient for some external agency (controllers, presenters, gateways).
4. **Frameworks and Drivers** (outermost) — frameworks, databases, the web. Glue that connects the inner rings to specific tools.

### The dependency rule (paraphrase)

Source-code dependencies point only inward. Nothing in an inner ring may know anything about an outer ring. In particular, names declared in outer rings — entity types from a database, web framework types — must not be used by inner rings.

### Crossing the boundaries

Where control flow needs to cross *outward* (a use case wanting to call something in a database), Martin invokes the *Dependency Inversion Principle*: the inner ring declares an interface; the outer ring implements it. The arrow of *control* may go outward, but the arrow of *source dependency* still goes inward.

### What is distinctive about clean

Clean explicitly catalogues four standard rings and gives each a precise name (entities, use cases, interface adapters, frameworks). Clean also frames the pattern as a *generalisation* of hexagonal, onion, BCE (boundary-control-entity), and DCI; Martin's claim is that all of these share the dependency rule and differ mostly in vocabulary.

### Use cases as a first-class artifact

Where hexagonal puts the input ports as one role of the core, clean elevates *use cases* to their own ring with a recommended one-class-per-use-case discipline. This is the most visible shape difference in everyday code.

---

## What the Sources Agree On

All four sources, paraphrased and aligned:

- **Business rules belong at the centre.** They do not depend on frameworks, databases, or UI.
- **Dependencies point inward.** The outer-knows-inner rule is universal.
- **Interfaces invert dependencies.** When the centre needs something from the outside, the centre defines an interface; the outside provides an implementation.
- **Adapters are replaceable.** Substituting one external technology for another does not change the centre.
- **Tests run without infrastructure.** The centre is testable in isolation, by construction.

These are the load-bearing claims. The four patterns are largely the same idea filtered through four different vocabularies and four different decade-specific concerns.

---

## What the Sources Differ On

| Question | Layered | Hexagonal | Onion | Clean |
|---|---|---|---|---|
| Number of named rings/layers | typically 3–4 | 2 (core + adapters) | 4 | 4 |
| Are "use cases" a first-class concept? | implicit (in services) | yes (input ports) | yes (application services) | yes (explicit ring) |
| Is "domain services" a separate ring? | no | no | yes | no |
| Where do interfaces live? | with the consumer | in the core (port) | in the inner ring | in the inner ring |
| Picture metaphor | stack | hexagon | onion (rings) | rings |
| Year of formal introduction | mid-1990s (Buschmann) | 2005 | 2008 | 2012 |
| Is the relaxed direction rule allowed? | sometimes | no | no | no |

The differences are real but small. Most are vocabulary and emphasis.

---

## Mapping the Sources to Go

Some source recommendations translate directly to idiomatic Go; some require adaptation.

| Source guideline | Translates directly? | Note |
|---|---|---|
| Outer rings depend on inner rings | yes | Enforced by import graph + tooling |
| Inner ring declares interfaces | yes | Idiomatic Go: interface with consumer |
| One class per use case | partially | "One file per use case" is the Go form |
| Controllers + presenters as separate types | rarely needed | An HTTP handler usually plays both roles |
| DTOs at every boundary | optional | Often unnecessary in Go; entities + `error` suffice |
| Inversion-of-control container | not idiomatic | `main.go` as composition root replaces it |
| Annotation-based dependency injection | not idiomatic | Constructor injection in plain Go |

The Go community has taken the *spirit* of these patterns — the dependency rule, the testable core, the replaceable adapters — and dropped most of the OO-language baggage that came with the original sources. The result is leaner code that achieves the same architectural goals with fewer artefacts.

---

## References

The materials below are *original* sources for the patterns. URLs are not given; titles, authors, and years are accurate and let you find the sources reliably.

- **Layered.**
  - Edsger W. Dijkstra, "The Structure of the 'THE' Multiprogramming System," *Communications of the ACM* (1968).
  - F. Buschmann, R. Meunier, H. Rohnert, P. Sommerlad, M. Stal, *Pattern-Oriented Software Architecture, Volume 1: A System of Patterns* (Wiley, 1996). The "Layers" pattern.
- **Hexagonal.**
  - Alistair Cockburn, "Hexagonal Architecture" (originally on his personal site), 2005. Also reissued as "Ports and Adapters."
- **Onion.**
  - Jeffrey Palermo, "The Onion Architecture," three-part blog series, 2008 (parts 1–3 on his blog).
- **Clean.**
  - Robert C. Martin, "The Clean Architecture," blog post, 2012.
  - Robert C. Martin, *Clean Architecture: A Craftsman's Guide to Software Structure and Design* (Prentice Hall, 2017).
- **Adjacent material.**
  - Eric Evans, *Domain-Driven Design: Tackling Complexity in the Heart of Software* (Addison-Wesley, 2003). The DDD vocabulary that all four patterns borrow from.
  - Vaughn Vernon, *Implementing Domain-Driven Design* (Addison-Wesley, 2013). Practical DDD with hexagonal layout.
  - The Go Modules Reference at `go.dev/ref/mod` for the `internal/` directory rule that Go itself enforces.

For Go-specific deeper treatments of each pattern, see [`../../19-architecture-patterns/`](../../19-architecture-patterns/).

---

[← Professional](professional.md) · [Interview →](interview.md)
