# Polyglot / Hermetic Builds — Junior Level

> **Roadmap:** [Build Systems](../README.md) → Polyglot / Hermetic Builds
> *One repository, four languages, a thousand engineers, and a single command that builds all of it the same way on every machine. That is not magic — it is hermeticity, and once you see the idea you cannot unsee how leaky every "normal" build actually is.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The Polyglot Monorepo Problem](#core-concept-1--the-polyglot-monorepo-problem)
5. [Core Concept 2 — What "Hermetic" Actually Means](#core-concept-2--what-hermetic-actually-means)
6. [Core Concept 3 — Bazel at a Glance](#core-concept-3--bazel-at-a-glance)
7. [Core Concept 4 — A Tiny BUILD File](#core-concept-4--a-tiny-build-file)
8. [Core Concept 5 — The Promise: Reproducible and Cacheable](#core-concept-5--the-promise-reproducible-and-cacheable)
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

> Focus: **When one build tool must build many languages the same way everywhere, what changes?**

You already know how a single language builds itself: `go build`, `cargo build`, `mvn package`, `npm run build`. Each one is a comfortable little world with its own tool, its own config file, its own cache. That works beautifully — right up until you have *one repository* containing a Go service, a Java service, a TypeScript frontend, and a pile of shared `.proto` files that all four depend on.

Now ask: how do you build *all of it* with *one command*, get the *same result* on a laptop and in CI, and not rebuild the parts that did not change? The per-language tools cannot answer this, because none of them knows the others exist, and — quietly — each of them reaches out to whatever happens to be installed on your machine.

That last part is the crack everything falls through. This page is about sealing the crack. The big idea is **hermeticity**: a build that depends *only* on inputs you explicitly declared — not on what version of Go you happen to have, not on a file in `/usr/lib`, not on the network. Declare everything; reach for nothing. When a build is hermetic, the same inputs *always* produce the same outputs, which is exactly what makes perfect caching and reproducibility possible.

> **The mindset shift:** stop thinking "the build uses the tools on my machine." Start thinking "the build declares the tools it needs, and the machine provides nothing else." That single shift is the entire difference between a build that works on your laptop and a build that works *identically everywhere, forever*.

---

## Prerequisites

- **Required:** You have built a project with a per-language tool — `go build`, `npm run build`, `mvn`, `cargo`, or similar. ([04 — Per-Language Tools](../04-per-language-tools/junior.md).)
- **Required:** You understand a build is a pipeline of steps that turn source into artifacts. ([01 — Build Fundamentals](../01-build-fundamentals/junior.md).)
- **Helpful:** You have hit "it works on my machine" at least once and felt the confusion.
- **Helpful:** You have worked in a repository with more than one language in it.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Monorepo** | A single repository holding many projects/services, often in several languages. |
| **Polyglot build** | One build tool that can build multiple languages, not one tool per language. |
| **Hermetic build** | A build that depends *only* on explicitly declared inputs — no PATH, no network, no surprises. |
| **Bazel** | Google's open-source polyglot, hermetic build tool. The flagship example. |
| **Buck2 / Pants** | Similar tools from Meta (Buck2) and the Python community (Pants). |
| **Target** | A buildable thing you name and ask Bazel to produce (a binary, a library, a test). |
| **BUILD file** | The file (literally named `BUILD`) that declares targets in a directory. |
| **Starlark** | The Python-like language BUILD files are written in. |
| **Rule** | A reusable recipe — `go_binary`, `java_library` — that knows how to build one kind of target. |
| **Action** | One concrete command the build runs (compile this, link that). |
| **Sandbox** | An isolated, locked-down directory an action runs in, seeing *only* its declared inputs. |
| **Artifact** | Any file the build produces. |
| **Cache** | A store of past build outputs, reused when the inputs are unchanged. |

---

## Core Concept 1 — The Polyglot Monorepo Problem

Picture a real repository:

```
myrepo/
  proto/          user.proto, order.proto      (shared message definitions)
  services/
    payments/     *.go                          (depends on generated proto code)
    accounts/     *.java                         (also depends on the proto)
  web/            *.ts, *.tsx                    (calls both services, uses proto types)
```

Every language here depends on `proto/`. The `.proto` files get *code-generated* into Go, Java, and TypeScript. So a single edit to `user.proto` should rebuild parts of all four worlds — and *nothing else*.

With per-language tools, this is a nightmare of glue:

- A shell script runs `protoc` to generate code, then `go build`, then `mvn`, then `npm run build`, in some hopefully-correct order.
- Nobody knows the real dependencies, so the script rebuilds *everything* every time to be safe. Slow.
- It builds differently on each laptop because each laptop has a different `protoc`, a different Go version, a different Node.
- CI passes; your machine fails; nobody can reproduce it.

The core problem: **no single tool understands the whole graph across languages, and every tool silently depends on the machine it runs on.** A polyglot build tool fixes the first half (one tool, one graph). Hermeticity fixes the second (declare everything, depend on nothing ambient).

> **Key insight:** The pain is not "we have many languages." The pain is "we have many *independent, machine-dependent* builds with no shared model of what depends on what." Solve those two things and the languages stop mattering.

---

## Core Concept 2 — What "Hermetic" Actually Means

*Hermetic* literally means "airtight." A hermetic build is sealed: nothing gets in except what you declared, and the result depends on nothing else.

Concretely, a hermetic build forbids four kinds of "reaching out":

1. **No ambient PATH.** It does not use *your* `go` or *your* `gcc`. It uses a **pinned toolchain** — an exact, declared compiler version that is the same for everyone.
2. **No undeclared file reads.** An action can only read files you listed as its inputs. If a test secretly reads `/etc/hosts` or a file you forgot to declare, the sandbox blocks it (or the build notices it changed and you find the leak).
3. **No network during the build.** Dependencies are fetched *before* the build, pinned by hash, then the build itself runs offline. A build that can `curl` mid-flight is not reproducible — the thing on the other end can change.
4. **No hidden state.** No reading the current time, the hostname, a random seed, or `$HOME` and baking it into the output.

Why does this matter so much? Because of one consequence:

> **Same declared inputs → same outputs, always.** If a build depends *only* on the files and tools you named, then two machines with the same named inputs *must* produce the same result. And if the inputs did not change, the output cannot have changed — so you can skip the work and reuse the old output. **Hermeticity is what makes caching and reproducibility actually safe**, instead of a hopeful guess.

A non-hermetic build is the opposite: it quietly reads the system, so "the inputs" silently include "whatever was on the machine that day." That is why the same `git` checkout builds differently in two places — the *declared* inputs matched, but the *real* inputs did not.

This is the deep contrast with the per-language tools in [topic 04](../04-per-language-tools/senior.md): `go build`, `npm`, and `mvn` are **not hermetic by default**. They happily use the Go on your PATH, the global npm cache, the Maven `~/.m2` folder, and the network. Convenient — and exactly why they drift.

---

## Core Concept 3 — Bazel at a Glance

**Bazel** is Google's open-source build tool, the most prominent polyglot, hermetic build system. (Meta's **Buck2** and the Python-focused **Pants** share the same core ideas.) You do not need to learn it deeply yet — just recognize its shape.

The shape:

- You describe your code as a graph of **targets**. A target is a named buildable thing: a library, a binary, a test.
- Each target is declared with a **rule** — a recipe like `go_binary` or `java_library` — that knows *how* to build that kind of thing.
- Crucially, every target declares its **inputs** (`srcs`, `deps`) explicitly. Nothing is implicit. If a target uses generated proto code, it must say so.
- Bazel reads all these declarations, builds a giant **dependency graph** of the whole repo (across every language), and figures out exactly what must run and in what order. (See [02 — Dependency Graphs](../02-dependency-graphs/senior.md).)
- It runs each step in a **sandbox** so the step can only touch its declared inputs — enforcing hermeticity rather than just hoping for it.

The headline benefit: **one tool, one command, the whole polyglot repo.**

```bash
bazel build //...        # build every target in the repository
bazel test  //...        # run every test
bazel build //web:app    # build just the web app target
```

That `//...` means "everything." One command, every language. Bazel figures out the order, runs only what is needed, and produces identical results everywhere.

---

## Core Concept 4 — A Tiny BUILD File

Targets are declared in files literally named `BUILD` (or `BUILD.bazel`), written in **Starlark** — a small, deliberately-limited dialect of Python. Here is a tiny one for a Go service that uses generated proto code:

```python
# services/payments/BUILD.bazel

load("@rules_go//go:def.bzl", "go_binary", "go_library")

go_library(
    name = "payments_lib",                 # the name of this target
    srcs = ["server.go", "handler.go"],    # EXACTLY which source files — explicit
    deps = [
        "//proto:user_go_proto",           # depends on generated Go from user.proto
        "@com_github_redis//:redis",       # a third-party library, pinned elsewhere
    ],
    importpath = "myrepo/services/payments",
)

go_binary(
    name = "payments",                     # build with: bazel build //services/payments:payments
    embed = [":payments_lib"],
)
```

Read it slowly, because the discipline is the whole point:

- **`srcs` lists files explicitly.** Not `*.go`-glob-everything-and-hope. Bazel knows the exact inputs, so it knows exactly when this target must rebuild.
- **`deps` lists dependencies explicitly.** This target depends on `//proto:user_go_proto` (generated code) and a third-party Redis library. If `user.proto` changes, Bazel knows *this* target is affected — and rebuilds *only* the affected targets.
- **`load(...)` imports the rule.** `go_binary`/`go_library` come from `rules_go`, an external rule set that teaches Bazel how to build Go.

Compare to a normal Go build, where `go build ./...` discovers files by scanning directories and pulls dependencies from `go.mod` and the network. Bazel makes you *write it all down*. That feels like bureaucracy — and it is the price of admission. In exchange, Bazel knows the *exact* graph and can cache and parallelize it perfectly.

> **Key insight:** The explicitness is not red tape for its own sake. A build can only cache and parallelize safely if it knows the *true, complete* inputs of every step. BUILD files are how you tell it the truth. The tedium *is* the contract.

---

## Core Concept 5 — The Promise: Reproducible and Cacheable

Why endure the BUILD files? Two payoffs, both flowing directly from hermeticity.

**1. Reproducible.** Because the build depends only on declared inputs and pinned toolchains, the same source produces the same artifact on your laptop, your teammate's laptop, CI, and a build server in another datacenter. "Works on my machine" stops being a sentence anyone says. (See [09 — Reproducible Builds](../09-reproducible-builds/senior.md).)

**2. Cacheable — and the caching is *shared*.** This is the part that makes huge companies use Bazel. Bazel identifies each build step by a fingerprint of *all* its inputs (sources, tools, flags, dependencies). If a step with that exact fingerprint has *ever* been built before — by anyone, anywhere — the output can be fetched from a **shared cache** instead of recomputed.

```
You change one line in services/payments/handler.go.
  → Bazel: only payments_lib and payments are affected.
  → web/, accounts/, and the proto generation are UNCHANGED.
  → Their fingerprints match cached entries → reused instantly.
  → Only the two affected targets rebuild.
```

In a normal CI run, a teammate may have *already* built everything you did not touch. With a shared **remote cache**, your CI build downloads those results instead of redoing them. A build that would take 40 minutes from scratch finishes in 90 seconds because 95% of it was a cache hit. (See [07 — Build Caching](../07-build-caching/senior.md).)

> **Why this only works if the build is hermetic:** a shared cache is *dangerous* if builds are not hermetic. If a step secretly read something off the machine, two machines with the same declared inputs could legitimately produce different outputs — and reusing a cached output from the wrong one gives you a subtly broken artifact. Hermeticity is the guarantee that makes cache reuse *correct*. No hermeticity, no safe sharing.

---

## Real-World Examples

**1. The protobuf change that rebuilt the world (and then didn't).** A team edits `user.proto`. With their old shell-script build, every service and the frontend rebuild from scratch — 35 minutes. After moving to Bazel, the same edit rebuilds the generated proto code plus only the three targets that actually consume the changed message, in under two minutes. The graph knew what was affected; nothing else moved.

**2. "It passes in CI but fails on my laptop."** A test reads a config file from `/etc/myapp/` that exists in CI but not on a new hire's machine. Under per-language tools, this is a mysterious flake. Under a hermetic Bazel build, the test's sandbox refuses to expose `/etc/myapp/` because it was never declared as an input — so the test fails *the same way everywhere*, immediately revealing the hidden dependency instead of hiding it.

**3. The 90-second CI build.** A large monorepo's CI used to take 40 minutes per pull request. After adopting Bazel with a remote cache, most pull requests touch a small slice of the graph; everything else is a cache hit fetched over the network. Median CI time drops to under two minutes. The speed-up came entirely from *knowing exactly what changed* and *safely reusing the rest*.

---

## Mental Models

- **Hermetic = airtight box.** A normal build is an open window — air (the system, the network) drifts in and changes the result. A hermetic build is a sealed glovebox: only what you put in through the declared ports gets in. Same things in, same thing out, every time.

- **The BUILD file is a shipping manifest.** A cargo container's manifest lists *exactly* what is inside. You do not say "and whatever else was lying around the dock." `srcs` and `deps` are that manifest. The honesty of the manifest is what lets the system trust and optimize the cargo.

- **Caching is only safe if inputs are honest.** A cache keyed on "the inputs" can only reuse outputs if "the inputs" is the *whole truth*. Hermeticity is the rule that forces the truth. A leaky build with caching is a build that confidently hands you stale, wrong answers.

- **Per-language tools trust the machine; hermetic tools trust the manifest.** `go build` asks the machine "what Go do you have?" Bazel asks "what Go did the manifest pin?" The second question has the same answer everywhere; the first does not.

---

## Common Mistakes

1. **Thinking "polyglot" is the hard part.** Building many languages is the *easy* half (rule sets handle it). The hard, valuable half is **hermeticity** — making every build honest about its inputs. That is where the reproducibility and caching come from.

2. **Assuming per-language tools are already hermetic.** They are not, by default. `go build`, `npm`, `cargo`, and `mvn` all use the PATH, global caches, and the network. They are convenient, not airtight. Do not expect their caches to be safely shareable across machines.

3. **Globbing `srcs = glob(["**/*.go"])` and forgetting it changes the truth.** Over-broad input lists make targets rebuild when unrelated files change, and can hide real dependencies. List what the target actually uses.

4. **Expecting Bazel to "just figure out" dependencies.** It will not guess. If a target uses generated code or a library, you must declare it in `deps`. The whole model rests on you telling the truth; it does not auto-discover the way `go build` does.

5. **Reaching for Bazel on a small, single-language project.** Hermetic build tools have real overhead — BUILD files to maintain, a learning curve, third-party deps to wrangle. For one Go service, `go build` is the right answer. Bazel pays off at *scale* and *polyglot*, not on a weekend project.

6. **Confusing "reproducible" with "correct."** A hermetic build reproduces the *same* output reliably. If your code is wrong, it reproduces the same *wrong* output reliably. Hermeticity buys consistency, not correctness.

---

## Test Yourself

1. In one sentence, what does it mean for a build to be *hermetic*?
2. Name two ways a "normal" `go build` or `npm run build` is *not* hermetic.
3. Why does hermeticity make a *shared* cache safe, when it would otherwise be dangerous?
4. You edit one `.proto` file in a monorepo built by Bazel. Why does only a small part of the repo rebuild?
5. In a BUILD file, what do `srcs` and `deps` declare, and why must they be explicit?
6. Your single-language hobby project builds fine with `cargo build`. Should you switch to Bazel? Why or why not?

<details>
<summary>Answers</summary>

1. A hermetic build depends *only* on explicitly declared inputs (sources, pinned tools) and nothing from the machine, network, or environment — so the same inputs always produce the same outputs.
2. Any two of: it uses the compiler on your `PATH` (not a pinned version); it reads global caches like `~/.m2` or the npm cache; it fetches dependencies from the network during the build; it can read undeclared files on the machine.
3. A shared cache reuses an output whenever "the inputs" match. Only if the build is hermetic does "the declared inputs" equal "*all* the inputs" — so two machines with matching inputs are guaranteed to have produced identical outputs, making reuse correct. Without hermeticity, a machine could have produced a different output from hidden state, and reuse would hand you a wrong artifact.
4. Bazel knows the exact dependency graph from the BUILD files. It rebuilds the generated proto code plus *only the targets that declared a dependency on the changed message*; every other target's inputs are unchanged, so their cached outputs are reused.
5. `srcs` = the exact source files the target is built from; `deps` = the other targets/libraries it depends on. They must be explicit because the build can only cache and parallelize correctly if it knows each step's *complete, true* set of inputs.
6. No (probably). Bazel pays off for **large** and/or **polyglot** repos via shared caching and cross-language graphs. For one small single-language project, `cargo build` is simpler and the BUILD-file/maintenance overhead of Bazel is not worth it.

</details>

---

## Cheat Sheet

```
THE PROBLEM
  many languages + one repo + many machines
  → per-language tools don't share a graph and aren't hermetic → drift, slow, flaky

HERMETIC = depends ONLY on declared inputs
  no ambient PATH      → pinned toolchains (exact compiler version for everyone)
  no undeclared reads  → sandbox blocks files you didn't declare
  no network in build  → deps fetched + hash-pinned beforehand, build runs offline
  no hidden state      → no clock, hostname, random, $HOME baked into output
  ⇒ same inputs ALWAYS produce same outputs

WHY IT MATTERS
  reproducible   → same source → same artifact everywhere
  cacheable      → unchanged inputs → reuse output (skip the work)
  SHAREABLE cache → others' results reused; 40-min build → 90-sec build
  (caching is only SAFE because the build is hermetic)

BAZEL AT A GLANCE
  target   a named buildable thing (binary/library/test)
  rule     recipe per kind: go_binary, java_library, ts_project
  BUILD    file declaring targets (Starlark = limited Python)
  srcs     exact source files (explicit, not "everything")
  deps     exact dependencies (explicit; no auto-discovery)
  sandbox  isolated dir where an action sees only its inputs

COMMANDS
  bazel build //...           build everything
  bazel test  //...           test everything
  bazel build //web:app       build one target

WHEN TO USE
  big monorepo + polyglot + CI cost → worth it
  small single-language project     → use the per-language tool
```

---

## Summary

- A **polyglot monorepo** (Go + Java + TS + protobuf in one repo) breaks per-language tools: no tool understands the whole cross-language graph, and each one silently depends on the machine it runs on.
- A **hermetic** build depends *only* on explicitly declared inputs: no ambient PATH (pinned toolchains instead), no undeclared file reads (sandboxing), no network during the build, no hidden state. The result: **same inputs always produce same outputs.**
- That single property is what makes builds **reproducible** (identical everywhere) and safely **cacheable** — including a *shared* cache across machines, which turns 40-minute builds into 90-second ones.
- **Bazel** (with cousins **Buck2** and **Pants**) is the flagship tool: you declare **targets** in **BUILD** files using **rules** like `go_binary`, listing **srcs** and **deps** explicitly, and Bazel builds the whole repo's graph, sandboxing each step.
- The explicitness of BUILD files is the price of admission; the honest manifest of inputs is exactly what lets the system cache and parallelize correctly.
- Per-language tools ([04](../04-per-language-tools/senior.md)) are convenient but **not hermetic by default**. Hermetic tools pay off at *scale* and *polyglot*; for a small single-language project they are overkill.

The next level formalizes *how* Bazel models everything as an action graph, how sandboxing and content-addressed caching actually enforce and exploit hermeticity, and the Starlark you write to drive it.

---

## Further Reading

- [Bazel — *Getting Started*](https://bazel.build/start) — install it and build a "hello world" in two languages; the concepts land faster once you have run `bazel build //...`.
- [Bazel — *Concepts: Build basics*](https://bazel.build/concepts/build-ref) — targets, packages, labels, and the `//path:target` syntax.
- *Software Engineering at Google* (Winters, Manshreck, Wright), Chapter 18 "Build Systems and Build Philosophy" — the clearest plain-language case for why Google built Bazel. Free online.
- [middle.md](middle.md) of this topic — the action graph, sandboxing, and the content-addressed cache, made concrete.

---

## Related Topics

- [04 — Per-Language Tools](../04-per-language-tools/senior.md) — the convenient, *non-hermetic* tools this page contrasts with.
- [02 — Dependency Graphs](../02-dependency-graphs/senior.md) — the graph Bazel builds across all your languages.
- [07 — Build Caching](../07-build-caching/senior.md) — how the cache that hermeticity unlocks actually works.
- [09 — Reproducible Builds](../09-reproducible-builds/senior.md) — making "same inputs → same bits" a hard guarantee.
- [08 — Cross-Compilation](../08-cross-compilation/senior.md) — building for other platforms with pinned toolchains.
