# Versioning & SemVer — Middle Level

> **Roadmap:** [Release Engineering](../README.md) → Versioning & SemVer
> *Turning version numbers into a working policy: deciding what counts as breaking, choosing a scheme, and reading the constraint syntax of every ecosystem you touch.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Precedence Rules in Full](#core-concept-1--precedence-rules-in-full)
5. [Core Concept 2 — What Actually Counts as Breaking](#core-concept-2--what-actually-counts-as-breaking)
6. [Core Concept 3 — The 0.x Special Case](#core-concept-3--the-0x-special-case)
7. [Core Concept 4 — Alternatives: CalVer, ZeroVer, EPOCH](#core-concept-4--alternatives-calver-zerover-epoch)
8. [Core Concept 5 — Constraint Syntax Across Ecosystems](#core-concept-5--constraint-syntax-across-ecosystems)
9. [Core Concept 6 — Single Source of Truth](#core-concept-6--single-source-of-truth)
10. [Real-World Examples](#real-world-examples)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

## Introduction

> Focus: **owning a versioning policy for a real package — knowing where the breaking-change line is, which scheme fits, and how to express constraints precisely.**

At the junior tier you read versions and pinned dependencies. Now you publish them. That flips your relationship with SemVer: every bump is a promise *you* make to downstream users, and a wrong bump costs them broken builds at 2 a.m. This page covers the precedence rules in full, a usable definition of "breaking," when SemVer is the wrong tool (CalVer and friends), and the constraint dialects of npm, pip, Go, Cargo, and Maven so you can read any lockfile.

## Prerequisites

**Required**
- The Junior tier of this topic (anatomy, bumps, pre-releases, pinning).
- You have published at least one package or container image, or maintained one.
- Comfort reading a dependency manifest in two or more ecosystems.

**Helpful**
- Exposure to a dependency upgrade that broke production.
- Familiarity with the difference between a library (others import your code) and an application (you ship the binary).

## Glossary

| Term | Plain-English meaning |
| --- | --- |
| Precedence | The rule set that decides which of two versions is "newer." |
| Public API | The surface others depend on: signatures, types, flags, exit codes, wire formats. |
| CalVer | Calendar Versioning — version numbers derived from dates, e.g. `2024.06`. |
| ZeroVer | Staying on `0.x` forever to avoid SemVer's stability promise. |
| EPOCH | A leading counter (PEP 440 `1!2.0`) used to reset a botched version scheme. |
| Compatible release | pip's `~=` operator: allow patch (or minor) updates, forbid the next breaking step. |
| MVS | Minimal Version Selection — Go's algorithm for choosing dependency versions. |
| Pseudo-version | A synthetic Go version for untagged commits: `v0.0.0-20240101120000-abcdef123456`. |
| Lockfile | A generated file recording the exact resolved versions of all dependencies. |

## Core Concept 1 — Precedence Rules in Full

SemVer precedence is defined precisely, and you should know all of it because tooling depends on it.

1. Compare MAJOR, then MINOR, then PATCH numerically. First difference wins.
2. A version **with** a pre-release has **lower** precedence than the same version without one: `1.0.0-rc.1 < 1.0.0`.
3. When both have pre-releases, compare the dot-separated identifiers left to right:
   - Numeric identifiers compare numerically (`alpha.2 < alpha.10`).
   - Alphanumeric identifiers compare in ASCII sort order.
   - Numeric identifiers are always *lower* than alphanumeric ones.
   - A larger set of fields, all else equal, has higher precedence (`alpha < alpha.1`).
4. Build metadata (`+...`) is **ignored entirely** for precedence.

```
1.0.0-alpha  <  1.0.0-alpha.1  <  1.0.0-alpha.beta  <  1.0.0-beta
            <  1.0.0-beta.2   <  1.0.0-beta.11    <  1.0.0-rc.1   <  1.0.0
```

Note `alpha.2 < alpha.10` (numeric) but if those were alphanumeric strings, `"10" < "2"` in ASCII — a classic source of "why did my RC sort wrong" bugs when people zero-pad or stringify identifiers.

## Core Concept 2 — What Actually Counts as Breaking

"Breaking" is the hardest judgment call in versioning. A breaking change is any change that requires a *correct* downstream user to modify their code, configuration, or expectations to keep working. The public API is wider than most people think:

**Clearly breaking (MAJOR):**
- Removing or renaming an exported function, type, field, flag, or endpoint.
- Changing a function signature (parameter order, types, required-ness).
- Changing a return type or the shape of a JSON/protobuf response.
- Tightening input validation so previously-accepted input now errors.
- Changing a default value that alters observable behavior.
- Removing a CLI flag or changing an exit code.

**Often-overlooked breaking changes:**
- Raising the minimum runtime/language version (`requires Node 18+`).
- Changing error types or error messages that callers match on.
- Reducing precision or changing serialization (`1.0` → `1`).
- Making a previously-optional config field required.

**Not breaking (MINOR or PATCH):**
- Adding a new optional parameter with a default.
- Adding a new function, endpoint, or enum value (usually — see note).
- Internal refactors with identical observable behavior.
- Performance improvements that keep the contract.

```go
// PATCH — fix without contract change
func Divide(a, b int) (int, error) {
    if b == 0 { return 0, errors.New("divide by zero") } // was a panic
    return a / b, nil
}

// MAJOR — return signature changed; every caller must adapt
func Divide(a, b int) int { ... }  →  func Divide(a, b int) (int, error) { ... }
```

> Adding an enum value can break consumers who `switch` exhaustively. Whether that is MINOR or MAJOR is a policy decision — document it.

## Core Concept 3 — The 0.x Special Case

SemVer carves out a deliberate escape hatch: **while MAJOR is 0, anything may change at any time.**

```
0.x.y  →  "initial development; the public API is not stable."
```

Under `0.x`, the *minor* slot acts like a major slot by convention in many ecosystems. Cargo, for instance, treats `0.2.0` and `0.3.0` as incompatible: `^0.2.1` resolves to `>=0.2.1, <0.3.0`, **not** `<1.0.0`. That mirrors how teams actually use `0.x`: each minor can break.

The corollary: **reaching `1.0.0` is a commitment, not a milestone.** It says "I will not break this without bumping MAJOR." Many mature projects stay on `0.x` precisely to avoid that commitment — see ZeroVer below.

## Core Concept 4 — Alternatives: CalVer, ZeroVer, EPOCH

SemVer answers "is this safe to upgrade?" That is the right question for **libraries**. For other software, different schemes fit better.

**CalVer (Calendar Versioning).** The version encodes the release date.

```
Ubuntu        24.04      → YY.MM
pip           24.0       → YY.MINOR
Black         24.3.0     → YY.MM.MICRO
```

CalVer fits when "newer is better" is the only question that matters and there is no stable import API to protect — operating systems, end-user apps, tools with continuous delivery, and time-boxed releases (`2024.06` tells you instantly how stale you are). It is a poor fit for libraries, because the number carries no compatibility signal.

**ZeroVer.** Deliberately never reaching `1.0.0`. Common, half-joking, and surprisingly principled: it keeps the "anything may change" license forever. Risky as a real policy because it signals "not production-ready" to cautious adopters.

**EPOCH.** When your numbering scheme itself was wrong (e.g. you switched from date strings to SemVer and the old numbers sort higher), an epoch prefix forces ordering. PEP 440 spells it `1!`:

```
old:  2024.01.0
new:  1!1.0.0      # the "1!" epoch makes this sort AFTER the date-based ones
```

**Decision guide:**

| Software type | Recommended scheme |
| --- | --- |
| Public library / SDK | SemVer |
| CLI tool with an import API | SemVer |
| End-user app, OS, distro | CalVer |
| Internal service (deploy-only, no consumers import it) | CalVer or commit-SHA + build number |
| Schema / protobuf / API contract | SemVer on the contract itself |

## Core Concept 5 — Constraint Syntax Across Ecosystems

The same intent ("accept compatible updates") is written five different ways. Memorize the table; you will read all of these.

```bash
# npm / Cargo — caret: compatible-with, treats leftmost non-zero as the breaking slot
^1.2.3   → >=1.2.3 <2.0.0
^0.2.3   → >=0.2.3 <0.3.0     # 0.x: minor is the breaking slot
^0.0.3   → >=0.0.3 <0.0.4     # 0.0.x: patch is the breaking slot

# npm — tilde: patch-level only (when minor is given)
~1.2.3   → >=1.2.3 <1.3.0

# pip / PEP 440 — compatible release
~=1.2.3  → >=1.2.3 <1.3.0
~=1.2    → >=1.2 <2.0
==1.2.*  → any 1.2 patch

# Maven — hard ranges with interval notation
[1.2.3]          exactly 1.2.3
[1.2.3,2.0.0)    >=1.2.3 and <2.0.0
1.2.3            a "soft" requirement — a recommendation, not a hard pin
```

**Go is the outlier.** It does not resolve ranges. You write a single minimum version, and the build uses **Minimal Version Selection (MVS)**: of all the minimums requested across the whole dependency graph, pick the highest. There is no `^` or `~`.

```bash
# go.mod
require github.com/pkg/errors v0.9.1   # this is a *minimum*, not a ceiling
```

Go also encodes the **major version in the import path** (Semantic Import Versioning):

```go
import "github.com/foo/bar"        // v0 or v1
import "github.com/foo/bar/v2"     // v2 — a different import path entirely
```

And for commits without a tag, Go synthesizes a **pseudo-version**:

```
v0.0.0-20240101120000-abcdef123456
  │    │              └ 12-char commit hash
  │    └ commit timestamp (UTC)
  └ the base version it sorts just above
```

## Core Concept 6 — Single Source of Truth

The version must be defined in exactly one authoritative place, and everything else derives from it. Otherwise the tag, the manifest, and the binary disagree and you cannot trust any of them.

Two common patterns:

**Manifest as source, tag follows.** The version in `package.json` / `Cargo.toml` / `pyproject.toml` is canonical; a release tool (`npm version`, `cargo release`) bumps it and creates a matching Git tag.

```bash
npm version minor   # edits package.json AND creates tag v1.5.0 AND commits
```

**Tag as source, manifest/binary derives.** The Git tag is canonical; the build reads it and injects it. Standard in Go via linker flags:

```bash
go build -ldflags "-X main.version=$(git describe --tags)" ./...
```

```go
var version = "dev"  // overwritten at build time
func main() { fmt.Println("v" + version) }
```

Whichever you pick, never let two places drift. A common CI check: assert that the manifest version equals the tag being released.

## Real-World Examples

- **The caret-zero footgun.** A team pins `^0.4.2` of a library expecting only patches. The author ships `0.5.0` with breaking changes. Because Cargo/npm treat `0.x` minors as breaking, `^0.4.2` correctly stays below `0.5.0` — but a naive `>=0.4.2` would have pulled it in and broken the build. Knowing the `0.x` rule saved them.
- **Go's MVS in action.** Module A requires `lib v1.2.0`; module B requires `lib v1.4.0`. Go selects `v1.4.0` — the maximum of the minimums — deterministically, with no SAT solver and no "latest" surprises on rebuild.
- **CalVer for an app, SemVer for its SDK.** A company ships its desktop app as `2024.6.1` (CalVer — users only care about "newest") but its public client library as `3.2.0` (SemVer — integrators need the compatibility signal). Same company, two schemes, each correct.

## Mental Models

- **A version number is a compression of a diff.** MAJOR/MINOR/PATCH is three bits of metadata about "how different is this from the last one." Choose the scheme whose bits answer your users' actual question.
- **The caret is the breaking-slot detector.** `^` freezes the leftmost non-zero component and lets everything to its right move.
- **Go trades flexibility for reproducibility.** No ranges means no resolution surprises; the trade-off is manual minimum bumps.
- **0.x is a learner's permit.** You can swerve all you want; once you hit 1.0 you owe everyone a smooth ride.

## Common Mistakes

- **Calling an error-message change "just a patch"** when consumers parse the message. It is breaking in practice.
- **Using `>=1.2.0` with no upper bound** in npm/pip — you will silently accept the next breaking major. Use `^` or `~=`.
- **Bumping MAJOR on a `0.x` project.** Going `0.4.0 → 1.0.0` is fine, but `0.4.0 → 0.5.0` already signals breakage; you do not need MAJOR yet.
- **Letting the tag and manifest disagree.** Add a CI assertion.
- **Picking CalVer for a library.** Integrators cannot tell a safe upgrade from a breaking one.
- **Forgetting Go's `/v2` import path.** Tagging `v2.0.0` without changing the module path means nobody can import the new major.

## Test Yourself

1. In Cargo, what does `^0.3.1` resolve to, and why is it not `<1.0.0`?
2. Two modules in a Go build require `v1.1.0` and `v1.5.0` of the same dependency. Which is selected?
3. You renamed a JSON response field from `user_id` to `userId`. Is that PATCH, MINOR, or MAJOR? Justify.
4. Why might a continuously-deployed internal service use CalVer or a build number instead of SemVer?

<details>
<summary>Answers</summary>

1. `>=0.3.1, <0.4.0`. Under `0.x`, Cargo treats the minor slot as the breaking slot, so the caret freezes the `0.3` part.
2. `v1.5.0` — MVS selects the maximum of all requested minimums.
3. MAJOR. The wire contract changed; any consumer reading `user_id` breaks. Field renames in a serialized format are breaking.
4. Nobody *imports* it, so there is no compatibility contract to encode. The only useful questions are "how new is this?" and "which commit is running?" — answered better by a date or SHA than by MAJOR.MINOR.PATCH.

</details>

## Cheat Sheet

```
PRECEDENCE:  major > minor > patch (numeric);  pre-release < release;  +meta ignored
0.x RULE:    anything may break; minor acts as the breaking slot

CARET BY SLOT:
  ^1.2.3 → >=1.2.3 <2.0.0
  ^0.2.3 → >=0.2.3 <0.3.0
  ^0.0.3 → >=0.0.3 <0.0.4

ECOSYSTEMS:
  npm/cargo   ^ (caret default in cargo), ~ (npm patch)
  pip/PEP440  ~= (compatible release), == , ===
  maven       [1.0,2.0)  exact []  soft = bare number
  go          single minimum + MVS;  /v2 import path;  pseudo-version for untagged

SCHEME PICK:  library→SemVer   app/OS→CalVer   internal-deploy→CalVer/SHA   contract→SemVer
SOURCE OF TRUTH:  one place (manifest or tag); assert equality in CI
```

## Summary

- Know full precedence: pre-releases sort before releases; build metadata never affects ordering.
- "Breaking" includes signature changes, wire-format changes, raised minimums, and error contracts callers depend on — not just deletions.
- `0.x` means "anything may change"; reaching `1.0.0` is a stability commitment.
- SemVer suits libraries; CalVer suits apps and deploy-only services; EPOCH rescues a botched scheme.
- Each ecosystem writes constraints differently — and Go uses Minimal Version Selection with no ranges at all.
- Keep one source of truth for the version and assert it in CI.

## Further Reading

- semver.org — the full grammar and precedence rules.
- calver.org — the CalVer rationale and field vocabulary.
- "Go Modules Reference" — MVS, pseudo-versions, and semantic import versioning.
- PEP 440 — Python's version and specifier grammar.

## Related Topics

- [Changelogs & Release Notes](../02-changelogs-and-release-notes/) — pairing each bump with a human-readable description.
- [Release Branching & Trains](../03-release-branching-and-trains/) — how versions map to branches.
- [Rollback & Roll-Forward](../07-rollback-and-roll-forward/) — what to do when a "safe" bump was not.
- [Build Systems](../../build-systems/) — embedding versions via ldflags and build args.
