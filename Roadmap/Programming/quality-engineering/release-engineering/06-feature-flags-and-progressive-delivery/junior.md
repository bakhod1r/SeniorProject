# Feature Flags & Progressive Delivery — Junior Level

> **Roadmap:** [Release Engineering](../README.md) → Feature Flags & Progressive Delivery

*Shipping the code is not the same as turning it on. A flag is the switch in between.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Deploy Is Not Release](#core-concept-1--deploy-is-not-release)
5. [Core Concept 2 — Your First Flag](#core-concept-2--your-first-flag)
6. [Core Concept 3 — Where the Flag Value Comes From](#core-concept-3--where-the-flag-value-comes-from)
7. [Core Concept 4 — Turning It On for a Few People First](#core-concept-4--turning-it-on-for-a-few-people-first)
8. [Core Concept 5 — Cleaning Up After Yourself](#core-concept-5--cleaning-up-after-yourself)
9. [Core Concept 6 — The Four Kinds of Flag (a First Look)](#core-concept-6--the-four-kinds-of-flag-a-first-look)
10. [Real-World Examples](#real-world-examples)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **the single idea that deploying code and releasing behavior are two separate events — and a feature flag is what separates them.**

You finished a feature. You merge it, CI builds it, and it ships to production. Done? Not quite. If the new behavior is live the instant the code lands, then every deploy is also a release, and you have no way to ship "quietly" — to put code on the server but keep it switched off until you decide otherwise.

A **feature flag** (also called a feature toggle) is a runtime `if` statement controlled by configuration instead of by a code change:

```go
if flags.Enabled("new-checkout") {
    return newCheckout(cart)
}
return oldCheckout(cart)
```

Both code paths are deployed. Which one runs is decided *later*, by flipping a value in a dashboard or a config file — no rebuild, no redeploy. That small shift unlocks everything in this topic: shipping unfinished work safely, turning features on for 1% of users first, and switching a broken feature off in seconds instead of waiting for a rollback.

---

## Prerequisites

- You can read and write a basic `if`/`else` in at least one language.
- You understand what "deploy to production" means (your code runs on a server users hit).
- You have seen environment variables or a config file used to change behavior without editing code.
- Helpful: a passing familiarity with version control and pull requests.

---

## Glossary

| Term | Meaning |
|---|---|
| **Deploy** | The code is present and running on the server. A technical event. |
| **Release** | Users actually experience the new behavior. A business decision. |
| **Feature flag / toggle** | A config-controlled switch that decides which code path runs at runtime. |
| **Flag evaluation** | Asking "is this flag on for *this* request/user?" and getting back a value. |
| **Default / fallback value** | What the flag returns if the flag system can't be reached. |
| **Targeting** | Rules that turn a flag on for *some* users (e.g. internal staff) and off for others. |
| **Rollout** | Gradually increasing the share of users who see the new behavior. |
| **Kill-switch** | A flag whose whole purpose is to quickly turn a feature *off* in an emergency. |
| **Stale flag** | A flag that is no longer needed but still left in the code — debt. |

---

## Core Concept 1 — Deploy Is Not Release

The most important sentence in this whole topic:

> **Deploy** means the code is on the server. **Release** means users get the behavior. Flags let you do them at different times.

Without flags, these are welded together. The feature goes live the moment the deploy finishes, at 2pm on a Friday, whether or not your on-call person is ready. With flags, the deploy is a calm, boring event — code lands, switched off — and the *release* is a separate, deliberate flip you make when the time is right.

This buys you three things immediately:

1. **Ship incomplete work safely.** You can merge a half-built feature behind a flag that's off. The code is in production (so it stays integrated and tested by CI), but no user ever runs it. This is what lets teams avoid long-lived feature branches.
2. **Decouple risk.** A deploy that ships ten features behind ten off flags can be released one at a time. If feature 7 misbehaves, you flip *its* flag off — the other nine stay live.
3. **Instant off-switch.** Turning a flag off is a config change that takes effect in seconds. Rolling back a deploy can take many minutes and re-introduces whatever else was in that build.

```text
TRADITIONAL:   merge ──► build ──► deploy = release (all at once)
WITH FLAGS:    merge ──► build ──► deploy (off) ──────► flip flag = release (later, on your terms)
```

---

## Core Concept 2 — Your First Flag

The simplest flag is a boolean read from configuration. Here it is in three languages, from crudest to cleanest.

**The crude version — an environment variable:**

```go
// Works, but: requires a restart to change, no targeting, no per-user control.
if os.Getenv("FEATURE_NEW_CHECKOUT") == "true" {
    return newCheckout(cart)
}
return oldCheckout(cart)
```

This is a real flag and it's fine for a tiny project. Its weakness: changing it means redeploying or restarting, so you lose the "flip it without a deploy" superpower.

**The better version — an SDK that evaluates at runtime:**

```js
// JavaScript with an OpenFeature-style client.
const client = OpenFeature.getClient();

async function checkout(user, cart) {
  const useNew = await client.getBooleanValue("new-checkout", false, {
    targetingKey: user.id,
  });
  return useNew ? newCheckout(cart) : oldCheckout(cart);
}
```

Two things to notice. First, `false` is the **default value** — if the flag service is down or the flag doesn't exist, you get `false` and the old, safe path runs. Always make the default the *safe* choice. Second, `targetingKey: user.id` tells the system *who* is asking, so the answer can differ per user. That's what powers gradual rollouts.

**In Java, the shape is the same:**

```java
Client client = OpenFeatureAPI.getInstance().getClient();
boolean useNew = client.getBooleanValue("new-checkout", false,
    new MutableContext(user.getId()));
return useNew ? newCheckout(cart) : oldCheckout(cart);
```

The pattern never changes: *ask the SDK, supply a safe default, branch on the answer.*

---

## Core Concept 3 — Where the Flag Value Comes From

When you call `getBooleanValue`, where does the answer live? Three common setups:

1. **A config file or env var.** Simplest. Value is baked at deploy or restart. No live control.
2. **A flag service the SDK talks to.** A managed product (LaunchDarkly, Split, Flagsmith) or a self-hosted one (Unleash). You flip values in a web dashboard; the SDK picks up the change in seconds. This is the common professional setup.
3. **A streamed/cached value.** The SDK keeps a local copy of all flag values and refreshes it (by streaming updates or polling every few seconds). Evaluation is then a fast in-memory lookup — no network call per request.

Why the local cache matters: you do *not* want to make a network call to a flag vendor on every single request. If you did, the flag service becoming slow or unreachable would make *your* service slow or unreachable. Instead the SDK fetches the ruleset once, keeps it in memory, evaluates locally, and falls back to your default if it ever has nothing.

> **The golden rule:** if the flag system disappears, your app must still work. That's why every flag read takes a default, and the default is the safe path.

---

## Core Concept 4 — Turning It On for a Few People First

The whole point of a per-user flag is that you don't have to go from 0% to 100% in one step. You can release *gradually*. This is **progressive delivery**.

The gentlest version is a **percentage rollout**: turn the flag on for 1% of users, watch your dashboards, then 5%, 25%, 100%. If something breaks at 5%, only 5% of users were affected and you flip back to 0% instantly.

A close cousin is **targeting by attribute** — turn it on for specific groups before everyone:

```yaml
# A targeting rule, vendor-neutral shape.
flag: new-checkout
default: false           # everyone else: off
rules:
  - if: user.email endsWith "@ourcompany.com"
    then: true           # internal staff see it first (dogfooding)
  - if: user.country == "NZ"
    then: true           # small market first
  - rollout:
      percentage: 5      # then 5% of remaining users
      then: true
```

This is the **ring model** in miniature: internal users → a small friendly cohort → a small percentage → everyone. Each ring is a chance to catch a problem before it reaches the next, larger group. The infrastructure-level version of the same idea is a **canary deploy**, where a small slice of *traffic* (not users) goes to the new version first.

---

## Core Concept 5 — Cleaning Up After Yourself

Here is the discipline that separates a flag from a liability. A flag you added to roll out "new-checkout" has a job: get the feature safely to 100%. Once it's at 100% and stable, **the flag's job is over and it should be deleted**, along with the old code path.

Why this matters even at junior level:

- Every flag left in the code is a fork in the road. Two flags = four possible combinations. Ten flags = 1,024. Nobody tests all of them, so untested combinations become bugs waiting to happen.
- Old code paths behind dead flags rot — they don't get updated, and one day someone flips the wrong stale flag and runs ancient code in production. (The most famous version of this disaster is later in this topic.)

A simple habit: when you add a release flag, add a reminder to remove it. Treat the cleanup as part of the feature, not optional homework.

```go
// Good: a comment that dates the flag so it gets noticed and removed.
// FLAG new-checkout — release toggle, added 2026-06-22, REMOVE after 100% rollout.
if flags.Enabled("new-checkout", user) {
    return newCheckout(cart)
}
return oldCheckout(cart)
```

---

## Core Concept 6 — The Four Kinds of Flag (a First Look)

So far we've talked about flags as if they're all the same. They're not. The word "flag" covers several tools that share a mechanism but serve different purposes. You'll meet all four in detail at the next tier; for now, just learn to recognize them, because they behave very differently.

| Kind | What it's for | How long it lives | Example |
|---|---|---|---|
| **Release toggle** | Hide unfinished work until it's ready | Short — deleted after the feature is fully on | The off-by-default `new-checkout` flag |
| **Kill-switch** (ops toggle) | Turn off a whole subsystem in an emergency | Long — kept around for years as a safety brake | `disable-recommendations` when the service overloads |
| **Experiment** | Show different versions to measure which is better | A few weeks, for one experiment | Green vs blue "Buy" button |
| **Permission** (entitlement) | Give a feature only to certain plans/accounts | Permanent — it's really business rules | "Pro plan gets CSV export" |

The single most useful habit: **before you create a flag, decide which kind it is.** If it's a release toggle, you already know its fate — it gets deleted once the feature reaches everyone. If it's a kill-switch, you know to *keep* it. Mislabeling them is how teams end up unable to tell which flags are safe to remove.

```go
// Same mechanism, very different intent — name the kind in the flag itself.
flags.Enabled("checkout.release.new-flow", user)     // release: will be deleted
flags.Enabled("search.ops.kill-switch", user)        // kill-switch: kept forever
```

A release toggle is a loan you pay back by deleting it. A kill-switch is a tool you keep in the drawer. An experiment is a measuring tape. A permission flag is part of your product's rules. Knowing which one you're holding tells you everything about how to treat it.

---

## Real-World Examples

- **Shipping a redesign quietly.** A team rebuilds the settings page over three weeks, merging daily behind an `off` flag. The new page is in production the whole time but invisible. On launch day they flip it to 100% — no scramble, no big-bang deploy.
- **Dogfooding.** A flag targets `@ourcompany.com` emails so employees use the new feature for a week before customers. Real usage surfaces bugs that staging never did.
- **The 2am save.** A new pricing calculation ships and starts producing wrong totals. On-call flips the `new-pricing` flag off from their phone. Fixed in 30 seconds — no deploy, no rollback, no waking the whole team.
- **The 1% experiment.** Marketing wants to know if a green "Buy" button outsells blue. A flag shows green to 50% of users; the data decides. (This is an *experiment* flag — more on the different kinds at the next tier.)

---

## Mental Models

- **The light switch.** Wiring the lamp (deploy) and flipping the switch (release) are different actions. You can wire it in daylight and turn it on at night.
- **The dimmer, not the switch.** A percentage rollout isn't on/off — it's a dimmer you turn up slowly while watching the room.
- **The circuit breaker.** A kill-switch is a breaker: when something sparks, you trip it *now* and investigate later. (The `circuit-breaker-pattern` skill is the systems-level version of this instinct.)
- **Flags are borrowed, not owned.** A release flag is a loan from your codebase's simplicity. You pay it back by deleting the flag.

---

## Common Mistakes

- **Default to the *new* path.** If the flag service is unreachable and your default is `true`, an outage in the flag system silently force-enables an unfinished feature. Default to the safe, old path.
- **Calling the flag service on every request.** Without local caching, the vendor's latency becomes your latency. Use the SDK's cached evaluation.
- **Treating env-var flags as flippable.** A flag read from `os.Getenv` only changes on restart — you lose the instant-off benefit. Fine for tiny projects; not a real progressive-delivery flag.
- **Forgetting the flag exists.** The feature reaches 100%, everyone moves on, and the flag (plus dead `oldCheckout`) lives forever. Set a removal reminder when you add it.
- **No targeting key.** Without passing the user id, you can't do percentage or per-user rollouts — every user gets the same answer, so "gradual" is impossible.

---

## Test Yourself

1. In one sentence each, define *deploy* and *release*. Why is keeping them separate useful?
2. In `getBooleanValue("x", false, ctx)`, what is the `false` for, and why should it be the *old* behavior?
3. You want employees to see a feature before customers. Which mechanism — percentage rollout or attribute targeting — and why?
4. Why is calling the flag vendor on every request a bad idea? What does the SDK do instead?
5. A release flag has been at 100% for two months. What should happen to it, and what's the risk if nothing does?

---

## Cheat Sheet

```text
DEPLOY ≠ RELEASE      deploy = code on server; release = users get behavior

FLAG READ             value = client.getBooleanValue("name", SAFE_DEFAULT, {userKey})
                      └─ default = the OLD/SAFE path, returned if flag system is down

WHERE VALUES LIVE     env var (restart) < flag service (live flip) < cached SDK (fast + live)

GRADUAL RELEASE       internal → small cohort → 1% → 5% → 25% → 100%
                      percentage rollout OR target by attribute (email/region/account)

KILL-SWITCH           flip a flag OFF in seconds — faster than any rollback

CLEAN UP              release flag's job ends at 100% → delete flag + old code path
```

---

## Summary

A feature flag is a config-controlled `if` that lets you deploy code without releasing behavior. Ship unfinished work switched off, turn features on for a few users before everyone, and switch a broken feature off in seconds — none of it requiring a new deploy. Always supply a safe default so your app survives the flag system being down, let the SDK cache values instead of phoning home per request, roll out gradually, and *delete the flag* once the feature is fully live. Get these five ideas solid and the next tiers — flag types, lifecycles, canaries, and governance — are just elaborations on them.

---

## Further Reading

- Martin Fowler — *Feature Toggles (aka Feature Flags)* (the canonical article; read the "categories" section)
- OpenFeature — *Specification & Concepts* (openfeature.dev), the vendor-neutral standard
- *Continuous Delivery* — Humble & Farley (deploy vs release, dark launching)
- The `ci-cd-pipeline-design` skill — where flags fit in a deployment pipeline
- The `monitoring-alerting` skill — you need dashboards to watch a rollout safely

---

## Related Topics

- [Rollback & Roll-Forward](../07-rollback-and-roll-forward/) — the kill-switch is your fastest rollback
- [Release Branching & Trains](../03-release-branching-and-trains/) — flags let you avoid long-lived branches
- [Release Automation](../08-release-automation/) — automating the deploy that ships the flagged code
- [Versioning & SemVer](../01-versioning-and-semver/) — what changes when behavior is gated behind a flag
