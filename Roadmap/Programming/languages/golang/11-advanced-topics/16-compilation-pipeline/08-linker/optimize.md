# The Linker — Optimize

How to make Go binaries smaller and link faster, and how to **measure** so you
optimize the right thing. We go from the cheap, always-do wins (`-s -w`,
`-trimpath`) to dependency surgery, the reflection problem, the UPX tradeoff,
and a final checklist.

---

## 1. Measure first

Never optimize size blind. Establish a baseline and a breakdown.

```bash
# Baseline
go build -o app ./cmd/app
ls -l app                       # raw size

# Symbols ranked by size
go tool nm -size -sort size app | tail -30

# Section + package breakdown (bloaty: github.com/google/bloaty)
bloaty app                      # top-level: sections vs symbols
bloaty -d sections app          # how much is .text vs .rodata vs pclntab vs debug
bloaty -d compileunits app      # which packages cost the most
bloaty -d symbols app | head -30

# Why is package X linked in at all?
go build -ldflags=-dumpdep -o app ./cmd/app 2>deps.txt
grep -i 'regexp' deps.txt | head    # walk the edges back to a root
```

Interpreting a typical breakdown:

- `.debug_*` (DWARF) is often the **single largest** contributor — `-w` deletes
  it.
- `.text` dominated by `reflect`, `net/http`, `crypto/tls`, `regexp` → candidate
  dependencies to question.
- `.gopclntab` is sizable and **cannot** be removed (runtime needs it).
- `.rodata` full of type names/tags → reflection-driven metadata.

---

## 2. The cheap wins: `-s -w` and `-trimpath`

```bash
go build -trimpath -ldflags="-s -w" -o app ./cmd/app
```

- `-w` removes DWARF (`.debug_*`) — frequently the **biggest** single drop.
- `-s` removes the symbol table — additional shrink.
- `-trimpath` removes embedded absolute paths (small size win, big
  reproducibility/privacy win).

Expect a combined **20–35%** reduction versus a plain build, almost entirely
from DWARF. These are safe for production: panics/stack traces still work
(pclntab survives). The only cost is you lose source-level `dlv` debugging on
*that* artifact.

---

## 3. Cut dependencies — the biggest lever

Code size scales with **reachable** code. Every dependency drags its transitive
tree through deadcode. The largest reductions come from *not linking* heavy
subtrees:

| Heavy subtree | Often pulled in by | Lighter alternative |
| --- | --- | --- |
| `reflect` + type metadata | `encoding/json`, `fmt` with `%v` on structs, ORMs | code-gen encoders (`easyjson`, hand-written) |
| `regexp` | a single `regexp.MustCompile` for a trivial check | `strings`/`bytes` matching |
| `net/http` + `crypto/tls` | importing `net/http` for a tiny client | minimal client, or accept the cost |
| `time/tzdata` | `_ "time/tzdata"` embedding the tz database | rely on system zoneinfo |
| large generated code | protobuf/grpc with everything | trim unused services |

Find them with `-dumpdep` and bloaty `-d compileunits`. The discipline: when a
binary jumps in size after adding a dep, immediately check what subtree it
brought.

```bash
# Diff reachable packages before/after a change
go build -ldflags=-dumpdep -o app ./cmd/app 2>after.txt
diff <(sort before.txt) <(sort after.txt) | grep '^>' | head
```

---

## 4. Avoid reflection bloat

Reflection is the #1 *sneaky* size cost because it makes the linker
**conservative** — it disables method pruning and keeps full type metadata (see
the senior tier).

Tactics:

- Prefer **generated** or hand-written serialization over `encoding/json` in
  size-critical binaries.
- Avoid `reflect.MethodByName`/dynamic dispatch where a normal interface works —
  interfaces let deadcode prune precisely; `MethodByName` keeps everything.
- Keep reflective code in a **small, well-bounded** set of types rather than
  reflecting over your whole domain model.
- Be aware that even `fmt.Printf("%v", structValue)` pulls reflection; a
  size-minimal binary may prefer explicit field printing.

You can confirm the effect by building two variants (one using `MethodByName`,
one not) and comparing `bloaty -d symbols`.

---

## 5. Strip without breaking observability

You usually still want **panics with names** in production. Good news: `-s -w`
preserves that (pclntab). What you give up:

- source-level `dlv` debugging,
- some external tools that read the Go symbol table.

Pattern: build **two** artifacts from the same source — a stripped one to ship,
and an unstripped (or DWARF-only) one kept in artifact storage for offline
debugging / symbolization. Keep them paired by build ID
(`go version -m` / `vcs.revision`).

---

## 6. The UPX tradeoff

[UPX](https://upx.github.io/) compresses the executable and decompresses it into
memory at startup.

```bash
go build -trimpath -ldflags="-s -w" -o app ./cmd/app
upx --best --lzma app           # can roughly halve on-disk size
```

Pros: smaller **on-disk**/transfer size (good for hand-distributed CLIs over slow
links).
Cons (why most servers avoid it):

- **Startup latency** from decompress-on-exec, and the whole image is resident
  in memory (no demand paging from the file).
- **Antivirus / EDR** frequently flags UPX-packed binaries as suspicious.
- Breaks `mmap`-based sharing of the text segment across processes.
- Can interfere with some buildmodes and with debugging/symbolization.

Rule of thumb: fine for a CLI you ship to users over the internet; avoid for
long-running server binaries where startup time, memory, and AV trust matter.

---

## 7. Optimize link **time**, not just size

Large binaries also link slowly, which hurts edit-build-test loops.

- The linker is mostly **single-threaded** in its hot phases; less reachable
  code ⇒ faster links. Cutting dependencies helps build speed *and* size.
- The **build cache** (`$GOCACHE`) caches compiled packages, not the final
  link; the link runs every time the final package set changes. Keep the cache
  warm (`go build ./...` once) so only the link re-runs.
- `-ldflags=-v` prints per-phase timings — see whether deadcode, DWARF gen, or
  host-linking dominates.

```bash
go build -ldflags="-v" -o app ./cmd/app 2>&1 | grep -E 'host link|dwarf|deadcode|total'
```

- If **external linking** is the slow part (cgo/pie), that's the host linker;
  consider `CGO_ENABLED=0` for dev builds to stay internal and fast.
- DWARF generation is non-trivial; dev builds can skip it with `-w` for faster
  links (keep full builds for the debug artifact).

---

## 8. Checklist

```
[ ] Measured baseline (ls -l) and breakdown (bloaty -d sections / compileunits)
[ ] -ldflags="-s -w"           (drops DWARF + symtab; biggest easy win)
[ ] -trimpath                  (paths out; reproducibility + privacy)
[ ] CGO_ENABLED=0 if portable  (static, internal link, fast, scratch-friendly)
[ ] Audited heavy deps via -dumpdep (reflect / regexp / net/http / tzdata)
[ ] Reduced reflection where size-critical (gen encoders, fewer MethodByName)
[ ] Kept a paired unstripped/DWARF artifact for offline debugging
[ ] Considered UPX ONLY for hand-distributed CLIs (not servers)
[ ] Tracked binary size in CI (fail on >N% growth)
[ ] Checked link time with -ldflags=-v if builds feel slow
```

---

## 9. Summary

- **Measure** with `nm -size`, `bloaty`, and `-dumpdep` before changing
  anything; DWARF and reflection metadata are the usual heavies.
- `-s -w` + `-trimpath` are the safe, large, always-do wins; panics still
  symbolicate because pclntab stays.
- The biggest reductions come from **linking less code** — prune heavy
  dependencies and reflection.
- **UPX** trades disk for startup/memory/AV pain — CLIs maybe, servers no.
- Cutting reachable code also **speeds up linking**; use `-ldflags=-v` to find
  the slow phase, and `CGO_ENABLED=0` to keep dev builds internal and fast.

---

## Further reading

- [bloaty — binary size profiler](https://github.com/google/bloaty)
- [`go tool nm`](https://pkg.go.dev/cmd/nm)
- [`-ldflags=-dumpdep` and linker internals (`cmd/link`)](https://pkg.go.dev/cmd/link)
- [Reducing Go binary size (community guides)](https://github.com/golang/go/wiki/CompilerOptimizations)
- [UPX](https://upx.github.io/)
