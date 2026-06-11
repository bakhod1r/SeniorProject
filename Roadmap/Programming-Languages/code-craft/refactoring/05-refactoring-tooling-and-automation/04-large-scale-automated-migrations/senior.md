# Large-Scale Automated Migrations — Senior

> **Source:** Google, "Software Engineering at Google" (Large-Scale Changes ch.); OpenRewrite docs

The middle file makes one migration run. The senior job is **everything that doesn't fit in the
codemod**: coordinating hundreds of human owners, reviewing at a scale no human can read,
sequencing migrations that depend on each other, choosing atomic vs incremental, and grinding
down the long tail of sites that resist automation. These are the parts that make migrations
take *quarters*, not afternoons.

---

## 1. Cross-team coordination

A migration touching 180 teams is an organizational operation wearing a technical costume. The
failure mode is never "the codemod was wrong" — it's "we landed it and three teams found out by
having their build break."

What coordination actually requires:

- **A single owner of the migration.** One driver (or small team) owns the codemod, the
  rollout, the tracking, and the deadline. Diffused ownership = stall at 80%.
- **Announce before you roll.** Owners must learn about the change from an announcement, not
  from a surprise PR. State the *why*, the *timeline*, and the *opt-out*.
- **A vouching authority.** Someone trusted vouches that the change is safe and mechanical, so
  600 owners don't each independently re-derive whether the migration is a good idea. At Google
  this is the LSC review/approval process; the global approver vouches for the change's
  *correctness and necessity*, local `OWNERS` only approve *applying it here*.
- **An escape hatch and a clock.** Teams can opt out short-term, but the migration has a date
  after which the old API is deleted. Without a deadline, opt-outs become permanent and the
  migration never completes.

> **When NOT to coordinate heavily:** if the change lands in areas owned by one or two teams you
> already work with, skip the announcement machinery and just talk to them. Coordination cost
> should scale with the number of *independent* owners, not the number of files.

---

## 2. OWNERS and review at scale

No human reviews 40,000 files. Review scales by splitting one question into two:

1. **"Is this change correct and worth doing?"** — answered *once*, by a global
   reviewer/approver who vouches for the codemod and the plan.
2. **"Should it apply to *my* directory?"** — answered *per shard*, by local `OWNERS`, who only
   verify there's nothing special about their code (generated files, a planned deletion, an
   in-flight rewrite).

This is why each shard PR can be approved in two minutes: the owner is not re-checking the
migration's correctness — that's already vouched — they're confirming local fit. The bot routes
each shard to the right `OWNERS` automatically, so review *parallelizes* across all teams at
once instead of serializing through one reviewer.

For areas with no responsive owner, you need a policy decided up front: **does silence mean
proceed, or does it block?** Google's LSC process allows mechanical changes to proceed under a
global approval when local owners don't respond within a window — otherwise one unresponsive
team could veto a repo-wide migration forever.

---

## 3. Sequencing dependent migrations

Sometimes migration B can't start until A finishes (B uses the API A introduces). Independent
parallel PRs break here — shard B's CI fails because A hasn't landed. Two tools:

### 3.1 Make shards independent (preferred)

Use **branch by abstraction** or **parallel change** to remove the dependency so shards can
land in any order. Introduce the new API *alongside* the old, migrate sites independently, then
remove the old one. Now there is no ordering constraint — every shard is independently valid.
See [`../../04-large-scale-refactoring/01-branch-by-abstraction/junior.md`](../../04-large-scale-refactoring/01-branch-by-abstraction/junior.md)
and [`../../04-large-scale-refactoring/02-parallel-change-expand-contract/junior.md`](../../04-large-scale-refactoring/02-parallel-change-expand-contract/junior.md).

### 3.2 Sequence explicitly (when you can't)

If a true ordering exists, run it as phases, each phase being its own full LSC:

```
Phase 1 (expand):   add new API everywhere it's needed, old API still present
Phase 2 (migrate):  point all call sites at the new API   ← the big sharded rollout
Phase 3 (contract): delete the old API + add enforcement
```

This is **expand-migrate-contract** at repo scale. Each phase reaches 100% and is independently
shippable before the next begins. Never start contract before migrate hits zero — deleting the
old API with sites still on it breaks the build.

> **When NOT to sequence:** don't invent phases for a change that's actually independent.
> Sequencing serializes the rollout and slows it down; only pay that cost for a real dependency.

---

## 4. Atomic vs incremental rollout

| | **Atomic** | **Incremental** |
|---|---|---|
| What | All sites change in one indivisible submit | Sites change in many independent PRs over time |
| Requires | The change *must* land everywhere at once (no compat shim possible) | A compatibility layer so old + new coexist |
| Risk | One giant revert; high blast radius; conflict-prone | Each PR small; partial state always valid |
| When | Truly indivisible changes (some symbol renames at the toolchain level) | Almost everything else |

**Default to incremental.** The entire LSC discipline exists to make changes incremental, and
incremental is almost always achievable by first introducing a compatibility shim (the old API
delegates to the new one) so the codebase is valid at every intermediate state. An atomic change
forfeits sharding, parallel review, and safe rollback — accept it only when no shim can exist.

The senior skill is recognizing that "this has to be atomic" is *usually* false: a shim turns
an atomic change into an incremental one. If you find yourself planning a giant atomic submit,
your first question should be "what compatibility layer makes this incremental instead?"

---

## 5. The long tail

A migration reaches ~95% mechanically and then stops. The last few percent are the sites the
codemod *can't* handle, and they're where senior judgment lives. The long tail is made of:

- **Quarantined files** — parse errors, macros, generated code, exotic syntax the codemod
  skipped (middle file §4).
- **Judgment sites** — places where the right transform depends on context only a human knows.
- **Opted-out areas** — directories an owner asked the bot to skip (mid-rewrite, about to be
  deleted).
- **Abandoned/unowned code** — no one will review the PR.

Tactics, in order of preference:

1. **Hand-migrate** the quarantined and judgment sites. 200 files by hand is a week; it
   *finishes* the migration. Don't let perfect automation block completion.
2. **Delete dead sites** instead of migrating them — if the code is unused, removing it counts
   as "migrated" and is cheaper than transforming it.
3. **Escalate opt-outs** as the deadline nears. The clock from §1 exists for this moment.
4. **Resolve ownership** for abandoned code — find a temporary owner or get an org decision to
   proceed under global approval.

The long tail is where migrations *actually die*. A migration that's "99% done" forever is a
failure: the codebase is now permanently in a mixed old/new state, you carry the compatibility
shim and the enforcement scaffolding indefinitely, and the next person can't tell which API is
canonical. **Driving the tail to zero and removing the old API is the senior deliverable** —
not the impressive 95% the codemod did automatically.

> **When NOT to chase the tail to zero:** very rarely, the last sites are in frozen/legacy code
> that will be deleted wholesale soon. Then leave them, but write down the decision and the
> deletion date — an explicit, time-boxed exception, not silent abandonment.

---

## Next

- [`professional.md`](professional.md) — real systems (Rosie, TAP, Meta's pipeline, OpenRewrite
  at scale), cost/risk economics, rollback at scale, governance.
- [`../../04-large-scale-refactoring/02-parallel-change-expand-contract/junior.md`](../../04-large-scale-refactoring/02-parallel-change-expand-contract/junior.md)
  — the expand-migrate-contract pattern §3/§4 lean on.
- The *strangler-at-code-level* topic in the large-scale-refactoring section — incrementally
  replacing a subsystem rather than a single API.
