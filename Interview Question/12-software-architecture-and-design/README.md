# Software Architecture & Design

> Senior Go backend architecture interview: decomposition styles, Clean/Hexagonal layering, Go-idiomatic design, DDD tactical and strategic patterns, and the trade-off reasoning expected of an architecture owner.

**41 questions** across **8 topics** · Level: senior

## Topics

- [Architectural Styles & Decomposition](#architectural-styles-decomposition) (6)
- [Clean / Hexagonal / Onion Architecture](#clean-hexagonal-onion-architecture) (4)
- [Go-Specific Design](#go-specific-design) (6)
- [DDD Tactical Patterns](#ddd-tactical-patterns) (6)
- [DDD Strategic Design](#ddd-strategic-design) (5)
- [Design Patterns in Go Idiom](#design-patterns-in-go-idiom) (5)
- [Architectural Decisions & Quality](#architectural-decisions-quality) (6)
- [E-commerce & Subscription Domain Modeling](#e-commerce-subscription-domain-modeling) (3)

---

## Architectural Styles & Decomposition

#### 1. When would you choose a modular monolith over microservices for a new product, and what concretely makes a monolith "modular"?

*Difficulty:* 🟡 medium  ·  *Tags:* `monolith`, `microservices`, `modular-monolith`, `decomposition`

Default to a modular monolith for any system whose domain boundaries are still unstable, which is nearly every greenfield product. A monolith is *modular* when each module owns its data and exposes a narrow in-process API, when cross-module calls go through interfaces rather than reaching into another module's tables, and when an `internal/` package boundary (or build constraints) prevents accidental coupling. The win is that boundaries can be refactored in a single compile-checked, atomically-deployed unit with no network, no distributed transactions, and one observability story. You pay for microservices' independent scaling and deployment only when you have evidence you need it: divergent scaling profiles, team autonomy at scale, or independent release cadence. Picking microservices first usually means you draw the boundaries wrong and then pay network cost to move data across a line that shouldn't exist.

**Key points**
- Modular = data ownership per module + narrow interfaces + enforced package boundaries
- Monolith lets you refactor boundaries atomically with the compiler's help
- Choose microservices for divergent scaling, team autonomy, independent deploys — with evidence
- Wrong boundaries are cheap to fix in a monolith, expensive across the network

**Follow-ups**
- How do you enforce module boundaries in Go at compile time?
- What signals tell you it is time to extract a module into a service?

---

#### 2. What is a distributed monolith and how do you recognize you have built one?

*Difficulty:* 🟠 hard  ·  *Tags:* `distributed-monolith`, `anti-pattern`, `coupling`

A distributed monolith is a set of services that must be deployed together and that share state or chatty synchronous call chains, so you pay every cost of distribution (network latency, partial failure, serialization, ops complexity) while keeping the coupling of a monolith. Tells: a single user request fans out into a deep synchronous chain of internal calls; services share a database or read each other's tables; you can't deploy service A without coordinating a release of B and C; a schema change ripples across repos; latency is dominated by inter-service hops. The root cause is almost always boundaries drawn along technical layers or along the existing org chart rather than along business capabilities with real data ownership. The fix is to merge over-split services back together, make remaining cross-service interactions asynchronous and event-driven, and give each service exclusive ownership of its data.

**Key points**
- Costs of distribution + coupling of a monolith = worst of both
- Symptoms: lockstep deploys, shared DB, deep synchronous fan-out, rippling schema changes
- Root cause: boundaries along layers/org chart, not business capabilities + data ownership
- Fix: re-merge, async coupling, exclusive data ownership

**Follow-ups**
- How does shared database access create hidden coupling?
- Why does async messaging reduce coupling compared to synchronous RPC?

---

#### 3. How do you decide service boundaries — by business capability/subdomain rather than by technical layer?

*Difficulty:* 🟠 hard  ·  *Tags:* `decomposition`, `business-capability`, `subdomain`, `cohesion`

Boundaries should follow business capabilities (or DDD subdomains): Catalog, Cart, Checkout, Billing, Fulfillment. Each owns a cohesive slice of behavior *and* its data end to end, so most changes to one capability stay inside one service. Layer-based splits (an "API service", a "business service", a "data service") look clean on a diagram but force every feature to touch every service, maximizing coordination — high coupling, low cohesion. To find capability boundaries, look for: language that changes meaning across contexts (a "product" in Catalog vs. a line item in Cart), data that is written by one team and only read by others, and transaction boundaries — work that must be consistent together belongs together. A good test: a typical feature should be implementable by changing one service. If features routinely cut across three, your boundaries are wrong.

**Key points**
- Boundaries = business capabilities/subdomains owning behavior + data
- Layer splits force every feature across every service (high coupling)
- Use language shifts, single-writer data, and transaction boundaries to find seams
- Test: a typical feature should change one service

**Follow-ups**
- How does this relate to DDD bounded contexts?
- What is the relationship between transaction boundaries and aggregate boundaries?

---

#### 4. Explain database-per-service. Why is a shared database across services an anti-pattern, and what do you give up?

*Difficulty:* 🟡 medium  ·  *Tags:* `database-per-service`, `shared-database`, `outbox`, `cqrs`

Database-per-service means each service exclusively owns its schema; no other service reads or writes those tables directly — they go through the owning service's API or consume its events. This preserves the encapsulation that makes services independent: the owner can change its schema, switch storage engines, or refactor its model without breaking anyone. A shared database is the most common hidden coupling: it turns the schema into a public contract that nobody owns, so any migration becomes a cross-team negotiation and you get a distributed monolith. What you give up is cheap cross-service JOINs and ACID transactions across services. You replace them with API composition or CQRS read models for queries, and with sagas / eventual consistency plus the outbox pattern for writes. That trade — losing global ACID for autonomy — is the central cost of going distributed, and it's why you don't split until you must.

**Key points**
- Each service exclusively owns its schema; others access via API/events
- Shared DB makes schema an unowned public contract → migrations become cross-team coupling
- Lose cross-service JOINs and distributed ACID
- Replace with API composition / CQRS read models and sagas + outbox for consistency


```go
// Outbox: write business state and the event atomically in ONE local tx,
// a relay then publishes from the outbox table.
func (r *OrderRepo) PlaceOrder(ctx context.Context, o Order, evt OrderPlaced) error {
    return r.tx(ctx, func(tx *sql.Tx) error {
        if err := insertOrder(ctx, tx, o); err != nil {
            return err
        }
        return insertOutbox(ctx, tx, evt) // same transaction = no dual-write race
    })
}
```

**Follow-ups**
- How does the outbox pattern avoid the dual-write problem?
- When is API composition preferable to a CQRS read model?

---

#### 5. Describe the strangler fig pattern for breaking up a monolith. What makes it safer than a rewrite?

*Difficulty:* 🟡 medium  ·  *Tags:* `strangler-fig`, `migration`, `monolith-decomposition`

The strangler fig incrementally grows a new system around the old one until the old one can be removed. You put a routing facade (gateway, reverse proxy, or in-process dispatcher) in front of the monolith, then extract one capability at a time into a new service and flip routes for that slice while everything else still hits the legacy code. Each step is small, independently shippable, and reversible — if the extracted Checkout service misbehaves, you route back to the monolith. It's safer than a big-bang rewrite because the business keeps running on a working system the whole time, you never have a months-long branch with no feedback, and risk is bounded per extraction rather than concentrated in one cutover. The hard parts are data: you often dual-write or use change-data-capture during migration, and you must decide who owns the data once a slice is extracted. Pair it with anti-corruption layers so the new context isn't polluted by the legacy model.

**Key points**
- Routing facade routes slices to new services; rest stays on the monolith
- Each extraction is small, shippable, and reversible
- Safer than rewrite: business keeps running, risk bounded per step
- Hard part is data migration (dual-write/CDC) + clear ownership; use ACL at the seam

**Follow-ups**
- How do you migrate data during a strangler extraction without downtime?
- Where does an anti-corruption layer fit in this migration?

---

#### 6. A team wants to start a new product on microservices for "future scale." How do you push back as the architecture owner?

*Difficulty:* 🔴 staff  ·  *Tags:* `premature-microservices`, `trade-offs`, `architecture-ownership`

I'd reframe it around what scaling actually constrains us today versus what we're speculating about. Premature microservices cost you the things a startup can least afford: every feature now spans network boundaries, you need distributed tracing and a saga for flows that would be a single transaction, local dev requires spinning up many services, and — worst — you're committing to data boundaries before you understand the domain, so the inevitable boundary changes become cross-service data migrations instead of refactors. The scale argument is usually a false trade: a modular monolith on Go scales vertically and horizontally (stateless replicas behind a load balancer) extremely far, and the real first bottleneck is almost always the database, which microservices don't fix. My counter-proposal: build a modular monolith with strict module boundaries and per-module data ownership so we *can* extract services later via strangler fig, and extract only when we have a concrete trigger — a module with a genuinely different scaling profile, or a team that needs independent deploys. Keep the option, defer the cost.

**Key points**
- Name the concrete costs: network per feature, sagas, distributed tracing, local dev pain
- Biggest risk: committing to data boundaries before understanding the domain
- Modular monolith scales far; first bottleneck is usually the DB, which µservices don't fix
- Keep extraction optionality via clean module boundaries; extract on a concrete trigger

**Follow-ups**
- What concrete metrics would trigger extracting a module into a service?
- How do you preserve future extractability inside a monolith?

---

## Clean / Hexagonal / Onion Architecture

#### 7. State the Dependency Rule and explain why it is the core idea behind Clean, Hexagonal, and Onion architectures.

*Difficulty:* 🟡 medium  ·  *Tags:* `dependency-rule`, `clean-architecture`, `hexagonal`, `onion`

The Dependency Rule says source-code dependencies point only inward, toward higher-level policy: the domain at the center depends on nothing; application/use-case logic depends only on the domain; infrastructure (DB, HTTP, message brokers) depends inward on the application and domain — never the reverse. Clean (concentric circles), Hexagonal (ports & adapters), and Onion are the same insight in different vocabulary: keep business rules independent of frameworks, databases, and delivery mechanisms. The reason it matters is that infrastructure is the volatile, replaceable part and business rules are the stable, valuable part; if rules depended on Postgres or net/http, every infra change would ripple into your core logic and your domain would be untestable without spinning up a database. By inverting the dependency — the core defines interfaces, the outer layer implements them — you can test the domain with fakes, swap adapters, and defer infrastructure decisions. In Go this is natural because consumer-defined interfaces give you dependency inversion without ceremony.

**Key points**
- Dependencies point inward: infra → application → domain; domain depends on nothing
- Clean/Hexagonal/Onion are the same rule, different names
- Keeps stable business rules independent of volatile frameworks/DB/delivery
- Inversion makes the domain testable and infra swappable

**Follow-ups**
- How do you invert the dependency on the database in Go?
- What goes wrong when an entity imports your ORM types?

---

#### 8. Explain ports and adapters with a concrete Go example. What is a primary (driving) port vs a secondary (driven) port?

*Difficulty:* 🟡 medium  ·  *Tags:* `ports-and-adapters`, `hexagonal`, `interfaces`

In hexagonal architecture a *port* is an interface owned by the application core; an *adapter* is the concrete code that connects that port to the outside world. **Primary/driving ports** are how the outside drives the app — your use-case interfaces, called by HTTP handlers, gRPC servers, or CLI commands (the driving adapters). **Secondary/driven ports** are how the app drives the outside — interfaces like `OrderRepository` or `PaymentGateway` that the core *calls*, implemented by driven adapters (a Postgres repo, a Stripe client). The crucial direction: the core *defines* both interfaces; adapters depend on the core, not vice versa. This means you can run the entire application with in-memory adapters for tests, swap Stripe for another processor by writing a new driven adapter, and add a gRPC entry point without touching domain logic. The hexagon metaphor just emphasizes there's no privileged "top" — UI and DB are both just adapters plugged into ports.

**Key points**
- Port = interface owned by the core; adapter = concrete external connector
- Primary/driving: use-case interfaces driven by HTTP/gRPC/CLI adapters
- Secondary/driven: repo/gateway interfaces the core calls, implemented by infra
- Core defines all ports; adapters depend inward — enables test fakes & swaps


```go
// Driven port (core defines it)
type PaymentGateway interface {
    Charge(ctx context.Context, c Charge) (Receipt, error)
}

// Primary port (use case the core exposes)
type CheckoutService interface {
    Checkout(ctx context.Context, cmd CheckoutCmd) (OrderID, error)
}

// Driven adapter lives in infra and depends on the core interface
type StripeGateway struct{ client *stripe.Client }
func (g StripeGateway) Charge(ctx context.Context, c Charge) (Receipt, error) { /* ... */ }
```

**Follow-ups**
- Why should the core, not the infra package, declare PaymentGateway?
- How does this layout make testing the checkout flow trivial?

---

#### 9. How do you keep the domain free of infrastructure concerns in Go? Where do struct tags, context, and SQL belong?

*Difficulty:* 🟠 hard  ·  *Tags:* `clean-architecture`, `domain-purity`, `persistence-mapping`

The domain package should import nothing from `database/sql`, your ORM, `net/http`, or your transport libraries — only the standard library and other domain code. That means: no `db:"..."` or `json:"..."` tags on entities (those are persistence/transport concerns), no `*sql.Tx` in domain method signatures, and no JSON marshaling logic in value objects. Instead, the persistence adapter defines its own row/DTO structs with tags and maps to/from domain types. SQL lives entirely in repository adapters. The one pragmatic exception is `context.Context`: it's effectively part of Go's standard vocabulary for cancellation and deadlines, so passing it through is acceptable and common, though purists push it to the application boundary. The payoff: the domain compiles and tests with zero infrastructure, and you can read the business rules without database noise. The cost is mapping boilerplate between domain types and persistence DTOs — which is the price of decoupling, and worth it for anything with non-trivial business logic.

**Key points**
- Domain imports only stdlib + domain; no ORM/HTTP/SQL imports
- Struct tags and DTOs belong in persistence/transport adapters, not entities
- SQL lives in repository adapters; entities have no *sql.Tx in signatures
- context.Context is a pragmatic exception; cost is mapping boilerplate


```go
// domain/order.go — no tags, no infra
type Order struct {
    ID    OrderID
    Lines []Line
    Total Money
}

// adapter/postgres/order_row.go — tags live here
type orderRow struct {
    ID    string `db:"id"`
    Total int64  `db:"total_cents"`
}
func toDomain(r orderRow) Order { /* map */ }
```

**Follow-ups**
- Is mapping boilerplate always worth it? When would you skip the DTO layer?
- Why is context.Context treated as an acceptable exception?

---

#### 10. Critics say Clean Architecture is over-engineering for many Go services. When is it justified and when is it ceremony?

*Difficulty:* 🔴 staff  ·  *Tags:* `clean-architecture`, `over-engineering`, `trade-offs`

Clean Architecture earns its keep when business logic is complex and long-lived and infrastructure is likely to change — rich domains like billing, pricing, or order fulfillment where rules outlive any database or framework choice and where testability of those rules is high value. There the indirection (ports, mapping layers, dependency inversion) pays back many times over. It becomes ceremony when the service is essentially a thin CRUD adapter over a database with no real domain logic: there, full ports-and-adapters with DTO mapping is pure overhead — you're writing three structs and two mappers to move a row from HTTP to SQL. The senior move is to apply it by *layer of value*, not dogmatically: a transactional-script style is fine for trivial endpoints; reserve the hexagon for the complex core. I also resist the common failure mode of cargo-culting four mandatory packages into every microservice regardless of complexity. Architecture should match the volatility and complexity of what it wraps.

**Key points**
- Justified for complex, long-lived domains where infra is volatile and rules are valuable
- Ceremony for thin CRUD-over-DB services with no real domain logic
- Apply by value: transactional script for trivial, hexagon for the complex core
- Avoid cargo-culting the same layered template into every service

**Follow-ups**
- How do you decide per-service which architectural style to apply?
- What is the cost of mixing styles across one codebase?

---

## Go-Specific Design

#### 11. Walk through the cmd/, internal/, and pkg/ project layout. What does each convey and what is internal/ enforcing?

*Difficulty:* 🟢 warm-up  ·  *Tags:* `project-layout`, `internal`, `pkg`, `cmd`

`cmd/<binary>/main.go` holds each executable's entry point — small wiring that parses config and composes dependencies, with no business logic. `internal/` holds everything that is private to this module: Go's compiler refuses to let any package outside the module import anything under `internal/`, so it's a hard, compiler-enforced boundary against external coupling. Most of a real application lives here — domain, use cases, adapters. `pkg/` is for code you intend to be importable by external consumers — a stable, public library API. The senior nuance: many teams overuse `pkg/`; if you're not actually publishing reusable libraries, put nearly everything in `internal/` so you keep the freedom to refactor without breaking external importers. `pkg/` is a promise of API stability you may not want to make. The layout itself is a convention, not enforced by the toolchain except for `internal/`, which is the one rule the compiler actually checks.

**Key points**
- cmd/ = thin entry points, wiring only, no business logic
- internal/ = compiler-enforced privacy; most code lives here
- pkg/ = intentionally public, externally importable API (a stability promise)
- Overusing pkg/ is a common smell; prefer internal/ unless publishing a library

**Follow-ups**
- Why is putting code in pkg/ a commitment you might regret?
- How can internal/ be used to enforce boundaries between feature modules?

---

#### 12. Explain "accept interfaces, return structs." Why is it the idiomatic Go design guideline?

*Difficulty:* 🟡 medium  ·  *Tags:* `accept-interfaces-return-structs`, `go-idiom`, `dependency-inversion`

Functions and constructors should accept interface parameters (the minimal behavior they need) but return concrete struct types. Accepting interfaces means callers can pass any implementation — a real adapter in production, a fake in tests — so your code is decoupled and testable without the caller depending on your concrete type. Returning concrete structs gives callers the full, discoverable API and the real type's documentation, and avoids prematurely constraining the type; the caller, not you, decides which interface (if any) to view it through. Returning an interface instead hides methods, forces nil-interface gotchas, and couples every caller to an abstraction they may not need. The corollary is to keep accepted interfaces *small* — one or two methods — defined where they're consumed. This guideline is really dependency inversion expressed in Go's grain: depend on behavior you need, expose concrete capability you provide.

**Key points**
- Accept interfaces → decoupled, testable inputs; caller chooses implementation
- Return structs → full API, discoverable, no premature constraint, no nil-interface traps
- Keep accepted interfaces small and consumer-defined
- It is dependency inversion in Go idiom


```go
// Accept the minimal interface the function needs...
type Notifier interface{ Notify(ctx context.Context, m Message) error }

func NewDispatcher(n Notifier) *Dispatcher { return &Dispatcher{n: n} }

// ...return the concrete struct, not an interface.
func NewSMTPNotifier(cfg Config) *SMTPNotifier { return &SMTPNotifier{cfg: cfg} }
```

**Follow-ups**
- When is returning an interface actually justified?
- How does returning an interface cause the typed-nil bug?

---

#### 13. In Go, where should an interface be declared — with the implementation or with the consumer? Why does this differ from Java/C#?

*Difficulty:* 🟠 hard  ·  *Tags:* `interfaces`, `consumer-side`, `structural-typing`, `go-idiom`

Declare interfaces on the consumer side — in the package that *uses* the behavior — not next to the implementation. Because Go interfaces are satisfied structurally (implicitly), the implementing type doesn't need to know an interface exists, so the consumer can define exactly the small interface it needs and any compatible type satisfies it for free. This inverts the Java/C# habit, where nominal typing forces the implementer to declare `implements SomeInterface`, so interfaces tend to live with the implementation and grow large to serve all consumers. The Go consequence is healthier: interfaces stay tiny and purpose-built (`io.Reader` is one method), there's no central interface package everyone depends on, and the dependency arrow naturally points from infra toward the core that defines the port. A common anti-pattern from ex-Java engineers is shipping a giant `Repository` interface beside the Postgres implementation with one method per query; that recreates nominal coupling and bloats the abstraction.

**Key points**
- Define interfaces where consumed, not beside the implementation
- Structural (implicit) satisfaction lets any compatible type fit without declaring intent
- Keeps interfaces small and purpose-built; no central interface package
- Anti-pattern: large implementation-side interfaces (a Java habit)


```go
// consumer package defines the narrow interface it needs
package billing
type RateReader interface { Rate(ctx context.Context, plan PlanID) (Money, error) }

// catalog package's concrete type satisfies it implicitly — no import of billing
package catalog
type Store struct{ /* ... */ }
func (s Store) Rate(ctx context.Context, p PlanID) (Money, error) { /* ... */ }
```

**Follow-ups**
- How does structural typing avoid an import cycle here?
- When does a shared interface package make sense despite this guidance?

---

#### 14. How do you do dependency injection in Go? Compare manual constructor wiring with wire/fx.

*Difficulty:* 🟠 hard  ·  *Tags:* `dependency-injection`, `wire`, `fx`, `constructor-injection`

Go has no DI container in the language; you do DI by passing dependencies into constructors — `NewService(repo Repository, gw PaymentGateway)` — and composing the whole graph in `main`. For most services this manual wiring is the right answer: it's explicit, compile-checked, trivially navigable, and the entire dependency graph is readable in one `main.go`. The cost is that for very large graphs the wiring function grows long and order-sensitive. Google's `wire` addresses this with *compile-time* code generation: you declare providers, it generates the same constructor calls you'd write by hand, so there's no runtime reflection and errors surface at build time. Uber's `fx` is a *runtime* container using reflection, giving lifecycle hooks (OnStart/OnStop) and dynamic graphs, which suits large apps with many optional modules but moves wiring errors to startup and adds magic. My default: manual wiring until it genuinely hurts, then `wire` to keep compile-time safety; reach for `fx` only when you need its lifecycle/plugin model and can accept reflection.

**Key points**
- DI in Go = constructor injection + compose the graph in main
- Manual: explicit, compile-checked, readable; scales poorly to huge graphs
- wire: compile-time codegen, no reflection, build-time errors
- fx: runtime reflection container with lifecycle hooks; more magic, startup-time errors


```go
// Manual wiring in main — explicit and compile-checked
func main() {
    db := mustOpenDB(cfg)
    repo := postgres.NewOrderRepo(db)
    gw := stripe.NewGateway(cfg.StripeKey)
    svc := checkout.NewService(repo, gw)
    srv := httpapi.NewServer(svc)
    log.Fatal(srv.ListenAndServe())
}
```

**Follow-ups**
- Why prefer compile-time wire over runtime fx for error surfacing?
- At what graph size does manual wiring become a real problem?

---

#### 15. Organize packages by layer or by feature? Make the case and describe what you'd actually do.

*Difficulty:* 🟠 hard  ·  *Tags:* `package-organization`, `by-feature`, `by-layer`, `cohesion`

Layer-based packages (`handlers/`, `services/`, `repositories/`, `models/`) group by technical role, so a single feature is smeared across every package and changing one feature touches many — high coupling, low cohesion, and the package names tell you nothing about the domain. Feature/domain-based packages (`order/`, `billing/`, `catalog/`, each containing its handler, service, and repository) keep everything that changes together in one place, give you high cohesion, let you enforce boundaries with `internal/`, and read like the business. The screaming-architecture argument applies: your top-level packages should announce the domain, not the framework. What I actually do: organize the top level by bounded context / feature, and *within* a feature use clean-architecture layering (domain, app, adapters) where the complexity warrants it. So it's feature-first, layered-within — not either/or. Layer-first is acceptable only for tiny services where the whole thing is one feature anyway.

**Key points**
- Layer-first smears each feature across packages → low cohesion, high coupling
- Feature-first keeps co-changing code together → high cohesion, enforceable boundaries
- Top-level packages should 'scream' the domain, not the framework
- Best practice: feature/context at top level, layered architecture within

**Follow-ups**
- How does feature-based layout map to bounded contexts?
- How do you prevent two feature packages from importing each other's internals?

---

#### 16. What causes import cycles in Go and how do you resolve them architecturally rather than with hacks?

*Difficulty:* 🟠 hard  ·  *Tags:* `import-cycles`, `dependency-inversion`, `package-design`

Go forbids import cycles: if package A imports B, B (transitively) can't import A. Cycles usually signal a real design problem — two packages that each know about the other's concrete types, meaning the boundary between them is wrong. The wrong fixes are merging unrelated packages into one giant package, or shoving shared types into a junk `common`/`util` package. The right fixes are architectural: (1) apply dependency inversion — have the consumer define a small interface for what it needs so it no longer imports the other package's concrete type (structural typing means the implementer needs no import back); (2) extract the genuinely shared concept into its own lower-level package that both depend on, with the dependency pointing inward to the domain; or (3) move the misplaced code to whichever side it truly belongs. A cycle is feedback that your dependency arrows aren't acyclic — fix the direction, don't defeat the compiler.

**Key points**
- Cycles signal mutual concrete-type knowledge = wrong boundary
- Bad fixes: god-package merge, dumping types in common/util
- Good fixes: consumer-defined interface (DIP), extract shared inner package, relocate code
- Treat the cycle as feedback to make dependencies acyclic and inward-pointing

**Follow-ups**
- Why does a consumer-side interface break a cycle without a back-import?
- What's wrong with a catch-all common package as a cycle escape hatch?

---

## DDD Tactical Patterns

#### 17. Distinguish entity from value object. How do you model each in Go, and why is the distinction useful?

*Difficulty:* 🟡 medium  ·  *Tags:* `entity`, `value-object`, `ddd-tactical`, `immutability`

An **entity** has identity that persists through change — an `Order` is the same order even as its lines and status change, so equality is by ID, and it has a lifecycle. A **value object** has no identity; it's defined entirely by its attributes — `Money{Amount, Currency}`, `Address`, `DateRange` — so two value objects with equal fields are interchangeable, and they should be immutable. In Go you model an entity as a struct carrying an ID field, compared by ID; a value object as a small immutable struct compared with `==` (or a method) and constructed through a validating factory so an invalid `Money` can't exist. The distinction is useful because it tells you where mutation, identity, and invariants live: value objects push validation and behavior down to the data (a `Money.Add` that rejects mismatched currencies), shrinking entities and eliminating primitive obsession. Modeling currency as a `Money` value object rather than an `int64` cents and a `string` code prevents a whole class of bugs.

**Key points**
- Entity: identity persists through change; equality by ID; has lifecycle
- Value object: identity-less, attribute-defined, immutable, equal by value
- Go: entity = struct with ID; VO = immutable struct via validating constructor
- VOs carry validation/behavior, kill primitive obsession, shrink entities


```go
type Money struct{ cents int64; currency string } // unexported fields = immutable

func NewMoney(cents int64, cur string) (Money, error) {
    if cur == "" { return Money{}, errors.New("currency required") }
    return Money{cents, cur}, nil
}
func (m Money) Add(o Money) (Money, error) {
    if m.currency != o.currency { return Money{}, errors.New("currency mismatch") }
    return Money{m.cents + o.cents, m.currency}, nil
}
```

**Follow-ups**
- Why make value objects immutable in Go specifically?
- How does pushing behavior into value objects reduce anemic domain models?

---

#### 18. What is an aggregate and an aggregate root? How do you decide aggregate boundaries?

*Difficulty:* 🟠 hard  ·  *Tags:* `aggregate`, `aggregate-root`, `invariants`, `ddd-tactical`

An aggregate is a cluster of entities and value objects that must stay consistent together, treated as one unit. The **aggregate root** is the single entity that is the only entry point: outside code holds a reference to the root and can only reach inner members through it, so the root enforces the aggregate's invariants. For an `Order` aggregate, the order is the root and `OrderLine`s are inside it; you never mutate a line directly, you call `order.AddLine(...)` which can enforce "total must not exceed credit limit." You draw boundaries around *true invariants* — rules that must hold atomically — and keep aggregates as **small** as possible, because the aggregate is your consistency and transaction boundary. The classic mistake is making aggregates too big (a `Customer` that contains all its orders), which creates contention and giant transactions. If a rule only needs to be *eventually* consistent, it belongs across aggregate boundaries, coordinated by domain events — not inside one aggregate.

**Key points**
- Aggregate = consistency cluster; root is the only entry point and invariant guardian
- External refs only to the root; reach inner members through root methods
- Boundary = true atomic invariants; keep aggregates small
- Eventually-consistent rules go across aggregates via domain events

**Follow-ups**
- Why does a large aggregate cause concurrency contention?
- How do you reference one aggregate from another?

---

#### 19. Explain the rule "one transaction per aggregate." How do you keep multiple aggregates consistent then?

*Difficulty:* 🔴 staff  ·  *Tags:* `transaction-boundary`, `aggregate`, `saga`, `eventual-consistency`

The guideline is that a single database transaction should commit changes to only one aggregate instance. The reason is twofold: the aggregate is the unit whose invariants must hold atomically, so its boundary is exactly the right transaction boundary; and locking only one aggregate per transaction minimizes contention and lets the system scale (it's also a prerequisite for sharding aggregates across stores later). If you find yourself wanting to modify two aggregates in one transaction, that's a signal either your aggregate boundaries are wrong (the two should be one) or the rule between them is genuinely *eventual*. For genuinely cross-aggregate consistency you don't use a distributed transaction; you commit aggregate A and emit a domain event in the same transaction (the outbox pattern), and a handler then updates aggregate B in its own transaction, retrying on failure. Across services this becomes a saga with compensating actions. So consistency between aggregates is eventual, event-driven, and idempotent — which also explains why payment side-effects must be designed for retries.

**Key points**
- One DB transaction touches one aggregate — its atomic invariant boundary
- Reduces lock contention, enables scaling/sharding of aggregates
- Wanting two in one tx = wrong boundary or the rule is eventual
- Cross-aggregate consistency via outbox events + idempotent handlers / sagas

**Follow-ups**
- How does the outbox pattern make event emission atomic with the aggregate write?
- Why must cross-aggregate event handlers be idempotent?

---

#### 20. Differentiate domain service, application service, and infrastructure service. Give a Go example of each.

*Difficulty:* 🟠 hard  ·  *Tags:* `domain-service`, `application-service`, `infrastructure-service`, `layering`

A **domain service** holds domain logic that doesn't naturally belong to a single entity or value object — a calculation or policy spanning multiple aggregates, e.g. a `PricingPolicy` that computes a quote from a cart and a customer's plan. It's pure domain: no transactions, no I/O. An **application service** (use case) orchestrates a single business operation: it loads aggregates via repositories, invokes domain logic, manages the transaction boundary, and emits events — e.g. `CheckoutService.Checkout` that begins a tx, loads the cart, calls pricing, charges via a gateway port, persists the order, and publishes `OrderPlaced`. It contains coordination, not business rules. An **infrastructure service** is the technical implementation behind a port — the Stripe adapter, the SMTP sender, the Postgres repository. The discipline: business rules live in the domain, orchestration and transactions live in the application layer, and technology lives in infrastructure behind interfaces. Mixing these (SQL inside a domain service, or pricing rules inside a handler) is the most common architectural smell I review for.

**Key points**
- Domain service: cross-entity business logic, pure, no I/O (e.g. PricingPolicy)
- Application service: orchestrates one use case, owns the transaction, emits events
- Infrastructure service: concrete adapter behind a port (Stripe, SMTP, Postgres)
- Smell to watch for: business rules in handlers, or I/O in domain services


```go
// domain service: pure logic
func (p PricingPolicy) Quote(cart Cart, plan Plan) (Money, error) { /* rules */ }

// application service: orchestration + transaction
func (s *CheckoutService) Checkout(ctx context.Context, cmd CheckoutCmd) (OrderID, error) {
    cart, err := s.carts.Get(ctx, cmd.CartID); if err != nil { return "", err }
    price, err := s.pricing.Quote(cart, cmd.Plan); if err != nil { return "", err }
    _, err = s.payments.Charge(ctx, Charge{Amount: price, Idem: cmd.IdemKey}); if err != nil { return "", err }
    return s.orders.Create(ctx, NewOrder(cart, price))
}
```

**Follow-ups**
- Where does the transaction boundary belong and why the application layer?
- How do you tell a domain service from an application service when both 'span aggregates'?

---

#### 21. What is the repository pattern in DDD, and how is it implemented idiomatically in Go?

*Difficulty:* 🟡 medium  ·  *Tags:* `repository`, `ddd-tactical`, `dependency-inversion`, `persistence`

A repository gives the domain a collection-like, persistence-ignorant interface for an aggregate root: `Get(id)`, `Save(aggregate)`, maybe a few domain queries — never raw SQL or query builders leaking out. The interface is defined by the consumer (the application/domain layer) and implemented by an infrastructure adapter, which is exactly dependency inversion: the domain depends on the abstraction, the Postgres code depends on the domain. In Go this is a small consumer-side interface plus a struct implementation that maps rows to domain types. Two senior points. First, repositories are *per aggregate root*, not per table — you don't expose a repository for an inner `OrderLine`. Second, resist building a generic `Repository[T]` with a hundred methods; keep it to the few operations the use cases actually call, which keeps it mockable and honest. The payoff is that application services and domain logic are fully testable with an in-memory repository, and you can swap Postgres for anything without touching business code.

**Key points**
- Collection-like, persistence-ignorant interface per aggregate root
- Consumer-defined interface; infra implements it = dependency inversion
- One repository per aggregate root, not per table
- Keep methods minimal (only what use cases need); enables in-memory test doubles


```go
// application layer defines what it needs
type OrderRepository interface {
    Get(ctx context.Context, id OrderID) (*Order, error)
    Save(ctx context.Context, o *Order) error
}

// infra/postgres implements and maps rows <-> domain
type pgOrderRepo struct{ db *sql.DB }
func (r pgOrderRepo) Save(ctx context.Context, o *Order) error { /* map + SQL */ }
```

**Follow-ups**
- Why one repository per aggregate root rather than per table?
- How do you handle a transaction that must span a repository Save plus an outbox insert?

---

#### 22. What is an anemic domain model and why is it considered an anti-pattern in DDD?

*Difficulty:* 🟡 medium  ·  *Tags:* `anemic-domain-model`, `anti-pattern`, `rich-model`, `ddd`

An anemic domain model is one where entities are bags of public getters/setters with no behavior, and all the actual business logic lives in a separate layer of "service" classes that reach in and manipulate that data. It's an anti-pattern in DDD because it throws away encapsulation: invariants aren't protected (anyone can set `order.Status = Shipped` directly), the rules are scattered and duplicated across services, and the domain objects don't express the ubiquitous language — they're just data structures, so the model carries no domain knowledge. The DDD alternative is a *rich* model where behavior lives with the data it guards: `order.Ship()` checks the order is paid and not already shipped before changing state, so the invariant can't be violated. That said, Go nuance: not every service needs a rich model — a thin CRUD service is legitimately anemic and that's fine. The anti-pattern is specifically claiming to do DDD while the domain has no behavior; if you have real business rules, they belong inside the model, not in a procedural service layer.

**Key points**
- Anemic = data-only entities + logic in separate procedural services
- Breaks encapsulation: invariants unprotected, rules scattered/duplicated
- Rich model puts behavior with data (order.Ship() guards the transition)
- Anemic is fine for true CRUD; it's an anti-pattern only when you have real domain logic

**Follow-ups**
- How do unexported fields + methods enforce invariants in Go?
- When is an anemic model actually the right call?

---

## DDD Strategic Design

#### 23. What is a bounded context and why is it the most important concept in strategic DDD?

*Difficulty:* 🟠 hard  ·  *Tags:* `bounded-context`, `ddd-strategic`, `ubiquitous-language`

A bounded context is an explicit boundary within which a domain model and its ubiquitous language are consistent and unambiguous. The same word can mean different things in different contexts — a "Product" in the Catalog context (rich marketing data) is a different model from a "Product" line item in the Ordering context (a price and quantity snapshot) — and trying to build one universal model for both is the core mistake DDD prevents. It matters most because it's where strategy meets structure: bounded contexts are the natural unit for team ownership, for module boundaries in a monolith, and for service boundaries if you go distributed. Inside a context the model is clean and the language is shared by developers and domain experts; between contexts you translate explicitly via context mapping and anti-corruption layers. Getting contexts right is what lets you decompose a system into pieces that change independently; getting them wrong is what produces the god-model and the distributed monolith.

**Key points**
- Explicit boundary where one model + ubiquitous language stays consistent
- Same term differs across contexts; avoid one universal model
- Natural unit for teams, modules, and (later) services
- Right contexts = independent change; wrong = god-model / distributed monolith

**Follow-ups**
- How do bounded contexts map to microservice boundaries?
- How do you discover context boundaries from the business language?

---

#### 24. Describe context mapping. What do relationships like Customer-Supplier, Conformist, and Shared Kernel mean in practice?

*Difficulty:* 🔴 staff  ·  *Tags:* `context-mapping`, `ddd-strategic`, `integration`, `conways-law`

Context mapping documents how bounded contexts relate — both the technical integration and the team power dynamics, because integration is as much organizational as technical. Key patterns: **Customer-Supplier** — the downstream (customer) context has influence over the upstream's API and can negotiate changes. **Conformist** — the downstream has no influence and simply conforms to the upstream model as-is (common when integrating a third party or a legacy core). **Anti-Corruption Layer** — the downstream translates the upstream model into its own, protecting its model from foreign concepts. **Shared Kernel** — two contexts share a small subset of the model/code, which requires tight coordination and should be kept minimal and stable. **Open Host Service / Published Language** — the upstream offers a well-documented public protocol many can consume. **Partnership** — two teams succeed or fail together and coordinate releases. In practice the map tells you where to invest in ACLs, where you're vulnerable to upstream churn, and which integrations carry coordination cost — it's a planning tool for the architecture owner, not just documentation.

**Key points**
- Context map captures technical integration AND team power dynamics
- Customer-Supplier: downstream has negotiating influence over upstream
- Conformist: downstream just accepts the upstream model (no influence)
- Shared Kernel: minimal shared model needing tight coordination; ACL: translate to protect

**Follow-ups**
- When is Conformist acceptable vs when must you build an ACL?
- Why keep a Shared Kernel as small as possible?

---

#### 25. What is an anti-corruption layer (ACL) and when is it worth the cost?

*Difficulty:* 🟠 hard  ·  *Tags:* `anti-corruption-layer`, `ddd-strategic`, `integration`, `legacy`

An anti-corruption layer is a translation boundary that converts another context's (or external system's) model into terms your own model understands, so foreign concepts, naming, and quirks never leak into your domain. Concretely it's an adapter that takes the upstream's DTOs/protocol and maps them to your domain types, often absorbing their inconsistencies — wrong enums, denormalized fields, legacy semantics — so your core stays clean. It's worth the cost when the upstream model is messy, unstable, or fundamentally different from yours: integrating a legacy monolith you're strangling, a third-party API you don't control, or a partner context whose language conflicts with yours. The cost is real (extra mapping code and a layer to maintain), so you don't wrap every integration in one — for a stable, well-modeled internal partner you might conform directly. The senior judgment is matching the ACL's thickness to how toxic and volatile the upstream is: thicker for legacy/third-party, thinner or none for a clean internal context with a published language.

**Key points**
- Translation boundary mapping a foreign model into your domain terms
- Stops upstream quirks/naming/semantics from corrupting your model
- Worth it for legacy, third-party, or fundamentally different/unstable upstreams
- Match thickness to upstream toxicity/volatility; skip for clean internal partners

**Follow-ups**
- How does an ACL support a strangler-fig migration off a legacy core?
- What's the maintenance cost of an ACL and how do you keep it from rotting?

---

#### 26. What is ubiquitous language and how does it concretely shape your Go code?

*Difficulty:* 🟡 medium  ·  *Tags:* `ubiquitous-language`, `ddd-strategic`, `naming`

Ubiquitous language is a shared, precise vocabulary used identically by domain experts and developers within a bounded context — the same words in conversations, in the model, and in the code. Concretely it shapes Go code at every level: package names reflect contexts (`billing`, `fulfillment`), types are named for domain concepts (`Subscription`, `BillingCycle`, `DunningState`) not technical roles (`SubscriptionManager`, `DataObject`), and methods read like business operations (`subscription.Renew()`, `order.Cancel(reason)`) rather than CRUD (`UpdateStatus`). When a domain expert says "we churn a subscription after three failed dunning attempts," those exact terms — churn, dunning, attempt — should appear in the code. The payoff is that the code becomes a living model the whole team can reason about, mismatches between developer assumptions and business reality surface early (in naming reviews, not in production), and onboarding is faster. Drift between the language in standups and the language in the codebase is a reliable early warning that the model is decaying.

**Key points**
- One precise vocabulary shared by experts and devs within a context
- Drives package/type/method names: domain concepts, not technical roles
- Methods read as business operations (Renew/Cancel), not CRUD
- Code becomes a living model; language drift signals model decay

**Follow-ups**
- How does naming reviewing catch domain misunderstandings early?
- What do you do when the same term means two things in two contexts?

---

#### 27. How do bounded contexts map onto microservices? Is it always one-to-one?

*Difficulty:* 🔴 staff  ·  *Tags:* `bounded-context`, `microservices`, `service-boundaries`, `ddd-strategic`

A bounded context is the *natural* boundary for a service because it already owns a consistent model, language, and (if modeled well) its data — so a service per context gives you high cohesion and clean ownership. But it is not mechanically one-to-one. A context can legitimately start life as a module inside a monolith and only later be extracted, so "one context, one service" is a target, not a starting point. A single context can also be split into multiple services for operational reasons — different scaling profiles or a CQRS read side deployed separately — while still being one model conceptually. And you should never split a *single* context across services for technical-layer reasons, because that recreates the distributed monolith with chatty cross-service calls inside one model. So the rule I apply: never let a service span more than one bounded context (that mixes languages and couples models), but allow a context to be one module or several services. Contexts decide where the model boundaries are; deployment topology is a separate, later decision driven by scaling and team needs.

**Key points**
- Context is the natural service boundary (cohesion + ownership), but not mechanically 1:1
- A context may live as a monolith module first, extracted later
- A context may split into multiple services for scaling/CQRS — never along technical layers
- Hard rule: a service must not span multiple contexts; topology is a separate decision

**Follow-ups**
- What goes wrong if one service spans two bounded contexts?
- What's a legitimate reason to deploy one context as multiple services?

---

## Design Patterns in Go Idiom

#### 28. Which classic GoF patterns does Go make largely unnecessary, and why?

*Difficulty:* 🟡 medium  ·  *Tags:* `gof-patterns`, `go-idiom`, `composition`, `functions`

Several GoF patterns exist mainly to work around limitations of nominal, class-based languages that Go doesn't have. **Strategy** and **Command** collapse into first-class functions — pass a `func` instead of building an interface hierarchy. **Decorator** is often just function composition or struct embedding. **Iterator** is the `range` loop (and now `range`-over-func iterators). **Singleton** is a package-level variable plus `sync.Once`, and is usually a smell anyway. **Adapter** is trivial because of implicit interface satisfaction — you frequently don't even write an adapter, the type just fits the interface. The **Template Method** inheritance pattern is replaced by passing in behavior (functions) since Go has no inheritance. What survives and is genuinely useful: **Factory** (constructor functions returning interfaces for polymorphic creation), **Repository**, **Strategy** when behavior needs state, and Go-native idioms like **functional options** and **middleware**. The meta-point: Go favors composition, interfaces, and functions over class hierarchies, so many GoF patterns dissolve into language features rather than requiring named structures.

**Key points**
- Strategy/Command → first-class functions; Iterator → range; Singleton → var + sync.Once
- Decorator → function composition / embedding; Template Method → injected behavior
- Adapter often free via implicit interface satisfaction
- Survivors: Factory, Repository, functional options, middleware — composition over inheritance

**Follow-ups**
- Show Strategy implemented as a plain function value.
- Why is Singleton usually a smell even though it's easy in Go?

---

#### 29. Explain the functional options pattern. What problem does it solve over a config struct or many constructors?

*Difficulty:* 🟡 medium  ·  *Tags:* `functional-options`, `go-idiom`, `constructor`, `configuration`

Functional options configure a constructor with a variadic list of `Option` functions, each mutating the target's config: `New(addr, WithTimeout(5*time.Second), WithRetries(3))`. It solves the problem of a constructor with many optional parameters in a language with no named/default arguments: telescoping constructors explode combinatorially, and a public config struct can't enforce invariants, can't distinguish "unset" from zero value cleanly, and breaks compatibility when you add a field. Options give you sensible defaults, let callers set only what they care about in any order, keep the API backward-compatible (adding a new option doesn't change existing calls), and allow validation inside each option. The cost is more boilerplate than a struct and slightly more indirection, so it's overkill for a type with two fields — reach for it when there are several optional, evolving settings (clients, servers, pools). It's the idiomatic Go answer to optional configuration and you'll see it across the standard ecosystem.

**Key points**
- Variadic Option funcs mutate config; defaults + any-order optional settings
- Solves no named/default args: avoids telescoping constructors
- Backward-compatible: adding an option doesn't break existing calls; allows validation
- Overkill for tiny types; ideal for clients/servers with evolving optional settings


```go
type Server struct{ timeout time.Duration; retries int }
type Option func(*Server)

func WithTimeout(d time.Duration) Option { return func(s *Server){ s.timeout = d } }
func WithRetries(n int) Option       { return func(s *Server){ s.retries = n } }

func New(opts ...Option) *Server {
    s := &Server{timeout: 30 * time.Second, retries: 3} // defaults
    for _, o := range opts { o(s) }
    return s
}
```

**Follow-ups**
- How do options keep the API backward-compatible as it grows?
- When is a plain config struct the better choice?

---

#### 30. Explain the middleware pattern in Go's net/http (func(http.Handler) http.Handler). Why is it so idiomatic?

*Difficulty:* 🟡 medium  ·  *Tags:* `middleware`, `net-http`, `go-idiom`, `decorator`

Middleware is a function that wraps an `http.Handler` and returns a new one: `func(next http.Handler) http.Handler`. Inside, it can run logic before and after calling `next.ServeHTTP`, so you compose cross-cutting concerns — logging, auth, recovery, rate limiting, tracing — as a chain `Logging(Auth(Recover(handler)))`. It's idiomatic because it leans on Go's strengths: `http.Handler` is a one-method interface, closures capture dependencies, and composition (not inheritance) builds the pipeline. Each middleware is independently testable, reusable across routes, and ordered explicitly by how you nest them — order matters (recovery outermost so it catches panics from inner layers, auth before business logic). It's essentially the Decorator pattern realized through Go's interface + closure idioms, with no framework required. The same shape generalizes beyond HTTP — gRPC interceptors and any `Handler`-like interface — which is why understanding it transfers across the ecosystem.

**Key points**
- func(next http.Handler) http.Handler wraps and composes handlers
- Composes cross-cutting concerns; order is explicit via nesting
- Leans on one-method interface + closures + composition (Decorator in Go form)
- Recovery outermost, auth before logic; independently testable and reusable


```go
func Logging(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        start := time.Now()
        next.ServeHTTP(w, r)
        log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(start))
    })
}

// compose: outermost runs first
handler := Recover(Logging(Auth(mux)))
```

**Follow-ups**
- Why does middleware order matter, and what's a safe default ordering?
- How would you pass request-scoped values down the chain?

---

#### 31. How does the strategy pattern look in Go, and when do you use a function value versus an interface?

*Difficulty:* 🟡 medium  ·  *Tags:* `strategy`, `go-idiom`, `functions`, `interfaces`

Strategy means selecting an algorithm at runtime. In Go you have two idiomatic forms. If the strategy is *stateless behavior*, use a plain function value — a `type DiscountFn func(Cart) Money` injected into the service. It's the lightest possible expression: no type to declare, no boilerplate, just pass a `func`. If the strategy needs *state, configuration, or multiple related methods*, use a small interface — `type PricingStrategy interface { Price(Cart) Money }` — implemented by structs that hold their own data (a `TieredPricing` with rate tables). The rule of thumb: one behavior, no state → function; needs state or more than one method → interface. Both achieve the same decoupling (the caller depends on an abstraction, not a concrete algorithm), but the function form is more idiomatic for single-method strategies and avoids the over-abstraction of declaring an interface just to hold one method. This is a good example of Go letting you reach for the lighter tool than classic OO would.

**Key points**
- Stateless single behavior → function value (type DiscountFn func(Cart) Money)
- Needs state/config/multiple methods → small interface implemented by structs
- Rule: one behavior no state → func; state or >1 method → interface
- Both decouple caller from algorithm; prefer the lighter form


```go
type DiscountFn func(Cart) Money

func Checkout(c Cart, discount DiscountFn) Money { return c.Total().Sub(discount(c)) }

// strategies are just functions
var NoDiscount DiscountFn  = func(Cart) Money { return Money{} }
var TenPercent DiscountFn  = func(c Cart) Money { return c.Total().Pct(10) }
```

**Follow-ups**
- When would you regret using a function value instead of an interface?
- How does this relate to 'accept interfaces' guidance?

---

#### 32. Show factory and adapter in Go idiom. How does implicit interface satisfaction change the adapter pattern?

*Difficulty:* 🟡 medium  ·  *Tags:* `factory`, `adapter`, `go-idiom`, `structural-typing`

A **factory** in Go is just a constructor function that returns an interface, letting the caller create the right implementation without knowing the concrete type: `func NewStorage(kind string) (Storage, error)` returning a Postgres or in-memory store. It centralizes construction logic and validation and keeps callers depending on the abstraction. An **adapter** makes an existing type fit an interface the consumer expects. The twist in Go is that implicit (structural) interface satisfaction means you often don't write an adapter at all — if a third-party type already has the right method set, it satisfies your consumer-defined interface automatically. When the method signatures don't line up, the adapter is a thin wrapper struct that holds the foreign type and translates calls: a method on your wrapper that adjusts arguments/results and delegates. Compared to nominal languages where you must explicitly declare conformance and frequently write adapters, Go eliminates a lot of adapter boilerplate; you write one only to bridge a genuine signature or semantic mismatch, and even then it's a few lines.

**Key points**
- Factory = constructor returning an interface; centralizes creation + validation
- Adapter wraps a foreign type to satisfy a consumer-defined interface
- Implicit satisfaction means no adapter needed when signatures already match
- Write adapters only for genuine signature/semantic mismatches — minimal boilerplate


```go
// factory returns an interface
func NewStorage(kind string, cfg Config) (Storage, error) {
    switch kind {
    case "postgres": return newPG(cfg)
    case "memory":   return newMem(), nil
    default:         return nil, fmt.Errorf("unknown storage %q", kind)
    }
}

// adapter only when signatures differ
type legacyAdapter struct{ l *LegacyClient }
func (a legacyAdapter) Get(ctx context.Context, id string) ([]byte, error) {
    return a.l.Fetch(id) // translate to the expected signature
}
```

**Follow-ups**
- Why can implicit satisfaction remove the need for many adapters?
- When is a factory function preferable to exposing constructors directly?

---

## Architectural Decisions & Quality

#### 33. What is an ADR (Architecture Decision Record) and why do you maintain them as an architecture owner?

*Difficulty:* 🟡 medium  ·  *Tags:* `adr`, `architecture-decisions`, `documentation`

An ADR is a short, immutable document capturing one significant architectural decision: its context, the options considered, the decision taken, and the consequences/trade-offs. They live in the repo (e.g. `docs/adr/0007-database-per-service.md`), are numbered, and are append-only — you don't edit a past decision, you supersede it with a new ADR that references the old one. As an architecture owner I keep them because architectural choices are exactly the decisions that are expensive to reverse and whose *rationale* is otherwise lost: six months later someone asks "why are we eventually consistent here?" and without an ADR you re-litigate from memory and folklore. ADRs preserve the why, including the alternatives rejected and the constraints that drove the choice, so future engineers can tell whether the original reasoning still holds before changing course. They also force clarity at decision time — writing the trade-offs down surfaces weak reasoning — and they onboard new team members into the architecture's history. They're lightweight by design; the cost is a few paragraphs per decision, which is trivial against the cost of lost context.

**Key points**
- Short immutable record: context, options, decision, consequences
- Lives in repo, numbered, append-only (supersede, don't edit)
- Preserves rationale and rejected alternatives for expensive-to-reverse choices
- Forces clarity at decision time; onboards future engineers into the 'why'

**Follow-ups**
- How do you handle superseding an outdated ADR?
- What makes a decision 'significant enough' to warrant an ADR?

---

#### 34. Walk through SOLID in a Go context. Which principles translate cleanly and which need reinterpreting?

*Difficulty:* 🟠 hard  ·  *Tags:* `solid`, `go-idiom`, `interface-segregation`, `dependency-inversion`

**SRP** (a package/type should have one reason to change) translates directly and maps well to cohesive packages and small types. **OCP** is achieved in Go through interfaces and composition — add a new implementation rather than editing existing code; no inheritance needed. **LSP** still applies to interface implementations: any type satisfying an interface must honor its contract (and Go has no inheritance hierarchies to violate it subtly, which helps). **ISP** is *the* most Go-native principle — `io.Reader`/`io.Writer` are ISP made law; small consumer-defined interfaces are exactly "don't depend on methods you don't use," and Go's implicit satisfaction makes tiny interfaces frictionless. **DIP** is natural via consumer-side interfaces: high-level code defines the abstraction, infrastructure implements it. The reinterpretation: SOLID was written for class-based OO, so "class" becomes "type or package," inheritance-flavored advice (OCP via subclassing) becomes composition/interface advice, and ISP/DIP are almost automatic if you follow "accept interfaces, return structs" and define interfaces at the consumer. The danger is importing the *Java mechanics* of SOLID — abstract base classes, giant interface hierarchies — rather than the principles, which produces un-idiomatic Go.

**Key points**
- SRP/LSP translate directly; OCP via interfaces+composition not inheritance
- ISP is the most Go-native principle (io.Reader; small consumer interfaces)
- DIP is natural with consumer-side interfaces (define abstraction in high-level code)
- Apply the principles, not Java mechanics (no abstract base classes / giant hierarchies)

**Follow-ups**
- How does 'accept interfaces, return structs' embody DIP and ISP?
- Give a Go example where OCP is satisfied without modifying existing code.

---

#### 35. Define coupling and cohesion precisely. How do you evaluate them when reviewing an architecture?

*Difficulty:* 🟠 hard  ·  *Tags:* `coupling`, `cohesion`, `architecture-review`, `quality`

**Cohesion** measures how strongly the elements *within* a module belong together — high cohesion means a package does one well-defined job and its parts change for the same reasons. **Coupling** measures how dependent *separate* modules are on each other — low coupling means a change in one rarely forces changes in others. The design goal is high cohesion + low coupling, and they're related: organizing by feature raises cohesion and, done right, lowers coupling because co-changing code lives together behind a narrow interface. When reviewing, I look at concrete signals: how many packages a typical feature change touches (high = poor boundaries), whether packages reach into each other's concrete types vs. talk through small interfaces, the fan-in/fan-out of packages, import-graph cycles (a coupling smell), and whether shared mutable state or a shared database couples things implicitly. I also distinguish *afferent* vs *efferent* coupling to find unstable hubs. Crucially I weigh the *kind* of coupling — compile-time concrete-type coupling and synchronous runtime coupling are tighter and riskier than async, event-based coupling — because the type of coupling, not just the amount, drives change cost.

**Key points**
- Cohesion = how well a module's parts belong together (change for same reasons)
- Coupling = inter-module dependence (change ripple)
- Signals: packages touched per feature, concrete-type reach-in, import cycles, shared DB/state
- Kind matters: concrete/sync coupling is tighter and riskier than async/event coupling

**Follow-ups**
- Why is async coupling looser than synchronous RPC coupling?
- How do import cycles reveal a coupling problem?

---

#### 36. Contrast synchronous and asynchronous coupling between services. What are the trade-offs and when do you choose each?

*Difficulty:* 🔴 staff  ·  *Tags:* `sync-vs-async`, `coupling`, `resilience`, `event-driven`

Synchronous coupling (REST/gRPC request-response) means the caller waits and depends on the callee being up *right now*, so a slow or down dependency propagates latency and failure upward — failures cascade unless you add timeouts, retries, and circuit breakers. It's simple to reason about, gives immediate consistency and a direct result, and is the right choice when the caller genuinely needs the answer to proceed (a checkout needs the payment authorization result). Asynchronous coupling (events/messages over a broker) decouples in time: the producer emits and moves on, consumers process when able, so a down consumer doesn't fail the producer and you get natural buffering, fan-out, and independent scaling. The cost is eventual consistency, harder debugging (no linear call stack, need tracing), message-ordering and idempotency concerns, and more infrastructure. My rule: use synchronous when you need an immediate answer and the operation can't proceed without it; use asynchronous for notifications, side effects, and cross-aggregate/cross-service consistency where eventual is acceptable. The architectural lever is that async coupling is *looser* — it's how you stop a distributed system from being a distributed monolith — so prefer async for integration unless the use case demands a synchronous result.

**Key points**
- Sync: caller waits, needs callee up now; immediate result/consistency but cascading failure
- Async: time-decoupled, buffering, fan-out, independent scaling; eventual consistency
- Async needs idempotency, ordering care, tracing; sync needs timeouts/retries/breakers
- Sync when you need the answer to proceed; async for notifications/side effects/cross-service consistency

**Follow-ups**
- How do circuit breakers mitigate synchronous cascading failure?
- What makes async consumers require idempotency?

---

#### 37. What is Conway's Law and how does it influence how you draw service and team boundaries?

*Difficulty:* 🔴 staff  ·  *Tags:* `conways-law`, `team-topology`, `service-boundaries`, `organization`

Conway's Law observes that a system's architecture tends to mirror the communication structure of the organization that builds it — teams ship the interfaces along which they communicate. Practically, if three teams own one service, its internal boundaries will drift to match the three teams; if you want clean, independent services aligned to bounded contexts, you should align *teams* to those contexts (the "Inverse Conway Maneuver": shape the org to get the architecture you want). As an architecture owner this means I don't just draw boxes — I check whether the team topology can actually produce and own those boxes. A boundary that requires constant cross-team coordination is fighting Conway's Law and will erode. So I prefer one team owning a bounded context end to end (stream-aligned), keep shared dependencies behind well-defined platform interfaces to minimize coordination, and treat the org chart as part of the architecture. Ignoring this is why technically-sound service splits decay: the org keeps pushing the design back toward its own communication shape.

**Key points**
- Architecture mirrors org communication structure
- Inverse Conway: shape teams to get the architecture you want
- Align one team to one bounded context (stream-aligned) for clean ownership
- Boundaries needing constant cross-team coordination fight Conway and decay

**Follow-ups**
- What is the Inverse Conway Maneuver and when have you applied it?
- How do platform/shared services fit team topologies without recreating coupling?

---

#### 38. How do you reason about and communicate an architectural trade-off — e.g. consistency vs availability, or simplicity vs flexibility?

*Difficulty:* 🔴 staff  ·  *Tags:* `trade-offs`, `consistency-availability`, `simplicity-flexibility`, `architecture-ownership`

I frame every significant decision as an explicit trade-off tied to concrete requirements, not a search for a 'best' architecture — there isn't one, only fits for a context. The method: name the competing forces, tie each to a business requirement and a quality attribute (latency, availability, time-to-market, change cost), evaluate options against those, and write the result as an ADR. For **consistency vs availability**, I start from the actual invariant: payment capture and inventory decrement may demand strong consistency (a transaction or careful idempotent flow), while a product-view counter or a recommendation can be eventually consistent and stay available under partition — so I don't apply one global stance, I decide per data flow. For **simplicity vs flexibility**, I bias toward simplicity and YAGNI because most speculative flexibility is never used and it taxes every future change; I add an extension point only when there's a concrete, near-term second use case. The communication discipline is to make the trade-off and its rationale visible — costs of each option, what we're optimizing for now, and what would change the decision later — so the team buys in and a future engineer can re-evaluate when the context shifts rather than discovering an undocumented constraint.

**Key points**
- No best architecture, only contextual fit; tie forces to business + quality attributes
- Consistency vs availability decided per data flow, not globally (payments strong, counters eventual)
- Simplicity vs flexibility: bias to YAGNI/simplicity; add extension points on concrete need
- Communicate via ADRs: costs, what we optimize for now, what would change the call

**Follow-ups**
- Give an example where you intentionally chose the 'worse' option for a good reason.
- How do you decide a data flow needs strong consistency vs eventual?

---

## E-commerce & Subscription Domain Modeling

#### 39. Model a shopping cart and checkout in an e-commerce domain. What are the aggregates and where are the boundaries?

*Difficulty:* 🟠 hard  ·  *Tags:* `e-commerce`, `cart`, `checkout`, `aggregate-boundaries`

I'd model **Cart** and **Order** as separate aggregates in (likely) separate bounded contexts. The Cart aggregate (root: `Cart`, inner: `CartItem` value objects) enforces cart-local invariants — quantity > 0, item-count limits, applied-promo validity — and is short-lived, mutable, and tolerant of stale pricing because nothing is committed yet. **Checkout** is the application use case that *transforms* a cart into an Order: it re-prices against the catalog at that moment, validates inventory and address, captures payment, and creates the Order aggregate (root: `Order` with immutable `OrderLine` snapshots of price/qty at purchase time). The key boundary decision: Order does *not* reference the live Cart or live Catalog prices — it snapshots them, because an order must be a stable historical record even if catalog prices change tomorrow. Inventory is its own aggregate/context (reserve then confirm), and Payment is external behind a port. So checkout coordinates several aggregates/services in one use case, but each commit touches a single aggregate (cart cleared, order created, inventory reserved), with cross-aggregate steps made consistent via events. This separation keeps the volatile, low-stakes cart distinct from the durable, high-stakes order.

**Key points**
- Cart and Order are separate aggregates (likely separate contexts)
- Cart: short-lived, mutable, tolerant of stale price; enforces cart-local invariants
- Checkout use case transforms cart → Order, snapshotting price/qty into immutable OrderLines
- Order references snapshots, not live cart/catalog; inventory & payment are separate

**Follow-ups**
- Why snapshot prices into the order instead of referencing live catalog prices?
- How do you coordinate cart-clear, order-create, and inventory-reserve consistently?

---

#### 40. How do you design idempotent payment processing so a retried checkout doesn't double-charge?

*Difficulty:* 🔴 staff  ·  *Tags:* `idempotency`, `payments`, `e-commerce`, `reliability`

The core technique is an **idempotency key**: the client generates a unique key per logical checkout attempt and sends it with the request; the server records the key with the result of the first execution and, on any retry with the same key, returns the stored result instead of re-executing. Concretely: on a charge request you `INSERT` the idempotency key into a table with a unique constraint inside the same transaction that creates the payment intent — if the insert conflicts, you've seen this key, so you return the prior outcome rather than charging again. The payment gateway itself should also support idempotency keys (Stripe does) so the charge is deduplicated end to end, not just at your boundary. You must also handle the in-flight race (two concurrent requests with the same key): the unique constraint or a row lock serializes them, and the second waits and reads the first's result. Tie this to the outbox so the `PaymentCaptured` event is emitted exactly once with the same transaction. The trade-off is extra storage and care around key scope/expiry, but for money this is non-negotiable: retries, network timeouts, and at-least-once message delivery make double-execution otherwise inevitable. Idempotency turns at-least-once into effectively-once for the side effect that matters.

**Key points**
- Client-supplied idempotency key; store key + first result, replay on retry
- INSERT key with unique constraint in the same tx that creates the payment intent
- Push idempotency to the gateway too (e.g. Stripe idempotency keys) for end-to-end dedupe
- Unique constraint/row lock serializes concurrent same-key requests; pair with outbox for once-only events


```go
func (s *PaymentService) Capture(ctx context.Context, cmd CaptureCmd) (Receipt, error) {
    if prev, ok, err := s.store.Lookup(ctx, cmd.IdemKey); err != nil {
        return Receipt{}, err
    } else if ok {
        return prev, nil // replay — do not charge again
    }
    // unique constraint on idem_key makes the first writer win on a race
    rec, err := s.gateway.Charge(ctx, Charge{Amount: cmd.Amount, IdemKey: cmd.IdemKey})
    if err != nil { return Receipt{}, err }
    return rec, s.store.Save(ctx, cmd.IdemKey, rec)
}
```

**Follow-ups**
- How do you handle two concurrent requests carrying the same idempotency key?
- What is the right scope and expiry for an idempotency key?

---

#### 41. Model subscription billing cycles. How do you handle plan changes, proration, renewals, and failed payments?

*Difficulty:* 🔴 staff  ·  *Tags:* `subscription`, `billing-cycle`, `dunning`, `proration`

I'd center a **Subscription** aggregate whose root holds the current `Plan`, a `BillingCycle` value object (period start/end, interval), and status (`Trialing`, `Active`, `PastDue`, `Canceled`). Renewals are driven by time, not user action, so a scheduler/clock (often event- or cron-driven) emits a `CycleEnded` event that the billing use case handles: it generates an invoice, attempts payment via the idempotent payment port, and on success advances the cycle. **Plan changes** mid-cycle are modeled explicitly — upgrade/downgrade computes **proration** as a value-object calculation (unused time on the old plan credited, new plan charged for the remainder) and you decide policy: charge immediately or defer to next cycle. **Failed payments** drive a **dunning** state machine: on failure the subscription goes `PastDue`, retries are scheduled with backoff over a grace window, customer notifications fire, and after exhausting attempts it transitions to `Canceled`/`Suspended` — all explicit domain transitions, not ad-hoc flags. Key design points: money math and dates are value objects with tested invariants (no float currency, time-zone-correct period boundaries), all transitions emit domain events for downstream (entitlements, emails, analytics), and payment attempts are idempotent so retries don't double-bill. The whole thing is a state machine plus a clock, and modeling it explicitly is what keeps billing — the part customers notice most — correct.

**Key points**
- Subscription aggregate: Plan + BillingCycle VO + explicit status state machine
- Time-driven renewals via scheduler/event → invoice → idempotent charge → advance cycle
- Plan changes compute proration as a tested value-object calc; choose charge-now vs next-cycle
- Failed payments drive a dunning state machine (PastDue → retries/backoff → Canceled); events for entitlements/notifications

**Follow-ups**
- How do you make renewal charges idempotent against retries and duplicate scheduler fires?
- Where does proration math live and why a value object?

---
