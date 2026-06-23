# Using Third-Party Packages — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Cost of a Dependency](#the-cost-of-a-dependency)
3. [Build vs Buy: Frameworks for Deciding](#build-vs-buy-frameworks-for-deciding)
4. [Auditing a Library Before Adopting](#auditing-a-library-before-adopting)
5. [Long-Term Maintenance Risk](#long-term-maintenance-risk)
6. [Dependency Hygiene Policies](#dependency-hygiene-policies)
7. [Supply-Chain Threats and Mitigations](#supply-chain-threats-and-mitigations)
8. [Vendoring vs Proxying for Untrusted Deps](#vendoring-vs-proxying-for-untrusted-deps)
9. [Insulating Your Code from a Library](#insulating-your-code-from-a-library)
10. [Forking Discipline: When to Fork, When Not To](#forking-discipline-when-to-fork-when-not-to)
11. [Major Version Migrations](#major-version-migrations)
12. [Removing a Dependency Cleanly](#removing-a-dependency-cleanly)
13. [Anti-Patterns](#anti-patterns)
14. [Senior-Level Checklist](#senior-level-checklist)
15. [Summary](#summary)

---

## Introduction

A senior engineer's relationship with third-party packages is not "how do I add one" but "what is the lifetime cost of this dependency, and is it worth paying?" The mechanical command — `go get example.com/lib` — is one keystroke. The decision behind it spans architecture, security, release engineering, and team economics.

This file is about *the cost model and the governance*. The mechanical content is in [junior.md](junior.md) and [middle.md](middle.md).

After reading this you will:
- Reason about a dependency's *total* cost of ownership, not just its install cost
- Apply explicit Build-vs-Buy frameworks before reaching for `go get`
- Audit a candidate library on observable, measurable signals
- Defend against supply-chain attacks targeting Go modules
- Insulate your codebase so that swapping or removing a dependency is not a rewrite

---

## The Cost of a Dependency

The keystroke cost of `go get` is misleading. Every dependency in `go.mod` carries a stream of obligations that runs until the day you delete it.

### The five-component cost model

A senior estimate of a dependency's cost has five parts:

1. **Install cost.** Reading docs, integrating, writing the first usage. Hours to days.
2. **Ongoing review cost.** Each release of the library is a tiny diff your team should at least skim. Each transitive bump is another. Cumulative over years.
3. **Transitive footprint.** A direct dependency on `lib/A` may pull twelve indirect dependencies. Each indirect is *also* yours to maintain. You inherit them whether you read their code or not.
4. **Security maintenance.** When a CVE drops in any node of your tree, someone must patch, test, and ship. The deeper the tree, the more frequent the events.
5. **Breaking-change migration risk.** When the library tags a major version, you either migrate (engineering time) or freeze on the old version (eventually unsupported, eventually a security liability).

Add these up over the expected life of the project. A "small" dependency adopted today usually costs more in years three to five than it did in year one.

### A quick way to estimate

Pick the library. Imagine a calendar five years from now. Ask:

- How many minor releases will it ship? (Each is a quick review.)
- How many breaking releases? (Each is a migration.)
- How many CVEs in this library or its transitive set? (Each is a fire drill.)

If the answer is "a lot, and the team is small," you are *renting space* in your project to a stranger. Charge yourself rent.

### The transitive multiplier

The single most under-counted cost is transitive. A 200-line direct dependency that pulls a 50-package transitive graph is not a 200-line dependency. Run `go mod graph` before you commit. If the graph more than doubles for a single import, that is a strong signal to pause.

### When the cost is acceptable

Big dependencies are not bad. A widely-used cryptography library, a battle-tested HTTP router, a high-quality serialisation library — these earn their cost. The question is never "is this dependency big?" but "is the value I extract from it greater than the multi-year cost of carrying it?"

---

## Build vs Buy: Frameworks for Deciding

Every `go get` is implicitly a Build-vs-Buy decision. Make it explicit.

### The two-day / two-month rule of thumb

A simple, defensible heuristic:

- **Could you build this in roughly two days?** Build. The dependency cost over five years almost certainly exceeds two days.
- **Would it take roughly two months?** Buy. The five-year cost of a *good* dependency is rarely two months of engineering.
- **Somewhere in between?** Look at the rest of the audit (next section) and decide deliberately.

This is not a precise rule. It is a forcing function — it makes you estimate before you import.

### Other questions to ask

- **Is the problem in our domain, or out of it?** Reach for in-domain code; buy out-of-domain code (parsers, network protocols, cryptography).
- **Will the dependency be load-bearing?** A load-bearing library that fails takes the product down with it. Audit harder; consider alternatives.
- **Is there a high-quality standard-library option?** Always prefer it. Go's standard library is unusually broad for a reason.
- **How fast is the API surface we need from the library?** A two-function dependency on a 200-function library is wasteful — write the two functions.

### When "build" is the wrong answer

Building is *not* automatically right just because it is cheap. You will be the sole maintainer. There is no community, no fix-it-and-go, no Stack Overflow. For anything security-critical (crypto, parsers facing untrusted input, auth), the right answer is almost always to buy from a well-vetted source.

### When "buy" is the wrong answer

Pulling a 500kB dependency to format a date in one place is buying when building is one line. Pulling a sprawling framework when you need three of its features is buying when you should extract.

The bias of most teams is toward over-buying. Senior engineers correct toward build, but with discipline.

---

## Auditing a Library Before Adopting

Before any new direct dependency lands in `go.mod`, walk through an audit checklist. The goal is not perfection; it is signal.

### License

- Is the license compatible with your project? MIT, BSD, Apache-2.0 are usually fine.
- GPL/AGPL forces obligations on your distribution. Know what you are signing up for.
- "License: see LICENSE.txt" in a repo with no LICENSE file is a red flag.

### Recent activity

- **Last commit.** Months without commits in a still-relevant area is a signal of abandonment.
- **Last release.** A library that has not tagged a release in two years is either done or dead. Decide which.

### Maintainership

- **Solo author or organisation?** Solo means a bus factor of one.
- **Are commits diverse?** A repo with one author who has not let in an external PR in three years is a fork-or-replace candidate.

### Test coverage

- Run `go test ./...` on the library. Do tests pass? Is there CI?
- Eyeball coverage. A package with public API but no tests is shipping vibes, not code.

### Transitive footprint

- `go mod graph | wc -l`. How many edges does this introduce?
- Of those edges, how many are well-known, well-maintained projects?

### GitHub Issues quality

- Are bugs answered? Are issues labelled, triaged, and progressing?
- A high count of stale, ignored issues is a signal that the maintainer is overwhelmed or absent.

### Recent CVE history

- Search the [Go vulnerability database](https://pkg.go.dev/vuln/) for the module path.
- Multiple CVEs in the last 12 months can be a sign of either a careful disclosure culture or a careless author. Read the advisories.

### Putting the audit on paper

For any non-trivial new dependency, the PR adding it should include a one-paragraph audit summary in the description. This makes the decision reviewable by other seniors. It also creates a record that future you can re-read in three years when the dependency starts looking suspicious.

---

## Long-Term Maintenance Risk

Even libraries that pass the initial audit can become liabilities. Watch for these patterns.

### Solo maintainer with no succession plan

A library written and maintained by one person is one car accident, one job change, or one burned-out morning away from being abandoned. This is fine for small libraries that you can fork. It is not fine for load-bearing infrastructure.

### Stuck at v0

A library that has been at v0 for years is signalling either "I do not commit to stability" or "I never finished the design." Either way, every release is allowed to break you. Plan accordingly.

### No roadmap

A library that ships features purely reactively (whatever the latest GitHub issue demands) tends to drift. The API gets cluttered, the internals tangle, the test suite degrades. Look for a maintainer with a clear sense of what the library is *not*.

### Frequent breaking changes

A major-version-per-quarter library is not stable infrastructure; it is a moving target. The cost of staying current rivals the cost of building your own. Either pin hard and stop upgrading, or replace.

### Single-vendor lock-in

A library tightly coupled to one cloud provider's SDK is a special risk. The day you migrate clouds, the library either follows you or strands you.

---

## Dependency Hygiene Policies

A team without policy will accumulate dependencies until the graph becomes unmanageable. Make policy explicit.

### Allow-list new direct dependencies via PR review

Adding a new entry to `go.mod` should require at least one second pair of eyes. The reviewer's job is not to nit; it is to ask the audit questions: "Why this library? Did you check alternatives? What is the transitive footprint?"

In larger orgs, an internal allow-list — a list of pre-vetted libraries — speeds up the common case and forces conversation only on novel ones.

### Quarterly upgrade sweeps

Once a quarter, dedicate a window to upgrading. Run `go list -m -u all`, evaluate each pending bump, upgrade in batches, run the full test suite. Do not let bumps accumulate for a year — when you finally try to upgrade, three majors of churn will have piled up.

### `govulncheck` in CI

```
govulncheck ./...
```

Run this on every PR. Fail the build on known-exploitable vulnerabilities. The Go vulnerability database is curated; false-positive rates are low.

### Periodic prune

Once a quarter, run `go mod tidy` and look at what changed. Look for direct dependencies that nothing imports any more — the code that needed them was deleted, but the line in `go.mod` was missed.

### Document deviations

Any pinned-back version, any `replace` directive, any locally-vendored package — document why, in `go.mod` comments or in a `DEPS.md`. Future maintainers (including future you) will not remember.

---

## Supply-Chain Threats and Mitigations

Modern attackers target build pipelines. Go modules are not immune.

### Typosquatting

An attacker publishes `github.com/yourorg-typo/lib` (note the dash) hoping a developer mistypes the import. The typo'd module contains a backdoor that only activates in specific environments.

**Mitigation:** every new direct dependency goes through PR review. The reviewer checks the URL is the canonical one. Use the project's official path from its README, not a search-engine result.

### Dependency confusion

An attacker publishes a public module with the same path as a private corporate module, hoping the build system fetches the public one. In Go this is mitigated by `GOPRIVATE`, which tells the toolchain *not* to consult the public proxy for matching paths. Set `GOPRIVATE=corp.example.com/*` (or your VCS host) for any private code.

### Account takeover of an existing library

A maintainer's GitHub account gets compromised. The attacker tags a new release with malicious code. Consumers running `go get -u` pull the poisoned version.

**Mitigations:**
- Use the Go checksum database (`GOSUMDB=sum.golang.org`, the default). It records the hash of every published version. A retroactively edited tag will fail verification.
- Pin versions in `go.mod`. Do not run `go get -u` blindly in production.
- Run `govulncheck` regularly.

### Abandoned packages adopted by attackers

A maintainer abandons a popular library. An attacker offers to take over. Six months later, a malicious release ships under the original name. This pattern has hit npm repeatedly and is plausible in Go.

**Mitigations:**
- Notice maintainership transfers. Read the commit history on dependency upgrades.
- For long-abandoned libraries that you depend on heavily, consider forking under your own org.

### Generally

Supply-chain security is layered. No single mitigation is sufficient. The Go toolchain's defaults (proxy + sumdb) are reasonable; do not disable them lightly.

---

## Vendoring vs Proxying for Untrusted Deps

Go has two ways to fetch dependencies: through a proxy (the default) or by vendoring (committing copies into `vendor/`).

### Proxying (default)

The Go toolchain fetches modules from `proxy.golang.org`, which caches them, and verifies them against `sum.golang.org`. Builds are reproducible because of `go.sum`.

For ordinary projects this is fine.

### Vendoring (`go mod vendor`)

Vendoring copies every dependency into a `vendor/` folder in your repo. Builds use the vendored copy and ignore the proxy entirely.

When vendoring is the right call:

- **Air-gapped builds.** No internet access at build time.
- **Auditability.** Every line of every dependency is in your repo. Reviewers can read it, grep it, run static analysers on it.
- **Distrust of the proxy.** If you cannot fully trust the proxy infrastructure (historic reasons, regulatory reasons, hostile-environment reasons), vendoring removes that trust dependency.
- **Long-lived archived projects.** A vendored project still builds in 2040 even if every upstream has vanished.

Costs:

- The repo grows substantially.
- PRs that bump dependencies have huge diffs.
- You have to manually run `go mod vendor` after every dependency change.

### Senior decision

Most projects: do not vendor. The proxy + sumdb model is good enough.

Compliance, defence, hostile-environment projects: vendor and treat the `vendor/` folder as part of your audit surface.

---

## Insulating Your Code from a Library

A direct import of a third-party type into your business logic is a small but real architectural commitment. You are saying "if this library disappears, my code disappears with it."

### The adapter pattern

Wrap third-party types in your own interfaces. Your code talks to the interface; the adapter talks to the library.

```go
// Your interface — defined by your code, owned by your code.
type Cache interface {
    Get(key string) (string, bool)
    Set(key, value string, ttl time.Duration)
}

// Adapter — the only place that knows about the third-party library.
type redisCache struct {
    client *redis.Client
}

func (r *redisCache) Get(key string) (string, bool) { ... }
func (r *redisCache) Set(key, value string, ttl time.Duration) { ... }
```

The rest of your codebase never imports `github.com/redis/go-redis`. It imports your `Cache` interface.

### What this buys you

- **Swappability.** Replacing `redis` with `memcached` is one new adapter, no business-logic changes.
- **Testability.** Your tests use a fake `Cache`, not a real Redis.
- **API hygiene.** Your public API never leaks third-party types. Consumers do not need to import the library transitively.

### Cost

Adapters are extra code. For trivial libraries (a small utility you call in one place) adapters are over-engineering. For load-bearing infrastructure (databases, queues, caches, HTTP clients to other services), adapters are usually worth it.

### The rule of thumb

If a third-party type appears in a public function signature *anywhere* in your module, you have just added that library to your public API. Anyone who consumes you, also consumes it. Adapt.

---

## Forking Discipline: When to Fork, When Not To

Sometimes the upstream library is not enough, and you fork. Forking is legitimate; it is also a long-term commitment. Treat it that way.

### When forking is the right answer

- **Upstream is unresponsive and you need a critical fix.** A patch sits in PR for months; the maintainer never reviews it. You ship a fork with the patch.
- **Upstream has abandoned the project.** No commits for two years; you cannot wait.
- **Your need is too niche for upstream.** The maintainer rejects your patch as out-of-scope. Fair, but you still need the feature.
- **Security boundary.** You distrust the upstream maintainer enough that you want a fork you control.

### When forking is the wrong answer

- **You disagree on style or naming.** Send a PR; live with the verdict.
- **You want a feature that is two days away from upstream merging.** Wait.
- **You are forking out of laziness because reading the upstream code is hard.** This is the worst reason. Your fork is now harder to maintain than the upstream code.

### Forking discipline

Once you fork, the long-term cost is real:

- **Keep diffs minimal.** Every change you make is a change you must rebase forward when upstream tags a new release. Touch only the lines you must.
- **Track upstream.** Set up a periodic rebase. Do not let your fork drift for years; the merge cost grows non-linearly.
- **Document the fork's purpose.** A `FORK.md` explaining what is different, why, and when it can be retired.
- **Plan for retirement.** A fork is a temporary fix. Either upstream the patches, replace the library, or accept the fork as a permanent in-house library. Drift is the worst outcome.

### Mechanical setup

In `go.mod`:

```
require github.com/upstream/lib v1.5.0
replace github.com/upstream/lib v1.5.0 => github.com/yourorg/lib v1.5.0-fork.1
```

Or simply require the fork directly if you do not need the original path's import compatibility.

---

## Major Version Migrations

Go's Semantic Import Versioning makes major-version bumps an explicit event: the import path changes. That is good — consumers cannot drift accidentally — but it also means migration is a project, not a `go get`.

### Big-bang vs gradual

Two strategies:

- **Big-bang migration.** A single PR replaces every import of `lib` with `lib/v2`, updates every call site, lands in one go. Works for small dependencies and small codebases. Fails as the codebase grows.
- **Gradual migration.** Both `lib` and `lib/v2` coexist in the build. New code uses `v2`; old code stays on `v1`. A migration window is set. Eventually `v1` imports are removed.

For anything load-bearing in a large codebase, gradual is the only realistic path.

### Aliases as a bridge

You can ease a gradual migration with type aliases in your own adapter layer:

```go
// adapter.go — switch from old to new in one place.
import lib "github.com/upstream/lib/v2"

type Reader = lib.Reader  // exported alias your code already uses
```

Now your code keeps importing your adapter; the underlying library version changed in one file.

### Deprecation period

Announce the migration, give a deadline, send reminders. Internal migrations need the same etiquette as external API changes — engineers' time is finite, and surprise migrations strain trust.

### Migration tooling

For mechanical changes (rename a function, change a parameter order), `gofmt -r`, custom `gopls` rewrites, and AST-based codemods can handle most of the diff. Save engineer attention for the genuinely judgment-requiring parts.

### When to skip a major version

Sometimes `v3` brings nothing you need. Stay on `v2`, accept that security patches will eventually stop, and plan to migrate directly to `v4` later. This is a valid choice — but document it, so the team is not surprised when `v2` finally drops support.

---

## Removing a Dependency Cleanly

Removing a dependency is harder than adding one. The library has often colonised the codebase in subtle ways.

### The four-step removal

1. **Replace usages.** Every call site that uses the library must be migrated to either the standard library, a different library, or in-house code. Type signatures change; tests change.
2. **Delete imports.** Remove every `import "github.com/old/lib"` line. The compiler will tell you which files still reference the old library.
3. **Run `go mod tidy`.** This drops the library from `go.mod` and any now-unused transitive dependencies from `go.sum`.
4. **Verify no lingering blank imports.** Search the codebase for `_ "github.com/old/lib"` (the import-for-side-effects form). These do not produce compile errors when removed, so they are easy to miss.

### Common gotchas

- **Test fixtures.** A library may be used only in tests. Tests may not run in your usual workflow; check.
- **Build tags.** A library may be imported only under `//go:build linux` or similar. A normal build does not exercise it.
- **Generated code.** A library may appear in generated files. Regenerate after the manual edits.
- **Embedded usage in struct tags.** Some libraries (validation, ORMs) bind to struct tags. Removing the import does not remove the tags; the tags become dead metadata.

### Verification

After removal:

```
go build ./...
go test ./...
go mod tidy
git diff go.mod go.sum    # confirm the entries are gone
grep -r "old/lib" .        # find any leftover references
```

A truly removed dependency leaves no trace in the repo.

### Deprecation alternative

If full removal is too expensive right now, deprecate first: stop adding new usages of the library, mark old call sites for migration, and let the removal happen incrementally. Track the remaining call sites in a TODO list so they do not become permanent.

---

## Anti-Patterns

- **`go get` without a PR review.** Adding a direct dependency is an architectural commitment; it deserves the same review as a new package.
- **Pulling a 50-package library to use one function.** Copy the function (with attribution and the right license) instead.
- **Importing third-party types into your own public API.** Your consumers now also depend on that library, transitively, in their public API.
- **Never running `govulncheck`.** Vulnerabilities ship; if you do not look, you do not see.
- **Forking and then drifting for years.** Either upstream the patches or own the fork explicitly.
- **`go get -u ./...` against the whole project, then a hasty merge.** Major bumps are not minor bumps; review each.
- **Treating transitive dependencies as someone else's problem.** They are yours. The CVE will hit you.
- **Adding `replace` to fix a problem you have not investigated.** Replace is a tool; it is not a diagnosis.
- **Vendoring without committing the `vendor/` folder.** Either fully vendor and commit, or do not vendor.
- **Removing imports without `go mod tidy`.** Stale entries pile up in `go.mod` and `go.sum`.

---

## Senior-Level Checklist

- [ ] Estimate five-year cost (review + transitive + CVE + migration) before adopting
- [ ] Apply the 2-day / 2-month rule to every Build-vs-Buy decision
- [ ] Audit license, activity, maintainership, tests, transitive graph, CVE history
- [ ] Add audit summary to the PR that introduces a new direct dependency
- [ ] Run `govulncheck` in CI, fail the build on actionable findings
- [ ] Schedule quarterly upgrade sweeps; do not let bumps accumulate
- [ ] Set `GOPRIVATE` for private modules; keep `GOSUMDB` enabled
- [ ] Wrap load-bearing third-party types in your own interfaces
- [ ] Never expose third-party types in your public API
- [ ] Document forks explicitly in `FORK.md`; plan their retirement
- [ ] Migrate major versions deliberately; prefer gradual over big-bang for large code
- [ ] When removing a dependency, run `go mod tidy` and grep for leftovers

---

## Summary

A third-party package is not a free function call; it is a multi-year obligation. The senior responsibility is to make the obligation visible: estimate the cost before importing, audit the candidate before adopting, govern the dependency graph as it grows, and design the codebase so any single library can be replaced or removed without a rewrite.

The mechanical command — `go get` — is trivial. The discipline around it is not. Cost the dependency; audit the candidate; insulate your code from it; review every upgrade; remove it cleanly when its job is done. A codebase that treats its dependencies this way ages well. A codebase that treats `go get` as free does not.
