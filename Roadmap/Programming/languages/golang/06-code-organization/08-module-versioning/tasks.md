# Module Versioning — Tasks

## Table of Contents
1. [How to Use This File](#how-to-use-this-file)
2. [Easy](#easy)
3. [Medium](#medium)
4. [Hard](#hard)
5. [Stretch](#stretch)
6. [Rubric](#rubric)

---

## How to Use This File

Each task is a hands-on exercise. Most can be completed in a scratch directory; some require pushing to a Git host (use a personal account or a local bare repo). All tasks include the *expected outcome* you should observe, so you can self-grade.

Work through them in order. Easy tasks build the muscle memory for tags; medium tasks introduce pseudo-versions, replace, and pre-releases; hard tasks handle major-version migrations and `+incompatible`; stretch tasks build tooling.

---

## Easy

### Task 1 — Tag your first version

1. Create a new directory and `go mod init example.com/v-task-1`.
2. Add a single file `hello.go` with one exported function `Greet`.
3. Commit to a fresh Git repo.
4. Tag the commit `v0.1.0`.
5. Run `git tag --list` and verify only `v0.1.0` appears.

**Expected outcome:** A tagged commit and a clean `git log --oneline --decorate` showing the tag.

### Task 2 — Bump for a feature

Continuing from Task 1:

1. Add a second exported function `GreetLoud`.
2. Commit.
3. Tag the new commit appropriately.

**Expected outcome:** The new tag is `v0.2.0`. (Adding a feature is a minor bump, even at v0.)

### Task 3 — Bump for a bug fix

Continuing from Task 2:

1. Fix a bug in `Greet` — say, change `"Hello "` to `"Hello, "`.
2. Commit.
3. Tag appropriately.

**Expected outcome:** The new tag is `v0.2.1`. (Bug fixes are patches.)

### Task 4 — Reach v1.0.0

Continuing from Task 3:

1. Decide that the API is stable.
2. Tag a release.

**Expected outcome:** The tag is `v1.0.0`. Bonus: write a one-paragraph CHANGELOG entry explaining what reaching v1 means.

### Task 5 — Spot the invalid version

For each tag below, decide whether Go accepts it as a module version:

| Tag | Valid? |
|-----|--------|
| `v1.2.3` | ? |
| `1.2.3` | ? |
| `V1.2.3` | ? |
| `v1.2` | ? |
| `v1.2.3.4` | ? |
| `v1.2.3-rc.1` | ? |
| `v1.2.3-rc.1+meta` | ? |
| `v1.0.0+incompatible` | ? |
| `v01.2.3` | ? |
| `v1.2.3-` | ? |

**Expected outcome:** valid: 1, 6, 7, 8 (only with the right tag history). Invalid: 2 (no `v`), 3 (capital), 4 (only two parts), 5 (four parts), 9 (leading zero), 10 (trailing dash).

### Task 6 — List versions of a real module

```bash
go list -m -versions github.com/google/uuid
```

**Expected outcome:** A space-separated list of every tagged version of `uuid`. Note the absence of pseudo-versions (only canonical tags appear).

### Task 7 — Read a `require` line

Open any project's `go.mod` (or use the snippet below):

```
require (
    github.com/google/uuid v1.6.0
    github.com/spf13/cobra v1.8.0 // indirect
)
```

Answer:

1. Which version of `uuid` is pinned?
2. Why does `cobra` have `// indirect`?
3. What would happen if you deleted the `// indirect`?

**Expected outcome:** (1) `v1.6.0`. (2) Because some other dependency requires `cobra`, not your code directly. (3) `go mod tidy` would re-add it.

---

## Medium

### Task 8 — Trigger a pseudo-version

1. Create a public Git repo on your own host (or a local bare repo) at `example.com/v-task-8`.
2. Push a commit *without* tagging.
3. From a separate consumer module, run:
   ```bash
   go get example.com/v-task-8@<branch-name>
   ```
4. Open `go.mod` and inspect the `require` line.

**Expected outcome:** The version is a pseudo-version of the form `v0.0.0-<timestamp>-<hash>`. The timestamp matches the commit timestamp; the hash is the first 12 hex chars of the commit SHA.

### Task 9 — Decode a pseudo-version

Given the pseudo-version `v1.5.1-0.20240612103515-abc123def456`:

1. What was the latest tag before this commit?
2. What is the commit timestamp in human-readable form?
3. Where would you look to find the full commit hash?

**Expected outcome:** (1) `v1.5.0` — pseudo-versions use base PATCH+1. (2) 2024-06-12 10:35:15 UTC. (3) Search for the hash prefix `abc123def456` in the repo's `git log`.

### Task 10 — Use a `replace` directive for local development

1. Create two sibling modules: `example.com/lib` and `example.com/app`.
2. `app` should import `lib`.
3. Without publishing `lib`, make `app` build by adding a `replace` directive in `app`'s `go.mod`:
   ```
   replace example.com/lib => ../lib
   ```
4. Verify `go build ./...` from the `app` directory succeeds.

**Expected outcome:** The build works without `lib` having any tag or being on a Git host.

### Task 11 — Pre-release a v1.0.0

1. Continue from Task 4 (you have a `v1.0.0`).
2. Add a half-finished feature — say, a function that always returns an error.
3. Commit, then tag `v1.1.0-rc.1`.
4. From a consumer module, try `go get yourmod@latest` and `go get yourmod@v1.1.0-rc.1`.

**Expected outcome:** `@latest` resolves to `v1.0.0` (skips the rc). `@v1.1.0-rc.1` succeeds. This proves pre-releases are opt-in.

### Task 12 — Retract a release

1. In your library, deliberately introduce a bug and tag `v1.0.1`.
2. Realise the mistake.
3. Fix the bug, then in `go.mod` add:
   ```
   retract v1.0.1   // bug: returns wrong greeting
   ```
4. Tag `v1.0.2`.
5. From a consumer, run `go list -m -u all`.

**Expected outcome:** The output marks `v1.0.1` as retracted and notes the retraction reason. `@latest` skips `v1.0.1`.

### Task 13 — Pin to a specific commit

1. Find a public Go library on GitHub.
2. Pick a commit hash from the repo's `main` branch (without a tag).
3. Run `go get example.com/lib@<hash>`.
4. Open `go.mod`.

**Expected outcome:** The `require` line shows a pseudo-version derived from your commit. Now switch to a tagged version with `go get @v<latest>` and observe how `go.mod` changes.

### Task 14 — Resolve a transitive conflict

1. Create a module `example.com/app`.
2. Add a dependency on `example.com/A` which itself depends on `example.com/X v1.2.0`.
3. Add a dependency on `example.com/B` which itself depends on `example.com/X v1.5.0`.
4. Run `go mod tidy`.
5. What version of `X` ends up in your `go.mod`? Why?

**Expected outcome:** `X v1.5.0` — MVS picks the highest version anyone in the graph requires.

### Task 15 — Use `go mod why`

In any non-trivial Go module:

```bash
go mod why -m github.com/<some-indirect-dep>
```

**Expected outcome:** A path showing how the indirect dep is reached from your main module. Useful for "why is this in my graph?"

---

## Hard

### Task 16 — Bump from v1 to v2

1. Take your library at `v1.x.x`.
2. Decide on a real breaking change (rename a function, restructure a type).
3. Update the `module` line in `go.mod` to end with `/v2`.
4. Update every internal import inside the module to include `/v2`.
5. Tag `v2.0.0` and push.
6. From a consumer module, install both `lib` and `lib/v2`. Confirm both can be imported in different files.

**Expected outcome:**
- `lib`'s `go.mod` says `module example.com/yourmod/v2`.
- Internal imports include `/v2`.
- A consumer can `import (a "example.com/yourmod"; b "example.com/yourmod/v2")` and the two are independent types.

### Task 17 — Subfolder layout for v2

1. In a fresh repo, create `lib/go.mod` with `module example.com/lib`.
2. Add a `lib/v2/go.mod` with `module example.com/lib/v2`.
3. Both versions live on `main`.
4. Tag `v1.0.0` and `v2.0.0`.
5. Verify a consumer can install either independently:
   ```bash
   go get example.com/lib@v1.0.0
   go get example.com/lib/v2@v2.0.0
   ```

**Expected outcome:** Two independent modules from one repo, with their own tags.

### Task 18 — Diagnose `+incompatible`

1. Create a repo *without* SIV: `module example.com/legacy` (no `/v2`).
2. Tag `v2.0.0`.
3. From a consumer, run `go get example.com/legacy@v2.0.0`.
4. Inspect `go.mod`.

**Expected outcome:** `require example.com/legacy v2.0.0+incompatible`. The `+incompatible` marker appears because the module path does not declare the `/v2` suffix.

### Task 19 — Migration helper

1. In your `v2` library, add a `compat/` sub-package that re-exports the v1 API but implemented in terms of v2.
2. Document it: "Use `compat` only during migration; remove imports once the migration is complete."

**Expected outcome:** A consumer can switch from `lib` to `lib/v2/compat` with zero code changes, then migrate file-by-file to native `lib/v2` calls.

### Task 20 — Multi-module repo

1. Create a repo with two modules:
   ```
   tools/cli/go.mod  (module example.com/tools/cli)
   tools/lib/go.mod  (module example.com/tools/lib)
   ```
2. Tag `cli/v1.0.0` and `lib/v0.1.0`.
3. Verify a consumer can install either independently.

**Expected outcome:** Two independent modules in one repo, each with prefixed tags. `git tag --list` shows both prefixes.

### Task 21 — Run `gorelease`

1. In your library, run:
   ```bash
   go install golang.org/x/exp/cmd/gorelease@latest
   gorelease -base=v1.5.0
   ```
2. Make a deliberately breaking change (rename an exported function).
3. Re-run `gorelease`.

**Expected outcome:** The first run reports compatibility with `v1.5.0`. After the breaking change, `gorelease` recommends a major bump (`v2.0.0`) and lists the offending changes.

### Task 22 — Replace with a fork

1. Fork a public library on GitHub.
2. Make a small change in the fork (say, add a comment).
3. In your application's `go.mod`:
   ```
   replace github.com/upstream/lib => github.com/yourname/lib v0.0.0-...<commit>
   ```
4. Build and run.

**Expected outcome:** The fork's bytes are used. `go mod graph` shows the replace edge.

---

## Stretch

### Task 23 — Build a "next version" suggester

Write a CLI that:
1. Takes the current version (e.g., `v1.5.0`).
2. Reads commit messages since that tag.
3. Categorises each commit as breaking / feature / fix based on a convention (Conventional Commits prefixes: `feat:`, `fix:`, `BREAKING CHANGE:`).
4. Suggests the next version: major if any commit is breaking, else minor if any is `feat:`, else patch.

Example output:

```
$ next-version
Current: v1.5.0
Commits since: 14
  feat: 3
  fix: 8
  breaking: 0
Next: v1.6.0
```

### Task 24 — Verify a `go.sum`

Write a script that reads `go.sum` and verifies the cache:

1. Walks every entry.
2. Locates the corresponding zip in `$GOMODCACHE/cache/download/.../@v/<version>.zip`.
3. Computes the `h1:` hash.
4. Compares to the `go.sum` entry.

**Expected outcome:** All hashes match (otherwise your cache is tampered or corrupted).

### Task 25 — Plot the dependency graph

Use `go mod graph` and Graphviz to produce a PNG of your project's dependency graph. Annotate edges with the version selected by MVS vs the version originally required.

### Task 26 — Audit for `replace` debt

Write a tool that scans every `go.mod` in a repo and reports `replace` directives. Categorise:

- Local-path replaces (`=> ../foo`).
- Fork replaces (`=> github.com/myfork/foo`).
- Pin replaces (`=> github.com/foo/foo v1.5.0`).

Use this to track "replace debt" over time.

---

## Rubric

| Score | Meaning |
|-------|---------|
| **Easy: 7/7** | You have semver vocabulary and tag fluency. |
| **Medium: 8/8** | You can manage day-to-day version operations confidently. |
| **Hard: 7/7** | You can lead a major version migration and handle multi-module repos. |
| **Stretch: 4/4** | You can build versioning tooling. |

If you fall behind in any category, return to the corresponding level file (junior, middle, senior, professional) and re-read the relevant sections before continuing.
