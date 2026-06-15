# Reproducible Builds — Middle Level

> **Roadmap:** [Build Systems](../README.md) → Reproducible Builds
> *The junior page named the enemy: timestamps. This page is the full bestiary — every common source of nondeterminism, the precise flag or technique that kills each one, and `diffoscope`, the tool that tells you exactly which one bit you.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [The Catalog of Nondeterminism](#the-catalog-of-nondeterminism)
4. [SOURCE_DATE_EPOCH in Depth](#source_date_epoch-in-depth)
5. [Build Paths — the Second-Worst Offender](#build-paths--the-second-worst-offender)
6. [Ordering — Filesystems, Hashmaps, and Parallelism](#ordering--filesystems-hashmaps-and-parallelism)
7. [Locale, Timezone, and the Environment Leak](#locale-timezone-and-the-environment-leak)
8. [Randomness and Uninitialized Bytes](#randomness-and-uninitialized-bytes)
9. [Normalizing Archives](#normalizing-archives)
10. [Why Hermeticity Multiplies Your Effort](#why-hermeticity-multiplies-your-effort)
11. [Verifying with diffoscope](#verifying-with-diffoscope)
12. [Mental Models](#mental-models)
13. [Common Mistakes](#common-mistakes)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [Further Reading](#further-reading)
18. [Related Topics](#related-topics)

---

## Introduction

> Focus: **What are *all* the ways a build can become nondeterministic, and how do I fix each one?**

At the junior level, reproducibility had one villain — the clock — and one hero — `SOURCE_DATE_EPOCH`. That gets you most of the way, but a real build has at least half a dozen distinct leaks, and each demands its own fix. A binary that bakes in `/home/alice/project/main.c` is broken for everyone who isn't Alice. A program that iterates a hashmap to emit code emits it in a different order each run. A `tar` built on a machine with a different `umask` records different file permissions. None of these are timestamps.

This page is the *catalog*: for each source of nondeterminism, what it looks like, where it hides, and the exact flag or technique that neutralizes it. It ends with `diffoscope` — the tool that, when two builds differ, *recursively unpacks both* and shows you the precise byte, field, or file where they diverge, so you stop guessing and start fixing.

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) — you know the definition, the two-line test, and `SOURCE_DATE_EPOCH`.
- **Required:** You've read [01 — Build Fundamentals (middle)](../01-build-fundamentals/middle.md) — you know what symbols, object files, and debug info are.
- **Helpful:** You've built something with `gcc`/`clang`, `go`, or a packaging tool and can pass flags to it.
- **Helpful:** You've used `diff`, `cmp`, or `hexdump` to compare files.

---

## The Catalog of Nondeterminism

Every reproducibility failure comes from the build reading some input that *isn't the source* and writing it into the output. Here is the full set you'll meet in practice, with the fix for each — the rest of the page expands the important ones.

| Source | Where it leaks in | The fix |
|---|---|---|
| **Timestamps** | build dates, archive mtimes, `__DATE__`/`__TIME__`, gzip header | `SOURCE_DATE_EPOCH`, `gzip -n`, `tar --mtime` |
| **Build paths** | debug info (`DW_AT_comp_dir`), `__FILE__`, `assert` strings, RPATH | `-ffile-prefix-map`, `-fdebug-prefix-map`, `go build -trimpath`, build in a canonical dir |
| **Ordering** | filesystem readdir order, hashmap iteration, parallel output, archive members | sort inputs explicitly, sorted maps, deterministic codegen, `ar D` / `tar --sort=name` |
| **Locale / timezone** | sorting, number/date formatting, case folding | pin `LC_ALL=C`, `TZ=UTC` |
| **Randomness / UUIDs** | random seeds, generated GUIDs, temp filenames | seed deterministically or derive from content |
| **Environment leak** | `$USER`, `$HOSTNAME`, `$PWD`, `$HOME` read by the build | hermetic build, scrub/pin the environment |
| **Uninitialized memory** | padding bytes in records the build writes out | zero-fill buffers; use tools that zero padding |
| **Toolchain version** | different compiler/linker → different codegen | pin exact toolchain versions (lockfiles, containers) |

> **Key insight:** There is no single "make it reproducible" switch, because nondeterminism enters through *many independent doors*. The work is going door to door. But the doors are *finite and well-known* — this table is essentially the whole list — so reproducibility is a bounded, checklist-shaped problem, not an open-ended hunt.

---

## `SOURCE_DATE_EPOCH` in Depth

`SOURCE_DATE_EPOCH` is an integer: seconds since the Unix epoch (1970-01-01 00:00:00 UTC). When set, conforming tools must use it *in place of the current time* for any timestamp they would otherwise embed, and must **clamp** any timestamp newer than it down to it.

```bash
# Derive it from the source itself — the last commit's author/commit date
export SOURCE_DATE_EPOCH=$(git log -1 --pretty=%ct)

# Verify it's a plain integer
echo "$SOURCE_DATE_EPOCH"     # 1718200000
```

Tools that honour it natively (a partial list): **GCC/Clang** (`__DATE__`, `__TIME__`, `__TIMESTAMP__`), **gzip** (via `-n`), **GNU `tar`**, **`fontforge`**, **`groff`**, **Python's `py_compile`**, **dpkg**, **rpm**, many doc generators. Tools that *don't* honour it (you must handle manually): plain `zip`, some language packagers, anything that calls `time()` directly.

Three rules that trip people up:

1. **It's seconds, not nanoseconds, not a date string.** `export SOURCE_DATE_EPOCH="2026-06-15"` is wrong and silently ignored or mis-parsed.
2. **It clamps, it doesn't override unconditionally.** A file with an mtime *older* than `SOURCE_DATE_EPOCH` keeps its older mtime in some tools; only *newer* timestamps are pulled back. For full determinism you often *also* set the mtime explicitly (`tar --mtime`).
3. **Setting the variable is necessary but not sufficient.** It fixes the timestamps tools *choose to gate on it*. It does nothing for paths, ordering, or locale — those are separate doors.

> **Key insight:** `SOURCE_DATE_EPOCH` is a *coordination protocol*, not a magic flag. It only works because dozens of independent tools agreed to read the same variable. Where a tool didn't sign up to the protocol, you fall back to that tool's own knobs (`gzip -n`, `tar --mtime`) — and you must know which tools are in the club.

---

## Build Paths — the Second-Worst Offender

After timestamps, the most common leak is the **absolute path you built in**. Compilers bake the build directory into the binary in several places, and your home directory is not part of the source.

Where paths hide:

- **Debug info.** DWARF records `DW_AT_comp_dir` (the compilation directory) and per-file paths so debuggers can find source. Build in `/home/alice/proj` vs `/build` → different bytes.
- **`__FILE__`.** This C/C++ macro expands to the source path *as the compiler saw it* — often absolute — baked into the binary as a string (commonly via `assert`, which embeds `__FILE__` into its message).
- **RPATH / RUNPATH.** Linkers can embed absolute library search paths into the binary.

The fix is **path remapping**: tell the compiler to rewrite a path prefix to a canonical one.

```bash
# GCC / Clang: rewrite BOTH __FILE__ and debug info  (file-prefix-map = the superset)
gcc -ffile-prefix-map=$PWD=/build -c main.c -o main.o

# Older / finer-grained knobs:
gcc -fdebug-prefix-map=$PWD=/build  -c main.c -o main.o   # debug info only
gcc -fmacro-prefix-map=$PWD=/build  -c main.c -o main.o   # __FILE__ etc. only
```

`-ffile-prefix-map=OLD=NEW` rewrites every occurrence of the `OLD` prefix to `NEW` in both debug info and macro expansions — so `/home/alice/proj/main.c` becomes `/build/main.c` regardless of whose machine built it. Now Alice and Bob, in different home directories, produce identical bytes.

Go bundles this into one flag:

```bash
go build -trimpath -o app .     # strips all filesystem paths to module-relative form
```

`-trimpath` removes the local build path from the resulting binary entirely, replacing it with module-rooted paths — Go's single-flag answer to the whole path-leak class.

> **Key insight:** The build directory is an input you almost never *think* of as an input — but it's stamped into debug info and `__FILE__` strings by default. Either build in a **canonical fixed directory** (what container/hermetic builds effectively do) or **remap the prefix** so the path that lands in the binary is independent of where you actually stood.

---

## Ordering — Filesystems, Hashmaps, and Parallelism

Reproducibility requires that the build emit things in a **deterministic order**. Three things love to scramble order:

**1. Filesystem listing order.** `readdir()` (and thus shell globs in some shells, `find` without `-s`, `os.listdir`) returns directory entries in *filesystem* order, which depends on the filesystem, inode allocation, and history — not alphabetically. If your build does "compile every `.c` in `src/`" by listing the directory, the *order* of object files can vary, which can reorder symbols or archive members.

```bash
# Nondeterministic: relies on readdir order
gcc $(ls src/*.c) -o app
# Deterministic: sort explicitly
gcc $(ls src/*.c | sort) -o app
```

**2. Hashmap iteration order.** Languages that randomize hashmap iteration (Go does deliberately; Python did pre-3.7 for `dict`; Java's `HashMap` is unspecified) will emit generated code, JSON, or symbol lists in a different order each run *if* the build iterates a map to produce output. Fix: sort keys before emitting, or use an ordered map.

```go
// Nondeterministic: Go randomizes map iteration ON PURPOSE
for name, def := range definitions { emit(name, def) }

// Deterministic: sort the keys first
names := slices.Sorted(maps.Keys(definitions))
for _, name := range names { emit(name, definitions[name]) }
```

**3. Parallel build output order.** A `-j8` build runs jobs concurrently; whichever finishes first may write first. If outputs are *concatenated* in completion order (rare but real — some link steps, some codegen), the result is parallelism-dependent. Fix: collect outputs and emit in a fixed (sorted) order regardless of completion order, never in finish order.

> **Key insight:** "Same set of inputs" is not "same sequence of inputs." A reproducible build must impose a *total, deterministic order* anywhere order can affect output — and the safe default is **sort by name**. Distrust any build step that consumes a directory listing or a map and emits something order-sensitive.

---

## Locale, Timezone, and the Environment Leak

The build inherits the *ambient* locale and timezone, and both change output:

- **Locale (`LC_ALL`, `LANG`, `LC_COLLATE`).** Sorting order, number formatting, decimal separators, case folding, and even some date formats are locale-dependent. A build that "sorts the symbols" sorts them *differently* under `en_US.UTF-8` vs `de_DE.UTF-8` vs `C`. The fix is to pin a fixed, minimal locale:

```bash
export LC_ALL=C        # the "C"/POSIX locale: byte-order sort, dot decimal, English
```

- **Timezone (`TZ`).** Any timestamp the build *formats as text* (a build banner, a log header, a generated comment) is rendered in the ambient timezone. Pin it:

```bash
export TZ=UTC          # render all times in UTC, not the builder's local zone
```

- **General environment leak.** Builds sometimes read `$USER`, `$HOSTNAME`, `$PWD`, `$HOME`, or arbitrary `$CFLAGS` from the ambient shell and embed them. The Linux kernel famously embedded the *builder's username and hostname* in its version string until that was made overridable. Anything the build reads from the environment that isn't part of the declared inputs is a leak.

> **Key insight:** The environment is a giant, invisible set of build inputs you didn't declare. Locale and timezone are the two that bite almost every project; usernames and hostnames bite the rest. The structural cure is **hermeticity** — running the build in a controlled environment where only declared variables exist (next section).

---

## Randomness and Uninitialized Bytes

Two subtler leaks:

**Randomness and UUIDs.** Any code generator that mints a *fresh random* identifier, GUID, nonce, or temp filename per run produces different output per run. Examples: a tool that generates a `<Project Guid="...">` for an MSBuild file, a code generator that names anonymous types with a random suffix, a packer that picks a random temp directory whose name leaks into output. Fix: seed any RNG deterministically (often from `SOURCE_DATE_EPOCH` or a content hash), or derive the identifier from stable content (`uuid5(namespace, content)` rather than `uuid4()`).

**Uninitialized padding.** When a build writes out a binary record with padding bytes (struct alignment gaps, section padding in object files, header reserved fields), and the tool doesn't *zero* that padding, it writes whatever happened to be in that memory — leftover heap garbage that differs run to run. This is the most maddening source because it's invisible in any text view; only a byte-level diff reveals it.

```bash
# Symptom: cmp shows a difference at a byte that "should be" padding/reserved
cmp a.o b.o
# a.o b.o differ: byte 4097      ← a single byte in a padding region → uninitialized memory
```

The fix lives in the *tool*, not your source: file linker/assembler bugs where padding isn't zeroed (the Reproducible Builds project has fixed dozens), or use a tool version that zeroes it. Modern `ld`, `ar D`, and friends are far better than they were a decade ago precisely because of this work.

> **Key insight:** Randomness is an *obvious* leak you can hunt by searching for `rand`/`uuid`. Uninitialized padding is an *invisible* leak — it never shows in text, only in a byte diff — and the fix is usually in the toolchain, not your code. When `cmp` points at a lone byte in a "reserved" region, suspect padding.

---

## Normalizing Archives

Archives (`.tar`, `.zip`, `.jar`, `.a`, `.deb`, container layers) are where *every* leak compounds, because an archive records, per member: name order, mtime, owner/group, permissions. All four must be normalized.

**tar** — normalize order, time, ownership, and read mode:

```bash
tar --sort=name \
    --mtime="@$SOURCE_DATE_EPOCH" \
    --owner=0 --group=0 --numeric-owner \
    --pax-option=exthdr.name=%d/PaxHeaders/%f,delete=atime,delete=ctime \
    -cf archive.tar dir/
```

- `--sort=name` — deterministic member order (defeats readdir order).
- `--mtime="@N"` — fix every member's modification time.
- `--owner=0 --group=0 --numeric-owner` — don't leak the builder's uid/gid or `/etc/passwd` names.
- the `--pax-option` line strips access/change times that otherwise leak.

**ar (static libraries)** — use the deterministic mode flag `D`:

```bash
ar Dcr libmath.a a.o b.o c.o      # D = deterministic: zero mtime, uid, gid; fixed mode
```

`ar D` (deterministic mode, often the distro default now) zeros the per-member timestamp, uid, gid, and normalizes the mode — so the same `.o` files always produce the same `.a`. (Pass the members in a sorted order too.)

**zip / jar** — plain `zip` ignores `SOURCE_DATE_EPOCH`; you typically post-process with a tool like `strip-nondeterminism`, or use a packager that supports a fixed time. For `.jar`, build with a reproducible-aware plugin or run `strip-nondeterminism --type jar app.jar`.

**Stripping** also helps: `strip` removes symbol/debug sections that may carry nondeterministic metadata — but strip *deterministically* (modern `strip` is, but verify), and remember stripping changes the bytes, so strip *consistently* in every build.

> **Key insight:** An archive multiplies your problem: it's a container of metadata, each field a fresh chance to leak the clock, the builder, or the filesystem. The `tar --sort=name --mtime --owner=0 --group=0 --numeric-owner` incantation and `ar D` are not optional flourishes — they are the difference between reproducible and not for anything that ships as a package.

---

## Why Hermeticity Multiplies Your Effort

You can fix every leak above by hand — set the variables, pass the flags, normalize the archives. But you're fighting the ambient environment one variable at a time, and a single forgotten `$USER` read undoes it. **Hermetic builds** ([05 — Polyglot & Hermetic Builds](../05-polyglot-hermetic-builds/middle.md)) flip the default: instead of *blocking* leaks, they run the build in a sealed environment where *there is nothing to leak*.

A hermetic build:

- runs in a **fixed, canonical directory** (e.g. `/build`) → path leaks become constant for free,
- starts from a **scrubbed environment** with only declared variables present → `$USER`, `$HOSTNAME`, ambient `$CFLAGS` simply don't exist,
- uses a **pinned toolchain** (exact compiler/linker versions, often a container or a Nix/Bazel toolchain) → no "GCC 12 here, GCC 13 there" divergence,
- forbids **network access** during the build → no "downloaded a slightly different dependency."

Hermeticity doesn't *replace* the per-leak fixes — you still want `SOURCE_DATE_EPOCH` and deterministic ordering — but it changes them from "remember to plug every hole on every machine" to "the holes don't exist by construction." That's why the two topics are inseparable: hermeticity gives you a *clean room*, and reproducibility is what you do *inside* it.

> **Key insight:** Per-leak fixes are *subtractive* (block each bad input); hermeticity is *constructive* (only good inputs exist). The first is fragile — one missed variable breaks it. The second is robust — but harder to set up. Mature reproducible pipelines do both: hermeticity for the floor, explicit fixes for what hermeticity can't seal (like `SOURCE_DATE_EPOCH`, which is *meant* to be set).

---

## Verifying with diffoscope

When two builds differ, `cmp` tells you the *byte offset*. That's a clue, not an answer — especially when the artifacts are archives within archives (a `.deb` containing a `.tar.xz` containing binaries containing debug sections). **`diffoscope`** is the tool the Reproducible Builds project built for exactly this: it *recursively unpacks both artifacts* and produces a human-readable diff of where they diverge.

```bash
# Build twice into separate outputs, then diff them deeply
diffoscope build-a/app.deb build-b/app.deb
```

What makes it powerful: it knows hundreds of formats. Hand it two `.deb`s and it will:

- unpack each, compare the control and data tarballs,
- for each binary inside, run `readelf`/`objdump` and diff the *disassembly* and *sections*,
- decode timestamps, decompress gzip/xz, and present a tree of differences in plain text or HTML.

So instead of "byte 4096 differs," you get *"the `DW_AT_comp_dir` in `usr/bin/app` is `/home/alice/...` here and `/build/...` there"* — which names the cause (a path leak) and the fix (`-ffile-prefix-map`). It turns a needle-in-a-haystack byte diff into a labeled list of root causes.

```bash
# Cheaper first pass without diffoscope installed:
sha256sum build-a/app build-b/app    # are they even different?
cmp build-a/app build-b/app          # first differing byte
readelf -p .comment build-a/app      # leaked compiler version/path?
```

> **Key insight:** Reproducibility is verified by *adversarial rebuild-and-diff*, not by trusting that you set all the flags. `diffoscope` is the microscope: it doesn't just say *that* two builds differ, it says *why and where*, recursively, in terms a human can act on. A reproducibility effort without `diffoscope` (or an equivalent) is debugging blind.

---

## Mental Models

- **The build is a sieve; you're plugging every hole.** Each source of nondeterminism — clock, path, order, locale, randomness, environment, padding — is a hole that lets something *other than the source* through. The catalog table is the map of holes. You plug them one by one and verify with rebuild-and-diff.

- **`SOURCE_DATE_EPOCH` is a treaty, not a tool.** It works only because many tools *agreed* to read the same variable. Outside the treaty's members, you negotiate per-tool (`gzip -n`, `tar --mtime`, `ar D`).

- **Order is an input you forgot you had.** "The set of files" feels like the input, but builds emit *sequences*, and sequence order — from readdir, from map iteration, from parallel completion — sneaks in as an undeclared input. Default to sorting.

- **Hermeticity is a clean room; reproducibility is sterile technique inside it.** A clean room (hermetic env) removes *ambient* contaminants automatically. Sterile technique (explicit fixes) handles the contaminants you must introduce on purpose (a timestamp, generated IDs). You need both.

- **`diffoscope` is the autopsy.** Two builds differed — *why?* `cmp` gives a coordinate; `diffoscope` gives a cause, recursively, in human language.

---

## Common Mistakes

1. **Fixing only timestamps and declaring victory.** `SOURCE_DATE_EPOCH` is one door. Paths, ordering, locale, and randomness are independent doors that it doesn't touch. Rebuild-and-diff *after* the timestamp fix to find what's left.

2. **Forgetting the build path leaks into debug info.** A binary that's reproducible when stripped can be *non*-reproducible with debug info, because DWARF records the absolute `comp_dir`. Use `-ffile-prefix-map` (or `go build -trimpath`), don't just strip.

3. **Relying on directory listing order.** `ls`/`readdir`/glob order is filesystem-dependent. Any build that compiles or archives "everything in this dir" without an explicit `sort` is nondeterministic by accident.

4. **Iterating a randomized map to emit output.** Go randomizes map iteration *on purpose*; other languages leave it unspecified. Sort keys before emitting code, JSON, or symbol lists.

5. **Leaving the locale and timezone ambient.** A build that sorts or formats dates inherits `LC_ALL`/`TZ` from whoever ran it. Pin `LC_ALL=C` and `TZ=UTC`.

6. **Building archives with default flags.** Plain `tar`/`ar`/`zip` records mtimes, the builder's uid/gid, and readdir order. Use `tar --sort=name --mtime --owner=0 --group=0 --numeric-owner` and `ar D` (or `strip-nondeterminism`).

7. **Verifying by eye instead of with `diffoscope`.** A byte offset from `cmp` rarely tells you the cause for a layered artifact. `diffoscope` names the field; use it.

---

## Test Yourself

1. List five *distinct* categories of nondeterminism (not five examples of timestamps) and one fix for each.
2. `SOURCE_DATE_EPOCH` is set, archives are normalized, yet a binary *with debug info* still isn't reproducible across two developers' machines. What's the most likely cause and the fix?
3. Why can a Go program that generates code be nondeterministic even with no timestamps, paths, or randomness involved?
4. What four per-member fields must you normalize when building a reproducible `tar`, and which flags do it?
5. Your two builds differ. `cmp` says "byte 4097." What tool do you reach for to learn *why*, and what does it do that `cmp` doesn't?
6. How does running the build hermetically reduce the *number* of fixes you have to apply by hand?

<details>
<summary>Answers</summary>

1. Any five of: **timestamps** (`SOURCE_DATE_EPOCH`, `gzip -n`, `tar --mtime`); **build paths** (`-ffile-prefix-map`, `go build -trimpath`); **ordering** (sort inputs, sort map keys, `tar --sort=name`/`ar D`); **locale/timezone** (`LC_ALL=C`, `TZ=UTC`); **randomness/UUIDs** (deterministic seed or content-derived IDs); **environment leak** (hermetic/scrubbed env); **uninitialized padding** (zero-fill / fixed toolchain).
2. **A build-path leak in the debug info** — DWARF records the absolute compilation directory (`DW_AT_comp_dir`) and source paths, which differ per developer's home dir. Fix: `gcc/clang -ffile-prefix-map=$PWD=/build` (or `go build -trimpath`), or build in a fixed canonical directory.
3. Go **randomizes map iteration order on purpose**. If the generator iterates a map to emit code/symbols/JSON, the *order* differs each run. Fix: sort the keys before emitting.
4. **Member order, mtime, owner/group, and permissions.** Flags: `--sort=name` (order), `--mtime="@$SOURCE_DATE_EPOCH"` (time), `--owner=0 --group=0 --numeric-owner` (ownership), plus stripping pax atime/ctime.
5. **`diffoscope`.** It recursively unpacks both artifacts (archives within archives), disassembles binaries, decodes timestamps/sections, and presents a human-readable, labeled diff naming *what* and *where* differs — versus `cmp`, which only gives a raw byte offset.
6. A hermetic build runs in a fixed directory (kills path leaks for free), a scrubbed environment (no `$USER`/`$HOSTNAME`/ambient flags to leak), with a pinned toolchain and no network — so several *categories* of leak are eliminated by construction rather than fixed individually.

</details>

---

## Cheat Sheet

```
THE DOORS (each an independent leak)
  TIMESTAMP   build date / archive mtime / __DATE__ / gzip
  PATH        debug info comp_dir / __FILE__ / RPATH
  ORDER       readdir / hashmap iter / parallel finish / archive members
  LOCALE/TZ   sort order / date+number formatting
  RANDOM      rand() / uuid4() / temp names
  ENV         $USER $HOSTNAME $PWD $HOME ambient $CFLAGS
  PADDING     uninitialized struct/section bytes (toolchain bug)
  TOOLCHAIN   different compiler/linker version

FIXES
  export SOURCE_DATE_EPOCH=$(git log -1 --pretty=%ct)
  export LC_ALL=C TZ=UTC
  gcc/clang -ffile-prefix-map=$PWD=/build      # __FILE__ + debug
  gcc/clang -fdebug-prefix-map / -fmacro-prefix-map  # finer-grained
  go build -trimpath
  gzip -n
  tar --sort=name --mtime="@$SOURCE_DATE_EPOCH" \
      --owner=0 --group=0 --numeric-owner
  ar Dcr lib.a *.o            # D = deterministic
  strip-nondeterminism file   # post-process zips/jars/etc
  sort directory listings; sort map keys before emitting

VERIFY (rebuild-and-diff)
  sha256sum a b               # different?
  cmp a b                     # FIRST differing byte
  diffoscope a b              # WHY: recursive, format-aware, human-readable

HERMETICITY = remove the doors, don't just block them
  fixed dir + scrubbed env + pinned toolchain + no network
```

---

## Summary

- Nondeterminism enters through a **finite, known set of doors**: timestamps, build paths, ordering, locale/timezone, randomness/UUIDs, environment leaks, uninitialized padding, and toolchain version. Each has its own fix; there is no single switch.
- **`SOURCE_DATE_EPOCH`** is a coordination protocol — set it from the commit time, and conforming tools use that fixed time. It clamps newer timestamps and must be a plain integer; it fixes *only* timestamps, only in tools that opted in.
- **Build paths** are the second-worst offender, leaking into debug info (`DW_AT_comp_dir`), `__FILE__`, and RPATH. Kill them with `-ffile-prefix-map` (GCC/Clang) or `go build -trimpath`, or build in a canonical directory.
- **Ordering** is an undeclared input: readdir order, randomized map iteration, and parallel completion order all scramble output. Default to **sort by name** everywhere order matters.
- **Locale/timezone** (`LC_ALL=C`, `TZ=UTC`), **randomness** (deterministic seeds / content-derived IDs), and **uninitialized padding** (toolchain fix) round out the catalog.
- **Archives** compound every leak; normalize order, mtime, ownership, and mode (`tar --sort=name --mtime --owner=0 --group=0 --numeric-owner`, `ar D`).
- **Hermeticity** removes whole categories by construction (fixed dir, scrubbed env, pinned toolchain) — you still apply the explicit fixes inside it.
- **Verify by rebuild-and-diff**: `sha256sum`/`cmp` to detect, **`diffoscope`** to diagnose — recursively, format-aware, in human terms.

The [senior level](senior.md) goes one layer down: reproducibility as a property of the *whole toolchain* (compiler determinism, LTO, PGO), bootstrappable builds, the relationship to caching correctness, and how to gate CI on rebuild-and-diff.

---

## Further Reading

- [reproducible-builds.org/docs](https://reproducible-builds.org/docs/) — the canonical, exhaustive catalog of nondeterminism sources and fixes; this page is a guided tour of it.
- [`diffoscope`](https://diffoscope.org/) — the tool, with a gallery of the formats it can recurse into.
- [GCC docs: `-ffile-prefix-map`](https://gcc.gnu.org/onlinedocs/gcc/Overall-Options.html) and [Go `cmd/go` docs: `-trimpath`](https://pkg.go.dev/cmd/go) — the primary sources for the path-remapping flags.
- [`strip-nondeterminism`](https://salsa.debian.org/reproducible-builds/strip-nondeterminism) — Debian's post-processor for archives the build tools couldn't normalize.

---

## Related Topics

- [01 — Build Fundamentals](../01-build-fundamentals/middle.md) — object files, symbols, and debug info — *where* paths and padding leak in.
- [05 — Polyglot & Hermetic Builds](../05-polyglot-hermetic-builds/middle.md) — sealing the build environment so whole leak categories vanish by construction.
- [07 — Build Caching](../07-build-caching/middle.md) — why determinism is also the precondition for *correct* caching.
- [Release Engineering › Artifact Signing & Provenance](../../release-engineering/04-artifact-signing-and-provenance/middle.md) — signing and attesting the reproducible artifacts you produce.
