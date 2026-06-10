# Migrating Between Languages — Middle

> **What?** The *mechanics* of moving a system from one language to another without a death-march rewrite. The junior level told you to migrate incrementally and never big-bang; this level is the named patterns and concrete plumbing that make "incremental" actually work — the strangler fig, the anti-corruption layer, shadow traffic, and honest cost estimation.
> **How?** Put a facade in front of the old system, then move traffic to new-language replacements one route at a time, validating each against the old behavior before you trust it. The old system shrinks gradually until there's nothing left of it — strangled, not demolished.

---

## 1. The strangler fig pattern

The name comes from Martin Fowler (2004), who borrowed it from the strangler fig vine. The fig seeds in the canopy of a host tree, grows roots *down around* the trunk, and slowly envelops the host until the original tree dies and rots away — leaving a self-supporting fig in the exact shape of the tree it replaced.

That is the migration strategy. **You grow the new system around the old one until the old one can be removed, and at no single moment does the whole thing switch over.**

```
        ┌─────────────────────────────────────────┐
        │              Facade / Router              │
        │   (routes each request to old OR new)     │
        └───────────────┬───────────────┬───────────┘
                        │               │
         ┌──────────────▼───┐    ┌──────▼──────────────┐
         │  OLD system      │    │  NEW system         │
         │  (Perl, shrinking)│    │  (Go, growing)      │
         └──────────────────┘    └─────────────────────┘

Day 1:    100% old,   0% new      (facade added, passes everything through)
Month 2:   90% old,  10% new      (login endpoint moved to Go)
Month 6:   60% old,  40% new      (most read paths moved)
Month 11:   5% old,  95% new      (only one batch job left in Perl)
Month 12:   0% old, 100% new      (old system deleted; facade may stay or go)
```

The key move is the **facade** (often just a reverse proxy, API gateway, or a thin routing layer): it sits in front of everything, and *it* decides whether a given request is served by the old code or the new. Because the facade is the single point of control, you can move one route from old to new by changing one routing rule — and move it *back* just as fast if the new version misbehaves.

---

## 2. Why big-bang rewrites fail — the mechanics

The junior level said big-bang fails; here's *why*, concretely. Three forces converge:

**1. The feature freeze.** While the rewrite is underway, the old system can't get new features — you'd have to build each feature *twice*, in both codebases. So the business is told "no new features for a while." That "while" is always longer than promised. Meanwhile competitors keep shipping. (This is exactly what killed Netscape — three years of freeze.)

**2. The moving target.** The old system isn't frozen in *reality* — bugs still need fixing, regulations change, a payment provider changes its API. Every such change has to be made in *both* systems, so the new system is chasing a target that keeps moving. You finish copying a behavior just as that behavior changes.

**3. The all-new-bugs cliff.** On cutover day, you replace a system with thousands of battle-tested edge-case fixes with one that has *none* of them yet. Every one of those edge cases re-breaks simultaneously, in production, under full load. There's no gentle ramp — you go from "100% proven" to "100% unproven" in one deploy.

```
Big-bang risk profile:                Incremental risk profile:

risk                                  risk
 │            ╱╲  ← cutover day        │
 │           ╱  ╲                      │  ╱╲  ╱╲  ╱╲  ╱╲   (small, frequent,
 │          ╱    ╲                     │ ╱  ╲╱  ╲╱  ╲╱  ╲   recoverable)
 │_________╱      ╲___                 │╱________________
        time                                 time
   one giant, unrecoverable spike      many tiny, recoverable bumps
```

---

## 3. Incremental migration mechanics

The strangler is the strategy. Here are the concrete techniques that make it physically possible.

### Shared database (transitional)
The cleanest theory says old and new each own their data. In practice, during migration, **the old and new code often read and write the same database** so they stay consistent while you move logic across. This is a *deliberate, temporary* coupling — not the end state. You tolerate the shared DB as scaffolding and remove it once the old code is gone.

### Anti-corruption layer (ACL)
The new system is clean; the old system's data model is full of legacy weirdness (the triple-format dates, the magic status codes). An **anti-corruption layer** is a translation boundary: a thin adapter that converts the old system's ugly model into the new system's clean model, so the legacy mess doesn't *leak into* and corrupt your new design.

```
New domain model  ◄──[ Anti-corruption layer ]──►  Legacy model
(clean: Money,                (translates)          (ugly: int cents as
 OrderStatus enum)                                   string, status="3")
```

Without the ACL, the legacy concepts seep into the new code and you end up with a new system that's just the old mess in a new language. The ACL is the firewall that keeps the migration from being pointless.

### Feature-by-feature cutover
Move the system in slices a user could name — "login," "checkout," "the reports page" — not in technical layers ("all the database access"). Vertical slices can be cut over and validated end to end; horizontal layers can't be tested in isolation and force a big-bang-style flip anyway.

---

## 4. Parallel run / shadow traffic — how you earn trust

The scariest moment is the first time real traffic hits new code. **Shadow traffic** (a.k.a. parallel run, dark launch) removes most of that fear: you send each live request to *both* the old and the new system, return the old system's answer to the user, and **compare the two responses in the background.**

```
                    ┌──────────────┐
   request ────────►│   Facade     │
                    └──┬────────┬──┘
                       │        │ (mirror — user never sees this)
       (real response) │        │
                       ▼        ▼
                 ┌─────────┐  ┌─────────┐
                 │ OLD     │  │ NEW     │
                 │ (Perl)  │  │ (Go)    │
                 └────┬────┘  └────┬────┘
                      │            │
                      ▼            ▼
                  to user      ┌────────────┐
                               │ diff & log │  ← "98.7% match.
                               └────────────┘     diffs: rounding on
                                                   refunds, tz on
                                                   created_at"
```

Because the new system's output is *thrown away*, a bug in it can't hurt anyone — but you still learn *exactly* where it disagrees with the proven system, on real production data, before you ever trust it. You don't cut a route over until the diff rate on real traffic is near zero and the remaining diffs are understood (often the *old* system turns out to be the buggy one). This is **automated diff testing against the source of truth**, and it's the single most powerful de-risking tool in a migration.

GitHub's [Scientist](https://github.com/github/scientist) library was built for exactly this — running a new code path "in the dark" alongside the old and reporting mismatches. GitHub used it to migrate their core permissions logic (`Repository#access?`) by running old and new implementations side by side on every real request for weeks, surfacing the mismatches, and only retiring the old path once the new one agreed on production traffic.

A few practical rules for shadowing:

- **Mirror, don't double-commit.** Shadowing is safe for *reads*. For *writes*, mirroring naively means the new system also charges the card or sends the email — twice. For write paths you shadow only the *computation* (compute what the new system *would* write and diff that against the old write), not the side effect.
- **Exclude the inevitable noise.** Timestamps, request IDs, and non-deterministic ordering will always differ. Normalize or exclude those fields so the diff highlights *real* behavioral divergence, not clock skew.
- **Budget the cost.** Running every request twice roughly doubles compute for shadowed paths. That's a deliberate, temporary cost you pay to buy confidence — sample (e.g. shadow 10% of traffic) if doubling is too expensive.

---

## 5. Estimating migration cost honestly

The most dangerous sentence in migration planning is "it's just rewriting the same logic, should be quick." It is never quick. Honest estimation accounts for the parts people forget:

| Cost you remember | Cost you forget |
|---|---|
| Rewriting the core logic | Re-discovering all the undocumented edge cases |
| Setting up the new language's project | Building the facade, routing, and ACL plumbing |
| | Building the shadow-traffic / diff harness |
| | Migrating and reconciling the *data* (often the biggest — see `senior.md`) |
| | Running and operating **two** systems for months/years |
| | Re-doing features the old system shipped *during* the migration |
| | Training the team, building new monitoring/runbooks |

A rule of thumb seasoned engineers use: **estimate the rewrite as if it's a fresh build of the same scope, then multiply — because you must also discover the requirements that only exist as code.** A clean-room "build the same app" estimate badly understates a migration, because in a migration the spec *is* the old code, and reading it back out is most of the work.

---

## 6. A worked sketch: migrating a service from Python to Go

A monolithic Python (Flask) order service is hitting CPU limits and the team is now Go-first. Incremental plan:

1. **Add the facade.** Put a router in front of the Python app. Day one it forwards 100% to Python — no behavior change, but now there's a control point.
2. **Pick the first slice.** Choose a *read-only, low-risk, high-traffic* endpoint — say `GET /orders/{id}`. Read-only means no data-corruption risk; high-traffic means the shadow comparison gathers data fast.
3. **Shadow it.** Build the Go version, mirror real traffic to it, diff against Python. Fix Go until the diff is ~0 on real data.
4. **Cut it over.** Flip the routing rule: `GET /orders/{id}` now served by Go. Keep instant rollback (flip the rule back) ready.
5. **Repeat, riskiest last.** Move endpoints one by one, saving the *write* paths and money-touching paths for when you trust the harness. Keep shipping features the whole time — in whichever system owns that slice.
6. **Delete Python** once nothing routes to it. The facade can stay (useful) or be removed.

Notice: at no point is the business frozen, and at no point is more than one endpoint's worth of risk in flight.

### The order you migrate slices in is a real decision

Two heuristics pull in opposite directions, and you balance them:

| Migrate *early* | Migrate *late* |
|---|---|
| High-traffic (the diff harness gathers data fast) | Money-touching / irreversible (charges, settlements) |
| Read-only (no data-corruption risk) | Complex shared-state writes |
| Low domain complexity (proves the toolchain) | The "scary" component everyone's afraid of |
| Loosely coupled to the rest | Tightly coupled to many other slices |

The reflex is to start with the *hardest* part "to get it out of the way." Resist it. You start with something **low-risk but high-traffic** so the migration machinery — facade, shadow harness, deploy pipeline, monitoring — gets proven on real production load while the blast radius is tiny. By the time you reach the payment path, the harness is battle-tested and you trust the diffs. Saving the irreversible, money-touching slices for *last* means they're cut over by your most mature tooling, not your most naive.

---

## 7. Quick rules

- [ ] Use the **strangler fig**: facade in front, move one slice at a time, old system shrinks to nothing.
- [ ] Cut over in **vertical, user-nameable slices**, not technical layers.
- [ ] Put an **anti-corruption layer** between new and legacy models so the mess doesn't leak into the new design.
- [ ] **Shadow real traffic** and diff new-vs-old before trusting any cutover; ship the route only when diffs are ~0 and understood.
- [ ] Keep **instant rollback** (a routing flip) for every cut-over slice.
- [ ] **Never freeze features.** If your plan requires a feature freeze, it's a big-bang in disguise.
- [ ] Estimate **honestly**: add facade/ACL/diff-harness/data-migration/dual-operation/retraining to the "just rewrite the logic" number.

---

## 8. What's next

| Topic | File |
|---|---|
| When *not* to migrate; data migration; the two-system tax; multi-year morale | `senior.md` |
| The business case, multi-team programs, deprecation forcing functions, case studies | `professional.md` |
| Interview questions from "Python→Go" to "1M-line Perl monolith" | `interview.md` |
| Design a strangler plan, a shadow plan, a cutover sequence | `tasks.md` |

---

**Memorize this:** the strangler fig — facade in front, slice-by-slice cutover, old system shrinking to zero — is how real migrations succeed without a feature freeze. Validate every slice with shadow traffic and automated diffing against the proven system, keep instant rollback on every cut, and estimate honestly: the old code *is* the spec, and reading it back out is most of the work.
