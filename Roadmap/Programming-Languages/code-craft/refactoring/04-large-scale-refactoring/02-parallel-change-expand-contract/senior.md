# Parallel Change (Expand / Contract) — Senior

> **Source:** Danilo Sato, "ParallelChange"; Martin Fowler, martinfowler.com/bliki/ParallelChange.html

At senior scale the callers aren't methods in your repo — they're *other teams,
other services, other release trains*, and the persisted state is *production data*
you can't lose. Parallel Change becomes a coordination and data-integrity problem,
not a refactoring trick. This level covers contract evolution across services,
consumer-driven contracts, sequencing the expand/contract across organizational
boundaries, surviving long-running parallel windows, and keeping data integrity
through the migration.

## Contents

1. [The unit of parallelism is the contract, not the code](#1-the-unit-of-parallelism-is-the-contract-not-the-code)
2. [Producer/consumer sequencing across services](#2-producerconsumer-sequencing-across-services)
3. [Consumer-driven contracts as the completion oracle](#3-consumer-driven-contracts-as-the-completion-oracle)
4. [Sequencing the change across teams](#4-sequencing-the-change-across-teams)
5. [Long-running parallel windows](#5-long-running-parallel-windows)
6. [Data integrity through the window](#6-data-integrity-through-the-window)
7. [Where Branch by Abstraction and Strangler fit](#7-where-branch-by-abstraction-and-strangler-fit)
8. [When NOT to (at this scale)](#8-when-not-to-at-this-scale)
9. [Next](#next)

---

## 1. The unit of parallelism is the contract, not the code

In one repo, "old and new coexist" means two methods. Across a system, the thing
that must coexist is the **contract**: the wire shape of an API, the schema of an
event, the columns of a shared database. The deploys of producer and consumers are
*independent and unordered*, so the only thing they agree on is the contract. Your
job is to evolve that contract so that **any combination of old/new producer with
old/new consumer is valid during the window**.

The four-quadrant test. List the deploy combinations that will exist
simultaneously and require each to work:

| | Old consumer | New consumer |
|---|---|---|
| **Old producer** | works (today) | new consumer must tolerate old form |
| **New producer** | old consumer must tolerate new form | works (target) |

EXPAND exists precisely to make the two off-diagonal cells valid. If either
off-diagonal cell breaks, your "expand" was actually a breaking change and you'll
take an outage during the rollout. This is the same insight as **forward and
backward compatibility**: the new code reads old data (backward compatible), and old
code tolerates new data (forward compatible). Schema registries with
`FULL`/`FULL_TRANSITIVE` compatibility enforce exactly this for events.

---

## 2. Producer/consumer sequencing across services

The order of the parallel change *reverses* depending on who reads vs. writes the
contract. Get the order wrong and you break a quadrant.

**Adding/changing a field a consumer must read (producer leads):**

1. Producer EXPANDs: emit both old and new (or emit new field additively).
2. Consumers MIGRATE: deploy to read new (with fallback to old).
3. Producer CONTRACTs: stop emitting old — *only after every consumer reads new*.

**Requiring consumers to send a new field (consumer leads / "tolerant reader"):**

1. Producer EXPANDs: accept both — present *and absent* new field (default it).
2. Consumers MIGRATE: start sending the new field.
3. Producer CONTRACTs: make the field required / reject the old shape — *only after
   every consumer sends it*.

The invariant: **the side that removes support contracts last, and only after the
other side has fully migrated.** Whoever the change "depends on" goes first; the
party imposing the requirement tightens last. Sequencing this wrong (e.g. producer
requires a field before consumers send it) is the single most common cause of a
"parallel change" that still causes an outage.

---

## 3. Consumer-driven contracts as the completion oracle

The hard senior question is **"how do I *know* every consumer has migrated?"** —
across teams you don't control. Telemetry on the old path (the middle-level answer)
tells you *current* usage but not *capability*: a consumer might not have sent the
old shape today but still depends on it for an edge case tomorrow.

**Consumer-driven contract testing** (e.g. Pact) makes capability explicit. Each
consumer publishes the contract it actually relies on; the provider verifies against
*all* registered consumer contracts in CI.

- During EXPAND, the provider supports the union of all consumer contracts (old +
  new). CI is green because the provider satisfies every consumer.
- A consumer migrating means it *publishes a new contract* that no longer mentions
  the old field.
- The provider may CONTRACT (drop the old field) only when **no registered consumer
  contract references it** — and "can I break compatibility?" tooling (Pact's
  `can-i-deploy`) answers this mechanically in the pipeline.

This turns "is the migration done?" from a polling-the-dashboard guess into a
pipeline gate: the build itself refuses to let you contract while a consumer still
depends on the old form. Combine both signals — contracts prove *capability* is gone,
telemetry proves *traffic* is gone.

---

## 4. Sequencing the change across teams

A contract change crossing N teams is a small program of work. Treat the EXPAND as a
*platform-provided affordance* and the MIGRATE as *distributed work you can't do
yourself*:

1. **Own the expand.** The contract owner ships the additive, dual-supporting
   version. This is the only step you can do unilaterally, and it unblocks everyone
   else without forcing them.
2. **Publish a migration guide + deadline.** Replacement mapping, examples, the
   sunset date, and a self-service way to check "am I migrated?" (a contract test, a
   linter, a dashboard filtered to their service).
3. **Make migration cheap.** A shared client library that already speaks the new
   form, a codemod, a default that does the right thing — every hour you save a
   consuming team multiplies by N teams and shortens the window.
4. **Track per-consumer.** A burndown of consumers-on-old. Nudge the long tail
   individually; the last 10% is 90% of the calendar time.
5. **Own the contract — with a backstop.** Publish the sunset date. If a team blows
   the deadline, escalate; do not silently extend the window forever, but also do
   not contract while a real dependency remains (that's just choosing the outage).

The Mikado Method (sibling `03`) is how you map this dependency graph *before*
committing to an order; see [The Mikado Method — Senior](../03-mikado-method/senior.md).

---

## 5. Long-running parallel windows

Some windows last *months*: a partner SDK on a quarterly release cadence; a mobile
app where 5% of users never update; a 90-day-retention event topic. Plan for the
window as a first-class state, not a brief inconvenience:

- **Budget the carrying cost.** Dual-write code, both schemas, reconciliation jobs,
  two test matrices — these are liabilities you pay for every day the window is open.
  Track it; an indefinitely open window is a slow-motion tech-debt leak.
- **Force a forcing function.** Hard sunset dates, kill-switch flags for the old
  path, version pinning, "minimum supported client" gates. Without a forcing
  function the long tail never ends.
- **Make the old path *visibly* deprecated** so nobody builds *new* dependencies on
  it during the window (lint that fails on new usage; the old API returns a
  `Sunset` header; the old column is documented as frozen).
- **Re-baseline.** If the window will outlive several releases, make the new form the
  default and the old form opt-in early, so new work lands on new form automatically
  and the migration shrinks itself.

The danger of a long window isn't the duration — it's **accreting new dependencies
on the old form** while it's open. Freeze the old form against new callers.

---

## 6. Data integrity through the window

Dual-write across stores is where senior systems quietly corrupt data. The instant
the old and new forms live in *different* transactional domains, you've lost
atomicity:

- **Same store, one transaction:** trivially consistent. Prefer this whenever
  possible — keep the new column in the same DB as the old.
- **Different stores (DB + index, DB + cache, two services):** dual-write is *not*
  atomic. A crash between the two writes leaves them divergent. Use the **transactional
  outbox** (write the new form's intent into the same DB transaction as the old, then
  a relay publishes it) or CDC off the DB log — so the new store is *derived* from the
  authoritative one, not independently written.
- **Reconcile continuously.** A periodic job comparing old vs. new and emitting a
  `drift` metric. Drift > 0 during the window is a bug to fix *before* you switch
  reads, and an absolute blocker to contracting. "We dual-write, so it's fine" is the
  assumption that bites; measured zero-drift is the fact that lets you proceed.
- **Switch reads behind a flag, ramped.** Don't flip 100% of reads to the new form
  at once. 1% → 10% → 50% → 100%, comparing results (shadow reads) at each step. This
  is the read-side equivalent of a canary and catches backfill/derivation bugs while
  the blast radius is small.
- **Keep the old form correct until contract.** The whole rollback story is "redeploy
  the previous version, which reads the old form." That only works if dual-write kept
  the old form fresh right up to the contract. Stop dual-writing the old form *only*
  in the dedicated stop-dual-write step, after reads are fully and durably on new.

---

## 7. Where Branch by Abstraction and Strangler fit

These three are one toolkit; senior fluency is choosing among them:

- **Branch by Abstraction** introduces a stable seam (interface) and swaps the
  *implementation* behind it while callers are untouched. Use it when the thing
  changing is *behavior/implementation*. Parallel Change changes the *contract/shape*
  itself. Frequently combined: hold the seam stable with Branch by Abstraction while
  you parallel-change the data or protocol underneath. See
  [Branch by Abstraction — Senior](../01-branch-by-abstraction/senior.md).
- **Strangler (at code level)** grows a new component beside an old one and routes
  traffic across incrementally; each routing step is a parallel change. See
  [Strangler at Code Level — Senior](../04-strangler-at-code-level/senior.md).
- **Keeping the system shippable** (sibling `05`) is the discipline that makes all of
  this viable: every intermediate state is releasable, which is exactly what
  expand/migrate/contract guarantees. See
  [Keeping the System Shippable — Senior](../05-keeping-the-system-shippable/senior.md).

For introducing the seam you'll often reach for an
[Adapter](../../../design-patterns/02-structural/01-adapter/junior.md) or
[Facade](../../../design-patterns/02-structural/05-facade/senior.md) so old and new
contracts present a single face to callers during the window.

---

## 8. When NOT to (at this scale)

- **You own producer and all consumers and ship them together** (a single-team
  service mesh with synchronized deploys, no persisted contract state) → coordinated
  single release beats a parallel window's carrying cost.
- **The contract is genuinely internal and unversioned** with no clients, no
  persisted events, no shared DB → just change it.
- **The migration's organizational cost dwarfs the risk** — a tiny low-traffic
  change where the worst case is a trivial, instantly-reversible blip. Don't spin up
  contract tests, dual-writes, and a multi-team burndown for that.

The senior judgment: Parallel Change buys *independent deployability and safe
rollback across a boundary you can't atomically cross*. If your change doesn't cross
such a boundary, you're paying for insurance you don't need.

---

## Next

- Economics, observability, rollback, and real at-scale playbooks:
  **[professional.md](professional.md)**.
- Map the dependency graph first: [The Mikado Method — Senior](../03-mikado-method/senior.md).
