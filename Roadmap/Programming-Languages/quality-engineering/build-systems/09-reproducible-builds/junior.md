# Reproducible Builds — Junior Level

> **Roadmap:** [Build Systems](../README.md) → Reproducible Builds
> *Build the same source twice and you'd expect the same program. Astonishingly often you don't — and the gap between "same source" and "same bytes" is where trust, debugging, and caching all quietly break.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — What "Reproducible" Actually Means](#core-concept-1--what-reproducible-actually-means)
5. [Core Concept 2 — Why Anyone Cares: The Trust Problem](#core-concept-2--why-anyone-cares-the-trust-problem)
6. [Core Concept 3 — Build Twice, Compare the Bytes](#core-concept-3--build-twice-compare-the-bytes)
7. [Core Concept 4 — The Usual Culprit: Embedded Timestamps](#core-concept-4--the-usual-culprit-embedded-timestamps)
8. [Core Concept 5 — Your First Fix: SOURCE_DATE_EPOCH](#core-concept-5--your-first-fix-source_date_epoch)
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

> Focus: **If I build the same code twice, do I get the same file? And why does that matter?**

Here is a claim that surprises almost everyone the first time they test it: take a project, build it, save the output, then build the *exact same source* again. Compare the two outputs byte for byte. They are usually **different**.

Not different in behaviour — the program works the same. Different in *bytes*. Some bytes inside the file changed even though not a single character of your source changed. The most common reason is almost comically mundane: the compiler stamped *today's date and time* into the binary, and "now" is different on the second build.

A **reproducible build** is one where this doesn't happen. Same source, same tools, same instructions → **bit-identical** output, every time, on any machine, run by anyone. The file's SHA-256 hash is identical down to the last byte.

That sounds like a pedantic detail. It is not. It is the foundation of being able to *verify* that a program you downloaded actually came from the source code you can read — which is the difference between trusting software and merely hoping. This page teaches you what reproducibility means, why it's worth caring about, how to test for it in two commands, and the single most common thing that breaks it.

> **The mindset shift:** stop thinking "the build produced a working program, so it's fine." Start asking "would the build produce the *same* program if I ran it again, somewhere else, tomorrow?" Most builds fail that second question — and they fail it in small, fixable ways.

---

## Prerequisites

- **Required:** You can build a program from source with a compiler or a build tool (`gcc`, `go build`, `make`).
- **Required:** You've used a terminal and can run a command and read its output.
- **Helpful:** You've read [01 — Build Fundamentals (junior)](../01-build-fundamentals/junior.md) and know what a binary/artifact is.
- **Helpful:** You've heard the words "hash" or "checksum" even if you couldn't define them precisely. (You will here.)

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Reproducible build** | Same source + same tools + same steps → **byte-for-byte identical** output, every time. |
| **Bit-identical / byte-for-byte** | Two files are *exactly* equal — same length, same value at every single byte. |
| **Hash / checksum** | A short fixed-size fingerprint of a file (e.g. SHA-256). Change one byte → the hash changes completely. |
| **Deterministic** | Always produces the same result from the same inputs. The opposite of *nondeterministic*. |
| **Nondeterminism** | Anything that makes two builds of the same source differ (timestamps, random ordering, paths…). |
| **Artifact** | A file the build produces — a binary, a `.jar`, a `.tar.gz`, a container image. |
| **Toolchain** | The compiler, linker, and friends used to build (see [Build Fundamentals](../01-build-fundamentals/junior.md)). |
| **`SOURCE_DATE_EPOCH`** | A standard environment variable that tells build tools "pretend *this* is the current time." |
| **Supply chain** | The whole path source code travels: author → build → distribution → your machine. |

---

## Core Concept 1 — What "Reproducible" Actually Means

A build is reproducible when it satisfies one precise sentence:

> **Same source + same toolchain + same build instructions → bit-identical output, regardless of *when*, *where*, or *by whom* it was built.**

Every word in that sentence is load-bearing:

- **Same source** — the exact same files, down to the byte. A different commit is a different input; all bets are off.
- **Same toolchain** — the same compiler *version*, same linker, same library versions. GCC 12 and GCC 13 are different machines; they're allowed to produce different bytes.
- **Same build instructions** — the same flags, the same options, the same steps in the same order.
- **Bit-identical output** — not "works the same," not "passes the same tests." The *exact same bytes*.
- **Regardless of when/where/by whom** — Tuesday on your laptop must equal Friday on a server in another country built by a stranger.

That last clause is the hard one. It means the build must not secretly depend on *anything* outside its declared inputs — not the clock, not the directory you happened to build in, not your username, not your locale, not the order the filesystem listed your files in. Every one of those is an input that *isn't* "the source," and any of them leaking into the output breaks reproducibility.

> **Key insight:** "Reproducible" is not a property of your *code*. It's a property of your *build process*. Two builds can run the identical source through the identical compiler and still differ — because the build process let something *other than the source* (the clock, the path, the machine) influence the bytes. Reproducibility is the discipline of making sure *only the declared inputs* affect the output.

---

## Core Concept 2 — Why Anyone Cares: The Trust Problem

Picture downloading a program — say, a wallet app that holds your money, or a tool a million servers run. The website gives you a binary and says "this is built from the open source code over there, which you can read and audit."

But *can you check that claim?* The source is readable. The binary is a wall of machine code. How do you know the binary you downloaded is *actually* what that source compiles to — and not source-plus-a-secret-backdoor that someone slipped in during the build?

If the build is **reproducible**, you (or anyone) can check it directly:

1. Download the published source.
2. Build it yourself with the same toolchain.
3. Compare *your* binary's hash to the *published* binary's hash.
4. If they match — **byte for byte** — you have proof the published binary contains nothing the source doesn't.

If the build is *not* reproducible, this whole verification is impossible. Your honest rebuild produces *different bytes* than the official one — so a different hash — so you can never tell "someone tampered with the official build" apart from "the build is just nondeterministic." The signal is drowned in noise.

This is not theoretical. In the **SolarWinds** attack (2020), attackers compromised the *build system* of a widely-used product and inserted malware *during the build* — the published source was clean, but the shipped binary was not. Tens of thousands of organizations installed the poisoned binary because they trusted that "official binary = official source." Reproducible builds are the structural defense: if independent parties rebuild and compare, a build-time injection shows up as a hash mismatch that nobody can hand-wave away.

> **Key insight:** Reproducibility converts trust from "we promise the binary matches the source" (a claim you must take on faith) into "anyone can rebuild and *verify* the binary matches the source" (a fact you can check). That shift — from *trust me* to *verify yourself* — is why security-critical projects care so much.

---

## Core Concept 3 — Build Twice, Compare the Bytes

You don't need any special tool to *test* reproducibility. You need to build twice and compare. The comparison tool is a **hash**: a fingerprint where changing even one byte of the file changes the fingerprint entirely.

```bash
# Build the program once, save the binary and its fingerprint
gcc main.c -o app
sha256sum app
# e3b0c442...  app      ← a 64-character fingerprint

# Build the SAME source a second time
gcc main.c -o app
sha256sum app
# 9f86d081...  app      ← DIFFERENT fingerprint → NOT reproducible
```

Two different hashes from the same source means the build is **not reproducible** — something leaked in. (For most C compilers with timestamps disabled this particular example will actually match, but many real build tools — packaging, archiving, language toolchains — will not, which is the point.)

A more direct comparison, byte for byte:

```bash
gcc main.c -o app1
gcc main.c -o app2
cmp app1 app2
# app1 app2 differ: byte 132, line 1     ← tells you EXACTLY which byte first differs
```

`cmp` is wonderful for learning because it points at the *first differing byte*. Run it, note the offset, and you can often guess the cause — a byte near the start of an archive is often a timestamp; a run of text in the middle is often a path.

> **The two-line test you'll use forever:** `build; sha256sum artifact` — then build again and compare the hashes. Identical hash = reproducible (so far). Different hash = something nondeterministic leaked in, and now you go hunting for *what*. The next two concepts are about the #1 thing you'll find.

---

## Core Concept 4 — The Usual Culprit: Embedded Timestamps

By far the most common reason a rebuild differs is that the build tool wrote **the current date and time into the output**. Since "now" is different every time you build, the bytes differ every time.

Where do timestamps sneak in?

- **The compiler / packager stamps a "build date."** Many tools embed when they ran — "compiled on 2026-06-15 14:32:07" — so the binary can report its build time. Helpful for humans; fatal for reproducibility.
- **Archive formats store a modification time per file.** A `.tar`, `.zip`, `.jar`, or `ar` archive records, for each file inside it, *when that file was last modified*. Repack the same files an hour later and those embedded times differ → the archive's bytes differ → its hash differs.
- **`__DATE__` and `__TIME__` in C/C++.** These macros expand to the compile date/time *as text baked into the binary*. A single `printf("Built %s\n", __DATE__);` makes every build different.

You can *see* it. Build a `.tar.gz` of the same file twice a minute apart and the two archives won't match — not because the file changed, but because the archive recorded two different "modified at" times.

```bash
echo hello > file.txt
tar czf a.tar.gz file.txt ; sleep 2 ; tar czf b.tar.gz file.txt
cmp a.tar.gz b.tar.gz
# a.tar.gz b.tar.gz differ: byte 5, line 1   ← byte 5 is the gzip timestamp field
```

Nothing about `file.txt` changed. The *archive* recorded two different moments. This is nondeterminism with no malice and no bug — it's the tools doing exactly what they were designed to do, which happens to ruin reproducibility.

> **Key insight:** The enemy of reproducibility is usually not exotic. It's the clock. Build tools love to record "when did this happen," and "when" is the one input guaranteed to change between two builds. Find the timestamps, neutralize them, and you've fixed the majority of real-world reproducibility problems.

---

## Core Concept 5 — Your First Fix: `SOURCE_DATE_EPOCH`

If timestamps are the disease, the cure needs to make every tool agree on *one fixed "now"* instead of reading the real clock. The build community standardized exactly that: an environment variable called **`SOURCE_DATE_EPOCH`**.

It holds a single number: a Unix timestamp (seconds since 1970-01-01 UTC). When it's set, a long list of build and packaging tools — GCC's `__DATE__`/`__TIME__`, `gzip`, `tar`, many language packagers — *ignore the real clock* and use that fixed value instead. Set it to the same number on every build and the timestamps stop changing.

```bash
# Pick ONE fixed time. The standard choice: the time of the last source commit.
export SOURCE_DATE_EPOCH=$(git log -1 --pretty=%ct)   # e.g. 1718200000

# Now tools that honour it will use that time instead of "now"
gzip -n < file > file.gz        # -n also tells gzip not to store the name/time
```

Why the *commit time*? Because it's a property of *the source*, not of *when you happened to build*. Two people building the same commit, a year apart, derive the *same* `SOURCE_DATE_EPOCH` from that commit — so they bake in the same timestamp and get matching bytes. The "now" becomes a function of the source, which is exactly what reproducibility requires.

A worked before/after:

```bash
# WITHOUT the fix — two builds, two different archives
tar czf a.tgz src/ ; sleep 2 ; tar czf b.tgz src/
cmp a.tgz b.tgz                 # → differ

# WITH the fix — pin the time, normalize, and they match
export SOURCE_DATE_EPOCH=1718200000
tar --sort=name --mtime="@$SOURCE_DATE_EPOCH" --owner=0 --group=0 \
    --numeric-owner -cf - src/ | gzip -n > a.tgz
# (repeat the exact command) → bit-identical a.tgz
```

You'll meet far more powerful flags and tools at the [middle level](middle.md) — path remapping, archive normalization, `diffoscope`. `SOURCE_DATE_EPOCH` is your first and most important one, because it kills the single most common source of nondeterminism with one exported variable.

> **Key insight:** You can't tell a build "don't have a timestamp" — humans still want build dates. You tell it "use *this* timestamp," and you derive that timestamp from the *source* (the commit) rather than from *the wall clock*. Reproducibility is rarely about *removing* information; it's about making every variable input a deterministic function of the declared inputs.

---

## Real-World Examples

**1. The Java `.jar` that never matched.** A team built the same Java code in CI twice and got two `.jar` files with different hashes — blocking a verification step. The code was identical. The cause: a `.jar` is a `.zip`, and `.zip` stores a modification timestamp for every entry. Two builds, two sets of timestamps. The fix was to normalize entry timestamps (and entry order) — the *same* class of fix as `SOURCE_DATE_EPOCH` for archives.

**2. Debian's decade-long project.** The Debian Linux distribution ships tens of thousands of packages built from source. To let users *verify* those packages match the source, Debian launched a massive effort to make builds reproducible — finding and fixing thousands of timestamp, path, and ordering bugs across the entire ecosystem. It's the largest real-world demonstration that this is achievable at scale (covered more in [professional.md](professional.md)).

**3. The `__DATE__` that broke caching.** A C++ project embedded `__DATE__`/`__TIME__` so the binary could print its build time. A side effect nobody anticipated: every nightly build produced a different binary even with zero source changes, so the build cache *never* got a hit — the team rebuilt the world every night for no reason. Removing the macros restored both reproducibility *and* caching (the two are deeply linked — see [07 — Build Caching](../07-build-caching/junior.md)).

---

## Mental Models

- **Reproducibility is a photograph, not a painting.** Two photographs of the same fixed scene are identical. Two paintings of it never are — the painter adds something each time. A nondeterministic build is a painter: it adds "the current time," "where I was standing" (the path), "the order I noticed things." Reproducibility means turning the painter into a camera.

- **The hash is a tamper-evident seal.** A SHA-256 is a fingerprint so sensitive that flipping one bit changes it completely. If your honest rebuild produces the *same* seal as the official artifact, nobody slipped anything in between source and binary. Different seal = something is different, and you must find out what.

- **`SOURCE_DATE_EPOCH` is a stopped clock you carry on purpose.** Instead of every tool reading the real (always-moving) clock, they all read *one frozen time* you handed them — derived from the source itself. Everyone building that source freezes their clock to the same moment.

- **Nondeterminism is a leak, and you're plugging holes.** Think of the build as a sealed box that should only contain the source. Every leak — clock, path, locale, random number, file ordering — lets something *else* into the box. Fixing reproducibility is going around the box plugging leaks one at a time.

---

## Common Mistakes

1. **Assuming "it builds and works" means "it's reproducible."** Working is about behaviour; reproducible is about *bytes*. A perfectly correct program can produce different bytes on every build. The only way to know is to build twice and compare.

2. **Never actually testing it.** Reproducibility you don't verify is reproducibility you don't have. The two-line `build; sha256sum` test (twice) is cheap — run it.

3. **Embedding `__DATE__` / `__TIME__` (or a "build date") and forgetting it ruins everything downstream.** That one convenience line makes every build differ, defeats caching, and blocks verification. If you want a build date, derive it from `SOURCE_DATE_EPOCH`, not the wall clock.

4. **Thinking the difference must be a bug in your code.** It usually isn't your code at all — it's the *tools* (compiler, archiver, packager) recording the time, the path, or the file order. Look at the build process, not the source.

5. **Comparing the wrong thing.** Comparing program *output* or *test results* tells you the program behaves the same. Reproducibility is about the *artifact's bytes* — hash the file itself, not what it prints.

6. **Setting `SOURCE_DATE_EPOCH` but forgetting tools that ignore it.** It's an opt-in standard; not every tool honours it, and archives need their *own* normalization flags (entry order, ownership). It's the first fix, not the only one.

---

## Test Yourself

1. In one precise sentence, what does it mean for a build to be "reproducible"?
2. You build the same source twice and `sha256sum` gives two different hashes. Is your *code* broken? What does the mismatch actually tell you?
3. Why does reproducibility let a stranger *verify* that an official binary really came from the published source?
4. Name the single most common source of nondeterminism, and give two specific places it hides.
5. What does `SOURCE_DATE_EPOCH` do, and why is the *commit time* a good value to set it to?
6. A `.jar` (which is a `.zip`) built from identical `.class` files has a different hash each build. What's the likely cause, and is it a bug in the Java code?

<details>
<summary>Answers</summary>

1. Same source + same toolchain + same build instructions produces **bit-identical** (byte-for-byte) output, regardless of when, where, or by whom it was built.
2. **Your code is almost certainly fine.** The mismatch tells you the *build process* let something other than the source (most often the clock) influence the output bytes — i.e., the build is nondeterministic.
3. They can download the source, rebuild it with the same toolchain, hash their result, and compare to the official binary's hash. A byte-for-byte match proves the official binary contains nothing the source doesn't — no need to take the publisher's word for it.
4. **Embedded timestamps.** Hiding places: a "build date" the compiler/packager stamps in; per-file modification times inside archives (`.tar`, `.zip`, `.jar`, `ar`); and `__DATE__`/`__TIME__` macros baked into C/C++ binaries.
5. It tells timestamp-aware build tools to use *one fixed time* instead of reading the real clock. Using the commit time makes the timestamp a function of the *source*, so everyone who builds that commit bakes in the same time and gets matching bytes.
6. A `.zip`/`.jar` stores a modification timestamp (and ordering) for each entry, so each build records different times. **Not a bug in the Java code** — it's the archive format recording "now." Fix by normalizing entry timestamps and order.

</details>

---

## Cheat Sheet

```
WHAT "REPRODUCIBLE" MEANS
  same source + same toolchain + same instructions
      → BIT-IDENTICAL output (regardless of when/where/who)
  it's a property of the BUILD PROCESS, not of the code

TEST IT (build twice, compare)
  gcc main.c -o app ; sha256sum app     # note the hash
  gcc main.c -o app ; sha256sum app     # same hash? reproducible : not
  cmp app1 app2                         # shows FIRST differing byte

#1 ENEMY: TIMESTAMPS
  compiler/packager "build date"
  archive per-file mtime (.tar .zip .jar ar)
  C/C++  __DATE__  __TIME__  macros

FIRST FIX: SOURCE_DATE_EPOCH (a fixed "now")
  export SOURCE_DATE_EPOCH=$(git log -1 --pretty=%ct)   # commit time
  gzip -n          # don't store name/timestamp
  tar --sort=name --mtime="@$SOURCE_DATE_EPOCH" \
      --owner=0 --group=0 --numeric-owner          # normalize archive

WHY IT MATTERS
  trust: anyone can rebuild + compare hashes  → binary matches source
  defense vs build-time tampering (SolarWinds-class)
  caching correctness (same inputs → same output → cache hit)
```

---

## Summary

- A **reproducible build** produces **bit-identical** output from the same source, toolchain, and instructions — *regardless of when, where, or by whom* it was built. It's a property of the **build process**, not of the code.
- The reason to care is **trust**: if a build is reproducible, anyone can rebuild the published source and check, byte for byte, that the official binary matches — turning "trust the publisher" into "verify it yourself." This is the structural defense against build-time tampering like the SolarWinds attack.
- You **test** reproducibility by building twice and comparing — `sha256sum` for a fingerprint, `cmp` to find the first differing byte. Same source, different hash = nondeterminism leaked in.
- The **#1 culprit** is embedded **timestamps**: build dates, per-file modification times inside archives, and `__DATE__`/`__TIME__` macros.
- The **first fix** is `SOURCE_DATE_EPOCH` — pin every tool to one fixed time derived from the *source* (the commit time), plus archive-normalizing flags like `tar --sort=name --mtime` and `gzip -n`.

You now know what reproducibility is, why it's worth the trouble, and how to test for it. The [middle level](middle.md) catalogs *every* major source of nondeterminism — paths, ordering, locale, randomness — and the precise fix for each.

---

## Further Reading

- [reproducible-builds.org](https://reproducible-builds.org/) — the central project; its [docs](https://reproducible-builds.org/docs/) are the canonical list of nondeterminism sources and fixes.
- [The `SOURCE_DATE_EPOCH` specification](https://reproducible-builds.org/specs/source-date-epoch/) — short, readable, and the source of truth for the variable.
- [What is a reproducible build?](https://reproducible-builds.org/docs/definition/) — the project's own precise definition, worth reading slowly.
- The [middle.md](middle.md) of this topic — the full catalog of nondeterminism sources and their fixes, plus `diffoscope`.

---

## Related Topics

- [01 — Build Fundamentals](../01-build-fundamentals/junior.md) — what a build and an artifact are, the foundation this builds on.
- [07 — Build Caching](../07-build-caching/junior.md) — why "same inputs → same output" is also what makes caching *correct*.
- [05 — Polyglot & Hermetic Builds](../05-polyglot-hermetic-builds/junior.md) — sealing the build off from the host so fewer things can leak in.
- [Release Engineering › Artifact Signing & Provenance](../../release-engineering/04-artifact-signing-and-provenance/junior.md) — signing the artifacts a reproducible build produces.
