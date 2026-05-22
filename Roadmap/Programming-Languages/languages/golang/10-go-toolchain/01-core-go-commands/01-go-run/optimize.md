# go run — Optimization

`go run` recompiles and relinks every invocation. These exercises reduce the per-run cost or replace `go run` where it is the wrong tool. Numbers are illustrative; measure on your machine with `time`.

---

## Exercise 1: Warm the build cache

**Before** — first `go run` in a fresh checkout compiles every package: several seconds.

**After** — prime the cache once; subsequent runs only relink:

```bash
go build ./...        # populate GOCACHE with all packages
go run .              # now dominated by link + startup, not compilation
```

| Metric | Cold cache | Warm cache |
|--------|-----------|-----------|
| `go run .` wall time | ~6s | ~0.4s |

In CI, persist `~/.cache/go-build` and `~/go/pkg/mod` across jobs to keep the cache warm.

---

## Exercise 2: Build once, run many (replace `go run` in tight loops)

**Before** — a script invokes `go run .` 50 times; each pays a link + process start.

**After:**

```bash
go build -o /tmp/app .
for i in $(seq 50); do /tmp/app "$i"; done
```

| Metric | `go run` x50 | build once + run x50 |
|--------|--------------|----------------------|
| Total time | ~20s | ~2s |

The link step happens once instead of 50 times.

---

## Exercise 3: Disable cgo when you don't need it

**Before** — `go run .` with `CGO_ENABLED=1` uses the slower external linker each run.

**After:**

```bash
CGO_ENABLED=0 go run .
```

| Metric | cgo on | cgo off |
|--------|--------|---------|
| Link time per run | ~1.2s | ~0.2s |

Pure-Go programs gain nothing from cgo; turning it off uses the fast internal linker.

---

## Exercise 4: Avoid redundant flag churn

**Before** — alternating `go run .`, `go run -race .`, `go run -tags=dev .` keeps invalidating each other's cache mentally; people assume it recompiles everything.

**After** — pick a stable flag set per workflow. Each distinct flag combo has its own cache, so *consistent* flags reuse cached objects:

```bash
# dev session: keep the same flags so the cache stays warm
go run -tags=dev .
go run -tags=dev .   # reuses cached objects
```

| Metric | flags change each run | stable flags |
|--------|-----------------------|--------------|
| Recompilation | frequent | minimal |

---

## Exercise 5: Pin tool versions to hit the module cache

**Before** — `go run tool@latest` may re-resolve and re-download on version changes.

**After:**

```bash
go run honnef.co/go/tools/cmd/staticcheck@v0.5.1 ./...
```

| Metric | `@latest` | pinned `@v0.5.1` |
|--------|-----------|------------------|
| Resolution/download after first use | possible re-fetch | cached, no network |

Pinning lets the module cache serve the tool with no network round-trip.

---

## Exercise 6: Parallel package compilation

`go run` compiles packages in parallel up to `-p` (defaults to GOMAXPROCS / number of CPUs). On a machine where you have constrained CPUs (e.g., a container with a CPU quota), the default may over- or under-subscribe.

```bash
go run -p 8 .     # cap parallel compile/link actions
```

| Metric | default in 2-CPU container | `-p 2` |
|--------|----------------------------|--------|
| Compile contention | high (oversubscribed) | matched to quota |

Set `-p` to your actual CPU quota in constrained CI to reduce thrashing.

---

## Measurement checklist
- [ ] Warm `GOCACHE` (and persist it in CI) before timing.
- [ ] Replace repeated `go run` with one `go build` + reuse.
- [ ] Set `CGO_ENABLED=0` for pure-Go programs.
- [ ] Keep build flags stable within a workflow.
- [ ] Pin tool versions so the module cache is hit.
- [ ] Tune `-p` to the real CPU quota in constrained environments.
