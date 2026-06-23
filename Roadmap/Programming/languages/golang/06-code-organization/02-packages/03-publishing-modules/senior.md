# Publishing Modules — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Designing a Library for Public Consumption](#designing-a-library-for-public-consumption)
3. [The API Surface as a Public Contract](#the-api-surface-as-a-public-contract)
4. [Stability Tiers (experimental, stable, deprecated)](#stability-tiers-experimental-stable-deprecated)
5. [Backwards Compatibility: What You Owe Consumers](#backwards-compatibility-what-you-owe-consumers)
6. [Major Version Strategy and `/vN`](#major-version-strategy-and-vn)
7. [Release Cadence and Release Engineering](#release-cadence-and-release-engineering)
8. [Maintenance Branches](#maintenance-branches)
9. [Communication Channels (release notes, changelog, deprecation messages)](#communication-channels-release-notes-changelog-deprecation-messages)
10. [Security Releases and Embargo Coordination](#security-releases-and-embargo-coordination)
11. [License and Trademark Considerations](#license-and-trademark-considerations)
12. [Building Trust as a Library Author](#building-trust-as-a-library-author)
13. [Anti-Patterns](#anti-patterns)
14. [Senior-Level Checklist](#senior-level-checklist)
15. [Summary](#summary)

---

## Introduction

A senior engineer publishing a Go module is not just "pushing code to GitHub and tagging a release." Publishing is a *commitment*. Once a version is tagged and someone has imported it, that version exists forever in the module proxy, in `go.sum` files, in SBOMs, in air-gapped corporate caches. You cannot un-publish. You cannot rewrite. You can only move forward.

This file is about *how to publish well*: how to design a module that consumers can rely on for years, how to evolve it without breaking them, how to communicate change, and how to recover when something goes wrong. The mechanical content (`git tag v1.0.0 && git push --tags`) is in [junior.md](junior.md) and [middle.md](middle.md).

After reading this you will:
- Design an API surface that you can defend at v1.0 and beyond
- Use stability tiers to set consumer expectations honestly
- Understand the Go 1 compatibility promise and apply it to your own libraries
- Plan major version bumps as coordinated migrations, not emergencies
- Run a release process that consumers can trust without watching it

---

## Designing a Library for Public Consumption

A library used internally and a library used by the public are not the same thing, even if the code is identical. Public consumption demands constraints that internal use does not.

### The minimal-API principle

Every exported symbol is a promise you cannot easily withdraw. A function added "just in case someone needs it" becomes a function you must support, document, and not break — possibly for a decade.

Start small. Export the minimum that lets consumers do useful work. Add more later, in response to *real* requests. Removing is a major-version event; adding is a minor-version event. Asymmetry favours starting small.

### Naming

Names in a library carry weight that internal names do not. They appear in autocompletion menus, in pkg.go.dev, in StackOverflow answers. A bad name lasts forever, because renaming is a breaking change.

Senior naming heuristics:

- Avoid stutter: `csvkit.CSVReader` reads as "csvkit dot CSV Reader." Prefer `csvkit.Reader`.
- Avoid abbreviations a newcomer will not recognise. `NewHTTPClient` is fine; `NewHC` is not.
- Prefer nouns for types, verbs for functions, adjectives for booleans (`IsValid`, `HasNext`).
- Match the style of the standard library. `bytes.Buffer`, not `bytes.ByteBuffer`.
- Reserve short names for common things. `Reader` for the main reader; `LineReader` for the niche one.

### Idiomatic Go style

Public libraries should *look* like Go. A library that reads as Java-in-Go is harder to adopt because users must context-switch.

Idiomatic markers:

- Errors are returned, not thrown.
- Constructors return concrete types, not interfaces (unless interface is the right abstraction).
- Zero values are useful where possible. `var b bytes.Buffer` is immediately ready to use.
- Channels and goroutines are exposed only when concurrency is part of the contract.
- `context.Context` is the first parameter of any function that does I/O.

### Runnable examples in pkg.go.dev

pkg.go.dev renders example functions as runnable code blocks. An example called `ExampleReader` becomes the canonical "how do I use this" snippet. A library without examples looks unfinished.

Naming convention:

```go
func Example()              // package-level
func ExampleReader()        // type-level
func ExampleReader_Read()   // method-level
func ExampleReader_basic()  // additional example, lowercase suffix
```

The example body is compiled and executed by `go test`. Output is verified against the `// Output:` comment. Broken examples fail CI.

This makes examples *executable documentation*: never out of date.

---

## The API Surface as a Public Contract

Every exported identifier is a contract. The contract is: *I will not break you on a minor or patch release.* That is the Go 1 promise applied to your library.

### What counts as the surface

- Every exported package, type, function, method, variable, constant.
- The signature of every exported function/method (parameter types and order).
- The fields of every exported struct that a consumer might construct directly.
- The methods of every interface a consumer might implement or satisfy.
- The set of named errors (`var ErrNotFound = errors.New(...)`) consumers may compare with `errors.Is`.

### What is *not* part of the surface (but often mistaken for it)

- Internal helpers. Put them in `internal/` and they cannot leak.
- Unexported fields of exported structs.
- Implementation details of interface satisfaction (if `Reader` is an interface, you can change the underlying type).
- Performance characteristics — though if you advertise them, they become part of the contract.
- Documentation prose — except where it makes specific guarantees ("this function never blocks").

### The `internal/` boundary

Anything you put under `internal/` is invisible to external importers. Use it aggressively. The default location for a helper is `internal/`; you promote it to the public surface only when you have decided to support it as a public API.

```
github.com/alice/csvkit/
├── go.mod
├── reader.go             ← public
├── writer.go             ← public
└── internal/
    ├── parser/           ← private; refactor freely
    └── buffer/
```

A junior engineer adds new things to the public surface. A senior engineer adds new things to `internal/` and only promotes when the design is settled.

### Re-evaluate before v1

Before tagging v1.0.0, walk the entire public surface package by package. For each exported symbol, ask:

1. Do I want to support this for years?
2. Is the name still correct?
3. Are the parameters still in the right order?
4. Is the documentation accurate?
5. Could this be in `internal/` instead?

This is your last cheap chance to reshape. After v1.0.0, every change is a version-bump decision.

---

## Stability Tiers (experimental, stable, deprecated)

Not every part of a library moves at the same speed. Senior libraries acknowledge this with explicit tiers.

### Stable (the default for v1)

Anything not marked otherwise is stable. The promise is: *no breaking changes without a major version bump.*

### Experimental

A package or function whose API may change without a major bump. Convention varies; common patterns:

- A sub-package named `experimental/` or `x/`:
    ```
    github.com/alice/csvkit/experimental/streaming
    ```
- A doc comment marker:
    ```go
    // EXPERIMENTAL: this API may change in any release.
    func StreamReader(...) {}
    ```
- A separate module entirely (`github.com/alice/csvkit-experimental`).

The point is *informed consent*. A consumer importing from `experimental/` has acknowledged the risk. Their build will compile, but they own the upgrade pain.

### Deprecated

A symbol still works, but a replacement exists and the symbol will be removed in the next major version.

```go
// Deprecated: use NewReaderV2 instead. Removed in v2.0.0.
func NewReader(...) *Reader { ... }
```

`Deprecated:` at the start of a doc comment is a convention recognised by `staticcheck`, `gopls`, and pkg.go.dev. Consumers see a warning at compile time (via lint) and a strikethrough in their editor.

Deprecation is *not* removal. The function still works; it just signals "do not use in new code."

### A typical lifecycle

```
unreleased → experimental → stable → deprecated → removed (next major)
```

Time at each stage varies. A small bug-fix library may skip experimental. A complex feature may sit in experimental for a year. Removal happens *only* at major-version boundaries.

---

## Backwards Compatibility: What You Owe Consumers

The Go standard library follows the *Go 1 compatibility promise*: code that compiles against Go 1 will continue to compile and run against every later 1.x. Senior library authors apply the same model to their own libraries.

### Allowed changes (minor / patch)

- Adding a new package.
- Adding a new exported type, function, method, constant, variable.
- Adding a method to an existing exported struct (interfaces are different — see below).
- Adding a field to an exported struct *if* consumers do not construct it with positional or keyed-without-defaults literals (i.e. the struct is always returned from a constructor and treated as opaque).
- Improving documentation, internal performance, internal correctness.
- Bug fixes that match documented behaviour.

### Disallowed changes (require major bump)

- Removing or renaming any exported symbol.
- Changing the signature of any exported function or method.
- Changing the type of an exported variable.
- Adding a method to an exported interface (consumers' implementations break).
- Removing a method from an exported interface.
- Changing a struct in a way that breaks consumers who construct it literally.
- Changing the package path of any package.

### The grey zone

Some changes are technically backwards-compatible but practically painful:

- Tightening parameter validation. Code that previously worked may now error.
- Returning an error where one was previously not returned. Same problem.
- Changing the timing or ordering of side effects (callbacks, goroutine scheduling).

A senior library author treats these as breaking unless they are clearly bug fixes restoring documented behaviour.

### Adding methods to interfaces

If your library defines `type Reader interface { Read(...) }` and you add `Close()`, every consumer who implemented `Reader` themselves now has a broken implementation. This is a major-version change.

The workaround: define a *new* interface that embeds the old one.

```go
type Reader interface {
    Read(p []byte) (int, error)
}

type ReadCloser interface {
    Reader
    Close() error
}
```

`ReadCloser` is purely additive. `Reader` is unchanged.

---

## Major Version Strategy and `/vN`

Sooner or later you will need to break compatibility. The Go module system requires a major version bump, and the import path must change to `module/vN` for all `N >= 2`.

### The decision

A major bump is a *project-level* decision, not a per-PR decision. It costs every consumer real work to upgrade. Treat it that way.

Reasons that justify a major bump:

- The API has accumulated friction the standard `Deprecated` mechanism cannot resolve.
- A core dependency had a major bump that you must reflect.
- A security or correctness issue cannot be patched without a breaking change.

Reasons that do *not* justify a major bump:

- "I want to clean up the names." Use Deprecated and add new names alongside.
- "I have a new feature." Features are minor versions.
- "It has been a while since the last major." Time is not a reason.

### Layout: branch vs subfolder

Two layouts are supported by Go modules.

#### Subfolder layout

```
github.com/alice/csvkit/
├── go.mod                    (module github.com/alice/csvkit)
├── reader.go                 (v1)
└── v2/
    ├── go.mod                (module github.com/alice/csvkit/v2)
    └── reader.go             (v2)
```

Both versions live on `main`. Consumers import `github.com/alice/csvkit` for v1 and `github.com/alice/csvkit/v2` for v2. Tags: `v1.5.3` for v1, `v2.0.0` for v2.

Pros: one branch, easy to refactor across versions.
Cons: `v2/` directory clutters the repo; some tooling (linters, IDEs) gets confused.

#### Branch layout

```
main branch (v2):
github.com/alice/csvkit/
├── go.mod                    (module github.com/alice/csvkit/v2)
└── reader.go

release-v1 branch:
github.com/alice/csvkit/
├── go.mod                    (module github.com/alice/csvkit)
└── reader.go
```

The major version lives in the module path of the `go.mod` on each branch. Tags: `v1.5.3` on `release-v1`, `v2.0.0` on `main`.

Pros: cleaner repo layout; main is always the latest.
Cons: more branch management; backporting is per-branch.

### The rename

Bumping to `/v2` requires editing every internal import inside the new module to reference `/v2`. Files inside `csvkit/v2/internal/parser/parser.go` that import `github.com/alice/csvkit/internal/buffer` must become `github.com/alice/csvkit/v2/internal/buffer`. Tools like `gomajor` automate this.

Forgetting one import is a subtle bug: the new module silently links against the old version of itself. Run `go build ./...` after the rename and verify the dependency graph with `go list -m all`.

### Coordinating with consumers

A major version bump is a release event. Senior library authors:

- Announce it in advance (2–4 weeks). Blog post, issue, mailing list.
- Provide a migration guide. Concrete before/after code samples for every breaking change.
- Tag a final release of the old major (`v1.X.0`) the same day, marking it deprecated.
- Continue security patches on the old major for a stated window (often 6–12 months).

---

## Release Cadence and Release Engineering

A library nobody can predict the release pattern of is hard to depend on.

### Scheduled vs continuous

**Scheduled releases** happen on a regular calendar — first Monday of the month, or on a quarterly cycle. Consumers know when to expect upgrades. Examples: Go itself (every six months), Kubernetes (every four months).

**Continuous releases** happen whenever something is ready. Each merged PR can trigger a tag. Consumers must consume frequently or fall far behind.

Choose by your audience. Library authors aiming at infrastructure teams do well with scheduled. Authors of fast-moving CLIs or development tools do well with continuous.

### Small frequent releases beat big rare ones

A 0.0.1 patch released today is easier to adopt than a 1.0.0 → 2.0.0 jump released next year. Frequent small releases:

- Make the changelog short and reviewable per release.
- Allow consumers to bisect issues precisely.
- Reduce the cognitive load of "what changed since I last upgraded."
- Pressure-test the release process so it is boring on release day.

A common rhythm: patch releases as needed, minor releases every 2–6 weeks, major releases every 1–3 years.

### Release engineering basics

A reliable release process is:

- **Automated.** Tags trigger CI which builds, tests, signs artefacts, publishes to the proxy. Manual steps create release-day stress.
- **Reproducible.** Re-running the release pipeline on the same tag produces identical artefacts.
- **Verifiable.** Each release has a checksum, a signature, and a publicly verifiable build attestation (Sigstore, SLSA provenance).
- **Reversible (mostly).** A tag can be `retract`ed in a follow-up release; you cannot delete it from the proxy, but you can mark it broken.

### Go-specific release mechanics

For a Go library, "releasing" is mostly:

1. Tag a commit on the appropriate branch with `vMAJOR.MINOR.PATCH`.
2. Push the tag.
3. The Go module proxy sees the tag and caches the release.

The first request from any user warms the proxy cache. Best practice: trigger a request yourself (`go list -m github.com/alice/csvkit@v1.5.0`) right after pushing, so the cache is hot before your changelog email reaches readers.

---

## Maintenance Branches

After a major bump, the previous major does not vanish — it just stops getting features.

### The `release-vN` pattern

When v2 is released, create branch `release-v1` from the v1 head. From that point on:

- `main` (or `master`) is at v2. New features, breaking changes, regular releases.
- `release-v1` receives only critical fixes. Security patches, severe bugs.

Every fix that applies to both is implemented on `main`, then cherry-picked to `release-v1` (or vice versa). A small backport script saves time.

### How long to maintain

Stating it publicly is more important than the exact length. Common policies:

- **Last major only.** When v3 ships, v2 stops getting fixes. Brutal but simple. Suitable for fast-moving libraries.
- **N-1.** Two majors are supported simultaneously. The newest gets features and fixes; the previous gets fixes only.
- **Fixed window.** "Each major version is supported for 18 months from the next major's release." Predictable; requires discipline.

Document the policy in the README and in release notes. Consumers planning multi-year deployments care a lot.

### CI for maintenance branches

The maintenance branch needs its own CI. Tests must pass against the *original* Go version of that major (v1 may target Go 1.18; v2 may target 1.21). Forgetting this is a common source of "v1 builds are red" embarrassment.

---

## Communication Channels (release notes, changelog, deprecation messages)

A release nobody knows about is a release that did not happen.

### CHANGELOG.md

A changelog at the repo root, in a format consumers can scan in 30 seconds. The Keep a Changelog format is widely adopted:

```markdown
# Changelog

## [1.5.0] - 2025-03-10

### Added
- `Reader.LineCount()` method (#142)
- Support for tab-delimited input (#138)

### Changed
- `Reader.Read` now uses a 64KB buffer by default (was 32KB) (#140)

### Deprecated
- `NewLegacyReader` — use `NewReader` with `WithLegacy(true)` (#137)

### Removed
- (nothing)

### Fixed
- Panic on empty input with header mode (#139)

### Security
- (nothing)
```

Sections that are empty can be omitted. Each entry should link to the PR or issue for context. Anything that affects consumers belongs here, even if "trivial."

### Release notes on the platform

GitHub Releases (and equivalents) display release notes when consumers click a tag. The notes should be the changelog entry for that version, possibly expanded with context: "this release fixes a panic introduced in 1.4.0," "this is the first release with generics support."

### Deprecation messages

A deprecation in code (`// Deprecated: ...`) is a deprecation message. Make it actionable.

Bad:

```go
// Deprecated: do not use.
```

Good:

```go
// Deprecated: NewReader is unsafe with concurrent input. Use NewReaderContext
// instead, which accepts a context.Context for cancellation. Will be removed
// in v3.0.0 (estimated Q2 2026).
```

The message should answer: *what to use instead, when will it be removed, why is it being deprecated.*

### Other channels

- A mailing list or Discussions board for design proposals.
- A `SECURITY.md` for vulnerability reports.
- A `CONTRIBUTING.md` for new contributors.
- A blog or release-announcement post for major versions.

Consumers do not read all channels. Cross-post important news.

---

## Security Releases and Embargo Coordination

Security releases are different from feature releases. They have an audience that is not yet informed and a timer.

### The embargo

When a vulnerability is reported (typically via `SECURITY.md` or a security advisory channel), you do *not* fix it in the open. You:

1. Acknowledge the report privately.
2. Reproduce and assess severity.
3. Develop a fix in a private branch or fork.
4. Coordinate a release date with the reporter.
5. Optionally request a CVE identifier from a CNA (CVE Numbering Authority).
6. Tag and publish the fix.
7. Publish the advisory and notify consumers.

The embargo period gives major consumers a chance to patch before attackers see the fix. Common windows: 14–90 days.

### CVE assignment

A CVE (Common Vulnerabilities and Exposures) ID is the universal reference for a vulnerability. To get one:

- Use GitHub Security Advisories for projects on GitHub. GitHub is a CNA and will issue a CVE automatically.
- Contact MITRE directly for projects elsewhere.
- For Go-specific reporting, file with the [Go vulnerability database](https://pkg.go.dev/vuln/).

A CVE is your way of telling the world: "this version has a known issue, do not use it."

### Tagging the fix

When ready, tag the fix as a *patch* release on every supported maintenance branch. If v3 is current and v2 is in maintenance, you may need to release `v2.X.Z+1` and `v3.Y.W+1` simultaneously.

Use `retract` to mark the affected versions:

```
retract [v3.0.0, v3.1.4]  // CVE-2026-12345: panic on crafted input
```

This appears in the latest `go.mod` and warns consumers running `go list -m -u all`.

### The advisory

A security advisory describes:

- What the vulnerability is.
- Which versions are affected.
- Which version contains the fix.
- The CVE ID.
- Credit to the reporter (if they consent).
- A timeline of disclosure.

Publish on GitHub Security Advisories, on your project blog, on the Go vulnerability database, and via any consumer mailing list you maintain.

---

## License and Trademark Considerations

A module without a license is, in most jurisdictions, *all rights reserved*. Consumers cannot legally use it. Senior library authors include a license from day one.

### Choosing a license

Use an OSI-approved license. The common Go ecosystem choices:

- **MIT.** Maximally permissive. The default in much of the Go ecosystem.
- **Apache 2.0.** Permissive, with an explicit patent grant. Used by Kubernetes, gRPC, the Go project itself.
- **BSD-3-Clause.** Permissive, with attribution. Older but still common.
- **MPL 2.0.** File-level copyleft. Used by HashiCorp, Mozilla.

Pick one. Add `LICENSE` to the repo root. The text must be *exactly* the official text — don't paraphrase.

Do not invent a custom license. Custom licenses cannot be vetted by corporate legal teams; some companies forbid all dependencies under non-OSI licenses by policy. A custom license excludes those consumers entirely.

### Multi-license repos

If parts of your repo have different licensing (e.g. test data is CC0, code is MIT), use SPDX headers per file:

```go
// SPDX-License-Identifier: MIT
package csvkit
```

And document the structure in `LICENSE` or `README`.

### Trademark

The *name* of your project may be trademarked even if the code is freely licensed. Famous examples: "Linux" is trademarked; "Kubernetes" is trademarked. Forks can use the code under license but cannot use the name without permission.

If you build a community around a name, register the trademark in your jurisdiction. If you don't, you may lose the right to defend it.

For most small libraries this is overkill. For libraries that become company assets or community brands, it matters.

### Contributor agreements

If you accept external contributions, decide whether to require:

- **DCO (Developer Certificate of Origin).** Each commit signed off (`git commit -s`). Lightweight; common in the Go ecosystem.
- **CLA (Contributor License Agreement).** Contributors sign a legal document granting you rights. Heavier; common at large foundations (CNCF, Apache).
- **Nothing explicit.** The commit-and-PR action implies a license under the project's license. Common in small projects; legally murky at scale.

Document your choice in `CONTRIBUTING.md`.

---

## Building Trust as a Library Author

A library is adopted because consumers trust the author, not just because the code is good. Trust is earned over time and can be destroyed in a single bad release.

### Predictable releases

A release every quarter, on schedule, builds trust. A release every 6 months sometimes, every 2 days other times, then nothing for a year, destroys it. Consumers calibrate their planning to your cadence. Be consistent.

### Responsive issue triage

You don't have to fix every issue. You do have to *respond* to them. A 24-hour acknowledgement ("got this, will look in a few days") is enormous for the reporter. A two-month silence followed by a closing comment of "won't fix" is the opposite.

For libraries with significant traffic, set a triage rotation: someone reads new issues at least weekly, labels them, and replies with at least a holding response.

### Clear deprecation timelines

If you tell consumers "this will be removed in v3," and then v3 ships without removing it, you have lied — even if everyone's life is easier for it. Stick to deprecation timelines. If the timeline must change, announce the change with as much notice as the original announcement.

### No rug-pulls

A rug-pull is when an author abruptly changes the project in a way that violates implicit trust:

- Relicensing under a non-open-source license without warning.
- Removing access to old versions.
- Forcing consumers onto a paid product.
- Sudden, unannounced major bumps.

Even when legally permitted, rug-pulls destroy reputation across the ecosystem. Some consumers will refuse to depend on anything you publish, ever again.

### Visible sustainability

Consumers want to know your project will still exist next year. Visible signals:

- Recent commits (within months, not years).
- Multiple maintainers (bus factor > 1).
- A funding model if applicable (GitHub Sponsors, Tidelift, corporate ownership).
- A statement in `README.md` about the project's status (active, maintenance-only, looking-for-maintainers).

A library can be "feature complete" — that's fine. State it. "This library is feature complete; releases are bug-fix only." That is much better than silent inactivity.

---

## Anti-Patterns

- **Rewriting tags (force-pushing a tag to a different commit).** The Go module proxy caches `vX.Y.Z` against a hash. Some consumers will get the old code, some the new; which one depends on whether their proxy entry has been evicted. Catastrophic and unfixable. Always tag a *new* version.
- **Removing exported APIs in patch releases.** Consumers expect patches to be safe upgrades. Removing anything is a major bump.
- **Undocumented breaking changes in v0 → v1.** v1 is the moment consumers commit. If v1 silently breaks v0 patterns, you have squandered the most important release in the project's life.
- **Hostile takedowns.** Yanking a project (deleting the repo, retracting all versions, switching to a private license) because of a personal grievance. Some companies maintain blocklists of authors who have done this; the reputational damage outlasts the grievance.
- **No license.** "Open source" without an explicit license is not legally usable.
- **Custom license.** Excludes anyone whose legal team blocks non-OSI dependencies.
- **Releasing v1.0.0 without re-evaluating the API surface.** v1 is the long-term commitment. Treat the moment seriously.
- **Skipping deprecation periods.** Removing a function in v2 that was only deprecated in v1.999. Consumers need at least one minor cycle to adopt the deprecation message.
- **Ignoring the maintenance branch.** Once you stop fixing v1, say so publicly. Consumers on v1 deserve to know they need to upgrade.
- **No `SECURITY.md`.** Researchers need a private channel. Without one, they may report on a public issue, escalating disclosure.
- **No examples in pkg.go.dev.** Consumers cannot evaluate the library at a glance; adoption suffers silently.
- **Adding required parameters.** "It used to take 2 args, now it takes 3" is a breaking change disguised as a feature.

---

## Senior-Level Checklist

- [ ] Public API designed with the minimal-surface principle
- [ ] All non-public helpers under `internal/`
- [ ] Runnable examples on every important type
- [ ] Stability tier for each package (stable, experimental, deprecated)
- [ ] Backwards compatibility policy stated in README
- [ ] Major version layout chosen (subfolder vs branch)
- [ ] Release cadence chosen and documented
- [ ] Maintenance branch policy documented
- [ ] CHANGELOG.md kept current with every release
- [ ] `Deprecated:` comments include replacement and removal version
- [ ] `SECURITY.md` with private reporting channel
- [ ] CVE-issuance path identified (GitHub Advisories or MITRE)
- [ ] OSI-approved LICENSE at repo root
- [ ] Contributor model chosen (DCO/CLA/none) and documented
- [ ] Release pipeline automated and reproducible
- [ ] Module proxy cache warmed after each tag
- [ ] No tags rewritten; broken releases handled via `retract`
- [ ] Project status (active / maintenance / archived) stated in README

---

## Summary

Publishing a Go module is publishing a long-term contract. The code is just the artefact; the contract is the *promise* — that exported names will not vanish, that breaking changes will arrive only at major bumps, that security issues will be handled responsibly, that the project will not be rug-pulled.

A senior library author designs the API surface as if every line is forever, uses `internal/` and stability tiers to preserve flexibility, treats Go 1-style backwards compatibility as the default, plans major bumps as coordinated migrations, runs releases on a predictable schedule, communicates change through a current changelog and clear deprecations, handles security under embargo, and chooses an OSI-approved license from day one.

Tagging a release is one git command. Earning trust as a library author takes years and can be lost in a single afternoon. Publish like the contract is forever — because, in a real sense, it is.
