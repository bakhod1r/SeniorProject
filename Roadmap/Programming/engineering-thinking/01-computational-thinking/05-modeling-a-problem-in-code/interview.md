> Interview questions on **modeling a problem in code** — turning a real-world problem into a representation a computer can operate on. These probe whether you reach for the right *category* of representation, can encode invariants in types, understand the impedance mismatch, and know what a wrong model costs. Answers are deliberately short; the follow-ups are where the depth is.

---

## Q1. Why is the data-structure choice often more important than the algorithm?

Because the representation determines which operations are cheap, which are expensive, and which are *impossible*. Algorithms follow from data shape — Rob Pike: *"Data dominates... the algorithms will almost always be self-evident"*; Brooks: *"Show me your tables and I won't usually need your flowcharts."* A good representation makes invariants free and queries O(1); a bad one turns every feature into a special case no algorithm can rescue.

**Follow-up — "Always?"** No. Once the representation is fixed, algorithm choice dominates *within* it. The point is precedence: pick the structure first, because it bounds everything downstream.

---

## Q2. Walk me through deciding *what kind* of structure a problem is.

Ask what the dominant operations are. "Things connected by relationships, need reachability/paths" → graph. "Moves between named states on events" → state machine. "Containment/hierarchy" → tree. "What happened over time, need history/audit" → event log. "Dense numeric, neighbor-by-coordinate" → matrix. "Independent records by id" → table/map. The category decision precedes the field-level design and is the most consequential.

**Trap:** modeling a permission system as boolean flags (`can_edit`, `can_delete`) instead of relations/edges `(subject, action, resource)`. The flags make "who can edit this?" a full scan; edges make it a lookup.

---

## Q3. "Make illegal states unrepresentable" — what does it mean and how do you do it?

Shape the types so an invalid value can't be constructed, instead of allowing it and validating at runtime. Tools: sum types / tagged unions (each state carries exactly its data), value objects with validation in the constructor, non-nullable fields, newtypes (`AccountId` not `str`). Phrase from Yaron Minsky; developed in Wlaschin's *Domain Modeling Made Functional*.

**Example:** "contact must have email or phone or both" → model as `EmailOnly | PhoneOnly | Both`, so "neither" doesn't exist in the type space.

**Follow-up — "Limits?"** Invariants spanning aggregates or needing external state (uniqueness, cross-row sums) can't live in one type — enforce those at the aggregate/transaction/DB-constraint boundary. Over-encoding produces type-tetris that's as rigid as the bugs it prevents.

---

## Q4. Model an order that's a cart, then paid, then shipped. What's the wrong way?

**Wrong:** one struct with `status: str` plus `paid_at`, `tracking` as nullable fields. This makes "shipped order with no tracking" and "cart with a paid_at" representable — bugs by construction.

**Right:** one type per state — `Cart{items}`, `Paid{items, paid_at}`, `Shipped{items, paid_at, tracking}` — as a sum type. Each state carries exactly its data; transitions become functions `Cart → Paid → Shipped`. The state machine is enforced by the types, not by hope.

---

## Q5. Entity vs. value object — what's the test, and why does it matter?

An **entity** has identity that persists through change (a `User` is the same user after a rename). A **value object** is defined entirely by its attributes and is interchangeable when equal (`Money(10, "USD")`, a `DateRange`) — typically immutable. Test: *"If two of these have the same fields, are they the same thing?"* Yes → value; no → entity.

**Why it matters:** confusing them causes real bugs — deduping users by name (treating an entity as a value), or giving an id to something that should compare by value (needless identity). Vocabulary is from Evans's *Domain-Driven Design*.

---

## Q6. What is the impedance mismatch and how do you manage it?

The same concept has three different shapes: the rich in-memory model (sum types, methods, cycles), the wire format (flat JSON/protobuf, strings, no cycles), and the database (tables, rows, foreign keys, nullable columns). They rarely line up. You don't eliminate it — you put translation at an explicit boundary, keep the rich model in the core, and map to/from the DB and wire shapes. The failure mode is letting the flat DB shape leak back and flatten your in-memory model.

---

## Q7. "All models are wrong, some are useful." What does that mean for an engineer?

George Box. A model is a deliberate simplification — you choose what to capture and what to discard. You can't and shouldn't represent everything; you keep what the operations need. The engineering judgment is *fidelity vs. simplicity*: more fidelity buys correctness in edge cases and costs complexity and changeability everywhere. Spend fidelity on the core domain; keep supporting concerns simple.

---

## Q8. How do you know early that you've chosen the wrong model?

The tell is uniform: **every new feature arrives as a workaround, not an extension.** Concrete signals: discriminator sprawl (`if type == ...` chains, "only-set-when" nullable fields); the same fact stored in two places kept in sync by code; cross-cutting queries the model can't answer without a full scan; derived data stored and drifting. Read it off the diff history — if workaround count rises with feature count, the model is the bottleneck.

**Follow-up — "What do you do?"** Treat it as a model defect, not a local bug. Remodel early while little depends on it; the cost of fixing scales with data volume and consumer count, both only growing.

---

## Q9. Model a chess board. Which representation, and why?

No single one is best. A square→piece **8×8 array** makes "what's on e4?" O(1) and rendering trivial, but "all white knights?" an O(64) scan. A piece→square **map** inverts those costs. Real engines keep **both**, updated together at the write boundary — a primary store plus a derived index — accepting bookkeeping cost so every read is fast.

**Lesson:** when no single structure makes all operations cheap, maintain a primary representation plus synchronized secondary indexes. (That's exactly what a database does for you.)

---

## Q10. How do you model a calendar with recurring events?

Don't materialize recurrences into stored intervals — "every Tuesday forever" explodes into thousands of rows you'd have to migrate to change. Model the **rule** (an RRULE-style recurrence) plus **exceptions** (cancellations/overrides), and *expand lazily* over the queried window. Separate the rule from its materialization: the rule is small and editable; the expansion is regenerable. For "is `t` free?" / "next free slot," back it with an interval tree over the materialized window.

**Trap:** the naive "list of busy intervals" model is fine for one feature and collapses the moment recurrence, ownership, or next-slot queries appear.

---

## Q11. When would you choose an event-sourced model over a state (CRUD) model?

When the **history is the product**: ledgers, audit-heavy/regulated domains, collaborative editing, anything needing replay or new read models derived after the fact. Events give you native history, auditability, and cheap new projections. The cost: current state must be folded from the log, plus real operational complexity (versioning, snapshots, replay), and the event schema is a **permanent commitment** — you can't rewrite immutable history. Use CRUD where current state genuinely suffices; don't adopt event sourcing as fashion.

---

## Q12. You're consuming a shared schema/event used by five teams. A field needs a new meaning. What do you do?

Never repurpose the field — that's silent corruption for every existing consumer. **Add** a new field, populate both during transition, migrate consumers, then deprecate the old one explicitly. Treat the schema as a public API: enforce a compatibility policy (backward/forward) in CI via a registry, make readers tolerant of unknown fields, and give the contract a named owner. The model's reach is its liability — every consumer is a dependency you can't break unilaterally.

---

## Q13. How do you migrate a wrong model in production without downtime?

**Expand/contract (parallel change):** (1) add the new shape, unused; (2) dual-write old and new; (3) backfill historical data (chunked, throttled, idempotent, resumable); (4) move reads to the new shape, verifying against the old via shadow comparison; (5) stop writing old and drop it. Never mutate in place. For deeply wrong core models, introduce the correct model in a new bounded context and strangle the legacy one behind a translation layer.

---

## Q14. Where does modeling sit relative to the other computational-thinking skills?

It's the synthesis step. Decomposition produces the entities and boundaries; pattern recognition names the category (graph? state machine?); abstraction decides what to keep vs. discard (fidelity); algorithmic thinking is what the chosen representation then makes cheap or impossible. Modeling is where all four cash out into concrete types and relationships.

---

## Q15. A junior shows you a model where `status` is a string and there's also an `is_done` boolean. What's wrong, and what's the principle?

Two fields encode the same fact and can disagree (`status == "done"` but `is_done == False`), and `status` can be misspelled. The fix: a single source of truth — an enum/sum type for status, and derive "done-ness" from it. **Principle:** don't store a fact twice; don't represent values that can contradict each other. Make the contradiction unconstructable rather than guarding it with scattered `if`s.

---

**See also:** [Modeling — senior](./senior.md) · [Modeling — professional](./professional.md) · [Pattern recognition](../02-pattern-recognition/) · [Domain modeling from requirements](../../08-object-thinking/06-domain-modeling-from-requirements/) · [Roadmap home](../../README.md)
