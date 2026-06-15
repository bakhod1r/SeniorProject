# Minimal Version Selection (MVS) — Find the Bug

> Each snippet contains a real-world misunderstanding or mistake related to Go's version selection. MVS selects, for each module, the *highest version any `require` directive in the graph asked for* — the highest of the minimums, never the latest available. A `require` line is a *floor*, not a pin; the build list (`go list -m all`) is the maximum floor per module. Find the bug, explain it, fix it.

---

## Bug 1 — Expecting the latest version

```bash
$ go get github.com/google/uuid@latest    # resolves to v1.6.0 today
$ # ... six months pass, uuid v1.8.0 is released ...
$ go build ./...
$ go list -m github.com/google/uuid
github.com/google/uuid v1.6.0
```

```text
Developer: "Why is my build still on v1.6.0? I want the latest!"
```

**Bug:** The developer assumes Go keeps dependencies at "latest" automatically. MVS does not. `go get @latest` wrote `v1.6.0` as a *floor* into `go.mod` at the time it ran. A later release does not change the floor, and a plain `go build` never upgrades. The build is correctly frozen at the version the floor names.

**Fix:** upgrade deliberately when you want to move forward:

```bash
$ go get github.com/google/uuid@latest    # re-resolves to v1.8.0 now
$ go mod tidy
$ go list -m github.com/google/uuid
github.com/google/uuid v1.8.0
```

MVS freezing your versions is the feature, not the bug. Upgrades are explicit events.

---

## Bug 2 — Hand-editing `go.mod` to "downgrade"

```text
# go.mod (hand-edited)
require (
    github.com/libfoo v1.0.0          // a dependency requires x/text v0.9.0
    golang.org/x/text v0.3.0          // ← lowered by hand to "downgrade"
)
```

```bash
$ go build ./...
$ go list -m golang.org/x/text
golang.org/x/text v0.9.0          # still v0.9.0!
```

**Bug:** The developer lowered the `x/text` require to `v0.3.0` expecting the build to use it. But `libfoo`'s `go.mod` floors `x/text` at `v0.9.0`, and MVS selects the *maximum* floor. Lowering one floor below another floor does nothing — `v0.9.0` still wins.

**Fix:** you cannot downgrade below another module's floor by lowering your own line. Either downgrade the module that forces it higher (which propagates), or exclude/replace:

```bash
# Option A: real downgrade (may cascade libfoo down too)
$ go get golang.org/x/text@v0.3.0

# Option B: skip the bad version, select next-highest
$ go mod edit -exclude=golang.org/x/text@v0.9.0

# Option C: override entirely
$ go mod edit -replace=golang.org/x/text=golang.org/x/text@v0.3.0
```

---

## Bug 3 — `go get foo@v1.2.0` "didn't work"

```bash
$ go get github.com/spf13/pflag@v1.0.3
go: upgraded github.com/spf13/pflag v1.0.3 => v1.0.5
$ go list -m github.com/spf13/pflag
github.com/spf13/pflag v1.0.5
```

```text
Developer files a bug: "go get installed the wrong version!"
```

**Bug:** Not a bug. `cobra` (a direct dependency) requires `pflag v1.0.5`. The developer asked for `v1.0.3`, but MVS selects the maximum floor, and a transitive dependency floors `pflag` at `v1.0.5`. The toolchain even reported `upgraded ... => v1.0.5`.

**Fix:** to actually get `v1.0.3`, find and lower the requirer:

```bash
$ go mod why -m github.com/spf13/pflag
$ go mod graph | grep 'spf13/pflag@'
# locate the module forcing v1.0.5, then go get it at a version
# whose go.mod requires a lower pflag — or exclude v1.0.5.
```

Usually the right answer is "accept v1.0.5" — it satisfies your `v1.0.3` floor and is newer.

---

## Bug 4 — Treating `go.sum` as a lockfile

```bash
$ rm go.sum          # "regenerate the lockfile to fix versions"
$ go build ./...
go: github.com/foo/bar@v1.2.0: missing go.sum entry; to add it:
        go mod download github.com/foo/bar
```

```text
Developer: "I deleted the lockfile and now versions are broken."
```

**Bug:** `go.sum` is **not** a lockfile. It is an integrity database — content hashes of the module bytes. Deleting it does not change which versions MVS selects (those come from `go.mod` floors); it only removes the integrity check, so the build refuses to proceed until hashes are re-recorded.

**Fix:** regenerate the hashes; the versions never changed:

```bash
$ go mod download      # or: go mod tidy
$ go list -m all       # identical build list as before
```

The lockfile is `go.mod`. `go.sum` verifies bytes; it does not select versions.

---

## Bug 5 — Assuming `go build` upgrades dependencies

```yaml
# .github/workflows/ci.yml
- run: go build ./...     # "this will pull the latest patches"
```

```text
Security team: "CI builds should automatically pick up dependency fixes."
```

**Bug:** A plain `go build` is read-only with respect to `go.mod` (since Go 1.16, `-mod=readonly` is the default). It computes the build list from the existing floors and never raises them. No automatic patches will ever arrive this way. The build is reproducibly stuck on whatever the floors say.

**Fix:** make upgrades explicit and scheduled, not a side effect of build:

```yaml
# a separate scheduled job, not the build job
- run: |
    go get -u=patch ./...
    go mod tidy
    govulncheck ./...
# open a PR with the diff; humans review the floor changes
```

MVS will not patch you. Add a currency process.

---

## Bug 6 — `v2` imported without the `/v2` suffix

```go
import "github.com/foo/bar"     // but the project needs v2 features
```

```text
require github.com/foo/bar/v2 v2.1.0
```

```bash
$ go build ./...
build: package github.com/foo/bar is not in std and not required;
to add it: go get github.com/foo/bar
```

**Bug:** `github.com/foo/bar` (v1) and `github.com/foo/bar/v2` are **different modules** to MVS, with different import paths. The `require` floors the *v2* module, but the import names the *v1* path — which has no floor, so the build cannot resolve it.

**Fix:** import the major version you actually depend on:

```go
import "github.com/foo/bar/v2"
```

```bash
$ go mod tidy
$ go list -m all | grep foo/bar
github.com/foo/bar/v2 v2.1.0
```

Major versions are separate modules; the `/vN` suffix is part of the import path.

---

## Bug 7 — Deleting `// indirect` lines as "clutter"

```text
# go.mod (after a developer "cleaned up")
require (
    github.com/spf13/cobra v1.8.0
    // (all // indirect lines deleted to "tidy up")
)
```

```bash
$ go build ./...
go: updates to go.mod needed; to update it:
        go mod tidy
```

**Bug:** The `// indirect` lines were not clutter. Under `go 1.17+`, they pin the *entire build list* so MVS can compute selection from `go.mod` alone (module graph pruning). Deleting them makes `go.mod` no longer a complete record of the build list, and the toolchain (in `-mod=readonly`) refuses to proceed.

**Fix:** never hand-delete indirect requires. Let tidy manage them:

```bash
$ go mod tidy
$ git diff go.mod      # the indirect lines are restored
```

`go mod tidy` adds exactly the indirect floors needed and removes the genuinely unused ones.

---

## Bug 8 — Surprised by a downgrade cascade

```bash
$ go get golang.org/x/text@v0.3.0
go: downgraded github.com/libfoo v1.4.0 => v1.1.0
```

```text
Developer: "I only wanted to downgrade x/text. Why did libfoo change?!"
```

**Bug:** Not a bug — this is downgrade *propagation*. `libfoo v1.4.0`'s `go.mod` requires `x/text v0.9.0`. To make `x/text` as low as `v0.3.0`, MVS had to find a version of `libfoo` that does not require a higher `x/text` — `v1.1.0` — and downgrade it too. Lowering a module lowers everything that forced it up.

**Fix:** if downgrading `libfoo` is unacceptable, do not force the downgrade. Use `exclude` to skip just the bad `x/text` version, or accept the higher one:

```bash
# Skip one bad version without dragging libfoo down:
$ go get github.com/libfoo@v1.4.0      # restore
$ go mod edit -exclude=golang.org/x/text@v0.8.0   # the specific bad release
$ go mod tidy
```

Always read the cascade report before accepting a downgrade.

---

## Bug 9 — `exclude` in a published library, ignored by consumers

```text
# go.mod of github.com/myorg/mylib (a published library)
exclude golang.org/x/net v0.5.0   // we know this version is broken
```

```bash
# in a consumer that imports mylib
$ go list -m golang.org/x/net
golang.org/x/net v0.5.0           # the excluded version is STILL selected!
```

**Bug:** `exclude` (and `replace`) directives are honoured **only for the main module**. When `mylib` is a *dependency* of the consumer's build, its `exclude` is ignored. The library author cannot constrain downstream selection this way.

**Fix:** a library author must use `require` floors and `retract`, not main-module-only directives. To steer consumers off a bad version, raise the floor past it (or, if it is your own release, retract it):

```text
# In mylib's go.mod, floor x/net above the bad version:
require golang.org/x/net v0.6.0   // skip v0.5.0 by flooring higher
```

The consumer must add their *own* `exclude` if they want to veto a version in their build.

---

## Bug 10 — Expecting a version range

```text
# go.mod (developer tried npm-style ranges)
require github.com/foo/bar ^1.2.0
```

```bash
$ go build ./...
go: errors parsing go.mod:
        go.mod:5: usage: require module/path v1.2.3
```

**Bug:** Go modules has **no version-range syntax**. There is no `^`, `~`, `>=`, or `<`. A `require` names a single version — a floor. The developer brought npm/Cargo habits to a model that deliberately rejects ranges (ranges are what force a SAT solver and a lockfile; MVS avoids both).

**Fix:** name a single floor version:

```text
require github.com/foo/bar v1.2.0
```

If you want "at least 1.2.0," that *is* what `v1.2.0` means — it is a minimum. MVS handles the "and not unnecessarily newer" half automatically.

---

## Bug 11 — `go get -u` on a release branch, breaking reproducibility

```yaml
# release pipeline
- run: go get -u ./...     # "make sure the release has the latest deps"
- run: go build -o app ./cmd/app
- run: git tag v2.3.0
```

```text
Two runs of the release pipeline produce binaries with different dependency versions.
```

**Bug:** `go get -u ./...` raises every floor to *latest at the moment it runs*. Running the pipeline on two different days resolves `@latest` to different versions, so the "same" release tag is built against different dependencies. This destroys the reproducibility MVS otherwise guarantees — the build list is no longer a function of the committed `go.mod`.

**Fix:** never upgrade inside the release build. Upgrades are a *separate, reviewed, committed* step; the release builds from the frozen `go.mod`:

```yaml
# release pipeline builds ONLY from committed floors
- run: go build -mod=readonly -o app ./cmd/app
```

Upgrade in a PR, review the `go.mod` diff, merge, *then* tag. The tag's build list is then fixed.

---

## Bug 12 — Misreading `go mod graph` as the build list

```bash
$ go mod graph | grep 'golang.org/x/sys@' | wc -l
4
```

```text
Developer: "We depend on FOUR different versions of x/sys! That's a conflict!"
```

**Bug:** `go mod graph` is the *input* to MVS — it shows every `require` *edge*, so a popular module legitimately appears at several versions (each requirer's floor). That is not a conflict and not the build list. MVS collapses those four floors to a single *selected* version: the maximum.

**Fix:** read the *output*, not the input, to see what is actually used:

```bash
$ go list -m golang.org/x/sys
golang.org/x/sys v0.18.0      # the single selected version (max of the 4 floors)
```

The graph has many floors per module; the build list has one selected version.

---

## Bug 13 — Pseudo-version mistaken for corruption

```text
require github.com/foo/bar v0.0.0-20230615120000-abcdef123456
```

```text
Developer: "Something corrupted my go.mod — there's a garbage version string."
```

**Bug:** That is a *pseudo-version*, not corruption. It encodes an untagged commit: base version `v0.0.0`, UTC timestamp `2023-06-15 12:00:00`, commit prefix `abcdef123456`. It appears when a dependency requires a specific commit with no release tag. MVS orders and selects it like any other version.

**Fix:** nothing to fix — it is valid. If you prefer a tagged release, move the floor to one:

```bash
$ go get github.com/foo/bar@latest      # if a tag now exists
$ go list -m github.com/foo/bar
github.com/foo/bar v1.0.0
```

Pseudo-versions are first-class MVS inputs; do not "clean them up" by hand.

---

## Bug 14 — `+incompatible` treated as an error

```text
require github.com/legacy/lib v2.0.0+incompatible
```

```text
Developer: "go.mod says 'incompatible' — is my dependency broken?"
```

**Bug:** `+incompatible` is a normal marker, not an error. It means `legacy/lib` has a `v2.0.0` tag but does **not** use the `/v2` path suffix (it predates modules or never adopted module-aware major versioning). MVS handles it fine, ordering it as `v2.0.0` (the `+incompatible` metadata is ignored for precedence).

**Fix:** nothing to fix mechanically. If you want the cleaner `/v2` form, that requires the *upstream* to publish a module-aware `v2` — you cannot manufacture it. Until then, `+incompatible` is the correct, working version string. Prefer dependencies that adopt the `/vN` convention when you have a choice.

---

## Bug 15 — `go mod tidy` "removed a dependency I need"

```bash
$ go mod tidy
$ go build ./...
build: package github.com/helper/util is not in std and not required
```

```text
Developer: "Tidy deleted a dependency that my code uses!"
```

**Bug:** `go mod tidy` removes floors for modules that *no package in the build imports*. If it removed `helper/util`, then no `.go` file in the build's import graph imports it — likely the import was in a file excluded by a build tag, or in a `_test.go` for a build configuration tidy did not consider, or the import was just deleted in a refactor and the floor was stale.

**Fix:** ensure the import is actually present in a file that the build considers, then re-tidy:

```bash
$ grep -rn 'helper/util' .          # confirm a real import exists
$ go build -tags=all ./...          # if guarded by a build tag, include it
$ go mod tidy                       # now the floor is kept
```

Tidy keeps exactly the floors the build needs — no more, no less. A removed floor means no importer was found.

---

## Bug 16 — `replace` to a local path committed to the repo

```text
# go.mod committed to main
require github.com/myorg/shared v1.4.0
replace github.com/myorg/shared => ../shared-local
```

```bash
# on CI, which has no ../shared-local
$ go build ./...
go: github.com/myorg/shared@v1.4.0 (replaced by ../shared-local):
        reading ../shared-local/go.mod: open ../shared-local/go.mod: no such file or directory
```

**Bug:** A `replace` to a local path overrides MVS selection for that module — the build uses `../shared-local` instead of the floored `v1.4.0`. Committed to `main`, it breaks every environment that does not have that exact sibling directory. It also hides provenance: the selected "version" is no longer what the graph says.

**Fix:** never commit a local-path `replace` to a shared branch. Use a workspace for local development (it does not affect committed selection), or replace to a tagged fork:

```bash
# Local dev only — not committed:
$ go work init . ../shared-local

# Or a committed fork at a real version:
$ go mod edit -replace=github.com/myorg/shared=github.com/myorg/shared@v1.4.1-fix
$ go mod tidy
```

---

## Bug 17 — Forcing a high floor that drags the whole graph up

```text
# go.mod — developer added an aggressive indirect floor "to be safe"
require golang.org/x/sys v0.99.0 // indirect  ← does not exist / far newer than needed
```

```bash
$ go build ./...
go: golang.org/x/sys@v0.99.0: invalid version: unknown revision v0.99.0
```

**Bug:** The developer manually set an extreme floor "to get the newest." MVS will try to select `v0.99.0` because it is the max floor — but it does not exist, so resolution fails. Even if it existed, manually flooring a popular module far above what anything requires drags the entire build onto an untested version.

**Fix:** do not invent floors by hand. Let `go get` set realistic floors at versions that exist and that you have tested:

```bash
$ go mod edit -droprequire=golang.org/x/sys
$ go get golang.org/x/sys@latest      # a real, current version
$ go mod tidy
```

Floors should reflect versions you actually depend on and tested against — not aspirational maxima.

---

## Bug 18 — Stale `go` directive disabling pruning, slowing the build

```text
# go.mod
go 1.15
require ( /* hundreds of transitive modules, full graph loaded */ )
```

```bash
$ time go list -m all
# ... slow: loads the FULL transitive module graph (every go.mod) ...
real    0m12.4s
```

**Bug:** With `go 1.15`, MVS loads the **complete transitive module graph** — every `go.mod` of every reachable module, however deep. On a large dependency tree this is slow and pulls in `go.mod` files for modules providing no imported package. Module graph pruning (which would scope the graph to what is actually needed) is disabled below `go 1.17`.

**Fix:** bump the `go` directive to a current version to enable pruning and lazy loading:

```bash
$ go mod edit -go=1.22
$ go mod tidy                # pins the build list as indirect requires
$ time go list -m all
real    0m0.9s              # pruned graph; same build list, far less work
```

Pruning changes the *work*, not the selected versions — the build list is identical.

---

## Bug 19 — Retraction warning ignored

```bash
$ go mod tidy
go: warning: github.com/foo/bar@v1.4.0: retracted by module author:
        critical data-loss bug
$ go build ./...        # builds fine; vendor/build list still on v1.4.0
```

```text
Developer ships the release anyway — the retracted, data-losing version.
```

**Bug:** `retract` is informational at build time. MVS *will still select* a retracted version if it is the max floor — reproducibility wins over the retraction signal during build. The warning from `go mod tidy`/`go get` is the only nudge, and it was ignored.

**Fix:** treat retraction warnings as actionable. Move off the retracted version:

```bash
$ go get github.com/foo/bar@latest      # newest unretracted
$ go mod tidy
$ go list -m github.com/foo/bar
github.com/foo/bar v1.4.1               # past the retracted v1.4.0
```

Add a periodic check so retractions surface before release:

```bash
$ go list -m -u -retracted all | grep -i retracted
```

---

## Bug 20 — Two majors of the same module pulled in accidentally

```bash
$ go list -m all | grep 'foo/bar'
github.com/foo/bar v1.9.0
github.com/foo/bar/v2 v2.3.0
```

```text
Binary size jumped; both v1 and v2 of foo/bar are linked.
```

**Bug:** Not necessarily a bug — MVS *allows* `foo/bar` and `foo/bar/v2` to coexist as different modules. But here it is *accidental*: one of your dependencies still imports v1 while your code (or another dependency) moved to v2. Both are now compiled into the binary, doubling that dependency's footprint.

**Fix:** decide whether the coexistence is intended. If not, find the v1 importer and migrate it (or replace the dependency):

```bash
$ go mod why -m github.com/foo/bar       # who still needs v1?
$ go mod graph | grep 'foo/bar@v1'       # the requirer(s)
# upgrade or replace the dependency stuck on v1 so only v2 remains
```

Major-version coexistence is a feature when deliberate, bloat when accidental — audit it.

---

## Bug 21 — `go get foo` (no version) expected to upgrade foo's tree

```bash
$ go get github.com/spf13/cobra        # "upgrade cobra and its deps"
$ go list -m golang.org/x/sys
golang.org/x/sys v0.0.0-20210101...    # cobra's deps did NOT move forward
```

```text
Developer: "I told it to upgrade cobra but its dependencies are still old."
```

**Bug:** `go get foo` (without `-u`) sets/keeps `foo` at its current or specified version and adds it as a floor, but it does **not** upgrade *foo's own dependencies*. Only `-u` walks foo's requirement tree and raises those floors to latest too.

**Fix:** use `-u` to upgrade the module *and* its dependency tree:

```bash
$ go get -u github.com/spf13/cobra
$ go mod tidy
$ go list -m golang.org/x/sys           # now moved forward (within cobra's needs)
```

`go get foo` adds/pins; `go get -u foo` upgrades foo and its transitive floors.

---

## Bug 22 — Long-lived branch carries a stale build list past a CVE fix

```bash
$ git checkout feature/six-month-branch
$ go list -m golang.org/x/net
golang.org/x/net v0.7.0                  # main has v0.17.0 with a CVE fix
$ git merge main                         # go.mod conflict resolved keeping branch's floor
$ go list -m golang.org/x/net
golang.org/x/net v0.7.0                  # still vulnerable after merge
```

**Bug:** A long-lived branch floored `x/net` at `v0.7.0`. `main` raised the floor to `v0.17.0` (a CVE fix). The merge resolved the `go.mod` conflict in favour of the *branch's* lower floor — and because MVS just takes the floors in the merged `go.mod`, the vulnerable version is reselected. The CVE silently returns.

**Fix:** after any merge that touches `go.mod`, re-tidy and re-verify floors, and scan:

```bash
$ git merge main
$ go mod tidy                            # reconcile floors from both sides
$ go get golang.org/x/net@v0.17.0        # ensure the fix's floor survives
$ govulncheck ./...                      # confirm the CVE is gone
$ go list -m golang.org/x/net
golang.org/x/net v0.17.0
```

CI should run `govulncheck` post-merge so a regressed floor cannot ship unnoticed.

---

## Summary

MVS looks like a one-line rule — "select the highest required version per module" — but most bugs come from one of three misunderstandings:

1. **Forgetting that a `require` is a floor, not a pin, and the build list is the *max* of the floors.** Hence: "I asked for v1.2.0 but got v1.6.0" (a higher floor wins), "I lowered my line but nothing changed" (another floor wins), and "it pulled four versions" (those are floors in the graph, not the selected build list). Read `go mod graph` for floors, `go list -m all` for the selected result, `go mod why` for justification.
2. **Expecting automatic currency.** MVS never upgrades on a plain build — that is the reproducibility feature. New releases, CVE fixes, and retractions do not reach you until *you* raise a floor with `go get`/`-u` and tidy. Build a currency process (`govulncheck`, scheduled patch upgrades); never `go get -u` inside a release build.
3. **Misusing the escape hatches and version model.** `replace`/`exclude` are main-module-only (libraries cannot constrain consumers with them); there is no range syntax (a floor is a single version); `foo` and `foo/v2` are different coexisting modules; pseudo-versions and `+incompatible` are normal inputs, not corruption; and a stale `go` directive disables pruning. And `go.sum` is integrity, not a lockfile — deleting it never changes selection.

Treat dependency versions as committed source whose only legitimate change is a reviewed `go.mod`/`go.sum` diff. With those habits, MVS's "why that version?" surprises become predictable, and its reproducibility becomes a guarantee you can rely on rather than a mystery you fight.
