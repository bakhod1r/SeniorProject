# gofmt / go fmt — Optimization

gofmt is already fast (no type checking), so "optimization" here means running it less wastefully and avoiding spurious CI cost. Numbers are illustrative.

---

## Exercise 1: Check only changed files in PR CI

**Before** — `gofmt -l ./...` walks the entire monorepo on every PR.

**After** — restrict to changed Go files:

```bash
changed=$(git diff --name-only origin/main...HEAD | grep '\.go$' || true)
[ -z "$changed" ] && exit 0
unformatted=$(gofmt -s -l $changed)
test -z "$unformatted"
```

| Metric | full tree | changed-only |
|--------|-----------|--------------|
| Files scanned per PR | all (e.g., 5000) | a handful |
| Check time | ~3s | ~0.1s |

Run the full check on the main branch periodically as a safety net.

---

## Exercise 2: Format-on-save instead of batch runs

**Before** — developers run `go fmt ./...` manually before each commit (and forget).

**After** — gopls formats the open file on save:

```jsonc
"editor.formatOnSave": true
```

| Metric | manual batch | on-save |
|--------|--------------|---------|
| Cost per save | n/a | ~milliseconds (one file) |
| Forgotten formatting | common | rare |

Per-file formatting is effectively free and removes the "I forgot" failure mode.

---

## Exercise 3: Pin the toolchain to kill spurious CI reruns

**Before** — gofmt version skew between dev and CI causes intermittent format failures, triggering reruns and reformat commits.

**After** — pin the toolchain so gofmt is deterministic:

```
go 1.23.0
```

```bash
export GOTOOLCHAIN=go1.23.0
```

| Metric | unpinned | pinned |
|--------|----------|--------|
| Spurious format failures | occasional | none |
| Wasted CI reruns | yes | no |

---

## Exercise 4: Make generators emit canonical code

**Before** — generated files are reformatted by a separate `gofmt -w` pass after every generation, doubling work and risking drift.

**After** — format inside the generator:

```go
out, err := format.Source(buf.Bytes())
if err != nil { return err }
os.WriteFile(path, out, 0o644)
```

| Metric | generate + separate gofmt | format in generator |
|--------|---------------------------|---------------------|
| Passes over generated files | 2 | 1 |
| Risk of un-formatted generated output | yes | no |

---

## Exercise 5: Combine fmt check with the lint job

**Before** — a separate CI job spins up just to run gofmt, adding container start overhead.

**After** — fold the gofmt check into the existing lint job (golangci-lint can run the `gofmt`/`gofumpt` linters):

```yaml
# .golangci.yml
linters:
  enable: [gofumpt]
```

| Metric | dedicated fmt job | folded into lint |
|--------|-------------------|------------------|
| Extra job startup | ~20s | 0 |

One job, one toolchain, one cache — fewer moving parts and faster pipelines.

---

## Measurement checklist
- [ ] Check only changed files in PR CI; full check on main periodically.
- [ ] Format-on-save so per-file cost is negligible and nothing is forgotten.
- [ ] Pin the toolchain to eliminate version-skew failures.
- [ ] Format inside generators (`go/format`) — single pass.
- [ ] Fold the fmt check into the existing lint job.
