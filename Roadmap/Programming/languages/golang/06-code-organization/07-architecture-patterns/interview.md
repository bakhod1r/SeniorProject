# Architecture Patterns — Interview Questions

> Questions ranging from junior to staff level. Each has a model answer, common wrong answers, and follow-up probes. Focus is on the *organization* level: what these patterns mean for Go folder layouts and import graphs.

---

## Junior

### Q1. What does it mean to say a Go service follows "layered architecture"?

**Model answer.** The codebase is split into horizontal slices — typically presentation, application, domain, infrastructure — and each slice imports only from the slice(s) below it. In Go this usually shows up as `internal/handler/`, `internal/service/`, `internal/domain/`, `internal/repo/`, with `cmd/` wiring them.

**Common wrong answers.**
- "It uses MVC." — MVC is a presentation pattern; layered is about the whole stack.
- "It has many packages." — Many packages without a dependency rule is just *many packages*, not layered.

**Follow-up.** *What goes in `internal/domain`?* — Business types and rules. No `database/sql`, no `net/http`, no third-party imports.

---

### Q2. What is a "port" in hexagonal architecture, and how is it represented in Go?

**Model answer.** A port is an interface declared by the application core that defines how the core communicates with the outside world. In Go it is a regular `interface` type, normally placed in a package like `internal/core/port/`. Driving ports describe *how the outside calls in*; driven ports describe *how the core calls out*.

**Common wrong answers.**
- "A port is a function." — A port is the *contract*, not an implementation.
- "A port lives in the adapter package." — The adapter implements the port; it does not declare it.

**Follow-up.** *Who satisfies a port?* — An adapter, e.g. `internal/adapter/secondary/postgres/OrderRepo` satisfies `port.OrderRepository`.

---

### Q3. How does Go's `internal/` directory help with architecture?

**Model answer.** Code under `internal/` can only be imported by packages rooted at the parent directory of that `internal/`. It enforces, at the language level, the outer boundary of the application — no other module can touch your private packages.

**Common wrong answers.**
- "It hides files from the file system." — They are still on disk.
- "It is a convention only." — It is a Go toolchain rule.

**Follow-up.** *What is the difference between `internal/` and `pkg/`?* — `internal/` is private to the module; `pkg/` is meant for external consumers.

---

### Q4. Sketch a hexagonal Go folder tree for a service that has an HTTP API and a Postgres database.

**Model answer.**

```
cmd/api/main.go
internal/
├── core/
│   ├── domain/
│   ├── port/         ← interfaces
│   └── service/
└── adapter/
    ├── primary/http/
    └── secondary/postgres/
```

**Follow-up.** *Add an in-memory adapter for tests.* — `internal/adapter/secondary/memory/` implementing the same port.

---

### Q5. What is the dependency rule in clean architecture?

**Model answer.** Source-code dependencies point only inward. An outer ring may know about an inner ring; an inner ring must know nothing about an outer ring. Concretely, `internal/usecase/` may import `internal/entity/`, but never the other way around.

**Common wrong answer.**
- "Outer rings call inner rings." That describes *control flow*; the dependency rule is about *source-code imports*.

**Follow-up.** *What happens when an inner ring needs to call something in an outer ring?* — The inner ring declares an interface; the outer ring implements it (Dependency Inversion).

---

## Middle

### Q6. When would you choose hexagonal over layered for a Go service?

**Model answer.** When the service has, or will soon have, multiple drivers (HTTP plus a Kafka consumer plus a CLI) or multiple drivees (Postgres plus an in-memory cache plus a remote third-party API) for the *same role*. Hexagonal pays off precisely when there is something to swap. For a one-driver, one-database CRUD app, layered is simpler and equally testable.

**Follow-up.** *Show me the moment in a project's life where you'd flip.* — When the second driver lands and you start passing HTTP types into your business logic to get it to work.

---

### Q7. Where should an interface be declared in idiomatic Go?

**Model answer.** With the *consumer*, not the implementation. An `OrderRepository` interface is declared in the package that calls it (the use case / service / core), not in the package that implements it (the Postgres adapter). Go's structural typing means the implementation does not have to *say* it implements the interface — it just has to have the methods.

**Follow-up.** *Why does this matter for hexagonal?* — Ports are exactly "interfaces declared by the consumer." Putting them in the core is what makes the core independent of the adapter packages.

---

### Q8. How do you wire a hexagonal Go application, and where does the wiring live?

**Model answer.** In `cmd/<binary>/main.go`. That is the only place that imports both the core and the adapter packages. It opens the database, constructs the concrete adapters, and passes them to the core's constructors as interfaces. Avoid `init()` functions for wiring; avoid global state.

```go
db := sql.Open(...)
repo := postgres.NewOrderRepo(db)
svc  := service.NewOrderService(repo)
http.NewHandler(svc).Listen(":8080")
```

**Follow-up.** *What about projects with many constructors?* — Once you have ~30+ constructors, a tool like Google `wire` or `do` saves boilerplate. Below that, plain Go is clearer.

---

### Q9. What is the difference between hexagonal, clean, and onion in practice?

**Model answer.** Mostly vocabulary. The picture is the same: a centre that knows nothing of infrastructure, surrounded by adapters; dependencies point inward. Differences:

- *Hexagonal* talks about ports and adapters — driving and driven.
- *Clean* names four rings — entities, use cases, interface adapters, frameworks — and emphasises *use cases as a first-class artifact*.
- *Onion* names four rings differently — domain model, domain services, application services, infrastructure — and adds a *separate domain-services ring*.

In Go folders, the trees end up nearly interchangeable.

**Follow-up.** *So why did three patterns get invented?* — Different decades, different vocabularies, different OO-language traditions. The *idea* is older than any of them.

---

### Q10. What is a boundary test, and why does it belong in a pattern-following codebase?

**Model answer.** A test that asserts the architectural rule directly — usually by inspecting the import graph. For example, a test that loads `internal/core/domain` with `go/build` and fails if it imports `database/sql`. Boundary tests live with the unit tests, run on every CI pipeline, and survive staff turnover better than READMEs.

**Follow-up.** *What about `depguard` or `go-arch-lint`?* — Same goal, configured in YAML rather than in Go. Both approaches are valid; teams usually have one or the other, sometimes both.

---

### Q11. Where do `cmd/` and `internal/` fit in a hexagonal layout?

**Model answer.** `cmd/<binary>/main.go` is the composition root — wires concrete adapters into ports. `internal/` holds everything that is private to the application: the core (domain, ports, services) and the adapters (primary and secondary). `pkg/` is reserved for code other modules need to import; most application code does not belong there.

**Follow-up.** *Multiple binaries in one module?* — Each gets its own `cmd/<name>/`. They can share `internal/core/` and pull in different primary adapters.

---

### Q12. When should you split by feature instead of by layer?

**Model answer.** When the codebase has grown past a dozen entities and most changes are *vertical* (touching all layers of one feature). Splitting by feature reduces merge conflicts and lets one team own one feature end-to-end. The hybrid — top-level by layer, second-level by feature — usually scales best:

```
internal/core/domain/order/
internal/core/domain/invoice/
internal/core/service/order/
internal/core/service/invoice/
```

**Follow-up.** *What about a monolith with multiple bounded contexts?* — Each context gets its own `internal/<context>/` subtree with its own ring split. Contexts must not import each other's `core/` directly.

---

## Senior

### Q13. A team comes to you with a tangled `internal/` package where the domain imports `database/sql`. What is your incremental refactor plan?

**Model answer.**
1. **Add a boundary test that fails today.** That makes the violation visible and keeps the team from adding more.
2. **Identify the *one* abstraction the domain actually needs from the database.** That is your first port.
3. **Extract the interface; keep the implementation in place.** The domain now imports the port instead of `database/sql`.
4. **Move the implementation to a new `adapter/secondary/postgres/` package.** Update wiring in `main.go`.
5. **Repeat for each remaining leak, one PR per leak.** Each PR is reviewable; the codebase compiles after each.
6. **Once the boundary test passes, freeze it.** Add `depguard` to keep it that way.

**Follow-up.** *How long does this take for a 20 KLOC service?* — A week of one engineer's focused work, plus another week of small follow-ups. Two weeks of one engineer is a reasonable estimate.

---

### Q14. When does an architecture pattern become overhead?

**Model answer.** When the cost of complying with it on every change exceeds the benefit it produces. Signals: every interface has exactly one implementation, DTO conversion code outweighs business code, engineers ask "where does this go?" more than "how should this work?", a one-line semantic change requires touching four packages. The cure is to *delete*: collapse single-impl interfaces, merge layers that always change together, stop generating ceremony files. The senior skill is willingness to subtract.

**Follow-up.** *How do you make that case to a team that adopted clean architecture last year?* — With evidence. Pick three recent features. Show the diff size, the number of files touched, and ask "did the architecture make this easier?"

---

### Q15. How do you keep an architectural rule alive over a codebase's life?

**Model answer.** Three layers:
1. *Documentation.* A short `ARCHITECTURE.md` stating the rule.
2. *Tooling.* `depguard`, `go-arch-lint`, or a custom analyzer that fails the build on violation.
3. *Boundary tests.* Lightweight Go tests that inspect the import graph for the rule directly.

The rule survives staff turnover and reviewer fatigue only when it is checked by tools that do not get tired.

**Follow-up.** *What about exemptions?* — Allow them, audit them. A rule with five permanent exemptions is a rule that should be re-examined.

---

### Q16. How does Go's package system help and hurt these patterns?

**Model answer.**

*Helps.*
- No cyclic imports — a structural violation is a build error.
- `internal/` directory — language-level enforcement of the outer boundary.
- Structural typing — interfaces with the consumer; implementations need not declare conformance.

*Hurts (or rather, does not help).*
- No "module-private" or "package-private to a subtree" beyond `internal/`. Finer rules need tooling.
- No way to say "this interface may have only one implementation in this module." That is on you and your linters.

**Follow-up.** *Does the lack of module-private hurt monorepos?* — In a single Go module, every package can import every other package under `internal/`. Bounded-context isolation is convention plus tooling.

---

### Q17. A junior engineer wants to introduce clean architecture to a small CRUD service. How do you respond?

**Model answer.** "What problem are we solving?" If the service has 5 endpoints, one database, and one team, layered is correct and clean is overhead. If they cannot name a *specific* benefit (e.g., "we're about to add a Kafka consumer that calls the same operations"), the answer is no — for now. Architecture is a cost; clean has more cost than layered. Buy what you need.

**Follow-up.** *What if they push back?* — Pair on the trade-off. Show the *actual* file count of "place an order" under both styles. Often the gut instinct that "clean is better" survives only until the engineer counts files.

---

## Staff

### Q18. Design the architectural enforcement strategy for a 100 KLOC Go monorepo with five bounded contexts.

**Model answer.** Three tiers of enforcement:

1. **Module-level (Go toolchain).** Each context has its own `internal/`. Cross-context imports of `internal/` packages are blocked by the toolchain.
2. **Component-level (`go-arch-lint`).** Each context's `core/`, `port/`, `service/`, `adapter/primary/`, `adapter/secondary/` are declared as components with a dependency-direction rule. The configuration file *is* the architecture diagram.
3. **Project-level rules (custom analyzers).** Cross-context dependencies must go through a published port (in `pkg/`) or via HTTP/gRPC, never via direct import. A custom analyzer flags cross-context `internal/` imports.

Boundary tests live alongside unit tests in each context. CI runs all three tiers; a violation in any tier fails the build.

**Follow-up.** *Could you split out a context as its own service later?* — Yes — that is the point. A context that respects the rules can be extracted into its own module (and eventually its own service) by replacing in-process calls with HTTP/gRPC, *without rewriting the domain*.

---

### Q19. You inherit a Go service that claims to be hexagonal but has 80% of its code in HTTP handlers. What is wrong, and how do you frame the fix?

**Model answer.** "Hexagonal in name only." The pattern's promise is that handlers are thin adapters; logic lives in the core. If the handlers carry the logic, the core is empty and the architecture is decorative — the team has paid the *cost* (extra folders, extra interfaces) without buying the *benefit* (replaceable adapters, testable core).

The fix is not to rewrite. It is to *gradually pull logic into the core* feature-by-feature, starting with the next feature the team builds. Two checks help: a boundary test that the core has any code at all, and a periodic eyeball at the line counts in `adapter/primary/http/` vs `core/service/`.

**Follow-up.** *What if the team disagrees with hexagonal?* — Reverse direction. Drop the `core/`/`adapter/` split, accept layered. Honest layered is better than fake hexagonal.

---

### Q20. A new VP wants every service to use clean architecture. You have ten services; three are 200-line scripts. What do you say?

**Model answer.** Push back politely with evidence. Architecture is a *tool*, not a uniform. Mandating clean for a 200-line script doubles the file count and triples the cognitive cost without producing any benefit. Propose a *guideline*: "Services with >5 KLOC and multi-driver requirements use clean; services below that use layered until they outgrow it." Document the threshold; revisit yearly. Anyone who insists on uniformity over fitness is optimising for org-chart legibility, not engineering velocity.

**Follow-up.** *How do you keep the guideline from drifting into a mandate?* — Periodic architecture review. Three services should explicitly *not* be clean; that fact is a feature.

---

[← Specification](specification.md) · [Tasks →](tasks.md)
