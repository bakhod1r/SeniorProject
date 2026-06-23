# Per-Language Tools — Junior Level

> **Roadmap:** [Build Systems](../README.md) → Per-Language Tools
> *Every modern language ships its own build tool — `go`, `cargo`, `npm`, `pip`, `gradle`. They look different, but they all answer the same two questions: which libraries does my code need, and how do I turn my code plus those libraries into something that runs?*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — One Language, One Main Tool](#core-concept-1--one-language-one-main-tool)
5. [Core Concept 2 — Manifest vs Lockfile](#core-concept-2--manifest-vs-lockfile)
6. [Core Concept 3 — Walking Through `go build`](#core-concept-3--walking-through-go-build)
7. [Core Concept 4 — Walking Through `cargo build`](#core-concept-4--walking-through-cargo-build)
8. [Core Concept 5 — Walking Through `npm install` (and `pip install`)](#core-concept-5--walking-through-npm-install-and-pip-install)
9. [Core Concept 6 — The Build Cache Exists](#core-concept-6--the-build-cache-exists)
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

> Focus: **What is a per-language build tool, and why does every language have one?**

In [01 — Build Fundamentals](../01-build-fundamentals/junior.md) you learned the raw pipeline: compile, link, produce a binary. But nobody runs `gcc -c` by hand on a real project. Instead you type `go build`, `cargo run`, `npm install`, `gradle build` — and a single tool does the compiling, the linking, *and* the part the raw pipeline never mentioned: **fetching the libraries your code depends on.**

That is the whole job of a per-language build tool. It is the thing you actually use every day. And here is the secret that makes all of them easier to learn at once: **they are all solving the same problem.** Read your project's list of dependencies, download them, build everything in the right order, cache the results so the next build is fast, and produce an artifact (a binary, a `.jar`, a package). Go calls it `go`, Rust calls it `cargo`, JavaScript calls it `npm`, but the *shape* is identical.

This page teaches you that shape. Once you see it, switching from `cargo` to `npm` to `go mod` stops feeling like learning three tools and starts feeling like learning three dialects of one tool.

> **The mindset shift:** stop memorizing per-tool commands as trivia. Start asking, for any new tool: *Where's the manifest? Where's the lockfile? Where does it cache? What command builds?* Four questions, and you understand a tool you've never used.

---

## Prerequisites

- **Required:** You've read [01 — Build Fundamentals · junior](../01-build-fundamentals/junior.md) — you know what "compile," "link," and "artifact" mean.
- **Required:** You can run commands in a terminal and edit a text file.
- **Helpful:** You've typed `npm install` or `pip install` at least once, even if you didn't know what happened.
- **Helpful:** You've seen a `package.json`, `go.mod`, or `requirements.txt` and wondered what it was for.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Dependency** | A library your code uses but didn't write (e.g. a JSON parser). |
| **Manifest** | The file *you* edit that lists the dependencies you want (`go.mod`, `Cargo.toml`, `package.json`). |
| **Lockfile** | The file the *tool* generates recording the exact versions it actually installed (`go.sum`, `Cargo.lock`, `package-lock.json`). |
| **Registry** | The online warehouse the tool downloads libraries from (crates.io, npm registry, PyPI). |
| **Transitive dependency** | A dependency *of* your dependency. You ask for A; A needs B; B is transitive. |
| **Version** | Which release of a library, like `1.4.2`. Usually written `major.minor.patch` (semver). |
| **Build cache** | A folder where the tool stores already-compiled results so it doesn't redo work. |
| **Artifact** | What the build produces — a binary, a `.jar`, a `.whl` package. |
| **Reproducible** | Two people running the same build get the *exact same* result. |

---

## Core Concept 1 — One Language, One Main Tool

Each mainstream language has converged on **one official (or de-facto) build-and-dependency tool**. You learn it once; it's the front door to the whole ecosystem.

| Language | Main tool | Manifest you edit | Lockfile it writes | Registry |
|---|---|---|---|---|
| **Go** | `go` (`go build`, `go mod`) | `go.mod` | `go.sum` | the module proxy (proxy.golang.org) |
| **Rust** | `cargo` | `Cargo.toml` | `Cargo.lock` | crates.io |
| **Java/JVM** | `gradle` or `maven` | `build.gradle` / `pom.xml` | (lockfile optional) | Maven Central |
| **Python** | `pip`, `poetry`, or `uv` | `requirements.txt` / `pyproject.toml` | `poetry.lock` / `uv.lock` | PyPI |
| **JS/TS** | `npm`, `pnpm`, `yarn`, or `bun` | `package.json` | `package-lock.json` / `pnpm-lock.yaml` | the npm registry |

Notice two things. **Go and Rust each have exactly one tool** — there's no debate, everyone uses `go` and `cargo`. **Java, Python, and JavaScript each have several competing tools** — this is a sign of history and pain, and you'll feel that pain later. For now, the takeaway is the column headers: *every* tool has a manifest, *most* have a lockfile, *all* talk to a registry.

> **Key insight:** the tool *is* the ecosystem's front door. When someone says "add a dependency in Rust," they mean "edit `Cargo.toml` (or run `cargo add`) and let `cargo` do the rest." You rarely touch the compiler directly anymore — the per-language tool drives it for you.

---

## Core Concept 2 — Manifest vs Lockfile

This is the single most important distinction on this page, and most beginners blur the two. They are different files with different jobs.

**The manifest is what you *want*.** You write it. It says, roughly: *"I depend on the `requests` library, version 2-point-something."* It expresses *intent*, often loosely (a range of acceptable versions).

**The lockfile is what you *got*.** The tool writes it. It records: *"I resolved that to exactly `requests` 2.31.0, plus its dependency `urllib3` 2.1.0, plus `certifi` 2023.11.17 — and here are their checksums."* It captures the *exact* outcome, pinned to the precise version and often the cryptographic hash.

Here's the same dependency in both files for Rust:

```toml
# Cargo.toml  — the MANIFEST (you wrote this)
[dependencies]
serde = "1.0"          # "any 1.x version is fine"
```

```toml
# Cargo.lock  — the LOCKFILE (cargo generated this)
[[package]]
name = "serde"
version = "1.0.197"     # the EXACT version cargo picked
checksum = "3fb1c873e1b9..."   # and its hash
```

The manifest says "any 1.x." The lockfile says "specifically 1.0.197, and here's its fingerprint so we can prove it's the same file every time."

**Why commit the lockfile to git?** Because it makes the build *reproducible across people and machines*. Without it, you write "any 1.x," your teammate runs the build a week later, version 1.0.198 has come out, they get a *different* build than you — and now a bug appears only on their machine. Commit the lockfile and everyone gets byte-for-byte the same dependencies.

```
manifest  (go.mod / Cargo.toml / package.json)   → intent, loose, you edit it      → COMMIT
lockfile  (go.sum / Cargo.lock / package-lock)   → exact result, tool writes it     → COMMIT
```

> **Key insight:** commit *both*. The manifest declares what you want; the lockfile freezes what you got so the next person — including future-you on a fresh laptop — gets exactly the same thing. The rule for applications is simple: **always commit the lockfile.** (Libraries are a nuance you'll meet at the middle level.)

---

## Core Concept 3 — Walking Through `go build`

Let's watch one tool do the whole job. Go is the cleanest to start with because its tool is minimal and its output is a single file.

Create a tiny module:

```bash
mkdir hello && cd hello
go mod init example.com/hello     # creates go.mod — the manifest
```

`go.mod` now exists and is almost empty:

```
module example.com/hello

go 1.22
```

Write `main.go` that uses an external library:

```go
package main

import (
	"fmt"
	"github.com/google/uuid"     // a dependency we don't have yet
)

func main() {
	fmt.Println(uuid.New().String())
}
```

Now fetch the dependency and build:

```bash
go mod tidy        # reads imports, adds them to go.mod, downloads them, writes go.sum
go build           # compiles everything → produces ./hello (a binary)
./hello            # prints a random UUID
```

Look at what `go mod tidy` did. It scanned your `import` lines, figured out you need `github.com/google/uuid`, added it to `go.mod` (manifest), recorded its exact version and checksum in `go.sum` (lockfile), and downloaded it. Then `go build` compiled your code *and* the library and linked them into one binary.

```
go mod tidy  →  reads imports → updates go.mod + go.sum → downloads deps
go build     →  compiles your code + deps → links → ./hello
go test      →  builds, then runs your tests
go run .     →  build + run in one step (no binary left behind)
```

That's the entire core loop. `go.mod` is the manifest, `go.sum` is the lockfile, and the binary is the artifact.

---

## Core Concept 4 — Walking Through `cargo build`

Rust's `cargo` is widely considered the best-designed tool in this list. The shape is identical to Go's — just richer.

```bash
cargo new hello      # scaffolds a project: Cargo.toml + src/main.rs + git repo
cd hello
```

`cargo new` already wrote the manifest, `Cargo.toml`:

```toml
[package]
name = "hello"
version = "0.1.0"
edition = "2021"

[dependencies]
```

Add a dependency — you can edit the file, but `cargo` will do it for you:

```bash
cargo add rand       # edits Cargo.toml AND resolves + records in Cargo.lock
```

Use it in `src/main.rs`:

```rust
fn main() {
    let n: u8 = rand::random();
    println!("random byte: {n}");
}
```

Build and run:

```bash
cargo build          # downloads rand + its deps, compiles all → target/debug/hello
cargo run            # build (if needed) + run
cargo test           # build + run tests
cargo build --release   # optimized build → target/release/hello (slower compile, faster binary)
```

After the first `cargo build`, look around: `Cargo.lock` now exists (the lockfile, listing exact versions), and a `target/` folder appeared (the build output *and* the build cache — more in Concept 6). Same four questions, same four answers: manifest `Cargo.toml`, lockfile `Cargo.lock`, cache `target/`, build `cargo build`.

> **Note the `cargo add` convenience:** rather than hand-editing the manifest and hoping you got the version syntax right, `cargo add rand` edits `Cargo.toml` *and* updates the lockfile in one step. Go has the equivalent with `go get`, and npm with `npm install <pkg>`. Prefer these over hand-editing — they keep manifest and lockfile in sync.

---

## Core Concept 5 — Walking Through `npm install` (and `pip install`)

JavaScript's `npm` is the tool you're most likely to have already touched. Same shape, one big visible difference: it dumps everything into a `node_modules/` folder.

```bash
mkdir hello && cd hello
npm init -y            # creates package.json — the manifest
npm install dayjs      # downloads dayjs + deps → node_modules/ ; writes package-lock.json
```

`package.json` (manifest) now lists `dayjs`. `package-lock.json` (lockfile) records the exact resolved versions of `dayjs` *and everything it depends on*. The downloaded code lives in `node_modules/`.

```js
// index.js
const dayjs = require("dayjs");
console.log(dayjs().format("YYYY-MM-DD"));
```

```bash
node index.js          # JS is interpreted — no separate "build" step here
```

Note: plain JavaScript is interpreted (recall the spectrum from [01 · junior](../01-build-fundamentals/junior.md)), so there's often no compile step — `npm install` is about *fetching dependencies*, and `node` just runs your source. The "build" appears later when you add TypeScript or a bundler.

**Python's `pip` is the same idea**, with a folder called a *virtual environment* instead of `node_modules`:

```bash
python -m venv .venv          # create an isolated environment
source .venv/bin/activate     # use it (Windows: .venv\Scripts\activate)
pip install requests          # download requests + deps into .venv
pip freeze > requirements.txt # write down exactly what got installed (a poor-man's lockfile)
```

> **Key insight — golden rule for any tool:** find the manifest, find the lockfile, find where dependencies land (`node_modules/`, `.venv/`, Go's module cache, Rust's `target/`), and find the build command. `pip`'s lockfile story is famously weak — `requirements.txt` is half-manifest, half-lockfile — which is exactly why `poetry` and `uv` exist. You'll dig into *why Python packaging is hard* at the middle level.

---

## Core Concept 6 — The Build Cache Exists

The first time you run `cargo build` it might take 90 seconds. The second time, *with no code change*, it takes a fraction of a second. The tool didn't recompile anything — it **cached** the results.

Every tool here keeps a cache so it never does the same work twice:

| Tool | What's cached | Where |
|---|---|---|
| **Go** | compiled packages + downloaded modules | `$GOPATH/pkg/mod` (downloads) + `~/.cache/go-build` (compiled) |
| **Cargo** | compiled crates + your code | the project's `target/` directory |
| **npm/pnpm** | downloaded package tarballs | `~/.npm` (npm) / a global content store (pnpm) |
| **pip** | downloaded wheels | `~/.cache/pip` |
| **Gradle** | compiled classes + task outputs | `~/.gradle` + the build cache |

The principle is the one from [02 — Dependency Graphs](../02-dependency-graphs/junior.md): if the inputs haven't changed, reuse the old output. Change one file and the tool recompiles only what depends on it.

You'll occasionally need to clear a cache when something seems wrong:

```bash
go clean -cache        # wipe Go's compiled-package cache
cargo clean            # delete target/ entirely
npm cache clean --force
```

> **Junior-level warning:** clearing the cache is the "turn it off and on again" of builds. It *sometimes* fixes a genuinely corrupted cache — but if you find yourself doing it routinely to make builds work, something deeper is wrong (often a missing or stale lockfile). The cache is supposed to be invisible. Caching done right is a whole topic: [07 — Build Caching](../07-build-caching/senior.md).

---

## Real-World Examples

**1. The teammate who "got a different version."** You write `"react": "^18.2.0"` in `package.json` and commit it — but you *don't* commit `package-lock.json`. A month later a new hire clones the repo, runs `npm install`, and gets React 18.3.1 (released since you started). A subtle rendering bug appears only on their machine. The fix was never code: commit the lockfile so everyone resolves to the identical version.

**2. The Go binary that just works.** A team builds a service with `go build` and `scp`s the single binary to a server with nothing installed. It runs. No `node_modules`, no virtualenv, no runtime to install — Go statically links everything into the one artifact (recall static vs dynamic from [01 · junior](../01-build-fundamentals/junior.md)). This is a *build-tool* property as much as a language one.

**3. The 40-minute first build, the 3-second second build.** A new engineer clones a large Rust project and `cargo build` churns for 40 minutes compiling hundreds of crates. They panic. Then they change one line and rebuild — 3 seconds. The first build populated `target/` (the cache); every build after only redoes the part that changed. The slow build was a one-time cost, not the steady state.

---

## Mental Models

- **The tool is a vending machine for libraries.** You put in a request (manifest), it fetches the exact items (lockfile), and assembles your order (build). The registry is the warehouse it restocks from.

- **Manifest is the shopping list; lockfile is the receipt.** The list says "some milk." The receipt says "Brand X, 2L, $3.40, bought Tuesday." Hand someone your receipt and they buy the *identical* groceries. That's why you commit the lockfile.

- **All five tools are dialects of one language.** Manifest → resolve → fetch → build in order → cache → artifact. `cargo`, `go`, `npm`, `pip`, `gradle` differ in spelling and rigor, not in grammar. Learn the grammar once.

- **The cache is a memo pad, not a source of truth.** It remembers work it already did. If you delete it, nothing is lost — the tool just has to redo the work. Treat it as disposable; never treat it as part of your project.

---

## Common Mistakes

1. **Not committing the lockfile.** The single most common cause of "works on my machine" in modern projects. The manifest's loose ranges mean two installs at two times can differ; the lockfile is what pins them. Commit it.

2. **Committing `node_modules/`, `target/`, or `.venv/`.** These are *downloaded/built outputs*, not source. They're huge, machine-specific, and regenerable from the lockfile. Add them to `.gitignore`. (Vendoring is a deliberate exception you'll learn later — this is about doing it *by accident*.)

3. **Confusing the manifest and the lockfile.** Editing the lockfile by hand to "change a version" — wrong. You change the *manifest* (intent) and let the tool *re-resolve* the lockfile. The lockfile is generated, not authored.

4. **Hand-editing the manifest and forgetting to re-resolve.** Adding a line to `package.json` but never running `npm install` means the lockfile and `node_modules/` are now out of sync with your stated intent. Use `cargo add` / `go get` / `npm install <pkg>` to keep them aligned.

5. **Clearing the cache as a reflex.** `cargo clean` / `go clean -cache` occasionally helps, but routinely needing it hides a real problem. The cache is meant to be invisible and correct.

6. **Assuming "it installed" means "it'll install for everyone."** A dependency that's on your machine's cache but not pinned in the lockfile may resolve differently — or fail — on a clean machine or in CI. Test on a fresh checkout.

---

## Test Yourself

1. What is the difference between a manifest and a lockfile? Give the file names for any two languages.
2. Why should you commit the lockfile to version control? What can go wrong if you don't?
3. Name the four questions that let you understand any new build tool quickly.
4. After `cargo new hello`, which file is the manifest and where does the build output go?
5. Your `cargo build` took 50 seconds the first time and 2 seconds the second time with no code change. What happened?
6. Should you commit `node_modules/` to git? Why or why not?

<details>
<summary>Answers</summary>

1. The **manifest** is what you *want* — the dependencies you declare, often as loose version ranges (you edit it). The **lockfile** is what you *got* — the exact resolved versions plus checksums (the tool writes it). Examples: Rust `Cargo.toml` / `Cargo.lock`; npm `package.json` / `package-lock.json`; Go `go.mod` / `go.sum`.
2. Committing the lockfile makes the build **reproducible**: everyone resolves to the identical versions. Without it, the manifest's loose ranges let two people install different versions at different times, producing "works on my machine" bugs.
3. Where's the **manifest**? Where's the **lockfile**? Where does it **cache** (and put outputs)? What's the **build command**?
4. `Cargo.toml` is the manifest; build output (and cache) goes in the `target/` directory (`target/debug/hello` by default).
5. The first build populated the **build cache** (`target/`). The second build saw no inputs had changed, so it reused the cached compiled output instead of recompiling.
6. **No.** `node_modules/` is downloaded/built output, regenerable from the lockfile via `npm install`. It's huge, machine-specific, and belongs in `.gitignore`. Commit `package.json` and `package-lock.json` instead.

</details>

---

## Cheat Sheet

```
THE UNIVERSAL SHAPE (every tool does this)
  read manifest → resolve versions → fetch from registry → build in dep order → cache → artifact

FOUR QUESTIONS FOR ANY TOOL
  1. manifest file?   2. lockfile?   3. cache/output location?   4. build command?

THE FIVE TOOLS
  Go     :  go.mod   / go.sum            ; go mod tidy ; go build  ; cache: ~/.cache/go-build, GOPATH/pkg/mod
  Rust   :  Cargo.toml / Cargo.lock      ; cargo add  ; cargo build; cache/output: target/
  JVM    :  build.gradle / pom.xml       ; gradle build / mvn package ; cache: ~/.gradle, ~/.m2
  Python :  pyproject.toml / requirements.txt ; pip install / poetry / uv ; env: .venv ; cache: ~/.cache/pip
  JS/TS  :  package.json / *-lock.*      ; npm install ; deps land in node_modules/ ; cache: ~/.npm

MANIFEST vs LOCKFILE
  manifest = shopping list (intent, loose, you edit)        → COMMIT
  lockfile = receipt        (exact result, tool generates)  → COMMIT
  node_modules / target / .venv = groceries (output)        → .gitignore

CLEAR A CACHE (last resort, not a habit)
  go clean -cache    cargo clean    npm cache clean --force    rm -rf .venv
```

---

## Summary

- Every modern language ships **one main build-and-dependency tool** — `go`, `cargo`, `npm`/`pnpm`, `pip`/`poetry`/`uv`, `gradle`/`maven` — and you drive it instead of calling the compiler by hand.
- All of them solve the **same problem in the same shape**: read a manifest → resolve versions → fetch from a registry → build in dependency order → cache → produce an artifact. Learn the shape once.
- The **manifest** (`go.mod`, `Cargo.toml`, `package.json`) is what you *want* — your declared dependencies, often loose. The **lockfile** (`go.sum`, `Cargo.lock`, `package-lock.json`) is what you *got* — exact versions plus checksums.
- **Commit both.** The lockfile is what makes builds reproducible across people and machines; not committing it is the top cause of modern "works on my machine."
- Every tool keeps a **build cache** so it never redoes work; the second build is dramatically faster than the first. The cache is disposable — never commit it, never rely on clearing it.
- To understand a tool you've never used, ask four questions: where's the manifest, the lockfile, the cache, and the build command?

You now know the *shape*. The middle level opens the box: how each tool actually *resolves* versions (Go's MVS vs npm's newest-compatible), what transitive dependencies and semver ranges really mean, and the risks hiding in build scripts like `build.rs` and npm `postinstall`.

---

## Further Reading

- [Go Modules Reference](https://go.dev/ref/mod) — the authoritative description of `go.mod`, `go.sum`, and the module system.
- [The Cargo Book](https://doc.rust-lang.org/cargo/) — start with "Cargo Guide"; the clearest official build-tool docs of any language.
- [npm `package.json` docs](https://docs.npmjs.com/cli/v10/configuring-npm/package-json) — what each field means.
- [Python Packaging User Guide](https://packaging.python.org/) — the official map of the (complicated) Python tooling landscape.
- [middle.md](middle.md) — the next step: how these tools *resolve* versions, and the difference between Go's MVS and npm/cargo's newest-compatible approach.

---

## Related Topics

- [01 — Build Fundamentals](../01-build-fundamentals/junior.md) — the raw compile/link pipeline these tools wrap and hide.
- [02 — Dependency Graphs](../02-dependency-graphs/junior.md) — *why* the build cache works: only rebuild what changed.
- [06 — Dependency Management](../06-dependency-management/middle.md) — registries, versioning, and resolving dependencies in depth.
- [07 — Build Caching](../07-build-caching/senior.md) — how the cache actually decides what to reuse.
- [09 — Reproducible Builds](../09-reproducible-builds/senior.md) — why committing the lockfile is only the first step toward bit-identical builds.
