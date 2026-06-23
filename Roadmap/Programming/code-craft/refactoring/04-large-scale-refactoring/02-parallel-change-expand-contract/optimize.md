# Parallel Change (Expand / Contract) — Optimize

> **Source:** Danilo Sato, "ParallelChange"; Martin Fowler, martinfowler.com/bliki/ParallelChange.html

Seven "before" change situations. For each, decide whether Parallel Change is
warranted, and if so propose the concrete expand/migrate/contract plan — *or* argue
against it and pick the simpler move. The senior skill is knowing when the parallel
window earns its cost.

---

## Situation 1 — Rename a private helper used in one class

**Before.** `private double calc(double x)` should be named `applyTax`. It's called
in four places, all in the same class. An engineer proposes: add `applyTax`,
deprecate `calc`, migrate callers over three PRs, then delete `calc`.

**Optimize — argue against.** Parallel Change is the wrong tool. There are no
external callers, no persisted state, no independent deploys — you own all four call
sites and can change them atomically. **Just rename it** (IDE rename refactor, one
commit). The three-PR dance adds churn and a deprecation annotation for zero safety
benefit. *Rule: when you control every caller and the change is atomic, change it
directly.*

---

## Situation 2 — Add a non-null `timezone` field that clients must send

**Before.** Your API's `POST /reminders` should require a new `timezone` field.
Engineer wants to immediately make it required and reject requests without it.
External mobile apps (which you can't force-update) call this endpoint.

**Optimize — Parallel Change, consumer-leads ordering.**

1. **EXPAND:** server *accepts both* — `timezone` present or absent. When absent,
   default sensibly (e.g. account timezone or UTC) and log/count the defaulted
   requests per client. The server is now tolerant.
2. **MIGRATE:** ship new app versions that send `timezone`; track the
   "defaulted-because-absent" counter burning down per client/app-version.
3. **CONTRACT:** when no client omits the field across a full cycle *and* you've
   sunset the old app versions (or accept that the default is fine forever), tighten
   to required.

Making it required up front would 400 every installed app instantly. The producer
expands by being tolerant; it tightens *last*.

---

## Situation 3 — Drop an unused-looking column from a 200M-row table

**Before.** `events.legacy_ip` "looks unused" — grep of the app finds no reads.
Engineer proposes `ALTER TABLE events DROP COLUMN legacy_ip` next deploy.

**Optimize — Parallel Change's *contract* discipline, not a full window.** There's
nothing to expand (you're only removing), but the **gate before Contract** still
applies. "Grep finds no reads" misses: dynamic/ORM queries, BI/analytics jobs hitting
the DB directly, replicas feeding a warehouse, ad-hoc reporting. Plan:

1. Add a usage probe (DB query logging / column-access audit) and announce a sunset
   date to data consumers.
2. Watch for any reader across a full cycle (include monthly reports).
3. Back up, then drop — and on a 200M-row table, verify the `DROP` is metadata-only on
   your engine (it usually is) rather than a full rewrite.

The lesson: *Contract is gated on evidence even when there's no Expand.* "Looks
unused" is a hunch, not evidence.

---

## Situation 4 — Change password hash from bcrypt to argon2

**Before.** You want to upgrade the stored password hash algorithm. You can't
re-hash existing passwords (you don't have the plaintext). Engineer proposes a
flag-day migration.

**Optimize — Parallel Change, migrate-on-use.** You cannot backfill (no plaintext),
so the migration happens lazily at the only moment you *have* the plaintext: login.

1. **EXPAND:** store an algorithm tag per row. Verification understands *both* bcrypt
   and argon2 (dispatch on the tag). New signups use argon2.
2. **MIGRATE (lazy):** on each successful login, if the stored hash is bcrypt,
   re-hash the just-verified plaintext with argon2 and update the row + tag. Track the
   count of remaining bcrypt rows.
3. **CONTRACT:** when bcrypt rows reach ~0 (the long tail = dormant accounts), drop
   bcrypt support — or, more realistically, keep the bcrypt *verifier* indefinitely
   for dormant users and only retire it after forcing a reset on the remainder.

This is Parallel Change where the backfill is *event-driven* (login) rather than a
batch job, because the data needed to migrate only exists transiently.

---

## Situation 5 — Move a hot field from Postgres to Redis for read scaling

**Before.** `users.session_count` is read on every request and the writes are
hammering the primary. Engineer wants to "just move it to Redis" — flip reads and
writes to Redis in one deploy.

**Optimize — Parallel Change across stores, with cross-store care.** The one-deploy
flip risks data loss (a crash mid-cutover) and has no rollback. Because old and new
are *different stores*, dual-write is not atomic — handle that explicitly:

1. **EXPAND:** write to both Postgres and Redis. Since you can't transactionally write
   both, make Redis *derived*: keep Postgres authoritative and update Redis via the
   same code path (best-effort) plus a reconciliation job. Reads still from Postgres.
2. **MIGRATE:** warm Redis (backfill from Postgres), verify drift = 0, then switch
   reads to Redis ramped (1%→100%), shadow-comparing against Postgres.
3. **CONTRACT:** once reads are stable on Redis and you've decided Redis is
   authoritative, stop writing Postgres — *but* keep a durable record if you can't
   afford to lose the value on a Redis flush.

Argue partially against the premise too: if the value is cheap to recompute,
*caching* it in Redis (Postgres remains source of truth) may beat *moving* it.

---

## Situation 6 — Split a `User` service into `User` + `Profile` services

**Before.** A monolith's `User` aggregate is being split: profile data moves to a new
`Profile` service. Twelve internal services call `userService.getProfile()`. Engineer
proposes pointing them all at the new service in a coordinated big-bang release.

**Optimize — Parallel Change at the contract level, sequenced.** A 12-service
big-bang has no safe rollback and requires impossible deploy synchronization.

1. **EXPAND:** the new `Profile` service exists and is populated (dual-write profile
   changes to both the monolith and `Profile`, or CDC-replicate). The old
   `getProfile()` still works.
2. **MIGRATE:** move callers *one at a time* to the new service; each is an
   independent, reversible deploy. Track per-caller usage of the old `getProfile()`.
3. **CONTRACT:** when old-`getProfile()` traffic = 0, retire it and stop dual-writing
   the monolith copy.

Hold the seam stable with **Branch by Abstraction** (callers depend on a `Profiles`
interface, swap its implementation from monolith-backed to service-backed) so each
caller's switch is a config flip; see
[Branch by Abstraction — Senior](../01-branch-by-abstraction/senior.md). Use the
Mikado Method to map the 12-caller dependency graph first:
[The Mikado Method — Junior](../03-mikado-method/junior.md).

---

## Situation 7 — Tiny internal config-shape change in a single service

**Before.** A single service reads a config blob; you want to nest one key under a new
parent. The service is deployed as one unit; nothing else reads this config; worst
case on a bad deploy is the service fails fast at startup and you redeploy in 90
seconds. Engineer proposes a full expand/migrate/contract with fallback-reads and a
deprecation window.

**Optimize — argue against.** Price the window. The failure mode is *reversible in
90 seconds* and reaches *no boundary you can't cross atomically* (one service, one
deploy, no persisted state, no other readers). The carrying cost of fallback-read
code + a deprecation window exceeds the risk removed. **Just change the config shape
and the reader in one deploy**, with a startup validation that fails fast on the old
shape. Reserve Parallel Change for changes touching persisted data or
independently-deployed consumers.

---

## The optimization heuristic

Apply Parallel Change when the change **crosses a boundary you can't cross
atomically** — persisted data, independent deploys, installed clients, multiple teams
— *and* the failure mode is expensive or irreversible. Skip it (change directly) when
you own every caller, there's no persisted/in-flight old form, and failure is cheap
and reversible. The window is insurance: buy it exactly when the premium is less than
the loss it covers.
