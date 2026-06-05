# Build Orchestration & Cache — Junior

You already know that a Go compiler reads source, parses it, type-checks it,
turns it into machine code, and links an executable. But you never call those
tools yourself — you type `go build` and a binary appears. This page is about
the program that runs **on top of** the compiler and linker: the `go` command.
Its job is *orchestration* — deciding **what** to compile, in **what order**,
**in parallel**, and **what it can skip** because it already did it before.

## 1. What `go build` actually does

`go build` is not a compiler. It is a *driver*. Given a package, it:

1. Resolves which packages you depend on (reads `go.mod`, finds the source for
   every import, directly and transitively).
2. Orders those packages so every package is built **after** the packages it
   imports (you cannot compile `main` before `fmt`).
3. For each package, runs the real tools — `compile` (the gc compiler),
   `asm` (for `.s` assembly files), and `pack` (bundles the result into a
   `.a` archive).
4. For the `main` package, runs `link` to produce the final executable.
5. Caches every compiled result so the next build can reuse it.

The tools live inside your Go installation:

```text
$(go env GOROOT)/pkg/tool/<os>_<arch>/compile
$(go env GOROOT)/pkg/tool/<os>_<arch>/link
$(go env GOROOT)/pkg/tool/<os>_<arch>/asm
$(go env GOROOT)/pkg/tool/<os>_<arch>/pack
```

You can list them:

```sh
ls "$(go env GOROOT)/pkg/tool/$(go env GOOS)_$(go env GOARCH)/"
# asm  compile  link  pack  buildid  cgo  vet  ...
```

## 2. Watch it happen with `go build -x`

The single most useful flag for learning this topic is `-x`. It prints **every
command** the `go` tool runs, including the temporary working directory.

```sh
mkdir hello && cd hello
go mod init example.com/hello
cat > main.go <<'EOF'
package main

import "fmt"

func main() { fmt.Println("hi") }
EOF

go build -x .
```

You will see (trimmed, real output shape on Go 1.25):

```text
WORK=/var/folders/.../go-build3334667873
mkdir -p $WORK/b001/
...
/usr/local/go/pkg/tool/darwin_arm64/compile -o $WORK/b001/_pkg_.a \
    -trimpath "$WORK/b001=>" -p main -lang=go1.25 -complete \
    -buildid <hash> -goversion go1.25.3 -importcfg $WORK/b001/importcfg \
    -pack ./main.go
/usr/local/go/pkg/tool/darwin_arm64/link -o $WORK/b001/exe/a.out \
    -importcfg $WORK/b001/importcfg.link -buildmode=exe ...
mv $WORK/b001/exe/a.out hello
```

Read that as a story:

- `WORK=...` — a private scratch directory the `go` tool created.
- `compile -o $WORK/b001/_pkg_.a ... ./main.go` — the gc compiler turned your
  source into a compiled archive.
- `-importcfg $WORK/b001/importcfg` — a file listing where each imported
  package's compiled `.a` lives. **This** is how the compiler finds `fmt`.
- `link -o ... $WORK/b001/exe/a.out` — the linker built the executable.
- `mv ... hello` — the result was moved to your directory.

> If you run `go build -x` a **second** time, you'll see almost nothing — no
> `compile`, no `link`. That is the cache at work (Section 4).

## 3. The `$WORK` temp directory

That `WORK=...` directory is deleted as soon as `go build` finishes. To keep it,
add `-work`:

```sh
go build -work .
# WORK=/var/folders/.../go-build123456789   <-- not deleted
```

Now go look inside:

```sh
ls /var/folders/.../go-build123456789/b001/
# _pkg_.a  importcfg  importcfg.link  exe/
```

Every package gets a numbered directory (`b001`, `b002`, …). `-work` is how you
"freeze the crime scene" and inspect exactly what the tools were handed.

## 4. The build cache — why the 2nd build is instant

The first time you build, the `go` tool compiles everything (including a lot of
the standard library if it isn't already prebuilt) and **saves each compiled
result in a cache directory**. The next build, if nothing changed, it just
**copies the saved result** instead of recompiling.

Where is the cache?

```sh
go env GOCACHE
# /Users/you/Library/Caches/go-build      (macOS)
# /home/you/.cache/go-build               (Linux)
# C:\Users\you\AppData\Local\go-build     (Windows)
```

Prove it to yourself — time a cold build vs a warm build:

```sh
go clean -cache          # empty the cache (forces a cold build)
time go build ./...      # slow: compiles everything

time go build ./...      # fast: reuses cached results — often near-instant
```

The cache is **content-addressed**: the `go` tool computes a hash of all the
inputs (your source bytes, the compiler version, the build flags, and the
hashes of your dependencies) and uses that hash as a key. Same inputs → same
key → reuse the saved output. Change one byte of source → different key → it
recompiles only that package (and anything that imports it).

## 5. Misconceptions

| Belief | Reality |
| --- | --- |
| "`go build` is the compiler." | It is a *driver* that runs `compile`, `asm`, `pack`, `link`. |
| "Deleting the binary forces a rebuild." | No — the cache still has the compiled packages; only the final link/copy reruns. |
| "The cache lives next to my code." | No — it's in `GOCACHE`, a global per-user directory shared by all your projects. |
| "I should clean the cache when builds act weird." | Rarely needed. `go clean -cache` mostly just makes the next build slow. |
| "The 2nd build is fast because the OS cached files." | No — it's Go's own content-addressed build cache reusing compiled output. |

## 6. Things to do today

```sh
# 1. See every tool the go command runs.
go build -x . 2>&1 | less

# 2. Keep and explore the scratch dir.
go build -work .

# 3. Find your cache and its size.
go env GOCACHE
du -sh "$(go env GOCACHE)"

# 4. Feel cold vs warm.
go clean -cache && time go build ./... && time go build ./...

# 5. Force a full rebuild (ignore the cache for this run).
go build -a -x . 2>&1 | grep -c compile   # many compiles, not one
```

## 7. Summary

- `go build` is an **orchestrator**: it resolves dependencies, orders packages,
  and runs the real tools `compile` / `asm` / `pack` / `link`.
- `-x` prints the actual commands; `-work` keeps the `$WORK` scratch dir so you
  can inspect what was passed to each tool.
- The **build cache** in `GOCACHE` is content-addressed: hash the inputs, reuse
  the output. That's why the second identical build is nearly instant.
- `go clean -cache` empties it; `go build -a` forces a full rebuild for one run.

## Further reading

- `go help build`, `go help cache`, `go help clean` (run locally)
- Go command docs: <https://pkg.go.dev/cmd/go>
- The build cache design: <https://pkg.go.dev/cmd/go/internal/cache>
- "How the go command builds packages" — <https://go.dev/doc/articles/go_command.html>
