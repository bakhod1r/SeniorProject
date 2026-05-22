# go clean — Find the Bug

Each scenario looks fine but misbehaves. Find the defect, explain it, fix it.

---

## Bug 1 — `rm -rf` on the module cache fails

```bash
$ rm -rf "$(go env GOMODCACHE)"
rm: cannot remove '.../cache/download/...': Permission denied
```

**Bug:** module cache files are stored read-only to prevent mutation; `rm -rf` cannot delete them without changing permissions.
**Fix:** `go clean -modcache`, which handles the read-only bits correctly.

---

## Bug 2 — Cleaning the build cache every CI job

```yaml
- run: go clean -cache
- run: go build ./...
```

**Bug:** the job also restores a cached `GOCACHE` for speed, then immediately wipes it — every build is cold and slow.
**Fix:** remove the per-job clean; clean only on a schedule or in a dedicated cold-build job.

---

## Bug 3 — Clean "fixes" a broken build

A developer runs `go clean -cache` and the build works, then concludes the cache was corrupt.

**Bug:** the content-addressed build cache cannot serve a stale result; the real cause (env drift, nondeterministic generation, toolchain mismatch) is unaddressed and will recur.
**Fix:** diagnose: check `GOFLAGS`, build tags, `GOOS/GOARCH`, `go version`. Fix the actual cause.

---

## Bug 4 — Wiped module cache before going offline

```bash
go clean -modcache
# (disconnect from network)
go build ./...        # fails: cannot download dependencies
```

**Bug:** the module cache held the only local copy of dependencies; wiping it before an offline build breaks the build.
**Fix:** warm the cache (`go mod download`) before going offline, or vendor (`go mod vendor`) for offline builds.

---

## Bug 5 — `-testcache` used where `-count=1` was meant

```bash
go clean -testcache    # to re-run one package's tests
```

**Bug:** this globally expires *all* cached test results, broader than intended; every package re-runs next time.
**Fix:** for a targeted re-run, `go test -count=1 ./thatpkg`.

---

## Bug 6 — Expecting bare `go clean` to wipe the build cache

```bash
$ go clean ./...
$ # build is still fast / cache untouched — confused
```

**Bug:** bare `go clean` removes build outputs left in source directories, which modern Go usually does not create; it does **not** touch the build cache.
**Fix:** use `go clean -cache` to clear the build cache.

---

## Bug 7 — Manual delete corrupts a partially-removed module cache

```bash
rm -rf "$(go env GOMODCACHE)/github.com/foo"   # killed mid-delete
go build ./...   # checksum/verify errors on partial entries
```

**Bug:** a partial manual deletion left the module cache inconsistent.
**Fix:** `go clean -modcache` to fully reset, then `go mod download` and `go mod verify`.

---

## Bug 8 — Fuzz seed corpus assumed deleted

A developer runs `go clean -fuzzcache` expecting it to clear committed seed corpora in `testdata/fuzz`.

**Bug:** `-fuzzcache` only clears *generated* corpus entries in the cache; committed seed corpora in `testdata/fuzz` are source files and are not touched.
**Fix:** if you really want to remove seeds, delete the `testdata/fuzz` files in source (deliberately, in a commit).

---

## Bug 9 — Disk fills despite "trimming"

A long-lived self-hosted runner fills its disk over months.

**Bug:** while the build cache self-trims, the *module* cache grows with every new dependency version used and is not auto-trimmed.
**Fix:** scheduled `go clean -modcache` (and `-cache`) on persistent runners, triggered by a disk-usage threshold.

---

## How to approach these
1. Permission errors deleting cache? → use `go clean -modcache`.
2. Slow CI? → stop cleaning caches you persist.
3. Clean "fixed" it? → find the real env/toolchain cause.
4. Offline build broke? → warm cache or vendor first.
5. Too broad a re-run? → `-count=1` instead of global `-testcache`.
