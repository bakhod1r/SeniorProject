# Design Patterns

> *"Design patterns are typical solutions to common problems in software design. Each pattern is like a blueprint that you can customize to solve a particular design problem in your code."*

---

## What Are Design Patterns?

A **design pattern** is a reusable, named solution to a recurring problem in software design. It is not a finished piece of code — it's a description of *how* to solve a problem in many different situations.

### Pattern vs Algorithm vs Library

| Concept | What it is | Granularity |
|---|---|---|
| **Algorithm** | A precise, deterministic recipe (e.g., quicksort) | Low-level, language-agnostic logic |
| **Design Pattern** | A high-level blueprint for a solution | Mid-level, must be implemented for each context |
| **Library / Framework** | Concrete reusable code | High-level, ready to use |

Two engineers implementing the same pattern can produce very different code, but they will recognize each other's structure and intent.

---

## A Brief History

| Year | Event |
|---|---|
| **1977** | Christopher Alexander (architect) publishes *A Pattern Language* — patterns for buildings and towns. Software pioneers borrow the idea. |
| **1987** | Kent Beck and Ward Cunningham apply patterns to Smalltalk UI development. |
| **1994** | The **"Gang of Four"** — Erich Gamma, Richard Helm, Ralph Johnson, John Vlissides — publish *Design Patterns: Elements of Reusable Object-Oriented Software*. This book defines the canonical 23 patterns. |
| **2004** | *Head First Design Patterns* makes the GoF accessible to a wider audience. |
| **Today** | Patterns remain a shared vocabulary — the foundation of communicating design across teams. |

This roadmap covers all **23 patterns** from the GoF book. The *Interpreter* pattern — omitted on refactoring.guru — is included here because it remains conceptually important (regex engines, SQL `WHERE` evaluators, mini DSLs, rule engines) and is the natural dual of *Visitor*.

---

## The Categories

The GoF book organizes patterns by **intent** — the kind of problem they solve.
This roadmap keeps the three classic GoF categories and adds a fourth for
**concurrency patterns** (POSA), which solve the same kind of object-level design
problem in multithreaded code.

```mermaid
graph TD
    DP[Design Patterns]
    DP --> C[Creational<br/>5 patterns<br/>How objects are created]
    DP --> S[Structural<br/>7 patterns<br/>How objects are composed]
    DP --> B[Behavioral<br/>11 patterns<br/>How objects communicate]
    DP --> X[Concurrency<br/>11 patterns<br/>How objects coordinate threads]
```

| Category | Concern | Pattern Count | Examples |
|---|---|---|---|
| **[Creational](01-creational/README.md)** | Object creation mechanisms | 5 | Singleton, Factory Method, Builder |
| **[Structural](02-structural/README.md)** | Object composition / structure | 7 | Adapter, Decorator, Proxy |
| **[Behavioral](03-behavioral/README.md)** | Object communication / responsibilities | 11 | Strategy, Observer, Interpreter |
| **[Concurrency](04-concurrency-patterns/README.md)** | Thread coordination / safe sharing | 11 | Thread Pool, Producer-Consumer, Future/Promise |

---

## Why Design Patterns Matter

> *"Patterns are a toolkit of solutions to common problems in software design. They define a common language that helps your team communicate more efficiently."*

Concretely, patterns help you:

1. **Speak a shared language** — saying "use a Strategy here" conveys structure, intent, and tradeoffs in two words
2. **Avoid reinventing wheels** — proven solutions, battle-tested for decades
3. **Reason about design** — patterns make consequences (coupling, extensibility) explicit
4. **Read other people's code** — once you recognize the pattern, you understand the architecture
5. **Onboard juniors** — pattern names are searchable; "what is a Decorator?" gets a clear answer

### Cautions

- **Don't shoehorn patterns into a problem** — a pattern is a tool, not a goal
- **Adding a pattern always adds complexity** — apply only when the gain (flexibility, decoupling, clarity) outweighs the cost
- **Some patterns are language-specific anti-patterns** — e.g., Singleton in test-heavy code; Visitor in dynamically-typed Python
- **Modern languages reduce the need for some patterns** — Python's first-class functions remove the need for Command/Strategy in many cases

---

## How to Pick a Pattern (Decision Guide)

Ask the question that matches your situation:

| Question | Look at |
|---|---|
| *"How do I create this object without coupling to its concrete class?"* | **Creational** — Factory Method, Abstract Factory, Builder |
| *"How do I make incompatible interfaces work together?"* | **Structural** — Adapter |
| *"How do I add behavior to an object without subclassing?"* | **Structural** — Decorator, Proxy |
| *"How do I work with a tree of objects uniformly?"* | **Structural** — Composite |
| *"How do I substitute an algorithm at runtime?"* | **Behavioral** — Strategy, State |
| *"How do I notify multiple objects when something happens?"* | **Behavioral** — Observer |
| *"How do I undo an action?"* | **Behavioral** — Command + Memento |
| *"How do I traverse a collection without exposing its internals?"* | **Behavioral** — Iterator |
| *"How do I avoid a tangle of mutual references?"* | **Behavioral** — Mediator |

---

## Pattern Relationships

Many patterns are related, complementary, or contrasting. A few key contrasts to keep in mind early:

| Often Confused | Difference |
|---|---|
| **Strategy vs State** | Strategy: client picks the algorithm. State: state transitions are managed internally. |
| **Decorator vs Proxy** | Decorator: adds behavior. Proxy: controls access (lazy, security, remote). |
| **Decorator vs Adapter** | Decorator: same interface, more behavior. Adapter: different interface, same behavior. |
| **Factory Method vs Abstract Factory** | Factory Method: one product, subclass decides. Abstract Factory: family of products, swap whole family. |
| **Facade vs Mediator** | Facade: one-way simplification. Mediator: many-to-many coordination. |
| **Command vs Memento** | Command: encapsulates an action. Memento: encapsulates a state snapshot. |

---

## Patterns Catalog (master index)

This is the single entry point for **every** pattern in the repo, across all
abstraction levels. Object-level patterns live here; architectural patterns and
language-specific techniques live at their pedagogically correct home and are
linked below — so you get one catalog without duplicating content or mixing
altitudes.

### Object-level patterns (here)

- **[Creational](01-creational/README.md)** — Factory Method, Abstract Factory, Builder, Prototype, Singleton
- **[Structural](02-structural/README.md)** — Adapter, Bridge, Composite, Decorator, Facade, Flyweight, Proxy
- **[Behavioral](03-behavioral/README.md)** — Chain of Responsibility, Command, Iterator, Mediator, Memento, Observer, State, Strategy, Template Method, Visitor, Interpreter
- **[Concurrency](04-concurrency-patterns/README.md)** — Active Object, Monitor Object, Reactor, Proactor, Thread Pool, Producer-Consumer, Future/Promise, Half-Sync/Half-Async, Leader-Followers, Double-Checked Locking, Balking
- **[Other (GoF-adjacent)](05-other-patterns/)** — [Type Object](05-other-patterns/01-type-object/) · **Null Object** → kept with its sibling [Special Case](../coding-patterns/01-control-flow/03-null-object/junior.md) in control-flow patterns

### Architectural patterns (system altitude → Architecture)

Higher-altitude patterns that shape whole systems, not single objects. They live
in the Architecture progression (architectural principles → styles → patterns →
enterprise patterns), not here:

- **[Architectural Patterns](../../../Architecture/software-design-architecture/08-architectural-patterns/)** — Layered, Hexagonal/Ports-and-Adapters, MVC/MVP/MVVM, Microkernel, Pipe-and-Filter, …
- **[Architectural Styles](../../../Architecture/software-design-architecture/07-architectural-styles/)** — monolith, microservices, event-driven, serverless
- **[Enterprise Patterns](../../../Architecture/software-design-architecture/09-enterprise-patterns/)** — Repository, Unit of Work, Service Layer, DTO
- **[Clean Architecture](../../../Architecture/clean-architecture/)** · **[DDD](../../../Architecture/ddd/)**

### Dependency Injection (principle + language idiom)

DI is a *technique* for applying the Dependency Inversion Principle; its concrete
form is language-specific, so it lives with the principle and the languages:

- **Principle:** [SOLID · Dependency Inversion (DIP)](../design-principles/04-solid/05-dip-dependency-inversion/)
- **Go idiom:** [Go · Dependency Injection](../../languages/golang/06-code-organization/06-dependency-injection/) *(full content)*
- **Java idiom:** [Java · Dependency Injection](../../languages/java/10-dependency-injection/)

---

## Further Reading

- **GoF book** — *Design Patterns: Elements of Reusable Object-Oriented Software*, Gamma, Helm, Johnson, Vlissides (1994)
- **Head First Design Patterns** — Freeman & Robson (highly recommended for beginners)
- **Refactoring.Guru** — [refactoring.guru/design-patterns](https://refactoring.guru/design-patterns)
- **Pattern-Oriented Software Architecture (POSA)** — five-volume series; covers patterns beyond GoF (concurrency, distribution, integration)

**See also:**
- [Refactoring Roadmap](../refactoring/README.md) — code smells and the techniques that resolve them.
- [Coding Anti-Patterns](../anti-patterns/README.md) — the recognized *wrong* solutions at code/design level; the negative catalog to this positive one.
- [Architecture Anti-Patterns](../../../Architecture/anti-patterns/README.md) — the same idea at the system level (Big Ball of Mud, Distributed Monolith, …).
