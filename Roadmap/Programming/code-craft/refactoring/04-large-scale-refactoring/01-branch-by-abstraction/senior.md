# Branch by Abstraction — Senior

> **Source:** Paul Hammant, "Branch by Abstraction"; Jez Humble & David Farley, *Continuous Delivery*

At the senior level, Branch by Abstraction stops being a mechanical recipe and becomes a *planning instrument*. The mechanics (see [junior.md](junior.md)) are trivial; the hard parts are choosing the seam, sequencing the work, coordinating it across a team and across multiple simultaneous migrations, and making sure the abstraction you introduce reinforces — rather than fights — your architecture's real boundaries.

---

## Choosing the seam is the whole game

A Branch by Abstraction is only as good as its seam. Get the seam right and the migration is a sequence of boring small commits. Get it wrong and you spend the whole migration fighting a leaky interface.

Principles for placing the seam:

- **Define the interface by what clients depend on, not by what the old class exposes.** The old `JdbcOrderDao` might have twelve public methods, but if clients only use four, the seam is those four. A narrower seam is easier to satisfy with a new implementation and reveals the *real* contract. Run the interface across actual call sites before committing to its shape.
- **Put the seam on a true boundary.** The best seams sit where a module boundary already wants to be — persistence, external I/O, a pricing/policy engine. If your seam cuts across a natural unit (half a class's responsibility on each side), the abstraction will feel arbitrary and leak.
- **Keep the contract free of the old technology's accidents.** If the interface leaks JDBC `SQLException` or connection lifecycles, the new impl is forced to fake them. Capture *semantic* operations ("save this order", "find orders for customer"), not *mechanical* ones ("open connection", "execute statement").
- **Resist a god-interface.** If the seam needs twenty methods to capture everything every client does, that's a signal the component has too many responsibilities. Consider splitting it into several smaller migrations (several seams) rather than one giant one.

> **When NOT to seam yet:** if you can't articulate a clean contract because the component's responsibilities are genuinely tangled, the prerequisite work is *decomposition*, not abstraction. Abstracting a mess just gives you an abstract mess.

---

## Sequencing one migration

Within a single Branch by Abstraction, sequence to **minimize the coexistence window** and **maximize early signal**:

1. **Migrate read paths before write paths.** Reads are idempotent, so you can shadow-compare them (see [middle.md](middle.md), variant C) and build confidence in the new impl cheaply before risking mutations.
2. **Cut over the lowest-risk, highest-observability client first.** An internal admin tool or a background job gives you production signal with a small blast radius.
3. **Keep Phase 3 short by shipping the new impl incrementally too.** The new implementation can itself land across many commits behind the (off) flag — you don't need it complete before any of it is on trunk.
4. **Schedule Phase 5 as part of the same effort.** The instant the flag hits 100% and bakes, removal work starts. Treat the gap between "100%" and "old impl deleted" as a leak you're actively closing.

---

## Sequencing *multiple* migrations

The senior-distinct problem: you rarely run one Branch by Abstraction in isolation. A platform migration might require swapping persistence, the messaging client, *and* the auth provider — possibly with dependencies between them.

- **Use the Mikado Method to discover the order.** Branch by Abstraction tells you *how* to swap one component; the [Mikado Method](../03-mikado-method/junior.md) tells you *which* component must be swapped first by surfacing the dependency graph of the larger change. Run Mikado to get the order; run Branch by Abstraction at each node.
- **Avoid overlapping coexistence windows on the same code paths.** Two simultaneous migrations both flagging the same hot path multiply your test matrix (2 flags = 4 combinations) and make incidents hard to diagnose. Serialize migrations that touch the same surface; parallelize only those on independent boundaries.
- **Limit the number of in-flight migration flags per team.** Each open migration is cognitive load and a drift risk. A team carrying ten half-finished Branch-by-Abstraction efforts has effectively recreated the long-lived-branch problem in flag form. Cap WIP.
- **Make the abstractions compose, not collide.** If migration A introduces `OrderRepository` and migration B introduces `PaymentGateway`, those are independent seams and compose cleanly. If both want to redefine the same `OrderService` boundary, you have a sequencing conflict to resolve before either starts.

---

## Interaction with architecture and module boundaries

A Branch by Abstraction is a chance to *improve* your architecture, or to *entrench* a bad boundary. Be deliberate about which.

- **Permanent seams = architecture.** A persistence interface, an external-service gateway, or a policy/strategy boundary that you'll keep after Phase 5 is a real architectural decision. Place it where your dependency rule wants it (e.g., domain depends on the interface, infrastructure implements it — a ports-and-adapters arrangement). When the migration is done, you've left the codebase with a *better* boundary than you found.
- **Scaffolding seams = temporary.** If the interface exists only to host the swap (two impls of something that should obviously be one), plan to inline it in Phase 5. Don't let migration scaffolding masquerade as architecture; future readers will mistake an accident for an intention.
- **The seam can reveal a misplaced boundary.** If you go to extract the interface and discover clients reach into the component in wildly different ways, the component's boundary is wrong. That discovery is valuable — but it may turn a "swap one component" job into a "fix the boundary first" job. Surface that early; don't paper over it with a leaky interface.

For deciding whether the post-migration abstraction is a keeper, the structural-pattern lens helps: a long-lived seam is usually a [Strategy](../../../design-patterns/03-behavioral/08-strategy/junior.md) (interchangeable algorithms/policies) or a port behind which adapters live. See [refactoring to structural patterns](../../03-refactoring-to-patterns/03-structural/junior.md).

---

## Relationship to Strangler at scale

Branch by Abstraction and the [Strangler pattern](../04-strangler-at-code-level/junior.md) are the same instinct at different altitudes:

- **Branch by Abstraction** swaps a *component inside one codebase* behind an interface.
- **Strangler** swaps an *entire application or service* behind a routing/facade boundary, often spanning process and deployment boundaries.

The senior skill is recognizing the altitude. If the thing you're replacing is a class or module, you want Branch by Abstraction. If it's a whole subsystem with its own data store and lifecycle, the seam lives at the network/routing edge and you want Strangler — though *inside* each strangled slice you'll often run Branch by Abstraction again. They nest.

---

## What "done" means, and policing it

The senior failure mode is not technical — it's *organizational incompletion*. Define done crisply and hold the line:

- **Done = Phase 5 complete:** old impl deleted, flag removed, abstraction consciously kept-or-inlined, no dual code paths remain.
- **Track migrations to completion** the way you track features. A migration stuck at "95% rolled out" for two quarters is a liability that compounds.
- **Budget the cleanup before you start.** If the team can't afford Phase 5, it can't afford to start Phase 1.

---

## When NOT to (senior framing)

- **The boundary is wrong.** Don't abstract across a misplaced seam; fix the decomposition first.
- **Too many in-flight migrations.** If WIP is already high, finishing existing migrations beats starting another — open coexistence windows are the real risk, not the next swap.
- **The replacement isn't substitutable.** If old and new have genuinely incompatible semantics (different consistency/transactional guarantees), one interface can't honestly cover both; that's a deeper migration (e.g., dual-write with reconciliation), not a Branch by Abstraction.
- **A whole-system replacement.** Use Strangler at the system edge; reserve Branch by Abstraction for component-level swaps inside it.

---

## Next

- [professional.md](professional.md) — economics, flag lifecycle and debt, observability, rollback playbook, team practices.
- [interview.md](interview.md) — questions and model answers.
- [tasks.md](tasks.md) · [find-bug.md](find-bug.md) · [optimize.md](optimize.md)
- Planning sibling: [Mikado Method](../03-mikado-method/junior.md) · System-scale sibling: [Strangler at code level](../04-strangler-at-code-level/junior.md) · [Keeping the system shippable](../05-keeping-the-system-shippable/junior.md)
