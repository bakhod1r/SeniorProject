# Dependency Management — Junior Level

> **Roadmap:** [Build Systems](../README.md) → Dependency Management
> *Almost no program is built only from code you wrote. The rest comes from strangers, in versions you didn't pick by hand — and "it worked yesterday" is usually a dependency that quietly changed underneath you.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — What a Dependency Actually Is](#core-concept-1--what-a-dependency-actually-is)
5. [Core Concept 2 — Semantic Versioning: the Version Is a Promise](#core-concept-2--semantic-versioning-the-version-is-a-promise)
6. [Core Concept 3 — Why Version Ranges Exist](#core-concept-3--why-version-ranges-exist)
7. [Core Concept 4 — Transitive Dependencies: the Iceberg](#core-concept-4--transitive-dependencies-the-iceberg)
8. [Core Concept 5 — The Lock File and Why You Commit It](#core-concept-5--the-lock-file-and-why-you-commit-it)
9. [Real-World Examples](#real-world-examples)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **What are dependencies, and why does the same code build differently on two machines?**

You almost never write a whole program from scratch. You reach for a JSON parser, an HTTP client, a date library — code other people wrote and published. Those are your **dependencies**. A modern app has a handful you chose directly and *hundreds* you never heard of, pulled in because your dependencies have their own dependencies.

Here is the problem that makes this a real subject and not just "download some libraries." Every dependency has *versions*, and they keep releasing new ones. When you wrote `"requests": "^2.0.0"` in a config file, you didn't say "version 2.0.0" — you said "any 2.x that's out there." So the build on your laptop in March grabs `2.31.0`, and the build on the CI server in June grabs `2.32.4`, and now a test fails for one of you and not the other. Same source code. Different dependencies. This is the "it worked yesterday" bug, and it is overwhelmingly the most common one beginners hit.

This page teaches the machinery that tames it: how versions encode a promise (**semver**), why you usually ask for a *range* instead of an exact version, what the giant invisible tree of **transitive dependencies** is, and what a **lock file** is — the thing that turns "any 2.x" back into "exactly 2.31.0 on every machine, forever, until we choose to change it."

> **The mindset shift:** stop thinking "I added a library." Start thinking "I added a *range*, the tool *picked* exact versions to satisfy it, and that pick can change unless I pin it down." Once you see the gap between *what you asked for* and *what you got*, dependency bugs stop being magic.

---

## Prerequisites

- **Required:** You've written a program that used at least one third-party library (`pip install`, `npm install`, `go get`, or similar).
- **Required:** You know what a config file is and have edited one (`package.json`, `requirements.txt`, `go.mod`).
- **Helpful:** You've hit a "works on my machine" problem at least once.
- **Helpful:** You've read [01 — Build Fundamentals](../01-build-fundamentals/junior.md) and know what a library is at the linking level.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Dependency** | Code your project needs that someone else wrote and published. |
| **Direct dependency** | One *you* asked for explicitly. |
| **Transitive dependency** | One pulled in *because* a dependency of yours needs it. You never named it. |
| **Manifest** | The file where you declare what you want (`package.json`, `go.mod`, `Cargo.toml`). |
| **Version** | A label like `2.31.0` that identifies one published release. |
| **Semver** | Semantic Versioning — the `MAJOR.MINOR.PATCH` convention for what a version *promises*. |
| **Range / constraint** | "Any version satisfying this rule" — e.g. `^2.0.0` means "2.x, not 3.x". |
| **Resolution** | The tool's job of picking actual versions that satisfy all your constraints. |
| **Lock file** | A generated file recording the *exact* versions resolution picked (`package-lock.json`, `go.sum`). |
| **Registry** | The server packages are published to and downloaded from (npm registry, PyPI, crates.io). |
| **Pin** | To fix a dependency to one exact version, removing the range. |

---

## Core Concept 1 — What a Dependency Actually Is

A dependency is just **someone else's code that your code calls**. Instead of writing your own JSON parser, you declare that you depend on one, and a tool downloads it and makes it available to your build.

You declare dependencies in a **manifest** file. Here is one for each of three ecosystems — read them as the same idea three ways:

```jsonc
// package.json  (JavaScript / npm)
{
  "dependencies": {
    "express": "^4.18.0",
    "lodash": "^4.17.21"
  }
}
```

```toml
# Cargo.toml  (Rust)
[dependencies]
serde = "1.0"
tokio = "1.35"
```

```go
// go.mod  (Go)
module example.com/myapp

go 1.22

require (
    github.com/gin-gonic/gin v1.9.1
    golang.org/x/text v0.14.0
)
```

In every case you are saying: *"My project needs these libraries. Go get them."* You run one command — `npm install`, `cargo build`, `go mod download` — and the tool fetches them from a **registry** (a public server of packages) and puts them where your build can find them.

The thing to notice: **you wrote names and version rules, not actual code.** The dependency's real code lives elsewhere (in `node_modules/`, in Cargo's cache, in Go's module cache). Your manifest is a shopping list, not the groceries.

> **Key insight:** A dependency is a *relationship*, not a file in your repo. You declare the relationship; a tool fulfils it by downloading code. Most dependency confusion comes from forgetting that "what I declared" and "what got downloaded" are two different things connected by a step called *resolution*.

---

## Core Concept 2 — Semantic Versioning: the Version Is a Promise

A version like `2.31.0` is not a random label. Under **Semantic Versioning (semver)** — which most ecosystems follow — it has three numbers, and each carries a *promise* about compatibility:

```
   2  .  31  .  0
MAJOR    MINOR   PATCH
```

- **PATCH** (`2.31.0` → `2.31.1`): bug fixes only. *Nothing you depend on changes.* Safe to take blindly.
- **MINOR** (`2.31.0` → `2.32.0`): new features added, but **backwards-compatible**. Old code keeps working; there's just *more* you could use. Safe to take.
- **MAJOR** (`2.31.0` → `3.0.0`): **breaking change**. Something was removed or changed in a way that can break your code. You must read the changelog and possibly fix things.

The whole point: the version number *tells you in advance how risky an upgrade is*. Going from `2.31.0` to `2.31.9` should never break you. Going to `3.0.0` *might*. This is a contract between the library author and you.

```
1.4.2 → 1.4.3   patch  — bug fix,        take it, relax
1.4.2 → 1.7.0   minor  — new features,   take it, your code still works
1.4.2 → 2.0.0   major  — breaking,       read the changelog before upgrading
```

Two refinements you'll meet immediately:

- **`0.x.y` is special.** Before `1.0.0`, the library is declaring "I'm not stable yet." During `0.x`, a *minor* bump (`0.3.0` → `0.4.0`) is allowed to break you. Treat pre-1.0 libraries as if every bump might break.
- **Pre-release tags:** `2.0.0-rc.1`, `1.5.0-beta`. The `-something` suffix means "not a final release." Tools won't pick these unless you ask.

> **Key insight:** Semver is a *promise*, and promises get broken. A library can tag a release `2.4.1` (a "patch") and accidentally break you. Semver tells you the *intended* risk, which is enormously useful — but it's a convention enforced by humans, not a law enforced by the computer. The senior pages dig into how often it's violated and what to do about it.

---

## Core Concept 3 — Why Version Ranges Exist

When you write a dependency, you usually don't write one exact version. You write a **range**:

```json
"express": "^4.18.0"
```

That `^` (caret) means: *"any version `>= 4.18.0` but `< 5.0.0`."* In other words, "any 4.x from 4.18.0 up, but not 5.0.0, because 5.0.0 is a major bump that might break me."

Why not just pin the exact version? Because of **patches and minor improvements you actually want**. If `express` ships `4.18.3` with a security fix, a range lets you pick it up automatically next time you install, *without* editing your manifest. The range says "give me the safe improvements within the 4.x line."

The common range operators (npm syntax shown; others are similar):

```
^4.18.0    caret  — 4.18.0 up to (not including) 5.0.0   "compatible: same MAJOR"
~4.18.0    tilde  — 4.18.0 up to (not including) 4.19.0  "only PATCH updates"
>=4.18.0   at least 4.18.0, no upper bound                "anything newer, risky"
4.18.0     exact  — only 4.18.0                            "pinned"
*          any version at all                              "do not do this"
```

The most common choice, `^`, is a direct bet on semver: *"I trust that any 4.x is compatible, because semver promises minor and patch bumps don't break me."* When semver holds, this is great — you get fixes for free. When semver is *violated* (a `4.x` release that breaks you), this is exactly how "it worked yesterday" happens: a new compatible-looking version got picked and it wasn't actually compatible.

> **The tension in one line:** a *range* gives you free improvements but introduces uncertainty about *which exact version you'll get*. A *pin* gives you certainty but no free improvements. Dependency management is largely about managing this trade-off — and the lock file (next) is how you get *both*.

---

## Core Concept 4 — Transitive Dependencies: the Iceberg

You declared maybe ten dependencies. Open `node_modules/` and you'll find *eight hundred* packages. Where did they come from?

Your dependencies have dependencies. Those have dependencies. The whole thing is a **tree** (really a graph):

```
your-app
├── express            (you asked for this)
│   ├── body-parser    (express asked for this — transitive)
│   │   └── bytes      (body-parser asked for this — transitive)
│   └── cookie         (transitive)
└── lodash             (you asked for this)
```

- **Direct dependencies:** the ones in *your* manifest. You chose them.
- **Transitive dependencies:** everything else — pulled in because something you depend on needs them. You never named them and may not know they exist.

This is why a small project can have hundreds of packages. It's also why a bug in some package you've never heard of can break *your* build: it's down in the tree somewhere, supporting something you do use.

You can see the tree:

```bash
npm ls                 # show the dependency tree
npm ls bytes           # who pulled in `bytes`? (find the path to a transitive dep)
go mod graph           # Go: print the full dependency graph
go mod why golang.org/x/text   # Go: why is this dependency here?
```

> **Key insight:** You are responsible for code you didn't write and didn't choose. The transitive tree is most of your real dependency surface — most of the code that ships in your product, most of the bytes, most of the security risk. "I only have 10 dependencies" is almost always false; you have 10 *direct* ones and hundreds underneath. Tools to *see* the tree (`npm ls`, `go mod graph`) are how you stop being surprised by it.

---

## Core Concept 5 — The Lock File and Why You Commit It

Here's the problem we keep circling. Your manifest says `^4.18.0` — a *range*. So:

- On your laptop in March, `npm install` resolves that to `express@4.18.2` (newest at the time).
- On the CI server in June, `npm install` resolves the *same range* to `express@4.18.5` (newer release came out).

Same manifest, different actual versions. Multiply across hundreds of transitive deps and "works on my machine" is inevitable.

The fix is a **lock file**. When you install, the tool writes down the *exact* version it picked for *every* package — direct and transitive:

```jsonc
// package-lock.json  (generated, simplified)
{
  "packages": {
    "node_modules/express": {
      "version": "4.18.2",        // the EXACT version, not the range
      "resolved": "https://registry.npmjs.org/express/-/express-4.18.2.tgz",
      "integrity": "sha512-5/PsL6iGPdfQ/lKM1UuielYgv3BUoJfz1aUwU9vHZ+J7gyvwdQXFEBIEIaxeGf0GIcreATNyBExtalisDbuMqQ=="
    }
  }
}
```

The lock file records two crucial things per package:

1. **The exact version** (`4.18.2`) — so the next install gets *that*, not "newest 4.x".
2. **An integrity hash** — a fingerprint of the package's contents, so the tool can verify it downloaded *exactly* the bytes it expected and not something tampered with.

The two files now play different roles:

```
package.json  (manifest)   "I want SOME 4.x"          ← you edit this
package-lock.json (lock)   "we resolved to 4.18.2"    ← the tool writes this
```

**You commit the lock file to git.** This is the part beginners get wrong. The lock file is what makes everyone's install identical: with it committed, your laptop and the CI server both install *4.18.2 exactly*, because the lock file pins it. Without it, both re-resolve the range and can diverge.

The commands respect this:

```bash
npm install        # may UPDATE the lock file (re-resolve within ranges)
npm ci             # install EXACTLY what the lock file says — fails if it's out of sync
go mod tidy        # update go.mod/go.sum to match what the code actually imports
```

`npm ci` ("clean install") is what CI servers use: it refuses to drift, installing precisely the locked versions. That's the whole point — reproducibility.

> **Key insight:** The manifest holds *intent* (ranges — what you'll accept). The lock file holds the *resolved reality* (exact versions — what you got). Committing the lock file is how you make the build reproducible without giving up the convenience of ranges: you still write `^4.18.0`, but everyone gets the *same* resolved `4.18.2` until you deliberately re-resolve. Not committing it is the single most common cause of "works on my machine" in dependency-heavy projects.

---

## Real-World Examples

**1. The CI failure that wasn't your code.** You push a one-line change. CI fails on a test that has nothing to do with your change. The cause: the project doesn't commit its lock file, so CI re-resolved a `^` range and pulled a newer transitive dependency with a subtle behaviour change. Your code was fine. The fix is structural: commit the lock file and use `npm ci` in CI, so the dependency set is frozen.

**2. `npm install` "randomly" changed 40 files.** A teammate ran `npm install` to add one package, and the diff touched `package-lock.json` in 40 places. That's not corruption — `install` re-resolved ranges and several transitive deps had newer compatible releases, so their pinned versions updated. This is exactly why the lock file is committed: those 40 changes are now *reviewable* and *shared*, instead of silently different on every machine.

**3. The `requests` upgrade that broke prod.** A Python project used `requests>=2.0` (an open-ended range, no upper bound). A new `requests` release changed a default and broke an edge case. Because the range had no upper bound and the project didn't pin via a lock file (`requirements.txt` without hashes), production picked up the new version on the next deploy. The lesson: open-ended ranges plus no lock = you're running whatever shipped last night.

---

## Mental Models

- **Manifest is a shopping list; the registry is the store; resolution is the shopper.** You write "some 4.x express." A shopper (the tool) goes to the store (registry) and picks an actual box off the shelf. The lock file is the *receipt* — exactly which boxes were bought — so anyone can buy the identical cart later.

- **Semver is a weather forecast, not a guarantee.** "Patch = no rain" is usually right and very useful for planning, but occasionally it pours. Trust it to *plan* upgrades; don't bet your production uptime that it's never wrong.

- **The dependency tree is an iceberg.** Your direct deps are the tip above water; the transitive deps are the vast mass below. You ship the whole iceberg, so you'd better be able to *see* below the waterline (`npm ls`, `go mod graph`).

- **Range vs pin is "fresh vs frozen."** A range gives you fresh improvements but unpredictable contents. A pin (via lock file) freezes the contents for predictability. The lock file lets you write ranges yet ship frozen — fresh on demand, frozen by default.

---

## Common Mistakes

1. **Not committing the lock file.** The #1 cause of "works on my machine" in dependency-heavy projects. Without it, every machine re-resolves ranges independently. Commit `package-lock.json` / `Cargo.lock` / `go.sum`.

2. **Adding the lock file to `.gitignore`.** Same mistake, dressed up. People assume generated files shouldn't be committed. Lock files are the exception — they're how you share resolved versions.

3. **Using `npm install` in CI.** It can update the lock file and re-resolve. Use `npm ci` (or `go mod download` against a committed `go.sum`) so CI installs *exactly* the locked versions and fails loudly on drift.

4. **Open-ended ranges (`>=2.0`, `*`).** No upper bound means "any future version, including the next breaking one." You'll pick up a major version that breaks you. Prefer `^` (caps at the next major) or pin.

5. **Treating a version bump as cosmetic.** `2.31.0` → `3.0.0` is a *major* bump: read the changelog. Beginners "just upgrade" and are surprised when it breaks — that's exactly what the major number was warning about.

6. **Forgetting transitive deps exist.** "I only depend on 5 things" — no, you depend on 5 things and the 300 things *they* depend on. Security and bugs live in the transitive tree too.

---

## Test Yourself

1. What's the difference between a *direct* and a *transitive* dependency?
2. In `2.31.4`, which number changes for a bug fix? Which one warns you that the upgrade might break your code?
3. What does `^4.18.0` allow, and what does it forbid?
4. Your manifest says `^4.18.0` and hasn't changed in months, yet two teammates have different versions of `express` installed. How is that possible, and what one file fixes it?
5. Why do you *commit* the lock file to git instead of ignoring it like other generated files?
6. What's the difference between `npm install` and `npm ci`, and which belongs in CI?

<details>
<summary>Answers</summary>

1. A **direct** dependency is one you declared in your own manifest (you chose it). A **transitive** dependency is one pulled in because a dependency of yours needs it — you never named it.
2. A bug fix bumps the **PATCH** number (`2.31.4` → `2.31.5`). The **MAJOR** number (`2.x` → `3.0.0`) warns that the upgrade may break your code.
3. `^4.18.0` allows any version `>= 4.18.0` and `< 5.0.0` (any 4.x from 4.18.0 up). It forbids `5.0.0` and above (the next major) and anything below `4.18.0`.
4. They installed at different times and the tool re-resolved the `^` range to different newest-4.x versions. Committing the **lock file** (and installing from it) makes everyone get the same exact resolved version.
5. Because the lock file records the *exact resolved versions* (and integrity hashes). Committing it means every machine installs identical versions — that reproducibility is the whole point; ignoring it brings back "works on my machine."
6. `npm install` may re-resolve ranges and update the lock file; `npm ci` installs *exactly* the locked versions and fails if the lock is out of sync. `npm ci` belongs in CI for reproducibility.

</details>

---

## Cheat Sheet

```
THE TWO FILES
  manifest  (package.json / go.mod / Cargo.toml)  → INTENT: ranges you'll accept
  lock      (package-lock.json / go.sum / Cargo.lock) → REALITY: exact resolved versions
  COMMIT THE LOCK FILE.

SEMVER  MAJOR.MINOR.PATCH   e.g. 2.31.4
  PATCH  bug fix             safe        2.31.4 → 2.31.5
  MINOR  new feature, compat safe        2.31.4 → 2.32.0
  MAJOR  breaking change     read changelog  2.x → 3.0.0
  0.x.y  unstable — any bump may break

RANGES (npm-style)
  ^4.18.0   >=4.18.0 <5.0.0   same MAJOR  (most common)
  ~4.18.0   >=4.18.0 <4.19.0  PATCH only
  >=4.18.0  no upper bound     RISKY
  4.18.0    exact (pinned)
  *         any                AVOID

DEPENDENCY TYPES
  direct      in YOUR manifest, you chose it
  transitive  pulled in by a dependency; you didn't

SEE THE TREE
  npm ls            / npm ls <pkg>
  go mod graph      / go mod why <pkg>

INSTALL COMMANDS
  npm install   may update lock (dev)
  npm ci        exact from lock, fail on drift (CI)
  go mod tidy   sync go.mod/go.sum to imports
```

---

## Summary

- A **dependency** is someone else's published code your project uses. You declare it in a **manifest**; a tool fetches it from a **registry**.
- **Semver** (`MAJOR.MINOR.PATCH`) encodes a *promise*: patch = bug fix (safe), minor = new features (compatible), major = breaking (read the changelog). It's a convention enforced by humans, so it's broken occasionally.
- You usually declare a **range** (`^4.18.0`) not an exact version, to pick up safe fixes automatically. The trade-off: a range makes *which exact version you get* uncertain.
- Most of your real dependencies are **transitive** — pulled in by your dependencies. Hundreds of packages from a handful of direct ones. Use `npm ls` / `go mod graph` to see the iceberg.
- The **lock file** records the exact resolved version (and an integrity hash) for every package. **Commit it.** It's what makes installs reproducible across machines while still letting you write ranges — the cure for "it worked yesterday."

You now have the working model: *intent* (manifest ranges) is resolved into *reality* (locked exact versions), and committing that reality is what makes builds reproducible. The [middle.md](middle.md) page formalizes *how* resolution actually picks those versions — and why Go does it deliberately differently from npm.

---

## Further Reading

- [Semantic Versioning 2.0.0](https://semver.org/) — the spec itself; short, readable, and the source of every rule above.
- [npm — About semantic versioning](https://docs.npmjs.com/about-semantic-versioning) — with an interactive range calculator.
- [Go Modules Reference — Versions](https://go.dev/ref/mod#versions) — how Go interprets versions and `go.mod`.
- The [middle.md](middle.md) of this topic — how resolution actually works, conflicts, and MVS vs newest-compatible.

---

## Related Topics

- [01 — Build Fundamentals](../01-build-fundamentals/junior.md) — what a *library* is at the linking level, before versions enter the picture.
- [04 — Per-Language Tools](../04-per-language-tools/junior.md) — how `go`, `npm`, and `cargo` wrap fetching and resolution.
- [09 — Reproducible Builds](../09-reproducible-builds/junior.md) — the lock file is one piece of making builds bit-identical everywhere.
- [Release Engineering › Versioning and Semver](../../release-engineering/01-versioning-and-semver/) — versioning from the *publisher's* side: how *you* version what *you* release.
